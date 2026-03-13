import { Hono } from 'hono'
import { requireAuth } from './auth'
import { getLimites, MSG_UPGRADE } from './planos'

type Bindings = { DB: D1Database }
type Variables = { user: { id: number; nome: string; email: string; plano: string } }

const ia = new Hono<{ Bindings: Bindings; Variables: Variables }>()

// GET /api/ia/insights — Análise financeira inteligente (sem IA externa, algoritmo local)
ia.get('/insights', requireAuth, async (c) => {
  const user = c.get('user')

  // Verifica plano
  const lim = getLimites(user.plano)
  if (!lim.ia_insights) {
    return c.json({ error: MSG_UPGRADE.ia_insights, upgrade: true, feature: 'ia_insights' }, 403)
  }

  const now = new Date()
  const mes = String(now.getMonth() + 1).padStart(2, '0')
  const ano = String(now.getFullYear())

  // Coletar dados financeiros do usuário
  const receitasMes = await c.env.DB.prepare(
    `SELECT COALESCE(SUM(valor), 0) as total FROM receitas WHERE user_id = ? AND strftime('%m', data) = ? AND strftime('%Y', data) = ?`
  ).bind(user.id, mes, ano).first() as any

  const despesasMes = await c.env.DB.prepare(
    `SELECT COALESCE(SUM(valor), 0) as total FROM despesas WHERE user_id = ? AND strftime('%m', data) = ? AND strftime('%Y', data) = ?`
  ).bind(user.id, mes, ano).first() as any

  const catDespesas = await c.env.DB.prepare(
    `SELECT categoria, SUM(valor) as total FROM despesas WHERE user_id = ? AND strftime('%m', data) = ? AND strftime('%Y', data) = ? GROUP BY categoria ORDER BY total DESC`
  ).bind(user.id, mes, ano).all()

  const totalInvest = await c.env.DB.prepare(
    `SELECT COALESCE(SUM(valor_atual), 0) as total, COALESCE(SUM(valor_investido), 0) as investido FROM investimentos WHERE user_id = ?`
  ).bind(user.id).first() as any

  const metasAtivas = await c.env.DB.prepare(
    `SELECT COUNT(*) as total, COALESCE(SUM(valor_objetivo), 0) as obj, COALESCE(SUM(valor_atual), 0) as atual FROM metas WHERE user_id = ? AND status = 'ativa'`
  ).bind(user.id).first() as any

  const emprestimosAtivos = await c.env.DB.prepare(
    `SELECT COALESCE(SUM(saldo_devedor), 0) as total, COALESCE(SUM(valor_parcela), 0) as parcelas FROM emprestimos WHERE user_id = ? AND status = 'ativo'`
  ).bind(user.id).first() as any

  const financiamentosAtivos = await c.env.DB.prepare(
    `SELECT COALESCE(SUM(saldo_devedor), 0) as total, COALESCE(SUM(valor_parcela), 0) as parcelas FROM financiamentos WHERE user_id = ? AND status = 'ativo'`
  ).bind(user.id).first() as any

  // Reserva de emergência real
  const reservaReal = await c.env.DB.prepare(
    `SELECT valor_atual, objetivo_meses FROM reserva_emergencia WHERE user_id = ? LIMIT 1`
  ).bind(user.id).first() as any

  // Média de despesas mensais (últimos 3 meses) para cálculo da reserva ideal
  const mediaDesp = await c.env.DB.prepare(
    `SELECT COALESCE(AVG(total_mes), 0) as media FROM (
      SELECT SUM(valor) as total_mes FROM despesas WHERE user_id = ? AND data >= date('now','-3 months')
      GROUP BY strftime('%Y-%m', data)
    )`
  ).bind(user.id).first() as any

  const receita = receitasMes?.total || 0
  const despesa = despesasMes?.total || 0
  const saldo = receita - despesa
  const totalInvestAtual = totalInvest?.total || 0
  const totalInvestido = totalInvest?.investido || 0
  const totalDividas = (emprestimosAtivos?.total || 0) + (financiamentosAtivos?.total || 0)
  const parcelasTotal = (emprestimosAtivos?.parcelas || 0) + (financiamentosAtivos?.parcelas || 0)

  const insights: any[] = []
  const agora = new Date().toISOString()
  const validade = new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString()

  // === ANÁLISE 1: Equilíbrio receitas x despesas ===
  if (receita > 0) {
    const taxaDespesa = (despesa / receita) * 100
    const taxaPoupanca = ((receita - despesa) / receita) * 100

    if (taxaDespesa > 90) {
      insights.push({
        tipo: 'alerta', titulo: '🚨 Gastos Críticos', prioridade: 'alta', categoria: 'orcamento',
        conteudo: `Suas despesas representam ${taxaDespesa.toFixed(1)}% da sua renda. Você está gastando quase tudo que ganha. Revise urgentemente categorias de maior gasto e identifique o que pode cortar.`
      })
    } else if (taxaDespesa > 70) {
      insights.push({
        tipo: 'atencao', titulo: '⚠️ Gastos Elevados', prioridade: 'alta', categoria: 'orcamento',
        conteudo: `Suas despesas consomem ${taxaDespesa.toFixed(1)}% da sua renda. O recomendado pela regra 50/30/20 é manter gastos essenciais abaixo de 50%. Analise onde pode economizar para chegar em pelo menos 30% de poupança.`
      })
    } else if (taxaPoupanca >= 20) {
      insights.push({
        tipo: 'positivo', titulo: '✅ Excelente Taxa de Poupança!', prioridade: 'baixa', categoria: 'orcamento',
        conteudo: `Parabéns! Você está poupando ${taxaPoupanca.toFixed(1)}% da sua renda este mês. Continue assim. O ideal é manter essa disciplina e direcionar esse excedente para investimentos de médio e longo prazo.`
      })
    }
  } else {
    insights.push({
      tipo: 'info', titulo: '📊 Comece Registrando Receitas', prioridade: 'media', categoria: 'habitos',
      conteudo: 'Nenhuma receita registrada este mês. Para uma análise precisa, adicione todas suas fontes de renda: salário, freelances, rendimentos de investimentos, etc.'
    })
  }

  // === ANÁLISE 2: Categoria mais gasta ===
  if ((catDespesas.results as any[]).length > 0) {
    const maisCara = catDespesas.results[0] as any
    if (receita > 0) {
      const percCat = (maisCara.total / receita) * 100
      if (percCat > 30) {
        insights.push({
          tipo: 'atencao', titulo: `💡 ${maisCara.categoria} Consome ${percCat.toFixed(0)}%`, prioridade: 'alta', categoria: 'gastos',
          conteudo: `A categoria "${maisCara.categoria}" é responsável por ${percCat.toFixed(1)}% da sua renda (${formatMoney(maisCara.total)}). Tente criar um limite mensal para esta categoria e encontrar formas de reduzir sem impactar sua qualidade de vida.`
        })
      }
    }
  }

  // === ANÁLISE 3: Investimentos ===
  if (totalInvestido > 0) {
    const rentabilidade = ((totalInvestAtual - totalInvestido) / totalInvestido) * 100
    if (rentabilidade > 0) {
      insights.push({
        tipo: 'positivo', titulo: `📈 Carteira Rendeu +${rentabilidade.toFixed(2)}%`, prioridade: 'baixa', categoria: 'investimentos',
        conteudo: `Seu patrimônio investido cresceu ${rentabilidade.toFixed(2)}% (${formatMoney(totalInvestAtual - totalInvestido)} de lucro). Continue aportando regularmente para potencializar o efeito dos juros compostos.`
      })
    }
    if (receita > 0 && (totalInvestido / receita) < 0.1) {
      insights.push({
        tipo: 'sugestao', titulo: '💰 Aumente seus Investimentos', prioridade: 'media', categoria: 'investimentos',
        conteudo: `Você está investindo menos de 10% da sua renda. Especialistas financeiros recomendam investir pelo menos 10-15% ao mês. Considere automatizar aportes logo após receber seu salário.`
      })
    }
  } else {
    insights.push({
      tipo: 'sugestao', titulo: '🚀 Hora de Começar a Investir', prioridade: 'media', categoria: 'investimentos',
      conteudo: 'Você ainda não registrou investimentos. O melhor momento para começar é agora! Para perfis conservadores, comece com Tesouro Selic ou CDB de bancos sólidos. Mesmo R$ 100/mês faz diferença no longo prazo.'
    })
  }

  // === ANÁLISE 4: Dívidas ===
  if (totalDividas > 0 && receita > 0) {
    const comprometimento = (parcelasTotal / receita) * 100
    if (comprometimento > 30) {
      insights.push({
        tipo: 'alerta', titulo: `🔴 ${comprometimento.toFixed(0)}% da Renda em Dívidas`, prioridade: 'alta', categoria: 'dividas',
        conteudo: `Suas parcelas de empréstimos e financiamentos comprometem ${comprometimento.toFixed(1)}% da sua renda mensal (${formatMoney(parcelasTotal)}). O recomendado é manter abaixo de 30%. Considere renegociar taxas ou quitação antecipada se possível.`
      })
    } else {
      insights.push({
        tipo: 'info', titulo: `📋 Dívidas Controladas (${comprometimento.toFixed(0)}%)`, prioridade: 'baixa', categoria: 'dividas',
        conteudo: `Suas dívidas comprometem ${comprometimento.toFixed(1)}% da sua renda, dentro do limite saudável (abaixo de 30%). Continue quitando regularmente e evite novos compromissos desnecessários.`
      })
    }
  }

  // === ANÁLISE 5: Reserva de emergência ===
  if (receita > 0 || (mediaDesp?.media || 0) > 0) {
    const mediaGastos = (mediaDesp?.media || 0) > 0 ? (mediaDesp?.media || 0) : despesa
    const mesesObj = reservaReal?.objetivo_meses || 6
    const reservaIdeal = mediaGastos * mesesObj
    const valorReserva = reservaReal?.valor_atual || 0

    if (!reservaReal) {
      insights.push({
        tipo: 'sugestao', titulo: '🛡️ Crie sua Reserva de Emergência', prioridade: 'alta', categoria: 'planejamento',
        conteudo: `Você ainda não criou sua reserva de emergência. O valor ideal é ${formatMoney(reservaIdeal)} (${mesesObj} meses de despesas ≈ ${formatMoney(mediaGastos)}/mês). Acesse "Reserva de Emergência" no menu para configurar e acompanhar seu progresso.`
      })
    } else if (valorReserva < reservaIdeal * 0.5) {
      const faltaReserva = reservaIdeal - valorReserva
      insights.push({
        tipo: 'atencao', titulo: '🛡️ Reserva de Emergência Insuficiente', prioridade: 'alta', categoria: 'planejamento',
        conteudo: `Sua reserva de emergência tem ${formatMoney(valorReserva)}, mas o ideal é ${formatMoney(reservaIdeal)} (${mesesObj} meses). Faltam ${formatMoney(faltaReserva)}. Priorize completar a reserva antes de investimentos de maior risco.`
      })
    } else if (valorReserva < reservaIdeal) {
      const percAtingido = Math.round((valorReserva / reservaIdeal) * 100)
      insights.push({
        tipo: 'sugestao', titulo: `🛡️ Reserva: ${percAtingido}% da Meta`, prioridade: 'media', categoria: 'planejamento',
        conteudo: `Sua reserva de emergência está em ${formatMoney(valorReserva)} (${percAtingido}% da meta). Faltam apenas ${formatMoney(reservaIdeal - valorReserva)} para atingir ${mesesObj} meses de cobertura.`
      })
    } else {
      insights.push({
        tipo: 'positivo', titulo: '🛡️ Reserva de Emergência Completa!', prioridade: 'baixa', categoria: 'planejamento',
        conteudo: `Excelente! Sua reserva de emergência cobre ${mesesObj} meses de despesas (${formatMoney(valorReserva)}). Com essa segurança, você pode direcionar excedentes para investimentos de maior rentabilidade.`
      })
    }
  }

  // === ANÁLISE 6: Metas ===
  if ((metasAtivas?.total || 0) > 0) {
    const percMeta = metasAtivas?.obj > 0 ? (metasAtivas.atual / metasAtivas.obj) * 100 : 0
    insights.push({
      tipo: 'info', titulo: `🎯 ${metasAtivas.total} Meta(s) em Andamento`, prioridade: 'baixa', categoria: 'metas',
      conteudo: `Você tem ${metasAtivas.total} meta(s) ativa(s) com ${percMeta.toFixed(1)}% do total acumulado (${formatMoney(metasAtivas.atual)} de ${formatMoney(metasAtivas.obj)}). Continue fazendo depósitos regulares!`
    })
  }

  // === ANÁLISE 7: Regra 50/30/20 ===
  if (receita > 0) {
    const ideal50 = receita * 0.5
    const ideal30 = receita * 0.3
    const ideal20 = receita * 0.2
    insights.push({
      tipo: 'dica', titulo: '📐 Sua Regra 50/30/20 Personalizada', prioridade: 'baixa', categoria: 'planejamento',
      conteudo: `Baseado na sua renda de ${formatMoney(receita)}: Essenciais (50%): ${formatMoney(ideal50)}/mês • Lazer/Desejos (30%): ${formatMoney(ideal30)}/mês • Poupança/Investimentos (20%): ${formatMoney(ideal20)}/mês. Use isso como referência para equilibrar seu orçamento.`
    })
  }

  // Salvar insights no banco (cache)
  await c.env.DB.prepare('DELETE FROM ia_insights WHERE user_id = ? AND valido_ate < datetime("now")').bind(user.id).run()

  // Verificar conquista de uso da IA
  await c.env.DB.prepare('INSERT OR IGNORE INTO conquistas_usuario (user_id, conquista_codigo, visualizado) VALUES (?, ?, 0)').bind(user.id, 'analista').run().catch(() => {})

  return c.json({
    insights,
    total_insights: insights.length,
    periodo: { mes, ano },
    dados_base: {
      receita_mes: receita,
      despesa_mes: despesa,
      saldo_mes: saldo,
      total_investimentos: totalInvestAtual,
      total_dividas: totalDividas,
      comprometimento_dividas: receita > 0 ? Math.round((parcelasTotal / receita) * 100) : 0,
      total_metas: metasAtivas?.total || 0,
      metas_valor_objetivo: metasAtivas?.obj || 0,
      metas_valor_atual: metasAtivas?.atual || 0
    }
  })
})

function formatMoney(v: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v || 0)
}

export default ia
