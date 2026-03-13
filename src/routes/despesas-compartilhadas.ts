// BUG 1.5 — src/routes/despesas-compartilhadas.ts
// CRUD adaptado à estrutura real da tabela shared_expenses
// Colunas reais: id, expense_id, user_id, partner_name, partner_email, user_percentage, partner_percentage, status, created_at

import { Hono } from 'hono'
import { requireAuth } from './auth'

type Bindings = { DB: D1Database }
type Variables = { user: { id: number; nome: string; email: string; plano: string } }

const despesasCompartilhadas = new Hono<{ Bindings: Bindings; Variables: Variables }>()

// GET /api/despesas-compartilhadas
// Lista todas as divisões de despesas do usuário (join com despesas)
despesasCompartilhadas.get('/', requireAuth, async (c) => {
  const user = c.get('user')
  const { status, limit = '50', offset = '0' } = c.req.query()

  let sql = `
    SELECT 
      se.id,
      se.expense_id,
      se.partner_name,
      se.partner_email,
      se.user_percentage,
      se.partner_percentage,
      se.status,
      se.created_at,
      d.descricao,
      d.valor as total_valor,
      d.data,
      d.categoria,
      ROUND(d.valor * se.user_percentage / 100, 2) as minha_parte,
      ROUND(d.valor * se.partner_percentage / 100, 2) as parte_parceiro
    FROM shared_expenses se
    LEFT JOIN despesas d ON se.expense_id = d.id
    WHERE se.user_id = ?
  `
  const params: any[] = [user.id]

  if (status) {
    sql += ' AND se.status = ?'
    params.push(status)
  }

  sql += ' ORDER BY se.created_at DESC LIMIT ? OFFSET ?'
  params.push(parseInt(limit), parseInt(offset))

  const result = await c.env.DB.prepare(sql).bind(...params).all()
  const rows = result.results as any[]

  // Resumo
  const totalCount = await c.env.DB.prepare(
    'SELECT COUNT(*) as n FROM shared_expenses WHERE user_id = ?'
  ).bind(user.id).first() as any

  const pendente = await c.env.DB.prepare(
    `SELECT COUNT(*) as n FROM shared_expenses WHERE user_id = ? AND status = 'pending'`
  ).bind(user.id).first() as any

  return c.json({
    despesas: rows,
    resumo: {
      total: totalCount?.n || 0,
      pendentes: pendente?.n || 0
    }
  })
})

// POST /api/despesas-compartilhadas
// Compartilhar uma despesa existente com alguém
despesasCompartilhadas.post('/', requireAuth, async (c) => {
  const user = c.get('user')
  const body = await c.req.json()

  const {
    expense_id,          // ID da despesa existente
    partner_name,        // Nome do parceiro
    partner_email,       // Email do parceiro (opcional)
    user_percentage = 50, // % que o usuário paga (default 50%)
    // partner_percentage é automaticamente 100 - user_percentage
    // Modo alternativo: criar despesa nova e compartilhar
    criar_despesa,       // Se true, cria despesa e compartilha
    descricao,
    valor,
    data,
    categoria = 'Outros'
  } = body

  if (!partner_name) {
    return c.json({ error: 'Nome do parceiro é obrigatório' }, 400)
  }

  const userPct = Math.min(100, Math.max(0, parseFloat(user_percentage)))
  const partnerPct = 100 - userPct

  let despesaId = expense_id

  // Modo criar+compartilhar
  if (criar_despesa) {
    if (!descricao || !valor || !data) {
      return c.json({ error: 'Para criar despesa: descricao, valor e data são obrigatórios' }, 400)
    }
    const minhaParte = parseFloat(valor) * userPct / 100
    const newDesp = await c.env.DB.prepare(`
      INSERT INTO despesas (user_id, descricao, data, categoria, valor, status, meio_pagamento)
      VALUES (?, ?, ?, ?, ?, 'pendente', 'outros')
    `).bind(user.id, descricao, data, categoria, Math.round(minhaParte * 100) / 100).run()
    despesaId = newDesp.meta.last_row_id
  }

  if (!despesaId) {
    return c.json({ error: 'expense_id é obrigatório ou use criar_despesa=true' }, 400)
  }

  // Verificar se despesa pertence ao usuário
  const despesa = await c.env.DB.prepare(
    'SELECT id, valor FROM despesas WHERE id = ? AND user_id = ?'
  ).bind(despesaId, user.id).first() as any
  if (!despesa) return c.json({ error: 'Despesa não encontrada ou sem permissão' }, 404)

  const result = await c.env.DB.prepare(`
    INSERT INTO shared_expenses (user_id, expense_id, partner_name, partner_email, user_percentage, partner_percentage, status)
    VALUES (?, ?, ?, ?, ?, ?, 'pending')
  `).bind(
    user.id,
    despesaId,
    partner_name,
    partner_email || null,
    userPct,
    partnerPct
  ).run()

  const novoId = result.meta.last_row_id
  const minhaParte = Math.round(parseFloat(despesa.valor) * userPct / 100 * 100) / 100
  const parteParceiro = Math.round(parseFloat(despesa.valor) * partnerPct / 100 * 100) / 100

  return c.json({
    success: true,
    id: novoId,
    expense_id: despesaId,
    minha_parte: minhaParte,
    parte_parceiro: parteParceiro,
    message: `Despesa compartilhada com ${partner_name}! Você paga R$ ${minhaParte.toFixed(2)} (${userPct}%)`
  }, 201)
})

