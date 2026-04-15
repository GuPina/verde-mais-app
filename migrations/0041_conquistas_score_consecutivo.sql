-- Migration 0041: Novas conquistas de Score > 80 por meses consecutivos
-- Adiciona conquistas de 1 e 2 meses consecutivos com score > 80

INSERT OR IGNORE INTO conquistas_definicoes (codigo, titulo, descricao, icone, pontos, categoria) VALUES
  ('score_80_1m', '📈 No Caminho Certo', 'Manteve score acima de 80 por 1 mês', '📈', 30, 'saude'),
  ('score_80_2m', '🔥 Em Chama', 'Manteve score acima de 80 por 2 meses consecutivos', '🔥', 50, 'saude'),
  ('score_80_3m', '💎 Consistência Premium', 'Manteve score acima de 80 por 3 meses consecutivos', '💎', 100, 'saude'),
  ('viu_projecao', '🔭 Olho no Futuro', 'Visualizou projeção de investimentos', '🔭', 15, 'investimentos'),
  ('aporte_recorrente', '🔄 Investidor Disciplinado', 'Fez aportes em 3 meses consecutivos', '🔄', 60, 'investimentos'),
  ('quita_divida', '🏆 Quitador', 'Quitou uma dívida ou empréstimo', '🏆', 80, 'dividas'),
  ('sem_cartao_devedor', '💳 Cartão em Dia', 'Ficou 3 meses sem dívida no cartão de crédito', '💳', 70, 'cartoes'),
  ('orcamento_cumprido', '✅ Orçamento Cumprido', 'Cumpriu o orçamento mensal sem ultrapassar', '✅', 50, 'orcamento'),
  ('3_metas_meta_concluidas', '🎯 Realizador', 'Concluiu 3 metas financeiras', '🎯', 90, 'metas');
