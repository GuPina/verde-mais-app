/**
 * VerdeMais — tarefas agendadas (Render Cron Job)
 * ============================================================================
 * No Cloudflare o wrangler.jsonc nunca teve `triggers.crons`, então
 * recorrências, lembretes e verificação de atraso só rodavam quando o usuário
 * abria a tela correspondente — quem não entrasse no app simplesmente não
 * tinha os lançamentos gerados.
 *
 * Aqui isso vira um Cron Job do Render. Em vez de reimplementar as regras, o
 * script cria uma sessão efêmera para cada usuário e chama os próprios
 * endpoints em processo (sem rede), garantindo que a lógica executada é
 * exatamente a mesma da aplicação.
 */
import app from './index'
import { criarBanco } from './lib/d1-compat'

const { DATABASE_URL } = process.env
if (!DATABASE_URL) { console.error('✗ DATABASE_URL não definida'); process.exit(1) }

const DB = criarBanco(DATABASE_URL)
const bindings = {
  DB,
  ADMIN_PASSWORD: process.env.ADMIN_PASSWORD,
  ASAAS_API_KEY: process.env.ASAAS_API_KEY,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  OPENAI_BASE_URL: process.env.OPENAI_BASE_URL,
}

function tokenAleatorio(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)))
    .map(b => b.toString(16).padStart(2, '0')).join('')
}

/** Executa `caminho` como se fosse o usuário informado, sem sair do processo. */
async function comoUsuario(userId: number, caminho: string, corpo?: unknown) {
  const token = tokenAleatorio()
  const expira = new Date(Date.now() + 5 * 60_000).toISOString().replace('T', ' ').split('.')[0]
  await DB.prepare('INSERT INTO sessions (user_id, token, expires_at) VALUES (?, ?, ?)')
    .bind(userId, token, expira).run()
  try {
    const req = new Request(`http://cron.local${caminho}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(corpo ?? {}),
    })
    const res = await app.fetch(req, bindings)
    return { status: res.status, corpo: await res.json().catch(() => null) }
  } finally {
    await DB.prepare('DELETE FROM sessions WHERE token = ?').bind(token).run()
  }
}

const agora = new Date()
const mes = agora.getMonth() + 1
const ano = agora.getFullYear()

const tarefas = [
  { nome: 'recorrências do mês', caminho: '/api/recorrencias/processar', corpo: { mes, ano } },
  { nome: 'atrasos de empréstimo', caminho: '/api/emprestimos/verificar-atrasos', corpo: {} },
  { nome: 'status de lembretes', caminho: '/api/lembretes/reset-status', corpo: {} },
]

const { results: usuarios } = await DB
  .prepare(`SELECT id, email FROM users ORDER BY id`)
  .all<{ id: number; email: string }>()

console.log(`[cron ${agora.toISOString()}] ${usuarios.length} usuário(s), ${tarefas.length} tarefa(s)`)

let okTotal = 0, erroTotal = 0
for (const u of usuarios) {
  for (const t of tarefas) {
    try {
      const r = await comoUsuario(u.id, t.caminho, t.corpo)
      if (r.status >= 200 && r.status < 300) okTotal++
      else { erroTotal++; console.warn(`  ✗ user ${u.id} · ${t.nome} → HTTP ${r.status}`) }
    } catch (e: any) {
      erroTotal++
      console.error(`  ✗ user ${u.id} · ${t.nome} → ${e.message}`)
    }
  }
}

// Higiene que o app nunca fez: sessões expiradas nunca eram removidas.
const limpeza = await DB.prepare(
  `DELETE FROM sessions WHERE expires_at < datetime('now')`
).run()

console.log(`[cron] ok=${okTotal} erros=${erroTotal} sessões_expiradas_removidas=${limpeza.meta.changes}`)
process.exit(erroTotal > 0 ? 1 : 0)
