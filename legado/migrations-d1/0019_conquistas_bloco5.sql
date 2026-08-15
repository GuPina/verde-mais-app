-- Migration 0019: Bloco 5 — 22 Novas Conquistas (Comportamento, Score, Análise)

INSERT OR IGNORE INTO conquistas_definicoes (codigo, titulo, descricao, icone, pontos, raridade) VALUES
  -- ── Comportamento ────────────────────────────────────────────────────────
  ('login_diario',        'Usuário Fiel',           'Fez login por 7 dias consecutivos',                           '🗓️', 30,  'raro'),
  ('perfil_completo',     'Perfil Completo',        'Preencheu todas as informações do perfil',                    '👤', 20,  'comum'),
  ('exportador_dados',    'Exportador de Dados',    'Exportou relatório em PDF ou Excel pela primeira vez',        '📤', 25,  'comum'),
  ('primeira_tag',        'Tagger',                 'Criou sua primeira tag de organização',                       '🏷️', 15,  'comum'),
  ('mestre_tags',         'Mestre das Tags',        'Classificou 50 despesas com tags',                            '🔖', 40,  'raro'),
  ('detector_assinatura', 'Caçador de Fantasmas',   'Detectou e cancelou pelo menos 1 assinatura fantasma',        '👻', 35,  'raro'),
  ('primeiro_orcamento',  'Planejador Iniciante',   'Criou o primeiro orçamento por categoria',                    '📝', 15,  'comum'),
  -- ── Score ────────────────────────────────────────────────────────────────
  ('saude_ferro',         'Saúde de Ferro',         'Atingiu Score de Saúde acima de 90 pontos',                   '💪', 100, 'lendario'),
  ('recuperacao',         'Grande Recuperação',     'Aumentou o Score de Saúde em 10+ pontos em um único mês',     '📈', 75,  'epico'),
  ('score_50',            'Na Média',               'Score de Saúde superou 50 pela primeira vez',                 '⭐', 20,  'comum'),
  ('score_70',            'Boa Saúde',              'Score de Saúde superou 70 pela primeira vez',                 '✨', 50,  'raro'),
  ('score_80',            'Excelente Saúde',        'Score de Saúde superou 80 pela primeira vez',                 '🌟', 75,  'epico'),
  -- ── Análise ──────────────────────────────────────────────────────────────
  ('curioso',             'Curioso',                'Consultou o relatório anual 3 ou mais vezes',                 '🔍', 25,  'comum'),
  ('analitico',           'Analítico',              'Usou o comparativo mensal 5 ou mais vezes',                   '🧠', 40,  'raro'),
  ('projecao_vista',      'Visionário',             'Consultou a Projeção Financeira pela primeira vez',           '🔮', 20,  'comum'),
  ('ia_power_user',       'IA Power User',          'Fez 20 ou mais perguntas ao Assistente VerdeMais',            '🤖', 50,  'raro'),
  -- ── Gamificação extra ────────────────────────────────────────────────────
  ('poupador_3m',         'Poupador Consistente',   'Taxa de poupança acima de 20% por 3 meses consecutivos',      '🐷', 80,  'epico'),
  ('zero_atraso_3m',      'Sem Atrasos',            'Nenhuma despesa atrasada por 3 meses consecutivos',           '⏰', 60,  'epico'),
  ('investidor_mensal',   'Aportador Mensal',       'Realizou aportes em investimentos por 3 meses seguidos',      '💰', 60,  'epico'),
  ('diversificador',      'Diversificador',         'Tem investimentos em 4 tipos diferentes ao mesmo tempo',      '🌐', 50,  'raro'),
  ('meta_rapida',         'Velocista',              'Concluiu uma meta financeira em menos de 30 dias',            '⚡', 40,  'raro'),
  ('super_reserva',       'Super Reserva',          'Atingiu 12 meses de reserva de emergência',                   '🛡️', 120, 'lendario');
