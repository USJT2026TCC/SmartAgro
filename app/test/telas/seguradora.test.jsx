/**
 * Telas da seguradora: propostas e emissao (RF07, UC05), oraculos (RF18),
 * fontes (RF11, RF13), carteira e relatorio (RF29), talhoes e produtos (RF03,
 * RF05, HU09).
 */
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

import { CONTA_DA_SEGURADORA, abrir, achar, carteiraFalsa } from "./ambiente";

const TX = `0x${"12".repeat(32)}`;
const transacao = () => ({ hash: TX, wait: vi.fn(async () => ({ status: 1 })) });

const cadeia = vi.hoisted(() => ({
  seguradora: null,
  situacao: 0n,
  oraculos: [],
  chamadas: [],
}));

vi.mock("../../src/cadeia/contratos", () => ({
  contratoFactory: vi.fn(() => ({
    seguradora: async () => cadeia.seguradora,
    emitirApolice: vi.fn(async (termos) => {
      cadeia.chamadas.push(["emitirApolice", termos]);
      return transacao();
    }),
  })),
  contratoApolice: vi.fn((endereco) => ({
    situacao: async () => cadeia.situacao,
    depositarGarantia: vi.fn(async (opcoes) => {
      cadeia.chamadas.push(["depositarGarantia", endereco, opcoes.value]);
      return transacao();
    }),
  })),
  contratoRegistry: vi.fn(() => ({
    seguradora: async () => cadeia.seguradora,
    autorizar: vi.fn(async (e) => {
      cadeia.chamadas.push(["autorizar", e]);
      return transacao();
    }),
    revogar: vi.fn(async (e) => {
      cadeia.chamadas.push(["revogar", e]);
      return transacao();
    }),
  })),
  listarOraculos: vi.fn(async () => cadeia.oraculos),
}));

// O Leaflet desenha com medidas do navegador, que o jsdom nao tem. O mapa falso
// guarda o tratador de clique, e o teste "clica" nele com coordenadas.
const mapa = vi.hoisted(() => ({ aoClicar: null, desenhados: [] }));
vi.mock("leaflet", () => {
  const camada = () => ({ addTo: () => camada(), clearLayers: () => {} });
  return {
    default: {
      map: () => ({
        on: (evento, f) => {
          if (evento === "click") mapa.aoClicar = f;
        },
        remove: () => {},
        fitBounds: () => {},
      }),
      tileLayer: camada,
      layerGroup: camada,
      circleMarker: () => camada(),
      polygon: (pontos) => {
        mapa.desenhados.push(pontos);
        return camada();
      },
    },
  };
});

afterEach(() => {
  cleanup();
  delete window.ethereum;
  localStorage.clear();
  cadeia.chamadas.length = 0;
  cadeia.seguradora = CONTA_DA_SEGURADORA;
  cadeia.situacao = 0n;
});

cadeia.seguradora = CONTA_DA_SEGURADORA;

const PROPOSTA = {
  id: "p1",
  situacao: "pendente",
  produtor: { nome: "Joao Ribeiro" },
  carteiraProdutor: "0x70997970c51812dc3a010c7d01b50e0d17dc79c8",
  talhao: { identificador: "talhao-01", cultura: "soja" },
  produto: { nome: "Estiagem — soja" },
  areaSeguradaHa: "180",
  termos: { limiarClimatico: 30, limiarDanoBps: 0 },
  valorIndenizacaoWei: "1080000000000000000",
  premioWei: "48600000000000000",
  hashTermos: null,
  apolice: null,
};

