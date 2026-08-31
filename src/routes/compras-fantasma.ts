import { Hono } from 'hono'
import { requireAuth } from './auth'

type Bindings = { DB: D1Database; OPENAI_API_KEY?: string; OPENAI_BASE_URL?: string }
type Variables = { user: { id: number; nome: string; email: string; plano: string } }

// ── FASE 3.3 — Custo de Oportunidade ────────────────────────────────────────
// Calcula quanto o dinheiro gasto em compras impulsivas RENDERIA se investido
// Taxas de referência (aproximadas para cálculo pedagógico)
const CDI_ANUAL_REF = 0.1065  // ~10,65% a.a. (referência — substituída por CDI real se disponível)

interface CustoOportunidade {
  valor_gasto:          number   // R$ gasto impulsivamente
  rendimento_1m:        number   // quanto renderia em 1 mês (CDI/mês)
  rendimento_12m:       number   // quanto renderia em 12 meses (juros compostos)
  rendimento_24m:       number   // 24 meses
  rendimento_60m:       number   // 5 anos
  taxa_cdi_anual:       number   // CDI anual usado no cálculo
  taxa_cdi_mensal:      number   // CDI mensal equivalente
  equivalencia_salario: number   // quantos % de 1 salário mínimo representa
  meta_equivalente:     string   // ex: "3 meses de academia", "1/4 de passagem SP-RJ"
  economia_projetada_12m: number // se parar as compras impulsivas: economia total no ano
}

/**
 * Calcula custo de oportunidade de um valor gasto impulsivamente.
 * Usa juros compostos mensais equivalentes ao CDI.
 */
function calcularCustoOportunidade(
  valorGasto: number,
  cdiAnual: number = CDI_ANUAL_REF
): CustoOportunidade {
  // CDI mensal equivalente: (1 + cdiAnual)^(1/12) - 1
  const taxaMensal = Math.pow(1 + cdiAnual, 1 / 12) - 1
  const r2 = (n: number) => Math.round(n * 100) / 100

  const rend1m  = r2(valorGasto * taxaMensal)
  const rend12m = r2(valorGasto * (Math.pow(1 + taxaMensal, 12) - 1))
  const rend24m = r2(valorGasto * (Math.pow(1 + taxaMensal, 24) - 1))
  const rend60m = r2(valorGasto * (Math.pow(1 + taxaMensal, 60) - 1))

  // Salário mínimo 2025: R$ 1 518
  const salarioMinimo = 1518
  const pctSalario = r2((valorGasto / salarioMinimo) * 100)

  // Meta pedagógica (escala simples)
  let metaEquivalente = ''
  if (valorGasto >= 5000) metaEquivalente = `${Math.round(valorGasto / 1200)} meses de fundo de emergência (6×despesas)`
  else if (valorGasto >= 2000) metaEquivalente = `passagem + hospedagem para viagem curta`
  else if (valorGasto >= 1000) metaEquivalente = `${Math.round(valorGasto / 120)} meses de academia ou curso online`
  else if (valorGasto >= 500)  metaEquivalente = `${Math.round(valorGasto / 50)} semanas do Desafio 52`
  else if (valorGasto >= 100)  metaEquivalente = `${Math.round(valorGasto / 35)} refeições saudáveis em casa`
  else metaEquivalente = `alguns cafés especiais ☕`

  // Projeção: se o usuário PARAR de gastar impulsivamente, em 12 meses…
  // = gasto_impulsivo_mensal × 12 + rendimento dos investimentos acumulados
  const economiaProjetada12m = r2(valorGasto * 12 + valorGasto * rend12m / valorGasto)

  return {
    valor_gasto:            r2(valorGasto),
    rendimento_1m:          rend1m,
    rendimento_12m:         rend12m,
    rendimento_24m:         rend24m,
    rendimento_60m:         rend60m,
    taxa_cdi_anual:         r2(cdiAnual * 100),
    taxa_cdi_mensal:        r2(taxaMensal * 100),
    equivalencia_salario:   pctSalario,
    meta_equivalente:       metaEquivalente,
    economia_projetada_12m: r2(valorGasto * 12),  // se parar tudo: economia bruta em 12m
  }
}

/**
 * Busca CDI atual da tabela cdi_historico (se existir) ou retorna referência.
 */
async function getCDIAtual(db: D1Database): Promise<number> {
  try {
    const row = await db.prepare(
      `SELECT ROUND((POW(1 + taxa/100, 252) - 1) * 100, 4) as taxa_anual FROM cdi_historico ORDER BY data DESC LIMIT 1`
    ).first() as any
    if (row?.taxa_anual && row.taxa_anual > 0) {
      return Number(row.taxa_anual) / 100  // converte % para decimal
    }
  } catch (_) { /* sem tabela CDI, usa referência */ }
  return CDI_ANUAL_REF
}

const comprasFantasma = new Hono<{ Bindings: Bindings; Variables: Variables }>()

