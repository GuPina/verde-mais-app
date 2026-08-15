-- ═══════════════════════════════════════════════════════════════════════════
-- MIGRATION 0010: Tags, CDI History, Alertas Inteligentes, Comparativo
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── 1. Tags personalizadas ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tags (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  nome        TEXT NOT NULL,
  cor         TEXT DEFAULT '#10B981',
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, nome)
);

CREATE TABLE IF NOT EXISTS despesa_tags (
  despesa_id  INTEGER NOT NULL REFERENCES despesas(id) ON DELETE CASCADE,
  tag_id      INTEGER NOT NULL REFERENCES tags(id)     ON DELETE CASCADE,
  PRIMARY KEY (despesa_id, tag_id)
);

CREATE INDEX IF NOT EXISTS idx_tags_user      ON tags(user_id);
CREATE INDEX IF NOT EXISTS idx_despesa_tags   ON despesa_tags(despesa_id);
CREATE INDEX IF NOT EXISTS idx_tag_despesas   ON despesa_tags(tag_id);

-- ─── 2. Histórico CDI (BCB série 12) ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS cdi_historico (
  data        DATE PRIMARY KEY,
  taxa        REAL NOT NULL,   -- taxa diária em %
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ─── 3. Alertas inteligentes de cartão ────────────────────────────────────
CREATE TABLE IF NOT EXISTS alertas_cartao (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  cartao_id   INTEGER NOT NULL REFERENCES cartoes(id) ON DELETE CASCADE,
  tipo        TEXT NOT NULL CHECK (tipo IN ('limite_alto','fechamento_proximo','vencimento_proximo','fatura_alta')),
  titulo      TEXT NOT NULL,
  mensagem    TEXT NOT NULL,
  lido        INTEGER DEFAULT 0,
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_alertas_user   ON alertas_cartao(user_id, lido);
CREATE INDEX IF NOT EXISTS idx_alertas_cartao ON alertas_cartao(cartao_id);

-- ─── 4. Conquistas novas ──────────────────────────────────────────────────
INSERT OR IGNORE INTO conquistas_definicoes
  (codigo, titulo, descricao, icone, pontos, raridade) VALUES
  ('tagger',        'Organizador',    'Criou e usou tags em 5 despesas',          '🏷️',  25,  'COMUM'),
  ('comparador',    'Analítico',      'Consultou o comparativo mês a mês',        '📊',  20,  'COMUM'),
  ('exportador',    'Profissional',   'Exportou seu primeiro relatório financeiro','📄',  30,  'RARO'),
  ('sem_alertas',   'Cartão Limpo',   'Ficou 30 dias sem alertas de cartão',     '✅',  50,  'RARO');
