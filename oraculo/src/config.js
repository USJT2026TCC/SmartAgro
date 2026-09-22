"use strict";

const fs = require("node:fs");
const path = require("node:path");

require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

/**
 * Configuracao do servico de oraculo.
 *
 * Todo segredo vem de variavel de ambiente, nunca do codigo (RNF16). O arquivo
 * .env fica no .gitignore e cada integrante mantem o seu.
 *
 * Os enderecos dos contratos vem de `contratos/implantacoes/<rede>.json`, gerado
 * pelo script de implantacao. Copiar endereco a mao entre terminal e arquivo de
 * configuracao e uma das formas mais comuns de quebrar esse tipo de projeto.
 */

const RAIZ = path.join(__dirname, "..");

const config = {
  rede: process.env.REDE || "localhost",
  rpcUrl: process.env.RPC_URL || "http://127.0.0.1:8545",
  chavePrivada: process.env.CHAVE_PRIVADA_ORACULO || "",

  /** Diretorio dos arquivos de estado do servico (fila e registro de publicacoes). */
  dirDados: process.env.DIR_DADOS || path.join(RAIZ, "dados"),

  /** Onde o script de implantacao dos contratos grava os enderecos. */
  dirImplantacoes:
    process.env.DIR_IMPLANTACOES || path.join(RAIZ, "..", "contratos", "implantacoes"),

  /** Limite de chuva diaria, em milimetros, abaixo do qual o dia conta como seco. */
  limiarChuvaMm: Number(process.env.LIMIAR_CHUVA_MM || 1),

  /** Escore minimo de reputacao para que as leituras de uma fonte sejam usadas (RF13). */
  limiarReputacao: Number(process.env.LIMIAR_REPUTACAO || 0.5),

  /** Confianca minima do modelo de visao para publicar sem revisao do perito (RF17). */
  limiarConfiancaModelo: Number(process.env.LIMIAR_CONFIANCA_MODELO || 0.7),

  /** Tentativas de publicacao antes de a entrada da fila ser marcada como falha (RF21). */
  maxTentativas: Number(process.env.MAX_TENTATIVAS || 5),

  /** Espera inicial entre tentativas, em milissegundos. Dobra a cada tentativa. */
  esperaBaseMs: Number(process.env.ESPERA_BASE_MS || 2000),

  /** Confirmacoes aguardadas antes de considerar a publicacao concluida. */
  confirmacoes: Number(process.env.CONFIRMACOES || 1),

  /**
   * Tempo limite de cada requisicao ao no, em milissegundos.
   *
   * O padrao do ethers e de 300 segundos. Com o no fora do ar, isso faria o
   * servico travar em vez de devolver a publicacao a fila e tentar de novo mais
   * tarde, que e o comportamento exigido pelo RNF22.
   */
  timeoutMs: Number(process.env.TIMEOUT_MS || 10000),

  /**
   * API do backend. Com as duas variaveis definidas, o oraculo busca as leituras
   * no backend (`--fonte backend`) e relata cada publicacao. Sem elas, funciona
   * sozinho, com a fonte simulada.
   */
  apiUrl: process.env.API_URL || "",
  chaveDeServico: process.env.CHAVE_DE_SERVICO || "",

  /** Intervalo entre ciclos do modo servico, em milissegundos. */
  intervaloDoServicoMs: Number(process.env.INTERVALO_SERVICO_MS || 60000),
};

/**
 * Le os enderecos implantados na rede configurada.
 * @returns {{contratos: {OracleRegistry: string, ApoliceFactory: string}, oraculoAutorizado: string}}
 */
function lerImplantacao(rede = config.rede) {
  const arquivo = path.join(config.dirImplantacoes, `${rede}.json`);

  if (!fs.existsSync(arquivo)) {
    throw new Error(
      `Implantacao nao encontrada em ${arquivo}. ` +
        `Rode antes: cd contratos && npx hardhat run scripts/implantar.js --network ${rede}`,
    );
  }

  return JSON.parse(fs.readFileSync(arquivo, "utf8"));
}

/**
 * Valida o que e indispensavel para publicar em rede.
 * @throws {Error} quando falta a chave privada do oraculo.
 */
function exigirChave() {
  if (!config.chavePrivada) {
    throw new Error(
      "CHAVE_PRIVADA_ORACULO nao definida. Copie .env.example para .env e preencha. " +
        "A chave nunca deve ser escrita no codigo nem enviada ao repositorio.",
    );
  }

  return config.chavePrivada;
}

module.exports = { config, lerImplantacao, exigirChave };
