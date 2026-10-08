require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();

/**
 * Configuracao do ambiente de contratos do AgroSmart.
 *
 * Duas redes sao usadas no trabalho, conforme a secao 1.5 da documentacao de software:
 *  - hardhat/localhost: rede local, para desenvolvimento e medicao de gas isolada;
 *  - sepolia: rede de teste publica, onde os numeros finais sao coletados.
 *
 * Nenhuma chave privada aparece aqui. Elas sao lidas de variaveis de ambiente
 * definidas no arquivo .env, que esta no .gitignore (RNF14).
 */

const CHAVE_SEGURADORA = process.env.CHAVE_PRIVADA_SEGURADORA;
const CHAVE_ORACULO = process.env.CHAVE_PRIVADA_ORACULO;
const RPC_SEPOLIA = process.env.RPC_SEPOLIA || "";
const ETHERSCAN_API_KEY = process.env.ETHERSCAN_API_KEY || "";

const contasSepolia = [CHAVE_SEGURADORA, CHAVE_ORACULO].filter(Boolean);

// Preco do gas na Sepolia, em gwei. Sem ele, o Hardhat oferece 1 gwei de gorjeta
// por transacao — na primeira implantacao (07/10/2026) a rede aceitava 0,001 gwei,
// e o custo saiu mil vezes maior que o necessario. Se a taxa base da rede subir
// acima deste valor, a transacao fica parada: suba o numero no .env.
const PRECO_GAS_GWEI = process.env.PRECO_GAS_GWEI;
const precoGasSepolia = PRECO_GAS_GWEI ? Math.round(Number(PRECO_GAS_GWEI) * 1e9) : "auto";

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.24",
    settings: {
      // O otimizador fica ligado porque o RNF07 exige medir e documentar o gas de
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
      gasPrice: precoGasSepolia,
    },
  },

  // Relatorio de gas por funcao (RNF07, HU01 criterio 4, HU03).
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
