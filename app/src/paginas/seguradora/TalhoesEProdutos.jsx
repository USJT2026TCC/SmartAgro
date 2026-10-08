import { useCallback, useEffect, useState } from "react";

import { api } from "../../api/cliente";
import { MODO_PAGAMENTO, OPERADOR } from "../../cadeia/regraDeGatilho";
import { Aviso, Campo, Carregando, RodapeDaFronteira, Selo } from "../../componentes/ui";
import DesenhoDoTalhao, { anelDoGeoJson } from "../../componentes/DesenhoDoTalhao";

/**
 * Cadastro de produtores, propriedades e talhoes, e configuracao de produtos
 * indexados (RF03, RF05, UC02, UC03, HU09).
 *
 * O talhao e desenhado no mapa ou importado de um arquivo GeoJSON (HU09,
 * criterio 1); a lista de pares continua editavel para quem preferir digitar.
 *
 * A geometria e toda do servidor. O poligono vai como lista de pares ou GeoJSON;
 * o PostGIS recusa autointersecao (ST_IsValid) e mede a area sobre o elipsoide
 * (ST_Area em geography). A versao anterior desta tela calculava a area no
 * navegador, com uma aproximacao plana que inflava o talhao em cerca de 7%.
 *
 * As regras de produto sao conferidas duas vezes no servidor: pela rota e por
 * restricoes CHECK no banco, que repetem as validacoes do construtor do contrato.
 */

const POLIGONO_EXEMPLO = JSON.stringify([
  [-47.81, -21.17],
  [-47.79, -21.17],
  [-47.79, -21.19],
  [-47.81, -21.19],
]);

/** Pares [lon, lat] do texto do poligono, ou lista vazia se o texto nao for valido. */
function verticesDoTexto(texto) {
  try {
    const valor = JSON.parse(texto);
    if (Array.isArray(valor)) return valor.filter((par) => Array.isArray(par) && par.length === 2);
    return anelDoGeoJson(valor);
  } catch {
    return [];
  }
}

/** Le um arquivo GeoJSON escolhido pelo usuario e devolve o texto do anel. */
async function lerArquivoGeoJson(arquivo) {
  const anel = anelDoGeoJson(await arquivo.text());
  return JSON.stringify(anel);
}

const PRODUTOR_INICIAL = { identificador: "", nome: "", documento: "", senhaInicial: "" };

const PRODUTO_INICIAL = {
  nome: "",
  cultura: "soja",
  operador: OPERADOR.CLIMATICO,
  modoPagamento: MODO_PAGAMENTO.INTEGRAL,
  limiarClimatico: 30,
  limiarClimaticoIntegral: 60,
  limiarDanoBps: 0,
  limiarDanoIntegralBps: 0,
  valorPorHectareEth: "0.006",
  vigenciaDias: 180,
  taxaPremioPct: "4.5",
};

