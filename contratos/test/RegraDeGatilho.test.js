const { expect } = require("chai");
const { ethers } = require("hardhat");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const { montarTermos, cenarioApoliceAtiva, ModoPagamento, Operador } = require("./helpers");

/**
 * Teste de equivalencia entre a regra do contrato e a regra do aplicativo.
 *
 * O aplicativo reimplementa `_percentualDevido` em JavaScript, porque a tela de
 * cotacao precisa mostrar ao produtor o que aciona e o que nao aciona o pagamento
 * antes de existir qualquer contrato implantado para consultar (RNF06, e o
 * criterio de aceite 2 da HU10).
 *
 * Duas implementacoes da mesma regra divergem com o tempo — e a divergencia aqui
 * seria grave, porque o produtor aceitaria a apolice com base num numero que o
 * contrato nao vai honrar. Este teste compara as duas, caso a caso, de modo que
 * mexer em um dos lados sem mexer no outro quebre a suite.
 *
 * O arquivo do aplicativo e um modulo ESM e este projeto e CommonJS, dai o
 * `import()` dinamico.
 */
describe("Equivalencia entre a regra do contrato e a do aplicativo", function () {
  let regra;

  before(async function () {
    const arquivo = path.join(__dirname, "..", "..", "app", "src", "cadeia", "regraDeGatilho.js");
    regra = await import(pathToFileURL(arquivo).href);
  });

  /** Pontos escolhidos em torno dos limiares, onde a divergencia apareceria. */
  const CLIMAS = [0, 1, 29, 30, 31, 44, 45, 46, 59, 60, 61, 80, 1000];
  const DANOS = [0, 1, 3_999, 4_000, 4_001, 5_999, 6_000, 7_999, 8_000, 8_001, 10_000];

  /**
   * Compara as duas implementacoes em todos os pares de indices.
   * @param {object} termos Termos da apolice, ja com produtor e registry.
   */
  async function conferirEquivalencia(apolice, termos) {
    for (const clima of CLIMAS) {
      for (const dano of DANOS) {
        const doContrato = await apolice.simularPercentual(clima, dano);
        const doAplicativo = regra.percentualDevido(termos, clima, dano);

        expect(Number(doContrato)).to.equal(
          doAplicativo,
          `divergencia em clima=${clima}, dano=${dano}`,
        );
      }
    }
  }

  const CONFIGURACOES = [
    {
      nome: "climatico com pagamento integral",
      termos: { operador: Operador.CLIMATICO, modoPagamento: ModoPagamento.INTEGRAL },
    },
    {
      nome: "climatico com pagamento escalonado",
      termos: {
        operador: Operador.CLIMATICO,
        modoPagamento: ModoPagamento.ESCALONADO,
        limiarClimatico: 30,
        limiarClimaticoIntegral: 60,
      },
    },
    {
      nome: "dano com pagamento escalonado",
      termos: {
        operador: Operador.DANO,
        modoPagamento: ModoPagamento.ESCALONADO,
        limiarClimatico: 0,
        limiarClimaticoIntegral: 0,
        limiarDanoBps: 4_000,
        limiarDanoIntegralBps: 8_000,
      },
    },
    {
      nome: "operador OU com pagamento escalonado",
      termos: {
        operador: Operador.OU,
        modoPagamento: ModoPagamento.ESCALONADO,
        limiarClimatico: 30,
        limiarClimaticoIntegral: 60,
        limiarDanoBps: 4_000,
        limiarDanoIntegralBps: 8_000,
      },
    },
    {
      nome: "operador E com pagamento integral",
      termos: {
        operador: Operador.E,
        modoPagamento: ModoPagamento.INTEGRAL,
        limiarClimatico: 30,
        limiarDanoBps: 4_000,
      },
    },
  ];

  for (const configuracao of CONFIGURACOES) {
    it(`concorda com o contrato: ${configuracao.nome}`, async function () {
      const { apolice, termos } = await cenarioApoliceAtiva(configuracao.termos);

      await conferirEquivalencia(apolice, termos);
    });
  }

  it("o valor devido em wei tambem bate com o limite contratado", async function () {
    const { apolice, termos } = await cenarioApoliceAtiva({
      modoPagamento: ModoPagamento.ESCALONADO,
      limiarClimatico: 30,
      limiarClimaticoIntegral: 60,
    });

    for (const clima of [30, 45, 60, 90]) {
      const percentual = BigInt(await apolice.simularPercentual(clima, 0));
      const esperado = (BigInt(termos.valorIndenizacao) * percentual) / 10_000n;

      expect(regra.valorDevido(termos, clima, 0)).to.equal(esperado);
    }
  });

  it("os exemplos mostrados na cotacao sao calculados pela mesma regra", async function () {
    const termos = await montarTermos({
      modoPagamento: ModoPagamento.ESCALONADO,
      limiarClimatico: 30,
      limiarClimaticoIntegral: 60,
    });

    const exemplos = regra.exemplosDeAcionamento(termos);

    // Precisa haver ao menos um exemplo que nao aciona e um que paga integral,
    // senao a tela nao cumpre o que o RNF06 pede.
    expect(exemplos.some((e) => e.percentualBps === 0)).to.equal(true);
    expect(exemplos.some((e) => e.percentualBps === 10_000)).to.equal(true);

    for (const exemplo of exemplos) {
      expect(regra.percentualDevido(termos, exemplo.diasSemChuva, 0)).to.equal(
        exemplo.percentualBps,
      );
    }
  });
});
