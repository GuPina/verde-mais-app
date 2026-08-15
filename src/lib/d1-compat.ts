/**
 * VerdeMais — camada de compatibilidade D1 → Postgres (Neon)
 * ============================================================================
 * Expõe exatamente a mesma API do D1Database que as ~1.200 queries do projeto
 * já usam (`prepare().bind().first()/.all()/.run()`, `batch()`), traduzindo o
 * dialeto SQLite para Postgres por baixo. Nenhuma rota precisa ser alterada.
 *
 * O que é traduzido (levantado por varredura do código, não por suposição):
 *   strftime('%Y'|'%m'|'%Y-%m', X) ..... 282 ocorrências → substr posicional
 *   datetime('now' [, '±N unidade']) ... 109 ocorrências → now() + interval
 *   INSERT OR IGNORE ................... 61 ocorrências  → ON CONFLICT DO NOTHING
 *   INSERT OR REPLACE .................. 9 ocorrências   → ON CONFLICT DO UPDATE
 *   MIN(a,b) / MAX(a,b) escalares ...... 26 ocorrências  → LEAST / GREATEST
 *   LIKE ............................... 69 ocorrências  → ILIKE
 *   julianday(X) ....................... 3 ocorrências   → dias desde a epoch
 *   GROUP_CONCAT(a,b) .................. 1 ocorrência    → string_agg
 *   placeholders ? ..................... ~4.900          → $1..$n
 *   meta.last_row_id ................... 45 leituras     → RETURNING id
 *
 * Armadilha silenciosa coberta aqui: o driver `pg` devolve int8 (COUNT) e
 * numeric como STRING. Sem os type parsers abaixo, `count: 0` viraria `"0"`
 * — que é truthy em JS — e a aritmética financeira passaria a concatenar.
 */
import pg from 'pg'

// ── Type parsers: números voltam como número, igual ao D1 ────────────────────
pg.types.setTypeParser(20, (v: string | null) => (v === null ? null : parseInt(v, 10)))    // int8 / COUNT()
pg.types.setTypeParser(1700, (v: string | null) => (v === null ? null : parseFloat(v)))     // numeric

const NOW_TS = `to_char((now() AT TIME ZONE 'UTC'),'YYYY-MM-DD HH24:MI:SS')`
const NOW_D = `to_char((now() AT TIME ZONE 'UTC'),'YYYY-MM-DD')`

/** Tabelas sem coluna `id` — nelas o RETURNING id não pode ser aplicado. */
const TABELAS_SEM_ID = new Set([
  'budget_rule_config', 'cdi_historico', 'despesa_tags', 'investimento_tags',
  'meta_tags', 'reserva_tags', 'weekly_challenge_config',
])

/** Alvos de conflito para INSERT OR REPLACE, extraídos das constraints UNIQUE. */
const CONFLITO: Record<string, string[]> = {
  analise_compras_fantasma: ['user_id', 'mes', 'ano'],
  cotacoes_cache: ['tipo', 'symbol'],
  patrimonio_historico: ['user_id', 'mes'],
  recorrencias_historico: ['recorrencia_id', 'mes', 'ano'],
  score_historico: ['user_id', 'mes'],
}

// ── Utilidades de varredura respeitando literais entre aspas ────────────────

/** Executa `fn` em cada posição fora de string literal. */
function forEachOutsideString(sql: string, fn: (i: number) => number | void) {
  let inStr = false
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i]
    if (ch === "'") {
      // '' escapado dentro de literal
      if (inStr && sql[i + 1] === "'") { i++; continue }
      inStr = !inStr
      continue
    }
    if (inStr) continue
    const jump = fn(i)
    if (typeof jump === 'number') i = jump
  }
}

/** Dado o índice do '(' de abertura, devolve o índice do ')' correspondente. */
function fecharParen(sql: string, abre: number): number {
  let depth = 0, inStr = false
  for (let i = abre; i < sql.length; i++) {
    const ch = sql[i]
    if (ch === "'") { if (inStr && sql[i + 1] === "'") { i++; continue } inStr = !inStr; continue }
    if (inStr) continue
    if (ch === '(') depth++
    else if (ch === ')') { depth--; if (depth === 0) return i }
  }
  return -1
}

