import { pedidoInvalido } from "../erros.js";

/**
 * Normalizacao do poligono do talhao para GeoJSON.
 *
 * O aplicativo envia uma lista de pares [longitude, latitude], que e o que a
 * pessoa desenha ou cola. O criterio de aceite 1 da HU09 fala em GeoJSON, entao
 * tambem se aceita um objeto `{ type: "Polygon", coordinates: [...] }`.
 *
 * A validacao geometrica de verdade — autointersecao, area — fica com o PostGIS.
 * Aqui so se confere a forma, para que um erro de digitacao volte como mensagem
 * clara, e nao como erro de SQL.
 */
export function paraPoligonoGeoJson(entrada) {
  let anel;

  if (Array.isArray(entrada)) {
    anel = entrada;
  } else if (entrada?.type === "Polygon" && Array.isArray(entrada.coordinates?.[0])) {
    if (entrada.coordinates.length > 1) {
      throw pedidoInvalido("Poligonos com furos nao sao aceitos para talhoes.");
    }
    anel = entrada.coordinates[0];
  } else {
    throw pedidoInvalido(
      "O poligono deve ser uma lista [[lon, lat], ...] ou um GeoJSON do tipo Polygon.",
    );
  }

  const pontos = anel.map((par, i) => {
    if (!Array.isArray(par) || par.length < 2) {
      throw pedidoInvalido(`Vertice ${i + 1} invalido: esperado [longitude, latitude].`);
    }

    const [lon, lat] = par.map(Number);

    if (
      !Number.isFinite(lon) ||
      !Number.isFinite(lat) ||
      lon < -180 ||
      lon > 180 ||
      lat < -90 ||
      lat > 90
    ) {
      throw pedidoInvalido(`Vertice ${i + 1} fora da faixa de coordenadas validas.`);
    }

    return [lon, lat];
  });

  // O GeoJSON exige o anel fechado: o ultimo ponto repete o primeiro. Quem
  // desenha um talhao nao pensa nisso, entao o fechamento e feito aqui.
  const [primeiro] = pontos;
  const ultimo = pontos[pontos.length - 1];

  if (primeiro && (primeiro[0] !== ultimo[0] || primeiro[1] !== ultimo[1])) {
    pontos.push([...primeiro]);
  }

  // Tres vertices distintos mais o fechamento.
  if (pontos.length < 4) {
    throw pedidoInvalido("Um poligono precisa de ao menos tres vertices distintos.");
  }

  return { type: "Polygon", coordinates: [pontos] };
}
