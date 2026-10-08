import { useCallback, useEffect, useState } from "react";

import { api } from "../api/cliente";
import { emDataHora, emPercentual, hashCurto } from "../cadeia/formatos";
import { Aviso, Campo, Carregando, RodapeDaFronteira, Selo } from "../componentes/ui";

/**
 * Revisao tecnica do perito agronomo (RF17, RF28).
 *
 * O perito atua por excecao. Quando o modulo de visao devolve uma analise com
 * confianca abaixo do limiar, o backend a retem: o indice de dano nao segue para
 * o oraculo, e portanto nao cruza a fronteira, ate o perito decidir.
 *
 *  - LIBERAR: o indice segue para o oraculo, que nao reaplica o limiar — a
 *    revisao humana que o limiar pedia ja aconteceu.
 *  - REJEITAR: o indice fica retido de vez. O indice climatico continua sendo
 *    publicado normalmente, porque nao depende da inferencia.
 *
 * O perito tambem decide as contestacoes do produtor (RF28). Deferida, ele fixa o
 * indice retificado, e o oraculo o submete ao contrato com o resumo do parecer;
 * indeferida, o indice publicado fica valendo e o produtor e avisado.
 */
export default function RevisaoTecnica() {
  const [analises, setAnalises] = useState(null);
  const [contestacoes, setContestacoes] = useState([]);
  const [retificados, setRetificados] = useState({});
  const [pareceres, setPareceres] = useState({});
  const [erro, setErro] = useState(null);
  const [aviso, setAviso] = useState(null);

  const carregar = useCallback(async () => {
    try {
      const [a, c] = await Promise.all([api("/perito/analises"), api("/contestacoes")]);
      setAnalises(a.analises);
      setContestacoes(c.contestacoes);
    } catch (falha) {
      setErro(falha.message);
    }
  }, []);

  useEffect(() => {
    carregar();
  }, [carregar]);

  async function decidir(analise, decisao) {
    setErro(null);
    setAviso(null);

    try {
      await api(`/perito/analises/${analise.id}/parecer`, {
        metodo: "POST",
        corpo: { decisao, parecer: pareceres[analise.id] ?? "" },
      });

      setAviso(
        decisao === "liberada"
          ? "Analise liberada. O indice de dano seguira para o oraculo na proxima publicacao."
          : "Analise rejeitada. O indice de dano fica retido; o climatico segue normalmente.",
      );
      await carregar();
    } catch (falha) {
      setErro(falha.message);
    }
  }

  async function decidirContestacao(c, decisao) {
    setErro(null);
    setAviso(null);

    try {
      const indice = Number(String(retificados[c.id] ?? "").replace(",", "."));
      await api(`/perito/contestacoes/${c.id}/parecer`, {
        metodo: "POST",
        corpo: {
          decisao,
          parecer: pareceres[c.id] ?? "",
          ...(decisao === "deferida" ? { indiceRetificadoBps: Math.round(indice * 100) } : {}),
        },
      });

      setAviso(
        decisao === "deferida"
          ? "Contestacao deferida. O oraculo submete o indice retificado ao contrato no proximo ciclo."
          : "Contestacao indeferida. O indice publicado continua valendo, e o produtor foi avisado.",
      );
      await carregar();
    } catch (falha) {
      setErro(falha.message);
    }
  }

  const contestacoesAbertas = contestacoes.filter((c) => c.situacao === "aberta");

  const pendentes = analises?.filter((a) => a.encaminhada_ao_perito && !a.decisao_do_perito) ?? [];
  const demais = analises?.filter((a) => !(a.encaminhada_ao_perito && !a.decisao_do_perito)) ?? [];

  return (
    <div className="pagina">
      <div className="entre">
        <h1>Revisao tecnica</h1>
        <button className="secundario pequeno" onClick={carregar}>
          Atualizar
        </button>
      </div>

      <p className="silencioso">
        O perito atua por excecao: nos casos de baixa confianca do modelo. O fluxo normal dispensa
        vistoria.
      </p>

      {erro ? <Aviso tipo="erro">{erro}</Aviso> : null}
      {aviso ? <Aviso tipo="sucesso">{aviso}</Aviso> : null}

      {analises === null ? (
        <Carregando />
      ) : (
        <>
          <h2>Aguardando revisao ({pendentes.length})</h2>

          {pendentes.length === 0 ? (
            <div className="cartao">
              <p className="silencioso">Nenhuma analise aguardando revisao.</p>
            </div>
          ) : (
            pendentes.map((a) => (
              <div className="cartao" key={a.id}>
                <div className="entre">
                  <h3>
                    Talhao {a.talhao} — {a.imagens} imagem(ns)
                  </h3>
                  <Selo tipo="alerta">confianca {emPercentual(a.confianca_bps)}</Selo>
                </div>

                <div className="tabela-rolavel">
                  <table>
                    <tbody>
                      <tr>
                        <th>Indice de dano estimado</th>
                        <td>{emPercentual(a.indice_dano_bps)}</td>
                      </tr>
                      <tr>
                        <th>Modelo</th>
                        <td>{a.versao_modelo}</td>
                      </tr>
                      <tr>
                        <th>Resumo das evidencias</th>
                        <td className="mono" title={a.hash_evidencias}>
                          {hashCurto(a.hash_evidencias)}
                        </td>
                      </tr>
                      <tr>
                        <th>Analisado em</th>
                        <td>{emDataHora(new Date(a.criada_em).getTime() / 1000)}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                <Campo rotulo="Parecer" htmlFor={`parecer-${a.id}`}>
                  <textarea
                    id={`parecer-${a.id}`}
                    rows={3}
                    value={pareceres[a.id] ?? ""}
                    onChange={(e) => setPareceres({ ...pareceres, [a.id]: e.target.value })}
                    placeholder="O que foi observado nas imagens"
                  />
                </Campo>

                <div className="linha-de-botoes">
                  <button
                    onClick={() => decidir(a, "liberada")}
                    disabled={!pareceres[a.id]?.trim()}
                  >
                    Liberar indice
                  </button>
                  <button
                    className="perigo"
                    onClick={() => decidir(a, "rejeitada")}
                    disabled={!pareceres[a.id]?.trim()}
                  >
                    Rejeitar
                  </button>
                </div>
              </div>
            ))
          )}

          <h2>Contestacoes de produtores ({contestacoesAbertas.length})</h2>

          {contestacoesAbertas.length === 0 ? (
            <div className="cartao">
              <p className="silencioso">Nenhuma contestacao aguardando parecer.</p>
            </div>
          ) : (
            contestacoesAbertas.map((c) => (
              <div className="cartao" key={c.id}>
                <div className="entre">
                  <h3>
                    Talhao {c.talhao} — periodo {c.periodo}
                  </h3>
                  <Selo tipo="alerta">publicado {emPercentual(c.indice_original_bps)}</Selo>
                </div>

                <Campo rotulo={`Motivo do produtor (${c.produtor_nome})`}>
                  <p>{c.motivo}</p>
                </Campo>

                <Campo rotulo="Apolice">
                  <span className="mono">{c.apolice_endereco}</span>
                </Campo>

                <Campo rotulo="Parecer" htmlFor={`parecer-${c.id}`}>
                  <textarea
                    id={`parecer-${c.id}`}
                    rows={3}
                    value={pareceres[c.id] ?? ""}
                    onChange={(e) => setPareceres({ ...pareceres, [c.id]: e.target.value })}
                    placeholder="O que foi observado ao reexaminar as imagens"
                  />
                </Campo>

                <Campo
                  rotulo="Indice de dano retificado (%)"
                  htmlFor={`indice-${c.id}`}
                  ajuda="So para deferir. Vai para o contrato, ao lado do indice original, com o resumo deste parecer."
                >
                  <input
                    id={`indice-${c.id}`}
                    inputMode="decimal"
                    value={retificados[c.id] ?? ""}
                    onChange={(e) => setRetificados({ ...retificados, [c.id]: e.target.value })}
                    placeholder="ex.: 30"
                  />
                </Campo>

                <div className="linha-de-botoes">
                  <button
                    onClick={() => decidirContestacao(c, "deferida")}
                    disabled={!pareceres[c.id]?.trim() || !String(retificados[c.id] ?? "").trim()}
                  >
                    Deferir e retificar
                  </button>
                  <button
                    className="perigo"
                    onClick={() => decidirContestacao(c, "indeferida")}
                    disabled={!pareceres[c.id]?.trim()}
                  >
                    Indeferir
                  </button>
                </div>
              </div>
            ))
          )}

          {demais.length > 0 ? (
            <div className="cartao tabela-rolavel">
              <h2>Historico</h2>
              <table>
                <thead>
                  <tr>
                    <th>Talhao</th>
                    <th className="numero">Dano</th>
                    <th className="numero">Confianca</th>
                    <th>Modelo</th>
                    <th>Decisao</th>
                  </tr>
                </thead>
                <tbody>
                  {demais.map((a) => (
                    <tr key={a.id}>
                      <td>{a.talhao}</td>
                      <td className="numero">{emPercentual(a.indice_dano_bps)}</td>
                      <td className="numero">{emPercentual(a.confianca_bps)}</td>
                      <td>{a.versao_modelo}</td>
                      <td>
                        {!a.encaminhada_ao_perito ? (
                          <Selo tipo="neutro">dispensou revisao</Selo>
                        ) : a.decisao_do_perito === "liberada" ? (
                          <Selo tipo="sucesso">liberada</Selo>
                        ) : (
                          <Selo tipo="erro">rejeitada</Selo>
                        )}
                        {a.parecer_do_perito ? (
                          <div className="silencioso">{a.parecer_do_perito}</div>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          <RodapeDaFronteira>
            O resumo das evidencias identifica exatamente qual lote de imagens produziu o numero, e
            a versao diz qual modelo o produziu. Com os dois, a analise pode ser reexecutada e
            conferida depois (RNF18, RNF19).
          </RodapeDaFronteira>
        </>
      )}
    </div>
  );
}
