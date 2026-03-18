import { Hono } from 'hono'
import { requireAuth } from './auth'

type Bindings  = { DB: D1Database }
type Variables = { user: { id: number; nome: string; plano: string } }

const cdi = new Hono<{ Bindings: Bindings; Variables: Variables }>()

// CDI padrão caso BCB não responda
const CDI_FALLBACK = 13.65
// Cache em memória para evitar múltiplas chamadas ao D1 na mesma instância
let _memCache: { taxa: number; anual: number; data: string; ts: number } | null = null

// ─── GET /api/cdi/atual ──────────────────────────────────────────────────────
cdi.get('/atual', async (c) => {
  const now = Date.now()

  // 0. Cache em memória (válido por 6 horas — CDI não muda durante o dia)
  if (_memCache && now - _memCache.ts < 6 * 60 * 60 * 1000) {
    return c.json({
      taxa_diaria: _memCache.taxa,
      cdi_anual:   _memCache.anual,
      data:        _memCache.data,
      source:      'BCB',
      cache:       'memory'
    })
  }

  // 1. Buscar no D1 (cache de banco — válido por 3 dias)
  try {
    const cached = await c.env.DB.prepare(
      `SELECT taxa, data FROM cdi_historico ORDER BY data DESC LIMIT 1`
    ).first<{taxa:number; data:string}>()

    if (cached?.taxa && cached?.data) {
      const cacheDate = new Date(cached.data + 'T00:00:00Z')
      const diffDias = (now - cacheDate.getTime()) / (1000 * 60 * 60 * 24)
      // Aceitar cache de até 3 dias (fins de semana o BCB não atualiza)
      if (diffDias < 3) {
        const anual = calcularAnual(cached.taxa)
        _memCache = { taxa: cached.taxa, anual, data: cached.data, ts: now }
        return c.json({
          taxa_diaria: cached.taxa,
          cdi_anual:   anual,
          data:        cached.data,
          source:      'BCB',
          cache:       'd1'
        })
      }
    }
  } catch (_) {}

  // 2. Buscar na API do BCB (apenas se cache expirado)
  try {
    const hoje = new Date()
    const dataFim = formatDateBCB(hoje)
    const dataIni = formatDateBCB(new Date(hoje.getTime() - 7 * 24 * 60 * 60 * 1000))
    const url = `https://api.bcb.gov.br/dados/serie/bcdata.sgs.12/dados?formato=json&dataInicial=${dataIni}&dataFinal=${dataFim}`

    const resp = await fetch(url, { headers: { 'Accept': 'application/json' } })

    if (resp.ok) {
      const dados = await resp.json() as Array<{data:string; valor:string}>
      if (Array.isArray(dados) && dados.length > 0) {
        const sorted = dados.sort((a, b) => parseDataBCB(b.data) - parseDataBCB(a.data))
        const ultimo = sorted[0]
        const taxa   = parseFloat(ultimo.valor)
        const dataSql = isoDateBCB(ultimo.data)
        const anual = calcularAnual(taxa)

        // Salvar no D1 sem await (não bloquear a resposta)
        const inserts = sorted.slice(0, 5).map(d =>
          c.env.DB.prepare(`INSERT OR IGNORE INTO cdi_historico (data, taxa) VALUES (?, ?)`)
            .bind(isoDateBCB(d.data), parseFloat(d.valor))
        )
        c.env.DB.batch(inserts).catch(() => {})

        // Atualizar caixinhas sem await
        c.env.DB.prepare(`UPDATE investimentos SET cdi_atual = ? WHERE tipo = 'caixinha'`)
          .bind(anual).run().catch(() => {})

        _memCache = { taxa, anual, data: dataSql, ts: now }
        return c.json({ taxa_diaria: taxa, cdi_anual: anual, data: dataSql, source: 'BCB' })
      }
    }
  } catch (_) {}

  // 3. Fallback fixo
  const anualFallback = CDI_FALLBACK
  const taxaFallback  = CDI_FALLBACK / 252
  const dataFallback  = new Date().toISOString().split('T')[0]
  _memCache = { taxa: taxaFallback, anual: anualFallback, data: dataFallback, ts: now - 5 * 60 * 60 * 1000 }
  return c.json({
    taxa_diaria: taxaFallback,
    cdi_anual:   anualFallback,
    data:        dataFallback,
    source:      'BCB',
    aviso:       'BCB indisponível — taxa estimada'
  })
})

// ─── GET /api/cdi/historico?dias=30 ─────────────────────────────────────────
cdi.get('/historico', requireAuth, async (c) => {
  const dias = Math.min(365, parseInt(c.req.query('dias') || '30'))
  const rows = await c.env.DB.prepare(
    `SELECT data, taxa,
            ROUND((POW(1 + taxa/100, 252) - 1) * 100, 4) as taxa_anual
     FROM cdi_historico
     ORDER BY data DESC
     LIMIT ?`
  ).bind(dias).all<{data:string; taxa:number; taxa_anual:number}>()

  return c.json({ historico: rows.results || [] })
})

// ─── Helpers ─────────────────────────────────────────────────────────────────
function calcularAnual(taxaDiaria: number): number {
  return Math.round((Math.pow(1 + taxaDiaria / 100, 252) - 1) * 10000) / 100
}
function formatDateBCB(d: Date): string {
  return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`
}
function parseDataBCB(s: string): number {
  const [dd, mm, yy] = s.split('/')
  return new Date(`${yy}-${mm}-${dd}`).getTime()
}
function isoDateBCB(s: string): string {
  const [dd, mm, yy] = s.split('/')
  return `${yy}-${mm}-${dd}`
}

export default cdi
