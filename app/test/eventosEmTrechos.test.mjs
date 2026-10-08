/**
 * Leitura de eventos em trechos: a linha do tempo de uma apolice de 180 dias
 * cobre ~1,3 milhao de blocos, e os nos publicos recusam intervalos grandes.
 */
import { describe, expect, test } from "vitest";

import { BLOCOS_POR_CONSULTA, TENTATIVAS_POR_TRECHO, eventosEmTrechos } from "../src/cadeia/contratos.js";

/** Contrato falso que, como o no publico, recusa intervalos acima do limite. */
function contratoFalso({ eventosNosBlocos, limite = BLOCOS_POR_CONSULTA }) {
  const pedidos = [];
  let simultaneos = 0;
  let picoDeSimultaneos = 0;

  return {
    pedidos,
    pico: () => picoDeSimultaneos,
    async queryFilter(filtro, de, ate) {
      if (ate - de + 1 > limite) throw new Error("could not coalesce error");
      pedidos.push([de, ate]);
      simultaneos += 1;
      picoDeSimultaneos = Math.max(picoDeSimultaneos, simultaneos);
      await new Promise((r) => setTimeout(r, 1));
      simultaneos -= 1;
      return eventosNosBlocos.filter((b) => b >= de && b <= ate).map((b) => ({ blockNumber: b, filtro }));
    },
  };
}

const provedor = (topo) => ({ getBlockNumber: async () => topo });

describe("eventosEmTrechos", () => {
  test("180 dias de blocos: nenhum pedido acima do limite, e nenhum evento perdido nas emendas", async () => {
    const desde = 11_871_430;
    const topo = desde + 1_300_000;
    // Eventos no primeiro e no ultimo bloco de trechos vizinhos, e no topo.
    const eventosNosBlocos = [desde, desde + 9_999, desde + 10_000, desde + 650_000, topo];
    const contrato = contratoFalso({ eventosNosBlocos });

    const eventos = await eventosEmTrechos(contrato, "*", desde, provedor(topo));

    expect(eventos.map((e) => e.blockNumber)).toEqual(eventosNosBlocos);
    expect(contrato.pedidos.length).toBe(131);
    expect(contrato.pedidos.every(([de, ate]) => ate - de + 1 <= BLOCOS_POR_CONSULTA)).toBe(true);
  });

  test("os trechos cobrem o intervalo sem buraco nem sobreposicao", async () => {
    const contrato = contratoFalso({ eventosNosBlocos: [] });
    await eventosEmTrechos(contrato, "*", 100, provedor(35_000));

    const ordenados = [...contrato.pedidos].sort((a, b) => a[0] - b[0]);
    expect(ordenados[0][0]).toBe(100);
    expect(ordenados.at(-1)[1]).toBe(35_000);
    for (let i = 1; i < ordenados.length; i++) expect(ordenados[i][0]).toBe(ordenados[i - 1][1] + 1);
  });

  test("no maximo quatro pedidos ao mesmo tempo, para nao estourar o limite de taxa do no", async () => {
    const contrato = contratoFalso({ eventosNosBlocos: [] });
    await eventosEmTrechos(contrato, "*", 0, provedor(200_000));
    expect(contrato.pico()).toBeLessThanOrEqual(4);
  });

  test("contrato recem-implantado: um unico pedido", async () => {
    const contrato = contratoFalso({ eventosNosBlocos: [50] });
    const eventos = await eventosEmTrechos(contrato, "*", 0, provedor(63));
    expect(eventos).toHaveLength(1);
    expect(contrato.pedidos).toEqual([[0, 63]]);
  });

  test("trecho recusado por um servidor do no e pedido de novo", async () => {
    const contrato = contratoFalso({ eventosNosBlocos: [5, 15_000] });
    const original = contrato.queryFilter;
    let recusas = 2;
    contrato.queryFilter = async (filtro, de, ate) => {
      if (de === 10_000 && recusas-- > 0) throw new Error("pruned history unavailable");
      return original(filtro, de, ate);
    };

    const eventos = await eventosEmTrechos(contrato, "*", 0, provedor(19_999), { espera: 0 });
    expect(eventos.map((e) => e.blockNumber)).toEqual([5, 15_000]);
  });

  test("depois de todas as tentativas, o erro chega a tela em vez de uma linha do tempo incompleta", async () => {
    let pedidos = 0;
    const contrato = {
      async queryFilter() {
        pedidos += 1;
        throw new Error("pruned history unavailable");
      },
    };

    await expect(eventosEmTrechos(contrato, "*", 0, provedor(10), { espera: 0 })).rejects.toThrow(/pruned/);
    expect(pedidos).toBe(TENTATIVAS_POR_TRECHO);
  });
});
