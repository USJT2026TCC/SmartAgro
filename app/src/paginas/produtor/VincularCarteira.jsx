import { useEffect, useState } from "react";

import { useCarteira } from "../../cadeia/CarteiraContexto";
import { useSessao } from "../../sessao/SessaoContexto";
import { mensagemDeErro, emEth } from "../../cadeia/formatos";
import { Aviso, Campo, LinkDaCadeia, NotaDePrototipo } from "../../componentes/ui";

const CHAVE_VINCULO = "agrosmart:vinculo-de-carteira";

/**
 * Vinculacao da carteira ao cadastro por assinatura de mensagem (RF02, HU07).
 *
 * O ponto da tela e provar a titularidade sem nunca tocar na chave privada. O
 * aplicativo monta um desafio unico, a carteira assina, e a assinatura e conferida
 * recuperando o endereco que a produziu. Se o endereco recuperado for o mesmo que
 * esta conectado, quem assinou detem a chave — sem que a chave saia da carteira.
 *
 * O numero unico dentro do desafio existe para que uma assinatura capturada de uma
 * sessao anterior nao possa ser reapresentada como se fosse nova.
 */
export default function VincularCarteira() {
  const { usuario } = useSessao();
  const {
    conta,
    temCarteira,
    conectar,
    conectando,
    redeCorreta,
    rede,
    trocarDeRede,
    assinarVinculo,
    provedorLeitura,
  } = useCarteira();

  const [vinculo, setVinculo] = useState(null);
  const [saldo, setSaldo] = useState(null);
  const [erro, setErro] = useState(null);
  const [assinando, setAssinando] = useState(false);

  useEffect(() => {
    try {
      const guardado = localStorage.getItem(CHAVE_VINCULO);
      if (guardado) setVinculo(JSON.parse(guardado));
    } catch {
      localStorage.removeItem(CHAVE_VINCULO);
    }
  }, []);

  useEffect(() => {
    if (!conta) {
      setSaldo(null);
      return;
    }

    provedorLeitura
      .getBalance(conta)
      .then(setSaldo)
      .catch(() => setSaldo(null));
  }, [conta, provedorLeitura]);

  async function vincular() {
    setErro(null);
    setAssinando(true);

    try {
      const resultado = await assinarVinculo(usuario.identificador);
      const registro = {
        ...resultado,
        usuario: usuario.identificador,
        vinculadoEm: new Date().toISOString(),
      };

      localStorage.setItem(CHAVE_VINCULO, JSON.stringify(registro));
      setVinculo(registro);
    } catch (falha) {
      setErro(mensagemDeErro(falha));
    } finally {
      setAssinando(false);
    }
  }

  function desvincular() {
    localStorage.removeItem(CHAVE_VINCULO);
    setVinculo(null);
  }

  const vinculoDesatualizado =
    vinculo && conta && vinculo.endereco.toLowerCase() !== conta.toLowerCase();

  return (
    <div className="pagina" style={{ maxWidth: 760 }}>
      <h1>Minha carteira</h1>
      <p className="silencioso">
        A indenizacao e transferida diretamente para a carteira vinculada. Nenhuma outra etapa entra
        no caminho do pagamento.
      </p>

      {erro ? <Aviso tipo="erro">{erro}</Aviso> : null}

      <div className="cartao">
        <h2>Carteira conectada</h2>

        {!temCarteira ? (
          <Aviso tipo="alerta" titulo="Nenhuma carteira encontrada no navegador.">
            Instale a extensao MetaMask e recarregue a pagina.
          </Aviso>
        ) : !conta ? (
          <>
            <p>Conecte a carteira para comprovar a titularidade do endereco.</p>
            <button onClick={conectar} disabled={conectando}>
              {conectando ? "Conectando…" : "Conectar carteira"}
            </button>
          </>
        ) : (
          <>
            <Campo rotulo="Endereco">
              <div className="mono">{conta}</div>
            </Campo>

            <Campo rotulo="Saldo">
              <div>{saldo === null ? "—" : emEth(saldo)}</div>
            </Campo>

            {!redeCorreta ? (
              <Aviso tipo="alerta" titulo="Carteira em outra rede.">
                <p>
                  O aplicativo opera em <strong>{rede.nome}</strong>. Troque a rede na carteira para
                  acompanhar as apolices.
                </p>
                <button className="secundario pequeno" onClick={trocarDeRede}>
                  Trocar para {rede.nome}
                </button>
              </Aviso>
            ) : null}
          </>
        )}
      </div>

      <div className="cartao">
        <h2>Vinculo por assinatura</h2>

        {vinculo && !vinculoDesatualizado ? (
          <>
            <Aviso tipo="sucesso" titulo="Titularidade comprovada.">
              A assinatura foi conferida e corresponde ao endereco conectado.
            </Aviso>

            <Campo rotulo="Endereco vinculado">
              <LinkDaCadeia valor={vinculo.endereco} tipo="address" curto={false} />
            </Campo>

            <Campo rotulo="Vinculado em">
              <div>{new Date(vinculo.vinculadoEm).toLocaleString("pt-BR")}</div>
            </Campo>

            <Campo
              rotulo="Mensagem assinada"
              ajuda="O numero unico impede que uma assinatura antiga seja reapresentada."
            >
              <textarea readOnly rows={5} value={vinculo.desafio} className="mono" />
            </Campo>

            <Campo rotulo="Assinatura">
              <textarea readOnly rows={3} value={vinculo.assinatura} className="mono" />
            </Campo>

            <button className="perigo" onClick={desvincular}>
              Desvincular
            </button>
          </>
        ) : (
          <>
            {vinculoDesatualizado ? (
              <Aviso tipo="alerta" titulo="A carteira conectada mudou.">
                O vinculo registrado aponta para outro endereco. Assine de novo para atualizar.
              </Aviso>
            ) : null}

            <p>
              O aplicativo vai pedir a assinatura de uma mensagem. Assinar <strong>nao</strong>{" "}
              movimenta valor, nao custa gas e nao autoriza nenhuma transacao: serve apenas para
              provar que voce controla a chave desse endereco.
            </p>

            <button onClick={vincular} disabled={!conta || assinando}>
              {assinando ? "Aguardando a carteira…" : "Assinar e vincular"}
            </button>
          </>
        )}
      </div>

      <NotaDePrototipo>
        A assinatura e conferida no proprio navegador, porque ainda nao existe API. Isso prova a
        correspondencia entre assinatura e endereco, mas um cliente adulterado poderia mentir para
        si mesmo — a verificacao no servidor entra na Sprint 2. A chave privada nunca trafega nem e
        armazenada em nenhum dos dois casos (RNF17).
      </NotaDePrototipo>
    </div>
  );
}
