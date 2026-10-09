import { ethers } from "ethers";

import { ABI_APOLICE, ABI_FACTORY, ABI_REGISTRY } from "./abis";
import { blocoInicial, enderecosDaRede } from "./rede";

/**
 * Leitura e escrita nos contratos.
 *
 * Todas as funcoes recebem explicitamente o provedor ou o signatario, em vez de
 * pegarem um global. Assim fica visivel, em cada chamada, se a operacao e de
 * leitura (funciona sem carteira) ou de escrita (exige assinatura).
 */

export function contratoFactory(provedorOuSignatario) {
  const enderecos = enderecosDaRede();

  if (!enderecos) {
    throw new Error(
      "Nenhum contrato implantado para esta rede. Rode o script de implantacao e depois `npm run enderecos`.",
    );
  }

  return new ethers.Contract(enderecos.ApoliceFactory, ABI_FACTORY, provedorOuSignatario);
}

export function contratoRegistry(provedorOuSignatario) {
  const enderecos = enderecosDaRede();

  if (!enderecos) throw new Error("Nenhum contrato implantado para esta rede.");

  return new ethers.Contract(enderecos.OracleRegistry, ABI_REGISTRY, provedorOuSignatario);
}

export function contratoApolice(endereco, provedorOuSignatario) {
  return new ethers.Contract(endereco, ABI_APOLICE, provedorOuSignatario);
}

/**
 * Blocos por consulta de eventos. Nos publicos limitam o intervalo de
 * `eth_getLogs`: o da Sepolia usado na demonstracao recusa 50 mil blocos, e o
 * plano gratuito de outros provedores aceita bem menos. Uma apolice de 180 dias
 * cobre cerca de 1,3 milhao de blocos; sem dividir, a linha do tempo parava de
 * abrir uma semana depois da emissao.
 */
export const BLOCOS_POR_CONSULTA = 10_000;
const CONSULTAS_SIMULTANEAS = 4;

// O no publico da Sepolia distribui os pedidos entre servidores que guardam
// historicos de tamanhos diferentes; o mesmo trecho e recusado por um ("pruned
// history unavailable") e respondido pelo seguinte. Para producao, o certo e um
// no com historico completo, em VITE_RPC_SEPOLIA (COMO-RODAR.md).
export const TENTATIVAS_POR_TRECHO = 4;

async function consultarTrecho(contrato, filtro, de, ate, espera) {
  for (let tentativa = 1; ; tentativa++) {
    try {
      return await contrato.queryFilter(filtro, de, ate);
    } catch (erro) {
      if (tentativa >= TENTATIVAS_POR_TRECHO) throw erro;
      await new Promise((r) => setTimeout(r, espera * tentativa));
    }
  }
}

/**
 * Eventos de `contrato` entre `desde` e o bloco atual, em trechos de
 * BLOCOS_POR_CONSULTA, no maximo CONSULTAS_SIMULTANEAS de cada vez.
 */
export async function eventosEmTrechos(contrato, filtro, desde, provedor, { espera = 300 } = {}) {
  const ate = await provedor.getBlockNumber();
  const trechos = [];
  for (let de = desde; de <= ate; de += BLOCOS_POR_CONSULTA) {
    trechos.push([de, Math.min(ate, de + BLOCOS_POR_CONSULTA - 1)]);
  }

  const resultados = new Array(trechos.length);
  let proximo = 0;
  await Promise.all(
    Array.from({ length: Math.min(CONSULTAS_SIMULTANEAS, trechos.length) }, async () => {
      while (proximo < trechos.length) {
        const i = proximo++;
        resultados[i] = await consultarTrecho(contrato, filtro, ...trechos[i], espera);
      }
    }),
  );

  return resultados.flat();
}

/** Converte a struct Termos devolvida pelo contrato em objeto simples. */
function normalizarTermos(bruto) {
  return {
    produtor: bruto.produtor,
    registry: bruto.registry,
    cultura: bruto.cultura,
    talhao: bruto.talhao,
    operador: Number(bruto.operador),
    modoPagamento: Number(bruto.modoPagamento),
    limiarClimatico: Number(bruto.limiarClimatico),
    limiarClimaticoIntegral: Number(bruto.limiarClimaticoIntegral),
    limiarDanoBps: Number(bruto.limiarDanoBps),
    limiarDanoIntegralBps: Number(bruto.limiarDanoIntegralBps),
    vigenciaInicio: Number(bruto.vigenciaInicio),
    vigenciaFim: Number(bruto.vigenciaFim),
    valorIndenizacao: bruto.valorIndenizacao,
    hashTermos: bruto.hashTermos,
  };
}

/**
 * Estado completo de uma apolice, em uma unica ida a rede por campo.
 *
 * As leituras vao em `Promise.all` de proposito: em Sepolia, seis chamadas em
 * sequencia somam quase um segundo de espera visivel na tela.
 */
export async function lerApolice(endereco, provedor) {
  const contrato = contratoApolice(endereco, provedor);

  const [termos, situacao, valorPago, periodoAcionador, garantiaRetida, total, seguradora] =
    await Promise.all([
      contrato.verTermos(),
      contrato.situacao(),
      contrato.valorPago(),
      contrato.periodoAcionador(),
      contrato.garantiaRetida(),
      contrato.totalPeriodos(),
      contrato.seguradora(),
    ]);

  return {
    endereco,
    seguradora,
    termos: normalizarTermos(termos),
    situacao: Number(situacao),
    valorPago,
    periodoAcionador: Number(periodoAcionador),
    garantiaRetida,
    totalPeriodos: Number(total),
  };
}

