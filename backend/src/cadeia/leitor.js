import { contratoApolice, enderecos, interfaceFactory, provedor } from "./rede.js";

/**
 * Leitor da cadeia usado pelas rotas.
 *
 * E um objeto com poucas operacoes, e nao chamadas espalhadas ao ethers, por uma
 * razao: os testes da API substituem este objeto por um falso. Assim a regra de
 * negocio — "so aceito a emissao se o hash do contrato bater com o da proposta" —
 * e testada sem precisar de um no rodando, e a conversa real com a cadeia fica
 * isolada aqui, verificada pelos testes de integracao e pela execucao ponta a
 * ponta.
 */
export function criarLeitorDaCadeia() {
  return {
    disponivel() {
      return Boolean(enderecos());
    },

    enderecoDaFabrica() {
      return enderecos()?.ApoliceFactory?.toLowerCase() ?? null;
    },

    /**
     * Instante atual segundo a cadeia, em segundos.
     *
     * A vigencia da apolice e conferida pelo contrato contra `block.timestamp`.
     * Se o backend usasse o proprio relogio, qualquer diferenca entre os dois —
     * comum em rede local, onde o tempo dos blocos pode ser adiantado nos testes —
     * faria a apolice nascer com vigencia que o contrato ve como futura ou vencida.
     */
    async instanteAtual() {
      const bloco = await provedor().getBlock("latest");
      return bloco.timestamp;
    },

    async recibo(txHash) {
      const r = await provedor().getTransactionReceipt(txHash);

      if (!r) return null;

      return {
        status: r.status,
        para: r.to?.toLowerCase() ?? null,
        bloco: r.blockNumber,
        logs: r.logs.map((log) => ({
          endereco: log.address.toLowerCase(),
          topics: log.topics,
          data: log.data,
        })),
      };
    },

    async termosDaApolice(endereco) {
      const c = contratoApolice(endereco);
      const [t, seguradora] = await Promise.all([c.verTermos(), c.seguradora()]);

      return {
        produtor: t.produtor.toLowerCase(),
        talhao: t.talhao,
        cultura: t.cultura,
        valorIndenizacao: t.valorIndenizacao.toString(),
        hashTermos: t.hashTermos,
        vigenciaInicio: Number(t.vigenciaInicio),
        vigenciaFim: Number(t.vigenciaFim),
        seguradora: seguradora.toLowerCase(),
      };
    },

    async estadoDaApolice(endereco) {
      const c = contratoApolice(endereco);
      const [situacao, valorPago, periodoAcionador] = await Promise.all([
        c.situacao(),
        c.valorPago(),
        c.periodoAcionador(),
      ]);

      return {
        situacao: Number(situacao),
        valorPago: valorPago.toString(),
        periodoAcionador: Number(periodoAcionador) || null,
      };
    },
  };
}

/**
 * Extrai o endereco da apolice do evento `ApoliceEmitida` de um recibo.
 *
 * So aceita o evento se ele veio da fabrica oficial. Um contrato qualquer pode
 * emitir um evento com o mesmo nome e os mesmos campos; o que prova a origem e o
 * endereco de quem emitiu o log.
 */
export function apoliceDoRecibo(recibo, enderecoDaFabrica) {
  for (const log of recibo.logs) {
    if (log.endereco !== enderecoDaFabrica) continue;

    try {
      const evento = interfaceFactory.parseLog({ topics: log.topics, data: log.data });

      if (evento?.name === "ApoliceEmitida") {
        return {
          endereco: evento.args.apolice.toLowerCase(),
          produtor: evento.args.produtor.toLowerCase(),
          hashTermos: evento.args.hashTermos,
        };
      }
    } catch {
      // Log de outro formato vindo da fabrica: ignora e segue.
    }
  }

  return null;
}
