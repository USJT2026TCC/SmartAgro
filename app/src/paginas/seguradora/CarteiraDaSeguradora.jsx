import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { api } from "../../api/cliente";
import { emData, emEth, emPercentual } from "../../cadeia/formatos";
import { implantacaoDaRede } from "../../cadeia/rede";
import {
  Aviso,
  Carregando,
  Indicador,
  LinkDaCadeia,
  RodapeDaFronteira,
  SeloSituacao,
} from "../../componentes/ui";

/**
 * Painel da seguradora: carteira, indicadores e os numeros do experimento
 * (RF15, UC15).
 *
 * Os indicadores vem do backend, que o indexador mantem em dia com a cadeia. As
 * estatisticas de gas e latencia contam so publicacoes confirmadas na rede — o
 * relato do oraculo sem o evento correspondente nao entra na conta.
 */
export default function CarteiraDaSeguradora() {
  const [relatorio, setRelatorio] = useState(null);
  const [apolices, setApolices] = useState(null);
  const [saude, setSaude] = useState(null);
  const [erro, setErro] = useState(null);

  const implantacao = useMemo(() => implantacaoDaRede(), []);

  const carregar = useCallback(async () => {
    setErro(null);

    try {
      const [r, a, s] = await Promise.all([
        api("/relatorios/carteira"),
        api("/apolices"),
        api("/saude"),
      ]);
      setRelatorio(r);
      setApolices(a.apolices);
      setSaude(s);
    } catch (falha) {
      setErro(falha.message);
    }
  }, []);

  useEffect(() => {
    carregar();
  }, [carregar]);

  const c = relatorio?.carteira;
  const p = relatorio?.publicacoes;

  return (
    <div className="pagina">
      <div className="entre">
        <h1>Carteira</h1>
        <button className="secundario pequeno" onClick={carregar}>
          Atualizar
        </button>
      </div>

      {erro ? <Aviso tipo="erro">{erro}</Aviso> : null}

      {saude?.indexador?.ultimoErro ? (
        <Aviso tipo="alerta" titulo="O indexador nao esta alcancando a rede.">
          {saude.indexador.ultimoErro.mensagem}. Os numeros abaixo podem estar atrasados em relacao
          a cadeia.
        </Aviso>
      ) : null}

      {relatorio?.propostasPendentes > 0 ? (
        <Aviso tipo="informacao">
          {relatorio.propostasPendentes} proposta(s) aguardando emissao.{" "}
          <Link to="/seguradora/propostas">Ver propostas</Link>
        </Aviso>
      ) : null}

      {!relatorio ? (
        <Carregando />
      ) : (
        <>
          <div className="grade">
            <Indicador
              rotulo="Apolices emitidas"
              valor={c.apolices}
              nota={`${c.ativas} ativas · ${c.aguardando_garantia} sem garantia`}
            />
            <Indicador rotulo="Limite total contratado" valor={emEth(c.limite_total_wei)} />
            <Indicador
              rotulo="Indenizacoes pagas"
              valor={emEth(c.pago_total_wei)}
              nota={`${c.liquidadas} apolice(s) liquidada(s)`}
            />
            <Indicador
              rotulo="Taxa de acionamento"
              valor={emPercentual(Math.round(c.taxaDeAcionamento * 10_000))}
              nota="liquidadas sobre o total emitido"
            />
          </div>

          <div className="cartao" style={{ marginTop: 16 }}>
            <h2>Custo e latencia da travessia</h2>
            <p className="silencioso">
              Os numeros do capitulo de resultados. Contam apenas publicacoes que o indexador ja
              confirmou na cadeia.
            </p>

            {p.total === 0 ? (
              <p className="silencioso">Nenhuma publicacao confirmada ainda.</p>
            ) : (
              <div className="grade">
                <Indicador
                  rotulo="Publicacoes"
                  valor={p.total}
                  nota={`${p.com_acionamento} com pagamento`}
                />
                <Indicador
                  rotulo="Gas medio sem acionar"
                  valor={Number(p.gas_medio_sem_acionar).toLocaleString("pt-BR")}
                  nota={`min ${Number(p.gas_minimo).toLocaleString("pt-BR")} · max ${Number(p.gas_maximo).toLocaleString("pt-BR")}`}
                />
                <Indicador
                  rotulo="Gas medio acionando"
                  valor={Number(p.gas_medio_acionando).toLocaleString("pt-BR")}
                  nota="inclui a transferencia de valor"
                />
                <Indicador
                  rotulo="Latencia"
                  valor={p.latencia_media_ms !== null ? `${p.latencia_media_ms} ms` : "—"}
                  nota={
                    p.latencia_p95_ms !== null
                      ? `p95: ${p.latencia_p95_ms} ms`
                      : "envio ate confirmacao"
                  }
                />
              </div>
            )}
          </div>

          <div className="cartao">
            <h2>Fontes de dados</h2>
            <div className="grade">
              <Indicador
                rotulo="Fontes ativas"
                valor={`${relatorio.fontes.ativas} de ${relatorio.fontes.total}`}
              />
              <Indicador
                rotulo="Abaixo do limiar de reputacao"
                valor={relatorio.fontes.abaixo_do_limiar}
                nota={
                  relatorio.fontes.abaixo_do_limiar > 0
                    ? "suas leituras nao entram no indice"
                    : "todas operando"
                }
              />
            </div>
            <p>
              <Link to="/seguradora/fontes">Gerenciar fontes</Link>
            </p>
          </div>
        </>
      )}

      {apolices === null ? null : apolices.length === 0 ? (
        <div className="cartao">
          <p>Nenhuma apolice emitida ainda.</p>
        </div>
      ) : (
        <div className="cartao tabela-rolavel">
          <h2>Apolices emitidas</h2>
          <table>
            <thead>
              <tr>
                <th>Talhao</th>
                <th>Produtor</th>
                <th>Emitida em</th>
                <th className="numero">Limite</th>
                <th className="numero">Pago</th>
                <th>Situacao</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {apolices.map((a) => (
                <tr key={a.endereco}>
                  <td>
                    {a.talhao ?? "—"}
                    <div className="silencioso">{a.cultura ?? ""}</div>
                  </td>
                  <td>
                    {a.produtor.nome ?? "—"}
                    <div>
                      <LinkDaCadeia valor={a.produtor.carteira} tipo="address" />
                    </div>
                  </td>
                  <td>{emData(new Date(a.emitidaEm).getTime() / 1000)}</td>
                  <td className="numero">{emEth(a.valorIndenizacaoWei)}</td>
                  <td className="numero">{emEth(a.valorPagoWei)}</td>
                  <td>
                    <SeloSituacao situacao={a.situacao} />
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

      {implantacao ? (
        <div className="cartao">
          <h2>Infraestrutura</h2>
          <div className="tabela-rolavel">
            <table>
              <tbody>
                <tr>
                  <th>Registro de oraculos</th>
                  <td>
                    <LinkDaCadeia
                      valor={implantacao.contratos.OracleRegistry}
                      tipo="address"
                      curto={false}
                    />
                  </td>
                </tr>
                <tr>
                  <th>Fabrica de apolices</th>
                  <td>
                    <LinkDaCadeia
                      valor={implantacao.contratos.ApoliceFactory}
                      tipo="address"
                      curto={false}
                    />
                  </td>
                </tr>
                <tr>
                  <th>Banco de dados</th>
                  <td>{saude?.banco?.motor ?? "—"}</td>
                </tr>
                <tr>
                  <th>Indexador</th>
                  <td>{saude?.indexador?.ativo ? "acompanhando a cadeia" : "parado"}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <RodapeDaFronteira>
            Enderecos lidos de <code>contratos/implantacoes/</code>, gerado pelo script de
            implantacao.
          </RodapeDaFronteira>
        </div>
      ) : null}
    </div>
  );
}
