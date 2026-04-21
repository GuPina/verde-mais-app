import { Hono } from 'hono'
import { requireAuth } from './auth'

type Bindings  = { DB: D1Database }
type Variables = { user: { id: number; nome: string; plano: string } }

async function verificarConquista(db: D1Database, userId: number, codigo: string) {
  await db.prepare(
    `INSERT OR IGNORE INTO conquistas_usuario (user_id, conquista_codigo, data_conquista, visualizado)
     VALUES (?, ?, datetime('now'), 0)`
  ).bind(userId, codigo).run().catch(() => {})
}

const tags = new Hono<{ Bindings: Bindings; Variables: Variables }>()

// ─── GET /api/tags ───────────────────────────────────────────────────────────
tags.get('/', requireAuth, async (c) => {
  const user = c.get('user')
  const rows = await c.env.DB.prepare(
    `SELECT t.id, t.nome, t.cor,
            COUNT(dt.despesa_id) as usos
     FROM tags t
     LEFT JOIN despesa_tags dt ON dt.tag_id = t.id
     LEFT JOIN despesas d ON d.id = dt.despesa_id
     WHERE t.user_id = ?
       AND (dt.despesa_id IS NULL OR (d.categoria NOT IN ('Financiamento','Investimento','Aporte') AND d.tipo != 'aporte'))
     GROUP BY t.id
     ORDER BY usos DESC, t.nome ASC`
  ).bind(user.id).all<{id:number;nome:string;cor:string;usos:number}>()

  return c.json(rows.results || [])
})

// ─── POST /api/tags ──────────────────────────────────────────────────────────
tags.post('/', requireAuth, async (c) => {
  const user = c.get('user')
  const { nome, cor = '#10B981' } = await c.req.json()

  if (!nome || nome.trim().length < 1) {
    return c.json({ error: 'Nome da tag é obrigatório' }, 400)
  }
  if (nome.trim().length > 30) {
    return c.json({ error: 'Nome da tag deve ter até 30 caracteres' }, 400)
  }
  if (!/^#[0-9A-Fa-f]{6}$/.test(cor)) {
    return c.json({ error: 'Cor inválida (use formato hex #RRGGBB)' }, 400)
  }

  try {
    await c.env.DB.prepare(
      `INSERT INTO tags (user_id, nome, cor) VALUES (?, ?, ?)`
    ).bind(user.id, nome.trim(), cor).run()

    const created = await c.env.DB.prepare(
      `SELECT id, nome, cor FROM tags WHERE user_id=? AND nome=? ORDER BY id DESC LIMIT 1`
    ).bind(user.id, nome.trim()).first<{id:number;nome:string;cor:string}>()

    // Bloco 5: conquista primeira_tag
    const totalTags = await c.env.DB.prepare(
      `SELECT COUNT(*) as cnt FROM tags WHERE user_id=?`
    ).bind(user.id).first() as any
    if ((totalTags?.cnt || 0) >= 1) await verificarConquista(c.env.DB, user.id, 'primeira_tag')

    return c.json(created, 201)
  } catch (e: any) {
    if (e?.message?.includes('UNIQUE')) {
      return c.json({ error: 'Você já tem uma tag com esse nome' }, 409)
    }
    throw e
  }
})

// ─── PATCH /api/tags/:id ─────────────────────────────────────────────────────
tags.patch('/:id', requireAuth, async (c) => {
  const user   = c.get('user')
  const tagId  = parseInt(c.req.param('id'))
  const { nome, cor } = await c.req.json()

  const tag = await c.env.DB.prepare(
    `SELECT id FROM tags WHERE id=? AND user_id=?`
  ).bind(tagId, user.id).first()

  if (!tag) return c.json({ error: 'Tag não encontrada' }, 404)

  const updates: string[] = []
  const vals: any[] = []
  if (nome) { updates.push('nome=?'); vals.push(nome.trim()) }
  if (cor)  { updates.push('cor=?');  vals.push(cor) }
  if (!updates.length) return c.json({ error: 'Nada a atualizar' }, 400)

  vals.push(tagId, user.id)
  await c.env.DB.prepare(
    `UPDATE tags SET ${updates.join(',')} WHERE id=? AND user_id=?`
  ).bind(...vals).run()

  return c.json({ success: true })
})

