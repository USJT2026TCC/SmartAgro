const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

const {
  Operador,
  Situacao,
  VALOR_INDENIZACAO,
  DIA,
  hash,
  montarTermos,
  cenarioApoliceAtiva,
  publicar,
} = require("./helpers");

/**
 * Cancelamento antes da vigencia (RF10) e retificacao do indice de dano depois de
 * uma contestacao (RF28).
 *
 * As duas funcoes movimentam ou podem movimentar valor, entao cada uma tem, alem
 * do caminho feliz, os caminhos de recusa e o teste de transferencia que falha.
 */

/** Apolice cuja vigencia so comeca daqui a dez dias. */
async function cenarioVigenciaFutura({ depositar = true } = {}) {
  const [seguradora, produtor, oraculo, estranho] = await ethers.getSigners();

  const registry = await ethers.deployContract("OracleRegistry", [seguradora.address]);
  await registry.connect(seguradora).autorizar(oraculo.address);

  const agora = await time.latest();
  const termos = await montarTermos({
    produtor: produtor.address,
    registry: await registry.getAddress(),
    vigenciaInicio: agora + 10 * DIA,
    vigenciaFim: agora + 190 * DIA,
  });

  const apolice = await ethers.deployContract("ApolicePolicy", [seguradora.address, termos]);
  if (depositar) {
    await apolice.connect(seguradora).depositarGarantia({ value: termos.valorIndenizacao });
  }

  return { apolice, termos, seguradora, produtor, oraculo, estranho };
}

/** Publicacao com confianca e evidencias explicitas, para a retificacao comparar. */
function retificar(apolice, oraculo, periodo, indiceDanoBps, parecer = "parecer-do-perito") {
  return apolice
    .connect(oraculo)
    .publicarRetificacao(
      periodo,
      indiceDanoBps,
      9_000,
      hash(`lote-reavaliado-${periodo}`),
      hash("visao-agrosmart-v1.0.0"),
      parecer === null ? ethers.ZeroHash : hash(parecer),
    );
}