// ── Categorias tipicamente impulsivas ─────────────────────────────────────
const CATEGORIAS_IMPULSO: Record<string, { peso: number; label: string; emoji: string }> = {
  'Lazer':       { peso: 0.7, label: 'Lazer / Entretenimento', emoji: '🎮' },
  'Roupas':      { peso: 0.8, label: 'Moda & Vestuário',       emoji: '👗' },
  'Alimentação': { peso: 0.5, label: 'Alimentação fora',       emoji: '🍕' },
  'Tecnologia':  { peso: 0.7, label: 'Tecnologia / Gadgets',   emoji: '📱' },
  'Beleza':      { peso: 0.6, label: 'Beleza & Estética',      emoji: '💅' },
  'Esporte':     { peso: 0.4, label: 'Esporte & Academia',     emoji: '🏋️' },
  'Viagem':      { peso: 0.6, label: 'Viagens & Turismo',      emoji: '✈️' },
  'Pets':        { peso: 0.5, label: 'Animais de Estimação',   emoji: '🐾' },
  'Outros':      { peso: 0.6, label: 'Outros / Indefinido',    emoji: '❓' },
}

// Palavras-chave de compras impulsivas (evitar falsos positivos com espaço/prefixo)
const IMPULSO_KEYWORDS = [
  { keywords: ['amazon', 'mercado livre', 'mercadolivre', 'shopee', 'aliexpress', 'magazine luiza', 'americanas', 'casas bahia'], label: 'Compra Online', emoji: '🛒', peso: 0.8 },
  { keywords: ['ifood', 'rappi', 'uber eats', 'aiqfome'], label: 'Delivery', emoji: '🍔', peso: 0.6 },
  { keywords: ['farmacia ', 'drogaria ', 'droga raia', 'ultrafarma', 'pacheco'], label: 'Farmácia', emoji: '💊', peso: 0.3 },
  { keywords: ['cinema', 'teatro', 'ingresso', 'bilheteria', 'showticket', 'ingressocom'], label: 'Entretenimento', emoji: '🎬', peso: 0.7 },
  { keywords: ['steam ', 'playstation store', 'xbox store', 'nintendo eshop', 'nuuvem', ' jogo ', 'game pass', 'xbox game', 'psn store'], label: 'Jogos Digitais', emoji: '🎮', peso: 0.9 },
  { keywords: ['sephora', 'boticario', 'o boticario', 'natura ', 'avon ', 'perfumaria'], label: 'Cosméticos', emoji: '💄', peso: 0.7 },
  { keywords: [' bar ', 'boteco', 'cervejaria', 'happy hour'], label: 'Bar / Cerveja', emoji: '🍺', peso: 0.7 },
]

// Padrões que indicam compra recorrente habitual (NÃO assinatura)
const RECORRENTE_PATTERNS = [
  /posto\s|combustivel|gasolina/i,
  /supermercado|mercado\s|hortifruti/i,
  /padaria|panificadora/i,
  /farmacia\s|drogaria\s/i,
  /academia\s|smart\s*fit|body\s*tech/i,
  /lavanderia/i,
  /estacionamento/i,
  /correios/i,
]

function normalizeDesc(desc: string): string {
  // Adiciona espaço nas bordas para facilitar match de palavras completas (ex: ' bar ', ' jogo ')
  return ' ' + desc.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ').trim() + ' '
}

// ── Helper: IA para classificar compras recorrentes ───────────────────────
async function classificarRecorrentesComIA(
  env: Bindings,
  grupos: Array<{ descricao: string; valor_medio: number; ocorrencias: number; intervalo_medio: number; categoria: string }>
): Promise<Array<{
  descricao: string
  tipo: 'habito_necessario' | 'habito_dispensavel' | 'assinatura' | 'compra_impulsiva_recorrente'
  confianca: number
  sugestao_reducao: string
  economia_potencial_pct: number
  motivo: string
}>> {
  const apiKey = env.OPENAI_API_KEY
  const baseURL = (env.OPENAI_BASE_URL || 'https://www.genspark.ai/api/llm_proxy/v1').replace(/\/$/, '')

  if (!apiKey || grupos.length === 0) return []

  const prompt = `Você é um consultor financeiro brasileiro especialista em comportamento de consumo. Analise estes grupos de compras recorrentes detectados nas despesas de um usuário.

TIPOS DE CLASSIFICAÇÃO:
- habito_necessario: Compras essenciais e difíceis de eliminar (mercado, combustível, remédios)
- habito_dispensavel: Hábito que pode ser reduzido/substituído (delivery frequente, bar, fast food)
- assinatura: Serviço de assinatura que já deveria estar registrado
- compra_impulsiva_recorrente: Compra repetida por impulso (mesma loja online, games, cosméticos)

Para cada grupo, analise se há potencial de REDUÇÃO de gastos e qual percentual é realista economizar.

Grupos detectados:
${JSON.stringify(grupos, null, 2)}

Responda APENAS com array JSON válido:
[{
  "descricao": "nome exato do grupo",
  "tipo": "habito_necessario|habito_dispensavel|assinatura|compra_impulsiva_recorrente",
  "confianca": 0-100,
  "sugestao_reducao": "ação concreta para economizar",
  "economia_potencial_pct": 0-80,
  "motivo": "explicação breve"
}]`

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
        temperature: 0.15,
        max_tokens: 3000,
      }),
    })

    if (!response.ok) return []
    const data = await response.json() as any
    const content = data.choices?.[0]?.message?.content || ''
    const jsonMatch = content.match(/\[[\s\S]*\]/)
    if (!jsonMatch) return []
    return JSON.parse(jsonMatch[0])
  } catch {
    return []
  }
}

