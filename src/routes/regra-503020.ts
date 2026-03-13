import { Hono } from 'hono'
import { requireAuth } from './auth'

type Bindings = { DB: D1Database }
type Variables = { user: { id: number; nome: string; email: string; plano: string } }

const regra503020 = new Hono<{ Bindings: Bindings; Variables: Variables }>()

// Mapeamento de categorias do VerdeMais para os 3 grupos
const NEEDS_CATS = ['Alimentação', 'Moradia', 'Saúde', 'Transporte', 'Educação', 'Contas', 'Mercado', 'Farmácia']
const WANTS_CATS = ['Lazer', 'Viagem', 'Roupas', 'Assinaturas', 'Delivery', 'Restaurante', 'Beleza', 'Entretenimento', 'Pets', 'Eletrônicos', 'Outros']
const SAVINGS_CATS = ['Investimentos', 'Poupança']

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
regra503020.post('/config', requireAuth, async (c) => {
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

  // Melhoria 3.2: buscar config personalizada do usuário
  const configUsuario = await c.env.DB.prepare(
    `SELECT * FROM regra_config WHERE user_id = ? ORDER BY id DESC LIMIT 1`
  ).bind(user.id).first() as any

  const PCT_NECESSIDADES = configUsuario?.pct_necessidades ?? 50
  const PCT_DESEJOS      = configUsuario?.pct_desejos      ?? 30
  const PCT_POUPANCA     = configUsuario?.pct_poupanca     ?? 20
  const NOME_REGRA       = configUsuario?.nome_personalizado || 'Regra 50/30/20'

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
      AND strftime('%m', COALESCE(vencimento, data)) = ?
      AND strftime('%Y', COALESCE(vencimento, data)) = ?
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
  const needsScore = Math.max(0, 100 - Math.abs(percentNeeds - PCT_NECESSIDADES) * 2)
  const wantsScore = Math.max(0, 100 - Math.abs(percentWants - PCT_DESEJOS) * 3)
  const savingsScore = Math.max(0, Math.min(100, (percentSavings / PCT_POUPANCA) * 100))
  const score = Math.round((needsScore * 0.3 + wantsScore * 0.3 + savingsScore * 0.4))

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

export default regra503020
