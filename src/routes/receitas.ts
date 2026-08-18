import { Hono } from 'hono'
import { requireAuth } from './auth'
import { ERRO_DATA, normalizarData } from '../lib/validacao'
import { getLimites, MSG_UPGRADE } from './planos'
import { ensureTag, tagReceita, COR_MODULO } from '../utils/tags-helper'

type Bindings = { DB: D1Database; OPENAI_API_KEY: string; OPENAI_BASE_URL: string }
type Variables = { user: { id: number; nome: string; email: string; plano: string } }

const receitas = new Hono<{ Bindings: Bindings; Variables: Variables }>()

// Mapa de normalização de categorias legadas (lowercase sem acento → Title Case padrão do frontend)
// IMPORTANTE: SQLite LOWER() não normaliza acentos, então usamos aliases explícitos para o filtro
const CATEGORIA_NORMALIZE: Record<string, string> = {
  salario: 'Salário',
  freelance: 'Freelance',
  'renda extra': 'Renda Extra',
  investimentos: 'Investimentos',
  aluguel: 'Aluguel',
  dividendos: 'Dividendos',
  dividendo: 'Dividendos',
  vendas: 'Vendas',
  bonus: 'Bônus',
  '13 salario': '13º Salário',
  ferias: 'Férias',
  reembolso: 'Reembolso',
  presente: 'Presente',
  outros: 'Outros',
}

// Mapa reverso: valor normalizado → lista de aliases que representam o mesmo grupo
const CATEGORIA_ALIASES: Record<string, string[]> = {
  'Salário':      ['Salário', 'salário', 'Salario', 'salario', 'SALÁRIO', 'SALARIO'],
  'Freelance':    ['Freelance', 'freelance', 'FREELANCE'],
  'Renda Extra':  ['Renda Extra', 'renda extra', 'RENDA EXTRA'],
  'Investimentos':['Investimentos', 'investimentos', 'INVESTIMENTOS'],
  'Aluguel':      ['Aluguel', 'aluguel', 'ALUGUEL'],
  'Dividendos':   ['Dividendos', 'dividendos', 'dividendo', 'DIVIDENDOS'],
  'Vendas':       ['Vendas', 'vendas', 'VENDAS'],
  'Bônus':        ['Bônus', 'bonus', 'Bonus', 'bônus', 'BÔNUS', 'BONUS'],
  '13º Salário':  ['13º Salário', '13 salario', '13 Salário', '13º Salario'],
  'Férias':       ['Férias', 'ferias', 'Ferias', 'férias', 'FÉRIAS'],
  'Reembolso':    ['Reembolso', 'reembolso', 'REEMBOLSO'],
  'Presente':     ['Presente', 'presente', 'PRESENTE'],
  'Outros':       ['Outros', 'outros', 'OUTROS'],
}

function normalizarCategoria(cat: string): string {
  if (!cat) return cat
  const lower = cat.toLowerCase().trim()
  return CATEGORIA_NORMALIZE[lower] || cat
}

// Monta cláusula SQL WHERE para filtro de categoria (compatível com dados legados)
function filtroCategoriaSQL(categoria: string): string {
  // Verifica se a categoria informada pertence a um grupo com aliases
  for (const [norm, aliases] of Object.entries(CATEGORIA_ALIASES)) {
    if (aliases.some(a => a.toLowerCase() === categoria.toLowerCase())) {
      const lista = aliases.map(a => `'${a.replace(/'/g, "''")}'`).join(',')
      return ` AND categoria IN (${lista})`
    }
  }
  // Sem aliases — usa comparação simples (case-insensitive via LIKE com escape)
  return ` AND LOWER(categoria) = LOWER('${categoria.replace(/'/g, "''")}')`
}

// Gera expressão CASE SQL para normalizar categorias legadas
function gerarCaseCategoria(): string {
  const casos = Object.entries(CATEGORIA_ALIASES).flatMap(([norm, aliases]) =>
    aliases.map(a => `WHEN categoria = '${a.replace(/'/g, "''")}' THEN '${norm.replace(/'/g, "''")}'`)
  )
  return `CASE ${casos.join('\n    ')} ELSE categoria END`
}

// GET /api/receitas/categorias — deve vir ANTES de /:id para não ser capturada como parâmetro
receitas.get('/categorias', requireAuth, async (c) => {
  const user = c.get('user')
  const caseExpr = gerarCaseCategoria()
  // Usa subquery para agrupar pelo valor normalizado e evitar duplicatas
  const result = await c.env.DB.prepare(
    `SELECT cat_norm as categoria, SUM(valor) as total, COUNT(*) as count
     FROM (
       SELECT ${caseExpr} as cat_norm, valor
       FROM receitas WHERE user_id = ?
     )
     GROUP BY cat_norm
     ORDER BY total DESC`
  ).bind(user.id).all()
  return c.json({ categorias: result.results })
})

