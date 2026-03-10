import { Hono } from 'hono'
import { requireAuth } from './auth'
import { getLimites, MSG_UPGRADE } from './planos'

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

  // ── Limite de plano ──
  const lim = getLimites(user.plano)
  if (lim.despesas_mes !== Infinity) {
    const now = new Date()
    const mesAtual = String(now.getMonth() + 1).padStart(2, '0')
    const anoAtual = String(now.getFullYear())
    const count = await c.env.DB.prepare(
      `SELECT COUNT(*) as n FROM despesas WHERE user_id = ? AND strftime('%m', data) = ? AND strftime('%Y', data) = ?`
    ).bind(user.id, mesAtual, anoAtual).first() as any
    if ((count?.n || 0) >= lim.despesas_mes)
      return c.json({ error: MSG_UPGRADE.despesas_mes, upgrade: true, limite: lim.despesas_mes, feature: 'despesas_mes' }, 403)
  }

  const body = await c.req.json()
  const { 
    descricao, data, categoria, subcategoria, valor, 
    parcelado = false, numero_parcelas = 1, status = 'pendente',
    fixa_ou_variavel = 'variavel', recorrente = false, vencimento, observacoes,
    cartao_id = null, meio_pagamento = 'dinheiro',
    valor_parcela_override = null,
    parcelas_total_original = null
  } = body

  if (!descricao || !data || !categoria || !valor) {
    return c.json({ error: 'Campos obrigatórios: descricao, data, categoria, valor' }, 400)
  }

  const totalParcelas = parcelado ? parseInt(numero_parcelas) : 1
  // Se vier valor_parcela_override (compra retroativa), usa ele direto
  // Senão divide valor pelo total de parcelas normalmente
  const valorParcela = valor_parcela_override 
    ? parseFloat(valor_parcela_override)
    : parseFloat(valor) / totalParcelas
  // Total original de parcelas (para label ex: 7/10 → parcelas_total_original=10)
  const totalParcelasLabel = parcelas_total_original ? parseInt(parcelas_total_original) : totalParcelas
  const ids: number[] = []
  const valorTotal = parseFloat(valor)

  // Criar parcelas automaticamente
  // Para compras retroativas: parcela_atual começa em (totalParcelasLabel - totalParcelas + 1)
  // Ex: 10x, 3 pagas → restantes=7 → primeira parcela registrada é a 4ª
  const parcelaInicialLabel = totalParcelasLabel - totalParcelas + 1
  for (let i = 0; i < totalParcelas; i++) {
    const dataBase = new Date(data)
    dataBase.setMonth(dataBase.getMonth() + i)
    const dataParcela = dataBase.toISOString().split('T')[0]
    const parcelaAtualLabel = parcelaInicialLabel + i

    const result = await c.env.DB.prepare(
      `INSERT INTO despesas (user_id, descricao, data, categoria, subcategoria, valor, parcelado, numero_parcelas, parcela_atual, status, fixa_ou_variavel, recorrente, vencimento, observacoes, cartao_id, meio_pagamento) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      user.id, 
      totalParcelas > 1 ? `${descricao} (${parcelaAtualLabel}/${totalParcelasLabel})` : descricao,
      dataParcela, categoria, subcategoria || null, valorParcela,
      parcelado ? 1 : 0, totalParcelasLabel, parcelaAtualLabel, status,
      fixa_ou_variavel, recorrente ? 1 : 0, vencimento || null, observacoes || null,
      cartao_id ? parseInt(cartao_id) : null, meio_pagamento
    ).run()
    
    ids.push(result.meta.last_row_id as number)
  }

  // Se tiver cartão associado, reduzir o limite disponível pelo valor TOTAL das parcelas RESTANTES
  const meioPagamentoCartao = ['cartao_credito', 'parcelado_cartao', 'cartao_debito']
  if (cartao_id && meioPagamentoCartao.includes(meio_pagamento)) {
    const valorDesconto = valorParcela * totalParcelas
    await c.env.DB.prepare(
      'UPDATE cartoes SET limite_disponivel = MAX(0, limite_disponivel - ?) WHERE id = ? AND user_id = ?'
    ).bind(valorDesconto, parseInt(cartao_id), user.id).run()
  }

  return c.json({ 
    success: true, 
    ids, 
    parcelas: totalParcelas,
    parcelas_total_original: totalParcelasLabel,
    message: totalParcelas > 1 ? `${totalParcelas} parcelas criadas! (${parcelaInicialLabel}/${totalParcelasLabel} a ${totalParcelas + parcelaInicialLabel - 1}/${totalParcelasLabel})` : 'Despesa adicionada!'
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

  // Conquistas: disciplinado (10 despesas pagas no mesmo mês) e poupador
  if (status === 'pago') {
    try {
      const mes = new Date().toISOString().slice(0, 7) // YYYY-MM
      const pagasMes = await c.env.DB.prepare(
        `SELECT COUNT(*) as total FROM despesas WHERE user_id = ? AND status = 'pago' AND strftime('%Y-%m', data) = ?`
      ).bind(user.id, mes).first() as any
      if ((pagasMes?.total || 0) >= 10) await verificarConquistaDespesa(c.env.DB, user.id, 'disciplinado')

      // Poupador: se receitas do mês > despesas pagas em 20% ou mais
      const [receitasMes, despesasMes] = await Promise.all([
        c.env.DB.prepare(`SELECT COALESCE(SUM(valor),0) as total FROM receitas WHERE user_id=? AND strftime('%Y-%m',data)=?`).bind(user.id, mes).first() as any,
        c.env.DB.prepare(`SELECT COALESCE(SUM(valor),0) as total FROM despesas WHERE user_id=? AND status IN ('pago','pendente') AND strftime('%Y-%m',data)=?`).bind(user.id, mes).first() as any
      ])
      const rec = receitasMes?.total || 0
      const desp = despesasMes?.total || 0
      if (rec > 0 && (rec - desp) / rec >= 0.2) await verificarConquistaDespesa(c.env.DB, user.id, 'poupador')
    } catch {}
  }

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

async function verificarConquistaDespesa(db: D1Database, userId: number, codigo: string) {
  try {
    await db.prepare('INSERT OR IGNORE INTO conquistas_usuario (user_id, conquista_codigo, visualizado) VALUES (?, ?, 0)').bind(userId, codigo).run()
  } catch {}
}

export default despesas
