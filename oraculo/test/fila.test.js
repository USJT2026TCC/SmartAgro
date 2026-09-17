"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { FilaDePublicacoes, ESTADOS } = require("../src/fila");

/**
 * Testes da fila de publicacoes (RF21, RNF22).
 *
 * O que se verifica aqui e que nenhum indice se perde: nem quando a rede cai, nem
 * quando o processo do oraculo morre no meio de uma tentativa.
 */

function arquivoTemporario() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agrosmart-fila-"));

  return path.join(dir, "fila.json");
}

function novaFila(opcoes = {}) {
  return new FilaDePublicacoes(arquivoTemporario(), opcoes);
}

const APOLICE = "0x75537828f2ce51be7289709686A69CbFDbB714F1";

test("enfileirar cria uma entrada pendente", () => {
  const fila = novaFila();
  const { entrada, novo } = fila.enfileirar({
    apolice: APOLICE,
    periodo: 20261015,
    payload: { indiceClimatico: 31 },
  });

  assert.equal(novo, true);
  assert.equal(entrada.estado, ESTADOS.PENDENTE);
  assert.equal(entrada.tentativas, 0);
  assert.deepEqual(fila.resumo(), {
    total: 1,
    pendente: 1,
    publicando: 0,
    concluida: 0,
    falha: 0,
  });
});

test("enfileirar o mesmo periodo duas vezes nao duplica a entrada", () => {
  const fila = novaFila();
  const dados = { apolice: APOLICE, periodo: 20261015, payload: { indiceClimatico: 31 } };

  fila.enfileirar(dados);
  const segunda = fila.enfileirar(dados);

  assert.equal(segunda.novo, false);
  assert.equal(fila.resumo().total, 1);
});

test("o endereco da apolice e comparado sem diferenciar maiusculas", () => {
  const fila = novaFila();

  fila.enfileirar({ apolice: APOLICE, periodo: 20261015, payload: {} });
  fila.enfileirar({ apolice: APOLICE.toLowerCase(), periodo: 20261015, payload: {} });

  assert.equal(fila.resumo().total, 1);
});

test("marcarPublicando incrementa as tentativas", () => {
  const fila = novaFila();
  const { entrada } = fila.enfileirar({ apolice: APOLICE, periodo: 20261015, payload: {} });

  fila.marcarPublicando(entrada);

  assert.equal(entrada.estado, ESTADOS.PUBLICANDO);
  assert.equal(entrada.tentativas, 1);
});

test("uma tentativa falha devolve a entrada para pendente, sem perde-la", () => {
  const fila = novaFila({ maxTentativas: 3 });
  const { entrada } = fila.enfileirar({ apolice: APOLICE, periodo: 20261015, payload: {} });

  fila.marcarPublicando(entrada);
  fila.marcarErro(entrada, new Error("rede indisponivel"));

  assert.equal(entrada.estado, ESTADOS.PENDENTE);
  assert.equal(entrada.ultimoErro.mensagem, "rede indisponivel");
  assert.equal(fila.proxima(), entrada);
});

test("esgotadas as tentativas, a entrada vai para falha e sai da fila de trabalho", () => {
  const fila = novaFila({ maxTentativas: 2 });
  const { entrada } = fila.enfileirar({ apolice: APOLICE, periodo: 20261015, payload: {} });

  for (let i = 0; i < 2; i += 1) {
    fila.marcarPublicando(entrada);
    fila.marcarErro(entrada, new Error("rede indisponivel"));
  }

  assert.equal(entrada.estado, ESTADOS.FALHA);
  assert.equal(fila.proxima(), undefined);
  assert.equal(fila.resumo().falha, 1);
});

test("reabrir zera as tentativas de uma entrada esgotada", () => {
  const fila = novaFila({ maxTentativas: 1 });
  const { entrada } = fila.enfileirar({ apolice: APOLICE, periodo: 20261015, payload: {} });

  fila.marcarPublicando(entrada);
  fila.marcarErro(entrada, new Error("falhou"));
  assert.equal(entrada.estado, ESTADOS.FALHA);

  const reaberta = fila.reabrir(entrada.chave);

  assert.equal(reaberta.estado, ESTADOS.PENDENTE);
  assert.equal(reaberta.tentativas, 0);
  assert.equal(fila.proxima(), reaberta);
});

test("reabrir uma chave inexistente devolve nulo", () => {
  assert.equal(novaFila().reabrir("0xabc:20261015"), null);
});

test("marcarConcluida tira a entrada da fila de trabalho e guarda o recibo", () => {
  const fila = novaFila();
  const { entrada } = fila.enfileirar({ apolice: APOLICE, periodo: 20261015, payload: {} });

  fila.marcarPublicando(entrada);
  fila.marcarConcluida(entrada, { txHash: "0xabc", gasUsado: "231216" });

  assert.equal(entrada.estado, ESTADOS.CONCLUIDA);
  assert.equal(entrada.recibo.txHash, "0xabc");
  assert.equal(entrada.ultimoErro, null);
  assert.equal(fila.proxima(), undefined);
});

test("o estado sobrevive a queda do processo, preservando o periodo original", () => {
  const arquivo = arquivoTemporario();

  const antes = new FilaDePublicacoes(arquivo);
  const { entrada } = antes.enfileirar({
    apolice: APOLICE,
    periodo: 20261015,
    payload: { indiceClimatico: 31 },
  });

  // Simula o processo morrendo no meio de uma tentativa.
  antes.marcarPublicando(entrada);

  const depois = new FilaDePublicacoes(arquivo);
  const retomada = depois.proxima();

  assert.ok(retomada, "a entrada interrompida precisa voltar a ser candidata");
  assert.equal(retomada.periodo, 20261015);
  assert.equal(retomada.payload.indiceClimatico, 31);
  assert.equal(retomada.tentativas, 1);
});

test("fila corrompida falha de forma explicita, sem descartar o arquivo", () => {
  const arquivo = arquivoTemporario();
  fs.mkdirSync(path.dirname(arquivo), { recursive: true });
  fs.writeFileSync(arquivo, "{ isso nao e json");

  assert.throws(() => new FilaDePublicacoes(arquivo), /Fila corrompida/);
  assert.ok(fs.existsSync(arquivo), "o arquivo suspeito precisa continuar em disco");
});

test("pendentes lista apenas o que ainda precisa de atencao", () => {
  const fila = novaFila();

  const a = fila.enfileirar({ apolice: APOLICE, periodo: 20261014, payload: {} }).entrada;
  const b = fila.enfileirar({ apolice: APOLICE, periodo: 20261015, payload: {} }).entrada;

  fila.marcarPublicando(a);
  fila.marcarConcluida(a, { txHash: "0x1" });

  assert.deepEqual(
    fila.pendentes().map((e) => e.periodo),
    [b.periodo],
  );
});
