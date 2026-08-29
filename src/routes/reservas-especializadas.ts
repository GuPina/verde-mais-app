import { Hono } from 'hono'
import { requireAuth } from './auth'
import { getLimites } from './planos'
import { ensureTag, COR_MODULO } from '../utils/tags-helper'

type Bindings = { DB: D1Database }
type Variables = { user: { id: number; nome: string; email: string; plano: string } }

const reservasEsp = new Hono<{ Bindings: Bindings; Variables: Variables }>()

// Mapa de tipos PT-BR para EN (compatibilidade com frontend)
const TYPE_PTBR_MAP: Record<string, string> = {
  // PT-BR
  'viagem':        'travel',
  'emergencia':    'emergency',
  'emergência':    'emergency',
  'saude':         'health',
  'saúde':         'health',
  'desemprego':    'unemployment',
  'familia':       'family',
  'família':       'family',
  'educacao':      'education',
  'educação':      'education',
  'veiculo':       'vehicle',
  'veículo':       'vehicle',
  'evento':        'event',
  'personalizado': 'custom',
  // EN (passthrough)
  'travel':        'travel',
  'emergency':     'emergency',
  'health':        'health',
  'unemployment':  'unemployment',
  'family':        'family',
  'education':     'education',
  'vehicle':       'vehicle',
  'event':         'event',
  'custom':        'custom',
}

// Tipos de reserva com configuração padrão
const RESERVE_CONFIGS: Record<string, { icon: string; color: string; priority: number; months: number }> = {
  emergency:    { icon: '🚨', color: '#EF4444', priority: 1, months: 6 },
  health:       { icon: '🏥', color: '#3B82F6', priority: 2, months: 2 },
  unemployment: { icon: '💼', color: '#F59E0B', priority: 1, months: 12 },
  travel:       { icon: '✈️', color: '#8B5CF6', priority: 4, months: 12 },
  education:    { icon: '🎓', color: '#06B6D4', priority: 3, months: 6 },
  vehicle:      { icon: '🚗', color: '#84CC16', priority: 2, months: 12 },
  family:       { icon: '🏠', color: '#F97316', priority: 2, months: 3 },
  event:        { icon: '💍', color: '#EC4899', priority: 4, months: 8 },
  custom:       { icon: '🎯', color: '#6366F1', priority: 5, months: 6 },
}

// ── Helpers de validação (MR3/MR6/MR8/MR9/MR10/MR11/MR12/MR13) ────────────────
const MAX_VALOR = 1_000_000_000
const VALID_STATUS_PUT = ['active', 'paused'] // conclusão/cancelamento não são setados à mão

// id de rota: só inteiro positivo, senão null → 400 (nunca 500)
function parseId(v: any): number | null {
  const t = String(v ?? '')
  return /^\d+$/.test(t) && parseInt(t, 10) > 0 ? parseInt(t, 10) : null
}
// valor > 0 obrigatório; retorna null quando inválido
function parseValorPos(v: any): number | null {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 && n <= MAX_VALOR ? Math.round(n * 100) / 100 : null
}
// valor >= 0; '' / null / undefined → 0; inválido → null
function parseValorNaoNeg(v: any): number | null {
  if (v === '' || v === null || v === undefined) return 0
  const n = Number(v)
  return Number.isFinite(n) && n >= 0 && n <= MAX_VALOR ? Math.round(n * 100) / 100 : null
}
// prioridade 1..5; vazio → undefined (usa padrão); inválido → null → 400
function parsePrioridade(v: any): number | null | undefined {
  if (v === '' || v === null || v === undefined) return undefined
  const n = parseInt(String(v), 10)
  return Number.isInteger(n) && n >= 1 && n <= 5 ? n : null
}
// tipo: vazio → 'custom'; conhecido → EN; desconhecido → null → 400 (MR7/MR8)
function parseTipo(raw: any): string | null {
  if (raw === null || raw === undefined || raw === '') return 'custom'
  const key = String(raw).toLowerCase()
  return TYPE_PTBR_MAP[key] || null
}
// data YYYY-MM-DD válida; vazio → null; inválida → undefined → 400 (MR10)
function parseData(v: any): string | null | undefined {
  if (v === '' || v === null || v === undefined) return null
  const s = String(v)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return undefined
  const d = new Date(s + 'T12:00:00')
  return !Number.isNaN(d.getTime()) ? s : undefined
}
const capPct = (cur: number, target: number) =>
  target > 0 ? Math.min(100, Math.round((cur / target) * 100)) : 0

