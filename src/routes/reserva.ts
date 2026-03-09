import { Hono } from 'hono'
import { requireAuth } from './auth'

type Bindings = { DB: D1Database }
type Variables = { user: { id: number; nome: string; email: string; plano: string } }

const reserva = new Hono<{ Bindings: Bindings; Variables: Variables }>()

// GET /api/reserva — busca (ou cria) a reserva de emergência do usuário
reserva.get('/', requireAuth, async (c) => {
  const user = c.get('user')

  let r = await c.env.DB.prepare('SELECT * FROM reserva_emergencia WHERE user_id = ? LIMIT 1').bind(user.id).first() as any

  // Calcular média de despesas mensais (últimos 3 meses)
  const mediaDespesas = await c.env.DB.prepare(`
    SELECT COALESCE(AVG(total_mes), 0) as media FROM (
      SELECT SUM(valor) as total_mes FROM despesas
      WHERE user_id = ? AND status IN ('pago','pendente')
      AND data >= date('now', '-3 months')
      GROUP BY strftime('%Y-%m', data)
    )
  `).bind(user.id).first() as any

  const mediaGastos = mediaDespesas?.media || 0
  const mesesObj = r?.objetivo_meses || 6
  const valorIdeal = mediaGastos * mesesObj
  const cobertura = valorIdeal > 0 && r ? Math.round((r.valor_atual / valorIdeal) * 100) : 0
  const mesesCobertos = mediaGastos > 0 && r ? Math.round((r.valor_atual / mediaGastos) * 10) / 10 : 0

  return c.json({
    reserva: r || null,
    media_gastos_mensais: Math.round(mediaGastos * 100) / 100,
    valor_ideal: Math.round(valorIdeal * 100) / 100,
    cobertura_pct: Math.min(100, cobertura),
    meses_cobertos: mesesCobertos
  })
})

// POST /api/reserva — criar reserva
reserva.post('/', requireAuth, async (c) => {
  const user = c.get('user')
  const existing = await c.env.DB.prepare('SELECT id FROM reserva_emergencia WHERE user_id = ?').bind(user.id).first()
  if (existing) return c.json({ error: 'Reserva já existe. Use PUT para atualizar.' }, 400)

  const { nome = 'Reserva de Emergência', objetivo_meses = 6, valor_atual = 0, observacoes } = await c.req.json()

  const result = await c.env.DB.prepare(
    'INSERT INTO reserva_emergencia (user_id, nome, objetivo_meses, valor_atual, data_atualizacao, observacoes) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(user.id, nome, parseInt(objetivo_meses), parseFloat(valor_atual), new Date().toISOString().split('T')[0], observacoes || null).run()

  await verificarConquista(c.env.DB, user.id, 'reserva_iniciada')

  return c.json({ success: true, id: result.meta.last_row_id, message: 'Reserva criada!' }, 201)
})

// PUT /api/reserva/:id — atualizar reserva (depósito, saque ou ajuste)
reserva.put('/:id', requireAuth, async (c) => {
  const user = c.get('user')
  const id = c.req.param('id')
  const { nome, objetivo_meses, valor_atual, observacoes } = await c.req.json()

  const existing = await c.env.DB.prepare('SELECT id FROM reserva_emergencia WHERE id = ? AND user_id = ?').bind(id, user.id).first()
  if (!existing) return c.json({ error: 'Reserva não encontrada' }, 404)

  await c.env.DB.prepare(
    'UPDATE reserva_emergencia SET nome=?, objetivo_meses=?, valor_atual=?, data_atualizacao=?, observacoes=? WHERE id=? AND user_id=?'
  ).bind(nome, parseInt(objetivo_meses), parseFloat(valor_atual), new Date().toISOString().split('T')[0], observacoes || null, id, user.id).run()

  // Verificar conquistas de cobertura
  const mediaDespesas = await c.env.DB.prepare(`
    SELECT COALESCE(AVG(total_mes), 0) as media FROM (
      SELECT SUM(valor) as total_mes FROM despesas WHERE user_id = ? 
      AND data >= date('now', '-3 months') GROUP BY strftime('%Y-%m', data)
    )
  `).bind(user.id).first() as any

  const media = mediaDespesas?.media || 0
  if (media > 0) {
    const mesesCobertos = parseFloat(valor_atual) / media
    if (mesesCobertos >= 1) await verificarConquista(c.env.DB, user.id, 'reserva_1_mes')
    if (mesesCobertos >= 3) await verificarConquista(c.env.DB, user.id, 'reserva_3_meses')
    if (mesesCobertos >= 6) await verificarConquista(c.env.DB, user.id, 'reserva_6_meses')
    const objetivoMesesN = parseInt(objetivo_meses)
    if (mesesCobertos >= objetivoMesesN) await verificarConquista(c.env.DB, user.id, 'reserva_completa')
  }

  return c.json({ success: true, message: 'Reserva atualizada!' })
})

// DELETE /api/reserva/:id
reserva.delete('/:id', requireAuth, async (c) => {
  const user = c.get('user')
  const id = c.req.param('id')
  await c.env.DB.prepare('DELETE FROM reserva_emergencia WHERE id = ? AND user_id = ?').bind(id, user.id).run()
  return c.json({ success: true })
})

async function verificarConquista(db: D1Database, userId: number, codigo: string) {
  try {
    await db.prepare('INSERT OR IGNORE INTO conquistas_usuario (user_id, conquista_codigo, visualizado) VALUES (?, ?, 0)').bind(userId, codigo).run()
  } catch { }
}

export default reserva
