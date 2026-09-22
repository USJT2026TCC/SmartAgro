import { Router } from "express";

import { conflito, naoEncontrado, pedidoInvalido } from "../erros.js";
import { apoliceDoRecibo } from "../cadeia/leitor.js";
import { registrarApoliceEmitida } from "../dominio/apolices.js";
import { calcularCotacao } from "../dominio/cotacao.js";
import { descreverTermos, montarStructDeTermos, resumirTermos } from "../dominio/termos.js";
import { auditar, exigirPerfil, exigirSessao } from "../seguranca/sessoes.js";
import { decimalPositivo, hashDeTransacao, uuid } from "../validacao.js";

/**
 * Cotacao, proposta e emissao da apolice (RF06, RF07, RF08, UC04, UC05).
 *
 * O fluxo tem tres tempos, e a divisao nao e acidental:
 *
 *  1. o PRODUTOR envia a proposta. A cotacao e recalculada aqui, a partir da
 *     area medida pelo PostGIS — o valor que o navegador mostrou serve de
 *     previa, mas o que vale e o do servidor;
 *
 *  2. a SEGURADORA prepara a emissao. O backend fixa a vigencia pelo relogio da
 *     cadeia, gera o texto canonico dos termos e o resumo, e devolve a struct
 *     pronta para `emitirApolice`;
 *
 *  3. a seguradora assina a emissao na carteira dela e informa o identificador
 *     da transacao. O backend NAO acredita na informacao: le o recibo na cadeia,
 *     confere que a transacao foi para a fabrica oficial, extrai o endereco da
 *     apolice do evento e compara o `hashTermos` gravado no contrato com o que
 *     ele mesmo gerou no passo 2.
 *
 * O backend nao assina nada. Quem implanta o contrato continua sendo a carteira
 * da seguradora, e quem responde pela emissao na cadeia e ela (RNF12).
 */

function propostaPublica(p) {
  return {
    id: p.id,
    situacao: p.situacao,
    produtor: { id: p.produtor_id, nome: p.produtor_nome, identificador: p.produtor_identificador },
    talhao: { id: p.talhao_id, identificador: p.talhao_identificador, cultura: p.talhao_cultura },
    produto: { id: p.produto_id, nome: p.produto_nome },
    areaSeguradaHa: p.area_segurada_ha,
    carteiraProdutor: p.carteira_produtor,
    valorIndenizacaoWei: p.valor_indenizacao_wei,
    premioWei: p.premio_wei,
    termos: p.termos,
    descricaoDosTermos: p.descricao_dos_termos,
    hashTermos: p.hash_termos,
    vigenciaInicio: p.vigencia_inicio,
    vigenciaFim: p.vigencia_fim,
    apolice: p.apolice_endereco
      ? { endereco: p.apolice_endereco, txEmissao: p.tx_emissao, situacao: p.apolice_situacao }
      : null,
    criadaEm: p.criada_em,
    atualizadaEm: p.atualizada_em,
  };
}

const SQL_PROPOSTA = `
  SELECT p.*,
         u.nome AS produtor_nome, u.identificador AS produtor_identificador,
         t.identificador AS talhao_identificador, t.cultura AS talhao_cultura,
         pr.nome AS produto_nome,
         a.endereco AS apolice_endereco, a.tx_emissao, a.situacao AS apolice_situacao
    FROM propostas p
    JOIN usuarios u  ON u.id = p.produtor_id
    JOIN talhoes t   ON t.id = p.talhao_id
    JOIN produtos pr ON pr.id = p.produto_id
    LEFT JOIN apolices a ON a.proposta_id = p.id
`;

