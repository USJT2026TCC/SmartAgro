import { useEffect, useState } from "react";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";

import { api } from "../api/cliente";
import { useSessao } from "../sessao/SessaoContexto";
import { PERFIS, ROTULOS_DE_PERFIL } from "../sessao/perfis";
import { useCarteira } from "../cadeia/CarteiraContexto";
import { enderecoCurto } from "../cadeia/formatos";

/**
 * Barra superior: identidade, navegacao por perfil, notificacoes e carteira.
 *
 * A navegacao muda conforme o perfil autenticado (RF04, na interface). O controle
 * de verdade esta no backend: esconder um link nao impede ninguem de chamar a API.
 */

const MENUS = {
  [PERFIS.PRODUTOR]: [
    { para: "/produtor", texto: "Minhas apolices", fim: true },
    { para: "/produtor/cotacao", texto: "Simular e contratar" },
    { para: "/produtor/carteira", texto: "Minha carteira" },
  ],
  [PERFIS.SEGURADORA]: [
    { para: "/seguradora", texto: "Carteira", fim: true },
    { para: "/seguradora/propostas", texto: "Propostas" },
    { para: "/seguradora/talhoes", texto: "Talhoes e produtos" },
    { para: "/seguradora/fontes", texto: "Fontes" },
    { para: "/seguradora/oraculos", texto: "Oraculos" },
  ],
  [PERFIS.PERITO]: [{ para: "/perito", texto: "Revisao tecnica", fim: true }],
};

/** De quanto em quanto tempo o contador de notificacoes e atualizado. */
const INTERVALO_NOTIFICACOES_MS = 15_000;

export default function Cabecalho() {
  const { usuario, sair } = useSessao();
  const { conta, redeCorreta, rede, temCarteira, conectar, conectando, trocarDeRede } =
    useCarteira();
  const navegar = useNavigate();
  const local = useLocation();

  const [naoLidas, setNaoLidas] = useState(0);

  const itens = MENUS[usuario?.perfil] ?? [];

  // Aviso permanente enquanto a carteira simulada estiver ativa. Uma demonstracao
  // em que a assinatura e simulada, sem ninguem perceber, seria pior do que nenhuma.
  const carteiraSimulada = typeof window !== "undefined" && window.ethereum?.isCarteiraSimulada;

  useEffect(() => {
    if (!usuario) return undefined;

    let ativo = true;
    const atualizar = () =>
      api("/notificacoes")
        .then((r) => ativo && setNaoLidas(r.naoLidas))
        .catch(() => {});

    atualizar();
    const temporizador = setInterval(atualizar, INTERVALO_NOTIFICACOES_MS);
    window.addEventListener("agrosmart:notificacoes", atualizar);

    return () => {
      ativo = false;
      clearInterval(temporizador);
      window.removeEventListener("agrosmart:notificacoes", atualizar);
    };
  }, [usuario, local.pathname]);

  async function encerrarSessao() {
    await sair();
    navegar("/entrar", { replace: true });
  }

  return (
    <header className="cabecalho">
      {carteiraSimulada ? (
        <div className="faixa-simulada">
          Carteira simulada ativa — as transacoes sao assinadas pelo no local, nao por uma carteira
          real. Ferramenta de desenvolvimento; nao use em demonstracao.
        </div>
      ) : null}

      <div className="cabecalho-interno">
        <a className="marca" href="/">
          AgroSmart
          <span>{rede.nome}</span>
        </a>

        <nav className="navegacao">
          {itens.map((item) => (
            <NavLink
              key={item.para}
              to={item.para}
              end={item.fim}
              className={({ isActive }) => (isActive ? "ativo" : "")}
            >
              {item.texto}
            </NavLink>
          ))}
        </nav>

        <div className="linha-de-botoes">
          <Link to="/notificacoes" className="notificacoes" title="Notificacoes">
            Avisos
            {naoLidas > 0 ? <span className="contador">{naoLidas}</span> : null}
          </Link>

          {!temCarteira ? (
            <span className="silencioso">Sem carteira no navegador</span>
          ) : !conta ? (
            <button className="secundario pequeno" onClick={conectar} disabled={conectando}>
              {conectando ? "Conectando…" : "Conectar carteira"}
            </button>
          ) : !redeCorreta ? (
            <button className="perigo pequeno" onClick={trocarDeRede}>
              Trocar para {rede.nome}
            </button>
          ) : (
            <span className="selo sucesso mono" title={conta}>
              {enderecoCurto(conta)}
            </span>
          )}

          {usuario ? (
            <>
              <Link to="/conta" className="silencioso" title={ROTULOS_DE_PERFIL[usuario.perfil]}>
                {usuario.nome}
              </Link>
              <button className="secundario pequeno" onClick={encerrarSessao}>
                Sair
              </button>
            </>
          ) : null}
        </div>
      </div>
    </header>
  );
}
