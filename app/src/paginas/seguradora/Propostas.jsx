import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ethers } from "ethers";

import { useCarteira } from "../../cadeia/CarteiraContexto";
import { contratoApolice, contratoFactory } from "../../cadeia/contratos";
import { emEth, mensagemDeErro } from "../../cadeia/formatos";
import {
  aoMudarDados,
  atualizarProposta,
  listarPropostas,
  SITUACAO_PROPOSTA,
} from "../../dados/armazenamentoLocal";
import { Aviso, LinkDaCadeia, NotaDePrototipo, Selo } from "../../componentes/ui";

const DIA_EM_SEGUNDOS = 24 * 60 * 60;

/**
 * Emissao da apolice a partir de uma proposta (RF07, UC05, HU10).
 *
 * E aqui que o contrato nasce. A transacao e assinada pela carteira da seguradora,
 * porque `emitirApolice` e restrita a ela — o produtor nao pode implantar a propria
 * apolice, e e isso que o RNF12 exige.
 *
 * O fluxo tem duas transacoes, de proposito: emitir e depois depositar a garantia.
 * Poderiam ser uma so, mas entao a fabrica precisaria custodiar valor, e o endereco
 * pagador deixaria de ser o da seguradora.
 */
export default function Propostas() {
  const { signatario, conta, provedorLeitura, redeCorreta, rede, trocarDeRede, conectar } =
    useCarteira();

  const [propostas, setPropostas] = useState([]);
  const [emitindo, setEmitindo] = useState(null);
  const [erro, setErro] = useState(null);
  const [aviso, setAviso] = useState(null);
  const [seguradoraDaFabrica, setSeguradoraDaFabrica] = useState(null);

  const recarregar = useCallback(() => setPropostas(listarPropostas()), []);

  useEffect(() => {
    recarregar();

    return aoMudarDados(recarregar);
  }, [recarregar]);

  useEffect(() => {
    contratoFactory(provedorLeitura)
      .seguradora()
      .then(setSeguradoraDaFabrica)
      .catch(() => setSeguradoraDaFabrica(null));
  }, [provedorLeitura]);

  /**
   * Monta o resumo criptografico dos termos (RF08).
   *
   * O texto precisa ser deterministico e conter tudo o que foi acordado: e ele que,
   * mais tarde, prova que o documento contratual nao mudou. A mesma cadeia de
   * caracteres e guardada na proposta, para que a conferencia seja possivel.
   */
  function descreverTermos(proposta, vigenciaInicio, vigenciaFim) {
    return [
      "AgroSmart",
      proposta.cultura,
      proposta.talhaoNome,
      `${proposta.areaHa} ha`,
      `gatilho ${proposta.limiarClimatico} dias sem chuva`,
      `dano ${proposta.limiarDanoBps} bps`,
      `operador ${proposta.operador}`,
      `modo ${proposta.modoPagamento}`,
      `limite ${proposta.valorIndenizacaoWei} wei`,
      `vigencia ${new Date(vigenciaInicio * 1000).toISOString()} a ${new Date(vigenciaFim * 1000).toISOString()}`,
      `produtor ${proposta.carteiraProdutor}`,
    ].join("|");
  }

  async function emitir(proposta) {
    setErro(null);
    setAviso(null);
    setEmitindo(proposta.id);

    try {
      const bloco = await provedorLeitura.getBlock("latest");
      const vigenciaInicio = bloco.timestamp;
      const vigenciaFim = vigenciaInicio + Number(proposta.vigenciaDias) * DIA_EM_SEGUNDOS;

      const descricao = descreverTermos(proposta, vigenciaInicio, vigenciaFim);

      const termos = {
        produtor: proposta.carteiraProdutor,
        // A fabrica sobrescreve com o registro oficial; o valor enviado aqui e
        // apenas um marcador de posicao.
        registry: ethers.ZeroAddress,
        cultura: proposta.culturaBytes32,
        talhao: proposta.talhaoBytes32,
        operador: proposta.operador,
        modoPagamento: proposta.modoPagamento,
        limiarClimatico: proposta.limiarClimatico,
        limiarClimaticoIntegral: proposta.limiarClimaticoIntegral,
        limiarDanoBps: proposta.limiarDanoBps,
        limiarDanoIntegralBps: proposta.limiarDanoIntegralBps,
        vigenciaInicio,
        vigenciaFim,
        valorIndenizacao: BigInt(proposta.valorIndenizacaoWei),
        hashTermos: ethers.keccak256(ethers.toUtf8Bytes(descricao)),
      };

      const factory = contratoFactory(signatario);

      setAviso("Confirme a emissao na carteira…");
      const transacao = await factory.emitirApolice(termos);

      setAviso(`Emissao enviada: ${transacao.hash}. Aguardando confirmacao…`);
      const recibo = await transacao.wait();

      // O endereco do contrato recem-implantado vem do evento, e nao de um
      // retorno de funcao: uma transacao nao devolve valor de retorno ao cliente.
      const evento = recibo.logs
        .map((log) => {
          try {
            return factory.interface.parseLog(log);
          } catch {
            return null;
          }
        })
        .find((parseado) => parseado?.name === "ApoliceEmitida");

      const enderecoApolice = evento?.args?.apolice;

      if (!enderecoApolice) {
        throw new Error("A apolice foi emitida, mas o endereco nao pode ser lido do evento.");
      }

      atualizarProposta(proposta.id, {
        situacao: SITUACAO_PROPOSTA.EMITIDA,
        enderecoApolice,
        descricaoDosTermos: descricao,
        hashTermos: termos.hashTermos,
        txEmissao: recibo.hash,
        gasEmissao: recibo.gasUsed.toString(),
        emitidaEm: new Date().toISOString(),
      });

      setAviso(
        `Apolice implantada em ${enderecoApolice}. Gas da emissao: ${recibo.gasUsed}. Falta depositar a garantia.`,
      );
      recarregar();
    } catch (falha) {
      setErro(mensagemDeErro(falha));
    } finally {
      setEmitindo(null);
    }
  }

  async function depositar(proposta) {
    setErro(null);
    setAviso(null);
    setEmitindo(proposta.id);

    try {
      const contrato = contratoApolice(proposta.enderecoApolice, signatario);

      setAviso("Confirme o deposito da garantia na carteira…");
      const transacao = await contrato.depositarGarantia({
        value: BigInt(proposta.valorIndenizacaoWei),
      });

      const recibo = await transacao.wait();

      atualizarProposta(proposta.id, {
        txGarantia: recibo.hash,
        garantiaDepositadaEm: new Date().toISOString(),
      });

      setAviso(
        `Garantia de ${emEth(proposta.valorIndenizacaoWei)} depositada. A apolice esta ativa e pronta para receber indices do oraculo.`,
      );
      recarregar();
    } catch (falha) {
      setErro(mensagemDeErro(falha));
    } finally {
      setEmitindo(null);
    }
  }

  function recusar(proposta) {
    atualizarProposta(proposta.id, { situacao: SITUACAO_PROPOSTA.RECUSADA });
    recarregar();
  }

  const carteiraErrada =
    conta && seguradoraDaFabrica && conta.toLowerCase() !== seguradoraDaFabrica.toLowerCase();

  return (
    <div className="pagina">
      <h1>Propostas</h1>
      <p className="silencioso">
        Emitir a apolice implanta um contrato novo na rede, parametrizado com a condicao contratada
        e com a carteira do produtor (RF07).
      </p>

      {erro ? <Aviso tipo="erro">{erro}</Aviso> : null}
      {aviso ? <Aviso tipo="sucesso">{aviso}</Aviso> : null}

      {!conta ? (
        <Aviso tipo="alerta" titulo="Carteira nao conectada.">
          <p>A emissao exige a assinatura da carteira da seguradora.</p>
          <button className="secundario pequeno" onClick={conectar}>
            Conectar carteira
          </button>
        </Aviso>
      ) : !redeCorreta ? (
        <Aviso tipo="alerta" titulo="Carteira em outra rede.">
          <p>
            O aplicativo opera em <strong>{rede.nome}</strong>.
          </p>
          <button className="secundario pequeno" onClick={trocarDeRede}>
            Trocar para {rede.nome}
          </button>
        </Aviso>
      ) : carteiraErrada ? (
        <Aviso tipo="erro" titulo="Esta carteira nao e a seguradora da fabrica.">
          A fabrica so aceita emissao de <span className="mono">{seguradoraDaFabrica}</span>.
          Qualquer outro endereco tem a transacao revertida com <code>NaoEhSeguradora</code> — esse
          e o controle de acesso do RNF12 funcionando.
        </Aviso>
      ) : null}

      {propostas.length === 0 ? (
        <div className="cartao">
          <p>Nenhuma proposta recebida.</p>
          <p className="silencioso">
            O produtor envia propostas pela tela de cotacao. Entre com o perfil de produtor para
            criar uma.
          </p>
        </div>
      ) : (
        propostas.map((proposta) => {
          const jaEmitida = proposta.situacao === SITUACAO_PROPOSTA.EMITIDA;
          const jaGarantida = Boolean(proposta.txGarantia);
          const ocupada = emitindo === proposta.id;

          return (
            <div className="cartao" key={proposta.id}>
              <div className="entre">
                <h2>
                  {proposta.talhaoNome} — {proposta.produtoNome}
                </h2>
                <Selo
                  tipo={
                    proposta.situacao === SITUACAO_PROPOSTA.EMITIDA
                      ? "sucesso"
                      : proposta.situacao === SITUACAO_PROPOSTA.RECUSADA
                        ? "erro"
                        : "alerta"
                  }
                >
                  {proposta.situacao}
                </Selo>
              </div>

              <div className="tabela-rolavel">
                <table>
                  <tbody>
                    <tr>
                      <th>Produtor</th>
                      <td>
                        {proposta.produtorNome} —{" "}
                        <LinkDaCadeia valor={proposta.carteiraProdutor} tipo="address" />
                      </td>
                    </tr>
                    <tr>
                      <th>Talhao</th>
                      <td>
                        {proposta.areaHa} ha de {proposta.cultura} em {proposta.municipio}
                      </td>
                    </tr>
                    <tr>
                      <th>Condicao</th>
                      <td>
                        {proposta.limiarClimatico} dias consecutivos sem chuva
                        {proposta.limiarDanoBps > 0
                          ? ` ou ${proposta.limiarDanoBps / 100}% de dano`
                          : ""}
                      </td>
                    </tr>
                    <tr>
                      <th>Limite</th>
                      <td>{emEth(proposta.valorIndenizacaoWei)}</td>
                    </tr>
                    <tr>
                      <th>Premio</th>
                      <td>{emEth(proposta.premioWei)}</td>
                    </tr>
                    <tr>
                      <th>Vigencia</th>
                      <td>{proposta.vigenciaDias} dias</td>
                    </tr>
                    {jaEmitida ? (
                      <>
                        <tr>
                          <th>Contrato</th>
                          <td>
                            <LinkDaCadeia
                              valor={proposta.enderecoApolice}
                              tipo="address"
                              curto={false}
                            />
                          </td>
                        </tr>
                        <tr>
                          <th>Transacao da emissao</th>
                          <td>
                            <LinkDaCadeia valor={proposta.txEmissao} tipo="tx" /> · gas{" "}
                            {proposta.gasEmissao}
                          </td>
                        </tr>
                      </>
                    ) : null}
                  </tbody>
                </table>
              </div>

              <div className="linha-de-botoes" style={{ marginTop: 14 }}>
                {proposta.situacao === SITUACAO_PROPOSTA.PENDENTE ? (
                  <>
                    <button
                      onClick={() => emitir(proposta)}
                      disabled={ocupada || !signatario || carteiraErrada || !redeCorreta}
                    >
                      {ocupada ? "Aguardando a carteira…" : "Emitir apolice na rede"}
                    </button>
                    <button className="perigo" onClick={() => recusar(proposta)} disabled={ocupada}>
                      Recusar
                    </button>
                  </>
                ) : null}

                {jaEmitida && !jaGarantida ? (
                  <button onClick={() => depositar(proposta)} disabled={ocupada || !signatario}>
                    {ocupada
                      ? "Aguardando a carteira…"
                      : `Depositar garantia de ${emEth(proposta.valorIndenizacaoWei)}`}
                  </button>
                ) : null}

                {jaEmitida ? (
                  <Link to={`/apolice/${proposta.enderecoApolice}`}>Ver apolice</Link>
                ) : null}
              </div>
            </div>
          );
        })
      )}

      <NotaDePrototipo>
        As propostas vivem no <code>localStorage</code> deste navegador. Para a demonstracao,
        produtor e seguradora precisam usar o mesmo navegador — basta sair de um perfil e entrar no
        outro. O banco compartilhado entra na Sprint 2.
      </NotaDePrototipo>
    </div>
  );
}
