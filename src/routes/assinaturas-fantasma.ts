import { Hono } from 'hono'
import { requireAuth } from './auth'

type Bindings = { DB: D1Database }
type Variables = { user: { id: number; nome: string; email: string; plano: string } }

const assinaturas = new Hono<{ Bindings: Bindings; Variables: Variables }>()

// Palavras-chave de serviços conhecidos
const SUBSCRIPTION_KEYWORDS: Array<{ keywords: string[]; type: string }> = [
  { keywords: ['netflix', 'netflix.com'], type: 'streaming' },
  { keywords: ['spotify', 'spotif'], type: 'streaming' },
  { keywords: ['amazon', 'prime', 'amazon prime', 'amazon video'], type: 'streaming' },
  { keywords: ['youtube', 'youtube premium'], type: 'streaming' },
  { keywords: ['disney', 'disney+', 'disneyplus'], type: 'streaming' },
  { keywords: ['hbo', 'hbomax', 'max', 'paramount'], type: 'streaming' },
  { keywords: ['globoplay', 'globo'], type: 'streaming' },
  { keywords: ['deezer', 'apple music', 'tidal'], type: 'streaming' },
  { keywords: ['icloud', 'apple'], type: 'cloud' },
  { keywords: ['dropbox'], type: 'cloud' },
  { keywords: ['onedrive', 'office 365', 'microsoft'], type: 'cloud' },
  { keywords: ['google one', 'google storage'], type: 'cloud' },
  { keywords: ['adobe', 'photoshop', 'illustrator'], type: 'software' },
  { keywords: ['canva'], type: 'software' },
  { keywords: ['chatgpt', 'openai', 'claude', 'copilot'], type: 'software' },
  { keywords: ['smartfit', 'bodytech', 'academia', 'gym', 'crossfit', 'bluefit'], type: 'fitness' },
  { keywords: ['uber', 'uber one'], type: 'transport' },
  { keywords: ['ifood', 'iFood'], type: 'food' },
  { keywords: ['rappi', 'rappi prime'], type: 'food' },
  { keywords: ['xbox', 'xbox game pass', 'playstation', 'ps plus', 'nintendo'], type: 'gaming' },
  { keywords: ['linkedin', 'linkedin premium'], type: 'professional' },
  { keywords: ['duolingo', 'duolingo plus'], type: 'education' },
]

