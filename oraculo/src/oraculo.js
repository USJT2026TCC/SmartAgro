"use strict";

const path = require("node:path");

const { config, exigirChave, lerImplantacao } = require("./config");
const { consolidarIndiceClimatico } = require("./consolidador");
const { RegistroReputacao } = require("./reputacao");
const { FilaDePublicacoes, ESTADOS } = require("./fila");
const { RegistroDePublicacoes } = require("./registro");
const { Publicador, paraBytes32 } = require("./publicador");
const { ClienteBackend } = require("./clienteBackend");

/**
 * Servico de oraculo do AgroSmart.
 *
 * Amarra as quatro pecas que fazem a travessia acontecer:
 *   consolidador -> fila -> publicador -> registro
 *
 * A ordem importa. A consolidacao grava na fila antes de qualquer tentativa de
 * publicacao, de modo que uma queda da rede ou do proprio processo nao perca o
 * indice (RF21, RNF22). Só depois da confirmacao em cadeia a entrada sai da fila e
 * o custo e a latencia vao para o registro de auditoria (RF22).
 */
class ServicoOraculo {
  constructor({ publicador, fila, registro, reputacao, backend = null, opcoes = {} }) {
    this.publicador = publicador;

    // Opcional: sem backend, o servico funciona sozinho, com a fonte simulada,
    // como antes. Com backend, relata cada publicacao e cada falha definitiva.
    this.backend = backend;
    this.fila = fila;
    this.registro = registro;
    this.reputacao = reputacao;

    this.limiarChuvaMm = opcoes.limiarChuvaMm ?? config.limiarChuvaMm;
    this.limiarReputacao = opcoes.limiarReputacao ?? config.limiarReputacao;
    this.limiarConfiancaModelo = opcoes.limiarConfiancaModelo ?? config.limiarConfiancaModelo;
    this.esperaBaseMs = opcoes.esperaBaseMs ?? config.esperaBaseMs;
    this.maxTentativas = opcoes.maxTentativas ?? config.maxTentativas;
  }

  /** Monta o servico a partir da configuracao de ambiente. */
  static criar(opcoes = {}) {
    const dirDados = opcoes.dirDados ?? config.dirDados;

    // O chainId vem do arquivo de implantacao. Informa-lo dispensa a deteccao
    // automatica de rede do ethers, que com o no fora do ar fica repetindo a
    // consulta antes de desistir.
    let chainId = opcoes.chainId ?? null;
    if (chainId === null) {
      try {
        chainId = lerImplantacao().chainId ?? null;
      } catch {
        chainId = null;
      }
    }

    return new ServicoOraculo({
      publicador: new Publicador({
        rpcUrl: opcoes.rpcUrl ?? config.rpcUrl,
        chavePrivada: opcoes.chavePrivada ?? exigirChave(),
        confirmacoes: opcoes.confirmacoes ?? config.confirmacoes,
        timeoutMs: opcoes.timeoutMs ?? config.timeoutMs,
        chainId,
      }),
      fila: new FilaDePublicacoes(path.join(dirDados, "fila.json"), {
        maxTentativas: opcoes.maxTentativas ?? config.maxTentativas,
      }),
      registro: new RegistroDePublicacoes(path.join(dirDados, "publicacoes.jsonl")),
      reputacao: new RegistroReputacao({ arquivo: path.join(dirDados, "reputacao.json") }),
      backend:
        opcoes.backend ??
        (config.apiUrl && config.chaveDeServico
          ? new ClienteBackend({
              url: config.apiUrl,
              chave: config.chaveDeServico,
              timeoutMs: config.timeoutMs,
            })
          : null),
      opcoes,
    });
  }

