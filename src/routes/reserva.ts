import { Hono } from 'hono'
import { requireAuth } from './auth'

type Bindings = { DB: D1Database }
type Variables = { user: { id: number; nome: string; email: string; plano: string } }

const reserva = new Hono<{ Bindings: Bindings; Variables: Variables }>()

// GET /api/reserva — busca (ou cria) a reserva de emergência do usuário
// Sincroniza com specialized_reserves (tipo emergency) quando disponível
reserva.get('/', requireAuth, async (c) => {
  const user = c.get('user')

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
  const valorIdeal = Math.round(mediaGastos * 6 * 100) / 100  // 6 meses padrão

  // 1) Tentar pegar da reserva especializada (tipo emergency)
  const reservaEsp = await c.env.DB.prepare(
    `SELECT * FROM specialized_reserves WHERE user_id = ? AND type = 'emergency' AND status != 'cancelled' ORDER BY created_at ASC LIMIT 1`
  ).bind(user.id).first() as any

  if (reservaEsp) {
    const cobertura = valorIdeal > 0 ? Math.min(100, Math.round((reservaEsp.current_amount / valorIdeal) * 100)) : 0
    const mesesCobertos = mediaGastos > 0 ? Math.round((reservaEsp.current_amount / mediaGastos) * 10) / 10 : 0
    return c.json({
      reserva: {
        id: reservaEsp.id,
        nome: reservaEsp.name,
        objetivo_meses: 6,
        valor_atual: reservaEsp.current_amount,
        meta: reservaEsp.target_amount,
        origem: 'reservas_esp',
        reserve_id: reservaEsp.id,
      },
      media_gastos_mensais: Math.round(mediaGastos * 100) / 100,
      valor_ideal: valorIdeal,
      cobertura_pct: cobertura,
      meses_cobertos: mesesCobertos
    })
  }

  // 2) Fallback: tabela legada reserva_emergencia
  let r = await c.env.DB.prepare('SELECT * FROM reserva_emergencia WHERE user_id = ? LIMIT 1').bind(user.id).first() as any
  const mesesObj = r?.objetivo_meses || 6
  const valorIdealLegado = Math.round(mediaGastos * mesesObj * 100) / 100
  const cobertura = valorIdealLegado > 0 && r ? Math.round((r.valor_atual / valorIdealLegado) * 100) : 0
  const mesesCobertos = mediaGastos > 0 && r ? Math.round((r.valor_atual / mediaGastos) * 10) / 10 : 0

  return c.json({
    reserva: r || null,
    media_gastos_mensais: Math.round(mediaGastos * 100) / 100,
    valor_ideal: valorIdealLegado,
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

  const existing = await c.env.DB.prepare('SELECT * FROM reserva_emergencia WHERE id = ? AND user_id = ?').bind(id, user.id).first() as any
  if (!existing) return c.json({ error: 'Reserva não encontrada' }, 404)

  const body = await c.req.json()

  // Fallback para campos não enviados (usa valor atual do banco)
  const nome          = body.nome          ?? existing.nome
  const objetivo_meses = body.objetivo_meses !== undefined ? parseInt(body.objetivo_meses) : existing.objetivo_meses
  const valor_atual   = body.valor_atual   !== undefined ? parseFloat(body.valor_atual)   : existing.valor_atual
  const observacoes   = body.observacoes   !== undefined ? (body.observacoes || null)      : existing.observacoes

  await c.env.DB.prepare(
    'UPDATE reserva_emergencia SET nome=?, objetivo_meses=?, valor_atual=?, data_atualizacao=?, observacoes=? WHERE id=? AND user_id=?'
  ).bind(nome, objetivo_meses, valor_atual, new Date().toISOString().split('T')[0], observacoes, id, user.id).run()

  // Verificar conquistas de cobertura
  const mediaDespesas = await c.env.DB.prepare(`
    SELECT COALESCE(AVG(total_mes), 0) as media FROM (
      SELECT SUM(valor) as total_mes FROM despesas WHERE user_id = ? 
      AND data >= date('now', '-3 months') GROUP BY strftime('%Y-%m', data)
    )
  `).bind(user.id).first() as any

  const media = mediaDespesas?.media || 0
  if (media > 0) {
    const mesesCobertos = valor_atual / media
    if (mesesCobertos >= 1) await verificarConquista(c.env.DB, user.id, 'reserva_1_mes')
    if (mesesCobertos >= 3) await verificarConquista(c.env.DB, user.id, 'reserva_3_meses')
    if (mesesCobertos >= 6) await verificarConquista(c.env.DB, user.id, 'reserva_6_meses')
    if (mesesCobertos >= objetivo_meses) await verificarConquista(c.env.DB, user.id, 'reserva_completa')
  }

  return c.json({ success: true, message: 'Reserva atualizada!' })
})

// PATCH /api/reserva/:id/depositar — adicionar valor à reserva legácia
reserva.patch('/:id/depositar', requireAuth, async (c) => {
  const user = c.get('user')
  const id = c.req.param('id')
  const { valor, descricao = 'Depósito' } = await c.req.json()

  if (!valor || parseFloat(valor) <= 0)
    return c.json({ error: 'Informe um valor positivo' }, 400)

  const existing = await c.env.DB.prepare('SELECT * FROM reserva_emergencia WHERE id = ? AND user_id = ?').bind(id, user.id).first() as any
  if (!existing) return c.json({ error: 'Reserva não encontrada' }, 404)

  const novoValor = parseFloat(existing.valor_atual) + parseFloat(valor)
  await c.env.DB.prepare(
    'UPDATE reserva_emergencia SET valor_atual=?, data_atualizacao=? WHERE id=? AND user_id=?'
  ).bind(novoValor, new Date().toISOString().split('T')[0], id, user.id).run()

  // Verificar conquistas
  const mediaDespesas = await c.env.DB.prepare(`
    SELECT COALESCE(AVG(total_mes), 0) as media FROM (
      SELECT SUM(valor) as total_mes FROM despesas WHERE user_id = ? 
      AND data >= date('now', '-3 months') GROUP BY strftime('%Y-%m', data)
    )
  `).bind(user.id).first() as any
  const media = mediaDespesas?.media || 0
  if (media > 0) {
    const meses = novoValor / media
    if (meses >= 1) await verificarConquista(c.env.DB, user.id, 'reserva_1_mes')
    if (meses >= 3) await verificarConquista(c.env.DB, user.id, 'reserva_3_meses')
    if (meses >= 6) await verificarConquista(c.env.DB, user.id, 'reserva_6_meses')
    if (meses >= (existing.objetivo_meses || 6)) await verificarConquista(c.env.DB, user.id, 'reserva_completa')
  }

  return c.json({ success: true, novo_valor: novoValor, message: `R$ ${parseFloat(valor).toFixed(2)} depositado!` })
})

// PATCH /api/reserva/:id/sacar — remover valor da reserva legácia
reserva.patch('/:id/sacar', requireAuth, async (c) => {
  const user = c.get('user')
  const id = c.req.param('id')
  const { valor, descricao = 'Saque' } = await c.req.json()

  if (!valor || parseFloat(valor) <= 0)
    return c.json({ error: 'Informe um valor positivo' }, 400)

  const existing = await c.env.DB.prepare('SELECT * FROM reserva_emergencia WHERE id = ? AND user_id = ?').bind(id, user.id).first() as any
  if (!existing) return c.json({ error: 'Reserva não encontrada' }, 404)

  const novoValor = Math.max(0, parseFloat(existing.valor_atual) - parseFloat(valor))
  await c.env.DB.prepare(
    'UPDATE reserva_emergencia SET valor_atual=?, data_atualizacao=? WHERE id=? AND user_id=?'
  ).bind(novoValor, new Date().toISOString().split('T')[0], id, user.id).run()

  return c.json({ success: true, novo_valor: novoValor, message: `R$ ${parseFloat(valor).toFixed(2)} sacado!` })
})

// DELETE /api/reserva/:id
reserva.delete('/:id', requireAuth, async (c) => {
  const user = c.get('user')
  const id = c.req.param('id')
  await c.env.DB.prepare('DELETE FROM reserva_emergencia WHERE id = ? AND user_id = ?').bind(id, user.id).run()
  return c.json({ success: true })
})

// GET /api/reserva/historico — histórico de depósitos/saques (specialized_reserves transactions)
reserva.get('/historico', requireAuth, async (c) => {
  const user = c.get('user')
  // Buscar a reserva de emergência (specialized ou legada)
  const reservaEsp = await c.env.DB.prepare(
    `SELECT id FROM specialized_reserves WHERE user_id = ? AND type = 'emergency' AND status != 'cancelled' ORDER BY created_at ASC LIMIT 1`
  ).bind(user.id).first() as any

  if (reservaEsp) {
    const transactions = await c.env.DB.prepare(
      `SELECT * FROM reserve_transactions WHERE reserve_id = ? ORDER BY created_at DESC LIMIT 24`
    ).bind(reservaEsp.id).all()
    return c.json({ historico: transactions.results, reserve_id: reservaEsp.id })
  }

  // Fallback: histórico vazio para reserva legada
  return c.json({ historico: [], reserve_id: null })
})

async function verificarConquista(db: D1Database, userId: number, codigo: string) {
  try {
    await db.prepare('INSERT OR IGNORE INTO conquistas_usuario (user_id, conquista_codigo, visualizado) VALUES (?, ?, 0)').bind(userId, codigo).run()
  } catch { }
}

export default reserva
