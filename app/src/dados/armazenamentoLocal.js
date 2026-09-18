/**
 * Armazenamento provisorio de talhoes, produtos e propostas.
 *
 * ATENCAO — esta e a outra peca provisoria do aplicativo.
 *
 * Talhao georreferenciado (RF03), produto indexado (RF05) e proposta de cotacao
 * (RF06) pertencem ao back-end com PostgreSQL e PostGIS, previsto para a Sprint 2.
 * Ate la, vivem no `localStorage` do navegador.
 *
 * Isso tem consequencias que precisam ficar explicitas, e nao descobertas no meio
 * da apresentacao:
 *  - o dado existe apenas naquele navegador, naquela maquina;
 *  - produtor e seguradora em computadores diferentes nao veem a mesma proposta;
 *  - limpar os dados do navegador apaga tudo.
 *
 * O que NAO vive aqui: a apolice, os indices e o pagamento. Esses estao na cadeia,
 * e sao lidos de la. A fronteira do projeto continua exatamente onde deveria — o
 * que e provisorio e so o cadastro que antecede a contratacao.
 */

const CHAVES = {
  TALHOES: "agrosmart:talhoes",
  PRODUTOS: "agrosmart:produtos",
  PROPOSTAS: "agrosmart:propostas",
};

function ler(chave, padrao) {
  try {
    const bruto = localStorage.getItem(chave);

    return bruto ? JSON.parse(bruto) : padrao;
  } catch {
    return padrao;
  }
}

function gravar(chave, valor) {
  localStorage.setItem(chave, JSON.stringify(valor));

  // Permite que outras telas abertas reajam a mudanca. O evento `storage` nativo
  // so dispara em outras abas, nunca na que escreveu.
  window.dispatchEvent(new CustomEvent("agrosmart:dados", { detail: { chave } }));

  return valor;
}

