"use strict";

/**
 * Consolidacao das leituras de campo em um indice climatico publicavel.
 *
 * Esta e a parte do oraculo que decide o que vale como dado. Ela fica fora da
 * cadeia porque e cara, muda com frequencia e depende de series historicas; o
 * contrato recebe apenas o numero final (secao 3.2 da documentacao de software).
 *
 * Requisitos atendidos:
 *  RF12 - validar a plausibilidade das leituras e sinalizar fontes inoperantes
 *         ou fora de faixa;
 *  RF13 - atribuir a cada fonte um escore de reputacao, condicionando o uso dos
 *         dados a um limiar minimo;
 *  RF19 - consolidar os indices do periodo para submissao em transacao unica;
 *  RNF18 - exigir mais de uma fonte por talhao, ou evidencia por imagem.
 *
 * Todas as funcoes aqui sao puras: recebem leituras, devolvem um resultado, e nao
 * tocam em rede nem em disco. Isso e o que torna a regra testavel sem blockchain
 * e reproduzivel meses depois, como exige o RNF20.
 */

/**
 * Faixas fisicamente admissiveis para cada grandeza medida.
 * Valores fora delas indicam sensor com defeito, nao evento climatico.
 */
const FAIXAS_FISICAS = {
  chuvaMm: { min: 0, max: 500 },
  temperaturaC: { min: -20, max: 60 },
  umidadePct: { min: 0, max: 100 },
};

/** Motivos pelos quais uma leitura pode ser descartada. */
const MOTIVOS = {
  FORA_DE_FAIXA: "fora_de_faixa",
  CAMPO_AUSENTE: "campo_ausente",
  DATA_INVALIDA: "data_invalida",
  REPUTACAO_BAIXA: "reputacao_baixa",
};

/**
 * Verifica se uma leitura e fisicamente plausivel (RF12).
 *
 * @param {object} leitura Leitura crua vinda do simulador ou da ingestao.
 * @returns {{valida: boolean, motivo?: string, campo?: string}}
 */
function validarLeitura(leitura) {
  if (!leitura || typeof leitura !== "object") {
    return { valida: false, motivo: MOTIVOS.CAMPO_AUSENTE, campo: "leitura" };
  }

  if (!leitura.fonte) {
    return { valida: false, motivo: MOTIVOS.CAMPO_AUSENTE, campo: "fonte" };
  }

  const instante = new Date(leitura.timestamp);
  if (Number.isNaN(instante.getTime())) {
    return { valida: false, motivo: MOTIVOS.DATA_INVALIDA, campo: "timestamp" };
  }

  for (const [campo, faixa] of Object.entries(FAIXAS_FISICAS)) {
    const valor = leitura[campo];

    // Nem toda estacao mede tudo. Campo ausente nao invalida a leitura; campo
    // presente com valor impossivel, sim.
    if (valor === undefined || valor === null) continue;

    if (typeof valor !== "number" || Number.isNaN(valor)) {
      return { valida: false, motivo: MOTIVOS.CAMPO_AUSENTE, campo };
    }

    if (valor < faixa.min || valor > faixa.max) {
      return { valida: false, motivo: MOTIVOS.FORA_DE_FAIXA, campo };
    }
  }

  if (leitura.chuvaMm === undefined || leitura.chuvaMm === null) {
    return { valida: false, motivo: MOTIVOS.CAMPO_AUSENTE, campo: "chuvaMm" };
  }

  return { valida: true };
}

/** Converte um instante em identificador de dia no formato AAAAMMDD. */
function diaDe(timestamp) {
  const d = new Date(timestamp);
  const ano = d.getUTCFullYear();
  const mes = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dia = String(d.getUTCDate()).padStart(2, "0");

  return Number(`${ano}${mes}${dia}`);
}

/** Converte um AAAAMMDD em Date UTC a meia-noite. */
function dataDe(periodo) {
  const texto = String(periodo);

  return new Date(
    Date.UTC(Number(texto.slice(0, 4)), Number(texto.slice(4, 6)) - 1, Number(texto.slice(6, 8))),
  );
}

/** Soma dias a um identificador AAAAMMDD, devolvendo outro AAAAMMDD. */
function somarDias(periodo, incremento) {
  const d = dataDe(periodo);
  d.setUTCDate(d.getUTCDate() + incremento);

  return diaDe(d.toISOString());
}

/** Devolve o identificador do dia anterior a um AAAAMMDD. */
function diaAnterior(periodo) {
  return somarDias(periodo, -1);
}

/**
 * Agrega as leituras validas por dia.
 *
 * A agregacao tem DOIS passos, e a ordem entre eles nao e indiferente:
 *
 *  1. dentro de cada fonte, a chuva do dia e a SOMA das leituras daquele dia;
 *  2. entre fontes, o dia recebe a MEDIA dos totais de cada fonte.
 *
 * Somar na primeira etapa e o unico jeito de aceitar estacao que reporta de
 * hora em hora, como uma estacao automatica real faz: 24 leituras de 0,5 mm
 * sao 12 mm de chuva no dia, nao 0,5 mm. Tirar a media na segunda e o que
 * impede uma fonte isolada de decidir o dia sozinha.
 *
 * @returns {Map<number, {chuvaMm: number, fontes: string[]}>}
 */
function agruparPorDia(leiturasValidas) {
  const porDia = new Map();

  for (const leitura of leiturasValidas) {
    const dia = diaDe(leitura.timestamp);

    if (!porDia.has(dia)) porDia.set(dia, new Map());

    const porFonte = porDia.get(dia);
    porFonte.set(leitura.fonte, (porFonte.get(leitura.fonte) ?? 0) + leitura.chuvaMm);
  }

  const resultado = new Map();
  for (const [dia, porFonte] of porDia) {
    const totais = [...porFonte.values()];

    resultado.set(dia, {
      chuvaMm: totais.reduce((soma, total) => soma + total, 0) / totais.length,
      fontes: [...porFonte.keys()].sort(),
    });
  }

  return resultado;
}