  /**
   * Consolida o periodo e coloca a publicacao na fila.
   *
   * Nao toca na rede. Separar preparo de envio e o que permite consolidar mesmo
   * com a rede indisponivel e publicar depois, preservando o periodo original.
   *
   * @param {object} entrada
   * @param {string} entrada.apolice Endereco do contrato da apolice.
   * @param {number} entrada.periodo Periodo de referencia, em AAAAMMDD.
   * @param {object[]} entrada.leituras Leituras de campo do periodo e dos dias anteriores.
   * @param {object} [entrada.visao] Resultado do modulo de visao computacional.
   *
   * @returns {{consolidacao: object, entrada: object, novo: boolean, alertas: string[]}}
   */
  prepararPublicacao({ apolice, periodo, leituras, visao = null }) {
    const consolidacao = consolidarIndiceClimatico(leituras, {
      periodo,
      limiarChuvaMm: this.limiarChuvaMm,
      reputacao: this.reputacao,
      limiarReputacao: this.limiarReputacao,
    });

    this.reputacao.salvar();

    const alertas = [...consolidacao.alertas];
    let indiceDanoBps = 0;
    let confiancaBps = 0;
    let hashEvidencias = paraBytes32(`sem-evidencia-visual:${apolice}:${periodo}`);
    let versaoModelo = paraBytes32("sem-modelo");

    if (visao) {
      const confianca = visao.confianca ?? 0;

      if (confianca < this.limiarConfiancaModelo && !visao.liberadaPeloPerito) {
        // RF17: abaixo do limiar de confianca o resultado do modelo vai para o
        // perito e nao entra na publicacao. O indice climatico segue normalmente,
        // porque nao depende da inferencia.
        alertas.push(
          `RF17: confianca do modelo em ${(confianca * 100).toFixed(1)}%, abaixo do limiar de ` +
            `${(this.limiarConfiancaModelo * 100).toFixed(1)}%. O indice de dano nao sera publicado ` +
            "e o lote deve ser encaminhado ao perito.",
        );
      } else {
        indiceDanoBps = Math.round(visao.indiceDano * 10_000);
        confiancaBps = Math.round(confianca * 10_000);
        hashEvidencias = visao.hashEvidencias ?? paraBytes32(`lote:${apolice}:${periodo}`);
        versaoModelo = visao.versaoModelo ?? paraBytes32(visao.versao ?? "desconhecida");
      }
    }

    const payload = {
      indiceClimatico: consolidacao.indiceClimatico,
      indiceDanoBps,
      confiancaBps,
      hashEvidencias,
      versaoModelo,
      // Guardado junto com a publicacao para tornar a decisao reconstituivel (RNF20).
      procedencia: {
        fontesUsadas: consolidacao.fontesUsadas,
        fontesDescartadas: consolidacao.fontesDescartadas,
        leiturasValidas: consolidacao.leiturasValidas,
        leiturasDescartadas: consolidacao.leiturasDescartadas,
        interrompidoPor: consolidacao.interrompidoPor,
        limiarChuvaMm: this.limiarChuvaMm,
      },
    };

    const { entrada, novo } = this.fila.enfileirar({ apolice, periodo, payload });

    return { consolidacao, entrada, novo, alertas };
  }

  /**
   * Publica uma entrada da fila e registra o resultado.
   *
   * @returns {Promise<{sucesso: boolean, recibo?: object, erro?: Error}>}
   */
  async publicarEntrada(entrada) {
    this.fila.marcarPublicando(entrada);

    try {
      const recibo = await this.publicador.publicar({
        apolice: entrada.apolice,
        periodo: entrada.periodo,
        ...entrada.payload,
      });

      this.fila.marcarConcluida(entrada, {
        txHash: recibo.txHash,
        bloco: recibo.bloco,
        gasUsado: String(recibo.gasUsado),
        confirmadoEm: recibo.confirmadoEm,
      });

      const linha = this.registro.registrar({
        apolice: entrada.apolice,
        periodo: entrada.periodo,
        indices: {
          indiceClimatico: entrada.payload.indiceClimatico,
          indiceDanoBps: entrada.payload.indiceDanoBps,
          confiancaBps: entrada.payload.confiancaBps,
        },
        procedencia: entrada.payload.procedencia,
        txHash: recibo.txHash,
        gasEstimado: recibo.gasEstimado,
        gasUsado: recibo.gasUsado,
        custoWei: recibo.custoWei,
        bloco: recibo.bloco,
        oraculo: recibo.oraculo,
        enviadoEm: recibo.enviadoEm,
        confirmadoEm: recibo.confirmadoEm,
        acionouPagamento: recibo.acionouPagamento,
        tentativas: entrada.tentativas,
      });

      await this.relatar("relatarPublicacao", {
        apolice: entrada.apolice,
        periodo: entrada.periodo,
        txHash: recibo.txHash,
        indiceClimatico: entrada.payload.indiceClimatico,
        indiceDanoBps: entrada.payload.indiceDanoBps,
        confiancaBps: entrada.payload.confiancaBps,
        gasUsado: recibo.gasUsado,
        gasEstimado: recibo.gasEstimado,
        custoWei: recibo.custoWei,
        bloco: recibo.bloco,
        enviadoEm: recibo.enviadoEm,
        confirmadoEm: recibo.confirmadoEm,
        acionouPagamento: recibo.acionouPagamento,
        procedencia: entrada.payload.procedencia,
        oraculo: recibo.oraculo,
      });

      return { sucesso: true, recibo, linha };
    } catch (erro) {
      this.fila.marcarErro(entrada, erro);

      // So a falha definitiva vira notificacao. Uma tentativa que ainda vai ser
      // repetida nao e noticia; a quinta seguida, e.
      if (entrada.estado === ESTADOS.FALHA) {
        await this.relatar("relatarFalha", {
          apolice: entrada.apolice,
          periodo: entrada.periodo,
          motivo: erro?.shortMessage || erro?.message || String(erro),
          tentativas: entrada.tentativas,
        });
      }

      return { sucesso: false, erro };
    }
  }

