-- ═══════════════════════════════════════════════════════════════
-- MIGRATION 0007: Orçamentos, Recorrências, Gateway Asaas
-- ═══════════════════════════════════════════════════════════════

-- ─── 1. Orçamentos mensais por categoria ─────────────────────
CREATE TABLE IF NOT EXISTS orcamentos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  categoria TEXT NOT NULL,
  mes INTEGER NOT NULL CHECK (mes BETWEEN 1 AND 12),
  ano INTEGER NOT NULL CHECK (ano >= 2024),
  limite DECIMAL(10,2) NOT NULL CHECK (limite > 0),
  alerta_percentual INTEGER DEFAULT 80 CHECK (alerta_percentual BETWEEN 50 AND 100),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, categoria, mes, ano)
);

CREATE INDEX IF NOT EXISTS idx_orcamentos_user_mes ON orcamentos(user_id, mes, ano);

-- ─── 2. Transações recorrentes ────────────────────────────────
CREATE TABLE IF NOT EXISTS recorrencias (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL CHECK (tipo IN ('despesa', 'receita')),
  descricao TEXT NOT NULL,
  valor DECIMAL(10,2) NOT NULL CHECK (valor > 0),
  categoria TEXT NOT NULL,
  dia_vencimento INTEGER NOT NULL CHECK (dia_vencimento BETWEEN 1 AND 31),
  meio_pagamento TEXT DEFAULT 'outros',
  ativa BOOLEAN DEFAULT 1,
  data_inicio DATE DEFAULT (date('now')),
  data_fim DATE NULL,
  ultimo_gerado DATE NULL,
  total_gerado INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_recorrencias_user ON recorrencias(user_id, ativa);
CREATE INDEX IF NOT EXISTS idx_recorrencias_dia ON recorrencias(dia_vencimento, ativa);

-- ─── 3. Assinaturas / Gateway Asaas ──────────────────────────
CREATE TABLE IF NOT EXISTS pagamentos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  asaas_subscription_id TEXT,
  asaas_customer_id TEXT,
  asaas_payment_id TEXT,
  plano TEXT NOT NULL CHECK (plano IN ('premium', 'pro')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'cancelled', 'expired', 'overdue')),
  forma_pagamento TEXT CHECK (forma_pagamento IN ('PIX', 'BOLETO', 'CREDIT_CARD')),
  valor DECIMAL(10,2) NOT NULL,
  checkout_url TEXT,
  boleto_url TEXT,
  pix_qrcode TEXT,
  pix_copia_cola TEXT,
  ativado_em DATETIME NULL,
  expira_em DATETIME NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_pagamentos_user ON pagamentos(user_id, status);
CREATE INDEX IF NOT EXISTS idx_pagamentos_asaas ON pagamentos(asaas_subscription_id);

-- ─── 4. Coluna CPF nos users (para Asaas) ────────────────────
ALTER TABLE users ADD COLUMN cpf TEXT;
ALTER TABLE users ADD COLUMN telefone TEXT;

-- ─── 5. Novas conquistas para as features ─────────────────────
INSERT OR IGNORE INTO conquistas_definicoes (codigo, titulo, descricao, icone, pontos, raridade) VALUES
  ('orcamentista',    'Orcamentista',          'Criou seu primeiro orçamento por categoria',         '📊', 25,  'COMUM'),
  ('controlador',     'Controlador',           'Manteve todos os orçamentos no verde por 1 mês',     '✅', 50,  'RARO'),
  ('automatico',      'Piloto Automático',     'Configurou sua primeira transação recorrente',        '🔄', 25,  'COMUM'),
  ('recorrente_pro',  'Rotina Financeira',     'Tem 5 ou mais recorrências ativas',                  '⚙️', 75,  'EPICO'),
  ('assinante',       'Membro Premium',        'Assinou o plano Premium ou Pro do VerdeMais',        '⭐', 100, 'EPICO'),
  ('projetor',        'Visionário Financeiro', 'Consultou a projeção financeira pela 1ª vez',        '🔮', 20,  'COMUM');
