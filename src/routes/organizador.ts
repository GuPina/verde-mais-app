/**
 * organizador.ts — VerdeMais v3.2
 *
 * Central de Organização: gerencia categorias e tags em massa.
 *
 * Endpoints:
 *   GET  /api/organizador/categorias        → lista todas as categorias com contagens e totais
 *   GET  /api/organizador/tags              → lista todas as tags com contagens
 *   POST /api/organizador/mesclar           → mescla N categorias em 1 (ex: "Financiamento" → "Financiamentos")
 *   POST /api/organizador/renomear          → renomeia uma categoria (inclusive despesas futuras)
 *   POST /api/organizador/aplicar-tags-lote → aplica uma tag a todas as despesas de uma categoria/filtro
 *   POST /api/organizador/remover-tags-lote → remove uma tag de despesas de um filtro
 *   POST /api/organizador/sugerir-ia        → pede à IA sugestões de merges/tags para as categorias bagunçadas
 *   GET  /api/organizador/preview           → preview de quantas despesas serão afetadas por uma operação
 */

import { Hono } from 'hono'
import { requireAuth } from './auth'

type Bindings = { DB: D1Database; OPENAI_API_KEY?: string; OPENAI_BASE_URL?: string }
type Variables = { user: { id: number; nome: string; email: string; plano: string } }

const router = new Hono<{ Bindings: Bindings; Variables: Variables }>()

// ── GET /api/organizador/categorias ─────────────────────────────────────────
// Retorna todas as categorias do usuário com contagem de despesas, total R$
// e indicação de possíveis duplicatas/inconsistências.
router.get('/categorias', requireAuth, async (c) => {
  const user = c.get('user')

  const rows = await c.env.DB.prepare(`
    SELECT
      categoria,
      COUNT(*) as total_despesas,
      COALESCE(SUM(valor), 0) as total_valor,
      SUM(CASE WHEN status = 'pendente' THEN 1 ELSE 0 END) as pendentes,
      SUM(CASE WHEN status = 'pago'     THEN 1 ELSE 0 END) as pagas,
      MIN(data) as primeira_despesa,
      MAX(data) as ultima_despesa
    FROM despesas
    WHERE user_id = ?
    GROUP BY categoria
    ORDER BY total_despesas DESC
  `).bind(user.id).all()

  const categorias = (rows.results || []) as any[]

  // Detectar possíveis duplicatas (case-insensitive ou variações comuns)
  const grupos: Record<string, string[]> = {}
  for (const c of categorias) {
    const key = (c.categoria || 'Outros').toLowerCase().trim()
      .replace(/ões$/, 'ao').replace(/ão$/, 'ao').replace(/s$/, '')
    if (!grupos[key]) grupos[key] = []
    grupos[key].push(c.categoria)
  }

  // Marcar categorias que têm possíveis duplicatas
  const categoriasMarcadas = categorias.map((cat: any) => {
    const key = (cat.categoria || 'Outros').toLowerCase().trim()
      .replace(/ões$/, 'ao').replace(/ão$/, 'ao').replace(/s$/, '')
    const similares = grupos[key].filter((x: string) => x !== cat.categoria)
    return {
      ...cat,
      possiveis_duplicatas: similares,
      tem_duplicata: similares.length > 0,
    }
  })

  return c.json({
    total_categorias: categorias.length,
    categorias: categoriasMarcadas,
  })
})

// ── GET /api/organizador/tags ────────────────────────────────────────────────
// Lista todas as tags do usuário com contagem de uso e total de despesas
router.get('/tags', requireAuth, async (c) => {
  const user = c.get('user')

  const rows = await c.env.DB.prepare(`
    SELECT
      t.id,
      t.nome,
      t.cor,
      COUNT(DISTINCT dt.despesa_id) as total_despesas,
      COALESCE(SUM(d.valor), 0) as total_valor
    FROM tags t
    LEFT JOIN despesa_tags dt ON dt.tag_id = t.id
    LEFT JOIN despesas d ON d.id = dt.despesa_id AND d.user_id = t.user_id
    WHERE t.user_id = ?
    GROUP BY t.id
    ORDER BY total_despesas DESC, t.nome ASC
  `).bind(user.id).all()

  return c.json({ tags: rows.results || [] })
})

