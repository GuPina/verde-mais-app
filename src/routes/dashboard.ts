import { Hono } from 'hono'
import { requireAuth } from './auth'

type Bindings = { DB: D1Database }
type Variables = { user: { id: number; nome: string; email: string; plano: string } }

const dashboard = new Hono<{ Bindings: Bindings; Variables: Variables }>()

// GET /api/dashboard
dashboard.get('/', requireAuth, async (c) => {
  const user = c.get('user')
  const now = new Date()
  const mes = String(now.getMonth() + 1).padStart(2, '0')
  const ano = String(now.getFullYear())

  // Receitas do mês
  const receitasMes = await c.env.DB.prepare(
    `SELECT COALESCE(SUM(valor), 0) as total FROM receitas 
     WHERE user_id = ? AND strftime('%m', data) = ? AND strftime('%Y', data) = ?`
  ).bind(user.id, mes, ano).first() as any

  // Despesas do mês
  const despesasMes = await c.env.DB.prepare(
    `SELECT COALESCE(SUM(valor), 0) as total FROM despesas 
     WHERE user_id = ? AND strftime('%m', data) = ? AND strftime('%Y', data) = ?`
  ).bind(user.id, mes, ano).first() as any

  // Despesas pagas vs pendentes
  const despesasStatus = await c.env.DB.prepare(
    `SELECT status, COALESCE(SUM(valor), 0) as total FROM despesas 
     WHERE user_id = ? AND strftime('%m', data) = ? AND strftime('%Y', data) = ?
     GROUP BY status`
  ).bind(user.id, mes, ano).all()

  // Total investimentos
  const totalInvestimentos = await c.env.DB.prepare(
    `SELECT COALESCE(SUM(valor_atual), 0) as total FROM investimentos WHERE user_id = ?`
  ).bind(user.id).first() as any

  // Metas ativas
  const metasAtivas = await c.env.DB.prepare(
    `SELECT COUNT(*) as count, COALESCE(SUM(valor_objetivo), 0) as objetivo_total, 
     COALESCE(SUM(valor_atual), 0) as atual_total FROM metas WHERE user_id = ? AND status = 'ativa'`
  ).bind(user.id).first() as any

  // Evolução dos últimos 6 meses
  const evolucao = []
  for (let i = 5; i >= 0; i--) {
    const d = new Date()
    d.setMonth(d.getMonth() - i)
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const a = String(d.getFullYear())

    const rec = await c.env.DB.prepare(
      `SELECT COALESCE(SUM(valor), 0) as total FROM receitas WHERE user_id = ? AND strftime('%m', data) = ? AND strftime('%Y', data) = ?`
    ).bind(user.id, m, a).first() as any

    const desp = await c.env.DB.prepare(
      `SELECT COALESCE(SUM(valor), 0) as total FROM despesas WHERE user_id = ? AND strftime('%m', data) = ? AND strftime('%Y', data) = ?`
    ).bind(user.id, m, a).first() as any

    const meses = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']
    evolucao.push({
      mes: meses[d.getMonth()],
      ano: a,
      receitas: rec?.total || 0,
      despesas: desp?.total || 0,
      saldo: (rec?.total || 0) - (desp?.total || 0)
    })
  }

  // Despesas por categoria (mês atual)
  const categoriasDespesas = await c.env.DB.prepare(
    `SELECT categoria, COALESCE(SUM(valor), 0) as total FROM despesas 
     WHERE user_id = ? AND strftime('%m', data) = ? AND strftime('%Y', data) = ?
     GROUP BY categoria ORDER BY total DESC LIMIT 8`
  ).bind(user.id, mes, ano).all()

  // Receitas por categoria (mês atual)
  const categoriasReceitas = await c.env.DB.prepare(
    `SELECT categoria, COALESCE(SUM(valor), 0) as total FROM receitas 
     WHERE user_id = ? AND strftime('%m', data) = ? AND strftime('%Y', data) = ?
     GROUP BY categoria ORDER BY total DESC LIMIT 6`
  ).bind(user.id, mes, ano).all()

  // Últimas transações
  const ultimasTransacoes = await c.env.DB.prepare(
    `SELECT 'receita' as tipo, id, descricao, data, categoria, valor, 'pago' as status FROM receitas WHERE user_id = ?
     UNION ALL
     SELECT 'despesa' as tipo, id, descricao, data, categoria, valor, status FROM despesas WHERE user_id = ?
     ORDER BY data DESC, id DESC LIMIT 10`
  ).bind(user.id, user.id).all()

  // Despesas com vencimento próximo (próximos 7 dias)
  const proximosVencimentos = await c.env.DB.prepare(
    `SELECT * FROM despesas WHERE user_id = ? AND status = 'pendente' 
     AND vencimento BETWEEN date('now') AND date('now', '+7 days')
     ORDER BY vencimento ASC LIMIT 5`
  ).bind(user.id).all()

  const totalReceitas = receitasMes?.total || 0
  const totalDespesas = despesasMes?.total || 0
  const saldoLiquido = totalReceitas - totalDespesas
  const totalInvest = totalInvestimentos?.total || 0

  // Score de saúde financeira (0-100)
  let score = 50
  if (totalReceitas > 0) {
    const taxaPoupanca = (saldoLiquido / totalReceitas) * 100
    if (taxaPoupanca >= 20) score += 20
    else if (taxaPoupanca >= 10) score += 10
    else if (taxaPoupanca < 0) score -= 20
    
    if (totalInvest > 0) score += 15
    if ((metasAtivas as any)?.count > 0) score += 10
    if (saldoLiquido > 0) score += 5
  }
  score = Math.min(100, Math.max(0, score))

  return c.json({
    resumo: {
      total_receitas: totalReceitas,
      total_despesas: totalDespesas,
      saldo_liquido: saldoLiquido,
      total_investimentos: totalInvest,
      percentual_investido: totalReceitas > 0 ? Math.round((totalInvest / totalReceitas) * 100) : 0,
      taxa_poupanca: totalReceitas > 0 ? Math.round(((saldoLiquido / totalReceitas) * 100) * 10) / 10 : 0
    },
    score_saude: score,
    metas: {
      ativas: (metasAtivas as any)?.count || 0,
      objetivo_total: (metasAtivas as any)?.objetivo_total || 0,
      atual_total: (metasAtivas as any)?.atual_total || 0
    },
    evolucao,
    categorias_despesas: categoriasDespesas.results,
    categorias_receitas: categoriasReceitas.results,
    ultimas_transacoes: ultimasTransacoes.results,
    proximos_vencimentos: proximosVencimentos.results,
    despesas_status: despesasStatus.results,
    periodo: { mes, ano }
  })
})

