/**
 * VerdeMais — entrypoint Node (Render)
 * ============================================================================
 * No Cloudflare Pages o runtime injetava os bindings (DB, chaves) em `c.env` e
 * servia public/ sozinho. Aqui os dois papéis são nossos: montamos o banco a
 * partir da DATABASE_URL do Neon, servimos os estáticos e repassamos tudo para
 * o mesmo app Hono de src/index.tsx — que não precisou ser alterado.
 */
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { compress } from 'hono/compress'
import { etag } from 'hono/etag'
import app from './index'
import { criarBanco } from './lib/d1-compat'

const { DATABASE_URL, PORT, ADMIN_PASSWORD, ASAAS_API_KEY, ASAAS_WEBHOOK_TOKEN,
        OPENAI_API_KEY, OPENAI_BASE_URL } = process.env

if (!DATABASE_URL) {
  console.error('✗ DATABASE_URL não definida. Configure a connection string do Neon.')
  process.exit(1)
}
if (!ADMIN_PASSWORD) {
  // Antes existia o fallback 'verdemais@admin2026' hardcoded no repositório
  // público. Sem senha configurada o certo é não subir.
  console.error('✗ ADMIN_PASSWORD não definida. O painel /admin não pode subir sem senha própria.')
  process.exit(1)
}

const bindings = {
  DB: criarBanco(DATABASE_URL),
  ADMIN_PASSWORD,
  ASAAS_API_KEY,
  ASAAS_WEBHOOK_TOKEN,
  OPENAI_API_KEY,
  OPENAI_BASE_URL,
}

const root = new Hono()

// ── Desempenho ──────────────────────────────────────────────────────────────
// O Cloudflare Pages comprimia tudo sozinho. Sem isto, o app.js sai com 1,4 MB
// em vez de ~282 KB — no 4G brasileiro é a diferença entre segundos e
// milissegundos, e é de longe o maior custo do carregamento.
root.use('*', compress())

// ETag deixa a revalidação custar 304 sem corpo em vez de baixar tudo de novo.
root.use('/static/*', etag())

root.use('/static/*', async (c, next) => {
  await next()
  // O appShell referencia os arquivos com ?v=... a cada deploy. Quando a versão
  // vem fixada na URL, o conteúdo daquela URL é imutável e pode ser cacheado
  // para sempre. Sem ?v=, cai num cache curto para não servir versão velha
  // caso alguém esqueça de trocar o parâmetro.
  c.header('Cache-Control', c.req.query('v')
    ? 'public, max-age=31536000, immutable'
    : 'public, max-age=300, must-revalidate')
})

// Estáticos — no Pages isso era automático; aqui é responsabilidade nossa.
root.use('/static/*', serveStatic({ root: './public' }))
root.get('/favicon.ico', serveStatic({ path: './public/favicon.ico' }))
root.get('/favicon.svg', serveStatic({ path: './public/favicon.svg' }))

// Health de infraestrutura: o /api/health do app não toca no banco, e num
// deploy com banco gerenciado a pergunta útil é "o Postgres responde?".
root.get('/healthz', async (c) => {
  try {
    await bindings.DB.prepare('SELECT 1 as ok').first()
    return c.json({ status: 'ok', db: 'up' })
  } catch (e: any) {
    return c.json({ status: 'degraded', db: 'down', erro: e.message }, 503)
  }
})

// Todo o resto vai para o app original, com os bindings no lugar de c.env.
// Sem terceiro argumento: no Node não existe ExecutionContext, e o getter
// c.executionCtx do Hono lança se acessado.
root.all('*', (c) => app.fetch(c.req.raw, bindings))

const porta = Number(PORT ?? 3000)
serve({ fetch: root.fetch, port: porta }, (info) => {
  console.log(`✓ VerdeMais em http://0.0.0.0:${info.port}`)
})
