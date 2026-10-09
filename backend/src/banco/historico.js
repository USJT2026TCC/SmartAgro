import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Carga do historico de chuva do INMET (RF06).
 *
 * O CSV vem do comando `simulador historico` e fica versionado em
 * src/banco/dados/: algumas centenas de KB, contra ~100 MB por ano no ZIP
 * original. A carga e idempotente — so roda com a tabela vazia — e acontece na
 * inicializacao, inclusive em producao: diferente da semente, isto nao e dado de
 * demonstracao, e dado publico do INMET.
 */

const AQUI = dirname(fileURLToPath(import.meta.url));
export const ARQUIVO_DO_HISTORICO = join(AQUI, "dados", "historico-chuva-inmet.csv");

/**
 * Estacoes do historico, com as coordenadas publicadas pelo INMET no cabecalho
 * de cada CSV anual.
 */
export const ESTACOES_INMET = [
  { codigo: "A770", nome: "Sao Simao/SP", lon: -47.57944444, lat: -21.46111111 },
  { codigo: "A747", nome: "Pradopolis/SP", lon: -48.11388888, lat: -21.33833333 },
];

/** Linhas do CSV: estacao,data,chuva_mm,horas_validas. */
export function lerCsvDoHistorico(texto) {
  const [cabecalho, ...linhas] = texto.trim().split(/\r?\n/);
  const colunas = cabecalho.split(",");

  return linhas
    .filter(Boolean)
    .map((linha) => Object.fromEntries(linha.split(",").map((v, i) => [colunas[i], v])));
}

/** Carrega o historico se a tabela estiver vazia. Devolve quantos dias carregou. */
export async function carregarHistoricoClimatico(banco, arquivo = ARQUIVO_DO_HISTORICO) {
  const { rows } = await banco.query("SELECT count(*)::int AS n FROM historico_chuva");
  if (rows[0].n > 0 || !existsSync(arquivo)) return 0;

  for (const e of ESTACOES_INMET) {
    await banco.query(
      `INSERT INTO estacoes_inmet (codigo, nome, posicao)
       VALUES ($1, $2, ST_SetSRID(ST_MakePoint($3, $4), 4326))
       ON CONFLICT (codigo) DO NOTHING`,
      [e.codigo, e.nome, e.lon, e.lat],
    );
  }

  const linhas = lerCsvDoHistorico(readFileSync(arquivo, "utf8"));

  // Uma unica insercao com unnest: milhares de linhas sem milhares de idas ao banco.
  await banco.query(
    `INSERT INTO historico_chuva (estacao, data, chuva_mm, horas_validas)
     SELECT * FROM unnest($1::text[], $2::date[], $3::numeric[], $4::smallint[])
     ON CONFLICT DO NOTHING`,
    [
      linhas.map((l) => l.estacao),
      linhas.map((l) => l.data),
      linhas.map((l) => l.chuva_mm),
      linhas.map((l) => l.horas_validas),
    ],
  );

  return linhas.length;
}
