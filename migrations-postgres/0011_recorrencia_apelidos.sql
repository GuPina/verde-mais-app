-- 0011 — outros nomes da mesma conta.
--
-- "Juros de obra" que o banco às vezes escreve "Evolução de obra": a regra de
-- match só olhava um texto. Quando a pessoa confirma um lançamento com outro
-- nome na busca da recorrência, o nome dele entra aqui (lista JSON de textos
-- já normalizados) e os próximos lançamentos com esse nome já casam.
ALTER TABLE recorrencia_regras ADD COLUMN IF NOT EXISTS apelidos text;
