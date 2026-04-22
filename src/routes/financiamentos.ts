import { Hono } from 'hono'
import { requireAuth } from './auth'
import { getLimites, MSG_UPGRADE } from './planos'
import { ensureTag, tagDespesa, COR_MODULO } from '../utils/tags-helper'

type Bindings = { DB: D1Database }
type Variables = { user: { id: number; nome: string; email: string; plano: string } }

const financiamentos = new Hono<{ Bindings: Bindings; Variables: Variables }>()

// ─── S-F1: GET /api/financiamentos/resumo ────────────────────────────────────
financiamentos.get('/resumo', requireAuth, async (c) => {
  const user = c.get('user')
  const result = await c.env.DB.prepare(
    'SELECT * FROM financiamentos WHERE user_id = ? ORDER BY data_criacao DESC'
  ).bind(user.id).all()

  const list = result.results as any[]

  // Agrupar por tipo_bem
  const grupos: Record<string, any> = {}
  for (const f of list) {
    const tipo = f.tipo_bem || 'outros'
    if (!grupos[tipo]) grupos[tipo] = { tipo, count: 0, saldo_total: 0, parcela_mensal: 0, quitados: 0, ativos: 0 }
    grupos[tipo].count++
    if (f.status === 'ativo') {
      grupos[tipo].saldo_total += f.saldo_devedor
      grupos[tipo].parcela_mensal += f.valor_parcela
      grupos[tipo].ativos++
    } else {
      grupos[tipo].quitados++
    }
  }

  const saldoTotal = list.filter(f => f.status === 'ativo').reduce((s, f) => s + f.saldo_devedor, 0)
  const parcelaMensal = list.filter(f => f.status === 'ativo').reduce((s, f) => s + f.valor_parcela, 0)

  return c.json({
    resumo_por_tipo: Object.values(grupos).map(g => ({
      ...g,
      saldo_total: Math.round(g.saldo_total * 100) / 100,
      parcela_mensal: Math.round(g.parcela_mensal * 100) / 100
    })),
    totais: {
      total_financiamentos: list.length,
      ativos: list.filter(f => f.status === 'ativo').length,
      quitados: list.filter(f => f.status === 'quitado').length,
      saldo_devedor_total: Math.round(saldoTotal * 100) / 100,
      comprometimento_mensal: Math.round(parcelaMensal * 100) / 100
    }
  })
})

