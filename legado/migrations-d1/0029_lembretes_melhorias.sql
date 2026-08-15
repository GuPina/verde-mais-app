-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 0029: Melhorias nos Lembretes e Recorrências
-- Bug L-B1: expandir tipos de lembretes (remover CHECK constraint restritivo)
-- S-L2: campo tags em lembretes
-- S-L3: campo notas em lembretes
-- S-R1: campo notas e tags em recorrencias
-- ─────────────────────────────────────────────────────────────────────────────

-- Bug L-B1: Recriar lembretes sem CHECK constraint restritivo no tipo
-- (SQLite não suporta ALTER COLUMN, recriamos a tabela)
CREATE TABLE IF NOT EXISTS lembretes_new (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id              INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  titulo               TEXT NOT NULL,
  descricao            TEXT,
  tipo                 TEXT DEFAULT 'conta',
  valor_estimado       REAL DEFAULT 0,
  dia_vencimento       INTEGER,
  frequencia           TEXT DEFAULT 'mensal',
  ativo                INTEGER DEFAULT 1,
  ultimo_recebimento   DATE,
  proximo_vencimento   DATE,
  status_mes           TEXT DEFAULT 'aguardando',
  alertar_dias_antes   INTEGER DEFAULT 3,
  data_criacao         DATETIME DEFAULT CURRENT_TIMESTAMP,
  notas                TEXT,
  tags                 TEXT
);

INSERT OR IGNORE INTO lembretes_new
  SELECT id, user_id, titulo, descricao, tipo, valor_estimado, dia_vencimento,
         frequencia, ativo, ultimo_recebimento, proximo_vencimento, status_mes,
         alertar_dias_antes, data_criacao, NULL, NULL
  FROM lembretes;

DROP TABLE lembretes;
ALTER TABLE lembretes_new RENAME TO lembretes;

-- Recriar índice
CREATE INDEX IF NOT EXISTS idx_lembretes_user ON lembretes(user_id, ativo);

-- S-R1: campos notas e tags em recorrencias
ALTER TABLE recorrencias ADD COLUMN notas TEXT;
ALTER TABLE recorrencias ADD COLUMN tags TEXT;
