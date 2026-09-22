import { ethers } from "ethers";

import { config, lerImplantacao } from "../config.js";
import { registrarApoliceEmitida } from "../dominio/apolices.js";
import {
  argumentosDoEvento,
  contratoApolice,
  interfaceApolice,
  interfaceFactory,
  interfaceRegistry,
  provedor,
} from "./rede.js";

/**
 * Indexador de eventos da cadeia.
 *
 * Varre os blocos novos, guarda os eventos dos contratos e reage a eles: registra
 * apolices emitidas, atualiza a situacao de cada uma, confirma as publicacoes que
 * o oraculo relatou e gera as notificacoes (RF27).
 *
 * POR QUE VARRER, E NAO ESCUTAR
 *
 * O `contract.on(...)` do ethers so ve o que acontece enquanto o processo esta de
 * pe. Se o backend reinicia no momento de um pagamento, o evento se perde. O
 * indexador guarda o ultimo bloco processado no banco e, ao voltar, continua dali
 * — nenhum evento fica de fora, o que e o mesmo principio do RNF22 aplicado ao
 * caminho de volta, da cadeia para o sistema.
 *
 * IDEMPOTENCIA
 *
 * Cada evento e identificado por (transacao, indice do log). Reprocessar um trecho
 * de blocos — por uma queda no meio da varredura, por exemplo — nao duplica nada:
 * nem evento, nem notificacao, nem apolice.
 */

/** Quantos blocos por consulta. Provedores publicos costumam limitar a faixa. */
const BLOCOS_POR_CONSULTA = 2_000;

/**
 * Notificacoes geradas por evento. Cada entrada devolve a lista de mensagens a
 * criar; o destinatario e resolvido pela carteira ou pelo perfil.
 */
function notificacoesDoEvento(nome, args, apolice) {
  switch (nome) {
    case "ApoliceEmitida":
      return [
        {
          para: { carteira: args.produtor },
          tipo: "apolice_emitida",
          titulo: "Apolice emitida",
          mensagem: "Sua apolice foi implantada na rede. Falta a seguradora depositar a garantia.",
        },
      ];

    case "GarantiaDepositada":
      return [
        {
          para: { carteira: apolice?.produtor_carteira },
          tipo: "cobertura_ativa",
          titulo: "Cobertura ativa",
          mensagem: `A garantia de ${ethers.formatEther(args.valor)} ETH foi depositada. A cobertura esta ativa.`,
        },
      ];

    case "PagamentoExecutado":
      return [
        {
          para: { carteira: args.produtor },
          tipo: "indenizacao_paga",
          titulo: "Indenizacao paga",
          mensagem: `${ethers.formatEther(args.valor)} ETH foram transferidos para sua carteira, sem necessidade de vistoria.`,
        },
        {
          para: { perfil: "seguradora" },
          tipo: "apolice_liquidada",
          titulo: "Apolice liquidada",
          mensagem: `Uma apolice foi acionada e pagou ${ethers.formatEther(args.valor)} ETH no periodo ${args.periodo}.`,
        },
      ];

    case "GarantiaResgatada":
      return [
        {
          para: { perfil: "seguradora" },
          tipo: "garantia_resgatada",
          titulo: "Garantia resgatada",
          mensagem: `${ethers.formatEther(args.valor)} ETH voltaram para a carteira da seguradora.`,
        },
      ];

    default:
      return [];
  }
}

async function notificar(tx, evento, apolice, txHash, enderecoApolice) {
  for (const n of notificacoesDoEvento(evento.nome, evento.argumentos, apolice)) {
    let destinatarios = [];

    if (n.para.carteira) {
      const { rows } = await tx.query("SELECT id FROM usuarios WHERE carteira = $1", [
        n.para.carteira.toLowerCase(),
      ]);
      destinatarios = rows;
    } else if (n.para.perfil) {
      const { rows } = await tx.query("SELECT id FROM usuarios WHERE perfil = $1", [n.para.perfil]);
      destinatarios = rows;
    }

    for (const { id } of destinatarios) {
      await tx.query(
        `INSERT INTO notificacoes (usuario_id, tipo, titulo, mensagem, apolice_endereco, tx_hash)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (usuario_id, tipo, tx_hash) DO NOTHING`,
        [id, n.tipo, n.titulo, n.mensagem, enderecoApolice, txHash],
      );
    }
  }
}

