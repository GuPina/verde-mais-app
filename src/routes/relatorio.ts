import { Hono } from 'hono'
import { requireAuth } from './auth'
import { getLimites as getPlanLimits } from './planos'

type Bindings  = { DB: D1Database }
type Variables = { user: { id: number; nome: string; plano: string } }

async function verificarConquista(db: D1Database, userId: number, codigo: string) {
  await db.prepare(
    `INSERT OR IGNORE INTO conquistas_usuario (user_id, conquista_codigo, data_conquista, visualizado)
     VALUES (?, ?, datetime('now'), 0)`
  ).bind(userId, codigo).run().catch(() => {})
}

const relatorio = new Hono<{ Bindings: Bindings; Variables: Variables }>()

// ─── GET /api/relatorio/dados?mes=3&ano=2025 ─────────────────────────────────
// Retorna JSON completo para geração de PDF/Excel no browser
relatorio.get('/dados', requireAuth, async (c) => {
  const user = c.get('user')
  const lim  = getPlanLimits(user.plano)

  if (!lim.exportar_pdf) {
    return c.json({
      error:   'Exportação de relatórios é exclusiva do plano Premium.',
      upgrade: true,
      feature: 'exportar_pdf'
    }, 403)
  }

  const hoje = new Date()
  const mes  = parseInt(c.req.query('mes') || String(hoje.getMonth() + 1))
  const ano  = parseInt(c.req.query('ano') || String(hoje.getFullYear()))
  const ms   = String(mes).padStart(2, '0')
  const as   = String(ano)

  const mesesNomes = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho',
                      'Julho','Agosto','Setembro','Outubro','Novembro','Dezembro']

  // ── Receitas do mês ─────────────────────────────────────────────────────────
  const receitas = await c.env.DB.prepare(
    `SELECT descricao, valor, data, categoria, observacoes
     FROM receitas
     WHERE user_id=? AND strftime('%m',data)=? AND strftime('%Y',data)=?
     ORDER BY data ASC`
  ).bind(user.id, ms, as).all<any>()

  // ── Despesas do mês ─────────────────────────────────────────────────────────
  const despesas = await c.env.DB.prepare(
    `SELECT d.descricao, d.valor, d.data, d.categoria, d.status, d.meio_pagamento,
            d.cartao_id, c.nome as cartao_nome,
            (SELECT GROUP_CONCAT(t.nome,'|') FROM despesa_tags dt
             JOIN tags t ON t.id=dt.tag_id WHERE dt.despesa_id=d.id) as tags
     FROM despesas d
     LEFT JOIN cartoes c ON c.id = d.cartao_id
     WHERE d.user_id=? AND d.status!='cancelado'
       AND strftime('%m',COALESCE(d.vencimento,d.data))=?
       AND strftime('%Y',COALESCE(d.vencimento,d.data))=?
     ORDER BY d.data ASC`
  ).bind(user.id, ms, as).all<any>()

  // ── Totais por categoria ─────────────────────────────────────────────────────
  const porCategoria = await c.env.DB.prepare(
    `SELECT categoria,
            SUM(valor) as total,
            COUNT(*) as qtd
     FROM despesas
     WHERE user_id=? AND status!='cancelado'
       AND strftime('%m',COALESCE(vencimento,data))=?
       AND strftime('%Y',COALESCE(vencimento,data))=?
     GROUP BY categoria
     ORDER BY total DESC`
  ).bind(user.id, ms, as).all<any>()

  // ── Investimentos ────────────────────────────────────────────────────────────
  const investimentos = await c.env.DB.prepare(
    `SELECT nome, tipo, valor_investido, valor_atual, rentabilidade_percentual, instituicao
     FROM investimentos WHERE user_id=? ORDER BY valor_atual DESC`
  ).bind(user.id).all<any>()

  // ── Dívidas ─────────────────────────────────────────────────────────────────
  const financiamentos = await c.env.DB.prepare(
    `SELECT descricao, saldo_devedor, valor_parcela, taxa_juros_anual, data_previsao_fim
     FROM financiamentos WHERE user_id=? AND status='ativo'`
  ).bind(user.id).all<any>()

  const emprestimos = await c.env.DB.prepare(
    `SELECT descricao, saldo_devedor, valor_parcela, taxa_juros_anual, data_previsao_fim
     FROM emprestimos WHERE user_id=? AND status='ativo'`
  ).bind(user.id).all<any>()

  // ── Metas ────────────────────────────────────────────────────────────────────
  const metas = await c.env.DB.prepare(
    `SELECT nome, valor_objetivo, valor_atual, data_meta, status,
            ROUND(valor_atual * 100.0 / NULLIF(valor_objetivo,0), 1) as progresso
     FROM metas WHERE user_id=? ORDER BY data_meta ASC`
  ).bind(user.id).all<any>()

  // ── Resumo ───────────────────────────────────────────────────────────────────
  const totalReceitas  = (receitas.results || []).reduce((s: number, r: any) => s + r.valor, 0)
  const totalDespesas  = (despesas.results || []).reduce((s: number, d: any) => s + d.valor, 0)
  const totalInvest    = (investimentos.results || []).reduce((s: number, i: any) => s + i.valor_atual, 0)
  const totalDividas   = [
    ...(financiamentos.results || []),
    ...(emprestimos.results || [])
  ].reduce((s: number, d: any) => s + (d.saldo_devedor || 0), 0)

  // Conquista
  await c.env.DB.prepare(
    `INSERT OR IGNORE INTO conquistas_usuario (user_id, conquista_codigo, data_conquista, visualizado)
     VALUES (?, 'exportador', datetime('now'), 0)`
  ).bind(user.id).run().catch(() => {})

  // ── Bloco 4.4: Tags nos Relatórios ───────────────────────────────────────
  const gastosPorTag = await c.env.DB.prepare(`
    SELECT t.nome as tag, t.cor, SUM(d.valor) as total, COUNT(d.id) as qtd
    FROM tags t
    JOIN despesa_tags dt ON dt.tag_id = t.id
    JOIN despesas d ON d.id = dt.despesa_id
    WHERE t.user_id = ?
      AND strftime('%Y-%m', d.data) = printf('%04d-%02d', ?, ?)
      AND COALESCE(d.eh_aporte_patrimonial, 0) = 0
    GROUP BY t.id, t.nome, t.cor
    ORDER BY total DESC
    LIMIT 10
  `).bind(user.id, ano, mes).all<any>()

  return c.json({
    meta: {
      usuario:    user.nome,
      plano:      user.plano,
      periodo:    `${mesesNomes[mes - 1]}/${ano}`,
      gerado_em:  new Date().toISOString(),
    },
    resumo: {
      total_receitas:  Math.round(totalReceitas  * 100) / 100,
      total_despesas:  Math.round(totalDespesas  * 100) / 100,
      saldo_liquido:   Math.round((totalReceitas - totalDespesas) * 100) / 100,
      taxa_poupanca:   totalReceitas > 0
        ? Math.round((totalReceitas - totalDespesas) / totalReceitas * 1000) / 10
        : 0,
      taxa_poupanca_negativa: totalReceitas > 0
        ? (totalReceitas - totalDespesas) < 0
        : totalDespesas > 0,
      total_investido: Math.round(totalInvest  * 100) / 100,
      total_dividas:   Math.round(totalDividas * 100) / 100,
    },
    receitas:       receitas.results     || [],
    despesas:       despesas.results     || [],
    por_categoria:  porCategoria.results || [],
    investimentos:  investimentos.results || [],
    dividas: {
      financiamentos: financiamentos.results || [],
      emprestimos:    emprestimos.results    || [],
    },
    metas: metas.results || [],
    gastos_por_tag: gastosPorTag.results || [],
  })
})

