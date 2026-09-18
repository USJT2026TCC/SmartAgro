import { useCallback, useEffect, useState } from "react";
import { ethers } from "ethers";

import { useCarteira } from "../../cadeia/CarteiraContexto";
import { contratoRegistry, listarOraculos } from "../../cadeia/contratos";
import { mensagemDeErro } from "../../cadeia/formatos";
import { implantacaoDaRede } from "../../cadeia/rede";
import {
  Aviso,
  Campo,
  Carregando,
  LinkDaCadeia,
  RodapeDaFronteira,
  Selo,
} from "../../componentes/ui";

/**
 * Gestao dos enderecos autorizados a publicar indices (RF18, UC10, HU02).
 *
 * Esta e a tela mais sensivel do aplicativo. Autorizar um endereco aqui e dar a
 * ele o poder de publicar o indice que aciona o pagamento em todas as apolices da
 * carteira. Revogar tira esse poder de imediato, na transacao seguinte.
 *
 * E tambem onde a arquitetura fica visivel: a lista vive em um contrato separado,
 * entao uma unica transacao vale para toda a carteira. Se cada apolice guardasse a
 * propria lista, revogar um oraculo comprometido exigiria uma transacao por apolice.
 */
export default function Oraculos() {
  const { provedorLeitura, signatario, conta, redeCorreta, rede, trocarDeRede, conectar } =
    useCarteira();

  const [oraculos, setOraculos] = useState([]);
  const [seguradoraDoRegistro, setSeguradoraDoRegistro] = useState(null);
  const [novoEndereco, setNovoEndereco] = useState("");
  const [carregando, setCarregando] = useState(true);
  const [operando, setOperando] = useState(false);
  const [erro, setErro] = useState(null);
  const [aviso, setAviso] = useState(null);

  const implantacao = implantacaoDaRede();

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro(null);

    try {
      const registry = contratoRegistry(provedorLeitura);

      const [lista, dona] = await Promise.all([
        listarOraculos(provedorLeitura),
        registry.seguradora(),
      ]);

      setOraculos(lista);
      setSeguradoraDoRegistro(dona);
    } catch (falha) {
      setErro(mensagemDeErro(falha));
    } finally {
      setCarregando(false);
    }
  }, [provedorLeitura]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  async function executar(acao, endereco, mensagemDeSucesso) {
    setErro(null);
    setAviso(null);
    setOperando(true);

    try {
      const registry = contratoRegistry(signatario);
      const transacao = await registry[acao](endereco);

      setAviso(`Transacao enviada: ${transacao.hash}. Aguardando confirmacao…`);
      await transacao.wait();

      setAviso(mensagemDeSucesso);
      setNovoEndereco("");
      await carregar();
    } catch (falha) {
      setErro(mensagemDeErro(falha));
    } finally {
      setOperando(false);
    }
  }

  function autorizar(evento) {
    evento.preventDefault();

    if (!ethers.isAddress(novoEndereco)) {
      setErro("Endereco invalido. Um endereco tem 42 caracteres e comeca com 0x.");
      return;
    }

    executar(
      "autorizar",
      ethers.getAddress(novoEndereco),
      "Endereco autorizado. A partir de agora ele pode publicar indices em todas as apolices desta carteira.",
    );
  }

  const carteiraErrada =
    conta && seguradoraDoRegistro && conta.toLowerCase() !== seguradoraDoRegistro.toLowerCase();

  const podeOperar = Boolean(signatario) && redeCorreta && !carteiraErrada;

  return (
    <div className="pagina">
      <div className="entre">
        <h1>Oraculos autorizados</h1>
        <button className="secundario pequeno" onClick={carregar} disabled={carregando}>
          Atualizar
        </button>
      </div>

      <p className="silencioso">
        Somente estes enderecos conseguem publicar indices. Qualquer outro tem a transacao revertida
        com <code>OrigemNaoAutorizada</code>.
      </p>

      {erro ? <Aviso tipo="erro">{erro}</Aviso> : null}
      {aviso ? <Aviso tipo="sucesso">{aviso}</Aviso> : null}

      {!conta ? (
        <Aviso tipo="alerta" titulo="Carteira nao conectada.">
          <p>Autorizar ou revogar exige a assinatura da carteira da seguradora.</p>
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
        <Aviso tipo="erro" titulo="Esta carteira nao administra o registro.">
          Apenas <span className="mono">{seguradoraDoRegistro}</span> pode alterar a lista.
        </Aviso>
      ) : null}

      <div className="cartao">
        <h2>Lista atual</h2>

        {carregando ? (
          <Carregando />
        ) : oraculos.length === 0 ? (
          <p className="silencioso">
            Nenhum endereco jamais autorizado neste registro. Sem ao menos um, nenhuma apolice
            consegue receber indices.
          </p>
        ) : (
          <div className="tabela-rolavel">
            <table>
              <thead>
                <tr>
                  <th>Endereco</th>
                  <th>Situacao</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {oraculos.map((oraculo) => (
                  <tr key={oraculo.endereco}>
                    <td>
                      <LinkDaCadeia valor={oraculo.endereco} tipo="address" curto={false} />
                      {implantacao?.oraculoAutorizado?.toLowerCase() ===
                      oraculo.endereco.toLowerCase() ? (
                        <div className="silencioso">oraculo da implantacao</div>
                      ) : null}
                    </td>
                    <td>
                      {oraculo.autorizado ? (
                        <Selo tipo="sucesso">autorizado</Selo>
                      ) : (
                        <Selo tipo="neutro">revogado</Selo>
                      )}
                    </td>
                    <td>
                      {oraculo.autorizado ? (
                        <button
                          className="perigo pequeno"
                          disabled={!podeOperar || operando}
                          onClick={() =>
                            executar(
                              "revogar",
                              oraculo.endereco,
                              "Endereco revogado. A proxima tentativa de publicacao dele sera recusada pelo contrato.",
                            )
                          }
                        >
                          Revogar
                        </button>
                      ) : (
                        <button
                          className="secundario pequeno"
                          disabled={!podeOperar || operando}
                          onClick={() =>
                            executar("autorizar", oraculo.endereco, "Endereco reautorizado.")
                          }
                        >
                          Reautorizar
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <RodapeDaFronteira>
          A lista e lida dos eventos <code>OraculoAutorizado</code> e conferida contra o estado
          atual do contrato. O evento diz quem ja foi autorizado algum dia; so o estado diz quem
          ainda pode publicar.
        </RodapeDaFronteira>
      </div>

      <form className="cartao" onSubmit={autorizar}>
        <h2>Autorizar um endereco</h2>

        <Campo
          rotulo="Endereco do oraculo"
          htmlFor="endereco"
          ajuda="E o endereco da carteira que assina as publicacoes no servico de oraculo. Em rede local, a conta 2 do hardhat node."
        >
          <input
            id="endereco"
            className="mono"
            placeholder="0x…"
            value={novoEndereco}
            onChange={(e) => setNovoEndereco(e.target.value)}
          />
        </Campo>

        <Aviso tipo="alerta">
          Autorizar um endereco da a ele o poder de acionar o pagamento de qualquer apolice desta
          carteira. Confira o endereco caractere por caractere antes de confirmar.
        </Aviso>

        <button type="submit" disabled={!podeOperar || operando || !novoEndereco}>
          {operando ? "Aguardando a carteira…" : "Autorizar"}
        </button>
      </form>
    </div>
  );
}
