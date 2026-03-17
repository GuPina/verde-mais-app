import { Hono } from 'hono'
import { requireAuth } from './auth'

type Bindings = { DB: D1Database }
type Variables = { user: { id: number; nome: string; email: string; plano: string } }

const orcamentos = new Hono<{ Bindings: Bindings; Variables: Variables }>()

// Categorias disponíveis (sync com despesas)
const CATEGORIAS = [
  'alimentacao', 'moradia', 'transporte', 'saude', 'educacao',
  'lazer', 'vestuario', 'beleza', 'pets', 'assinaturas',
  'tecnologia', 'viagem', 'outros', 'fixo', 'supermercado'
]

const CATEGORIAS_LABEL: Record<string, string> = {
  alimentacao: 'Alimentacao', moradia: 'Moradia',
  transporte: 'Transporte', saude: 'Saude',
  educacao: 'Educacao', lazer: 'Lazer',
  vestuario: 'Vestuario', beleza: 'Beleza',
  pets: 'Pets', assinaturas: 'Assinaturas',
  tecnologia: 'Tecnologia', viagem: 'Viagens',
  outros: 'Outros', fixo: 'Gastos Fixos',
  supermercado: 'Supermercado'
}

const CATEGORIAS_EMOJI: Record<string, string> = {
  alimentacao: '🍽️', moradia: '🏠', transporte: '🚗', saude: '🏥',
  educacao: '📚', lazer: '🎮', vestuario: '👕', beleza: '💄',
  pets: '🐾', assinaturas: '📱', tecnologia: '💻', viagem: '✈️',
  outros: '📦', fixo: '📌', supermercado: '🛒'
}

// Normaliza string para comparação: remove acentos e coloca em lowercase
function normCat(s: string): string {
  return s.toLowerCase()
    .replace(/[ãâáàä]/g, 'a').replace(/[çÇ]/g, 'c')
    .replace(/[éêèë]/g, 'e').replace(/[íîï]/g, 'i')
    .replace(/[óôõö]/g, 'o').replace(/[úûü]/g, 'u')
}

// SQL para normalizar categoria no banco (SQLite não tem suporte nativo a unicode folding)
// Usa uma cadeia de REPLACE para cobrir acentos do português
function normSQL(col: string): string {
  const acc = [
    ['a','a','a','a','a'], // ã á â à ä
    ['c'],                  // ç
    ['e','e','e','e'],      // é ê è ë
    ['i','i','i'],          // í î ï
    ['o','o','o','o'],      // ó ô õ ö
    ['u','u','u'],          // ú û ü
  ]
  // Mapa plano de substituições: [from, to]
  const subs: [string, string][] = [
    ['\u00e3','a'],['\u00e2','a'],['\u00e1','a'],['\u00e0','a'],['\u00e4','a'],
    ['\u00e7','c'],
    ['\u00e9','e'],['\u00ea','e'],['\u00e8','e'],['\u00eb','e'],
    ['\u00ed','i'],['\u00ee','i'],['\u00ef','i'],
    ['\u00f3','o'],['\u00f4','o'],['\u00f5','o'],['\u00f6','o'],
    ['\u00fa','u'],['\u00fb','u'],['\u00fc','u'],
  ]
  // Construir SQL com REPLACE aninhados
  let expr = col
  for (const [from, to] of subs) {
    expr = `REPLACE(${expr},char(${from.charCodeAt(0)}),'${to}')`
  }
  return `LOWER(${expr})`
}

// GET /api/orcamentos?mes=3&ano=2026
orcamentos.get('/', requireAuth, async (c) => {
  const user = c.get('user')
  const mes  = parseInt(c.req.query('mes')  || String(new Date().getMonth() + 1))
  const ano  = parseInt(c.req.query('ano')  || String(new Date().getFullYear()))

  const orcs = await c.env.DB.prepare(
    'SELECT * FROM orcamentos WHERE user_id = ? AND mes = ? AND ano = ? ORDER BY categoria'
  ).bind(user.id, mes, ano).all()

  const result = []
  for (const o of (orcs.results as any[])) {
    const catNorm = normCat(o.categoria)

    // Busca gasto real normalizando ambos os lados via SQL
    const normExpr = normSQL('categoria')
    const mesStr = String(mes).padStart(2,'0')
    const anoStr = String(ano)

    const gastoRaw = await c.env.DB.prepare(
      `SELECT COALESCE(SUM(valor), 0) as total FROM despesas ` +
      `WHERE user_id = ? ` +
      `AND ${normExpr} = ? ` +
      `AND ((strftime('%m', data) = ? AND strftime('%Y', data) = ?) ` +
      `OR (vencimento IS NOT NULL AND strftime('%m', vencimento) = ? AND strftime('%Y', vencimento) = ?)) ` +
      `AND status IN ('pago', 'pendente')`
    ).bind(user.id, catNorm, mesStr, anoStr, mesStr, anoStr).first() as any

    const gasto_real = Number(gastoRaw?.total || 0)
    const percentual = o.limite > 0 ? Math.round((gasto_real / Number(o.limite)) * 100) : 0
    const alertaP = Number(o.alerta_percentual) || 80
    const status =
      percentual > 100 ? 'exceeded' :
      percentual >= alertaP ? 'warning' :
      percentual >= 70  ? 'attention' : 'ok'

    const emoji = CATEGORIAS_EMOJI[normCat(o.categoria)] || '📦'
    const label = CATEGORIAS_LABEL[normCat(o.categoria)] || o.categoria
    result.push({
      ...o,
      limite: Number(o.limite),
      gasto: gasto_real,
      restante: Math.max(0, Number(o.limite) - gasto_real),
      percentual,
      status,
      label: `${emoji} ${label}`
    })
  }

  const comOrcamento = result.map(r => normCat(r.categoria))
  const semOrcamento = CATEGORIAS.filter(c => !comOrcamento.includes(c)).map(c => ({
    categoria: c,
    label: `${CATEGORIAS_EMOJI[c] || '📦'} ${CATEGORIAS_LABEL[c] || c}`
  }))

  return c.json({ orcamentos: result, semOrcamento, mes, ano })
})

