import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { api } from "../../api/cliente";
import { useSessao } from "../../sessao/SessaoContexto";
import { emData, emEth, periodoEmData } from "../../cadeia/formatos";
import { Aviso, Carregando, LinkDaCadeia, Selo, SeloSituacao } from "../../componentes/ui";

/**
 * Apolices e propostas do produtor (UC06).
 *
 * A lista vem do backend, que o indexador mantem em dia com a cadeia. Isso
 * dispensa a carteira conectada so para ver o que se tem. O detalhe de cada
 * apolice continua lendo o contrato direto — la, a fonte e a propria rede.
 */
export default function MinhasApolices() {
  const { usuario } = useSessao();

  const [apolices, setApolices] = useState(null);
  const [propostas, setPropostas] = useState([]);
  const [erro, setErro] = useState(null);

  const carregar = useCallback(async () => {
    setErro(null);

    try {
      const [a, p] = await Promise.all([api("/apolices"), api("/propostas")]);
      setApolices(a.apolices);
      setPropostas(p.propostas.filter((x) => x.situacao !== "emitida"));
    } catch (falha) {
      setErro(falha.message);
    }
  }, []);

  useEffect(() => {
    carregar();
  }, [carregar]);

  return (
    <div className="pagina">
      <div className="entre">
        <h1>Minhas apolices</h1>
        <button className="secundario pequeno" onClick={carregar}>
          Atualizar
        </button>
      </div>

      {erro ? <Aviso tipo="erro">{erro}</Aviso> : null}

      {!usuario?.carteira ? (
        <Aviso tipo="alerta">
          Nenhuma carteira vinculada. <Link to="/produtor/carteira">Vincule uma</Link> para poder
          contratar.
        </Aviso>
      ) : null}

      {propostas.length > 0 ? (
        <div className="cartao tabela-rolavel">
          <h2>Propostas</h2>
          <table>
            <thead>
              <tr>
                <th>Talhao</th>
                <th>Produto</th>
                <th className="numero">Limite</th>
                <th className="numero">Premio</th>
                <th>Situacao</th>
              </tr>
            </thead>
            <tbody>
              {propostas.map((p) => (
                <tr key={p.id}>
                  <td>{p.talhao.identificador}</td>
                  <td>{p.produto.nome}</td>
                  <td className="numero">{emEth(p.valorIndenizacaoWei)}</td>
                  <td className="numero">{emEth(p.premioWei)}</td>
                  <td>
                    <Selo tipo={p.situacao === "recusada" ? "erro" : "alerta"}>
                      {p.situacao === "preparada" ? "aguardando assinatura" : p.situacao}
                    </Selo>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {apolices === null ? (
        <Carregando />
      ) : apolices.length === 0 ? (
        <div className="cartao">
          <p>Nenhuma apolice emitida para voce ainda.</p>
          <Link to="/produtor/cotacao">Simular uma cotacao</Link>
        </div>
      ) : (
        <div className="tabela-rolavel cartao">
          <h2>Apolices</h2>
          <table>
            <thead>
              <tr>
                <th>Talhao</th>
                <th>Cultura</th>
                <th>Emitida em</th>
                <th className="numero">Limite</th>
                <th>Situacao</th>
                <th>Contrato</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {apolices.map((a) => (
                <tr key={a.endereco}>
                  <td>{a.talhao ?? "—"}</td>
                  <td>{a.cultura ?? "—"}</td>
                  <td>{emData(new Date(a.emitidaEm).getTime() / 1000)}</td>
                  <td className="numero">{emEth(a.valorIndenizacaoWei)}</td>
                  <td>
                    <SeloSituacao situacao={a.situacao} />
                    {a.situacao === 2 ? (
                      <div className="silencioso">
                        Recebeu {emEth(a.valorPagoWei)}
                        {a.periodoAcionador ? ` em ${periodoEmData(a.periodoAcionador)}` : ""}
                      </div>
                    ) : null}
                  </td>
                  <td>
                    <LinkDaCadeia valor={a.endereco} tipo="address" />
                  </td>
                  <td>
                    <Link to={`/apolice/${a.endereco}`}>Detalhes</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
