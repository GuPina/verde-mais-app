import { Hono } from 'hono'
import { requireAuth } from './auth'

type Bindings  = { DB: D1Database }
type Variables = { user: { id: number; nome: string; plano: string } }

const comparativo = new Hono<{ Bindings: Bindings; Variables: Variables }>()

// ─── GET /api/comparativo?mes=3&ano=2025 ────────────────────────────────────
// Compara mês solicitado com o mês anterior por categoria
comparativo.get('/', requireAuth, async (c) => {
  const user = c.get('user')

  const hoje     = new Date()
  const mesAtual = parseInt(c.req.query('mes')  || String(hoje.getMonth() + 1))
  const anoAtual = parseInt(c.req.query('ano')  || String(hoje.getFullYear()))

  // Mês anterior
  let mesAnt = mesAtual - 1
  let anoAnt = anoAtual
  if (mesAnt < 1) { mesAnt = 12; anoAnt -= 1 }

  const mesStr    = String(mesAtual).padStart(2, '0')
  const mesAntStr = String(mesAnt).padStart(2, '0')
  const anoStr    = String(anoAtual)
  const anoAntStr = String(anoAnt)

  // ── Totais gerais ──────────────────────────────────────────────────────────
  const [recAtual, recAnt, despAtual, despAnt] = await Promise.all([
    c.env.DB.prepare(
      `SELECT COALESCE(SUM(valor),0) as total FROM receitas
       WHERE user_id=? AND strftime('%m',data)=? AND strftime('%Y',data)=?`
    ).bind(user.id, mesStr, anoStr).first<{total:number}>(),

    c.env.DB.prepare(
      `SELECT COALESCE(SUM(valor),0) as total FROM receitas
       WHERE user_id=? AND strftime('%m',data)=? AND strftime('%Y',data)=?`
    ).bind(user.id, mesAntStr, anoAntStr).first<{total:number}>(),

    c.env.DB.prepare(
      `SELECT COALESCE(SUM(valor),0) as total FROM despesas
       WHERE user_id=? AND status!='cancelado'
         AND strftime('%m',COALESCE(vencimento,data))=?
         AND strftime('%Y',COALESCE(vencimento,data))=?`
    ).bind(user.id, mesStr, anoStr).first<{total:number}>(),

    c.env.DB.prepare(
      `SELECT COALESCE(SUM(valor),0) as total FROM despesas
       WHERE user_id=? AND status!='cancelado'
         AND strftime('%m',COALESCE(vencimento,data))=?
         AND strftime('%Y',COALESCE(vencimento,data))=?`
    ).bind(user.id, mesAntStr, anoAntStr).first<{total:number}>(),
  ])

  // ── Por categoria — mês atual ──────────────────────────────────────────────
  const catAtual = await c.env.DB.prepare(
    `SELECT categoria,
            COALESCE(SUM(valor),0) as total,
            COUNT(*) as qtd
     FROM despesas
     WHERE user_id=? AND status!='cancelado'
       AND strftime('%m',COALESCE(vencimento,data))=?
       AND strftime('%Y',COALESCE(vencimento,data))=?
     GROUP BY categoria
     ORDER BY total DESC`
  ).bind(user.id, mesStr, anoStr).all<{categoria:string;total:number;qtd:number}>()

  // ── Por categoria — mês anterior ──────────────────────────────────────────
  const catAnt = await c.env.DB.prepare(
    `SELECT categoria,
            COALESCE(SUM(valor),0) as total,
            COUNT(*) as qtd
     FROM despesas
     WHERE user_id=? AND status!='cancelado'
       AND strftime('%m',COALESCE(vencimento,data))=?
       AND strftime('%Y',COALESCE(vencimento,data))=?
     GROUP BY categoria`
  ).bind(user.id, mesAntStr, anoAntStr).all<{categoria:string;total:number;qtd:number}>()

  const antMap: Record<string, number> = {}
  for (const r of (catAnt.results || [])) antMap[r.categoria] = r.total

  // União de categorias com variação
  const todasCats = new Set([
    ...(catAtual.results || []).map(r => r.categoria),
    ...Object.keys(antMap)
  ])

  const categorias = Array.from(todasCats).map(cat => {
    const atual  = (catAtual.results || []).find(r => r.categoria === cat)?.total || 0
    const ant    = antMap[cat] || 0
    const diff   = atual - ant
    const variacao = ant > 0 ? ((diff / ant) * 100) : (atual > 0 ? 100 : 0)
    return {
      categoria: cat,
      atual:     Math.round(atual  * 100) / 100,
      anterior:  Math.round(ant    * 100) / 100,
      diferenca: Math.round(diff   * 100) / 100,
      variacao:  Math.round(variacao * 10) / 10,
      status: variacao > 10 ? 'alta' : variacao < -10 ? 'queda' : 'estavel'
    }
  }).sort((a, b) => Math.abs(b.diferenca) - Math.abs(a.diferenca))

  // ── Top 3 alertas ──────────────────────────────────────────────────────────
  const alertas: string[] = []
  const maioresAumentos = categorias.filter(c => c.variacao > 20).slice(0, 3)
  for (const c of maioresAumentos) {
    alertas.push(`⬆️ ${c.categoria}: +${c.variacao.toFixed(0)}% (R$ ${c.diferenca.toFixed(2)} a mais)`)
  }

  const rA  = Number(recAtual?.total  || 0)
  const rAn = Number(recAnt?.total    || 0)
  const dA  = Number(despAtual?.total || 0)
  const dAn = Number(despAnt?.total   || 0)

  const saldoA  = rA  - dA
  const saldoAn = rAn - dAn

  const varReceitas = rAn > 0 ? ((rA - rAn) / rAn) * 100 : (rA > 0 ? 100 : 0)
  const varDespesas = dAn > 0 ? ((dA - dAn) / dAn) * 100 : (dA > 0 ? 100 : 0)
  const varSaldo    = saldoAn !== 0 ? ((saldoA - saldoAn) / Math.abs(saldoAn)) * 100 : (saldoA !== 0 ? 100 : 0)

  const mesesNomes = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho',
                      'Julho','Agosto','Setembro','Outubro','Novembro','Dezembro']

  // ── Melhoria 2.4: Insights automáticos do comparativo ──────────────────────
  const insights: string[] = []

  if (varDespesas > 15) {
    insights.push(`📈 Gastos subiram ${varDespesas.toFixed(1)}% em relação a ${mesesNomes[mesAnt-1]}. Revise categorias em alta.`)
  } else if (varDespesas < -10) {
    insights.push(`📉 Ótimo! Você reduziu gastos em ${Math.abs(varDespesas).toFixed(1)}% comparado a ${mesesNomes[mesAnt-1]}.`)
  }

  if (varReceitas > 10) {
    insights.push(`💰 Receitas cresceram ${varReceitas.toFixed(1)}% — ótimo mês! Considere investir o excedente.`)
  } else if (varReceitas < -15) {
    insights.push(`⚠️ Receitas caíram ${Math.abs(varReceitas).toFixed(1)}%. Fique atento ao orçamento este mês.`)
  }

  if (saldoA > 0 && saldoAn <= 0) {
    insights.push(`🎉 Você saiu do vermelho! Saldo passou de ${saldoAn >= 0 ? '+' : ''}R$ ${saldoAn.toFixed(2)} para +R$ ${saldoA.toFixed(2)}.`)
  } else if (saldoA < 0 && saldoAn >= 0) {
    insights.push(`🚨 Atenção: saldo ficou negativo este mês (-R$ ${Math.abs(saldoA).toFixed(2)}). Revise gastos urgente.`)
  } else if (varSaldo > 20) {
    insights.push(`✅ Saldo melhorou ${varSaldo.toFixed(0)}% — continue nessa direção!`)
  }

  // Categoria com maior aumento absoluto
  const maiorAumento = categorias.filter(c => c.diferenca > 0).sort((a, b) => b.diferenca - a.diferenca)[0]
  if (maiorAumento && maiorAumento.diferenca > 50) {
    insights.push(`🔍 Maior aumento: "${maiorAumento.categoria}" +R$ ${maiorAumento.diferenca.toFixed(2)} (${maiorAumento.variacao.toFixed(0)}%). Vale a pena investigar.`)
  }

  // Categoria com maior redução
  const maiorQueda = categorias.filter(c => c.diferenca < 0).sort((a, b) => a.diferenca - b.diferenca)[0]
  if (maiorQueda && Math.abs(maiorQueda.diferenca) > 50) {
    insights.push(`💡 Maior economia: "${maiorQueda.categoria}" -R$ ${Math.abs(maiorQueda.diferenca).toFixed(2)}. Continue assim!`)
  }

  return c.json({
    periodo: {
      mes:         mesAtual,
      ano:         anoAtual,
      label:       `${mesesNomes[mesAtual-1]}/${anoAtual}`,
      mes_ant:     mesAnt,
      ano_ant:     anoAnt,
      label_ant:   `${mesesNomes[mesAnt-1]}/${anoAnt}`
    },
    resumo: {
      receitas_atual:   Math.round(rA   * 100) / 100,
      receitas_ant:     Math.round(rAn  * 100) / 100,
      despesas_atual:   Math.round(dA   * 100) / 100,
      despesas_ant:     Math.round(dAn  * 100) / 100,
      saldo_atual:      Math.round(saldoA  * 100) / 100,
      saldo_ant:        Math.round(saldoAn * 100) / 100,
      var_receitas:     Math.round(varReceitas * 10) / 10,
      var_despesas:     Math.round(varDespesas * 10) / 10,
      var_saldo:        Math.round(varSaldo    * 10) / 10,
      tendencia_receitas: varReceitas > 5 ? 'alta' : varReceitas < -5 ? 'queda' : 'estavel',
      tendencia_despesas: varDespesas > 5 ? 'alta' : varDespesas < -5 ? 'queda' : 'estavel',
      tendencia_saldo:    varSaldo    > 5 ? 'alta' : varSaldo    < -5 ? 'queda' : 'estavel',
    },
    categorias,
    alertas,
    insights  // Melhoria 2.4
  })
})

