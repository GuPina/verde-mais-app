import { Hono } from 'hono'
import { requireAuth } from './auth'

type Bindings  = { DB: D1Database }
type Variables = { user: { id: number; nome: string; plano: string } }

async function verificarConquista(db: D1Database, userId: number, codigo: string) {
  await db.prepare(
    `INSERT OR IGNORE INTO conquistas_usuario (user_id, conquista_codigo, data_conquista, visualizado)
     VALUES (?, ?, datetime('now'), 0)`
  ).bind(userId, codigo).run().catch(() => {})
}

const tags = new Hono<{ Bindings: Bindings; Variables: Variables }>()

// ─── GET /api/tags ───────────────────────────────────────────────────────────
tags.get('/', requireAuth, async (c) => {
  const user = c.get('user')
  const rows = await c.env.DB.prepare(
    `SELECT t.id, t.nome, t.cor,
            COUNT(dt.despesa_id) as usos
     FROM tags t
     LEFT JOIN despesa_tags dt ON dt.tag_id = t.id
     WHERE t.user_id = ?
     GROUP BY t.id
     ORDER BY usos DESC, t.nome ASC`
  ).bind(user.id).all<{id:number;nome:string;cor:string;usos:number}>()

  return c.json(rows.results || [])
})

// ─── POST /api/tags ──────────────────────────────────────────────────────────
tags.post('/', requireAuth, async (c) => {
  const user = c.get('user')
  const { nome, cor = '#10B981' } = await c.req.json()

  if (!nome || nome.trim().length < 1) {
    return c.json({ error: 'Nome da tag é obrigatório' }, 400)
  }
  if (nome.trim().length > 30) {
    return c.json({ error: 'Nome da tag deve ter até 30 caracteres' }, 400)
  }
  if (!/^#[0-9A-Fa-f]{6}$/.test(cor)) {
    return c.json({ error: 'Cor inválida (use formato hex #RRGGBB)' }, 400)
  }

  try {
    await c.env.DB.prepare(
      `INSERT INTO tags (user_id, nome, cor) VALUES (?, ?, ?)`
    ).bind(user.id, nome.trim(), cor).run()

    const created = await c.env.DB.prepare(
      `SELECT id, nome, cor FROM tags WHERE user_id=? AND nome=? ORDER BY id DESC LIMIT 1`
    ).bind(user.id, nome.trim()).first<{id:number;nome:string;cor:string}>()

    // Bloco 5: conquista primeira_tag
    const totalTags = await c.env.DB.prepare(
      `SELECT COUNT(*) as cnt FROM tags WHERE user_id=?`
    ).bind(user.id).first() as any
    if ((totalTags?.cnt || 0) >= 1) await verificarConquista(c.env.DB, user.id, 'primeira_tag')

    return c.json(created, 201)
  } catch (e: any) {
    if (e?.message?.includes('UNIQUE')) {
      return c.json({ error: 'Você já tem uma tag com esse nome' }, 409)
    }
    throw e
  }
})

// ─── PATCH /api/tags/:id ─────────────────────────────────────────────────────
tags.patch('/:id', requireAuth, async (c) => {
  const user   = c.get('user')
  const tagId  = parseInt(c.req.param('id'))
  const { nome, cor } = await c.req.json()

  const tag = await c.env.DB.prepare(
    `SELECT id FROM tags WHERE id=? AND user_id=?`
  ).bind(tagId, user.id).first()

  if (!tag) return c.json({ error: 'Tag não encontrada' }, 404)

  const updates: string[] = []
  const vals: any[] = []
  if (nome) { updates.push('nome=?'); vals.push(nome.trim()) }
  if (cor)  { updates.push('cor=?');  vals.push(cor) }
  if (!updates.length) return c.json({ error: 'Nada a atualizar' }, 400)

  vals.push(tagId, user.id)
  await c.env.DB.prepare(
    `UPDATE tags SET ${updates.join(',')} WHERE id=? AND user_id=?`
  ).bind(...vals).run()

  return c.json({ success: true })
})

// ─── DELETE /api/tags/:id ────────────────────────────────────────────────────
tags.delete('/:id', requireAuth, async (c) => {
  const user  = c.get('user')
  const tagId = parseInt(c.req.param('id'))

  const tag = await c.env.DB.prepare(
    `SELECT id FROM tags WHERE id=? AND user_id=?`
  ).bind(tagId, user.id).first()

  if (!tag) return c.json({ error: 'Tag não encontrada' }, 404)

  // Desvincular antes de remover (CASCADE faz isso, mas explicitando)
  await c.env.DB.prepare(`DELETE FROM despesa_tags WHERE tag_id=?`).bind(tagId).run()
  await c.env.DB.prepare(`DELETE FROM tags WHERE id=? AND user_id=?`).bind(tagId, user.id).run()

  return c.json({ success: true })
})

