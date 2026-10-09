/** O mapa do talhao abre no municipio digitado (cadastro, HU09). */
import { describe, expect, test } from "vitest";

import { localizarMunicipio } from "../src/cadastro/localizarMunicipio.js";

const resposta =
  (corpo, ok = true) =>
  async () => ({ ok, json: async () => corpo });

describe("localizarMunicipio", () => {
  test("pergunta ao OpenStreetMap so no Brasil e devolve o centro", async () => {
    const urls = [];
    const lugar = await localizarMunicipio("Ouro Fino/MG", {
      buscar: async (url) => {
        urls.push(url);
        return resposta([
          { lat: "-22.28", lon: "-46.37", display_name: "Ouro Fino, Minas Gerais, Brasil" },
        ])();
      },
    });

    expect(lugar).toEqual({ lat: -22.28, lon: -46.37, nome: "Ouro Fino, Minas Gerais" });
    expect(urls[0]).toContain("countrycodes=br");
    expect(decodeURIComponent(urls[0])).toContain("Ouro Fino, MG");
  });

  test("sem resultado, sem conexao ou texto curto: null, e o mapa fica onde estava", async () => {
    expect(await localizarMunicipio("Xyzw", { buscar: resposta([]) })).toBeNull();
    expect(await localizarMunicipio("Xyzw", { buscar: resposta(null, false) })).toBeNull();
    expect(
      await localizarMunicipio("Ouro Fino", {
        buscar: async () => {
          throw new TypeError("Failed to fetch");
        },
      }),
    ).toBeNull();
    expect(await localizarMunicipio("ab", { buscar: resposta([{ lat: 1, lon: 1 }]) })).toBeNull();
  });
});
