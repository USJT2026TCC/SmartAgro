import { ethers } from "ethers";

import { BPS, SITUACAO } from "./regraDeGatilho";

/** Conversoes e formatacoes usadas pelas telas. */

/** Wei para ETH, com no maximo quatro casas. */
export function emEth(wei) {
  if (wei === undefined || wei === null) return "—";

  const texto = ethers.formatEther(wei);
  const numero = Number(texto);

  return `${numero.toLocaleString("pt-BR", { maximumFractionDigits: 4 })} ETH`;
}

/** Pontos-base para percentual legivel: 7500 vira "75%". */
export function emPercentual(bps) {
  const numero = Number(bps) / 100;

  return `${numero.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;
}

/** Fracao de 0 a 1 para pontos-base. */
export function paraBps(fracao) {
  return Math.round(Number(fracao) * BPS);
}

/** Endereco abreviado, para caber em tabela: 0x1234…abcd. */
export function enderecoCurto(endereco) {
  if (!endereco) return "—";

  return `${endereco.slice(0, 6)}…${endereco.slice(-4)}`;
}

/** Hash abreviado. */
export function hashCurto(hash) {
  if (!hash) return "—";

  return `${hash.slice(0, 10)}…${hash.slice(-6)}`;
}

/** Marca de tempo unix para data legivel. */
export function emData(segundos) {
  if (!segundos) return "—";

  return new Date(Number(segundos) * 1000).toLocaleDateString("pt-BR");
}

/** Marca de tempo unix para data e hora legiveis. */
export function emDataHora(segundos) {
  if (!segundos) return "—";

  return new Date(Number(segundos) * 1000).toLocaleString("pt-BR");
}

/** Periodo AAAAMMDD para data legivel. */
export function periodoEmData(periodo) {
  const texto = String(periodo);

  if (texto.length !== 8) return texto;

  return `${texto.slice(6, 8)}/${texto.slice(4, 6)}/${texto.slice(0, 4)}`;
}

/** Data para o identificador de periodo AAAAMMDD usado pelo oraculo. */
export function dataEmPeriodo(data) {
  const d = data instanceof Date ? data : new Date(data);
  const mes = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dia = String(d.getUTCDate()).padStart(2, "0");

  return Number(`${d.getUTCFullYear()}${mes}${dia}`);
}

/** Rotulo da situacao da apolice. */
export function rotuloSituacao(codigo) {
  return SITUACAO[Number(codigo)] ?? "DESCONHECIDA";
}

/** Texto curto e legivel para cada situacao, para o produtor. */
export function explicacaoSituacao(codigo) {
  return (
    {
      0: "Aguardando a seguradora depositar a garantia.",
      1: "Cobertura ativa. O oraculo pode publicar indices.",
      2: "Indenizacao paga. A apolice cumpriu seu proposito.",
      3: "Vigencia encerrada sem acionamento. Garantia devolvida.",
    }[Number(codigo)] ?? ""
  );
}

/** bytes32 para texto, tolerando valores que nao sao strings codificadas. */
export function deBytes32(valor) {
  try {
    return ethers.decodeBytes32String(valor);
  } catch {
    return hashCurto(valor);
  }
}

/** Texto para bytes32, usado em cultura e talhao. */
export function paraBytes32(texto) {
  return ethers.encodeBytes32String(String(texto).slice(0, 31));
}

/**
 * Traduz um erro vindo da carteira ou do contrato para uma frase util.
 *
 * Sem isso, a tela mostraria ao produtor coisas como
 * "execution reverted (unknown custom error)", que nao ajudam ninguem.
 */
export function mensagemDeErro(erro) {
  if (!erro) return "Erro desconhecido.";

  if (erro.code === "ACTION_REJECTED" || erro.code === 4001) {
    return "Voce cancelou a operacao na carteira.";
  }

  const nome = erro.revert?.name ?? erro.errorName;
  const args = erro.revert?.args ?? erro.errorArgs ?? [];

  const traducoes = {
    OrigemNaoAutorizada: "Este endereco nao tem permissao para essa operacao.",
    SituacaoInvalida: "A apolice nao esta na situacao necessaria para essa operacao.",
    PeriodoJaPublicado: "Esse periodo ja foi publicado nesta apolice.",
    ForaDaVigencia: "A data esta fora da vigencia contratada.",
    GarantiaIncorreta: "O valor enviado e diferente do limite contratado.",
    VigenciaEmCurso: "A vigencia ainda nao terminou; a garantia so pode ser resgatada depois.",
    FalhaNaTransferencia: "A transferencia para a carteira de destino falhou.",
    NaoEhSeguradora: "Apenas a carteira da seguradora pode fazer isso.",
    JaAutorizado: "Esse endereco ja esta autorizado.",
    NaoAutorizado: "Esse endereco nao esta autorizado.",
    ParametroInvalido: `Parametro invalido: ${args[0] ?? "verifique os campos"}.`,
    DepositoDireto: "Este contrato nao aceita transferencia direta; use o deposito de garantia.",
  };

  if (nome && traducoes[nome]) return traducoes[nome];

  if (erro.code === "INSUFFICIENT_FUNDS") {
    return "Saldo insuficiente na carteira para pagar a transacao.";
  }

  return erro.shortMessage || erro.message || String(erro);
}
