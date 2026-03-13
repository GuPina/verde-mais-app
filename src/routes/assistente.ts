// Bloco 5 — src/routes/assistente.ts
// Assistente IA Conversacional VerdeMais — lógica determinística (sem chamada LLM externa)

import { Hono } from 'hono'
import { requireAuth } from './auth'

type Bindings = { DB: D1Database }
type Variables = { user: { id: number; nome: string; email: string; plano: string } }

const assistente = new Hono<{ Bindings: Bindings; Variables: Variables }>()

// ── Tipos de intenção suportados ──────────────────────────────────────────────
type Intencao =
  | 'saldo'
  | 'gastos'
  | 'metas'
  | 'investimentos'
  | 'dívidas'
  | 'reservas'
  | 'economia'
  | 'cartao'
  | 'conquistas'
  | 'desafio52'
  | 'ajuda'
  | 'desconhecido'

// ── Detectar intenção a partir do texto ──────────────────────────────────────
function detectarIntencao(msg: string): Intencao {
  const t = msg.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')

  if (/saldo|sobrou|quanto tenho|dinheiro disponivel|sobra/.test(t)) return 'saldo'
  if (/gasto|gastei|despesa|gastando|onde gasto|gasta/.test(t)) return 'gastos'
  if (/meta|objetivo|sonho|quanto falta|progresso da meta/.test(t)) return 'metas'
  if (/investimento|aplicacao|rendimento|cdi|acoes|caixinha|fii/.test(t)) return 'investimentos'
  if (/divida|emprestimo|financiamento|parcela|devo|quanto devo/.test(t)) return 'dívidas'
  if (/reserva|emergencia|fundo de emergencia|guardei/.test(t)) return 'reservas'
  if (/economizar|poupar|economia|como guardar|dica|conselho/.test(t)) return 'economia'
  if (/cartao|fatura|limite|credito/.test(t)) return 'cartao'
  if (/conquista|badge|pontos|gamificacao/.test(t)) return 'conquistas'
  if (/desafio|52 semanas|semana/.test(t)) return 'desafio52'
  if (/ajuda|o que voce faz|comandos|funcoes|help/.test(t)) return 'ajuda'

  return 'desconhecido'
}

// ── Buscar contexto financeiro do usuário ─────────────────────────────────────
async function buscarContexto(db: D1Database, userId: number) {
  const mes = new Date().getMonth() + 1
  const ano = new Date().getFullYear()
  const mesStr = String(mes).padStart(2, '0')
  const anoStr = String(ano)

  const [receitas, despesas, metas, investimentos, emprestimos, financiamentos, reservas, conquistas, desafio] = await Promise.all([
    db.prepare(`SELECT COALESCE(SUM(valor),0) as total FROM receitas WHERE user_id=? AND strftime('%m',data)=? AND strftime('%Y',data)=?`).bind(userId, mesStr, anoStr).first() as any,
    db.prepare(`SELECT COALESCE(SUM(valor),0) as total FROM despesas WHERE user_id=? AND strftime('%m',COALESCE(vencimento,data))=? AND strftime('%Y',COALESCE(vencimento,data))=?`).bind(userId, mesStr, anoStr).first() as any,
    db.prepare(`SELECT COUNT(*) as cnt, COALESCE(SUM(valor_objetivo),0) as total_obj, COALESCE(SUM(valor_atual),0) as total_atual FROM metas WHERE user_id=? AND status='ativo'`).bind(userId).first() as any,
    db.prepare(`SELECT COUNT(*) as cnt, COALESCE(SUM(valor_atual),0) as total FROM investimentos WHERE user_id=?`).bind(userId).first() as any,
    db.prepare(`SELECT COUNT(*) as cnt, COALESCE(SUM(saldo_devedor),0) as total, COALESCE(SUM(valor_parcela),0) as parcelas FROM emprestimos WHERE user_id=? AND status='ativo'`).bind(userId).first() as any,
    db.prepare(`SELECT COUNT(*) as cnt, COALESCE(SUM(saldo_devedor),0) as total, COALESCE(SUM(valor_parcela),0) as parcelas FROM financiamentos WHERE user_id=? AND status='ativo'`).bind(userId).first() as any,
    db.prepare(`SELECT COALESCE(SUM(current_amount),0) as total, COALESCE(SUM(target_amount),0) as meta FROM specialized_reserves WHERE user_id=? AND is_active=1`).bind(userId).first() as any,
    db.prepare(`SELECT COUNT(*) as cnt FROM conquistas_usuario WHERE user_id=?`).bind(userId).first() as any,
    db.prepare(`SELECT COUNT(*) as concluidas FROM weekly_challenges WHERE user_id=? AND status='completed' AND strftime('%Y',week_date)=?`).bind(userId, anoStr).first() as any
  ])

  const totalReceitas = parseFloat((receitas as any)?.total || 0)
  const totalDespesas = parseFloat((despesas as any)?.total || 0)
  const saldo = totalReceitas - totalDespesas

  return {
    totalReceitas,
    totalDespesas,
    saldo,
    taxaPoupanca: totalReceitas > 0 ? (saldo / totalReceitas * 100) : 0,
    metas: metas as any,
    investimentos: investimentos as any,
    emprestimos: emprestimos as any,
    financiamentos: financiamentos as any,
    reservas: reservas as any,
    conquistas: conquistas as any,
    desafio: desafio as any,
    mes, ano
  }
}

