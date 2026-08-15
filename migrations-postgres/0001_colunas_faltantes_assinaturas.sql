-- 0001 — colunas que o código de assinaturas sempre escreveu e leu, mas que
-- nunca existiram no schema.
--
-- `src/routes/asaas.ts` fazia UPDATE em `assinaturas.updated_at` no webhook de
-- pagamento e devolvia `assinatura.expira_em` no GET /api/plano/status. As duas
-- colunas não existiam: o UPDATE falhava (e o erro era engolido pelo try/catch
-- do webhook, então o plano era ativado em `users` mas a linha de `assinaturas`
-- ficava desatualizada) e o `expira_em` voltava sempre `undefined` no JSON.

ALTER TABLE assinaturas ADD COLUMN IF NOT EXISTS updated_at text;
ALTER TABLE assinaturas ADD COLUMN IF NOT EXISTS expira_em  text;

-- Linhas existentes: sem histórico de atualização, o mais honesto é herdar a
-- data de início em vez de fingir que foram alteradas agora.
UPDATE assinaturas SET updated_at = data_inicio WHERE updated_at IS NULL;
