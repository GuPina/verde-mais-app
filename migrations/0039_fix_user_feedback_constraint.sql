-- Migration 0039: Corrige CHECK constraint de user_feedback em detected_subscriptions
-- Adiciona 'reduced_plan' como valor válido para registrar reduções de preço

-- SQLite não suporta ALTER COLUMN para mudar CHECK constraints
-- Precisamos recriar a tabela com o novo constraint

PRAGMA foreign_keys = OFF;

-- 1. Criar tabela temporária com novo constraint
CREATE TABLE detected_subscriptions_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  normalized_description TEXT NOT NULL,
  original_description TEXT NOT NULL,
  amount REAL NOT NULL,
  frequency INTEGER NOT NULL,
  first_occurrence TEXT NOT NULL,
  last_occurrence TEXT NOT NULL,
  average_interval_days REAL,
  confidence REAL NOT NULL,
  service_type TEXT DEFAULT 'unknown',
  yearly_cost REAL NOT NULL,
  status TEXT DEFAULT 'detected' CHECK(status IN ('detected','confirmed','cancelled','ignored')),
  user_feedback TEXT CHECK(user_feedback IN ('use_regularly','want_cancel','ignore','reduced_plan')),
  detected_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  service_nome TEXT DEFAULT '',
  frequency_label TEXT DEFAULT 'mensal',
  ai_enhanced BOOLEAN DEFAULT 0,
  ai_analysis TEXT,
  valor_antigo REAL,
  reduced_at TEXT,
  recorrencia_id INTEGER REFERENCES recorrencias(id) ON DELETE SET NULL,
  economia_acumulada_reducao REAL DEFAULT 0
);

-- 2. Copiar todos os dados
INSERT INTO detected_subscriptions_new
SELECT
  id, user_id, normalized_description, original_description, amount, frequency,
  first_occurrence, last_occurrence, average_interval_days, confidence, service_type,
  yearly_cost, status, user_feedback, detected_at, updated_at, service_nome,
  frequency_label, ai_enhanced, ai_analysis, valor_antigo, reduced_at,
  recorrencia_id, economia_acumulada_reducao
FROM detected_subscriptions;

-- 3. Remover tabela antiga
DROP TABLE detected_subscriptions;

-- 4. Renomear nova tabela
ALTER TABLE detected_subscriptions_new RENAME TO detected_subscriptions;

-- 5. Recriar índices
CREATE INDEX IF NOT EXISTS idx_detected_subs_user ON detected_subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_detected_subs_status ON detected_subscriptions(user_id, status);
CREATE INDEX IF NOT EXISTS idx_detected_subs_reduced ON detected_subscriptions(user_id, user_feedback)
  WHERE user_feedback = 'reduced_plan';

PRAGMA foreign_keys = ON;
