/**
 * VerdeMais — recorrências, a parte que conversa com o banco
 * ============================================================================
 * O motor (./recorrencias) é puro. Aqui ficam as consultas que o alimentam e
 * o vínculo automático que roda quando um lançamento entra — pela tela de
 * Despesas, de Receitas, de Cartões ou pela importação.
 *
 * ── QUANDO O VÍNCULO É AUTOMÁTICO ────────────────────────────────────────────
 *
 * Só quando as três coisas valem ao mesmo tempo:
 *
 *   1. a regra da recorrência casa por inteiro (texto, valor, dia, cartão);
 *   2. só UMA recorrência casa — duas candidatas é decisão da pessoa;
 *   3. o mês ainda não tem lançamento vinculado a ela.
 *
 * Qualquer outra situação vira sugestão no rastreio, nunca escrita silenciosa.
 * Vincular errado é pior que não vincular: o mês certo some da linha do tempo
 * e o errado aparece pago.
 */

import {
  casaRegra, regraPadrao, temDono,
  type Lancamento, type Recorrencia, type Regra, type TipoRec,
} from './recorrencias'

type DB = D1Database

/** Hoje no Brasil (UTC−3). O servidor roda em UTC: às 22h já seria amanhã. */
export function hojeBR(): string {
  return new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10)
}

export function somarMesesISO(iso: string, n: number): string {
  let [a, m] = iso.slice(0, 7).split('-').map(Number)
  m += n
  while (m > 12) { m -= 12; a++ }
  while (m < 1) { m += 12; a-- }
  return `${a}-${String(m).padStart(2, '0')}-01`
}

export function regraDeLinha(row: any): Regra {
  return {
    texto: String(row.texto || ''),
    modo: ['contem', 'comeca', 'igual'].includes(row.modo) ? row.modo : 'contem',
    tol_valor_pct: row.tol_valor_pct == null ? null : Number(row.tol_valor_pct),
    tol_dias: Number.isFinite(Number(row.tol_dias)) ? Number(row.tol_dias) : 5,
    cartao_id: row.cartao_id == null ? null : Number(row.cartao_id),
    auto_vincular: Number(row.auto_vincular ?? 1) === 1,
    apelidos: lerApelidos(row.apelidos),
  }
}

function lerApelidos(v: unknown): string[] {
  if (!v) return []
  try { const a = JSON.parse(String(v)); return Array.isArray(a) ? a.map(String).filter(Boolean) : [] } catch { return [] }
}

export function recorrenciaDeLinha(row: any): Recorrencia {
  return {
    id: Number(row.id), tipo: row.tipo, descricao: String(row.descricao || ''),
    valor: Number(row.valor) || 0, categoria: row.categoria ?? null,
    dia_vencimento: Number(row.dia_vencimento) || 1,
    valor_variavel: Number(row.valor_variavel) === 1,
    ativa: Number(row.ativa ?? 1) === 1,
    data_inicio: row.data_inicio ?? null, data_fim: row.data_fim ?? null,
  }
}

export async function carregarRegras(db: DB, userId: number): Promise<Map<number, Regra>> {
  const r = await db.prepare(`SELECT * FROM recorrencia_regras WHERE user_id = ?`).bind(userId).all()
  const out = new Map<number, Regra>()
  for (const row of (r.results || []) as any[]) out.set(Number(row.recorrencia_id), regraDeLinha(row))
  return out
}

export async function carregarDispensas(db: DB, userId: number): Promise<Set<string>> {
  const r = await db.prepare(`SELECT chave FROM recorrencia_dispensas WHERE user_id = ?`).bind(userId).all()
  return new Set(((r.results || []) as any[]).map(x => String(x.chave)))
}

export async function carregarRecorrencias(db: DB, userId: number, tipo?: TipoRec): Promise<Recorrencia[]> {
  const r = tipo
    ? await db.prepare(`SELECT * FROM recorrencias WHERE user_id = ? AND tipo = ?`).bind(userId, tipo).all()
    : await db.prepare(`SELECT * FROM recorrencias WHERE user_id = ?`).bind(userId).all()
  return ((r.results || []) as any[]).map(recorrenciaDeLinha)
}

