-- Migration 0055: Adicionar mes_fatura e ano_fatura na tabela antecipacoes
-- Esses campos armazenam explicitamente o mês/ano da fatura de cartão antecipada,
-- evitando dependência do data_vencimento_original para o cancel correto das despesas

ALTER TABLE antecipacoes ADD COLUMN mes_fatura INTEGER;
ALTER TABLE antecipacoes ADD COLUMN ano_fatura INTEGER;

-- Preencher retroativamente para antecipações fatura_cartao existentes
-- usando o data_vencimento_original (melhor estimativa disponível)
UPDATE antecipacoes
SET
  mes_fatura = CAST(strftime('%m', data_vencimento_original) AS INTEGER),
  ano_fatura = CAST(strftime('%Y', data_vencimento_original) AS INTEGER)
WHERE tipo = 'fatura_cartao'
  AND mes_fatura IS NULL
  AND data_vencimento_original IS NOT NULL;
