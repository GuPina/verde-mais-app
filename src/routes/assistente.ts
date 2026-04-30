// src/routes/assistente.ts
// Assistente IA Conversacional VerdeMais — v3.0 — OpenAI gpt-5-mini + perfil investidor

import { Hono } from 'hono'
import { requireAuth } from './auth'

type Bindings = { DB: D1Database; OPENAI_API_KEY: string; OPENAI_BASE_URL: string }
type Variables = { user: { id: number; nome: string; email: string; plano: string; perfil_investidor?: string } }

const assistente = new Hono<{ Bindings: Bindings; Variables: Variables }>()

// ── Tipos de intenção ─────────────────────────────────────────────────────────
type Intencao =
  | 'saldo'
  | 'gastos'
  | 'gastos_categoria'
  | 'metas'
  | 'investimentos'
  | 'dividas'
  | 'reservas'
  | 'economia'
  | 'cartao'
  | 'conquistas'
  | 'desafio52'
  | 'score'
  | 'projecao'
  | 'orcamento'
  | 'recorrencias'
  | 'lembretes'
  | 'regra503020'
  | 'amortizacao'
  | 'assinaturas'
  | 'comparativo'
  | 'ajuda'
  | 'elogio'
  | 'desconhecido'

// ── Normalizar texto para matching ───────────────────────────────────────────
function norm(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim()
}

// ── Detectar intenção a partir do texto ──────────────────────────────────────
function detectarIntencao(msg: string): Intencao {
  const t = norm(msg)

  // Score financeiro
  if (/score|saude financeira|nota financeira|health|minha nota|meu score|pontuacao|diagnostico/.test(t)) return 'score'
  // Saldo
  if (/saldo|sobrou|quanto tenho|dinheiro disponivel|sobra|tenho no mes|saldo do mes/.test(t)) return 'saldo'
  // Gastos por categoria específica
  if (/(gastei|gasto|gastando|despesa).*(moradia|aluguel|alimentacao|comida|transporte|saude|lazer|educacao|assinatura|cartao|servico|streaming)/.test(t) ||
      /(moradia|aluguel|alimentacao|comida|transporte|saude|lazer|educacao|assinatura|streaming).*(gasto|gastei|despesa|custo)/.test(t)) return 'gastos_categoria'
  // Gastos gerais
  if (/gasto|gastei|despesa|gastando|onde gasto|gasta|maiores gastos|categorias/.test(t)) return 'gastos'
  // Metas
  if (/meta|objetivo|sonho|quanto falta|progresso|quanto preciso guardar|minha meta/.test(t)) return 'metas'
  // Investimentos
  if (/investimento|aplicacao|rendimento|cdi|acoes|caixinha|fii|renda fixa|tesouro|carteira|patrimonio/.test(t)) return 'investimentos'
  // Amortização (DEVE vir antes de dívidas — 'financiamento' dispara ambos)
  if (/amortiz|pagar antecipado|reduzir parcela|quitar mais rapido|extra no financiamento/.test(t)) return 'amortizacao'
  // Dívidas
  if (/divida|emprestimo|financiamento|parcela|devo|quanto devo|debito|parcelado/.test(t)) return 'dividas'
  // Reservas
  if (/reserva|emergencia|fundo de emergencia|guardei|protecao|meses de reserva/.test(t)) return 'reservas'
  // Cartão
  if (/cartao|fatura|limite|credito|nubank|itau|bradesco|santander|limite do cartao/.test(t)) return 'cartao'
  // Conquistas
  if (/conquista|badge|medalha|pontos|gamificacao|premio/.test(t)) return 'conquistas'
  // Desafio 52
  if (/desafio|52 semanas|semana|desafio 52/.test(t)) return 'desafio52'
  // Projeção
  if (/projecao|previsao|futuro|proximo mes|daqui|tendencia|vai ser/.test(t)) return 'projecao'
  // Orçamento
  if (/orcamento|limite|budget|quanto posso gastar|teto de gasto/.test(t)) return 'orcamento'
  // Recorrências
  if (/recorrencia|fixo|mensal|todo mes|pagamentos fixos|conta fixa/.test(t)) return 'recorrencias'
  // Lembretes
  if (/lembrete|vencimento|pagar|data de pagamento|vencem/.test(t)) return 'lembretes'
  // Regra 50/30/20
  if (/50.30.20|regra|distribuicao|como dividir|como organizar a renda/.test(t)) return 'regra503020'
  // Amortização (duplicata removida — movida para antes de dívidas)
  // Assinaturas
  if (/assinatura|streaming|netflix|spotify|esqueci|cobran|assino|mensalidade esquecida/.test(t)) return 'assinaturas'
  // Comparativo
  if (/comparativo|comparar|mes anterior|variacao|mudou|cresceu|caiu|aumentou|diminuiu/.test(t)) return 'comparativo'
  // Economia
  if (/economiz|poupar|economia|como guardar|dica|conselho|cortar gasto|reduzir|gastar menos/.test(t)) return 'economia'
  // Elogio / conversa social
  if (/obrigad|valeu|otimo|excelente|muito bom|perfeito|top|show|parabens|legal|ajudou/.test(t)) return 'elogio'
  // Ajuda
  if (/ajuda|o que voce faz|o que voce sabe|comandos|funcoes|help|menu|opcoes|o que sabe|o que voces faz/.test(t)) return 'ajuda'

  return 'desconhecido'
}

