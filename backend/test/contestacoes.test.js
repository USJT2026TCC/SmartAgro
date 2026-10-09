import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";

import { ethers } from "ethers";

import { textoDoParecer } from "../src/rotas/contestacoes.js";
import { PRODUTOR_NA_CADEIA, com, entrar, idDoTalhao, montar } from "./ajuda.js";

/**
 * Contestacao da avaliacao automatica (RF28, UC14): produtor contesta, perito
 * decide, oraculo submete a retificacao.
 */

const APOLICE = "0x00000000000000000000000000000000000a9011";
const PERIODO = 20261020;
const HASH_LOTE = `0x${"ab".repeat(32)}`;
const CHAVE = { "X-Chave-De-Servico": "chave-de-teste" };

describe("contestacao (RF28)", () => {
  let ctx;
  let produtor;
  let perito;
  let seguradora;

  before(async () => {
    ctx = await montar();
    produtor = await entrar(ctx.api, "produtor");
    perito = await entrar(ctx.api, "perito");
    seguradora = await entrar(ctx.api, "seguradora");
  });

  after(() => ctx.fechar());

  /** Apolice ativa do produtor semeado, com o periodo publicado e o lote analisado. */
  beforeEach(async () => {
    const b = ctx.banco;
    await b.query("DELETE FROM contestacoes");
    await b.query("DELETE FROM publicacoes_oraculo");
    await b.query("DELETE FROM eventos_cadeia");
    await b.query("DELETE FROM notificacoes");
    await b.query("DELETE FROM apolices");

    const talhaoId = await idDoTalhao(b);
    await b.query(
      `INSERT INTO apolices (endereco, talhao_id, produtor_carteira, seguradora_carteira, talhao_bytes32,
                             hash_termos, valor_indenizacao_wei, tx_emissao, bloco_emissao, situacao)
       VALUES ($1, $2, $3, '0xseg', '0x', '0x', 1000, '0xtx', 1, 1)`,
      [APOLICE, talhaoId, PRODUTOR_NA_CADEIA],
    );
    await b.query(
      `INSERT INTO publicacoes_oraculo (apolice_endereco, periodo, tx_hash, indice_climatico, indice_dano_bps)
       VALUES ($1, $2, '0xpub', 3, 1200)`,
      [APOLICE, PERIODO],
    );

    const { rows } = await b.query(
      `INSERT INTO lotes_de_imagens (talhao_id, hash_evidencias, fechado_em) VALUES ($1, $2, now()) RETURNING id`,
      [talhaoId, HASH_LOTE],
    );
    await b.query(
      `INSERT INTO eventos_cadeia (contrato, nome, bloco, indice_log, tx_hash, argumentos)
       VALUES ($1, 'IndicesPublicados', 10, 0, '0xpub', $2)`,
      [
        APOLICE,
        JSON.stringify({
          periodo: String(PERIODO),
          indiceDanoBps: "1200",
          hashEvidencias: HASH_LOTE,
        }),
      ],
    );
    return rows[0].id;
  });

  const contestar = (corpo = {}) =>
    ctx
      .api()
      .post("/api/contestacoes")
      .set(com(produtor))
      .send({ apolice: APOLICE, periodo: PERIODO, motivo: "Metade da lavoura secou.", ...corpo });

  const decidir = (id, corpo) =>
    ctx.api().post(`/api/perito/contestacoes/${id}/parecer`).set(com(perito)).send(corpo);

  test("o produtor contesta o indice publicado, e o lote analisado fica ligado", async () => {
    const r = await contestar();
    assert.equal(r.status, 201);

    const { rows } = await ctx.banco.query("SELECT * FROM contestacoes WHERE id = $1", [
      r.body.contestacao.id,
    ]);
    assert.equal(rows[0].situacao, "aberta");
    assert.equal(rows[0].indice_original_bps, 1200);
    assert.ok(rows[0].lote_id, "o lote das evidencias deveria estar ligado");
  });

  test("uma contestacao por periodo, como o contrato aceita uma retificacao", async () => {
    assert.equal((await contestar()).status, 201);
    assert.equal((await contestar()).status, 409);
  });

  test("recusa periodo sem publicacao e apolice que nao esta ativa", async () => {
    assert.equal((await contestar({ periodo: 20261021 })).status, 404);

    await ctx.banco.query("UPDATE apolices SET situacao = 2");
    assert.equal((await contestar()).status, 409);
  });

  test("apolice de outro produtor responde como inexistente", async () => {
    await ctx.banco.query(
      "UPDATE apolices SET produtor_carteira = '0x0000000000000000000000000000000000000001'",
    );
    assert.equal((await contestar()).status, 404);
  });

  test("so o produtor contesta, e so o perito decide", async () => {
    const r = await ctx
      .api()
      .post("/api/contestacoes")
      .set(com(seguradora))
      .send({ apolice: APOLICE, periodo: PERIODO, motivo: "x" });
    assert.equal(r.status, 403);

    const { body } = await contestar();
    const s = await ctx
      .api()
      .post(`/api/perito/contestacoes/${body.contestacao.id}/parecer`)
      .set(com(seguradora))
      .send({ decisao: "indeferida", parecer: "x" });
    assert.equal(s.status, 403);
  });

  test("deferida: o resumo do parecer e o keccak do texto canonico, e vai para o oraculo", async () => {
    const { body } = await contestar();
    const id = body.contestacao.id;

    const r = await decidir(id, {
      decisao: "deferida",
      parecer: "Vistoria remota confirma 30% de area com estresse severo.",
      indiceRetificadoBps: 3000,
    });
    assert.equal(r.status, 200);

    const esperado = ethers.keccak256(
      ethers.toUtf8Bytes(
        textoDoParecer({
          contestacaoId: id,
          apolice: APOLICE,
          periodo: PERIODO,
          decisao: "deferida",
          indiceRetificadoBps: 3000,
          parecer: "Vistoria remota confirma 30% de area com estresse severo.",
        }),
      ),
    );
    assert.equal(r.body.hashParecer, esperado);

    const pendentes = await ctx.api().get("/api/oraculo/retificacoes-pendentes").set(CHAVE);
    assert.equal(pendentes.status, 200);
    assert.equal(pendentes.body.retificacoes.length, 1);
    assert.equal(pendentes.body.retificacoes[0].indice_retificado_bps, 3000);
    assert.equal(pendentes.body.retificacoes[0].hash_evidencias, HASH_LOTE);

    // O oraculo relata a transacao; a contestacao sai da fila.
    const tx = `0x${"cd".repeat(32)}`;
    const relato = await ctx
      .api()
      .post(`/api/oraculo/retificacoes/${id}`)
      .set(CHAVE)
      .send({ txHash: tx });
    assert.equal(relato.status, 200);

    const depois = await ctx.api().get("/api/oraculo/retificacoes-pendentes").set(CHAVE);
    assert.equal(depois.body.retificacoes.length, 0);

    // Relatar de novo e conflito, nao uma segunda publicacao.
    const repetido = await ctx
      .api()
      .post(`/api/oraculo/retificacoes/${id}`)
      .set(CHAVE)
      .send({ txHash: tx });
    assert.equal(repetido.status, 409);
  });

  test("deferida exige indice retificado diferente do publicado", async () => {
    const { body } = await contestar();

    const semIndice = await decidir(body.contestacao.id, { decisao: "deferida", parecer: "x" });
    assert.equal(semIndice.status, 400);

    const igual = await decidir(body.contestacao.id, {
      decisao: "deferida",
      parecer: "x",
      indiceRetificadoBps: 1200,
    });
    assert.equal(igual.status, 400);
  });

  test("indeferida: nada vai para a cadeia, e o produtor e avisado", async () => {
    const { body } = await contestar();

    const r = await decidir(body.contestacao.id, {
      decisao: "indeferida",
      parecer: "As imagens mostram a lavoura em bom estado.",
    });
    assert.equal(r.status, 200);

    const pendentes = await ctx.api().get("/api/oraculo/retificacoes-pendentes").set(CHAVE);
    assert.equal(pendentes.body.retificacoes.length, 0);

    const { rows } = await ctx.banco.query(
      "SELECT * FROM notificacoes WHERE tipo = 'contestacao_indeferida'",
    );
    assert.equal(rows.length, 1);

    // Um parecer por contestacao.
    const outra = await decidir(body.contestacao.id, { decisao: "indeferida", parecer: "y" });
    assert.equal(outra.status, 409);
  });

  test("o produtor ve so as proprias contestacoes; o perito ve todas", async () => {
    await contestar();

    const doProdutor = await ctx.api().get("/api/contestacoes").set(com(produtor));
    const doPerito = await ctx.api().get("/api/contestacoes").set(com(perito));

    assert.equal(doProdutor.body.contestacoes.length, 1);
    assert.equal(doPerito.body.contestacoes.length, 1);
    assert.equal(doPerito.body.contestacoes[0].talhao, "talhao-01");
  });

  test("as rotas do oraculo exigem a chave de servico", async () => {
    const r = await ctx.api().get("/api/oraculo/retificacoes-pendentes");
    assert.equal(r.status, 401);
  });
});
