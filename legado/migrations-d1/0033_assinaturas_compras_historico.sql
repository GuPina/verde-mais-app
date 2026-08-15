-- Migration 0033: Histórico de assinaturas canceladas e compras recorrentes reduzidas
-- Com cálculo de economia mensal e anual

-- ============================================================
-- 1. HISTÓRICO DE ASSINATURAS CANCELADAS
-- Registra cada assinatura cancelada pelo usuário com
-- o valor economizado ao longo do tempo
-- ============================================================
CREATE TABLE IF NOT EXISTS assinaturas_canceladas_historico (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subscription_id INTEGER REFERENCES detected_subscriptions(id) ON DELETE SET NULL,
  service_nome TEXT NOT NULL,
  service_type TEXT DEFAULT 'unknown',
  amount REAL NOT NULL,               -- Valor mensal da assinatura
  frequency_label TEXT DEFAULT 'mensal',
  yearly_cost REAL NOT NULL,          -- Custo anual estimado
  cancelled_at TEXT DEFAULT (datetime('now')),
  -- Economia calculada dinamicamente
  meses_desde_cancelamento INTEGER DEFAULT 0,
  economia_acumulada REAL DEFAULT 0,  -- Valor economizado até hoje
  economia_anual_projetada REAL DEFAULT 0, -- Economia projetada para 12 meses
  motivo TEXT,                        -- Motivo opcional do cancelamento
  notas TEXT
);

CREATE INDEX IF NOT EXISTS idx_assinaturas_canceladas_user ON assinaturas_canceladas_historico(user_id, cancelled_at);

-- ============================================================
-- 2. COMPRAS RECORRENTES DETECTADAS
-- Agrupa compras recorrentes identificadas por padrão (com ou sem IA)
-- ============================================================
CREATE TABLE IF NOT EXISTS compras_recorrentes_detectadas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  normalized_description TEXT NOT NULL,
  original_description TEXT NOT NULL,
  categoria TEXT,
  amount_avg REAL NOT NULL,           -- Valor médio
  amount_min REAL,
  amount_max REAL,
  frequency_label TEXT DEFAULT 'mensal', -- semanal, quinzenal, mensal
  occurrences INTEGER DEFAULT 0,
  first_occurrence TEXT,
  last_occurrence TEXT,
  average_interval_days REAL,
  confidence REAL DEFAULT 0,          -- 0-100
  ia_classificado BOOLEAN DEFAULT 0,  -- Se foi classificado pela IA
  ia_tipo TEXT,                       -- Tipo sugerido pela IA (assinatura, compra_habitual, impulsiva)
  status TEXT DEFAULT 'active' CHECK(status IN ('active','reduced','cancelled','ignored')),
  valor_reduzido REAL,                -- Novo valor após redução
  economia_mensal REAL DEFAULT 0,     -- Economia mensal após redução
  economia_anual REAL DEFAULT 0,      -- Economia anual projetada
  reduced_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(user_id, normalized_description)
);

CREATE INDEX IF NOT EXISTS idx_compras_recorrentes_user ON compras_recorrentes_detectadas(user_id, status);

-- ============================================================
-- 3. HISTÓRICO DE ANÁLISES DE IA (cache de resultados)
-- Evita chamar a IA toda vez para os mesmos dados
-- ============================================================
CREATE TABLE IF NOT EXISTS ia_analise_cache (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL,                 -- 'assinatura' ou 'compra_recorrente'
  input_hash TEXT NOT NULL,           -- Hash do input para cache
  resultado TEXT NOT NULL,            -- JSON com resultado da IA
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(user_id, tipo, input_hash)
);

-- ============================================================
-- 4. ADICIONAR CAMPO ai_enhanced em detected_subscriptions
-- ============================================================
ALTER TABLE detected_subscriptions ADD COLUMN ai_enhanced BOOLEAN DEFAULT 0;
ALTER TABLE detected_subscriptions ADD COLUMN ai_analysis TEXT; -- JSON com análise da IA
