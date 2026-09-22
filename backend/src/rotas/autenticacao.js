import { Router } from "express";

import { naoAutenticado, pedidoInvalido } from "../erros.js";
import {
  cifrar,
  conferirCodigoTotp,
  conferirSenha,
  decifrar,
  HASH_FICTICIO,
  novoSegredoTotp,
} from "../seguranca/cripto.js";
import {
  abrirSessao,
  auditar,
  exigirSessao,
  exigirSessaoParcial,
  limitarLogin,
  revogarSessao,
} from "../seguranca/sessoes.js";
import { texto } from "../validacao.js";

/**
 * Autenticacao (RF01, RF04, RNF24, HU13).
 *
 * Login em dois tempos quando o segundo fator esta ativo: a senha correta abre
 * uma sessao parcial, de cinco minutos, que so serve para confirmar o codigo
 * TOTP. So depois do codigo a sessao completa e emitida.
 */

/** Dados do usuario que podem sair na resposta. Nunca inclui hash nem segredo. */
function publico(u) {
  return {
    id: u.id,
    identificador: u.identificador,
    nome: u.nome,
    perfil: u.perfil,
    documento: u.documento,
    carteira: u.carteira,
    segundoFatorAtivo: u.totp_ativo,
  };
}

export function rotasDeAutenticacao() {
  const r = Router();

  r.post("/autenticacao/entrar", limitarLogin, async (req, res) => {
    const { banco } = req.app.locals;
    const identificador = texto(req.body?.identificador, "identificador", {
      max: 100,
    }).toLowerCase();
    const senha = texto(req.body?.senha, "senha", { max: 200 });

    const { rows } = await banco.query("SELECT * FROM usuarios WHERE identificador = $1", [
      identificador,
    ]);
    const usuario = rows[0];

    // A senha e conferida mesmo quando o usuario nao existe, contra um hash
    // ficticio. Assim o tempo de resposta nao revela quais identificadores estao
    // cadastrados.
    const confere = await conferirSenha(senha, usuario?.hash_senha ?? HASH_FICTICIO);

    if (!usuario || !confere) {
      await auditar(banco, req, "login_recusado", { detalhes: { identificador } });
      throw naoAutenticado("Identificador ou senha invalidos.");
    }

    if (usuario.totp_ativo) {
      const token = await abrirSessao(banco, usuario.id, { segundoFatorPendente: true, req });

      res.json({ segundoFatorPendente: true, token });
      return;
    }

    const token = await abrirSessao(banco, usuario.id, { req });

    req.usuario = usuario;
    await auditar(banco, req, "login");

    res.json({ token, usuario: publico(usuario) });
  });

  r.post("/autenticacao/segundo-fator", limitarLogin, exigirSessaoParcial, async (req, res) => {
    const { banco } = req.app.locals;

    if (!req.usuario.segundo_fator_pendente) {
      throw pedidoInvalido("Esta sessao nao esta aguardando segundo fator.");
    }

    const { rows } = await banco.query("SELECT * FROM usuarios WHERE id = $1", [req.usuario.id]);
    const usuario = rows[0];

    const valido = await conferirCodigoTotp(
      decifrar(usuario.totp_segredo_cifrado),
      req.body?.codigo,
    );

    if (!valido) {
      await auditar(banco, req, "segundo_fator_recusado");
      throw naoAutenticado("Codigo do segundo fator invalido.");
    }

    // A sessao parcial e encerrada e uma completa nasce no lugar. Reaproveitar o
    // mesmo token manteria vivo um valor que ja circulou antes do segundo fator.
    await revogarSessao(banco, req.token);
    const token = await abrirSessao(banco, usuario.id, { req });
    await auditar(banco, req, "login", { detalhes: { segundoFator: true } });

    res.json({ token, usuario: publico(usuario) });
  });

  r.post("/autenticacao/sair", exigirSessaoParcial, async (req, res) => {
    await revogarSessao(req.app.locals.banco, req.token);
    res.status(204).end();
  });

  r.get("/autenticacao/eu", exigirSessao, async (req, res) => {
    res.json({ usuario: publico(req.usuario) });
  });

  // ------------------------------------------------------ segundo fator

  r.post("/autenticacao/totp/iniciar", exigirSessao, async (req, res) => {
    const { banco } = req.app.locals;

    if (req.usuario.totp_ativo) throw pedidoInvalido("O segundo fator ja esta ativo.");

    const { segredo, uri } = novoSegredoTotp(req.usuario.identificador);

    // Fica gravado, mas inativo, ate o usuario provar que o aplicativo
    // autenticador dele gera o codigo certo. Ativar sem essa prova trancaria do
    // lado de fora quem escaneou errado.
    await banco.query("UPDATE usuarios SET totp_segredo_cifrado = $2 WHERE id = $1", [
      req.usuario.id,
      cifrar(segredo),
    ]);

    res.json({ segredo, uri });
  });

  r.post("/autenticacao/totp/ativar", exigirSessao, async (req, res) => {
    const { banco } = req.app.locals;

    const { rows } = await banco.query("SELECT totp_segredo_cifrado FROM usuarios WHERE id = $1", [
      req.usuario.id,
    ]);

    if (!rows[0]?.totp_segredo_cifrado)
      throw pedidoInvalido("Inicie a configuracao antes de ativar.");

    const valido = await conferirCodigoTotp(
      decifrar(rows[0].totp_segredo_cifrado),
      req.body?.codigo,
    );
    if (!valido)
      throw pedidoInvalido("Codigo invalido. Confira o relogio do celular e tente de novo.");

    await banco.query("UPDATE usuarios SET totp_ativo = true WHERE id = $1", [req.usuario.id]);
    await auditar(banco, req, "segundo_fator_ativado");

    res.json({ segundoFatorAtivo: true });
  });

  r.post("/autenticacao/totp/desativar", exigirSessao, async (req, res) => {
    const { banco } = req.app.locals;

    const { rows } = await banco.query("SELECT totp_segredo_cifrado FROM usuarios WHERE id = $1", [
      req.usuario.id,
    ]);

    // Desativar exige o codigo: quem roubou uma sessao aberta nao consegue
    // desligar a protecao sem ter tambem o celular.
    const valido =
      rows[0]?.totp_segredo_cifrado &&
      (await conferirCodigoTotp(decifrar(rows[0].totp_segredo_cifrado), req.body?.codigo));

    if (!valido) throw pedidoInvalido("Codigo invalido.");

    await banco.query(
      "UPDATE usuarios SET totp_ativo = false, totp_segredo_cifrado = NULL WHERE id = $1",
      [req.usuario.id],
    );
    await auditar(banco, req, "segundo_fator_desativado");

    res.json({ segundoFatorAtivo: false });
  });

  return r;
}
