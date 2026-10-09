/**
 * Historico climatico da localidade, para a cotacao (RF06, UC04).
 *
 * Responde a pergunta que o produtor e a seguradora fazem antes de fechar
 * negocio: "nos ultimos anos, quantas vezes esta condicao teria acionado?".
 *
 * Para cada ano do historico, a janela de vigencia e reposta nas mesmas datas, e
 * o indice e calculado pela regra do oraculo (oraculo/src/consolidador.js):
 *
 *  - a chuva do dia e a soma das horas medidas em cada estacao, e depois a
 *    media entre as estacoes que mediram alguma hora (agruparPorDia);
 *  - dia seco e o que fica abaixo do limiar de chuva (1 mm);
 *  - dia sem medicao valida interrompe a contagem, em vez de contar como seco
 *    (DECISOES.md 1.8);
 *  - o indice de cada dia e a sequencia de dias secos terminada nele, mesmo que
 *    tenha comecado antes da vigencia, porque e isso que o oraculo publica.
 *
 * A condicao teria acionado se, em algum dia da janela, o indice atingisse o
 * limiar contratado. O resultado e uma frequencia historica, e nao uma
 * probabilidade atuarial: com uma dezena de anos, serve para mostrar ao produtor
 * se a condicao e rara ou comum, como pede o RF06, e nao para precificar sozinha
 * (a adequacao atuarial esta fora do escopo, secao 1.2 da documentacao).
 */

export const LIMIAR_CHUVA_MM = 1;
// O oraculo conta o dia com qualquer hora medida (agruparPorDia nao exige um
// minimo). O historico segue a mesma regra, para que a frequencia mostrada seja
// a do contrato que vai ser assinado, e nao a de uma regra mais rigorosa.
export const HORAS_MINIMAS = 1;

/** Fracao minima de dias medidos na janela para o ano entrar na conta. */
export const COBERTURA_MINIMA = 0.9;

/** Quantos dias antes da vigencia uma estiagem pode ter comecado. */
export const RETROSPECTIVA_DIAS = 90;

const DIA_MS = 86_400_000;

const BPS = 10_000;
const PISO_ESCALONADO_BPS = 5_000;

/**
 * Serie diaria consolidada: data (AAAA-MM-DD) -> chuva media entre as estacoes
 * que mediram o dia. Dia sem nenhuma estacao com medicao fica de fora.
 */
export function serieConsolidada(linhas, { horasMinimas = HORAS_MINIMAS } = {}) {
  const porDia = new Map();

  for (const l of linhas) {
    if (Number(l.horas_validas) < horasMinimas) continue;

    const data =
      typeof l.data === "string" ? l.data.slice(0, 10) : l.data.toISOString().slice(0, 10);
    const dia = porDia.get(data) ?? { soma: 0, estacoes: 0 };
    dia.soma += Number(l.chuva_mm);
    dia.estacoes += 1;
    porDia.set(data, dia);
  }

  return new Map([...porDia].map(([data, d]) => [data, d.soma / d.estacoes]));
}

const comoData = (ms) => new Date(ms).toISOString().slice(0, 10);

/**
 * Maior indice climatico que o oraculo teria publicado dentro da janela.
 *
 * @returns {{maiorIndice: number, diasMedidos: number, dias: number}}
 */
export function avaliarJanela(serie, inicioMs, dias, { limiarChuvaMm = LIMIAR_CHUVA_MM } = {}) {
  let sequencia = 0;
  let maiorIndice = 0;
  let diasMedidos = 0;

  for (let i = -RETROSPECTIVA_DIAS; i < dias; i += 1) {
    const chuva = serie.get(comoData(inicioMs + i * DIA_MS));

    if (chuva === undefined) {
      sequencia = 0;
    } else if (chuva < limiarChuvaMm) {
      sequencia += 1;
    } else {
      sequencia = 0;
    }

    if (i >= 0) {
      if (chuva !== undefined) diasMedidos += 1;
      if (sequencia > maiorIndice) maiorIndice = sequencia;
    }
  }

  return { maiorIndice, diasMedidos, dias };
}

