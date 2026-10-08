/**
 * Fotos da lavoura (RF14, HU11), cotacao com historico (RF06, RNF04) e revisao
 * do perito (RF17, RF28).
 */
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { USUARIOS, abrir, achar } from "./ambiente";

// A leitura do EXIF tem testes proprios (test/localizacao.test.mjs); aqui cada
// foto ja diz onde foi tirada.
const fotos = vi.hoisted(() => ({
  lidas: {
    "dentro.jpg": { lon: -47.58, lat: -21.46, capturadaEm: new Date("2026-09-20T10:00:00Z"), origem: "exif" },
    "sem-gps.jpg": { capturadaEm: new Date("2026-09-20T11:00:00Z") },
    "sem-gps-2.jpg": { capturadaEm: new Date("2026-09-20T12:00:00Z") },
  },
}));

vi.mock("../../src/fotos/localizacao", () => ({
  ORIGENS: { exif: "GPS da foto", dispositivo: "localizacao do aparelho", manual: "marcada no mapa" },
  lerDaFoto: vi.fn(async (arquivo) => fotos.lidas[arquivo.name]),
  localizacaoDoAparelho: vi.fn(async () => ({ lon: -47.581, lat: -21.461, precisaoM: 8, origem: "dispositivo" })),
}));

beforeEach(() => {
  URL.createObjectURL = vi.fn(() => "blob:foto");
  URL.revokeObjectURL = vi.fn();
  // O jsdom mede tudo como zero; o mapa precisa de um tamanho para converter o clique.
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({ left: 0, top: 0, width: 480, height: 320, right: 480, bottom: 320 });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const TALHAO = {
  id: "t1",
  identificador: "talhao-01",
  cultura: "soja",
  areaHa: "459.05",
  propriedade: { id: "pp1", nome: "Fazenda Boa Vista" },
  poligono: { type: "Polygon", coordinates: [[[-47.59, -21.45], [-47.57, -21.45], [-47.57, -21.47], [-47.59, -21.47], [-47.59, -21.45]]] },
};

describe("fotos da lavoura (RF14, HU11)", () => {
  test("abre o lote, localiza as fotos, envia, mostra a recusa e fecha", async () => {
    let lotes = [];
    let enviadas = 0;
    const { chamadas, container } = await abrir("/produtor/fotos", {
      perfil: "produtor",
      rotas: {
        "GET /talhoes": { talhoes: [TALHAO] },
        "GET /lotes": () => ({ lotes }),
        "POST /talhoes/:id/lotes": () => {
          lotes = [{ id: "l1", criado_em: "2026-10-07T00:00:00Z", fechado_em: null, imagens: 0 }];
          return { status: 201, corpo: { lote: lotes[0] } };
        },
        "POST /lotes/:id/imagens": () => {
          enviadas += 1;
          if (enviadas === 2) {
            return { status: 400, corpo: { erro: { mensagem: "A imagem foi capturada fora do poligono do talhao e foi recusada." } } };
          }
          lotes = [{ ...lotes[0], imagens: lotes[0].imagens + 1 }];
          return { status: 201, corpo: { imagem: { sha256: "ab".repeat(32) } } };
        },
        "POST /lotes/:id/fechar": () => {
          lotes = [{ ...lotes[0], fechado_em: "2026-10-07T01:00:00Z", imagens: 2, hash_evidencias: `0x${"cd".repeat(32)}`, analise: { indiceDanoBps: 998 } }];
          return { lote: { imagens: 2, hashEvidencias: `0x${"cd".repeat(32)}` } };
        },
      },
    });

    fireEvent.click(await screen.findByRole("button", { name: "Abrir lote de fotos" }));
    await screen.findByRole("button", { name: /Escolher fotos/ });

    const galeria = container.querySelector('input[type="file"][multiple]');
    const arquivos = ["dentro.jpg", "sem-gps.jpg", "sem-gps-2.jpg"].map((n) => new File([n], n, { type: "image/jpeg" }));
    fireEvent.change(galeria, { target: { files: arquivos } });

    // Uma sem GPS vai pela posicao do aparelho; a outra e marcada no mapa.
    // Espera as tres serem lidas antes de pedir a posicao do aparelho.
    fireEvent.click(await screen.findByRole("button", { name: "Usar minha localizacao nas 2 sem GPS" }));
    await waitFor(() => expect(screen.queryAllByText("sem GPS").length).toBe(0));
    expect(screen.getAllByText("localizacao do aparelho").length).toBe(2);

    fireEvent.click((await screen.findAllByRole("button", { name: "Descartar" }))[2]);

    fireEvent.click(screen.getByRole("button", { name: /^Enviar/ }));
    expect(await achar(/fora do poligono do talhao/)).toBeTruthy();

    const enviada = chamadas.find((c) => c.caminho === "/lotes/l1/imagens").corpo;
    expect(enviada.get("origemDaLocalizacao")).toBe("exif");

    vi.spyOn(window, "confirm").mockReturnValue(true);
    fireEvent.click(screen.getByRole("button", { name: /Fechar lote/ }));
    expect(await achar(/Lote fechado com 2 foto/)).toBeTruthy();
    expect(await achar(/dano de 9,98% da lavoura/)).toBeTruthy();
  });

  test("foto sem GPS e marcada clicando no mapa do talhao", async () => {
    const { container } = await abrir("/produtor/fotos", {
      perfil: "produtor",
      rotas: {
        "GET /talhoes": { talhoes: [TALHAO] },
        "GET /lotes": { lotes: [{ id: "l1", criado_em: "2026-10-07T00:00:00Z", fechado_em: null, imagens: 0 }] },
      },
    });

    const galeria = await waitFor(() => {
      const e = container.querySelector('input[type="file"][multiple]');
      expect(e).toBeTruthy();
      return e;
    });
    fireEvent.change(galeria, { target: { files: [new File(["x"], "sem-gps.jpg", { type: "image/jpeg" })] } });

    fireEvent.click(await screen.findByRole("button", { name: "Marcar no mapa" }));
    fireEvent.click(container.querySelector("svg.mapa-do-talhao"), { clientX: 240, clientY: 160 });

    expect(await achar(/marcada no mapa/)).toBeTruthy();
  });

  test("lotes antigos mostram o andamento da analise", async () => {
    await abrir("/produtor/fotos", {
      perfil: "produtor",
      rotas: {
        "GET /talhoes": { talhoes: [TALHAO] },
        "GET /lotes": {
          lotes: [
            { id: "a", criado_em: "2026-10-01T00:00:00Z", fechado_em: "2026-10-01T01:00:00Z", imagens: 3, analise: { encaminhadaAoPerito: true, decisaoDoPerito: null, indiceDanoBps: 500 } },
            { id: "b", criado_em: "2026-10-02T00:00:00Z", fechado_em: "2026-10-02T01:00:00Z", imagens: 3, analise: { encaminhadaAoPerito: true, decisaoDoPerito: "rejeitada" } },
            { id: "c", criado_em: "2026-10-03T00:00:00Z", fechado_em: "2026-10-03T01:00:00Z", imagens: 3 },
          ],
        },
      },
    });

    expect(await achar("com o perito")).toBeTruthy();
    expect(await achar("rejeitada pelo perito")).toBeTruthy();
    expect(await achar("aguardando analise")).toBeTruthy();
  });
});

const PRODUTO = {
  id: "pr1",
  nome: "Estiagem escalonada — soja",
  cultura: "soja",
  operador: 2,
  modoPagamento: 1,
  limiarClimatico: 30,
  limiarClimaticoIntegral: 60,
  limiarDanoBps: 4000,
  limiarDanoIntegralBps: 8000,
  valorPorHectareEth: "0.006",
  taxaPremioBps: 380,
  vigenciaDias: 180,
};

const HISTORICO = {
  aplicavel: true,
  estacoes: ["A747", "A770"],
  regra: "1 mm de chuva por dia; dia sem medicao interrompe a contagem",
  observacao: "O produto tambem aciona pelo indice de dano; a frequencia abaixo considera so o clima, e por isso e um piso.",
  anos: [
    { ano: 2023, maiorIndice: 36, coberturaDosDados: 1, avaliado: true, acionaria: true, percentualBps: 5500 },
    { ano: 2024, maiorIndice: 18, coberturaDosDados: 1, avaliado: true, acionaria: false, percentualBps: 0 },
    { ano: 2025, maiorIndice: 15, coberturaDosDados: 0.4, avaliado: false, acionaria: false, percentualBps: 0 },
  ],
  anosAvaliados: 2,
  acionamentos: 1,
  frequencia: 0.5,
  pagamentoMedioBps: 2750,
};

describe("cotacao e contratacao (RF06, RNF04, HU10)", () => {
  test("mostra limite, premio, exemplos do que aciona e o historico da localidade, e envia a proposta", async () => {
    const { chamadas } = await abrir("/produtor/cotacao", {
      perfil: "produtor",
      rotas: {
        "GET /talhoes": { talhoes: [TALHAO] },
        "GET /produtos": { produtos: [PRODUTO] },
        "POST /cotacoes": { cotacao: { areaSeguradaHa: "180", valorIndenizacaoWei: "1080000000000000000", premioWei: "41040000000000000", termos: PRODUTO, historico: HISTORICO } },
        "POST /propostas": { status: 201, corpo: { proposta: { id: "p1", situacao: "pendente" } } },
      },
    });

    fireEvent.change(await screen.findByLabelText("Produto"), { target: { value: "pr1" } });

    expect(await achar(/teria acionado em/)).toBeTruthy();
    expect(await achar(/sem dados suficientes/)).toBeTruthy();
    expect(await achar(/por isso e um piso/)).toBeTruthy();
    expect(screen.getAllByText("Sim").length).toBeGreaterThan(0);

    fireEvent.change(screen.getByLabelText("Inicio da cobertura"), { target: { value: "2026-11-01" } });
    await waitFor(() => expect(chamadas.some((c) => c.caminho === "/cotacoes" && c.corpo.inicioDaVigencia === "2026-11-01")).toBe(true));

    fireEvent.click(await screen.findByRole("button", { name: "Enviar proposta a seguradora" }));
    await waitFor(() => expect(chamadas.some((c) => c.caminho === "/propostas" && c.corpo.inicioDaVigencia === "2026-11-01")).toBe(true));
  });

  test("produto por dano explica que nao ha historico publico", async () => {
    await abrir("/produtor/cotacao", {
      perfil: "produtor",
      rotas: {
        "GET /talhoes": { talhoes: [TALHAO] },
        "GET /produtos": { produtos: [{ ...PRODUTO, operador: 1 }] },
        "POST /cotacoes": { cotacao: { areaSeguradaHa: "180", valorIndenizacaoWei: "1", premioWei: "1", termos: PRODUTO, historico: { aplicavel: false, motivo: "A condicao deste produto e o indice de dano das imagens da lavoura, que nao tem historico publico." } } },
      },
    });

    fireEvent.change(await screen.findByLabelText("Produto"), { target: { value: "pr1" } });
    expect(await achar(/nao tem historico publico/)).toBeTruthy();
  });

  test("sem carteira vinculada, nao deixa enviar a proposta", async () => {
    await abrir("/produtor/cotacao", {
      perfil: "produtor",
      rotas: {
        "GET /autenticacao/eu": { usuario: { ...USUARIOS.produtor, carteira: null } },
        "GET /talhoes": { talhoes: [TALHAO] },
        "GET /produtos": { produtos: [PRODUTO] },
        "POST /cotacoes": { cotacao: { areaSeguradaHa: "180", valorIndenizacaoWei: "1", premioWei: "1", termos: PRODUTO, historico: HISTORICO } },
      },
    });

    fireEvent.change(await screen.findByLabelText("Produto"), { target: { value: "pr1" } });
    expect((await screen.findByRole("button", { name: "Enviar proposta a seguradora" })).disabled).toBe(true);
  });
});

describe("revisao tecnica do perito (RF17, RF28)", () => {
  const rotas = (extra = {}) => ({
    "GET /perito/analises": {
      analises: [
        { id: "a1", talhao: "talhao-01", imagens: 7, indice_dano_bps: 998, confianca_bps: 6200, versao_modelo: "visao-unet-2.0.0-cpu", hash_evidencias: `0x${"ab".repeat(32)}`, criada_em: "2026-10-07T00:00:00Z", encaminhada_ao_perito: true, decisao_do_perito: null },
        { id: "a2", talhao: "talhao-01", imagens: 5, indice_dano_bps: 300, confianca_bps: 9000, versao_modelo: "v", encaminhada_ao_perito: false },
        { id: "a3", talhao: "talhao-01", imagens: 5, indice_dano_bps: 300, confianca_bps: 5000, versao_modelo: "v", encaminhada_ao_perito: true, decisao_do_perito: "rejeitada", parecer_do_perito: "Imagens desfocadas." },
      ],
    },
    "GET /contestacoes": {
      contestacoes: [{ id: "c1", talhao: "talhao-01", periodo: 20261007, indice_original_bps: 1200, motivo: "A metade norte secou.", produtor_nome: "Joao Ribeiro", apolice_endereco: "0xa1", situacao: "aberta" }],
    },
    "POST /perito/analises/:id/parecer": { ok: true },
    "POST /perito/contestacoes/:id/parecer": { ok: true },
    ...extra,
  });

  test("libera uma analise de baixa confianca com parecer", async () => {
    const { chamadas } = await abrir("/perito", { perfil: "perito", rotas: rotas() });

    fireEvent.change(await screen.findByLabelText("Parecer", { selector: "#parecer-a1" }), { target: { value: "Estresse visivel nas bordas." } });
    fireEvent.click(screen.getByRole("button", { name: "Liberar indice" }));

    expect(await achar(/Analise liberada/)).toBeTruthy();
    expect(chamadas.find((c) => c.caminho === "/perito/analises/a1/parecer").corpo.decisao).toBe("liberada");
    expect(await achar("Imagens desfocadas.")).toBeTruthy();
  });

  test("defere a contestacao com o indice retificado em pontos-base", async () => {
    const { chamadas } = await abrir("/perito", { perfil: "perito", rotas: rotas() });

    const cartao = (await screen.findByText(/periodo 20261007/)).closest(".cartao");
    fireEvent.change(within(cartao).getByLabelText("Parecer"), { target: { value: "Reexame confirma 30%." } });
    fireEvent.change(within(cartao).getByLabelText("Indice de dano retificado (%)"), { target: { value: "30,5" } });
    fireEvent.click(within(cartao).getByRole("button", { name: "Deferir e retificar" }));

    expect(await achar(/Contestacao deferida/)).toBeTruthy();
    expect(chamadas.find((c) => c.caminho === "/perito/contestacoes/c1/parecer").corpo).toEqual({
      decisao: "deferida",
      parecer: "Reexame confirma 30%.",
      indiceRetificadoBps: 3050,
    });
  });

  test("indefere a contestacao, e o erro do servidor aparece quando ha", async () => {
    await abrir("/perito", {
      perfil: "perito",
      rotas: rotas({ "POST /perito/contestacoes/:id/parecer": { status: 409, corpo: { erro: { mensagem: "Esta contestacao ja recebeu parecer." } } } }),
    });

    const cartao = (await screen.findByText(/periodo 20261007/)).closest(".cartao");
    fireEvent.change(within(cartao).getByLabelText("Parecer"), { target: { value: "As fotos mostram a lavoura bem." } });
    fireEvent.click(within(cartao).getByRole("button", { name: "Indeferir" }));

    expect(await achar("Esta contestacao ja recebeu parecer.")).toBeTruthy();
  });
});
