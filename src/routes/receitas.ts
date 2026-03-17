import { Hono } from 'hono'
import { requireAuth } from './auth'
import { getLimites, MSG_UPGRADE } from './planos'

type Bindings = { DB: D1Database }
type Variables = { user: { id: number; nome: string; email: string; plano: string } }

const receitas = new Hono<{ Bindings: Bindings; Variables: Variables }>()

// GET /api/receitas
receitas.get('/', requireAuth, async (c) => {
  const user = c.get('user')
  const { mes, ano, categoria, limit = '50', offset = '0' } = c.req.query()

  let query = 'SELECT * FROM receitas WHERE user_id = ?'
  const params: any[] = [user.id]

  if (mes && ano) {
    query += ' AND strftime("%m", data) = ? AND strftime("%Y", data) = ?'
    params.push(mes.padStart(2, '0'), ano)
  } else if (ano) {
    query += ' AND strftime("%Y", data) = ?'
    params.push(ano)
  }

  if (categoria) {
    query += ' AND categoria = ?'
    params.push(categoria)
  }

  query += ' ORDER BY data DESC LIMIT ? OFFSET ?'
  params.push(parseInt(limit), parseInt(offset))

  const result = await c.env.DB.prepare(query).bind(...params).all()
  
  // Total do período
  let totalQuery = 'SELECT COALESCE(SUM(valor), 0) as total FROM receitas WHERE user_id = ?'
  const totalParams: any[] = [user.id]
  if (mes && ano) {
    totalQuery += ' AND strftime("%m", data) = ? AND strftime("%Y", data) = ?'
    totalParams.push(mes.padStart(2, '0'), ano)
  }
  const total = await c.env.DB.prepare(totalQuery).bind(...totalParams).first() as any

  return c.json({ 
    receitas: result.results, 
    total: total?.total || 0,
    count: result.results.length 
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
  const { descricao, data, categoria, valor, recorrente = false, frequencia, observacoes } = body

  if (!descricao || !data || !categoria || valor === undefined) {
    return c.json({ error: 'Campos obrigatórios: descricao, data, categoria, valor' }, 400)
  }

  const valorNum = parseFloat(valor)
  if (isNaN(valorNum) || valorNum < 0) {
    return c.json({ error: 'Valor inválido — deve ser um número positivo' }, 400)
  }

  const result = await c.env.DB.prepare(
    'INSERT INTO receitas (user_id, descricao, data, categoria, valor, recorrente, frequencia, observacoes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(user.id, descricao, data, categoria, valorNum, recorrente ? 1 : 0, frequencia || null, observacoes || null).run()

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
  const { descricao, data, categoria, valor, recorrente, frequencia, observacoes } = body

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
    'UPDATE receitas SET descricao = ?, data = ?, categoria = ?, valor = ?, recorrente = ?, frequencia = ?, observacoes = ? WHERE id = ? AND user_id = ?'
  ).bind(descricao, data, categoria, valorNum, recorrente ? 1 : 0, frequencia || null, observacoes || null, id, user.id).run()

  return c.json({ success: true, message: 'Receita atualizada!' })
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
