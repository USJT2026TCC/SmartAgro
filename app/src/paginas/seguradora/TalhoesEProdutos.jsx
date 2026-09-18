import { useCallback, useEffect, useState } from "react";

import {
  aoMudarDados,
  listarProdutos,
  listarTalhoes,
  removerProduto,
  removerTalhao,
  salvarProduto,
  salvarTalhao,
} from "../../dados/armazenamentoLocal";
import { MODO_PAGAMENTO, OPERADOR } from "../../cadeia/regraDeGatilho";
import { Aviso, Campo, NotaDePrototipo } from "../../componentes/ui";

/**
 * Cadastro de talhoes e configuracao de produtos indexados (RF03, RF05, UC02, UC03).
 *
 * O poligono e informado em GeoJSON, como pede o criterio de aceite 1 da HU09. A
 * area e calculada a partir dele, e nao digitada: area informada a mao e area que
 * diverge do que foi delimitado, e o limite da apolice sai dessa conta.
 */

const AREA_POR_GRAU_QUADRADO_HA = 1_232_100; // aproximacao para a latitude do Brasil central

/**
 * Area do poligono em hectares, pela formula do laco (shoelace).
 *
 * E uma aproximacao: trata graus como plano cartesiano e usa um fator fixo de
 * conversao. Para um talhao de algumas centenas de hectares no interior paulista o
 * erro e pequeno, mas o calculo definitivo cabe ao PostGIS, na Sprint 2, que
 * trabalha sobre o elipsoide de verdade.
 */
function areaEmHectares(poligono) {
  if (!Array.isArray(poligono) || poligono.length < 3) return 0;

  let soma = 0;

  for (let i = 0; i < poligono.length; i += 1) {
    const [x1, y1] = poligono[i];
    const [x2, y2] = poligono[(i + 1) % poligono.length];

    soma += x1 * y2 - x2 * y1;
  }

  const emGrausQuadrados = Math.abs(soma) / 2;

  return Number((emGrausQuadrados * AREA_POR_GRAU_QUADRADO_HA).toFixed(1));
}

/**
 * Detecta autointersecao no poligono (criterio de aceite 3 da HU09).
 *
 * Um poligono que cruza a si mesmo nao tem area bem definida, e aceitar um
 * significaria emitir apolice sobre uma superficie que ninguem sabe medir.
 */
function temAutointersecao(poligono) {
  const cruzam = (p1, p2, p3, p4) => {
    const direcao = (a, b, c) => (c[1] - a[1]) * (b[0] - a[0]) - (b[1] - a[1]) * (c[0] - a[0]);

    const d1 = direcao(p3, p4, p1);
    const d2 = direcao(p3, p4, p2);
    const d3 = direcao(p1, p2, p3);
    const d4 = direcao(p1, p2, p4);

    return d1 > 0 !== d2 > 0 && d3 > 0 !== d4 > 0;
  };

  const n = poligono.length;

  for (let i = 0; i < n; i += 1) {
    for (let j = i + 1; j < n; j += 1) {
      // Lados vizinhos compartilham um vertice; encostar ali nao e cruzar.
      if (Math.abs(i - j) <= 1 || (i === 0 && j === n - 1)) continue;

      if (cruzam(poligono[i], poligono[(i + 1) % n], poligono[j], poligono[(j + 1) % n])) {
        return true;
      }
    }
  }

  return false;
}

const POLIGONO_EXEMPLO = JSON.stringify(
  [
    [-47.81, -21.17],
    [-47.79, -21.17],
    [-47.79, -21.19],
    [-47.81, -21.19],
  ],
  null,
  0,
);

