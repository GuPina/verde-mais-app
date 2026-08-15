-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 0031: melhorias em investimentos e reserva de emergência
-- ─────────────────────────────────────────────────────────────────────────────

-- S-I4: meta_valor para investimentos
ALTER TABLE investimentos ADD COLUMN meta_valor REAL DEFAULT NULL;

-- S-I5: tags em investimentos
ALTER TABLE investimentos ADD COLUMN tags TEXT DEFAULT NULL;

-- S-I2: symbol para identificar ativo cripto/ação (ex: 'bitcoin', 'ITUB4')
ALTER TABLE investimentos ADD COLUMN symbol TEXT DEFAULT NULL;

-- S-RE5: banco onde a reserva está guardada
ALTER TABLE reserva_emergencia ADD COLUMN banco TEXT DEFAULT NULL;

-- S-RE1: tabela de histórico de movimentações da reserva legada
CREATE TABLE IF NOT EXISTS reserva_historico (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  reserva_id     INTEGER NOT NULL,
  user_id        INTEGER NOT NULL,
  tipo           TEXT NOT NULL CHECK(tipo IN ('deposito','saque','ajuste')),
  valor          REAL NOT NULL,
  descricao      TEXT,
  saldo_antes    REAL NOT NULL DEFAULT 0,
  saldo_depois   REAL NOT NULL DEFAULT 0,
  data           TEXT NOT NULL DEFAULT (date('now')),
  criado_em      DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (reserva_id) REFERENCES reserva_emergencia(id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_reserva_historico_reserva ON reserva_historico(reserva_id);
CREATE INDEX IF NOT EXISTS idx_reserva_historico_user ON reserva_historico(user_id, data);

-- Cache de cotações externas (CDI, cripto, câmbio)
CREATE TABLE IF NOT EXISTS cotacoes_cache (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  tipo        TEXT NOT NULL,  -- 'cdi','cripto','cambio'
  symbol      TEXT NOT NULL,  -- 'CDI','BTC','USD','EUR'
  valor_brl   REAL,
  valor_usd   REAL,
  variacao_24h REAL,
  dados_json  TEXT,           -- JSON completo da resposta
  atualizado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(tipo, symbol)
);
