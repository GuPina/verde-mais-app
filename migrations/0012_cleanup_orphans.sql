-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 0012 — Cleanup de tabelas órfãs + ajustes de conquistas + 
--                  suporte a aportes de investimento (tipo='aporte')
-- ═══════════════════════════════════════════════════════════════════════════

-- ── BUG 1.3: Dropar tabelas órfãs ────────────────────────────────────────
DROP TABLE IF EXISTS cartao_lancamentos;
DROP TABLE IF EXISTS despesas_new;
DROP TABLE IF EXISTS investimentos_new;
DROP TABLE IF EXISTS financiamento_entrada_parcelas;

-- ── BUG 1.1: Coluna tipo na tabela despesas (para aportes) ───────────────
-- SQLite não suporta ADD COLUMN com DEFAULT em versões antigas, mas suporta isso:
ALTER TABLE despesas ADD COLUMN tipo TEXT DEFAULT 'normal';

-- ── BUG 1.4: Corrigir conquistas existentes ───────────────────────────────

-- Corrigir descrição 'disciplinado'
UPDATE conquistas_definicoes 
SET descricao = 'Registrou 10 despesas pagas no mesmo mês'
WHERE codigo = 'disciplinado';

-- Corrigir descrição 'analista'
UPDATE conquistas_definicoes 
SET descricao = 'Gerou seu primeiro relatório anual'
WHERE codigo = 'analista';

-- Remover cartao_zero (duplicada com fatura_paga)
DELETE FROM conquistas_definicoes WHERE codigo = 'cartao_zero';
DELETE FROM conquistas_usuario WHERE conquista_codigo = 'cartao_zero';

-- Atualizar sem_dividas: 200pts, lendario
UPDATE conquistas_definicoes 
SET pontos = 200, raridade = 'lendario'
WHERE codigo = 'sem_dividas';

-- Inserir nova conquista quitou_imovel
INSERT OR IGNORE INTO conquistas_definicoes 
  (codigo, titulo, descricao, icone, pontos, raridade)
VALUES
  ('quitou_imovel', 'Livre do Banco!', 
   'Quitou 100% do seu financiamento imobiliário', 
   '🏠', 500, 'lendario');

-- ── Tabela para Despesas Compartilhadas (BUG 1.5 já existe, só garantir) ─
-- (shared_expenses já criada em 0011, essa migration garante índice extra)
CREATE INDEX IF NOT EXISTS idx_shared_expenses_expense ON shared_expenses(expense_id);

-- ── Tabela para Assistente IA conversacional (futuro Bloco 5) ─────────────
CREATE TABLE IF NOT EXISTS assistente_conversas (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL,
  mensagem    TEXT NOT NULL,
  resposta    TEXT NOT NULL,
  intencao    TEXT,
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_assistente_user ON assistente_conversas(user_id);