// ─── DELETE /api/tags/:id ────────────────────────────────────────────────────
tags.delete('/:id', requireAuth, async (c) => {
  const user  = c.get('user')
  const tagId = parseInt(c.req.param('id'))

  const tag = await c.env.DB.prepare(
    `SELECT id FROM tags WHERE id=? AND user_id=?`
  ).bind(tagId, user.id).first()

  if (!tag) return c.json({ error: 'Tag não encontrada' }, 404)

  // Desvincular de despesas E receitas antes de remover
  await c.env.DB.batch([
    c.env.DB.prepare(`DELETE FROM despesa_tags WHERE tag_id=?`).bind(tagId),
    c.env.DB.prepare(`DELETE FROM receita_tags  WHERE tag_id=?`).bind(tagId),
    c.env.DB.prepare(`DELETE FROM tags WHERE id=? AND user_id=?`).bind(tagId, user.id),
  ])

  return c.json({ success: true })
})

// ─── POST /api/tags/despesa/:despesaId ───────────────────────────────────────
// Vincular tags a uma despesa (substitui as existentes)
tags.post('/despesa/:despesaId', requireAuth, async (c) => {
  const user      = c.get('user')
  const despesaId = parseInt(c.req.param('despesaId'))
  const { tag_ids } = await c.req.json() as { tag_ids: number[] }

  // Verificar que a despesa pertence ao usuário e não é de categoria bloqueada
  const despesa = await c.env.DB.prepare(
    `SELECT id, categoria, tipo FROM despesas WHERE id=? AND user_id=?`
  ).bind(despesaId, user.id).first()

  if (!despesa) return c.json({ error: 'Despesa não encontrada' }, 404)

  // Bloquear tags em despesas de financiamento, aporte ou investimento
  const categoriasBloquadas = ['Financiamento', 'Investimento', 'Aporte']
  if (categoriasBloquadas.includes((despesa as any).categoria) || (despesa as any).tipo === 'aporte') {
    return c.json({ error: 'Não é possível vincular tags a despesas de financiamento, aporte ou investimento' }, 400)
  }

  // Verificar que as tags pertencem ao usuário
  if (tag_ids && tag_ids.length > 0) {
    const tagRows = await c.env.DB.prepare(
      `SELECT id FROM tags WHERE id IN (${tag_ids.map(() => '?').join(',')}) AND user_id=?`
    ).bind(...tag_ids, user.id).all<{id:number}>()

    if ((tagRows.results?.length || 0) !== tag_ids.length) {
      return c.json({ error: 'Uma ou mais tags inválidas' }, 400)
    }
  }

  // Limpar vínculos anteriores
  await c.env.DB.prepare(
    `DELETE FROM despesa_tags WHERE despesa_id=?`
  ).bind(despesaId).run()

  // Inserir novos vínculos com batch
  if (tag_ids && tag_ids.length > 0) {
    await c.env.DB.batch(
      tag_ids.map(tid =>
        c.env.DB.prepare(`INSERT OR IGNORE INTO despesa_tags (despesa_id, tag_id) VALUES (?, ?)`).bind(despesaId, tid)
      )
    )

    // Conquista: 5+ tags em uso
    const totalTagged = await c.env.DB.prepare(
      `SELECT COUNT(DISTINCT despesa_id) as cnt FROM despesa_tags dt
       JOIN despesas d ON d.id = dt.despesa_id WHERE d.user_id=?`
    ).bind(user.id).first<{cnt:number}>()

    if ((totalTagged?.cnt || 0) >= 5) {
      await c.env.DB.prepare(
        `INSERT OR IGNORE INTO conquistas_usuario (user_id, conquista_codigo, data_conquista, visualizado)
         VALUES (?, 'tagger', datetime('now'), 0)`
      ).bind(user.id).run().catch(() => {})
    }

    // Bloco 5: mestre_tags — classificou 50+ despesas com tags
    if ((totalTagged?.cnt || 0) >= 50) {
      await verificarConquista(c.env.DB, user.id, 'mestre_tags')
    }
  }

  return c.json({ success: true, vinculadas: tag_ids?.length || 0 })
})