// ─── GET /api/relatorio/anual?ano=2025 ──────────────────────────────────────
relatorio.get('/anual', requireAuth, async (c) => {
  const user = c.get('user')
  const lim  = getPlanLimits(user.plano)

  if (!lim.relatorio_anual) {
    return c.json({
      error:   'Relatório anual é exclusivo do plano Premium.',
      upgrade: true,
      feature: 'relatorio_anual'
    }, 403)
  }

  const ano  = parseInt(c.req.query('ano') || String(new Date().getFullYear()))
  const mN   = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez']
  const as   = String(ano)

  // 2 queries com GROUP BY em vez de 24 queries em loop
  const [rowsRec, rowsDesp] = await Promise.all([
    c.env.DB.prepare(
      `SELECT strftime('%m', data) as mes, COALESCE(SUM(valor),0) as total
       FROM receitas
       WHERE user_id=? AND strftime('%Y',data)=?
       GROUP BY strftime('%m', data)`
    ).bind(user.id, as).all<{mes:string;total:number}>(),

    c.env.DB.prepare(
      `SELECT strftime('%m', COALESCE(vencimento,data)) as mes, COALESCE(SUM(valor),0) as total
       FROM despesas
       WHERE user_id=? AND status!='cancelado' AND strftime('%Y',COALESCE(vencimento,data))=?
       GROUP BY strftime('%m', COALESCE(vencimento,data))`
    ).bind(user.id, as).all<{mes:string;total:number}>(),
  ])

  const recMap:  Record<string, number> = {}
  const despMap: Record<string, number> = {}
  for (const r of (rowsRec.results  || [])) recMap[r.mes]  = Number(r.total)
  for (const d of (rowsDesp.results || [])) despMap[d.mes] = Number(d.total)

  const meses = Array.from({ length: 12 }, (_, idx) => {
    const m  = idx + 1
    const ms = String(m).padStart(2, '0')
    const rec  = recMap[ms]  || 0
    const desp = despMap[ms] || 0
    return {
      label:    mN[idx],
      mes:      m,
      receitas: Math.round(rec  * 100) / 100,
      despesas: Math.round(desp * 100) / 100,
      saldo:    Math.round((rec - desp) * 100) / 100,
    }
  })

  const totRec  = meses.reduce((s, m) => s + m.receitas, 0)
  const totDesp = meses.reduce((s, m) => s + m.despesas, 0)
  const melhorMes = meses.reduce((best, m) => m.saldo > best.saldo ? m : best, meses[0])
  const piorMes   = meses.reduce((worst, m) => m.saldo < worst.saldo ? m : worst, meses[0])

  // Conquistas — ANTES do return
  try {
    await verificarConquista(c.env.DB, user.id, 'analista')
    await c.env.DB.prepare(
      `INSERT INTO ia_insights (user_id, tipo, descricao, created_at) VALUES (?, 'relatorio_anual_visto', 'Visualizou relatório anual', datetime('now'))`
    ).bind(user.id).run().catch(() => {})
    const totalViz = await c.env.DB.prepare(
      `SELECT COUNT(*) as cnt FROM ia_insights WHERE user_id=? AND tipo='relatorio_anual_visto'`
    ).bind(user.id).first() as any
    if ((totalViz?.cnt || 0) >= 3) await verificarConquista(c.env.DB, user.id, 'curioso')
  } catch(_) {}

  return c.json({
    ano,
    meses,
    totais: {
      receitas:     Math.round(totRec  * 100) / 100,
      despesas:     Math.round(totDesp * 100) / 100,
      saldo:        Math.round((totRec - totDesp) * 100) / 100,
      media_mensal: Math.round((totRec - totDesp) / 12 * 100) / 100,
    },
    destaques: {
      melhor_mes: melhorMes.label,
      pior_mes:   piorMes.label,
    }
  })
})

export default relatorio
