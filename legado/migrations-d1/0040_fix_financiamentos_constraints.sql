-- Migration 0040: Amplia CHECK constraint de tipo_imovel em financiamentos
-- Adiciona 'veiculo' e 'outros' como valores validos

ALTER TABLE financiamentos RENAME TO financiamentos_bkp_0040;

CREATE TABLE financiamentos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  descricao TEXT NOT NULL,
  tipo_imovel TEXT DEFAULT 'residencial'
    CHECK(tipo_imovel IN ('residencial','comercial','terreno','rural','veiculo','outros')),
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
  sistema_amortizacao TEXT DEFAULT 'price'
    CHECK(sistema_amortizacao IN ('price','sac','sacre')),
  banco TEXT,
  contrato TEXT,
  indexador TEXT DEFAULT 'prefixado'
    CHECK(indexador IN ('prefixado','ipca','igpm','tr','cdi')),
  status TEXT DEFAULT 'ativo'
    CHECK(status IN ('ativo','quitado','em_atraso')),
  observacoes TEXT,
  data_criacao DATETIME DEFAULT CURRENT_TIMESTAMP,
  entrada_parcelada INTEGER DEFAULT 0,
  entrada_num_parcelas INTEGER DEFAULT 0,
  entrada_parcelas_pagas INTEGER DEFAULT 0,
  entrada_valor_parcela REAL DEFAULT 0,
  evolucao_obra_pct REAL DEFAULT 0,
  tipo_financiamento TEXT DEFAULT 'pronto'
    CHECK(tipo_financiamento IN ('pronto','planta','construcao','terreno','reforma','veiculo','outros')),
  tipo_bem TEXT DEFAULT 'imovel',
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

INSERT INTO financiamentos SELECT
  id, user_id, descricao,
  CASE
    WHEN tipo_imovel IN ('residencial','comercial','terreno','rural') THEN tipo_imovel
    ELSE 'residencial'
  END,
  valor_imovel, valor_financiado, valor_entrada,
  taxa_juros_anual, taxa_juros_mensal, numero_parcelas, parcelas_pagas, valor_parcela,
  saldo_devedor, data_inicio, data_previsao_fim, sistema_amortizacao, banco, contrato,
  indexador, status, observacoes, data_criacao,
  COALESCE(entrada_parcelada, 0),
  COALESCE(entrada_num_parcelas, 0),
  COALESCE(entrada_parcelas_pagas, 0),
  COALESCE(entrada_valor_parcela, 0),
  COALESCE(evolucao_obra_pct, 0),
  COALESCE(tipo_financiamento, 'pronto'),
  COALESCE(tipo_bem, 'imovel')
FROM financiamentos_bkp_0040;

DROP TABLE financiamentos_bkp_0040;
