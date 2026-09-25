/**
 * Leitura do GPS e da data gravados na foto, com as fotos de demonstracao.
 *
 * O teste da data existe por causa de um defeito real: a leitura pedia os campos
 * de um jeito que a versao enxuta da biblioteca nao aceita, o erro era engolido,
 * e a data da foto virava a data do arquivo — sem nada acusar.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { lerDaFoto } from "../src/fotos/localizacao.js";

const PASTA = new URL("../../docs/demonstracao/fotos/", import.meta.url);

function arquivo(nome) {
  // A data do arquivo e deliberadamente outra: se a leitura cair nela, o teste
  // da data falha.
  return new File([readFileSync(new URL(nome, PASTA))], nome, {
    type: "image/jpeg",
    lastModified: Date.UTC(2020, 0, 1),
  });
}

test("le o GPS gravado na foto", async () => {
  const lido = await lerDaFoto(arquivo("demo-01-com-gps.jpg"));

  assert.equal(lido.origem, "exif");
  assert.ok(Math.abs(lido.lat - -21.4535) < 1e-6);
  assert.ok(Math.abs(lido.lon - -47.586) < 1e-6);
});

test("a data vem da foto, e nao do arquivo", async () => {
  const lido = await lerDaFoto(arquivo("demo-01-com-gps.jpg"));

  assert.equal(new Date(lido.capturadaEm).getFullYear(), 2026);
  assert.equal(new Date(lido.capturadaEm).getMonth(), 8); // setembro
});

test("foto sem GPS volta sem coordenada, para ser localizada de outro jeito", async () => {
  const lido = await lerDaFoto(arquivo("demo-08-sem-gps.jpg"));

  assert.equal(lido.origem, undefined);
  assert.equal(lido.lon, undefined);
  assert.ok(lido.capturadaEm instanceof Date);
});

test("arquivo que nao e foto nao derruba a leitura", async () => {
  const falso = new File([Buffer.from("isto nao e uma imagem")], "x.jpg", {
    lastModified: Date.UTC(2020, 0, 1),
  });

  const lido = await lerDaFoto(falso);

  assert.equal(lido.lon, undefined);
  assert.equal(new Date(lido.capturadaEm).getUTCFullYear(), 2020);
});
