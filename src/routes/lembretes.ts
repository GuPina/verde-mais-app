import { Hono } from 'hono'
import { requireAuth } from './auth'
import { getLimites, MSG_UPGRADE } from './planos'

type Bindings = { DB: D1Database }
type Variables = { user: { id: number; nome: string; email: string; plano: string } }

const lembretes = new Hono<{ Bindings: Bindings; Variables: Variables }>()

// GET /api/lembretes
lembretes.get('/', requireAuth, async (c) => {
  const user = c.get('user')
  const result = await c.env.DB.prepare(
    'SELECT * FROM lembretes WHERE user_id = ? ORDER BY dia_vencimento ASC'
  ).bind(user.id).all()

  const hoje = new Date()
  const lembretesComStatus = (result.results as any[]).map(l => {
    let urgente = false
    let diasParaVencer = null
    if (l.dia_vencimento) {
      const dataVenc = new Date(hoje.getFullYear(), hoje.getMonth(), l.dia_vencimento)
      if (dataVenc < hoje) dataVenc.setMonth(dataVenc.getMonth() + 1)
      diasParaVencer = Math.ceil((dataVenc.getTime() - hoje.getTime()) / (1000 * 60 * 60 * 24))
      urgente = diasParaVencer <= (l.alertar_dias_antes || 3)
    }
    return { ...l, urgente, dias_para_vencer: diasParaVencer }
  })

  const urgentes = lembretesComStatus.filter(l => l.urgente && l.status_mes === 'aguardando')
  return c.json({ lembretes: lembretesComStatus, urgentes: urgentes.length })
})

