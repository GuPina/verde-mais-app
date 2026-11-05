import { Hono } from 'hono'
import { requireAuth } from './auth'
import { normalizarDescricao } from '../lib/identidade'
import { temDono, medirPadrao, motivoRecusa, confiancaPadrao, CRITERIO } from '../lib/recorrencias'
import { hojeBR, somarMesesISO } from '../lib/recorrencias-db'

type Bindings = { DB: D1Database; OPENAI_API_KEY?: string; OPENAI_BASE_URL?: string }
type Variables = { user: { id: number; nome: string; email: string; plano: string } }

const assinaturas = new Hono<{ Bindings: Bindings; Variables: Variables }>()

// ── Lista de serviços conhecidos de assinatura ─────────────────────────────
const SUBSCRIPTION_KEYWORDS: Array<{ keywords: string[]; type: string; nome: string }> = [
  { keywords: ['netflix', 'netflix.com'], type: 'streaming', nome: 'Netflix' },
  { keywords: ['spotify', 'spotif'], type: 'streaming', nome: 'Spotify' },
  { keywords: ['amazon', 'prime', 'amazon prime', 'amazon video', 'amazn'], type: 'streaming', nome: 'Amazon Prime' },
  { keywords: ['youtube', 'youtube premium'], type: 'streaming', nome: 'YouTube Premium' },
  { keywords: ['disney', 'disney+', 'disneyplus'], type: 'streaming', nome: 'Disney+' },
  { keywords: ['hbo', 'hbomax', 'max', 'paramount', 'hbo max'], type: 'streaming', nome: 'HBO/Max' },
  { keywords: ['globoplay', 'globo play'], type: 'streaming', nome: 'Globoplay' },
  { keywords: ['deezer', 'apple music', 'tidal'], type: 'streaming', nome: 'Música Streaming' },
  { keywords: ['icloud', 'apple storage', 'apple one'], type: 'cloud', nome: 'iCloud' },
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
  { keywords: ['nubank plus', 'ultravioleta'], type: 'banking', nome: 'Nubank Premium' },
  { keywords: ['inter cel', 'inter plus'], type: 'banking', nome: 'Banco Inter Premium' },
  { keywords: ['strava', 'myfitnesspal', 'nike run', 'garmin'], type: 'fitness', nome: 'App Fitness' },
  { keywords: ['kindle', 'audible', 'scribd', 'kindle unlimited'], type: 'education', nome: 'Leitura Digital' },
  { keywords: ['crunchyroll', 'funimation', 'hidive'], type: 'streaming', nome: 'Anime Streaming' },
  { keywords: ['twitch', 'twitch prime'], type: 'streaming', nome: 'Twitch' },
  { keywords: ['claro', 'vivo', 'tim', 'oi', 'nextel'], type: 'telecom', nome: 'Operadora Telefônica' },
  { keywords: ['sky', 'claro tv', 'net combo', 'iptv'], type: 'tv', nome: 'TV por Assinatura' },
  { keywords: ['plano de saude', 'plano saude', 'unimed', 'amil', 'bradesco saude', 'sulamerica', 'notre dame'], type: 'health', nome: 'Plano de Saúde' },
  { keywords: ['previdencia', 'prev privada', 'pgbl', 'vgbl'], type: 'financial', nome: 'Previdência Privada' },
  { keywords: ['seguro vida', 'seguro auto', 'seguro residencial', 'porto seguro', 'bradesco seguros'], type: 'insurance', nome: 'Seguro' },
  { keywords: ['assinatura', 'mensalidade', 'plano mensal', 'renovacao', 'renovação'], type: 'generic', nome: 'Assinatura' },
]

// Regex que identifica parcela X/Y na descrição (importadas via CSV)
const PARCELA_REGEX = /[\(\s]\d{1,2}\s*\/\s*\d{2,}[\)\s]?|\bparcela\b.*\d{1,2}\s*\/\s*\d{1,2}/i

// ── Padrões de descrições que NÃO são assinaturas ─────────────────────────
const EXCLUSION_PATTERNS = [
  PARCELA_REGEX,                                       // Parcelas X/Y — NUNCA são assinaturas
  /pagamento\s*(de\s*)?fatura/i,
  /fatura\s*(cartao|nubank|inter|itau|bradesco|santander)/i,
  /transferencia/i,
  /salario|salário/i,
  /aluguel\s*imovel|aluguel\s*casa|aluguel\s*apt/i,
  /parcela\s*\d+\s*(de\s*)?\d+/i,    // Parcelas "X de Y"
  /emprestimo|financiamento/i,
  /supermercado|mercado\s|padaria|açougue|farmacia\s+\w+\s+\d/i,
  /gasolina|combustivel|posto/i,
  /restaurante|lanchonete|ifood\s+pedido|ifood\s+-/i,
  /hospital|consulta\s+medica|exame\s+\w/i,
  /escola\s+|mensalidade\s*(escolar|faculdade|colegio)/i,
  /^aporte[:\s]/i,
  /investimento|aplicacao/i,
  /rendimento|juros\s+\w/i,
  /cdb|lci|lca|cri|cra|tesouro\s+direto/i,
  /poupanca|poupança/i,
  /luz\s+\d|agua\s+\d|gas\s+\d|condominio\s+\d/i,  // Contas com número (não assinatura)
  /taxi|uber\s+viagem|99\s+viagem|corrida/i,         // Corridas avulsas
  /compra\s+\d+|pedido\s+\d+/i,                      // Compras com número de pedido
]

