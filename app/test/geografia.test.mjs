/**
 * Geometria do mapa do talhao.
 *
 * O poligono usado e o do talhao-01 da demonstracao, em Sao Simao/SP.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { anelDoPoligono, criarProjecao, pontoNoPoligono } from "../src/fotos/geografia.js";

const TALHAO = {
  type: "Polygon",
  coordinates: [
    [
      [-47.59, -21.45],
      [-47.57, -21.45],
      [-47.57, -21.47],
      [-47.59, -21.47],
      [-47.59, -21.45],
    ],
  ],
};

const anel = anelDoPoligono(TALHAO);

test("ponto no meio do talhao esta dentro", () => {
  assert.equal(pontoNoPoligono([-47.58, -21.46], anel), true);
});

test("ponto a um quilometro do talhao esta fora", () => {
  assert.equal(pontoNoPoligono([-47.6, -21.46], anel), false);
  assert.equal(pontoNoPoligono([-47.58, -21.44], anel), false);
});

test("poligono em forma de L: o canto vazio fica fora", () => {
  // Um L: a conta precisa acertar poligono concavo, nao so retangulo.
  const L = [
    [0, 0],
    [2, 0],
    [2, 1],
    [1, 1],
    [1, 2],
    [0, 2],
    [0, 0],
  ];

  assert.equal(pontoNoPoligono([0.5, 1.5], L), true);
  assert.equal(pontoNoPoligono([1.5, 1.5], L), false);
});

test("anel aceita GeoJSON e lista de pares", () => {
  assert.deepEqual(anelDoPoligono(TALHAO), TALHAO.coordinates[0]);
  assert.deepEqual(anelDoPoligono([[0, 0]]), [[0, 0]]);
  assert.deepEqual(anelDoPoligono(null), []);
});

test("a projecao vai e volta sem perder o ponto", () => {
  const projecao = criarProjecao(anel, 400, 300);
  const ponto = [-47.5812, -21.4633];

  const [lon, lat] = projecao.paraMapa(projecao.paraTela(ponto));

  assert.ok(Math.abs(lon - ponto[0]) < 1e-9);
  assert.ok(Math.abs(lat - ponto[1]) < 1e-9);
});

test("norte fica em cima: latitude maior, y menor na tela", () => {
  const projecao = criarProjecao(anel, 400, 300);

  const [, yNorte] = projecao.paraTela([-47.58, -21.45]);
  const [, ySul] = projecao.paraTela([-47.58, -21.47]);

  assert.ok(yNorte < ySul);
});

test("o talhao cabe na area de desenho, com margem", () => {
  const projecao = criarProjecao(anel, 400, 300);

  for (const vertice of anel) {
    const [x, y] = projecao.paraTela(vertice);
    assert.ok(x > 0 && x < 400, `x=${x}`);
    assert.ok(y > 0 && y < 300, `y=${y}`);
  }
});
