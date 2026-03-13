import { Hono } from 'hono'
import { requireAuth } from './auth'

type Bindings = { DB: D1Database }
type Variables = { user: { id: number; nome: string; email: string; plano: string } }

const orcamentos = new Hono<{ Bindings: Bindings; Variables: Variables }>()

// ─── Categorias disponíveis (sync com despesas) ───────────────────────────────
const CATEGORIAS = [
  'alimentacao', 'moradia', 'transporte', 'saude', 'educacao',
  'lazer', 'vestuario', 'beleza', 'pets', 'assinaturas',
  'tecnologia', 'viagem', 'outros', 'fixo', 'supermercado'
]

const CATEGORIAS_LABEL: Record<string, string> = {
  alimentacao: '🍽️ Alimentação',   moradia: '🏠 Moradia',
  transporte:  '🚗 Transporte',    saude: '🏥 Saúde',
  educacao:    '📚 Educação',      lazer: '🎮 Lazer',
  vestuario:   '👕 Vestuário',     beleza: '💄 Beleza',
  pets:        '🐾 Pets',          assinaturas: '📱 Assinaturas',
  tecnologia:  '💻 Tecnologia',    viagem: '✈️ Viagens',
  outros:      '📦 Outros',        fixo: '📌 Gastos Fixos',
  supermercado:'🛒 Supermercado'
}

// ─── GET /api/orcamentos?mes=3&ano=2026 ───────────────────────────────────────
orcamentos.get('/', requireAuth, async (c) => {
  const user  = c.get('user')
  const mes   = parseInt(c.req.query('mes')  || String(new Date().getMonth() + 1))
  const ano   = parseInt(c.req.query('ano')  || String(new Date().getFullYear()))

  // Busca orçamentos do período
  const orcs = await c.env.DB.prepare(
    `SELECT * FROM orcamentos WHERE user_id = ? AND mes = ? AND ano = ? ORDER BY categoria`
  ).bind(user.id, mes, ano).all()

  // Para cada orçamento, busca o gasto real do período
  const result = []
  for (const o of (orcs.results as any[])) {
    const gasto = await c.env.DB.prepare(
      `SELECT COALESCE(SUM(valor), 0) as total
       FROM despesas
       WHERE user_id = ? AND categoria = ?
         AND strftime('%m', COALESCE(vencimento, data)) = ?
         AND strftime('%Y', COALESCE(vencimento, data)) = ?
         AND status IN ('pago', 'pendente')`
    ).bind(user.id, o.categoria, String(mes).padStart(2,'0'), String(ano)).first() as any

    const gasto_real = Number(gasto?.total || 0)
    const percentual = Math.round((gasto_real / Number(o.limite)) * 100)
    const status =
      percentual > 100 ? 'exceeded' :
      percentual >= Number(o.alerta_percentual) ? 'warning' :
      percentual >= 70  ? 'attention' : 'ok'

    result.push({
      ...o,
      limite: Number(o.limite),
      gasto: gasto_real,
      restante: Math.max(0, Number(o.limite) - gasto_real),
      percentual,
      status,
      label: CATEGORIAS_LABEL[o.categoria] || o.categoria
    })
  }

  // Categorias sem orçamento (para sugestão)
  const comOrcamento = result.map(r => r.categoria)
  const semOrcamento = CATEGORIAS.filter(c => !comOrcamento.includes(c)).map(c => ({
    categoria: c, label: CATEGORIAS_LABEL[c] || c
  }))

  return c.json({ orcamentos: result, semOrcamento, mes, ano })
})

// ─── POST /api/orcamentos ─────────────────────────────────────────────────────
orcamentos.post('/', requireAuth, async (c) => {
  const user = c.get('user')

  // Bloquear FREE
  if (user.plano === 'free') {
    return c.json({
      error: 'Orçamentos por categoria são exclusivos do plano Premium.',
      upgrade: true, feature: 'orcamentos'
    }, 403)
  }

  const { categoria, mes, ano, limite, alerta_percentual = 80 } = await c.req.json()

  if (!categoria || !mes || !ano || !limite) {
    return c.json({ error: 'Campos obrigatórios: categoria, mes, ano, limite' }, 400)
  }
  if (!CATEGORIAS.includes(categoria)) {
    return c.json({ error: 'Categoria inválida' }, 400)
  }
  if (Number(limite) <= 0) {
    return c.json({ error: 'Limite deve ser maior que zero' }, 400)
  }

  // UPSERT
  await c.env.DB.prepare(
    `INSERT INTO orcamentos (user_id, categoria, mes, ano, limite, alerta_percentual, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(user_id, categoria, mes, ano)
     DO UPDATE SET limite = excluded.limite, alerta_percentual = excluded.alerta_percentual, updated_at = datetime('now')`
  ).bind(user.id, categoria, mes, ano, limite, alerta_percentual).run()

  const orc = await c.env.DB.prepare(
    `SELECT * FROM orcamentos WHERE user_id = ? AND categoria = ? AND mes = ? AND ano = ?`
  ).bind(user.id, categoria, mes, ano).first()

  // Conquista
  await verificarConquista(c.env.DB, user.id, 'orcamentista')

  return c.json({ success: true, orcamento: orc })
})

// ─── DELETE /api/orcamentos/:id ───────────────────────────────────────────────
orcamentos.delete('/:id', requireAuth, async (c) => {
  const user = c.get('user')
  const id   = c.req.param('id')

  const orc = await c.env.DB.prepare(
    `SELECT id FROM orcamentos WHERE id = ? AND user_id = ?`
  ).bind(id, user.id).first()
  if (!orc) return c.json({ error: 'Orçamento não encontrado' }, 404)

  await c.env.DB.prepare(`DELETE FROM orcamentos WHERE id = ?`).bind(id).run()
  return c.json({ success: true })
})

// ─── GET /api/orcamentos/resumo ── resumo global do mês ───────────────────────
orcamentos.get('/resumo', requireAuth, async (c) => {
  const user = c.get('user')
  const mes  = parseInt(c.req.query('mes')  || String(new Date().getMonth() + 1))
  const ano  = parseInt(c.req.query('ano')  || String(new Date().getFullYear()))

  const total = await c.env.DB.prepare(
    `SELECT COUNT(*) as qtd, SUM(limite) as total_limite FROM orcamentos
     WHERE user_id = ? AND mes = ? AND ano = ?`
  ).bind(user.id, mes, ano).first() as any

  // Gasto total nas categorias com orçamento
  const gasto = await c.env.DB.prepare(
    `SELECT COALESCE(SUM(d.valor), 0) as total
     FROM despesas d
     INNER JOIN orcamentos o ON d.categoria = o.categoria AND o.user_id = d.user_id
     WHERE d.user_id = ?
       AND o.mes = ? AND o.ano = ?
       AND strftime('%m', COALESCE(d.vencimento, d.data)) = ?
       AND strftime('%Y', COALESCE(d.vencimento, d.data)) = ?
       AND d.status IN ('pago', 'pendente')`
  ).bind(user.id, mes, ano, String(mes).padStart(2,'0'), String(ano)).first() as any

  return c.json({
    qtd_orcamentos: total?.qtd || 0,
    total_limite: Number(total?.total_limite || 0),
    total_gasto: Number(gasto?.total || 0),
    mes, ano
  })
})

async function verificarConquista(db: D1Database, userId: number, codigo: string) {
  await db.prepare(
    `INSERT OR IGNORE INTO conquistas_usuario (user_id, conquista_codigo, data_conquista, visualizado)
     VALUES (?, ?, datetime('now'), 0)`
  ).bind(userId, codigo).run()
}

export default orcamentos
