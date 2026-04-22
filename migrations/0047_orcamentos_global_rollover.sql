-- Migration 0047: Orçamentos - Global Budget, Rollover, Alertas Progressivos, Sugestão
-- Implementa:
--   1. Orçamento global mensal (além dos por categoria)
--   2. Rollover: saldo não gasto carry-forward
--   3. Alertas progressivos: 70%, 90%, 100%
--   4. Campo de sugestão baseado nos últimos 3 meses
--   5. Templates de importação CSV por banco

-- ─── 1. Configuração de orçamento global por usuário/mês ─────────────────────
CREATE TABLE IF NOT EXISTS orcamento_global (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mes           INTEGER NOT NULL CHECK(mes BETWEEN 1 AND 12),
  ano           INTEGER NOT NULL CHECK(ano >= 2024),
  limite_global DECIMAL(10,2) NOT NULL CHECK(limite_global > 0),
  rollover      BOOLEAN DEFAULT 0,   -- se true, saldo do mês anterior é somado ao limite
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, mes, ano)
);
CREATE INDEX IF NOT EXISTS idx_orc_global_user ON orcamento_global(user_id, mes, ano);

-- ─── 2. Registro de rollover por mês ─────────────────────────────────────────
-- Guarda o saldo não gasto que foi transportado para o próximo mês
CREATE TABLE IF NOT EXISTS orcamento_rollover (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  categoria      TEXT NOT NULL,         -- 'GLOBAL' para orçamento global
  mes_origem     INTEGER NOT NULL,
  ano_origem     INTEGER NOT NULL,
  mes_destino    INTEGER NOT NULL,
  ano_destino    INTEGER NOT NULL,
  saldo_rollover DECIMAL(10,2) NOT NULL,  -- valor positivo = sobrou; negativo = não usado
  created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, categoria, mes_destino, ano_destino)
);
CREATE INDEX IF NOT EXISTS idx_orc_rollover_user ON orcamento_rollover(user_id, mes_destino, ano_destino);

-- ─── 3. Alertas progressivos (ampliar campo alerta_percentual existente) ──────
-- alerta_percentual já existe; adicionamos alerta_percentual_2 e alerta_percentual_3
-- para suportar alertas em 70%, 90% e 100% (três níveis)
ALTER TABLE orcamentos ADD COLUMN alerta_70_disparado  INTEGER DEFAULT 0;
ALTER TABLE orcamentos ADD COLUMN alerta_90_disparado  INTEGER DEFAULT 0;
ALTER TABLE orcamentos ADD COLUMN alerta_100_disparado INTEGER DEFAULT 0;

-- ─── 4. Templates de banco para importação CSV ───────────────────────────────
CREATE TABLE IF NOT EXISTS csv_templates (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL,   -- 0=global template, >0=user template
  nome        TEXT NOT NULL,           -- 'Nubank', 'Itaú', 'Bradesco', custom...
  banco       TEXT NOT NULL,           -- nubank | itau | bradesco | inter | custom
  col_data    TEXT NOT NULL DEFAULT 'data',
  col_desc    TEXT NOT NULL DEFAULT 'descricao',
  col_valor   TEXT NOT NULL DEFAULT 'valor',
  col_tipo    TEXT,                    -- coluna que indica entrada/saída (opcional)
  separador   TEXT NOT NULL DEFAULT ';',
  decimal_sep TEXT NOT NULL DEFAULT ',',
  skip_rows   INTEGER DEFAULT 1,       -- linhas de cabeçalho a pular
  filtro_tipo TEXT,                    -- 'debit'/'credit' ou regex para detectar tipo
  ativo       BOOLEAN DEFAULT 1,
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, banco)
);
CREATE INDEX IF NOT EXISTS idx_csv_templates_user ON csv_templates(user_id);

-- ─── 5. Log de importações para deduplicação ─────────────────────────────────
CREATE TABLE IF NOT EXISTS importacao_log (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  hash         TEXT NOT NULL,   -- SHA256(data+descricao+valor) para detectar duplicatas
  data_transacao TEXT NOT NULL,
  descricao    TEXT NOT NULL,
  valor        DECIMAL(10,2) NOT NULL,
  importado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, hash)
);
CREATE INDEX IF NOT EXISTS idx_importacao_log_user ON importacao_log(user_id, hash);

-- ─── 6. Inserir templates padrão de bancos (globais, sem user_id específico) ──
-- Nota: templates globais são consultados como fallback quando user não tem template
-- Para isso usamos user_id = 0 como convenção
INSERT OR IGNORE INTO csv_templates (user_id, nome, banco, col_data, col_desc, col_valor, separador, decimal_sep, skip_rows, filtro_tipo)
VALUES
  (0, 'Nubank',   'nubank',   'date', 'title',    'amount', ',',  '.', 1, NULL),
  (0, 'Itaú',     'itau',     'Data', 'Histórico', 'Valor', ';',  ',', 2, NULL),
  (0, 'Bradesco', 'bradesco', 'Data', 'Histórico', 'Valor (R$)', ';', ',', 3, NULL),
  (0, 'Inter',    'inter',    'Data Lançamento', 'Descrição', 'Valor', ';', ',', 1, 'Tipo'),
  (0, 'C6 Bank',  'c6',       'Data', 'Descrição', 'Valor', ';', ',', 1, NULL),
  (0, 'Santander','santander','Data', 'Histórico', 'Valor', ';', ',', 2, NULL),
  (0, 'Caixa',    'caixa',    'Data', 'Descrição', 'Valor', ';', ',', 2, NULL),
  (0, 'PicPay',   'picpay',   'Data', 'Descrição', 'Valor', ';', ',', 1, NULL);
