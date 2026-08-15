-- Migration 0024: Melhorias no detector de Assinaturas Fantasma
-- Adiciona campos service_nome e frequency_label à tabela detected_subscriptions

ALTER TABLE detected_subscriptions ADD COLUMN service_nome TEXT DEFAULT '';
ALTER TABLE detected_subscriptions ADD COLUMN frequency_label TEXT DEFAULT 'mensal';
