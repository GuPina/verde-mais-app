-- Migration 0021: Recorrência de Valor Variável
-- Permite cadastrar recorrências onde o valor muda a cada mês (ex: aluguel variável, obra)

-- 1. Adicionar flag de valor variável
ALTER TABLE recorrencias ADD COLUMN valor_variavel BOOLEAN DEFAULT 0;

-- 2. Guardar o último valor lançado (serve de sugestão na próxima vez)
ALTER TABLE recorrencias ADD COLUMN ultimo_valor DECIMAL(10,2) NULL;

-- 3. Tabela de histórico de lançamentos variáveis
CREATE TABLE IF NOT EXISTS recorrencias_historico (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  recorrencia_id INTEGER NOT NULL REFERENCES recorrencias(id) ON DELETE CASCADE,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mes           INTEGER NOT NULL,  -- 1-12
  ano           INTEGER NOT NULL,
  valor         DECIMAL(10,2) NOT NULL,
  observacao    TEXT NULL,
  lancado_em    DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(recorrencia_id, mes, ano)   -- só um lançamento por mês
);

CREATE INDEX IF NOT EXISTS idx_rec_hist_rec_id ON recorrencias_historico(recorrencia_id);
CREATE INDEX IF NOT EXISTS idx_rec_hist_user   ON recorrencias_historico(user_id);
