-- Migration 0036: tabela de histórico de score de saúde financeira
CREATE TABLE IF NOT EXISTS score_historico (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  mes TEXT NOT NULL,       -- formato YYYY-MM
  score_geral INTEGER NOT NULL,
  score_fluxo INTEGER,
  score_reserva INTEGER,
  score_dividas INTEGER,
  score_investimentos INTEGER,
  score_metas INTEGER,
  criado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, mes)
);
CREATE INDEX IF NOT EXISTS idx_score_historico_user ON score_historico(user_id, mes DESC);

-- tabela de snapshots mensais de patrimônio
CREATE TABLE IF NOT EXISTS patrimonio_historico (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  mes TEXT NOT NULL,       -- formato YYYY-MM
  total_investimentos REAL DEFAULT 0,
  total_reservas REAL DEFAULT 0,
  total_dividas REAL DEFAULT 0,
  patrimonio_liquido REAL DEFAULT 0,
  criado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, mes)
);
CREATE INDEX IF NOT EXISTS idx_patrimonio_historico_user ON patrimonio_historico(user_id, mes DESC);
