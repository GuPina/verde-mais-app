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

  const despesas = await c.env.DB.prepare('SELECT COUNT(*) as total FROM despesas WHERE user_id = ?').bind(user.id).first() as any
  if ((despesas?.total || 0) >= 1) await ganhar('organizador')

  const metas = await c.env.DB.prepare('SELECT COUNT(*) as total FROM metas WHERE user_id = ?').bind(user.id).first() as any
  if ((metas?.total || 0) >= 1) await ganhar('sonhador')

  const investimentos = await c.env.DB.prepare('SELECT COUNT(*) as total FROM investimentos WHERE user_id = ?').bind(user.id).first() as any
  if ((investimentos?.total || 0) >= 1) await ganhar('investidor')

  const cartoes = await c.env.DB.prepare('SELECT COUNT(*) as total FROM cartoes WHERE user_id = ?').bind(user.id).first() as any
  if ((cartoes?.total || 0) >= 1) await ganhar('carteirinha')

  const userPerfil = await c.env.DB.prepare('SELECT perfil_completo FROM users WHERE id = ?').bind(user.id).first() as any
  if (userPerfil?.perfil_completo) await ganhar('planejador')

  const metaConcluida = await c.env.DB.prepare('SELECT COUNT(*) as total FROM metas WHERE user_id = ? AND status = ?').bind(user.id, 'concluida').first() as any
  if ((metaConcluida?.total || 0) >= 1) await ganhar('meta_concluida')

  const lembretesCount = await c.env.DB.prepare('SELECT COUNT(*) as total FROM lembretes WHERE user_id = ?').bind(user.id).first() as any
  if ((lembretesCount?.total || 0) >= 5) await ganhar('lembrete_mestre')

  // ── Sem dívidas ───────────────────────────────────────────────────────────
  const dividas = await c.env.DB.prepare(
    `SELECT COUNT(*) as total FROM (
      SELECT id FROM emprestimos WHERE user_id=? AND status='ativo'
      UNION ALL
      SELECT id FROM financiamentos WHERE user_id=? AND status='ativo'
    )`
  ).bind(user.id, user.id).first() as any
  if ((dividas?.total || 0) === 0) {
    // Só ganha se já teve alguma dívida antes (para não dar a conquista para quem nunca teve)
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
    'SELECT COALESCE(SUM(valor_atual), 0) as total FROM investimentos WHERE user_id = ?'
  ).bind(user.id).first() as any
  const valorInvestido = totalInv?.total || 0
  if (valorInvestido >= 10000) await ganhar('poupador_dedicado')
  if (valorInvestido >= 100000) await ganhar('milionario')

  const tiposDistintos = await c.env.DB.prepare(
    'SELECT COUNT(DISTINCT tipo) as cnt FROM investimentos WHERE user_id = ?'
  ).bind(user.id).first() as any
  if ((tiposDistintos?.cnt || 0) >= 3) await ganhar('investidor_diversificado')

  // ── Reserva de emergência ─────────────────────────────────────────────────
  const reservaRow = await c.env.DB.prepare(
    'SELECT valor_atual FROM reserva_emergencia WHERE user_id = ? LIMIT 1'
  ).bind(user.id).first() as any
  if (reservaRow) {
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

  return c.json({ novas_conquistas: novas, total_novas: novas.length })
})

export default conquistas
