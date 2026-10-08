import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, beforeEach, describe, test } from "node:test";

import {
  MAXIMO_DE_TENTATIVAS,
  criarDespachanteDeEmail,
  criarTransporte,
  montarMensagem,
} from "../src/notificacoes/email.js";
import { montar } from "./ajuda.js";

/**
 * Notificacao por e-mail (RF27): o aviso do banco ganha uma segunda via, e uma
 * falha do servidor de e-mail nao perde aviso nem trava o resto.
 */

const TX = `0x${"ab".repeat(32)}`;

describe("e-mail das notificacoes (RF27)", () => {
  let ctx;
  let produtorId;

  before(async () => {
    ctx = await montar();
    produtorId = (await ctx.banco.query("SELECT id FROM usuarios WHERE identificador = 'produtor'"))
      .rows[0].id;
  });

  after(() => ctx.fechar());

  beforeEach(async () => {
    await ctx.banco.query("DELETE FROM notificacoes");
    await ctx.banco.query(
      `INSERT INTO notificacoes (usuario_id, tipo, titulo, mensagem, apolice_endereco, tx_hash)
       VALUES ($1, 'indenizacao_paga', 'Indenizacao paga', '1 ETH foram transferidos.', '0xapolice', $2)`,
      [produtorId, TX],
    );
  });

  /** Transporte falso: guarda as mensagens, ou falha se pedido. */
  function transporteFalso({ falhar = false } = {}) {
    const enviadas = [];
    return {
      enviadas,
      async sendMail(m) {
        if (falhar) throw new Error("SMTP fora do ar");
        enviadas.push(m);
        return { messageId: "<x@y>" };
      },
    };
  }

  test("os usuarios de demonstracao tem e-mail no dominio reservado .test", async () => {
    const { rows } = await ctx.banco.query(
      "SELECT email FROM usuarios WHERE identificador = 'produtor'",
    );
    assert.equal(rows[0].email, "produtor@agrosmart.test");
  });

  test("envia uma vez cada notificacao pendente, com o link da transacao", async () => {
    const transporte = transporteFalso();
    const despachante = criarDespachanteDeEmail(ctx.banco, { transporte });

    assert.deepEqual(await despachante.despachar(), { enviados: 1, falhas: 0 });
    assert.deepEqual(await despachante.despachar(), { enviados: 0, falhas: 0 }, "nao reenvia");

    const [m] = transporte.enviadas;
    assert.equal(m.to, "produtor@agrosmart.test");
    assert.equal(m.subject, "AgroSmart: Indenizacao paga");
    assert.match(m.text, /1 ETH foram transferidos/);
    assert.match(m.text, new RegExp(TX));
  });

  test("com o servidor fora do ar, o aviso fica pendente e e tentado de novo", async () => {
    const despachante = criarDespachanteDeEmail(ctx.banco, {
      transporte: transporteFalso({ falhar: true }),
    });

    assert.deepEqual(await despachante.despachar(), { enviados: 0, falhas: 1 });

    const { rows } = await ctx.banco.query(
      "SELECT email_enviado_em, email_tentativas FROM notificacoes",
    );
    assert.equal(rows[0].email_enviado_em, null);
    assert.equal(rows[0].email_tentativas, 1);

    // O servidor volta: a mesma notificacao sai.
    const ok = criarDespachanteDeEmail(ctx.banco, { transporte: transporteFalso() });
    assert.deepEqual(await ok.despachar(), { enviados: 1, falhas: 0 });
  });

  test("depois do maximo de tentativas, desiste do e-mail (o aviso no aplicativo continua)", async () => {
    await ctx.banco.query("UPDATE notificacoes SET email_tentativas = $1", [MAXIMO_DE_TENTATIVAS]);
    const despachante = criarDespachanteDeEmail(ctx.banco, { transporte: transporteFalso() });

    assert.deepEqual(await despachante.despachar(), { enviados: 0, falhas: 0 });
  });

  test("usuario sem e-mail fica so com o aviso no aplicativo", async () => {
    await ctx.banco.query("UPDATE usuarios SET email = NULL WHERE id = $1", [produtorId]);
    const despachante = criarDespachanteDeEmail(ctx.banco, { transporte: transporteFalso() });

    assert.deepEqual(await despachante.despachar(), { enviados: 0, falhas: 0 });
    await ctx.banco.query("UPDATE usuarios SET email = 'produtor@agrosmart.test' WHERE id = $1", [
      produtorId,
    ]);
  });

  test("sem SMTP, a mensagem vira um arquivo .eml na caixa de saida local", async () => {
    const pasta = mkdtempSync(join(tmpdir(), "agrosmart-emails-"));
    const { tipo, transporte } = criarTransporte({ smtpUrl: "", dirCaixaDeSaida: pasta });

    assert.equal(tipo, "caixa-de-saida");
    await transporte.sendMail(
      montarMensagem(
        {
          email: "produtor@agrosmart.test",
          titulo: "Teste",
          mensagem: "Corpo do aviso.",
          tx_hash: TX,
        },
        {
          remetente: "AgroSmart <avisos@agrosmart.test>",
          explorador: "https://sepolia.etherscan.io",
        },
      ),
    );

    const [arquivo] = readdirSync(pasta);
    // Quoted-printable quebra linhas longas com "=" no fim; desfaz para comparar.
    const eml = readFileSync(join(pasta, arquivo), "utf8").replace(/=\n/g, "");
    assert.match(arquivo, /\.eml$/);
    assert.match(eml, /To: produtor@agrosmart\.test/);
    assert.match(eml, /Subject: AgroSmart: Teste/);
    assert.match(eml, new RegExp(`https://sepolia.etherscan.io/tx/${TX}`));
  });
});
