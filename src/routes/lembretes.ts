import { Hono } from 'hono'
import { requireAuth } from './auth'
import { getLimites, MSG_UPGRADE } from './planos'

type Bindings = { DB: D1Database }
type Variables = { user: { id: number; nome: string; email: string; plano: string } }

const lembretes = new Hono<{ Bindings: Bindings; Variables: Variables }>()

// Tipos válidos para lembretes (sem CHECK constraint — validação no código)
const TIPOS_LEMBRETE = [
  'conta', 'imposto', 'mensalidade', 'seguro', 'aluguel',
  'investimento', 'despesa', 'receita', 'saude', 'educacao',
  'transporte', 'revisao', 'reuniao', 'tarefa', 'outros'
]

const FREQUENCIAS_VALIDAS = ['semanal', 'quinzenal', 'mensal', 'bimestral', 'trimestral', 'semestral', 'anual']

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/lembretes
// ─────────────────────────────────────────────────────────────────────────────
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

// ─────────────────────────────────────────────────────────────────────────────
// S-L1: GET /api/lembretes/resumo — visão consolidada
// Deve ficar ANTES de /:id para evitar conflito de rota
// ─────────────────────────────────────────────────────────────────────────────
lembretes.get('/resumo', requireAuth, async (c) => {
  const user = c.get('user')

  const [todos, urgentesR, porTipo] = await Promise.all([
    c.env.DB.prepare(
      `SELECT COUNT(*) as total, 
              COUNT(CASE WHEN ativo = 1 THEN 1 END) as ativos,
              COALESCE(SUM(CASE WHEN ativo = 1 THEN valor_estimado ELSE 0 END),0) as valor_total_mensal
       FROM lembretes WHERE user_id = ?`
    ).bind(user.id).first() as any,

    c.env.DB.prepare(
      `SELECT COUNT(*) as n FROM lembretes WHERE user_id = ? AND ativo = 1 AND status_mes = 'aguardando'`
    ).bind(user.id).first() as any,

    c.env.DB.prepare(
      `SELECT tipo, COUNT(*) as qtd, COALESCE(SUM(valor_estimado),0) as valor_total
       FROM lembretes WHERE user_id = ? AND ativo = 1
       GROUP BY tipo ORDER BY valor_total DESC`
    ).bind(user.id).all()
  ])

  // Calcular urgentes dinamicamente
  const all = await c.env.DB.prepare(
    'SELECT dia_vencimento, alertar_dias_antes, status_mes FROM lembretes WHERE user_id = ? AND ativo = 1'
  ).bind(user.id).all()

  const hoje = new Date()
  let urgentesCount = 0
  for (const l of (all.results as any[])) {
    if (l.dia_vencimento && l.status_mes === 'aguardando') {
      const dataVenc = new Date(hoje.getFullYear(), hoje.getMonth(), l.dia_vencimento)
      if (dataVenc < hoje) dataVenc.setMonth(dataVenc.getMonth() + 1)
      const dias = Math.ceil((dataVenc.getTime() - hoje.getTime()) / (1000 * 60 * 60 * 24))
      if (dias <= (l.alertar_dias_antes || 3)) urgentesCount++
    }
  }

  return c.json({
    totais: {
      total: Number(todos?.total || 0),
      ativos: Number(todos?.ativos || 0),
      urgentes: urgentesCount,
      valor_total_mensal: Math.round(Number(todos?.valor_total_mensal || 0) * 100) / 100
    },
    por_tipo: (porTipo.results as any[]).map(r => ({
      tipo: r.tipo,
      qtd: Number(r.qtd),
      valor_total: Math.round(Number(r.valor_total) * 100) / 100
    }))
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/lembretes/historico/:id
// ANTES de /:id/registrar para evitar conflito
// ─────────────────────────────────────────────────────────────────────────────
lembretes.get('/historico/:id', requireAuth, async (c) => {
  const user = c.get('user')
  const id = c.req.param('id')
  const result = await c.env.DB.prepare(
    'SELECT * FROM lembretes_historico WHERE lembrete_id = ? AND user_id = ? ORDER BY data_referencia DESC LIMIT 12'
  ).bind(id, user.id).all()
  return c.json({ historico: result.results })
})

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/lembretes
// S-L2: aceita campo tags (JSON string ou array)
// S-L3: aceita campo notas
// Bug L-B1: valida tipo contra lista em código (sem CHECK no DB)
// ─────────────────────────────────────────────────────────────────────────────
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
  const {
    titulo,
    descricao,
    tipo = 'conta',
    valor_estimado = 0,
    dia_vencimento,
    frequencia = 'mensal',
    alertar_dias_antes = 3,
    notas = null,
    tags = null
  } = body

  if (!titulo) return c.json({ error: 'Título é obrigatório' }, 400)

  // Bug L-B1: validar tipo
  if (!TIPOS_LEMBRETE.includes(tipo))
    return c.json({ error: `tipo inválido. Use: ${TIPOS_LEMBRETE.join(', ')}` }, 400)

  // Validar frequência
  if (!FREQUENCIAS_VALIDAS.includes(frequencia))
    return c.json({ error: `frequencia inválida. Use: ${FREQUENCIAS_VALIDAS.join(', ')}` }, 400)

  // Serializar tags se vier como array
  const tagsStr = Array.isArray(tags) ? JSON.stringify(tags) : (tags || null)

  // Calcular próximo vencimento
  const proximo = calcProximoVencimento(parseInt(dia_vencimento) || 1, frequencia)

  const result = await c.env.DB.prepare(
    `INSERT INTO lembretes (user_id, titulo, descricao, tipo, valor_estimado, dia_vencimento, frequencia, proximo_vencimento, alertar_dias_antes, notas, tags)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    user.id, titulo, descricao || null, tipo,
    parseFloat(String(valor_estimado)) || 0,
    dia_vencimento ? parseInt(dia_vencimento) : null,
    frequencia, proximo,
    parseInt(alertar_dias_antes),
    notas || null, tagsStr
  ).run()

  // Verificar conquista
  const count = await c.env.DB.prepare('SELECT COUNT(*) as total FROM lembretes WHERE user_id = ?').bind(user.id).first() as any
  if ((count?.total || 0) >= 5) await verificarConquista(c.env.DB, user.id, 'lembrete_mestre')

  return c.json({ success: true, id: result.meta.last_row_id, message: 'Lembrete criado!' }, 201)
})

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/lembretes/:id
// S-L2/L3: aceita notas e tags
// ─────────────────────────────────────────────────────────────────────────────
lembretes.put('/:id', requireAuth, async (c) => {
  const user = c.get('user')
  const id = c.req.param('id')
  const existing = await c.env.DB.prepare('SELECT * FROM lembretes WHERE id = ? AND user_id = ?').bind(id, user.id).first() as any
  if (!existing) return c.json({ error: 'Lembrete não encontrado' }, 404)

  const body = await c.req.json()
  const { titulo, descricao, tipo, valor_estimado, dia_vencimento, frequencia, alertar_dias_antes, ativo, notas, tags } = body

  // Validar tipo se fornecido
  if (tipo !== undefined && !TIPOS_LEMBRETE.includes(tipo))
    return c.json({ error: `tipo inválido. Use: ${TIPOS_LEMBRETE.join(', ')}` }, 400)

  const tagsStr = tags !== undefined
    ? (Array.isArray(tags) ? JSON.stringify(tags) : (tags || null))
    : existing.tags

  await c.env.DB.prepare(
    `UPDATE lembretes SET titulo=?, descricao=?, tipo=?, valor_estimado=?, dia_vencimento=?,
     frequencia=?, alertar_dias_antes=?, ativo=?, notas=?, tags=? WHERE id=? AND user_id=?`
  ).bind(
    titulo ?? existing.titulo,
    descricao !== undefined ? (descricao || null) : existing.descricao,
    tipo ?? existing.tipo ?? 'conta',
    valor_estimado != null ? (parseFloat(String(valor_estimado)) || 0) : (existing.valor_estimado ?? 0),
    dia_vencimento != null ? (parseInt(dia_vencimento) || null) : existing.dia_vencimento,
    frequencia ?? existing.frequencia ?? 'mensal',
    alertar_dias_antes != null ? (parseInt(alertar_dias_antes) || 3) : (existing.alertar_dias_antes ?? 3),
    ativo != null ? (ativo ? 1 : 0) : (existing.ativo ?? 1),
    notas !== undefined ? (notas || null) : existing.notas,
    tagsStr,
    id, user.id
  ).run()

  return c.json({ success: true, message: 'Lembrete atualizado!' })
})

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/lembretes/:id/registrar
// ─────────────────────────────────────────────────────────────────────────────
lembretes.patch('/:id/registrar', requireAuth, async (c) => {
  const user = c.get('user')
  const id = c.req.param('id')
  const { status, valor_real, observacoes } = await c.req.json()

  const STATUSVALIDOS = ['recebido', 'pago', 'ignorado', 'aguardando']
  if (status && !STATUSVALIDOS.includes(status))
    return c.json({ error: `status inválido. Use: ${STATUSVALIDOS.join(', ')}` }, 400)

  const lembrete = await c.env.DB.prepare('SELECT * FROM lembretes WHERE id = ? AND user_id = ?').bind(id, user.id).first() as any
  if (!lembrete) return c.json({ error: 'Lembrete não encontrado' }, 404)

  const hoje = new Date().toISOString().split('T')[0]

  await c.env.DB.prepare(
    'INSERT INTO lembretes_historico (lembrete_id, user_id, data_referencia, status, valor_real, observacoes) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(id, user.id, hoje, status || 'pago', parseFloat(String(valor_real)) || lembrete.valor_estimado, observacoes || null).run()

  const proximo = calcProximoVencimento(lembrete.dia_vencimento || 1, lembrete.frequencia)
  await c.env.DB.prepare(
    'UPDATE lembretes SET status_mes=?, ultimo_recebimento=?, proximo_vencimento=? WHERE id=? AND user_id=?'
  ).bind(status || 'pago', hoje, proximo, id, user.id).run()

  return c.json({ success: true, proximo_vencimento: proximo, message: `Lembrete marcado como ${status}!` })
})

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/lembretes/:id/lembrar-novamente
// ─────────────────────────────────────────────────────────────────────────────
lembretes.patch('/:id/lembrar-novamente', requireAuth, async (c) => {
  const user = c.get('user')
  const id = c.req.param('id')
  const exists = await c.env.DB.prepare('SELECT id FROM lembretes WHERE id = ? AND user_id = ?').bind(id, user.id).first()
  if (!exists) return c.json({ error: 'Lembrete não encontrado' }, 404)

  await c.env.DB.prepare('UPDATE lembretes SET status_mes = ? WHERE id = ? AND user_id = ?').bind('aguardando', id, user.id).run()
  return c.json({ success: true, message: 'Você será lembrado novamente!' })
})

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/lembretes/:id/converter-despesa
// ─────────────────────────────────────────────────────────────────────────────
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
    data = lembrete.proximo_vencimento || hoje,
    categoria = 'outros',
    subcategoria = null,
    status = 'pendente',
    cartao_id = null,
    meio_pagamento = 'dinheiro',
    vencimento = null,
    observacoes = null,
    billing_month = null,
    billing_year = null,
  } = body

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

  await c.env.DB.prepare(
    'INSERT INTO lembretes_historico (lembrete_id, user_id, data_referencia, status, valor_real, observacoes) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(id, user.id, data, 'pago', parseFloat(valor), `Convertido em despesa #${result.meta.last_row_id}`).run()

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

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/lembretes/:id
// ─────────────────────────────────────────────────────────────────────────────
lembretes.delete('/:id', requireAuth, async (c) => {
  const user = c.get('user')
  const id = c.req.param('id')
  const exists = await c.env.DB.prepare('SELECT id FROM lembretes WHERE id = ? AND user_id = ?').bind(id, user.id).first()
  if (!exists) return c.json({ error: 'Lembrete não encontrado' }, 404)

  await c.env.DB.prepare('DELETE FROM lembretes WHERE id = ? AND user_id = ?').bind(id, user.id).run()
  return c.json({ success: true, message: 'Lembrete removido!' })
})

// ─── Helpers ─────────────────────────────────────────────────────────────────
function calcProximoVencimento(dia: number, frequencia: string): string {
  const hoje = new Date()
  const proximo = new Date(hoje.getFullYear(), hoje.getMonth(), dia)
  if (proximo <= hoje) {
    const mesesFrequencia: Record<string, number> = {
      semanal: 0, quinzenal: 0, mensal: 1, bimestral: 2,
      trimestral: 3, semestral: 6, anual: 12
    }
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
