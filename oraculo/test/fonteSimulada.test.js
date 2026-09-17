"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { CENARIOS, gerarLeituras } = require("../src/fonteSimulada");
const { consolidarIndiceClimatico, validarLeitura } = require("../src/consolidador");

/**
 * Testes da fonte simulada.
 *
 * O ponto central e a reprodutibilidade (RNF21): o mesmo cenario precisa gerar
 * sempre a mesma serie, senao os numeros de gas medidos em execucoes diferentes
 * nao sao comparaveis entre si.
 */

const PERIODO = 20261015;

test("os tres cenarios da HU04 existem", () => {
  assert.deepEqual(Object.keys(CENARIOS).sort(), [
    "estiagem_moderada",
    "estiagem_severa",
    "safra_normal",
  ]);
});

test("a geracao e deterministica", () => {
  const primeira = gerarLeituras({ cenario: "estiagem_severa", periodoFinal: PERIODO });
  const segunda = gerarLeituras({ cenario: "estiagem_severa", periodoFinal: PERIODO });

  assert.deepEqual(primeira, segunda);
});

test("todas as leituras geradas sao plausiveis", () => {
  for (const cenario of Object.keys(CENARIOS)) {
    const leituras = gerarLeituras({ cenario, periodoFinal: PERIODO });

    for (const leitura of leituras) {
      assert.equal(validarLeitura(leitura).valida, true, `${cenario}: ${JSON.stringify(leitura)}`);
    }
  }
});

test("cada dia tem leituras das duas fontes independentes (RNF18)", () => {
  const leituras = gerarLeituras({ cenario: "safra_normal", periodoFinal: PERIODO, dias: 10 });

  assert.equal(leituras.length, 20);
  assert.equal(new Set(leituras.map((l) => l.fonte)).size, 2);
});

test("estiagem_severa cruza o limiar de 30 dias sem chuva", () => {
  const leituras = gerarLeituras({ cenario: "estiagem_severa", periodoFinal: PERIODO, dias: 90 });
  const resultado = consolidarIndiceClimatico(leituras, { periodo: PERIODO });

  assert.ok(
    resultado.indiceClimatico >= 30,
    `esperado ao menos 30 dias secos, obtido ${resultado.indiceClimatico}`,
  );
});

test("a estiagem gerada tem exatamente o tamanho declarado no cenario", () => {
  for (const cenario of ["estiagem_severa", "estiagem_moderada"]) {
    const leituras = gerarLeituras({ cenario, periodoFinal: PERIODO, dias: 90 });
    const resultado = consolidarIndiceClimatico(leituras, { periodo: PERIODO });

    assert.equal(
      resultado.indiceClimatico,
      CENARIOS[cenario].janelaSeca,
      `${cenario}: a serie precisa medir o que o cenario declara`,
    );
    assert.equal(resultado.interrompidoPor, "chuva");
  }
});

test("estiagem_moderada fica abaixo do limiar de 30 dias", () => {
  const leituras = gerarLeituras({ cenario: "estiagem_moderada", periodoFinal: PERIODO, dias: 90 });
  const resultado = consolidarIndiceClimatico(leituras, { periodo: PERIODO });

  assert.ok(
    resultado.indiceClimatico > 0 && resultado.indiceClimatico < 30,
    `esperado entre 1 e 29 dias secos, obtido ${resultado.indiceClimatico}`,
  );
});

test("safra_normal mantem o indice proximo de zero", () => {
  const leituras = gerarLeituras({ cenario: "safra_normal", periodoFinal: PERIODO, dias: 90 });
  const resultado = consolidarIndiceClimatico(leituras, { periodo: PERIODO });

  assert.ok(
    resultado.indiceClimatico < 5,
    `esperado menos de 5 dias secos, obtido ${resultado.indiceClimatico}`,
  );
});

test("com-falhas injeta leituras que a validacao precisa descartar", () => {
  const leituras = gerarLeituras({
    cenario: "safra_normal",
    periodoFinal: PERIODO,
    dias: 30,
    comFalhas: true,
  });

  const resultado = consolidarIndiceClimatico(leituras, { periodo: PERIODO });

  assert.equal(resultado.leiturasDescartadas, 3);
  assert.deepEqual(resultado.fontesDescartadas, ["sensor-defeituoso-X1", "sensor-mudo-X2"]);
});

test("cenario desconhecido falha de forma explicita", () => {
  assert.throws(
    () => gerarLeituras({ cenario: "dilúvio", periodoFinal: PERIODO }),
    /Cenario desconhecido/,
  );
});
