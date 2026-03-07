-- VerdeMais - Schema Inicial
-- Tabela de usuários
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  senha TEXT NOT NULL,
  plano TEXT DEFAULT 'free' CHECK(plano IN ('free', 'premium', 'pro')),
  perfil_investidor TEXT DEFAULT 'moderado' CHECK(perfil_investidor IN ('conservador', 'moderado', 'arrojado')),
  avatar_color TEXT DEFAULT '#2FBF71',
  data_criacao DATETIME DEFAULT CURRENT_TIMESTAMP,
  ultimo_acesso DATETIME
);

-- Tabela de receitas
CREATE TABLE IF NOT EXISTS receitas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  descricao TEXT NOT NULL,
  data DATE NOT NULL,
  categoria TEXT NOT NULL,
  valor REAL NOT NULL,
  recorrente INTEGER DEFAULT 0,
  frequencia TEXT DEFAULT NULL,
  observacoes TEXT,
  data_criacao DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Tabela de despesas
CREATE TABLE IF NOT EXISTS despesas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  descricao TEXT NOT NULL,
  data DATE NOT NULL,
  categoria TEXT NOT NULL,
  subcategoria TEXT,
  valor REAL NOT NULL,
  parcelado INTEGER DEFAULT 0,
  numero_parcelas INTEGER DEFAULT 1,
  parcela_atual INTEGER DEFAULT 1,
  status TEXT DEFAULT 'pendente' CHECK(status IN ('pago', 'pendente')),
  fixa_ou_variavel TEXT DEFAULT 'variavel' CHECK(fixa_ou_variavel IN ('fixa', 'variavel')),
  recorrente INTEGER DEFAULT 0,
  vencimento DATE,
  observacoes TEXT,
  data_criacao DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Tabela de metas
CREATE TABLE IF NOT EXISTS metas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  nome TEXT NOT NULL,
  descricao TEXT,
  valor_objetivo REAL NOT NULL,
  valor_atual REAL DEFAULT 0,
  data_meta DATE NOT NULL,
  categoria TEXT DEFAULT 'economia',
  cor TEXT DEFAULT '#2FBF71',
  icone TEXT DEFAULT 'piggy-bank',
  status TEXT DEFAULT 'ativa' CHECK(status IN ('ativa', 'concluida', 'cancelada')),
  data_criacao DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Tabela de investimentos
CREATE TABLE IF NOT EXISTS investimentos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  nome TEXT NOT NULL,
  tipo TEXT NOT NULL CHECK(tipo IN ('tesouro_direto', 'cdb', 'lci', 'lca', 'acoes', 'fii', 'cripto', 'poupanca', 'outros')),
  valor_investido REAL NOT NULL,
  rentabilidade_percentual REAL DEFAULT 0,
  valor_atual REAL DEFAULT 0,
  risco TEXT DEFAULT 'baixo' CHECK(risco IN ('baixo', 'medio', 'alto')),
  data_inicio DATE NOT NULL,
  data_vencimento DATE,
  instituicao TEXT,
  observacoes TEXT,
  data_criacao DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Tabela de assinaturas/planos
CREATE TABLE IF NOT EXISTS assinaturas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL UNIQUE,
  plano TEXT NOT NULL DEFAULT 'free' CHECK(plano IN ('free', 'premium', 'pro')),
  status TEXT DEFAULT 'ativo' CHECK(status IN ('ativo', 'inativo', 'cancelado', 'trial')),
  data_inicio DATETIME DEFAULT CURRENT_TIMESTAMP,
  data_fim DATETIME,
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Tabela de sessões (tokens de autenticação)
CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  token TEXT UNIQUE NOT NULL,
  expires_at DATETIME NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Índices para performance
CREATE INDEX IF NOT EXISTS idx_receitas_user_id ON receitas(user_id);
CREATE INDEX IF NOT EXISTS idx_receitas_data ON receitas(data);
CREATE INDEX IF NOT EXISTS idx_despesas_user_id ON despesas(user_id);
CREATE INDEX IF NOT EXISTS idx_despesas_data ON despesas(data);
CREATE INDEX IF NOT EXISTS idx_despesas_status ON despesas(status);
CREATE INDEX IF NOT EXISTS idx_metas_user_id ON metas(user_id);
CREATE INDEX IF NOT EXISTS idx_investimentos_user_id ON investimentos(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token);
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