/**
 * Conta dias consecutivos sem chuva terminando no periodo de referencia.
 *
 * Caminha para tras a partir do dia de referencia. Para no primeiro dia chuvoso
 * e tambem no primeiro dia sem dado: nao ha como afirmar que nao choveu em um dia
 * do qual nenhuma fonte reportou nada, e inventar essa informacao comprometeria a
 * auditabilidade que justifica todo o sistema.
 *
 * @returns {{dias: number, interrompidoPor: "chuva"|"ausencia_de_dados"|"fim_da_serie"}}
 */
function contarDiasSecosConsecutivos(porDia, periodoReferencia, limiarChuvaMm) {
  let dias = 0;
  let cursor = periodoReferencia;

  for (;;) {
    const registro = porDia.get(cursor);

    if (!registro) {
      return { dias, interrompidoPor: "ausencia_de_dados" };
    }

    if (registro.chuvaMm >= limiarChuvaMm) {
      return { dias, interrompidoPor: "chuva" };
    }

    dias += 1;
    cursor = diaAnterior(cursor);

    // Guarda contra serie sem inicio: nenhuma condicao contratada do projeto
    // trabalha com janelas maiores que um ano.
    if (dias > 366) {
      return { dias, interrompidoPor: "fim_da_serie" };
    }
  }
}

/**
 * Consolida o indice climatico do periodo a partir das leituras cruas.
 *
 * @param {object[]} leituras Leituras cruas do periodo e dos dias anteriores.
 * @param {object} opcoes
 * @param {number} opcoes.periodo Dia de referencia, no formato AAAAMMDD.
 * @param {number} [opcoes.limiarChuvaMm=1] Chuva diaria abaixo da qual o dia e seco.
 * @param {object} [opcoes.reputacao] Instancia de RegistroReputacao, se houver.
 * @param {number} [opcoes.limiarReputacao=0.5] Escore minimo para usar a fonte.
 * @param {number} [opcoes.minimoDeFontes=2] Fontes independentes exigidas (RNF18).
 *
 * @returns {{
 *   periodo: number,
 *   indiceClimatico: number,
 *   fontesUsadas: string[],
 *   fontesDescartadas: string[],
 *   descartes: object[],
 *   leiturasValidas: number,
 *   leiturasDescartadas: number,
 *   interrompidoPor: string,
 *   alertas: string[]
 * }}
 */
function consolidarIndiceClimatico(leituras, opcoes) {
  const {
    periodo,
    limiarChuvaMm = 1,
    reputacao = null,
    limiarReputacao = 0.5,
    minimoDeFontes = 2,
  } = opcoes;

  if (!periodo) throw new Error("consolidarIndiceClimatico exige o periodo de referencia");

  const validas = [];
  const descartes = [];
  const fontesDescartadas = new Set();

  for (const leitura of leituras) {
    const veredito = validarLeitura(leitura);

    if (!veredito.valida) {
      descartes.push({
        fonte: leitura?.fonte ?? "desconhecida",
        timestamp: leitura?.timestamp ?? null,
        motivo: veredito.motivo,
        campo: veredito.campo,
      });

      if (leitura?.fonte) fontesDescartadas.add(leitura.fonte);
      if (reputacao && leitura?.fonte) reputacao.registrar(leitura.fonte, false);

      continue;
    }

    // Fonte com historico ruim tem as leituras ignoradas, ainda que a leitura
    // atual seja plausivel (RF13).
    if (reputacao && reputacao.escore(leitura.fonte) < limiarReputacao) {
      descartes.push({
        fonte: leitura.fonte,
        timestamp: leitura.timestamp,
        motivo: MOTIVOS.REPUTACAO_BAIXA,
        escore: reputacao.escore(leitura.fonte),
      });

      fontesDescartadas.add(leitura.fonte);
      continue;
    }

    if (reputacao) reputacao.registrar(leitura.fonte, true);
    validas.push(leitura);
  }

  const porDia = agruparPorDia(validas);
  const { dias, interrompidoPor } = contarDiasSecosConsecutivos(porDia, periodo, limiarChuvaMm);

  const fontesUsadas = [...new Set(validas.map((l) => l.fonte))].sort();
  const alertas = [];

  if (fontesUsadas.length < minimoDeFontes) {
    alertas.push(
      `RNF18: o talhao tem ${fontesUsadas.length} fonte(s) valida(s); ` +
        `o minimo e ${minimoDeFontes} ou evidencia por imagem obrigatoria.`,
    );
  }

  if (!porDia.has(periodo)) {
    alertas.push(`Nenhuma leitura valida para o proprio periodo ${periodo}.`);
  }

  if (interrompidoPor === "ausencia_de_dados" && dias > 0) {
    alertas.push(
      `A contagem parou por falta de dado, nao por chuva. O indice de ${dias} dia(s) ` +
        "e um piso, nao a medida completa da estiagem.",
    );
  }

  return {
    periodo,
    indiceClimatico: dias,
    fontesUsadas,
    fontesDescartadas: [...fontesDescartadas].sort(),
    descartes,
    leiturasValidas: validas.length,
    leiturasDescartadas: descartes.length,
    interrompidoPor,
    alertas,
  };
}

module.exports = {
  FAIXAS_FISICAS,
  MOTIVOS,
  validarLeitura,
  diaDe,
  dataDe,
  somarDias,
  diaAnterior,
  agruparPorDia,
  contarDiasSecosConsecutivos,
  consolidarIndiceClimatico,
};