// ─── POST /api/tags/despesa/:despesaId ───────────────────────────────────────
// Vincular tags a uma despesa (substitui as existentes)
tags.post('/despesa/:despesaId', requireAuth, async (c) => {
  const user      = c.get('user')
  const despesaId = parseInt(c.req.param('despesaId'))
  const { tag_ids } = await c.req.json() as { tag_ids: number[] }

  // Verificar que a despesa pertence ao usuário
  const despesa = await c.env.DB.prepare(
    `SELECT id FROM despesas WHERE id=? AND user_id=?`
  ).bind(despesaId, user.id).first()

  if (!despesa) return c.json({ error: 'Despesa não encontrada' }, 404)

  // Verificar que as tags pertencem ao usuário
  if (tag_ids && tag_ids.length > 0) {
    const tagRows = await c.env.DB.prepare(
      `SELECT id FROM tags WHERE id IN (${tag_ids.map(() => '?').join(',')}) AND user_id=?`
    ).bind(...tag_ids, user.id).all<{id:number}>()

    if ((tagRows.results?.length || 0) !== tag_ids.length) {
      return c.json({ error: 'Uma ou mais tags inválidas' }, 400)
    }
  }

  // Limpar vínculos anteriores
  await c.env.DB.prepare(
    `DELETE FROM despesa_tags WHERE despesa_id=?`
  ).bind(despesaId).run()

  // Inserir novos vínculos
  if (tag_ids && tag_ids.length > 0) {
    for (const tid of tag_ids) {
      await c.env.DB.prepare(
        `INSERT OR IGNORE INTO despesa_tags (despesa_id, tag_id) VALUES (?, ?)`
      ).bind(despesaId, tid).run()
    }

    // Conquista: 5+ tags em uso
    const totalTagged = await c.env.DB.prepare(
      `SELECT COUNT(DISTINCT despesa_id) as cnt FROM despesa_tags dt
       JOIN despesas d ON d.id = dt.despesa_id WHERE d.user_id=?`
    ).bind(user.id).first<{cnt:number}>()

    if ((totalTagged?.cnt || 0) >= 5) {
      await c.env.DB.prepare(
        `INSERT OR IGNORE INTO conquistas_usuario (user_id, conquista_codigo, data_conquista, visualizado)
         VALUES (?, 'tagger', datetime('now'), 0)`
      ).bind(user.id).run().catch(() => {})
    }

    // Bloco 5: mestre_tags — classificou 50+ despesas com tags
    if ((totalTagged?.cnt || 0) >= 50) {
      await verificarConquista(c.env.DB, user.id, 'mestre_tags')
    }
  }

  return c.json({ success: true, vinculadas: tag_ids?.length || 0 })
})

// ─── GET /api/tags/despesa/:despesaId ────────────────────────────────────────
tags.get('/despesa/:despesaId', requireAuth, async (c) => {
  const user      = c.get('user')
  const despesaId = parseInt(c.req.param('despesaId'))

  const despesa = await c.env.DB.prepare(
    `SELECT id FROM despesas WHERE id=? AND user_id=?`
  ).bind(despesaId, user.id).first()

  if (!despesa) return c.json({ error: 'Despesa não encontrada' }, 404)

  const rows = await c.env.DB.prepare(
    `SELECT t.id, t.nome, t.cor FROM tags t
     JOIN despesa_tags dt ON dt.tag_id = t.id
     WHERE dt.despesa_id=?`
  ).bind(despesaId).all<{id:number;nome:string;cor:string}>()

  return c.json(rows.results || [])
})

