/**
 * Juros de uma compra parcelada, gravados parcela a parcela em
 * `despesas.valor_juros`. O grupo é o `purchase_group_id` da compra.
 */
import { separarJuros, type Separacao } from './juros'

/**
 * Grava (ou limpa, com `aVista` null) os juros de todas as parcelas do grupo.
 * Parcelas que não estão no banco (compra cadastrada a partir da 3ª, por
 * exemplo) entram na conta com o valor típico, para a taxa sair certa.
 */
export async function registrarJurosDoGrupo(
  db: D1Database, userId: number, groupId: string, aVista: number | null,
): Promise<(Separacao & { parcelas: number }) | { limpo: true } | null> {
  const r = await db.prepare(
    `SELECT id, valor, parcela_atual, numero_parcelas FROM despesas
      WHERE user_id = ? AND purchase_group_id = ? AND COALESCE(status, '') <> 'cancelado'
      ORDER BY parcela_atual`
  ).bind(userId, groupId).all()
  const rows = (r.results || []) as any[]
  if (!rows.length) return null
  if (aVista === null) {
    await db.prepare(`UPDATE despesas SET valor_juros = NULL WHERE user_id = ? AND purchase_group_id = ?`).bind(userId, groupId).run()
    return { limpo: true }
  }
  const n = Math.max(...rows.map(x => Number(x.numero_parcelas) || 1), rows.length)
  const valores = rows.map(x => Number(x.valor)).sort((a, b) => a - b)
  const tipico = valores[Math.floor(valores.length / 2)]
  const porNumero = new Map(rows.map(x => [Number(x.parcela_atual) || 1, Number(x.valor)]))
  const pmts = Array.from({ length: n }, (_, k) => porNumero.get(k + 1) ?? tipico)
  const sep = separarJuros(aVista, pmts)
  if (!sep) return null
  for (const x of rows) {
    const k = (Number(x.parcela_atual) || 1) - 1
    await db.prepare(`UPDATE despesas SET valor_juros = ? WHERE id = ? AND user_id = ?`).bind(sep.juros[k] ?? 0, x.id, userId).run()
  }
  return { ...sep, parcelas: n }
}

/** Rendimento mensal da reserva: 100% do CDI, do cache do BCB; 13,65% a.a. sem cache. */
export async function rendimentoMensalReserva(db: D1Database): Promise<{ mensal: number; cdi_anual: number; fonte: string }> {
  let anual = 13.65, fonte = 'CDI padrão de 13,65% a.a.'
  try {
    const row = await db.prepare(`SELECT taxa, data FROM cdi_historico ORDER BY data DESC LIMIT 1`).first() as any
    if (row?.taxa) { anual = (Math.pow(1 + Number(row.taxa) / 100, 252) - 1) * 100; fonte = `CDI de ${String(row.data).slice(0, 10)}` }
  } catch { /* sem tabela, fica o padrão */ }
  return { mensal: Math.pow(1 + anual / 100, 1 / 12) - 1, cdi_anual: Math.round(anual * 100) / 100, fonte }
}