/** Carrega talhao e produto conferindo que pertencem ao produtor e combinam entre si. */
async function carregarBase(banco, { talhaoId, produtoId, produtorId }) {
  const { rows: talhoes } = await banco.query(
    `SELECT t.id, t.identificador, t.cultura, t.area_ha, p.produtor_id
       FROM talhoes t JOIN propriedades p ON p.id = t.propriedade_id
      WHERE t.id = $1`,
    [talhaoId],
  );

  const talhao = talhoes[0];

  // Talhao de outro produtor responde como inexistente, e nao como proibido:
  // "proibido" confirmaria que o identificador existe.
  if (!talhao || talhao.produtor_id !== produtorId) throw naoEncontrado("Talhao");

  const { rows: produtos } = await banco.query("SELECT * FROM produtos WHERE id = $1 AND ativo", [
    produtoId,
  ]);

  const produto = produtos[0];
  if (!produto) throw naoEncontrado("Produto");

  if (produto.cultura !== talhao.cultura) {
    throw pedidoInvalido(
      `O produto cobre ${produto.cultura}, mas o talhao esta plantado com ${talhao.cultura}.`,
    );
  }

  return { talhao, produto };
}

/** Confere a area informada contra a area medida do talhao. */
function areaSegurada(valor, talhao) {
  const area = decimalPositivo(valor, "areaHa", { casas: 4 });

  if (Number(area) > Number(talhao.area_ha)) {
    throw pedidoInvalido(`A area segurada excede os ${talhao.area_ha} ha medidos do talhao.`);
  }

  return area;
}

function termosDoProduto(produto) {
  return {
    operador: produto.operador,
    modoPagamento: produto.modo_pagamento,
    limiarClimatico: produto.limiar_climatico,
    limiarClimaticoIntegral: produto.limiar_climatico_integral,
    limiarDanoBps: produto.limiar_dano_bps,
    limiarDanoIntegralBps: produto.limiar_dano_integral_bps,
    vigenciaDias: produto.vigencia_dias,
    valorPorHectareWei: produto.valor_por_hectare_wei,
    taxaPremioBps: produto.taxa_premio_bps,
  };
}