// ── POST /api/organizador/mesclar ───────────────────────────────────────────
// Body: { categorias_origem: string[], categoria_destino: string }
// Une todas as despesas das categorias_origem na categoria_destino
router.post('/mesclar', requireAuth, async (c) => {
  const user = c.get('user')
  const body = await c.req.json().catch(() => ({})) as any

  const origens: string[] = (body?.categorias_origem || []).filter((x: any) => typeof x === 'string' && x.trim())
  const destino: string = (body?.categoria_destino || '').trim()

  if (origens.length === 0) return c.json({ error: 'Informe ao menos uma categoria de origem.' }, 400)
  if (!destino) return c.json({ error: 'Informe a categoria de destino.' }, 400)
  if (destino.length > 40) return c.json({ error: 'Nome de categoria muito longo (máx 40 chars).' }, 400)

  // Não permitir que origem e destino sejam o mesmo
  const origensLimpa = origens.filter(o => o.toLowerCase() !== destino.toLowerCase())
  if (origensLimpa.length === 0) return c.json({ error: 'Origem e destino são a mesma categoria.' }, 400)

  let totalAfetadas = 0
  const erros: string[] = []

  for (const origem of origensLimpa) {
    try {
      const res = await c.env.DB.prepare(`
        UPDATE despesas SET categoria = ? WHERE user_id = ? AND categoria = ?
      `).bind(destino, user.id, origem).run()
      totalAfetadas += res.meta?.changes || 0
    } catch (e: any) {
      erros.push(`Erro ao mesclar "${origem}": ${e.message}`)
    }
  }

  return c.json({
    ok: true,
    total_afetadas: totalAfetadas,
    categoria_destino: destino,
    categorias_mescladas: origensLimpa,
    erros,
    mensagem: `${totalAfetadas} despesa(s) movida(s) para "${destino}".`,
  })
})

// ── POST /api/organizador/renomear ──────────────────────────────────────────
// Body: { categoria_origem: string, categoria_destino: string }
router.post('/renomear', requireAuth, async (c) => {
  const user = c.get('user')
  const body = await c.req.json().catch(() => ({})) as any

  const origem: string = (body?.categoria_origem || '').trim()
  const destino: string = (body?.categoria_destino || '').trim()

  if (!origem) return c.json({ error: 'Informe a categoria de origem.' }, 400)
  if (!destino) return c.json({ error: 'Informe o novo nome da categoria.' }, 400)
  if (destino.length > 40) return c.json({ error: 'Nome muito longo (máx 40 chars).' }, 400)
  if (origem.toLowerCase() === destino.toLowerCase()) return c.json({ error: 'Origem e destino são iguais.' }, 400)

  const res = await c.env.DB.prepare(`
    UPDATE despesas SET categoria = ? WHERE user_id = ? AND categoria = ?
  `).bind(destino, user.id, origem).run()

  const afetadas = res.meta?.changes || 0

  return c.json({
    ok: true,
    total_afetadas: afetadas,
    categoria_origem: origem,
    categoria_destino: destino,
    mensagem: `${afetadas} despesa(s) renomeada(s) de "${origem}" para "${destino}".`,
  })
})

// ── POST /api/organizador/aplicar-tags-lote ─────────────────────────────────
// Body: { tag_id: number, filtro: { categoria?, descricao_contem?, status?, sem_tag? } }
// Aplica a tag a todas as despesas que batem com o filtro
router.post('/aplicar-tags-lote', requireAuth, async (c) => {
  const user = c.get('user')
  const body = await c.req.json().catch(() => ({})) as any

  const tagId: number = Number(body?.tag_id)
  const filtro: any = body?.filtro || {}

  if (!tagId || isNaN(tagId)) return c.json({ error: 'tag_id inválido.' }, 400)

  // Verificar se a tag pertence ao usuário
  const tagRow = await c.env.DB.prepare(`SELECT id, nome FROM tags WHERE id = ? AND user_id = ?`)
    .bind(tagId, user.id).first() as any
  if (!tagRow) return c.json({ error: 'Tag não encontrada.' }, 404)

  // Buscar despesas que atendem ao filtro
  let whereClause = 'WHERE d.user_id = ?'
  const params: any[] = [user.id]

  if (filtro.categoria) {
    whereClause += ' AND d.categoria = ?'
    params.push(filtro.categoria)
  }
  if (filtro.descricao_contem) {
    whereClause += ' AND d.descricao LIKE ?'
    params.push(`%${filtro.descricao_contem}%`)
  }
  if (filtro.status) {
    whereClause += ' AND d.status = ?'
    params.push(filtro.status)
  }
  if (filtro.sem_tag) {
    whereClause += ' AND NOT EXISTS (SELECT 1 FROM despesa_tags dt WHERE dt.despesa_id = d.id)'
  }

  const despesasRows = await c.env.DB.prepare(`
    SELECT d.id FROM despesas d ${whereClause}
  `).bind(...params).all()

  const despesasIds = (despesasRows.results || []).map((r: any) => r.id) as number[]

  if (despesasIds.length === 0) {
    return c.json({ ok: true, total_afetadas: 0, mensagem: 'Nenhuma despesa encontrada para o filtro.' })
  }

  let inseridas = 0
  let jaExistiam = 0
  const erros: string[] = []

  for (const despId of despesasIds) {
    try {
      // INSERT OR IGNORE para não duplicar
      const res = await c.env.DB.prepare(`
        INSERT OR IGNORE INTO despesa_tags (despesa_id, tag_id) VALUES (?, ?)
      `).bind(despId, tagId).run()
      if ((res.meta?.changes || 0) > 0) inseridas++
      else jaExistiam++
    } catch (e: any) {
      erros.push(`ID ${despId}: ${e.message}`)
    }
  }

  return c.json({
    ok: true,
    tag: { id: tagId, nome: tagRow.nome },
    total_encontradas: despesasIds.length,
    total_inseridas: inseridas,
    ja_existiam: jaExistiam,
    erros,
    mensagem: `Tag "${tagRow.nome}" aplicada em ${inseridas} despesa(s). ${jaExistiam} já tinham a tag.`,
  })
})

