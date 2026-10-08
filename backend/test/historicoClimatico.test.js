import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  avaliarJanela,
  historicoDaCondicao,
  percentualClimatico,
  serieConsolidada,
} from "../src/dominio/historicoClimatico.js";
import { lerCsvDoHistorico } from "../src/banco/historico.js";

/**
 * Historico climatico da cotacao (RF06): mesma regra do oraculo, aplicada ano a
 * ano sobre a janela de vigencia.
 */

const DIA = 86_400_000;

/** Linhas de uma estacao: `chuva(dataISO)` decide a chuva de cada dia. */
function linhasDe(estacao, de, ate, chuva, horas = 24) {
  const linhas = [];
  for (let t = Date.parse(`${de}T00:00:00Z`); t <= Date.parse(`${ate}T00:00:00Z`); t += DIA) {
    const data = new Date(t).toISOString().slice(0, 10);
    const mm = chuva(data);
    if (mm === null) continue;
    linhas.push({ estacao, data, chuva_mm: mm, horas_validas: horas });
  }
  return linhas;
}

const ESTIAGEM = { operador: 0, modoPagamento: 0, limiarClimatico: 30, limiarClimaticoIntegral: 0 };

describe("historico climatico (RF06)", () => {
  test("a chuva do dia e a media entre as estacoes, como no consolidador do oraculo", () => {
    const serie = serieConsolidada([
      { estacao: "A", data: "2024-07-01", chuva_mm: 0, horas_validas: 24 },
      { estacao: "B", data: "2024-07-01", chuva_mm: 4, horas_validas: 24 },
      { estacao: "A", data: "2024-07-02", chuva_mm: 0, horas_validas: 0 },
    ]);

    assert.equal(serie.get("2024-07-01"), 2);
    assert.equal(serie.has("2024-07-02"), false, "estacao sem nenhuma hora medida nao conta");
  });

  test("dia sem medicao interrompe a estiagem, em vez de contar como seco", () => {
    const serie = serieConsolidada(
      linhasDe("A", "2024-01-01", "2024-03-31", (d) => (d === "2024-02-10" ? null : 0)),
    );

    const { maiorIndice } = avaliarJanela(serie, Date.parse("2024-02-01T00:00:00Z"), 40);

    // 1/jan a 9/fev sao 40 dias secos; o buraco de 10/fev zera; 11/fev a 11/mar sao 30.
    assert.equal(maiorIndice, 40);
  });

  test("estiagem que comecou antes da vigencia conta, porque o oraculo publicaria assim", () => {
    // Seco desde 1/jun; a vigencia comeca em 20/jun e dura 10 dias.
    const serie = serieConsolidada(linhasDe("A", "2024-05-01", "2024-07-31", (d) => (d < "2024-06-01" ? 5 : 0)));

    const { maiorIndice } = avaliarJanela(serie, Date.parse("2024-06-20T00:00:00Z"), 10);
    assert.equal(maiorIndice, 29); // 1/jun a 29/jun
  });

  test("percentual pela regra do contrato: integral, e escalonado de 50% a 100%", () => {
    assert.equal(percentualClimatico(29, ESTIAGEM), 0);
    assert.equal(percentualClimatico(30, ESTIAGEM), 10_000);

    const escalonado = { ...ESTIAGEM, modoPagamento: 1, limiarClimaticoIntegral: 50 };
    assert.equal(percentualClimatico(30, escalonado), 5_000);
    assert.equal(percentualClimatico(40, escalonado), 7_500);
    assert.equal(percentualClimatico(60, escalonado), 10_000);
  });

  test("conta em quantos anos a condicao teria acionado", () => {
    // Tres anos: 2021 e 2023 com 45 dias secos em julho; 2022 chove toda semana.
    const linhas = linhasDe("A770", "2021-01-01", "2023-12-31", (d) => {
      const ano = d.slice(0, 4);
      const seco = ano !== "2022" && d.slice(5) >= "07-01" && d.slice(5) <= "08-14";
      if (seco) return 0;
      return Number(d.slice(8)) % 7 === 0 ? 10 : 0;
    });

    const h = historicoDaCondicao({
      linhas,
      inicio: "2026-06-15",
      vigenciaDias: 120,
      termos: ESTIAGEM,
    });

    assert.equal(h.aplicavel, true);
    assert.deepEqual(h.estacoes, ["A770"]);
    assert.equal(h.anosAvaliados, 3);
    assert.equal(h.acionamentos, 2);
    assert.deepEqual(
      h.anos.map((a) => [a.ano, a.acionaria]),
      [
        [2021, true],
        [2022, false],
        [2023, true],
      ],
    );
    assert.equal(h.pagamentoMedioBps, Math.round((10_000 * 2) / 3));
  });

  test("ano com menos de 90% dos dias medidos fica fora da conta", () => {
    const linhas = linhasDe("A", "2020-01-01", "2021-12-31", (d) =>
      d.startsWith("2020-07") || d.startsWith("2020-08") ? null : 0,
    );

    const h = historicoDaCondicao({ linhas, inicio: "2026-06-15", vigenciaDias: 120, termos: ESTIAGEM });

    assert.equal(h.anos.find((a) => a.ano === 2020).avaliado, false);
    assert.equal(h.anosAvaliados, 1);
  });

  test("produto por indice de dano nao tem historico publico", () => {
    const h = historicoDaCondicao({
      linhas: linhasDe("A", "2024-01-01", "2024-12-31", () => 0),
      inicio: "2026-06-15",
      vigenciaDias: 120,
      termos: { ...ESTIAGEM, operador: 1 },
    });

    assert.equal(h.aplicavel, false);
  });

  test("sem estacao proxima, diz que nao ha historico", () => {
    const h = historicoDaCondicao({ linhas: [], inicio: "2026-06-15", vigenciaDias: 120, termos: ESTIAGEM });
    assert.equal(h.aplicavel, false);
  });

  test("le o CSV gerado pelo simulador", () => {
    const linhas = lerCsvDoHistorico(
      "estacao,data,chuva_mm,horas_validas\r\nA770,2024-07-01,0.0,24\r\nA770,2024-07-02,3.2,23\r\n",
    );
    assert.deepEqual(linhas[1], { estacao: "A770", data: "2024-07-02", chuva_mm: "3.2", horas_validas: "23" });
  });
});
