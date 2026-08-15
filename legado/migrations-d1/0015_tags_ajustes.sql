-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 0015 — Tags Ampliado + Ajustes nas tabelas existentes
-- ═══════════════════════════════════════════════════════════════════════════

-- ── MELHORIA 3.3: Adicionar campo nome_personalizado na regra_config ──────
ALTER TABLE regra_config ADD COLUMN nome_personalizado TEXT DEFAULT 'Regra 50/30/20';

-- ── MELHORIA 3.3: Adicionar índice na tabela de receita_tags (se não existir) ──
CREATE INDEX IF NOT EXISTS idx_receita_tags_receita ON receita_tags(receita_id);
CREATE INDEX IF NOT EXISTS idx_receita_tags_tag     ON receita_tags(tag_id);

-- ── Adicionar campo tipo à tabela despesas (se não existir — já adicionado em 0012) ──
-- ALTER TABLE despesas ADD COLUMN tipo TEXT DEFAULT 'normal';
-- (já deve existir se 0012 foi aplicado)

-- ── Tabela de histórico de conversas do assistente IA (se não existir) ────
-- (já criada em 0012_cleanup_orphans.sql)
-- CREATE TABLE IF NOT EXISTS assistente_conversas (...)

-- ── Garantir que tabelas de desafio_config têm estrutura correta ──────────
-- Verificar se coluna year existe (pode não ter sido criada na 0013)
-- Adicionado via migration 0013, confirmação via índice
CREATE INDEX IF NOT EXISTS idx_desafio_config_user ON desafio_config(user_id);
CREATE INDEX IF NOT EXISTS idx_regra_config_user ON regra_config(user_id);

-- ── Novas conquistas da Fase 3B/3C ───────────────────────────────────────
-- (já inseridas em migration 0014_novas_conquistas.sql)

-- ── Garantir que assistente_conversas existe ─────────────────────────────
CREATE TABLE IF NOT EXISTS assistente_conversas (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id         INTEGER NOT NULL,
  mensagem_usuario TEXT    NOT NULL,
  resposta_ia      TEXT    NOT NULL,
  intencao         TEXT    DEFAULT 'desconhecido',
  created_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_assistente_conversas_user ON assistente_conversas(user_id);
