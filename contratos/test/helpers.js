const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

/**
 * Utilitarios compartilhados pelos testes.
 *
 * Concentrar a montagem dos termos aqui evita que cada arquivo de teste repita
 * quatorze campos e, principalmente, evita que um teste passe por engano porque
 * montou a apolice com um parametro diferente do que pretendia exercitar.
 */

/** Operador da condicao contratada, espelhando o enum do contrato. */
const Operador = {
  CLIMATICO: 0,
  DANO: 1,
  OU: 2,
  E: 3,
};

/** Regra de calculo do valor devido, espelhando o enum do contrato. */
const ModoPagamento = {
  INTEGRAL: 0,
  ESCALONADO: 1,
};

/** Ciclo de vida da apolice, espelhando o enum do contrato. */
const Situacao = {
  AGUARDANDO_GARANTIA: 0,
  ATIVA: 1,
  LIQUIDADA: 2,
  ENCERRADA: 3,
};

const BPS = 10_000n;
const VALOR_INDENIZACAO = ethers.parseEther("1.0");
const DIA = 24 * 60 * 60;

const b32 = (texto) => ethers.encodeBytes32String(texto);
const hash = (texto) => ethers.keccak256(ethers.toUtf8Bytes(texto));

/**
 * Monta os termos de uma apolice com valores padrao de estiagem em soja.
 *
 * Padrao: aciona com 30 dias consecutivos sem chuva, pagamento integral,
 * vigencia de 180 dias a partir de agora.
 */
async function montarTermos(overrides = {}) {
  const agora = await time.latest();

  return {
    produtor: ethers.ZeroAddress,
    registry: ethers.ZeroAddress,
    cultura: b32("soja"),
    talhao: b32("talhao-01"),
    operador: Operador.CLIMATICO,
    modoPagamento: ModoPagamento.INTEGRAL,
    limiarClimatico: 30,
    limiarClimaticoIntegral: 0,
    limiarDanoBps: 0,
    limiarDanoIntegralBps: 0,
    vigenciaInicio: agora,
    vigenciaFim: agora + 180 * DIA,
    valorIndenizacao: VALOR_INDENIZACAO,
    hashTermos: hash("termos-da-apolice-v1"),
    ...overrides,
  };
}

/**
 * Cenario base usado pela maioria dos testes: registro implantado, oraculo
 * autorizado e apolice ativa com a garantia ja depositada.
 */
async function cenarioApoliceAtiva(overrides = {}) {
  const [seguradora, produtor, oraculo, estranho] = await ethers.getSigners();

  const registry = await ethers.deployContract("OracleRegistry", [seguradora.address]);
  await registry.connect(seguradora).autorizar(oraculo.address);

  const termos = await montarTermos({
    produtor: produtor.address,
    registry: await registry.getAddress(),
    ...overrides,
  });

  const apolice = await ethers.deployContract("ApolicePolicy", [seguradora.address, termos]);
  await apolice.connect(seguradora).depositarGarantia({ value: termos.valorIndenizacao });

  return { registry, apolice, termos, seguradora, produtor, oraculo, estranho };
}

/**
 * Publicacao padrao: preenche os campos de evidencia que os testes de condicao
 * nao precisam variar.
 */
function publicar(apolice, oraculo, periodo, indiceClimatico, indiceDanoBps = 0) {
  return apolice
    .connect(oraculo)
    .publicarIndices(
      periodo,
      indiceClimatico,
      indiceDanoBps,
      9_500,
      hash(`lote-de-imagens-${periodo}`),
      hash("visao-agrosmart-v1.0.0"),
    );
}

module.exports = {
  Operador,
  ModoPagamento,
  Situacao,
  BPS,
  VALOR_INDENIZACAO,
  DIA,
  b32,
  hash,
  montarTermos,
  cenarioApoliceAtiva,
  publicar,
};
