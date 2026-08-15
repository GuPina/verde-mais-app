-- VerdeMais - Adicionar campos seguro_mip e seguro_dfi em financiamentos
-- Esses campos são usados pelo código mas nunca foram criados via migration

ALTER TABLE financiamentos ADD COLUMN seguro_mip REAL DEFAULT 0;
ALTER TABLE financiamentos ADD COLUMN seguro_dfi REAL DEFAULT 0;
