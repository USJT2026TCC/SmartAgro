import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

/**
 * Desenho do poligono do talhao sobre o mapa (HU09, criterio 1).
 *
 * Cada clique acrescenta um vertice; o anel e fechado pelo servidor. A tela so
 * desenha: a validade do poligono (autointersecao) e a area continuam sendo
 * decididas pelo PostGIS, que mede sobre o elipsoide.
 *
 * O mapa de fundo e o do OpenStreetMap (dados abertos, ODbL), carregado em
 * mosaicos pela rede. Sem conexao, o desenho continua funcionando sobre o fundo
 * vazio, e o poligono tambem pode ser importado de um arquivo GeoJSON.
 *
 * @param {object} p
 * @param {Array<[number, number]>} p.vertices Pares [longitude, latitude].
 * @param {(vertices: Array<[number, number]>) => void} p.aoMudar
 */
export default function DesenhoDoTalhao({ vertices, aoMudar }) {
  const recipiente = useRef(null);
  const mapa = useRef(null);
  const camada = useRef(null);
  const aoMudarAtual = useRef(aoMudar);
  const verticesAtuais = useRef(vertices);

  aoMudarAtual.current = aoMudar;
  verticesAtuais.current = vertices;

  // Cria o mapa uma vez.
  useEffect(() => {
    const centro = vertices.length ? [vertices[0][1], vertices[0][0]] : [-21.46, -47.58]; // Sao Simao/SP, regiao do talhao de demonstracao

    const m = L.map(recipiente.current, { center: centro, zoom: 14 });
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(m);

    m.on("click", (e) => {
      const novo = [Number(e.latlng.lng.toFixed(6)), Number(e.latlng.lat.toFixed(6))];
      // Atualiza a referencia ja aqui: dois cliques antes do proximo desenho da
      // tela partiriam da mesma lista, e o primeiro ponto se perderia.
      verticesAtuais.current = [...verticesAtuais.current, novo];
      aoMudarAtual.current(verticesAtuais.current);
    });

    camada.current = L.layerGroup().addTo(m);
    mapa.current = m;

    return () => {
      m.remove();
      mapa.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Redesenha a cada mudanca de vertices.
  useEffect(() => {
    const grupo = camada.current;
    if (!grupo) return;

    grupo.clearLayers();
    const pontos = vertices.map(([lon, lat]) => [lat, lon]);

    for (const p of pontos) {
      L.circleMarker(p, { radius: 4, color: "#2f7d32", weight: 2, fillOpacity: 1 }).addTo(grupo);
    }
    if (pontos.length >= 2) {
      L.polygon(pontos, { color: "#2f7d32", weight: 2, fillOpacity: 0.2 }).addTo(grupo);
    }
  }, [vertices]);

  /** Centraliza no poligono, quando vem de um arquivo. */
  function enquadrar() {
    if (mapa.current && vertices.length >= 2) {
      mapa.current.fitBounds(
        vertices.map(([lon, lat]) => [lat, lon]),
        { padding: [20, 20] },
      );
    }
  }

  return (
    <div className="desenho-do-talhao">
      <div ref={recipiente} className="desenho-do-talhao__mapa" />
      <div className="linha-de-botoes">
        <span className="silencioso">
          {vertices.length} vertice(s). Clique no mapa para marcar.
        </span>
        <button
          type="button"
          className="secundario pequeno"
          onClick={() => aoMudar(vertices.slice(0, -1))}
          disabled={vertices.length === 0}
        >
          Desfazer ponto
        </button>
        <button
          type="button"
          className="secundario pequeno"
          onClick={() => aoMudar([])}
          disabled={vertices.length === 0}
        >
          Limpar
        </button>
        <button
          type="button"
          className="secundario pequeno"
          onClick={enquadrar}
          disabled={vertices.length < 2}
        >
          Enquadrar
        </button>
      </div>
    </div>
  );
}

export { anelDoGeoJson } from "../fotos/geografia";
