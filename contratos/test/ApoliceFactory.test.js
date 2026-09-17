const { expect } = require("chai");
const { ethers } = require("hardhat");
const { Situacao, VALOR_INDENIZACAO, b32, montarTermos, publicar } = require("./helpers");

/**
 * Testes da fabrica de apolices.
 *
 * Cobre o RF07 (implantar na rede, na contratacao, o contrato da apolice
 * parametrizado) e o criterio de aceite 3 da HU10 (a contratacao dispara a
 * implantacao do contrato e exibe o endereco gerado).
 */
describe("ApoliceFactory", function () {
  async function implantarFabrica() {
    const [seguradora, produtor, oraculo, estranho] = await ethers.getSigners();

    const registry = await ethers.deployContract("OracleRegistry", [seguradora.address]);
    await registry.connect(seguradora).autorizar(oraculo.address);

    const factory = await ethers.deployContract("ApoliceFactory", [
      await registry.getAddress(),
      seguradora.address,
    ]);

    return { registry, factory, seguradora, produtor, oraculo, estranho };
  }

  it("recusa implantacao com enderecos zerados", async function () {
    const [seguradora] = await ethers.getSigners();
    const fabrica = await ethers.getContractFactory("ApoliceFactory");

    await expect(
      fabrica.deploy(ethers.ZeroAddress, seguradora.address),
    ).to.be.revertedWithCustomError(fabrica, "EnderecoInvalido");

    await expect(
      fabrica.deploy(seguradora.address, ethers.ZeroAddress),
    ).to.be.revertedWithCustomError(fabrica, "EnderecoInvalido");
  });

  it("emite a apolice e registra o endereco implantado", async function () {
    const { factory, seguradora, produtor, registry } = await implantarFabrica();

    const termos = await montarTermos({
      produtor: produtor.address,
      registry: ethers.ZeroAddress, // sera sobrescrito pela fabrica
    });

    await expect(factory.connect(seguradora).emitirApolice(termos)).to.emit(
      factory,
      "ApoliceEmitida",
    );

    expect(await factory.totalApolices()).to.equal(1);

    const endereco = await factory.apolices(0);
    const apolice = await ethers.getContractAt("ApolicePolicy", endereco);
    const gravados = await apolice.verTermos();

    expect(gravados.produtor).to.equal(produtor.address);
    expect(gravados.registry).to.equal(await registry.getAddress());
    expect(await apolice.seguradora()).to.equal(seguradora.address);
    expect(await apolice.situacao()).to.equal(Situacao.AGUARDANDO_GARANTIA);
  });

  it("sobrescreve o registro informado, para nenhuma apolice apontar para outra lista", async function () {
    const { factory, seguradora, produtor, registry } = await implantarFabrica();

    const registroFalso = await ethers.deployContract("OracleRegistry", [produtor.address]);

    const termos = await montarTermos({
      produtor: produtor.address,
      registry: await registroFalso.getAddress(),
    });

    await factory.connect(seguradora).emitirApolice(termos);

    const apolice = await ethers.getContractAt("ApolicePolicy", await factory.apolices(0));
    const gravados = await apolice.verTermos();

    expect(gravados.registry).to.equal(await registry.getAddress());
    expect(gravados.registry).to.not.equal(await registroFalso.getAddress());
  });

  it("recusa emissao por quem nao e a seguradora", async function () {
    const { factory, produtor, estranho } = await implantarFabrica();

    const termos = await montarTermos({
      produtor: produtor.address,
      registry: ethers.ZeroAddress,
    });

    await expect(factory.connect(estranho).emitirApolice(termos))
      .to.be.revertedWithCustomError(factory, "NaoEhSeguradora")
      .withArgs(estranho.address);
  });

  it("indexa as apolices por produtor e por talhao", async function () {
    const { factory, seguradora, produtor, estranho } = await implantarFabrica();

    const base = await montarTermos({ produtor: produtor.address, registry: ethers.ZeroAddress });

    await factory.connect(seguradora).emitirApolice({ ...base, talhao: b32("talhao-01") });
    await factory.connect(seguradora).emitirApolice({ ...base, talhao: b32("talhao-02") });
    await factory
      .connect(seguradora)
      .emitirApolice({ ...base, produtor: estranho.address, talhao: b32("talhao-01") });

    expect(await factory.totalApolices()).to.equal(3);
    expect(await factory.apolicesDoProdutor(produtor.address)).to.have.lengthOf(2);
    expect(await factory.apolicesDoProdutor(estranho.address)).to.have.lengthOf(1);
    expect(await factory.apolicesDoTalhao(b32("talhao-01"))).to.have.lengthOf(2);
    expect(await factory.apolicesDoTalhao(b32("talhao-02"))).to.have.lengthOf(1);
  });

  it("uma apolice emitida pela fabrica opera normalmente ate a liquidacao", async function () {
    const { factory, seguradora, produtor, oraculo } = await implantarFabrica();

    const termos = await montarTermos({
      produtor: produtor.address,
      registry: ethers.ZeroAddress,
    });

    await factory.connect(seguradora).emitirApolice(termos);

    const apolice = await ethers.getContractAt("ApolicePolicy", await factory.apolices(0));
    await apolice.connect(seguradora).depositarGarantia({ value: VALOR_INDENIZACAO });

    await expect(publicar(apolice, oraculo, 20261001, 35)).to.changeEtherBalance(
      produtor,
      VALOR_INDENIZACAO,
    );

    expect(await apolice.situacao()).to.equal(Situacao.LIQUIDADA);
  });

  it("nao registra a apolice quando a implantacao falha", async function () {
    const { factory, seguradora } = await implantarFabrica();

    const termos = await montarTermos({
      produtor: ethers.ZeroAddress,
      registry: ethers.ZeroAddress,
    });

    await expect(factory.connect(seguradora).emitirApolice(termos)).to.be.reverted;

    expect(await factory.totalApolices()).to.equal(0);
  });
});
