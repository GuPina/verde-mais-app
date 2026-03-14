-- Migration 0018: Bloco 1.5 — Fix conquistas inconsistentes (PDF v3.1)

-- Fix 'analista': atualizar descrição para ser mais precisa
UPDATE conquistas_definicoes
SET descricao = 'Consultou o relatório anual pelo menos uma vez'
WHERE codigo = 'analista';

-- Remove redundância: cartao_zero (não documentado, removido do spec)
DELETE FROM conquistas_definicoes WHERE codigo = 'cartao_zero';
DELETE FROM conquistas_usuario WHERE conquista_codigo = 'cartao_zero';

-- Fix 'sem_dividas': garantir pontos=200 e raridade=lendario conforme spec
UPDATE conquistas_definicoes
SET pontos = 200, raridade = 'lendario'
WHERE codigo = 'sem_dividas';

-- Fix 'quitou_imovel': 500pts lendario conforme spec
UPDATE conquistas_definicoes
SET pontos = 500, raridade = 'lendario'
WHERE codigo = 'quitou_imovel';
