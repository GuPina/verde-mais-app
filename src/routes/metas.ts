import { Hono } from 'hono'
import { requireAuth } from './auth'
import { getLimites, MSG_UPGRADE } from './planos'

type Bindings = { DB: D1Database }
type Variables = { user: { id: number; nome: string; email: string; plano: string } }

const metas = new Hono<{ Bindings: Bindings; Variables: Variables }>()

// GET /api/metas
metas.get('/', requireAuth, async (c) => {
  const user = c.get('user')
  const { status } = c.req.query()

  let query = 'SELECT * FROM metas WHERE user_id = ?'
  const params: any[] = [user.id]

  if (status) {
    query += ' AND status = ?'
    params.push(status)
  }

  query += ' ORDER BY data_meta ASC'
  const result = await c.env.DB.prepare(query).bind(...params).all()

  // Calcular métricas para cada meta
  const metasComMetricas = (result.results as any[]).map(meta => {
    const percentual = meta.valor_objetivo > 0 ? (meta.valor_atual / meta.valor_objetivo) * 100 : 0
    const hoje = new Date()
    const dataMeta = new Date(meta.data_meta)
    const mesesRestantes = Math.max(0, Math.ceil((dataMeta.getTime() - hoje.getTime()) / (1000 * 60 * 60 * 24 * 30)))
    const valorFaltante = Math.max(0, meta.valor_objetivo - meta.valor_atual)
    const mensalidade = mesesRestantes > 0 ? valorFaltante / mesesRestantes : valorFaltante

    return {
      ...meta,
      percentual: Math.min(100, Math.round(percentual * 10) / 10),
      meses_restantes: mesesRestantes,
      valor_faltante: valorFaltante,
      mensalidade_necessaria: Math.round(mensalidade * 100) / 100
    }
  })

  return c.json({ metas: metasComMetricas })
})

