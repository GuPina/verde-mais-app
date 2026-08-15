/**
 * VerdeMais — tipos globais
 * ============================================================================
 * O projeto usava `@cloudflare/workers-types` só por causa de três nomes:
 * D1Database (74 usos), D1Result (5) e ExecutionContext (1). Rodando em Node
 * no Render, arrastar o pacote inteiro de tipos do runtime da Cloudflare para
 * obter três interfaces não se justifica.
 *
 * As assinaturas abaixo descrevem exatamente o que `src/lib/d1-compat.ts`
 * implementa — o contrato que as ~1.200 queries já consomem. Manter o nome
 * `D1Database` é intencional: evita renomear 74 pontos do código sem ganho.
 */

interface D1Meta {
  /** id gerado no INSERT (via RETURNING id); null quando não se aplica */
  last_row_id: number | null
  changes: number
  duration: number
}

interface D1Result<T = any> {
  results: T[]
  success: boolean
  meta: D1Meta
}

interface D1PreparedStatement {
  bind(...valores: any[]): D1PreparedStatement
  first<T = any>(): Promise<T | null>
  all<T = any>(): Promise<D1Result<T>>
  run<T = any>(): Promise<D1Result<T>>
}

interface D1Database {
  prepare(sql: string): D1PreparedStatement
  /** Executa em transação e devolve os resultados na mesma ordem. */
  batch<T = any>(stmts: D1PreparedStatement[]): Promise<D1Result<T>[]>
  exec(sql: string): Promise<void>
}

/**
 * Existia no runtime da Cloudflare (waitUntil/passThroughOnException). Em Node
 * não há equivalente: o Hono recebe `undefined` no lugar, e o código não deve
 * depender disso.
 */
interface ExecutionContext {
  waitUntil(promise: Promise<any>): void
  passThroughOnException(): void
}
