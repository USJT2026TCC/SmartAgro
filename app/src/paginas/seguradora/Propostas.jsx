import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { api } from "../../api/cliente";
import { useCarteira } from "../../cadeia/CarteiraContexto";
import { contratoApolice, contratoFactory } from "../../cadeia/contratos";
import { emEth, hashCurto, mensagemDeErro } from "../../cadeia/formatos";
import { Aviso, Carregando, LinkDaCadeia, Selo } from "../../componentes/ui";

/**
 * Emissao da apolice a partir de uma proposta (RF07, RF08, UC05).
 *
 * Tres passos, cada um com um responsavel diferente:
 *
 *  1. o BACKEND prepara: fixa a vigencia pelo relogio da cadeia, gera o texto
 *     canonico dos termos e o resumo que vai para o contrato;
 *  2. a CARTEIRA DA SEGURADORA assina `emitirApolice` — so ela pode, e o backend
 *     nao tem chave nenhuma;
 *  3. o BACKEND confere: le o recibo na cadeia e so aceita se o evento veio da
 *     fabrica oficial e o resumo gravado no contrato for o que ele gerou.
 *
 * Depois, a garantia e depositada — tambem pela carteira da seguradora.
 */

const ROTULOS = {
  pendente: ["alerta", "pendente"],
  preparada: ["informacao", "preparada, aguardando assinatura"],
  emitida: ["sucesso", "emitida"],
  recusada: ["erro", "recusada"],
};