// ── Formatar moeda ───────────────────────────────────────────────────────────
function fmt(v: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v)
}

// ── Gerar resposta baseada na intenção ────────────────────────────────────────
function gerarResposta(intencao: Intencao, ctx: Awaited<ReturnType<typeof buscarContexto>>, nomeUsuario: string): string {
  const mesesNome = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro']
  const mesNome = mesesNome[ctx.mes - 1]

  switch (intencao) {
    case 'saldo': {
      const emoji = ctx.saldo >= 0 ? '💚' : '🔴'
      const status = ctx.saldo >= 0
        ? `Você está no positivo! ${ctx.taxaPoupanca >= 20 ? 'Excelente taxa de poupança! 🎉' : 'Tente guardar mais para atingir 20% da renda.'}`
        : `Atenção: suas despesas superaram a renda este mês.`
      return `${emoji} **Saldo de ${mesNome}:**\n\n💰 Receitas: ${fmt(ctx.totalReceitas)}\n💸 Despesas: ${fmt(ctx.totalDespesas)}\n📊 Saldo líquido: **${fmt(ctx.saldo)}**\n\n${status}`
    }

    case 'gastos': {
      const porc = ctx.totalReceitas > 0 ? (ctx.totalDespesas / ctx.totalReceitas * 100).toFixed(0) : '0'
      const alerta = parseFloat(porc) > 90 ? '⚠️ Você está gastando quase tudo que ganha!' : parseFloat(porc) > 70 ? '⚡ Gastos elevados — tente reduzir.' : '✅ Bom controle de gastos!'
      return `💸 **Seus gastos em ${mesNome}:**\n\nTotal: ${fmt(ctx.totalDespesas)} (${porc}% da renda)\n\n${alerta}\n\n💡 Dica: acesse **Despesas** para ver o detalhamento por categoria e use **Orçamentos** para definir limites por categoria.`
    }

    case 'metas': {
      const m = ctx.metas
      if (!m || m.cnt === 0) {
        return `🎯 Você ainda não tem metas cadastradas.\n\nCrie sua primeira meta financeira! Pode ser uma viagem, um imóvel, um carro ou qualquer sonho seu. Acesse a aba **Metas** para começar.`
      }
      const porc = m.total_obj > 0 ? (m.total_atual / m.total_obj * 100).toFixed(0) : '0'
      return `🎯 **Suas Metas Financeiras:**\n\n📌 ${m.cnt} meta(s) ativa(s)\n💰 Total acumulado: ${fmt(parseFloat(m.total_atual))}\n🏁 Total objetivo: ${fmt(parseFloat(m.total_obj))}\n📈 Progresso geral: **${porc}%**\n\n💡 Acesse a aba **Metas** para ver o detalhamento e fazer depósitos.`
    }

    case 'investimentos': {
      const inv = ctx.investimentos
      if (!inv || inv.cnt === 0) {
        return `📈 Você ainda não tem investimentos registrados.\n\nComece pequeno! A Caixinha CDI é uma ótima opção para iniciantes — rendimento diário com liquidez. Acesse a aba **Investimentos** para começar.`
      }
      const rentab = inv.cnt > 0 ? '' : ''
      return `📈 **Seus Investimentos:**\n\n📊 ${inv.cnt} investimento(s) ativo(s)\n💰 Total em carteira: **${fmt(parseFloat(inv.total))}**\n\n💡 Acesse a aba **Investimentos** para ver rentabilidade por ativo e usar o Simulador de Investimentos.`
    }

    case 'dívidas': {
      const emp = ctx.emprestimos
      const fin = ctx.financiamentos
      const totalDivida = parseFloat(emp?.total || 0) + parseFloat(fin?.total || 0)
      const totalParcelas = parseFloat(emp?.parcelas || 0) + parseFloat(fin?.parcelas || 0)

      if (totalDivida === 0) {
        return `🎉 **Parabéns, ${nomeUsuario}!** Você não tem dívidas ativas registradas.\n\nManter-se livre de dívidas é um ótimo indicador de saúde financeira! Continue assim. ✅`
      }
      return `💳 **Suas Dívidas:**\n\n📉 Saldo devedor total: ${fmt(totalDivida)}\n💸 Parcelas mensais: ${fmt(totalParcelas)}\n\n💡 Use o **Simulador de Amortização** (plano Premium/Pro) para ver quanto você economizaria fazendo um pagamento extra.`
    }

    case 'reservas': {
      const r = ctx.reservas
      const totalReservas = parseFloat(r?.total || 0)
      const metaReservas = parseFloat(r?.meta || 0)
      const porc = metaReservas > 0 ? (totalReservas / metaReservas * 100).toFixed(0) : '0'

      if (totalReservas === 0) {
        return `🛡️ Você ainda não tem reservas especializadas.\n\nA reserva de emergência é o alicerce das finanças saudáveis. Recomendamos 3 a 6 meses de gastos. Acesse **Reservas** para começar!`
      }
      return `🛡️ **Suas Reservas:**\n\n💰 Total guardado: ${fmt(totalReservas)}\n🎯 Meta total: ${fmt(metaReservas)}\n📊 Progresso: **${porc}%**\n\n${parseFloat(porc) >= 100 ? '🎉 Reservas completas! Você está muito bem protegido.' : '💡 Continue contribuindo mensalmente para atingir sua meta de proteção.'}`
    }

    case 'economia': {
      const dicas = []
      if (ctx.taxaPoupanca < 10) dicas.push('💡 Tente aplicar a regra 50/30/20: 50% necessidades, 30% desejos, 20% poupança.')
      if (ctx.saldo < 0) dicas.push('⚠️ Suas despesas estão superando a renda. Revise gastos variáveis como delivery e lazer.')
      if (parseFloat(ctx.investimentos?.total || 0) === 0) dicas.push('📈 Comece a investir mesmo que seja pouco. A Caixinha CDI rende mais que a poupança.')
      if (parseFloat(ctx.reservas?.total || 0) === 0) dicas.push('🛡️ Crie uma reserva de emergência antes de qualquer investimento de risco.')
      dicas.push('🏷️ Use Tags nas despesas para identificar onde seu dinheiro vai.')
      dicas.push('🔄 Ative o Detector de Assinaturas para encontrar gastos esquecidos.')

      return `💡 **Dicas para Economizar:**\n\n${dicas.map((d, i) => `${i + 1}. ${d}`).join('\n\n')}`
    }

    case 'cartao': {
      return `💳 **Cartões de Crédito:**\n\nAcesse a aba **Cartões** para:\n• Ver o limite disponível em cada cartão\n• Acompanhar a fatura do mês\n• Receber alertas quando uso > 80%\n• Ver compras incomuns\n\n💡 Dica: pagar a fatura completa todo mês evita juros que podem superar 300% ao ano.`
    }

    case 'conquistas': {
      const c = ctx.conquistas
      const cnt = c?.cnt || 0
      return `🏆 **Suas Conquistas:**\n\n🎖️ ${cnt} conquista(s) desbloqueada(s)\n\n${cnt === 0 ? 'Comece registrando sua primeira receita ou despesa para desbloquear a primeira conquista!' : 'Continue usando o app para desbloquear mais conquistas e acumular pontos!'}\n\n💡 Acesse a aba **Conquistas** para ver todas as medalhas disponíveis.`
    }

    case 'desafio52': {
      const d = ctx.desafio
      const concluidas = d?.concluidas || 0
      const economizado = Array.from({ length: concluidas }, (_, i) => i + 1).reduce((a, b) => a + b, 0)
      return `🗓️ **Desafio 52 Semanas:**\n\n✅ ${concluidas} semana(s) concluída(s) em ${ctx.ano}\n💰 Economizado até agora: R$ ${economizado.toFixed(2)}\n🎯 Meta anual: R$ 1.378,00\n\n💡 Na semana N você guarda R$ N. Na semana 1 = R$1, semana 52 = R$52. Simples e eficaz!\n\nAcesse a aba **Desafio 52** para marcar as semanas.`
    }

    case 'ajuda': {
      return `🤖 **Olá, ${nomeUsuario}! Sou o Assistente VerdeMais.**\n\nPosso responder sobre:\n\n💰 **Saldo** — "quanto tenho este mês?"\n💸 **Gastos** — "onde estou gastando?"\n🎯 **Metas** — "como estão minhas metas?"\n📈 **Investimentos** — "quanto tenho investido?"\n💳 **Dívidas** — "quanto devo?"\n🛡️ **Reservas** — "como está minha reserva?"\n💡 **Economia** — "como economizar mais?"\n🏆 **Conquistas** — "quantas conquistas tenho?"\n🗓️ **Desafio 52** — "como está meu desafio?"\n\nBasta digitar sua pergunta com naturalidade!`
    }

    default: {
      return `🤔 Não entendi bem sua pergunta, ${nomeUsuario}.\n\nTente perguntar sobre:\n• Saldo do mês\n• Gastos e despesas\n• Metas financeiras\n• Investimentos\n• Dívidas\n• Reservas de emergência\n• Dicas para economizar\n\nOu digite **ajuda** para ver todos os tópicos disponíveis.`
    }
  }
}

