/**
 * Detalhe da apolice (UC06, RF08, RF09, RF10, RF16, RF28).
 */
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { ethers } from "ethers";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { CONTA_DA_SEGURADORA, CONTA_DO_PRODUTOR, abrir, achar, carteiraFalsa } from "./ambiente";

const ENDERECO = "0x00000000000000000000000000000000000a9011";
const TX = `0x${"34".repeat(32)}`;
const DESCRICAO = "AgroSmart|soja|talhao-01|30 dias consecutivos sem chuva|1 ETH";

const cadeia = vi.hoisted(() => ({ apolice: null, publicacoes: [], linha: [], chamadas: [] }));

vi.mock("../../src/cadeia/contratos", () => ({
  lerApolice: vi.fn(async () => cadeia.apolice),
  lerPublicacoes: vi.fn(async () => cadeia.publicacoes),
  lerLinhaDoTempo: vi.fn(async () => cadeia.linha),
  contratoApolice: vi.fn(() => {
    const tx = (nome) =>
      vi.fn(async (...args) => {
        cadeia.chamadas.push([nome, ...args]);
        return { hash: TX, wait: async () => ({ status: 1 }) };
      });
    return {
      on: () => {},
      removeAllListeners: () => {},
      cancelar: tx("cancelar"),
      depositarGarantia: tx("depositarGarantia"),
      resgatarGarantia: tx("resgatarGarantia"),
    };
  }),
}));

const agora = Math.floor(Date.now() / 1000);

function apolice(sobrescritos = {}, termos = {}) {
  return {
    endereco: ENDERECO,
    seguradora: CONTA_DA_SEGURADORA,
    situacao: 1,
    valorPago: 0n,
    periodoAcionador: 0,
    garantiaRetida: ethers.parseEther("1"),
    totalPeriodos: 1,
    ...sobrescritos,
    termos: {
      produtor: CONTA_DO_PRODUTOR,
      registry: "0x5FbDB2315678afecb367f032d93F642f64180aa3",
      cultura: ethers.encodeBytes32String("soja"),
      talhao: ethers.encodeBytes32String("talhao-01"),
      operador: 0,
      modoPagamento: 0,
      limiarClimatico: 30,
      limiarClimaticoIntegral: 0,
      limiarDanoBps: 2000,
      limiarDanoIntegralBps: 0,
      vigenciaInicio: agora - 86_400,
      vigenciaFim: agora + 180 * 86_400,
      valorIndenizacao: ethers.parseEther("1"),
      hashTermos: ethers.keccak256(ethers.toUtf8Bytes(DESCRICAO)),
      ...termos,
    },
  };
}

const publicacao = (sobrescritos = {}) => ({
  periodo: 20261007,
  oraculo: "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
  indiceClimatico: 3,
  indiceDanoBps: 1200,
  confiancaBps: 8000,
  publicadoEm: agora,
  hashEvidencias: `0x${"aa".repeat(32)}`,
  versaoModelo: `0x${"bb".repeat(32)}`,
  retificacao: null,
  ...sobrescritos,
});

const evento = (nome, argumentos) => ({ nome, bloco: 10, indiceNoBloco: 0, txHash: TX, em: agora, argumentos });

beforeEach(() => {
  cadeia.apolice = apolice();
  cadeia.publicacoes = [publicacao()];
  cadeia.linha = [
    evento("ApoliceImplantada", { valorIndenizacao: ethers.parseEther("1"), talhao: ethers.encodeBytes32String("talhao-01") }),
    evento("GarantiaDepositada", { valor: ethers.parseEther("1") }),
    evento("IndicesPublicados", { periodo: 20261007n, indiceClimatico: 3, indiceDanoBps: 1200, confiancaBps: 8000 }),
    evento("CondicaoAvaliada", { atendida: false, percentualBps: 0 }),
  ];
  cadeia.chamadas.length = 0;
});

afterEach(() => {
  cleanup();
  delete window.ethereum;
  localStorage.clear();
});

const rotasDaApolice = (extra = {}) => ({
  "GET /apolices/:endereco": {
    conferenciaDosTermos: { descricao: DESCRICAO },
    publicacoes: [{ periodo: 20261007, procedencia: { fontesUsadas: ["estacao-inmet-a770", "estacao-inmet-a747"], fontesDescartadas: [] }, gas_usado: "956252", latencia_ms: 26713 }],
  },
  "GET /contestacoes": { contestacoes: [] },
  ...extra,
});

