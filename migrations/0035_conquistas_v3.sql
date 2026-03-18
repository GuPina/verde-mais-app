-- ============================================================
-- Migration 0035: Novas Conquistas — coerência total com o sistema
-- Foco: assinaturas, recorrências, financiamentos, comportamento,
--        cartões, lembretes, receita passiva e marcos de longo prazo
-- ============================================================

-- ── CATEGORIA: ASSINATURAS ───────────────────────────────────────────────────

-- Cadastrou a primeira assinatura
INSERT OR IGNORE INTO conquistas_definicoes (codigo, titulo, descricao, icone, pontos, raridade, categoria) VALUES
('primeira_assinatura', 'Assinante', 'Cadastrou sua primeira assinatura recorrente', '📱', 10, 'comum', 'assinaturas');

-- Cancelou uma assinatura desnecessária
INSERT OR IGNORE INTO conquistas_definicoes (codigo, titulo, descricao, icone, pontos, raridade, categoria) VALUES
('cortou_gordura', 'Corte Cirúrgico', 'Cancelou uma assinatura detectada como desnecessária', '✂️', 40, 'raro', 'assinaturas');

-- Tem todas as assinaturas categorizadas (nenhuma "sem categoria")
INSERT OR IGNORE INTO conquistas_definicoes (codigo, titulo, descricao, icone, pontos, raridade, categoria) VALUES
('assinaturas_organizadas', 'Controle Total', 'Categorizou todas as suas assinaturas', '🗂️', 30, 'raro', 'assinaturas');

-- Gasta menos de R$200/mês com assinaturas
INSERT OR IGNORE INTO conquistas_definicoes (codigo, titulo, descricao, icone, pontos, raridade, categoria) VALUES
('assinatura_econômico', 'Consumo Consciente', 'Mantém gastos com assinaturas abaixo de R$ 200/mês', '💡', 50, 'raro', 'assinaturas');

-- ── CATEGORIA: RECORRÊNCIAS ──────────────────────────────────────────────────

-- Criou a primeira despesa recorrente
INSERT OR IGNORE INTO conquistas_definicoes (codigo, titulo, descricao, icone, pontos, raridade, categoria) VALUES
('primeira_recorrencia', 'Automação Financeira', 'Criou sua primeira despesa recorrente', '🔄', 15, 'comum', 'recorrencias');

-- Tem 3 recorrências ativas
INSERT OR IGNORE INTO conquistas_definicoes (codigo, titulo, descricao, icone, pontos, raridade, categoria) VALUES
('3_recorrencias', 'Rotina Planejada', 'Mantém 3 ou mais despesas recorrentes cadastradas', '⚙️', 25, 'comum', 'recorrencias');

-- Todas as recorrências do mês foram pagas
INSERT OR IGNORE INTO conquistas_definicoes (codigo, titulo, descricao, icone, pontos, raridade, categoria) VALUES
('recorrencias_dia', 'Compromisso Cumprido', 'Pagou todas as recorrências do mês em dia', '✔️', 45, 'raro', 'recorrencias');

-- ── CATEGORIA: FINANCIAMENTOS ────────────────────────────────────────────────

-- Cadastrou o primeiro financiamento
INSERT OR IGNORE INTO conquistas_definicoes (codigo, titulo, descricao, icone, pontos, raridade, categoria) VALUES
('primeiro_financiamento', 'Financiado', 'Cadastrou seu primeiro financiamento', '🏦', 10, 'comum', 'financiamentos');

-- Pagou 12 parcelas de um financiamento (1 ano de constância)
INSERT OR IGNORE INTO conquistas_definicoes (codigo, titulo, descricao, icone, pontos, raridade, categoria) VALUES
('um_ano_financiamento', 'Um Ano Pagando', 'Completou 12 meses de pagamento em um financiamento', '📅', 80, 'epico', 'financiamentos');

