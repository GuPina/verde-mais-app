import { Hono } from 'hono'
import { requireAuth } from './auth'
import { getLimites, MSG_UPGRADE } from './planos'

type Bindings  = { DB: D1Database }
type Variables = { user: { id: number; nome: string; email: string; plano: string } }

const cartoes = new Hono<{ Bindings: Bindings; Variables: Variables }>()

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS DE CÁLCULO BANCÁRIO
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Retorna {month, year} da FATURA onde a compra vai cair.
 * Regra bancária: compra no fechamento ou APÓS → próxima fatura.
 */
function calcBillingPeriod(purchaseDateStr: string, closingDay: number) {
  const d    = new Date(purchaseDateStr + 'T12:00:00')
  let month  = d.getMonth() + 1   // 1-12
  let year   = d.getFullYear()
  if (d.getDate() >= closingDay) { // >= inclui o próprio dia de fechamento
    month++
    if (month > 12) { month = 1; year++ }
  }
  return { month, year }
}

/**
 * Retorna a data de vencimento da fatura (dia_vencimento do cartão,
 * no mês da fatura calculado acima).
 */
function calcDueDate(billingMonth: number, billingYear: number, dueDay: number): string {
  // Cuidado: dueDay pode ser 31 em mês de 30 dias → usar último dia do mês
  const lastDay = new Date(billingYear, billingMonth, 0).getDate()
  const day     = Math.min(dueDay, lastDay)
  return `${billingYear}-${String(billingMonth).padStart(2,'0')}-${String(day).padStart(2,'0')}`
}

