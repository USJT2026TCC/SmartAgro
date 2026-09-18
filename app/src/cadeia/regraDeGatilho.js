/**
 * A regra que decide se a condicao contratada foi atendida e quanto se paga.
 *
 * Este arquivo e uma reimplementacao, em JavaScript, da funcao `_percentualDevido`
 * de `contratos/contracts/ApolicePolicy.sol`.
 *
 * Reimplementar a regra no front-end e um risco conhecido: as duas copias podem
 * divergir, e a tela passaria a mostrar ao produtor um numero diferente do que o
 * contrato vai executar. O RNF06 exige apresentar a condicao contratada em
 * linguagem nao tecnica antes do aceite, com exemplos numericos — se esses
 * exemplos mentirem, o requisito e pior do que nao ter sido atendido.
 *
 * Duas coisas impedem a divergencia:
 *
 * 1. Depois que a apolice existe na cadeia, a tela usa `simularPercentual` do
 *    proprio contrato, e nao esta funcao. Aqui so entra na cotacao, quando ainda
 *    nao ha contrato implantado para consultar.
 *
 * 2. `contratos/test/RegraDeGatilho.test.js` importa este arquivo e compara,
 *    caso a caso, a saida dele com a saida do contrato. Se alguem mexer em um dos
 *    dois lados, a suite de testes quebra.
 *
 * Toda a aritmetica usa inteiros, como na EVM. Nenhuma operacao com ponto
 * flutuante entra no caminho do calculo, porque arredondamento diferente entre as
 * duas implementacoes e exatamente o tipo de divergencia que se quer evitar.
 */

/** Base de pontos: 10000 bps = 100,00%. */
export const BPS = 10_000;

/** Piso do modo escalonado: atingido o gatilho, paga-se ao menos metade. */
export const PISO_ESCALONADO_BPS = 5_000;

/** Como os dois indices se combinam. Espelha o enum Operador do contrato. */
export const OPERADOR = {
  CLIMATICO: 0,
  DANO: 1,
  OU: 2,
  E: 3,
};

/** Regra de calculo do valor devido. Espelha o enum ModoPagamento do contrato. */
export const MODO_PAGAMENTO = {
  INTEGRAL: 0,
  ESCALONADO: 1,
};

/** Rotulos das situacoes da apolice, na ordem do enum Situacao do contrato. */
export const SITUACAO = ["AGUARDANDO_GARANTIA", "ATIVA", "LIQUIDADA", "ENCERRADA"];

/**
 * Interpolacao linear entre o piso (no gatilho) e 100% (no limiar integral).
 * Divisao inteira, como em Solidity.
 */
function interpolar(valor, gatilho, teto) {
  if (valor >= teto) return BPS;

  const excedente = valor - gatilho;
  const faixa = teto - gatilho;
  const acrescimo = Math.floor(((BPS - PISO_ESCALONADO_BPS) * excedente) / faixa);

  return PISO_ESCALONADO_BPS + acrescimo;
}

/**
 * Percentual devido para um par de indices, em pontos-base.
 *
 * @param {object} termos Termos da apolice, nos mesmos campos do contrato.
 * @param {number} indiceClimatico Dias consecutivos sem chuva.
 * @param {number} indiceDanoBps Indice de dano, de 0 a 10000.
 * @returns {number} Percentual em bps. Zero significa condicao nao atendida.
 */
export function percentualDevido(termos, indiceClimatico, indiceDanoBps) {
  const operador = Number(termos.operador);
  const modoPagamento = Number(termos.modoPagamento);

  const limiarClimatico = Number(termos.limiarClimatico);
  const limiarClimaticoIntegral = Number(termos.limiarClimaticoIntegral);
  const limiarDanoBps = Number(termos.limiarDanoBps);
  const limiarDanoIntegralBps = Number(termos.limiarDanoIntegralBps);

  const climaticoAtingido =
    operador !== OPERADOR.DANO && Number(indiceClimatico) >= limiarClimatico;
  const danoAtingido = operador !== OPERADOR.CLIMATICO && Number(indiceDanoBps) >= limiarDanoBps;

  let atendida;
  if (operador === OPERADOR.CLIMATICO) atendida = climaticoAtingido;
  else if (operador === OPERADOR.DANO) atendida = danoAtingido;
  else if (operador === OPERADOR.OU) atendida = climaticoAtingido || danoAtingido;
  else atendida = climaticoAtingido && danoAtingido;

  if (!atendida) return 0;
  if (modoPagamento === MODO_PAGAMENTO.INTEGRAL) return BPS;

  let percentual = 0;

  if (climaticoAtingido) {
    percentual = interpolar(Number(indiceClimatico), limiarClimatico, limiarClimaticoIntegral);
  }

  if (danoAtingido) {
    const pd = interpolar(Number(indiceDanoBps), limiarDanoBps, limiarDanoIntegralBps);
    if (pd > percentual) percentual = pd;
  }

  return percentual;
}

/**
 * Valor devido em wei, a partir do limite contratado.
 *
 * Usa BigInt porque o limite vem em wei e um valor em ether nao cabe com
 * precisao em um Number.
 */
export function valorDevido(termos, indiceClimatico, indiceDanoBps) {
  const percentual = percentualDevido(termos, indiceClimatico, indiceDanoBps);

  return (BigInt(termos.valorIndenizacao) * BigInt(percentual)) / BigInt(BPS);
}

/**
 * Exemplos numericos do que aciona e do que nao aciona o pagamento.
 *
 * E o que a tela de cotacao mostra ao produtor antes do aceite (RNF06, e o
 * criterio de aceite 2 da HU10). A escolha dos pontos e deliberada: um pouco
 * abaixo do gatilho, exatamente no gatilho, e dois casos acima — porque e no
 * limite que o produtor costuma se surpreender depois.
 */
export function exemplosDeAcionamento(termos) {
  const usaClima = Number(termos.operador) !== OPERADOR.DANO;
  const gatilho = usaClima ? Number(termos.limiarClimatico) : 0;
  const teto = usaClima ? Number(termos.limiarClimaticoIntegral) : 0;

  const pontos = usaClima
    ? [
        Math.max(0, gatilho - 10),
        Math.max(0, gatilho - 1),
        gatilho,
        gatilho + Math.max(1, Math.round((teto - gatilho) / 2)),
        teto > gatilho ? teto : gatilho + 15,
      ]
    : [];

  return [...new Set(pontos)]
    .filter((dias) => dias >= 0)
    .sort((a, b) => a - b)
    .map((diasSemChuva) => ({
      diasSemChuva,
      percentualBps: percentualDevido(termos, diasSemChuva, 0),
      valorWei: valorDevido(termos, diasSemChuva, 0),
    }));
}