function novoId(prefixo) {
  return `${prefixo}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

// ------------------------------------------------------------------ talhoes

/** Talhoes cadastrados (RF03). */
export function listarTalhoes() {
  return ler(CHAVES.TALHOES, TALHOES_INICIAIS);
}

export function salvarTalhao(talhao) {
  const atuais = listarTalhoes();
  const registro = { ...talhao, id: talhao.id ?? novoId("talhao") };
  const indice = atuais.findIndex((t) => t.id === registro.id);

  if (indice >= 0) atuais[indice] = registro;
  else atuais.push(registro);

  gravar(CHAVES.TALHOES, atuais);

  return registro;
}

export function removerTalhao(id) {
  gravar(
    CHAVES.TALHOES,
    listarTalhoes().filter((t) => t.id !== id),
  );
}

// ------------------------------------------------------------------ produtos

/** Produtos indexados configurados pela seguradora (RF05). */
export function listarProdutos() {
  return ler(CHAVES.PRODUTOS, PRODUTOS_INICIAIS);
}

export function salvarProduto(produto) {
  const atuais = listarProdutos();
  const registro = { ...produto, id: produto.id ?? novoId("produto") };
  const indice = atuais.findIndex((p) => p.id === registro.id);

  if (indice >= 0) atuais[indice] = registro;
  else atuais.push(registro);

  gravar(CHAVES.PRODUTOS, atuais);

  return registro;
}

export function removerProduto(id) {
  gravar(
    CHAVES.PRODUTOS,
    listarProdutos().filter((p) => p.id !== id),
  );
}

// ------------------------------------------------------------------ propostas

export const SITUACAO_PROPOSTA = {
  PENDENTE: "pendente",
  EMITIDA: "emitida",
  RECUSADA: "recusada",
};

/**
 * Propostas de cotacao enviadas pelo produtor.
 *
 * O produtor nao pode implantar a apolice por conta propria: `emitirApolice` e
 * restrita a seguradora, como manda o RNF12. Entao a contratacao tem dois tempos —
 * o produtor envia a proposta, a seguradora emite. A proposta e o que liga um ao
 * outro enquanto nao existe API.
 */
export function listarPropostas() {
  return ler(CHAVES.PROPOSTAS, []);
}

export function salvarProposta(proposta) {
  const atuais = listarPropostas();
  const registro = {
    ...proposta,
    id: proposta.id ?? novoId("proposta"),
    criadaEm: proposta.criadaEm ?? new Date().toISOString(),
    situacao: proposta.situacao ?? SITUACAO_PROPOSTA.PENDENTE,
  };

  const indice = atuais.findIndex((p) => p.id === registro.id);

  if (indice >= 0) atuais[indice] = registro;
  else atuais.unshift(registro);

  gravar(CHAVES.PROPOSTAS, atuais);

  return registro;
}

export function atualizarProposta(id, mudancas) {
  const atuais = listarPropostas();
  const indice = atuais.findIndex((p) => p.id === id);

  if (indice < 0) return null;

  atuais[indice] = { ...atuais[indice], ...mudancas };
  gravar(CHAVES.PROPOSTAS, atuais);

  return atuais[indice];
}

/** Assina mudancas nos dados locais, para as telas se atualizarem sozinhas. */
export function aoMudarDados(callback) {
  const tratar = () => callback();

  window.addEventListener("agrosmart:dados", tratar);
  window.addEventListener("storage", tratar);

  return () => {
    window.removeEventListener("agrosmart:dados", tratar);
    window.removeEventListener("storage", tratar);
  };
}

/** Apaga tudo o que e local. Nao toca em nada que esteja na cadeia. */
export function limparDadosLocais() {
  for (const chave of Object.values(CHAVES)) localStorage.removeItem(chave);

  window.dispatchEvent(new CustomEvent("agrosmart:dados", { detail: { chave: "todos" } }));
}

// ------------------------------------------------------------------ sementes

/**
 * Dados iniciais, para a tela nao abrir vazia na primeira execucao.
 *
 * As coordenadas sao de uma regiao produtora de soja no interior de Sao Paulo, e a
 * area foi calculada a partir do proprio poligono.
 */
const TALHOES_INICIAIS = [
  {
    id: "talhao-01",
    nome: "talhao-01",
    propriedade: "Fazenda Santa Clara",
    municipio: "Ribeirao Preto/SP",
    cultura: "soja",
    areaHa: 180,
    poligono: [
      [-47.81, -21.17],
      [-47.79, -21.17],
      [-47.79, -21.19],
      [-47.81, -21.19],
    ],
  },
  {
    id: "talhao-02",
    nome: "talhao-02",
    propriedade: "Fazenda Santa Clara",
    municipio: "Ribeirao Preto/SP",
    cultura: "milho",
    areaHa: 95,
    poligono: [
      [-47.78, -21.16],
      [-47.76, -21.16],
      [-47.76, -21.18],
      [-47.78, -21.18],
    ],
  },
];

const PRODUTOS_INICIAIS = [
  {
    id: "produto-estiagem-soja",
    nome: "Estiagem — soja",
    cultura: "soja",
    operador: 0, // CLIMATICO
    modoPagamento: 0, // INTEGRAL
    limiarClimatico: 30,
    limiarClimaticoIntegral: 0,
    limiarDanoBps: 0,
    limiarDanoIntegralBps: 0,
    valorPorHectareEth: 0.006,
    vigenciaDias: 180,
    taxaPremioPct: 4.5,
  },
  {
    id: "produto-estiagem-escalonado",
    nome: "Estiagem escalonada — soja",
    cultura: "soja",
    operador: 0, // CLIMATICO
    modoPagamento: 1, // ESCALONADO
    limiarClimatico: 30,
    limiarClimaticoIntegral: 60,
    limiarDanoBps: 0,
    limiarDanoIntegralBps: 0,
    valorPorHectareEth: 0.006,
    vigenciaDias: 180,
    taxaPremioPct: 3.8,
  },
  {
    id: "produto-estiagem-dano-milho",
    nome: "Estiagem ou dano na lavoura — milho",
    cultura: "milho",
    operador: 2, // OU
    modoPagamento: 1, // ESCALONADO
    limiarClimatico: 25,
    limiarClimaticoIntegral: 50,
    limiarDanoBps: 4000,
    limiarDanoIntegralBps: 8000,
    valorPorHectareEth: 0.008,
    vigenciaDias: 150,
    taxaPremioPct: 5.2,
  },
];
