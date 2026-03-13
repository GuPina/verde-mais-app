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
  const { status } = await c.req.json()

  if (!['completed', 'skipped', 'pending'].includes(status))
    return c.json({ error: 'Status inválido' }, 400)
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

  return c.json({
    success: true,
    week: weekNum,
    amount: week.target_amount,
    message: status === 'completed'
      ? `✅ Semana ${weekNum} concluída! +R$ ${week.target_amount.toFixed(2)} guardados`
      : status === 'skipped'
      ? `↩️ Semana ${weekNum} pulada. Não desista!`
      : `⏳ Semana ${weekNum} marcada como pendente`
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

export default desafio52
