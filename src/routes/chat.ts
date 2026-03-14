import { Hono } from 'hono'
import { requireAuth } from './auth'

type Bindings = { DB: D1Database }
type Variables = { user: { id: number; nome: string; email: string; plano: string } }

const chat = new Hono<{ Bindings: Bindings; Variables: Variables }>()

// ── Helpers ──────────────────────────────────────────────────────────────────
const fmt = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v)

// ── 6.4 Sistema de Intents (11 intenções) — Bloco 6 ─────────────────────────
type Intent =
  | 'saldo_atual'
  | 'resumo_mes'
  | 'fatura_cartao'
  | 'gastos_categoria'
  | 'minhas_metas'
  | 'dicas_economia'
  | 'ver_investimentos'
  | 'adicionar_despesa'
  | 'ajuda_funcionalidade'
  | 'status_saude'
  | 'fallback'

function detectarIntent(msg: string): Intent {
  const m = msg.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')

  // 1. saldo_atual
  if (/quanto (eu )?(tenho|sobrou|resta)|qual (o )?meu saldo|saldo (atual|disponivel)|tenho de saldo/.test(m))
    return 'saldo_atual'

  // 2. resumo_mes
  if (/resumo (de |do )?(mes|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro|janeiro|fevereiro)|como foi o mes|relatorio (do )?mes|balanço/.test(m))
    return 'resumo_mes'

  // 3. fatura_cartao
  if (/fatura|quanto devo (no|ao) cartao|valor (do|da) cartao|debito (no )?cartao/.test(m))
    return 'fatura_cartao'

  // 4. gastos_categoria
  if (/quanto gastei com|gastos? (com|em|de)|gasto(u|s)? (com|em)|alimentacao|transporte|lazer|saude|uber|ifood|mercado/.test(m))
    return 'gastos_categoria'

  // 5. minhas_metas
  if (/como estao (as )?minhas metas|falta (muito|quanto) (pra|para) (a )?meta|progresso (das |da )?metas|minhas metas|ver metas/.test(m))
    return 'minhas_metas'

  // 6. dicas_economia
  if (/como economizar|dicas? (de|para) (economizar|poupar|gastar menos)|poupar mais|reduzir gastos|gastar menos/.test(m))
    return 'dicas_economia'

  // 7. ver_investimentos
  if (/meus investimentos|quanto rendeu|rendimento(s)?|investimento(s)?|carteira|patrimonio/.test(m))
    return 'ver_investimentos'

  // 8. adicionar_despesa (parse: "gastei X em Y")
  if (/gastei|paguei|comprei|despesa de|lancei/.test(m) && /\d+/.test(m))
    return 'adicionar_despesa'

  // 9. ajuda_funcionalidade
  if (/como (criar|adicionar|cadastrar|ver|acessar|usar)|onde (fico|vejo|encontro|acho)|ajuda|tutorial|como funciona/.test(m))
    return 'ajuda_funcionalidade'

  // 10. status_saude
  if (/qual (e |o )?meu score|saude financeira|score (de saude)?|minha pontuacao|estou (bem|mal) financeiramente/.test(m))
    return 'status_saude'

  // 11. fallback
  return 'fallback'
}

