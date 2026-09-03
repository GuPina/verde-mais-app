import { Hono } from 'hono'
import { competenciaAno, competenciaData, competenciaMes, filtroDespesaDoMes, filtroNaoCancelada, filtroSemAporte } from '../lib/competencia'
import { requireAuth } from './auth'
import { exigeFeature } from './planos'

type Bindings = { DB: D1Database }
type Variables = { user: { id: number; nome: string; email: string; plano: string } }

const regra503020 = new Hono<{ Bindings: Bindings; Variables: Variables }>()

// Mapeamento de categorias do VerdeMais para os 3 grupos
const NEEDS_CATS = [
  'Alimentação', 'Moradia', 'Saúde', 'Transporte', 'Educação', 'Contas',
  'Mercado', 'Farmácia', 'Farmacia', 'Aluguel', 'Seguro', 'Serviços',
  'Serviços Essenciais', 'Supermercado', 'Conta de Luz', 'Conta de Água',
  'Conta de Gás', 'Internet', 'Telefone', 'Plano de Saúde', 'Escola',
  'Faculdade', 'Trabalho', 'Condomínio'
]
const WANTS_CATS = [
  'Lazer', 'Viagem', 'Roupas', 'Assinaturas', 'Delivery', 'Restaurante',
  'Beleza', 'Entretenimento', 'Pets', 'Eletrônicos', 'Outros',
  'Tecnologia', 'Shopping', 'Esporte', 'Academia', 'Streaming',
  'Bar', 'Jogos', 'Hobbies', 'Presente', 'Moda', 'Cosméticos'
]
const SAVINGS_CATS = [
  'Investimentos', 'Poupança', 'Reserva', 'Aplicação', 'Tesouro',
  'Previdência', 'CDB', 'LCI', 'LCA', 'Fundo'
]

/**
 * A classificação de uma categoria em necessidade / desejo / poupança estava
 * escrita solta dentro do GET '/'. O histórico precisa exatamente da mesma
 * regra: duplicá-la garantiria que um dia o mês isolado e o gráfico anual
 * discordassem sobre o mesmo gasto.
 */
function grupoDaCategoria(cat: string): 'needs' | 'savings' | 'wants' {
  const c = cat.toLowerCase()
  if (NEEDS_CATS.some(n => c.includes(n.toLowerCase()))) return 'needs'
  if (SAVINGS_CATS.some(x => c.includes(x.toLowerCase()))) return 'savings'
  return 'wants'
}

/**
 * O score é a distância entre a distribuição real e a meta configurada.
 * Devolve também as três parcelas: um número de 0 a 100 que não se explica
 * não ajuda ninguém a saber o que mudar.
 */
function calcularScore(
  income: number, pN: number, pW: number, pS: number,
  alvoN: number, alvoW: number, alvoS: number,
) {
  // Necessidade tem tolerância maior que desejo: quem mora caro não muda de
  // aluguel no mês seguinte, mas corta delivery na semana.
  const needsScore = Math.max(0, 100 - Math.abs(pN - alvoN) * 2)
  const wantsScore = Math.max(0, 100 - Math.abs(pW - alvoW) * 3)
  // Poupar acima da meta nunca penaliza — é o único desvio que é bom.
  const savingsScore = alvoS > 0
    ? Math.max(0, Math.min(100, (pS / alvoS) * 100))
    : (pS > 0 ? 100 : 0)
  const score = income === 0 ? 0 : Math.round(needsScore * 0.3 + wantsScore * 0.3 + savingsScore * 0.4)
  return {
    score,
    fatores: [
      { chave: 'needs',   rotulo: 'Necessidades', nota: Math.round(needsScore),   peso: 30, real: Math.round(pN * 10) / 10, alvo: alvoN },
      { chave: 'wants',   rotulo: 'Desejos',      nota: Math.round(wantsScore),   peso: 30, real: Math.round(pW * 10) / 10, alvo: alvoW },
      { chave: 'savings', rotulo: 'Poupança',     nota: Math.round(savingsScore), peso: 40, real: Math.round(pS * 10) / 10, alvo: alvoS },
    ],
  }
}

// ── GET /api/regra-503020/config — Melhoria 3.2 ───────────────────────────────
regra503020.get('/config', requireAuth, async (c) => {
  const user = c.get('user')

  const config = await c.env.DB.prepare(
    `SELECT * FROM regra_config WHERE user_id = ? ORDER BY id DESC LIMIT 1`
  ).bind(user.id).first() as any

  if (!config) {
    return c.json({
      pct_necessidades: 50,
      pct_desejos: 30,
      pct_poupanca: 20,
      nome_personalizado: 'Regra 50/30/20',
      is_default: true
    })
  }

  return c.json({ ...config, is_default: false })
})

