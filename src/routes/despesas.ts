import { Hono } from 'hono'
import { requireAuth } from './auth'
import { getLimites, MSG_UPGRADE } from './planos'
import { filtroCompetencia, filtroCompetenciaAno, filtroSemAporte, mesDoisDigitos } from '../lib/competencia'

type Bindings = { DB: D1Database }
type Variables = { user: { id: number; nome: string; email: string; plano: string } }

const despesas = new Hono<{ Bindings: Bindings; Variables: Variables }>()

// ── Utilitários de categoria ─────────────────────────────────────────────────

// Mapa: chave lowercase/sem-acento → label canônico do frontend
const CATEGORIA_NORMALIZE_DESP: Record<string, string> = {
  'alimentacao':        'Alimentação',
  'alimentação':        'Alimentação',
  'transporte':         'Transporte',
  'moradia':            'Moradia',
  'saude':              'Saúde',
  'saúde':              'Saúde',
  'educacao':           'Educação',
  'educação':           'Educação',
  'lazer':              'Lazer',
  'roupas':             'Roupas',
  'vestuario':          'Vestuário',
  'vestuário':          'Vestuário',
  'assinaturas':        'Assinaturas',
  'assinatura':         'Assinaturas',
  'streaming':          'Streaming',
  'utilidades':         'Utilidades',
  'utilities':          'Utilidades',
  'pessoal':            'Pessoal',
  'pets':               'Pets',
  'beleza':             'Beleza',
  'tecnologia':         'Tecnologia',
  'viagem':             'Viagem',
  'academia':           'Academia',
  'servicos':           'Serviços',
  'serviços':           'Serviços',
  'presentes':          'Presentes',
  'emprestimo':         'Empréstimo',
  'empréstimo':         'Empréstimo',
  'emprestimos':        'Empréstimo',
  'empréstimos':        'Empréstimo',
  'fatura cartao':      'Fatura Cartão',
  'fatura cartão':      'Fatura Cartão',
  'investimento':       'Investimento',
  'outros':             'Outros',
}

// Aliases para cada categoria normalizada — usados para construir filtro SQL IN(...)
const CATEGORIA_ALIASES_DESP: Record<string, string[]> = {
  'Alimentação':   ['Alimentação','alimentação','Alimentacao','alimentacao'],
  'Transporte':    ['Transporte','transporte'],
  'Moradia':       ['Moradia','moradia'],
  'Saúde':         ['Saúde','saúde','Saude','saude'],
  'Educação':      ['Educação','educação','Educacao','educacao'],
  'Lazer':         ['Lazer','lazer'],
  'Roupas':        ['Roupas','roupas','Vestuário','vestuário','Vestuario','vestuario'],
  'Vestuário':     ['Vestuário','vestuário','Vestuario','vestuario','Roupas','roupas'],
  'Assinaturas':   ['Assinaturas','assinaturas','Assinatura','assinatura','Streaming','streaming'],
  'Streaming':     ['Streaming','streaming','Assinaturas','assinaturas','Assinatura','assinatura'],
  'Utilidades':    ['Utilidades','utilidades','Utilities','utilities'],
  'Pessoal':       ['Pessoal','pessoal'],
  'Pets':          ['Pets','pets'],
  'Beleza':        ['Beleza','beleza'],
  'Tecnologia':    ['Tecnologia','tecnologia'],
  'Viagem':        ['Viagem','viagem'],
  'Academia':      ['Academia','academia'],
  'Serviços':      ['Serviços','serviços','Servicos','servicos'],
  'Presentes':     ['Presentes','presentes'],
  'Empréstimo':    ['Empréstimo','empréstimo','Emprestimo','emprestimo','Empréstimos','empréstimos','Emprestimos','emprestimos'],
  'Fatura Cartão': ['Fatura Cartão','fatura cartão','Fatura Cartao','fatura cartao'],
  'Investimento':  ['Investimento','investimento'],
  'Outros':        ['Outros','outros'],
}

function normalizarCategoriaDesp(cat: string): string {
  const key = cat.toLowerCase().trim()
  return CATEGORIA_NORMALIZE_DESP[key] || cat
}

// Gera expressão CASE para normalizar categorias no SQL (GROUP BY e SELECT)
function gerarCaseCategoriaDesp(): string {
  const linhas: string[] = []
  for (const [normalizado, aliases] of Object.entries(CATEGORIA_ALIASES_DESP)) {
    const inList = aliases.map(a => `'${a.replace(/'/g, "''")}'`).join(',')
    linhas.push(`WHEN categoria IN (${inList}) THEN '${normalizado.replace(/'/g, "''")}'`)
  }
  return `CASE ${linhas.join(' ')} ELSE categoria END`
}