// ── GET /api/reservas-esp ──────────────────────────────────────────────────
reservasEsp.get('/', requireAuth, async (c) => {
  const user = c.get('user')

  const result = await c.env.DB.prepare(
    `SELECT r.*,
      COALESCE((SELECT SUM(amount) FROM reserve_transactions WHERE reserve_id = r.id AND type='deposit'), 0) as total_deposited,
      COALESCE((SELECT SUM(amount) FROM reserve_transactions WHERE reserve_id = r.id AND type='withdrawal'), 0) as total_withdrawn
     FROM specialized_reserves r
     WHERE r.user_id = ? AND r.status != 'cancelled'
     ORDER BY r.priority ASC, r.created_at ASC`
  ).bind(user.id).all()

  const reserves = (result.results as any[]).map(r => ({
    ...r,
    percent_complete: capPct(Number(r.current_amount) || 0, Number(r.target_amount) || 0),
    remaining: Math.max(0, (Number(r.target_amount) || 0) - (Number(r.current_amount) || 0)),
  }))

  // Resumo total
  const total_saved = reserves.reduce((s, r) => s + (Number(r.current_amount) || 0), 0)
  const total_target = reserves.reduce((s, r) => s + (Number(r.target_amount) || 0), 0)

  return c.json({
    reserves,
    summary: {
      total_saved: Math.round(total_saved * 100) / 100,
      total_target: Math.round(total_target * 100) / 100,
      total_remaining: Math.round(Math.max(0, total_target - total_saved) * 100) / 100,
      overall_progress: total_target > 0 ? Math.min(100, Math.round((total_saved / total_target) * 100)) : 0,
      active_count: reserves.filter(r => r.status === 'active').length,
      completed_count: reserves.filter(r => r.status === 'completed').length,
    }
  })
})