async function processarIntent(intent: Intent, userId: number, db: D1Database, msg: string): Promise<{ response: string; sugestoes: string[] }> {
  const mes = new Date().getMonth() + 1
  const ano = new Date().getFullYear()
  const mesPad = String(mes).padStart(2, '0')
  const prefix = `${ano}-${mesPad}`

  switch (intent) {
    case 'saldo_atual': {
      const [rec, desp] = await Promise.all([
        db.prepare(`SELECT COALESCE(SUM(valor),0) as t FROM receitas WHERE user_id=? AND strftime('%Y-%m',data)=?`).bind(userId, prefix).first<any>(),
        db.prepare(`SELECT COALESCE(SUM(valor),0) as t FROM despesas WHERE user_id=? AND strftime('%Y-%m',data)=? AND status='pago' AND COALESCE(eh_aporte_patrimonial,0)=0`).bind(userId, prefix).first<any>()
      ])
      const saldo = (rec?.t || 0) - (desp?.t || 0)
      const emoji = saldo >= 0 ? '✅' : '⚠️'
      return {
        response: `${emoji} **Seu saldo de ${mesPad}/${ano}:**\n• Receitas: ${fmt(rec?.t || 0)}\n• Despesas: ${fmt(desp?.t || 0)}\n• **Saldo líquido: ${fmt(saldo)}**`,
        sugestoes: ['Resumo do mês', 'Ver investimentos', 'Como estão minhas metas?']
      }
    }

    case 'resumo_mes': {
      const [rec, desp, metas, invest] = await Promise.all([
        db.prepare(`SELECT COALESCE(SUM(valor),0) as t FROM receitas WHERE user_id=? AND strftime('%Y-%m',data)=?`).bind(userId, prefix).first<any>(),
        db.prepare(`SELECT COALESCE(SUM(valor),0) as t FROM despesas WHERE user_id=? AND strftime('%Y-%m',data)=? AND COALESCE(eh_aporte_patrimonial,0)=0`).bind(userId, prefix).first<any>(),
        db.prepare(`SELECT COUNT(*) as t FROM metas WHERE user_id=? AND status='ativa'`).bind(userId).first<any>(),
        db.prepare(`SELECT COALESCE(SUM(valor_atual),0) as t FROM investimentos WHERE user_id=?`).bind(userId).first<any>()
      ])
      const saldo = (rec?.t || 0) - (desp?.t || 0)
      const taxa = rec?.t > 0 ? Math.round((saldo / rec.t) * 100) : 0
      return {
        response: `📊 **Resumo de ${mesPad}/${ano}:**\n• Receitas: ${fmt(rec?.t || 0)}\n• Despesas: ${fmt(desp?.t || 0)}\n• Saldo: ${fmt(saldo)} (${taxa}% de poupança)\n• Metas ativas: ${metas?.t || 0}\n• Patrimônio investido: ${fmt(invest?.t || 0)}`,
        sugestoes: ['Qual meu score?', 'Como economizar?', 'Ver investimentos']
      }
    }

    case 'fatura_cartao': {
      const fatura = await db.prepare(
        `SELECT COALESCE(SUM(valor),0) as t FROM despesas WHERE user_id=? AND meio_pagamento IN ('cartao_credito','parcelado_cartao') AND status='pendente' AND strftime('%Y-%m',data)=?`
      ).bind(userId, prefix).first<any>()
      const total = fatura?.t || 0
      const emoji = total > 0 ? '💳' : '✅'
      return {
        response: `${emoji} **Fatura do mês ${mesPad}/${ano}:**\n• Total pendente: **${fmt(total)}**\n${total > 0 ? '\n💡 Dica: Pague antes do vencimento para evitar juros!' : '\nNenhuma fatura pendente. Ótimo controle!'}`,
        sugestoes: ['Ver todos os cartões', 'Quanto gastei com cartão?', 'Meu saldo atual']
      }
    }

    case 'gastos_categoria': {
      const categorias = await db.prepare(
        `SELECT categoria, SUM(valor) as total FROM despesas WHERE user_id=? AND strftime('%Y-%m',data)=? AND COALESCE(eh_aporte_patrimonial,0)=0 GROUP BY categoria ORDER BY total DESC LIMIT 5`
      ).bind(userId, prefix).all<any>()
      const lista = (categorias.results || [])
        .map((c: any, i: number) => `${i + 1}. ${c.categoria}: ${fmt(c.total)}`)
        .join('\n')
      return {
        response: `📂 **Top 5 categorias — ${mesPad}/${ano}:**\n${lista || 'Nenhuma despesa registrada ainda.'}`,
        sugestoes: ['Como economizar?', 'Resumo do mês', 'Meu saldo atual']
      }
    }

    case 'minhas_metas': {
      const metas = await db.prepare(
        `SELECT nome, valor_meta, valor_atual, ROUND((valor_atual/valor_meta)*100,1) as pct FROM metas WHERE user_id=? AND status='ativa' ORDER BY pct DESC LIMIT 5`
      ).bind(userId).all<any>()
      if (!metas.results?.length) {
        return {
          response: '🎯 Você ainda não tem metas cadastradas. Que tal criar sua primeira meta agora?',
          sugestoes: ['Como criar uma meta?', 'Ver investimentos', 'Meu saldo atual']
        }
      }
      const lista = metas.results.map((m: any) =>
        `• ${m.nome}: ${fmt(m.valor_atual)} / ${fmt(m.valor_meta)} (${m.pct}%)`
      ).join('\n')
      return {
        response: `🎯 **Suas metas ativas:**\n${lista}`,
        sugestoes: ['Quando vou atingir minha meta?', 'Resumo do mês', 'Ver investimentos']
      }
    }

    case 'dicas_economia': {
      const desp = await db.prepare(
        `SELECT categoria, SUM(valor) as total FROM despesas WHERE user_id=? AND strftime('%Y-%m',data)=? AND COALESCE(eh_aporte_patrimonial,0)=0 GROUP BY categoria ORDER BY total DESC LIMIT 3`
      ).bind(userId, prefix).all<any>()
      const maiores = (desp.results || []).map((c: any) => c.categoria).join(', ')
      return {
        response: `💡 **Dicas personalizadas de economia:**\n\n1. 📱 Revise assinaturas recorrentes mensalmente\n2. 🛒 Planeje compras com lista antecipada\n3. 💳 Evite parcelar em juros > 1,5% a.m.\n4. 🎯 Defina uma meta de poupança de 20% da renda\n${maiores ? `\n⚡ Seus maiores gastos são em: **${maiores}** — analise se há cortes possíveis.` : ''}`,
        sugestoes: ['Ver meus gastos por categoria', 'Como criar uma meta?', 'Qual meu score?']
      }
    }

    case 'ver_investimentos': {
      const invest = await db.prepare(
        `SELECT tipo, SUM(valor_investido) as investido, SUM(valor_atual) as atual FROM investimentos WHERE user_id=? GROUP BY tipo ORDER BY atual DESC`
      ).bind(userId).all<any>()
      if (!invest.results?.length) {
        return {
          response: '📈 Você ainda não tem investimentos cadastrados. Comece agora e veja seu patrimônio crescer!',
          sugestoes: ['Como cadastrar investimento?', 'Meu saldo atual', 'Ver metas']
        }
      }
      const lista = invest.results.map((i: any) => {
        const rent = i.investido > 0 ? ((i.atual - i.investido) / i.investido * 100).toFixed(1) : '0.0'
        return `• ${i.tipo}: ${fmt(i.atual)} (${rent >= '0' ? '+' : ''}${rent}%)`
      }).join('\n')
      const totalInv = invest.results.reduce((s: number, i: any) => s + i.atual, 0)
      return {
        response: `📈 **Seus investimentos:**\n${lista}\n\n💰 Total: **${fmt(totalInv)}**`,
        sugestoes: ['Resumo do mês', 'Como estão minhas metas?', 'Meu saldo atual']
      }
    }

    case 'adicionar_despesa': {
      // Parse simples: "gastei 50 no mercado" ou "paguei 120 de luz"
      const valorMatch = msg.match(/\d+([.,]\d{1,2})?/)
      const valor = valorMatch ? parseFloat(valorMatch[0].replace(',', '.')) : 0
      if (!valor || valor <= 0) {
        return {
          response: '❓ Não consegui identificar o valor. Tente: "gastei 50 no mercado" ou "paguei 120 de luz".',
          sugestoes: ['Ver gastos do mês', 'Meu saldo atual']
        }
      }
      // Detectar categoria da frase
      const catMap: Record<string, string> = {
        'mercado|supermercado|feira|hortifruti': 'Alimentação',
        'restaurante|almoco|jantar|lanche|ifood|rappi': 'Alimentação',
        'uber|99|taxi|onibus|metro|combustivel|gasolina|posto': 'Transporte',
        'luz|energia|agua|gas|internet|telefone|conta': 'Moradia',
        'farmacia|remedio|medico|consulta|plano de saude': 'Saúde',
        'cinema|teatro|show|netflix|spotify|streaming': 'Lazer',
        'roupa|calcado|loja': 'Vestuário'
      }
      let categoria = 'Outros'
      const msgLower = msg.toLowerCase()
      for (const [pattern, cat] of Object.entries(catMap)) {
        if (new RegExp(pattern).test(msgLower)) { categoria = cat; break }
      }
      return {
        response: `💸 **Detectei uma despesa:**\n• Valor: **${fmt(valor)}**\n• Categoria sugerida: **${categoria}**\n\nPara registrar oficialmente, use o botão **"+ Nova Despesa"** na tela principal com esses dados. O chat não salva despesas automaticamente por segurança.`,
        sugestoes: ['Ver gastos do mês', 'Meu saldo atual', 'Como criar despesa?']
      }
    }

    case 'ajuda_funcionalidade': {
      return {
        response: `🆘 **Posso te ajudar com:**\n\n• 💰 **Saldo**: "Qual meu saldo?"\n• 📊 **Resumo**: "Resumo do mês"\n• 💳 **Fatura**: "Valor da fatura"\n• 📂 **Gastos**: "Quanto gastei com alimentação?"\n• 🎯 **Metas**: "Como estão minhas metas?"\n• 📈 **Investimentos**: "Meus investimentos"\n• 💡 **Dicas**: "Como economizar?"\n• ❤️ **Score**: "Qual meu score financeiro?"`,
        sugestoes: ['Qual meu saldo?', 'Resumo do mês', 'Qual meu score?']
      }
    }

    case 'status_saude': {
      const [rec, desp, dividas, invest] = await Promise.all([
        db.prepare(`SELECT COALESCE(SUM(valor),0) as t FROM receitas WHERE user_id=? AND strftime('%Y-%m',data)=?`).bind(userId, prefix).first<any>(),
        db.prepare(`SELECT COALESCE(SUM(valor),0) as t FROM despesas WHERE user_id=? AND strftime('%Y-%m',data)=? AND COALESCE(eh_aporte_patrimonial,0)=0`).bind(userId, prefix).first<any>(),
        db.prepare(`SELECT COALESCE(SUM(saldo_devedor),0) as t FROM emprestimos WHERE user_id=? AND status='ativo'`).bind(userId).first<any>(),
        db.prepare(`SELECT COALESCE(SUM(valor_atual),0) as t FROM investimentos WHERE user_id=?`).bind(userId).first<any>()
      ])
      const receita = rec?.t || 0
      const despesa = desp?.t || 0
      const saldo = receita - despesa
      const divida = dividas?.t || 0
      const patrimonio = invest?.t || 0

      let score = 70
      if (receita > 0) {
        const txPoupanca = saldo / receita
        if (txPoupanca >= 0.3) score += 15
        else if (txPoupanca >= 0.2) score += 8
        else if (txPoupanca < 0) score -= 20
        const comprDivida = receita > 0 ? divida / (receita * 12) : 0
        if (comprDivida > 0.5) score -= 20
        else if (comprDivida > 0.3) score -= 10
        if (patrimonio > receita * 6) score += 10
        else if (patrimonio > receita * 3) score += 5
      }
      score = Math.max(0, Math.min(100, score))

      const label = score >= 80 ? '🟢 Excelente' : score >= 60 ? '🟡 Bom' : score >= 40 ? '🟠 Regular' : '🔴 Crítico'
      return {
        response: `❤️ **Score de Saúde Financeira:**\n**${score}/100 — ${label}**\n\n• Receita: ${fmt(receita)}\n• Despesa: ${fmt(despesa)}\n• Saldo: ${fmt(saldo)}\n• Dívidas: ${fmt(divida)}\n• Patrimônio: ${fmt(patrimonio)}\n\n${score < 60 ? '⚠️ Atenção: revise seus gastos e tente aumentar a poupança.' : '✅ Continue assim! Mantenha o controle dos gastos.'}`,
        sugestoes: ['Como economizar?', 'Ver metas', 'Ver investimentos']
      }
    }

    default: {
      return {
        response: `🤖 **Olá! Sou o assistente VerdeMais.**\n\nNão entendi bem o que você quis dizer. Tente:\n\n• "Qual meu saldo?"\n• "Resumo do mês"\n• "Como estão minhas metas?"\n• "Dicas para economizar"`,
        sugestoes: ['Qual meu saldo?', 'Resumo do mês', 'Ajuda — o que você faz?']
      }
    }
  }
}

