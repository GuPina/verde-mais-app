-- Migração 0037: Conquistas de Reserva por Níveis (3, 6, 9, 12 meses)
-- A conquista "Reserva Completa" agora é conquistada ao atingir 12 meses de cobertura

-- Adicionar nível 9 meses (se ainda não existir)
INSERT OR IGNORE INTO conquistas_definicoes (codigo, titulo, descricao, icone, pontos, raridade)
VALUES ('reserva_9_meses', 'Reserva: 9 Meses', 'Sua reserva cobre 9 meses de despesas — você está protegido!', '🛡️', 80, 'epico');

-- Atualizar "Reserva Completa" para representar 12 meses (nível lendário)
INSERT OR IGNORE INTO conquistas_definicoes (codigo, titulo, descricao, icone, pontos, raridade)
VALUES ('reserva_12_meses', 'Reserva Completa! 🏆', 'Reserva cobre 12 meses de despesas — independência total de emergências!', '💎', 100, 'lendario');

-- Atualizar pontos e raridade dos níveis intermediários para escala coerente
UPDATE conquistas_definicoes SET pontos = 40, raridade = 'raro'   WHERE codigo = 'reserva_1_mes';
UPDATE conquistas_definicoes SET pontos = 60, raridade = 'epico'  WHERE codigo = 'reserva_3_meses';
UPDATE conquistas_definicoes SET pontos = 80, raridade = 'epico'  WHERE codigo = 'reserva_6_meses';
