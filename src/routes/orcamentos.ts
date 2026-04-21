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
  alimentacao: 'Alimentação', moradia: 'Moradia',
  transporte: 'Transporte', saude: 'Saúde',
  educacao: 'Educação', lazer: 'Lazer',
  vestuario: 'Vestuário', beleza: 'Beleza',
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
function normSQL(col: string): string {
  const subs: [string, string][] = [
    ['\u00e3','a'],['\u00e2','a'],['\u00e1','a'],['\u00e0','a'],['\u00e4','a'],
    ['\u00e7','c'],
    ['\u00e9','e'],['\u00ea','e'],['\u00e8','e'],['\u00eb','e'],
    ['\u00ed','i'],['\u00ee','i'],['\u00ef','i'],
    ['\u00f3','o'],['\u00f4','o'],['\u00f5','o'],['\u00f6','o'],
    ['\u00fa','u'],['\u00fb','u'],['\u00fc','u'],
  ]
  let expr = col
  for (const [from, to] of subs) {
    expr = `REPLACE(${expr},char(${from.charCodeAt(0)}),'${to}')`
  }
  return `LOWER(${expr})`
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper: calcula gastos reais de uma categoria num período
// ─────────────────────────────────────────────────────────────────────────────
async function getGastoCategoria(db: D1Database, userId: number, catNorm: string, mes: number, ano: number): Promise<number> {
  const normExpr = normSQL('categoria')
  const mesStr = String(mes).padStart(2,'0')
  const anoStr = String(ano)
  const raw = await db.prepare(
    `SELECT COALESCE(SUM(valor), 0) as total FROM despesas ` +
    `WHERE user_id = ? ` +
    `AND ${normExpr} = ? ` +
    `AND ((strftime('%m', data) = ? AND strftime('%Y', data) = ?) ` +
    `OR (vencimento IS NOT NULL AND strftime('%m', vencimento) = ? AND strftime('%Y', vencimento) = ?)) ` +
    `AND status IN ('pago', 'pendente')`
  ).bind(userId, catNorm, mesStr, anoStr, mesStr, anoStr).first() as any
  return Number(raw?.total || 0)
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/orcamentos?mes=3&ano=2026
// ─────────────────────────────────────────────────────────────────────────────
orcamentos.get('/', requireAuth, async (c) => {
  const user = c.get('user')
  const mes  = parseInt(c.req.query('mes')  || String(new Date().getMonth() + 1))
  const ano  = parseInt(c.req.query('ano')  || String(new Date().getFullYear()))

  const orcs = await c.env.DB.prepare(
    'SELECT * FROM orcamentos WHERE user_id = ? AND mes = ? AND ano = ? ORDER BY categoria'
  ).bind(user.id, mes, ano).all()

  const result = []
  for (const o of (orcs.results as any[])) {
    const catNorm    = normCat(o.categoria)
    const gasto_real = await getGastoCategoria(c.env.DB, user.id, catNorm, mes, ano)
    const percentual = o.limite > 0 ? Math.round((gasto_real / Number(o.limite)) * 100) : 0
    const alertaP = Number(o.alerta_percentual) || 80
    const status =
      percentual > 100 ? 'exceeded' :
      percentual >= alertaP ? 'warning' :
      percentual >= 70  ? 'attention' : 'ok'

    // S-O3: verificar se alerta precisa ser disparado (flag, frontend usa)
    const precisaAlerta = (status === 'warning' || status === 'exceeded') && !o.alerta_disparado
    if (precisaAlerta) {
      await c.env.DB.prepare(
        'UPDATE orcamentos SET alerta_disparado = 1 WHERE id = ?'
      ).bind(o.id).run()
    }

    const emoji = CATEGORIAS_EMOJI[catNorm] || '📦'
    const label = CATEGORIAS_LABEL[catNorm] || o.categoria
    result.push({
      ...o,
      limite: Number(o.limite),
      gasto: gasto_real,
      restante: Math.max(0, Number(o.limite) - gasto_real),
      percentual,
      status,
      alerta_ativo: precisaAlerta,   // S-O3: frontend pode exibir toast/badge
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

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/orcamentos/resumo — ANTES das rotas /:id para evitar conflito
// ─────────────────────────────────────────────────────────────────────────────
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

// ─────────────────────────────────────────────────────────────────────────────
// S-O1: GET /api/orcamentos/historico?categoria=alimentacao&meses=6
// Compara o gasto real vs limite dos últimos N meses por categoria
// ─────────────────────────────────────────────────────────────────────────────
orcamentos.get('/historico', requireAuth, async (c) => {
  const user      = c.get('user')
  const catRaw    = c.req.query('categoria') || ''
  const meses     = Math.min(parseInt(c.req.query('meses') || '6'), 24)

  // Construir lista de meses retroativos
  const periodos: { mes: number; ano: number; label: string }[] = []
  const ref = new Date()
  for (let i = meses - 1; i >= 0; i--) {
    const d = new Date(ref.getFullYear(), ref.getMonth() - i, 1)
    periodos.push({ mes: d.getMonth() + 1, ano: d.getFullYear(), label: `${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}` })
  }

  // Se categoria especificada → retorna série temporal para ela
  if (catRaw) {
    const cat = normCat(catRaw)
    const serie = []
    for (const p of periodos) {
      const orc = await c.env.DB.prepare(
        'SELECT limite, alerta_percentual, notas FROM orcamentos WHERE user_id = ? AND mes = ? AND ano = ? AND ' + normSQL('categoria') + ' = ?'
      ).bind(user.id, p.mes, p.ano, cat).first() as any

      const gasto = await getGastoCategoria(c.env.DB, user.id, cat, p.mes, p.ano)
      const limite = Number(orc?.limite || 0)
      serie.push({
        ...p,
        limite,
        gasto: Math.round(gasto * 100) / 100,
        percentual: limite > 0 ? Math.round((gasto / limite) * 100) : null,
        status: !limite ? 'sem_orcamento' : gasto > limite ? 'exceeded' : gasto >= limite * (Number(orc?.alerta_percentual || 80) / 100) ? 'warning' : 'ok',
        notas: orc?.notas || null
      })
    }
    return c.json({
      categoria: cat,
      label: `${CATEGORIAS_EMOJI[cat] || '📦'} ${CATEGORIAS_LABEL[cat] || catRaw}`,
      serie,
      meses
    })
  }

  // Sem categoria → retorna resumo de todas as categorias com orçamento em pelo menos 1 período
  const rows = await c.env.DB.prepare(
    `SELECT DISTINCT ${normSQL('categoria')} as cat FROM orcamentos WHERE user_id = ? AND ano >= ?`
  ).bind(user.id, periodos[0].ano).all()

  const resultado: any[] = []
  for (const row of (rows.results as any[])) {
    const cat = row.cat as string
    const serie = []
    for (const p of periodos) {
      const orc = await c.env.DB.prepare(
        'SELECT limite FROM orcamentos WHERE user_id = ? AND mes = ? AND ano = ? AND ' + normSQL('categoria') + ' = ?'
      ).bind(user.id, p.mes, p.ano, cat).first() as any
      const gasto = await getGastoCategoria(c.env.DB, user.id, cat, p.mes, p.ano)
      const limite = Number(orc?.limite || 0)
      serie.push({ ...p, limite, gasto: Math.round(gasto * 100) / 100 })
    }
    resultado.push({
      categoria: cat,
      label: `${CATEGORIAS_EMOJI[cat] || '📦'} ${CATEGORIAS_LABEL[cat] || cat}`,
      serie
    })
  }

  return c.json({ historico: resultado, periodos, meses })
})

// ─────────────────────────────────────────────────────────────────────────────
// S-O2: POST /api/orcamentos/copiar-mes
// Copia orçamentos de um mês anterior para o mês destino
// Body: { mes_origem, ano_origem, mes_destino, ano_destino, sobrescrever? }
// ─────────────────────────────────────────────────────────────────────────────
orcamentos.post('/copiar-mes', requireAuth, async (c) => {
  const user = c.get('user')

  if (user.plano === 'free') {
    return c.json({ error: 'Orçamentos são exclusivos do plano Premium.', upgrade: true }, 403)
  }

  const body = await c.req.json()
  const { mes_origem, ano_origem, mes_destino, ano_destino, sobrescrever = false } = body

  if (!mes_origem || !ano_origem || !mes_destino || !ano_destino)
    return c.json({ error: 'Campos obrigatórios: mes_origem, ano_origem, mes_destino, ano_destino' }, 400)

  const mesO = parseInt(mes_origem); const anoO = parseInt(ano_origem)
  const mesD = parseInt(mes_destino); const anoD = parseInt(ano_destino)

  if ([mesO, anoO, mesD, anoD].some(isNaN))
    return c.json({ error: 'Todos os campos de mês/ano devem ser numéricos' }, 400)

  const origem = await c.env.DB.prepare(
    'SELECT * FROM orcamentos WHERE user_id = ? AND mes = ? AND ano = ?'
  ).bind(user.id, mesO, anoO).all()

  if ((origem.results as any[]).length === 0)
    return c.json({ error: `Nenhum orçamento encontrado em ${mesO}/${anoO}` }, 404)

  let copiados = 0; let ignorados = 0
  for (const o of (origem.results as any[])) {
    const catNorm = normCat(o.categoria)
    if (!sobrescrever) {
      const existe = await c.env.DB.prepare(
        'SELECT id FROM orcamentos WHERE user_id = ? AND ' + normSQL('categoria') + ' = ? AND mes = ? AND ano = ?'
      ).bind(user.id, catNorm, mesD, anoD).first()
      if (existe) { ignorados++; continue }
    }

    await c.env.DB.prepare(
      `INSERT INTO orcamentos (user_id, categoria, mes, ano, limite, alerta_percentual, notas, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(user_id, categoria, mes, ano)
       DO UPDATE SET limite = excluded.limite, alerta_percentual = excluded.alerta_percentual, notas = excluded.notas, updated_at = datetime('now')`
    ).bind(user.id, catNorm, mesD, anoD, o.limite, o.alerta_percentual, o.notas || null).run()
    copiados++
  }

  return c.json({
    success: true,
    copiados,
    ignorados,
    message: `${copiados} orçamento(s) copiado(s) de ${mesO}/${anoO} → ${mesD}/${anoD}${ignorados > 0 ? `, ${ignorados} ignorado(s) (já existiam)` : ''}.`
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/orcamentos  (upsert)
// ─────────────────────────────────────────────────────────────────────────────
orcamentos.post('/', requireAuth, async (c) => {
  const user = c.get('user')

  if (user.plano === 'free') {
    return c.json({ error: 'Orçamentos por categoria são exclusivos do plano Premium.', upgrade: true, feature: 'orcamentos' }, 403)
  }

  const { categoria: categoriaRaw, mes, ano, limite, alerta_percentual = 80, notas } = await c.req.json()

  if (!categoriaRaw || !mes || !ano || limite === undefined || limite === null || limite === '')
    return c.json({ error: 'Campos obrigatórios: categoria, mes, ano, limite' }, 400)

  const categoria = normCat(String(categoriaRaw))

  if (!CATEGORIAS.includes(categoria))
    return c.json({ error: `Categoria inválida. Aceitas: ${CATEGORIAS.join(', ')}` }, 400)
  if (Number(limite) <= 0)
    return c.json({ error: 'Limite deve ser maior que zero' }, 400)
  const alertaNum = Number(alerta_percentual)
  if (isNaN(alertaNum) || alertaNum < 50 || alertaNum > 100)
    return c.json({ error: 'alerta_percentual deve ser entre 50 e 100' }, 400)

  await c.env.DB.prepare(
    `INSERT INTO orcamentos (user_id, categoria, mes, ano, limite, alerta_percentual, notas, updated_at) ` +
    `VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now')) ` +
    `ON CONFLICT(user_id, categoria, mes, ano) ` +
    `DO UPDATE SET limite = excluded.limite, alerta_percentual = excluded.alerta_percentual, notas = excluded.notas, updated_at = datetime('now')`
  ).bind(user.id, categoria, mes, ano, limite, alertaNum, notas || null).run()

  const orc = await c.env.DB.prepare(
    'SELECT * FROM orcamentos WHERE user_id = ? AND categoria = ? AND mes = ? AND ano = ?'
  ).bind(user.id, categoria, mes, ano).first()

  await verificarConquista(c.env.DB, user.id, 'primeiro_orcamento')
  await verificarConquista(c.env.DB, user.id, 'primeiro_orcamento')

  return c.json({ success: true, orcamento: orc })
})

// ─────────────────────────────────────────────────────────────────────────────
// S-O4: PUT /api/orcamentos/:id — atualização parcial via ID
// ─────────────────────────────────────────────────────────────────────────────
orcamentos.put('/:id', requireAuth, async (c) => {
  const user = c.get('user')
  const id   = c.req.param('id')

  const orc = await c.env.DB.prepare(
    'SELECT * FROM orcamentos WHERE id = ? AND user_id = ?'
  ).bind(id, user.id).first() as any
  if (!orc) return c.json({ error: 'Orçamento não encontrado' }, 404)

  const body = await c.req.json()
  const { limite, alerta_percentual, notas } = body

  // Validar só o que foi enviado
  if (limite !== undefined) {
    if (Number(limite) <= 0) return c.json({ error: 'Limite deve ser maior que zero' }, 400)
  }
  if (alerta_percentual !== undefined) {
    const ap = Number(alerta_percentual)
    if (isNaN(ap) || ap < 50 || ap > 100)
      return c.json({ error: 'alerta_percentual deve ser entre 50 e 100' }, 400)
  }

  const novoLimite  = limite !== undefined ? Number(limite) : Number(orc.limite)
  const novoAlerta  = alerta_percentual !== undefined ? Number(alerta_percentual) : Number(orc.alerta_percentual)
  const novasNotas  = notas !== undefined ? (notas || null) : orc.notas

  await c.env.DB.prepare(
    `UPDATE orcamentos SET limite = ?, alerta_percentual = ?, notas = ?, alerta_disparado = 0, updated_at = datetime('now')
     WHERE id = ? AND user_id = ?`
  ).bind(novoLimite, novoAlerta, novasNotas, id, user.id).run()

  const updated = await c.env.DB.prepare('SELECT * FROM orcamentos WHERE id = ?').bind(id).first()
  return c.json({ success: true, message: 'Orçamento atualizado!', orcamento: updated })
})

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/orcamentos/:id
// ─────────────────────────────────────────────────────────────────────────────
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

async function verificarConquista(db: D1Database, userId: number, codigo: string) {
  await db.prepare(
    `INSERT OR IGNORE INTO conquistas_usuario (user_id, conquista_codigo, data_conquista, visualizado) ` +
    `VALUES (?, ?, datetime('now'), 0)`
  ).bind(userId, codigo).run()
}

export default orcamentos
