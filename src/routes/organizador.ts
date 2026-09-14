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
 *
 * A fila de decisões (a Central nova):
 *   GET  /api/organizador/decisoes            → o que decidir, ordenado por dinheiro
 *   GET  /api/organizador/resumo              → o aviso no contexto, para outras telas
 *   GET  /api/organizador/identidades         → as "coisas de verdade" por trás das descrições
 *   POST /api/organizador/decisoes/aplicar    → aplica uma decisão, guardando o antes
 *   POST /api/organizador/decisoes/dispensar  → "depois" (30 dias) ou "são coisas diferentes"
 *   POST /api/organizador/desfazer            → volta uma ação aplicada, até 30 dias depois
 */

import { Hono } from 'hono'
import { filtroNaoCancelada, filtroSemAporte } from '../lib/competencia'
import { VOCABULARIO } from '../lib/identidade'
import { montarFila, agruparIdentidades, type DespesaCrua } from '../lib/fila-decisoes'
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

  // O cliente antigo mandava `categoria_antiga`/`categoria_nova`, que esta rota
  // nunca leu: renomear devolvia 400 desde sempre e o lápis da Central
  // simplesmente não funcionava. Aceitar as duas grafias conserta o que está
  // em produção sem depender de o navegador do usuário recarregar o JS.
  const origem: string = (body?.categoria_origem || body?.categoria_antiga || body?.nome_antigo || '').trim()
  const destino: string = (body?.categoria_destino || body?.categoria_nova || body?.nome_novo || '').trim()

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

// ═══════════════════════════════════════════════════════════════════════════
// A FILA DE DECISÕES
// ═══════════════════════════════════════════════════════════════════════════
//
// A Central antiga listava categorias e esperava que o usuário descobrisse o
// que juntar. Estes endpoints invertem isso: o sistema audita, ordena por
// quanto dinheiro cada decisão destrava, e pergunta uma coisa por vez.
//
// Nada aqui aplica nada sozinho. `GET /decisoes` é leitura pura — não escreve
// uma linha, nem sequer cria as identidades que calcula. A identidade só nasce
// quando o usuário DECIDE algo sobre ela, porque é a decisão que vale a pena
// guardar; o agrupamento o sistema refaz em milissegundos a qualquer hora.

/** Colunas que a fila precisa. Nada além disto sai do banco. */
const COLUNAS_FILA = `id, descricao, categoria, valor, data, status, observacoes, recorrencia_id`

/** Só o que é gasto de verdade: aporte é transferência de patrimônio. */
const ESCOPO_FILA = `user_id = ? AND ${filtroNaoCancelada()} AND ${filtroSemAporte()}`

async function carregarDespesas(db: D1Database, userId: number): Promise<DespesaCrua[]> {
  const r = await db.prepare(
    `SELECT ${COLUNAS_FILA} FROM despesas WHERE ${ESCOPO_FILA} ORDER BY id`
  ).bind(userId).all()
  return ((r.results as any[]) || []).map(d => ({
    id: Number(d.id),
    descricao: d.descricao ?? null,
    categoria: d.categoria ?? null,
    valor: Number(d.valor) || 0,
    data: d.data ?? null,
    status: d.status ?? null,
    observacoes: d.observacoes ?? null,
    recorrencia_id: d.recorrencia_id ?? null,
  }))
}

/**
 * O que o usuário já mandou embora. "Depois" volta em 30 dias; "são coisas
 * diferentes" não volta nunca. Repetir a mesma pergunta todo mês é como um app
 * perde a confiança de quem usa.
 */
async function dispensadas(db: D1Database, userId: number): Promise<Set<string>> {
  try {
    const r = await db.prepare(
      `SELECT decisao_id, motivo, ate FROM organizador_dispensas WHERE user_id = ?`
    ).bind(userId).all()
    const hoje = new Date().toISOString().slice(0, 10)
    const fora = new Set<string>()
    for (const d of ((r.results as any[]) || [])) {
      if (d.motivo === 'recusada') { fora.add(String(d.decisao_id)); continue }
      if (!d.ate || String(d.ate) > hoje) fora.add(String(d.decisao_id))
    }
    return fora
  } catch {
    // Migration ainda não aplicada: a fila funciona, só não lembra dispensas.
    return new Set()
  }
}

