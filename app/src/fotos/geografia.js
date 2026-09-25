/**
 * Geometria do mapa do talhao, sem biblioteca de mapas.
 *
 * O talhao tem umas centenas de hectares; nessa escala a Terra e plana para
 * qualquer efeito pratico, e uma projecao equirretangular — longitude encolhida
 * pelo cosseno da latitude — desenha o poligono sem distorcer a forma. Uma
 * biblioteca de mapas traria tiles, chave de API e dependencia de rede para
 * desenhar um poligono e alguns pontos.
 *
 * A conferencia de ponto no poligono aqui e so uma PREVIA, para avisar o produtor
 * antes do envio. Quem decide e o servidor, com o PostGIS (RF14): uma conta no
 * navegador pode ser adulterada por quem controla o navegador.
 */

/** Anel externo de um poligono GeoJSON, como lista de [lon, lat]. */
export function anelDoPoligono(poligono) {
  if (!poligono) return [];
  if (Array.isArray(poligono)) return poligono;
  if (poligono.type === "Polygon") return poligono.coordinates?.[0] ?? [];

  return [];
}

/**
 * O ponto [lon, lat] esta dentro do anel? Algoritmo do raio: conta quantas
 * arestas um raio horizontal saindo do ponto atravessa. Numero impar, dentro.
 */
export function pontoNoPoligono([lon, lat], anel) {
  let dentro = false;

  for (let i = 0, j = anel.length - 1; i < anel.length; j = i++) {
    const [xi, yi] = anel[i];
    const [xj, yj] = anel[j];

    const cruza = yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (cruza) dentro = !dentro;
  }

  return dentro;
}

/**
 * Projecao do talhao para uma area de desenho de `largura` x `altura`.
 *
 * A margem deixa espaco em volta do poligono, para que uma foto tirada um pouco
 * fora do talhao apareca no mapa — e o produtor veja por que ela vai ser
 * recusada — em vez de sumir da tela.
 */
export function criarProjecao(anel, largura, altura, margem = 0.25) {
  const lons = anel.map(([lon]) => lon);
  const lats = anel.map(([, lat]) => lat);

  const latMedia = (Math.min(...lats) + Math.max(...lats)) / 2;
  const escalaLon = Math.cos((latMedia * Math.PI) / 180);

  // Caixa em "metros relativos": longitude corrigida pelo cosseno.
  const xMin = Math.min(...lons) * escalaLon;
  const xMax = Math.max(...lons) * escalaLon;
  const yMin = Math.min(...lats);
  const yMax = Math.max(...lats);

  const folgaX = (xMax - xMin) * margem || 1e-4;
  const folgaY = (yMax - yMin) * margem || 1e-4;

  const x0 = xMin - folgaX;
  const y0 = yMin - folgaY;
  const larguraReal = xMax - xMin + 2 * folgaX;
  const alturaReal = yMax - yMin + 2 * folgaY;

  // Mesma escala nos dois eixos, para o talhao nao sair esticado.
  const escala = Math.min(largura / larguraReal, altura / alturaReal);
  const deslocX = (largura - larguraReal * escala) / 2;
  const deslocY = (altura - alturaReal * escala) / 2;

  return {
    /** [lon, lat] -> [x, y] na tela. A latitude cresce para cima; o SVG, para baixo. */
    paraTela([lon, lat]) {
      return [deslocX + (lon * escalaLon - x0) * escala, altura - (deslocY + (lat - y0) * escala)];
    },

    /** [x, y] na tela -> [lon, lat]. Usado para marcar uma foto clicando no mapa. */
    paraMapa([x, y]) {
      const lon = ((x - deslocX) / escala + x0) / escalaLon;
      const lat = (altura - y - deslocY) / escala + y0;
      return [lon, lat];
    },
  };
}
