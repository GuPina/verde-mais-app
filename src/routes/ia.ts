import { Hono } from 'hono'
import { requireAuth } from './auth'
import { getLimites, MSG_UPGRADE } from './planos'

type Bindings = { DB: D1Database; OPENAI_API_KEY: string; OPENAI_BASE_URL: string }
type Variables = { user: { id: number; nome: string; email: string; plano: string } }

const ia = new Hono<{ Bindings: Bindings; Variables: Variables }>()

// ─── helpers ────────────────────────────────────────────────────────────────
function fmt(v: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v || 0)
}
function pct(n: number, d: number): number {
  return d > 0 ? Math.round((n / d) * 1000) / 10 : 0
}
function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v))
}

// ─── Scores por módulo (0-100) ───────────────────────────────────────────────
function scoreCashFlow(saldo: number, receita: number): number {
  if (receita === 0) return 30
  const taxa = saldo / receita
  if (taxa >= 0.3)  return 100
  if (taxa >= 0.2)  return 85
  if (taxa >= 0.1)  return 70
  if (taxa >= 0)    return 50
  if (taxa >= -0.1) return 25
  return 0
}
function scoreEmergency(meses: number): number {
  if (meses >= 6) return 100
  if (meses >= 4) return 80
  if (meses >= 3) return 60
  if (meses >= 1) return 35
  return 0
}
function scoreDebt(ratio: number, taxaMaxima: number): number {
  let s = 100
  if (ratio > 0.5)       s -= 50
  else if (ratio > 0.3)  s -= 30
  else if (ratio > 0.2)  s -= 15
  if (taxaMaxima > 15)   s -= 20
  else if (taxaMaxima > 8) s -= 10
  return clamp(s, 0, 100)
}
function scoreInvestments(totalAtual: number, receita: number): number {
  if (receita === 0) return totalAtual > 0 ? 60 : 20
  const ratio = totalAtual / receita
  if (ratio >= 12) return 100  // 1 ano de renda
  if (ratio >= 6)  return 80
  if (ratio >= 3)  return 60
  if (ratio >= 1)  return 40
  return totalAtual > 0 ? 25 : 10
}
function scoreGoals(totalMetas: number, percAtingido: number): number {
  if (totalMetas === 0) return 30
  let s = 50 + Math.min(50, percAtingido * 0.5)
  return clamp(s, 30, 100)
}

// ─── Veredicto do score geral ────────────────────────────────────────────────
function veredicto(score: number): string {
  if (score >= 85) return '🏆 Saúde Financeira Excelente'
  if (score >= 70) return '✅ Finanças Bem Organizadas'
  if (score >= 55) return '⚡ Momento de Construção'
  if (score >= 35) return '⚠️ Atenção Necessária'
  return '🚨 Situação Crítica — Ação Imediata'
}
function statusLabel(score: number): 'EXCELENTE' | 'BOM' | 'ATENCAO' | 'CRITICO' {
  if (score >= 80) return 'EXCELENTE'
  if (score >= 55) return 'BOM'
  if (score >= 35) return 'ATENCAO'
  return 'CRITICO'
}
function statusColor(s: string): string {
  const m: Record<string, string> = { EXCELENTE: '#2FBF71', BOM: '#74b9ff', ATENCAO: '#ffc400', CRITICO: '#ff6b6b' }
  return m[s] || '#888'
}

