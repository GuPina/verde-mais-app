import { Hono } from 'hono'
import { requireAuth } from './auth'

type Bindings = { DB: D1Database }
type Variables = { user: { id: number; nome: string; email: string; plano: string } }

const emprestimos = new Hono<{ Bindings: Bindings; Variables: Variables }>()

// GET /api/emprestimos
emprestimos.get('/', requireAuth, async (c) => {
  const user = c.get('user')
  const result = await c.env.DB.prepare(
    'SELECT * FROM emprestimos WHERE user_id = ? ORDER BY data_criacao DESC'
  ).bind(user.id).all()

  const list = (result.results as any[]).map(e => {
    const percPago = e.numero_parcelas > 0 ? Math.round((e.parcelas_pagas / e.numero_parcelas) * 100) : 0
    const totalPagar = e.valor_parcela * e.numero_parcelas
    const totalJuros = totalPagar - e.valor_original
    const custo_efetivo = e.valor_original > 0 ? ((totalJuros / e.valor_original) * 100) : 0
    return { ...e, perc_pago: percPago, total_a_pagar: totalPagar, total_juros: totalJuros, custo_efetivo_total: Math.round(custo_efetivo * 100) / 100 }
  })

  const totalSaldo = list.reduce((s, e) => s + (e.status === 'ativo' ? e.saldo_devedor : 0), 0)
  const totalMensal = list.reduce((s, e) => s + (e.status === 'ativo' ? e.valor_parcela : 0), 0)

  return c.json({ emprestimos: list, resumo: { total_saldo_devedor: totalSaldo, total_parcelas_mes: totalMensal } })
})

