import { useMemo } from "react";

import { anelDoPoligono, criarProjecao } from "../fotos/geografia";

const LARGURA = 480;
const ALTURA = 320;

/**
 * O contorno do talhao e os pontos onde cada foto foi tirada.
 *
 * Desenhado em SVG, sem biblioteca de mapas: para um poligono e alguns pontos,
 * tiles de mapa trariam dependencia de rede e de chave de API sem acrescentar
 * nada ao que o produtor precisa ver — se a foto caiu dentro ou fora.
 *
 * Com `aoClicar`, o mapa entra no modo de marcacao: o clique devolve o
 * [lon, lat] do ponto, para localizar uma foto que chegou sem GPS.
 */
export default function MapaDoTalhao({ poligono, pontos = [], aoClicar, destaque }) {
  const anel = useMemo(() => anelDoPoligono(poligono), [poligono]);
  const projecao = useMemo(
    () => (anel.length ? criarProjecao(anel, LARGURA, ALTURA) : null),
    [anel],
  );

  if (!projecao) return <p className="silencioso">Talhao sem poligono cadastrado.</p>;

  const contorno = anel.map((vertice) => projecao.paraTela(vertice).join(",")).join(" ");

  function clicar(evento) {
    if (!aoClicar) return;

    const caixa = evento.currentTarget.getBoundingClientRect();
    const x = ((evento.clientX - caixa.left) / caixa.width) * LARGURA;
    const y = ((evento.clientY - caixa.top) / caixa.height) * ALTURA;

    aoClicar(projecao.paraMapa([x, y]));
  }

  return (
    <svg
      className={`mapa-do-talhao${aoClicar ? " marcando" : ""}`}
      viewBox={`0 0 ${LARGURA} ${ALTURA}`}
      role="img"
      aria-label="Mapa do talhao com os pontos das fotos"
      onClick={clicar}
    >
      <polygon className="contorno" points={contorno} />

      {pontos.map((ponto) => {
        const [x, y] = projecao.paraTela([ponto.lon, ponto.lat]);
        const classe = [
          "ponto",
          ponto.dentro ? "dentro" : "fora",
          ponto.origem === "manual" ? "manual" : "",
          destaque === ponto.chave ? "destaque" : "",
        ].join(" ");

        return (
          <g key={ponto.chave}>
            <circle className={classe} cx={x} cy={y} r={destaque === ponto.chave ? 9 : 6}>
              <title>{ponto.rotulo}</title>
            </circle>
          </g>
        );
      })}

      <text className="norte" x={LARGURA - 18} y={22}>
        N
      </text>
    </svg>
  );
}
