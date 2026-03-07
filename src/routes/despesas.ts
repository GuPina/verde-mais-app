import { Hono } from 'hono'
import { requireAuth } from './auth'

type Bindings = { DB: D1Database }
type Variables = { user: { id: number; nome: string; email: string; plano: string } }

const despesas = new Hono<{ Bindings: Bindings; Variables: Variables }>()

// GET /api/despesas
despesas.get('/', requireAuth, async (c) => {
  const user = c.get('user')
  const { mes, ano, categoria, status, limit = '50', offset = '0' } = c.req.query()

  let query = 'SELECT * FROM despesas WHERE user_id = ?'
  const params: any[] = [user.id]

  if (mes && ano) {
    query += ' AND strftime("%m", data) = ? AND strftime("%Y", data) = ?'
    params.push(mes.padStart(2, '0'), ano)
  } else if (ano) {
    query += ' AND strftime("%Y", data) = ?'
    params.push(ano)
  }

  if (categoria) {
    query += ' AND categoria = ?'
    params.push(categoria)
  }

  if (status) {
    query += ' AND status = ?'
    params.push(status)
  }

  query += ' ORDER BY data DESC, id DESC LIMIT ? OFFSET ?'
  params.push(parseInt(limit), parseInt(offset))

  const result = await c.env.DB.prepare(query).bind(...params).all()

  // Total do período
  let totalQuery = 'SELECT COALESCE(SUM(valor), 0) as total, COUNT(*) as count FROM despesas WHERE user_id = ?'
  const totalParams: any[] = [user.id]
  if (mes && ano) {
    totalQuery += ' AND strftime("%m", data) = ? AND strftime("%Y", data) = ?'
    totalParams.push(mes.padStart(2, '0'), ano)
  }
  const total = await c.env.DB.prepare(totalQuery).bind(...totalParams).first() as any

  return c.json({ 
    despesas: result.results, 
    total: total?.total || 0,
    count: result.results.length 
  })
})

