import { Hono } from 'hono'
import { hashPassword, verifyPassword, generateToken, getTokenExpiry } from '../lib/auth'

type Bindings = { DB: D1Database }

const auth = new Hono<{ Bindings: Bindings }>()

// Middleware para verificar autenticação
export async function requireAuth(c: any, next: any) {
  const token = c.req.header('Authorization')?.replace('Bearer ', '') || 
                getCookieToken(c.req.header('Cookie') || '')
  
  if (!token) {
    return c.json({ error: 'Não autorizado' }, 401)
  }

  try {
    const session = await c.env.DB.prepare(
      'SELECT s.*, u.id as uid, u.nome, u.email, u.plano, u.perfil_investidor FROM sessions s JOIN users u ON s.user_id = u.id WHERE s.token = ? AND s.expires_at > datetime("now")'
    ).bind(token).first()

    if (!session) {
      return c.json({ error: 'Sessão expirada' }, 401)
    }

    c.set('user', { id: session.uid, nome: session.nome, email: session.email, plano: session.plano, perfil_investidor: session.perfil_investidor })
    c.set('token', token)
    await next()
  } catch (e) {
    return c.json({ error: 'Token inválido' }, 401)
  }
}

function getCookieToken(cookieHeader: string): string | null {
  const match = cookieHeader.match(/vm_token=([^;]+)/)
  return match ? match[1] : null
}

// POST /api/auth/register
auth.post('/register', async (c) => {
  try {
    const { nome, email, senha } = await c.req.json()
    
    if (!nome || !email || !senha) {
      return c.json({ error: 'Nome, email e senha são obrigatórios' }, 400)
    }
    if (senha.length < 6) {
      return c.json({ error: 'Senha deve ter pelo menos 6 caracteres' }, 400)
    }

    const existing = await c.env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first()
    if (existing) {
      return c.json({ error: 'Email já cadastrado' }, 409)
    }

    const senhaHash = await hashPassword(senha)
    const colors = ['#2FBF71', '#208040', '#1a6b35', '#34d88a', '#0d4d2a']
    const color = colors[Math.floor(Math.random() * colors.length)]

    const result = await c.env.DB.prepare(
      'INSERT INTO users (nome, email, senha, plano, avatar_color) VALUES (?, ?, ?, "free", ?)'
    ).bind(nome, email, senhaHash, color).run()

    const userId = result.meta.last_row_id
    
    // Criar assinatura free
    await c.env.DB.prepare(
      'INSERT INTO assinaturas (user_id, plano, status) VALUES (?, "free", "ativo")'
    ).bind(userId).run()

    // Criar sessão
    const token = generateToken()
    const expiresAt = getTokenExpiry()
    await c.env.DB.prepare(
      'INSERT INTO sessions (user_id, token, expires_at) VALUES (?, ?, ?)'
    ).bind(userId, token, expiresAt).run()

    const response = c.json({
      success: true,
      message: 'Conta criada com sucesso!',
      user: { id: userId, nome, email, plano: 'free' },
      token
    }, 201)

    return response
  } catch (e: any) {
    return c.json({ error: 'Erro ao criar conta', details: e.message }, 500)
  }
})

// POST /api/auth/login
auth.post('/login', async (c) => {
  try {
    const { email, senha } = await c.req.json()
    
    if (!email || !senha) {
      return c.json({ error: 'Email e senha são obrigatórios' }, 400)
    }

    const user = await c.env.DB.prepare(
      'SELECT * FROM users WHERE email = ?'
    ).bind(email).first() as any

    if (!user) {
      return c.json({ error: 'Email ou senha incorretos' }, 401)
    }

    const valid = await verifyPassword(senha, user.senha)
    if (!valid) {
      return c.json({ error: 'Email ou senha incorretos' }, 401)
    }

    // Atualizar último acesso
    await c.env.DB.prepare('UPDATE users SET ultimo_acesso = datetime("now") WHERE id = ?').bind(user.id).run()

    // Criar nova sessão
    const token = generateToken()
    const expiresAt = getTokenExpiry()
    await c.env.DB.prepare(
      'INSERT INTO sessions (user_id, token, expires_at) VALUES (?, ?, ?)'
    ).bind(user.id, token, expiresAt).run()

    return c.json({
      success: true,
      message: 'Login realizado com sucesso!',
      user: { id: user.id, nome: user.nome, email: user.email, plano: user.plano, perfil_investidor: user.perfil_investidor, avatar_color: user.avatar_color },
      token
    })
  } catch (e: any) {
    return c.json({ error: 'Erro ao fazer login', details: e.message }, 500)
  }
})

// POST /api/auth/logout
auth.post('/logout', requireAuth, async (c) => {
  const token = c.get('token')
  await c.env.DB.prepare('DELETE FROM sessions WHERE token = ?').bind(token).run()
  return c.json({ success: true, message: 'Logout realizado' })
})

// GET /api/auth/me
auth.get('/me', requireAuth, async (c) => {
  const user = c.get('user')
  return c.json({ user })
})

export default auth
