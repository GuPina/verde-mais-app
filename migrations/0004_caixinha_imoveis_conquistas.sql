-- Migration 0004: Novas funcionalidades
-- 1. Adicionar tipo 'caixinha' em investimentos
-- 2. Adicionar campos de entrada parcelada e evolução de obra em financiamentos
-- 3. Adicionar conquistas de imóveis, carros e bens
-- 4. Adicionar campo saldo_devedor_manual em emprestimos para respeitar valor informado pelo usuário

-- 1. Recriar tabela investimentos com 'caixinha' no CHECK
CREATE TABLE IF NOT EXISTS investimentos_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  nome TEXT NOT NULL,
  tipo TEXT NOT NULL CHECK(tipo IN ('tesouro_direto','cdb','lci','lca','acoes','fii','cripto','poupanca','caixinha','outros')),
  valor_investido REAL NOT NULL,
  rentabilidade_percentual REAL DEFAULT 0,
  valor_atual REAL DEFAULT 0,
  risco TEXT DEFAULT 'baixo' CHECK(risco IN ('baixo','medio','alto')),
  data_inicio DATE NOT NULL,
  data_vencimento DATE,
  instituicao TEXT,
  observacoes TEXT,
  -- Campos extras para Caixinha CDI
  percentual_cdi REAL DEFAULT NULL,
  cdi_atual REAL DEFAULT 13.65,  -- CDI atual (% ao ano), atualizável
  data_ultimo_calculo DATE DEFAULT NULL,
  data_criacao DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

INSERT INTO investimentos_new (id, user_id, nome, tipo, valor_investido, rentabilidade_percentual, valor_atual, risco, data_inicio, data_vencimento, instituicao, observacoes, data_criacao)
  SELECT id, user_id, nome, tipo, valor_investido, rentabilidade_percentual, valor_atual, risco, data_inicio, data_vencimento, instituicao, observacoes, data_criacao FROM investimentos;

DROP TABLE investimentos;
ALTER TABLE investimentos_new RENAME TO investimentos;
CREATE INDEX IF NOT EXISTS idx_investimentos_user_id ON investimentos(user_id);

-- 2. Adicionar campos de entrada parcelada e evolução de obra em financiamentos
ALTER TABLE financiamentos ADD COLUMN entrada_parcelada INTEGER DEFAULT 0;
ALTER TABLE financiamentos ADD COLUMN entrada_num_parcelas INTEGER DEFAULT 0;
ALTER TABLE financiamentos ADD COLUMN entrada_parcelas_pagas INTEGER DEFAULT 0;
ALTER TABLE financiamentos ADD COLUMN entrada_valor_parcela REAL DEFAULT 0;
ALTER TABLE financiamentos ADD COLUMN evolucao_obra_pct REAL DEFAULT 0;
ALTER TABLE financiamentos ADD COLUMN tipo_financiamento TEXT DEFAULT 'pronto' CHECK(tipo_financiamento IN ('pronto','planta','construcao','terreno','reforma'));

-- 3. Tabela de parcelas manuais de entrada
CREATE TABLE IF NOT EXISTS financiamento_entrada_parcelas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  financiamento_id INTEGER NOT NULL,
  numero INTEGER NOT NULL,
  valor REAL NOT NULL,
  vencimento DATE NOT NULL,
  status TEXT DEFAULT 'pendente' CHECK(status IN ('pendente','pago','atrasado')),
  data_pagamento DATE,
  observacoes TEXT,
  data_criacao DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (financiamento_id) REFERENCES financiamentos(id) ON DELETE CASCADE
);

-- 4. Novas conquistas: imóveis, carros e bens
INSERT OR IGNORE INTO conquistas_definicoes (codigo, titulo, descricao, icone, categoria, plano_requerido, pontos, raridade) VALUES
  ('primeiro_imovel', 'Proprietário!', 'Cadastrou seu primeiro financiamento imobiliário', '🏠', 'patrimonio', 'free', 50, 'epico'),
  ('quitou_10pct', 'Primeiros 10%', 'Quitou 10% do financiamento imobiliário', '🔑', 'patrimonio', 'free', 30, 'raro'),
  ('quitou_15pct', 'Conquistando Espaço', 'Quitou 15% do imóvel', '🏡', 'patrimonio', 'free', 40, 'raro'),
  ('quitou_20pct', 'Quinto do Imóvel', 'Quitou 20% do imóvel', '🏘️', 'patrimonio', 'premium', 50, 'raro'),
  ('quitou_30pct', 'Terço do Caminho', 'Quitou 30% do imóvel', '🌆', 'patrimonio', 'premium', 60, 'epico'),
  ('quitou_50pct', 'Metade sua!', 'Quitou 50% do imóvel', '🏙️', 'patrimonio', 'premium', 100, 'epico'),
  ('imovel_quitado', 'Imóvel Quitado!', 'Quitou completamente seu imóvel', '🎉', 'patrimonio', 'premium', 200, 'lendario'),
  ('primeiro_carro', 'De Rodas!', 'Cadastrou seu primeiro financiamento de veículo', '🚗', 'patrimonio', 'free', 30, 'raro'),
  ('carro_quitado', 'Carro Quitado!', 'Quitou completamente seu veículo', '🏎️', 'patrimonio', 'free', 100, 'epico'),
  ('sem_dividas_total', 'Livre de Tudo!', 'Quitou todos os empréstimos e financiamentos', '🦅', 'dividas', 'premium', 150, 'lendario'),
  ('investidor_cdi', 'Rendendo CDI', 'Criou uma Caixinha de investimento', '💰', 'investimentos', 'free', 20, 'comum'),
  ('poupador_dedicado', 'Poupador Dedicado', 'Tem mais de R$ 10.000 em investimentos', '💎', 'investimentos', 'premium', 60, 'epico');