// ─── GET /api/tags/despesa/:despesaId ────────────────────────────────────────
tags.get('/despesa/:despesaId', requireAuth, async (c) => {
  const user      = c.get('user')
  const despesaId = parseInt(c.req.param('despesaId'))

  const despesa = await c.env.DB.prepare(
    `SELECT id FROM despesas WHERE id=? AND user_id=?`
  ).bind(despesaId, user.id).first()

  if (!despesa) return c.json({ error: 'Despesa não encontrada' }, 404)

  const rows = await c.env.DB.prepare(
    `SELECT t.id, t.nome, t.cor FROM tags t
     JOIN despesa_tags dt ON dt.tag_id = t.id
     WHERE dt.despesa_id=?`
  ).bind(despesaId).all<{id:number;nome:string;cor:string}>()

  return c.json(rows.results || [])
})

// ─── GET /api/tags/autocomplete?q=texto ─────────────────────────────────────
// Buscar TAGS pelo nome (para autocomplete em formulários)
tags.get('/autocomplete', requireAuth, async (c) => {
  const user = c.get('user')
  const q    = c.req.query('q') || ''

  const rows = await c.env.DB.prepare(
    `SELECT id, nome, cor,
            (SELECT COUNT(*) FROM despesa_tags WHERE tag_id=t.id) as usos
     FROM tags t
     WHERE user_id=? AND nome LIKE ?
     ORDER BY usos DESC, nome ASC
     LIMIT 10`
  ).bind(user.id, `%${q}%`).all<{id:number;nome:string;cor:string;usos:number}>()

  return c.json(rows.results || [])
})

// ─── GET /api/tags/buscar?q=texto ────────────────────────────────────────────
// Buscar despesas por tag (retorna despesas cujas tags contenham o texto)
tags.get('/buscar', requireAuth, async (c) => {
  const user   = c.get('user')
  const tagId  = parseInt(c.req.query('tag_id') || '0')
  const q      = c.req.query('q') || ''

  if (!tagId && !q) return c.json({ error: 'Informe tag_id ou q' }, 400)

  let rows
  if (tagId) {
    rows = await c.env.DB.prepare(
      `SELECT d.*, t.nome as tag_nome, t.cor as tag_cor
       FROM despesas d
       JOIN despesa_tags dt ON dt.despesa_id = d.id
       JOIN tags t ON t.id = dt.tag_id
       WHERE d.user_id=? AND t.id=?
         AND d.categoria NOT IN ('Financiamento','Investimento','Aporte')
         AND d.tipo != 'aporte'
       ORDER BY d.data DESC
       LIMIT 100`
    ).bind(user.id, tagId).all()
  } else {
    rows = await c.env.DB.prepare(
      `SELECT d.*, t.nome as tag_nome, t.cor as tag_cor
       FROM despesas d
       JOIN despesa_tags dt ON dt.despesa_id = d.id
       JOIN tags t ON t.id = dt.tag_id
       WHERE d.user_id=? AND t.nome LIKE ?
         AND d.categoria NOT IN ('Financiamento','Investimento','Aporte')
         AND d.tipo != 'aporte'
       ORDER BY d.data DESC
       LIMIT 100`
    ).bind(user.id, `%${q}%`).all()
  }

  return c.json(rows.results || [])
})

// ─── MELHORIA 3.3: Tags para Receitas ────────────────────────────────────────

