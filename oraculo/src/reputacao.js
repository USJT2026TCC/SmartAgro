"use strict";

const fs = require("node:fs");
const path = require("node:path");

/**
 * Escore de reputacao por fonte de dados (RF13).
 *
 * A ideia vem de Manoj T. et al. (2025), que condicionam o uso das leituras de um
 * dispositivo IoT a um escore de reputacao. Aqui o escore e uma media movel
 * exponencial do acerto da fonte: cada leitura plausivel puxa o escore para cima,
 * cada leitura descartada puxa para baixo.
 *
 * A media movel foi preferida a uma simples razao entre acertos e total porque um
 * sensor que funcionou por seis meses e quebrou hoje precisa perder reputacao
 * rapido; com razao acumulada, ele levaria meses para cair abaixo do limiar.
 *
 * O estado e persistido em disco para sobreviver a reinicio do servico, ja que o
 * historico da fonte e parte do que torna a decisao reconstituivel (RNF20).
 */
class RegistroReputacao {
  /**
   * @param {object} [opcoes]
   * @param {number} [opcoes.alfa=0.2] Peso da observacao mais recente, entre 0 e 1.
   * @param {number} [opcoes.escoreInicial=1] Escore atribuido a uma fonte nova.
   * @param {string} [opcoes.arquivo] Caminho do arquivo de persistencia.
   */
  constructor(opcoes = {}) {
    const { alfa = 0.2, escoreInicial = 1, arquivo = null } = opcoes;

    if (alfa <= 0 || alfa > 1) throw new Error("alfa deve ficar entre 0 (exclusivo) e 1");

    this.alfa = alfa;
    this.escoreInicial = escoreInicial;
    this.arquivo = arquivo;
    this.escores = new Map();
    this.ciclos = new Map();

    if (arquivo && fs.existsSync(arquivo)) this.carregar();
  }

  /** Escore atual de uma fonte. Fonte desconhecida comeca com o escore inicial. */
  escore(fonte) {
    return this.escores.has(fonte) ? this.escores.get(fonte) : this.escoreInicial;
  }

  /** Quantas observacoes ja foram registradas para a fonte. */
  observacoes(fonte) {
    return this.ciclos.get(fonte) ?? 0;
  }

  /**
   * Registra o resultado de uma leitura e atualiza o escore.
   * @param {string} fonte Identificador da estacao ou sensor.
   * @param {boolean} valida Se a leitura passou na validacao de plausibilidade.
   */
  registrar(fonte, valida) {
    const anterior = this.escore(fonte);
    const novo = anterior * (1 - this.alfa) + this.alfa * (valida ? 1 : 0);

    this.escores.set(fonte, Number(novo.toFixed(6)));
    this.ciclos.set(fonte, this.observacoes(fonte) + 1);

    return this.escores.get(fonte);
  }

  /** Fontes cujo escore caiu abaixo do limiar (RF12: sinalizar fontes inoperantes). */
  fontesAbaixoDe(limiar) {
    return [...this.escores.entries()]
      .filter(([, escore]) => escore < limiar)
      .map(([fonte, escore]) => ({ fonte, escore }))
      .sort((a, b) => a.escore - b.escore);
  }

  /** Estado completo, para inspecao e para o relatorio de execucao. */
  instantaneo() {
    return [...this.escores.entries()]
      .map(([fonte, escore]) => ({ fonte, escore, observacoes: this.observacoes(fonte) }))
      .sort((a, b) => a.fonte.localeCompare(b.fonte));
  }

  carregar() {
    const bruto = JSON.parse(fs.readFileSync(this.arquivo, "utf8"));

    this.escores = new Map(Object.entries(bruto.escores || {}));
    this.ciclos = new Map(Object.entries(bruto.ciclos || {}));
  }

  salvar() {
    if (!this.arquivo) return;

    fs.mkdirSync(path.dirname(this.arquivo), { recursive: true });
    fs.writeFileSync(
      this.arquivo,
      `${JSON.stringify(
        {
          atualizadoEm: new Date().toISOString(),
          alfa: this.alfa,
          escores: Object.fromEntries(this.escores),
          ciclos: Object.fromEntries(this.ciclos),
        },
        null,
        2,
      )}\n`,
    );
  }
}

module.exports = { RegistroReputacao };
