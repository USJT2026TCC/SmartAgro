#!/usr/bin/env node
"use strict";

const path = require("node:path");

const { ethers } = require("ethers");

const { config, lerImplantacao } = require("./config");
const { ServicoOraculo } = require("./oraculo");
const { somarDias, diaDe } = require("./consolidador");
const { CENARIOS, gerarLeituras } = require("./fonteSimulada");
const { FilaDePublicacoes } = require("./fila");
const { RegistroDePublicacoes } = require("./registro");

/**
 * Interface de linha de comando do servico de oraculo.
 *
 * Comandos:
 *   status                        situacao do oraculo: endereco, saldo, autorizacao
 *   servico                       publica continuamente as apolices ativas do backend
 *   ciclo    --apolice 0x...      roda um cenario climatico ate acionar ou esgotar
 *   publicar --apolice 0x...      consolida e publica um unico periodo
 *   ouvir    --apolice 0x...      acompanha os eventos da apolice em tempo real
 *   fila                          mostra a fila de publicacoes pendentes
 *   estatisticas                  gas e latencia das publicacoes ja realizadas
 */

// ---------------------------------------------------------------- utilitarios

function lerArgumentos(argv) {
  const opcoes = {};
  let chaveAtual = null;

  for (const pedaco of argv) {
    if (pedaco.startsWith("--")) {
      chaveAtual = pedaco.slice(2);
      opcoes[chaveAtual] = true;
    } else if (chaveAtual) {
      opcoes[chaveAtual] = pedaco;
      chaveAtual = null;
    }
  }

  return opcoes;
}

const titulo = (texto) => {
  console.log("");
  console.log(texto);
  console.log("-".repeat(texto.length));
};

function exigirApolice(opcoes) {
  const endereco = opcoes.apolice || process.env.ENDERECO_APOLICE;

  if (!endereco || !ethers.isAddress(endereco)) {
    throw new Error(
      "Informe o endereco da apolice: --apolice 0x... (ou defina ENDERECO_APOLICE no .env)",
    );
  }

  return ethers.getAddress(endereco);
}

/** Periodo de referencia informado, ou o dia de hoje. */
function periodoDe(opcoes) {
  if (opcoes.periodo && opcoes.periodo !== true) return Number(opcoes.periodo);

  return diaDe(new Date().toISOString());
}

/**
 * Cria o servico e guarda a referencia para que `main` possa encerrar a conexao
 * com o no ao final. Sem isso o processo termina de imprimir o resultado e nao
 * devolve o terminal, porque o temporizador de sondagem do provedor continua vivo.
 */
let servicoAtivo = null;

function criarServico(opcoes) {
  servicoAtivo = ServicoOraculo.criar(opcoes);

  return servicoAtivo;
}

// ---------------------------------------------------------------- comandos

async function comandoStatus() {
  const servico = criarServico();
  const implantacao = lerImplantacao();

  titulo("Servico de oraculo");
  console.log(`Rede...............: ${config.rede} (${config.rpcUrl})`);
  console.log(`Endereco do oraculo: ${servico.publicador.endereco}`);
  console.log(`Saldo..............: ${ethers.formatEther(await servico.publicador.saldo())} ETH`);

  const registry = implantacao.contratos.OracleRegistry;
  const autorizado = await servico.publicador.estaAutorizado(registry);

  console.log(`OracleRegistry.....: ${registry}`);
  console.log(`Autorizado a publicar: ${autorizado ? "sim" : "NAO"}`);

  if (!autorizado) {
    console.log("");
    console.log("O endereco nao esta autorizado. A seguradora precisa chamar");
    console.log(`  OracleRegistry.autorizar(${servico.publicador.endereco})`);
  }

  titulo("Fila e reputacao");
  console.log(JSON.stringify(servico.fila.resumo(), null, 2));
  console.log(JSON.stringify(servico.reputacao.instantaneo(), null, 2));
}

/**
 * De onde vem o dado de campo.
 *
 *  - "simulada": a serie deterministica de `fonteSimulada.js`, gerada aqui mesmo.
 *    Nao precisa de backend; e o modo usado ate a Sprint 1.
 *  - "backend": leituras assinadas na origem, guardadas pelo backend, e o
 *    resultado da visao computacional. E o modo do sistema integrado.
 *
 * Nos dois casos o oraculo consolida por conta propria. O backend entrega
 * leituras, nao indices.
 */