describe("detalhe da apolice", () => {
  test("termos, publicacoes com procedencia e linha do tempo vinda da rede (RF09)", async () => {
    await abrir(`/apolice/${ENDERECO}`, { perfil: "produtor", rotas: rotasDaApolice() });

    expect(await achar("Talhao talhao-01")).toBeTruthy();
    expect(await achar(/30 dias consecutivos sem chuva/)).toBeTruthy();
    expect(await achar("Oraculo publicou os indices do periodo")).toBeTruthy();
    expect(await achar(/Condicao nao atendida/)).toBeTruthy();
  });

  test("o resumo dos termos e recalculado no navegador e confere com o contrato (RF08)", async () => {
    await abrir(`/apolice/${ENDERECO}`, { perfil: "produtor", rotas: rotasDaApolice() });
    expect(await achar(/corresponde exatamente ao que foi gravado no contrato/)).toBeTruthy();
  });

  test("termos adulterados no servidor sao denunciados (RF08)", async () => {
    await abrir(`/apolice/${ENDERECO}`, {
      perfil: "produtor",
      rotas: rotasDaApolice({ "GET /apolices/:endereco": { conferenciaDosTermos: { descricao: `${DESCRICAO} (alterado)` }, publicacoes: [] } }),
    });
    expect(await achar(/NAO corresponde ao resumo gravado no contrato/)).toBeTruthy();
  });

  test("o produtor contesta o indice de dano de um periodo (RF28)", async () => {
    const { chamadas } = await abrir(`/apolice/${ENDERECO}`, {
      perfil: "produtor",
      rotas: rotasDaApolice({ "POST /contestacoes": { contestacao: { id: "c1" } } }),
    });

    fireEvent.click(await screen.findByRole("button", { name: "Contestar" }));
    const motivo = await screen.findByPlaceholderText(/metade norte/);
    fireEvent.change(motivo, { target: { value: "A metade norte secou inteira." } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar contestacao" }));

    expect(await achar(/Contestacao registrada/)).toBeTruthy();
    expect(chamadas.find((c) => c.caminho === "/contestacoes" && c.metodo === "POST").corpo).toEqual({
      apolice: ENDERECO,
      periodo: 20261007,
      motivo: "A metade norte secou inteira.",
    });
  });

  test("indice retificado aparece ao lado do original, e a contestacao aberta tambem", async () => {
    cadeia.publicacoes = [publicacao({ retificacao: { indiceDanoBps: 3000, confiancaBps: 10000, publicadoEm: agora, hashParecer: `0x${"cc".repeat(32)}` } }), publicacao({ periodo: 20261008 })];
    cadeia.linha.push(evento("IndiceRetificado", { periodo: 20261007n, indiceDanoOriginalBps: 1200, indiceDanoBps: 3000, hashParecer: `0x${"cc".repeat(32)}` }));

    await abrir(`/apolice/${ENDERECO}`, {
      perfil: "produtor",
      rotas: rotasDaApolice({ "GET /contestacoes": { contestacoes: [{ apolice_endereco: ENDERECO, periodo: 20261008, situacao: "aberta" }] } }),
    });

    expect(await achar("retificado pelo perito")).toBeTruthy();
    expect(await achar("contestacao aguardando o perito")).toBeTruthy();
    expect(await achar("Indice de dano retificado apos contestacao")).toBeTruthy();
  });

  test("antes da vigencia, o produtor titular cancela pela carteira (RF10)", async () => {
    cadeia.apolice = apolice({}, { vigenciaInicio: agora + 10 * 86_400, vigenciaFim: agora + 190 * 86_400 });
    carteiraFalsa(CONTA_DO_PRODUTOR);
    vi.spyOn(window, "confirm").mockReturnValue(true);

    await abrir(`/apolice/${ENDERECO}`, { perfil: "produtor", rotas: rotasDaApolice() });

    const botao = await screen.findByRole("button", { name: "Cancelar apolice" });
    await waitFor(() => expect(botao.disabled).toBe(false));
    fireEvent.click(botao);

    expect(await achar(/Apolice cancelada/)).toBeTruthy();
    expect(cadeia.chamadas[0][0]).toBe("cancelar");
  });

  test("cancelar pede confirmacao, e desistir nao envia nada", async () => {
    cadeia.apolice = apolice({}, { vigenciaInicio: agora + 10 * 86_400, vigenciaFim: agora + 190 * 86_400 });
    carteiraFalsa(CONTA_DO_PRODUTOR);
    vi.spyOn(window, "confirm").mockReturnValue(false);

    await abrir(`/apolice/${ENDERECO}`, { perfil: "produtor", rotas: rotasDaApolice() });
    const botao = await screen.findByRole("button", { name: "Cancelar apolice" });
    await waitFor(() => expect(botao.disabled).toBe(false));
    fireEvent.click(botao);

    expect(cadeia.chamadas).toEqual([]);
  });

  test("a seguradora deposita a garantia de uma apolice recem-emitida", async () => {
    cadeia.apolice = apolice({ situacao: 0, garantiaRetida: 0n });
    carteiraFalsa(CONTA_DA_SEGURADORA);

    await abrir(`/apolice/${ENDERECO}`, { perfil: "seguradora", rotas: rotasDaApolice() });

    const botao = await screen.findByRole("button", { name: /Depositar/ });
    await waitFor(() => expect(botao.disabled).toBe(false));
    fireEvent.click(botao);
    expect(await achar(/Garantia depositada/)).toBeTruthy();
  });

  test("liquidada no modo escalonado: a seguradora resgata a sobra", async () => {
    cadeia.apolice = apolice(
      { situacao: 2, valorPago: ethers.parseEther("0.75"), garantiaRetida: ethers.parseEther("0.25"), periodoAcionador: 20261007 },
      { modoPagamento: 1, limiarClimaticoIntegral: 60 },
    );
    cadeia.linha.push(evento("PagamentoExecutado", { valor: ethers.parseEther("0.75") }));
    carteiraFalsa(CONTA_DA_SEGURADORA);

    await abrir(`/apolice/${ENDERECO}`, { perfil: "seguradora", rotas: rotasDaApolice() });

    expect(await achar("sem intervencao humana")).toBeTruthy();
    const botao = await screen.findByRole("button", { name: /Resgatar a sobra/ });
    await waitFor(() => expect(botao.disabled).toBe(false));
    fireEvent.click(botao);
    expect(await achar(/Sobra do pagamento escalonado devolvida/)).toBeTruthy();
  });

  test("apolice que a rede nao conhece mostra o erro", async () => {
    const { lerApolice } = await import("../../src/cadeia/contratos");
    lerApolice.mockRejectedValueOnce(new Error("could not decode result data"));

    await abrir(`/apolice/${ENDERECO}`, { perfil: "produtor", rotas: rotasDaApolice() });
    expect(await achar("Nao foi possivel ler a apolice.")).toBeTruthy();
  });
});
