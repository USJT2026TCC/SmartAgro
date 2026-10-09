/**
 * Publica no Etherscan o codigo-fonte de uma apolice emitida pela fabrica.
 *
 * O registro e a fabrica se verificam direto com `npx hardhat verify`, porque os
 * argumentos do construtor sao dois enderecos. A apolice recebe a struct de
 * termos, que este script le da propria cadeia (verTermos): assim o que se
 * verifica e exatamente o que foi implantado, e nao uma copia local dos termos.
 *
 * Uso (no PowerShell, defina antes $env:ENDERECO_APOLICE="0x..."):
 *   npx hardhat run scripts/verificar-apolice.js --network sepolia
 */

const hre = require("hardhat");

async function main() {
  const endereco = process.env.ENDERECO_APOLICE;
  if (!endereco) throw new Error("Defina ENDERECO_APOLICE com o endereco da apolice.");

  const apolice = await hre.ethers.getContractAt("ApolicePolicy", endereco);
  const argumentos = [await apolice.seguradora(), (await apolice.verTermos()).toObject()];

  await hre.run("verify:verify", {
    address: endereco,
    contract: "contracts/ApolicePolicy.sol:ApolicePolicy",
    constructorArguments: argumentos,
  });
}

main().catch((erro) => {
  console.error(erro);
  process.exitCode = 1;
});