// ── Categorias que indicam assinatura quando há recorrência ───────────────
const SUBSCRIPTION_CATEGORIES = [
  'Assinaturas', 'Streaming', 'Software', 'Saúde', 'Fitness', 'Educação',
  'Internet', 'Telefone', 'TV', 'Seguros', 'Plano de Saúde'
]

function normalizeDesc(desc: string): string {
  return desc
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function isExcluded(desc: string): boolean {
  return EXCLUSION_PATTERNS.some(pattern => pattern.test(desc))
}

// ── Helper: chamar IA para classificar despesas suspeitas ─────────────────
async function classificarComIA(
  env: Bindings,
  despesas: Array<{ descricao: string; valor: number; ocorrencias: number; intervalo_medio: number }>
): Promise<Array<{ descricao: string; is_assinatura: boolean; confianca: number; service_nome: string; tipo: string; motivo: string }>> {
  const apiKey = env.OPENAI_API_KEY
  const baseURL = (env.OPENAI_BASE_URL || 'https://www.genspark.ai/api/llm_proxy/v1').replace(/\/$/, '')

  if (!apiKey || despesas.length === 0) return []

  const prompt = `Você é um especialista financeiro brasileiro. Analise estas despesas e identifique quais são assinaturas recorrentes (serviços pagos mensalmente/periodicamente).

CRITÉRIOS PARA SER ASSINATURA:
- Serviço digital (streaming, software, app, nuvem)
- Plano periódico (academia, telefone, TV, saúde)
- Seguro mensal
- Assinatura de serviço

NÃO são assinaturas:
- Compras únicas de produtos físicos
- Pedidos de delivery avulsos
- Pagamentos de parcelas
- Contas de luz/água/gás (são contas, não assinaturas)

Despesas para classificar (JSON):
${JSON.stringify(despesas, null, 2)}

Responda APENAS com um array JSON válido no formato:
[{"descricao":"nome exato","is_assinatura":true/false,"confianca":0-100,"service_nome":"nome do serviço","tipo":"streaming/software/fitness/telecom/health/insurance/other","motivo":"razão breve"}]`

  try {
    const response = await fetch(`${baseURL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-5.4-mini',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.1,
        max_tokens: 2000,
      }),
    })

    if (!response.ok) return []

    const data = await response.json() as any
    const content = data.choices?.[0]?.message?.content || ''

    // Extrair JSON da resposta
    const jsonMatch = content.match(/\[[\s\S]*\]/)
    if (!jsonMatch) return []

    return JSON.parse(jsonMatch[0])
  } catch {
    return []
  }
}

// ── POST /api/assinaturas-fantasma/scan ───────────────────────────────────
assinaturas.post('/scan', requireAuth, async (c) => {
  const user = c.get('user')
  const { usar_ia = true } = await c.req.json().catch(() => ({})) as any

  // Despesas dos últimos 13 meses. A data é a de competência (no cartão, o
  // vencimento da fatura), a mesma que as Recorrências usam.
  const result = await c.env.DB.prepare(`
    SELECT id, descricao, valor, COALESCE(data, vencimento) AS data, categoria, status,
           observacoes, recorrencia_id, numero_parcelas, parcelado, cartao_id
    FROM despesas
    WHERE user_id = ?
      AND COALESCE(data, vencimento) >= ?
      AND valor >= 3.0
      AND COALESCE(status, '') <> 'cancelado'
    ORDER BY COALESCE(data, vencimento) ASC
  `).bind(user.id, somarMesesISO(hojeBR(), -13)).all()

  const hoje = hojeBR()
  const expenses = ((result.results || []) as any[])
    .map(e => ({ ...e, id: Number(e.id), valor: Number(e.valor) || 0, data: String(e.data || '').slice(0, 10) }))

  if (expenses.length < 4) {
    return c.json({
      detected: [],
      message: 'Dados insuficientes. Registre mais despesas para detectar padrões de assinatura.',
      insufficient_data: true
    })
  }

  // ── Agrupar pela MESMA identidade das Recorrências ───────────────────────
  // Antes: normalizador próprio + faixa de valor de R$ 0,50. A Netflix que
  // subiu de 55,90 para 59,90 virava duas assinaturas, e "NETFLIX.COM" e
  // "NETFLIX *COM" também. Agora a chave é `normalizarDescricao`, e parcelas,
  // empréstimos e financiamentos saem por `temDono` — as mesmas regras do
  // rastreio de recorrências, para as duas telas nunca discordarem.
  type Occ = { id: number; data: string; valor: number; status: string; recorrencia_id: number | null }
  type Group = {
    normalized: string
    original: string
    amount: number
    categoria: string
    occurrences: Occ[]
    keywordMatch: boolean
    categoryMatch: boolean
    serviceType: string
    serviceNome: string
  }

  const porChave = new Map<string, any[]>()
  for (const exp of expenses) {
    if (temDono(exp)) continue
    if (isExcluded(exp.descricao || '')) continue
    const chave = normalizarDescricao(exp.descricao || '')
    if (!chave) continue
    if (!porChave.has(chave)) porChave.set(chave, [])
    porChave.get(chave)!.push(exp)
  }

  // Mesma chave, mais de uma cobrança por mês ("AMAZON": o Prime e as
  // compras): separa por faixa de valor, e cada faixa é avaliada sozinha.
  function fatiarPorValor(itens: any[]): any[][] {
    const ord = [...itens].sort((a, b) => a.valor - b.valor)
    const fatias: any[][] = []
    for (const it of ord) {
      const ult = fatias[fatias.length - 1]
      const ref = ult ? ult[0].valor : 0
      if (ult && ref > 0 && (it.valor - ref) / ref <= 0.15) ult.push(it)
      else fatias.push([it])
    }
    return fatias.map(f => f.sort((a, b) => a.data.localeCompare(b.data)))
  }

  const groups: Group[] = []
  for (const [chave, itens] of porChave) {
    const p0 = medirPadrao(itens, hoje)
    const fatias = p0 && p0.n / Math.max(1, p0.meses) > CRITERIO.por_mes_max ? fatiarPorValor(itens) : [itens]
    for (const fatia of fatias) {
      const nDesc = chave.toLowerCase()
      let kwMatch = false, kwType = 'unknown', kwNome = ''
      for (const svc of SUBSCRIPTION_KEYWORDS) {
        // Palavra inteira: "oi" e "tim" (operadoras) dentro de "BOI" ou
        // "TIMBRE" faziam qualquer coisa virar assinatura de telefone.
        if (svc.keywords.some(kw => ` ${nDesc} `.includes(` ${normalizeDesc(kw)} `))) {
          kwMatch = true; kwType = svc.type; kwNome = svc.nome; break
        }
      }
      const cats = new Map<string, number>()
      for (const e of fatia) if (e.categoria) cats.set(e.categoria, (cats.get(e.categoria) || 0) + 1)
      const categoria = [...cats.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || ''
      const catMatch = SUBSCRIPTION_CATEGORIES.some(cc => categoria.toLowerCase().includes(cc.toLowerCase()))
      const ultimo = fatia[fatia.length - 1]
      groups.push({
        normalized: chave, original: ultimo.descricao,
        amount: ultimo.valor,             // o preço de AGORA, não o de um ano atrás
        categoria,
        occurrences: fatia.map(e => ({ id: e.id, data: e.data, valor: e.valor, status: e.status, recorrencia_id: e.recorrencia_id ? Number(e.recorrencia_id) : null })),
        keywordMatch: kwMatch, categoryMatch: catMatch, serviceType: kwType, serviceNome: kwNome,
      })
    }
  }

  // ── Filtrar candidatos a assinatura ─────────────────────────────────────
  const candidates: Array<{ group: Group; avgInterval: number; frequencyLabel: string; confidence: number; recorrenciaId: number | null }> = []
  const groupsForIA: Array<{ descricao: string; valor: number; ocorrencias: number; intervalo_medio: number }> = []

  for (const group of groups) {
    const occs = group.occurrences
    const kwMatch = group.keywordMatch
    if (!kwMatch && occs.length < 3) continue

    // Mensal: o mesmo critério das Recorrências (ritmo, dia do mês, um por
    // mês, ainda ativa). Anual e trimestral o motor mensal não cobre — ficam
    // pelo intervalo médio, como antes.
    const p = medirPadrao(occs, hoje)!
    const motivo = motivoRecusa(p)
    const isMonthly = motivo === null
    const parou = p.dias_desde_ultima > CRITERIO.dias_para_inativa
    const intervals: number[] = []
    for (let i = 1; i < occs.length; i++) {
      const d = Math.round((Date.parse(occs[i].data + 'T12:00:00Z') - Date.parse(occs[i - 1].data + 'T12:00:00Z')) / 86400000)
      if (d > 0) intervals.push(d)
    }
    const avgInterval = intervals.length ? intervals.reduce((a, b) => a + b, 0) / intervals.length : 30
    const isQuarterly = !isMonthly && occs.length >= 2 && avgInterval >= 80 && avgInterval <= 100 && p.dias_desde_ultima <= 110
    const isAnnual = !isMonthly && occs.length >= 2 && avgInterval >= 330 && avgInterval <= 400 && p.dias_desde_ultima <= 400

    const hasPattern = isMonthly || isAnnual || isQuarterly
    // Hábito (Uber, mercado) e cobrança que já parou não são assinatura
    // fantasma — a não ser que seja um serviço conhecido ainda cobrando.
    if (!hasPattern && !(kwMatch && !parou)) continue

    let confidence = 0
    if (kwMatch)                            confidence += 45
    if (isMonthly)                          confidence += Math.round(confiancaPadrao(p) * 0.4)
    if (isAnnual)                           confidence += 20
    if (isQuarterly)                        confidence += 15
    if (occs.length >= 6)                   confidence += 15
    else if (occs.length >= 3)              confidence += 10
    else if (occs.length >= 2)              confidence += 5
    if (!p.valor_variavel)                  confidence += 10
    if (group.amount >= 10 && group.amount <= 500) confidence += 5
    if (group.categoryMatch && !kwMatch)    confidence += 15

    const minConf = kwMatch ? 45 : (group.categoryMatch ? 55 : 65)
    if (confidence < minConf) continue

    const frequencyLabel = isAnnual ? 'anual' : isQuarterly ? 'trimestral' : 'mensal'

    // Já é uma recorrência? Os lançamentos dizem: vale a mais frequente.
    const contagem = new Map<number, number>()
    for (const o of occs) if (o.recorrencia_id) contagem.set(o.recorrencia_id, (contagem.get(o.recorrencia_id) || 0) + 1)
    const recorrenciaId = [...contagem.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null

    candidates.push({ group, avgInterval: isMonthly ? p.intervalo_mediano : avgInterval, frequencyLabel, confidence: Math.min(100, confidence), recorrenciaId })

    if (!kwMatch || confidence < 70) {
      groupsForIA.push({
        descricao: group.original,
        valor: group.amount,
        ocorrencias: occs.length,
        intervalo_medio: Math.round(avgInterval)
      })
    }
  }

  // ── Análise da IA para candidatos duvidosos ──────────────────────────────
  let iaResults: Map<string, any> = new Map()
  if (usar_ia && groupsForIA.length > 0) {
    const iaAnalysis = await classificarComIA(c.env, groupsForIA.slice(0, 20))
    for (const ia of iaAnalysis) {
      iaResults.set(normalizarDescricao(ia.descricao || ''), ia)
    }
  }

  // Sincronizar: remover assinaturas detectadas cuja última ocorrência
  // ficou > 3 meses atrás (provavelmente despesa foi deletada ou não existe mais)
  try {
    await c.env.DB.prepare(`
      DELETE FROM detected_subscriptions
      WHERE user_id = ? AND status = 'detected'
        AND last_occurrence < date('now', '-3 months')
    `).bind(user.id).run()
  } catch (_) {}

  // ── Upsert no banco ──────────────────────────────────────────────────────
  let insertedCount = 0
  const toInsertItems: any[] = []

  for (const { group, avgInterval, frequencyLabel, confidence, recorrenciaId } of candidates) {
    const occs = group.occurrences

    // Verificar resultado da IA
    const nDesc = group.normalized
    const iaResult = iaResults.get(nDesc)

    // Se IA disse que NÃO é assinatura com alta confiança, pular
    if (iaResult && !iaResult.is_assinatura && iaResult.confianca >= 80) continue

    // Aplicar boost de confiança da IA
    let finalConfidence = confidence
    let aiEnhanced = false
    let aiAnalysis = null
    if (iaResult) {
      aiEnhanced = true
      aiAnalysis = { ...iaResult }
      if (iaResult.is_assinatura) finalConfidence = Math.min(100, finalConfidence + 15)
      if (iaResult.service_nome) group.serviceNome = group.serviceNome || iaResult.service_nome
      if (iaResult.tipo) group.serviceType = group.serviceType === 'unknown' ? iaResult.tipo : group.serviceType
    }

    const yearlyCost = frequencyLabel === 'anual' ? group.amount
      : frequencyLabel === 'trimestral' ? group.amount * 4
      : frequencyLabel === 'quinzenal' ? group.amount * 26
      : frequencyLabel === 'semanal' ? group.amount * 52
      : group.amount * 12

    const item = {
      user_id: user.id,
      normalized_description: group.normalized.substring(0, 200),
      original_description: group.original.substring(0, 200),
      service_nome: group.serviceNome || group.original.substring(0, 50),
      amount: Math.round(group.amount * 100) / 100,
      frequency: occs.length,
      frequency_label: frequencyLabel,
      first_occurrence: occs[0].data,
      last_occurrence: occs[occs.length - 1].data,
      recorrencia_id: recorrenciaId,
      average_interval_days: Math.round(avgInterval * 10) / 10,
      confidence: Math.min(100, finalConfidence),
      service_type: group.serviceType,
      yearly_cost: Math.round(yearlyCost * 100) / 100,
      ai_enhanced: aiEnhanced ? 1 : 0,
      ai_analysis: aiAnalysis ? JSON.stringify(aiAnalysis) : null,
    }

    toInsertItems.push(item)
  }

  // Upsert. A chave mudou de formato (o normalizador antigo era minúsculo e
  // sem tirar ruído); procura pelas duas para não duplicar o que já existe.
  for (const item of toInsertItems) {
    const chaveAntiga = normalizeDesc(item.original_description)
    const existing = await c.env.DB.prepare(`
      SELECT id, status FROM detected_subscriptions
      WHERE user_id = ? AND normalized_description IN (?, ?)
        AND ABS(amount - ?) <= GREATEST(1.0, 0.2 * amount)
      ORDER BY (status = 'detected') DESC, id DESC LIMIT 1
    `).bind(item.user_id, item.normalized_description, chaveAntiga, item.amount).first() as any

    if (!existing) {
      await c.env.DB.prepare(`
        INSERT INTO detected_subscriptions
        (user_id, normalized_description, original_description, service_nome, amount, frequency,
         frequency_label, first_occurrence, last_occurrence, average_interval_days, confidence,
         service_type, yearly_cost, ai_enhanced, ai_analysis, recorrencia_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        item.user_id, item.normalized_description, item.original_description,
        item.service_nome, item.amount, item.frequency, item.frequency_label,
        item.first_occurrence, item.last_occurrence, item.average_interval_days,
        item.confidence, item.service_type, item.yearly_cost, item.ai_enhanced, item.ai_analysis,
        item.recorrencia_id
      ).run()
      insertedCount++
    } else if (existing.status === 'detected') {
      await c.env.DB.prepare(`
        UPDATE detected_subscriptions SET
          normalized_description = ?, original_description = ?, amount = ?,
          frequency = ?, frequency_label = ?, last_occurrence = ?, average_interval_days = ?,
          confidence = ?, yearly_cost = ?, ai_enhanced = ?, ai_analysis = ?,
          recorrencia_id = COALESCE(?, recorrencia_id),
          updated_at = datetime('now')
        WHERE id = ?
      `).bind(item.normalized_description, item.original_description, item.amount,
        item.frequency, item.frequency_label, item.last_occurrence, item.average_interval_days,
        item.confidence, item.yearly_cost, item.ai_enhanced, item.ai_analysis,
        item.recorrencia_id, existing.id).run()
    }
  }

  // Conquista
  if (insertedCount > 0) {
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
    ia_utilizada: iaResults.size > 0,
    message: insertedCount === 0
      ? `🎉 Scan concluído! ${allDetected.results.length > 0 ? `${allDetected.results.length} assinatura(s) ativa(s) no radar.` : 'Nenhuma assinatura fantasma encontrada!'}`
      : `🕵️ Encontramos ${insertedCount} nova(s) assinatura(s)! Custo anual estimado: R$ ${Math.round(toInsertItems.reduce((s, i) => s + i.yearly_cost, 0) * 100)/100}`
  })
})

