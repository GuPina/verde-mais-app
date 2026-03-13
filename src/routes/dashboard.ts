import { Hono } from 'hono'
import { requireAuth } from './auth'
import { getLimites, podeUsar, MSG_UPGRADE } from './planos'

type Bindings = { DB: D1Database }
type Variables = { user: { id: number; nome: string; email: string; plano: string } }

const dashboard = new Hono<{ Bindings: Bindings; Variables: Variables }>()

// GET /api/dashboard
dashboard.get('/', requireAuth, async (c) => {
  const user = c.get('user')
  const now = new Date()
  const mes = String(now.getMonth() + 1).padStart(2, '0')
  const ano = String(now.getFullYear())

  // Receitas do mês — usa data de recebimento
  const receitasMes = await c.env.DB.prepare(
    `SELECT COALESCE(SUM(valor), 0) as total FROM receitas 
     WHERE user_id = ? AND strftime('%m', data) = ? AND strftime('%Y', data) = ?`
  ).bind(user.id, mes, ano).first() as any

  // Despesas do mês — critério temporal consistente:
  //   pago   → usa data (data em que foi paga)
  //   pendente/outro → usa COALESCE(vencimento, data) (vencimento se existir, senão data)
  // BUG 1.1 FIX: excluir aportes (tipo='aporte') do total de despesas
  const despesasMes = await c.env.DB.prepare(
    `SELECT COALESCE(SUM(valor), 0) as total FROM despesas 
     WHERE user_id = ?
       AND COALESCE(tipo,'normal') != 'aporte'
       AND CASE WHEN status = 'pago'
                THEN strftime('%m', data) = ? AND strftime('%Y', data) = ?
                ELSE strftime('%m', COALESCE(vencimento, data)) = ?
                 AND strftime('%Y', COALESCE(vencimento, data)) = ?
           END`
  ).bind(user.id, mes, ano, mes, ano).first() as any

  // Despesas pagas vs pendentes (mesmo critério temporal) — sem aportes
  const despesasStatus = await c.env.DB.prepare(
    `SELECT status, COALESCE(SUM(valor), 0) as total FROM despesas 
     WHERE user_id = ?
       AND COALESCE(tipo,'normal') != 'aporte'
       AND CASE WHEN status = 'pago'
                THEN strftime('%m', data) = ? AND strftime('%Y', data) = ?
                ELSE strftime('%m', COALESCE(vencimento, data)) = ?
                 AND strftime('%Y', COALESCE(vencimento, data)) = ?
           END
     GROUP BY status`
  ).bind(user.id, mes, ano, mes, ano).all()

  // Total investimentos
  const totalInvestimentos = await c.env.DB.prepare(
    `SELECT COALESCE(SUM(valor_atual), 0) as total, COALESCE(SUM(valor_investido), 0) as investido FROM investimentos WHERE user_id = ?`
  ).bind(user.id).first() as any

  // Metas ativas
  const metasAtivas = await c.env.DB.prepare(
    `SELECT COUNT(*) as count, COALESCE(SUM(valor_objetivo), 0) as objetivo_total, 
     COALESCE(SUM(valor_atual), 0) as atual_total FROM metas WHERE user_id = ? AND status = 'ativa'`
  ).bind(user.id).first() as any

  // === NOVO: Empréstimos ativos ===
  const emprestimosAtivos = await c.env.DB.prepare(
    `SELECT 
       COUNT(*) as count,
       COALESCE(SUM(saldo_devedor), 0) as total_saldo_devedor,
       COALESCE(SUM(valor_parcela), 0) as total_parcela_mensal,
       COALESCE(SUM(valor_original), 0) as total_valor_original
     FROM emprestimos WHERE user_id = ? AND status = 'ativo'`
  ).bind(user.id).first() as any

  // === NOVO: Financiamentos ativos ===
  const financiamentosAtivos = await c.env.DB.prepare(
    `SELECT 
       COUNT(*) as count,
       COALESCE(SUM(saldo_devedor), 0) as total_saldo_devedor,
       COALESCE(SUM(valor_parcela), 0) as total_parcela_mensal,
       COALESCE(SUM(valor_financiado), 0) as total_valor_financiado
     FROM financiamentos WHERE user_id = ? AND status = 'ativo'`
  ).bind(user.id).first() as any

  // === 2.1: Patrimônio Bruto / Líquido ===
  // Patrimônio Bruto = investimentos + reservas especializadas + saldo bancário estimado (saldo acumulado)
  // Patrimônio Líquido = Bruto - total dívidas (empréstimos + financiamentos)
  const reservasEspTotal = await c.env.DB.prepare(
    `SELECT COALESCE(SUM(current_amount), 0) as total FROM specialized_reserves WHERE user_id = ? AND is_active = 1`
  ).bind(user.id).first() as any

  const reservaLegadoTotal = await c.env.DB.prepare(
    `SELECT COALESCE(valor_atual, 0) as total FROM reserva_emergencia WHERE user_id = ? ORDER BY id DESC LIMIT 1`
  ).bind(user.id).first() as any

  // Assinaturas fantasma detectadas (alertas ativos)
  const assinaturasAlerta = await c.env.DB.prepare(
    `SELECT COUNT(*) as cnt, COALESCE(SUM(estimated_monthly_cost),0) as total_mensal
     FROM detected_subscriptions WHERE user_id = ? AND user_action IS NULL`
  ).bind(user.id).first() as any

  // Desafio 52 semanas — progresso do ano atual
  const desafioProgresso = await c.env.DB.prepare(
    `SELECT COUNT(*) as total, SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) as concluidas,
     SUM(CASE WHEN status='completed' THEN week_number ELSE 0 END) as valor_acumulado
     FROM weekly_challenges WHERE user_id = ? AND strftime('%Y', week_date) = ?`
  ).bind(user.id, ano).first() as any

  // === NOVO: Fatura de cartão do mês corrente (pendentes) ===
  // Soma card_charges com billing_month/billing_year igual ao mês atual e status pendente
  const faturaCartoesMes = await c.env.DB.prepare(
    `SELECT COALESCE(SUM(cc.valor), 0) as total
     FROM card_charges cc
     JOIN cartoes c ON cc.card_id = c.id
     WHERE c.user_id = ?
       AND cc.billing_month = ?
       AND cc.billing_year = ?
       AND cc.status = 'pendente'`
  ).bind(user.id, parseInt(mes), parseInt(ano)).first() as any

  // === MELHORIA 2.1: Patrimônio Bruto/Líquido ===
  // Patrimônio bruto = investimentos atuais + reservas especializadas + saldo acumulado estimado
  const reservasEsp = await c.env.DB.prepare(
    `SELECT COALESCE(SUM(current_amount), 0) as total, COALESCE(SUM(target_amount), 0) as meta,
     COUNT(*) as count, SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) as concluidas
     FROM specialized_reserves WHERE user_id = ? AND is_active = 1`
  ).bind(user.id).first() as any

  // Assinaturas fantasma detectadas (alerta)
  const assinaturasAlerta = await c.env.DB.prepare(
    `SELECT COUNT(*) as total, COALESCE(SUM(estimated_monthly_cost), 0) as custo_mensal
     FROM detected_subscriptions WHERE user_id = ? AND status = 'detected'`
  ).bind(user.id).first() as any

  // Desafio 52 semanas — progresso do ano atual
  const desafio52 = await c.env.DB.prepare(
    `SELECT 
       COUNT(*) as total_semanas,
       SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) as concluidas,
       SUM(CASE WHEN status='skipped' THEN 1 ELSE 0 END) as puladas,
       SUM(CASE WHEN status='completed' THEN week_number ELSE 0 END) as valor_guardado
     FROM weekly_challenges WHERE user_id = ? AND strftime('%Y', week_date) = ?`
  ).bind(user.id, ano).first() as any

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
      `SELECT COALESCE(SUM(valor), 0) as total FROM despesas 
       WHERE user_id = ?
         AND CASE WHEN status = 'pago'
                  THEN strftime('%m', data) = ? AND strftime('%Y', data) = ?
                  ELSE strftime('%m', COALESCE(vencimento, data)) = ?
                   AND strftime('%Y', COALESCE(vencimento, data)) = ?
             END`
    ).bind(user.id, m, a, m, a).first() as any

    const meses = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']
    evolucao.push({
      mes: meses[d.getMonth()],
      ano: a,
      receitas: rec?.total || 0,
      despesas: desp?.total || 0,
      saldo: (rec?.total || 0) - (desp?.total || 0)
    })
  }

  // Despesas por categoria (mês atual) — mesmo critério temporal
  const categoriasDespesas = await c.env.DB.prepare(
    `SELECT categoria, COALESCE(SUM(valor), 0) as total FROM despesas 
     WHERE user_id = ?
       AND CASE WHEN status = 'pago'
                THEN strftime('%m', data) = ? AND strftime('%Y', data) = ?
                ELSE strftime('%m', COALESCE(vencimento, data)) = ?
                 AND strftime('%Y', COALESCE(vencimento, data)) = ?
           END
     GROUP BY categoria ORDER BY total DESC LIMIT 8`
  ).bind(user.id, mes, ano, mes, ano).all()

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
  const totalInvestido = totalInvestimentos?.investido || 0

  // Totais de dívidas
  const totalSaldoEmprestimos = parseFloat(emprestimosAtivos?.total_saldo_devedor || 0)
  const totalSaldoFinanciamentos = parseFloat(financiamentosAtivos?.total_saldo_devedor || 0)
  const totalDevedor = totalSaldoEmprestimos + totalSaldoFinanciamentos

  // === 2.1: Cálculo de Patrimônio Bruto e Líquido ===
  const totalReservasEsp = parseFloat(reservasEspTotal?.total || 0)
  const totalReservaLegado = parseFloat(reservaLegadoTotal?.total || 0)
  const totalReservas = totalReservasEsp + totalReservaLegado
  // Patrimônio Bruto = investimentos (a valor de mercado) + reservas
  const patrimonioBruto = parseFloat(totalInvest as any) + totalReservas
  // Patrimônio Líquido = Bruto - total dívidas (saldo devedor)
  const patrimonioLiquido = patrimonioBruto - totalDevedor

  // === MELHORIA 2.1: Cálculo de Patrimônio ===
  const totalReservasEsp = parseFloat(reservasEsp?.total || 0)
  const metaReservasEsp = parseFloat(reservasEsp?.meta || 0)
  // Patrimônio bruto = investimentos (valor atual de mercado) + reservas especializadas
  const patrimonioBruto = totalInvest + totalReservasEsp
  // Patrimônio líquido = patrimônio bruto - todas as dívidas
  const patrimonioLiquido = patrimonioBruto - totalDevedor
  const progressoReservas = metaReservasEsp > 0 ? Math.round((totalReservasEsp / metaReservasEsp) * 100) : 0
  // Comprometimento real = parcelas de empréstimos + parcelas de financiamentos + fatura de cartão do mês
  const parcelasEmpFin = (emprestimosAtivos?.total_parcela_mensal || 0) + (financiamentosAtivos?.total_parcela_mensal || 0)
  const faturaCartaoMes = faturaCartoesMes?.total || 0
  const totalParcelaMensal = parcelasEmpFin + faturaCartaoMes

  // ===== SCORE DE SAÚDE FINANCEIRA com fatores detalhados =====
  let score = 50
  const fatoresScore: { tipo: 'positivo' | 'negativo' | 'neutro'; descricao: string; pontos: number }[] = []

  if (totalReceitas > 0) {
    const taxaPoupanca = (saldoLiquido / totalReceitas) * 100
    const comprometimento = (totalParcelaMensal / totalReceitas) * 100

    // Fator: taxa de poupança
    if (taxaPoupanca >= 20) {
      score += 20
      fatoresScore.push({ tipo: 'positivo', descricao: `Taxa de poupança excelente (${taxaPoupanca.toFixed(1)}%)`, pontos: 20 })
    } else if (taxaPoupanca >= 10) {
      score += 10
      fatoresScore.push({ tipo: 'positivo', descricao: `Boa taxa de poupança (${taxaPoupanca.toFixed(1)}%)`, pontos: 10 })
    } else if (taxaPoupanca >= 0) {
      fatoresScore.push({ tipo: 'neutro', descricao: `Taxa de poupança baixa (${taxaPoupanca.toFixed(1)}%) — tente poupar ao menos 10%`, pontos: 0 })
    } else {
      score -= 20
      fatoresScore.push({ tipo: 'negativo', descricao: `Gastos maiores que receitas (${Math.abs(taxaPoupanca).toFixed(1)}% no vermelho)`, pontos: -20 })
    }

    // Fator: saldo positivo
    if (saldoLiquido > 0) {
      score += 5
      fatoresScore.push({ tipo: 'positivo', descricao: 'Saldo do mês no positivo', pontos: 5 })
    }

    // Fator: investimentos
    if (totalInvest > 0) {
      score += 10
      fatoresScore.push({ tipo: 'positivo', descricao: 'Você está investindo seu dinheiro', pontos: 10 })
    } else {
      fatoresScore.push({ tipo: 'neutro', descricao: 'Nenhum investimento cadastrado — comece com a Caixinha CDI', pontos: 0 })
    }

    // Fator: metas
    if ((metasAtivas as any)?.count > 0) {
      score += 5
      fatoresScore.push({ tipo: 'positivo', descricao: `${(metasAtivas as any).count} meta(s) ativa(s) — você está planejando o futuro`, pontos: 5 })
    } else {
      fatoresScore.push({ tipo: 'neutro', descricao: 'Nenhuma meta financeira cadastrada', pontos: 0 })
    }

    // Fator: comprometimento de dívidas (empréstimos + financiamentos + fatura de cartão)
    if (comprometimento > 50) {
      score -= 25
      fatoresScore.push({ tipo: 'negativo', descricao: `Comprometimento crítico: dívidas consomem ${comprometimento.toFixed(0)}% da renda (limite saudável: 30%)`, pontos: -25 })
    } else if (comprometimento > 30) {
      score -= 15
      fatoresScore.push({ tipo: 'negativo', descricao: `Dívidas comprometem ${comprometimento.toFixed(0)}% da renda (limite saudável: 30%)`, pontos: -15 })
    } else if (comprometimento > 20) {
      score -= 8
      fatoresScore.push({ tipo: 'negativo', descricao: `Dívidas comprometem ${comprometimento.toFixed(0)}% da renda — atenção`, pontos: -8 })
    } else if (comprometimento > 0) {
      fatoresScore.push({ tipo: 'neutro', descricao: `Dívidas comprometem ${comprometimento.toFixed(0)}% da renda — dentro do limite`, pontos: 0 })
    } else if (totalDevedor === 0) {
      score += 10
      fatoresScore.push({ tipo: 'positivo', descricao: 'Sem dívidas ativas — excelente!', pontos: 10 })
    }
  } else {
    fatoresScore.push({ tipo: 'neutro', descricao: 'Cadastre receitas para calcular seu score completo', pontos: 0 })
  }
  score = Math.min(100, Math.max(0, score))

  const lim = getLimites(user.plano)

  return c.json({
    resumo: {
      total_receitas: totalReceitas,
      total_despesas: totalDespesas,
      saldo_liquido: saldoLiquido,
      total_investimentos: totalInvest,
      total_investido: totalInvestido,
      percentual_investido: totalReceitas > 0 ? Math.round((totalInvest / totalReceitas) * 100) : 0,
      taxa_poupanca: totalReceitas > 0 ? Math.round(((saldoLiquido / totalReceitas) * 100) * 10) / 10 : 0,
      total_devedor: totalDevedor,
      total_saldo_emprestimos: totalSaldoEmprestimos,
      total_saldo_financiamentos: totalSaldoFinanciamentos,
      total_parcela_mensal_dividas: totalParcelaMensal,
      parcelas_emp_fin: parcelasEmpFin,
      fatura_cartao_mes: faturaCartaoMes,
      comprometimento_dividas_pct: totalReceitas > 0 ? Math.round((totalParcelaMensal / totalReceitas) * 100) : 0,
      count_emprestimos_ativos: emprestimosAtivos?.count || 0,
      count_financiamentos_ativos: financiamentosAtivos?.count || 0,
      // === MELHORIA 2.1: Patrimônio ===
      patrimonio_bruto: Math.round(patrimonioBruto * 100) / 100,
      patrimonio_liquido: Math.round(patrimonioLiquido * 100) / 100,
      total_reservas_esp: Math.round(totalReservasEsp * 100) / 100,
      meta_reservas_esp: Math.round(metaReservasEsp * 100) / 100,
      progresso_reservas_pct: progressoReservas
    },
    // Score e fatores: disponível apenas para Premium/Pro
    score_saude: lim.score_saude ? score : null,
    fatores_score: lim.score_saude ? fatoresScore : null,
    score_bloqueado: !lim.score_saude,
    plano: user.plano,
    limites: {
      metas: lim.metas,
      cartoes: lim.cartoes,
      lembretes: lim.lembretes,
      investimentos: lim.investimentos,
      emprestimos: lim.emprestimos,
      financiamentos: lim.financiamentos,
      despesas_mes: lim.despesas_mes,
      receitas_mes: lim.receitas_mes,
      score_saude: lim.score_saude,
      ia_insights: lim.ia_insights,
      relatorio_anual: lim.relatorio_anual,
      simulacao: lim.simulacao,
      exportar_pdf: lim.exportar_pdf,
      amortizacao: lim.amortizacao,
    },
    metas: {
      ativas: (metasAtivas as any)?.count || 0,
      objetivo_total: (metasAtivas as any)?.objetivo_total || 0,
      atual_total: (metasAtivas as any)?.atual_total || 0
    },
    // === NOVOS BLOCOS DE DÍVIDAS ===
    emprestimos: {
      count: emprestimosAtivos?.count || 0,
      total_saldo_devedor: totalSaldoEmprestimos,
      total_parcela_mensal: emprestimosAtivos?.total_parcela_mensal || 0,
      total_valor_original: emprestimosAtivos?.total_valor_original || 0
    },
    financiamentos: {
      count: financiamentosAtivos?.count || 0,
      total_saldo_devedor: totalSaldoFinanciamentos,
      total_parcela_mensal: financiamentosAtivos?.total_parcela_mensal || 0,
      total_valor_financiado: financiamentosAtivos?.total_valor_financiado || 0
    },
    // === MELHORIA 2.1: Novos Cards ===
    reservas_esp: {
      count: reservasEsp?.count || 0,
      concluidas: reservasEsp?.concluidas || 0,
      total_guardado: Math.round(totalReservasEsp * 100) / 100,
      meta_total: Math.round(metaReservasEsp * 100) / 100,
      progresso_pct: progressoReservas
    },
    alerta_assinaturas: {
      total_detectadas: assinaturasAlerta?.total || 0,
      custo_mensal_estimado: Math.round(parseFloat(assinaturasAlerta?.custo_mensal || 0) * 100) / 100,
      tem_alerta: (assinaturasAlerta?.total || 0) > 0
    },
    desafio_52: {
      concluidas: desafio52?.concluidas || 0,
      total_semanas: desafio52?.total_semanas || 0,
      puladas: desafio52?.puladas || 0,
      valor_guardado: desafio52?.valor_guardado || 0,
      progresso_pct: desafio52?.total_semanas > 0 ? Math.round((desafio52.concluidas / 52) * 100) : 0
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

  // Verifica plano para relatório anual
  const lim = getLimites(user.plano)
  if (!lim.relatorio_anual) {
    return c.json({ error: MSG_UPGRADE.relatorio_anual, upgrade: true, feature: 'relatorio_anual' }, 403)
  }

  // Conquista: analista financeiro (acessou o relatório)
  try {
    await c.env.DB.prepare('INSERT OR IGNORE INTO conquistas_usuario (user_id, conquista_codigo, visualizado) VALUES (?, ?, 0)').bind(user.id, 'analista').run()
  } catch {}

  const mesesNomes = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']
  const relatorio = []

  for (let i = 0; i < 12; i++) {
    const m = String(i + 1).padStart(2, '0')

    const rec = await c.env.DB.prepare(
      `SELECT COALESCE(SUM(valor), 0) as total FROM receitas WHERE user_id = ? AND strftime('%m', data) = ? AND strftime('%Y', data) = ?`
    ).bind(user.id, m, ano).first() as any

    const desp = await c.env.DB.prepare(
      `SELECT COALESCE(SUM(valor), 0) as total FROM despesas 
       WHERE user_id = ?
         AND CASE WHEN status = 'pago'
                  THEN strftime('%m', data) = ? AND strftime('%Y', data) = ?
                  ELSE strftime('%m', COALESCE(vencimento, data)) = ?
                   AND strftime('%Y', COALESCE(vencimento, data)) = ?
             END`
    ).bind(user.id, m, ano, m, ano).first() as any

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

  // === NOVO: Resumo anual de dívidas ===
  const emprestimosAnuais = await c.env.DB.prepare(
    `SELECT COALESCE(SUM(saldo_devedor), 0) as saldo, COALESCE(SUM(valor_parcela), 0) as parcela
     FROM emprestimos WHERE user_id = ? AND status = 'ativo'`
  ).bind(user.id).first() as any

  const financiamentosAnuais = await c.env.DB.prepare(
    `SELECT COALESCE(SUM(saldo_devedor), 0) as saldo, COALESCE(SUM(valor_parcela), 0) as parcela
     FROM financiamentos WHERE user_id = ? AND status = 'ativo'`
  ).bind(user.id).first() as any

  // === NOVO: Resumo de metas ===
  const metasResumo = await c.env.DB.prepare(
    `SELECT 
       COUNT(*) as total_metas,
       COALESCE(SUM(CASE WHEN status='ativa' THEN 1 ELSE 0 END), 0) as ativas,
       COALESCE(SUM(CASE WHEN status='concluida' THEN 1 ELSE 0 END), 0) as concluidas,
       COALESCE(SUM(valor_objetivo), 0) as total_objetivo,
       COALESCE(SUM(valor_atual), 0) as total_atual
     FROM metas WHERE user_id = ?`
  ).bind(user.id).first() as any

  // === NOVO: Resumo de investimentos ===
  const investResumo = await c.env.DB.prepare(
    `SELECT 
       COUNT(*) as total,
       COALESCE(SUM(valor_investido), 0) as total_investido,
       COALESCE(SUM(valor_atual), 0) as total_atual
     FROM investimentos WHERE user_id = ?`
  ).bind(user.id).first() as any

  return c.json({
    ano,
    relatorio,
    totais: {
      receitas: totalAnualReceitas,
      despesas: totalAnualDespesas,
      saldo: totalAnualReceitas - totalAnualDespesas
    },
    dividas: {
      total_devedor: (emprestimosAnuais?.saldo || 0) + (financiamentosAnuais?.saldo || 0),
      emprestimos_saldo: emprestimosAnuais?.saldo || 0,
      emprestimos_parcela_mensal: emprestimosAnuais?.parcela || 0,
      financiamentos_saldo: financiamentosAnuais?.saldo || 0,
      financiamentos_parcela_mensal: financiamentosAnuais?.parcela || 0,
      total_parcela_mensal: (emprestimosAnuais?.parcela || 0) + (financiamentosAnuais?.parcela || 0)
    },
    metas: metasResumo,
    investimentos: investResumo
  })
})

export default dashboard
