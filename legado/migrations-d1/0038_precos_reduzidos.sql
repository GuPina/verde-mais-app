-- Migration 0038: Suporte a Preços Reduzidos em detected_subscriptions
-- Adiciona valor_antigo, reduced_at e recorrencia_id para rastrear reduções de plano

ALTER TABLE detected_subscriptions ADD COLUMN valor_antigo REAL;
ALTER TABLE detected_subscriptions ADD COLUMN reduced_at TEXT;
ALTER TABLE detected_subscriptions ADD COLUMN recorrencia_id INTEGER REFERENCES recorrencias(id) ON DELETE SET NULL;
ALTER TABLE detected_subscriptions ADD COLUMN economia_acumulada_reducao REAL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_detected_subs_reduced ON detected_subscriptions(user_id, user_feedback)
  WHERE user_feedback = 'reduced_plan';
