import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { api } from "../api/cliente";
import { emDataHora } from "../cadeia/formatos";
import { Aviso, Carregando, LinkDaCadeia, Selo } from "../componentes/ui";

/**
 * Notificacoes (RF27).
 *
 * Geradas pelo indexador do backend a partir dos eventos da cadeia — emissao,
 * garantia, pagamento — e pelo oraculo, quando uma publicacao falha de vez. Cada
 * uma traz a transacao que a originou, para que o aviso possa ser conferido.
 */
export default function Notificacoes() {
  const [notificacoes, setNotificacoes] = useState(null);
  const [erro, setErro] = useState(null);

  const carregar = useCallback(async () => {
    try {
      setNotificacoes((await api("/notificacoes")).notificacoes);
      window.dispatchEvent(new CustomEvent("agrosmart:notificacoes"));
    } catch (falha) {
      setErro(falha.message);
    }
  }, []);

  useEffect(() => {
    carregar();
  }, [carregar]);

  async function marcarTodas() {
    await api("/notificacoes/lidas", { metodo: "POST" });
    await carregar();
  }

  async function marcar(id) {
    await api(`/notificacoes/${id}/lida`, { metodo: "POST" });
    await carregar();
  }

  const naoLidas = notificacoes?.filter((n) => !n.lida_em).length ?? 0;

  return (
    <div className="pagina" style={{ maxWidth: 820 }}>
      <div className="entre">
        <h1>Notificacoes</h1>
        {naoLidas > 0 ? (
          <button className="secundario pequeno" onClick={marcarTodas}>
            Marcar todas como lidas
          </button>
        ) : null}
      </div>

      {erro ? <Aviso tipo="erro">{erro}</Aviso> : null}

      {notificacoes === null ? (
        <Carregando />
      ) : notificacoes.length === 0 ? (
        <div className="cartao">
          <p className="silencioso">Nenhuma notificacao.</p>
        </div>
      ) : (
        notificacoes.map((n) => (
          <div className="cartao" key={n.id} style={n.lida_em ? { opacity: 0.7 } : undefined}>
            <div className="entre">
              <strong>{n.titulo}</strong>
              <div className="linha-de-botoes">
                {!n.lida_em ? <Selo tipo="informacao">nova</Selo> : null}
                <span className="silencioso">
                  {emDataHora(new Date(n.criada_em).getTime() / 1000)}
                </span>
              </div>
            </div>

            <p style={{ marginTop: 8 }}>{n.mensagem}</p>

            <div className="linha-de-botoes">
              {n.apolice_endereco ? (
                <Link to={`/apolice/${n.apolice_endereco}`}>Ver apolice</Link>
              ) : null}
              {n.tx_hash?.startsWith("0x") ? (
                <span className="silencioso">
                  transacao <LinkDaCadeia valor={n.tx_hash} tipo="tx" />
                </span>
              ) : null}
              {!n.lida_em ? (
                <button className="secundario pequeno" onClick={() => marcar(n.id)}>
                  Marcar como lida
                </button>
              ) : null}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
