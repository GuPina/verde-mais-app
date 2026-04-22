-- Migration 0046: Melhorias no módulo Cartões
-- 1. tipo_cartao (PF/PJ)
-- 2. Limite por categoria no cartão
-- 3. Contestações de lançamentos
-- 4. Splits de compra entre cartões

-- 1. Adicionar tipo_cartao na tabela cartoes
ALTER TABLE cartoes ADD COLUMN tipo_cartao TEXT NOT NULL DEFAULT 'PF' CHECK(tipo_cartao IN ('PF','PJ'));

-- 2. Limite por categoria por cartão
CREATE TABLE IF NOT EXISTS card_category_limits (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  card_id     INTEGER NOT NULL REFERENCES cartoes(id) ON DELETE CASCADE,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  categoria   TEXT NOT NULL,
  limite_mensal REAL NOT NULL CHECK(limite_mensal > 0),
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(card_id, categoria)
);
CREATE INDEX IF NOT EXISTS idx_ccl_card ON card_category_limits(card_id);
CREATE INDEX IF NOT EXISTS idx_ccl_user ON card_category_limits(user_id);

-- 3. Contestações de lançamentos
CREATE TABLE IF NOT EXISTS card_contestacoes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  charge_id   INTEGER NOT NULL REFERENCES card_charges(id) ON DELETE CASCADE,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  motivo      TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'aberta' CHECK(status IN ('aberta','em_analise','resolvida','recusada')),
  observacao  TEXT,
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_contest_charge ON card_contestacoes(charge_id);
CREATE INDEX IF NOT EXISTS idx_contest_user   ON card_contestacoes(user_id);