// POST /api/despesas
despesas.post('/', requireAuth, async (c) => {
  const user = c.get('user')
  const body = await c.req.json()
  const { 
    descricao, data, categoria, subcategoria, valor, 
    parcelado = false, numero_parcelas = 1, status = 'pendente',
    fixa_ou_variavel = 'variavel', recorrente = false, vencimento, observacoes,
    cartao_id = null, meio_pagamento = 'dinheiro'
  } = body

  if (!descricao || !data || !categoria || !valor) {
    return c.json({ error: 'Campos obrigatórios: descricao, data, categoria, valor' }, 400)
  }

  const totalParcelas = parcelado ? parseInt(numero_parcelas) : 1
  const valorParcela = parseFloat(valor) / totalParcelas
  const ids: number[] = []
  const valorTotal = parseFloat(valor)

  // Criar parcelas automaticamente
  for (let i = 1; i <= totalParcelas; i++) {
    const dataBase = new Date(data)
    dataBase.setMonth(dataBase.getMonth() + (i - 1))
    const dataParcela = dataBase.toISOString().split('T')[0]

    const result = await c.env.DB.prepare(
      `INSERT INTO despesas (user_id, descricao, data, categoria, subcategoria, valor, parcelado, numero_parcelas, parcela_atual, status, fixa_ou_variavel, recorrente, vencimento, observacoes, cartao_id, meio_pagamento) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      user.id, 
      totalParcelas > 1 ? `${descricao} (${i}/${totalParcelas})` : descricao,
      dataParcela, categoria, subcategoria || null, valorParcela,
      parcelado ? 1 : 0, totalParcelas, i, status,
      fixa_ou_variavel, recorrente ? 1 : 0, vencimento || null, observacoes || null,
      cartao_id ? parseInt(cartao_id) : null, meio_pagamento
    ).run()
    
    ids.push(result.meta.last_row_id as number)
  }

  // Se tiver cartão associado, reduzir o limite disponível pelo valor TOTAL da compra
  const meioPagamentoCartao = ['cartao_credito', 'parcelado_cartao', 'cartao_debito']
  if (cartao_id && meioPagamentoCartao.includes(meio_pagamento)) {
    await c.env.DB.prepare(
      'UPDATE cartoes SET limite_disponivel = MAX(0, limite_disponivel - ?) WHERE id = ? AND user_id = ?'
    ).bind(valorTotal, parseInt(cartao_id), user.id).run()
  }

  return c.json({ 
    success: true, 
    ids, 
    parcelas: totalParcelas,
    message: totalParcelas > 1 ? `${totalParcelas} parcelas criadas!` : 'Despesa adicionada!'
  }, 201)
})

// PUT /api/despesas/:id
despesas.put('/:id', requireAuth, async (c) => {
  const user = c.get('user')
  const id = c.req.param('id')
  const body = await c.req.json()

  const existing = await c.env.DB.prepare('SELECT id FROM despesas WHERE id = ? AND user_id = ?').bind(id, user.id).first()
  if (!existing) return c.json({ error: 'Despesa não encontrada' }, 404)

  const { descricao, data, categoria, subcategoria, valor, status, fixa_ou_variavel, vencimento, observacoes } = body

  await c.env.DB.prepare(
    'UPDATE despesas SET descricao = ?, data = ?, categoria = ?, subcategoria = ?, valor = ?, status = ?, fixa_ou_variavel = ?, vencimento = ?, observacoes = ? WHERE id = ? AND user_id = ?'
  ).bind(descricao, data, categoria, subcategoria || null, parseFloat(valor), status, fixa_ou_variavel, vencimento || null, observacoes || null, id, user.id).run()

  return c.json({ success: true, message: 'Despesa atualizada!' })
})

// PATCH /api/despesas/:id/status
despesas.patch('/:id/status', requireAuth, async (c) => {
  const user = c.get('user')
  const id = c.req.param('id')
  const { status } = await c.req.json()

  const existing = await c.env.DB.prepare('SELECT id FROM despesas WHERE id = ? AND user_id = ?').bind(id, user.id).first()
  if (!existing) return c.json({ error: 'Despesa não encontrada' }, 404)

  await c.env.DB.prepare('UPDATE despesas SET status = ? WHERE id = ? AND user_id = ?').bind(status, id, user.id).run()
  return c.json({ success: true, message: `Status atualizado para ${status}!` })
})

// DELETE /api/despesas/:id
despesas.delete('/:id', requireAuth, async (c) => {
  const user = c.get('user')
  const id = c.req.param('id')

  const existing = await c.env.DB.prepare('SELECT * FROM despesas WHERE id = ? AND user_id = ?').bind(id, user.id).first() as any
  if (!existing) return c.json({ error: 'Despesa não encontrada' }, 404)

  // Se era despesa no cartão, devolver limite (apenas se for a primeira parcela de um grupo — evita devolver múltiplas vezes)
  if (existing.cartao_id && (existing.meio_pagamento === 'cartao_credito') && existing.parcela_atual === 1) {
    const valorTotal = existing.valor * existing.numero_parcelas
    const cartao = await c.env.DB.prepare('SELECT limite_total FROM cartoes WHERE id = ?').bind(existing.cartao_id).first() as any
    if (cartao) {
      await c.env.DB.prepare(
        'UPDATE cartoes SET limite_disponivel = MIN(limite_total, limite_disponivel + ?) WHERE id = ? AND user_id = ?'
      ).bind(valorTotal, existing.cartao_id, user.id).run()
    }
  }

  await c.env.DB.prepare('DELETE FROM despesas WHERE id = ? AND user_id = ?').bind(id, user.id).run()
  return c.json({ success: true, message: 'Despesa excluída!' })
})

// GET /api/despesas/categorias
despesas.get('/categorias', requireAuth, async (c) => {
  const user = c.get('user')
  const { mes, ano } = c.req.query()
  
  let query = 'SELECT categoria, COALESCE(SUM(valor), 0) as total, COUNT(*) as count FROM despesas WHERE user_id = ?'
  const params: any[] = [user.id]
  
  if (mes && ano) {
    query += ' AND strftime("%m", data) = ? AND strftime("%Y", data) = ?'
    params.push(mes.padStart(2, '0'), ano)
  }
  
  query += ' GROUP BY categoria ORDER BY total DESC'
  const result = await c.env.DB.prepare(query).bind(...params).all()
  return c.json({ categorias: result.results })
})

export default despesas
