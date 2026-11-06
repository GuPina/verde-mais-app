-- 0014 — conserta as datas "NaN-NaN-Na".
--
-- De 10/09/2026 até esta correção, criar um recebimento parcelado ou um
-- financiamento gravava a data de TODAS as parcelas como "NaN-NaN-Na": o
-- gerador passava `String(new Date(...)).slice(0, 10)` ("Thu Sep 10") para
-- `somarMeses`, que espera AAAA-MM-DD. As parcelas existiam, mas nenhum filtro
-- de mês as encontrava — sumiam de Despesas, do fluxo e da projeção.
--
-- A data certa é recalculável: a parcela N cai N−1 meses depois do início do
-- contrato. `date + interval 'N months'` no Postgres trava no último dia do
-- mês quando o destino é mais curto, como `somarMeses` faz.

UPDATE recebimentos_parcelas p
   SET data_prevista = to_char(substr(r.data_inicio, 1, 10)::date + make_interval(months => p.numero_parcela - 1), 'YYYY-MM-DD')
  FROM recebimentos_parcelados r
 WHERE r.id = p.recebimento_id
   AND (p.data_prevista IS NULL OR p.data_prevista !~ '^\d{4}-\d{2}-\d{2}')
   AND r.data_inicio ~ '^\d{4}-\d{2}-\d{2}';

UPDATE despesas d
   SET data       = to_char(substr(f.data_inicio, 1, 10)::date + make_interval(months => COALESCE(d.parcela_atual, 1) - 1), 'YYYY-MM-DD'),
       vencimento = to_char(substr(f.data_inicio, 1, 10)::date + make_interval(months => COALESCE(d.parcela_atual, 1) - 1), 'YYYY-MM-DD')
  FROM financiamentos f
 WHERE d.user_id = f.user_id
   AND d.observacoes LIKE 'Financiamento automático #' || f.id || ' %'
   AND (d.data IS NULL OR d.data !~ '^\d{4}-\d{2}-\d{2}')
   AND f.data_inicio ~ '^\d{4}-\d{2}-\d{2}';