/** Divide os argumentos de uma chamada por vírgulas de nível superior. */
function argsDe(inner: string): string[] {
  const out: string[] = []
  let depth = 0, buf = '', inStr = false
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i]
    if (ch === "'") { if (inStr && inner[i + 1] === "'") { buf += "''"; i++; continue } inStr = !inStr; buf += ch; continue }
    if (!inStr) {
      if (ch === '(') depth++
      else if (ch === ')') depth--
      else if (ch === ',' && depth === 0) { out.push(buf.trim()); buf = ''; continue }
    }
    buf += ch
  }
  if (buf.trim()) out.push(buf.trim())
  return out
}

/**
 * Reescreve toda chamada `nome(...)` (fora de literais) usando `fn`.
 * Trabalha do fim para o começo para não invalidar os índices, e é
 * paren-aware — por isso lida com `strftime('%m', COALESCE(vencimento, data))`.
 */
function reescreverChamadas(sql: string, nome: string, fn: (args: string[]) => string | null): string {
  const re = new RegExp(`\\b${nome}\\s*\\(`, 'gi')
  const pontos: Array<{ ini: number; abre: number }> = []
  let m: RegExpExecArray | null
  while ((m = re.exec(sql))) {
    // ignora ocorrências dentro de literais
    let inStr = false
    for (let i = 0; i < m.index; i++) {
      if (sql[i] === "'") { if (inStr && sql[i + 1] === "'") { i++; continue } inStr = !inStr }
    }
    if (inStr) continue
    pontos.push({ ini: m.index, abre: m.index + m[0].length - 1 })
  }
  for (let k = pontos.length - 1; k >= 0; k--) {
    const { ini, abre } = pontos[k]
    const fecha = fecharParen(sql, abre)
    if (fecha < 0) continue
    const subst = fn(argsDe(sql.slice(abre + 1, fecha)))
    if (subst !== null) sql = sql.slice(0, ini) + subst + sql.slice(fecha + 1)
  }
  return sql
}

/**
 * `'-6 months'` / `'+7 days'` → `- interval '6 months'`
 *
 * O modificador nem sempre é literal: o código monta alguns por concatenação,
 * como `'+' || ? || ' days'`. Nesse caso devolvemos um cast para interval em
 * runtime — descartar o argumento apagaria um placeholder e o número de
 * parâmetros deixaria de bater com o bind.
 */
function modificadorParaIntervalo(mod: string): string {
  const bruto = mod.trim()
  const lit = bruto.replace(/^'|'$/g, '').trim()
  const m = lit.match(/^([+-])\s*(\d+)\s+(\w+)$/)
  if (m) return ` ${m[1] === '-' ? '-' : '+'} interval '${m[2]} ${m[3]}'`
  if (!bruto) return ''
  return ` + (${bruto})::interval`
}

// ── Tradução ────────────────────────────────────────────────────────────────

