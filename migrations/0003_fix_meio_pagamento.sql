-- Migration 0003: Corrigir CHECK constraint de meio_pagamento
-- O valor 'parcelado_cartao' enviado pelo frontend não estava no constraint original
-- Recriando a tabela despesas com o constraint expandido

-- 1. Criar tabela temporária com o constraint corrigido
CREATE TABLE IF NOT EXISTS despesas_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  descricao TEXT NOT NULL,
  data DATE NOT NULL,
  categoria TEXT NOT NULL,
  subcategoria TEXT,
  valor REAL NOT NULL,
  parcelado INTEGER DEFAULT 0,
  numero_parcelas INTEGER DEFAULT 1,
  parcela_atual INTEGER DEFAULT 1,
  status TEXT DEFAULT 'pendente' CHECK(status IN ('pago', 'pendente', 'cancelado')),
  fixa_ou_variavel TEXT DEFAULT 'variavel' CHECK(fixa_ou_variavel IN ('fixa', 'variavel')),
  recorrente INTEGER DEFAULT 0,
  vencimento DATE,
  observacoes TEXT,
  data_criacao DATETIME DEFAULT CURRENT_TIMESTAMP,
  cartao_id INTEGER REFERENCES cartoes(id),
  meio_pagamento TEXT DEFAULT 'dinheiro' CHECK(meio_pagamento IN (
    'dinheiro', 'pix', 'cartao_credito', 'cartao_debito',
    'parcelado_cartao', 'transferencia', 'boleto', 'outros'
  )),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- 2. Migrar dados existentes (normalizar valores inválidos para 'dinheiro')
INSERT INTO despesas_new 
  SELECT 
    id, user_id, descricao, data, categoria, subcategoria, valor,
    parcelado, numero_parcelas, parcela_atual, status, fixa_ou_variavel,
    recorrente, vencimento, observacoes, data_criacao, cartao_id,
    CASE 
      WHEN meio_pagamento IN ('dinheiro','pix','cartao_credito','cartao_debito','parcelado_cartao','transferencia','boleto','outros') 
      THEN meio_pagamento
      ELSE 'dinheiro'
    END
  FROM despesas;

-- 3. Remover tabela antiga e renomear
DROP TABLE despesas;
ALTER TABLE despesas_new RENAME TO despesas;