// ─── S-F2: GET /api/financiamentos/:id/comparativo ───────────────────────────
// Compara sistema PRICE vs SAC para o financiamento existente
financiamentos.get('/:id/comparativo', requireAuth, async (c) => {
  const user = c.get('user')
  const id = c.req.param('id')
  const fin = await c.env.DB.prepare(
    'SELECT * FROM financiamentos WHERE id = ? AND user_id = ?'
  ).bind(id, user.id).first() as any
  if (!fin) return c.json({ error: 'Financiamento não encontrado' }, 404)

  const saldo = fin.saldo_devedor
  const taxaMensal = fin.taxa_juros_mensal / 100
  const parcelasRestantes = fin.numero_parcelas - fin.parcelas_pagas

  // ── PRICE: parcela fixa ──────────────────────────────────────────────────
  let totalJurosPrice = 0
  let saldoPrice = saldo
  const tabelaPrice = []
  for (let i = 1; i <= parcelasRestantes; i++) {
    const juros = saldoPrice * taxaMensal
    const parcela = fin.valor_parcela
    const amort = parcela - juros
    saldoPrice = Math.max(0, saldoPrice - amort)
    totalJurosPrice += juros
    if (i <= 6 || i === parcelasRestantes) {
      tabelaPrice.push({ parcela: fin.parcelas_pagas + i, valor: Math.round(parcela * 100) / 100, juros: Math.round(juros * 100) / 100, amort: Math.round(amort * 100) / 100, saldo: Math.round(saldoPrice * 100) / 100 })
    }
  }

  // ── SAC: amortização constante ────────────────────────────────────────────
  let totalJurosSAC = 0
  let saldoSAC = saldo
  const amortSAC = saldo / parcelasRestantes
  const tabelaSAC = []
  for (let i = 1; i <= parcelasRestantes; i++) {
    const juros = saldoSAC * taxaMensal
    const parcela = amortSAC + juros
    saldoSAC = Math.max(0, saldoSAC - amortSAC)
    totalJurosSAC += juros
    if (i <= 6 || i === parcelasRestantes) {
      tabelaSAC.push({ parcela: fin.parcelas_pagas + i, valor: Math.round(parcela * 100) / 100, juros: Math.round(juros * 100) / 100, amort: Math.round(amortSAC * 100) / 100, saldo: Math.round(saldoSAC * 100) / 100 })
    }
  }

  const economiaSAC = totalJurosPrice - totalJurosSAC

  return c.json({
    financiamento_id: fin.id,
    descricao: fin.descricao,
    saldo_devedor: saldo,
    parcelas_restantes: parcelasRestantes,
    taxa_mensal: fin.taxa_juros_mensal,
    price: {
      parcela_fixa: Math.round(fin.valor_parcela * 100) / 100,
      total_juros: Math.round(totalJurosPrice * 100) / 100,
      total_pagar: Math.round((fin.valor_parcela * parcelasRestantes) * 100) / 100,
      primeiras_parcelas: tabelaPrice.slice(0, 6)
    },
    sac: {
      primeira_parcela: tabelaSAC[0]?.valor || 0,
      ultima_parcela: tabelaSAC[tabelaSAC.length - 1]?.valor || 0,
      total_juros: Math.round(totalJurosSAC * 100) / 100,
      total_pagar: Math.round((saldo + totalJurosSAC) * 100) / 100,
      primeiras_parcelas: tabelaSAC.slice(0, 6)
    },
    economia_sac_vs_price: Math.round(economiaSAC * 100) / 100,
    recomendacao: economiaSAC > 0
      ? `SAC economiza R$ ${economiaSAC.toFixed(2)} em juros, mas exige parcelas iniciais maiores (R$ ${tabelaSAC[0]?.valor?.toFixed(2)}).`
      : `PRICE é mais vantajoso neste cenário com parcelas menores (R$ ${fin.valor_parcela.toFixed(2)}).`
  })
})

// ─── S-F4: GET /api/financiamentos/:id/tabela-amortizacao ────────────────────
// Exporta tabela completa de amortização (até 480 parcelas)
financiamentos.get('/:id/tabela-amortizacao', requireAuth, async (c) => {
  const user = c.get('user')
  const id = c.req.param('id')
  const fin = await c.env.DB.prepare(
    'SELECT * FROM financiamentos WHERE id = ? AND user_id = ?'
  ).bind(id, user.id).first() as any
  if (!fin) return c.json({ error: 'Financiamento não encontrado' }, 404)

  const taxaMensal = fin.taxa_juros_mensal / 100
  const tabela = []
  let saldo = fin.saldo_devedor
  let totalJuros = 0
  let totalAmort = 0

  for (let i = fin.parcelas_pagas + 1; i <= fin.numero_parcelas; i++) {
    const juros = saldo * taxaMensal
    const amort = fin.valor_parcela - juros
    saldo = Math.max(0, Math.round((saldo - amort) * 100) / 100)
    totalJuros += juros
    totalAmort += amort
    tabela.push({
      numero: i,
      valor_parcela: fin.valor_parcela,
      juros: Math.round(juros * 100) / 100,
      amortizacao: Math.round(amort * 100) / 100,
      saldo_devedor: saldo
    })
  }

  return c.json({
    financiamento_id: fin.id,
    descricao: fin.descricao,
    sistema: fin.sistema_amortizacao,
    parcelas_restantes: fin.numero_parcelas - fin.parcelas_pagas,
    total_juros_restantes: Math.round(totalJuros * 100) / 100,
    total_amortizacao: Math.round(totalAmort * 100) / 100,
    total_a_pagar: Math.round((totalJuros + totalAmort) * 100) / 100,
    tabela
  })
})

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
    const custoMensal = (f.valor_parcela || 0) + (f.seguro_mip || 0) + (f.seguro_dfi || 0)
    return { ...f, perc_pago: percPago, parcelas_restantes: parcelasRestantes, total_pago: totalPago, custo_total_mensal: Math.round(custoMensal * 100) / 100 }
  })

  const totalSaldo = list.reduce((s, f) => s + (f.status === 'ativo' ? f.saldo_devedor : 0), 0)
  const totalParcelas = list.reduce((s, f) => s + (f.status === 'ativo' ? f.valor_parcela : 0), 0)

  return c.json({ financiamentos: list, resumo: { total_saldo_devedor: totalSaldo, total_parcelas_mes: totalParcelas } })
})

