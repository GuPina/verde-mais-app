-- Migration 0017: Bloco 1.2 — Diferenciar aportes patrimoniais de despesas normais
-- Adicionar coluna eh_aporte_patrimonial em despesas
ALTER TABLE despesas ADD COLUMN eh_aporte_patrimonial BOOLEAN DEFAULT 0;

-- Adicionar coluna registra_saida_saldo em investimentos
ALTER TABLE investimentos ADD COLUMN registra_saida_saldo BOOLEAN DEFAULT 1;

-- Retroativo: marcar despesas existentes categoria Poupança/Investimento como aporte
UPDATE despesas
SET eh_aporte_patrimonial = 1
WHERE categoria IN ('Poupança','Investimento','Aplicação','Aporte Patrimonial')
   OR tipo = 'aporte';