const COLS_DESPESA = `id, descricao, valor, COALESCE(data, vencimento) AS data, status, observacoes,
  recorrencia_id, numero_parcelas, parcelado, cartao_id, categoria, meio_pagamento`
const COLS_RECEITA = `id, descricao, valor, data, NULL AS status, observacoes,
  recorrencia_id, NULL AS numero_parcelas, NULL AS parcelado, NULL AS cartao_id, categoria, meio_pagamento`

const normalizar = (rows: any[]): Lancamento[] => rows.map(l => ({
  ...l, id: Number(l.id), valor: Number(l.valor) || 0, data: String(l.data || '').slice(0, 10),
}))

/** Lançamentos do tipo a partir de uma data. Despesa cancelada não conta. */
export async function carregarLancamentos(db: DB, userId: number, tipo: TipoRec, desde: string): Promise<Lancamento[]> {
  const r = tipo === 'despesa'
    ? await db.prepare(
        `SELECT ${COLS_DESPESA} FROM despesas
          WHERE user_id = ? AND COALESCE(status, '') <> 'cancelado'
            AND COALESCE(data, vencimento) >= ?`).bind(userId, desde).all()
    : await db.prepare(
        `SELECT ${COLS_RECEITA} FROM receitas WHERE user_id = ? AND data >= ?`).bind(userId, desde).all()
  return normalizar((r.results || []) as any[])
}

/** Tudo o que está vinculado a uma recorrência, sem limite de data. */
export async function carregarVinculados(db: DB, userId: number, rec: Recorrencia): Promise<Lancamento[]> {
  const r = rec.tipo === 'despesa'
    ? await db.prepare(
        `SELECT ${COLS_DESPESA} FROM despesas
          WHERE user_id = ? AND recorrencia_id = ? AND COALESCE(status, '') <> 'cancelado'`).bind(userId, rec.id).all()
    : await db.prepare(
        `SELECT ${COLS_RECEITA} FROM receitas WHERE user_id = ? AND recorrencia_id = ?`).bind(userId, rec.id).all()
  return normalizar((r.results || []) as any[])
}

export const tabelaDe = (tipo: TipoRec) => (tipo === 'despesa' ? 'despesas' : 'receitas')

/** Maior id da tabela para o usuário — tirado antes de uma importação. */
export async function maiorId(db: DB, userId: number, tipo: TipoRec): Promise<number> {
  const r = await db.prepare(`SELECT COALESCE(MAX(id), 0) AS m FROM ${tabelaDe(tipo)} WHERE user_id = ?`).bind(userId).first() as any
  return Number(r?.m) || 0
}

export async function mesOcupado(db: DB, userId: number, tipo: TipoRec, recId: number, data: string, excetoId?: number) {
  const col = tipo === 'despesa' ? 'COALESCE(data, vencimento)' : 'data'
  const st = tipo === 'despesa' ? `AND COALESCE(status, '') <> 'cancelado'` : ''
  const r = await db.prepare(
    `SELECT id FROM ${tabelaDe(tipo)}
      WHERE user_id = ? AND recorrencia_id = ? AND substr(${col}, 1, 7) = ? AND id <> ? ${st} LIMIT 1`
  ).bind(userId, recId, data.slice(0, 7), excetoId ?? 0).first()
  return !!r
}

export interface ResultadoAuto {
  vinculados: Array<{ lancamento_id: number; recorrencia_id: number; recorrencia: string }>
  sugestoes: Array<{ lancamento_id: number; recorrencia_id: number; recorrencia: string; motivo: 'mes_ocupado' | 'ambiguo' | 'parcial' }>
}

/**
 * Vincula, se for o caso, os lançamentos recém-criados à sua recorrência.
 * Nunca lança: um erro aqui não pode desfazer a despesa que a pessoa salvou.
 */