export function traduzir(sqlOriginal: string): string {
  let sql = sqlOriginal

  // 0. O SQLite aceita "texto" com aspas duplas como literal quando não existe
  //    coluna com esse nome — o código usa isso em datetime("now"), plano
  //    "free" e status "ativo". No Postgres aspas duplas são SEMPRE
  //    identificador, então viraria «coluna now». Convertemos para aspas
  //    simples. Seguro aqui: uma varredura das ~1.200 queries mostrou que o
  //    projeto nunca usa identificador entre aspas.
  sql = (() => {
    let out = '', inStr = false
    for (let i = 0; i < sql.length; i++) {
      const ch = sql[i]
      if (ch === "'") { if (inStr && sql[i + 1] === "'") { out += "''"; i++; continue } inStr = !inStr; out += ch; continue }
      if (!inStr && ch === '"') {
        const fim = sql.indexOf('"', i + 1)
        if (fim > i) { out += "'" + sql.slice(i + 1, fim).replace(/'/g, "''") + "'"; i = fim; continue }
      }
      out += ch
    }
    return out
  })()

  // 1. strftime — só três formatos são usados no projeto inteiro.
  //    substr posicional é exato sobre 'YYYY-MM-DD[ HH:MM:SS]', é null-safe e
  //    evita cast de texto que estouraria em linha malformada.
  sql = reescreverChamadas(sql, 'strftime', (args) => {
    if (args.length < 2) return null
    const fmt = args[0].replace(/'/g, '')
    const alvo = args[1]
    const pgFmtDe = (f: string) => f.replace(/%Y/g, 'YYYY').replace(/%m/g, 'MM').replace(/%d/g, 'DD')
      .replace(/%H/g, 'HH24').replace(/%M/g, 'MI').replace(/%S/g, 'SS')
    // strftime('%Y-%m','now') e strftime('%Y-%m','now','-1 month'): o alvo é a
    // data corrente, não uma coluna — recortar a string 'now' daria lixo.
    if (/^'now'$/i.test(alvo.trim())) {
      const iv = args.slice(2).map(modificadorParaIntervalo).join('')
      return `to_char((now() AT TIME ZONE 'UTC')${iv},'${pgFmtDe(fmt)}')`
    }
    if (fmt === '%Y') return `substr(${alvo},1,4)`
    if (fmt === '%m') return `substr(${alvo},6,2)`
    if (fmt === '%d') return `substr(${alvo},9,2)`
    if (fmt === '%Y-%m') return `substr(${alvo},1,7)`
    if (fmt === '%H') return `substr(${alvo},12,2)`
    // formato não previsto: cai no to_char, com os códigos convertidos
    const pgFmt = fmt.replace(/%Y/g, 'YYYY').replace(/%m/g, 'MM').replace(/%d/g, 'DD')
      .replace(/%H/g, 'HH24').replace(/%M/g, 'MI').replace(/%S/g, 'SS')
    return `to_char((${alvo})::timestamp,'${pgFmt}')`
  })

  // 2. datetime('now') / date('now') com modificadores opcionais
  sql = reescreverChamadas(sql, 'datetime', (args) => {
    if (!args.length || !/^'now'$/i.test(args[0].trim())) return null
    const iv = args.slice(1).map(modificadorParaIntervalo).join('')
    return `to_char((now() AT TIME ZONE 'UTC')${iv},'YYYY-MM-DD HH24:MI:SS')`
  })
  sql = reescreverChamadas(sql, 'date', (args) => {
    if (!args.length) return null
    if (/^'now'$/i.test(args[0].trim())) {
      const iv = args.slice(1).map(modificadorParaIntervalo).join('')
      return `to_char((now() AT TIME ZONE 'UTC')${iv},'YYYY-MM-DD')`
    }
    // date(coluna) sobre texto: o PG devolveria tipo `date`, que não compara
    // com os literais de texto usados no resto da query. Recorta em vez de
    // converter, preservando a semântica textual do SQLite.
    if (args.length === 1) return `substr(${args[0]},1,10)`
    // date(expr, '-3 months'): aqui a aritmética é inevitável — converte,
    // desloca e volta para texto, mantendo o tipo de saída.
    const iv = args.slice(1).map(modificadorParaIntervalo).join('')
    if (iv) return `to_char(((${args[0]})::date)${iv},'YYYY-MM-DD')`
    return null
  })
  sql = sql.replace(/\bCURRENT_TIMESTAMP\b/gi, NOW_TS)

  // 3. julianday(X) → número de dias desde a epoch (preserva as subtrações)
  sql = reescreverChamadas(sql, 'julianday', (args) =>
    args.length === 1 ? `((${args[0]})::date - DATE '1970-01-01')` : null)

  // 4. MIN/MAX escalares (2 args) → LEAST/GREATEST. Com 1 arg é agregado: mantém.
  sql = reescreverChamadas(sql, 'MIN', (args) =>
    args.length === 2 ? `LEAST(${args[0]}, ${args[1]})` : null)
  sql = reescreverChamadas(sql, 'MAX', (args) =>
    args.length === 2 ? `GREATEST(${args[0]}, ${args[1]})` : null)

  // 4b. ROUND(x, n): no Postgres só existe para numeric, não para double precision
  sql = reescreverChamadas(sql, 'ROUND', (args) =>
    args.length === 2 ? `round((${args[0]})::numeric, ${args[1]})` : null)

  // 4c. printf('%0Nd', x) → lpad; é como o código monta 'YYYY-MM' na mão
  sql = reescreverChamadas(sql, 'printf', (args) => {
    if (args.length < 2) return null
    const fmt = args[0].trim().replace(/^'|'$/g, '')
    const vals = args.slice(1)
    const pedacos: string[] = []
    let vi = 0
    const re = /%0?(\d*)d|([^%]+)/g
    let mm: RegExpExecArray | null
    while ((mm = re.exec(fmt))) {
      if (mm[2] !== undefined) pedacos.push(`'${mm[2].replace(/'/g, "''")}'`)
      else {
        const largura = mm[1] ? Number(mm[1]) : 0
        const v = vals[vi++]
        if (v === undefined) return null
        pedacos.push(largura ? `lpad((${v})::text, ${largura}, '0')` : `(${v})::text`)
      }
    }
    return pedacos.length ? `(${pedacos.join(' || ')})` : null
  })

  // 4c-bis. char(N) → chr(N). No Postgres `char` é nome de tipo, então
  //         char(227) nem chega a ser lido como função. (O código usa isso
  //         para normalizar acentos em nomes de categoria.)
  sql = reescreverChamadas(sql, 'char', (args) =>
    args.length === 1 ? `chr(${args[0]})` : null)

  // 4d. INSTR(a, b) → position(b in a)
  sql = reescreverChamadas(sql, 'INSTR', (args) =>
    args.length === 2 ? `position(${args[1]} in ${args[0]})` : null)

  // 5. GROUP_CONCAT → string_agg
  sql = reescreverChamadas(sql, 'GROUP_CONCAT', (args) =>
    `string_agg(${args[0]}${args[1] ? `, ${args[1]}` : `, ','`})`)

  // 6. LIKE → ILIKE (no SQLite o LIKE é case-insensitive para ASCII)
  sql = sql.replace(/\bLIKE\b/gi, (mt, off, str) => {
    let inStr = false
    for (let i = 0; i < off; i++) {
      if (str[i] === "'") { if (inStr && str[i + 1] === "'") { i++; continue } inStr = !inStr }
    }
    return inStr ? mt : 'ILIKE'
  })

  // 7. INSERT OR IGNORE / OR REPLACE
  const orIgnore = sql.match(/INSERT\s+OR\s+IGNORE\s+INTO\s+([a-z_0-9]+)/i)
  const orReplace = sql.match(/INSERT\s+OR\s+REPLACE\s+INTO\s+([a-z_0-9]+)/i)

  if (orIgnore) {
    sql = sql.replace(/INSERT\s+OR\s+IGNORE\s+INTO/i, 'INSERT INTO') + ' ON CONFLICT DO NOTHING'
  } else if (orReplace) {
    const tabela = orReplace[1].toLowerCase()
    const alvo = CONFLITO[tabela]
    sql = sql.replace(/INSERT\s+OR\s+REPLACE\s+INTO/i, 'INSERT INTO')
    if (alvo) {
      // colunas declaradas no INSERT, para montar o SET
      const colsM = sql.match(/INSERT\s+INTO\s+[a-z_0-9]+\s*\(([^)]*)\)/i)
      const cols = colsM ? colsM[1].split(',').map(s => s.trim()) : []
      const set = cols.filter(c => !alvo.includes(c)).map(c => `${c} = EXCLUDED.${c}`)
      sql += set.length
        ? ` ON CONFLICT (${alvo.join(', ')}) DO UPDATE SET ${set.join(', ')}`
        : ` ON CONFLICT (${alvo.join(', ')}) DO NOTHING`
    } else {
      sql += ' ON CONFLICT DO NOTHING'
    }
  }

  // 8. RETURNING id nos INSERT, para alimentar meta.last_row_id
  const ins = sql.match(/^\s*INSERT\s+INTO\s+"?([a-z_0-9]+)"?/i)
  if (ins && !/\bRETURNING\b/i.test(sql) && !TABELAS_SEM_ID.has(ins[1].toLowerCase())) {
    sql += ' RETURNING id'
  }

  // 9. placeholders ? → $1..$n (por último, para não renumerar nada inserido antes)
  let n = 0
  let out = ''
  let inStr = false
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i]
    if (ch === "'") { if (inStr && sql[i + 1] === "'") { out += "''"; i++; continue } inStr = !inStr; out += ch; continue }
    if (!inStr && ch === '?') { out += '$' + ++n; continue }
    out += ch
  }
  return out
}

