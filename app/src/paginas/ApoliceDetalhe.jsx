import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";

import { useCarteira } from "../cadeia/CarteiraContexto";
import { useSessao } from "../sessao/SessaoContexto";
import { PERFIS } from "../sessao/usuarios";
import { contratoApolice, lerApolice, lerLinhaDoTempo, lerPublicacoes } from "../cadeia/contratos";
import {
  deBytes32,
  emData,
  emDataHora,
  emEth,
  emPercentual,
  explicacaoSituacao,
  hashCurto,
  mensagemDeErro,
  periodoEmData,
} from "../cadeia/formatos";
import {
  Aviso,
  Campo,
  Carregando,
  Indicador,
  LinkDaCadeia,
  RodapeDaFronteira,
  Selo,
  SeloSituacao,
} from "../componentes/ui";

/**
 * Detalhe da apolice: termos, publicacoes e linha do tempo (UC06, RF09, RF16).
 *
 * Tudo nesta tela vem da cadeia. A linha do tempo e reconstruida dos eventos, e
 * nao de um banco de dados — e essa a diferenca que importa para o trabalho: o
 * historico pode ser conferido por qualquer parte, inclusive contra a vontade da
 * seguradora, porque quem guarda e a rede.
 *
 * A tela tambem escuta os eventos ao vivo. Durante a demonstracao, o oraculo
 * publica em outro terminal e a linha do tempo cresce sozinha, sem recarregar.
 */

/** Titulos legiveis para cada evento do contrato. */
const TITULOS = {
  ApoliceImplantada: "Apolice implantada na rede",
  GarantiaDepositada: "Seguradora depositou a garantia",
  IndicesPublicados: "Oraculo publicou os indices do periodo",
  CondicaoAvaliada: "Contrato avaliou a condicao contratada",
  PagamentoExecutado: "Indenizacao transferida ao produtor",
  GarantiaResgatada: "Garantia devolvida a seguradora",
};

/** Descricao de cada evento, com os argumentos que importam. */
function descreverEvento(evento) {
  const a = evento.argumentos;

  switch (evento.nome) {
    case "ApoliceImplantada":
      return `Limite de ${emEth(a.valorIndenizacao)} para o talhao ${deBytes32(a.talhao)}.`;
    case "GarantiaDepositada":
      return `${emEth(a.valor)} retidos no contrato como lastro da indenizacao.`;
    case "IndicesPublicados":
      return (
        `Periodo ${periodoEmData(a.periodo)} — indice climatico de ${a.indiceClimatico} dia(s) sem chuva` +
        (Number(a.indiceDanoBps) > 0
          ? `, indice de dano de ${emPercentual(a.indiceDanoBps)} com ${emPercentual(a.confiancaBps)} de confianca.`
          : ".")
      );
    case "CondicaoAvaliada":
      return a.atendida
        ? `Condicao atendida. Percentual devido: ${emPercentual(a.percentualBps)}.`
        : "Condicao nao atendida neste periodo. Nenhum valor foi movimentado.";
    case "PagamentoExecutado":
      return `${emEth(a.valor)} transferidos sem aprovacao humana, na mesma transacao que publicou o indice.`;
    case "GarantiaResgatada":
      return `${emEth(a.valor)} devolvidos apos o fim da vigencia sem acionamento.`;
    default:
      return "";
  }
}

