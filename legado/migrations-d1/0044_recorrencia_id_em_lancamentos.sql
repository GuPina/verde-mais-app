-- Migration 0044: Adiciona coluna recorrencia_id nas tabelas despesas e receitas
-- Necessário para que o UPDATE/DELETE de recorrências com propagar_futuras=true
-- ou excluir_futuros=true funcionem corretamente filtrando pelos lançamentos vinculados.

-- Adicionar recorrencia_id em despesas (caso não exista)
ALTER TABLE despesas ADD COLUMN recorrencia_id INTEGER REFERENCES recorrencias(id) ON DELETE SET NULL;

-- Adicionar recorrencia_id em receitas (caso não exista)
ALTER TABLE receitas ADD COLUMN recorrencia_id INTEGER REFERENCES recorrencias(id) ON DELETE SET NULL;

-- Adicionar meio_pagamento em receitas (caso não exista)
ALTER TABLE receitas ADD COLUMN meio_pagamento TEXT;

-- Adicionar tipo em receitas (caso não exista)
ALTER TABLE receitas ADD COLUMN tipo TEXT DEFAULT 'receita';

-- Índices para performance nas queries de recorrência
CREATE INDEX IF NOT EXISTS idx_despesas_recorrencia_id ON despesas(recorrencia_id);
CREATE INDEX IF NOT EXISTS idx_receitas_recorrencia_id ON receitas(recorrencia_id);
