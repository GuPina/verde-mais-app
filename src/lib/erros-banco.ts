/**
 * VerdeMais — tradução de erro de banco para resposta HTTP
 * ============================================================================
 * O app nasceu no SQLite/D1, onde a violação de unicidade vem com a palavra
 * "UNIQUE" na mensagem. As rotas checavam exatamente isso:
 *
 *     if (e?.message?.includes('UNIQUE')) return c.json({...}, 409)
 *
 * No Postgres a mensagem é outra — "duplicate key value violates unique
 * constraint" — e o código é `23505`. O `includes('UNIQUE')` passou a dar
 * falso, o erro escapou do catch e virou **HTTP 500**: criar uma tag com nome
 * repetido devolvia "Internal Server Error", como se o app tivesse quebrado.
 *
 * Aqui a checagem cobre os dois dialetos, para não depender de qual banco está
 * embaixo.
 */

/** Violação de índice único (nome repetido, e-mail repetido, etc). */
export function ehViolacaoUnicidade(e: any): boolean {
  if (!e) return false
  if (e.code === '23505') return true                    // Postgres
  const msg = String(e.message ?? e)
  return /unique constraint|duplicate key|UNIQUE/i.test(msg)  // Postgres + SQLite
}

/** Violação de chave estrangeira — referência para linha que não existe. */
export function ehViolacaoChaveEstrangeira(e: any): boolean {
  if (!e) return false
  if (e.code === '23503') return true
  return /foreign key/i.test(String(e.message ?? e))
}

/** Violação de NOT NULL. */
export function ehCampoObrigatorio(e: any): boolean {
  if (!e) return false
  if (e.code === '23502') return true
  return /not null|NOT NULL/i.test(String(e.message ?? e))
}
