-- Conquistas faltantes: reserva_3_meses, reserva_6_meses, reserva_completa,
-- meta_liberdade, meta_aposentadoria, investidor_diversificado, poupador, disciplinado,
-- analista, milionario, sem_dividas_total

INSERT OR IGNORE INTO conquistas_definicoes (codigo, titulo, descricao, icone, pontos, raridade) VALUES
  ('reserva_3_meses',      'Reserva: 3 Meses',          'Reserva cobre 3 meses de despesas',              '🛡️', 60,  'epico'),
  ('reserva_6_meses',      'Reserva: 6 Meses',          'Reserva cobre 6 meses de despesas',              '🦺', 80,  'epico'),
  ('reserva_completa',     'Reserva Completa!',          'Atingiu 100% da meta da reserva',               '🏰', 100, 'lendario'),
  ('meta_liberdade',       'Liberdade Financeira',       'Meta de liberdade financeira criada',            '🦅', 40, 'raro'),
  ('meta_aposentadoria',   'Aposentadoria Planejada',    'Meta de aposentadoria criada',                   '🌴', 40, 'raro'),
  ('investidor_diversificado','Portfólio Diversificado', 'Tem 3 tipos diferentes de investimentos',        '🎯', 50, 'epico'),
  ('poupador',             'Poupador',                   'Poupou mais de 20% da renda em um mês',          '🐷', 40, 'raro'),
  ('disciplinado',         'Disciplinado',               'Pagou 10 despesas em um mesmo mês',              '💪', 30, 'comum'),
  ('analista',             'Analista Financeiro',        'Acessou o relatório anual',                      '📈', 25, 'comum'),
  ('milionario',           'Rumo ao Milhão',             'Acumula mais de R$ 100.000 investidos',          '💰', 100, 'lendario');
