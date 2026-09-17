"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  MOTIVOS,
  validarLeitura,
  diaDe,
  somarDias,
  diaAnterior,
  agruparPorDia,
  contarDiasSecosConsecutivos,
  consolidarIndiceClimatico,
} = require("../src/consolidador");
const { RegistroReputacao } = require("../src/reputacao");

/**
 * Testes da consolidacao do indice climatico.
 *
 * Esta e a regra que decide quanto vale o dado antes de ele cruzar a fronteira.
 * Um erro aqui nao e revertido pelo contrato: o contrato confia no numero e paga.
 */

/** Monta uma leitura valida com os campos minimos. */
function leitura(fonte, periodo, chuvaMm) {
  const texto = String(periodo);

  return {
    fonte,
    timestamp: `${texto.slice(0, 4)}-${texto.slice(4, 6)}-${texto.slice(6, 8)}T12:00:00.000Z`,
    chuvaMm,
    temperaturaC: 27.5,
    umidadePct: 55,
  };
}

/** Serie de dias consecutivos terminando em `periodoFinal`. */
function serie(fontes, periodoFinal, chuvasDoMaisAntigoAoMaisRecente) {
  const total = chuvasDoMaisAntigoAoMaisRecente.length;
  const leituras = [];

  chuvasDoMaisAntigoAoMaisRecente.forEach((chuva, i) => {
    const periodo = somarDias(periodoFinal, -(total - 1 - i));
    for (const fonte of fontes) leituras.push(leitura(fonte, periodo, chuva));
  });

  return leituras;
}

// ---------------------------------------------------------------- datas

test("diaDe converte um instante em identificador AAAAMMDD", () => {
  assert.equal(diaDe("2026-10-15T23:59:00.000Z"), 20261015);
  assert.equal(diaDe("2026-01-01T00:00:00.000Z"), 20260101);
});

test("somarDias e diaAnterior atravessam viradas de mes e de ano", () => {
  assert.equal(diaAnterior(20261001), 20260930);
  assert.equal(diaAnterior(20260101), 20251231);
  assert.equal(somarDias(20260228, 1), 20260301); // 2026 nao e bissexto
  assert.equal(somarDias(20261231, 1), 20270101);
});

// ---------------------------------------------------------------- RF12

test("validarLeitura aceita uma leitura plausivel", () => {
  assert.deepEqual(validarLeitura(leitura("estacao-A", 20261015, 0)), { valida: true });
});

test("validarLeitura recusa chuva acima da faixa fisica", () => {
  const resultado = validarLeitura({ ...leitura("estacao-A", 20261015, 0), chuvaMm: 9999 });

  assert.equal(resultado.valida, false);
  assert.equal(resultado.motivo, MOTIVOS.FORA_DE_FAIXA);
  assert.equal(resultado.campo, "chuvaMm");
});

test("validarLeitura recusa temperatura impossivel", () => {
  const resultado = validarLeitura({ ...leitura("estacao-A", 20261015, 0), temperaturaC: -273 });

  assert.equal(resultado.valida, false);
  assert.equal(resultado.campo, "temperaturaC");
});

test("validarLeitura recusa leitura sem o campo de chuva", () => {
  const { chuvaMm, ...semChuva } = leitura("estacao-A", 20261015, 0);

  assert.equal(chuvaMm, 0);
  assert.equal(validarLeitura(semChuva).motivo, MOTIVOS.CAMPO_AUSENTE);
});

test("validarLeitura recusa data invalida e fonte ausente", () => {
  assert.equal(
    validarLeitura({ ...leitura("estacao-A", 20261015, 0), timestamp: "ontem" }).motivo,
    MOTIVOS.DATA_INVALIDA,
  );
  assert.equal(
    validarLeitura({ ...leitura("estacao-A", 20261015, 0), fonte: undefined }).motivo,
    MOTIVOS.CAMPO_AUSENTE,
  );
  assert.equal(validarLeitura(null).valida, false);
});

test("validarLeitura tolera campo opcional ausente", () => {
  const semUmidade = { ...leitura("estacao-A", 20261015, 0) };
  delete semUmidade.umidadePct;

  assert.equal(validarLeitura(semUmidade).valida, true);
});

// ---------------------------------------------------------------- agregacao

test("agruparPorDia tira a media entre as fontes do mesmo dia", () => {
  const porDia = agruparPorDia([
    leitura("estacao-A", 20261015, 10),
    leitura("estacao-B", 20261015, 20),
  ]);

  assert.equal(porDia.get(20261015).chuvaMm, 15);
  assert.deepEqual(porDia.get(20261015).fontes, ["estacao-A", "estacao-B"]);
});

test("contarDiasSecosConsecutivos para no primeiro dia com chuva", () => {
  const porDia = agruparPorDia(serie(["estacao-A"], 20261015, [12, 0, 0, 0]));
  const resultado = contarDiasSecosConsecutivos(porDia, 20261015, 1);

  assert.equal(resultado.dias, 3);
  assert.equal(resultado.interrompidoPor, "chuva");
});

