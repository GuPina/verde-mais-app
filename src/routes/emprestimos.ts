import { Hono } from 'hono'
import { requireAuth } from './auth'
import { getLimites, MSG_UPGRADE } from './planos'

type Bindings = { DB: D1Database }
type Variables = { user: { id: number; nome: string; email: string; plano: string } }

const emprestimos = new Hono<{ Bindings: Bindings; Variables: Variables }>()

// ─── S-E1: GET /api/emprestimos/resumo ───────────────────────────────────────
emprestimos.get('/resumo', requireAuth, async (c) => {
  const user = c.get('user')
  const result = await c.env.DB.prepare(
    'SELECT * FROM emprestimos WHERE user_id = ? ORDER BY data_criacao DESC'
  ).bind(user.id).all()

  const list = result.results as any[]
  const ativos = list.filter(e => e.status === 'ativo')
  const quitados = list.filter(e => e.status === 'quitado')

  // Agrupar por tipo com CET anualizado
  const grupos: Record<string, any> = {}
  for (const e of list) {
    const tipo = e.tipo || 'outros'
    if (!grupos[tipo]) grupos[tipo] = { tipo, count: 0, saldo_total: 0, parcela_mensal: 0 }
    grupos[tipo].count++
    if (e.status === 'ativo') {
      grupos[tipo].saldo_total += e.saldo_devedor
      grupos[tipo].parcela_mensal += e.valor_parcela
    }
  }

  // CET médio ponderado dos empréstimos ativos
  const totalSaldoAtivo = ativos.reduce((s, e) => s + e.saldo_devedor, 0)
  let cetMedioPonderado = 0
  if (totalSaldoAtivo > 0) {
    cetMedioPonderado = ativos.reduce((acc, e) => {
      const cetAnual = (Math.pow(1 + e.taxa_juros_mensal / 100, 12) - 1) * 100
      return acc + cetAnual * (e.saldo_devedor / totalSaldoAtivo)
    }, 0)
  }

  // Maior CET entre empréstimos ativos (candidato a quitação prioritária)
  const maiorCet = ativos.length > 0
    ? ativos.reduce((max, e) => e.taxa_juros_mensal > max.taxa_juros_mensal ? e : max, ativos[0])
    : null

  return c.json({
    resumo_por_tipo: Object.values(grupos).map(g => ({
      ...g,
      saldo_total: Math.round(g.saldo_total * 100) / 100,
      parcela_mensal: Math.round(g.parcela_mensal * 100) / 100
    })),
    totais: {
      total_emprestimos: list.length,
      ativos: ativos.length,
      quitados: quitados.length,
      saldo_devedor_total: Math.round(totalSaldoAtivo * 100) / 100,
      comprometimento_mensal: Math.round(ativos.reduce((s, e) => s + e.valor_parcela, 0) * 100) / 100,
      cet_medio_ponderado_anual: Math.round(cetMedioPonderado * 100) / 100
    },
    prioridade_quitacao: maiorCet ? {
      id: maiorCet.id,
      descricao: maiorCet.descricao,
      taxa_mensal: maiorCet.taxa_juros_mensal,
      cet_anual: Math.round((Math.pow(1 + maiorCet.taxa_juros_mensal / 100, 12) - 1) * 10000) / 100,
      saldo_devedor: maiorCet.saldo_devedor,
      motivo: 'Maior custo efetivo total — quitação reduz mais juros'
    } : null
  })
})

