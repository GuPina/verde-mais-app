import { Hono } from 'hono'
import { requireAuth } from './auth'

type Bindings = { DB: D1Database }
type Variables = { user: { id: number; nome: string; email: string; plano: string } }

const regra503020 = new Hono<{ Bindings: Bindings; Variables: Variables }>()

// Mapeamento de categorias do VerdeMais para os 3 grupos
const NEEDS_CATS = ['Alimentação', 'Moradia', 'Saúde', 'Transporte', 'Educação', 'Contas', 'Mercado', 'Farmácia']
const WANTS_CATS = ['Lazer', 'Viagem', 'Roupas', 'Assinaturas', 'Delivery', 'Restaurante', 'Beleza', 'Entretenimento', 'Pets', 'Eletrônicos', 'Outros']
const SAVINGS_CATS = ['Investimentos', 'Poupança']

// ── GET /api/regra-503020?mes=M&ano=A ──────────────────────────────────────
regra503020.get('/', requireAuth, async (c) => {
  const user = c.get('user')
  const mes = parseInt(c.req.query('mes') || String(new Date().getMonth() + 1))
  const ano = parseInt(c.req.query('ano') || String(new Date().getFullYear()))

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
  const totalDesp = needs + wants
  const percentNeeds = income > 0 ? (needs / income) * 100 : 0
  const percentWants = income > 0 ? (wants / income) * 100 : 0
  const percentSavings = income > 0 ? (savings / income) * 100 : 0

  // 7. Gaps (negativo = acima do ideal)
  const gapNeeds = income * 0.50 - needs
  const gapWants = income * 0.30 - wants
  const gapSavings = savings - income * 0.20

  // 8. Score de aderência (0-100)
  const needsScore = Math.max(0, 100 - Math.abs(percentNeeds - 50) * 2)
  const wantsScore = Math.max(0, 100 - Math.abs(percentWants - 30) * 3)
  const savingsScore = Math.max(0, Math.min(100, percentSavings * 5))
  const score = Math.round((needsScore * 0.3 + wantsScore * 0.3 + savingsScore * 0.4))

  // 9. Recomendações
  const recommendations: string[] = []

  if (income === 0) {
    recommendations.push('⚠️ Nenhuma receita registrada neste período.')
  } else {
    if (gapNeeds < -300) {
      recommendations.push(`🏠 Necessidades estão R$ ${Math.abs(gapNeeds).toFixed(0)} acima do ideal (50%). Revise moradia, alimentação e transporte.`)
    } else if (percentNeeds < 35) {
      recommendations.push(`✅ Necessidades em ${percentNeeds.toFixed(0)}% — excelente controle de gastos essenciais!`)
    }

    if (gapWants < -200) {
      recommendations.push(`🎮 Lazer/Desejos estão R$ ${Math.abs(gapWants).toFixed(0)} acima do ideal (30%). Revise assinaturas e delivery.`)
    }

    if (gapSavings < -150) {
      recommendations.push(`💰 Poupança abaixo do ideal (20%). Tente guardar mais R$ ${Math.abs(gapSavings).toFixed(0)}/mês.`)
    } else if (percentSavings >= 20) {
      recommendations.push(`🎉 Você poupa ${percentSavings.toFixed(0)}% da renda — ${percentSavings >= 30 ? 'acima do esperado! Patrimônio crescendo rápido.' : 'dentro da meta recomendada!'}`)
    }

    if (score >= 80) {
      recommendations.push('⚖️ Excelente equilíbrio financeiro! Você está seguindo a regra 50/30/20 com maestria.')
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

  return c.json({
    mes, ano, income,
    current: {
      needs:   { amount: Math.round(needs * 100) / 100,   percentage: Math.round(percentNeeds * 10) / 10 },
      wants:   { amount: Math.round(wants * 100) / 100,   percentage: Math.round(percentWants * 10) / 10 },
      savings: { amount: Math.round(savings * 100) / 100, percentage: Math.round(percentSavings * 10) / 10 },
    },
    ideal: {
      needs:   Math.round(income * 0.50 * 100) / 100,
      wants:   Math.round(income * 0.30 * 100) / 100,
      savings: Math.round(income * 0.20 * 100) / 100,
    },
    gaps: {
      needs:   Math.round(gapNeeds * 100) / 100,
      wants:   Math.round(gapWants * 100) / 100,
      savings: Math.round(gapSavings * 100) / 100,
    },
    score,
    recommendations,
    breakdown: {
      top_needs: topNeeds.map(([cat, val]) => ({ cat, val: Math.round(val * 100) / 100 })),
      top_wants: topWants.map(([cat, val]) => ({ cat, val: Math.round(val * 100) / 100 })),
      investments_savings: Math.round((investments + reserves) * 100) / 100,
    }
  })
})

export default regra503020