describe("Cancelamento antes da vigencia (RF10)", function () {
  it("a seguradora cancela e recebe a garantia de volta", async function () {
    const { apolice, seguradora } = await cenarioVigenciaFutura();

    const tx = apolice.connect(seguradora).cancelar();

    await expect(tx)
      .to.emit(apolice, "ApoliceCancelada")
      .withArgs(seguradora.address, VALOR_INDENIZACAO);
    await expect(tx).to.changeEtherBalances(
      [apolice, seguradora],
      [-VALOR_INDENIZACAO, VALOR_INDENIZACAO],
    );

    expect(await apolice.situacao()).to.equal(Situacao.CANCELADA);
    expect(await apolice.garantiaRetida()).to.equal(0);
  });

  it("o produtor titular tambem pode cancelar, e a garantia volta a seguradora", async function () {
    const { apolice, seguradora, produtor } = await cenarioVigenciaFutura();

    await expect(apolice.connect(produtor).cancelar()).to.changeEtherBalances(
      [seguradora, produtor],
      [VALOR_INDENIZACAO, 0],
    );

    expect(await apolice.situacao()).to.equal(Situacao.CANCELADA);
  });

  it("cancela antes do deposito, sem transferencia nenhuma", async function () {
    const { apolice, produtor } = await cenarioVigenciaFutura({ depositar: false });

    await expect(apolice.connect(produtor).cancelar())
      .to.emit(apolice, "ApoliceCancelada")
      .withArgs(produtor.address, 0);

    expect(await apolice.situacao()).to.equal(Situacao.CANCELADA);
  });

  it("recusa quem nao e parte do contrato", async function () {
    const { apolice, estranho, oraculo } = await cenarioVigenciaFutura();

    for (const conta of [estranho, oraculo]) {
      await expect(apolice.connect(conta).cancelar())
        .to.be.revertedWithCustomError(apolice, "OrigemNaoAutorizada")
        .withArgs(conta.address);
    }
  });

  it("recusa depois do inicio da vigencia", async function () {
    const { apolice, termos, produtor } = await cenarioVigenciaFutura();

    await time.increaseTo(termos.vigenciaInicio);

    await expect(apolice.connect(produtor).cancelar()).to.be.revertedWithCustomError(
      apolice,
      "VigenciaIniciada",
    );
    expect(await apolice.situacao()).to.equal(Situacao.ATIVA);
  });

  it("nao cancela duas vezes", async function () {
    const { apolice, seguradora } = await cenarioVigenciaFutura();

    await apolice.connect(seguradora).cancelar();

    await expect(apolice.connect(seguradora).cancelar())
      .to.be.revertedWithCustomError(apolice, "SituacaoInvalida")
      .withArgs(Situacao.CANCELADA, Situacao.ATIVA);
  });

  it("apolice cancelada nao aceita garantia nem publicacao", async function () {
    const { apolice, termos, seguradora, oraculo } = await cenarioVigenciaFutura({
      depositar: false,
    });

    await apolice.connect(seguradora).cancelar();
    await time.increaseTo(termos.vigenciaInicio);

    await expect(
      apolice.connect(seguradora).depositarGarantia({ value: VALOR_INDENIZACAO }),
    ).to.be.revertedWithCustomError(apolice, "SituacaoInvalida");
    await expect(publicar(apolice, oraculo, 20261101, 40)).to.be.revertedWithCustomError(
      apolice,
      "SituacaoInvalida",
    );
  });

  it("nao cancela apolice ja liquidada", async function () {
    const { apolice, seguradora, oraculo } = await cenarioApoliceAtiva();

    await publicar(apolice, oraculo, 20261101, 40);

    await expect(apolice.connect(seguradora).cancelar())
      .to.be.revertedWithCustomError(apolice, "SituacaoInvalida")
      .withArgs(Situacao.LIQUIDADA, Situacao.ATIVA);
  });

  describe("com uma seguradora hostil", function () {
    async function cenarioHostil() {
      const [, produtor] = await ethers.getSigners();

      const maliciosa = await ethers.deployContract("SeguradoraMaliciosa");
      const enderecoMaliciosa = await maliciosa.getAddress();

      const registry = await ethers.deployContract("OracleRegistry", [enderecoMaliciosa]);
      const agora = await time.latest();
      const termos = await montarTermos({
        produtor: produtor.address,
        registry: await registry.getAddress(),
        vigenciaInicio: agora + 10 * DIA,
        vigenciaFim: agora + 190 * DIA,
      });

      const apolice = await ethers.deployContract("ApolicePolicy", [enderecoMaliciosa, termos]);
      await maliciosa.configurar(await apolice.getAddress());
      await maliciosa.depositar({ value: VALOR_INDENIZACAO });

      return { apolice, maliciosa };
    }

    it("reverte tudo quando a devolucao e recusada, e a apolice continua ATIVA", async function () {
      const { apolice, maliciosa } = await cenarioHostil();

      await maliciosa.definirModo(true, false);

      await expect(maliciosa.cancelar()).to.be.revertedWithCustomError(
        apolice,
        "FalhaNaTransferencia",
      );
      expect(await apolice.situacao()).to.equal(Situacao.ATIVA);
      expect(await apolice.garantiaRetida()).to.equal(VALOR_INDENIZACAO);
    });

    it("barra a reentrada durante a devolucao", async function () {
      const { apolice, maliciosa } = await cenarioHostil();

      await maliciosa.definirModo(false, true);
      await maliciosa.cancelar();

      expect(await maliciosa.vezesRecebido()).to.equal(1);
      expect(await maliciosa.reentradaFalhou()).to.equal(true);
      expect(await apolice.situacao()).to.equal(Situacao.CANCELADA);

      // A reentrada tentou cancelar de novo e parou na guarda, antes de tudo.
      const erro = apolice.interface.parseError(await maliciosa.ultimoErro());
      expect(erro.name).to.equal("ReentranciaDetectada");
    });
  });
});