export default function TalhoesEProdutos() {
  const [talhoes, setTalhoes] = useState(null);
  const [produtos, setProdutos] = useState([]);
  const [produtores, setProdutores] = useState([]);
  const [propriedades, setPropriedades] = useState([]);
  const [novoProdutor, setNovoProdutor] = useState(PRODUTOR_INICIAL);
  const [editandoTalhao, setEditandoTalhao] = useState(null);
  const [edicoes, setEdicoes] = useState({});
  const [erro, setErro] = useState(null);
  const [aviso, setAviso] = useState(null);

  const [talhao, setTalhao] = useState({
    produtorId: "",
    identificador: "",
    propriedade: "",
    municipio: "",
    cultura: "soja",
    poligono: POLIGONO_EXEMPLO,
  });

  const [produto, setProduto] = useState(PRODUTO_INICIAL);

  const carregar = useCallback(async () => {
    try {
      const [t, p, pr, pp] = await Promise.all([
        api("/talhoes"),
        api("/produtos"),
        api("/produtores"),
        api("/propriedades"),
      ]);
      setTalhoes(t.talhoes);
      setProdutos(p.produtos);
      setProdutores(pr.produtores);
      setPropriedades(pp.propriedades);
      setTalhao((atual) => ({
        ...atual,
        produtorId: atual.produtorId || pr.produtores[0]?.id || "",
      }));
    } catch (falha) {
      setErro(falha.message);
    }
  }, []);

  useEffect(() => {
    carregar();
  }, [carregar]);

  async function gravarTalhao(evento) {
    evento.preventDefault();
    setErro(null);
    setAviso(null);

    let poligono;

    try {
      poligono = JSON.parse(talhao.poligono);
    } catch {
      setErro(
        "O poligono precisa ser JSON valido: [[lon, lat], [lon, lat], …] ou um GeoJSON Polygon.",
      );
      return;
    }

    try {
      const { talhao: criado } = await api("/talhoes", {
        metodo: "POST",
        corpo: {
          produtorId: talhao.produtorId,
          identificador: talhao.identificador,
          cultura: talhao.cultura,
          propriedade: { nome: talhao.propriedade, municipio: talhao.municipio },
          poligono,
        },
      });

      setAviso(
        `Talhao ${criado.identificador} salvo. Area medida pelo PostGIS: ${Number(criado.areaHa).toFixed(2)} ha.`,
      );
      setTalhao({ ...talhao, identificador: "" });
      await carregar();
    } catch (falha) {
      setErro(falha.message);
    }
  }

  async function cadastrarProdutor(evento) {
    evento.preventDefault();
    setErro(null);
    setAviso(null);

    try {
      const { produtor } = await api("/produtores", { metodo: "POST", corpo: novoProdutor });
      setAviso(
        `Produtor ${produtor.nome} cadastrado. Entregue a senha inicial a ele por um canal seguro.`,
      );
      setNovoProdutor(PRODUTOR_INICIAL);
      await carregar();
    } catch (falha) {
      setErro(falha.message);
    }
  }

  /** Grava a edicao de um produtor ou de uma propriedade (RF03). */
  async function salvarEdicao(tipo, id) {
    setErro(null);
    setAviso(null);

    try {
      await api(`/${tipo}/${id}`, { metodo: "PATCH", corpo: edicoes[`${tipo}:${id}`] ?? {} });
      setAviso("Alteracao salva.");
      setEdicoes({ ...edicoes, [`${tipo}:${id}`]: undefined });
      await carregar();
    } catch (falha) {
      setErro(falha.message);
    }
  }

  const editar = (tipo, id, campo) => (e) =>
    setEdicoes({
      ...edicoes,
      [`${tipo}:${id}`]: { ...(edicoes[`${tipo}:${id}`] ?? {}), [campo]: e.target.value },
    });

  async function salvarTalhaoEditado() {
    setErro(null);
    setAviso(null);

    try {
      const { talhao: salvo } = await api(`/talhoes/${editandoTalhao.id}`, {
        metodo: "PATCH",
        corpo: { cultura: editandoTalhao.cultura, poligono: JSON.parse(editandoTalhao.poligono) },
      });
      setAviso(
        `Talhao ${salvo.identificador} atualizado. Area: ${Number(salvo.areaHa).toFixed(2)} ha.`,
      );
      setEditandoTalhao(null);
      await carregar();
    } catch (falha) {
      setErro(falha.message);
    }
  }

  async function removerTalhao(id) {
    setErro(null);
    try {
      await api(`/talhoes/${id}`, { metodo: "DELETE" });
      await carregar();
    } catch (falha) {
      setErro(falha.message);
    }
  }

  async function gravarProduto(evento) {
    evento.preventDefault();
    setErro(null);
    setAviso(null);

    try {
      const { produto: criado } = await api("/produtos", {
        metodo: "POST",
        corpo: {
          ...produto,
          operador: Number(produto.operador),
          modoPagamento: Number(produto.modoPagamento),
          limiarClimatico: Number(produto.limiarClimatico),
          limiarClimaticoIntegral: Number(produto.limiarClimaticoIntegral),
          limiarDanoBps: Number(produto.limiarDanoBps),
          limiarDanoIntegralBps: Number(produto.limiarDanoIntegralBps),
          vigenciaDias: Number(produto.vigenciaDias),
        },
      });

      setAviso(`Produto ${criado.nome} disponivel para contratacao.`);
      setProduto({ ...produto, nome: "" });
      await carregar();
    } catch (falha) {
      setErro(falha.message);
    }
  }

  async function retirarProduto(id) {
    setErro(null);
    try {
      await api(`/produtos/${id}`, { metodo: "DELETE" });
      await carregar();
    } catch (falha) {
      setErro(falha.message);
    }
  }

  const escalonado = Number(produto.modoPagamento) === MODO_PAGAMENTO.ESCALONADO;
  const usaDano = Number(produto.operador) !== OPERADOR.CLIMATICO;

  return (
    <div className="pagina">
      <h1>Talhoes e produtos</h1>
      <p className="silencioso">
        O talhao delimita o que pode ser segurado; o produto define a condicao, o limite e a
        vigencia oferecidos.
      </p>

      {erro ? <Aviso tipo="erro">{erro}</Aviso> : null}
      {aviso ? <Aviso tipo="sucesso">{aviso}</Aviso> : null}

      <div className="grade-2">
        <form className="cartao" onSubmit={cadastrarProdutor}>
          <h2>Cadastrar produtor</h2>
          <div className="grade">
            <Campo rotulo="Identificador de acesso" htmlFor="novo-identificador">
              <input
                id="novo-identificador"
                value={novoProdutor.identificador}
                onChange={(e) =>
                  setNovoProdutor({ ...novoProdutor, identificador: e.target.value })
                }
                placeholder="maria.silva"
              />
            </Campo>
            <Campo rotulo="Nome" htmlFor="novo-nome">
              <input
                id="novo-nome"
                value={novoProdutor.nome}
                onChange={(e) => setNovoProdutor({ ...novoProdutor, nome: e.target.value })}
              />
            </Campo>
            <Campo rotulo="CPF ou CNPJ" htmlFor="novo-documento">
              <input
                id="novo-documento"
                value={novoProdutor.documento}
                onChange={(e) => setNovoProdutor({ ...novoProdutor, documento: e.target.value })}
              />
            </Campo>
            <Campo
              rotulo="Senha inicial"
              htmlFor="novo-senha"
              ajuda="Ao menos 10 caracteres. Guardada so como hash bcrypt."
            >
              <input
                id="novo-senha"
                type="password"
                autoComplete="new-password"
                value={novoProdutor.senhaInicial}
                onChange={(e) => setNovoProdutor({ ...novoProdutor, senhaInicial: e.target.value })}
              />
            </Campo>
          </div>
          <button type="submit">Cadastrar produtor</button>
        </form>

        <div className="cartao tabela-rolavel">
          <h2>Produtores e propriedades</h2>
          <table>
            <thead>
              <tr>
                <th>Produtor</th>
                <th>Documento</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {produtores.map((p) => (
                <tr key={p.id}>
                  <td>
                    <input
                      aria-label={`Nome de ${p.identificador}`}
                      defaultValue={p.nome}
                      onChange={editar("produtores", p.id, "nome")}
                    />
                    <div className="silencioso">{p.identificador}</div>
                  </td>
                  <td>
                    <input
                      aria-label={`Documento de ${p.identificador}`}
                      defaultValue={p.documento ?? ""}
                      onChange={editar("produtores", p.id, "documento")}
                    />
                  </td>
                  <td>
                    <button
                      className="secundario pequeno"
                      disabled={!edicoes[`produtores:${p.id}`]}
                      onClick={() => salvarEdicao("produtores", p.id)}
                    >
                      Salvar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <table>
            <thead>
              <tr>
                <th>Propriedade</th>
                <th>Municipio</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {propriedades.map((pp) => (
                <tr key={pp.id}>
                  <td>
                    <input
                      aria-label={`Nome da propriedade ${pp.nome}`}
                      defaultValue={pp.nome}
                      onChange={editar("propriedades", pp.id, "nome")}
                    />
                    <div className="silencioso">
                      {pp.produtor_nome} · {pp.talhoes} talhao(oes)
                    </div>
                  </td>
                  <td>
                    <input
                      aria-label={`Municipio de ${pp.nome}`}
                      defaultValue={pp.municipio}
                      onChange={editar("propriedades", pp.id, "municipio")}
                    />
                  </td>
                  <td>
                    <button
                      className="secundario pequeno"
                      disabled={!edicoes[`propriedades:${pp.id}`]}
                      onClick={() => salvarEdicao("propriedades", pp.id)}
                    >
                      Salvar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grade-2">
        <form className="cartao" onSubmit={gravarTalhao}>
          <h2>Cadastrar talhao</h2>

          <Campo rotulo="Produtor" htmlFor="produtor">
            <select
              id="produtor"
              value={talhao.produtorId}
              onChange={(e) => setTalhao({ ...talhao, produtorId: e.target.value })}
            >
              {produtores.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nome} ({p.identificador})
                </option>
              ))}
            </select>
          </Campo>

          <Campo
            rotulo="Identificador"
            htmlFor="identificador"
            ajuda="Vai para a cadeia como bytes32: ate 31 bytes, sem acentos."
          >
            <input
              id="identificador"
              value={talhao.identificador}
              onChange={(e) => setTalhao({ ...talhao, identificador: e.target.value })}
              placeholder="talhao-03"
            />
          </Campo>

          <div className="grade">
            <Campo rotulo="Propriedade" htmlFor="propriedade">
              <input
                id="propriedade"
                value={talhao.propriedade}
                onChange={(e) => setTalhao({ ...talhao, propriedade: e.target.value })}
                placeholder="Fazenda Santa Clara"
              />
            </Campo>

            <Campo rotulo="Municipio" htmlFor="municipio">
              <input
                id="municipio"
                value={talhao.municipio}
                onChange={(e) => setTalhao({ ...talhao, municipio: e.target.value })}
                placeholder="Ribeirao Preto/SP"
              />
            </Campo>
          </div>

          <Campo rotulo="Cultura" htmlFor="cultura-talhao">
            <select
              id="cultura-talhao"
              value={talhao.cultura}
              onChange={(e) => setTalhao({ ...talhao, cultura: e.target.value })}
            >
              <option value="soja">soja</option>
              <option value="milho">milho</option>
              <option value="cafe">cafe</option>
              <option value="cana">cana</option>
            </select>
          </Campo>

          <Campo
            rotulo="Poligono"
            ajuda="Desenhe no mapa, importe um GeoJSON ou edite a lista de pares [longitude, latitude]. O anel e fechado automaticamente, e a validade e a area sao decididas pelo PostGIS."
          >
            <DesenhoDoTalhao
              vertices={verticesDoTexto(talhao.poligono)}
              aoMudar={(v) => setTalhao({ ...talhao, poligono: JSON.stringify(v) })}
            />
          </Campo>

          <Campo rotulo="Importar GeoJSON" htmlFor="geojson">
            <input
              id="geojson"
              type="file"
              accept=".geojson,.json,application/geo+json,application/json"
              onChange={async (e) => {
                const arquivo = e.target.files?.[0];
                if (!arquivo) return;
                try {
                  setTalhao({ ...talhao, poligono: await lerArquivoGeoJson(arquivo) });
                  setErro(null);
                } catch (falha) {
                  setErro(falha.message);
                }
              }}
            />
          </Campo>

          <Campo rotulo="Vertices (lon, lat)" htmlFor="poligono">
            <textarea
              id="poligono"
              rows={3}
              className="mono"
              value={talhao.poligono}
              onChange={(e) => setTalhao({ ...talhao, poligono: e.target.value })}
            />
          </Campo>

          <button type="submit">Salvar talhao</button>
        </form>

        <form className="cartao" onSubmit={gravarProduto}>
          <h2>Configurar produto indexado</h2>

          <Campo rotulo="Nome" htmlFor="nome-produto">
            <input
              id="nome-produto"
              value={produto.nome}
              onChange={(e) => setProduto({ ...produto, nome: e.target.value })}
              placeholder="Estiagem — cafe"
            />
          </Campo>

          <div className="grade">
            <Campo rotulo="Cultura" htmlFor="cultura-produto">
              <select
                id="cultura-produto"
                value={produto.cultura}
                onChange={(e) => setProduto({ ...produto, cultura: e.target.value })}
              >
                <option value="soja">soja</option>
                <option value="milho">milho</option>
                <option value="cafe">cafe</option>
                <option value="cana">cana</option>
              </select>
            </Campo>

            <Campo rotulo="Operador da condicao" htmlFor="operador">
              <select
                id="operador"
                value={produto.operador}
                onChange={(e) => setProduto({ ...produto, operador: Number(e.target.value) })}
              >
                <option value={OPERADOR.CLIMATICO}>Somente clima</option>
                <option value={OPERADOR.DANO}>Somente dano por imagem</option>
                <option value={OPERADOR.OU}>Clima OU dano</option>
                <option value={OPERADOR.E}>Clima E dano</option>
              </select>
            </Campo>

            <Campo rotulo="Modo de pagamento" htmlFor="modo">
              <select
                id="modo"
                value={produto.modoPagamento}
                onChange={(e) => setProduto({ ...produto, modoPagamento: Number(e.target.value) })}
              >
                <option value={MODO_PAGAMENTO.INTEGRAL}>Integral</option>
                <option value={MODO_PAGAMENTO.ESCALONADO}>Escalonado por severidade</option>
              </select>
            </Campo>

            <Campo rotulo="Gatilho (dias sem chuva)" htmlFor="limiar">
              <input
                id="limiar"
                type="number"
                min="0"
                value={produto.limiarClimatico}
                onChange={(e) => setProduto({ ...produto, limiarClimatico: e.target.value })}
                disabled={Number(produto.operador) === OPERADOR.DANO}
              />
            </Campo>

            <Campo rotulo="Dias para pagar 100%" htmlFor="limiar-integral">
              <input
                id="limiar-integral"
                type="number"
                min="0"
                value={produto.limiarClimaticoIntegral}
                onChange={(e) =>
                  setProduto({ ...produto, limiarClimaticoIntegral: e.target.value })
                }
                disabled={!escalonado}
              />
            </Campo>

            <Campo rotulo="Gatilho de dano (bps)" htmlFor="dano">
              <input
                id="dano"
                type="number"
                min="0"
                max="10000"
                value={produto.limiarDanoBps}
                onChange={(e) => setProduto({ ...produto, limiarDanoBps: e.target.value })}
                disabled={!usaDano}
              />
            </Campo>

            <Campo rotulo="Dano para 100% (bps)" htmlFor="dano-integral">
              <input
                id="dano-integral"
                type="number"
                min="0"
                max="10000"
                value={produto.limiarDanoIntegralBps}
                onChange={(e) => setProduto({ ...produto, limiarDanoIntegralBps: e.target.value })}
                disabled={!usaDano || !escalonado}
              />
            </Campo>

            <Campo rotulo="Limite por hectare (ETH)" htmlFor="valor-ha">
              <input
                id="valor-ha"
                inputMode="decimal"
                value={produto.valorPorHectareEth}
                onChange={(e) => setProduto({ ...produto, valorPorHectareEth: e.target.value })}
              />
            </Campo>

            <Campo rotulo="Taxa do premio (%)" htmlFor="taxa">
              <input
                id="taxa"
                inputMode="decimal"
                value={produto.taxaPremioPct}
                onChange={(e) => setProduto({ ...produto, taxaPremioPct: e.target.value })}
              />
            </Campo>

            <Campo rotulo="Vigencia (dias)" htmlFor="vigencia">
              <input
                id="vigencia"
                type="number"
                min="1"
                value={produto.vigenciaDias}
                onChange={(e) => setProduto({ ...produto, vigenciaDias: e.target.value })}
              />
            </Campo>
          </div>

          <button type="submit">Salvar produto</button>
        </form>
      </div>

      {talhoes === null ? (
        <Carregando />
      ) : (
        <div className="cartao tabela-rolavel">
          <h2>Talhoes cadastrados</h2>
          <table>
            <thead>
              <tr>
                <th>Identificador</th>
                <th>Produtor e propriedade</th>
                <th>Cultura</th>
                <th className="numero">Area</th>
                <th>Fontes</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {talhoes.map((t) => (
                <tr key={t.id}>
                  <td>{t.identificador}</td>
                  <td>
                    {t.produtor.nome}
                    <div className="silencioso">
                      {t.propriedade.nome} — {t.propriedade.municipio}
                    </div>
                  </td>
                  <td>{t.cultura}</td>
                  <td className="numero">{Number(t.areaHa).toFixed(2)} ha</td>
                  <td>
                    {t.atendeMinimoDeFontes ? (
                      <Selo tipo="sucesso">{t.fontesAtivas} ativas</Selo>
                    ) : (
                      <Selo tipo="alerta">{t.fontesAtivas} — abaixo do minimo</Selo>
                    )}
                  </td>
                  <td>
                    <div className="linha-de-botoes">
                      <button
                        className="secundario pequeno"
                        onClick={() =>
                          setEditandoTalhao({
                            id: t.id,
                            identificador: t.identificador,
                            cultura: t.cultura,
                            poligono: JSON.stringify(anelDoGeoJson(t.poligono)),
                          })
                        }
                      >
                        Editar
                      </button>
                      <button className="perigo pequeno" onClick={() => removerTalhao(t.id)}>
                        Remover
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {editandoTalhao ? (
            <div className="cartao">
              <h3>Editar {editandoTalhao.identificador}</h3>
              <p className="silencioso">
                So e possivel enquanto o talhao nao tem proposta nem apolice: depois, a area cotada
                e o poligono que recusa fotos de fora fazem parte do que foi contratado.
              </p>
              <Campo rotulo="Cultura" htmlFor="cultura-edicao">
                <select
                  id="cultura-edicao"
                  value={editandoTalhao.cultura}
                  onChange={(e) =>
                    setEditandoTalhao({ ...editandoTalhao, cultura: e.target.value })
                  }
                >
                  <option value="soja">soja</option>
                  <option value="milho">milho</option>
                  <option value="cafe">cafe</option>
                  <option value="cana">cana</option>
                </select>
              </Campo>
              <DesenhoDoTalhao
                vertices={verticesDoTexto(editandoTalhao.poligono)}
                aoMudar={(v) =>
                  setEditandoTalhao({ ...editandoTalhao, poligono: JSON.stringify(v) })
                }
              />
              <div className="linha-de-botoes">
                <button onClick={salvarTalhaoEditado}>Salvar talhao</button>
                <button className="secundario" onClick={() => setEditandoTalhao(null)}>
                  Cancelar
                </button>
              </div>
            </div>
          ) : null}

          <RodapeDaFronteira>
            Area calculada pelo PostGIS sobre o elipsoide. O RNF16 pede ao menos duas fontes
            independentes por talhao, ou evidencia por imagem obrigatoria.
          </RodapeDaFronteira>
        </div>
      )}

      <div className="cartao tabela-rolavel">
        <h2>Produtos disponiveis</h2>
        <table>
          <thead>
            <tr>
              <th>Nome</th>
              <th>Cultura</th>
              <th>Condicao</th>
              <th>Pagamento</th>
              <th className="numero">Limite/ha</th>
              <th className="numero">Taxa</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {produtos.map((p) => (
              <tr key={p.id}>
                <td>{p.nome}</td>
                <td>{p.cultura}</td>
                <td>
                  {p.limiarClimatico > 0 ? `${p.limiarClimatico} dias sem chuva` : null}
                  {p.limiarDanoBps > 0
                    ? `${p.limiarClimatico > 0 ? " ou " : ""}${p.limiarDanoBps / 100}% de dano`
                    : null}
                </td>
                <td>{p.modoPagamento === MODO_PAGAMENTO.INTEGRAL ? "Integral" : "Escalonado"}</td>
                <td className="numero">{p.valorPorHectareEth} ETH</td>
                <td className="numero">{p.taxaPremioBps / 100}%</td>
                <td>
                  <button className="perigo pequeno" onClick={() => retirarProduto(p.id)}>
                    Retirar
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
