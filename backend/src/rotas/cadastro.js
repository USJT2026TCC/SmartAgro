import { Router } from "express";
import { ethers } from "ethers";

import { conflito, naoEncontrado, pedidoInvalido } from "../erros.js";
import { paraPoligonoGeoJson } from "../dominio/geometria.js";
import { auditar, exigirPerfil, exigirSessao } from "../seguranca/sessoes.js";
import { decimalPositivo, endereco, inteiro, texto, umDe, uuid } from "../validacao.js";

/**
 * Cadastro: produtores, talhoes, produtos e fontes de dados (RF03, RF05, RF11).
 *
 * O talhao e a unica peca com geometria, e e onde o PostGIS faz diferenca:
 *  - a validade do poligono e conferida pelo banco (ST_IsValid), e nao por um
 *    algoritmo escrito a mao;
 *  - a area e calculada sobre o elipsoide (geography), e nao sobre o plano.
 *
 * O segundo ponto nao e detalhe. A aproximacao plana que o aplicativo usava
 * antes do backend dava 492,8 ha para um poligono que tem 459,9 ha — 7% a mais.
 * Como o limite da apolice e area x valor por hectare, a apolice sairia com
 * cobertura maior do que a area delimitada justifica.
 */

const SQL_TALHAO = `
  SELECT t.id, t.identificador, t.cultura, t.area_ha, t.criado_em,
         ST_AsGeoJSON(t.geometria)::json AS geometria,
         p.id AS propriedade_id, p.nome AS propriedade, p.municipio,
         u.id AS produtor_id, u.nome AS produtor_nome, u.identificador AS produtor_identificador,
         (SELECT count(*)::int FROM fontes f WHERE f.talhao_id = t.id AND f.ativa) AS fontes_ativas
    FROM talhoes t
    JOIN propriedades p ON p.id = t.propriedade_id
    JOIN usuarios u ON u.id = p.produtor_id
`;

function talhaoPublico(linha) {
  return {
    id: linha.id,
    identificador: linha.identificador,
    cultura: linha.cultura,
    areaHa: linha.area_ha,
    poligono: linha.geometria,
    propriedade: { id: linha.propriedade_id, nome: linha.propriedade, municipio: linha.municipio },
    produtor: {
      id: linha.produtor_id,
      nome: linha.produtor_nome,
      identificador: linha.produtor_identificador,
    },
    fontesAtivas: linha.fontes_ativas,
    // RNF18: ao menos duas fontes independentes, ou evidencia por imagem.
    atendeMinimoDeFontes: linha.fontes_ativas >= 2,
    criadoEm: linha.criado_em,
  };
}

function produtoPublico(p) {
  return {
    id: p.id,
    nome: p.nome,
    cultura: p.cultura,
    operador: p.operador,
    modoPagamento: p.modo_pagamento,
    limiarClimatico: p.limiar_climatico,
    limiarClimaticoIntegral: p.limiar_climatico_integral,
    limiarDanoBps: p.limiar_dano_bps,
    limiarDanoIntegralBps: p.limiar_dano_integral_bps,
    valorPorHectareWei: p.valor_por_hectare_wei,
    valorPorHectareEth: ethers.formatEther(p.valor_por_hectare_wei),
    taxaPremioBps: p.taxa_premio_bps,
    vigenciaDias: p.vigencia_dias,
    ativo: p.ativo,
  };
}

