import { Hono } from 'hono'
import { requireAuth } from './auth'

type Bindings = { DB: D1Database }
type Variables = { user: { id: number; nome: string; email: string; plano: string } }

const amortizacao = new Hono<{ Bindings: Bindings; Variables: Variables }>()

// ── Matemática bancária PRICE ──────────────────────────────────────────────
function priceInstallment(principal: number, monthlyRate: number, months: number): number {
  if (monthlyRate === 0 || months === 0) return months > 0 ? principal / months : 0
  const f = Math.pow(1 + monthlyRate, months)
  return principal * (monthlyRate * f) / (f - 1)
}

function priceTotalInterest(principal: number, monthlyRate: number, months: number): number {
  const inst = priceInstallment(principal, monthlyRate, months)
  return Math.max(0, inst * months - principal)
}

function priceRemainingMonths(balance: number, installment: number, monthlyRate: number): number {
  if (monthlyRate === 0) return Math.ceil(balance / installment)
  const ratio = (balance * monthlyRate) / installment
  // BUG 1.2.B: retornar erro se amortização insuficiente para cobrir juros
  if (ratio >= 1) return -1  // sinaliza erro ao chamador
  return Math.ceil(-Math.log(1 - ratio) / Math.log(1 + monthlyRate))
}

// ── Matemática bancária SAC ────────────────────────────────────────────────
// BUG 1.1 FIX: constAmort deve ser FIXO = originalBalance / originalMonths
// O parâmetro originalMonths permite calcular corretamente após amortização extraordinária
function sacTotalInterest(balance: number, monthlyRate: number, months: number, originalBalance?: number, originalMonths?: number): number {
  // Se fornecidos, usa a amortização constante original; senão calcula do saldo atual
  const constAmort = (originalBalance && originalMonths)
    ? originalBalance / originalMonths
    : balance / months
  let interest = 0
  let bal = balance
  for (let i = 0; i < months; i++) {
    interest += bal * monthlyRate
    bal = Math.max(0, bal - constAmort)
  }
  return Math.max(0, interest)
}

// Calcula novos meses SAC após amortização extraordinária mantendo constAmort original
function sacRemainingMonths(newBalance: number, originalBalance: number, originalMonths: number): number {
  const constAmort = originalBalance / originalMonths
  if (constAmort <= 0) return originalMonths
  return Math.max(1, Math.ceil(newBalance / constAmort))
}

