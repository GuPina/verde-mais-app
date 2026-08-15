-- ============================================================
-- Migration 0034: Novas Conquistas — coerentes com funcionalidades reais
-- ============================================================

-- ── CATEGORIA: CONSISTÊNCIA (hábito financeiro) ─────────────────────────────

-- Lançou despesas por 7 dias seguidos
INSERT OR IGNORE INTO conquistas_definicoes (codigo, titulo, descricao, icone, pontos, raridade, categoria) VALUES
('7_dias_lancando', 'Semana Registrada', 'Registrou despesas ou receitas por 7 dias seguidos', '📅', 30, 'raro', 'habito');

-- Lançou despesas por 30 dias seguidos
INSERT OR IGNORE INTO conquistas_definicoes (codigo, titulo, descricao, icone, pontos, raridade, categoria) VALUES
('30_dias_lancando', 'Mês Completo', 'Registrou lançamentos por 30 dias consecutivos — hábito consolidado!', '🗓️', 80, 'epico', 'habito');

-- Entrou no app por 5 dias seguidos
INSERT OR IGNORE INTO conquistas_definicoes (codigo, titulo, descricao, icone, pontos, raridade, categoria) VALUES
('acesso_5_dias', 'Presença Constante', 'Acessou o VerdeMais por 5 dias seguidos', '🔥', 20, 'comum', 'habito');

-- Registrou pelo menos 1 lançamento em 3 meses diferentes
INSERT OR IGNORE INTO conquistas_definicoes (codigo, titulo, descricao, icone, pontos, raridade, categoria) VALUES
('3_meses_ativos', 'Trimestre Ativo', 'Manteve o controle financeiro por 3 meses diferentes', '📆', 50, 'raro', 'habito');

-- 6 meses com ao menos 1 receita cadastrada
INSERT OR IGNORE INTO conquistas_definicoes (codigo, titulo, descricao, icone, pontos, raridade, categoria) VALUES
('6_meses_receita', 'Renda Monitorada', 'Cadastrou receita em pelo menos 6 meses diferentes', '💹', 80, 'epico', 'habito');

-- ── CATEGORIA: DESPESAS ─────────────────────────────────────────────────────

-- Pagou 10 despesas no status "pago"
INSERT OR IGNORE INTO conquistas_definicoes (codigo, titulo, descricao, icone, pontos, raridade, categoria) VALUES
('10_despesas_pagas', 'Comprometido', 'Marcou 10 despesas como pagas — sem deixar dívida', '✅', 25, 'comum', 'despesas');

-- Pagou 50 despesas
INSERT OR IGNORE INTO conquistas_definicoes (codigo, titulo, descricao, icone, pontos, raridade, categoria) VALUES
('50_despesas_pagas', 'Pagador em Dia', 'Marcou 50 despesas como pagas', '🏅', 60, 'raro', 'despesas');

-- Categorizou 20 despesas com tags
INSERT OR IGNORE INTO conquistas_definicoes (codigo, titulo, descricao, icone, pontos, raridade, categoria) VALUES
('20_despesas_com_tag', 'Organizador de Elite', 'Categorizou 20 despesas com tags personalizadas', '🏷️', 40, 'raro', 'despesas');

-- Nenhuma despesa pendente no mês
INSERT OR IGNORE INTO conquistas_definicoes (codigo, titulo, descricao, icone, pontos, raridade, categoria) VALUES
('mes_zerado', 'Mês Zerado', 'Encerrou o mês sem nenhuma despesa pendente', '🧹', 50, 'raro', 'despesas');

-- ── CATEGORIA: RECEITAS ─────────────────────────────────────────────────────

-- Cadastrou 5 receitas
INSERT OR IGNORE INTO conquistas_definicoes (codigo, titulo, descricao, icone, pontos, raridade, categoria) VALUES
('5_receitas', 'Renda Registrada', 'Cadastrou 5 fontes de receita', '💵', 20, 'comum', 'receitas');

-- Cadastrou 3 tipos de receita diferentes (salário, freelance, etc.)
INSERT OR IGNORE INTO conquistas_definicoes (codigo, titulo, descricao, icone, pontos, raridade, categoria) VALUES
('receita_diversificada', 'Múltiplas Fontes', 'Cadastrou receitas de 3 categorias diferentes', '🌊', 50, 'raro', 'receitas');

-- Receita mensal acima de R$5.000
INSERT OR IGNORE INTO conquistas_definicoes (codigo, titulo, descricao, icone, pontos, raridade, categoria) VALUES
('receita_5k', 'Cinco Mil no Bolso', 'Registrou renda mensal acima de R$ 5.000', '💸', 40, 'raro', 'receitas');

-- ── CATEGORIA: METAS ────────────────────────────────────────────────────────

-- Concluiu 3 metas
INSERT OR IGNORE INTO conquistas_definicoes (codigo, titulo, descricao, icone, pontos, raridade, categoria) VALUES
('3_metas_concluidas', 'Tricampeão de Metas', 'Concluiu 3 metas financeiras — determinação real', '🥇', 100, 'epico', 'metas');

