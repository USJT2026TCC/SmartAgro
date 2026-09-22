import { Router } from "express";

import { config } from "../config.js";
import { naoAutenticado, pedidoInvalido } from "../erros.js";
import { recuperarAssinante } from "../dominio/assinaturaDeLote.js";
import { atualizarEscore, validarLeitura } from "../dominio/leituras.js";
import { sha256Hex } from "../seguranca/cripto.js";
import { auditar, exigirPerfil, exigirSessao, limitarIngestao } from "../seguranca/sessoes.js";
import { texto, uuid } from "../validacao.js";

/**
 * Ingestao de leituras de campo (RF11, RF12, RF13, RNF19).
 *
 * Esta rota nao usa sessao de usuario: quem chama e a estacao, o sensor ou o
 * simulador. A autenticacao e a assinatura do lote, conferida contra a chave
 * publica cadastrada para a fonte. Ver `dominio/assinaturaDeLote.js` para o
 * formato exato da mensagem assinada.
 *
 * Ordem das verificacoes, da mais barata para a mais cara:
 *   1. forma do corpo;
 *   2. fonte cadastrada e ativa;
 *   3. assinatura corresponde a chave da fonte;
 *   4. marca de tempo dentro da janela (antirrepeticao);
 *   5. lote ainda nao recebido (antirrepeticao);
 *   6. plausibilidade de cada leitura.
 *
 * Leitura implausivel NAO derruba o lote: e gravada como invalida, com o motivo,
 * e puxa para baixo a reputacao da fonte. Descartar em silencio apagaria a
 * evidencia de que o sensor falhou.
 */

const MAXIMO_DE_LEITURAS_POR_LOTE = 1_000;