// ── POST /api/reservas-esp ─────────────────────────────────────────────────
reservasEsp.post('/', requireAuth, async (c) => {
  const user = c.get('user')

  // Limite de plano (MR19: fonte central quando disponível)
  const lim = getLimites(user.plano) as any
  const maxReservas = (lim && Number.isFinite(lim.reservas_especializadas))
    ? lim.reservas_especializadas
    : (user.plano === 'free' ? 1 : user.plano === 'premium' ? 3 : 999)
  const count = await c.env.DB.prepare(
    `SELECT COUNT(*) as n FROM specialized_reserves WHERE user_id = ? AND status IN ('active','paused')`
  ).bind(user.id).first() as any

  if ((count?.n || 0) >= maxReservas) {
    const msg = user.plano === 'free'
      ? 'Plano Free permite apenas 1 reserva. Atualize para Premium (3 reservas) ou Pro (ilimitado).'
      : 'Plano Premium permite até 3 reservas simultâneas. Atualize para Pro (ilimitado).'
    return c.json({ error: msg, upgrade: true, feature: 'reservas_multiplas' }, 403)
  }

  const body = await c.req.json().catch(() => ({}))
  // Aceitar campos em pt-BR OU en (retrocompatível)
  const type = parseTipo(body.tipo ?? body.type) // MR7/MR8
  if (type === null)
    return c.json({ error: 'Tipo inválido.', tipos_validos: Object.keys(RESERVE_CONFIGS) }, 400)

  const name = (body.nome || body.name || '').toString().trim()
  const description = body.descricao || body.description
  const target_amount = parseValorPos(body.meta_valor ?? body.valor_meta ?? body.target_amount) // MR6
  const current_amount = parseValorNaoNeg(body.valor_atual ?? body.current_amount) // MR3/MR6
  const deadline = parseData(body.prazo ?? body.deadline) // MR10
  const monthly_target = body.aporte_mensal ?? body.monthly_target
  const priority = parsePrioridade(body.prioridade ?? body.priority) // MR9
  const linked_meta_id = body.meta_id ?? body.linked_meta_id

  if (!name) return c.json({ error: 'Nome é obrigatório.' }, 400)
  if (target_amount === null) return c.json({ error: 'Valor meta deve ser um número maior que zero.' }, 400)
  if (current_amount === null) return c.json({ error: 'Valor atual inválido.' }, 400)
  if (priority === null) return c.json({ error: 'Prioridade deve ser de 1 a 5.' }, 400)
  if (deadline === undefined) return c.json({ error: 'Prazo inválido (use uma data válida).' }, 400)
  const monthlyVal = (monthly_target === '' || monthly_target === null || monthly_target === undefined)
    ? null : parseValorPos(monthly_target)
  if (monthly_target !== undefined && monthly_target !== null && monthly_target !== '' && monthlyVal === null)
    return c.json({ error: 'Aporte mensal inválido.' }, 400)

  const cfg = RESERVE_CONFIGS[type] || RESERVE_CONFIGS.custom
  const startCompleted = current_amount >= target_amount // MR3: nasce completa se já bateu a meta

  const result = await c.env.DB.prepare(
    `INSERT INTO specialized_reserves
     (user_id, type, name, description, target_amount, current_amount, priority, deadline, icon, color, monthly_target, linked_meta_id, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    user.id, type, name, description || null,
    target_amount, current_amount,
    priority ?? cfg.priority,
    deadline,
    cfg.icon, cfg.color,
    monthlyVal,
    (linked_meta_id !== undefined && linked_meta_id !== null && /^\d+$/.test(String(linked_meta_id))) ? parseInt(String(linked_meta_id), 10) : null,
    startCompleted ? 'completed' : 'active'
  ).run()

  const id = result.meta.last_row_id

  // Se tem valor inicial, registrar transação
  if (current_amount > 0) {
    await c.env.DB.prepare(
      `INSERT INTO reserve_transactions (reserve_id, type, amount, description) VALUES (?, 'deposit', ?, 'Saldo inicial')`
    ).bind(id, current_amount).run()
  }

  // Conquista
  await checkConquista(c.env.DB, user.id, 'multi_reserva_criada')

  const activeCount = (count?.n || 0) + 1
  if (activeCount >= 3) await checkConquista(c.env.DB, user.id, 'multi_3_reservas')

  // ── Tags automáticas para a reserva ───────────────────────────
  try {
    await ensureTag(c.env.DB, user.id, 'Reserva', COR_MODULO.reserva)
    await ensureTag(c.env.DB, user.id, name.slice(0, 30), COR_MODULO.reserva)
    if (type && type !== 'custom') {
      const tipoNome = type.charAt(0).toUpperCase() + type.slice(1).replace(/_/g, ' ')
      await ensureTag(c.env.DB, user.id, tipoNome.slice(0, 30), COR_MODULO.reserva)
    }
  } catch (_) { /* best-effort */ }

  return c.json({ success: true, id, message: `Reserva "${name}" criada com sucesso!` }, 201)
})

// ── PUT /api/reservas-esp/:id ──────────────────────────────────────────────
reservasEsp.put('/:id', requireAuth, async (c) => {
  const user = c.get('user')
  const id = parseId(c.req.param('id')) // MR13
  if (id === null) return c.json({ error: 'ID inválido.' }, 400)

  const existing = await c.env.DB.prepare(
    `SELECT * FROM specialized_reserves WHERE id = ? AND user_id = ?`
  ).bind(id, user.id).first() as any
  if (!existing) return c.json({ error: 'Reserva não encontrada' }, 404)

  const body = await c.req.json().catch(() => ({}))
  const has = (k: string) => Object.prototype.hasOwnProperty.call(body, k)

  const name = body.nome ?? body.name
  const description = body.descricao ?? body.description

  // target_amount: só valida se veio no corpo; 0/negativo/NaN → 400 (MR12)
  let target_amount: number | null = null
  const rawTarget = body.meta_valor ?? body.valor_meta ?? body.target_amount
  const sentTarget = has('meta_valor') || has('valor_meta') || has('target_amount')
  if (sentTarget) {
    target_amount = parseValorPos(rawTarget)
    if (target_amount === null) return c.json({ error: 'Valor meta deve ser um número maior que zero.' }, 400)
  }

  // current_amount: editável (MR14); só valida se veio
  let current_amount: number | null = null
  const sentCurrent = has('valor_atual') || has('current_amount')
  if (sentCurrent) {
    current_amount = parseValorNaoNeg(body.valor_atual ?? body.current_amount)
    if (current_amount === null) return c.json({ error: 'Valor atual inválido.' }, 400)
  }

  // deadline
  let deadline: string | null | undefined = undefined
  if (has('prazo') || has('deadline')) {
    deadline = parseData(body.prazo ?? body.deadline)
    if (deadline === undefined) return c.json({ error: 'Prazo inválido.' }, 400)
  }

  // monthly_target
  let monthly_target: number | null | undefined = undefined
  if (has('aporte_mensal') || has('monthly_target')) {
    const raw = body.aporte_mensal ?? body.monthly_target
    monthly_target = (raw === '' || raw === null) ? null : parseValorPos(raw)
    if (raw !== '' && raw !== null && monthly_target === null) return c.json({ error: 'Aporte mensal inválido.' }, 400)
  }

  // priority
  let priority: number | null | undefined = undefined
  if (has('prioridade') || has('priority')) {
    priority = parsePrioridade(body.prioridade ?? body.priority)
    if (priority === null) return c.json({ error: 'Prioridade deve ser de 1 a 5.' }, 400)
  }

  // status: só 'active'/'paused' à mão (MR11)
  let status: string | undefined = undefined
  if (has('status')) {
    if (!VALID_STATUS_PUT.includes(body.status))
      return c.json({ error: `Status inválido. Use: ${VALID_STATUS_PUT.join(', ')}.` }, 400)
    status = body.status
  }

  // type: editável (MR14) — recomputa ícone/cor
  let type: string | undefined = undefined
  let icon: string | undefined = undefined
  let color: string | undefined = undefined
  if (has('tipo') || has('type')) {
    const t = parseTipo(body.tipo ?? body.type)
    if (t === null) return c.json({ error: 'Tipo inválido.', tipos_validos: Object.keys(RESERVE_CONFIGS) }, 400)
    type = t
    const cfg = RESERVE_CONFIGS[t] || RESERVE_CONFIGS.custom
    icon = cfg.icon; color = cfg.color
  }

  await c.env.DB.prepare(
    `UPDATE specialized_reserves SET
     name = COALESCE(?, name),
     description = COALESCE(?, description),
     target_amount = COALESCE(?, target_amount),
     current_amount = COALESCE(?, current_amount),
     deadline = COALESCE(?, deadline),
     monthly_target = COALESCE(?, monthly_target),
     priority = COALESCE(?, priority),
     status = COALESCE(?, status),
     type = COALESCE(?, type),
     icon = COALESCE(?, icon),
     color = COALESCE(?, color)
     WHERE id = ? AND user_id = ?`
  ).bind(
    (name ?? null) || null,
    (description ?? null),
    target_amount,
    current_amount,
    deadline === undefined ? null : deadline,
    monthly_target === undefined ? null : monthly_target,
    priority === undefined ? null : priority,
    status ?? null,
    type ?? null,
    icon ?? null,
    color ?? null,
    id, user.id
  ).run()

  return c.json({ success: true, message: 'Reserva atualizada!' })
})

// ── Lógica de depósito compartilhada (MR1/MR4) ─────────────────────────────
async function doDeposit(db: D1Database, userId: number, id: number, amountRaw: any, description: any) {
  const reserve = await db.prepare(
    `SELECT * FROM specialized_reserves WHERE id = ? AND user_id = ?`
  ).bind(id, userId).first() as any
  if (!reserve) return { code: 404, body: { error: 'Reserva não encontrada' } }
  if (reserve.status === 'cancelled') return { code: 400, body: { error: 'Reserva cancelada.' } } // MR16: só bloqueia cancelada

  const amount = parseValorPos(amountRaw) // MR6
  if (amount === null) return { code: 400, body: { error: 'Valor inválido' } }

  // MR1: deposita o valor CHEIO, nunca engole o excedente
  const newAmount = Math.round((Number(reserve.current_amount) + amount) * 100) / 100
  await db.prepare(`UPDATE specialized_reserves SET current_amount = ? WHERE id = ?`).bind(newAmount, id).run()
  await db.prepare(
    `INSERT INTO reserve_transactions (reserve_id, type, amount, description) VALUES (?, 'deposit', ?, ?)`
  ).bind(id, amount, description || 'Depósito').run()

  let completed = false
  if (newAmount >= Number(reserve.target_amount)) {
    await db.prepare(
      `UPDATE specialized_reserves SET status = 'completed', completed_at = datetime('now') WHERE id = ?`
    ).bind(id).run()
    completed = true
    await checkConquista(db, userId, 'reserva_spec_completa')
  }

  // MR4: sincroniza meta vinculada em AMBAS as rotas de depósito
  let meta_sincronizada = false
  if (reserve.linked_meta_id) {
    await db.prepare(`
      UPDATE metas SET valor_atual = MIN(valor_atual + ?, valor_objetivo)
      WHERE id = ? AND user_id = ? AND status = 'ativa'
    `).bind(amount, reserve.linked_meta_id, userId).run()
    meta_sincronizada = true
  }

  return {
    code: 200,
    body: {
      success: true,
      new_amount: newAmount,
      percent_complete: capPct(newAmount, Number(reserve.target_amount)), // MR21
      completed,
      meta_sincronizada,
      message: completed ? `🎉 Reserva "${reserve.name}" completada!` : `Depósito de R$ ${amount.toFixed(2)} realizado!`
    }
  }
}

// ── POST /api/reservas-esp/:id/depositar ──────────────────────────────────
reservasEsp.post('/:id/depositar', requireAuth, async (c) => {
  const user = c.get('user')
  const id = parseId(c.req.param('id')) // MR13
  if (id === null) return c.json({ error: 'ID inválido.' }, 400)
  const body = await c.req.json().catch(() => ({}))
  const r = await doDeposit(c.env.DB, user.id, id, body.amount ?? body.valor ?? body.value, body.description ?? body.descricao)
  return c.json(r.body, r.code as any)
})

// ── POST /api/reservas-esp/:id/sacar ──────────────────────────────────────
reservasEsp.post('/:id/sacar', requireAuth, async (c) => {
  const user = c.get('user')
  const id = parseId(c.req.param('id')) // MR13
  if (id === null) return c.json({ error: 'ID inválido.' }, 400)

  const reserve = await c.env.DB.prepare(
    `SELECT * FROM specialized_reserves WHERE id = ? AND user_id = ?`
  ).bind(id, user.id).first() as any
  if (!reserve) return c.json({ error: 'Reserva não encontrada' }, 404)

  const body2 = await c.req.json().catch(() => ({}))
  const amount = parseValorPos(body2.amount ?? body2.valor ?? body2.value) // MR6
  const description = body2.description ?? body2.descricao
  if (amount === null) return c.json({ error: 'Valor inválido' }, 400)
  if (amount > Number(reserve.current_amount))
    return c.json({ error: `Saldo insuficiente (disponível: R$ ${Number(reserve.current_amount).toFixed(2)})` }, 400)

  const newAmount = Math.round((Number(reserve.current_amount) - amount) * 100) / 100

  await c.env.DB.prepare(`UPDATE specialized_reserves SET current_amount = ?, status = 'active', completed_at = NULL WHERE id = ?`).bind(newAmount, id).run()
  await c.env.DB.prepare(
    `INSERT INTO reserve_transactions (reserve_id, type, amount, description) VALUES (?, 'withdrawal', ?, ?)`
  ).bind(id, amount, description || 'Saque').run()

  // MR5: saque devolve à meta vinculada
  let meta_sincronizada = false
  if (reserve.linked_meta_id) {
    await c.env.DB.prepare(`
      UPDATE metas SET valor_atual = MAX(valor_atual - ?, 0)
      WHERE id = ? AND user_id = ? AND status = 'ativa'
    `).bind(amount, reserve.linked_meta_id, user.id).run()
    meta_sincronizada = true
  }

  return c.json({ success: true, new_amount: newAmount, meta_sincronizada, message: `Saque de R$ ${amount.toFixed(2)} realizado!` })
})

// ── GET /api/reservas-esp/:id/historico ───────────────────────────────────
reservasEsp.get('/:id/historico', requireAuth, async (c) => {
  const user = c.get('user')
  const id = parseId(c.req.param('id')) // MR13
  if (id === null) return c.json({ error: 'ID inválido.' }, 400)

  const reserve = await c.env.DB.prepare(
    `SELECT id FROM specialized_reserves WHERE id = ? AND user_id = ?`
  ).bind(id, user.id).first()
  if (!reserve) return c.json({ error: 'Reserva não encontrada' }, 404)

  const result = await c.env.DB.prepare(
    `SELECT * FROM reserve_transactions WHERE reserve_id = ? ORDER BY date DESC LIMIT 50`
  ).bind(id).all()

  return c.json({ transactions: result.results })
})

// ── DELETE /api/reservas-esp/:id ──────────────────────────────────────────
reservasEsp.delete('/:id', requireAuth, async (c) => {
  const user = c.get('user')
  const id = parseId(c.req.param('id')) // MR13
  if (id === null) return c.json({ error: 'ID inválido.' }, 400)

  const reserve = await c.env.DB.prepare(
    `SELECT * FROM specialized_reserves WHERE id = ? AND user_id = ?`
  ).bind(id, user.id).first() as any
  if (!reserve) return c.json({ error: 'Reserva não encontrada' }, 404)

  // MR5: excluir devolve o saldo à meta vinculada
  if (reserve.linked_meta_id && Number(reserve.current_amount) > 0) {
    await c.env.DB.prepare(`
      UPDATE metas SET valor_atual = MAX(valor_atual - ?, 0)
      WHERE id = ? AND user_id = ? AND status = 'ativa'
    `).bind(Number(reserve.current_amount), reserve.linked_meta_id, user.id).run()
  }

  // MR18: não deixar transações órfãs
  await c.env.DB.prepare(`DELETE FROM reserve_transactions WHERE reserve_id = ?`).bind(id).run()
  await c.env.DB.prepare(`DELETE FROM specialized_reserves WHERE id = ? AND user_id = ?`).bind(id, user.id).run()
  return c.json({ success: true, message: `Reserva "${reserve.name}" removida.` })
})

async function checkConquista(db: D1Database, userId: number, codigo: string) {
  try {
    await db.prepare(
      `INSERT OR IGNORE INTO conquistas_usuario (user_id, conquista_codigo, visualizado) VALUES (?, ?, 0)`
    ).bind(userId, codigo).run()
  } catch { }
}

// ── Alias: POST /api/reservas-esp/:id/deposito → mesma lógica de depositar ──
reservasEsp.post('/:id/deposito', requireAuth, async (c) => {
  const user = c.get('user')
  const id = parseId(c.req.param('id')) // MR13
  if (id === null) return c.json({ error: 'ID inválido.' }, 400)
  const body = await c.req.json().catch(() => ({})) as any
  const r = await doDeposit(c.env.DB, user.id, id, body.amount ?? body.valor ?? body.value, body.description ?? body.descricao)
  return c.json(r.body, r.code as any)
})

export default reservasEsp
