import { Hono } from 'hono'
import { requireAuth } from './auth'
import { getLimites, podeUsar, MSG_UPGRADE } from './planos'
import { competenciaData, competenciaMes, filtroDespesaDoMes, filtroDespesaDoAno, filtroNaoCancelada, filtroSemAporte } from '../lib/competencia'
import { classificarObrigacoesTemporais, calcularEconomiaAmortizacao } from '../utils/obrigacoes-temporais'

type Bindings = { DB: D1Database }
type Variables = { user: { id: number; nome: string; email: string; plano: string } }

const dashboard = new Hono<{ Bindings: Bindings; Variables: Variables }>()

// GET /api/dashboard
dashboard.get('/', requireAuth, async (c) => {
  const user = c.get('user')
  const now = new Date()
  // Suporte a filtro de mês/ano via query string (?mes=04&ano=2026)
  const qMes = c.req.query('mes')
  const qAno = c.req.query('ano')
  const mes = qMes ? String(qMes).padStart(2, '0') : String(now.getMonth() + 1).padStart(2, '0')
  const ano = qAno ? String(qAno) : String(now.getFullYear())
  if (!/^(0[1-9]|1[0-2])$/.test(mes) || !/^\d{4}$/.test(ano)) {
    return c.json({ error: 'Período inválido. Informe mês entre 1 e 12 e ano com 4 dígitos.' }, 400)
  }
  // Mês anterior para comparativo
  const refDate = new Date(parseInt(ano), parseInt(mes) - 1, 1)
  refDate.setMonth(refDate.getMonth() - 1)
  const mesAnt = String(refDate.getMonth() + 1).padStart(2, '0')
  const anoAnt = String(refDate.getFullYear())

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
    receitasAntR,
    despesasAntR,
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
         ${filtroDespesaDoMes()}`
    ).bind(user.id, mes, ano),
    // despesas por status
    c.env.DB.prepare(
      `SELECT status, COALESCE(SUM(valor), 0) as total FROM despesas 
       WHERE user_id = ?
         ${filtroDespesaDoMes()}
       GROUP BY status`
    ).bind(user.id, mes, ano),
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
         ${filtroDespesaDoMes()}
       GROUP BY categoria ORDER BY total DESC LIMIT 8`
    ).bind(user.id, mes, ano),
    // categorias receitas
    c.env.DB.prepare(
      `SELECT categoria, COALESCE(SUM(valor), 0) as total FROM receitas 
       WHERE user_id = ? AND strftime('%m', data) = ? AND strftime('%Y', data) = ?
       GROUP BY categoria ORDER BY total DESC LIMIT 6`
    ).bind(user.id, mes, ano),
    // últimas transações do período selecionado, sem antecipar parcelas futuras
    c.env.DB.prepare(
      `SELECT 'receita' as tipo, id, descricao, data, categoria, valor, 'pago' as status
       FROM receitas
       WHERE user_id = ? AND strftime('%m', data) = ? AND strftime('%Y', data) = ? AND date(data) <= date('now')
       UNION ALL
       SELECT 'despesa' as tipo, id, descricao, (${competenciaData()}) as data, categoria, valor, status
       FROM despesas
       WHERE user_id = ?
         ${filtroDespesaDoMes()}
         AND date(${competenciaData()}) <= date('now')
       ORDER BY data DESC, id DESC LIMIT 10`
    ).bind(user.id, mes, ano, user.id, mes, ano),
    // próximos vencimentos
    c.env.DB.prepare(
      `SELECT id, descricao, categoria, valor, vencimento, status, meio_pagamento FROM despesas WHERE user_id = ? AND status = 'pendente' 
       AND vencimento BETWEEN date('now') AND date('now', '+7 days')
       ORDER BY vencimento ASC LIMIT 5`
    ).bind(user.id),
    // receitas mês anterior (comparativo)
    c.env.DB.prepare(
      `SELECT COALESCE(SUM(valor), 0) as total FROM receitas 
       WHERE user_id = ? AND strftime('%m', data) = ? AND strftime('%Y', data) = ?`
    ).bind(user.id, mesAnt, anoAnt),
    // despesas mês anterior (comparativo)
    c.env.DB.prepare(
      `SELECT COALESCE(SUM(valor), 0) as total FROM despesas 
       WHERE user_id = ?
         ${filtroDespesaDoMes()}`
    ).bind(user.id, mesAnt, anoAnt),
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
  const receitasAntTotal   = Math.round(((receitasAntR as any).results?.[0]?.total || 0) * 100) / 100
  const despesasAntTotal   = Math.round(((despesasAntR as any).results?.[0]?.total || 0) * 100) / 100

  const totalReceitas = Math.round((receitasMes?.total || 0) * 100) / 100
  const totalDespesas = Math.round((despesasMes?.total || 0) * 100) / 100
  const saldoLiquido = Math.round((totalReceitas - totalDespesas) * 100) / 100
  // Variações vs mês anterior
  const varReceitas = receitasAntTotal > 0 ? Math.round(((totalReceitas - receitasAntTotal) / receitasAntTotal) * 1000) / 10 : null
  const varDespesas = despesasAntTotal > 0 ? Math.round(((totalDespesas - despesasAntTotal) / despesasAntTotal) * 1000) / 10 : null
  const saldoAnt = Math.round((receitasAntTotal - despesasAntTotal) * 100) / 100
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
           ${filtroDespesaDoMes()}`
      ).bind(user.id, m, a),
    ])
  ])

  const metaReservasEsp = parseFloat((evolucaoBatch[0].results?.[0] as any)?.meta || 0)
  const progressoReservas = metaReservasEsp > 0 ? Math.round((totalReservasEsp / metaReservasEsp) * 100) : 0

  // ── Ritmo do mês ───────────────────────────────────────────────────────────
  // Fechar o mês no vermelho quase nunca é uma compra grande: é o acumulado de
  // um ritmo que ninguém percebeu a tempo. Estes dois vetores (gasto por dia
  // deste mês e do anterior) deixam a tela responder "no dia 12 eu já gastei
  // mais do que no dia 12 do mês passado?" — que é a pergunta que dá tempo de
  // corrigir, diferente do total no dia 31.
  const [diasAtualR, diasAntR] = await c.env.DB.batch([
    c.env.DB.prepare(`
      SELECT CAST(strftime('%d', ${competenciaData()}) AS INTEGER) as dia,
             COALESCE(SUM(valor), 0) as total
      FROM despesas
      WHERE user_id = ? ${filtroDespesaDoMes()}
      GROUP BY 1 ORDER BY 1
    `).bind(user.id, mes, ano),
    c.env.DB.prepare(`
      SELECT CAST(strftime('%d', ${competenciaData()}) AS INTEGER) as dia,
             COALESCE(SUM(valor), 0) as total
      FROM despesas
      WHERE user_id = ? ${filtroDespesaDoMes()}
      GROUP BY 1 ORDER BY 1
    `).bind(user.id, mesAnt, anoAnt),
  ])

  const diasNoMes = new Date(parseInt(ano), parseInt(mes), 0).getDate()
  const porDia = (rows: any[], n: number) => {
    const v = new Array(n).fill(0)
    for (const r of (rows || [])) {
      const d = Number(r.dia)
      // strftime pode devolver dia fora da faixa se a competência cair noutro
      // mês por data_pagamento — descartar é melhor que estourar o vetor.
      if (d >= 1 && d <= n) v[d - 1] = Math.round(Number(r.total) * 100) / 100
    }
    return v
  }
  const diasAtual = porDia(diasAtualR.results as any[], diasNoMes)
  const diasAnterior = porDia(diasAntR.results as any[], new Date(parseInt(anoAnt), parseInt(mesAnt), 0).getDate())

  const hoje = new Date()
  const ehMesCorrente = hoje.getFullYear() === parseInt(ano) && (hoje.getMonth() + 1) === parseInt(mes)
  const diaCorte = ehMesCorrente ? hoje.getDate() : diasNoMes
  const acumAte = (v: number[], d: number) => v.slice(0, d).reduce((a, b) => a + b, 0)
  const gastoAteHoje = Math.round(acumAte(diasAtual, diaCorte) * 100) / 100
  const gastoAntMesmoDia = Math.round(acumAte(diasAnterior, Math.min(diaCorte, diasAnterior.length)) * 100) / 100

  const ritmo_mes = {
    dias_no_mes: diasNoMes,
    dia_corte: diaCorte,
    // Dia da semana em que o mês começa (0 = domingo), para a grade do calendário.
    primeiro_dia_semana: new Date(parseInt(ano), parseInt(mes) - 1, 1).getDay(),
    dias: diasAtual,
    dias_anterior: diasAnterior,
    gasto_ate_hoje: gastoAteHoje,
    gasto_anterior_mesmo_dia: gastoAntMesmoDia,
    variacao_pct: gastoAntMesmoDia > 0
      ? Math.round(((gastoAteHoje - gastoAntMesmoDia) / gastoAntMesmoDia) * 1000) / 10
      : null,
    media_diaria: diaCorte > 0 ? Math.round((gastoAteHoje / diaCorte) * 100) / 100 : 0,
    // Projeção linear: o ritmo até aqui aplicado aos dias que faltam.
    projecao_fim_mes: diaCorte > 0 ? Math.round((gastoAteHoje / diaCorte) * diasNoMes * 100) / 100 : 0,
    maior_dia: (() => {
      let idx = -1, max = 0
      diasAtual.forEach((v, i) => { if (v > max) { max = v; idx = i } })
      return idx >= 0 ? { dia: idx + 1, valor: Math.round(max * 100) / 100 } : null
    })(),
    dias_sem_gasto: diasAtual.slice(0, diaCorte).filter(v => v <= 0).length,
  }

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

  // ── Cartões: resumo por cartão (limite, utilizado e fatura do mês) ─────────
  // 3 GROUP BY em 1 round-trip, em vez do loop 2-queries-por-cartão da tela de
  // cartões. Alimenta o painel "Seus cartões" do dashboard.
  const cartoesBatch = await c.env.DB.batch([
    c.env.DB.prepare(
      `SELECT id, nome, apelido, cor, limite_total FROM cartoes WHERE user_id = ? AND ativo = 1 ORDER BY id ASC`
    ).bind(user.id),
    c.env.DB.prepare(
      `SELECT cc.card_id, COALESCE(SUM(cc.valor),0) as utilizado
       FROM card_charges cc JOIN cartoes c ON c.id = cc.card_id
       WHERE c.user_id = ? AND cc.status = 'pendente'
       GROUP BY cc.card_id`
    ).bind(user.id),
    c.env.DB.prepare(
      `SELECT cc.card_id, COALESCE(SUM(cc.valor),0) as fatura
       FROM card_charges cc JOIN cartoes c ON c.id = cc.card_id
       WHERE c.user_id = ? AND cc.billing_month = ? AND cc.billing_year = ? AND cc.status = 'pendente'
       GROUP BY cc.card_id`
    ).bind(user.id, parseInt(mes), parseInt(ano)),
  ])
  const cartoesRows = (cartoesBatch[0].results || []) as any[]
  const usoMap: Record<number, number> = {}
  const fatMap: Record<number, number> = {}
  for (const r of (cartoesBatch[1].results || []) as any[]) usoMap[Number(r.card_id)] = Number(r.utilizado) || 0
  for (const r of (cartoesBatch[2].results || []) as any[]) fatMap[Number(r.card_id)] = Number(r.fatura) || 0
  const cartoesLista = cartoesRows.map((cardRow) => {
    const limite = Math.round((Number(cardRow.limite_total) || 0) * 100) / 100
    const utilizado = Math.round((usoMap[Number(cardRow.id)] || 0) * 100) / 100
    const disponivel = Math.round(Math.max(0, limite - utilizado) * 100) / 100
    return {
      id: cardRow.id,
      nome: cardRow.apelido || cardRow.nome,
      cor: cardRow.cor || '#6EA8FE',
      limite_total: limite,
      utilizado,
      disponivel,
      uso_pct: limite > 0 ? Math.round((utilizado / limite) * 100) : 0,
      fatura_mes: Math.round((fatMap[Number(cardRow.id)] || 0) * 100) / 100,
    }
  })
  const cartoesTotLimite = Math.round(cartoesLista.reduce((s, k) => s + k.limite_total, 0) * 100) / 100
  const cartoesTotUsado  = Math.round(cartoesLista.reduce((s, k) => s + k.utilizado, 0) * 100) / 100
  const cartoesTotFatura = Math.round(cartoesLista.reduce((s, k) => s + k.fatura_mes, 0) * 100) / 100

  // ── Parcelas de cartão que ENCERRAM no mês selecionado ─────────────────────
  // "Encerra" = é a última parcela (parcela_atual = total_parcelas) e cai na
  // fatura (billing) do mês em questão. Fonte: card_charges (guarda parcela).
  const encerrandoRows = await c.env.DB.prepare(
    `SELECT cc.descricao, cc.valor, cc.parcela_atual, cc.total_parcelas, cc.card_id,
            cc.data_vencimento, ct.nome as cartao_nome, ct.cor as cartao_cor
     FROM card_charges cc
     JOIN cartoes ct ON ct.id = cc.card_id
     WHERE ct.user_id = ? AND cc.status != 'cancelado'
       AND COALESCE(cc.total_parcelas, 1) > 1
       AND cc.parcela_atual = cc.total_parcelas
       AND cc.billing_month = ? AND cc.billing_year = ?
     ORDER BY cc.valor DESC`
  ).bind(user.id, parseInt(mes), parseInt(ano)).all<any>()
  const limparParcelaLabel = (s: string) => String(s || '').replace(/\s*\(\d+\/\d+\)\s*$/, '').trim()
  const parcelasEncerrando = (encerrandoRows.results || []).map((r: any) => ({
    descricao: limparParcelaLabel(r.descricao) || 'Compra no cartão',
    valor: Math.round((Number(r.valor) || 0) * 100) / 100,
    parcela_atual: Number(r.parcela_atual) || 0,
    total_parcelas: Number(r.total_parcelas) || 0,
    cartao_id: r.card_id,
    cartao_nome: r.cartao_nome,
    cartao_cor: r.cartao_cor || '#6EA8FE',
    vencimento: r.data_vencimento || null,
  }))
  const parcelasEncerrandoTotal = Math.round(parcelasEncerrando.reduce((s: number, p: any) => s + p.valor, 0) * 100) / 100

  // Bloco 4.2: Top 5 Tags por gastos do mês (widget "Gastos por Tag")
  const topTagsResult = await c.env.DB.prepare(`
    SELECT t.nome, t.cor, COALESCE(SUM(d.valor), 0) as total, COUNT(DISTINCT d.id) as qtd
    FROM despesa_tags dt
    JOIN tags t ON t.id = dt.tag_id
    JOIN despesas d ON d.id = dt.despesa_id
    WHERE d.user_id = ?
      ${filtroDespesaDoMes('d')}
    GROUP BY t.id, t.nome, t.cor
    ORDER BY total DESC
    LIMIT 5
  `).bind(user.id, mes, ano).all()
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

  // ══════════════════════════════════════════════════════════════════════
  // FASE 1.1 — Classificação temporal de obrigações
  // ══════════════════════════════════════════════════════════════════════
  const classificacao = await classificarObrigacoesTemporais(c.env.DB, user.id, totalReceitas)

  // Corrigir o comprometimento para usar APENAS obrigações ativas
  // (sobrepõe o parcelasEmpFin calculado sem classificação temporal)
  const parcelasAtivasClassificadas = classificacao.resumo.total_parcelas_ativas
  const comprometimentoAjustado     = totalReceitas > 0
    ? Math.round((parcelasAtivasClassificadas / totalReceitas) * 100)
    : 0

  // ══════════════════════════════════════════════════════════════════════
  // FASE 1.2 — Alerta categoria "Outros" > 15% da renda
  // ══════════════════════════════════════════════════════════════════════
  const gastosOutros   = (categoriasDespesas.results as any[])
    .find((c: any) => (c.categoria || '').toLowerCase() === 'outros')?.total || 0
  const pctOutros = totalReceitas > 0 ? Math.round((Number(gastosOutros) / totalReceitas) * 1000) / 10 : 0
  const alertaOutrosCritico = pctOutros > 15

  // ══════════════════════════════════════════════════════════════════════
  // FASE 1.3 — Histórico 6 meses enriquecido (para IA e projeções)
  // ══════════════════════════════════════════════════════════════════════
  // evolucao já vem com 6 meses — calcular médias e extremos
  const evolucaoComDados = evolucao.filter(e => e.receitas > 0 || e.despesas > 0)
  const mediaReceitas6m  = evolucaoComDados.length > 0
    ? Math.round(evolucaoComDados.reduce((s, e) => s + e.receitas, 0) / evolucaoComDados.length * 100) / 100
    : 0
  const mediaDespesas6m  = evolucaoComDados.length > 0
    ? Math.round(evolucaoComDados.reduce((s, e) => s + e.despesas, 0) / evolucaoComDados.length * 100) / 100
    : 0
  const melhorMes6m = evolucaoComDados.length > 0
    ? evolucaoComDados.reduce((mx, e) => e.saldo > mx.saldo ? e : mx, evolucaoComDados[0])
    : null
  const piorMes6m = evolucaoComDados.length > 0
    ? evolucaoComDados.reduce((mn, e) => e.saldo < mn.saldo ? e : mn, evolucaoComDados[0])
    : null

  // Top 5 categorias por mês (para IA): busca todos os meses de evolução
  const top5CatsMes = (categoriasDespesas.results as any[]).slice(0, 5)

  // ══════════════════════════════════════════════════════════════════════
  // FASE 3.1 — Motor de regras: "Ações para Hoje"
  // ══════════════════════════════════════════════════════════════════════
  const acoesParaHoje: Array<{
    prioridade: 'urgente' | 'risco' | 'oportunidade' | 'higienizacao'
    titulo: string
    descricao: string
    valor?: number
    link: string
  }> = []

  // Urgente: contas vencendo em ≤3 dias
  const vencendoHoje = (proximosVencimentos.results as any[]).filter((v: any) => {
    const diff = (new Date(v.vencimento + 'T12:00:00').getTime() - new Date().getTime()) / 86400000
    return diff <= 3
  })
  for (const v of vencendoHoje.slice(0, 2)) {
    acoesParaHoje.push({
      prioridade: 'urgente',
      titulo: `⏰ Vence em breve: ${v.descricao}`,
      descricao: `Pagamento de ${new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(v.valor)} vence em ${new Date(v.vencimento+'T12:00:00').toLocaleDateString('pt-BR')}`,
      valor: v.valor,
      link: '#despesas',
    })
  }

  // Higienização: "Outros" > 15% da renda
  if (alertaOutrosCritico && totalReceitas > 0) {
    acoesParaHoje.push({
      prioridade: 'higienizacao',
      titulo: `🚨 ${pctOutros}% da renda em "Outros" — categorize agora`,
      descricao: `R$ ${Number(gastosOutros).toFixed(2)} sem categoria definida impossibilita análise precisa da IA`,
      valor: Number(gastosOutros),
      link: '#despesas',
    })
  }

  // Risco: orçamentos > 80% consumidos com > 30% do mês restante
  const diaAtual  = new Date().getDate()
  const diasMes   = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate()
  const pctMesRestante = ((diasMes - diaAtual) / diasMes) * 100
  if (pctMesRestante > 30) {
    const orcamentosRisco = await c.env.DB.prepare(`
      SELECT o.categoria, o.limite,
             COALESCE(SUM(d.valor),0) as gasto
      FROM orcamentos o
      LEFT JOIN despesas d ON d.user_id = o.user_id
        AND d.categoria = o.categoria
        ${filtroDespesaDoMes('d')}
      WHERE o.user_id = ? AND o.mes = ? AND o.ano = ? AND o.limite > 0
      GROUP BY o.categoria, o.limite
      HAVING (COALESCE(SUM(d.valor),0) * 1.0 / o.limite) > 0.8
      ORDER BY (COALESCE(SUM(d.valor),0) * 1.0 / o.limite) DESC
      LIMIT 2
    `).bind(mes, ano, user.id, parseInt(mes), parseInt(ano)).all()
    for (const orc of (orcamentosRisco.results || []) as any[]) {
      const pctUsado = Math.round((orc.gasto / orc.limite) * 100)
      acoesParaHoje.push({
        prioridade: 'risco',
        titulo: `⚠️ Orçamento ${orc.categoria} em ${pctUsado}% com mês incompleto`,
        descricao: `Gasto R$ ${Number(orc.gasto).toFixed(2)} de R$ ${orc.limite} — ainda faltam ${pctMesRestante.toFixed(0)}% do mês`,
        valor: orc.limite - orc.gasto,
        link: '#orcamentos',
      })
    }
  }

  // Oportunidade: saldo disponível e sem reserva de emergência
  if (saldoLiquido > 0 && (totalReservaLegado + totalReservasEsp) < totalDespesas * 3) {
    acoesParaHoje.push({
      prioridade: 'oportunidade',
      titulo: `💡 Saldo positivo de ${new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(saldoLiquido)} — separe para a reserva`,
      descricao: `Sua reserva de emergência está abaixo de 3 meses de gastos. Sugestão: separar ao menos R$ ${Math.min(saldoLiquido, Math.round(saldoLiquido * 0.5 / 10) * 10).toFixed(2)}`,
      valor: saldoLiquido,
      link: '#reserva',
    })
  }

  // Oportunidade: dívida ativa com alta taxa — economia de amortização
  if (classificacao.ativas.length > 0) {
    const maisCaraAtiva = classificacao.ativas.reduce((mx, o) => o.taxa_juros_anual > mx.taxa_juros_anual ? o : mx, classificacao.ativas[0])
    if (maisCaraAtiva.taxa_juros_anual > 12 && saldoLiquido > 200) {
      const amortExtra = Math.min(saldoLiquido * 0.3, 2000)
      const eco = calcularEconomiaAmortizacao(
        maisCaraAtiva.saldo_devedor,
        maisCaraAtiva.valor_parcela,
        maisCaraAtiva.taxa_juros_anual,
        amortExtra
      )
      if (eco.economia > 100) {
        acoesParaHoje.push({
          prioridade: 'oportunidade',
          titulo: `📉 Amortize R$ ${amortExtra.toFixed(0)} no ${maisCaraAtiva.descricao} e economize R$ ${eco.economia.toFixed(0)} em juros`,
          descricao: `Taxa de retorno: ${eco.taxaRetorno.toFixed(1)}% aa · Reduz ${eco.mesesEconomizados} meses de prazo`,
          valor: amortExtra,
          link: '#amortizacao',
        })
      }
    }
  }

  return c.json({
    resumo: {
      total_receitas: totalReceitas,
      total_despesas: totalDespesas,
      saldo_liquido: saldoLiquido,
      total_investimentos: totalInvest,
      total_investido: totalInvestido,
      percentual_investido: totalReceitas > 0 ? Math.round((totalInvest / totalReceitas) * 100) : 0,
      taxa_poupanca: totalReceitas > 0 ? Math.round(((saldoLiquido / totalReceitas) * 100) * 10) / 10 : null,
      total_devedor: totalDevedor,
      total_dividas: totalDevedor,
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
      progresso_reservas_pct: progressoReservas,
      // Variações vs mês anterior
      var_receitas_pct: varReceitas,
      var_despesas_pct: varDespesas,
      total_reservas: totalReservas
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
    evolucao_6meses: evolucao,
    ritmo_mes,  // B3-fix: alias para compatibilidade com frontend
    categorias_despesas: categoriasDespesas.results,
    categorias_receitas: categoriasReceitas.results,
    ultimas_transacoes: ultimasTransacoes.results,
    proximos_vencimentos: proximosVencimentos.results,
    despesas_status: despesasStatus.results,
    top_tags: topTags,  // Bloco 4.2: widget Gastos por Tag
    cartoes: {
      lista: cartoesLista,
      count: cartoesLista.length,
      total_limite: cartoesTotLimite,
      total_utilizado: cartoesTotUsado,
      total_disponivel: Math.round(Math.max(0, cartoesTotLimite - cartoesTotUsado) * 100) / 100,
      total_fatura_mes: cartoesTotFatura,
      uso_pct: cartoesTotLimite > 0 ? Math.round((cartoesTotUsado / cartoesTotLimite) * 100) : 0,
    },
    parcelas_encerrando: {
      mes: parseInt(mes),
      ano: parseInt(ano),
      itens: parcelasEncerrando,
      count: parcelasEncerrando.length,
      total: parcelasEncerrandoTotal,
    },
    periodo: { mes, ano },
    // Comparativo com mês anterior
    mes_anterior: {
      mes: mesAnt,
      ano: anoAnt,
      total_receitas: receitasAntTotal,
      total_despesas: despesasAntTotal,
      saldo_liquido: saldoAnt,
      var_receitas_pct: varReceitas,
      var_despesas_pct: varDespesas
    },

    // ── FASE 1.1: Obrigações classificadas temporalmente ─────────────────
    obrigacoes_temporais: {
      ativas:  classificacao.ativas.map(o => ({
        id: o.id, tipo: o.tipo, descricao: o.descricao,
        saldo_devedor: o.saldo_devedor, valor_parcela: o.valor_parcela,
        taxa_juros_anual: o.taxa_juros_anual, data_inicio: o.data_inicio,
        data_previsao_fim: o.data_previsao_fim,
      })),
      futuras: classificacao.futuras.map(o => ({
        id: o.id, tipo: o.tipo, descricao: o.descricao,
        saldo_devedor: o.saldo_devedor, valor_parcela: o.valor_parcela,
        taxa_juros_anual: o.taxa_juros_anual, data_inicio: o.data_inicio,
        data_previsao_fim: o.data_previsao_fim,
        meses_para_inicio: o.meses_para_inicio,
      })),
      resumo: classificacao.resumo,
      comprometimento_ajustado_pct: comprometimentoAjustado,
    },

    // ── FASE 1.2: Alerta "Outros" ─────────────────────────────────────────
    alerta_outros: {
      ativo:           alertaOutrosCritico,
      percentual:      pctOutros,
      valor_outros:    Number(gastosOutros),
      limite_saudavel: 15,
      mensagem:        alertaOutrosCritico
        ? `🚨 AÇÃO NECESSÁRIA: ${pctOutros}% da sua renda está em "Outros" (R$ ${Number(gastosOutros).toFixed(2)}). Categorize esses gastos para análise precisa.`
        : null,
    },

    // ── FASE 1.3: Histórico 6 meses enriquecido ───────────────────────────
    historico_6m: {
      meses: evolucao,
      media_receitas:  mediaReceitas6m,
      media_despesas:  mediaDespesas6m,
      melhor_mes:      melhorMes6m ? { mes: melhorMes6m.mes, ano: melhorMes6m.ano, saldo: melhorMes6m.saldo } : null,
      pior_mes:        piorMes6m   ? { mes: piorMes6m.mes,   ano: piorMes6m.ano,   saldo: piorMes6m.saldo   } : null,
      top5_categorias_mes: top5CatsMes,
    },

    // ── FASE 3.1: Ações para Hoje (motor de regras) ──────────────────────
    acoes_para_hoje: acoesParaHoje.slice(0, 5),
  })
})

// GET /api/dashboard/relatorio
dashboard.get('/relatorio', requireAuth, async (c) => {
  const user = c.get('user')
  const { ano = String(new Date().getFullYear()) } = c.req.query()

  if (!/^\d{4}$/.test(ano) || Number(ano) < 2020 || Number(ano) > 2100) {
    return c.json({ error: 'Ano inválido. Informe um ano entre 2020 e 2100.' }, 400)
  }

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
       WHERE user_id = ?
         ${filtroDespesaDoAno()}
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
           ${filtroDespesaDoMes()}
           AND id NOT IN (
             SELECT d2.id FROM despesas d2
             JOIN antecipacoes a ON a.user_id = d2.user_id
               AND a.status = 'antecipada'
               AND a.referencia_id IS NULL
               AND (a.tipo = 'emprestimo' OR a.tipo = 'financiamento')
               AND strftime('%m', COALESCE(d2.vencimento, d2.data)) = strftime('%m', a.data_vencimento_original)
               AND strftime('%Y', COALESCE(d2.vencimento, d2.data)) = strftime('%Y', a.data_vencimento_original)
               AND ABS(d2.valor - a.valor_total) < 0.02
               AND (d2.observacoes LIKE '%Empréstimo automático%' OR d2.observacoes LIKE '%Financiamento automático%')
             WHERE d2.user_id = ? AND d2.status = 'pendente'
           )`
      ).bind(user.id, m, ano, user.id),
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

