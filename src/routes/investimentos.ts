import { Hono } from 'hono'
import { requireAuth } from './auth'
import { getLimites, MSG_UPGRADE } from './planos'

type Bindings = { DB: D1Database }
type Variables = { user: { id: number; nome: string; email: string; plano: string } }

const investimentos = new Hono<{ Bindings: Bindings; Variables: Variables }>()

// CDI padrão de fallback (% ao ano)
const CDI_PADRAO_AA = 13.65

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS — Cotações externas
// ─────────────────────────────────────────────────────────────────────────────

/** Retorna CDI anual: tenta BCB, cai para cache, cai para padrão */
async function getCdiAnual(db: D1Database): Promise<number> {
  try {
    const resp = await fetch(
      'https://api.bcb.gov.br/dados/serie/bcdata.sgs.11/dados/ultimos/1?formato=json',
      { headers: { 'Accept': 'application/json' } }
    )
    if (resp.ok) {
      const data = await resp.json() as any[]
      if (data?.[0]?.valor) {
        // taxa diária → anual: (1 + t/100)^252 - 1
        const taxaDiaria = parseFloat(data[0].valor)
        const cdiAnual = (Math.pow(1 + taxaDiaria / 100, 252) - 1) * 100
        // Salvar no cache
        await db.prepare(
          `INSERT OR REPLACE INTO cotacoes_cache (tipo, symbol, valor_brl, dados_json, atualizado_em)
           VALUES ('cdi','CDI',?,?,datetime('now'))`
        ).bind(Math.round(cdiAnual * 100) / 100, JSON.stringify({ taxa_diaria: taxaDiaria, taxa_anual: cdiAnual })).run()
        return Math.round(cdiAnual * 100) / 100
      }
    }
  } catch (_) {}

  // Tentar do cache (aceita dados de até 1 dia)
  try {
    const cached = await db.prepare(
      `SELECT valor_brl FROM cotacoes_cache
       WHERE tipo='cdi' AND symbol='CDI' AND atualizado_em >= datetime('now','-1 day')`
    ).first() as any
    if (cached?.valor_brl) return cached.valor_brl
  } catch (_) {}

  return CDI_PADRAO_AA
}

/** Busca cotações de câmbio: USD, EUR, GBP via DolarApi.com */
async function getCotacoesCambio(db: D1Database): Promise<Record<string, { compra: number; venda: number; nome: string }>> {
  const moedas = ['usd', 'eur', 'gbp']
  const resultado: Record<string, any> = {}

  // Tentar do cache primeiro (aceita até 30 min)
  try {
    const cached = await db.prepare(
      `SELECT symbol, valor_brl, dados_json FROM cotacoes_cache
       WHERE tipo='cambio' AND atualizado_em >= datetime('now','-30 minutes')`
    ).all()
    if ((cached.results as any[]).length >= 2) {
      for (const row of cached.results as any[]) {
        const dados = row.dados_json ? JSON.parse(row.dados_json) : {}
        resultado[row.symbol] = dados
      }
      if (Object.keys(resultado).length >= 2) return resultado
    }
  } catch (_) {}

  // Buscar da API
  for (const m of moedas) {
    try {
      const resp = await fetch(`https://br.dolarapi.com/v1/cotacoes/${m}`)
      if (resp.ok) {
        const data = await resp.json() as any
        resultado[data.moeda] = { compra: data.compra, venda: data.venda, nome: data.nome }
        await db.prepare(
          `INSERT OR REPLACE INTO cotacoes_cache (tipo, symbol, valor_brl, dados_json, atualizado_em)
           VALUES ('cambio',?,?,?,datetime('now'))`
        ).bind(data.moeda, data.compra, JSON.stringify({ compra: data.compra, venda: data.venda, nome: data.nome })).run()
      }
    } catch (_) {}
  }
  return resultado
}

