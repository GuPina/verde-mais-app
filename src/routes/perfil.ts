import { Hono } from 'hono'
import { requireAuth } from './auth'

type Bindings = { DB: D1Database }
type Variables = { user: { id: number; nome: string; email: string; plano: string } }

const perfil = new Hono<{ Bindings: Bindings; Variables: Variables }>()

// GET /api/perfil
perfil.get('/', requireAuth, async (c) => {
  const user = c.get('user')
  const data = await c.env.DB.prepare(
    `SELECT id, nome, email, plano, perfil_investidor, avatar_color, profissao, situacao_emprego, 
     salario_mensal, outras_rendas, dependentes, estado_civil, cidade, estado, 
     perfil_completo, onboarding_step, data_criacao FROM users WHERE id = ?`
  ).bind(user.id).first()
  return c.json({ perfil: data })
})

// PUT /api/perfil — Atualizar perfil completo
perfil.put('/', requireAuth, async (c) => {
  const user = c.get('user')
  const body = await c.req.json()
  const {
    nome, profissao, situacao_emprego, salario_mensal, outras_rendas,
    dependentes, estado_civil, cidade, estado, perfil_investidor
  } = body

  const perfilCompleto = (nome && profissao && situacao_emprego && salario_mensal !== undefined) ? 1 : 0

  await c.env.DB.prepare(
    `UPDATE users SET nome=?, profissao=?, situacao_emprego=?, salario_mensal=?, outras_rendas=?,
     dependentes=?, estado_civil=?, cidade=?, estado=?, perfil_investidor=?, perfil_completo=? WHERE id=?`
  ).bind(nome, profissao || null, situacao_emprego || 'empregado', parseFloat(salario_mensal) || 0, parseFloat(outras_rendas) || 0, parseInt(dependentes) || 0, estado_civil || 'solteiro', cidade || null, estado || null, perfil_investidor || 'moderado', perfilCompleto, user.id).run()

  if (perfilCompleto) {
    await c.env.DB.prepare('INSERT OR IGNORE INTO conquistas_usuario (user_id, conquista_codigo) VALUES (?, ?)').bind(user.id, 'planejador').run().catch(() => {})
  }

  return c.json({ success: true, message: 'Perfil atualizado!', perfil_completo: !!perfilCompleto })
})

// POST /api/perfil/onboarding — Salvar onboarding completo
perfil.post('/onboarding', requireAuth, async (c) => {
  const user = c.get('user')
  const body = await c.req.json()

  // Suporte a formato legado { step, dados } e novo formato direto
  const dados = body.dados || body
  const step = body.step || body.onboarding_step || 5

  const fields: string[] = ['onboarding_step=?']
  const values: any[] = [parseInt(step)]

  if (dados.profissao !== undefined) { fields.push('profissao=?'); values.push(dados.profissao || null) }
  if (dados.situacao_emprego !== undefined) { fields.push('situacao_emprego=?'); values.push(dados.situacao_emprego) }
  if (dados.salario_mensal !== undefined) { fields.push('salario_mensal=?'); values.push(parseFloat(dados.salario_mensal) || 0) }
  if (dados.outras_rendas !== undefined) { fields.push('outras_rendas=?'); values.push(parseFloat(dados.outras_rendas) || 0) }
  if (dados.dependentes !== undefined) { fields.push('dependentes=?'); values.push(parseInt(dados.dependentes) || 0) }
  if (dados.estado_civil !== undefined) { fields.push('estado_civil=?'); values.push(dados.estado_civil) }
  if (dados.cidade !== undefined) { fields.push('cidade=?'); values.push(dados.cidade || null) }
  if (dados.estado !== undefined) { fields.push('estado=?'); values.push(dados.estado || null) }
  if (dados.perfil_investidor !== undefined) { fields.push('perfil_investidor=?'); values.push(dados.perfil_investidor) }
  if (dados.perfil_completo !== undefined) { fields.push('perfil_completo=?'); values.push(dados.perfil_completo ? 1 : 0) }

  values.push(user.id)
  await c.env.DB.prepare(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`).bind(...values).run()

  // Se perfil completo, dar conquista
  if (parseInt(step) >= 5 || dados.perfil_completo) {
    await c.env.DB.prepare('UPDATE users SET perfil_completo = 1 WHERE id = ?').bind(user.id).run()
    await c.env.DB.prepare('INSERT OR IGNORE INTO conquistas_usuario (user_id, conquista_codigo) VALUES (?, ?)').bind(user.id, 'planejador').run().catch(() => {})
  }

  return c.json({ success: true, message: 'Perfil salvo com sucesso!', step_salvo: step })
})

export default perfil