// ── POST /api/organizador/remover-tags-lote ─────────────────────────────────
// Body: { tag_id: number, filtro: { categoria?, descricao_contem? } }
router.post('/remover-tags-lote', requireAuth, async (c) => {
  const user = c.get('user')
  const body = await c.req.json().catch(() => ({})) as any

  const tagId: number = Number(body?.tag_id)
  const filtro: any = body?.filtro || {}

  if (!tagId || isNaN(tagId)) return c.json({ error: 'tag_id inválido.' }, 400)

  const tagRow = await c.env.DB.prepare(`SELECT id, nome FROM tags WHERE id = ? AND user_id = ?`)
    .bind(tagId, user.id).first() as any
  if (!tagRow) return c.json({ error: 'Tag não encontrada.' }, 404)

  let whereClause = 'WHERE d.user_id = ?'
  const params: any[] = [user.id]

  if (filtro.categoria) {
    whereClause += ' AND d.categoria = ?'
    params.push(filtro.categoria)
  }
  if (filtro.descricao_contem) {
    whereClause += ' AND d.descricao LIKE ?'
    params.push(`%${filtro.descricao_contem}%`)
  }

  const despesasRows = await c.env.DB.prepare(`
    SELECT d.id FROM despesas d ${whereClause}
  `).bind(...params).all()

  const despesasIds = (despesasRows.results || []).map((r: any) => r.id) as number[]

  if (despesasIds.length === 0) {
    return c.json({ ok: true, total_afetadas: 0, mensagem: 'Nenhuma despesa encontrada.' })
  }

  let removidas = 0
  for (const despId of despesasIds) {
    try {
      const res = await c.env.DB.prepare(`
        DELETE FROM despesa_tags WHERE despesa_id = ? AND tag_id = ?
      `).bind(despId, tagId).run()
      removidas += res.meta?.changes || 0
    } catch {}
  }

  return c.json({
    ok: true,
    tag: { id: tagId, nome: tagRow.nome },
    total_removidas: removidas,
    mensagem: `Tag "${tagRow.nome}" removida de ${removidas} despesa(s).`,
  })
})

// ── GET /api/organizador/preview ────────────────────────────────────────────
// Preview de quantas despesas serão afetadas
// Query: tipo=mesclar|renomear|tag, categoria, descricao_contem, tag_id, sem_tag
router.get('/preview', requireAuth, async (c) => {
  const user = c.get('user')
  const { categoria, descricao_contem, sem_tag, tag_id } = c.req.query()

  let whereClause = 'WHERE user_id = ?'
  const params: any[] = [user.id]

  if (categoria) {
    whereClause += ' AND categoria = ?'
    params.push(categoria)
  }
  if (descricao_contem) {
    whereClause += ' AND descricao LIKE ?'
    params.push(`%${descricao_contem}%`)
  }
  if (sem_tag === '1') {
    whereClause += ' AND NOT EXISTS (SELECT 1 FROM despesa_tags dt WHERE dt.despesa_id = despesas.id)'
  }
  if (tag_id) {
    whereClause += ' AND EXISTS (SELECT 1 FROM despesa_tags dt WHERE dt.despesa_id = despesas.id AND dt.tag_id = ?)'
    params.push(Number(tag_id))
  }

  const row = await c.env.DB.prepare(`
    SELECT COUNT(*) as total FROM despesas ${whereClause}
  `).bind(...params).first() as any

  // Amostra das primeiras 5 despesas
  const amostra = await c.env.DB.prepare(`
    SELECT id, descricao, categoria, valor, data, status
    FROM despesas
    ${whereClause}
    ORDER BY data DESC
    LIMIT 5
  `).bind(...params).all()

  return c.json({
    total: row?.total || 0,
    amostra: amostra.results || [],
  })
})

