-- Migration 0009: Email verification OTP
-- Tabela para armazenar códigos OTP de verificação de e-mail

CREATE TABLE IF NOT EXISTS email_verifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  code TEXT NOT NULL,
  attempts INTEGER DEFAULT 0,
  expires_at DATETIME NOT NULL,
  verified_at DATETIME NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_ev_email ON email_verifications(email);
CREATE INDEX IF NOT EXISTS idx_ev_user ON email_verifications(user_id);

-- Adicionar coluna de e-mail verificado na tabela de usuários (se não existir)
-- SQLite não suporta IF NOT EXISTS em ALTER TABLE, então usamos INSERT OR IGNORE via aplicação
