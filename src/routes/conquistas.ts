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

  // Verificar: primeira receita
  const receitas = await c.env.DB.prepare('SELECT COUNT(*) as total FROM receitas WHERE user_id = ?').bind(user.id).first() as any
  if ((receitas?.total || 0) >= 1) await ganhar('primeira_receita')

  // Verificar: primeiro organizador (despesa)
  const despesas = await c.env.DB.prepare('SELECT COUNT(*) as total FROM despesas WHERE user_id = ?').bind(user.id).first() as any
  if ((despesas?.total || 0) >= 1) await ganhar('organizador')

  // Verificar: sonhador (meta)
  const metas = await c.env.DB.prepare('SELECT COUNT(*) as total FROM metas WHERE user_id = ?').bind(user.id).first() as any
  if ((metas?.total || 0) >= 1) await ganhar('sonhador')

  // Verificar: investidor
  const investimentos = await c.env.DB.prepare('SELECT COUNT(*) as total FROM investimentos WHERE user_id = ?').bind(user.id).first() as any
  if ((investimentos?.total || 0) >= 1) await ganhar('investidor')

  // Verificar: carteirinha
  const cartoes = await c.env.DB.prepare('SELECT COUNT(*) as total FROM cartoes WHERE user_id = ?').bind(user.id).first() as any
  if ((cartoes?.total || 0) >= 1) await ganhar('carteirinha')

  // Verificar: planejador (perfil completo)
  const userPerfil = await c.env.DB.prepare('SELECT perfil_completo FROM users WHERE id = ?').bind(user.id).first() as any
  if (userPerfil?.perfil_completo) await ganhar('planejador')

  // Verificar: meta concluída
  const metaConcluida = await c.env.DB.prepare('SELECT COUNT(*) as total FROM metas WHERE user_id = ? AND status = ?').bind(user.id, 'concluida').first() as any
  if ((metaConcluida?.total || 0) >= 1) await ganhar('meta_concluida')

  // Verificar: lembrete mestre
  const lembretesCount = await c.env.DB.prepare('SELECT COUNT(*) as total FROM lembretes WHERE user_id = ?').bind(user.id).first() as any
  if ((lembretesCount?.total || 0) >= 5) await ganhar('lembrete_mestre')

  return c.json({ novas_conquistas: novas, total_novas: novas.length })
})

export default conquistas
