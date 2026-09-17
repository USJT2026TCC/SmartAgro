"use strict";

const { dataDe, somarDias } = require("./consolidador");

/**
 * Fonte de leituras simulada.
 *
 * Substituto temporario do simulador em Python + MQTT previsto na HU04, que fica
 * com a trilha de Dados. Existe para que o oraculo possa ser exercitado ponta a
 * ponta desde a Sprint 1, sem esperar a outra trilha, e para que a demonstracao
 * seja reproduzivel.
 *
 * A geracao e deterministica: o mesmo cenario com a mesma semente produz sempre a
 * mesma serie. Isso importa porque o RNF21 exige reprodutibilidade, e porque um
 * numero de gas medido sobre uma serie aleatoria nao pode ser comparado com o da
 * execucao seguinte.
 *
 * Quando o simulador oficial entrar, este modulo continua util como fonte de
 * referencia nos testes: basta que o simulador produza leituras no mesmo formato.
 */

/** Gerador congruencial linear. Pequeno, deterministico e suficiente aqui. */
function geradorDeterministico(semente) {
  let estado = semente >>> 0;

  return () => {
    estado = (estado * 1664525 + 1013904223) >>> 0;
    return estado / 0x100000000;
  };
}

/** Semente estavel a partir do nome do cenario. */
function semearPor(texto) {
  let h = 2166136261;

  for (let i = 0; i < texto.length; i += 1) {
    h ^= texto.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }

  return h >>> 0;
}

/**
 * Cenarios climaticos previstos na HU04, criterio de aceite 3.
 *
 * `janelaSeca` marca o trecho da serie, contado do fim para tras, em que nao
 * chove. E o que define se a condicao contratada de 30 dias sem chuva sera
 * atingida ou nao.
 */
const CENARIOS = {
  safra_normal: {
    descricao: "Chuvas regulares, a cada tres dias. Nenhuma condicao e acionada.",
    intervaloEntreChuvas: 3,
    chuvaMm: [5, 25],
    janelaSeca: 0,
  },
  estiagem_moderada: {
    descricao: "Estiagem de 18 dias ao final da serie. Fica abaixo do limiar de 30.",
    intervaloEntreChuvas: 4,
    chuvaMm: [3, 18],
    janelaSeca: 18,
  },
  estiagem_severa: {
    descricao: "Estiagem de 35 dias ao final da serie. Cruza o limiar de 30 e aciona.",
    intervaloEntreChuvas: 4,
    chuvaMm: [3, 20],
    janelaSeca: 35,
  },
};

/** Estacoes padrao do talhao. Duas fontes independentes, conforme o RNF18. */
const FONTES_PADRAO = ["estacao-inmet-A652", "sensor-solo-talhao-01"];

/**
 * Gera a serie de leituras de um cenario.
 *
 * @param {object} opcoes
 * @param {string} opcoes.cenario Nome do cenario em CENARIOS.
 * @param {number} opcoes.periodoFinal Ultimo dia da serie, em AAAAMMDD.
 * @param {number} [opcoes.dias=60] Tamanho da serie.
 * @param {string[]} [opcoes.fontes] Identificadores das fontes.
 * @param {boolean} [opcoes.comFalhas=false] Injeta leituras defeituosas (RF12, RF13).
 *
 * @returns {object[]} Leituras no formato aceito por `consolidarIndiceClimatico`.
 */
function gerarLeituras({
  cenario,
  periodoFinal,
  dias = 60,
  fontes = FONTES_PADRAO,
  comFalhas = false,
}) {
  const definicao = CENARIOS[cenario];

  if (!definicao) {
    throw new Error(
      `Cenario desconhecido: ${cenario}. Disponiveis: ${Object.keys(CENARIOS).join(", ")}`,
    );
  }

  const aleatorio = geradorDeterministico(semearPor(cenario));
  const leituras = [];

  for (let recuo = dias - 1; recuo >= 0; recuo -= 1) {
    const data = dataDe(somarDias(periodoFinal, -recuo));
    const dentroDaJanelaSeca = recuo < definicao.janelaSeca;

    // O dia imediatamente anterior a janela seca e sempre chuvoso. Sem essa
    // ancora, a estiagem gerada se emenda por acaso com os dias secos do padrao
    // regular e fica mais longa do que o cenario declara, o que tornaria os
    // numeros do experimento diferentes do que o cenario diz medir.
    const ancoraDaJanela = recuo === definicao.janelaSeca && definicao.janelaSeca > 0;

    const choveu =
      !dentroDaJanelaSeca &&
      (ancoraDaJanela || (dias - 1 - recuo) % definicao.intervaloEntreChuvas === 0);

    const [min, max] = definicao.chuvaMm;
    const volume = choveu ? Number((min + aleatorio() * (max - min)).toFixed(1)) : 0;

    for (const fonte of fontes) {
      // Pequena divergencia entre estacoes, como acontece em campo.
      const ruido = choveu ? Number(((aleatorio() - 0.5) * 2).toFixed(1)) : 0;

      leituras.push({
        fonte,
        timestamp: new Date(
          Date.UTC(data.getUTCFullYear(), data.getUTCMonth(), data.getUTCDate(), 12, 0, 0),
        ).toISOString(),
        chuvaMm: Math.max(0, Number((volume + ruido).toFixed(1))),
        temperaturaC: Number((22 + aleatorio() * 12).toFixed(1)),
        umidadePct: Number((40 + aleatorio() * 45).toFixed(1)),
      });
    }
  }

  if (comFalhas) leituras.push(...gerarLeiturasDefeituosas(periodoFinal));

  return leituras;
}

/**
 * Leituras defeituosas para exercitar a validacao de plausibilidade.
 *
 * Reproduzem tres defeitos reais de instrumentacao de campo: sensor saturado,
 * termometro descalibrado e registro sem o campo medido.
 */
function gerarLeiturasDefeituosas(periodoFinal) {
  const data = dataDe(periodoFinal).toISOString();

  return [
    { fonte: "sensor-defeituoso-X1", timestamp: data, chuvaMm: 9999, temperaturaC: 25 },
    { fonte: "sensor-defeituoso-X1", timestamp: data, chuvaMm: 0, temperaturaC: -273 },
    { fonte: "sensor-mudo-X2", timestamp: data, temperaturaC: 25, umidadePct: 60 },
  ];
}

module.exports = { CENARIOS, FONTES_PADRAO, gerarLeituras, gerarLeiturasDefeituosas };