// POST /api/tags/receita/:receitaId — vincular tag a receita
tags.post('/receita/:receitaId', requireAuth, async (c) => {
  const user     = c.get('user')
  const receitaId = parseInt(c.req.param('receitaId'))
  const { tag_ids } = await c.req.json() as { tag_ids: number[] }

  const receita = await c.env.DB.prepare(
    `SELECT id FROM receitas WHERE id=? AND user_id=?`
  ).bind(receitaId, user.id).first()
  if (!receita) return c.json({ error: 'Receita não encontrada' }, 404)

  // Verificar tags do usuário
  if (tag_ids && tag_ids.length > 0) {
    const tagRows = await c.env.DB.prepare(
      `SELECT id FROM tags WHERE id IN (${tag_ids.map(() => '?').join(',')}) AND user_id=?`
    ).bind(...tag_ids, user.id).all<{id:number}>()
    if ((tagRows.results?.length || 0) !== tag_ids.length) {
      return c.json({ error: 'Uma ou mais tags inválidas' }, 400)
    }
  }

  // Limpar e reinserir com batch
  await c.env.DB.prepare(`DELETE FROM receita_tags WHERE receita_id=?`).bind(receitaId).run()
  if (tag_ids && tag_ids.length > 0) {
    await c.env.DB.batch(
      tag_ids.map(tid =>
        c.env.DB.prepare(`INSERT OR IGNORE INTO receita_tags (receita_id, tag_id) VALUES (?, ?)`).bind(receitaId, tid)
      )
    )
  }

  return c.json({ success: true, vinculadas: tag_ids?.length || 0 })
})

// GET /api/tags/receita/:receitaId — buscar tags de uma receita
tags.get('/receita/:receitaId', requireAuth, async (c) => {
  const user     = c.get('user')
  const receitaId = parseInt(c.req.param('receitaId'))

  const receita = await c.env.DB.prepare(
    `SELECT id FROM receitas WHERE id=? AND user_id=?`
  ).bind(receitaId, user.id).first()
  if (!receita) return c.json({ error: 'Receita não encontrada' }, 404)

  const rows = await c.env.DB.prepare(
    `SELECT t.id, t.nome, t.cor FROM tags t
     JOIN receita_tags rt ON rt.tag_id = t.id
     WHERE rt.receita_id=?`
  ).bind(receitaId).all<{id:number;nome:string;cor:string}>()

  return c.json(rows.results || [])
})

// GET /api/tags/analise — Top gastos por tag (Melhoria 3.3 Dashboard)
tags.get('/analise', requireAuth, async (c) => {
  const user = c.get('user')
  const { mes, ano, limit = '10' } = c.req.query()

  // Default: mês e ano atuais se não fornecidos
  const now = new Date()
  const mesStr = mes ? String(mes).padStart(2, '0') : String(now.getMonth() + 1).padStart(2, '0')
  const anoStr = ano || String(now.getFullYear())

  // Análise de despesas por tag no período
  const sqlDespesas = `
    SELECT t.id, t.nome, t.cor,
           COUNT(DISTINCT dt.despesa_id) as qtd_despesas,
           COALESCE(SUM(d.valor), 0) as total_gasto
    FROM tags t
    JOIN despesa_tags dt ON dt.tag_id = t.id
    JOIN despesas d ON d.id = dt.despesa_id
    WHERE t.user_id = ? AND d.user_id = ?
      AND strftime('%m', d.data) = ? AND strftime('%Y', d.data) = ?
      AND d.status != 'cancelado'
    GROUP BY t.id, t.nome, t.cor
    ORDER BY total_gasto DESC
    LIMIT ?
  `
  const rowsDesp = await c.env.DB.prepare(sqlDespesas)
    .bind(user.id, user.id, mesStr, anoStr, parseInt(limit)).all()

  // Análise de receitas por tag no período
  const sqlReceitas = `
    SELECT t.id, t.nome, t.cor,
           COUNT(DISTINCT rt.receita_id) as qtd_receitas,
           COALESCE(SUM(r.valor), 0) as total_receita
    FROM tags t
    JOIN receita_tags rt ON rt.tag_id = t.id
    JOIN receitas r ON r.id = rt.receita_id
    WHERE t.user_id = ? AND r.user_id = ?
      AND strftime('%m', r.data) = ? AND strftime('%Y', r.data) = ?
    GROUP BY t.id, t.nome, t.cor
    ORDER BY total_receita DESC
    LIMIT ?
  `
  let rowsRec: any = { results: [] }
  try {
    rowsRec = await c.env.DB.prepare(sqlReceitas)
      .bind(user.id, user.id, mesStr, anoStr, parseInt(limit)).all()
  } catch(_) {}

  // Totais gerais do período para calcular percentuais
  const totals = await c.env.DB.prepare(
    `SELECT COALESCE(SUM(valor),0) as total FROM despesas WHERE user_id=? AND strftime('%m',data)=? AND strftime('%Y',data)=? AND status != 'cancelado'`
  ).bind(user.id, mesStr, anoStr).first() as any
  const totalGeral = parseFloat(totals?.total || 0)

  const tags_analise = (rowsDesp.results || []).map((t: any) => ({
    ...t,
    total_gasto: parseFloat(t.total_gasto || 0),
    percentual: totalGeral > 0 ? Math.round((parseFloat(t.total_gasto || 0) / totalGeral) * 100) : 0,
  }))

  return c.json({
    tags_analise,
    tags_receita: rowsRec.results || [],
    mes: parseInt(mesStr),
    ano: parseInt(anoStr),
    total_despesas_periodo: totalGeral,
  })
})