export default function TalhoesEProdutos() {
  const [talhoes, setTalhoes] = useState([]);
  const [produtos, setProdutos] = useState([]);
  const [erro, setErro] = useState(null);
  const [aviso, setAviso] = useState(null);

  const [talhao, setTalhao] = useState({
    nome: "",
    propriedade: "",
    municipio: "",
    cultura: "soja",
    poligono: POLIGONO_EXEMPLO,
  });

  const [produto, setProduto] = useState({
    nome: "",
    cultura: "soja",
    operador: OPERADOR.CLIMATICO,
    modoPagamento: MODO_PAGAMENTO.INTEGRAL,
    limiarClimatico: 30,
    limiarClimaticoIntegral: 60,
    limiarDanoBps: 0,
    limiarDanoIntegralBps: 0,
    valorPorHectareEth: 0.006,
    vigenciaDias: 180,
    taxaPremioPct: 4.5,
  });

  const recarregar = useCallback(() => {
    setTalhoes(listarTalhoes());
    setProdutos(listarProdutos());
  }, []);

  useEffect(() => {
    recarregar();

    return aoMudarDados(recarregar);
  }, [recarregar]);

  function gravarTalhao(evento) {
    evento.preventDefault();
    setErro(null);
    setAviso(null);

    let poligono;

    try {
      poligono = JSON.parse(talhao.poligono);
    } catch {
      setErro("O poligono precisa ser uma lista GeoJSON valida: [[lon, lat], [lon, lat], …].");
      return;
    }

    if (!Array.isArray(poligono) || poligono.length < 3) {
      setErro("Um poligono precisa de ao menos tres vertices.");
      return;
    }

    if (temAutointersecao(poligono)) {
      setErro("O poligono cruza a si mesmo. Corrija os vertices antes de salvar.");
      return;
    }

    if (!talhao.nome.trim()) {
      setErro("Informe o identificador do talhao.");
      return;
    }

    // O identificador vira bytes32 no contrato, que comporta 31 caracteres.
    if (talhao.nome.trim().length > 31) {
      setErro("O identificador do talhao precisa ter no maximo 31 caracteres.");
      return;
    }

    const area = areaEmHectares(poligono);

    salvarTalhao({ ...talhao, poligono, areaHa: area });
    setAviso(`Talhao ${talhao.nome} salvo com ${area} ha calculados a partir do poligono.`);
    setTalhao({ ...talhao, nome: "" });
    recarregar();
  }

  function gravarProduto(evento) {
    evento.preventDefault();
    setErro(null);
    setAviso(null);

    if (!produto.nome.trim()) {
      setErro("Informe o nome do produto.");
      return;
    }

    const usaClima = Number(produto.operador) !== OPERADOR.DANO;
    const usaDano = Number(produto.operador) !== OPERADOR.CLIMATICO;

    if (usaClima && Number(produto.limiarClimatico) <= 0) {
      setErro("O limiar climatico precisa ser maior que zero para este operador.");
      return;
    }

    if (usaDano && Number(produto.limiarDanoBps) <= 0) {
      setErro("O limiar de dano precisa ser maior que zero para este operador.");
      return;
    }

    // Mesma validacao que o construtor do contrato faz. Melhor recusar aqui do
    // que gastar gas para descobrir na emissao.
    if (Number(produto.modoPagamento) === MODO_PAGAMENTO.ESCALONADO) {
      if (usaClima && Number(produto.limiarClimaticoIntegral) <= Number(produto.limiarClimatico)) {
        setErro("No modo escalonado, o limiar integral precisa ser maior que o gatilho.");
        return;
      }

      if (usaDano && Number(produto.limiarDanoIntegralBps) <= Number(produto.limiarDanoBps)) {
        setErro("No modo escalonado, o limiar integral de dano precisa ser maior que o gatilho.");
        return;
      }
    }

    salvarProduto({
      ...produto,
      operador: Number(produto.operador),
      modoPagamento: Number(produto.modoPagamento),
      limiarClimatico: Number(produto.limiarClimatico),
      limiarClimaticoIntegral: Number(produto.limiarClimaticoIntegral),
      limiarDanoBps: Number(produto.limiarDanoBps),
      limiarDanoIntegralBps: Number(produto.limiarDanoIntegralBps),
      valorPorHectareEth: Number(produto.valorPorHectareEth),
      vigenciaDias: Number(produto.vigenciaDias),
      taxaPremioPct: Number(produto.taxaPremioPct),
    });

    setAviso(`Produto ${produto.nome} disponivel para contratacao.`);
    setProduto({ ...produto, nome: "" });
    recarregar();
  }

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
        <form className="cartao" onSubmit={gravarTalhao}>
          <h2>Cadastrar talhao</h2>

          <Campo
            rotulo="Identificador"
            htmlFor="nome-talhao"
            ajuda="Vai para a cadeia como bytes32; no maximo 31 caracteres."
          >
            <input
              id="nome-talhao"
              value={talhao.nome}
              onChange={(e) => setTalhao({ ...talhao, nome: e.target.value })}
              placeholder="talhao-03"
            />
          </Campo>

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
            rotulo="Poligono (GeoJSON)"
            htmlFor="poligono"
            ajuda="Lista de pares [longitude, latitude]. A area e calculada automaticamente."
          >
            <textarea
              id="poligono"
              rows={4}
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
              onChange={(e) =>
                setProduto({
                  ...produto,
                  modoPagamento: Number(e.target.value),
                })
              }
            >
              <option value={MODO_PAGAMENTO.INTEGRAL}>Integral</option>
              <option value={MODO_PAGAMENTO.ESCALONADO}>Escalonado por severidade</option>
            </select>
          </Campo>

          <div className="grade">
            <Campo rotulo="Gatilho (dias sem chuva)" htmlFor="limiar">
              <input
                id="limiar"
                type="number"
                min="0"
                value={produto.limiarClimatico}
                onChange={(e) => setProduto({ ...produto, limiarClimatico: e.target.value })}
              />
            </Campo>

            <Campo rotulo="Dias para pagar 100%" htmlFor="limiar-integral">
              <input
                id="limiar-integral"
                type="number"
                min="0"
                value={produto.limiarClimaticoIntegral}
                onChange={(e) =>
                  setProduto({
                    ...produto,
                    limiarClimaticoIntegral: e.target.value,
                  })
                }
                disabled={Number(produto.modoPagamento) === MODO_PAGAMENTO.INTEGRAL}
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
                disabled={Number(produto.operador) === OPERADOR.CLIMATICO}
              />
            </Campo>

            <Campo rotulo="Dano para pagar 100% (bps)" htmlFor="dano-integral">
              <input
                id="dano-integral"
                type="number"
                min="0"
                max="10000"
                value={produto.limiarDanoIntegralBps}
                onChange={(e) =>
                  setProduto({
                    ...produto,
                    limiarDanoIntegralBps: e.target.value,
                  })
                }
                disabled={
                  Number(produto.operador) === OPERADOR.CLIMATICO ||
                  Number(produto.modoPagamento) === MODO_PAGAMENTO.INTEGRAL
                }
              />
            </Campo>

            <Campo rotulo="Limite por hectare (ETH)" htmlFor="valor-ha">
              <input
                id="valor-ha"
                type="number"
                step="0.0001"
                min="0"
                value={produto.valorPorHectareEth}
                onChange={(e) => setProduto({ ...produto, valorPorHectareEth: e.target.value })}
              />
            </Campo>

            <Campo rotulo="Taxa do premio (%)" htmlFor="taxa">
              <input
                id="taxa"
                type="number"
                step="0.1"
                min="0"
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

      <div className="cartao tabela-rolavel">
        <h2>Talhoes cadastrados</h2>
        <table>
          <thead>
            <tr>
              <th>Identificador</th>
              <th>Propriedade</th>
              <th>Cultura</th>
              <th className="numero">Area</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {talhoes.map((t) => (
              <tr key={t.id}>
                <td>{t.nome}</td>
                <td>
                  {t.propriedade}
                  <div className="silencioso">{t.municipio}</div>
                </td>
                <td>{t.cultura}</td>
                <td className="numero">{t.areaHa} ha</td>
                <td>
                  <button
                    className="perigo pequeno"
                    onClick={() => {
                      removerTalhao(t.id);
                      recarregar();
                    }}
                  >
                    Remover
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

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
                <td className="numero">{p.taxaPremioPct}%</td>
                <td>
                  <button
                    className="perigo pequeno"
                    onClick={() => {
                      removerProduto(p.id);
                      recarregar();
                    }}
                  >
                    Remover
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <NotaDePrototipo>
        Talhoes e produtos ficam no <code>localStorage</code>. O calculo de area e uma aproximacao
        plana; o PostGIS, na Sprint 2, faz a conta sobre o elipsoide e resolve tambem a checagem de
        ponto em area exigida pelo RF14.
      </NotaDePrototipo>
    </div>
  );
}
