import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/**
 * Aplica as migracoes pendentes, em ordem.
 *
 * Cada arquivo em `migracoes/` e aplicado uma unica vez, dentro de uma transacao
 * junto com o registro de que foi aplicado. Se o arquivo falhar no meio, nada dele
 * fica no banco — nem o registro, entao a proxima execucao tenta de novo.
 *
 * Migracao aplicada nao e editada: mudanca de esquema vira um arquivo novo. Editar
 * uma migracao ja aplicada faria o banco de quem ja rodou divergir do banco de
 * quem roda pela primeira vez, e ninguem perceberia ate o primeiro erro estranho.
 */

const DIR = join(dirname(fileURLToPath(import.meta.url)), "migracoes");

/**
 * @param {import("./conexao.js").Banco} banco
 * @returns {Promise<string[]>} Nomes das migracoes aplicadas nesta execucao.
 */
export async function migrar(banco) {
  await banco.executar(`
    CREATE TABLE IF NOT EXISTS migracoes (
      nome        text PRIMARY KEY,
      aplicada_em timestamptz NOT NULL DEFAULT now()
    );
  `);

  const { rows } = await banco.query("SELECT nome FROM migracoes");
  const jaAplicadas = new Set(rows.map((linha) => linha.nome));

  const arquivos = readdirSync(DIR)
    .filter((nome) => nome.endsWith(".sql"))
    .sort();

  const aplicadas = [];

  for (const arquivo of arquivos) {
    if (jaAplicadas.has(arquivo)) continue;

    const sql = readFileSync(join(DIR, arquivo), "utf8");

    // O nome do arquivo entra no SQL literal, e nao como parametro, porque o
    // bloco inteiro vai em uma unica chamada de varias instrucoes — e esse tipo
    // de chamada nao aceita parametros. O nome vem do proprio diretorio do
    // projeto, filtrado por extensao; ainda assim, aspas simples sao escapadas.
    const nomeSeguro = arquivo.replaceAll("'", "''");

    await banco.executar(`
      BEGIN;
      ${sql}
      ;
      INSERT INTO migracoes (nome) VALUES ('${nomeSeguro}');
      COMMIT;
    `);

    aplicadas.push(arquivo);
  }

  return aplicadas;
}

// Execucao direta: `npm run migrar`.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { abrirBanco } = await import("./conexao.js");
  const banco = await abrirBanco();

  try {
    const aplicadas = await migrar(banco);
    console.log(
      aplicadas.length > 0
        ? `Migracoes aplicadas (${banco.motor}): ${aplicadas.join(", ")}`
        : `Banco ja atualizado (${banco.motor}).`,
    );
  } finally {
    await banco.fechar();
  }
}