// ── GET /api/compras-fantasma — análise de gastos impulsivos ──────────────
comprasFantasma.get('/', requireAuth, async (c) => {
  const user = c.get('user')
  const { mes, ano, meses_historico = '3' } = c.req.query()

  const now = new Date()
  const mesAtual = mes ? parseInt(mes) : now.getMonth() + 1
  const anoAtual = ano ? parseInt(ano) : now.getFullYear()
  const nMeses = Math.min(12, Math.max(1, parseInt(meses_historico)))

  const dataInicio = new Date(anoAtual, mesAtual - 1 - nMeses, 1)
  const dataInicioStr = dataInicio.toISOString().split('T')[0]

  const despesas = await c.env.DB.prepare(`
    SELECT d.id, d.descricao, d.valor, d.data, d.categoria, d.status,
           strftime('%m', d.data) as mes_num, strftime('%Y', d.data) as ano_num
    FROM despesas d
    WHERE d.user_id = ?
      AND d.data >= ?
      AND d.status != 'cancelado'
      AND d.eh_aporte_patrimonial != 1
      AND (d.numero_parcelas IS NULL OR d.numero_parcelas <= 1)
    ORDER BY d.data DESC
  `).bind(user.id, dataInicioStr).all()

  const todas = despesas.results as any[]
  if (todas.length === 0) {
    return c.json({
      compras_impulsivas: [],
      resumo: { total_gastos_analisados: 0, total_impulsivo: 0, percentual_impulsivo: 0, economia_potencial: 0 },
      alertas: [], dicas: ['Registre mais despesas para obter análise.'],
      mes: mesAtual, ano: anoAtual
    })
  }

  type CompraImpulsiva = {
    id: number; descricao: string; valor: number; data: string
    categoria: string; tipo_impulso: string; emoji: string
    score_impulso: number; mes_num: string; ano_num: string
  }

  const comprasImpulsivas: CompraImpulsiva[] = []
  let totalImpulsivo = 0
  const totalGeral = todas.reduce((s, d) => s + d.valor, 0)

  for (const d of todas) {
    const nDesc = normalizeDesc(d.descricao)
    let scoreImpulso = 0, tipoImpulso = '', emoji = '❓'

    for (const kw of IMPULSO_KEYWORDS) {
      if (kw.keywords.some(k => nDesc.includes(k))) {
        scoreImpulso += kw.peso * 100; tipoImpulso = kw.label; emoji = kw.emoji; break
      }
    }

    const catCfg = CATEGORIAS_IMPULSO[d.categoria]
    if (catCfg && scoreImpulso === 0) {
      scoreImpulso += catCfg.peso * 60; tipoImpulso = catCfg.label; emoji = catCfg.emoji
    } else if (catCfg) {
      scoreImpulso += catCfg.peso * 30
    }

    if (d.valor > 500 && !d.fixa_ou_variavel?.includes('fixa')) scoreImpulso += 10

    if (scoreImpulso >= 50) {
      comprasImpulsivas.push({
        id: d.id, descricao: d.descricao, valor: d.valor, data: d.data,
        categoria: d.categoria, tipo_impulso: tipoImpulso || 'Gasto não essencial',
        emoji, score_impulso: Math.min(100, Math.round(scoreImpulso)),
        mes_num: d.mes_num, ano_num: d.ano_num,
      })
      totalImpulsivo += d.valor
    }
  }

  // Agrupar por tipo
  const porTipo: Record<string, { label: string; emoji: string; total: number; count: number }> = {}
  for (const ci of comprasImpulsivas) {
    if (!porTipo[ci.tipo_impulso]) {
      porTipo[ci.tipo_impulso] = { label: ci.tipo_impulso, emoji: ci.emoji, total: 0, count: 0 }
    }
    porTipo[ci.tipo_impulso].total += ci.valor
    porTipo[ci.tipo_impulso].count++
  }

  const ranking = Object.values(porTipo)
    .sort((a, b) => b.total - a.total)
    .map(t => ({ ...t, total: Math.round(t.total * 100) / 100 }))

  const alertas: string[] = []
  const percentualImpulsivo = totalGeral > 0 ? (totalImpulsivo / totalGeral) * 100 : 0

  if (percentualImpulsivo > 40) {
    alertas.push(`⚠️ ${percentualImpulsivo.toFixed(0)}% dos seus gastos são potencialmente impulsivos! Objetivo: manter abaixo de 20%.`)
  }
  if (ranking[0]?.total > 0) {
    alertas.push(`🏆 Maior categoria impulsiva: ${ranking[0].emoji} ${ranking[0].label} — R$ ${ranking[0].total.toFixed(2)} (${ranking[0].count} compras).`)
  }
  const economiaDelivery = porTipo['Delivery']?.total || 0
  if (economiaDelivery > 200) {
    alertas.push(`🍔 Você gastou R$ ${economiaDelivery.toFixed(2)} em delivery. Cozinhar em casa pode economizar até 70% desse valor!`)
  }
  const economiaOnline = porTipo['Compra Online']?.total || 0
  if (economiaOnline > 500) {
    alertas.push(`🛒 R$ ${economiaOnline.toFixed(2)} em compras online. Aplique a regra das 24h antes de comprar.`)
  }

  const dicas: string[] = []
  if (percentualImpulsivo > 30) {
    dicas.push('📱 Desinstale apps de compras do celular por 30 dias e observe o impacto no orçamento.')
    dicas.push('⏰ Aplique a regra das 24h: anote o que deseja comprar e só compre no dia seguinte.')
  }
  if ((porTipo['Jogos Digitais']?.total || 0) > 50) {
    dicas.push('🎮 Considere assinar Xbox Game Pass ou PS Plus em vez de comprar jogos individuais.')
  }
  if (economiaDelivery > 100) {
    dicas.push('🥗 Planeje o cardápio semanal. Economize R$ ' + Math.round(economiaDelivery * 0.6) + '/mês reduzindo delivery!')
  }
  if (dicas.length === 0) {
    dicas.push('✅ Seus gastos parecem controlados! Continue registrando para manter o histórico.')
  }

  // Salvar análise para histórico
  try {
    await c.env.DB.prepare(`
      INSERT OR REPLACE INTO analise_compras_fantasma
      (user_id, mes, ano, total_analisado, total_impulsivo, percentual_impulsivo, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
    `).bind(user.id, mesAtual, anoAtual, totalGeral, totalImpulsivo, percentualImpulsivo).run()
  } catch (_) { }

  const categorias_impulsivas = ranking.map(r => ({ categoria: r.label, emoji: r.emoji, total: r.total, qtd: r.count }))
  const comprasFormatadas = comprasImpulsivas.slice(0, 50).map(ci => ({ ...ci, impulsive_score: ci.score_impulso }))

  return c.json({
    compras_impulsivas: comprasFormatadas,
    categorias_impulsivas,
    ranking_por_tipo: ranking,
    resumo: {
      total_despesas_analisadas: todas.length,
      total_compras_impulsivas: comprasImpulsivas.length,
      qtd_impulsivas: comprasImpulsivas.length,
      total_gastos_analisados: Math.round(totalGeral * 100) / 100,
      total_analisado: Math.round(totalGeral * 100) / 100,
      total_impulsivo: Math.round(totalImpulsivo * 100) / 100,
      percentual_impulsivo: Math.round(percentualImpulsivo * 10) / 10,
      economia_potencial: Math.round(totalImpulsivo * 0.3 * 100) / 100,
      periodo: `${nMeses} ${nMeses === 1 ? 'mês' : 'meses'}`,
    },
    alertas,
    dica: dicas[0] || '',
    dicas,
    periodo_meses: nMeses,
    mes: mesAtual, ano: anoAtual,
    // ── FASE 3.3: Custo de Oportunidade ───────────────────────────────────
    custo_oportunidade: await (async () => {
      const cdi = await getCDIAtual(c.env.DB)
      return calcularCustoOportunidade(Math.round(totalImpulsivo * 100) / 100, cdi)
    })(),
  })
})

