import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import nodemailer from "nodemailer";

import { config } from "../config.js";

/**
 * Notificacao por e-mail (RF27, UC13), com o Nodemailer da secao 5.3 da
 * documentacao de software.
 *
 * O aviso nasce no banco (tabela notificacoes), escrito pelo indexador quando
 * um evento chega da cadeia. O e-mail e uma segunda via, enviada por um
 * despachante separado. A separacao e o que impede um servidor de e-mail fora
 * do ar de atrasar o indexador ou de perder um aviso: o despachante so marca a
 * notificacao como enviada depois do envio, e tenta de novo no ciclo seguinte.
 *
 * Sem SMTP_URL, o transporte grava cada mensagem como arquivo .eml em
 * dados/emails/ — uma caixa de saida local que abre em qualquer cliente de
 * e-mail, util para desenvolver e para a demonstracao, sem mandar nada para
 * fora da maquina.
 */

/** Tentativas antes de desistir de uma mensagem (o aviso no aplicativo continua). */
export const MAXIMO_DE_TENTATIVAS = 5;

export function criarTransporte({ smtpUrl = config.smtpUrl, dirCaixaDeSaida = config.dirEmails } = {}) {
  if (smtpUrl) {
    return { tipo: "smtp", transporte: nodemailer.createTransport(smtpUrl) };
  }

  const transporte = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: "unix" });

  return {
    tipo: "caixa-de-saida",
    transporte: {
      async sendMail(mensagem) {
        const info = await transporte.sendMail(mensagem);
        mkdirSync(dirCaixaDeSaida, { recursive: true });
        const nome = `${new Date().toISOString().replace(/[:.]/g, "-")}-${info.messageId.replace(/[<>@]/g, "")}.eml`;
        writeFileSync(join(dirCaixaDeSaida, nome), info.message);
        return { ...info, arquivo: nome };
      },
    },
  };
}

/** Corpo do e-mail a partir da notificacao, com o link para conferir na rede. */
export function montarMensagem(n, { remetente = config.remetenteEmail, explorador = config.exploradorDeBlocos } = {}) {
  const linhas = [n.mensagem, ""];

  if (n.apolice_endereco) linhas.push(`Apolice: ${n.apolice_endereco}`);
  if (n.tx_hash && /^0x[0-9a-f]{64}$/i.test(n.tx_hash)) {
    linhas.push(
      explorador ? `Transacao: ${explorador}/tx/${n.tx_hash}` : `Transacao: ${n.tx_hash}`,
    );
  }

  linhas.push(
    "",
    "Este aviso foi gerado a partir de um evento registrado na blockchain;",
    "o mesmo registro pode ser conferido por qualquer pessoa no explorador de blocos.",
    "",
    "AgroSmart",
  );

  return {
    from: remetente,
    to: n.email,
    subject: `AgroSmart: ${n.titulo}`,
    text: linhas.join("\n"),
  };
}

/**
 * Despachante: envia os e-mails das notificacoes pendentes.
 *
 * @param {import("../banco/conexao.js").Banco} banco
 * @param {object} [opcoes]
 * @param {object} [opcoes.transporte] Para os testes; padrao: criarTransporte().
 */
export function criarDespachanteDeEmail(banco, opcoes = {}) {
  const { transporte } = opcoes.transporte ? { transporte: opcoes.transporte } : criarTransporte();
  const intervaloMs = opcoes.intervaloMs ?? config.intervaloDoEmail;

  let temporizador = null;
  let ocupado = false;

  async function despachar() {
    if (ocupado) return { enviados: 0, falhas: 0 };
    ocupado = true;

    let enviados = 0;
    let falhas = 0;

    try {
      const { rows } = await banco.query(
        `SELECT n.id, n.titulo, n.mensagem, n.apolice_endereco, n.tx_hash, u.email
           FROM notificacoes n JOIN usuarios u ON u.id = n.usuario_id
          WHERE n.email_enviado_em IS NULL AND u.email IS NOT NULL
            AND n.email_tentativas < $1
          ORDER BY n.id
          LIMIT 50`,
        [MAXIMO_DE_TENTATIVAS],
      );

      for (const n of rows) {
        try {
          await transporte.sendMail(montarMensagem(n));
          await banco.query("UPDATE notificacoes SET email_enviado_em = now() WHERE id = $1", [n.id]);
          enviados += 1;
        } catch {
          await banco.query(
            "UPDATE notificacoes SET email_tentativas = email_tentativas + 1 WHERE id = $1",
            [n.id],
          );
          falhas += 1;
        }
      }
    } finally {
      ocupado = false;
    }

    return { enviados, falhas };
  }

  return {
    despachar,
    iniciar() {
      temporizador = setInterval(() => despachar().catch(() => {}), intervaloMs);
    },
    parar() {
      clearInterval(temporizador);
    },
  };
}
