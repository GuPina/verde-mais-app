import { Hono } from 'hono'
import { requireAuth } from './auth'

type Bindings = { DB: D1Database }
type Variables = { user: { id: number; nome: string; plano: string } }

const recorrencias = new Hono<{ Bindings: Bindings; Variables: Variables }>()

// ─── GET /api/recorrencias ────────────────────────────────────────────────────
recorrencias.get('/', requireAuth, async (c) => {
  const user = c.get('user')
  const tipo = c.req.query('tipo') || ''

  let sql = `SELECT * FROM recorrencias WHERE user_id = ?`
  const params: any[] = [user.id]
  if (tipo) { sql += ` AND tipo = ?`; params.push(tipo) }
  sql += ` ORDER BY ativa DESC, dia_vencimento ASC`

  const result = await c.env.DB.prepare(sql).bind(...params).all()
  const rows   = result.results as any[]

  const hoje = new Date()
  const mes  = hoje.getMonth() + 1
  const ano  = hoje.getFullYear()

  // Para cada recorrência, verifica se já foi gerada este mês
  const enriched = rows.map(r => ({
    ...r,
    valor: Number(r.valor),
    gerada_mes_atual: r.ultimo_gerado
      ? r.ultimo_gerado >= `${ano}-${String(mes).padStart(2,'0')}-01`
      : false
  }))

  const resumo = {
    total: rows.length,
    ativas: rows.filter(r => r.ativa).length,
    total_despesas: rows.filter(r => r.tipo === 'despesa' && r.ativa).reduce((s, r) => s + Number(r.valor), 0),
    total_receitas: rows.filter(r => r.tipo === 'receita' && r.ativa).reduce((s, r) => s + Number(r.valor), 0),
  }

  return c.json({ recorrencias: enriched, resumo })
})

