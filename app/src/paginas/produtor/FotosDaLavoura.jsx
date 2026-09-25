import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { api } from "../../api/cliente";
import { emPercentual, hashCurto } from "../../cadeia/formatos";
import MapaDoTalhao from "../../componentes/MapaDoTalhao";
import { Aviso, Campo, Carregando, RodapeDaFronteira, Selo } from "../../componentes/ui";
import { anelDoPoligono, pontoNoPoligono } from "../../fotos/geografia";
import { lerDaFoto, localizacaoDoAparelho, ORIGENS } from "../../fotos/localizacao";

/**
 * Fotos da lavoura (RF14, RF16, HU11).
 *
 * O produtor fotografa o talhao, o aplicativo le onde cada foto foi tirada e
 * mostra no mapa, e as fotos seguem para o modulo de visao, que estima quanto
 * da lavoura foi afetado pela seca.
 *
 * O LOTE
 *
 * As fotos vao em lotes. Enquanto o lote esta aberto, o produtor pode enviar
 * mais fotos. Ao fechar, o servidor calcula o resumo criptografico do conjunto —
 * o valor que vai para a cadeia junto com o indice de dano (RF16) — e o lote nao
 * aceita mais nada. Por isso fechar e irreversivel: acrescentar uma foto depois
 * mudaria o conjunto que o resumo registrado descreve.
 */

let proximaChave = 0;

function situacaoDoLote(lote) {
  if (!lote.fechado_em) return { tipo: "informacao", texto: "aberto" };

  const analise = lote.analise;
  if (!analise) return { tipo: "neutro", texto: "aguardando analise" };

  if (analise.encaminhadaAoPerito && !analise.decisaoDoPerito) {
    return { tipo: "alerta", texto: "com o perito" };
  }
  if (analise.decisaoDoPerito === "rejeitada") {
    return { tipo: "erro", texto: "rejeitada pelo perito" };
  }

  return {
    tipo: "sucesso",
    texto: `dano de ${emPercentual(analise.indiceDanoBps)} da lavoura`,
  };
}

