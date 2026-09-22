import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import dotenv from "dotenv";

/**
 * Configuracao do backend.
 *
 * Todo segredo vem de variavel de ambiente (RNF16). Nenhum valor sensivel tem
 * padrao embutido no codigo: se `SEGREDO_DE_SESSAO` ou `CHAVE_DO_ORACULO` faltar
 * em producao, o servico recusa subir, em vez de rodar com um segredo que esta
 * publicado no repositorio.
 */

const AQUI = dirname(fileURLToPath(import.meta.url));
export const RAIZ = join(AQUI, "..");

dotenv.config({ path: join(RAIZ, ".env"), quiet: true });

const ambiente = process.env.NODE_ENV || "desenvolvimento";
const emProducao = ambiente === "producao";

/**
 * Le um segredo obrigatorio. Em desenvolvimento e teste, aceita um valor de
 * demonstracao marcado como tal; em producao, a ausencia derruba o processo.
 */
function segredo(nome, valorDeDesenvolvimento) {
  const valor = process.env[nome];

  if (valor) return valor;

  if (emProducao) {
    throw new Error(`${nome} nao definido. Em producao, todo segredo precisa vir do ambiente.`);
  }

  return valorDeDesenvolvimento;
}

export const config = {
  ambiente,
  emProducao,
  porta: Number(process.env.PORTA || 3001),

  /**
   * Endereco do PostgreSQL. Vazio significa usar o PostgreSQL embutido (PGlite),
   * com PostGIS, gravado em `dirBanco`. O SQL e o mesmo nos dois casos.
   */
  urlDoBanco: process.env.DATABASE_URL || "",
  dirBanco: process.env.DIR_BANCO || join(RAIZ, "dados", "pg"),

  /** Origem do aplicativo, para o CORS. */
  origemDoAplicativo: process.env.ORIGEM_APP || "http://localhost:5173",

  /** Duracao da sessao, em horas. */
  horasDeSessao: Number(process.env.HORAS_DE_SESSAO || 8),

  /**
   * Chave que o servico de oraculo e o modulo de visao usam para se autenticar
   * na API. Nao e a chave privada do oraculo na cadeia — essa nunca passa por
   * aqui.
   */
  chaveDeServico: segredo("CHAVE_DE_SERVICO", "desenvolvimento-apenas-nao-use-em-producao"),

  /** Rede e enderecos dos contratos, lidos do arquivo de implantacao. */
  rede: process.env.REDE || "localhost",
  rpcUrl: process.env.RPC_URL || "http://127.0.0.1:8545",
  dirImplantacoes: process.env.DIR_IMPLANTACOES || join(RAIZ, "..", "contratos", "implantacoes"),

  /** Intervalo entre varreduras do indexador de eventos, em milissegundos. */
  intervaloDoIndexador: Number(process.env.INTERVALO_INDEXADOR_MS || 4000),

  /** Liga o indexador. Os testes desligam, porque nao ha cadeia disponivel. */
  indexadorAtivo: process.env.INDEXADOR !== "desligado",

  /** Onde as imagens dos talhoes ficam gravadas. */
  dirImagens: process.env.DIR_IMAGENS || join(RAIZ, "dados", "imagens"),

  /** Janela aceita para a marca de tempo de um lote de leituras (antirrepeticao). */
  janelaDoLoteMin: Number(process.env.JANELA_LOTE_MIN || 10),

  /** Limites de requisicao por origem nas rotas sensiveis (RNF26). */
  limiteDeLogin: Number(process.env.LIMITE_LOGIN || 10),
  limiteDeIngestao: Number(process.env.LIMITE_INGESTAO || 120),
};

/**
 * Enderecos dos contratos na rede configurada, ou nulo se nao houver implantacao.
 *
 * O backend sobe mesmo sem contrato implantado: cadastro, cotacao e ingestao nao
 * dependem da cadeia. So o indexador e a verificacao de emissao ficam inativos.
 */
export function lerImplantacao(rede = config.rede) {
  const arquivo = join(config.dirImplantacoes, `${rede}.json`);

  if (!existsSync(arquivo)) return null;

  return JSON.parse(readFileSync(arquivo, "utf8"));
}
