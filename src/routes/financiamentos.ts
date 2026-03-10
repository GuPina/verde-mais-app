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
    descricao, tipo_imovel = 'residencial', tipo_bem = 'imovel', valor_imovel, valor_financiado, valor_entrada = 0,
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
    `INSERT INTO financiamentos (user_id, descricao, tipo_imovel, tipo_bem, valor_imovel, valor_financiado, valor_entrada, taxa_juros_anual, taxa_juros_mensal, numero_parcelas, parcelas_pagas, valor_parcela, saldo_devedor, data_inicio, data_previsao_fim, sistema_amortizacao, banco, contrato, indexador, observacoes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(user.id, descricao, tipo_imovel, tipo_bem, parseFloat(valor_imovel), parseFloat(valor_financiado), parseFloat(valor_entrada), parseFloat(taxa_juros_anual), taxaMensal * 100, parseInt(numero_parcelas), parseInt(parcelas_pagas), parseFloat(valor_parcela), saldoDevedor, data_inicio, dataFim.toISOString().split('T')[0], sistema_amortizacao, banco || null, contrato || null, indexador, observacoes || null).run()

  const finId = result.meta.last_row_id as number

  // === Criar despesas automáticas das parcelas futuras ===
  const parcelasPagasN = parseInt(parcelas_pagas)
  const totalParcelasN = parseInt(numero_parcelas)
  const valorParcelaN = parseFloat(valor_parcela)

  for (let i = parcelasPagasN; i < totalParcelasN; i++) {
    const dataParc = new Date(dataInicio)
    dataParc.setMonth(dataParc.getMonth() + i)
    const dataParcStr = dataParc.toISOString().split('T')[0]
    await c.env.DB.prepare(
      `INSERT INTO despesas (user_id, descricao, data, categoria, valor, parcelado, numero_parcelas, parcela_atual, status, fixa_ou_variavel, recorrente, vencimento, observacoes, meio_pagamento)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      user.id,
      `${descricao} (${i + 1}/${totalParcelasN})`,
      dataParcStr,
      'Financiamento',
      valorParcelaN,
      1, totalParcelasN, i + 1,
      i < parcelasPagasN ? 'pago' : 'pendente',
      'fixa', 0,
      dataParcStr,
      `Financiamento automático #${finId} — ${banco || tipo_imovel}`,
      'transferencia'
    ).run()
  }

  await verificarConquista(c.env.DB, user.id, 'planejador')
  // Conquista: primeiro imóvel
  const tipoBem = body.tipo_bem || 'imovel'
  if (tipoBem === 'imovel' || tipoBem === 'imovel_comercial') await verificarConquista(c.env.DB, user.id, 'primeiro_imovel')
  if (tipoBem === 'veiculo') await verificarConquista(c.env.DB, user.id, 'financiamento_veiculo')
  if (tipoBem === 'outros' || tipoBem === 'rural') await verificarConquista(c.env.DB, user.id, 'financiamento_outros')
  return c.json({ success: true, id: finId, message: 'Financiamento cadastrado e despesas criadas automaticamente!' }, 201)
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

  // Recalcular data_previsao_fim
  const dataInicioPut = new Date(data_inicio)
  const dataFimPut = new Date(dataInicioPut)
  dataFimPut.setMonth(dataFimPut.getMonth() + parseInt(numero_parcelas))

  await c.env.DB.prepare(
    `UPDATE financiamentos SET descricao=?, tipo_imovel=?, valor_imovel=?, valor_financiado=?, valor_entrada=?, taxa_juros_anual=?, taxa_juros_mensal=?, numero_parcelas=?, parcelas_pagas=?, valor_parcela=?, saldo_devedor=?, data_inicio=?, data_previsao_fim=?, banco=?, contrato=?, sistema_amortizacao=?, indexador=?, status=?, observacoes=? WHERE id=? AND user_id=?`
  ).bind(descricao, tipo_imovel, parseFloat(valor_imovel), parseFloat(valor_financiado), parseFloat(valor_entrada), parseFloat(taxa_juros_anual), taxaMensal * 100, parseInt(numero_parcelas), parseInt(parcelas_pagas), parseFloat(valor_parcela), saldoDevedor, data_inicio, dataFimPut.toISOString().split('T')[0], banco || null, contrato || null, sistema_amortizacao, indexador, status || 'ativo', observacoes || null, id, user.id).run()

  if (status === 'quitado') {
    await verificarConquista(c.env.DB, user.id, 'sem_dividas')
    // sem_dividas_total
    const aindaTemDividas = await c.env.DB.prepare(
      `SELECT COUNT(*) as total FROM (
        SELECT id FROM emprestimos WHERE user_id=? AND status='ativo'
        UNION ALL
        SELECT id FROM financiamentos WHERE user_id=? AND status='ativo'
      )`
    ).bind(user.id, user.id).first() as any
    if ((aindaTemDividas?.total || 0) === 0) await verificarConquista(c.env.DB, user.id, 'sem_dividas_total')
  }
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

  // CÁLCULO CORRETO: juros do mês sobre saldo_devedor atual, amortiza a diferença
  const jurosMes = fin.saldo_devedor * taxaMensal
  const amortizacao = fin.valor_parcela - jurosMes
  const novoSaldo = Math.max(0, Math.round((fin.saldo_devedor - amortizacao) * 100) / 100)
  const status = novasParcelas >= fin.numero_parcelas ? 'quitado' : 'ativo'

  await c.env.DB.prepare('UPDATE financiamentos SET parcelas_pagas = ?, saldo_devedor = ?, status = ? WHERE id = ? AND user_id = ?').bind(novasParcelas, novoSaldo, status, id, user.id).run()

  // Marcar despesa correspondente como paga (se existir)
  await c.env.DB.prepare(
    `UPDATE despesas SET status='pago' WHERE user_id=? AND categoria='Financiamento' AND parcela_atual=? AND status='pendente' AND observacoes LIKE ?`
  ).bind(user.id, novasParcelas, `%Financiamento automático #${id}%`).run()

  if (status === 'quitado') await verificarConquista(c.env.DB, user.id, 'sem_dividas')

  // Verificar conquistas de % quitado do financiamento
  const percQuitado = fin.numero_parcelas > 0 ? Math.round((novasParcelas / fin.numero_parcelas) * 100) : 0
  if (percQuitado >= 10) await verificarConquista(c.env.DB, user.id, 'quitou_10pct')
  if (percQuitado >= 15) await verificarConquista(c.env.DB, user.id, 'quitou_15pct')
  if (percQuitado >= 20) await verificarConquista(c.env.DB, user.id, 'quitou_20pct')
  if (percQuitado >= 30) await verificarConquista(c.env.DB, user.id, 'quitou_30pct')
  if (percQuitado >= 50) await verificarConquista(c.env.DB, user.id, 'quitou_50pct')
  if (status === 'quitado') await verificarConquista(c.env.DB, user.id, 'imovel_quitado')

  return c.json({ 
    success: true, 
    parcelas_pagas: novasParcelas, 
    saldo_devedor: novoSaldo, 
    juros_pagos: Math.round(jurosMes * 100) / 100,
    amortizacao: Math.round(amortizacao * 100) / 100,
    status, 
    message: status === 'quitado' ? '🎉 Financiamento quitado!' : `Parcela ${novasParcelas}/${fin.numero_parcelas} paga! Saldo: R$ ${novoSaldo.toFixed(2)}` 
  })
})

