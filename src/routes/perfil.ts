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
     salario_mensal, salario_mensal as renda_mensal, outras_rendas, dependentes, estado_civil, cidade, estado, 
     perfil_completo, onboarding_step, data_criacao FROM users WHERE id = ?`
  ).bind(user.id).first()
  return c.json({ ...data, perfil: data, usuario: data })
})

// PUT /api/perfil — Atualizar perfil completo
perfil.put('/', requireAuth, async (c) => {
  const user = c.get('user')
  const body = await c.req.json()
  const {
    nome, profissao, situacao_emprego,
    // aceitar tanto salario_mensal quanto renda_mensal (alias do frontend)
    salario_mensal, renda_mensal,
    outras_rendas,
    dependentes, estado_civil, cidade, estado, perfil_investidor
  } = body

  // renda_mensal é alias de salario_mensal no frontend
  const salarioFinal = salario_mensal ?? renda_mensal

  const perfilCompleto = (nome && profissao && situacao_emprego && salarioFinal !== undefined) ? 1 : 0

  // Montar update dinâmico para não sobrescrever campos não enviados
  const fields: string[] = []
  const values: any[] = []
  if (nome !== undefined)             { fields.push('nome=?');              values.push(nome) }
  if (profissao !== undefined)        { fields.push('profissao=?');         values.push(profissao || null) }
  if (situacao_emprego !== undefined) { fields.push('situacao_emprego=?');  values.push(situacao_emprego) }
  if (salarioFinal !== undefined)     { fields.push('salario_mensal=?');    values.push(Math.max(0, parseFloat(salarioFinal) || 0)) }
  if (outras_rendas !== undefined)    { fields.push('outras_rendas=?');     values.push(Math.max(0, parseFloat(outras_rendas) || 0)) }
  if (dependentes !== undefined)      { fields.push('dependentes=?');       values.push(Math.max(0, Math.min(30, parseInt(dependentes) || 0))) }
  if (estado_civil !== undefined)     { fields.push('estado_civil=?');      values.push(estado_civil) }
  if (cidade !== undefined)           { fields.push('cidade=?');            values.push(cidade || null) }
  if (estado !== undefined)           { fields.push('estado=?');            values.push(estado || null) }
  if (perfil_investidor !== undefined){ fields.push('perfil_investidor=?'); values.push(perfil_investidor) }

  if (fields.length === 0) return c.json({ success: true, message: 'Nada a atualizar.' })

  fields.push('perfil_completo=?')
  values.push(perfilCompleto)
  values.push(user.id)

  await c.env.DB.prepare(
    `UPDATE users SET ${fields.join(', ')} WHERE id=?`
  ).bind(...values).run()

  if (perfilCompleto) {
    await c.env.DB.prepare('INSERT OR IGNORE INTO conquistas_usuario (user_id, conquista_codigo, visualizado) VALUES (?, ?, 0)').bind(user.id, 'planejador').run().catch(() => {})
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
    await c.env.DB.prepare('INSERT OR IGNORE INTO conquistas_usuario (user_id, conquista_codigo, visualizado) VALUES (?, ?, 0)').bind(user.id, 'planejador').run().catch(() => {})
  }

  return c.json({ success: true, message: 'Perfil salvo com sucesso!', step_salvo: step })
})

// PATCH /api/perfil/senha — Alterar senha
perfil.patch('/senha', requireAuth, async (c) => {
  const user = c.get('user')
  const { senha_atual, nova_senha } = await c.req.json()

  if (!senha_atual || !nova_senha) {
    return c.json({ error: 'Informe a senha atual e a nova senha' }, 400)
  }
  if (nova_senha.length < 6) {
    return c.json({ error: 'Nova senha deve ter pelo menos 6 caracteres' }, 400)
  }

  const { hashPassword, verifyPassword } = await import('../lib/auth')
  const userData = await c.env.DB.prepare('SELECT senha FROM users WHERE id = ?').bind(user.id).first() as any
  const valid = await verifyPassword(senha_atual, userData.senha)
  if (!valid) {
    return c.json({ error: 'Senha atual incorreta' }, 400)
  }

  const novoHash = await hashPassword(nova_senha)
  await c.env.DB.prepare('UPDATE users SET senha = ? WHERE id = ?').bind(novoHash, user.id).run()
  // Invalidar todas as sessões exceto a atual
  const token = c.req.header('Authorization')?.replace('Bearer ', '') || ''
  await c.env.DB.prepare('DELETE FROM sessions WHERE user_id = ? AND token != ?').bind(user.id, token).run()

  return c.json({ success: true, message: 'Senha alterada com sucesso!' })
})

// PATCH /api/perfil/email — Alterar email
perfil.patch('/email', requireAuth, async (c) => {
  const user = c.get('user')
  const { email, senha } = await c.req.json()

  if (!email || !senha) {
    return c.json({ error: 'Informe o novo e-mail e sua senha' }, 400)
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email))) {
    return c.json({ error: 'E-mail inválido.' }, 400)
  }

  const { verifyPassword } = await import('../lib/auth')
  const userData = await c.env.DB.prepare('SELECT senha FROM users WHERE id = ?').bind(user.id).first() as any
  const valid = await verifyPassword(senha, userData.senha)
  if (!valid) {
    return c.json({ error: 'Senha incorreta' }, 400)
  }

  const exists = await c.env.DB.prepare('SELECT id FROM users WHERE email = ? AND id != ?').bind(email, user.id).first()
  if (exists) {
    return c.json({ error: 'E-mail já está em uso' }, 409)
  }

  await c.env.DB.prepare('UPDATE users SET email = ? WHERE id = ?').bind(email, user.id).run()
  return c.json({ success: true, message: 'E-mail atualizado!' })
})

export default perfil
