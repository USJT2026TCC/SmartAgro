/**
 * Cotacao: limite contratado e premio (RF06).
 *
 * Tudo em BigInt, sobre wei. O aplicativo ja teve um defeito por fazer esta conta
 * em ponto flutuante — 180 x 0,006 gravava 71 wei a mais no contrato —, e o
 * backend e agora a autoridade sobre esse numero. Nenhum Number entra no caminho.
 *
 * A area chega do banco como texto com quatro casas decimais (numeric(14,4)), e
 * vira inteiro em decimilesimos de hectare, de modo que a fracao nao se perde.
 */

const ESCALA_AREA = 10_000n;
const BPS = 10_000n;

/**
 * Converte a area em hectares (texto ou numero) para decimilesimos de hectare.
 * "180.5" -> 1805000n
 */
export function areaEmDecimilesimos(area) {
  const texto = String(area).trim();

  if (!/^\d+(\.\d+)?$/.test(texto)) throw new Error(`Area invalida: ${area}`);

  const [inteira, fracao = ""] = texto.split(".");
  const fracaoAjustada = (fracao + "0000").slice(0, 4);

  return BigInt(inteira) * ESCALA_AREA + BigInt(fracaoAjustada);
}

/**
 * Calcula a cotacao.
 *
 * @param {object} p
 * @param {string|number} p.areaHa Area segurada, em hectares.
 * @param {string|bigint} p.valorPorHectareWei Limite por hectare do produto.
 * @param {number} p.taxaPremioBps Taxa do premio sobre o limite, em pontos-base.
 * @returns {{valorIndenizacaoWei: bigint, premioWei: bigint}}
 */
export function calcularCotacao({ areaHa, valorPorHectareWei, taxaPremioBps }) {
  const area = areaEmDecimilesimos(areaHa);
  const porHectare = BigInt(valorPorHectareWei);

  if (area <= 0n) throw new Error("A area segurada precisa ser maior que zero.");

  const valorIndenizacaoWei = (porHectare * area) / ESCALA_AREA;
  const premioWei = (valorIndenizacaoWei * BigInt(taxaPremioBps)) / BPS;

  return { valorIndenizacaoWei, premioWei };
}