// ── GET /api/organizador/decisoes ───────────────────────────────────────────
router.get('/decisoes', requireAuth, async (c) => {
  const user = c.get('user')
  const desp = await carregarDespesas(c.env.DB, user.id)
  const fila = montarFila(desp, { dispensadas: await dispensadas(c.env.DB, user.id) })

  // O histórico de desfazer entra junto: quem acabou de aplicar algo precisa
  // ver o botão de voltar sem trocar de tela.
  let acoes: any[] = []
  try {
    const r = await c.env.DB.prepare(
      `SELECT id, tipo, resumo, afetados, criado_em FROM organizador_acoes
       WHERE user_id = ? AND desfeito_em IS NULL
       ORDER BY id DESC LIMIT 5`
    ).bind(user.id).all()
    acoes = ((r.results as any[]) || [])
  } catch { acoes = [] }

  return c.json({ ...fila, acoes, vocabulario: VOCABULARIO })
})

// ── GET /api/organizador/resumo ─────────────────────────────────────────────
// O aviso no contexto. Barato de propósito: outras telas chamam isto no load,
// e uma Central cara faria a tela de Despesas ficar lenta por causa de um
// aviso que na maioria das contas nem aparece.
//
// Com ?mes=&ano=, devolve só os conflitos que tocam AQUELE mês — é a diferença
// entre "você tem 7 pendências em algum lugar" e "o total que você está
// olhando agora está errado por causa disto".
router.get('/resumo', requireAuth, async (c) => {
  const user = c.get('user')
  const mes = c.req.query('mes')
  const ano = c.req.query('ano')

  const desp = await carregarDespesas(c.env.DB, user.id)
  const fila = montarFila(desp, {
    dispensadas: await dispensadas(c.env.DB, user.id),
    limite: 200,
    sem_parecidas: true,
  })

  let relevantes = fila.decisoes
  if (mes && ano) {
    const prefixo = `${ano}-${String(mes).padStart(2, '0')}`
    const doMes = new Set(desp.filter(d => String(d.data || '').startsWith(prefixo)).map(d => d.id))
    relevantes = fila.decisoes.filter(d => {
      const ids = (d.alvo as any)?.ids as number[] | undefined
      return !!ids?.some(i => doMes.has(i))
    })
  }

  // Só o que faz o número de HOJE estar errado merece interromper outra tela.
  // Vocabulário e parecidas são arrumação: ficam para quem abrir a Central.
  const urgentes = relevantes.filter(d => d.tipo === 'conflito' || d.tipo === 'duplicata')

  return c.json({
    pendentes: fila.resumo.pendentes,
    no_contexto: relevantes.length,
    urgentes: urgentes.length,
    lancamentos_afetados: fila.resumo.lancamentos_afetados,
    valor_afetado: fila.resumo.valor_afetado,
    // As três primeiras, com o texto pronto — a tela que exibe o aviso não
    // deve ter que saber montar frase sobre conflito de categoria.
    destaques: urgentes.slice(0, 3).map(d => ({
      id: d.id, tipo: d.tipo, titulo: d.titulo, selo: d.selo,
      lancamentos: d.lancamentos, valor: d.valor,
    })),
  })
})

// ── GET /api/organizador/identidades ────────────────────────────────────────
router.get('/identidades', requireAuth, async (c) => {
  const user = c.get('user')
  const desp = await carregarDespesas(c.env.DB, user.id)
  const ids = agruparIdentidades(desp)
  const limite = Math.min(500, Math.max(1, Number(c.req.query('limite')) || 200))
  return c.json({
    total: ids.length,
    descricoes: new Set(desp.map(d => String(d.descricao || '').trim())).size,
    despesas: desp.length,
    identidades: ids.slice(0, limite).map(g => ({
      chave: g.chave, nome: g.nome, lancamentos: g.lancamentos, total: g.total,
      valor_tipico: g.valor_tipico, primeira: g.primeira, ultima: g.ultima,
      vinculo: g.vinculo, categorias: [...g.categorias.entries()].map(([nome, n]) => ({ nome, n })),
    })),
  })
})

