"use strict";

const fs = require("node:fs");
const path = require("node:path");

/**
 * Registro de auditoria das publicacoes (RF22, RNF20, RNF25).
 *
 * Para cada publicacao grava o identificador da transacao, o gas consumido e o
 * instante de confirmacao, alem da latencia entre envio e confirmacao. Sao esses
 * numeros que alimentam o capitulo de resultados do TCC: gas por funcao e
 * comparacao de latencia entre rede local e rede de teste publica.
 *
 * O formato e JSON Lines: uma linha por publicacao, sempre acrescentada ao fim do
 * arquivo. A escolha e deliberada. Reescrever um JSON inteiro a cada publicacao
 * abre a chance de perder o arquivo em uma interrupcao no meio da escrita, e o que
 * esta em jogo aqui e justamente a trilha de auditoria.
 */
class RegistroDePublicacoes {
  /** @param {string} arquivo Caminho do arquivo .jsonl. */
  constructor(arquivo) {
    this.arquivo = arquivo;
    fs.mkdirSync(path.dirname(arquivo), { recursive: true });
  }

  /**
   * Acrescenta uma publicacao ao registro.
   *
   * @param {object} dados
   * @param {string} dados.apolice Endereco do contrato da apolice.
   * @param {number} dados.periodo Periodo de referencia publicado.
   * @param {object} dados.indices Indices efetivamente submetidos.
   * @param {string} dados.txHash Identificador da transacao.
   * @param {bigint|number} dados.gasUsado Gas consumido pela transacao.
   * @param {bigint|number} [dados.custoWei] Custo total em wei.
   * @param {number} dados.bloco Numero do bloco de confirmacao.
   * @param {string} dados.enviadoEm Instante do envio, em ISO 8601.
   * @param {string} dados.confirmadoEm Instante da confirmacao, em ISO 8601.
   * @param {boolean} [dados.acionouPagamento] Se a publicacao disparou a liquidacao.
   */
  registrar(dados) {
    const enviado = new Date(dados.enviadoEm);
    const confirmado = new Date(dados.confirmadoEm);

    const linha = {
      ...dados,
      gasUsado: dados.gasUsado === undefined ? null : String(dados.gasUsado),
      custoWei: dados.custoWei === undefined ? null : String(dados.custoWei),
      latenciaMs: confirmado.getTime() - enviado.getTime(),
      registradoEm: new Date().toISOString(),
    };

    fs.appendFileSync(this.arquivo, `${JSON.stringify(linha)}\n`);

    return linha;
  }

  /** Le todas as publicacoes registradas. */
  listar() {
    if (!fs.existsSync(this.arquivo)) return [];

    return fs
      .readFileSync(this.arquivo, "utf8")
      .split("\n")
      .filter((linha) => linha.trim().length > 0)
      .map((linha) => JSON.parse(linha));
  }

  /**
   * Estatisticas agregadas das publicacoes, no formato em que o capitulo de
   * resultados precisa: gas minimo, maximo e medio, e latencia media.
   */
  estatisticas() {
    const linhas = this.listar().filter((l) => l.gasUsado !== null);

    if (linhas.length === 0) return null;

    const gases = linhas.map((l) => BigInt(l.gasUsado));
    const latencias = linhas.map((l) => l.latenciaMs).filter((n) => Number.isFinite(n));

    const soma = gases.reduce((acc, g) => acc + g, 0n);

    return {
      publicacoes: linhas.length,
      gasMinimo: gases.reduce((a, b) => (b < a ? b : a)).toString(),
      gasMaximo: gases.reduce((a, b) => (b > a ? b : a)).toString(),
      gasMedio: (soma / BigInt(gases.length)).toString(),
      latenciaMediaMs:
        latencias.length > 0
          ? Math.round(latencias.reduce((a, b) => a + b, 0) / latencias.length)
          : null,
      acionamentos: linhas.filter((l) => l.acionouPagamento).length,
    };
  }
}

module.exports = { RegistroDePublicacoes };