describe("propostas e emissao (RF07, UC05)", () => {
  test("sem carteira, a emissao fica bloqueada e o motivo aparece", async () => {
    await abrir("/seguradora/propostas", { perfil: "seguradora", rotas: { "GET /propostas": { propostas: [PROPOSTA] } } });

    expect(await achar("Carteira nao conectada.")).toBeTruthy();
    expect((await screen.findByRole("button", { name: "Emitir apolice na rede" })).disabled).toBe(true);
  });

  test("emite: o servidor prepara, a carteira assina, o servidor confere", async () => {
    carteiraFalsa(CONTA_DA_SEGURADORA);
    const { chamadas } = await abrir("/seguradora/propostas", {
      perfil: "seguradora",
      rotas: {
        "GET /propostas": { propostas: [PROPOSTA] },
        "POST /propostas/:id/preparar": { termos: { produtor: "0x1" }, hashTermos: `0x${"ab".repeat(32)}`, descricaoDosTermos: "x" },
        "POST /propostas/:id/emissao": { apolice: { endereco: "0x00000000000000000000000000000000000a9011" } },
      },
    });

    const botao = await screen.findByRole("button", { name: "Emitir apolice na rede" });
    await waitFor(() => expect(botao.disabled).toBe(false));
    fireEvent.click(botao);

    expect(await achar(/conferida pelo servidor/)).toBeTruthy();
    expect(cadeia.chamadas[0][0]).toBe("emitirApolice");
    expect(chamadas.find((c) => c.caminho === "/propostas/p1/emissao").corpo.txHash).toBe(TX);
  });

  test("deposita a garantia de uma apolice emitida sem lastro", async () => {
    carteiraFalsa(CONTA_DA_SEGURADORA);
    const emitida = {
      ...PROPOSTA,
      situacao: "emitida",
      hashTermos: `0x${"ab".repeat(32)}`,
      apolice: { endereco: "0x00000000000000000000000000000000000a9011", txEmissao: TX },
    };
    await abrir("/seguradora/propostas", { perfil: "seguradora", rotas: { "GET /propostas": { propostas: [emitida] } } });

    const botao = await screen.findByRole("button", { name: /Depositar/ });
    await waitFor(() => expect(botao.disabled).toBe(false));
    fireEvent.click(botao);

    expect(await achar(/A apolice esta ativa/)).toBeTruthy();
    expect(cadeia.chamadas[0]).toEqual(["depositarGarantia", emitida.apolice.endereco, 1080000000000000000n]);
  });

  test("carteira que nao e a seguradora da fabrica e avisada (RNF10)", async () => {
    carteiraFalsa("0x90F79bf6EB2c4f870365E785982E1f101E93b906");
    await abrir("/seguradora/propostas", { perfil: "seguradora", rotas: { "GET /propostas": { propostas: [] } } });

    expect(await achar("Esta carteira nao e a seguradora da fabrica.")).toBeTruthy();
    expect(await achar("Nenhuma proposta recebida.")).toBeTruthy();
  });

  test("recusar chama o servidor", async () => {
    const { chamadas } = await abrir("/seguradora/propostas", {
      perfil: "seguradora",
      rotas: { "GET /propostas": { propostas: [PROPOSTA] }, "POST /propostas/:id/recusar": { ok: true } },
    });

    fireEvent.click(await screen.findByRole("button", { name: "Recusar" }));
    await waitFor(() => expect(chamadas.some((c) => c.caminho === "/propostas/p1/recusar")).toBe(true));
  });
});

describe("oraculos autorizados (RF18)", () => {
  test("lista, autoriza e revoga pela carteira da seguradora", async () => {
    carteiraFalsa(CONTA_DA_SEGURADORA);
    cadeia.oraculos = [
      { endereco: "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC", autorizado: true },
      { endereco: "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65", autorizado: false },
    ];
    await abrir("/seguradora/oraculos", { perfil: "seguradora" });

    const revogar = await screen.findByRole("button", { name: "Revogar" });
    await waitFor(() => expect(revogar.disabled).toBe(false));
    fireEvent.click(revogar);
    expect(await achar(/Endereco revogado/)).toBeTruthy();

    const campo = screen.getByLabelText(/Endereco/);
    fireEvent.change(campo, { target: { value: "nao-e-endereco" } });
    fireEvent.submit(campo.closest("form"));
    expect(await achar(/Endereco invalido/)).toBeTruthy();

    fireEvent.change(campo, { target: { value: "0x9965507d1a55bcc2695c58ba16fb37d819b0a4dc" } });
    fireEvent.submit(campo.closest("form"));
    expect(await achar(/Endereco autorizado/)).toBeTruthy();
    expect(cadeia.chamadas.map((c) => c[0])).toEqual(["revogar", "autorizar"]);
  });
});

