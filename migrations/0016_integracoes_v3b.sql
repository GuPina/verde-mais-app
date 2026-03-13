-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 0016 — Integrações Bloco 6 + Ajustes v3B
-- ═══════════════════════════════════════════════════════════════════════════

-- ── BLOCO 6.5: linked_meta_id em specialized_reserves ────────────────────
-- Permite vincular uma reserva a uma meta financeira
ALTER TABLE specialized_reserves ADD COLUMN linked_meta_id INTEGER REFERENCES metas(id) ON DELETE SET NULL;

-- ── BLOCO 6.4: Garantir que desafio_config tem coluna meta_vinculada ─────
-- (já criada em 0013, só garante índice)
CREATE INDEX IF NOT EXISTS idx_desafio_config_user ON desafio_config(user_id);

-- ── BLOCO 5: Garantir tabela assistente_conversas com campo intencao ──────
CREATE TABLE IF NOT EXISTS assistente_conversas (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id         INTEGER NOT NULL,
  mensagem_usuario TEXT   NOT NULL,
  resposta_ia      TEXT   NOT NULL,
  intencao         TEXT   DEFAULT 'desconhecido',
  created_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_assistente_conv_user ON assistente_conversas(user_id);

-- ── BUG 1.3: Garantir coluna tipo em despesas (já criada em 0012) ─────────
-- ALTER TABLE despesas ADD COLUMN tipo TEXT DEFAULT 'normal';  -- idempotente via IF NOT EXISTS
-- (SQLite não suporta IF NOT EXISTS em ALTER TABLE — usar trigger para garantir)

-- ── BUG 1.4: Novas conquistas que podem estar faltando ───────────────────
INSERT OR IGNORE INTO conquistas_definicoes (codigo, titulo, descricao, pontos, raridade, categoria) VALUES
  ('quitou_imovel',       '🏠 Livre do Imóvel!',           'Quitou um financiamento imobiliário',           500, 'lendario',   'dividas'),
  ('saldo_verde_3m',      '💚 3 Meses no Verde',            'Manteve saldo positivo por 3 meses seguidos',    50, 'raro',       'habitos'),
  ('zero_dividas_cartao', '💳 Zero no Cartão',              'Pagou a fatura completa 3 meses consecutivos',   75, 'raro',       'cartoes'),
  ('barreira_10k',        '💰 Barreira dos 10 Mil',         'Patrimônio investido atingiu R$ 10.000',        100, 'epico',      'investimentos'),
  ('barreira_50k',        '🚀 Barreira dos 50 Mil',         'Patrimônio investido atingiu R$ 50.000',        250, 'epico',      'investimentos'),
  ('barreira_100k',       '💎 Barreira dos 100 Mil',        'Patrimônio investido atingiu R$ 100.000',       500, 'lendario',   'investimentos'),
  ('realizador',          '🏆 Realizador',                  'Concluiu 3 metas financeiras',                  150, 'epico',      'metas'),
  ('livre_do_banco',      '🏦 Livre do Banco!',             'Quitou todos os empréstimos ativos',            200, 'lendario',   'dividas'),
  ('investidor_veteran',  '📊 Veterano dos Investimentos',  'Possui 5 ou mais tipos de investimento',        200, 'lendario',   'investimentos'),
  ('projetor',            '🔮 Projetor Financeiro',         'Consultou a projeção financeira',                20, 'comum',      'analises'),
  ('regra_503020_verde',  '⚖️ Equilíbrio 50/30/20',        'Atingiu score ≥ 80 na regra 50/30/20',           80, 'raro',       'habitos'),
  ('sub_detector_scanned','🔍 Detector Ativo',              'Rodou o detector de assinaturas fantasma',       20, 'comum',      'v3'),
  ('sub_cancelou_1',      '✂️ Poda das Assinaturas',        'Cancelou uma assinatura detectada',              40, 'incomum',    'v3'),
  ('desafio_52_iniciou',  '🗓️ Desafio Iniciado',           'Iniciou o Desafio 52 Semanas',                   20, 'comum',      'desafio52'),
  ('desafio_52_metade',   '🎯 Metade do Desafio',           'Concluiu 26 semanas do Desafio 52',             100, 'raro',       'desafio52'),
  ('desafio_52_completo', '🏅 Desafio 52 Completo!',        'Completou todas as 52 semanas',                 500, 'lendario',   'desafio52'),
  ('amortizou_simulou',   '📐 Simulou Amortização',         'Usou o simulador de amortização inteligente',    30, 'incomum',    'v3'),
  ('reserva_spec_completa','🛡️ Reserva Completa',           'Completou uma reserva especializada',           100, 'raro',       'reservas'),
  ('multi_reserva_criada', '🗂️ Múltiplas Reservas',         'Criou uma reserva especializada',                20, 'comum',      'reservas'),
  ('multi_3_reservas',    '🏦 Gestor de Reservas',           'Possui 3 ou mais reservas ativas',             100, 'epico',      'reservas'),
  ('analista',            '📊 Analista Financeiro',          'Consultou o relatório anual',                    30, 'incomum',    'analises'),
  ('tagger',              '🏷️ Organizador',                 'Usou tags em 5 ou mais despesas',                40, 'incomum',    'habitos');