export async function autoVincular(db: DB, userId: number, tipo: TipoRec, ids: number[]): Promise<ResultadoAuto> {
  const out: ResultadoAuto = { vinculados: [], sugestoes: [] }
  try {
    const alvo = ids.map(Number).filter(n => Number.isInteger(n) && n > 0)
    if (!alvo.length) return out
    const recs = (await carregarRecorrencias(db, userId, tipo)).filter(r => r.ativa)
    if (!recs.length) return out
    const regras = await carregarRegras(db, userId)
    const regraDe = (r: Recorrencia) => regras.get(r.id) || regraPadrao(r)
    const cols = tipo === 'despesa' ? COLS_DESPESA : COLS_RECEITA

    for (let i = 0; i < alvo.length; i += 400) {
      const fatia = alvo.slice(i, i + 400)
      const r = await db.prepare(
        `SELECT ${cols} FROM ${tabelaDe(tipo)}
          WHERE user_id = ? AND recorrencia_id IS NULL AND id IN (${fatia.map(() => '?').join(',')})`
      ).bind(userId, ...fatia).all()

      for (const l of normalizar((r.results || []) as any[])) {
        if (temDono(l)) continue
        if (tipo === 'despesa' && l.status === 'cancelado') continue
        const casos = recs
          .filter(rec => (!rec.data_inicio || l.data.slice(0, 7) >= String(rec.data_inicio).slice(0, 7))
                      && (!rec.data_fim || l.data <= String(rec.data_fim).slice(0, 10)))
          .map(rec => ({ rec, regra: regraDe(rec), m: casaRegra(l, rec, regraDe(rec)) }))
        const totais = casos.filter(x => x.m.total)
        if (totais.length > 1) {
          for (const x of totais) out.sugestoes.push({ lancamento_id: l.id, recorrencia_id: x.rec.id, recorrencia: x.rec.descricao, motivo: 'ambiguo' })
          continue
        }
        if (totais.length === 0) {
          const parcial = casos.filter(x => x.m.texto && (x.m.valor || x.m.dia))
          if (parcial.length === 1) out.sugestoes.push({ lancamento_id: l.id, recorrencia_id: parcial[0].rec.id, recorrencia: parcial[0].rec.descricao, motivo: 'parcial' })
          continue
        }
        const { rec, regra } = totais[0]
        if (!regra.auto_vincular) {
          out.sugestoes.push({ lancamento_id: l.id, recorrencia_id: rec.id, recorrencia: rec.descricao, motivo: 'parcial' })
          continue
        }
        if (await mesOcupado(db, userId, tipo, rec.id, l.data, l.id)) {
          out.sugestoes.push({ lancamento_id: l.id, recorrencia_id: rec.id, recorrencia: rec.descricao, motivo: 'mes_ocupado' })
          continue
        }
        await db.prepare(
          `UPDATE ${tabelaDe(tipo)} SET recorrencia_id = ?, recorrente = 1
            WHERE id = ? AND user_id = ? AND recorrencia_id IS NULL`
        ).bind(rec.id, l.id, userId).run()
        out.vinculados.push({ lancamento_id: l.id, recorrencia_id: rec.id, recorrencia: rec.descricao })
      }
    }
  } catch (e) {
    console.error('[recorrencias] autoVincular falhou:', (e as Error)?.message)
  }
  return out
}

/** Para depois de uma importação: vincula tudo o que entrou acima de `depoisDe`. */
export async function autoVincularDesde(db: DB, userId: number, tipo: TipoRec, depoisDe: number): Promise<ResultadoAuto> {
  try {
    const r = await db.prepare(
      `SELECT id FROM ${tabelaDe(tipo)} WHERE user_id = ? AND id > ? AND recorrencia_id IS NULL`
    ).bind(userId, depoisDe).all()
    return autoVincular(db, userId, tipo, ((r.results || []) as any[]).map(x => Number(x.id)))
  } catch (e) {
    console.error('[recorrencias] autoVincularDesde falhou:', (e as Error)?.message)
    return { vinculados: [], sugestoes: [] }
  }
}