// POST /api/lembretes
lembretes.post('/', requireAuth, async (c) => {
  const user = c.get('user')

  // ── Limite de plano ──
  const lim = getLimites(user.plano)
  if (lim.lembretes !== Infinity) {
    const count = await c.env.DB.prepare('SELECT COUNT(*) as n FROM lembretes WHERE user_id = ? AND ativo = 1').bind(user.id).first() as any
    if ((count?.n || 0) >= lim.lembretes)
      return c.json({ error: MSG_UPGRADE.lembretes, upgrade: true, limite: lim.lembretes, feature: 'lembretes' }, 403)
  }

  const body = await c.req.json()
  const { titulo, descricao, tipo = 'conta', valor_estimado = 0, dia_vencimento, frequencia = 'mensal', alertar_dias_antes = 3 } = body

  if (!titulo) return c.json({ error: 'Título é obrigatório' }, 400)

  // Calcular próximo vencimento
  const proximo = calcProximoVencimento(parseInt(dia_vencimento) || 1, frequencia)

  const result = await c.env.DB.prepare(
    'INSERT INTO lembretes (user_id, titulo, descricao, tipo, valor_estimado, dia_vencimento, frequencia, proximo_vencimento, alertar_dias_antes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(user.id, titulo, descricao || null, tipo, parseFloat(valor_estimado), parseInt(dia_vencimento) || null, frequencia, proximo, parseInt(alertar_dias_antes)).run()

  // Verificar conquista
  const count = await c.env.DB.prepare('SELECT COUNT(*) as total FROM lembretes WHERE user_id = ?').bind(user.id).first() as any
  if ((count?.total || 0) >= 5) await verificarConquista(c.env.DB, user.id, 'lembrete_mestre')

  return c.json({ success: true, id: result.meta.last_row_id, message: 'Lembrete criado!' }, 201)
})

// PUT /api/lembretes/:id
lembretes.put('/:id', requireAuth, async (c) => {
  const user = c.get('user')
  const id = c.req.param('id')
  const existing = await c.env.DB.prepare('SELECT id FROM lembretes WHERE id = ? AND user_id = ?').bind(id, user.id).first()
  if (!existing) return c.json({ error: 'Lembrete não encontrado' }, 404)

  const body = await c.req.json()
  const { titulo, descricao, tipo, valor_estimado, dia_vencimento, frequencia, alertar_dias_antes, ativo } = body

  await c.env.DB.prepare(
    'UPDATE lembretes SET titulo=?, descricao=?, tipo=?, valor_estimado=?, dia_vencimento=?, frequencia=?, alertar_dias_antes=?, ativo=? WHERE id=? AND user_id=?'
  ).bind(titulo, descricao || null, tipo, parseFloat(valor_estimado), parseInt(dia_vencimento) || null, frequencia, parseInt(alertar_dias_antes), ativo ? 1 : 0, id, user.id).run()

  return c.json({ success: true, message: 'Lembrete atualizado!' })
})

// PATCH /api/lembretes/:id/registrar — registrar que recebeu/pagou a conta
lembretes.patch('/:id/registrar', requireAuth, async (c) => {
  const user = c.get('user')
  const id = c.req.param('id')
  const { status, valor_real, observacoes } = await c.req.json()

  const lembrete = await c.env.DB.prepare('SELECT * FROM lembretes WHERE id = ? AND user_id = ?').bind(id, user.id).first() as any
  if (!lembrete) return c.json({ error: 'Lembrete não encontrado' }, 404)

  const hoje = new Date().toISOString().split('T')[0]

  // Registrar no histórico
  await c.env.DB.prepare(
    'INSERT INTO lembretes_historico (lembrete_id, user_id, data_referencia, status, valor_real, observacoes) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(id, user.id, hoje, status, parseFloat(valor_real) || lembrete.valor_estimado, observacoes || null).run()

  // Atualizar status do mês e próximo vencimento
  const proximo = calcProximoVencimento(lembrete.dia_vencimento || 1, lembrete.frequencia)
  await c.env.DB.prepare(
    'UPDATE lembretes SET status_mes=?, ultimo_recebimento=?, proximo_vencimento=? WHERE id=? AND user_id=?'
  ).bind(status, hoje, proximo, id, user.id).run()

  return c.json({ success: true, proximo_vencimento: proximo, message: `Lembrete marcado como ${status}!` })
})

// PATCH /api/lembretes/:id/lembrar-novamente
lembretes.patch('/:id/lembrar-novamente', requireAuth, async (c) => {
  const user = c.get('user')
  const id = c.req.param('id')
  await c.env.DB.prepare('UPDATE lembretes SET status_mes = ? WHERE id = ? AND user_id = ?').bind('aguardando', id, user.id).run()
  return c.json({ success: true, message: 'Você será lembrado novamente!' })
})

// DELETE /api/lembretes/:id
lembretes.delete('/:id', requireAuth, async (c) => {
  const user = c.get('user')
  const id = c.req.param('id')
  await c.env.DB.prepare('DELETE FROM lembretes WHERE id = ? AND user_id = ?').bind(id, user.id).run()
  return c.json({ success: true, message: 'Lembrete removido!' })
})

// GET /api/lembretes/historico/:id
lembretes.get('/historico/:id', requireAuth, async (c) => {
  const user = c.get('user')
  const id = c.req.param('id')
  const result = await c.env.DB.prepare(
    'SELECT * FROM lembretes_historico WHERE lembrete_id = ? AND user_id = ? ORDER BY data_referencia DESC LIMIT 12'
  ).bind(id, user.id).all()
  return c.json({ historico: result.results })
})

// POST /api/lembretes/:id/converter-despesa — converte lembrete em despesa real
lembretes.post('/:id/converter-despesa', requireAuth, async (c) => {
  const user = c.get('user')
  const id = c.req.param('id')

  const lembrete = await c.env.DB.prepare(
    'SELECT * FROM lembretes WHERE id = ? AND user_id = ?'
  ).bind(id, user.id).first() as any
  if (!lembrete) return c.json({ error: 'Lembrete não encontrado' }, 404)

  const body = await c.req.json().catch(() => ({})) as any
  const hoje = new Date().toISOString().split('T')[0]
  const {
    descricao = lembrete.titulo,
    valor = lembrete.valor_estimado,
    data = lembrete.proximo_vencimento || hoje,   // ← default: próximo vencimento ou hoje
    categoria = lembrete.tipo === 'despesa' ? 'outros' : 'outros',
    subcategoria = null,
    status = 'pendente',
    cartao_id = null,
    meio_pagamento = 'dinheiro',
    vencimento = null,
    observacoes = null,
    billing_month = null,
    billing_year = null,
  } = body

  // data pode não vir no body — já tem default acima
  if (!valor || Number(valor) <= 0) return c.json({ error: 'Valor deve ser maior que zero' }, 400)

  const result = await c.env.DB.prepare(
    `INSERT INTO despesas (user_id, descricao, data, categoria, subcategoria, valor,
     parcelado, numero_parcelas, parcela_atual, status, fixa_ou_variavel, recorrente,
     vencimento, observacoes, cartao_id, meio_pagamento, billing_month, billing_year)
     VALUES (?, ?, ?, ?, ?, ?, 0, 1, 1, ?, 'variavel', 0, ?, ?, ?, ?, ?, ?)`
  ).bind(
    user.id, descricao, data, categoria, subcategoria,
    parseFloat(valor), status, vencimento, observacoes,
    cartao_id ? parseInt(cartao_id) : null, meio_pagamento,
    billing_month, billing_year
  ).run()

  // Registrar no histórico do lembrete
  await c.env.DB.prepare(
    'INSERT INTO lembretes_historico (lembrete_id, user_id, data_referencia, status, valor_real, observacoes) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(id, user.id, data, 'pago', parseFloat(valor), `Convertido em despesa #${result.meta.last_row_id}`).run()

  // Atualizar próximo vencimento do lembrete
  const proximo = calcProximoVencimento(lembrete.dia_vencimento || 1, lembrete.frequencia)
  await c.env.DB.prepare(
    'UPDATE lembretes SET status_mes=?, ultimo_recebimento=?, proximo_vencimento=? WHERE id=? AND user_id=?'
  ).bind('pago', data, proximo, id, user.id).run()

  return c.json({
    success: true,
    despesa_id: result.meta.last_row_id,
    message: 'Lembrete convertido em despesa com sucesso!'
  }, 201)
})

function calcProximoVencimento(dia: number, frequencia: string): string {
  const hoje = new Date()
  const proximo = new Date(hoje.getFullYear(), hoje.getMonth(), dia)
  if (proximo <= hoje) {
    const mesesFrequencia: Record<string, number> = { semanal: 0, quinzenal: 0, mensal: 1, bimestral: 2, trimestral: 3, semestral: 6, anual: 12 }
    proximo.setMonth(proximo.getMonth() + (mesesFrequencia[frequencia] || 1))
  }
  return proximo.toISOString().split('T')[0]
}

async function verificarConquista(db: D1Database, userId: number, codigo: string) {
  try {
    await db.prepare('INSERT OR IGNORE INTO conquistas_usuario (user_id, conquista_codigo, visualizado) VALUES (?, ?, 0)').bind(userId, codigo).run()
  } catch { }
}

export default lembretes