  /**
   * Relata ao backend, quando houver um.
   *
   * Uma falha aqui NAO desfaz a publicacao: o indice ja esta na cadeia, e a cadeia
   * e a fonte da verdade — o indexador do backend vai encontrar o evento de
   * qualquer forma. O que se perderia seriam os metadados que so o oraculo tem
   * (gas estimado, latencia, procedencia), e eles continuam no registro local.
   */
  async relatar(metodo, dados) {
    if (!this.backend) return;

    try {
      await this.backend[metodo](dados);
    } catch (erro) {
      console.warn(`[oraculo] nao foi possivel relatar ao backend (${metodo}): ${erro.message}`);
    }
  }

  /**
   * Publica tudo o que estiver pendente na fila, com espera crescente entre as
   * tentativas (RF21).
   *
   * A espera dobra a cada tentativa. Em rede congestionada, repetir de imediato
   * so multiplica transacoes que vao falhar pelo mesmo motivo.
   *
   * @param {(evento: object) => void} [aoProgredir] Callback de acompanhamento.
   * @returns {Promise<{publicadas: number, falhas: number, detalhes: object[]}>}
   */
  async drenarFila(aoProgredir = () => {}) {
    const detalhes = [];
    let publicadas = 0;
    let falhas = 0;

    for (;;) {
      const entrada = this.fila.proxima();
      if (!entrada) break;

      if (entrada.tentativas > 0) {
        const espera = this.esperaBaseMs * 2 ** (entrada.tentativas - 1);
        aoProgredir({ tipo: "espera", chave: entrada.chave, ms: espera });
        await new Promise((r) => setTimeout(r, espera));
      }

      const resultado = await this.publicarEntrada(entrada);

      if (resultado.sucesso) {
        publicadas += 1;
        detalhes.push({ chave: entrada.chave, sucesso: true, recibo: resultado.recibo });
        aoProgredir({ tipo: "publicada", chave: entrada.chave, recibo: resultado.recibo });
      } else {
        aoProgredir({
          tipo: "erro",
          chave: entrada.chave,
          tentativa: entrada.tentativas,
          erro: resultado.erro,
        });

        if (entrada.estado === ESTADOS.FALHA) {
          falhas += 1;
          detalhes.push({ chave: entrada.chave, sucesso: false, erro: resultado.erro.message });
        }
      }
    }

    return { publicadas, falhas, detalhes };
  }

  /** Libera a conexao com o no, para que o processo possa terminar. */
  encerrar() {
    this.publicador.encerrar();
  }

  /** Consolida, enfileira e publica em um unico passo. */
  async processarPeriodo(entrada, aoProgredir) {
    const preparo = this.prepararPublicacao(entrada);
    const resultado = await this.drenarFila(aoProgredir);

    return { ...preparo, ...resultado };
  }
}

module.exports = { ServicoOraculo };