/**
 * Cria o indexador.
 *
 * @param {import("../banco/conexao.js").Banco} banco
 * @param {object} [opcoes]
 * @param {number} [opcoes.intervaloMs]
 * @param {number} [opcoes.confirmacoes] Blocos de folga contra reorganizacao.
 */
export function criarIndexador(banco, opcoes = {}) {
  const intervaloMs = opcoes.intervaloMs ?? config.intervaloDoIndexador;
  const confirmacoes = opcoes.confirmacoes ?? (config.rede === "localhost" ? 0 : 2);

  let temporizador = null;
  let varrendo = false;
  let ultimoErro = null;

  const cacheDeBlocos = new Map();

  async function instanteDoBloco(numero) {
    if (!cacheDeBlocos.has(numero)) {
      const bloco = await provedor().getBlock(numero);
      cacheDeBlocos.set(numero, bloco ? new Date(bloco.timestamp * 1000) : null);

      // O cache so precisa cobrir a varredura corrente.
      if (cacheDeBlocos.size > 5_000) cacheDeBlocos.clear();
    }

    return cacheDeBlocos.get(numero);
  }

  async function gravarEvento(tx, contrato, log, parseado) {
    const argumentos = argumentosDoEvento(parseado.fragment, parseado.args);

    const { rowCount } = await tx.query(
      `INSERT INTO eventos_cadeia (contrato, nome, bloco, indice_log, tx_hash, argumentos, instante)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (tx_hash, indice_log) DO NOTHING`,
      [
        contrato,
        parseado.name,
        log.blockNumber,
        log.index,
        log.transactionHash,
        JSON.stringify(argumentos),
        await instanteDoBloco(log.blockNumber),
      ],
    );

    return { nome: parseado.name, argumentos, novo: rowCount > 0 };
  }

  /** Processa um trecho de blocos. */
  async function processarTrecho(implantacao, de, ate) {
    const fabrica = implantacao.contratos.ApoliceFactory.toLowerCase();
    const registro = implantacao.contratos.OracleRegistry.toLowerCase();

    // 1. Primeiro as emissoes. Uma apolice emitida neste trecho pode ter, no
    //    mesmo trecho, o deposito da garantia; ela precisa entrar na lista de
    //    enderecos observados antes da consulta dos eventos dela.
    const logsDaFabrica = await provedor().getLogs({
      address: fabrica,
      fromBlock: de,
      toBlock: ate,
    });

    for (const log of logsDaFabrica) {
      const parseado = interfaceFactory.parseLog(log);
      if (parseado?.name !== "ApoliceEmitida") continue;

      const evento = await banco.transacao((tx) => gravarEvento(tx, fabrica, log, parseado));
      const enderecoApolice = parseado.args.apolice.toLowerCase();

      const contrato = contratoApolice(enderecoApolice);
      const seguradora = await contrato.seguradora();

      await registrarApoliceEmitida(banco, {
        endereco: enderecoApolice,
        produtor: parseado.args.produtor,
        seguradora,
        hashTermos: parseado.args.hashTermos,
        talhaoBytes32: parseado.args.talhao,
        valorIndenizacaoWei: parseado.args.valorIndenizacao.toString(),
        txHash: log.transactionHash,
        bloco: log.blockNumber,
      });

      if (evento.novo) {
        await banco.transacao((tx) =>
          notificar(tx, evento, null, log.transactionHash, enderecoApolice),
        );
      }
    }

    // 2. Eventos das apolices e do registro de oraculos.
    const { rows: apolices } = await banco.query(
      "SELECT endereco, produtor_carteira FROM apolices",
    );
    const porEndereco = new Map(apolices.map((a) => [a.endereco, a]));

    const observados = [registro, ...porEndereco.keys()];
    const logs = await provedor().getLogs({ address: observados, fromBlock: de, toBlock: ate });

    const afetadas = new Set();

    for (const log of logs) {
      const origem = log.address.toLowerCase();
      const ehRegistro = origem === registro;
      const parseado = (ehRegistro ? interfaceRegistry : interfaceApolice).parseLog(log);

      if (!parseado) continue;

      await banco.transacao(async (tx) => {
        const evento = await gravarEvento(tx, origem, log, parseado);

        if (ehRegistro || !evento.novo) return;

        afetadas.add(origem);

        // O relato do oraculo so vira fato confirmado quando o evento aparece na
        // cadeia. Ate la, e so a palavra do oraculo.
        if (evento.nome === "IndicesPublicados") {
          await tx.query(
            `UPDATE publicacoes_oraculo SET confirmada_na_cadeia = true
              WHERE apolice_endereco = $1 AND periodo = $2`,
            [origem, Number(evento.argumentos.periodo)],
          );
        }

        await notificar(tx, evento, porEndereco.get(origem), log.transactionHash, origem);
      });
    }

    // 3. A situacao de cada apolice afetada e relida do contrato, que e a fonte
    //    da verdade. Deduzi-la dos eventos funcionaria, mas duplicaria no backend
    //    a maquina de estados que ja existe, testada, no contrato.
    for (const endereco of afetadas) {
      const c = contratoApolice(endereco);
      const [situacao, valorPago, periodoAcionador] = await Promise.all([
        c.situacao(),
        c.valorPago(),
        c.periodoAcionador(),
      ]);

      await banco.query(
        `UPDATE apolices SET situacao = $2, valor_pago_wei = $3, periodo_acionador = $4
          WHERE endereco = $1`,
        [endereco, Number(situacao), valorPago.toString(), Number(periodoAcionador) || null],
      );
    }

    return { eventos: logsDaFabrica.length + logs.length, apolicesAtualizadas: afetadas.size };
  }

  /**
   * Uma varredura: do ultimo bloco processado ate o mais recente confirmado.
   * @returns {Promise<{de?: number, ate?: number, eventos: number}>}
   */
  async function varrer() {
    if (varrendo) return { eventos: 0, ignorada: true };
    varrendo = true;

    try {
      const implantacao = lerImplantacao();
      if (!implantacao) return { eventos: 0, semImplantacao: true };

      // A chave inclui o endereco da fabrica: reimplantar os contratos em rede
      // local recomeca a indexacao, em vez de continuar de um bloco que pertence
      // a uma cadeia que ja nao existe.
      const chave = `${implantacao.rede}:${implantacao.contratos.ApoliceFactory.toLowerCase()}`;

      const { rows } = await banco.query(
        "SELECT ultimo_bloco FROM estado_indexador WHERE chave = $1",
        [chave],
      );

      let ultimo = rows[0]
        ? Number(rows[0].ultimo_bloco)
        : Number(implantacao.blocoInicial ?? 0) - 1;
      const topo = (await provedor().getBlockNumber()) - confirmacoes;

      if (topo <= ultimo) return { eventos: 0 };

      let totalDeEventos = 0;
      const inicio = ultimo + 1;

      while (ultimo < topo) {
        const de = ultimo + 1;
        const ate = Math.min(topo, de + BLOCOS_POR_CONSULTA - 1);

        const { eventos } = await processarTrecho(implantacao, de, ate);
        totalDeEventos += eventos;

        await banco.query(
          `INSERT INTO estado_indexador (chave, ultimo_bloco) VALUES ($1, $2)
           ON CONFLICT (chave) DO UPDATE SET ultimo_bloco = EXCLUDED.ultimo_bloco`,
          [chave, ate],
        );

        ultimo = ate;
      }

      ultimoErro = null;

      return { de: inicio, ate: topo, eventos: totalDeEventos };
    } catch (erro) {
      // No fora do ar nao derruba o backend: a proxima varredura tenta de novo, a
      // partir do mesmo bloco, porque o progresso so e gravado depois de cada
      // trecho concluido.
      ultimoErro = { mensagem: erro.shortMessage || erro.message, em: new Date().toISOString() };
      return { eventos: 0, erro: ultimoErro.mensagem };
    } finally {
      varrendo = false;
    }
  }

  return {
    varrer,
    iniciar() {
      if (temporizador) return;

      const ciclo = async () => {
        await varrer();
        temporizador = setTimeout(ciclo, intervaloMs);
      };

      temporizador = setTimeout(ciclo, 0);
    },
    parar() {
      clearTimeout(temporizador);
      temporizador = null;
    },
    estado() {
      return { ativo: Boolean(temporizador), ultimoErro };
    },
  };
}
