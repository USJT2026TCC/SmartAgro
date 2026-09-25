/**
 * De onde vem a coordenada de uma foto (RF14).
 *
 * Tres origens, em ordem de confianca, e o servidor grava qual delas foi usada
 * (migracao 002 do backend):
 *
 *   exif         o GPS que o celular ou o drone gravou no arquivo, na hora da
 *                foto. E o caso normal, e o unico que diz onde a foto foi TIRADA.
 *   dispositivo  a posicao do aparelho no momento do envio. So vale se a pessoa
 *                estiver no talhao — diz onde a foto foi ENVIADA.
 *   manual       marcada no mapa. A mais facil de forjar; o perito ve quantas
 *                fotos do lote chegaram assim.
 *
 * A leitura do EXIF acontece no navegador, antes do envio: o produtor ve no mapa
 * onde cada foto caiu, e corrige ou descarta a que estiver fora do talhao antes
 * de gastar a conexao — que, no campo, costuma ser ruim.
 */

import exifr from "exifr/dist/lite.esm.mjs";

export const ORIGENS = {
  exif: "GPS da foto",
  dispositivo: "localizacao do aparelho",
  manual: "marcada no mapa",
};

/**
 * Le o GPS e a data gravados na foto.
 *
 * Devolve `{ lon, lat, capturadaEm, origem: "exif" }`, ou `{ capturadaEm }` sem
 * coordenada quando a foto nao tem GPS — foto encaminhada por aplicativo de
 * mensagem, por exemplo, costuma perder o EXIF no caminho.
 */
export async function lerDaFoto(arquivo) {
  let gps = null;
  let metadados = null;

  // Os bytes, e nao o objeto File: no navegador a biblioteca le os dois, mas no
  // Node so os bytes — e o teste automatizado roda no Node. Lendo os bytes, o
  // caminho testado e o mesmo que o navegador executa.
  let bytes = null;
  try {
    bytes = await arquivo.arrayBuffer();
  } catch {
    bytes = null;
  }

  try {
    gps = bytes ? await exifr.gps(bytes) : null;
  } catch {
    gps = null;
  }

  try {
    // Sem a opcao "pick": a versao enxuta da biblioteca, usada aqui por ser um
    // terco do tamanho, nao a suporta e lanca erro — que era engolido abaixo, e a
    // data da foto virava, em silencio, a data do arquivo. Ha teste para isso.
    metadados = bytes ? await exifr.parse(bytes, { tiff: true, exif: true, gps: false }) : null;
  } catch {
    metadados = null;
  }

  // Sem data no EXIF, a data do arquivo e a melhor aproximacao disponivel.
  const data =
    metadados?.DateTimeOriginal ?? metadados?.CreateDate ?? new Date(arquivo.lastModified);

  const temGps = Number.isFinite(gps?.latitude) && Number.isFinite(gps?.longitude);

  return temGps
    ? { lon: gps.longitude, lat: gps.latitude, capturadaEm: data, origem: "exif" }
    : { capturadaEm: data };
}

/** Posicao atual do aparelho. Rejeita com uma mensagem legivel se nao houver. */
export function localizacaoDoAparelho() {
  return new Promise((resolver, rejeitar) => {
    if (!navigator.geolocation) {
      rejeitar(new Error("Este navegador nao informa a localizacao do aparelho."));
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (posicao) =>
        resolver({
          lon: posicao.coords.longitude,
          lat: posicao.coords.latitude,
          precisaoM: posicao.coords.accuracy,
          origem: "dispositivo",
        }),
      (erro) =>
        rejeitar(
          new Error(
            erro.code === erro.PERMISSION_DENIED
              ? "A permissao de localizacao foi negada no navegador."
              : "Nao foi possivel obter a localizacao do aparelho.",
          ),
        ),
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 60_000 },
    );
  });
}