// GET /api/despesas-compartilhadas/:id
despesasCompartilhadas.get('/:id', requireAuth, async (c) => {
  const user = c.get('user')
  const id = c.req.param('id')

  const row = await c.env.DB.prepare(`
    SELECT 
      se.*,
      d.descricao, d.valor as total_valor, d.data, d.categoria,
      ROUND(d.valor * se.user_percentage / 100, 2) as minha_parte,
      ROUND(d.valor * se.partner_percentage / 100, 2) as parte_parceiro
    FROM shared_expenses se
    LEFT JOIN despesas d ON se.expense_id = d.id
    WHERE se.id = ? AND se.user_id = ?
  `).bind(id, user.id).first()

  if (!row) return c.json({ error: 'Compartilhamento não encontrado' }, 404)
  return c.json(row)
})

// PATCH /api/despesas-compartilhadas/:id/status
despesasCompartilhadas.patch('/:id/status', requireAuth, async (c) => {
  const user = c.get('user')
  const id = c.req.param('id')
  const { status } = await c.req.json()

  const validStatus = ['pending', 'paid', 'cancelled']
  if (!validStatus.includes(status)) {
    return c.json({ error: `Status inválido. Use: ${validStatus.join(', ')}` }, 400)
  }

  const existing = await c.env.DB.prepare(
    'SELECT id FROM shared_expenses WHERE id = ? AND user_id = ?'
  ).bind(id, user.id).first()
  if (!existing) return c.json({ error: 'Compartilhamento não encontrado' }, 404)

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
  if (!existing) return c.json({ error: 'Compartilhamento não encontrado' }, 404)

  await c.env.DB.prepare(
    'DELETE FROM shared_expenses WHERE id = ? AND user_id = ?'
  ).bind(id, user.id).run()

  return c.json({ success: true, message: 'Compartilhamento removido!' })
})

// GET /api/despesas-compartilhadas/resumo/pendencias
despesasCompartilhadas.get('/resumo/pendencias', requireAuth, async (c) => {
  const user = c.get('user')

  const result = await c.env.DB.prepare(`
    SELECT 
      se.partner_name,
      se.partner_email,
      COUNT(*) as qtd_despesas,
      SUM(ROUND(d.valor * se.partner_percentage / 100, 2)) as total_a_receber
    FROM shared_expenses se
    LEFT JOIN despesas d ON se.expense_id = d.id
    WHERE se.user_id = ? AND se.status = 'pending'
    GROUP BY se.partner_name, se.partner_email
    ORDER BY total_a_receber DESC
  `).bind(user.id).all()

  const rows = result.results as any[]
  const totalGeral = rows.reduce((s, r) => s + parseFloat(r.total_a_receber || 0), 0)

  return c.json({
    pendencias_por_parceiro: rows,
    total_a_receber: Math.round(totalGeral * 100) / 100
  })
})

export default despesasCompartilhadas
