import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { Router } from "express";
import { ethers } from "ethers";
import multer from "multer";

import { config } from "../config.js";
import { conflito, naoEncontrado, pedidoInvalido } from "../erros.js";
import { sha256Hex } from "../seguranca/cripto.js";
import {
  auditar,
  exigirPerfil,
  exigirServico,
  exigirSessao,
  limitarIngestao,
} from "../seguranca/sessoes.js";
import { texto, uuid } from "../validacao.js";

/**
 * Imagens do talhao e resultados da visao computacional (RF14, RF15, RF16, RF17).
 *
 * O modulo de visao entra na Sprint 3. O que esta aqui e a metade do backend,
 * pronta para recebe-lo:
 *
 *  1. o produtor abre um lote e envia imagens georreferenciadas. Imagem fora do
 *     poligono do talhao e recusada pelo PostGIS (RF14);
 *  2. ao fechar o lote, o backend calcula o resumo criptografico das evidencias
 *     — o valor que vai para a cadeia como `hashEvidencias` (RF16);
 *  3. o modulo de visao analisa o lote e devolve indice de dano, confianca e
 *     versao do modelo. Abaixo do limiar de confianca, a analise vai para o
 *     perito e nao segue para o oraculo (RF17).
 *
 * O contrato do modulo de visao com o backend e so a rota POST /visao/resultados.
 * Qualquer implementacao — PyTorch com FastAPI, como prevista, ou outra — so
 * precisa chamar essa rota com a chave de servico.
 */

const TIPOS_ACEITOS = new Set(["image/jpeg", "image/png"]);
const EXTENSOES = { "image/jpeg": "jpg", "image/png": "png" };

/** Abaixo disso, a analise vai para o perito (RF17). 70%, o mesmo limiar do oraculo. */
const LIMIAR_CONFIANCA_BPS = Number(process.env.LIMIAR_CONFIANCA_BPS || 7000);

const envio = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024, files: 1 },
  fileFilter: (_req, arquivo, cb) => {
    if (!TIPOS_ACEITOS.has(arquivo.mimetype)) {
      cb(pedidoInvalido("Apenas imagens JPEG ou PNG sao aceitas."));
      return;
    }
    cb(null, true);
  },
});

/** Confere os bytes iniciais do arquivo contra o tipo declarado. */
function assinaturaDeImagemConfere(buffer, tipo) {
  if (tipo === "image/jpeg")
    return buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;

  if (tipo === "image/png") {
    const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    return buffer.length > 8 && png.every((b, i) => buffer[i] === b);
  }

  return false;
}

/**
 * Resumo das evidencias de um lote.
 *
 * keccak256 sobre os SHA-256 das imagens, ordenados. A ordenacao faz o resumo
 * depender so do conjunto de imagens, e nao da ordem em que foram enviadas; o
 * keccak256 e o mesmo resumo que a EVM calcula nativamente, o que permite, se um
 * dia for preciso, conferir o valor dentro de um contrato.
 */
export function resumirEvidencias(hashesDasImagens) {
  const conteudo = ["AgroSmart:evidencias:v1", ...[...hashesDasImagens].sort()].join("\n");

  return ethers.keccak256(ethers.toUtf8Bytes(conteudo));
}

/** Confere se o usuario pode mexer no lote do talhao. */
async function carregarLote(banco, loteId, usuario) {
  const { rows } = await banco.query(
    `SELECT lt.*, p.produtor_id
       FROM lotes_de_imagens lt
       JOIN talhoes t ON t.id = lt.talhao_id
       JOIN propriedades p ON p.id = t.propriedade_id
      WHERE lt.id = $1`,
    [loteId],
  );

  const lote = rows[0];

  if (!lote) throw naoEncontrado("Lote");
  if (usuario.perfil === "produtor" && lote.produtor_id !== usuario.id) throw naoEncontrado("Lote");

  return lote;
}