// POST /api/emprestimos
emprestimos.post('/', requireAuth, async (c) => {
  const user = c.get('user')
  const body = await c.req.json()
  const {
    descricao, tipo = 'pessoal', valor_original, taxa_juros_mensal, numero_parcelas,
    parcelas_pagas = 0, valor_parcela, data_inicio, dia_vencimento, credor, observacoes
  } = body

  if (!descricao || !valor_original || !taxa_juros_mensal || !numero_parcelas || !valor_parcela || !data_inicio)
    return c.json({ error: 'Campos obrigatórios faltando' }, 400)

  const taxaM = parseFloat(taxa_juros_mensal) / 100
  const taxaA = (Math.pow(1 + taxaM, 12) - 1) * 100
  const saldoDevedor = calcSaldo(parseFloat(valor_original), taxaM, parseInt(numero_parcelas), parseInt(parcelas_pagas))

  const dataInicio = new Date(data_inicio)
  const dataFim = new Date(dataInicio)
  dataFim.setMonth(dataFim.getMonth() + parseInt(numero_parcelas))

  const result = await c.env.DB.prepare(
    `INSERT INTO emprestimos (user_id, descricao, tipo, valor_original, valor_pago, saldo_devedor, taxa_juros_mensal, taxa_juros_anual, numero_parcelas, parcelas_pagas, valor_parcela, data_inicio, data_previsao_fim, dia_vencimento, credor, observacoes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(user.id, descricao, tipo, parseFloat(valor_original), parseFloat(valor_parcela) * parseInt(parcelas_pagas), saldoDevedor, parseFloat(taxa_juros_mensal), Math.round(taxaA * 100) / 100, parseInt(numero_parcelas), parseInt(parcelas_pagas), parseFloat(valor_parcela), data_inicio, dataFim.toISOString().split('T')[0], parseInt(dia_vencimento) || null, credor || null, observacoes || null).run()

  return c.json({ success: true, id: result.meta.last_row_id, message: 'Empréstimo cadastrado!' }, 201)
})

// PUT /api/emprestimos/:id
emprestimos.put('/:id', requireAuth, async (c) => {
  const user = c.get('user')
  const id = c.req.param('id')
  const existing = await c.env.DB.prepare('SELECT id FROM emprestimos WHERE id = ? AND user_id = ?').bind(id, user.id).first()
  if (!existing) return c.json({ error: 'Empréstimo não encontrado' }, 404)

  const body = await c.req.json()
  const { descricao, tipo, valor_original, taxa_juros_mensal, numero_parcelas, parcelas_pagas, valor_parcela, data_inicio, dia_vencimento, credor, status, observacoes } = body

  const taxaM = parseFloat(taxa_juros_mensal) / 100
  const taxaA = (Math.pow(1 + taxaM, 12) - 1) * 100
  const saldoDevedor = calcSaldo(parseFloat(valor_original), taxaM, parseInt(numero_parcelas), parseInt(parcelas_pagas))
  const valorPago = parseFloat(valor_parcela) * parseInt(parcelas_pagas)

  await c.env.DB.prepare(
    `UPDATE emprestimos SET descricao=?, tipo=?, valor_original=?, valor_pago=?, saldo_devedor=?, taxa_juros_mensal=?, taxa_juros_anual=?, numero_parcelas=?, parcelas_pagas=?, valor_parcela=?, data_inicio=?, dia_vencimento=?, credor=?, status=?, observacoes=? WHERE id=? AND user_id=?`
  ).bind(descricao, tipo, parseFloat(valor_original), valorPago, saldoDevedor, parseFloat(taxa_juros_mensal), Math.round(taxaA * 100) / 100, parseInt(numero_parcelas), parseInt(parcelas_pagas), parseFloat(valor_parcela), data_inicio, parseInt(dia_vencimento) || null, credor || null, status || 'ativo', observacoes || null, id, user.id).run()

  if (status === 'quitado') await verificarConquista(c.env.DB, user.id, 'sem_dividas')
  return c.json({ success: true, message: 'Empréstimo atualizado!' })
})

// PATCH /api/emprestimos/:id/parcela
emprestimos.patch('/:id/parcela', requireAuth, async (c) => {
  const user = c.get('user')
  const id = c.req.param('id')
  const emp = await c.env.DB.prepare('SELECT * FROM emprestimos WHERE id = ? AND user_id = ?').bind(id, user.id).first() as any
  if (!emp) return c.json({ error: 'Empréstimo não encontrado' }, 404)

  const novasParcelas = emp.parcelas_pagas + 1
  const taxaM = emp.taxa_juros_mensal / 100
  const novoSaldo = calcSaldo(emp.valor_original, taxaM, emp.numero_parcelas, novasParcelas)
  const novoValorPago = emp.valor_pago + emp.valor_parcela
  const status = novasParcelas >= emp.numero_parcelas ? 'quitado' : 'ativo'

  await c.env.DB.prepare('UPDATE emprestimos SET parcelas_pagas=?, saldo_devedor=?, valor_pago=?, status=? WHERE id=? AND user_id=?').bind(novasParcelas, novoSaldo, novoValorPago, status, id, user.id).run()
  if (status === 'quitado') await verificarConquista(c.env.DB, user.id, 'sem_dividas')

  return c.json({ success: true, parcelas_pagas: novasParcelas, saldo_devedor: novoSaldo, status, message: status === 'quitado' ? '🎉 Empréstimo quitado!' : `Parcela ${novasParcelas}/${emp.numero_parcelas} paga!` })
})

// DELETE /api/emprestimos/:id
emprestimos.delete('/:id', requireAuth, async (c) => {
  const user = c.get('user')
  const id = c.req.param('id')
  await c.env.DB.prepare('DELETE FROM emprestimos WHERE id = ? AND user_id = ?').bind(id, user.id).run()
  return c.json({ success: true, message: 'Empréstimo removido!' })
})

function calcSaldo(valorOriginal: number, taxaMensal: number, numParcelas: number, parcelasPagas: number): number {
  if (taxaMensal === 0) return valorOriginal * (1 - parcelasPagas / numParcelas)
  const fator = Math.pow(1 + taxaMensal, numParcelas)
  const fatorPago = Math.pow(1 + taxaMensal, parcelasPagas)
  return Math.max(0, Math.round(valorOriginal * (fator - fatorPago) / (fator - 1) * 100) / 100)
}

async function verificarConquista(db: D1Database, userId: number, codigo: string) {
  try {
    await db.prepare('INSERT OR IGNORE INTO conquistas_usuario (user_id, conquista_codigo) VALUES (?, ?)').bind(userId, codigo).run()
  } catch { }
}

export default emprestimos
