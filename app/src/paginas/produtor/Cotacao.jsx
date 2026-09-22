import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { api } from "../../api/cliente";
import { useSessao } from "../../sessao/SessaoContexto";
import {
  exemplosDeAcionamento,
  MODO_PAGAMENTO,
  OPERADOR,
  percentualDevido,
} from "../../cadeia/regraDeGatilho";
import { emEth, emPercentual } from "../../cadeia/formatos";
import { Aviso, Campo, Carregando, RodapeDaFronteira } from "../../componentes/ui";

/**
 * Simulacao de cotacao e envio da proposta (RF06, RNF06, HU10).
 *
 * O limite e o premio vem do servidor, calculados em BigInt sobre a area que o
 * PostGIS mediu no elipsoide. Os exemplos numericos do que aciona e do que nao
 * aciona vem de `regraDeGatilho.js`, a mesma regra do contrato — a equivalencia e
 * verificada caso a caso por `contratos/test/RegraDeGatilho.test.js`.
 */
export default function Cotacao() {
  const { usuario } = useSessao();

  const [talhoes, setTalhoes] = useState(null);
  const [produtos, setProdutos] = useState([]);
  const [talhaoId, setTalhaoId] = useState("");
  const [produtoId, setProdutoId] = useState("");
  const [areaSegurada, setAreaSegurada] = useState("");
  const [cotacao, setCotacao] = useState(null);
  const [enviada, setEnviada] = useState(null);
  const [erro, setErro] = useState(null);
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    Promise.all([api("/talhoes"), api("/produtos")])
      .then(([t, p]) => {
        setTalhoes(t.talhoes);
        setProdutos(p.produtos);

        if (t.talhoes[0]) {
          setTalhaoId(t.talhoes[0].id);
          setAreaSegurada(String(Number(t.talhoes[0].areaHa).toFixed(2)));
        }
      })
      .catch((falha) => setErro(falha.message));
  }, []);

  const talhao = talhoes?.find((t) => t.id === talhaoId) ?? null;

  // So faz sentido oferecer produtos da cultura plantada no talhao.
  const produtosCompativeis = useMemo(
    () => produtos.filter((p) => !talhao || p.cultura === talhao.cultura),
    [produtos, talhao],
  );

  const produto = produtosCompativeis.find((p) => p.id === produtoId) ?? null;

  /** Recalcula a cotacao no servidor a cada mudanca de talhao, produto ou area. */
  useEffect(() => {
    setCotacao(null);
    if (!talhaoId || !produtoId || !areaSegurada) return undefined;

    const temporizador = setTimeout(() => {
      api("/cotacoes", { metodo: "POST", corpo: { talhaoId, produtoId, areaHa: areaSegurada } })
        .then(({ cotacao: c }) => {
          setCotacao(c);
          setErro(null);
        })
        .catch((falha) => setErro(falha.message));
    }, 250);

    return () => clearTimeout(temporizador);
  }, [talhaoId, produtoId, areaSegurada]);

  /** Termos no formato da regra de gatilho, com o limite cotado pelo servidor. */
  const termos = useMemo(
    () => (cotacao ? { ...cotacao.termos, valorIndenizacao: cotacao.valorIndenizacaoWei } : null),
    [cotacao],
  );

  const exemplos = useMemo(() => (termos ? exemplosDeAcionamento(termos) : []), [termos]);

  /** A condicao em linguagem corrente (RNF06). */
  const condicaoEmPalavras = useMemo(() => {
    if (!produto) return null;

    const clima = `${produto.limiarClimatico} dias seguidos sem chuva`;
    const dano = `${produto.limiarDanoBps / 100}% da lavoura comprometida`;

    const gatilho =
      {
        [OPERADOR.CLIMATICO]: `Se o talhao passar ${clima}`,
        [OPERADOR.DANO]: `Se o modelo de imagens apontar ${dano}`,
        [OPERADOR.OU]: `Se o talhao passar ${clima} OU o modelo apontar ${dano}`,
        [OPERADOR.E]: `Se o talhao passar ${clima} E o modelo apontar ${dano}, no mesmo periodo`,
      }[produto.operador] ?? "";

    const pagamento =
      produto.modoPagamento === MODO_PAGAMENTO.INTEGRAL
        ? "o contrato paga o limite integral."
        : `o contrato paga metade do limite, e o valor cresce ate o limite integral quando a estiagem chega a ${produto.limiarClimaticoIntegral} dias.`;

    return `${gatilho}, ${pagamento}`;
  }, [produto]);

  async function enviarProposta() {
    setErro(null);
    setEnviando(true);

    try {
      const { proposta } = await api("/propostas", {
        metodo: "POST",
        corpo: { talhaoId, produtoId, areaHa: areaSegurada },
      });
      setEnviada(proposta);
    } catch (falha) {
      setErro(falha.message);
    } finally {
      setEnviando(false);
    }
  }

  if (talhoes === null) {
    return (
      <div className="pagina">
        <h1>Simular e contratar</h1>
        {erro ? (
          <Aviso tipo="erro">{erro}</Aviso>
        ) : (
          <Carregando>Carregando seus talhoes…</Carregando>
        )}
      </div>
    );
  }

  if (talhoes.length === 0) {
    return (
      <div className="pagina">
        <h1>Simular e contratar</h1>
        <Aviso tipo="alerta" titulo="Nenhum talhao cadastrado.">
          A seguradora precisa cadastrar o produtor e delimitar os talhoes seguraveis antes da
          cotacao (UC02).
        </Aviso>
      </div>
    );
  }

  return (
    <div className="pagina">
      <h1>Simular e contratar</h1>
      <p className="silencioso">
        A cotacao mostra o limite, o premio e exatamente o que aciona e o que nao aciona o
        pagamento.
      </p>

      {!usuario?.carteira ? (
        <Aviso tipo="alerta" titulo="Carteira nao vinculada.">
          Voce pode simular, mas para enviar a proposta e preciso{" "}
          <Link to="/produtor/carteira">vincular a carteira</Link> — e para ela que a indenizacao
          seria transferida.
        </Aviso>
      ) : null}

      {erro ? <Aviso tipo="erro">{erro}</Aviso> : null}

      {enviada ? (
        <Aviso tipo="sucesso" titulo="Proposta enviada a seguradora.">
          A seguradora precisa emitir a apolice, porque so a carteira dela pode implantar o contrato
          na rede (RNF12). Voce recebera uma notificacao quando a apolice for emitida.
        </Aviso>
      ) : null}

      <div className="grade-2">
        <div className="cartao">
          <h2>1. O que segurar</h2>

          <Campo rotulo="Talhao" htmlFor="talhao">
            <select
              id="talhao"
              value={talhaoId}
              onChange={(e) => {
                const escolhido = talhoes.find((t) => t.id === e.target.value);
                setTalhaoId(e.target.value);
                setAreaSegurada(String(Number(escolhido?.areaHa ?? 0).toFixed(2)));
                setProdutoId("");
              }}
            >
              {talhoes.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.identificador} — {t.propriedade.nome} ({t.cultura},{" "}
                  {Number(t.areaHa).toFixed(1)} ha)
                </option>
              ))}
            </select>
          </Campo>

          <Campo
            rotulo="Area segurada (ha)"
            htmlFor="area"
            ajuda={
              talhao
                ? `O talhao tem ${Number(talhao.areaHa).toFixed(2)} ha, medidos pelo PostGIS sobre o poligono cadastrado.`
                : null
            }
          >
            <input
              id="area"
              type="number"
              min="0.01"
              step="0.01"
              max={talhao?.areaHa ?? undefined}
              value={areaSegurada}
              onChange={(e) => setAreaSegurada(e.target.value)}
            />
          </Campo>

          <Campo rotulo="Produto" htmlFor="produto">
            <select id="produto" value={produtoId} onChange={(e) => setProdutoId(e.target.value)}>
              <option value="">Escolha um produto…</option>
              {produtosCompativeis.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nome}
                </option>
              ))}
            </select>
          </Campo>

          {produtosCompativeis.length === 0 ? (
            <Aviso tipo="alerta">
              Nenhum produto configurado para a cultura <strong>{talhao?.cultura}</strong>.
            </Aviso>
          ) : null}
        </div>

        <div className="cartao">
          <h2>2. Cotacao</h2>

          {!produto ? (
            <p className="silencioso">Escolha um produto para ver o limite e o premio.</p>
          ) : !cotacao ? (
            <Carregando>Calculando…</Carregando>
          ) : (
            <>
              <div className="grade">
                <div className="indicador">
                  <div className="rotulo">Limite contratado</div>
                  <div className="valor">{emEth(cotacao.valorIndenizacaoWei)}</div>
                  <div className="nota">
                    {cotacao.areaSeguradaHa} ha x {produto.valorPorHectareEth} ETH/ha
                  </div>
                </div>
                <div className="indicador">
                  <div className="rotulo">Premio</div>
                  <div className="valor">{emEth(cotacao.premioWei)}</div>
                  <div className="nota">taxa de {produto.taxaPremioBps / 100}% do limite</div>
                </div>
              </div>

              <Campo rotulo="Vigencia">
                <div>{produto.vigenciaDias} dias a partir da emissao</div>
              </Campo>
            </>
          )}
        </div>
      </div>

      {termos && produto ? (
        <div className="cartao">
          <h2>3. O que aciona o pagamento</h2>

          <Aviso tipo="informacao" titulo="Em palavras:">
            {condicaoEmPalavras}
          </Aviso>

          <p className="silencioso">
            Nao ha vistoria nem pericia. O oraculo publica o indice medido, o contrato compara com o
            limiar e, se bater, transfere na mesma transacao.
          </p>

          <div className="tabela-rolavel">
            <table className="tabela-exemplos">
              <thead>
                <tr>
                  <th>Dias seguidos sem chuva</th>
                  <th>Aciona?</th>
                  <th className="numero">Percentual</th>
                  <th className="numero">Voce recebe</th>
                </tr>
              </thead>
              <tbody>
                {exemplos.map((exemplo) => (
                  <tr
                    key={exemplo.diasSemChuva}
                    className={exemplo.percentualBps > 0 ? "aciona" : ""}
                  >
                    <td>{exemplo.diasSemChuva} dias</td>
                    <td>{exemplo.percentualBps > 0 ? "Sim" : "Nao"}</td>
                    <td className="numero">{emPercentual(exemplo.percentualBps)}</td>
                    <td className="numero">{emEth(exemplo.valorWei)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {produto.operador === OPERADOR.OU || produto.operador === OPERADOR.E ? (
            <p className="silencioso">
              Este produto tambem considera o indice de dano extraido das imagens do talhao. Com{" "}
              {produto.limiarDanoBps / 100}% de dano e nenhuma estiagem, o percentual devido seria{" "}
              {emPercentual(percentualDevido(termos, 0, produto.limiarDanoBps))}.
            </p>
          ) : null}

          <div className="linha-de-botoes" style={{ marginTop: 16 }}>
            <button
              onClick={enviarProposta}
              disabled={Boolean(enviada) || enviando || !usuario?.carteira}
            >
              {enviada
                ? "Proposta enviada"
                : enviando
                  ? "Enviando…"
                  : "Enviar proposta a seguradora"}
            </button>
            {enviada ? (
              <button className="secundario" onClick={() => setEnviada(null)}>
                Nova simulacao
              </button>
            ) : null}
          </div>

          <RodapeDaFronteira>
            Limite e premio calculados pelo servidor, em inteiros sobre wei. Os exemplos vem de{" "}
            <code>regraDeGatilho.js</code>, a mesma regra que o contrato executa, conferida por
            teste automatizado caso a caso.
          </RodapeDaFronteira>
        </div>
      ) : null}
    </div>
  );
}