// ── POST /api/organizador/sugerir-ia ────────────────────────────────────────
// Pede à IA para analisar as categorias e sugerir merges/correções
// Body: { categorias: string[] }  ← lista de nomes de categorias
router.post('/sugerir-ia', requireAuth, async (c) => {
  const user = c.get('user')
  const body = await c.req.json().catch(() => ({})) as any
  const categoriasInput: string[] = (body?.categorias || []).filter((x: any) => typeof x === 'string' && x.trim())

  if (categoriasInput.length === 0) return c.json({ error: 'Informe a lista de categorias.' }, 400)

  const apiKey = c.env.OPENAI_API_KEY
  const baseURL = (c.env.OPENAI_BASE_URL || 'https://www.genspark.ai/api/llm_proxy/v1').replace(/\/$/, '')

  const systemPrompt = `Você é um assistente financeiro especialista em organização de dados pessoais.
Analise a lista de categorias de despesas abaixo e retorne um JSON com sugestões de organização.

Regras:
- Identifique categorias duplicadas ou similares (ex: "Financiamento" e "Financiamentos", "moradia" e "Moradia")
- Sugira qual deve ser o nome canônico (correto) para cada grupo
- Identifique categorias que deveriam ser renomeadas para nomes mais claros
- Retorne SOMENTE um JSON válido no formato:
{
  "grupos": [
    {
      "categorias": ["Financiamento", "Financiamentos"],
      "destino_sugerido": "Financiamentos",
      "motivo": "Mesmo conceito com variação de plural"
    }
  ],
  "renomear": [
    {
      "origem": "moradia",
      "destino": "Moradia",
      "motivo": "Capitalização incorreta"
    }
  ],
  "ok": ["Alimentação", "Saúde"]
}

Categorias para analisar:`

  try {
    const listaStr = categoriasInput.map((c, i) => `${i + 1}. ${c}`).join('\n')

    const res = await fetch(`${baseURL}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'gpt-5.4-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: listaStr },
        ],
        max_tokens: 1000,
        temperature: 0.1,
      }),
    })

    if (!res.ok) throw new Error('API error')
    const data: any = await res.json()
    const raw = data?.choices?.[0]?.message?.content?.trim() || ''

    // Extrair JSON da resposta
    const jsonMatch = raw.match(/\{[\s\S]*\}/)
    if (!jsonMatch) throw new Error('No JSON found')

    const sugestoes = JSON.parse(jsonMatch[0])

    return c.json({ ok: true, sugestoes, fonte: 'ia' })
  } catch (e) {
    // Fallback: análise local simples
    const grupos: any[] = []
    const visto: Record<string, string[]> = {}

    for (const cat of categoriasInput) {
      const key = cat.toLowerCase().trim()
        .replace(/[çÇ]/g, 'c').replace(/[ãÃáÁàÀâÂ]/g, 'a').replace(/[éÉêÊ]/g, 'e')
        .replace(/[íÍ]/g, 'i').replace(/[óÓõÕôÔ]/g, 'o').replace(/[úÚ]/g, 'u')
        .replace(/s$/, '').replace(/\s+/g, '')
      if (!visto[key]) visto[key] = []
      visto[key].push(cat)
    }

    for (const [, cats] of Object.entries(visto)) {
      if (cats.length > 1) {
        // Escolher o mais capitalizado/longo como destino
        const destino = cats.sort((a: string, b: string) => b.length - a.length)[0]
        grupos.push({
          categorias: cats,
          destino_sugerido: destino,
          motivo: 'Possível duplicata ou variação de escrita',
        })
      }
    }

    return c.json({
      ok: true,
      sugestoes: { grupos, renomear: [], ok: [] },
      fonte: 'local',
    })
  }
})

export default router