// ─── POST /api/tags/mesclar — Mesclar tags: migra lançamentos da tag origem para destino ──
// Body: { tag_origem_id: number, tag_destino_id: number }
tags.post('/mesclar', requireAuth, async (c) => {
  const user = c.get('user')
  const { tag_origem_id, tag_destino_id } = await c.req.json().catch(() => ({} as any))

  if (!tag_origem_id || !tag_destino_id)
    return c.json({ error: 'tag_origem_id e tag_destino_id são obrigatórios' }, 400)
  if (tag_origem_id === tag_destino_id)
    return c.json({ error: 'As tags de origem e destino devem ser diferentes' }, 400)

  // Verificar que ambas pertencem ao usuário
  const origem = await c.env.DB.prepare(
    `SELECT id, nome FROM tags WHERE id = ? AND user_id = ?`
  ).bind(tag_origem_id, user.id).first() as any
  if (!origem) return c.json({ error: 'Tag de origem não encontrada' }, 404)

  const destino = await c.env.DB.prepare(
    `SELECT id, nome FROM tags WHERE id = ? AND user_id = ?`
  ).bind(tag_destino_id, user.id).first() as any
  if (!destino) return c.json({ error: 'Tag de destino não encontrada' }, 404)

  // Migrar despesa_tags: se já existe associação com destino, apenas remover a origem
  // Se não existe, atualizar origem → destino
  const despesasComDestino = await c.env.DB.prepare(
    `SELECT despesa_id FROM despesa_tags WHERE tag_id = ? AND despesa_id IN
     (SELECT despesa_id FROM despesa_tags WHERE tag_id = ?)`
  ).bind(tag_destino_id, tag_origem_id).all<any>()

  const dupDespesas = new Set((despesasComDestino.results || []).map((r: any) => r.despesa_id))

  // Atualizar as que não têm duplicata
  await c.env.DB.prepare(
    `UPDATE despesa_tags SET tag_id = ? WHERE tag_id = ? AND despesa_id NOT IN
     (SELECT despesa_id FROM despesa_tags WHERE tag_id = ?)`
  ).bind(tag_destino_id, tag_origem_id, tag_destino_id).run()

  // Remover os que eram duplicatas
  await c.env.DB.prepare(
    `DELETE FROM despesa_tags WHERE tag_id = ?`
  ).bind(tag_origem_id).run()

  // Migrar receita_tags da mesma forma
  await c.env.DB.prepare(
    `UPDATE receita_tags SET tag_id = ? WHERE tag_id = ? AND receita_id NOT IN
     (SELECT receita_id FROM receita_tags WHERE tag_id = ?)`
  ).bind(tag_destino_id, tag_origem_id, tag_destino_id).run()

  await c.env.DB.prepare(
    `DELETE FROM receita_tags WHERE tag_id = ?`
  ).bind(tag_origem_id).run()

  // Deletar a tag de origem
  await c.env.DB.prepare(
    `DELETE FROM tags WHERE id = ? AND user_id = ?`
  ).bind(tag_origem_id, user.id).run()

  return c.json({
    success: true,
    origem: origem.nome,
    destino: destino.nome,
    message: `Tag "${origem.nome}" mesclada em "${destino.nome}" com sucesso`
  })
})