-- Concluiu uma meta antes do prazo
INSERT OR IGNORE INTO conquistas_definicoes (codigo, titulo, descricao, icone, pontos, raridade, categoria) VALUES
('meta_antes_prazo', 'Adiantado', 'Concluiu uma meta antes da data prevista', '⚡', 75, 'epico', 'metas');

-- Tem 5 metas ativas ao mesmo tempo
INSERT OR IGNORE INTO conquistas_definicoes (codigo, titulo, descricao, icone, pontos, raridade, categoria) VALUES
('5_metas_ativas', 'Ambicioso', 'Mantém 5 metas ativas simultaneamente', '🎯', 30, 'raro', 'metas');

-- Meta com valor acima de R$10.000
INSERT OR IGNORE INTO conquistas_definicoes (codigo, titulo, descricao, icone, pontos, raridade, categoria) VALUES
('meta_grande', 'Grande Objetivo', 'Criou uma meta com valor acima de R$ 10.000', '🏔️', 35, 'raro', 'metas');

-- ── CATEGORIA: INVESTIMENTOS ────────────────────────────────────────────────

-- Investiu mais do que gastou em um mês
INSERT OR IGNORE INTO conquistas_definicoes (codigo, titulo, descricao, icone, pontos, raridade, categoria) VALUES
('investiu_mais_que_gastou', 'Modo Acumulação', 'Investiu mais do que gastou em um único mês', '📊', 80, 'epico', 'investimentos');

-- Tem 5 investimentos ativos
INSERT OR IGNORE INTO conquistas_definicoes (codigo, titulo, descricao, icone, pontos, raridade, categoria) VALUES
('5_investimentos', 'Carteira Ativa', 'Mantém 5 investimentos cadastrados', '💼', 40, 'raro', 'investimentos');

-- Rentabilidade positiva em pelo menos 1 investimento
INSERT OR IGNORE INTO conquistas_definicoes (codigo, titulo, descricao, icone, pontos, raridade, categoria) VALUES
('primeiro_lucro', 'Primeiro Lucro', 'Obteve rentabilidade positiva em um investimento', '🌱', 30, 'comum', 'investimentos');

-- Aportou no mesmo investimento por 3 meses seguidos (consistência)
INSERT OR IGNORE INTO conquistas_definicoes (codigo, titulo, descricao, icone, pontos, raridade, categoria) VALUES
('aporte_3_meses', 'Aportes Frequentes', 'Realizou aportes em investimentos por 3 meses consecutivos', '🔁', 60, 'raro', 'investimentos');

-- Patrimônio líquido positivo
INSERT OR IGNORE INTO conquistas_definicoes (codigo, titulo, descricao, icone, pontos, raridade, categoria) VALUES
('patrimonio_positivo', 'No Azul', 'Patrimônio líquido positivo — você tem mais do que deve!', '🟢', 50, 'raro', 'investimentos');

-- ── CATEGORIA: ORÇAMENTOS ───────────────────────────────────────────────────

-- Criou 3 orçamentos
INSERT OR IGNORE INTO conquistas_definicoes (codigo, titulo, descricao, icone, pontos, raridade, categoria) VALUES
('3_orcamentos', 'Controlador de Gastos', 'Criou 3 orçamentos mensais para controlar categorias', '📊', 25, 'comum', 'orcamentos');

-- Não ultrapassou nenhum orçamento no mês
INSERT OR IGNORE INTO conquistas_definicoes (codigo, titulo, descricao, icone, pontos, raridade, categoria) VALUES
('orcamentos_no_limite', 'Dentro do Limite', 'Não ultrapassou nenhum orçamento em um mês completo', '🎖️', 70, 'epico', 'orcamentos');

-- ── CATEGORIA: CARTÕES ──────────────────────────────────────────────────────

-- Pagou a fatura do cartão em dia (antes do vencimento)
INSERT OR IGNORE INTO conquistas_definicoes (codigo, titulo, descricao, icone, pontos, raridade, categoria) VALUES
('fatura_em_dia', 'Fatura Quitada', 'Pagou a fatura do cartão antes do vencimento', '💳', 30, 'comum', 'cartoes');

-- Fatura menor que 30% do limite
INSERT OR IGNORE INTO conquistas_definicoes (codigo, titulo, descricao, icone, pontos, raridade, categoria) VALUES
('fatura_saudavel', 'Fatura Saudável', 'Manteve a fatura abaixo de 30% do limite do cartão', '💚', 40, 'raro', 'cartoes');

-- ── CATEGORIA: LEMBRETES ────────────────────────────────────────────────────

-- Nunca deixou um lembrete urgente passar sem marcar
INSERT OR IGNORE INTO conquistas_definicoes (codigo, titulo, descricao, icone, pontos, raridade, categoria) VALUES
('lembrete_pontual', 'Pontual', 'Marcou 10 lembretes como concluídos antes de vencer', '⏱️', 40, 'raro', 'lembretes');

