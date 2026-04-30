-- Migration 0052: Adicionar 'arquivada' ao CHECK constraint de metas.status
-- O CHECK constraint original só permitia: 'ativa', 'concluida', 'cancelada'
-- Metas arquivadas (via PUT status=arquivada) causavam Internal Server Error

-- SQLite não suporta ALTER COLUMN, então recriamos a tabela

PRAGMA foreign_keys = OFF;

-- 1. Criar tabela nova com constraint corrigida
CREATE TABLE metas_new (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id              INTEGER NOT NULL,
  nome                 TEXT NOT NULL,
  descricao            TEXT,
  valor_objetivo       REAL NOT NULL,
  valor_atual          REAL DEFAULT 0,
  data_meta            DATE NOT NULL,
  categoria            TEXT DEFAULT 'economia',
  cor                  TEXT DEFAULT '#2FBF71',
  icone                TEXT DEFAULT 'piggy-bank',
  status               TEXT DEFAULT 'ativa'
                       CHECK(status IN ('ativa', 'concluida', 'cancelada', 'arquivada')),
  data_criacao         DATETIME DEFAULT CURRENT_TIMESTAMP,
  linked_debt_type     TEXT
                       CHECK (linked_debt_type IN ('all','financiamento','emprestimo','especifico')),
  linked_debt_id       INTEGER,
  original_debt_amount REAL,
  prioridade           INTEGER DEFAULT 2 CHECK(prioridade IN (1,2,3)),
  milestones_disparados TEXT DEFAULT '',
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- 2. Copiar dados existentes
INSERT INTO metas_new SELECT * FROM metas;

-- 3. Remover tabela antiga
DROP TABLE metas;

-- 4. Renomear nova para metas
ALTER TABLE metas_new RENAME TO metas;

PRAGMA foreign_keys = ON;
