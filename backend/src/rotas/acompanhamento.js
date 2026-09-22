import { Router } from "express";

import { naoEncontrado } from "../erros.js";
import { exigirPerfil, exigirSessao } from "../seguranca/sessoes.js";

/**
 * Notificacoes, relatorios, auditoria e saude do servico (RF15, RF27, RNF25).
 */
export function rotasDeAcompanhamento() {
  const r = Router();

  // ------------------------------------------------------- notificacoes

  r.get("/notificacoes", exigirSessao, async (req, res) => {
    const { rows } = await req.app.locals.banco.query(
      `SELECT id, tipo, titulo, mensagem, apolice_endereco, tx_hash, lida_em, criada_em
         FROM notificacoes WHERE usuario_id = $1
        ORDER BY criada_em DESC LIMIT 100`,
      [req.usuario.id],
    );

    res.json({ notificacoes: rows, naoLidas: rows.filter((n) => !n.lida_em).length });
  });

  r.post("/notificacoes/:id/lida", exigirSessao, async (req, res) => {
    const { rowCount } = await req.app.locals.banco.query(
      "UPDATE notificacoes SET lida_em = now() WHERE id = $1 AND usuario_id = $2 AND lida_em IS NULL",
      [Number(req.params.id), req.usuario.id],
    );

    if (rowCount === 0) throw naoEncontrado("Notificacao");
    res.status(204).end();
  });

  r.post("/notificacoes/lidas", exigirSessao, async (req, res) => {
    await req.app.locals.banco.query(
      "UPDATE notificacoes SET lida_em = now() WHERE usuario_id = $1 AND lida_em IS NULL",
      [req.usuario.id],
    );

    res.status(204).end();
  });

  // --------------------------------------------------------- relatorios

  /**
   * Indicadores da carteira (RF15, UC15) e os numeros do capitulo de resultados.
   *
   * Tudo vem do banco, que o indexador mantem em dia com a cadeia. Os numeros de
   * gas e latencia so contam publicacoes confirmadas na rede: o relato do oraculo
   * sem o evento correspondente nao entra na estatistica.
   */
  r.get("/relatorios/carteira", exigirSessao, exigirPerfil("seguradora"), async (req, res) => {
    const { banco } = req.app.locals;

    const [carteira, publicacoes, fontes, propostas] = await Promise.all([
      banco.query(`
        SELECT count(*)::int                                       AS apolices,
               count(*) FILTER (WHERE situacao = 0)::int            AS aguardando_garantia,
               count(*) FILTER (WHERE situacao = 1)::int            AS ativas,
               count(*) FILTER (WHERE situacao = 2)::int            AS liquidadas,
               count(*) FILTER (WHERE situacao = 3)::int            AS encerradas,
               COALESCE(sum(valor_indenizacao_wei), 0)::text        AS limite_total_wei,
               COALESCE(sum(valor_pago_wei), 0)::text               AS pago_total_wei
          FROM apolices`),
      banco.query(`
        SELECT count(*)::int                                                 AS total,
               count(*) FILTER (WHERE acionou_pagamento)::int                AS com_acionamento,
               COALESCE(min(gas_usado), 0)::text                             AS gas_minimo,
               COALESCE(max(gas_usado), 0)::text                             AS gas_maximo,
               COALESCE(round(avg(gas_usado)), 0)::text                      AS gas_medio,
               COALESCE(round(avg(gas_usado) FILTER (WHERE NOT acionou_pagamento)), 0)::text AS gas_medio_sem_acionar,
               COALESCE(round(avg(gas_usado) FILTER (WHERE acionou_pagamento)), 0)::text     AS gas_medio_acionando,
               round(avg(latencia_ms))::int                                  AS latencia_media_ms,
               percentile_cont(0.95) WITHIN GROUP (ORDER BY latencia_ms)::int AS latencia_p95_ms
          FROM publicacoes_oraculo WHERE confirmada_na_cadeia`),
      banco.query(`
        SELECT count(*)::int                                  AS total,
               count(*) FILTER (WHERE ativa)::int              AS ativas,
               count(*) FILTER (WHERE escore < 0.5)::int       AS abaixo_do_limiar
          FROM fontes`),
      banco.query(`
        SELECT count(*) FILTER (WHERE situacao IN ('pendente', 'preparada'))::int AS pendentes
          FROM propostas`),
    ]);

    const c = carteira.rows[0];

    res.json({
      carteira: {
        ...c,
        taxaDeAcionamento: c.apolices > 0 ? c.liquidadas / c.apolices : 0,
      },
      publicacoes: publicacoes.rows[0],
      fontes: fontes.rows[0],
      propostasPendentes: propostas.rows[0].pendentes,
    });
  });

  /** Trilha de auditoria (RNF25). Somente leitura; nenhuma rota altera esta tabela. */
  r.get("/auditoria", exigirSessao, exigirPerfil("seguradora"), async (req, res) => {
    const params = [];
    let filtro = "";

    if (req.query.txHash) {
      params.push(String(req.query.txHash).toLowerCase());
      filtro = `WHERE a.tx_hash = $${params.length}`;
    }

    const { rows } = await req.app.locals.banco.query(
      `SELECT a.id, a.instante, a.acao, a.recurso, a.tx_hash, a.perfil, a.ip, a.detalhes,
              u.identificador AS usuario
         FROM auditoria a LEFT JOIN usuarios u ON u.id = a.usuario_id
         ${filtro}
        ORDER BY a.instante DESC LIMIT 200`,
      params,
    );

    res.json({ registros: rows });
  });

  // ------------------------------------------------------------- saude

  r.get("/saude", async (req, res) => {
    const { banco, cadeia, indexador } = req.app.locals;

    const inicio = Date.now();
    await banco.query("SELECT 1");

    res.json({
      situacao: "ok",
      banco: { motor: banco.motor, latenciaMs: Date.now() - inicio },
      cadeia: { contratosImplantados: cadeia.disponivel(), fabrica: cadeia.enderecoDaFabrica() },
      indexador: indexador ? indexador.estado() : { ativo: false },
    });
  });

  return r;
}
