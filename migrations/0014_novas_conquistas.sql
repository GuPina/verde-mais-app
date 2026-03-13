-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 0014 — Novas Conquistas (Bloco 4 + integração entre módulos)
-- ═══════════════════════════════════════════════════════════════════════════
INSERT OR IGNORE INTO conquistas_definicoes (codigo, titulo, descricao, icone, pontos, raridade) VALUES
  -- Grupo: Hábitos Sustentados
  ('saldo_verde_3m',      'Saldo Verde',            'Manteve saldo positivo por 3 meses consecutivos',      '💚', 50,  'raro'),
  ('zero_divida_cartao',  'Zero Dívida no Cartão',  'Fatura zerada por 3 meses consecutivos',               '💳', 60,  'epico'),
  ('barreira_10k',        'Barreira dos 10 Mil',    'Acumulou R$ 10.000 em patrimônio',                     '🏦', 80,  'epico'),
  ('barreira_50k',        'Meio Caminho do Milhão', 'Acumulou R$ 50.000 em patrimônio',                     '💰', 150, 'lendario'),
  ('realizador',          'Realizador',             'Concluiu 5 metas financeiras',                         '🏆', 150, 'lendario'),
  -- Grupo: Investidor Avançado
  ('aporta_todo_mes',     'Investidor Consistente', 'Realizou aportes por 3 meses seguidos',                '📈', 60,  'epico'),
  ('carteira_diversa',    'Carteira Diversificada', 'Tem investimentos em 5 ou mais categorias diferentes', '🌐', 100, 'epico'),
  -- Grupo: Planejamento
  ('orcamento_completo',  'Planejador Mestre',      'Configurou orçamentos para todas as categorias',       '📊', 40,  'raro'),
  ('regra_3meses',        'Regra na Veia',          'Score 50/30/20 acima de 70 por 3 meses seguidos',      '⚖️', 100, 'epico'),
  ('desafio_trimestre',   'Quarteirão Completo',    'Completou as primeiras 13 semanas do Desafio 52',      '🗓️', 50,  'raro'),
  -- Grupo: Dívidas
  ('livre_emprestimo',    'Crédito Livre',          'Quitou todos os empréstimos pessoais',                 '🔓', 75,  'epico'),
  ('50pct_financiamento', 'Metade da Jornada',      'Quitou 50% do financiamento imobiliário',              '🏗️', 100, 'epico'),
  -- Grupo: Reservas
  ('reserva_12_meses',    'Fortaleza Financeira',   'Reserva cobre 12+ meses de despesas',                  '🏰', 200, 'lendario'),
  ('todas_reservas_ok',   'Proteção Total',         'Todas as reservas especializadas completadas',         '🛡️', 150, 'lendario'),
  -- Grupo: Comportamental
  ('sem_gastos_luxo',     'Consciência Financeira', 'Mês sem gastos em Lazer/Entretenimento acima de R$500','🧘', 40,  'raro'),
  ('renda_extra',         'Multitalento',           'Registrou receitas de 3 fontes diferentes no mês',     '💼', 35,  'raro'),
  ('sem_atraso',          'Pontualidade Total',     '3 meses sem despesas vencidas sem pagar',              '⏰', 45,  'raro'),
  -- Grupo: Integrações v3.0
  ('detector_expert',     'Caçador de Fantasmas',   'Cancelou 5 assinaturas via Detector',                  '👻', 80,  'epico'),
  ('amortizador_serie',   'Mago da Amortização',    'Fez 5 simulações de amortização',                      '🧮', 50,  'raro'),
  ('desafio_52_5meses',   'Persistência',           'Completou 22 semanas do Desafio 52',                   '💪', 60,  'epico'),
  -- Grupo: Patrimônio
  ('primeiro_milhao',     'O Primeiro Milhão',      'Patrimônio líquido atingiu R$ 1.000.000',              '💎', 1000,'lendario'),
  ('crescimento_anual',   'Crescimento Anual',      'Patrimônio cresceu mais de 20% em 12 meses',           '📊', 120, 'epico');

