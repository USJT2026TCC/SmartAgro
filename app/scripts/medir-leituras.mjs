/**
 * RNF01, segunda parte: o tempo das consultas que leem eventos na rede.
 *
 * O detalhe da apolice nao confia no banco para o que importa: le estado,
 * publicacoes e linha do tempo direto da cadeia (RF09). Este script roda as
 * MESMAS funcoes do aplicativo (src/cadeia/contratos.js), carregadas pelo Vite
 * com a rede escolhida, contra um no publico, e mede cada uma.
 *
 *   node scripts/medir-leituras.mjs --rede sepolia --repeticoes 5
 *
 * Com --blocos N, mede tambem a leitura de eventos sobre os N blocos mais
 * recentes: 1300000 e o tamanho da janela no fim de uma vigencia de 180 dias.
 *
 * Endereco do no: --rpc, ou RPC_URL; padrao: o no publico da Sepolia.
 */

import { parseArgs } from "node:util";

import { ethers } from "ethers";
import { createServer } from "vite";

const { values: opcoes } = parseArgs({
  options: {
    rede: { type: "string", default: "sepolia" },
    rpc: { type: "string", default: process.env.RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com" },
    repeticoes: { type: "string", default: "5" },
    blocos: { type: "string", default: "0" },
  },
});

// O modulo de rede le VITE_REDE ao ser carregado, como no navegador.
process.env.VITE_REDE = opcoes.rede;

const vite = await createServer({ server: { middlewareMode: true }, appType: "custom", logLevel: "error" });

try {
  const cadeia = await vite.ssrLoadModule("/src/cadeia/contratos.js");
  const implantacoes = (await vite.ssrLoadModule("/src/cadeia/implantacoes.json")).default;
  const provedor = new ethers.JsonRpcProvider(opcoes.rpc);

  const apolices = await cadeia.listarApolices(provedor);
  const endereco = apolices.at(-1).endereco;
  const blocos = (await provedor.getBlockNumber()) - implantacoes[opcoes.rede].blocoInicial;

  const consultas = {
    "lerApolice (estado e termos)": () => cadeia.lerApolice(endereco, provedor),
    "lerPublicacoes (eventos)": () => cadeia.lerPublicacoes(endereco, provedor),
    "lerLinhaDoTempo (eventos)": () => cadeia.lerLinhaDoTempo(endereco, provedor),
    "listarApolices (fabrica)": () => cadeia.listarApolices(provedor),
  };

  console.log(`Rede..........: ${opcoes.rede}, no ${opcoes.rpc}`);
  console.log(`Apolice.......: ${endereco}`);
  console.log(`Eventos lidos.: ${blocos} blocos desde a implantacao`);
  console.log("");
  console.log("Consulta".padEnd(32), "media".padStart(9), "min".padStart(9), "max".padStart(9));

  for (const [nome, consulta] of Object.entries(consultas)) {
    const tempos = [];
    for (let i = 0; i < Number(opcoes.repeticoes); i++) {
      const inicio = performance.now();
      await consulta();
      tempos.push(performance.now() - inicio);
    }
    const fmt = (v) => `${(v / 1000).toFixed(2)} s`.padStart(9);
    console.log(nome.padEnd(32), fmt(tempos.reduce((a, b) => a + b) / tempos.length), fmt(Math.min(...tempos)), fmt(Math.max(...tempos)));
  }

  // A tela abre as tres primeiras ao mesmo tempo.
  const inicio = performance.now();
  await Promise.all([
    cadeia.lerApolice(endereco, provedor),
    cadeia.lerPublicacoes(endereco, provedor),
    cadeia.lerLinhaDoTempo(endereco, provedor),
  ]);
  console.log("");
  console.log(`Tela de detalhe completa (as tres em paralelo): ${((performance.now() - inicio) / 1000).toFixed(2)} s`);

  if (Number(opcoes.blocos) > 0) {
    const contrato = cadeia.contratoApolice(endereco, provedor);
    const desde = (await provedor.getBlockNumber()) - Number(opcoes.blocos);
    const t = performance.now();
    const eventos = await cadeia.eventosEmTrechos(contrato, "*", desde, provedor);
    const pedidos = Math.ceil(Number(opcoes.blocos) / cadeia.BLOCOS_POR_CONSULTA);
    console.log(
      `Eventos sobre ${opcoes.blocos} blocos (fim de uma vigencia): ${((performance.now() - t) / 1000).toFixed(1)} s, ` +
        `${pedidos} pedidos, ${eventos.length} eventos`,
    );
  }
} finally {
  await vite.close();
}
