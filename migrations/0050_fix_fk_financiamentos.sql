-- Migration 0050: Corrigir FOREIGN KEY que apontam para financiamentos_bkp_0040 (tabela que não existe)
-- A migration 0040 recriou a tabela financiamentos mas deixou as FK de tabelas dependentes
-- apontando para a tabela temporária de backup (financiamentos_bkp_0040) que foi dropada.

-- ── 1. Recriar amortization_simulations com FK correta ──────────────────────
-- Salvar dados existentes
CREATE TABLE IF NOT EXISTS amortization_simulations_bkp_0050 AS
  SELECT * FROM amortization_simulations;

DROP TABLE amortization_simulations;

CREATE TABLE amortization_simulations (
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

INSERT INTO amortization_simulations
  SELECT * FROM amortization_simulations_bkp_0050;

DROP TABLE amortization_simulations_bkp_0050;

-- ── 2. Recriar financiamento_entrada_parcelas com FK correta ─────────────────
CREATE TABLE IF NOT EXISTS financiamento_entrada_parcelas_bkp_0050 AS
  SELECT * FROM financiamento_entrada_parcelas;

DROP TABLE financiamento_entrada_parcelas;

CREATE TABLE financiamento_entrada_parcelas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  financiamento_id INTEGER NOT NULL,
  numero INTEGER NOT NULL,
  valor REAL NOT NULL,
  vencimento TEXT NOT NULL,
  status TEXT DEFAULT 'pendente' CHECK(status IN ('pendente','pago','atrasado')),
  data_pagamento TEXT,
  observacoes TEXT,
  criado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (financiamento_id) REFERENCES financiamentos(id) ON DELETE CASCADE
);

INSERT INTO financiamento_entrada_parcelas
  SELECT * FROM financiamento_entrada_parcelas_bkp_0050;

DROP TABLE financiamento_entrada_parcelas_bkp_0050;
