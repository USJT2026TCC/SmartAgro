"use strict";

const { ethers } = require("ethers");

const { ABI_APOLICE, ABI_REGISTRY, SITUACOES } = require("./abi");

/**
 * Travessia da fronteira: assina e submete os indices a cadeia (RF19, RF22).
 *
 * Esta e a unica classe do servico que fala com a rede. A separacao e proposital:
 * a regra de consolidacao fica em `consolidador.js`, testavel sem blockchain, e
 * aqui ficam apenas assinatura, envio e leitura do recibo.
 *
 * A chave privada vem de variavel de ambiente e nunca e escrita em log (RNF16).
 */
class Publicador {
  /**
   * @param {object} opcoes
   * @param {string} opcoes.rpcUrl Endpoint JSON-RPC da rede.
   * @param {string} opcoes.chavePrivada Chave do endereco autorizado no registro.
   * @param {number} [opcoes.confirmacoes=1] Confirmacoes aguardadas.
   */
  constructor({ rpcUrl, chavePrivada, confirmacoes = 1, timeoutMs = 10_000, chainId = null }) {
    if (!rpcUrl) throw new Error("Publicador exige rpcUrl");
    if (!chavePrivada) throw new Error("Publicador exige a chave privada do oraculo");

    // O tempo limite padrao do ethers para uma requisicao e de 300 segundos, e
    // na deteccao inicial de rede ele ainda repete a tentativa varias vezes. Com
    // o no fora do ar, o servico simplesmente travaria, em vez de falhar e
    // devolver a publicacao a fila. Como o RNF22 exige que a indisponibilidade da
    // rede nao cause perda de dados, o que importa aqui e falhar rapido: a
    // entrada continua na fila e a proxima tentativa vem com espera crescente.
    const requisicao = new ethers.FetchRequest(rpcUrl);
    requisicao.timeout = timeoutMs;
    requisicao.retryFunc = async () => false;

    this.provider = new ethers.JsonRpcProvider(requisicao, chainId ?? undefined, {
      staticNetwork: Boolean(chainId),
      batchMaxCount: 1,
    });

    this.signatario = new ethers.Wallet(chavePrivada, this.provider);

    // O oraculo publica varios periodos em sequencia. Consultar o nonce na rede a
    // cada envio nao funciona: entre duas publicacoes seguidas, o no ainda nao
    // contabilizou a transacao anterior e devolve o mesmo numero, o que faz a
    // segunda transacao ser recusada com "nonce has already been used".
    // O NonceManager mantem a contagem localmente e resolve isso.
    this.carteira = new ethers.NonceManager(this.signatario);
    this.confirmacoes = confirmacoes;
  }

  /** Endereco publico do oraculo. Seguro para log; a chave privada nunca e exposta. */
  get endereco() {
    return this.signatario.address;
  }

  /** Saldo do oraculo, em wei. Sem saldo, nenhuma publicacao acontece. */
  async saldo() {
    return this.provider.getBalance(this.signatario.address);
  }

  /**
   * Confere se este oraculo continua autorizado no registro (RF18).
   *
   * Vale checar antes de montar uma transacao: a seguradora pode ter revogado o
   * endereco, e descobrir isso por uma revert custa gas a toa.
   */
  async estaAutorizado(enderecoRegistry) {
    const registry = new ethers.Contract(enderecoRegistry, ABI_REGISTRY, this.provider);

    return registry.ehAutorizado(this.signatario.address);
  }

  /**
   * Libera a conexao com o no.
   *
   * O provedor mantem um temporizador interno de sondagem. Sem esta chamada, um
   * comando de linha de comando termina de imprimir o resultado e nao devolve o
   * terminal: o processo continua vivo por causa do temporizador.
   */
  encerrar() {
    this.provider.destroy();
  }

  /** Situacao atual de uma apolice, como rotulo legivel. */
  async situacaoDaApolice(enderecoApolice) {
    const apolice = new ethers.Contract(enderecoApolice, ABI_APOLICE, this.provider);

    return SITUACOES[Number(await apolice.situacao())];
  }

  /** Se o periodo ja foi publicado nessa apolice (RF20). */
  async periodoJaPublicado(enderecoApolice, periodo) {
    const apolice = new ethers.Contract(enderecoApolice, ABI_APOLICE, this.provider);

    return apolice.periodoPublicado(periodo);
  }