export function rotasDePropostas() {
  const r = Router();

  /**
   * Simulacao de cotacao (RF06). Nao grava nada.
   */
  r.post("/cotacoes", exigirSessao, exigirPerfil("produtor"), async (req, res) => {
    const { banco } = req.app.locals;
    const { talhao, produto } = await carregarBase(banco, {
      talhaoId: uuid(req.body?.talhaoId, "talhaoId"),
      produtoId: uuid(req.body?.produtoId, "produtoId"),
      produtorId: req.usuario.id,
    });

    const area = areaSegurada(req.body?.areaHa ?? talhao.area_ha, talhao);
    const { valorIndenizacaoWei, premioWei } = calcularCotacao({
      areaHa: area,
      valorPorHectareWei: produto.valor_por_hectare_wei,
      taxaPremioBps: produto.taxa_premio_bps,
    });

    res.json({
      cotacao: {
        areaSeguradaHa: area,
        areaMedidaDoTalhaoHa: talhao.area_ha,
        valorIndenizacaoWei: valorIndenizacaoWei.toString(),
        premioWei: premioWei.toString(),
        termos: termosDoProduto(produto),
      },
    });
  });

  /**
   * Proposta (UC05, primeira metade). Exige carteira vinculada: e para ela que a
   * indenizacao seria transferida, e ela precisa ter sido comprovada por
   * assinatura antes (RF02).
   */
  r.post("/propostas", exigirSessao, exigirPerfil("produtor"), async (req, res) => {
    const { banco } = req.app.locals;

    if (!req.usuario.carteira) {
      throw pedidoInvalido(
        "Vincule a carteira antes de enviar a proposta: e para ela que a indenizacao seria transferida.",
      );
    }

    const talhaoId = uuid(req.body?.talhaoId, "talhaoId");
    const produtoId = uuid(req.body?.produtoId, "produtoId");
    const { talhao, produto } = await carregarBase(banco, {
      talhaoId,
      produtoId,
      produtorId: req.usuario.id,
    });

    const area = areaSegurada(req.body?.areaHa, talhao);
    const { valorIndenizacaoWei, premioWei } = calcularCotacao({
      areaHa: area,
      valorPorHectareWei: produto.valor_por_hectare_wei,
      taxaPremioBps: produto.taxa_premio_bps,
    });

    const { rows } = await banco.query(
      `INSERT INTO propostas (produtor_id, talhao_id, produto_id, area_segurada_ha, carteira_produtor,
                              valor_indenizacao_wei, premio_wei, termos)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id`,
      [
        req.usuario.id,
        talhaoId,
        produtoId,
        area,
        req.usuario.carteira,
        valorIndenizacaoWei.toString(),
        premioWei.toString(),
        JSON.stringify(termosDoProduto(produto)),
      ],
    );

    await auditar(banco, req, "proposta_enviada", { recurso: rows[0].id });

    const { rows: completas } = await banco.query(`${SQL_PROPOSTA} WHERE p.id = $1`, [rows[0].id]);
    res.status(201).json({ proposta: propostaPublica(completas[0]) });
  });

  r.get("/propostas", exigirSessao, async (req, res) => {
    const { banco } = req.app.locals;

    const { rows } =
      req.usuario.perfil === "produtor"
        ? await banco.query(`${SQL_PROPOSTA} WHERE p.produtor_id = $1 ORDER BY p.criada_em DESC`, [
            req.usuario.id,
          ])
        : req.usuario.perfil === "seguradora"
          ? await banco.query(`${SQL_PROPOSTA} ORDER BY p.criada_em DESC`)
          : { rows: [] };

    res.json({ propostas: rows.map(propostaPublica) });
  });

  /**
   * Preparacao da emissao (RF08).
   *
   * Pode ser chamada de novo enquanto a proposta nao foi emitida — a seguradora
   * pode ter desistido de assinar e voltado no dia seguinte. Cada chamada fixa
   * uma vigencia nova e, portanto, um resumo novo; so o ultimo vale.
   */
  r.post("/propostas/:id/preparar", exigirSessao, exigirPerfil("seguradora"), async (req, res) => {
    const { banco, cadeia } = req.app.locals;
    const id = uuid(req.params.id, "id");

    const { rows } = await banco.query(`${SQL_PROPOSTA} WHERE p.id = $1`, [id]);
    const p = rows[0];

    if (!p) throw naoEncontrado("Proposta");
    if (p.situacao === "emitida") throw conflito("Esta proposta ja foi emitida.");
    if (p.situacao === "recusada") throw conflito("Esta proposta foi recusada.");

    if (!cadeia.disponivel()) {
      throw conflito("Nenhum contrato implantado na rede configurada. Implante antes de emitir.");
    }

    const inicio = await cadeia.instanteAtual();
    const fim = inicio + Number(p.termos.vigenciaDias) * 86_400;

    const dados = {
      propostaId: p.id,
      carteiraProdutor: p.carteira_produtor,
      talhao: p.talhao_identificador,
      cultura: p.talhao_cultura,
      areaHa: p.area_segurada_ha,
      operador: p.termos.operador,
      modoPagamento: p.termos.modoPagamento,
      limiarClimatico: p.termos.limiarClimatico,
      limiarClimaticoIntegral: p.termos.limiarClimaticoIntegral,
      limiarDanoBps: p.termos.limiarDanoBps,
      limiarDanoIntegralBps: p.termos.limiarDanoIntegralBps,
      valorIndenizacaoWei: p.valor_indenizacao_wei,
      premioWei: p.premio_wei,
      vigenciaInicio: inicio,
      vigenciaFim: fim,
    };

    const descricao = descreverTermos(dados);
    const hashTermos = resumirTermos(descricao);

    await banco.query(
      `UPDATE propostas
          SET situacao = 'preparada', descricao_dos_termos = $2, hash_termos = $3,
              vigencia_inicio = to_timestamp($4), vigencia_fim = to_timestamp($5), atualizada_em = now()
        WHERE id = $1`,
      [id, descricao, hashTermos, inicio, fim],
    );

    await auditar(banco, req, "emissao_preparada", { recurso: id, detalhes: { hashTermos } });

    res.json({
      termos: montarStructDeTermos(dados, hashTermos),
      descricaoDosTermos: descricao,
      hashTermos,
      fabrica: cadeia.enderecoDaFabrica(),
    });
  });

  /**
   * Confirmacao da emissao (RF07, RF08). O backend confere tudo na cadeia.
   */
  r.post("/propostas/:id/emissao", exigirSessao, exigirPerfil("seguradora"), async (req, res) => {
    const { banco, cadeia } = req.app.locals;
    const id = uuid(req.params.id, "id");
    const txHash = hashDeTransacao(req.body?.txHash);

    const { rows } = await banco.query("SELECT * FROM propostas WHERE id = $1", [id]);
    const proposta = rows[0];

    if (!proposta) throw naoEncontrado("Proposta");
    if (!proposta.hash_termos) throw conflito("Prepare a emissao antes de confirmar.");

    const recibo = await cadeia.recibo(txHash);

    // Transacao ainda nao minerada: o aplicativo pode tentar de novo em alguns
    // segundos. E o indexador vai encontrar a emissao de qualquer forma.
    if (!recibo)
      throw conflito("Transacao ainda nao confirmada na rede. Tente de novo em instantes.");
    if (recibo.status !== 1) throw pedidoInvalido("A transacao foi revertida na rede.");

    const fabrica = cadeia.enderecoDaFabrica();

    if (recibo.para !== fabrica) {
      throw pedidoInvalido("A transacao nao foi enviada a fabrica de apolices oficial.");
    }

    const emitida = apoliceDoRecibo(recibo, fabrica);
    if (!emitida) throw pedidoInvalido("A transacao nao emitiu nenhuma apolice.");

    // O resumo gravado no contrato precisa ser o que o backend gerou. Se nao for,
    // a seguradora assinou termos diferentes dos acordados — e o cadastro nao
    // pode ligar esta apolice a esta proposta.
    if (emitida.hashTermos !== proposta.hash_termos) {
      await auditar(banco, req, "emissao_recusada_hash_divergente", {
        recurso: id,
        txHash,
        detalhes: { esperado: proposta.hash_termos, naCadeia: emitida.hashTermos },
      });

      throw pedidoInvalido(
        "O resumo dos termos gravado no contrato nao corresponde ao desta proposta.",
        {
          esperado: proposta.hash_termos,
          naCadeia: emitida.hashTermos,
        },
      );
    }

    const termos = await cadeia.termosDaApolice(emitida.endereco);

    if (termos.produtor !== proposta.carteira_produtor) {
      throw pedidoInvalido("A carteira beneficiaria no contrato nao e a do produtor da proposta.");
    }

    if (termos.valorIndenizacao !== String(proposta.valor_indenizacao_wei)) {
      throw pedidoInvalido("O limite gravado no contrato difere do limite cotado.");
    }

    const registro = await registrarApoliceEmitida(banco, {
      endereco: emitida.endereco,
      produtor: termos.produtor,
      seguradora: termos.seguradora,
      hashTermos: termos.hashTermos,
      talhaoBytes32: termos.talhao,
      valorIndenizacaoWei: termos.valorIndenizacao,
      txHash,
      bloco: recibo.bloco,
    });

    await auditar(banco, req, "apolice_emitida", { recurso: emitida.endereco, txHash });

    res.json({
      apolice: { endereco: emitida.endereco, txEmissao: txHash, bloco: recibo.bloco },
      ...registro,
    });
  });

  r.post("/propostas/:id/recusar", exigirSessao, exigirPerfil("seguradora"), async (req, res) => {
    const { banco } = req.app.locals;
    const id = uuid(req.params.id, "id");

    const { rowCount } = await banco.query(
      `UPDATE propostas SET situacao = 'recusada', atualizada_em = now()
        WHERE id = $1 AND situacao IN ('pendente', 'preparada')`,
      [id],
    );

    if (rowCount === 0) throw conflito("A proposta nao existe ou ja foi emitida.");

    await auditar(banco, req, "proposta_recusada", { recurso: id });
    res.status(204).end();
  });

  return r;
}