// ── GET /api/assinaturas-fantasma/precos-reduzidos ───────────────────────
// Lista SOMENTE assinaturas onde usuário clicou "Reduzir Preço"
// Mostra valor antigo, novo valor e economia acumulada desde a redução
assinaturas.get('/precos-reduzidos', requireAuth, async (c) => {
  const user = c.get('user')

  const result = await c.env.DB.prepare(`
    SELECT * FROM detected_subscriptions
    WHERE user_id = ? AND user_feedback = 'reduced_plan'
    ORDER BY reduced_at DESC, updated_at DESC
  `).bind(user.id).all()

  const hoje = new Date()
  let totalEconomiaMensal = 0
  let totalEconomiaAcumulada = 0

  const reduzidas = (result.results as any[]).map(sub => {
    const valorAntigo = parseFloat(String(sub.valor_antigo || 0))
    const novoValor   = parseFloat(String(sub.amount || 0))
    const reducaoMensal = Math.max(0, valorAntigo - novoValor)

    // Calcular economia acumulada desde a data de redução
    const reducedAt = sub.reduced_at ? new Date(sub.reduced_at) : new Date(sub.updated_at)
    const diasDesde = Math.max(0, Math.floor((hoje.getTime() - reducedAt.getTime()) / (1000 * 60 * 60 * 24)))
    const mesesDesde = Math.floor(diasDesde / 30)

    let economiaAcumulada = 0
    const label = sub.frequency_label || 'mensal'
    if (label === 'mensal')      economiaAcumulada = mesesDesde * reducaoMensal
    else if (label === 'quinzenal') economiaAcumulada = Math.floor(diasDesde / 15) * reducaoMensal
    else if (label === 'semanal')   economiaAcumulada = Math.floor(diasDesde / 7) * reducaoMensal
    else if (label === 'trimestral') economiaAcumulada = Math.floor(mesesDesde / 3) * reducaoMensal
    else if (label === 'anual')     economiaAcumulada = Math.floor(mesesDesde / 12) * reducaoMensal
    else                            economiaAcumulada = mesesDesde * reducaoMensal

    totalEconomiaMensal   += reducaoMensal
    totalEconomiaAcumulada += economiaAcumulada

    return {
      ...sub,
      valor_antigo:        Math.round(valorAntigo * 100) / 100,
      novo_valor:          Math.round(novoValor * 100) / 100,
      reducao_mensal:      Math.round(reducaoMensal * 100) / 100,
      reducao_anual:       Math.round(reducaoMensal * 12 * 100) / 100,
      economia_acumulada:  Math.round(economiaAcumulada * 100) / 100,
      dias_desde_reducao:  diasDesde,
      meses_desde_reducao: mesesDesde,
    }
  })

  return c.json({
    reduzidas,
    total_reduzidas: reduzidas.length,
    economia_mensal_total:    Math.round(totalEconomiaMensal * 100) / 100,
    economia_anual_total:     Math.round(totalEconomiaMensal * 12 * 100) / 100,
    economia_acumulada_total: Math.round(totalEconomiaAcumulada * 100) / 100,
  })
})