// ── POST /api/regra-503020/config — Melhoria 3.2 ─────────────────────────────
regra503020.post('/config', requireAuth, exigeFeature('regra_personalizada'), async (c) => {
  const user = c.get('user')
  const { pct_necessidades = 50, pct_desejos = 30, pct_poupanca = 20, nome_personalizado } = await c.req.json()

  const n = parseFloat(pct_necessidades)
  const d = parseFloat(pct_desejos)
  const p = parseFloat(pct_poupanca)

  if (Math.abs((n + d + p) - 100) > 0.1) {
    return c.json({ error: 'Os percentuais devem somar exatamente 100%' }, 400)
  }
  if (n < 0 || d < 0 || p < 0 || n > 100 || d > 100 || p > 100) {
    return c.json({ error: 'Percentuais devem estar entre 0% e 100%' }, 400)
  }

  // Upsert
  const existing = await c.env.DB.prepare(`SELECT id FROM regra_config WHERE user_id = ?`).bind(user.id).first()
  if (existing) {
    await c.env.DB.prepare(`
      UPDATE regra_config SET pct_necessidades=?, pct_desejos=?, pct_poupanca=?, nome_personalizado=?, updated_at=CURRENT_TIMESTAMP
      WHERE user_id=?
    `).bind(n, d, p, nome_personalizado || `Regra ${n}/${d}/${p}`, user.id).run()
  } else {
    await c.env.DB.prepare(`
      INSERT INTO regra_config (user_id, pct_necessidades, pct_desejos, pct_poupanca, nome_personalizado)
      VALUES (?, ?, ?, ?, ?)
    `).bind(user.id, n, d, p, nome_personalizado || `Regra ${n}/${d}/${p}`).run()
  }

  return c.json({
    success: true,
    message: `Configuração salva! Nova regra: ${n}/${d}/${p}`,
    config: { pct_necessidades: n, pct_desejos: d, pct_poupanca: p }
  })
})

