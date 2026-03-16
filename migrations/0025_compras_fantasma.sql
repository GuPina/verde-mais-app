-- Migration 0025: Módulo Compras Fantasma
-- Tabela de histórico de análises de compras impulsivas

CREATE TABLE IF NOT EXISTS analise_compras_fantasma (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mes INTEGER NOT NULL,
  ano INTEGER NOT NULL,
  total_analisado REAL DEFAULT 0,
  total_impulsivo REAL DEFAULT 0,
  percentual_impulsivo REAL DEFAULT 0,
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(user_id, mes, ano)
);

CREATE INDEX IF NOT EXISTS idx_compras_fantasma_user ON analise_compras_fantasma(user_id, ano, mes);
