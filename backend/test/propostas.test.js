import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";

import { ethers } from "ethers";

import { descreverTermos, resumirTermos } from "../src/dominio/termos.js";
import { calcularCotacao } from "../src/dominio/cotacao.js";
import {
  FABRICA,
  PRODUTOR_NA_CADEIA,
  SEGURADORA_NA_CADEIA,
  com,
  entrar,
  idDoProduto,
  idDoTalhao,
  montar,
  reciboDeEmissao,
} from "./ajuda.js";

/**
 * Cotacao, proposta e emissao verificada na cadeia (RF06, RF07, RF08).
 */

describe("cotacao em BigInt", () => {
  test("180 ha x 0,006 ETH da exatamente 1,08 ETH, sem os 71 wei do ponto flutuante", () => {
    const { valorIndenizacaoWei, premioWei } = calcularCotacao({
      areaHa: "180",
      valorPorHectareWei: ethers.parseEther("0.006"),
      taxaPremioBps: 380,
    });

    assert.equal(valorIndenizacaoWei, 1_080_000_000_000_000_000n);
    assert.equal(premioWei, 41_040_000_000_000_000n);

    // O defeito que motivou a regra: em ponto flutuante, a mesma conta erra.
    assert.notEqual(ethers.parseEther((180 * 0.006).toFixed(18)), valorIndenizacaoWei);
  });

  test("area fracionada nao perde casas", () => {
    const { valorIndenizacaoWei } = calcularCotacao({
      areaHa: "180.5",
      valorPorHectareWei: ethers.parseEther("0.006"),
      taxaPremioBps: 0,
    });

    assert.equal(valorIndenizacaoWei, ethers.parseEther("1.083"));
  });
});

describe("termos e resumo (RF08)", () => {
  const base = {
    propostaId: "11111111-1111-1111-1111-111111111111",
    carteiraProdutor: PRODUTOR_NA_CADEIA,
    talhao: "talhao-01",
    cultura: "soja",
    areaHa: "180",
    operador: 0,
    modoPagamento: 1,
    limiarClimatico: 30,
    limiarClimaticoIntegral: 60,
    limiarDanoBps: 0,
    limiarDanoIntegralBps: 0,
    valorIndenizacaoWei: "1080000000000000000",
    premioWei: "41040000000000000",
    vigenciaInicio: 1790000000,
    vigenciaFim: 1805552000,
  };

  test("a descricao e deterministica: os mesmos termos dao sempre o mesmo resumo", () => {
    assert.equal(resumirTermos(descreverTermos(base)), resumirTermos(descreverTermos({ ...base })));
  });

  test("qualquer campo alterado muda o resumo", () => {
    const original = resumirTermos(descreverTermos(base));

    for (const [campo, valor] of [
      ["limiarClimatico", 31],
      ["valorIndenizacaoWei", "1080000000000000001"],
      ["carteiraProdutor", SEGURADORA_NA_CADEIA],
      ["vigenciaFim", base.vigenciaFim + 1],
    ]) {
      assert.notEqual(resumirTermos(descreverTermos({ ...base, [campo]: valor })), original, campo);
    }
  });

  test("a capitalizacao do endereco nao altera o resumo", () => {
    assert.equal(
      resumirTermos(descreverTermos(base)),
      resumirTermos(
        descreverTermos({ ...base, carteiraProdutor: ethers.getAddress(PRODUTOR_NA_CADEIA) }),
      ),
    );
  });
});

