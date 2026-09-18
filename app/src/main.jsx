import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";

import App from "./App";
import { ProvedorCarteira } from "./cadeia/CarteiraContexto";
import { ProvedorSessao } from "./sessao/SessaoContexto";
import { deveSimularCarteira, instalarCarteiraSimulada } from "./cadeia/carteiraSimulada";
import { REDE_ATIVA, redeAtiva } from "./cadeia/rede";
import "./estilos.css";

/**
 * Ponto de entrada do aplicativo.
 *
 * A carteira simulada, quando pedida, e instalada ANTES do primeiro render. O
 * contexto le `window.ethereum` na montagem, entao instalar depois nao adiantaria:
 * o aplicativo ja teria decidido que nao ha carteira no navegador.
 */
async function iniciar() {
  if (deveSimularCarteira(REDE_ATIVA)) {
    const indice = Number(new URLSearchParams(window.location.search).get("conta") ?? 0);

    try {
      await instalarCarteiraSimulada(redeAtiva().rpc, indice);
    } catch (erro) {
      // Sem carteira simulada o aplicativo continua funcionando em modo leitura.
      // Derrubar a tela inteira por causa de uma ferramenta de desenvolvimento
      // seria trocar um problema pequeno por um grande.
      console.error("Nao foi possivel instalar a carteira simulada:", erro);
    }
  }

  createRoot(document.getElementById("raiz")).render(
    <React.StrictMode>
      <BrowserRouter>
        <ProvedorSessao>
          <ProvedorCarteira>
            <App />
          </ProvedorCarteira>
        </ProvedorSessao>
      </BrowserRouter>
    </React.StrictMode>,
  );
}

iniciar();
