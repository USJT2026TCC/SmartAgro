import { Router } from "express";
import { ethers } from "ethers";

import { conflito, naoEncontrado, pedidoInvalido } from "../erros.js";
import { auditar, exigirPerfil, exigirServico, exigirSessao } from "../seguranca/sessoes.js";
import { hashDeTransacao, inteiro, periodo, texto, umDe, uuid } from "../validacao.js";

/**
 * Contestacao da avaliacao automatica (RF28, UC14).
 *
 * O caminho tem tres maos, e cada uma fica registrada:
 *
 *  1. o PRODUTOR contesta o indice de dano publicado em um periodo, dizendo por
 *     que discorda;
 *  2. o PERITO emite parecer. Deferida, ele fixa o indice retificado; o texto
 *     canonico do parecer e resumido (keccak256), e e esse resumo que vai para a
 *     cadeia;
 *  3. o ORACULO, o unico autorizado a escrever na apolice (RF18), submete o
 *     indice retificado com `publicarRetificacao`. O contrato guarda a
 *     retificacao ao lado da publicacao original, sem apaga-la, e reavalia a
 *     condicao.
 *
 * O backend nunca assina transacao. Ele guarda a contestacao e o parecer e
 * entrega ao oraculo o que deve ser publicado, como faz com os indices.
 */

export const DECISOES = ["deferida", "indeferida"];

/**
 * Texto canonico do parecer. O resumo gravado na cadeia e calculado sobre ele,
 * e qualquer pessoa com o texto consegue recalcula-lo e conferir.
 */
export function textoDoParecer({ contestacaoId, apolice, periodo: p, decisao, indiceRetificadoBps, parecer }) {
  return [
    "AgroSmart - parecer de contestacao",
    `contestacao:${contestacaoId}`,
    `apolice:${apolice}`,
    `periodo:${p}`,
    `decisao:${decisao}`,
    `indice-retificado-bps:${indiceRetificadoBps ?? "-"}`,
    `parecer:${parecer}`,
  ].join("\n");
}

const SQL_CONTESTACAO = `
  SELECT c.*, a.produtor_carteira, t.identificador AS talhao,
         u.nome AS produtor_nome, pe.nome AS perito_nome
    FROM contestacoes c
    JOIN apolices a ON a.endereco = c.apolice_endereco
    LEFT JOIN talhoes t ON t.id = a.talhao_id
    JOIN usuarios u ON u.id = c.produtor_id
    LEFT JOIN usuarios pe ON pe.id = c.perito_id`;

