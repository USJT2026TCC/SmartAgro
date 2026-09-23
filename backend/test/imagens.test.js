import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { after, before, describe, test } from "node:test";

import { resumirEvidencias } from "../src/rotas/imagens.js";
import { sha256Hex } from "../src/seguranca/cripto.js";
import { com, entrar, idDoTalhao, montar } from "./ajuda.js";

/**
 * Imagens georreferenciadas, visao computacional e revisao do perito
 * (RF14, RF16, RF17).
 */

/** PNG minimo valido: assinatura de 8 bytes seguida de conteudo qualquer. */
const png = (sufixo) =>
  Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from(`conteudo-${sufixo}`),
  ]);

describe("imagens e visao", () => {
  let ctx;
  let produtor;
  let perito;
  let talhaoId;
  const CHAVE = { "X-Chave-De-Servico": "chave-de-teste" };

  before(async () => {
    ctx = await montar();
    produtor = await entrar(ctx.api, "produtor");
    perito = await entrar(ctx.api, "perito");
    talhaoId = await idDoTalhao(ctx.banco);
  });

  after(() => ctx.fechar());

  async function abrirLote() {
    const r = await ctx.api().post(`/api/talhoes/${talhaoId}/lotes`).set(com(produtor));
    assert.equal(r.status, 201);
    return r.body.lote.id;
  }

  function enviarImagem(
    loteId,
    { conteudo = png(Math.random()), lon = -47.58, lat = -21.46, tipo = "image/png" } = {},
  ) {
    return ctx
      .api()
      .post(`/api/lotes/${loteId}/imagens`)
      .set(com(produtor))
      .field("lon", String(lon))
      .field("lat", String(lat))
      .field("capturadaEm", "2026-09-20T10:00:00.000Z")
      .attach("imagem", conteudo, { filename: "foto.png", contentType: tipo });
  }

  test("imagem dentro do poligono do talhao e aceita", async () => {
    const r = await enviarImagem(await abrirLote());

    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.match(r.body.imagem.sha256, /^[0-9a-f]{64}$/);
  });

  test("imagem fora do poligono e recusada pelo PostGIS (RF14, HU11 criterio 1)", async () => {
    const r = await enviarImagem(await abrirLote(), { lon: -47.7, lat: -21.46 });

    assert.equal(r.status, 400);
    assert.match(r.body.erro.mensagem, /fora do poligono/);
  });

  test("imagem sem geolocalizacao e recusada", async () => {
    const r = await ctx
      .api()
      .post(`/api/lotes/${await abrirLote()}/imagens`)
      .set(com(produtor))
      .field("capturadaEm", "2026-09-20T10:00:00.000Z")
      .attach("imagem", png("x"), { filename: "foto.png", contentType: "image/png" });

    assert.equal(r.status, 400);
    assert.match(r.body.erro.mensagem, /geolocalizacao/);
  });

  test("arquivo rotulado como PNG que nao e imagem e recusado", async () => {
    const r = await enviarImagem(await abrirLote(), {
      conteudo: Buffer.from("isto e um texto qualquer"),
    });

    assert.equal(r.status, 400);
    assert.match(r.body.erro.mensagem, /nao corresponde a uma imagem/);
  });

  test("o resumo das evidencias depende do conjunto de imagens, nao da ordem de envio (RF16)", () => {
    const a = "a".repeat(64);
    const b = "b".repeat(64);

    assert.equal(resumirEvidencias([a, b]), resumirEvidencias([b, a]));
    assert.notEqual(resumirEvidencias([a, b]), resumirEvidencias([a]));
    assert.match(resumirEvidencias([a]), /^0x[0-9a-f]{64}$/);
  });

  test("fechar o lote calcula o resumo e impede novos envios", async () => {
    const lote = await abrirLote();
    await enviarImagem(lote);
    await enviarImagem(lote);

    const r = await ctx.api().post(`/api/lotes/${lote}/fechar`).set(com(produtor));
    assert.equal(r.status, 200);
    assert.equal(r.body.lote.imagens, 2);
    assert.match(r.body.lote.hashEvidencias, /^0x[0-9a-f]{64}$/);

    assert.equal((await enviarImagem(lote)).status, 409);
  });

  test("lote vazio nao fecha", async () => {
    const r = await ctx
      .api()
      .post(`/api/lotes/${await abrirLote()}/fechar`)
      .set(com(produtor));
    assert.equal(r.status, 400);
  });

  describe("o modulo de visao busca o que analisar", () => {
    test("so lote fechado e sem analise aparece como pendente", async () => {
      const aberto = await abrirLote();
      await enviarImagem(aberto);

      const fechado = await abrirLote();
      await enviarImagem(fechado);
      await ctx.api().post(`/api/lotes/${fechado}/fechar`).set(com(produtor));

      const r = await ctx.api().get("/api/visao/pendentes").set(CHAVE);

      assert.equal(r.status, 200);

      const ids = r.body.lotes.map((l) => l.id);
      assert.ok(ids.includes(fechado), "o lote fechado precisa aparecer");
      assert.ok(!ids.includes(aberto), "lote ainda aberto nao pode ser analisado");

      const pendente = r.body.lotes.find((l) => l.id === fechado);
      assert.equal(pendente.talhao, "talhao-01");
      assert.equal(pendente.imagens.length, 1);
      assert.match(pendente.hash_evidencias, /^0x[0-9a-f]{64}$/);
    });

    test("o arquivo da imagem e servido para a chave de servico, e so para ela", async () => {
      const lote = await abrirLote();
      const envio = await enviarImagem(lote);
      await ctx.api().post(`/api/lotes/${lote}/fechar`).set(com(produtor));

      const imagemId = envio.body.imagem.id;

      assert.equal((await ctx.api().get(`/api/visao/imagens/${imagemId}/arquivo`)).status, 401);

      const r = await ctx.api().get(`/api/visao/imagens/${imagemId}/arquivo`).set(CHAVE);

      assert.equal(r.status, 200);
      assert.equal(sha256Hex(r.body), envio.body.imagem.sha256);
    });

    test("arquivo adulterado em disco nao e entregue como evidencia", async () => {
      const lote = await abrirLote();
      const envio = await enviarImagem(lote);
      await ctx.api().post(`/api/lotes/${lote}/fechar`).set(com(produtor));

      const { rows } = await ctx.banco.query("SELECT caminho FROM imagens WHERE id = $1", [
        envio.body.imagem.id,
      ]);
      writeFileSync(rows[0].caminho, png(0.123456));

      const r = await ctx.api().get(`/api/visao/imagens/${envio.body.imagem.id}/arquivo`).set(CHAVE);

      assert.equal(r.status, 409, JSON.stringify(r.body));
    });
  });

  describe("baixa confianca vai para o perito (RF17)", () => {
    let lote;
    let analiseId;

    before(async () => {
      lote = await abrirLote();
      await enviarImagem(lote);
      await ctx.api().post(`/api/lotes/${lote}/fechar`).set(com(produtor));
    });

    test("resultado com confianca abaixo do limiar e encaminhado e o perito e notificado", async () => {
      const r = await ctx.api().post("/api/visao/resultados").set(CHAVE).send({
        loteId: lote,
        indiceDano: 0.42,
        confianca: 0.55,
        versaoModelo: "visao-agrosmart-v1.0.0",
      });

      assert.equal(r.status, 201);
      assert.equal(r.body.analise.indiceDanoBps, 4200);
      assert.equal(r.body.analise.encaminhadaAoPerito, true);
      analiseId = r.body.analise.id;

      const notificacoes = await ctx.api().get("/api/notificacoes").set(com(perito));
      assert.ok(notificacoes.body.notificacoes.some((n) => n.tipo === "revisao_pendente"));
    });

    test("enquanto o perito nao libera, o indice de dano nao chega ao oraculo", async () => {
      const r = await ctx.api().get("/api/oraculo/visao?talhao=talhao-01&ate=29991231").set(CHAVE);

      assert.equal(r.status, 200);
      assert.equal(r.body.visao, null);
    });

    test("rejeitada pelo perito, continua retida", async () => {
      const outro = await abrirLote();
      await enviarImagem(outro);
      await ctx.api().post(`/api/lotes/${outro}/fechar`).set(com(produtor));

      const analise = (
        await ctx.api().post("/api/visao/resultados").set(CHAVE).send({
          loteId: outro,
          indiceDano: 0.9,
          confianca: 0.3,
          versaoModelo: "visao-agrosmart-v1.0.0",
        })
      ).body.analise;

      const parecer = await ctx
        .api()
        .post(`/api/perito/analises/${analise.id}/parecer`)
        .set(com(perito))
        .send({ decisao: "rejeitada", parecer: "Sombra de nuvem interpretada como dano." });

      assert.equal(parecer.status, 200);

      const r = await ctx.api().get("/api/oraculo/visao?talhao=talhao-01&ate=29991231").set(CHAVE);
      assert.equal(r.body.visao, null);
    });

    test("liberada pelo perito, segue para o oraculo com versao do modelo e resumo das evidencias", async () => {
      const parecer = await ctx
        .api()
        .post(`/api/perito/analises/${analiseId}/parecer`)
        .set(com(perito))
        .send({ decisao: "liberada", parecer: "Dano confirmado pela inspecao das imagens." });

      assert.equal(parecer.status, 200);

      const r = await ctx.api().get("/api/oraculo/visao?talhao=talhao-01&ate=29991231").set(CHAVE);
      assert.equal(r.body.visao.indiceDanoBps, 4200);
      assert.equal(r.body.visao.versaoModelo, "visao-agrosmart-v1.0.0");
      assert.match(r.body.visao.hashEvidencias, /^0x[0-9a-f]{64}$/);
      assert.match(r.body.visao.hashVersaoModelo, /^0x[0-9a-f]{64}$/);
      assert.equal(r.body.visao.liberadaPeloPerito, true);
    });

    test("uma analise nao recebe dois pareceres", async () => {
      const r = await ctx
        .api()
        .post(`/api/perito/analises/${analiseId}/parecer`)
        .set(com(perito))
        .send({ decisao: "rejeitada", parecer: "mudei de ideia" });

      assert.equal(r.status, 409);
    });
  });

  test("resultado com confianca alta segue direto, sem perito", async () => {
    const lote = await abrirLote();
    await enviarImagem(lote);
    await ctx.api().post(`/api/lotes/${lote}/fechar`).set(com(produtor));

    const r = await ctx.api().post("/api/visao/resultados").set(CHAVE).send({
      loteId: lote,
      indiceDano: 0.6,
      confianca: 0.93,
      versaoModelo: "visao-agrosmart-v1.1.0",
    });

    assert.equal(r.body.analise.encaminhadaAoPerito, false);

    const visao = await ctx
      .api()
      .get("/api/oraculo/visao?talhao=talhao-01&ate=29991231")
      .set(CHAVE);
    assert.equal(visao.body.visao.indiceDanoBps, 6000);
  });
});
