// BUG 1.5 — src/routes/despesas-compartilhadas.ts
// CRUD adaptado à estrutura real da tabela shared_expenses
// Colunas reais: id, expense_id, user_id, partner_name, partner_email, user_percentage, partner_percentage, status, created_at

import { Hono } from 'hono'
import { requireAuth } from './auth'

type Bindings = { DB: D1Database }
type Variables = { user: { id: number; nome: string; email: string; plano: string } }

const despesasCompartilhadas = new Hono<{ Bindings: Bindings; Variables: Variables }>()

// id de rota: só inteiro positivo, senão null → 400 (nunca 500)
function parseId(v: any): number | null {
  const t = String(v ?? '')
  return /^\d+$/.test(t) && parseInt(t, 10) > 0 ? parseInt(t, 10) : null
}

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
      COALESCE(se.valor_total, d.valor) as total_conta,
      ROUND(COALESCE(se.valor_total, d.valor) * se.user_percentage / 100, 2) as minha_parte,
      ROUND(COALESCE(se.valor_total, d.valor) * se.partner_percentage / 100, 2) as parte_parceiro
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
  params.push(Math.max(1, Math.min(200, parseInt(limit) || 50)), Math.max(0, parseInt(offset) || 0))

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

  const userPctRaw = parseFloat(user_percentage)
  if (!Number.isFinite(userPctRaw)) return c.json({ error: 'Percentual inválido.' }, 400)
  const userPct = Math.min(100, Math.max(0, userPctRaw))
  const partnerPct = 100 - userPct

  let despesaId = expense_id

  // `valorTotalConta` é o valor CHEIO da conta — o que foi consumido pelas duas
  // pessoas. É diferente do que vai para `despesas.valor` no modo
  // criar+compartilhar, onde gravamos só a minha fatia (a despesa do parceiro
  // não é minha). Confundir os dois era a origem da divisão dupla.
  let valorTotalConta: number | null = null

  // Modo criar+compartilhar
  if (criar_despesa) {
    if (!descricao || !valor || !data) {
      return c.json({ error: 'Para criar despesa: descricao, valor e data são obrigatórios' }, 400)
    }
    valorTotalConta = parseFloat(valor)
    if (!Number.isFinite(valorTotalConta) || valorTotalConta <= 0)
      return c.json({ error: 'Valor da conta deve ser maior que zero.' }, 400)
    const minhaParte = Math.round(valorTotalConta * userPct / 100 * 100) / 100
    const newDesp = await c.env.DB.prepare(`
      INSERT INTO despesas (user_id, descricao, data, categoria, valor, status, meio_pagamento)
      VALUES (?, ?, ?, ?, ?, 'pendente', 'outros')
    `).bind(user.id, descricao, data, categoria, minhaParte).run()
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

  // Dividindo uma despesa que já existia: ali `despesas.valor` É o valor cheio.
  if (valorTotalConta === null) valorTotalConta = parseFloat(despesa.valor)

  const result = await c.env.DB.prepare(`
    INSERT INTO shared_expenses (user_id, expense_id, partner_name, partner_email, user_percentage, partner_percentage, valor_total, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')
  `).bind(
    user.id,
    despesaId,
    partner_name,
    partner_email || null,
    userPct,
    partnerPct,
    valorTotalConta
  ).run()

  const novoId = result.meta.last_row_id
  const minhaParte = Math.round(valorTotalConta * userPct / 100 * 100) / 100
  // A parte do parceiro sai por subtração para as duas SEMPRE fecharem o total
  // — com 33%/67% o arredondamento separado deixaria um centavo sobrando.
  const parteParceiro = Math.round((valorTotalConta - minhaParte) * 100) / 100

  return c.json({
    success: true,
    id: novoId,
    expense_id: despesaId,
    total_conta: valorTotalConta,
    minha_parte: minhaParte,
    parte_parceiro: parteParceiro,
    message: `Conta de R$ ${valorTotalConta.toFixed(2)} dividida com ${partner_name}! Você paga R$ ${minhaParte.toFixed(2)} (${userPct}%)`
  }, 201)
})

// GET /api/despesas-compartilhadas/:id
despesasCompartilhadas.get('/:id', requireAuth, async (c) => {
  const user = c.get('user')
  const id = parseId(c.req.param('id'))
  if (id === null) return c.json({ error: 'ID inválido.' }, 400)

  const row = await c.env.DB.prepare(`
    SELECT 
      se.*,
      d.descricao, d.valor as total_valor, d.data, d.categoria,
      COALESCE(se.valor_total, d.valor) as total_conta,
      ROUND(COALESCE(se.valor_total, d.valor) * se.user_percentage / 100, 2) as minha_parte,
      ROUND(COALESCE(se.valor_total, d.valor) * se.partner_percentage / 100, 2) as parte_parceiro
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
  const id = parseId(c.req.param('id'))
  if (id === null) return c.json({ error: 'ID inválido.' }, 400)
  const { status } = await c.req.json()

  // Mapeamento de aliases para os valores aceitos pelo DB CHECK (pending, settled)
  const statusMap: Record<string, string> = {
    'pending': 'pending',
    'pendente': 'pending',
    'paid': 'settled',
    'pago': 'settled',
    'settled': 'settled',
    'quitado': 'settled',
    'cancelled': 'pending',  // cancelled → reset para pending (DB só aceita pending/settled)
    'cancelado': 'pending'
  }
  const statusNorm = statusMap[status?.toLowerCase()]
  if (!statusNorm) {
    return c.json({ error: 'Status inválido. Use: pending/pendente, paid/pago/settled' }, 400)
  }

  const existing = await c.env.DB.prepare(
    'SELECT id FROM shared_expenses WHERE id = ? AND user_id = ?'
  ).bind(id, user.id).first()
  if (!existing) return c.json({ error: 'Compartilhamento não encontrado' }, 404)

  await c.env.DB.prepare(
    'UPDATE shared_expenses SET status = ? WHERE id = ? AND user_id = ?'
  ).bind(statusNorm, id, user.id).run()

  return c.json({ success: true, status: statusNorm, message: `Status atualizado para: ${statusNorm}` })
})

// DELETE /api/despesas-compartilhadas/:id
despesasCompartilhadas.delete('/:id', requireAuth, async (c) => {
  const user = c.get('user')
  const id = parseId(c.req.param('id'))
  if (id === null) return c.json({ error: 'ID inválido.' }, 400)

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