// GET /api/financiamentos/:id — detalhe individual
financiamentos.get('/:id', requireAuth, async (c) => {
  const user = c.get('user')
  const id = c.req.param('id')

  const fin = await c.env.DB.prepare(
    'SELECT * FROM financiamentos WHERE id = ? AND user_id = ?'
  ).bind(id, user.id).first() as any

  if (!fin) return c.json({ error: 'Financiamento não encontrado' }, 404)

  const percPago = fin.numero_parcelas > 0 ? Math.round((fin.parcelas_pagas / fin.numero_parcelas) * 100) : 0
  const parcelasRestantes = fin.numero_parcelas - fin.parcelas_pagas
  const totalPago = fin.valor_parcela * fin.parcelas_pagas

  return c.json({
    ...fin,
    perc_pago: percPago,
    parcelas_restantes: parcelasRestantes,
    total_pago: Math.round(totalPago * 100) / 100
  })
})

// POST /api/financiamentos
financiamentos.post('/', requireAuth, async (c) => {
  const user = c.get('user')

  // ── Limite de plano ──
  const lim = getLimites(user.plano)
  if (lim.financiamentos !== Infinity) {
    const count = await c.env.DB.prepare('SELECT COUNT(*) as n FROM financiamentos WHERE user_id = ? AND status = \'ativo\'').bind(user.id).first() as any
    if ((count?.n || 0) >= lim.financiamentos)
      return c.json({ error: MSG_UPGRADE.financiamentos, upgrade: true, limite: lim.financiamentos, feature: 'financiamentos' }, 403)
  }

  const body = await c.req.json()
  const {
    descricao, tipo_imovel = 'residencial', tipo_bem = 'imovel', valor_imovel, valor_financiado, valor_entrada = 0,
    taxa_juros_anual, numero_parcelas, parcelas_pagas = 0, valor_parcela,
    data_inicio, banco, contrato, sistema_amortizacao: _sa = 'price', indexador = 'prefixado',
    seguro_mip = 0, seguro_dfi = 0, observacoes
  } = body
  const sistema_amortizacao = (_sa as string).toLowerCase()

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
    `INSERT INTO financiamentos (user_id, descricao, tipo_imovel, tipo_bem, valor_imovel, valor_financiado, valor_entrada, taxa_juros_anual, taxa_juros_mensal, numero_parcelas, parcelas_pagas, valor_parcela, saldo_devedor, data_inicio, data_previsao_fim, sistema_amortizacao, banco, contrato, indexador, seguro_mip, seguro_dfi, observacoes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(user.id, descricao, tipo_imovel, tipo_bem, parseFloat(valor_imovel), parseFloat(valor_financiado), parseFloat(valor_entrada), parseFloat(taxa_juros_anual), taxaMensal * 100, parseInt(numero_parcelas), parseInt(parcelas_pagas), parseFloat(valor_parcela), saldoDevedor, data_inicio, dataFim.toISOString().split('T')[0], sistema_amortizacao, banco || null, contrato || null, indexador, parseFloat(seguro_mip) || 0, parseFloat(seguro_dfi) || 0, observacoes || null).run()

  const finId = result.meta.last_row_id as number

  // === Criar despesas automáticas das parcelas futuras (batch para performance) ===
  const parcelasPagasN = parseInt(parcelas_pagas)
  const totalParcelasN = parseInt(numero_parcelas)
  const valorParcelaN = parseFloat(valor_parcela)

  // Inserir em lotes de 100 para evitar timeout
  const LOTE = 100
  for (let base = parcelasPagasN; base < totalParcelasN; base += LOTE) {
    const stmts = []
    for (let i = base; i < Math.min(base + LOTE, totalParcelasN); i++) {
      const dataParc = new Date(dataInicio)
      dataParc.setMonth(dataParc.getMonth() + i)
      const dataParcStr = dataParc.toISOString().split('T')[0]
      stmts.push(
        c.env.DB.prepare(
          `INSERT INTO despesas (user_id, descricao, data, categoria, valor, parcelado, numero_parcelas, parcela_atual, status, fixa_ou_variavel, recorrente, vencimento, observacoes, meio_pagamento)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(
          user.id,
          `${descricao} (${i + 1}/${totalParcelasN})`,
          dataParcStr,
          'Financiamento',
          valorParcelaN,
          1, totalParcelasN, i + 1,
          'pendente',
          'fixa', 0,
          dataParcStr,
          `Financiamento automático #${finId} — ${banco || tipo_imovel}`,
          'transferencia'
        )
      )
    }
    await c.env.DB.batch(stmts)
  }

  await verificarConquista(c.env.DB, user.id, 'planejador')
  await verificarConquista(c.env.DB, user.id, 'primeiro_financiamento')
  // Conquista: primeiro imóvel
  const tipoBem = body.tipo_bem || 'imovel'
  if (tipoBem === 'imovel' || tipoBem === 'imovel_comercial') await verificarConquista(c.env.DB, user.id, 'primeiro_imovel')
  if (tipoBem === 'veiculo') await verificarConquista(c.env.DB, user.id, 'financiamento_veiculo')
  if (tipoBem === 'outros' || tipoBem === 'rural') await verificarConquista(c.env.DB, user.id, 'financiamento_outros')

  // ── Tags automáticas para as despesas geradas ──────────────────────────
  try {
    const despGeradas = await c.env.DB.prepare(
      `SELECT id FROM despesas WHERE user_id=? AND observacoes LIKE ? ORDER BY id ASC`
    ).bind(user.id, `Financiamento automático #${finId}%`).all<{id:number}>()
    const despIds = (despGeradas.results || []).map(r => r.id)
    if (despIds.length > 0) {
      const tagFinId  = await ensureTag(c.env.DB, user.id, 'Financiamento', COR_MODULO.financiamento)
      const tagItemId = await ensureTag(c.env.DB, user.id, descricao.trim().slice(0, 30), COR_MODULO.financiamento)
      for (const did of despIds) {
        await tagDespesa(c.env.DB, did, tagFinId)
        if (tagItemId !== tagFinId) await tagDespesa(c.env.DB, did, tagItemId)
      }
    }
  } catch (_) { /* tag automática é best-effort */ }

  return c.json({ success: true, id: finId, message: 'Financiamento cadastrado e despesas criadas automaticamente!' }, 201)
})