function normalizeDesc(desc: string): string {
  return desc
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// ── POST /api/assinaturas-fantasma/scan ───────────────────────────────────
assinaturas.post('/scan', requireAuth, async (c) => {
  const user = c.get('user')

  // Buscar despesas dos últimos 8 meses
  const result = await c.env.DB.prepare(`
    SELECT id, descricao, valor, data, categoria
    FROM despesas
    WHERE user_id = ? 
      AND data >= date('now', '-8 months')
      AND status = 'pago'
      AND valor >= 5.0
    ORDER BY data ASC
  `).bind(user.id).all()

  const expenses = result.results as any[]

  if (expenses.length < 6) {
    return c.json({
      detected: [],
      message: 'Dados insuficientes. Precisamos de pelo menos 6 meses de despesas pagas para detectar padrões.',
      insufficient_data: true
    })
  }

  // Agrupar por (descrição normalizada, valor aproximado ±5%)
  type Group = {
    normalized: string
    original: string
    amount: number
    occurrences: Array<{ id: number; date: Date }>
  }

  const groups = new Map<string, Group>()

  for (const exp of expenses) {
    const norm = normalizeDesc(exp.descricao)
    // Arredondar valor para criar bucket (±2%)
    const bucket = Math.round(exp.valor * 50) / 50
    const key = `${norm.substring(0, 30)}|${bucket}`

    if (!groups.has(key)) {
      groups.set(key, {
        normalized: norm,
        original: exp.descricao,
        amount: exp.valor,
        occurrences: []
      })
    }
    groups.get(key)!.occurrences.push({ id: exp.id, date: new Date(exp.data) })
  }

  // Analisar cada grupo
  const toInsert: any[] = []

  for (const [, group] of groups) {
    const occs = group.occurrences
    if (occs.length < 3) continue

    // Calcular intervalos entre ocorrências
    const intervals: number[] = []
    for (let i = 1; i < occs.length; i++) {
      const diff = Math.ceil(
        (occs[i].date.getTime() - occs[i - 1].date.getTime()) / (1000 * 60 * 60 * 24)
      )
      if (diff > 0) intervals.push(diff)
    }

    if (intervals.length === 0) continue

    const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length
    const variance = intervals.reduce((s, v) => s + Math.pow(v - avgInterval, 2), 0) / intervals.length
    const stdDev = Math.sqrt(variance)

    // Padrão mensal: 25-37 dias com baixo desvio
    const isMonthly = avgInterval >= 25 && avgInterval <= 37 && stdDev < 8
    // Padrão quinzenal
    const isBiweekly = avgInterval >= 12 && avgInterval <= 18 && stdDev < 4
    // Padrão anual (alguns apps cobram anualmente)
    const isAnnual = avgInterval >= 335 && avgInterval <= 395 && occs.length >= 2

    if (!isMonthly && !isBiweekly && !isAnnual) continue

    // Detectar tipo de serviço
    let serviceType = 'unknown'
    let keywordMatch = false
    for (const svc of SUBSCRIPTION_KEYWORDS) {
      if (svc.keywords.some(kw => group.normalized.includes(kw))) {
        serviceType = svc.type
        keywordMatch = true
        break
      }
    }

    // Calcular confiança
    let confidence = 0
    if (keywordMatch)           confidence += 40
    if (isMonthly || isBiweekly) confidence += 30
    if (occs.length >= 6)       confidence += 20
    if (stdDev < 3)             confidence += 10
    if (isAnnual)               confidence = Math.max(confidence, 65)

    if (confidence < 60) continue

    const yearlyCost = isAnnual ? group.amount : group.amount * 12

    toInsert.push({
      user_id: user.id,
      normalized_description: group.normalized.substring(0, 200),
      original_description: group.original.substring(0, 200),
      amount: Math.round(group.amount * 100) / 100,
      frequency: occs.length,
      first_occurrence: occs[0].date.toISOString().split('T')[0],
      last_occurrence: occs[occs.length - 1].date.toISOString().split('T')[0],
      average_interval_days: Math.round(avgInterval * 10) / 10,
      confidence: Math.min(100, confidence),
      service_type: serviceType,
      yearly_cost: Math.round(yearlyCost * 100) / 100,
    })
  }

  // Upsert no banco
  let insertedCount = 0
  for (const item of toInsert) {
    const existing = await c.env.DB.prepare(`
      SELECT id, status FROM detected_subscriptions 
      WHERE user_id = ? AND normalized_description = ? AND amount = ?
    `).bind(item.user_id, item.normalized_description, item.amount).first() as any

    if (!existing) {
      await c.env.DB.prepare(`
        INSERT INTO detected_subscriptions 
        (user_id, normalized_description, original_description, amount, frequency,
         first_occurrence, last_occurrence, average_interval_days, confidence, service_type, yearly_cost)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        item.user_id, item.normalized_description, item.original_description,
        item.amount, item.frequency, item.first_occurrence, item.last_occurrence,
        item.average_interval_days, item.confidence, item.service_type, item.yearly_cost
      ).run()
      insertedCount++
    } else if (existing.status === 'detected') {
      await c.env.DB.prepare(`
        UPDATE detected_subscriptions SET
          frequency = ?, last_occurrence = ?, confidence = ?, yearly_cost = ?,
          updated_at = datetime('now')
        WHERE id = ?
      `).bind(item.frequency, item.last_occurrence, item.confidence, item.yearly_cost, existing.id).run()
    }
  }

  // Conquista
  if (toInsert.length > 0) {
    await c.env.DB.prepare(
      `INSERT OR IGNORE INTO conquistas_usuario (user_id, conquista_codigo, visualizado) VALUES (?, 'sub_detector_scanned', 0)`
    ).bind(user.id).run()
  }

  // Retornar todos os detectados ativos
  const allDetected = await c.env.DB.prepare(`
    SELECT * FROM detected_subscriptions
    WHERE user_id = ? AND status IN ('detected','confirmed')
    ORDER BY yearly_cost DESC
  `).bind(user.id).all()

  return c.json({
    detected: allDetected.results,
    new_found: insertedCount,
    total: allDetected.results.length,
    message: toInsert.length === 0
      ? '🎉 Nenhuma assinatura fantasma encontrada!'
      : `🕵️ Encontramos ${toInsert.length} possíveis assinatura(s)!`
  })
})

// ── GET /api/assinaturas-fantasma ─────────────────────────────────────────
assinaturas.get('/', requireAuth, async (c) => {
  const user = c.get('user')
  const result = await c.env.DB.prepare(`
    SELECT * FROM detected_subscriptions
    WHERE user_id = ? AND status NOT IN ('cancelled','ignored')
    ORDER BY yearly_cost DESC
  `).bind(user.id).all()

  const detected = result.results as any[]
  const totalMensal = detected.reduce((s, d) => s + (d.amount || 0), 0)
  const totalAnual = detected.reduce((s, d) => s + (d.yearly_cost || 0), 0)

  return c.json({ detected, totalMensal, totalAnual })
})

// ── PATCH /api/assinaturas-fantasma/:id/feedback ──────────────────────────
assinaturas.patch('/:id/feedback', requireAuth, async (c) => {
  const user = c.get('user')
  const id = parseInt(c.req.param('id'))
  const { feedback } = await c.req.json()

  if (!['use_regularly', 'want_cancel', 'ignore'].includes(feedback))
    return c.json({ error: 'Feedback inválido' }, 400)

  const sub = await c.env.DB.prepare(
    `SELECT * FROM detected_subscriptions WHERE id = ? AND user_id = ?`
  ).bind(id, user.id).first() as any
  if (!sub) return c.json({ error: 'Assinatura não encontrada' }, 404)

  const newStatus = feedback === 'use_regularly' ? 'confirmed'
    : feedback === 'want_cancel' ? 'cancelled'
    : 'ignored'

  await c.env.DB.prepare(`
    UPDATE detected_subscriptions SET user_feedback = ?, status = ?, updated_at = datetime('now')
    WHERE id = ? AND user_id = ?
  `).bind(feedback, newStatus, id, user.id).run()

  // Conquista se cancelou
  if (feedback === 'want_cancel') {
    await c.env.DB.prepare(
      `INSERT OR IGNORE INTO conquistas_usuario (user_id, conquista_codigo, visualizado) VALUES (?, 'sub_cancelou_1', 0)`
    ).bind(user.id).run()
  }

  // ── BLOCO 6.1: Integração Detector → Recorrências ─────────────────────────
  // Se usuário confirma uso regular, criar/vincular recorrência automaticamente
  let recorrencia_criada = false
  if (feedback === 'use_regularly' && sub.amount > 0) {
    // Verificar se já existe recorrência similar (mesmo nome e valor)
    const recExist = await c.env.DB.prepare(`
      SELECT id FROM recorrencias
      WHERE user_id = ? AND LOWER(descricao) = LOWER(?) AND ABS(valor - ?) < 5
    `).bind(user.id, sub.service_name || sub.description, sub.amount).first()

    if (!recExist) {
      // Criar recorrência automaticamente
      await c.env.DB.prepare(`
        INSERT INTO recorrencias (user_id, tipo, descricao, valor, categoria, dia_vencimento, ativo, origem)
        VALUES (?, 'despesa', ?, ?, 'Assinaturas', 1, 1, 'detector_assinaturas')
      `).bind(
        user.id,
        sub.service_name || sub.description,
        parseFloat(sub.amount)
      ).run().catch(() => {
        // origem pode não existir — tentar sem ela
        return c.env.DB.prepare(`
          INSERT INTO recorrencias (user_id, tipo, descricao, valor, categoria, dia_vencimento, ativo)
          VALUES (?, 'despesa', ?, ?, 'Assinaturas', 1, 1)
        `).bind(user.id, sub.service_name || sub.description, parseFloat(sub.amount)).run()
      })
      recorrencia_criada = true
    }
  }

  const messages: Record<string, string> = {
    use_regularly: `✅ Marcado como assinatura ativa${recorrencia_criada ? ' — Recorrência criada automaticamente!' : ''}`,
    want_cancel: `✂️ Adicionado à lista — você economizará R$ ${(sub.yearly_cost || sub.amount * 12).toFixed(2)}/ano!`,
    ignore: '🤐 Esta despesa não será mais sugerida'
  }

  return c.json({ success: true, message: messages[feedback], recorrencia_criada })
})

export default assinaturas
