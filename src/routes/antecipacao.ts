import { Hono } from 'hono'
import { requireAuth } from './auth'

type Bindings = { DB: D1Database }
type Variables = { user: { id: number; nome: string; plano: string } }

const antecipacao = new Hono<{ Bindings: Bindings; Variables: Variables }>()

// ── GET /api/antecipacao — listar antecipações ────────────────────────────
antecipacao.get('/', requireAuth, async (c) => {
  const user = c.get('user')
  const rows = await c.env.DB.prepare(
    `SELECT * FROM antecipacoes WHERE user_id=? ORDER BY data_antecipacao DESC LIMIT 100`
  ).bind(user.id).all<any>()

  const items = rows.results || []
  const total_economizado = items
    .filter((a: any) => a.status === 'antecipada')
    .reduce((s: number, a: any) => s + (a.economia_juros || 0), 0)

  return c.json({ antecipacoes: items, total_economizado: Math.round(total_economizado * 100) / 100 })
})

// ── POST /api/antecipacao — criar antecipação ─────────────────────────────
antecipacao.post('/', requireAuth, async (c) => {
  const user = c.get('user')
  const body = await c.req.json()
  const {
    descricao, valor_total, data_vencimento_original,
    data_antecipacao, economia_juros = 0,
    tipo = 'conta', referencia_id, referencia_tipo, observacoes
  } = body

  if (!descricao || !valor_total || !data_vencimento_original || !data_antecipacao) {
    return c.json({ error: 'Campos obrigatórios: descricao, valor_total, data_vencimento_original, data_antecipacao' }, 400)
  }

  const res = await c.env.DB.prepare(
    `INSERT INTO antecipacoes (user_id, descricao, valor_total, data_vencimento_original, data_antecipacao, economia_juros, tipo, referencia_id, referencia_tipo, observacoes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(user.id, descricao, parseFloat(valor_total), data_vencimento_original, data_antecipacao,
    parseFloat(economia_juros), tipo, referencia_id || null, referencia_tipo || null, observacoes || null).run()

  // Conquistas
  const total = await c.env.DB.prepare(
    `SELECT COUNT(*) as cnt FROM antecipacoes WHERE user_id=?`
  ).bind(user.id).first() as any
  if ((total?.cnt || 0) >= 1) {
    await c.env.DB.prepare('INSERT OR IGNORE INTO conquistas_usuario (user_id, conquista_codigo, visualizado) VALUES (?,?,0)').bind(user.id, 'primeira_antecipacao').run()
  }
  if ((total?.cnt || 0) >= 3) {
    await c.env.DB.prepare('INSERT OR IGNORE INTO conquistas_usuario (user_id, conquista_codigo, visualizado) VALUES (?,?,0)').bind(user.id, '3_antecipacoes').run()
  }

  return c.json({ success: true, id: res.meta.last_row_id, message: 'Antecipação registrada!' })
})

// ── PATCH /api/antecipacao/:id/status ────────────────────────────────────
antecipacao.patch('/:id/status', requireAuth, async (c) => {
  const user = c.get('user')
  const id = c.req.param('id')
  const { status } = await c.req.json()
  const validos = ['pendente', 'antecipada', 'cancelada']
  if (!validos.includes(status)) return c.json({ error: 'Status inválido' }, 400)

  await c.env.DB.prepare(
    `UPDATE antecipacoes SET status=? WHERE id=? AND user_id=?`
  ).bind(status, id, user.id).run()

  return c.json({ success: true })
})

// ── DELETE /api/antecipacao/:id ───────────────────────────────────────────
antecipacao.delete('/:id', requireAuth, async (c) => {
  const user = c.get('user')
  const id = c.req.param('id')
  await c.env.DB.prepare(`DELETE FROM antecipacoes WHERE id=? AND user_id=?`).bind(id, user.id).run()
  return c.json({ success: true })
})

// ── GET /api/antecipacao/sugestoes — contas próximas de vencer ────────────
antecipacao.get('/sugestoes', requireAuth, async (c) => {
  const user = c.get('user')
  // Buscar despesas pendentes nos próximos 60 dias que ainda não foram antecipadas
  const rows = await c.env.DB.prepare(
    `SELECT d.id, d.descricao, d.valor, d.vencimento, d.categoria,
            d.cartao_id, c.nome as cartao_nome
     FROM despesas d
     LEFT JOIN cartoes c ON c.id = d.cartao_id
     WHERE d.user_id=? AND d.status='pendente'
       AND d.vencimento IS NOT NULL
       AND d.vencimento BETWEEN date('now') AND date('now', '+60 days')
       AND d.id NOT IN (SELECT referencia_id FROM antecipacoes WHERE user_id=? AND referencia_tipo='despesa' AND status != 'cancelada')
     ORDER BY d.vencimento ASC
     LIMIT 20`
  ).bind(user.id, user.id).all<any>()

  // Calcular economia estimada (1% do valor por mês antecipado como estimativa)
  const hoje = new Date()
  const sugestoes = (rows.results || []).map((d: any) => {
    const venc = new Date(d.vencimento + 'T12:00:00')
    const diasAntecipados = Math.max(1, Math.floor((venc.getTime() - hoje.getTime()) / 86400000))
    const economia_estimada = Math.round(d.valor * 0.01 * (diasAntecipados / 30) * 100) / 100
    return { ...d, dias_ate_vencimento: diasAntecipados, economia_estimada }
  })

  return c.json({ sugestoes })
})

// ── GET /api/recebimentos — listar recebimentos parcelados ────────────────
antecipacao.get('/recebimentos', requireAuth, async (c) => {
  const user = c.get('user')
  const rows = await c.env.DB.prepare(
    `SELECT r.*,
            COUNT(p.id) as total_parcelas_count,
            SUM(CASE WHEN p.status='recebida' THEN 1 ELSE 0 END) as parcelas_recebidas,
            SUM(CASE WHEN p.status='recebida' THEN p.valor ELSE 0 END) as total_recebido
     FROM recebimentos_parcelados r
     LEFT JOIN recebimentos_parcelas p ON p.recebimento_id = r.id
     WHERE r.user_id=?
     GROUP BY r.id
     ORDER BY r.created_at DESC`
  ).bind(user.id).all<any>()

  return c.json({ recebimentos: rows.results || [] })
})

// ── POST /api/recebimentos — criar recebimento parcelado ──────────────────
antecipacao.post('/recebimentos', requireAuth, async (c) => {
  const user = c.get('user')
  const body = await c.req.json()
  const { descricao, valor_total, numero_parcelas, valor_parcela,
    data_inicio, tipo = 'venda', pagador, observacoes } = body

  if (!descricao || !valor_total || !numero_parcelas || !data_inicio) {
    return c.json({ error: 'Campos obrigatórios: descricao, valor_total, numero_parcelas, data_inicio' }, 400)
  }

  const nParcelas = parseInt(numero_parcelas)
  const vTotal = parseFloat(valor_total)
  const vParcela = valor_parcela ? parseFloat(valor_parcela) : Math.round((vTotal / nParcelas) * 100) / 100
  const dataInicio = new Date(data_inicio + 'T12:00:00')
  const dataFim = new Date(dataInicio)
  dataFim.setMonth(dataFim.getMonth() + nParcelas - 1)

  const res = await c.env.DB.prepare(
    `INSERT INTO recebimentos_parcelados (user_id, descricao, valor_total, numero_parcelas, valor_parcela, data_inicio, data_fim, tipo, pagador, observacoes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(user.id, descricao, vTotal, nParcelas, vParcela,
    data_inicio, dataFim.toISOString().split('T')[0], tipo, pagador || null, observacoes || null).run()

  const recId = res.meta.last_row_id

  // Criar parcelas automaticamente (mensalmente)
  const batch = []
  for (let i = 0; i < nParcelas; i++) {
    const dataParcela = new Date(dataInicio)
    dataParcela.setMonth(dataParcela.getMonth() + i)
    batch.push(c.env.DB.prepare(
      `INSERT INTO recebimentos_parcelas (recebimento_id, user_id, numero_parcela, valor, data_prevista)
       VALUES (?, ?, ?, ?, ?)`
    ).bind(recId, user.id, i + 1, vParcela, dataParcela.toISOString().split('T')[0]))
  }
  if (batch.length > 0) await c.env.DB.batch(batch)

  // Conquista
  await c.env.DB.prepare('INSERT OR IGNORE INTO conquistas_usuario (user_id, conquista_codigo, visualizado) VALUES (?,?,0)').bind(user.id, 'primeiro_recebimento_parcelado').run()

  return c.json({ success: true, id: recId, parcelas_criadas: nParcelas, message: `Recebimento criado com ${nParcelas} parcela(s)!` })
})

// ── GET /api/recebimentos/:id/parcelas ────────────────────────────────────
antecipacao.get('/recebimentos/:id/parcelas', requireAuth, async (c) => {
  const user = c.get('user')
  const id = c.req.param('id')

  const rec = await c.env.DB.prepare(
    `SELECT * FROM recebimentos_parcelados WHERE id=? AND user_id=?`
  ).bind(id, user.id).first() as any
  if (!rec) return c.json({ error: 'Recebimento não encontrado' }, 404)

  const parcelas = await c.env.DB.prepare(
    `SELECT * FROM recebimentos_parcelas WHERE recebimento_id=? ORDER BY numero_parcela ASC`
  ).bind(id).all<any>()

  return c.json({ recebimento: rec, parcelas: parcelas.results || [] })
})

// ── PATCH /api/recebimentos/parcelas/:id/receber ─────────────────────────
antecipacao.patch('/recebimentos/parcelas/:id/receber', requireAuth, async (c) => {
  const user = c.get('user')
  const parcelaId = c.req.param('id')
  const body = await c.req.json()
  const { data_recebimento, criar_receita = true } = body

  const parcela = await c.env.DB.prepare(
    `SELECT p.*, r.descricao as rec_descricao, r.tipo as rec_tipo
     FROM recebimentos_parcelas p
     JOIN recebimentos_parcelados r ON r.id = p.recebimento_id
     WHERE p.id=? AND p.user_id=?`
  ).bind(parcelaId, user.id).first() as any
  if (!parcela) return c.json({ error: 'Parcela não encontrada' }, 404)

  const dataRec = data_recebimento || new Date().toISOString().split('T')[0]

  // Criar receita automaticamente se solicitado
  let receitaId = null
  if (criar_receita) {
    const res = await c.env.DB.prepare(
      `INSERT INTO receitas (user_id, descricao, valor, data, categoria, tipo)
       VALUES (?, ?, ?, ?, 'Recebimento Parcelado', 'receita')`
    ).bind(user.id, `${parcela.rec_descricao} — Parcela ${parcela.numero_parcela}`,
      parcela.valor, dataRec).run()
    receitaId = res.meta.last_row_id
  }

  await c.env.DB.prepare(
    `UPDATE recebimentos_parcelas SET status='recebida', data_recebimento=?, receita_id=? WHERE id=? AND user_id=?`
  ).bind(dataRec, receitaId, parcelaId, user.id).run()

  // Verificar se todas as parcelas foram recebidas
  const pendentes = await c.env.DB.prepare(
    `SELECT COUNT(*) as cnt FROM recebimentos_parcelas
     WHERE recebimento_id=? AND status NOT IN ('recebida','cancelada')`
  ).bind(parcela.recebimento_id).first() as any

  if ((pendentes?.cnt || 0) === 0) {
    await c.env.DB.prepare(
      `UPDATE recebimentos_parcelados SET status='concluido' WHERE id=?`
    ).bind(parcela.recebimento_id).run()
    await c.env.DB.prepare('INSERT OR IGNORE INTO conquistas_usuario (user_id, conquista_codigo, visualizado) VALUES (?,?,0)').bind(user.id, 'recebimento_concluido').run()
  }

  return c.json({ success: true, receita_id: receitaId, message: `Parcela ${parcela.numero_parcela} marcada como recebida!` })
})

// ── DELETE /api/recebimentos/:id ──────────────────────────────────────────
antecipacao.delete('/recebimentos/:id', requireAuth, async (c) => {
  const user = c.get('user')
  const id = c.req.param('id')
  await c.env.DB.prepare(`DELETE FROM recebimentos_parcelados WHERE id=? AND user_id=?`).bind(id, user.id).run()
  return c.json({ success: true })
})

export default antecipacao
