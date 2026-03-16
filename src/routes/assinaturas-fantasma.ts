import { Hono } from 'hono'
import { requireAuth } from './auth'

type Bindings = { DB: D1Database }
type Variables = { user: { id: number; nome: string; email: string; plano: string } }

const assinaturas = new Hono<{ Bindings: Bindings; Variables: Variables }>()

// Palavras-chave de serviços conhecidos (expandido)
const SUBSCRIPTION_KEYWORDS: Array<{ keywords: string[]; type: string; nome: string }> = [
  { keywords: ['netflix', 'netflix.com'], type: 'streaming', nome: 'Netflix' },
  { keywords: ['spotify', 'spotif'], type: 'streaming', nome: 'Spotify' },
  { keywords: ['amazon', 'prime', 'amazon prime', 'amazon video', 'amazn'], type: 'streaming', nome: 'Amazon Prime' },
  { keywords: ['youtube', 'youtube premium'], type: 'streaming', nome: 'YouTube Premium' },
  { keywords: ['disney', 'disney+', 'disneyplus'], type: 'streaming', nome: 'Disney+' },
  { keywords: ['hbo', 'hbomax', 'max', 'paramount', 'hbo max'], type: 'streaming', nome: 'HBO/Max' },
  { keywords: ['globoplay', 'globo play'], type: 'streaming', nome: 'Globoplay' },
  { keywords: ['deezer', 'apple music', 'tidal'], type: 'streaming', nome: 'Música Streaming' },
  { keywords: ['icloud', 'apple storage'], type: 'cloud', nome: 'iCloud' },
  { keywords: ['dropbox'], type: 'cloud', nome: 'Dropbox' },
  { keywords: ['onedrive', 'office 365', 'microsoft 365', 'microsoft'], type: 'cloud', nome: 'Microsoft 365' },
  { keywords: ['google one', 'google storage', 'google play'], type: 'cloud', nome: 'Google One' },
  { keywords: ['adobe', 'photoshop', 'illustrator', 'creative cloud'], type: 'software', nome: 'Adobe' },
  { keywords: ['canva'], type: 'software', nome: 'Canva' },
  { keywords: ['chatgpt', 'openai', 'claude', 'copilot'], type: 'software', nome: 'IA (ChatGPT/Claude)' },
  { keywords: ['notion', 'evernote', 'obsidian'], type: 'software', nome: 'Produtividade' },
  { keywords: ['zoom', 'meet'], type: 'software', nome: 'Videoconferência' },
  { keywords: ['smartfit', 'smart fit', 'bodytech', 'body tech', 'bluefit', 'blue fit', 'crossfit', 'academia'], type: 'fitness', nome: 'Academia' },
  { keywords: ['uber one', 'uber pass'], type: 'transport', nome: 'Uber One' },
  { keywords: ['ifood clube', 'ifood pass'], type: 'food', nome: 'iFood Clube' },
  { keywords: ['rappi prime', 'rappi turbo'], type: 'food', nome: 'Rappi Prime' },
  { keywords: ['xbox', 'game pass', 'playstation', 'ps plus', 'ps+', 'nintendo'], type: 'gaming', nome: 'Gaming' },
  { keywords: ['linkedin', 'linkedin premium'], type: 'professional', nome: 'LinkedIn Premium' },
  { keywords: ['duolingo', 'duolingo plus'], type: 'education', nome: 'Duolingo' },
  { keywords: ['alura', 'coursera', 'udemy', 'hotmart', 'kiwify'], type: 'education', nome: 'Cursos Online' },
  { keywords: ['vpn', 'nordvpn', 'expressvpn', 'surfshark'], type: 'software', nome: 'VPN' },
  { keywords: ['antivirus', 'norton', 'kaspersky', 'bitdefender', 'mcafee'], type: 'software', nome: 'Antivírus' },
  { keywords: ['nubank', 'nupay', 'nubank plus', 'ultravioleta'], type: 'banking', nome: 'Nubank Premium' },
  { keywords: ['inter cel', 'inter plus'], type: 'banking', nome: 'Banco Inter Premium' },
  { keywords: ['strava', 'myfitnesspal', 'nike run', 'garmin'], type: 'fitness', nome: 'App Fitness' },
  { keywords: ['kindle', 'audible', 'scribd', 'kindle unlimited'], type: 'education', nome: 'Leitura Digital' },
  { keywords: ['crunchyroll', 'funimation', 'hidive'], type: 'streaming', nome: 'Anime Streaming' },
  { keywords: ['twitch', 'twitch prime'], type: 'streaming', nome: 'Twitch' },
]

