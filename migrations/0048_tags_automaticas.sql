-- ═══════════════════════════════════════════════════════════════════════════
-- MIGRATION 0048: Tags Automáticas para módulos financeiros
-- ═══════════════════════════════════════════════════════════════════════════

-- Tabela de associação tag ↔ investimento
CREATE TABLE IF NOT EXISTS investimento_tags (
  investimento_id INTEGER NOT NULL REFERENCES investimentos(id) ON DELETE CASCADE,
  tag_id          INTEGER NOT NULL REFERENCES tags(id)          ON DELETE CASCADE,
  PRIMARY KEY (investimento_id, tag_id)
);
CREATE INDEX IF NOT EXISTS idx_investimento_tags_inv ON investimento_tags(investimento_id);
CREATE INDEX IF NOT EXISTS idx_investimento_tags_tag ON investimento_tags(tag_id);

-- Tabela de associação tag ↔ meta
CREATE TABLE IF NOT EXISTS meta_tags (
  meta_id INTEGER NOT NULL REFERENCES metas(id) ON DELETE CASCADE,
  tag_id  INTEGER NOT NULL REFERENCES tags(id)  ON DELETE CASCADE,
  PRIMARY KEY (meta_id, tag_id)
);
CREATE INDEX IF NOT EXISTS idx_meta_tags_meta ON meta_tags(meta_id);
CREATE INDEX IF NOT EXISTS idx_meta_tags_tag  ON meta_tags(tag_id);

-- Tabela de associação tag ↔ reserva especializada
CREATE TABLE IF NOT EXISTS reserva_tags (
  reserva_id INTEGER NOT NULL REFERENCES specialized_reserves(id) ON DELETE CASCADE,
  tag_id     INTEGER NOT NULL REFERENCES tags(id)                  ON DELETE CASCADE,
  PRIMARY KEY (reserva_id, tag_id)
);
CREATE INDEX IF NOT EXISTS idx_reserva_tags_reserva ON reserva_tags(reserva_id);
CREATE INDEX IF NOT EXISTS idx_reserva_tags_tag     ON reserva_tags(tag_id);

-- Tabela de configuração de tags automáticas por módulo
CREATE TABLE IF NOT EXISTS tags_auto_config (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  modulo      TEXT NOT NULL, -- 'emprestimo','financiamento','investimento','meta','reserva','recorrencia'
  ativo       INTEGER DEFAULT 1,  -- 1=ativo, 0=desativado pelo usuário
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, modulo)
);
CREATE INDEX IF NOT EXISTS idx_tags_auto_config_user ON tags_auto_config(user_id);
