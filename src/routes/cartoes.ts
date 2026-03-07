import { Hono } from 'hono'
import { requireAuth } from './auth'

type Bindings = { DB: D1Database }
type Variables = { user: { id: number; nome: string; email: string; plano: string } }

const cartoes = new Hono<{ Bindings: Bindings; Variables: Variables }>()

// GET /api/cartoes
cartoes.get('/', requireAuth, async (c) => {
  const user = c.get('user')
  const result = await c.env.DB.prepare(
    'SELECT * FROM cartoes WHERE user_id = ? AND ativo = 1 ORDER BY nome ASC'
  ).bind(user.id).all()

  // Para cada cartão, calcular o valor utilizado atual (despesas no cartão com status pendente/parcelas abertas)
  const now = new Date()
  const mes = String(now.getMonth() + 1).padStart(2, '0')
  const ano = String(now.getFullYear())

  const cartoesComUso = await Promise.all((result.results as any[]).map(async (cartao) => {
    // Total de despesas vinculadas ao cartão que ainda não foram pagas (representa uso do limite)
    const uso = await c.env.DB.prepare(
      `SELECT COALESCE(SUM(valor), 0) as total FROM despesas 
       WHERE user_id = ? AND cartao_id = ? AND meio_pagamento IN ('cartao_credito','parcelado_cartao') AND status = 'pendente'`
    ).bind(user.id, cartao.id).first() as any

    const limite_utilizado = uso?.total || 0
    const limite_disponivel = Math.max(0, cartao.limite_total - limite_utilizado)

    return {
      ...cartao,
      limite_utilizado,
      limite_disponivel,
      percentual_uso: cartao.limite_total > 0 ? Math.round((limite_utilizado / cartao.limite_total) * 100) : 0
    }
  }))

  return c.json({ cartoes: cartoesComUso })
})

