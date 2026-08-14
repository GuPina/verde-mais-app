import { Hono } from 'hono'
import { hashPassword, verifyPassword, generateToken, getTokenExpiry } from '../lib/auth'
import { verificarConquistasParaUsuario } from './conquistas'

type Bindings = { DB: D1Database }
type Variables = {
  user: { id: number; nome: string; email: string; plano: string; perfil_investidor?: string }
  token: string
}

const auth = new Hono<{ Bindings: Bindings; Variables: Variables }>()

// ─── Domínios de e-mail temporário bloqueados ────────────────────────────────
const BLOCKED_DOMAINS = new Set([
  'tempmail.com','temp-mail.org','guerrillamail.com','mailinator.com',
  'yopmail.com','10minutemail.com','throwam.com','fakeinbox.com',
  'sharklasers.com','guerrillamailblock.com','grr.la','guerrillamail.info',
  'spam4.me','trashmail.com','trashmail.me','dispostable.com',
  'spamgourmet.com','spamgourmet.net','binkmail.com','bob.spamgourmet.com',
  'trashmail.at','trashmail.io','trashmail.me','discard.email',
  'spamspot.com','spamevader.com','spamfree24.org','spaml.com',
  'spammotel.com','spamthisplease.com','mailnull.com','spaminator.de',
  'maildrop.cc','mailnesia.com','mailnull.com','nospamfor.us',
  'ownmail.net','pecinan.com','qq.com.cn','rcpt.at',
  'spam.la','superrito.com','trbvm.com','uggsrock.com',
  'vomoto.com','wile.com','ze.am','zoemail.com',
  'filzmail.com','trbvm.com','mohmal.com','emailondeck.com',
  'tempinbox.com','tempr.email','throwam.com','spamgrap.com',
])

// ─── Helpers ─────────────────────────────────────────────────────────────────
function isBlockedEmail(email: string): boolean {
  const domain = email.toLowerCase().split('@')[1] || ''
  return BLOCKED_DOMAINS.has(domain)
}

function isValidEmailFormat(email: string): boolean {
  return /^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$/.test(email)
}

function generateOTP(): string {
  return Math.floor(100000 + Math.random() * 900000).toString()
}

function getOTPExpiry(): string {
  const d = new Date()
  d.setMinutes(d.getMinutes() + 10)
  return d.toISOString().replace('T', ' ').split('.')[0]
}

export function getCookieToken(cookieHeader: string): string | null {
  const match = cookieHeader.match(/vm_token=([^;]+)/)
  return match ? match[1] : null
}

// ─── Middleware de autenticação ───────────────────────────────────────────────
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

// ─── GET /api/auth/check-email ────────────────────────────────────────────────
// Valida e-mail em tempo real: formato, domínio bloqueado, disponibilidade
auth.get('/check-email', async (c) => {
  const email = (c.req.query('email') || '').trim().toLowerCase()

  if (!email) return c.json({ valid: false, error: 'E-mail obrigatório' })

  if (!isValidEmailFormat(email)) {
    return c.json({ valid: false, error: 'Formato de e-mail inválido' })
  }

  if (isBlockedEmail(email)) {
    return c.json({ valid: false, error: 'E-mails temporários não são permitidos' })
  }

  const existing = await c.env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first()
  if (existing) {
    return c.json({ valid: false, error: 'Este e-mail já está cadastrado' })
  }

  return c.json({ valid: true, message: 'E-mail válido e disponível ✓' })
})

// ─── POST /api/auth/register ──────────────────────────────────────────────────
auth.post('/register', async (c) => {
  try {
    const { nome, email, senha } = await c.req.json()
    
    if (!nome || !email || !senha) {
      return c.json({ error: 'Nome, email e senha são obrigatórios' }, 400)
    }
    if (nome.trim().length < 3) {
      return c.json({ error: 'Nome deve ter pelo menos 3 caracteres' }, 400)
    }
    if (!isValidEmailFormat(email)) {
      return c.json({ error: 'Formato de e-mail inválido' }, 400)
    }
    if (isBlockedEmail(email)) {
      return c.json({ error: 'E-mails temporários não são permitidos' }, 400)
    }
    if (senha.length < 8) {
      return c.json({ error: 'Senha deve ter pelo menos 8 caracteres' }, 400)
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
    ).bind(nome.trim(), email.toLowerCase(), senhaHash, color).run()

    const userId = result.meta.last_row_id
    
    // Criar assinatura free
    await c.env.DB.prepare(
      'INSERT INTO assinaturas (user_id, plano, status) VALUES (?, "free", "ativo")'
    ).bind(userId).run()

    // Gerar e salvar OTP
    const otp = generateOTP()
    const expiresAt = getOTPExpiry()
    await c.env.DB.prepare(
      `INSERT INTO email_verifications (user_id, email, code, attempts, expires_at)
       VALUES (?, ?, ?, 0, ?)`
    ).bind(userId, email.toLowerCase(), otp, expiresAt).run()

    // Criar sessão temporária (usuário pode navegar mas não confirmado)
    const token = generateToken()
    const tokenExpiry = getTokenExpiry()
    await c.env.DB.prepare(
      'INSERT INTO sessions (user_id, token, expires_at) VALUES (?, ?, ?)'
    ).bind(userId, token, tokenExpiry).run()

    return c.json({
      success: true,
      message: 'Conta criada! Verifique seu e-mail.',
      user: { id: userId, nome: nome.trim(), email: email.toLowerCase(), plano: 'free' },
      token,
      otp_required: true,
      // Em produção NUNCA retornar o OTP — aqui somente para demo/dev
      _dev_otp: otp
    }, 201)
  } catch (e: any) {
    return c.json({ error: 'Erro ao criar conta', details: e.message }, 500)
  }
})

