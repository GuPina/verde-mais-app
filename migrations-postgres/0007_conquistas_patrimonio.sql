-- 0007 — conquistas do patrimônio material.
--
-- Os bens materiais entraram no app na migration 0005 e não tinham nenhuma
-- conquista associada: quem cadastrava a casa ou o carro não recebia nada, e
-- o mini-game simplesmente ignorava a maior parte do patrimônio de muita
-- gente. Estas seis fecham essa lacuna.
--
-- `bem_livre` e `patrimonio_100k` são de propósito as mais caras: uma marca o
-- momento em que um bem deixa de ser do banco, a outra o patrimônio líquido
-- já contando os bens — que é o número que só passou a existir agora.

INSERT INTO conquistas_definicoes (codigo, titulo, descricao, icone, categoria, plano_requerido, pontos, raridade) VALUES
  ('primeiro_bem',     'Patrimônio Material',  'Cadastrou seu primeiro bem material',                        '🏡', 'patrimonio', 'free', 20,  'comum'),
  ('bens_3_tipos',     'Portfólio Diverso',    'Tem bens de três tipos diferentes cadastrados',              '🗂️', 'patrimonio', 'free', 40,  'raro'),
  ('bem_valorizado',   'Comprou Bem',          'Tem um bem que vale mais hoje do que você pagou por ele',    '📈', 'patrimonio', 'free', 50,  'raro'),
  ('bem_livre',        'Escritura na Mão',     'Tem um bem de R$ 10 mil ou mais sem financiamento em aberto', '🔓', 'patrimonio', 'free', 60,  'epico'),
  ('patrimonio_100k',  'Seis Dígitos',         'Patrimônio líquido acima de R$ 100 mil, contando os bens',   '💎', 'patrimonio', 'free', 80,  'epico'),
  ('desafio_em_dia',   'Nenhuma Semana em Branco', 'Desafio 52 com 100% de aderência após um trimestre',    '🔥', 'desafio',    'free', 60,  'raro')
ON CONFLICT (codigo) DO NOTHING;
