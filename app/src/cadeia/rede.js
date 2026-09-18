import implantacoes from "./implantacoes.json";

/**
 * Redes em que o aplicativo sabe operar, e os enderecos implantados em cada uma.
 *
 * Os enderecos vem de `contratos/implantacoes/<rede>.json`, copiado para ca pelo
 * script `npm run enderecos`, que roda automaticamente antes do `dev` e do `build`.
 * Nenhum endereco de contrato e digitado a mao em lugar nenhum do aplicativo.
 */

/** Rede escolhida por variavel de ambiente, com a local como padrao. */
export const REDE_ATIVA = import.meta.env.VITE_REDE || "localhost";

export const REDES = {
  localhost: {
    chainId: 31337,
    nome: "Hardhat local",
    moeda: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpc: "http://127.0.0.1:8545",
    explorador: null,
  },
  sepolia: {
    chainId: 11155111,
    nome: "Sepolia",
    moeda: { name: "Sepolia Ether", symbol: "ETH", decimals: 18 },
    rpc: import.meta.env.VITE_RPC_SEPOLIA || "https://rpc.sepolia.org",
    explorador: "https://sepolia.etherscan.io",
  },
};

/** Configuracao da rede ativa. */
export function redeAtiva() {
  const rede = REDES[REDE_ATIVA];

  if (!rede) {
    throw new Error(
      `Rede desconhecida: ${REDE_ATIVA}. Disponiveis: ${Object.keys(REDES).join(", ")}`,
    );
  }

  return { ...rede, chave: REDE_ATIVA };
}

/**
 * Enderecos dos contratos na rede ativa.
 * @returns {{OracleRegistry: string, ApoliceFactory: string}|null}
 */
export function enderecosDaRede(chave = REDE_ATIVA) {
  return implantacoes[chave]?.contratos ?? null;
}

/** Bloco a partir do qual vale procurar eventos. Evita varrer a cadeia inteira. */
export function blocoInicial(chave = REDE_ATIVA) {
  return implantacoes[chave]?.blocoInicial ?? 0;
}

/** Dados completos da implantacao, para a tela de diagnostico. */
export function implantacaoDaRede(chave = REDE_ATIVA) {
  return implantacoes[chave] ?? null;
}

/** Monta o link do explorador de blocos, quando a rede tiver um. */
export function linkDoExplorador(hashOuEndereco, tipo = "tx") {
  const { explorador } = redeAtiva();

  if (!explorador) return null;

  return `${explorador}/${tipo}/${hashOuEndereco}`;
}

/** Formato hexadecimal do chainId, como a MetaMask espera. */
export function chainIdHex(chainId) {
  return `0x${Number(chainId).toString(16)}`;
}
