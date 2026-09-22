import { ethers } from "ethers";

import { config } from "../config.js";
import { gerarHashDeSenha } from "../seguranca/cripto.js";

/**
 * Dados de demonstracao.
 *
 * Os mesmos usuarios, talhoes e produtos que o aplicativo tinha embutidos no
 * navegador antes do backend — agora no banco, com senha em hash e poligono no
 * PostGIS. So roda em desenvolvimento e com o banco vazio: em producao, recusa;
 * com usuarios ja cadastrados, nao toca em nada.
 *
 * CHAVES DAS FONTES
 *
 * As duas estacoes do talhao-01 assinam os lotes com chaves derivadas da frase
 * de teste do Hardhat ("test test ... junk"), nas posicoes 10 e 11. Essa frase e
 * publica e conhecida — o proprio `npx hardhat node` avisa. Serve para que o
 * script de envio de leituras e o simulador consigam assinar sem configuracao,
 * e para nada alem disso. Em rede publica, cada fonte precisa de chave propria.
 */

export const FRASE_DE_TESTE = "test test test test test test test test test test test junk";

/** Carteira de uma fonte de demonstracao, pela posicao na derivacao. */
export function carteiraDeFonteDeDemonstracao(indice) {
  return ethers.HDNodeWallet.fromPhrase(FRASE_DE_TESTE, undefined, `m/44'/60'/0'/0/${indice}`);
}

export const FONTES_DE_DEMONSTRACAO = [
  { id: "estacao-inmet-a652", tipo: "estacao", indice: 10, lon: -47.8, lat: -21.175 },
  { id: "sensor-solo-talhao-01", tipo: "sensor_solo", indice: 11, lon: -47.805, lat: -21.18 },
];

/** Carteira do produtor de demonstracao: conta 1 do `hardhat node`. */
const CARTEIRA_DO_PRODUTOR = carteiraDeFonteDeDemonstracao(1).address.toLowerCase();

export async function semear(banco) {
  if (config.emProducao) throw new Error("A semente de demonstracao nao roda em producao.");

  const { rows } = await banco.query("SELECT count(*)::int AS n FROM usuarios");
  if (rows[0].n > 0) return false;

  const senha = await gerarHashDeSenha("agrosmart");

  await banco.transacao(async (tx) => {
    const inserir = async (identificador, nome, perfil, documento, carteira = null) =>
      (
        await tx.query(
          `INSERT INTO usuarios (identificador, nome, perfil, documento, hash_senha, carteira,
                                 carteira_vinculada_em)
           VALUES ($1, $2, $3, $4, $5, $6, CASE WHEN $6::text IS NULL THEN NULL ELSE now() END)
           RETURNING id`,
          [identificador, nome, perfil, documento, senha, carteira],
        )
      ).rows[0].id;

    // O produtor ja nasce com a carteira da conta 1 vinculada, para que a
    // demonstracao nao dependa de passar pela tela de vinculo. A tela continua
    // funcionando para quem quiser trocar a carteira.
    const produtor = await inserir(
      "produtor",
      "Joao Ribeiro",
      "produtor",
      "Fazenda Santa Clara — Ribeirao Preto/SP",
      CARTEIRA_DO_PRODUTOR,
    );
    await inserir(
      "seguradora",
      "Marina Costa",
      "seguradora",
      "AgroSeguro Mutua — mesa de subscricao",
    );
    await inserir("perito", "Carlos Nakamura", "perito", "CREA 123456/SP — engenheiro agronomo");

    const { rows: prop } = await tx.query(
      "INSERT INTO propriedades (produtor_id, nome, municipio) VALUES ($1, $2, $3) RETURNING id",
      [produtor, "Fazenda Santa Clara", "Ribeirao Preto/SP"],
    );

    const talhoes = [
      {
        identificador: "talhao-01",
        cultura: "soja",
        anel: [
          [-47.81, -21.17],
          [-47.79, -21.17],
          [-47.79, -21.19],
          [-47.81, -21.19],
          [-47.81, -21.17],
        ],
      },
      {
        identificador: "talhao-02",
        cultura: "milho",
        anel: [
          [-47.78, -21.16],
          [-47.76, -21.16],
          [-47.76, -21.18],
          [-47.78, -21.18],
          [-47.78, -21.16],
        ],
      },
    ];

    const ids = {};

    for (const t of talhoes) {
      const geojson = JSON.stringify({ type: "Polygon", coordinates: [t.anel] });

      const { rows: novo } = await tx.query(
        `WITH g AS (SELECT ST_SetSRID(ST_GeomFromGeoJSON($4), 4326) AS geom)
         INSERT INTO talhoes (propriedade_id, identificador, cultura, geometria, area_ha)
         SELECT $1, $2, $3, g.geom, round((ST_Area(g.geom::geography) / 10000)::numeric, 4) FROM g
         RETURNING id`,
        [prop[0].id, t.identificador, t.cultura, geojson],
      );

      ids[t.identificador] = novo[0].id;
    }

    for (const f of FONTES_DE_DEMONSTRACAO) {
      await tx.query(
        `INSERT INTO fontes (id, talhao_id, tipo, endereco, localizacao)
         VALUES ($1, $2, $3, $4, ST_SetSRID(ST_MakePoint($5, $6), 4326))`,
        [
          f.id,
          ids["talhao-01"],
          f.tipo,
          carteiraDeFonteDeDemonstracao(f.indice).address.toLowerCase(),
          f.lon,
          f.lat,
        ],
      );
    }

    const produtos = [
      ["Estiagem — soja", "soja", 0, 0, 30, 0, 0, 0, "0.006", 450, 180],
      ["Estiagem escalonada — soja", "soja", 0, 1, 30, 60, 0, 0, "0.006", 380, 180],
      ["Estiagem ou dano na lavoura — milho", "milho", 2, 1, 25, 50, 4000, 8000, "0.008", 520, 150],
    ];

    for (const [nome, cultura, op, modo, lc, lci, ld, ldi, porHa, taxa, dias] of produtos) {
      await tx.query(
        `INSERT INTO produtos (nome, cultura, operador, modo_pagamento, limiar_climatico,
                               limiar_climatico_integral, limiar_dano_bps, limiar_dano_integral_bps,
                               valor_por_hectare_wei, taxa_premio_bps, vigencia_dias)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          nome,
          cultura,
          op,
          modo,
          lc,
          lci,
          ld,
          ldi,
          ethers.parseEther(porHa).toString(),
          taxa,
          dias,
        ],
      );
    }
  });

  return true;
}