// POST /api/orcamentos
orcamentos.post('/', requireAuth, async (c) => {
  const user = c.get('user')

  if (user.plano === 'free') {
    return c.json({ error: 'Orçamentos por categoria são exclusivos do plano Premium.', upgrade: true, feature: 'orcamentos' }, 403)
  }

  const { categoria: categoriaRaw, mes, ano, limite, alerta_percentual = 80 } = await c.req.json()

  if (!categoriaRaw || !mes || !ano || !limite)
    return c.json({ error: 'Campos obrigatórios: categoria, mes, ano, limite' }, 400)

  // Normalizar categoria (aceita acentuado ou capitalizado)
  const categoria = normCat(String(categoriaRaw))

  if (!CATEGORIAS.includes(categoria))
    return c.json({ error: `Categoria inválida. Aceitas: ${CATEGORIAS.join(', ')}` }, 400)
  if (Number(limite) <= 0)
    return c.json({ error: 'Limite deve ser maior que zero' }, 400)

  await c.env.DB.prepare(
    `INSERT INTO orcamentos (user_id, categoria, mes, ano, limite, alerta_percentual, updated_at) ` +
    `VALUES (?, ?, ?, ?, ?, ?, datetime('now')) ` +
    `ON CONFLICT(user_id, categoria, mes, ano) ` +
    `DO UPDATE SET limite = excluded.limite, alerta_percentual = excluded.alerta_percentual, updated_at = datetime('now')`
  ).bind(user.id, categoria, mes, ano, limite, alerta_percentual).run()

  const orc = await c.env.DB.prepare(
    'SELECT * FROM orcamentos WHERE user_id = ? AND categoria = ? AND mes = ? AND ano = ?'
  ).bind(user.id, categoria, mes, ano).first()

  await verificarConquista(c.env.DB, user.id, 'orcamentista')
  await verificarConquista(c.env.DB, user.id, 'primeiro_orcamento')

  return c.json({ success: true, orcamento: orc })
})

// DELETE /api/orcamentos/:id
orcamentos.delete('/:id', requireAuth, async (c) => {
  const user = c.get('user')
  const id   = c.req.param('id')

  const orc = await c.env.DB.prepare(
    'SELECT id FROM orcamentos WHERE id = ? AND user_id = ?'
  ).bind(id, user.id).first()
  if (!orc) return c.json({ error: 'Orçamento não encontrado' }, 404)

  await c.env.DB.prepare('DELETE FROM orcamentos WHERE id = ?').bind(id).run()
  return c.json({ success: true })
})

// GET /api/orcamentos/resumo
orcamentos.get('/resumo', requireAuth, async (c) => {
  const user = c.get('user')
  const mes  = parseInt(c.req.query('mes')  || String(new Date().getMonth() + 1))
  const ano  = parseInt(c.req.query('ano')  || String(new Date().getFullYear()))

  const total = await c.env.DB.prepare(
    'SELECT COUNT(*) as qtd, SUM(limite) as total_limite FROM orcamentos WHERE user_id = ? AND mes = ? AND ano = ?'
  ).bind(user.id, mes, ano).first() as any

  const normD = normSQL('d.categoria')
  const normO = normSQL('o.categoria')
  const mesStr = String(mes).padStart(2,'0')
  const anoStr = String(ano)

  const gasto = await c.env.DB.prepare(
    `SELECT COALESCE(SUM(d.valor), 0) as total ` +
    `FROM despesas d ` +
    `INNER JOIN orcamentos o ON ${normD} = ${normO} AND o.user_id = d.user_id ` +
    `WHERE d.user_id = ? AND o.mes = ? AND o.ano = ? ` +
    `AND ((strftime('%m', d.data) = ? AND strftime('%Y', d.data) = ?) ` +
    `OR (d.vencimento IS NOT NULL AND strftime('%m', d.vencimento) = ? AND strftime('%Y', d.vencimento) = ?)) ` +
    `AND d.status IN ('pago', 'pendente')`
  ).bind(user.id, mes, ano, mesStr, anoStr, mesStr, anoStr).first() as any

  return c.json({
    qtd_orcamentos: total?.qtd || 0,
    total_limite: Number(total?.total_limite || 0),
    total_gasto: Number(gasto?.total || 0),
    mes, ano
  })
})

async function verificarConquista(db: D1Database, userId: number, codigo: string) {
  await db.prepare(
    `INSERT OR IGNORE INTO conquistas_usuario (user_id, conquista_codigo, data_conquista, visualizado) ` +
    `VALUES (?, ?, datetime('now'), 0)`
  ).bind(userId, codigo).run()
}

export default orcamentos
