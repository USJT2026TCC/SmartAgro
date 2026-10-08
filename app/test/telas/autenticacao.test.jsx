/**
 * Entrada, segundo fator, perfis e sessao expirada (RF01, RF04, HU13).
 */
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import { USUARIOS, abrir, achar } from "./ambiente";

vi.mock("../../src/cadeia/contratos", () => ({
  listarApolices: vi.fn(async () => []),
  resumirCarteira: vi.fn(() => ({ total: 0, ativas: 0, liquidadas: 0, pagoWei: 0n })),
}));

function preencherEEntrar(identificador, senha) {
  fireEvent.change(screen.getByLabelText("Identificador"), { target: { value: identificador } });
  fireEvent.change(screen.getByLabelText("Senha"), { target: { value: senha } });
  fireEvent.click(screen.getByRole("button", { name: "Entrar" }));
}

describe("autenticacao e perfis", () => {
  test("sem sessao, qualquer tela leva ao login", async () => {
    await abrir("/seguradora/propostas");
    expect(await screen.findByRole("heading", { name: "AgroSmart" })).toBeTruthy();
    expect(screen.getByLabelText("Identificador")).toBeTruthy();
  });

  test("login com senha correta leva a tela do perfil", async () => {
    const { chamadas } = await abrir("/entrar", {
      rotas: {
        "POST /autenticacao/entrar": { token: "t", usuario: USUARIOS.produtor },
        "GET /apolices": { apolices: [] },
      },
    });

    preencherEEntrar("produtor", "agrosmart");

    await achar(/Minhas apolices/);
    const login = chamadas.find((c) => c.caminho === "/autenticacao/entrar");
    expect(login.corpo).toEqual({ identificador: "produtor", senha: "agrosmart" });
    expect(sessionStorage.getItem("agrosmart:token")).toBe("t");
  });

  test("senha errada mostra a mensagem do servidor", async () => {
    await abrir("/entrar", {
      rotas: {
        "POST /autenticacao/entrar": {
          status: 401,
          corpo: { erro: { codigo: "nao_autenticado", mensagem: "Identificador ou senha invalidos." } },
        },
      },
    });

    preencherEEntrar("produtor", "errada");

    expect(await achar("Identificador ou senha invalidos.")).toBeTruthy();
  });

  test("com segundo fator, pede o codigo de 6 digitos antes de entrar (RF01)", async () => {
    const { chamadas } = await abrir("/entrar", {
      rotas: {
        "POST /autenticacao/entrar": { segundoFatorPendente: true, token: "parcial" },
        "POST /autenticacao/segundo-fator": { token: "completo", usuario: USUARIOS.seguradora },
        "GET /relatorios/carteira": { status: 500, corpo: {} },
        "GET /apolices": { apolices: [] },
        "GET /saude": {},
      },
    });

    preencherEEntrar("seguradora", "agrosmart");

    const campo = await screen.findByLabelText("Codigo");
    fireEvent.change(campo, { target: { value: "123456" } });
    fireEvent.submit(campo.closest("form"));

    await waitFor(() =>
      expect(chamadas.some((c) => c.caminho === "/autenticacao/segundo-fator" && c.corpo.codigo === "123456")).toBe(true),
    );
    expect(sessionStorage.getItem("agrosmart:token")).toBe("completo");
  });

  test("os atalhos de demonstracao preenchem o formulario", async () => {
    await abrir("/entrar");
    fireEvent.click((await screen.findAllByRole("button", { name: "Usar" }))[0]);
    expect(screen.getByLabelText("Identificador").value).not.toBe("");
  });

  test("perfil errado vai para 'sem acesso' (RF04)", async () => {
    await abrir("/seguradora/propostas", { perfil: "produtor", rotas: { "GET /apolices": { apolices: [] } } });
    expect(await achar("Sem acesso")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Voltar ao inicio" }));
    await achar(/Minhas apolices/);
  });

  test("endereco inexistente mostra a pagina de nao encontrada", async () => {
    await abrir("/nao-existe", { perfil: "perito" });
    expect(await achar("Pagina nao encontrada")).toBeTruthy();
  });

  test("sessao expirada no servidor volta ao login (HU13, criterio 3)", async () => {
    await abrir("/notificacoes", {
      perfil: "perito",
      rotas: { "GET /notificacoes": { status: 401, corpo: { erro: { mensagem: "Sessao expirada." } } } },
    });

    expect(await screen.findByLabelText("Identificador", {}, { timeout: 3000 })).toBeTruthy();
    expect(sessionStorage.getItem("agrosmart:token")).toBeNull();
  });

  test("sair encerra a sessao no servidor e localmente", async () => {
    const { chamadas } = await abrir("/perito", {
      perfil: "perito",
      rotas: { "GET /perito/analises": { analises: [] }, "GET /contestacoes": { contestacoes: [] } },
    });

    fireEvent.click(await screen.findByRole("button", { name: "Sair" }));

    await screen.findByLabelText("Identificador");
    expect(chamadas.some((c) => c.caminho === "/autenticacao/sair")).toBe(true);
  });
});
