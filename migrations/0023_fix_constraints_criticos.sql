-- Migration 0023: Corrigir CHECK constraints críticos
-- 1) meio_pagamento: adicionar 'debito' e 'parcelado_sem_juros'
-- 2) lembretes.tipo: adicionar 'despesa', 'receita', 'saude', 'educacao', 'transporte'
-- Dados existentes são preservados integralmente

-- ═══════════════════════════════════════════════════════════════
-- PARTE 1: DESPESAS — expandir meio_pagamento
-- ═══════════════════════════════════════════════════════════════

-- 1a. Criar tabela nova com constraint expandido
CREATE TABLE despesas_v23 (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id             INTEGER NOT NULL,
  descricao           TEXT    NOT NULL,
  data                DATE    NOT NULL,
  categoria           TEXT    NOT NULL,
  subcategoria        TEXT,
  valor               REAL    NOT NULL,
  parcelado           INTEGER DEFAULT 0,
  numero_parcelas     INTEGER DEFAULT 1,
  parcela_atual       INTEGER DEFAULT 1,
  status              TEXT    DEFAULT 'pendente' CHECK(status IN ('pago','pendente','cancelado')),
  fixa_ou_variavel    TEXT    DEFAULT 'variavel' CHECK(fixa_ou_variavel IN ('fixa','variavel')),
  recorrente          INTEGER DEFAULT 0,
  vencimento          DATE,
  observacoes         TEXT,
  data_criacao        DATETIME DEFAULT CURRENT_TIMESTAMP,
  cartao_id           INTEGER REFERENCES cartoes(id),
  meio_pagamento      TEXT    DEFAULT 'dinheiro' CHECK(meio_pagamento IN (
                        'dinheiro','pix','cartao_credito','cartao_debito',
                        'parcelado_cartao','transferencia','boleto','outros',
                        'debito','parcelado_sem_juros'
                      )),
  billing_month       INTEGER CHECK(billing_month BETWEEN 1 AND 12),
  billing_year        INTEGER CHECK(billing_year >= 2024),
  purchase_group_id   TEXT,
  tipo                TEXT    DEFAULT 'normal',
  eh_aporte_patrimonial BOOLEAN DEFAULT 0,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- 1b. Migrar TODOS os dados existentes (sem perda)
INSERT INTO despesas_v23
  SELECT
    id, user_id, descricao, data, categoria, subcategoria, valor,
    parcelado, numero_parcelas, parcela_atual, status, fixa_ou_variavel,
    recorrente, vencimento, observacoes, data_criacao, cartao_id,
    CASE
      WHEN meio_pagamento IN (
        'dinheiro','pix','cartao_credito','cartao_debito',
        'parcelado_cartao','transferencia','boleto','outros',
        'debito','parcelado_sem_juros'
      ) THEN meio_pagamento
      ELSE 'dinheiro'
    END,
    billing_month, billing_year, purchase_group_id, tipo, eh_aporte_patrimonial
  FROM despesas;

-- 1c. Substituir tabela
DROP TABLE despesas;
ALTER TABLE despesas_v23 RENAME TO despesas;

-- Recriar índices
CREATE INDEX IF NOT EXISTS idx_despesas_user_id  ON despesas(user_id);
CREATE INDEX IF NOT EXISTS idx_despesas_data      ON despesas(data);
CREATE INDEX IF NOT EXISTS idx_despesas_cartao_id ON despesas(cartao_id);

-- ═══════════════════════════════════════════════════════════════
-- PARTE 2: LEMBRETES — expandir tipo
-- ═══════════════════════════════════════════════════════════════

-- 2a. Criar tabela nova com constraint expandido
CREATE TABLE lembretes_v23 (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id             INTEGER NOT NULL,
  titulo              TEXT    NOT NULL,
  descricao           TEXT,
  tipo                TEXT    DEFAULT 'conta' CHECK(tipo IN (
                        'conta','imposto','mensalidade','seguro','aluguel',
                        'investimento','outros','despesa','receita',
                        'saude','educacao','transporte'
                      )),
  valor_estimado      REAL    DEFAULT 0,
  dia_vencimento      INTEGER,
  frequencia          TEXT    DEFAULT 'mensal' CHECK(frequencia IN (
                        'semanal','quinzenal','mensal','bimestral',
                        'trimestral','semestral','anual'
                      )),
  ativo               INTEGER DEFAULT 1,
  ultimo_recebimento  DATE,
  proximo_vencimento  DATE,
  status_mes          TEXT    DEFAULT 'aguardando' CHECK(status_mes IN (
                        'aguardando','recebido','pago','ignorado'
                      )),
  alertar_dias_antes  INTEGER DEFAULT 3,
  data_criacao        DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- 2b. Migrar TODOS os lembretes existentes (sem perda)
INSERT INTO lembretes_v23
  SELECT
    id, user_id, titulo, descricao,
    CASE
      WHEN tipo IN (
        'conta','imposto','mensalidade','seguro','aluguel',
        'investimento','outros','despesa','receita',
        'saude','educacao','transporte'
      ) THEN tipo
      ELSE 'outros'
    END,
    valor_estimado, dia_vencimento, frequencia, ativo,
    ultimo_recebimento, proximo_vencimento, status_mes,
    alertar_dias_antes, data_criacao
  FROM lembretes;

-- 2c. Substituir tabela
DROP TABLE lembretes;
ALTER TABLE lembretes_v23 RENAME TO lembretes;

-- Recriar índice
CREATE INDEX IF NOT EXISTS idx_lembretes_user_id ON lembretes(user_id);