// POST /api/cartoes
cartoes.post('/', requireAuth, async (c) => {
  const user = c.get('user')
  const body = await c.req.json()
  const { nome, bandeira, banco, limite_total, dia_vencimento, dia_fechamento, cor, ultimos_digitos } = body
  if (!nome || !bandeira || !banco || !limite_total || !dia_vencimento || !dia_fechamento)
    return c.json({ error: 'Campos obrigatórios: nome, bandeira, banco, limite_total, dia_vencimento, dia_fechamento' }, 400)

  const result = await c.env.DB.prepare(
    'INSERT INTO cartoes (user_id, nome, bandeira, banco, limite_total, limite_disponivel, dia_vencimento, dia_fechamento, cor, ultimos_digitos) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(user.id, nome, bandeira, banco, parseFloat(limite_total), parseFloat(limite_total), parseInt(dia_vencimento), parseInt(dia_fechamento), cor || '#2FBF71', ultimos_digitos || null).run()

  await verificarConquista(c.env.DB, user.id, 'carteirinha')
  return c.json({ success: true, id: result.meta.last_row_id, message: 'Cartão cadastrado!' }, 201)
})

// PUT /api/cartoes/:id
cartoes.put('/:id', requireAuth, async (c) => {
  const user = c.get('user')
  const id = c.req.param('id')
  const body = await c.req.json()
  const existing = await c.env.DB.prepare('SELECT id FROM cartoes WHERE id = ? AND user_id = ?').bind(id, user.id).first()
  if (!existing) return c.json({ error: 'Cartão não encontrado' }, 404)
  const { nome, bandeira, banco, limite_total, dia_vencimento, dia_fechamento, cor, ultimos_digitos } = body
  await c.env.DB.prepare(
    'UPDATE cartoes SET nome=?, bandeira=?, banco=?, limite_total=?, dia_vencimento=?, dia_fechamento=?, cor=?, ultimos_digitos=? WHERE id=? AND user_id=?'
  ).bind(nome, bandeira, banco, parseFloat(limite_total), parseInt(dia_vencimento), parseInt(dia_fechamento), cor, ultimos_digitos || null, id, user.id).run()
  return c.json({ success: true, message: 'Cartão atualizado!' })
})

// DELETE /api/cartoes/:id
cartoes.delete('/:id', requireAuth, async (c) => {
  const user = c.get('user')
  const id = c.req.param('id')
  await c.env.DB.prepare('UPDATE cartoes SET ativo = 0 WHERE id = ? AND user_id = ?').bind(id, user.id).run()
  return c.json({ success: true, message: 'Cartão removido!' })
})

// GET /api/cartoes/:id/lancamentos
cartoes.get('/:id/lancamentos', requireAuth, async (c) => {
  const user = c.get('user')
  const id = c.req.param('id')
  const { mes, ano } = c.req.query()
  const now = new Date()
  const m = mes?.padStart(2, '0') || String(now.getMonth() + 1).padStart(2, '0')
  const a = ano || String(now.getFullYear())

  const lancamentos = await c.env.DB.prepare(
    `SELECT * FROM cartao_lancamentos WHERE user_id = ? AND cartao_id = ? 
     AND strftime('%m', data_fatura) = ? AND strftime('%Y', data_fatura) = ?
     ORDER BY data_compra DESC`
  ).bind(user.id, id, m, a).all()

  const total = (lancamentos.results as any[]).reduce((s, l) => s + l.valor_total, 0)
  return c.json({ lancamentos: lancamentos.results, total_fatura: total })
})

// GET /api/cartoes/fatura-resumo (todas faturas do mês atual)
cartoes.get('/fatura-resumo', requireAuth, async (c) => {
  const user = c.get('user')
  const now = new Date()
  const mes = String(now.getMonth() + 1).padStart(2, '0')
  const ano = String(now.getFullYear())

  const cartoesList = await c.env.DB.prepare('SELECT * FROM cartoes WHERE user_id = ? AND ativo = 1').bind(user.id).all()
  const resumo = []

  for (const cartao of cartoesList.results as any[]) {
    const total = await c.env.DB.prepare(
      `SELECT COALESCE(SUM(valor_total), 0) as total FROM cartao_lancamentos 
       WHERE cartao_id = ? AND strftime('%m', data_fatura) = ? AND strftime('%Y', data_fatura) = ?`
    ).bind(cartao.id, mes, ano).first() as any
    resumo.push({ ...cartao, fatura_atual: total?.total || 0 })
  }
  return c.json({ resumo })
})

// POST /api/cartoes/:id/lancamentos
cartoes.post('/:id/lancamentos', requireAuth, async (c) => {
  const user = c.get('user')
  const cartao_id = c.req.param('id')
  const body = await c.req.json()
  const { descricao, categoria, valor_total, numero_parcelas = 1, data_compra, observacoes } = body

  if (!descricao || !categoria || !valor_total || !data_compra)
    return c.json({ error: 'Campos obrigatórios faltando' }, 400)

  const cartao = await c.env.DB.prepare('SELECT * FROM cartoes WHERE id = ? AND user_id = ?').bind(cartao_id, user.id).first() as any
  if (!cartao) return c.json({ error: 'Cartão não encontrado' }, 404)

  const nparcelas = parseInt(numero_parcelas)
  const valorParcela = parseFloat(valor_total) / nparcelas
  const ids: number[] = []

  for (let i = 1; i <= nparcelas; i++) {
    const dataCompra = new Date(data_compra)
    const dataFatura = new Date(dataCompra)
    // Calcula a data da fatura baseado no dia de fechamento
    dataFatura.setMonth(dataFatura.getMonth() + (i - 1))
    if (dataCompra.getDate() > cartao.dia_fechamento) {
      dataFatura.setMonth(dataFatura.getMonth() + 1)
    }
    dataFatura.setDate(cartao.dia_vencimento)
    const dataFaturaStr = dataFatura.toISOString().split('T')[0]

    const r = await c.env.DB.prepare(
      `INSERT INTO cartao_lancamentos (user_id, cartao_id, descricao, categoria, valor_total, numero_parcelas, parcela_atual, data_compra, data_fatura, observacoes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(user.id, cartao_id, nparcelas > 1 ? `${descricao} (${i}/${nparcelas})` : descricao, categoria, valorParcela, nparcelas, i, data_compra, dataFaturaStr, observacoes || null).run()
    ids.push(r.meta.last_row_id as number)
  }

  return c.json({ success: true, ids, parcelas: nparcelas, message: nparcelas > 1 ? `${nparcelas} parcelas lançadas!` : 'Compra lançada!' }, 201)
})

// PATCH /api/cartoes/lancamentos/:id/status
cartoes.patch('/lancamentos/:id/status', requireAuth, async (c) => {
  const user = c.get('user')
  const id = c.req.param('id')
  const { status } = await c.req.json()
  await c.env.DB.prepare('UPDATE cartao_lancamentos SET status = ? WHERE id = ? AND user_id = ?').bind(status, id, user.id).run()
  if (status === 'pago') await verificarConquista(c.env.DB, user.id, 'cartao_zero')
  return c.json({ success: true })
})

// DELETE /api/cartoes/lancamentos/:id
cartoes.delete('/lancamentos/:id', requireAuth, async (c) => {
  const user = c.get('user')
  const id = c.req.param('id')
  await c.env.DB.prepare('DELETE FROM cartao_lancamentos WHERE id = ? AND user_id = ?').bind(id, user.id).run()
  return c.json({ success: true, message: 'Lançamento removido!' })
})

async function verificarConquista(db: D1Database, userId: number, codigo: string) {
  try {
    await db.prepare('INSERT OR IGNORE INTO conquistas_usuario (user_id, conquista_codigo) VALUES (?, ?)').bind(userId, codigo).run()
  } catch { /* ignora */ }
}

// POST /api/cartoes/:id/lancamentos-retroativos — lançar compra anterior com parcelas já em andamento
cartoes.post('/:id/lancamentos-retroativos', requireAuth, async (c) => {
  const user = c.get('user')
  const cartao_id = c.req.param('id')
  const body = await c.req.json()
  const { 
    descricao, categoria, valor_total, numero_parcelas, 
    parcelas_pagas, data_compra, observacoes 
  } = body

  if (!descricao || !categoria || !valor_total || !numero_parcelas || parcelas_pagas === undefined || !data_compra)
    return c.json({ error: 'Campos obrigatórios: descricao, categoria, valor_total, numero_parcelas, parcelas_pagas, data_compra' }, 400)

  const cartao = await c.env.DB.prepare('SELECT * FROM cartoes WHERE id = ? AND user_id = ?').bind(cartao_id, user.id).first() as any
  if (!cartao) return c.json({ error: 'Cartão não encontrado' }, 404)

  const nparcelas = parseInt(numero_parcelas)
  const jaPagas = parseInt(parcelas_pagas)
  const parcelasRestantes = nparcelas - jaPagas

  if (parcelasRestantes <= 0) {
    return c.json({ error: 'Todas as parcelas já foram pagas' }, 400)
  }

  const valorParcela = parseFloat(valor_total) / nparcelas
  const ids: number[] = []
  const dataCompra = new Date(data_compra + 'T12:00:00')

  // Inserir apenas as parcelas restantes (a partir da próxima)
  for (let i = jaPagas + 1; i <= nparcelas; i++) {
    const dataFatura = new Date(dataCompra)
    // Avançar meses a partir da data original da compra
    dataFatura.setMonth(dataCompra.getMonth() + (i - 1))
    if (dataCompra.getDate() > cartao.dia_fechamento) {
      dataFatura.setMonth(dataFatura.getMonth() + 1)
    }
    dataFatura.setDate(cartao.dia_vencimento)
    const dataFaturaStr = dataFatura.toISOString().split('T')[0]

    const r = await c.env.DB.prepare(
      `INSERT INTO cartao_lancamentos (user_id, cartao_id, descricao, categoria, valor_total, numero_parcelas, parcela_atual, data_compra, data_fatura, status, observacoes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pendente', ?)`
    ).bind(
      user.id, cartao_id,
      `${descricao} (${i}/${nparcelas})`,
      categoria, valorParcela, nparcelas, i,
      data_compra, dataFaturaStr,
      observacoes ? `[Retroativo - ${jaPagas} parcelas pagas] ${observacoes}` : `[Retroativo - ${jaPagas} parcelas pagas]`
    ).run()
    ids.push(r.meta.last_row_id as number)

    // Também criar entrada em despesas para cada parcela restante
    await c.env.DB.prepare(
      `INSERT INTO despesas (user_id, descricao, data, categoria, valor, parcelado, numero_parcelas, parcela_atual, status, fixa_ou_variavel, cartao_id, meio_pagamento)
       VALUES (?, ?, ?, ?, ?, 1, ?, ?, 'pendente', 'variavel', ?, 'cartao_credito')`
    ).bind(
      user.id, `${descricao} (${i}/${nparcelas})`,
      dataFaturaStr, categoria, valorParcela,
      nparcelas, i, parseInt(cartao_id)
    ).run()
  }

  // Atualizar limite do cartão com o valor das parcelas restantes
  const valorRestante = valorParcela * parcelasRestantes
  await c.env.DB.prepare(
    'UPDATE cartoes SET limite_disponivel = MAX(0, limite_disponivel - ?) WHERE id = ? AND user_id = ?'
  ).bind(valorRestante, parseInt(cartao_id), user.id).run()

  return c.json({ 
    success: true, ids, 
    parcelas_restantes: parcelasRestantes,
    valor_total_restante: valorRestante,
    message: `${parcelasRestantes} parcela(s) restante(s) registradas! (${jaPagas}/${nparcelas} já pagas)` 
  }, 201)
})

export default cartoes