// ─── POST /api/recorrencias ───────────────────────────────────────────────────
recorrencias.post('/', requireAuth, async (c) => {
  const user = c.get('user')

  if (user.plano === 'free') {
    return c.json({
      error: 'Recorrências automáticas são exclusivas do plano Premium.',
      upgrade: true, feature: 'recorrencias'
    }, 403)
  }

  const body = await c.req.json()
  const { tipo, descricao, valor, categoria, dia_vencimento,
          meio_pagamento = 'outros', data_fim = null } = body

  if (!tipo || !descricao || !valor || !categoria || !dia_vencimento) {
    return c.json({ error: 'Campos obrigatórios: tipo, descricao, valor, categoria, dia_vencimento' }, 400)
  }
  if (!['despesa', 'receita'].includes(tipo)) {
    return c.json({ error: 'tipo deve ser: despesa ou receita' }, 400)
  }
  if (Number(valor) <= 0) {
    return c.json({ error: 'Valor deve ser maior que zero' }, 400)
  }

  const res = await c.env.DB.prepare(
    `INSERT INTO recorrencias (user_id, tipo, descricao, valor, categoria, dia_vencimento, meio_pagamento, data_fim)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(user.id, tipo, descricao, valor, categoria, dia_vencimento, meio_pagamento, data_fim).run()

  // Conquista
  await verificarConquista(c.env.DB, user.id, 'automatico')

  // Conquista 5+ recorrências
  const count = await c.env.DB.prepare(
    `SELECT COUNT(*) as n FROM recorrencias WHERE user_id = ? AND ativa = 1`
  ).bind(user.id).first() as any
  if ((count?.n || 0) >= 5) await verificarConquista(c.env.DB, user.id, 'recorrente_pro')

  return c.json({ success: true, id: res.meta.last_row_id })
})

// ─── PUT /api/recorrencias/:id ────────────────────────────────────────────────
recorrencias.put('/:id', requireAuth, async (c) => {
  const user = c.get('user')
  const id   = c.req.param('id')

  const rec = await c.env.DB.prepare(
    `SELECT id FROM recorrencias WHERE id = ? AND user_id = ?`
  ).bind(id, user.id).first()
  if (!rec) return c.json({ error: 'Recorrência não encontrada' }, 404)

  const { descricao, valor, categoria, dia_vencimento, meio_pagamento, data_fim } = await c.req.json()

  await c.env.DB.prepare(
    `UPDATE recorrencias SET descricao=?, valor=?, categoria=?, dia_vencimento=?, meio_pagamento=?, data_fim=?
     WHERE id = ? AND user_id = ?`
  ).bind(descricao, valor, categoria, dia_vencimento, meio_pagamento, data_fim, id, user.id).run()

  return c.json({ success: true })
})

// ─── PATCH /api/recorrencias/:id/toggle ──────────────────────────────────────
recorrencias.patch('/:id/toggle', requireAuth, async (c) => {
  const user = c.get('user')
  const id   = c.req.param('id')

  const rec = await c.env.DB.prepare(
    `SELECT id, ativa FROM recorrencias WHERE id = ? AND user_id = ?`
  ).bind(id, user.id).first() as any
  if (!rec) return c.json({ error: 'Recorrência não encontrada' }, 404)

  const nova = rec.ativa ? 0 : 1
  await c.env.DB.prepare(`UPDATE recorrencias SET ativa = ? WHERE id = ?`).bind(nova, id).run()

  return c.json({ success: true, ativa: nova === 1 })
})

// ─── DELETE /api/recorrencias/:id ────────────────────────────────────────────
recorrencias.delete('/:id', requireAuth, async (c) => {
  const user = c.get('user')
  const id   = c.req.param('id')

  await c.env.DB.prepare(
    `DELETE FROM recorrencias WHERE id = ? AND user_id = ?`
  ).bind(id, user.id).run()

  return c.json({ success: true })
})

// ─── POST /api/recorrencias/processar ── gera transações do dia ───────────────
// Chamada diária (pode ser via cron ou manualmente)
recorrencias.post('/processar', requireAuth, async (c) => {
  const user = c.get('user')
  const body = await c.req.json().catch(() => ({})) as any

  // Suporta processar mês específico (ex: {mes: 3, ano: 2026}) ou mês atual
  const hoje = new Date()
  const mes  = body.mes  ? parseInt(body.mes)  : (hoje.getMonth() + 1)
  const ano  = body.ano  ? parseInt(body.ano)  : hoje.getFullYear()
  const mesStr   = String(mes).padStart(2, '0')
  const mesRef   = `${ano}-${mesStr}-01`
  const dataHoje = hoje.toISOString().split('T')[0]

  // Busca TODAS as recorrências ativas que ainda não foram geradas este mês
  const pendentes = await c.env.DB.prepare(
    `SELECT * FROM recorrencias
     WHERE user_id = ? AND ativa = 1
       AND (data_fim IS NULL OR date(data_fim) >= ?)
       AND (ultimo_gerado IS NULL OR ultimo_gerado < ?)`
  ).bind(user.id, mesRef, mesRef).all()

  let geradas = 0
  const geradasItems: any[] = []
  for (const rec of (pendentes.results as any[])) {
    const lastDay = new Date(ano, mes, 0).getDate()
    const dia = Math.min(rec.dia_vencimento || 1, lastDay)
    const dataVenc = `${ano}-${mesStr}-${String(dia).padStart(2,'0')}`

    if (rec.tipo === 'despesa') {
      const existe = await c.env.DB.prepare(
        `SELECT id FROM despesas WHERE user_id=? AND descricao LIKE ? AND strftime('%Y-%m',data)=? LIMIT 1`
      ).bind(user.id, rec.descricao + '%', `${ano}-${mesStr}`).first()
      if (existe) continue

      await c.env.DB.prepare(
        `INSERT INTO despesas (user_id, descricao, valor, categoria, vencimento, data, status, meio_pagamento, parcelado, numero_parcelas, parcela_atual, recorrente)
         VALUES (?, ?, ?, ?, ?, ?, 'pendente', ?, 0, 1, 1, 1)`
      ).bind(user.id, rec.descricao + ' (Auto)', rec.valor, rec.categoria, dataVenc, dataVenc, rec.meio_pagamento || 'outros').run()
      geradasItems.push({ tipo: 'despesa', descricao: rec.descricao, valor: rec.valor })
    } else {
      const existe = await c.env.DB.prepare(
        `SELECT id FROM receitas WHERE user_id=? AND descricao LIKE ? AND strftime('%Y-%m',data)=? LIMIT 1`
      ).bind(user.id, rec.descricao + '%', `${ano}-${mesStr}`).first()
      if (existe) continue

      await c.env.DB.prepare(
        `INSERT INTO receitas (user_id, descricao, valor, categoria, data, recorrente)
         VALUES (?, ?, ?, ?, ?, 1)`
      ).bind(user.id, rec.descricao + ' (Auto)', rec.valor, rec.categoria, dataVenc).run()
      geradasItems.push({ tipo: 'receita', descricao: rec.descricao, valor: rec.valor })
    }

    await c.env.DB.prepare(
      `UPDATE recorrencias SET ultimo_gerado = ?, total_gerado = total_gerado + 1 WHERE id = ?`
    ).bind(dataHoje, rec.id).run()
    geradas++
  }

  return c.json({ success: true, geradas, mes, ano, items: geradasItems })
})

// ─── POST /api/recorrencias/processar-mes ── gera transações para mês futuro ──
recorrencias.post('/processar-mes', requireAuth, async (c) => {
  const user = c.get('user')
  const { mes, ano } = await c.req.json()
  if (!mes || !ano) return c.json({ error: 'mes e ano são obrigatórios' }, 400)

  const mesInt  = parseInt(mes)
  const anoInt  = parseInt(ano)
  const mesStr  = String(mesInt).padStart(2, '0')
  const mesRef  = `${anoInt}-${mesStr}-01`
  const dataHoje = new Date().toISOString().split('T')[0]

  const pendentes = await c.env.DB.prepare(
    `SELECT * FROM recorrencias
     WHERE user_id = ? AND ativa = 1
       AND (data_fim IS NULL OR date(data_fim) >= ?)`
  ).bind(user.id, mesRef).all()

  let geradas = 0
  for (const rec of (pendentes.results as any[])) {
    const lastDay = new Date(anoInt, mesInt, 0).getDate()
    const dia = Math.min(rec.dia_vencimento || 1, lastDay)
    const dataVenc = `${anoInt}-${mesStr}-${String(dia).padStart(2,'0')}`

    if (rec.tipo === 'despesa') {
      const existe = await c.env.DB.prepare(
        `SELECT id FROM despesas WHERE user_id=? AND descricao LIKE ? AND strftime('%Y-%m',data)=? LIMIT 1`
      ).bind(user.id, rec.descricao + '%', `${anoInt}-${mesStr}`).first()
      if (existe) continue
      await c.env.DB.prepare(
        `INSERT INTO despesas (user_id, descricao, valor, categoria, vencimento, data, status, meio_pagamento, parcelado, numero_parcelas, parcela_atual, recorrente)
         VALUES (?, ?, ?, ?, ?, ?, 'pendente', ?, 0, 1, 1, 1)`
      ).bind(user.id, rec.descricao + ' (Auto)', rec.valor, rec.categoria, dataVenc, dataVenc, rec.meio_pagamento || 'outros').run()
    } else {
      const existe = await c.env.DB.prepare(
        `SELECT id FROM receitas WHERE user_id=? AND descricao LIKE ? AND strftime('%Y-%m',data)=? LIMIT 1`
      ).bind(user.id, rec.descricao + '%', `${anoInt}-${mesStr}`).first()
      if (existe) continue
      await c.env.DB.prepare(
        `INSERT INTO receitas (user_id, descricao, valor, categoria, data, recorrente)
         VALUES (?, ?, ?, ?, ?, 1)`
      ).bind(user.id, rec.descricao + ' (Auto)', rec.valor, rec.categoria, dataVenc).run()
    }
    geradas++
  }

  return c.json({ success: true, geradas, mes: mesInt, ano: anoInt })
})

async function verificarConquista(db: D1Database, userId: number, codigo: string) {
  await db.prepare(
    `INSERT OR IGNORE INTO conquistas_usuario (user_id, conquista_codigo, data_conquista, visualizado)
     VALUES (?, ?, datetime('now'), 0)`
  ).bind(userId, codigo).run()
}

export default recorrencias
