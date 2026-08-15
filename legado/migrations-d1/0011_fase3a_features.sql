-- VerdeMais v3.0 — FASE 3A: Múltiplas Reservas, Detector Assinaturas, Desafio 52 Semanas, 50/30/20

-- ============================================================
-- 1. MÚLTIPLAS RESERVAS ESPECIALIZADAS
-- ============================================================
CREATE TABLE IF NOT EXISTS specialized_reserves (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL DEFAULT 'custom' CHECK(type IN (
    'emergency','travel','health','unemployment',
    'family','education','vehicle','event','custom'
  )),
  name TEXT NOT NULL,
  description TEXT,
  target_amount REAL NOT NULL CHECK(target_amount > 0),
  current_amount REAL DEFAULT 0 CHECK(current_amount >= 0),
  priority INTEGER DEFAULT 3 CHECK(priority BETWEEN 1 AND 5),
  deadline TEXT,
  icon TEXT DEFAULT '🎯',
  color TEXT DEFAULT '#10B981',
  monthly_target REAL,
  status TEXT DEFAULT 'active' CHECK(status IN ('active','paused','completed','cancelled')),
  created_at TEXT DEFAULT (datetime('now')),
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS reserve_transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reserve_id INTEGER NOT NULL REFERENCES specialized_reserves(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK(type IN ('deposit','withdrawal')),
  amount REAL NOT NULL CHECK(amount > 0),
  description TEXT,
  date TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_spec_reserves_user ON specialized_reserves(user_id, status);
CREATE INDEX IF NOT EXISTS idx_reserve_tx_reserve ON reserve_transactions(reserve_id);

-- ============================================================
-- 2. DETECTOR DE ASSINATURAS FANTASMA
-- ============================================================
CREATE TABLE IF NOT EXISTS detected_subscriptions (
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
  user_feedback TEXT CHECK(user_feedback IN ('use_regularly','want_cancel','ignore')),
  detected_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_detected_subs_user ON detected_subscriptions(user_id, status);

-- ============================================================
-- 3. DESAFIO 52 SEMANAS
-- ============================================================
CREATE TABLE IF NOT EXISTS weekly_challenges (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  year INTEGER NOT NULL,
  week_number INTEGER NOT NULL CHECK(week_number BETWEEN 1 AND 52),
  target_amount REAL NOT NULL,
  status TEXT DEFAULT 'pending' CHECK(status IN ('pending','completed','skipped')),
  completed_at TEXT,
  UNIQUE(user_id, year, week_number)
);

CREATE INDEX IF NOT EXISTS idx_weekly_challenges_user ON weekly_challenges(user_id, year);

-- ============================================================
-- 4. DIVISÃO DE DESPESAS (MODO CASAL)
-- ============================================================
CREATE TABLE IF NOT EXISTS shared_expenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  expense_id INTEGER NOT NULL REFERENCES despesas(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  partner_name TEXT NOT NULL,
  partner_email TEXT,
  user_percentage REAL DEFAULT 50.0 CHECK(user_percentage BETWEEN 0 AND 100),
  partner_percentage REAL DEFAULT 50.0,
  status TEXT DEFAULT 'pending' CHECK(status IN ('pending','settled')),
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_shared_exp_user ON shared_expenses(user_id);

-- ============================================================
-- 5. SIMULAÇÕES DE AMORTIZAÇÃO (histórico)
-- ============================================================
CREATE TABLE IF NOT EXISTS amortization_simulations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  financing_id INTEGER REFERENCES financiamentos(id) ON DELETE SET NULL,
  original_balance REAL NOT NULL,
  original_installment REAL NOT NULL,
  original_remaining_months INTEGER NOT NULL,
  annual_rate REAL NOT NULL,
  system TEXT NOT NULL CHECK(system IN ('PRICE','SAC','SACRE')),
  amortization_amount REAL NOT NULL,
  new_installment_reduce_payment REAL,
  interest_saved_reduce_payment REAL,
  new_remaining_months_reduce_term INTEGER,
  interest_saved_reduce_term REAL,
  months_saved_reduce_term INTEGER,
  recommended_scenario TEXT CHECK(recommended_scenario IN ('reduce_payment','reduce_term')),
  recommendation_reason TEXT,
  simulation_date TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_amort_sim_user ON amortization_simulations(user_id, simulation_date);

-- ============================================================
-- 6. CONQUISTAS — Novas para v3.0
-- ============================================================
INSERT OR IGNORE INTO conquistas_definicoes (codigo, titulo, descricao, icone, pontos, raridade) VALUES
  ('multi_reserva_criada',   'Organizado por Natureza',  'Criou uma reserva especializada', '🎯', 30, 'comum'),
  ('multi_3_reservas',       'Mestre das Reservas',       'Tem 3 reservas ativas simultâneas', '🛡️', 80, 'épico'),
  ('reserva_spec_completa',  'Objetivo Alcançado!',       'Completou uma reserva especializada', '🏆', 100, 'lendário'),
  ('sub_detector_scanned',   'Detetive Financeiro',       'Escaneou assinaturas fantasma', '🕵️', 20, 'comum'),
  ('sub_cancelou_1',         'Economizador',              'Cancelou uma assinatura desnecessária', '✂️', 40, 'raro'),
  ('desafio_52_iniciou',     '52 Semanas Aceito',         'Iniciou o Desafio das 52 Semanas', '🎯', 25, 'comum'),
  ('desafio_52_metade',      'Na Metade do Caminho',      'Completou 26 semanas do desafio', '🔥', 75, 'épico'),
  ('desafio_52_completo',    'Campeão das 52 Semanas',    'Completou o desafio das 52 semanas!', '🏆', 200, 'lendário'),
  ('amortizou_simulou',      'Estrategista da Dívida',    'Usou o simulador de amortização', '📊', 30, 'raro'),
  ('regra_503020_verde',     'Equilíbrio Financeiro',     'Atingiu score 80+ na regra 50/30/20', '⚖️', 60, 'épico');
