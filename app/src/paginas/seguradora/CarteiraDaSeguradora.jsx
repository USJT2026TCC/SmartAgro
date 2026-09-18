import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { useCarteira } from "../../cadeia/CarteiraContexto";
import { listarApolices, resumirCarteira } from "../../cadeia/contratos";
import { deBytes32, emData, emEth, emPercentual, mensagemDeErro } from "../../cadeia/formatos";
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
 * Painel da seguradora: carteira e indicadores (RF15, UC15).
 *
 * Os numeros sao calculados sobre o que esta na cadeia, nao sobre um relatorio
 * interno. Isso significa que a seguradora ve exatamente a mesma coisa que o
 * produtor e que a fiscalizacao veriam — que e o ponto do arranjo.
 */
export default function CarteiraDaSeguradora() {
  const { provedorLeitura } = useCarteira();

  const [apolices, setApolices] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState(null);

  const implantacao = useMemo(() => implantacaoDaRede(), []);

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro(null);

    try {
      setApolices(await listarApolices(provedorLeitura));
    } catch (falha) {
      setErro(mensagemDeErro(falha));
    } finally {
      setCarregando(false);
    }
  }, [provedorLeitura]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  const resumo = useMemo(() => resumirCarteira(apolices), [apolices]);

  return (
    <div className="pagina">
      <div className="entre">
        <h1>Carteira</h1>
        <button className="secundario pequeno" onClick={carregar} disabled={carregando}>
          Atualizar
        </button>
      </div>

      {erro ? <Aviso tipo="erro">{erro}</Aviso> : null}

      <div className="grade">
        <Indicador
          rotulo="Apolices emitidas"
          valor={resumo.total}
          nota={`${resumo.ativas} ativas · ${resumo.aguardando} sem garantia`}
        />
        <Indicador
          rotulo="Exposicao atual"
          valor={emEth(resumo.exposicao)}
          nota="garantias retidas nos contratos"
        />
        <Indicador
          rotulo="Indenizacoes pagas"
          valor={emEth(resumo.pago)}
          nota={`${resumo.liquidadas} apolice(s) liquidada(s)`}
        />
        <Indicador
          rotulo="Taxa de acionamento"
          valor={emPercentual(Math.round(resumo.taxaDeAcionamento * 10_000))}
          nota="liquidadas sobre o total emitido"
        />
      </div>

      {carregando && apolices.length === 0 ? (
        <Carregando />
      ) : apolices.length === 0 ? (
        <div className="cartao">
          <p>Nenhuma apolice emitida ainda.</p>
          <Link to="/seguradora/propostas">Ver propostas pendentes</Link>
        </div>
      ) : (
        <div className="cartao tabela-rolavel">
          <h2>Apolices emitidas</h2>
          <table>
            <thead>
              <tr>
                <th>Talhao</th>
                <th>Produtor</th>
                <th>Condicao</th>
                <th>Vigencia</th>
                <th className="numero">Limite</th>
                <th className="numero">Periodos</th>
                <th>Situacao</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {apolices.map((apolice) => (
                <tr key={apolice.endereco}>
                  <td>
                    {deBytes32(apolice.termos.talhao)}
                    <div className="silencioso">{deBytes32(apolice.termos.cultura)}</div>
                  </td>
                  <td>
                    <LinkDaCadeia valor={apolice.termos.produtor} tipo="address" />
                  </td>
                  <td>{apolice.termos.limiarClimatico} dias sem chuva</td>
                  <td>{emData(apolice.termos.vigenciaFim)}</td>
                  <td className="numero">{emEth(apolice.termos.valorIndenizacao)}</td>
                  <td className="numero">{apolice.totalPeriodos}</td>
                  <td>
                    <SeloSituacao situacao={apolice.situacao} />
                  </td>
                  <td>
                    <Link to={`/apolice/${apolice.endereco}`}>Detalhes</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {implantacao ? (
        <div className="cartao">
          <h2>Infraestrutura na rede</h2>
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
                  <th>Carteira da seguradora</th>
                  <td>
                    <LinkDaCadeia valor={implantacao.seguradora} tipo="address" curto={false} />
                  </td>
                </tr>
                <tr>
                  <th>Implantado em</th>
                  <td>{new Date(implantacao.implantadoEm).toLocaleString("pt-BR")}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <RodapeDaFronteira>
            Estes enderecos vem de <code>contratos/implantacoes/</code>, gerado pelo script de
            implantacao. Nenhum endereco e digitado a mao no aplicativo.
          </RodapeDaFronteira>
        </div>
      ) : null}
    </div>
  );
}