/** Todas as apolices emitidas pela fabrica, com o estado de cada uma. */
export async function listarApolices(provedor, { produtor = null } = {}) {
  const factory = contratoFactory(provedor);

  const enderecos = produtor
    ? await factory.apolicesDoProdutor(produtor)
    : await Promise.all(
        Array.from({ length: Number(await factory.totalApolices()) }, (_, i) =>
          factory.apolices(i),
        ),
      );

  return Promise.all(enderecos.map((endereco) => lerApolice(endereco, provedor)));
}

/** Publicacoes registradas em uma apolice, da mais recente para a mais antiga. */
export async function lerPublicacoes(endereco, provedor) {
  const contrato = contratoApolice(endereco, provedor);
  const total = Number(await contrato.totalPeriodos());

  const periodos = await Promise.all(Array.from({ length: total }, (_, i) => contrato.periodos(i)));

  const publicacoes = await Promise.all(
    periodos.map(async (periodo) => {
      const [bruto, retificado] = await Promise.all([
        contrato.publicacao(periodo),
        contrato.periodoRetificado(periodo),
      ]);

      // Retificacao depois de contestacao (RF28): fica ao lado da original.
      const r = retificado ? await contrato.retificacao(periodo) : null;

      return {
        periodo: Number(periodo),
        oraculo: bruto.oraculo,
        indiceClimatico: Number(bruto.indiceClimatico),
        indiceDanoBps: Number(bruto.indiceDanoBps),
        confiancaBps: Number(bruto.confiancaBps),
        publicadoEm: Number(bruto.publicadoEm),
        hashEvidencias: bruto.hashEvidencias,
        versaoModelo: bruto.versaoModelo,
        retificacao: r
          ? {
              indiceDanoBps: Number(r.indiceDanoBps),
              confiancaBps: Number(r.confiancaBps),
              publicadoEm: Number(r.publicadoEm),
              hashParecer: r.hashParecer,
            }
          : null,
      };
    }),
  );

  return publicacoes.sort((a, b) => b.periodo - a.periodo);
}

/**
 * Linha do tempo da apolice, reconstruida dos eventos da cadeia (RF09).
 *
 * Nada aqui vem de banco de dados: o historico e remontado a partir do que a
 * propria rede guarda, o que e justamente o que torna a decisao auditavel por
 * qualquer parte, sem depender da palavra da seguradora (RNF18).
 */
export async function lerLinhaDoTempo(endereco, provedor) {
  const contrato = contratoApolice(endereco, provedor);
  const desde = blocoInicial();

  const nomes = [
    "ApoliceImplantada",
    "GarantiaDepositada",
    "IndicesPublicados",
    "CondicaoAvaliada",
    "PagamentoExecutado",
    "GarantiaResgatada",
    "ApoliceCancelada", // RF10
    "IndiceRetificado", // RF28
  ];

  // Uma consulta por trecho para todos os eventos do contrato ("*"), e nao uma
  // por evento: oito vezes menos pedidos ao no.
  const eventos = (await eventosEmTrechos(contrato, "*", desde, provedor)).filter(
    (evento) => evento.fragment && nomes.includes(evento.fragment.name),
  );

  // Os blocos sao buscados uma unica vez por numero: varias publicacoes costumam
  // cair em blocos diferentes, mas os eventos de uma mesma transacao nao.
  const numerosDeBloco = [...new Set(eventos.map((e) => e.blockNumber))];
  const blocos = new Map(
    await Promise.all(
      numerosDeBloco.map(async (numero) => [numero, await provedor.getBlock(numero)]),
    ),
  );

  return eventos
    .map((evento) => ({
      nome: evento.fragment.name,
      bloco: evento.blockNumber,
      indiceNoBloco: evento.index,
      txHash: evento.transactionHash,
      em: blocos.get(evento.blockNumber)?.timestamp ?? null,
      argumentos: Object.fromEntries(
        evento.fragment.inputs.map((entrada, i) => [entrada.name, evento.args[i]]),
      ),
    }))
    .sort((a, b) => a.bloco - b.bloco || a.indiceNoBloco - b.indiceNoBloco);
}

/** Enderecos autorizados a publicar, lidos dos eventos do registro (RF18). */
export async function listarOraculos(provedor) {
  const registry = contratoRegistry(provedor);
  const desde = blocoInicial();

  const autorizados = await eventosEmTrechos(
    registry,
    registry.filters.OraculoAutorizado(),
    desde,
    provedor,
  );
  const candidatos = [...new Set(autorizados.map((evento) => evento.args[0]))];

  // O evento diz quem ja foi autorizado algum dia; so o estado atual do contrato
  // diz quem continua podendo publicar.
  return Promise.all(
    candidatos.map(async (endereco) => ({
      endereco,
      autorizado: await registry.ehAutorizado(endereco),
    })),
  );
}

/** Indicadores da carteira da seguradora (RF29). */
export function resumirCarteira(apolices) {
  const total = apolices.length;
  const ativas = apolices.filter((a) => a.situacao === 1).length;
  const liquidadas = apolices.filter((a) => a.situacao === 2).length;
  const aguardando = apolices.filter((a) => a.situacao === 0).length;
  const encerradas = apolices.filter((a) => a.situacao === 3).length;

  const exposicao = apolices.reduce((soma, a) => soma + a.garantiaRetida, 0n);
  const pago = apolices.reduce((soma, a) => soma + a.valorPago, 0n);
  const limiteTotal = apolices.reduce((soma, a) => soma + a.termos.valorIndenizacao, 0n);

  return {
    total,
    ativas,
    liquidadas,
    aguardando,
    encerradas,
    exposicao,
    pago,
    limiteTotal,
    taxaDeAcionamento: total > 0 ? liquidadas / total : 0,
  };
}
