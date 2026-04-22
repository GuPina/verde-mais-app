import { Hono } from 'hono'
import { requireAuth } from './auth'

type Bindings = { DB: D1Database }
type Variables = { user: { id: number; nome: string; email: string; plano: string } }

const conquistas = new Hono<{ Bindings: Bindings; Variables: Variables }>()

// GET /api/conquistas — Todas as conquistas (ganhas + disponíveis + progresso parcial)
conquistas.get('/', requireAuth, async (c) => {
  const user = c.get('user')

  const todas = await c.env.DB.prepare('SELECT * FROM conquistas_definicoes ORDER BY pontos ASC').all()
  const ganhas = await c.env.DB.prepare(
    'SELECT * FROM conquistas_usuario WHERE user_id = ? ORDER BY data_conquista DESC'
  ).bind(user.id).all()

  const ganhasCodigos = new Set((ganhas.results as any[]).map(g => g.conquista_codigo))
  const ganhassMap = Object.fromEntries((ganhas.results as any[]).map(g => [g.conquista_codigo, g]))

  // ── Calcular progresso parcial para conquistas com threshold ──────────────
  const [despesasPagas, investimentos, lembreteCount, receitas, emprestimosQ, finQ] = await Promise.all([
    c.env.DB.prepare(`SELECT COUNT(*) as n FROM despesas WHERE user_id = ? AND status = 'pago'`).bind(user.id).first() as any,
    c.env.DB.prepare(`SELECT COUNT(*) as n, COUNT(DISTINCT tipo) as tipos FROM investimentos WHERE user_id = ?`).bind(user.id).first() as any,
    c.env.DB.prepare(`SELECT COUNT(*) as n FROM lembretes WHERE user_id = ?`).bind(user.id).first() as any,
    c.env.DB.prepare(`SELECT COUNT(*) as n FROM receitas WHERE user_id = ?`).bind(user.id).first() as any,
    c.env.DB.prepare(`SELECT COUNT(*) as n FROM emprestimos WHERE user_id = ? AND status = 'quitado'`).bind(user.id).first() as any,
    c.env.DB.prepare(`SELECT id, parcelas_pagas, numero_parcelas FROM financiamentos WHERE user_id = ? AND status != 'quitado' ORDER BY id DESC LIMIT 1`).bind(user.id).first() as any,
  ])

  // Mapa: codigo → { atual, total }
  const progressos: Record<string, { atual: number; total: number }> = {
    disciplinado:      { atual: Math.min(Number(despesasPagas?.n || 0), 10), total: 10 },
    lembrete_mestre:   { atual: Math.min(Number(lembreteCount?.n || 0), 5), total: 5 },
    investidor_diversificado: { atual: Math.min(Number(investimentos?.tipos || 0), 3), total: 3 },
    poupador_dedicado: { atual: 0, total: 10000 }, // preenchido abaixo
    milionario:        { atual: 0, total: 100000 }, // preenchido abaixo
    quitou_10pct: finQ ? { atual: Math.round((finQ.parcelas_pagas / finQ.numero_parcelas) * 100), total: 10 } : { atual: 0, total: 10 },
    quitou_30pct: finQ ? { atual: Math.round((finQ.parcelas_pagas / finQ.numero_parcelas) * 100), total: 30 } : { atual: 0, total: 30 },
    quitou_50pct: finQ ? { atual: Math.round((finQ.parcelas_pagas / finQ.numero_parcelas) * 100), total: 50 } : { atual: 0, total: 50 },
  }

  // Total investido para conquistas de saldo
  try {
    const invTotal = await c.env.DB.prepare(
      `SELECT COALESCE(SUM(valor_atual), 0) as total FROM investimentos WHERE user_id = ?`
    ).bind(user.id).first() as any
    const totalInv = Number(invTotal?.total || 0)
    progressos['poupador_dedicado'] = { atual: Math.min(totalInv, 10000), total: 10000 }
    progressos['milionario'] = { atual: Math.min(totalInv, 100000), total: 100000 }
  } catch { }

  const resultado = (todas.results as any[]).map(def => {
    const prog = progressos[def.codigo]
    return {
      ...def,
      conquistada: ganhasCodigos.has(def.codigo),
      data_conquista: ganhassMap[def.codigo]?.data_conquista || null,
      visualizado: ganhasCodigos.has(def.codigo) ? (ganhassMap[def.codigo]?.visualizado ?? 0) : 1,
      progresso: prog ? { atual: prog.atual, total: prog.total, pct: Math.round(prog.atual / prog.total * 100) } : null
    }
  })

  const totalPontos = resultado.filter(r => r.conquistada).reduce((s, r) => s + r.pontos, 0)
  const naoVisualizadas = (ganhas.results as any[]).filter(g => !g.visualizado).length

  return c.json({
    conquistas: resultado,
    total_conquistadas: ganhasCodigos.size,
    total_disponivel: todas.results.length,
    total_pontos: totalPontos,
    nao_visualizadas: naoVisualizadas
  })
})

// PATCH /api/conquistas/visualizar — marcar como visualizadas
conquistas.patch('/visualizar', requireAuth, async (c) => {
  const user = c.get('user')
  await c.env.DB.prepare('UPDATE conquistas_usuario SET visualizado = 1 WHERE user_id = ?').bind(user.id).run()
  return c.json({ success: true })
})

// GET /api/conquistas/novas — conquistas não visualizadas (para notificações)
conquistas.get('/novas', requireAuth, async (c) => {
  const user = c.get('user')
  const result = await c.env.DB.prepare(
    `SELECT cu.*, cd.titulo, cd.descricao, cd.icone, cd.pontos, cd.raridade 
     FROM conquistas_usuario cu 
     JOIN conquistas_definicoes cd ON cu.conquista_codigo = cd.codigo
     WHERE cu.user_id = ? AND cu.visualizado = 0
     ORDER BY cu.data_conquista DESC`
  ).bind(user.id).all()
  return c.json({ novas: result.results })
})

