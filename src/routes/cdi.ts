import { Hono } from 'hono'
import { requireAuth } from './auth'

type Bindings  = { DB: D1Database }
type Variables = { user: { id: number; nome: string; plano: string } }

const cdi = new Hono<{ Bindings: Bindings; Variables: Variables }>()

// CDI padrão caso BCB não responda
const CDI_FALLBACK = 13.65

// ─── GET /api/cdi/atual ──────────────────────────────────────────────────────
cdi.get('/atual', async (c) => {
  // 1. Buscar no cache local (última entrada do histórico)
  const cached = await c.env.DB.prepare(
    `SELECT taxa, data FROM cdi_historico ORDER BY data DESC LIMIT 1`
  ).first<{taxa:number; data:string}>().catch(() => null)

  const hoje = new Date()
  const ontem = new Date(hoje); ontem.setDate(hoje.getDate() - 1)
  const cacheData = cached?.data ? new Date(cached.data) : null
  const cacheValido = cacheData && (hoje.getTime() - cacheData.getTime()) < 2 * 24 * 60 * 60 * 1000 // 2 dias

  if (cacheValido && cached) {
    return c.json({
      taxa_diaria:  cached.taxa,
      cdi_anual:    calcularAnual(cached.taxa),
      data:         cached.data,
      source:       'BCB',
    })
  }

  // 2. Buscar na API do BCB (série 12 = CDI diário)
  try {
    const dataFim  = formatDateBCB(hoje)
    const dataIni  = formatDateBCB(new Date(hoje.getTime() - 10 * 24 * 60 * 60 * 1000))
    const url = `https://api.bcb.gov.br/dados/serie/bcdata.sgs.12/dados?formato=json&dataInicial=${dataIni}&dataFinal=${dataFim}`

    const resp = await fetch(url, {
      headers: { 'Accept': 'application/json' },
      signal:  AbortSignal.timeout(5000)
    })

    if (resp.ok) {
      const dados = await resp.json() as Array<{data:string; valor:string}>
      if (Array.isArray(dados) && dados.length > 0) {
        // Ordenar por data decrescente
        const sorted = dados.sort((a, b) => parseDataBCB(b.data) - parseDataBCB(a.data))
        const ultimo = sorted[0]
        const taxa   = parseFloat(ultimo.valor)
        const dataSql = isoDateBCB(ultimo.data)

        // Salvar histórico dos últimos dias no D1
        for (const d of sorted.slice(0, 5)) {
          const t = parseFloat(d.valor)
          const dt = isoDateBCB(d.data)
          await c.env.DB.prepare(
            `INSERT OR IGNORE INTO cdi_historico (data, taxa) VALUES (?, ?)`
          ).bind(dt, t).run().catch(() => {})
        }

        // Atualizar CDI atual em todos os investimentos do tipo caixinha
        await c.env.DB.prepare(
          `UPDATE investimentos SET cdi_atual = ? WHERE tipo = 'caixinha'`
        ).bind(calcularAnual(taxa)).run().catch(() => {})

        return c.json({
          taxa_diaria:  taxa,
          cdi_anual:    calcularAnual(taxa),
          data:         dataSql,
          source:       'BCB',
        })
      }
    }
  } catch (e) {
    // BCB indisponível — usar fallback
  }

  // 3. Fallback
  return c.json({
    taxa_diaria:  CDI_FALLBACK / 252,
    cdi_anual:    CDI_FALLBACK,
    data:         new Date().toISOString().split('T')[0],
    source:       'BCB',
    aviso:        'BCB indisponível — usando taxa estimada'
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
  // CDI: taxa diária em % → anualizar por 252 dias úteis
  return Math.round((Math.pow(1 + taxaDiaria / 100, 252) - 1) * 10000) / 100
}

function formatDateBCB(d: Date): string {
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const yy = d.getFullYear()
  return `${dd}/${mm}/${yy}`
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
