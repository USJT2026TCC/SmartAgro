import { Router } from "express";

import { naoEncontrado, pedidoInvalido } from "../erros.js";
import { auditar, exigirServico } from "../seguranca/sessoes.js";
import { endereco, hashDeTransacao, inteiro, periodo, texto } from "../validacao.js";

/**
 * Interface entre o backend e o servico de oraculo.
 *
 * A documentacao descreve o fluxo assim: o back-end entrega os indices ao
 * oraculo, o oraculo assina e publica. Na implementacao, a divisao ficou:
 *
 *  - o BACKEND guarda as leituras autenticadas na origem e as analises de
 *    imagem, e diz ao oraculo quais apolices estao ativas;
 *  - o ORACULO busca as leituras, consolida o indice, assina e publica — e
 *    depois relata aqui o que fez.
 *
 * A consolidacao fica no oraculo, e nao no backend, porque quem assina o numero
 * e quem precisa responder por ele. O oraculo nao publica um indice que ele
 * mesmo nao calculou a partir das leituras; ele revalida tudo, com a mesma
 * funcao de plausibilidade que o backend usou na ingestao.
 *
 * Todas as rotas exigem a chave de servico.
 */

/** Formato de periodo AAAAMMDD para data UTC no fim daquele dia. */
function fimDoDia(p) {
  const t = String(p);
  return new Date(
    Date.UTC(Number(t.slice(0, 4)), Number(t.slice(4, 6)) - 1, Number(t.slice(6, 8)), 23, 59, 59),
  );
}

