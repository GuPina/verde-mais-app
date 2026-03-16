-- Migration 0026: Adiciona coluna score_saude na tabela users
-- Necessário para o Assistente IA buscar o score diretamente

ALTER TABLE users ADD COLUMN score_saude INTEGER DEFAULT NULL;

-- Índice para consultas rápidas no assistente
CREATE INDEX IF NOT EXISTS idx_users_score_saude ON users(id, score_saude);
