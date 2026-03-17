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
    valor:          Number(r.valor),
    ultimo_valor:   r.ultimo_valor ? Number(r.ultimo_valor) : null,
    valor_variavel: r.valor_variavel === 1 || r.valor_variavel === true,
    gerada_mes_atual: r.ultimo_gerado
      ? r.ultimo_gerado >= `${ano}-${String(mes).padStart(2,'0')}-01`
      : false
  }))

  const resumo = {
    total:           rows.length,
    ativas:          rows.filter(r => r.ativa).length,
    // Variáveis entram com 0 no resumo (valor incerto)
    total_despesas:  rows.filter(r => r.tipo === 'despesa' && r.ativa && !r.valor_variavel)
                         .reduce((s, r) => s + Number(r.valor), 0),
    total_receitas:  rows.filter(r => r.tipo === 'receita' && r.ativa && !r.valor_variavel)
                         .reduce((s, r) => s + Number(r.valor), 0),
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
          meio_pagamento = 'outros', data_fim = null,
          valor_variavel = false } = body

  if (!tipo || !descricao || !categoria || !dia_vencimento) {
    return c.json({ error: 'Campos obrigatórios: tipo, descricao, categoria, dia_vencimento' }, 400)
  }
  if (!['despesa', 'receita'].includes(tipo)) {
    return c.json({ error: 'tipo deve ser: despesa ou receita' }, 400)
  }
  // Valor obrigatório só para fixo
  if (!valor_variavel && (!valor || Number(valor) <= 0)) {
    return c.json({ error: 'Informe um valor maior que zero para recorrências fixas' }, 400)
  }

  // Valor padrão para variável: 0 (placeholder, nunca é usado no lançamento)
  const valorSalvo = valor_variavel ? (Number(valor) || 0) : Number(valor)

  const res = await c.env.DB.prepare(
    `INSERT INTO recorrencias
       (user_id, tipo, descricao, valor, categoria, dia_vencimento, meio_pagamento, data_fim, valor_variavel)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(user.id, tipo, descricao, valorSalvo, categoria, dia_vencimento,
         meio_pagamento, data_fim, valor_variavel ? 1 : 0).run()

  await verificarConquista(c.env.DB, user.id, 'automatico')

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

  const body2 = await c.req.json()
  const { valor, meio_pagamento, data_fim, valor_variavel } = body2

  // Buscar recorrência atual para fallback de campos opcionais
  const recAtual = await c.env.DB.prepare(
    `SELECT * FROM recorrencias WHERE id = ? AND user_id = ?`
  ).bind(id, user.id).first() as any

  const descricao      = body2.descricao     ?? recAtual.descricao
  const categoria      = body2.categoria     ?? recAtual.categoria
  const dia_vencimento = body2.dia_vencimento !== undefined ? body2.dia_vencimento : recAtual.dia_vencimento

  const vv         = valor_variavel !== undefined ? valor_variavel : (recAtual.valor_variavel === 1)
  const valorFinal = valor !== undefined ? Number(valor) : recAtual.valor
  const valorSalvo = vv ? (valorFinal || 0) : valorFinal
  const mpFinal    = meio_pagamento  ?? recAtual.meio_pagamento ?? 'outros'
  const dfFinal    = data_fim        !== undefined ? data_fim : recAtual.data_fim

  await c.env.DB.prepare(
    `UPDATE recorrencias
     SET descricao=?, valor=?, categoria=?, dia_vencimento=?,
         meio_pagamento=?, data_fim=?, valor_variavel=?
     WHERE id = ? AND user_id = ?`
  ).bind(descricao, valorSalvo, categoria, dia_vencimento,
         mpFinal, dfFinal, vv ? 1 : 0, id, user.id).run()

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

// ─── GET /api/recorrencias/:id/historico ─────────────────────────────────────
// Retorna os últimos N lançamentos daquela recorrência (para mostrar no modal)
recorrencias.get('/:id/historico', requireAuth, async (c) => {
  const user = c.get('user')
  const id   = c.req.param('id')
  const limit = parseInt(c.req.query('limit') || '6')

  // Verificar posse
  const rec = await c.env.DB.prepare(
    `SELECT id, descricao, tipo, valor_variavel FROM recorrencias WHERE id = ? AND user_id = ?`
  ).bind(id, user.id).first() as any
  if (!rec) return c.json({ error: 'Recorrência não encontrada' }, 404)

  const hist = await c.env.DB.prepare(
    `SELECT mes, ano, valor, observacao, lancado_em
     FROM recorrencias_historico
     WHERE recorrencia_id = ? AND user_id = ?
     ORDER BY ano DESC, mes DESC
     LIMIT ?`
  ).bind(id, user.id, limit).all()

  return c.json({
    recorrencia_id: rec.id,
    descricao:      rec.descricao,
    tipo:           rec.tipo,
    valor_variavel: rec.valor_variavel === 1,
    historico:      hist.results
  })
})

// ─── POST /api/recorrencias/:id/lancar ───────────────────────────────────────
// Lança manualmente uma recorrência (fixa ou variável) para um mês específico.
// Para variáveis, o campo `valor` é obrigatório.
recorrencias.post('/:id/lancar', requireAuth, async (c) => {
  const user = c.get('user')
  const id   = c.req.param('id')

  const rec = await c.env.DB.prepare(
    `SELECT * FROM recorrencias WHERE id = ? AND user_id = ?`
  ).bind(id, user.id).first() as any
  if (!rec) return c.json({ error: 'Recorrência não encontrada' }, 404)
  if (!rec.ativa) return c.json({ error: 'Recorrência está pausada' }, 400)

  const body   = await c.req.json()
  const hoje   = new Date()
  const mes    = body.mes  ? parseInt(body.mes)  : (hoje.getMonth() + 1)
  const ano    = body.ano  ? parseInt(body.ano)  : hoje.getFullYear()
  const observacao = body.observacao || null

  // Para variável: valor obrigatório no body; para fixa: usa valor cadastrado
  const ehVariavel = rec.valor_variavel === 1 || rec.valor_variavel === true
  let valorLancar: number

  if (ehVariavel) {
    if (body.valor === undefined || body.valor === null || body.valor === '') {
      return c.json({ error: 'Informe o valor para esta recorrência variável' }, 400)
    }
    valorLancar = parseFloat(body.valor)
    if (isNaN(valorLancar) || valorLancar <= 0) {
      return c.json({ error: 'Valor inválido — deve ser maior que zero' }, 400)
    }
  } else {
    valorLancar = Number(rec.valor)
  }

  const mesStr = String(mes).padStart(2, '0')
  const lastDay = new Date(ano, mes, 0).getDate()
  const dia     = Math.min(rec.dia_vencimento || 1, lastDay)
  const dataVenc = `${ano}-${mesStr}-${String(dia).padStart(2,'0')}`

  // Evitar duplicata: verificar se já existe transação deste mês
  if (rec.tipo === 'despesa') {
    const existe = await c.env.DB.prepare(
      `SELECT id FROM despesas WHERE user_id=? AND descricao LIKE ? AND strftime('%Y-%m',data)=? LIMIT 1`
    ).bind(user.id, rec.descricao + '%', `${ano}-${mesStr}`).first()
    if (existe) return c.json({ error: `Já existe um lançamento de "${rec.descricao}" em ${mes}/${ano}` }, 409)

    await c.env.DB.prepare(
      `INSERT INTO despesas
         (user_id, descricao, valor, categoria, vencimento, data, status,
          meio_pagamento, parcelado, numero_parcelas, parcela_atual, recorrente)
       VALUES (?, ?, ?, ?, ?, ?, 'pendente', ?, 0, 1, 1, 1)`
    ).bind(user.id, rec.descricao, valorLancar, rec.categoria,
           dataVenc, dataVenc, rec.meio_pagamento || 'outros').run()

  } else {
    const existe = await c.env.DB.prepare(
      `SELECT id FROM receitas WHERE user_id=? AND descricao LIKE ? AND strftime('%Y-%m',data)=? LIMIT 1`
    ).bind(user.id, rec.descricao + '%', `${ano}-${mesStr}`).first()
    if (existe) return c.json({ error: `Já existe um lançamento de "${rec.descricao}" em ${mes}/${ano}` }, 409)

    await c.env.DB.prepare(
      `INSERT INTO receitas (user_id, descricao, valor, categoria, data, recorrente)
       VALUES (?, ?, ?, ?, ?, 1)`
    ).bind(user.id, rec.descricao, valorLancar, rec.categoria, dataVenc).run()
  }

  // Registrar no histórico (para variáveis e também fixas — histórico completo)
  await c.env.DB.prepare(
    `INSERT OR REPLACE INTO recorrencias_historico
       (recorrencia_id, user_id, mes, ano, valor, observacao)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(rec.id, user.id, mes, ano, valorLancar, observacao).run()

  // Atualizar ultimo_gerado e ultimo_valor na recorrência
  const dataHoje = hoje.toISOString().split('T')[0]
  await c.env.DB.prepare(
    `UPDATE recorrencias
     SET ultimo_gerado = ?, ultimo_valor = ?, total_gerado = total_gerado + 1
     WHERE id = ?`
  ).bind(dataHoje, valorLancar, rec.id).run()

  return c.json({
    success: true,
    tipo:   rec.tipo,
    valor:  valorLancar,
    mes,
    ano,
    data:   dataVenc
  })
})

