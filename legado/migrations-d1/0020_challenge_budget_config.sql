-- Migration 0020: Bloco 3.1 + 3.2 — weekly_challenge_config e budget_rule_config

-- Bloco 3.1: Tabela de configuração do Desafio 52 Semanas
CREATE TABLE IF NOT EXISTS weekly_challenge_config (
  user_id INTEGER PRIMARY KEY,
  start_amount DECIMAL(10,2) DEFAULT 1.00,
  increment_amount DECIMAL(10,2) DEFAULT 1.00,
  mode TEXT DEFAULT 'standard',
  currency TEXT DEFAULT 'BRL',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Bloco 3.2: Tabela de configuração da Regra 50/30/20
CREATE TABLE IF NOT EXISTS budget_rule_config (
  user_id INTEGER PRIMARY KEY,
  needs_pct INTEGER DEFAULT 50,
  wants_pct INTEGER DEFAULT 30,
  savings_pct INTEGER DEFAULT 20,
  custom_name TEXT DEFAULT 'Regra 50/30/20',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Bloco 6.2: Tabela de mensagens do chat
CREATE TABLE IF NOT EXISTS chat_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  sender TEXT CHECK(sender IN ('user', 'bot')) NOT NULL,
  message TEXT NOT NULL,
  intent TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_user_id ON chat_messages(user_id);
CREATE INDEX IF NOT EXISTS idx_weekly_challenge_config_user ON weekly_challenge_config(user_id);
CREATE INDEX IF NOT EXISTS idx_budget_rule_config_user ON budget_rule_config(user_id);
