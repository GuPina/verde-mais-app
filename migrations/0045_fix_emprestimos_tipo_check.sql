-- Migration 0045: Adicionar novos tipos ao CHECK constraint de emprestimos
-- O CHECK constraint original não incluía 'imovel', 'imovel_comercial', 'rural'
-- SQLite não suporta ALTER TABLE para modificar CHECK constraints
-- Solução: recriar a tabela com o constraint correto

-- 1. Criar tabela temporária com constraint correto
CREATE TABLE IF NOT EXISTS emprestimos_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  descricao TEXT NOT NULL,
  tipo TEXT DEFAULT 'pessoal' CHECK(tipo IN ('pessoal', 'consignado', 'veiculo', 'estudantil', 'microempresa', 'amigos_familia', 'imovel', 'imovel_comercial', 'rural', 'outros')),
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
  data_primeira_parcela TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- 2. Copiar dados existentes (mapeando tipos antigos para novos se necessário)
INSERT INTO emprestimos_new 
SELECT * FROM emprestimos;

-- 3. Remover tabela antiga e renomear a nova
DROP TABLE emprestimos;
ALTER TABLE emprestimos_new RENAME TO emprestimos;

-- 4. Recriar índices se existirem
CREATE INDEX IF NOT EXISTS idx_emprestimos_user_id ON emprestimos(user_id);
CREATE INDEX IF NOT EXISTS idx_emprestimos_status ON emprestimos(status);
