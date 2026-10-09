import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";

import { com, entrar, montar } from "./ajuda.js";

/**
 * Cadastro georreferenciado e produtos (RF03, RF05, RF11, HU09).
 */
describe("cadastro", () => {
  let ctx;
  let seguradora;
  let produtor;
  let produtorId;

  const QUADRADO = [
    [-47.81, -21.17],
    [-47.79, -21.17],
    [-47.79, -21.19],
    [-47.81, -21.19],
  ];

  before(async () => {
    ctx = await montar();
    seguradora = await entrar(ctx.api, "seguradora");
    produtor = await entrar(ctx.api, "produtor");
    produtorId = (await ctx.banco.query("SELECT id FROM usuarios WHERE identificador = 'produtor'"))
      .rows[0].id;
  });

  after(() => ctx.fechar());

  const novoTalhao = (extra = {}) => ({
    produtorId,
    identificador: `t-${Math.random().toString(36).slice(2, 8)}`,
    cultura: "soja",
    propriedade: { nome: "Fazenda Santa Clara", municipio: "Ribeirao Preto/SP" },
    poligono: QUADRADO,
    ...extra,
  });

  describe("talhoes (RF03, HU09)", () => {
    test("a area e medida pelo PostGIS sobre o elipsoide, e nao informada", async () => {
      const r = await ctx.api().post("/api/talhoes").set(com(seguradora)).send(novoTalhao());

      assert.equal(r.status, 201);

      // 0,02 x 0,02 grau a 21 graus sul. Sobre o elipsoide da ~459,9 ha; a
      // aproximacao plana que o aplicativo usava dava 492,8 ha, 7% a mais.
      const area = Number(r.body.talhao.areaHa);
      assert.ok(area > 459 && area < 461, `area medida: ${area}`);
    });

    test("o anel e fechado automaticamente e aceito tambem como GeoJSON", async () => {
      const r = await ctx
        .api()
        .post("/api/talhoes")
        .set(com(seguradora))
        .send(
          novoTalhao({ poligono: { type: "Polygon", coordinates: [[...QUADRADO, QUADRADO[0]]] } }),
        );

      assert.equal(r.status, 201);
      assert.equal(r.body.talhao.poligono.type, "Polygon");
    });

    test("poligono com autointersecao e recusado pelo banco (HU09 criterio 3)", async () => {
      const gravata = [
        [-47.81, -21.17],
        [-47.79, -21.19],
        [-47.79, -21.17],
        [-47.81, -21.19],
      ];

      const r = await ctx
        .api()
        .post("/api/talhoes")
        .set(com(seguradora))
        .send(novoTalhao({ poligono: gravata }));

      assert.equal(r.status, 400);
      assert.match(r.body.erro.mensagem, /cruza a si mesmo/);
    });

    test("coordenada fora da faixa e recusada com mensagem clara", async () => {
      const r = await ctx
        .api()
        .post("/api/talhoes")
        .set(com(seguradora))
        .send(
          novoTalhao({
            poligono: [
              [-200, 0],
              [0, 0],
              [0, 1],
            ],
          }),
        );

      assert.equal(r.status, 400);
      assert.match(r.body.erro.mensagem, /faixa/);
    });

    test("identificador acima de 31 bytes e recusado, porque vai para a cadeia como bytes32", async () => {
      const r = await ctx
        .api()
        .post("/api/talhoes")
        .set(com(seguradora))
        .send(novoTalhao({ identificador: "a".repeat(32) }));

      assert.equal(r.status, 400);
    });

    test("identificador repetido e recusado com 409", async () => {
      const r = await ctx
        .api()
        .post("/api/talhoes")
        .set(com(seguradora))
        .send(novoTalhao({ identificador: "talhao-01" }));
      assert.equal(r.status, 409);
    });

    test("o produtor ve apenas os proprios talhoes e nao cadastra", async () => {
      const lista = await ctx.api().get("/api/talhoes").set(com(produtor));
      assert.equal(lista.status, 200);
      assert.ok(lista.body.talhoes.every((t) => t.produtor.id === produtorId));

      const cadastro = await ctx.api().post("/api/talhoes").set(com(produtor)).send(novoTalhao());
      assert.equal(cadastro.status, 403);
    });

    test("o talhao indica se atende o minimo de fontes independentes (RNF16)", async () => {
      const { body } = await ctx.api().get("/api/talhoes").set(com(seguradora));
      const t1 = body.talhoes.find((t) => t.identificador === "talhao-01");
      const t2 = body.talhoes.find((t) => t.identificador === "talhao-02");

      assert.equal(t1.atendeMinimoDeFontes, true);
      assert.equal(t2.atendeMinimoDeFontes, false);
    });
  });

  describe("produtos (RF05)", () => {
    const produto = (extra = {}) => ({
      nome: "Estiagem — cafe",
      cultura: "cafe",
      operador: 0,
      modoPagamento: 0,
      limiarClimatico: 25,
      valorPorHectareEth: "0.007",
      taxaPremioPct: "4.25",
      vigenciaDias: 200,
      ...extra,
    });

    test("valor por hectare e taxa viram inteiros exatos (wei e pontos-base)", async () => {
      const r = await ctx.api().post("/api/produtos").set(com(seguradora)).send(produto());

      assert.equal(r.status, 201);
      assert.equal(r.body.produto.valorPorHectareWei, "7000000000000000");
      assert.equal(r.body.produto.taxaPremioBps, 425);
    });

    test("o banco recusa o que o construtor do contrato recusaria", async () => {
      const tetoIgual = await ctx
        .api()
        .post("/api/produtos")
        .set(com(seguradora))
        .send(produto({ modoPagamento: 1, limiarClimatico: 30, limiarClimaticoIntegral: 30 }));

      assert.equal(tetoIgual.status, 400);
      assert.match(tetoIgual.body.erro.mensagem, /maiores que o gatilho/);

      const semGatilhoDeDano = await ctx
        .api()
        .post("/api/produtos")
        .set(com(seguradora))
        .send(produto({ operador: 2 }));
      assert.equal(semGatilhoDeDano.status, 400);
    });

    test("retirar o produto o esconde da contratacao sem apagar a referencia", async () => {
      const criado = (
        await ctx
          .api()
          .post("/api/produtos")
          .set(com(seguradora))
          .send(produto({ nome: "Temporario" }))
      ).body.produto;

      assert.equal(
        (await ctx.api().delete(`/api/produtos/${criado.id}`).set(com(seguradora))).status,
        204,
      );

      const lista = await ctx.api().get("/api/produtos").set(com(produtor));
      assert.ok(!lista.body.produtos.some((p) => p.id === criado.id));

      const { rows } = await ctx.banco.query("SELECT ativo FROM produtos WHERE id = $1", [
        criado.id,
      ]);
      assert.equal(rows[0].ativo, false);
    });
  });

  describe("fontes (RF11)", () => {
    test("registra a fonte com a chave publica que assina os lotes", async () => {
      const { rows } = await ctx.banco.query(
        "SELECT id FROM talhoes WHERE identificador = 'talhao-02'",
      );

      const r = await ctx.api().post("/api/fontes").set(com(seguradora)).send({
        id: "estacao-milho-01",
        talhaoId: rows[0].id,
        tipo: "estacao",
        endereco: "0x2222222222222222222222222222222222222222",
        lon: -47.77,
        lat: -21.17,
      });

      assert.equal(r.status, 201);

      const lista = await ctx.api().get(`/api/fontes?talhaoId=${rows[0].id}`).set(com(seguradora));
      assert.equal(lista.body.fontes.length, 1);
      assert.equal(Number(lista.body.fontes[0].escore), 1);
    });

    test("o mesmo endereco nao assina por duas fontes", async () => {
      const { rows } = await ctx.banco.query(
        "SELECT id FROM talhoes WHERE identificador = 'talhao-02'",
      );

      const r = await ctx.api().post("/api/fontes").set(com(seguradora)).send({
        id: "estacao-milho-02",
        talhaoId: rows[0].id,
        tipo: "estacao",
        endereco: "0x2222222222222222222222222222222222222222",
      });

      assert.equal(r.status, 409);
    });
  });
  describe("produtores e propriedades (RF03)", () => {
    test("a seguradora cadastra um produtor, que consegue entrar com a senha inicial", async () => {
      const r = await ctx.api().post("/api/produtores").set(com(seguradora)).send({
        identificador: "maria.silva",
        nome: "Maria Silva",
        documento: "52998224725",
        senhaInicial: "senha-inicial-123",
      });
      assert.equal(r.status, 201, JSON.stringify(r.body));
      assert.equal(r.body.produtor.identificador, "maria.silva");
      assert.equal(r.body.produtor.documento, "529.982.247-25", "guardado sempre formatado");
      assert.equal(r.body.produtor.hash_senha, undefined, "o hash nunca sai da API");

      const login = await ctx
        .api()
        .post("/api/autenticacao/entrar")
        .send({ identificador: "maria.silva", senha: "senha-inicial-123" });
      assert.equal(login.status, 200);
      assert.equal(login.body.usuario.perfil, "produtor");
    });

    test("identificador repetido, invalido ou senha curta sao recusados", async () => {
      const enviar = (corpo) =>
        ctx
          .api()
          .post("/api/produtores")
          .set(com(seguradora))
          .send({ nome: "X", senhaInicial: "senha-longa-123", ...corpo });

      assert.equal((await enviar({ identificador: "produtor" })).status, 409);
      assert.equal((await enviar({ identificador: "Com Espaco" })).status, 400);
      assert.equal((await enviar({ identificador: "curta", senhaInicial: "123" })).status, 400);
    });

    test("CPF ou CNPJ com digito verificador errado e recusado, com o motivo", async () => {
      const enviar = (documento) =>
        ctx
          .api()
          .post("/api/produtores")
          .set(com(seguradora))
          .send({
            identificador: `doc-${documento.replace(/\D/g, "")}`,
            nome: "X",
            senhaInicial: "senha-longa-123",
            documento,
          });

      for (const [documento, motivo] of [
        ["123", /11 digitos/],
        ["529.982.247-26", /CPF invalido/],
        ["999.999.999-99", /digitos iguais/],
        ["11.222.333/0001-80", /CNPJ invalido/],
      ]) {
        const r = await enviar(documento);
        assert.equal(r.status, 400, documento);
        assert.match(r.body.erro.mensagem, motivo);
      }

      const edicao = await ctx
        .api()
        .patch(`/api/produtores/${produtorId}`)
        .set(com(seguradora))
        .send({ documento: "000.000.000-00" });
      assert.equal(edicao.status, 400);
    });

    test("so a seguradora cadastra ou edita produtores", async () => {
      const r = await ctx
        .api()
        .post("/api/produtores")
        .set(com(produtor))
        .send({ identificador: "outro", nome: "Outro", senhaInicial: "senha-longa-123" });
      assert.equal(r.status, 403);
    });

    test("edita nome e documento do produtor, e nome e municipio da propriedade", async () => {
      const r = await ctx
        .api()
        .patch(`/api/produtores/${produtorId}`)
        .set(com(seguradora))
        .send({ documento: "11.222.333/0001-81" });
      assert.equal(r.status, 200);
      assert.equal(r.body.produtor.documento, "11.222.333/0001-81");
      assert.ok(r.body.produtor.nome, "o nome nao enviado e mantido");

      const lista = await ctx.api().get("/api/propriedades").set(com(seguradora));
      const prop = lista.body.propriedades[0];
      const e = await ctx
        .api()
        .patch(`/api/propriedades/${prop.id}`)
        .set(com(seguradora))
        .send({ municipio: "Cravinhos/SP" });
      assert.equal(e.status, 200);
      assert.equal(e.body.propriedade.municipio, "Cravinhos/SP");
      assert.equal(e.body.propriedade.nome, prop.nome);
    });
  });

  describe("edicao de talhao (RF03)", () => {
    test("talhao sem proposta: troca o poligono e a area e recalculada pelo PostGIS", async () => {
      const criado = await ctx.api().post("/api/talhoes").set(com(seguradora)).send(novoTalhao());
      const id = criado.body.talhao.id;

      const metade = [
        [-47.81, -21.17],
        [-47.8, -21.17],
        [-47.8, -21.19],
        [-47.81, -21.19],
      ];
      const r = await ctx
        .api()
        .patch(`/api/talhoes/${id}`)
        .set(com(seguradora))
        .send({ poligono: metade, cultura: "Milho" });

      assert.equal(r.status, 200, JSON.stringify(r.body));
      assert.equal(r.body.talhao.cultura, "milho");
      const razao = Number(r.body.talhao.areaHa) / Number(criado.body.talhao.areaHa);
      assert.ok(Math.abs(razao - 0.5) < 0.01, `razao das areas: ${razao}`);
    });

    test("talhao com proposta ou apolice nao pode mudar", async () => {
      const { rows } = await ctx.banco.query(
        "SELECT id FROM talhoes WHERE identificador = 'talhao-01'",
      );
      await ctx.banco.query(
        `INSERT INTO apolices (endereco, talhao_id, produtor_carteira, seguradora_carteira, talhao_bytes32,
                               hash_termos, valor_indenizacao_wei, tx_emissao, bloco_emissao)
         VALUES ('0xedicao', $1, '0xp', '0xs', '0x', '0x', 1, '0xtx', 1)`,
        [rows[0].id],
      );

      const r = await ctx
        .api()
        .patch(`/api/talhoes/${rows[0].id}`)
        .set(com(seguradora))
        .send({ cultura: "milho" });
      assert.equal(r.status, 409);
    });

    test("poligono com autointersecao tambem e recusado na edicao", async () => {
      const criado = await ctx.api().post("/api/talhoes").set(com(seguradora)).send(novoTalhao());
      const gravata = [
        [-47.81, -21.17],
        [-47.79, -21.19],
        [-47.79, -21.17],
        [-47.81, -21.19],
      ];
      const r = await ctx
        .api()
        .patch(`/api/talhoes/${criado.body.talhao.id}`)
        .set(com(seguradora))
        .send({ poligono: gravata });
      assert.equal(r.status, 400);
    });
  });
});
