import { Hono } from 'hono'
import { requireAuth } from './auth'
import { getLimites } from './planos'

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
    percent_complete: r.target_amount > 0 ? Math.min(100, Math.round((r.current_amount / r.target_amount) * 100)) : 0,
    remaining: Math.max(0, r.target_amount - r.current_amount),
  }))

  // Resumo total
  const total_saved = reserves.reduce((s, r) => s + (r.current_amount || 0), 0)
  const total_target = reserves.reduce((s, r) => s + (r.target_amount || 0), 0)

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

  // Limite de plano
  const lim = getLimites(user.plano)
  const maxReservas = user.plano === 'free' ? 1 : user.plano === 'premium' ? 3 : 999
  const count = await c.env.DB.prepare(
    `SELECT COUNT(*) as n FROM specialized_reserves WHERE user_id = ? AND status IN ('active','paused')`
  ).bind(user.id).first() as any

  if ((count?.n || 0) >= maxReservas) {
    const msg = user.plano === 'free'
      ? 'Plano Free permite apenas 1 reserva. Atualize para Premium (3 reservas) ou Pro (ilimitado).'
      : 'Plano Premium permite até 3 reservas simultâneas. Atualize para Pro (ilimitado).'
    return c.json({ error: msg, upgrade: true, feature: 'reservas_multiplas' }, 403)
  }

  const body = await c.req.json()
  // Aceitar campos em pt-BR OU en (retrocompatível)
  const rawType = body.tipo || body.type || 'custom'
  const type = TYPE_PTBR_MAP[rawType.toLowerCase()] || 'custom'
  const name = body.nome || body.name
  const description = body.descricao || body.description
  const target_amount = body.meta_valor || body.valor_meta || body.target_amount
  const current_amount = body.valor_atual || body.current_amount || 0
  const deadline = body.prazo || body.deadline
  const monthly_target = body.aporte_mensal || body.monthly_target
  const priority = body.prioridade || body.priority
  const linked_meta_id = body.meta_id || body.linked_meta_id

  if (!name || !target_amount || target_amount <= 0)
    return c.json({ error: 'Nome e valor meta são obrigatórios' }, 400)

  const cfg = RESERVE_CONFIGS[type] || RESERVE_CONFIGS.custom

  const result = await c.env.DB.prepare(
    `INSERT INTO specialized_reserves 
     (user_id, type, name, description, target_amount, current_amount, priority, deadline, icon, color, monthly_target, linked_meta_id, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')`
  ).bind(
    user.id, type, name, description || null,
    parseFloat(target_amount), parseFloat(current_amount),
    priority || cfg.priority,
    deadline || null,
    cfg.icon, cfg.color,
    monthly_target ? parseFloat(monthly_target) : null,
    linked_meta_id ? parseInt(linked_meta_id) : null
  ).run()

  const id = result.meta.last_row_id

  // Se tem valor inicial, registrar transação
  if (current_amount > 0) {
    await c.env.DB.prepare(
      `INSERT INTO reserve_transactions (reserve_id, type, amount, description) VALUES (?, 'deposit', ?, 'Saldo inicial')`
    ).bind(id, parseFloat(current_amount)).run()
  }

  // Conquista
  await checkConquista(c.env.DB, user.id, 'multi_reserva_criada')

  const activeCount = (count?.n || 0) + 1
  if (activeCount >= 3) await checkConquista(c.env.DB, user.id, 'multi_3_reservas')

  return c.json({ success: true, id, message: `Reserva "${name}" criada com sucesso!` }, 201)
})

// ── PUT /api/reservas-esp/:id ──────────────────────────────────────────────
reservasEsp.put('/:id', requireAuth, async (c) => {
  const user = c.get('user')
  const id = parseInt(c.req.param('id'))

  const existing = await c.env.DB.prepare(
    `SELECT * FROM specialized_reserves WHERE id = ? AND user_id = ?`
  ).bind(id, user.id).first() as any
  if (!existing) return c.json({ error: 'Reserva não encontrada' }, 404)

  const body = await c.req.json()
  // Aceitar campos em pt-BR OU en (retrocompatível)
  const name = body.nome || body.name
  const description = body.descricao || body.description
  const target_amount = body.meta_valor || body.valor_meta || body.target_amount
  const deadline = body.prazo || body.deadline
  const monthly_target = body.aporte_mensal || body.monthly_target
  const priority = body.prioridade || body.priority
  const status = body.status

  await c.env.DB.prepare(
    `UPDATE specialized_reserves SET
     name = COALESCE(?, name),
     description = COALESCE(?, description),
     target_amount = COALESCE(?, target_amount),
     deadline = COALESCE(?, deadline),
     monthly_target = COALESCE(?, monthly_target),
     priority = COALESCE(?, priority),
     status = COALESCE(?, status)
     WHERE id = ? AND user_id = ?`
  ).bind(
    name || null, description || null,
    target_amount ? parseFloat(target_amount) : null,
    deadline || null,
    monthly_target ? parseFloat(monthly_target) : null,
    priority || null,
    status || null,
    id, user.id
  ).run()

  return c.json({ success: true, message: 'Reserva atualizada!' })
})