// ── GET /api/assinaturas-fantasma/:id/buscar-recorrencias ─────────────────
// Lista recorrências candidatas para vincular ANTES de confirmar redução
assinaturas.get('/:id/buscar-recorrencias', requireAuth, async (c) => {
  try {
    const user = c.get('user')
    const id = parseInt(c.req.param('id'))
    if (isNaN(id)) return c.json({ error: 'ID inválido' }, 400)

    const sub = await c.env.DB.prepare(
      `SELECT id, service_nome, original_description, normalized_description, amount, recorrencia_id FROM detected_subscriptions WHERE id = ? AND user_id = ?`
    ).bind(id, user.id).first() as any
    if (!sub) return c.json({ error: 'Assinatura não encontrada' }, 404)

    const nome = (sub.service_nome || sub.original_description || '').toLowerCase()
    const normalizado = (sub.normalized_description || '').toLowerCase()

    // Buscar recorrências por similaridade de nome
    const recorrencias = await c.env.DB.prepare(`
      SELECT id, descricao, valor, categoria,
             dia_vencimento, meio_pagamento, ativa
      FROM recorrencias
      WHERE user_id = ? AND ativa = 1
      ORDER BY descricao ASC
    `).bind(user.id).all()

    // Pontuação de similaridade por palavras em comum
    const candidatos = (recorrencias.results as any[])
      .map(r => {
        const descLower = (r.descricao || '').toLowerCase()
        const tokensA = nome.split(/\s+/).filter((t: string) => t.length > 2)
        const tokensB = descLower.split(/\s+/).filter((t: string) => t.length > 2)
        const intersec = tokensA.filter((t: string) => tokensB.some((b: string) => b.includes(t) || t.includes(b)))
        const score = intersec.length / Math.max(1, Math.max(tokensA.length, tokensB.length))

        const tokensN = normalizado.split(/\s+/).filter((t: string) => t.length > 2)
        const intersecN = tokensN.filter((t: string) => tokensB.some((b: string) => b.includes(t) || t.includes(b)))
        const scoreN = intersecN.length / Math.max(1, Math.max(tokensN.length, tokensB.length))

        // A mesma régua do vínculo automático: a descrição normalizada da
        // cobrança contém o nome normalizado da recorrência. E se o scan já
        // viu os lançamentos ligados a ela, não há o que adivinhar.
        const chaveRec = normalizarDescricao(r.descricao || '')
        const chaveSub = normalizarDescricao(sub.original_description || '')
        const textoBate = !!chaveRec && chaveRec.length >= 3 && chaveSub.includes(chaveRec)
        const jaLigada = Number(sub.recorrencia_id) === Number(r.id)

        return {
          id: r.id,
          descricao: r.descricao,
          valor: r.valor,
          categoria: r.categoria,
          dia_vencimento: r.dia_vencimento,
          meio_pagamento: r.meio_pagamento,
          ativa: r.ativa,
          frequency_label: 'mensal',
          ja_vinculada: jaLigada,
          similaridade: jaLigada ? 1 : textoBate ? Math.max(0.9, score, scoreN) : Math.max(score, scoreN)
        }
      })
      .filter(r => r.similaridade > 0.2)
      .sort((a, b) => b.similaridade - a.similaridade)
      .slice(0, 5)

    return c.json({
      assinatura: {
        id: sub.id,
        nome: sub.service_nome || sub.original_description,
        valor_atual: sub.amount,
      },
      recorrencias_candidatas: candidatos,
      total_candidatas: candidatos.length,
      mensagem: candidatos.length === 0
        ? 'Nenhuma recorrência similar encontrada. A redução será salva sem vincular recorrência.'
        : `Encontramos ${candidatos.length} recorrência(s) que podem ser esta assinatura. Escolha qual atualizar ou confirme sem vincular.`
    })
  } catch (err: any) {
    console.error('[buscar-recorrencias] ERRO:', err?.message, err?.stack)
    return c.json({ error: 'Erro interno', detail: err?.message ?? String(err) }, 500)
  }
})

