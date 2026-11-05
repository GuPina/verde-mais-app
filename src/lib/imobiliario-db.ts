/**
 * VerdeMais — financiamento imobiliário, a parte que conversa com o banco.
 * O motor puro está em ./imobiliario.
 */
import { papelPorApelido, type Fin, type Pago, type Papel, type Linha } from './imobiliario'

type DB = D1Database

export function finDeLinha(r: any): Fin {
  const n = (v: any) => Number(v) || 0
  return {
    id: n(r.id), descricao: String(r.descricao || ''), banco: r.banco ?? null, construtora: r.construtora ?? null,
    tipo_financiamento: r.tipo_financiamento ?? null, tipo_bem: r.tipo_bem ?? null,
    valor_imovel: n(r.valor_imovel), valor_entrada: n(r.valor_entrada), valor_financiado: n(r.valor_financiado),
    saldo_devedor: n(r.saldo_devedor), valor_parcela: n(r.valor_parcela), taxa_juros_mensal: n(r.taxa_juros_mensal),
    numero_parcelas: n(r.numero_parcelas), parcelas_pagas: n(r.parcelas_pagas),
    sistema_amortizacao: r.sistema_amortizacao ?? null, data_inicio: r.data_inicio ?? null,
    data_chaves: r.data_chaves ?? null, evolucao_obra_pct: r.evolucao_obra_pct == null ? null : n(r.evolucao_obra_pct),
  }
}

/** O que foi (ou será) pago neste financiamento: vínculos + parcelas que ele mesmo gerou. */
export async function carregarPagos(db: DB, userId: number, finId: number): Promise<Pago[]> {
  const v = await db.prepare(
    `SELECT d.id, d.descricao, d.valor, COALESCE(d.data, d.vencimento) AS data, d.status, v.papel, d.parcela_atual, d.numero_parcelas
       FROM financiamento_vinculos v JOIN despesas d ON d.id = v.despesa_id
      WHERE v.financiamento_id = ? AND v.user_id = ? AND COALESCE(d.status, '') <> 'cancelado'`
  ).bind(finId, userId).all()
  const auto = await db.prepare(
    `SELECT id, descricao, valor, COALESCE(data, vencimento) AS data, status, parcela_atual, numero_parcelas FROM despesas
      WHERE user_id = ? AND observacoes LIKE ? AND COALESCE(status, '') <> 'cancelado'
        AND id NOT IN (SELECT despesa_id FROM financiamento_vinculos WHERE user_id = ?)`
  ).bind(userId, `%Financiamento automático #${finId} %`, userId).all()
  const norm = (r: any, papel: Papel, automatica = false): Pago => ({
    id: Number(r.id), descricao: String(r.descricao || ''), valor: Number(r.valor) || 0,
    data: String(r.data || '').slice(0, 10), status: r.status ?? null, papel, automatica,
    parcela_atual: r.parcela_atual == null ? null : Number(r.parcela_atual),
    numero_parcelas: r.numero_parcelas == null ? null : Number(r.numero_parcelas),
  })
  return [
    ...((v.results || []) as any[]).map(r => norm(r, r.papel as Papel)),
    ...((auto.results || []) as any[]).map(r => norm(r, 'parcela', true)),
  ]
}

export async function carregarApelidos(db: DB, userId: number, finId?: number) {
  const r = finId
    ? await db.prepare(`SELECT financiamento_id, papel, texto FROM financiamento_apelidos WHERE user_id = ? AND financiamento_id = ?`).bind(userId, finId).all()
    : await db.prepare(`SELECT financiamento_id, papel, texto FROM financiamento_apelidos WHERE user_id = ?`).bind(userId).all()
  return ((r.results || []) as any[]).map(x => ({ financiamento_id: Number(x.financiamento_id), papel: x.papel as Papel, texto: String(x.texto) }))
}

/** Despesas candidatas: as dos últimos 5 anos e as futuras, com o vínculo que já tiverem. */
export async function carregarLinhas(db: DB, userId: number, desde: string): Promise<Linha[]> {
  const r = await db.prepare(
    `SELECT d.id, d.descricao, d.valor, COALESCE(d.data, d.vencimento) AS data, d.categoria, d.observacoes, d.status,
            d.parcela_atual, d.numero_parcelas, d.purchase_group_id,
            (SELECT cc.data_compra FROM card_charges cc WHERE cc.expense_id = d.id LIMIT 1) AS data_compra,
            v.financiamento_id
       FROM despesas d LEFT JOIN financiamento_vinculos v ON v.despesa_id = d.id
      WHERE d.user_id = ? AND COALESCE(d.status, '') <> 'cancelado' AND COALESCE(d.data, d.vencimento) >= ?`
  ).bind(userId, desde).all()
  return ((r.results || []) as any[]).map(x => ({ ...x, id: Number(x.id), valor: Number(x.valor) || 0, data: String(x.data || '').slice(0, 10),
    financiamento_id: x.financiamento_id == null ? null : Number(x.financiamento_id) }))
}

export async function vincular(db: DB, userId: number, finId: number, despesaId: number, papel: Papel) {
  await db.prepare(
    `INSERT INTO financiamento_vinculos (despesa_id, financiamento_id, user_id, papel)
     SELECT id, ?, ?, ? FROM despesas WHERE id = ? AND user_id = ?
     ON CONFLICT (despesa_id) DO NOTHING`
  ).bind(finId, userId, papel, despesaId, userId).run()
}

/**
 * Lançamento que entra com um nome já confirmado para um papel de UM
 * financiamento entra vinculado. Dois financiamentos com o mesmo apelido:
 * não adivinha. Nunca lança — a despesa já foi salva.
 */
export async function autoVincularFinanciamento(db: DB, userId: number, ids: number[]) {
  const feitos: Array<{ despesa_id: number; financiamento_id: number; papel: Papel }> = []
  try {
    const alvo = ids.map(Number).filter(n => Number.isInteger(n) && n > 0)
    if (!alvo.length) return feitos
    const apelidos = await carregarApelidos(db, userId)
    if (!apelidos.length) return feitos
    for (let i = 0; i < alvo.length; i += 400) {
      const fatia = alvo.slice(i, i + 400)
      const r = await db.prepare(
        `SELECT d.id, d.descricao FROM despesas d
          WHERE d.user_id = ? AND d.id IN (${fatia.map(() => '?').join(',')})
            AND NOT EXISTS (SELECT 1 FROM financiamento_vinculos v WHERE v.despesa_id = d.id)`
      ).bind(userId, ...fatia).all()
      for (const d of (r.results || []) as any[]) {
        const hit = papelPorApelido(String(d.descricao || ''), apelidos)
        if (!hit) continue
        await vincular(db, userId, hit.financiamento_id, Number(d.id), hit.papel)
        feitos.push({ despesa_id: Number(d.id), financiamento_id: hit.financiamento_id, papel: hit.papel })
      }
    }
  } catch (e) {
    console.error('[imobiliario] autoVincularFinanciamento falhou:', (e as Error)?.message)
  }
  return feitos
}
