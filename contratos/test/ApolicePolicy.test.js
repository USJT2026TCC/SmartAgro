const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

const {
  Operador,
  ModoPagamento,
  Situacao,
  VALOR_INDENIZACAO,
  DIA,
  hash,
  montarTermos,
  cenarioApoliceAtiva,
  publicar,
} = require("./helpers");

/**
 * Testes da apolice.
 *
 * A organizacao acompanha o ciclo de vida do contrato: implantacao, deposito da
 * garantia, publicacao de indices, avaliacao da condicao, liquidacao e encerramento.
 * Cada bloco cita o requisito que exercita, de modo que a rastreabilidade exigida
 * pelo RNF14 fique visivel no proprio codigo de teste.
 */
describe("ApolicePolicy", function () {
  // -------------------------------------------------------------------------
  // HU01 - Contrato da apolice em rede local (RF07, RF08)
  // -------------------------------------------------------------------------
  describe("implantacao (RF07, RF08)", function () {
    async function implantarSemGarantia() {
      const [seguradora, produtor, oraculo] = await ethers.getSigners();

      const registry = await ethers.deployContract("OracleRegistry", [seguradora.address]);
      await registry.connect(seguradora).autorizar(oraculo.address);

      const termos = await montarTermos({
        produtor: produtor.address,
        registry: await registry.getAddress(),
      });

      const apolice = await ethers.deployContract("ApolicePolicy", [seguradora.address, termos]);

      return { registry, apolice, termos, seguradora, produtor, oraculo };
    }

    it("recebe condicao de gatilho, carteira do produtor e registro de oraculos", async function () {
      const { apolice, termos, seguradora, registry } = await implantarSemGarantia();

      const gravados = await apolice.verTermos();

      expect(await apolice.seguradora()).to.equal(seguradora.address);
      expect(gravados.produtor).to.equal(termos.produtor);
      expect(gravados.registry).to.equal(await registry.getAddress());
      expect(gravados.limiarClimatico).to.equal(30);
      expect(gravados.valorIndenizacao).to.equal(VALOR_INDENIZACAO);
      expect(await apolice.situacao()).to.equal(Situacao.AGUARDANDO_GARANTIA);
    });

    it("grava o resumo criptografico dos termos, legivel por consulta publica", async function () {
      const { apolice, termos } = await implantarSemGarantia();

      const gravados = await apolice.verTermos();

      expect(gravados.hashTermos).to.equal(termos.hashTermos);
      expect(gravados.hashTermos).to.equal(hash("termos-da-apolice-v1"));

      // Qualquer alteracao no documento produz um resumo diferente do gravado,
      // e portanto se torna detectavel (RF08).
      expect(gravados.hashTermos).to.not.equal(hash("termos-da-apolice-v2"));
    });

    it("emite ApoliceImplantada na criacao", async function () {
      const [seguradora, produtor] = await ethers.getSigners();

      const registry = await ethers.deployContract("OracleRegistry", [seguradora.address]);
      const termos = await montarTermos({
        produtor: produtor.address,
        registry: await registry.getAddress(),
      });

      const fabrica = await ethers.getContractFactory("ApolicePolicy");
      const apolice = await fabrica.deploy(seguradora.address, termos);

      await expect(apolice.deploymentTransaction())
        .to.emit(apolice, "ApoliceImplantada")
        .withArgs(
          seguradora.address,
          produtor.address,
          termos.talhao,
          termos.valorIndenizacao,
          termos.hashTermos,
        );
    });

    describe("recusa de parametros invalidos", function () {
      async function tentarImplantar(overrides, seguradoraOverride) {
        const [seguradora, produtor] = await ethers.getSigners();
        const registry = await ethers.deployContract("OracleRegistry", [seguradora.address]);

        const termos = await montarTermos({
          produtor: produtor.address,
          registry: await registry.getAddress(),
          ...overrides,
        });

        const fabrica = await ethers.getContractFactory("ApolicePolicy");

        return {
          fabrica,
          promessa: fabrica.deploy(seguradoraOverride ?? seguradora.address, termos),
        };
      }

      it("seguradora com endereco zero", async function () {
        const { fabrica, promessa } = await tentarImplantar({}, ethers.ZeroAddress);
        await expect(promessa).to.be.revertedWithCustomError(fabrica, "EnderecoInvalido");
      });

      it("produtor com endereco zero", async function () {
        const { fabrica, promessa } = await tentarImplantar({ produtor: ethers.ZeroAddress });
        await expect(promessa).to.be.revertedWithCustomError(fabrica, "EnderecoInvalido");
      });

      it("registro de oraculos com endereco zero", async function () {
        const { fabrica, promessa } = await tentarImplantar({ registry: ethers.ZeroAddress });
        await expect(promessa).to.be.revertedWithCustomError(fabrica, "EnderecoInvalido");
      });

      it("produtor igual a seguradora", async function () {
        const [seguradora] = await ethers.getSigners();
        const { fabrica, promessa } = await tentarImplantar({ produtor: seguradora.address });

        await expect(promessa)
          .to.be.revertedWithCustomError(fabrica, "ParametroInvalido")
          .withArgs("produtor igual a seguradora");
      });

      it("valor de indenizacao zerado", async function () {
        const { fabrica, promessa } = await tentarImplantar({ valorIndenizacao: 0 });

        await expect(promessa)
          .to.be.revertedWithCustomError(fabrica, "ParametroInvalido")
          .withArgs("valorIndenizacao");
      });

      it("vigencia que termina antes de comecar", async function () {
        const agora = await time.latest();
        const { fabrica, promessa } = await tentarImplantar({
          vigenciaInicio: agora + 10 * DIA,
          vigenciaFim: agora + DIA,
        });

        await expect(promessa)
          .to.be.revertedWithCustomError(fabrica, "ParametroInvalido")
          .withArgs("vigencia");
      });

      it("resumo dos termos zerado", async function () {
        const { fabrica, promessa } = await tentarImplantar({ hashTermos: ethers.ZeroHash });

        await expect(promessa)
          .to.be.revertedWithCustomError(fabrica, "ParametroInvalido")
          .withArgs("hashTermos");
      });

      it("limiar de dano acima de 100%", async function () {
        const { fabrica, promessa } = await tentarImplantar({
          operador: Operador.DANO,
          limiarDanoBps: 10_001,
        });

        await expect(promessa)
          .to.be.revertedWithCustomError(fabrica, "ParametroInvalido")
          .withArgs("limiarDanoBps");
      });

      it("limiar integral de dano acima de 100%", async function () {
        const { fabrica, promessa } = await tentarImplantar({
          operador: Operador.DANO,
          limiarDanoBps: 4_000,
          limiarDanoIntegralBps: 10_001,
        });

        await expect(promessa)
          .to.be.revertedWithCustomError(fabrica, "ParametroInvalido")
          .withArgs("limiarDanoIntegralBps");
      });

      it("limiar climatico zerado quando o operador usa clima", async function () {
        const { fabrica, promessa } = await tentarImplantar({
          operador: Operador.CLIMATICO,
          limiarClimatico: 0,
        });

        await expect(promessa)
          .to.be.revertedWithCustomError(fabrica, "ParametroInvalido")
          .withArgs("limiarClimatico");
      });

      it("limiar de dano zerado quando o operador usa dano", async function () {
        const { fabrica, promessa } = await tentarImplantar({
          operador: Operador.DANO,
          limiarDanoBps: 0,
        });

        await expect(promessa)
          .to.be.revertedWithCustomError(fabrica, "ParametroInvalido")
          .withArgs("limiarDanoBps");
      });

      it("escalonado com teto climatico menor ou igual ao gatilho", async function () {
        const { fabrica, promessa } = await tentarImplantar({
          modoPagamento: ModoPagamento.ESCALONADO,
          limiarClimatico: 30,
          limiarClimaticoIntegral: 30,
        });

        await expect(promessa)
          .to.be.revertedWithCustomError(fabrica, "ParametroInvalido")
          .withArgs("limiarClimaticoIntegral");
      });

      it("escalonado com teto de dano menor ou igual ao gatilho", async function () {
        const { fabrica, promessa } = await tentarImplantar({
          operador: Operador.DANO,
          modoPagamento: ModoPagamento.ESCALONADO,
          limiarDanoBps: 4_000,
          limiarDanoIntegralBps: 4_000,
        });

        await expect(promessa)
          .to.be.revertedWithCustomError(fabrica, "ParametroInvalido")
          .withArgs("limiarDanoIntegralBps");
      });
    });
  });

  // -------------------------------------------------------------------------
  // Garantia
  // -------------------------------------------------------------------------
  describe("deposito da garantia", function () {
    async function implantarSemGarantia() {
      const [seguradora, produtor, oraculo, estranho] = await ethers.getSigners();

      const registry = await ethers.deployContract("OracleRegistry", [seguradora.address]);
      await registry.connect(seguradora).autorizar(oraculo.address);

      const termos = await montarTermos({
        produtor: produtor.address,
        registry: await registry.getAddress(),
      });

      const apolice = await ethers.deployContract("ApolicePolicy", [seguradora.address, termos]);

      return { apolice, termos, seguradora, produtor, oraculo, estranho };
    }

    it("ativa a apolice quando o valor exato e depositado", async function () {
      const { apolice, seguradora } = await implantarSemGarantia();

      await expect(apolice.connect(seguradora).depositarGarantia({ value: VALOR_INDENIZACAO }))
        .to.emit(apolice, "GarantiaDepositada")
        .withArgs(seguradora.address, VALOR_INDENIZACAO);

      expect(await apolice.situacao()).to.equal(Situacao.ATIVA);
      expect(await apolice.garantiaRetida()).to.equal(VALOR_INDENIZACAO);
    });

    it("recusa valor diferente do contratado", async function () {
      const { apolice, seguradora } = await implantarSemGarantia();
      const aMenor = VALOR_INDENIZACAO - 1n;

      await expect(apolice.connect(seguradora).depositarGarantia({ value: aMenor }))
        .to.be.revertedWithCustomError(apolice, "GarantiaIncorreta")
        .withArgs(aMenor, VALOR_INDENIZACAO);
    });

    it("recusa deposito de quem nao e a seguradora", async function () {
      const { apolice, estranho } = await implantarSemGarantia();

      await expect(apolice.connect(estranho).depositarGarantia({ value: VALOR_INDENIZACAO }))
        .to.be.revertedWithCustomError(apolice, "OrigemNaoAutorizada")
        .withArgs(estranho.address);
    });

    it("recusa segundo deposito", async function () {
      const { apolice, seguradora } = await implantarSemGarantia();
      await apolice.connect(seguradora).depositarGarantia({ value: VALOR_INDENIZACAO });

      await expect(apolice.connect(seguradora).depositarGarantia({ value: VALOR_INDENIZACAO }))
        .to.be.revertedWithCustomError(apolice, "SituacaoInvalida")
        .withArgs(Situacao.ATIVA, Situacao.AGUARDANDO_GARANTIA);
    });

    it("recusa transferencia direta para o contrato", async function () {
      const { apolice, seguradora } = await implantarSemGarantia();

      await expect(
        seguradora.sendTransaction({
          to: await apolice.getAddress(),
          value: ethers.parseEther("0.1"),
        }),
      ).to.be.revertedWithCustomError(apolice, "DepositoDireto");
    });

    it("nao aceita publicacao antes da garantia", async function () {
      const { apolice, oraculo } = await implantarSemGarantia();

      await expect(publicar(apolice, oraculo, 20261001, 40))
        .to.be.revertedWithCustomError(apolice, "SituacaoInvalida")
        .withArgs(Situacao.AGUARDANDO_GARANTIA, Situacao.ATIVA);
    });
  });

  // -------------------------------------------------------------------------
  // HU02 - Controle de enderecos autorizados (RF18, RF20)
  // -------------------------------------------------------------------------
  describe("publicacao de indices (RF16, RF18, RF20)", function () {
    it("aceita publicacao de endereco autorizado e emite evento com apolice, periodo e indices", async function () {
      const { apolice, oraculo } = await cenarioApoliceAtiva();

      await expect(publicar(apolice, oraculo, 20261001, 10))
        .to.emit(apolice, "IndicesPublicados")
        .withArgs(
          20261001,
          oraculo.address,
          10,
          0,
          9_500,
          hash("lote-de-imagens-20261001"),
          hash("visao-agrosmart-v1.0.0"),
        );
    });

    it("rejeita publicacao de endereco nao autorizado", async function () {
      const { apolice, estranho } = await cenarioApoliceAtiva();

      await expect(publicar(apolice, estranho, 20261001, 40))
        .to.be.revertedWithCustomError(apolice, "OrigemNaoAutorizada")
        .withArgs(estranho.address);
    });

    it("deixa de aceitar um oraculo revogado no registro", async function () {
      const { apolice, registry, seguradora, oraculo } = await cenarioApoliceAtiva();

      await publicar(apolice, oraculo, 20261001, 10);
      await registry.connect(seguradora).revogar(oraculo.address);

      await expect(publicar(apolice, oraculo, 20261002, 10))
        .to.be.revertedWithCustomError(apolice, "OrigemNaoAutorizada")
        .withArgs(oraculo.address);
    });

    it("rejeita periodo duplicado e preserva o valor original", async function () {
      const { apolice, oraculo } = await cenarioApoliceAtiva();

      await publicar(apolice, oraculo, 20261001, 12);

      await expect(publicar(apolice, oraculo, 20261001, 99))
        .to.be.revertedWithCustomError(apolice, "PeriodoJaPublicado")
        .withArgs(20261001);

      const registro = await apolice.publicacao(20261001);
      expect(registro.indiceClimatico).to.equal(12);
      expect(await apolice.totalPeriodos()).to.equal(1);
    });

    it("registra confianca, versao do modelo e resumo das evidencias (RF16)", async function () {
      const { apolice, oraculo } = await cenarioApoliceAtiva();

      await apolice
        .connect(oraculo)
        .publicarIndices(
          20261005,
          7,
          3_200,
          8_800,
          hash("lote-42"),
          hash("visao-agrosmart-v1.2.3"),
        );

      const registro = await apolice.publicacao(20261005);

      expect(registro.oraculo).to.equal(oraculo.address);
      expect(registro.indiceClimatico).to.equal(7);
      expect(registro.indiceDanoBps).to.equal(3_200);
      expect(registro.confiancaBps).to.equal(8_800);
      expect(registro.hashEvidencias).to.equal(hash("lote-42"));
      expect(registro.versaoModelo).to.equal(hash("visao-agrosmart-v1.2.3"));
      expect(registro.publicadoEm).to.be.greaterThan(0);
    });

    it("mantem a ordem dos periodos publicados", async function () {
      const { apolice, oraculo } = await cenarioApoliceAtiva();

      await publicar(apolice, oraculo, 20261001, 5);
      await publicar(apolice, oraculo, 20261002, 6);
      await publicar(apolice, oraculo, 20261003, 7);

      expect(await apolice.totalPeriodos()).to.equal(3);
      expect(await apolice.periodos(0)).to.equal(20261001);
      expect(await apolice.periodos(2)).to.equal(20261003);
    });

    it("rejeita indice de dano acima de 100%", async function () {
      const { apolice, oraculo } = await cenarioApoliceAtiva();

      await expect(
        apolice
          .connect(oraculo)
          .publicarIndices(20261001, 5, 10_001, 9_000, ethers.ZeroHash, ethers.ZeroHash),
      )
        .to.be.revertedWithCustomError(apolice, "ParametroInvalido")
        .withArgs("indiceDanoBps");
    });

    it("rejeita confianca acima de 100%", async function () {
      const { apolice, oraculo } = await cenarioApoliceAtiva();

      await expect(
        apolice
          .connect(oraculo)
          .publicarIndices(20261001, 5, 1_000, 10_001, ethers.ZeroHash, ethers.ZeroHash),
      )
        .to.be.revertedWithCustomError(apolice, "ParametroInvalido")
        .withArgs("confiancaBps");
    });

    it("rejeita publicacao antes do inicio da vigencia", async function () {
      const agora = await time.latest();
      const { apolice, oraculo } = await cenarioApoliceAtiva({
        vigenciaInicio: agora + 30 * DIA,
        vigenciaFim: agora + 200 * DIA,
      });

      await expect(publicar(apolice, oraculo, 20261001, 40)).to.be.revertedWithCustomError(
        apolice,
        "ForaDaVigencia",
      );
    });

    it("rejeita publicacao depois do fim da vigencia", async function () {
      const { apolice, oraculo, termos } = await cenarioApoliceAtiva();

      await time.increaseTo(Number(termos.vigenciaFim) + 1);

      await expect(publicar(apolice, oraculo, 20261001, 40)).to.be.revertedWithCustomError(
        apolice,
        "ForaDaVigencia",
      );
    });
  });

  // -------------------------------------------------------------------------
  // HU03 - Avaliacao da condicao e liquidacao (RF23, RF24, RF26)
  // -------------------------------------------------------------------------
  describe("avaliacao da condicao e liquidacao (RF23, RF24, RF26)", function () {
    it("nao paga quando o indice fica abaixo do limiar", async function () {
      const { apolice, oraculo, produtor } = await cenarioApoliceAtiva();

      await expect(publicar(apolice, oraculo, 20261001, 29))
        .to.emit(apolice, "CondicaoAvaliada")
        .withArgs(20261001, false, 0)
        .and.to.not.emit(apolice, "PagamentoExecutado");

      expect(await apolice.situacao()).to.equal(Situacao.ATIVA);
      expect(await apolice.valorPago()).to.equal(0);
      expect(await apolice.garantiaRetida()).to.equal(VALOR_INDENIZACAO);
      expect(await ethers.provider.getBalance(produtor.address)).to.be.greaterThan(0);
    });

    it("paga integralmente quando o indice atinge exatamente o limiar", async function () {
      const { apolice, oraculo, produtor } = await cenarioApoliceAtiva();

      await expect(publicar(apolice, oraculo, 20261001, 30)).to.changeEtherBalance(
        produtor,
        VALOR_INDENIZACAO,
      );

      expect(await apolice.situacao()).to.equal(Situacao.LIQUIDADA);
      expect(await apolice.valorPago()).to.equal(VALOR_INDENIZACAO);
      expect(await apolice.periodoAcionador()).to.equal(20261001);
      expect(await apolice.garantiaRetida()).to.equal(0);
    });

    it("emite CondicaoAvaliada e PagamentoExecutado na mesma transacao", async function () {
      const { apolice, oraculo, produtor } = await cenarioApoliceAtiva();

      await expect(publicar(apolice, oraculo, 20261001, 45))
        .to.emit(apolice, "CondicaoAvaliada")
        .withArgs(20261001, true, 10_000)
        .and.to.emit(apolice, "PagamentoExecutado")
        .withArgs(produtor.address, 20261001, VALOR_INDENIZACAO);
    });

    it("impede acionamento duplicado: nenhuma publicacao e aceita apos a liquidacao", async function () {
      const { apolice, oraculo } = await cenarioApoliceAtiva();

      await publicar(apolice, oraculo, 20261001, 40);

      await expect(publicar(apolice, oraculo, 20261002, 60))
        .to.be.revertedWithCustomError(apolice, "SituacaoInvalida")
        .withArgs(Situacao.LIQUIDADA, Situacao.ATIVA);

      expect(await apolice.valorPago()).to.equal(VALOR_INDENIZACAO);
    });

    it("segue acumulando periodos sem acionar ate a condicao ser atendida", async function () {
      const { apolice, oraculo, produtor } = await cenarioApoliceAtiva();

      await publicar(apolice, oraculo, 20261001, 10);
      await publicar(apolice, oraculo, 20261002, 20);
      await publicar(apolice, oraculo, 20261003, 29);

      expect(await apolice.situacao()).to.equal(Situacao.ATIVA);

      await expect(publicar(apolice, oraculo, 20261004, 31)).to.changeEtherBalance(
        produtor,
        VALOR_INDENIZACAO,
      );

      expect(await apolice.totalPeriodos()).to.equal(4);
      expect(await apolice.periodoAcionador()).to.equal(20261004);
    });
  });

  // -------------------------------------------------------------------------
  // Operadores da condicao contratada
  // -------------------------------------------------------------------------
  describe("operadores da condicao", function () {
    it("CLIMATICO ignora o indice de dano", async function () {
      const { apolice, oraculo } = await cenarioApoliceAtiva();

      await publicar(apolice, oraculo, 20261001, 5, 10_000);

      expect(await apolice.situacao()).to.equal(Situacao.ATIVA);
    });

    it("DANO ignora o indice climatico", async function () {
      const { apolice, oraculo, produtor } = await cenarioApoliceAtiva({
        operador: Operador.DANO,
        limiarClimatico: 0,
        limiarDanoBps: 4_000,
      });

      await publicar(apolice, oraculo, 20261001, 999, 3_999);
      expect(await apolice.situacao()).to.equal(Situacao.ATIVA);

      await expect(publicar(apolice, oraculo, 20261002, 0, 4_000)).to.changeEtherBalance(
        produtor,
        VALOR_INDENIZACAO,
      );
    });

    it("OU aciona com qualquer um dos dois indices", async function () {
      const { apolice, oraculo, produtor } = await cenarioApoliceAtiva({
        operador: Operador.OU,
        limiarClimatico: 30,
        limiarDanoBps: 4_000,
      });

      // Nenhum dos dois atinge: nao aciona.
      await publicar(apolice, oraculo, 20261001, 29, 3_999);
      expect(await apolice.situacao()).to.equal(Situacao.ATIVA);

      // So o dano atinge: aciona.
      await expect(publicar(apolice, oraculo, 20261002, 0, 4_000)).to.changeEtherBalance(
        produtor,
        VALOR_INDENIZACAO,
      );
    });

    it("E exige os dois indices no mesmo periodo", async function () {
      const { apolice, oraculo, produtor } = await cenarioApoliceAtiva({
        operador: Operador.E,
        limiarClimatico: 30,
        limiarDanoBps: 4_000,
      });

      await publicar(apolice, oraculo, 20261001, 40, 3_999);
      expect(await apolice.situacao()).to.equal(Situacao.ATIVA);

      await publicar(apolice, oraculo, 20261002, 29, 9_000);
      expect(await apolice.situacao()).to.equal(Situacao.ATIVA);

      await expect(publicar(apolice, oraculo, 20261003, 30, 4_000)).to.changeEtherBalance(
        produtor,
        VALOR_INDENIZACAO,
      );
    });
  });

  // -------------------------------------------------------------------------
  // RF25 - Pagamento escalonado
  // -------------------------------------------------------------------------
  describe("pagamento escalonado (RF25)", function () {
    function cenarioEscalonado(extra = {}) {
      return cenarioApoliceAtiva({
        modoPagamento: ModoPagamento.ESCALONADO,
        limiarClimatico: 30,
        limiarClimaticoIntegral: 60,
        ...extra,
      });
    }

    it("paga metade do limite no gatilho", async function () {
      const { apolice, oraculo, produtor } = await cenarioEscalonado();

      expect(await apolice.simularPercentual(30, 0)).to.equal(5_000);

      await expect(publicar(apolice, oraculo, 20261001, 30)).to.changeEtherBalance(
        produtor,
        VALOR_INDENIZACAO / 2n,
      );
    });

    it("interpola linearmente entre o gatilho e o teto", async function () {
      const { apolice, oraculo, produtor } = await cenarioEscalonado();

      // 45 dias: metade do caminho entre 30 e 60, logo 50% + metade de 50% = 75%.
      expect(await apolice.simularPercentual(45, 0)).to.equal(7_500);

      await expect(publicar(apolice, oraculo, 20261001, 45)).to.changeEtherBalance(
        produtor,
        (VALOR_INDENIZACAO * 7_500n) / 10_000n,
      );
    });

    it("paga o limite integral no teto e acima dele", async function () {
      const { apolice, oraculo, produtor } = await cenarioEscalonado();

      expect(await apolice.simularPercentual(60, 0)).to.equal(10_000);
      expect(await apolice.simularPercentual(120, 0)).to.equal(10_000);

      await expect(publicar(apolice, oraculo, 20261001, 75)).to.changeEtherBalance(
        produtor,
        VALOR_INDENIZACAO,
      );
    });

    it("nao paga nada abaixo do gatilho", async function () {
      const { apolice } = await cenarioEscalonado();

      expect(await apolice.simularPercentual(29, 0)).to.equal(0);
    });

    it("com os dois indices acionando, vale o maior percentual", async function () {
      const { apolice } = await cenarioEscalonado({
        operador: Operador.OU,
        limiarDanoBps: 4_000,
        limiarDanoIntegralBps: 8_000,
      });

      // Clima em 45 de 60 rende 75%; dano em 4000 de 8000 rende 50%. Vale 75%.
      expect(await apolice.simularPercentual(45, 4_000)).to.equal(7_500);

      // Invertendo: clima no gatilho rende 50%; dano em 7000 rende 87,5%. Vale 87,5%.
      expect(await apolice.simularPercentual(30, 7_000)).to.equal(8_750);
    });

    it("escalona apenas pelo indice de dano quando a condicao ignora o clima", async function () {
      const { apolice, oraculo, produtor } = await cenarioApoliceAtiva({
        operador: Operador.DANO,
        modoPagamento: ModoPagamento.ESCALONADO,
        limiarClimatico: 0,
        limiarClimaticoIntegral: 0,
        limiarDanoBps: 4_000,
        limiarDanoIntegralBps: 8_000,
      });

      // Dano em 6000, na metade do caminho entre 4000 e 8000: 50% + 25% = 75%.
      expect(await apolice.simularPercentual(9_999, 6_000)).to.equal(7_500);

      await expect(publicar(apolice, oraculo, 20261001, 0, 6_000)).to.changeEtherBalance(
        produtor,
        (VALOR_INDENIZACAO * 7_500n) / 10_000n,
      );
    });

    it("o modo integral ignora a severidade e sempre paga 100%", async function () {
      const { apolice } = await cenarioApoliceAtiva();

      expect(await apolice.simularPercentual(30, 0)).to.equal(10_000);
      expect(await apolice.simularPercentual(300, 0)).to.equal(10_000);
      expect(await apolice.simularPercentual(29, 0)).to.equal(0);
    });
  });

  // -------------------------------------------------------------------------
  // Encerramento
  // -------------------------------------------------------------------------
  describe("resgate da garantia", function () {
    it("devolve a garantia a seguradora apos o fim da vigencia sem acionamento", async function () {
      const { apolice, seguradora, oraculo, termos } = await cenarioApoliceAtiva();

      await publicar(apolice, oraculo, 20261001, 10);
      await time.increaseTo(Number(termos.vigenciaFim) + 1);

      // Os dois matchers sao assincronos e nao podem ser encadeados na mesma
      // assercao, entao o saldo e conferido na chamada e o evento logo depois.
      const transacao = apolice.connect(seguradora).resgatarGarantia();

      await expect(transacao).to.changeEtherBalance(seguradora, VALOR_INDENIZACAO, {
        includeFee: false,
      });
      await expect(transacao)
        .to.emit(apolice, "GarantiaResgatada")
        .withArgs(seguradora.address, VALOR_INDENIZACAO);

      expect(await apolice.situacao()).to.equal(Situacao.ENCERRADA);
      expect(await apolice.garantiaRetida()).to.equal(0);
    });

    it("recusa resgate durante a vigencia", async function () {
      const { apolice, seguradora } = await cenarioApoliceAtiva();

      await expect(apolice.connect(seguradora).resgatarGarantia()).to.be.revertedWithCustomError(
        apolice,
        "VigenciaEmCurso",
      );
    });

    it("recusa resgate de quem nao e a seguradora", async function () {
      const { apolice, estranho, termos } = await cenarioApoliceAtiva();

      await time.increaseTo(Number(termos.vigenciaFim) + 1);

      await expect(apolice.connect(estranho).resgatarGarantia())
        .to.be.revertedWithCustomError(apolice, "OrigemNaoAutorizada")
        .withArgs(estranho.address);
    });

    it("recusa resgate depois da liquidacao", async function () {
      const { apolice, seguradora, oraculo, termos } = await cenarioApoliceAtiva();

      await publicar(apolice, oraculo, 20261001, 40);
      await time.increaseTo(Number(termos.vigenciaFim) + 1);

      await expect(apolice.connect(seguradora).resgatarGarantia())
        .to.be.revertedWithCustomError(apolice, "SituacaoInvalida")
        .withArgs(Situacao.LIQUIDADA, Situacao.ATIVA);
    });

    it("recusa segundo resgate", async function () {
      const { apolice, seguradora, termos } = await cenarioApoliceAtiva();

      await time.increaseTo(Number(termos.vigenciaFim) + 1);
      await apolice.connect(seguradora).resgatarGarantia();

      await expect(apolice.connect(seguradora).resgatarGarantia())
        .to.be.revertedWithCustomError(apolice, "SituacaoInvalida")
        .withArgs(Situacao.ENCERRADA, Situacao.ATIVA);
    });
  });
});