// Gera cláusula WHERE para filtrar por categoria (case-insensitive, cobre aliases legados)
function filtroCategoriaDespaSQL(categoria: string): string {
  // Encontrar lista de aliases para esta categoria
  const normalized = normalizarCategoriaDesp(categoria)
  const aliases = CATEGORIA_ALIASES_DESP[normalized]
  if (aliases && aliases.length > 0) {
    const inList = aliases.map(a => `'${a.replace(/'/g, "''")}'`).join(',')
    return ` AND categoria IN (${inList})`
  }
  // Fallback: case-insensitive simples
  return ` AND LOWER(TRIM(categoria)) = LOWER('${categoria.replace(/'/g, "''")}')`
}

// GET /api/despesas
despesas.get('/', requireAuth, async (c) => {
  const user = c.get('user')
  const { mes, ano, categoria, status, busca, limit = '50', offset = '0', purchase_group_id, meio_pagamento, cartao_id, sem_cartao, com_cartao, tag_id, sem_tag } = c.req.query()

  let query = 'SELECT * FROM despesas WHERE user_id = ? AND ' + filtroSemAporte()
  const params: any[] = [user.id]

  if (purchase_group_id) {
    query += ' AND purchase_group_id = ?'
    params.push(purchase_group_id)
    query += ' ORDER BY data ASC, id ASC LIMIT 100'
    const result = await c.env.DB.prepare(query).bind(...params).all()
    return c.json({ despesas: result.results || [], total: (result.results || []).length })
  }

  if (mes && ano) {
    query += ' AND ' + filtroCompetencia()
    params.push(mesDoisDigitos(mes), ano)
  } else if (ano) {
    query += ' AND ' + filtroCompetenciaAno()
    params.push(ano)
  }

  // Filtro de categoria: case-insensitive cobrindo aliases legados
  if (categoria) { query += filtroCategoriaDespaSQL(categoria) }
  if (status)    { query += ' AND status = ?';    params.push(status) }
  if (meio_pagamento) { query += ' AND meio_pagamento = ?'; params.push(meio_pagamento) }
  if (cartao_id)          { query += ' AND cartao_id = ?';                    params.push(parseInt(cartao_id)) }
  if (sem_cartao === '1') { query += ' AND (cartao_id IS NULL OR cartao_id = 0)' }
  if (com_cartao === '1') { query += ' AND cartao_id IS NOT NULL AND cartao_id != 0' }
  if (busca) {
    query += ' AND descricao LIKE ?'
    params.push(`%${busca.replace(/'/g, "''")}%`)
  }
  if (tag_id) {
    query += ' AND EXISTS (SELECT 1 FROM despesa_tags dt WHERE dt.despesa_id = despesas.id AND dt.tag_id = ?)'
    params.push(parseInt(tag_id))
  }
  if (sem_tag === '1') {
    query += ' AND NOT EXISTS (SELECT 1 FROM despesa_tags dt WHERE dt.despesa_id = despesas.id)'
  }

  query += ' ORDER BY data DESC, id DESC LIMIT ? OFFSET ?'
  params.push(parseInt(limit), parseInt(offset))

  const result = await c.env.DB.prepare(query).bind(...params).all()

  // totais por status respeitando filtros (sem busca para não distorcer o total do mês)
  let baseFilter = 'FROM despesas WHERE user_id = ? AND ' + filtroSemAporte()
  const baseParams: any[] = [user.id]
  if (mes && ano) {
    baseFilter += ' AND ' + filtroCompetencia()
    baseParams.push(mesDoisDigitos(mes), ano)
  } else if (ano) {
    baseFilter += ' AND ' + filtroCompetenciaAno()
    baseParams.push(ano)
  }
  if (categoria)   { baseFilter += filtroCategoriaDespaSQL(categoria) }
  if (status)      { baseFilter += ' AND status = ?';          baseParams.push(status) }
  if (meio_pagamento) { baseFilter += ' AND meio_pagamento = ?'; baseParams.push(meio_pagamento) }
  if (cartao_id)          { baseFilter += ' AND cartao_id = ?';                    baseParams.push(parseInt(cartao_id)) }
  if (sem_cartao === '1') { baseFilter += ' AND (cartao_id IS NULL OR cartao_id = 0)' }
  if (com_cartao === '1') { baseFilter += ' AND cartao_id IS NOT NULL AND cartao_id != 0' }
  if (busca)       { baseFilter += ' AND descricao LIKE ?';    baseParams.push(`%${busca.replace(/'/g, "''")}%`) }
  if (tag_id)      { baseFilter += ' AND EXISTS (SELECT 1 FROM despesa_tags dt WHERE dt.despesa_id = despesas.id AND dt.tag_id = ?)'; baseParams.push(parseInt(tag_id)) }
  if (sem_tag === '1') { baseFilter += ' AND NOT EXISTS (SELECT 1 FROM despesa_tags dt WHERE dt.despesa_id = despesas.id)' }

  const caseExpr = gerarCaseCategoriaDesp()

  const [totPago, totPendente, totGeral, catBreakdownR] = await c.env.DB.batch([
    c.env.DB.prepare(`SELECT COALESCE(SUM(valor),0) as v, COUNT(*) as n ${baseFilter} AND status='pago'`).bind(...baseParams),
    c.env.DB.prepare(`SELECT COALESCE(SUM(valor),0) as v, COUNT(*) as n ${baseFilter} AND status='pendente'`).bind(...baseParams),
    c.env.DB.prepare(`SELECT COALESCE(SUM(valor),0) as v, COUNT(*) as n ${baseFilter}`).bind(...baseParams),
    // breakdown por categoria normalizada (sem filtro de categoria pura para mostrar todas do período)
    (() => {
      let cbFilter = 'FROM despesas WHERE user_id = ? AND (tipo IS NULL OR tipo != \'aporte\')'
      const cbParams: any[] = [user.id]
      if (mes && ano) { cbFilter += ' AND ' + filtroCompetencia(); cbParams.push(mesDoisDigitos(mes), ano) }
      else if (ano) { cbFilter += ' AND ' + filtroCompetenciaAno(); cbParams.push(ano) }
      if (status) { cbFilter += ' AND status = ?'; cbParams.push(status) }
      if (busca) { cbFilter += ' AND descricao LIKE ?'; cbParams.push(`%${busca.replace(/'/g,"''")}%`) }
      return c.env.DB.prepare(
        `SELECT ${caseExpr} as categoria, COALESCE(SUM(valor),0) as total, COUNT(*) as qtd ${cbFilter} GROUP BY ${caseExpr} ORDER BY total DESC LIMIT 10`
      ).bind(...cbParams)
    })(),
  ])

  const rPago     = (totPago.results?.[0]     as any) || { v: 0, n: 0 }
  const rPendente = (totPendente.results?.[0]  as any) || { v: 0, n: 0 }
  const rGeral    = (totGeral.results?.[0]     as any) || { v: 0, n: 0 }

  // Buscar tags de cada despesa retornada
  const despesasResult = result.results || []
  let tagsMap: Record<number, {id:number;nome:string;cor:string}[]> = {}
  if (despesasResult.length > 0) {
    const ids = (despesasResult as any[]).map((d: any) => d.id)
    const inPlaceholders = ids.map(() => '?').join(',')
    const tagsRows = await c.env.DB.prepare(
      `SELECT dt.despesa_id, t.id, t.nome, t.cor
       FROM despesa_tags dt JOIN tags t ON t.id = dt.tag_id
       WHERE dt.despesa_id IN (${inPlaceholders})
       ORDER BY t.nome ASC`
    ).bind(...ids).all<{despesa_id:number;id:number;nome:string;cor:string}>()
    for (const row of (tagsRows.results || [])) {
      if (!tagsMap[row.despesa_id]) tagsMap[row.despesa_id] = []
      tagsMap[row.despesa_id].push({ id: row.id, nome: row.nome, cor: row.cor })
    }
  }

  // Normalizar meio_pagamento nulo e injetar tags
  const despesasNorm = despesasResult.map((d: any) => ({
    ...d,
    meio_pagamento: d.meio_pagamento || 'dinheiro',
    categoria: normalizarCategoriaDesp(d.categoria || 'outros'),
    tags: tagsMap[d.id] || [],
  }))

  return c.json({ 
    despesas:       despesasNorm, 
    total:          rGeral.v,
    count:          despesasNorm.length,
    total_count:    rGeral.n,
    total_pago:     rPago.v,
    count_pago:     rPago.n,
    total_pendente: rPendente.v,
    count_pendente: rPendente.n,
    categorias_breakdown: catBreakdownR.results || [],
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

  if (!descricao || !data || !categoria || valor === undefined || valor === null) {
    return c.json({ error: 'Campos obrigatórios: descricao, data, categoria, valor' }, 400)
  }
  // M-D3: rejeitar valor negativo ou zero
  const valorNum = parseFloat(valor)
  if (isNaN(valorNum) || valorNum <= 0) {
    return c.json({ error: 'Valor inválido — deve ser um número maior que zero' }, 400)
  }

  // ── Normalizar meio_pagamento: mapear aliases do frontend para valores canônicos ──
  // 'debito' é alias de 'cartao_debito'
  // 'parcelado_sem_juros' é alias de 'parcelado_cartao'
  const normalizarMeioPagamento = (mp: string): string => {
    const mapa: Record<string, string> = {
      'debito': 'cartao_debito',
      'parcelado_sem_juros': 'parcelado_cartao',
    }
    return mapa[mp] ?? mp
  }
  const meioPagamentoNorm = normalizarMeioPagamento(meio_pagamento)

  // Validar: se meio de pagamento é cartão, cartao_id é obrigatório
  const meioPagamentoCartaoCheck = ['cartao_credito', 'parcelado_cartao']
  if (meioPagamentoCartaoCheck.includes(meioPagamentoNorm) && !cartao_id) {
    return c.json({ error: 'Selecione um cartão para pagamentos com cartão de crédito.' }, 400)
  }

  const totalParcelas = parcelado ? parseInt(numero_parcelas) : 1
  const valorParcela = valor_parcela_override
    ? parseFloat(valor_parcela_override)
    : parseFloat(valor) / totalParcelas
  const totalParcelasLabel = parcelas_total_original ? parseInt(parcelas_total_original) : totalParcelas
  const ids: number[] = []

  // Buscar dados do cartão para calcular billing correto
  let cartaoInfo: any = null
  const meioPagamentoCartao = ['cartao_credito', 'parcelado_cartao']
  if (cartao_id && meioPagamentoCartao.includes(meioPagamentoNorm)) {
    cartaoInfo = await c.env.DB.prepare(
      'SELECT * FROM cartoes WHERE id = ? AND user_id = ?'
    ).bind(parseInt(cartao_id), user.id).first() as any
  }

  // Gerar UUID simples para agrupar parcelas (S3: gerado para qualquer parcelamento >= 2)
  const groupId = totalParcelas > 1
    ? 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,
        c2 => { const r=(Math.random()*16)|0; return (c2==='x'?r:(r&0x3)|0x8).toString(16) })
    : null

  const parcelaInicialLabel = totalParcelasLabel - totalParcelas + 1
  for (let i = 0; i < totalParcelas; i++) {
    const dataBase = new Date(data + 'T12:00:00')
    dataBase.setMonth(dataBase.getMonth() + i)
    const dataParcela = dataBase.toISOString().split('T')[0]
    const parcelaAtualLabel = parcelaInicialLabel + i

    // Calcular billing_month/year se houver cartão
    let bMonth: number | null = null
    let bYear:  number | null = null
    let dataVenc: string | null = vencimento || null

    if (cartaoInfo) {
      // ── Calcular período de faturamento (mesmo algoritmo de cartoes.ts) ──────
      const dDay = dataBase.getDate()
      let m = dataBase.getMonth() + 1
      let y = dataBase.getFullYear()
      // Compra no fechamento ou após → próxima fatura
      if (dDay >= cartaoInfo.dia_fechamento) { m++; if (m > 12) { m = 1; y++ } }
      bMonth = m; bYear = y

      // ── Calcular data de vencimento com regra bancária correta ───────────────
      // Se dia_vencimento <= dia_fechamento, o vencimento cai no mês SEGUINTE
      // ao período de faturamento (ex: fecha dia 25, vence dia 1 → vence no mês+1)
      let vMonth = m
      let vYear  = y
      if (cartaoInfo.dia_vencimento <= cartaoInfo.dia_fechamento) {
        vMonth++
        if (vMonth > 12) { vMonth = 1; vYear++ }
      }
      const lastDay = new Date(vYear, vMonth, 0).getDate()
      const vDay = Math.min(cartaoInfo.dia_vencimento, lastDay)
      dataVenc = `${vYear}-${String(vMonth).padStart(2,'0')}-${String(vDay).padStart(2,'0')}`
    }

    // ── Campo 'data' da despesa ─────────────────────────────────────────────────
    // Para cartão de crédito: usar dataVenc (data de vencimento da fatura)
    //   → a tela de Despesas filtra por 'data', então a despesa precisa aparecer
    //     no mês em que a fatura vence, não no mês em que a compra foi feita.
    // Para outros meios: usar dataParcela (data real da compra/débito).
    const dataParaGravar = (cartaoInfo && dataVenc) ? dataVenc : dataParcela

    const result = await c.env.DB.prepare(
      `INSERT INTO despesas (user_id, descricao, data, categoria, subcategoria, valor,
       parcelado, numero_parcelas, parcela_atual, status, fixa_ou_variavel, recorrente,
       vencimento, observacoes, cartao_id, meio_pagamento, billing_month, billing_year, purchase_group_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      user.id,
      totalParcelas > 1 ? `${descricao} (${parcelaAtualLabel}/${totalParcelasLabel})` : descricao,
      dataParaGravar, categoria, subcategoria || null, valorParcela,
      parcelado ? 1 : 0, totalParcelasLabel, parcelaAtualLabel, status,
      fixa_ou_variavel, recorrente ? 1 : 0, dataVenc || null, observacoes || null,
      cartao_id ? parseInt(cartao_id) : null, meioPagamentoNorm,
      bMonth, bYear, groupId
    ).run()
    ids.push(result.meta.last_row_id as number)

    // Criar card_charge vinculado se for cartão de crédito
    if (cartaoInfo && bMonth && bYear) {
      const descParcela = totalParcelas > 1
        ? `${descricao} (${parcelaAtualLabel}/${totalParcelasLabel})` : descricao
      await c.env.DB.prepare(
        `INSERT INTO card_charges (card_id, expense_id, descricao, valor, data_compra,
         data_vencimento, billing_month, billing_year, parcela_atual, total_parcelas,
         purchase_group_id, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        parseInt(cartao_id), result.meta.last_row_id, descParcela, valorParcela,
        dataParcela, dataVenc, bMonth, bYear,
        totalParcelas > 1 ? parcelaAtualLabel : null,
        totalParcelas > 1 ? totalParcelasLabel : null,
        groupId, status === 'pago' ? 'pago' : 'pendente'
      ).run()
    }
  }

  // Reduzir limite do cartão pelo total de parcelas pendentes
  if (cartaoInfo && meioPagamentoCartao.includes(meioPagamentoNorm) && status !== 'pago') {
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

// PATCH /api/despesas/batch-status — S2: marcar todas como pagas em lote (registro ANTES de /:id)
despesas.patch('/batch-status', requireAuth, async (c) => {
  const user = c.get('user')
  const { mes, ano, status } = await c.req.json()

  const statusValidos = ['pago', 'pendente', 'cancelado']
  if (!status || !statusValidos.includes(status)) {
    return c.json({ error: `Status inválido. Use: ${statusValidos.join(', ')}` }, 400)
  }
  if (!mes || !ano) {
    return c.json({ error: 'Parâmetros mes e ano são obrigatórios' }, 400)
  }

  const pendentes = await c.env.DB.prepare(
    `SELECT * FROM despesas WHERE user_id = ? AND ${filtroCompetencia()} AND status = 'pendente'`
  ).bind(user.id, String(mes).padStart(2, '0'), String(ano)).all()

  const rows = (pendentes.results || []) as any[]
  if (rows.length === 0) return c.json({ success: true, atualizadas: 0, message: 'Nenhuma despesa pendente encontrada.' })

  let atualizadas = 0
  for (const d of rows) {
    await c.env.DB.prepare('UPDATE despesas SET status = ? WHERE id = ? AND user_id = ?').bind(status, d.id, user.id).run()
    if (d.cartao_id && status === 'pago') {
      await c.env.DB.prepare('UPDATE card_charges SET status = ? WHERE expense_id = ?').bind('pago', d.id).run()
      await c.env.DB.prepare(
        'UPDATE cartoes SET limite_disponivel = MIN(limite_total, limite_disponivel + ?) WHERE id = ? AND user_id = ?'
      ).bind(Number(d.valor), d.cartao_id, user.id).run()
    }
    atualizadas++
  }
  return c.json({ success: true, atualizadas, message: `${atualizadas} despesa(s) marcada(s) como ${status}!` })
})

// PATCH /api/despesas/bulk-pagar — marcar multiplas despesas como pagas
// ATENÇÃO: deve ficar ANTES de PATCH /:id para não ser interceptado pelo handler genérico
despesas.patch('/bulk-pagar', requireAuth, async (c) => {
  const user = c.get('user')
  const body = await c.req.json().catch(() => null)
  const ids: number[] = body?.ids || []
  if (!ids.length) return c.json({ error: 'Nenhum id informado.' }, 400)
  if (ids.length > 200) return c.json({ error: 'Maximo 200 itens por vez.' }, 400)

  const hoje = new Date().toISOString().split('T')[0]
  let atualizadas = 0
  for (const id of ids) {
    // Buscar dados antes de atualizar para sincronizar cartão
    const desp = await c.env.DB.prepare(
      'SELECT * FROM despesas WHERE id=? AND user_id=? AND status=\'pendente\''
    ).bind(id, user.id).first() as any
    if (!desp) continue

    const res = await c.env.DB.prepare(
      `UPDATE despesas SET status='pago', data_pagamento=? WHERE id=? AND user_id=? AND status='pendente'`
    ).bind(hoje, id, user.id).run()
    if (res.meta.changes > 0) {
      atualizadas++
      // Sincronizar cartão de crédito vinculado
      if (desp.cartao_id) {
        await c.env.DB.prepare('UPDATE card_charges SET status=\'pago\' WHERE expense_id=?').bind(id).run()
        await c.env.DB.prepare(
          'UPDATE cartoes SET limite_disponivel = MIN(limite_total, limite_disponivel + ?) WHERE id=? AND user_id=?'
        ).bind(Number(desp.valor), desp.cartao_id, user.id).run()
      }
    }
  }

  return c.json({ success: true, atualizadas, message: `${atualizadas} despesa(s) marcada(s) como paga(s).` })
})

// PATCH /api/despesas/bulk-pendente — reverter múltiplas despesas para pendente
// ATENÇÃO: deve ficar ANTES de PATCH /:id para não ser interceptado pelo handler genérico
despesas.patch('/bulk-pendente', requireAuth, async (c) => {
  const user = c.get('user')
  const body = await c.req.json().catch(() => null)
  const ids: number[] = body?.ids || []
  if (!ids.length) return c.json({ error: 'Nenhum id informado.' }, 400)
  if (ids.length > 200) return c.json({ error: 'Maximo 200 itens por vez.' }, 400)

  let atualizadas = 0
  for (const id of ids) {
    const desp = await c.env.DB.prepare(
      'SELECT * FROM despesas WHERE id=? AND user_id=? AND status IN (\'pago\',\'cancelado\')'
    ).bind(id, user.id).first() as any
    if (!desp) continue

    const res = await c.env.DB.prepare(
      `UPDATE despesas SET status='pendente', data_pagamento=NULL WHERE id=? AND user_id=?`
    ).bind(id, user.id).run()
    if (res.meta.changes > 0) {
      atualizadas++
      // Reverter charge vinculado e limite do cartão
      if (desp.cartao_id && desp.status === 'pago') {
        await c.env.DB.prepare('UPDATE card_charges SET status=\'pendente\' WHERE expense_id=?').bind(id).run()
        await c.env.DB.prepare(
          'UPDATE cartoes SET limite_disponivel = MAX(0, limite_disponivel - ?) WHERE id=? AND user_id=?'
        ).bind(Number(desp.valor), desp.cartao_id, user.id).run()
      }
    }
  }

  return c.json({ success: true, atualizadas, message: `${atualizadas} despesa(s) revertida(s) para pendente.` })
})

// GET /api/despesas/categorias
// ATENÇÃO: deve ficar ANTES de PUT /:id e DELETE /:id para não ser interceptado
despesas.get('/categorias', requireAuth, async (c) => {
  const user = c.get('user')
  const { mes, ano } = c.req.query()
  
  const caseExpr = gerarCaseCategoriaDesp()
  let query = `SELECT ${caseExpr} as categoria, COALESCE(SUM(valor), 0) as total, COUNT(*) as count FROM despesas WHERE user_id = ?`
  const params: any[] = [user.id]
  
  if (mes && ano) {
    query += ' AND ' + filtroCompetencia()
    params.push(mesDoisDigitos(mes), ano)
  }
  
  query += ` GROUP BY ${caseExpr} ORDER BY total DESC`
  const result = await c.env.DB.prepare(query).bind(...params).all()
  return c.json({ categorias: result.results })
})

// PUT /api/despesas/:id
despesas.put('/:id', requireAuth, async (c) => {
  const user = c.get('user')
  const id = c.req.param('id')
  const body = await c.req.json()

  const existing = await c.env.DB.prepare('SELECT id FROM despesas WHERE id = ? AND user_id = ?').bind(id, user.id).first()
  if (!existing) return c.json({ error: 'Despesa não encontrada' }, 404)

  const { descricao, data, categoria, subcategoria, valor, status,
    fixa_ou_variavel, tipo: tipoEdit, meio_pagamento: meioPagEdit,
    vencimento, observacoes } = body

  // aceitar 'tipo' como alias de 'fixa_ou_variavel'
  const fixaOuVariavelFinal = fixa_ou_variavel ?? tipoEdit ?? null

  // B7: validar campos obrigatórios e valor
  if (!descricao || !data || !categoria || valor === undefined) {
    return c.json({ error: 'Campos obrigatórios: descricao, data, categoria, valor' }, 400)
  }
  const valorEditNum = parseFloat(valor)
  if (isNaN(valorEditNum) || valorEditNum <= 0) {
    return c.json({ error: 'Valor inválido — deve ser um número maior que zero' }, 400)
  }
  // B8/M-D2: validar enum de status
  const statusValidos = ['pago', 'pendente', 'cancelado']
  if (status && !statusValidos.includes(status)) {
    return c.json({ error: `Status inválido. Use: ${statusValidos.join(', ')}` }, 400)
  }

  // Buscar dados atuais da despesa (para comparar valor e cartao)
  const despesaAtual = await c.env.DB.prepare('SELECT * FROM despesas WHERE id=? AND user_id=?').bind(id, user.id).first() as any

  // Montar update dinâmico para campos opcionais
  const updateFields = ['descricao=?','data=?','categoria=?','subcategoria=?','valor=?']
  const updateVals: any[] = [descricao, data, categoria, subcategoria || null, valorEditNum]

  if (status !== undefined)           { updateFields.push('status=?');          updateVals.push(status) }
  if (fixaOuVariavelFinal !== null)   { updateFields.push('fixa_ou_variavel=?'); updateVals.push(fixaOuVariavelFinal) }
  if (meioPagEdit !== undefined)      { updateFields.push('meio_pagamento=?');  updateVals.push(meioPagEdit) }
  if (vencimento !== undefined)       { updateFields.push('vencimento=?');       updateVals.push(vencimento || null) }
  if (observacoes !== undefined)      { updateFields.push('observacoes=?');      updateVals.push(observacoes || null) }

  updateVals.push(id, user.id)

  await c.env.DB.prepare(
    `UPDATE despesas SET ${updateFields.join(', ')} WHERE id=? AND user_id=?`
  ).bind(...updateVals).run()

  // Sincronizar card_charges quando o valor mudou e ha cartao vinculado
  if (despesaAtual?.cartao_id && valorEditNum !== Number(despesaAtual.valor)) {
    const charge = await c.env.DB.prepare('SELECT * FROM card_charges WHERE expense_id=?').bind(id).first() as any
    if (charge) {
      const diffValor = valorEditNum - Number(despesaAtual.valor)
      await c.env.DB.prepare('UPDATE card_charges SET valor=? WHERE expense_id=?').bind(valorEditNum, id).run()
      // Se pendente, ajustar limite disponivel do cartao
      if (charge.status === 'pendente') {
        await c.env.DB.prepare(
          'UPDATE cartoes SET limite_disponivel = MAX(0, limite_disponivel - ?) WHERE id=? AND user_id=?'
        ).bind(diffValor, despesaAtual.cartao_id, user.id).run()
      }
    }
  }

  return c.json({ success: true, message: 'Despesa atualizada!' })
})

// PATCH /api/despesas/:id/status
despesas.patch('/:id/status', requireAuth, async (c) => {
  const user = c.get('user')
  const id = c.req.param('id')
  const { status } = await c.req.json()

  // B8/M-D2: validar enum de status antes de qualquer query
  const statusValidos = ['pago', 'pendente', 'cancelado']
  if (!status || !statusValidos.includes(status)) {
    return c.json({ error: `Status inválido. Use: ${statusValidos.join(', ')}` }, 400)
  }

  const existing = await c.env.DB.prepare(
    'SELECT * FROM despesas WHERE id = ? AND user_id = ?'
  ).bind(id, user.id).first() as any
  if (!existing) return c.json({ error: 'Despesa não encontrada' }, 404)

  await c.env.DB.prepare('UPDATE despesas SET status = ? WHERE id = ? AND user_id = ?').bind(status, id, user.id).run()

  // Sincronizar card_charge vinculado (baixa bidirecional)
  if (existing.cartao_id) {
    const charge = await c.env.DB.prepare(
      'SELECT * FROM card_charges WHERE expense_id = ?'
    ).bind(id).first() as any
    if (charge && charge.status !== status) {
      await c.env.DB.prepare('UPDATE card_charges SET status = ? WHERE id = ?').bind(
        status === 'pago' ? 'pago' : 'pendente', charge.id
      ).run()
      // Restaurar limite ao pagar
      if (status === 'pago' && charge.status === 'pendente') {
        await c.env.DB.prepare(
          'UPDATE cartoes SET limite_disponivel = MIN(limite_total, limite_disponivel + ?) WHERE id = ? AND user_id = ?'
        ).bind(Number(existing.valor), existing.cartao_id, user.id).run()
      }
      // Decrementar limite ao despagar
      if (status !== 'pago' && charge.status === 'pago') {
        await c.env.DB.prepare(
          'UPDATE cartoes SET limite_disponivel = MAX(0, limite_disponivel - ?) WHERE id = ? AND user_id = ?'
        ).bind(Number(existing.valor), existing.cartao_id, user.id).run()
      }
    }
  }

  // Conquistas: disciplinado (7 dias consecutivos com despesas pagas) e poupador
  if (status === 'pago') {
    try {
      const mes = new Date().toISOString().slice(0, 7) // YYYY-MM

      // BUG 1.5 FIX: disciplinado = 7 dias consecutivos com pelo menos 1 despesa paga
      // Usar JULIANDAY para verificar consecutividade
      const diasConsec = await c.env.DB.prepare(`
        WITH dias AS (
          SELECT DISTINCT date(data) as dia
          FROM despesas
          WHERE user_id = ? AND status = 'pago'
            AND strftime('%Y-%m', data) = ?
          ORDER BY dia DESC
        ),
        ranked AS (
          SELECT dia, julianday(dia) - ROW_NUMBER() OVER (ORDER BY dia DESC) as grp
          FROM dias
        )
        SELECT COUNT(*) as total FROM ranked
        GROUP BY grp
        ORDER BY total DESC LIMIT 1
      `).bind(user.id, mes).first() as any
      if ((diasConsec?.total || 0) >= 7) await verificarConquistaDespesa(c.env.DB, user.id, 'disciplinado')

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

// PATCH /api/despesas/:id — atualizar status (e opcionalmente data) de uma despesa
// Chamado pelo dashboard no botão "pagar" dos próximos vencimentos
despesas.patch('/:id', requireAuth, async (c) => {
  const user = c.get('user')
  const id = c.req.param('id')
  // Rejeitar IDs que não são numéricos (evitar capturar rotas como /bulk-pagar)
  if (!/^\d+$/.test(id)) return c.json({ error: 'ID inválido' }, 400)

  const body = await c.req.json()
  const { status, data: dataBody } = body

  const statusValidos = ['pago', 'pendente', 'cancelado']
  if (!status || !statusValidos.includes(status)) {
    return c.json({ error: `Status inválido. Use: ${statusValidos.join(', ')}` }, 400)
  }

  const existing = await c.env.DB.prepare(
    'SELECT * FROM despesas WHERE id = ? AND user_id = ?'
  ).bind(id, user.id).first() as any
  if (!existing) return c.json({ error: 'Despesa não encontrada' }, 404)

  // Atualizar status e, se fornecida, a data de pagamento
  if (dataBody) {
    await c.env.DB.prepare(
      'UPDATE despesas SET status = ?, data = ?, data_pagamento = ? WHERE id = ? AND user_id = ?'
    ).bind(status, dataBody, status === 'pago' ? dataBody : null, id, user.id).run()
  } else {
    await c.env.DB.prepare(
      'UPDATE despesas SET status = ? WHERE id = ? AND user_id = ?'
    ).bind(status, id, user.id).run()
  }

  // Sincronizar card_charge vinculado
  if (existing.cartao_id) {
    const charge = await c.env.DB.prepare(
      'SELECT * FROM card_charges WHERE expense_id = ?'
    ).bind(id).first() as any
    if (charge && charge.status !== status) {
      await c.env.DB.prepare('UPDATE card_charges SET status = ? WHERE id = ?').bind(
        status === 'pago' ? 'pago' : 'pendente', charge.id
      ).run()
      if (status === 'pago' && charge.status === 'pendente') {
        await c.env.DB.prepare(
          'UPDATE cartoes SET limite_disponivel = MIN(limite_total, limite_disponivel + ?) WHERE id = ? AND user_id = ?'
        ).bind(Number(existing.valor), existing.cartao_id, user.id).run()
      }
      if (status !== 'pago' && charge.status === 'pago') {
        await c.env.DB.prepare(
          'UPDATE cartoes SET limite_disponivel = MAX(0, limite_disponivel - ?) WHERE id = ? AND user_id = ?'
        ).bind(Number(existing.valor), existing.cartao_id, user.id).run()
      }
    }
  }

  return c.json({ success: true, message: `Status atualizado para ${status}!` })
})

// DELETE /api/despesas/bulk — excluir múltiplas despesas de uma vez
// ATENÇÃO: deve ficar ANTES de DELETE /:id
despesas.delete('/bulk', requireAuth, async (c) => {
  const user = c.get('user')
  const body = await c.req.json().catch(() => null)
  const ids: number[] = body?.ids || []
  if (!ids.length) return c.json({ error: 'Nenhum id informado.' }, 400)
  if (ids.length > 200) return c.json({ error: 'Máximo 200 itens por vez.' }, 400)

  let excluidas = 0
  for (const id of ids) {
    const existing = await c.env.DB.prepare(
      'SELECT * FROM despesas WHERE id = ? AND user_id = ?'
    ).bind(id, user.id).first() as any
    if (!existing) continue

    // Devolver limite ao cartão se pendente
    if (existing.cartao_id && existing.status === 'pendente') {
      const meioPagCartao = ['cartao_credito', 'parcelado_cartao']
      if (meioPagCartao.includes(existing.meio_pagamento)) {
        await c.env.DB.prepare(
          'UPDATE cartoes SET limite_disponivel = MIN(limite_total, limite_disponivel + ?) WHERE id = ? AND user_id = ?'
        ).bind(Number(existing.valor), existing.cartao_id, user.id).run()
      }
    }
    // Remover card_charge vinculado
    if (existing.cartao_id) {
      await c.env.DB.prepare('DELETE FROM card_charges WHERE expense_id = ?').bind(id).run()
    }
    await c.env.DB.prepare('DELETE FROM despesas WHERE id = ? AND user_id = ?').bind(id, user.id).run()
    excluidas++
  }

  return c.json({ success: true, excluidas, message: `${excluidas} despesa(s) excluída(s).` })
})

// DELETE /api/despesas/:id
despesas.delete('/:id', requireAuth, async (c) => {
  const user = c.get('user')
  const id = c.req.param('id')

  const existing = await c.env.DB.prepare(
    'SELECT * FROM despesas WHERE id = ? AND user_id = ?'
  ).bind(id, user.id).first() as any
  if (!existing) return c.json({ error: 'Despesa não encontrada' }, 404)

  // ── Devolver limite ao cartão quando a despesa está pendente ──
  // Só devolve o valor desta parcela individual (cada parcela ocupa seu próprio espaço no limite)
  if (existing.cartao_id && existing.status === 'pendente') {
    const meioPagCartao = ['cartao_credito', 'parcelado_cartao']
    if (meioPagCartao.includes(existing.meio_pagamento)) {
      await c.env.DB.prepare(
        'UPDATE cartoes SET limite_disponivel = MIN(limite_total, limite_disponivel + ?) WHERE id = ? AND user_id = ?'
      ).bind(Number(existing.valor), existing.cartao_id, user.id).run()
    }
  }

  // ── Remover card_charge vinculado ──
  if (existing.cartao_id) {
    await c.env.DB.prepare(
      'DELETE FROM card_charges WHERE expense_id = ?'
    ).bind(id).run()
  }

  await c.env.DB.prepare('DELETE FROM despesas WHERE id = ? AND user_id = ?').bind(id, user.id).run()
  return c.json({ success: true, message: 'Despesa excluída!' })
})

async function verificarConquistaDespesa(db: D1Database, userId: number, codigo: string) {
  try {
    await db.prepare('INSERT OR IGNORE INTO conquistas_usuario (user_id, conquista_codigo, visualizado) VALUES (?, ?, 0)').bind(userId, codigo).run()
  } catch {}
}

export default despesas