// GET /api/receitas
receitas.get('/', requireAuth, async (c) => {
  const user = c.get('user')
  const { mes, ano, categoria, busca, tipo, recorrente: recorrenteParam, limit = '50', offset = '0' } = c.req.query()

  // Filtros dinâmicos
  const filtrosMes = (mes && ano)
    ? ` AND strftime('%m', data) = '${mes.padStart(2, '0')}' AND strftime('%Y', data) = '${ano}'`
    : ano ? ` AND strftime('%Y', data) = '${ano}'` : ''

  // Fix: filtro de categoria com aliases (compatível com dados legados sem acento/lowercase)
  const filtroCategoria = categoria ? filtroCategoriaSQL(categoria) : ''
  const filtroBusca = busca ? ` AND descricao LIKE '%${busca.replace(/'/g, "''").replace(/%/g, '\\%')}%'` : ''
  // Filtro por tipo (campo TEXT na tabela: 'receita', 'outros', etc.)
  const filtroTipo = tipo ? ` AND LOWER(tipo) = LOWER('${tipo.replace(/'/g, "''")}')`  : ''
  // Filtro por recorrente (0 ou 1)
  const filtroRecorrente = recorrenteParam !== undefined
    ? ` AND recorrente = ${recorrenteParam === '1' || recorrenteParam === 'true' ? 1 : 0}` : ''
  const filtros = filtrosMes + filtroCategoria + filtroBusca + filtroTipo + filtroRecorrente

  const caseCategoria = gerarCaseCategoria()

  // Buscar registros + métricas em batch
  const [resultR, metricsR, catBreakdownR] = await c.env.DB.batch([
    c.env.DB.prepare(
      `SELECT id, user_id, descricao, data, ${caseCategoria} as categoria, valor, recorrente, frequencia, observacoes,
              COALESCE(meio_pagamento, 'pix') as meio_pagamento, data_criacao, recorrencia_id, tipo
       FROM receitas WHERE user_id = ?${filtros} ORDER BY data DESC LIMIT ? OFFSET ?`
    ).bind(user.id, parseInt(limit), parseInt(offset)),
    c.env.DB.prepare(
      `SELECT COALESCE(SUM(valor), 0) as total,
              COUNT(*) as total_count,
              COALESCE(AVG(valor), 0) as media,
              COALESCE(MAX(valor), 0) as maior,
              COALESCE(MIN(valor), 0) as menor,
              SUM(CASE WHEN recorrente = 1 THEN valor ELSE 0 END) as total_recorrente,
              SUM(CASE WHEN recorrente = 0 OR recorrente IS NULL THEN valor ELSE 0 END) as total_avulso
       FROM receitas WHERE user_id = ?${filtros}`
    ).bind(user.id),
    c.env.DB.prepare(
      `SELECT cat_norm as categoria, COALESCE(SUM(valor), 0) as total, COUNT(*) as qtd
       FROM (
         SELECT ${caseCategoria} as cat_norm, valor
         FROM receitas WHERE user_id = ?${filtrosMes}
       )
       GROUP BY cat_norm ORDER BY total DESC`
    ).bind(user.id),
  ])

  const metrics = (metricsR.results?.[0] ?? metricsR) as any
  const catBreakdown = catBreakdownR.results || []

  return c.json({ 
    receitas: resultR.results || [], 
    total: metrics?.total || 0,
    count: (resultR.results || []).length,
    total_count: metrics?.total_count || 0,
    metrics: {
      total: Math.round((metrics?.total || 0) * 100) / 100,
      media: Math.round((metrics?.media || 0) * 100) / 100,
      maior: Math.round((metrics?.maior || 0) * 100) / 100,
      menor: Math.round((metrics?.menor || 0) * 100) / 100,
      total_recorrente: Math.round((metrics?.total_recorrente || 0) * 100) / 100,
      total_avulso: Math.round((metrics?.total_avulso || 0) * 100) / 100,
      count: metrics?.total_count || 0
    },
    categorias_breakdown: catBreakdown
  })
})