// PATCH /api/financiamentos/:id/amortizacao — amortização extraordinária
financiamentos.patch('/:id/amortizacao', requireAuth, async (c) => {
  const user = c.get('user')
  const id = c.req.param('id')
  const fin = await c.env.DB.prepare('SELECT * FROM financiamentos WHERE id = ? AND user_id = ?').bind(id, user.id).first() as any
  if (!fin) return c.json({ error: 'Financiamento não encontrado' }, 404)

  const { valor_amortizado, novo_saldo, parcelas_antecipadas = 0, observacoes } = await c.req.json()
  if (!valor_amortizado || novo_saldo === undefined) return c.json({ error: 'valor_amortizado e novo_saldo são obrigatórios' }, 400)

  const novasPorAntecipacao = Math.max(0, parseInt(parcelas_antecipadas))
  const novasParcelas = Math.min(fin.numero_parcelas, fin.parcelas_pagas + novasPorAntecipacao)
  const novoSaldoVal = Math.max(0, parseFloat(novo_saldo))
  const status = novoSaldoVal <= 0 || novasParcelas >= fin.numero_parcelas ? 'quitado' : 'ativo'

  await c.env.DB.prepare(
    'UPDATE financiamentos SET saldo_devedor=?, parcelas_pagas=?, status=? WHERE id=? AND user_id=?'
  ).bind(novoSaldoVal, novasParcelas, status, id, user.id).run()

  // Registrar como despesa
  const hoje = new Date().toISOString().split('T')[0]
  await c.env.DB.prepare(
    `INSERT INTO despesas (user_id, descricao, data, categoria, valor, status, fixa_ou_variavel, observacoes, meio_pagamento)
     VALUES (?, ?, ?, ?, ?, 'pago', 'variavel', ?, 'transferencia')`
  ).bind(user.id, `Amortização Extraordinária — ${fin.descricao}`, hoje, 'Financiamento', parseFloat(valor_amortizado), observacoes || `Amortização de R$${valor_amortizado} no financiamento #${id}`).run()

  // Marcar parcelas antecipadas como pagas
  if (novasPorAntecipacao > 0) {
    for (let p = fin.parcelas_pagas + 1; p <= novasParcelas; p++) {
      await c.env.DB.prepare(
        `UPDATE despesas SET status='pago' WHERE user_id=? AND categoria='Financiamento' AND parcela_atual=? AND status='pendente' AND observacoes LIKE ?`
      ).bind(user.id, p, `%Financiamento automático #${id}%`).run()
    }
  }

  if (status === 'quitado') {
    await verificarConquista(c.env.DB, user.id, 'sem_dividas')
    await verificarConquista(c.env.DB, user.id, 'imovel_quitado')
  }
  await verificarConquista(c.env.DB, user.id, 'amortizou')
  const percQuitado = fin.numero_parcelas > 0 ? Math.round((novasParcelas / fin.numero_parcelas) * 100) : 0
  if (percQuitado >= 10) await verificarConquista(c.env.DB, user.id, 'quitou_10pct')
  if (percQuitado >= 20) await verificarConquista(c.env.DB, user.id, 'quitou_20pct')
  if (percQuitado >= 30) await verificarConquista(c.env.DB, user.id, 'quitou_30pct')

  return c.json({
    success: true,
    novo_saldo: novoSaldoVal,
    parcelas_pagas: novasParcelas,
    status,
    message: status === 'quitado' ? '🎉 Financiamento quitado!' : `⚡ Amortização aplicada! Novo saldo: R$${novoSaldoVal.toFixed(2)}`
  })
})

