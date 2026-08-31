import { Hono } from 'hono'
import { requireAuth } from './auth'
import { getLimites as getPlanLimits } from './planos'
import { competenciaMes, filtroDespesaDoMes, filtroDespesaDoAno } from '../lib/competencia'

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
  // RL4: nunca deixar "undefined/2026" ou "Agosto/NaN" chegar ao título do PDF/Excel
  if (!Number.isInteger(mes) || mes < 1 || mes > 12)
    return c.json({ error: 'Mês inválido (use 1 a 12).' }, 400)
  if (!Number.isInteger(ano) || ano < 2000 || ano > 2100)
    return c.json({ error: 'Ano inválido.' }, 400)
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
     WHERE d.user_id=?
       ${filtroDespesaDoMes('d')}
     ORDER BY d.data ASC`
  ).bind(user.id, ms, as).all<any>()

  // ── Totais por categoria ─────────────────────────────────────────────────────
  const porCategoria = await c.env.DB.prepare(
    `SELECT categoria,
            SUM(valor) as total,
            COUNT(*) as qtd
     FROM despesas
     WHERE user_id=?
       ${filtroDespesaDoMes()}
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
      ${filtroDespesaDoMes('d')}
    GROUP BY t.id, t.nome, t.cor
    ORDER BY total DESC
    LIMIT 10
  `).bind(user.id, ms, as).all<any>()

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
  if (!Number.isInteger(ano) || ano < 2000 || ano > 2100)
    return c.json({ error: 'Ano inválido.' }, 400)
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
      `SELECT (${competenciaMes()}) as mes, COALESCE(SUM(valor),0) as total
       FROM despesas
       WHERE user_id=?
         ${filtroDespesaDoAno()}
       GROUP BY (${competenciaMes()})`
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
  // RL1/RL7: melhor/pior mês só entre os meses COM dados (janeiro vazio não vence
  // como "melhor"), e devolvemos o saldo + se o melhor mês é de fato positivo —
  // a tela não deve pintar de verde um "melhor mês" que ainda é prejuízo.
  const mesesComDados = meses.filter(m => m.receitas > 0 || m.despesas > 0)
  const baseMelhor = mesesComDados.length > 0 ? mesesComDados : meses
  const melhorMes = baseMelhor.reduce((best, m) => m.saldo > best.saldo ? m : best, baseMelhor[0])
  const piorMes   = baseMelhor.reduce((worst, m) => m.saldo < worst.saldo ? m : worst, baseMelhor[0])

  const round2 = (v: number) => Math.round((Number(v) || 0) * 100) / 100

  // ── Seções analíticas do ano ──────────────────────────────────────────────
  // Top categorias de despesa, top tags, ano anterior (p/ comparação) — em
  // paralelo, cada uma um GROUP BY, sem loop.
  const anoPrev = ano - 1
  const [topCats, topTags, prevRec, prevDesp] = await Promise.all([
    c.env.DB.prepare(
      `SELECT COALESCE(NULLIF(TRIM(categoria),''),'Sem categoria') as categoria,
              COALESCE(SUM(valor),0) as total, COUNT(*) as qtd
       FROM despesas
       WHERE user_id=?
         ${filtroDespesaDoAno()}
       GROUP BY COALESCE(NULLIF(TRIM(categoria),''),'Sem categoria')
       ORDER BY total DESC
       LIMIT 8`
    ).bind(user.id, as).all<any>(),

    c.env.DB.prepare(
      `SELECT t.nome as tag, t.cor, COALESCE(SUM(d.valor),0) as total, COUNT(d.id) as qtd
       FROM tags t
       JOIN despesa_tags dt ON dt.tag_id = t.id
       JOIN despesas d ON d.id = dt.despesa_id
       WHERE t.user_id = ?
         ${filtroDespesaDoAno('d')}
       GROUP BY t.id, t.nome, t.cor
       ORDER BY total DESC
       LIMIT 8`
    ).bind(user.id, as).all<any>(),

    c.env.DB.prepare(
      `SELECT COALESCE(SUM(valor),0) as total FROM receitas
       WHERE user_id=? AND strftime('%Y',data)=?`
    ).bind(user.id, String(anoPrev)).first<{ total: number }>(),

    c.env.DB.prepare(
      `SELECT COALESCE(SUM(valor),0) as total FROM despesas
       WHERE user_id=?
         ${filtroDespesaDoAno()}`
    ).bind(user.id, String(anoPrev)).first<{ total: number }>(),
  ])

  const prevR = Number(prevRec?.total) || 0
  const prevD = Number(prevDesp?.total) || 0

  // ── Projeção para o restante do ano ───────────────────────────────────────
  // Base = média mensal dos meses COM dados. Só projeta quando ainda há meses a
  // vir (ano corrente ou futuro) e existe base para a média.
  const now      = new Date()
  const anoAtual = now.getFullYear()
  const mesAtual = now.getMonth() + 1
  const nDados   = mesesComDados.length
  let mesesRestantes = 0
  if (ano === anoAtual)      mesesRestantes = Math.max(0, 12 - mesAtual)
  else if (ano > anoAtual)   mesesRestantes = 12
  const mediaRec  = nDados ? totRec  / nDados : 0
  const mediaDesp = nDados ? totDesp / nDados : 0
  const projRecRest  = mediaRec  * mesesRestantes
  const projDespRest = mediaDesp * mesesRestantes
  const projecao = {
    aplicavel:        mesesRestantes > 0 && nDados > 0 && ano >= anoAtual,
    ano_atual:        anoAtual,
    meses_restantes:  mesesRestantes,
    meses_com_dados:  nDados,
    media_receitas:   round2(mediaRec),
    media_despesas:   round2(mediaDesp),
    media_saldo:      round2(mediaRec - mediaDesp),
    proj_receitas_restante: round2(projRecRest),
    proj_despesas_restante: round2(projDespRest),
    proj_saldo_restante:    round2(projRecRest - projDespRest),
    proj_receitas_ano: round2(totRec  + projRecRest),
    proj_despesas_ano: round2(totDesp + projDespRest),
    proj_saldo_ano:    round2((totRec + projRecRest) - (totDesp + projDespRest)),
  }

  // RL5: conquista idempotente, sem escrever em `ia_insights` (tabela de outra
  // feature) a cada GET — isso poluía e colidia com o DELETE do POST /ia/insights.
  await verificarConquista(c.env.DB, user.id, 'analista')
  await verificarConquista(c.env.DB, user.id, 'curioso')

  return c.json({
    ano,
    meses,
    totais: {
      receitas:     Math.round(totRec  * 100) / 100,
      despesas:     Math.round(totDesp * 100) / 100,
      saldo:        Math.round((totRec - totDesp) * 100) / 100,
      // RL2: média sobre 12 meses E sobre os meses com dados — a tela usa uma
      // fonte só, com o sinal correto (sem abs()).
      media_mensal: Math.round((totRec - totDesp) / 12 * 100) / 100,
      media_mensal_com_dados: mesesComDados.length > 0
        ? Math.round((totRec - totDesp) / mesesComDados.length * 100) / 100 : 0,
      meses_com_dados: mesesComDados.length,
    },
    destaques: {
      melhor_mes:         melhorMes.label,
      melhor_mes_saldo:   melhorMes.saldo,
      melhor_mes_positivo: melhorMes.saldo > 0, // RL1
      pior_mes:           piorMes.label,
      pior_mes_saldo:     piorMes.saldo,
    },
    top_categorias: (topCats.results || []).map((r: any) => ({
      categoria: r.categoria, total: round2(r.total), qtd: Number(r.qtd) || 0,
    })),
    top_tags: (topTags.results || []).map((r: any) => ({
      tag: r.tag, cor: r.cor, total: round2(r.total), qtd: Number(r.qtd) || 0,
    })),
    comparativo: {
      ano_atual:    ano,
      ano_anterior: anoPrev,
      atual:    { receitas: round2(totRec), despesas: round2(totDesp), saldo: round2(totRec - totDesp) },
      anterior: { receitas: round2(prevR),  despesas: round2(prevD),  saldo: round2(prevR - prevD) },
    },
    projecao,
  })
})

export default relatorio
