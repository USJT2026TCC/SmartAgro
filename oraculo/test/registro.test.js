"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { RegistroDePublicacoes } = require("../src/registro");

/**
 * Testes do registro de auditoria (RF22, RNF20).
 *
 * Sao os numeros deste arquivo que vao para o capitulo de resultados do TCC, entao
 * o que se verifica aqui e que nada se perde e que as contas batem.
 */

function novoRegistro() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agrosmart-registro-"));

  return new RegistroDePublicacoes(path.join(dir, "publicacoes.jsonl"));
}

function publicacao(extra = {}) {
  return {
    apolice: "0x75537828f2ce51be7289709686A69CbFDbB714F1",
    periodo: 20261015,
    indices: { indiceClimatico: 31, indiceDanoBps: 0, confiancaBps: 9500 },
    txHash: "0xabc",
    gasUsado: 172165n,
    bloco: 42,
    enviadoEm: "2026-10-15T12:00:00.000Z",
    confirmadoEm: "2026-10-15T12:00:12.000Z",
    acionouPagamento: false,
    ...extra,
  };
}

test("registrar calcula a latencia entre envio e confirmacao", () => {
  const registro = novoRegistro();
  const linha = registro.registrar(publicacao());

  assert.equal(linha.latenciaMs, 12000);
  assert.equal(linha.gasUsado, "172165");
});

test("registrar serializa BigInt sem estourar o JSON", () => {
  const registro = novoRegistro();

  registro.registrar(publicacao({ custoWei: 123456789012345678n }));

  const [linha] = registro.listar();

  assert.equal(linha.custoWei, "123456789012345678");
});

test("cada publicacao vira uma linha propria, e nenhuma sobrescreve a anterior", () => {
  const registro = novoRegistro();

  registro.registrar(publicacao({ periodo: 20261013 }));
  registro.registrar(publicacao({ periodo: 20261014 }));
  registro.registrar(publicacao({ periodo: 20261015 }));

  assert.deepEqual(
    registro.listar().map((l) => l.periodo),
    [20261013, 20261014, 20261015],
  );
});

test("listar devolve vazio quando nada foi registrado", () => {
  assert.deepEqual(novoRegistro().listar(), []);
  assert.equal(novoRegistro().estatisticas(), null);
});

test("estatisticas agregam gas minimo, maximo, medio e latencia", () => {
  const registro = novoRegistro();

  registro.registrar(publicacao({ periodo: 20261013, gasUsado: 100000n }));
  registro.registrar(publicacao({ periodo: 20261014, gasUsado: 200000n }));
  registro.registrar(
    publicacao({
      periodo: 20261015,
      gasUsado: 300000n,
      acionouPagamento: true,
      confirmadoEm: "2026-10-15T12:00:24.000Z",
    }),
  );

  const estatisticas = registro.estatisticas();

  assert.equal(estatisticas.publicacoes, 3);
  assert.equal(estatisticas.gasMinimo, "100000");
  assert.equal(estatisticas.gasMaximo, "300000");
  assert.equal(estatisticas.gasMedio, "200000");
  assert.equal(estatisticas.latenciaMediaMs, 16000); // (12 + 12 + 24) / 3 segundos
  assert.equal(estatisticas.acionamentos, 1);
});

test("a procedencia do indice fica gravada junto com a transacao (RNF20)", () => {
  const registro = novoRegistro();

  registro.registrar(
    publicacao({
      procedencia: {
        fontesUsadas: ["estacao-inmet-A770", "sensor-solo-talhao-01"],
        fontesDescartadas: ["sensor-quebrado"],
        limiarChuvaMm: 1,
      },
    }),
  );

  const [linha] = registro.listar();

  assert.deepEqual(linha.procedencia.fontesUsadas, ["estacao-inmet-A770", "sensor-solo-talhao-01"]);
  assert.deepEqual(linha.procedencia.fontesDescartadas, ["sensor-quebrado"]);
});
