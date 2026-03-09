import { Hono } from 'hono'
import { requireAuth } from './auth'

type Bindings = { DB: D1Database }
type Variables = { user: { id: number; nome: string; email: string; plano: string } }

const metas = new Hono<{ Bindings: Bindings; Variables: Variables }>()

// GET /api/metas
metas.get('/', requireAuth, async (c) => {
  const user = c.get('user')
  const { status } = c.req.query()

  let query = 'SELECT * FROM metas WHERE user_id = ?'
  const params: any[] = [user.id]

  if (status) {
    query += ' AND status = ?'
    params.push(status)
  }

  query += ' ORDER BY data_meta ASC'
  const result = await c.env.DB.prepare(query).bind(...params).all()

  // Calcular métricas para cada meta
  const metasComMetricas = (result.results as any[]).map(meta => {
    const percentual = meta.valor_objetivo > 0 ? (meta.valor_atual / meta.valor_objetivo) * 100 : 0
    const hoje = new Date()
    const dataMeta = new Date(meta.data_meta)
    const mesesRestantes = Math.max(0, Math.ceil((dataMeta.getTime() - hoje.getTime()) / (1000 * 60 * 60 * 24 * 30)))
    const valorFaltante = Math.max(0, meta.valor_objetivo - meta.valor_atual)
    const mensalidade = mesesRestantes > 0 ? valorFaltante / mesesRestantes : valorFaltante

    return {
      ...meta,
      percentual: Math.min(100, Math.round(percentual * 10) / 10),
      meses_restantes: mesesRestantes,
      valor_faltante: valorFaltante,
      mensalidade_necessaria: Math.round(mensalidade * 100) / 100
    }
  })

  return c.json({ metas: metasComMetricas })
})

// POST /api/metas
metas.post('/', requireAuth, async (c) => {
  const user = c.get('user')
  const body = await c.req.json()
  const { nome, descricao, valor_objetivo, valor_atual = 0, data_meta, categoria = 'economia', cor = '#2FBF71', icone = 'piggy-bank' } = body

  if (!nome || !valor_objetivo || !data_meta) {
    return c.json({ error: 'Campos obrigatórios: nome, valor_objetivo, data_meta' }, 400)
  }

  const result = await c.env.DB.prepare(
    'INSERT INTO metas (user_id, nome, descricao, valor_objetivo, valor_atual, data_meta, categoria, cor, icone) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(user.id, nome, descricao || null, parseFloat(valor_objetivo), parseFloat(valor_atual), data_meta, categoria, cor, icone).run()

  // Conquistas por categoria/nome da meta
  const nomeMin = nome.toLowerCase()
  const catMeta = categoria || ''

  if (catMeta === 'imovel' || nomeMin.includes('casa') || nomeMin.includes('aparta') || nomeMin.includes('imóvel') || nomeMin.includes('imovel'))
    await verificarConquista(c.env.DB, user.id, 'meta_casa')
  if (catMeta === 'veiculo' || nomeMin.includes('carro') || nomeMin.includes('moto') || nomeMin.includes('veículo'))
    await verificarConquista(c.env.DB, user.id, 'meta_carro')
  if (catMeta === 'viagem' || nomeMin.includes('viagem') || nomeMin.includes('férias') || nomeMin.includes('ferias') || nomeMin.includes('trip'))
    await verificarConquista(c.env.DB, user.id, 'meta_viagem')
  if (catMeta === 'educacao' || nomeMin.includes('curso') || nomeMin.includes('faculdade') || nomeMin.includes('educação') || nomeMin.includes('educacao'))
    await verificarConquista(c.env.DB, user.id, 'meta_educacao')
  if (catMeta === 'liberdade' || nomeMin.includes('liberdade') || nomeMin.includes('independência') || nomeMin.includes('independencia') || nomeMin.includes('fire'))
    await verificarConquista(c.env.DB, user.id, 'meta_liberdade')
  if (catMeta === 'aposentadoria' || nomeMin.includes('aposenta') || nomeMin.includes('previdência') || nomeMin.includes('previdencia') || nomeMin.includes('reforma'))
    await verificarConquista(c.env.DB, user.id, 'meta_aposentadoria')

  await verificarConquista(c.env.DB, user.id, 'planejador')

  return c.json({ success: true, id: result.meta.last_row_id, message: 'Meta criada!' }, 201)
})

// PUT /api/metas/:id
metas.put('/:id', requireAuth, async (c) => {
  const user = c.get('user')
  const id = c.req.param('id')
  const body = await c.req.json()

  const existing = await c.env.DB.prepare('SELECT id FROM metas WHERE id = ? AND user_id = ?').bind(id, user.id).first()
  if (!existing) return c.json({ error: 'Meta não encontrada' }, 404)

  const { nome, descricao, valor_objetivo, valor_atual, data_meta, categoria, cor, icone, status } = body

  await c.env.DB.prepare(
    'UPDATE metas SET nome = ?, descricao = ?, valor_objetivo = ?, valor_atual = ?, data_meta = ?, categoria = ?, cor = ?, icone = ?, status = ? WHERE id = ? AND user_id = ?'
  ).bind(nome, descricao || null, parseFloat(valor_objetivo), parseFloat(valor_atual), data_meta, categoria, cor, icone, status || 'ativa', id, user.id).run()

  return c.json({ success: true, message: 'Meta atualizada!' })
})

// PATCH /api/metas/:id/deposito
metas.patch('/:id/deposito', requireAuth, async (c) => {
  const user = c.get('user')
  const id = c.req.param('id')
  const { valor } = await c.req.json()

  const meta = await c.env.DB.prepare('SELECT * FROM metas WHERE id = ? AND user_id = ?').bind(id, user.id).first() as any
  if (!meta) return c.json({ error: 'Meta não encontrada' }, 404)

  const novoValor = meta.valor_atual + parseFloat(valor)
  const status = novoValor >= meta.valor_objetivo ? 'concluida' : 'ativa'

  await c.env.DB.prepare(
    'UPDATE metas SET valor_atual = ?, status = ? WHERE id = ? AND user_id = ?'
  ).bind(novoValor, status, id, user.id).run()

  return c.json({ 
    success: true, 
    novo_valor: novoValor,
    status,
    message: status === 'concluida' ? '🎉 Parabéns! Meta concluída!' : `R$ ${valor} adicionado à meta!`
  })
})

// DELETE /api/metas/:id
metas.delete('/:id', requireAuth, async (c) => {
  const user = c.get('user')
  const id = c.req.param('id')

  const existing = await c.env.DB.prepare('SELECT id FROM metas WHERE id = ? AND user_id = ?').bind(id, user.id).first()
  if (!existing) return c.json({ error: 'Meta não encontrada' }, 404)

  await c.env.DB.prepare('DELETE FROM metas WHERE id = ? AND user_id = ?').bind(id, user.id).run()
  return c.json({ success: true, message: 'Meta excluída!' })
})

export default metas

async function verificarConquista(db: D1Database, userId: number, codigo: string) {
  try {
    await db.prepare('INSERT OR IGNORE INTO conquistas_usuario (user_id, conquista_codigo, visualizado) VALUES (?, ?, 0)').bind(userId, codigo).run()
  } catch { }
}
