import { Hono } from 'hono'
import { requireAuth } from './auth'

type Bindings = { DB: D1Database }
type Variables = { user: { id: number; nome: string; email: string; plano: string } }

const reserva = new Hono<{ Bindings: Bindings; Variables: Variables }>()

// ─── Helper: média de gastos mensais (excluindo não-recorrentes eventuais) ────
async function getMediaGastos(db: D1Database, userId: number): Promise<number> {
  // Exclui categorias claramente eventuais: viagem, presente, lazer esporádico
  const r = await db.prepare(`
    SELECT COALESCE(AVG(total_mes), 0) as media FROM (
      SELECT SUM(valor) as total_mes FROM despesas
      WHERE user_id = ? AND status IN ('pago','pendente')
      AND data >= date('now', '-3 months')
      AND categoria NOT IN ('viagem','presente','doacao','lazer_especial','outros_eventuais')
      AND (fixa_ou_variavel = 'fixa' OR recorrente = 1 OR categoria IN (
        'alimentacao','moradia','transporte','saude','educacao','utilidades',
        'seguros','assinaturas','emprestimo','financiamento','cartao','investimento'
      ))
      GROUP BY strftime('%Y-%m', data)
    )
  `).bind(userId).first() as any
  // Fallback: se não houver despesas recorrentes, usa todas as despesas
  if (!r?.media) {
    const r2 = await db.prepare(`
      SELECT COALESCE(AVG(total_mes), 0) as media FROM (
        SELECT SUM(valor) as total_mes FROM despesas
        WHERE user_id = ? AND status IN ('pago','pendente')
        AND data >= date('now', '-3 months')
        GROUP BY strftime('%Y-%m', data)
      )
    `).bind(userId).first() as any
    return r2?.media || 0
  }
  return r?.media || 0
}

// ─── Helper: calcular métricas ────────────────────────────────────────────────
function calcMetricas(valorAtual: number, mediaGastos: number, objetivoMeses: number) {
  const valorIdeal    = Math.round(mediaGastos * objetivoMeses * 100) / 100
  const cobertura     = valorIdeal > 0 ? Math.min(100, Math.round((valorAtual / valorIdeal) * 10000) / 100) : 0
  const mesesCobertos = mediaGastos > 0 ? Math.round((valorAtual / mediaGastos) * 10) / 10 : 0
  const faltando      = Math.max(0, valorIdeal - valorAtual)
  return { valorIdeal, cobertura, mesesCobertos, faltando: Math.round(faltando * 100) / 100 }
}

