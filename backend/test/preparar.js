/**
 * Carregado antes de qualquer teste (`node --import ./test/preparar.js`).
 *
 * As variaveis precisam existir ANTES de `src/config.js` ser avaliado, e em ESM
 * as importacoes estaticas acontecem antes do corpo do arquivo de teste. Por isso
 * ficam aqui, e nao no topo de cada teste.
 */
process.env.NODE_ENV = "teste";
process.env.INDEXADOR = "desligado";
process.env.LIMITE_LOGIN ??= "1000";
process.env.LIMITE_INGESTAO ??= "1000";
process.env.CHAVE_DE_SERVICO = "chave-de-teste";

// Imagens enviadas nos testes vao para um diretorio temporario, nunca para o do
// projeto.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.DIR_IMAGENS = mkdtempSync(join(tmpdir(), "agrosmart-imagens-"));