// ─── GET /api/tags/buscar?q=texto ────────────────────────────────────────────
// Buscar despesas por tag
tags.get('/buscar', requireAuth, async (c) => {
  const user   = c.get('user')
  const tagId  = parseInt(c.req.query('tag_id') || '0')
  const q      = c.req.query('q') || ''

  if (!tagId && !q) return c.json({ error: 'Informe tag_id ou q' }, 400)

  let rows
  if (tagId) {
    rows = await c.env.DB.prepare(
      `SELECT d.*, t.nome as tag_nome, t.cor as tag_cor
       FROM despesas d
       JOIN despesa_tags dt ON dt.despesa_id = d.id
       JOIN tags t ON t.id = dt.tag_id
       WHERE d.user_id=? AND t.id=?
       ORDER BY d.data DESC
       LIMIT 100`
    ).bind(user.id, tagId).all()
  } else {
    rows = await c.env.DB.prepare(
      `SELECT d.*, t.nome as tag_nome, t.cor as tag_cor
       FROM despesas d
       JOIN despesa_tags dt ON dt.despesa_id = d.id
       JOIN tags t ON t.id = dt.tag_id
       WHERE d.user_id=? AND t.nome LIKE ?
       ORDER BY d.data DESC
       LIMIT 100`
    ).bind(user.id, `%${q}%`).all()
  }

  return c.json(rows.results || [])
})

// ─── MELHORIA 3.3: Tags para Receitas ────────────────────────────────────────

// POST /api/tags/receita/:receitaId — vincular tag a receita
tags.post('/receita/:receitaId', requireAuth, async (c) => {
  const user     = c.get('user')
  const receitaId = parseInt(c.req.param('receitaId'))
  const { tag_ids } = await c.req.json() as { tag_ids: number[] }

  const receita = await c.env.DB.prepare(
    `SELECT id FROM receitas WHERE id=? AND user_id=?`
  ).bind(receitaId, user.id).first()
  if (!receita) return c.json({ error: 'Receita não encontrada' }, 404)

  // Verificar tags do usuário
  if (tag_ids && tag_ids.length > 0) {
    const tagRows = await c.env.DB.prepare(
      `SELECT id FROM tags WHERE id IN (${tag_ids.map(() => '?').join(',')}) AND user_id=?`
    ).bind(...tag_ids, user.id).all<{id:number}>()
    if ((tagRows.results?.length || 0) !== tag_ids.length) {
      return c.json({ error: 'Uma ou mais tags inválidas' }, 400)
    }
  }

  // Limpar e reinserir
  await c.env.DB.prepare(`DELETE FROM receita_tags WHERE receita_id=?`).bind(receitaId).run()
  if (tag_ids && tag_ids.length > 0) {
    for (const tid of tag_ids) {
      await c.env.DB.prepare(
        `INSERT OR IGNORE INTO receita_tags (receita_id, tag_id) VALUES (?, ?)`
      ).bind(receitaId, tid).run()
    }
  }

  return c.json({ success: true, vinculadas: tag_ids?.length || 0 })
})

// GET /api/tags/receita/:receitaId — buscar tags de uma receita
tags.get('/receita/:receitaId', requireAuth, async (c) => {
  const user     = c.get('user')
  const receitaId = parseInt(c.req.param('receitaId'))

  const receita = await c.env.DB.prepare(
    `SELECT id FROM receitas WHERE id=? AND user_id=?`
  ).bind(receitaId, user.id).first()
  if (!receita) return c.json({ error: 'Receita não encontrada' }, 404)

  const rows = await c.env.DB.prepare(
    `SELECT t.id, t.nome, t.cor FROM tags t
     JOIN receita_tags rt ON rt.tag_id = t.id
     WHERE rt.receita_id=?`
  ).bind(receitaId).all<{id:number;nome:string;cor:string}>()

  return c.json(rows.results || [])
})

// GET /api/tags/analise — Top gastos por tag (Melhoria 3.3 Dashboard)
tags.get('/analise', requireAuth, async (c) => {
  const user = c.get('user')
  const { mes, ano, limit = '10' } = c.req.query()
  const mesStr = mes ? String(mes).padStart(2, '0') : null
  const anoStr = ano || null

  let sql = `
    SELECT t.id, t.nome, t.cor,
           COUNT(DISTINCT dt.despesa_id) as qtd_despesas,
           COALESCE(SUM(d.valor), 0) as total_gasto
    FROM tags t
    JOIN despesa_tags dt ON dt.tag_id = t.id
    JOIN despesas d ON d.id = dt.despesa_id
    WHERE t.user_id = ? AND d.user_id = ?
  `
  const params: any[] = [user.id, user.id]

  if (mesStr && anoStr) {
    sql += ` AND strftime('%m', COALESCE(d.vencimento, d.data)) = ? AND strftime('%Y', COALESCE(d.vencimento, d.data)) = ?`
    params.push(mesStr, anoStr)
  }

  sql += ` GROUP BY t.id ORDER BY total_gasto DESC LIMIT ?`
  params.push(parseInt(limit))

  const rows = await c.env.DB.prepare(sql).bind(...params).all()
  return c.json({ tags_analise: rows.results || [] })
})

export default tags
