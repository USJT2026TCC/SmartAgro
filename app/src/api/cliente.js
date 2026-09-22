/**
 * Cliente da API do backend.
 *
 * Uma funcao so faz todas as chamadas: acrescenta o token da sessao, converte o
 * corpo para JSON, e transforma a resposta de erro da API — sempre no formato
 * `{ erro: { codigo, mensagem } }` — em uma excecao com a mensagem pronta para a
 * tela.
 *
 * O que continua indo direto a cadeia, sem passar por aqui: leitura de apolice,
 * indices, eventos, e toda transacao. A API guarda o cadastro e o que a cadeia nao
 * sabe; a cadeia continua sendo a fonte da verdade sobre dinheiro e indice.
 */

const CHAVE_DO_TOKEN = "agrosmart:token";

export class ErroDaApi extends Error {
  constructor(status, codigo, mensagem, detalhes) {
    super(mensagem);
    this.status = status;
    this.codigo = codigo;
    this.detalhes = detalhes;
  }
}

/**
 * O token vive no sessionStorage: fechar a aba encerra a sessao, como pede o
 * criterio de aceite 3 da HU13. No servidor, o token so existe como resumo.
 */
export const token = {
  ler: () => sessionStorage.getItem(CHAVE_DO_TOKEN),
  gravar: (valor) => sessionStorage.setItem(CHAVE_DO_TOKEN, valor),
  apagar: () => sessionStorage.removeItem(CHAVE_DO_TOKEN),
};

/**
 * Faz uma chamada a API.
 *
 * @param {string} caminho A partir de /api, por exemplo "/talhoes".
 * @param {object} [opcoes]
 * @param {string} [opcoes.metodo="GET"]
 * @param {object} [opcoes.corpo] Serializado como JSON.
 * @param {FormData} [opcoes.formulario] Enviado como multipart (imagens).
 */
export async function api(caminho, { metodo = "GET", corpo, formulario } = {}) {
  const cabecalhos = {};
  const atual = token.ler();

  if (atual) cabecalhos.Authorization = `Bearer ${atual}`;
  if (corpo !== undefined) cabecalhos["Content-Type"] = "application/json";

  let resposta;

  try {
    resposta = await fetch(`/api${caminho}`, {
      method: metodo,
      headers: cabecalhos,
      body: formulario ?? (corpo !== undefined ? JSON.stringify(corpo) : undefined),
    });
  } catch {
    throw new ErroDaApi(
      0,
      "sem_conexao",
      "Nao foi possivel falar com o servidor. O backend esta rodando?",
    );
  }

  if (resposta.status === 204) return null;

  const dados = await resposta.json().catch(() => null);

  if (!resposta.ok) {
    // Sessao expirada ou revogada: avisa o contexto de sessao, que manda de
    // volta ao login (HU13, criterio 3).
    if (resposta.status === 401 && atual) {
      window.dispatchEvent(new CustomEvent("agrosmart:sessao-expirada"));
    }

    throw new ErroDaApi(
      resposta.status,
      dados?.erro?.codigo ?? "erro",
      dados?.erro?.mensagem ?? `O servidor respondeu ${resposta.status}.`,
      dados?.erro?.detalhes,
    );
  }

  return dados;
}