export function rotasDeContestacoes() {
  const r = Router();

  /** O produtor contesta o indice de dano de um periodo publicado. */
  r.post("/contestacoes", exigirSessao, exigirPerfil("produtor"), async (req, res) => {
    const { banco } = req.app.locals;
    const apolice = texto(req.body?.apolice, "apolice", { max: 42 }).toLowerCase();
    const p = periodo(req.body?.periodo);
    const motivo = texto(req.body?.motivo, "motivo", { max: 2000 });

    if (!ethers.isAddress(apolice)) throw pedidoInvalido("Endereco de apolice invalido.");

    const { rows: apolices } = await banco.query(
      "SELECT endereco, produtor_carteira, situacao FROM apolices WHERE endereco = $1",
      [apolice],
    );
    const a = apolices[0];

    // A apolice de outro produtor responde como inexistente: nao se confirma a
    // existencia de um contrato a quem nao e parte dele.
    if (!a || a.produtor_carteira !== (req.usuario.carteira ?? "").toLowerCase()) {
      throw naoEncontrado("Apolice");
    }

    // O contrato so aceita retificacao em apolice ATIVA. Liquidada, ja pagou;
    // encerrada ou cancelada, nao ha mais o que acionar.
    if (Number(a.situacao) !== 1) {
      throw conflito("So e possivel contestar enquanto a apolice esta ativa.");
    }

    // A publicacao contestada e a que a REDE registrou: o evento IndicesPublicados
    // gravado pelo indexador, e nao o relato do oraculo. E dele que vem o indice
    // e o resumo das evidencias que o perito vai reexaminar.
    const { rows: eventos } = await banco.query(
      `SELECT (e.argumentos->>'indiceDanoBps')::int AS indice_dano_bps, lt.id AS lote_id
         FROM eventos_cadeia e
         LEFT JOIN lotes_de_imagens lt ON lt.hash_evidencias = e.argumentos->>'hashEvidencias'
        WHERE e.contrato = $1 AND e.nome = 'IndicesPublicados' AND e.argumentos->>'periodo' = $2
        LIMIT 1`,
      [apolice, String(p)],
    );
    const publicacao = eventos[0];
    if (!publicacao) throw naoEncontrado("Publicacao deste periodo");

    const { rows } = await banco.query(
      `INSERT INTO contestacoes (apolice_endereco, periodo, produtor_id, motivo, indice_original_bps, lote_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (apolice_endereco, periodo) DO NOTHING
       RETURNING id`,
      [apolice, p, req.usuario.id, motivo, publicacao.indice_dano_bps, publicacao.lote_id ?? null],
    );

    if (!rows[0]) {
      throw conflito("Este periodo ja foi contestado. O contrato aceita uma retificacao por periodo.");
    }

    await auditar(banco, req, "contestacao_aberta", {
      recurso: rows[0].id,
      detalhes: { apolice, periodo: p },
    });

    res.status(201).json({ contestacao: { id: rows[0].id, situacao: "aberta" } });
  });

  /** Lista: o produtor ve as suas; seguradora e perito veem todas. */
  r.get("/contestacoes", exigirSessao, async (req, res) => {
    const { banco } = req.app.locals;
    const proprias = req.usuario.perfil === "produtor";

    const { rows } = await banco.query(
      `${SQL_CONTESTACAO} ${proprias ? "WHERE c.produtor_id = $1" : ""}
       ORDER BY (c.situacao = 'aberta') DESC, c.criada_em DESC`,
      proprias ? [req.usuario.id] : [],
    );

    res.json({ contestacoes: rows });
  });

  /** Parecer do perito. Deferida exige o indice retificado. */
  r.post(
    "/perito/contestacoes/:id/parecer",
    exigirSessao,
    exigirPerfil("perito"),
    async (req, res) => {
      const { banco } = req.app.locals;
      const id = uuid(req.params.id, "id");
      const decisao = umDe(req.body?.decisao, "decisao", DECISOES);
      const parecer = texto(req.body?.parecer, "parecer", { max: 2000 });
      const indiceRetificadoBps =
        decisao === "deferida"
          ? inteiro(req.body?.indiceRetificadoBps, "indiceRetificadoBps", { min: 0, max: 10_000 })
          : null;

      const { rows } = await banco.query(`${SQL_CONTESTACAO} WHERE c.id = $1`, [id]);
      const c = rows[0];

      if (!c) throw naoEncontrado("Contestacao");
      if (c.situacao !== "aberta") throw conflito("Esta contestacao ja recebeu parecer.");

      if (decisao === "deferida" && indiceRetificadoBps === c.indice_original_bps) {
        throw pedidoInvalido(
          "O indice retificado e igual ao publicado. Se o perito concorda com o modelo, a decisao e indeferir.",
        );
      }

      const textoCanonico = textoDoParecer({
        contestacaoId: c.id,
        apolice: c.apolice_endereco,
        periodo: c.periodo,
        decisao,
        indiceRetificadoBps,
        parecer,
      });
      const hashParecer = ethers.keccak256(ethers.toUtf8Bytes(textoCanonico));

      await banco.query(
        `UPDATE contestacoes
            SET situacao = $2, perito_id = $3, parecer = $4, indice_retificado_bps = $5,
                texto_do_parecer = $6, hash_parecer = $7, decidida_em = now()
          WHERE id = $1 AND situacao = 'aberta'`,
        [id, decisao, req.usuario.id, parecer, indiceRetificadoBps, textoCanonico, hashParecer],
      );

      // Indeferida, o produtor e avisado aqui: nada vai para a cadeia, entao o
      // indexador nunca veria um evento para notificar.
      if (decisao === "indeferida") {
        await banco.query(
          `INSERT INTO notificacoes (usuario_id, tipo, titulo, mensagem, apolice_endereco, tx_hash)
           VALUES ($1, 'contestacao_indeferida', 'Contestacao indeferida', $2, $3, $4)
           ON CONFLICT DO NOTHING`,
          [
            c.produtor_id,
            `O perito manteve o indice de ${c.indice_original_bps / 100}% do periodo ${c.periodo}. Parecer: ${parecer}`,
            c.apolice_endereco,
            `contestacao:${c.id}`,
          ],
        );
      }

      await auditar(banco, req, "contestacao_decidida", {
        recurso: id,
        detalhes: { decisao, indiceRetificadoBps, hashParecer },
      });

      res.json({ id, decisao, indiceRetificadoBps, hashParecer });
    },
  );

  // ------------------------------------------------------------- oraculo

  /** Retificacoes deferidas que ainda nao foram para a cadeia. */
  r.get("/oraculo/retificacoes-pendentes", exigirServico, async (req, res) => {
    const { rows } = await req.app.locals.banco.query(
      `SELECT c.id, c.apolice_endereco AS apolice, c.periodo, c.indice_original_bps,
              c.indice_retificado_bps, c.hash_parecer,
              lt.hash_evidencias,
              (SELECT an.hash_versao_modelo FROM analises_de_imagem an
                WHERE an.lote_id = c.lote_id ORDER BY an.criada_em DESC LIMIT 1) AS hash_versao_modelo
         FROM contestacoes c
         JOIN apolices a ON a.endereco = c.apolice_endereco
         LEFT JOIN lotes_de_imagens lt ON lt.id = c.lote_id
        WHERE c.situacao = 'deferida' AND a.situacao = 1
        ORDER BY c.decidida_em`,
    );

    res.json({ retificacoes: rows });
  });

  /** O oraculo relata a retificacao submetida. */
  r.post("/oraculo/retificacoes/:id", exigirServico, async (req, res) => {
    const { banco } = req.app.locals;
    const id = uuid(req.params.id, "id");
    const txHash = hashDeTransacao(req.body?.txHash);

    const { rowCount } = await banco.query(
      `UPDATE contestacoes SET situacao = 'publicada', tx_retificacao = $2, publicada_em = now()
        WHERE id = $1 AND situacao = 'deferida'`,
      [id, txHash],
    );

    if (rowCount === 0) throw conflito("Contestacao inexistente ou que nao aguardava publicacao.");

    await auditar(banco, req, "retificacao_publicada", { recurso: id, txHash });
    res.json({ id, situacao: "publicada", txHash });
  });

  return r;
}
