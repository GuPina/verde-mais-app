import { Hono } from 'hono'
import { competenciaData, competenciaMes, filtroDespesaDoMes, filtroNaoCancelada, filtroSemAporte } from '../lib/competencia'
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

  // S-P1: parâmetro meses (1–24, default 12)
  const _mesesRaw = c.req.query('meses')
  const _mesesParsed = _mesesRaw !== undefined ? parseInt(_mesesRaw) : NaN
  const mesesParam = Math.min(24, Math.max(1, Number.isNaN(_mesesParsed) ? 12 : _mesesParsed))

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
         ${filtroDespesaDoMes()}`
    ).bind(user.id, mesStr, String(a)).first() as any

    const r = Number(rec?.total || 0)
    const d = Number(desp?.total || 0)
    const mesesNames = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez']

    meses.push({ mes: m, ano: a, label: `${mesesNames[m-1]}/${a}`, receitas: r, despesas: d, saldo: r - d })
  }

  // ── Melhoria 2.3: Dados determinísticos do futuro ─────────────────────────
  // 1. Despesas parceladas com status 'pendente' nos próximos meses
  const parcelasFuturas = await c.env.DB.prepare(`
    SELECT 
      strftime('%m', vencimento) as mes_venc,
      strftime('%Y', vencimento) as ano_venc,
      COALESCE(SUM(valor), 0) as total
    FROM despesas
    WHERE user_id = ? AND status = 'pendente' 
      AND vencimento > date('now')
      AND vencimento <= date('now', '+12 months')
    GROUP BY mes_venc, ano_venc
  `).bind(user.id).all()

  // 2. Recorrências ativas (geram despesa todo mês)
  // NOTA: coluna correta é 'ativa' (não 'ativo')
  const recorrenciasAtivas = await c.env.DB.prepare(`
    SELECT COALESCE(SUM(valor), 0) as total_mensal
    FROM recorrencias
    WHERE user_id = ? AND ativa = 1 AND tipo IN ('despesa', 'fixa')
      AND (data_fim IS NULL OR data_fim > date('now'))
  `).bind(user.id).first() as any

  // 3. Lembretes ativos com valor estimado e vencimento próximo (até 3 meses)
  // Colunas reais: valor_estimado, ativo, proximo_vencimento
  const lembretesValor = await c.env.DB.prepare(`
    SELECT COALESCE(SUM(valor_estimado), 0) as total
    FROM lembretes
    WHERE user_id = ? AND ativo = 1
      AND valor_estimado IS NOT NULL AND valor_estimado > 0
      AND proximo_vencimento IS NOT NULL
      AND proximo_vencimento > date('now')
      AND proximo_vencimento <= date('now', '+3 months')
  `).bind(user.id).first() as any

  // Construir mapa de despesas determinísticas por mês
  const parcelasMap: Record<string, number> = {}
  for (const row of (parcelasFuturas.results as any[])) {
    const key = `${row.ano_venc}-${row.mes_venc}`
    parcelasMap[key] = parseFloat(row.total)
  }

  const recorrenciaMensal = parseFloat(recorrenciasAtivas?.total_mensal || 0)
  const lembretesTotal = parseFloat(lembretesValor?.total || 0)

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
  // Usar apenas meses com dados reais para o cálculo (evita zeros inflacionarem a variância)
  const mesesComDados = meses.filter(m => m.receitas > 0 || m.despesas > 0)
  const temDados = mesesComDados.length > 0
  const qtdMesesReais = mesesComDados.length

  let confianca: number
  if (!temDados) {
    confianca = 10
  } else if (qtdMesesReais >= 5) {
    // Calcular variância apenas sobre os saldos dos meses com dados
    const saldosMesesReais = mesesComDados.map(m => m.saldo)
    const mediaReal = saldosMesesReais.reduce((a, b) => a + b, 0) / qtdMesesReais
    const varReal = saldosMesesReais.reduce((acc, val) => acc + Math.pow(val - mediaReal, 2), 0) / qtdMesesReais
    const desReal = Math.sqrt(varReal)
    const cvReal = mediaReal !== 0 ? Math.abs(desReal / mediaReal) : 0.5
    confianca = Math.max(45, Math.min(95, Math.round((1 - Math.min(cvReal, 1)) * 95)))
  } else if (qtdMesesReais >= 3) {
    // 3–4 meses de dados: confiança moderada (40–65)
    confianca = 40 + (qtdMesesReais - 3) * 12
  } else if (qtdMesesReais >= 1) {
    // 1–2 meses: confiança baixa mas funcional
    confianca = 25 + (qtdMesesReais - 1) * 10
  } else {
    confianca = 15
  }

  // Tendência
  const tendencia = slope > 50 ? 'positive' : slope < -50 ? 'negative' : 'stable'

  // Saldo atual estimado (soma dos últimos 6 meses)
  const saldoAtual = saldos.reduce((a, b) => a + b, 0)

  // ── Projeções com dados determinísticos ───────────────────────────────────
  const INFLACAO_MENSAL = 0.003
  const mesesNomes = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez']
  const projecoes: Array<{ mes: number; ano: number; label: string; valor: number; receitas: number; despesas: number; deterministica: number; tem_dados_reais: boolean }> = []
  
  // Ignorar meses sem dados ao calcular médias (B10 fix)
  const mesesComReceita = meses.filter(m => m.receitas > 0)
  const mesesComDespesa = meses.filter(m => m.despesas > 0)
  const avgReceitas = mesesComReceita.length > 0
    ? mesesComReceita.reduce((a, m) => a + m.receitas, 0) / mesesComReceita.length
    : 0
  const avgDespesas = mesesComDespesa.length > 0
    ? mesesComDespesa.reduce((a, m) => a + m.despesas, 0) / mesesComDespesa.length
    : 0

  let saldoAcum = saldoAtual
  for (let i = 1; i <= mesesParam; i++) {
    let m = mesAtual + i
    let a = anoAtual
    while (m > 12) { m -= 12; a += 1 }
    // Receita estável (sem crescimento automático)
    const recProj = avgReceitas
    // Despesa base com inflação acumulada
    let despProj = avgDespesas * Math.pow(1 + INFLACAO_MENSAL, i)
    // Melhoria 2.3: adicionar recorrências mensais determinísticas
    despProj += recorrenciaMensal

    // Adicionar parcelas parceladas determinísticas deste mês
    const keyMes = `${String(a)}-${String(m).padStart(2, '0')}`
    const deterministica = parcelasMap[keyMes] || 0
    despProj += deterministica

    // Adicionar 1/12 dos lembretes (distribuídos uniformemente)
    if (i <= 3) despProj += lembretesTotal / 3

    saldoAcum += (recProj - despProj)
    projecoes.push({
      mes: m, ano: a,
      label: `${mesesNomes[m-1]}/${a}`,
      valor: Math.round(saldoAcum * 100) / 100,
      receitas: Math.round(recProj * 100) / 100,
      despesas: Math.round(despProj * 100) / 100,
      deterministica: Math.round(deterministica * 100) / 100,
      tem_dados_reais: deterministica > 0 || recorrenciaMensal > 0
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

  // Melhoria 2.3: alertas de despesas determinísticas
  if (recorrenciaMensal > 0) {
    insights.push(`🔄 ${recorrenciaMensal > 0 ? `R$ ${recorrenciaMensal.toFixed(0)}/mês em recorrências ativas foram incluídos nas projeções.` : ''}`)
  }
  if (Object.keys(parcelasMap).length > 0) {
    const totalParc = Object.values(parcelasMap).reduce((a, b) => a + b, 0)
    insights.push(`📋 R$ ${totalParc.toFixed(0)} em parcelas futuras identificadas foram incluídas na projeção dos próximos 12 meses.`)
  }

  const proj6 = projecoes[5]?.valor || 0
  const proj12 = projecoes[11]?.valor || 0
  if (proj12 > saldoAtual) {
    insights.push(`🔮 Em 12 meses, seu patrimônio acumulado pode chegar a R$ ${proj12.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}.`)
  } else if (proj12 < saldoAtual) {
    insights.push(`⚠️ Em 12 meses, despesas recorrentes e inflação podem reduzir seu saldo acumulado para R$ ${proj12.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}.`)
  }

  // ── S-P2: Projeção patrimonial com investimentos ──────────────────────────
  const investimentosAtivos = await c.env.DB.prepare(`
    SELECT COALESCE(SUM(valor_atual), 0) as total_atual,
           COALESCE(SUM(valor_investido), 0) as total_investido
    FROM investimentos WHERE user_id = ?
  `).bind(user.id).first() as any

  const totalInvestimentos = parseFloat(investimentosAtivos?.total_atual || 0)
  const totalInvestido = parseFloat(investimentosAtivos?.total_investido || 0)
  const rendimentoMensal = totalInvestido > 0
    ? (totalInvestimentos - totalInvestido) / totalInvestido / Math.max(1, 1) // retorno médio simplificado
    : 0

  // Buscar CDI atual para projeção de rendimento
  const cdiCache = await c.env.DB.prepare(
    `SELECT valor_brl FROM cotacoes_cache WHERE tipo='selic' ORDER BY atualizado_em DESC LIMIT 1`
  ).bind().first() as any
  const cdiAnual = parseFloat(cdiCache?.valor_brl || 14.9)
  const cdiMensal = Math.pow(1 + cdiAnual / 100, 1 / 12) - 1

  // S-P3: Cenários otimista / pessimista (±1 desvio padrão)
  const cenarioOtimista: any[] = []
  const cenarioPessimista: any[] = []
  let saldoOtim = saldoAtual
  let saldoPess = saldoAtual

  for (let i = 1; i <= mesesParam; i++) {
    let m = mesAtual + i
    let a = anoAtual
    while (m > 12) { m -= 12; a += 1 }
    const mesesNomesC = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez']
    const label = `${mesesNomesC[m-1]}/${a}`
    const keyMes = `${String(a)}-${String(m).padStart(2, '0')}`
    const detMin = parcelasMap[keyMes] || 0

    // Otimista: receitas +10%, despesas -5%
    const recOtim = avgReceitas * 1.10
    const despOtim = (avgDespesas * Math.pow(1 + INFLACAO_MENSAL, i) * 0.95) + recorrenciaMensal + detMin
    saldoOtim += (recOtim - despOtim)
    cenarioOtimista.push({ mes: m, ano: a, label, valor: Math.round(saldoOtim * 100) / 100 })

    // Pessimista: receitas -10%, despesas +10%
    const recPess = avgReceitas * 0.90
    const despPess = (avgDespesas * Math.pow(1 + INFLACAO_MENSAL, i) * 1.10) + recorrenciaMensal + detMin
    saldoPess += (recPess - despPess)
    cenarioPessimista.push({ mes: m, ano: a, label, valor: Math.round(saldoPess * 100) / 100 })
  }

  // Conquista: consultou projeção (projetor + projecao_vista + viu_projecao do Bloco 5)
  await c.env.DB.prepare(
    `INSERT OR IGNORE INTO conquistas_usuario (user_id, conquista_codigo, data_conquista, visualizado)
     VALUES (?, ?, datetime('now'), 0)`
  ).bind(user.id, 'projetor').run().catch(() => {})
  await c.env.DB.prepare(
    `INSERT OR IGNORE INTO conquistas_usuario (user_id, conquista_codigo, data_conquista, visualizado)
     VALUES (?, ?, datetime('now'), 0)`
  ).bind(user.id, 'projecao_vista').run().catch(() => {})
  await c.env.DB.prepare(
    `INSERT OR IGNORE INTO conquistas_usuario (user_id, conquista_codigo, data_conquista, visualizado)
     VALUES (?, ?, datetime('now'), 0)`
  ).bind(user.id, 'viu_projecao').run().catch(() => {})

  // ── BLOCO 6.3: Integração Projeção → Metas ─────────────────────────────────
  // Verificar se metas ativas serão atingíveis com a projeção atual
  const metasAtivas = await c.env.DB.prepare(`
    SELECT id, nome, valor_objetivo, valor_atual, data_meta
    FROM metas WHERE user_id = ? AND status = 'ativa' AND data_meta IS NOT NULL
    ORDER BY data_meta ASC LIMIT 5
  `).bind(user.id).all()

  const metas_analise = (metasAtivas.results as any[]).map(meta => {
    const faltante = parseFloat(meta.valor_objetivo) - parseFloat(meta.valor_atual)
    const dataMeta = new Date(meta.data_meta)
    const hoje = new Date()
    const mesesRestantes = Math.max(0, Math.ceil((dataMeta.getTime() - hoje.getTime()) / (1000 * 60 * 60 * 24 * 30)))
    const poupancaNecessaria = mesesRestantes > 0 ? faltante / mesesRestantes : faltante
    const viavel = mediaPonderada >= poupancaNecessaria
    return {
      id: meta.id,
      nome: meta.nome,
      valor_faltante: Math.round(faltante * 100) / 100,
      meses_restantes: mesesRestantes,
      poupanca_necessaria_mes: Math.round(poupancaNecessaria * 100) / 100,
      viavel_com_projecao: viavel,
      alerta: !viavel ? `⚠️ Meta "${meta.nome}" pode não ser atingida: você precisa poupar R$ ${poupancaNecessaria.toFixed(0)}/mês mas seu saldo médio é R$ ${mediaPonderada.toFixed(0)}/mês.` : null
    }
  })

  // Adicionar alertas de metas aos insights
  for (const meta of metas_analise) {
    if (meta.alerta) insights.push(meta.alerta)
  }

  return c.json({
    historico: meses,
    projecoes,
    // S-P3: cenários otimista / pessimista
    cenarios: {
      base: projecoes,
      otimista: cenarioOtimista,
      pessimista: cenarioPessimista
    },
    tendencia,
    media_mensal: Math.round((avgReceitas - avgDespesas) * 100) / 100,
    media_receitas: Math.round(avgReceitas * 100) / 100,
    media_despesas: Math.round(avgDespesas * 100) / 100,
    saldo_atual: Math.round(saldoAtual * 100) / 100,
    confianca,
    insights,
    // S-P1: horizonte configurável
    horizonte_meses: mesesParam,
    // S-P2: projeção patrimonial com investimentos
    patrimonio: {
      investimentos_atual: Math.round(totalInvestimentos * 100) / 100,
      investimentos_investido: Math.round(totalInvestido * 100) / 100,
      rendimento_cdi_anual: cdiAnual,
      projecao_investimentos_12m: Math.round(totalInvestimentos * Math.pow(1 + cdiMensal, Math.min(12, mesesParam)) * 100) / 100
    },
    // Dados determinísticos
    dados_certos: {
      recorrencias_mensais: Math.round(recorrenciaMensal * 100) / 100,
      lembretes_estimados: Math.round(lembretesTotal * 100) / 100,
      meses_com_parcelas: Object.keys(parcelasMap).length,
      total_parcelas_futuras: Math.round(Object.values(parcelasMap).reduce((a, b) => a + b, 0) * 100) / 100
    },
    // Bloco 6.3: análise de viabilidade das metas
    metas_analise,
    resumo: {
      projecao_6m: Math.round((projecoes[5]?.valor || projecoes[projecoes.length - 1]?.valor || 0) * 100) / 100,
      projecao_12m: Math.round((projecoes[11]?.valor || projecoes[projecoes.length - 1]?.valor || 0) * 100) / 100,
      cenario_otimista_12m: Math.round((cenarioOtimista[11]?.valor || cenarioOtimista[cenarioOtimista.length - 1]?.valor || 0) * 100) / 100,
      cenario_pessimista_12m: Math.round((cenarioPessimista[11]?.valor || cenarioPessimista[cenarioPessimista.length - 1]?.valor || 0) * 100) / 100,
    }
  })
})

export default projecao