// ────────────────────────────────────────────────────────────────────────────────
// POST /api/assistente/chat
// ────────────────────────────────────────────────────────────────────────────────
assistente.post('/chat', requireAuth, async (c) => {
  const user = c.get('user')
  const { mensagem } = await c.req.json()

  if (!mensagem || typeof mensagem !== 'string' || mensagem.trim().length === 0) {
    return c.json({ error: 'Mensagem não pode ser vazia' }, 400)
  }

  if (mensagem.length > 500) {
    return c.json({ error: 'Mensagem muito longa (máximo 500 caracteres)' }, 400)
  }

  // 1. Detectar intenção
  const intencao = detectarIntencao(mensagem)

  // 2. Buscar contexto financeiro
  const ctx = await buscarContexto(c.env.DB, user.id)

  // 3. Gerar resposta
  const resposta = gerarResposta(intencao, ctx, user.nome)

  // 4. Salvar na tabela de conversas
  await c.env.DB.prepare(`
    INSERT INTO assistente_conversas (user_id, mensagem_usuario, resposta_ia, intencao, created_at)
    VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
  `).bind(user.id, mensagem.trim(), resposta, intencao).run()

  return c.json({
    resposta,
    intencao,
    sugestoes: getSugestoes(intencao)
  })
})

// ────────────────────────────────────────────────────────────────────────────────
// GET /api/assistente/historico
// Retorna as últimas 20 mensagens do usuário
// ────────────────────────────────────────────────────────────────────────────────
assistente.get('/historico', requireAuth, async (c) => {
  const user = c.get('user')

  const result = await c.env.DB.prepare(`
    SELECT id, mensagem_usuario, resposta_ia, intencao, created_at
    FROM assistente_conversas
    WHERE user_id = ?
    ORDER BY created_at DESC
    LIMIT 20
  `).bind(user.id).all()

  return c.json({ historico: result.results || [] })
})

