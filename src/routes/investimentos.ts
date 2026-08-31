import { Hono } from 'hono'
import { requireAuth } from './auth'
import { getLimites, MSG_UPGRADE, exigeFeature } from './planos'
import { ensureTag, tagInvestimento, COR_MODULO } from '../utils/tags-helper'
import { normalizarData, ERRO_DATA } from '../lib/validacao'

type Bindings = { DB: D1Database }
type Variables = { user: { id: number; nome: string; email: string; plano: string } }

const investimentos = new Hono<{ Bindings: Bindings; Variables: Variables }>()

// ── Validação de entrada (Postgres estrito: NaN passa no CHECK) ───────────────
const MAX_VALOR = 1_000_000_000
const RISCOS_VALIDOS = ['baixo', 'medio', 'médio', 'alto']
function parseValorPositivo(v: unknown): number | null {
  if (typeof v === 'string' && !/^\d+(\.\d+)?$/.test(v.trim())) return null
  const n = typeof v === 'number' ? v : parseFloat(String(v))
  if (!Number.isFinite(n) || n <= 0 || n > MAX_VALOR) return null
  return Math.round(n * 100) / 100
}
function parseFloatFinito(v: unknown): number | null {
  const n = parseFloat(String(v))
  return Number.isFinite(n) ? n : null
}
function parseIdInv(v: unknown): number | null {
  const t = String(v ?? '')
  return /^\d+$/.test(t) && parseInt(t, 10) > 0 ? parseInt(t, 10) : null
}
function parseInteiroEntre(v: unknown, min: number, max: number, def: number): number | null {
  if (v === undefined || v === null || v === '') return def
  const n = parseInt(String(v), 10)
  return Number.isInteger(n) && n >= min && n <= max ? n : null
}

// CDI padrão de fallback (% ao ano)
const CDI_PADRAO_AA = 13.65

// ─── Cache em memória global (por instância do Worker) ───────────────────────
// Evita chamadas repetidas às APIs externas dentro da janela de cache
let _memCacheCotacoes: {
  ts: number
  cdi: number
  selic: number
  cambio: Record<string, any>
  cripto: Record<string, any>
  aviso: string
} | null = null
const MEM_CACHE_TTL_MS = 20 * 60 * 1000 // 20 min — refresca antes dos 30 min do D1

// Cache em memória para CDI (atualizado pelo módulo cdi.ts via D1, mas usado aqui diretamente)
let _memCdi: { value: number; ts: number } | null = null
const MEM_CDI_TTL_MS = 6 * 60 * 60 * 1000 // 6 horas

