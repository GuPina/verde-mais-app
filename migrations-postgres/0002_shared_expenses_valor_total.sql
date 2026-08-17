-- 0002 — `shared_expenses.valor_total`: guarda o valor CHEIO da conta dividida.
--
-- O bug que isto corrige: ao criar uma despesa já compartilhada, o app gravava
-- em `despesas` apenas a MINHA parte (R$ 100 de um jantar de R$ 200) e, logo
-- em seguida, calculava "minha parte" aplicando o percentual OUTRA VEZ sobre
-- esse valor — devolvendo R$ 50. As duas partes somadas davam R$ 100 numa
-- conta de R$ 200.
--
-- A raiz é que `despesas.valor` tem dois significados diferentes dependendo de
-- como a divisão nasceu:
--   • criada junto com a divisão  → guarda só a minha fatia
--   • divisão de despesa existente → guarda o valor cheio
-- Sem saber qual é o caso, não dá para derivar as partes. Esta coluna passa a
-- guardar o valor cheio explicitamente, e as partes saem sempre dela.

ALTER TABLE shared_expenses ADD COLUMN IF NOT EXISTS valor_total real;

-- Backfill: para as linhas antigas não há como distinguir os dois casos, então
-- assume-se o caso documentado no código original (despesa existente = valor
-- cheio). Linhas criadas pelo modo "criar+compartilhar" ficam subestimadas —
-- é o mesmo número que a tela já mostrava antes, não uma piora.
UPDATE shared_expenses se
   SET valor_total = d.valor
  FROM despesas d
 WHERE d.id = se.expense_id
   AND se.valor_total IS NULL;
