const { expect } = require("chai");
const { ethers } = require("hardhat");
/**
 * Testes do registro de oraculos autorizados.
 *
 * Cobre o RF18 e o criterio de aceite 3 da HU02: incluir e remover enderecos
 * autorizados e restrito ao papel de seguradora.
 */
describe("OracleRegistry", function () {
  async function implantar() {
    const [seguradora, oraculo, outroOraculo, estranho] = await ethers.getSigners();
    const registry = await ethers.deployContract("OracleRegistry", [seguradora.address]);

    return { registry, seguradora, oraculo, outroOraculo, estranho };
  }

  describe("implantacao", function () {
    it("grava a seguradora informada e comeca sem nenhum autorizado", async function () {
      const { registry, seguradora } = await implantar();

      expect(await registry.seguradora()).to.equal(seguradora.address);
      expect(await registry.totalAutorizados()).to.equal(0);
    });

    it("recusa implantacao com endereco zero", async function () {
      const fabrica = await ethers.getContractFactory("OracleRegistry");

      await expect(fabrica.deploy(ethers.ZeroAddress)).to.be.revertedWithCustomError(
        fabrica,
        "EnderecoInvalido",
      );
    });
  });

  describe("autorizar", function () {
    it("autoriza um endereco e emite evento", async function () {
      const { registry, seguradora, oraculo } = await implantar();

      await expect(registry.connect(seguradora).autorizar(oraculo.address))
        .to.emit(registry, "OraculoAutorizado")
        .withArgs(oraculo.address, seguradora.address);

      expect(await registry.ehAutorizado(oraculo.address)).to.equal(true);
      expect(await registry.totalAutorizados()).to.equal(1);
    });

    it("recusa quem nao e a seguradora", async function () {
      const { registry, estranho, oraculo } = await implantar();

      await expect(registry.connect(estranho).autorizar(oraculo.address))
        .to.be.revertedWithCustomError(registry, "NaoEhSeguradora")
        .withArgs(estranho.address);
    });

    it("recusa o endereco zero", async function () {
      const { registry, seguradora } = await implantar();

      await expect(
        registry.connect(seguradora).autorizar(ethers.ZeroAddress),
      ).to.be.revertedWithCustomError(registry, "EnderecoInvalido");
    });

    it("recusa autorizar duas vezes o mesmo endereco", async function () {
      const { registry, seguradora, oraculo } = await implantar();
      await registry.connect(seguradora).autorizar(oraculo.address);

      await expect(registry.connect(seguradora).autorizar(oraculo.address))
        .to.be.revertedWithCustomError(registry, "JaAutorizado")
        .withArgs(oraculo.address);

      // O contador nao pode ter sido incrementado pela tentativa recusada.
      expect(await registry.totalAutorizados()).to.equal(1);
    });

    it("mantem os autorizados independentes entre si", async function () {
      const { registry, seguradora, oraculo, outroOraculo } = await implantar();

      await registry.connect(seguradora).autorizar(oraculo.address);
      await registry.connect(seguradora).autorizar(outroOraculo.address);

      expect(await registry.totalAutorizados()).to.equal(2);

      await registry.connect(seguradora).revogar(oraculo.address);

      expect(await registry.ehAutorizado(oraculo.address)).to.equal(false);
      expect(await registry.ehAutorizado(outroOraculo.address)).to.equal(true);
    });
  });

  describe("revogar", function () {
    it("revoga um endereco autorizado e emite evento", async function () {
      const { registry, seguradora, oraculo } = await implantar();
      await registry.connect(seguradora).autorizar(oraculo.address);

      await expect(registry.connect(seguradora).revogar(oraculo.address))
        .to.emit(registry, "OraculoRevogado")
        .withArgs(oraculo.address, seguradora.address);

      expect(await registry.ehAutorizado(oraculo.address)).to.equal(false);
      expect(await registry.totalAutorizados()).to.equal(0);
    });

    it("recusa quem nao e a seguradora", async function () {
      const { registry, seguradora, oraculo, estranho } = await implantar();
      await registry.connect(seguradora).autorizar(oraculo.address);

      await expect(registry.connect(estranho).revogar(oraculo.address))
        .to.be.revertedWithCustomError(registry, "NaoEhSeguradora")
        .withArgs(estranho.address);
    });

    it("recusa revogar quem nunca foi autorizado", async function () {
      const { registry, seguradora, estranho } = await implantar();

      await expect(registry.connect(seguradora).revogar(estranho.address))
        .to.be.revertedWithCustomError(registry, "NaoAutorizado")
        .withArgs(estranho.address);
    });
  });

  describe("transferirSeguradora", function () {
    it("transfere a administracao e passa a aceitar a nova seguradora", async function () {
      const { registry, seguradora, estranho, oraculo } = await implantar();

      await expect(registry.connect(seguradora).transferirSeguradora(estranho.address))
        .to.emit(registry, "SeguradoraTransferida")
        .withArgs(seguradora.address, estranho.address);

      expect(await registry.seguradora()).to.equal(estranho.address);

      // A seguradora anterior perde o poder de administrar.
      await expect(
        registry.connect(seguradora).autorizar(oraculo.address),
      ).to.be.revertedWithCustomError(registry, "NaoEhSeguradora");

      await expect(registry.connect(estranho).autorizar(oraculo.address)).to.emit(
        registry,
        "OraculoAutorizado",
      );
    });

    it("recusa transferir para o endereco zero", async function () {
      const { registry, seguradora } = await implantar();

      await expect(
        registry.connect(seguradora).transferirSeguradora(ethers.ZeroAddress),
      ).to.be.revertedWithCustomError(registry, "EnderecoInvalido");
    });

    it("recusa quem nao e a seguradora", async function () {
      const { registry, estranho } = await implantar();

      await expect(
        registry.connect(estranho).transferirSeguradora(estranho.address),
      ).to.be.revertedWithCustomError(registry, "NaoEhSeguradora");
    });
  });
});