-- Fez amortização antecipada em um financiamento
INSERT OR IGNORE INTO conquistas_definicoes (codigo, titulo, descricao, icone, pontos, raridade, categoria) VALUES
('amortizou_antecipado', 'Atacou a Dívida', 'Realizou amortização antecipada em um financiamento', '⚡', 60, 'raro', 'financiamentos');

-- Financiamento com LTV abaixo de 50% (mais de metade paga)
INSERT OR IGNORE INTO conquistas_definicoes (codigo, titulo, descricao, icone, pontos, raridade, categoria) VALUES
('metade_paga', 'Meio Caminho', 'Já pagou mais de metade de um financiamento', '🏁', 100, 'epico', 'financiamentos');

-- ── CATEGORIA: EMPRÉSTIMOS ───────────────────────────────────────────────────

-- Cadastrou o primeiro empréstimo
INSERT OR IGNORE INTO conquistas_definicoes (codigo, titulo, descricao, icone, pontos, raridade, categoria) VALUES
('primeiro_emprestimo', 'Registrei Minha Dívida', 'Cadastrou seu primeiro empréstimo — transparência é o primeiro passo', '📝', 10, 'comum', 'emprestimos');

-- Quitou um empréstimo
INSERT OR IGNORE INTO conquistas_definicoes (codigo, titulo, descricao, icone, pontos, raridade, categoria) VALUES
('emprestimo_quitado', 'Dívida Zerada', 'Quitou um empréstimo por completo', '🎉', 150, 'epico', 'emprestimos');

-- Nunca atrasou uma parcela de empréstimo (todas no status "pago" ou "ativo" em dia)
INSERT OR IGNORE INTO conquistas_definicoes (codigo, titulo, descricao, icone, pontos, raridade, categoria) VALUES
('emprestimo_sem_atraso', 'Devedor Honesto', 'Nunca atrasou uma parcela de empréstimo', '🤝', 70, 'epico', 'emprestimos');

-- ── CATEGORIA: CARTÕES ───────────────────────────────────────────────────────

-- Cadastrou 2 cartões
INSERT OR IGNORE INTO conquistas_definicoes (codigo, titulo, descricao, icone, pontos, raridade, categoria) VALUES
('dois_cartoes', 'Multi Cartões', 'Cadastrou 2 cartões de crédito', '💳', 15, 'comum', 'cartoes');

-- Cadastrou 5 cartões
INSERT OR IGNORE INTO conquistas_definicoes (codigo, titulo, descricao, icone, pontos, raridade, categoria) VALUES
('cinco_cartoes', 'Colecionador de Cartões', 'Cadastrou 5 cartões de crédito', '🃏', 30, 'raro', 'cartoes');

-- Limite total de cartões acima de R$10.000
INSERT OR IGNORE INTO conquistas_definicoes (codigo, titulo, descricao, icone, pontos, raridade, categoria) VALUES
('limite_10k', 'Crédito de Peso', 'Soma dos limites dos cartões ultrapassa R$ 10.000', '💰', 40, 'raro', 'cartoes');

-- Usou menos de 10% do limite em um mês
INSERT OR IGNORE INTO conquistas_definicoes (codigo, titulo, descricao, icone, pontos, raridade, categoria) VALUES
('uso_baixo_cartao', 'Cartão Responsável', 'Usou menos de 10% do limite disponível em um mês', '🛡️', 50, 'epico', 'cartoes');

-- ── CATEGORIA: LEMBRETES ─────────────────────────────────────────────────────

-- Criou lembrete para vencimento de fatura
INSERT OR IGNORE INTO conquistas_definicoes (codigo, titulo, descricao, icone, pontos, raridade, categoria) VALUES
('lembrete_fatura', 'Alerta de Fatura', 'Criou um lembrete para vencimento de fatura de cartão', '📬', 15, 'comum', 'lembretes');

