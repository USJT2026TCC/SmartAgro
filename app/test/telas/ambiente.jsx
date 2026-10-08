/**
 * Ambiente dos testes de tela.
 *
 * O aplicativo roda inteiro — rotas, sessao, carteira, telas —, e so as duas
 * fronteiras sao substituidas:
 *
 *  - a API: `fetch` responde a partir de uma tabela "METODO /caminho"; o
 *    cliente da API (src/api/cliente.js) continua sendo o de verdade;
 *  - a carteira: um provedor EIP-1193 falso em window.ethereum, o mesmo
 *    protocolo que a MetaMask expoe.
 *
 * As leituras da cadeia (src/cadeia/contratos.js) sao simuladas em cada arquivo
 * de teste com vi.mock, porque dependem de um no.
 */
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { expect, vi } from "vitest";

import App from "../../src/App";
import { ProvedorCarteira } from "../../src/cadeia/CarteiraContexto";
import { ProvedorSessao } from "../../src/sessao/SessaoContexto";

export const CONTA_DO_PRODUTOR = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
export const CONTA_DA_SEGURADORA = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";

export const USUARIOS = {
  produtor: {
    id: "u-produtor",
    identificador: "produtor",
    nome: "Joao Ribeiro",
    perfil: "produtor",
    carteira: CONTA_DO_PRODUTOR.toLowerCase(),
    totpAtivo: false,
  },
  seguradora: {
    id: "u-seguradora",
    identificador: "seguradora",
    nome: "Marina Costa",
    perfil: "seguradora",
    carteira: null,
    totpAtivo: false,
  },
  perito: {
    id: "u-perito",
    identificador: "perito",
    nome: "Carlos Lima",
    perfil: "perito",
    carteira: null,
    totpAtivo: false,
  },
};

/** Compara o caminho pedido com o padrao da tabela, aceitando :parametros. */
function casa(padrao, caminho) {
  const a = padrao.split("/");
  const b = caminho.split("/");
  return a.length === b.length && a.every((parte, i) => parte.startsWith(":") || parte === b[i]);
}

/**
 * Instala o backend falso. `rotas` mapeia "GET /talhoes" para a resposta, ou
 * para uma funcao (pedido) => resposta. A resposta pode ser {status, corpo}.
 * Devolve a lista de chamadas feitas, para conferencia.
 */
export function backendFalso(rotas = {}) {
  const chamadas = [];

  globalThis.fetch = vi.fn(async (url, opcoes = {}) => {
    const [caminho, consulta = ""] = String(url).replace(/^\/api/, "").split("?");
    const metodo = opcoes.method ?? "GET";
    const corpo =
      typeof opcoes.body === "string" ? JSON.parse(opcoes.body) : (opcoes.body ?? undefined);
    const pedido = { metodo, caminho, consulta: new URLSearchParams(consulta), corpo };
    chamadas.push(pedido);

    const chave = Object.keys(rotas).find((k) => {
      const [m, p] = k.split(" ");
      return m === metodo && casa(p, caminho);
    });

    let resposta = chave ? rotas[chave] : { status: 404, corpo: { erro: { mensagem: `sem rota ${metodo} ${caminho}` } } };
    if (typeof resposta === "function") resposta = await resposta(pedido);

    const temStatus = resposta && typeof resposta === "object" && "status" in resposta && "corpo" in resposta;
    const status = temStatus ? resposta.status : 200;
    const dados = temStatus ? resposta.corpo : resposta;

    return new Response(status === 204 ? null : JSON.stringify(dados ?? {}), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  });

  return chamadas;
}

/** Carteira EIP-1193 falsa, conectada a `conta`. */
export function carteiraFalsa(conta, { chainId = 31337 } = {}) {
  const pedidos = [];
  window.ethereum = {
    pedidos,
    async request({ method, params }) {
      pedidos.push({ method, params });
      switch (method) {
        case "eth_accounts":
        case "eth_requestAccounts":
          return [conta];
        case "eth_chainId":
          return `0x${chainId.toString(16)}`;
        case "personal_sign":
          return `0x${"ab".repeat(65)}`;
        case "wallet_switchEthereumChain":
        case "wallet_addEthereumChain":
          return null;
        default:
          throw new Error(`metodo nao simulado: ${method}`);
      }
    },
    on() {},
    removeListener() {},
  };
  localStorage.setItem("agrosmart:carteira-conectada", "sim");
  return window.ethereum;
}

/**
 * Abre o aplicativo em `caminho`, autenticado como `perfil` (ou anonimo, com
 * perfil nulo). As rotas extras sao somadas as de sessao.
 */
export async function abrir(caminho, { perfil = null, rotas = {} } = {}) {
  const usuario = perfil ? USUARIOS[perfil] : null;
  if (usuario) sessionStorage.setItem("agrosmart:token", "token-de-teste");
  else sessionStorage.removeItem("agrosmart:token");

  const chamadas = backendFalso({
    "GET /autenticacao/eu": { usuario },
    "GET /notificacoes": { notificacoes: [], naoLidas: 0 },
    "POST /autenticacao/sair": { ok: true },
    ...rotas,
  });

  const resultado = render(
    <MemoryRouter initialEntries={[caminho]}>
      <ProvedorSessao>
        <ProvedorCarteira>
          <App />
        </ProvedorCarteira>
      </ProvedorSessao>
    </MemoryRouter>,
  );

  if (usuario) await waitFor(() => expect(screen.queryByText(/Verificando a sessao/)).toBeNull());

  return { ...resultado, chamadas };
}

/** Espera um texto aparecer (aceita expressao regular). */
export const achar = (texto) => screen.findAllByText(texto, {}, { timeout: 3000 }).then((l) => l[0]);
