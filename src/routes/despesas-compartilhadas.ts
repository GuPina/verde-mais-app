// BUG 1.5 — src/routes/despesas-compartilhadas.ts
// CRUD completo para shared_expenses (despesas compartilhadas entre pessoas)

import { Hono } from 'hono'
import { requireAuth } from './auth'

type Bindings = { DB: D1Database }
type Variables = { user: { id: number; nome: string; email: string; plano: string } }

const despesasCompartilhadas = new Hono<{ Bindings: Bindings; Variables: Variables }>()

// GET /api/despesas-compartilhadas
despesasCompartilhadas.get('/', requireAuth, async (c) => {
  const user = c.get('user')
  const { status, limit = '50', offset = '0' } = c.req.query()

  let sql = `
    SELECT * FROM shared_expenses
    WHERE user_id = ?
  `
  const params: any[] = [user.id]

  if (status) {
    sql += ' AND status = ?'
    params.push(status)
  }

  sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?'
  params.push(parseInt(limit), parseInt(offset))

  const result = await c.env.DB.prepare(sql).bind(...params).all()
  const rows = result.results as any[]

  // Para cada despesa compartilhada, buscar os participantes
  const despesasComDetalhes = await Promise.all(rows.map(async (desp) => {
    // Parsear participantes (stored as JSON string)
    let participantes = []
    try {
      participantes = JSON.parse(desp.participants || '[]')
    } catch (_) {
      participantes = []
    }
    return { ...desp, participantes }
  }))

  // Resumo
  const totalCount = await c.env.DB.prepare(
    'SELECT COUNT(*) as n FROM shared_expenses WHERE user_id = ?'
  ).bind(user.id).first() as any

  const totalValor = await c.env.DB.prepare(
    `SELECT COALESCE(SUM(total_amount), 0) as total FROM shared_expenses WHERE user_id = ?`
  ).bind(user.id).first() as any

  const pendente = await c.env.DB.prepare(
    `SELECT COALESCE(SUM(total_amount), 0) as total FROM shared_expenses WHERE user_id = ? AND status = 'pending'`
  ).bind(user.id).first() as any

  return c.json({
    despesas: despesasComDetalhes,
    resumo: {
      total: totalCount?.n || 0,
      valor_total: parseFloat(totalValor?.total || 0),
      valor_pendente: parseFloat(pendente?.total || 0)
    }
  })
})

// POST /api/despesas-compartilhadas
despesasCompartilhadas.post('/', requireAuth, async (c) => {
  const user = c.get('user')
  const body = await c.req.json()

  const {
    descricao,
    total_amount,
    data,
    categoria = 'Outros',
    participantes = [], // Array de { nome, email?, valor_devido }
    minha_parte,
    status = 'pending',
    observacoes,
    registrar_como_despesa = false
  } = body

  if (!descricao || !total_amount || !data) {
    return c.json({ error: 'Campos obrigatórios: descricao, total_amount, data' }, 400)
  }

  const totalAmount = parseFloat(total_amount)
  const minhaParteCalc = minha_parte ? parseFloat(minha_parte) : (totalAmount / (participantes.length + 1))

  const result = await c.env.DB.prepare(`
    INSERT INTO shared_expenses (
      user_id, description, total_amount, my_share, status,
      participants, split_type, notes, expense_date, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'equal', ?, ?, CURRENT_TIMESTAMP)
  `).bind(
    user.id,
    descricao,
    totalAmount,
    Math.round(minhaParteCalc * 100) / 100,
    status,
    JSON.stringify(participantes),
    observacoes || null,
    data
  ).run()

  const novoId = result.meta.last_row_id

  // Opcionalmente registrar minha parte como despesa regular
  if (registrar_como_despesa && minhaParteCalc > 0) {
    await c.env.DB.prepare(`
      INSERT INTO despesas (user_id, descricao, data, categoria, valor, status, meio_pagamento, observacoes)
      VALUES (?, ?, ?, ?, ?, 'pago', 'outros', ?)
    `).bind(
      user.id,
      `Despesa compartilhada: ${descricao}`,
      data,
      categoria,
      Math.round(minhaParteCalc * 100) / 100,
      `Despesa compartilhada com ${participantes.length} pessoa(s)`
    ).run()
  }

  return c.json({
    success: true,
    id: novoId,
    message: 'Despesa compartilhada criada!',
    minha_parte: Math.round(minhaParteCalc * 100) / 100
  }, 201)
})

// GET /api/despesas-compartilhadas/:id
despesasCompartilhadas.get('/:id', requireAuth, async (c) => {
  const user = c.get('user')
  const id = c.req.param('id')

  const desp = await c.env.DB.prepare(
    'SELECT * FROM shared_expenses WHERE id = ? AND user_id = ?'
  ).bind(id, user.id).first() as any

  if (!desp) return c.json({ error: 'Despesa compartilhada não encontrada' }, 404)

  let participantes = []
  try { participantes = JSON.parse(desp.participants || '[]') } catch (_) {}

  return c.json({ ...desp, participantes })
})