/** Helper: fetch com timeout */
async function fetchWithTimeout(url: string, timeoutMs = 4000, opts: RequestInit = {}): Promise<Response> {
  const ctrl = new AbortController()
  const tid = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const resp = await fetch(url, { ...opts, signal: ctrl.signal })
    clearTimeout(tid)
    return resp
  } catch (e) {
    clearTimeout(tid)
    throw e
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS — Cotações externas
// ─────────────────────────────────────────────────────────────────────────────

/** Retorna CDI anual: memória → D1 cache → BCB → fallback */
async function getCdiAnual(db: D1Database): Promise<number> {
  const now = Date.now()

  // 0. Cache em memória (6h)
  if (_memCdi && now - _memCdi.ts < MEM_CDI_TTL_MS) return _memCdi.value

  // 1. Tentar do D1 cache (aceita dados de até 1 dia)
  try {
    const cached = await db.prepare(
      `SELECT valor_brl FROM cotacoes_cache
       WHERE tipo='cdi' AND symbol='CDI' AND atualizado_em >= datetime('now','-1 day')`
    ).first() as any
    if (cached?.valor_brl) {
      _memCdi = { value: cached.valor_brl, ts: now }
      return cached.valor_brl
    }
  } catch (_) {}

  // 2. BCB API com timeout de 3s
  try {
    const resp = await fetchWithTimeout(
      'https://api.bcb.gov.br/dados/serie/bcdata.sgs.11/dados/ultimos/1?formato=json',
      3000,
      { headers: { 'Accept': 'application/json' } }
    )
    if (resp.ok) {
      const data = await resp.json() as any[]
      if (data?.[0]?.valor) {
        const taxaDiaria = parseFloat(data[0].valor)
        const cdiAnual = Math.round((Math.pow(1 + taxaDiaria / 100, 252) - 1) * 10000) / 100
        // Salvar no cache sem bloquear
        db.prepare(
          `INSERT OR REPLACE INTO cotacoes_cache (tipo, symbol, valor_brl, dados_json, atualizado_em)
           VALUES ('cdi','CDI',?,?,datetime('now'))`
        ).bind(cdiAnual, JSON.stringify({ taxa_diaria: taxaDiaria, taxa_anual: cdiAnual })).run().catch(() => {})
        _memCdi = { value: cdiAnual, ts: now }
        return cdiAnual
      }
    }
  } catch (_) {}

  _memCdi = { value: CDI_PADRAO_AA, ts: now - MEM_CDI_TTL_MS + 5 * 60 * 1000 } // expira em 5min p/ retry
  return CDI_PADRAO_AA
}

/** Busca cotações de câmbio: USD, EUR via DolarApi.com (paralelo, não sequencial) */
async function getCotacoesCambio(db: D1Database): Promise<Record<string, { compra: number; venda: number; nome: string }>> {
  const resultado: Record<string, any> = {}

  // Cache-first: aceita até 30 min
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

  // Buscar USD e EUR em PARALELO com timeout de 4s cada
  const moedas = ['usd', 'eur']
  const resps = await Promise.allSettled(
    moedas.map(m =>
      fetchWithTimeout(`https://br.dolarapi.com/v1/cotacoes/${m}`, 4000)
        .then(r => r.ok ? r.json() : null)
        .catch(() => null)
    )
  )

  for (const r of resps) {
    if (r.status !== 'fulfilled' || !r.value) continue
    const data = r.value as any
    if (!data?.moeda) continue
    resultado[data.moeda] = { compra: data.compra, venda: data.venda, nome: data.nome }
    db.prepare(
      `INSERT OR REPLACE INTO cotacoes_cache (tipo, symbol, valor_brl, dados_json, atualizado_em)
       VALUES ('cambio',?,?,?,datetime('now'))`
    ).bind(data.moeda, data.compra, JSON.stringify({ compra: data.compra, venda: data.venda, nome: data.nome })).run().catch(() => {})
  }
  return resultado
}

/** Busca preços de cripto via CoinGecko (sem API key) */
async function getCotacoesCripto(db: D1Database, symbols: string[]): Promise<Record<string, { brl: number; usd: number; variacao_24h: number }>> {
  const resultado: Record<string, any> = {}
  if (!symbols.length) return resultado

  // Mapa de symbol CoinGecko (fallback)
  const COINGECKO_MAP: Record<string, string> = {
    'BTC': 'bitcoin', 'ETH': 'ethereum', 'BNB': 'binancecoin',
    'SOL': 'solana', 'ADA': 'cardano', 'DOGE': 'dogecoin',
    'XRP': 'ripple', 'DOT': 'polkadot', 'AVAX': 'avalanche-2',
    'MATIC': 'matic-network', 'LINK': 'chainlink', 'UNI': 'uniswap',
    'LTC': 'litecoin', 'ATOM': 'cosmos', 'FIL': 'filecoin'
  }

  const upperSymbols = symbols.map(s => s.toUpperCase())

  // Verificar cache (30 minutos)
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

  // ── Fonte 1: CryptoCompare (suporta Cloudflare Workers, dados em BRL direto)
  let btcFallbackOk = false
  try {
    const symList = upperSymbols.filter(s => ['BTC','ETH','BNB','SOL','XRP','ADA','DOGE','LTC','DOT','AVAX'].includes(s))
    if (symList.length > 0) {
      const url = `https://min-api.cryptocompare.com/data/pricemultifull?fsyms=${symList.join(',')}&tsyms=BRL,USD`
      const resp = await fetchWithTimeout(url, 5000)
      if (resp.ok) {
        const data = await resp.json() as any
        const raw = data?.RAW || {}
        const dbOps: Promise<any>[] = []
        for (const sym of symList) {
          if (!raw[sym]?.BRL) continue
          const brlData = raw[sym].BRL
          const usdData = raw[sym].USD || {}
          const brl = brlData.PRICE || 0
          const usd = usdData.PRICE || 0
          const variacao_24h = brlData.CHANGEPCT24HOUR || 0
          const item = { brl: Math.round(brl * 100) / 100, usd: Math.round(usd * 100) / 100, variacao_24h: Math.round(variacao_24h * 100) / 100 }
          resultado[sym] = item
          btcFallbackOk = true
          dbOps.push(
            db.prepare(
              `INSERT OR REPLACE INTO cotacoes_cache (tipo, symbol, valor_brl, valor_usd, variacao_24h, dados_json, atualizado_em)
               VALUES ('cripto',?,?,?,?,?,datetime('now'))`
            ).bind(sym, item.brl, item.usd, item.variacao_24h, JSON.stringify(item)).run().catch(() => {})
          )
        }
        // Writes em paralelo, sem bloquear
        Promise.all(dbOps).catch(() => {})
      }
    }
  } catch (_) {}

  // ── Fonte 2: Mercado Bitcoin (API BR) + Kraken (fallback)
  if (!btcFallbackOk) {
    try {
      // Buscar BTC em BRL direto do Mercado Bitcoin
      const mbSyms: Record<string, string> = { BTC: 'BTC', ETH: 'ETH', XRP: 'XRP', SOL: 'SOL' }
      const usdBrl = 5.23
      let usdRate = usdBrl

      // Tentar câmbio via dolarapi (já usado no cambio)
      try {
        const camb = await fetchWithTimeout('https://economia.awesomeapi.com.br/json/last/USD-BRL', 3000)
        if (camb.ok) {
          const cd = await camb.json() as any
          usdRate = parseFloat(cd?.USDBRL?.bid || usdBrl)
        }
      } catch (_) {}

      // Buscar cotações via Kraken (USD para conversão)
      const krakenPairs: Record<string, string> = { BTC: 'XBTUSD', ETH: 'ETHUSD', XRP: 'XRPUSD', SOL: 'SOLUSD', ADA: 'ADAUSD', DOGE: 'DOGEUSD', LTC: 'LTCUSD', DOT: 'DOTUSD' }
      const krakenSyms = upperSymbols.filter(s => krakenPairs[s])
      if (krakenSyms.length > 0) {
        const pair = krakenSyms.map(s => krakenPairs[s]).join(',')
        const resp = await fetchWithTimeout(`https://api.kraken.com/0/public/Ticker?pair=${pair}`, 5000)
        if (resp.ok) {
          const data = await resp.json() as any
          const krakenResult = data?.result || {}
          // Mapa inverso: par kraken -> symbol
          const pairToSym: Record<string, string> = {}
          for (const sym of krakenSyms) {
            const p = krakenPairs[sym]
            // Kraken às vezes retorna com 'X' prefix
            pairToSym[p] = sym
            pairToSym['X' + p] = sym
            pairToSym[p.replace('USD','ZUSD')] = sym
            pairToSym['X' + p.slice(0,-3) + 'ZUSD'] = sym
          }
          for (const [krakenPair, ticker] of Object.entries(krakenResult) as any[]) {
            const sym = pairToSym[krakenPair]
            if (!sym || !ticker?.c?.[0]) continue
            const usd = parseFloat(ticker.c[0])
            const brl = Math.round(usd * usdRate * 100) / 100
            const open = parseFloat(ticker?.o || ticker?.c?.[0] || usd)
            const variacao_24h = open > 0 ? Math.round(((usd - open) / open) * 10000) / 100 : 0
            const item = { brl, usd, variacao_24h }
            resultado[sym] = item
            btcFallbackOk = true
            try {
              await db.prepare(
                `INSERT OR REPLACE INTO cotacoes_cache (tipo, symbol, valor_brl, valor_usd, variacao_24h, dados_json, atualizado_em)
                 VALUES ('cripto',?,?,?,?,?,datetime('now'))`
              ).bind(sym, brl, usd, variacao_24h, JSON.stringify(item)).run()
            } catch (_) {}
          }
        }
      }
    } catch (_) {}
  }

  return resultado
}

// ─────────────────────────────────────────────────────────────────────────────
// Fallback de cotações cripto — valores de referência quando APIs falham
// ─────────────────────────────────────────────────────────────────────────────
async function getCotacoesCriptoFallback(db: D1Database, symbols: string[], usdBrl: number): Promise<Record<string, { brl: number; usd: number; variacao_24h: number }>> {
  // Valores fixos de referência (USD) — atualizados periodicamente no código
  const REF_USD: Record<string, number> = {
    BTC: 74000, ETH: 2330, BNB: 670, SOL: 150, XRP: 2.5,
    ADA: 0.45, DOGE: 0.17, DOT: 7.5, AVAX: 30, MATIC: 0.55,
    LINK: 15, LTC: 85, ATOM: 8
  }
  const resultado: Record<string, any> = {}
  const rate = usdBrl || 5.23
  for (const sym of symbols.map(s => s.toUpperCase())) {
    const usd = REF_USD[sym]
    if (!usd) continue
    const brl = Math.round(usd * rate * 100) / 100
    resultado[sym] = { brl, usd, variacao_24h: 0 }
    try {
      // Salvar fallback no cache por 5 minutos apenas
      await db.prepare(
        `INSERT OR REPLACE INTO cotacoes_cache (tipo, symbol, valor_brl, valor_usd, variacao_24h, dados_json, atualizado_em)
         VALUES ('cripto',?,?,?,?,?,datetime('now','-25 minutes'))`
      ).bind(sym, brl, usd, 0, JSON.stringify({ brl, usd, variacao_24h: 0, fallback: true })).run()
    } catch (_) {}
  }
  return resultado
}


// Conta apenas dias úteis (seg-sex) entre duas datas
function contarDiasUteis(dataInicio: Date, dataFim: Date): number {
  let dias = 0
  const cur = new Date(dataInicio)
  cur.setHours(0, 0, 0, 0)
  const fim = new Date(dataFim)
  fim.setHours(0, 0, 0, 0)
  while (cur < fim) {
    const dow = cur.getDay()
    if (dow !== 0 && dow !== 6) dias++ // 0=dom, 6=sab
    cur.setDate(cur.getDate() + 1)
  }
  return dias
}

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
// Estratégia: stale-while-revalidate
//   - Retorna cache D1 imediatamente se existir (< 35 min) → resposta rápida
//   - Se cache tem > 20 min, dispara atualização em background (waitUntil)
//   - Se cache expirado/vazio, busca ao vivo e retorna
// ─────────────────────────────────────────────────────────────────────────────
investimentos.get('/cotacoes', requireAuth, async (c) => {   // INV18: era a única rota sem auth — expunha dados e disparava chamadas externas
  const db = c.env.DB
  const now = Date.now()

  // 0. Cache em memória — resposta instantânea se ainda válido (mesma instância)
  if (_memCacheCotacoes && now - _memCacheCotacoes.ts < MEM_CACHE_TTL_MS) {
    return c.json({
      atualizado_em: new Date(_memCacheCotacoes.ts).toISOString(),
      taxas_referencia: { cdi_anual: _memCacheCotacoes.cdi, selic_meta: _memCacheCotacoes.selic },
      cambio: _memCacheCotacoes.cambio,
      cripto: _memCacheCotacoes.cripto,
      aviso: _memCacheCotacoes.aviso,
      cache: 'memory'
    })
  }

  // 1. Verificar D1 para retorno rápido (stale-while-revalidate)
  try {
    const [cachedCambio, cachedCripto, cachedCdi] = await Promise.all([
      db.prepare(`SELECT symbol, dados_json, atualizado_em FROM cotacoes_cache WHERE tipo='cambio'`).all(),
      db.prepare(`SELECT symbol, valor_brl, valor_usd, variacao_24h, atualizado_em FROM cotacoes_cache WHERE tipo='cripto'`).all(),
      db.prepare(`SELECT valor_brl, atualizado_em FROM cotacoes_cache WHERE tipo='cdi' AND symbol='CDI' LIMIT 1`).first() as any
    ])

    const cambioRows = (cachedCambio.results as any[])
    const criptoRows = (cachedCripto.results as any[])

    // Checar idade do cache (35 min = stale mas ainda servível)
    const ageMsCambio = cambioRows.length > 0
      ? now - new Date(cambioRows[0].atualizado_em + 'Z').getTime() : Infinity
    const ageMsCripto = criptoRows.length > 0
      ? now - new Date(criptoRows[0].atualizado_em + 'Z').getTime() : Infinity
    const STALE_MS = 35 * 60 * 1000
    const REFRESH_MS = 20 * 60 * 1000

    if (cambioRows.length >= 2 && criptoRows.length >= 3 && ageMsCambio < STALE_MS && ageMsCripto < STALE_MS) {
      // Montar resposta do cache
      const cambioCache: Record<string, any> = {}
      for (const r of cambioRows) {
        const d = r.dados_json ? JSON.parse(r.dados_json) : {}
        cambioCache[r.symbol] = d
      }
      const criptoCache: Record<string, any> = {}
      for (const r of criptoRows) {
        criptoCache[r.symbol] = { brl: r.valor_brl, usd: r.valor_usd, variacao_24h: r.variacao_24h }
      }
      const cdiCache = cachedCdi?.valor_brl || CDI_PADRAO_AA

      // Salvar em memória
      _memCacheCotacoes = { ts: now, cdi: cdiCache, selic: 14.90, cambio: cambioCache, cripto: criptoCache,
        aviso: 'Cotações com cache de 30 min. Fontes: BCB, DolarApi.com, Kraken, CoinGecko.' }

      // Se cache está ficando velho (>20 min), atualizar em background
      if (ageMsCambio > REFRESH_MS || ageMsCripto > REFRESH_MS) {
        // Fire-and-forget: atualiza sem bloquear resposta
        Promise.all([
          getCotacoesCambio(db),
          getCotacoesCripto(db, ['BTC', 'ETH', 'BNB', 'SOL', 'ADA', 'DOGE', 'XRP'])
        ]).then(([nc, ncr]) => {
          if (Object.keys(nc).length >= 2 || Object.keys(ncr).length >= 3) {
            _memCacheCotacoes = { ts: Date.now(), cdi: cdiCache, selic: 14.90,
              cambio: Object.keys(nc).length >= 2 ? nc : cambioCache,
              cripto: Object.keys(ncr).length >= 3 ? ncr : criptoCache,
              aviso: 'Cotações com cache de 30 min. Fontes: BCB, DolarApi.com, Kraken, CoinGecko.' }
          }
        }).catch(() => {})
      }

      return c.json({
        atualizado_em: new Date().toISOString(),
        taxas_referencia: { cdi_anual: cdiCache, selic_meta: 14.90 },
        cambio: cambioCache,
        cripto: criptoCache,
        aviso: 'Cotações com cache de 30 min. Fontes: BCB, DolarApi.com, Kraken, CoinGecko.',
        cache: 'd1'
      })
    }
  } catch (_) {}

  // 2. Cache vazio/expirado: buscar tudo em PARALELO — CDI, câmbio, cripto e SELIC
  const [cdi, cambio, cripto, selicResult] = await Promise.all([
    getCdiAnual(db),
    getCotacoesCambio(db),
    getCotacoesCripto(db, ['BTC', 'ETH', 'BNB', 'SOL', 'ADA', 'DOGE', 'XRP']),
    // SELIC com timeout de 3s para não travar a resposta
    fetchWithTimeout(
      'https://api.bcb.gov.br/dados/serie/bcdata.sgs.1178/dados/ultimos/1?formato=json', 3000
    ).then(r => r.ok ? r.json() : null).then((d: any) => d?.[0]?.valor ? parseFloat(d[0].valor) : 14.90).catch(() => 14.90)
  ])

  // 3. Fallback de cripto se todas as APIs retornaram vazio
  const usdRate = (cambio as any)?.USD?.compra || 5.23
  const criptoFinal = Object.keys(cripto).length > 0 ? cripto
    : await getCotacoesCriptoFallback(db, ['BTC', 'ETH', 'BNB', 'SOL', 'XRP'], usdRate)

  const aviso = Object.keys(cripto).length === 0
    ? 'Cotações cripto via valores de referência (APIs indisponíveis). Câmbio: BCB/DolarApi.'
    : 'Cotações com cache de 30 min. Fontes: BCB, DolarApi.com, Kraken, CoinGecko.'

  // 4. Salvar em memória para próximas requisições
  _memCacheCotacoes = { ts: now, cdi, selic: selicResult, cambio, cripto: criptoFinal, aviso }

  return c.json({
    atualizado_em: new Date().toISOString(),
    taxas_referencia: { cdi_anual: cdi, selic_meta: selicResult },
    cambio,
    cripto: criptoFinal,
    aviso
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
    const diasDecorridos = Math.max(1, contarDiasUteis(dataInicio, new Date()))
    const anosDecorridos = diasDecorridos / 252 // 252 dias úteis/ano

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
      // Usa apenas dias úteis (seg-sex) para refletir mercado financeiro real
      const diasDecorridos = contarDiasUteis(dataInicio, new Date())
      const cdiEfetivo = inv.cdi_atual || cdiAnual
      valorAtualCalc = calcularCaixinha(inv.valor_investido, inv.percentual_cdi, cdiEfetivo, diasDecorridos)
      rentab = inv.valor_investido > 0 ? ((valorAtualCalc - inv.valor_investido) / inv.valor_investido) * 100 : 0
      cotacaoInfo = { cdi_anual: cdiEfetivo, percentual_cdi: inv.percentual_cdi, dias_decorridos: diasDecorridos, dias_uteis: true, cdi_info: `${inv.percentual_cdi}% do CDI (${cdiEfetivo}% a.a.) — ${diasDecorridos} dias úteis` }
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

  // Mapa de aliases para compatibilidade
  const tipoAliases: Record<string,string> = {
    renda_fixa: 'cdb', renda_variavel: 'acoes', fundo: 'outros',
    acao: 'acoes', bitcoin: 'cripto', etf: 'outros'
  }
  const tipoNorm = tipoAliases[tipo.toLowerCase()] || tipo.toLowerCase()
  const tiposValidos = ['tesouro_direto','cdb','lci','lca','acoes','fii','cripto','poupanca','caixinha','outros']
  if (!tiposValidos.includes(tipoNorm))
    return c.json({ error: `Tipo inválido. Use: ${tiposValidos.join(', ')}`, aliases: tipoAliases }, 400)

  // usar tipoNorm daqui em diante
  const tipoFinal = tipoNorm

  // INV1/INV11: valor_investido finito e positivo (era parseFloat cru — 'abc' virava
  // NaN e zerava o patrimônio na tela; negativo passava).
  const valorInvNum = parseValorPositivo(valor_investido)
  if (valorInvNum === null) return c.json({ error: 'valor_investido deve ser um número maior que zero.' }, 400)
  const rentabNum = parseFloatFinito(rentabilidade_percentual ?? 0)   // pode ser negativa (prejuízo), mas número
  if (rentabNum === null) return c.json({ error: 'rentabilidade_percentual deve ser um número.' }, 400)
  // INV14: risco validado (era 500 do CHECK do banco)
  if (!RISCOS_VALIDOS.includes(String(risco).toLowerCase()))
    return c.json({ error: 'risco inválido. Use: baixo, medio ou alto.' }, 400)
  // INV12: data_inicio validada; INV13: vencimento não anterior ao início
  const dataInicioISO = normalizarData(data_inicio)
  if (!dataInicioISO) return c.json({ error: `data_inicio: ${ERRO_DATA}` }, 400)
  let dataVencISO: string | null = null
  if (data_vencimento) {
    dataVencISO = normalizarData(data_vencimento)
    if (!dataVencISO) return c.json({ error: `data_vencimento: ${ERRO_DATA}` }, 400)
    if (dataVencISO < dataInicioISO) return c.json({ error: 'data_vencimento não pode ser anterior à data_inicio.' }, 400)
  }

  // Buscar CDI atualizado se necessário
  const cdiAnual = tipoFinal === 'caixinha' ? await getCdiAnual(c.env.DB) : CDI_PADRAO_AA
  const cdiEfetivo = cdiBody ? parseFloat(cdiBody) : cdiAnual

  let valor_atual = valorInvNum
  let rentab = rentabNum

  if (tipoFinal === 'caixinha' && percentual_cdi) {
    const dataInicio = new Date(dataInicioISO + 'T00:00:00')
    const diasDecorridos = Math.max(0, contarDiasUteis(dataInicio, new Date()))
    if (diasDecorridos > 0) {
      valor_atual = calcularCaixinha(valorInvNum, parseFloat(percentual_cdi), cdiEfetivo, diasDecorridos)
      rentab = ((valor_atual - valorInvNum) / valorInvNum) * 100
    }
  } else if (tipoFinal !== 'caixinha') {
    valor_atual = valorInvNum * (1 + rentabNum / 100)
  }
  valor_atual = Math.max(0, valor_atual)   // INV11: −200% não vira patrimônio negativo

  const registraSaidaFinal = registra_saida_saldo !== undefined ? !!registra_saida_saldo : !!registrar_aporte
  const tagsStr = Array.isArray(tags) ? JSON.stringify(tags) : (tags || null)

  const result = await c.env.DB.prepare(
    `INSERT INTO investimentos
       (user_id, nome, tipo, valor_investido, rentabilidade_percentual, valor_atual, risco,
        data_inicio, data_vencimento, instituicao, observacoes, percentual_cdi, cdi_atual,
        data_ultimo_calculo, registra_saida_saldo, meta_valor, tags, symbol)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    user.id, nome, tipoFinal, valorInvNum, Math.round(rentab * 100) / 100,
    Math.round(valor_atual * 100) / 100, risco, dataInicioISO,
    dataVencISO, instituicao || null, observacoes || null,
    percentual_cdi ? parseFloat(percentual_cdi) : null,
    tipoFinal === 'caixinha' ? cdiEfetivo : null,
    tipoFinal === 'caixinha' ? new Date().toISOString().split('T')[0] : null,
    registraSaidaFinal ? 1 : 0,
    meta_valor ? parseFloat(meta_valor) : null,
    tagsStr,
    symbol ? symbol.toUpperCase() : null
  ).run()

  if (registraSaidaFinal && valorInvNum > 0) {
    await c.env.DB.prepare(
      `INSERT INTO despesas (user_id, descricao, data, categoria, subcategoria, valor, status, meio_pagamento, tipo, eh_aporte_patrimonial, observacoes)
       VALUES (?, ?, ?, 'Aporte Patrimonial', 'Investimento', ?, 'pago', 'transferencia', 'aporte', 1, ?)`
    ).bind(user.id, `Aporte: ${nome}`, dataInicioISO, valorInvNum, `Aporte em ${tipoFinal.toUpperCase()} — ${nome}`).run()
  }

  // Conquistas
  const tipoConquistas: Record<string, string> = {
    caixinha: 'investidor_cdi', acoes: 'investidor_acoes', fii: 'investidor_fii',
    cripto: 'investidor_cripto', tesouro_direto: 'investidor_tesouro', cdb: 'investidor_cdb'
  }
  if (tipoConquistas[tipoFinal]) await verificarConquista(c.env.DB, user.id, tipoConquistas[tipoFinal])
  await verificarConquista(c.env.DB, user.id, 'investidor')

  const [totalInv, tiposDistintos] = await Promise.all([
    c.env.DB.prepare('SELECT COALESCE(SUM(valor_atual), 0) as total FROM investimentos WHERE user_id = ?').bind(user.id).first() as any,
    c.env.DB.prepare('SELECT COUNT(DISTINCT tipo) as cnt FROM investimentos WHERE user_id = ?').bind(user.id).first() as any
  ])
  if ((totalInv?.total || 0) >= 10000) await verificarConquista(c.env.DB, user.id, 'poupador_dedicado')
  if ((totalInv?.total || 0) >= 100000) await verificarConquista(c.env.DB, user.id, 'milionario')
  if ((tiposDistintos?.cnt || 0) >= 3) await verificarConquista(c.env.DB, user.id, 'investidor_diversificado')

  // ── Tags automáticas para o investimento ────────────────────────────
  const invId = result.meta.last_row_id as number
  try {
    const tagInvId   = await ensureTag(c.env.DB, user.id, 'Investimento', COR_MODULO.investimento)
    const tagTipoId  = await ensureTag(c.env.DB, user.id, tipoFinal.charAt(0).toUpperCase() + tipoFinal.slice(1), COR_MODULO.investimento)
    const tagNomeId  = await ensureTag(c.env.DB, user.id, nome.trim().slice(0, 30), COR_MODULO.investimento)
    await tagInvestimento(c.env.DB, invId, tagInvId)
    if (tagTipoId !== tagInvId) await tagInvestimento(c.env.DB, invId, tagTipoId)
    if (tagNomeId !== tagInvId && tagNomeId !== tagTipoId) await tagInvestimento(c.env.DB, invId, tagNomeId)
  } catch (_) { /* best-effort */ }

  return c.json({ success: true, id: invId, message: 'Investimento adicionado!' }, 201)
})

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/investimentos/:id
// ─────────────────────────────────────────────────────────────────────────────
investimentos.put('/:id', requireAuth, async (c) => {
  const user = c.get('user')
  const id = parseIdInv(c.req.param('id'))   // INV16
  if (!id) return c.json({ error: 'Investimento não encontrado' }, 404)

  const existing = await c.env.DB.prepare('SELECT * FROM investimentos WHERE id = ? AND user_id = ?').bind(id, user.id).first() as any
  if (!existing) return c.json({ error: 'Investimento não encontrado' }, 404)

  const body = await c.req.json()
  const { nome, tipo, valor_investido, rentabilidade_percentual, valor_atual: vAtualBody,
    risco, data_inicio, data_vencimento, instituicao, observacoes,
    percentual_cdi = null, cdi_atual: cdiBody = null,
    meta_valor, tags, symbol } = body

  // INV15: validar tipo na edição (com aliases), como no POST
  let tipoFinal = existing.tipo
  if (tipo !== undefined) {
    const aliases: Record<string, string> = { renda_fixa: 'cdb', renda_variavel: 'acoes', fundo: 'outros', acao: 'acoes', bitcoin: 'cripto', etf: 'outros' }
    const tn = aliases[String(tipo).toLowerCase()] || String(tipo).toLowerCase()
    const validos = ['tesouro_direto', 'cdb', 'lci', 'lca', 'acoes', 'fii', 'cripto', 'poupanca', 'caixinha', 'outros']
    if (!validos.includes(tn)) return c.json({ error: `Tipo inválido. Use: ${validos.join(', ')}` }, 400)
    tipoFinal = tn
  }
  // INV11: valores validados
  let valorInvNum = Number(existing.valor_investido)
  if (valor_investido !== undefined) { const v = parseValorPositivo(valor_investido); if (v === null) return c.json({ error: 'valor_investido deve ser um número maior que zero.' }, 400); valorInvNum = v }
  if (risco !== undefined && !RISCOS_VALIDOS.includes(String(risco).toLowerCase())) return c.json({ error: 'risco inválido. Use: baixo, medio ou alto.' }, 400)
  // INV12/INV13: datas
  let dataInicioISO = existing.data_inicio
  if (data_inicio !== undefined) { const d = normalizarData(data_inicio); if (!d) return c.json({ error: `data_inicio: ${ERRO_DATA}` }, 400); dataInicioISO = d }
  let dataVencFinal = existing.data_vencimento
  if (data_vencimento !== undefined) {
    if (!data_vencimento) dataVencFinal = null
    else { const d = normalizarData(data_vencimento); if (!d) return c.json({ error: `data_vencimento: ${ERRO_DATA}` }, 400); if (dataInicioISO && d < dataInicioISO) return c.json({ error: 'data_vencimento não pode ser anterior à data_inicio.' }, 400); dataVencFinal = d }
  }

  const cdiAnual = tipoFinal === 'caixinha' ? await getCdiAnual(c.env.DB) : CDI_PADRAO_AA
  const cdiEfetivo = cdiBody ? parseFloat(cdiBody) : cdiAnual

  // INV2: se "valor atual" não vier no corpo, MANTÉM o existente. Antes caía para o
  // valor investido, apagando o lucro (a própria dica do app manda deixar vazio).
  let valor_atual = (vAtualBody !== undefined && vAtualBody !== '' && vAtualBody !== null)
    ? parseFloat(vAtualBody) : Number(existing.valor_atual)
  if (!Number.isFinite(valor_atual)) return c.json({ error: 'valor_atual deve ser um número.' }, 400)
  let rentab = parseFloatFinito(rentabilidade_percentual ?? existing.rentabilidade_percentual ?? 0) ?? 0

  if (tipoFinal === 'caixinha' && percentual_cdi) {
    const dataInicio = new Date((dataInicioISO) + 'T00:00:00')
    const diasDecorridos = Math.max(0, contarDiasUteis(dataInicio, new Date()))
    if (diasDecorridos > 0) {
      valor_atual = calcularCaixinha(valorInvNum, parseFloat(percentual_cdi), cdiEfetivo, diasDecorridos)
      rentab = ((valor_atual - valorInvNum) / valorInvNum) * 100
    }
  }
  valor_atual = Math.max(0, valor_atual)   // INV11

  const tagsStr = tags !== undefined
    ? (Array.isArray(tags) ? JSON.stringify(tags) : (tags || null))
    : existing.tags

  await c.env.DB.prepare(
    `UPDATE investimentos SET nome=?, tipo=?, valor_investido=?, rentabilidade_percentual=?, valor_atual=?,
     risco=?, data_inicio=?, data_vencimento=?, instituicao=?, observacoes=?,
     percentual_cdi=?, cdi_atual=?, data_ultimo_calculo=?, meta_valor=?, tags=?, symbol=?
     WHERE id = ? AND user_id = ?`
  ).bind(
    nome ?? existing.nome, tipoFinal,
    valorInvNum,
    Math.round(rentab * 100) / 100, Math.round(valor_atual * 100) / 100,
    risco ?? existing.risco, dataInicioISO,
    dataVencFinal,
    instituicao !== undefined ? (instituicao || null) : existing.instituicao,
    observacoes !== undefined ? (observacoes || null) : existing.observacoes,
    percentual_cdi ? parseFloat(percentual_cdi) : existing.percentual_cdi,
    tipoFinal === 'caixinha' ? cdiEfetivo : existing.cdi_atual,
    tipoFinal === 'caixinha' ? new Date().toISOString().split('T')[0] : existing.data_ultimo_calculo,
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
  const id   = parseIdInv(c.req.param('id'))   // INV16
  if (!id) return c.json({ error: 'Investimento não encontrado' }, 404)

  const inv = await c.env.DB.prepare('SELECT * FROM investimentos WHERE id = ? AND user_id = ?').bind(id, user.id).first() as any
  if (!inv) return c.json({ error: 'Investimento não encontrado' }, 404)

  const { valor, descricao = 'Rebalanceamento', registrar_despesa = true } = await c.req.json()
  const valorAporte = parseValorPositivo(valor)   // INV1/INV11: finito e positivo
  if (valorAporte === null) return c.json({ error: 'Informe um valor de aporte maior que zero.' }, 400)

  const novoValorInvestido = Number(inv.valor_investido) + valorAporte
  const novoValorAtual     = Number(inv.valor_atual) + valorAporte

  await c.env.DB.prepare(
    `UPDATE investimentos SET valor_investido=?, valor_atual=? WHERE id=? AND user_id=?`
  ).bind(novoValorInvestido, novoValorAtual, id, user.id).run()

  if (registrar_despesa) {
    await c.env.DB.prepare(
      `INSERT INTO despesas (user_id, descricao, data, categoria, subcategoria, valor, status, meio_pagamento, tipo, eh_aporte_patrimonial)
       VALUES (?, ?, ?, 'Aporte Patrimonial', 'Investimento', ?, 'pago', 'transferencia', 'aporte', 1)`
    ).bind(user.id, descricao || `Aporte: ${inv.nome}`, new Date().toISOString().split('T')[0], valorAporte).run()
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
// GET /api/investimentos/:id/historico — histórico de aportes (despesas de aporte)
// ─────────────────────────────────────────────────────────────────────────────
investimentos.get('/:id/historico', requireAuth, async (c) => {
  const user = c.get('user')
  const id   = parseIdInv(c.req.param('id'))   // INV16
  if (!id) return c.json({ error: 'Investimento não encontrado' }, 404)
  const limit  = Math.min(Math.max(1, parseInt(c.req.query('limit')  || '50', 10) || 50), 200)
  const offset = Math.max(0, parseInt(c.req.query('offset') || '0', 10) || 0)

  const inv = await c.env.DB.prepare(
    'SELECT id, nome, valor_investido, valor_atual, tipo FROM investimentos WHERE id = ? AND user_id = ?'
  ).bind(id, user.id).first() as any
  if (!inv) return c.json({ error: 'Investimento não encontrado' }, 404)

  // INV3: filtrar SÓ pelos aportes deste investimento (pelo nome). Antes o
  // `OR descricao LIKE 'Aporte%'` casava TODO aporte de qualquer ativo, então o
  // histórico saía idêntico para todos os investimentos.
  const hist = await c.env.DB.prepare(
    `SELECT id, descricao, data, valor, status, meio_pagamento
     FROM despesas
     WHERE user_id = ? AND eh_aporte_patrimonial = 1 AND descricao LIKE ?
     ORDER BY data DESC LIMIT ? OFFSET ?`
  ).bind(user.id, `%${inv.nome}%`, limit, offset).all()

  const total = await c.env.DB.prepare(
    `SELECT COUNT(*) as n FROM despesas
     WHERE user_id = ? AND eh_aporte_patrimonial = 1 AND descricao LIKE ?`
  ).bind(user.id, `%${inv.nome}%`).first() as any

  const somaAportes = await c.env.DB.prepare(
    `SELECT COALESCE(SUM(valor),0) as total FROM despesas
     WHERE user_id = ? AND eh_aporte_patrimonial = 1 AND descricao LIKE ?`
  ).bind(user.id, `%${inv.nome}%`).first() as any

  return c.json({
    investimento: { id: inv.id, nome: inv.nome, valor_investido: inv.valor_investido, valor_atual: inv.valor_atual },
    historico: hist.results,
    total_registros: Number(total?.n || 0),
    total_aportado: Math.round(Number(somaAportes?.total || 0) * 100) / 100,
    limit,
    offset
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/investimentos/:id/resgate — resgate parcial (deduz valor_investido e valor_atual)
// ─────────────────────────────────────────────────────────────────────────────
investimentos.patch('/:id/resgate', requireAuth, async (c) => {
  const user = c.get('user')
  const id   = parseIdInv(c.req.param('id'))   // INV16
  if (!id) return c.json({ error: 'Investimento não encontrado' }, 404)

  const inv = await c.env.DB.prepare('SELECT * FROM investimentos WHERE id = ? AND user_id = ?').bind(id, user.id).first() as any
  if (!inv) return c.json({ error: 'Investimento não encontrado' }, 404)

  const { valor, descricao = 'Resgate parcial', registrar_receita = false } = await c.req.json()
  const valorNum = parseValorPositivo(valor)
  if (valorNum === null)
    return c.json({ error: 'Informe um valor de resgate maior que zero.' }, 400)

  const valorAtualCalc = Number(inv.valor_atual) || Number(inv.valor_investido)
  if (valorNum > valorAtualCalc)
    return c.json({ error: `Saldo insuficiente. Disponível: R$ ${valorAtualCalc.toFixed(2)}` }, 400)

  // Proporção resgatada para deduzir do valor_investido proporcionalmente
  const proporcao = valorAtualCalc > 0 ? valorNum / valorAtualCalc : 1
  const deduzInvestido = Math.min(Number(inv.valor_investido), Number(inv.valor_investido) * proporcao)

  const novoValorInvestido = Math.max(0, Number(inv.valor_investido) - deduzInvestido)
  const novoValorAtual     = Math.max(0, valorAtualCalc - valorNum)

  await c.env.DB.prepare(
    'UPDATE investimentos SET valor_investido=?, valor_atual=? WHERE id=? AND user_id=?'
  ).bind(Math.round(novoValorInvestido * 100)/100, Math.round(novoValorAtual * 100)/100, id, user.id).run()

  if (registrar_receita) {
    await c.env.DB.prepare(
      `INSERT INTO receitas (user_id, descricao, data, categoria, valor)
       VALUES (?, ?, ?, 'Investimentos', ?)`
    ).bind(user.id, descricao || `Resgate: ${inv.nome}`, new Date().toISOString().split('T')[0], valorNum).run()
  }

  return c.json({
    success: true,
    resgatado: Math.round(valorNum * 100) / 100,
    novo_valor_investido: Math.round(novoValorInvestido * 100) / 100,
    novo_valor_atual:     Math.round(novoValorAtual * 100) / 100,
    message: `Resgate de R$ ${valorNum.toFixed(2)} realizado em ${inv.nome}!`
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/investimentos/vencimentos — CDB/LCI/LCA vencendo nos próximos 30 dias
// ─────────────────────────────────────────────────────────────────────────────
investimentos.get('/vencimentos', requireAuth, async (c) => {
  const user = c.get('user')
  const dias = parseInteiroEntre(c.req.query('dias'), 1, 3650, 30)   // INV17: 'abc'/-5 → 400
  if (dias === null) return c.json({ error: 'dias deve ser um inteiro entre 1 e 3650.' }, 400)

  const res = await c.env.DB.prepare(
    `SELECT id, nome, tipo, valor_investido, valor_atual, data_vencimento, instituicao
     FROM investimentos
     WHERE user_id = ? AND data_vencimento IS NOT NULL
       AND data_vencimento BETWEEN date('now') AND date('now', '+' || ? || ' days')
     ORDER BY data_vencimento ASC`
  ).bind(user.id, dias).all()

  const lista = (res.results as any[]).map(inv => {
    const hoje = new Date()
    const venc = new Date(inv.data_vencimento + 'T00:00:00')
    const diasRestantes = Math.ceil((venc.getTime() - hoje.getTime()) / (1000 * 60 * 60 * 24))
    return { ...inv, dias_para_vencer: diasRestantes }
  })

  return c.json({ vencimentos: lista, total: lista.length })
})

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/investimentos/:id
// ─────────────────────────────────────────────────────────────────────────────
investimentos.delete('/:id', requireAuth, async (c) => {
  const user = c.get('user')
  const id = parseIdInv(c.req.param('id'))   // INV16
  if (!id) return c.json({ error: 'Investimento não encontrado' }, 404)
  const existing = await c.env.DB.prepare('SELECT id FROM investimentos WHERE id = ? AND user_id = ?').bind(id, user.id).first()
  if (!existing) return c.json({ error: 'Investimento não encontrado' }, 404)
  await c.env.DB.prepare('DELETE FROM investimentos WHERE id = ? AND user_id = ?').bind(id, user.id).run()
  return c.json({ success: true, message: 'Investimento excluído!' })
})

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/investimentos/simulacao
// ─────────────────────────────────────────────────────────────────────────────
investimentos.get('/simulacao', requireAuth, exigeFeature('simulacao'), async (c) => {
  const { valor, tipo, prazo_meses = '12', taxa_personalizada, percentual_cdi, aporte_mensal = '0' } = c.req.query()
  if (!valor || !tipo) return c.json({ error: 'Parâmetros: valor, tipo, prazo_meses' }, 400)
  // INV22: valida ANTES de qualquer cálculo — valor=0/abc davam null, prazo=abc
  // simulava zero meses, valor negativo virava "rentabilidade" absurda.
  const valorInicialV = parseValorPositivo(valor)
  if (valorInicialV === null) return c.json({ error: 'valor deve ser um número maior que zero.' }, 400)
  const mesesV = parseInteiroEntre(prazo_meses, 1, 600, 12)
  if (mesesV === null) return c.json({ error: 'prazo_meses deve ser um inteiro entre 1 e 600.' }, 400)
  const aporteV = (aporte_mensal === '' || aporte_mensal === undefined) ? 0 : parseFloat(aporte_mensal)
  if (!Number.isFinite(aporteV) || aporteV < 0) return c.json({ error: 'aporte_mensal deve ser um número maior ou igual a zero.' }, 400)

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

  // Guardas contra NaN: taxa_personalizada / percentual_cdi inválidos não devem
  // contaminar toda a projeção (valores NaN em cada linha).
  let taxaMensal: number
  if (tipo === 'caixinha' && percentual_cdi) {
    const pc = parseFloat(percentual_cdi)
    if (!Number.isFinite(pc) || pc < 0) return c.json({ error: 'percentual_cdi inválido.' }, 400)
    const cdiMensal = Math.pow(1 + CDI_EFETIVO / 100, 1 / 12) - 1
    taxaMensal = cdiMensal * (pc / 100)
  } else if (taxa_personalizada !== undefined && taxa_personalizada !== '') {
    const tp = parseFloat(taxa_personalizada)
    if (!Number.isFinite(tp) || tp < 0 || tp > 100) return c.json({ error: 'taxa_personalizada inválida (0 a 100% a.m.).' }, 400)
    taxaMensal = tp / 100
  } else {
    taxaMensal = taxas[tipo] || 0.008
  }

  const valorInicial = valorInicialV
  const aporteMensal = aporteV
  const meses = mesesV
  const projecao = []
  let valorAtual = valorInicial
  let totalAportado = 0

  for (let mes = 1; mes <= meses; mes++) {
    valorAtual = valorAtual * (1 + taxaMensal) + aporteMensal
    totalAportado += aporteMensal
    if (mes % 3 === 0 || mes === meses) {
      const investidoAcumulado = valorInicial + totalAportado
      projecao.push({
        mes,
        valor: Math.round(valorAtual * 100) / 100,
        lucro: Math.round((valorAtual - investidoAcumulado) * 100) / 100,
        total_investido: Math.round(investidoAcumulado * 100) / 100
      })
    }
  }

  const valorFinal = valorAtual
  const investidoTotal = valorInicial + totalAportado
  return c.json({
    simulacao: {
      valor_inicial: valorInicial,
      aporte_mensal: aporteMensal,
      total_aportado: Math.round(totalAportado * 100) / 100,
      total_investido: Math.round(investidoTotal * 100) / 100,
      tipo,
      prazo_meses: meses,
      taxa_mensal: Math.round(taxaMensal * 10000) / 100,
      valor_final: Math.round(valorFinal * 100) / 100,
      lucro_total: Math.round((valorFinal - investidoTotal) * 100) / 100,
      rentabilidade_total: Math.round(((valorFinal / investidoTotal) - 1) * 10000) / 100,
      projecao
    },
    cdi_atual: Math.round(CDI_EFETIVO * 100) / 100,
    aviso: tipo === 'caixinha'
      ? `Simulacao com ${percentual_cdi || 100}% do CDI (CDI atual: ${Math.round(CDI_EFETIVO * 100) / 100}% a.a.).`
      : 'Esta e uma simulacao educacional. Rentabilidades passadas nao garantem resultados futuros.'
  })
})

export default investimentos