// ─── GET /api/comparativo/historico?meses=6 ─────────────────────────────────
// Últimos N meses (para gráfico de linha)
comparativo.get('/historico', requireAuth, async (c) => {
  const user   = c.get('user')
  const nMeses = Math.min(12, parseInt(c.req.query('meses') || '6'))
  const hoje   = new Date()
  const result = []

  for (let i = nMeses - 1; i >= 0; i--) {
    let m = hoje.getMonth() + 1 - i
    let a = hoje.getFullYear()
    while (m <= 0) { m += 12; a -= 1 }
    const ms = String(m).padStart(2, '0')
    const as = String(a)

    const [rec, desp] = await Promise.all([
      c.env.DB.prepare(
        `SELECT COALESCE(SUM(valor),0) as t FROM receitas
         WHERE user_id=? AND strftime('%m',data)=? AND strftime('%Y',data)=?`
      ).bind(user.id, ms, as).first<{t:number}>(),
      c.env.DB.prepare(
        `SELECT COALESCE(SUM(valor),0) as t FROM despesas
         WHERE user_id=? AND status!='cancelado'
           AND strftime('%m',COALESCE(vencimento,data))=?
           AND strftime('%Y',COALESCE(vencimento,data))=?`
      ).bind(user.id, ms, as).first<{t:number}>(),
    ])

    const mN = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez']
    result.push({
      label:    `${mN[m-1]}/${a}`,
      mes:      m,
      ano:      a,
      receitas: Math.round(Number(rec?.t  || 0) * 100) / 100,
      despesas: Math.round(Number(desp?.t || 0) * 100) / 100,
      saldo:    Math.round((Number(rec?.t || 0) - Number(desp?.t || 0)) * 100) / 100
    })
  }

  return c.json({ historico: result })
})

export default comparativo