// ── POST /api/assinaturas-fantasma/:id/reduzir-preco ─────────────────────
// Confirma redução de preço. Opcionalmente atualiza recorrência vinculada.
// Body: { novo_valor, motivo?, recorrencia_id? (null = não vincular) }
assinaturas.post('/:id/reduzir-preco', requireAuth, async (c) => {
  try {
  const user = c.get('user')
  const id = parseInt(c.req.param('id'))
  if (!Number.isInteger(id) || id < 1) return c.json({ error: 'ID inválido.' }, 400)
  if (isNaN(id)) return c.json({ error: 'ID inválido' }, 400)
  let body: any
  try { body = await c.req.json() } catch { return c.json({ error: 'JSON inválido no body' }, 400) }
  const _bodyTyped = body as {
    novo_valor: number
    motivo?: string
    recorrencia_id?: number | null  // null = confirmado sem vincular
  }

  const { novo_valor, motivo, recorrencia_id } = _bodyTyped

  if (!novo_valor || parseFloat(String(novo_valor)) <= 0)
    return c.json({ error: 'Informe o novo valor do plano reduzido' }, 400)

  const sub = await c.env.DB.prepare(
    `SELECT * FROM detected_subscriptions WHERE id = ? AND user_id = ?`
  ).bind(id, user.id).first() as any
  if (!sub) return c.json({ error: 'Assinatura não encontrada' }, 404)

  const novoValorNum  = parseFloat(String(novo_valor))
  // Preserva o valor antigo: se já houve redução antes, usa valor_antigo original; senão usa amount atual
  const valorAntigo   = sub.valor_antigo
    ? parseFloat(String(sub.valor_antigo))
    : parseFloat(String(sub.amount))
  const reducaoMensal = Math.max(0, valorAntigo - novoValorNum)
  const reducaoAnual  = reducaoMensal * 12
  const novoAnual     = novoValorNum * 12

  // Atualizar detected_subscriptions
  await c.env.DB.prepare(`
    UPDATE detected_subscriptions SET
      amount                  = ?,
      yearly_cost             = ?,
      valor_antigo            = ?,
      reduced_at              = datetime('now'),
      recorrencia_id          = ?,
      status                  = 'confirmed',
      user_feedback           = 'reduced_plan',
      updated_at              = datetime('now')
    WHERE id = ? AND user_id = ?
  `).bind(novoValorNum, novoAnual, valorAntigo, recorrencia_id ?? null, id, user.id).run()

  let recorrenciaAtualizada = false
  let recorrenciaInfo: any = null

  // Se vinculou recorrência: atualizar o valor dela + gerar despesas futuras com novo valor
  if (recorrencia_id) {
    const rec = await c.env.DB.prepare(
      `SELECT * FROM recorrencias WHERE id = ? AND user_id = ?`
    ).bind(recorrencia_id, user.id).first() as any

    if (rec) {
      await c.env.DB.prepare(`
        UPDATE recorrencias
        SET valor = ?, ultimo_valor = ?
        WHERE id = ? AND user_id = ?
      `).bind(novoValorNum, novoValorNum, recorrencia_id, user.id).run()
        .catch(() => {})

      // Atualizar despesas futuras geradas por essa recorrência que ainda estão pendentes
      const hoje = new Date().toISOString().split('T')[0]
      const updateFut = await c.env.DB.prepare(`
        UPDATE despesas
        SET valor = ?
        WHERE user_id = ?
          AND status = 'pendente'
          AND date(data) >= date(?)
          AND LOWER(descricao) = LOWER(?)
      `).bind(novoValorNum, user.id, hoje, rec.descricao).run()
        .catch(() => ({ meta: { changes: 0 } }))

      recorrenciaAtualizada = true
      recorrenciaInfo = {
        id: rec.id,
        descricao: rec.descricao,
        valor_anterior: parseFloat(String(rec.valor)),
        novo_valor: novoValorNum,
        despesas_futuras_atualizadas: (updateFut as any)?.meta?.changes ?? 0,
      }
    }
  }

  return c.json({
    success: true,
    reducao_mensal:       Math.round(reducaoMensal * 100) / 100,
    reducao_anual:        Math.round(reducaoAnual * 100) / 100,
    valor_antigo:         Math.round(valorAntigo * 100) / 100,
    novo_valor:           Math.round(novoValorNum * 100) / 100,
    recorrencia_atualizada: recorrenciaAtualizada,
    recorrencia:          recorrenciaInfo,
    message: recorrenciaAtualizada
      ? `💸 Redução aplicada! Economia de R$ ${reducaoAnual.toFixed(2)}/ano. Recorrência "${recorrenciaInfo.descricao}" e ${recorrenciaInfo.despesas_futuras_atualizadas} despesa(s) futura(s) atualizadas.`
      : `💸 Redução registrada! Economia de R$ ${reducaoAnual.toFixed(2)}/ano com ${sub.service_nome || sub.original_description}.`
  })
  } catch (err: any) {
    console.error('[reduzir-preco] ERRO:', err?.message, err?.stack)
    return c.json({ error: 'Erro interno', detail: err?.message ?? String(err) }, 500)
  }
})

