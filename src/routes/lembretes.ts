import { Hono } from 'hono'
import { requireAuth } from './auth'
import { getLimites, MSG_UPGRADE } from './planos'

type Bindings = { DB: D1Database }
type Variables = { user: { id: number; nome: string; email: string; plano: string } }

const lembretes = new Hono<{ Bindings: Bindings; Variables: Variables }>()

// ── Validação de entrada (Postgres estrito) ──────────────────────────────────
const MAX_VALOR = 1_000_000_000
function parseId(v: unknown): number | null { const t = String(v ?? ''); return /^\d+$/.test(t) && parseInt(t, 10) > 0 ? parseInt(t, 10) : null }
function parseDia(v: unknown): number | null { const n = Number(v); return Number.isInteger(n) && n >= 1 && n <= 31 ? n : null }
function parseValorNaoNeg(v: unknown): number | null {
  if (v === '' || v === null || v === undefined) return 0
  const n = Number(v)
  return Number.isFinite(n) && n >= 0 && n <= MAX_VALOR ? Math.round(n * 100) / 100 : null
}
function parseDiasAntes(v: unknown): number | null { const n = Number(v); return Number.isInteger(n) && n >= 0 && n <= 60 ? n : null }
const hojeMeiaNoite = () => { const h = new Date(); return new Date(h.getFullYear(), h.getMonth(), h.getDate()) }

// Tipos válidos para lembretes (sem CHECK constraint — validação no código)
const TIPOS_LEMBRETE = [
  'conta', 'imposto', 'mensalidade', 'seguro', 'aluguel',
  'investimento', 'despesa', 'receita', 'saude', 'educacao',
  'transporte', 'revisao', 'reuniao', 'tarefa', 'outros'
]

const FREQUENCIAS_VALIDAS = ['semanal', 'quinzenal', 'mensal', 'bimestral', 'trimestral', 'semestral', 'anual']

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/lembretes
// ─────────────────────────────────────────────────────────────────────────────
lembretes.get('/', requireAuth, async (c) => {
  const user = c.get('user')
  const result = await c.env.DB.prepare(
    'SELECT * FROM lembretes WHERE user_id = ? ORDER BY dia_vencimento ASC'
  ).bind(user.id).all()

  const hoje = new Date()
  const lembretesComStatus = (result.results as any[]).map(l => {
    let urgente = false
    let diasParaVencer = null
    let atrasado = false

    if (l.dia_vencimento) {
      // LB1: comparar dia com dia (meia-noite). new Date(y,m,dia) é 00:00, então
      // contra `new Date()` uma conta que vence HOJE perdia por segundos e caía
      // em "0d atrasado". Agora vencer hoje = 0 dias, não atrasado.
      const ref = hojeMeiaNoite()
      const umDia = 1000 * 60 * 60 * 24
      let dataVenc = new Date(ref.getFullYear(), ref.getMonth(), l.dia_vencimento)
      if (dataVenc < ref) {
        if (l.status_mes === 'aguardando') {
          atrasado = true
          diasParaVencer = -Math.round((ref.getTime() - dataVenc.getTime()) / umDia)
        } else {
          dataVenc.setMonth(dataVenc.getMonth() + 1)
          diasParaVencer = Math.round((dataVenc.getTime() - ref.getTime()) / umDia)
        }
      } else {
        diasParaVencer = Math.round((dataVenc.getTime() - ref.getTime()) / umDia)
      }
      urgente = (atrasado || diasParaVencer <= (l.alertar_dias_antes || 3)) && l.status_mes === 'aguardando'
    } else if (!l.proximo_vencimento && l.frequencia) {
      // Sem dia_vencimento: recalcular proximo_vencimento
      diasParaVencer = null
    }

    return { ...l, urgente, atrasado, dias_para_vencer: diasParaVencer }
  })

  // Ordenar por vencimento mais próximo (atrasados primeiro, depois por dias)
  lembretesComStatus.sort((a, b) => {
    const da = a.atrasado ? -9999 : (a.dias_para_vencer ?? 9999)
    const db_ = b.atrasado ? -9999 : (b.dias_para_vencer ?? 9999)
    return da - db_
  })

  const urgentes = lembretesComStatus.filter(l => l.urgente && l.status_mes === 'aguardando')
  return c.json({ lembretes: lembretesComStatus, urgentes: urgentes.length })
})

