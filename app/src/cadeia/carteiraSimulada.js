/**
 * Carteira simulada para desenvolvimento.
 *
 * PARA QUE SERVE
 *
 * A equipe tem cinco pessoas, e nem todas precisam mexer com contratos. Instalar a
 * MetaMask, criar carteira e trocar de rede so para conferir um ajuste de layout e
 * atrito desnecessario. Este modulo resolve isso: implementa a mesma interface que
 * a extensao expoe (EIP-1193) e encaminha tudo para o no local.
 *
 * Funciona porque as contas do `npx hardhat node` estao destravadas: o proprio no
 * assina as transacoes, entao `eth_sendTransaction` e `personal_sign` respondem
 * sem que exista carteira alguma no navegador.
 *
 * QUANDO ELE ENTRA
 *
 * Nunca por acaso. Sao tres condicoes ao mesmo tempo:
 *   1. o aplicativo esta em modo de desenvolvimento (`import.meta.env.DEV`);
 *   2. a rede configurada e a local;
 *   3. o endereco traz `?carteira=simulada`.
 *
 * Em `npm run build` o `import.meta.env.DEV` e falso e o empacotador remove este
 * caminho inteiro do pacote publicado. Em rede de teste publica ele nao funciona,
 * porque nao existe conta destravada na Sepolia.
 *
 * Enquanto esta ativo, a interface mostra um aviso permanente. Uma demonstracao em
 * que a assinatura e simulada, sem ninguem perceber, seria pior do que nao ter
 * demonstracao — o ponto do trabalho e justamente quem assina o que.
 */

/** Verdadeiro quando as tres condicoes de ativacao sao atendidas. */
export function deveSimularCarteira(redeChave) {
  if (!import.meta.env.DEV) return false;
  if (redeChave !== "localhost") return false;

  return new URLSearchParams(window.location.search).get("carteira") === "simulada";
}

/**
 * Instala a carteira simulada em `window.ethereum`.
 *
 * @param {string} rpcUrl Endpoint do no local.
 * @param {number} indiceDaConta Qual conta do no usar. Por convencao do projeto:
 *   0 = seguradora, 1 = produtor, 2 = oraculo.
 */
export async function instalarCarteiraSimulada(rpcUrl, indiceDaConta = 0) {
  let proximoId = 1;

  async function chamar(method, params = []) {
    const resposta = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: proximoId++, method, params }),
    });

    const corpo = await resposta.json();

    if (corpo.error) {
      const erro = new Error(corpo.error.message);
      erro.code = corpo.error.code;
      erro.data = corpo.error.data;
      throw erro;
    }

    return corpo.result;
  }

  const todas = await chamar("eth_accounts");
  const conta = todas[indiceDaConta];

  if (!conta) {
    throw new Error(
      `O no em ${rpcUrl} nao expos a conta de indice ${indiceDaConta}. O hardhat node esta rodando?`,
    );
  }

  const ouvintes = new Map();

  window.ethereum = {
    isMetaMask: false,
    isCarteiraSimulada: true,
    contaAtual: conta,

    async request({ method, params = [] }) {
      switch (method) {
        case "eth_requestAccounts":
        case "eth_accounts":
          return [conta];

        // A troca de rede nao faz sentido aqui: o no simulado e sempre o local.
        case "wallet_switchEthereumChain":
        case "wallet_addEthereumChain":
          return null;

        // O ethers manda `personal_sign` com a conta no segundo parametro; o
        // hardhat assina porque a conta esta destravada.
        case "personal_sign":
          return chamar("personal_sign", params);

        case "eth_sendTransaction": {
          // A carteira real preenche o remetente; aqui e preciso garantir que a
          // transacao saia da conta escolhida, e nao da primeira do no.
          const [transacao] = params;

          return chamar("eth_sendTransaction", [{ ...transacao, from: transacao.from ?? conta }]);
        }

        default:
          return chamar(method, params);
      }
    },

    on(evento, callback) {
      if (!ouvintes.has(evento)) ouvintes.set(evento, new Set());
      ouvintes.get(evento).add(callback);
    },

    removeListener(evento, callback) {
      ouvintes.get(evento)?.delete(callback);
    },
  };

  return conta;
}

/** Troca a conta ativa da carteira simulada, para alternar de papel na demonstracao. */
export async function trocarContaSimulada(rpcUrl, indiceDaConta) {
  await instalarCarteiraSimulada(rpcUrl, indiceDaConta);
  window.location.reload();
}
