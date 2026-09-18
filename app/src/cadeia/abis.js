/**
 * Interfaces dos contratos, do ponto de vista do aplicativo.
 *
 * Como no servico de oraculo, sao declaradas a mao em vez de lidas dos artefatos
 * de compilacao do Hardhat. O aplicativo passa a depender do contrato, e nao do
 * diretorio de build de outro modulo — e uma assinatura que mudou aparece como
 * erro explicito aqui, nao como um `undefined` silencioso na tela.
 *
 * Qualquer alteracao precisa ser espelhada em contratos/contracts/.
 */

export const ABI_FACTORY = [
  "function emitirApolice((address produtor,address registry,bytes32 cultura,bytes32 talhao,uint8 operador,uint8 modoPagamento,uint32 limiarClimatico,uint32 limiarClimaticoIntegral,uint16 limiarDanoBps,uint16 limiarDanoIntegralBps,uint64 vigenciaInicio,uint64 vigenciaFim,uint256 valorIndenizacao,bytes32 hashTermos) termos) returns (address)",
  "function apolices(uint256) view returns (address)",
  "function totalApolices() view returns (uint256)",
  "function apolicesDoProdutor(address produtor) view returns (address[])",
  "function apolicesDoTalhao(bytes32 talhao) view returns (address[])",
  "function seguradora() view returns (address)",
  "function registry() view returns (address)",
  "event ApoliceEmitida(address indexed apolice, address indexed produtor, bytes32 indexed talhao, uint256 valorIndenizacao, bytes32 hashTermos)",
  "error NaoEhSeguradora(address chamador)",
  "error EnderecoInvalido()",
];

export const ABI_APOLICE = [
  "function seguradora() view returns (address)",
  "function situacao() view returns (uint8)",
  "function valorPago() view returns (uint256)",
  "function periodoAcionador() view returns (uint256)",
  "function garantiaRetida() view returns (uint256)",
  "function totalPeriodos() view returns (uint256)",
  "function periodos(uint256) view returns (uint256)",
  "function periodoPublicado(uint256) view returns (bool)",
  "function simularPercentual(uint32 indiceClimatico, uint16 indiceDanoBps) view returns (uint16)",
  "function verTermos() view returns ((address produtor,address registry,bytes32 cultura,bytes32 talhao,uint8 operador,uint8 modoPagamento,uint32 limiarClimatico,uint32 limiarClimaticoIntegral,uint16 limiarDanoBps,uint16 limiarDanoIntegralBps,uint64 vigenciaInicio,uint64 vigenciaFim,uint256 valorIndenizacao,bytes32 hashTermos))",
  "function publicacao(uint256 periodo) view returns ((address oraculo,uint32 indiceClimatico,uint16 indiceDanoBps,uint16 confiancaBps,uint32 publicadoEm,bytes32 hashEvidencias,bytes32 versaoModelo))",
  "function depositarGarantia() payable",
  "function resgatarGarantia()",
  "event ApoliceImplantada(address indexed seguradora, address indexed produtor, bytes32 indexed talhao, uint256 valorIndenizacao, bytes32 hashTermos)",
  "event GarantiaDepositada(address indexed seguradora, uint256 valor)",
  "event IndicesPublicados(uint256 indexed periodo, address indexed oraculo, uint32 indiceClimatico, uint16 indiceDanoBps, uint16 confiancaBps, bytes32 hashEvidencias, bytes32 versaoModelo)",
  "event CondicaoAvaliada(uint256 indexed periodo, bool atendida, uint16 percentualBps)",
  "event PagamentoExecutado(address indexed produtor, uint256 indexed periodo, uint256 valor)",
  "event GarantiaResgatada(address indexed seguradora, uint256 valor)",
  "error OrigemNaoAutorizada(address chamador)",
  "error SituacaoInvalida(uint8 atual, uint8 esperada)",
  "error GarantiaIncorreta(uint256 enviado, uint256 esperado)",
  "error VigenciaEmCurso(uint64 agora, uint64 fim)",
  "error FalhaNaTransferencia(address destino, uint256 valor)",
  "error ParametroInvalido(string campo)",
];

export const ABI_REGISTRY = [
  "function seguradora() view returns (address)",
  "function totalAutorizados() view returns (uint256)",
  "function ehAutorizado(address oraculo) view returns (bool)",
  "function autorizar(address oraculo)",
  "function revogar(address oraculo)",
  "event OraculoAutorizado(address indexed oraculo, address indexed porQuem)",
  "event OraculoRevogado(address indexed oraculo, address indexed porQuem)",
  "error NaoEhSeguradora(address chamador)",
  "error JaAutorizado(address oraculo)",
  "error NaoAutorizado(address oraculo)",
];