// GET /api/dashboard/relatorio
dashboard.get('/relatorio', requireAuth, async (c) => {
  const user = c.get('user')
  const { ano = String(new Date().getFullYear()) } = c.req.query()

  const mesesNomes = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']
  const relatorio = []

  for (let i = 0; i < 12; i++) {
    const m = String(i + 1).padStart(2, '0')
    
    const rec = await c.env.DB.prepare(
      `SELECT COALESCE(SUM(valor), 0) as total FROM receitas WHERE user_id = ? AND strftime('%m', data) = ? AND strftime('%Y', data) = ?`
    ).bind(user.id, m, ano).first() as any

    const desp = await c.env.DB.prepare(
      `SELECT COALESCE(SUM(valor), 0) as total FROM despesas WHERE user_id = ? AND strftime('%m', data) = ? AND strftime('%Y', data) = ?`
    ).bind(user.id, m, ano).first() as any

    relatorio.push({
      mes: mesesNomes[i],
      numero_mes: i + 1,
      receitas: rec?.total || 0,
      despesas: desp?.total || 0,
      saldo: (rec?.total || 0) - (desp?.total || 0)
    })
  }

  const totalAnualReceitas = relatorio.reduce((sum, m) => sum + m.receitas, 0)
  const totalAnualDespesas = relatorio.reduce((sum, m) => sum + m.despesas, 0)

  return c.json({
    ano,
    relatorio,
    totais: {
      receitas: totalAnualReceitas,
      despesas: totalAnualDespesas,
      saldo: totalAnualReceitas - totalAnualDespesas
    }
  })
})

export default dashboard
