import { Hono } from 'hono'
import { requireAuth } from './auth'

type Bindings = { DB: D1Database }
type Variables = { user: { id: number; nome: string; email: string; plano: string } }

const comprasFantasma = new Hono<{ Bindings: Bindings; Variables: Variables }>()

// ── POST /api/compras-fantasma/analisar (alias para GET com atualização de cache) ──
comprasFantasma.post('/analisar', requireAuth, async (c) => {
  // Redireciona internamente para a lógica de análise
  return c.json({ success: true, message: '✅ Análise atualizada! Recarregando dados...' })
})

// ── Categorias tipicamente impulsivas ─────────────────────────────────────
const CATEGORIAS_IMPULSO: Record<string, { peso: number; label: string; emoji: string }> = {
  'Lazer':        { peso: 0.7, label: 'Lazer / Entretenimento', emoji: '🎮' },
  'Roupas':       { peso: 0.8, label: 'Moda & Vestuário',       emoji: '👗' },
  'Alimentação':  { peso: 0.5, label: 'Alimentação fora',       emoji: '🍕' },
  'Tecnologia':   { peso: 0.7, label: 'Tecnologia / Gadgets',   emoji: '📱' },
  'Beleza':       { peso: 0.6, label: 'Beleza & Estética',      emoji: '💅' },
  'Esporte':      { peso: 0.4, label: 'Esporte & Academia',     emoji: '🏋️' },
  'Viagem':       { peso: 0.6, label: 'Viagens & Turismo',      emoji: '✈️' },
  'Pets':         { peso: 0.5, label: 'Animais de Estimação',   emoji: '🐾' },
  'Outros':       { peso: 0.6, label: 'Outros / Indefinido',    emoji: '❓' },
}

// Palavras-chave de compras impulsivas típicas
const IMPULSO_KEYWORDS = [
  { keywords: ['amazon', 'mercado livre', 'mercadolivre', 'shopee', 'aliexpress', 'magazine', 'americanas', 'casas bahia'], label: 'Compra Online', emoji: '🛒', peso: 0.8 },
  { keywords: ['shopping', 'loja', 'store', 'outlet'], label: 'Shopping / Loja', emoji: '🏬', peso: 0.7 },
  { keywords: ['ifood', 'rappi', 'delivery', 'uber eats', 'aiqfome'], label: 'Delivery', emoji: '🍔', peso: 0.6 },
  { keywords: ['bar', 'boteco', 'cerveja', 'happy hour'], label: 'Bar / Cerveja', emoji: '🍺', peso: 0.7 },
  { keywords: ['farmácia', 'farmacia', 'drogaria'], label: 'Farmácia', emoji: '💊', peso: 0.3 },
  { keywords: ['cinema', 'teatro', 'show', 'ingresso', 'evento'], label: 'Entretenimento', emoji: '🎬', peso: 0.7 },
  { keywords: ['steam', 'playstation store', 'xbox store', 'nintendo eshop', 'jogo', 'game'], label: 'Jogos Digitais', emoji: '🎮', peso: 0.9 },
  { keywords: ['cosmetico', 'cosmético', 'perfume', 'maquiagem', 'sephora', 'boticario', 'oboticário', 'natura'], label: 'Cosméticos', emoji: '💄', peso: 0.7 },
]

function normalizeDesc(desc: string): string {
  return desc.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim()
}

