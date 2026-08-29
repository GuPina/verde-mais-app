import { Hono } from 'hono'
import { requireAuth } from './auth'
import { ensureTag, COR_MODULO } from '../utils/tags-helper'
import { normalizarData, ERRO_DATA } from '../lib/validacao'

type Bindings = { DB: D1Database }
type Variables = { user: { id: number; nome: string; plano: string } }

const recorrencias = new Hono<{ Bindings: Bindings; Variables: Variables }>()

// ── Validação (Postgres é estrito: NaN passa no CHECK, id/dia não numérico 500).
const MAX_VALOR = 1_000_000_000
const MSG_FREE_REC = { error: 'Recorrências automáticas são exclusivas do plano Premium.', upgrade: true, feature: 'recorrencias' }
function parseValorPositivo(valor: unknown): number | null {
  if (typeof valor === 'string' && !/^\d+(\.\d+)?$/.test(valor.trim())) return null
  const n = typeof valor === 'number' ? valor : parseFloat(String(valor))
  if (!Number.isFinite(n) || n <= 0 || n > MAX_VALOR) return null
  return Math.round(n * 100) / 100
}
function parseId(valor: unknown): number | null {
  const t = String(valor ?? '')
  return /^\d+$/.test(t) && parseInt(t, 10) > 0 ? parseInt(t, 10) : null
}
function parseDia(valor: unknown): number | null {
  const n = Number(valor)
  return Number.isInteger(n) && n >= 1 && n <= 31 ? n : null
}

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
  const id    = parseId(c.req.param('id'))
  if (!id) return c.json({ error: 'Recorrência não encontrada' }, 404)
  const meses = Math.min(Math.max(1, parseInt(c.req.query('meses') || '6', 10) || 6), 24)

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
    if (!expirou) totalProjetado += valorMes || 0   // RC15: não somar meses já expirados

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
  const id    = parseId(c.req.param('id'))
  if (!id) return c.json({ error: 'Recorrência não encontrada' }, 404)
  const limit = Math.min(Math.max(1, parseInt(c.req.query('limit') || '6', 10) || 6), 200)   // RC8

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

  const descricaoLimpa = String(descricao ?? '').trim()   // RC18: só-espaços não passa
  if (!tipo || !descricaoLimpa || !categoria || dia_vencimento === undefined || dia_vencimento === null) {
    return c.json({ error: 'Campos obrigatórios: tipo, descricao, categoria, dia_vencimento' }, 400)
  }
  if (!['despesa', 'receita'].includes(tipo)) {
    return c.json({ error: 'tipo deve ser: despesa ou receita' }, 400)
  }
  const diaNum = parseDia(dia_vencimento)   // RC9: 99/-5/'abc' → 400 (era 500)
  if (diaNum === null) return c.json({ error: 'dia_vencimento deve ser um inteiro entre 1 e 31.' }, 400)

  // RC1: valor fixo validado (recusa NaN, ∞, negativo). Variável pode ficar sem valor.
  let valorSalvo = 0
  if (!valor_variavel) {
    const v = parseValorPositivo(valor)
    if (v === null) return c.json({ error: 'Informe um valor maior que zero para recorrências fixas.' }, 400)
    valorSalvo = v
  } else if (valor !== undefined && valor !== null && valor !== '') {
    valorSalvo = parseValorPositivo(valor) ?? 0
  }

  // RC17: valida data_inicio E data_fim (antes só data_inicio), e a ordem entre elas.
  let dataInicioISO: string | null = null
  if (data_inicio) {
    dataInicioISO = normalizarData(data_inicio)
    if (!dataInicioISO) return c.json({ error: `data_inicio: ${ERRO_DATA}` }, 400)
  }
  let dataFimISO: string | null = null
  if (data_fim) {
    dataFimISO = normalizarData(data_fim)
    if (!dataFimISO) return c.json({ error: `data_fim: ${ERRO_DATA}` }, 400)
  }
  if (dataInicioISO && dataFimISO && dataFimISO < dataInicioISO)
    return c.json({ error: 'data_fim não pode ser anterior à data_inicio.' }, 400)

  const tagsStr = Array.isArray(tags) ? JSON.stringify(tags) : (tags || null)

  const res = await c.env.DB.prepare(
    `INSERT INTO recorrencias
       (user_id, tipo, descricao, valor, categoria, dia_vencimento, meio_pagamento,
        data_fim, valor_variavel, data_inicio, notas, tags)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    user.id, tipo, descricaoLimpa, valorSalvo, categoria, diaNum,
    meio_pagamento, dataFimISO, valor_variavel ? 1 : 0,
    dataInicioISO, notas || null, tagsStr
  ).run()

  await verificarConquista(c.env.DB, user.id, 'primeira_recorrencia')

  const count = await c.env.DB.prepare(
    `SELECT COUNT(*) as n FROM recorrencias WHERE user_id = ? AND ativa = 1`
  ).bind(user.id).first() as any
  if ((count?.n || 0) >= 3) await verificarConquista(c.env.DB, user.id, '3_recorrencias')

  // ── Tags automáticas para a recorrência ────────────────────────
  const recId = res.meta.last_row_id as number
  try {
    await ensureTag(c.env.DB, user.id, 'Recorrência', COR_MODULO.recorrencia)
    await ensureTag(c.env.DB, user.id, descricaoLimpa.slice(0, 30), COR_MODULO.recorrencia)
    if (categoria) {
      await ensureTag(c.env.DB, user.id, categoria.trim().slice(0, 30), COR_MODULO.recorrencia)
    }
  } catch (_) { /* best-effort */ }

  return c.json({ success: true, id: recId })
})

// ─── PUT /api/recorrencias/:id — S-R5: suporte a notas e tags ────────────────
recorrencias.put('/:id', requireAuth, async (c) => {
  const user = c.get('user')
  if (user.plano === 'free') return c.json(MSG_FREE_REC, 403)   // RC22
  const id   = parseId(c.req.param('id'))                        // RC8
  if (!id) return c.json({ error: 'Recorrência não encontrada' }, 404)

  const recAtual = await c.env.DB.prepare(
    `SELECT * FROM recorrencias WHERE id = ? AND user_id = ?`
  ).bind(id, user.id).first() as any
  if (!recAtual) return c.json({ error: 'Recorrência não encontrada' }, 404)

  const body = await c.req.json()
  const { valor, meio_pagamento, data_fim, valor_variavel, data_inicio, notas, tags } = body

  // RC18: descrição só-espaços não zera o nome
  const descricao = body.descricao !== undefined ? String(body.descricao).trim() : recAtual.descricao
  if (!descricao) return c.json({ error: 'A descrição não pode ficar vazia.' }, 400)
  const categoria = body.categoria ?? recAtual.categoria

  // RC9: dia validado também na edição
  let dia_vencimento = recAtual.dia_vencimento
  if (body.dia_vencimento !== undefined) {
    const d = parseDia(body.dia_vencimento)
    if (d === null) return c.json({ error: 'dia_vencimento deve ser um inteiro entre 1 e 31.' }, 400)
    dia_vencimento = d
  }

  const vv = valor_variavel !== undefined ? valor_variavel : (recAtual.valor_variavel === 1)
  // RC1/RC7: o PUT não validava nada — valor:-999/'abc'/0 passavam com 200.
  let valorSalvo = Number(recAtual.valor)
  if (valor !== undefined) {
    if (vv) valorSalvo = (valor === '' || valor === null) ? 0 : (parseValorPositivo(valor) ?? 0)
    else {
      const v = parseValorPositivo(valor)
      if (v === null) return c.json({ error: 'Informe um valor maior que zero para recorrências fixas.' }, 400)
      valorSalvo = v
    }
  }
  const mpFinal = meio_pagamento ?? recAtual.meio_pagamento ?? 'outros'
  // RC17: valida datas na edição, e a ordem
  let dfFinal = recAtual.data_fim
  if (data_fim !== undefined) { dfFinal = data_fim ? normalizarData(data_fim) : null; if (data_fim && !dfFinal) return c.json({ error: `data_fim: ${ERRO_DATA}` }, 400) }
  let diFinal = recAtual.data_inicio
  if (data_inicio !== undefined) { diFinal = data_inicio ? normalizarData(data_inicio) : null; if (data_inicio && !diFinal) return c.json({ error: `data_inicio: ${ERRO_DATA}` }, 400) }
  if (diFinal && dfFinal && dfFinal < diFinal) return c.json({ error: 'data_fim não pode ser anterior à data_inicio.' }, 400)
  const notasFinal = notas !== undefined ? (notas || null) : recAtual.notas
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
  // Cobre lançamentos novos (recorrencia_id) E antigos (recorrencia_id NULL, por descrição+recorrente=1)
  const propagarPara = body.propagar_futuras ?? false
  if (propagarPara) {
    const hoje      = new Date().toISOString().split('T')[0]
    const descOrig  = recAtual.descricao.replace(/ \(Auto\)$/, '').trim()
    if (recAtual.tipo === 'receita') {
      await c.env.DB.prepare(
        `UPDATE receitas SET descricao=?, valor=?, categoria=?, meio_pagamento=?
         WHERE user_id=? AND data >= ?
           AND (recorrencia_id=?
                OR (recorrencia_id IS NULL AND recorrente=1
                    AND (descricao=? OR descricao=?)))`
      ).bind(descricao, valorSalvo, categoria, mpFinal,
             user.id, hoje, id, descOrig, descOrig + ' (Auto)').run()
    } else {
      await c.env.DB.prepare(
        `UPDATE despesas SET descricao=?, valor=?, categoria=?, meio_pagamento=?
         WHERE user_id=? AND vencimento >= ? AND status='pendente'
           AND (recorrencia_id=?
                OR (recorrencia_id IS NULL AND recorrente=1
                    AND (descricao=? OR descricao=?)))`
      ).bind(descricao, valorSalvo, categoria, mpFinal,
             user.id, hoje, id, descOrig, descOrig + ' (Auto)').run()
    }
  }

  return c.json({ success: true, propagadas: propagarPara })
})

// ─── PATCH /api/recorrencias/:id/toggle ──────────────────────────────────────
recorrencias.patch('/:id/toggle', requireAuth, async (c) => {
  const user = c.get('user')
  if (user.plano === 'free') return c.json(MSG_FREE_REC, 403)   // RC22
  const id   = parseId(c.req.param('id'))                        // RC8
  if (!id) return c.json({ error: 'Recorrência não encontrada' }, 404)

  const rec = await c.env.DB.prepare(
    `SELECT id, ativa FROM recorrencias WHERE id = ? AND user_id = ?`
  ).bind(id, user.id).first() as any
  if (!rec) return c.json({ error: 'Recorrência não encontrada' }, 404)

  const nova = rec.ativa ? 0 : 1
  await c.env.DB.prepare(`UPDATE recorrencias SET ativa = ? WHERE id = ?`).bind(nova, id).run()

  return c.json({ success: true, ativa: nova === 1 })
})

// ─── DELETE /api/recorrencias/:id ────────────────────────────────────────────
// Ao excluir uma recorrência, remove TODOS os lançamentos vinculados a ela
// que ainda não foram pagos/recebidos — garantindo consistência total entre
// as telas de Recorrências, Despesas e Receitas.
// Nota: receitas não têm coluna 'status', logo remove todas as vinculadas.
//       despesas têm 'status', remove apenas as 'pendente' (não as já pagas).
recorrencias.delete('/:id', requireAuth, async (c) => {
  const user = c.get('user')
  if (user.plano === 'free') return c.json(MSG_FREE_REC, 403)   // RC22
  const id   = parseId(c.req.param('id'))                        // RC8
  if (!id) return c.json({ error: 'Recorrência não encontrada' }, 404)

  const rec = await c.env.DB.prepare(
    `SELECT id, tipo, descricao FROM recorrencias WHERE id = ? AND user_id = ?`
  ).bind(id, user.id).first() as any
  if (!rec) return c.json({ error: 'Recorrência não encontrada' }, 404)

  const recTipo  = rec.tipo || 'despesa'
  const descLike  = (rec.descricao || '').replace(/ \(Auto\)$/, '').trim()
  const hojeDel   = new Date().toISOString().split('T')[0]

  // RC3: o modal promete remover só "lançamentos futuros pendentes". Antes a
  // exclusão de receita apagava receitas já recebidas do passado (jun/jul/dez).
  // Agora só toca o que ainda está por vir (data/vencimento >= hoje).
  if (recTipo === 'receita') {
    await c.env.DB.prepare(
      `DELETE FROM receitas
       WHERE user_id = ? AND date(data) >= date(?)
         AND (recorrencia_id = ?
              OR (recorrencia_id IS NULL AND recorrente = 1
                  AND (descricao = ? OR descricao = ?)))`
    ).bind(user.id, hojeDel, id, descLike, descLike + ' (Auto)').run()
  } else {
    await c.env.DB.prepare(
      `DELETE FROM despesas
       WHERE user_id = ? AND status = 'pendente' AND date(COALESCE(vencimento, data)) >= date(?)
         AND (recorrencia_id = ?
              OR (recorrencia_id IS NULL AND recorrente = 1
                  AND (descricao = ? OR descricao = ?)))`
    ).bind(user.id, hojeDel, id, descLike, descLike + ' (Auto)').run()
  }

  await c.env.DB.prepare(
    `DELETE FROM recorrencias WHERE id = ? AND user_id = ?`
  ).bind(id, user.id).run()

  return c.json({ success: true, futuros_excluidos: true })
})

// ─── POST /api/recorrencias/:id/lancar ───────────────────────────────────────
recorrencias.post('/:id/lancar', requireAuth, async (c) => {
  const user = c.get('user')
  if (user.plano === 'free') return c.json(MSG_FREE_REC, 403)   // RC22
  const id   = parseId(c.req.param('id'))                        // RC8
  if (!id) return c.json({ error: 'Recorrência não encontrada' }, 404)

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
    // RC5/RC6: dedupe por recorrencia_id (não LIKE 'descricao%', que barrava a
    // recorrência por causa de uma despesa manual com prefixo igual).
    const existe = await c.env.DB.prepare(
      `SELECT id FROM despesas WHERE user_id=? AND recorrencia_id=? AND strftime('%Y-%m',COALESCE(data,vencimento))=? LIMIT 1`
    ).bind(user.id, rec.id, `${ano}-${mesStr}`).first()
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
      `SELECT id FROM receitas WHERE user_id=? AND recorrencia_id=? AND strftime('%Y-%m',data)=? LIMIT 1`
    ).bind(user.id, rec.id, `${ano}-${mesStr}`).first()
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

  // RC2: gravar o mês GERADO (não o dia do clique). Antes, gerar um mês passado
  // marcava ultimo_gerado=hoje e travava o mês atual para sempre.
  const mesGeradoRef = `${ano}-${mesStr}-01`
  await c.env.DB.prepare(
    `UPDATE recorrencias
     SET ultimo_gerado = CASE WHEN ultimo_gerado IS NULL OR ultimo_gerado < ? THEN ? ELSE ultimo_gerado END,
         ultimo_valor = ?, total_gerado = total_gerado + 1
     WHERE id = ?`
  ).bind(mesGeradoRef, mesGeradoRef, valorLancar, rec.id).run()

  return c.json({ success: true, tipo: rec.tipo, valor: valorLancar, mes, ano, data: dataVenc })
})

// ─── POST /api/recorrencias/processar ── S-R4: gera transações automaticamente
recorrencias.post('/processar', requireAuth, async (c) => {
  const user = c.get('user')
  if (user.plano === 'free') return c.json(MSG_FREE_REC, 403)   // RC22
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

    // RC16: data_fim comparada com o vencimento real, não com o dia 1º do mês
    // (recorrência encerrada em 05/05 gerava conta em 25/05).
    if (rec.data_fim && dataVenc > rec.data_fim) continue

    if (rec.tipo === 'despesa') {
      const existe = await c.env.DB.prepare(
        `SELECT id FROM despesas WHERE user_id=? AND recorrencia_id=? AND strftime('%Y-%m',COALESCE(data,vencimento))=? LIMIT 1`
      ).bind(user.id, rec.id, `${ano}-${mesStr}`).first()
      if (existe) continue
      await c.env.DB.prepare(
        `INSERT INTO despesas (user_id, descricao, valor, categoria, vencimento, data, status, meio_pagamento, parcelado, numero_parcelas, parcela_atual, recorrente, recorrencia_id)
         VALUES (?, ?, ?, ?, ?, ?, 'pendente', ?, 0, 1, 1, 1, ?)`
      ).bind(user.id, rec.descricao, rec.valor, rec.categoria, dataVenc, dataVenc, rec.meio_pagamento || 'outros', rec.id).run()   // RC13: sem "(Auto)"
      geradasItems.push({ tipo: 'despesa', descricao: rec.descricao, valor: rec.valor })
    } else {
      const existe = await c.env.DB.prepare(
        `SELECT id FROM receitas WHERE user_id=? AND recorrencia_id=? AND strftime('%Y-%m',data)=? LIMIT 1`
      ).bind(user.id, rec.id, `${ano}-${mesStr}`).first()
      if (existe) continue
      await c.env.DB.prepare(
        `INSERT INTO receitas (user_id, descricao, valor, categoria, data, recorrente, recorrencia_id)
         VALUES (?, ?, ?, ?, ?, 1, ?)`
      ).bind(user.id, rec.descricao, rec.valor, rec.categoria, dataVenc, rec.id).run()   // RC13
      geradasItems.push({ tipo: 'receita', descricao: rec.descricao, valor: rec.valor })
    }

    // RC2: grava o mês gerado (mesRef), não o dia do clique (dataHoje).
    await c.env.DB.prepare(
      `UPDATE recorrencias SET ultimo_gerado = ?, ultimo_valor = ?, total_gerado = total_gerado + 1 WHERE id = ?`
    ).bind(mesRef, rec.valor, rec.id).run()
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
  if (user.plano === 'free') return c.json(MSG_FREE_REC, 403)   // RC22
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

  const dataHojeMes = new Date().toISOString().split('T')[0]
  let geradas = 0
  for (const rec of (pendentes.results as any[])) {
    const lastDay  = new Date(anoInt, mesInt, 0).getDate()
    const dia      = Math.min(rec.dia_vencimento || 1, lastDay)
    const dataVenc = `${anoInt}-${mesStr}-${String(dia).padStart(2,'0')}`

    if (rec.data_fim && dataVenc > rec.data_fim) continue   // RC16

    if (rec.tipo === 'despesa') {
      const existe = await c.env.DB.prepare(
        `SELECT id FROM despesas WHERE user_id=? AND recorrencia_id=? AND strftime('%Y-%m',COALESCE(data,vencimento))=? LIMIT 1`
      ).bind(user.id, rec.id, `${anoInt}-${mesStr}`).first()
      if (existe) continue
      await c.env.DB.prepare(
        `INSERT INTO despesas (user_id, descricao, valor, categoria, vencimento, data, status, meio_pagamento, parcelado, numero_parcelas, parcela_atual, recorrente, recorrencia_id)
         VALUES (?, ?, ?, ?, ?, ?, 'pendente', ?, 0, 1, 1, 1, ?)`
      ).bind(user.id, rec.descricao, rec.valor, rec.categoria, dataVenc, dataVenc, rec.meio_pagamento || 'outros', rec.id).run()   // RC13
    } else {
      const existe = await c.env.DB.prepare(
        `SELECT id FROM receitas WHERE user_id=? AND recorrencia_id=? AND strftime('%Y-%m',data)=? LIMIT 1`
      ).bind(user.id, rec.id, `${anoInt}-${mesStr}`).first()
      if (existe) continue
      await c.env.DB.prepare(
        `INSERT INTO receitas (user_id, descricao, valor, categoria, data, recorrente, recorrencia_id)
         VALUES (?, ?, ?, ?, ?, 1, ?)`
      ).bind(user.id, rec.descricao, rec.valor, rec.categoria, dataVenc, rec.id).run()   // RC13
    }

    // RC14: manter ultimo_gerado/total_gerado em dia (o botão não fazia isso, e o
    // contador divergia do /processar).
    await c.env.DB.prepare(
      `UPDATE recorrencias SET ultimo_gerado = CASE WHEN ultimo_gerado IS NULL OR ultimo_gerado < ? THEN ? ELSE ultimo_gerado END,
              ultimo_valor = ?, total_gerado = total_gerado + 1 WHERE id = ?`
    ).bind(mesRef, mesRef, rec.valor, rec.id).run()
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
