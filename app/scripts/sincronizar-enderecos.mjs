/**
 * Copia os enderecos implantados para dentro do aplicativo.
 *
 * O script de implantacao dos contratos grava `contratos/implantacoes/<rede>.json`.
 * O Vite so serve arquivos de dentro de `app/`, entao esse arquivo precisa ser
 * trazido para ca antes de o servidor subir. E o que este script faz, e por isso
 * ele roda automaticamente em `npm run dev` e `npm run build`.
 *
 * O ponto e nao ter endereco de contrato digitado a mao em lugar nenhum. Um
 * endereco desatualizado no front-end produz o pior tipo de erro: a tela carrega,
 * as chamadas de leitura devolvem vazio, e nada indica que o problema e o endereco.
 */

import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const AQUI = dirname(fileURLToPath(import.meta.url));
const ORIGEM = join(AQUI, "..", "..", "contratos", "implantacoes");
const DESTINO = join(AQUI, "..", "src", "cadeia", "implantacoes.json");

function principal() {
  const redes = {};

  if (existsSync(ORIGEM)) {
    for (const arquivo of readdirSync(ORIGEM)) {
      // `<rede>-apolices.json` e o registro das apolices emitidas, nao da
      // infraestrutura. O aplicativo descobre as apolices pela fabrica, na
      // propria cadeia, entao esse arquivo nao interessa aqui.
      if (!arquivo.endsWith(".json") || arquivo.includes("-apolices")) continue;

      const conteudo = JSON.parse(readFileSync(join(ORIGEM, arquivo), "utf8"));
      redes[conteudo.rede] = conteudo;
    }
  }

  mkdirSync(dirname(DESTINO), { recursive: true });
  writeFileSync(DESTINO, `${JSON.stringify(redes, null, 2)}\n`);

  const nomes = Object.keys(redes);

  if (nomes.length === 0) {
    console.warn(
      "Nenhuma implantacao encontrada em contratos/implantacoes/.\n" +
        "O aplicativo vai subir, mas sem enderecos de contrato. Rode antes:\n" +
        "  cd contratos && npx hardhat run scripts/implantar.js --network localhost",
    );
    return;
  }

  console.log(`Enderecos sincronizados: ${nomes.join(", ")}`);
}

principal();
