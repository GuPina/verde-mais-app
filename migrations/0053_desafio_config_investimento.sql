-- Fix: adicionar coluna investimento_vinculado em desafio_config
-- O código já usa essa coluna, mas ela nunca foi criada na migration
ALTER TABLE desafio_config ADD COLUMN investimento_vinculado INTEGER REFERENCES investimentos(id);