// ── POST /api/organizador/decisoes/aplicar ──────────────────────────────────
//
// O contrato: o cliente devolve o `alvo` que recebeu, intacto, mais a escolha.
// O servidor NÃO confia nos ids que vieram — ele os recalcula a partir da
// chave. Um cliente desatualizado (ou um usuário com duas abas abertas) teria
// ids de uma fila velha, e escrever em cima deles mudaria lançamento que não
// está mais no grupo.
router.post('/decisoes/aplicar', requireAuth, async (c) => {
  const user = c.get('user')
  const body = await c.req.json().catch(() => ({})) as any
  const tipo = String(body?.tipo || '')
  const escolha = String(body?.escolha || '').trim()
  const alvo = body?.alvo || {}
  const decisaoId = String(body?.decisao_id || '')

  if (!tipo) return c.json({ error: 'Informe o tipo da decisão.' }, 400)

  const desp = await carregarDespesas(c.env.DB, user.id)

  /** Quais lançamentos esta decisão realmente toca, recalculado agora. */
  let alvoIds: number[] = []
  let resumo = ''

  if (tipo === 'conflito' || tipo === 'sem_dono') {
    const chave = String(alvo?.chave || '')
    if (!chave) return c.json({ error: 'Decisão sem identidade.' }, 400)
    if (!escolha) return c.json({ error: 'Escolha uma categoria.' }, 400)
    if (escolha.length > 40) return c.json({ error: 'Nome de categoria muito longo (máx 40).' }, 400)
    const grupo = agruparIdentidades(desp).find(g => g.chave === chave)
    if (!grupo) return c.json({ error: 'Essa identidade não existe mais — a fila mudou.' }, 409)
    alvoIds = grupo.ids
    resumo = `"${grupo.nome}" → ${escolha}`
  } else if (tipo === 'duplicata') {
    const nomes: string[] = Array.isArray(alvo?.nomes) ? alvo.nomes.map(String) : []
    if (nomes.length < 2) return c.json({ error: 'Decisão sem categorias.' }, 400)
    if (!escolha) return c.json({ error: 'Escolha o nome que fica.' }, 400)
    alvoIds = desp.filter(d => nomes.includes(String(d.categoria || '').trim()) &&
                               String(d.categoria || '').trim() !== escolha).map(d => d.id)
    resumo = `${nomes.filter(n => n !== escolha).map(n => `"${n}"`).join(', ')} → "${escolha}"`
  } else if (tipo === 'vocabulario') {
    // Lote: aceita a lista de pares que o cliente confirmou, mas só aplica os
    // que ainda batem com o que existe no banco.
    const pares: Array<{ de: string; para: string }> = Array.isArray(alvo?.pares)
      ? alvo.pares.filter((p: any) => p?.de && p?.para).map((p: any) => ({ de: String(p.de), para: String(p.para) }))
      : []
    if (!pares.length) return c.json({ error: 'Nenhuma categoria selecionada.' }, 400)
    const mapa = new Map(pares.map(p => [p.de, p.para]))
    alvoIds = desp.filter(d => mapa.has(String(d.categoria || '').trim())).map(d => d.id)
    resumo = `${pares.length} ${pares.length === 1 ? 'categoria renomeada' : 'categorias renomeadas'}`
    // Aplicação par a par, e não uma só: cada categoria vai para um destino.
    const antes = desp.filter(d => mapa.has(String(d.categoria || '').trim()))
      .map(d => ({ id: d.id, categoria: d.categoria }))
    for (const p of pares) {
      await c.env.DB.prepare(`UPDATE despesas SET categoria = ? WHERE user_id = ? AND categoria = ?`)
        .bind(p.para, user.id, p.de).run()
    }
    const acaoId = await registrarAcao(c.env.DB, user.id, tipo, resumo, antes)
    return c.json({ ok: true, afetadas: antes.length, resumo, acao_id: acaoId, mensagem: `${antes.length} lançamentos atualizados.` })
  } else if (tipo === 'parecidas') {
    const chaves: string[] = Array.isArray(alvo?.chaves) ? alvo.chaves.map(String) : []
    if (chaves.length < 2) return c.json({ error: 'Decisão sem identidades.' }, 400)
    // Fase 1: juntar duas identidades significa gravar que uma aponta para a
    // outra. Nenhuma despesa muda de categoria por causa disto — o efeito
    // aparece no agrupamento, não no dado.
    const grupos = agruparIdentidades(desp)
    const mestre = grupos.find(g => g.nome === escolha) || grupos.find(g => g.chave === chaves[0])
    if (!mestre) return c.json({ error: 'Identidade não encontrada — a fila mudou.' }, 409)
    for (const ch of chaves) {
      if (ch === mestre.chave) continue
      const g = grupos.find(x => x.chave === ch)
      await upsertIdentidade(c.env.DB, user.id, ch, g?.nome || ch, null, mestre.chave)
    }
    await upsertIdentidade(c.env.DB, user.id, mestre.chave, mestre.nome, null, null)
    const acaoId = await registrarAcao(c.env.DB, user.id, tipo, `"${mestre.nome}" agora agrupa ${chaves.length} nomes`, [])
    return c.json({ ok: true, afetadas: 0, resumo: `"${mestre.nome}" agora agrupa ${chaves.length} nomes`, acao_id: acaoId, mensagem: 'Identidades unidas.' })
  } else {
    return c.json({ error: `Tipo de decisão desconhecido: ${tipo}` }, 400)
  }

  if (!alvoIds.length) {
    return c.json({ ok: true, afetadas: 0, mensagem: 'Nada a mudar — já estava assim.' })
  }
  if (alvoIds.length > LIMITE_LOTE) {
    return c.json({ error: `Esta decisão afeta ${alvoIds.length} lançamentos, acima do limite de ${LIMITE_LOTE} de uma vez.` }, 400)
  }

  // O ANTES, linha a linha. É o que torna o desfazer confiável: voltar não é
  // inverter a operação, é reescrever o que estava lá.
  const porId = new Map(desp.map(d => [d.id, d]))
  const antes = alvoIds.map(i => ({ id: i, categoria: porId.get(i)?.categoria ?? null }))

  await atualizarCategorias(c.env.DB, user.id, alvoIds, escolha)

  // Grava a decisão na identidade: é o que faz valer também para o que o
  // usuário lançar amanhã, que é a promessa de "arrume uma vez".
  if (tipo === 'conflito' || tipo === 'sem_dono') {
    await upsertIdentidade(c.env.DB, user.id, String(alvo.chave), String(alvo.nome || alvo.chave), escolha, null)
  }

  const acaoId = await registrarAcao(c.env.DB, user.id, tipo, resumo, antes)
  if (decisaoId) await limparDispensa(c.env.DB, user.id, decisaoId)

  return c.json({
    ok: true, afetadas: alvoIds.length, resumo, acao_id: acaoId,
    mensagem: `${alvoIds.length} ${alvoIds.length === 1 ? 'lançamento atualizado' : 'lançamentos atualizados'}.`,
  })
})