export function rotasDoOraculo() {
  const r = Router();

  r.use("/oraculo", exigirServico);

  /**
   * Apolices que podem receber publicacao agora, com o talhao e as fontes.
   *
   * Situacao 1 e ATIVA. A situacao aqui e um espelho atualizado pelo indexador;
   * o contrato continua sendo a autoridade, e o oraculo ensaia a chamada antes
   * de gastar gas.
   */
  r.get("/oraculo/apolices-ativas", async (req, res) => {
    const { rows } = await req.app.locals.banco.query(
      `SELECT a.endereco, a.produtor_carteira, a.valor_indenizacao_wei,
              t.id AS talhao_id, t.identificador AS talhao,
              p.termos,
              COALESCE(
                (SELECT json_agg(json_build_object('id', f.id, 'tipo', f.tipo, 'escore', f.escore) ORDER BY f.id)
                   FROM fontes f WHERE f.talhao_id = t.id AND f.ativa),
                '[]'::json
              ) AS fontes
         FROM apolices a
         LEFT JOIN talhoes t   ON t.id = a.talhao_id
         LEFT JOIN propostas p ON p.id = a.proposta_id
        WHERE a.situacao = 1
        ORDER BY a.emitida_em`,
    );

    res.json({ apolices: rows });
  });

  /**
   * Leituras de um talhao, no formato que `consolidarIndiceClimatico` espera.
   *
   * Vao TODAS as leituras das fontes ativas, validas e invalidas. O oraculo
   * revalida por conta propria, e a propria contagem de descartes entra na
   * procedencia que ele grava junto com a publicacao.
   */
  r.get("/oraculo/leituras", async (req, res) => {
    const { banco } = req.app.locals;
    const talhao = texto(req.query.talhao, "talhao", { max: 31 });
    const ate = periodo(req.query.ate, "ate");
    const dias = inteiro(req.query.dias ?? 90, "dias", { min: 1, max: 366 });

    const { rows: talhoes } = await banco.query("SELECT id FROM talhoes WHERE identificador = $1", [
      talhao,
    ]);
    if (!talhoes[0]) throw naoEncontrado("Talhao");

    const limite = fimDoDia(ate);

    const { rows } = await banco.query(
      `SELECT l.fonte_id AS fonte, l.instante, l.chuva_mm, l.temperatura_c, l.umidade_pct
         FROM leituras l JOIN fontes f ON f.id = l.fonte_id
        WHERE f.talhao_id = $1 AND f.ativa
          AND l.instante <= $2
          AND l.instante > $2::timestamptz - make_interval(days => $3)
        ORDER BY l.instante`,
      [talhoes[0].id, limite, dias],
    );

    // numeric chega como texto; o consolidador espera numero.
    const numero = (v) => (v === null ? undefined : Number(v));

    res.json({
      talhao,
      ate,
      leituras: rows.map((l) => ({
        fonte: l.fonte,
        timestamp: new Date(l.instante).toISOString(),
        chuvaMm: numero(l.chuva_mm),
        temperaturaC: numero(l.temperatura_c),
        umidadePct: numero(l.umidade_pct),
      })),
    });
  });

  /**
   * Resultado mais recente do modulo de visao para o talhao (RF16).
   *
   * Analises encaminhadas ao perito por baixa confianca nao saem daqui enquanto
   * nao forem revisadas (RF17): o indice de dano nao deve cruzar a fronteira sem
   * que alguem responda por ele.
   */
  r.get("/oraculo/visao", async (req, res) => {
    const { banco } = req.app.locals;
    const talhao = texto(req.query.talhao, "talhao", { max: 31 });
    const ate = periodo(req.query.ate, "ate");

    const { rows } = await banco.query(
      `SELECT an.indice_dano_bps, an.confianca_bps, an.versao_modelo, an.hash_versao_modelo,
              an.decisao_do_perito,
              lt.hash_evidencias, lt.id AS lote_id, an.criada_em
         FROM analises_de_imagem an
         JOIN lotes_de_imagens lt ON lt.id = an.lote_id
         JOIN talhoes t ON t.id = lt.talhao_id
        WHERE t.identificador = $1
          AND lt.hash_evidencias IS NOT NULL
          AND an.criada_em <= $2
          AND (NOT an.encaminhada_ao_perito OR an.decisao_do_perito = 'liberada')
        ORDER BY an.criada_em DESC
        LIMIT 1`,
      [talhao, fimDoDia(ate)],
    );

    const a = rows[0];

    res.json({
      visao: a
        ? {
            loteId: a.lote_id,
            indiceDanoBps: a.indice_dano_bps,
            confiancaBps: a.confianca_bps,
            versaoModelo: a.versao_modelo,
            hashVersaoModelo: a.hash_versao_modelo,
            hashEvidencias: a.hash_evidencias,
            // Verdadeiro quando a analise tinha confianca baixa e o perito a
            // liberou. O oraculo nao reaplica o limiar nesse caso.
            liberadaPeloPerito: a.decisao_do_perito === "liberada",
            analisadoEm: a.criada_em,
          }
        : null,
    });
  });

  /**
   * Relato de publicacao (RF22).
   *
   * Grava o que a cadeia nao guarda: gas estimado, latencia entre envio e
   * confirmacao, e a procedencia do indice. A publicacao so e marcada como
   * confirmada quando o indexador encontra o evento na rede — o relato sozinho
   * e so a palavra do oraculo.
   */
  r.post("/oraculo/publicacoes", async (req, res) => {
    const { banco } = req.app.locals;
    const c = req.body ?? {};

    const apolice = endereco(c.apolice, "apolice");
    const txHash = hashDeTransacao(c.txHash);
    const p = periodo(c.periodo);

    const enviadoEm = c.enviadoEm ? new Date(c.enviadoEm) : null;
    const confirmadoEm = c.confirmadoEm ? new Date(c.confirmadoEm) : null;
    const latencia =
      enviadoEm && confirmadoEm ? Math.max(0, confirmadoEm.getTime() - enviadoEm.getTime()) : null;

    const inteiroOuNulo = (v) =>
      v === undefined || v === null || v === "" ? null : String(BigInt(v));

    // O indexador pode ter visto o evento antes de o relato chegar. Nesse caso a
    // publicacao nasce ja confirmada.
    const { rows: vistos } = await banco.query(
      `SELECT 1 FROM eventos_cadeia
        WHERE contrato = $1 AND nome = 'IndicesPublicados' AND (argumentos->>'periodo')::int = $2`,
      [apolice, p],
    );

    await banco.query(
      `INSERT INTO publicacoes_oraculo
         (apolice_endereco, periodo, tx_hash, indice_climatico, indice_dano_bps, confianca_bps,
          gas_usado, gas_estimado, custo_wei, bloco, enviado_em, confirmado_em, latencia_ms,
          acionou_pagamento, procedencia, oraculo, confirmada_na_cadeia)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
       ON CONFLICT (tx_hash) DO NOTHING`,
      [
        apolice,
        p,
        txHash,
        inteiro(c.indiceClimatico, "indiceClimatico", { min: 0, max: 4294967295 }),
        inteiro(c.indiceDanoBps ?? 0, "indiceDanoBps", { min: 0, max: 10000 }),
        inteiro(c.confiancaBps ?? 0, "confiancaBps", { min: 0, max: 10000 }),
        inteiroOuNulo(c.gasUsado),
        inteiroOuNulo(c.gasEstimado),
        inteiroOuNulo(c.custoWei),
        c.bloco ?? null,
        enviadoEm,
        confirmadoEm,
        latencia,
        Boolean(c.acionouPagamento),
        c.procedencia ? JSON.stringify(c.procedencia) : null,
        c.oraculo ? String(c.oraculo).toLowerCase() : null,
        vistos.length > 0,
      ],
    );

    await auditar(banco, req, "publicacao_relatada", {
      recurso: apolice,
      txHash,
      detalhes: { periodo: p },
    });

    res.status(201).json({ registrada: true, confirmadaNaCadeia: vistos.length > 0 });
  });

  /**
   * Relato de falha de publicacao (RF27: notificar falhas).
   *
   * Quando o oraculo esgota as tentativas, a seguradora precisa saber: ha um
   * periodo sem indice publicado, e a apolice pode estar deixando de acionar.
   */
  r.post("/oraculo/falhas", async (req, res) => {
    const { banco } = req.app.locals;
    const c = req.body ?? {};

    const apolice = endereco(c.apolice, "apolice");
    const p = periodo(c.periodo);
    const motivo = texto(c.motivo, "motivo", { max: 500 });

    if (!Number.isInteger(c.tentativas ?? 0))
      throw pedidoInvalido('O campo "tentativas" deve ser inteiro.');

    const { rows: seguradoras } = await banco.query(
      "SELECT id FROM usuarios WHERE perfil = 'seguradora'",
    );

    for (const { id } of seguradoras) {
      await banco.query(
        `INSERT INTO notificacoes (usuario_id, tipo, titulo, mensagem, apolice_endereco, tx_hash)
         VALUES ($1, 'falha_de_publicacao', $2, $3, $4, $5)
         ON CONFLICT (usuario_id, tipo, tx_hash) DO NOTHING`,
        [
          id,
          "Falha na publicacao do oraculo",
          `O periodo ${p} nao foi publicado apos ${c.tentativas ?? "varias"} tentativa(s): ${motivo}`,
          apolice,
          // Sem transacao, a chave de unicidade usa apolice e periodo, para que o
          // mesmo relato repetido nao notifique duas vezes.
          `falha:${apolice}:${p}`,
        ],
      );
    }

    await auditar(banco, req, "falha_de_publicacao", {
      recurso: apolice,
      detalhes: { periodo: p, motivo },
    });

    res.status(201).json({ notificados: seguradoras.length });
  });

  return r;
}
