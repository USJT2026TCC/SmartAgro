-- Cancelamento antes da vigencia (RF10) e contestacao da avaliacao automatica
-- (RF28), as duas acrescentadas ao contrato da apolice em outubro de 2026.

-- ------------------------------------------------------------- cancelamento

-- O contrato ganhou a situacao CANCELADA (4).
ALTER TABLE apolices DROP CONSTRAINT apolices_situacao_check;
ALTER TABLE apolices ADD CONSTRAINT apolices_situacao_check CHECK (situacao BETWEEN 0 AND 4);

-- Data em que o produtor quer que a cobertura comece. Sem ela, a vigencia comeca
-- na emissao, e o cancelamento "antes da vigencia" nunca teria janela. Nula vale
-- o comportamento anterior.
ALTER TABLE propostas ADD COLUMN inicio_desejado date;

-- -------------------------------------------------------------- contestacao

-- O produtor contesta o indice de dano publicado em um periodo; o perito emite
-- parecer; se deferida, o oraculo submete o indice retificado ao contrato.
CREATE TABLE contestacoes (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  apolice_endereco       text NOT NULL REFERENCES apolices(endereco),
  periodo                integer NOT NULL,
  produtor_id            uuid NOT NULL REFERENCES usuarios(id),
  motivo                 text NOT NULL,

  -- Indice e evidencias da publicacao contestada, copiados no momento da
  -- contestacao: e sobre eles que o perito se pronuncia.
  indice_original_bps    integer NOT NULL CHECK (indice_original_bps BETWEEN 0 AND 10000),
  lote_id                uuid REFERENCES lotes_de_imagens(id),

  situacao               text NOT NULL DEFAULT 'aberta'
                         CHECK (situacao IN ('aberta', 'deferida', 'indeferida', 'publicada')),

  -- Parecer do perito. O resumo e calculado sobre o texto canonico do parecer e
  -- e o que vai para a cadeia; o texto fica aqui, para conferencia.
  perito_id              uuid REFERENCES usuarios(id),
  parecer                text,
  indice_retificado_bps  integer CHECK (indice_retificado_bps BETWEEN 0 AND 10000),
  texto_do_parecer       text,
  hash_parecer           text,
  decidida_em            timestamptz,

  -- Preenchidos quando o oraculo submete a retificacao.
  tx_retificacao         text UNIQUE,
  publicada_em           timestamptz,

  criada_em              timestamptz NOT NULL DEFAULT now(),

  -- Uma contestacao por periodo de cada apolice: o contrato aceita uma unica
  -- retificacao por periodo.
  UNIQUE (apolice_endereco, periodo)
);

CREATE INDEX contestacoes_situacao_idx ON contestacoes (situacao);
