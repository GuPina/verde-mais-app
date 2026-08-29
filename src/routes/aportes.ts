/**
 * VerdeMais — Aportes patrimoniais
 * ============================================================================
 * Um aporte é dinheiro que sai da conta corrente e vira patrimônio: entra num
 * investimento, numa reserva, numa caixinha. O saldo do mês cai, mas você não
 * ficou mais pobre — o dinheiro mudou de lugar.
 *
 * Por isso o aporte **não entra na soma de despesa** em lugar nenhum do app
 * (ver `src/lib/competencia.ts`). Só que tirá-lo das despesas sem mais nada
 * criaria um buraco: dinheiro que saiu da conta e não aparece em tela alguma.
 *
 * Esta rota é o outro lado dessa decisão. Ela responde, com os mesmos dados:
 * quanto você aportou no mês, para onde foi cada real e como isso vem
 * evoluindo — para o dinheiro sumir das despesas sem sumir da sua vista.
 */
import { Hono } from 'hono'
import { requireAuth } from './auth'
import { competenciaData, filtroApenasAporte, filtroCompetencia, filtroNaoCancelada, mesDoisDigitos } from '../lib/competencia'

type Bindings = { DB: D1Database }
type Variables = { user: { id: number; nome: string; email: string; plano: string } }

const aportes = new Hono<{ Bindings: Bindings; Variables: Variables }>()

// ─── GET /api/aportes?mes=8&ano=2026 ────────────────────────────────────────
aportes.get('/', requireAuth, async (c) => {
  const user = c.get('user')
  const hoje = new Date()
  // AP6: antes `?mes=abc` respondia 200 com periodo.mes:"abc". Agora valida.
  const mesRaw = c.req.query('mes')
  const anoRaw = c.req.query('ano')
  const mesNum = mesRaw === undefined ? hoje.getMonth() + 1 : parseInt(mesRaw, 10)
  const anoNum = anoRaw === undefined ? hoje.getFullYear() : parseInt(anoRaw, 10)
  if (!Number.isInteger(mesNum) || mesNum < 1 || mesNum > 12 || !Number.isInteger(anoNum) || anoNum < 2000 || anoNum > 2100)
    return c.json({ error: 'Período inválido: mes deve ser 1–12 e ano entre 2000 e 2100.' }, 400)
  const mes  = mesDoisDigitos(mesNum)
  const ano  = String(anoNum)

  const [lista, totalMes, totalAno, porDestino, evolucao, patrimonio] = await Promise.all([
    // Aportes do mês, do mais recente para o mais antigo
    c.env.DB.prepare(
      `SELECT id, descricao, valor, data, categoria, subcategoria, observacoes, meio_pagamento
       FROM despesas
       WHERE user_id = ?
         AND ${filtroNaoCancelada()}
         AND ${filtroApenasAporte()}
         AND ${filtroCompetencia()}
       ORDER BY data DESC, id DESC`
    ).bind(user.id, mes, ano).all(),

    c.env.DB.prepare(
      `SELECT COALESCE(SUM(valor),0) as total, COUNT(*) as qtd
       FROM despesas
       WHERE user_id = ?
         AND ${filtroNaoCancelada()}
         AND ${filtroApenasAporte()}
         AND ${filtroCompetencia()}`
    ).bind(user.id, mes, ano).first(),

    c.env.DB.prepare(
      `SELECT COALESCE(SUM(valor),0) as total, COUNT(*) as qtd
       FROM despesas
       WHERE user_id = ?
         AND ${filtroNaoCancelada()}
         AND ${filtroApenasAporte()}
         AND strftime('%Y', ${competenciaData()}) = ?`
    ).bind(user.id, ano).first(),

    // Para onde foi: agrupado pelo destino registrado na subcategoria
    c.env.DB.prepare(
      `SELECT COALESCE(NULLIF(subcategoria,''), 'Outros') as destino,
              COALESCE(SUM(valor),0) as total,
              COUNT(*) as qtd
       FROM despesas
       WHERE user_id = ?
         AND ${filtroNaoCancelada()}
         AND ${filtroApenasAporte()}
         AND strftime('%Y', ${competenciaData()}) = ?
       GROUP BY COALESCE(NULLIF(subcategoria,''), 'Outros')
       ORDER BY total DESC`
    ).bind(user.id, ano).all(),

    // Últimos 12 meses, para o gráfico
    c.env.DB.prepare(
      `SELECT strftime('%Y-%m', ${competenciaData()}) as ym,
              COALESCE(SUM(valor),0) as total
       FROM despesas
       WHERE user_id = ?
         AND ${filtroNaoCancelada()}
         AND ${filtroApenasAporte()}
         AND (${competenciaData()}) >= date('now','-12 months')
       GROUP BY ym
       ORDER BY ym`
    ).bind(user.id).all(),

    // O destino real do dinheiro, do outro lado: quanto virou patrimônio
    c.env.DB.prepare(
      `SELECT
         (SELECT COALESCE(SUM(valor_atual),0) FROM investimentos WHERE user_id = ?) as investimentos,
         (SELECT COALESCE(SUM(valor_atual),0) FROM reserva_emergencia WHERE user_id = ?) as reserva,
         (SELECT COALESCE(SUM(current_amount),0) FROM specialized_reserves
           WHERE user_id = ? AND status != 'cancelled') as reservas_esp`
    ).bind(user.id, user.id, user.id).first(),
  ])

  const t   = totalMes as any
  const ta  = totalAno as any
  const pat = patrimonio as any

  const investido = Number(pat?.investimentos || 0)
  const guardado  = Number(pat?.reserva || 0) + Number(pat?.reservas_esp || 0)

  return c.json({
    periodo: { mes, ano },
    resumo: {
      total_mes:  Math.round(Number(t?.total || 0) * 100) / 100,
      qtd_mes:    Number(t?.qtd || 0),
      total_ano:  Math.round(Number(ta?.total || 0) * 100) / 100,
      qtd_ano:    Number(ta?.qtd || 0),
      // Onde o dinheiro está agora
      patrimonio_investimentos: Math.round(investido * 100) / 100,
      patrimonio_reservas:      Math.round(guardado * 100) / 100,
      patrimonio_total:         Math.round((investido + guardado) * 100) / 100,
    },
    aportes:     lista.results || [],
    por_destino: porDestino.results || [],
    evolucao:    evolucao.results || [],
    explicacao:  'Aportes não entram na soma de despesas: o dinheiro saiu da conta, mas virou patrimônio seu. Aqui você acompanha para onde ele foi.',
  })
})

export default aportes
