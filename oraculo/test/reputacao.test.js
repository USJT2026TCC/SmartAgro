"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { RegistroReputacao } = require("../src/reputacao");

/** Testes do escore de reputacao por fonte (RF13). */

function arquivoTemporario() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agrosmart-reputacao-"));

  return path.join(dir, "reputacao.json");
}

test("fonte nova comeca com o escore inicial", () => {
  const reputacao = new RegistroReputacao();

  assert.equal(reputacao.escore("estacao-nova"), 1);
  assert.equal(reputacao.observacoes("estacao-nova"), 0);
});

test("leitura valida mantem o escore alto e leitura invalida o derruba", () => {
  const reputacao = new RegistroReputacao({ alfa: 0.2 });

  reputacao.registrar("estacao-A", true);
  assert.equal(reputacao.escore("estacao-A"), 1);

  reputacao.registrar("estacao-A", false);
  assert.equal(reputacao.escore("estacao-A"), 0.8);
});

test("a media movel faz o escore cair rapido quando a fonte quebra", () => {
  const reputacao = new RegistroReputacao({ alfa: 0.3 });

  // Seis meses de funcionamento perfeito.
  for (let i = 0; i < 180; i += 1) reputacao.registrar("estacao-A", true);
  assert.equal(reputacao.escore("estacao-A"), 1);

  // Duas semanas com defeito ja bastam para sair de operacao.
  for (let i = 0; i < 14; i += 1) reputacao.registrar("estacao-A", false);
  assert.ok(reputacao.escore("estacao-A") < 0.01);
});

test("o escore se recupera quando a fonte volta a funcionar", () => {
  const reputacao = new RegistroReputacao({ alfa: 0.3 });

  for (let i = 0; i < 20; i += 1) reputacao.registrar("estacao-A", false);
  const fundo = reputacao.escore("estacao-A");

  for (let i = 0; i < 10; i += 1) reputacao.registrar("estacao-A", true);

  assert.ok(reputacao.escore("estacao-A") > fundo);
  assert.ok(reputacao.escore("estacao-A") > 0.5);
});

test("fontesAbaixoDe lista as fontes fora de operacao, da pior para a melhor", () => {
  const reputacao = new RegistroReputacao({ alfa: 0.5 });

  for (let i = 0; i < 6; i += 1) reputacao.registrar("pessima", false);
  for (let i = 0; i < 2; i += 1) reputacao.registrar("ruim", false);
  reputacao.registrar("boa", true);

  const abaixo = reputacao.fontesAbaixoDe(0.5);

  assert.deepEqual(
    abaixo.map((f) => f.fonte),
    ["pessima", "ruim"],
  );
});

test("alfa fora do intervalo valido e recusado", () => {
  assert.throws(() => new RegistroReputacao({ alfa: 0 }), /alfa/);
  assert.throws(() => new RegistroReputacao({ alfa: 1.5 }), /alfa/);
});

test("o estado sobrevive a um reinicio do servico", () => {
  const arquivo = arquivoTemporario();

  const primeiro = new RegistroReputacao({ alfa: 0.2, arquivo });
  primeiro.registrar("estacao-A", false);
  primeiro.registrar("estacao-A", false);
  primeiro.salvar();

  const segundo = new RegistroReputacao({ alfa: 0.2, arquivo });

  assert.equal(segundo.escore("estacao-A"), primeiro.escore("estacao-A"));
  assert.equal(segundo.observacoes("estacao-A"), 2);
});

test("instantaneo devolve o estado completo ordenado por fonte", () => {
  const reputacao = new RegistroReputacao();

  reputacao.registrar("zeta", true);
  reputacao.registrar("alfa", false);

  assert.deepEqual(
    reputacao.instantaneo().map((f) => f.fonte),
    ["alfa", "zeta"],
  );
});
