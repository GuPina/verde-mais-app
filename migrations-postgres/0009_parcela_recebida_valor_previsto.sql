-- 0009 — o previsto e o recebido deixam de ser o mesmo campo.
--
-- `recebimentos_parcelas.valor` fazia dois trabalhos. Enquanto a parcela está
-- pendente ele guarda o que se ESPERA receber; quando ela é recebida, o endpoint
-- sobrescreve com o que ENTROU de verdade. Depois de lançar R$ 1.221,63 numa
-- parcela de R$ 1.147,33, o contratado daquela linha deixa de existir.
--
-- Isso é fatal para um contrato corrigido por índice. A Restituição Cooperativa
-- do Gustavo tem 34 parcelas de R$ 1.147,33 — o MÍNIMO contratual — e o INCC
-- acrescenta o que acrescentar por cima:
--
--   parcela 3   1.160,00   +12,67
--   parcela 4   1.221,63   +74,30
--   parcela 5   1.193,72   +46,39
--
-- Sem o previsto guardado, esses +133,36 não são calculáveis a partir da linha:
-- só sobrevive o total recebido, e o total do contrato fica congelado nos
-- R$ 39.009,35 originais para sempre.
--
-- Com a coluna, cada parcela carrega as duas verdades, e a diferença entre elas
-- é a correção — por parcela, por contrato e no acumulado.

ALTER TABLE recebimentos_parcelas
  ADD COLUMN IF NOT EXISTS valor_previsto double precision;

-- Preenchimento do que já existe, com cuidado diferente para cada estado:
--
--   PENDENTE  — `valor` ainda é o previsto, e pode ter sido ajustado à mão pelo
--               endpoint de /valor. Copiar de `valor` preserva esse ajuste.
--
--   RECEBIDA  — `valor` já é o recebido. O previsto tem que vir do contrato
--               (`recebimentos_parcelados.valor_parcela`), que é o único lugar
--               onde o mínimo acordado ainda está intacto.
UPDATE recebimentos_parcelas p
   SET valor_previsto = p.valor
 WHERE p.valor_previsto IS NULL
   AND COALESCE(p.status, 'pendente') <> 'recebida';

UPDATE recebimentos_parcelas p
   SET valor_previsto = r.valor_parcela
  FROM recebimentos_parcelados r
 WHERE r.id = p.recebimento_id
   AND p.valor_previsto IS NULL;

-- Rede de segurança: parcela órfã de contrato fica com o próprio valor.
UPDATE recebimentos_parcelas
   SET valor_previsto = valor
 WHERE valor_previsto IS NULL;