// ─── S-E2: PATCH /api/emprestimos/:id/quitado ────────────────────────────────
emprestimos.patch('/:id/quitado', requireAuth, async (c) => {
  const user = c.get('user')
  const id = c.req.param('id')
  const emp = await c.env.DB.prepare(
    'SELECT * FROM emprestimos WHERE id = ? AND user_id = ?'
  ).bind(id, user.id).first() as any
  if (!emp) return c.json({ error: 'Empréstimo não encontrado' }, 404)
  if (emp.status === 'quitado') return c.json({ error: 'Empréstimo já está quitado' }, 400)

  const body = await c.req.json().catch(() => ({})) as any
  const observacoes = body?.observacoes || 'Quitação antecipada'
  const hoje = new Date().toISOString().split('T')[0]

  await c.env.DB.prepare(
    'UPDATE emprestimos SET status=?, saldo_devedor=0, parcelas_pagas=numero_parcelas, valor_pago=valor_original, observacoes=? WHERE id=? AND user_id=?'
  ).bind('quitado', observacoes, id, user.id).run()

  // Marcar todas as despesas pendentes como pagas
  await c.env.DB.prepare(
    `UPDATE despesas SET status='pago', data=? WHERE user_id=? AND categoria='Empréstimo' AND status='pendente' AND observacoes LIKE ?`
  ).bind(hoje, user.id, `%Empréstimo automático #${id}%`).run()

  await verificarConquista(c.env.DB, user.id, 'sem_dividas')
  if (emp.tipo === 'veiculo') await verificarConquista(c.env.DB, user.id, 'carro_quitado')

  const aindaTemDividas = await c.env.DB.prepare(
    `SELECT COUNT(*) as total FROM (
      SELECT id FROM emprestimos WHERE user_id=? AND status='ativo'
      UNION ALL SELECT id FROM financiamentos WHERE user_id=? AND status='ativo'
    )`
  ).bind(user.id, user.id).first() as any
  if ((aindaTemDividas?.total || 0) === 0) await verificarConquista(c.env.DB, user.id, 'sem_dividas_total')

  return c.json({
    success: true,
    message: `🎉 Empréstimo "${emp.descricao}" quitado com sucesso!`,
    economia_estimada: Math.round((emp.valor_parcela * (emp.numero_parcelas - emp.parcelas_pagas) - emp.saldo_devedor) * 100) / 100
  })
})

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

  // ── Limite de plano ──
  const lim = getLimites(user.plano)
  if (lim.emprestimos !== Infinity) {
    const count = await c.env.DB.prepare('SELECT COUNT(*) as n FROM emprestimos WHERE user_id = ? AND status = \'ativo\'').bind(user.id).first() as any
    if ((count?.n || 0) >= lim.emprestimos)
      return c.json({ error: MSG_UPGRADE.emprestimos, upgrade: true, limite: lim.emprestimos, feature: 'emprestimos' }, 403)
  }

  const body = await c.req.json()
  const {
    descricao, tipo = 'pessoal', valor_original, saldo_devedor: saldoInformado,
    taxa_juros_mensal, numero_parcelas,
    parcelas_pagas = 0, valor_parcela, data_inicio, data_primeira_parcela,
    dia_vencimento, credor, observacoes
  } = body

  if (!descricao || !valor_original || !taxa_juros_mensal || !numero_parcelas || !valor_parcela || !data_inicio)
    return c.json({ error: 'Campos obrigatórios faltando' }, 400)

  // Normalizar tipo — garantir que só valores válidos do CHECK constraint sejam inseridos
  const TIPOS_VALIDOS = ['pessoal', 'consignado', 'veiculo', 'estudantil', 'microempresa', 'amigos_familia', 'imovel', 'imovel_comercial', 'rural', 'outros']
  const tipoNormalizado = TIPOS_VALIDOS.includes(tipo) ? tipo : 'outros'

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
  ).bind(user.id, descricao, tipoNormalizado, parseFloat(valor_original), parseFloat(valor_parcela) * parcelasPagasN, saldoDevedor, parseFloat(taxa_juros_mensal), Math.round(taxaA * 100) / 100, parseInt(numero_parcelas), parcelasPagasN, parseFloat(valor_parcela), data_inicio, dataFim.toISOString().split('T')[0], parseInt(dia_vencimento) || null, credor || null, observacoes || null).run()

  const empId = result.meta.last_row_id as number

  // Conquistas por tipo
  if (tipo === 'veiculo') await verificarConquista(c.env.DB, user.id, 'primeiro_carro')
  const totalParcelas = parseInt(numero_parcelas)
  const valorParc = parseFloat(valor_parcela)
  const diaVenc = parseInt(dia_vencimento) || dataInicio.getDate()

  // Referência para datas das parcelas:
  let dataPrimeiraRef: Date
  if (data_primeira_parcela) {
    dataPrimeiraRef = new Date(data_primeira_parcela + 'T12:00:00')
  } else {
    dataPrimeiraRef = new Date(dataInicio.getFullYear(), dataInicio.getMonth(), diaVenc)
    if (dataPrimeiraRef <= dataInicio) {
      dataPrimeiraRef.setMonth(dataPrimeiraRef.getMonth() + 1)
    }
  }

  // Inserir despesas em batch para evitar timeout
  const LOTE = 100
  for (let base = parcelasPagasN; base < totalParcelas; base += LOTE) {
    const stmts = []
    for (let i = base; i < Math.min(base + LOTE, totalParcelas); i++) {
      const dataParc = new Date(dataPrimeiraRef)
      dataParc.setMonth(dataPrimeiraRef.getMonth() + (i - parcelasPagasN))
      const maxDia = new Date(dataParc.getFullYear(), dataParc.getMonth() + 1, 0).getDate()
      dataParc.setDate(Math.min(diaVenc, maxDia))
      const dataParcStr = dataParc.toISOString().split('T')[0]
      stmts.push(
        c.env.DB.prepare(
          `INSERT INTO despesas (user_id, descricao, data, categoria, valor, parcelado, numero_parcelas, parcela_atual, status, fixa_ou_variavel, recorrente, vencimento, observacoes, meio_pagamento)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(
          user.id,
          `${descricao} (${i + 1}/${totalParcelas})`,
          dataParcStr,
          'Empréstimo',
          valorParc,
          1, totalParcelas, i + 1,
          'pendente',
          'fixa', 0,
          dataParcStr,
          `Empréstimo automático #${empId} — ${credor || tipo}`,
          'transferencia'
        )
      )
    }
    await c.env.DB.batch(stmts)
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
  const { descricao, tipo: tipoPut, valor_original, saldo_devedor: saldoInformado, taxa_juros_mensal, numero_parcelas, parcelas_pagas, valor_parcela, data_inicio, dia_vencimento, credor, status, observacoes } = body

  // Normalizar tipo no PUT também
  const TIPOS_VALIDOS_PUT = ['pessoal', 'consignado', 'veiculo', 'estudantil', 'microempresa', 'amigos_familia', 'imovel', 'imovel_comercial', 'rural', 'outros']
  const tipoNormalizadoPut = TIPOS_VALIDOS_PUT.includes(tipoPut) ? tipoPut : 'outros'

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

  // Recalcular data_previsao_fim
  const dataInicioPut = new Date(data_inicio)
  const dataFimPut = new Date(dataInicioPut)
  dataFimPut.setMonth(dataFimPut.getMonth() + parseInt(numero_parcelas))

  await c.env.DB.prepare(
    `UPDATE emprestimos SET descricao=?, tipo=?, valor_original=?, valor_pago=?, saldo_devedor=?, taxa_juros_mensal=?, taxa_juros_anual=?, numero_parcelas=?, parcelas_pagas=?, valor_parcela=?, data_inicio=?, data_previsao_fim=?, dia_vencimento=?, credor=?, status=?, observacoes=? WHERE id=? AND user_id=?`
  ).bind(descricao, tipoNormalizadoPut, parseFloat(valor_original), valorPago, saldoDevedor, parseFloat(taxa_juros_mensal), Math.round(taxaA * 100) / 100, parseInt(numero_parcelas), parcelasPagasN, parseFloat(valor_parcela), data_inicio, dataFimPut.toISOString().split('T')[0], parseInt(dia_vencimento) || null, credor || null, status || 'ativo', observacoes || null, id, user.id).run()

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
    // sem_dividas_total: verifica se ainda há dívidas ativas
    const aindaTemDividas = await c.env.DB.prepare(
      `SELECT COUNT(*) as total FROM (
        SELECT id FROM emprestimos WHERE user_id=? AND status='ativo'
        UNION ALL
        SELECT id FROM financiamentos WHERE user_id=? AND status='ativo'
      )`
    ).bind(user.id, user.id).first() as any
    if ((aindaTemDividas?.total || 0) === 0) await verificarConquista(c.env.DB, user.id, 'sem_dividas_total')
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

// PATCH /api/emprestimos/:id/amortizacao — amortização extraordinária
emprestimos.patch('/:id/amortizacao', requireAuth, async (c) => {
  const user = c.get('user')
  const id = c.req.param('id')
  const emp = await c.env.DB.prepare('SELECT * FROM emprestimos WHERE id = ? AND user_id = ?').bind(id, user.id).first() as any
  if (!emp) return c.json({ error: 'Empréstimo não encontrado' }, 404)

  const { valor_amortizado, novo_saldo, parcelas_antecipadas = 0, observacoes } = await c.req.json()
  if (!valor_amortizado || novo_saldo === undefined) return c.json({ error: 'valor_amortizado e novo_saldo são obrigatórios' }, 400)

  const novasPagasPorAntecipacao = Math.max(0, parseInt(parcelas_antecipadas))
  const novasParcelas = Math.min(emp.numero_parcelas, emp.parcelas_pagas + novasPagasPorAntecipacao)
  const novoSaldoVal = Math.max(0, parseFloat(novo_saldo))
  const novoValorPago = emp.valor_pago + parseFloat(valor_amortizado)
  const status = novoSaldoVal <= 0 || novasParcelas >= emp.numero_parcelas ? 'quitado' : 'ativo'

  await c.env.DB.prepare(
    'UPDATE emprestimos SET saldo_devedor=?, valor_pago=?, parcelas_pagas=?, status=? WHERE id=? AND user_id=?'
  ).bind(novoSaldoVal, novoValorPago, novasParcelas, status, id, user.id).run()

  // Registrar na tabela de despesas como pagamento extra
  const hoje = new Date().toISOString().split('T')[0]
  await c.env.DB.prepare(
    `INSERT INTO despesas (user_id, descricao, data, categoria, valor, status, fixa_ou_variavel, observacoes, meio_pagamento)
     VALUES (?, ?, ?, ?, ?, 'pago', 'variavel', ?, 'transferencia')`
  ).bind(user.id, `Amortização Extraordinária — ${emp.descricao}`, hoje, 'Empréstimo', parseFloat(valor_amortizado), observacoes || `Amortização de R$${valor_amortizado} no empréstimo #${id}`).run()

  // Marcar parcelas antecipadas como pagas nas despesas
  if (novasPagasPorAntecipacao > 0) {
    for (let p = emp.parcelas_pagas + 1; p <= novasParcelas; p++) {
      await c.env.DB.prepare(
        `UPDATE despesas SET status='pago' WHERE user_id=? AND categoria='Empréstimo' AND parcela_atual=? AND status='pendente' AND observacoes LIKE ?`
      ).bind(user.id, p, `%Empréstimo automático #${id}%`).run()
    }
  }

  if (status === 'quitado') await verificarConquista(c.env.DB, user.id, 'sem_dividas')
  await verificarConquista(c.env.DB, user.id, 'amortizou')

  return c.json({
    success: true,
    novo_saldo: novoSaldoVal,
    parcelas_pagas: novasParcelas,
    status,
    message: status === 'quitado' ? '🎉 Empréstimo quitado!' : `⚡ Amortização de R$${parseFloat(valor_amortizado).toFixed(2)} aplicada! Novo saldo: R$${novoSaldoVal.toFixed(2)}`
  })
})

// GET /api/emprestimos/:id/simulacao — simula cenários de pagamento antecipado
emprestimos.get('/:id/simulacao', requireAuth, async (c) => {
  const user = c.get('user')
  const id = c.req.param('id')

  const emp = await c.env.DB.prepare(
    'SELECT * FROM emprestimos WHERE id = ? AND user_id = ?'
  ).bind(id, user.id).first() as any

  if (!emp) return c.json({ error: 'Empréstimo não encontrado' }, 404)

  const saldo = emp.saldo_devedor || 0
  const taxaMensal = emp.taxa_juros_mensal / 100
  const parcelasRestantes = emp.numero_parcelas - emp.parcelas_pagas
  const valorParcela = emp.valor_parcela

  // Calcular total a pagar no ritmo atual
  const totalAtual = valorParcela * parcelasRestantes
  const jurosAtual = totalAtual - saldo

  // Simular amortização extra de 10%, 20%, 30% do saldo
  const cenarios = [10, 20, 30].map(pct => {
    const extra = Math.round(saldo * pct / 100 * 100) / 100
    const novoSaldo = Math.max(0, saldo - extra)
    if (novoSaldo <= 0) return { pct, extra, parcelas_economizadas: parcelasRestantes, economia: jurosAtual, novo_saldo: 0 }

    // Calcular nova parcela com SAC simplificado
    let novasParcelas = parcelasRestantes
    let saldoCalc = novoSaldo
    let totalJurosNovo = 0
    for (let i = 0; i < parcelasRestantes; i++) {
      const jMes = saldoCalc * taxaMensal
      totalJurosNovo += jMes
      saldoCalc = saldoCalc - (valorParcela - jMes)
      if (saldoCalc <= 0) { novasParcelas = i + 1; break }
    }

    return {
      pct,
      extra,
      novo_saldo: Math.round(novoSaldo * 100) / 100,
      parcelas_economizadas: parcelasRestantes - novasParcelas,
      economia_juros: Math.round((jurosAtual - totalJurosNovo) * 100) / 100
    }
  })

  return c.json({
    emprestimo_id: emp.id,
    saldo_atual: saldo,
    taxa_mensal: emp.taxa_juros_mensal,
    parcelas_restantes: parcelasRestantes,
    valor_parcela: valorParcela,
    total_a_pagar: Math.round(totalAtual * 100) / 100,
    juros_projetados: Math.round(jurosAtual * 100) / 100,
    cenarios_amortizacao: cenarios
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
    await db.prepare('INSERT OR IGNORE INTO conquistas_usuario (user_id, conquista_codigo, visualizado) VALUES (?, ?, 0)').bind(userId, codigo).run()
  } catch { }
}

export default emprestimos