function fonteDeDados(servico, opcoes) {
  const tipo = opcoes.fonte === true || !opcoes.fonte ? "simulada" : opcoes.fonte;

  if (tipo === "simulada") {
    const cenario = opcoes.cenario === true || !opcoes.cenario ? "estiagem_severa" : opcoes.cenario;
    if (!CENARIOS[cenario]) {
      throw new Error(
        `Cenario desconhecido: ${cenario}. Disponiveis: ${Object.keys(CENARIOS).join(", ")}`,
      );
    }

    const cache = new Map();

    return {
      tipo,
      descricao: `fonte simulada, cenario ${cenario} — ${CENARIOS[cenario].descricao}`,
      async leiturasPara(_apolice, periodoFinal) {
        // A serie cobre tambem os dias anteriores, porque a contagem de dias
        // secos consecutivos precisa olhar para tras.
        if (!cache.has(periodoFinal)) {
          cache.set(
            periodoFinal,
            gerarLeituras({
              cenario,
              periodoFinal,
              dias: 90,
              comFalhas: Boolean(opcoes["com-falhas"]),
            }),
          );
        }
        return cache.get(periodoFinal);
      },
      async visaoPara() {
        return null;
      },
    };
  }

  if (tipo === "backend") {
    if (!servico.backend) {
      throw new Error("A fonte backend exige API_URL e CHAVE_DE_SERVICO no .env do oraculo.");
    }

    const talhoes = new Map();

    async function talhaoDa(apolice) {
      if (!talhoes.has(apolice)) {
        const ativas = await servico.backend.apolicesAtivas();
        for (const a of ativas) talhoes.set(a.endereco.toLowerCase(), a.talhao);
      }

      const talhao = talhoes.get(apolice.toLowerCase());
      if (!talhao) {
        throw new Error(
          `O backend nao conhece a apolice ${apolice} como ativa, ou ela nao tem talhao.`,
        );
      }
      return talhao;
    }

    return {
      tipo,
      descricao: `backend em ${config.apiUrl}`,
      async leiturasPara(apolice, periodo) {
        return servico.backend.leituras(await talhaoDa(apolice), periodo, 90);
      },
      async visaoPara(apolice, periodo) {
        return servico.backend.visao(await talhaoDa(apolice), periodo);
      },
    };
  }

  throw new Error(`Fonte desconhecida: ${tipo}. Use "simulada" ou "backend".`);
}

/** Publica um periodo de uma apolice e imprime a linha da tabela. */
async function publicarPeriodo(servico, fonte, apolice, periodo) {
  const [leituras, visao] = await Promise.all([
    fonte.leiturasPara(apolice, periodo),
    fonte.visaoPara(apolice, periodo),
  ]);

  const preparo = servico.prepararPublicacao({ apolice, periodo, leituras, visao });
  for (const alerta of preparo.alertas) console.log(`  [alerta] ${alerta}`);

  const resultado = await servico.drenarFila((evento) => {
    if (evento.tipo === "espera")
      console.log(`  aguardando ${evento.ms}ms antes de nova tentativa`);
    if (evento.tipo === "erro") {
      console.log(
        `  [erro] tentativa ${evento.tentativa}: ${evento.erro.shortMessage || evento.erro.message}`,
      );
    }
  });

  const detalhe = resultado.detalhes.find((d) => d.sucesso);

  if (!detalhe) {
    console.log(`  ${periodo}   publicacao nao concluida; entrada mantida na fila`);
    return null;
  }

  const { recibo } = detalhe;
  const dano = preparo.entrada.payload.indiceDanoBps;

  console.log(
    `  ${periodo}   ${String(preparo.consolidacao.indiceClimatico).padStart(6)}   ` +
      `${(dano ? `${dano / 100}%` : "-").padStart(6)}   ` +
      `${String(recibo.gasUsado).padStart(7)}   ${recibo.acionouPagamento ? "  SIM  " : "  nao  "}   ` +
      `${recibo.txHash.slice(0, 20)}...`,
  );

  return recibo;
}

/**
 * Modo servico: o oraculo como processo continuo (UC10).
 *
 * A cada intervalo, pergunta ao backend quais apolices estao ativas e publica o
 * periodo corrente de cada uma que ainda nao o recebeu. E assim que o sistema
 * funciona fora da demonstracao — ninguem roda um comando por periodo.
 *
 * `--periodo` fixa o dia de referencia, util para demonstrar com series
 * simuladas; sem ele, vale o dia de hoje. `--uma-vez` roda um unico ciclo.
 */