// ─────────────────────────────────────────────────────────────────────────────
// S-L1: GET /api/lembretes/resumo — visão consolidada
// Deve ficar ANTES de /:id para evitar conflito de rota
// ─────────────────────────────────────────────────────────────────────────────
lembretes.get('/resumo', requireAuth, async (c) => {
  const user = c.get('user')

  const [todos, urgentesR, porTipo] = await Promise.all([
    c.env.DB.prepare(
      `SELECT COUNT(*) as total, 
              COUNT(CASE WHEN ativo = 1 THEN 1 END) as ativos,
              COALESCE(SUM(CASE WHEN ativo = 1 THEN valor_estimado ELSE 0 END),0) as valor_total_mensal
       FROM lembretes WHERE user_id = ?`
    ).bind(user.id).first() as any,

    c.env.DB.prepare(
      `SELECT COUNT(*) as n FROM lembretes WHERE user_id = ? AND ativo = 1 AND status_mes = 'aguardando'`
    ).bind(user.id).first() as any,

    c.env.DB.prepare(
      `SELECT tipo, COUNT(*) as qtd, COALESCE(SUM(valor_estimado),0) as valor_total
       FROM lembretes WHERE user_id = ? AND ativo = 1
       GROUP BY tipo ORDER BY valor_total DESC`
    ).bind(user.id).all()
  ])

  // Calcular urgentes dinamicamente
  const all = await c.env.DB.prepare(
    'SELECT dia_vencimento, alertar_dias_antes, status_mes FROM lembretes WHERE user_id = ? AND ativo = 1'
  ).bind(user.id).all()

  const hoje = new Date()
  let urgentesCount = 0
  for (const l of (all.results as any[])) {
    if (l.dia_vencimento && l.status_mes === 'aguardando') {
      const dataVenc = new Date(hoje.getFullYear(), hoje.getMonth(), l.dia_vencimento)
      if (dataVenc < hoje) dataVenc.setMonth(dataVenc.getMonth() + 1)
      const dias = Math.ceil((dataVenc.getTime() - hoje.getTime()) / (1000 * 60 * 60 * 24))
      if (dias <= (l.alertar_dias_antes || 3)) urgentesCount++
    }
  }

  // Calcular proximos_7_dias
  const em7Dias = new Date(hoje)
  em7Dias.setDate(hoje.getDate() + 7)
  let proximos7 = 0
  for (const l of (all.results as any[])) {
    if (l.dia_vencimento && l.status_mes === 'aguardando') {
      const dataVenc = new Date(hoje.getFullYear(), hoje.getMonth(), l.dia_vencimento)
      if (dataVenc < hoje) dataVenc.setMonth(dataVenc.getMonth() + 1)
      if (dataVenc <= em7Dias) proximos7++
    }
  }

  const totalVal = Number(todos?.total || 0)
  const ativosVal = Number(todos?.ativos || 0)
  const valorMensal = Math.round(Number(todos?.valor_total_mensal || 0) * 100) / 100

  return c.json({
    // Campos no nível raiz para compatibilidade com frontend
    total: totalVal,
    ativos: ativosVal,
    urgentes: urgentesCount,
    valor_total_mensal: valorMensal,
    proximos_7_dias: proximos7,
    por_tipo: (porTipo.results as any[]).map(r => ({
      tipo: r.tipo,
      qtd: Number(r.qtd),
      valor_total: Math.round(Number(r.valor_total) * 100) / 100
    })),
    // Mantém bloco totais para compatibilidade retroativa
    totais: {
      total: totalVal,
      ativos: ativosVal,
      urgentes: urgentesCount,
      valor_total_mensal: valorMensal,
      proximos_7_dias: proximos7
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/lembretes/historico/:id
// ANTES de /:id/registrar para evitar conflito
// ─────────────────────────────────────────────────────────────────────────────
lembretes.get('/historico/:id', requireAuth, async (c) => {
  const user = c.get('user')
  const id = parseId(c.req.param('id'))   // LB12
  if (!id) return c.json({ historico: [] })
  const result = await c.env.DB.prepare(
    'SELECT * FROM lembretes_historico WHERE lembrete_id = ? AND user_id = ? ORDER BY data_referencia DESC LIMIT 12'
  ).bind(id, user.id).all()
  return c.json({ historico: result.results })
})

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/lembretes
// S-L2: aceita campo tags (JSON string ou array)
// S-L3: aceita campo notas
// Bug L-B1: valida tipo contra lista em código (sem CHECK no DB)
// ─────────────────────────────────────────────────────────────────────────────
lembretes.post('/', requireAuth, async (c) => {
  const user = c.get('user')

  // ── Limite de plano ──
  const lim = getLimites(user.plano)
  if (lim.lembretes !== Infinity) {
    const count = await c.env.DB.prepare('SELECT COUNT(*) as n FROM lembretes WHERE user_id = ? AND ativo = 1').bind(user.id).first() as any
    if ((count?.n || 0) >= lim.lembretes)
      return c.json({ error: MSG_UPGRADE.lembretes, upgrade: true, limite: lim.lembretes, feature: 'lembretes' }, 403)
  }

  const body = await c.req.json()
  const {
    titulo,
    descricao,
    tipo = 'conta',
    valor_estimado = 0,
    dia_vencimento,
    frequencia = 'mensal',
    alertar_dias_antes = 3,
    notas = null,
    tags = null,
    cor = null       // S-L8
  } = body

  const tituloLimpo = String(titulo ?? '').trim()   // LB21: só-espaços não passa
  if (!tituloLimpo) return c.json({ error: 'Título é obrigatório' }, 400)

  if (!TIPOS_LEMBRETE.includes(tipo))
    return c.json({ error: `tipo inválido. Use: ${TIPOS_LEMBRETE.join(', ')}` }, 400)
  if (!FREQUENCIAS_VALIDAS.includes(frequencia))
    return c.json({ error: `frequencia inválida. Use: ${FREQUENCIAS_VALIDAS.join(', ')}` }, 400)

  // LB13: dia_vencimento com faixa (99/-5/0/'abc' recusados). Opcional (null ok).
  let diaNum: number | null = null
  if (dia_vencimento !== undefined && dia_vencimento !== null && dia_vencimento !== '') {
    diaNum = parseDia(dia_vencimento)
    if (diaNum === null) return c.json({ error: 'dia_vencimento deve ser um inteiro entre 1 e 31.' }, 400)
  }
  // LB15: valor_estimado não pode ser negativo/NaN.
  const valorNum = parseValorNaoNeg(valor_estimado)
  if (valorNum === null) return c.json({ error: 'valor_estimado deve ser um número maior ou igual a zero.' }, 400)
  // LB14: alertar_dias_antes inteiro 0–60 ('abc'→400, -99→400).
  const alertaNum = parseDiasAntes(alertar_dias_antes ?? 3)
  if (alertaNum === null) return c.json({ error: 'alertar_dias_antes deve ser um inteiro entre 0 e 60.' }, 400)

  const tagsStr = Array.isArray(tags) ? JSON.stringify(tags) : (tags || null)
  const proximo = calcProximoVencimento(diaNum || 1, frequencia)

  const result = await c.env.DB.prepare(
    `INSERT INTO lembretes (user_id, titulo, descricao, tipo, valor_estimado, dia_vencimento, frequencia, proximo_vencimento, alertar_dias_antes, notas, tags, cor)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    user.id, tituloLimpo, descricao || null, tipo,
    valorNum,
    diaNum,
    frequencia, proximo,
    alertaNum,
    notas || null, tagsStr, cor || null
  ).run()

  // Verificar conquista
  const count = await c.env.DB.prepare('SELECT COUNT(*) as total FROM lembretes WHERE user_id = ?').bind(user.id).first() as any
  if ((count?.total || 0) >= 5) await verificarConquista(c.env.DB, user.id, 'lembrete_mestre')

  return c.json({ success: true, id: result.meta.last_row_id, message: 'Lembrete criado!' }, 201)
})

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/lembretes/:id
// S-L2/L3: aceita notas e tags
// ─────────────────────────────────────────────────────────────────────────────
lembretes.put('/:id', requireAuth, async (c) => {
  const user = c.get('user')
  const id = parseId(c.req.param('id'))   // LB12
  if (!id) return c.json({ error: 'Lembrete não encontrado' }, 404)
  const existing = await c.env.DB.prepare('SELECT * FROM lembretes WHERE id = ? AND user_id = ?').bind(id, user.id).first() as any
  if (!existing) return c.json({ error: 'Lembrete não encontrado' }, 404)

  const body = await c.req.json()
  const { titulo, descricao, tipo, valor_estimado, dia_vencimento, frequencia, alertar_dias_antes, ativo, notas, tags, cor } = body

  if (tipo !== undefined && !TIPOS_LEMBRETE.includes(tipo))
    return c.json({ error: `tipo inválido. Use: ${TIPOS_LEMBRETE.join(', ')}` }, 400)
  if (frequencia !== undefined && !FREQUENCIAS_VALIDAS.includes(frequencia))   // LB16: PUT não validava frequência
    return c.json({ error: `frequencia inválida. Use: ${FREQUENCIAS_VALIDAS.join(', ')}` }, 400)

  // LB17: '' ?? existing = '' zerava o título
  let tituloFinal = existing.titulo
  if (titulo !== undefined) { const t = String(titulo).trim(); if (!t) return c.json({ error: 'Título não pode ficar vazio.' }, 400); tituloFinal = t }
  // LB15
  let valorFinal = existing.valor_estimado ?? 0
  if (valor_estimado !== undefined) { const v = parseValorNaoNeg(valor_estimado); if (v === null) return c.json({ error: 'valor_estimado deve ser um número maior ou igual a zero.' }, 400); valorFinal = v }
  // LB13
  let diaFinal = existing.dia_vencimento
  if (dia_vencimento !== undefined) {
    if (dia_vencimento === null || dia_vencimento === '') diaFinal = null
    else { const d = parseDia(dia_vencimento); if (d === null) return c.json({ error: 'dia_vencimento deve ser um inteiro entre 1 e 31.' }, 400); diaFinal = d }
  }
  // LB14
  let alertaFinal = existing.alertar_dias_antes ?? 3
  if (alertar_dias_antes !== undefined) { const a = parseDiasAntes(alertar_dias_antes); if (a === null) return c.json({ error: 'alertar_dias_antes deve ser um inteiro entre 0 e 60.' }, 400); alertaFinal = a }

  const freqFinal = frequencia ?? existing.frequencia ?? 'mensal'
  const tipoFinal = tipo ?? existing.tipo ?? 'conta'
  const vaiAtivar = ativo != null ? (ativo ? 1 : 0) : (existing.ativo ?? 1)

  // LB7: reativar (0→1) reconfere o limite do plano — antes só o POST checava, dava
  // para furar o limite desativando e reativando.
  if (vaiAtivar === 1 && existing.ativo !== 1) {
    const lim = getLimites(user.plano)
    if (lim.lembretes !== Infinity) {
      const count = await c.env.DB.prepare('SELECT COUNT(*) as n FROM lembretes WHERE user_id = ? AND ativo = 1').bind(user.id).first() as any
      if ((count?.n || 0) >= lim.lembretes)
        return c.json({ error: MSG_UPGRADE.lembretes, upgrade: true, limite: lim.lembretes, feature: 'lembretes' }, 403)
    }
  }

  // LB18: recalcular proximo_vencimento quando o dia ou a frequência mudam
  let proximoFinal = existing.proximo_vencimento
  const diaMudou = dia_vencimento !== undefined && diaFinal !== existing.dia_vencimento
  const freqMudou = frequencia !== undefined && freqFinal !== existing.frequencia
  if ((diaMudou || freqMudou) && diaFinal) proximoFinal = calcProximoVencimento(diaFinal, freqFinal)

  const tagsStr = tags !== undefined ? (Array.isArray(tags) ? JSON.stringify(tags) : (tags || null)) : existing.tags

  await c.env.DB.prepare(
    `UPDATE lembretes SET titulo=?, descricao=?, tipo=?, valor_estimado=?, dia_vencimento=?,
     frequencia=?, alertar_dias_antes=?, ativo=?, notas=?, tags=?, cor=?, proximo_vencimento=? WHERE id=? AND user_id=?`
  ).bind(
    tituloFinal,
    descricao !== undefined ? (descricao || null) : existing.descricao,
    tipoFinal, valorFinal, diaFinal, freqFinal, alertaFinal, vaiAtivar,
    notas !== undefined ? (notas || null) : existing.notas,
    tagsStr,
    cor !== undefined ? (cor || null) : existing.cor,
    proximoFinal,
    id, user.id
  ).run()

  return c.json({ success: true, message: 'Lembrete atualizado!' })
})

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/lembretes/:id/registrar
// ─────────────────────────────────────────────────────────────────────────────
lembretes.patch('/:id/registrar', requireAuth, async (c) => {
  const user = c.get('user')
  const id = parseId(c.req.param('id'))   // LB12
  if (!id) return c.json({ error: 'Lembrete não encontrado' }, 404)
  const { status, valor_real, observacoes } = await c.req.json()

  const STATUSVALIDOS = ['recebido', 'pago', 'ignorado', 'aguardando']
  if (status && !STATUSVALIDOS.includes(status))
    return c.json({ error: `status inválido. Use: ${STATUSVALIDOS.join(', ')}` }, 400)

  const lembrete = await c.env.DB.prepare('SELECT * FROM lembretes WHERE id = ? AND user_id = ?').bind(id, user.id).first() as any
  if (!lembrete) return c.json({ error: 'Lembrete não encontrado' }, 404)

  // LB20: valor_real negativo/NaN não pode entrar no histórico.
  const valorReal = valor_real === undefined || valor_real === null || valor_real === ''
    ? Number(lembrete.valor_estimado) : parseValorNaoNeg(valor_real)
  if (valorReal === null) return c.json({ error: 'valor_real deve ser um número maior ou igual a zero.' }, 400)

  const hoje = new Date().toISOString().split('T')[0]

  // LB20: dedupe — 3 cliques no mesmo dia geravam 3 linhas de histórico.
  const jaRegistrado = await c.env.DB.prepare(
    'SELECT id FROM lembretes_historico WHERE lembrete_id = ? AND user_id = ? AND data_referencia = ? LIMIT 1'
  ).bind(id, user.id, hoje).first()
  if (jaRegistrado) return c.json({ error: 'Este lembrete já foi registrado hoje.' }, 409)

  await c.env.DB.prepare(
    'INSERT INTO lembretes_historico (lembrete_id, user_id, data_referencia, status, valor_real, observacoes) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(id, user.id, hoje, status || 'pago', valorReal, observacoes || null).run()

  // LB19: avança um ciclo além do vencimento corrente (não recalcula de hoje).
  const proximo = proximoAposPagar(lembrete.dia_vencimento || 1, lembrete.frequencia)
  await c.env.DB.prepare(
    'UPDATE lembretes SET status_mes=?, ultimo_recebimento=?, proximo_vencimento=? WHERE id=? AND user_id=?'
  ).bind(status || 'pago', hoje, proximo, id, user.id).run()

  // Recorrência automática: ao pagar, resetar status_mes para 'aguardando' no próximo ciclo
  // O status_mes volta para 'aguardando' automaticamente quando proximo_vencimento chegar
  // (isso é gerenciado pelo frontend ao exibir, ou por um cron job futuro)

  return c.json({ 
    success: true, 
    proximo_vencimento: proximo, 
    message: `Lembrete marcado como ${status}! Próximo: ${proximo}`,
    proximo_criado: true
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/lembretes/:id/lembrar-novamente
// ─────────────────────────────────────────────────────────────────────────────
lembretes.patch('/:id/lembrar-novamente', requireAuth, async (c) => {
  const user = c.get('user')
  const id = parseId(c.req.param('id'))   // LB12
  if (!id) return c.json({ error: 'Lembrete não encontrado' }, 404)
  const exists = await c.env.DB.prepare('SELECT id FROM lembretes WHERE id = ? AND user_id = ?').bind(id, user.id).first()
  if (!exists) return c.json({ error: 'Lembrete não encontrado' }, 404)

  await c.env.DB.prepare('UPDATE lembretes SET status_mes = ? WHERE id = ? AND user_id = ?').bind('aguardando', id, user.id).run()
  return c.json({ success: true, message: 'Você será lembrado novamente!' })
})

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/lembretes/:id/converter-despesa
// ─────────────────────────────────────────────────────────────────────────────
lembretes.post('/:id/converter-despesa', requireAuth, async (c) => {
  const user = c.get('user')
  const id = parseId(c.req.param('id'))   // LB12
  if (!id) return c.json({ error: 'Lembrete não encontrado' }, 404)

  const lembrete = await c.env.DB.prepare(
    'SELECT * FROM lembretes WHERE id = ? AND user_id = ?'
  ).bind(id, user.id).first() as any
  if (!lembrete) return c.json({ error: 'Lembrete não encontrado' }, 404)

  // LB4: sem dedupe, 3 cliques em "Converter em despesa" criavam 3 despesas com o
  // lembrete já pago desde o 1º. Se já foi quitado neste ciclo, bloqueia.
  if (lembrete.status_mes === 'pago' || lembrete.status_mes === 'recebido')
    return c.json({ error: 'Este lembrete já foi convertido/quitado neste ciclo.' }, 409)

  const body = await c.req.json().catch(() => ({})) as any
  const hoje = new Date().toISOString().split('T')[0]
  const {
    descricao = lembrete.titulo,
    valor = lembrete.valor_estimado,
    data = lembrete.proximo_vencimento || hoje,
    categoria = 'outros',
    subcategoria = null,
    status = 'pendente',
    cartao_id = null,
    meio_pagamento = 'dinheiro',
    vencimento = null,
    observacoes = null,
    billing_month = null,
    billing_year = null,
  } = body

  if (!valor || Number(valor) <= 0) return c.json({ error: 'Valor deve ser maior que zero' }, 400)

  const result = await c.env.DB.prepare(
    `INSERT INTO despesas (user_id, descricao, data, categoria, subcategoria, valor,
     parcelado, numero_parcelas, parcela_atual, status, fixa_ou_variavel, recorrente,
     vencimento, observacoes, cartao_id, meio_pagamento, billing_month, billing_year)
     VALUES (?, ?, ?, ?, ?, ?, 0, 1, 1, ?, 'variavel', 0, ?, ?, ?, ?, ?, ?)`
  ).bind(
    user.id, descricao, data, categoria, subcategoria,
    parseFloat(valor), status, vencimento, observacoes,
    cartao_id ? parseInt(cartao_id) : null, meio_pagamento,
    billing_month, billing_year
  ).run()

  await c.env.DB.prepare(
    'INSERT INTO lembretes_historico (lembrete_id, user_id, data_referencia, status, valor_real, observacoes) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(id, user.id, data, 'pago', parseFloat(valor), `Convertido em despesa #${result.meta.last_row_id}`).run()

  const proximo = proximoAposPagar(lembrete.dia_vencimento || 1, lembrete.frequencia)   // LB19
  await c.env.DB.prepare(
    'UPDATE lembretes SET status_mes=?, ultimo_recebimento=?, proximo_vencimento=? WHERE id=? AND user_id=?'
  ).bind('pago', data, proximo, id, user.id).run()

  return c.json({
    success: true,
    despesa_id: result.meta.last_row_id,
    message: 'Lembrete convertido em despesa com sucesso!'
  }, 201)
})

// ─────────────────────────────────────────────────────────────────────────────
// S-L4: GET /api/lembretes/urgentes
// ─────────────────────────────────────────────────────────────────────────────
lembretes.get('/urgentes', requireAuth, async (c) => {
  const user = c.get('user')
  const result = await c.env.DB.prepare(
    'SELECT * FROM lembretes WHERE user_id = ? AND ativo = 1 AND status_mes = ? ORDER BY dia_vencimento ASC'
  ).bind(user.id, 'aguardando').all()

  const hoje = new Date()
  const urgentes = (result.results as any[]).map(l => {
    let diasParaVencer = null
    let atrasado = false
    if (l.dia_vencimento) {
      const dv = new Date(hoje.getFullYear(), hoje.getMonth(), l.dia_vencimento)
      if (dv < hoje) {
        // Passou sem pagamento — está atrasado
        atrasado = true
        diasParaVencer = -Math.floor((hoje.getTime() - dv.getTime()) / (1000 * 60 * 60 * 24))
      } else {
        diasParaVencer = Math.ceil((dv.getTime() - hoje.getTime()) / (1000 * 60 * 60 * 24))
      }
    }
    const urgente = atrasado || (diasParaVencer !== null && diasParaVencer <= (l.alertar_dias_antes || 3))
    return { ...l, dias_para_vencer: diasParaVencer, atrasado, urgente }
  }).filter(l => l.urgente)

  // Atrasados primeiro, depois por dias para vencer
  urgentes.sort((a, b) => {
    if (a.atrasado && !b.atrasado) return -1
    if (!a.atrasado && b.atrasado) return 1
    return (a.dias_para_vencer ?? 9999) - (b.dias_para_vencer ?? 9999)
  })

  return c.json({ urgentes, total: urgentes.length })
})

// ─────────────────────────────────────────────────────────────────────────────
// S-L5: PATCH /api/lembretes/:id/snooze — adiar vencimento por N dias
// ─────────────────────────────────────────────────────────────────────────────
lembretes.patch('/:id/snooze', requireAuth, async (c) => {
  const user = c.get('user')
  const id   = parseId(c.req.param('id'))   // LB12
  if (!id) return c.json({ error: 'Lembrete não encontrado' }, 404)
  const body = await c.req.json().catch(() => ({}))
  // LB22: `body.dias || '1'` transformava 0 em 1 antes da guarda. Agora 0 é 0.
  const diasRaw = (body as any).dias
  const dias = Number(diasRaw)
  if (!Number.isInteger(dias) || dias < 1 || dias > 30)
    return c.json({ error: 'dias deve ser um inteiro entre 1 e 30' }, 400)

  const lembrete = await c.env.DB.prepare(
    'SELECT * FROM lembretes WHERE id = ? AND user_id = ?'
  ).bind(id, user.id).first() as any
  if (!lembrete) return c.json({ error: 'Lembrete não encontrado' }, 404)

  const base = lembrete.proximo_vencimento
    ? new Date(lembrete.proximo_vencimento + 'T00:00:00')
    : new Date()
  base.setDate(base.getDate() + dias)
  const novaData = base.toISOString().split('T')[0]

  await c.env.DB.prepare(
    'UPDATE lembretes SET proximo_vencimento = ?, status_mes = ? WHERE id = ? AND user_id = ?'
  ).bind(novaData, 'aguardando', id, user.id).run()

  return c.json({
    success: true,
    proximo_vencimento: novaData,
    message: `Lembrete adiado ${dias} dia(s). Novo vencimento: ${novaData}`
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// S-L6: GET /api/lembretes/calendario?mes=3&ano=2026
// ─────────────────────────────────────────────────────────────────────────────
lembretes.get('/calendario', requireAuth, async (c) => {
  const user = c.get('user')
  const mes  = parseInt(c.req.query('mes')  || String(new Date().getMonth() + 1))
  const ano  = parseInt(c.req.query('ano')  || String(new Date().getFullYear()))

  const todos = await c.env.DB.prepare(
    'SELECT * FROM lembretes WHERE user_id = ? AND ativo = 1 ORDER BY dia_vencimento ASC'
  ).bind(user.id).all()

  const hoje = new Date()
  const eventos = (todos.results as any[]).flatMap(l => {
    if (!l.dia_vencimento) return []
    const lastDay = new Date(ano, mes, 0).getDate()
    const dia = Math.min(l.dia_vencimento, lastDay)
    const data = `${ano}-${String(mes).padStart(2,'0')}-${String(dia).padStart(2,'0')}`
    const dv   = new Date(data + 'T00:00:00')
    const diff = Math.ceil((dv.getTime() - hoje.getTime()) / (1000 * 60 * 60 * 24))
    return [{
      id: l.id, titulo: l.titulo, tipo: l.tipo,
      valor_estimado: Number(l.valor_estimado || 0),
      data, dia, status_mes: l.status_mes,
      cor: l.cor || '#2FBF71',
      urgente: diff <= (l.alertar_dias_antes || 3) && l.status_mes === 'aguardando'
    }]
  })

  const totalValor = eventos.reduce((s, e) => s + e.valor_estimado, 0)
  return c.json({
    mes, ano,
    lembretes: eventos,   // alias para compatibilidade com frontend
    eventos,              // mantém campo original
    total_eventos: eventos.length,
    total_valor_estimado: Math.round(totalValor * 100) / 100
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/lembretes/reset-status — resetar status_mes de lembretes cujo
// proximo_vencimento já passou (recorrência automática)
// ─────────────────────────────────────────────────────────────────────────────
lembretes.post('/reset-status', requireAuth, async (c) => {
  const user = c.get('user')
  const hoje = new Date().toISOString().split('T')[0]

  // Buscar lembretes com status pago/ignorado e proximo_vencimento <= hoje
  const vencidos = await c.env.DB.prepare(
    `SELECT id, dia_vencimento, frequencia FROM lembretes 
     WHERE user_id = ? AND ativo = 1 AND status_mes IN ('pago','ignorado','recebido')
     AND proximo_vencimento <= ?`
  ).bind(user.id, hoje).all()

  let resetados = 0
  for (const l of (vencidos.results as any[])) {
    const novoProximo = calcProximoVencimento(l.dia_vencimento || 1, l.frequencia || 'mensal')
    await c.env.DB.prepare(
      `UPDATE lembretes SET status_mes = 'aguardando', proximo_vencimento = ? WHERE id = ? AND user_id = ?`
    ).bind(novoProximo, l.id, user.id).run()
    resetados++
  }

  return c.json({ success: true, resetados, message: `${resetados} lembrete(s) renovado(s) para o próximo ciclo` })
})

// ─────────────────────────────────────────────────────────────────────────────
// S-L7: POST /api/lembretes/bulk — criar múltiplos lembretes
// ─────────────────────────────────────────────────────────────────────────────
lembretes.post('/bulk', requireAuth, async (c) => {
  const user = c.get('user')
  const lim  = getLimites(user.plano)
  const body = await c.req.json() as any

  if (!Array.isArray(body.lembretes) || body.lembretes.length === 0)
    return c.json({ error: 'Envie um array lembretes com ao menos 1 item' }, 400)
  if (body.lembretes.length > 20)
    return c.json({ error: 'Máximo de 20 lembretes por chamada' }, 400)

  if (lim.lembretes !== Infinity) {
    const countRow = await c.env.DB.prepare('SELECT COUNT(*) as n FROM lembretes WHERE user_id = ? AND ativo = 1').bind(user.id).first() as any
    const atual = Number(countRow?.n || 0)
    if (atual + body.lembretes.length > lim.lembretes)
      return c.json({ error: `Limite do plano: ${lim.lembretes} lembretes ativos. Atualmente: ${atual}`, upgrade: true }, 403)
  }

  const criados: number[] = []
  const erros: { index: number; error: string }[] = []

  for (let i = 0; i < body.lembretes.length; i++) {
    const item = body.lembretes[i]
    if (!item.titulo) { erros.push({ index: i, error: 'titulo obrigatório' }); continue }
    const tipo       = item.tipo || 'conta'
    const frequencia = item.frequencia || 'mensal'
    if (!TIPOS_LEMBRETE.includes(tipo))      { erros.push({ index: i, error: `tipo inválido: ${tipo}` }); continue }
    if (!FREQUENCIAS_VALIDAS.includes(frequencia)) { erros.push({ index: i, error: `frequencia inválida: ${frequencia}` }); continue }

    const tagsStr = Array.isArray(item.tags) ? JSON.stringify(item.tags) : (item.tags || null)
    const proximo = calcProximoVencimento(parseInt(item.dia_vencimento) || 1, frequencia)

    const r = await c.env.DB.prepare(
      `INSERT INTO lembretes (user_id, titulo, descricao, tipo, valor_estimado, dia_vencimento,
       frequencia, proximo_vencimento, alertar_dias_antes, notas, tags, cor)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      user.id, item.titulo, item.descricao || null, tipo,
      parseFloat(String(item.valor_estimado || 0)) || 0,
      item.dia_vencimento ? parseInt(item.dia_vencimento) : null,
      frequencia, proximo, parseInt(item.alertar_dias_antes || 3),
      item.notas || null, tagsStr, item.cor || null
    ).run()
    criados.push(r.meta.last_row_id as number)
  }

  return c.json({
    success: true, criados: criados.length, ids: criados,
    erros: erros.length > 0 ? erros : undefined,
    message: `${criados.length} lembrete(s) criado(s)${erros.length > 0 ? `, ${erros.length} com erro` : ''}`
  }, 201)
})

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/lembretes/:id
// ─────────────────────────────────────────────────────────────────────────────
lembretes.delete('/:id', requireAuth, async (c) => {
  const user = c.get('user')
  const id = parseId(c.req.param('id'))   // LB12
  if (!id) return c.json({ error: 'Lembrete não encontrado' }, 404)
  const exists = await c.env.DB.prepare('SELECT id FROM lembretes WHERE id = ? AND user_id = ?').bind(id, user.id).first()
  if (!exists) return c.json({ error: 'Lembrete não encontrado' }, 404)

  await c.env.DB.prepare('DELETE FROM lembretes WHERE id = ? AND user_id = ?').bind(id, user.id).run()
  return c.json({ success: true, message: 'Lembrete removido!' })
})

// ─── Helpers ─────────────────────────────────────────────────────────────────
// LB8: semanal/quinzenal usam DIAS. Antes o mapa tinha semanal:0, e como `0` é
// falsy o `|| 1` transformava em 1 mês — semanal, quinzenal e mensal davam a
// mesma data.
const FREQ_DIAS: Record<string, number> = { semanal: 7, quinzenal: 15 }
const FREQ_MESES: Record<string, number> = { mensal: 1, bimestral: 2, trimestral: 3, semestral: 6, anual: 12 }
function avancarFrequencia(base: Date, frequencia: string): void {
  if (FREQ_DIAS[frequencia]) base.setDate(base.getDate() + FREQ_DIAS[frequencia])
  else base.setMonth(base.getMonth() + (FREQ_MESES[frequencia] || 1))
}
function calcProximoVencimento(dia: number, frequencia: string): string {
  const hoje = hojeMeiaNoite()
  const proximo = new Date(hoje.getFullYear(), hoje.getMonth(), dia)
  while (proximo <= hoje) avancarFrequencia(proximo, frequencia)
  return proximo.toISOString().split('T')[0]
}
// LB19: ao pagar/converter, avança um ciclo ALÉM do vencimento corrente, para a
// conta já quitada não reaparecer como "aguardando" no mesmo mês.
function proximoAposPagar(dia: number, frequencia: string): string {
  const hoje = hojeMeiaNoite()
  const base = new Date(hoje.getFullYear(), hoje.getMonth(), dia)
  avancarFrequencia(base, frequencia)
  while (base <= hoje) avancarFrequencia(base, frequencia)
  return base.toISOString().split('T')[0]
}

async function verificarConquista(db: D1Database, userId: number, codigo: string) {
  try {
    await db.prepare('INSERT OR IGNORE INTO conquistas_usuario (user_id, conquista_codigo, visualizado) VALUES (?, ?, 0)').bind(userId, codigo).run()
  } catch { }
}

export default lembretes
