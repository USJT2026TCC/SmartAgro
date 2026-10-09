-- Coordenada de cada leitura (HU04, criterio 4: "cada leitura carrega data,
-- hora, identificador da fonte e coordenada").
--
-- Opcional, para nao recusar fontes que ainda nao a enviam. Quando vem, e
-- conferida contra a posicao cadastrada da fonte: uma estacao que diz estar a
-- quilometros de onde foi instalada, ou um lote assinado por uma fonte com os
-- dados de outra, vira leitura invalida e puxa a reputacao para baixo (RF12).
ALTER TABLE leituras ADD COLUMN localizacao geometry(Point, 4326);