// POST /api/conquistas/reprocessar — retroativamente desbloqueia conquistas já ganhas pelo usuário
conquistas.post('/reprocessar', requireAuth, async (c) => {
  const user = c.get('user')
  try {
    const novas = await verificarConquistasParaUsuario(c.env.DB, user.id)

    // Busca o total atual após reprocessamento
    const totalGanhas = await c.env.DB.prepare(
      'SELECT COUNT(*) as total FROM conquistas_usuario WHERE user_id = ?'
    ).bind(user.id).first() as any

    return c.json({
      success: true,
      novas_desbloqueadas: novas.length,
      codigos_novos: novas,
      total_conquistadas: totalGanhas?.total || 0,
      mensagem: novas.length > 0
        ? `${novas.length} nova(s) conquista(s) desbloqueada(s)!`
        : 'Todas as suas conquistas já estão atualizadas.'
    })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

// POST /api/conquistas/verificar — verificar e atribuir conquistas automaticamente
conquistas.post('/verificar', requireAuth, async (c) => {
  const user = c.get('user')
  const novas: string[] = []

  const ganhar = async (codigo: string) => {
    try {
      const res = await c.env.DB.prepare(
        'INSERT OR IGNORE INTO conquistas_usuario (user_id, conquista_codigo, visualizado) VALUES (?, ?, 0)'
      ).bind(user.id, codigo).run()
      if (res.meta.changes > 0) novas.push(codigo)
    } catch { }
  }

  // ── Básicas ──────────────────────────────────────────────────────────────
  const receitas = await c.env.DB.prepare('SELECT COUNT(*) as total FROM receitas WHERE user_id = ?').bind(user.id).first() as any
  if ((receitas?.total || 0) >= 1) await ganhar('primeira_receita')
  if ((receitas?.total || 0) >= 5) await ganhar('5_receitas')

  const despesas = await c.env.DB.prepare('SELECT COUNT(*) as total FROM despesas WHERE user_id = ?').bind(user.id).first() as any
  if ((despesas?.total || 0) >= 1) await ganhar('organizador')

  const metas = await c.env.DB.prepare('SELECT COUNT(*) as total FROM metas WHERE user_id = ?').bind(user.id).first() as any
  if ((metas?.total || 0) >= 1) await ganhar('sonhador')
  if ((metas?.total || 0) >= 5) await ganhar('5_metas_ativas')

  const investimentos = await c.env.DB.prepare('SELECT COUNT(*) as total FROM investimentos WHERE user_id = ?').bind(user.id).first() as any
  if ((investimentos?.total || 0) >= 1) await ganhar('investidor')
  if ((investimentos?.total || 0) >= 5) await ganhar('5_investimentos')

  const cartoes = await c.env.DB.prepare('SELECT COUNT(*) as total FROM cartoes WHERE user_id = ?').bind(user.id).first() as any
  if ((cartoes?.total || 0) >= 1) await ganhar('carteirinha')

  const userPerfil = await c.env.DB.prepare('SELECT perfil_completo FROM users WHERE id = ?').bind(user.id).first() as any
  if (userPerfil?.perfil_completo) await ganhar('planejador')

  const metaConcluida = await c.env.DB.prepare('SELECT COUNT(*) as total FROM metas WHERE user_id = ? AND status = ?').bind(user.id, 'concluida').first() as any
  if ((metaConcluida?.total || 0) >= 1) await ganhar('meta_concluida')
  if ((metaConcluida?.total || 0) >= 3) await ganhar('3_metas_concluidas')

  const lembretesCount = await c.env.DB.prepare('SELECT COUNT(*) as total FROM lembretes WHERE user_id = ? AND ativo = 1').bind(user.id).first() as any
  if ((lembretesCount?.total || 0) >= 5) await ganhar('lembrete_mestre')
  if ((lembretesCount?.total || 0) >= 10) await ganhar('10_lembretes')

  // ── Despesas pagas ────────────────────────────────────────────────────────
  const despesasPagas = await c.env.DB.prepare(
    "SELECT COUNT(*) as total FROM despesas WHERE user_id = ? AND status = 'pago'"
  ).bind(user.id).first() as any
  if ((despesasPagas?.total || 0) >= 10) await ganhar('10_despesas_pagas')
  if ((despesasPagas?.total || 0) >= 50) await ganhar('50_despesas_pagas')

  // ── Despesas com tag ───────────────────────────────────────────────────────
  const despesasComTag = await c.env.DB.prepare(
    `SELECT COUNT(*) as total FROM despesas d
     JOIN despesa_tags dt ON dt.despesa_id = d.id
     WHERE d.user_id = ?`
  ).bind(user.id).first() as any
  if ((despesasComTag?.total || 0) >= 20) await ganhar('20_despesas_com_tag')

  // ── Receitas diversificadas ────────────────────────────────────────────────
  const tiposReceita = await c.env.DB.prepare(
    'SELECT COUNT(DISTINCT categoria) as cnt FROM receitas WHERE user_id = ?'
  ).bind(user.id).first() as any
  if ((tiposReceita?.cnt || 0) >= 3) await ganhar('receita_diversificada')

  // ── Receita mensal > R$5.000 ───────────────────────────────────────────────
  const now = new Date()
  const mes = String(now.getMonth() + 1).padStart(2, '0')
  const ano = String(now.getFullYear())
  const receitaMes = await c.env.DB.prepare(
    `SELECT COALESCE(SUM(valor), 0) as total FROM receitas
     WHERE user_id = ? AND strftime('%m', data) = ? AND strftime('%Y', data) = ?`
  ).bind(user.id, mes, ano).first() as any
  if ((receitaMes?.total || 0) >= 5000) await ganhar('receita_5k')

  // ── Sem dívidas ───────────────────────────────────────────────────────────
  const dividas = await c.env.DB.prepare(
    `SELECT COUNT(*) as total FROM (
      SELECT id FROM emprestimos WHERE user_id=? AND status='ativo'
      UNION ALL
      SELECT id FROM financiamentos WHERE user_id=? AND status='ativo'
    )`
  ).bind(user.id, user.id).first() as any
  if ((dividas?.total || 0) === 0) {
    const jaTeveDividas = await c.env.DB.prepare(
      `SELECT COUNT(*) as total FROM (
        SELECT id FROM emprestimos WHERE user_id=?
        UNION ALL
        SELECT id FROM financiamentos WHERE user_id=?
      )`
    ).bind(user.id, user.id).first() as any
    if ((jaTeveDividas?.total || 0) > 0) {
      await ganhar('sem_dividas')
      await ganhar('sem_dividas_total')
    }
  }

  // ── Imóvel quitado ────────────────────────────────────────────────────────
  const imovelQuitado = await c.env.DB.prepare(
    `SELECT COUNT(*) as total FROM financiamentos 
     WHERE user_id=? AND status='quitado' AND tipo_bem IN ('imovel','imovel_comercial')`
  ).bind(user.id).first() as any
  if ((imovelQuitado?.total || 0) >= 1) await ganhar('imovel_quitado')

  // ── Investimentos ─────────────────────────────────────────────────────────
  const totalInv = await c.env.DB.prepare(
    'SELECT COALESCE(SUM(valor_atual), 0) as total, COALESCE(SUM(valor_investido), 0) as investido FROM investimentos WHERE user_id = ?'
  ).bind(user.id).first() as any
  const valorAtual = totalInv?.total || 0
  const valorInvestido = totalInv?.investido || 0
  if (valorAtual >= 10000) await ganhar('poupador_dedicado')
  if (valorAtual >= 100000) await ganhar('milionario')
  if (valorAtual > 0 && valorAtual > valorInvestido) await ganhar('primeiro_lucro')

  const tiposDistintos = await c.env.DB.prepare(
    'SELECT COUNT(DISTINCT tipo) as cnt FROM investimentos WHERE user_id = ?'
  ).bind(user.id).first() as any
  if ((tiposDistintos?.cnt || 0) >= 3) await ganhar('investidor_diversificado')

  // Patrimônio líquido positivo (investimentos - dívidas)
  const totalDividas = await c.env.DB.prepare(
    `SELECT COALESCE(SUM(saldo_devedor),0) as total FROM emprestimos WHERE user_id=? AND status='ativo'`
  ).bind(user.id).first() as any
  const totalFinanc = await c.env.DB.prepare(
    `SELECT COALESCE(SUM(saldo_devedor),0) as total FROM financiamentos WHERE user_id=? AND status='ativo'`
  ).bind(user.id).first() as any
  const patrimonioLiq = valorAtual - (totalDividas?.total || 0) - (totalFinanc?.total || 0)
  if (patrimonioLiq > 0) await ganhar('patrimonio_positivo')

  // Investiu mais que gastou no mês
  const despesasMes = await c.env.DB.prepare(
    `SELECT COALESCE(SUM(valor),0) as total FROM despesas
     WHERE user_id=? AND COALESCE(tipo,'normal')!='aporte'
     AND COALESCE(eh_aporte_patrimonial,0)=0
     AND strftime('%m',COALESCE(data,vencimento))=? AND strftime('%Y',COALESCE(data,vencimento))=?`
  ).bind(user.id, mes, ano).first() as any
  const aporteMes = await c.env.DB.prepare(
    `SELECT COALESCE(SUM(valor_investido),0) as total FROM investimentos
     WHERE user_id=? AND strftime('%m',data_inicio)=? AND strftime('%Y',data_inicio)=?`
  ).bind(user.id, mes, ano).first() as any
  if ((aporteMes?.total || 0) > 0 && (aporteMes?.total || 0) > (despesasMes?.total || 0)) {
    await ganhar('investiu_mais_que_gastou')
  }

  // ── Reserva de emergência ─────────────────────────────────────────────────
  const reservaRow = await c.env.DB.prepare(
    'SELECT valor_atual FROM reserva_emergencia WHERE user_id = ? LIMIT 1'
  ).bind(user.id).first() as any
  if (reservaRow) {
    await ganhar('reserva_iniciada')
    const mediaDesp = await c.env.DB.prepare(`
      SELECT COALESCE(AVG(total_mes), 0) as media FROM (
        SELECT SUM(valor) as total_mes FROM despesas
        WHERE user_id = ? AND status IN ('pago','pendente')
        AND data >= date('now', '-3 months')
        GROUP BY strftime('%Y-%m', data)
      )
    `).bind(user.id).first() as any
    const media = mediaDesp?.media || 0
    if (media > 0) {
      const mesesCobertos = reservaRow.valor_atual / media
      if (mesesCobertos >= 1)  await ganhar('reserva_1_mes')
      if (mesesCobertos >= 3)  await ganhar('reserva_3_meses')
      if (mesesCobertos >= 6)  await ganhar('reserva_6_meses')
      if (mesesCobertos >= 9)  await ganhar('reserva_9_meses')
      if (mesesCobertos >= 12) await ganhar('reserva_12_meses')
    }
  }

  // ── Orçamentos ────────────────────────────────────────────────────────────
  const orcamentos = await c.env.DB.prepare(
    'SELECT COUNT(*) as total FROM orcamentos WHERE user_id = ?'
  ).bind(user.id).first() as any
  if ((orcamentos?.total || 0) >= 1) await ganhar('primeiro_orcamento')
  if ((orcamentos?.total || 0) >= 3) await ganhar('3_orcamentos')

  // ── Meta grande (>R$10.000) ────────────────────────────────────────────────
  const metaGrande = await c.env.DB.prepare(
    'SELECT COUNT(*) as total FROM metas WHERE user_id = ? AND valor_objetivo >= 10000'
  ).bind(user.id).first() as any
  if ((metaGrande?.total || 0) >= 1) await ganhar('meta_grande')

  // ── Desafio 52 ────────────────────────────────────────────────────────────
  let desafio: any = null
  try {
    // Conta semanas concluídas e soma os valores acumulados
    const desafioRows = await c.env.DB.prepare(
      `SELECT COUNT(*) as semanas_concluidas,
              COALESCE(SUM(target_amount),0) as valor_acumulado
       FROM weekly_challenges WHERE user_id=? AND status='completed'`
    ).bind(user.id).first() as any
    if (desafioRows && (desafioRows.semanas_concluidas || 0) > 0) {
      desafio = desafioRows
      await ganhar('desafio_52_iniciou')
      if ((desafio.semanas_concluidas || 0) >= 10) await ganhar('desafio_52_10sem')
      if ((desafio.semanas_concluidas || 0) >= 26) await ganhar('desafio_52_metade')
      if ((desafio.semanas_concluidas || 0) >= 52) await ganhar('desafio_52_completo')
      if ((desafio.valor_acumulado || 0) >= 1000) await ganhar('desafio_52_1k')
    } else {
      // Se tem pelo menos 1 registro de weekly_challenges, já iniciou
      const temDesafio = await c.env.DB.prepare(
        `SELECT COUNT(*) as total FROM weekly_challenges WHERE user_id=?`
      ).bind(user.id).first() as any
      if ((temDesafio?.total || 0) >= 1) {
        desafio = { semanas_concluidas: 0, valor_acumulado: 0 }
        await ganhar('desafio_52_iniciou')
      }
    }
  } catch { /* desafio_52 / weekly_challenges */ }

  // ── Meses ativos (lançamentos em meses distintos) ─────────────────────────
  const mesesAtivos = await c.env.DB.prepare(
    `SELECT COUNT(DISTINCT strftime('%Y-%m', data)) as cnt
     FROM (
       SELECT data FROM receitas WHERE user_id=?
       UNION ALL
       SELECT data FROM despesas WHERE user_id=?
     )`
  ).bind(user.id, user.id).first() as any
  if ((mesesAtivos?.cnt || 0) >= 3) await ganhar('3_meses_ativos')
  if ((mesesAtivos?.cnt || 0) >= 6) await ganhar('6_meses_receita')

  // ── Saldo mensal positivo por 3 meses ────────────────────────────────────
  const saldosMes = await c.env.DB.prepare(
    `SELECT strftime('%Y-%m', r.data) as mes,
            COALESCE(SUM(r.valor),0) - COALESCE((
              SELECT SUM(d.valor) FROM despesas d
              WHERE d.user_id=r.user_id
              AND strftime('%Y-%m',d.data)=strftime('%Y-%m',r.data)
              AND COALESCE(d.tipo,'normal')!='aporte'
            ),0) as saldo
     FROM receitas r WHERE r.user_id=?
     GROUP BY mes ORDER BY mes DESC LIMIT 6`
  ).bind(user.id).all() as any
  const mesesPositivos = (saldosMes?.results || []).filter((m: any) => (m.saldo || 0) > 0).length
  if (mesesPositivos >= 1) await ganhar('primeiro_saldo_positivo')
  if (mesesPositivos >= 3) await ganhar('saldo_positivo_3m')

  // ── Usuário completo ──────────────────────────────────────────────────────
  const temTudo = (receitas?.total || 0) >= 1
    && (despesas?.total || 0) >= 1
    && (investimentos?.total || 0) >= 1
    && (metas?.total || 0) >= 1
    && reservaRow != null
  if (temTudo) await ganhar('usuario_completo')

  // ── BLOCO 0035: Novas conquistas ──────────────────────────────────────────

  // Assinaturas — usa detected_subscriptions (serviços como Netflix, Spotify, etc.)
  // A tabela 'assinaturas' contém apenas o plano do app (free/premium/pro),
  // então usamos detected_subscriptions para conquistas de serviços de assinatura.
  let assinaturasDetectadas: any = null
  try {
    assinaturasDetectadas = await c.env.DB.prepare(
      `SELECT COUNT(*) as total, COALESCE(SUM(amount),0) as total_mensal,
              COUNT(CASE WHEN service_type IS NOT NULL AND service_type != '' THEN 1 END) as com_tipo
       FROM detected_subscriptions
       WHERE user_id = ? AND (status != 'cancelled' OR status IS NULL)`
    ).bind(user.id).first() as any
  } catch { assinaturasDetectadas = null }

  // Fallback: também verificar recorrências com padrão de assinatura
  let assinaturasRecorrencias: any = null
  try {
    assinaturasRecorrencias = await c.env.DB.prepare(
      `SELECT COUNT(*) as total, COALESCE(SUM(valor),0) as total_mensal
       FROM recorrencias WHERE user_id = ? AND ativa = 1
       AND (LOWER(descricao) LIKE '%netflix%' OR LOWER(descricao) LIKE '%spotify%'
            OR LOWER(descricao) LIKE '%amazon%' OR LOWER(descricao) LIKE '%disney%'
            OR LOWER(descricao) LIKE '%youtube%' OR LOWER(descricao) LIKE '%hbo%'
            OR LOWER(descricao) LIKE '%globoplay%' OR LOWER(descricao) LIKE '%assinatura%'
            OR LOWER(descricao) LIKE '%mensalidade%' OR LOWER(descricao) LIKE '%plano%'
            OR LOWER(descricao) LIKE '%streaming%' OR LOWER(descricao) LIKE '%academia%'
            OR LOWER(descricao) LIKE '%seguro%' OR LOWER(descricao) LIKE '%plano de saude%'
            OR LOWER(categoria) = 'assinatura' OR LOWER(categoria) = 'streaming'
            OR LOWER(categoria) = 'saude' OR LOWER(categoria) = 'educacao')`
    ).bind(user.id).first() as any
  } catch { assinaturasRecorrencias = null }

  const totalAssinDetectadas = (assinaturasDetectadas?.total || 0)
  const totalAssinRec = (assinaturasRecorrencias?.total || 0)
  const totalAssinaturas = totalAssinDetectadas + totalAssinRec

  if (totalAssinaturas >= 1) await ganhar('primeira_assinatura')

  // assinaturas_organizadas — todas as assinaturas detectadas têm service_type
  if (totalAssinDetectadas > 0 && (assinaturasDetectadas?.com_tipo || 0) === totalAssinDetectadas) {
    await ganhar('assinaturas_organizadas')
  }
  // Fallback: tem recorrências de assinatura categorizadas
  if (totalAssinRec > 0 && totalAssinDetectadas === 0) await ganhar('assinaturas_organizadas')

  // assinatura_econômico — gasto total com assinaturas < R$200/mês
  // Se há detected_subscriptions, usar apenas esse valor (evitar dupla contagem)
  // Fallback para recorrências apenas se não há detected subscriptions
  const gastoAssinaturas = totalAssinDetectadas > 0
    ? (assinaturasDetectadas?.total_mensal || 0)
    : (assinaturasRecorrencias?.total_mensal || 0)
  if (gastoAssinaturas > 0 && gastoAssinaturas < 200) await ganhar('assinatura_econômico')

  // Recorrências
  const recorrencias = await c.env.DB.prepare(
    "SELECT COUNT(*) as total FROM recorrencias WHERE user_id = ?"
  ).bind(user.id).first() as any
  if ((recorrencias?.total || 0) >= 1) await ganhar('primeira_recorrencia')
  if ((recorrencias?.total || 0) >= 3) await ganhar('3_recorrencias')

  // Cartões: 2 e 5 cadastrados
  if ((cartoes?.total || 0) >= 2) await ganhar('dois_cartoes')
  if ((cartoes?.total || 0) >= 5) await ganhar('cinco_cartoes')

  // Limite total de cartões > R$10.000
  const limiteTotal = await c.env.DB.prepare(
    "SELECT COALESCE(SUM(limite_total), 0) as total FROM cartoes WHERE user_id = ?"
  ).bind(user.id).first() as any
  if ((limiteTotal?.total || 0) >= 10000) await ganhar('limite_10k')

  // Lembretes concluídos (20) — lembretes usa 'ativo' booleano, não status
  // Considera concluídos os lembretes com ativo=0 (desativados após conclusão)
  const lembretesConc = await c.env.DB.prepare(
    "SELECT COUNT(*) as total FROM lembretes WHERE user_id = ? AND ativo = 0"
  ).bind(user.id).first() as any
  if ((lembretesConc?.total || 0) >= 20) await ganhar('20_lembretes_concluidos')

  // Lembretes ativos simultâneos (3)
  const lembretesAtivos = await c.env.DB.prepare(
    "SELECT COUNT(*) as total FROM lembretes WHERE user_id = ? AND ativo = 1"
  ).bind(user.id).first() as any
  if ((lembretesAtivos?.total || 0) >= 3) await ganhar('3_lembretes_ativos')

  // Financiamentos
  const financiamentos = await c.env.DB.prepare(
    "SELECT COUNT(*) as total FROM financiamentos WHERE user_id = ?"
  ).bind(user.id).first() as any
  if ((financiamentos?.total || 0) >= 1) await ganhar('primeiro_financiamento')

  // Amortização antecipada: financiamento com entrada parcelada paga (entrada_parcelas_pagas > 0)
  // ou com valor de entrada pago (valor_entrada > 0 e parcelas_pagas > numero_parcelas * 0.1)
  const amortizou = await c.env.DB.prepare(
    `SELECT COUNT(*) as total FROM financiamentos WHERE user_id = ?
     AND (entrada_parcelas_pagas > 0 OR (valor_entrada > 0 AND parcelas_pagas > 0))`
  ).bind(user.id).first() as any
  if ((amortizou?.total || 0) >= 1) await ganhar('amortizou_antecipado')

  // Meio caminho no financiamento (saldo_devedor < valor_financiado * 0.5 ou quitado)
  const meiadoPago = await c.env.DB.prepare(
    `SELECT COUNT(*) as total FROM financiamentos
     WHERE user_id = ? AND valor_financiado > 0
     AND (
       (status = 'ativo' AND saldo_devedor > 0 AND saldo_devedor < (valor_financiado * 0.5))
       OR status = 'quitado'
     )`
  ).bind(user.id).first() as any
  if ((meiadoPago?.total || 0) >= 1) await ganhar('metade_paga')

  // Empréstimos
  const emprestimos = await c.env.DB.prepare(
    "SELECT COUNT(*) as total FROM emprestimos WHERE user_id = ?"
  ).bind(user.id).first() as any
  if ((emprestimos?.total || 0) >= 1) await ganhar('primeiro_emprestimo')

  const emprestimoQuitado = await c.env.DB.prepare(
    "SELECT COUNT(*) as total FROM emprestimos WHERE user_id = ? AND status = 'quitado'"
  ).bind(user.id).first() as any
  if ((emprestimoQuitado?.total || 0) >= 1) await ganhar('emprestimo_quitado')

  // Receita de investimento (categoria = 'Investimentos' ou 'Dividendos' etc.)
  const rendaInv = await c.env.DB.prepare(
    `SELECT COUNT(*) as total FROM receitas
     WHERE user_id = ? AND (
       LOWER(categoria) IN ('investimentos','investimento','dividendo','dividendos','rendimento','rendimentos','renda variavel','renda_variavel')
       OR LOWER(tipo) IN ('investimento','dividendo','rendimento','renda_variavel')
     )`
  ).bind(user.id).first() as any
  if ((rendaInv?.total || 0) >= 1) await ganhar('renda_de_investimento')

  // Receita mensal > R$10.000
  if ((receitaMes?.total || 0) >= 10000) await ganhar('receita_10k')

  // Metas específicas
  const metaEducConcluida = await c.env.DB.prepare(
    `SELECT COUNT(*) as total FROM metas
     WHERE user_id = ? AND status = 'concluida'
     AND LOWER(categoria) IN ('educacao','educação','curso','faculdade','estudo','capacitacao','capacitação')`
  ).bind(user.id).first() as any
  if ((metaEducConcluida?.total || 0) >= 1) await ganhar('meta_educacao_concluida')

  const metaViagemConc = await c.env.DB.prepare(
    `SELECT COUNT(*) as total FROM metas
     WHERE user_id = ? AND status = 'concluida'
     AND LOWER(categoria) IN ('viagem','trip','turismo','ferias','férias')`
  ).bind(user.id).first() as any
  if ((metaViagemConc?.total || 0) >= 1) await ganhar('meta_viagem_concluida')

  const metaAposentadoria = await c.env.DB.prepare(
    `SELECT COUNT(*) as total FROM metas
     WHERE user_id = ? AND LOWER(categoria) IN ('aposentadoria','independencia','independência_financeira','liberdade','liberdade_financeira')`
  ).bind(user.id).first() as any
  if ((metaAposentadoria?.total || 0) >= 1) await ganhar('pensa_no_futuro')

  // Primeiro aporte em meta
  const aportesMeta = await c.env.DB.prepare(
    "SELECT COUNT(*) as total FROM metas WHERE user_id = ? AND valor_atual > 0"
  ).bind(user.id).first() as any
  if ((aportesMeta?.total || 0) >= 1) await ganhar('primeiro_aporte_meta')

  // Total de transações (receitas + despesas)
  const totalTransacoes = ((receitas?.total || 0) + (despesas?.total || 0))
  if (totalTransacoes >= 100) await ganhar('100_transacoes')
  if (totalTransacoes >= 500) await ganhar('500_transacoes')

  // Patrimônio líquido > R$500.000
  if (patrimonioLiq >= 500000) await ganhar('patrimonio_500k')

  // ── Score de saúde ────────────────────────────────────────────────────────
  const scoreAtual = await c.env.DB.prepare(
    "SELECT score_saude FROM users WHERE id = ?"
  ).bind(user.id).first() as any
  const score = scoreAtual?.score_saude || 0
  if (score >= 50)  await ganhar('score_50')
  if (score >= 70)  await ganhar('score_70')
  if (score >= 80)  await ganhar('score_80')
  if (score >= 90)  await ganhar('score_90')
  if (score >= 100) await ganhar('score_100')

  // Score > 80 por 3 meses consecutivos (usando histórico de score)
  if (score >= 80) {
    try {
      const scoreHist = await c.env.DB.prepare(
        `SELECT score_geral FROM score_historico WHERE user_id = ? ORDER BY mes DESC LIMIT 3`
      ).bind(user.id).all() as any
      const hist = scoreHist?.results || []
      if (hist.length >= 3 && hist.every((h: any) => (h.score_geral || 0) >= 80)) {
        await ganhar('score_80_3m')
      }
    } catch { /* tabela pode não existir */ }
  }

  // ── Olho no Futuro (viu_projecao) — ganho ao acessar projetor/simulador ───
  // Verifica se já tem projetor (acessou a tela de projeção) ou investimentos
  const jaAcessouProjetor = await c.env.DB.prepare(
    `SELECT COUNT(*) as total FROM conquistas_usuario WHERE user_id = ? AND conquista_codigo IN ('projetor','projecao_vista')`
  ).bind(user.id).first() as any
  const usouSimulador = await c.env.DB.prepare(
    `SELECT COUNT(*) as total FROM investimentos WHERE user_id = ?`
  ).bind(user.id).first() as any
  if ((jaAcessouProjetor?.total || 0) >= 1 || (usouSimulador?.total || 0) >= 1) await ganhar('viu_projecao')

  // ── Dinheiro Trabalhando (renda_de_investimento) ──────────────────────────
  const rendaInvCheck = await c.env.DB.prepare(
    `SELECT COUNT(*) as total FROM receitas
     WHERE user_id = ? AND (
       LOWER(categoria) IN ('investimentos','investimento','dividendo','dividendos','rendimento','rendimentos','renda variavel','renda_variavel')
       OR LOWER(tipo) IN ('investimento','dividendo','rendimento','renda_variavel')
     )`
  ).bind(user.id).first() as any
  if ((rendaInvCheck?.total || 0) >= 1) await ganhar('renda_de_investimento')

  // Investimento com rentabilidade positiva = dinheiro trabalhando
  const invComLucro = await c.env.DB.prepare(
    `SELECT COUNT(*) as total FROM investimentos WHERE user_id=? AND valor_atual > valor_investido`
  ).bind(user.id).first() as any
  if ((invComLucro?.total || 0) >= 1) await ganhar('renda_de_investimento')

  // ── Antecipação de Contas ─────────────────────────────────────────────────
  try {
    const antecipacoes = await c.env.DB.prepare(
      `SELECT COUNT(*) as total FROM antecipacoes WHERE user_id=? AND status='antecipada'`
    ).bind(user.id).first() as any
    if ((antecipacoes?.total || 0) >= 1) await ganhar('primeira_antecipacao')
    if ((antecipacoes?.total || 0) >= 3) await ganhar('3_antecipacoes')
  } catch { /* tabela pode não existir */ }

  // ── Recebimentos Parcelados ───────────────────────────────────────────────
  try {
    const recebPrimeiro = await c.env.DB.prepare(
      `SELECT COUNT(*) as total FROM recebimentos_parcelados WHERE user_id=?`
    ).bind(user.id).first() as any
    if ((recebPrimeiro?.total || 0) >= 1) await ganhar('primeiro_recebimento_parcelado')

    const recebConcluido = await c.env.DB.prepare(
      `SELECT COUNT(*) as total FROM recebimentos_parcelados WHERE user_id=? AND status='concluido'`
    ).bind(user.id).first() as any
    if ((recebConcluido?.total || 0) >= 1) await ganhar('recebimento_concluido')
  } catch { /* tabela pode não existir */ }

  // ══════════════════════════════════════════════════════════════════════════
  // ── BLOCO COMPLETO: 88 CONQUISTAS ANTERIORMENTE SEM VERIFICAÇÃO ──────────
  // ══════════════════════════════════════════════════════════════════════════

  // ── [Investimentos por tipo] ──────────────────────────────────────────────
  try {
    const invAcoes = await c.env.DB.prepare(
      `SELECT COUNT(*) as total FROM investimentos WHERE user_id=? AND LOWER(tipo) IN ('acoes','outros')`
    ).bind(user.id).first() as any
    if ((invAcoes?.total || 0) >= 1) await ganhar('investidor_acoes')

    const invFii = await c.env.DB.prepare(
      `SELECT COUNT(*) as total FROM investimentos WHERE user_id=? AND LOWER(tipo) IN ('fii')`
    ).bind(user.id).first() as any
    if ((invFii?.total || 0) >= 1) await ganhar('investidor_fii')

    const invCripto = await c.env.DB.prepare(
      `SELECT COUNT(*) as total FROM investimentos WHERE user_id=? AND LOWER(tipo) IN ('cripto')`
    ).bind(user.id).first() as any
    if ((invCripto?.total || 0) >= 1) await ganhar('investidor_cripto')

    const invTesouro = await c.env.DB.prepare(
      `SELECT COUNT(*) as total FROM investimentos WHERE user_id=? AND LOWER(tipo) IN ('tesouro_direto')`
    ).bind(user.id).first() as any
    if ((invTesouro?.total || 0) >= 1) await ganhar('investidor_tesouro')

    const invCdb = await c.env.DB.prepare(
      `SELECT COUNT(*) as total FROM investimentos WHERE user_id=? AND LOWER(tipo) IN ('cdb','lci','lca')`
    ).bind(user.id).first() as any
    if ((invCdb?.total || 0) >= 1) await ganhar('investidor_cdb')

    // Investidor CDI — investimento com rendimento atrelado ao CDI
    const invCdi = await c.env.DB.prepare(
      `SELECT COUNT(*) as total FROM investimentos WHERE user_id=? AND LOWER(tipo) IN ('cdb','lci','lca','tesouro_direto')`
    ).bind(user.id).first() as any
    if ((invCdi?.total || 0) >= 1) await ganhar('investidor_cdi')

    // Veterano: >= 10 investimentos
    const totalInvCount = await c.env.DB.prepare(
      `SELECT COUNT(*) as total FROM investimentos WHERE user_id=?`
    ).bind(user.id).first() as any
    if ((totalInvCount?.total || 0) >= 10) await ganhar('investidor_veteran')

    // Barreira dos 100k
    if (valorAtual >= 100000) await ganhar('barreira_100k')
    if (valorAtual >= 10000)  await ganhar('barreira_10k')
    if (valorAtual >= 50000)  await ganhar('barreira_50k')
    if (valorAtual >= 1000000) await ganhar('primeiro_milhao')

    // Aporte nos últimos 3 meses consecutivos
    const aportesUlt3 = await c.env.DB.prepare(
      `SELECT COUNT(DISTINCT strftime('%Y-%m', data_inicio)) as cnt
       FROM investimentos WHERE user_id=?
       AND data_inicio >= date('now','-3 months')`
    ).bind(user.id).first() as any
    if ((aportesUlt3?.cnt || 0) >= 3) {
      await ganhar('aporte_3_meses')
      await ganhar('investidor_mensal')
      await ganhar('aporta_todo_mes')
    }

    // Aporte recorrente — tem recorrência do tipo receita ou despesa com categoria investimento
    const aportRec = await c.env.DB.prepare(
      `SELECT COUNT(*) as total FROM recorrencias WHERE user_id=? AND ativa=1
       AND (LOWER(categoria) LIKE '%invest%' OR LOWER(descricao) LIKE '%aporte%')`
    ).bind(user.id).first() as any
    if ((aportRec?.total || 0) >= 1) await ganhar('aporte_recorrente')

    // Diversificador: >= 4 tipos distintos de investimento
    const tiposInv = await c.env.DB.prepare(
      `SELECT COUNT(DISTINCT tipo) as cnt FROM investimentos WHERE user_id=?`
    ).bind(user.id).first() as any
    if ((tiposInv?.cnt || 0) >= 4) await ganhar('diversificador')
    if ((tiposInv?.cnt || 0) >= 3) await ganhar('carteira_diversa')

    // Crescimento anual — aporte este ano maior que no ano anterior
    const anoAtual = new Date().getFullYear()
    const aporteAnoAtual = await c.env.DB.prepare(
      `SELECT COALESCE(SUM(valor_investido),0) as total FROM investimentos
       WHERE user_id=? AND strftime('%Y',data_inicio)=?`
    ).bind(user.id, String(anoAtual)).first() as any
    const aporteAnoAnterior = await c.env.DB.prepare(
      `SELECT COALESCE(SUM(valor_investido),0) as total FROM investimentos
       WHERE user_id=? AND strftime('%Y',data_inicio)=?`
    ).bind(user.id, String(anoAtual - 1)).first() as any
    if ((aporteAnoAtual?.total || 0) > 0 && (aporteAnoAnterior?.total || 0) > 0
        && (aporteAnoAtual.total > aporteAnoAnterior.total)) {
      await ganhar('crescimento_anual')
    }
  } catch { /* investimentos */ }

  // ── [Cartões] ─────────────────────────────────────────────────────────────
  try {
    // Uso do cartão calculado: (limite_total - limite_disponivel) / limite_total
    // limite_disponivel = limite não usado; usado = limite_total - limite_disponivel
    const cartoesUso = await c.env.DB.prepare(
      `SELECT SUM(limite_total) as lim_total,
              SUM(limite_total - limite_disponivel) as usado_total
       FROM cartoes WHERE user_id=? AND limite_total > 0 AND ativo = 1`
    ).bind(user.id).first() as any
    if (cartoesUso && (cartoesUso.lim_total || 0) > 0) {
      const pct = (cartoesUso.usado_total || 0) / cartoesUso.lim_total
      if (pct < 0.30) await ganhar('uso_baixo_cartao')
      if (pct === 0)  await ganhar('zero_dividas_cartao')
      if (pct <= 0.50) await ganhar('fatura_saudavel')
    }

    // Zero dívidas em cartão (limite_disponivel == limite_total em todos os cartões)
    const cartaoSemDivida = await c.env.DB.prepare(
      `SELECT COUNT(*) as total FROM cartoes WHERE user_id=?
       AND ativo=1 AND (limite_disponivel >= limite_total OR limite_total = 0)`
    ).bind(user.id).first() as any
    if ((cartaoSemDivida?.total || 0) > 0 && (cartaoSemDivida.total === (cartoes?.total || 0))) {
      await ganhar('zero_dividas_cartao')
      await ganhar('zero_divida_cartao')
      await ganhar('sem_cartao_devedor')
    }

    // zero_divida_cartao (categoria geral) — nenhum gasto no cartão
    const semDividaCartao = await c.env.DB.prepare(
      `SELECT COALESCE(SUM(limite_total - limite_disponivel),0) as usado FROM cartoes
       WHERE user_id=? AND ativo=1 AND limite_total > 0`
    ).bind(user.id).first() as any
    if ((semDividaCartao?.usado || 0) <= 0 && (cartoes?.total || 0) > 0) {
      await ganhar('zero_divida_cartao')
      await ganhar('sem_cartao_devedor')
    }
  } catch { /* cartões */ }

  // ── [Despesas — comportamento mensal] ────────────────────────────────────
  try {
    // Mês zerado — sem despesas no mês atual
    const despMes = await c.env.DB.prepare(
      `SELECT COALESCE(SUM(valor),0) as total FROM despesas WHERE user_id=?
       AND strftime('%Y-%m', COALESCE(data,vencimento)) = strftime('%Y-%m','now')
       AND COALESCE(tipo,'normal') != 'aporte'`
    ).bind(user.id).first() as any
    const recMes2 = await c.env.DB.prepare(
      `SELECT COALESCE(SUM(valor),0) as total FROM receitas WHERE user_id=?
       AND strftime('%Y-%m', data) = strftime('%Y-%m','now')`
    ).bind(user.id).first() as any
    if ((despMes?.total || 0) === 0 && (recMes2?.total || 0) > 0) await ganhar('mes_zerado')

    // Reduziu gastos em 3 categorias (este mês vs mês anterior)
    const reducaoRows = await c.env.DB.prepare(
      `SELECT categoria,
              SUM(CASE WHEN strftime('%Y-%m',COALESCE(data,vencimento))=strftime('%Y-%m','now') THEN valor ELSE 0 END) as atual,
              SUM(CASE WHEN strftime('%Y-%m',COALESCE(data,vencimento))=strftime('%Y-%m','now','-1 month') THEN valor ELSE 0 END) as anterior
       FROM despesas WHERE user_id=? AND COALESCE(tipo,'normal')!='aporte'
       GROUP BY categoria HAVING anterior > 0 AND atual < anterior`
    ).bind(user.id).all() as any
    if ((reducaoRows?.results?.length || 0) >= 3) await ganhar('reduziu_3_categorias')

    // Sem gastos de luxo no mês (sem despesas em categorias consideradas luxo)
    const luxoCats = ['lazer','luxo','viagem','joias','hobby','entretenimento premium']
    const luxoMes = await c.env.DB.prepare(
      `SELECT COUNT(*) as total FROM despesas WHERE user_id=?
       AND LOWER(categoria) IN (${luxoCats.map(() => '?').join(',')})
       AND strftime('%Y-%m', COALESCE(data,vencimento)) = strftime('%Y-%m','now')`
    ).bind(user.id, ...luxoCats).first() as any
    if ((luxoMes?.total || 0) === 0 && (despesas?.total || 0) > 0) await ganhar('sem_gastos_luxo')

    // Sem atraso: nenhuma despesa vencida e não paga
    const vencidas = await c.env.DB.prepare(
      `SELECT COUNT(*) as total FROM despesas WHERE user_id=?
       AND status='pendente' AND vencimento < date('now')`
    ).bind(user.id).first() as any
    if ((vencidas?.total || 0) === 0 && (despesas?.total || 0) >= 5) await ganhar('sem_atraso')

    // Zero atraso por 3 meses
    if ((vencidas?.total || 0) === 0) {
      const atrasosHist = await c.env.DB.prepare(
        `SELECT COUNT(*) as total FROM despesas WHERE user_id=?
         AND status='pendente' AND vencimento < date('now','-90 days')`
      ).bind(user.id).first() as any
      if ((atrasosHist?.total || 0) === 0 && (despesas?.total || 0) >= 10) await ganhar('zero_atraso_3m')
    }
  } catch { /* despesas comportamental */ }

  // ── [Metas comportamentais] ───────────────────────────────────────────────
  try {
    // Meta concluída antes do prazo (data_meta é o prazo; valor_atual >= valor_objetivo = concluída)
    const metaAntecipada = await c.env.DB.prepare(
      `SELECT COUNT(*) as total FROM metas WHERE user_id=?
       AND status='concluida' AND data_criacao < data_meta`
    ).bind(user.id).first() as any
    if ((metaAntecipada?.total || 0) >= 1) await ganhar('meta_antes_prazo')

    // Meta rápida — concluída em menos de 30 dias (usa data_meta como prazo)
    const metaRapida = await c.env.DB.prepare(
      `SELECT COUNT(*) as total FROM metas WHERE user_id=?
       AND status='concluida'
       AND julianday(data_meta) - julianday(data_criacao) <= 30`
    ).bind(user.id).first() as any
    if ((metaRapida?.total || 0) >= 1) await ganhar('meta_rapida')

    // 3 metas de educação concluídas
    const metaEduc3 = await c.env.DB.prepare(
      `SELECT COUNT(*) as total FROM metas WHERE user_id=? AND status='concluida'
       AND LOWER(categoria) IN ('educacao','educação','curso','faculdade','estudo','capacitacao','capacitação')`
    ).bind(user.id).first() as any
    if ((metaEduc3?.total || 0) >= 3) await ganhar('3_metas_meta_concluidas')
  } catch { /* metas comportamentais */ }

  // ── [Orçamentos] ──────────────────────────────────────────────────────────
  try {
    // A tabela orcamentos tem: categoria, mes, ano, limite
    // Gasto calculado cruzando com despesas do mesmo mês/ano/categoria
    const orcMesAtual = await c.env.DB.prepare(
      `SELECT o.categoria, o.limite,
              COALESCE((
                SELECT SUM(d.valor) FROM despesas d
                WHERE d.user_id = o.user_id
                AND LOWER(d.categoria) = LOWER(o.categoria)
                AND strftime('%m', COALESCE(d.data, d.vencimento)) = printf('%02d', o.mes)
                AND strftime('%Y', COALESCE(d.data, d.vencimento)) = CAST(o.ano AS TEXT)
                AND COALESCE(d.tipo,'normal') != 'aporte'
              ),0) as gasto_atual
       FROM orcamentos o WHERE o.user_id=?
       AND o.mes = CAST(strftime('%m','now') AS INTEGER)
       AND o.ano = CAST(strftime('%Y','now') AS INTEGER)`
    ).bind(user.id).all() as any
    const orcRows = orcMesAtual?.results || []
    const orcNoLimite = orcRows.filter((o: any) => (o.gasto_atual || 0) <= (o.limite || 0))
    if (orcNoLimite.length >= 3) await ganhar('orcamentos_no_limite')
    if (orcNoLimite.length >= 1) await ganhar('orcamento_cumprido')

    // Orçamento completo — tem orçamento para pelo menos 5 categorias diferentes
    const orcCategorias = await c.env.DB.prepare(
      `SELECT COUNT(DISTINCT categoria) as cnt FROM orcamentos WHERE user_id=?`
    ).bind(user.id).first() as any
    if ((orcCategorias?.cnt || 0) >= 5) await ganhar('orcamento_completo')
  } catch { /* orçamentos */ }

  // ── [Reservas especializadas] ─────────────────────────────────────────────
  try {
    const reservasEspec = await c.env.DB.prepare(
      `SELECT COUNT(*) as total FROM specialized_reserves WHERE user_id=? AND current_amount > 0`
    ).bind(user.id).first() as any
    if ((reservasEspec?.total || 0) >= 1) await ganhar('reserva_spec_completa')
    if ((reservasEspec?.total || 0) >= 3) await ganhar('multi_3_reservas')
    if ((reservasEspec?.total || 0) >= 1) await ganhar('multi_reserva_criada')

    // Super reserva — reserva de emergência >= 12 meses
    if (reservaRow) {
      const mediaDesp2 = await c.env.DB.prepare(
        `SELECT COALESCE(AVG(total_mes),0) as media FROM (
          SELECT SUM(valor) as total_mes FROM despesas WHERE user_id=?
          AND data >= date('now','-6 months')
          GROUP BY strftime('%Y-%m',data)
        )`
      ).bind(user.id).first() as any
      if ((mediaDesp2?.media || 0) > 0 && reservaRow.valor_atual / mediaDesp2.media >= 12) {
        await ganhar('super_reserva')
        await ganhar('reserva_completa')
      }
    }
  } catch { /* reservas especializadas */ }

  // ── [Recorrências comportamentais] ────────────────────────────────────────
  try {
    // Recorrências com dia de vencimento definido (organizado)
    const recDia = await c.env.DB.prepare(
      `SELECT COUNT(*) as total FROM recorrencias WHERE user_id=? AND dia_vencimento IS NOT NULL AND ativa=1`
    ).bind(user.id).first() as any
    if ((recDia?.total || 0) >= 3) await ganhar('recorrencias_dia')
  } catch { /* recorrencias */ }

  // ── [Engajamento / Hábito] ────────────────────────────────────────────────
  try {
    // Usou IA
    const usouIA = await c.env.DB.prepare(
      `SELECT COUNT(*) as total FROM ia_insights WHERE user_id=?`
    ).bind(user.id).first() as any
    if ((usouIA?.total || 0) >= 1) await ganhar('usou_ia')
    if ((usouIA?.total || 0) >= 10) await ganhar('ia_power_user')
    if ((usouIA?.total || 0) >= 1) await ganhar('curioso')
    if ((usouIA?.total || 0) >= 5) await ganhar('analitico')
    if ((usouIA?.total || 0) >= 1) await ganhar('analista')
    if ((usouIA?.total || 0) >= 1) await ganhar('projetor')
    if ((usouIA?.total || 0) >= 1) await ganhar('projecao_vista')
    if ((usouIA?.total || 0) >= 1) await ganhar('viu_projecao')
    if ((usouIA?.total || 0) >= 1) await ganhar('usou_simulador')

    // Login em 30 dias consecutivos (usa tabela sessions)
    const loginDias = await c.env.DB.prepare(
      `SELECT COUNT(DISTINCT date(created_at)) as dias FROM sessions WHERE user_id=?
       AND created_at >= date('now','-35 days')`
    ).bind(user.id).first() as any
    if ((loginDias?.dias || 0) >= 5)  await ganhar('acesso_5_dias')
    if ((loginDias?.dias || 0) >= 7)  await ganhar('7_dias_lancando')
    if ((loginDias?.dias || 0) >= 30) await ganhar('30_dias_lancando')
    if ((loginDias?.dias || 0) >= 30) await ganhar('login_30_dias')
    if ((loginDias?.dias || 0) >= 1)  await ganhar('login_diario')

    // 2 anos na plataforma
    const dataCadastro = await c.env.DB.prepare(
      `SELECT data_criacao FROM users WHERE id=?`
    ).bind(user.id).first() as any
    if (dataCadastro?.data_criacao) {
      const anos = (Date.now() - new Date(dataCadastro.data_criacao).getTime()) / (365.25 * 24 * 3600 * 1000)
      if (anos >= 2) await ganhar('2_anos_verde')
    }

    // Perfil completo
    const perfil = await c.env.DB.prepare(
      `SELECT perfil_investidor, avatar_color FROM users WHERE id=?`
    ).bind(user.id).first() as any
    if (perfil?.perfil_investidor) {
      await ganhar('perfil_completo')
      await ganhar('planejador')
    }

    // Usou comparativo CDI
    const compCDI = await c.env.DB.prepare(
      `SELECT COUNT(*) as total FROM cdi_historico LIMIT 1`
    ).first() as any
    if ((compCDI?.total || 0) >= 1 && (investimentos?.total || 0) >= 1) await ganhar('usou_comparativo_cdi')

    // Primeiro relatório (acesso ao endpoint de análise)
    if ((usouIA?.total || 0) >= 1) await ganhar('primeiro_relatorio')

    // Usou filtros — tem tags aplicadas em despesas
    if ((despesasComTag?.total || 0) >= 1) await ganhar('usou_filtros')

    // Exportador de dados — tem receitas e despesas suficientes
    if ((receitas?.total || 0) >= 10 && (despesas?.total || 0) >= 10) await ganhar('exportador_dados')
  } catch { /* engajamento */ }

  // ── [Saúde Financeira] ────────────────────────────────────────────────────
  try {
    // score_80_1m — score >= 80 pelo menos este mês
    if (score >= 80) {
      await ganhar('score_80_1m')
      await ganhar('score_80')
    }
    // score_80_2m — score >= 80 por 2 meses
    if (score >= 80) {
      const hist2 = await c.env.DB.prepare(
        `SELECT score_geral FROM score_historico WHERE user_id=? ORDER BY mes DESC LIMIT 2`
      ).bind(user.id).all() as any
      if ((hist2?.results?.length || 0) >= 2 && hist2.results.every((h: any) => (h.score_geral || 0) >= 80)) {
        await ganhar('score_80_2m')
      }
    }
    // saude_ferro — score >= 90 por 1 mês
    if (score >= 90) await ganhar('saude_ferro')

    // recuperacao — score subiu de < 40 para >= 60
    const scoreHist3 = await c.env.DB.prepare(
      `SELECT score_geral FROM score_historico WHERE user_id=? ORDER BY mes ASC LIMIT 6`
    ).bind(user.id).all() as any
    const histArr = scoreHist3?.results || []
    if (histArr.length >= 2) {
      const primeiro = histArr[0].score_geral || 0
      const ultimo = histArr[histArr.length - 1].score_geral || 0
      if (primeiro < 40 && ultimo >= 60) await ganhar('recuperacao')
      if (ultimo > primeiro + 10) await ganhar('score_melhorou')
    }

    // Regra 50/30/20 — necessidades <= 50% da receita
    const recMesNec = await c.env.DB.prepare(
      `SELECT COALESCE(SUM(valor),0) as total FROM receitas WHERE user_id=?
       AND strftime('%Y-%m',data)=strftime('%Y-%m','now')`
    ).bind(user.id).first() as any
    const despNec = await c.env.DB.prepare(
      `SELECT COALESCE(SUM(valor),0) as total FROM despesas WHERE user_id=?
       AND LOWER(categoria) IN ('moradia','alimentacao','alimentação','saude','saúde','transporte','educacao','educação')
       AND strftime('%Y-%m',COALESCE(data,vencimento))=strftime('%Y-%m','now')`
    ).bind(user.id).first() as any
    if ((recMesNec?.total || 0) > 0 && (despNec?.total || 0) / recMesNec.total <= 0.50) {
      await ganhar('necessidades_50pct')
      await ganhar('regra_503020_verde')
    }

    // Saldo verde por 3 meses (alias de saldo_verde_3m)
    if (mesesPositivos >= 3) await ganhar('saldo_verde_3m')
  } catch { /* saúde */ }

  // ── [Dívidas] ─────────────────────────────────────────────────────────────
  try {
    // Livre do banco — sem empréstimos ativos
    const emprestimosAtivos = await c.env.DB.prepare(
      `SELECT COUNT(*) as total FROM emprestimos WHERE user_id=? AND status='ativo'`
    ).bind(user.id).first() as any
    if ((emprestimosAtivos?.total || 0) === 0 && (emprestimos?.total || 0) >= 1) {
      await ganhar('livre_do_banco')
      await ganhar('livre_emprestimo')
    }

    // Quita dívida — empréstimo quitado
    if ((emprestimoQuitado?.total || 0) >= 1) await ganhar('quita_divida')

    // Empréstimo sem atraso — nenhuma parcela atrasada
    const parcelasAtrasadas = await c.env.DB.prepare(
      `SELECT COUNT(*) as total FROM pagamentos WHERE user_id=? AND status='atrasado'`
    ).bind(user.id).first() as any
    if ((parcelasAtrasadas?.total || 0) === 0 && (emprestimos?.total || 0) >= 1) await ganhar('emprestimo_sem_atraso')

    // Reduziu dívida em 20%
    const divAtual = (totalDividas?.total || 0) + (totalFinanc?.total || 0)
    const divHist = await c.env.DB.prepare(
      `SELECT COALESCE(SUM(saldo_devedor),0) as total FROM emprestimos
       WHERE user_id=? AND status IN ('ativo','quitado')
       UNION ALL
       SELECT COALESCE(SUM(valor_financiado),0) FROM financiamentos WHERE user_id=?`
    ).bind(user.id, user.id).all() as any
    const divOriginal = (divHist?.results || []).reduce((s: number, r: any) => s + (r.total || 0), 0)
    if (divOriginal > 0 && divAtual < divOriginal * 0.80) await ganhar('reduziu_divida_20')
  } catch { /* dívidas */ }

  // ── [Financiamentos comportamentais] ──────────────────────────────────────
  try {
    // Um ano de financiamento
    const finAnual = await c.env.DB.prepare(
      `SELECT COUNT(*) as total FROM financiamentos WHERE user_id=?
       AND status='ativo' AND data_inicio <= date('now','-1 year')`
    ).bind(user.id).first() as any
    if ((finAnual?.total || 0) >= 1) await ganhar('um_ano_financiamento')

    // 50% do financiamento pago (alias)
    if ((meiadoPago?.total || 0) >= 1) await ganhar('50pct_financiamento')

    // Amortizou simulando antes
    const simAmort = await c.env.DB.prepare(
      `SELECT COUNT(*) as total FROM amortization_simulations WHERE user_id=?`
    ).bind(user.id).first() as any
    if ((simAmort?.total || 0) >= 1 && (amortizou?.total || 0) >= 1) await ganhar('amortizou_simulou')
    if ((amortizou?.total || 0) >= 1) await ganhar('amortizou')
    if ((amortizou?.total || 0) >= 3) await ganhar('amortizador_serie')

    // Quitou imóvel
    const quitouImovel = await c.env.DB.prepare(
      `SELECT COUNT(*) as total FROM financiamentos WHERE user_id=? AND status='quitado'
       AND tipo_bem IN ('imovel','imovel_comercial','imóvel')`
    ).bind(user.id).first() as any
    if ((quitouImovel?.total || 0) >= 1) await ganhar('quitou_imovel')
  } catch { /* financiamentos */ }

  // ── [Assinaturas] ─────────────────────────────────────────────────────────
  try {
    // Cortou gordura — cancelou pelo menos 1 assinatura detectada (feedback = 'cancelled')
    const assinCanceladas = await c.env.DB.prepare(
      `SELECT COUNT(*) as total FROM detected_subscriptions
       WHERE user_id=? AND (status='cancelled' OR user_feedback IN ('want_cancel','ignore'))`
    ).bind(user.id).first() as any
    // Também verifica recorrências desativadas com padrão de assinatura
    const recCanceladas = await c.env.DB.prepare(
      `SELECT COUNT(*) as total FROM recorrencias WHERE user_id=? AND ativa=0
       AND (LOWER(descricao) LIKE '%netflix%' OR LOWER(descricao) LIKE '%spotify%'
            OR LOWER(descricao) LIKE '%amazon%' OR LOWER(descricao) LIKE '%disney%'
            OR LOWER(categoria) = 'assinatura' OR LOWER(categoria) = 'streaming')`
    ).bind(user.id).first() as any
    const totalCanceladas = (assinCanceladas?.total || 0) + (recCanceladas?.total || 0)
    if (totalCanceladas >= 1) await ganhar('cortou_gordura')
    if (totalCanceladas >= 1) await ganhar('sub_cancelou_1')

    // Detector de assinatura — detectou assinatura pelo scanner
    const detected = await c.env.DB.prepare(
      `SELECT COUNT(*) as total FROM detected_subscriptions WHERE user_id=?`
    ).bind(user.id).first() as any
    if ((detected?.total || 0) >= 1) await ganhar('detector_assinatura')
    if ((detected?.total || 0) >= 1) await ganhar('sub_detector_scanned')
    if ((detected?.total || 0) >= 5) await ganhar('detector_expert')
  } catch { /* assinaturas */ }

  // ── [Lembretes comportamentais] ───────────────────────────────────────────
  try {
    // Lembrete pontual — lembrete criado com data de vencimento específica
    // lembretes usa proximo_vencimento ou dia_vencimento
    const lembPontual = await c.env.DB.prepare(
      `SELECT COUNT(*) as total FROM lembretes WHERE user_id=?
       AND (proximo_vencimento IS NOT NULL OR dia_vencimento IS NOT NULL)`
    ).bind(user.id).first() as any
    if ((lembPontual?.total || 0) >= 1) await ganhar('lembrete_pontual')

    // Lembrete de fatura — lembrete com título/descricao de cartão/fatura
    const lembFatura = await c.env.DB.prepare(
      `SELECT COUNT(*) as total FROM lembretes WHERE user_id=?
       AND (LOWER(titulo) LIKE '%fatura%' OR LOWER(titulo) LIKE '%cartao%' OR LOWER(titulo) LIKE '%cartão%'
            OR LOWER(COALESCE(descricao,'')) LIKE '%fatura%' OR LOWER(COALESCE(descricao,'')) LIKE '%cartao%')`
    ).bind(user.id).first() as any
    if ((lembFatura?.total || 0) >= 1) await ganhar('lembrete_fatura')
  } catch { /* lembretes */ }

  // ── [Receitas comportamentais] ────────────────────────────────────────────
  try {
    // Renda extra cadastrada (usa categoria pois receitas usam categoria, não tipo)
    const rendaExtra = await c.env.DB.prepare(
      `SELECT COUNT(*) as total FROM receitas WHERE user_id=?
       AND (
         LOWER(categoria) IN ('freelance','bônus','bonus','comissao','comissão','outros','vendas','aluguel')
         OR LOWER(tipo) IN ('extra','freelance','bônus','bonus','comissao','comissão','outras','outro')
       )`
    ).bind(user.id).first() as any
    if ((rendaExtra?.total || 0) >= 1) {
      await ganhar('renda_extra_cadastrada')
      await ganhar('renda_extra')
    }
  } catch { /* receitas */ }

  // ── [Tags] ────────────────────────────────────────────────────────────────
  try {
    const tagsCount = await c.env.DB.prepare(
      `SELECT COUNT(*) as total FROM tags WHERE user_id=?`
    ).bind(user.id).first() as any
    if ((tagsCount?.total || 0) >= 1) await ganhar('primeira_tag')
    if ((tagsCount?.total || 0) >= 10) await ganhar('mestre_tags')
  } catch { /* tags */ }

  // ── [Realizador] ──────────────────────────────────────────────────────────
  try {
    // Realizador — meta concluída + receita de renda variável + investimento
    if ((metaConcluida?.total || 0) >= 1 && (investimentos?.total || 0) >= 1) {
      await ganhar('realizador')
    }

    // Poupador por 3 meses — tem receita e poupou mais de 20% por 3 meses
    const poupaMeses = await c.env.DB.prepare(
      `SELECT COUNT(*) as cnt FROM (
         SELECT strftime('%Y-%m',r.data) as mes,
                SUM(r.valor) as rec,
                COALESCE((SELECT SUM(d.valor) FROM despesas d WHERE d.user_id=r.user_id
                          AND strftime('%Y-%m',d.data)=strftime('%Y-%m',r.data)
                          AND COALESCE(d.tipo,'normal')!='aporte'),0) as desp
         FROM receitas r WHERE r.user_id=?
         GROUP BY mes HAVING rec > 0 AND (rec - desp) / rec >= 0.20
       )`
    ).bind(user.id).first() as any
    if ((poupaMeses?.cnt || 0) >= 1) await ganhar('poupador')
    if ((poupaMeses?.cnt || 0) >= 3) await ganhar('poupador_3m')

    // Regra dos 3 meses — poupou consistentemente
    if ((poupaMeses?.cnt || 0) >= 3) await ganhar('regra_3meses')

    // Desafio do trimestre — 3 meses consecutivos poupando
    if ((poupaMeses?.cnt || 0) >= 3) await ganhar('desafio_trimestre')

    // Desafio 52 — 5 meses (20 semanas)
    if (desafio && (desafio.semanas_concluidas || 0) >= 20) await ganhar('desafio_52_5meses')
  } catch { /* realizador */ }

  // ── [Todas as reservas OK] ────────────────────────────────────────────────
  try {
    // todas_reservas_ok — tem reserva de emergência e pelo menos 1 reserva especializada
    const resEspec2 = await c.env.DB.prepare(
      `SELECT COUNT(*) as total FROM specialized_reserves WHERE user_id=? AND current_amount > 0`
    ).bind(user.id).first() as any
    if (reservaRow && (resEspec2?.total || 0) >= 1) await ganhar('todas_reservas_ok')
  } catch { /* reservas ok */ }

  // ══════════════════════════════════════════════════════════════════════════
  // ── BLOCO FINAL: 19 CONQUISTAS ANTERIORMENTE SEM NENHUMA VERIFICAÇÃO ─────
  // ══════════════════════════════════════════════════════════════════════════

  // ── [Disciplinado] ────────────────────────────────────────────────────────
  try {
    // Disciplinado — 10 despesas pagas no mesmo mês
    const disciplinadoRows = await c.env.DB.prepare(
      `SELECT strftime('%Y-%m', COALESCE(data, vencimento)) as mes, COUNT(*) as cnt
       FROM despesas WHERE user_id=? AND status='pago'
       GROUP BY mes HAVING cnt >= 10 LIMIT 1`
    ).bind(user.id).first() as any
    if (disciplinadoRows) await ganhar('disciplinado')
  } catch { /* orcamento / disciplinado */ }

  // ── [Fatura em dia — tem cartão com limite disponível = limite total] ────
  try {
    const faturaZerada = await c.env.DB.prepare(
      `SELECT COUNT(*) as total FROM cartoes WHERE user_id=? AND ativo=1
       AND limite_disponivel >= limite_total AND limite_total > 0`
    ).bind(user.id).first() as any
    if ((faturaZerada?.total || 0) >= 1 && (cartoes?.total || 0) >= 1) {
      await ganhar('fatura_em_dia')
    }
  } catch { /* fatura_em_dia */ }

  // ── [Financiamentos por tipo] ─────────────────────────────────────────────
  try {
    // primeiro_imovel — primeiro financiamento imobiliário
    const finImovel = await c.env.DB.prepare(
      `SELECT COUNT(*) as total FROM financiamentos WHERE user_id=?
       AND LOWER(tipo_bem) IN ('imovel','imóvel','imovel_comercial','residencial','comercial')`
    ).bind(user.id).first() as any
    if ((finImovel?.total || 0) >= 1) await ganhar('primeiro_imovel')

    // primeiro_carro / financiamento_veiculo — financiamento de veículo
    const finVeiculo = await c.env.DB.prepare(
      `SELECT COUNT(*) as total FROM financiamentos WHERE user_id=?
       AND LOWER(tipo_bem) IN ('veiculo','veículo','carro','moto','automovel','automóvel')`
    ).bind(user.id).first() as any
    if ((finVeiculo?.total || 0) >= 1) {
      await ganhar('primeiro_carro')
      await ganhar('financiamento_veiculo')
    }

    // financiamento_outros — tipo_bem não é imóvel nem veículo
    const finOutros = await c.env.DB.prepare(
      `SELECT COUNT(*) as total FROM financiamentos WHERE user_id=?
       AND LOWER(tipo_bem) NOT IN ('imovel','imóvel','imovel_comercial','residencial','comercial',
                                   'veiculo','veículo','carro','moto','automovel','automóvel')`
    ).bind(user.id).first() as any
    if ((finOutros?.total || 0) >= 1) await ganhar('financiamento_outros')

    // carro_quitado — financiamento de veículo quitado
    const carroQuitado = await c.env.DB.prepare(
      `SELECT COUNT(*) as total FROM financiamentos WHERE user_id=?
       AND status='quitado'
       AND LOWER(tipo_bem) IN ('veiculo','veículo','carro','moto','automovel','automóvel')`
    ).bind(user.id).first() as any
    if ((carroQuitado?.total || 0) >= 1) await ganhar('carro_quitado')

    // quitou_X% — progresso de quitação do financiamento imobiliário
    // Calcula: % quitado = (valor_financiado - saldo_devedor) / valor_financiado * 100
    const finImovAtivo = await c.env.DB.prepare(
      `SELECT valor_financiado, saldo_devedor FROM financiamentos WHERE user_id=?
       AND LOWER(tipo_bem) IN ('imovel','imóvel','imovel_comercial','residencial','comercial')
       AND status='ativo' AND valor_financiado > 0
       ORDER BY valor_financiado DESC LIMIT 1`
    ).bind(user.id).first() as any
    if (finImovAtivo && finImovAtivo.valor_financiado > 0) {
      const pctQuitado = ((finImovAtivo.valor_financiado - finImovAtivo.saldo_devedor) / finImovAtivo.valor_financiado) * 100
      if (pctQuitado >= 10) await ganhar('quitou_10pct')
      if (pctQuitado >= 15) await ganhar('quitou_15pct')
      if (pctQuitado >= 20) await ganhar('quitou_20pct')
      if (pctQuitado >= 30) await ganhar('quitou_30pct')
      if (pctQuitado >= 50) await ganhar('quitou_50pct')
    }
    // Também considera financiamentos já quitados (100% = todos os percentuais)
    const quitouImovelTipo = await c.env.DB.prepare(
      `SELECT COUNT(*) as total FROM financiamentos WHERE user_id=? AND status='quitado'
       AND tipo_bem IN ('imovel','imovel_comercial','imóvel')`
    ).bind(user.id).first() as any
    if ((quitouImovelTipo?.total || 0) >= 1) {
      await ganhar('quitou_10pct')
      await ganhar('quitou_15pct')
      await ganhar('quitou_20pct')
      await ganhar('quitou_30pct')
      await ganhar('quitou_50pct')
    }
  } catch { /* financiamentos tipo */ }

  // ── [Metas por tipo — metas ativas (não precisa estar concluída)] ─────────
  try {
    // meta_educacao — meta com categoria educação
    const metaEduc = await c.env.DB.prepare(
      `SELECT COUNT(*) as total FROM metas WHERE user_id=?
       AND LOWER(categoria) IN ('educacao','educação','curso','faculdade','estudo','capacitacao','capacitação')`
    ).bind(user.id).first() as any
    if ((metaEduc?.total || 0) >= 1) await ganhar('meta_educacao')

    // meta_viagem — meta com categoria viagem
    const metaViagem = await c.env.DB.prepare(
      `SELECT COUNT(*) as total FROM metas WHERE user_id=?
       AND LOWER(categoria) IN ('viagem','trip','turismo','ferias','férias')`
    ).bind(user.id).first() as any
    if ((metaViagem?.total || 0) >= 1) await ganhar('meta_viagem')

    // meta_carro — meta com categoria veiculo
    const metaCarro = await c.env.DB.prepare(
      `SELECT COUNT(*) as total FROM metas WHERE user_id=?
       AND LOWER(categoria) IN ('carro','veiculo','veículo','automovel','automóvel','moto','transporte')`
    ).bind(user.id).first() as any
    if ((metaCarro?.total || 0) >= 1) await ganhar('meta_carro')

    // meta_casa — meta com categoria imovel
    const metaCasa = await c.env.DB.prepare(
      `SELECT COUNT(*) as total FROM metas WHERE user_id=?
       AND LOWER(categoria) IN ('casa','imovel','imóvel','apartamento','moradia','residencia','residência')`
    ).bind(user.id).first() as any
    if ((metaCasa?.total || 0) >= 1) await ganhar('meta_casa')

    // meta_aposentadoria — meta de aposentadoria ou independência
    const metaApos = await c.env.DB.prepare(
      `SELECT COUNT(*) as total FROM metas WHERE user_id=?
       AND LOWER(categoria) IN ('aposentadoria','independencia','independência','independencia_financeira',
                                'independência_financeira','liberdade','liberdade_financeira','reforma','retiro')`
    ).bind(user.id).first() as any
    if ((metaApos?.total || 0) >= 1) await ganhar('meta_aposentadoria')

    // meta_liberdade — meta de liberdade financeira
    const metaLib = await c.env.DB.prepare(
      `SELECT COUNT(*) as total FROM metas WHERE user_id=?
       AND LOWER(categoria) IN ('liberdade','liberdade_financeira','independencia','independência',
                                'aposentadoria','aposentadoria_financeira')`
    ).bind(user.id).first() as any
    if ((metaLib?.total || 0) >= 1) await ganhar('meta_liberdade')

    // Fallback — verifica por nome da meta quando categoria é genérica
    const metaNomes = await c.env.DB.prepare(
      `SELECT LOWER(nome) as nome, LOWER(COALESCE(categoria,'')) as cat FROM metas WHERE user_id=?`
    ).bind(user.id).all() as any
    for (const m of (metaNomes?.results || [])) {
      const n = m.nome || ''
      const cat = m.cat || ''
      if (cat === 'economia' || cat === 'outros' || cat === '' || cat === 'geral') {
        if (/educa|curso|facul|estud|capaci/.test(n)) await ganhar('meta_educacao')
        if (/viag|trip|ferias|férias|turismo/.test(n)) await ganhar('meta_viagem')
        if (/carro|veicu|veiculo|moto|automovel/.test(n)) await ganhar('meta_carro')
        if (/casa|imovel|imóvel|apto|apart|morad|resid/.test(n)) await ganhar('meta_casa')
        if (/aposen|independ|liberd|reform|retiro|fire/.test(n)) {
          await ganhar('meta_aposentadoria')
          await ganhar('meta_liberdade')
        }
      }
    }
  } catch { /* metas por tipo */ }

  return c.json({ novas_conquistas: novas, total_novas: novas.length })
})

// ── Função reutilizável de verificação (usada no reprocessamento em lote) ──────
export async function verificarConquistasParaUsuario(
  db: D1Database,
  userId: number
): Promise<string[]> {
  const novas: string[] = []

  const ganhar = async (codigo: string) => {
    try {
      const res = await db.prepare(
        'INSERT OR IGNORE INTO conquistas_usuario (user_id, conquista_codigo, visualizado) VALUES (?, ?, 0)'
      ).bind(userId, codigo).run()
      if (res.meta.changes > 0) novas.push(codigo)
    } catch { }
  }

  // Reutiliza exatamente a mesma lógica do endpoint /verificar
  // mas recebendo db e userId diretamente (sem contexto HTTP)
  const user = { id: userId }

  const now = new Date()
  const mes = String(now.getMonth() + 1).padStart(2, '0')
  const ano = String(now.getFullYear())

  const receitas = await db.prepare('SELECT COUNT(*) as total FROM receitas WHERE user_id = ?').bind(user.id).first() as any
  if ((receitas?.total || 0) >= 1) await ganhar('primeira_receita')
  if ((receitas?.total || 0) >= 5) await ganhar('5_receitas')

  const despesas = await db.prepare('SELECT COUNT(*) as total FROM despesas WHERE user_id = ?').bind(user.id).first() as any
  if ((despesas?.total || 0) >= 1) await ganhar('organizador')

  const metas = await db.prepare('SELECT COUNT(*) as total FROM metas WHERE user_id = ?').bind(user.id).first() as any
  if ((metas?.total || 0) >= 1) await ganhar('sonhador')
  if ((metas?.total || 0) >= 5) await ganhar('5_metas_ativas')

  const investimentos = await db.prepare('SELECT COUNT(*) as total FROM investimentos WHERE user_id = ?').bind(user.id).first() as any
  if ((investimentos?.total || 0) >= 1) await ganhar('investidor')
  if ((investimentos?.total || 0) >= 5) await ganhar('5_investimentos')

  const cartoes = await db.prepare('SELECT COUNT(*) as total FROM cartoes WHERE user_id = ?').bind(user.id).first() as any
  if ((cartoes?.total || 0) >= 1) await ganhar('carteirinha')

  const userPerfil = await db.prepare('SELECT perfil_completo, perfil_investidor FROM users WHERE id = ?').bind(user.id).first() as any
  if (userPerfil?.perfil_completo) await ganhar('planejador')
  if (userPerfil?.perfil_investidor) {
    await ganhar('perfil_completo')
    await ganhar('planejador')
  }

  const metaConcluida = await db.prepare('SELECT COUNT(*) as total FROM metas WHERE user_id = ? AND status = ?').bind(user.id, 'concluida').first() as any
  if ((metaConcluida?.total || 0) >= 1) await ganhar('meta_concluida')
  if ((metaConcluida?.total || 0) >= 3) await ganhar('3_metas_concluidas')
  if ((metaConcluida?.total || 0) >= 3) await ganhar('3_metas_meta_concluidas')

  const lembretesCount = await db.prepare('SELECT COUNT(*) as total FROM lembretes WHERE user_id = ? AND ativo = 1').bind(user.id).first() as any
  if ((lembretesCount?.total || 0) >= 5) await ganhar('lembrete_mestre')
  if ((lembretesCount?.total || 0) >= 10) await ganhar('10_lembretes')

  const despesasPagas = await db.prepare("SELECT COUNT(*) as total FROM despesas WHERE user_id = ? AND status = 'pago'").bind(user.id).first() as any
  if ((despesasPagas?.total || 0) >= 10) await ganhar('10_despesas_pagas')
  if ((despesasPagas?.total || 0) >= 50) await ganhar('50_despesas_pagas')

  const despesasComTag = await db.prepare(
    `SELECT COUNT(DISTINCT d.id) as total FROM despesas d
     INNER JOIN despesa_tags dt ON dt.despesa_id = d.id
     WHERE d.user_id = ?`
  ).bind(user.id).first() as any
  if ((despesasComTag?.total || 0) >= 20) await ganhar('20_despesas_com_tag')

  // Receita diversificada
  const receitaTipos = await db.prepare('SELECT COUNT(DISTINCT categoria) as cnt FROM receitas WHERE user_id = ?').bind(user.id).first() as any
  if ((receitaTipos?.cnt || 0) >= 3) await ganhar('receita_diversificada')

  // Receita >= 5k no mês
  const receitaMes = await db.prepare(
    `SELECT COALESCE(SUM(valor), 0) as total FROM receitas WHERE user_id = ? AND strftime('%m', data) = ? AND strftime('%Y', data) = ?`
  ).bind(user.id, mes, ano).first() as any
  if ((receitaMes?.total || 0) >= 5000) await ganhar('receita_5k')
  if ((receitaMes?.total || 0) >= 10000) await ganhar('receita_10k')

  // Sem dívidas
  const dividas = await db.prepare(
    `SELECT COUNT(*) as total FROM (SELECT id FROM emprestimos WHERE user_id=? AND status='ativo' UNION ALL SELECT id FROM financiamentos WHERE user_id=? AND status='ativo')`
  ).bind(user.id, user.id).first() as any
  if ((dividas?.total || 0) === 0) {
    const jaTeveDividas = await db.prepare(
      `SELECT COUNT(*) as total FROM (SELECT id FROM emprestimos WHERE user_id=? UNION ALL SELECT id FROM financiamentos WHERE user_id=?)`
    ).bind(user.id, user.id).first() as any
    if ((jaTeveDividas?.total || 0) > 0) {
      await ganhar('sem_dividas')
      await ganhar('sem_dividas_total')
    }
  }

  // Imóvel quitado
  const imovelQuitado = await db.prepare(
    `SELECT COUNT(*) as total FROM financiamentos WHERE user_id=? AND status='quitado' AND tipo_bem IN ('imovel','imovel_comercial')`
  ).bind(user.id).first() as any
  if ((imovelQuitado?.total || 0) >= 1) await ganhar('imovel_quitado')

  // Investimentos
  const totalInv = await db.prepare('SELECT COALESCE(SUM(valor_atual), 0) as total, COALESCE(SUM(valor_investido), 0) as investido FROM investimentos WHERE user_id = ?').bind(user.id).first() as any
  const valorAtual = totalInv?.total || 0
  const valorInvestido = totalInv?.investido || 0
  if (valorAtual >= 10000) await ganhar('poupador_dedicado')
  if (valorAtual >= 100000) await ganhar('milionario')
  if (valorAtual > 0 && valorAtual > valorInvestido) await ganhar('primeiro_lucro')

  const tiposDistintos = await db.prepare('SELECT COUNT(DISTINCT tipo) as cnt FROM investimentos WHERE user_id = ?').bind(user.id).first() as any
  if ((tiposDistintos?.cnt || 0) >= 3) await ganhar('investidor_diversificado')

  // Patrimônio líquido
  const totalDividas = await db.prepare(`SELECT COALESCE(SUM(saldo_devedor),0) as total FROM emprestimos WHERE user_id=? AND status='ativo'`).bind(user.id).first() as any
  const totalFinanc = await db.prepare(`SELECT COALESCE(SUM(saldo_devedor),0) as total FROM financiamentos WHERE user_id=? AND status='ativo'`).bind(user.id).first() as any
  const patrimonioLiq = valorAtual - (totalDividas?.total || 0) - (totalFinanc?.total || 0)
  if (patrimonioLiq > 0) await ganhar('patrimonio_positivo')
  if (patrimonioLiq >= 500000) await ganhar('patrimonio_500k')

  // Reserva de emergência
  const reservaRow = await db.prepare('SELECT valor_atual FROM reserva_emergencia WHERE user_id = ? LIMIT 1').bind(user.id).first() as any
  if (reservaRow) {
    await ganhar('reserva_iniciada')
    const mediaDesp = await db.prepare(`
      SELECT COALESCE(AVG(total_mes), 0) as media FROM (
        SELECT SUM(valor) as total_mes FROM despesas WHERE user_id = ? AND status IN ('pago','pendente')
        AND data >= date('now', '-3 months') GROUP BY strftime('%Y-%m', data)
      )
    `).bind(user.id).first() as any
    const media = mediaDesp?.media || 0
    if (media > 0) {
      const mesesCobertos = reservaRow.valor_atual / media
      if (mesesCobertos >= 1)  await ganhar('reserva_1_mes')
      if (mesesCobertos >= 3)  await ganhar('reserva_3_meses')
      if (mesesCobertos >= 6)  await ganhar('reserva_6_meses')
      if (mesesCobertos >= 9)  await ganhar('reserva_9_meses')
      if (mesesCobertos >= 12) await ganhar('reserva_12_meses')
    }
  }

  // Orçamentos
  const orcamentos = await db.prepare('SELECT COUNT(*) as total FROM orcamentos WHERE user_id = ?').bind(user.id).first() as any
  if ((orcamentos?.total || 0) >= 1) await ganhar('primeiro_orcamento')
  if ((orcamentos?.total || 0) >= 3) await ganhar('3_orcamentos')

  // Meta grande
  const metaGrande = await db.prepare('SELECT COUNT(*) as total FROM metas WHERE user_id = ? AND valor_objetivo >= 10000').bind(user.id).first() as any
  if ((metaGrande?.total || 0) >= 1) await ganhar('meta_grande')

  // Desafio 52
  try {
    const desafioRows = await db.prepare(
      `SELECT COUNT(*) as semanas_concluidas, COALESCE(SUM(target_amount),0) as valor_acumulado FROM weekly_challenges WHERE user_id=? AND status='completed'`
    ).bind(user.id).first() as any
    if (desafioRows && (desafioRows.semanas_concluidas || 0) > 0) {
      await ganhar('desafio_52_iniciou')
      if ((desafioRows.semanas_concluidas || 0) >= 10) await ganhar('desafio_52_10sem')
      if ((desafioRows.semanas_concluidas || 0) >= 20) await ganhar('desafio_52_5meses')
      if ((desafioRows.semanas_concluidas || 0) >= 26) await ganhar('desafio_52_metade')
      if ((desafioRows.semanas_concluidas || 0) >= 52) await ganhar('desafio_52_completo')
      if ((desafioRows.valor_acumulado || 0) >= 1000) await ganhar('desafio_52_1k')
    }
  } catch { }

  // Meses ativos
  try {
    const mesesAtivos = await db.prepare(
      `SELECT COUNT(DISTINCT strftime('%Y-%m', data)) as cnt FROM (SELECT data FROM receitas WHERE user_id=? UNION ALL SELECT data FROM despesas WHERE user_id=?)`
    ).bind(user.id, user.id).first() as any
    if ((mesesAtivos?.cnt || 0) >= 3) await ganhar('3_meses_ativos')
    if ((mesesAtivos?.cnt || 0) >= 6) await ganhar('6_meses_receita')
  } catch { }

  // Saldo positivo por meses
  try {
    const saldosMes = await db.prepare(
      `SELECT strftime('%Y-%m', r.data) as mes,
       COALESCE(SUM(r.valor),0) - COALESCE((SELECT SUM(d.valor) FROM despesas d WHERE d.user_id=r.user_id AND strftime('%Y-%m',d.data)=strftime('%Y-%m',r.data) AND COALESCE(d.tipo,'normal')!='aporte'),0) as saldo
       FROM receitas r WHERE r.user_id=? GROUP BY mes ORDER BY mes DESC LIMIT 6`
    ).bind(user.id).all() as any
    const mesesPositivos = (saldosMes?.results || []).filter((m: any) => (m.saldo || 0) > 0).length
    if (mesesPositivos >= 1) await ganhar('primeiro_saldo_positivo')
    if (mesesPositivos >= 3) await ganhar('saldo_positivo_3m')
    if (mesesPositivos >= 3) await ganhar('saldo_verde_3m')
    if (mesesPositivos >= 3) await ganhar('salvo_positivo_3m')
  } catch { }

  // Usuário completo
  const temTudo = (receitas?.total || 0) >= 1 && (despesas?.total || 0) >= 1
    && (investimentos?.total || 0) >= 1 && (metas?.total || 0) >= 1 && reservaRow != null
  if (temTudo) await ganhar('usuario_completo')

  // Assinaturas detectadas
  try {
    const assinaturasDetectadas = await db.prepare(
      `SELECT COUNT(*) as total, COALESCE(SUM(amount),0) as total_mensal FROM detected_subscriptions WHERE user_id = ? AND (user_feedback IS NULL OR user_feedback != 'rejected')`
    ).bind(user.id).first() as any
    const gastoAssinaturas = assinaturasDetectadas?.total_mensal || 0
    if ((assinaturasDetectadas?.total || 0) >= 1) {
      await ganhar('primeira_assinatura')
      await ganhar('assinaturas_organizadas')
      await ganhar('detector_assinatura')
      await ganhar('sub_detector_scanned')
    }
    if ((assinaturasDetectadas?.total || 0) >= 5) await ganhar('detector_expert')
    if (gastoAssinaturas > 0 && gastoAssinaturas < 200) await ganhar('assinatura_econômico')

    const assinCanceladas = await db.prepare(
      `SELECT COUNT(*) as total FROM detected_subscriptions WHERE user_id=? AND user_feedback IN ('cancelled','rejected')`
    ).bind(user.id).first() as any
    const recCanceladas = await db.prepare(
      `SELECT COUNT(*) as total FROM recorrencias WHERE user_id=? AND ativa=0 AND (LOWER(descricao) LIKE '%netflix%' OR LOWER(descricao) LIKE '%spotify%' OR LOWER(categoria) = 'assinatura' OR LOWER(categoria) = 'streaming')`
    ).bind(user.id).first() as any
    if (((assinCanceladas?.total || 0) + (recCanceladas?.total || 0)) >= 1) {
      await ganhar('cortou_gordura')
      await ganhar('sub_cancelou_1')
    }
  } catch { }

  // Lembretes concluídos
  try {
    const lembretesConc = await db.prepare("SELECT COUNT(*) as total FROM lembretes WHERE user_id = ? AND ativo = 0").bind(user.id).first() as any
    if ((lembretesConc?.total || 0) >= 20) await ganhar('20_lembretes_concluidos')

    const lembPontual = await db.prepare(`SELECT COUNT(*) as total FROM lembretes WHERE user_id=? AND (proximo_vencimento IS NOT NULL OR dia_vencimento IS NOT NULL)`).bind(user.id).first() as any
    if ((lembPontual?.total || 0) >= 1) await ganhar('lembrete_pontual')

    const lembFatura = await db.prepare(`SELECT COUNT(*) as total FROM lembretes WHERE user_id=? AND (LOWER(titulo) LIKE '%fatura%' OR LOWER(titulo) LIKE '%cartao%' OR LOWER(titulo) LIKE '%cartão%')`).bind(user.id).first() as any
    if ((lembFatura?.total || 0) >= 1) await ganhar('lembrete_fatura')
  } catch { }

  // Meio caminho no financiamento
  try {
    const meiadoPago = await db.prepare(
      `SELECT COUNT(*) as total FROM financiamentos WHERE user_id = ? AND valor_financiado > 0
       AND ((status = 'ativo' AND saldo_devedor > 0 AND saldo_devedor < (valor_financiado * 0.5)) OR status = 'quitado')`
    ).bind(user.id).first() as any
    if ((meiadoPago?.total || 0) >= 1) {
      await ganhar('metade_paga')
      await ganhar('50pct_financiamento')
    }

    const amortizou = await db.prepare(
      `SELECT COUNT(*) as total FROM financiamentos WHERE user_id = ? AND (entrada_parcelas_pagas > 0 OR (valor_entrada > 0 AND parcelas_pagas > 0))`
    ).bind(user.id).first() as any
    if ((amortizou?.total || 0) >= 1) await ganhar('amortizou_antecipado')

    const emprestimos = await db.prepare('SELECT COUNT(*) as total FROM emprestimos WHERE user_id = ?').bind(user.id).first() as any
    if ((emprestimos?.total || 0) >= 1) await ganhar('primeiro_emprestimo')

    const emprestimoQuitado = await db.prepare("SELECT COUNT(*) as total FROM emprestimos WHERE user_id = ? AND status = 'quitado'").bind(user.id).first() as any
    if ((emprestimoQuitado?.total || 0) >= 1) await ganhar('emprestimo_quitado')

    const financiamentos = await db.prepare('SELECT COUNT(*) as total FROM financiamentos WHERE user_id = ?').bind(user.id).first() as any
    if ((financiamentos?.total || 0) >= 1) await ganhar('primeiro_financiamento')

    // Financiamento com 1 ano
    const finAnual = await db.prepare(`SELECT COUNT(*) as total FROM financiamentos WHERE user_id=? AND status='ativo' AND data_inicio <= date('now','-1 year')`).bind(user.id).first() as any
    if ((finAnual?.total || 0) >= 1) await ganhar('um_ano_financiamento')

    // Simulação de amortização
    const simAmort = await db.prepare('SELECT COUNT(*) as total FROM amortization_simulations WHERE user_id=?').bind(user.id).first() as any
    if ((simAmort?.total || 0) >= 1 && (amortizou?.total || 0) >= 1) await ganhar('amortizou_simulou')
    if ((amortizou?.total || 0) >= 1) await ganhar('amortizou')
    if ((amortizou?.total || 0) >= 3) await ganhar('amortizador_serie')

    // Quitou imóvel
    const quitouImovel = await db.prepare(`SELECT COUNT(*) as total FROM financiamentos WHERE user_id=? AND status='quitado' AND tipo_bem IN ('imovel','imovel_comercial','imóvel')`).bind(user.id).first() as any
    if ((quitouImovel?.total || 0) >= 1) await ganhar('quitou_imovel')

    // % quitado do imóvel ativo
    const finImovAtivo = await db.prepare(
      `SELECT valor_financiado, saldo_devedor FROM financiamentos WHERE user_id=? AND LOWER(tipo_bem) IN ('imovel','imóvel','imovel_comercial','residencial','comercial') AND status='ativo' AND valor_financiado > 0 ORDER BY valor_financiado DESC LIMIT 1`
    ).bind(user.id).first() as any
    if (finImovAtivo && finImovAtivo.valor_financiado > 0) {
      const pct = ((finImovAtivo.valor_financiado - finImovAtivo.saldo_devedor) / finImovAtivo.valor_financiado) * 100
      if (pct >= 10) await ganhar('quitou_10pct')
      if (pct >= 15) await ganhar('quitou_15pct')
      if (pct >= 20) await ganhar('quitou_20pct')
      if (pct >= 30) await ganhar('quitou_30pct')
      if (pct >= 50) await ganhar('quitou_50pct')
    }
    if ((quitouImovel?.total || 0) >= 1) {
      await ganhar('quitou_10pct'); await ganhar('quitou_15pct')
      await ganhar('quitou_20pct'); await ganhar('quitou_30pct'); await ganhar('quitou_50pct')
    }

    // Financiamento por tipo_bem
    const finImovel = await db.prepare(`SELECT COUNT(*) as total FROM financiamentos WHERE user_id=? AND LOWER(tipo_bem) IN ('imovel','imóvel','imovel_comercial','residencial','comercial')`).bind(user.id).first() as any
    if ((finImovel?.total || 0) >= 1) await ganhar('primeiro_imovel')

    const finVeiculo = await db.prepare(`SELECT COUNT(*) as total FROM financiamentos WHERE user_id=? AND LOWER(tipo_bem) IN ('veiculo','veículo','carro','moto','automovel','automóvel')`).bind(user.id).first() as any
    if ((finVeiculo?.total || 0) >= 1) { await ganhar('primeiro_carro'); await ganhar('financiamento_veiculo') }

    const finOutros = await db.prepare(`SELECT COUNT(*) as total FROM financiamentos WHERE user_id=? AND LOWER(tipo_bem) NOT IN ('imovel','imóvel','imovel_comercial','residencial','comercial','veiculo','veículo','carro','moto','automovel','automóvel')`).bind(user.id).first() as any
    if ((finOutros?.total || 0) >= 1) await ganhar('financiamento_outros')

    const carroQuitado = await db.prepare(`SELECT COUNT(*) as total FROM financiamentos WHERE user_id=? AND status='quitado' AND LOWER(tipo_bem) IN ('veiculo','veículo','carro','moto','automovel','automóvel')`).bind(user.id).first() as any
    if ((carroQuitado?.total || 0) >= 1) await ganhar('carro_quitado')

    // Livre do banco
    const emprestimosAtivos = await db.prepare(`SELECT COUNT(*) as total FROM emprestimos WHERE user_id=? AND status='ativo'`).bind(user.id).first() as any
    if ((emprestimosAtivos?.total || 0) === 0 && (emprestimoQuitado?.total || 0) >= 1) {
      await ganhar('livre_do_banco'); await ganhar('livre_emprestimo')
    }
    if ((emprestimoQuitado?.total || 0) >= 1) await ganhar('quita_divida')

    // Parcelas sem atraso
    const parcelasAtrasadas = await db.prepare(`SELECT COUNT(*) as total FROM pagamentos WHERE user_id=? AND status='atrasado'`).bind(user.id).first() as any
    if ((parcelasAtrasadas?.total || 0) === 0 && (emprestimos?.total || 0) >= 1) await ganhar('emprestimo_sem_atraso')

    // Reduziu dívida 20%
    const divAtual2 = (totalDividas?.total || 0) + (totalFinanc?.total || 0)
    const divHist = await db.prepare(`SELECT COALESCE(SUM(saldo_devedor),0) as total FROM emprestimos WHERE user_id=? AND status IN ('ativo','quitado') UNION ALL SELECT COALESCE(SUM(valor_financiado),0) FROM financiamentos WHERE user_id=?`).bind(user.id, user.id).all() as any
    const divOriginal = (divHist?.results || []).reduce((s: number, r: any) => s + (r.total || 0), 0)
    if (divOriginal > 0 && divAtual2 < divOriginal * 0.80) await ganhar('reduziu_divida_20')
  } catch { }

  // Reservas especializadas
  try {
    const reservasEspec = await db.prepare(`SELECT COUNT(*) as total FROM specialized_reserves WHERE user_id=? AND current_amount > 0`).bind(user.id).first() as any
    if ((reservasEspec?.total || 0) >= 1) await ganhar('reserva_spec_completa')
    if ((reservasEspec?.total || 0) >= 3) await ganhar('multi_3_reservas')
    if ((reservasEspec?.total || 0) >= 1) await ganhar('multi_reserva_criada')

    const resEspec2 = await db.prepare(`SELECT COUNT(*) as total FROM specialized_reserves WHERE user_id=? AND current_amount > 0`).bind(user.id).first() as any
    if (reservaRow && (resEspec2?.total || 0) >= 1) await ganhar('todas_reservas_ok')

    if (reservaRow) {
      const mediaDesp2 = await db.prepare(`SELECT COALESCE(AVG(total_mes),0) as media FROM (SELECT SUM(valor) as total_mes FROM despesas WHERE user_id=? AND data >= date('now','-6 months') GROUP BY strftime('%Y-%m',data))`).bind(user.id).first() as any
      if ((mediaDesp2?.media || 0) > 0 && reservaRow.valor_atual / mediaDesp2.media >= 12) {
        await ganhar('super_reserva'); await ganhar('reserva_completa')
      }
    }
  } catch { }

  // Cartões
  try {
    if ((cartoes?.total || 0) >= 2) await ganhar('dois_cartoes')
    if ((cartoes?.total || 0) >= 5) await ganhar('cinco_cartoes')
    const limiteTotal = await db.prepare(`SELECT COALESCE(SUM(limite_total),0) as total FROM cartoes WHERE user_id=? AND ativo=1`).bind(user.id).first() as any
    if ((limiteTotal?.total || 0) >= 10000) await ganhar('limite_10k')
    const limiteUsado = await db.prepare(`SELECT COALESCE(SUM(limite_total - limite_disponivel),0) as usado FROM cartoes WHERE user_id=? AND ativo=1 AND limite_total > 0`).bind(user.id).first() as any
    const pctUso = limiteTotal?.total > 0 ? (limiteUsado?.usado || 0) / limiteTotal.total : 0
    if (pctUso <= 0.30 && (cartoes?.total || 0) > 0) await ganhar('uso_baixo_cartao')
    if (pctUso <= 0.30 && (cartoes?.total || 0) > 0) await ganhar('fatura_saudavel')
    const faturaZerada = await db.prepare(`SELECT COUNT(*) as total FROM cartoes WHERE user_id=? AND ativo=1 AND limite_disponivel >= limite_total AND limite_total > 0`).bind(user.id).first() as any
    if ((faturaZerada?.total || 0) >= 1 && (cartoes?.total || 0) >= 1) await ganhar('fatura_em_dia')
    const cartDiverso = await db.prepare(`SELECT COUNT(DISTINCT bandeira) as cnt FROM cartoes WHERE user_id=? AND ativo=1`).bind(user.id).first() as any
    if ((cartDiverso?.cnt || 0) >= 2) await ganhar('carteira_diversa')
    const semDividaCartao = await db.prepare(`SELECT COALESCE(SUM(limite_total - limite_disponivel),0) as usado FROM cartoes WHERE user_id=? AND ativo=1 AND limite_total > 0`).bind(user.id).first() as any
    if ((semDividaCartao?.usado || 0) <= 0 && (cartoes?.total || 0) > 0) {
      await ganhar('zero_divida_cartao'); await ganhar('sem_cartao_devedor'); await ganhar('zero_dividas_cartao')
    }
  } catch { }

  // Engajamento / hábito
  try {
    const usouIA = await db.prepare(`SELECT COUNT(*) as total FROM ia_insights WHERE user_id=?`).bind(user.id).first() as any
    if ((usouIA?.total || 0) >= 1) {
      await ganhar('usou_ia'); await ganhar('curioso'); await ganhar('analista')
      await ganhar('projetor'); await ganhar('projecao_vista'); await ganhar('viu_projecao')
      await ganhar('usou_simulador'); await ganhar('primeiro_relatorio')
    }
    if ((usouIA?.total || 0) >= 5) await ganhar('analitico')
    if ((usouIA?.total || 0) >= 10) await ganhar('ia_power_user')

    const loginDias = await db.prepare(`SELECT COUNT(DISTINCT date(created_at)) as dias FROM sessions WHERE user_id=? AND created_at >= date('now','-35 days')`).bind(user.id).first() as any
    if ((loginDias?.dias || 0) >= 1)  await ganhar('login_diario')
    if ((loginDias?.dias || 0) >= 5)  await ganhar('acesso_5_dias')
    if ((loginDias?.dias || 0) >= 7)  await ganhar('7_dias_lancando')
    if ((loginDias?.dias || 0) >= 30) { await ganhar('30_dias_lancando'); await ganhar('login_30_dias') }

    const dataCadastro = await db.prepare(`SELECT data_criacao FROM users WHERE id=?`).bind(user.id).first() as any
    if (dataCadastro?.data_criacao) {
      const anos = (Date.now() - new Date(dataCadastro.data_criacao).getTime()) / (365.25 * 24 * 3600 * 1000)
      if (anos >= 2) await ganhar('2_anos_verde')
    }

    const compCDI = await db.prepare(`SELECT COUNT(*) as total FROM cdi_historico LIMIT 1`).first() as any
    if ((compCDI?.total || 0) >= 1 && (investimentos?.total || 0) >= 1) await ganhar('usou_comparativo_cdi')

    if ((despesasComTag?.total || 0) >= 1) await ganhar('usou_filtros')
    if ((receitas?.total || 0) >= 10 && (despesas?.total || 0) >= 10) await ganhar('exportador_dados')
  } catch { }

  // Score
  try {
    const scoreRow = await db.prepare(`SELECT score_saude FROM users WHERE id=?`).bind(user.id).first() as any
    const score = scoreRow?.score_saude || 0
    if (score >= 50) await ganhar('score_50')
    if (score >= 70) await ganhar('score_70')
    if (score >= 80) { await ganhar('score_80'); await ganhar('score_80_1m') }
    if (score >= 90) await ganhar('saude_ferro')
    if (score >= 90) await ganhar('score_90')
    if (score >= 100) await ganhar('score_100')

    const scoreHist = await db.prepare(`SELECT score_geral FROM score_historico WHERE user_id=? ORDER BY mes ASC LIMIT 6`).bind(user.id).all() as any
    const histArr = scoreHist?.results || []
    if (histArr.length >= 2) {
      const primeiro = histArr[0].score_geral || 0
      const ultimo = histArr[histArr.length - 1].score_geral || 0
      if (primeiro < 40 && ultimo >= 60) await ganhar('recuperacao')
      if (ultimo > primeiro + 10) await ganhar('score_melhorou')
    }
    const hist2 = await db.prepare(`SELECT score_geral FROM score_historico WHERE user_id=? ORDER BY mes DESC LIMIT 2`).bind(user.id).all() as any
    if ((hist2?.results?.length || 0) >= 2 && hist2.results.every((h: any) => (h.score_geral || 0) >= 80)) await ganhar('score_80_2m')
  } catch { }

  // Recorrências
  try {
    const recorrencias = await db.prepare('SELECT COUNT(*) as total FROM recorrencias WHERE user_id = ? AND ativa = 1').bind(user.id).first() as any
    if ((recorrencias?.total || 0) >= 1) await ganhar('primeira_recorrencia')
    if ((recorrencias?.total || 0) >= 3) await ganhar('3_recorrencias')
    const recDia = await db.prepare(`SELECT COUNT(*) as total FROM recorrencias WHERE user_id=? AND dia_vencimento IS NOT NULL AND ativa=1`).bind(user.id).first() as any
    if ((recDia?.total || 0) >= 3) await ganhar('recorrencias_dia')
  } catch { }

  // Antecipações
  try {
    const antecipacoes = await db.prepare('SELECT COUNT(*) as total FROM antecipacoes WHERE user_id = ?').bind(user.id).first() as any
    if ((antecipacoes?.total || 0) >= 1) await ganhar('primeira_antecipacao')
    if ((antecipacoes?.total || 0) >= 3) await ganhar('3_antecipacoes')
  } catch { }

  // Recebimentos parcelados
  try {
    const recParc = await db.prepare('SELECT COUNT(*) as total FROM recebimentos_parcelados WHERE user_id = ?').bind(user.id).first() as any
    if ((recParc?.total || 0) >= 1) await ganhar('primeiro_recebimento_parcelado')
    const recParcConc = await db.prepare("SELECT COUNT(*) as total FROM recebimentos_parcelados WHERE user_id = ? AND status = 'concluido'").bind(user.id).first() as any
    if ((recParcConc?.total || 0) >= 1) await ganhar('recebimento_concluido')
  } catch { }

  // Tags
  try {
    const tagsCount = await db.prepare(`SELECT COUNT(*) as total FROM tags WHERE user_id=?`).bind(user.id).first() as any
    if ((tagsCount?.total || 0) >= 1) await ganhar('primeira_tag')
    if ((tagsCount?.total || 0) >= 10) await ganhar('mestre_tags')
  } catch { }

  // Comportamento mensal
  try {
    const despMes = await db.prepare(`SELECT COALESCE(SUM(valor),0) as total FROM despesas WHERE user_id=? AND strftime('%Y-%m', COALESCE(data,vencimento)) = strftime('%Y-%m','now') AND COALESCE(tipo,'normal') != 'aporte'`).bind(user.id).first() as any
    const recMes2 = await db.prepare(`SELECT COALESCE(SUM(valor),0) as total FROM receitas WHERE user_id=? AND strftime('%Y-%m', data) = strftime('%Y-%m','now')`).bind(user.id).first() as any
    if ((despMes?.total || 0) === 0 && (recMes2?.total || 0) > 0) await ganhar('mes_zerado')

    const reducaoRows = await db.prepare(
      `SELECT categoria, SUM(CASE WHEN strftime('%Y-%m',COALESCE(data,vencimento))=strftime('%Y-%m','now') THEN valor ELSE 0 END) as atual, SUM(CASE WHEN strftime('%Y-%m',COALESCE(data,vencimento))=strftime('%Y-%m','now','-1 month') THEN valor ELSE 0 END) as anterior FROM despesas WHERE user_id=? AND COALESCE(tipo,'normal')!='aporte' GROUP BY categoria HAVING anterior > 0 AND atual < anterior`
    ).bind(user.id).all() as any
    if ((reducaoRows?.results?.length || 0) >= 3) await ganhar('reduziu_3_categorias')

    const vencidas = await db.prepare(`SELECT COUNT(*) as total FROM despesas WHERE user_id=? AND status='pendente' AND vencimento < date('now')`).bind(user.id).first() as any
    if ((vencidas?.total || 0) === 0 && (despesas?.total || 0) >= 5) await ganhar('sem_atraso')

    const disciplinadoRows = await db.prepare(`SELECT strftime('%Y-%m', COALESCE(data, vencimento)) as mes, COUNT(*) as cnt FROM despesas WHERE user_id=? AND status='pago' GROUP BY mes HAVING cnt >= 10 LIMIT 1`).bind(user.id).first() as any
    if (disciplinadoRows) await ganhar('disciplinado')
  } catch { }

  // Renda extra
  try {
    const rendaExtra = await db.prepare(`SELECT COUNT(*) as total FROM receitas WHERE user_id=? AND (LOWER(categoria) IN ('freelance','bônus','bonus','comissao','comissão','outros','vendas','aluguel') OR LOWER(tipo) IN ('extra','freelance','bônus','bonus','comissao','comissão','outras','outro'))`).bind(user.id).first() as any
    if ((rendaExtra?.total || 0) >= 1) { await ganhar('renda_extra_cadastrada'); await ganhar('renda_extra') }
  } catch { }

  // Transações totais
  try {
    const totalTrans = (receitas?.total || 0) + (despesas?.total || 0)
    if (totalTrans >= 100) await ganhar('100_transacoes')
    if (totalTrans >= 500) await ganhar('500_transacoes')
  } catch { }

  // Investimentos por tipo
  try {
    const invTypes: Record<string, string> = {
      'acoes': 'investidor_acoes', 'fii': 'investidor_fii',
      'tesouro_direto': 'investidor_tesouro', 'cdb': 'investidor_cdb',
      'cdi': 'investidor_cdi', 'cripto': 'investidor_cripto'
    }
    for (const [tipo, cod] of Object.entries(invTypes)) {
      const r = await db.prepare(`SELECT COUNT(*) as total FROM investimentos WHERE user_id=? AND LOWER(tipo)=?`).bind(user.id, tipo).first() as any
      if ((r?.total || 0) >= 1) await ganhar(cod)
    }
    const invMes = await db.prepare(`SELECT COUNT(DISTINCT strftime('%Y-%m',data_inicio)) as meses FROM investimentos WHERE user_id=?`).bind(user.id).first() as any
    if ((invMes?.meses || 0) >= 3) await ganhar('investidor_mensal')
    if ((invMes?.meses || 0) >= 12) await ganhar('investidor_veteran')
    const invMaiorQGastos = await db.prepare(`SELECT COALESCE(SUM(valor_investido),0) as total FROM investimentos WHERE user_id=? AND strftime('%m',data_inicio)=? AND strftime('%Y',data_inicio)=?`).bind(user.id, mes, ano).first() as any
    const despMes2 = await db.prepare(`SELECT COALESCE(SUM(valor),0) as total FROM despesas WHERE user_id=? AND COALESCE(tipo,'normal')!='aporte' AND strftime('%m',COALESCE(data,vencimento))=? AND strftime('%Y',COALESCE(data,vencimento))=?`).bind(user.id, mes, ano).first() as any
    if ((invMaiorQGastos?.total || 0) > 0 && (invMaiorQGastos?.total || 0) > (despMes2?.total || 0)) await ganhar('investiu_mais_que_gastou')
    if (valorAtual >= 500000) await ganhar('barreira_500k')
    if (valorAtual >= 100000) await ganhar('barreira_100k')
    if (valorAtual >= 50000)  await ganhar('barreira_50k')
    if (valorAtual >= 10000)  await ganhar('barreira_10k')
    if (valorAtual >= 1000000) await ganhar('primeiro_milhao')
    const rendaInv = await db.prepare(`SELECT COUNT(*) as total FROM receitas WHERE user_id=? AND LOWER(categoria) IN ('dividendos','juros','rendimento','investimento','renda passiva')`).bind(user.id).first() as any
    if ((rendaInv?.total || 0) >= 1) await ganhar('renda_de_investimento')
    const crescAno = await db.prepare(`SELECT COUNT(*) as total FROM investimentos WHERE user_id=? AND valor_atual > valor_investido AND data_inicio <= date('now','-1 year')`).bind(user.id).first() as any
    if ((crescAno?.total || 0) >= 1) await ganhar('crescimento_anual')
  } catch { }

  // Poupador / realizador
  try {
    const poupaMeses = await db.prepare(
      `SELECT COUNT(*) as cnt FROM (SELECT strftime('%Y-%m',r.data) as mes, SUM(r.valor) as rec, COALESCE((SELECT SUM(d.valor) FROM despesas d WHERE d.user_id=r.user_id AND strftime('%Y-%m',d.data)=strftime('%Y-%m',r.data) AND COALESCE(d.tipo,'normal')!='aporte'),0) as desp FROM receitas r WHERE r.user_id=? GROUP BY mes HAVING rec > 0 AND (rec - desp) / rec >= 0.20)`
    ).bind(user.id).first() as any
    if ((poupaMeses?.cnt || 0) >= 1) await ganhar('poupador')
    if ((poupaMeses?.cnt || 0) >= 3) { await ganhar('poupador_3m'); await ganhar('regra_3meses'); await ganhar('desafio_trimestre') }
    if ((metaConcluida?.total || 0) >= 1 && (investimentos?.total || 0) >= 1) await ganhar('realizador')
  } catch { }

  // Metas por tipo
  try {
    const metaEduc = await db.prepare(`SELECT COUNT(*) as total FROM metas WHERE user_id=? AND LOWER(categoria) IN ('educacao','educação','curso','faculdade','estudo','capacitacao','capacitação')`).bind(user.id).first() as any
    if ((metaEduc?.total || 0) >= 1) await ganhar('meta_educacao')
    const metaViagem = await db.prepare(`SELECT COUNT(*) as total FROM metas WHERE user_id=? AND LOWER(categoria) IN ('viagem','trip','turismo','ferias','férias')`).bind(user.id).first() as any
    if ((metaViagem?.total || 0) >= 1) await ganhar('meta_viagem')
    const metaCarro = await db.prepare(`SELECT COUNT(*) as total FROM metas WHERE user_id=? AND LOWER(categoria) IN ('carro','veiculo','veículo','automovel','automóvel','moto','transporte')`).bind(user.id).first() as any
    if ((metaCarro?.total || 0) >= 1) await ganhar('meta_carro')
    const metaCasa = await db.prepare(`SELECT COUNT(*) as total FROM metas WHERE user_id=? AND LOWER(categoria) IN ('casa','imovel','imóvel','apartamento','moradia')`).bind(user.id).first() as any
    if ((metaCasa?.total || 0) >= 1) await ganhar('meta_casa')
    const metaApos = await db.prepare(`SELECT COUNT(*) as total FROM metas WHERE user_id=? AND LOWER(categoria) IN ('aposentadoria','previdencia','previdência','independencia','independência')`).bind(user.id).first() as any
    if ((metaApos?.total || 0) >= 1) { await ganhar('meta_aposentadoria'); await ganhar('meta_liberdade'); await ganhar('pensa_no_futuro') }
    // Metas concluídas por tipo
    const metaEdConc = await db.prepare(`SELECT COUNT(*) as total FROM metas WHERE user_id=? AND status='concluida' AND LOWER(categoria) IN ('educacao','educação','curso','faculdade')`).bind(user.id).first() as any
    if ((metaEdConc?.total || 0) >= 1) await ganhar('meta_educacao_concluida')
    const metaViaConc = await db.prepare(`SELECT COUNT(*) as total FROM metas WHERE user_id=? AND status='concluida' AND LOWER(categoria) IN ('viagem','trip','turismo','ferias','férias')`).bind(user.id).first() as any
    if ((metaViaConc?.total || 0) >= 1) await ganhar('meta_viagem_concluida')
    // Meta rápida (concluída antes do prazo)
    const metaRapida = await db.prepare(`SELECT COUNT(*) as total FROM metas WHERE user_id=? AND status='concluida' AND data_meta > date('now')`).bind(user.id).first() as any
    if ((metaRapida?.total || 0) >= 1) { await ganhar('meta_rapida'); await ganhar('meta_antes_prazo') }
    // Aporte em meta
    const metaAporte = await db.prepare(`SELECT COUNT(*) as total FROM metas WHERE user_id=? AND valor_atual > 0`).bind(user.id).first() as any
    if ((metaAporte?.total || 0) >= 1) await ganhar('primeiro_aporte_meta')
  } catch { }

  // Investidor mensal (aporta todo mês)
  try {
    const aporteMeses = await db.prepare(`SELECT COUNT(DISTINCT strftime('%Y-%m',data_inicio)) as meses FROM investimentos WHERE user_id=? AND data_inicio >= date('now','-6 months')`).bind(user.id).first() as any
    if ((aporteMeses?.meses || 0) >= 3) { await ganhar('aporta_todo_mes'); await ganhar('aporte_3_meses'); await ganhar('aporte_recorrente') }
    const invMensal2 = await db.prepare(`SELECT COUNT(DISTINCT strftime('%Y-%m',data_inicio)) as cnt FROM investimentos WHERE user_id=?`).bind(user.id).first() as any
    if ((invMensal2?.cnt || 0) >= 6) await ganhar('diversificador')
  } catch { }

  // Necessidades 50%
  try {
    const recMesNec = await db.prepare(`SELECT COALESCE(SUM(valor),0) as total FROM receitas WHERE user_id=? AND strftime('%Y-%m',data)=strftime('%Y-%m','now')`).bind(user.id).first() as any
    const despNec = await db.prepare(`SELECT COALESCE(SUM(valor),0) as total FROM despesas WHERE user_id=? AND LOWER(categoria) IN ('moradia','alimentacao','alimentação','saude','saúde','transporte','educacao','educação') AND strftime('%Y-%m',COALESCE(data,vencimento))=strftime('%Y-%m','now')`).bind(user.id).first() as any
    if ((recMesNec?.total || 0) > 0 && (despNec?.total || 0) / recMesNec.total <= 0.50) {
      await ganhar('necessidades_50pct'); await ganhar('regra_503020_verde')
    }
  } catch { }

  return novas
}

export default conquistas
