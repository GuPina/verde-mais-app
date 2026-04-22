import { Hono } from 'hono'
import { requireAuth } from './auth'
import { getLimites, MSG_UPGRADE } from './planos'

type Bindings = { DB: D1Database }
type Variables = { user: { id: number; nome: string; email: string; plano: string } }

const receitas = new Hono<{ Bindings: Bindings; Variables: Variables }>()

// GET /api/receitas
receitas.get('/', requireAuth, async (c) => {
  const user = c.get('user')
  const { mes, ano, categoria, busca, limit = '50', offset = '0' } = c.req.query()

  // Filtros dinâmicos
  const filtrosMes = (mes && ano)
    ? ` AND strftime('%m', data) = '${mes.padStart(2, '0')}' AND strftime('%Y', data) = '${ano}'`
    : ano ? ` AND strftime('%Y', data) = '${ano}'` : ''
  const filtroCategoria = categoria ? ` AND categoria = '${categoria.replace(/'/g, "''")}'` : ''
  const filtroBusca = busca ? ` AND descricao LIKE '%${busca.replace(/'/g, "''").replace(/%/g, '\\%')}%'` : ''
  const filtros = filtrosMes + filtroCategoria + filtroBusca

  // Buscar registros + métricas em batch
  const [resultR, metricsR, catBreakdownR] = await c.env.DB.batch([
    c.env.DB.prepare(
      `SELECT * FROM receitas WHERE user_id = ?${filtros} ORDER BY data DESC LIMIT ? OFFSET ?`
    ).bind(user.id, parseInt(limit), parseInt(offset)),
    c.env.DB.prepare(
      `SELECT COALESCE(SUM(valor), 0) as total,
              COUNT(*) as total_count,
              COALESCE(AVG(valor), 0) as media,
              COALESCE(MAX(valor), 0) as maior,
              COALESCE(MIN(valor), 0) as menor,
              SUM(CASE WHEN recorrente = 1 THEN valor ELSE 0 END) as total_recorrente,
              SUM(CASE WHEN recorrente = 0 OR recorrente IS NULL THEN valor ELSE 0 END) as total_avulso
       FROM receitas WHERE user_id = ?${filtros}`
    ).bind(user.id),
    c.env.DB.prepare(
      `SELECT categoria, COALESCE(SUM(valor), 0) as total, COUNT(*) as qtd
       FROM receitas WHERE user_id = ?${filtrosMes}
       GROUP BY categoria ORDER BY total DESC`
    ).bind(user.id),
  ])

  const metrics = (metricsR.results?.[0] ?? metricsR) as any
  const catBreakdown = catBreakdownR.results || []

  return c.json({ 
    receitas: resultR.results || [], 
    total: metrics?.total || 0,
    count: (resultR.results || []).length,
    total_count: metrics?.total_count || 0,
    metrics: {
      total: Math.round((metrics?.total || 0) * 100) / 100,
      media: Math.round((metrics?.media || 0) * 100) / 100,
      maior: Math.round((metrics?.maior || 0) * 100) / 100,
      menor: Math.round((metrics?.menor || 0) * 100) / 100,
      total_recorrente: Math.round((metrics?.total_recorrente || 0) * 100) / 100,
      total_avulso: Math.round((metrics?.total_avulso || 0) * 100) / 100,
      count: metrics?.total_count || 0
    },
    categorias_breakdown: catBreakdown
  })
})