describe("propostas e emissao", () => {
  let ctx;
  let produtor;
  let seguradora;
  let talhaoId;
  let produtoId;

  before(async () => {
    ctx = await montar();
    produtor = await entrar(ctx.api, "produtor");
    seguradora = await entrar(ctx.api, "seguradora");
    talhaoId = await idDoTalhao(ctx.banco);
    produtoId = await idDoProduto(ctx.banco, "Estiagem escalonada — soja");
  });

  after(() => ctx.fechar());

  beforeEach(() => {
    ctx.cadeia.estado.recibos.clear();
    ctx.cadeia.estado.termos.clear();
  });

  async function novaProposta(areaHa = "180") {
    const r = await ctx
      .api()
      .post("/api/propostas")
      .set(com(produtor))
      .send({ talhaoId, produtoId, areaHa });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    return r.body.proposta;
  }

  async function preparar(id) {
    const r = await ctx.api().post(`/api/propostas/${id}/preparar`).set(com(seguradora));
    assert.equal(r.status, 200, JSON.stringify(r.body));
    return r.body;
  }

  /** Simula a emissao na cadeia com os termos informados, e devolve o txHash. */
  function emitirNaCadeia({
    apolice,
    hashTermos,
    produtor: dono = PRODUTOR_NA_CADEIA,
    valor,
    de,
    status,
  }) {
    const txHash = ethers.hexlify(ethers.randomBytes(32));

    ctx.cadeia.estado.recibos.set(
      txHash,
      reciboDeEmissao({
        apolice,
        produtor: dono,
        talhao: ethers.encodeBytes32String("talhao-01"),
        valor,
        hashTermos,
        de,
        status,
      }),
    );

    ctx.cadeia.estado.termos.set(apolice.toLowerCase(), {
      produtor: dono.toLowerCase(),
      talhao: ethers.encodeBytes32String("talhao-01"),
      cultura: ethers.encodeBytes32String("soja"),
      valorIndenizacao: String(valor),
      hashTermos,
      seguradora: SEGURADORA_NA_CADEIA,
    });

    return txHash;
  }

  const confirmar = (id, txHash) =>
    ctx.api().post(`/api/propostas/${id}/emissao`).set(com(seguradora)).send({ txHash });

  test("a cotacao do servidor usa a area medida pelo PostGIS como teto", async () => {
    const r = await ctx
      .api()
      .post("/api/cotacoes")
      .set(com(produtor))
      .send({ talhaoId, produtoId, areaHa: "180" });

    assert.equal(r.status, 200);
    assert.equal(r.body.cotacao.valorIndenizacaoWei, "1080000000000000000");

    const excesso = await ctx
      .api()
      .post("/api/cotacoes")
      .set(com(produtor))
      .send({ talhaoId, produtoId, areaHa: "999" });
    assert.equal(excesso.status, 400);
    assert.match(excesso.body.erro.mensagem, /excede/);
  });

  test("produto de outra cultura e recusado", async () => {
    const milho = await idDoProduto(ctx.banco, "Estiagem ou dano na lavoura — milho");
    const r = await ctx
      .api()
      .post("/api/cotacoes")
      .set(com(produtor))
      .send({ talhaoId, produtoId: milho });

    assert.equal(r.status, 400);
    assert.match(r.body.erro.mensagem, /milho/);
  });

  test("proposta exige carteira vinculada", async () => {
    await ctx.banco.query("UPDATE usuarios SET carteira = NULL WHERE identificador = 'produtor'");

    const r = await ctx
      .api()
      .post("/api/propostas")
      .set(com(produtor))
      .send({ talhaoId, produtoId, areaHa: "10" });
    assert.equal(r.status, 400);
    assert.match(r.body.erro.mensagem, /Vincule a carteira/);

    await ctx.banco.query("UPDATE usuarios SET carteira = $1 WHERE identificador = 'produtor'", [
      PRODUTOR_NA_CADEIA,
    ]);
  });

  test("preparar devolve a struct pronta para emitirApolice, com vigencia pelo relogio da cadeia", async () => {
    const proposta = await novaProposta();
    const preparo = await preparar(proposta.id);

    assert.equal(preparo.fabrica, FABRICA);
    assert.equal(preparo.termos.valorIndenizacao, "1080000000000000000");
    assert.equal(preparo.termos.vigenciaInicio, ctx.cadeia.estado.instante);
    assert.equal(preparo.termos.vigenciaFim, ctx.cadeia.estado.instante + 180 * 86_400);
    assert.equal(preparo.termos.hashTermos, resumirTermos(preparo.descricaoDosTermos));
    assert.equal(ethers.decodeBytes32String(preparo.termos.talhao), "talhao-01");
  });

  test("emissao correta liga a apolice a proposta", async () => {
    const proposta = await novaProposta();
    const { hashTermos } = await preparar(proposta.id);
    const apolice = ethers.Wallet.createRandom().address;

    const txHash = emitirNaCadeia({ apolice, hashTermos, valor: 1_080_000_000_000_000_000n });
    const r = await confirmar(proposta.id, txHash);

    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.apolice.endereco, apolice.toLowerCase());

    const lista = await ctx.api().get("/api/propostas").set(com(produtor));
    const atualizada = lista.body.propostas.find((p) => p.id === proposta.id);
    assert.equal(atualizada.situacao, "emitida");
    assert.equal(atualizada.apolice.endereco, apolice.toLowerCase());
  });

  test("confirmar duas vezes a mesma emissao e idempotente", async () => {
    const proposta = await novaProposta();
    const { hashTermos } = await preparar(proposta.id);
    const apolice = ethers.Wallet.createRandom().address;
    const txHash = emitirNaCadeia({ apolice, hashTermos, valor: 1_080_000_000_000_000_000n });

    assert.equal((await confirmar(proposta.id, txHash)).status, 200);

    const segunda = await confirmar(proposta.id, txHash);
    assert.equal(segunda.status, 200);
    assert.equal(segunda.body.nova, false);

    const { rows } = await ctx.banco.query(
      "SELECT count(*)::int AS n FROM apolices WHERE endereco = $1",
      [apolice.toLowerCase()],
    );
    assert.equal(rows[0].n, 1);
  });

  describe("o que a verificacao precisa recusar", () => {
    test("transacao que ainda nao esta na rede", async () => {
      const proposta = await novaProposta();
      await preparar(proposta.id);

      const r = await confirmar(proposta.id, ethers.hexlify(ethers.randomBytes(32)));
      assert.equal(r.status, 409);
    });

    test("transacao revertida", async () => {
      const proposta = await novaProposta();
      const { hashTermos } = await preparar(proposta.id);
      const txHash = emitirNaCadeia({
        apolice: ethers.Wallet.createRandom().address,
        hashTermos,
        valor: 1_080_000_000_000_000_000n,
        status: 0,
      });

      const r = await confirmar(proposta.id, txHash);
      assert.equal(r.status, 400);
      assert.match(r.body.erro.mensagem, /revertida/);
    });

    test("evento emitido por um contrato que nao e a fabrica oficial", async () => {
      const proposta = await novaProposta();
      const { hashTermos } = await preparar(proposta.id);

      // Um contrato qualquer emite um evento com o mesmo nome e os mesmos campos.
      // O que prova a origem e o endereco de quem emitiu o log.
      const txHash = emitirNaCadeia({
        apolice: ethers.Wallet.createRandom().address,
        hashTermos,
        valor: 1_080_000_000_000_000_000n,
        de: "0x000000000000000000000000000000000000dead",
      });

      const r = await confirmar(proposta.id, txHash);
      assert.equal(r.status, 400);
      assert.match(r.body.erro.mensagem, /nao emitiu nenhuma apolice/);
    });

    test("resumo dos termos gravado no contrato diferente do gerado para a proposta", async () => {
      const proposta = await novaProposta();
      await preparar(proposta.id);

      const txHash = emitirNaCadeia({
        apolice: ethers.Wallet.createRandom().address,
        hashTermos: ethers.keccak256(ethers.toUtf8Bytes("termos adulterados")),
        valor: 1_080_000_000_000_000_000n,
      });

      const r = await confirmar(proposta.id, txHash);
      assert.equal(r.status, 400);
      assert.match(r.body.erro.mensagem, /resumo dos termos/);

      // A tentativa fica na trilha de auditoria, com a transacao correlacionada.
      const { rows } = await ctx.banco.query("SELECT acao FROM auditoria WHERE tx_hash = $1", [
        txHash,
      ]);
      assert.deepEqual(
        rows.map((l) => l.acao),
        ["emissao_recusada_hash_divergente"],
      );
    });

    test("beneficiario no contrato diferente do produtor da proposta", async () => {
      const proposta = await novaProposta();
      const { hashTermos } = await preparar(proposta.id);

      const txHash = emitirNaCadeia({
        apolice: ethers.Wallet.createRandom().address,
        hashTermos,
        valor: 1_080_000_000_000_000_000n,
        produtor: ethers.Wallet.createRandom().address,
      });

      const r = await confirmar(proposta.id, txHash);
      assert.equal(r.status, 400);
      assert.match(r.body.erro.mensagem, /carteira beneficiaria/);
    });

    test("limite no contrato diferente do cotado", async () => {
      const proposta = await novaProposta();
      const { hashTermos } = await preparar(proposta.id);

      const txHash = emitirNaCadeia({
        apolice: ethers.Wallet.createRandom().address,
        hashTermos,
        valor: 2_000_000_000_000_000_000n,
      });

      const r = await confirmar(proposta.id, txHash);
      assert.equal(r.status, 400);
      assert.match(r.body.erro.mensagem, /limite/);
    });

    test("confirmar sem ter preparado", async () => {
      const proposta = await novaProposta();
      const r = await confirmar(proposta.id, ethers.hexlify(ethers.randomBytes(32)));

      assert.equal(r.status, 409);
    });

    test("o produtor nao prepara nem confirma emissao", async () => {
      const proposta = await novaProposta();

      assert.equal(
        (await ctx.api().post(`/api/propostas/${proposta.id}/preparar`).set(com(produtor))).status,
        403,
      );
      assert.equal(
        (
          await ctx
            .api()
            .post(`/api/propostas/${proposta.id}/emissao`)
            .set(com(produtor))
            .send({ txHash: "0x" + "1".repeat(64) })
        ).status,
        403,
      );
    });
  });

  test("proposta recusada nao pode ser preparada", async () => {
    const proposta = await novaProposta();

    assert.equal(
      (await ctx.api().post(`/api/propostas/${proposta.id}/recusar`).set(com(seguradora))).status,
      204,
    );
    assert.equal(
      (await ctx.api().post(`/api/propostas/${proposta.id}/preparar`).set(com(seguradora))).status,
      409,
    );
  });
});