// PUT /api/despesas-compartilhadas/:id
despesasCompartilhadas.put('/:id', requireAuth, async (c) => {
  const user = c.get('user')
  const id = c.req.param('id')

  const existing = await c.env.DB.prepare(
    'SELECT id FROM shared_expenses WHERE id = ? AND user_id = ?'
  ).bind(id, user.id).first()
  if (!existing) return c.json({ error: 'Despesa compartilhada não encontrada' }, 404)

  const body = await c.req.json()
  const {
    descricao, total_amount, data, status, participantes, minha_parte, observacoes
  } = body

  await c.env.DB.prepare(`
    UPDATE shared_expenses SET
      description = COALESCE(?, description),
      total_amount = COALESCE(?, total_amount),
      my_share = COALESCE(?, my_share),
      status = COALESCE(?, status),
      participants = COALESCE(?, participants),
      notes = COALESCE(?, notes),
      expense_date = COALESCE(?, expense_date)
    WHERE id = ? AND user_id = ?
  `).bind(
    descricao || null,
    total_amount ? parseFloat(total_amount) : null,
    minha_parte ? parseFloat(minha_parte) : null,
    status || null,
    participantes ? JSON.stringify(participantes) : null,
    observacoes || null,
    data || null,
    id, user.id
  ).run()

  return c.json({ success: true, message: 'Despesa compartilhada atualizada!' })
})

// PATCH /api/despesas-compartilhadas/:id/status
despesasCompartilhadas.patch('/:id/status', requireAuth, async (c) => {
  const user = c.get('user')
  const id = c.req.param('id')
  const { status } = await c.req.json()

  const validStatus = ['pending', 'paid', 'cancelled', 'partial']
  if (!validStatus.includes(status)) {
    return c.json({ error: `Status inválido. Use: ${validStatus.join(', ')}` }, 400)
  }

  const existing = await c.env.DB.prepare(
    'SELECT id FROM shared_expenses WHERE id = ? AND user_id = ?'
  ).bind(id, user.id).first()
  if (!existing) return c.json({ error: 'Despesa compartilhada não encontrada' }, 404)

  await c.env.DB.prepare(
    'UPDATE shared_expenses SET status = ? WHERE id = ? AND user_id = ?'
  ).bind(status, id, user.id).run()

  return c.json({ success: true, message: `Status atualizado para: ${status}` })
})

// DELETE /api/despesas-compartilhadas/:id
despesasCompartilhadas.delete('/:id', requireAuth, async (c) => {
  const user = c.get('user')
  const id = c.req.param('id')

  const existing = await c.env.DB.prepare(
    'SELECT id FROM shared_expenses WHERE id = ? AND user_id = ?'
  ).bind(id, user.id).first()
  if (!existing) return c.json({ error: 'Despesa compartilhada não encontrada' }, 404)

  await c.env.DB.prepare(
    'DELETE FROM shared_expenses WHERE id = ? AND user_id = ?'
  ).bind(id, user.id).run()

  return c.json({ success: true, message: 'Despesa compartilhada excluída!' })
})

// GET /api/despesas-compartilhadas/resumo/pendencias
// Retorna quem te deve e quanto você deve
despesasCompartilhadas.get('/resumo/pendencias', requireAuth, async (c) => {
  const user = c.get('user')

  const pending = await c.env.DB.prepare(`
    SELECT description, total_amount, my_share, participants, expense_date
    FROM shared_expenses
    WHERE user_id = ? AND status = 'pending'
    ORDER BY expense_date DESC
  `).bind(user.id).all()

  const rows = pending.results as any[]
  let totalDevido = 0
  let totalAReceber = 0

  const detalhes = rows.map(row => {
    let participantes = []
    try { participantes = JSON.parse(row.participants || '[]') } catch (_) {}

    // Calcular quanto outros devem (total - minha parte)
    const aReceber = Math.max(0, parseFloat(row.total_amount) - parseFloat(row.my_share))
    totalAReceber += aReceber
    totalDevido += parseFloat(row.my_share)

    return {
      descricao: row.description,
      total: row.total_amount,
      minha_parte: row.my_share,
      a_receber: Math.round(aReceber * 100) / 100,
      participantes,
      data: row.expense_date
    }
  })

  return c.json({
    pendencias: detalhes,
    resumo: {
      total_itens: rows.length,
      total_a_pagar: Math.round(totalDevido * 100) / 100,
      total_a_receber: Math.round(totalAReceber * 100) / 100,
      saldo_liquido: Math.round((totalAReceber - totalDevido) * 100) / 100
    }
  })
})

export default despesasCompartilhadas
