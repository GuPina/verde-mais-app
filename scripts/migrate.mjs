#!/usr/bin/env node
/**
 * VerdeMais — migrations do Postgres
 * ============================================================================
 * Aplica, em ordem, os arquivos de `migrations-postgres/` que ainda não foram
 * aplicados, registrando cada um em `schema_migrations`.
 *
 *   npm run db:migrate              aplica o que falta
 *   npm run db:status               só mostra o que está pendente
 *   npm run db:migrate -- --dry-run mostra o SQL sem executar
 *
 * Cada migration roda dentro de uma transação: se falhar no meio, nada dela
 * fica aplicado. É a diferença mais útil em relação ao que existia no D1, onde
 * uma migration parcialmente aplicada deixava o schema num estado ambíguo — foi
 * o que produziu as dez migrations "fix_" do histórico antigo.
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import pg from 'pg'

const args = process.argv.slice(2)
const soStatus = args.includes('--status')
const dryRun = args.includes('--dry-run')

const DIR = path.join(process.cwd(), 'migrations-postgres')
if (!process.env.DATABASE_URL) {
  console.error('✗ DATABASE_URL não definida')
  process.exit(1)
}

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL) ? false : { rejectUnauthorized: false },
})
const cli = await pool.connect()

await cli.query(`
  CREATE TABLE IF NOT EXISTS schema_migrations (
    versao      text PRIMARY KEY,
    hash        text NOT NULL,
    aplicada_em timestamptz NOT NULL DEFAULT now()
  )`)

const arquivos = fs.readdirSync(DIR).filter(f => f.endsWith('.sql')).sort()
const { rows } = await cli.query('SELECT versao, hash FROM schema_migrations')
const aplicadas = new Map(rows.map(r => [r.versao, r.hash]))

const pendentes = []
let alteradas = 0

for (const arquivo of arquivos) {
  const sql = fs.readFileSync(path.join(DIR, arquivo), 'utf8')
  const hash = crypto.createHash('sha256').update(sql).digest('hex').slice(0, 16)
  const jaAplicada = aplicadas.get(arquivo)

  if (jaAplicada === undefined) { pendentes.push({ arquivo, sql, hash }); continue }
  if (jaAplicada !== hash) {
    alteradas++
    console.warn(`  ⚠ ${arquivo} foi EDITADA depois de aplicada (hash mudou).`)
    console.warn(`    Migration já aplicada não deve ser alterada — crie uma nova.`)
  }
}

console.log(`\nMigrations: ${arquivos.length} no diretório · ${aplicadas.size} aplicadas · ${pendentes.length} pendente(s)`)

if (soStatus) {
  for (const p of pendentes) console.log(`  pendente: ${p.arquivo}`)
  await cli.release(); await pool.end()
  process.exit(alteradas ? 1 : 0)
}

if (!pendentes.length) {
  console.log('Nada a aplicar.')
  await cli.release(); await pool.end()
  process.exit(alteradas ? 1 : 0)
}

for (const { arquivo, sql, hash } of pendentes) {
  if (dryRun) { console.log(`\n── ${arquivo} ──\n${sql.slice(0, 500)}${sql.length > 500 ? '\n…' : ''}`); continue }
  process.stdout.write(`  aplicando ${arquivo} … `)
  try {
    await cli.query('BEGIN')
    await cli.query(sql)
    await cli.query('INSERT INTO schema_migrations (versao, hash) VALUES ($1, $2)', [arquivo, hash])
    await cli.query('COMMIT')
    console.log('ok')
  } catch (e) {
    await cli.query('ROLLBACK').catch(() => {})
    console.log('FALHOU')
    console.error(`\n✗ ${arquivo}: ${e.message}`)
    console.error('  Nada desta migration foi aplicado (rollback).')
    await cli.release(); await pool.end()
    process.exit(1)
  }
}

console.log(dryRun ? '\n(dry-run — nada foi aplicado)' : '\n✓ Migrations aplicadas.')
await cli.release()
await pool.end()