// ── POST /api/organizador/decisoes/dispensar ────────────────────────────────
// "Depois" (volta em 30 dias) e "são coisas diferentes" (não volta).
router.post('/decisoes/dispensar', requireAuth, async (c) => {
  const user = c.get('user')
  const body = await c.req.json().catch(() => ({})) as any
  const decisaoId = String(body?.decisao_id || '').slice(0, 300)
  const motivo = body?.motivo === 'recusada' ? 'recusada' : 'adiada'
  if (!decisaoId) return c.json({ error: 'Informe a decisão.' }, 400)

  const ate = motivo === 'adiada'
    ? new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10)
    : null

  await c.env.DB.prepare(
    `INSERT INTO organizador_dispensas (user_id, decisao_id, motivo, ate)
     VALUES (?, ?, ?, ?)
     ON CONFLICT (user_id, decisao_id) DO UPDATE SET motivo = ?, ate = ?`
  ).bind(user.id, decisaoId, motivo, ate, motivo, ate).run()

  return c.json({
    ok: true,
    mensagem: motivo === 'adiada' ? 'Volto a perguntar em 30 dias.' : 'Não pergunto mais sobre isso.',
  })
})

// ── POST /api/organizador/desfazer ──────────────────────────────────────────
router.post('/desfazer', requireAuth, async (c) => {
  const user = c.get('user')
  const body = await c.req.json().catch(() => ({})) as any
  const acaoId = Number(body?.acao_id)
  if (!acaoId) return c.json({ error: 'Informe a ação.' }, 400)

  const acao = await c.env.DB.prepare(
    `SELECT id, tipo, resumo, antes, criado_em, desfeito_em FROM organizador_acoes
     WHERE id = ? AND user_id = ?`
  ).bind(acaoId, user.id).first() as any

  if (!acao) return c.json({ error: 'Ação não encontrada.' }, 404)
  if (acao.desfeito_em) return c.json({ error: 'Esta ação já foi desfeita.' }, 409)

  const limite = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10)
  if (String(acao.criado_em || '').slice(0, 10) < limite) {
    return c.json({ error: 'O prazo de 30 dias para desfazer esta ação já passou.' }, 409)
  }

  let antes: Array<{ id: number; categoria: string | null }> = []
  try { antes = JSON.parse(String(acao.antes || '[]')) } catch { antes = [] }

  let voltaram = 0
  for (const a of antes) {
    const r = await c.env.DB.prepare(
      `UPDATE despesas SET categoria = ? WHERE id = ? AND user_id = ?`
    ).bind(a.categoria, a.id, user.id).run()
    voltaram += r.meta?.changes || 0
  }

  await c.env.DB.prepare(
    `UPDATE organizador_acoes SET desfeito_em = ? WHERE id = ? AND user_id = ?`
  ).bind(new Date().toISOString().slice(0, 19).replace('T', ' '), acaoId, user.id).run()

  return c.json({ ok: true, voltaram, mensagem: `${voltaram} lançamentos voltaram ao que eram.` })
})