/** Busca preços de cripto via CoinGecko (sem API key) */
async function getCotacoesCripto(db: D1Database, symbols: string[]): Promise<Record<string, { brl: number; usd: number; variacao_24h: number }>> {
  const resultado: Record<string, any> = {}
  if (!symbols.length) return resultado

  // Mapa de symbol CoinGecko
  const COINGECKO_MAP: Record<string, string> = {
    'BTC': 'bitcoin', 'ETH': 'ethereum', 'BNB': 'binancecoin',
    'SOL': 'solana', 'ADA': 'cardano', 'DOGE': 'dogecoin',
    'XRP': 'ripple', 'DOT': 'polkadot', 'AVAX': 'avalanche-2',
    'MATIC': 'matic-network', 'LINK': 'chainlink', 'UNI': 'uniswap',
    'LTC': 'litecoin', 'ATOM': 'cosmos', 'FIL': 'filecoin'
  }

  // Verificar cache (30 minutos)
  const upperSymbols = symbols.map(s => s.toUpperCase())
  try {
    const cached = await db.prepare(
      `SELECT symbol, valor_brl, valor_usd, variacao_24h FROM cotacoes_cache
       WHERE tipo='cripto' AND atualizado_em >= datetime('now','-30 minutes')`
    ).all()
    const cachedMap: Record<string, any> = {}
    for (const r of cached.results as any[]) cachedMap[r.symbol] = r
    const faltando = upperSymbols.filter(s => !cachedMap[s])
    for (const s of upperSymbols) {
      if (cachedMap[s]) resultado[s] = { brl: cachedMap[s].valor_brl, usd: cachedMap[s].valor_usd, variacao_24h: cachedMap[s].variacao_24h }
    }
    if (!faltando.length) return resultado
  } catch (_) {}

  // Buscar da CoinGecko
  const ids = upperSymbols
    .map(s => COINGECKO_MAP[s])
    .filter(Boolean)
    .join(',')

  if (!ids) return resultado

  try {
    const resp = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=brl,usd&include_24hr_change=true`
    )
    if (resp.ok) {
      const data = await resp.json() as any
      // Inverter mapa para encontrar symbol pelo id
      const invertedMap: Record<string, string> = {}
      for (const [sym, id] of Object.entries(COINGECKO_MAP)) invertedMap[id as string] = sym

      for (const [id, precos] of Object.entries(data) as any[]) {
        const sym = invertedMap[id]
        if (!sym) continue
        const item = { brl: precos.brl, usd: precos.usd, variacao_24h: precos.usd_24h_change || 0 }
        resultado[sym] = item
        try {
          await db.prepare(
            `INSERT OR REPLACE INTO cotacoes_cache (tipo, symbol, valor_brl, valor_usd, variacao_24h, dados_json, atualizado_em)
             VALUES ('cripto',?,?,?,?,?,datetime('now'))`
          ).bind(sym, item.brl, item.usd, item.variacao_24h, JSON.stringify(item)).run()
        } catch (_) {}
      }
    }
  } catch (_) {}

  return resultado
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers internos
// ─────────────────────────────────────────────────────────────────────────────
function calcularCaixinha(valorInvestido: number, percentualCdi: number, cdiAnual: number, diasDecorridos: number): number {
  const cdiDiario = Math.pow(1 + cdiAnual / 100, 1 / 252) - 1
  const taxaDiaria = cdiDiario * (percentualCdi / 100)
  return valorInvestido * Math.pow(1 + taxaDiaria, diasDecorridos)
}

async function verificarConquista(db: D1Database, userId: number, codigo: string) {
  try {
    await db.prepare('INSERT OR IGNORE INTO conquistas_usuario (user_id, conquista_codigo, visualizado) VALUES (?, ?, 0)').bind(userId, codigo).run()
  } catch { }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/investimentos/cotacoes — cotações ao vivo (público, sem auth)
// ─────────────────────────────────────────────────────────────────────────────
investimentos.get('/cotacoes', async (c) => {
  const db = c.env.DB

  const [cdi, cambio, cripto] = await Promise.all([
    getCdiAnual(db),
    getCotacoesCambio(db),
    getCotacoesCripto(db, ['BTC', 'ETH', 'BNB', 'SOL', 'ADA', 'DOGE', 'XRP'])
  ])

  // SELIC via BCB
  let selic = 14.90
  try {
    const resp = await fetch('https://api.bcb.gov.br/dados/serie/bcdata.sgs.1178/dados/ultimos/1?formato=json')
    if (resp.ok) {
      const d = await resp.json() as any[]
      if (d?.[0]?.valor) selic = parseFloat(d[0].valor)
    }
  } catch (_) {}

  return c.json({
    atualizado_em: new Date().toISOString(),
    taxas_referencia: { cdi_anual: cdi, selic_meta: selic },
    cambio,
    cripto,
    aviso: 'Cotações com cache de 30 min. Fontes: BCB, DolarApi.com, CoinGecko.'
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// S-I1: GET /api/investimentos/resumo-por-tipo
// ─────────────────────────────────────────────────────────────────────────────
investimentos.get('/resumo-por-tipo', requireAuth, async (c) => {
  const user = c.get('user')

  const rows = await c.env.DB.prepare(
    `SELECT tipo,
            COUNT(*) as qtd,
            COALESCE(SUM(valor_investido),0) as total_investido,
            COALESCE(SUM(valor_atual),0) as total_atual
     FROM investimentos WHERE user_id = ?
     GROUP BY tipo ORDER BY total_atual DESC`
  ).bind(user.id).all()

  const totalAtual = (rows.results as any[]).reduce((s, r) => s + Number(r.total_atual), 0)
  const totalInv   = (rows.results as any[]).reduce((s, r) => s + Number(r.total_investido), 0)

  const porTipo = (rows.results as any[]).map(r => {
    const ta = Number(r.total_atual)
    const ti = Number(r.total_investido)
    return {
      tipo: r.tipo,
      qtd: Number(r.qtd),
      total_investido: Math.round(ti * 100) / 100,
      total_atual: Math.round(ta * 100) / 100,
      lucro_prejuizo: Math.round((ta - ti) * 100) / 100,
      rentabilidade: ti > 0 ? Math.round(((ta - ti) / ti) * 10000) / 100 : 0,
      percentual_carteira: totalAtual > 0 ? Math.round((ta / totalAtual) * 10000) / 100 : 0
    }
  })

  return c.json({
    total_investido: Math.round(totalInv * 100) / 100,
    total_atual: Math.round(totalAtual * 100) / 100,
    lucro_total: Math.round((totalAtual - totalInv) * 100) / 100,
    rentabilidade_total: totalInv > 0 ? Math.round(((totalAtual - totalInv) / totalInv) * 10000) / 100 : 0,
    por_tipo: porTipo
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// S-I3: GET /api/investimentos/comparativo-cdi
// ─────────────────────────────────────────────────────────────────────────────
investimentos.get('/comparativo-cdi', requireAuth, async (c) => {
  const user = c.get('user')
  const cdiAnual = await getCdiAnual(c.env.DB)

  const rows = await c.env.DB.prepare(
    `SELECT id, nome, tipo, valor_investido, valor_atual, rentabilidade_percentual, data_inicio, percentual_cdi
     FROM investimentos WHERE user_id = ? ORDER BY rentabilidade_percentual DESC`
  ).bind(user.id).all()

  const lista = (rows.results as any[]).map(inv => {
    const vi = Number(inv.valor_investido)
    const va = Number(inv.valor_atual)
    const dataInicio = new Date(inv.data_inicio + 'T00:00:00')
    const diasDecorridos = Math.max(1, Math.floor((Date.now() - dataInicio.getTime()) / 86400000))
    const anosDecorridos = diasDecorridos / 365

    // Rentabilidade anualizada do ativo
    const rentAnualAtivo = vi > 0 && anosDecorridos > 0
      ? (Math.pow(va / vi, 1 / anosDecorridos) - 1) * 100 : 0

    // Rentabilidade CDI no mesmo período
    const cdiPeriodo = (Math.pow(1 + cdiAnual / 100, anosDecorridos) - 1) * 100

    return {
      id: inv.id,
      nome: inv.nome,
      tipo: inv.tipo,
      valor_investido: vi,
      valor_atual: Math.round(va * 100) / 100,
      rentabilidade_total: Math.round(((va - vi) / vi) * 10000) / 100,
      rentabilidade_anualizada: Math.round(rentAnualAtivo * 100) / 100,
      cdi_anual: cdiAnual,
      cdi_periodo: Math.round(cdiPeriodo * 100) / 100,
      vs_cdi: Math.round((rentAnualAtivo - cdiAnual) * 100) / 100,
      status_vs_cdi: rentAnualAtivo >= cdiAnual ? 'acima_cdi' : 'abaixo_cdi',
      dias_decorridos: diasDecorridos,
      percentual_cdi_capturado: cdiAnual > 0 ? Math.round((rentAnualAtivo / cdiAnual) * 10000) / 100 : 0
    }
  })

  const acimaCdi = lista.filter(i => i.status_vs_cdi === 'acima_cdi').length
  return c.json({ cdi_atual: cdiAnual, investimentos: lista, resumo: { total: lista.length, acima_cdi: acimaCdi, abaixo_cdi: lista.length - acimaCdi } })
})

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/investimentos
// ─────────────────────────────────────────────────────────────────────────────
investimentos.get('/', requireAuth, async (c) => {
  const user = c.get('user')
  const result = await c.env.DB.prepare(
    'SELECT * FROM investimentos WHERE user_id = ? ORDER BY valor_atual DESC'
  ).bind(user.id).all()

  const cdiAnual = await getCdiAnual(c.env.DB)

  // Buscar símbolos cripto dos investimentos
  const cryptoInvs = (result.results as any[]).filter(i => i.tipo === 'cripto' && i.symbol)
  const cryptoSymbols = [...new Set(cryptoInvs.map(i => i.symbol.toUpperCase()))]
  const cotacoesCripto = cryptoSymbols.length > 0 ? await getCotacoesCripto(c.env.DB, cryptoSymbols) : {}

  const lista = (result.results as any[]).map(inv => {
    let valorAtualCalc = inv.valor_atual
    let rentab = inv.rentabilidade_percentual || 0
    let cotacaoInfo: any = null

    if (inv.tipo === 'caixinha' && inv.percentual_cdi && inv.data_inicio) {
      const dataInicio = new Date(inv.data_inicio + 'T00:00:00')
      const diasDecorridos = Math.max(0, Math.floor((Date.now() - dataInicio.getTime()) / 86400000))
      const cdiEfetivo = inv.cdi_atual || cdiAnual
      valorAtualCalc = calcularCaixinha(inv.valor_investido, inv.percentual_cdi, cdiEfetivo, diasDecorridos)
      rentab = inv.valor_investido > 0 ? ((valorAtualCalc - inv.valor_investido) / inv.valor_investido) * 100 : 0
      cotacaoInfo = { cdi_anual: cdiEfetivo, percentual_cdi: inv.percentual_cdi, dias_decorridos: diasDecorridos, cdi_info: `${inv.percentual_cdi}% do CDI (${cdiEfetivo}% a.a.)` }
    } else if (inv.tipo === 'cripto' && inv.symbol) {
      const sym = inv.symbol.toUpperCase()
      const cot = cotacoesCripto[sym]
      if (cot && cot.brl) {
        cotacaoInfo = { preco_brl: cot.brl, preco_usd: cot.usd, variacao_24h: Math.round(cot.variacao_24h * 100) / 100, symbol: sym }
      }
    }

    // Progresso em relação à meta
    const meta_valor = inv.meta_valor
    const progresso_meta = meta_valor && meta_valor > 0
      ? Math.min(100, Math.round((valorAtualCalc / meta_valor) * 10000) / 100) : null

    return {
      ...inv,
      tags: inv.tags ? (() => { try { return JSON.parse(inv.tags) } catch { return [] } })() : [],
      valor_atual: Math.round(valorAtualCalc * 100) / 100,
      rentabilidade_percentual: Math.round(rentab * 100) / 100,
      progresso_meta,
      cotacao_ao_vivo: cotacaoInfo
    }
  })

  const total_investido = lista.reduce((s, i) => s + i.valor_investido, 0)
  const total_atual = lista.reduce((s, i) => s + i.valor_atual, 0)
  const lucro_prejuizo = Math.round((total_atual - total_investido) * 100) / 100
  const rentabilidade_total = total_investido > 0 ? ((total_atual - total_investido) / total_investido) * 100 : 0
  const rentabilidade_media = lista.length > 0
    ? lista.reduce((s, i) => s + (i.rentabilidade_percentual || 0), 0) / lista.length : 0

  return c.json({
    investimentos: lista,
    cdi_atual: cdiAnual,
    resumo: {
      total_investido: Math.round(total_investido * 100) / 100,
      total_atual: Math.round(total_atual * 100) / 100,
      rentabilidade_total: Math.round(rentabilidade_total * 100) / 100,
      lucro_prejuizo,
      total_rendimento: lucro_prejuizo,
      rentabilidade_media: Math.round(rentabilidade_media * 100) / 100,
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/investimentos
// ─────────────────────────────────────────────────────────────────────────────
investimentos.post('/', requireAuth, async (c) => {
  const user = c.get('user')

  const lim = getLimites(user.plano)
  if (lim.investimentos !== Infinity) {
    const count = await c.env.DB.prepare('SELECT COUNT(*) as n FROM investimentos WHERE user_id = ?').bind(user.id).first() as any
    if ((count?.n || 0) >= lim.investimentos)
      return c.json({ error: MSG_UPGRADE.investimentos, upgrade: true, limite: lim.investimentos, feature: 'investimentos' }, 403)
  }

  const body = await c.req.json()
  const {
    nome, tipo, valor_investido, rentabilidade_percentual = 0, risco = 'baixo',
    data_inicio, data_vencimento, instituicao, observacoes,
    percentual_cdi = null, cdi_atual: cdiBody = null,
    registrar_aporte = false, registra_saida_saldo = true,
    meta_valor = null,  // S-I4
    tags = null,        // S-I5
    symbol = null       // S-I2: símbolo do ativo (ex: 'BTC', 'ITUB4')
  } = body

  if (!nome || !tipo || !valor_investido || !data_inicio)
    return c.json({ error: 'Campos obrigatórios: nome, tipo, valor_investido, data_inicio' }, 400)

  // Buscar CDI atualizado se necessário
  const cdiAnual = tipo === 'caixinha' ? await getCdiAnual(c.env.DB) : CDI_PADRAO_AA
  const cdiEfetivo = cdiBody ? parseFloat(cdiBody) : cdiAnual

  let valor_atual = parseFloat(valor_investido)
  let rentab = parseFloat(rentabilidade_percentual)

  if (tipo === 'caixinha' && percentual_cdi) {
    const dataInicio = new Date(data_inicio + 'T00:00:00')
    const diasDecorridos = Math.max(0, Math.floor((Date.now() - dataInicio.getTime()) / 86400000))
    if (diasDecorridos > 0) {
      valor_atual = calcularCaixinha(parseFloat(valor_investido), parseFloat(percentual_cdi), cdiEfetivo, diasDecorridos)
      rentab = ((valor_atual - parseFloat(valor_investido)) / parseFloat(valor_investido)) * 100
    }
  } else if (tipo !== 'caixinha') {
    valor_atual = parseFloat(valor_investido) * (1 + parseFloat(rentabilidade_percentual) / 100)
  }

  const registraSaidaFinal = registra_saida_saldo !== undefined ? !!registra_saida_saldo : !!registrar_aporte
  const tagsStr = Array.isArray(tags) ? JSON.stringify(tags) : (tags || null)

  const result = await c.env.DB.prepare(
    `INSERT INTO investimentos
       (user_id, nome, tipo, valor_investido, rentabilidade_percentual, valor_atual, risco,
        data_inicio, data_vencimento, instituicao, observacoes, percentual_cdi, cdi_atual,
        data_ultimo_calculo, registra_saida_saldo, meta_valor, tags, symbol)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    user.id, nome, tipo, parseFloat(valor_investido), Math.round(rentab * 100) / 100,
    Math.round(valor_atual * 100) / 100, risco, data_inicio,
    data_vencimento || null, instituicao || null, observacoes || null,
    percentual_cdi ? parseFloat(percentual_cdi) : null,
    tipo === 'caixinha' ? cdiEfetivo : null,
    tipo === 'caixinha' ? new Date().toISOString().split('T')[0] : null,
    registraSaidaFinal ? 1 : 0,
    meta_valor ? parseFloat(meta_valor) : null,
    tagsStr,
    symbol ? symbol.toUpperCase() : null
  ).run()

  if (registraSaidaFinal && parseFloat(valor_investido) > 0) {
    await c.env.DB.prepare(
      `INSERT INTO despesas (user_id, descricao, data, categoria, subcategoria, valor, status, meio_pagamento, tipo, eh_aporte_patrimonial, observacoes)
       VALUES (?, ?, ?, 'Aporte Patrimonial', 'Investimento', ?, 'pago', 'transferencia', 'aporte', 1, ?)`
    ).bind(user.id, `Aporte: ${nome}`, data_inicio, parseFloat(valor_investido), `Aporte em ${tipo.toUpperCase()} — ${nome}`).run()
  }

  // Conquistas
  const tipoConquistas: Record<string, string> = {
    caixinha: 'investidor_cdi', acoes: 'investidor_acoes', fii: 'investidor_fii',
    cripto: 'investidor_cripto', tesouro_direto: 'investidor_tesouro', cdb: 'investidor_cdb'
  }
  if (tipoConquistas[tipo]) await verificarConquista(c.env.DB, user.id, tipoConquistas[tipo])
  await verificarConquista(c.env.DB, user.id, 'investidor')

  const [totalInv, tiposDistintos] = await Promise.all([
    c.env.DB.prepare('SELECT COALESCE(SUM(valor_atual), 0) as total FROM investimentos WHERE user_id = ?').bind(user.id).first() as any,
    c.env.DB.prepare('SELECT COUNT(DISTINCT tipo) as cnt FROM investimentos WHERE user_id = ?').bind(user.id).first() as any
  ])
  if ((totalInv?.total || 0) >= 10000) await verificarConquista(c.env.DB, user.id, 'poupador_dedicado')
  if ((totalInv?.total || 0) >= 100000) await verificarConquista(c.env.DB, user.id, 'milionario')
  if ((tiposDistintos?.cnt || 0) >= 3) await verificarConquista(c.env.DB, user.id, 'investidor_diversificado')

  return c.json({ success: true, id: result.meta.last_row_id, message: 'Investimento adicionado!' }, 201)
})

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/investimentos/:id
// ─────────────────────────────────────────────────────────────────────────────
investimentos.put('/:id', requireAuth, async (c) => {
  const user = c.get('user')
  const id = c.req.param('id')

  const existing = await c.env.DB.prepare('SELECT * FROM investimentos WHERE id = ? AND user_id = ?').bind(id, user.id).first() as any
  if (!existing) return c.json({ error: 'Investimento não encontrado' }, 404)

  const body = await c.req.json()
  const { nome, tipo, valor_investido, rentabilidade_percentual, valor_atual: vAtualBody,
    risco, data_inicio, data_vencimento, instituicao, observacoes,
    percentual_cdi = null, cdi_atual: cdiBody = null,
    meta_valor, tags, symbol } = body

  const cdiAnual = tipo === 'caixinha' ? await getCdiAnual(c.env.DB) : CDI_PADRAO_AA
  const cdiEfetivo = cdiBody ? parseFloat(cdiBody) : cdiAnual

  let valor_atual = vAtualBody ? parseFloat(vAtualBody) : parseFloat(valor_investido || existing.valor_investido)
  let rentab = parseFloat(rentabilidade_percentual ?? existing.rentabilidade_percentual ?? 0)

  if (tipo === 'caixinha' && percentual_cdi) {
    const dataInicio = new Date((data_inicio || existing.data_inicio) + 'T00:00:00')
    const diasDecorridos = Math.max(0, Math.floor((Date.now() - dataInicio.getTime()) / 86400000))
    if (diasDecorridos > 0) {
      valor_atual = calcularCaixinha(parseFloat(valor_investido || existing.valor_investido), parseFloat(percentual_cdi), cdiEfetivo, diasDecorridos)
      rentab = ((valor_atual - parseFloat(valor_investido || existing.valor_investido)) / parseFloat(valor_investido || existing.valor_investido)) * 100
    }
  }

  const tagsStr = tags !== undefined
    ? (Array.isArray(tags) ? JSON.stringify(tags) : (tags || null))
    : existing.tags

  await c.env.DB.prepare(
    `UPDATE investimentos SET nome=?, tipo=?, valor_investido=?, rentabilidade_percentual=?, valor_atual=?,
     risco=?, data_inicio=?, data_vencimento=?, instituicao=?, observacoes=?,
     percentual_cdi=?, cdi_atual=?, data_ultimo_calculo=?, meta_valor=?, tags=?, symbol=?
     WHERE id = ? AND user_id = ?`
  ).bind(
    nome ?? existing.nome, tipo ?? existing.tipo,
    parseFloat(valor_investido ?? existing.valor_investido),
    Math.round(rentab * 100) / 100, Math.round(valor_atual * 100) / 100,
    risco ?? existing.risco, data_inicio ?? existing.data_inicio,
    data_vencimento !== undefined ? (data_vencimento || null) : existing.data_vencimento,
    instituicao !== undefined ? (instituicao || null) : existing.instituicao,
    observacoes !== undefined ? (observacoes || null) : existing.observacoes,
    percentual_cdi ? parseFloat(percentual_cdi) : existing.percentual_cdi,
    (tipo || existing.tipo) === 'caixinha' ? cdiEfetivo : existing.cdi_atual,
    (tipo || existing.tipo) === 'caixinha' ? new Date().toISOString().split('T')[0] : existing.data_ultimo_calculo,
    meta_valor !== undefined ? (meta_valor ? parseFloat(meta_valor) : null) : existing.meta_valor,
    tagsStr,
    symbol !== undefined ? (symbol ? symbol.toUpperCase() : null) : existing.symbol,
    id, user.id
  ).run()

  const [totalInvAtualizado, tiposDistintosAtualizados] = await Promise.all([
    c.env.DB.prepare('SELECT COALESCE(SUM(valor_atual), 0) as total FROM investimentos WHERE user_id = ?').bind(user.id).first() as any,
    c.env.DB.prepare('SELECT COUNT(DISTINCT tipo) as cnt FROM investimentos WHERE user_id = ?').bind(user.id).first() as any
  ])
  if ((totalInvAtualizado?.total || 0) >= 10000) await verificarConquista(c.env.DB, user.id, 'poupador_dedicado')
  if ((totalInvAtualizado?.total || 0) >= 100000) await verificarConquista(c.env.DB, user.id, 'milionario')
  if ((tiposDistintosAtualizados?.cnt || 0) >= 3) await verificarConquista(c.env.DB, user.id, 'investidor_diversificado')

  return c.json({ success: true, message: 'Investimento atualizado!' })
})