// POST /api/receitas
receitas.post('/', requireAuth, async (c) => {
  const user = c.get('user')

  // ── Limite de plano ──
  const lim = getLimites(user.plano)
  if (lim.receitas_mes !== Infinity) {
    const now = new Date()
    const mes = String(now.getMonth() + 1).padStart(2, '0')
    const ano = String(now.getFullYear())
    const count = await c.env.DB.prepare(
      `SELECT COUNT(*) as n FROM receitas WHERE user_id = ? AND strftime('%m', data) = ? AND strftime('%Y', data) = ?`
    ).bind(user.id, mes, ano).first() as any
    if ((count?.n || 0) >= lim.receitas_mes)
      return c.json({ error: MSG_UPGRADE.receitas_mes, upgrade: true, limite: lim.receitas_mes, feature: 'receitas_mes' }, 403)
  }

  const body = await c.req.json()
  const { descricao, data, valor, recorrente = false, frequencia, observacoes, meio_pagamento } = body
  let { categoria } = body

  if (!descricao || !data || !categoria || valor === undefined) {
    return c.json({ error: 'Campos obrigatórios: descricao, data, categoria, valor' }, 400)
  }

  // Data fora do ISO virava registro invisível — ver src/lib/validacao.ts.
  const dataISO = normalizarData(data)
  if (!dataISO) return c.json({ error: ERRO_DATA }, 400)

  const valorNum = parseFloat(valor)
  if (isNaN(valorNum) || valorNum < 0) {
    return c.json({ error: 'Valor inválido — deve ser um número positivo' }, 400)
  }

  // Normalizar categoria ao salvar (garante consistência)
  categoria = normalizarCategoria(categoria)

  const result = await c.env.DB.prepare(
    'INSERT INTO receitas (user_id, descricao, data, categoria, valor, recorrente, frequencia, observacoes, meio_pagamento) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(user.id, descricao, dataISO, categoria, valorNum, recorrente ? 1 : 0, frequencia || null, observacoes || null, meio_pagamento || 'pix').run()

  const receitaId = result.meta.last_row_id as number

  // Conquista: primeira receita
  try {
    await c.env.DB.prepare('INSERT OR IGNORE INTO conquistas_usuario (user_id, conquista_codigo, visualizado) VALUES (?, ?, 0)').bind(user.id, 'primeira_receita').run()
  } catch {}

  // ── Tags: aplicar tag_ids enviados pelo frontend + tags automáticas da categoria ──
  const tagIdsEnviados: number[] = Array.isArray(body.tag_ids) ? body.tag_ids : []

  try {
    // Tag automática da categoria (ex: "Salário", "Freelance", "Aluguel")
    const tagCatId = await ensureTag(c.env.DB, user.id, categoria.trim().slice(0, 30), COR_MODULO.receita)

    // Tag automática do tipo "Receita" (sempre criada)
    const tagRecId = await ensureTag(c.env.DB, user.id, 'Receita', COR_MODULO.receita)

    // Tags manuais enviadas pelo frontend
    const todosIds = new Set<number>([tagCatId, tagRecId, ...tagIdsEnviados])

    for (const tid of todosIds) {
      if (tid > 0) await tagReceita(c.env.DB, receitaId, tid)
    }
  } catch (_) { /* best-effort — não bloqueia criação */ }

  return c.json({ success: true, id: receitaId, message: 'Receita adicionada!' }, 201)
})

// PUT /api/receitas/:id
receitas.put('/:id', requireAuth, async (c) => {
  const user = c.get('user')
  const id = c.req.param('id')
  const body = await c.req.json()
  const { descricao, data, valor, recorrente, frequencia, observacoes, meio_pagamento } = body
  let { categoria } = body

  if (!descricao || !data || !categoria || valor === undefined) {
    return c.json({ error: 'Campos obrigatórios: descricao, data, categoria, valor' }, 400)
  }

  // Data fora do ISO virava registro invisível — ver src/lib/validacao.ts.
  const dataISO = normalizarData(data)
  if (!dataISO) return c.json({ error: ERRO_DATA }, 400)

  const valorNum = parseFloat(valor)
  if (isNaN(valorNum) || valorNum < 0) {
    return c.json({ error: 'Valor inválido — deve ser um número positivo' }, 400)
  }

  const existing = await c.env.DB.prepare('SELECT id FROM receitas WHERE id = ? AND user_id = ?').bind(id, user.id).first()
  if (!existing) return c.json({ error: 'Receita não encontrada' }, 404)

  // Normalizar categoria ao salvar
  categoria = normalizarCategoria(categoria)

  await c.env.DB.prepare(
    'UPDATE receitas SET descricao = ?, data = ?, categoria = ?, valor = ?, recorrente = ?, frequencia = ?, observacoes = ?, meio_pagamento = ? WHERE id = ? AND user_id = ?'
  ).bind(descricao, dataISO, categoria, valorNum, recorrente ? 1 : 0, frequencia || null, observacoes || null, meio_pagamento || null, id, user.id).run()

  return c.json({ success: true, message: 'Receita atualizada!' })
})

// PATCH /api/receitas/:id — atualização parcial (qualquer subconjunto de campos)
// Diferente do PUT, não exige todos os campos obrigatórios.
// Útil para: atualizar apenas valor, data, categoria, observações, recorrente ou meio_pagamento.
// ATENÇÃO: deve ficar ANTES de DELETE /bulk e DELETE /:id
receitas.patch('/:id', requireAuth, async (c) => {
  const user = c.get('user')
  const id   = c.req.param('id')

  // Rejeitar IDs não-numéricos (evita capturar rotas estáticas futuras)
  if (!/^\d+$/.test(id)) return c.json({ error: 'ID inválido' }, 400)

  const existing = await c.env.DB.prepare(
    'SELECT * FROM receitas WHERE id = ? AND user_id = ?'
  ).bind(id, user.id).first() as any
  if (!existing) return c.json({ error: 'Receita não encontrada' }, 404)

  const body = await c.req.json()
  const { descricao, data, categoria: categoriaBody, valor,
    recorrente, frequencia, observacoes, meio_pagamento } = body

  // Validar valor apenas se foi enviado
  if (valor !== undefined) {
    const valorNum = parseFloat(valor)
    if (isNaN(valorNum) || valorNum < 0)
      return c.json({ error: 'Valor inválido — deve ser um número positivo' }, 400)
  }

  // Normalizar categoria se enviada
  const categoriaNorm = categoriaBody ? normalizarCategoria(categoriaBody) : undefined

  // Montar UPDATE dinâmico — só atualiza os campos presentes no body
  const sets: string[] = []
  const vals: any[]    = []

  if (descricao    !== undefined) { sets.push('descricao = ?');     vals.push(descricao) }
  if (data         !== undefined) { sets.push('data = ?');          vals.push(data) }
  if (categoriaNorm !== undefined){ sets.push('categoria = ?');     vals.push(categoriaNorm) }
  if (valor        !== undefined) { sets.push('valor = ?');         vals.push(parseFloat(valor)) }
  if (recorrente   !== undefined) { sets.push('recorrente = ?');    vals.push(recorrente ? 1 : 0) }
  if (frequencia   !== undefined) { sets.push('frequencia = ?');    vals.push(frequencia || null) }
  if (observacoes  !== undefined) { sets.push('observacoes = ?');   vals.push(observacoes || null) }
  if (meio_pagamento !== undefined){ sets.push('meio_pagamento = ?'); vals.push(meio_pagamento || null) }

  if (sets.length === 0)
    return c.json({ error: 'Nenhum campo para atualizar' }, 400)

  vals.push(id, user.id)

  await c.env.DB.prepare(
    `UPDATE receitas SET ${sets.join(', ')} WHERE id = ? AND user_id = ?`
  ).bind(...vals).run()

  return c.json({ success: true, message: 'Receita atualizada!' })
})

// DELETE /api/receitas/bulk — excluir múltiplas receitas de uma vez
receitas.delete('/bulk', requireAuth, async (c) => {
  const user = c.get('user')
  const body = await c.req.json().catch(() => null)
  const ids: number[] = body?.ids || []
  if (!ids.length) return c.json({ error: 'Nenhum id informado.' }, 400)
  if (ids.length > 200) return c.json({ error: 'Máximo 200 itens por vez.' }, 400)

  let excluidas = 0
  for (const id of ids) {
    const existing = await c.env.DB.prepare(
      'SELECT id FROM receitas WHERE id = ? AND user_id = ?'
    ).bind(id, user.id).first()
    if (!existing) continue
    await c.env.DB.prepare('DELETE FROM receitas WHERE id = ? AND user_id = ?').bind(id, user.id).run()
    excluidas++
  }

  return c.json({ success: true, excluidas, message: `${excluidas} receita(s) excluída(s).` })
})

// DELETE /api/receitas/:id
receitas.delete('/:id', requireAuth, async (c) => {
  const user = c.get('user')
  const id = c.req.param('id')

  const existing = await c.env.DB.prepare('SELECT id FROM receitas WHERE id = ? AND user_id = ?').bind(id, user.id).first()
  if (!existing) return c.json({ error: 'Receita não encontrada' }, 404)

  await c.env.DB.prepare('DELETE FROM receitas WHERE id = ? AND user_id = ?').bind(id, user.id).run()
  return c.json({ success: true, message: 'Receita excluída!' })
})

export default receitas