export default function FotosDaLavoura() {
  const [talhoes, setTalhoes] = useState(null);
  const [talhaoId, setTalhaoId] = useState("");
  const [lotes, setLotes] = useState([]);
  const [fotos, setFotos] = useState([]);
  const [marcando, setMarcando] = useState(null);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState(null);
  const [aviso, setAviso] = useState(null);

  const entradaCamera = useRef(null);
  const entradaGaleria = useRef(null);

  const talhao = talhoes?.find((t) => t.id === talhaoId) ?? null;
  const anel = useMemo(() => anelDoPoligono(talhao?.poligono), [talhao]);
  const loteAberto = lotes.find((l) => !l.fechado_em) ?? null;

  // ------------------------------------------------------------ carregamento

  useEffect(() => {
    api("/talhoes")
      .then(({ talhoes: lista }) => {
        setTalhoes(lista);
        if (lista.length) setTalhaoId(lista[0].id);
      })
      .catch((falha) => setErro(falha.message));
  }, []);

  const carregarLotes = useCallback(async () => {
    if (!talhaoId) return;

    try {
      setLotes((await api(`/lotes?talhaoId=${talhaoId}`)).lotes);
    } catch (falha) {
      setErro(falha.message);
    }
  }, [talhaoId]);

  useEffect(() => {
    carregarLotes();
  }, [carregarLotes]);

  // As miniaturas usam URLs locais do navegador, que ocupam memoria ate serem
  // liberadas. Libera ao sair da tela — e so ai: liberar a cada mudanca da lista
  // apagaria as miniaturas das fotos que continuam nela.
  const fotosAtuais = useRef([]);
  useEffect(() => {
    fotosAtuais.current = fotos;
  }, [fotos]);
  useEffect(() => () => fotosAtuais.current.forEach((f) => URL.revokeObjectURL(f.url)), []);

  function limparFotos() {
    fotosAtuais.current.forEach((f) => URL.revokeObjectURL(f.url));
    setFotos([]);
  }

  function trocarTalhao(id) {
    limparFotos();
    setMarcando(null);
    setAviso(null);
    setTalhaoId(id);
  }

  // ------------------------------------------------------------------- fotos

  function atualizar(chave, mudancas) {
    setFotos((lista) => lista.map((f) => (f.chave === chave ? { ...f, ...mudancas } : f)));
  }

  function comPosicao(foto, posicao) {
    const dentro = pontoNoPoligono([posicao.lon, posicao.lat], anel);
    return { ...foto, ...posicao, dentro, situacao: "pronta" };
  }

  async function escolherArquivos(evento) {
    const arquivos = [...evento.target.files];
    evento.target.value = "";
    setErro(null);
    setAviso(null);

    const novas = arquivos.map((arquivo) => ({
      chave: `f${proximaChave++}`,
      arquivo,
      url: URL.createObjectURL(arquivo),
      situacao: "lendo",
    }));

    setFotos((lista) => [...lista, ...novas]);

    for (const foto of novas) {
      const lido = await lerDaFoto(foto.arquivo);

      if (lido.origem === "exif") {
        setFotos((lista) =>
          lista.map((f) => (f.chave === foto.chave ? comPosicao({ ...f, ...lido }, lido) : f)),
        );
      } else {
        atualizar(foto.chave, { capturadaEm: lido.capturadaEm, situacao: "sem_local" });
      }
    }
  }

  async function usarLocalizacaoDoAparelho() {
    setErro(null);

    try {
      const posicao = await localizacaoDoAparelho();
      setFotos((lista) =>
        lista.map((f) => (f.situacao === "sem_local" ? comPosicao(f, posicao) : f)),
      );
    } catch (falha) {
      setErro(falha.message);
    }
  }

  function marcarNoMapa([lon, lat]) {
    if (!marcando) return;

    setFotos((lista) =>
      lista.map((f) => (f.chave === marcando ? comPosicao(f, { lon, lat, origem: "manual" }) : f)),
    );
    setMarcando(null);
  }

  function descartar(chave) {
    setFotos((lista) => {
      const foto = lista.find((f) => f.chave === chave);
      if (foto) URL.revokeObjectURL(foto.url);
      return lista.filter((f) => f.chave !== chave);
    });
    if (marcando === chave) setMarcando(null);
  }

  // ------------------------------------------------------------------ envio

  async function abrirLote() {
    setErro(null);

    try {
      await api(`/talhoes/${talhaoId}/lotes`, { metodo: "POST" });
      await carregarLotes();
    } catch (falha) {
      setErro(falha.message);
    }
  }

  async function enviarFotos() {
    if (!loteAberto) return;

    setOcupado(true);
    setErro(null);

    // Uma de cada vez: no campo a conexao e ruim, e uma falha no meio nao pode
    // levar junto as fotos que ja tinham ido.
    for (const foto of fotos.filter((f) => f.situacao === "pronta")) {
      atualizar(foto.chave, { situacao: "enviando" });

      const formulario = new FormData();
      formulario.append("imagem", foto.arquivo);
      formulario.append("lon", String(foto.lon));
      formulario.append("lat", String(foto.lat));
      formulario.append("capturadaEm", new Date(foto.capturadaEm).toISOString());
      formulario.append("origemDaLocalizacao", foto.origem);

      try {
        const { imagem } = await api(`/lotes/${loteAberto.id}/imagens`, {
          metodo: "POST",
          formulario,
        });
        atualizar(foto.chave, { situacao: "enviada", sha256: imagem.sha256 });
      } catch (falha) {
        atualizar(foto.chave, { situacao: "recusada", mensagem: falha.message });
      }
    }

    setOcupado(false);
    await carregarLotes();
  }

  async function fecharLote() {
    if (!loteAberto) return;

    const confirmado = window.confirm(
      "Fechar o lote e mandar as fotos para analise?\n\n" +
        "Depois de fechado, o lote nao aceita mais fotos: o resumo criptografico do " +
        "conjunto e calculado agora e e ele que vai para a blockchain.",
    );
    if (!confirmado) return;

    setOcupado(true);
    setErro(null);

    try {
      const { lote } = await api(`/lotes/${loteAberto.id}/fechar`, { metodo: "POST" });
      setAviso(
        `Lote fechado com ${lote.imagens} foto(s) e enviado para analise. ` +
          `Resumo das evidencias: ${hashCurto(lote.hashEvidencias)}.`,
      );
      limparFotos();
      await carregarLotes();
    } catch (falha) {
      setErro(falha.message);
    } finally {
      setOcupado(false);
    }
  }

  // ------------------------------------------------------------------ tela

  const prontas = fotos.filter((f) => f.situacao === "pronta").length;
  const semLocal = fotos.filter((f) => f.situacao === "sem_local").length;
  const foraDoTalhao = fotos.filter((f) => f.situacao === "pronta" && !f.dentro).length;
  const enviadasNoLote = loteAberto?.imagens ?? 0;

  const pontos = fotos
    .filter((f) => Number.isFinite(f.lon))
    .map((f) => ({
      chave: f.chave,
      lon: f.lon,
      lat: f.lat,
      dentro: f.dentro,
      origem: f.origem,
      rotulo: `${f.arquivo.name} — ${ORIGENS[f.origem]}`,
    }));

  if (talhoes === null) return <Carregando>Carregando talhoes…</Carregando>;

  return (
    <div className="pagina">
      <h1>Fotos da lavoura</h1>
      <p className="silencioso">
        Fotografe a lavoura vista de cima ou de perto das plantas. O modulo de visao estima quanto
        da lavoura foi afetado pela seca, e esse indice pode acionar a apolice junto com o indice de
        chuva.
      </p>

      {erro ? <Aviso tipo="erro">{erro}</Aviso> : null}
      {aviso ? <Aviso tipo="sucesso">{aviso}</Aviso> : null}

      {talhoes.length === 0 ? (
        <Aviso>Nenhum talhao cadastrado para voce. A seguradora cadastra os talhoes.</Aviso>
      ) : (
        <>
          <div className="cartao">
            <Campo rotulo="Talhao" htmlFor="talhao">
              <select id="talhao" value={talhaoId} onChange={(e) => trocarTalhao(e.target.value)}>
                {talhoes.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.identificador} — {t.cultura},{" "}
                    {Number(t.areaHa).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} ha
                  </option>
                ))}
              </select>
            </Campo>

            <div className="fotos-grade">
              <div>
                <MapaDoTalhao
                  poligono={talhao?.poligono}
                  pontos={pontos}
                  aoClicar={marcando ? marcarNoMapa : undefined}
                  destaque={marcando}
                />
                <div className="legenda-mapa silencioso">
                  <span className="bola dentro" /> dentro do talhao
                  <span className="bola fora" /> fora — sera recusada
                  <span className="bola manual" /> local marcado a mao
                </div>
                {marcando ? (
                  <Aviso tipo="alerta">
                    Clique no mapa onde a foto foi tirada.{" "}
                    <button className="secundario pequeno" onClick={() => setMarcando(null)}>
                      Cancelar
                    </button>
                  </Aviso>
                ) : null}
              </div>

              <div>
                {!loteAberto ? (
                  <>
                    <p>Para enviar fotos, abra um lote para este talhao.</p>
                    <button onClick={abrirLote}>Abrir lote de fotos</button>
                  </>
                ) : (
                  <>
                    <p>
                      <Selo tipo="informacao">lote aberto</Selo>{" "}
                      <span className="silencioso">{enviadasNoLote} foto(s) ja enviada(s)</span>
                    </p>

                    <div className="linha-de-botoes">
                      <button onClick={() => entradaCamera.current?.click()} disabled={ocupado}>
                        Tirar foto
                      </button>
                      <button
                        className="secundario"
                        onClick={() => entradaGaleria.current?.click()}
                        disabled={ocupado}
                      >
                        Escolher fotos
                      </button>
                    </div>

                    {/* Duas entradas: no celular, "capture" abre direto a camera; sem ele,
                        a galeria. No computador, as duas abrem o seletor de arquivos. */}
                    <input
                      ref={entradaCamera}
                      type="file"
                      accept="image/jpeg,image/png"
                      capture="environment"
                      hidden
                      onChange={escolherArquivos}
                    />
                    <input
                      ref={entradaGaleria}
                      type="file"
                      accept="image/jpeg,image/png"
                      multiple
                      hidden
                      onChange={escolherArquivos}
                    />

                    <p className="silencioso ajuda-fotos">
                      Use o GPS da camera ligado: o aplicativo le da propria foto onde ela foi
                      tirada. Foto encaminhada por aplicativo de mensagem costuma perder essa
                      informacao.
                    </p>
                  </>
                )}
              </div>
            </div>
          </div>

          {fotos.length > 0 ? (
            <div className="cartao">
              <div className="entre">
                <h2>Fotos selecionadas ({fotos.length})</h2>
                <div className="linha-de-botoes">
                  {semLocal > 0 ? (
                    <button className="secundario pequeno" onClick={usarLocalizacaoDoAparelho}>
                      Usar minha localizacao nas {semLocal} sem GPS
                    </button>
                  ) : null}
                  <button onClick={enviarFotos} disabled={ocupado || prontas === 0}>
                    {ocupado ? "Enviando…" : `Enviar ${prontas} foto(s)`}
                  </button>
                </div>
              </div>

              {foraDoTalhao > 0 ? (
                <Aviso tipo="alerta">
                  {foraDoTalhao} foto(s) caem fora do talhao e serao recusadas pelo servidor.
                  Descarte-as, ou marque o local certo no mapa se o GPS errou.
                </Aviso>
              ) : null}

              <ul className="lista-de-fotos">
                {fotos.map((foto) => (
                  <li key={foto.chave} className={marcando === foto.chave ? "marcando" : ""}>
                    <img src={foto.url} alt={foto.arquivo.name} />

                    <div className="dados-da-foto">
                      <strong>{foto.arquivo.name}</strong>

                      {Number.isFinite(foto.lon) ? (
                        <div className="silencioso mono">
                          {foto.lat.toFixed(5)}, {foto.lon.toFixed(5)}
                        </div>
                      ) : null}

                      <div className="linha-de-botoes">
                        {foto.origem ? (
                          <Selo tipo={foto.origem === "manual" ? "alerta" : "neutro"}>
                            {ORIGENS[foto.origem]}
                          </Selo>
                        ) : null}
                        {foto.situacao === "pronta" && !foto.dentro ? (
                          <Selo tipo="erro">fora do talhao</Selo>
                        ) : null}
                        {foto.situacao === "lendo" ? <Selo>lendo…</Selo> : null}
                        {foto.situacao === "sem_local" ? <Selo tipo="alerta">sem GPS</Selo> : null}
                        {foto.situacao === "enviando" ? (
                          <Selo tipo="informacao">enviando…</Selo>
                        ) : null}
                        {foto.situacao === "enviada" ? <Selo tipo="sucesso">enviada</Selo> : null}
                        {foto.situacao === "recusada" ? <Selo tipo="erro">recusada</Selo> : null}
                      </div>

                      {foto.mensagem ? <div className="erro-da-foto">{foto.mensagem}</div> : null}
                    </div>

                    {foto.situacao !== "enviada" && foto.situacao !== "enviando" ? (
                      <div className="linha-de-botoes">
                        <button
                          className="secundario pequeno"
                          onClick={() => setMarcando(foto.chave)}
                        >
                          Marcar no mapa
                        </button>
                        <button
                          className="secundario pequeno"
                          onClick={() => descartar(foto.chave)}
                        >
                          Descartar
                        </button>
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {loteAberto && enviadasNoLote > 0 ? (
            <div className="cartao">
              <h2>Mandar para analise</h2>
              <p>
                O lote aberto tem {enviadasNoLote} foto(s). Quanto mais fotos, espalhadas pelo
                talhao, mais confiavel a estimativa: com uma ou duas, a analise tende a ir para o
                perito.
              </p>
              <button onClick={fecharLote} disabled={ocupado}>
                Fechar lote e mandar para analise
              </button>
            </div>
          ) : null}

          <div className="cartao tabela-rolavel">
            <h2>Lotes deste talhao</h2>

            {lotes.length === 0 ? (
              <p className="silencioso">Nenhum lote ainda.</p>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Aberto em</th>
                    <th className="numero">Fotos</th>
                    <th>Situacao</th>
                    <th>Resumo das evidencias</th>
                  </tr>
                </thead>
                <tbody>
                  {lotes.map((lote) => {
                    const situacao = situacaoDoLote(lote);

                    return (
                      <tr key={lote.id}>
                        <td>{new Date(lote.criado_em).toLocaleString("pt-BR")}</td>
                        <td className="numero">
                          {lote.imagens}
                          {lote.imagens_com_local_manual > 0 ? (
                            <div className="silencioso">
                              {lote.imagens_com_local_manual} com local marcado a mao
                            </div>
                          ) : null}
                        </td>
                        <td>
                          <Selo tipo={situacao.tipo}>{situacao.texto}</Selo>
                        </td>
                        <td className="mono" title={lote.hash_evidencias ?? ""}>
                          {lote.hash_evidencias ? hashCurto(lote.hash_evidencias) : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          <RodapeDaFronteira>
            O local de cada foto e conferido pelo servidor, que recusa o que cair fora do talhao. O
            resumo das evidencias e o que vai para a blockchain: ele identifica exatamente este
            conjunto de fotos, e qualquer foto trocada depois produziria outro resumo.
          </RodapeDaFronteira>
        </>
      )}
    </div>
  );
}