async function verificarConquista(db: D1Database, userId: number, codigo: string) {
  try {
    await db.prepare('INSERT OR IGNORE INTO conquistas_usuario (user_id, conquista_codigo, visualizado) VALUES (?, ?, 0)').bind(userId, codigo).run()
  } catch { }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/reserva — busca (ou cria) a reserva de emergência do usuário
// ─────────────────────────────────────────────────────────────────────────────
reserva.get('/', requireAuth, async (c) => {
  const user = c.get('user')
  const mediaGastos = await getMediaGastos(c.env.DB, user.id)

  // 1) Tentar da reserva especializada
  const reservaEsp = await c.env.DB.prepare(
    `SELECT * FROM specialized_reserves WHERE user_id = ? AND type = 'emergency' AND status != 'cancelled' ORDER BY created_at ASC LIMIT 1`
  ).bind(user.id).first() as any

  if (reservaEsp) {
    const met = calcMetricas(reservaEsp.current_amount, mediaGastos, 6)
    return c.json({
      reserva: {
        id: reservaEsp.id, nome: reservaEsp.name,
        objetivo_meses: 6, valor_atual: reservaEsp.current_amount,
        meta: reservaEsp.target_amount, origem: 'reservas_esp',
        reserve_id: reservaEsp.id,
      },
      media_gastos_mensais: Math.round(mediaGastos * 100) / 100,
      valor_ideal: met.valorIdeal,
      cobertura_pct: met.cobertura,
      meses_cobertos: met.mesesCobertos,
      faltando: met.faltando,
    })
  }

  // 2) Fallback: tabela legada
  const r = await c.env.DB.prepare('SELECT * FROM reserva_emergencia WHERE user_id = ? LIMIT 1').bind(user.id).first() as any
  const objetivoMeses = r?.objetivo_meses || 6
  const met = calcMetricas(r?.valor_atual || 0, mediaGastos, objetivoMeses)

  return c.json({
    reserva: r || null,
    media_gastos_mensais: Math.round(mediaGastos * 100) / 100,
    valor_ideal: met.valorIdeal,
    cobertura_pct: met.cobertura,
    meses_cobertos: met.mesesCobertos,
    faltando: met.faltando,
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// S-RE3: GET /api/reserva/progresso — linha do tempo até atingir a meta
// Deve ficar ANTES de /:id
// ─────────────────────────────────────────────────────────────────────────────
reserva.get('/progresso', requireAuth, async (c) => {
  const user = c.get('user')

  const r = await c.env.DB.prepare('SELECT * FROM reserva_emergencia WHERE user_id = ? LIMIT 1').bind(user.id).first() as any
  if (!r) return c.json({ error: 'Nenhuma reserva encontrada. Crie uma primeiro.' }, 404)

  const mediaGastos = await getMediaGastos(c.env.DB, user.id)
  const objetivoMeses = r.objetivo_meses || 6
  const met = calcMetricas(r.valor_atual, mediaGastos, objetivoMeses)

  // Buscar histórico para calcular aporte médio mensal
  const hist = await c.env.DB.prepare(
    `SELECT tipo, valor, data FROM reserva_historico WHERE reserva_id = ? ORDER BY data DESC LIMIT 12`
  ).bind(r.id).all()

  const depositos = (hist.results as any[]).filter(h => h.tipo === 'deposito')
  const aporteMedioMensal = depositos.length > 0
    ? depositos.reduce((s, h) => s + Number(h.valor), 0) / Math.max(1, depositos.length)
    : 0

  // Projeção de quando atingirá a meta
  let mesesProjetados = null
  if (aporteMedioMensal > 0 && met.faltando > 0) {
    mesesProjetados = Math.ceil(met.faltando / aporteMedioMensal)
  }

  const dataAtingimento = mesesProjetados
    ? (() => {
        const d = new Date()
        d.setMonth(d.getMonth() + mesesProjetados)
        return d.toISOString().split('T')[0]
      })()
    : null

  return c.json({
    reserva: {
      id: r.id, nome: r.nome, banco: r.banco,
      valor_atual: r.valor_atual, objetivo_meses: objetivoMeses,
    },
    meta: {
      valor_ideal: met.valorIdeal,
      faltando: met.faltando,
      cobertura_pct: met.cobertura,
      meses_cobertos: met.mesesCobertos,
      atingida: met.cobertura >= 100,
    },
    projecao: {
      aporte_medio_mensal: Math.round(aporteMedioMensal * 100) / 100,
      meses_para_atingir: mesesProjetados,
      data_estimada_conclusao: dataAtingimento,
      total_depositos: depositos.length,
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/reserva/historico — histórico de depósitos/saques
// ─────────────────────────────────────────────────────────────────────────────
reserva.get('/historico', requireAuth, async (c) => {
  const user = c.get('user')

  // 1) Tentar specialized_reserves
  const reservaEsp = await c.env.DB.prepare(
    `SELECT id FROM specialized_reserves WHERE user_id = ? AND type = 'emergency' AND status != 'cancelled' ORDER BY created_at ASC LIMIT 1`
  ).bind(user.id).first() as any

  if (reservaEsp) {
    const transactions = await c.env.DB.prepare(
      `SELECT * FROM reserve_transactions WHERE reserve_id = ? ORDER BY created_at DESC LIMIT 24`
    ).bind(reservaEsp.id).all()
    return c.json({ historico: transactions.results, reserve_id: reservaEsp.id, fonte: 'specialized' })
  }

  // 2) Tabela reserva_historico (legada)
  const r = await c.env.DB.prepare('SELECT id FROM reserva_emergencia WHERE user_id = ? LIMIT 1').bind(user.id).first() as any
  if (!r) return c.json({ historico: [], reserve_id: null })

  const hist = await c.env.DB.prepare(
    `SELECT * FROM reserva_historico WHERE reserva_id = ? AND user_id = ? ORDER BY data DESC, criado_em DESC LIMIT 36`
  ).bind(r.id, user.id).all()

  return c.json({ historico: hist.results, reserve_id: r.id, fonte: 'legacy' })
})

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/reserva — criar reserva
// ─────────────────────────────────────────────────────────────────────────────
reserva.post('/', requireAuth, async (c) => {
  const user = c.get('user')
  const existing = await c.env.DB.prepare('SELECT id FROM reserva_emergencia WHERE user_id = ?').bind(user.id).first()
  if (existing) return c.json({ error: 'Reserva já existe. Use PUT para atualizar.' }, 400)

  const { nome = 'Reserva de Emergência', objetivo_meses = 6, valor_atual = 0, observacoes, banco = null } = await c.req.json()

  const result = await c.env.DB.prepare(
    `INSERT INTO reserva_emergencia (user_id, nome, objetivo_meses, valor_atual, data_atualizacao, observacoes, banco)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).bind(user.id, nome, parseInt(objetivo_meses), parseFloat(valor_atual),
    new Date().toISOString().split('T')[0], observacoes || null, banco || null).run()

  // Registrar no histórico se valor_atual > 0
  if (parseFloat(valor_atual) > 0) {
    await c.env.DB.prepare(
      `INSERT INTO reserva_historico (reserva_id, user_id, tipo, valor, descricao, saldo_antes, saldo_depois, data)
       VALUES (?, ?, 'deposito', ?, 'Valor inicial', 0, ?, date('now'))`
    ).bind(result.meta.last_row_id, user.id, parseFloat(valor_atual), parseFloat(valor_atual)).run()
  }

  await verificarConquista(c.env.DB, user.id, 'reserva_iniciada')

  return c.json({ success: true, id: result.meta.last_row_id, message: 'Reserva criada!' }, 201)
})

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/reserva/:id — atualizar reserva
// ─────────────────────────────────────────────────────────────────────────────
reserva.put('/:id', requireAuth, async (c) => {
  const user = c.get('user')
  const id   = c.req.param('id')

  const existing = await c.env.DB.prepare('SELECT * FROM reserva_emergencia WHERE id = ? AND user_id = ?').bind(id, user.id).first() as any
  if (!existing) return c.json({ error: 'Reserva não encontrada' }, 404)

  const body = await c.req.json()
  const nome           = body.nome           ?? existing.nome
  const objetivo_meses = body.objetivo_meses !== undefined ? parseInt(body.objetivo_meses) : existing.objetivo_meses
  const valor_atual    = body.valor_atual    !== undefined ? parseFloat(body.valor_atual)  : existing.valor_atual
  const observacoes    = body.observacoes    !== undefined ? (body.observacoes || null)     : existing.observacoes
  const banco          = body.banco          !== undefined ? (body.banco || null)           : existing.banco

  // Registrar ajuste no histórico se o valor mudou
  if (body.valor_atual !== undefined && parseFloat(body.valor_atual) !== existing.valor_atual) {
    const diff = parseFloat(body.valor_atual) - existing.valor_atual
    await c.env.DB.prepare(
      `INSERT INTO reserva_historico (reserva_id, user_id, tipo, valor, descricao, saldo_antes, saldo_depois, data)
       VALUES (?, ?, 'ajuste', ?, 'Ajuste manual', ?, ?, date('now'))`
    ).bind(id, user.id, Math.abs(diff), existing.valor_atual, parseFloat(body.valor_atual)).run()
  }

  await c.env.DB.prepare(
    `UPDATE reserva_emergencia SET nome=?, objetivo_meses=?, valor_atual=?, data_atualizacao=?, observacoes=?, banco=?
     WHERE id=? AND user_id=?`
  ).bind(nome, objetivo_meses, valor_atual, new Date().toISOString().split('T')[0], observacoes, banco, id, user.id).run()

  // Verificar conquistas
  const mediaGastos = await getMediaGastos(c.env.DB, user.id)
  if (mediaGastos > 0) {
    const mesesCobertos = valor_atual / mediaGastos
    if (mesesCobertos >= 1) await verificarConquista(c.env.DB, user.id, 'reserva_1_mes')
    if (mesesCobertos >= 3) await verificarConquista(c.env.DB, user.id, 'reserva_3_meses')
    if (mesesCobertos >= 6) await verificarConquista(c.env.DB, user.id, 'reserva_6_meses')
    if (mesesCobertos >= objetivo_meses) await verificarConquista(c.env.DB, user.id, 'reserva_completa')
  }

  return c.json({ success: true, message: 'Reserva atualizada!' })
})

// ─────────────────────────────────────────────────────────────────────────────
// S-RE2: PATCH /api/reserva/:id/meta-meses — ajustar objetivo de meses
// ─────────────────────────────────────────────────────────────────────────────
reserva.patch('/:id/meta-meses', requireAuth, async (c) => {
  const user = c.get('user')
  const id   = c.req.param('id')
  const body = await c.req.json()

  const meses = parseInt(body.objetivo_meses || body.meses)
  if (isNaN(meses) || meses < 1 || meses > 36)
    return c.json({ error: 'objetivo_meses deve ser entre 1 e 36' }, 400)

  const r = await c.env.DB.prepare('SELECT * FROM reserva_emergencia WHERE id = ? AND user_id = ?').bind(id, user.id).first() as any
  if (!r) return c.json({ error: 'Reserva não encontrada' }, 404)

  await c.env.DB.prepare(
    `UPDATE reserva_emergencia SET objetivo_meses=?, data_atualizacao=? WHERE id=? AND user_id=?`
  ).bind(meses, new Date().toISOString().split('T')[0], id, user.id).run()

  const mediaGastos = await getMediaGastos(c.env.DB, user.id)
  const met = calcMetricas(r.valor_atual, mediaGastos, meses)

  return c.json({
    success: true,
    objetivo_meses: meses,
    novo_valor_ideal: met.valorIdeal,
    cobertura_pct: met.cobertura,
    faltando: met.faltando,
    message: `Meta atualizada para ${meses} meses de cobertura`
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/reserva/:id/depositar
// ─────────────────────────────────────────────────────────────────────────────
reserva.patch('/:id/depositar', requireAuth, async (c) => {
  const user = c.get('user')
  const id   = c.req.param('id')
  const { valor, descricao = 'Depósito', origem = null } = await c.req.json()

  if (!valor || parseFloat(valor) <= 0)
    return c.json({ error: 'Informe um valor positivo' }, 400)

  const existing = await c.env.DB.prepare('SELECT * FROM reserva_emergencia WHERE id = ? AND user_id = ?').bind(id, user.id).first() as any
  if (!existing) return c.json({ error: 'Reserva não encontrada' }, 404)

  const saldoAntes = parseFloat(existing.valor_atual)
  const novoValor  = Math.round((saldoAntes + parseFloat(valor)) * 100) / 100

  await c.env.DB.prepare(
    'UPDATE reserva_emergencia SET valor_atual=?, data_atualizacao=? WHERE id=? AND user_id=?'
  ).bind(novoValor, new Date().toISOString().split('T')[0], id, user.id).run()

  // S-RE1: Registrar no histórico (inclui origem do dinheiro)
  const descComOrigem = origem ? `${descricao} — Origem: ${origem}` : descricao
  await c.env.DB.prepare(
    `INSERT INTO reserva_historico (reserva_id, user_id, tipo, valor, descricao, saldo_antes, saldo_depois, data)
     VALUES (?, ?, 'deposito', ?, ?, ?, ?, date('now'))`
  ).bind(id, user.id, parseFloat(valor), descComOrigem, saldoAntes, novoValor).run()

  // Verificar conquistas
  const mediaGastos = await getMediaGastos(c.env.DB, user.id)
  if (mediaGastos > 0) {
    const meses = novoValor / mediaGastos
    if (meses >= 1) await verificarConquista(c.env.DB, user.id, 'reserva_1_mes')
    if (meses >= 3) await verificarConquista(c.env.DB, user.id, 'reserva_3_meses')
    if (meses >= 6) await verificarConquista(c.env.DB, user.id, 'reserva_6_meses')
    if (meses >= (existing.objetivo_meses || 6)) await verificarConquista(c.env.DB, user.id, 'reserva_completa')
  }

  const objetivoMeses = existing.objetivo_meses || 6
  const met = calcMetricas(novoValor, mediaGastos, objetivoMeses)

  return c.json({
    success: true,
    novo_valor: novoValor,
    cobertura_pct: met.cobertura,
    meses_cobertos: met.mesesCobertos,
    faltando: met.faltando,
    message: `R$ ${parseFloat(valor).toFixed(2)} depositado!`
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/reserva/:id/sacar
// ─────────────────────────────────────────────────────────────────────────────
reserva.patch('/:id/sacar', requireAuth, async (c) => {
  const user = c.get('user')
  const id   = c.req.param('id')
  const { valor, descricao = 'Saque', motivo = null } = await c.req.json()

  if (!valor || parseFloat(valor) <= 0)
    return c.json({ error: 'Informe um valor positivo' }, 400)

  const existing = await c.env.DB.prepare('SELECT * FROM reserva_emergencia WHERE id = ? AND user_id = ?').bind(id, user.id).first() as any
  if (!existing) return c.json({ error: 'Reserva não encontrada' }, 404)

  const saldoAntes = parseFloat(existing.valor_atual)
  const novoValor  = Math.max(0, Math.round((saldoAntes - parseFloat(valor)) * 100) / 100)

  await c.env.DB.prepare(
    'UPDATE reserva_emergencia SET valor_atual=?, data_atualizacao=? WHERE id=? AND user_id=?'
  ).bind(novoValor, new Date().toISOString().split('T')[0], id, user.id).run()

  // S-RE1: Registrar no histórico (inclui motivo do saque)
  const descComMotivo = motivo ? `${descricao} — Motivo: ${motivo}` : descricao
  await c.env.DB.prepare(
    `INSERT INTO reserva_historico (reserva_id, user_id, tipo, valor, descricao, saldo_antes, saldo_depois, data)
     VALUES (?, ?, 'saque', ?, ?, ?, ?, date('now'))`
  ).bind(id, user.id, parseFloat(valor), descComMotivo, saldoAntes, novoValor).run()

  return c.json({
    success: true,
    novo_valor: novoValor,
    message: `R$ ${parseFloat(valor).toFixed(2)} sacado!`
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/reserva/:id
// ─────────────────────────────────────────────────────────────────────────────
reserva.delete('/:id', requireAuth, async (c) => {
  const user = c.get('user')
  const id   = c.req.param('id')
  const r = await c.env.DB.prepare('SELECT id FROM reserva_emergencia WHERE id = ? AND user_id = ?').bind(id, user.id).first()
  if (!r) return c.json({ error: 'Reserva não encontrada' }, 404)
  await c.env.DB.prepare('DELETE FROM reserva_historico WHERE reserva_id = ? AND user_id = ?').bind(id, user.id).run()
  await c.env.DB.prepare('DELETE FROM reserva_emergencia WHERE id = ? AND user_id = ?').bind(id, user.id).run()
  return c.json({ success: true, message: 'Reserva removida!' })
})

export default reserva