// ─── POST /api/recorrencias/processar ── gera transações do dia ───────────────
recorrencias.post('/processar', requireAuth, async (c) => {
  const user = c.get('user')
  const body = await c.req.json().catch(() => ({})) as any

  const hoje = new Date()
  const mes  = body.mes  ? parseInt(body.mes)  : (hoje.getMonth() + 1)
  const ano  = body.ano  ? parseInt(body.ano)  : hoje.getFullYear()
  const mesStr   = String(mes).padStart(2, '0')
  const mesRef   = `${ano}-${mesStr}-01`
  const dataHoje = hoje.toISOString().split('T')[0]

  // Apenas recorrências FIXAS (valor_variavel=0 ou null) são processadas automaticamente
  // As variáveis precisam de confirmação manual via /lancar
  const pendentes = await c.env.DB.prepare(
    `SELECT * FROM recorrencias
     WHERE user_id = ? AND ativa = 1
       AND (valor_variavel = 0 OR valor_variavel IS NULL)
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

  // Também informa quantas variáveis estão pendentes (aguardando confirmação manual)
  const varPendentes = await c.env.DB.prepare(
    `SELECT COUNT(*) as n FROM recorrencias
     WHERE user_id = ? AND ativa = 1 AND valor_variavel = 1
       AND (data_fim IS NULL OR date(data_fim) >= ?)
       AND (ultimo_gerado IS NULL OR ultimo_gerado < ?)`
  ).bind(user.id, mesRef, mesRef).first() as any

  return c.json({
    success: true,
    geradas,
    variaveis_pendentes: varPendentes?.n || 0,
    mes,
    ano,
    items: geradasItems
  })
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

  // Só processa fixas automaticamente
  const pendentes = await c.env.DB.prepare(
    `SELECT * FROM recorrencias
     WHERE user_id = ? AND ativa = 1
       AND (valor_variavel = 0 OR valor_variavel IS NULL)
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
