-- VerdeMais - Migration 002: Novas funcionalidades
-- Cartões, Financiamentos, Empréstimos, Lembretes, Conquistas, Perfil

-- Atualizar tabela users com campos de perfil
ALTER TABLE users ADD COLUMN profissao TEXT;
ALTER TABLE users ADD COLUMN situacao_emprego TEXT DEFAULT 'empregado';
ALTER TABLE users ADD COLUMN salario_mensal REAL DEFAULT 0;
ALTER TABLE users ADD COLUMN outras_rendas REAL DEFAULT 0;
ALTER TABLE users ADD COLUMN dependentes INTEGER DEFAULT 0;
ALTER TABLE users ADD COLUMN estado_civil TEXT DEFAULT 'solteiro';
ALTER TABLE users ADD COLUMN cidade TEXT;
ALTER TABLE users ADD COLUMN estado TEXT;
ALTER TABLE users ADD COLUMN perfil_completo INTEGER DEFAULT 0;
ALTER TABLE users ADD COLUMN onboarding_step INTEGER DEFAULT 0;

-- Tabela de Cartões de Crédito
CREATE TABLE IF NOT EXISTS cartoes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  nome TEXT NOT NULL,
  bandeira TEXT NOT NULL CHECK(bandeira IN ('visa', 'mastercard', 'elo', 'amex', 'hipercard', 'outros')),
  banco TEXT NOT NULL,
  limite_total REAL NOT NULL DEFAULT 0,
  limite_disponivel REAL DEFAULT 0,
  dia_vencimento INTEGER NOT NULL,
  dia_fechamento INTEGER NOT NULL,
  cor TEXT DEFAULT '#2FBF71',
  ativo INTEGER DEFAULT 1,
  ultimos_digitos TEXT,
  data_criacao DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Tabela de Compras no Cartão (lançamentos)
CREATE TABLE IF NOT EXISTS cartao_lancamentos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  cartao_id INTEGER NOT NULL,
  descricao TEXT NOT NULL,
  categoria TEXT NOT NULL,
  valor_total REAL NOT NULL,
  numero_parcelas INTEGER DEFAULT 1,
  parcela_atual INTEGER DEFAULT 1,
  data_compra DATE NOT NULL,
  data_fatura DATE NOT NULL,
  status TEXT DEFAULT 'pendente' CHECK(status IN ('pendente', 'pago', 'contestado')),
  observacoes TEXT,
  data_criacao DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (cartao_id) REFERENCES cartoes(id) ON DELETE CASCADE
);

-- Atualizar tabela despesas com campo cartao_id
ALTER TABLE despesas ADD COLUMN cartao_id INTEGER REFERENCES cartoes(id);
ALTER TABLE despesas ADD COLUMN meio_pagamento TEXT DEFAULT 'dinheiro' CHECK(meio_pagamento IN ('dinheiro', 'cartao_credito', 'cartao_debito', 'pix', 'transferencia', 'boleto', 'outros'));

-- Tabela de Financiamentos Imobiliários
CREATE TABLE IF NOT EXISTS financiamentos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  descricao TEXT NOT NULL,
  tipo_imovel TEXT DEFAULT 'residencial' CHECK(tipo_imovel IN ('residencial', 'comercial', 'terreno', 'rural')),
  valor_imovel REAL NOT NULL,
  valor_financiado REAL NOT NULL,
  valor_entrada REAL DEFAULT 0,
  taxa_juros_anual REAL NOT NULL,
  taxa_juros_mensal REAL NOT NULL,
  numero_parcelas INTEGER NOT NULL,
  parcelas_pagas INTEGER DEFAULT 0,
  valor_parcela REAL NOT NULL,
  saldo_devedor REAL NOT NULL,
  data_inicio DATE NOT NULL,
  data_previsao_fim DATE,
  sistema_amortizacao TEXT DEFAULT 'price' CHECK(sistema_amortizacao IN ('price', 'sac', 'sacre')),
  banco TEXT,
  contrato TEXT,
  indexador TEXT DEFAULT 'prefixado' CHECK(indexador IN ('prefixado', 'ipca', 'igpm', 'tr', 'cdi')),
  status TEXT DEFAULT 'ativo' CHECK(status IN ('ativo', 'quitado', 'em_atraso')),
  observacoes TEXT,
  data_criacao DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Tabela de Empréstimos
CREATE TABLE IF NOT EXISTS emprestimos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  descricao TEXT NOT NULL,
  tipo TEXT DEFAULT 'pessoal' CHECK(tipo IN ('pessoal', 'consignado', 'veiculo', 'estudantil', 'microempresa', 'amigos_familia', 'outros')),
  valor_original REAL NOT NULL,
  valor_pago REAL DEFAULT 0,
  saldo_devedor REAL NOT NULL,
  taxa_juros_mensal REAL NOT NULL,
  taxa_juros_anual REAL NOT NULL,
  numero_parcelas INTEGER NOT NULL,
  parcelas_pagas INTEGER DEFAULT 0,
  valor_parcela REAL NOT NULL,
  data_inicio DATE NOT NULL,
  data_previsao_fim DATE,
  dia_vencimento INTEGER,
  credor TEXT,
  status TEXT DEFAULT 'ativo' CHECK(status IN ('ativo', 'quitado', 'em_atraso', 'negociado')),
  observacoes TEXT,
  data_criacao DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Tabela de Lembretes / Contas Recorrentes
