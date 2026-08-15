-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 0013 — Desafio 52 Semanas Configurável + Regra 50/30/20 Editável
-- ═══════════════════════════════════════════════════════════════════════════

-- ── MELHORIA 3.1: Configuração do Desafio 52 Semanas ─────────────────────
CREATE TABLE IF NOT EXISTS desafio_config (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id         INTEGER NOT NULL UNIQUE,
  year            INTEGER NOT NULL DEFAULT 2026,
  valor_base      REAL    NOT NULL DEFAULT 1.0,   -- valor da semana 1
  multiplicador   REAL    NOT NULL DEFAULT 1.0,   -- incremento por semana
  modo_invertido  INTEGER NOT NULL DEFAULT 0,     -- 0=crescente, 1=decrescente
  meta_vinculada  INTEGER,                        -- FK metas.id (opcional)
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (meta_vinculada) REFERENCES metas(id) ON DELETE SET NULL
);

-- Adicionar coluna de config personalizada ao weekly_challenges
ALTER TABLE weekly_challenges ADD COLUMN config_id INTEGER REFERENCES desafio_config(id);

-- ── MELHORIA 3.2: Configuração da Regra 50/30/20 ─────────────────────────
CREATE TABLE IF NOT EXISTS regra_config (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id           INTEGER NOT NULL UNIQUE,
  pct_necessidades  INTEGER NOT NULL DEFAULT 50,
  pct_desejos       INTEGER NOT NULL DEFAULT 30,
  pct_poupanca      INTEGER NOT NULL DEFAULT 20,
  -- Reclassificação de categorias (JSON serializado)
  categorias_necessidades TEXT DEFAULT NULL,  -- JSON array
  categorias_desejos      TEXT DEFAULT NULL,  -- JSON array
  categorias_poupanca     TEXT DEFAULT NULL,  -- JSON array
  created_at        DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- ── MELHORIA 3.3: Tags para Receitas ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS receita_tags (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  receita_id INTEGER NOT NULL,
  tag_id     INTEGER NOT NULL,
  UNIQUE(receita_id, tag_id),
  FOREIGN KEY (receita_id) REFERENCES receitas(id)  ON DELETE CASCADE,
  FOREIGN KEY (tag_id)     REFERENCES tags(id)       ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_receita_tags_receita ON receita_tags(receita_id);
CREATE INDEX IF NOT EXISTS idx_receita_tags_tag     ON receita_tags(tag_id);