// ─── GET /api/tags/sugestoes-mesclar — Detecta tags similares para sugerir mesclagem ──
tags.get('/sugestoes-mesclar', requireAuth, async (c) => {
  const user = c.get('user')

  const allTags = await c.env.DB.prepare(
    `SELECT t.id, t.nome, t.cor, COUNT(dt.despesa_id) as uso
     FROM tags t
     LEFT JOIN despesa_tags dt ON dt.tag_id = t.id
     WHERE t.user_id = ?
     GROUP BY t.id ORDER BY t.nome`
  ).bind(user.id).all<any>()

  const tags_list = allTags.results || []

  // Detectar tags similares por normalização
  const normalizar = (s: string) =>
    s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '').trim()

  const sugestoes: Array<{ tag_a: any; tag_b: any; similaridade: string }> = []
  const processados = new Set<string>()

  for (let i = 0; i < tags_list.length; i++) {
    for (let j = i + 1; j < tags_list.length; j++) {
      const a = tags_list[i], b = tags_list[j]
      const nA = normalizar(a.nome), nB = normalizar(b.nome)
      const chave = `${Math.min(a.id,b.id)}-${Math.max(a.id,b.id)}`
      if (processados.has(chave)) continue

      let motivo = ''
      // Substring de 3+ chars
      if (nA.length >= 3 && nB.includes(nA)) motivo = `"${b.nome}" contém "${a.nome}"`
      else if (nB.length >= 3 && nA.includes(nB)) motivo = `"${a.nome}" contém "${b.nome}"`
      // Normalização idêntica
      else if (nA === nB) motivo = 'Nomes idênticos após normalização'
      // Prefixo comum longo (>= 4 chars)
      else {
        const minLen = Math.min(nA.length, nB.length)
        let prefixo = 0
        for (let k = 0; k < minLen; k++) { if (nA[k] === nB[k]) prefixo++; else break }
        if (prefixo >= 4 && prefixo >= minLen * 0.7) motivo = `Prefixo comum: "${nA.substring(0, prefixo)}"`
      }

      if (motivo) {
        processados.add(chave)
        sugestoes.push({ tag_a: a, tag_b: b, similaridade: motivo })
      }
    }
  }

  return c.json({ sugestoes, total: sugestoes.length })
})

// ─── GET /api/tags/despesas-sem-tag ──────────────────────────────────────────
// Lista despesas sem nenhuma tag vinculada, com paginação (20/página)
// Query params: pagina (default 1), limit (default 20, max 50)
tags.get('/despesas-sem-tag', requireAuth, async (c) => {
  const user   = c.get('user')
  const pagina = Math.max(1, parseInt(c.req.query('pagina') || '1'))
  const limit  = Math.min(50, Math.max(1, parseInt(c.req.query('limit') || '20')))
  const offset = (pagina - 1) * limit

  // Total de despesas sem tag (excluindo parceladas que não são a parcela 1 para não poluir)
  const totalRow = await c.env.DB.prepare(
    `SELECT COUNT(*) as total
     FROM despesas d
     WHERE d.user_id = ?
       AND d.tipo != 'aporte'
       AND NOT EXISTS (
         SELECT 1 FROM despesa_tags dt WHERE dt.despesa_id = d.id
       )`
  ).bind(user.id).first<{ total: number }>()

  const total = totalRow?.total || 0

  // Despesas paginadas
  const rows = await c.env.DB.prepare(
    `SELECT d.id, d.descricao, d.data, d.valor, d.categoria, d.status,
            d.vencimento, d.parcela_atual, d.numero_parcelas, d.parcelado
     FROM despesas d
     WHERE d.user_id = ?
       AND d.tipo != 'aporte'
       AND NOT EXISTS (
         SELECT 1 FROM despesa_tags dt WHERE dt.despesa_id = d.id
       )
     ORDER BY d.data DESC, d.id DESC
     LIMIT ? OFFSET ?`
  ).bind(user.id, limit, offset).all<any>()

  // Buscar todas as tags do usuário para o dropdown
  const tagsUsuario = await c.env.DB.prepare(
    `SELECT id, nome, cor FROM tags WHERE user_id = ? ORDER BY nome ASC`
  ).bind(user.id).all<any>()

  return c.json({
    despesas:     rows.results || [],
    tags_usuario: tagsUsuario.results || [],
    total,
    pagina,
    limit,
    total_paginas: Math.ceil(total / limit),
  })
})