// ── GET /api/regra-503020?mes=M&ano=A ──────────────────────────────────────
regra503020.get('/', requireAuth, async (c) => {
  const user = c.get('user')
  const mes = parseInt(c.req.query('mes') || String(new Date().getMonth() + 1))
  const ano = parseInt(c.req.query('ano') || String(new Date().getFullYear()))
  if (!Number.isInteger(mes) || mes < 1 || mes > 12)
    return c.json({ error: 'Mês inválido (use 1 a 12).' }, 400)
  if (!Number.isInteger(ano) || ano < 2000 || ano > 2100)
    return c.json({ error: 'Ano inválido.' }, 400)
  // Parâmetros de simulação dinâmica (usados pelo botão "Recalcular" do frontend)
  // Se fornecidos e somam 100, substituem temporariamente os valores da config
  const pctNeedsQ = c.req.query('pct_needs')
  const pctWantsQ = c.req.query('pct_wants')
  const pctSavingsQ = c.req.query('pct_savings')
  const hasQueryPcts = pctNeedsQ !== undefined && pctWantsQ !== undefined && pctSavingsQ !== undefined
  const qN = hasQueryPcts ? parseFloat(pctNeedsQ!) : NaN
  const qD = hasQueryPcts ? parseFloat(pctWantsQ!) : NaN
  const qP = hasQueryPcts ? parseFloat(pctSavingsQ!) : NaN
  const queryPctsValid = hasQueryPcts && !isNaN(qN) && !isNaN(qD) && !isNaN(qP) && Math.abs(qN + qD + qP - 100) < 0.1

  // Melhoria 3.2: buscar config personalizada do usuário
  const configUsuario = await c.env.DB.prepare(
    `SELECT * FROM regra_config WHERE user_id = ? ORDER BY id DESC LIMIT 1`
  ).bind(user.id).first() as any

  // Usar percentuais da query (simulação dinâmica) ou da config salva ou padrão
  const PCT_NECESSIDADES = queryPctsValid ? qN : (configUsuario?.pct_necessidades ?? 50)
  const PCT_DESEJOS      = queryPctsValid ? qD : (configUsuario?.pct_desejos      ?? 30)
  const PCT_POUPANCA     = queryPctsValid ? qP : (configUsuario?.pct_poupanca     ?? 20)
  const NOME_REGRA       = queryPctsValid
    ? `Regra ${PCT_NECESSIDADES}/${PCT_DESEJOS}/${PCT_POUPANCA} (simulação)`
    : (configUsuario?.nome_personalizado || 'Regra 50/30/20')

  // 1. Receitas do período
  const recRow = await c.env.DB.prepare(`
    SELECT COALESCE(SUM(valor), 0) as total
    FROM receitas
    WHERE user_id = ? AND strftime('%m', data) = ? AND strftime('%Y', data) = ?
  `).bind(user.id, String(mes).padStart(2, '0'), String(ano)).first() as any

  const income = parseFloat(recRow?.total || 0)

  // 2. Despesas pagas do período por categoria
  const despResult = await c.env.DB.prepare(`
    SELECT categoria, COALESCE(SUM(valor), 0) as total
    FROM despesas
    WHERE user_id = ?
      ${filtroDespesaDoMes()}
      AND status = 'pago'
    GROUP BY categoria
  `).bind(user.id, String(mes).padStart(2, '0'), String(ano)).all()

  const despByCat: Record<string, number> = {}
  for (const row of (despResult.results as any[])) {
    despByCat[row.categoria] = parseFloat(row.total)
  }

  // 3. Investimentos do período
  const invRow = await c.env.DB.prepare(`
    SELECT COALESCE(SUM(valor_investido), 0) as total
    FROM investimentos
    WHERE user_id = ? AND strftime('%m', data_inicio) = ? AND strftime('%Y', data_inicio) = ?
  `).bind(user.id, String(mes).padStart(2, '0'), String(ano)).first() as any
  const investments = parseFloat(invRow?.total || 0)

  // 4. Depósitos em reservas do período
  const resRow = await c.env.DB.prepare(`
    SELECT COALESCE(SUM(rt.amount), 0) as total
    FROM reserve_transactions rt
    JOIN specialized_reserves r ON rt.reserve_id = r.id
    WHERE r.user_id = ? AND rt.type = 'deposit'
      AND strftime('%m', rt.date) = ? AND strftime('%Y', rt.date) = ?
  `).bind(user.id, String(mes).padStart(2, '0'), String(ano)).first() as any
  const reserves = parseFloat(resRow?.total || 0)

  // 5. Classificar despesas
  let needs = 0, wants = 0, savings = 0

  for (const [cat, val] of Object.entries(despByCat)) {
    if (NEEDS_CATS.some(n => cat.toLowerCase().includes(n.toLowerCase()))) {
      needs += val
    } else if (SAVINGS_CATS.some(s => cat.toLowerCase().includes(s.toLowerCase()))) {
      savings += val
    } else {
      wants += val
    }
  }

  // Investimentos e reservas vão para savings
  savings += investments + reserves

  // 6. Calcular percentuais
  const percentNeeds = income > 0 ? (needs / income) * 100 : 0
  const percentWants = income > 0 ? (wants / income) * 100 : 0
  const percentSavings = income > 0 ? (savings / income) * 100 : 0

  // 7. Gaps usando config personalizada (negativo = acima do ideal)
  const gapNeeds = income * (PCT_NECESSIDADES / 100) - needs
  const gapWants = income * (PCT_DESEJOS / 100) - wants
  const gapSavings = savings - income * (PCT_POUPANCA / 100)

  // 8. Score de aderência (0-100) com percentuais personalizados
  // Se não há receita registrada, o score é 0 (sem dados para avaliar)
  const { score, fatores: fatores_score } = calcularScore(
    income, percentNeeds, percentWants, percentSavings,
    PCT_NECESSIDADES, PCT_DESEJOS, PCT_POUPANCA,
  )

  // 9. Recomendações
  const recommendations: string[] = []

  if (income === 0) {
    recommendations.push('⚠️ Nenhuma receita registrada neste período.')
  } else {
    if (gapNeeds < -300) {
      recommendations.push(`🏠 Necessidades estão R$ ${Math.abs(gapNeeds).toFixed(0)} acima do ideal (${PCT_NECESSIDADES}%). Revise moradia, alimentação e transporte.`)
    } else if (percentNeeds < (PCT_NECESSIDADES * 0.7)) {
      recommendations.push(`✅ Necessidades em ${percentNeeds.toFixed(0)}% — excelente controle de gastos essenciais!`)
    }

    if (gapWants < -200) {
      recommendations.push(`🎮 Lazer/Desejos estão R$ ${Math.abs(gapWants).toFixed(0)} acima do ideal (${PCT_DESEJOS}%). Revise assinaturas e delivery.`)
    }

    if (gapSavings < -150) {
      recommendations.push(`💰 Poupança abaixo do ideal (${PCT_POUPANCA}%). Tente guardar mais R$ ${Math.abs(gapSavings).toFixed(0)}/mês.`)
    } else if (percentSavings >= PCT_POUPANCA) {
      recommendations.push(`🎉 Você poupa ${percentSavings.toFixed(0)}% da renda — ${percentSavings >= PCT_POUPANCA * 1.5 ? 'acima do esperado! Patrimônio crescendo rápido.' : 'dentro da meta recomendada!'}`)
    }

    if (score >= 80) {
      recommendations.push(`⚖️ Excelente equilíbrio financeiro! Você está seguindo a "${NOME_REGRA}" com maestria.`)
    }
  }

  // Conquista
  if (score >= 80) {
    await c.env.DB.prepare(
      `INSERT OR IGNORE INTO conquistas_usuario (user_id, conquista_codigo, visualizado) VALUES (?, 'regra_503020_verde', 0)`
    ).bind(user.id).run()
  }

  // Top categorias por grupo para o breakdown
  const topNeeds = Object.entries(despByCat)
    .filter(([cat]) => NEEDS_CATS.some(n => cat.toLowerCase().includes(n.toLowerCase())))
    .sort(([, a], [, b]) => b - a).slice(0, 5)
  const topWants = Object.entries(despByCat)
    .filter(([cat]) => WANTS_CATS.some(w => cat.toLowerCase().includes(w.toLowerCase())))
    .sort(([, a], [, b]) => b - a).slice(0, 5)

  // ── BLOCO 6.2: Integração Regra 50/30/20 → Orçamentos ─────────────────────
  // Sugerir orçamentos para categorias que estão acima do ideal
  const sugestoes_orcamento: Array<{ categoria: string; limite_sugerido: number; gasto_atual: number; motivo: string }> = []
  if (income > 0) {
    // Se necessidades > 50%: sugerir orçamentos para categorias de necessidades acima de 10%
    for (const [cat, val] of topNeeds.slice(0, 3)) {
      const pctCat = (val / income) * 100
      if (pctCat > 10) {
        // Checar se já tem orçamento para essa categoria no mês
        const orcExist = await c.env.DB.prepare(
          `SELECT id FROM orcamentos WHERE user_id = ? AND categoria = ? AND mes = ? AND ano = ?`
        ).bind(user.id, cat, mes, ano).first()
        if (!orcExist) {
          sugestoes_orcamento.push({
            categoria: cat,
            limite_sugerido: Math.round(income * 0.10),
            gasto_atual: Math.round(val * 100) / 100,
            motivo: `${cat} representa ${pctCat.toFixed(0)}% da renda — acima do ideal`
          })
        }
      }
    }
    // Se desejos > 30%: sugerir orçamento para categorias de desejos
    for (const [cat, val] of topWants.slice(0, 2)) {
      const pctCat = (val / income) * 100
      if (pctCat > 8) {
        const orcExist = await c.env.DB.prepare(
          `SELECT id FROM orcamentos WHERE user_id = ? AND categoria = ? AND mes = ? AND ano = ?`
        ).bind(user.id, cat, mes, ano).first()
        if (!orcExist) {
          sugestoes_orcamento.push({
            categoria: cat,
            limite_sugerido: Math.round(income * 0.08),
            gasto_atual: Math.round(val * 100) / 100,
            motivo: `${cat} representa ${pctCat.toFixed(0)}% da renda — considere definir um orçamento`
          })
        }
      }
    }
  }

  return c.json({
    mes, ano, income,
    // Melhoria 3.2: retornar a regra em uso
    regra: {
      nome: NOME_REGRA,
      pct_necessidades: PCT_NECESSIDADES,
      pct_desejos: PCT_DESEJOS,
      pct_poupanca: PCT_POUPANCA,
      personalizada: !!configUsuario
    },
    current: {
      needs:   { amount: Math.round(needs * 100) / 100,   percentage: Math.round(percentNeeds * 10) / 10 },
      wants:   { amount: Math.round(wants * 100) / 100,   percentage: Math.round(percentWants * 10) / 10 },
      savings: { amount: Math.round(savings * 100) / 100, percentage: Math.round(percentSavings * 10) / 10 },
    },
    ideal: {
      needs:   Math.round(income * (PCT_NECESSIDADES / 100) * 100) / 100,
      wants:   Math.round(income * (PCT_DESEJOS      / 100) * 100) / 100,
      savings: Math.round(income * (PCT_POUPANCA     / 100) * 100) / 100,
    },
    gaps: {
      needs:   Math.round(gapNeeds   * 100) / 100,
      wants:   Math.round(gapWants   * 100) / 100,
      savings: Math.round(gapSavings * 100) / 100,
    },
    score,
    fatores_score,
    recommendations,
    // Bloco 6.2: sugestões de orçamento
    sugestoes_orcamento,
    breakdown: {
      top_needs: topNeeds.map(([cat, val]) => ({ cat, val: Math.round(val * 100) / 100 })),
      top_wants: topWants.map(([cat, val]) => ({ cat, val: Math.round(val * 100) / 100 })),
      investments_savings: Math.round((investments + reserves) * 100) / 100,
    }
  })
})