// ── Auxiliares de escrita ───────────────────────────────────────────────────

/** Teto por operação. Acima disso, algo está errado na detecção, não no dado. */
const LIMITE_LOTE = 2000

/**
 * UPDATE em lote com IN(...). Em fatias, porque uma lista de 2.000 marcadores
 * numa query só é o tipo de coisa que funciona em teste e estoura em produção.
 */
async function atualizarCategorias(db: D1Database, userId: number, ids: number[], categoria: string) {
  const FATIA = 200
  for (let i = 0; i < ids.length; i += FATIA) {
    const pedaco = ids.slice(i, i + FATIA)
    const ph = pedaco.map(() => '?').join(',')
    await db.prepare(
      `UPDATE despesas SET categoria = ? WHERE user_id = ? AND id IN (${ph})`
    ).bind(categoria, userId, ...pedaco).run()
  }
}

async function upsertIdentidade(
  db: D1Database, userId: number, chave: string, nome: string,
  categoria: string | null, chaveMestre: string | null,
) {
  try {
    await db.prepare(
      `INSERT INTO identidades (user_id, chave, nome, categoria, origem, confirmada, chave_mestre)
       VALUES (?, ?, ?, ?, 'usuario', 1, ?)
       ON CONFLICT (user_id, chave) DO UPDATE SET
         nome = ?, categoria = COALESCE(?, identidades.categoria),
         origem = 'usuario', confirmada = 1, chave_mestre = ?,
         updated_at = to_char((now() AT TIME ZONE 'UTC'),'YYYY-MM-DD HH24:MI:SS')`
    ).bind(userId, chave, nome, categoria, chaveMestre, nome, categoria, chaveMestre).run()
  } catch (e) {
    // A identidade é memória da decisão, não a decisão. Se a tabela ainda não
    // existe, as despesas já foram corrigidas e isso é o que importa agora.
    console.warn('[organizador] identidade não gravada:', (e as any)?.message)
  }
}

/** Guarda o antes. Sem isto, "aplicar aos 63" é uma aposta irreversível. */
async function registrarAcao(
  db: D1Database, userId: number, tipo: string, resumo: string,
  antes: Array<{ id: number; categoria: string | null }>,
): Promise<number | null> {
  try {
    const r = await db.prepare(
      `INSERT INTO organizador_acoes (user_id, tipo, resumo, afetados, antes)
       VALUES (?, ?, ?, ?, ?) RETURNING id`
    ).bind(userId, tipo, resumo, antes.length, JSON.stringify(antes.slice(0, LIMITE_LOTE))).first() as any
    return r?.id ? Number(r.id) : null
  } catch (e) {
    console.warn('[organizador] ação não registrada:', (e as any)?.message)
    return null
  }
}

async function limparDispensa(db: D1Database, userId: number, decisaoId: string) {
  try {
    await db.prepare(`DELETE FROM organizador_dispensas WHERE user_id = ? AND decisao_id = ?`)
      .bind(userId, decisaoId).run()
  } catch { /* tabela ainda não existe */ }
}

export default router
