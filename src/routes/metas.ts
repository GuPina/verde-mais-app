import { Hono } from 'hono'
import { requireAuth } from './auth'
import { ERRO_DATA, normalizarData } from '../lib/validacao'
import { getLimites, MSG_UPGRADE } from './planos'
import { ensureTag, COR_MODULO } from '../utils/tags-helper'

type Bindings = { DB: D1Database }
type Variables = { user: { id: number; nome: string; email: string; plano: string } }

const metas = new Hono<{ Bindings: Bindings; Variables: Variables }>()

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/metas?status=ativa&prioridade=3
// S-M5: suporta filtro por prioridade; ordena por prioridade DESC, data ASC
// ─────────────────────────────────────────────────────────────────────────────
metas.get('/', requireAuth, async (c) => {
  const user = c.get('user')
  const { status, prioridade } = c.req.query()

  let query = 'SELECT * FROM metas WHERE user_id = ?'
  const params: any[] = [user.id]

  if (status) { query += ' AND status = ?'; params.push(status) }
  if (prioridade) { query += ' AND prioridade = ?'; params.push(parseInt(prioridade)) }

  query += ' ORDER BY COALESCE(prioridade,2) DESC, data_meta ASC'
  const result = await c.env.DB.prepare(query).bind(...params).all()

  // Buscar aporte já realizado neste mês para cada meta (corrige cálculo de mensalidade)
  const hoje = new Date()
  const mesAtual  = hoje.getMonth() + 1
  const anoAtual  = hoje.getFullYear()
  const inicioMes = `${anoAtual}-${String(mesAtual).padStart(2, '0')}-01`
  const fimMes    = `${anoAtual}-${String(mesAtual).padStart(2, '0')}-31`

  // Buscar aportes do mês para todas as metas do usuário de uma vez
  const aportesRes = await c.env.DB.prepare(
    `SELECT meta_id, COALESCE(SUM(valor),0) as aporte_mes
     FROM meta_historico
     WHERE user_id = ? AND tipo = 'aporte' AND data >= ? AND data <= ?
     GROUP BY meta_id`
  ).bind(user.id, inicioMes, fimMes).all()

  const aportesMap: Record<number, number> = {}
  for (const r of aportesRes.results as any[]) {
    aportesMap[Number(r.meta_id)] = Number(r.aporte_mes || 0)
  }

  const metasComMetricas = (result.results as any[]).map(meta => {
    const percentual     = meta.valor_objetivo > 0 ? (meta.valor_atual / meta.valor_objetivo) * 100 : 0
    const dataMeta       = new Date(meta.data_meta)
    const atrasada       = dataMeta < hoje && meta.status === 'ativa'
    const mesesRestantes = Math.max(0, Math.ceil((dataMeta.getTime() - hoje.getTime()) / (1000 * 60 * 60 * 24 * 30)))
    const valorFaltante  = Math.max(0, meta.valor_objetivo - meta.valor_atual)

    // Corrigir: descontar o que já foi aportado neste mês do faltante antes de dividir
    const aporteMesAtual  = aportesMap[Number(meta.id)] || 0
    const faltanteAjustado = Math.max(0, valorFaltante - aporteMesAtual)
    const mensalidade     = mesesRestantes > 0 ? faltanteAjustado / mesesRestantes : faltanteAjustado

    return {
      ...meta,
      percentual: Math.min(100, Math.round(percentual * 10) / 10),
      meses_restantes: mesesRestantes,
      valor_faltante: Math.round(valorFaltante * 100) / 100,
      mensalidade_necessaria: Math.round(mensalidade * 100) / 100,
      aporte_mes_atual: Math.round(aporteMesAtual * 100) / 100,
      atrasada,
      prioridade: meta.prioridade ?? 2,
      prioridade_label: PRIORIDADE_LABEL[meta.prioridade ?? 2] || 'Média'
    }
  })

  return c.json({ metas: metasComMetricas })
})

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/metas/resumo — S-M3: visão consolidada com totais por categoria
// IMPORTANTE: deve ficar ANTES de /:id para não ser capturado pelo param
// ─────────────────────────────────────────────────────────────────────────────
metas.get('/resumo', requireAuth, async (c) => {
  const user = c.get('user')

  const [todas, ativas, concluidas, canceladas] = await Promise.all([
    c.env.DB.prepare('SELECT COUNT(*) as n, COALESCE(SUM(valor_objetivo),0) as obj, COALESCE(SUM(valor_atual),0) as atual FROM metas WHERE user_id = ?').bind(user.id).first() as any,
    c.env.DB.prepare('SELECT COUNT(*) as n, COALESCE(SUM(valor_objetivo),0) as obj, COALESCE(SUM(valor_atual),0) as atual FROM metas WHERE user_id = ? AND status = ?').bind(user.id, 'ativa').first() as any,
    c.env.DB.prepare('SELECT COUNT(*) as n FROM metas WHERE user_id = ? AND status = ?').bind(user.id, 'concluida').first() as any,
    c.env.DB.prepare('SELECT COUNT(*) as n FROM metas WHERE user_id = ? AND status = ?').bind(user.id, 'cancelada').first() as any,
  ])

  // Breakdown por categoria (só ativas)
  const porCat = await c.env.DB.prepare(
    `SELECT categoria,
            COUNT(*) as qtd,
            COALESCE(SUM(valor_objetivo),0) as total_objetivo,
            COALESCE(SUM(valor_atual),0) as total_atual
     FROM metas WHERE user_id = ? AND status = 'ativa'
     GROUP BY categoria ORDER BY total_objetivo DESC`
  ).bind(user.id).all()

  const totalObj  = Number(ativas?.obj  || 0)
  const totalAtual = Number(ativas?.atual || 0)
  const pctGeral  = totalObj > 0 ? Math.round((totalAtual / totalObj) * 100) : 0

  return c.json({
    totais: {
      total: Number(todas?.n || 0),
      ativas: Number(ativas?.n || 0),
      concluidas: Number(concluidas?.n || 0),
      canceladas: Number(canceladas?.n || 0),
      total_objetivo: Math.round(totalObj * 100) / 100,
      total_atual: Math.round(totalAtual * 100) / 100,
      percentual_geral: pctGeral
    },
    por_categoria: (porCat.results as any[]).map(r => ({
      categoria: r.categoria,
      qtd: Number(r.qtd),
      total_objetivo: Math.round(Number(r.total_objetivo) * 100) / 100,
      total_atual: Math.round(Number(r.total_atual) * 100) / 100,
      percentual: Number(r.total_objetivo) > 0
        ? Math.round((Number(r.total_atual) / Number(r.total_objetivo)) * 100)
        : 0
    }))
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/metas/:id/historico — S-M2: histórico de aportes e saques
// IMPORTANTE: deve ficar ANTES de /:id/deposito para garantir matching correto
// ─────────────────────────────────────────────────────────────────────────────
metas.get('/:id/historico', requireAuth, async (c) => {
  const user = c.get('user')
  const id   = c.req.param('id')
  const limit  = Math.min(parseInt(c.req.query('limit')  || '50'), 200)
  const offset = parseInt(c.req.query('offset') || '0')

  const meta = await c.env.DB.prepare(
    'SELECT id, nome, valor_atual, valor_objetivo FROM metas WHERE id = ? AND user_id = ?'
  ).bind(id, user.id).first() as any
  if (!meta) return c.json({ error: 'Meta não encontrada' }, 404)

  const hist = await c.env.DB.prepare(
    `SELECT * FROM meta_historico WHERE meta_id = ? ORDER BY data DESC LIMIT ? OFFSET ?`
  ).bind(id, limit, offset).all()

  const count = await c.env.DB.prepare(
    'SELECT COUNT(*) as n FROM meta_historico WHERE meta_id = ?'
  ).bind(id).first() as any

  return c.json({
    meta: { id: meta.id, nome: meta.nome, valor_atual: meta.valor_atual, valor_objetivo: meta.valor_objetivo },
    historico: hist.results,
    total: Number(count?.n || 0),
    limit,
    offset
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/metas
// S-M5: aceita campo prioridade (1=baixa, 2=media, 3=alta)
// ─────────────────────────────────────────────────────────────────────────────
metas.post('/', requireAuth, async (c) => {
  const user = c.get('user')

  const lim = getLimites(user.plano)
  if (lim.metas !== Infinity) {
    const count = await c.env.DB.prepare('SELECT COUNT(*) as n FROM metas WHERE user_id = ?').bind(user.id).first() as any
    if ((count?.n || 0) >= lim.metas)
      return c.json({ error: MSG_UPGRADE.metas, upgrade: true, limite: lim.metas }, 403)
  }
  const body = await c.req.json()
  const {
    nome, descricao, valor_objetivo, valor_atual = 0, data_meta,
    categoria = 'economia', cor = '#2FBF71', icone = 'piggy-bank',
    linked_debt_type = null, linked_debt_id = null,
    prioridade = 2  // S-M5
  } = body

  if (!nome || !data_meta)
    return c.json({ error: 'Campos obrigatórios: nome, data_meta' }, 400)

  const dataMetaISO = normalizarData(data_meta)
  if (!dataMetaISO) return c.json({ error: ERRO_DATA }, 400)

  // Prazo no passado: uma meta é um compromisso com o futuro. Aceitar
  // 2020-01-01 gerava meta nascida vencida, com progresso e projeção sem
  // sentido. A comparação é por string porque as duas datas são ISO.
  const hojeISO = new Date().toISOString().split('T')[0]
  if (dataMetaISO < hojeISO) {
    return c.json({
      error: 'O prazo da meta está no passado. Escolha uma data futura.',
      data_informada: dataMetaISO,
      hoje: hojeISO,
    }, 400)
  }

  // S-M5: validar prioridade
  if (![1, 2, 3].includes(Number(prioridade)))
    return c.json({ error: 'prioridade deve ser 1 (baixa), 2 (média) ou 3 (alta)' }, 400)

  let valorObj     = valor_objetivo ? parseFloat(valor_objetivo) : 0
  let valorAtual   = parseFloat(valor_atual)
  let originalDebt = null

  if (categoria === 'debt_payoff' && linked_debt_type) {
    try {
      const { total, pago } = await calcDebtTotals(c.env.DB, user.id, linked_debt_type, linked_debt_id)
      if (total > 0) {
        valorObj = total + pago; valorAtual = pago; originalDebt = valorObj
      } else if (valorObj > 0) {
        originalDebt = valorObj
      } else {
        return c.json({ error: 'Nenhuma dívida ativa encontrada. Informe o valor_objetivo manualmente.' }, 400)
      }
    } catch {
      if (valorObj <= 0) return c.json({ error: 'Campo obrigatório: valor_objetivo' }, 400)
      originalDebt = valorObj
    }
  } else if (!valor_objetivo) {
    return c.json({ error: 'Campo obrigatório: valor_objetivo' }, 400)
  }

  const result = await c.env.DB.prepare(
    `INSERT INTO metas (user_id, nome, descricao, valor_objetivo, valor_atual, data_meta,
     categoria, cor, icone, linked_debt_type, linked_debt_id, original_debt_amount, prioridade)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    user.id, nome, descricao || null,
    valorObj, valorAtual, dataMetaISO, categoria, cor, icone,
    linked_debt_type, linked_debt_id ? parseInt(linked_debt_id) : null,
    originalDebt, Number(prioridade)
  ).run()

  const nomeMin = nome.toLowerCase()
  const catMeta = categoria || ''
  if (catMeta === 'imovel' || nomeMin.includes('casa') || nomeMin.includes('aparta') || nomeMin.includes('imóvel') || nomeMin.includes('imovel'))
    await verificarConquista(c.env.DB, user.id, 'meta_casa')
  if (catMeta === 'veiculo' || nomeMin.includes('carro') || nomeMin.includes('moto') || nomeMin.includes('veículo'))
    await verificarConquista(c.env.DB, user.id, 'meta_carro')
  if (catMeta === 'viagem' || nomeMin.includes('viagem') || nomeMin.includes('férias') || nomeMin.includes('ferias') || nomeMin.includes('trip'))
    await verificarConquista(c.env.DB, user.id, 'meta_viagem')
  if (catMeta === 'educacao' || nomeMin.includes('curso') || nomeMin.includes('faculdade') || nomeMin.includes('educação') || nomeMin.includes('educacao'))
    await verificarConquista(c.env.DB, user.id, 'meta_educacao')
  if (catMeta === 'liberdade' || nomeMin.includes('liberdade') || nomeMin.includes('independência') || nomeMin.includes('independencia') || nomeMin.includes('fire'))
    await verificarConquista(c.env.DB, user.id, 'meta_liberdade')
  if (catMeta === 'aposentadoria' || nomeMin.includes('aposenta') || nomeMin.includes('previdência') || nomeMin.includes('previdencia') || nomeMin.includes('reforma'))
    await verificarConquista(c.env.DB, user.id, 'meta_aposentadoria')
  await verificarConquista(c.env.DB, user.id, 'planejador')
  await verificarConquista(c.env.DB, user.id, 'sonhador')

  // ── Tags automáticas para a meta ─────────────────────────────
  // Metas não geram despesas diretamente, mas criamos a tag para ser usada
  // ao marcar aportes manuais e despesas relacionadas à meta
  const metaId = result.meta.last_row_id as number
  try {
    await ensureTag(c.env.DB, user.id, 'Meta', COR_MODULO.meta)
    await ensureTag(c.env.DB, user.id, nome.trim().slice(0, 30), COR_MODULO.meta)
    if (categoria && categoria !== 'outros') {
      const catNome = categoria.charAt(0).toUpperCase() + categoria.slice(1)
      await ensureTag(c.env.DB, user.id, catNome, COR_MODULO.meta)
    }
  } catch (_) { /* best-effort */ }

  return c.json({ success: true, id: metaId, message: 'Meta criada!' }, 201)
})

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/metas/:id
// S-M5: aceita campo prioridade
// ─────────────────────────────────────────────────────────────────────────────
metas.put('/:id', requireAuth, async (c) => {
  const user = c.get('user')
  const id   = c.req.param('id')
  const body = await c.req.json()

  const metaAtual = await c.env.DB.prepare('SELECT * FROM metas WHERE id = ? AND user_id = ?').bind(id, user.id).first() as any
  if (!metaAtual) return c.json({ error: 'Meta não encontrada' }, 404)

  const { nome, descricao, valor_objetivo, valor_atual, data_meta, categoria, cor, icone, status, prioridade } = body

  const STATUS_VALIDOS    = ['ativa', 'concluida', 'cancelada', 'arquivada']
  const PRIORIDADE_VALIDA = [1, 2, 3]
  const novoStatus        = status    ?? metaAtual.status    ?? 'ativa'
  const novaPrioridade    = prioridade !== undefined ? Number(prioridade) : (metaAtual.prioridade ?? 2)

  if (!STATUS_VALIDOS.includes(novoStatus))
    return c.json({ error: `Status inválido. Use: ${STATUS_VALIDOS.join(', ')}` }, 400)
  if (!PRIORIDADE_VALIDA.includes(novaPrioridade))
    return c.json({ error: 'prioridade deve ser 1 (baixa), 2 (média) ou 3 (alta)' }, 400)

  await c.env.DB.prepare(
    `UPDATE metas SET nome = ?, descricao = ?, valor_objetivo = ?, valor_atual = ?,
     data_meta = ?, categoria = ?, cor = ?, icone = ?, status = ?, prioridade = ?
     WHERE id = ? AND user_id = ?`
  ).bind(
    nome ?? metaAtual.nome,
    descricao !== undefined ? (descricao || null) : metaAtual.descricao,
    valor_objetivo !== undefined ? parseFloat(valor_objetivo) : metaAtual.valor_objetivo,
    valor_atual    !== undefined ? parseFloat(valor_atual)    : metaAtual.valor_atual,
    data_meta ?? metaAtual.data_meta,
    categoria ?? metaAtual.categoria,
    cor       ?? metaAtual.cor,
    icone     ?? metaAtual.icone,
    novoStatus, novaPrioridade, id, user.id
  ).run()

  return c.json({ success: true, message: 'Meta atualizada!' })
})

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/metas/:id/deposito
// S-M1: aceita campo tipo ('aporte' | 'saque') e descricao opcional
// S-M2: registra em meta_historico
// S-M4: verifica e dispara milestones 25/50/75/100%
// ─────────────────────────────────────────────────────────────────────────────
metas.patch('/:id/deposito', requireAuth, async (c) => {
  const user = c.get('user')
  const id   = c.req.param('id')
  const body = await c.req.json()

  const valorNum = parseFloat(body.valor)
  const tipo     = (body.tipo || 'aporte') as string
  const descricao = body.descricao || null

  if (isNaN(valorNum) || valorNum <= 0)
    return c.json({ error: 'O valor deve ser maior que zero' }, 400)
  if (!['aporte', 'saque'].includes(tipo))
    return c.json({ error: 'tipo deve ser "aporte" ou "saque"' }, 400)

  const meta = await c.env.DB.prepare('SELECT * FROM metas WHERE id = ? AND user_id = ?').bind(id, user.id).first() as any
  if (!meta) return c.json({ error: 'Meta não encontrada' }, 404)
  if (meta.status === 'concluida')
    return c.json({ error: 'Meta já concluída. Reabertura via PUT /metas/:id com status=ativa.' }, 400)

  const valorAntes = Number(meta.valor_atual)

  // S-M1: para saque, verificar se há saldo suficiente
  let novoValor: number
  if (tipo === 'saque') {
    if (valorNum > valorAntes)
      return c.json({ error: `Saldo insuficiente. Disponível: R$ ${valorAntes.toFixed(2)}` }, 400)
    novoValor = valorAntes - valorNum
  } else {
    novoValor = valorAntes + valorNum
  }

  const novoValorArredondado = Math.round(novoValor * 100) / 100
  const statusNovo = (tipo === 'aporte' && novoValorArredondado >= meta.valor_objetivo) ? 'concluida' : meta.status

  // Atualizar meta
  await c.env.DB.prepare(
    'UPDATE metas SET valor_atual = ?, status = ? WHERE id = ? AND user_id = ?'
  ).bind(novoValorArredondado, statusNovo, id, user.id).run()

  // S-M2: registrar no histórico
  await c.env.DB.prepare(
    `INSERT INTO meta_historico (meta_id, user_id, tipo, valor, descricao, valor_antes, valor_depois)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, user.id, tipo, valorNum, descricao, valorAntes, novoValorArredondado).run()

  // S-M4: verificar milestones (somente aporte)
  let novosMilestones: number[] = []
  if (tipo === 'aporte' && meta.valor_objetivo > 0) {
    const milestones = [25, 50, 75, 100]
    const jaDisparados = String(meta.milestones_disparados || '').split(',').map(Number).filter(Boolean)
    const pctAntes = (valorAntes / meta.valor_objetivo) * 100
    const pctDepois = (novoValorArredondado / meta.valor_objetivo) * 100

    novosMilestones = milestones.filter(m => !jaDisparados.includes(m) && pctAntes < m && pctDepois >= m)

    if (novosMilestones.length > 0) {
      const todosDisparados = [...jaDisparados, ...novosMilestones].join(',')
      await c.env.DB.prepare(
        'UPDATE metas SET milestones_disparados = ? WHERE id = ? AND user_id = ?'
      ).bind(todosDisparados, id, user.id).run()
    }
  }

  if (statusNovo === 'concluida')
    await verificarConquista(c.env.DB, user.id, 'meta_concluida')

  const msgBase = tipo === 'saque'
    ? `R$ ${valorNum.toFixed(2)} sacado da meta`
    : statusNovo === 'concluida' ? '🎉 Parabéns! Meta concluída!' : `R$ ${valorNum.toFixed(2)} adicionado à meta!`

  return c.json({
    success: true,
    tipo,
    novo_valor: novoValorArredondado,
    valor_anterior: valorAntes,
    status: statusNovo,
    message: msgBase,
    milestones_atingidos: novosMilestones   // S-M4: frontend pode exibir celebração
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/metas/:id
// ─────────────────────────────────────────────────────────────────────────────
metas.delete('/:id', requireAuth, async (c) => {
  const user = c.get('user')
  const id   = c.req.param('id')

  const existing = await c.env.DB.prepare('SELECT id FROM metas WHERE id = ? AND user_id = ?').bind(id, user.id).first()
  if (!existing) return c.json({ error: 'Meta não encontrada' }, 404)

  await c.env.DB.prepare('DELETE FROM metas WHERE id = ? AND user_id = ?').bind(id, user.id).run()
  return c.json({ success: true, message: 'Meta excluída!' })
})

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/metas/sincronizar-dividas
// ─────────────────────────────────────────────────────────────────────────────
metas.post('/sincronizar-dividas', requireAuth, async (c) => {
  const user = c.get('user')

  const metasDivida = await c.env.DB.prepare(
    `SELECT * FROM metas WHERE user_id = ? AND categoria = 'debt_payoff' AND status = 'ativa'`
  ).bind(user.id).all()

  let atualizadas = 0
  for (const meta of metasDivida.results as any[]) {
    const { total, pago } = await calcDebtTotals(c.env.DB, user.id, meta.linked_debt_type, meta.linked_debt_id)
    const originalDebt = Number(meta.original_debt_amount) || (total + pago)
    const valorAtual   = originalDebt - total
    const concluida    = total === 0

    await c.env.DB.prepare(
      `UPDATE metas SET valor_atual = ?, status = ?, original_debt_amount = ? WHERE id = ? AND user_id = ?`
    ).bind(Math.max(0, valorAtual), concluida ? 'concluida' : 'ativa', originalDebt, meta.id, user.id).run()

    if (concluida) await verificarConquista(c.env.DB, user.id, 'sem_dividas')
    atualizadas++
  }

  return c.json({ success: true, metas_atualizadas: atualizadas })
})

export default metas

// ─── Constantes ─────────────────────────────────────────────────────────────
const PRIORIDADE_LABEL: Record<number, string> = { 1: 'Baixa', 2: 'Média', 3: 'Alta' }

// ─── Helpers ─────────────────────────────────────────────────────────────────
async function calcDebtTotals(
  db: D1Database, userId: number,
  debtType: string | null, debtId: number | null
): Promise<{ total: number; pago: number }> {
  if (!debtType) return { total: 0, pago: 0 }

  if (debtType === 'all') {
    const [f, e] = await Promise.all([
      db.prepare(`SELECT COALESCE(SUM(saldo_devedor),0) as saldo, COALESCE(SUM(valor_financiado - saldo_devedor),0) as pago FROM financiamentos WHERE user_id = ? AND status = 'ativo'`).bind(userId).first() as any,
      db.prepare(`SELECT COALESCE(SUM(saldo_devedor),0) as saldo, COALESCE(SUM(valor_pago),0) as pago FROM emprestimos WHERE user_id = ? AND status = 'ativo'`).bind(userId).first() as any,
    ])
    return { total: Number(f?.saldo || 0) + Number(e?.saldo || 0), pago: Number(f?.pago || 0) + Number(e?.pago || 0) }
  }
  if (debtType === 'financiamento') {
    const r = await db.prepare(`SELECT COALESCE(SUM(saldo_devedor),0) as saldo, COALESCE(SUM(valor_financiado - saldo_devedor),0) as pago FROM financiamentos WHERE user_id = ? AND status = 'ativo'`).bind(userId).first() as any
    return { total: Number(r?.saldo || 0), pago: Number(r?.pago || 0) }
  }
  if (debtType === 'emprestimo') {
    const r = await db.prepare(`SELECT COALESCE(SUM(saldo_devedor),0) as saldo, COALESCE(SUM(valor_pago),0) as pago FROM emprestimos WHERE user_id = ? AND status = 'ativo'`).bind(userId).first() as any
    return { total: Number(r?.saldo || 0), pago: Number(r?.pago || 0) }
  }
  if (debtType === 'especifico' && debtId) {
    let r = await db.prepare('SELECT saldo_devedor as saldo, (valor_financiado - saldo_devedor) as pago FROM financiamentos WHERE id = ? AND user_id = ?').bind(debtId, userId).first() as any
    if (!r) r = await db.prepare('SELECT saldo_devedor as saldo, valor_pago as pago FROM emprestimos WHERE id = ? AND user_id = ?').bind(debtId, userId).first() as any
    return { total: Number(r?.saldo || 0), pago: Number(r?.pago || 0) }
  }
  return { total: 0, pago: 0 }
}

async function verificarConquista(db: D1Database, userId: number, codigo: string) {
  try {
    await db.prepare('INSERT OR IGNORE INTO conquistas_usuario (user_id, conquista_codigo, visualizado) VALUES (?, ?, 0)').bind(userId, codigo).run()
  } catch { }
}