// ── API compatível com o D1 ─────────────────────────────────────────────────

export interface D1Meta { last_row_id: number | null; changes: number; duration: number }
export interface D1Result<T = any> { results: T[]; success: boolean; meta: D1Meta }

class Preparada {
  constructor(
    private pool: pg.Pool,
    private sql: string,
    private params: any[] = [],
    private cliente?: pg.PoolClient,
  ) {}

  bind(...params: any[]): Preparada {
    return new Preparada(this.pool, this.sql, params, this.cliente)
  }

  /** Usado internamente pelo batch() para prender a statement a uma transação. */
  _comCliente(cliente: pg.PoolClient): Preparada {
    return new Preparada(this.pool, this.sql, this.params, cliente)
  }

  private async exec(): Promise<pg.QueryResult> {
    const texto = traduzir(this.sql)
    const alvo = this.cliente ?? this.pool

    // Trava contra o pior modo de falha desta camada: uma regra de tradução
    // engolir um trecho que continha "?" e o número de parâmetros deixar de
    // bater. Sem isto, o Postgres às vezes aceita a query e devolve o
    // resultado errado, em silêncio.
    const maxPlaceholder = [...texto.matchAll(/\$(\d+)/g)]
      .reduce((mx, m) => Math.max(mx, Number(m[1])), 0)
    if (maxPlaceholder !== this.params.length) {
      throw new Error(
        `Tradução SQL inconsistente: a query usa ${maxPlaceholder} parâmetro(s) ` +
        `mas foram passados ${this.params.length}.\n  SQL traduzido: ${texto}\n  SQL original: ${this.sql.trim().slice(0, 400)}`
      )
    }

    try {
      return await alvo.query(texto, this.params)
    } catch (e: any) {
      // Mantém a query traduzida no erro — sem isso, depurar vira adivinhação.
      e.message = `${e.message}\n  SQL traduzido: ${texto}\n  SQL original: ${this.sql.trim().slice(0, 400)}`
      throw e
    }
  }