// GET /api/dashboard/anos
// Retorna os anos com lançamentos (despesas + receitas) + ano atual + 2 anos à frente
// Garante que o seletor de ano sempre exibe todos os anos relevantes, inclusive futuros
dashboard.get('/anos', requireAuth, async (c) => {
  const user = c.get('user')
  const anoAtual = new Date().getFullYear()

  const [despAnos, recAnos] = await Promise.all([
    c.env.DB.prepare(`
      SELECT DISTINCT substr(COALESCE(vencimento, data), 1, 4) AS ano_texto
      FROM despesas
      WHERE user_id = ? AND status != 'cancelado'
      ORDER BY ano_texto
    `).bind(user.id).all(),
    c.env.DB.prepare(`
      SELECT DISTINCT substr(data, 1, 4) AS ano_texto
      FROM receitas
      WHERE user_id = ?
      ORDER BY ano_texto
    `).bind(user.id).all(),
  ])

  const anosSet = new Set<number>()

  // Adiciona anos das despesas e receitas
  for (const row of (despAnos.results || []) as { ano_texto: string }[]) {
    if (/^\d{4}$/.test(row.ano_texto)) {
      const ano = Number(row.ano_texto)
      if (ano >= 2020 && ano <= 2100) anosSet.add(ano)
    }
  }
  for (const row of (recAnos.results || []) as { ano_texto: string }[]) {
    if (/^\d{4}$/.test(row.ano_texto)) {
      const ano = Number(row.ano_texto)
      if (ano >= 2020 && ano <= 2100) anosSet.add(ano)
    }
  }

  // Garante que o ano atual e os 2 próximos sempre aparecem
  anosSet.add(anoAtual)
  anosSet.add(anoAtual + 1)
  anosSet.add(anoAtual + 2)

  const anos = Array.from(anosSet).sort((a, b) => a - b)

  return c.json({ anos, ano_atual: anoAtual })
})

export default dashboard