// ─────────────────────────────────────────────────────────────────────────────
// S-I2: PATCH /api/investimentos/:id/rebalancear — novo aporte no mesmo ativo
// ─────────────────────────────────────────────────────────────────────────────
investimentos.patch('/:id/rebalancear', requireAuth, async (c) => {
  const user = c.get('user')
  const id   = c.req.param('id')

  const inv = await c.env.DB.prepare('SELECT * FROM investimentos WHERE id = ? AND user_id = ?').bind(id, user.id).first() as any
  if (!inv) return c.json({ error: 'Investimento não encontrado' }, 404)

  const { valor, descricao = 'Rebalanceamento', registrar_despesa = true } = await c.req.json()
  if (!valor || parseFloat(valor) <= 0)
    return c.json({ error: 'Informe um valor de aporte maior que zero' }, 400)

  const novoValorInvestido = Number(inv.valor_investido) + parseFloat(valor)
  const novoValorAtual     = Number(inv.valor_atual) + parseFloat(valor)

  await c.env.DB.prepare(
    `UPDATE investimentos SET valor_investido=?, valor_atual=? WHERE id=? AND user_id=?`
  ).bind(novoValorInvestido, novoValorAtual, id, user.id).run()

  if (registrar_despesa) {
    await c.env.DB.prepare(
      `INSERT INTO despesas (user_id, descricao, data, categoria, subcategoria, valor, status, meio_pagamento, tipo, eh_aporte_patrimonial)
       VALUES (?, ?, ?, 'Aporte Patrimonial', 'Investimento', ?, 'pago', 'transferencia', 'aporte', 1)`
    ).bind(user.id, descricao || `Aporte: ${inv.nome}`, new Date().toISOString().split('T')[0], parseFloat(valor)).run()
  }

  // Verificar conquistas
  const totalInv = await c.env.DB.prepare('SELECT COALESCE(SUM(valor_atual), 0) as total FROM investimentos WHERE user_id = ?').bind(user.id).first() as any
  if ((totalInv?.total || 0) >= 10000) await verificarConquista(c.env.DB, user.id, 'poupador_dedicado')
  if ((totalInv?.total || 0) >= 100000) await verificarConquista(c.env.DB, user.id, 'milionario')

  return c.json({
    success: true,
    aporte: parseFloat(valor),
    novo_valor_investido: Math.round(novoValorInvestido * 100) / 100,
    novo_valor_atual: Math.round(novoValorAtual * 100) / 100,
    message: `Aporte de R$ ${parseFloat(valor).toFixed(2)} registrado em ${inv.nome}!`
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/investimentos/:id
// ─────────────────────────────────────────────────────────────────────────────
investimentos.delete('/:id', requireAuth, async (c) => {
  const user = c.get('user')
  const id = c.req.param('id')
  const existing = await c.env.DB.prepare('SELECT id FROM investimentos WHERE id = ? AND user_id = ?').bind(id, user.id).first()
  if (!existing) return c.json({ error: 'Investimento não encontrado' }, 404)
  await c.env.DB.prepare('DELETE FROM investimentos WHERE id = ? AND user_id = ?').bind(id, user.id).run()
  return c.json({ success: true, message: 'Investimento excluído!' })
})

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/investimentos/simulacao
// ─────────────────────────────────────────────────────────────────────────────
investimentos.get('/simulacao', async (c) => {
  const { valor, tipo, prazo_meses = '12', taxa_personalizada, percentual_cdi } = c.req.query()
  if (!valor || !tipo) return c.json({ error: 'Parâmetros: valor, tipo, prazo_meses' }, 400)

  // Buscar CDI real
  let CDI_EFETIVO = CDI_PADRAO_AA
  try {
    const resp = await fetch('https://api.bcb.gov.br/dados/serie/bcdata.sgs.11/dados/ultimos/1?formato=json')
    if (resp.ok) {
      const d = await resp.json() as any[]
      if (d?.[0]?.valor) CDI_EFETIVO = (Math.pow(1 + parseFloat(d[0].valor) / 100, 252) - 1) * 100
    }
  } catch (_) {}

  const taxas: Record<string, number> = {
    poupanca: 0.005, cdb: 0.009, lci: 0.0085, lca: 0.0085,
    tesouro_direto: 0.0083, acoes: 0.012, fii: 0.008,
    cripto: 0.02, caixinha: 0, outros: 0.007
  }

  let taxaMensal: number
  if (tipo === 'caixinha' && percentual_cdi) {
    const cdiMensal = Math.pow(1 + CDI_EFETIVO / 100, 1 / 12) - 1
    taxaMensal = cdiMensal * (parseFloat(percentual_cdi) / 100)
  } else {
    taxaMensal = taxa_personalizada ? parseFloat(taxa_personalizada) / 100 : (taxas[tipo] || 0.008)
  }

  const valorInicial = parseFloat(valor)
  const meses = parseInt(prazo_meses)
  const projecao = []
  let valorAtual = valorInicial

  for (let mes = 1; mes <= meses; mes++) {
    valorAtual = valorAtual * (1 + taxaMensal)
    if (mes % 3 === 0 || mes === meses) {
      projecao.push({ mes, valor: Math.round(valorAtual * 100) / 100, lucro: Math.round((valorAtual - valorInicial) * 100) / 100 })
    }
  }

  const valorFinal = valorInicial * Math.pow(1 + taxaMensal, meses)
  return c.json({
    simulacao: {
      valor_inicial: valorInicial, tipo, prazo_meses: meses,
      taxa_mensal: Math.round(taxaMensal * 10000) / 100,
      valor_final: Math.round(valorFinal * 100) / 100,
      lucro_total: Math.round((valorFinal - valorInicial) * 100) / 100,
      rentabilidade_total: Math.round(((valorFinal / valorInicial) - 1) * 10000) / 100,
      projecao
    },
    cdi_atual: Math.round(CDI_EFETIVO * 100) / 100,
    aviso: tipo === 'caixinha'
      ? `Simulação com ${percentual_cdi || 100}% do CDI (CDI atual: ${Math.round(CDI_EFETIVO * 100) / 100}% a.a.). Rentabilidade calculada com capitalização diária.`
      : 'Esta é uma simulação educacional. Rentabilidades passadas não garantem resultados futuros.'
  })
})

export default investimentos
