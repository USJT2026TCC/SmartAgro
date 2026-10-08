"use strict";

/**
 * Integracao do oraculo contra uma blockchain de verdade.
 *
 * Os testes unitarios usam publicador e backend falsos. O publicador, porem,
 * conversa com o no — ensaia a chamada, estima o gas, envia, espera a
 * confirmacao, decodifica eventos —, e um falso so testaria o falso. Aqui o teste:
 *
 *   1. sobe um `hardhat node` proprio, em porta separada;
 *   2. implanta os contratos a partir dos artefatos de compilacao;
 *   3. roda os COMANDOS do oraculo como o operador rodaria, em processos
 *      separados, com ambiente isolado (sem o .env local);
 *   4. exercita o publicador direto: vigencia, retificacao e escuta de eventos.
 *
 * Roda com `npm run testar:integracao`. Fica fora da suite principal porque
 * depende dos artefatos compilados em `contratos/` e leva alguns segundos.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const { ethers } = require("ethers");

const CONTRATOS = path.join(__dirname, "..", "..", "contratos");
const ORACULO = path.join(__dirname, "..");
const PORTA = 8598;
const RPC = `http://127.0.0.1:${PORTA}`;
const FRASE = "test test test test test test test test test test test junk";
const chaveDaConta = (i) =>
  ethers.HDNodeWallet.fromPhrase(FRASE, undefined, `m/44'/60'/0'/0/${i}`).privateKey;

const DIA = 86_400;

function artefato(nome) {
  return JSON.parse(
    fs.readFileSync(path.join(CONTRATOS, "artifacts", "contracts", `${nome}.sol`, `${nome}.json`), "utf8"),
  );
}

async function esperarNo(provedor) {
  for (let i = 0; i < 60; i += 1) {
    try {
      await provedor.getBlockNumber();
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  throw new Error(`O hardhat node nao respondeu em ${RPC}.`);
}

test.describe("oraculo contra um no real", { timeout: 240_000 }, () => {
  let no;
  let provedor;
  let fabrica;
  let registry;
  let ambiente;
  let apoliceClimatica;

  /** Roda um comando do oraculo como o operador rodaria. */
  function oraculo(...argumentos) {
    const r = spawnSync(process.execPath, [path.join(ORACULO, "src", "index.js"), ...argumentos], {
      env: ambiente,
      encoding: "utf8",
      timeout: 120_000,
    });
    return { codigo: r.status, saida: `${r.stdout}${r.stderr}` };
  }

  async function emitir(sobrescritos = {}) {
    const [seguradora, produtor] = await Promise.all([0, 1].map((i) => provedor.getSigner(i)));
    const agora = (await provedor.getBlock("latest")).timestamp;
    const termos = {
      produtor: await produtor.getAddress(),
      registry: ethers.ZeroAddress,
      cultura: ethers.encodeBytes32String("soja"),
      talhao: ethers.encodeBytes32String("talhao-01"),
      operador: 0,
      modoPagamento: 0,
      limiarClimatico: 30,
      limiarClimaticoIntegral: 0,
      limiarDanoBps: 0,
      limiarDanoIntegralBps: 0,
      vigenciaInicio: agora,
      vigenciaFim: agora + 180 * DIA,
      valorIndenizacao: ethers.parseEther("1"),
      hashTermos: ethers.keccak256(ethers.toUtf8Bytes(`termos-${Math.random()}`)),
      ...sobrescritos,
    };

    await (await fabrica.connect(seguradora).emitirApolice(termos)).wait();
    const endereco = await fabrica.apolices((await fabrica.totalApolices()) - 1n);
    const apolice = new ethers.Contract(endereco, artefato("ApolicePolicy").abi, seguradora);
    await (await apolice.depositarGarantia({ value: termos.valorIndenizacao })).wait();

    return endereco;
  }

  test.before(async () => {
    if (!fs.existsSync(path.join(CONTRATOS, "artifacts", "contracts"))) {
      const r = spawnSync("npx", ["hardhat", "compile"], { cwd: CONTRATOS, shell: true, stdio: "inherit" });
      assert.equal(r.status, 0, "falha ao compilar os contratos");
    }

    no = spawn("npx", ["hardhat", "node", "--port", String(PORTA)], {
      cwd: CONTRATOS,
      shell: true,
      stdio: "ignore",
    });

    provedor = new ethers.JsonRpcProvider(RPC, 31337, { staticNetwork: true });
    await esperarNo(provedor);

    const seguradora = await provedor.getSigner(0);
    const enderecoOraculo = new ethers.Wallet(chaveDaConta(2)).address;
    const blocoInicial = await provedor.getBlockNumber();

    const fabricaDe = (nome) => {
      const a = artefato(nome);
      return new ethers.ContractFactory(a.abi, a.bytecode, seguradora);
    };

    registry = await fabricaDe("OracleRegistry").deploy(await seguradora.getAddress());
    await registry.waitForDeployment();
    await (await registry.autorizar(enderecoOraculo)).wait();

    fabrica = await fabricaDe("ApoliceFactory").deploy(
      await registry.getAddress(),
      await seguradora.getAddress(),
    );
    await fabrica.waitForDeployment();

    const temporario = fs.mkdtempSync(path.join(os.tmpdir(), "agrosmart-oraculo-"));
    fs.writeFileSync(
      path.join(temporario, "integracao.json"),
      JSON.stringify({
        rede: "integracao",
        chainId: 31337,
        blocoInicial,
        contratos: {
          OracleRegistry: await registry.getAddress(),
          ApoliceFactory: await fabrica.getAddress(),
        },
      }),
    );
    const envVazio = path.join(temporario, "vazio.env");
    fs.writeFileSync(envVazio, "");

    // Ambiente isolado: nada do .env local entra, nem o backend.
    ambiente = {
      PATH: process.env.PATH,
      SystemRoot: process.env.SystemRoot,
      NODE_V8_COVERAGE: process.env.NODE_V8_COVERAGE ?? "",
      ARQUIVO_ENV: envVazio,
      REDE: "integracao",
      RPC_URL: RPC,
      CHAVE_PRIVADA_ORACULO: chaveDaConta(2),
      DIR_IMPLANTACOES: temporario,
      DIR_DADOS: path.join(temporario, "dados"),
      ESPERA_BASE_MS: "50",
    };
    if (!ambiente.NODE_V8_COVERAGE) delete ambiente.NODE_V8_COVERAGE;

    apoliceClimatica = await emitir();
  });

  test.after(() => {
    provedor?.destroy();
    if (process.platform === "win32" && no?.pid) {
      spawnSync("taskkill", ["/PID", String(no.pid), "/T", "/F"], { stdio: "ignore" });
    } else {
      no?.kill();
    }
  });

  test("status: endereco, saldo e autorizacao no registro", () => {
    const { codigo, saida } = oraculo("status");
    assert.equal(codigo, 0, saida);
    assert.match(saida, /Autorizado a publicar: sim/);
    assert.match(saida, /Rede\.+: integracao/);
  });

  test("publicar um periodo de safra normal nao aciona", () => {
    const { codigo, saida } = oraculo(
      "publicar", "--apolice", apoliceClimatica, "--periodo", "20261001", "--cenario", "safra_normal",
    );
    assert.equal(codigo, 0, saida);
    assert.match(saida, /20261001/);
    assert.doesNotMatch(saida, /SIM/);
  });

  test("publicar o mesmo periodo de novo e recusado pelo contrato (RF20)", () => {
    const { saida } = oraculo(
      "publicar", "--apolice", apoliceClimatica, "--periodo", "20261001", "--cenario", "safra_normal",
    );
    // A fila ja sabe que o periodo foi concluido; nem chega a gastar uma chamada.
    assert.match(saida, /ja publicado antes \(0x[0-9a-f]{64}\)/);
  });

  test("ciclo de estiagem severa, com leituras defeituosas, aciona e paga", () => {
    const { codigo, saida } = oraculo(
      "ciclo", "--apolice", apoliceClimatica, "--cenario", "estiagem_severa",
      "--periodo", "20261020", "--periodos", "8", "--com-falhas",
    );
    assert.equal(codigo, 0, saida);
    assert.match(saida, /SIM/);
  });

  test("fila e estatisticas mostram o que foi publicado", () => {
    const fila = oraculo("fila");
    assert.equal(fila.codigo, 0, fila.saida);
    assert.match(fila.saida, /concluida/);

    const reaberta = oraculo("fila", "--reabrir", "chave-que-nao-existe");
    assert.match(reaberta.saida, /nao encontrada/);

    const estatisticas = oraculo("estatisticas");
    assert.equal(estatisticas.codigo, 0, estatisticas.saida);
    assert.match(estatisticas.saida, /"acionamentos": 1/);
  });

  test("comando desconhecido mostra a ajuda e sai com erro", () => {
    const { codigo, saida } = oraculo("comando-que-nao-existe");
    assert.equal(codigo, 1);
    assert.match(saida, /Uso: node src\/index\.js/);
  });

  test("publicador: vigencia, retificacao (RF28) e escuta de eventos", async () => {
    const { Publicador } = require("../src/publicador");
    const publicador = new Publicador({ rpcUrl: RPC, chavePrivada: chaveDaConta(2), chainId: 31337 });

    try {
      assert.equal(await publicador.estaAutorizado(await registry.getAddress()), true);
      assert.ok((await publicador.saldo()) > 0n);

      const agora = (await provedor.getBlock("latest")).timestamp;
      const futura = await emitir({ vigenciaInicio: agora + 10 * DIA, vigenciaFim: agora + 190 * DIA });
      assert.equal(await publicador.dentroDaVigencia(futura), false);
      assert.equal(await publicador.dentroDaVigencia(apoliceClimatica), true);

      const porDano = await emitir({ operador: 1, limiarClimatico: 0, limiarDanoBps: 2_000 });
      const recebidos = [];
      const pararDeOuvir = await publicador.ouvir(porDano, (e) => recebidos.push(e));

      const original = await publicador.publicar({
        apolice: porDano,
        periodo: 20261101,
        indiceClimatico: 0,
        indiceDanoBps: 1_200,
        confiancaBps: 8_000,
      });
      assert.equal(original.acionouPagamento, false);
      assert.equal(await publicador.periodoJaPublicado(porDano, 20261101), true);
      assert.equal(await publicador.situacaoDaApolice(porDano), "ATIVA");

      const retificada = await publicador.publicarRetificacao({
        apolice: porDano,
        periodo: 20261101,
        indiceDanoBps: 3_000,
        hashParecer: ethers.keccak256(ethers.toUtf8Bytes("parecer")),
      });
      assert.equal(retificada.acionouPagamento, true);
      assert.equal(await publicador.periodoJaRetificado(porDano, 20261101), true);
      assert.equal(await publicador.situacaoDaApolice(porDano), "LIQUIDADA");

      // A escuta e por sondagem; da tempo de os eventos chegarem.
      for (let i = 0; i < 40 && recebidos.length === 0; i += 1) {
        await new Promise((r) => setTimeout(r, 250));
      }
      pararDeOuvir();
      assert.ok(recebidos.length > 0, "a escuta deveria ter recebido os eventos da apolice");
    } finally {
      publicador.encerrar();
    }
  });
});
