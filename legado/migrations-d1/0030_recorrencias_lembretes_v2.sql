-- Migration 0030: Melhorias v2 em Recorrências e Lembretes
-- S-L8: campo cor nos lembretes (data_inicio já existe em recorrencias)

ALTER TABLE lembretes ADD COLUMN cor TEXT DEFAULT '#2FBF71';
