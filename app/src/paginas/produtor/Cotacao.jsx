import { useMemo, useState } from "react";
import { ethers } from "ethers";

import { useSessao } from "../../sessao/SessaoContexto";
import { useCarteira } from "../../cadeia/CarteiraContexto";
import { listarProdutos, listarTalhoes, salvarProposta } from "../../dados/armazenamentoLocal";
import {
  exemplosDeAcionamento,
  MODO_PAGAMENTO,
  OPERADOR,
  percentualDevido,
} from "../../cadeia/regraDeGatilho";
import { emEth, emPercentual, paraBytes32 } from "../../cadeia/formatos";
import { Aviso, Campo, NotaDePrototipo, RodapeDaFronteira } from "../../componentes/ui";

/**
 * Simulacao de cotacao e envio da proposta (RF06, RNF06, HU10).
 *
 * O coracao da tela sao os exemplos numericos. O RNF06 pede apresentar a condicao
 * contratada em linguagem nao tecnica antes do aceite, com exemplos — e esses
 * exemplos sao calculados por `regraDeGatilho.js`, a mesma regra que o contrato
 * executa. A equivalencia entre as duas implementacoes e verificada por
 * `contratos/test/RegraDeGatilho.test.js`, de modo que a tela nao possa prometer
 * um numero que o contrato nao vai honrar.
 */
