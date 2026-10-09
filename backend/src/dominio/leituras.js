/**
 * Validacao e reputacao das leituras de campo (RF12, RF13).
 *
 * A regra de plausibilidade NAO e reescrita aqui. Ela vem do proprio servico de
 * oraculo (`oraculo/src/consolidador.js`), importada diretamente.
 *
 * O motivo e o mesmo que levou ao teste de equivalencia entre o contrato e o
 * aplicativo: duas copias de uma regra divergem com o tempo. Se o backend
 * aceitasse leituras que o oraculo depois recusasse — ou o contrario —, o
 * indicador de reputacao das fontes contaria uma historia e o indice publicado,
 * outra. Com uma unica funcao, o que entra no banco e o que vale na
 * consolidacao sao, por construcao, a mesma coisa.
 *
 * O preco e acoplar os dois modulos pelo caminho do arquivo. Em um repositorio
 * unico, e um preco pequeno e visivel — muito menor que o de uma divergencia
 * silenciosa.
 */
import consolidador from "../../../oraculo/src/consolidador.js";

export const { validarLeitura, MOTIVOS, FAIXAS_FISICAS } = consolidador;

/** Peso da observacao mais recente. O mesmo valor usado pelo oraculo (RF13). */
export const ALFA_REPUTACAO = 0.2;

/**
 * Atualiza o escore de reputacao com uma sequencia de resultados.
 *
 * Media movel exponencial: cada leitura valida puxa o escore para 1, cada
 * leitura descartada puxa para 0. Um sensor que funcionou por meses e quebrou
 * hoje cai abaixo do limiar em poucos dias, em vez de levar meses.
 */
export function atualizarEscore(escoreAtual, resultados) {
  let escore = Number(escoreAtual);

  for (const valida of resultados) {
    escore = escore * (1 - ALFA_REPUTACAO) + ALFA_REPUTACAO * (valida ? 1 : 0);
  }

  return Number(escore.toFixed(6));
}

/**
 * Distancia maxima entre a coordenada que a leitura declara e a posicao
 * cadastrada da fonte. Um quilometro absorve o arredondamento das coordenadas
 * publicadas pelo INMET (quatro casas decimais, ~11 m) com folga, e ainda
 * separa duas estacoes vizinhas, que ficam a dezenas de quilometros.
 */
export const TOLERANCIA_DA_POSICAO_M = 1_000;

export const MOTIVOS_DE_POSICAO = {
  COORDENADA_INVALIDA: "coordenada_invalida",
  LONGE_DA_FONTE: "longe_da_posicao_da_fonte",
};

/** Distancia em metros entre dois pontos [lon, lat], pela formula do haversine. */
export function distanciaEmMetros([lon1, lat1], [lon2, lat2]) {
  const raio = 6_371_000;
  const rad = (g) => (g * Math.PI) / 180;
  const a =
    Math.sin(rad(lat2 - lat1) / 2) ** 2 +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lon2 - lon1) / 2) ** 2;
  return 2 * raio * Math.asin(Math.sqrt(a));
}

/**
 * Confere a coordenada de uma leitura (HU04, criterio 4).
 *
 * Leitura sem coordenada passa: o campo e opcional. Com coordenada, ela precisa
 * ser valida e cair a ate TOLERANCIA_DA_POSICAO_M da posicao cadastrada da
 * fonte, quando houver uma.
 *
 * @param {object} bruta Leitura como chegou, com `lon` e `lat` opcionais.
 * @param {{lon: number, lat: number}|null} posicaoDaFonte
 * @returns {{valida: boolean, coordenada: {lon: number, lat: number}|null, motivo?: string, campo?: string}}
 */
export function conferirCoordenada(bruta, posicaoDaFonte) {
  const { lon, lat } = bruta ?? {};
  if ((lon === undefined || lon === null) && (lat === undefined || lat === null)) {
    return { valida: true, coordenada: null };
  }

  const numero = (v) => typeof v === "number" && Number.isFinite(v);
  if (!numero(lon) || !numero(lat) || Math.abs(lon) > 180 || Math.abs(lat) > 90) {
    return {
      valida: false,
      coordenada: null,
      motivo: MOTIVOS_DE_POSICAO.COORDENADA_INVALIDA,
      campo: "coordenada",
    };
  }

  const coordenada = { lon, lat };
  if (
    posicaoDaFonte &&
    numero(posicaoDaFonte.lon) &&
    numero(posicaoDaFonte.lat) &&
    distanciaEmMetros([lon, lat], [posicaoDaFonte.lon, posicaoDaFonte.lat]) >
      TOLERANCIA_DA_POSICAO_M
  ) {
    return {
      valida: false,
      coordenada,
      motivo: MOTIVOS_DE_POSICAO.LONGE_DA_FONTE,
      campo: "coordenada",
    };
  }

  return { valida: true, coordenada };
}