// Padrões de descrições que NÃO são assinaturas (falsos positivos comuns)
const EXCLUSION_PATTERNS = [
  /pagamento\s*(de\s*)?fatura/i,
  /fatura\s*(cartao|nubank|inter|itau|bradesco|santander)/i,
  /transferencia/i,
  /salario|salário/i,
  /aluguel\s*imovel/i,
  /parcela\s*\d+/i,
  /emprestimo|financiamento/i,
  /supermercado|mercado|padaria|acougue|farmacia/i,
  /gasolina|combustivel|posto/i,
  /restaurante|lanchonete|ifood\s+pedido/i,
  /hospital|medico|consulta|exame/i,
  /escola|mensalidade\s*(escolar|faculdade)/i,
  /^aporte[:\s]/i,          // Aportes (investimentos)
  /investimento|aplicacao/i, // Aplicações financeiras
  /rendimento|juros\s+\w/i,  // Rendimentos
  /cdb|lci|lca|cri|cra|tesouro/i, // Títulos financeiros
  /poupanca|poupança/i,      // Poupança
]

function normalizeDesc(desc: string): string {
  return desc
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function isExcluded(desc: string): boolean {
  return EXCLUSION_PATTERNS.some(pattern => pattern.test(desc))
}

// ── POST /api/assinaturas-fantasma/scan ───────────────────────────────────
assinaturas.post('/scan', requireAuth, async (c) => {
  const user = c.get('user')

  // Buscar despesas dos últimos 12 meses (expandido de 8 para 12)
  const result = await c.env.DB.prepare(`
    SELECT id, descricao, valor, data, categoria, status
    FROM despesas
    WHERE user_id = ? 
      AND data >= date('now', '-12 months')
      AND valor >= 3.0
      AND status != 'cancelado'
    ORDER BY data ASC
  `).bind(user.id).all()

  const expenses = result.results as any[]

  // Limiar mínimo reduzido: 4 despesas (era 6 meses de histórico)
  if (expenses.length < 4) {
    return c.json({
      detected: [],
      message: 'Dados insuficientes. Registre mais despesas para detectar padrões de assinatura.',
      insufficient_data: true
    })
  }

  // Agrupar por (descrição normalizada, valor aproximado)
  type Group = {
    normalized: string
    original: string
    amount: number
    occurrences: Array<{ id: number; date: Date; status: string }>
    keywordMatch: boolean
    serviceType: string
    serviceNome: string
  }

  const groups = new Map<string, Group>()

  for (const exp of expenses) {
    const nDesc = normalizeDesc(exp.descricao)

    // Pular despesas que claramente NÃO são assinaturas
    if (isExcluded(exp.descricao)) continue

    // Estratégia 1: match por palavra-chave (aceita qualquer frequência)
    let kwMatch = false
    let kwType = 'unknown'
    let kwNome = ''
    for (const svc of SUBSCRIPTION_KEYWORDS) {
      if (svc.keywords.some(kw => nDesc.includes(kw.toLowerCase()))) {
        kwMatch = true; kwType = svc.type; kwNome = svc.nome; break
      }
    }

    // Bucket de valor: arredondar para 50 centavos (±R$0,25)
    const bucket = Math.round(exp.valor * 2) / 2
    // Chave: primeiros 35 chars da desc normalizada + bucket de valor
    const key = `${nDesc.substring(0, 35)}|${bucket}`

    if (!groups.has(key)) {
      groups.set(key, {
        normalized: nDesc,
        original: exp.descricao,
        amount: exp.valor,
        occurrences: [],
        keywordMatch: kwMatch,
        serviceType: kwType,
        serviceNome: kwNome,
      })
    }
    const g = groups.get(key)!
    g.occurrences.push({ id: exp.id, date: new Date(exp.data + 'T12:00:00'), status: exp.status })
    // Se qualquer ocorrência tem keyword, marcar grupo
    if (kwMatch && !g.keywordMatch) { g.keywordMatch = true; g.serviceType = kwType; g.serviceNome = kwNome }
  }

  const toInsert: any[] = []

  for (const [, group] of groups) {
    const occs = group.occurrences
    const kwMatch = group.keywordMatch

    // Com keyword: aceitar a partir de 1 ocorrência
    // Sem keyword: exigir pelo menos 3 ocorrências
    if (!kwMatch && occs.length < 3) continue

    // Calcular intervalos entre ocorrências
    const intervals: number[] = []
    for (let i = 1; i < occs.length; i++) {
      const diff = Math.ceil(
        (occs[i].date.getTime() - occs[i - 1].date.getTime()) / (1000 * 60 * 60 * 24)
      )
      if (diff > 0) intervals.push(diff)
    }

    let avgInterval = 30  // default: mensal
    let stdDev = 0
    let isMonthly = false
    let isBiweekly = false
    let isWeekly = false
    let isAnnual = false
    let isQuarterly = false

    if (intervals.length > 0) {
      avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length
      const variance = intervals.reduce((s, v) => s + Math.pow(v - avgInterval, 2), 0) / intervals.length
      stdDev = Math.sqrt(variance)

      isWeekly   = avgInterval >= 6  && avgInterval <= 10 && stdDev < 4
      isBiweekly = avgInterval >= 12 && avgInterval <= 18 && stdDev < 5
      isMonthly  = avgInterval >= 22 && avgInterval <= 40 && stdDev < 10
      isQuarterly = avgInterval >= 80 && avgInterval <= 100 && stdDev < 12
      isAnnual   = avgInterval >= 330 && avgInterval <= 400
    }

    // Para keyword matches com 1 ocorrência: tratar como mensal
    const hasPattern = isMonthly || isBiweekly || isAnnual || isWeekly || isQuarterly
    if (!kwMatch && !hasPattern) continue

    // Calcular confiança (0-100)
    let confidence = 0
    if (kwMatch)                           confidence += 45  // Keyword match é forte sinal
    if (isMonthly || isBiweekly)           confidence += 25
    if (isAnnual)                          confidence += 20
    if (isWeekly || isQuarterly)           confidence += 15
    if (occs.length >= 6)                  confidence += 15
    else if (occs.length >= 3)             confidence += 10
    else if (occs.length >= 2)             confidence += 5
    if (stdDev < 3)                        confidence += 10
    else if (stdDev < 7)                   confidence += 5
    if (group.amount >= 10 && group.amount <= 200) confidence += 5  // Faixa típica de assinatura

    // Limiar: keyword = 45+, sem keyword = 65+
    const minConf = kwMatch ? 45 : 65
    if (confidence < minConf) continue

    const yearlyCost = isAnnual ? group.amount
      : isQuarterly ? group.amount * 4
      : isBiweekly ? group.amount * 26
      : isWeekly ? group.amount * 52
      : group.amount * 12

    const frequencyLabel = isAnnual ? 'anual'
      : isQuarterly ? 'trimestral'
      : isBiweekly ? 'quinzenal'
      : isWeekly ? 'semanal'
      : 'mensal'

    toInsert.push({
      user_id: user.id,
      normalized_description: group.normalized.substring(0, 200),
      original_description: group.original.substring(0, 200),
      service_nome: group.serviceNome || group.original.substring(0, 50),
      amount: Math.round(group.amount * 100) / 100,
      frequency: occs.length,
      frequency_label: frequencyLabel,
      first_occurrence: occs[0].date.toISOString().split('T')[0],
      last_occurrence: occs[occs.length - 1].date.toISOString().split('T')[0],
      average_interval_days: Math.round(avgInterval * 10) / 10,
      confidence: Math.min(100, confidence),
      service_type: group.serviceType,
      yearly_cost: Math.round(yearlyCost * 100) / 100,
    })
  }

  // Upsert no banco
  let insertedCount = 0
  for (const item of toInsert) {
    const existing = await c.env.DB.prepare(`
      SELECT id, status FROM detected_subscriptions 
      WHERE user_id = ? AND normalized_description = ? AND ABS(amount - ?) < 1.0
    `).bind(item.user_id, item.normalized_description, item.amount).first() as any

    if (!existing) {
      await c.env.DB.prepare(`
        INSERT INTO detected_subscriptions 
        (user_id, normalized_description, original_description, service_nome, amount, frequency,
         frequency_label, first_occurrence, last_occurrence, average_interval_days, confidence, service_type, yearly_cost)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        item.user_id, item.normalized_description, item.original_description,
        item.service_nome, item.amount, item.frequency, item.frequency_label,
        item.first_occurrence, item.last_occurrence,
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
    ).bind(user.id).run().catch(() => {})
  }

  // Retornar todos os detectados ativos
  const allDetected = await c.env.DB.prepare(`
    SELECT * FROM detected_subscriptions
    WHERE user_id = ? AND status IN ('detected','confirmed')
    ORDER BY yearly_cost DESC
  `).bind(user.id).all()

  const totalMensal = (allDetected.results as any[]).reduce((s, d) => s + (d.amount || 0), 0)
  const totalAnual  = (allDetected.results as any[]).reduce((s, d) => s + (d.yearly_cost || 0), 0)

  return c.json({
    detected: allDetected.results,
    new_found: insertedCount,
    total: allDetected.results.length,
    totalMensal: Math.round(totalMensal * 100) / 100,
    totalAnual: Math.round(totalAnual * 100) / 100,
    message: toInsert.length === 0
      ? '🎉 Nenhuma assinatura fantasma encontrada!'
      : `🕵️ Encontramos ${toInsert.length} possível(is) assinatura(s) esquecida(s)! Custo anual estimado: R$ ${Math.round(toInsert.reduce((s, i) => s + i.yearly_cost, 0) * 100)/100}`
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
