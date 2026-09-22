import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";

import { gerarCodigoTotp } from "../src/seguranca/cripto.js";
import { com, entrar, montar } from "./ajuda.js";

/**
 * Autenticacao e controle de acesso (RF01, RF04, RNF24, HU13).
 */
describe("autenticacao", () => {
  let ctx;

  before(async () => {
    ctx = await montar();
  });

  after(() => ctx.fechar());

  test("login com credenciais corretas devolve token e usuario, sem hash", async () => {
    const r = await ctx
      .api()
      .post("/api/autenticacao/entrar")
      .send({ identificador: "produtor", senha: "agrosmart" });

    assert.equal(r.status, 200);
    assert.ok(r.body.token.length >= 40);
    assert.equal(r.body.usuario.perfil, "produtor");
    assert.equal(r.body.usuario.hash_senha, undefined);
    assert.equal(r.body.usuario.hashSenha, undefined);
  });

  test("senha errada e usuario inexistente respondem igual", async () => {
    const errada = await ctx
      .api()
      .post("/api/autenticacao/entrar")
      .send({ identificador: "produtor", senha: "x" });
    const inexistente = await ctx
      .api()
      .post("/api/autenticacao/entrar")
      .send({ identificador: "ninguem", senha: "x" });

    assert.equal(errada.status, 401);
    assert.equal(inexistente.status, 401);
    // A mesma mensagem nos dois casos: nao revela quais identificadores existem.
    assert.equal(errada.body.erro.mensagem, inexistente.body.erro.mensagem);
  });

  test("o identificador nao diferencia maiusculas", async () => {
    const r = await ctx
      .api()
      .post("/api/autenticacao/entrar")
      .send({ identificador: "PRODUTOR", senha: "agrosmart" });
    assert.equal(r.status, 200);
  });

  test("a senha fica guardada com bcrypt, nunca em texto claro (RNF24)", async () => {
    const { rows } = await ctx.banco.query(
      "SELECT hash_senha FROM usuarios WHERE identificador = 'produtor'",
    );

    assert.match(rows[0].hash_senha, /^\$2[aby]\$\d{2}\$/);
    assert.ok(!rows[0].hash_senha.includes("agrosmart"));
  });

  test("o banco guarda o resumo do token, nao o token", async () => {
    const token = await entrar(ctx.api, "produtor");
    const { rows } = await ctx.banco.query("SELECT hash_token FROM sessoes");

    assert.ok(rows.every((s) => s.hash_token !== token));
    assert.ok(rows.some((s) => s.hash_token.length === 64));
  });

  test("rota protegida sem token responde 401", async () => {
    const r = await ctx.api().get("/api/autenticacao/eu");
    assert.equal(r.status, 401);
  });

  test("rota de outro perfil responde 403 (RF04, HU13 criterio 4)", async () => {
    const token = await entrar(ctx.api, "produtor");
    const r = await ctx.api().get("/api/produtores").set(com(token));

    assert.equal(r.status, 403);
    assert.equal(r.body.erro.codigo, "sem_permissao");
  });

  test("sair revoga a sessao de imediato", async () => {
    const token = await entrar(ctx.api, "seguradora");

    assert.equal((await ctx.api().get("/api/autenticacao/eu").set(com(token))).status, 200);
    assert.equal((await ctx.api().post("/api/autenticacao/sair").set(com(token))).status, 204);
    assert.equal((await ctx.api().get("/api/autenticacao/eu").set(com(token))).status, 401);
  });

  test("sessao expirada e recusada (HU13 criterio 3)", async () => {
    const token = await entrar(ctx.api, "perito");
    await ctx.banco.query("UPDATE sessoes SET expira_em = now() - interval '1 second'");

    const r = await ctx.api().get("/api/autenticacao/eu").set(com(token));
    assert.equal(r.status, 401);
  });

  describe("segundo fator (RF01)", () => {
    let segredo;

    test("configurar exige confirmar um codigo antes de ativar", async () => {
      const token = await entrar(ctx.api, "seguradora");

      const inicio = await ctx.api().post("/api/autenticacao/totp/iniciar").set(com(token));
      assert.equal(inicio.status, 200);
      assert.match(inicio.body.uri, /^otpauth:\/\/totp\/AgroSmart:seguradora/);
      segredo = inicio.body.segredo;

      const errado = await ctx
        .api()
        .post("/api/autenticacao/totp/ativar")
        .set(com(token))
        .send({ codigo: "000000" });
      assert.equal(errado.status, 400);

      const certo = await ctx
        .api()
        .post("/api/autenticacao/totp/ativar")
        .set(com(token))
        .send({ codigo: await gerarCodigoTotp(segredo) });

      assert.equal(certo.status, 200);
      assert.equal(certo.body.segundoFatorAtivo, true);
    });

    test("o segredo fica cifrado no banco", async () => {
      const { rows } = await ctx.banco.query(
        "SELECT totp_segredo_cifrado FROM usuarios WHERE identificador = 'seguradora'",
      );

      assert.ok(rows[0].totp_segredo_cifrado);
      assert.ok(!rows[0].totp_segredo_cifrado.includes(segredo));
    });

    test("com o segundo fator ativo, a senha sozinha nao entra", async () => {
      const r = await ctx
        .api()
        .post("/api/autenticacao/entrar")
        .send({ identificador: "seguradora", senha: "agrosmart" });

      assert.equal(r.status, 200);
      assert.equal(r.body.segundoFatorPendente, true);
      assert.equal(r.body.usuario, undefined);

      // A sessao parcial nao serve para nada alem do codigo.
      const bloqueada = await ctx.api().get("/api/autenticacao/eu").set(com(r.body.token));
      assert.equal(bloqueada.status, 401);
    });

    test("codigo errado e recusado; codigo certo completa o login com token novo", async () => {
      const parcial = (
        await ctx
          .api()
          .post("/api/autenticacao/entrar")
          .send({ identificador: "seguradora", senha: "agrosmart" })
      ).body.token;

      const errado = await ctx
        .api()
        .post("/api/autenticacao/segundo-fator")
        .set(com(parcial))
        .send({ codigo: "123456" });
      assert.equal(errado.status, 401);

      const certo = await ctx
        .api()
        .post("/api/autenticacao/segundo-fator")
        .set(com(parcial))
        .send({ codigo: await gerarCodigoTotp(segredo) });

      assert.equal(certo.status, 200);
      assert.notEqual(certo.body.token, parcial);
      assert.equal(
        (await ctx.api().get("/api/autenticacao/eu").set(com(certo.body.token))).status,
        200,
      );

      // A sessao parcial morre quando a completa nasce.
      assert.equal(
        (
          await ctx
            .api()
            .post("/api/autenticacao/segundo-fator")
            .set(com(parcial))
            .send({ codigo: "000000" })
        ).status,
        401,
      );
    });
  });
});
