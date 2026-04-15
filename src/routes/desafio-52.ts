import { Hono } from 'hono'
import { requireAuth } from './auth'

type Bindings = { DB: D1Database }
type Variables = { user: { id: number; nome: string; email: string; plano: string } }

const desafio52 = new Hono<{ Bindings: Bindings; Variables: Variables }>()

function getWeekNumber(date: Date): number {
  const start = new Date(date.getFullYear(), 0, 1)
  const diff = date.getTime() - start.getTime()
  return Math.ceil(((diff / 86400000) + start.getDay() + 1) / 7)
}

// ── GET /api/desafio-52?ano=A ──────────────────────────────────────────────
desafio52.get('/', requireAuth, async (c) => {
  const user = c.get('user')
  const ano = parseInt(c.req.query('ano') || String(new Date().getFullYear()))

  // Buscar semanas existentes
  const result = await c.env.DB.prepare(`
    SELECT * FROM weekly_challenges WHERE user_id = ? AND year = ? ORDER BY week_number ASC
  `).bind(user.id, ano).all()

  const existing = result.results as any[]

  // Criar semanas faltantes (1-52)
  if (existing.length === 0) {
    // Primeiro acesso: criar todas as 52 semanas
    const batch = []
    for (let w = 1; w <= 52; w++) {
      batch.push(c.env.DB.prepare(
        `INSERT OR IGNORE INTO weekly_challenges (user_id, year, week_number, target_amount, status) VALUES (?, ?, ?, ?, 'pending')`
      ).bind(user.id, ano, w, w))
    }
    await c.env.DB.batch(batch)

    await c.env.DB.prepare(
      `INSERT OR IGNORE INTO conquistas_usuario (user_id, conquista_codigo, visualizado) VALUES (?, 'desafio_52_iniciou', 0)`
    ).bind(user.id).run()
  }

  const allWeeks = await c.env.DB.prepare(`
    SELECT * FROM weekly_challenges WHERE user_id = ? AND year = ? ORDER BY week_number ASC
  `).bind(user.id, ano).all()

  const weeks = allWeeks.results as any[]
  const currentWeek = getWeekNumber(new Date())
  const completed = weeks.filter(w => w.status === 'completed').length
  const totalTarget = weeks.reduce((s, w) => s + w.target_amount, 0)       // R$ 1378 no total
  const totalSaved = weeks.filter(w => w.status === 'completed').reduce((s, w) => s + w.target_amount, 0)

  // Conquista metade
  if (completed >= 26) {
    await c.env.DB.prepare(
      `INSERT OR IGNORE INTO conquistas_usuario (user_id, conquista_codigo, visualizado) VALUES (?, 'desafio_52_metade', 0)`
    ).bind(user.id).run()
  }
  if (completed >= 52) {
    await c.env.DB.prepare(
      `INSERT OR IGNORE INTO conquistas_usuario (user_id, conquista_codigo, visualizado) VALUES (?, 'desafio_52_completo', 0)`
    ).bind(user.id).run()
  }

  return c.json({
    year: ano,
    weeks,
    current_week: currentWeek,
    summary: {
      completed,
      pending: weeks.filter(w => w.status === 'pending').length,
      skipped: weeks.filter(w => w.status === 'skipped').length,
      total_saved: Math.round(totalSaved * 100) / 100,
      total_target: Math.round(totalTarget * 100) / 100,
      progress_pct: Math.round((completed / 52) * 100),
    }
  })
})

// ── PATCH /api/desafio-52/:semana ─────────────────────────────────────────
desafio52.patch('/:semana', requireAuth, async (c) => {
  const user = c.get('user')
  const weekNum = parseInt(c.req.param('semana'))
  const ano = parseInt(c.req.query('ano') || String(new Date().getFullYear()))
  const body = await c.req.json()
  // Aceitar status em pt-BR e en (retrocompatível)
  const statusMap: Record<string, string> = {
    'pago': 'completed',
    'concluido': 'completed',
    'concluído': 'completed',
    'completed': 'completed',
    'pulado': 'skipped',
    'pulei': 'skipped',
    'skipped': 'skipped',
    'pendente': 'pending',
    'pending': 'pending',
  }
  const status = statusMap[body.status?.toLowerCase()] || body.status

  if (!['completed', 'skipped', 'pending'].includes(status))
    return c.json({ error: 'Status inválido. Use: completed/pago, skipped/pulado, pending/pendente' }, 400)
  if (weekNum < 1 || weekNum > 52)
    return c.json({ error: 'Semana inválida' }, 400)

  const week = await c.env.DB.prepare(
    `SELECT * FROM weekly_challenges WHERE user_id = ? AND year = ? AND week_number = ?`
  ).bind(user.id, ano, weekNum).first() as any
  if (!week) return c.json({ error: 'Semana não encontrada' }, 404)

  await c.env.DB.prepare(`
    UPDATE weekly_challenges SET
      status = ?,
      completed_at = CASE WHEN ? = 'completed' THEN datetime('now') ELSE NULL END
    WHERE user_id = ? AND year = ? AND week_number = ?
  `).bind(status, status, user.id, ano, weekNum).run()

  // ── Integração Desafio 52 → Metas e Investimentos ──────────────────────────
  let meta_atualizada = false
  let investimento_atualizado = false
  if (status === 'completed') {
    const config = await c.env.DB.prepare(
      `SELECT meta_vinculada, investimento_vinculado FROM desafio_config WHERE user_id = ?`
    ).bind(user.id).first() as any

    if (config?.meta_vinculada) {
      await c.env.DB.prepare(`
        UPDATE metas SET valor_atual = MIN(valor_atual + ?, valor_objetivo)
        WHERE id = ? AND user_id = ? AND status = 'ativa'
      `).bind(week.target_amount, config.meta_vinculada, user.id).run()
      meta_atualizada = true
    }

    if (config?.investimento_vinculado) {
      await c.env.DB.prepare(`
        UPDATE investimentos SET valor_investido = valor_investido + ?, valor_atual = valor_atual + ?
        WHERE id = ? AND user_id = ?
      `).bind(week.target_amount, week.target_amount, config.investimento_vinculado, user.id).run()
      investimento_atualizado = true
    }
  }

  return c.json({
    success: true,
    week: weekNum,
    amount: week.target_amount,
    meta_atualizada,
    investimento_atualizado,
    message: status === 'completed'
      ? `Semana ${weekNum} concluida! +R$ ${week.target_amount.toFixed(2)} guardados${meta_atualizada ? ' — meta atualizada!' : ''}${investimento_atualizado ? ' — investimento atualizado!' : ''}`
      : status === 'skipped'
      ? `Semana ${weekNum} pulada.`
      : `Semana ${weekNum} marcada como pendente`
  })
})

