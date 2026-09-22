import { useEffect, useState } from "react";

import { api } from "../../api/cliente";
import { useCarteira } from "../../cadeia/CarteiraContexto";
import { useSessao } from "../../sessao/SessaoContexto";
import { emEth, mensagemDeErro } from "../../cadeia/formatos";
import { Aviso, Campo, LinkDaCadeia } from "../../componentes/ui";

/**
 * Vinculo da carteira ao cadastro por assinatura (RF02, HU07).
 *
 * O desafio nasce no servidor, com numero unico e prazo de cinco minutos. A
 * carteira assina no navegador; o servidor recupera o endereco que assinou e so
 * grava o vinculo se ele for exatamente o endereco declarado. A chave privada nao
 * sai da carteira em nenhum momento (RNF17).
 */
export default function VincularCarteira() {
  const { usuario, recarregarUsuario } = useSessao();
  const {
    conta,
    temCarteira,
    conectar,
    conectando,
    redeCorreta,
    rede,
    trocarDeRede,
    signatario,
    provedorLeitura,
  } = useCarteira();

  const [saldo, setSaldo] = useState(null);
  const [erro, setErro] = useState(null);
  const [aviso, setAviso] = useState(null);
  const [assinando, setAssinando] = useState(false);
  const [ultimaMensagem, setUltimaMensagem] = useState(null);

  useEffect(() => {
    if (!conta) {
      setSaldo(null);
      return;
    }

    provedorLeitura
      .getBalance(conta)
      .then(setSaldo)
      .catch(() => setSaldo(null));
  }, [conta, provedorLeitura]);

  async function vincular() {
    setErro(null);
    setAviso(null);
    setAssinando(true);

    try {
      const { desafioId, mensagem } = await api("/carteira/desafio", { metodo: "POST" });
      setUltimaMensagem(mensagem);

      const assinatura = await signatario.signMessage(mensagem);

      await api("/carteira/vincular", {
        metodo: "POST",
        corpo: { desafioId, endereco: conta, assinatura },
      });

      await recarregarUsuario();
      setAviso("Titularidade comprovada. A carteira foi vinculada ao seu cadastro.");
    } catch (falha) {
      setErro(falha.status ? falha.message : mensagemDeErro(falha));
    } finally {
      setAssinando(false);
    }
  }

  async function desvincular() {
    setErro(null);
    setAviso(null);

    try {
      await api("/carteira", { metodo: "DELETE" });
      await recarregarUsuario();
    } catch (falha) {
      setErro(falha.message);
    }
  }

  const vinculada = usuario?.carteira ?? null;
  const conectadaEhAVinculada =
    vinculada && conta && vinculada.toLowerCase() === conta.toLowerCase();

  return (
    <div className="pagina" style={{ maxWidth: 760 }}>
      <h1>Minha carteira</h1>
      <p className="silencioso">
        A indenizacao e transferida diretamente para a carteira vinculada. Nenhuma outra etapa entra
        no caminho do pagamento.
      </p>

      {erro ? <Aviso tipo="erro">{erro}</Aviso> : null}
      {aviso ? <Aviso tipo="sucesso">{aviso}</Aviso> : null}

      <div className="cartao">
        <h2>Carteira vinculada ao cadastro</h2>

        {vinculada ? (
          <>
            <Campo rotulo="Endereco">
              <LinkDaCadeia valor={vinculada} tipo="address" curto={false} />
            </Campo>

            {conta && !conectadaEhAVinculada ? (
              <Aviso tipo="alerta" titulo="A carteira conectada e outra.">
                A indenizacao vai para o endereco vinculado acima, e nao para o conectado agora.
                Para trocar, assine o vinculo com a carteira nova.
              </Aviso>
            ) : null}

            <button className="perigo" onClick={desvincular}>
              Desvincular
            </button>
          </>
        ) : (
          <Aviso tipo="alerta">
            Nenhuma carteira vinculada. Sem ela nao e possivel enviar proposta: e para ela que a
            indenizacao seria transferida.
          </Aviso>
        )}
      </div>

      <div className="cartao">
        <h2>Carteira conectada</h2>

        {!temCarteira ? (
          <Aviso tipo="alerta" titulo="Nenhuma carteira encontrada no navegador.">
            Instale a extensao MetaMask e recarregue a pagina.
          </Aviso>
        ) : !conta ? (
          <button onClick={conectar} disabled={conectando}>
            {conectando ? "Conectando…" : "Conectar carteira"}
          </button>
        ) : (
          <>
            <Campo rotulo="Endereco">
              <div className="mono">{conta}</div>
            </Campo>

            <Campo rotulo="Saldo">
              <div>{saldo === null ? "—" : emEth(saldo)}</div>
            </Campo>

            {!redeCorreta ? (
              <Aviso tipo="alerta" titulo="Carteira em outra rede.">
                <button className="secundario pequeno" onClick={trocarDeRede}>
                  Trocar para {rede.nome}
                </button>
              </Aviso>
            ) : null}

            {!conectadaEhAVinculada ? (
              <>
                <p>
                  Assinar <strong>nao</strong> movimenta valor, nao custa gas e nao autoriza nenhuma
                  transacao: serve apenas para provar ao servidor que voce controla a chave desse
                  endereco.
                </p>

                <button onClick={vincular} disabled={assinando || !signatario}>
                  {assinando ? "Aguardando a carteira…" : "Assinar e vincular esta carteira"}
                </button>
              </>
            ) : (
              <Aviso tipo="sucesso">Esta e a carteira vinculada ao seu cadastro.</Aviso>
            )}

            {ultimaMensagem ? (
              <Campo
                rotulo="Ultima mensagem assinada"
                ajuda="Gerada pelo servidor. O numero unico impede que uma assinatura antiga seja reapresentada."
              >
                <textarea readOnly rows={6} value={ultimaMensagem} className="mono" />
              </Campo>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
