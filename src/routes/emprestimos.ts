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
    descricao, tipo = 'pessoal', valor_original, saldo_devedor: saldoInformado,
    taxa_juros_mensal, numero_parcelas,
    parcelas_pagas = 0, valor_parcela, data_inicio, dia_vencimento, credor, observacoes
  } = body

  if (!descricao || !valor_original || !taxa_juros_mensal || !numero_parcelas || !valor_parcela || !data_inicio)
    return c.json({ error: 'Campos obrigatórios faltando' }, 400)

  const taxaM = parseFloat(taxa_juros_mensal) / 100
  const taxaA = (Math.pow(1 + taxaM, 12) - 1) * 100
  const parcelasPagasN = parseInt(parcelas_pagas)

  // REGRA: se o usuário informou saldo_devedor_atual, usa ele. Senão, calcula automaticamente.
  let saldoDevedor: number
  if (saldoInformado && parseFloat(saldoInformado) > 0) {
    saldoDevedor = parseFloat(saldoInformado)
  } else {
    saldoDevedor = calcSaldo(parseFloat(valor_original), taxaM, parseInt(numero_parcelas), parcelasPagasN)
  }

  const dataInicio = new Date(data_inicio)
  const dataFim = new Date(dataInicio)
  dataFim.setMonth(dataFim.getMonth() + parseInt(numero_parcelas))

  const result = await c.env.DB.prepare(
    `INSERT INTO emprestimos (user_id, descricao, tipo, valor_original, valor_pago, saldo_devedor, taxa_juros_mensal, taxa_juros_anual, numero_parcelas, parcelas_pagas, valor_parcela, data_inicio, data_previsao_fim, dia_vencimento, credor, observacoes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(user.id, descricao, tipo, parseFloat(valor_original), parseFloat(valor_parcela) * parcelasPagasN, saldoDevedor, parseFloat(taxa_juros_mensal), Math.round(taxaA * 100) / 100, parseInt(numero_parcelas), parcelasPagasN, parseFloat(valor_parcela), data_inicio, dataFim.toISOString().split('T')[0], parseInt(dia_vencimento) || null, credor || null, observacoes || null).run()

  const empId = result.meta.last_row_id as number

  // Conquistas por tipo
  if (tipo === 'veiculo') await verificarConquista(c.env.DB, user.id, 'primeiro_carro')
  const totalParcelas = parseInt(numero_parcelas)
  const valorParc = parseFloat(valor_parcela)
  const diaVenc = parseInt(dia_vencimento) || dataInicio.getDate()

  for (let i = parcelasPagasN; i < totalParcelas; i++) {
    const dataParc = new Date(dataInicio)
    dataParc.setMonth(dataParc.getMonth() + i)
    if (diaVenc && diaVenc !== dataParc.getDate()) {
      dataParc.setDate(Math.min(diaVenc, new Date(dataParc.getFullYear(), dataParc.getMonth() + 1, 0).getDate()))
    }
    const dataParcStr = dataParc.toISOString().split('T')[0]
    await c.env.DB.prepare(
      `INSERT INTO despesas (user_id, descricao, data, categoria, valor, parcelado, numero_parcelas, parcela_atual, status, fixa_ou_variavel, recorrente, vencimento, observacoes, meio_pagamento)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      user.id,
      `${descricao} (${i + 1}/${totalParcelas})`,
      dataParcStr,
      'Empréstimo',
      valorParc,
      1, totalParcelas, i + 1,
      i < parcelasPagasN ? 'pago' : 'pendente',
      'fixa', 0,
      dataParcStr,
      `Empréstimo automático #${empId} — ${credor || tipo}`,
      'transferencia'
    ).run()
  }

  return c.json({ success: true, id: empId, message: 'Empréstimo cadastrado e despesas criadas automaticamente!' }, 201)
})

// PUT /api/emprestimos/:id
emprestimos.put('/:id', requireAuth, async (c) => {
  const user = c.get('user')
  const id = c.req.param('id')
  const existing = await c.env.DB.prepare('SELECT id FROM emprestimos WHERE id = ? AND user_id = ?').bind(id, user.id).first()
  if (!existing) return c.json({ error: 'Empréstimo não encontrado' }, 404)

  const body = await c.req.json()
  const { descricao, tipo, valor_original, saldo_devedor: saldoInformado, taxa_juros_mensal, numero_parcelas, parcelas_pagas, valor_parcela, data_inicio, dia_vencimento, credor, status, observacoes } = body

  const taxaM = parseFloat(taxa_juros_mensal) / 100
  const taxaA = (Math.pow(1 + taxaM, 12) - 1) * 100
  const parcelasPagasN = parseInt(parcelas_pagas)

  // Mesma regra: se informou saldo atual, usa; senão, calcula
  let saldoDevedor: number
  if (saldoInformado && parseFloat(saldoInformado) > 0) {
    saldoDevedor = parseFloat(saldoInformado)
  } else {
    saldoDevedor = calcSaldo(parseFloat(valor_original), taxaM, parseInt(numero_parcelas), parcelasPagasN)
  }

  const valorPago = parseFloat(valor_parcela) * parcelasPagasN

  await c.env.DB.prepare(
    `UPDATE emprestimos SET descricao=?, tipo=?, valor_original=?, valor_pago=?, saldo_devedor=?, taxa_juros_mensal=?, taxa_juros_anual=?, numero_parcelas=?, parcelas_pagas=?, valor_parcela=?, data_inicio=?, dia_vencimento=?, credor=?, status=?, observacoes=? WHERE id=? AND user_id=?`
  ).bind(descricao, tipo, parseFloat(valor_original), valorPago, saldoDevedor, parseFloat(taxa_juros_mensal), Math.round(taxaA * 100) / 100, parseInt(numero_parcelas), parcelasPagasN, parseFloat(valor_parcela), data_inicio, parseInt(dia_vencimento) || null, credor || null, status || 'ativo', observacoes || null, id, user.id).run()

  if (status === 'quitado') await verificarConquista(c.env.DB, user.id, 'sem_dividas')

  // Sincronizar valor das despesas pendentes vinculadas a este empréstimo
  // (caso o valor_parcela tenha mudado na edição)
  await c.env.DB.prepare(
    `UPDATE despesas SET valor = ?, descricao = REPLACE(descricao, SUBSTR(descricao, INSTR(descricao, '(')), '') || '(' || CAST(parcela_atual AS TEXT) || '/' || ? || ')'
     WHERE user_id = ? AND categoria = 'Empréstimo' AND status = 'pendente' AND observacoes LIKE ?`
  ).bind(parseFloat(valor_parcela), parseInt(numero_parcelas), user.id, `%Empréstimo automático #${id}%`).run()

  return c.json({ success: true, message: 'Empréstimo atualizado!' })
})