// ── Buscar contexto financeiro completo do usuário ────────────────────────────
async function buscarContexto(db: D1Database, userId: number) {
  const now = new Date()
  const mes    = now.getMonth() + 1
  const ano    = now.getFullYear()
  const mesStr = String(mes).padStart(2, '0')
  const anoStr = String(ano)
  const mesAntInt  = mes === 1 ? 12 : mes - 1
  const anoAntInt  = mes === 1 ? ano - 1 : ano
  const mesAntStr  = String(mesAntInt).padStart(2, '0')
  const anoAntStr  = String(anoAntInt)

  const [
    receitasMes, despesasMes,
    receitasAnt, despesasAnt,
    metas, investimentos, emprestimos, financiamentos,
    reservas, conquistas, desafio, cartoes,
    topCategorias, topTags, lembretes,
    recorrencias, orcamentos, score
  ] = await Promise.all([
    // Receitas mês atual
    db.prepare(`SELECT COALESCE(SUM(valor),0) as total FROM receitas WHERE user_id=? AND strftime('%m',data)=? AND strftime('%Y',data)=?`).bind(userId, mesStr, anoStr).first() as Promise<any>,
    // Despesas mês atual
    db.prepare(`SELECT COALESCE(SUM(valor),0) as total, COUNT(*) as cnt FROM despesas WHERE user_id=? AND strftime('%m',data)=? AND strftime('%Y',data)=? AND status != 'cancelado'`).bind(userId, mesStr, anoStr).first() as Promise<any>,
    // Receitas mês anterior
    db.prepare(`SELECT COALESCE(SUM(valor),0) as total FROM receitas WHERE user_id=? AND strftime('%m',data)=? AND strftime('%Y',data)=?`).bind(userId, mesAntStr, anoAntStr).first() as Promise<any>,
    // Despesas mês anterior
    db.prepare(`SELECT COALESCE(SUM(valor),0) as total FROM despesas WHERE user_id=? AND strftime('%m',data)=? AND strftime('%Y',data)=?`).bind(userId, mesAntStr, anoAntStr).first() as Promise<any>,
    // Metas ativas
    db.prepare(`SELECT COUNT(*) as cnt, COALESCE(SUM(valor_objetivo),0) as total_obj, COALESCE(SUM(valor_atual),0) as total_atual FROM metas WHERE user_id=? AND status='ativo'`).bind(userId).first() as Promise<any>,
    // Investimentos
    db.prepare(`SELECT COUNT(*) as cnt, COALESCE(SUM(valor_atual),0) as total, COALESCE(SUM(valor_investido),0) as investido FROM investimentos WHERE user_id=?`).bind(userId).first() as Promise<any>,
    // Empréstimos ativos
    db.prepare(`SELECT COUNT(*) as cnt, COALESCE(SUM(saldo_devedor),0) as total, COALESCE(SUM(valor_parcela),0) as parcelas FROM emprestimos WHERE user_id=? AND status='ativo'`).bind(userId).first() as Promise<any>,
    // Financiamentos ativos
    db.prepare(`SELECT COUNT(*) as cnt, COALESCE(SUM(saldo_devedor),0) as total, COALESCE(SUM(valor_parcela),0) as parcelas FROM financiamentos WHERE user_id=? AND status='ativo'`).bind(userId).first() as Promise<any>,
    // Reservas especializadas
    db.prepare(`SELECT COUNT(*) as cnt, COALESCE(SUM(current_amount),0) as total, COALESCE(SUM(target_amount),0) as meta FROM specialized_reserves WHERE user_id=? AND status IN ('active','completed')`).bind(userId).first() as Promise<any>,
    // Conquistas
    db.prepare(`SELECT COUNT(*) as cnt FROM conquistas_usuario WHERE user_id=?`).bind(userId).first() as Promise<any>,
    // Desafio 52 semanas
    db.prepare(`SELECT COUNT(*) as concluidas FROM weekly_challenges WHERE user_id=? AND status='completed' AND year=?`).bind(userId, anoStr).first() as Promise<any>,
    // Cartões
    db.prepare(`SELECT COUNT(*) as cnt, COALESCE(SUM(limite_total),0) as total_limite, COALESCE(SUM(limite_disponivel),0) as disponivel FROM cartoes WHERE user_id=?`).bind(userId).first() as Promise<any>,
    // Top 5 categorias de despesas do mês
    db.prepare(`SELECT categoria, COALESCE(SUM(valor),0) as total FROM despesas WHERE user_id=? AND strftime('%m',data)=? AND strftime('%Y',data)=? AND status != 'cancelado' GROUP BY categoria ORDER BY total DESC LIMIT 5`).bind(userId, mesStr, anoStr).all() as Promise<any>,
    // Top tags do mês
    db.prepare(`SELECT t.nome, COALESCE(SUM(d.valor),0) as total FROM despesa_tags dt JOIN tags t ON t.id=dt.tag_id JOIN despesas d ON d.id=dt.despesa_id WHERE d.user_id=? AND strftime('%m',d.data)=? AND strftime('%Y',d.data)=? GROUP BY t.id ORDER BY total DESC LIMIT 3`).bind(userId, mesStr, anoStr).all() as Promise<any>,
    // Lembretes próximos (30 dias)
    db.prepare(`SELECT COUNT(*) as cnt FROM lembretes WHERE user_id=? AND ativo=1 AND proximo_vencimento <= date('now', '+30 days')`).bind(userId).first() as Promise<any>,
    // Recorrências ativas
    db.prepare(`SELECT COUNT(*) as cnt, COALESCE(SUM(CASE WHEN tipo='despesa' THEN valor ELSE 0 END),0) as total_desp, COALESCE(SUM(CASE WHEN tipo='receita' THEN valor ELSE 0 END),0) as total_rec FROM recorrencias WHERE user_id=? AND ativa=1`).bind(userId).first() as Promise<any>,
    // Orçamentos do mês
    db.prepare(`SELECT COUNT(*) as cnt, COALESCE(SUM(limite),0) as total_limite FROM orcamentos WHERE user_id=? AND mes=? AND ano=?`).bind(userId, mes, ano).first() as Promise<any>,
    // Score saúde + perfil investidor (do users)
    db.prepare(`SELECT score_saude, perfil_investidor, salario_mensal, situacao_emprego FROM users WHERE id=?`).bind(userId).first() as Promise<any>,
  ])

  const totalReceitas  = parseFloat(receitasMes?.total  || 0)
  const totalDespesas  = parseFloat(despesasMes?.total  || 0)
  const totalRecAnt    = parseFloat(receitasAnt?.total  || 0)
  const totalDespAnt   = parseFloat(despesasAnt?.total  || 0)
  const saldo          = totalReceitas - totalDespesas
  const taxaPoupanca   = totalReceitas > 0 ? (saldo / totalReceitas * 100) : 0

  return {
    totalReceitas, totalDespesas, totalRecAnt, totalDespAnt,
    saldo, taxaPoupanca,
    metas: metas as any,
    investimentos: investimentos as any,
    emprestimos: emprestimos as any,
    financiamentos: financiamentos as any,
    reservas: reservas as any,
    conquistas: conquistas as any,
    desafio: desafio as any,
    cartoes: cartoes as any,
    topCategorias: (topCategorias as any)?.results || [],
    topTags: (topTags as any)?.results || [],
    lembretes: lembretes as any,
    recorrencias: recorrencias as any,
    orcamentos: orcamentos as any,
    scoreSaude: (score as any)?.score_saude || null,
    perfilInvestidor: (score as any)?.perfil_investidor || 'moderado',
    salarioMensal: parseFloat((score as any)?.salario_mensal || 0),
    situacaoEmprego: (score as any)?.situacao_emprego || 'empregado',
    mes, ano, mesAntInt, anoAntInt,
    qtdDespesasMes: despesasMes?.cnt || 0,
  }
}

// ── Formatar moeda ────────────────────────────────────────────────────────────
function fmt(v: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v)
}

const MESES = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro']

