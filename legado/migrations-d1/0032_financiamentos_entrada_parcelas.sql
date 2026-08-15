-- Migration 0032: Tabela financiamento_entrada_parcelas
-- Necessária para o módulo de Financiamentos (parcelas de entrada)

CREATE TABLE IF NOT EXISTS financiamento_entrada_parcelas (
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
  FOREIGN KEY (financiamento_id) REFERENCES financiamentos(id)
);

CREATE INDEX IF NOT EXISTS idx_fin_entrada_parcelas_fin_id ON financiamento_entrada_parcelas(financiamento_id);
CREATE INDEX IF NOT EXISTS idx_fin_entrada_parcelas_user_id ON financiamento_entrada_parcelas(user_id);
