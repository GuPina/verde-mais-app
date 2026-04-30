-- Migration 0051: Corrigir CHECK constraint de antecipacoes.tipo para incluir fatura_cartao
-- O frontend envia tipo='fatura_cartao' mas o CHECK só aceitava
-- ('conta','parcela','fatura','emprestimo','financiamento')

-- 1. Criar tabela nova com CHECK constraint corrigido
CREATE TABLE IF NOT EXISTS antecipacoes_new (
  id                      INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id                 INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  descricao               TEXT NOT NULL,
  valor_total             REAL NOT NULL,
  data_vencimento_original DATE NOT NULL,
  data_antecipacao        DATE NOT NULL,
  economia_juros          REAL DEFAULT 0,
  status                  TEXT DEFAULT 'pendente'
    CHECK(status IN ('pendente','antecipada','cancelada')),
  tipo                    TEXT DEFAULT 'conta'
    CHECK(tipo IN ('conta','parcela','fatura','fatura_cartao','emprestimo','financiamento')),
  referencia_id           INTEGER,
  referencia_tipo         TEXT,
  observacoes             TEXT,
  created_at              DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 2. Copiar dados existentes (normaliza valores inválidos para 'conta')
INSERT INTO antecipacoes_new
  SELECT id, user_id, descricao, valor_total, data_vencimento_original,
         data_antecipacao, economia_juros, status,
         CASE WHEN tipo IN ('conta','parcela','fatura','fatura_cartao','emprestimo','financiamento')
              THEN tipo ELSE 'conta' END,
         referencia_id, referencia_tipo, observacoes, created_at
  FROM antecipacoes;

-- 3. Substituir tabela
DROP TABLE antecipacoes;
ALTER TABLE antecipacoes_new RENAME TO antecipacoes;

-- 4. Recriar índices
CREATE INDEX IF NOT EXISTS idx_antecipacoes_user ON antecipacoes(user_id, status);
CREATE INDEX IF NOT EXISTS idx_antecipacoes_tipo ON antecipacoes(user_id, tipo);