describe("Retificacao do indice de dano apos contestacao (RF28)", function () {
  /** Apolice por dano: aciona com 20% da lavoura afetada. */
  async function cenarioDano(overrides = {}) {
    return cenarioApoliceAtiva({
      operador: Operador.DANO,
      limiarClimatico: 0,
      limiarDanoBps: 2_000,
      ...overrides,
    });
  }

  it("o indice retificado aciona o pagamento que o original nao acionou", async function () {
    const { apolice, oraculo, produtor } = await cenarioDano();

    await publicar(apolice, oraculo, 20261101, 0, 1_200);
    expect(await apolice.situacao()).to.equal(Situacao.ATIVA);

    const tx = retificar(apolice, oraculo, 20261101, 2_600);

    await expect(tx)
      .to.emit(apolice, "IndiceRetificado")
      .withArgs(
        20261101,
        oraculo.address,
        1_200,
        2_600,
        9_000,
        hash("lote-reavaliado-20261101"),
        hash("visao-agrosmart-v1.0.0"),
        hash("parecer-do-perito"),
      );
    await expect(tx).to.emit(apolice, "CondicaoAvaliada").withArgs(20261101, true, 10_000);
    await expect(tx)
      .to.emit(apolice, "PagamentoExecutado")
      .withArgs(produtor.address, 20261101, VALOR_INDENIZACAO);

    expect(await apolice.situacao()).to.equal(Situacao.LIQUIDADA);
    expect(await apolice.periodoAcionador()).to.equal(20261101);
  });

  it("guarda a retificacao ao lado da publicacao original, sem apaga-la", async function () {
    const { apolice, oraculo } = await cenarioDano();

    await publicar(apolice, oraculo, 20261101, 0, 1_200);
    await retificar(apolice, oraculo, 20261101, 1_500);

    const original = await apolice.publicacao(20261101);
    const corrigida = await apolice.retificacao(20261101);

    expect(original.indiceDanoBps).to.equal(1_200);
    expect(corrigida.indiceDanoBps).to.equal(1_500);
    expect(corrigida.oraculo).to.equal(oraculo.address);
    expect(corrigida.hashParecer).to.equal(hash("parecer-do-perito"));
    expect(await apolice.periodoRetificado(20261101)).to.equal(true);
  });

  it("retificacao que nao atinge o limiar mantem a apolice ativa", async function () {
    const { apolice, oraculo } = await cenarioDano();

    await publicar(apolice, oraculo, 20261101, 0, 1_200);

    await expect(retificar(apolice, oraculo, 20261101, 1_900))
      .to.emit(apolice, "CondicaoAvaliada")
      .withArgs(20261101, false, 0);
    expect(await apolice.situacao()).to.equal(Situacao.ATIVA);
  });

  it("reavalia com o indice climatico original do periodo", async function () {
    // Operador E: os dois precisam ser atingidos. O climatico (35 dias) ja
    // estava atingido na publicacao; o dano retificado completa a condicao.
    const { apolice, oraculo } = await cenarioDano({
      operador: Operador.E,
      limiarClimatico: 30,
    });

    await publicar(apolice, oraculo, 20261101, 35, 1_000);
    expect(await apolice.situacao()).to.equal(Situacao.ATIVA);

    await retificar(apolice, oraculo, 20261101, 2_100);
    expect(await apolice.situacao()).to.equal(Situacao.LIQUIDADA);
  });

  it("so o oraculo autorizado submete a retificacao", async function () {
    const { apolice, oraculo, estranho, produtor } = await cenarioDano();

    await publicar(apolice, oraculo, 20261101, 0, 1_200);

    for (const conta of [estranho, produtor]) {
      await expect(retificar(apolice, conta, 20261101, 2_600))
        .to.be.revertedWithCustomError(apolice, "OrigemNaoAutorizada")
        .withArgs(conta.address);
    }
  });

  it("recusa periodo que nunca foi publicado", async function () {
    const { apolice, oraculo } = await cenarioDano();

    await expect(retificar(apolice, oraculo, 20261101, 2_600))
      .to.be.revertedWithCustomError(apolice, "PeriodoNaoPublicado")
      .withArgs(20261101);
  });

  it("aceita uma unica retificacao por periodo", async function () {
    const { apolice, oraculo } = await cenarioDano();

    await publicar(apolice, oraculo, 20261101, 0, 1_200);
    await retificar(apolice, oraculo, 20261101, 1_500);

    await expect(retificar(apolice, oraculo, 20261101, 2_600))
      .to.be.revertedWithCustomError(apolice, "PeriodoJaRetificado")
      .withArgs(20261101);
  });

  it("exige o resumo do parecer e indices dentro da faixa", async function () {
    const { apolice, oraculo } = await cenarioDano();

    await publicar(apolice, oraculo, 20261101, 0, 1_200);

    await expect(retificar(apolice, oraculo, 20261101, 2_600, null))
      .to.be.revertedWithCustomError(apolice, "ParametroInvalido")
      .withArgs("hashParecer");
    await expect(retificar(apolice, oraculo, 20261101, 10_001))
      .to.be.revertedWithCustomError(apolice, "ParametroInvalido")
      .withArgs("indiceDanoBps");
    await expect(
      apolice
        .connect(oraculo)
        .publicarRetificacao(20261101, 2_600, 10_001, hash("a"), hash("b"), hash("c")),
    )
      .to.be.revertedWithCustomError(apolice, "ParametroInvalido")
      .withArgs("confiancaBps");
  });

  it("recusa retificacao fora da vigencia", async function () {
    const { apolice, oraculo, termos } = await cenarioDano();

    await publicar(apolice, oraculo, 20261101, 0, 1_200);
    await time.increaseTo(Number(termos.vigenciaFim) + 1);

    await expect(retificar(apolice, oraculo, 20261101, 2_600)).to.be.revertedWithCustomError(
      apolice,
      "ForaDaVigencia",
    );
  });

  it("barra a reentrada durante o pagamento da retificacao", async function () {
    const [seguradora] = await ethers.getSigners();

    const registry = await ethers.deployContract("OracleRegistry", [seguradora.address]);
    const atacante = await ethers.deployContract("AtacanteReentrancia");
    const enderecoAtacante = await atacante.getAddress();
    await registry.connect(seguradora).autorizar(enderecoAtacante);

    const termos = await montarTermos({
      produtor: enderecoAtacante,
      registry: await registry.getAddress(),
      operador: Operador.DANO,
      limiarClimatico: 0,
      limiarDanoBps: 2_000,
    });
    const apolice = await ethers.deployContract("ApolicePolicy", [seguradora.address, termos]);
    await apolice.connect(seguradora).depositarGarantia({ value: VALOR_INDENIZACAO });
    await atacante.configurar(await apolice.getAddress());

    await atacante.atacar(20261001, 0, 1_000);
    await atacante.atacarRetificando(20261001, 3_000);

    expect(await atacante.vezesRecebido()).to.equal(1);
    expect(await atacante.reentradaFalhou()).to.equal(true);
    expect(apolice.interface.parseError(await atacante.ultimoErro()).name).to.equal(
      "ReentranciaDetectada",
    );
    expect(await apolice.valorPago()).to.equal(VALOR_INDENIZACAO);
  });

  it("nao retifica apolice ja liquidada", async function () {
    const { apolice, oraculo } = await cenarioDano();

    await publicar(apolice, oraculo, 20261101, 0, 2_500);

    await expect(retificar(apolice, oraculo, 20261101, 3_000))
      .to.be.revertedWithCustomError(apolice, "SituacaoInvalida")
      .withArgs(Situacao.LIQUIDADA, Situacao.ATIVA);
  });
});
