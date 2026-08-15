-- VerdeMais v2.6.0 — Reserva de Emergência, Amortização, Conquistas expandidas

-- 1. Tabela de Reserva de Emergência
CREATE TABLE IF NOT EXISTS reserva_emergencia (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  nome TEXT NOT NULL DEFAULT 'Reserva de Emergência',
  objetivo_meses INTEGER NOT NULL DEFAULT 6,
  valor_atual REAL NOT NULL DEFAULT 0,
  data_atualizacao TEXT,
  observacoes TEXT,
  data_criacao TEXT DEFAULT (datetime('now'))
);

-- 2. Campo data_primeira_parcela em emprestimos (para casos como vencimento em mês diferente da contratação)
ALTER TABLE emprestimos ADD COLUMN data_primeira_parcela TEXT;

-- 3. Tipo genérico em financiamentos (já existe tipo_imovel, adicionar campo tipo_bem para outros)
ALTER TABLE financiamentos ADD COLUMN tipo_bem TEXT DEFAULT 'imovel';

-- 4. Novas conquistas — Investimentos por tipo
INSERT OR IGNORE INTO conquistas_definicoes (codigo, titulo, descricao, icone, pontos, raridade) VALUES
  ('investidor_acoes', 'Investidor da Bolsa', 'Cadastrou um investimento em ações', '📊', 30, 'raro'),
  ('investidor_fii', 'Renda Passiva Imobiliária', 'Cadastrou um FII', '🏢', 30, 'raro'),
  ('investidor_cripto', 'Crypto Holder', 'Cadastrou criptomoedas', '₿', 25, 'raro'),
  ('investidor_tesouro', 'Tesouro Nacional', 'Investiu no Tesouro Direto', '🏛️', 25, 'comum'),
  ('investidor_cdb', 'Renda Fixa Sólida', 'Cadastrou um CDB', '🏦', 20, 'comum'),
  ('investidor_diversificado', 'Portfólio Diversificado', 'Tem 3 tipos diferentes de investimentos', '🎯', 50, 'épico'),
  ('reserva_iniciada', 'Reserva Iniciada', 'Criou sua reserva de emergência', '🛡️', 30, 'raro'),
  ('reserva_1_mes', 'Reserva: 1 Mês', 'Reserva cobre 1 mês de despesas', '🛡️', 40, 'raro'),
  ('reserva_3_meses', 'Reserva: 3 Meses', 'Reserva cobre 3 meses — bem protegido!', '🛡️', 60, 'épico'),
  ('reserva_6_meses', 'Reserva: 6 Meses', 'Reserva cobre 6 meses — especialista!', '🛡️', 100, 'lendário'),
  ('reserva_completa', 'Reserva Completa', 'Meta de reserva atingida!', '🏆', 150, 'lendário'),
  ('meta_casa', 'Sonho da Casa Própria', 'Meta de imóvel criada', '🏠', 30, 'raro'),
  ('meta_carro', 'Meta do Carro', 'Meta de veículo criada', '🚗', 25, 'comum'),
  ('meta_viagem', 'Explorador', 'Meta de viagem criada', '✈️', 20, 'comum'),
  ('meta_educacao', 'Investindo no Futuro', 'Meta de educação criada', '📚', 25, 'comum'),
  ('meta_liberdade', 'Liberdade Financeira', 'Meta de liberdade financeira criada', '🗽', 100, 'lendário'),
  ('meta_aposentadoria', 'Previdência Pessoal', 'Meta de aposentadoria criada', '👴', 80, 'épico'),
  ('amortizou', 'Pagou a Mais', 'Realizou uma amortização extraordinária', '⚡', 40, 'raro'),
  ('financiamento_veiculo', 'Financiou um Veículo', 'Tem financiamento de veículo', '🚗', 20, 'comum'),
  ('financiamento_outros', 'Outros Financiamentos', 'Cadastrou financiamento de outros bens', '📋', 20, 'comum');

-- 5. Índice para reserva
CREATE INDEX IF NOT EXISTS idx_reserva_user ON reserva_emergencia(user_id);