async function comandoServico(opcoes) {
  const servico = criarServico();
  if (!servico.backend) throw new Error("O modo servico exige API_URL e CHAVE_DE_SERVICO no .env.");

  const fonte = fonteDeDados(servico, { ...opcoes, fonte: "backend" });
  const intervalo = Number(
    opcoes.intervalo && opcoes.intervalo !== true ? opcoes.intervalo : config.intervaloDoServicoMs,
  );

  titulo("Oraculo em modo servico");
  console.log(`Oraculo..: ${servico.publicador.endereco}`);
  console.log(`Fonte....: ${fonte.descricao}`);
  console.log(`Intervalo: ${intervalo / 1000}s${opcoes["uma-vez"] ? " (um unico ciclo)" : ""}`);

  let parar = false;
  process.on("SIGINT", () => {
    parar = true;
  });

  do {
    const periodo = periodoDe(opcoes);
    let ativas = [];

    try {
      ativas = await servico.backend.apolicesAtivas();
    } catch (erro) {
      console.log(`[${new Date().toISOString()}] backend indisponivel: ${erro.message}`);
    }

    console.log(
      `\n[${new Date().toISOString()}] periodo ${periodo}: ${ativas.length} apolice(s) ativa(s)`,
    );

    for (const a of ativas) {
      if (!a.talhao) {
        console.log(`  ${a.endereco}: sem talhao cadastrado, ignorada`);
        continue;
      }

      try {
        if (await servico.publicador.periodoJaPublicado(a.endereco, periodo)) continue;

        console.log(`  apolice ${a.endereco} (talhao ${a.talhao})`);
        await publicarPeriodo(servico, fonte, a.endereco, periodo);
      } catch (erro) {
        // Uma apolice com problema nao impede as outras.
        console.log(`  ${a.endereco}: ${erro.shortMessage || erro.message}`);
      }
    }

    if (opcoes["uma-vez"] || parar) break;

    await new Promise((r) => setTimeout(r, intervalo));
  } while (!parar);
}

async function comandoCiclo(opcoes) {
  const apolice = exigirApolice(opcoes);
  const periodos = Number(opcoes.periodos && opcoes.periodos !== true ? opcoes.periodos : 8);
  const periodoFinal = periodoDe(opcoes);

  const servico = criarServico();
  const fonte = fonteDeDados(servico, opcoes);

  titulo("Ciclo de publicacao");
  console.log(`Fonte..: ${fonte.descricao}`);
  console.log(`Apolice: ${apolice}`);
  console.log(`Oraculo: ${servico.publicador.endereco}`);
  console.log(`Publicando os ultimos ${periodos} periodos ate ${periodoFinal}`);
  if (opcoes["com-falhas"])
    console.log("Injetando leituras defeituosas para exercitar RF12 e RF13.");

  titulo("Publicacoes");
  console.log("  periodo    indice     dano   gas       acionou   transacao");
  console.log(`  ${"-".repeat(75)}`);

  for (let i = periodos - 1; i >= 0; i -= 1) {
    const periodo = somarDias(periodoFinal, -i);

    if (await servico.publicador.periodoJaPublicado(apolice, periodo)) {
      console.log(`  ${periodo}   ja publicado anteriormente, seguindo`);
      continue;
    }

    const recibo = await publicarPeriodo(servico, fonte, apolice, periodo);

    if (recibo?.acionouPagamento) {
      titulo("Pagamento executado");
      console.log(`Transacao: ${recibo.txHash}`);
      console.log(`Bloco....: ${recibo.bloco}`);
      console.log(`Latencia.: ${new Date(recibo.confirmadoEm) - new Date(recibo.enviadoEm)} ms`);
      console.log("");
      console.log("A condicao foi avaliada e liquidada dentro da mesma transacao que");
      console.log("publicou o indice. Nenhum ser humano aprovou o pagamento.");
      break;
    }
  }

  titulo("Resumo da fila");
  console.log(JSON.stringify(servico.fila.resumo(), null, 2));
}

async function comandoPublicar(opcoes) {
  const apolice = exigirApolice(opcoes);
  const periodo = periodoDe(opcoes);

  const servico = criarServico();
  const fonte = fonteDeDados(servico, opcoes);

  titulo(`Publicando o periodo ${periodo}`);
  console.log(`Fonte: ${fonte.descricao}`);
  console.log("  periodo    indice     dano   gas       acionou   transacao");

  await publicarPeriodo(servico, fonte, apolice, periodo);

  console.log("");
  console.log(JSON.stringify(servico.fila.resumo(), null, 2));
}

