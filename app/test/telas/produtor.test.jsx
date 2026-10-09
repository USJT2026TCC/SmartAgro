/**
 * Telas do produtor: apolices, carteira (RF02, HU07), conta (RF01) e avisos (RF27).
 */
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

import { CONTA_DO_PRODUTOR, USUARIOS, abrir, achar, carteiraFalsa } from "./ambiente";

vi.mock("qrcode", () => ({
  default: { toDataURL: vi.fn(async () => "data:image/png;base64,AAAA") },
}));

afterEach(() => {
  // Desmonta antes de remover a carteira: a tela tira os ouvintes ao sair.
  cleanup();
  delete window.ethereum;
  localStorage.clear();
});

const APOLICE = "0x00000000000000000000000000000000000a9011";

describe("minhas apolices", () => {
  test("lista propostas em andamento e apolices, com o valor recebido", async () => {
    await abrir("/produtor", {
      perfil: "produtor",
      rotas: {
        "GET /propostas": {
          propostas: [
            {
              id: "p1",
              situacao: "preparada",
              talhao: { identificador: "talhao-01" },
              produto: { nome: "Estiagem — soja" },
              valorIndenizacaoWei: "1000000000000000000",
            },
            {
              id: "p2",
              situacao: "emitida",
              talhao: { identificador: "talhao-01" },
              produto: { nome: "x" },
              valorIndenizacaoWei: "1",
            },
          ],
        },
        "GET /apolices": {
          apolices: [
            {
              endereco: APOLICE,
              talhao: "talhao-01",
              cultura: "soja",
              situacao: 2,
              valorIndenizacaoWei: "10000000000000000",
              valorPagoWei: "10000000000000000",
              emitidaEm: "2026-10-07T00:00:00Z",
              produtor: { carteira: CONTA_DO_PRODUTOR },
            },
          ],
        },
      },
    });

    expect(await achar("aguardando assinatura")).toBeTruthy();
    expect(await achar(/Recebeu 0,01 ETH/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Detalhes" }).getAttribute("href")).toBe(
      `/apolice/${APOLICE}`,
    );
  });

  test("sem carteira vinculada, avisa e aponta a tela de vinculo", async () => {
    await abrir("/produtor", {
      perfil: "produtor",
      rotas: {
        "GET /autenticacao/eu": { usuario: { ...USUARIOS.produtor, carteira: null } },
        "GET /propostas": { propostas: [] },
        "GET /apolices": { apolices: [] },
      },
    });

    expect(await achar(/Nenhuma carteira vinculada/)).toBeTruthy();
  });
});

describe("minha carteira (RF02, HU07)", () => {
  test("sem extensao no navegador, explica o que instalar", async () => {
    await abrir("/produtor/carteira", { perfil: "produtor" });
    expect(await achar("Nenhuma carteira encontrada no navegador.")).toBeTruthy();
  });

  test("vincula assinando o desafio do servidor, sem expor a chave", async () => {
    const outra = "0x90F79bf6EB2c4f870365E785982E1f101E93b906";
    const ethereum = carteiraFalsa(outra);

    const { chamadas } = await abrir("/produtor/carteira", {
      perfil: "produtor",
      rotas: {
        "POST /carteira/desafio": {
          desafioId: "d1",
          mensagem: "AgroSmart: vincular carteira\nnonce 42",
        },
        "POST /carteira/vincular": { ok: true },
      },
    });

    expect(await achar("A carteira conectada e outra.")).toBeTruthy();
    fireEvent.click(
      await screen.findByRole("button", { name: "Assinar e vincular esta carteira" }),
    );

    expect(await achar(/Titularidade comprovada/)).toBeTruthy();
    const vinculo = chamadas.find((c) => c.caminho === "/carteira/vincular");
    expect(vinculo.corpo.desafioId).toBe("d1");
    expect(vinculo.corpo.endereco.toLowerCase()).toBe(outra.toLowerCase());
    expect(ethereum.pedidos.some((p) => p.method === "personal_sign")).toBe(true);
  });

  test("carteira conectada e a vinculada; desvincular chama o servidor", async () => {
    carteiraFalsa(CONTA_DO_PRODUTOR);
    const { chamadas } = await abrir("/produtor/carteira", {
      perfil: "produtor",
      rotas: { "DELETE /carteira": { status: 204, corpo: null } },
    });

    expect(await achar("Esta e a carteira vinculada ao seu cadastro.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Desvincular" }));
    await waitFor(() =>
      expect(chamadas.some((c) => c.metodo === "DELETE" && c.caminho === "/carteira")).toBe(true),
    );
  });

  test("carteira em outra rede oferece a troca", async () => {
    const ethereum = carteiraFalsa(CONTA_DO_PRODUTOR, { chainId: 1 });
    await abrir("/produtor/carteira", { perfil: "produtor" });

    // O cabecalho tambem oferece a troca; o da pagina e o ultimo.
    const botoes = await screen.findAllByRole("button", { name: /Trocar para/ });
    fireEvent.click(botoes.at(-1));
    await waitFor(() =>
      expect(ethereum.pedidos.some((p) => p.method === "wallet_switchEthereumChain")).toBe(true),
    );
  });
});

