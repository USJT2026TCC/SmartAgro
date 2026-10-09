-- Notificacao por e-mail (RF27, UC13; Nodemailer na secao 5.3 da documentacao).

-- E-mail de contato do usuario. Opcional: sem ele, a notificacao fica so no
-- aplicativo, como antes.
ALTER TABLE usuarios ADD COLUMN email text CHECK (email IS NULL OR email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$');

-- Quando o e-mail da notificacao saiu. Nulo e pendente: o despachante tenta de
-- novo no proximo ciclo, entao uma falha do servidor de e-mail nao perde aviso.
ALTER TABLE notificacoes ADD COLUMN email_enviado_em timestamptz;
ALTER TABLE notificacoes ADD COLUMN email_tentativas smallint NOT NULL DEFAULT 0;
