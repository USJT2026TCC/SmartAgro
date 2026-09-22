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
