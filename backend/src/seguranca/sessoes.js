import rateLimit from "express-rate-limit";

import { config } from "../config.js";
import { naoAutenticado, semPermissao } from "../erros.js";
import { gerarToken, iguaisEmTempoConstante, sha256Hex } from "./cripto.js";

/**
 * Sessoes, controle de acesso e auditoria.
 *
 * A sessao e um token aleatorio opaco, e nao um JWT. A escolha e deliberada: um
 * JWT e valido ate expirar, e revoga-lo exige uma lista de bloqueio que acaba
 * sendo uma tabela de sessoes de qualquer forma. Com o token opaco, sair do
 * sistema encerra a sessao de verdade, no mesmo instante — o que importa em um
 * sistema em que a seguradora autoriza quem publica o indice que move dinheiro.
 *
 * O banco guarda so o resumo SHA-256 do token. Quem ler a tabela de sessoes nao
 * consegue se passar por ninguem.
 */

/**
 * Abre uma sessao.
 * @returns {Promise<string>} O token, que so existe nesta resposta.
 */
export async function abrirSessao(banco, usuarioId, { segundoFatorPendente = false, req } = {}) {
  const token = gerarToken();

  // Sessao com segundo fator pendente dura cinco minutos: e so o intervalo para
  // digitar o codigo, e nao deve servir para mais nada.
  const horas = segundoFatorPendente ? 5 / 60 : config.horasDeSessao;

  await banco.query(
    `INSERT INTO sessoes (usuario_id, hash_token, segundo_fator_pendente, expira_em, ip, agente)
     VALUES ($1, $2, $3, now() + make_interval(secs => $4), $5, $6)`,
    [
      usuarioId,
      sha256Hex(token),
      segundoFatorPendente,
      Math.round(horas * 3600),
      req?.ip ?? null,
      req?.get?.("user-agent")?.slice(0, 200) ?? null,
    ],
  );

  return token;
}

export async function revogarSessao(banco, token) {
  await banco.query(
    "UPDATE sessoes SET revogada_em = now() WHERE hash_token = $1 AND revogada_em IS NULL",
    [sha256Hex(token)],
  );
}

/** Extrai o token do cabecalho `Authorization: Bearer <token>`. */
function tokenDaRequisicao(req) {
  const cabecalho = req.get("authorization") ?? "";
  const [tipo, token] = cabecalho.split(" ");

  return tipo?.toLowerCase() === "bearer" && token ? token : null;
}

/** Busca a sessao valida correspondente ao token. */
async function buscarSessao(banco, token) {
  const { rows } = await banco.query(
    `SELECT s.id AS sessao_id, s.segundo_fator_pendente,
            u.id, u.identificador, u.nome, u.perfil, u.documento, u.carteira, u.totp_ativo
       FROM sessoes s
       JOIN usuarios u ON u.id = s.usuario_id
      WHERE s.hash_token = $1
        AND s.revogada_em IS NULL
        AND s.expira_em > now()`,
    [sha256Hex(token)],
  );

  return rows[0] ?? null;
}

/**
 * Exige sessao valida e completa (RF01).
 *
 * Sessao com segundo fator pendente e recusada aqui: ela so serve para a rota de
 * verificacao do codigo, que usa `exigirSessaoParcial`.
 */
export async function exigirSessao(req, _res, proximo) {
  const token = tokenDaRequisicao(req);
  if (!token) throw naoAutenticado();

  const sessao = await buscarSessao(req.app.locals.banco, token);
  if (!sessao) throw naoAutenticado();
  if (sessao.segundo_fator_pendente) throw naoAutenticado("Falta confirmar o segundo fator.");

  req.usuario = sessao;
  req.token = token;
  proximo();
}

/** Aceita sessao com segundo fator pendente. Usada apenas na verificacao do TOTP. */
export async function exigirSessaoParcial(req, _res, proximo) {
  const token = tokenDaRequisicao(req);
  if (!token) throw naoAutenticado();

  const sessao = await buscarSessao(req.app.locals.banco, token);
  if (!sessao) throw naoAutenticado();

  req.usuario = sessao;
  req.token = token;
  proximo();
}

/**
 * Exige um dos perfis informados (RF04, RNF12).
 *
 * E esta verificacao, no servidor, que protege de verdade. A do aplicativo so
 * esconde menus: um cliente adulterado a contorna, esta nao.
 */
export function exigirPerfil(...perfis) {
  return (req, _res, proximo) => {
    if (!req.usuario || !perfis.includes(req.usuario.perfil)) throw semPermissao();
    proximo();
  };
}

/**
 * Autenticacao dos servicos internos: oraculo e modulo de visao.
 *
 * Chave compartilhada no cabecalho `X-Chave-De-Servico`, comparada em tempo
 * constante. Nao e a chave privada do oraculo na cadeia — essa assina transacoes
 * e nunca sai da maquina do oraculo. Esta so autentica o oraculo perante a API.
 */
export function exigirServico(req, _res, proximo) {
  const informada = req.get("x-chave-de-servico");

  if (!informada || !iguaisEmTempoConstante(informada, config.chaveDeServico)) {
    throw naoAutenticado("Chave de servico ausente ou invalida.");
  }

  req.servico = true;
  proximo();
}

// ------------------------------------------------------------ limitadores

/**
 * RNF26: limite de requisicoes por origem nas rotas sensiveis.
 *
 * No login, dez tentativas por quinze minutos: suficiente para quem errou a senha
 * algumas vezes, inutil para quem tenta adivinha-la.
 */
export const limitarLogin = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: config.limiteDeLogin,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: {
    erro: {
      codigo: "muitas_tentativas",
      mensagem: "Muitas tentativas de login. Aguarde alguns minutos.",
    },
  },
});

/** Ingestao de leituras e envio de imagens: por minuto, com folga para lotes normais. */
export const limitarIngestao = rateLimit({
  windowMs: 60 * 1000,
  limit: config.limiteDeIngestao,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: {
    erro: {
      codigo: "muitas_requisicoes",
      mensagem: "Limite de envio atingido. Aguarde um minuto.",
    },
  },
});

// -------------------------------------------------------------- auditoria

/**
 * RNF25: registra uma acao no log de auditoria, correlacionada a transacao.
 *
 * Falha de auditoria nao derruba a operacao principal — mas tambem nao e
 * silenciada: vai para o log de erro, porque uma trilha de auditoria com buracos
 * precisa ser notada.
 */
export async function auditar(
  banco,
  req,
  acao,
  { recurso = null, txHash = null, detalhes = null } = {},
) {
  try {
    await banco.query(
      `INSERT INTO auditoria (usuario_id, perfil, acao, recurso, tx_hash, ip, detalhes)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        req?.usuario?.id ?? null,
        req?.usuario?.perfil ?? (req?.servico ? "servico" : null),
        acao,
        recurso,
        txHash,
        req?.ip ?? null,
        detalhes ? JSON.stringify(detalhes) : null,
      ],
    );
  } catch (erro) {
    console.error(`[auditoria] falha ao registrar ${acao}:`, erro.message);
  }
}