-- Tem 3 lembretes ativos ao mesmo tempo
INSERT OR IGNORE INTO conquistas_definicoes (codigo, titulo, descricao, icone, pontos, raridade, categoria) VALUES
('3_lembretes_ativos', 'Sempre Atento', 'Mantém 3 ou mais lembretes ativos simultaneamente', '🔔', 20, 'comum', 'lembretes');

-- Concluiu 20 lembretes no total
INSERT OR IGNORE INTO conquistas_definicoes (codigo, titulo, descricao, icone, pontos, raridade, categoria) VALUES
('20_lembretes_concluidos', 'Missão Cumprida', 'Concluiu 20 lembretes financeiros', '✅', 60, 'raro', 'lembretes');

-- ── CATEGORIA: RECEITA PASSIVA / RENDA EXTRA ─────────────────────────────────

-- Cadastrou renda de investimentos (dividendos/rendimentos)
INSERT OR IGNORE INTO conquistas_definicoes (codigo, titulo, descricao, icone, pontos, raridade, categoria) VALUES
('renda_de_investimento', 'Dinheiro Trabalhando', 'Registrou renda proveniente de investimentos', '🌿', 40, 'raro', 'receitas');

-- Renda extra cadastrada no mês (segunda fonte de renda)
INSERT OR IGNORE INTO conquistas_definicoes (codigo, titulo, descricao, icone, pontos, raridade, categoria) VALUES
('renda_extra_cadastrada', 'Freelancer', 'Cadastrou uma renda extra além do salário principal', '💼', 25, 'comum', 'receitas');

-- Receita mensal acima de R$10.000
INSERT OR IGNORE INTO conquistas_definicoes (codigo, titulo, descricao, icone, pontos, raridade, categoria) VALUES
('receita_10k', 'Renda de 5 Dígitos', 'Registrou renda mensal acima de R$ 10.000', '🚀', 100, 'epico', 'receitas');

-- ── CATEGORIA: METAS ─────────────────────────────────────────────────────────

-- Aportou na meta pela primeira vez
INSERT OR IGNORE INTO conquistas_definicoes (codigo, titulo, descricao, icone, pontos, raridade, categoria) VALUES
('primeiro_aporte_meta', 'Primeiros Passos', 'Fez o primeiro aporte em uma meta financeira', '👟', 15, 'comum', 'metas');

-- Meta de educação concluída
INSERT OR IGNORE INTO conquistas_definicoes (codigo, titulo, descricao, icone, pontos, raridade, categoria) VALUES
('meta_educacao_concluida', 'Investi em Mim', 'Concluiu uma meta de educação ou desenvolvimento pessoal', '🎓', 80, 'epico', 'metas');

-- Meta de viagem concluída
INSERT OR IGNORE INTO conquistas_definicoes (codigo, titulo, descricao, icone, pontos, raridade, categoria) VALUES
('meta_viagem_concluida', 'Passagem Garantida', 'Concluiu uma meta de viagem', '✈️', 80, 'epico', 'metas');

-- Tem meta de aposentadoria ativa
INSERT OR IGNORE INTO conquistas_definicoes (codigo, titulo, descricao, icone, pontos, raridade, categoria) VALUES
('pensa_no_futuro', 'Pensa no Futuro', 'Criou uma meta de aposentadoria ou independência financeira', '🏖️', 50, 'raro', 'metas');

-- ── CATEGORIA: SCORE / SAÚDE FINANCEIRA ─────────────────────────────────────

-- Melhorou o score em 10 pontos num mês
INSERT OR IGNORE INTO conquistas_definicoes (codigo, titulo, descricao, icone, pontos, raridade, categoria) VALUES
('score_melhorou', 'Subindo na Vida', 'Melhorou o score de saúde financeira em um mês', '📈', 30, 'raro', 'saude');