export default function Cotacao() {
  const { usuario } = useSessao();
  const { conta } = useCarteira();

  const talhoes = useMemo(() => listarTalhoes(), []);
  const produtos = useMemo(() => listarProdutos(), []);

  const [talhaoId, setTalhaoId] = useState(talhoes[0]?.id ?? "");
  const [produtoId, setProdutoId] = useState("");
  const [areaSegurada, setAreaSegurada] = useState(talhoes[0]?.areaHa ?? 0);
  const [enviada, setEnviada] = useState(null);
  const [erro, setErro] = useState(null);

  const talhao = talhoes.find((t) => t.id === talhaoId) ?? null;

  // So faz sentido oferecer produtos da cultura plantada no talhao.
  const produtosCompativeis = useMemo(
    () => produtos.filter((p) => !talhao || p.cultura === talhao.cultura),
    [produtos, talhao],
  );

  const produto = produtosCompativeis.find((p) => p.id === produtoId) ?? null;

  /**
   * Limite contratado e premio, a partir da area e do produto escolhido.
   *
   * A conta e feita inteiramente em BigInt, sobre wei. Calcular em ponto flutuante
   * e converter no fim parece funcionar e nao funciona: 180 x 0,006 da
   * 1,0800000000000000710 em binario, e o limite gravado no contrato sairia com 71
   * wei a mais do que a tela mostra. Sao centavos de centavo, mas e um valor
   * contratual que nao fecha com o documento — e, uma vez implantado, nao ha como
   * corrigir.
   *
   * A area vira centesimos de hectare para admitir fracao sem sair dos inteiros.
   */
  const cotacao = useMemo(() => {
    if (!produto || !areaSegurada) return null;

    const area = Number(areaSegurada);
    if (!Number.isFinite(area) || area <= 0) return null;

    const centesimosDeHectare = BigInt(Math.round(area * 100));
    const porHectareEmWei = ethers.parseEther(String(produto.valorPorHectareEth));

    const valorIndenizacao = (porHectareEmWei * centesimosDeHectare) / 100n;

    // A taxa vem em percentual com uma casa decimal; 10000 = 100% em centesimos
    // de ponto percentual.
    const taxaEmCentesimos = BigInt(Math.round(Number(produto.taxaPremioPct) * 100));
    const premioWei = (valorIndenizacao * taxaEmCentesimos) / 10_000n;

    return { area, valorIndenizacao, premioWei };
  }, [produto, areaSegurada]);

  /** Termos no formato que o contrato espera, ja com o limite calculado. */
  const termos = useMemo(() => {
    if (!produto || !cotacao || !talhao) return null;

    return {
      cultura: talhao.cultura,
      talhao: talhao.nome,
      operador: produto.operador,
      modoPagamento: produto.modoPagamento,
      limiarClimatico: produto.limiarClimatico,
      limiarClimaticoIntegral: produto.limiarClimaticoIntegral,
      limiarDanoBps: produto.limiarDanoBps,
      limiarDanoIntegralBps: produto.limiarDanoIntegralBps,
      vigenciaDias: produto.vigenciaDias,
      valorIndenizacao: cotacao.valorIndenizacao,
    };
  }, [produto, cotacao, talhao]);

  const exemplos = useMemo(() => (termos ? exemplosDeAcionamento(termos) : []), [termos]);

  /** Descricao da condicao em linguagem corrente (RNF06). */
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

  function enviarProposta() {
    setErro(null);

    if (!talhao || !produto || !cotacao) {
      setErro("Escolha o talhao, o produto e a area antes de enviar.");
      return;
    }

    if (!conta) {
      setErro(
        "Conecte e vincule a carteira antes de enviar a proposta: e para ela que a indenizacao seria transferida.",
      );
      return;
    }

    if (Number(areaSegurada) > Number(talhao.areaHa)) {
      setErro(`A area segurada nao pode exceder os ${talhao.areaHa} ha do talhao.`);
      return;
    }

    const proposta = salvarProposta({
      produtorIdentificador: usuario.identificador,
      produtorNome: usuario.nome,
      carteiraProdutor: conta,
      talhaoId: talhao.id,
      talhaoNome: talhao.nome,
      cultura: talhao.cultura,
      municipio: talhao.municipio,
      areaHa: Number(areaSegurada),
      produtoId: produto.id,
      produtoNome: produto.nome,
      operador: produto.operador,
      modoPagamento: produto.modoPagamento,
      limiarClimatico: produto.limiarClimatico,
      limiarClimaticoIntegral: produto.limiarClimaticoIntegral,
      limiarDanoBps: produto.limiarDanoBps,
      limiarDanoIntegralBps: produto.limiarDanoIntegralBps,
      vigenciaDias: produto.vigenciaDias,
      valorIndenizacaoWei: cotacao.valorIndenizacao.toString(),
      premioWei: cotacao.premioWei.toString(),
      culturaBytes32: paraBytes32(talhao.cultura),
      talhaoBytes32: paraBytes32(talhao.nome),
    });

    setEnviada(proposta);
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

      {erro ? <Aviso tipo="erro">{erro}</Aviso> : null}

      {enviada ? (
        <Aviso tipo="sucesso" titulo="Proposta enviada a seguradora.">
          A seguradora precisa emitir a apolice, porque so a carteira dela pode implantar o contrato
          na rede (RNF12). Assim que ela emitir, a apolice aparece em{" "}
          <strong>Minhas apolices</strong> com o endereco do contrato.
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
                setAreaSegurada(escolhido?.areaHa ?? 0);
                setProdutoId("");
              }}
            >
              {talhoes.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.nome} — {t.propriedade} ({t.cultura}, {t.areaHa} ha)
                </option>
              ))}
            </select>
          </Campo>

          <Campo
            rotulo="Area segurada (ha)"
            htmlFor="area"
            ajuda={talhao ? `O talhao tem ${talhao.areaHa} ha delimitados.` : null}
          >
            <input
              id="area"
              type="number"
              min="1"
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

          {!cotacao ? (
            <p className="silencioso">Escolha um produto para ver o limite e o premio.</p>
          ) : (
            <>
              <div className="grade">
                <div className="indicador">
                  <div className="rotulo">Limite contratado</div>
                  <div className="valor">{emEth(cotacao.valorIndenizacao)}</div>
                  <div className="nota">
                    {cotacao.area} ha x {produto.valorPorHectareEth} ETH/ha
                  </div>
                </div>
                <div className="indicador">
                  <div className="rotulo">Premio</div>
                  <div className="valor">{emEth(cotacao.premioWei)}</div>
                  <div className="nota">taxa de {produto.taxaPremioPct}% do limite</div>
                </div>
              </div>

              <Campo rotulo="Vigencia">
                <div>{produto.vigenciaDias} dias a partir da emissao</div>
              </Campo>
            </>
          )}
        </div>
      </div>

      {termos ? (
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
            <button onClick={enviarProposta} disabled={Boolean(enviada)}>
              {enviada ? "Proposta enviada" : "Enviar proposta a seguradora"}
            </button>
            {enviada ? (
              <button
                className="secundario"
                onClick={() => {
                  setEnviada(null);
                  setProdutoId("");
                }}
              >
                Nova simulacao
              </button>
            ) : null}
          </div>

          <RodapeDaFronteira>
            Os numeros desta tabela vem de <code>regraDeGatilho.js</code>, a mesma regra que o
            contrato executa. Um teste automatizado compara as duas implementacoes caso a caso, para
            que a tela nao prometa o que o contrato nao vai pagar.
          </RodapeDaFronteira>
        </div>
      ) : null}

      <NotaDePrototipo>
        A proposta fica no <code>localStorage</code> deste navegador. Produtor e seguradora em
        maquinas diferentes nao veem a mesma proposta — o banco compartilhado entra na Sprint 2. A
        apolice em si, essa nasce na cadeia.
      </NotaDePrototipo>
    </div>
  );
}