// ── GET /api/assinaturas-fantasma ─────────────────────────────────────────
assinaturas.get('/', requireAuth, async (c) => {
  const user = c.get('user')

  // Padrão X/Y — parcelas de cartão não são assinaturas
  const PARCELA_JS = /\(\d{1,2}\/\d{1,2}\)|\s\d{1,2}\/\d{1,2}[\s\)]|parcela\s*\d/i

  // Limpeza preventiva: remove obsoletos (last_occurrence > 3 meses)
  // O filtro de X/Y é feito em JS abaixo (REGEXP não é suportado no D1)
  try {
    await c.env.DB.prepare(`
      DELETE FROM detected_subscriptions
      WHERE user_id = ?
        AND status = 'detected'
        AND last_occurrence < date('now', '-3 months')
    `).bind(user.id).run()
  } catch (_) {}

  const result = await c.env.DB.prepare(`
    SELECT * FROM detected_subscriptions
    WHERE user_id = ? AND status NOT IN ('cancelled','ignored')
    ORDER BY yearly_cost DESC
  `).bind(user.id).all()

  // Filtrar em JS qualquer entrada com padrão de parcela que escapou
  const detected = (result.results as any[]).filter(d =>
    !PARCELA_JS.test(d.original_description || '') &&
    !PARCELA_JS.test(d.normalized_description || '')
  )

  // Deletar do banco as entradas que foram filtradas em JS
  const idsParaDeletar = (result.results as any[])
    .filter(d => PARCELA_JS.test(d.original_description || '') || PARCELA_JS.test(d.normalized_description || ''))
    .map(d => d.id)
  if (idsParaDeletar.length > 0) {
    const placeholders = idsParaDeletar.map(() => '?').join(',')
    await c.env.DB.prepare(
      `DELETE FROM detected_subscriptions WHERE id IN (${placeholders})`
    ).bind(...idsParaDeletar).run().catch(() => {})
  }

  const totalMensal = detected.reduce((s, d) => s + (d.amount || 0), 0)
  const totalAnual = detected.reduce((s, d) => s + (d.yearly_cost || 0), 0)

  return c.json({
    detected,
    totalMensal: Math.round(totalMensal * 100) / 100,
    totalAnual: Math.round(totalAnual * 100) / 100,
    total_detectadas: detected.length,
    total_mensal: Math.round(totalMensal * 100) / 100,
    total_anual: Math.round(totalAnual * 100) / 100,
  })
})