// ── POST /api/compras-fantasma/analisar — detectar recorrentes com IA ─────
comprasFantasma.post('/analisar', requireAuth, async (c) => {
  const user = c.get('user')
  const { meses = 3, usar_ia = true } = await c.req.json().catch(() => ({})) as any

  const nMeses = Math.min(12, Math.max(1, parseInt(meses)))
  const dataInicio = new Date()
  dataInicio.setMonth(dataInicio.getMonth() - nMeses)
  const dataInicioStr = dataInicio.toISOString().split('T')[0]

  // Buscar despesas do período
  const result = await c.env.DB.prepare(`
    SELECT id, descricao, valor, data, categoria, status
    FROM despesas
    WHERE user_id = ?
      AND data >= ?
      AND status != 'cancelado'
      AND eh_aporte_patrimonial != 1
      AND (numero_parcelas IS NULL OR numero_parcelas <= 1)
    ORDER BY data ASC
  `).bind(user.id, dataInicioStr).all()

  const expenses = result.results as any[]
  if (expenses.length < 5) {
    return c.json({
      recorrentes: [],
      message: 'Dados insuficientes. Registre mais despesas para detectar padrões.',
      insufficient_data: true
    })
  }

  // ── Agrupar por descrição normalizada ────────────────────────────────────
  type RecGroup = {
    original: string
    normalized: string
    categoria: string
    valores: number[]
    datas: Date[]
  }

  const groups = new Map<string, RecGroup>()

  for (const exp of expenses) {
    const nDesc = normalizeDesc(exp.descricao)
    // Chave: primeiros 40 chars + bucket de valor (±20%)
    const bucket = Math.round(exp.valor / (exp.valor * 0.2 + 1)) // bucket relativo
    const key = `${nDesc.substring(0, 40)}`

    if (!groups.has(key)) {
      groups.set(key, {
        original: exp.descricao, normalized: nDesc,
        categoria: exp.categoria, valores: [], datas: [],
      })
    }
    const g = groups.get(key)!
    g.valores.push(exp.valor)
    g.datas.push(new Date(exp.data + 'T12:00:00'))
  }

  // ── Identificar recorrentes (≥3 ocorrências com intervalo razoável) ───────
  const recorrentes: any[] = []
  const gruposParaIA: any[] = []

  for (const [, group] of groups) {
    if (group.datas.length < 3) continue

    group.datas.sort((a, b) => a.getTime() - b.getTime())

    const intervals: number[] = []
    for (let i = 1; i < group.datas.length; i++) {
      const diff = Math.ceil((group.datas[i].getTime() - group.datas[i - 1].getTime()) / (1000 * 60 * 60 * 24))
      if (diff > 0) intervals.push(diff)
    }

    if (intervals.length === 0) continue

    const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length
    const variance = intervals.reduce((s, v) => s + Math.pow(v - avgInterval, 2), 0) / intervals.length
    const stdDev = Math.sqrt(variance)

    // Só aceitar intervalos razoáveis (até 45 dias) com certa regularidade
    if (avgInterval > 45 || stdDev > avgInterval * 0.6) continue

    const avgValor = group.valores.reduce((a, b) => a + b, 0) / group.valores.length
    const minValor = Math.min(...group.valores)
    const maxValor = Math.max(...group.valores)

    const frequencyLabel = avgInterval <= 10 ? 'semanal'
      : avgInterval <= 18 ? 'quinzenal'
      : 'mensal'

    recorrentes.push({
      normalized: group.normalized,
      original: group.original,
      categoria: group.categoria,
      amount_avg: Math.round(avgValor * 100) / 100,
      amount_min: Math.round(minValor * 100) / 100,
      amount_max: Math.round(maxValor * 100) / 100,
      occurrences: group.datas.length,
      first_occurrence: group.datas[0].toISOString().split('T')[0],
      last_occurrence: group.datas[group.datas.length - 1].toISOString().split('T')[0],
      average_interval_days: Math.round(avgInterval * 10) / 10,
      frequency_label: frequencyLabel,
    })

    gruposParaIA.push({
      descricao: group.original,
      valor_medio: Math.round(avgValor * 100) / 100,
      ocorrencias: group.datas.length,
      intervalo_medio: Math.round(avgInterval),
      categoria: group.categoria,
    })
  }

  // ── Analisar com IA ──────────────────────────────────────────────────────
  let iaResults: Map<string, any> = new Map()
  if (usar_ia && gruposParaIA.length > 0) {
    const iaAnalysis = await classificarRecorrentesComIA(c.env, gruposParaIA.slice(0, 25))
    for (const ia of iaAnalysis) {
      iaResults.set(normalizeDesc(ia.descricao), ia)
    }
  }

  // ── Salvar/atualizar no banco ─────────────────────────────────────────────
  let novosCount = 0
  const recorrentesEnriquecidos = []

  for (const rec of recorrentes) {
    const iaResult = iaResults.get(rec.normalized)

    const economiaPercent = iaResult?.economia_potencial_pct || 20
    const economiaAnual = rec.amount_avg * 12 * (economiaPercent / 100)

    const item = {
      ...rec,
      ia_tipo: iaResult?.tipo || 'habito_necessario',
      ia_classificado: iaResult ? 1 : 0,
      sugestao_reducao: iaResult?.sugestao_reducao || '',
      confianca: iaResult?.confianca || 60,
      economia_potencial_pct: economiaPercent,
      economia_mensal: Math.round((rec.amount_avg * economiaPercent / 100) * 100) / 100,
      economia_anual: Math.round(economiaAnual * 100) / 100,
      motivo: iaResult?.motivo || '',
    }

    recorrentesEnriquecidos.push(item)

    // Upsert na tabela
    const existing = await c.env.DB.prepare(
      `SELECT id, status FROM compras_recorrentes_detectadas WHERE user_id = ? AND normalized_description = ?`
    ).bind(user.id, rec.normalized.substring(0, 200)).first() as any

    if (!existing) {
      await c.env.DB.prepare(`
        INSERT INTO compras_recorrentes_detectadas
        (user_id, normalized_description, original_description, categoria,
         amount_avg, amount_min, amount_max, frequency_label,
         occurrences, first_occurrence, last_occurrence, average_interval_days,
         confidence, ia_classificado, ia_tipo, economia_mensal, economia_anual)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        user.id, rec.normalized.substring(0, 200), rec.original.substring(0, 200), rec.categoria,
        item.amount_avg, item.amount_min, item.amount_max, item.frequency_label,
        item.occurrences, item.first_occurrence, item.last_occurrence, item.average_interval_days,
        item.confianca, item.ia_classificado, item.ia_tipo, item.economia_mensal, item.economia_anual
      ).run().catch(() => {})
      novosCount++
    } else if (existing.status === 'active') {
      await c.env.DB.prepare(`
        UPDATE compras_recorrentes_detectadas SET
          occurrences = ?, last_occurrence = ?, ia_tipo = ?, ia_classificado = ?,
          economia_mensal = ?, economia_anual = ?, updated_at = datetime('now')
        WHERE id = ?
      `).bind(item.occurrences, item.last_occurrence, item.ia_tipo, item.ia_classificado,
        item.economia_mensal, item.economia_anual, existing.id).run().catch(() => {})
    }
  }

  // Calcular totais
  const totalEconomiaMensal = recorrentesEnriquecidos.reduce((s, r) => s + r.economia_mensal, 0)
  const totalEconomiaAnual = recorrentesEnriquecidos.reduce((s, r) => s + r.economia_anual, 0)

  const dispensaveis = recorrentesEnriquecidos.filter(r => r.ia_tipo === 'habito_dispensavel' || r.ia_tipo === 'compra_impulsiva_recorrente')
  const necessarios = recorrentesEnriquecidos.filter(r => r.ia_tipo === 'habito_necessario')
  const assinaturas = recorrentesEnriquecidos.filter(r => r.ia_tipo === 'assinatura')

  // FASE 3.3: custo de oportunidade sobre a economia mensal potencial
  const cdiAnalisar = await getCDIAtual(c.env.DB)
  const custoOpAnalisar = calcularCustoOportunidade(
    Math.round(totalEconomiaMensal * 100) / 100,
    cdiAnalisar
  )

  return c.json({
    recorrentes: recorrentesEnriquecidos,
    novos_encontrados: novosCount,
    total: recorrentesEnriquecidos.length,
    resumo: {
      total_grupos: recorrentesEnriquecidos.length,
      dispensaveis: dispensaveis.length,
      necessarios: necessarios.length,
      assinaturas_detectadas: assinaturas.length,
      economia_mensal_potencial: Math.round(totalEconomiaMensal * 100) / 100,
      economia_anual_potencial: Math.round(totalEconomiaAnual * 100) / 100,
      // FASE 3.3: se investir a economia mensal durante 12 meses
      custo_oportunidade_economia: custoOpAnalisar,
    },
    ia_utilizada: iaResults.size > 0,
    message: recorrentesEnriquecidos.length === 0
      ? '✅ Nenhum padrão de compra recorrente detectado no período.'
      : `🔍 ${recorrentesEnriquecidos.length} padrão(ões) de compra recorrente identificado(s). Economia potencial: R$ ${Math.round(totalEconomiaAnual * 100) / 100}/ano.`
  })
})

// ── GET /api/compras-fantasma/recorrentes — listar recorrentes detectadas ─
comprasFantasma.get('/recorrentes', requireAuth, async (c) => {
  const user = c.get('user')
  const { status = 'active' } = c.req.query()

  const result = await c.env.DB.prepare(`
    SELECT * FROM compras_recorrentes_detectadas
    WHERE user_id = ? AND status = ?
    ORDER BY economia_anual DESC
  `).bind(user.id, status).all()

  const items = result.results as any[]
  const totalEconomiaMensal = items.reduce((s, r) => s + (r.economia_mensal || 0), 0)
  const totalEconomiaAnual = items.reduce((s, r) => s + (r.economia_anual || 0), 0)

  return c.json({
    recorrentes: items,
    total: items.length,
    economia_mensal_potencial: Math.round(totalEconomiaMensal * 100) / 100,
    economia_anual_potencial: Math.round(totalEconomiaAnual * 100) / 100,
  })
})

// ── POST /api/compras-fantasma/recorrentes/:id/reduzir — registrar redução ─
comprasFantasma.post('/recorrentes/:id/reduzir', requireAuth, async (c) => {
  const user = c.get('user')
  const id = parseInt(c.req.param('id'))
  if (!Number.isInteger(id) || id < 1) return c.json({ error: 'ID inválido.' }, 400)
  const { novo_valor, motivo } = await c.req.json() as { novo_valor: number; motivo?: string }

  if (!novo_valor || parseFloat(String(novo_valor)) <= 0) {
    return c.json({ error: 'Informe o novo valor após a redução' }, 400)
  }

  const rec = await c.env.DB.prepare(
    `SELECT * FROM compras_recorrentes_detectadas WHERE id = ? AND user_id = ?`
  ).bind(id, user.id).first() as any
  if (!rec) return c.json({ error: 'Compra recorrente não encontrada' }, 404)

  const valorAntigo = rec.amount_avg
  const novoValorNum = parseFloat(String(novo_valor))
  const reducaoMensal = Math.max(0, valorAntigo - novoValorNum)
  const reducaoAnual = reducaoMensal * 12

  await c.env.DB.prepare(`
    UPDATE compras_recorrentes_detectadas SET
      status = 'reduced',
      valor_reduzido = ?,
      economia_mensal = ?,
      economia_anual = ?,
      reduced_at = datetime('now'),
      updated_at = datetime('now')
    WHERE id = ? AND user_id = ?
  `).bind(novoValorNum, reducaoMensal, reducaoAnual, id, user.id).run()

  return c.json({
    success: true,
    economia_mensal: Math.round(reducaoMensal * 100) / 100,
    economia_anual: Math.round(reducaoAnual * 100) / 100,
    message: `✅ Redução registrada! Você economizará R$ ${reducaoAnual.toFixed(2)}/ano com ${rec.original_description}.`
  })
})

// ── GET /api/compras-fantasma/recorrentes/historico-economia ─────────────
// Histórico de contas recorrentes reduzidas com valor economizado
comprasFantasma.get('/recorrentes/historico-economia', requireAuth, async (c) => {
  const user = c.get('user')

  // Buscar recorrentes com status 'reduced' ou 'cancelled'
  const result = await c.env.DB.prepare(`
    SELECT * FROM compras_recorrentes_detectadas
    WHERE user_id = ? AND status IN ('reduced', 'cancelled')
    ORDER BY reduced_at DESC, updated_at DESC
  `).bind(user.id).all()

  const items = result.results as any[]

  const hoje = new Date()
  let totalEconomiaMensal = 0
  let totalEconomiaAcumulada = 0
  let totalEconomiaAnual = 0

  const itemsEnriquecidos = items.map(item => {
    const reducedAt = new Date(item.reduced_at || item.updated_at)
    const mesesDesde = Math.max(0, Math.floor((hoje.getTime() - reducedAt.getTime()) / (1000 * 60 * 60 * 24 * 30)))
    const economiaAcumulada = (item.economia_mensal || 0) * mesesDesde

    totalEconomiaMensal += item.economia_mensal || 0
    totalEconomiaAcumulada += economiaAcumulada
    totalEconomiaAnual += item.economia_anual || 0

    return {
      ...item,
      meses_desde_reducao: mesesDesde,
      economia_acumulada: Math.round(economiaAcumulada * 100) / 100,
    }
  })

  // Também buscar do GET / histórico de análises para contexto
  let historicoAnalises: any[] = []
  try {
    const histResult = await c.env.DB.prepare(`
      SELECT mes, ano, total_analisado, total_impulsivo, percentual_impulsivo, updated_at
      FROM analise_compras_fantasma
      WHERE user_id = ?
      ORDER BY ano DESC, mes DESC
      LIMIT 12
    `).bind(user.id).all()
    historicoAnalises = histResult.results as any[]
  } catch (_) { }

  return c.json({
    recorrentes_reduzidas: itemsEnriquecidos,
    total_reduzidas: itemsEnriquecidos.length,
    resumo_economia: {
      economia_mensal: Math.round(totalEconomiaMensal * 100) / 100,
      economia_acumulada_total: Math.round(totalEconomiaAcumulada * 100) / 100,
      projecao_12_meses: Math.round(totalEconomiaAnual * 100) / 100,
    },
    historico_analises: historicoAnalises,
  })
})

// ── POST /api/compras-fantasma/marcar — classificar despesa ──────────────
comprasFantasma.post('/marcar/:id', requireAuth, async (c) => {
  const user = c.get('user')
  const id = parseInt(c.req.param('id'))
  if (!Number.isInteger(id) || id < 1) return c.json({ error: 'ID inválido.' }, 400)
  const { classificacao } = await c.req.json() as { classificacao: string }

  if (!['necessaria', 'desnecessaria', 'impulso'].includes(classificacao))
    return c.json({ error: 'Classificação inválida. Use: necessaria, desnecessaria, impulso' }, 400)

  const despesa = await c.env.DB.prepare(
    `SELECT id FROM despesas WHERE id = ? AND user_id = ?`
  ).bind(id, user.id).first()
  if (!despesa) return c.json({ error: 'Despesa não encontrada' }, 404)

  await c.env.DB.prepare(
    `UPDATE despesas SET observacoes = COALESCE(observacoes || ' ', '') || ? WHERE id = ? AND user_id = ?`
  ).bind(`[${classificacao}]`, id, user.id).run()

  return c.json({
    success: true,
    message: classificacao === 'necessaria' ? '✅ Despesa marcada como necessária'
      : classificacao === 'desnecessaria' ? '🚫 Despesa marcada como desnecessária'
      : '⚡ Despesa marcada como compra por impulso'
  })
})

// ── GET /api/compras-fantasma/custo-oportunidade — FASE 3.3 ──────────────
// Calcula o custo de oportunidade dos gastos impulsivos do período
comprasFantasma.get('/custo-oportunidade', requireAuth, async (c) => {
  const user = c.get('user')
  const { meses = '3' } = c.req.query()
  const nMeses = Math.min(12, Math.max(1, parseInt(meses as string)))

  const dataInicio = new Date()
  dataInicio.setMonth(dataInicio.getMonth() - nMeses)
  const dataInicioStr = dataInicio.toISOString().split('T')[0]

  // Buscar despesas do período para calcular impulsivas
  const result = await c.env.DB.prepare(`
    SELECT d.valor, d.descricao, d.categoria, d.data
    FROM despesas d
    WHERE d.user_id = ?
      AND d.data >= ?
      AND d.status != 'cancelado'
      AND d.eh_aporte_patrimonial != 1
    ORDER BY d.data DESC
  `).bind(user.id, dataInicioStr).all()

  const despesas = result.results as any[]

  // Calcular total impulsivo usando mesma lógica do endpoint principal
  let totalImpulsivo = 0
  let totalGeral = 0
  const porCategoria: Record<string, number> = {}

  for (const d of despesas) {
    totalGeral += Number(d.valor)
    const cat = (d.categoria || 'Outros')
    const categoriaInfo = CATEGORIAS_IMPULSO[cat]
    const desc = normalizeDesc(d.descricao || '')
    let peso = 0

    if (categoriaInfo) peso = Math.max(peso, categoriaInfo.peso)
    for (const kw of IMPULSO_KEYWORDS) {
      if (kw.keywords.some(k => desc.includes(k))) {
        peso = Math.max(peso, kw.peso)
        break
      }
    }
    const isRecorrente = RECORRENTE_PATTERNS.some(p => p.test(d.descricao || ''))
    if (isRecorrente) peso = Math.min(peso, 0.3)

    if (peso >= 0.4) {
      const valorImpulsivo = Number(d.valor) * peso
      totalImpulsivo += valorImpulsivo
      porCategoria[cat] = (porCategoria[cat] || 0) + valorImpulsivo
    }
  }

  const cdi = await getCDIAtual(c.env.DB)
  const custoPrincipal = calcularCustoOportunidade(Math.round(totalImpulsivo * 100) / 100, cdi)

  // Custo de oportunidade por categoria (top 5 mais impactantes)
  const porCatArray = Object.entries(porCategoria)
    .map(([cat, val]) => ({
      categoria: cat,
      emoji: CATEGORIAS_IMPULSO[cat]?.emoji || '❓',
      valor_impulsivo: Math.round(val * 100) / 100,
      custo_oportunidade_12m: Math.round(val * (Math.pow(1 + Math.pow(1 + cdi, 1/12) - 1, 12) - 1) * 100) / 100,
    }))
    .sort((a, b) => b.valor_impulsivo - a.valor_impulsivo)
    .slice(0, 5)

  // Cenários comparativos: e se investisse esse valor?
  const cenarios = [
    {
      nome: 'Tesouro Selic (CDI ~100%)',
      taxa_anual: cdi,
      rendimento_12m: custoPrincipal.rendimento_12m,
      rendimento_60m: custoPrincipal.rendimento_60m,
      risco: 'Muito Baixo',
      emoji: '🏦',
    },
    {
      nome: 'CDB 120% CDI',
      taxa_anual: cdi * 1.2,
      rendimento_12m: Math.round(totalImpulsivo * (Math.pow(1 + Math.pow(1 + cdi * 1.2, 1/12) - 1, 12) - 1) * 100) / 100,
      rendimento_60m: Math.round(totalImpulsivo * (Math.pow(1 + Math.pow(1 + cdi * 1.2, 1/12) - 1, 60) - 1) * 100) / 100,
      risco: 'Baixo',
      emoji: '💼',
    },
    {
      nome: 'Fundo Multimercado (~15% a.a.)',
      taxa_anual: 0.15,
      rendimento_12m: Math.round(totalImpulsivo * (Math.pow(1 + Math.pow(1.15, 1/12) - 1, 12) - 1) * 100) / 100,
      rendimento_60m: Math.round(totalImpulsivo * (Math.pow(1 + Math.pow(1.15, 1/12) - 1, 60) - 1) * 100) / 100,
      risco: 'Moderado',
      emoji: '📈',
    },
    {
      nome: 'Ações / FIIs (~18% a.a.)',
      taxa_anual: 0.18,
      rendimento_12m: Math.round(totalImpulsivo * (Math.pow(1 + Math.pow(1.18, 1/12) - 1, 12) - 1) * 100) / 100,
      rendimento_60m: Math.round(totalImpulsivo * (Math.pow(1 + Math.pow(1.18, 1/12) - 1, 60) - 1) * 100) / 100,
      risco: 'Alto',
      emoji: '🚀',
    },
  ]

  // Mensagem pedagógica principal
  let mensagemPrincipal = ''
  if (totalImpulsivo <= 0) {
    mensagemPrincipal = '✅ Nenhum gasto impulsivo identificado no período. Ótimo controle financeiro!'
  } else {
    const rend12m = custoPrincipal.rendimento_12m
    mensagemPrincipal = `💡 Os R$ ${custoPrincipal.valor_gasto.toFixed(2)} gastos impulsivamente em ${nMeses} ${nMeses === 1 ? 'mês' : 'meses'} poderiam render R$ ${rend12m.toFixed(2)} em 12 meses investidos no Tesouro Selic. Em 5 anos, o rendimento seria de R$ ${custoPrincipal.rendimento_60m.toFixed(2)}.`
  }

  return c.json({
    periodo_meses: nMeses,
    total_impulsivo: Math.round(totalImpulsivo * 100) / 100,
    total_analisado: Math.round(totalGeral * 100) / 100,
    percentual_impulsivo: totalGeral > 0 ? Math.round((totalImpulsivo / totalGeral) * 1000) / 10 : 0,
    cdi_utilizado: Math.round(cdi * 10000) / 100,  // em %
    custo_oportunidade: custoPrincipal,
    por_categoria: porCatArray,
    cenarios_investimento: cenarios,
    mensagem: mensagemPrincipal,
  })
})

// ── GET /api/compras-fantasma/historico — histórico de análises mensais ──
comprasFantasma.get('/historico', requireAuth, async (c) => {
  const user = c.get('user')
  try {
    const result = await c.env.DB.prepare(`
      SELECT mes, ano, total_analisado, total_impulsivo, percentual_impulsivo, updated_at
      FROM analise_compras_fantasma
      WHERE user_id = ?
      ORDER BY ano DESC, mes DESC
      LIMIT 12
    `).bind(user.id).all()
    return c.json({ historico: result.results || [] })
  } catch (_) {
    return c.json({ historico: [], message: 'Histórico ainda não disponível' })
  }
})

export default comprasFantasma
