/**
 * Centro aproximado de um municipio, para o mapa do talhao abrir no lugar certo.
 *
 * Usa a busca do proprio OpenStreetMap (Nominatim), o mesmo projeto que fornece
 * o mapa de fundo: sem chave, sem conta. A politica de uso pede no maximo uma
 * busca por segundo, e por isso a tela so pergunta depois que se para de
 * digitar. Sem conexao ou sem resultado, devolve null e o mapa fica onde estava:
 * localizar e uma conveniencia, nunca um passo obrigatorio.
 *
 * @param {string} municipio Por exemplo "Ouro Fino/MG" ou "Ribeirao Preto - SP".
 * @returns {Promise<{lat: number, lon: number, nome: string} | null>}
 */
export async function localizarMunicipio(municipio, { buscar = fetch } = {}) {
  const termo = String(municipio ?? "")
    .replace(/[/-]/g, ", ")
    .trim();
  if (termo.length < 3) return null;

  const url =
    "https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=br&q=" +
    encodeURIComponent(termo);

  try {
    const resposta = await buscar(url, { headers: { "Accept-Language": "pt-BR" } });
    if (!resposta.ok) return null;
    const [primeiro] = await resposta.json();
    if (!primeiro) return null;
    return {
      lat: Number(primeiro.lat),
      lon: Number(primeiro.lon),
      nome: String(primeiro.display_name ?? termo)
        .split(",")
        .slice(0, 2)
        .join(","),
    };
  } catch {
    return null;
  }
}