export default function Propostas() {
  const { signatario, conta, provedorLeitura, redeCorreta, rede, trocarDeRede, conectar } =
    useCarteira();

  const [propostas, setPropostas] = useState(null);
  const [ocupada, setOcupada] = useState(null);
  const [erro, setErro] = useState(null);
  const [aviso, setAviso] = useState(null);
  const [seguradoraDaFabrica, setSeguradoraDaFabrica] = useState(null);
  const [garantidas, setGarantidas] = useState({});

  const carregar = useCallback(async () => {
    try {
      const { propostas: lista } = await api("/propostas");
      setPropostas(lista);

      // A situacao da garantia vive no contrato; o backend ve pelo indexador, mas
      // com alguns segundos de atraso. Ler direto evita um botao obsoleto na tela.
      const emitidas = lista.filter((p) => p.apolice);
      const situacoes = await Promise.all(
        emitidas.map(async (p) => [
          p.id,
          Number(await contratoApolice(p.apolice.endereco, provedorLeitura).situacao()),
        ]),
      );
      setGarantidas(Object.fromEntries(situacoes.map(([id, s]) => [id, s >= 1])));
    } catch (falha) {
      setErro(falha.message);
    }
  }, [provedorLeitura]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  useEffect(() => {
    try {
      contratoFactory(provedorLeitura)
        .seguradora()
        .then(setSeguradoraDaFabrica)
        .catch(() => setSeguradoraDaFabrica(null));
    } catch {
      setSeguradoraDaFabrica(null);
    }
  }, [provedorLeitura]);

  async function emitir(proposta) {
    setErro(null);
    setAviso(null);
    setOcupada(proposta.id);

    try {
      setAviso("1/3 · O servidor esta preparando os termos e o resumo criptografico…");
      const preparo = await api(`/propostas/${proposta.id}/preparar`, { metodo: "POST" });

      setAviso(
        `2/3 · Confirme a emissao na carteira. Resumo dos termos: ${hashCurto(preparo.hashTermos)}`,
      );
      const transacao = await contratoFactory(signatario).emitirApolice(preparo.termos);

      setAviso(`2/3 · Transacao enviada (${hashCurto(transacao.hash)}). Aguardando confirmacao…`);
      await transacao.wait();

      setAviso("3/3 · O servidor esta conferindo a emissao na cadeia…");
      const { apolice } = await api(`/propostas/${proposta.id}/emissao`, {
        metodo: "POST",
        corpo: { txHash: transacao.hash },
      });

      setAviso(
        `Apolice implantada em ${apolice.endereco} e conferida pelo servidor: o resumo gravado no contrato bate com os termos acordados. Falta depositar a garantia.`,
      );
      await carregar();
    } catch (falha) {
      setErro(falha.status !== undefined ? falha.message : mensagemDeErro(falha));
    } finally {
      setOcupada(null);
    }
  }

  async function depositar(proposta) {
    setErro(null);
    setAviso(null);
    setOcupada(proposta.id);

    try {
      setAviso("Confirme o deposito da garantia na carteira…");
      const transacao = await contratoApolice(
        proposta.apolice.endereco,
        signatario,
      ).depositarGarantia({
        value: BigInt(proposta.valorIndenizacaoWei),
      });
      await transacao.wait();

      setAviso(
        `Garantia de ${emEth(proposta.valorIndenizacaoWei)} depositada. A apolice esta ativa e pronta para receber indices do oraculo.`,
      );
      await carregar();
    } catch (falha) {
      setErro(mensagemDeErro(falha));
    } finally {
      setOcupada(null);
    }
  }

  async function recusar(proposta) {
    try {
      await api(`/propostas/${proposta.id}/recusar`, { metodo: "POST" });
      await carregar();
    } catch (falha) {
      setErro(falha.message);
    }
  }

  const carteiraErrada =
    conta && seguradoraDaFabrica && conta.toLowerCase() !== seguradoraDaFabrica.toLowerCase();

  const podeAssinar = Boolean(signatario) && redeCorreta && !carteiraErrada;

  return (
    <div className="pagina">
      <div className="entre">
        <h1>Propostas</h1>
        <button className="secundario pequeno" onClick={carregar}>
          Atualizar
        </button>
      </div>
      <p className="silencioso">
        Emitir implanta um contrato novo na rede. O servidor prepara os termos, a sua carteira
        assina, e o servidor confere na cadeia que o contrato implantado e o que foi acordado.
      </p>

      {erro ? <Aviso tipo="erro">{erro}</Aviso> : null}
      {aviso ? <Aviso tipo="informacao">{aviso}</Aviso> : null}

      {!conta ? (
        <Aviso tipo="alerta" titulo="Carteira nao conectada.">
          <p>A emissao exige a assinatura da carteira da seguradora.</p>
          <button className="secundario pequeno" onClick={conectar}>
            Conectar carteira
          </button>
        </Aviso>
      ) : !redeCorreta ? (
        <Aviso tipo="alerta" titulo="Carteira em outra rede.">
          <button className="secundario pequeno" onClick={trocarDeRede}>
            Trocar para {rede.nome}
          </button>
        </Aviso>
      ) : carteiraErrada ? (
        <Aviso tipo="erro" titulo="Esta carteira nao e a seguradora da fabrica.">
          A fabrica so aceita emissao de <span className="mono">{seguradoraDaFabrica}</span>.
          Qualquer outro endereco tem a transacao revertida com <code>NaoEhSeguradora</code> — o
          controle de acesso do RNF12 funcionando.
        </Aviso>
      ) : null}

      {propostas === null ? (
        <Carregando />
      ) : propostas.length === 0 ? (
        <div className="cartao">
          <p>Nenhuma proposta recebida.</p>
          <p className="silencioso">O produtor envia propostas pela tela de cotacao.</p>
        </div>
      ) : (
        propostas.map((p) => {
          const [cor, rotulo] = ROTULOS[p.situacao] ?? ["neutro", p.situacao];
          const aberta = p.situacao === "pendente" || p.situacao === "preparada";
          const semGarantia = p.apolice && !garantidas[p.id];
          const ocupadaAqui = ocupada === p.id;

          return (
            <div className="cartao" key={p.id}>
              <div className="entre">
                <h2>
                  {p.talhao.identificador} — {p.produto.nome}
                </h2>
                <Selo tipo={cor}>{rotulo}</Selo>
              </div>

              <div className="tabela-rolavel">
                <table>
                  <tbody>
                    <tr>
                      <th>Produtor</th>
                      <td>
                        {p.produtor.nome} —{" "}
                        <LinkDaCadeia valor={p.carteiraProdutor} tipo="address" />
                      </td>
                    </tr>
                    <tr>
                      <th>Area segurada</th>
                      <td>
                        {Number(p.areaSeguradaHa).toFixed(2)} ha de {p.talhao.cultura}
                      </td>
                    </tr>
                    <tr>
                      <th>Condicao</th>
                      <td>
                        {p.termos.limiarClimatico} dias consecutivos sem chuva
                        {p.termos.limiarDanoBps > 0
                          ? ` ou ${p.termos.limiarDanoBps / 100}% de dano`
                          : ""}
                      </td>
                    </tr>
                    <tr>
                      <th>Limite / premio</th>
                      <td>
                        {emEth(p.valorIndenizacaoWei)} / {emEth(p.premioWei)}
                      </td>
                    </tr>
                    {p.hashTermos ? (
                      <tr>
                        <th>Resumo dos termos</th>
                        <td className="mono" title={p.hashTermos}>
                          {hashCurto(p.hashTermos)}
                        </td>
                      </tr>
                    ) : null}
                    {p.apolice ? (
                      <tr>
                        <th>Contrato</th>
                        <td>
                          <LinkDaCadeia valor={p.apolice.endereco} tipo="address" curto={false} />
                          <div className="silencioso">
                            emissao <LinkDaCadeia valor={p.apolice.txEmissao} tipo="tx" />
                          </div>
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>

              <div className="linha-de-botoes" style={{ marginTop: 14 }}>
                {aberta ? (
                  <>
                    <button onClick={() => emitir(p)} disabled={ocupadaAqui || !podeAssinar}>
                      {ocupadaAqui ? "Emitindo…" : "Emitir apolice na rede"}
                    </button>
                    <button className="perigo" onClick={() => recusar(p)} disabled={ocupadaAqui}>
                      Recusar
                    </button>
                  </>
                ) : null}

                {semGarantia ? (
                  <button onClick={() => depositar(p)} disabled={ocupadaAqui || !podeAssinar}>
                    {ocupadaAqui
                      ? "Aguardando a carteira…"
                      : `Depositar garantia de ${emEth(p.valorIndenizacaoWei)}`}
                  </button>
                ) : null}

                {p.apolice ? <Link to={`/apolice/${p.apolice.endereco}`}>Ver apolice</Link> : null}
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