// PUT /api/financiamentos/:id
financiamentos.put('/:id', requireAuth, async (c) => {
  const user = c.get('user')
  const id = c.req.param('id')
  const fin = await c.env.DB.prepare('SELECT * FROM financiamentos WHERE id = ? AND user_id = ?').bind(id, user.id).first() as any
  if (!fin) return c.json({ error: 'Financiamento não encontrado' }, 404)

  const body = await c.req.json()

  // Merge: usa valor do body se fornecido, senão mantém o atual do banco
  const descricao        = body.descricao        ?? fin.descricao
  const tipo_imovel      = body.tipo_imovel      ?? fin.tipo_imovel
  const tipo_bem         = body.tipo_bem         ?? fin.tipo_bem
  const valor_imovel     = body.valor_imovel     ?? fin.valor_imovel
  const valor_financiado = body.valor_financiado ?? fin.valor_financiado
  const valor_entrada    = body.valor_entrada    ?? fin.valor_entrada
  const taxa_juros_anual = body.taxa_juros_anual ?? fin.taxa_juros_anual
  const numero_parcelas  = body.numero_parcelas  ?? fin.numero_parcelas
  const parcelas_pagas   = body.parcelas_pagas   ?? fin.parcelas_pagas
  const valor_parcela    = body.valor_parcela    ?? fin.valor_parcela
  const data_inicio      = body.data_inicio      ?? fin.data_inicio
  const banco            = body.banco            ?? fin.banco
  const contrato         = body.contrato         ?? fin.contrato
  const sistema_amortizacao = (body.sistema_amortizacao ?? fin.sistema_amortizacao)?.toLowerCase()
  const indexador        = body.indexador        ?? fin.indexador
  const status           = body.status           ?? fin.status
  const observacoes      = body.observacoes      ?? fin.observacoes
  const seguro_mip       = body.seguro_mip       ?? fin.seguro_mip
  const seguro_dfi       = body.seguro_dfi       ?? fin.seguro_dfi

  const taxaMensal = parseFloat(taxa_juros_anual) / 12 / 100
  const saldoDevedor = calcularSaldoDevedor(parseFloat(valor_financiado), taxaMensal, parseInt(numero_parcelas), parseInt(parcelas_pagas))

  // Recalcular data_previsao_fim
  const dataInicioPut = new Date(data_inicio)
  let dataFimStr = fin.data_previsao_fim
  if (!isNaN(dataInicioPut.getTime())) {
    const dataFimPut = new Date(dataInicioPut)
    dataFimPut.setMonth(dataFimPut.getMonth() + parseInt(numero_parcelas))
    dataFimStr = dataFimPut.toISOString().split('T')[0]
  }

  await c.env.DB.prepare(
    `UPDATE financiamentos SET descricao=?, tipo_imovel=?, tipo_bem=?, valor_imovel=?, valor_financiado=?, valor_entrada=?, taxa_juros_anual=?, taxa_juros_mensal=?, numero_parcelas=?, parcelas_pagas=?, valor_parcela=?, saldo_devedor=?, data_inicio=?, data_previsao_fim=?, banco=?, contrato=?, sistema_amortizacao=?, indexador=?, status=?, observacoes=?, seguro_mip=?, seguro_dfi=? WHERE id=? AND user_id=?`
  ).bind(descricao, tipo_imovel, tipo_bem, parseFloat(valor_imovel), parseFloat(valor_financiado), parseFloat(valor_entrada) || 0, parseFloat(taxa_juros_anual), taxaMensal * 100, parseInt(numero_parcelas), parseInt(parcelas_pagas), parseFloat(valor_parcela), saldoDevedor, data_inicio, dataFimStr, banco || null, contrato || null, sistema_amortizacao, indexador || null, status || 'ativo', observacoes || null, parseFloat(seguro_mip) || 0, parseFloat(seguro_dfi) || 0, id, user.id).run()

  if (status === 'quitado') {
    await verificarConquista(c.env.DB, user.id, 'sem_dividas')
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
  const sistema = (fin.sistema_amortizacao || 'price').toLowerCase()

  // CÁLCULO CORRETO por sistema de amortização
  const jurosMes = Math.round(fin.saldo_devedor * taxaMensal * 100) / 100
  let amortizacao: number
  let novaParcelaValor = fin.valor_parcela

  if (sistema === 'sac' || sistema === 'sacre') {
    // SAC: amortização constante = saldo_original / num_parcelas
    const amortConstante = Math.round((fin.valor_financiado / fin.numero_parcelas) * 100) / 100
    amortizacao = amortConstante
    novaParcelaValor = Math.round((amortConstante + jurosMes) * 100) / 100 // parcela decrescente
  } else {
    // PRICE: parcela fixa, amortização = parcela - juros
    amortizacao = Math.round((fin.valor_parcela - jurosMes) * 100) / 100
  }

  const novoSaldo = Math.max(0, Math.round((fin.saldo_devedor - amortizacao) * 100) / 100)
  const status = novasParcelas >= fin.numero_parcelas ? 'quitado' : 'ativo'

  // Recalcular data_previsao_fim com base nas parcelas restantes
  const parcelasRestantes = fin.numero_parcelas - novasParcelas
  const dataBase = new Date()
  dataBase.setMonth(dataBase.getMonth() + parcelasRestantes)
  const novaDataFim = status === 'quitado' ? new Date().toISOString().split('T')[0] : dataBase.toISOString().split('T')[0]

  // Para SAC: atualizar valor_parcela com a próxima parcela calculada
  const proxParcelaSAC = sistema === 'sac' || sistema === 'sacre'
    ? Math.round(((fin.valor_financiado / fin.numero_parcelas) + novoSaldo * taxaMensal) * 100) / 100
    : fin.valor_parcela

  await c.env.DB.prepare(
    'UPDATE financiamentos SET parcelas_pagas=?, saldo_devedor=?, status=?, data_previsao_fim=?, valor_parcela=? WHERE id=? AND user_id=?'
  ).bind(novasParcelas, novoSaldo, status, novaDataFim, sistema === 'sac' || sistema === 'sacre' ? proxParcelaSAC : fin.valor_parcela, id, user.id).run()

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
  if (status === 'quitado') {
    await verificarConquista(c.env.DB, user.id, 'imovel_quitado')
    await verificarConquista(c.env.DB, user.id, 'quitou_imovel') // BUG 1.4: conquista lendária 500pts
  }

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

  const body = await c.req.json()
  // Aceita 'valor' ou 'valor_amortizado' para compatibilidade
  const valor_amortizado = body.valor_amortizado ?? body.valor
  const parcelas_antecipadas = body.parcelas_antecipadas ?? 0
  const observacoes = body.observacoes ?? body.descricao
  // Se novo_saldo não for informado, calcula automaticamente
  const novo_saldo = body.novo_saldo !== undefined ? body.novo_saldo : (fin.saldo_devedor - parseFloat(valor_amortizado))
  if (!valor_amortizado) return c.json({ error: 'valor_amortizado (ou valor) é obrigatório' }, 400)

  const novasPorAntecipacao = Math.max(0, parseInt(parcelas_antecipadas))
  const novasParcelas = Math.min(fin.numero_parcelas, fin.parcelas_pagas + novasPorAntecipacao)
  const novoSaldoVal = Math.max(0, parseFloat(novo_saldo))
  const status = novoSaldoVal <= 0 || novasParcelas >= fin.numero_parcelas ? 'quitado' : 'ativo'

  // Recalcular data_previsao_fim após amortização extraordinária
  const parcelasRestAmort = fin.numero_parcelas - novasParcelas
  const dataBaseAmort = new Date()
  dataBaseAmort.setMonth(dataBaseAmort.getMonth() + parcelasRestAmort)
  const novaDataFimAmort = status === 'quitado' ? new Date().toISOString().split('T')[0] : dataBaseAmort.toISOString().split('T')[0]

  // Para SAC: recalcular próxima parcela com novo saldo
  const sistemaAmort = (fin.sistema_amortizacao || 'price').toLowerCase()
  const taxaMensalAmort = fin.taxa_juros_mensal / 100
  const proxParcelaAmort = (sistemaAmort === 'sac' || sistemaAmort === 'sacre')
    ? Math.round(((fin.valor_financiado / fin.numero_parcelas) + novoSaldoVal * taxaMensalAmort) * 100) / 100
    : fin.valor_parcela

  await c.env.DB.prepare(
    'UPDATE financiamentos SET saldo_devedor=?, parcelas_pagas=?, status=?, data_previsao_fim=?, valor_parcela=? WHERE id=? AND user_id=?'
  ).bind(novoSaldoVal, novasParcelas, status, novaDataFimAmort, proxParcelaAmort, id, user.id).run()

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
    await verificarConquista(c.env.DB, user.id, 'quitou_imovel') // BUG 1.4: conquista lendária 500pts
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

// GET /api/financiamentos/:id/evolucao-saldo
// Retorna projeção completa do saldo devedor mês a mês até quitação (para gráfico)
financiamentos.get('/:id/evolucao-saldo', requireAuth, async (c) => {
  const user = c.get('user')
  const id = c.req.param('id')
  const fin = await c.env.DB.prepare('SELECT * FROM financiamentos WHERE id = ? AND user_id = ?').bind(id, user.id).first() as any
  if (!fin) return c.json({ error: 'Financiamento não encontrado' }, 404)

  const taxaM = fin.taxa_juros_mensal / 100
  const sistema = (fin.sistema_amortizacao || 'price').toLowerCase()
  const amortConstante = fin.valor_financiado / fin.numero_parcelas // para SAC

  const pontos: any[] = []
  let saldo = fin.saldo_devedor
  let totalJurosAcum = 0
  let totalAmortAcum = 0

  const hoje = new Date()

  // Ponto 0: situação atual
  pontos.push({
    parcela: fin.parcelas_pagas,
    data: hoje.toISOString().split('T')[0],
    saldo: Math.round(saldo * 100) / 100,
    juros_acumulados: 0,
    amort_acumulada: 0,
    label: 'Hoje'
  })

  const parcelasRestantes = fin.numero_parcelas - fin.parcelas_pagas
  for (let i = 1; i <= parcelasRestantes; i++) {
    const juros = Math.round(saldo * taxaM * 100) / 100
    const amort = sistema === 'sac' || sistema === 'sacre'
      ? Math.min(amortConstante, saldo)
      : Math.min(fin.valor_parcela - juros, saldo)
    saldo = Math.max(0, Math.round((saldo - amort) * 100) / 100)
    totalJurosAcum += juros
    totalAmortAcum += amort

    const dataParcela = new Date(hoje)
    dataParcela.setMonth(dataParcela.getMonth() + i)

    // Incluir todos os pontos mas reduzir granularidade para grandes financiamentos
    const incluir = parcelasRestantes <= 60 || i % 6 === 0 || i === parcelasRestantes || i === 1
    if (incluir) {
      pontos.push({
        parcela: fin.parcelas_pagas + i,
        data: dataParcela.toISOString().split('T')[0],
        saldo: Math.round(saldo * 100) / 100,
        juros_acumulados: Math.round(totalJurosAcum * 100) / 100,
        amort_acumulada: Math.round(totalAmortAcum * 100) / 100
      })
    }

    if (saldo <= 0) break
  }

  return c.json({
    financiamento_id: fin.id,
    descricao: fin.descricao,
    sistema: sistema.toUpperCase(),
    valor_financiado: fin.valor_financiado,
    saldo_atual: fin.saldo_devedor,
    pontos,
    resumo: {
      total_juros_restantes: Math.round(totalJurosAcum * 100) / 100,
      total_a_pagar: Math.round((totalJurosAcum + fin.saldo_devedor) * 100) / 100,
      parcelas_restantes: parcelasRestantes,
      previsao_fim: pontos[pontos.length - 1]?.data || null
    }
  })
})

// GET /api/financiamentos/:id/simulacao-fgts
// Simula economia usando FGTS para amortizar
financiamentos.get('/:id/simulacao-fgts', requireAuth, async (c) => {
  const user = c.get('user')
  const id = c.req.param('id')
  const fin = await c.env.DB.prepare('SELECT * FROM financiamentos WHERE id = ? AND user_id = ?').bind(id, user.id).first() as any
  if (!fin) return c.json({ error: 'Financiamento não encontrado' }, 404)

  const saldo = fin.saldo_devedor
  const taxaM = fin.taxa_juros_mensal / 100
  const parcelasRestantes = fin.numero_parcelas - fin.parcelas_pagas
  const sistema = (fin.sistema_amortizacao || 'price').toLowerCase()
  const amortConst = fin.valor_financiado / fin.numero_parcelas

  // Calcular total de juros no ritmo atual
  let saldoAtual = saldo
  let totalJurosAtual = 0
  for (let i = 0; i < parcelasRestantes; i++) {
    const j = saldoAtual * taxaM
    const a = sistema === 'sac' ? Math.min(amortConst, saldoAtual) : Math.min(fin.valor_parcela - j, saldoAtual)
    totalJurosAtual += j
    saldoAtual = Math.max(0, saldoAtual - a)
  }

  // Simular cenários de FGTS: 10%, 20%, 30%, 50% do saldo atual
  const cenarios = [10, 20, 30, 50].map(pct => {
    const valorFGTS = Math.round(saldo * pct / 100 * 100) / 100
    const novoSaldo = Math.max(0, saldo - valorFGTS)

    let saldoSim = novoSaldo
    let totalJurosSim = 0
    let novasParcelas = 0

    for (let i = 0; i < parcelasRestantes; i++) {
      const j = saldoSim * taxaM
      const a = sistema === 'sac' ? Math.min(amortConst, saldoSim) : Math.min(fin.valor_parcela - j, saldoSim)
      totalJurosSim += j
      saldoSim = Math.max(0, saldoSim - a)
      novasParcelas++
      if (saldoSim <= 0) break
    }

    const economiaParcelas = parcelasRestantes - novasParcelas
    const economiaJuros = Math.round((totalJurosAtual - totalJurosSim) * 100) / 100

    return {
      pct,
      valor_fgts: valorFGTS,
      novo_saldo: Math.round(novoSaldo * 100) / 100,
      parcelas_economizadas: economiaParcelas,
      economia_juros: economiaJuros,
      retorno_fgts_pct: valorFGTS > 0 ? Math.round((economiaJuros / valorFGTS) * 100) : 0,
      vale_a_pena: economiaJuros > valorFGTS * 0.07 // vale se economizar mais de 7% do valor usado (rendimento FGTS)
    }
  })

  // Rendimento do FGTS para comparação (3% a.a. + TR ~0.5% = ~3.5% a.a. ≈ 0.29% a.m.)
  const rendFGTS_am = 0.0029
  const taxaFinanciamento_am = taxaM

  return c.json({
    financiamento_id: fin.id,
    descricao: fin.descricao,
    saldo_devedor: saldo,
    taxa_mensal: fin.taxa_juros_mensal,
    parcelas_restantes: parcelasRestantes,
    total_juros_sem_fgts: Math.round(totalJurosAtual * 100) / 100,
    cenarios,
    alerta: taxaFinanciamento_am > rendFGTS_am
      ? `Taxa do financiamento (${fin.taxa_juros_mensal}% a.m.) > rendimento FGTS (~0.29% a.m.) — usar FGTS para amortizar é vantajoso.`
      : `Taxa do financiamento é baixa — avalie se vale resgatar o FGTS.`,
    recomendacao: cenarios.find(c => c.vale_a_pena && c.pct <= 30)
      ? `Recomendado: usar ${cenarios.find(c => c.vale_a_pena)?.pct}% do saldo FGTS disponível`
      : 'Analise com seu gerente antes de usar FGTS.'
  })
})