export function rotasDeLeituras() {
  const r = Router();

  r.post("/leituras", limitarIngestao, async (req, res) => {
    const { banco } = req.app.locals;
    const corpo = req.body ?? {};
    const corpoBruto = req.corpoBruto;

    if (!corpoBruto) throw pedidoInvalido("Corpo da requisicao ausente.");

    const loteId = uuid(corpo.lote, "lote");
    const fonteId = texto(corpo.fonte, "fonte", { max: 60 });
    const enviadoEm = new Date(corpo.enviadoEm);

    if (Number.isNaN(enviadoEm.getTime()))
      throw pedidoInvalido('O campo "enviadoEm" deve ser uma data ISO 8601.');
    if (!Array.isArray(corpo.leituras) || corpo.leituras.length === 0) {
      throw pedidoInvalido('O campo "leituras" deve ser uma lista nao vazia.');
    }
    if (corpo.leituras.length > MAXIMO_DE_LEITURAS_POR_LOTE) {
      throw pedidoInvalido(`Um lote aceita no maximo ${MAXIMO_DE_LEITURAS_POR_LOTE} leituras.`);
    }

    const { rows: fontes } = await banco.query("SELECT * FROM fontes WHERE id = $1", [fonteId]);
    const fonte = fontes[0];

    // Fonte inexistente e assinatura errada respondem igual. Distinguir os dois
    // casos diria a um atacante quais identificadores de fonte existem.
    const assinante = recuperarAssinante(corpoBruto, req.get("x-assinatura"));

    if (!fonte || !assinante || assinante !== fonte.endereco) {
      await auditar(banco, req, "lote_recusado_assinatura", { recurso: fonteId });
      throw naoAutenticado("Assinatura do lote invalida para esta fonte.");
    }

    if (!fonte.ativa) throw pedidoInvalido("Esta fonte esta desativada.");

    const desvioMin = Math.abs(Date.now() - enviadoEm.getTime()) / 60_000;

    if (desvioMin > config.janelaDoLoteMin) {
      throw pedidoInvalido(
        `A marca de tempo do lote difere do relogio do servidor em mais de ${config.janelaDoLoteMin} minutos.`,
      );
    }

    const resultado = await banco.transacao(async (tx) => {
      // O identificador do lote e chave primaria: reenviar o mesmo lote viola a
      // unicidade e e recusado com 409, sem gravar nada.
      await tx.query(
        `INSERT INTO lotes_de_leitura (id, fonte_id, hash_corpo, assinatura, enviado_em)
         VALUES ($1, $2, $3, $4, $5)`,
        [loteId, fonteId, sha256Hex(corpoBruto), req.get("x-assinatura"), enviadoEm],
      );

      let aceitas = 0;
      let recusadas = 0;
      let duplicadas = 0;
      const resultadosDeValidade = [];
      const descartes = [];
      let maisRecente = null;

      for (const bruta of corpo.leituras) {
        const leitura = {
          fonte: fonteId,
          timestamp: bruta?.instante,
          chuvaMm: bruta?.chuvaMm,
          temperaturaC: bruta?.temperaturaC,
          umidadePct: bruta?.umidadePct,
        };

        const veredito = validarLeitura(leitura);
        const instante = new Date(leitura.timestamp);

        // Sem data valida nao ha como gravar: a leitura e contada e reportada,
        // mas nao entra na tabela, que exige o instante.
        if (Number.isNaN(instante.getTime())) {
          recusadas += 1;
          resultadosDeValidade.push(false);
          descartes.push({
            instante: bruta?.instante ?? null,
            motivo: veredito.motivo,
            campo: veredito.campo,
          });
          continue;
        }

        const numero = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);

        const { rowCount } = await tx.query(
          `INSERT INTO leituras (fonte_id, lote_id, instante, chuva_mm, temperatura_c, umidade_pct,
                                 valida, motivo_descarte)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           ON CONFLICT (fonte_id, instante) DO NOTHING`,
          [
            fonteId,
            loteId,
            instante,
            numero(leitura.chuvaMm),
            numero(leitura.temperaturaC),
            numero(leitura.umidadePct),
            veredito.valida,
            veredito.valida ? null : `${veredito.motivo}:${veredito.campo}`,
          ],
        );

        // Leitura repetida (mesma fonte, mesmo instante) nao conta na reputacao:
        // reenviar o que ja chegou nao e sinal de sensor bom nem ruim.
        if (rowCount === 0) {
          duplicadas += 1;
          continue;
        }

        resultadosDeValidade.push(veredito.valida);

        if (veredito.valida) {
          aceitas += 1;
          if (!maisRecente || instante > maisRecente) maisRecente = instante;
        } else {
          recusadas += 1;
          descartes.push({
            instante: bruta.instante,
            motivo: veredito.motivo,
            campo: veredito.campo,
          });
        }
      }

      const escore = atualizarEscore(fonte.escore, resultadosDeValidade);

      await tx.query(
        `UPDATE fontes
            SET escore = $2,
                observacoes = observacoes + $3,
                ultima_leitura_em = GREATEST(ultima_leitura_em, $4)
          WHERE id = $1`,
        [fonteId, escore, resultadosDeValidade.length, maisRecente],
      );

      await tx.query("UPDATE lotes_de_leitura SET aceitas = $2, recusadas = $3 WHERE id = $1", [
        loteId,
        aceitas,
        recusadas,
      ]);

      return { aceitas, recusadas, duplicadas, descartes, escore };
    });

    res.status(201).json({ lote: loteId, fonte: fonteId, ...resultado });
  });

  /** Consulta de leituras de um talhao, para o painel e para o perito. */
  r.get("/leituras", exigirSessao, exigirPerfil("seguradora", "perito"), async (req, res) => {
    const { banco } = req.app.locals;
    const talhaoId = uuid(req.query.talhaoId, "talhaoId");
    const dias = Math.min(Number(req.query.dias ?? 30), 366);

    const { rows } = await banco.query(
      `SELECT l.fonte_id AS fonte, l.instante, l.chuva_mm, l.temperatura_c, l.umidade_pct,
              l.valida, l.motivo_descarte
         FROM leituras l JOIN fontes f ON f.id = l.fonte_id
        WHERE f.talhao_id = $1 AND l.instante >= now() - make_interval(days => $2)
        ORDER BY l.instante DESC
        LIMIT 5000`,
      [talhaoId, dias],
    );

    res.json({ leituras: rows });
  });

  return r;
}