-- Manteve score acima de 80 por 3 meses
INSERT OR IGNORE INTO conquistas_definicoes (codigo, titulo, descricao, icone, pontos, raridade, categoria) VALUES
('score_80_3m', 'Consistência Premium', 'Manteve score acima de 80 por 3 meses consecutivos', '🏆', 120, 'lendario', 'saude');

-- ── CATEGORIA: COMPORTAMENTO / ENGAJAMENTO ───────────────────────────────────

-- Fez login por 30 dias seguidos
INSERT OR IGNORE INTO conquistas_definicoes (codigo, titulo, descricao, icone, pontos, raridade, categoria) VALUES
('login_30_dias', 'Fiel ao App', 'Acessou o VerdeMais por 30 dias consecutivos', '📲', 100, 'epico', 'engajamento');

-- Usou o comparativo de CDI
INSERT OR IGNORE INTO conquistas_definicoes (codigo, titulo, descricao, icone, pontos, raridade, categoria) VALUES
('usou_comparativo_cdi', 'Comparador de Taxas', 'Consultou o comparativo CDI nos investimentos', '📊', 15, 'comum', 'engajamento');

-- Exportou relatório pela primeira vez
INSERT OR IGNORE INTO conquistas_definicoes (codigo, titulo, descricao, icone, pontos, raridade, categoria) VALUES
('primeiro_relatorio', 'Relatório Gerado', 'Exportou seus dados financeiros pela primeira vez', '📄', 20, 'comum', 'engajamento');

-- Usou filtros avançados na listagem
INSERT OR IGNORE INTO conquistas_definicoes (codigo, titulo, descricao, icone, pontos, raridade, categoria) VALUES
('usou_filtros', 'Analista Preciso', 'Usou filtros avançados para analisar seus lançamentos', '🔍', 15, 'comum', 'engajamento');

-- ── CATEGORIA: MARCOS LENDÁRIOS ──────────────────────────────────────────────

-- Patrimônio líquido acima de R$500.000
INSERT OR IGNORE INTO conquistas_definicoes (codigo, titulo, descricao, icone, pontos, raridade, categoria) VALUES
('patrimonio_500k', '💎 Meio Milhão', 'Patrimônio líquido ultrapassou R$ 500.000', '💎', 500, 'lendario', 'marco');

-- 2 anos usando o VerdeMais
INSERT OR IGNORE INTO conquistas_definicoes (codigo, titulo, descricao, icone, pontos, raridade, categoria) VALUES
('2_anos_verde', 'Dois Anos no Verde', 'Usa o VerdeMais há mais de 2 anos', '🎂', 200, 'lendario', 'engajamento');

-- Score perfeito (100)
INSERT OR IGNORE INTO conquistas_definicoes (codigo, titulo, descricao, icone, pontos, raridade, categoria) VALUES
('score_100', '🌟 Saúde Perfeita', 'Atingiu score de saúde financeira máximo: 100', '🌟', 500, 'lendario', 'saude');

-- Reduziu despesas em 3 categorias no mesmo mês
INSERT OR IGNORE INTO conquistas_definicoes (codigo, titulo, descricao, icone, pontos, raridade, categoria) VALUES
('reduziu_3_categorias', 'Tesoura Afiada', 'Reduziu gastos em 3 categorias diferentes num mesmo mês', '✂️', 80, 'epico', 'despesas');

-- Lançou mais de 100 transações totais
INSERT OR IGNORE INTO conquistas_definicoes (codigo, titulo, descricao, icone, pontos, raridade, categoria) VALUES
('100_transacoes', 'Centurião Financeiro', 'Registrou mais de 100 transações no VerdeMais', '💯', 60, 'raro', 'habito');

-- Lançou mais de 500 transações totais
INSERT OR IGNORE INTO conquistas_definicoes (codigo, titulo, descricao, icone, pontos, raridade, categoria) VALUES
('500_transacoes', 'Arquivista de Elite', 'Registrou mais de 500 transações — controle total!', '🗄️', 150, 'lendario', 'habito');