// ════════════════════════════════════════════════════════════════════════════
// GET /api/ia/insights — Análise 360° integrada dos 11 módulos
// ════════════════════════════════════════════════════════════════════════════
ia.get('/insights', requireAuth, async (c) => {
  const user = c.get('user')

  const lim = getLimites(user.plano)
  if (!lim.ia_insights) {
    // ── Score TEASER para plano free ────────────────────────────────────────
    const uid  = user.id
    const now  = new Date()
    const mes  = String(now.getMonth() + 1).padStart(2, '0')
    const ano  = String(now.getFullYear())

    const [recR, despR, invR, reservaR] = await Promise.all([
      c.env.DB.prepare(`SELECT COALESCE(SUM(valor),0) as t FROM receitas WHERE user_id=? AND strftime('%m',data)=? AND strftime('%Y',data)=?`).bind(uid,mes,ano).first(),
      c.env.DB.prepare(`SELECT COALESCE(SUM(valor),0) as t FROM despesas WHERE user_id=? AND COALESCE(tipo,'normal')!='aporte' AND strftime('%m',COALESCE(vencimento,data))=? AND strftime('%Y',COALESCE(vencimento,data))=?`).bind(uid,mes,ano).first(),
      c.env.DB.prepare(`SELECT COALESCE(SUM(valor_atual),0) as t FROM investimentos WHERE user_id=?`).bind(uid).first(),
      c.env.DB.prepare(`SELECT COALESCE(SUM(valor_atual),0) as t FROM reserva_emergencia WHERE user_id=?`).bind(uid).first(),
    ]) as any[]
    const rec   = Number(recR?.t || 0)
    const desp  = Number(despR?.t || 0)
    const saldo = rec - desp
    const inv   = Number(invR?.t || 0)
    const resv  = Number(reservaR?.t || 0)
    const mesesReserva = rec > 0 ? resv / (desp || rec) : 0

    const teaserScore = Math.round(
      scoreCashFlow(saldo, rec)       * 0.30 +
      scoreEmergency(mesesReserva)    * 0.25 +
      100                             * 0.20 + // sem dívidas conhecidas = neutro
      scoreInvestments(inv, rec)      * 0.25
    )

    return c.json({
      teaser: true,
      upgrade: true,
      feature: 'ia_insights',
      score_teaser: teaserScore,
      veredicto: veredicto(teaserScore),
      mensagem: `Seu score estimado é ${teaserScore}. Faça upgrade para o Premium e desbloqueie a análise completa com detalhamento por módulo, recomendações personalizadas e histórico.`
    }, 200)
  }

  const now = new Date()
  const mes  = String(now.getMonth() + 1).padStart(2, '0')
  const ano  = String(now.getFullYear())
  const uid  = user.id

  // ── Coleta paralela dos 11 módulos ──────────────────────────────────────
  const [
    receitasMes, despesasMes, catDesp,
    receitasRec, despesasRec,
    cartoes, cardChargesMes,
    metasAtivas,
    orcamentos,
    recorrencias,
    investimentos,
    reserva, mediaDesp3m,
    financiamentos,
    emprestimos,
    projecao,
    userPerfil,
    assinaturasRaw
  ] = await Promise.all([
    // M1 – Receitas do mês
    c.env.DB.prepare(
      `SELECT COALESCE(SUM(valor),0) as total FROM receitas
       WHERE user_id=? AND strftime('%m',data)=? AND strftime('%Y',data)=?`
    ).bind(uid, mes, ano).first() as any,

    // M2 – Despesas do mês (critério temporal consistente)
    c.env.DB.prepare(
      `SELECT COALESCE(SUM(valor),0) as total FROM despesas WHERE user_id=?
       AND CASE WHEN status='pago'
                THEN strftime('%m',data)=? AND strftime('%Y',data)=?
                ELSE strftime('%m',COALESCE(vencimento,data))=?
                 AND strftime('%Y',COALESCE(vencimento,data))=?
           END`
    ).bind(uid, mes, ano, mes, ano).first() as any,

    // M2 – Categorias de despesas
    c.env.DB.prepare(
      `SELECT categoria, COALESCE(SUM(valor),0) as total FROM despesas WHERE user_id=?
       AND CASE WHEN status='pago'
                THEN strftime('%m',data)=? AND strftime('%Y',data)=?
                ELSE strftime('%m',COALESCE(vencimento,data))=?
                 AND strftime('%Y',COALESCE(vencimento,data))=?
           END
       GROUP BY categoria ORDER BY total DESC LIMIT 8`
    ).bind(uid, mes, ano, mes, ano).all(),

    // M1 – Receitas últimos 6 meses
    c.env.DB.prepare(
      `SELECT strftime('%Y-%m',data) as ym, COALESCE(SUM(valor),0) as total
       FROM receitas WHERE user_id=? AND data >= date('now','-6 months')
       GROUP BY ym ORDER BY ym`
    ).bind(uid).all(),

    // M2 – Despesas últimos 6 meses
    c.env.DB.prepare(
      `SELECT strftime('%Y-%m',COALESCE(vencimento,data)) as ym, COALESCE(SUM(valor),0) as total
       FROM despesas WHERE user_id=? AND COALESCE(vencimento,data) >= date('now','-6 months')
       GROUP BY ym ORDER BY ym`
    ).bind(uid).all(),

    // M3 – Cartões
    c.env.DB.prepare(
      `SELECT id, nome, limite_total, limite_disponivel,
              dia_fechamento, dia_vencimento
       FROM cartoes WHERE user_id=? AND ativo=1`
    ).bind(uid).all(),

    // M3 – Fatura total pendente do mês atual
    c.env.DB.prepare(
      `SELECT COALESCE(SUM(cc.valor),0) as total
       FROM card_charges cc JOIN cartoes c ON cc.card_id=c.id
       WHERE c.user_id=? AND cc.billing_month=? AND cc.billing_year=? AND cc.status='pendente'`
    ).bind(uid, parseInt(mes), parseInt(ano)).first() as any,

    // M4 – Metas ativas
    c.env.DB.prepare(
      `SELECT nome, categoria, valor_objetivo, valor_atual, data_meta as prazo
       FROM metas WHERE user_id=? AND status='ativa' ORDER BY data_meta ASC`
    ).bind(uid).all(),

    // M5 – Orçamentos
    c.env.DB.prepare(
      `SELECT o.categoria, o.limite as limite,
              COALESCE(SUM(d.valor),0) as gasto
       FROM orcamentos o
       LEFT JOIN despesas d ON d.user_id=o.user_id AND d.categoria=o.categoria
         AND strftime('%m',COALESCE(d.vencimento,d.data))=? AND strftime('%Y',COALESCE(d.vencimento,d.data))=?
       WHERE o.user_id=? AND o.mes=? AND o.ano=?
       GROUP BY o.categoria`
    ).bind(mes, ano, uid, parseInt(mes), parseInt(ano)).all(),

    // M6 – Recorrências
    c.env.DB.prepare(
      `SELECT tipo, COALESCE(SUM(valor),0) as total
       FROM recorrencias WHERE user_id=? AND ativa=1 GROUP BY tipo`
    ).bind(uid).all(),

    // M7 – Investimentos
    c.env.DB.prepare(
      `SELECT tipo, COALESCE(SUM(valor_investido),0) as investido,
              COALESCE(SUM(valor_atual),0) as atual
       FROM investimentos WHERE user_id=? GROUP BY tipo`
    ).bind(uid).all(),

    // M8 – Reserva de emergência
    c.env.DB.prepare(
      `SELECT valor_atual, objetivo_meses FROM reserva_emergencia WHERE user_id=? LIMIT 1`
    ).bind(uid).first() as any,

    // M8 – Média despesas 3 meses
    c.env.DB.prepare(
      `SELECT COALESCE(AVG(tm),0) as media FROM (
         SELECT SUM(valor) as tm FROM despesas WHERE user_id=?
         AND data >= date('now','-3 months') GROUP BY strftime('%Y-%m',data)
       )`
    ).bind(uid).first() as any,

    // M9 – Financiamentos
    c.env.DB.prepare(
      `SELECT COALESCE(SUM(saldo_devedor),0) as saldo,
              COALESCE(SUM(valor_parcela),0) as parcela,
              COALESCE(AVG(taxa_juros_anual),0) as taxa_media,
              COALESCE(MAX(taxa_juros_anual),0) as taxa_max,
              COUNT(*) as qtd
       FROM financiamentos WHERE user_id=? AND status='ativo'`
    ).bind(uid).first() as any,

    // M10 – Empréstimos
    c.env.DB.prepare(
      `SELECT COALESCE(SUM(saldo_devedor),0) as saldo,
              COALESCE(SUM(valor_parcela),0) as parcela,
              COALESCE(AVG(taxa_juros_mensal),0) as taxa_media_mensal,
              COALESCE(MAX(taxa_juros_mensal),0) as taxa_max_mensal,
              COUNT(*) as qtd
       FROM emprestimos WHERE user_id=? AND status='ativo'`
    ).bind(uid).first() as any,

    // M11 – Projeção (últimos 6 meses de saldo)
    c.env.DB.prepare(
      `SELECT strftime('%Y-%m',data) as ym,
              COALESCE(SUM(valor),0) as receitas
       FROM receitas WHERE user_id=? AND data >= date('now','-6 months')
       GROUP BY ym`
    ).bind(uid).all(),

    // Perfil do usuário
    c.env.DB.prepare(
      `SELECT perfil_investidor, nome FROM users WHERE id=?`
    ).bind(uid).first() as any,

    // M12 – Assinaturas detectadas (ativas, reduzidas, canceladas)
    c.env.DB.prepare(
      `SELECT status, user_feedback,
              COALESCE(amount,0) as amount,
              COALESCE(yearly_cost,0) as yearly_cost,
              COALESCE(valor_antigo,0) as valor_antigo,
              service_nome, original_description, reduced_at
       FROM detected_subscriptions
       WHERE user_id = ? AND status NOT IN ('ignored')
       ORDER BY yearly_cost DESC`
    ).bind(uid).all(),
  ])

  // ── Normalizar dados ───────────────────────────────────────────────────
  const receita       = Number(receitasMes?.total || 0)
  const despesa       = Number(despesasMes?.total || 0)
  const saldoMes      = receita - despesa
  const cats          = (catDesp.results as any[])

  // Cartões
  const cartoesLista  = (cartoes.results as any[])
  const limiteTotal   = cartoesLista.reduce((s, c) => s + (c.limite_total || 0), 0)
  const limiteDisp    = cartoesLista.reduce((s, c) => s + (c.limite_disponivel || 0), 0)
  const limiteUsado   = limiteTotal - limiteDisp
  const utilizacaoCartao = pct(limiteUsado, limiteTotal)
  const faturaCartaoMes = Number(cardChargesMes?.total || 0)

  // Metas
  const metasLista    = (metasAtivas.results as any[])
  const totalObjetivo = metasLista.reduce((s, m) => s + m.valor_objetivo, 0)
  const totalAtual    = metasLista.reduce((s, m) => s + m.valor_atual, 0)

  // Orçamentos
  const orcLista      = (orcamentos.results as any[])

  // Recorrências
  const recorrLista   = (recorrencias.results as any[])
  const recRecorr     = (recorrLista.find((r: any) => r.tipo === 'receita')?.total || 0)
  const despRecorr    = (recorrLista.find((r: any) => r.tipo === 'despesa')?.total || 0)
  const previsibilidade = receita > 0 ? pct(recRecorr + despRecorr, receita + despesa) : 0

  // Investimentos
  const invLista      = (investimentos.results as any[])
  const totalInvest   = invLista.reduce((s, i) => s + i.atual, 0)
  const totalInvestido= invLista.reduce((s, i) => s + i.investido, 0)
  const rentabCarteira = totalInvestido > 0 ? pct(totalInvest - totalInvestido, totalInvestido) : 0
  const tiposInvest   = invLista.reduce((acc, i) => { acc[i.tipo] = (acc[i.tipo] || 0) + i.atual; return acc }, {} as Record<string, number>)

  // Reserva
  const mediaGastos3m = Number(mediaDesp3m?.media || 0)
  const mesesObj      = reserva?.objetivo_meses || 6
  const valorReserva  = Number(reserva?.valor_atual || 0)
  const reservaIdeal  = (mediaGastos3m || despesa) * mesesObj
  const mesesCobertos = (mediaGastos3m || despesa) > 0 ? valorReserva / (mediaGastos3m || despesa) : 0
  const reservaAdequada = mesesCobertos >= mesesObj

  // Dívidas
  const saldoFin      = Number(financiamentos?.saldo || 0)
  const parcelaFin    = Number(financiamentos?.parcela || 0)
  const taxaMaxFin    = Number(financiamentos?.taxa_max || 0)  // a.a.
  const saldoEmp      = Number(emprestimos?.saldo || 0)
  const parcelaEmp    = Number(emprestimos?.parcela || 0)
  const taxaMaxEmpMes = Number(emprestimos?.taxa_max_mensal || 0)
  const taxaMaxEmpAno = taxaMaxEmpMes > 0 ? (Math.pow(1 + taxaMaxEmpMes / 100, 12) - 1) * 100 : 0
  const taxaMaxDivida = Math.max(taxaMaxFin, taxaMaxEmpAno)
  const totalDivida   = saldoFin + saldoEmp
  const parcelaTotal  = parcelaFin + parcelaEmp + faturaCartaoMes
  const debtRatio     = receita > 0 ? parcelaTotal / receita : 0

  // Perfil investidor — suporta tanto inglês (moderate) quanto português (moderado)
  const perfilRaw = userPerfil?.perfil_investidor || 'moderate'
  const perfilMap: Record<string,string> = {
    conservative: 'conservative', conservador: 'conservative',
    moderate:     'moderate',     moderado:    'moderate',
    aggressive:   'aggressive',   agressivo:   'aggressive'
  }
  const perfilInv     = (perfilMap[perfilRaw] || 'moderate') as 'conservative' | 'moderate' | 'aggressive'
  const perfilLabel   = { conservative: 'Conservador', moderate: 'Moderado', aggressive: 'Agressivo' }[perfilInv]

  // ── Scores por módulo ─────────────────────────────────────────────────
  const sCashFlow   = scoreCashFlow(saldoMes, receita)
  const sEmergency  = scoreEmergency(mesesCobertos)
  const sDebt       = scoreDebt(debtRatio, taxaMaxDivida)
  const sInvest     = scoreInvestments(totalInvest, receita)
  const sGoals      = scoreGoals(metasLista.length, totalObjetivo > 0 ? pct(totalAtual, totalObjetivo) : 0)
  const scoreGeral  = Math.round((sCashFlow + sEmergency + sDebt + sInvest + sGoals) / 5)

  // ── Alertas Críticos (cruzamento de dados) ────────────────────────────
  const alertasCriticos: any[] = []

  // 1. Conflito dívida cara vs investimento
  const temDividaCara  = taxaMaxDivida > 15 || taxaMaxEmpMes > 1.25
  const estaInvestindo = totalInvestido > 0
  if (temDividaCara && estaInvestindo) {
    const taxaRef = taxaMaxDivida > 0 ? taxaMaxDivida : taxaMaxEmpMes * 12
    alertasCriticos.push({
      tipo: 'CONFLITO_MATEMATICO',
      severidade: 'CRITICO',
      titulo: '🛑 Conflito Matemático Detectado',
      descricao: `Você tem ${fmt(totalInvest)} investidos rendendo ~12% a.a., mas paga ${taxaRef.toFixed(1)}% a.a. em dívidas. Matematicamente, cada R$ investido está te custando ${(taxaRef - 12).toFixed(1)}% a.a.`,
      acao: `Considere usar parte dos investimentos (${fmt(Math.min(totalInvest, saldoEmp))}) para quitar as dívidas mais caras primeiro.`,
      impacto: `Economia potencial: ${fmt((taxaRef - 12) / 100 * Math.min(totalInvest, totalDivida))}/ano em juros`
    })
  }

  // 2. Investindo sem reserva adequada
  if (estaInvestindo && !reservaAdequada && mesesCobertos < 3) {
    alertasCriticos.push({
      tipo: 'ORDEM_PRIORIDADE',
      severidade: 'ALTO',
      titulo: '⚠️ Ordem de Prioridades Invertida',
      descricao: `Você tem ${fmt(totalInvest)} investidos, mas apenas ${mesesCobertos.toFixed(1)} meses de reserva de emergência (mínimo: 3 meses).`,
      acao: `Pause novos aportes e direcione ${fmt(reservaIdeal - valorReserva)} para completar a reserva antes de investir.`,
      impacto: 'Proteção contra imprevistos sem precisar resgatar investimentos'
    })
  }

  // 3. Comprometimento crítico de renda
  if (debtRatio > 0.5 && receita > 0) {
    alertasCriticos.push({
      tipo: 'COMPROMETIMENTO_CRITICO',
      severidade: 'CRITICO',
      titulo: '🔴 Mais da Metade da Renda em Dívidas',
      descricao: `${pct(parcelaTotal, receita).toFixed(0)}% da sua renda (${fmt(parcelaTotal)}/mês) vai para dívidas e fatura de cartão. Risco alto de espiral de endividamento.`,
      acao: 'Priorize o maior devedor primeiro (avalanche de dívidas). Considere renegociação ou portabilidade de crédito.',
      impacto: `Liberar ${fmt(parcelaTotal * 0.3)}/mês pode transformar sua situação financeira`
    })
  }

  // 4. Fluxo negativo
  if (saldoMes < 0 && receita > 0) {
    alertasCriticos.push({
      tipo: 'FLUXO_NEGATIVO',
      severidade: 'CRITICO',
      titulo: '🚨 Gastos Superam Receitas',
      descricao: `Você está gastando ${fmt(Math.abs(saldoMes))} a mais do que ganha este mês. Isso gera dívida ou consome reservas.`,
      acao: `Corte ${fmt(Math.abs(saldoMes))} em gastos não essenciais imediatamente. Analise as categorias com maior gasto.`,
      impacto: 'Cada mês no vermelho aumenta o buraco financeiro'
    })
  }

  // 5. Cartão acima de 80% do limite
  if (utilizacaoCartao > 80 && limiteTotal > 0) {
    alertasCriticos.push({
      tipo: 'CARTAO_CRITICO',
      severidade: 'ALTO',
      titulo: '💳 Limite de Cartão Quase Esgotado',
      descricao: `Você está usando ${utilizacaoCartao.toFixed(0)}% do seu limite total (${fmt(limiteUsado)} de ${fmt(limiteTotal)}). Acima de 80% afeta o score de crédito e aumenta risco de não quitar a fatura.`,
      acao: 'Não faça novas compras no cartão até reduzir o saldo. Priorize pagamento da fatura.',
      impacto: 'Reduzir para menos de 30% melhora seu score de crédito em 2-3 meses'
    })
  }

  // ── Análise Modular ───────────────────────────────────────────────────
  // Fluxo de caixa
  const taxaPoupanca = receita > 0 ? pct(saldoMes, receita) : 0
  const statusFluxo  = statusLabel(sCashFlow)
  const msgFluxo =
    receita === 0 ? 'Cadastre suas receitas para ativar a análise de fluxo.' :
    saldoMes > 0  ? `Sobra mensal de ${fmt(saldoMes)} (${taxaPoupanca.toFixed(1)}% da renda).${taxaPoupanca >= 20 ? ' Taxa de poupança excelente! ✅' : taxaPoupanca >= 10 ? ' Razoável — tente chegar em 20%.' : ' Baixo — revise os gastos variáveis.'}` :
                    `Déficit de ${fmt(Math.abs(saldoMes))} este mês. Urgente: reduza despesas ou aumente receitas.`
  const recFluxo =
    taxaPoupanca >= 20 ? `Continue poupando e direcione ${fmt(saldoMes * 0.7)} para reserva/investimentos.` :
    taxaPoupanca >= 0  ? `Identifique as 3 maiores despesas variáveis e tente reduzir 10% em cada.` :
                         `Corte imediato necessário: reduza gastos em ${fmt(Math.abs(saldoMes))} para zerar o déficit.`

  // Reserva
  const statusRes  = statusLabel(sEmergency)
  const percReserva = reservaIdeal > 0 ? pct(valorReserva, reservaIdeal) : 0
  const msgRes =
    !reserva ? `Reserva não criada. Valor ideal: ${fmt(reservaIdeal)} (${mesesObj} meses de despesas).` :
    mesesCobertos >= mesesObj ? `Reserva completa! ${fmt(valorReserva)} — ${mesesCobertos.toFixed(1)} meses de cobertura. ✅` :
                                `Apenas ${mesesCobertos.toFixed(1)} meses de cobertura (${percReserva.toFixed(0)}% da meta de ${mesesObj} meses). Faltam ${fmt(reservaIdeal - valorReserva)}.`
  const recRes =
    !reserva || mesesCobertos < 1 ? `PRIORIDADE #1: Crie a reserva e deposite ${fmt((reservaIdeal)/12)}/mês. Use Tesouro Selic para ter liquidez e rendimento.` :
    mesesCobertos < mesesObj      ? `Deposite ${fmt((reservaIdeal - valorReserva) / 12)}/mês para completar em 12 meses. Mantenha em Tesouro Selic.` :
                                    `Reserva sólida. Agora você pode investir o excedente em ativos de maior retorno.`

  // Dívidas
  const statusDiv  = statusLabel(sDebt)
  const msgDiv =
    totalDivida === 0 ? 'Sem dívidas ativas — situação excelente! ✅' :
    debtRatio > 0.5   ? `Comprometimento crítico: ${pct(parcelaTotal, receita).toFixed(0)}% da renda (${fmt(parcelaTotal)}/mês) em dívidas e cartão.` :
    debtRatio > 0.3   ? `${pct(parcelaTotal, receita).toFixed(0)}% da renda comprometida — acima do limite saudável de 30%.` :
                        `${pct(parcelaTotal, receita).toFixed(0)}% da renda em dívidas — dentro do limite aceitável (até 30%).`
  const recDiv =
    taxaMaxDivida > 20 ? `Quite primeiro as dívidas com taxa acima de 20% a.a. (empréstimos). Use o método avalanche.` :
    taxaMaxDivida > 0  ? `Avalie portabilidade de crédito para reduzir taxa. Mire abaixo de 10% a.a.` :
                         `Sem dívidas — dirija o excedente para investimentos.`

  // Investimentos
  const statusInv  = statusLabel(sInvest)
  const msgInv =
    totalInvest === 0 ? 'Nenhum investimento cadastrado. Cada mês sem investir é um custo de oportunidade.' :
    rentabCarteira > 0 ? `Carteira com ${fmt(totalInvest)} — rentabilidade de +${rentabCarteira.toFixed(2)}%.` :
                          `Carteira com ${fmt(totalInvest)} — rentabilidade ligeiramente negativa ou zerada. Revise os ativos.`

  // Recomendação de investimento por perfil
  const recInvPerPerfil: Record<string, string> = {
    conservative: 'Perfil Conservador: priorize Tesouro Selic, CDB >100% CDI e LCI/LCA. Máximo 10% em renda variável.',
    moderate:     'Perfil Moderado: 50% Tesouro IPCA+ | 30% Fundos Imobiliários (FIIs) | 20% Ações diversificadas.',
    aggressive:   'Perfil Agressivo: 40% ETFs de ações | 30% FIIs | 20% Renda fixa IPCA+ | 10% Cripto/alternativo.'
  }
  const recInv = !reservaAdequada
    ? `AGUARDE: complete a reserva primeiro. Após isso, siga o perfil ${perfilLabel}: ${recInvPerPerfil[perfilInv]}`
    : (receita > 0 ? `Capacidade de aporte: ${fmt(saldoMes * 0.5)}/mês. ${recInvPerPerfil[perfilInv]}` : recInvPerPerfil[perfilInv])

  // Metas
  const statusMetas = statusLabel(sGoals)
  const msgMetas =
    metasLista.length === 0 ? 'Nenhuma meta financeira ativa. Metas dão direção ao seu dinheiro.' :
                               `${metasLista.length} meta(s) ativa(s). Progresso total: ${pct(totalAtual, totalObjetivo).toFixed(0)}% (${fmt(totalAtual)} de ${fmt(totalObjetivo)}).`

  // Meta mais próxima do prazo
  let recMetas = 'Crie pelo menos uma meta de curto prazo (6-12 meses) e uma de longo prazo (+5 anos).'
  if (metasLista.length > 0) {
    const proxima = metasLista[0] as any
    const falta = proxima.valor_objetivo - proxima.valor_atual
    const prazoDate = proxima.prazo ? new Date(proxima.prazo) : null
    const mesesRestantes = prazoDate ? Math.max(1, Math.ceil((prazoDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24 * 30))) : 12
    const aporteMensal = falta / mesesRestantes
    recMetas = falta > 0
      ? `Meta mais próxima: "${proxima.nome}" — deposite ${fmt(aporteMensal)}/mês para atingir em ${mesesRestantes} meses.`
      : `Meta "${proxima.nome}" já atingida! Defina o próximo objetivo.`
  }

  // ── Plano de Ação 90 Dias (priorizado pela hierarquia) ─────────────────
  const plano: any[] = []
  let prioNum = 1

  // Prio 1: Fluxo positivo
  if (saldoMes < 0 && receita > 0) {
    const topCat = cats[0] as any
    plano.push({
      prioridade: prioNum++,
      hierarquia: '🚨 Sobrevivência',
      titulo: 'Zerar o Déficit Mensal',
      passos: [
        `Identifique e corte ${fmt(Math.abs(saldoMes))} em gastos não essenciais`,
        topCat ? `Categoria "${topCat.categoria}" (${fmt(topCat.total)}/mês) — reduza 20%` : 'Analise as categorias pelo aplicativo',
        'Registre TODA despesa diariamente por 30 dias',
        'Revise assinaturas e serviços recorrentes'
      ],
      prazo: 'Este mês',
      impacto: `Evitar acúmulo de ${fmt(Math.abs(saldoMes) * 12)}/ano em dívidas`
    })
  }

  // Prio 2: Reserva de emergência
  if (!reservaAdequada) {
    const faltaReserva  = Math.max(0, reservaIdeal - valorReserva)
    const aporteMes     = receita > 0 ? Math.min(saldoMes * 0.5, faltaReserva / 12) : faltaReserva / 24
    const mesesParaMeta = aporteMes > 0 ? Math.ceil(faltaReserva / aporteMes) : 24
    plano.push({
      prioridade: prioNum++,
      hierarquia: '🛡️ Segurança',
      titulo: 'Completar Reserva de Emergência',
      passos: [
        !reserva ? 'Acesse "Reserva de Emergência" no menu e crie sua reserva' : `Reserva atual: ${fmt(valorReserva)} — faltam ${fmt(faltaReserva)}`,
        `Deposite ${fmt(aporteMes)}/mês automaticamente logo ao receber o salário`,
        'Mantenha 100% em Tesouro Selic (liquidez diária + rendimento CDI)',
        `Meta: ${fmt(reservaIdeal)} em ${mesesParaMeta} meses`
      ],
      prazo: `${mesesParaMeta} meses`,
      impacto: `Segurança total para ${mesesObj} meses de despesas sem renda`
    })
  }

  // Prio 3: Dívidas caras
  if (taxaMaxDivida > 15 || taxaMaxEmpMes > 1.25) {
    plano.push({
      prioridade: prioNum++,
      hierarquia: '💳 Dívidas',
      titulo: 'Eliminar Dívidas de Juros Altos',
      passos: [
        `Taxa máxima identificada: ${taxaMaxEmpMes > 1.25 ? (taxaMaxEmpMes * 12).toFixed(1) + '% a.a. (empréstimos)' : taxaMaxFin.toFixed(1) + '% a.a. (financiamentos)'}`,
        'Use o método avalanche: pague o mínimo nas demais e concentre extra na mais cara',
        estaInvestindo && temDividaCara ? `Considere resgatar parte dos ${fmt(totalInvest)} para quitar` : 'Negocie portabilidade de crédito para taxa menor',
        'Após quitar, redirecione o valor da parcela para investimentos'
      ],
      prazo: 'Conforme capacidade',
      impacto: `Economia potencial de ${fmt(taxaMaxDivida / 100 * totalDivida)}/ano em juros`
    })
  }

  // Prio 4: Carteira de investimentos
  if (reservaAdequada || mesesCobertos >= 3) {
    const capacidade = receita > 0 ? Math.max(0, saldoMes - (reservaAdequada ? 0 : (reservaIdeal - valorReserva) / 12)) : 0
    const aporteIdeal: Record<string, number> = {
      conservative: Math.min(capacidade * 0.5, 500),
      moderate:     Math.min(capacidade * 0.7, 1000),
      aggressive:   Math.min(capacidade * 0.8, 2000)
    }
    plano.push({
      prioridade: prioNum++,
      hierarquia: '📈 Acumulação',
      titulo: `Iniciar/Expandir Carteira (Perfil ${perfilLabel})`,
      passos: [
        totalInvest === 0
          ? `Comece com ${fmt(aporteIdeal[perfilInv])}/mês no Tesouro Selic (primeiro passo)`
          : `Aumente aporte para ${fmt(aporteIdeal[perfilInv])}/mês`,
        recInvPerPerfil[perfilInv],
        'Reinvista os rendimentos automaticamente (juros compostos)',
        'Revise a carteira a cada 6 meses'
      ],
      prazo: 'Início: próximo mês',
      impacto: totalInvest === 0
        ? `${fmt(aporteIdeal[perfilInv] * 12 * 5)} estimado em 5 anos com aportes mensais`
        : `Crescimento projetado: ${fmt(totalInvest * 1.12)} em 12 meses (12% a.a.)`
    })
  }

  // Prio 5: Metas financeiras
  if (metasLista.length > 0 && saldoMes > 0) {
    const proxima = metasLista[0] as any
    const falta = proxima.valor_objetivo - proxima.valor_atual
    const mesesParaMeta = falta > 0 && saldoMes > 0 ? Math.ceil(falta / (saldoMes * 0.3)) : 12
    if (falta > 0) {
      plano.push({
        prioridade: prioNum++,
        hierarquia: '🎯 Realização',
        titulo: `Meta: ${proxima.nome}`,
        passos: [
          `Falta: ${fmt(falta)} — aporte mensal necessário: ${fmt(falta / mesesParaMeta)}`,
          'Crie uma conta separada exclusiva para esta meta',
          `Prazo estimado: ${mesesParaMeta} meses com aportes regulares`,
          'Configure débito automático para não esquecer'
        ],
        prazo: `${mesesParaMeta} meses`,
        impacto: `Realização do objetivo "${proxima.nome}" de ${fmt(proxima.valor_objetivo)}`
      })
    }
  }

  // ── Sugestões Personalizadas ──────────────────────────────────────────
  const cortesOrcamento: string[] = []
  orcLista.forEach((o: any) => {
    const perc = o.limite > 0 ? pct(o.gasto, o.limite) : 0
    if (perc > 100) cortesOrcamento.push(`${o.categoria}: orçamento estourado em ${fmt(o.gasto - o.limite)} — reduza para ${fmt(o.limite)}`)
    else if (perc > 85) cortesOrcamento.push(`${o.categoria}: ${perc.toFixed(0)}% do orçamento (${fmt(o.gasto)} de ${fmt(o.limite)}) — atenção`)
  })
  if (cortesOrcamento.length === 0 && cats.length > 0) {
    const top = cats[0] as any
    cortesOrcamento.push(`${top.categoria}: maior gasto do mês (${fmt(top.total)}) — avalie se cabe redução de 10%`)
    if (cats[1]) {
      const s = cats[1] as any
      cortesOrcamento.push(`${s.categoria}: ${fmt(s.total)}/mês — veja se tem espaço para redução`)
    }
  }

  const otimizacoes: string[] = []
  if (faturaCartaoMes > 0 && receita > 0 && pct(faturaCartaoMes, receita) > 30)
    otimizacoes.push(`Fatura de cartão (${fmt(faturaCartaoMes)}) representa ${pct(faturaCartaoMes, receita).toFixed(0)}% da renda — considere pagar mais no débito`)
  if (utilizacaoCartao > 50)
    otimizacoes.push(`Utilização do cartão em ${utilizacaoCartao.toFixed(0)}% — tente manter abaixo de 30% do limite`)
  if (taxaMaxFin > 10)
    otimizacoes.push(`Portabilidade do financiamento pode economizar ${fmt((taxaMaxFin - 10) / 100 / 12 * saldoFin)}/mês`)
  if (previsibilidade < 50 && receita > 0)
    otimizacoes.push('Menos de 50% do fluxo é previsível — considere cadastrar recorrências para melhorar o planejamento')
  if (otimizacoes.length === 0)
    otimizacoes.push('Continue o bom trabalho! Revise a carteira de investimentos a cada 6 meses.')

  // ── Próxima ação prioritária ──────────────────────────────────────────
  let proximaAcao = 'Cadastre receitas e despesas para ativar a análise completa'
  if (receita > 0) {
    if (saldoMes < 0) proximaAcao = `Cortar ${fmt(Math.abs(saldoMes))} em gastos para zerar o déficit`
    else if (!reservaAdequada) proximaAcao = `Depositar ${fmt(Math.max(100, (reservaIdeal - valorReserva) / 12))}/mês na reserva de emergência`
    else if (taxaMaxDivida > 15) proximaAcao = 'Quitar dívidas com juros acima de 15% a.a. usando o método avalanche'
    else if (totalInvest === 0) proximaAcao = 'Fazer o primeiro aporte em Tesouro Selic (qualquer valor)'
    else proximaAcao = 'Revisar carteira e aumentar aporte mensal conforme perfil'
  }

  // Conquista
  await c.env.DB.prepare(
    `INSERT OR IGNORE INTO conquistas_usuario (user_id, conquista_codigo, visualizado) VALUES (?, 'analista', 0)`
  ).bind(uid).run().catch(() => {})

  // ── Salvar score no histórico mensal (fire-and-forget) ──────────────────
  // M12: Assinaturas ─────────────────────────────────────────────────────────
  const todasSubs      = (assinaturasRaw.results as any[])
  const subsAtivas     = todasSubs.filter(s => s.status !== 'cancelled' && s.user_feedback !== 'reduced_plan')
  const subsReduzidas  = todasSubs.filter(s => s.user_feedback === 'reduced_plan')
  const subsCanceladas = todasSubs.filter(s => s.status === 'cancelled')

  const custoMensalAtivo = subsAtivas.reduce((s, d) => s + (d.amount || 0), 0)
  const custoAnualAtivo  = subsAtivas.reduce((s, d) => s + (d.yearly_cost || 0), 0)

  const economiaMensalReducao = subsReduzidas.reduce((s, d) =>
    s + Math.max(0, (d.valor_antigo || 0) - (d.amount || 0)), 0)
  const economiaAnualReducao = economiaMensalReducao * 12

  const economiaMensalCanc = subsCanceladas.reduce((s, d) => s + (d.amount || 0), 0)
  const economiaAnualCanc  = subsCanceladas.reduce((s, d) => s + (d.yearly_cost || 0), 0)

  const hoje360 = new Date()
  const economiaAcumReduc = subsReduzidas.reduce((s, d) => {
    const dt = d.reduced_at ? new Date(d.reduced_at) : hoje360
    const meses = Math.max(0, Math.floor((hoje360.getTime() - dt.getTime()) / (1000 * 60 * 60 * 24 * 30)))
    return s + meses * Math.max(0, (d.valor_antigo || 0) - (d.amount || 0))
  }, 0)

  const assinaturasBloco = {
    total_ativas:          subsAtivas.length,
    total_reduzidas:       subsReduzidas.length,
    total_canceladas:      subsCanceladas.length,
    custo_mensal_ativo:    Math.round(custoMensalAtivo * 100) / 100,
    custo_anual_ativo:     Math.round(custoAnualAtivo * 100) / 100,
    economia_mensal_reducoes:     Math.round(economiaMensalReducao * 100) / 100,
    economia_anual_reducoes:      Math.round(economiaAnualReducao * 100) / 100,
    economia_acumulada_reducoes:  Math.round(economiaAcumReduc * 100) / 100,
    economia_mensal_cancelamentos: Math.round(economiaMensalCanc * 100) / 100,
    economia_anual_cancelamentos:  Math.round(economiaAnualCanc * 100) / 100,
    economia_total_mensal: Math.round((economiaMensalReducao + economiaMensalCanc) * 100) / 100,
    economia_total_anual:  Math.round((economiaAnualReducao + economiaAnualCanc) * 100) / 100,
    top_3: subsAtivas.slice(0, 3).map(d => ({
      nome: d.service_nome || d.original_description,
      valor: d.amount,
      yearly: d.yearly_cost,
    }))
  }
  // ── Antecipação de Contas ─────────────────────────────────────────────────
  let antecipacaoBloco = { total_antecipadas: 0, total_economizado: 0, pendentes: 0 }
  try {
    const ants = await c.env.DB.prepare(
      `SELECT status, SUM(economia_juros) as economia FROM antecipacoes WHERE user_id=? GROUP BY status`
    ).bind(uid).all<any>()
    const rowsAnt = ants.results || []
    antecipacaoBloco = {
      total_antecipadas: rowsAnt.find(r => r.status === 'antecipada')?.count || (rowsAnt.find(r => r.status === 'antecipada') ? 1 : 0),
      total_economizado: Math.round((rowsAnt.find(r => r.status === 'antecipada')?.economia || 0) * 100) / 100,
      pendentes: rowsAnt.find(r => r.status === 'pendente')?.count || 0
    }
    // Contar separadamente
    const cntAnt = await c.env.DB.prepare(
      `SELECT status, COUNT(*) as cnt, SUM(economia_juros) as eco FROM antecipacoes WHERE user_id=? GROUP BY status`
    ).bind(uid).all<any>()
    const cntRows = cntAnt.results || []
    antecipacaoBloco = {
      total_antecipadas: Number(cntRows.find(r => r.status === 'antecipada')?.cnt || 0),
      total_economizado: Math.round(Number(cntRows.find(r => r.status === 'antecipada')?.eco || 0) * 100) / 100,
      pendentes: Number(cntRows.find(r => r.status === 'pendente')?.cnt || 0)
    }
  } catch { /* tabela pode não existir */ }

  // ── Salvar score no histórico mensal (continua) ───────────────────────────
  const mesPeriodo = `${ano}-${mes}`
  c.env.DB.prepare(
    `INSERT OR REPLACE INTO score_historico
     (user_id, mes, score_geral, score_fluxo, score_reserva, score_dividas, score_investimentos, score_metas)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(uid, mesPeriodo, scoreGeral, sCashFlow, sEmergency, sDebt, sInvest, sGoals).run().catch(() => {})

  // ── Salvar snapshot de patrimônio (fire-and-forget) ──────────────────────
  const totalDividasSnap = saldoEmp + saldoFin
  c.env.DB.prepare(
    `INSERT OR REPLACE INTO patrimonio_historico
     (user_id, mes, total_investimentos, total_reservas, total_dividas, patrimonio_liquido)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(uid, mesPeriodo, totalInvest, valorReserva, totalDividasSnap, totalInvest + valorReserva - totalDividasSnap).run().catch(() => {})

  return c.json({
    // Resumo executivo
    resumo_executivo: {
      veredicto: veredicto(scoreGeral),
      score_geral: scoreGeral,
      proxima_acao: proximaAcao,
      periodo: { mes, ano },
      gerado_em: now.toISOString()
    },

    // Scores por módulo
    scores: {
      geral:       scoreGeral,
      fluxo_caixa: sCashFlow,
      reserva:     sEmergency,
      dividas:     sDebt,
      investimentos: sInvest,
      metas:       sGoals
    },

    // Painel de dados reais (mini-KPIs)
    kpis: {
      receita_mes:         receita,
      despesa_mes:         despesa,
      saldo_mes:           saldoMes,
      taxa_poupanca_pct:   taxaPoupanca,
      total_investimentos: totalInvest,
      rentab_carteira_pct: rentabCarteira,
      total_dividas:       totalDivida,
      comprometimento_pct: pct(parcelaTotal, receita),
      fatura_cartao_mes:   faturaCartaoMes,
      reserva_meses:       Math.round(mesesCobertos * 10) / 10,
      reserva_pct_meta:    Math.round(percReserva),
      utilizacao_cartao_pct: utilizacaoCartao,
      metas_count:         metasLista.length,
      perfil_investidor:   perfilLabel
    },

    // Alertas críticos (cruzamento de módulos)
    alertas_criticos: alertasCriticos.slice(0, 3),

    // Análise modular detalhada
    analise_modular: {
      fluxo_caixa: {
        status: statusFluxo,
        cor: statusColor(statusFluxo),
        score: sCashFlow,
        mensagem: msgFluxo,
        recomendacao: recFluxo,
        dados: {
          receita,
          despesa,
          saldo: saldoMes,
          taxa_poupanca: taxaPoupanca,
          top_categorias: cats.slice(0, 5).map((c: any) => ({ nome: c.categoria, valor: c.total, pct: pct(c.total, receita) }))
        }
      },
      reserva_emergencia: {
        status: statusRes,
        cor: statusColor(statusRes),
        score: sEmergency,
        mensagem: msgRes,
        recomendacao: recRes,
        dados: {
          valor_atual: valorReserva,
          valor_ideal: reservaIdeal,
          meses_cobertos: Math.round(mesesCobertos * 10) / 10,
          meses_objetivo: mesesObj,
          pct_atingido: Math.round(percReserva)
        }
      },
      dividas: {
        status: statusDiv,
        cor: statusColor(statusDiv),
        score: sDebt,
        mensagem: msgDiv,
        recomendacao: recDiv,
        dados: {
          total_divida: totalDivida,
          parcela_mensal: parcelaTotal,
          comprometimento_pct: pct(parcelaTotal, receita),
          taxa_max_aa: Math.round(taxaMaxDivida * 10) / 10,
          saldo_financiamentos: saldoFin,
          saldo_emprestimos: saldoEmp
        }
      },
      investimentos: {
        status: statusInv,
        cor: statusColor(statusInv),
        score: sInvest,
        mensagem: msgInv,
        recomendacao: recInv,
        dados: {
          total_atual: totalInvest,
          total_investido: totalInvestido,
          rentab_pct: rentabCarteira,
          por_tipo: tiposInvest,
          perfil: perfilLabel
        }
      },
      metas: {
        status: statusMetas,
        cor: statusColor(statusMetas),
        score: sGoals,
        mensagem: msgMetas,
        recomendacao: recMetas,
        dados: {
          total_ativas: metasLista.length,
          valor_objetivo: totalObjetivo,
          valor_atual: totalAtual,
          pct_atingido: pct(totalAtual, totalObjetivo),
          lista: metasLista.slice(0, 3).map((m: any) => ({
            nome: m.nome,
            categoria: m.categoria,
            progresso_pct: pct(m.valor_atual, m.valor_objetivo),
            falta: m.valor_objetivo - m.valor_atual
          }))
        }
      }
    },

    // M12 – Assinaturas
    assinaturas_resumo: assinaturasBloco,

    // M13 – Antecipações
    antecipacao_resumo: antecipacaoBloco,

    // Plano de ação 90 dias priorizado
    plano_acao: plano,

    // Sugestões personalizadas
    sugestoes: {
      cortes_orcamento: cortesOrcamento.slice(0, 4),
      otimizacoes: otimizacoes.slice(0, 4),
      regra_503020: receita > 0 ? {
        necessidades_ideal: fmt(receita * 0.5),
        desejos_ideal:      fmt(receita * 0.3),
        investimentos_ideal: fmt(receita * 0.2),
        necessidades_atual_pct: Math.round(pct(despesa * 0.7, receita)),
        poupanca_atual_pct: Math.round(taxaPoupanca)
      } : null
    }
  })
})

// ─── GET /api/ia/analise360 — alias para insights (resposta direta, sem redirect) ──
ia.get('/analise360', requireAuth, async (c) => {
  // Ao invés de redirect 302, fazer forward interno para insights
  // Preserva headers de autenticação
  const insightsUrl = new URL(c.req.url)
  insightsUrl.pathname = '/api/ia/insights'
  const forwardReq = new Request(insightsUrl.toString(), {
    method: 'GET',
    headers: c.req.raw.headers
  })
  return fetch(forwardReq)
})

// ─── GET /api/ia/score-saude — score simplificado de saúde financeira ───────
ia.get('/score-saude', requireAuth, async (c) => {
  const user = c.get('user')
  const uid = user.id
  const now = new Date()
  const mes = String(now.getMonth() + 1).padStart(2, '0')
  const ano = String(now.getFullYear())

  try {
    const [recRow, despRow, reservaRow, dividaRow] = await Promise.all([
      c.env.DB.prepare(`SELECT COALESCE(SUM(valor),0) as total FROM receitas WHERE user_id=? AND strftime('%m',data)=? AND strftime('%Y',data)=?`).bind(uid,mes,ano).first() as any,
      c.env.DB.prepare(`SELECT COALESCE(SUM(valor),0) as total FROM despesas WHERE user_id=? AND strftime('%m',data)=? AND strftime('%Y',data)=? AND status!='cancelado'`).bind(uid,mes,ano).first() as any,
      // Soma reserva_emergencia (legada) + specialized_reserves
      c.env.DB.prepare(`
        SELECT COALESCE(
          (SELECT SUM(valor_atual) FROM reserva_emergencia WHERE user_id=?),0
        ) + COALESCE(
          (SELECT SUM(current_amount) FROM specialized_reserves WHERE user_id=? AND status!='cancelled'),0
        ) as total
      `).bind(uid, uid).first() as any,
      c.env.DB.prepare(`SELECT COALESCE(SUM(saldo_devedor),0) as total FROM emprestimos WHERE user_id=? AND status='ativo'`).bind(uid).first() as any,
    ])

    const receita = Number(recRow?.total || 0)
    const despesa = Number(despRow?.total || 0)
    const reserva = Number(reservaRow?.total || 0)
    const divida  = Number(dividaRow?.total || 0)
    const saldo   = receita - despesa

    // Score simples 0-100
    const sCF  = receita > 0 ? Math.min(30, Math.round((saldo / receita) * 100)) : 0
    const sRes = receita > 0 ? Math.min(25, Math.round((reserva / (receita * 3)) * 25)) : 0
    const sDiv = receita > 0 ? Math.max(0, 25 - Math.round((divida / receita) * 5)) : 25
    const sBase = 20
    const score = Math.min(100, Math.max(0, sBase + sCF + sRes + sDiv))

    const status = score >= 80 ? 'EXCELENTE' : score >= 55 ? 'BOM' : score >= 35 ? 'ATENCAO' : 'CRITICO'
    const veredicto = score >= 85 ? '🏆 Saúde Financeira Excelente' : score >= 70 ? '✅ Finanças Bem Organizadas' : score >= 55 ? '⚡ Momento de Construção' : score >= 35 ? '⚠️ Atenção Necessária' : '🚨 Situação Crítica'

    return c.json({ score, status, veredicto, kpis: { receita, despesa, saldo, reserva, divida }, periodo: { mes, ano } })
  } catch (e: any) {
    return c.json({ score: 0, status: 'CRITICO', veredicto: '⚠️ Dados insuficientes', error: e.message }, 200)
  }
})

// ─── GET /api/ia/score-historico — histórico mensal do score ─────────────────
ia.get('/score-historico', requireAuth, async (c) => {
  const user = c.get('user')
  try {
    const rows = await c.env.DB.prepare(
      `SELECT mes, score_geral, score_fluxo, score_reserva, score_dividas, score_investimentos, score_metas
       FROM score_historico WHERE user_id = ? ORDER BY mes ASC LIMIT 24`
    ).bind(user.id).all()
    return c.json({ historico: rows.results || [] })
  } catch {
    return c.json({ historico: [] })
  }
})

// ─── GET /api/ia/patrimonio-historico — snapshots mensais de patrimônio ──────
ia.get('/patrimonio-historico', requireAuth, async (c) => {
  const user = c.get('user')
  try {
    const rows = await c.env.DB.prepare(
      `SELECT mes, total_investimentos, total_reservas, total_dividas, patrimonio_liquido
       FROM patrimonio_historico WHERE user_id = ? ORDER BY mes ASC LIMIT 24`
    ).bind(user.id).all()
    return c.json({ historico: rows.results || [] })
  } catch {
    return c.json({ historico: [] })
  }
})

// ─── POST /api/ia/insights — Gera insights personalizados com IA ──────────────────────
// Analisa os dados financeiros e retorna insights acionáveis via OpenAI
ia.post('/insights', requireAuth, async (c) => {
  const user = c.get('user')
  try {
    const now  = new Date()
    const mes  = String(now.getMonth() + 1).padStart(2, '0')
    const ano  = String(now.getFullYear())
    const uid  = user.id

    // Buscar dados financeiros completos
    const [recRow, despRow, topCats, investRow, reservaRow, dividaRow, metasRow, recorRow, perfilRow] = await Promise.all([
      c.env.DB.prepare(`SELECT COALESCE(SUM(valor),0) as total FROM receitas WHERE user_id=? AND strftime('%m',data)=? AND strftime('%Y',data)=?`).bind(uid,mes,ano).first() as any,
      c.env.DB.prepare(`SELECT COALESCE(SUM(valor),0) as total FROM despesas WHERE user_id=? AND strftime('%m',data)=? AND strftime('%Y',data)=? AND status!='cancelado'`).bind(uid,mes,ano).first() as any,
      c.env.DB.prepare(`SELECT categoria, COALESCE(SUM(valor),0) as total FROM despesas WHERE user_id=? AND strftime('%m',data)=? AND strftime('%Y',data)=? AND status!='cancelado' GROUP BY categoria ORDER BY total DESC LIMIT 5`).bind(uid,mes,ano).all() as any,
      c.env.DB.prepare(`SELECT COALESCE(SUM(valor_atual),0) as total, COUNT(*) as cnt FROM investimentos WHERE user_id=?`).bind(uid).first() as any,
      c.env.DB.prepare(`SELECT COALESCE(SUM(current_amount),0) as total FROM specialized_reserves WHERE user_id=? AND status!='cancelled'`).bind(uid).first() as any,
      c.env.DB.prepare(`SELECT COALESCE(SUM(saldo_devedor),0) as total FROM emprestimos WHERE user_id=? AND status='ativo'`).bind(uid).first() as any,
      c.env.DB.prepare(`SELECT COUNT(*) as cnt, COALESCE(SUM(valor_objetivo),0) as obj, COALESCE(SUM(valor_atual),0) as atual FROM metas WHERE user_id=? AND status='ativo'`).bind(uid).first() as any,
      c.env.DB.prepare(`SELECT COUNT(*) as cnt, COALESCE(SUM(CASE WHEN tipo='despesa' THEN valor ELSE 0 END),0) as desp FROM recorrencias WHERE user_id=? AND ativa=1`).bind(uid).first() as any,
      c.env.DB.prepare(`SELECT perfil_investidor, salario_mensal, situacao_emprego FROM users WHERE id=?`).bind(uid).first() as any,
    ])

    const receita  = Number(recRow?.total || 0)
    const despesa  = Number(despRow?.total || 0)
    const saldo    = receita - despesa
    const poupanca = receita > 0 ? (saldo / receita * 100).toFixed(1) : '0'
    const topCatsStr = (topCats.results || []).map((c: any) => `${c.categoria}: R$${Number(c.total).toFixed(2)}`).join(', ')
    const perfil   = perfilRow?.perfil_investidor || 'moderado'

    const sugestoesInv: Record<string, string> = {
      conservador: 'Tesouro Selic, CDB diário, LCI/LCA, Poupança. Priorize liquidez e segurança.',
      moderado: 'CDB 100%+ CDI, Tesouro IPCA+, fundos multimercado. Até 20% em FII ou ações blue chips.',
      arrojado: 'Ações (IBOV/ETFs), FIIs, até 10% cripto. Horizonte longo, diversifique globalmente.',
    }

    const prompt = `Você é um consultor financeiro pessoal especializado em finanças brasileiras.

Dados financeiros do usuário ${user.nome} (mês ${mes}/${ano}):
- Receitas: R$ ${receita.toFixed(2)}
- Despesas: R$ ${despesa.toFixed(2)}
- Saldo: R$ ${saldo.toFixed(2)} (poupança: ${poupanca}%)
- Top categorias de gasto: ${topCatsStr || 'nenhuma registrada'}
- Investimentos: R$ ${Number(investRow?.total || 0).toFixed(2)} (${investRow?.cnt || 0} ativos)
- Reserva de emergência: R$ ${Number(reservaRow?.total || 0).toFixed(2)}
- Dívidas ativas: R$ ${Number(dividaRow?.total || 0).toFixed(2)}
- Metas ativas: ${metasRow?.cnt || 0} (objetivo: R$ ${Number(metasRow?.obj || 0).toFixed(2)}, atual: R$ ${Number(metasRow?.atual || 0).toFixed(2)})
- Recorrências: ${recorRow?.cnt || 0} ativas (R$ ${Number(recorRow?.desp || 0).toFixed(2)}/mês)
- Perfil investidor: ${perfil}
- Sugestões de investimento para esse perfil: ${sugestoesInv[perfil] || sugestoesInv.moderado}

Gere exatamente 5 insights financeiros personalizados e acionáveis. Cada insight deve:
1. Ser baseado nos dados reais acima (não invente dados)
2. Ter uma ação concreta que o usuário pode fazer HOJE
3. Ser específico para o perfil investidor ${perfil}

Retorne EXCLUSIVAMENTE um JSON válido:
{
  "insights": [
    {
      "titulo": "Título curto (máx 50 chars)",
      "conteudo": "Explicação + ação concreta (máx 150 chars)",
      "tipo": "alerta|dica|conquista|investimento|economia",
      "prioridade": "alta|media|baixa",
      "categoria": "fluxo_caixa|investimentos|economia|dividas|metas|reserva"
    }
  ]
}`

    const apiKey  = c.env.OPENAI_API_KEY
    const baseUrl = (c.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '')

    const aiRes = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'gpt-5-mini',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 1000,
        temperature: 0.6,
      })
    })

    if (!aiRes.ok) {
      return c.json({ error: 'Erro na API de IA', insights: [] }, 500)
    }

    const aiData: any = await aiRes.json()
    const content = aiData?.choices?.[0]?.message?.content || ''
    const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/) || content.match(/(\{[\s\S]*\})/)
    const jsonStr = jsonMatch ? (jsonMatch[1] || jsonMatch[0]) : content

    let parsed: any
    try { parsed = JSON.parse(jsonStr) } catch { parsed = { insights: [] } }

    const insights = (parsed.insights || []).slice(0, 5)

    // Salvar insights no banco (substituindo os do dia)
    await c.env.DB.prepare(`DELETE FROM ia_insights WHERE user_id=? AND date(data_criacao)=date('now')`).bind(uid).run().catch(() => {})
    for (const ins of insights) {
      await c.env.DB.prepare(`
        INSERT INTO ia_insights (user_id, tipo, titulo, conteudo, prioridade, categoria, lido, valido_ate)
        VALUES (?, ?, ?, ?, ?, ?, 0, datetime('now', '+7 days'))
      `).bind(uid, ins.tipo || 'dica', ins.titulo || '', ins.conteudo || '', ins.prioridade || 'media', ins.categoria || 'geral').run().catch(() => {})
    }

    return c.json({ insights, perfil_investidor: perfil, periodo: { mes, ano }, total: insights.length })

  } catch (e: any) {
    return c.json({ error: 'Erro ao gerar insights: ' + e.message, insights: [] }, 500)
  }
})

