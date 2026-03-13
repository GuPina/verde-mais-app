-- ═══════════════════════════════════════════════════════════════════════════
-- MIGRATION 0008: Sistema de Fatura Real, Sincronização e Meta de Dívidas
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── 1. Novas colunas em despesas ──────────────────────────────────────────
-- billing_month/billing_year: mês/ano da FATURA (calculado pelo fechamento)
-- purchase_group_id: agrupa parcelas de uma mesma compra
ALTER TABLE despesas ADD COLUMN billing_month INTEGER CHECK (billing_month BETWEEN 1 AND 12);
ALTER TABLE despesas ADD COLUMN billing_year  INTEGER CHECK (billing_year  >= 2024);
ALTER TABLE despesas ADD COLUMN purchase_group_id TEXT; -- UUID como TEXT no SQLite

CREATE INDEX IF NOT EXISTS idx_despesas_card_billing
  ON despesas(cartao_id, billing_month, billing_year);

CREATE INDEX IF NOT EXISTS idx_despesas_purchase_group
  ON despesas(purchase_group_id);

-- ─── 2. Tabela card_charges — lançamentos de cartão (fatura real) ──────────
-- Fonte única de verdade para a FATURA do cartão.
-- Vinculada bidireccionalmente à tabela despesas via expense_id.
CREATE TABLE IF NOT EXISTS card_charges (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  card_id          INTEGER NOT NULL REFERENCES cartoes(id)  ON DELETE CASCADE,
  expense_id       INTEGER          REFERENCES despesas(id) ON DELETE SET NULL,
  descricao        TEXT    NOT NULL,
  valor            REAL    NOT NULL CHECK (valor > 0),
  data_compra      DATE    NOT NULL,
  data_vencimento  DATE    NOT NULL,
  billing_month    INTEGER NOT NULL CHECK (billing_month BETWEEN 1 AND 12),
  billing_year     INTEGER NOT NULL CHECK (billing_year  >= 2024),
  parcela_atual    INTEGER,
  total_parcelas   INTEGER,
  purchase_group_id TEXT,
  status           TEXT    NOT NULL DEFAULT 'pendente'
                          CHECK (status IN ('pendente','pago','cancelado')),
  created_at       DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_card_charges_billing
  ON card_charges(card_id, billing_month, billing_year);

CREATE INDEX IF NOT EXISTS idx_card_charges_group
  ON card_charges(purchase_group_id);

CREATE INDEX IF NOT EXISTS idx_card_charges_expense
  ON card_charges(expense_id);

-- ─── 3. Novas colunas em metas (meta de quitar dívidas) ────────────────────
ALTER TABLE metas ADD COLUMN linked_debt_type TEXT
  CHECK (linked_debt_type IN ('all','financiamento','emprestimo','especifico'));
ALTER TABLE metas ADD COLUMN linked_debt_id       INTEGER;
ALTER TABLE metas ADD COLUMN original_debt_amount REAL;

-- ─── 4. Novas conquistas ───────────────────────────────────────────────────
INSERT OR IGNORE INTO conquistas_definicoes
  (codigo, titulo, descricao, icone, pontos, raridade) VALUES
  ('fatura_paga',   'Fatura Quitada',   'Pagou uma fatura completa do cartão',         '💳', 30,  'COMUM'),
  ('sem_dividas',   'Livre de Dívidas', 'Quitou todas as dívidas cadastradas',         '🏆', 200, 'LENDARIO'),
  ('meta_divida',   'Devedor Consciente','Criou uma meta para quitar uma dívida',      '🎯', 40,  'RARO');
