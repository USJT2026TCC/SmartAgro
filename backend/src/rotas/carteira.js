import { randomBytes } from "node:crypto";

import { Router } from "express";
import { ethers } from "ethers";

import { conflito, naoEncontrado, pedidoInvalido } from "../erros.js";
import { auditar, exigirPerfil, exigirSessao } from "../seguranca/sessoes.js";
import { endereco as enderecoValido, uuid } from "../validacao.js";

/**
 * Vinculo da carteira ao cadastro por assinatura (RF02, HU07).
 *
 * Antes do backend, a assinatura era conferida no navegador — o que prova a
 * correspondencia, mas um cliente adulterado podia mentir para si mesmo. Agora o
 * desafio nasce aqui, e aqui a assinatura e conferida:
 *
 *  1. o servidor gera uma mensagem com numero unico e prazo de cinco minutos;
 *  2. a carteira do produtor assina, no navegador;
 *  3. o servidor recupera o endereco que assinou e, so entao, grava o vinculo.
 *
 * A chave privada nao trafega em nenhum momento (RNF17).
 */
export function rotasDeCarteira() {
  const r = Router();

  r.post("/carteira/desafio", exigirSessao, exigirPerfil("produtor"), async (req, res) => {
    const { banco } = req.app.locals;

    const mensagem = [
      "AgroSmart — vinculo de carteira",
      `usuario: ${req.usuario.identificador}`,
      `emitido em: ${new Date().toISOString()}`,
      `numero unico: 0x${randomBytes(16).toString("hex")}`,
      "",
      "Assinar esta mensagem nao movimenta valor e nao autoriza nenhuma transacao.",
    ].join("\n");

    const { rows } = await banco.query(
      `INSERT INTO desafios_carteira (usuario_id, mensagem, expira_em)
       VALUES ($1, $2, now() + interval '5 minutes')
       RETURNING id, expira_em`,
      [req.usuario.id, mensagem],
    );

    res.status(201).json({ desafioId: rows[0].id, mensagem, expiraEm: rows[0].expira_em });
  });

  r.post("/carteira/vincular", exigirSessao, exigirPerfil("produtor"), async (req, res) => {
    const { banco } = req.app.locals;
    const desafioId = uuid(req.body?.desafioId, "desafioId");
    const assinatura = String(req.body?.assinatura ?? "");

    // O cliente declara o endereco que afirma controlar. Sem isso, qualquer
    // assinatura "funcionaria": a recuperacao de chave sempre devolve algum
    // endereco, mesmo para uma assinatura sobre a mensagem errada — e o produtor
    // ficaria vinculado a um endereco que ninguem controla, para onde a
    // indenizacao seria paga e de onde nunca mais sairia. E o mesmo padrao do
    // Sign-In with Ethereum (EIP-4361).
    const declarado = enderecoValido(req.body?.endereco, "endereco");

    if (!/^0x[0-9a-fA-F]{130}$/.test(assinatura))
      throw pedidoInvalido("Assinatura em formato invalido.");

    // O desafio e consumido ANTES de qualquer outra verificacao, em uma operacao
    // atomica de marcar-e-ler, fora de transacao. Assim ele fica gasto mesmo que
    // o vinculo falhe adiante: uma assinatura so vale uma vez, e reaproveita-la e
    // exatamente o que o numero unico existe para impedir. Dentro de uma
    // transacao, a falha do vinculo desfaria tambem o consumo.
    const { rows: consumidos } = await banco.query(
      `UPDATE desafios_carteira SET usado_em = now()
        WHERE id = $1 AND usuario_id = $2 AND usado_em IS NULL AND expira_em > now()
        RETURNING mensagem`,
      [desafioId, req.usuario.id],
    );

    if (consumidos.length === 0) {
      const { rows } = await banco.query(
        "SELECT usado_em, expira_em FROM desafios_carteira WHERE id = $1 AND usuario_id = $2",
        [desafioId, req.usuario.id],
      );

      if (!rows[0]) throw naoEncontrado("Desafio");
      if (rows[0].usado_em) throw conflito("Este desafio ja foi usado. Peca um novo.");
      throw pedidoInvalido("Desafio expirado. Peca um novo.");
    }

    let endereco;

    try {
      endereco = ethers.verifyMessage(consumidos[0].mensagem, assinatura).toLowerCase();
    } catch {
      throw pedidoInvalido("Nao foi possivel recuperar o endereco a partir da assinatura.");
    }

    if (endereco !== declarado) {
      throw pedidoInvalido(
        "A assinatura nao foi feita pela carteira informada. Assine exatamente a mensagem do desafio.",
      );
    }

    // HU07, criterio 4: endereco ja vinculado a outro produtor e recusado. A
    // restricao UNIQUE do banco cobre a corrida entre dois pedidos simultaneos;
    // esta consulta so da a mensagem certa no caso comum.
    const { rows: donos } = await banco.query(
      "SELECT id FROM usuarios WHERE carteira = $1 AND id <> $2",
      [endereco, req.usuario.id],
    );

    if (donos.length > 0) throw conflito("Esta carteira ja esta vinculada a outro usuario.");

    await banco.query(
      "UPDATE usuarios SET carteira = $2, carteira_vinculada_em = now() WHERE id = $1",
      [req.usuario.id, endereco],
    );

    await auditar(banco, req, "carteira_vinculada", { recurso: endereco });

    res.json({ carteira: endereco });
  });

  r.delete("/carteira", exigirSessao, exigirPerfil("produtor"), async (req, res) => {
    const { banco } = req.app.locals;

    await banco.query(
      "UPDATE usuarios SET carteira = NULL, carteira_vinculada_em = NULL WHERE id = $1",
      [req.usuario.id],
    );
    await auditar(banco, req, "carteira_desvinculada", { recurso: req.usuario.carteira });

    res.status(204).end();
  });

  return r;
}
