-- ============================================================================
-- AgroSmart — esquema inicial
--
-- Materializa o diagrama de classes da documentacao de software (Figura 7):
-- produtor -> propriedades -> talhoes -> apolices, leituras e lotes de imagens.
--
-- Convencoes:
--  * valores monetarios em wei, como numeric(78,0). Um uint256 tem ate 78
--    digitos decimais, entao nenhum valor do contrato deixa de caber, e nenhuma
--    conta passa por ponto flutuante;
--  * enderecos de carteira e de contrato sempre em minusculas, para que a
--    comparacao e a unicidade nao dependam da capitalizacao do checksum;
--  * geometrias em SRID 4326 (WGS 84), o mesmo das coordenadas de GPS.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS postgis;

-- ---------------------------------------------------------------- usuarios

CREATE TABLE usuarios (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  identificador         text NOT NULL UNIQUE,
  nome                  text NOT NULL,
  perfil                text NOT NULL CHECK (perfil IN ('produtor', 'seguradora', 'perito')),
  documento             text,

  -- RNF24: hash com sal. O bcrypt embute o sal e o custo no proprio texto.
  hash_senha            text NOT NULL,

  -- RF01: segundo fator por TOTP. O segredo e guardado cifrado (AES-256-GCM);
  -- um vazamento do banco nao entrega o segundo fator de ninguem.
  totp_segredo_cifrado  text,
  totp_ativo            boolean NOT NULL DEFAULT false,

  -- RF02: carteira vinculada por assinatura. Unica: um endereco ja vinculado a
  -- um produtor e recusado para outro (HU07, criterio 4).
  carteira              text UNIQUE CHECK (carteira = lower(carteira)),
  carteira_vinculada_em timestamptz,

  criado_em             timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sessoes (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id              uuid NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,

  -- Guarda-se o resumo do token, nunca o token. Quem ler o banco nao consegue
  -- se passar por nenhum usuario com sessao aberta.
  hash_token              text NOT NULL UNIQUE,

  -- Sessao aberta com senha correta mas segundo fator ainda nao conferido. So
  -- serve para uma coisa: chamar a verificacao do codigo TOTP.
  segundo_fator_pendente  boolean NOT NULL DEFAULT false,

  criada_em               timestamptz NOT NULL DEFAULT now(),
  expira_em               timestamptz NOT NULL,
  revogada_em             timestamptz,
  ip                      text,
  agente                  text
);

CREATE INDEX sessoes_usuario_idx ON sessoes (usuario_id);

-- Desafio de uso unico para vincular a carteira (RF02). O numero unico dentro da
-- mensagem impede que uma assinatura capturada seja reapresentada.
CREATE TABLE desafios_carteira (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id  uuid NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  mensagem    text NOT NULL,
  criado_em   timestamptz NOT NULL DEFAULT now(),
  expira_em   timestamptz NOT NULL,
  usado_em    timestamptz
);

-- --------------------------------------------------- propriedades e talhoes

CREATE TABLE propriedades (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  produtor_id uuid NOT NULL REFERENCES usuarios(id),
  nome        text NOT NULL,
  municipio   text NOT NULL,
  criado_em   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE talhoes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  propriedade_id  uuid NOT NULL REFERENCES propriedades(id),

  -- Vai para a cadeia como bytes32, que comporta 31 caracteres.
  identificador   text NOT NULL UNIQUE CHECK (char_length(identificador) BETWEEN 1 AND 31),
  cultura         text NOT NULL,

  -- RF03 e HU09: poligono georreferenciado. ST_IsValid recusa autointersecao
  -- (criterio de aceite 3) no proprio banco, e nao so no formulario.
  geometria       geometry(Polygon, 4326) NOT NULL CHECK (ST_IsValid(geometria)),

  -- Area calculada sobre o elipsoide, e nao informada: o limite da apolice sai
  -- desta conta, e uma area digitada a mao diverge do que foi delimitado.
  area_ha         numeric(14, 4) NOT NULL,

  criado_em       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX talhoes_geometria_idx ON talhoes USING gist (geometria);

-- --------------------------------------------------------------- produtos

-- RF05: produto indexado. As restricoes CHECK repetem as validacoes do
-- construtor de ApolicePolicy. Um produto que o contrato recusaria nao chega a
-- ser gravado — melhor descobrir no cadastro do que gastar gas na emissao.
CREATE TABLE produtos (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome                       text NOT NULL,
  cultura                    text NOT NULL,
  operador                   smallint NOT NULL CHECK (operador BETWEEN 0 AND 3),
  modo_pagamento             smallint NOT NULL CHECK (modo_pagamento IN (0, 1)),
  limiar_climatico           integer NOT NULL DEFAULT 0 CHECK (limiar_climatico >= 0),
  limiar_climatico_integral  integer NOT NULL DEFAULT 0 CHECK (limiar_climatico_integral >= 0),
  limiar_dano_bps            integer NOT NULL DEFAULT 0 CHECK (limiar_dano_bps BETWEEN 0 AND 10000),
  limiar_dano_integral_bps   integer NOT NULL DEFAULT 0 CHECK (limiar_dano_integral_bps BETWEEN 0 AND 10000),
  valor_por_hectare_wei      numeric(78, 0) NOT NULL CHECK (valor_por_hectare_wei > 0),
  taxa_premio_bps            integer NOT NULL CHECK (taxa_premio_bps BETWEEN 1 AND 10000),
  vigencia_dias              integer NOT NULL CHECK (vigencia_dias > 0),
  ativo                      boolean NOT NULL DEFAULT true,
  criado_em                  timestamptz NOT NULL DEFAULT now(),

  -- Operador 1 (DANO) ignora o clima; qualquer outro precisa de gatilho climatico.
  CONSTRAINT produto_limiar_climatico CHECK (operador = 1 OR limiar_climatico > 0),
  -- Operador 0 (CLIMATICO) ignora o dano; qualquer outro precisa de gatilho de dano.
  CONSTRAINT produto_limiar_dano CHECK (operador = 0 OR limiar_dano_bps > 0),
  -- No escalonado, o teto precisa ficar acima do gatilho, senao a interpolacao
  -- do contrato dividiria por zero.
  CONSTRAINT produto_teto_climatico CHECK (
    modo_pagamento = 0 OR operador = 1 OR limiar_climatico_integral > limiar_climatico
  ),
  CONSTRAINT produto_teto_dano CHECK (
    modo_pagamento = 0 OR operador = 0 OR limiar_dano_integral_bps > limiar_dano_bps
  )
);

-- -------------------------------------------------------------- propostas

CREATE TABLE propostas (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  produtor_id            uuid NOT NULL REFERENCES usuarios(id),
  talhao_id              uuid NOT NULL REFERENCES talhoes(id),
  produto_id             uuid NOT NULL REFERENCES produtos(id),
  area_segurada_ha       numeric(14, 4) NOT NULL CHECK (area_segurada_ha > 0),
  carteira_produtor      text NOT NULL CHECK (carteira_produtor = lower(carteira_produtor)),
  valor_indenizacao_wei  numeric(78, 0) NOT NULL CHECK (valor_indenizacao_wei > 0),
  premio_wei             numeric(78, 0) NOT NULL CHECK (premio_wei >= 0),

  -- Copia dos termos do produto no momento da proposta. O produto pode mudar
  -- depois; o que o produtor aceitou, nao.
  termos                 jsonb NOT NULL,

  situacao               text NOT NULL DEFAULT 'pendente'
                         CHECK (situacao IN ('pendente', 'preparada', 'emitida', 'recusada')),

  -- Preenchidos quando a seguradora prepara a emissao (RF08). A descricao e o
  -- texto sobre o qual o resumo e calculado; guarda-la e o que permite, depois,
  -- conferir que o hash gravado no contrato corresponde ao que foi acordado.
  descricao_dos_termos   text,
  hash_termos            text,
  vigencia_inicio        timestamptz,
  vigencia_fim           timestamptz,

  criada_em              timestamptz NOT NULL DEFAULT now(),
  atualizada_em          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX propostas_produtor_idx ON propostas (produtor_id);
CREATE INDEX propostas_situacao_idx ON propostas (situacao);

-- --------------------------------------------------------------- apolices

-- Espelho das apolices implantadas na cadeia. A fonte da verdade continua sendo
-- o contrato; esta tabela existe para consulta rapida e para ligar a apolice ao
-- cadastro (talhao, proposta) que nao vive na cadeia.
CREATE TABLE apolices (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  endereco               text NOT NULL UNIQUE CHECK (endereco = lower(endereco)),

  -- Nulo quando a apolice foi emitida fora do aplicativo (por script, por
  -- exemplo) e descoberta pelo indexador.
  proposta_id            uuid UNIQUE REFERENCES propostas(id),
  talhao_id              uuid REFERENCES talhoes(id),

  produtor_carteira      text NOT NULL,
  seguradora_carteira    text NOT NULL,
  talhao_bytes32         text NOT NULL,
  hash_termos            text NOT NULL,
  valor_indenizacao_wei  numeric(78, 0) NOT NULL,
  tx_emissao             text NOT NULL,
  bloco_emissao          bigint NOT NULL,

  -- Atualizados pelo indexador a partir dos eventos.
  situacao               smallint NOT NULL DEFAULT 0 CHECK (situacao BETWEEN 0 AND 3),
  valor_pago_wei         numeric(78, 0) NOT NULL DEFAULT 0,
  periodo_acionador      integer,

  emitida_em             timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX apolices_produtor_idx ON apolices (produtor_carteira);

-- --------------------------------------------------------- eventos da cadeia

-- Tudo o que o indexador le da rede. A unicidade por (transacao, indice do log)
-- torna a indexacao idempotente: reprocessar um trecho de blocos nao duplica.
CREATE TABLE eventos_cadeia (
  id          bigserial PRIMARY KEY,
  contrato    text NOT NULL,
  nome        text NOT NULL,
  bloco       bigint NOT NULL,
  indice_log  integer NOT NULL,
  tx_hash     text NOT NULL,
  argumentos  jsonb NOT NULL,
  instante    timestamptz,
  UNIQUE (tx_hash, indice_log)
);

CREATE INDEX eventos_contrato_idx ON eventos_cadeia (contrato, bloco);

CREATE TABLE estado_indexador (
  chave         text PRIMARY KEY,
  ultimo_bloco  bigint NOT NULL
);

-- ------------------------------------------------------- fontes e leituras

-- Estacoes e sensores de cada talhao (RF11). Cada fonte tem um par de chaves:
-- os lotes de leitura chegam assinados, e so sao aceitos se a assinatura
-- corresponder ao endereco registrado aqui (RNF19: leitura autenticada na origem).
CREATE TABLE fontes (
  id                 text PRIMARY KEY,
  talhao_id          uuid NOT NULL REFERENCES talhoes(id),
  tipo               text NOT NULL CHECK (tipo IN ('estacao', 'sensor_solo')),
  endereco           text NOT NULL UNIQUE CHECK (endereco = lower(endereco)),
  localizacao        geometry(Point, 4326),
  ativa              boolean NOT NULL DEFAULT true,

  -- RF13: reputacao por media movel exponencial, atualizada a cada lote.
  escore             numeric(8, 6) NOT NULL DEFAULT 1 CHECK (escore BETWEEN 0 AND 1),
  observacoes        integer NOT NULL DEFAULT 0,
  ultima_leitura_em  timestamptz,

  criada_em          timestamptz NOT NULL DEFAULT now()
);

-- Um lote e o que chega em uma requisicao de ingestao. O identificador vem do
-- cliente e e unico: reenviar o mesmo lote e recusado (antirrepeticao).
CREATE TABLE lotes_de_leitura (
  id           uuid PRIMARY KEY,
  fonte_id     text NOT NULL REFERENCES fontes(id),
  hash_corpo   text NOT NULL,
  assinatura   text NOT NULL,
  enviado_em   timestamptz NOT NULL,
  recebido_em  timestamptz NOT NULL DEFAULT now(),
  aceitas      integer NOT NULL DEFAULT 0,
  recusadas    integer NOT NULL DEFAULT 0
);

CREATE TABLE leituras (
  id               bigserial PRIMARY KEY,
  fonte_id         text NOT NULL REFERENCES fontes(id),
  lote_id          uuid NOT NULL REFERENCES lotes_de_leitura(id),
  instante         timestamptz NOT NULL,
  chuva_mm         numeric(7, 2),
  temperatura_c    numeric(6, 2),
  umidade_pct      numeric(6, 2),

  -- RF12: a leitura implausivel e guardada com o motivo, e nao descartada em
  -- silencio. Apagar a evidencia de que um sensor falhou seria apagar o que
  -- justifica a queda da reputacao dele.
  valida           boolean NOT NULL,
  motivo_descarte  text,

  UNIQUE (fonte_id, instante)
);

CREATE INDEX leituras_fonte_instante_idx ON leituras (fonte_id, instante);

-- --------------------------------------------------- imagens e visao

CREATE TABLE lotes_de_imagens (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  talhao_id        uuid NOT NULL REFERENCES talhoes(id),
  enviado_por      uuid REFERENCES usuarios(id),

  -- RF16: resumo criptografico do lote, calculado ao fechar. E o valor que vai
  -- para a cadeia como `hashEvidencias`.
  hash_evidencias  text,
  fechado_em       timestamptz,

  criado_em        timestamptz NOT NULL DEFAULT now()
);

-- RF14: imagem georreferenciada. Imagem fora do poligono do talhao e recusada
-- antes de chegar aqui; o ponto fica guardado para conferencia posterior.
CREATE TABLE imagens (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lote_id       uuid NOT NULL REFERENCES lotes_de_imagens(id),
  sha256        text NOT NULL,
  caminho       text NOT NULL,
  capturada_em  timestamptz NOT NULL,
  local         geometry(Point, 4326) NOT NULL,
  bytes         integer NOT NULL,
  tipo          text NOT NULL,
  criado_em     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (lote_id, sha256)
);

-- Resultado do modulo de visao computacional para um lote.
CREATE TABLE analises_de_imagem (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lote_id                uuid NOT NULL REFERENCES lotes_de_imagens(id),
  indice_dano_bps        integer NOT NULL CHECK (indice_dano_bps BETWEEN 0 AND 10000),
  confianca_bps          integer NOT NULL CHECK (confianca_bps BETWEEN 0 AND 10000),

  -- RNF21: versao do modelo preservada durante todo o prazo de contestacao.
  versao_modelo          text NOT NULL,
  hash_versao_modelo     text NOT NULL,

  -- RF17: abaixo do limiar de confianca, vai para o perito e nao e publicado.
  encaminhada_ao_perito  boolean NOT NULL,

  -- Decisao do perito sobre uma analise encaminhada. So 'liberada' deixa o
  -- indice de dano seguir para o oraculo; 'rejeitada' o retem de vez.
  decisao_do_perito      text CHECK (decisao_do_perito IN ('liberada', 'rejeitada')),
  parecer_do_perito      text,
  revisada_por           uuid REFERENCES usuarios(id),
  revisada_em            timestamptz,

  criada_em              timestamptz NOT NULL DEFAULT now()
);

-- --------------------------------------------------- publicacoes do oraculo

-- RF22: identificador da transacao, gas e instante de confirmacao de cada
-- publicacao, mais a procedencia do indice — o que a cadeia nao guarda.
CREATE TABLE publicacoes_oraculo (
  id                 bigserial PRIMARY KEY,
  apolice_endereco   text NOT NULL,
  periodo            integer NOT NULL,
  tx_hash            text NOT NULL UNIQUE,
  indice_climatico   integer NOT NULL,
  indice_dano_bps    integer NOT NULL DEFAULT 0,
  confianca_bps      integer NOT NULL DEFAULT 0,
  gas_usado          numeric(78, 0),
  gas_estimado       numeric(78, 0),
  custo_wei          numeric(78, 0),
  bloco              bigint,
  enviado_em         timestamptz,
  confirmado_em      timestamptz,
  latencia_ms        integer,
  acionou_pagamento  boolean NOT NULL DEFAULT false,
  procedencia        jsonb,
  oraculo            text,

  -- Verdadeiro depois que o indexador confirma o evento na cadeia. O relato do
  -- oraculo sozinho nao basta: quem prova que a publicacao aconteceu e a rede.
  confirmada_na_cadeia  boolean NOT NULL DEFAULT false,

  registrada_em      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (apolice_endereco, periodo)
);

-- ------------------------------------------------------------- notificacoes

-- RF27: produzidas pelo indexador a partir dos eventos. A unicidade impede que
-- reprocessar um trecho de blocos notifique duas vezes o mesmo pagamento.
CREATE TABLE notificacoes (
  id                bigserial PRIMARY KEY,
  usuario_id        uuid NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  tipo              text NOT NULL,
  titulo            text NOT NULL,
  mensagem          text NOT NULL,
  apolice_endereco  text,
  tx_hash           text,
  lida_em           timestamptz,
  criada_em         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (usuario_id, tipo, tx_hash)
);

CREATE INDEX notificacoes_usuario_idx ON notificacoes (usuario_id, lida_em);

-- ---------------------------------------------------------------- auditoria

-- RNF25: log de auditoria correlacionado aos identificadores de transacao.
-- Apenas insercao: nenhuma rota da API altera ou apaga uma linha daqui.
CREATE TABLE auditoria (
  id          bigserial PRIMARY KEY,
  instante    timestamptz NOT NULL DEFAULT now(),
  usuario_id  uuid,
  perfil      text,
  acao        text NOT NULL,
  recurso     text,
  tx_hash     text,
  ip          text,
  detalhes    jsonb
);

CREATE INDEX auditoria_instante_idx ON auditoria (instante);
CREATE INDEX auditoria_tx_idx ON auditoria (tx_hash);
