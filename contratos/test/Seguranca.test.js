const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

const { Situacao, VALOR_INDENIZACAO, montarTermos, publicar } = require("./helpers");

/**
 * Testes de seguranca da apolice.
 *
 * Sao os testes que sustentam o RNF11 (imunidade a reentrancia) e o RNF15
 * (atomicidade: nenhuma falha pode resultar em pagamento parcial ou estado
 * inconsistente), alem do criterio de aceite 5 da HU03.
 *
 * A diferenca entre estes testes e os demais e que aqui o comportamento esperado
 * e a falha. Um teste que passa porque o ataque funcionou seria um contrato
 * vulneravel entregue como se estivesse correto.
 */
describe("Seguranca da apolice", function () {
  // -------------------------------------------------------------------------
  // RNF11 - Reentrancia
  // -------------------------------------------------------------------------
  describe("reentrancia (RNF11, HU03)", function () {
    /**
     * Monta o pior cenario possivel: o atacante e o produtor beneficiario e,
     * ao mesmo tempo, um oraculo autorizado. No instante em que recebe a
     * indenizacao, ele ainda tem permissao para chamar `publicarIndices`.
     */
    async function cenarioAtaque() {
      const [seguradora] = await ethers.getSigners();

      const registry = await ethers.deployContract("OracleRegistry", [seguradora.address]);
      const atacante = await ethers.deployContract("AtacanteReentrancia");
      const enderecoAtacante = await atacante.getAddress();

      await registry.connect(seguradora).autorizar(enderecoAtacante);

      const termos = await montarTermos({
        produtor: enderecoAtacante,
        registry: await registry.getAddress(),
      });

      const apolice = await ethers.deployContract("ApolicePolicy", [seguradora.address, termos]);
      await apolice.connect(seguradora).depositarGarantia({ value: VALOR_INDENIZACAO });
      await atacante.configurar(await apolice.getAddress());

      return { registry, apolice, atacante, enderecoAtacante, seguradora };
    }

    it("o contrato malicioso falha ao tentar sacar duas vezes", async function () {
      const { apolice, atacante, enderecoAtacante } = await cenarioAtaque();

      await atacante.atacar(20261001, 40, 0);

      // A reentrada foi tentada e barrada.
      expect(await atacante.vezesRecebido()).to.equal(1);
      expect(await atacante.reentradaFalhou()).to.equal(true);

      // Pagou uma vez, e uma vez so.
      expect(await apolice.valorPago()).to.equal(VALOR_INDENIZACAO);
      expect(await apolice.garantiaRetida()).to.equal(0);
      expect(await ethers.provider.getBalance(enderecoAtacante)).to.equal(VALOR_INDENIZACAO);
      expect(await apolice.situacao()).to.equal(Situacao.LIQUIDADA);
    });

    it("a reentrada e barrada especificamente pela guarda naoReentrante", async function () {
      const { atacante } = await cenarioAtaque();

      await atacante.atacar(20261001, 40, 0);

      const seletorEsperado = ethers.id("ReentranciaDetectada()").slice(0, 10);
      const erro = await atacante.ultimoErro();

      expect(erro.slice(0, 10)).to.equal(seletorEsperado);
    });

    it("o segundo periodo usado no ataque nao chega a ser registrado", async function () {
      const { apolice, atacante } = await cenarioAtaque();

      await atacante.atacar(20261001, 40, 0);

      expect(await apolice.periodoPublicado(20261001)).to.equal(true);
      expect(await apolice.periodoPublicado(20261002)).to.equal(false);
      expect(await apolice.totalPeriodos()).to.equal(1);
    });
  });

  // -------------------------------------------------------------------------
  // RNF15 - Atomicidade
  // -------------------------------------------------------------------------
  describe("atomicidade da liquidacao (RF26, RNF15)", function () {
    /**
     * Produtor que rejeita qualquer transferencia. Serve para observar o que
     * acontece com o estado quando o pagamento falha.
     */
    async function cenarioProdutorQueRecusa() {
      const [seguradora, oraculo] = await ethers.getSigners();

      const registry = await ethers.deployContract("OracleRegistry", [seguradora.address]);
      await registry.connect(seguradora).autorizar(oraculo.address);

      const recusa = await ethers.deployContract("ProdutorQueRecusa");

      const termos = await montarTermos({
        produtor: await recusa.getAddress(),
        registry: await registry.getAddress(),
      });

      const apolice = await ethers.deployContract("ApolicePolicy", [seguradora.address, termos]);
      await apolice.connect(seguradora).depositarGarantia({ value: VALOR_INDENIZACAO });

      return { apolice, recusa, oraculo, seguradora };
    }

    it("reverte a transacao inteira quando a transferencia falha", async function () {
      const { apolice, oraculo } = await cenarioProdutorQueRecusa();

      await expect(publicar(apolice, oraculo, 20261001, 40)).to.be.revertedWithCustomError(
        apolice,
        "FalhaNaTransferencia",
      );
    });

    it("nao deixa estado inconsistente apos a falha na transferencia", async function () {
      const { apolice, oraculo } = await cenarioProdutorQueRecusa();

      await expect(publicar(apolice, oraculo, 20261001, 40)).to.be.reverted;

      // Nada foi gravado: o periodo continua disponivel, a apolice segue ativa e
      // a garantia permanece integra. Nao houve pagamento parcial.
      expect(await apolice.periodoPublicado(20261001)).to.equal(false);
      expect(await apolice.totalPeriodos()).to.equal(0);
      expect(await apolice.situacao()).to.equal(Situacao.ATIVA);
      expect(await apolice.valorPago()).to.equal(0);
      expect(await apolice.garantiaRetida()).to.equal(VALOR_INDENIZACAO);
    });

    it("publicacoes que nao acionam continuam funcionando com o mesmo produtor", async function () {
      const { apolice, oraculo } = await cenarioProdutorQueRecusa();

      await publicar(apolice, oraculo, 20261001, 10);

      expect(await apolice.periodoPublicado(20261001)).to.equal(true);
      expect(await apolice.situacao()).to.equal(Situacao.ATIVA);
    });
  });

  // -------------------------------------------------------------------------
  // A outra ponta: a devolucao da garantia a seguradora
  // -------------------------------------------------------------------------
  describe("resgate da garantia sob ataque (RNF11, RNF15)", function () {
    /**
     * A apolice tem duas saidas de valor. Os testes acima cobrem a indenizacao ao
     * produtor; estes cobrem a devolucao da garantia, com uma seguradora hostil.
     */
    async function cenarioSeguradoraHostil() {
      const [, produtor, oraculo] = await ethers.getSigners();

      const maliciosa = await ethers.deployContract("SeguradoraMaliciosa");
      const enderecoMaliciosa = await maliciosa.getAddress();

      const registry = await ethers.deployContract("OracleRegistry", [enderecoMaliciosa]);
      const termos = await montarTermos({
        produtor: produtor.address,
        registry: await registry.getAddress(),
      });

      const apolice = await ethers.deployContract("ApolicePolicy", [enderecoMaliciosa, termos]);

      await maliciosa.configurar(await apolice.getAddress());
      await maliciosa.depositar({ value: VALOR_INDENIZACAO });
      await time.increaseTo(Number(termos.vigenciaFim) + 1);

      return { apolice, maliciosa, registry, oraculo, produtor };
    }

    it("reverte o resgate quando a seguradora recusa a devolucao", async function () {
      const { apolice, maliciosa } = await cenarioSeguradoraHostil();

      await maliciosa.definirModo(true, false);

      await expect(maliciosa.resgatar()).to.be.revertedWithCustomError(
        apolice,
        "FalhaNaTransferencia",
      );

      // A apolice continua ativa e com a garantia intacta.
      expect(await apolice.situacao()).to.equal(Situacao.ATIVA);
      expect(await apolice.garantiaRetida()).to.equal(VALOR_INDENIZACAO);
    });

    it("barra a reentrada no resgate e devolve a garantia uma unica vez", async function () {
      const { apolice, maliciosa } = await cenarioSeguradoraHostil();

      await maliciosa.definirModo(false, true);
      await maliciosa.resgatar();

      expect(await maliciosa.vezesRecebido()).to.equal(1);
      expect(await maliciosa.reentradaFalhou()).to.equal(true);

      const seletorEsperado = ethers.id("ReentranciaDetectada()").slice(0, 10);
      expect((await maliciosa.ultimoErro()).slice(0, 10)).to.equal(seletorEsperado);

      expect(await apolice.situacao()).to.equal(Situacao.ENCERRADA);
      expect(await apolice.garantiaRetida()).to.equal(0);
      expect(await ethers.provider.getBalance(await maliciosa.getAddress())).to.equal(
        VALOR_INDENIZACAO,
      );
    });
  });
});
