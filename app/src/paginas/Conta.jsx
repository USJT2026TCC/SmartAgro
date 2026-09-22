import { useState } from "react";
import QRCode from "qrcode";

import { api } from "../api/cliente";
import { useSessao } from "../sessao/SessaoContexto";
import { ROTULOS_DE_PERFIL } from "../sessao/perfis";
import { Aviso, Campo } from "../componentes/ui";

/**
 * Conta e segundo fator (RF01).
 *
 * Configurar o segundo fator e um processo de dois passos, de proposito: o
 * servidor gera o segredo, o usuario cadastra no aplicativo autenticador, e so
 * depois de digitar um codigo valido o segundo fator e ligado. Ligar direto, sem
 * essa prova, trancaria do lado de fora quem escaneou o codigo errado.
 */
export default function Conta() {
  const { usuario, recarregarUsuario } = useSessao();

  const [configuracao, setConfiguracao] = useState(null);
  const [codigo, setCodigo] = useState("");
  const [erro, setErro] = useState(null);
  const [aviso, setAviso] = useState(null);

  async function iniciar() {
    setErro(null);
    setAviso(null);

    try {
      const { segredo, uri } = await api("/autenticacao/totp/iniciar", { metodo: "POST" });
      setConfiguracao({ segredo, qr: await QRCode.toDataURL(uri, { margin: 1, width: 220 }) });
    } catch (falha) {
      setErro(falha.message);
    }
  }

  async function ativar(evento) {
    evento.preventDefault();
    setErro(null);

    try {
      await api("/autenticacao/totp/ativar", { metodo: "POST", corpo: { codigo } });
      await recarregarUsuario();
      setConfiguracao(null);
      setCodigo("");
      setAviso(
        "Segundo fator ativado. A partir do proximo login, o codigo sera pedido depois da senha.",
      );
    } catch (falha) {
      setErro(falha.message);
    }
  }

  async function desativar(evento) {
    evento.preventDefault();
    setErro(null);

    try {
      await api("/autenticacao/totp/desativar", { metodo: "POST", corpo: { codigo } });
      await recarregarUsuario();
      setCodigo("");
      setAviso("Segundo fator desativado.");
    } catch (falha) {
      setErro(falha.message);
    }
  }

  return (
    <div className="pagina" style={{ maxWidth: 680 }}>
      <h1>Minha conta</h1>

      {erro ? <Aviso tipo="erro">{erro}</Aviso> : null}
      {aviso ? <Aviso tipo="sucesso">{aviso}</Aviso> : null}

      <div className="cartao">
        <Campo rotulo="Nome">{usuario?.nome}</Campo>
        <Campo rotulo="Perfil">{ROTULOS_DE_PERFIL[usuario?.perfil]}</Campo>
        <Campo rotulo="Identificador">{usuario?.identificador}</Campo>
      </div>

      <div className="cartao">
        <h2>Segundo fator</h2>

        {usuario?.segundoFatorAtivo ? (
          <form onSubmit={desativar}>
            <Aviso tipo="sucesso">
              Ativo. O login pede o codigo do aplicativo autenticador depois da senha.
            </Aviso>

            <Campo
              rotulo="Codigo atual"
              htmlFor="codigo-desativar"
              ajuda="Desativar exige o codigo: quem estiver com uma sessao sua aberta nao consegue desligar a protecao sem o celular."
            >
              <input
                id="codigo-desativar"
                inputMode="numeric"
                maxLength={6}
                value={codigo}
                onChange={(e) => setCodigo(e.target.value.replace(/\D/g, ""))}
              />
            </Campo>

            <button type="submit" className="perigo" disabled={codigo.length !== 6}>
              Desativar segundo fator
            </button>
          </form>
        ) : configuracao ? (
          <form onSubmit={ativar}>
            <p>
              1. Escaneie o codigo com um aplicativo autenticador (Google Authenticator, Microsoft
              Authenticator, Aegis).
            </p>

            <img src={configuracao.qr} alt="Codigo QR do segundo fator" width={220} height={220} />

            <Campo rotulo="Ou digite o segredo manualmente" htmlFor="segredo">
              <input id="segredo" className="mono" readOnly value={configuracao.segredo} />
            </Campo>

            <p>2. Digite o codigo de seis digitos que o aplicativo mostrar.</p>

            <Campo rotulo="Codigo" htmlFor="codigo-ativar">
              <input
                id="codigo-ativar"
                inputMode="numeric"
                maxLength={6}
                value={codigo}
                onChange={(e) => setCodigo(e.target.value.replace(/\D/g, ""))}
                autoFocus
              />
            </Campo>

            <button type="submit" disabled={codigo.length !== 6}>
              Confirmar e ativar
            </button>
          </form>
        ) : (
          <>
            <p className="silencioso">
              Desativado. Com ele ativo, a senha sozinha nao basta para entrar: e preciso tambem o
              codigo gerado no celular.
            </p>
            <button onClick={iniciar}>Configurar segundo fator</button>
          </>
        )}
      </div>
    </div>
  );
}