  async first<T = any>(): Promise<T | null> {
    const r = await this.exec()
    return (r.rows[0] as T) ?? null
  }

  async all<T = any>(): Promise<D1Result<T>> {
    const ini = Date.now()
    const r = await this.exec()
    return {
      results: r.rows as T[],
      success: true,
      meta: { last_row_id: null, changes: r.rowCount ?? 0, duration: Date.now() - ini },
    }
  }

  async run<T = any>(): Promise<D1Result<T>> {
    const ini = Date.now()
    const r = await this.exec()
    return {
      results: r.rows as T[],
      success: true,
      meta: {
        last_row_id: r.rows?.[0]?.id ?? null,
        changes: r.rowCount ?? 0,
        duration: Date.now() - ini,
      },
    }
  }

  /** D1 permite `await stmt` direto em alguns pontos; espelha o all(). */
  then(resolve: any, reject: any) { return this.all().then(resolve, reject) }
}

export class BancoCompativel {
  constructor(private pool: pg.Pool) {}

  /** Pool subjacente — usado pelo runner de migrations no boot. */
  get poolInterno(): pg.Pool { return this.pool }

  prepare(sql: string): Preparada {
    return new Preparada(this.pool, sql)
  }

  /** D1.batch é atômico — aqui vira uma transação real, o que o D1 não dá. */
  async batch<T = any>(stmts: Preparada[]): Promise<D1Result<T>[]> {
    const cliente = await this.pool.connect()
    try {
      await cliente.query('BEGIN')
      const out: D1Result<T>[] = []
      for (const s of stmts) out.push(await s._comCliente(cliente).all<T>())
      await cliente.query('COMMIT')
      return out
    } catch (e) {
      await cliente.query('ROLLBACK').catch(() => {})
      throw e
    } finally {
      cliente.release()
    }
  }

  async exec(sql: string): Promise<void> {
    await this.pool.query(traduzir(sql))
  }

  /**
   * Executa uma consulta arbitrária dentro de uma transação READ ONLY.
   *
   * É o que sustenta o console SQL do painel admin. Filtro por texto —
   * `startsWith('SELECT')` e afins — é sempre contornável: um comentário à
   * frente, uma CTE `WITH ... DELETE` (válida no Postgres), um segundo
   * statement. Aqui quem recusa a escrita é o próprio banco, então nenhuma
   * criatividade no texto da consulta muda o resultado.
   *
   * O timeout e o teto de linhas evitam que uma consulta distraída prenda uma
   * conexão do pool ou tente devolver a base inteira.
   */
  async consultaSomenteLeitura(
    sql: string,
    opts: { limite?: number; timeoutMs?: number } = {},
  ): Promise<any[]> {
    const limite = opts.limite ?? 500
    const timeoutMs = opts.timeoutMs ?? 5000
    const cliente = await this.pool.connect()
    try {
      await cliente.query('BEGIN READ ONLY')
      await cliente.query(`SET LOCAL statement_timeout = ${Number(timeoutMs)}`)
      const r = await cliente.query(sql)
      await cliente.query('COMMIT')
      return (r.rows || []).slice(0, limite + 1)
    } catch (e) {
      await cliente.query('ROLLBACK').catch(() => {})
      throw e
    } finally {
      cliente.release()
    }
  }
}

export function criarBanco(connectionString: string): BancoCompativel {
  const pool = new pg.Pool({
    connectionString,
    ssl: connectionString.includes('localhost') || connectionString.includes('127.0.0.1')
      ? false
      : { rejectUnauthorized: false },
    max: Number(process.env.PG_POOL_MAX ?? 10),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  })
  return new BancoCompativel(pool)
}