// ── POST /api/reservas-esp/:id/depositar ──────────────────────────────────
reservasEsp.post('/:id/depositar', requireAuth, async (c) => {
  const user = c.get('user')
  const id = parseInt(c.req.param('id'))

  const reserve = await c.env.DB.prepare(
    `SELECT * FROM specialized_reserves WHERE id = ? AND user_id = ?`
  ).bind(id, user.id).first() as any
  if (!reserve) return c.json({ error: 'Reserva não encontrada' }, 404)
  if (reserve.status !== 'active') return c.json({ error: 'Reserva não está ativa' }, 400)

  const { amount, description } = await c.req.json()
  if (!amount || amount <= 0) return c.json({ error: 'Valor inválido' }, 400)

  const newAmount = Math.min(reserve.current_amount + parseFloat(amount), reserve.target_amount)
  const actualDeposit = newAmount - reserve.current_amount

  // Atualizar saldo
  await c.env.DB.prepare(
    `UPDATE specialized_reserves SET current_amount = ? WHERE id = ?`
  ).bind(newAmount, id).run()

  // Registrar transação
  await c.env.DB.prepare(
    `INSERT INTO reserve_transactions (reserve_id, type, amount, description) VALUES (?, 'deposit', ?, ?)`
  ).bind(id, actualDeposit, description || 'Depósito').run()

  // Verificar se completou
  let completed = false
  if (newAmount >= reserve.target_amount) {
    await c.env.DB.prepare(
      `UPDATE specialized_reserves SET status = 'completed', completed_at = datetime('now') WHERE id = ?`
    ).bind(id).run()
    completed = true
    await checkConquista(c.env.DB, user.id, 'reserva_spec_completa')
  }

  // ── BLOCO 6.5: Integração Reservas → Metas ─────────────────────────────────
  // Se a reserva está vinculada a uma meta (linked_meta_id), atualizar o valor atual da meta
  let meta_sincronizada = false
  if (reserve.linked_meta_id) {
    await c.env.DB.prepare(`
      UPDATE metas SET valor_atual = MIN(valor_atual + ?, valor_objetivo)
      WHERE id = ? AND user_id = ? AND status = 'ativa'
    `).bind(actualDeposit, reserve.linked_meta_id, user.id).run()
    meta_sincronizada = true
  }

  return c.json({
    success: true,
    new_amount: newAmount,
    percent_complete: Math.round((newAmount / reserve.target_amount) * 100),
    completed,
    meta_sincronizada,
    message: completed ? `🎉 Reserva "${reserve.name}" completada!` : `Depósito de R$ ${actualDeposit.toFixed(2)} realizado!`
  })
})

// ── POST /api/reservas-esp/:id/sacar ──────────────────────────────────────
reservasEsp.post('/:id/sacar', requireAuth, async (c) => {
  const user = c.get('user')
  const id = parseInt(c.req.param('id'))

  const reserve = await c.env.DB.prepare(
    `SELECT * FROM specialized_reserves WHERE id = ? AND user_id = ?`
  ).bind(id, user.id).first() as any
  if (!reserve) return c.json({ error: 'Reserva não encontrada' }, 404)

  const { amount, description } = await c.req.json()
  if (!amount || amount <= 0) return c.json({ error: 'Valor inválido' }, 400)
  if (amount > reserve.current_amount) return c.json({ error: `Saldo insuficiente (disponível: R$ ${reserve.current_amount.toFixed(2)})` }, 400)

  const newAmount = reserve.current_amount - parseFloat(amount)

  await c.env.DB.prepare(`UPDATE specialized_reserves SET current_amount = ?, status = 'active' WHERE id = ?`).bind(newAmount, id).run()
  await c.env.DB.prepare(
    `INSERT INTO reserve_transactions (reserve_id, type, amount, description) VALUES (?, 'withdrawal', ?, ?)`
  ).bind(id, parseFloat(amount), description || 'Saque').run()

  return c.json({ success: true, new_amount: newAmount, message: `Saque de R$ ${parseFloat(amount).toFixed(2)} realizado!` })
})

// ── GET /api/reservas-esp/:id/historico ───────────────────────────────────
reservasEsp.get('/:id/historico', requireAuth, async (c) => {
  const user = c.get('user')
  const id = parseInt(c.req.param('id'))

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
  const id = parseInt(c.req.param('id'))

  const reserve = await c.env.DB.prepare(
    `SELECT * FROM specialized_reserves WHERE id = ? AND user_id = ?`
  ).bind(id, user.id).first() as any
  if (!reserve) return c.json({ error: 'Reserva não encontrada' }, 404)

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

export default reservasEsp
