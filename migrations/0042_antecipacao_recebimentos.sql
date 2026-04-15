-- Migration 0042: Sistema de Antecipação de Contas e Controle de Recebimentos Parcelados

-- Tabela de contas a antecipar (simula antecipação de pagamentos futuros)
CREATE TABLE IF NOT EXISTS antecipacoes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  descricao TEXT NOT NULL,
  valor_total REAL NOT NULL,
  data_vencimento_original DATE NOT NULL,
  data_antecipacao DATE NOT NULL,
  economia_juros REAL DEFAULT 0,
  status TEXT DEFAULT 'pendente' CHECK(status IN ('pendente','antecipada','cancelada')),
  tipo TEXT DEFAULT 'conta' CHECK(tipo IN ('conta','parcela','fatura','emprestimo','financiamento')),
  referencia_id INTEGER,           -- id de despesa, emprestimo ou financiamento original
  referencia_tipo TEXT,            -- 'despesa', 'emprestimo', 'financiamento'
  observacoes TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Tabela de controle de recebimentos parcelados (ex: R$50k recebido em parcelas)
CREATE TABLE IF NOT EXISTS recebimentos_parcelados (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  descricao TEXT NOT NULL,
  valor_total REAL NOT NULL,
  numero_parcelas INTEGER NOT NULL DEFAULT 1,
  valor_parcela REAL NOT NULL,
  data_inicio DATE NOT NULL,
  data_fim DATE,
  tipo TEXT DEFAULT 'venda' CHECK(tipo IN ('venda','servico','aluguel','emprestimo_a_receber','contrato','outros')),
  pagador TEXT,                    -- nome de quem paga
  status TEXT DEFAULT 'ativo' CHECK(status IN ('ativo','concluido','cancelado','em_atraso')),
  observacoes TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Parcelas de cada recebimento
CREATE TABLE IF NOT EXISTS recebimentos_parcelas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  recebimento_id INTEGER NOT NULL REFERENCES recebimentos_parcelados(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  numero_parcela INTEGER NOT NULL,
  valor REAL NOT NULL,
  data_prevista DATE NOT NULL,
  data_recebimento DATE,           -- data em que realmente recebeu
  status TEXT DEFAULT 'pendente' CHECK(status IN ('pendente','recebida','em_atraso','cancelada')),
  observacoes TEXT,
  receita_id INTEGER REFERENCES receitas(id) ON DELETE SET NULL  -- receita criada ao receber
);

-- Índices
CREATE INDEX IF NOT EXISTS idx_antecipacoes_user ON antecipacoes(user_id, status);
CREATE INDEX IF NOT EXISTS idx_rec_parcelados_user ON recebimentos_parcelados(user_id, status);
CREATE INDEX IF NOT EXISTS idx_rec_parcelas_rec ON recebimentos_parcelas(recebimento_id);
CREATE INDEX IF NOT EXISTS idx_rec_parcelas_user ON recebimentos_parcelas(user_id, status);

-- Conquistas para antecipação
INSERT OR IGNORE INTO conquistas_definicoes (codigo, titulo, descricao, icone, pontos, categoria) VALUES
  ('primeira_antecipacao', '⚡ Antecipador', 'Antecipou o pagamento de uma conta pela primeira vez', '⚡', 40, 'dividas'),
  ('3_antecipacoes', '🔥 Mestre da Antecipação', 'Antecipou 3 contas ou mais', '🔥', 80, 'dividas'),
  ('primeiro_recebimento_parcelado', '📋 Controlador', 'Cadastrou seu primeiro recebimento parcelado', '📋', 30, 'receitas'),
  ('recebimento_concluido', '🎉 Recebeu Tudo', 'Concluiu o recebimento de todas as parcelas de um acordo', '🎉', 100, 'receitas');
