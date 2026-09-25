import { Navigate, Route, Routes, useNavigate } from "react-router-dom";

import Cabecalho from "./componentes/Cabecalho";
import RotaProtegida from "./componentes/RotaProtegida";
import { Aviso } from "./componentes/ui";
import { useSessao } from "./sessao/SessaoContexto";
import { PERFIS } from "./sessao/perfis";

import Entrar from "./paginas/Entrar";
import ApoliceDetalhe from "./paginas/ApoliceDetalhe";
import MinhasApolices from "./paginas/produtor/MinhasApolices";
import Cotacao from "./paginas/produtor/Cotacao";
import VincularCarteira from "./paginas/produtor/VincularCarteira";
import FotosDaLavoura from "./paginas/produtor/FotosDaLavoura";
import CarteiraDaSeguradora from "./paginas/seguradora/CarteiraDaSeguradora";
import Propostas from "./paginas/seguradora/Propostas";
import TalhoesEProdutos from "./paginas/seguradora/TalhoesEProdutos";
import Oraculos from "./paginas/seguradora/Oraculos";
import RevisaoTecnica from "./paginas/RevisaoTecnica";
import Fontes from "./paginas/seguradora/Fontes";
import Notificacoes from "./paginas/Notificacoes";
import Conta from "./paginas/Conta";

/** Leva cada perfil para a sua tela inicial. */
function Inicio() {
  const { autenticado, perfil } = useSessao();

  if (!autenticado) return <Navigate to="/entrar" replace />;

  const destinos = {
    [PERFIS.PRODUTOR]: "/produtor",
    [PERFIS.SEGURADORA]: "/seguradora",
    [PERFIS.PERITO]: "/perito",
  };

  return <Navigate to={destinos[perfil] ?? "/entrar"} replace />;
}

function SemAcesso() {
  const navegar = useNavigate();

  return (
    <div className="pagina">
      <h1>Sem acesso</h1>
      <Aviso tipo="erro">
        Esta tela pertence a outro perfil. O acesso e restrito conforme o perfil autenticado (RF04).
      </Aviso>
      <button className="secundario" onClick={() => navegar("/")}>
        Voltar ao inicio
      </button>
    </div>
  );
}

function NaoEncontrada() {
  return (
    <div className="pagina">
      <h1>Pagina nao encontrada</h1>
      <p className="silencioso">O endereco digitado nao corresponde a nenhuma tela.</p>
    </div>
  );
}

export default function App() {
  const { autenticado } = useSessao();

  return (
    <>
      {autenticado ? <Cabecalho /> : null}

      <Routes>
        <Route path="/" element={<Inicio />} />
        <Route path="/entrar" element={<Entrar />} />
        <Route path="/sem-acesso" element={<SemAcesso />} />

        {/* --------------------------------------------------- produtor */}
        <Route
          path="/produtor"
          element={
            <RotaProtegida perfis={[PERFIS.PRODUTOR]}>
              <MinhasApolices />
            </RotaProtegida>
          }
        />
        <Route
          path="/produtor/cotacao"
          element={
            <RotaProtegida perfis={[PERFIS.PRODUTOR]}>
              <Cotacao />
            </RotaProtegida>
          }
        />
        <Route
          path="/produtor/fotos"
          element={
            <RotaProtegida perfis={[PERFIS.PRODUTOR]}>
              <FotosDaLavoura />
            </RotaProtegida>
          }
        />
        <Route
          path="/produtor/carteira"
          element={
            <RotaProtegida perfis={[PERFIS.PRODUTOR]}>
              <VincularCarteira />
            </RotaProtegida>
          }
        />

        {/* ------------------------------------------------- seguradora */}
        <Route
          path="/seguradora"
          element={
            <RotaProtegida perfis={[PERFIS.SEGURADORA]}>
              <CarteiraDaSeguradora />
            </RotaProtegida>
          }
        />
        <Route
          path="/seguradora/propostas"
          element={
            <RotaProtegida perfis={[PERFIS.SEGURADORA]}>
              <Propostas />
            </RotaProtegida>
          }
        />
        <Route
          path="/seguradora/talhoes"
          element={
            <RotaProtegida perfis={[PERFIS.SEGURADORA]}>
              <TalhoesEProdutos />
            </RotaProtegida>
          }
        />
        <Route
          path="/seguradora/oraculos"
          element={
            <RotaProtegida perfis={[PERFIS.SEGURADORA]}>
              <Oraculos />
            </RotaProtegida>
          }
        />

        {/* ------------------------------------------------------ perito */}
        <Route
          path="/perito"
          element={
            <RotaProtegida perfis={[PERFIS.PERITO]}>
              <RevisaoTecnica />
            </RotaProtegida>
          }
        />

        <Route
          path="/seguradora/fontes"
          element={
            <RotaProtegida perfis={[PERFIS.SEGURADORA]}>
              <Fontes />
            </RotaProtegida>
          }
        />

        {/* Comuns aos tres perfis. */}
        <Route
          path="/notificacoes"
          element={
            <RotaProtegida>
              <Notificacoes />
            </RotaProtegida>
          }
        />
        <Route
          path="/conta"
          element={
            <RotaProtegida>
              <Conta />
            </RotaProtegida>
          }
        />

        {/* A apolice e consultavel pelos tres perfis: o produtor acompanha,
            a seguradora gerencia e o perito revisa. */}
        <Route
          path="/apolice/:endereco"
          element={
            <RotaProtegida>
              <ApoliceDetalhe />
            </RotaProtegida>
          }
        />

        <Route path="*" element={<NaoEncontrada />} />
      </Routes>
    </>
  );
}
