import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { useCarteira } from "../cadeia/CarteiraContexto";
import { listarApolices, lerPublicacoes } from "../cadeia/contratos";
import {
  deBytes32,
  emDataHora,
  emPercentual,
  hashCurto,
  mensagemDeErro,
  periodoEmData,
} from "../cadeia/formatos";
import { Aviso, Carregando, LinkDaCadeia, RodapeDaFronteira, Selo } from "../componentes/ui";

/** Abaixo disso, a inferencia do modelo vai para revisao humana (RF17). */
const LIMIAR_DE_CONFIANCA_BPS = 7_000;

/**
 * Revisao tecnica do perito agronomo (ator principal, atua por excecao).
 *
 * O perito nao participa do fluxo normal: o sistema existe justamente para
 * dispensar a vistoria. Ele entra quando o modelo de visao devolve confianca baixa,
 * e quando o produtor contesta uma avaliacao.
 *
 * A tela reune as publicacoes que mereceriam um segundo olhar — as que ja chegaram
 * a cadeia com confianca abaixo do limiar. O caminho preferido e outro: o servico
 * de oraculo ja suspende a publicacao do indice de dano nesses casos, antes de
 * gastar gas. O que aparece aqui sao as que passaram por algum outro caminho, e o
 * registro serve de conferencia.
 */
export default function RevisaoTecnica() {
  const { provedorLeitura } = useCarteira();

  const [linhas, setLinhas] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState(null);

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro(null);

    try {
      const apolices = await listarApolices(provedorLeitura);

      const porApolice = await Promise.all(
        apolices.map(async (apolice) => {
          const publicacoes = await lerPublicacoes(apolice.endereco, provedorLeitura);

          return publicacoes.map((publicacao) => ({ apolice, publicacao }));
        }),
      );

      setLinhas(porApolice.flat().sort((a, b) => b.publicacao.periodo - a.publicacao.periodo));
    } catch (falha) {
      setErro(mensagemDeErro(falha));
    } finally {
      setCarregando(false);
    }
  }, [provedorLeitura]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  /** Publicacoes que trazem inferencia de imagem, unicas que o perito revisa. */
  const comInferencia = useMemo(
    () => linhas.filter((linha) => linha.publicacao.confiancaBps > 0),
    [linhas],
  );

  const baixaConfianca = useMemo(
    () => comInferencia.filter((linha) => linha.publicacao.confiancaBps < LIMIAR_DE_CONFIANCA_BPS),
    [comInferencia],
  );

  return (
    <div className="pagina">
      <div className="entre">
        <h1>Revisao tecnica</h1>
        <button className="secundario pequeno" onClick={carregar} disabled={carregando}>
          Atualizar
        </button>
      </div>

      <p className="silencioso">
        O perito atua por excecao: nos casos de baixa confianca do modelo e nas contestacoes. O
        fluxo normal dispensa vistoria.
      </p>

      {erro ? <Aviso tipo="erro">{erro}</Aviso> : null}

      {baixaConfianca.length > 0 ? (
        <Aviso tipo="alerta" titulo="Publicacoes com confianca abaixo do limiar.">
          {baixaConfianca.length} inferencia(s) chegaram a cadeia com confianca menor que{" "}
          {emPercentual(LIMIAR_DE_CONFIANCA_BPS)}. Vale reexecutar a analise sobre o mesmo lote de
          imagens e conferir o resultado.
        </Aviso>
      ) : null}

      {carregando && linhas.length === 0 ? (
        <Carregando />
      ) : comInferencia.length === 0 ? (
        <div className="cartao">
          <p>Nenhuma publicacao com inferencia de imagem ainda.</p>
          <p className="silencioso">
            As publicacoes atuais trazem apenas o indice climatico, que nao depende do modelo de
            visao e portanto nao passa por revisao tecnica. O modulo de visao computacional entra na
            Sprint 3.
          </p>
        </div>
      ) : (
        <div className="cartao tabela-rolavel">
          <h2>Inferencias publicadas</h2>
          <table>
            <thead>
              <tr>
                <th>Periodo</th>
                <th>Talhao</th>
                <th className="numero">Indice de dano</th>
                <th className="numero">Confianca</th>
                <th>Evidencias e modelo</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {comInferencia.map(({ apolice, publicacao }) => {
                const baixa = publicacao.confiancaBps < LIMIAR_DE_CONFIANCA_BPS;

                return (
                  <tr key={`${apolice.endereco}-${publicacao.periodo}`}>
                    <td>
                      {periodoEmData(publicacao.periodo)}
                      <div className="silencioso">{emDataHora(publicacao.publicadoEm)}</div>
                    </td>
                    <td>{deBytes32(apolice.termos.talhao)}</td>
                    <td className="numero">{emPercentual(publicacao.indiceDanoBps)}</td>
                    <td className="numero">
                      {emPercentual(publicacao.confiancaBps)}{" "}
                      {baixa ? <Selo tipo="alerta">revisar</Selo> : null}
                    </td>
                    <td>
                      <div className="mono" title={publicacao.hashEvidencias}>
                        lote {hashCurto(publicacao.hashEvidencias)}
                      </div>
                      <div className="silencioso mono" title={publicacao.versaoModelo}>
                        modelo {hashCurto(publicacao.versaoModelo)}
                      </div>
                    </td>
                    <td>
                      <Link to={`/apolice/${apolice.endereco}`}>Ver apolice</Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <RodapeDaFronteira>
            O resumo criptografico identifica exatamente qual lote de imagens produziu o numero, e a
            versao diz qual modelo o produziu. Com os dois, a analise pode ser reexecutada e o
            resultado conferido — e isso que torna a decisao reconstituivel (RNF20, RNF21).
          </RodapeDaFronteira>
        </div>
      )}

      <div className="cartao">
        <h2>Contestacao de avaliacao</h2>
        <p className="silencioso">
          O RF28 preve que o produtor conteste a avaliacao automatica e o perito registre o parecer.
          Consta como item de reserva no planejamento: retificar um indice ja publicado exige um
          mecanismo de correcao em cadeia que nao cabe no prazo das tres sprints.
        </p>
      </div>
    </div>
  );
}
