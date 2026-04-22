/**
 * Helper de Tags Automáticas — VerdeMais
 *
 * Responsável por:
 * 1. Garantir que uma tag existe (cria se não existir)
 * 2. Vincular tag a despesas (despesa_tags)
 * 3. Vincular tag a receitas (receita_tags)
 * 4. Vincular tag a investimentos (investimento_tags)
 * 5. Verificar se o módulo tem tags automáticas ativas
 */

export type DB = D1Database

// Paleta de cores por módulo
export const COR_MODULO: Record<string, string> = {
  emprestimo:    '#F43F5E', // vermelho
  financiamento: '#F97316', // laranja
  investimento:  '#10B981', // verde
  meta:          '#6366F1', // índigo
  reserva:       '#0EA5E9', // azul
  recorrencia:   '#8B5CF6', // roxo
  receita:       '#22C55E', // verde claro
  aporte:        '#14B8A6', // teal
}

/**
 * Garante que uma tag existe para o usuário.
 * Se não existir, cria com a cor do módulo.
 * Retorna o id da tag.
 */
export async function ensureTag(
  db: DB,
  userId: number,
  nome: string,
  cor: string = '#10B981'
): Promise<number> {
  const nomeClean = nome.trim().slice(0, 30)

  // Tenta buscar tag existente (case-insensitive)
  const existing = await db.prepare(
    `SELECT id FROM tags WHERE user_id = ? AND LOWER(nome) = LOWER(?)`
  ).bind(userId, nomeClean).first<{ id: number }>()

  if (existing) return existing.id

  // Cria a tag
  await db.prepare(
    `INSERT OR IGNORE INTO tags (user_id, nome, cor) VALUES (?, ?, ?)`
  ).bind(userId, nomeClean, cor).run()

  const created = await db.prepare(
    `SELECT id FROM tags WHERE user_id = ? AND LOWER(nome) = LOWER(?)`
  ).bind(userId, nomeClean).first<{ id: number }>()

  return created?.id ?? 0
}

/**
 * Vincula uma tag a uma despesa (idempotente — ignora duplicatas)
 */
export async function tagDespesa(db: DB, despesaId: number, tagId: number): Promise<void> {
  if (!despesaId || !tagId) return
  await db.prepare(
    `INSERT OR IGNORE INTO despesa_tags (despesa_id, tag_id) VALUES (?, ?)`
  ).bind(despesaId, tagId).run().catch(() => {})
}

/**
 * Vincula uma tag a uma receita (idempotente)
 */
export async function tagReceita(db: DB, receitaId: number, tagId: number): Promise<void> {
  if (!receitaId || !tagId) return
  await db.prepare(
    `INSERT OR IGNORE INTO receita_tags (receita_id, tag_id) VALUES (?, ?)`
  ).bind(receitaId, tagId).run().catch(() => {})
}

/**
 * Vincula uma tag a um investimento (idempotente)
 */
export async function tagInvestimento(db: DB, investimentoId: number, tagId: number): Promise<void> {
  if (!investimentoId || !tagId) return
  await db.prepare(
    `INSERT OR IGNORE INTO investimento_tags (investimento_id, tag_id) VALUES (?, ?)`
  ).bind(investimentoId, tagId).run().catch(() => {})
}

/**
 * Verifica se tags automáticas estão ativas para o módulo (default: true)
 */
export async function tagsAutoAtivas(db: DB, userId: number, modulo: string): Promise<boolean> {
  const row = await db.prepare(
    `SELECT ativo FROM tags_auto_config WHERE user_id = ? AND modulo = ?`
  ).bind(userId, modulo).first<{ ativo: number }>()
  // Se não houver configuração, assume ativo por padrão
  return row ? row.ativo === 1 : true
}

/**
 * Aplica tags automáticas para todas as despesas geradas por um módulo
 * (vincula a despesa com a tag do módulo e uma tag com o nome/descrição do item)
 */
export async function aplicarTagsModulo(
  db: DB,
  userId: number,
  modulo: string,
  nomeItem: string,
  despesaIds: number[]
): Promise<void> {
  // Verificar se está ativo
  const ativo = await tagsAutoAtivas(db, userId, modulo)
  if (!ativo) return

  const cor = COR_MODULO[modulo] || '#10B981'

  // Tag do módulo (ex: "Empréstimo", "Financiamento")
  const nomeModulo = modulo.charAt(0).toUpperCase() + modulo.slice(1)
  const tagModuloId = await ensureTag(db, userId, nomeModulo, cor)

  // Tag com o nome do item (ex: "Carro Popular", "Apartamento")
  const tagItemId = nomeItem ? await ensureTag(db, userId, nomeItem.trim().slice(0, 30), cor) : 0

  for (const despId of despesaIds) {
    if (tagModuloId) await tagDespesa(db, despId, tagModuloId)
    if (tagItemId && tagItemId !== tagModuloId) await tagDespesa(db, despId, tagItemId)
  }
}
