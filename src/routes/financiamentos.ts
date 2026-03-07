import { Hono } from 'hono'
import { requireAuth } from './auth'

type Bindings = { DB: D1Database }
type Variables = { user: { id: number; nome: string; email: string; plano: string } }

const financiamentos = new Hono<{ Bindings: Bindings; Variables: Variables }>()

// GET /api/financiamentos
financiamentos.get('/', requireAuth, async (c) => {
  const user = c.get('user')
  const result = await c.env.DB.prepare(
    'SELECT * FROM financiamentos WHERE user_id = ? ORDER BY data_criacao DESC'
  ).bind(user.id).all()

  const list = (result.results as any[]).map(f => {
    const percPago = f.numero_parcelas > 0 ? Math.round((f.parcelas_pagas / f.numero_parcelas) * 100) : 0
    const parcelasRestantes = f.numero_parcelas - f.parcelas_pagas
    const totalPago = f.valor_parcela * f.parcelas_pagas
    const totalJuros = totalPago - (f.valor_financiado * (f.parcelas_pagas / f.numero_parcelas))
    return { ...f, perc_pago: percPago, parcelas_restantes: parcelasRestantes, total_pago: totalPago }
  })

  const totalSaldo = list.reduce((s, f) => s + (f.status === 'ativo' ? f.saldo_devedor : 0), 0)
  const totalParcelas = list.reduce((s, f) => s + (f.status === 'ativo' ? f.valor_parcela : 0), 0)

  return c.json({ financiamentos: list, resumo: { total_saldo_devedor: totalSaldo, total_parcelas_mes: totalParcelas } })
})

