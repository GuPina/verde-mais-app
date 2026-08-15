#!/usr/bin/env node
/**
 * VerdeMais — migração de dados D1 → Neon
 * ============================================================================
 * Uso:
 *   1) wrangler d1 export verdemais-production --remote --output=d1-dump.sql
 *   2) psql "$DATABASE_URL" -f migrations-postgres/0000_baseline_postgres.sql
 *   3) DATABASE_URL=... node scripts/migrar-d1-para-neon.mjs d1-dump.sql
 *
 * Opções:
 *   --dry-run     só relata o que faria, sem escrever
 *   --truncate    limpa as tabelas do Postgres antes de copiar
 *
 * Detalhes que a migração precisa acertar e este script trata:
 *   • Ordem topológica das tabelas — as FKs do baseline não são deferíveis e
 *     o usuário do Neon não é superusuário, então não dá para desligar
 *     triggers: é preciso inserir os pais antes dos filhos.
 *   • Colunas GENERATED (parcelas_restantes) não podem receber INSERT.
 *   • As sequences de IDENTITY precisam ser reposicionadas depois da carga,
 *     senão o primeiro INSERT do app colide com um id já existente.
 *   • Conferência de contagem por tabela no final — uma migração de dados sem
 *     verificação é só uma esperança.
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { DatabaseSync } from 'node:sqlite'
import pg from 'pg'

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const truncate = args.includes('--truncate')
const entrada = args.find(a => !a.startsWith('--'))

if (!entrada) {
  console.error('uso: node scripts/migrar-d1-para-neon.mjs <dump.sql|arquivo.sqlite> [--dry-run] [--truncate]')
  process.exit(1)
}
if (!process.env.DATABASE_URL) {
  console.error('✗ DATABASE_URL não definida')
  process.exit(1)
}

const LOTE = 500

// ── 1. Carrega o dump do D1 num SQLite local ────────────────────────────────
function abrirOrigem(arquivo) {
  if (/\.(sqlite|db)$/i.test(arquivo)) return new DatabaseSync(arquivo)

  const tmp = path.join(os.tmpdir(), `vm-d1-${Date.now()}.sqlite`)
  const db = new DatabaseSync(tmp)
  const sql = fs.readFileSync(arquivo, 'utf8')

  // O export do wrangler vem como um script SQL; executa em blocos para que
  // um statement problemático não derrube a carga inteira em silêncio.
  db.exec('PRAGMA foreign_keys=OFF')
  let falhas = 0
  for (const stmt of dividirStatements(sql)) {
    try { db.exec(stmt) } catch { falhas++ }
  }
  if (falhas) console.warn(`  ⚠ ${falhas} statement(s) do dump ignorados (normalmente PRAGMA/BEGIN do wrangler)`)
  return db
}

/** Divide o script em statements, respeitando literais com ';' dentro. */
function dividirStatements(sql) {
  const out = []
  let buf = '', inStr = false
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i]
    if (ch === "'") { if (inStr && sql[i + 1] === "'") { buf += "''"; i++; continue } inStr = !inStr }
    if (ch === ';' && !inStr) { if (buf.trim()) out.push(buf); buf = ''; continue }
    buf += ch
  }
  if (buf.trim()) out.push(buf)
  return out
}

// ── 2. Metadados do Postgres: colunas graváveis e ordem topológica ──────────
async function colunasGravaveis(cli) {
  const { rows } = await cli.query(`
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND is_generated = 'NEVER'          -- exclui colunas GENERATED ALWAYS
    ORDER BY table_name, ordinal_position`)
  const m = new Map()
  for (const r of rows) {
    // schema_migrations é o controle do runner de migrations, não dado do app.
    // Apagá-la faria o servidor reaplicar tudo no próximo boot.
    if (r.table_name === 'schema_migrations') continue
    if (!m.has(r.table_name)) m.set(r.table_name, [])
    m.get(r.table_name).push(r.column_name)
  }
  return m
}

async function ordemTopologica(cli, tabelas) {
  const { rows: fks } = await cli.query(`
    SELECT c.relname AS filho, f.relname AS pai
    FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_class f ON f.oid = con.confrelid
    WHERE con.contype = 'f' AND c.relname <> f.relname`)

  const deps = new Map(tabelas.map(t => [t, new Set()]))
  for (const { filho, pai } of fks) {
    if (deps.has(filho) && deps.has(pai)) deps.get(filho).add(pai)
  }

  const ordem = [], feito = new Set()
  while (ordem.length < tabelas.length) {
    const prontas = tabelas.filter(t => !feito.has(t) && [...deps.get(t)].every(d => feito.has(d)))
    if (!prontas.length) {
      // ciclo de FKs: insere o resto na ordem natural e deixa o Postgres reclamar
      for (const t of tabelas) if (!feito.has(t)) { ordem.push(t); feito.add(t) }
      break
    }
    for (const t of prontas) { ordem.push(t); feito.add(t) }
  }
  return ordem
}

// ── 3. Cópia ────────────────────────────────────────────────────────────────
const origem = abrirOrigem(entrada)
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL) ? false : { rejectUnauthorized: false },
})
const cli = await pool.connect()

const colsPorTabela = await colunasGravaveis(cli)
const tabelasPg = [...colsPorTabela.keys()]
const ordem = await ordemTopologica(cli, tabelasPg)

const tabelasOrigem = new Set(
  origem.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name NOT LIKE 'd1_%'")
    .all().map(r => r.name)
)