// POST /api/metas
metas.post('/', requireAuth, async (c) => {
  const user = c.get('user')

  // ── Limite de plano ──
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
    // Campos extras para meta de dívidas
    linked_debt_type = null, linked_debt_id = null
  } = body

  if (!nome || !data_meta) {
    return c.json({ error: 'Campos obrigatórios: nome, data_meta' }, 400)
  }

  // ── Meta de quitar dívidas: calcular valores automaticamente ──
  let valorObj     = valor_objetivo ? parseFloat(valor_objetivo) : 0
  let valorAtual   = parseFloat(valor_atual)
  let originalDebt = null

  if (categoria === 'debt_payoff' && linked_debt_type) {
    try {
      const { total, pago } = await calcDebtTotals(c.env.DB, user.id, linked_debt_type, linked_debt_id)
      if (total > 0) {
        valorObj   = total + pago
        valorAtual = pago
        originalDebt = valorObj
      } else if (valorObj > 0) {
        originalDebt = valorObj
      } else {
        return c.json({ error: 'Nenhuma dívida ativa encontrada. Informe o valor_objetivo manualmente.' }, 400)
      }
    } catch (err) {
      // Se falhou ao buscar dívidas mas temos valor_objetivo manual, continua
      if (valorObj <= 0) {
        return c.json({ error: 'Campo obrigatório: valor_objetivo' }, 400)
      }
      originalDebt = valorObj
    }
  } else if (!valor_objetivo) {
    return c.json({ error: 'Campo obrigatório: valor_objetivo' }, 400)
  }

  const result = await c.env.DB.prepare(
    `INSERT INTO metas (user_id, nome, descricao, valor_objetivo, valor_atual, data_meta,
     categoria, cor, icone, linked_debt_type, linked_debt_id, original_debt_amount)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    user.id, nome, descricao || null,
    valorObj, valorAtual, data_meta, categoria, cor, icone,
    linked_debt_type, linked_debt_id ? parseInt(linked_debt_id) : null, originalDebt
  ).run()

  // Conquistas por categoria/nome da meta
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

  return c.json({ success: true, id: result.meta.last_row_id, message: 'Meta criada!' }, 201)
})

// PUT /api/metas/:id
metas.put('/:id', requireAuth, async (c) => {
  const user = c.get('user')
  const id = c.req.param('id')
  const body = await c.req.json()

  const existing = await c.env.DB.prepare('SELECT id FROM metas WHERE id = ? AND user_id = ?').bind(id, user.id).first()
  if (!existing) return c.json({ error: 'Meta não encontrada' }, 404)

  const { nome, descricao, valor_objetivo, valor_atual, data_meta, categoria, cor, icone, status } = body

  await c.env.DB.prepare(
    'UPDATE metas SET nome = ?, descricao = ?, valor_objetivo = ?, valor_atual = ?, data_meta = ?, categoria = ?, cor = ?, icone = ?, status = ? WHERE id = ? AND user_id = ?'
  ).bind(nome, descricao || null, parseFloat(valor_objetivo), parseFloat(valor_atual), data_meta, categoria, cor, icone, status || 'ativa', id, user.id).run()

  return c.json({ success: true, message: 'Meta atualizada!' })
})

// PATCH /api/metas/:id/deposito
metas.patch('/:id/deposito', requireAuth, async (c) => {
  const user = c.get('user')
  const id = c.req.param('id')
  const { valor } = await c.req.json()

  const meta = await c.env.DB.prepare('SELECT * FROM metas WHERE id = ? AND user_id = ?').bind(id, user.id).first() as any
  if (!meta) return c.json({ error: 'Meta não encontrada' }, 404)

  const novoValor = meta.valor_atual + parseFloat(valor)
  const status = novoValor >= meta.valor_objetivo ? 'concluida' : 'ativa'

  await c.env.DB.prepare(
    'UPDATE metas SET valor_atual = ?, status = ? WHERE id = ? AND user_id = ?'
  ).bind(novoValor, status, id, user.id).run()

  return c.json({ 
    success: true, 
    novo_valor: novoValor,
    status,
    message: status === 'concluida' ? '🎉 Parabéns! Meta concluída!' : `R$ ${valor} adicionado à meta!`
  })
})

// DELETE /api/metas/:id
metas.delete('/:id', requireAuth, async (c) => {
  const user = c.get('user')
  const id = c.req.param('id')

  const existing = await c.env.DB.prepare('SELECT id FROM metas WHERE id = ? AND user_id = ?').bind(id, user.id).first()
  if (!existing) return c.json({ error: 'Meta não encontrada' }, 404)

  await c.env.DB.prepare('DELETE FROM metas WHERE id = ? AND user_id = ?').bind(id, user.id).run()
  return c.json({ success: true, message: 'Meta excluída!' })
})

// POST /api/metas/sincronizar-dividas — atualiza progresso das metas debt_payoff
metas.post('/sincronizar-dividas', requireAuth, async (c) => {
  const user = c.get('user')

  const metasDivida = await c.env.DB.prepare(
    `SELECT * FROM metas WHERE user_id = ? AND categoria = 'debt_payoff' AND status = 'ativa'`
  ).bind(user.id).all()

  let atualizadas = 0
  for (const meta of metasDivida.results as any[]) {
    const { total, pago } = await calcDebtTotals(
      c.env.DB, user.id, meta.linked_debt_type, meta.linked_debt_id
    )
    const originalDebt = Number(meta.original_debt_amount) || (total + pago)
    const valorAtual   = originalDebt - total  // quanto já foi quitado
    const concluida    = total === 0

    await c.env.DB.prepare(
      `UPDATE metas SET valor_atual = ?, status = ?, original_debt_amount = ?
       WHERE id = ? AND user_id = ?`
    ).bind(
      Math.max(0, valorAtual),
      concluida ? 'concluida' : 'ativa',
      originalDebt,
      meta.id, user.id
    ).run()

    if (concluida) {
      await verificarConquista(c.env.DB, user.id, 'sem_dividas')
    }
    atualizadas++
  }

  return c.json({ success: true, metas_atualizadas: atualizadas })
})

export default metas

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Calcula saldo devedor atual + valor já pago para metas de dívidas */
async function calcDebtTotals(
  db: D1Database, userId: number,
  debtType: string | null, debtId: number | null
): Promise<{ total: number; pago: number }> {
  if (!debtType) return { total: 0, pago: 0 }

  if (debtType === 'all') {
    const [f, e] = await Promise.all([
      db.prepare(
        `SELECT COALESCE(SUM(saldo_devedor),0) as saldo,
                COALESCE(SUM(valor_pago),0) as pago
         FROM financiamentos WHERE user_id = ? AND status = 'ativo'`
      ).bind(userId).first() as any,
      db.prepare(
        `SELECT COALESCE(SUM(saldo_devedor),0) as saldo,
                COALESCE(SUM(valor_pago),0) as pago
         FROM emprestimos WHERE user_id = ? AND status = 'ativo'`
      ).bind(userId).first() as any
    ])
    return {
      total: Number(f?.saldo || 0) + Number(e?.saldo || 0),
      pago:  Number(f?.pago  || 0) + Number(e?.pago  || 0)
    }
  }

  if (debtType === 'financiamento') {
    const r = await db.prepare(
      `SELECT COALESCE(SUM(saldo_devedor),0) as saldo, COALESCE(SUM(valor_pago),0) as pago
       FROM financiamentos WHERE user_id = ? AND status = 'ativo'`
    ).bind(userId).first() as any
    return { total: Number(r?.saldo || 0), pago: Number(r?.pago || 0) }
  }

  if (debtType === 'emprestimo') {
    const r = await db.prepare(
      `SELECT COALESCE(SUM(saldo_devedor),0) as saldo, COALESCE(SUM(valor_pago),0) as pago
       FROM emprestimos WHERE user_id = ? AND status = 'ativo'`
    ).bind(userId).first() as any
    return { total: Number(r?.saldo || 0), pago: Number(r?.pago || 0) }
  }

  if (debtType === 'especifico' && debtId) {
    // Busca em financiamentos primeiro, depois emprestimos
    let r = await db.prepare(
      'SELECT saldo_devedor as saldo, valor_pago as pago FROM financiamentos WHERE id = ? AND user_id = ?'
    ).bind(debtId, userId).first() as any
    if (!r) {
      r = await db.prepare(
        'SELECT saldo_devedor as saldo, valor_pago as pago FROM emprestimos WHERE id = ? AND user_id = ?'
      ).bind(debtId, userId).first() as any
    }
    return { total: Number(r?.saldo || 0), pago: Number(r?.pago || 0) }
  }

  return { total: 0, pago: 0 }
}

async function verificarConquista(db: D1Database, userId: number, codigo: string) {
  try {
    await db.prepare('INSERT OR IGNORE INTO conquistas_usuario (user_id, conquista_codigo, visualizado) VALUES (?, ?, 0)').bind(userId, codigo).run()
  } catch { }
}