  /**
   * Publica os indices do periodo em uma unica transacao (RF19).
   *
   * A chamada e simulada com `staticCall` antes do envio. Isso antecipa as
   * rejeicoes previsiveis — endereco revogado, periodo duplicado, apolice fora de
   * vigencia — sem gastar gas, e devolve o erro customizado do contrato ja
   * decodificado, em vez de um seletor de quatro bytes.
   *
   * @returns {Promise<object>} Recibo com txHash, gas, custo, bloco e latencia.
   */
  async publicar({
    apolice: enderecoApolice,
    periodo,
    indiceClimatico,
    indiceDanoBps = 0,
    confiancaBps = 0,
    hashEvidencias = ethers.ZeroHash,
    versaoModelo = ethers.ZeroHash,
  }) {
    const apolice = new ethers.Contract(enderecoApolice, ABI_APOLICE, this.carteira);

    const argumentos = [
      periodo,
      indiceClimatico,
      indiceDanoBps,
      confiancaBps,
      hashEvidencias,
      versaoModelo,
    ];

    let recibo;
    let gasEstimado;
    let enviadoEm;
    let confirmadoEm;

    try {
      // Ensaio sem custo. Se a transacao fosse reverter, o erro aparece aqui.
      await apolice.publicarIndices.staticCall(...argumentos);

      gasEstimado = await apolice.publicarIndices.estimateGas(...argumentos);

      enviadoEm = new Date().toISOString();
      const transacao = await apolice.publicarIndices(...argumentos);

      recibo = await transacao.wait(this.confirmacoes);
      confirmadoEm = new Date().toISOString();
    } catch (erro) {
      // O NonceManager ja pode ter incrementado a contagem local para uma
      // transacao que nunca chegou a rede. Sem devolver o contador ao valor real,
      // toda tentativa seguinte herdaria o desalinhamento.
      this.carteira.reset();
      throw erro;
    }

    // O contrato emite PagamentoExecutado na mesma transacao quando a condicao e
    // atendida. Detectar isso aqui evita uma consulta extra a rede.
    const acionouPagamento = recibo.logs.some((log) => {
      try {
        return apolice.interface.parseLog(log)?.name === "PagamentoExecutado";
      } catch {
        return false;
      }
    });

    return {
      txHash: recibo.hash,
      bloco: recibo.blockNumber,
      gasEstimado: gasEstimado.toString(),
      gasUsado: recibo.gasUsed,
      custoWei: recibo.gasUsed * recibo.gasPrice,
      enviadoEm,
      confirmadoEm,
      acionouPagamento,
      oraculo: this.signatario.address,
    };
  }

  /**
   * Escuta os eventos de uma apolice (HU06, criterio de aceite 4).
   *
   * @param {string} enderecoApolice
   * @param {(evento: object) => void} aoReceber
   * @returns {Promise<() => void>} Funcao que encerra a escuta.
   */
  async ouvir(enderecoApolice, aoReceber) {
    const apolice = new ethers.Contract(enderecoApolice, ABI_APOLICE, this.provider);

    const tratar =
      (nome) =>
      (...args) => {
        const evento = args[args.length - 1];

        aoReceber({
          evento: nome,
          apolice: enderecoApolice,
          argumentos: evento?.args
            ? Object.fromEntries(
                evento.fragment.inputs.map((entrada, i) => [entrada.name, evento.args[i]]),
              )
            : {},
          txHash: evento?.log?.transactionHash ?? evento?.transactionHash ?? null,
          bloco: evento?.log?.blockNumber ?? evento?.blockNumber ?? null,
        });
      };

    await apolice.on("IndicesPublicados", tratar("IndicesPublicados"));
    await apolice.on("CondicaoAvaliada", tratar("CondicaoAvaliada"));
    await apolice.on("PagamentoExecutado", tratar("PagamentoExecutado"));

    return () => apolice.removeAllListeners();
  }
}

/** Converte um texto em bytes32, para hash de evidencias e versao de modelo. */
function paraBytes32(texto) {
  return ethers.keccak256(ethers.toUtf8Bytes(String(texto)));
}

module.exports = { Publicador, paraBytes32 };