async function comandoOuvir(opcoes) {
  const apolice = exigirApolice(opcoes);
  const servico = criarServico();

  titulo(`Escutando os eventos de ${apolice}`);
  console.log("Pressione Ctrl+C para encerrar.");
  console.log("");

  const encerrar = await servico.publicador.ouvir(apolice, (evento) => {
    const quando = new Date().toISOString();
    console.log(`[${quando}] ${evento.evento}`);

    for (const [nome, valor] of Object.entries(evento.argumentos)) {
      console.log(`    ${nome}: ${valor}`);
    }

    if (evento.txHash) console.log(`    tx: ${evento.txHash}`);
  });

  process.on("SIGINT", () => {
    encerrar();
    process.exit(0);
  });

  // Mantem o processo vivo enquanto ha escuta ativa.
  await new Promise(() => {});
}

function comandoFila(opcoes) {
  const fila = new FilaDePublicacoes(path.join(config.dirDados, "fila.json"), {
    maxTentativas: config.maxTentativas,
  });

  if (opcoes.reabrir && opcoes.reabrir !== true) {
    const entrada = fila.reabrir(opcoes.reabrir);

    console.log(
      entrada
        ? `Entrada ${entrada.chave} reaberta; tentativas zeradas.`
        : `Entrada ${opcoes.reabrir} nao encontrada.`,
    );

    return;
  }

  titulo("Fila de publicacoes");
  console.log(JSON.stringify(fila.resumo(), null, 2));

  const pendentes = fila.pendentes();
  if (pendentes.length === 0) {
    console.log("");
    console.log("Nenhuma publicacao pendente.");
    return;
  }

  titulo("Pendentes");
  for (const e of pendentes) {
    console.log(
      `${e.chave} | tentativas ${e.tentativas}/${fila.maxTentativas} | ` +
        `indice ${e.payload.indiceClimatico} | ${e.ultimoErro?.mensagem ?? "sem erro registrado"}`,
    );
  }
}

function comandoEstatisticas() {
  const registro = new RegistroDePublicacoes(path.join(config.dirDados, "publicacoes.jsonl"));
  const estatisticas = registro.estatisticas();

  titulo("Publicacoes registradas");

  if (!estatisticas) {
    console.log("Nenhuma publicacao registrada ainda.");
    return;
  }

  console.log(JSON.stringify(estatisticas, null, 2));
}

// ---------------------------------------------------------------- despacho

const COMANDOS = {
  status: comandoStatus,
  servico: comandoServico,
  ciclo: comandoCiclo,
  publicar: comandoPublicar,
  ouvir: comandoOuvir,
  fila: comandoFila,
  estatisticas: comandoEstatisticas,
};

async function main() {
  const [, , comando, ...resto] = process.argv;

  if (!comando || !COMANDOS[comando]) {
    console.log("Servico de oraculo do AgroSmart");
    console.log("");
    console.log("Uso: node src/index.js <comando> [opcoes]");
    console.log("");
    console.log("  status                            endereco, saldo e autorizacao do oraculo");
    console.log(
      "  servico  [--uma-vez]              publica continuamente as apolices ativas do backend",
    );
    console.log("  ciclo    --apolice 0x... [...]    roda um cenario climatico ate acionar");
    console.log("  publicar --apolice 0x... [...]    consolida e publica um unico periodo");
    console.log("  ouvir    --apolice 0x...          acompanha os eventos da apolice");
    console.log("  fila     [--reabrir <chave>]      mostra ou reabre a fila de publicacoes");
    console.log("  estatisticas                      gas e latencia das publicacoes");
    console.log("");
    console.log("Opcoes de ciclo e publicar:");
    console.log("  --fonte      simulada (padrao) | backend");
    console.log(`  --cenario    ${Object.keys(CENARIOS).join(" | ")}  (so na fonte simulada)`);
    console.log("  --periodo    dia de referencia em AAAAMMDD (padrao: hoje)");
    console.log("  --periodos   quantos periodos publicar no ciclo (padrao: 8)");
    console.log("  --com-falhas injeta leituras defeituosas para exercitar RF12 e RF13");

    process.exitCode = comando ? 1 : 0;
    return;
  }

  try {
    await COMANDOS[comando](lerArgumentos(resto));
  } finally {
    // `ouvir` fica de proposito com a conexao aberta: ele so termina no Ctrl+C.
    if (comando !== "ouvir") servicoAtivo?.encerrar();
  }
}

main().catch((erro) => {
  console.error("");
  console.error(`Falha: ${erro.shortMessage || erro.message}`);
  process.exitCode = 1;
});