console.log(`\nTabelas no Postgres: ${tabelasPg.length} | presentes no dump do D1: ${tabelasOrigem.size}`)
if (dryRun) console.log('MODO DRY-RUN — nada será escrito\n')

// ── Trava contra colisão de id ───────────────────────────────────────────────
// O INSERT usa ON CONFLICT DO NOTHING. Se o destino já tiver linhas, os ids do
// D1 colidem com os que existem e a linha do D1 é DESCARTADA em silêncio — mas
// as filhas dela (despesas, receitas) entram apontando para o id existente.
// Ou seja: não é perda de dados, é troca de dono. Melhor parar do que misturar.
if (!truncate && !dryRun) {
  const ocupadas = []
  for (const t of ordem) {
    const n = Number((await cli.query(`SELECT COUNT(*)::int AS n FROM ${t}`)).rows[0].n)
    if (n > 0) ocupadas.push(`${t} (${n})`)
  }
  // conquistas_definicoes e csv_templates vêm populadas pelo próprio schema
  const relevantes = ocupadas.filter(o => !/^(conquistas_definicoes|csv_templates)\b/.test(o))
  if (relevantes.length) {
    console.error('\n✗ O banco de destino JÁ TEM DADOS:')
    console.error('   ' + relevantes.join(', '))
    console.error('\n  Importar por cima misturaria os registros: os ids do D1 colidem com os')
    console.error('  existentes, a linha do D1 é descartada e as filhas dela acabam penduradas')
    console.error('  no usuário errado.')
    console.error('\n  Rode com --truncate para limpar o destino antes de importar.\n')
    await cli.release(); await pool.end()
    process.exit(1)
  }
}

if (truncate && !dryRun) {
  for (const t of [...ordem].reverse()) await cli.query(`DELETE FROM ${t}`)
  console.log('Tabelas do destino limpas (schema_migrations preservada).\n')
}

const relatorio = []
let totalLinhas = 0

for (const tabela of ordem) {
  if (!tabelasOrigem.has(tabela)) { relatorio.push({ tabela, origem: '—', destino: 0, nota: 'ausente no dump' }); continue }

  const colsPg = colsPorTabela.get(tabela)
  const colsOrigem = new Set(origem.prepare(`PRAGMA table_info(${tabela})`).all().map(r => r.name))
  const cols = colsPg.filter(c => colsOrigem.has(c))
  if (!cols.length) { relatorio.push({ tabela, origem: '?', destino: 0, nota: 'sem colunas em comum' }); continue }

  const linhas = origem.prepare(`SELECT ${cols.map(c => `"${c}"`).join(', ')} FROM ${tabela}`).all()
  if (!linhas.length) { relatorio.push({ tabela, origem: 0, destino: 0 }); continue }

  if (!dryRun) {
    for (let i = 0; i < linhas.length; i += LOTE) {
      const lote = linhas.slice(i, i + LOTE)
      const valores = []
      const marcadores = lote.map((linha, li) =>
        '(' + cols.map((c, ci) => {
          valores.push(linha[c] ?? null)
          return `$${li * cols.length + ci + 1}`
        }).join(', ') + ')'
      ).join(', ')
      await cli.query(
        `INSERT INTO ${tabela} (${cols.map(c => `"${c}"`).join(', ')}) VALUES ${marcadores} ON CONFLICT DO NOTHING`,
        valores
      )
    }
  }

  const destino = dryRun ? 0 : Number((await cli.query(`SELECT COUNT(*)::int AS n FROM ${tabela}`)).rows[0].n)
  relatorio.push({ tabela, origem: linhas.length, destino })
  totalLinhas += linhas.length
  process.stdout.write(`  ${tabela.padEnd(32)} ${String(linhas.length).padStart(7)} linhas\n`)
}

// ── 4. Reposiciona as sequences das colunas IDENTITY ────────────────────────
if (!dryRun) {
  const { rows: idents } = await cli.query(`
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema='public' AND is_identity='YES'`)
  for (const { table_name, column_name } of idents) {
    await cli.query(`
      SELECT setval(
        pg_get_serial_sequence('${table_name}', '${column_name}'),
        GREATEST(COALESCE((SELECT MAX("${column_name}") FROM ${table_name}), 0), 1),
        true)`)
  }
  console.log(`\nSequences reposicionadas: ${idents.length}`)
}

// ── 5. Conferência ──────────────────────────────────────────────────────────
console.log('\n── Conferência ─────────────────────────────────────────────')
const divergentes = relatorio.filter(r => typeof r.origem === 'number' && r.origem !== r.destino && !dryRun)
for (const r of relatorio.filter(r => r.origem !== 0 && r.origem !== '—')) {
  // Em dry-run nada é escrito, então destino=0 é o esperado e não significa
  // divergência — marcar tudo com ✗ ali só assustava sem motivo.
  const marca = dryRun ? '·' : (typeof r.origem === 'number' && r.origem === r.destino ? '✓' : '✗')
  const destino = dryRun ? '(dry-run)' : String(r.destino).padStart(7)
  console.log(`  ${marca} ${r.tabela.padEnd(32)} origem=${String(r.origem).padStart(7)}  destino=${destino}${r.nota ? '  ' + r.nota : ''}`)
}
console.log(`\nTotal de linhas lidas do D1: ${totalLinhas}`)
console.log(divergentes.length
  ? `\n✗ ${divergentes.length} tabela(s) com contagem divergente — investigar antes de apontar o app para o Neon.`
  : `\n✓ Contagens conferem em todas as tabelas.`)

await cli.release()
await pool.end()
process.exit(divergentes.length ? 1 : 0)
