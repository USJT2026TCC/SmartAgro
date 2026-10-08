import { Router } from "express";

import { naoEncontrado, pedidoInvalido } from "../erros.js";
import { exigirPerfil, exigirSessao } from "../seguranca/sessoes.js";

/**
 * Notificacoes, relatorios, auditoria e saude do servico (RF27, RF29).
 */
/** Filtros do relatorio (RF29): periodo de emissao, cultura e regiao (municipio). */
function filtrosDoRelatorio(q) {
  const data = (valor, campo) => {
    if (valor === undefined || valor === "") return null;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(valor))) {
      throw pedidoInvalido(`O filtro "${campo}" deve estar no formato AAAA-MM-DD.`);
    }
    return String(valor);
  };
  const textoOpcional = (valor) => (valor === undefined || valor === "" ? null : String(valor).slice(0, 120));

  return {
    de: data(q.de, "de"),
    ate: data(q.ate, "ate"),
    cultura: textoOpcional(q.cultura)?.toLowerCase() ?? null,
    regiao: textoOpcional(q.regiao),
  };
}

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
   * Indicadores da carteira (RF29, UC15) e os numeros do capitulo de resultados.
   *
   * Tudo vem do banco, que o indexador mantem em dia com a cadeia. Os numeros de
   * gas e latencia so contam publicacoes confirmadas na rede: o relato do oraculo
   * sem o evento correspondente nao entra na estatistica.
   */
  r.get("/relatorios/carteira", exigirSessao, exigirPerfil("seguradora"), async (req, res) => {
    const { banco } = req.app.locals;
    const filtro = filtrosDoRelatorio(req.query);

    // Base filtrada: as apolices que entram em todos os numeros abaixo.
    const BASE = `
      WITH base AS (
        SELECT a.*, t.cultura, pr.municipio
          FROM apolices a
          LEFT JOIN talhoes t ON t.id = a.talhao_id
          LEFT JOIN propriedades pr ON pr.id = t.propriedade_id
         WHERE ($1::date IS NULL OR a.emitida_em >= $1::date)
           AND ($2::date IS NULL OR a.emitida_em < $2::date + 1)
           AND ($3::text IS NULL OR t.cultura = $3)
           AND ($4::text IS NULL OR pr.municipio = $4)
      )`;
    const parametros = [filtro.de, filtro.ate, filtro.cultura, filtro.regiao];

    const AGREGADOS = `
      count(*)::int                                       AS apolices,
      count(*) FILTER (WHERE situacao = 0)::int            AS aguardando_garantia,
      count(*) FILTER (WHERE situacao = 1)::int            AS ativas,
      count(*) FILTER (WHERE situacao = 2)::int            AS liquidadas,
      count(*) FILTER (WHERE situacao = 3)::int            AS encerradas,
      count(*) FILTER (WHERE situacao = 4)::int            AS canceladas,
      COALESCE(sum(valor_indenizacao_wei), 0)::text        AS limite_total_wei,
      COALESCE(sum(valor_pago_wei), 0)::text               AS pago_total_wei`;

    const [carteira, porCultura, porRegiao, liquidacao, publicacoes, fontes, propostas, opcoes] =
      await Promise.all([
        banco.query(`${BASE} SELECT ${AGREGADOS} FROM base`, parametros),
        banco.query(
          `${BASE} SELECT COALESCE(cultura, 'sem talhao') AS cultura, ${AGREGADOS}
             FROM base GROUP BY 1 ORDER BY 1`,
          parametros,
        ),
        banco.query(
          `${BASE} SELECT COALESCE(municipio, 'sem talhao') AS regiao, ${AGREGADOS}
             FROM base GROUP BY 1 ORDER BY 1`,
          parametros,
        ),
        // Tempo de liquidacao: do fim do dia em que a condicao foi atingida (o
        // periodo acionador) ate o bloco que transferiu a indenizacao. E o que o
        // RNF21 limita a 72 horas.
        banco.query(
          `${BASE}
           SELECT count(*)::int AS pagamentos,
                  round(avg(EXTRACT(EPOCH FROM (e.instante - fim.dia)) / 3600)::numeric, 2)::float AS media_horas,
                  round(max(EXTRACT(EPOCH FROM (e.instante - fim.dia)) / 3600)::numeric, 2)::float AS maximo_horas
             FROM base b
             JOIN eventos_cadeia e ON e.contrato = b.endereco AND e.nome = 'PagamentoExecutado'
             CROSS JOIN LATERAL (
               -- O periodo e um dia em UTC, como no oraculo (consolidador.diaDe).
               SELECT (to_date(b.periodo_acionador::text, 'YYYYMMDD') + 1)::timestamp AT TIME ZONE 'UTC' AS dia
             ) fim
            WHERE b.periodo_acionador IS NOT NULL`,
          parametros,
        ),
        banco.query(
          `${BASE}
           SELECT count(*)::int                                                 AS total,
                  count(*) FILTER (WHERE acionou_pagamento)::int                AS com_acionamento,
                  COALESCE(min(gas_usado), 0)::text                             AS gas_minimo,
                  COALESCE(max(gas_usado), 0)::text                             AS gas_maximo,
                  COALESCE(round(avg(gas_usado)), 0)::text                      AS gas_medio,
                  COALESCE(round(avg(gas_usado) FILTER (WHERE NOT acionou_pagamento)), 0)::text AS gas_medio_sem_acionar,
                  COALESCE(round(avg(gas_usado) FILTER (WHERE acionou_pagamento)), 0)::text     AS gas_medio_acionando,
                  round(avg(latencia_ms))::int                                  AS latencia_media_ms,
                  percentile_cont(0.95) WITHIN GROUP (ORDER BY latencia_ms)::int AS latencia_p95_ms
             FROM publicacoes_oraculo p
            WHERE p.confirmada_na_cadeia
              AND p.apolice_endereco IN (SELECT endereco FROM base)`,
          parametros,
        ),
        banco.query(`
          SELECT count(*)::int                                  AS total,
                 count(*) FILTER (WHERE ativa)::int              AS ativas,
                 count(*) FILTER (WHERE escore < 0.5)::int       AS abaixo_do_limiar
            FROM fontes`),
        banco.query(`
          SELECT count(*) FILTER (WHERE situacao IN ('pendente', 'preparada'))::int AS pendentes
            FROM propostas`),
        // Valores possiveis dos filtros, para a tela montar as listas.
        banco.query(`
          SELECT array_agg(DISTINCT t.cultura) FILTER (WHERE t.cultura IS NOT NULL)    AS culturas,
                 array_agg(DISTINCT pr.municipio) FILTER (WHERE pr.municipio IS NOT NULL) AS regioes
            FROM talhoes t JOIN propriedades pr ON pr.id = t.propriedade_id`),
      ]);

    const c = carteira.rows[0];

    res.json({
      filtros: filtro,
      opcoesDeFiltro: {
        culturas: (opcoes.rows[0].culturas ?? []).sort(),
        regioes: (opcoes.rows[0].regioes ?? []).sort(),
      },
      carteira: {
        ...c,
        taxaDeAcionamento: c.apolices > 0 ? c.liquidadas / c.apolices : 0,
      },
      porCultura: porCultura.rows,
      porRegiao: porRegiao.rows,
      liquidacao: liquidacao.rows[0],
      publicacoes: publicacoes.rows[0],
      fontes: fontes.rows[0],
      propostasPendentes: propostas.rows[0].pendentes,
    });
  });

  /** Trilha de auditoria. Somente leitura; nenhuma rota altera esta tabela. */
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