describe("fontes de dados (RF11, RF13)", () => {
  test("registra uma fonte e desativa outra", async () => {
    const { chamadas } = await abrir("/seguradora/fontes", {
      perfil: "seguradora",
      rotas: {
        "GET /fontes": {
          fontes: [
            { id: "estacao-inmet-a770", tipo: "estacao", endereco: "0xBcd4042DE499D14e55001CcbB24a551F3b954096", talhao: "talhao-01", escore: "0.42", observacoes: 3312, ultima_leitura_em: "2026-10-07T00:00:00Z", ativa: true },
          ],
        },
        "GET /talhoes": { talhoes: [{ id: "t1", identificador: "talhao-01" }] },
        "POST /fontes": { fonte: { id: "nova" } },
        "PATCH /fontes/:id": { ok: true },
      },
    });

    expect(await achar("fora do indice")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Desativar" }));
    await waitFor(() => expect(chamadas.some((c) => c.metodo === "PATCH" && c.corpo.ativa === false)).toBe(true));

    fireEvent.change(screen.getByLabelText("Identificador"), { target: { value: "sensor-02" } });
    fireEvent.click(screen.getByRole("button", { name: "Registrar" }));
    expect(await achar(/Fonte sensor-02 registrada/)).toBeTruthy();
  });
});

const RELATORIO = {
  filtros: {},
  opcoesDeFiltro: { culturas: ["milho", "soja"], regioes: ["Sao Simao/SP"] },
  carteira: { apolices: 2, ativas: 1, aguardando_garantia: 0, liquidadas: 1, encerradas: 0, canceladas: 0, limite_total_wei: "2000000000000000000", pago_total_wei: "1000000000000000000", taxaDeAcionamento: 0.5 },
  porCultura: [{ cultura: "soja", apolices: 2, liquidadas: 1, pago_total_wei: "1000000000000000000" }],
  porRegiao: [{ regiao: "Sao Simao/SP", apolices: 2, liquidadas: 1, pago_total_wei: "1000000000000000000" }],
  liquidacao: { pagamentos: 1, media_horas: 6, maximo_horas: 6 },
  publicacoes: { total: 3, com_acionamento: 1, gas_minimo: "172000", gas_maximo: "231000", gas_medio: "190000", gas_medio_sem_acionar: "172000", gas_medio_acionando: "231000", latencia_media_ms: 170, latencia_p95_ms: 200 },
  fontes: { total: 3, ativas: 3, abaixo_do_limiar: 0 },
  propostasPendentes: 1,
};

describe("carteira e relatorio (RF29)", () => {
  test("indicadores, quebra por cultura e regiao, e filtro que refaz a consulta", async () => {
    const { chamadas } = await abrir("/seguradora", {
      perfil: "seguradora",
      rotas: {
        "GET /relatorios/carteira": RELATORIO,
        "GET /apolices": {
          apolices: [{ endereco: "0xa1", talhao: "talhao-01", cultura: "soja", produtor: { nome: "Joao", carteira: "0x1" }, emitidaEm: "2026-10-01T00:00:00Z", valorIndenizacaoWei: "1", valorPagoWei: "0", situacao: 1 }],
        },
        "GET /saude": { banco: { motor: "pglite" }, indexador: { ativo: true, ultimoErro: { mensagem: "no fora do ar" } } },
      },
    });

    expect(await achar("6 h")).toBeTruthy();
    expect(await achar(/1 proposta\(s\) aguardando emissao/)).toBeTruthy();
    expect(await achar("O indexador nao esta alcancando a rede.")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Cultura"), { target: { value: "soja" } });
    await waitFor(() =>
      expect(chamadas.some((c) => c.caminho === "/relatorios/carteira" && c.consulta.get("cultura") === "soja")).toBe(true),
    );

    fireEvent.click(await screen.findByRole("button", { name: "Limpar filtros" }));
  });
});

describe("talhoes, produtores e produtos (RF03, RF05, HU09)", () => {
  const TALHAO = {
    id: "t1",
    identificador: "talhao-01",
    cultura: "soja",
    areaHa: "459.05",
    poligono: { type: "Polygon", coordinates: [[[-47.59, -21.45], [-47.57, -21.45], [-47.57, -21.47], [-47.59, -21.47], [-47.59, -21.45]]] },
    propriedade: { id: "pp1", nome: "Fazenda Santa Clara", municipio: "Sao Simao/SP" },
    produtor: { id: "u1", nome: "Joao Ribeiro" },
    fontesAtivas: 1,
    atendeMinimoDeFontes: false,
  };

  function rotasBase(extra = {}) {
    return {
      "GET /talhoes": { talhoes: [TALHAO] },
      "GET /produtos": {
        produtos: [{ id: "pr1", nome: "Estiagem — soja", cultura: "soja", operador: 0, modoPagamento: 0, limiarClimatico: 30, limiarDanoBps: 0, valorPorHectareEth: "0.006", taxaPremioBps: 450, vigenciaDias: 180, ativo: true }],
      },
      "GET /produtores": { produtores: [{ id: "u1", identificador: "produtor", nome: "Joao Ribeiro", documento: "123" }] },
      "GET /propriedades": { propriedades: [{ id: "pp1", nome: "Fazenda Santa Clara", municipio: "Sao Simao/SP", produtor_nome: "Joao Ribeiro", talhoes: 1 }] },
      ...extra,
    };
  }

  test("cadastra produtor e edita a propriedade", async () => {
    const { chamadas } = await abrir("/seguradora/talhoes", {
      perfil: "seguradora",
      rotas: rotasBase({ "POST /produtores": { produtor: { nome: "Maria" } }, "PATCH /propriedades/:id": { propriedade: {} } }),
    });

    fireEvent.change(await screen.findByLabelText("Identificador de acesso"), { target: { value: "maria" } });
    fireEvent.change(screen.getByLabelText("Nome", { selector: "#novo-nome" }), { target: { value: "Maria" } });
    fireEvent.change(screen.getByLabelText("Senha inicial"), { target: { value: "senha-longa-123" } });
    fireEvent.click(screen.getByRole("button", { name: "Cadastrar produtor" }));
    expect(await achar(/Produtor Maria cadastrado/)).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Municipio de Fazenda Santa Clara"), { target: { value: "Cravinhos/SP" } });
    const linha = screen.getByLabelText("Municipio de Fazenda Santa Clara").closest("tr");
    fireEvent.click(within(linha).getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(chamadas.some((c) => c.metodo === "PATCH" && c.corpo.municipio === "Cravinhos/SP")).toBe(true));
  });

  test("cadastra talhao pelo poligono digitado e mostra a area do PostGIS", async () => {
    const { chamadas } = await abrir("/seguradora/talhoes", {
      perfil: "seguradora",
      rotas: rotasBase({ "POST /talhoes": { talhao: { identificador: "talhao-09", areaHa: "377.63" } } }),
    });

    fireEvent.change(await screen.findByPlaceholderText("talhao-03"), { target: { value: "talhao-09" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar talhao" }));

    expect(await achar(/Area medida pelo PostGIS: 377.63 ha/)).toBeTruthy();
    expect(chamadas.find((c) => c.caminho === "/talhoes" && c.metodo === "POST").corpo.poligono.length).toBe(4);
  });

  test("desenha o talhao clicando no mapa (HU09, criterio 1)", async () => {
    await abrir("/seguradora/talhoes", { perfil: "seguradora", rotas: rotasBase() });

    fireEvent.click((await screen.findAllByRole("button", { name: "Limpar" }))[0]);
    for (const [lat, lng] of [[-21.45, -47.59], [-21.45, -47.57], [-21.47, -47.57]]) {
      mapa.aoClicar({ latlng: { lat, lng } });
    }

    await waitFor(() =>
      expect(screen.getByLabelText("Vertices (lon, lat)").value).toBe("[[-47.59,-21.45],[-47.57,-21.45],[-47.57,-21.47]]"),
    );
    expect(await achar("3 vertice(s). Clique no mapa para marcar.")).toBeTruthy();

    fireEvent.click(screen.getAllByRole("button", { name: "Desfazer ponto" })[0]);
    await waitFor(() => expect(screen.getByLabelText("Vertices (lon, lat)").value).toBe("[[-47.59,-21.45],[-47.57,-21.45]]"));
  });

  test("importa o poligono de um arquivo GeoJSON", async () => {
    await abrir("/seguradora/talhoes", { perfil: "seguradora", rotas: rotasBase() });

    const geojson = JSON.stringify({ type: "Feature", geometry: TALHAO.poligono });
    const arquivo = new File([geojson], "talhao.geojson", { type: "application/geo+json" });
    arquivo.text = async () => geojson; // o File do jsdom nao tem text()
    fireEvent.change(await screen.findByLabelText("Importar GeoJSON"), { target: { files: [arquivo] } });

    await waitFor(() => expect(screen.getByLabelText("Vertices (lon, lat)").value).toContain("-47.59"));
  });

  test("poligono que nao e JSON e recusado antes de ir ao servidor", async () => {
    await abrir("/seguradora/talhoes", { perfil: "seguradora", rotas: rotasBase() });

    fireEvent.change(await screen.findByLabelText("Vertices (lon, lat)"), { target: { value: "[[1,2]," } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar talhao" }));
    expect(await achar(/O poligono precisa ser JSON valido/)).toBeTruthy();
  });

  test("edita um talhao sem proposta e remove outro", async () => {
    const { chamadas } = await abrir("/seguradora/talhoes", {
      perfil: "seguradora",
      rotas: rotasBase({ "PATCH /talhoes/:id": { talhao: { identificador: "talhao-01", areaHa: "100" } }, "DELETE /talhoes/:id": { status: 204, corpo: null } }),
    });

    fireEvent.click(await screen.findByRole("button", { name: "Editar" }));
    fireEvent.change(screen.getByLabelText("Cultura", { selector: "#cultura-edicao" }), { target: { value: "milho" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Salvar talhao" }).at(-1));
    expect(await achar(/Talhao talhao-01 atualizado/)).toBeTruthy();
    expect(chamadas.find((c) => c.metodo === "PATCH").corpo.cultura).toBe("milho");

    fireEvent.click(screen.getByRole("button", { name: "Remover" }));
    await waitFor(() => expect(chamadas.some((c) => c.metodo === "DELETE")).toBe(true));
  });

  test("configura um produto escalonado por dano", async () => {
    const { chamadas } = await abrir("/seguradora/talhoes", {
      perfil: "seguradora",
      rotas: rotasBase({ "POST /produtos": { produto: { nome: "Seca" } } }),
    });

    await screen.findByText("Configurar produto indexado");
    const formulario = screen.getByText("Configurar produto indexado").closest("form");
    fireEvent.change(within(formulario).getAllByRole("textbox")[0], { target: { value: "Seca escalonada" } });
    fireEvent.submit(formulario);

    await waitFor(() => expect(chamadas.some((c) => c.metodo === "POST" && c.caminho === "/produtos")).toBe(true));
  });
});
