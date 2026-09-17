/**
 * Demonstracao do cenario "estiagem severa", ponta a ponta, em rede local.
 *
 * Reproduz o roteiro de cinco minutos do capitulo 1 do manual da equipe, so que
 * inteiramente em cadeia e sem interface: emite a apolice, deposita a garantia,
 * publica indices crescentes de dias sem chuva e mostra o pagamento acontecendo
 * sozinho quando o limiar e cruzado.
 *
 * Serve para duas coisas: conferir a integracao dos tres contratos fora do
 * ambiente de teste e produzir, no terminal, os numeros de gas e os identificadores
 * de transacao que o Capitulo de resultados do TCC vai citar.
 *
 * Uso:
 *   npx hardhat node                                          (em outro terminal)
 *   npx hardhat run scripts/demo-estiagem.js --network localhost
 */

const { ethers } = require("hardhat");

const DIA = 24 * 60 * 60;
const LIMIAR_DIAS_SEM_CHUVA = 30;
const VALOR_INDENIZACAO = ethers.parseEther("1.0");

/** Serie do cenario de estiagem severa: dias consecutivos sem chuva por periodo. */
const SERIE_ESTIAGEM_SEVERA = [6, 13, 21, 28, 33];

const formatar = (wei) => `${ethers.formatEther(wei)} ETH`;

async function main() {
  const [seguradora, produtor, oraculo] = await ethers.getSigners();

  console.log("=".repeat(72));
  console.log("AgroSmart - demonstracao do cenario de estiagem severa");
  console.log("=".repeat(72));
  console.log(`Seguradora: ${seguradora.address}`);
  console.log(`Produtor..: ${produtor.address}`);
  console.log(`Oraculo...: ${oraculo.address}`);
  console.log("");

  // ------------------------------------------------------------ 1. infraestrutura
  console.log("[1/5] Implantando registro de oraculos e fabrica de apolices");

  const registry = await ethers.deployContract("OracleRegistry", [seguradora.address]);
  await registry.waitForDeployment();
  await (await registry.autorizar(oraculo.address)).wait();

  const factory = await ethers.deployContract("ApoliceFactory", [
    await registry.getAddress(),
    seguradora.address,
  ]);
  await factory.waitForDeployment();

  console.log(`      OracleRegistry: ${await registry.getAddress()}`);
  console.log(`      ApoliceFactory: ${await factory.getAddress()}`);
  console.log("");

  // ------------------------------------------------------------ 2. contratacao
  console.log("[2/5] Contratando a apolice (soja, talhao-01, 30 dias sem chuva)");

  const agora = (await ethers.provider.getBlock("latest")).timestamp;

  const termos = {
    produtor: produtor.address,
    registry: ethers.ZeroAddress, // a fabrica sobrescreve
    cultura: ethers.encodeBytes32String("soja"),
    talhao: ethers.encodeBytes32String("talhao-01"),
    operador: 0, // CLIMATICO
    modoPagamento: 0, // INTEGRAL
    limiarClimatico: LIMIAR_DIAS_SEM_CHUVA,
    limiarClimaticoIntegral: 0,
    limiarDanoBps: 0,
    limiarDanoIntegralBps: 0,
    vigenciaInicio: agora,
    vigenciaFim: agora + 180 * DIA,
    valorIndenizacao: VALOR_INDENIZACAO,
    hashTermos: ethers.keccak256(
      ethers.toUtf8Bytes("AgroSmart|soja|talhao-01|30 dias sem chuva|1 ETH|safra 2026"),
    ),
  };

  const reciboEmissao = await (await factory.emitirApolice(termos)).wait();
  const enderecoApolice = await factory.apolices(0);
  const apolice = await ethers.getContractAt("ApolicePolicy", enderecoApolice);

  console.log(`      Apolice implantada em ${enderecoApolice}`);
  console.log(`      Transacao: ${reciboEmissao.hash}`);
  console.log(`      Gas da emissao: ${reciboEmissao.gasUsed}`);
  console.log("");

  // ------------------------------------------------------------ 3. garantia
  console.log("[3/5] Seguradora deposita a garantia");

  const reciboGarantia = await (
    await apolice.connect(seguradora).depositarGarantia({ value: VALOR_INDENIZACAO })
  ).wait();

  console.log(`      Garantia retida: ${formatar(await apolice.garantiaRetida())}`);
  console.log(`      Gas do deposito: ${reciboGarantia.gasUsed}`);
  console.log("");

  // ------------------------------------------------------------ 4. travessia
  console.log("[4/5] Oraculo publica os indices do periodo");
  console.log("");
  console.log("      periodo    dias sem chuva   acionou   gas       transacao");
  console.log(`      ${"-".repeat(64)}`);

  const saldoInicialProdutor = await ethers.provider.getBalance(produtor.address);
  const custos = [];

  for (let i = 0; i < SERIE_ESTIAGEM_SEVERA.length; i += 1) {
    const periodo = 20261001 + i;
    const diasSemChuva = SERIE_ESTIAGEM_SEVERA[i];

    const recibo = await (
      await apolice
        .connect(oraculo)
        .publicarIndices(
          periodo,
          diasSemChuva,
          0,
          9_500,
          ethers.keccak256(ethers.toUtf8Bytes(`lote-imagens-${periodo}`)),
          ethers.keccak256(ethers.toUtf8Bytes("visao-agrosmart-v1.0.0")),
        )
    ).wait();

    const acionou = recibo.logs.some((log) => {
      try {
        return apolice.interface.parseLog(log)?.name === "PagamentoExecutado";
      } catch {
        return false;
      }
    });

    custos.push({ periodo, diasSemChuva, acionou, gas: recibo.gasUsed });

    console.log(
      `      ${periodo}   ${String(diasSemChuva).padStart(10)}   ${
        acionou ? "  SIM  " : "  nao  "
      }   ${String(recibo.gasUsed).padStart(7)}   ${recibo.hash.slice(0, 18)}...`,
    );

    if (acionou) break;
  }

  console.log("");

  // ------------------------------------------------------------ 5. resultado
  console.log("[5/5] Resultado");

  const saldoFinalProdutor = await ethers.provider.getBalance(produtor.address);
  const recebido = saldoFinalProdutor - saldoInicialProdutor;

  console.log(
    `      Situacao da apolice.: ${["AGUARDANDO_GARANTIA", "ATIVA", "LIQUIDADA", "ENCERRADA"][await apolice.situacao()]}`,
  );
  console.log(`      Periodo acionador...: ${await apolice.periodoAcionador()}`);
  console.log(`      Valor pago..........: ${formatar(await apolice.valorPago())}`);
  console.log(`      Recebido na carteira: ${formatar(recebido)}`);
  console.log(`      Garantia restante...: ${formatar(await apolice.garantiaRetida())}`);
  console.log("");

  const semAcionar = custos.filter((c) => !c.acionou);
  const acionador = custos.find((c) => c.acionou);

  if (semAcionar.length > 0) {
    const media = semAcionar.reduce((s, c) => s + c.gas, 0n) / BigInt(semAcionar.length);
    console.log(`      Gas medio de publicacao sem acionamento: ${media}`);
  }
  if (acionador) {
    console.log(`      Gas da publicacao que acionou o pagamento: ${acionador.gas}`);
  }

  console.log("");
  console.log("Nenhum ser humano aprovou o pagamento. A condicao foi avaliada e");
  console.log("liquidada dentro da mesma transacao que publicou o indice.");
}

main().catch((erro) => {
  console.error(erro);
  process.exitCode = 1;
});
