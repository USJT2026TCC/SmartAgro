import { useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";

import { useSessao } from "../sessao/SessaoContexto";
import {
  ROTULOS_DE_PERFIL,
  SENHA_DE_DEMONSTRACAO,
  USUARIOS_DE_DEMONSTRACAO,
} from "../sessao/perfis";
import { Aviso, Campo } from "../componentes/ui";
import { enderecosDaRede, redeAtiva } from "../cadeia/rede";

/**
 * Login (RF01, HU13), em um ou dois tempos.
 *
 * Com o segundo fator desligado, a senha basta. Ligado, a senha correta leva a
 * uma segunda etapa, que pede o codigo de seis digitos do aplicativo autenticador.
 */
export default function Entrar() {
  const { entrar, confirmarSegundoFator, cancelarSegundoFator, segundoFatorPendente, autenticado } =
    useSessao();
  const navegar = useNavigate();
  const local = useLocation();

  const [identificador, setIdentificador] = useState("");
  const [senha, setSenha] = useState("");
  const [codigo, setCodigo] = useState("");
  const [erro, setErro] = useState(null);
  const [enviando, setEnviando] = useState(false);

  const rede = redeAtiva();
  const enderecos = enderecosDaRede();
  const destino = local.state?.de ?? "/";

  if (autenticado) return <Navigate to={destino} replace />;

  async function enviarSenha(evento) {
    evento.preventDefault();
    setErro(null);
    setEnviando(true);

    try {
      const resultado = await entrar(identificador, senha);
      if (!resultado.segundoFator) navegar(destino, { replace: true });
    } catch (falha) {
      setErro(falha.message);
    } finally {
      setEnviando(false);
    }
  }

  async function enviarCodigo(evento) {
    evento.preventDefault();
    setErro(null);
    setEnviando(true);

    try {
      await confirmarSegundoFator(codigo);
      navegar(destino, { replace: true });
    } catch (falha) {
      setErro(falha.message);
      setCodigo("");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="pagina" style={{ maxWidth: 560 }}>
      <h1>AgroSmart</h1>
      <p className="silencioso">
        Seguro agricola indexado com liquidacao automatica por contrato inteligente.
      </p>

      {!enderecos ? (
        <Aviso tipo="alerta" titulo="Nenhum contrato implantado nesta rede.">
          O aplicativo aponta para <strong>{rede.nome}</strong>, mas nao encontrou enderecos
          implantados. O cadastro funciona; apolices, nao. Rode em <code>contratos</code>:
          <br />
          <code>npx hardhat run scripts/implantar.js --network {rede.chave}</code>
        </Aviso>
      ) : null}

      {erro ? <Aviso tipo="erro">{erro}</Aviso> : null}

      {segundoFatorPendente ? (
        <form className="cartao" onSubmit={enviarCodigo}>
          <h2>Segundo fator</h2>
          <p className="silencioso">
            Digite o codigo de seis digitos que aparece no seu aplicativo autenticador.
          </p>

          <Campo rotulo="Codigo" htmlFor="codigo">
            <input
              id="codigo"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="\d{6}"
              maxLength={6}
              value={codigo}
              onChange={(e) => setCodigo(e.target.value.replace(/\D/g, ""))}
              autoFocus
            />
          </Campo>

          <div className="linha-de-botoes">
            <button type="submit" disabled={enviando || codigo.length !== 6}>
              {enviando ? "Conferindo…" : "Confirmar"}
            </button>
            <button type="button" className="secundario" onClick={cancelarSegundoFator}>
              Voltar
            </button>
          </div>
        </form>
      ) : (
        <form className="cartao" onSubmit={enviarSenha}>
          <h2>Entrar</h2>

          <Campo rotulo="Identificador" htmlFor="identificador">
            <input
              id="identificador"
              value={identificador}
              onChange={(e) => setIdentificador(e.target.value)}
              autoComplete="username"
              autoFocus
            />
          </Campo>

          <Campo rotulo="Senha" htmlFor="senha">
            <input
              id="senha"
              type="password"
              value={senha}
              onChange={(e) => setSenha(e.target.value)}
              autoComplete="current-password"
            />
          </Campo>

          <button type="submit" disabled={enviando}>
            {enviando ? "Entrando…" : "Entrar"}
          </button>
        </form>
      )}

      {/* Atalhos so em desenvolvimento, para quem roda a demonstracao. O build de
          producao remove este bloco inteiro. */}
      {import.meta.env.DEV && !segundoFatorPendente ? (
        <div className="cartao">
          <h3>Usuarios de demonstracao</h3>
          <p className="silencioso">
            Criados pelo backend na primeira execucao. Senha: <code>{SENHA_DE_DEMONSTRACAO}</code>.
          </p>

          <div className="pilha">
            {USUARIOS_DE_DEMONSTRACAO.map((u) => (
              <div key={u.identificador} className="entre">
                <div>
                  <strong>{ROTULOS_DE_PERFIL[u.perfil]}</strong>
                  <div className="silencioso">{u.descricao}</div>
                </div>
                <button
                  type="button"
                  className="secundario pequeno"
                  onClick={() => {
                    setIdentificador(u.identificador);
                    setSenha(SENHA_DE_DEMONSTRACAO);
                    setErro(null);
                  }}
                >
                  Usar
                </button>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
