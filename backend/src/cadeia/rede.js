import { ethers } from "ethers";

import { config, lerImplantacao } from "../config.js";
import { ABI_APOLICE, ABI_FACTORY, ABI_REGISTRY } from "./abis.js";

/**
 * Acesso somente leitura a cadeia.
 *
 * O backend nunca assina transacao. Quem emite apolice e a carteira da
 * seguradora, no navegador; quem publica indice e o oraculo, com a chave dele.
 * O backend le, confere e indexa — e por isso nao tem, nem precisa ter, chave
 * privada nenhuma. Menos segredo guardado e menos segredo para vazar.
 */

let provedorCompartilhado = null;

/**
 * Provedor com tempo limite curto e sem repeticao automatica — pela mesma razao
 * do oraculo: com o no fora do ar, o padrao do ethers trava por minutos em vez de
 * falhar e deixar a proxima varredura tentar de novo.
 */
export function provedor() {
  if (provedorCompartilhado) return provedorCompartilhado;

  const implantacao = lerImplantacao();
  const requisicao = new ethers.FetchRequest(config.rpcUrl);
  requisicao.timeout = 10_000;
  requisicao.retryFunc = async () => false;

  const chainId = implantacao?.chainId;

  provedorCompartilhado = new ethers.JsonRpcProvider(requisicao, chainId ?? undefined, {
    staticNetwork: Boolean(chainId),
    batchMaxCount: 1,
  });

  return provedorCompartilhado;
}

export function encerrarProvedor() {
  provedorCompartilhado?.destroy();
  provedorCompartilhado = null;
}

/** Enderecos dos contratos, ou nulo se nada foi implantado na rede configurada. */
export function enderecos() {
  return lerImplantacao()?.contratos ?? null;
}

export const interfaceFactory = new ethers.Interface(ABI_FACTORY);
export const interfaceApolice = new ethers.Interface(ABI_APOLICE);
export const interfaceRegistry = new ethers.Interface(ABI_REGISTRY);

export function contratoApolice(endereco, conexao = provedor()) {
  return new ethers.Contract(endereco, ABI_APOLICE, conexao);
}

export function contratoFactory(conexao = provedor()) {
  const e = enderecos();
  if (!e) return null;

  return new ethers.Contract(e.ApoliceFactory, ABI_FACTORY, conexao);
}

export function contratoRegistry(conexao = provedor()) {
  const e = enderecos();
  if (!e) return null;

  return new ethers.Contract(e.OracleRegistry, ABI_REGISTRY, conexao);
}

/** Converte os argumentos de um evento decodificado em objeto JSON serializavel. */
export function argumentosDoEvento(fragmento, args) {
  return Object.fromEntries(
    fragmento.inputs.map((entrada, i) => {
      const valor = args[i];

      // BigInt nao cabe em JSON. Vira texto decimal, sem perda.
      return [entrada.name, typeof valor === "bigint" ? valor.toString() : valor];
    }),
  );
}
