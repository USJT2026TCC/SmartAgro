"use strict";

/**
 * Interface minima da apolice, do ponto de vista do oraculo.
 *
 * Contem apenas o que o servico precisa chamar e escutar, e nao a ABI completa
 * gerada pelo Hardhat. A escolha e deliberada: o oraculo passa a depender do
 * contrato da apolice, e nao dos artefatos de compilacao de outro diretorio.
 * Se uma assinatura mudar, a falha aparece aqui, de forma explicita, em vez de
 * surgir como um erro obscuro de decodificacao em tempo de execucao.
 *
 * Qualquer alteracao nas funcoes abaixo precisa ser espelhada em
 * contratos/contracts/ApolicePolicy.sol.
 */
const ABI_APOLICE = [
  // --- escrita -------------------------------------------------------------
  "function publicarIndices(uint256 periodo, uint32 indiceClimatico, uint16 indiceDanoBps, uint16 confiancaBps, bytes32 hashEvidencias, bytes32 versaoModelo)",

  // --- leitura -------------------------------------------------------------
  "function situacao() view returns (uint8)",
  "function periodoPublicado(uint256 periodo) view returns (bool)",
  "function valorPago() view returns (uint256)",
  "function periodoAcionador() view returns (uint256)",
  "function garantiaRetida() view returns (uint256)",
  "function totalPeriodos() view returns (uint256)",
  "function simularPercentual(uint32 indiceClimatico, uint16 indiceDanoBps) view returns (uint16)",

  // --- eventos -------------------------------------------------------------
  "event IndicesPublicados(uint256 indexed periodo, address indexed oraculo, uint32 indiceClimatico, uint16 indiceDanoBps, uint16 confiancaBps, bytes32 hashEvidencias, bytes32 versaoModelo)",
  "event CondicaoAvaliada(uint256 indexed periodo, bool atendida, uint16 percentualBps)",
  "event PagamentoExecutado(address indexed produtor, uint256 indexed periodo, uint256 valor)",

  // --- erros customizados --------------------------------------------------
  // Declarados para que o ethers traduza a revert em mensagem legivel no log,
  // em vez de devolver apenas os quatro bytes do seletor.
  "error OrigemNaoAutorizada(address chamador)",
  "error PeriodoJaPublicado(uint256 periodo)",
  "error SituacaoInvalida(uint8 atual, uint8 esperada)",
  "error ForaDaVigencia(uint64 agora, uint64 inicio, uint64 fim)",
  "error ParametroInvalido(string campo)",
  "error FalhaNaTransferencia(address destino, uint256 valor)",
  "error ReentranciaDetectada()",
];

const ABI_REGISTRY = [
  "function ehAutorizado(address oraculo) view returns (bool)",
  "function seguradora() view returns (address)",
  "function totalAutorizados() view returns (uint256)",
];

/** Rotulos das situacoes da apolice, na ordem do enum em Solidity. */
const SITUACOES = ["AGUARDANDO_GARANTIA", "ATIVA", "LIQUIDADA", "ENCERRADA"];

module.exports = { ABI_APOLICE, ABI_REGISTRY, SITUACOES };
