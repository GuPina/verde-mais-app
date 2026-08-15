/**
 * VerdeMais — utilidades de segurança
 * ============================================================================
 * Só Web Crypto: o mesmo código roda no Cloudflare Workers e no Node 20+.
 */

const enc = new TextEncoder()

/**
 * Comparação em tempo constante.
 * `a === b` em string vaza o tamanho do prefixo correto pelo tempo de resposta,
 * o que permite descobrir um segredo caractere a caractere.
 */
export function comparaSegura(a: string, b: string): boolean {
  const ba = enc.encode(a)
  const bb = enc.encode(b)
  // O XOR do tamanho garante que comprimentos diferentes falhem sem sair cedo.
  let dif = ba.length ^ bb.length
  const n = Math.max(ba.length, bb.length)
  for (let i = 0; i < n; i++) dif |= (ba[i] ?? 0) ^ (bb[i] ?? 0)
  return dif === 0
}

function paraHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('')
}

async function hmac(segredo: string, mensagem: string): Promise<string> {
  const chave = await crypto.subtle.importKey(
    'raw', enc.encode(segredo), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  )
  return paraHex(await crypto.subtle.sign('HMAC', chave, enc.encode(mensagem)))
}

/**
 * Emite um token de sessão assinado, com validade embutida.
 *
 * Antes o cookie do admin era a própria senha (`admin_token=${PASS}`): ela
 * ficava em claro no navegador, era aceita por query string — vazando em log e
 * header Referer — e não expirava. Aqui o cookie passa a ser um token derivado,
 * que não permite recuperar a senha e morre sozinho.
 */
export async function emitirToken(segredo: string, sujeito: string, validadeSegundos: number): Promise<string> {
  const expira = Math.floor(Date.now() / 1000) + validadeSegundos
  const corpo = `${sujeito}.${expira}`
  return `${corpo}.${await hmac(segredo, corpo)}`
}

/** Valida assinatura e prazo. Devolve o sujeito, ou null se inválido. */
export async function validarToken(segredo: string, token: string): Promise<string | null> {
  const partes = token.split('.')
  if (partes.length !== 3) return null
  const [sujeito, expiraStr, assinatura] = partes
  const corpo = `${sujeito}.${expiraStr}`
  if (!await comparaSegura(assinatura, await hmac(segredo, corpo))) return null
  const expira = Number(expiraStr)
  if (!Number.isFinite(expira) || expira < Math.floor(Date.now() / 1000)) return null
  return sujeito
}

/** IP do cliente, atravessando os proxies de Cloudflare e Render. */
export function ipDoCliente(c: any): string {
  return c.req.header('CF-Connecting-IP')
    || (c.req.header('X-Forwarded-For') || '').split(',')[0].trim()
    || c.req.header('X-Real-IP')
    || 'desconhecido'
}