// ── POST /api/desafio-52/reset ────────────────────────────────────────────
desafio52.post('/reset', requireAuth, async (c) => {
  const user = c.get('user')
  const ano = parseInt(c.req.query('ano') || String(new Date().getFullYear()))

  await c.env.DB.prepare(
    `UPDATE weekly_challenges SET status = 'pending', completed_at = NULL WHERE user_id = ? AND year = ?`
  ).bind(user.id, ano).run()

  return c.json({ success: true, message: 'Desafio reiniciado!' })
})

// ── GET /api/desafio-52/config — Melhoria 3.1 ─────────────────────────────
desafio52.get('/config', requireAuth, async (c) => {
  const user = c.get('user')

  const config = await c.env.DB.prepare(
    `SELECT * FROM desafio_config WHERE user_id = ? ORDER BY id DESC LIMIT 1`
  ).bind(user.id).first() as any

  // Config padrão se não houver customização
  if (!config) {
    return c.json({
      valor_base: 1,
      multiplicador: 1,
      modo_invertido: false,
      descricao: 'Padrão: semana N = R$ N (total: R$ 1.378,00/ano)',
      total_anual: 1378
    })
  }

  const total = calcularTotalAnual(config.valor_base, config.multiplicador, config.modo_invertido)
  return c.json({ ...config, total_anual: total })
})

// ── POST /api/desafio-52/config — Melhoria 3.1 ────────────────────────────
desafio52.post('/config', requireAuth, async (c) => {
  const user = c.get('user')
  const { valor_base = 1, multiplicador = 1, modo_invertido = false, meta_vinculada = null, investimento_vinculado = null } = await c.req.json()

  const vBase = Math.max(0.5, Math.min(100, parseFloat(valor_base)))
  const mult = Math.max(0.5, Math.min(10, parseFloat(multiplicador)))
  const invertido = Boolean(modo_invertido)
  const metaId = meta_vinculada ? parseInt(meta_vinculada) : null
  const investId = investimento_vinculado ? parseInt(investimento_vinculado) : null

  const existing = await c.env.DB.prepare(`SELECT id FROM desafio_config WHERE user_id = ?`).bind(user.id).first()
  if (existing) {
    await c.env.DB.prepare(
      `UPDATE desafio_config SET valor_base=?, multiplicador=?, modo_invertido=?, meta_vinculada=?, investimento_vinculado=?, updated_at=CURRENT_TIMESTAMP WHERE user_id=?`
    ).bind(vBase, mult, invertido ? 1 : 0, metaId, investId, user.id).run()
  } else {
    await c.env.DB.prepare(
      `INSERT INTO desafio_config (user_id, valor_base, multiplicador, modo_invertido, meta_vinculada, investimento_vinculado) VALUES (?,?,?,?,?,?)`
    ).bind(user.id, vBase, mult, invertido ? 1 : 0, metaId, investId).run()
  }

  const total = calcularTotalAnual(vBase, mult, invertido)

  return c.json({
    success: true,
    message: 'Configuração do desafio salva!',
    total_anual: total,
    preview: `Semana 1: R$ ${(vBase * mult).toFixed(2)} | Semana 52: R$ ${(invertido ? vBase * mult : 52 * vBase * mult).toFixed(2)}`
  })
})

function calcularTotalAnual(valorBase: number, multiplicador: number, invertido: boolean): number {
  let total = 0
  for (let w = 1; w <= 52; w++) {
    const semana = invertido ? (53 - w) : w
    total += semana * valorBase * multiplicador
  }
  return Math.round(total * 100) / 100
}

export default desafio52