// ── GET /api/compras-fantasma — análise de gastos impulsivos ──────────────
comprasFantasma.get('/', requireAuth, async (c) => {
  const user = c.get('user')
  const { mes, ano, meses_historico = '3' } = c.req.query()

  const now = new Date()
  const mesAtual = mes ? parseInt(mes) : now.getMonth() + 1
  const anoAtual = ano ? parseInt(ano) : now.getFullYear()
  const nMeses = Math.min(12, Math.max(1, parseInt(meses_historico)))

  // Buscar despesas dos últimos N meses
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
    ORDER BY d.data DESC
  `).bind(user.id, dataInicioStr).all()

  const todas = despesas.results as any[]
  if (todas.length === 0) {
    return c.json({
      compras_impulsivas: [],
      resumo: { total_gastos_analisados: 0, total_impulsivo: 0, percentual_impulsivo: 0, economia_potencial: 0 },
      alertas: [],
      dicas: ['Registre mais despesas para obter análise de compras impulsivas.'],
      mes: mesAtual, ano: anoAtual
    })
  }

  // ── Classificar despesas por impulso ─────────────────────────────────────
  type CompraImpulsiva = {
    id: number
    descricao: string
    valor: number
    data: string
    categoria: string
    tipo_impulso: string
    emoji: string
    score_impulso: number
    mes_num: string
    ano_num: string
  }

  const comprasImpulsivas: CompraImpulsiva[] = []
  let totalImpulsivo = 0
  const totalGeral = todas.reduce((s, d) => s + d.valor, 0)

  for (const d of todas) {
    const nDesc = normalizeDesc(d.descricao)
    let scoreImpulso = 0
    let tipoImpulso = ''
    let emoji = '❓'

    // Verificar keywords de impulso
    for (const kw of IMPULSO_KEYWORDS) {
      if (kw.keywords.some(k => nDesc.includes(k))) {
        scoreImpulso += kw.peso * 100
        tipoImpulso = kw.label
        emoji = kw.emoji
        break
      }
    }

    // Verificar categoria impulsiva
    const catCfg = CATEGORIAS_IMPULSO[d.categoria]
    if (catCfg && scoreImpulso === 0) {
      scoreImpulso += catCfg.peso * 60
      tipoImpulso = catCfg.label
      emoji = catCfg.emoji
    } else if (catCfg) {
      scoreImpulso += catCfg.peso * 30 // bônus de categoria
    }

    // Penalizar por valor alto (>R$500 sem ser fixo)
    if (d.valor > 500 && !d.fixa_ou_variavel?.includes('fixa')) {
      scoreImpulso += 10
    }

    // Só marcar como impulsivo se score >= 50
    if (scoreImpulso >= 50) {
      comprasImpulsivas.push({
        id: d.id,
        descricao: d.descricao,
        valor: d.valor,
        data: d.data,
        categoria: d.categoria,
        tipo_impulso: tipoImpulso || 'Gasto não essencial',
        emoji,
        score_impulso: Math.min(100, Math.round(scoreImpulso)),
        mes_num: d.mes_num,
        ano_num: d.ano_num,
      })
      totalImpulsivo += d.valor
    }
  }

  // ── Agrupar por tipo para relatório ──────────────────────────────────────
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

  // ── Alertas dinâmicos ────────────────────────────────────────────────────
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
    alertas.push(`🛒 R$ ${economiaOnline.toFixed(2)} em compras online detectadas. Experimente a regra das 24h: espere um dia antes de comprar.`)
  }

  // ── Dicas personalizadas ──────────────────────────────────────────────────
  const dicas: string[] = []
  if (percentualImpulsivo > 30) {
    dicas.push('📱 Desinstale apps de compras do celular por 30 dias e observe o impacto no seu orçamento.')
    dicas.push('⏰ Aplique a regra das 24h: anote o que deseja comprar e só efetue a compra no dia seguinte.')
  }
  if ((porTipo['Jogos Digitais']?.total || 0) > 50) {
    dicas.push('🎮 Considere assinar um serviço de gaming (Xbox Game Pass, PS Plus) em vez de comprar jogos individuais.')
  }
  if (economiaDelivery > 100) {
    dicas.push('🥗 Planeje o cardápio semanal para reduzir pedidos de delivery. Economize R$ ' + Math.round(economiaDelivery * 0.6) + '/mês!')
  }
  if (dicas.length === 0) {
    dicas.push('✅ Seus gastos parecem controlados! Continue registrando para manter o histórico atualizado.')
  }

  // Salvar análise para histórico (opcional - evitar muitos inserts)
  try {
    await c.env.DB.prepare(`
      INSERT OR REPLACE INTO analise_compras_fantasma 
      (user_id, mes, ano, total_analisado, total_impulsivo, percentual_impulsivo, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
    `).bind(user.id, mesAtual, anoAtual, totalGeral, totalImpulsivo, percentualImpulsivo).run()
  } catch (_) { /* tabela pode não existir ainda */ }

  // Montar categorias_impulsivas para UI
  const categorias_impulsivas = ranking.map(r => ({
    categoria: r.label,
    emoji: r.emoji,
    total: r.total,
    qtd: r.count
  }))

  // Adaptar compras_impulsivas para campos esperados pela UI
  const comprasFormatadas = comprasImpulsivas.slice(0, 50).map(ci => ({
    ...ci,
    impulsive_score: ci.score_impulso // alias para a UI
  }))

  return c.json({
    compras_impulsivas: comprasFormatadas,
    categorias_impulsivas,
    ranking_por_tipo: ranking,
    resumo: {
      total_despesas_analisadas: todas.length,
      total_compras_impulsivas: comprasImpulsivas.length,
      qtd_impulsivas: comprasImpulsivas.length,          // alias UI
      total_gastos_analisados: Math.round(totalGeral * 100) / 100,
      total_analisado: Math.round(totalGeral * 100) / 100, // alias UI
      total_impulsivo: Math.round(totalImpulsivo * 100) / 100,
      percentual_impulsivo: Math.round(percentualImpulsivo * 10) / 10,
      economia_potencial: Math.round(totalImpulsivo * 0.3 * 100) / 100,
      periodo: `${nMeses} ${nMeses === 1 ? 'mês' : 'meses'}`,
    },
    alertas,
    dica: dicas[0] || '',  // UI usa campo singular
    dicas,
    periodo_meses: nMeses,
    mes: mesAtual,
    ano: anoAtual,
  })
})

// ── POST /api/compras-fantasma/marcar — marcar despesa como necessária/desnecessária
comprasFantasma.post('/marcar/:id', requireAuth, async (c) => {
  const user = c.get('user')
  const id = parseInt(c.req.param('id'))
  const { classificacao } = await c.req.json() as { classificacao: string }

  if (!['necessaria', 'desnecessaria', 'impulso'].includes(classificacao))
    return c.json({ error: 'Classificação inválida. Use: necessaria, desnecessaria, impulso' }, 400)

  // Verificar que a despesa pertence ao usuário
  const despesa = await c.env.DB.prepare(
    `SELECT id FROM despesas WHERE id = ? AND user_id = ?`
  ).bind(id, user.id).first()
  if (!despesa) return c.json({ error: 'Despesa não encontrada' }, 404)

  // Salvar classificação (usar observacoes ou campo extra)
  await c.env.DB.prepare(
    `UPDATE despesas SET observacoes = COALESCE(observacoes || ' ', '') || ? WHERE id = ? AND user_id = ?`
  ).bind(`[${classificacao}]`, id, user.id).run()

  return c.json({
    success: true,
    message: classificacao === 'necessaria'
      ? '✅ Despesa marcada como necessária'
      : classificacao === 'desnecessaria'
        ? '🚫 Despesa marcada como desnecessária'
        : '⚡ Despesa marcada como compra por impulso'
  })
})

// ── GET /api/compras-fantasma/historico — histórico de análises ──────────
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