// ── GET /api/assinaturas-fantasma/canceladas ──────────────────────────────
// Histórico de assinaturas canceladas com economia acumulada
assinaturas.get('/canceladas', requireAuth, async (c) => {
  const user = c.get('user')

  // Buscar histórico de cancelamentos
  const hist = await c.env.DB.prepare(`
    SELECT * FROM assinaturas_canceladas_historico
    WHERE user_id = ?
    ORDER BY cancelled_at DESC
  `).bind(user.id).all()

  const canceladas = hist.results as any[]

  // Calcular economia atualizada para cada registro
  const hoje = new Date()
  let totalEconomiaAcumulada = 0
  let totalEconomiaAnualProjetada = 0

  const canceladasAtualizadas = canceladas.map(c => {
    const cancelledAt = new Date(c.cancelled_at)
    const diasDesde = Math.floor((hoje.getTime() - cancelledAt.getTime()) / (1000 * 60 * 60 * 24))
    const mesesDesde = Math.floor(diasDesde / 30)

    // Calcular economia baseada na frequência
    let economiaAcumulada = 0
    const frequencyLabel = c.frequency_label || 'mensal'
    if (frequencyLabel === 'mensal') {
      economiaAcumulada = mesesDesde * c.amount
    } else if (frequencyLabel === 'quinzenal') {
      economiaAcumulada = Math.floor(diasDesde / 15) * c.amount
    } else if (frequencyLabel === 'semanal') {
      economiaAcumulada = Math.floor(diasDesde / 7) * c.amount
    } else if (frequencyLabel === 'trimestral') {
      economiaAcumulada = Math.floor(mesesDesde / 3) * c.amount
    } else if (frequencyLabel === 'anual') {
      economiaAcumulada = Math.floor(mesesDesde / 12) * c.amount
    }

    const economiaAnualProjetada = c.yearly_cost || c.amount * 12

    totalEconomiaAcumulada += economiaAcumulada
    totalEconomiaAnualProjetada += economiaAnualProjetada

    return {
      ...c,
      dias_desde_cancelamento: diasDesde,
      meses_desde_cancelamento: mesesDesde,
      economia_acumulada: Math.round(economiaAcumulada * 100) / 100,
      economia_anual_projetada: Math.round(economiaAnualProjetada * 100) / 100,
    }
  })

  // Também buscar assinaturas marcadas como 'cancelled' em detected_subscriptions
  // que ainda não foram movidas para o histórico
  const legacyCancelled = await c.env.DB.prepare(`
    SELECT * FROM detected_subscriptions
    WHERE user_id = ? AND status = 'cancelled'
    ORDER BY updated_at DESC
  `).bind(user.id).all()

  return c.json({
    canceladas: canceladasAtualizadas,
    total_canceladas: canceladasAtualizadas.length,
    economia_total_acumulada: Math.round(totalEconomiaAcumulada * 100) / 100,
    economia_anual_projetada: Math.round(totalEconomiaAnualProjetada * 100) / 100,
    // Para referência: assinaturas marcadas no detector mas sem histórico formal
    canceladas_legadas: legacyCancelled.results,
    resumo: {
      mes_atual: Math.round(canceladas.reduce((s, c) => {
        // Economia do mês atual (simplificado: soma dos valores mensais)
        const label = c.frequency_label || 'mensal'
        if (label === 'mensal') return s + c.amount
        if (label === 'semanal') return s + c.amount * 4.3
        if (label === 'quinzenal') return s + c.amount * 2
        if (label === 'trimestral') return s + c.amount / 3
        if (label === 'anual') return s + c.amount / 12
        return s + c.amount
      }, 0) * 100) / 100,
      total_acumulado: Math.round(totalEconomiaAcumulada * 100) / 100,
      projecao_12_meses: Math.round(totalEconomiaAnualProjetada * 100) / 100,
    }
  })
})