// ── POST /api/chat/send — Bloco 6.3 ─────────────────────────────────────────
chat.post('/send', requireAuth, async (c) => {
  const user = c.get('user')
  const body = await c.req.json().catch(() => ({})) as any
  const message = body.message?.trim() || ''

  if (!message) return c.json({ error: 'Mensagem não pode ser vazia' }, 400)
  if (message.length > 500) return c.json({ error: 'Mensagem muito longa (máximo 500 caracteres)' }, 400)

  const intent = detectarIntent(message)
  const { response, sugestoes } = await processarIntent(intent, user.id, c.env.DB, message)

  // Salvar na tabela chat_messages (Bloco 6.2)
  await c.env.DB.prepare(
    `INSERT INTO chat_messages (user_id, sender, message, intent) VALUES (?, 'user', ?, ?)`
  ).bind(user.id, message, intent).run()

  await c.env.DB.prepare(
    `INSERT INTO chat_messages (user_id, sender, message, intent) VALUES (?, 'bot', ?, ?)`
  ).bind(user.id, response, intent).run()

  // Conquista ia_power_user: 20 mensagens enviadas
  const countRow = await c.env.DB.prepare(
    `SELECT COUNT(*) as c FROM chat_messages WHERE user_id=? AND sender='user'`
  ).bind(user.id).first<any>()
  if ((countRow?.c || 0) >= 20) {
    await c.env.DB.prepare(
      `INSERT OR IGNORE INTO conquistas_usuario (user_id, conquista_codigo, visualizado) VALUES (?, 'ia_power_user', 0)`
    ).bind(user.id).run()
  }

  return c.json({ response, intent, sugestoes })
})

// ── GET /api/chat/historico ───────────────────────────────────────────────────
chat.get('/historico', requireAuth, async (c) => {
  const user = c.get('user')
  const historico = await c.env.DB.prepare(
    `SELECT sender, message, intent, created_at FROM chat_messages WHERE user_id=? ORDER BY created_at DESC LIMIT 40`
  ).bind(user.id).all<any>()
  return c.json({ historico: (historico.results || []).reverse() })
})

// ── DELETE /api/chat/historico ────────────────────────────────────────────────
chat.delete('/historico', requireAuth, async (c) => {
  const user = c.get('user')
  await c.env.DB.prepare(`DELETE FROM chat_messages WHERE user_id=?`).bind(user.id).run()
  return c.json({ success: true, message: 'Histórico do chat limpo!' })
})

export default chat
