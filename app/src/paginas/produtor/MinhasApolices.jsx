import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { useCarteira } from "../../cadeia/CarteiraContexto";
import { listarApolices } from "../../cadeia/contratos";
import { deBytes32, emData, emEth, mensagemDeErro } from "../../cadeia/formatos";
import { listarPropostas, SITUACAO_PROPOSTA } from "../../dados/armazenamentoLocal";
import { Aviso, Carregando, LinkDaCadeia, SeloSituacao } from "../../componentes/ui";

/**
 * Apolices do produtor (UC06).
 *
 * A lista vem da fabrica, na cadeia: `apolicesDoProdutor(endereco)`. Nao ha banco
 * de dados no caminho, e e por isso que a tela exige a carteira conectada — sem
 * endereco nao ha o que consultar.
 */
export default function MinhasApolices() {
  const { conta, provedorLeitura, conectar, conectando, temCarteira } = useCarteira();

  const [apolices, setApolices] = useState([]);
  const [propostas, setPropostas] = useState([]);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState(null);

  const carregar = useCallback(async () => {
    if (!conta) return;

    setCarregando(true);
    setErro(null);

    try {
      setApolices(await listarApolices(provedorLeitura, { produtor: conta }));
    } catch (falha) {
      setErro(mensagemDeErro(falha));
    } finally {
      setCarregando(false);
    }
  }, [conta, provedorLeitura]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  useEffect(() => {
    setPropostas(listarPropostas().filter((p) => p.situacao === SITUACAO_PROPOSTA.PENDENTE));
  }, [apolices]);

  if (!temCarteira) {
    return (
      <div className="pagina">
        <h1>Minhas apolices</h1>
        <Aviso tipo="alerta" titulo="Nenhuma carteira encontrada no navegador.">
          Instale a extensao MetaMask para acompanhar as apolices.
        </Aviso>
      </div>
    );
  }

  if (!conta) {
    return (
      <div className="pagina">
        <h1>Minhas apolices</h1>
        <p>
          As apolices sao consultadas diretamente na rede, pelo endereco da sua carteira. Conecte
          para continuar.
        </p>
        <button onClick={conectar} disabled={conectando}>
          {conectando ? "Conectando…" : "Conectar carteira"}
        </button>
      </div>
    );
  }

  return (
    <div className="pagina">
      <div className="entre">
        <h1>Minhas apolices</h1>
        <button className="secundario pequeno" onClick={carregar} disabled={carregando}>
          Atualizar
        </button>
      </div>

      {erro ? <Aviso tipo="erro">{erro}</Aviso> : null}

      {propostas.length > 0 ? (
        <Aviso tipo="informacao" titulo="Proposta aguardando a seguradora.">
          {propostas.length === 1
            ? "Voce tem uma proposta enviada, ainda nao emitida."
            : `Voce tem ${propostas.length} propostas enviadas, ainda nao emitidas.`}{" "}
          A apolice so aparece aqui depois que a seguradora implanta o contrato na rede.
        </Aviso>
      ) : null}

      {carregando && apolices.length === 0 ? (
        <Carregando />
      ) : apolices.length === 0 ? (
        <div className="cartao">
          <p>Nenhuma apolice emitida para esta carteira ainda.</p>
          <Link to="/produtor/cotacao">Simular uma cotacao</Link>
        </div>
      ) : (
        <div className="tabela-rolavel cartao">
          <table>
            <thead>
              <tr>
                <th>Talhao</th>
                <th>Cultura</th>
                <th>Condicao</th>
                <th>Vigencia</th>
                <th className="numero">Limite</th>
                <th>Situacao</th>
                <th>Contrato</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {apolices.map((apolice) => (
                <tr key={apolice.endereco}>
                  <td>{deBytes32(apolice.termos.talhao)}</td>
                  <td>{deBytes32(apolice.termos.cultura)}</td>
                  <td>{apolice.termos.limiarClimatico} dias sem chuva</td>
                  <td>
                    {emData(apolice.termos.vigenciaInicio)} a {emData(apolice.termos.vigenciaFim)}
                  </td>
                  <td className="numero">{emEth(apolice.termos.valorIndenizacao)}</td>
                  <td>
                    <SeloSituacao situacao={apolice.situacao} />
                    {apolice.situacao === 2 ? (
                      <div className="silencioso">Recebeu {emEth(apolice.valorPago)}</div>
                    ) : null}
                  </td>
                  <td>
                    <LinkDaCadeia valor={apolice.endereco} tipo="address" />
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
    </div>
  );
}