// ── Gerar resposta baseada na intenção ────────────────────────────────────────
function gerarResposta(intencao: Intencao, ctx: Awaited<ReturnType<typeof buscarContexto>>, nome: string): string {
  const mesNome = MESES[ctx.mes - 1]
  const mesAntNome = MESES[ctx.mesAntInt - 1]
  const primeiro = nome.split(' ')[0]

  switch (intencao) {

    // ── SALDO ────────────────────────────────────────────────────────────────
    case 'saldo': {
      const emoji = ctx.saldo >= 0 ? '💚' : '🔴'
      const varDesp = ctx.totalDespAnt > 0
        ? ((ctx.totalDespesas - ctx.totalDespAnt) / ctx.totalDespAnt * 100).toFixed(0)
        : null
      const varDespStr = varDesp !== null
        ? ` (${parseFloat(varDesp) >= 0 ? '+' : ''}${varDesp}% vs ${mesAntNome})`
        : ''
      const analise = ctx.saldo >= 0
        ? ctx.taxaPoupanca >= 20
          ? '🎉 Taxa de poupança de ' + ctx.taxaPoupanca.toFixed(0) + '% — acima da meta de 20%! Excelente!'
          : ctx.taxaPoupanca >= 10
          ? '✅ Positivo, mas há espaço para poupar mais. Meta: 20% da renda.'
          : '⚡ Positivo, porém poupança abaixo de 10%. Revise gastos variáveis.'
        : '⚠️ Despesas superam a renda neste mês. Ação necessária!'
      return `${emoji} **Saldo de ${mesNome}:**\n\n💰 Receitas: **${fmt(ctx.totalReceitas)}**\n💸 Despesas: **${fmt(ctx.totalDespesas)}**${varDespStr}\n📊 Saldo líquido: **${fmt(ctx.saldo)}**\n💹 Taxa de poupança: ${ctx.taxaPoupanca.toFixed(1)}%\n\n${analise}`
    }

    // ── GASTOS GERAIS ────────────────────────────────────────────────────────
    case 'gastos': {
      const porc = ctx.totalReceitas > 0 ? (ctx.totalDespesas / ctx.totalReceitas * 100).toFixed(0) : '0'
      const alerta = parseFloat(porc) > 90 ? '🔴 Gastos críticos — você está comprometendo toda a renda!'
        : parseFloat(porc) > 75 ? '⚠️ Gastos elevados (acima de 75% da renda). Tente reduzir.'
        : '✅ Bom controle — gastos dentro do razoável.'
      const cats = ctx.topCategorias.slice(0, 5)
        .map((c: any) => `• **${c.categoria}**: ${fmt(parseFloat(c.total))}`)
        .join('\n')
      const tagsStr = ctx.topTags.length > 0
        ? `\n🏷️ **Por Tag:** ${ctx.topTags.map((t: any) => `#${t.nome} ${fmt(t.total)}`).join(' | ')}`
        : ''
      return `💸 **Gastos de ${mesNome}:**\n\nTotal: **${fmt(ctx.totalDespesas)}** (${porc}% da renda)\n${ctx.qtdDespesasMes} lançamento(s)\n\n${alerta}\n\n📊 **Top categorias:**\n${cats || 'Nenhuma despesa registrada ainda.'}${tagsStr}`
    }

    // ── GASTOS POR CATEGORIA ─────────────────────────────────────────────────
    case 'gastos_categoria': {
      const cats = ctx.topCategorias
      if (!cats || cats.length === 0) {
        return `📂 Você não tem despesas registradas em ${mesNome} ainda.\n\nAdicione despesas na aba **Despesas** para ver o detalhamento por categoria.`
      }
      const lista = cats.map((c: any, i: number) => `${i+1}. **${c.categoria}**: ${fmt(parseFloat(c.total))}`).join('\n')
      return `📂 **Gastos por categoria em ${mesNome}:**\n\n${lista}\n\n💡 Use **Orçamentos** para definir limites por categoria e receber alertas quando estiver próximo do teto.`
    }

    // ── SCORE FINANCEIRO ─────────────────────────────────────────────────────
    case 'score': {
      const score = ctx.scoreSaude
      if (score === null || score === undefined) {
        return `📊 **Score de Saúde Financeira:**\n\nAinda não calculamos seu score. Registre receitas e despesas por pelo menos um mês para gerar seu diagnóstico completo.\n\n💡 Acesse **Diagnóstico 360°** para uma análise detalhada quando tiver dados suficientes.`
      }
      const nivel = score >= 80 ? '🟢 **Excelente**' : score >= 60 ? '🟡 **Bom**' : score >= 40 ? '🟠 **Regular**' : '🔴 **Crítico**'
      const dica = score >= 80
        ? 'Continue assim! Você está no top dos usuários VerdeMais. 🏆'
        : score >= 60
        ? 'Bom caminho. Foque em aumentar a reserva de emergência e reduzir dívidas.'
        : score >= 40
        ? 'Atenção necessária. Prioridades: 1) Reserva emergência, 2) Quitar dívidas caras, 3) Diversificar renda.'
        : 'Situação crítica. Corte gastos não essenciais imediatamente e busque ampliar sua renda.'
      const aspectos = []
      if (parseFloat(ctx.reservas?.total || 0) === 0) aspectos.push('🔴 Reserva de emergência: inexistente')
      if (parseFloat(ctx.emprestimos?.total || 0) + parseFloat(ctx.financiamentos?.total || 0) > ctx.totalReceitas * 12) aspectos.push('⚠️ Dívidas acima de 12x a renda mensal')
      if (ctx.taxaPoupanca < 10) aspectos.push('⚠️ Taxa de poupança abaixo de 10%')
      if (parseFloat(ctx.investimentos?.total || 0) > 0) aspectos.push('✅ Investe regularmente')
      if (ctx.taxaPoupanca >= 20) aspectos.push('✅ Taxa de poupança excelente (≥20%)')
      return `📊 **Seu Score de Saúde Financeira:**\n\n${nivel} — **${score}/100**\n\n${aspectos.length > 0 ? aspectos.join('\n') + '\n\n' : ''}${dica}\n\n💡 Acesse **Diagnóstico 360°** para ver o plano de ação completo.`
    }

    // ── METAS ────────────────────────────────────────────────────────────────
    case 'metas': {
      const m = ctx.metas
      if (!m || m.cnt === 0) {
        return `🎯 Você ainda não tem metas financeiras cadastradas.\n\nDefinir metas é o primeiro passo para transformar sonhos em realidade! Exemplos:\n• 🏖️ Viagem — R$ 10.000 em 12 meses\n• 🏠 Entrada de imóvel — R$ 50.000 em 36 meses\n• 🚗 Carro — R$ 30.000 em 24 meses\n\nAcesse a aba **Metas** para criar sua primeira! Para atingir mais rápido: deposite mensalmente e habilite aportes automáticos.`
      }
      const porc = m.total_obj > 0 ? (parseFloat(m.total_atual) / parseFloat(m.total_obj) * 100).toFixed(1) : '0'
      const falta = parseFloat(m.total_obj) - parseFloat(m.total_atual)
      const aporteSugerido = ctx.totalReceitas > 0 ? Math.max(50, falta / 12) : 0
      return `🎯 **Suas Metas Financeiras:**\n\n📌 ${m.cnt} meta(s) ativa(s)\n💰 Acumulado: **${fmt(parseFloat(m.total_atual))}**\n🏁 Total objetivado: **${fmt(parseFloat(m.total_obj))}**\n📈 Progresso geral: **${porc}%**\n💸 Faltam: ${fmt(falta)}\n\n💡 Para concluir em 12 meses: aportar **${fmt(aporteSugerido)}/mês**\n\nAcesse **Metas** para ver cada meta individualmente e fazer depósitos.`
    }

    // ── INVESTIMENTOS ─────────────────────────────────────────────────────────
    case 'investimentos': {
      const inv = ctx.investimentos
      if (!inv || inv.cnt === 0) {
        return `📈 Você ainda não tem investimentos registrados.\n\n💡 **Por onde começar:**\n1. 🛡️ Primeiro: complete sua reserva de emergência (3-6 meses de gastos)\n2. 📊 Depois: Tesouro Selic ou CDB 100% CDI (liquidez diária)\n3. 📈 Com mais experiência: Ações, FIIs e Tesouro IPCA\n\nAcesse a aba **Investimentos** para registrar seus ativos e acompanhar a rentabilidade.`
      }
      const rentab = parseFloat(inv.investido) > 0
        ? ((parseFloat(inv.total) - parseFloat(inv.investido)) / parseFloat(inv.investido) * 100).toFixed(1)
        : '0'
      return `📈 **Seus Investimentos:**\n\n📊 ${inv.cnt} ativo(s) registrado(s)\n💰 Valor total atual: **${fmt(parseFloat(inv.total))}**\n💵 Total investido: ${fmt(parseFloat(inv.investido))}\n📈 Rentabilidade: **+${rentab}%**\n\n💡 Compare com o CDI atual (~14,9% a.a.) na aba **Investimentos**. Diversifique para reduzir risco.`
    }

    // ── DÍVIDAS ──────────────────────────────────────────────────────────────
    case 'dividas': {
      const emp = ctx.emprestimos
      const fin = ctx.financiamentos
      const totalDivida  = parseFloat(emp?.total || 0) + parseFloat(fin?.total || 0)
      const totalParcelas = parseFloat(emp?.parcelas || 0) + parseFloat(fin?.parcelas || 0)

      if (totalDivida === 0) {
        return `🎉 **Parabéns, ${primeiro}!** Nenhuma dívida ativa registrada.\n\nManter-se livre de dívidas é uma conquista enorme! A maioria das pessoas compromete 30-40% da renda com parcelas.\n\n💡 Com a renda liberada, aproveite para acelerar seus investimentos e reservas.`
      }
      const comprometimento = ctx.totalReceitas > 0
        ? (totalParcelas / ctx.totalReceitas * 100).toFixed(0)
        : '0'
      const alerta = parseFloat(comprometimento) > 30
        ? '⚠️ Comprometimento acima de 30% — situação de atenção. Considere amortização extra.'
        : '✅ Comprometimento abaixo de 30% — dentro do controlável.'
      return `💳 **Suas Dívidas:**\n\n📉 Saldo devedor total: **${fmt(totalDivida)}**\n💸 Parcelas mensais: **${fmt(totalParcelas)}**\n📊 Comprometimento da renda: **${comprometimento}%**\n\n${alerta}\n\n💡 Use o **Simulador de Amortização** para calcular quanto economizaria com um pagamento extra. Método recomendado: avalanche (quita a maior taxa de juros primeiro).`
    }

    // ── RESERVAS ─────────────────────────────────────────────────────────────
    case 'reservas': {
      const r = ctx.reservas
      const totalReservas = parseFloat(r?.total || 0)
      const metaReservas  = parseFloat(r?.meta  || 0)
      const porc = metaReservas > 0 ? Math.min(100, (totalReservas / metaReservas * 100)).toFixed(0) : '0'
      const reservaIdeal = ctx.totalDespesas * 6

      if (totalReservas === 0) {
        return `🛡️ **Reserva de Emergência:**\n\nVocê ainda não tem reserva cadastrada.\n\n📊 **Valor ideal para você:** ${fmt(reservaIdeal)}\n(6 meses × ${fmt(ctx.totalDespesas)}/mês)\n\n💡 **Como montar:**\n1. Separe ao menos 10% da renda mensalmente\n2. Guarde em CDB com liquidez diária ou Tesouro Selic\n3. Meta mínima: 3 meses. Meta ideal: 6 meses\n\nAcesse **Minhas Reservas** para começar agora!`
      }
      const status = parseFloat(porc) >= 100
        ? '🎉 Reservas completas! Você está muito bem protegido.'
        : parseFloat(porc) >= 50
        ? `✅ Boa evolução! Com ${fmt(totalReservas)} guardados, você tem ~${Math.round(totalReservas / (ctx.totalDespesas || 1) * 10)/10} meses de cobertura.`
        : `⚠️ Reserva ainda baixa. Faltam ${fmt(Math.max(0, reservaIdeal - totalReservas))} para 6 meses de cobertura.`
      return `🛡️ **Suas Reservas:**\n\n💰 Total guardado: **${fmt(totalReservas)}**\n🎯 Meta total: ${fmt(metaReservas)}\n📊 Progresso: **${porc}%**\n\n${status}`
    }

    // ── CARTÃO ───────────────────────────────────────────────────────────────
    case 'cartao': {
      const c = ctx.cartoes
      if (!c || c.cnt === 0) {
        return `💳 Você não tem cartões de crédito cadastrados.\n\nAdicione seus cartões na aba **Cartões** para:\n• Controlar limite disponível\n• Acompanhar a fatura do mês\n• Receber alertas de uso excessivo\n• Detectar assinaturas esquecidas`
      }
      const utilizado = parseFloat(c.total_limite) - parseFloat(c.disponivel)
      const uso = parseFloat(c.total_limite) > 0
        ? (utilizado / parseFloat(c.total_limite) * 100).toFixed(0)
        : '0'
      const alertaUso = parseFloat(uso) > 80
        ? '🔴 Uso do limite acima de 80% — cuidado com o endividamento!'
        : parseFloat(uso) > 50
        ? '⚠️ Uso moderado. Ideal é manter abaixo de 30% do limite.'
        : '✅ Uso dentro do recomendado.'
      return `💳 **Seus Cartões:**\n\n📊 ${c.cnt} cartão(ões) cadastrado(s)\n💰 Limite total: ${fmt(parseFloat(c.total_limite))}\n✅ Disponível: **${fmt(parseFloat(c.disponivel))}**\n💸 Utilizado: ${fmt(utilizado)} (${uso}%)\n\n${alertaUso}\n\n💡 Acesse **Cartões** para ver a fatura detalhada e receber alertas automáticos.`
    }

    // ── CONQUISTAS ────────────────────────────────────────────────────────────
    case 'conquistas': {
      const cnt = ctx.conquistas?.cnt || 0
      return `🏆 **Suas Conquistas:**\n\n🎖️ ${cnt} conquista(s) desbloqueada(s) de 105 disponíveis\n\n${cnt === 0
        ? '🌱 Comece registrando receitas, despesas e metas para desbloquear as primeiras medalhas!'
        : cnt < 10 ? '📈 Bom começo! Continue usando todas as funcionalidades do app.'
        : cnt < 30 ? '⭐ Usuário engajado! Explore as funcionalidades avançadas: Reservas, Desafio 52, Simulações...'
        : '🌟 Impressionante! Você está entre os usuários mais dedicados do VerdeMais.'}\n\n💡 Acesse **Conquistas** para ver o que falta desbloquear.`
    }

    // ── DESAFIO 52 SEMANAS ────────────────────────────────────────────────────
    case 'desafio52': {
      const d = ctx.desafio
      const concluidas = d?.concluidas || 0
      const economizado = Array.from({ length: concluidas }, (_: any, i: number) => i + 1).reduce((a: number, b: number) => a + b, 0)
      const faltam = 52 - concluidas
      const restante = Array.from({ length: faltam }, (_: any, i: number) => concluidas + i + 1).reduce((a: number, b: number) => a + b, 0)
      return `🗓️ **Desafio 52 Semanas (${ctx.ano}):**\n\n✅ Semanas concluídas: **${concluidas}/52**\n💰 Economizado: **R$ ${economizado.toFixed(2)}**\n🎯 Meta anual: R$ 1.378,00\n📊 Faltam: R$ ${restante.toFixed(2)} em ${faltam} semanas\n\n${concluidas === 0 ? '🚀 Comece hoje! Semana 1 = só R$1,00.' : concluidas >= 52 ? '🏆 Desafio concluído! Você economizou R$1.378 este ano.' : '💡 Acesse **Desafio 52** para marcar as próximas semanas.'}`
    }

    // ── PROJEÇÃO ──────────────────────────────────────────────────────────────
    case 'projecao': {
      const proximoMes = MESES[ctx.mes % 12]
      const mediaDesp = (ctx.totalDespesas + ctx.totalDespAnt) / 2
      const mediaRec  = (ctx.totalReceitas + ctx.totalRecAnt) / 2
      const saldoProj = mediaRec - mediaDesp
      return `🔮 **Projeção para ${proximoMes}:**\n\nCom base nos últimos 2 meses:\n💰 Receitas estimadas: **${fmt(mediaRec)}**\n💸 Despesas estimadas: **${fmt(mediaDesp)}**\n📊 Saldo projetado: **${fmt(saldoProj)}**\n\n${saldoProj >= 0 ? '✅ Projeção positiva!' : '⚠️ Projeção negativa — revise seus gastos fixos.'}\n\n💡 Acesse **Projeção Financeira** para ver os próximos 6 meses com mais precisão.`
    }

    // ── ORÇAMENTO ─────────────────────────────────────────────────────────────
    case 'orcamento': {
      const o = ctx.orcamentos
      if (!o || o.cnt === 0) {
        return `📋 Você não tem orçamentos configurados para ${mesNome}.\n\n💡 **Como usar orçamentos:**\nDefina um limite por categoria (ex: Alimentação R$800/mês). O app avisa quando você está próximo do teto.\n\nAcesse **Orçamentos** para criar limites por categoria e ganhar controle total dos gastos.`
      }
      return `📋 **Orçamentos de ${mesNome}:**\n\n📊 ${o.cnt} categoria(s) com orçamento\n💰 Limite total: **${fmt(parseFloat(o.total_limite))}**\n\n💡 Acesse a aba **Orçamentos** para ver o progresso de cada categoria e ver quais estão no limite.`
    }

    // ── RECORRÊNCIAS ──────────────────────────────────────────────────────────
    case 'recorrencias': {
      const r = ctx.recorrencias
      if (!r || r.cnt === 0) {
        return `🔄 Você não tem recorrências automáticas cadastradas.\n\n💡 Recorrências automatizam o registro de contas fixas como:\n• Aluguel, condomínio, IPTU\n• Assinaturas (Netflix, Spotify...)\n• Salário, rendas fixas\n\nAcesse **Recorrências** para configurar e nunca esquecer um lançamento!`
      }
      const desp = parseFloat(r.total_desp || 0)
      const rec  = parseFloat(r.total_rec  || 0)
      return `🔄 **Recorrências Automáticas:**\n\n📊 ${r.cnt} recorrência(s) ativa(s)\n💸 Despesas fixas: **${fmt(desp)}/mês**\n💰 Receitas fixas: **${fmt(rec)}/mês**\n📊 Comprometimento fixo da renda: ${ctx.totalReceitas > 0 ? (desp / ctx.totalReceitas * 100).toFixed(0) : 0}%\n\nAcesse **Recorrências** para lançar o mês atual e gerenciar pagamentos variáveis.`
    }

    // ── LEMBRETES ─────────────────────────────────────────────────────────────
    case 'lembretes': {
      const cnt = ctx.lembretes?.cnt || 0
      return cnt === 0
        ? `⏰ Nenhum lembrete vencendo nos próximos 30 dias. Tudo em dia!\n\n💡 Crie lembretes para contas com vencimento variável (IPVA, IPTU, revisão do carro...) e nunca pague multa por atraso.`
        : `⏰ **Lembretes:**\n\n⚠️ Você tem **${cnt} lembrete(s)** vencendo nos próximos 30 dias!\n\n💡 Acesse a aba **Lembretes** para verificar o que precisa ser pago e converter em despesas quando efetuar o pagamento.`
    }

    // ── REGRA 50/30/20 ────────────────────────────────────────────────────────
    case 'regra503020': {
      const nec = ctx.totalReceitas * 0.50
      const des = ctx.totalReceitas * 0.30
      const pou = ctx.totalReceitas * 0.20
      return `⚖️ **Regra 50/30/20 para você (${mesNome}):**\n\nBaseado na sua renda de **${fmt(ctx.totalReceitas)}**:\n\n🏠 **50% Necessidades:** até ${fmt(nec)}\n(moradia, alimentação, transporte, saúde)\n\n🎮 **30% Desejos:** até ${fmt(des)}\n(lazer, restaurantes, roupas, hobbies)\n\n💰 **20% Investimentos/Poupança:** ao menos ${fmt(pou)}\n(reserva, metas, aposentadoria)\n\n💡 Acesse **Regra 50/30/20** no app para ver como você está em relação a cada categoria.`
    }

    // ── AMORTIZAÇÃO ───────────────────────────────────────────────────────────
    case 'amortizacao': {
      const totalDivida = parseFloat(ctx.emprestimos?.total || 0) + parseFloat(ctx.financiamentos?.total || 0)
      if (totalDivida === 0) {
        return `🏦 Você não tem dívidas ativas para simular amortização.\n\n💡 O Simulador de Amortização é útil para calcular quanto você economiza fazendo um pagamento extra no financiamento ou empréstimo. Cadastre seus financiamentos na aba correspondente.`
      }
      return `🏦 **Simulador de Amortização:**\n\nVocê tem **${fmt(totalDivida)}** em dívidas ativas.\n\n💡 Fazer um pagamento extra no financiamento pode economizar **dezenas de milhares de reais** em juros.\n\nExemplo: R$5.000 extras num financiamento de 30 anos pode economizar mais de R$50.000 e reduzir o prazo em anos.\n\nAcesse **Simul. Amortização** para calcular exatamente o seu caso.`
    }

    // ── ASSINATURAS FANTASMA ──────────────────────────────────────────────────
    case 'assinaturas': {
      return `👻 **Assinaturas Fantasma:**\n\nO detector analisa seus últimos 3 meses de despesas em busca de cobranças recorrentes que você pode ter esquecido.\n\n💡 Serviços comuns que passam despercebidos:\n• Trials gratuitos que viraram pagos\n• Apps com renovação automática\n• Serviços que você parou de usar\n\nAcesse **Assinaturas Fantasma** → clique em "Escanear" para encontrar agora!`
    }

    // ── COMPARATIVO ───────────────────────────────────────────────────────────
    case 'comparativo': {
      const varDesp = ctx.totalDespAnt > 0
        ? ((ctx.totalDespesas - ctx.totalDespAnt) / ctx.totalDespAnt * 100).toFixed(1)
        : null
      const varRec = ctx.totalRecAnt > 0
        ? ((ctx.totalReceitas - ctx.totalRecAnt) / ctx.totalRecAnt * 100).toFixed(1)
        : null
      if (varDesp === null && varRec === null) {
        return `📊 Não há dados suficientes do mês anterior para comparar.\n\nRegistre receitas e despesas mensalmente para que eu possa mostrar a evolução dos seus indicadores financeiros.`
      }
      const emojiDesp = varDesp && parseFloat(varDesp) > 0 ? '📈' : '📉'
      const emojiRec  = varRec  && parseFloat(varRec)  > 0 ? '📈' : '📉'
      return `📊 **Comparativo ${mesAntNome} → ${mesNome}:**\n\n${emojiRec} Receitas: ${fmt(ctx.totalRecAnt)} → **${fmt(ctx.totalReceitas)}**${varRec !== null ? ` (${parseFloat(varRec) >= 0 ? '+' : ''}${varRec}%)` : ''}\n${emojiDesp} Despesas: ${fmt(ctx.totalDespAnt)} → **${fmt(ctx.totalDespesas)}**${varDesp !== null ? ` (${parseFloat(varDesp) >= 0 ? '+' : ''}${varDesp}%)` : ''}\n\n💡 Acesse **Comparativo Mensal** para o detalhamento por categoria.`
    }

    // ── ECONOMIA ──────────────────────────────────────────────────────────────
    case 'economia': {
      const dicas: string[] = []
      if (ctx.taxaPoupanca < 10) dicas.push('1. 💡 **Regra 50/30/20**: 50% necessidades, 30% desejos, 20% poupança.')
      if (ctx.saldo < 0) dicas.push('2. ⚠️ **Corte gastos imediato**: despesas > receitas. Identifique os vilões em **Gastos por Categoria**.')
      if (parseFloat(ctx.investimentos?.total || 0) === 0) dicas.push('3. 📈 **Comece a investir**: mesmo R$50/mês em CDB 100% CDI faz diferença no longo prazo.')
      if (parseFloat(ctx.reservas?.total || 0) === 0) dicas.push('4. 🛡️ **Reserva primeiro**: antes de investir, forme 3 meses de gastos em liquidez diária.')
      if (ctx.topCategorias.length > 0) {
        const top = ctx.topCategorias[0]
        dicas.push(`5. 🔍 **Maior gasto: ${top.categoria}** (${fmt(parseFloat(top.total))}). Vale revisar se há como reduzir.`)
      }
      dicas.push('6. 🏷️ **Use Tags** nas despesas para identificar padrões de consumo.')
      dicas.push('7. 👻 **Escaneie Assinaturas Fantasma** para cancelar serviços esquecidos.')
      dicas.push('8. 🔄 **Automatize recorrências** para nunca pagar multas por esquecimento.')
      return `💡 **Dicas personalizadas para ${primeiro}:**\n\n${dicas.join('\n\n')}`
    }

    // ── ELOGIO ────────────────────────────────────────────────────────────────
    case 'elogio': {
      return `😊 Obrigado, ${primeiro}! Fico feliz em ajudar.\n\nEstou aqui sempre que precisar entender seus números, buscar dicas ou tirar dúvidas sobre suas finanças.\n\nPergunta qualquer coisa — tô ligado! 🚀`
    }

    // ── AJUDA ─────────────────────────────────────────────────────────────────
    case 'ajuda': {
      return `🤖 **Olá, ${primeiro}! Sou o Assistente VerdeMais v2.**\n\nEntendo perguntas sobre:\n\n💰 **"Qual meu saldo?"** — balanço do mês\n💸 **"Onde estou gastando?"** — análise por categoria\n📊 **"Meu score financeiro"** — sua saúde financeira\n🎯 **"Como estão minhas metas?"** — progresso e aportes\n📈 **"Meus investimentos"** — carteira e rentabilidade\n💳 **"Minhas dívidas"** — saldo e comprometimento\n🛡️ **"Minha reserva de emergência"** — cobertura em meses\n💳 **"Meus cartões"** — limite e uso\n🔮 **"Projeção do próximo mês"** — tendência financeira\n📋 **"Meus orçamentos"** — limites por categoria\n⚖️ **"Regra 50/30/20"** — distribuição ideal da renda\n🏦 **"Amortização"** — economizar em financiamentos\n👻 **"Assinaturas esquecidas"** — detector automático\n💡 **"Dicas para economizar"** — sugestões personalizadas\n\nBasta digitar com naturalidade! 😊`
    }

    // ── FALLBACK ──────────────────────────────────────────────────────────────
    default: {
      // Resposta contextual baseada na situação atual
      const snippets: string[] = []
      if (ctx.saldo < 0) snippets.push(`⚠️ Alerta: você está no negativo este mês (${fmt(ctx.saldo)}).`)
      if (ctx.lembretes?.cnt > 0) snippets.push(`⏰ ${ctx.lembretes.cnt} lembrete(s) vencendo em 30 dias.`)
      const intro = snippets.length > 0
        ? `\n\n📌 **Avisos importantes:**\n${snippets.join('\n')}\n`
        : ''
      return `🤔 Não entendi exatamente "${nome}", mas posso ajudar com:${intro}\n• "Qual meu saldo?"\n• "Onde estou gastando mais?"\n• "Meu score financeiro"\n• "Como estão minhas metas?"\n• "Dicas para economizar"\n\nOu digite **ajuda** para ver tudo que sei fazer. 😊`
    }
  }
}

