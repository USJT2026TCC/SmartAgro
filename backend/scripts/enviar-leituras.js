/**
 * Envia leituras assinadas para a API, como uma estacao faria.
 *
 * Substituto do simulador em Python + MQTT (HU04) ate ele existir. Gera a serie
 * de um cenario com a mesma fonte deterministica usada pelo oraculo, e envia um
 * lote assinado por fonte — exatamente o formato que o simulador oficial vai
 * precisar produzir. Serve, portanto, tambem de referencia de implementacao.
 *
 * Uso:
 *   node scripts/enviar-leituras.js --cenario estiagem_severa --ate 20260917
 *
 * As chaves das fontes de demonstracao sao derivadas da frase publica de teste do
 * Hardhat (ver src/banco/semente.js). Em rede publica, cada fonte tem chave propria.
 */
import { randomUUID } from "node:crypto";

import fonteSimulada from "../../oraculo/src/fonteSimulada.js";
import consolidador from "../../oraculo/src/consolidador.js";
import { assinarLote } from "../src/dominio/assinaturaDeLote.js";
import { FONTES_DE_DEMONSTRACAO, carteiraDeFonteDeDemonstracao } from "../src/banco/semente.js";

function argumento(nome, padrao) {
  const i = process.argv.indexOf(`--${nome}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : padrao;
}

const api = argumento("api", process.env.API_URL || "http://localhost:3001/api");
const cenario = argumento("cenario", "estiagem_severa");
const ate = Number(argumento("ate", consolidador.diaDe(new Date().toISOString())));
const dias = Number(argumento("dias", 90));

const leituras = fonteSimulada.gerarLeituras({
  cenario,
  periodoFinal: ate,
  dias,
  fontes: FONTES_DE_DEMONSTRACAO.map((f) => f.id),
});

console.log(`Cenario ${cenario}: ${leituras.length} leituras ate ${ate}, enviando para ${api}`);

for (const fonte of FONTES_DE_DEMONSTRACAO) {
  const daFonte = leituras
    .filter((l) => l.fonte === fonte.id)
    .map((l) => ({
      instante: l.timestamp,
      chuvaMm: l.chuvaMm,
      temperaturaC: l.temperaturaC,
      umidadePct: l.umidadePct,
    }));

  // O corpo e serializado UMA vez, e sao estes bytes exatos que sao assinados e
  // enviados. Reserializar depois de assinar invalidaria a assinatura.
  const corpo = JSON.stringify({
    lote: randomUUID(),
    fonte: fonte.id,
    enviadoEm: new Date().toISOString(),
    leituras: daFonte,
  });

  const assinatura = await assinarLote(
    Buffer.from(corpo),
    carteiraDeFonteDeDemonstracao(fonte.indice),
  );

  const resposta = await fetch(`${api}/leituras`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Assinatura": assinatura },
    body: corpo,
  });

  const resultado = await resposta.json();

  if (!resposta.ok) {
    console.error(`  ${fonte.id}: ${resposta.status} ${resultado.erro?.mensagem}`);
    process.exitCode = 1;
    continue;
  }

  console.log(
    `  ${fonte.id}: ${resultado.aceitas} aceitas, ${resultado.recusadas} recusadas, ` +
      `${resultado.duplicadas} repetidas — reputacao ${resultado.escore}`,
  );
}
