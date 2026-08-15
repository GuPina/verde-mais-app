-- Migration 0027: S-C6 apelido no cartão + melhorias de cartões
-- Adiciona campo apelido opcional para diferenciar múltiplos cartões da mesma bandeira

ALTER TABLE cartoes ADD COLUMN apelido TEXT DEFAULT NULL;
