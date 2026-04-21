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

  const enriched = rows.map(r => ({
    ...r,
    valor:          Number(r.valor),
    ultimo_valor:   r.ultimo_valor ? Number(r.ultimo_valor) : null,
    valor_variavel: r.valor_variavel === 1 || r.valor_variavel === true,
    gerada_mes_atual: r.ultimo_gerado
      ? r.ultimo_gerado >= `${ano}-${String(mes).padStart(2,'0')}-01`
      : false
  }))

  const resumo = {
    total:          rows.length,
    ativas:         rows.filter(r => r.ativa).length,
    total_despesas: rows.filter(r => r.tipo === 'despesa' && r.ativa && !r.valor_variavel)
                        .reduce((s, r) => s + Number(r.valor), 0),
    total_receitas: rows.filter(r => r.tipo === 'receita' && r.ativa && !r.valor_variavel)
                        .reduce((s, r) => s + Number(r.valor), 0),
  }

  return c.json({ recorrencias: enriched, resumo })
})

// ─────────────────────────────────────────────────────────────────────────────
// S-R1: GET /api/recorrencias/resumo — visão consolidada
// ANTES de /:id para não ser capturado como parâmetro
// ─────────────────────────────────────────────────────────────────────────────
recorrencias.get('/resumo', requireAuth, async (c) => {
  const user = c.get('user')

  const rows = await c.env.DB.prepare(
    `SELECT tipo, valor, valor_variavel, ativa FROM recorrencias WHERE user_id = ?`
  ).bind(user.id).all()

  const all = rows.results as any[]
  const ativas = all.filter(r => r.ativa)

  const totalDespesas = ativas
    .filter(r => r.tipo === 'despesa' && !r.valor_variavel)
    .reduce((s, r) => s + Number(r.valor), 0)

  const totalReceitas = ativas
    .filter(r => r.tipo === 'receita' && !r.valor_variavel)
    .reduce((s, r) => s + Number(r.valor), 0)

  const variaveisPendentes = ativas.filter(r => r.valor_variavel).length

  return c.json({
    total: all.length,
    ativas: ativas.length,
    inativas: all.length - ativas.length,
    total_despesas: Math.round(totalDespesas * 100) / 100,
    total_receitas: Math.round(totalReceitas * 100) / 100,
    saldo_projetado: Math.round((totalReceitas - totalDespesas) * 100) / 100,
    variaveis_pendentes: variaveisPendentes,
    // projeção para os próximos 3 meses (só fixas)
    projecao_3meses: {
      despesas: Math.round(totalDespesas * 3 * 100) / 100,
      receitas: Math.round(totalReceitas * 3 * 100) / 100,
      saldo:    Math.round((totalReceitas - totalDespesas) * 3 * 100) / 100,
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// S-R2: GET /api/recorrencias/:id/projecao?meses=6
// Projeta lançamentos dos próximos N meses para uma recorrência
// ANTES de /:id/historico para clareza de roteamento
// ─────────────────────────────────────────────────────────────────────────────
recorrencias.get('/:id/projecao', requireAuth, async (c) => {
  const user  = c.get('user')
  const id    = c.req.param('id')
  const meses = Math.min(parseInt(c.req.query('meses') || '6'), 24)

  const rec = await c.env.DB.prepare(
    `SELECT * FROM recorrencias WHERE id = ? AND user_id = ?`
  ).bind(id, user.id).first() as any
  if (!rec) return c.json({ error: 'Recorrência não encontrada' }, 404)

  const hoje = new Date()
  const projecao = []
  let totalProjetado = 0

  for (let i = 0; i < meses; i++) {
    const d    = new Date(hoje.getFullYear(), hoje.getMonth() + i, 1)
    const mes  = d.getMonth() + 1
    const ano  = d.getFullYear()
    const mesStr = String(mes).padStart(2, '0')
    const lastDay = new Date(ano, mes, 0).getDate()
    const dia = Math.min(rec.dia_vencimento || 1, lastDay)
    const data = `${ano}-${mesStr}-${String(dia).padStart(2,'0')}`

    // Verificar se data_fim não passou
    const expirou = rec.data_fim && data > rec.data_fim
    // Verificar se já foi lançada
    const jaLancada = rec.ultimo_gerado && rec.ultimo_gerado >= `${ano}-${mesStr}-01`

    const valorMes = rec.valor_variavel ? null : Number(rec.valor)
    totalProjetado += valorMes || 0

    projecao.push({
      mes, ano,
      label: `${mesStr}/${ano}`,
      data,
      valor: valorMes,
      valor_variavel: rec.valor_variavel === 1,
      ja_lancada: !!jaLancada,
      expirada: !!expirou,
      status: expirou ? 'expirada' : jaLancada ? 'lancada' : 'pendente'
    })
  }

  return c.json({
    recorrencia_id: rec.id,
    descricao: rec.descricao,
    tipo: rec.tipo,
    categoria: rec.categoria,
    valor_fixo: rec.valor_variavel ? null : Number(rec.valor),
    meses,
    total_projetado: Math.round(totalProjetado * 100) / 100,
    projecao
  })
})

// ─── GET /api/recorrencias/:id/historico ─────────────────────────────────────
recorrencias.get('/:id/historico', requireAuth, async (c) => {
  const user  = c.get('user')
  const id    = c.req.param('id')
  const limit = parseInt(c.req.query('limit') || '6')

  const rec = await c.env.DB.prepare(
    `SELECT id, descricao, tipo, valor_variavel FROM recorrencias WHERE id = ? AND user_id = ?`
  ).bind(id, user.id).first() as any
  if (!rec) return c.json({ error: 'Recorrência não encontrada' }, 404)

  const hist = await c.env.DB.prepare(
    `SELECT mes, ano, valor, observacao, lancado_em
     FROM recorrencias_historico
     WHERE recorrencia_id = ? AND user_id = ?
     ORDER BY ano DESC, mes DESC LIMIT ?`
  ).bind(id, user.id, limit).all()

  return c.json({
    recorrencia_id: rec.id,
    descricao:      rec.descricao,
    tipo:           rec.tipo,
    valor_variavel: rec.valor_variavel === 1,
    historico:      hist.results
  })
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
  const {
    tipo, descricao, valor, categoria, dia_vencimento,
    meio_pagamento = 'outros', data_fim = null,
    valor_variavel = false,
    data_inicio = null,    // S-R3
    notas = null,          // S-R5
    tags = null            // S-R5
  } = body

  if (!tipo || !descricao || !categoria || !dia_vencimento) {
    return c.json({ error: 'Campos obrigatórios: tipo, descricao, categoria, dia_vencimento' }, 400)
  }
  if (!['despesa', 'receita'].includes(tipo)) {
    return c.json({ error: 'tipo deve ser: despesa ou receita' }, 400)
  }
  if (!valor_variavel && (!valor || Number(valor) <= 0)) {
    return c.json({ error: 'Informe um valor maior que zero para recorrências fixas' }, 400)
  }
  // S-R3: validar data_inicio se fornecida
  if (data_inicio && isNaN(Date.parse(data_inicio))) {
    return c.json({ error: 'data_inicio inválida. Use formato YYYY-MM-DD' }, 400)
  }

  const valorSalvo  = valor_variavel ? (Number(valor) || 0) : Number(valor)
  const tagsStr     = Array.isArray(tags) ? JSON.stringify(tags) : (tags || null)

  const res = await c.env.DB.prepare(
    `INSERT INTO recorrencias
       (user_id, tipo, descricao, valor, categoria, dia_vencimento, meio_pagamento,
        data_fim, valor_variavel, data_inicio, notas, tags)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    user.id, tipo, descricao, valorSalvo, categoria, dia_vencimento,
    meio_pagamento, data_fim, valor_variavel ? 1 : 0,
    data_inicio, notas || null, tagsStr
  ).run()

  await verificarConquista(c.env.DB, user.id, 'automatico')

  const count = await c.env.DB.prepare(
    `SELECT COUNT(*) as n FROM recorrencias WHERE user_id = ? AND ativa = 1`
  ).bind(user.id).first() as any
  if ((count?.n || 0) >= 5) await verificarConquista(c.env.DB, user.id, 'recorrente_pro')

  return c.json({ success: true, id: res.meta.last_row_id })
})

// ─── PUT /api/recorrencias/:id — S-R5: suporte a notas e tags ────────────────
recorrencias.put('/:id', requireAuth, async (c) => {
  const user = c.get('user')
  const id   = c.req.param('id')

  const recAtual = await c.env.DB.prepare(
    `SELECT * FROM recorrencias WHERE id = ? AND user_id = ?`
  ).bind(id, user.id).first() as any
  if (!recAtual) return c.json({ error: 'Recorrência não encontrada' }, 404)

  const body = await c.req.json()
  const { valor, meio_pagamento, data_fim, valor_variavel, data_inicio, notas, tags } = body

  const descricao      = body.descricao      ?? recAtual.descricao
  const categoria      = body.categoria      ?? recAtual.categoria
  const dia_vencimento = body.dia_vencimento !== undefined ? body.dia_vencimento : recAtual.dia_vencimento

  const vv         = valor_variavel !== undefined ? valor_variavel : (recAtual.valor_variavel === 1)
  const valorFinal = valor !== undefined ? Number(valor) : recAtual.valor
  const valorSalvo = vv ? (valorFinal || 0) : valorFinal
  const mpFinal    = meio_pagamento  ?? recAtual.meio_pagamento ?? 'outros'
  const dfFinal    = data_fim        !== undefined ? data_fim : recAtual.data_fim
  const diFinal    = data_inicio     !== undefined ? data_inicio : recAtual.data_inicio
  const notasFinal = notas           !== undefined ? (notas || null) : recAtual.notas
  const tagsFinal  = tags !== undefined
    ? (Array.isArray(tags) ? JSON.stringify(tags) : (tags || null))
    : recAtual.tags

  await c.env.DB.prepare(
    `UPDATE recorrencias
     SET descricao=?, valor=?, categoria=?, dia_vencimento=?,
         meio_pagamento=?, data_fim=?, valor_variavel=?,
         data_inicio=?, notas=?, tags=?
     WHERE id = ? AND user_id = ?`
  ).bind(
    descricao, valorSalvo, categoria, dia_vencimento,
    mpFinal, dfFinal, vv ? 1 : 0,
    diFinal, notasFinal, tagsFinal, id, user.id
  ).run()

  // Propagar alterações para despesas/receitas futuras vinculadas a esta recorrência
  const propagarPara = body.propagar_futuras ?? false
  if (propagarPara) {
    const hoje = new Date().toISOString().split('T')[0]
    try {
      if (recAtual.tipo === 'receita') {
        await c.env.DB.prepare(
          `UPDATE receitas SET descricao=?, valor=?, categoria=?, meio_pagamento=?
           WHERE recorrencia_id=? AND user_id=? AND data >= ? AND status='pendente'`
        ).bind(descricao, valorSalvo, categoria, mpFinal, id, user.id, hoje).run()
      } else {
        await c.env.DB.prepare(
          `UPDATE despesas SET descricao=?, valor=?, categoria=?, meio_pagamento=?
           WHERE recorrencia_id=? AND user_id=? AND vencimento >= ? AND status='pendente'`
        ).bind(descricao, valorSalvo, categoria, mpFinal, id, user.id, hoje).run()
      }
    } catch (e: any) {
      // Coluna recorrencia_id pode não existir em versões antigas — apenas ignora
      console.error('[recorrencias] propagar_futuras error:', e?.message)
    }
  }

  return c.json({ success: true, propagadas: propagarPara })
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

  const rec = await c.env.DB.prepare(
    `SELECT id, tipo FROM recorrencias WHERE id = ? AND user_id = ?`
  ).bind(id, user.id).first() as any
  if (!rec) return c.json({ error: 'Recorrência não encontrada' }, 404)

  // Verificar se deve excluir também os lançamentos futuros pendentes
  // Aceita query param (?excluir_futuros=true) — body é ignorado em DELETE pelo Cloudflare Workers
  const qp = c.req.query('excluir_futuros')
  let bodyExcluir = false
  try {
    const ct = c.req.header('content-type') || ''
    if (ct.includes('application/json')) {
      const bd = await c.req.json() as any
      bodyExcluir = bd?.excluir_futuros === true || bd?.excluir_futuros === 'true'
    }
  } catch (_) {}
  const excluirFuturos = qp === 'true' || qp === '1' || bodyExcluir

  // Buscar tipo ANTES de deletar a recorrência (necessário para saber se é receita ou despesa)
  const recTipo = (rec as any).tipo || 'despesa'

  if (excluirFuturos) {
    const hoje = new Date().toISOString().split('T')[0]
    try {
      if (recTipo === 'receita') {
        await c.env.DB.prepare(
          `DELETE FROM receitas WHERE recorrencia_id=? AND user_id=? AND data >= ? AND status='pendente'`
        ).bind(id, user.id, hoje).run()
      } else {
        await c.env.DB.prepare(
          `DELETE FROM despesas WHERE recorrencia_id=? AND user_id=? AND vencimento >= ? AND status='pendente'`
        ).bind(id, user.id, hoje).run()
      }
    } catch (e: any) {
      // Coluna recorrencia_id pode não existir — fallback por descricao + recorrente=1
      console.error('[recorrencias] excluir_futuros error:', e?.message)
    }
  }

  await c.env.DB.prepare(
    `DELETE FROM recorrencias WHERE id = ? AND user_id = ?`
  ).bind(id, user.id).run()

  return c.json({ success: true, futuros_excluidos: excluirFuturos })
})

// ─── POST /api/recorrencias/:id/lancar ───────────────────────────────────────
recorrencias.post('/:id/lancar', requireAuth, async (c) => {
  const user = c.get('user')
  const id   = c.req.param('id')

  const rec = await c.env.DB.prepare(
    `SELECT * FROM recorrencias WHERE id = ? AND user_id = ?`
  ).bind(id, user.id).first() as any
  if (!rec) return c.json({ error: 'Recorrência não encontrada' }, 404)
  if (!rec.ativa) return c.json({ error: 'Recorrência está pausada' }, 400)

  const body = await c.req.json()
  const hoje = new Date()
  const mes  = body.mes ? parseInt(body.mes) : (hoje.getMonth() + 1)
  const ano  = body.ano ? parseInt(body.ano) : hoje.getFullYear()
  const observacao = body.observacao || null

  // S-R3: respeitar data_inicio
  if (rec.data_inicio) {
    const mesStr0 = String(mes).padStart(2, '0')
    if (`${ano}-${mesStr0}-01` < rec.data_inicio.substring(0, 7) + '-01') {
      return c.json({ error: `Esta recorrência inicia em ${rec.data_inicio}` }, 400)
    }
  }

  const ehVariavel = rec.valor_variavel === 1 || rec.valor_variavel === true
  let valorLancar: number

  if (ehVariavel) {
    if (body.valor === undefined || body.valor === null || body.valor === '')
      return c.json({ error: 'Informe o valor para esta recorrência variável' }, 400)
    valorLancar = parseFloat(body.valor)
    if (isNaN(valorLancar) || valorLancar <= 0)
      return c.json({ error: 'Valor inválido — deve ser maior que zero' }, 400)
  } else {
    valorLancar = Number(rec.valor)
  }

  const mesStr  = String(mes).padStart(2, '0')
  const lastDay = new Date(ano, mes, 0).getDate()
  const dia     = Math.min(rec.dia_vencimento || 1, lastDay)
  const dataVenc = `${ano}-${mesStr}-${String(dia).padStart(2,'0')}`

  if (rec.tipo === 'despesa') {
    const existe = await c.env.DB.prepare(
      `SELECT id FROM despesas WHERE user_id=? AND descricao LIKE ? AND strftime('%Y-%m',data)=? LIMIT 1`
    ).bind(user.id, rec.descricao + '%', `${ano}-${mesStr}`).first()
    if (existe) return c.json({ error: `Já existe um lançamento de "${rec.descricao}" em ${mes}/${ano}` }, 409)

    await c.env.DB.prepare(
      `INSERT INTO despesas
         (user_id, descricao, valor, categoria, vencimento, data, status,
          meio_pagamento, parcelado, numero_parcelas, parcela_atual, recorrente, recorrencia_id)
       VALUES (?, ?, ?, ?, ?, ?, 'pendente', ?, 0, 1, 1, 1, ?)`
    ).bind(user.id, rec.descricao, valorLancar, rec.categoria,
           dataVenc, dataVenc, rec.meio_pagamento || 'outros', rec.id).run()
  } else {
    const existe = await c.env.DB.prepare(
      `SELECT id FROM receitas WHERE user_id=? AND descricao LIKE ? AND strftime('%Y-%m',data)=? LIMIT 1`
    ).bind(user.id, rec.descricao + '%', `${ano}-${mesStr}`).first()
    if (existe) return c.json({ error: `Já existe um lançamento de "${rec.descricao}" em ${mes}/${ano}` }, 409)

    await c.env.DB.prepare(
      `INSERT INTO receitas (user_id, descricao, valor, categoria, data, recorrente, recorrencia_id)
       VALUES (?, ?, ?, ?, ?, 1, ?)`
    ).bind(user.id, rec.descricao, valorLancar, rec.categoria, dataVenc, rec.id).run()
  }

  await c.env.DB.prepare(
    `INSERT OR REPLACE INTO recorrencias_historico
       (recorrencia_id, user_id, mes, ano, valor, observacao)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(rec.id, user.id, mes, ano, valorLancar, observacao).run()

  const dataHoje = hoje.toISOString().split('T')[0]
  await c.env.DB.prepare(
    `UPDATE recorrencias
     SET ultimo_gerado = ?, ultimo_valor = ?, total_gerado = total_gerado + 1
     WHERE id = ?`
  ).bind(dataHoje, valorLancar, rec.id).run()

  return c.json({ success: true, tipo: rec.tipo, valor: valorLancar, mes, ano, data: dataVenc })
})

// ─── POST /api/recorrencias/processar ── S-R4: gera transações automaticamente
recorrencias.post('/processar', requireAuth, async (c) => {
  const user = c.get('user')
  const body = await c.req.json().catch(() => ({})) as any

  const hoje    = new Date()
  const mes     = body.mes ? parseInt(body.mes) : (hoje.getMonth() + 1)
  const ano     = body.ano ? parseInt(body.ano) : hoje.getFullYear()
  const mesStr  = String(mes).padStart(2, '0')
  const mesRef  = `${ano}-${mesStr}-01`
  const dataHoje = hoje.toISOString().split('T')[0]

  const pendentes = await c.env.DB.prepare(
    `SELECT * FROM recorrencias
     WHERE user_id = ? AND ativa = 1
       AND (valor_variavel = 0 OR valor_variavel IS NULL)
       AND (data_fim IS NULL OR date(data_fim) >= ?)
       AND (data_inicio IS NULL OR date(data_inicio) <= ?)
       AND (ultimo_gerado IS NULL OR ultimo_gerado < ?)`
  ).bind(user.id, mesRef, mesRef, mesRef).all()

  let geradas = 0
  const geradasItems: any[] = []

  for (const rec of (pendentes.results as any[])) {
    const lastDay  = new Date(ano, mes, 0).getDate()
    const dia      = Math.min(rec.dia_vencimento || 1, lastDay)
    const dataVenc = `${ano}-${mesStr}-${String(dia).padStart(2,'0')}`

    if (rec.tipo === 'despesa') {
      const existe = await c.env.DB.prepare(
        `SELECT id FROM despesas WHERE user_id=? AND descricao LIKE ? AND strftime('%Y-%m',data)=? LIMIT 1`
      ).bind(user.id, rec.descricao + '%', `${ano}-${mesStr}`).first()
      if (existe) continue
      await c.env.DB.prepare(
        `INSERT INTO despesas (user_id, descricao, valor, categoria, vencimento, data, status, meio_pagamento, parcelado, numero_parcelas, parcela_atual, recorrente, recorrencia_id)
         VALUES (?, ?, ?, ?, ?, ?, 'pendente', ?, 0, 1, 1, 1, ?)`
      ).bind(user.id, rec.descricao + ' (Auto)', rec.valor, rec.categoria, dataVenc, dataVenc, rec.meio_pagamento || 'outros', rec.id).run()
      geradasItems.push({ tipo: 'despesa', descricao: rec.descricao, valor: rec.valor })
    } else {
      const existe = await c.env.DB.prepare(
        `SELECT id FROM receitas WHERE user_id=? AND descricao LIKE ? AND strftime('%Y-%m',data)=? LIMIT 1`
      ).bind(user.id, rec.descricao + '%', `${ano}-${mesStr}`).first()
      if (existe) continue
      await c.env.DB.prepare(
        `INSERT INTO receitas (user_id, descricao, valor, categoria, data, recorrente, recorrencia_id)
         VALUES (?, ?, ?, ?, ?, 1, ?)`
      ).bind(user.id, rec.descricao + ' (Auto)', rec.valor, rec.categoria, dataVenc, rec.id).run()
      geradasItems.push({ tipo: 'receita', descricao: rec.descricao, valor: rec.valor })
    }

    await c.env.DB.prepare(
      `UPDATE recorrencias SET ultimo_gerado = ?, total_gerado = total_gerado + 1 WHERE id = ?`
    ).bind(dataHoje, rec.id).run()
    geradas++
  }

  const varPendentes = await c.env.DB.prepare(
    `SELECT COUNT(*) as n FROM recorrencias
     WHERE user_id = ? AND ativa = 1 AND valor_variavel = 1
       AND (data_fim IS NULL OR date(data_fim) >= ?)
       AND (data_inicio IS NULL OR date(data_inicio) <= ?)
       AND (ultimo_gerado IS NULL OR ultimo_gerado < ?)`
  ).bind(user.id, mesRef, mesRef, mesRef).first() as any

  return c.json({
    success: true, geradas,
    variaveis_pendentes: varPendentes?.n || 0,
    mes, ano, items: geradasItems
  })
})

// ─── POST /api/recorrencias/processar-mes ────────────────────────────────────
recorrencias.post('/processar-mes', requireAuth, async (c) => {
  const user = c.get('user')
  const { mes, ano } = await c.req.json()
  if (!mes || !ano) return c.json({ error: 'mes e ano são obrigatórios' }, 400)

  const mesInt = parseInt(mes)
  const anoInt = parseInt(ano)
  const mesStr = String(mesInt).padStart(2, '0')
  const mesRef = `${anoInt}-${mesStr}-01`

  const pendentes = await c.env.DB.prepare(
    `SELECT * FROM recorrencias
     WHERE user_id = ? AND ativa = 1
       AND (valor_variavel = 0 OR valor_variavel IS NULL)
       AND (data_fim IS NULL OR date(data_fim) >= ?)
       AND (data_inicio IS NULL OR date(data_inicio) <= ?)`
  ).bind(user.id, mesRef, mesRef).all()

  let geradas = 0
  for (const rec of (pendentes.results as any[])) {
    const lastDay  = new Date(anoInt, mesInt, 0).getDate()
    const dia      = Math.min(rec.dia_vencimento || 1, lastDay)
    const dataVenc = `${anoInt}-${mesStr}-${String(dia).padStart(2,'0')}`

    if (rec.tipo === 'despesa') {
      const existe = await c.env.DB.prepare(
        `SELECT id FROM despesas WHERE user_id=? AND descricao LIKE ? AND strftime('%Y-%m',data)=? LIMIT 1`
      ).bind(user.id, rec.descricao + '%', `${anoInt}-${mesStr}`).first()
      if (existe) continue
      await c.env.DB.prepare(
        `INSERT INTO despesas (user_id, descricao, valor, categoria, vencimento, data, status, meio_pagamento, parcelado, numero_parcelas, parcela_atual, recorrente, recorrencia_id)
         VALUES (?, ?, ?, ?, ?, ?, 'pendente', ?, 0, 1, 1, 1, ?)`
      ).bind(user.id, rec.descricao + ' (Auto)', rec.valor, rec.categoria, dataVenc, dataVenc, rec.meio_pagamento || 'outros', rec.id).run()
    } else {
      const existe = await c.env.DB.prepare(
        `SELECT id FROM receitas WHERE user_id=? AND descricao LIKE ? AND strftime('%Y-%m',data)=? LIMIT 1`
      ).bind(user.id, rec.descricao + '%', `${anoInt}-${mesStr}`).first()
      if (existe) continue
      await c.env.DB.prepare(
        `INSERT INTO receitas (user_id, descricao, valor, categoria, data, recorrente, recorrencia_id)
         VALUES (?, ?, ?, ?, ?, 1, ?)`
      ).bind(user.id, rec.descricao + ' (Auto)', rec.valor, rec.categoria, dataVenc, rec.id).run()
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
