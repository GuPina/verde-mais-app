-- Migration 0056 — Rate limiting de autenticação
--
-- O POST /api/auth/login não tinha nenhuma proteção contra força bruta: sem
-- throttle, sem bloqueio e sem captcha. O PBKDF2 de 100k iterações encarece
-- cada tentativa, mas não substitui um limite.
--
-- Registra cada tentativa por chave (e-mail e IP são contados separadamente)
-- para permitir uma janela deslizante.

CREATE TABLE IF NOT EXISTS tentativas_login (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  chave      TEXT NOT NULL,            -- 'email:foo@bar.com' ou 'ip:1.2.3.4'
  sucesso    INTEGER NOT NULL DEFAULT 0,
  criado_em  DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Consulta quente: falhas de uma chave dentro da janela.
CREATE INDEX IF NOT EXISTS idx_tentativas_chave_data
  ON tentativas_login(chave, criado_em);
