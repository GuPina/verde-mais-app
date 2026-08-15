-- VerdeMais - Fix colunas faltantes que causam erros 500
-- 1. data_pagamento em despesas (usado pelo bulk-pagar)
-- 2. parcelas_restantes e proximo_vencimento em emprestimos e financiamentos

-- Adicionar data_pagamento na tabela despesas (se não existir)
ALTER TABLE despesas ADD COLUMN data_pagamento DATE;

-- Adicionar parcelas_restantes em emprestimos (coluna calculada persistida)
ALTER TABLE emprestimos ADD COLUMN parcelas_restantes INTEGER GENERATED ALWAYS AS (numero_parcelas - parcelas_pagas) VIRTUAL;

-- Adicionar proximo_vencimento em emprestimos
ALTER TABLE emprestimos ADD COLUMN proximo_vencimento DATE;

-- Adicionar parcelas_restantes em financiamentos
ALTER TABLE financiamentos ADD COLUMN parcelas_restantes INTEGER GENERATED ALWAYS AS (numero_parcelas - parcelas_pagas) VIRTUAL;

-- Adicionar proximo_vencimento em financiamentos
ALTER TABLE financiamentos ADD COLUMN proximo_vencimento DATE;