// ─── POST /api/auth/verify-otp ────────────────────────────────────────────────
auth.post('/verify-otp', async (c) => {
  try {
    const { email, code } = await c.req.json()
    if (!email || !code) return c.json({ error: 'E-mail e código são obrigatórios' }, 400)

    const record = await c.env.DB.prepare(
      `SELECT * FROM email_verifications
       WHERE email = ? AND verified_at IS NULL
       ORDER BY created_at DESC LIMIT 1`
    ).bind(email.toLowerCase()).first() as any

    if (!record) return c.json({ error: 'Nenhuma verificação pendente para este e-mail' }, 404)

    // Expirado
    if (new Date(record.expires_at) < new Date()) {
      return c.json({ error: 'Código expirado. Solicite um novo.', expired: true }, 400)
    }

    // Muitas tentativas
    if (record.attempts >= 5) {
      return c.json({ error: 'Muitas tentativas. Solicite um novo código.', locked: true }, 429)
    }

    // Incrementar tentativas
    await c.env.DB.prepare(
      'UPDATE email_verifications SET attempts = attempts + 1 WHERE id = ?'
    ).bind(record.id).run()

    if (record.code !== String(code)) {
      const remaining = 4 - record.attempts
      return c.json({ error: `Código incorreto. ${remaining > 0 ? remaining + ' tentativas restantes.' : 'Última tentativa.'}`, invalid: true }, 400)
    }

    // Marcar como verificado
    await c.env.DB.prepare(
      'UPDATE email_verifications SET verified_at = datetime("now") WHERE id = ?'
    ).bind(record.id).run()

    return c.json({ success: true, message: 'E-mail verificado com sucesso!' })
  } catch (e: any) {
    return c.json({ error: 'Erro na verificação', details: e.message }, 500)
  }
})

// ─── POST /api/auth/resend-otp ────────────────────────────────────────────────
auth.post('/resend-otp', async (c) => {
  try {
    const { email } = await c.req.json()
    if (!email) return c.json({ error: 'E-mail obrigatório' }, 400)

    const user = await c.env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email.toLowerCase()).first() as any
    if (!user) return c.json({ error: 'Usuário não encontrado' }, 404)

    // Checar cooldown de 1 minuto
    const recent = await c.env.DB.prepare(
      `SELECT created_at FROM email_verifications
       WHERE user_id = ? AND created_at > datetime('now', '-1 minute')
       ORDER BY created_at DESC LIMIT 1`
    ).bind(user.id).first() as any

    if (recent) {
      return c.json({ error: 'Aguarde 1 minuto antes de solicitar novo código', cooldown: true }, 429)
    }

    const otp = generateOTP()
    const expiresAt = getOTPExpiry()
    await c.env.DB.prepare(
      `INSERT INTO email_verifications (user_id, email, code, attempts, expires_at)
       VALUES (?, ?, ?, 0, ?)`
    ).bind(user.id, email.toLowerCase(), otp, expiresAt).run()

    return c.json({
      success: true,
      message: 'Novo código enviado!',
      _dev_otp: otp
    })
  } catch (e: any) {
    return c.json({ error: 'Erro ao reenviar código', details: e.message }, 500)
  }
})

// ─── POST /api/auth/login ─────────────────────────────────────────────────────
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

    await c.env.DB.prepare('UPDATE users SET ultimo_acesso = datetime("now") WHERE id = ?').bind(user.id).run()

    const token = generateToken()
    const expiresAt = getTokenExpiry()
    await c.env.DB.prepare(
      'INSERT INTO sessions (user_id, token, expires_at) VALUES (?, ?, ?)'
    ).bind(user.id, token, expiresAt).run()

    // Verifica e desbloqueia conquistas retroativamente (sem bloquear a resposta)
    // Roda de forma assíncrona via waitUntil quando disponível, ou em background
    try {
      // Executa sem await para não atrasar o login — erros são silenciados
      verificarConquistasParaUsuario(c.env.DB, user.id).catch(() => {})
    } catch { /* ignora erros na verificação */ }

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

// ─── POST /api/auth/logout ────────────────────────────────────────────────────
auth.post('/logout', requireAuth, async (c) => {
  const token = c.get('token')
  await c.env.DB.prepare('DELETE FROM sessions WHERE token = ?').bind(token).run()
  return c.json({ success: true, message: 'Logout realizado' })
})

// ─── GET /api/auth/me ─────────────────────────────────────────────────────────
auth.get('/me', requireAuth, async (c) => {
  const user = c.get('user')
  return c.json({ user })
})

// ─── Aliases para compatibilidade ────────────────────────────────────────────
// /registro → /register  (alguns clientes usam PT-BR)
auth.post('/registro', async (c) => {
  // Despacho interno no próprio sub-app (montado em /api/auth, logo o caminho
  // relativo é '/register'). Antes isso era um fetch() de saída para a própria
  // aplicação — no Node seria o servidor abrindo uma conexão consigo mesmo.
  const url = new URL(c.req.url)
  url.pathname = '/register'
  const newReq = new Request(url.toString(), {
    method: 'POST', headers: c.req.raw.headers, body: c.req.raw.body,
    // @ts-expect-error — exigido pelo undici quando há body em stream
    duplex: 'half',
  })
  return auth.fetch(newReq, c.env)
})

export default auth
