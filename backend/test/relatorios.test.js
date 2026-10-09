import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";

import { PRODUTOR_NA_CADEIA, com, entrar, idDoTalhao, montar } from "./ajuda.js";

/**
 * Relatorio da carteira (RF29): filtros por periodo, cultura e regiao, e o tempo
 * medio de liquidacao.
 */

describe("relatorio da carteira (RF29)", () => {
  let ctx;
  let seguradora;
  let produtor;

  before(async () => {
    ctx = await montar();
    seguradora = await entrar(ctx.api, "seguradora");
    produtor = await entrar(ctx.api, "produtor");

    const b = ctx.banco;
    const talhaoId = await idDoTalhao(b);

    // Duas apolices de soja em Sao Simao: uma paga, uma ativa; e uma emitida
    // por script, sem talhao conhecido.
    const apolice = (endereco, situacao, pago, periodo, emitida, talhao = talhaoId) =>
      b.query(
        `INSERT INTO apolices (endereco, talhao_id, produtor_carteira, seguradora_carteira, talhao_bytes32,
                               hash_termos, valor_indenizacao_wei, tx_emissao, bloco_emissao, situacao,
                               valor_pago_wei, periodo_acionador, emitida_em)
         VALUES ($1, $2, $3, '0xseg', '0x', '0x', 1000, $1, 1, $4, $5, $6, $7)`,
        [endereco, talhao, PRODUTOR_NA_CADEIA, situacao, pago, periodo, emitida],
      );

    await apolice("0xa1", 2, 1000, 20260820, "2026-08-01T12:00:00Z");
    await apolice("0xa2", 1, 0, null, "2026-09-10T12:00:00Z");
    await apolice("0xa3", 4, 0, null, "2026-09-15T12:00:00Z", null);

    // Pagamento na cadeia 6 horas depois do fim do dia 20/08.
    await b.query(
      `INSERT INTO eventos_cadeia (contrato, nome, bloco, indice_log, tx_hash, argumentos, instante)
       VALUES ('0xa1', 'PagamentoExecutado', 5, 0, '0xpag', '{}', '2026-08-21T06:00:00Z')`,
    );
  });

  after(() => ctx.fechar());

  const relatorio = (q = "") => ctx.api().get(`/api/relatorios/carteira${q}`).set(com(seguradora));

  test("sem filtro: toda a carteira, com canceladas e tempo de liquidacao", async () => {
    const r = await relatorio();
    assert.equal(r.status, 200);

    assert.equal(r.body.carteira.apolices, 3);
    assert.equal(r.body.carteira.liquidadas, 1);
    assert.equal(r.body.carteira.canceladas, 1);
    assert.equal(r.body.carteira.pago_total_wei, "1000");

    assert.equal(r.body.liquidacao.pagamentos, 1);
    assert.equal(r.body.liquidacao.media_horas, 6);

    assert.ok(r.body.opcoesDeFiltro.culturas.includes("soja"));
    assert.ok(r.body.opcoesDeFiltro.regioes.length > 0);
  });

  test("filtro por periodo de emissao", async () => {
    const r = await relatorio("?de=2026-09-01&ate=2026-09-30");
    assert.equal(r.body.carteira.apolices, 2);
    assert.equal(r.body.carteira.liquidadas, 0);
    assert.equal(r.body.liquidacao.pagamentos, 0);
  });

  test("filtro por cultura e por regiao, com quebra por cada uma", async () => {
    const { rows } = await ctx.banco.query(
      "SELECT pr.municipio FROM talhoes t JOIN propriedades pr ON pr.id = t.propriedade_id WHERE t.identificador = 'talhao-01'",
    );
    const municipio = rows[0].municipio;

    const porCultura = await relatorio("?cultura=soja");
    assert.equal(porCultura.body.carteira.apolices, 2, "a emitida sem talhao nao tem cultura");

    const porRegiao = await relatorio(`?regiao=${encodeURIComponent(municipio)}`);
    assert.equal(porRegiao.body.carteira.apolices, 2);

    const nenhuma = await relatorio("?cultura=milho");
    assert.equal(nenhuma.body.carteira.apolices, 0);

    const geral = await relatorio();
    assert.deepEqual(
      geral.body.porCultura.map((c) => [c.cultura, c.apolices]),
      [
        ["sem talhao", 1],
        ["soja", 2],
      ],
    );
  });

  test("datas mal formadas sao recusadas, e so a seguradora ve o relatorio", async () => {
    assert.equal((await relatorio("?de=01/09/2026")).status, 400);

    const r = await ctx.api().get("/api/relatorios/carteira").set(com(produtor));
    assert.equal(r.status, 403);
  });
});
