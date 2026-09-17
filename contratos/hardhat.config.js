require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();

/**
 * Configuracao do ambiente de contratos do AgroSmart.
 *
 * Duas redes sao usadas no trabalho, conforme a secao 3.3 da documentacao:
 *  - hardhat/localhost: rede local, para desenvolvimento e medicao de gas isolada;
 *  - sepolia: rede de teste publica, onde os numeros finais sao coletados.
 *
 * Nenhuma chave privada aparece aqui. Elas sao lidas de variaveis de ambiente
 * definidas no arquivo .env, que esta no .gitignore (RNF16).
 */

const CHAVE_SEGURADORA = process.env.CHAVE_PRIVADA_SEGURADORA;
const CHAVE_ORACULO = process.env.CHAVE_PRIVADA_ORACULO;
const RPC_SEPOLIA = process.env.RPC_SEPOLIA || "";
const ETHERSCAN_API_KEY = process.env.ETHERSCAN_API_KEY || "";

const contasSepolia = [CHAVE_SEGURADORA, CHAVE_ORACULO].filter(Boolean);

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.24",
    settings: {
      // O otimizador fica ligado porque o RNF09 exige medir e documentar o gas de
      // cada funcao publica. Medir com o otimizador desligado produziria numeros
      // que nao correspondem ao que seria implantado de fato.
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },

  networks: {
    // Rede em memoria usada pelos testes automatizados.
    hardhat: {
      chainId: 31337,
    },
    // Rede local persistente, iniciada com `npx hardhat node`.
    localhost: {
      url: "http://127.0.0.1:8545",
      chainId: 31337,
    },
    // Rede de teste publica.
    sepolia: {
      url: RPC_SEPOLIA,
      accounts: contasSepolia,
      chainId: 11155111,
    },
  },

  // Relatorio de gas por funcao (RNF09, HU01 criterio 4, HU03).
  gasReporter: {
    enabled: process.env.REPORT_GAS === "true",
    currency: "BRL",
    outputFile: process.env.GAS_OUTPUT_FILE || undefined,
    noColors: Boolean(process.env.GAS_OUTPUT_FILE),
  },

  etherscan: {
    apiKey: ETHERSCAN_API_KEY,
  },

  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts",
  },

  mocha: {
    timeout: 120000,
  },
};
