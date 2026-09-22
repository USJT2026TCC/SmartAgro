import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";

import { assinarLote } from "../src/dominio/assinaturaDeLote.js";
import { carteiraDeFonteDeDemonstracao } from "../src/banco/semente.js";
import { carteiraAleatoria, montar } from "./ajuda.js";

/**
 * Ingestao de leituras autenticadas na origem (RF11, RF12, RF13, RNF19).
 */
describe("ingestao de leituras", () => {
  let ctx;
  const FONTE = "estacao-inmet-a652";
  const chaveDaFonte = carteiraDeFonteDeDemonstracao(10);

  before(async () => {
    ctx = await montar();
  });

  after(() => ctx.fechar());

  /** Monta, assina e envia um lote. Devolve a resposta. */
  async function enviar(
    leituras,
    { carteira = chaveDaFonte, fonte = FONTE, lote = randomUUID(), enviadoEm } = {},
  ) {
    const corpo = JSON.stringify({
      lote,
      fonte,
      enviadoEm: enviadoEm ?? new Date().toISOString(),
      leituras,
    });

    return ctx
      .api()
      .post("/api/leituras")
      .set("Content-Type", "application/json")
      .set("X-Assinatura", await assinarLote(Buffer.from(corpo), carteira))
      .send(corpo);
  }

  const leitura = (dia, chuvaMm, extra = {}) => ({
    instante: `2026-09-${String(dia).padStart(2, "0")}T12:00:00.000Z`,
    chuvaMm,
    temperaturaC: 27,
    umidadePct: 55,
    ...extra,
  });

  test("lote assinado pela chave da fonte e aceito", async () => {
    const r = await enviar([leitura(1, 0), leitura(2, 3.5)]);

    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.aceitas, 2);
    assert.equal(r.body.recusadas, 0);
  });

  test("lote assinado por outra chave e recusado (RNF19)", async () => {
    const r = await enviar([leitura(3, 0)], { carteira: carteiraAleatoria() });

    assert.equal(r.status, 401);
  });

  test("corpo alterado depois da assinatura e recusado", async () => {
    const corpo = JSON.stringify({
      lote: randomUUID(),
      fonte: FONTE,
      enviadoEm: new Date().toISOString(),
      leituras: [leitura(4, 0)],
    });
    const assinatura = await assinarLote(Buffer.from(corpo), chaveDaFonte);

    // Um intermediario troca 0 mm por 80 mm, para esconder a estiagem.
    const adulterado = corpo.replace('"chuvaMm":0', '"chuvaMm":80');

    const r = await ctx
      .api()
      .post("/api/leituras")
      .set("Content-Type", "application/json")
      .set("X-Assinatura", assinatura)
      .send(adulterado);

    assert.equal(r.status, 401);
  });

  test("fonte inexistente responde igual a assinatura errada", async () => {
    const r = await enviar([leitura(5, 0)], { fonte: "fonte-que-nao-existe" });
    assert.equal(r.status, 401);
  });

  test("reenviar o mesmo lote e recusado (antirrepeticao)", async () => {
    const lote = randomUUID();

    assert.equal((await enviar([leitura(6, 0)], { lote })).status, 201);
    assert.equal((await enviar([leitura(7, 0)], { lote })).status, 409);
  });

  test("lote com marca de tempo fora da janela e recusado", async () => {
    const r = await enviar([leitura(8, 0)], {
      enviadoEm: new Date(Date.now() - 60 * 60_000).toISOString(),
    });

    assert.equal(r.status, 400);
    assert.match(r.body.erro.mensagem, /relogio/);
  });

  test("leitura implausivel e gravada como invalida, com o motivo, e derruba a reputacao (RF12, RF13)", async () => {
    const antes = Number(
      (await ctx.banco.query("SELECT escore FROM fontes WHERE id = $1", [FONTE])).rows[0].escore,
    );

    const r = await enviar([leitura(9, 9999), leitura(10, 0, { temperaturaC: -273 })]);

    assert.equal(r.status, 201);
    assert.equal(r.body.aceitas, 0);
    assert.equal(r.body.recusadas, 2);
    assert.ok(r.body.escore < antes, `escore ${r.body.escore} deveria ser menor que ${antes}`);

    const { rows } = await ctx.banco.query(
      "SELECT valida, motivo_descarte FROM leituras WHERE fonte_id = $1 AND NOT valida ORDER BY instante",
      [FONTE],
    );

    // A evidencia fica no banco: apagar a leitura seria apagar o que justifica
    // a queda da reputacao.
    assert.deepEqual(
      rows.map((l) => l.motivo_descarte),
      ["fora_de_faixa:chuvaMm", "fora_de_faixa:temperaturaC"],
    );
  });

  test("a mesma leitura reenviada em outro lote nao conta de novo na reputacao", async () => {
    const primeiro = await enviar([leitura(11, 0)]);
    const escore = primeiro.body.escore;

    const repetido = await enviar([leitura(11, 0)]);

    assert.equal(repetido.body.duplicadas, 1);
    assert.equal(repetido.body.escore, escore);
  });

  test("fonte desativada nao envia", async () => {
    await ctx.banco.query("UPDATE fontes SET ativa = false WHERE id = $1", [FONTE]);

    const r = await enviar([leitura(12, 0)]);
    assert.equal(r.status, 400);

    await ctx.banco.query("UPDATE fontes SET ativa = true WHERE id = $1", [FONTE]);
  });
});
