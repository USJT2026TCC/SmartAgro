/**
 * RNF01: tempo de resposta das consultas de apolice atendidas pelo banco.
 *
 * Simula `--usuarios` pessoas usando o aplicativo ao mesmo tempo, cada uma
 * repetindo o que a tela faz: lista as apolices e abre o detalhe de uma delas.
 * Mede cada requisicao do envio ao fim da resposta e imprime os percentis.
 *
 *   node scripts/medir-consultas.js --usuarios 20 --segundos 30
 *
 * Precisa do backend no ar (npm run iniciar) e dos usuarios de demonstracao.
 */

import { parseArgs } from "node:util";

const { values: opcoes } = parseArgs({
  options: {
    api: { type: "string", default: process.env.API_URL || "http://localhost:3001/api" },
    usuarios: { type: "string", default: "20" },
    segundos: { type: "string", default: "30" },
  },
});

const API = opcoes.api;
const USUARIOS = Number(opcoes.usuarios);
const DURACAO_MS = Number(opcoes.segundos) * 1000;
const LIMITE_MS = 2000;

async function entrar(identificador) {
  const r = await fetch(`${API}/autenticacao/entrar`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identificador, senha: "agrosmart" }),
  });
  const corpo = await r.json();
  if (!corpo.token) throw new Error(`Nao foi possivel entrar como ${identificador}: ${JSON.stringify(corpo)}`);
  return corpo.token;
}

async function medir(rota, token, tempos) {
  const inicio = performance.now();
  const r = await fetch(`${API}${rota}`, { headers: { Authorization: `Bearer ${token}` } });
  await r.arrayBuffer();
  tempos.push({ rota: rota.startsWith("/apolices/") ? "/apolices/:endereco" : rota, ms: performance.now() - inicio, ok: r.ok });
}

function percentil(ordenados, p) {
  return ordenados[Math.min(ordenados.length - 1, Math.ceil((p / 100) * ordenados.length) - 1)];
}

async function main() {
  // Metade como seguradora (carteira inteira), metade como produtor.
  const tokens = { seguradora: await entrar("seguradora"), produtor: await entrar("produtor") };
  const { apolices } = await (
    await fetch(`${API}/apolices`, { headers: { Authorization: `Bearer ${tokens.seguradora}` } })
  ).json();
  if (!apolices.length) throw new Error("Nenhuma apolice no banco: emita uma antes de medir.");

  const tempos = [];
  const fim = Date.now() + DURACAO_MS;

  await Promise.all(
    Array.from({ length: USUARIOS }, async (_, i) => {
      const token = i % 2 ? tokens.produtor : tokens.seguradora;
      while (Date.now() < fim) {
        await medir("/apolices", token, tempos);
        await medir(`/apolices/${apolices[i % apolices.length].endereco}`, tokens.seguradora, tempos);
      }
    }),
  );

  console.log(`Backend.......: ${API}`);
  console.log(`Carga.........: ${USUARIOS} usuarios simultaneos por ${DURACAO_MS / 1000} s, sem pausa entre pedidos`);
  console.log(`Apolices......: ${apolices.length} no banco`);
  console.log("");
  console.log("Rota".padEnd(22), "Pedidos".padStart(8), "Erros".padStart(6), "p50".padStart(8), "p95".padStart(8), "p99".padStart(8), "max".padStart(8));

  const grupos = [...new Set(tempos.map((t) => t.rota)), "todas"];
  for (const rota of grupos) {
    const daRota = rota === "todas" ? tempos : tempos.filter((t) => t.rota === rota);
    const ms = daRota.map((t) => t.ms).sort((a, b) => a - b);
    const fmt = (v) => `${v.toFixed(0)} ms`.padStart(8);
    console.log(
      rota.padEnd(22),
      String(ms.length).padStart(8),
      String(daRota.filter((t) => !t.ok).length).padStart(6),
      fmt(percentil(ms, 50)),
      fmt(percentil(ms, 95)),
      fmt(percentil(ms, 99)),
      fmt(ms.at(-1)),
    );
  }

  const todas = tempos.map((t) => t.ms).sort((a, b) => a - b);
  const dentro = todas.filter((ms) => ms <= LIMITE_MS).length / todas.length;
  console.log("");
  console.log(`Dentro de ${LIMITE_MS} ms: ${(dentro * 100).toFixed(2)}% (RNF01 pede 95%)`);
}

main().catch((erro) => {
  console.error(erro.message);
  process.exitCode = 1;
});