CREATE TABLE IF NOT EXISTS lembretes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  titulo TEXT NOT NULL,
  descricao TEXT,
  tipo TEXT DEFAULT 'conta' CHECK(tipo IN ('conta', 'imposto', 'mensalidade', 'seguro', 'aluguel', 'investimento', 'outros')),
  valor_estimado REAL DEFAULT 0,
  dia_vencimento INTEGER,
  frequencia TEXT DEFAULT 'mensal' CHECK(frequencia IN ('semanal', 'quinzenal', 'mensal', 'bimestral', 'trimestral', 'semestral', 'anual')),
  ativo INTEGER DEFAULT 1,
  -- Controle de recebimento/pagamento do mês atual
  ultimo_recebimento DATE,
  proximo_vencimento DATE,
  status_mes TEXT DEFAULT 'aguardando' CHECK(status_mes IN ('aguardando', 'recebido', 'pago', 'ignorado')),
  alertar_dias_antes INTEGER DEFAULT 3,
  data_criacao DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Tabela de Histórico de Lembretes
CREATE TABLE IF NOT EXISTS lembretes_historico (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lembrete_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  data_referencia DATE NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('recebido', 'pago', 'ignorado')),
  valor_real REAL DEFAULT 0,
  observacoes TEXT,
  data_registro DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (lembrete_id) REFERENCES lembretes(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Tabela de Conquistas disponíveis
CREATE TABLE IF NOT EXISTS conquistas_definicoes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  codigo TEXT UNIQUE NOT NULL,
  titulo TEXT NOT NULL,
  descricao TEXT NOT NULL,
  icone TEXT DEFAULT '🏆',
  categoria TEXT DEFAULT 'geral',
  plano_requerido TEXT DEFAULT 'free',
  pontos INTEGER DEFAULT 10,
  raridade TEXT DEFAULT 'comum' CHECK(raridade IN ('comum', 'raro', 'epico', 'lendario'))
);

-- Tabela de Conquistas do Usuário
CREATE TABLE IF NOT EXISTS conquistas_usuario (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  conquista_codigo TEXT NOT NULL,
  data_conquista DATETIME DEFAULT CURRENT_TIMESTAMP,
  visualizado INTEGER DEFAULT 0,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE(user_id, conquista_codigo)
);

-- Tabela de Análises IA (cache de insights)
CREATE TABLE IF NOT EXISTS ia_insights (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  tipo TEXT NOT NULL,
  titulo TEXT NOT NULL,
  conteudo TEXT NOT NULL,
  prioridade TEXT DEFAULT 'media' CHECK(prioridade IN ('alta', 'media', 'baixa')),
  categoria TEXT DEFAULT 'geral',
  lido INTEGER DEFAULT 0,
  data_criacao DATETIME DEFAULT CURRENT_TIMESTAMP,
  valido_ate DATETIME,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Índices adicionais
CREATE INDEX IF NOT EXISTS idx_cartoes_user_id ON cartoes(user_id);
CREATE INDEX IF NOT EXISTS idx_cartao_lancamentos_user ON cartao_lancamentos(user_id);
CREATE INDEX IF NOT EXISTS idx_cartao_lancamentos_cartao ON cartao_lancamentos(cartao_id);
CREATE INDEX IF NOT EXISTS idx_financiamentos_user ON financiamentos(user_id);
CREATE INDEX IF NOT EXISTS idx_emprestimos_user ON emprestimos(user_id);
CREATE INDEX IF NOT EXISTS idx_lembretes_user ON lembretes(user_id);
CREATE INDEX IF NOT EXISTS idx_conquistas_user ON conquistas_usuario(user_id);
CREATE INDEX IF NOT EXISTS idx_ia_insights_user ON ia_insights(user_id);

-- Seed das conquistas disponíveis
INSERT OR IGNORE INTO conquistas_definicoes (codigo, titulo, descricao, icone, categoria, plano_requerido, pontos, raridade) VALUES
  ('primeira_receita', 'Primeira Receita', 'Registrou sua primeira receita', '💰', 'financas', 'free', 10, 'comum'),
  ('sonhador', 'Sonhador', 'Criou sua primeira meta financeira', '🎯', 'metas', 'free', 15, 'comum'),
  ('organizador', 'Organizador', 'Registrou sua primeira despesa', '📋', 'financas', 'free', 10, 'comum'),
  ('investidor', 'Investidor', 'Registrou seu primeiro investimento', '📈', 'investimentos', 'free', 20, 'comum'),
  ('planejador', 'Planejador', 'Completou o perfil financeiro', '🧠', 'perfil', 'free', 25, 'raro'),
  ('carteirinha', 'Carteirinha', 'Cadastrou seu primeiro cartão', '💳', 'cartoes', 'free', 15, 'comum'),
  ('disciplinado', 'Disciplinado', 'Registrou despesas por 7 dias seguidos', '🔥', 'habitos', 'free', 30, 'raro'),
  ('meta_concluida', 'Conquistador', 'Concluiu sua primeira meta financeira', '🏆', 'metas', 'free', 50, 'epico'),
  ('sem_dividas', 'Livre de Dívidas', 'Quitou um empréstimo ou financiamento', '🦅', 'dividas', 'free', 75, 'epico'),
  ('poupador', 'Poupador', 'Poupou mais de 20% da renda em um mês', '🐷', 'financas', 'premium', 40, 'raro'),
  ('milionario', 'Rumo ao Milhão', 'Patrimônio total atingiu R$ 100.000', '💎', 'patrimonio', 'premium', 100, 'lendario'),
  ('cartao_zero', 'Fatura Zero', 'Pagou a fatura completa do cartão', '✅', 'cartoes', 'free', 20, 'comum'),
  ('lembrete_mestre', 'Mestre dos Lembretes', 'Registrou 5 contas no mesmo mês', '⏰', 'lembretes', 'free', 20, 'comum'),
  ('analista', 'Analista Financeiro', 'Consultou a análise IA 10 vezes', '🤖', 'ia', 'premium', 30, 'raro');