// POST /api/receitas
receitas.post('/', requireAuth, async (c) => {
  const user = c.get('user')

  // ── Limite de plano ──
  const lim = getLimites(user.plano)
  if (lim.receitas_mes !== Infinity) {
    const now = new Date()
    const mes = String(now.getMonth() + 1).padStart(2, '0')
    const ano = String(now.getFullYear())
    const count = await c.env.DB.prepare(
      `SELECT COUNT(*) as n FROM receitas WHERE user_id = ? AND strftime('%m', data) = ? AND strftime('%Y', data) = ?`
    ).bind(user.id, mes, ano).first() as any
    if ((count?.n || 0) >= lim.receitas_mes)
      return c.json({ error: MSG_UPGRADE.receitas_mes, upgrade: true, limite: lim.receitas_mes, feature: 'receitas_mes' }, 403)
  }

  const body = await c.req.json()
  const { descricao, data, categoria, valor, recorrente = false, frequencia, observacoes, meio_pagamento } = body

  if (!descricao || !data || !categoria || valor === undefined) {
    return c.json({ error: 'Campos obrigatórios: descricao, data, categoria, valor' }, 400)
  }

  const valorNum = parseFloat(valor)
  if (isNaN(valorNum) || valorNum < 0) {
    return c.json({ error: 'Valor inválido — deve ser um número positivo' }, 400)
  }

  const result = await c.env.DB.prepare(
    'INSERT INTO receitas (user_id, descricao, data, categoria, valor, recorrente, frequencia, observacoes, meio_pagamento) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(user.id, descricao, data, categoria, valorNum, recorrente ? 1 : 0, frequencia || null, observacoes || null, meio_pagamento || 'pix').run()

  // Conquista: primeira receita
  try {
    await c.env.DB.prepare('INSERT OR IGNORE INTO conquistas_usuario (user_id, conquista_codigo, visualizado) VALUES (?, ?, 0)').bind(user.id, 'primeira_receita').run()
  } catch {}

  return c.json({ success: true, id: result.meta.last_row_id, message: 'Receita adicionada!' }, 201)
})

// PUT /api/receitas/:id
receitas.put('/:id', requireAuth, async (c) => {
  const user = c.get('user')
  const id = c.req.param('id')
  const body = await c.req.json()
  const { descricao, data, categoria, valor, recorrente, frequencia, observacoes, meio_pagamento } = body

  if (!descricao || !data || !categoria || valor === undefined) {
    return c.json({ error: 'Campos obrigatórios: descricao, data, categoria, valor' }, 400)
  }

  const valorNum = parseFloat(valor)
  if (isNaN(valorNum) || valorNum < 0) {
    return c.json({ error: 'Valor inválido — deve ser um número positivo' }, 400)
  }

  const existing = await c.env.DB.prepare('SELECT id FROM receitas WHERE id = ? AND user_id = ?').bind(id, user.id).first()
  if (!existing) return c.json({ error: 'Receita não encontrada' }, 404)

  await c.env.DB.prepare(
    'UPDATE receitas SET descricao = ?, data = ?, categoria = ?, valor = ?, recorrente = ?, frequencia = ?, observacoes = ?, meio_pagamento = ? WHERE id = ? AND user_id = ?'
  ).bind(descricao, data, categoria, valorNum, recorrente ? 1 : 0, frequencia || null, observacoes || null, meio_pagamento || null, id, user.id).run()

  return c.json({ success: true, message: 'Receita atualizada!' })
})

// DELETE /api/receitas/bulk — excluir múltiplas receitas de uma vez
receitas.delete('/bulk', requireAuth, async (c) => {
  const user = c.get('user')
  const body = await c.req.json().catch(() => null)
  const ids: number[] = body?.ids || []
  if (!ids.length) return c.json({ error: 'Nenhum id informado.' }, 400)
  if (ids.length > 200) return c.json({ error: 'Máximo 200 itens por vez.' }, 400)

  let excluidas = 0
  for (const id of ids) {
    const existing = await c.env.DB.prepare(
      'SELECT id FROM receitas WHERE id = ? AND user_id = ?'
    ).bind(id, user.id).first()
    if (!existing) continue
    await c.env.DB.prepare('DELETE FROM receitas WHERE id = ? AND user_id = ?').bind(id, user.id).run()
    excluidas++
  }

  return c.json({ success: true, excluidas, message: `${excluidas} receita(s) excluída(s).` })
})

// DELETE /api/receitas/:id
receitas.delete('/:id', requireAuth, async (c) => {
  const user = c.get('user')
  const id = c.req.param('id')

  const existing = await c.env.DB.prepare('SELECT id FROM receitas WHERE id = ? AND user_id = ?').bind(id, user.id).first()
  if (!existing) return c.json({ error: 'Receita não encontrada' }, 404)

  await c.env.DB.prepare('DELETE FROM receitas WHERE id = ? AND user_id = ?').bind(id, user.id).run()
  return c.json({ success: true, message: 'Receita excluída!' })
})

// GET /api/receitas/categorias
receitas.get('/categorias', requireAuth, async (c) => {
  const user = c.get('user')
  const result = await c.env.DB.prepare(
    'SELECT categoria, COALESCE(SUM(valor), 0) as total, COUNT(*) as count FROM receitas WHERE user_id = ? GROUP BY categoria ORDER BY total DESC'
  ).bind(user.id).all()
  return c.json({ categorias: result.results })
})

export default receitas