// POST /api/financiamentos
financiamentos.post('/', requireAuth, async (c) => {
  const user = c.get('user')
  const body = await c.req.json()
  const {
    descricao, tipo_imovel = 'residencial', valor_imovel, valor_financiado, valor_entrada = 0,
    taxa_juros_anual, numero_parcelas, parcelas_pagas = 0, valor_parcela,
    data_inicio, banco, contrato, sistema_amortizacao = 'price', indexador = 'prefixado', observacoes
  } = body

  if (!descricao || !valor_imovel || !valor_financiado || !taxa_juros_anual || !numero_parcelas || !valor_parcela || !data_inicio)
    return c.json({ error: 'Preencha todos os campos obrigatórios' }, 400)

  const taxaMensal = parseFloat(taxa_juros_anual) / 12 / 100
  const parcelasRestantes = parseInt(numero_parcelas) - parseInt(parcelas_pagas)
  const saldoDevedor = calcularSaldoDevedor(parseFloat(valor_financiado), taxaMensal, parseInt(numero_parcelas), parseInt(parcelas_pagas))

  // Data prevista de fim
  const dataInicio = new Date(data_inicio)
  const dataFim = new Date(dataInicio)
  dataFim.setMonth(dataFim.getMonth() + parseInt(numero_parcelas))

  const result = await c.env.DB.prepare(
    `INSERT INTO financiamentos (user_id, descricao, tipo_imovel, valor_imovel, valor_financiado, valor_entrada, taxa_juros_anual, taxa_juros_mensal, numero_parcelas, parcelas_pagas, valor_parcela, saldo_devedor, data_inicio, data_previsao_fim, sistema_amortizacao, banco, contrato, indexador, observacoes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(user.id, descricao, tipo_imovel, parseFloat(valor_imovel), parseFloat(valor_financiado), parseFloat(valor_entrada), parseFloat(taxa_juros_anual), taxaMensal * 100, parseInt(numero_parcelas), parseInt(parcelas_pagas), parseFloat(valor_parcela), saldoDevedor, data_inicio, dataFim.toISOString().split('T')[0], sistema_amortizacao, banco || null, contrato || null, indexador, observacoes || null).run()

  await verificarConquista(c.env.DB, user.id, 'planejador')
  return c.json({ success: true, id: result.meta.last_row_id, message: 'Financiamento cadastrado!' }, 201)
})

// PUT /api/financiamentos/:id
financiamentos.put('/:id', requireAuth, async (c) => {
  const user = c.get('user')
  const id = c.req.param('id')
  const existing = await c.env.DB.prepare('SELECT id FROM financiamentos WHERE id = ? AND user_id = ?').bind(id, user.id).first()
  if (!existing) return c.json({ error: 'Financiamento não encontrado' }, 404)

  const body = await c.req.json()
  const { descricao, tipo_imovel, valor_imovel, valor_financiado, valor_entrada, taxa_juros_anual, numero_parcelas, parcelas_pagas, valor_parcela, data_inicio, banco, contrato, sistema_amortizacao, indexador, status, observacoes } = body

  const taxaMensal = parseFloat(taxa_juros_anual) / 12 / 100
  const saldoDevedor = calcularSaldoDevedor(parseFloat(valor_financiado), taxaMensal, parseInt(numero_parcelas), parseInt(parcelas_pagas))

  await c.env.DB.prepare(
    `UPDATE financiamentos SET descricao=?, tipo_imovel=?, valor_imovel=?, valor_financiado=?, valor_entrada=?, taxa_juros_anual=?, taxa_juros_mensal=?, numero_parcelas=?, parcelas_pagas=?, valor_parcela=?, saldo_devedor=?, data_inicio=?, banco=?, contrato=?, sistema_amortizacao=?, indexador=?, status=?, observacoes=? WHERE id=? AND user_id=?`
  ).bind(descricao, tipo_imovel, parseFloat(valor_imovel), parseFloat(valor_financiado), parseFloat(valor_entrada), parseFloat(taxa_juros_anual), taxaMensal * 100, parseInt(numero_parcelas), parseInt(parcelas_pagas), parseFloat(valor_parcela), saldoDevedor, data_inicio, banco || null, contrato || null, sistema_amortizacao, indexador, status || 'ativo', observacoes || null, id, user.id).run()

  if (status === 'quitado') await verificarConquista(c.env.DB, user.id, 'sem_dividas')
  return c.json({ success: true, message: 'Financiamento atualizado!' })
})

// PATCH /api/financiamentos/:id/parcela — registrar pagamento de parcela
financiamentos.patch('/:id/parcela', requireAuth, async (c) => {
  const user = c.get('user')
  const id = c.req.param('id')
  const fin = await c.env.DB.prepare('SELECT * FROM financiamentos WHERE id = ? AND user_id = ?').bind(id, user.id).first() as any
  if (!fin) return c.json({ error: 'Financiamento não encontrado' }, 404)

  const novasParcelas = fin.parcelas_pagas + 1
  const taxaMensal = fin.taxa_juros_mensal / 100
  const novoSaldo = calcularSaldoDevedor(fin.valor_financiado, taxaMensal, fin.numero_parcelas, novasParcelas)
  const status = novasParcelas >= fin.numero_parcelas ? 'quitado' : 'ativo'

  await c.env.DB.prepare('UPDATE financiamentos SET parcelas_pagas = ?, saldo_devedor = ?, status = ? WHERE id = ? AND user_id = ?').bind(novasParcelas, novoSaldo, status, id, user.id).run()
  if (status === 'quitado') await verificarConquista(c.env.DB, user.id, 'sem_dividas')

  return c.json({ success: true, parcelas_pagas: novasParcelas, saldo_devedor: novoSaldo, status, message: status === 'quitado' ? '🎉 Financiamento quitado!' : `Parcela ${novasParcelas}/${fin.numero_parcelas} paga!` })
})

// DELETE /api/financiamentos/:id
financiamentos.delete('/:id', requireAuth, async (c) => {
  const user = c.get('user')
  const id = c.req.param('id')
  await c.env.DB.prepare('DELETE FROM financiamentos WHERE id = ? AND user_id = ?').bind(id, user.id).run()
  return c.json({ success: true, message: 'Financiamento removido!' })
})

// GET /api/financiamentos/:id/simulacao-amortizacao
financiamentos.get('/:id/simulacao', requireAuth, async (c) => {
  const user = c.get('user')
  const id = c.req.param('id')
  const fin = await c.env.DB.prepare('SELECT * FROM financiamentos WHERE id = ? AND user_id = ?').bind(id, user.id).first() as any
  if (!fin) return c.json({ error: 'Não encontrado' }, 404)

  const taxaMensal = fin.taxa_juros_mensal / 100
  const tabela = []

  let saldo = fin.saldo_devedor
  for (let i = fin.parcelas_pagas + 1; i <= Math.min(fin.numero_parcelas, fin.parcelas_pagas + 24); i++) {
    const juros = saldo * taxaMensal
    const amortizacao = fin.valor_parcela - juros
    saldo = Math.max(0, saldo - amortizacao)
    tabela.push({ parcela: i, valor_parcela: fin.valor_parcela, juros: Math.round(juros * 100) / 100, amortizacao: Math.round(amortizacao * 100) / 100, saldo: Math.round(saldo * 100) / 100 })
  }

  return c.json({ tabela, info: 'Mostrando próximas 24 parcelas' })
})

function calcularSaldoDevedor(valorFinanciado: number, taxaMensal: number, numParcelas: number, parcelasPagas: number): number {
  if (taxaMensal === 0) return valorFinanciado * (1 - parcelasPagas / numParcelas)
  const fator = Math.pow(1 + taxaMensal, numParcelas)
  const fatorPago = Math.pow(1 + taxaMensal, parcelasPagas)
  const saldo = valorFinanciado * (fator - fatorPago) / (fator - 1)
  return Math.max(0, Math.round(saldo * 100) / 100)
}

async function verificarConquista(db: D1Database, userId: number, codigo: string) {
  try {
    await db.prepare('INSERT OR IGNORE INTO conquistas_usuario (user_id, conquista_codigo) VALUES (?, ?)').bind(userId, codigo).run()
  } catch { }
}

export default financiamentos