export function rotasDeImagens() {
  const r = Router();

  // ------------------------------------------------------------- lotes

  r.post(
    "/talhoes/:id/lotes",
    exigirSessao,
    exigirPerfil("produtor", "seguradora"),
    async (req, res) => {
      const { banco } = req.app.locals;
      const talhaoId = uuid(req.params.id, "id");

      const { rows: talhoes } = await banco.query(
        `SELECT t.id, p.produtor_id FROM talhoes t JOIN propriedades p ON p.id = t.propriedade_id
          WHERE t.id = $1`,
        [talhaoId],
      );

      const talhao = talhoes[0];
      if (!talhao || (req.usuario.perfil === "produtor" && talhao.produtor_id !== req.usuario.id)) {
        throw naoEncontrado("Talhao");
      }

      const { rows } = await banco.query(
        "INSERT INTO lotes_de_imagens (talhao_id, enviado_por) VALUES ($1, $2) RETURNING id, criado_em",
        [talhaoId, req.usuario.id],
      );

      res.status(201).json({ lote: { id: rows[0].id, talhaoId, criadoEm: rows[0].criado_em } });
    },
  );

  r.get("/lotes", exigirSessao, async (req, res) => {
    const { banco } = req.app.locals;
    const talhaoId = uuid(req.query.talhaoId, "talhaoId");

    const { rows } = await banco.query(
      `SELECT lt.id, lt.hash_evidencias, lt.fechado_em, lt.criado_em,
              (SELECT count(*)::int FROM imagens i WHERE i.lote_id = lt.id) AS imagens,
              (SELECT json_build_object('indiceDanoBps', an.indice_dano_bps, 'confiancaBps', an.confianca_bps,
                                        'versaoModelo', an.versao_modelo,
                                        'encaminhadaAoPerito', an.encaminhada_ao_perito,
                                        'decisaoDoPerito', an.decisao_do_perito)
                 FROM analises_de_imagem an WHERE an.lote_id = lt.id
                ORDER BY an.criada_em DESC LIMIT 1) AS analise
         FROM lotes_de_imagens lt
         JOIN talhoes t ON t.id = lt.talhao_id
         JOIN propriedades p ON p.id = t.propriedade_id
        WHERE lt.talhao_id = $1 AND ($2 <> 'produtor' OR p.produtor_id = $3)
        ORDER BY lt.criado_em DESC`,
      [talhaoId, req.usuario.perfil, req.usuario.id],
    );

    res.json({ lotes: rows });
  });

  // ------------------------------------------------------------ imagens

  /**
   * Envio de imagem georreferenciada (RF14, HU11 criterio 1).
   *
   * Multipart com o arquivo em `imagem` e os campos `lon`, `lat` e `capturadaEm`.
   * A leitura automatica do EXIF fica para a Sprint 3, junto do modulo de visao;
   * por enquanto a coordenada vem do formulario.
   */
  r.post(
    "/lotes/:id/imagens",
    limitarIngestao,
    exigirSessao,
    exigirPerfil("produtor", "seguradora"),
    envio.single("imagem"),
    async (req, res) => {
      const { banco } = req.app.locals;
      const loteId = uuid(req.params.id, "id");
      const lote = await carregarLote(banco, loteId, req.usuario);

      if (lote.fechado_em)
        throw conflito("O lote ja foi fechado; abra um novo para enviar mais imagens.");
      if (!req.file) throw pedidoInvalido('Envie o arquivo no campo "imagem".');

      // O tipo declarado pelo cliente nao prova nada: qualquer arquivo pode chegar
      // rotulado como image/png. Os primeiros bytes, sim. Um lote de evidencias
      // com um arquivo que nao e imagem teria o hash registrado na cadeia como
      // prova de algo que nunca foi fotografado.
      if (!assinaturaDeImagemConfere(req.file.buffer, req.file.mimetype)) {
        throw pedidoInvalido("O conteudo do arquivo nao corresponde a uma imagem JPEG ou PNG.");
      }

      const lon = Number(req.body?.lon);
      const lat = Number(req.body?.lat);
      const capturadaEm = new Date(req.body?.capturadaEm);

      if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
        throw pedidoInvalido("Imagem sem geolocalizacao: informe lon e lat.");
      }
      if (Number.isNaN(capturadaEm.getTime()))
        throw pedidoInvalido("Informe a data de captura (capturadaEm).");
      if (capturadaEm > new Date(Date.now() + 5 * 60_000)) {
        throw pedidoInvalido("A data de captura esta no futuro.");
      }

      // RF14: o ponto precisa estar dentro do poligono do talhao. Quem decide e
      // o PostGIS, e nao uma conta em JavaScript.
      const { rows: dentro } = await banco.query(
        `SELECT ST_Contains(t.geometria, ST_SetSRID(ST_MakePoint($2, $3), 4326)) AS contem
           FROM talhoes t WHERE t.id = $1`,
        [lote.talhao_id, lon, lat],
      );

      if (!dentro[0]?.contem) {
        throw pedidoInvalido("A imagem foi capturada fora do poligono do talhao e foi recusada.");
      }

      const sha256 = sha256Hex(req.file.buffer);
      const pasta = join(config.dirImagens, loteId);
      const caminho = join(pasta, `${sha256}.${EXTENSOES[req.file.mimetype]}`);

      mkdirSync(pasta, { recursive: true });
      writeFileSync(caminho, req.file.buffer);

      const { rows } = await banco.query(
        `INSERT INTO imagens (lote_id, sha256, caminho, capturada_em, local, bytes, tipo)
         VALUES ($1, $2, $3, $4, ST_SetSRID(ST_MakePoint($5, $6), 4326), $7, $8)
         ON CONFLICT (lote_id, sha256) DO NOTHING
         RETURNING id`,
        [loteId, sha256, caminho, capturadaEm, lon, lat, req.file.size, req.file.mimetype],
      );

      if (rows.length === 0) throw conflito("Esta imagem ja foi enviada neste lote.");

      res.status(201).json({ imagem: { id: rows[0].id, sha256, bytes: req.file.size } });
    },
  );

  /** Fecha o lote e calcula o resumo das evidencias (RF16). */
  r.post(
    "/lotes/:id/fechar",
    exigirSessao,
    exigirPerfil("produtor", "seguradora"),
    async (req, res) => {
      const { banco } = req.app.locals;
      const loteId = uuid(req.params.id, "id");
      const lote = await carregarLote(banco, loteId, req.usuario);

      if (lote.fechado_em) throw conflito("O lote ja esta fechado.");

      const { rows } = await banco.query("SELECT sha256 FROM imagens WHERE lote_id = $1", [loteId]);
      if (rows.length === 0) throw pedidoInvalido("Um lote precisa de ao menos uma imagem.");

      const hashEvidencias = resumirEvidencias(rows.map((i) => i.sha256));

      await banco.query(
        "UPDATE lotes_de_imagens SET hash_evidencias = $2, fechado_em = now() WHERE id = $1",
        [loteId, hashEvidencias],
      );

      await auditar(banco, req, "lote_fechado", {
        recurso: loteId,
        detalhes: { hashEvidencias, imagens: rows.length },
      });

      res.json({ lote: { id: loteId, hashEvidencias, imagens: rows.length } });
    },
  );

  // ---------------------------------------------------- modulo de visao

  /**
   * Lotes fechados que ainda nao foram analisados (RF16).
   *
   * E por aqui que o modulo de visao descobre o que tem para fazer. So lote
   * FECHADO aparece: enquanto o produtor ainda pode enviar imagem, o resumo das
   * evidencias mudaria, e uma analise sobre um lote aberto seria analise de um
   * conjunto que nao existe mais.
   */
  r.get("/visao/pendentes", exigirServico, async (req, res) => {
    const { banco } = req.app.locals;

    const { rows } = await banco.query(
      `SELECT lt.id, lt.hash_evidencias, lt.fechado_em, t.identificador AS talhao, t.cultura,
              (SELECT json_agg(json_build_object(
                        'id', i.id, 'sha256', i.sha256, 'tipo', i.tipo, 'bytes', i.bytes,
                        'capturadaEm', i.capturada_em,
                        'lon', ST_X(i.local), 'lat', ST_Y(i.local))
                      ORDER BY i.capturada_em)
                 FROM imagens i WHERE i.lote_id = lt.id) AS imagens
         FROM lotes_de_imagens lt
         JOIN talhoes t ON t.id = lt.talhao_id
        WHERE lt.fechado_em IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM analises_de_imagem an WHERE an.lote_id = lt.id)
        ORDER BY lt.fechado_em
        LIMIT 50`,
    );

    res.json({ lotes: rows });
  });

  /**
   * Arquivo de uma imagem, para o modulo de visao baixar e analisar.
   *
   * O arquivo e servido pelo caminho gravado no banco, e o resumo conferido
   * antes de entregar: se o byte no disco nao produz mais o sha256 registrado,
   * a evidencia foi corrompida ou trocada, e analisar isso seria pior do que
   * falhar. O hash do lote ja foi para a cadeia.
   */
  r.get("/visao/imagens/:id/arquivo", exigirServico, async (req, res) => {
    const { banco } = req.app.locals;
    const id = uuid(req.params.id, "id");

    const { rows } = await banco.query("SELECT sha256, caminho, tipo FROM imagens WHERE id = $1", [
      id,
    ]);

    if (rows.length === 0) throw naoEncontrado("Imagem nao encontrada.");

    const imagem = rows[0];

    if (!existsSync(imagem.caminho)) throw naoEncontrado("Arquivo da imagem indisponivel.");

    const conteudo = readFileSync(imagem.caminho);

    if (sha256Hex(conteudo) !== imagem.sha256) {
      throw conflito("O arquivo em disco nao corresponde ao resumo registrado da evidencia.");
    }

    res.type(imagem.tipo).send(conteudo);
  });

  /**
   * Resultado do modulo de visao (RF15, RF16, RF17). Autenticado por chave de
   * servico, como o oraculo.
   *
   * `indiceDano` e `confianca` chegam como fracao de 0 a 1 — e o que um modelo
   * devolve naturalmente — e sao convertidos para pontos-base inteiros, o formato
   * da cadeia.
   */
  r.post("/visao/resultados", exigirServico, async (req, res) => {
    const { banco } = req.app.locals;
    const c = req.body ?? {};

    const loteId = uuid(c.loteId, "loteId");
    const versaoModelo = texto(c.versaoModelo, "versaoModelo", { max: 120 });

    const fracao = (v, campo) => {
      const n = Number(v);
      if (!Number.isFinite(n) || n < 0 || n > 1)
        throw pedidoInvalido(`"${campo}" deve estar entre 0 e 1.`);
      return Math.round(n * 10_000);
    };

    const indiceDanoBps = fracao(c.indiceDano, "indiceDano");
    const confiancaBps = fracao(c.confianca, "confianca");

    const { rows: lotes } = await banco.query(
      "SELECT hash_evidencias FROM lotes_de_imagens WHERE id = $1",
      [loteId],
    );

    if (!lotes[0]) throw naoEncontrado("Lote");
    if (!lotes[0].hash_evidencias)
      throw conflito("O lote ainda nao foi fechado; nao ha evidencia a analisar.");

    const encaminhada = confiancaBps < LIMIAR_CONFIANCA_BPS;

    const { rows } = await banco.query(
      `INSERT INTO analises_de_imagem (lote_id, indice_dano_bps, confianca_bps, versao_modelo,
                                       hash_versao_modelo, encaminhada_ao_perito)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [
        loteId,
        indiceDanoBps,
        confiancaBps,
        versaoModelo,
        ethers.keccak256(ethers.toUtf8Bytes(versaoModelo)),
        encaminhada,
      ],
    );

    if (encaminhada) {
      const { rows: peritos } = await banco.query(
        "SELECT id FROM usuarios WHERE perfil = 'perito'",
      );

      for (const { id } of peritos) {
        await banco.query(
          `INSERT INTO notificacoes (usuario_id, tipo, titulo, mensagem, tx_hash)
           VALUES ($1, 'revisao_pendente', 'Analise aguardando revisao', $2, $3)
           ON CONFLICT (usuario_id, tipo, tx_hash) DO NOTHING`,
          [
            id,
            `O modelo ${versaoModelo} devolveu confianca de ${confiancaBps / 100}%, abaixo do limiar. O indice de dano nao sera publicado sem revisao.`,
            `analise:${rows[0].id}`,
          ],
        );
      }
    }

    await auditar(banco, req, "analise_recebida", {
      recurso: loteId,
      detalhes: { indiceDanoBps, confiancaBps, versaoModelo, encaminhada },
    });

    res.status(201).json({
      analise: { id: rows[0].id, indiceDanoBps, confiancaBps, encaminhadaAoPerito: encaminhada },
    });
  });

  // -------------------------------------------------------------- perito

  r.get("/perito/analises", exigirSessao, exigirPerfil("perito"), async (req, res) => {
    const { rows } = await req.app.locals.banco.query(
      `SELECT an.id, an.indice_dano_bps, an.confianca_bps, an.versao_modelo, an.encaminhada_ao_perito,
              an.decisao_do_perito, an.parecer_do_perito, an.revisada_em, an.criada_em,
              lt.id AS lote_id, lt.hash_evidencias, t.identificador AS talhao,
              (SELECT count(*)::int FROM imagens i WHERE i.lote_id = lt.id) AS imagens
         FROM analises_de_imagem an
         JOIN lotes_de_imagens lt ON lt.id = an.lote_id
         JOIN talhoes t ON t.id = lt.talhao_id
        ORDER BY (an.encaminhada_ao_perito AND an.decisao_do_perito IS NULL) DESC, an.criada_em DESC`,
    );

    res.json({ analises: rows });
  });

  /** Parecer do perito sobre uma analise de baixa confianca (RF17). */
  r.post("/perito/analises/:id/parecer", exigirSessao, exigirPerfil("perito"), async (req, res) => {
    const { banco } = req.app.locals;
    const id = uuid(req.params.id, "id");
    const decisao = req.body?.decisao;
    const parecer = texto(req.body?.parecer, "parecer", { max: 2000 });

    if (!["liberada", "rejeitada"].includes(decisao)) {
      throw pedidoInvalido('A decisao deve ser "liberada" ou "rejeitada".');
    }

    const { rowCount } = await banco.query(
      `UPDATE analises_de_imagem
          SET decisao_do_perito = $2, parecer_do_perito = $3, revisada_por = $4, revisada_em = now()
        WHERE id = $1 AND encaminhada_ao_perito AND decisao_do_perito IS NULL`,
      [id, decisao, parecer, req.usuario.id],
    );

    if (rowCount === 0)
      throw conflito("Analise inexistente, ja revisada ou que nao exigia revisao.");

    await auditar(banco, req, "parecer_registrado", { recurso: id, detalhes: { decisao } });
    res.json({ id, decisao });
  });

  return r;
}