// DELETE /api/financiamentos/:id — cascade: apaga parcelas de entrada e despesas vinculadas
financiamentos.delete('/:id', requireAuth, async (c) => {
  const user = c.get('user')
  const id = c.req.param('id')

  const existing = await c.env.DB.prepare('SELECT id FROM financiamentos WHERE id = ? AND user_id = ?').bind(id, user.id).first()
  if (!existing) return c.json({ error: 'Financiamento não encontrado' }, 404)

  // Remove despesas automáticas vinculadas (todas, pagas ou pendentes)
  await c.env.DB.prepare(
    `DELETE FROM despesas WHERE user_id = ? AND categoria = 'Financiamento' AND observacoes LIKE ?`
  ).bind(user.id, `%Financiamento automático #${id}%`).run()

  // Remove parcelas de entrada vinculadas
  await c.env.DB.prepare(
    'DELETE FROM financiamento_entrada_parcelas WHERE financiamento_id = ? AND user_id = ?'
  ).bind(id, user.id).run()

  // Remove o financiamento
  await c.env.DB.prepare('DELETE FROM financiamentos WHERE id = ? AND user_id = ?').bind(id, user.id).run()

  return c.json({ success: true, message: 'Financiamento e parcelas removidos!' })
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
    await db.prepare('INSERT OR IGNORE INTO conquistas_usuario (user_id, conquista_codigo, visualizado) VALUES (?, ?, 0)').bind(userId, codigo).run()
  } catch { }
}

// ============ PARCELAS DE ENTRADA ============

