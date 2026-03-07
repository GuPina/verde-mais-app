// Biblioteca de autenticação para Cloudflare Workers
// Usa Web Crypto API (disponível no Cloudflare Workers runtime)

export async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(password)
  const salt = crypto.getRandomValues(new Uint8Array(16))
  
  const key = await crypto.subtle.importKey('raw', data, 'PBKDF2', false, ['deriveBits'])
  const derivedBits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
    key,
    256
  )
  
  const hashArray = new Uint8Array(derivedBits)
  const saltHex = Array.from(salt).map(b => b.toString(16).padStart(2, '0')).join('')
  const hashHex = Array.from(hashArray).map(b => b.toString(16).padStart(2, '0')).join('')
  
  return `${saltHex}:${hashHex}`
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  try {
    const [saltHex, hashHex] = stored.split(':')
    const salt = new Uint8Array(saltHex.match(/.{2}/g)!.map(b => parseInt(b, 16)))
    
    const encoder = new TextEncoder()
    const data = encoder.encode(password)
    
    const key = await crypto.subtle.importKey('raw', data, 'PBKDF2', false, ['deriveBits'])
    const derivedBits = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
      key,
      256
    )
    
    const hashArray = new Uint8Array(derivedBits)
    const newHashHex = Array.from(hashArray).map(b => b.toString(16).padStart(2, '0')).join('')
    
    return newHashHex === hashHex
  } catch {
    return false
  }
}

export function generateToken(): string {
  const array = crypto.getRandomValues(new Uint8Array(32))
  return Array.from(array).map(b => b.toString(16).padStart(2, '0')).join('')
}

export function getTokenExpiry(): string {
  const date = new Date()
  date.setDate(date.getDate() + 7) // 7 dias
  return date.toISOString()
}
