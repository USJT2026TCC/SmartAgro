import { Router } from "express";

import { naoEncontrado } from "../erros.js";
import { resumirTermos } from "../dominio/termos.js";
import { exigirSessao } from "../seguranca/sessoes.js";
import { endereco } from "../validacao.js";

/**
 * Consulta de apolices (UC06, RF09).
 *
 * O aplicativo continua lendo a apolice direto do contrato, que e a fonte da
 * verdade. O que o backend acrescenta e o que a cadeia nao sabe: a qual talhao e
 * a qual proposta a apolice pertence, o texto completo dos termos, e a
 * procedencia de cada indice publicado.
 */

const SQL_APOLICE = `
  SELECT a.*, t.identificador AS talhao, t.cultura, t.area_ha,
         p.id AS proposta_id, p.descricao_dos_termos, p.area_segurada_ha, p.premio_wei,
         u.nome AS produtor_nome
    FROM apolices a
    LEFT JOIN talhoes t   ON t.id = a.talhao_id
    LEFT JOIN propostas p ON p.id = a.proposta_id
    LEFT JOIN usuarios u  ON u.carteira = a.produtor_carteira
`;

function apolicePublica(a) {
  return {
    endereco: a.endereco,
    situacao: a.situacao,
    talhao: a.talhao,
    cultura: a.cultura,
    produtor: { carteira: a.produtor_carteira, nome: a.produtor_nome },
    seguradora: a.seguradora_carteira,
    valorIndenizacaoWei: a.valor_indenizacao_wei,
    valorPagoWei: a.valor_pago_wei,
    periodoAcionador: a.periodo_acionador,
    hashTermos: a.hash_termos,
    txEmissao: a.tx_emissao,
    blocoEmissao: Number(a.bloco_emissao),
    emitidaEm: a.emitida_em,
    propostaId: a.proposta_id,
  };
}

export function rotasDeApolices() {
  const r = Router();

  r.get("/apolices", exigirSessao, async (req, res) => {
    const { banco } = req.app.locals;

    if (req.usuario.perfil === "produtor") {
      // Produtor sem carteira vinculada nao tem apolice: e pela carteira que a
      // apolice o identifica na cadeia.
      if (!req.usuario.carteira) {
        res.json({ apolices: [] });
        return;
      }

      const { rows } = await banco.query(
        `${SQL_APOLICE} WHERE a.produtor_carteira = $1 ORDER BY a.emitida_em DESC`,
        [req.usuario.carteira],
      );

      res.json({ apolices: rows.map(apolicePublica) });
      return;
    }

    const { rows } = await banco.query(`${SQL_APOLICE} ORDER BY a.emitida_em DESC`);
    res.json({ apolices: rows.map(apolicePublica) });
  });

  r.get("/apolices/:endereco", exigirSessao, async (req, res) => {
    const { banco } = req.app.locals;
    const alvo = endereco(req.params.endereco, "endereco");

    const { rows } = await banco.query(`${SQL_APOLICE} WHERE a.endereco = $1`, [alvo]);
    const a = rows[0];

    if (!a) throw naoEncontrado("Apolice");

    // Produtor so ve a propria apolice. Responde como inexistente, e nao como
    // proibido, para nao confirmar que o endereco pertence a alguem.
    if (req.usuario.perfil === "produtor" && a.produtor_carteira !== req.usuario.carteira) {
      throw naoEncontrado("Apolice");
    }

    const [eventos, publicacoes] = await Promise.all([
      banco.query(
        `SELECT nome, bloco, indice_log, tx_hash, argumentos, instante
           FROM eventos_cadeia
          WHERE contrato = $1 OR (nome = 'ApoliceEmitida' AND argumentos->>'apolice' ILIKE $1)
          ORDER BY bloco, indice_log`,
        [alvo],
      ),
      banco.query(
        `SELECT periodo, tx_hash, indice_climatico, indice_dano_bps, confianca_bps, gas_usado,
                gas_estimado, latencia_ms, acionou_pagamento, procedencia, confirmada_na_cadeia,
                enviado_em, confirmado_em
           FROM publicacoes_oraculo WHERE apolice_endereco = $1 ORDER BY periodo DESC`,
        [alvo],
      ),
    ]);

    // RF08, de ponta a ponta: o resumo recalculado a partir do texto guardado
    // precisa bater com o gravado no contrato. Qualquer alteracao no texto, por
    // menor que seja, quebra a igualdade — e e isso que a tela mostra.
    const conferenciaDosTermos = a.descricao_dos_termos
      ? {
          descricao: a.descricao_dos_termos,
          resumoRecalculado: resumirTermos(a.descricao_dos_termos),
          resumoNoContrato: a.hash_termos,
          confere: resumirTermos(a.descricao_dos_termos) === a.hash_termos,
        }
      : null;

    res.json({
      apolice: {
        ...apolicePublica(a),
        areaSeguradaHa: a.area_segurada_ha,
        premioWei: a.premio_wei,
      },
      conferenciaDosTermos,
      linhaDoTempo: eventos.rows.map((e) => ({
        nome: e.nome,
        bloco: Number(e.bloco),
        indiceNoBloco: e.indice_log,
        txHash: e.tx_hash,
        argumentos: e.argumentos,
        em: e.instante,
      })),
      publicacoes: publicacoes.rows,
    });
  });

  return r;
}
