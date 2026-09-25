-- De onde veio a coordenada de cada imagem (RF14, RNF20).
--
-- O servidor ja confere se o ponto cai dentro do talhao. O que ele nao sabia era
-- QUANTO confiar no ponto:
--
--   exif         gravado pelo celular ou pelo drone no proprio arquivo, na hora
--                da foto. E o caso normal.
--   dispositivo  a localizacao do aparelho no momento do envio. Vale se a pessoa
--                estiver no talhao; nao prova onde a foto foi tirada.
--   manual       digitada ou marcada no mapa. E a mais facil de forjar.
--
-- Nenhuma das tres e recusada — uma foto sem GPS continua sendo evidencia —, mas
-- o perito precisa saber quais pontos foram informados a mao. Imagens enviadas
-- antes desta coluna existir ficam como 'manual': o formulario da epoca so
-- aceitava coordenada digitada.

ALTER TABLE imagens
  ADD COLUMN origem_da_localizacao text NOT NULL DEFAULT 'manual'
  CHECK (origem_da_localizacao IN ('exif', 'dispositivo', 'manual'));
