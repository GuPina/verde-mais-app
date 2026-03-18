import { Hono } from 'hono'
import { requireAuth } from './auth'

type Bindings = { DB: D1Database }
type Variables = { user: { id: number; nome: string; email: string; plano: string } }

const conquistas = new Hono<{ Bindings: Bindings; Variables: Variables }>()

// GET /api/conquistas — Todas as conquistas (ganhas + disponíveis)
conquistas.get('/', requireAuth, async (c) => {
  const user = c.get('user')

  const todas = await c.env.DB.prepare('SELECT * FROM conquistas_definicoes ORDER BY pontos ASC').all()
  const ganhas = await c.env.DB.prepare(
    'SELECT * FROM conquistas_usuario WHERE user_id = ? ORDER BY data_conquista DESC'
  ).bind(user.id).all()

  const ganhasCodigos = new Set((ganhas.results as any[]).map(g => g.conquista_codigo))
  const ganhassMap = Object.fromEntries((ganhas.results as any[]).map(g => [g.conquista_codigo, g]))

  const resultado = (todas.results as any[]).map(def => ({
    ...def,
    conquistada: ganhasCodigos.has(def.codigo),
    data_conquista: ganhassMap[def.codigo]?.data_conquista || null,
    visualizado: ganhassMap[def.codigo]?.visualizado || 1
  }))

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

  const lembretesCount = await c.env.DB.prepare('SELECT COUNT(*) as total FROM lembretes WHERE user_id = ?').bind(user.id).first() as any
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
    'SELECT COUNT(DISTINCT tipo) as cnt FROM receitas WHERE user_id = ?'
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
      if (mesesCobertos >= 1) await ganhar('reserva_1_mes')
      if (mesesCobertos >= 3) await ganhar('reserva_3_meses')
      if (mesesCobertos >= 6) await ganhar('reserva_6_meses')
    }
  }

  // ── Orçamentos ────────────────────────────────────────────────────────────
  const orcamentos = await c.env.DB.prepare(
    'SELECT COUNT(*) as total FROM orcamentos WHERE user_id = ?'
  ).bind(user.id).first() as any
  if ((orcamentos?.total || 0) >= 3) await ganhar('3_orcamentos')

  // ── Meta grande (>R$10.000) ────────────────────────────────────────────────
  const metaGrande = await c.env.DB.prepare(
    'SELECT COUNT(*) as total FROM metas WHERE user_id = ? AND valor_objetivo >= 10000'
  ).bind(user.id).first() as any
  if ((metaGrande?.total || 0) >= 1) await ganhar('meta_grande')

  // ── Desafio 52 ────────────────────────────────────────────────────────────
  const desafio = await c.env.DB.prepare(
    'SELECT semanas_concluidas, valor_acumulado FROM desafio_52 WHERE user_id = ? LIMIT 1'
  ).bind(user.id).first() as any
  if (desafio) {
    await ganhar('desafio_52_iniciou')
    if ((desafio.semanas_concluidas || 0) >= 10) await ganhar('desafio_52_10sem')
    if ((desafio.semanas_concluidas || 0) >= 26) await ganhar('desafio_52_metade')
    if ((desafio.semanas_concluidas || 0) >= 52) await ganhar('desafio_52_completo')
    if ((desafio.valor_acumulado || 0) >= 1000) await ganhar('desafio_52_1k')
  }

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

  // Assinaturas
  const assinaturas = await c.env.DB.prepare(
    "SELECT COUNT(*) as total FROM assinaturas WHERE user_id = ?"
  ).bind(user.id).first() as any
  if ((assinaturas?.total || 0) >= 1) await ganhar('primeira_assinatura')

  const assinaturasSemCat = await c.env.DB.prepare(
    "SELECT COUNT(*) as sem FROM assinaturas WHERE user_id = ? AND (categoria IS NULL OR categoria = '')"
  ).bind(user.id).first() as any
  const totalAssinaturas = assinaturas?.total || 0
  if (totalAssinaturas > 0 && (assinaturasSemCat?.sem || 0) === 0) await ganhar('assinaturas_organizadas')

  const gastoAssinatura = await c.env.DB.prepare(
    "SELECT COALESCE(SUM(valor), 0) as total FROM assinaturas WHERE user_id = ? AND ativa = 1"
  ).bind(user.id).first() as any
  if ((gastoAssinatura?.total || 0) > 0 && (gastoAssinatura?.total || 0) < 200) await ganhar('assinatura_econômico')

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
    "SELECT COALESCE(SUM(limite), 0) as total FROM cartoes WHERE user_id = ?"
  ).bind(user.id).first() as any
  if ((limiteTotal?.total || 0) >= 10000) await ganhar('limite_10k')

  // Lembretes concluídos (20)
  const lembretesConc = await c.env.DB.prepare(
    "SELECT COUNT(*) as total FROM lembretes WHERE user_id = ? AND status = 'concluido'"
  ).bind(user.id).first() as any
  if ((lembretesConc?.total || 0) >= 20) await ganhar('20_lembretes_concluidos')

  // Lembretes ativos simultâneos (3)
  const lembretesAtivos = await c.env.DB.prepare(
    "SELECT COUNT(*) as total FROM lembretes WHERE user_id = ? AND status = 'ativo'"
  ).bind(user.id).first() as any
  if ((lembretesAtivos?.total || 0) >= 3) await ganhar('3_lembretes_ativos')

  // Financiamentos
  const financiamentos = await c.env.DB.prepare(
    "SELECT COUNT(*) as total FROM financiamentos WHERE user_id = ?"
  ).bind(user.id).first() as any
  if ((financiamentos?.total || 0) >= 1) await ganhar('primeiro_financiamento')

  // Amortização antecipada: verificar se existe alguma com parcelas_pagas > 0 e entrada_valor > 0
  const amortizou = await c.env.DB.prepare(
    "SELECT COUNT(*) as total FROM financiamentos WHERE user_id = ? AND entrada_valor > 0"
  ).bind(user.id).first() as any
  if ((amortizou?.total || 0) >= 1) await ganhar('amortizou_antecipado')

  // Meio caminho no financiamento (saldo_devedor < valor_total * 0.5)
  const meiadoPago = await c.env.DB.prepare(
    `SELECT COUNT(*) as total FROM financiamentos
     WHERE user_id = ? AND status = 'ativo'
     AND saldo_devedor > 0 AND valor_total > 0
     AND saldo_devedor < (valor_total * 0.5)`
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

  // Receita de investimento (tipo = 'investimento' ou 'dividendo' ou 'rendimento')
  const rendaInv = await c.env.DB.prepare(
    `SELECT COUNT(*) as total FROM receitas
     WHERE user_id = ? AND tipo IN ('investimento','dividendo','rendimento','renda_variavel')`
  ).bind(user.id).first() as any
  if ((rendaInv?.total || 0) >= 1) await ganhar('renda_de_investimento')

  // Receita mensal > R$10.000
  if ((receitaMes?.total || 0) >= 10000) await ganhar('receita_10k')

  // Metas específicas
  const metaEducConcluida = await c.env.DB.prepare(
    `SELECT COUNT(*) as total FROM metas
     WHERE user_id = ? AND status = 'concluida'
     AND LOWER(tipo) IN ('educacao','educação','curso','faculdade','estudo')`
  ).bind(user.id).first() as any
  if ((metaEducConcluida?.total || 0) >= 1) await ganhar('meta_educacao_concluida')

  const metaViagemConc = await c.env.DB.prepare(
    `SELECT COUNT(*) as total FROM metas
     WHERE user_id = ? AND status = 'concluida' AND LOWER(tipo) = 'viagem'`
  ).bind(user.id).first() as any
  if ((metaViagemConc?.total || 0) >= 1) await ganhar('meta_viagem_concluida')

  const metaAposentadoria = await c.env.DB.prepare(
    `SELECT COUNT(*) as total FROM metas
     WHERE user_id = ? AND LOWER(tipo) IN ('aposentadoria','independencia','independência_financeira','liberdade')`
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

  // Scorecard: acima de 80 por 3 meses (só verifica score atual, flag histórica)
  const scoreAtual = await c.env.DB.prepare(
    "SELECT score_saude FROM users WHERE id = ?"
  ).bind(user.id).first() as any
  if ((scoreAtual?.score_saude || 0) >= 100) await ganhar('score_100')

  return c.json({ novas_conquistas: novas, total_novas: novas.length })
})

export default conquistas
