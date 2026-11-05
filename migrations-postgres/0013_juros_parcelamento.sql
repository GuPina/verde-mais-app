-- 0013 — quanto de cada parcela é juros.
--
-- Uma conta de R$ 5.000 parcelada no cartão em 12x de R$ 473,33 entrava como
-- R$ 5.680 de despesa na categoria da conta, e os R$ 680 de juros sumiam ali
-- dentro. Com o valor à vista informado, cada parcela guarda a sua parte de
-- juros (pela amortização: mais no começo, menos no fim). O valor da parcela
-- não muda — é o que a fatura cobra; a coluna só separa o que é custo do
-- crédito. NULL = compra sem valor à vista informado.
ALTER TABLE despesas ADD COLUMN IF NOT EXISTS valor_juros double precision;
