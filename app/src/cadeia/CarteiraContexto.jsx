import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { ethers } from "ethers";

import { chainIdHex, redeAtiva } from "./rede";
import { mensagemDeErro } from "./formatos";

/**
 * Conexao com a carteira do produtor ou da seguradora.
 *
 * A chave privada nunca passa por aqui: o aplicativo pede a assinatura, a carteira
 * assina, e o que volta e apenas o resultado. O RNF17 diz que a chave privada do
 * produtor nunca deve ser armazenada, e a forma de garantir isso e nunca te-la.
 *
 * Duas conexoes coexistem de proposito:
 *  - `provedorLeitura` fala direto com o no RPC configurado. Le a cadeia mesmo sem
 *    carteira instalada, o que mantem as telas de consulta utilizaveis.
 *  - `signatario` vem da carteira e so existe depois da conexao. E o unico caminho
 *    para qualquer operacao que altere estado.
 */

const ContextoCarteira = createContext(null);

const CHAVE_PREFERENCIA = "agrosmart:carteira-conectada";

export function ProvedorCarteira({ children }) {
  const rede = useMemo(() => redeAtiva(), []);

  const [conta, setConta] = useState(null);
  const [chainId, setChainId] = useState(null);
  const [signatario, setSignatario] = useState(null);
  const [conectando, setConectando] = useState(false);
  const [erro, setErro] = useState(null);

  const temCarteira = typeof window !== "undefined" && Boolean(window.ethereum);

  /** Provedor somente leitura. Nao depende de carteira instalada. */
  const provedorLeitura = useMemo(
    () =>
      new ethers.JsonRpcProvider(rede.rpc, rede.chainId, {
        staticNetwork: true,
      }),
    [rede],
  );

  const redeCorreta = chainId !== null && Number(chainId) === Number(rede.chainId);

  /** Atualiza o signatario a partir da carteira, apos conexao ou troca de conta. */
  const sincronizar = useCallback(async () => {
    if (!window.ethereum) return;

    const provedor = new ethers.BrowserProvider(window.ethereum);
    const contas = await provedor.send("eth_accounts", []);

    if (contas.length === 0) {
      setConta(null);
      setSignatario(null);
      return;
    }

    const assinante = await provedor.getSigner();
    const identificador = await provedor.send("eth_chainId", []);

    setConta(ethers.getAddress(contas[0]));
    setSignatario(assinante);
    setChainId(Number(identificador));
  }, []);

  useEffect(() => {
    if (!temCarteira) return undefined;

    // Reconecta em silencio se o usuario ja havia autorizado esta origem.
    if (localStorage.getItem(CHAVE_PREFERENCIA) === "sim") sincronizar();

    const aoTrocarConta = () => sincronizar();
    const aoTrocarRede = (id) => {
      setChainId(Number(id));
      sincronizar();
    };

    window.ethereum.on("accountsChanged", aoTrocarConta);
    window.ethereum.on("chainChanged", aoTrocarRede);

    return () => {
      window.ethereum.removeListener("accountsChanged", aoTrocarConta);
      window.ethereum.removeListener("chainChanged", aoTrocarRede);
    };
  }, [temCarteira, sincronizar]);

  const conectar = useCallback(async () => {
    setErro(null);

    if (!window.ethereum) {
      setErro(
        "Nenhuma carteira encontrada no navegador. Instale a extensao MetaMask para continuar.",
      );
      return;
    }

    setConectando(true);

    try {
      await new ethers.BrowserProvider(window.ethereum).send("eth_requestAccounts", []);
      localStorage.setItem(CHAVE_PREFERENCIA, "sim");
      await sincronizar();
    } catch (falha) {
      setErro(mensagemDeErro(falha));
    } finally {
      setConectando(false);
    }
  }, [sincronizar]);

  const desconectar = useCallback(() => {
    // A carteira nao expoe um "desconectar" de verdade: quem concede a permissao
    // e o usuario, pela propria extensao. O que se faz aqui e esquecer a conta no
    // aplicativo e parar de reconectar em silencio.
    localStorage.removeItem(CHAVE_PREFERENCIA);
    setConta(null);
    setSignatario(null);
  }, []);

  /**
   * Pede a carteira para mudar para a rede configurada, cadastrando-a se preciso.
   *
   * A rede local nao consta da lista de redes conhecidas da MetaMask, entao o
   * `wallet_switchEthereumChain` falha com o codigo 4902 na primeira vez. E o
   * caso de cadastrar e tentar de novo, em vez de mandar o usuario fazer isso a mao.
   */
  const trocarDeRede = useCallback(async () => {
    setErro(null);

    if (!window.ethereum) return;

    try {
      await window.ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: chainIdHex(rede.chainId) }],
      });
    } catch (falha) {
      if (falha.code !== 4902) {
        setErro(mensagemDeErro(falha));
        return;
      }

      try {
        await window.ethereum.request({
          method: "wallet_addEthereumChain",
          params: [
            {
              chainId: chainIdHex(rede.chainId),
              chainName: rede.nome,
              nativeCurrency: rede.moeda,
              rpcUrls: [rede.rpc],
              blockExplorerUrls: rede.explorador ? [rede.explorador] : undefined,
            },
          ],
        });
      } catch (falhaAoCadastrar) {
        setErro(mensagemDeErro(falhaAoCadastrar));
      }
    }
  }, [rede]);

  /**
   * Assina uma mensagem para comprovar a titularidade da carteira (RF02, HU07).
   *
   * A verificacao acontece no navegador enquanto nao existe back-end. Isso prova
   * que a assinatura corresponde ao endereco, mas nao substitui a verificacao no
   * servidor: um cliente adulterado poderia mentir para si mesmo. A verificacao
   * definitiva entra junto com a API, na Sprint 2.
   */
  const assinarVinculo = useCallback(
    async (identificadorDoUsuario) => {
      if (!signatario) throw new Error("Conecte a carteira antes de assinar.");

      const desafio =
        `AgroSmart — vinculo de carteira\n` +
        `usuario: ${identificadorDoUsuario}\n` +
        `endereco: ${conta}\n` +
        `emitido em: ${new Date().toISOString()}\n` +
        `numero unico: ${ethers.hexlify(ethers.randomBytes(16))}`;

      const assinatura = await signatario.signMessage(desafio);
      const enderecoRecuperado = ethers.verifyMessage(desafio, assinatura);

      if (enderecoRecuperado.toLowerCase() !== conta.toLowerCase()) {
        throw new Error("A assinatura nao corresponde ao endereco conectado.");
      }

      return { desafio, assinatura, endereco: enderecoRecuperado };
    },
    [signatario, conta],
  );

  const valor = useMemo(
    () => ({
      rede,
      temCarteira,
      conta,
      chainId,
      redeCorreta,
      signatario,
      provedorLeitura,
      conectando,
      erro,
      conectar,
      desconectar,
      trocarDeRede,
      assinarVinculo,
      limparErro: () => setErro(null),
    }),
    [
      rede,
      temCarteira,
      conta,
      chainId,
      redeCorreta,
      signatario,
      provedorLeitura,
      conectando,
      erro,
      conectar,
      desconectar,
      trocarDeRede,
      assinarVinculo,
    ],
  );

  return <ContextoCarteira.Provider value={valor}>{children}</ContextoCarteira.Provider>;
}

export function useCarteira() {
  const contexto = useContext(ContextoCarteira);

  if (!contexto) throw new Error("useCarteira precisa estar dentro de ProvedorCarteira.");

  return contexto;
}