-- Criou 10 lembretes
INSERT OR IGNORE INTO conquistas_definicoes (codigo, titulo, descricao, icone, pontos, raridade, categoria) VALUES
('10_lembretes', 'Cheio de Alertas', 'Criou 10 lembretes financeiros', '🔔', 25, 'comum', 'lembretes');

-- ── CATEGORIA: SAÚDE FINANCEIRA ─────────────────────────────────────────────

-- Score acima de 90
INSERT OR IGNORE INTO conquistas_definicoes (codigo, titulo, descricao, icone, pontos, raridade, categoria) VALUES
('score_90', 'Elite Financeira', 'Atingiu score de saúde financeira acima de 90', '👑', 150, 'lendario', 'saude');

-- Saldo mensal positivo por 3 meses seguidos
INSERT OR IGNORE INTO conquistas_definicoes (codigo, titulo, descricao, icone, pontos, raridade, categoria) VALUES
('saldo_positivo_3m', 'Três Meses no Verde', 'Manteve saldo positivo por 3 meses consecutivos', '🌿', 100, 'epico', 'saude');

-- Gastou menos de 50% da renda em necessidades
INSERT OR IGNORE INTO conquistas_definicoes (codigo, titulo, descricao, icone, pontos, raridade, categoria) VALUES
('necessidades_50pct', 'Regra dos 50', 'Manteve gastos com necessidades abaixo de 50% da renda', '⚖️', 60, 'raro', 'saude');

-- ── CATEGORIA: MARCOS FINANCEIROS ───────────────────────────────────────────

-- Primeiro saldo positivo (receita > despesa no mês)
INSERT OR IGNORE INTO conquistas_definicoes (codigo, titulo, descricao, icone, pontos, raridade, categoria) VALUES
('primeiro_saldo_positivo', 'Primeiro Verde', 'Terminou o mês com mais receitas do que despesas pela 1ª vez', '🌱', 20, 'comum', 'marco');

-- Reduziu dívidas em 20% num mês
INSERT OR IGNORE INTO conquistas_definicoes (codigo, titulo, descricao, icone, pontos, raridade, categoria) VALUES
('reduziu_divida_20', 'Atacando a Dívida', 'Reduziu o saldo devedor total em 20% em um único mês', '⚔️', 80, 'epico', 'marco');

-- Reserva de emergência iniciada
INSERT OR IGNORE INTO conquistas_definicoes (codigo, titulo, descricao, icone, pontos, raridade, categoria) VALUES
('reserva_iniciada', 'Primeiro Escudo', 'Criou sua reserva de emergência — o primeiro passo é o mais importante', '🛡️', 25, 'comum', 'marco');

-- Chegou a R$1.000 guardados no Desafio 52
INSERT OR IGNORE INTO conquistas_definicoes (codigo, titulo, descricao, icone, pontos, raridade, categoria) VALUES
('desafio_52_1k', 'Mil no Desafio', 'Acumulou R$ 1.000 no Desafio 52 Semanas', '🎉', 50, 'raro', 'desafio');

-- Completou 10 semanas do Desafio 52
INSERT OR IGNORE INTO conquistas_definicoes (codigo, titulo, descricao, icone, pontos, raridade, categoria) VALUES
('desafio_52_10sem', 'Dez Semanas', 'Completou 10 semanas no Desafio 52 Semanas', '💪', 40, 'raro', 'desafio');

-- ── CATEGORIA: PERFIL / ENGAJAMENTO ─────────────────────────────────────────

-- Usou a IA de insights
INSERT OR IGNORE INTO conquistas_definicoes (codigo, titulo, descricao, icone, pontos, raridade, categoria) VALUES
('usou_ia', 'Consultor Digital', 'Usou a análise com IA pela primeira vez', '🤖', 20, 'comum', 'engajamento');

-- Usou o simulador de investimentos
INSERT OR IGNORE INTO conquistas_definicoes (codigo, titulo, descricao, icone, pontos, raridade, categoria) VALUES
('usou_simulador', 'Estrategista', 'Usou o simulador de investimentos', '🧮', 20, 'comum', 'engajamento');

-- Viu a projeção financeira
INSERT OR IGNORE INTO conquistas_definicoes (codigo, titulo, descricao, icone, pontos, raridade, categoria) VALUES
('viu_projecao', 'Olho no Futuro', 'Visualizou a projeção financeira pela primeira vez', '🔭', 15, 'comum', 'engajamento');

-- ── CONQUISTA OCULTA ─────────────────────────────────────────────────────────

-- Usuário completo: tem receita, despesa, investimento, meta e reserva
INSERT OR IGNORE INTO conquistas_definicoes (codigo, titulo, descricao, icone, pontos, raridade, categoria) VALUES
('usuario_completo', '🌟 VerdeMais Completo', 'Tem receita, despesa, investimento, meta e reserva cadastrados — parabéns!', '🌟', 100, 'epico', 'engajamento');