describe("minha conta: segundo fator (RF01)", () => {
  test("configura com QR e ativa com o codigo", async () => {
    const { chamadas } = await abrir("/conta", {
      perfil: "seguradora",
      rotas: {
        "POST /autenticacao/totp/iniciar": { segredo: "JBSWY3DPEHPK3PXP", uri: "otpauth://totp/x" },
        "POST /autenticacao/totp/ativar": { ok: true },
      },
    });

    fireEvent.click(await screen.findByRole("button", { name: "Configurar segundo fator" }));
    expect(await screen.findByAltText("Codigo QR do segundo fator")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Codigo"), { target: { value: "12a3456" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar e ativar" }));

    expect(await achar(/Segundo fator ativado/)).toBeTruthy();
    expect(chamadas.find((c) => c.caminho === "/autenticacao/totp/ativar").corpo.codigo).toBe(
      "123456",
    );
  });

  test("desativar exige o codigo atual, e o erro do servidor aparece", async () => {
    await abrir("/conta", {
      perfil: "seguradora",
      rotas: {
        "GET /autenticacao/eu": { usuario: { ...USUARIOS.seguradora, segundoFatorAtivo: true } },
        "POST /autenticacao/totp/desativar": {
          status: 400,
          corpo: { erro: { mensagem: "Codigo invalido." } },
        },
      },
    });

    fireEvent.change(await screen.findByLabelText("Codigo atual"), { target: { value: "000000" } });
    fireEvent.click(screen.getByRole("button", { name: "Desativar segundo fator" }));
    expect(await achar("Codigo invalido.")).toBeTruthy();
  });
});

describe("avisos (RF27)", () => {
  test("lista, marca uma e marca todas como lidas", async () => {
    const lista = {
      notificacoes: [
        {
          id: 1,
          titulo: "Indenizacao paga",
          mensagem: "0,01 ETH transferidos.",
          criada_em: "2026-10-07T12:00:00Z",
          apolice_endereco: APOLICE,
          tx_hash: `0x${"ab".repeat(32)}`,
          lida_em: null,
        },
        {
          id: 2,
          titulo: "Cobertura ativa",
          mensagem: "Garantia depositada.",
          criada_em: "2026-10-06T12:00:00Z",
          lida_em: "2026-10-06T13:00:00Z",
        },
      ],
      naoLidas: 1,
    };
    const { chamadas } = await abrir("/notificacoes", {
      perfil: "produtor",
      rotas: {
        "GET /notificacoes": lista,
        "POST /notificacoes/:id/lida": { ok: true },
        "POST /notificacoes/lidas": { ok: true },
      },
    });

    expect(await achar("Indenizacao paga")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Ver apolice" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Marcar como lida" }));
    await waitFor(() =>
      expect(chamadas.some((c) => c.caminho === "/notificacoes/1/lida")).toBe(true),
    );

    fireEvent.click(screen.getByRole("button", { name: "Marcar todas como lidas" }));
    await waitFor(() =>
      expect(chamadas.some((c) => c.caminho === "/notificacoes/lidas")).toBe(true),
    );
  });

  test("sem avisos, diz isso", async () => {
    await abrir("/notificacoes", { perfil: "perito" });
    expect(await achar("Nenhuma notificacao.")).toBeTruthy();
  });
});