/** Gera um UUID v4 simples compatível com Cloudflare Workers */
function uuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/cartoes
// ─────────────────────────────────────────────────────────────────────────────
cartoes.get('/', requireAuth, async (c) => {
  const user   = c.get('user')
  const result = await c.env.DB.prepare(
    'SELECT * FROM cartoes WHERE user_id = ? AND ativo = 1 ORDER BY nome ASC'
  ).bind(user.id).all()

  const cartoesComUso = await Promise.all((result.results as any[]).map(async (cartao) => {
    // Uso = soma das card_charges pendentes (fonte única de verdade)
    const uso = await c.env.DB.prepare(
      `SELECT COALESCE(SUM(valor),0) as total FROM card_charges
       WHERE card_id = ? AND status = 'pendente'`
    ).bind(cartao.id).first() as any

    const limite_utilizado  = Number(uso?.total || 0)
    const limite_disponivel = Math.max(0, cartao.limite_total - limite_utilizado)

    return {
      ...cartao,
      limite_utilizado,
      limite_disponivel,
      percentual_uso: cartao.limite_total > 0
        ? Math.round((limite_utilizado / cartao.limite_total) * 100)
        : 0
    }
  }))

  return c.json({ cartoes: cartoesComUso })
})

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/cartoes
// ─────────────────────────────────────────────────────────────────────────────
cartoes.post('/', requireAuth, async (c) => {
  const user = c.get('user')
  const lim  = getLimites(user.plano)
  if (lim.cartoes !== Infinity) {
    const cnt = await c.env.DB.prepare(
      'SELECT COUNT(*) as n FROM cartoes WHERE user_id = ? AND ativo = 1'
    ).bind(user.id).first() as any
    if ((cnt?.n || 0) >= lim.cartoes)
      return c.json({ error: MSG_UPGRADE.cartoes, upgrade: true, limite: lim.cartoes }, 403)
  }

  const { nome, bandeira, banco, limite_total, dia_vencimento, dia_fechamento, cor, ultimos_digitos } = await c.req.json()
  if (!nome || !bandeira || !banco || !limite_total || !dia_vencimento || !dia_fechamento)
    return c.json({ error: 'Campos obrigatórios: nome, bandeira, banco, limite_total, dia_vencimento, dia_fechamento' }, 400)

  const r = await c.env.DB.prepare(
    `INSERT INTO cartoes (user_id, nome, bandeira, banco, limite_total, limite_disponivel,
     dia_vencimento, dia_fechamento, cor, ultimos_digitos)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(user.id, nome, bandeira, banco,
    parseFloat(limite_total), parseFloat(limite_total),
    parseInt(dia_vencimento), parseInt(dia_fechamento),
    cor || '#2FBF71', ultimos_digitos || null
  ).run()

  await verificarConquista(c.env.DB, user.id, 'carteirinha')
  return c.json({ success: true, id: r.meta.last_row_id, message: 'Cartão cadastrado!' }, 201)
})

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/cartoes/:id
// ─────────────────────────────────────────────────────────────────────────────
cartoes.put('/:id', requireAuth, async (c) => {
  const user = c.get('user')
  const id   = c.req.param('id')
  const ex   = await c.env.DB.prepare('SELECT id FROM cartoes WHERE id = ? AND user_id = ?').bind(id, user.id).first()
  if (!ex) return c.json({ error: 'Cartão não encontrado' }, 404)

  const { nome, bandeira, banco, limite_total, dia_vencimento, dia_fechamento, cor, ultimos_digitos } = await c.req.json()
  await c.env.DB.prepare(
    `UPDATE cartoes SET nome=?, bandeira=?, banco=?, limite_total=?,
     dia_vencimento=?, dia_fechamento=?, cor=?, ultimos_digitos=?
     WHERE id=? AND user_id=?`
  ).bind(nome, bandeira, banco, parseFloat(limite_total),
    parseInt(dia_vencimento), parseInt(dia_fechamento),
    cor, ultimos_digitos || null, id, user.id
  ).run()
  return c.json({ success: true, message: 'Cartão atualizado!' })
})

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/cartoes/:id
// ─────────────────────────────────────────────────────────────────────────────
cartoes.delete('/:id', requireAuth, async (c) => {
  const user = c.get('user')
  const id   = c.req.param('id')
  await c.env.DB.prepare('UPDATE cartoes SET ativo = 0 WHERE id = ? AND user_id = ?').bind(id, user.id).run()
  return c.json({ success: true, message: 'Cartão removido!' })
})

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/cartoes/:id/fatura?mes=3&ano=2026
// Interface bancária real: navega por mês/ano, mostra card_charges
// ─────────────────────────────────────────────────────────────────────────────
cartoes.get('/:id/fatura', requireAuth, async (c) => {
  const user    = c.get('user')
  const cardId  = c.req.param('id')
  const now     = new Date()
  const mes     = parseInt(c.req.query('mes')  || String(now.getMonth() + 1))
  const ano     = parseInt(c.req.query('ano')  || String(now.getFullYear()))

  const cartao = await c.env.DB.prepare(
    'SELECT * FROM cartoes WHERE id = ? AND user_id = ?'
  ).bind(cardId, user.id).first() as any
  if (!cartao) return c.json({ error: 'Cartão não encontrado' }, 404)

  // Lançamentos do mês/ano de fatura
  const charges = await c.env.DB.prepare(
    `SELECT cc.*, d.categoria, d.observacoes as obs_despesa
     FROM card_charges cc
     LEFT JOIN despesas d ON d.id = cc.expense_id
     WHERE cc.card_id = ? AND cc.billing_month = ? AND cc.billing_year = ?
     ORDER BY cc.data_compra DESC, cc.parcela_atual ASC`
  ).bind(cardId, mes, ano).all()

  const lista = charges.results as any[]
  const totalFatura   = lista.reduce((s, r) => s + Number(r.valor), 0)
  const totalPago     = lista.filter(r => r.status === 'pago').reduce((s, r) => s + Number(r.valor), 0)
  const totalPendente = totalFatura - totalPago

  // Limite dinâmico (calculado em real-time)
  const usoGlobal = await c.env.DB.prepare(
    `SELECT COALESCE(SUM(valor),0) as total FROM card_charges
     WHERE card_id = ? AND status = 'pendente'`
  ).bind(cardId).first() as any
  const limite_utilizado  = Number(usoGlobal?.total || 0)
  const limite_disponivel = Math.max(0, cartao.limite_total - limite_utilizado)

  // Data de vencimento desta fatura
  const data_vencimento = calcDueDate(mes, ano, cartao.dia_vencimento)

  // Status da fatura: futura / aberta / fechada / paga
  const hoje      = new Date()
  const dataFech  = new Date(`${ano}-${String(mes).padStart(2,'0')}-${String(cartao.dia_fechamento).padStart(2,'0')}`)
  const statusFatura =
    ano > hoje.getFullYear() || (ano === hoje.getFullYear() && mes > hoje.getMonth() + 1) ? 'futura' :
    totalPendente === 0 && lista.length > 0 ? 'paga' :
    hoje > dataFech ? 'fechada' : 'aberta'

  return c.json({
    cartao: {
      ...cartao,
      limite_utilizado,
      limite_disponivel
    },
    fatura: {
      mes, ano,
      data_vencimento,
      total: Math.round(totalFatura * 100) / 100,
      total_pago: Math.round(totalPago * 100) / 100,
      total_pendente: Math.round(totalPendente * 100) / 100,
      status: statusFatura,
      qtd_lancamentos: lista.length
    },
    lancamentos: lista
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/cartoes/:id/compra
// Lança uma compra nova (à vista ou parcelada) com lógica de fechamento correta
// ─────────────────────────────────────────────────────────────────────────────
cartoes.post('/:id/compra', requireAuth, async (c) => {
  const user   = c.get('user')
  const cardId = c.req.param('id')

  const cartao = await c.env.DB.prepare(
    'SELECT * FROM cartoes WHERE id = ? AND user_id = ?'
  ).bind(cardId, user.id).first() as any
  if (!cartao) return c.json({ error: 'Cartão não encontrado' }, 404)

  const { descricao, categoria, valor_total, numero_parcelas = 1,
          data_compra, observacoes, meio_pagamento = 'cartao_credito' } = await c.req.json()

  if (!descricao || !categoria || !valor_total || !data_compra)
    return c.json({ error: 'Campos obrigatórios: descricao, categoria, valor_total, data_compra' }, 400)

  const nparcelas    = Math.max(1, parseInt(numero_parcelas))
  const valorParcela = Math.round((parseFloat(valor_total) / nparcelas) * 100) / 100
  const groupId      = uuid()
  const chargeIds: number[] = []
  const despesaIds:  number[] = []

  for (let i = 1; i <= nparcelas; i++) {
    // Data da compra desta parcela: mês i-1 após a data original
    const parcelaDate = new Date(data_compra + 'T12:00:00')
    parcelaDate.setMonth(parcelaDate.getMonth() + (i - 1))
    const parcelaDateStr = parcelaDate.toISOString().split('T')[0]

    // Período de faturamento calculado pelo fechamento do cartão
    const { month: bMonth, year: bYear } = calcBillingPeriod(parcelaDateStr, cartao.dia_fechamento)
    const dataVenc = calcDueDate(bMonth, bYear, cartao.dia_vencimento)
    const descParcela = nparcelas > 1 ? `${descricao} (${i}/${nparcelas})` : descricao

    // 1. Criar despesa
    const dr = await c.env.DB.prepare(
      `INSERT INTO despesas (user_id, descricao, data, categoria, valor, parcelado,
       numero_parcelas, parcela_atual, status, fixa_ou_variavel, vencimento,
       observacoes, cartao_id, meio_pagamento, billing_month, billing_year, purchase_group_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pendente', 'variavel', ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      user.id, descParcela, parcelaDateStr, categoria,
      valorParcela, nparcelas > 1 ? 1 : 0, nparcelas, i,
      dataVenc, observacoes || null, parseInt(cardId), meio_pagamento,
      bMonth, bYear, groupId
    ).run()
    despesaIds.push(dr.meta.last_row_id as number)

    // 2. Criar card_charge vinculado
    const cr = await c.env.DB.prepare(
      `INSERT INTO card_charges (card_id, expense_id, descricao, valor, data_compra,
       data_vencimento, billing_month, billing_year, parcela_atual, total_parcelas,
       purchase_group_id, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pendente')`
    ).bind(
      parseInt(cardId), dr.meta.last_row_id, descParcela, valorParcela,
      parcelaDateStr, dataVenc, bMonth, bYear,
      nparcelas > 1 ? i : null, nparcelas > 1 ? nparcelas : null, groupId
    ).run()
    chargeIds.push(cr.meta.last_row_id as number)
  }

  // Atualizar limite_disponivel (campo legacy — mantemos sincronizado)
  await c.env.DB.prepare(
    'UPDATE cartoes SET limite_disponivel = MAX(0, limite_disponivel - ?) WHERE id = ? AND user_id = ?'
  ).bind(parseFloat(valor_total), parseInt(cardId), user.id).run()

  return c.json({
    success: true,
    purchase_group_id: groupId,
    despesa_ids: despesaIds,
    charge_ids: chargeIds,
    parcelas: nparcelas,
    message: nparcelas > 1 ? `${nparcelas} parcelas lançadas na fatura correta!` : 'Compra lançada na fatura!'
  }, 201)
})

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/cartoes/:id/compra-retroativa
// Cadastra compra já em andamento (ex: 10x feita em Jan, estamos em Mar → 8 restantes)
// ─────────────────────────────────────────────────────────────────────────────
cartoes.post('/:id/compra-retroativa', requireAuth, async (c) => {
  const user   = c.get('user')
  const cardId = c.req.param('id')

  const cartao = await c.env.DB.prepare(
    'SELECT * FROM cartoes WHERE id = ? AND user_id = ?'
  ).bind(cardId, user.id).first() as any
  if (!cartao) return c.json({ error: 'Cartão não encontrado' }, 404)

  const { descricao, categoria, valor_total, numero_parcelas,
          parcelas_pagas = 0, data_compra, observacoes } = await c.req.json()

  if (!descricao || !categoria || !valor_total || !numero_parcelas || !data_compra)
    return c.json({ error: 'Campos obrigatórios: descricao, categoria, valor_total, numero_parcelas, data_compra' }, 400)

  const nparcelas      = parseInt(numero_parcelas)
  const jaPagas        = parseInt(parcelas_pagas)
  const parcelasRest   = nparcelas - jaPagas

  if (parcelasRest <= 0)
    return c.json({ error: 'Todas as parcelas já foram pagas' }, 400)

  const valorParcela = Math.round((parseFloat(valor_total) / nparcelas) * 100) / 100
  const groupId      = uuid()
  const chargeIds: number[] = []
  const despesaIds:  number[] = []

  // Gerar TODAS as parcelas:
  // - Parcelas passadas (já pagas): status='pago', sem afetar limite
  // - Parcelas restantes: status='pendente', afetam limite
  for (let i = 1; i <= nparcelas; i++) {
    const parcelaDate = new Date(data_compra + 'T12:00:00')
    parcelaDate.setMonth(parcelaDate.getMonth() + (i - 1))
    const parcelaDateStr = parcelaDate.toISOString().split('T')[0]

    const { month: bMonth, year: bYear } = calcBillingPeriod(parcelaDateStr, cartao.dia_fechamento)
    const dataVenc    = calcDueDate(bMonth, bYear, cartao.dia_vencimento)
    const isPaid      = i <= jaPagas
    const statusParcela = isPaid ? 'pago' : 'pendente'
    const descParcela = `${descricao} (${i}/${nparcelas})`

    const dr = await c.env.DB.prepare(
      `INSERT INTO despesas (user_id, descricao, data, categoria, valor, parcelado,
       numero_parcelas, parcela_atual, status, fixa_ou_variavel, vencimento,
       observacoes, cartao_id, meio_pagamento, billing_month, billing_year, purchase_group_id)
       VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, 'variavel', ?, ?, ?, 'cartao_credito', ?, ?, ?)`
    ).bind(
      user.id, descParcela, parcelaDateStr, categoria,
      valorParcela, nparcelas, i, statusParcela,
      dataVenc,
      observacoes ? `[Retroativo] ${observacoes}` : '[Retroativo]',
      parseInt(cardId), bMonth, bYear, groupId
    ).run()
    despesaIds.push(dr.meta.last_row_id as number)

    const cr = await c.env.DB.prepare(
      `INSERT INTO card_charges (card_id, expense_id, descricao, valor, data_compra,
       data_vencimento, billing_month, billing_year, parcela_atual, total_parcelas,
       purchase_group_id, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      parseInt(cardId), dr.meta.last_row_id, descParcela, valorParcela,
      parcelaDateStr, dataVenc, bMonth, bYear, i, nparcelas, groupId, statusParcela
    ).run()
    chargeIds.push(cr.meta.last_row_id as number)
  }

  // Descontar do limite apenas as parcelas pendentes
  const valorPendente = valorParcela * parcelasRest
  await c.env.DB.prepare(
    'UPDATE cartoes SET limite_disponivel = MAX(0, limite_disponivel - ?) WHERE id = ? AND user_id = ?'
  ).bind(valorPendente, parseInt(cardId), user.id).run()

  return c.json({
    success: true,
    purchase_group_id: groupId,
    despesa_ids:   despesaIds,
    charge_ids:    chargeIds,
    parcelas_total:     nparcelas,
    parcelas_pagas:     jaPagas,
    parcelas_pendentes: parcelasRest,
    valor_pendente:     valorPendente,
    message: `Compra retroativa registrada! ${jaPagas} já pagas + ${parcelasRest} pendentes distribuídas nas faturas corretas.`
  }, 201)
})

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/cartoes/charges/:id/pagar — Baixa unificada (atualiza despesa E charge)
// ─────────────────────────────────────────────────────────────────────────────
cartoes.patch('/charges/:id/pagar', requireAuth, async (c) => {
  const user     = c.get('user')
  const chargeId = c.req.param('id')

  // Buscar charge validando propriedade via JOIN com cartoes
  const charge = await c.env.DB.prepare(
    `SELECT cc.* FROM card_charges cc
     INNER JOIN cartoes ca ON ca.id = cc.card_id AND ca.user_id = ?
     WHERE cc.id = ?`
  ).bind(user.id, chargeId).first() as any
  if (!charge)  return c.json({ error: 'Lançamento não encontrado' }, 404)
  if (charge.status === 'pago') return c.json({ error: 'Lançamento já pago' }, 400)

  // 1. Marcar charge como pago
  await c.env.DB.prepare(
    "UPDATE card_charges SET status = 'pago' WHERE id = ?"
  ).bind(chargeId).run()

  // 2. Marcar despesa vinculada como paga (se existir)
  if (charge.expense_id) {
    await c.env.DB.prepare(
      "UPDATE despesas SET status = 'pago' WHERE id = ? AND user_id = ?"
    ).bind(charge.expense_id, user.id).run()
  }

  // 3. Restaurar limite do cartão
  await c.env.DB.prepare(
    'UPDATE cartoes SET limite_disponivel = MIN(limite_total, limite_disponivel + ?) WHERE id = ? AND user_id = ?'
  ).bind(Number(charge.valor), charge.card_id, user.id).run()

  await verificarConquista(c.env.DB, user.id, 'cartao_zero')
  return c.json({ success: true, message: 'Parcela paga! Limite restaurado.' })
})

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/cartoes/:id/pagar-fatura — Paga TODA a fatura de um mês
// ─────────────────────────────────────────────────────────────────────────────
cartoes.patch('/:id/pagar-fatura', requireAuth, async (c) => {
  const user   = c.get('user')
  const cardId = c.req.param('id')
  const { mes, ano } = await c.req.json()
  if (!mes || !ano) return c.json({ error: 'Informe mes e ano' }, 400)

  const cartao = await c.env.DB.prepare(
    'SELECT * FROM cartoes WHERE id = ? AND user_id = ?'
  ).bind(cardId, user.id).first() as any
  if (!cartao) return c.json({ error: 'Cartão não encontrado' }, 404)

  // Buscar todos os charges pendentes da fatura
  const pendentes = await c.env.DB.prepare(
    `SELECT cc.* FROM card_charges cc WHERE cc.card_id = ? AND cc.billing_month = ?
     AND cc.billing_year = ? AND cc.status = 'pendente'`
  ).bind(cardId, mes, ano).all()

  if ((pendentes.results as any[]).length === 0)
    return c.json({ error: 'Nenhuma parcela pendente nesta fatura' }, 400)

  const totalPago = (pendentes.results as any[]).reduce((s, r) => s + Number(r.valor), 0)

  // Atualizar todos de uma vez
  for (const ch of pendentes.results as any[]) {
    await c.env.DB.prepare("UPDATE card_charges SET status = 'pago' WHERE id = ?").bind(ch.id).run()
    if (ch.expense_id) {
      await c.env.DB.prepare("UPDATE despesas SET status = 'pago' WHERE id = ?").bind(ch.expense_id).run()
    }
  }

  // Restaurar limite
  await c.env.DB.prepare(
    'UPDATE cartoes SET limite_disponivel = MIN(limite_total, limite_disponivel + ?) WHERE id = ? AND user_id = ?'
  ).bind(totalPago, cardId, user.id).run()

  await verificarConquista(c.env.DB, user.id, 'fatura_paga')
  return c.json({
    success: true,
    parcelas_pagas: (pendentes.results as any[]).length,
    total_pago: Math.round(totalPago * 100) / 100,
    message: `Fatura paga! ${(pendentes.results as any[]).length} lançamento(s) quitado(s).`
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/cartoes/:id/compras — lista compras agrupadas por purchase_group_id
// ─────────────────────────────────────────────────────────────────────────────
cartoes.get('/:id/compras', requireAuth, async (c) => {
  const user   = c.get('user')
  const cardId = c.req.param('id')

  const cartao = await c.env.DB.prepare('SELECT id FROM cartoes WHERE id = ? AND user_id = ?').bind(cardId, user.id).first()
  if (!cartao) return c.json({ error: 'Cartão não encontrado' }, 404)

  const charges = await c.env.DB.prepare(
    `SELECT * FROM card_charges WHERE card_id = ?
     ORDER BY data_compra DESC, parcela_atual ASC`
  ).bind(cardId).all()

  // Agrupar por purchase_group_id (ou por descricao se não tiver grupo)
  const grupos: Record<string, any> = {}
  for (const ch of charges.results as any[]) {
    const key = ch.purchase_group_id || `solo_${ch.id}`
    if (!grupos[key]) {
      const descBase = (ch.descricao || '').replace(/\s*\(\d+\/\d+\)$/, '')
      grupos[key] = {
        purchase_group_id: ch.purchase_group_id,
        descricao: descBase,
        valor_parcela: Number(ch.valor),
        total_parcelas: ch.total_parcelas || 1,
        data_compra: ch.data_compra,
        parcelas: [], pagas: 0, pendentes: 0
      }
    }
    grupos[key].parcelas.push(ch)
    if (ch.status === 'pago') grupos[key].pagas++
    else grupos[key].pendentes++
  }

  const compras = Object.values(grupos).map((g: any) => ({
    ...g,
    valor_total_compra: Math.round(g.valor_parcela * g.total_parcelas * 100) / 100
  })).sort((a: any, b: any) =>
    new Date(b.data_compra).getTime() - new Date(a.data_compra).getTime()
  )

  return c.json({ compras })
})

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/cartoes/compras/:groupId — remove grupo de parcelas
// ─────────────────────────────────────────────────────────────────────────────
cartoes.delete('/compras/:groupId', requireAuth, async (c) => {
  const user    = c.get('user')
  const groupId = c.req.param('groupId')

  // Confirmar que pelo menos um charge pertence ao usuário
  const chk = await c.env.DB.prepare(
    `SELECT cc.* FROM card_charges cc
     INNER JOIN cartoes ca ON ca.id = cc.card_id AND ca.user_id = ?
     WHERE cc.purchase_group_id = ? LIMIT 1`
  ).bind(user.id, groupId).first() as any
  if (!chk) return c.json({ error: 'Compra não encontrada' }, 404)

  // Valor pendente para restaurar limite
  const pendValue = await c.env.DB.prepare(
    `SELECT COALESCE(SUM(cc.valor),0) as total FROM card_charges cc
     WHERE cc.purchase_group_id = ? AND cc.status = 'pendente'`
  ).bind(groupId).first() as any

  // Apagar charges (despesas ficam via ON DELETE SET NULL em expense_id)
  await c.env.DB.prepare(
    'DELETE FROM card_charges WHERE purchase_group_id = ?'
  ).bind(groupId).run()

  // Apagar despesas do grupo
  await c.env.DB.prepare(
    'DELETE FROM despesas WHERE purchase_group_id = ? AND user_id = ?'
  ).bind(groupId, user.id).run()

  // Restaurar limite
  if (Number(pendValue?.total) > 0) {
    await c.env.DB.prepare(
      'UPDATE cartoes SET limite_disponivel = MIN(limite_total, limite_disponivel + ?) WHERE id = ? AND user_id = ?'
    ).bind(Number(pendValue.total), chk.card_id, user.id).run()
  }

  return c.json({ success: true, message: 'Compra e parcelas removidas!' })
})

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/cartoes/fatura-resumo — dashboard: todas faturas do mês corrente
// ─────────────────────────────────────────────────────────────────────────────
cartoes.get('/fatura-resumo', requireAuth, async (c) => {
  const user = c.get('user')
  const now  = new Date()
  const mes  = now.getMonth() + 1
  const ano  = now.getFullYear()

  const lista = await c.env.DB.prepare(
    'SELECT * FROM cartoes WHERE user_id = ? AND ativo = 1'
  ).bind(user.id).all()
  const resumo = []

  for (const cartao of lista.results as any[]) {
    const fat = await c.env.DB.prepare(
      `SELECT COALESCE(SUM(valor),0) as total,
              COALESCE(SUM(CASE WHEN status='pendente' THEN valor ELSE 0 END),0) as pendente
       FROM card_charges WHERE card_id = ? AND billing_month = ? AND billing_year = ?`
    ).bind(cartao.id, mes, ano).first() as any

    const usoG = await c.env.DB.prepare(
      `SELECT COALESCE(SUM(valor),0) as total FROM card_charges
       WHERE card_id = ? AND status = 'pendente'`
    ).bind(cartao.id).first() as any

    const limite_utilizado  = Number(usoG?.total || 0)
    const limite_disponivel = Math.max(0, cartao.limite_total - limite_utilizado)

    resumo.push({
      ...cartao,
      fatura_atual: Number(fat?.total || 0),
      fatura_pendente: Number(fat?.pendente || 0),
      limite_utilizado,
      limite_disponivel
    })
  }
  return c.json({ resumo })
})

// ─────────────────────────────────────────────────────────────────────────────
// Endpoints legacy (mantidos para compatibilidade com frontend antigo)
// ─────────────────────────────────────────────────────────────────────────────

// GET /api/cartoes/:id/lancamentos (mapeia para fatura)
cartoes.get('/:id/lancamentos', requireAuth, async (c) => {
  const user   = c.get('user')
  const id     = c.req.param('id')
  const now    = new Date()
  const mes    = parseInt(c.req.query('mes')  || String(now.getMonth() + 1))
  const ano    = parseInt(c.req.query('ano')  || String(now.getFullYear()))

  // Verificar posse do cartão antes de retornar dados (segurança)
  const cartao = await c.env.DB.prepare(
    'SELECT id FROM cartoes WHERE id = ? AND user_id = ? AND ativo = 1'
  ).bind(id, user.id).first()
  if (!cartao) return c.json({ lancamentos: [], total_fatura: 0 })

  const charges = await c.env.DB.prepare(
    `SELECT cc.*, d.categoria, d.observacoes as obs_despesa
     FROM card_charges cc
     LEFT JOIN despesas d ON d.id = cc.expense_id
     WHERE cc.card_id = ? AND cc.billing_month = ? AND cc.billing_year = ?
     ORDER BY cc.data_compra DESC`
  ).bind(id, mes, ano).all()

  const total = (charges.results as any[]).reduce((s, r) => s + Number(r.valor), 0)
  return c.json({ lancamentos: charges.results, total_fatura: total })
})

// POST /api/cartoes/:id/lancamentos (redireciona para /compra)
cartoes.post('/:id/lancamentos', requireAuth, async (c) => {
  const user   = c.get('user')
  const cardId = c.req.param('id')

  const cartao = await c.env.DB.prepare(
    'SELECT * FROM cartoes WHERE id = ? AND user_id = ?'
  ).bind(cardId, user.id).first() as any
  if (!cartao) return c.json({ error: 'Cartão não encontrado' }, 404)

  const { descricao, categoria, valor_total, numero_parcelas = 1, data_compra, observacoes } = await c.req.json()
  if (!descricao || !categoria || !valor_total || !data_compra)
    return c.json({ error: 'Campos obrigatórios faltando' }, 400)

  const nparcelas    = parseInt(numero_parcelas)
  const valorParcela = Math.round((parseFloat(valor_total) / nparcelas) * 100) / 100
  const groupId      = uuid()
  const ids: number[] = []

  for (let i = 1; i <= nparcelas; i++) {
    const parcelaDate = new Date(data_compra + 'T12:00:00')
    parcelaDate.setMonth(parcelaDate.getMonth() + (i - 1))
    const parcelaDateStr = parcelaDate.toISOString().split('T')[0]
    const { month: bMonth, year: bYear } = calcBillingPeriod(parcelaDateStr, cartao.dia_fechamento)
    const dataVenc = calcDueDate(bMonth, bYear, cartao.dia_vencimento)
    const desc     = nparcelas > 1 ? `${descricao} (${i}/${nparcelas})` : descricao

    const dr = await c.env.DB.prepare(
      `INSERT INTO despesas (user_id, descricao, data, categoria, valor, parcelado,
       numero_parcelas, parcela_atual, status, fixa_ou_variavel, vencimento,
       observacoes, cartao_id, meio_pagamento, billing_month, billing_year, purchase_group_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pendente', 'variavel', ?, ?, ?, 'cartao_credito', ?, ?, ?)`
    ).bind(user.id, desc, parcelaDateStr, categoria, valorParcela,
      nparcelas > 1 ? 1 : 0, nparcelas, i, dataVenc, observacoes || null,
      parseInt(cardId), bMonth, bYear, groupId).run()

    await c.env.DB.prepare(
      `INSERT INTO card_charges (card_id, expense_id, descricao, valor, data_compra,
       data_vencimento, billing_month, billing_year, parcela_atual, total_parcelas,
       purchase_group_id, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pendente')`
    ).bind(parseInt(cardId), dr.meta.last_row_id, desc, valorParcela,
      parcelaDateStr, dataVenc, bMonth, bYear,
      nparcelas > 1 ? i : null, nparcelas > 1 ? nparcelas : null, groupId).run()

    ids.push(dr.meta.last_row_id as number)
  }

  await c.env.DB.prepare(
    'UPDATE cartoes SET limite_disponivel = MAX(0, limite_disponivel - ?) WHERE id = ? AND user_id = ?'
  ).bind(parseFloat(valor_total), parseInt(cardId), user.id).run()

  return c.json({ success: true, ids, parcelas: nparcelas,
    message: nparcelas > 1 ? `${nparcelas} parcelas lançadas!` : 'Compra lançada!' }, 201)
})

// POST /api/cartoes/:id/lancamentos-retroativos (legacy)
cartoes.post('/:id/lancamentos-retroativos', requireAuth, async (c) => {
  // Redireciona para o novo endpoint
  c.req.param  // manter compatibilidade
  const user   = c.get('user')
  const cardId = c.req.param('id')
  const body   = await c.req.json()
  const { descricao, categoria, valor_total, numero_parcelas, parcelas_pagas = 0, data_compra, observacoes } = body

  const cartao = await c.env.DB.prepare('SELECT * FROM cartoes WHERE id = ? AND user_id = ?').bind(cardId, user.id).first() as any
  if (!cartao) return c.json({ error: 'Cartão não encontrado' }, 404)

  const nparcelas    = parseInt(numero_parcelas)
  const jaPagas      = parseInt(parcelas_pagas)
  const parcelasRest = nparcelas - jaPagas
  if (parcelasRest <= 0) return c.json({ error: 'Todas as parcelas já foram pagas' }, 400)

  const valorParcela = Math.round((parseFloat(valor_total) / nparcelas) * 100) / 100
  const groupId      = uuid()
  const ids: number[] = []

  for (let i = 1; i <= nparcelas; i++) {
    const parcelaDate = new Date(data_compra + 'T12:00:00')
    parcelaDate.setMonth(parcelaDate.getMonth() + (i - 1))
    const parcelaDateStr = parcelaDate.toISOString().split('T')[0]
    const { month: bMonth, year: bYear } = calcBillingPeriod(parcelaDateStr, cartao.dia_fechamento)
    const dataVenc   = calcDueDate(bMonth, bYear, cartao.dia_vencimento)
    const isPaid     = i <= jaPagas
    const desc       = `${descricao} (${i}/${nparcelas})`

    const dr = await c.env.DB.prepare(
      `INSERT INTO despesas (user_id, descricao, data, categoria, valor, parcelado,
       numero_parcelas, parcela_atual, status, fixa_ou_variavel, vencimento,
       observacoes, cartao_id, meio_pagamento, billing_month, billing_year, purchase_group_id)
       VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, 'variavel', ?, ?, ?, 'cartao_credito', ?, ?, ?)`
    ).bind(user.id, desc, parcelaDateStr, categoria, valorParcela, nparcelas, i,
      isPaid ? 'pago' : 'pendente', dataVenc,
      observacoes ? `[Retroativo] ${observacoes}` : '[Retroativo]',
      parseInt(cardId), bMonth, bYear, groupId).run()

    await c.env.DB.prepare(
      `INSERT INTO card_charges (card_id, expense_id, descricao, valor, data_compra,
       data_vencimento, billing_month, billing_year, parcela_atual, total_parcelas,
       purchase_group_id, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(parseInt(cardId), dr.meta.last_row_id, desc, valorParcela,
      parcelaDateStr, dataVenc, bMonth, bYear, i, nparcelas, groupId,
      isPaid ? 'pago' : 'pendente').run()

    ids.push(dr.meta.last_row_id as number)
  }

  const valorPendente = valorParcela * parcelasRest
  await c.env.DB.prepare(
    'UPDATE cartoes SET limite_disponivel = MAX(0, limite_disponivel - ?) WHERE id = ? AND user_id = ?'
  ).bind(valorPendente, parseInt(cardId), user.id).run()

  return c.json({
    success: true, ids, parcelas_restantes: parcelasRest,
    valor_total_restante: valorPendente,
    message: `${parcelasRest} parcela(s) pendentes registradas! (${jaPagas}/${nparcelas} já pagas)`
  }, 201)
})

// PATCH /api/cartoes/lancamentos/:id/status (legacy → sincroniza charge E despesa)
cartoes.patch('/lancamentos/:id/status', requireAuth, async (c) => {
  const user   = c.get('user')
  const id     = c.req.param('id')
  const { status } = await c.req.json()

  // Tentar pelo charge_id primeiro
  const charge = await c.env.DB.prepare(
    `SELECT cc.* FROM card_charges cc
     INNER JOIN cartoes ca ON ca.id = cc.card_id AND ca.user_id = ?
     WHERE cc.id = ?`
  ).bind(user.id, id).first() as any

  if (charge) {
    await c.env.DB.prepare("UPDATE card_charges SET status = ? WHERE id = ?").bind(status, id).run()
    if (charge.expense_id) {
      await c.env.DB.prepare("UPDATE despesas SET status = ? WHERE id = ?").bind(status, charge.expense_id).run()
    }
    if (status === 'pago') {
      await c.env.DB.prepare(
        'UPDATE cartoes SET limite_disponivel = MIN(limite_total, limite_disponivel + ?) WHERE id = ? AND user_id = ?'
      ).bind(Number(charge.valor), charge.card_id, user.id).run()
      await verificarConquista(c.env.DB, user.id, 'cartao_zero')
    }
    return c.json({ success: true })
  }
  return c.json({ error: 'Lançamento não encontrado' }, 404)
})

// DELETE /api/cartoes/lancamentos/:id (legacy)
cartoes.delete('/lancamentos/:id', requireAuth, async (c) => {
  const user = c.get('user')
  const id   = c.req.param('id')

  const charge = await c.env.DB.prepare(
    `SELECT cc.* FROM card_charges cc
     INNER JOIN cartoes ca ON ca.id = cc.card_id AND ca.user_id = ?
     WHERE cc.id = ?`
  ).bind(user.id, id).first() as any

  if (charge) {
    if (charge.status === 'pendente') {
      await c.env.DB.prepare(
        'UPDATE cartoes SET limite_disponivel = MIN(limite_total, limite_disponivel + ?) WHERE id = ? AND user_id = ?'
      ).bind(Number(charge.valor), charge.card_id, user.id).run()
    }
    await c.env.DB.prepare('DELETE FROM card_charges WHERE id = ?').bind(id).run()
    if (charge.expense_id) {
      await c.env.DB.prepare('DELETE FROM despesas WHERE id = ? AND user_id = ?').bind(charge.expense_id, user.id).run()
    }
    return c.json({ success: true, message: 'Lançamento removido!' })
  }
  return c.json({ error: 'Lançamento não encontrado' }, 404)
})

// ─────────────────────────────────────────────────────────────────────────────
async function verificarConquista(db: D1Database, userId: number, codigo: string) {
  try {
    await db.prepare(
      'INSERT OR IGNORE INTO conquistas_usuario (user_id, conquista_codigo, visualizado) VALUES (?, ?, 0)'
    ).bind(userId, codigo).run()
  } catch { /* ignora */ }
}

// ─── POST /api/cartoes/sincronizar-despesas ── sincroniza despesas existentes ─
// Garante que despesas de cartão criadas antes da v2 tenham card_charges
cartoes.post('/sincronizar-despesas', requireAuth, async (c) => {
  const user = c.get('user')

  // Buscar despesas de cartão que NÃO têm card_charge associado
  const orfas = await c.env.DB.prepare(`
    SELECT d.* FROM despesas d
    LEFT JOIN card_charges cc ON cc.expense_id = d.id
    WHERE d.user_id = ? 
      AND d.cartao_id IS NOT NULL
      AND d.meio_pagamento IN ('cartao_credito','parcelado_cartao')
      AND cc.id IS NULL
      AND d.status != 'cancelado'
    LIMIT 200
  `).bind(user.id).all()

  let sincronizadas = 0
  for (const d of (orfas.results as any[])) {
    try {
      // Buscar cartão para calcular billing
      const cartao = await c.env.DB.prepare(
        'SELECT * FROM cartoes WHERE id = ?'
      ).bind(d.cartao_id).first() as any
      if (!cartao) continue

      // Calcular billing se não tiver
      let bMonth = d.billing_month
      let bYear  = d.billing_year
      if (!bMonth || !bYear) {
        const { month, year } = calcBillingPeriod(d.data, cartao.dia_fechamento)
        bMonth = month; bYear = year
        // Atualizar despesa com billing_month/year
        await c.env.DB.prepare(
          'UPDATE despesas SET billing_month=?, billing_year=? WHERE id=?'
        ).bind(bMonth, bYear, d.id).run()
      }

      const dataVenc = calcDueDate(bMonth, bYear, cartao.dia_vencimento)
      const groupId  = d.purchase_group_id || null

      await c.env.DB.prepare(`
        INSERT OR IGNORE INTO card_charges
          (card_id, expense_id, descricao, valor, data_compra, data_vencimento,
           billing_month, billing_year, parcela_atual, total_parcelas,
           purchase_group_id, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        d.cartao_id, d.id, d.descricao, d.valor,
        d.data, dataVenc, bMonth, bYear,
        d.parcela_atual || null, d.numero_parcelas > 1 ? d.numero_parcelas : null,
        groupId,
        d.status === 'pago' ? 'pago' : 'pendente'
      ).run()

      sincronizadas++
    } catch(err) { /* continua */ }
  }

  return c.json({ success: true, sincronizadas, total_orfas: orfas.results.length })
})

// ─── GET /api/cartoes/:id/info ── info rápida do cartão (billing period) ──────
cartoes.get('/:id/info', requireAuth, async (c) => {
  const user = c.get('user')
  const cartaoId = c.req.param('id')
  const dataCompra = c.req.query('data') || new Date().toISOString().split('T')[0]

  const cartao = await c.env.DB.prepare(
    'SELECT * FROM cartoes WHERE id = ? AND user_id = ?'
  ).bind(parseInt(cartaoId), user.id).first() as any
  if (!cartao) return c.json({ error: 'Cartão não encontrado' }, 404)

  const { month: bMonth, year: bYear } = calcBillingPeriod(dataCompra, cartao.dia_fechamento)
  const dataVenc = calcDueDate(bMonth, bYear, cartao.dia_vencimento)

  return c.json({
    cartao_id: cartao.id,
    nome: cartao.nome,
    dia_fechamento: cartao.dia_fechamento,
    dia_vencimento: cartao.dia_vencimento,
    billing_month: bMonth,
    billing_year: bYear,
    data_vencimento: dataVenc,
    limite_disponivel: cartao.limite_disponivel,
    limite_total: cartao.limite_total,
  })
})

export default cartoes
