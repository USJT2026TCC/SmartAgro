/**
 * Implanta a infraestrutura de contratos do AgroSmart.
 *
 * Implanta, nesta ordem:
 *   1. OracleRegistry  - lista de enderecos autorizados a publicar (RF18);
 *   2. ApoliceFactory  - fabrica que emite as apolices (RF07);
 *   3. autoriza o endereco do servico de oraculo no registro.
 *
 * Ao final grava `implantacoes/<rede>.json`, que e o arquivo lido pelo servico de
 * oraculo e pelo back-end. Isso evita que endereco de contrato seja copiado a mao
 * de um terminal para um arquivo de configuracao, que e como esse tipo de projeto
 * costuma quebrar na vespera da apresentacao.
 *
 * Uso:
 *   npx hardhat run scripts/implantar.js --network localhost
 *   npx hardhat run scripts/implantar.js --network sepolia
 */

const fs = require("node:fs");
const path = require("node:path");
const { ethers, network } = require("hardhat");

async function main() {
  const [seguradora, contaOraculo] = await ethers.getSigners();

  // Em rede local o segundo signatario serve de oraculo. Em rede publica, o
  // endereco vem do .env, porque a chave do oraculo e de outra pessoa da equipe.
  const enderecoOraculo = process.env.ENDERECO_ORACULO || contaOraculo?.address;

  if (!enderecoOraculo) {
    throw new Error(
      "Nenhum endereco de oraculo disponivel. Defina ENDERECO_ORACULO no .env ou use uma rede com duas contas.",
    );
  }

  console.log(`Rede........: ${network.name}`);
  console.log(`Seguradora..: ${seguradora.address}`);
  console.log(`Oraculo.....: ${enderecoOraculo}`);
  console.log("");

  // ---------------------------------------------------------------- registro
  const registry = await ethers.deployContract("OracleRegistry", [seguradora.address]);
  await registry.waitForDeployment();
  const enderecoRegistry = await registry.getAddress();
  console.log(`OracleRegistry implantado em ${enderecoRegistry}`);

  const txAutorizacao = await registry.autorizar(enderecoOraculo);
  const reciboAutorizacao = await txAutorizacao.wait();
  console.log(`  oraculo autorizado (gas: ${reciboAutorizacao.gasUsed})`);

  // ---------------------------------------------------------------- fabrica
  const factory = await ethers.deployContract("ApoliceFactory", [
    enderecoRegistry,
    seguradora.address,
  ]);
  await factory.waitForDeployment();
  const enderecoFactory = await factory.getAddress();
  console.log(`ApoliceFactory implantada em ${enderecoFactory}`);

  // ---------------------------------------------------------------- registro em disco
  const bloco = await ethers.provider.getBlockNumber();

  const implantacao = {
    rede: network.name,
    chainId: Number((await ethers.provider.getNetwork()).chainId),
    implantadoEm: new Date().toISOString(),
    blocoInicial: bloco,
    seguradora: seguradora.address,
    oraculoAutorizado: enderecoOraculo,
    contratos: {
      OracleRegistry: enderecoRegistry,
      ApoliceFactory: enderecoFactory,
    },
  };

  const destino = path.join(__dirname, "..", "implantacoes");
  fs.mkdirSync(destino, { recursive: true });

  const arquivo = path.join(destino, `${network.name}.json`);
  fs.writeFileSync(arquivo, `${JSON.stringify(implantacao, null, 2)}\n`);

  console.log("");
  console.log(`Enderecos gravados em implantacoes/${network.name}.json`);
}

main().catch((erro) => {
  console.error(erro);
  process.exitCode = 1;
});