// ─── GET /api/ia/insights — Retorna insights salvos no banco ─────────────────────
ia.get('/insights', requireAuth, async (c) => {
  const user = c.get('user')
  try {
    const rows = await c.env.DB.prepare(`
      SELECT * FROM ia_insights WHERE user_id=? ORDER BY
        CASE prioridade WHEN 'alta' THEN 1 WHEN 'media' THEN 2 ELSE 3 END,
        data_criacao DESC LIMIT 10
    `).bind(user.id).all()
    return c.json({ insights: rows.results || [] })
  } catch (e: any) {
    return c.json({ insights: [], error: e.message })
  }
})

// ─── POST /api/ia/tag-sugestao — Sugere a melhor tag para uma despesa ─────────
ia.post('/tag-sugestao', requireAuth, async (c) => {
  const { descricao, categoria, tags } = await c.req.json().catch(() => ({} as any))
  if (!descricao) return c.json({ error: 'Descricao obrigatoria' }, 400)

  const tagsLista: Array<{ id: string; nome: string }> = tags || []
  if (tagsLista.length === 0) return c.json({ tag_sugerida: null, sugestao: 'nenhuma' })

  // Correspondencia local sem IA: normaliza descricao e compara com nomes de tags
  const normalizar = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, ' ').trim()
  const descNorm = normalizar(descricao)
  const catNorm = normalizar(categoria || '')

  let melhorTag: string | null = null
  let melhorScore = 0

  for (const t of tagsLista) {
    const tagNorm = normalizar(t.nome)
    const tagTokens = tagNorm.split(/\s+/).filter(w => w.length > 2)
    let score = 0
    for (const token of tagTokens) {
      if (descNorm.includes(token)) score += 2
      if (catNorm.includes(token)) score += 1
    }
    if (score > melhorScore) { melhorScore = score; melhorTag = t.nome }
  }

  return c.json({ tag_sugerida: melhorScore > 0 ? melhorTag : null, sugestao: melhorScore > 0 ? melhorTag : 'nenhuma' })
})

export default ia