// ── GET /api/regra-503020/historico?ano= ─────────────────────────────────────
// Um mês isolado não diz se a pessoa melhorou. Este endpoint refaz a mesma
// conta do mês a mês para o ano inteiro — em 4 consultas agrupadas, não em 12
// rodadas do endpoint principal — para a tela mostrar a linha do score.
regra503020.get('/historico', requireAuth, async (c) => {
  const user = c.get('user')
  const ano = parseInt(c.req.query('ano') || String(new Date().getFullYear()))
  if (!Number.isInteger(ano) || ano < 2000 || ano > 2100)
    return c.json({ error: 'Ano inválido.' }, 400)

  const cfg = await c.env.DB.prepare(
    `SELECT * FROM regra_config WHERE user_id = ? ORDER BY id DESC LIMIT 1`
  ).bind(user.id).first() as any
  const ALVO_N = cfg?.pct_necessidades ?? 50
  const ALVO_W = cfg?.pct_desejos      ?? 30
  const ALVO_S = cfg?.pct_poupanca     ?? 20

  const [rec, desp, inv, res] = await Promise.all([
    c.env.DB.prepare(`
      SELECT strftime('%m', data) as mes, COALESCE(SUM(valor),0) as total
      FROM receitas WHERE user_id = ? AND strftime('%Y', data) = ?
      GROUP BY 1`).bind(user.id, String(ano)).all(),
    c.env.DB.prepare(`
      SELECT (${competenciaMes()}) as mes, categoria, COALESCE(SUM(valor),0) as total
      FROM despesas
      WHERE user_id = ? AND status = 'pago'
        AND ${filtroNaoCancelada()} AND ${filtroSemAporte()}
        AND (${competenciaAno()}) = ?
      GROUP BY 1, 2`).bind(user.id, String(ano)).all(),
    c.env.DB.prepare(`
      SELECT strftime('%m', data_inicio) as mes, COALESCE(SUM(valor_investido),0) as total
      FROM investimentos WHERE user_id = ? AND strftime('%Y', data_inicio) = ?
      GROUP BY 1`).bind(user.id, String(ano)).all(),
    c.env.DB.prepare(`
      SELECT strftime('%m', rt.date) as mes, COALESCE(SUM(rt.amount),0) as total
      FROM reserve_transactions rt
      JOIN specialized_reserves r ON rt.reserve_id = r.id
      WHERE r.user_id = ? AND rt.type = 'deposit' AND strftime('%Y', rt.date) = ?
      GROUP BY 1`).bind(user.id, String(ano)).all(),
  ])

  const porMes = Array.from({ length: 12 }, () => ({ income: 0, needs: 0, wants: 0, savings: 0 }))
  const idx = (m: any) => {
    const n = parseInt(String(m ?? ''), 10)
    return Number.isInteger(n) && n >= 1 && n <= 12 ? n - 1 : -1
  }
  for (const r of (rec.results as any[]))  { const i = idx(r.mes); if (i >= 0) porMes[i].income  += parseFloat(r.total) }
  for (const r of (inv.results as any[]))  { const i = idx(r.mes); if (i >= 0) porMes[i].savings += parseFloat(r.total) }
  for (const r of (res.results as any[]))  { const i = idx(r.mes); if (i >= 0) porMes[i].savings += parseFloat(r.total) }
  for (const r of (desp.results as any[])) {
    const i = idx(r.mes); if (i < 0) continue
    porMes[i][grupoDaCategoria(String(r.categoria || ''))] += parseFloat(r.total)
  }

  const meses = porMes.map((m, i) => {
    const pN = m.income > 0 ? (m.needs   / m.income) * 100 : 0
    const pW = m.income > 0 ? (m.wants   / m.income) * 100 : 0
    const pS = m.income > 0 ? (m.savings / m.income) * 100 : 0
    const { score } = calcularScore(m.income, pN, pW, pS, ALVO_N, ALVO_W, ALVO_S)
    return {
      mes: i + 1,
      income: Math.round(m.income * 100) / 100,
      needs: Math.round(m.needs * 100) / 100,
      wants: Math.round(m.wants * 100) / 100,
      savings: Math.round(m.savings * 100) / 100,
      pct_needs: Math.round(pN * 10) / 10,
      pct_wants: Math.round(pW * 10) / 10,
      pct_savings: Math.round(pS * 10) / 10,
      score,
      // Sem receita no mês o score é 0 por falta de dado, não por desequilíbrio.
      sem_dados: m.income <= 0,
    }
  })

  const comDados = meses.filter(m => !m.sem_dados)
  const media = comDados.length ? Math.round(comDados.reduce((s, m) => s + m.score, 0) / comDados.length) : 0
  const melhor = comDados.length ? comDados.reduce((a, b) => (b.score > a.score ? b : a)) : null
  const pior   = comDados.length ? comDados.reduce((a, b) => (b.score < a.score ? b : a)) : null
  // Tendência: os três últimos meses com dado contra os três anteriores.
  const ult = comDados.slice(-3), ant = comDados.slice(-6, -3)
  const mediaDe = (arr: typeof comDados) => arr.length ? arr.reduce((s, m) => s + m.score, 0) / arr.length : 0
  const tendencia = ant.length && ult.length ? Math.round(mediaDe(ult) - mediaDe(ant)) : 0

  return c.json({
    ano,
    alvo: { needs: ALVO_N, wants: ALVO_W, savings: ALVO_S },
    meses,
    resumo: {
      media,
      meses_com_dados: comDados.length,
      melhor_mes: melhor ? { mes: melhor.mes, score: melhor.score } : null,
      pior_mes: pior ? { mes: pior.mes, score: pior.score } : null,
      tendencia,
      // Poupou o suficiente em quantos meses — a métrica que o usuário
      // realmente persegue.
      meses_na_meta_poupanca: comDados.filter(m => m.pct_savings >= ALVO_S).length,
    },
    anos_disponiveis: [ano - 1, ano, ano + 1],
  })
})

