import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";

import { carteiraAleatoria, com, entrar, montar } from "./ajuda.js";

/**
 * Vinculo da carteira por assinatura, verificado no servidor (RF02, HU07).
 */
describe("vinculo da carteira", () => {
  let ctx;
  let token;

  before(async () => {
    ctx = await montar();
    token = await entrar(ctx.api, "produtor");
  });

  after(() => ctx.fechar());

  async function pedirDesafio() {
    const r = await ctx.api().post("/api/carteira/desafio").set(com(token));
    assert.equal(r.status, 201);
    return r.body;
  }

  test("o desafio traz um numero unico e prazo de validade (HU07 criterio 1)", async () => {
    const a = await pedirDesafio();
    const b = await pedirDesafio();

    assert.match(a.mensagem, /numero unico: 0x[0-9a-f]{32}/);
    assert.notEqual(a.mensagem, b.mensagem);
    assert.ok(new Date(a.expiraEm) > new Date());
  });

  test("assinatura correta vincula o endereco que assinou (HU07 criterio 2)", async () => {
    const carteira = carteiraAleatoria();
    const { desafioId, mensagem } = await pedirDesafio();

    const r = await ctx
      .api()
      .post("/api/carteira/vincular")
      .set(com(token))
      .send({
        desafioId,
        endereco: carteira.address,
        assinatura: await carteira.signMessage(mensagem),
      });

    assert.equal(r.status, 200);
    assert.equal(r.body.carteira, carteira.address.toLowerCase());

    const eu = await ctx.api().get("/api/autenticacao/eu").set(com(token));
    assert.equal(eu.body.usuario.carteira, carteira.address.toLowerCase());
  });

  test("o mesmo desafio nao pode ser usado duas vezes", async () => {
    const carteira = carteiraAleatoria();
    const { desafioId, mensagem } = await pedirDesafio();
    const assinatura = await carteira.signMessage(mensagem);
    const pedido = { desafioId, endereco: carteira.address, assinatura };

    assert.equal(
      (await ctx.api().post("/api/carteira/vincular").set(com(token)).send(pedido)).status,
      200,
    );

    const repetido = await ctx.api().post("/api/carteira/vincular").set(com(token)).send(pedido);
    assert.equal(repetido.status, 409);
  });

  test("assinatura sobre outra mensagem e recusada, em vez de vincular um endereco sem dono", async () => {
    const carteira = carteiraAleatoria();
    const { desafioId } = await pedirDesafio();

    // A recuperacao de chave sempre devolve ALGUM endereco. Sem a conferencia
    // contra o endereco declarado, esta assinatura vincularia o produtor a um
    // endereco que ninguem controla, e a indenizacao seria paga para o vazio.
    const r = await ctx
      .api()
      .post("/api/carteira/vincular")
      .set(com(token))
      .send({
        desafioId,
        endereco: carteira.address,
        assinatura: await carteira.signMessage("outra mensagem"),
      });

    assert.equal(r.status, 400);
    assert.match(r.body.erro.mensagem, /nao foi feita pela carteira informada/);
  });

  test("assinatura valida de uma carteira nao vincula outra carteira declarada", async () => {
    const quemAssina = carteiraAleatoria();
    const declarada = carteiraAleatoria();
    const { desafioId, mensagem } = await pedirDesafio();

    const r = await ctx
      .api()
      .post("/api/carteira/vincular")
      .set(com(token))
      .send({
        desafioId,
        endereco: declarada.address,
        assinatura: await quemAssina.signMessage(mensagem),
      });

    assert.equal(r.status, 400);
  });

  test("desafio expirado e recusado", async () => {
    const carteira = carteiraAleatoria();
    const { desafioId, mensagem } = await pedirDesafio();
    await ctx.banco.query(
      "UPDATE desafios_carteira SET expira_em = now() - interval '1 second' WHERE id = $1",
      [desafioId],
    );

    const r = await ctx
      .api()
      .post("/api/carteira/vincular")
      .set(com(token))
      .send({
        desafioId,
        endereco: carteira.address,
        assinatura: await carteira.signMessage(mensagem),
      });

    assert.equal(r.status, 400);
  });

  test("carteira ja vinculada a outro usuario e recusada (HU07 criterio 4)", async () => {
    // O produtor semeado ja tem a carteira da conta 1 do hardhat. Um segundo
    // produtor tenta vincular a mesma.
    const { gerarHashDeSenha } = await import("../src/seguranca/cripto.js");
    await ctx.banco.query(
      "INSERT INTO usuarios (identificador, nome, perfil, hash_senha, carteira) VALUES ('p2', 'P2', 'produtor', $1, $2)",
      [await gerarHashDeSenha("x"), "0x1111111111111111111111111111111111111111"],
    );

    const carteira = carteiraAleatoria();
    const { desafioId, mensagem } = await pedirDesafio();
    await ctx
      .api()
      .post("/api/carteira/vincular")
      .set(com(token))
      .send({
        desafioId,
        endereco: carteira.address,
        assinatura: await carteira.signMessage(mensagem),
      });

    const tokenP2 = await entrar(ctx.api, "p2", "x");
    const desafio2 = (await ctx.api().post("/api/carteira/desafio").set(com(tokenP2))).body;

    const r = await ctx
      .api()
      .post("/api/carteira/vincular")
      .set(com(tokenP2))
      .send({
        desafioId: desafio2.desafioId,
        endereco: carteira.address,
        assinatura: await carteira.signMessage(desafio2.mensagem),
      });

    assert.equal(r.status, 409);
  });

  test("a chave privada nunca e pedida nem aceita (RNF17)", async () => {
    const { desafioId } = await pedirDesafio();
    const r = await ctx
      .api()
      .post("/api/carteira/vincular")
      .set(com(token))
      .send({ desafioId, chavePrivada: carteiraAleatoria().privateKey });

    // Sem assinatura, o pedido e invalido — nao existe caminho que aceite chave.
    assert.equal(r.status, 400);
  });

  test("seguradora nao vincula carteira por esta rota", async () => {
    const tokenSeguradora = await entrar(ctx.api, "seguradora");
    assert.equal(
      (await ctx.api().post("/api/carteira/desafio").set(com(tokenSeguradora))).status,
      403,
    );
  });
});
