import { mkdirSync } from "node:fs";

import { config } from "../config.js";

/**
 * Conexao com o banco de dados.
 *
 * Dois motores, uma interface:
 *
 *  - **PostgreSQL de verdade**, quando `DATABASE_URL` esta definido. E o caminho
 *    de producao e de um banco compartilhado pela equipe.
 *
 *  - **PGlite**, quando nao esta. E o proprio PostgreSQL compilado para rodar
 *    dentro do processo do Node, com a extensao PostGIS. Nao ha nada para
 *    instalar: `npm install` e o banco existe.
 *
 * A documentacao de software escolheu PostgreSQL + PostGIS porque o PostGIS
 * resolve o poligono do talhao e a checagem de ponto em area. Um banco
 * alternativo sem PostGIS obrigaria a reimplementar geometria em JavaScript, com
 * a precisao de uma aproximacao plana — que, medido neste projeto, infla a area
 * de um talhao em cerca de 7%. O PGlite mantem o PostGIS de verdade sem exigir
 * que cada um dos cinco integrantes instale um servidor de banco.
 *
 * O SQL e identico nos dois motores, porque o PGlite e o mesmo PostgreSQL.
 */

/**
 * @typedef {object} Banco
 * @property {(sql: string, params?: any[]) => Promise<{rows: any[]}>} query
 * @property {(sql: string) => Promise<void>} executar Varias instrucoes, sem parametros.
 * @property {<T>(fn: (tx: {query: Banco["query"]}) => Promise<T>) => Promise<T>} transacao
 * @property {() => Promise<void>} fechar
 * @property {string} motor
 */

/** Abre o PostgreSQL embutido. `diretorio` nulo significa banco em memoria. */
async function abrirPGlite(diretorio) {
  const { PGlite } = await import("@electric-sql/pglite");
  const { postgis } = await import("@electric-sql/pglite-postgis");

  if (diretorio) mkdirSync(diretorio, { recursive: true });

  const db = await PGlite.create({
    dataDir: diretorio ?? undefined,
    extensions: { postgis },
  });

  // O PGlite informa as linhas afetadas em `affectedRows`; o driver `pg`, em
  // `rowCount`. Normaliza-se para o nome do `pg`, e o resto do codigo usa um so.
  const normalizar = (r) => ({ ...r, rowCount: r.affectedRows ?? r.rows?.length ?? 0 });

  return {
    motor: diretorio ? "pglite" : "pglite-memoria",
    query: async (sql, params = []) => normalizar(await db.query(sql, params)),
    executar: async (sql) => {
      await db.exec(sql);
    },
    transacao: (fn) =>
      db.transaction((tx) =>
        fn({ query: async (sql, params = []) => normalizar(await tx.query(sql, params)) }),
      ),
    fechar: () => db.close(),
  };
}

/** Abre um PostgreSQL de verdade pelo endereco informado. */
async function abrirPostgres(url) {
  const { default: pg } = await import("pg");

  // Valores monetarios sao guardados em wei, como `numeric(78,0)`, e o driver
  // devolve `numeric` como texto. E o que se quer: wei nao cabe em Number, e o
  // texto e convertido para BigInt no dominio, sem perda.
  const pool = new pg.Pool({ connectionString: url, max: 10 });

  return {
    motor: "postgres",
    query: (sql, params = []) => pool.query(sql, params),
    executar: async (sql) => {
      await pool.query(sql);
    },
    transacao: async (fn) => {
      const cliente = await pool.connect();

      try {
        await cliente.query("BEGIN");
        const resultado = await fn({ query: (sql, params = []) => cliente.query(sql, params) });
        await cliente.query("COMMIT");

        return resultado;
      } catch (erro) {
        await cliente.query("ROLLBACK");
        throw erro;
      } finally {
        cliente.release();
      }
    },
    fechar: () => pool.end(),
  };
}

/**
 * Abre o banco conforme a configuracao.
 *
 * @param {object} [opcoes]
 * @param {boolean} [opcoes.emMemoria] Banco descartavel, usado pelos testes.
 * @returns {Promise<Banco>}
 */
export async function abrirBanco(opcoes = {}) {
  if (opcoes.emMemoria) return abrirPGlite(null);
  if (config.urlDoBanco) return abrirPostgres(config.urlDoBanco);

  return abrirPGlite(config.dirBanco);
}