// ─── POST /api/tags/aplicar-em-lote ──────────────────────────────────────────
// Vincula tags em múltiplas despesas de uma vez.
// Cria automaticamente tags novas se necessário.
// Body: { aplicacoes: [{ despesa_id, tag_nome, tag_id? }] }
tags.post('/aplicar-em-lote', requireAuth, async (c) => {
  const user = c.get('user')
  const { aplicacoes } = await c.req.json().catch(() => ({ aplicacoes: [] }))

  if (!Array.isArray(aplicacoes) || aplicacoes.length === 0)
    return c.json({ error: 'aplicacoes deve ser um array não vazio' }, 400)

  // Limitar a 100 por vez para segurança
  const lista = aplicacoes.slice(0, 100)

  let vinculadas  = 0
  let criadas     = 0
  const erros: string[] = []

  // Cache de tags criadas nesta operação (nome → id)
  const tagCache: Record<string, number> = {}

  for (const item of lista) {
    try {
      const despesaId = item.despesa_id
      if (!despesaId) continue

      // Verificar que a despesa pertence ao usuário
      const desp = await c.env.DB.prepare(
        `SELECT id FROM despesas WHERE id = ? AND user_id = ?`
      ).bind(despesaId, user.id).first<{ id: number }>()
      if (!desp) continue

      let tagId: number | null = item.tag_id || null

      // Se vier tag_id, validar ownership
      if (tagId) {
        const tagExiste = await c.env.DB.prepare(
          `SELECT id FROM tags WHERE id = ? AND user_id = ?`
        ).bind(tagId, user.id).first<{ id: number }>()
        if (!tagExiste) tagId = null
      }

      // Se vier tag_nome mas não tag_id — buscar ou criar
      if (!tagId && item.tag_nome) {
        const nomeNorm = item.tag_nome.trim().substring(0, 30)

        // Verificar cache desta operação
        if (tagCache[nomeNorm]) {
          tagId = tagCache[nomeNorm]
        } else {
          // Buscar existente (case-insensitive)
          const existing = await c.env.DB.prepare(
            `SELECT id FROM tags WHERE user_id = ? AND LOWER(nome) = LOWER(?)`
          ).bind(user.id, nomeNorm).first<{ id: number }>()

          if (existing) {
            tagId = existing.id
            tagCache[nomeNorm] = tagId
          } else {
            // Criar nova tag com cor padrão
            const cores = ['#10B981','#3B82F6','#8B5CF6','#F59E0B','#F43F5E','#06B6D4','#84CC16','#EC4899']
            const cor   = cores[Math.floor(Math.random() * cores.length)]
            const nova  = await c.env.DB.prepare(
              `INSERT INTO tags (user_id, nome, cor) VALUES (?, ?, ?) RETURNING id`
            ).bind(user.id, nomeNorm, cor).first<{ id: number }>()
            if (nova?.id) {
              tagId = nova.id
              tagCache[nomeNorm] = tagId
              criadas++
            }
          }
        }
      }

      if (!tagId) continue

      // Vincular (INSERT OR IGNORE para evitar duplicata)
      await c.env.DB.prepare(
        `INSERT OR IGNORE INTO despesa_tags (despesa_id, tag_id) VALUES (?, ?)`
      ).bind(despesaId, tagId).run()

      vinculadas++
    } catch (e: any) {
      erros.push(`despesa ${item.despesa_id}: ${e?.message || 'erro'}`)
    }
  }

  return c.json({
    success:   true,
    vinculadas,
    criadas,
    erros,
    message:   `${vinculadas} despesa${vinculadas !== 1 ? 's' : ''} atualizada${vinculadas !== 1 ? 's' : ''}${criadas > 0 ? `, ${criadas} tag${criadas !== 1 ? 's' : ''} criada${criadas !== 1 ? 's' : ''}` : ''}`
  })
})

export default tags
