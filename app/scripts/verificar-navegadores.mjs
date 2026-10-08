/**
 * RNF05: o aplicativo nos navegadores instalados na maquina.
 *
 * Gera o pacote de producao para a rede escolhida, serve-o com `vite preview`
 * (que repassa /api ao backend, como o proxy reverso em producao) e percorre,
 * em cada navegador, o caminho da seguradora: entrar, ver a carteira e abrir o
 * detalhe de uma apolice, que le estado e eventos direto da rede.
 *
 * A carteira e um provedor EIP-1193 injetado em window.ethereum antes de a
 * pagina carregar — o mesmo protocolo que a MetaMask injeta nos tres
 * navegadores. Assim se verifica a integracao do aplicativo com o padrao, sem
 * depender de extensao instalada no perfil de teste.
 *
 * Usa os navegadores ja instalados (playwright-core nao baixa nenhum):
 *
 *   node scripts/verificar-navegadores.mjs --rede sepolia --apolice 0x...
 *
 * Precisa do backend no ar, acompanhando a mesma rede.
 */

import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";

import { chromium } from "playwright-core";
import { build, preview } from "vite";

const { values: opcoes } = parseArgs({
  options: {
    rede: { type: "string", default: "sepolia" },
    apolice: { type: "string" },
    porta: { type: "string", default: "4173" },
  },
});
if (!opcoes.apolice) throw new Error("Informe --apolice 0x... (uma apolice da rede, com publicacao)");

const CHAIN_IDS = { sepolia: 11155111, localhost: 31337 };
const CONTA = "0x95eA48b7BF91446CF12C156aC2FDeA75Af03fD70";

// Navegadores Chromium usam o protocolo do Playwright direto; o Firefox exige a
// versao modificada do Playwright, que precisaria ser baixada (ver COMO-RODAR.md).
const NAVEGADORES = [
  { nome: "Chrome", canal: "chrome" },
  { nome: "Edge", canal: "msedge" },
];

process.env.VITE_REDE = opcoes.rede;
const saida = join(tmpdir(), `agrosmart-rnf05-${opcoes.rede}`);
await build({ logLevel: "warn", build: { outDir: saida, emptyOutDir: true } });
const servidor = await preview({ build: { outDir: saida }, preview: { port: Number(opcoes.porta), strictPort: true }, logLevel: "warn" });
const BASE = `http://localhost:${opcoes.porta}`;

function carteiraInjetada({ conta, chainId }) {
  const pedidos = [];
  window.__pedidosDaCarteira = pedidos;
  window.ethereum = {
    isMetaMask: false,
    async request({ method, params }) {
      pedidos.push(method);
      if (method === "eth_accounts" || method === "eth_requestAccounts") return [conta];
      if (method === "eth_chainId") return `0x${chainId.toString(16)}`;
      if (method === "net_version") return String(chainId);
      throw Object.assign(new Error(`metodo nao simulado: ${method}`), { code: 4200 });
    },
    on() {},
    removeListener() {},
  };
  localStorage.setItem("agrosmart:carteira-conectada", "sim");
}

const resultados = [];

try {
  for (const { nome, canal } of NAVEGADORES) {
    const etapas = [];
    const erros = [];
    let versao = "nao instalado";

    try {
      const navegador = await chromium.launch({ channel: canal, headless: true });
      versao = navegador.version();
      const pagina = await navegador.newPage();
      pagina.on("pageerror", (e) => erros.push(e.message));
      pagina.on("console", (m) => m.type() === "error" && erros.push(m.text()));
      // O console diz so "404"; a resposta diz de que endereco.
      pagina.on("response", (r) => r.status() >= 400 && erros.push(`${r.status()} ${new URL(r.url()).pathname}`));
      await pagina.addInitScript(carteiraInjetada, { conta: CONTA, chainId: CHAIN_IDS[opcoes.rede] });

      const medir = async (etapa, acao) => {
        console.log(`${nome}: ${etapa}...`);
        const inicio = performance.now();
        await acao();
        etapas.push(`${etapa} (${((performance.now() - inicio) / 1000).toFixed(1)} s)`);
      };

      await medir("entrar", async () => {
        await pagina.goto(`${BASE}/entrar`);
        await pagina.getByLabel("Identificador").fill("seguradora");
        await pagina.getByLabel("Senha").fill("agrosmart");
        await pagina.getByRole("button", { name: "Entrar", exact: true }).click();
        await pagina.getByText("Filtros do relatorio").waitFor({ timeout: 15_000 });
      });

      await medir("carteira injetada reconhecida", async () => {
        // O selo verde do cabecalho so aparece com a conta conectada E na rede
        // certa; com a rede errada, o cabecalho oferece a troca.
        await pagina.locator(`header .selo.sucesso[title="${CONTA}"]`).waitFor({ timeout: 10_000 });
      });

      await medir("detalhe da apolice lido da rede", async () => {
        await pagina.goto(`${BASE}/apolice/${opcoes.apolice}`);
        await pagina.getByText("Oraculo publicou os indices do periodo").first().waitFor({ timeout: 30_000 });
      });

      const pedidos = await pagina.evaluate(() => window.__pedidosDaCarteira);
      etapas.push(`pedidos a carteira: ${[...new Set(pedidos)].join(", ")}`);
      await navegador.close();
    } catch (erro) {
      erros.push(erro.message.split("\n")[0]);
    }

    // 401 da sessao antes do login e esperado; o resto conta como erro.
    const relevantes = erros.filter((e) => !/401|Unauthorized/.test(e));
    resultados.push({ nome, versao, etapas, erros: relevantes });
  }
} finally {
  await new Promise((r) => servidor.httpServer.close(r));
  rmSync(saida, { recursive: true, force: true });
}

for (const r of resultados) {
  console.log(`${r.nome} ${r.versao}: ${r.erros.length ? "FALHOU" : "ok"}`);
  for (const e of r.etapas) console.log(`  - ${e}`);
  for (const e of r.erros) console.log(`  ! ${e}`);
}
process.exitCode = resultados.some((r) => r.erros.length) ? 1 : 0;
