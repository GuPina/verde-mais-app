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

  // ── M2: batch das queries principais (1 round-trip ao D1) ──────────────────
  const [
    receitasMesR,
    despesasMesR,
    despesasStatusR,
    totalInvestimentosR,
    metasAtivasR,
    emprestimosAtivosR,
    financiamentosAtivosR,
    reservasEspTotalR,
    reservaLegadoTotalR,
    assinaturasAlertaR,
    desafioProgressoR,
    faturaCartoesMesR,
    categoriasDespesasR,
    categoriasReceitasR,
    ultimasTransacoesR,
    proximosVencimentosR,
  ] = await c.env.DB.batch([
    // receitas do mês
    c.env.DB.prepare(
      `SELECT COALESCE(SUM(valor), 0) as total FROM receitas 
       WHERE user_id = ? AND strftime('%m', data) = ? AND strftime('%Y', data) = ?`
    ).bind(user.id, mes, ano),
    // despesas do mês (sem aportes)
    c.env.DB.prepare(
      `SELECT COALESCE(SUM(valor), 0) as total FROM despesas 
       WHERE user_id = ?
         AND COALESCE(tipo,'normal') != 'aporte'
         AND COALESCE(eh_aporte_patrimonial, 0) = 0
         AND CASE WHEN status = 'pago'
                  THEN strftime('%m', data) = ? AND strftime('%Y', data) = ?
                  ELSE strftime('%m', COALESCE(vencimento, data)) = ?
                   AND strftime('%Y', COALESCE(vencimento, data)) = ?
             END`
    ).bind(user.id, mes, ano, mes, ano),
    // despesas por status
    c.env.DB.prepare(
      `SELECT status, COALESCE(SUM(valor), 0) as total FROM despesas 
       WHERE user_id = ?
         AND COALESCE(tipo,'normal') != 'aporte'
         AND COALESCE(eh_aporte_patrimonial, 0) = 0
         AND CASE WHEN status = 'pago'
                  THEN strftime('%m', data) = ? AND strftime('%Y', data) = ?
                  ELSE strftime('%m', COALESCE(vencimento, data)) = ?
                   AND strftime('%Y', COALESCE(vencimento, data)) = ?
             END
       GROUP BY status`
    ).bind(user.id, mes, ano, mes, ano),
    // total investimentos
    c.env.DB.prepare(
      `SELECT COALESCE(SUM(valor_atual), 0) as total, COALESCE(SUM(valor_investido), 0) as investido FROM investimentos WHERE user_id = ?`
    ).bind(user.id),
    // metas ativas
    c.env.DB.prepare(
      `SELECT COUNT(*) as count, COALESCE(SUM(valor_objetivo), 0) as objetivo_total, 
       COALESCE(SUM(valor_atual), 0) as atual_total FROM metas WHERE user_id = ? AND status = 'ativa'`
    ).bind(user.id),
    // empréstimos ativos
    c.env.DB.prepare(
      `SELECT COUNT(*) as count, COALESCE(SUM(saldo_devedor), 0) as total_saldo_devedor,
       COALESCE(SUM(valor_parcela), 0) as total_parcela_mensal,
       COALESCE(SUM(valor_original), 0) as total_valor_original
       FROM emprestimos WHERE user_id = ? AND status = 'ativo'`
    ).bind(user.id),
    // financiamentos ativos
    c.env.DB.prepare(
      `SELECT COUNT(*) as count, COALESCE(SUM(saldo_devedor), 0) as total_saldo_devedor,
       COALESCE(SUM(valor_parcela), 0) as total_parcela_mensal,
       COALESCE(SUM(valor_financiado), 0) as total_valor_financiado
       FROM financiamentos WHERE user_id = ? AND status = 'ativo'`
    ).bind(user.id),
    // reservas especializadas total
    c.env.DB.prepare(
      `SELECT COALESCE(SUM(current_amount), 0) as total FROM specialized_reserves WHERE user_id = ? AND status IN ('active','completed')`
    ).bind(user.id),
    // reserva legado (emergência)
    c.env.DB.prepare(
      `SELECT COALESCE(valor_atual, 0) as total FROM reserva_emergencia WHERE user_id = ? ORDER BY id DESC LIMIT 1`
    ).bind(user.id),
    // assinaturas fantasma
    c.env.DB.prepare(
      `SELECT COUNT(*) as cnt, COALESCE(SUM(amount),0) as total_mensal
       FROM detected_subscriptions WHERE user_id = ? AND user_feedback IS NULL`
    ).bind(user.id),
    // desafio 52 semanas
    c.env.DB.prepare(
      `SELECT COUNT(*) as total, SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) as concluidas,
       SUM(CASE WHEN status='completed' THEN week_number ELSE 0 END) as valor_acumulado
       FROM weekly_challenges WHERE user_id = ? AND year = ?`
    ).bind(user.id, ano),
    // fatura cartões mês
    c.env.DB.prepare(
      `SELECT COALESCE(SUM(cc.valor), 0) as total
       FROM card_charges cc JOIN cartoes c ON cc.card_id = c.id
       WHERE c.user_id = ? AND cc.billing_month = ? AND cc.billing_year = ? AND cc.status = 'pendente'`
    ).bind(user.id, parseInt(mes), parseInt(ano)),
    // categorias despesas
    c.env.DB.prepare(
      `SELECT categoria, COALESCE(SUM(valor), 0) as total FROM despesas 
       WHERE user_id = ?
         AND CASE WHEN status = 'pago'
                  THEN strftime('%m', data) = ? AND strftime('%Y', data) = ?
                  ELSE strftime('%m', COALESCE(vencimento, data)) = ?
                   AND strftime('%Y', COALESCE(vencimento, data)) = ?
             END
       GROUP BY categoria ORDER BY total DESC LIMIT 8`
    ).bind(user.id, mes, ano, mes, ano),
    // categorias receitas
    c.env.DB.prepare(
      `SELECT categoria, COALESCE(SUM(valor), 0) as total FROM receitas 
       WHERE user_id = ? AND strftime('%m', data) = ? AND strftime('%Y', data) = ?
       GROUP BY categoria ORDER BY total DESC LIMIT 6`
    ).bind(user.id, mes, ano),
    // últimas transações
    c.env.DB.prepare(
      `SELECT 'receita' as tipo, id, descricao, data, categoria, valor, 'pago' as status FROM receitas WHERE user_id = ?
       UNION ALL
       SELECT 'despesa' as tipo, id, descricao, data, categoria, valor, status FROM despesas WHERE user_id = ?
       ORDER BY data DESC, id DESC LIMIT 10`
    ).bind(user.id, user.id),
    // próximos vencimentos
    c.env.DB.prepare(
      `SELECT * FROM despesas WHERE user_id = ? AND status = 'pendente' 
       AND vencimento BETWEEN date('now') AND date('now', '+7 days')
       ORDER BY vencimento ASC LIMIT 5`
    ).bind(user.id),
  ])

  const receitasMes        = receitasMesR.results?.[0]        ?? receitasMesR as any
  const despesasMes        = despesasMesR.results?.[0]        ?? despesasMesR as any
  const despesasStatus     = despesasStatusR
  const totalInvestimentos = totalInvestimentosR.results?.[0] ?? totalInvestimentosR as any
  const metasAtivas        = metasAtivasR.results?.[0]        ?? metasAtivasR as any
  const emprestimosAtivos  = emprestimosAtivosR.results?.[0]  ?? emprestimosAtivosR as any
  const financiamentosAtivos = financiamentosAtivosR.results?.[0] ?? financiamentosAtivosR as any
  const reservasEspTotal   = reservasEspTotalR.results?.[0]   ?? reservasEspTotalR as any
  const reservaLegadoTotal = reservaLegadoTotalR.results?.[0] ?? reservaLegadoTotalR as any
  const assinaturasAlerta  = assinaturasAlertaR.results?.[0]  ?? assinaturasAlertaR as any
  const desafioProgresso   = desafioProgressoR.results?.[0]   ?? desafioProgressoR as any
  const faturaCartoesMes   = faturaCartoesMesR.results?.[0]   ?? faturaCartoesMesR as any
  const categoriasDespesas = categoriasDespesasR
  const categoriasReceitas = categoriasReceitasR
  const ultimasTransacoes  = ultimasTransacoesR
  const proximosVencimentos = proximosVencimentosR

  const totalReceitas = Math.round((receitasMes?.total || 0) * 100) / 100
  const totalDespesas = Math.round((despesasMes?.total || 0) * 100) / 100
  const saldoLiquido = Math.round((totalReceitas - totalDespesas) * 100) / 100
  const totalInvest = Math.round((totalInvestimentos?.total || 0) * 100) / 100
  const totalInvestido = Math.round((totalInvestimentos?.investido || 0) * 100) / 100

  // Totais de dívidas
  const totalSaldoEmprestimos = Math.round(parseFloat(emprestimosAtivos?.total_saldo_devedor || 0) * 100) / 100
  const totalSaldoFinanciamentos = Math.round(parseFloat(financiamentosAtivos?.total_saldo_devedor || 0) * 100) / 100
  const totalDevedor = Math.round((totalSaldoEmprestimos + totalSaldoFinanciamentos) * 100) / 100

  // === 2.1: Cálculo de Patrimônio Bruto e Líquido ===
  const totalReservasEsp = parseFloat(reservasEspTotal?.total || 0)
  const totalReservaLegado = parseFloat(reservaLegadoTotal?.total || 0)
  const totalReservas = totalReservasEsp + totalReservaLegado

  // ── M2: batch evolução 6 meses + meta reservas (1 round-trip) ──────────────
  const evolucaoMeses: { m: string; a: string; label: string }[] = []
  for (let i = 5; i >= 0; i--) {
    const d = new Date(); d.setMonth(d.getMonth() - i)
    const meses = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez']
    evolucaoMeses.push({
      m: String(d.getMonth() + 1).padStart(2, '0'),
      a: String(d.getFullYear()),
      label: meses[d.getMonth()]
    })
  }

  const evolucaoBatch = await c.env.DB.batch([
    c.env.DB.prepare(
      `SELECT COALESCE(SUM(target_amount), 0) as meta FROM specialized_reserves WHERE user_id = ? AND status IN ('active','completed')`
    ).bind(user.id),
    ...evolucaoMeses.flatMap(({ m, a }) => [
      c.env.DB.prepare(
        `SELECT COALESCE(SUM(valor), 0) as total FROM receitas WHERE user_id = ? AND strftime('%m', data) = ? AND strftime('%Y', data) = ?`
      ).bind(user.id, m, a),
      c.env.DB.prepare(
        `SELECT COALESCE(SUM(valor), 0) as total FROM despesas 
         WHERE user_id = ?
           AND CASE WHEN status = 'pago'
                    THEN strftime('%m', data) = ? AND strftime('%Y', data) = ?
                    ELSE strftime('%m', COALESCE(vencimento, data)) = ?
                     AND strftime('%Y', COALESCE(vencimento, data)) = ?
               END`
      ).bind(user.id, m, a, m, a),
    ])
  ])

  const metaReservasEsp = parseFloat((evolucaoBatch[0].results?.[0] as any)?.meta || 0)
  const progressoReservas = metaReservasEsp > 0 ? Math.round((totalReservasEsp / metaReservasEsp) * 100) : 0

  const evolucao = evolucaoMeses.map((item, i) => {
    const rec  = Math.round(((evolucaoBatch[1 + i * 2].results?.[0] as any)?.total || 0) * 100) / 100
    const desp = Math.round(((evolucaoBatch[2 + i * 2].results?.[0] as any)?.total || 0) * 100) / 100
    return { mes: item.label, ano: item.a, receitas: rec, despesas: desp, saldo: Math.round((rec - desp) * 100) / 100 }
  })

  // Patrimônio Bruto = investimentos (a valor de mercado) + reservas
  const patrimonioBruto = parseFloat(totalInvest as any) + totalReservas
  // Patrimônio Líquido = Bruto - total dívidas (saldo devedor)
  const patrimonioLiquido = patrimonioBruto - totalDevedor
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

  // Bloco 4.2: Top 5 Tags por gastos do mês (widget "Gastos por Tag")
  const topTagsResult = await c.env.DB.prepare(`
    SELECT t.nome, t.cor, COALESCE(SUM(d.valor), 0) as total, COUNT(DISTINCT d.id) as qtd
    FROM despesa_tags dt
    JOIN tags t ON t.id = dt.tag_id
    JOIN despesas d ON d.id = dt.despesa_id
    WHERE d.user_id = ?
      AND COALESCE(d.tipo,'normal') != 'aporte'
      AND COALESCE(d.eh_aporte_patrimonial, 0) = 0
      AND CASE WHEN d.status = 'pago'
               THEN strftime('%m', d.data) = ? AND strftime('%Y', d.data) = ?
               ELSE strftime('%m', COALESCE(d.vencimento, d.data)) = ?
                AND strftime('%Y', COALESCE(d.vencimento, d.data)) = ?
           END
    GROUP BY t.id, t.nome, t.cor
    ORDER BY total DESC
    LIMIT 5
  `).bind(user.id, mes, ano, mes, ano).all()
  const topTags = topTagsResult.results || []

  // Bloco 5: conquistas saude_ferro, score_50/70/80
  try {
    if (score >= 90) {
      await c.env.DB.prepare(`INSERT OR IGNORE INTO conquistas_usuario (user_id, conquista_codigo, data_conquista, visualizado) VALUES (?, 'saude_ferro', datetime('now'), 0)`).bind(user.id).run().catch(() => {})
    }
    if (score >= 80) {
      await c.env.DB.prepare(`INSERT OR IGNORE INTO conquistas_usuario (user_id, conquista_codigo, data_conquista, visualizado) VALUES (?, 'score_80', datetime('now'), 0)`).bind(user.id).run().catch(() => {})
    }
    if (score >= 70) {
      await c.env.DB.prepare(`INSERT OR IGNORE INTO conquistas_usuario (user_id, conquista_codigo, data_conquista, visualizado) VALUES (?, 'score_70', datetime('now'), 0)`).bind(user.id).run().catch(() => {})
    }
    if (score >= 50) {
      await c.env.DB.prepare(`INSERT OR IGNORE INTO conquistas_usuario (user_id, conquista_codigo, data_conquista, visualizado) VALUES (?, 'score_50', datetime('now'), 0)`).bind(user.id).run().catch(() => {})
    }
  } catch(_) {}

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
    // B1-fix: score_saude como objeto {score, fatores} para compatibilidade com frontend
    score_saude: lim.score_saude ? score : null,
    fatores_score: lim.score_saude ? fatoresScore : null,
    score_bloqueado: !lim.score_saude,
    // Alias para frontend que consome como objeto
    score_saude_obj: lim.score_saude
      ? { score, fatores: fatoresScore }
      : { score: null, fatores: [] },
    plano: user.plano,
    limites: {
      // B5-fix: Infinity não é serializável em JSON — converter para -1 (sem limite)
      metas:           lim.metas          === Infinity ? -1 : lim.metas,
      cartoes:         lim.cartoes        === Infinity ? -1 : lim.cartoes,
      lembretes:       lim.lembretes      === Infinity ? -1 : lim.lembretes,
      investimentos:   lim.investimentos  === Infinity ? -1 : lim.investimentos,
      emprestimos:     lim.emprestimos    === Infinity ? -1 : lim.emprestimos,
      financiamentos:  lim.financiamentos === Infinity ? -1 : lim.financiamentos,
      despesas_mes:    lim.despesas_mes   === Infinity ? -1 : lim.despesas_mes,
      receitas_mes:    lim.receitas_mes   === Infinity ? -1 : lim.receitas_mes,
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
    // === 2.1: Novos Cards — Reservas Especializadas ===
    reservas_esp: {
      total_guardado: Math.round(totalReservasEsp * 100) / 100,
      total_reserva_legado: Math.round(totalReservaLegado * 100) / 100,
      meta_total: Math.round(metaReservasEsp * 100) / 100,
      progresso_pct: progressoReservas
    },
    // === 2.1: Card — Alerta de Assinaturas Fantasma ===
    alerta_assinaturas: {
      count_nao_avaliadas: assinaturasAlerta?.cnt || 0,
      custo_mensal_estimado: Math.round(parseFloat(assinaturasAlerta?.total_mensal || 0) * 100) / 100,
      tem_alerta: (assinaturasAlerta?.cnt || 0) > 0
    },
    // === 2.1: Card — Progresso Desafio 52 Semanas ===
    desafio_52: {
      total_semanas: desafioProgresso?.total || 0,
      concluidas: desafioProgresso?.concluidas || 0,
      valor_acumulado: desafioProgresso?.valor_acumulado || 0,
      meta_anual: 1378,
      progresso_pct: desafioProgresso?.total > 0
        ? Math.round(((desafioProgresso?.concluidas || 0) / 52) * 100)
        : 0
    },
    evolucao,
    evolucao_6meses: evolucao,  // B3-fix: alias para compatibilidade com frontend
    categorias_despesas: categoriasDespesas.results,
    categorias_receitas: categoriasReceitas.results,
    ultimas_transacoes: ultimasTransacoes.results,
    proximos_vencimentos: proximosVencimentos.results,
    despesas_status: despesasStatus.results,
    top_tags: topTags,  // Bloco 4.2: widget Gastos por Tag
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

  // ── M2: batch relatório anual — 24 queries mensais + 4 resumos (1 round-trip) ──
  const mesesPadded = Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, '0'))

  const relatorioBatch = await c.env.DB.batch([
    // empréstimos anuais
    c.env.DB.prepare(
      `SELECT COALESCE(SUM(saldo_devedor), 0) as saldo, COALESCE(SUM(valor_parcela), 0) as parcela
       FROM emprestimos WHERE user_id = ? AND status = 'ativo'`
    ).bind(user.id),
    // financiamentos anuais
    c.env.DB.prepare(
      `SELECT COALESCE(SUM(saldo_devedor), 0) as saldo, COALESCE(SUM(valor_parcela), 0) as parcela
       FROM financiamentos WHERE user_id = ? AND status = 'ativo'`
    ).bind(user.id),
    // metas resumo
    c.env.DB.prepare(
      `SELECT COUNT(*) as total_metas,
         COALESCE(SUM(CASE WHEN status='ativa' THEN 1 ELSE 0 END), 0) as ativas,
         COALESCE(SUM(CASE WHEN status='concluida' THEN 1 ELSE 0 END), 0) as concluidas,
         COALESCE(SUM(valor_objetivo), 0) as total_objetivo,
         COALESCE(SUM(valor_atual), 0) as total_atual
       FROM metas WHERE user_id = ?`
    ).bind(user.id),
    // investimentos resumo
    c.env.DB.prepare(
      `SELECT COUNT(*) as total, COALESCE(SUM(valor_investido), 0) as total_investido,
         COALESCE(SUM(valor_atual), 0) as total_atual
       FROM investimentos WHERE user_id = ?`
    ).bind(user.id),
    // top categorias do ano
    c.env.DB.prepare(
      `SELECT categoria, COALESCE(SUM(valor), 0) as total, COUNT(*) as qtd
       FROM despesas
       WHERE user_id = ? AND strftime('%Y', COALESCE(vencimento, data)) = ?
         AND COALESCE(tipo,'normal') != 'aporte'
         AND COALESCE(eh_aporte_patrimonial, 0) = 0
       GROUP BY categoria ORDER BY total DESC LIMIT 8`
    ).bind(user.id, ano),
    // receitas e despesas de cada mês (12 × 2 = 24 queries)
    ...mesesPadded.flatMap(m => [
      c.env.DB.prepare(
        `SELECT COALESCE(SUM(valor), 0) as total FROM receitas WHERE user_id = ? AND strftime('%m', data) = ? AND strftime('%Y', data) = ?`
      ).bind(user.id, m, ano),
      c.env.DB.prepare(
        `SELECT COALESCE(SUM(valor), 0) as total FROM despesas 
         WHERE user_id = ?
           AND CASE WHEN status = 'pago'
                    THEN strftime('%m', data) = ? AND strftime('%Y', data) = ?
                    ELSE strftime('%m', COALESCE(vencimento, data)) = ?
                     AND strftime('%Y', COALESCE(vencimento, data)) = ?
               END`
      ).bind(user.id, m, ano, m, ano),
    ])
  ])

  const emprestimosAnuais   = relatorioBatch[0].results?.[0] as any
  const financiamentosAnuais = relatorioBatch[1].results?.[0] as any
  const metasResumo         = relatorioBatch[2].results?.[0] as any
  const investResumo        = relatorioBatch[3].results?.[0] as any
  const top_categorias      = relatorioBatch[4].results || []

  const relatorio = mesesPadded.map((_, i) => {
    const rec  = (relatorioBatch[5 + i * 2].results?.[0] as any)?.total || 0
    const desp = (relatorioBatch[6 + i * 2].results?.[0] as any)?.total || 0
    return { mes: mesesNomes[i], numero_mes: i + 1, receitas: rec, despesas: desp, saldo: rec - desp }
  })

  const totalAnualReceitas = relatorio.reduce((sum, m) => sum + m.receitas, 0)
  const totalAnualDespesas = relatorio.reduce((sum, m) => sum + m.despesas, 0)

  return c.json({
    ano,
    relatorio,
    totais: {
      receitas: totalAnualReceitas,
      despesas: totalAnualDespesas,
      saldo: totalAnualReceitas - totalAnualDespesas
    },
    top_categorias,
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