// ── POST /api/amortizacao/simular ─────────────────────────────────────────
amortizacao.post('/simular', requireAuth, async (c) => {
  const user = c.get('user')

  const body = await c.req.json()
  const {
    financing_id,
    amortization_amount,
    // Campos manuais (quando não há financing_id)
    manual_balance,
    manual_installment,
    manual_remaining_months,
    manual_annual_rate,
    manual_system = 'PRICE',
    // BUG 1.2.C: dias pro-rata desde última parcela
    dias_desde_ultima_parcela = 0
  } = body

  if (!amortization_amount || amortization_amount <= 0)
    return c.json({ error: 'Valor de amortização inválido' }, 400)

  // Fonte dos dados: financiamento cadastrado ou manual
  let balance: number, installment: number, remainingMonths: number, annualRate: number, system: string

  if (financing_id) {
    const fin = await c.env.DB.prepare(
      `SELECT * FROM financiamentos WHERE id = ? AND user_id = ?`
    ).bind(financing_id, user.id).first() as any
    if (!fin) return c.json({ error: 'Financiamento não encontrado' }, 404)

    balance = fin.saldo_devedor
    installment = fin.valor_parcela
    remainingMonths = fin.numero_parcelas - fin.parcelas_pagas
    annualRate = fin.taxa_juros_anual
    system = (fin.sistema_amortizacao || 'price').toUpperCase()
  } else {
    // Validar campos manuais
    if (!manual_balance || !manual_installment || !manual_remaining_months || !manual_annual_rate)
      return c.json({ error: 'Forneça financing_id ou preencha todos os campos manuais' }, 400)

    balance = parseFloat(manual_balance)
    installment = parseFloat(manual_installment)
    remainingMonths = parseInt(manual_remaining_months)
    annualRate = parseFloat(manual_annual_rate)
    system = (manual_system || 'PRICE').toUpperCase()
  }

  const extra = parseFloat(amortization_amount)
  if (extra >= balance) return c.json({ error: 'Amortização não pode ser maior que o saldo devedor' }, 400)
  if (remainingMonths <= 1) return c.json({ error: 'Prazo restante insuficiente para simulação' }, 400)

  const monthlyRate = Math.pow(1 + annualRate / 100, 1 / 12) - 1

  // BUG 1.2.C: Ajuste pro-rata se houver dias desde a última parcela
  const diasProrata = Math.max(0, Math.min(31, parseInt(String(dias_desde_ultima_parcela)) || 0))
  const dailyRate = Math.pow(1 + monthlyRate, 1 / 30) - 1
  const jurosProrata = diasProrata > 0 ? balance * dailyRate * diasProrata : 0
  const balanceComProrata = balance + jurosProrata

  const newBalance = balanceComProrata - extra

  // ── Totais originais ──────────────────────────────────────────────────────
  // BUG 1.1 FIX: SAC usa balance como originalBalance (é o saldo atual = base para constAmort)
  const originalTotalInterest = system === 'SAC'
    ? sacTotalInterest(balance, monthlyRate, remainingMonths, balance, remainingMonths)
    : priceTotalInterest(balance, monthlyRate, remainingMonths)

  // ── Cenário A: Reduzir Parcela (manter prazo) ─────────────────────────────
  let newInstallmentA: number, totalInterestA: number, savedMonthlyA: number

  if (system === 'SAC') {
    // BUG 1.1 FIX: constAmort = balance/remainingMonths (original), não newBalance/remainingMonths
    const constAmortOriginal = balance / remainingMonths
    newInstallmentA = constAmortOriginal + (newBalance * monthlyRate)
    totalInterestA = sacTotalInterest(newBalance, monthlyRate, remainingMonths, balance, remainingMonths)
  } else {
    newInstallmentA = priceInstallment(newBalance, monthlyRate, remainingMonths)
    totalInterestA = priceTotalInterest(newBalance, monthlyRate, remainingMonths)
  }
  savedMonthlyA = installment - newInstallmentA
  const interestSavedA = originalTotalInterest - totalInterestA

  // ── Cenário B: Reduzir Prazo (manter parcela) ─────────────────────────────
  let newMonthsB: number, totalInterestB: number, monthsSavedB: number

  if (system === 'SAC') {
    // BUG 1.1 FIX: usar sacRemainingMonths com originalBalance/originalMonths
    newMonthsB = sacRemainingMonths(newBalance, balance, remainingMonths)
    totalInterestB = sacTotalInterest(newBalance, monthlyRate, Math.min(newMonthsB, remainingMonths), balance, remainingMonths)
  } else {
    // BUG 1.2.B FIX: validar se parcela cobre juros
    const checkRatio = (newBalance * monthlyRate) / installment
    if (checkRatio >= 1) {
      return c.json({
        error: 'O valor de amortização é insuficiente para cobrir os juros mensais. Aumente o valor do aporte.',
        code: 'INSUFICIENT_AMORTIZATION'
      }, 400)
    }
    newMonthsB = priceRemainingMonths(newBalance, installment, monthlyRate)
    if (newMonthsB === -1) {
      return c.json({
        error: 'O valor de amortização é insuficiente para cobrir os juros mensais. Aumente o valor do aporte.',
        code: 'INSUFICIENT_AMORTIZATION'
      }, 400)
    }
    totalInterestB = priceTotalInterest(newBalance, monthlyRate, newMonthsB)
  }
  monthsSavedB = remainingMonths - newMonthsB
  const interestSavedB = originalTotalInterest - totalInterestB

  // ── Recomendação inteligente ───────────────────────────────────────────────
  // Fluxo de caixa do usuário
  const flowRow = await c.env.DB.prepare(`
    SELECT 
      COALESCE((SELECT SUM(valor) FROM receitas WHERE user_id = ? AND strftime('%Y-%m', data) = strftime('%Y-%m', 'now')), 0) -
      COALESCE((SELECT SUM(valor) FROM despesas WHERE user_id = ? AND strftime('%Y-%m', data) = strftime('%Y-%m', 'now') AND status = 'pago'), 0)
    AS flow
  `).bind(user.id, user.id).first() as any
  const monthlyFlow = parseFloat(flowRow?.flow || 0)

  let recommended: 'reduce_payment' | 'reduce_term'
  let reason: string

  if (monthlyFlow < 0) {
    recommended = 'reduce_payment'
    reason = `Seu fluxo de caixa está negativo. Reduzir a parcela em R$ ${savedMonthlyA.toFixed(2)}/mês trará alívio imediato nas finanças.`
  } else if (interestSavedB > interestSavedA * 1.3) {
    recommended = 'reduce_term'
    reason = `Reduzir o prazo economiza R$ ${(interestSavedB - interestSavedA).toFixed(2)} a mais em juros e você fica livre ${monthsSavedB} meses antes.`
  } else if (savedMonthlyA > 200) {
    recommended = 'reduce_payment'
    reason = `Redução de R$ ${savedMonthlyA.toFixed(2)}/mês é significativa. Use esse dinheiro para investir ou reforçar reservas.`
  } else {
    recommended = 'reduce_term'
    reason = `Ficar livre de dívidas ${monthsSavedB} meses antes traz maior tranquilidade financeira a longo prazo.`
  }

  // ── Salvar simulação no histórico ─────────────────────────────────────────
  const simResult = await c.env.DB.prepare(`
    INSERT INTO amortization_simulations (
      user_id, financing_id, original_balance, original_installment, original_remaining_months,
      annual_rate, system, amortization_amount,
      new_installment_reduce_payment, interest_saved_reduce_payment,
      new_remaining_months_reduce_term, interest_saved_reduce_term, months_saved_reduce_term,
      recommended_scenario, recommendation_reason
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    user.id, financing_id || null,
    balance, installment, remainingMonths, annualRate, system, extra,
    Math.round(newInstallmentA * 100) / 100,
    Math.round(interestSavedA * 100) / 100,
    newMonthsB,
    Math.round(interestSavedB * 100) / 100,
    monthsSavedB,
    recommended, reason
  ).run()

  await c.env.DB.prepare(
    `INSERT OR IGNORE INTO conquistas_usuario (user_id, conquista_codigo, visualizado) VALUES (?, 'amortizou_simulou', 0)`
  ).bind(user.id).run()

  return c.json({
    simulation_id: simResult.meta.last_row_id,
    input: { balance, installment, remaining_months: remainingMonths, annual_rate: annualRate, system, extra, dias_prorata: diasProrata, juros_prorata: Math.round(jurosProrata * 100) / 100, balance_com_prorata: Math.round(balanceComProrata * 100) / 100 },
    original: {
      installment: Math.round(installment * 100) / 100,
      remaining_months: remainingMonths,
      total_interest: Math.round(originalTotalInterest * 100) / 100,
      total_cost: Math.round((installment * remainingMonths) * 100) / 100,
    },
    reduce_payment: {
      new_installment: Math.round(newInstallmentA * 100) / 100,
      remaining_months: remainingMonths,
      monthly_savings: Math.round(savedMonthlyA * 100) / 100,
      interest_saved: Math.round(interestSavedA * 100) / 100,
      total_cost: Math.round((newInstallmentA * remainingMonths + extra) * 100) / 100,
    },
    reduce_term: {
      new_installment: Math.round(installment * 100) / 100,
      remaining_months: newMonthsB,
      months_saved: monthsSavedB,
      interest_saved: Math.round(interestSavedB * 100) / 100,
      total_cost: Math.round((installment * newMonthsB + extra) * 100) / 100,
    },
    recommendation: recommended,
    reason,
  })
})

// ── GET /api/amortizacao/historico ────────────────────────────────────────
amortizacao.get('/historico', requireAuth, async (c) => {
  const user = c.get('user')
  const result = await c.env.DB.prepare(`
    SELECT a.*, f.descricao as financing_name
    FROM amortization_simulations a
    LEFT JOIN financiamentos f ON a.financing_id = f.id
    WHERE a.user_id = ?
    ORDER BY a.simulation_date DESC
    LIMIT 20
  `).bind(user.id).all()
  return c.json({ simulations: result.results })
})

export default amortizacao
