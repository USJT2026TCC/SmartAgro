/**
 * Emite uma apolice pela fabrica e deposita a garantia.
 *
 * E o passo que, no sistema completo, o produtor dispara pelo aplicativo ao
 * contratar (UC05, RF07). Aqui existe como script para que o servico de oraculo
 * possa ser exercitado sem depender da interface, que so entra na Sprint 3.
 *
 * Grava o endereco gerado em `implantacoes/<rede>-apolices.json` e imprime a linha
 * pronta para colar no .env do oraculo.
 *
 * Uso:
 *   npx hardhat run scripts/emitir-apolice.js --network localhost
 *
 * Variaveis opcionais:
 *   ENDERECO_PRODUTOR   carteira beneficiaria (padrao: segunda conta da rede)
 *   OPERADOR            climatico (padrao) | dano — o que aciona o pagamento
 *   LIMIAR_DIAS         dias consecutivos sem chuva que acionam (padrao: 30)
 *   LIMIAR_DANO_BPS     dano da lavoura que aciona, em pontos-base (padrao: 2000 = 20%)
 *   VALOR_INDENIZACAO   valor em ether (padrao: 1.0)
 *   CULTURA / TALHAO    identificadores (padrao: soja / talhao-01)
 *   INICIO_EM_DIAS      dias ate o inicio da vigencia (padrao: 0); com mais de zero,
 *                       a apolice pode ser cancelada ate la (RF10)
 */

const fs = require("node:fs");
const path = require("node:path");
const { ethers, network } = require("hardhat");

const DIA = 24 * 60 * 60;

async function main() {
  const [seguradora, contaProdutor] = await ethers.getSigners();

  const arquivoImplantacao = path.join(__dirname, "..", "implantacoes", `${network.name}.json`);

  if (!fs.existsSync(arquivoImplantacao)) {
    throw new Error(
      `Implantacao nao encontrada em ${arquivoImplantacao}. ` +
        `Rode antes: npx hardhat run scripts/implantar.js --network ${network.name}`,
    );
  }

  const implantacao = JSON.parse(fs.readFileSync(arquivoImplantacao, "utf8"));
  const factory = await ethers.getContractAt(
    "ApoliceFactory",
    implantacao.contratos.ApoliceFactory,
  );

  // Em rede local o produtor e a conta 1; ENDERECO_PRODUTOR, do .env, e o da
  // Sepolia (DECISOES.md 2.25).
  const redeLocal = Number((await ethers.provider.getNetwork()).chainId) === 31337;
  const produtor = (redeLocal ? null : process.env.ENDERECO_PRODUTOR) || contaProdutor?.address;
  if (!produtor) throw new Error("Defina ENDERECO_PRODUTOR: nenhuma conta disponivel na rede.");

  const OPERADORES = { climatico: 0, dano: 1 };
  const nomeOperador = (process.env.OPERADOR || "climatico").toLowerCase();
  if (!(nomeOperador in OPERADORES)) throw new Error(`OPERADOR invalido: ${nomeOperador}`);
  const porDano = nomeOperador === "dano";

  const limiarDias = Number(process.env.LIMIAR_DIAS || 30);
  const limiarDanoBps = Number(process.env.LIMIAR_DANO_BPS || 2000);
  const condicao = porDano
    ? `dano de ${limiarDanoBps / 100}% da lavoura`
    : `${limiarDias} dias consecutivos sem chuva`;
  const valorIndenizacao = ethers.parseEther(process.env.VALOR_INDENIZACAO || "1.0");
  const cultura = process.env.CULTURA || "soja";
  const talhao = process.env.TALHAO || "talhao-01";

  const agora = (await ethers.provider.getBlock("latest")).timestamp;
  const inicio = agora + Number(process.env.INICIO_EM_DIAS || 0) * DIA;

  // O resumo dos termos e o que torna detectavel qualquer alteracao posterior no
  // documento contratual (RF08). Ele precisa ser calculado sobre a mesma cadeia de
  // caracteres que o back-end guarda junto da apolice.
  const descricaoDosTermos = [
    "AgroSmart",
    cultura,
    talhao,
    condicao,
    `${ethers.formatEther(valorIndenizacao)} ETH`,
    `vigencia ${new Date(inicio * 1000).toISOString().slice(0, 10)} a ${new Date((inicio + 180 * DIA) * 1000).toISOString().slice(0, 10)}`,
  ].join("|");

  const termos = {
    produtor,
    registry: ethers.ZeroAddress, // a fabrica sobrescreve com o registro oficial
    cultura: ethers.encodeBytes32String(cultura),
    talhao: ethers.encodeBytes32String(talhao),
    operador: OPERADORES[nomeOperador],
    modoPagamento: 0, // INTEGRAL
    limiarClimatico: porDano ? 0 : limiarDias,
    limiarClimaticoIntegral: 0,
    limiarDanoBps: porDano ? limiarDanoBps : 0,
    limiarDanoIntegralBps: 0,
    vigenciaInicio: inicio,
    vigenciaFim: inicio + 180 * DIA,
    valorIndenizacao,
    hashTermos: ethers.keccak256(ethers.toUtf8Bytes(descricaoDosTermos)),
  };

  console.log(`Rede......: ${network.name}`);
  console.log(`Seguradora: ${seguradora.address}`);
  console.log(`Produtor..: ${produtor}`);
  console.log(`Condicao..: ${condicao}`);
  console.log(`Limite....: ${ethers.formatEther(valorIndenizacao)} ETH`);
  console.log("");

  const reciboEmissao = await (await factory.emitirApolice(termos)).wait();
  const total = await factory.totalApolices();
  const enderecoApolice = await factory.apolices(total - 1n);

  console.log(`Apolice implantada em ${enderecoApolice}`);
  console.log(`  transacao: ${reciboEmissao.hash}`);
  console.log(`  gas......: ${reciboEmissao.gasUsed}`);

  const apolice = await ethers.getContractAt("ApolicePolicy", enderecoApolice);
  const reciboGarantia = await (
    await apolice.connect(seguradora).depositarGarantia({ value: valorIndenizacao })
  ).wait();

  console.log(`Garantia depositada: ${ethers.formatEther(await apolice.garantiaRetida())} ETH`);
  console.log(`  transacao: ${reciboGarantia.hash}`);
  console.log(`  gas......: ${reciboGarantia.gasUsed}`);

  // ------------------------------------------------------------ registro
  const arquivoApolices = path.join(
    __dirname,
    "..",
    "implantacoes",
    `${network.name}-apolices.json`,
  );

  const anteriores = fs.existsSync(arquivoApolices)
    ? JSON.parse(fs.readFileSync(arquivoApolices, "utf8"))
    : [];

  anteriores.push({
    endereco: enderecoApolice,
    produtor,
    cultura,
    talhao,
    operador: nomeOperador,
    limiarDias: porDano ? null : limiarDias,
    limiarDanoBps: porDano ? limiarDanoBps : null,
    valorIndenizacao: valorIndenizacao.toString(),
    descricaoDosTermos,
    hashTermos: termos.hashTermos,
    emitidaEm: new Date().toISOString(),
    txEmissao: reciboEmissao.hash,
  });

  fs.writeFileSync(arquivoApolices, `${JSON.stringify(anteriores, null, 2)}\n`);

  console.log("");
  console.log(`Registrada em implantacoes/${network.name}-apolices.json`);
  console.log("");
  console.log("Para o servico de oraculo, use no .env:");
  console.log(`  ENDERECO_APOLICE=${enderecoApolice}`);
}

main().catch((erro) => {
  console.error(erro);
  process.exitCode = 1;
});
