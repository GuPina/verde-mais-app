import { Hono } from 'hono'
import { hashPassword, verifyPassword, generateToken, getTokenExpiry } from '../lib/auth'
import { verificarConquistasParaUsuario } from './conquistas'
import { enviarOTP } from '../lib/email'
import { comparaSegura, ipDoCliente } from '../lib/seguranca'

type Bindings = {
  DB: D1Database
  RESEND_API_KEY?: string
  EMAIL_REMETENTE?: string
}
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
  // Math.random() não é criptograficamente seguro e é previsível a partir de
  // saídas anteriores — inadequado para um código que autoriza uma conta.
  // Rejeição de amostra para não enviesar os dígitos por módulo.
  const buf = new Uint32Array(1)
  let n: number
  do { crypto.getRandomValues(buf); n = buf[0] } while (n >= 4_294_000_000)
  return String(100000 + (n % 900000))
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


// ─── Rate limiting de login ──────────────────────────────────────────────────
// Janela deslizante em duas chaves:
//   • e-mail+IP  → força bruta contra uma conta a partir de uma origem
//   • IP         → varredura de muitas contas a partir da mesma origem
//
// Deliberadamente NÃO existe bloqueio só por e-mail: ele seria uma negação de
// serviço direcionada — bastaria errar a senha de alguém oito vezes para
// trancá-lo fora da própria conta pelos 15 minutos seguintes.
const JANELA_MINUTOS = 15
const MAX_FALHAS_ORIGEM = 8    // mesmo e-mail vindo do mesmo IP
const MAX_FALHAS_IP = 30       // qualquer e-mail vindo do mesmo IP

async function contarFalhas(db: any, chave: string): Promise<number> {
  const r = await db.prepare(
    `SELECT COUNT(*) as n FROM tentativas_login
     WHERE chave = ? AND sucesso = 0 AND criado_em > datetime('now', ?)`
  ).bind(chave, `-${JANELA_MINUTOS} minutes`).first()
  return Number(r?.n || 0)
}

async function registrarTentativa(db: any, chave: string, sucesso: boolean) {
  await db.prepare('INSERT INTO tentativas_login (chave, sucesso) VALUES (?, ?)')
    .bind(chave, sucesso ? 1 : 0).run()
}

/** Após um login bem-sucedido, zera o histórico de falhas daquele e-mail. */
async function limparFalhas(db: any, chave: string) {
  await db.prepare('DELETE FROM tentativas_login WHERE chave = ?').bind(chave).run()
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

    // O código vai por e-mail e NUNCA na resposta. Se o envio falhar, a conta
    // continua criada — o usuário pede reenvio — mas o motivo fica no log.
    const envio = await enviarOTP(c.env, email.toLowerCase(), nome.trim(), otp)
    if (!envio.enviado) {
      console.error(`OTP não enviado para ${email.toLowerCase()}: ${envio.motivo} · código=${otp}`)
    }

    return c.json({
      success: true,
      message: envio.enviado
        ? 'Conta criada! Enviamos um código de 6 dígitos para o seu e-mail.'
        : 'Conta criada! Não conseguimos enviar o e-mail agora — use "Reenviar código".',
      user: { id: userId, nome: nome.trim(), email: email.toLowerCase(), plano: 'free' },
      token,
      otp_required: true,
      email_enviado: envio.enviado
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

    if (!comparaSegura(String(record.code), String(code))) {
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

    const envio = await enviarOTP(c.env, email.toLowerCase(), '', otp)
    if (!envio.enviado) {
      console.error(`Reenvio de OTP falhou para ${email.toLowerCase()}: ${envio.motivo} · código=${otp}`)
      return c.json({ error: 'Não foi possível enviar o e-mail agora. Tente novamente em instantes.' }, 502)
    }

    return c.json({
      success: true,
      message: 'Novo código enviado! Verifique sua caixa de entrada.'
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

    const ip           = ipDoCliente(c)
    const chaveOrigem  = `origem:${String(email).toLowerCase()}|${ip}`
    const chaveIp      = `ip:${ip}`

    const [falhasOrigem, falhasIp] = await Promise.all([
      contarFalhas(c.env.DB, chaveOrigem),
      contarFalhas(c.env.DB, chaveIp),
    ])
    if (falhasOrigem >= MAX_FALHAS_ORIGEM || falhasIp >= MAX_FALHAS_IP) {
      return c.json({
        error: `Muitas tentativas de login. Tente novamente em ${JANELA_MINUTOS} minutos.`,
        bloqueado: true,
      }, 429, { 'Retry-After': String(JANELA_MINUTOS * 60) })
    }

    const user = await c.env.DB.prepare(
      'SELECT * FROM users WHERE email = ?'
    ).bind(email).first() as any

    // Mesma mensagem e mesmo custo para usuário inexistente e senha errada:
    // respostas diferentes revelariam quais e-mails têm conta.
    if (!user) {
      await registrarTentativa(c.env.DB, chaveOrigem, false)
      await registrarTentativa(c.env.DB, chaveIp, false)
      return c.json({ error: 'Email ou senha incorretos' }, 401)
    }

    const valid = await verifyPassword(senha, user.senha)
    if (!valid) {
      await registrarTentativa(c.env.DB, chaveOrigem, false)
      await registrarTentativa(c.env.DB, chaveIp, false)
      return c.json({ error: 'Email ou senha incorretos' }, 401)
    }

    await limparFalhas(c.env.DB, chaveOrigem)

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
