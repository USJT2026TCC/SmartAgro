import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";

import { ethers } from "ethers";

import consolidador from "../../oraculo/src/consolidador.js";
import { assinarLote } from "../src/dominio/assinaturaDeLote.js";
import { carteiraDeFonteDeDemonstracao } from "../src/banco/semente.js";
import { PRODUTOR_NA_CADEIA, com, entrar, montar } from "./ajuda.js";

/**
 * Interface entre o backend e o servico de oraculo.
 *
 * O teste central aqui e o de ponta a ponta sem cadeia: leituras assinadas entram
 * pela ingestao, saem pela API do oraculo, e o consolidador do proprio oraculo
 * calcula o indice sobre elas. Se o formato de saida divergir do que o
 * consolidador espera, este teste quebra.
 */
describe("API do oraculo", () => {
  let ctx;
  const CHAVE = { "X-Chave-De-Servico": "chave-de-teste" };
  const APOLICE = "0x00000000000000000000000000000000000a1b2c";

  before(async () => {
    ctx = await montar();

    const talhao = (
      await ctx.banco.query("SELECT id FROM talhoes WHERE identificador = 'talhao-01'")
    ).rows[0].id;

    await ctx.banco.query(
      `INSERT INTO apolices (endereco, talhao_id, produtor_carteira, seguradora_carteira, talhao_bytes32,
                             hash_termos, valor_indenizacao_wei, tx_emissao, bloco_emissao, situacao)
       VALUES ($1, $2, $3, '0x0', $4, $5, '1000000000000000000', $6, 1, 1)`,
      [
        APOLICE,
        talhao,
        PRODUTOR_NA_CADEIA,
        ethers.encodeBytes32String("talhao-01"),
        ethers.ZeroHash,
        ethers.ZeroHash,
      ],
    );
  });

  after(() => ctx.fechar());

  test("toda rota exige a chave de servico", async () => {
    assert.equal((await ctx.api().get("/api/oraculo/apolices-ativas")).status, 401);
    assert.equal(
      (await ctx.api().get("/api/oraculo/apolices-ativas").set("X-Chave-De-Servico", "errada"))
        .status,
      401,
    );

    // Nem uma sessao de seguradora serve: e outra forma de autenticacao.
    const token = await entrar(ctx.api, "seguradora");
    assert.equal((await ctx.api().get("/api/oraculo/apolices-ativas").set(com(token))).status, 401);
  });

  test("lista as apolices ativas com o talhao e as fontes", async () => {
    const r = await ctx.api().get("/api/oraculo/apolices-ativas").set(CHAVE);

    assert.equal(r.status, 200);
    assert.equal(r.body.apolices.length, 1);
    assert.equal(r.body.apolices[0].talhao, "talhao-01");
    assert.equal(r.body.apolices[0].fontes.length, 2);
  });

  test("de ponta a ponta: leituras assinadas viram indice no consolidador do oraculo", async () => {
    // 35 dias de estiagem depois de um dia de chuva, nas duas estacoes.
    const inicio = Date.UTC(2026, 8, 1);
    const dias = Array.from({ length: 36 }, (_, i) => ({
      instante: new Date(inicio + i * 86_400_000 + 12 * 3_600_000).toISOString(),
      chuvaMm: i === 0 ? 12 : 0,
      temperaturaC: 30,
      umidadePct: 40,
    }));

    for (const [fonte, indice] of [
      ["estacao-inmet-a652", 10],
      ["sensor-solo-talhao-01", 11],
    ]) {
      const corpo = JSON.stringify({
        lote: randomUUID(),
        fonte,
        enviadoEm: new Date().toISOString(),
        leituras: dias,
      });
      const r = await ctx
        .api()
        .post("/api/leituras")
        .set("Content-Type", "application/json")
        .set(
          "X-Assinatura",
          await assinarLote(Buffer.from(corpo), carteiraDeFonteDeDemonstracao(indice)),
        )
        .send(corpo);

      assert.equal(r.status, 201, JSON.stringify(r.body));
    }

    const r = await ctx
      .api()
      .get("/api/oraculo/leituras?talhao=talhao-01&ate=20261006&dias=90")
      .set(CHAVE);
    assert.equal(r.status, 200);
    assert.equal(r.body.leituras.length, 72);

    const resultado = consolidador.consolidarIndiceClimatico(r.body.leituras, {
      periodo: 20261006,
    });

    assert.equal(resultado.indiceClimatico, 35);
    assert.equal(resultado.interrompidoPor, "chuva");
    assert.deepEqual(resultado.fontesUsadas, ["estacao-inmet-a652", "sensor-solo-talhao-01"]);
    assert.deepEqual(resultado.alertas, []);
  });

  test("leituras de fonte desativada nao vao para o oraculo", async () => {
    await ctx.banco.query("UPDATE fontes SET ativa = false WHERE id = 'sensor-solo-talhao-01'");

    const r = await ctx.api().get("/api/oraculo/leituras?talhao=talhao-01&ate=20261006").set(CHAVE);
    assert.ok(r.body.leituras.every((l) => l.fonte === "estacao-inmet-a652"));

    await ctx.banco.query("UPDATE fontes SET ativa = true WHERE id = 'sensor-solo-talhao-01'");
  });

  test("o relato de publicacao fica pendente ate o evento aparecer na cadeia (RF22)", async () => {
    const txHash = ethers.hexlify(ethers.randomBytes(32));

    const r = await ctx
      .api()
      .post("/api/oraculo/publicacoes")
      .set(CHAVE)
      .send({
        apolice: APOLICE,
        periodo: 20261006,
        txHash,
        indiceClimatico: 35,
        gasUsado: "231849",
        gasEstimado: "240000",
        enviadoEm: "2026-10-06T12:00:00.000Z",
        confirmadoEm: "2026-10-06T12:00:00.180Z",
        acionouPagamento: true,
        procedencia: { fontesUsadas: ["estacao-inmet-a652"] },
      });

    assert.equal(r.status, 201);
    assert.equal(r.body.confirmadaNaCadeia, false);

    const { rows } = await ctx.banco.query(
      "SELECT latencia_ms, gas_usado FROM publicacoes_oraculo WHERE tx_hash = $1",
      [txHash.toLowerCase()],
    );
    assert.equal(rows[0].latencia_ms, 180);
    assert.equal(rows[0].gas_usado, "231849");
  });

  test("falha de publicacao notifica a seguradora uma unica vez (RF27)", async () => {
    const falha = { apolice: APOLICE, periodo: 20261007, motivo: "ECONNREFUSED", tentativas: 5 };

    assert.equal((await ctx.api().post("/api/oraculo/falhas").set(CHAVE).send(falha)).status, 201);
    assert.equal((await ctx.api().post("/api/oraculo/falhas").set(CHAVE).send(falha)).status, 201);

    const token = await entrar(ctx.api, "seguradora");
    const r = await ctx.api().get("/api/notificacoes").set(com(token));

    const falhas = r.body.notificacoes.filter((n) => n.tipo === "falha_de_publicacao");
    assert.equal(falhas.length, 1);
    assert.match(falhas[0].mensagem, /20261007/);
  });
});