// ────────────────────────────────────────────────────────────────────────────────
// DELETE /api/assistente/historico
// Limpa o histórico de conversa do usuário
// ────────────────────────────────────────────────────────────────────────────────
assistente.delete('/historico', requireAuth, async (c) => {
  const user = c.get('user')

  await c.env.DB.prepare(
    'DELETE FROM assistente_conversas WHERE user_id = ?'
  ).bind(user.id).run()

  return c.json({ success: true, message: 'Histórico limpo!' })
})

// ── Sugestões de perguntas baseadas na intenção ───────────────────────────────
function getSugestoes(intencao: Intencao): string[] {
  const mapa: Record<Intencao, string[]> = {
    saldo:         ['Como estão meus gastos?', 'Quais são minhas metas?', 'Como posso economizar mais?'],
    gastos:        ['Qual meu saldo este mês?', 'Como reduzir gastos?', 'Ver orçamentos por categoria'],
    metas:         ['Como está meu progresso?', 'Quanto falta para minha meta?', 'Como investir mais rápido?'],
    investimentos: ['Quanto devo guardar?', 'Qual o melhor investimento?', 'Como usar a caixinha CDI?'],
    'dívidas':     ['Como quitar mais rápido?', 'Simular amortização', 'Quanto pago de juros?'],
    reservas:      ['Quanto devo ter de reserva?', 'Como aumentar a reserva?', 'Qual é a reserva ideal?'],
    economia:      ['Regra 50/30/20', 'Como investir o que sobra?', 'Quais gastos cortar?'],
    cartao:        ['Ver minha fatura', 'Como controlar o cartão?', 'Alertas de uso excessivo'],
    conquistas:    ['Como ganhar mais pontos?', 'Quais conquistas estão próximas?', 'Ver todas as medalhas'],
    desafio52:     ['Como funciona o desafio?', 'Marcar semana como concluída', 'Quanto já guardei?'],
    ajuda:         ['Ver saldo do mês', 'Como economizar?', 'Status dos investimentos'],
    desconhecido:  ['Ver saldo', 'Ver gastos', 'Dicas para economizar', 'Status das metas']
  }
  return mapa[intencao] || mapa.desconhecido
}

export default assistente
