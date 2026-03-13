import { Hono } from 'hono'
import { requireAuth } from './auth'

type Bindings = { DB: D1Database }
type Variables = { user: { id: number; nome: string; plano: string } }

const projecao = new Hono<{ Bindings: Bindings; Variables: Variables }>()

// ─── GET /api/projecao ─────────────────────────────────────────────────────────
projecao.get('/', requireAuth, async (c) => {
  const user = c.get('user')

  if (user.plano === 'free') {
    return c.json({
      error: 'Projeção financeira é exclusiva do plano Premium.',
      upgrade: true, feature: 'projecao'
    }, 403)
  }

  const hoje = new Date()
  const anoAtual = hoje.getFullYear()
  const mesAtual = hoje.getMonth() + 1

  // ── Últimos 6 meses de receitas e despesas ──────────────────────────────────
  const meses: Array<{ mes: number; ano: number; label: string; receitas: number; despesas: number; saldo: number }> = []

  for (let i = 5; i >= 0; i--) {
    let m = mesAtual - i
    let a = anoAtual
    if (m <= 0) { m += 12; a -= 1 }
    const mesStr = String(m).padStart(2, '0')

    const rec = await c.env.DB.prepare(
      `SELECT COALESCE(SUM(valor), 0) as total FROM receitas
       WHERE user_id = ? AND strftime('%m', data) = ? AND strftime('%Y', data) = ?`
    ).bind(user.id, mesStr, String(a)).first() as any

    const desp = await c.env.DB.prepare(
      `SELECT COALESCE(SUM(valor), 0) as total FROM despesas
       WHERE user_id = ? AND status IN ('pago','pendente')
         AND strftime('%m', COALESCE(vencimento, data)) = ?
         AND strftime('%Y', COALESCE(vencimento, data)) = ?`
    ).bind(user.id, mesStr, String(a)).first() as any

    const r = Number(rec?.total || 0)
    const d = Number(desp?.total || 0)
    const mesesNames = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez']

    meses.push({ mes: m, ano: a, label: `${mesesNames[m-1]}/${a}`, receitas: r, despesas: d, saldo: r - d })
  }

  // ── Cálculo de tendência (regressão linear simples) ─────────────────────────
  const saldos = meses.map(m => m.saldo)
  const n = saldos.length
  const sumX = (n * (n - 1)) / 2
  const sumX2 = (n * (n - 1) * (2 * n - 1)) / 6
  const sumY = saldos.reduce((a, b) => a + b, 0)
  const sumXY = saldos.reduce((acc, val, i) => acc + i * val, 0)
  const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX)

  // Média ponderada (meses mais recentes têm mais peso)
  const pesos = [1, 1, 1.5, 2, 2.5, 3]
  const totalPeso = pesos.reduce((a, b) => a + b, 0)
  const mediaPonderada = saldos.reduce((acc, val, i) => acc + val * pesos[i], 0) / totalPeso

  // Variância para calcular confiança
  const temDados = saldos.some(s => s !== 0)
  const variancia = saldos.reduce((acc, val) => acc + Math.pow(val - mediaPonderada, 2), 0) / n
  const desvio = Math.sqrt(variancia)
  const coefVar = (temDados && mediaPonderada !== 0) ? Math.abs(desvio / mediaPonderada) : 1
  const confianca = temDados ? Math.max(20, Math.min(95, Math.round((1 - Math.min(coefVar, 1)) * 100))) : 10

  // Tendência
  const tendencia = slope > 50 ? 'positive' : slope < -50 ? 'negative' : 'stable'

  // Saldo atual estimado (soma dos últimos 6 meses)
  const saldoAtual = saldos.reduce((a, b) => a + b, 0)

  // ── Projeções ──────────────────────────────────────────────────────────────
  // Regras:
  //  • Renda estável: média ponderada dos últimos 6 meses (sem crescimento automático de 6%/ano)
  //  • Inflação mensal de 0,3% sobre despesas (custo de vida sobe levemente)
  //  • saldoAcum parte de saldoAtual (soma dos saldos históricos)
  const INFLACAO_MENSAL = 0.003
  const mesesNomes = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez']
  const projecoes: Array<{ mes: number; ano: number; label: string; valor: number; receitas: number; despesas: number }> = []
  const avgReceitas = meses.reduce((a, m) => a + m.receitas, 0) / n
  const avgDespesas = meses.reduce((a, m) => a + m.despesas, 0) / n

  let saldoAcum = saldoAtual
  for (let i = 1; i <= 12; i++) {
    let m = mesAtual + i
    let a = anoAtual
    while (m > 12) { m -= 12; a += 1 }
    // Receita estável (sem crescimento automático)
    const recProj = avgReceitas
    // Despesa com inflação acumulada de 0,3%/mês
    const despProj = avgDespesas * Math.pow(1 + INFLACAO_MENSAL, i)
    saldoAcum += (recProj - despProj)
    projecoes.push({
      mes: m, ano: a,
      label: `${mesesNomes[m-1]}/${a}`,
      valor: Math.round(saldoAcum * 100) / 100,
      receitas: Math.round(recProj * 100) / 100,
      despesas: Math.round(despProj * 100) / 100
    })
  }

  // ── Insights personalizados ────────────────────────────────────────────────
  const insights: string[] = []
  if (tendencia === 'positive') {
    insights.push(`📈 Tendência positiva! Seu saldo mensal cresce em média R$ ${Math.abs(slope).toFixed(0)}/mês.`)
  } else if (tendencia === 'negative') {
    insights.push(`⚠️ Atenção: seu saldo mensal cai em média R$ ${Math.abs(slope).toFixed(0)}/mês. Revise suas despesas.`)
  } else {
    insights.push(`📊 Seu saldo está estável. Considere aumentar suas receitas ou criar metas de poupança.`)
  }

  if (avgReceitas === 0 && avgDespesas === 0) {
    insights.push(`📥 Comece lançando suas receitas e despesas para obter uma projeção precisa do seu futuro financeiro.`)
  } else if (avgDespesas > avgReceitas) {
    insights.push(`🚨 Suas despesas (R$ ${avgDespesas.toFixed(0)}/mês) superam as receitas (R$ ${avgReceitas.toFixed(0)}/mês). Crie um orçamento por categoria para controlar.`)
  } else {
    const txPoupanca = avgReceitas > 0 ? ((avgReceitas - avgDespesas) / avgReceitas * 100).toFixed(1) : '0.0'
    insights.push(`💰 Taxa de poupança atual: ${txPoupanca}% das receitas. ${parseFloat(txPoupanca) >= 20 ? 'Excelente!' : 'Tente chegar em 20%.'}`)
  }

  const proj6 = projecoes[5]?.valor || 0
  const proj12 = projecoes[11]?.valor || 0
  if (proj12 > saldoAtual) {
    insights.push(`🔮 Em 12 meses, seu patrimônio acumulado pode chegar a R$ ${proj12.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} (projeção com renda estável e inflação de 0,3%/mês sobre despesas).`)
  } else if (proj12 < saldoAtual) {
    insights.push(`⚠️ Em 12 meses, a inflação sobre suas despesas pode reduzir seu patrimônio para R$ ${proj12.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}. Considere aumentar receitas ou reduzir custos.`)
  }

  // Conquista: consultou projeção
  await c.env.DB.prepare(
    `INSERT OR IGNORE INTO conquistas_usuario (user_id, conquista_codigo, data_conquista, visualizado)
     VALUES (?, ?, datetime('now'), 0)`
  ).bind(user.id, 'projetor').run().catch(() => {})

  return c.json({
    historico: meses,
    projecoes,
    tendencia,
    media_mensal: Math.round(mediaPonderada * 100) / 100,
    media_receitas: Math.round(avgReceitas * 100) / 100,
    media_despesas: Math.round(avgDespesas * 100) / 100,
    saldo_atual: Math.round(saldoAtual * 100) / 100,
    confianca,
    insights,
    resumo: {
      projecao_6m: Math.round((projecoes[5]?.valor || 0) * 100) / 100,
      projecao_12m: Math.round((projecoes[11]?.valor || 0) * 100) / 100,
    }
  })
})

export default projecao
