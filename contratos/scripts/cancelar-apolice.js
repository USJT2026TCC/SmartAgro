/**
 * Cancela uma apolice antes do inicio da vigencia (RF10), pela seguradora.
 *
 * O produtor cancela pelo aplicativo, assinando com a propria carteira; a
 * seguradora tambem pode, e este script e o caminho dela sem interface. A
 * garantia depositada volta inteira para a seguradora, na mesma transacao.
 *
 * Uso (no PowerShell, defina antes $env:ENDERECO_APOLICE="0x..."):
 *   npx hardhat run scripts/cancelar-apolice.js --network sepolia
 */

const { ethers, network } = require("hardhat");

const SITUACOES = ["AGUARDANDO_GARANTIA", "ATIVA", "LIQUIDADA", "EXPIRADA", "CANCELADA"];

async function main() {
  const endereco = process.env.ENDERECO_APOLICE;
  if (!endereco) throw new Error("Defina ENDERECO_APOLICE com o endereco da apolice.");

  const [seguradora] = await ethers.getSigners();
  const apolice = await ethers.getContractAt("ApolicePolicy", endereco);
  const termos = await apolice.verTermos();

  console.log(`Rede......: ${network.name}`);
  console.log(`Apolice...: ${endereco}`);
  console.log(`Situacao..: ${SITUACOES[Number(await apolice.situacao())]}`);
  console.log(`Vigencia..: a partir de ${new Date(Number(termos.vigenciaInicio) * 1000).toISOString()}`);

  const saldoAntes = await ethers.provider.getBalance(seguradora.address);
  const recibo = await (await apolice.connect(seguradora).cancelar()).wait();
  const custo = recibo.gasUsed * recibo.gasPrice;
  const devolvido = (await ethers.provider.getBalance(seguradora.address)) - saldoAntes + custo;

  console.log("");
  console.log(`Cancelada. Situacao: ${SITUACOES[Number(await apolice.situacao())]}`);
  console.log(`  garantia devolvida a seguradora: ${ethers.formatEther(devolvido)} ETH`);
  console.log(`  transacao: ${recibo.hash}`);
  console.log(`  gas......: ${recibo.gasUsed}`);
}

main().catch((erro) => {
  console.error(erro);
  process.exitCode = 1;
});