// ── POST /api/regra-503020/aplicar-orcamentos — Bloco 7.2 ───────────────────
// Aplica os orçamentos sugeridos pela Regra 50/30/20 diretamente nos orçamentos
regra503020.post('/aplicar-orcamentos', requireAuth, async (c) => {
  const user = c.get('user')
  const hoje = new Date()
  const mes = String(hoje.getMonth() + 1).padStart(2, '0')
  const ano = String(hoje.getFullYear())

  // Buscar sugestões do mês atual
  const sugestoes = await c.req.json().catch(() => null) as Array<{ categoria: string; limite_sugerido: number }> | null

  if (!sugestoes || !Array.isArray(sugestoes) || sugestoes.length === 0) {
    return c.json({ error: 'Envie um array de sugestões { categoria, limite_sugerido }' }, 400)
  }

  let aplicados = 0
  for (const s of sugestoes) {
    if (!s.categoria || !s.limite_sugerido || s.limite_sugerido <= 0) continue
    try {
      // Upsert do orçamento
      const existe = await c.env.DB.prepare(
        `SELECT id FROM orcamentos WHERE user_id=? AND categoria=? AND mes=? AND ano=?`
      ).bind(user.id, s.categoria, mes, ano).first()

      if (existe) {
        await c.env.DB.prepare(
          `UPDATE orcamentos SET limite=? WHERE user_id=? AND categoria=? AND mes=? AND ano=?`
        ).bind(Math.round(s.limite_sugerido * 100) / 100, user.id, s.categoria, mes, ano).run()
      } else {
        await c.env.DB.prepare(
          `INSERT INTO orcamentos (user_id, categoria, limite, mes, ano) VALUES (?, ?, ?, ?, ?)`
        ).bind(user.id, s.categoria, Math.round(s.limite_sugerido * 100) / 100, mes, ano).run()
      }
      aplicados++
    } catch(_) {}
  }

  return c.json({
    success: true,
    aplicados,
    message: `${aplicados} orçamento(s) aplicado(s) com base na Regra 50/30/20 para ${mes}/${ano}.`
  })
})

export default regra503020