/** Percentual devido pela regra do contrato (ApolicePolicy._percentualDevido), so a parte climatica. */
export function percentualClimatico(
  indice,
  { limiarClimatico, limiarClimaticoIntegral, modoPagamento },
) {
  if (indice < limiarClimatico) return 0;
  if (Number(modoPagamento) === 0) return BPS;
  if (indice >= limiarClimaticoIntegral) return BPS;

  const excedente = indice - limiarClimatico;
  const faixa = limiarClimaticoIntegral - limiarClimatico;
  return PISO_ESCALONADO_BPS + Math.floor(((BPS - PISO_ESCALONADO_BPS) * excedente) / faixa);
}

/**
 * Frequencia historica de acionamento de uma condicao climatica.
 *
 * @param {object} p
 * @param {Array} p.linhas Linhas de historico_chuva das estacoes da localidade.
 * @param {string} p.inicio Data de inicio da cobertura (AAAA-MM-DD); so o dia e o mes contam.
 * @param {number} p.vigenciaDias
 * @param {object} p.termos limiarClimatico, limiarClimaticoIntegral, modoPagamento, operador.
 */
export function historicoDaCondicao({ linhas, inicio, vigenciaDias, termos }) {
  const operador = Number(termos.operador);

  // Operador 1 (DANO): o gatilho e o indice de dano das imagens, que nao tem
  // historico publico na localidade.
  if (operador === 1) {
    return {
      aplicavel: false,
      motivo:
        "A condicao deste produto e o indice de dano das imagens da lavoura, que nao tem historico publico.",
    };
  }

  const serie = serieConsolidada(linhas);
  if (serie.size === 0) {
    return {
      aplicavel: false,
      motivo: "Nao ha historico de chuva de estacoes proximas a este talhao.",
    };
  }

  const datas = [...serie.keys()].sort();
  const primeiroAno = Number(datas[0].slice(0, 4));
  const ultimoAno = Number(datas.at(-1).slice(0, 4));
  const mesDia = inicio.slice(5, 10);
  const estacoes = [...new Set(linhas.map((l) => l.estacao))].sort();

  const anos = [];

  for (let ano = primeiroAno; ano <= ultimoAno; ano += 1) {
    const inicioMs = Date.parse(`${ano}-${mesDia}T00:00:00Z`);
    if (Number.isNaN(inicioMs)) continue; // 29 de fevereiro em ano nao bissexto

    const janela = avaliarJanela(serie, inicioMs, vigenciaDias);
    const cobertura = janela.diasMedidos / janela.dias;
    const avaliado = cobertura >= COBERTURA_MINIMA;
    const percentualBps = avaliado ? percentualClimatico(janela.maiorIndice, termos) : 0;

    anos.push({
      ano,
      maiorIndice: janela.maiorIndice,
      coberturaDosDados: Math.round(cobertura * 1000) / 1000,
      avaliado,
      acionaria: avaliado && percentualBps > 0,
      percentualBps,
    });
  }

  const avaliados = anos.filter((a) => a.avaliado);
  const acionamentos = avaliados.filter((a) => a.acionaria).length;
  const somaPercentual = avaliados.reduce((s, a) => s + a.percentualBps, 0);

  return {
    aplicavel: true,
    estacoes,
    regra: `${LIMIAR_CHUVA_MM} mm de chuva por dia; dia sem medicao interrompe a contagem`,
    // OU: o dano tambem aciona, entao a frequencia climatica e um piso. E: o
    // dano tambem precisa ocorrer, entao e um teto.
    observacao:
      operador === 2
        ? "O produto tambem aciona pelo indice de dano; a frequencia abaixo considera so o clima, e por isso e um piso."
        : operador === 3
          ? "O produto exige tambem o indice de dano; a frequencia abaixo considera so o clima, e por isso e um teto."
          : null,
    anos,
    anosAvaliados: avaliados.length,
    acionamentos,
    frequencia: avaliados.length ? acionamentos / avaliados.length : null,
    // Pagamento medio por ano, como fracao do limite: o "premio puro" historico.
    pagamentoMedioBps: avaliados.length ? Math.round(somaPercentual / avaliados.length) : null,
  };
}
