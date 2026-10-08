/**
 * RNF08: custo de transacao de uma apolice ao longo da vigencia, sobre o premio.
 *
 *   node scripts/custo-por-apolice.js
 *
 * A razao custo/premio nao depende da cotacao do ETH: o premio tambem e pago em
 * ETH. Depende de tres coisas — quanto gas o ciclo consome, o preco do gas, e o
 * tamanho do premio — e o script mostra cada uma separada.
 *
 * O gas vem das medicoes documentadas em docs/CONTRATOS.md §4 e em
 * docs/resultados/sepolia-2026-10-08: rede local (fork Osaka, o da rede
 * principal na data) e Sepolia (Glamsterdam, que encarece a criacao de estado).
 */

const MILHAO = 1_000_000;

// Gas medido por operacao.
const GAS = {
  osaka: { emissao: 2_001_364, garantia: 47_154, publicacao: 172_216, acionamentoExtra: 59_051 },
  glamsterdam: {
    emissao: 13_931_815,
    garantia: 135_174,
    publicacao: 711_594,
    acionamentoExtra: 244_740,
  },
};

// Produto "Estiagem escalonada — soja" da semente, num talhao de 180 ha: o
// mesmo da cotacao de demonstracao.
const PRODUTO = { hectares: 180, ethPorHectare: 0.006, taxaPremioBps: 380, vigenciaDias: 180 };

const valorSegurado = PRODUTO.hectares * PRODUTO.ethPorHectare;
const premio = (valorSegurado * PRODUTO.taxaPremioBps) / 10_000;

// Cada quantos dias o oraculo publica. 1 = todo dia, como o servico faz hoje;
// 3 = a agregacao que o RNF08 admite. Agregar so e seguro se o oraculo continuar
// calculando o indice todo dia fora da cadeia e publicar no mesmo dia em que a
// condicao for atingida: o indice e a sequencia seca que termina no dia
// publicado, e uma chuva entre duas publicacoes apagaria a sequencia. A conta
// abaixo inclui o acrescimo da publicacao que aciona e paga (acionamentoExtra).
const CADENCIAS = [1, 3];

function gasDoCiclo(gas, cadencia) {
  const publicacoes = Math.ceil(PRODUTO.vigenciaDias / cadencia);
  return gas.emissao + gas.garantia + publicacoes * gas.publicacao + gas.acionamentoExtra;
}

const CENARIOS = [
  { nome: "Sepolia, preco pago na demonstracao", fork: "glamsterdam", gwei: 0.001 },
  { nome: "Rede principal, gas barato", fork: "osaka", gwei: 0.5 },
  { nome: "Rede principal, gas tipico", fork: "osaka", gwei: 5 },
  { nome: "Rede de camada 2 (ordem de grandeza)", fork: "osaka", gwei: 0.01 },
];

console.log(
  `Produto: ${PRODUTO.hectares} ha x ${PRODUTO.ethPorHectare} ETH/ha = ${valorSegurado.toFixed(2)} ETH segurados`,
);
console.log(
  `Premio : ${PRODUTO.taxaPremioBps / 100}% = ${premio.toFixed(4)} ETH; 1% do premio = ${(premio / 100).toFixed(6)} ETH`,
);
console.log("");
console.log(
  "Cenario".padEnd(40),
  "Cadencia".padEnd(9),
  "Gas do ciclo".padStart(13),
  "Custo (ETH)".padStart(12),
  "% do premio".padStart(12),
  " RNF08",
  "  Segurado minimo",
);

for (const c of CENARIOS) {
  for (const cadencia of CADENCIAS) {
    const gas = gasDoCiclo(GAS[c.fork], cadencia);
    const custo = gas * c.gwei * 1e-9;
    const percentual = (custo / premio) * 100;
    // Valor segurado a partir do qual o custo cabe em 1% do premio.
    const minimo = (100 * custo) / (PRODUTO.taxaPremioBps / 10_000);
    console.log(
      c.nome.padEnd(40),
      `${cadencia} dia(s)`.padEnd(9),
      `${(gas / MILHAO).toFixed(1)} mi`.padStart(13),
      custo.toFixed(6).padStart(12),
      `${percentual.toFixed(2)}%`.padStart(12),
      percentual <= 1 ? "  ok  " : "  NAO ",
      `  ${minimo.toFixed(2)} ETH`,
    );
  }
}