// PATCH /api/emprestimos/:id/parcela
// Lógica correta: subtrai (parcela - juros_sobre_saldo_atual) do saldo_devedor
emprestimos.patch('/:id/parcela', requireAuth, async (c) => {
  const user = c.get('user')
  const id = c.req.param('id')
  const emp = await c.env.DB.prepare('SELECT * FROM emprestimos WHERE id = ? AND user_id = ?').bind(id, user.id).first() as any
  if (!emp) return c.json({ error: 'Empréstimo não encontrado' }, 404)

  const novasParcelas = emp.parcelas_pagas + 1
  const taxaM = emp.taxa_juros_mensal / 100

  // CÁLCULO CORRETO: juros do mês sobre saldo_devedor atual, depois amortiza
  const jurosMes = emp.saldo_devedor * taxaM
  const amortizacao = emp.valor_parcela - jurosMes
  const novoSaldo = Math.max(0, Math.round((emp.saldo_devedor - amortizacao) * 100) / 100)

  const novoValorPago = emp.valor_pago + emp.valor_parcela
  const status = novasParcelas >= emp.numero_parcelas ? 'quitado' : 'ativo'

  await c.env.DB.prepare('UPDATE emprestimos SET parcelas_pagas=?, saldo_devedor=?, valor_pago=?, status=? WHERE id=? AND user_id=?').bind(novasParcelas, novoSaldo, novoValorPago, status, id, user.id).run()

  // Marcar a despesa correspondente como paga (se existir)
  const parcelaNum = novasParcelas
  await c.env.DB.prepare(
    `UPDATE despesas SET status='pago' WHERE user_id=? AND categoria='Empréstimo' AND parcela_atual=? AND status='pendente' AND observacoes LIKE ?`
  ).bind(user.id, parcelaNum, `%Empréstimo automático #${id}%`).run()

  if (status === 'quitado') {
    await verificarConquista(c.env.DB, user.id, 'sem_dividas')
    if (emp.tipo === 'veiculo') await verificarConquista(c.env.DB, user.id, 'carro_quitado')
  }

  return c.json({ 
    success: true, 
    parcelas_pagas: novasParcelas, 
    saldo_devedor: novoSaldo, 
    juros_pagos: Math.round(jurosMes * 100) / 100,
    amortizacao: Math.round(amortizacao * 100) / 100,
    status, 
    message: status === 'quitado' ? '🎉 Empréstimo quitado!' : `Parcela ${novasParcelas}/${emp.numero_parcelas} paga! Saldo: R$ ${novoSaldo.toFixed(2)}` 
  })
})

// DELETE /api/emprestimos/:id — cascade: apaga todas as despesas pendentes vinculadas
emprestimos.delete('/:id', requireAuth, async (c) => {
  const user = c.get('user')
  const id = c.req.param('id')

  // Verifica existência antes de apagar
  const existing = await c.env.DB.prepare('SELECT id FROM emprestimos WHERE id = ? AND user_id = ?').bind(id, user.id).first()
  if (!existing) return c.json({ error: 'Empréstimo não encontrado' }, 404)

  // Remove todas as despesas vinculadas (pagas e pendentes) com observacao referenciando este empréstimo
  await c.env.DB.prepare(
    `DELETE FROM despesas WHERE user_id = ? AND categoria = 'Empréstimo' AND observacoes LIKE ?`
  ).bind(user.id, `%Empréstimo automático #${id}%`).run()

  // Remove o empréstimo
  await c.env.DB.prepare('DELETE FROM emprestimos WHERE id = ? AND user_id = ?').bind(id, user.id).run()

  return c.json({ success: true, message: 'Empréstimo e parcelas removidos!' })
})

/**
 * calcSaldo: usado apenas quando o usuário NÃO informa o saldo_devedor_atual.
 * Calcula o saldo devedor com base na fórmula Price.
 */
function calcSaldo(valorOriginal: number, taxaMensal: number, numParcelas: number, parcelasPagas: number): number {
  if (taxaMensal === 0) return Math.max(0, valorOriginal * (1 - parcelasPagas / numParcelas))
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
