/**
 * VerdeMais — aplicação de migrations no boot
 * ============================================================================
 * Por que no boot e não num passo separado: o plano free do Render não tem
 * shell nem one-off jobs. Sem isto, a única forma de aplicar schema seria
 * alguém rodar da própria máquina apontando para o banco de produção — que é
 * exatamente o que queremos evitar como rotina.
 *
 * Garantias:
 *   • Advisory lock — se houver mais de uma instância subindo ao mesmo tempo,
 *     só uma aplica; as outras esperam e seguem.
 *   • Uma transação por arquivo — falhou no meio, nada daquele arquivo fica.
 *   • Falha para. Se uma migration quebra, o processo sai com código 1 em vez
 *     de servir requisições sobre um schema pela metade.
 *   • Idempotente: registra o que já aplicou em `schema_migrations`.
 *
 * `SKIP_MIGRATIONS=1` desliga, para o caso de você querer aplicar à mão.
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import type pg from 'pg'

/** Mesmo número em todas as instâncias — é o que as serializa. */
const LOCK_ID = 4_755_212

export interface ResultadoMigracao {
  aplicadas: string[]
  jaAplicadas: number
  puladas: boolean
}

export async function aplicarMigrations(pool: pg.Pool, diretorio: string): Promise<ResultadoMigracao> {
  if (process.env.SKIP_MIGRATIONS === '1') {
    console.log('· migrations: puladas (SKIP_MIGRATIONS=1)')
    return { aplicadas: [], jaAplicadas: 0, puladas: true }
  }

  if (!fs.existsSync(diretorio)) {
    throw new Error(`diretório de migrations não encontrado: ${diretorio}`)
  }

  const cli = await pool.connect()
  try {
    // Serializa entre instâncias. O lock cai sozinho quando a conexão fecha.
    await cli.query('SELECT pg_advisory_lock($1)', [LOCK_ID])

    await cli.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        versao      text PRIMARY KEY,
        hash        text NOT NULL,
        aplicada_em timestamptz NOT NULL DEFAULT now()
      )`)

    const arquivos = fs.readdirSync(diretorio).filter(f => f.endsWith('.sql')).sort()
    const { rows } = await cli.query('SELECT versao, hash FROM schema_migrations')
    const aplicadas = new Map<string, string>(rows.map((r: any) => [r.versao, r.hash]))

    const feitas: string[] = []
    for (const arquivo of arquivos) {
      const sql = fs.readFileSync(path.join(diretorio, arquivo), 'utf8')
      const hash = crypto.createHash('sha256').update(sql).digest('hex').slice(0, 16)
      const anterior = aplicadas.get(arquivo)

      if (anterior !== undefined) {
        if (anterior !== hash) {
          // Não é erro fatal — o schema já está aplicado —, mas é sintoma de
          // migration editada depois de aplicada, que diverge entre ambientes.
          console.warn(`⚠ migration ${arquivo} foi editada depois de aplicada (hash mudou). Crie uma nova em vez de alterar.`)
        }
        continue
      }

      process.stdout.write(`· migration ${arquivo} … `)
      try {
        await cli.query('BEGIN')
        await cli.query(sql)
        await cli.query('INSERT INTO schema_migrations (versao, hash) VALUES ($1, $2)', [arquivo, hash])
        await cli.query('COMMIT')
        console.log('ok')
        feitas.push(arquivo)
      } catch (e: any) {
        await cli.query('ROLLBACK').catch(() => {})
        console.log('FALHOU')
        throw new Error(`migration ${arquivo}: ${e.message}`)
      }
    }

    return { aplicadas: feitas, jaAplicadas: aplicadas.size, puladas: false }
  } finally {
    await cli.query('SELECT pg_advisory_unlock($1)', [LOCK_ID]).catch(() => {})
    cli.release()
  }
}