export default function ApoliceDetalhe() {
  const { endereco } = useParams();
  const { provedorLeitura, signatario, conta, rede } = useCarteira();
  const { perfil } = useSessao();

  const [apolice, setApolice] = useState(null);
  const [publicacoes, setPublicacoes] = useState([]);
  const [linhaDoTempo, setLinhaDoTempo] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState(null);
  const [aviso, setAviso] = useState(null);
  const [operando, setOperando] = useState(false);

  const carregar = useCallback(async () => {
    setErro(null);

    try {
      const [dados, pubs, eventos] = await Promise.all([
        lerApolice(endereco, provedorLeitura),
        lerPublicacoes(endereco, provedorLeitura),
        lerLinhaDoTempo(endereco, provedorLeitura),
      ]);

      setApolice(dados);
      setPublicacoes(pubs);
      setLinhaDoTempo(eventos);
    } catch (falha) {
      setErro(mensagemDeErro(falha));
    } finally {
      setCarregando(false);
    }
  }, [endereco, provedorLeitura]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  /**
   * Escuta ao vivo. O contrato emite os eventos na mesma transacao em que paga,
   * entao recarregar tudo quando um deles chega mantem a tela coerente sem
   * precisar montar o estado a partir do proprio evento.
   */
  useEffect(() => {
    const contrato = contratoApolice(endereco, provedorLeitura);
    const atualizar = () => carregar();

    contrato.on("IndicesPublicados", atualizar);
    contrato.on("PagamentoExecutado", atualizar);
    contrato.on("GarantiaDepositada", atualizar);

    return () => {
      contrato.removeAllListeners();
    };
  }, [endereco, provedorLeitura, carregar]);

  /** Deposito da garantia pela seguradora, direto da tela. */
  async function depositarGarantia() {
    setAviso(null);
    setErro(null);
    setOperando(true);

    try {
      const contrato = contratoApolice(endereco, signatario);
      const transacao = await contrato.depositarGarantia({
        value: apolice.termos.valorIndenizacao,
      });

      setAviso(`Transacao enviada: ${transacao.hash}. Aguardando confirmacao…`);
      await transacao.wait();
      setAviso("Garantia depositada. A apolice esta ativa e pronta para receber indices.");
      await carregar();
    } catch (falha) {
      setErro(mensagemDeErro(falha));
    } finally {
      setOperando(false);
    }
  }

  /** Resgate da garantia apos o fim da vigencia sem acionamento. */
  async function resgatarGarantia() {
    setAviso(null);
    setErro(null);
    setOperando(true);

    try {
      const contrato = contratoApolice(endereco, signatario);
      const transacao = await contrato.resgatarGarantia();

      setAviso(`Transacao enviada: ${transacao.hash}. Aguardando confirmacao…`);
      await transacao.wait();

      // A apolice liquidada nao muda de situacao no resgate da sobra; so a que
      // venceu sem acionamento e que passa a ENCERRADA.
      setAviso(
        apolice.situacao === 2
          ? "Sobra do pagamento escalonado devolvida. A apolice continua liquidada."
          : "Garantia devolvida. A apolice foi encerrada.",
      );
      await carregar();
    } catch (falha) {
      setErro(mensagemDeErro(falha));
    } finally {
      setOperando(false);
    }
  }

  if (carregando) {
    return (
      <div className="pagina">
        <Carregando>Lendo a apolice na rede…</Carregando>
      </div>
    );
  }

  if (erro && !apolice) {
    return (
      <div className="pagina">
        <h1>Apolice</h1>
        <Aviso tipo="erro" titulo="Nao foi possivel ler a apolice.">
          {erro}
        </Aviso>
        <p className="silencioso mono">{endereco}</p>
      </div>
    );
  }

  const t = apolice.termos;
  const ehSeguradora =
    perfil === PERFIS.SEGURADORA &&
    conta &&
    conta.toLowerCase() === apolice.seguradora.toLowerCase();

  const vigenciaVencida = Date.now() / 1000 > t.vigenciaFim;

  /**
   * O contrato aceita o resgate em dois casos: apolice ativa com vigencia vencida,
   * e apolice liquidada com saldo remanescente do pagamento escalonado. A tela
   * espelha exatamente essa regra — oferecer um botao que o contrato recusaria
   * seria pior do que nao oferecer nenhum.
   */
  const podeResgatar =
    apolice.garantiaRetida > 0n &&
    ((apolice.situacao === 1 && vigenciaVencida) || apolice.situacao === 2);

  return (
    <div className="pagina">
      <div className="entre">
        <div>
          <h1>Talhao {deBytes32(t.talhao)}</h1>
          <p className="silencioso mono">{endereco}</p>
        </div>
        <div className="linha-de-botoes">
          <SeloSituacao situacao={apolice.situacao} />
          <button className="secundario pequeno" onClick={carregar}>
            Atualizar
          </button>
        </div>
      </div>

      {erro ? <Aviso tipo="erro">{erro}</Aviso> : null}
      {aviso ? <Aviso tipo="sucesso">{aviso}</Aviso> : null}

      <Aviso tipo="informacao">{explicacaoSituacao(apolice.situacao)}</Aviso>

      <div className="grade">
        <Indicador rotulo="Limite contratado" valor={emEth(t.valorIndenizacao)} />
        <Indicador
          rotulo="Garantia retida"
          valor={emEth(apolice.garantiaRetida)}
          nota="lastro depositado pela seguradora"
        />
        <Indicador
          rotulo="Valor pago"
          valor={emEth(apolice.valorPago)}
          nota={
            apolice.periodoAcionador > 0
              ? `acionado em ${periodoEmData(apolice.periodoAcionador)}`
              : "nenhum acionamento"
          }
        />
        <Indicador
          rotulo="Periodos publicados"
          valor={apolice.totalPeriodos}
          nota="cada um e uma travessia da fronteira"
        />
      </div>

      {ehSeguradora ? (
        <div className="cartao">
          <h2>Acoes da seguradora</h2>
          <div className="linha-de-botoes">
            {apolice.situacao === 0 ? (
              <button onClick={depositarGarantia} disabled={operando || !signatario}>
                {operando ? "Aguardando a carteira…" : `Depositar ${emEth(t.valorIndenizacao)}`}
              </button>
            ) : null}

            {podeResgatar ? (
              <button onClick={resgatarGarantia} disabled={operando || !signatario}>
                {operando
                  ? "Aguardando a carteira…"
                  : apolice.situacao === 2
                    ? `Resgatar a sobra de ${emEth(apolice.garantiaRetida)}`
                    : "Resgatar garantia"}
              </button>
            ) : null}

            {apolice.situacao === 1 && !vigenciaVencida ? (
              <span className="silencioso">
                A garantia so pode ser resgatada apos {emData(t.vigenciaFim)}, e apenas se a
                condicao nao tiver sido acionada.
              </span>
            ) : null}

            {/* No modo escalonado o pagamento pode ser parcial. O que sobra nao
                tem mais destino, porque depois da liquidacao nenhuma publicacao e
                aceita — entao volta para a seguradora. */}
            {apolice.situacao === 2 && apolice.garantiaRetida > 0n ? (
              <span className="silencioso">
                O pagamento foi escalonado: {emEth(apolice.valorPago)} de{" "}
                {emEth(t.valorIndenizacao)}. A diferenca nao sera devida a ninguem e pode voltar
                para a seguradora.
              </span>
            ) : null}

            {!podeResgatar && !(apolice.situacao === 1 && !vigenciaVencida) ? (
              <span className="silencioso">Nao ha acoes pendentes nesta apolice.</span>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="grade-2">
        <div className="cartao">
          <h2>Termos contratados</h2>

          <Campo rotulo="Produtor">
            <LinkDaCadeia valor={t.produtor} tipo="address" curto={false} />
          </Campo>

          <Campo rotulo="Seguradora">
            <LinkDaCadeia valor={apolice.seguradora} tipo="address" curto={false} />
          </Campo>

          <Campo rotulo="Cultura">{deBytes32(t.cultura)}</Campo>

          <Campo rotulo="Condicao contratada">
            {t.limiarClimatico > 0 ? `${t.limiarClimatico} dias consecutivos sem chuva` : null}
            {t.limiarDanoBps > 0
              ? `${t.limiarClimatico > 0 ? " ou " : ""}${emPercentual(t.limiarDanoBps)} de dano na lavoura`
              : null}
          </Campo>

          <Campo rotulo="Modo de pagamento">
            {t.modoPagamento === 0
              ? "Integral: paga o limite quando aciona."
              : `Escalonado: 50% no gatilho, crescendo ate 100% em ${t.limiarClimaticoIntegral} dias.`}
          </Campo>

          <Campo rotulo="Vigencia">
            {emData(t.vigenciaInicio)} a {emData(t.vigenciaFim)}
          </Campo>

          <Campo
            rotulo="Resumo criptografico dos termos"
            ajuda="Gravado na implantacao. Qualquer alteracao no documento contratual produz um resumo diferente, e portanto detectavel (RF08)."
          >
            <div className="mono" title={t.hashTermos}>
              {hashCurto(t.hashTermos)}
            </div>
          </Campo>

          <Campo
            rotulo="Registro de oraculos"
            ajuda="Contrato consultado a cada publicacao para conferir se a origem do dado esta autorizada (RF18)."
          >
            <LinkDaCadeia valor={t.registry} tipo="address" />
          </Campo>
        </div>

        <div className="cartao">
          <h2>Indices publicados</h2>

          {publicacoes.length === 0 ? (
            <p className="silencioso">
              Nenhum indice publicado ainda. O oraculo publica um por periodo de referencia.
            </p>
          ) : (
            <div className="tabela-rolavel">
              <table>
                <thead>
                  <tr>
                    <th>Periodo</th>
                    <th className="numero">Clima</th>
                    <th className="numero">Dano</th>
                    <th className="numero">Confianca</th>
                    <th>Evidencias</th>
                  </tr>
                </thead>
                <tbody>
                  {publicacoes.map((p) => (
                    <tr key={p.periodo}>
                      <td>
                        {periodoEmData(p.periodo)}
                        <div className="silencioso">{emDataHora(p.publicadoEm)}</div>
                      </td>
                      <td className="numero">{p.indiceClimatico} dias</td>
                      <td className="numero">
                        {p.indiceDanoBps > 0 ? emPercentual(p.indiceDanoBps) : "—"}
                      </td>
                      <td className="numero">
                        {p.confiancaBps > 0 ? emPercentual(p.confiancaBps) : "—"}
                      </td>
                      <td>
                        <div className="mono" title={p.hashEvidencias}>
                          {hashCurto(p.hashEvidencias)}
                        </div>
                        <div className="silencioso mono" title={p.versaoModelo}>
                          modelo {hashCurto(p.versaoModelo)}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <RodapeDaFronteira>
            O contrato nao verifica se o indice esta correto, apenas se quem publicou tinha
            autorizacao. O resumo das evidencias e a versao do modelo ficam gravados para que a
            analise possa ser reexecutada e conferida depois (RNF20, RNF21).
          </RodapeDaFronteira>
        </div>
      </div>

      <div className="cartao">
        <h2>Linha do tempo</h2>
        <p className="silencioso">
          Reconstruida a partir dos eventos registrados na rede, e nao de um banco de dados. E o que
          permite a qualquer parte auditar a decisao de pagamento (RF09, RNF20).
        </p>

        {linhaDoTempo.length === 0 ? (
          <p className="silencioso">Nenhum evento registrado ainda.</p>
        ) : (
          <ul className="linha-do-tempo">
            {linhaDoTempo.map((evento) => (
              <li
                key={`${evento.txHash}-${evento.indiceNoBloco}`}
                className={evento.nome === "PagamentoExecutado" ? "pagamento" : ""}
              >
                <div className="titulo-evento">
                  {TITULOS[evento.nome] ?? evento.nome}{" "}
                  {evento.nome === "PagamentoExecutado" ? (
                    <Selo tipo="sucesso">sem intervencao humana</Selo>
                  ) : null}
                </div>
                <div className="detalhe">{descreverEvento(evento)}</div>
                <div className="detalhe">
                  {emDataHora(evento.em)} · bloco {evento.bloco} ·{" "}
                  <LinkDaCadeia valor={evento.txHash} tipo="tx" />
                </div>
              </li>
            ))}
          </ul>
        )}

        {!rede.explorador ? (
          <p className="silencioso">
            A rede local nao tem explorador de blocos publico. Em Sepolia, cada transacao acima vira
            um link conferivel por qualquer pessoa.
          </p>
        ) : null}
      </div>
    </div>
  );
}
