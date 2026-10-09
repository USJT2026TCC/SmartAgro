-- Historico de chuva diaria das estacoes do INMET, para a cotacao (RF06).
--
-- Fonte: INMET, Banco de Dados Meteorologicos,
-- https://portal.inmet.gov.br/dadoshistoricos. Gerado pelo comando
-- `simulador historico` e carregado de src/banco/dados/ na inicializacao.

CREATE TABLE estacoes_inmet (
  codigo     text PRIMARY KEY,
  nome       text NOT NULL,
  posicao    geometry(Point, 4326) NOT NULL
);

CREATE INDEX estacoes_inmet_posicao_idx ON estacoes_inmet USING gist (posicao);

CREATE TABLE historico_chuva (
  estacao        text NOT NULL REFERENCES estacoes_inmet(codigo),
  data           date NOT NULL,
  chuva_mm       numeric(7, 1) NOT NULL CHECK (chuva_mm >= 0),
  horas_validas  smallint NOT NULL CHECK (horas_validas BETWEEN 0 AND 24),
  PRIMARY KEY (estacao, data)
);