// ── POST /api/assistente/chat ─────────────────────────────────────────────────
assistente.post('/chat', requireAuth, async (c) => {
  const user = c.get('user')
  const body = await c.req.json().catch(() => ({})) as any
  const mensagem = (body.mensagem || body.message || '').trim()

  if (!mensagem) {
    return c.json({ error: 'Mensagem não pode ser vazia' }, 400)
  }
  if (mensagem.length > 1000) {
    return c.json({ error: 'Mensagem muito longa (máximo 1000 caracteres)' }, 400)
  }

  const intencao = detectarIntencao(mensagem)
  const ctx = await buscarContexto(c.env.DB, user.id)
  let resposta = gerarResposta(intencao, ctx, user.nome)

  // ── FASE 2: LLM com system prompt inteligente + contexto temporal ──────────
  if (c.env.OPENAI_API_KEY) {
    try {
      const apiKey  = c.env.OPENAI_API_KEY
      const baseURL = (c.env.OPENAI_BASE_URL || 'https://www.genspark.ai/api/llm_proxy/v1').replace(/\/$/, '')
      const primeiro = user.nome.split(' ')[0]

      // ── Perfil de investidor ───────────────────────────────────────────
      const perfil = ctx.perfilInvestidor || 'moderado'
      const sugestoesInv: Record<string, string> = {
        conservador: 'Tesouro Selic, CDB liquidez diária, LCI/LCA, poupança. Evite renda variável.',
        moderado:    'CDB 100%+ CDI, Tesouro IPCA+, fundos multimercado conservadores. Até 20% em FIIs ou ações.',
        arrojado:    'Ações (IBOV), FIIs, ETFs, cripto até 5-10%. Diversifique em renda fixa e variável.',
        moderate:    'CDB 100%+ CDI, Tesouro IPCA+, fundos multimercado conservadores. Até 20% em FIIs ou ações.',
        conservative:'Tesouro Selic, CDB liquidez diária, LCI/LCA, poupança. Evite renda variável.',
        aggressive:  'Ações (IBOV), FIIs, ETFs, cripto até 5-10%. Diversifique em renda fixa e variável.',
      }
      const perfilLabels: Record<string, string> = {
        conservador: '🛡️ Conservador', moderado: '⚖️ Moderado', arrojado: '🚀 Arrojado',
        conservative: '🛡️ Conservador', moderate: '⚖️ Moderado', aggressive: '🚀 Arrojado',
      }
      const sugestaoInv = sugestoesInv[perfil] || sugestoesInv.moderado
      const labelPerfil = perfilLabels[perfil] || '⚖️ Moderado'

      // ── FASE 1.1: Classificar obrigações temporalmente ────────────────
      const { classificarObrigacoesTemporais } = await import('../utils/obrigacoes-temporais')
      const classif = await classificarObrigacoesTemporais(c.env.DB, user.id, ctx.totalReceitas)

      const emp = ctx.emprestimos as any
      const fin = ctx.financiamentos as any
      const inv = ctx.investimentos as any

      // ── FASE 1.3: Histórico 6 meses enriquecido ───────────────────────
      const hist6m = await c.env.DB.prepare(`
        WITH meses AS (
          SELECT strftime('%Y-%m', data) as ym,
                 COALESCE(SUM(valor),0)  as receitas
          FROM receitas WHERE user_id=? AND data >= date('now','-6 months')
          GROUP BY ym
        ),
        desp6m AS (
          SELECT strftime('%Y-%m', COALESCE(vencimento,data)) as ym,
                 COALESCE(SUM(valor),0) as despesas
          FROM despesas WHERE user_id=? AND COALESCE(vencimento,data) >= date('now','-6 months')
          GROUP BY ym
        )
        SELECT m.ym,
               COALESCE(m.receitas,0)  as receitas,
               COALESCE(d.despesas,0)  as despesas,
               COALESCE(m.receitas,0) - COALESCE(d.despesas,0) as saldo
        FROM meses m
        LEFT JOIN desp6m d ON d.ym = m.ym
        ORDER BY m.ym
      `).bind(user.id, user.id).all()

      const hist = (hist6m.results || []) as any[]
      const histComDados = hist.filter(h => h.receitas > 0 || h.despesas > 0)
      const mediaRec6m   = histComDados.length > 0 ? histComDados.reduce((s,h) => s + h.receitas, 0) / histComDados.length : 0
      const mediaDesp6m  = histComDados.length > 0 ? histComDados.reduce((s,h) => s + h.despesas, 0) / histComDados.length : 0
      const melhorMes    = histComDados.length > 0 ? histComDados.reduce((mx,h) => h.saldo > mx.saldo ? h : mx, histComDados[0]) : null
      const piorMes      = histComDados.length > 0 ? histComDados.reduce((mn,h) => h.saldo < mn.saldo ? h : mn, histComDados[0]) : null

      // ── Calcular alerta "Outros" ───────────────────────────────────────
      const topCatsList = ctx.topCategorias as any[]
      const gastosOutros = topCatsList.find((c: any) => (c.categoria||'').toLowerCase() === 'outros')?.total || 0
      const pctOutros = ctx.totalReceitas > 0 ? (Number(gastosOutros) / ctx.totalReceitas * 100) : 0
      const alertaOutros = pctOutros > 15

      // ── Montar blocos do system prompt ────────────────────────────────
      const topCats = topCatsList.slice(0,5).map((c:any) => `  • ${c.categoria}: R$ ${Number(c.total).toFixed(2)}`).join('\n')

      const blocoAtivas  = classif.ativas.length > 0
        ? classif.ativas.map(o =>
            `  • ${o.descricao} (${o.tipo}): saldo R$ ${o.saldo_devedor.toFixed(2)}, parcela R$ ${o.valor_parcela.toFixed(2)}/mês, taxa ${o.taxa_juros_anual.toFixed(1)}% aa`
          ).join('\n')
        : '  (nenhuma obrigação ativa)'

      const blocoFuturas = classif.futuras.length > 0
        ? classif.futuras.map(o =>
            `  • ${o.descricao} (${o.tipo}): inicia em ${o.data_inicio}, R$ ${o.valor_parcela.toFixed(2)}/mês — NÃO impacta caixa atual`
          ).join('\n')
        : '  (nenhum compromisso futuro)'

      const blocoHistorico = histComDados.length > 0
        ? histComDados.map(h => `  • ${h.ym}: receitas R$${Number(h.receitas).toFixed(0)}, despesas R$${Number(h.despesas).toFixed(0)}, saldo R$${Number(h.saldo).toFixed(0)}`).join('\n')
        : '  (dados insuficientes — menos de 1 mês registrado)'

      const reservaTotal = parseFloat((ctx.reservas as any)?.total || 0)
      const statusReserva = reservaTotal === 0
        ? `🔴 ZERO (ideal: R$ ${(ctx.totalDespesas * 6).toFixed(2)})`
        : `R$ ${reservaTotal.toFixed(2)} (${ctx.totalDespesas > 0 ? (reservaTotal / ctx.totalDespesas).toFixed(1) : '?'} meses cobertos)`

      // ── FASE 2: System Prompt estruturado (GPS Financeiro) ────────────
      const systemPrompt = `Você é o Assistente Financeiro Inteligente do VerdeMais, especializado em CFP® (Certified Financial Planner).

MISSÃO: Atuar como GPS financeiro — prescrever ações específicas com base em dados empíricos, não apenas descrever situações.

## REGRAS ABSOLUTAS:
1. CONSCIÊNCIA TEMPORAL: Compromissos em [OBRIGACOES_FUTURAS] NÃO são prioridade de pagamento hoje. Foque APENAS em [OBRIGACOES_ATIVAS].
2. CONTEXTO HISTÓRICO: Você tem acesso aos últimos 6 meses. Compare o atual com o histórico.
3. HIGIENIZAÇÃO OBRIGATÓRIA: Se categoria "Outros" > 15% da renda, sua PRIMEIRA recomendação deve ser categorizar esses gastos.
4. PRECISÃO MATEMÁTICA: Use valores exatos em R$, percentuais específicos e prazos definidos.
5. NUNCA INVENTE DADOS: Use apenas informações fornecidas abaixo.
6. Responda SEMPRE em português brasileiro. Tom: amigável, direto, concreto. Máximo 3 emojis.
7. ESCOPO FINANCEIRO OBRIGATÓRIO: Se a pergunta não for sobre finanças pessoais, educação financeira ou o app VerdeMais, NÃO responda sobre o assunto e redirecione gentilmente: "Sou especialista em finanças pessoais. Posso ajudar com: saldo, gastos, metas, investimentos, dívidas ou conquistas. O que deseja saber?"

## DADOS DO USUÁRIO:
👤 ${primeiro} | Perfil investidor: ${labelPerfil} | Situação: ${ctx.situacaoEmprego}

## HISTÓRICO FINANCEIRO (6 meses):
${blocoHistorico}
  → Receita média: R$ ${mediaRec6m.toFixed(2)} | Despesa média: R$ ${mediaDesp6m.toFixed(2)}
  → Melhor mês: ${melhorMes ? `${melhorMes.ym} (saldo R$${Number(melhorMes.saldo).toFixed(0)})` : '—'}
  → Pior mês: ${piorMes ? `${piorMes.ym} (saldo R$${Number(piorMes.saldo).toFixed(0)})` : '—'}

## MÊS ATUAL (${ctx.mes}/${ctx.ano}):
  • Receitas: R$ ${ctx.totalReceitas.toFixed(2)}
  • Despesas: R$ ${ctx.totalDespesas.toFixed(2)} | Taxa de poupança: ${ctx.taxaPoupanca.toFixed(1)}%
  • Saldo: R$ ${ctx.saldo.toFixed(2)}
  • Score saúde: ${ctx.scoreSaude || 'não calculado'}/100

## TOP CATEGORIAS DE GASTOS:
${topCats || '  (nenhuma despesa registrada)'}

## OBRIGAÇÕES ATIVAS (impactam caixa HOJE):
${blocoAtivas}
  → Comprometimento real: ${classif.resumo.comprometimento_pct_atual.toFixed(1)}% da renda

## COMPROMISSOS FUTUROS (planejamento apenas — NÃO PRIORIZAR):
${blocoFuturas}

## ALERTAS CRÍTICOS:
  • Categoria "Outros": ${pctOutros.toFixed(1)}% da renda${alertaOutros ? ' ⚠️ ACIMA DO LIMITE (15%) — HIGIENIZAR PRIMEIRO' : ' ✅ OK'}
  • Reserva de emergência: ${statusReserva}
  • Metas ativas: ${(ctx.metas as any)?.cnt || 0}
  • Investimentos: R$ ${parseFloat(inv?.total||0).toFixed(2)}

## SUGESTÕES DE INVESTIMENTO PARA O PERFIL ${perfil.toUpperCase()}:
${sugestaoInv}

## FORMATO DE RESPOSTA OBRIGATÓRIO:
1. **Diagnóstico Rápido** (situação com números reais)
2. **Impacto Matemático** (R$ e % das ações sugeridas)
3. **Plano de Ação** (3-5 passos específicos com valores exatos e link para módulo do app)

Resposta de referência a melhorar (use os dados acima para tornar mais precisa e personalizada):
${resposta}`

      const llmRes = await fetch(`${baseURL}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: 'gpt-5.4-mini',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user',   content: mensagem }
          ],
          max_tokens: 500,
          temperature: 0.5,  // menos criatividade, mais precisão
        })
      })
      if (llmRes.ok) {
        const llmData: any = await llmRes.json()
        const llmText = llmData?.choices?.[0]?.message?.content?.trim()
        if (llmText && llmText.length > 30) resposta = llmText
      }
    } catch (_) { /* fallback para resposta determinística */ }
  }

  // Salvar conversa
  await c.env.DB.prepare(`
    INSERT INTO assistente_conversas (user_id, mensagem, resposta, intencao, created_at)
    VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
  `).bind(user.id, mensagem, resposta, intencao).run().catch(() => {})

  // Conquista power user
  try {
    const total = await c.env.DB.prepare(`SELECT COUNT(*) as cnt FROM assistente_conversas WHERE user_id=?`).bind(user.id).first() as any
    if ((total?.cnt || 0) >= 20) {
      await c.env.DB.prepare(`INSERT OR IGNORE INTO conquistas_usuario (user_id, conquista_codigo, data_conquista, visualizado) VALUES (?, 'ia_power_user', datetime('now'), 0)`).bind(user.id).run().catch(() => {})
    }
  } catch(_) {}

  return c.json({ resposta, intencao, sugestoes: getSugestoes(intencao) })
})

// ── GET /api/assistente/historico ─────────────────────────────────────────────
assistente.get('/historico', requireAuth, async (c) => {
  const user = c.get('user')
  const limit = Math.min(parseInt(c.req.query('limit') || '30'), 100)
  const result = await c.env.DB.prepare(`
    SELECT id, mensagem as mensagem_usuario, resposta as resposta_ia, intencao, created_at
    FROM assistente_conversas WHERE user_id=? ORDER BY created_at DESC LIMIT ?
  `).bind(user.id, limit).all()
  return c.json({ historico: result.results || [] })
})

// ── DELETE /api/assistente/historico ─────────────────────────────────────────
assistente.delete('/historico', requireAuth, async (c) => {
  const user = c.get('user')
  await c.env.DB.prepare('DELETE FROM assistente_conversas WHERE user_id=?').bind(user.id).run()
  return c.json({ success: true, message: 'Histórico limpo!' })
})

// ── Sugestões baseadas na intenção ────────────────────────────────────────────
function getSugestoes(intencao: Intencao): string[] {
  const mapa: Record<Intencao, string[]> = {
    saldo:            ['Como estão meus gastos?', 'Qual minha taxa de poupança?', 'Dicas para economizar'],
    gastos:           ['Qual categoria gasto mais?', 'Ver meus orçamentos', 'Como reduzir gastos?'],
    gastos_categoria: ['Criar orçamento por categoria', 'Ver todas despesas', 'Como economizar nessa categoria?'],
    score:            ['Como melhorar meu score?', 'Ver diagnóstico 360°', 'Quais metas definir?'],
    metas:            ['Como está meu progresso?', 'Quanto poupar por mês?', 'Estratégias para metas'],
    investimentos:    ['Qual o melhor investimento?', 'Como usar a caixinha CDI?', 'Ver minha carteira'],
    dividas:          ['Simular amortização', 'Método avalanche de pagamento', 'Quanto pago de juros?'],
    reservas:         ['Quanto devo ter de reserva?', 'Onde guardar a reserva?', 'Ver minhas reservas'],
    economia:         ['Regra 50/30/20', 'Detectar assinaturas esquecidas', 'Como investir o que sobra?'],
    cartao:           ['Ver minha fatura', 'Alertas de uso excessivo', 'Assinaturas no cartão'],
    conquistas:       ['Como ganhar mais?', 'Quais próximas medalhas?', 'Ver todas as conquistas'],
    desafio52:        ['Marcar semana concluída', 'Quanto já guardei?', 'Reiniciar desafio'],
    projecao:         ['Ver próximos 6 meses', 'Como melhorar projeção?', 'Meu saldo atual'],
    orcamento:        ['Ver gastos por categoria', 'Criar limite de gasto', 'Como funciona orçamento?'],
    recorrencias:     ['Lançar mês atual', 'Adicionar recorrência', 'Ver despesas fixas'],
    lembretes:        ['Ver vencimentos', 'Criar novo lembrete', 'Converter em despesa'],
    regra503020:      ['Ver análise 50/30/20', 'Criar orçamentos sugeridos', 'Como ajustar gastos?'],
    amortizacao:      ['Simular pagamento extra', 'Ver meu financiamento', 'Método SAC vs PRICE'],
    assinaturas:      ['Escanear assinaturas', 'Ver gastos recorrentes', 'Cancelar serviço'],
    comparativo:      ['Ver comparativo detalhado', 'Análise por categoria', 'Tendência de gastos'],
    elogio:           ['O que mais você faz?', 'Ver meu saldo', 'Dicas para economizar'],
    ajuda:            ['Ver saldo do mês', 'Análise de gastos', 'Meu score financeiro'],
    desconhecido:     ['Qual meu saldo?', 'Onde estou gastando?', 'Meu score financeiro'],
  }
  return mapa[intencao] || mapa.desconhecido
}

export default assistente