// GET /api/financiamentos/:id/entrada
financiamentos.get('/:id/entrada', requireAuth, async (c) => {
  const user = c.get('user')
  const id = c.req.param('id')
  const fin = await c.env.DB.prepare('SELECT id FROM financiamentos WHERE id = ? AND user_id = ?').bind(id, user.id).first()
  if (!fin) return c.json({ error: 'Financiamento não encontrado' }, 404)

  const parcelas = await c.env.DB.prepare(
    'SELECT * FROM financiamento_entrada_parcelas WHERE financiamento_id = ? AND user_id = ? ORDER BY numero ASC'
  ).bind(id, user.id).all()

  const total = (parcelas.results as any[]).reduce((s, p) => s + p.valor, 0)
  const totalPago = (parcelas.results as any[]).filter(p => p.status === 'pago').reduce((s, p) => s + p.valor, 0)

  return c.json({ 
    parcelas: parcelas.results, 
    resumo: { total, total_pago: totalPago, total_pendente: total - totalPago } 
  })
})

// POST /api/financiamentos/:id/entrada — adicionar parcela de entrada
financiamentos.post('/:id/entrada', requireAuth, async (c) => {
  const user = c.get('user')
  const id = c.req.param('id')
  const fin = await c.env.DB.prepare('SELECT id FROM financiamentos WHERE id = ? AND user_id = ?').bind(id, user.id).first()
  if (!fin) return c.json({ error: 'Financiamento não encontrado' }, 404)

  const body = await c.req.json()
  const { numero, valor, vencimento, observacoes } = body
  if (!numero || !valor || !vencimento) return c.json({ error: 'Campos obrigatórios: numero, valor, vencimento' }, 400)

  const result = await c.env.DB.prepare(
    'INSERT INTO financiamento_entrada_parcelas (user_id, financiamento_id, numero, valor, vencimento, observacoes) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(user.id, id, parseInt(numero), parseFloat(valor), vencimento, observacoes || null).run()

  return c.json({ success: true, id: result.meta.last_row_id, message: 'Parcela de entrada adicionada!' }, 201)
})

// PATCH /api/financiamentos/entrada/:id/status — marcar parcela de entrada como paga
financiamentos.patch('/entrada/:parcelaId/status', requireAuth, async (c) => {
  const user = c.get('user')
  const parcelaId = c.req.param('parcelaId')
  const { status, data_pagamento } = await c.req.json()

  const parcela = await c.env.DB.prepare('SELECT * FROM financiamento_entrada_parcelas WHERE id = ? AND user_id = ?').bind(parcelaId, user.id).first() as any
  if (!parcela) return c.json({ error: 'Parcela não encontrada' }, 404)

  await c.env.DB.prepare(
    'UPDATE financiamento_entrada_parcelas SET status = ?, data_pagamento = ? WHERE id = ? AND user_id = ?'
  ).bind(status, data_pagamento || null, parcelaId, user.id).run()

  return c.json({ success: true, message: `Parcela marcada como ${status}!` })
})

// DELETE /api/financiamentos/entrada/:id — remover parcela de entrada
financiamentos.delete('/entrada/:parcelaId', requireAuth, async (c) => {
  const user = c.get('user')
  const parcelaId = c.req.param('parcelaId')
  await c.env.DB.prepare('DELETE FROM financiamento_entrada_parcelas WHERE id = ? AND user_id = ?').bind(parcelaId, user.id).run()
  return c.json({ success: true, message: 'Parcela removida!' })
})

// PATCH /api/financiamentos/:id/evolucao — atualizar % de evolução de obra
financiamentos.patch('/:id/evolucao', requireAuth, async (c) => {
  const user = c.get('user')
  const id = c.req.param('id')
  const { evolucao_obra_pct } = await c.req.json()

  const fin = await c.env.DB.prepare('SELECT id FROM financiamentos WHERE id = ? AND user_id = ?').bind(id, user.id).first()
  if (!fin) return c.json({ error: 'Financiamento não encontrado' }, 404)

  const pct = Math.min(100, Math.max(0, parseFloat(evolucao_obra_pct) || 0))
  await c.env.DB.prepare('UPDATE financiamentos SET evolucao_obra_pct = ? WHERE id = ? AND user_id = ?').bind(pct, id, user.id).run()

  return c.json({ success: true, evolucao_obra_pct: pct, message: `Evolução de obra atualizada para ${pct}%!` })
})

export default financiamentos
