import { useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";

import { useSessao } from "../sessao/SessaoContexto";
import { USUARIOS, ROTULOS_DE_PERFIL } from "../sessao/usuarios";
import { Aviso, Campo, NotaDePrototipo } from "../componentes/ui";
import { redeAtiva, enderecosDaRede } from "../cadeia/rede";

/**
 * Tela de login (RF01, HU13).
 *
 * Alem do formulario, mostra o estado da configuracao: se nao houver contrato
 * implantado na rede escolhida, o aviso aparece aqui, antes de o usuario entrar e
 * encontrar telas vazias sem entender por que.
 */
export default function Entrar() {
  const { entrar, autenticado } = useSessao();
  const navegar = useNavigate();
  const local = useLocation();

  const [identificador, setIdentificador] = useState("");
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState(null);

  const rede = redeAtiva();
  const enderecos = enderecosDaRede();

  if (autenticado) return <Navigate to={local.state?.de ?? "/"} replace />;

  function enviar(evento) {
    evento.preventDefault();
    setErro(null);

    const resultado = entrar(identificador, senha);

    if (!resultado.ok) {
      setErro(resultado.erro);
      return;
    }

    navegar(local.state?.de ?? "/", { replace: true });
  }

  /** Preenche o formulario com um dos usuarios de demonstracao. */
  function usar(usuario) {
    setIdentificador(usuario.identificador);
    setSenha(usuario.senha);
    setErro(null);
  }

  return (
    <div className="pagina" style={{ maxWidth: 560 }}>
      <h1>AgroSmart</h1>
      <p className="silencioso">
        Seguro agricola indexado com liquidacao automatica por contrato inteligente.
      </p>

      {!enderecos ? (
        <Aviso tipo="erro" titulo="Nenhum contrato implantado nesta rede.">
          O aplicativo esta apontando para <strong>{rede.nome}</strong>, mas nao encontrou enderecos
          implantados. Rode, no diretorio <code>contratos</code>:
          <br />
          <code>npx hardhat run scripts/implantar.js --network {rede.chave}</code>
          <br />e depois <code>npm run enderecos</code> aqui no aplicativo.
        </Aviso>
      ) : null}

      <form className="cartao" onSubmit={enviar}>
        <h2>Entrar</h2>

        {erro ? <Aviso tipo="erro">{erro}</Aviso> : null}

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

        <button type="submit">Entrar</button>
      </form>

      <div className="cartao">
        <h3>Perfis de demonstracao</h3>
        <p className="silencioso">
          Clique para preencher o formulario. Cada perfil ve um conjunto diferente de telas.
        </p>

        <div className="pilha">
          {USUARIOS.map((usuario) => (
            <div key={usuario.identificador} className="entre">
              <div>
                <strong>{ROTULOS_DE_PERFIL[usuario.perfil]}</strong>
                <div className="silencioso">{usuario.documento}</div>
              </div>
              <button className="secundario pequeno" onClick={() => usar(usuario)} type="button">
                Usar
              </button>
            </div>
          ))}
        </div>
      </div>

      <NotaDePrototipo>
        A autenticacao roda inteiramente no navegador, com senhas em texto claro em{" "}
        <code>src/sessao/usuarios.js</code>. O RNF24 exige hash com sal, o que so pode ser feito de
        forma honesta no servidor — entra com a API, na Sprint 2. Isso nao afeta a seguranca da
        parte em cadeia: quem pode publicar indice e quem pode mover valor e decidido pelo contrato,
        por endereco, e nao por este login.
      </NotaDePrototipo>
    </div>
  );
}
