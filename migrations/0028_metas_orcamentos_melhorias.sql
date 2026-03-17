-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 0028: Melhorias em Metas e Orçamentos
-- S-M2: tabela meta_historico (histórico de aportes/saques)
-- S-M3: nada no DB (calculado em runtime)
-- S-M4: campo milestones_disparados em metas
-- S-M5: campo prioridade em metas
-- S-O3: campo alertas_enviados em orcamentos
-- S-O5: campo notas em orcamentos
-- ─────────────────────────────────────────────────────────────────────────────

-- S-M2: Tabela de histórico de aportes e saques de metas
CREATE TABLE IF NOT EXISTS meta_historico (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  meta_id      INTEGER NOT NULL REFERENCES metas(id) ON DELETE CASCADE,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tipo         TEXT NOT NULL CHECK(tipo IN ('aporte','saque','ajuste')),
  valor        REAL NOT NULL,
  descricao    TEXT,
  valor_antes  REAL NOT NULL,
  valor_depois REAL NOT NULL,
  data         DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_meta_historico_meta ON meta_historico(meta_id);
CREATE INDEX IF NOT EXISTS idx_meta_historico_user ON meta_historico(user_id, data);

-- S-M5: Campo prioridade nas metas (1=baixa, 2=media, 3=alta)
ALTER TABLE metas ADD COLUMN prioridade INTEGER DEFAULT 2 CHECK(prioridade IN (1,2,3));

-- S-M4: Campo para rastrear quais milestones (25/50/75/100%) já foram disparados
ALTER TABLE metas ADD COLUMN milestones_disparados TEXT DEFAULT '';

-- S-O5: Campo notas nos orçamentos
ALTER TABLE orcamentos ADD COLUMN notas TEXT;

-- S-O3: Campo para rastrear se o alerta deste orçamento foi disparado no mês
ALTER TABLE orcamentos ADD COLUMN alerta_disparado INTEGER DEFAULT 0;
