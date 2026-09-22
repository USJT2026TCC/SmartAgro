/**
 * Interfaces dos contratos, do ponto de vista do backend.
 *
 * Como no oraculo e no aplicativo, declaradas a mao: o backend depende do
 * contrato, e nao dos artefatos de compilacao de outro diretorio. Qualquer
 * alteracao em contratos/contracts/ precisa ser espelhada aqui.
 */

const TUPLA_TERMOS =
  "(address produtor,address registry,bytes32 cultura,bytes32 talhao,uint8 operador,uint8 modoPagamento,uint32 limiarClimatico,uint32 limiarClimaticoIntegral,uint16 limiarDanoBps,uint16 limiarDanoIntegralBps,uint64 vigenciaInicio,uint64 vigenciaFim,uint256 valorIndenizacao,bytes32 hashTermos)";

export const ABI_FACTORY = [
  "function seguradora() view returns (address)",
  "function totalApolices() view returns (uint256)",
  "function apolices(uint256) view returns (address)",
  "event ApoliceEmitida(address indexed apolice, address indexed produtor, bytes32 indexed talhao, uint256 valorIndenizacao, bytes32 hashTermos)",
];

export const ABI_APOLICE = [
  `function verTermos() view returns (${TUPLA_TERMOS})`,
  "function seguradora() view returns (address)",
  "function situacao() view returns (uint8)",
  "function valorPago() view returns (uint256)",
  "function periodoAcionador() view returns (uint256)",
  "function garantiaRetida() view returns (uint256)",
  "event GarantiaDepositada(address indexed seguradora, uint256 valor)",
  "event IndicesPublicados(uint256 indexed periodo, address indexed oraculo, uint32 indiceClimatico, uint16 indiceDanoBps, uint16 confiancaBps, bytes32 hashEvidencias, bytes32 versaoModelo)",
  "event CondicaoAvaliada(uint256 indexed periodo, bool atendida, uint16 percentualBps)",
  "event PagamentoExecutado(address indexed produtor, uint256 indexed periodo, uint256 valor)",
  "event GarantiaResgatada(address indexed seguradora, uint256 valor)",
];

export const ABI_REGISTRY = [
  "function ehAutorizado(address oraculo) view returns (bool)",
  "event OraculoAutorizado(address indexed oraculo, address indexed porQuem)",
  "event OraculoRevogado(address indexed oraculo, address indexed porQuem)",
];