export function rotasDeCadastro() {
  const r = Router();

  // ---------------------------------------------------------- produtores

  r.get("/produtores", exigirSessao, exigirPerfil("seguradora"), async (req, res) => {
    const { rows } = await req.app.locals.banco.query(
      `SELECT id, identificador, nome, documento, carteira FROM usuarios
        WHERE perfil = 'produtor' ORDER BY nome`,
    );

    res.json({ produtores: rows });
  });

  // ------------------------------------------------------------- talhoes

  r.get("/talhoes", exigirSessao, async (req, res) => {
    const { banco } = req.app.locals;

    // O produtor ve so os proprios talhoes; seguradora e perito veem todos.
    const { rows } =
      req.usuario.perfil === "produtor"
        ? await banco.query(`${SQL_TALHAO} WHERE u.id = $1 ORDER BY t.identificador`, [
            req.usuario.id,
          ])
        : await banco.query(`${SQL_TALHAO} ORDER BY t.identificador`);

    res.json({ talhoes: rows.map(talhaoPublico) });
  });

  r.get("/talhoes/:id", exigirSessao, async (req, res) => {
    const id = uuid(req.params.id, "id");
    const { rows } = await req.app.locals.banco.query(`${SQL_TALHAO} WHERE t.id = $1`, [id]);

    if (!rows[0]) throw naoEncontrado("Talhao");
    if (req.usuario.perfil === "produtor" && rows[0].produtor_id !== req.usuario.id) {
      throw naoEncontrado("Talhao");
    }

    res.json({ talhao: talhaoPublico(rows[0]) });
  });

  /**
   * Cadastro de talhao (UC02, HU09). Restrito a seguradora, como no caso de uso.
   */
  r.post("/talhoes", exigirSessao, exigirPerfil("seguradora"), async (req, res) => {
    const { banco } = req.app.locals;
    const corpo = req.body ?? {};

    const identificador = texto(corpo.identificador, "identificador", { max: 31 });
    const cultura = texto(corpo.cultura, "cultura", { max: 40 }).toLowerCase();
    const produtorId = uuid(corpo.produtorId, "produtorId");
    const geojson = paraPoligonoGeoJson(corpo.poligono);

    // Um bytes32 comporta 31 bytes, e caracteres acentuados ocupam mais de um.
    if (Buffer.byteLength(identificador, "utf8") > 31) {
      throw pedidoInvalido("O identificador ocupa mais de 31 bytes; evite acentos.");
    }

    const { rows: produtores } = await banco.query(
      "SELECT id FROM usuarios WHERE id = $1 AND perfil = 'produtor'",
      [produtorId],
    );
    if (!produtores[0]) throw naoEncontrado("Produtor");

    const talhaoId = await banco.transacao(async (tx) => {
      // A propriedade e reaproveitada quando ja existe com o mesmo nome para o
      // mesmo produtor; senao, e criada junto.
      let propriedadeId = corpo.propriedadeId ? uuid(corpo.propriedadeId, "propriedadeId") : null;

      if (!propriedadeId) {
        const nome = texto(corpo.propriedade?.nome, "propriedade.nome", { max: 120 });
        const municipio = texto(corpo.propriedade?.municipio, "propriedade.municipio", {
          max: 120,
        });

        const { rows: existentes } = await tx.query(
          "SELECT id FROM propriedades WHERE produtor_id = $1 AND nome = $2",
          [produtorId, nome],
        );

        propriedadeId =
          existentes[0]?.id ??
          (
            await tx.query(
              "INSERT INTO propriedades (produtor_id, nome, municipio) VALUES ($1, $2, $3) RETURNING id",
              [produtorId, nome, municipio],
            )
          ).rows[0].id;
      }

      // Validade e area pelo PostGIS. ST_IsValid, no CHECK da tabela, recusa a
      // autointersecao; ST_Area sobre geography mede no elipsoide.
      const { rows } = await tx.query(
        `WITH g AS (SELECT ST_SetSRID(ST_GeomFromGeoJSON($4), 4326) AS geom)
         INSERT INTO talhoes (propriedade_id, identificador, cultura, geometria, area_ha)
         SELECT $1, $2, $3, g.geom, round((ST_Area(g.geom::geography) / 10000)::numeric, 4)
           FROM g
         RETURNING id`,
        [propriedadeId, identificador, cultura, JSON.stringify(geojson)],
      );

      return rows[0].id;
    });

    await auditar(banco, req, "talhao_cadastrado", {
      recurso: talhaoId,
      detalhes: { identificador },
    });

    const { rows } = await banco.query(`${SQL_TALHAO} WHERE t.id = $1`, [talhaoId]);
    res.status(201).json({ talhao: talhaoPublico(rows[0]) });
  });

  r.delete("/talhoes/:id", exigirSessao, exigirPerfil("seguradora"), async (req, res) => {
    const { banco } = req.app.locals;
    const id = uuid(req.params.id, "id");

    // Talhao com proposta ou apolice nao sai: a apolice na cadeia continuaria
    // apontando para ele, e o historico perderia a referencia.
    const { rows } = await banco.query(
      `SELECT (SELECT count(*) FROM propostas WHERE talhao_id = $1)::int
            + (SELECT count(*) FROM apolices WHERE talhao_id = $1)::int AS usos`,
      [id],
    );

    if (rows[0].usos > 0)
      throw conflito("Este talhao ja tem proposta ou apolice e nao pode ser removido.");

    await banco.transacao(async (tx) => {
      await tx.query("DELETE FROM fontes WHERE talhao_id = $1", [id]);
      await tx.query("DELETE FROM talhoes WHERE id = $1", [id]);
    });

    await auditar(banco, req, "talhao_removido", { recurso: id });
    res.status(204).end();
  });

  // ------------------------------------------------------------ produtos

  r.get("/produtos", exigirSessao, async (req, res) => {
    const { banco } = req.app.locals;
    const params = [];
    let filtro = "WHERE ativo";

    if (req.query.cultura) {
      params.push(String(req.query.cultura).toLowerCase());
      filtro += ` AND cultura = $${params.length}`;
    }

    const { rows } = await banco.query(`SELECT * FROM produtos ${filtro} ORDER BY nome`, params);
    res.json({ produtos: rows.map(produtoPublico) });
  });

  /** Configuracao de produto indexado (RF05, UC03). */
  r.post("/produtos", exigirSessao, exigirPerfil("seguradora"), async (req, res) => {
    const { banco } = req.app.locals;
    const c = req.body ?? {};

    const valorPorHectareWei = ethers
      .parseEther(decimalPositivo(c.valorPorHectareEth, "valorPorHectareEth", { casas: 18 }))
      .toString();

    // A taxa chega em percentual com ate duas casas e vira pontos-base, inteiro.
    const taxaPct = decimalPositivo(c.taxaPremioPct, "taxaPremioPct", { casas: 2 });
    const [inteira, fracao = ""] = taxaPct.split(".");
    const taxaPremioBps = Number(inteira) * 100 + Number((fracao + "00").slice(0, 2));

    const { rows } = await banco.query(
      `INSERT INTO produtos (nome, cultura, operador, modo_pagamento, limiar_climatico,
                             limiar_climatico_integral, limiar_dano_bps, limiar_dano_integral_bps,
                             valor_por_hectare_wei, taxa_premio_bps, vigencia_dias)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING *`,
      [
        texto(c.nome, "nome", { max: 120 }),
        texto(c.cultura, "cultura", { max: 40 }).toLowerCase(),
        inteiro(c.operador, "operador", { min: 0, max: 3 }),
        inteiro(c.modoPagamento, "modoPagamento", { min: 0, max: 1 }),
        inteiro(c.limiarClimatico ?? 0, "limiarClimatico", { min: 0, max: 366 }),
        inteiro(c.limiarClimaticoIntegral ?? 0, "limiarClimaticoIntegral", { min: 0, max: 366 }),
        inteiro(c.limiarDanoBps ?? 0, "limiarDanoBps", { min: 0, max: 10000 }),
        inteiro(c.limiarDanoIntegralBps ?? 0, "limiarDanoIntegralBps", { min: 0, max: 10000 }),
        valorPorHectareWei,
        taxaPremioBps,
        inteiro(c.vigenciaDias, "vigenciaDias", { min: 1, max: 730 }),
      ],
    );

    await auditar(banco, req, "produto_cadastrado", { recurso: rows[0].id });
    res.status(201).json({ produto: produtoPublico(rows[0]) });
  });

  /**
   * Retirada de produto. E logica, e nao remocao: propostas ja feitas guardam
   * uma copia dos termos, mas a referencia ao produto precisa continuar valida.
   */
  r.delete("/produtos/:id", exigirSessao, exigirPerfil("seguradora"), async (req, res) => {
    const { banco } = req.app.locals;
    const id = uuid(req.params.id, "id");

    const { rowCount } = await banco.query("UPDATE produtos SET ativo = false WHERE id = $1", [id]);
    if (rowCount === 0) throw naoEncontrado("Produto");

    await auditar(banco, req, "produto_retirado", { recurso: id });
    res.status(204).end();
  });

  // -------------------------------------------------------------- fontes

  r.get("/fontes", exigirSessao, exigirPerfil("seguradora", "perito"), async (req, res) => {
    const { banco } = req.app.locals;
    const params = [];
    let filtro = "";

    if (req.query.talhaoId) {
      params.push(uuid(req.query.talhaoId, "talhaoId"));
      filtro = "WHERE f.talhao_id = $1";
    }

    const { rows } = await banco.query(
      `SELECT f.id, f.tipo, f.endereco, f.ativa, f.escore, f.observacoes, f.ultima_leitura_em,
              ST_X(f.localizacao) AS lon, ST_Y(f.localizacao) AS lat,
              t.id AS talhao_id, t.identificador AS talhao
         FROM fontes f JOIN talhoes t ON t.id = f.talhao_id
         ${filtro}
        ORDER BY t.identificador, f.id`,
      params,
    );

    res.json({ fontes: rows });
  });

  /**
   * Registro de fonte (RF11). O endereco e a chave publica com que a estacao ou
   * o sensor assina os lotes; sem ele cadastrado, nenhuma leitura da fonte e
   * aceita (RNF19).
   */
  r.post("/fontes", exigirSessao, exigirPerfil("seguradora"), async (req, res) => {
    const { banco } = req.app.locals;
    const c = req.body ?? {};

    const id = texto(c.id, "id", { max: 60 });
    if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) {
      throw pedidoInvalido(
        'O identificador da fonte aceita apenas letras minusculas, numeros e "-".',
      );
    }

    const talhaoId = uuid(c.talhaoId, "talhaoId");
    const tipo = umDe(c.tipo, "tipo", ["estacao", "sensor_solo"]);
    const enderecoDaFonte = endereco(c.endereco, "endereco");

    const temLocal = c.lon !== undefined && c.lat !== undefined && c.lon !== "" && c.lat !== "";

    const { rows } = await banco.query(
      `INSERT INTO fontes (id, talhao_id, tipo, endereco, localizacao)
       VALUES ($1, $2, $3, $4, CASE WHEN $5::boolean THEN ST_SetSRID(ST_MakePoint($6, $7), 4326) END)
       RETURNING id`,
      [id, talhaoId, tipo, enderecoDaFonte, temLocal, Number(c.lon ?? 0), Number(c.lat ?? 0)],
    );

    await auditar(banco, req, "fonte_registrada", {
      recurso: rows[0].id,
      detalhes: { endereco: enderecoDaFonte },
    });
    res.status(201).json({ fonte: { id: rows[0].id, talhaoId, tipo, endereco: enderecoDaFonte } });
  });

  r.patch("/fontes/:id", exigirSessao, exigirPerfil("seguradora"), async (req, res) => {
    const { banco } = req.app.locals;

    if (typeof req.body?.ativa !== "boolean")
      throw pedidoInvalido('Informe "ativa" como verdadeiro ou falso.');

    const { rowCount } = await banco.query("UPDATE fontes SET ativa = $2 WHERE id = $1", [
      req.params.id,
      req.body.ativa,
    ]);

    if (rowCount === 0) throw naoEncontrado("Fonte");

    await auditar(banco, req, req.body.ativa ? "fonte_reativada" : "fonte_desativada", {
      recurso: req.params.id,
    });
    res.json({ id: req.params.id, ativa: req.body.ativa });
  });

  return r;
}
