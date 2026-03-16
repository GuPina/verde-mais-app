-- Migration 0022: Remover CHECK (valor > 0) da tabela recorrencias
-- para permitir valor=0 em recorrências variáveis (o valor é definido no lançamento)
--
-- SQLite não suporta ALTER TABLE DROP CONSTRAINT, então recriamos a tabela.

CREATE TABLE recorrencias_new (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tipo           TEXT NOT NULL CHECK (tipo IN ('despesa', 'receita')),
  descricao      TEXT NOT NULL,
  valor          DECIMAL(10,2) NOT NULL DEFAULT 0,   -- 0 permitido para variáveis
  categoria      TEXT NOT NULL,
  dia_vencimento INTEGER NOT NULL CHECK (dia_vencimento BETWEEN 1 AND 31),
  meio_pagamento TEXT DEFAULT 'outros',
  ativa          BOOLEAN DEFAULT 1,
  data_inicio    DATE DEFAULT (date('now')),
  data_fim       DATE NULL,
  ultimo_gerado  DATE NULL,
  ultimo_valor   DECIMAL(10,2) NULL,
  valor_variavel BOOLEAN DEFAULT 0,
  total_gerado   INTEGER DEFAULT 0,
  created_at     DATETIME DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO recorrencias_new
  (id, user_id, tipo, descricao, valor, categoria, dia_vencimento,
   meio_pagamento, ativa, data_inicio, data_fim, ultimo_gerado,
   ultimo_valor, valor_variavel, total_gerado, created_at)
SELECT
  id, user_id, tipo, descricao, valor, categoria, dia_vencimento,
  meio_pagamento, ativa, data_inicio, data_fim, ultimo_gerado,
  ultimo_valor, valor_variavel, total_gerado, created_at
FROM recorrencias;

DROP TABLE recorrencias;
ALTER TABLE recorrencias_new RENAME TO recorrencias;