// ── PATCH /api/assinaturas-fantasma/:id/feedback ──────────────────────────
assinaturas.patch('/:id/feedback', requireAuth, async (c) => {
  const user = c.get('user')
  const id = parseInt(c.req.param('id'))
  if (!Number.isInteger(id) || id < 1) return c.json({ error: 'ID inválido.' }, 400)
  const { feedback, motivo } = await c.req.json() as { feedback: string; motivo?: string }

  if (!['use_regularly', 'want_cancel', 'ignore'].includes(feedback))
    return c.json({ error: 'Feedback inválido. Use: use_regularly, want_cancel, ignore' }, 400)

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

  // Se cancelou: registrar no histórico com economia calculada
  if (feedback === 'want_cancel') {
    // Verificar se já existe no histórico
    const existeHist = await c.env.DB.prepare(
      `SELECT id FROM assinaturas_canceladas_historico WHERE subscription_id = ? AND user_id = ?`
    ).bind(id, user.id).first()

    if (!existeHist) {
      await c.env.DB.prepare(`
        INSERT INTO assinaturas_canceladas_historico
        (user_id, subscription_id, service_nome, service_type, amount, frequency_label, yearly_cost, motivo)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        user.id, id,
        sub.service_nome || sub.original_description,
        sub.service_type || 'unknown',
        sub.amount,
        sub.frequency_label || 'mensal',
        sub.yearly_cost || sub.amount * 12,
        motivo || null
      ).run()
    }

    // Conquista
    await c.env.DB.prepare(
      `INSERT OR IGNORE INTO conquistas_usuario (user_id, conquista_codigo, visualizado) VALUES (?, 'sub_cancelou_1', 0)`
    ).bind(user.id).run()
  }

  // Se confirmou uso regular: criar/vincular recorrência
  let recorrencia_criada = false
  if (feedback === 'use_regularly' && sub.amount > 0) {
    const recExist = await c.env.DB.prepare(`
      SELECT id FROM recorrencias
      WHERE user_id = ? AND LOWER(descricao) = LOWER(?) AND ABS(valor - ?) < 5
    `).bind(user.id, sub.service_nome || sub.original_description, sub.amount).first()

    if (!recExist) {
      await c.env.DB.prepare(`
        INSERT INTO recorrencias (user_id, tipo, descricao, valor, categoria, dia_vencimento, ativa)
        VALUES (?, 'despesa', ?, ?, 'Assinaturas', 1, 1)
      `).bind(user.id, sub.service_nome || sub.original_description, parseFloat(sub.amount)).run()
        .catch(() => {})
      recorrencia_criada = true
    }
  }

  const yearlyCost = sub.yearly_cost || sub.amount * 12
  const messages: Record<string, string> = {
    use_regularly: `✅ Marcado como assinatura ativa${recorrencia_criada ? ' — Recorrência criada automaticamente!' : ''}`,
    want_cancel: `✂️ Cancelado! Você economizará R$ ${yearlyCost.toFixed(2)}/ano. Histórico registrado.`,
    ignore: '🤐 Esta despesa não será mais sugerida'
  }

  return c.json({ success: true, message: messages[feedback], recorrencia_criada })
})

export default assinaturas