test("contarDiasSecosConsecutivos para quando falta dado, sem presumir dia seco", () => {
  const porDia = agruparPorDia(serie(["estacao-A"], 20261015, [0, 0]));
  const resultado = contarDiasSecosConsecutivos(porDia, 20261015, 1);

  assert.equal(resultado.dias, 2);
  assert.equal(resultado.interrompidoPor, "ausencia_de_dados");
});

test("chuva abaixo do limiar ainda conta como dia seco", () => {
  const porDia = agruparPorDia(serie(["estacao-A"], 20261015, [5, 0.4, 0.2, 0]));

  assert.equal(contarDiasSecosConsecutivos(porDia, 20261015, 1).dias, 3);
  assert.equal(contarDiasSecosConsecutivos(porDia, 20261015, 0.1).dias, 1);
});

// ---------------------------------------------------------------- RF19

test("consolidarIndiceClimatico conta a estiagem e lista as fontes usadas", () => {
  const leituras = serie(["estacao-inmet-A652", "sensor-solo-talhao-01"], 20261015, [
    8,
    ...Array(31).fill(0),
  ]);

  const resultado = consolidarIndiceClimatico(leituras, { periodo: 20261015 });

  assert.equal(resultado.indiceClimatico, 31);
  assert.equal(resultado.interrompidoPor, "chuva");
  assert.deepEqual(resultado.fontesUsadas, ["estacao-inmet-A652", "sensor-solo-talhao-01"]);
  assert.equal(resultado.leiturasDescartadas, 0);
  assert.deepEqual(resultado.alertas, []);
});

test("consolidarIndiceClimatico descarta leituras implausiveis sem derrubar o indice", () => {
  const leituras = serie(["estacao-A", "estacao-B"], 20261015, [8, 0, 0, 0]);
  leituras.push({ ...leitura("sensor-quebrado", 20261015, 0), chuvaMm: 9999 });

  const resultado = consolidarIndiceClimatico(leituras, { periodo: 20261015 });

  assert.equal(resultado.indiceClimatico, 3);
  assert.equal(resultado.leiturasDescartadas, 1);
  assert.deepEqual(resultado.fontesDescartadas, ["sensor-quebrado"]);
  assert.equal(resultado.descartes[0].motivo, MOTIVOS.FORA_DE_FAIXA);
});

test("consolidarIndiceClimatico alerta quando ha menos de duas fontes (RNF18)", () => {
  const resultado = consolidarIndiceClimatico(serie(["unica"], 20261015, [0, 0]), {
    periodo: 20261015,
  });

  assert.equal(resultado.fontesUsadas.length, 1);
  assert.ok(resultado.alertas.some((a) => a.includes("RNF18")));
});

test("consolidarIndiceClimatico alerta quando a contagem para por falta de dado", () => {
  const resultado = consolidarIndiceClimatico(
    serie(["estacao-A", "estacao-B"], 20261015, [0, 0, 0]),
    { periodo: 20261015 },
  );

  assert.equal(resultado.indiceClimatico, 3);
  assert.ok(resultado.alertas.some((a) => a.includes("piso")));
});

test("consolidarIndiceClimatico devolve zero quando nao ha dado do proprio periodo", () => {
  const leituras = serie(["estacao-A", "estacao-B"], 20261010, [0, 0, 0]);
  const resultado = consolidarIndiceClimatico(leituras, { periodo: 20261015 });

  assert.equal(resultado.indiceClimatico, 0);
  assert.ok(resultado.alertas.some((a) => a.includes("Nenhuma leitura valida")));
});

test("consolidarIndiceClimatico exige o periodo de referencia", () => {
  assert.throws(() => consolidarIndiceClimatico([], {}), /periodo de referencia/);
});

// ---------------------------------------------------------------- RF13

test("fonte com reputacao abaixo do limiar tem as leituras ignoradas", () => {
  const reputacao = new RegistroReputacao({ alfa: 0.5 });

  // Sete leituras invalidas derrubam o escore da fonte bem abaixo de 0,5.
  for (let i = 0; i < 7; i += 1) reputacao.registrar("sensor-ruim", false);
  assert.ok(reputacao.escore("sensor-ruim") < 0.5);

  const leituras = [
    ...serie(["estacao-boa"], 20261015, [8, 0, 0, 0]),
    leitura("sensor-ruim", 20261015, 50),
  ];

  const resultado = consolidarIndiceClimatico(leituras, {
    periodo: 20261015,
    reputacao,
    limiarReputacao: 0.5,
  });

  // Se a leitura do sensor ruim tivesse entrado, a media do dia 15 subiria acima
  // do limiar de chuva e o indice cairia para zero.
  assert.equal(resultado.indiceClimatico, 3);
  assert.deepEqual(resultado.fontesDescartadas, ["sensor-ruim"]);
  assert.equal(resultado.descartes[0].motivo, MOTIVOS.REPUTACAO_BAIXA);
});

test("leitura invalida derruba a reputacao da fonte", () => {
  const reputacao = new RegistroReputacao({ alfa: 0.5 });
  const leituras = [{ ...leitura("sensor-X", 20261015, 0), chuvaMm: 9999 }];

  consolidarIndiceClimatico(leituras, { periodo: 20261015, reputacao });

  assert.equal(reputacao.escore("sensor-X"), 0.5);
  assert.equal(reputacao.observacoes("sensor-X"), 1);
});
