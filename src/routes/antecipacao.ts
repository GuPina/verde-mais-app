import { Hono } from 'hono'
import { requireAuth } from './auth'

type Bindings = { DB: D1Database }
type Variables = { user: { id: number; nome: string; plano: string } }

const antecipacao = new Hono<{ Bindings: Bindings; Variables: Variables }>()

// ── GET /api/antecipacao — listar antecipações ────────────────────────────
antecipacao.get('/', requireAuth, async (c) => {
  const user = c.get('user')
  const rows = await c.env.DB.prepare(
    `SELECT a.*, c.nome as cartao_nome, c.bandeira as cartao_bandeira
     FROM antecipacoes a
     LEFT JOIN cartoes c ON c.id = a.referencia_id AND a.referencia_tipo = 'cartao'
     WHERE a.user_id=? ORDER BY a.data_antecipacao DESC LIMIT 200`
  ).bind(user.id).all<any>()

  const items = rows.results || []
  const total_economizado = items
    .filter((a: any) => a.status === 'antecipada' && (a.economia_juros || 0) > 0)
    .reduce((s: number, a: any) => s + (a.economia_juros || 0), 0)
  const total_antecipado = items
    .filter((a: any) => a.status === 'antecipada')
    .reduce((s: number, a: any) => s + (a.valor_total || 0), 0)

  return c.json({
    antecipacoes: items,
    total_economizado: Math.round(total_economizado * 100) / 100,
    total_antecipado: Math.round(total_antecipado * 100) / 100
  })
})

// ── POST /api/antecipacao — criar antecipação ─────────────────────────────
// Lógica: ao confirmar status='antecipada', cria despesa no mês atual e
// cancela/remove a despesa original do mês futuro (referencia_id/tipo='despesa')
antecipacao.post('/', requireAuth, async (c) => {
  const user = c.get('user')
  const body = await c.req.json()
  const {
    descricao, valor_total, data_vencimento_original,
    data_antecipacao, economia_juros,
    tipo = 'conta', referencia_id, referencia_tipo, observacoes,
    status = 'pendente',
    // Para fatura de cartão
    cartao_id, mes_fatura, ano_fatura,
    // Para financiamento/empréstimo: parcela a antecipar
    parcela_ref
  } = body

  if (!descricao || !valor_total || !data_antecipacao) {
    return c.json({ error: 'Campos obrigatórios: descricao, valor_total, data_antecipacao' }, 400)
  }

  const dataVenc = data_vencimento_original || data_antecipacao
  const eco = economia_juros != null ? parseFloat(economia_juros) : 0
  const valorTotal = parseFloat(valor_total)
  const statusFinal = ['pendente','antecipada','cancelada'].includes(status) ? status : 'pendente'

  // Determinar referência para cartão
  const refId   = referencia_id   || cartao_id   || null
  const refTipo = referencia_tipo || (cartao_id ? 'cartao' : null)

  const res = await c.env.DB.prepare(
    `INSERT INTO antecipacoes (user_id, descricao, valor_total, data_vencimento_original, data_antecipacao, economia_juros, tipo, referencia_id, referencia_tipo, observacoes, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(user.id, descricao, valorTotal, dataVenc, data_antecipacao,
    eco, tipo, refId, refTipo, observacoes || null, statusFinal).run()

  const antecipacaoId = res.meta.last_row_id

  // ── LÓGICA CENTRAL: se status='antecipada', mover valor para o mês atual ──
  let despesaAntecipadaId: number | null = null
  if (statusFinal === 'antecipada') {
    // 1. Criar despesa no mês/dia da data_antecipacao
    const categ = tipo === 'fatura_cartao' ? 'Fatura Cartão'
                : tipo === 'financiamento'  ? 'Financiamento'
                : tipo === 'emprestimo'     ? 'Empréstimo'
                : tipo === 'parcela'        ? 'Parcelas'
                : 'Antecipação'

    const despRes = await c.env.DB.prepare(
      `INSERT INTO despesas (user_id, descricao, valor, data, vencimento, categoria, status, purchase_group_id)
       VALUES (?, ?, ?, ?, ?, ?, 'pago', NULL)`
    ).bind(user.id, `[Antecipado] ${descricao}`, valorTotal, data_antecipacao, data_antecipacao, categ).run()
    despesaAntecipadaId = despRes.meta.last_row_id

    // 2. Se havia despesa futura vinculada diretamente (referencia_tipo='despesa'), cancelá-la
    if (referencia_id && referencia_tipo === 'despesa') {
      await c.env.DB.prepare(
        `UPDATE despesas SET status='cancelado', observacoes=COALESCE(observacoes||' ','') || '[Antecipado - ver antecipacao #${antecipacaoId}]'
         WHERE id=? AND user_id=? AND status='pendente'`
      ).bind(referencia_id, user.id).run()
    }

    // 2b. Para empréstimo/financiamento sem referencia direta: cancelar despesa automática
    //     do mês original (gerada automaticamente pelo sistema de parcelas)
    if (!referencia_id && (tipo === 'emprestimo' || tipo === 'financiamento') && dataVenc) {
      const dtParts  = dataVenc.split('-')
      const anoStr   = dtParts[0] || ''
      const mesPad   = dtParts[1] || ''
      if (anoStr && mesPad) {
        const tipoLabel = tipo === 'emprestimo' ? 'Empréstimo' : 'Financiamento'
        await c.env.DB.prepare(
          `UPDATE despesas SET status='cancelado',
              observacoes=COALESCE(observacoes||' ','') || '[Antecipado - ver antecipacao #${antecipacaoId}]'
           WHERE user_id=? AND status='pendente'
             AND strftime('%m', COALESCE(vencimento, data)) = ?
             AND strftime('%Y', COALESCE(vencimento, data)) = ?
             AND ABS(valor - ?) < 0.02
             AND observacoes LIKE ?`
        ).bind(user.id, mesPad, anoStr, valorTotal, `%${tipoLabel} automático%`).run().catch(() => {})
      }
    }

    // 3. Se for fatura de cartão: cancelar despesas do cartão naquele mês E card_charges
    if (tipo === 'fatura_cartao' && cartao_id && mes_fatura && ano_fatura) {
      const mesPad = String(mes_fatura).padStart(2,'0')
      const anoStr = String(ano_fatura)

      // 3a. Cancelar despesas pendentes do cartão naquele mês (billing_month/billing_year ou vencimento)
      await c.env.DB.prepare(
        `UPDATE despesas SET status='cancelado',
            observacoes=COALESCE(observacoes||' ','') || '[Fatura antecipada - ver antecipacao #${antecipacaoId}]'
         WHERE user_id=? AND cartao_id=? AND status='pendente'
           AND (
             (billing_month=? AND billing_year=?)
             OR (billing_month IS NULL AND strftime('%m', vencimento)=? AND strftime('%Y', vencimento)=?)
           )`
      ).bind(user.id, cartao_id, parseInt(mesPad), parseInt(anoStr), mesPad, anoStr).run().catch(() => {})

      // 3b. Marcar card_charges do cartão naquele mês como pago
      await c.env.DB.prepare(
        `UPDATE card_charges SET status='pago'
         WHERE card_id=? AND status='pendente'
           AND strftime('%m', data_vencimento)=? AND strftime('%Y', data_vencimento)=?`
      ).bind(cartao_id, mesPad, anoStr).run().catch(() => {})
    }
  }

  // Conquistas
  const total = await c.env.DB.prepare(
    `SELECT COUNT(*) as cnt FROM antecipacoes WHERE user_id=?`
  ).bind(user.id).first() as any
  if ((total?.cnt || 0) >= 1)
    await c.env.DB.prepare('INSERT OR IGNORE INTO conquistas_usuario (user_id, conquista_codigo, visualizado) VALUES (?,?,0)').bind(user.id, 'primeira_antecipacao').run()
  if ((total?.cnt || 0) >= 3)
    await c.env.DB.prepare('INSERT OR IGNORE INTO conquistas_usuario (user_id, conquista_codigo, visualizado) VALUES (?,?,0)').bind(user.id, '3_antecipacoes').run()

  return c.json({
    success: true,
    id: antecipacaoId,
    despesa_criada_id: despesaAntecipadaId,
    message: statusFinal === 'antecipada'
      ? `Antecipação confirmada! Despesa de R$ ${valorTotal.toFixed(2)} lançada no mês atual.`
      : 'Antecipação registrada como pendente.'
  })
})

// ── GET /api/antecipacao/fatura-cartao — valor da fatura de um mês ──────────
// ATENÇÃO: deve vir ANTES de /:id para evitar conflito de rota
antecipacao.get('/fatura-cartao', requireAuth, async (c) => {
  const user = c.get('user')
  const cartaoId = c.req.query('cartao_id')
  const mes      = c.req.query('mes')
  const ano      = c.req.query('ano')
  if (!cartaoId || !mes || !ano) return c.json({ error: 'Parâmetros obrigatórios: cartao_id, mes, ano' }, 400)

  const mesPad = String(mes).padStart(2, '0')

  // Verificar propriedade do cartão
  const cartao = await c.env.DB.prepare(
    `SELECT id, nome, bandeira, limite_total, limite_disponivel FROM cartoes WHERE id=? AND user_id=?`
  ).bind(cartaoId, user.id).first() as any
  if (!cartao) return c.json({ error: 'Cartão não encontrado' }, 404)

  // Buscar total de despesas pendentes naquele mês (fatura)
  const faturaRow = await c.env.DB.prepare(
    `SELECT COALESCE(SUM(valor),0) as total, COUNT(*) as qtd
     FROM despesas
     WHERE cartao_id=? AND user_id=? AND status='pendente'
       AND strftime('%m', vencimento)=? AND strftime('%Y', vencimento)=?`
  ).bind(cartaoId, user.id, mesPad, String(ano)).first() as any

  // Buscar total via card_charges também
  const chargesRow = await c.env.DB.prepare(
    `SELECT COALESCE(SUM(cc.valor),0) as total, COUNT(*) as qtd
     FROM card_charges cc
     WHERE cc.card_id=? AND cc.status='pendente'
       AND strftime('%m', cc.data_vencimento)=? AND strftime('%Y', cc.data_vencimento)=?`
  ).bind(cartaoId, mesPad, String(ano)).first() as any

  const totalFatura = Math.max(Number(faturaRow?.total || 0), Number(chargesRow?.total || 0))

  return c.json({
    cartao: { id: cartao.id, nome: cartao.nome, bandeira: cartao.bandeira },
    mes: parseInt(mes), ano: parseInt(ano),
    valor_fatura: Math.round(totalFatura * 100) / 100,
    qtd_lancamentos: Number(chargesRow?.qtd || faturaRow?.qtd || 0)
  })
})

// ── GET /api/antecipacao/parcelas-disponiveis — parcelas de financ./empr. ────
// ATENÇÃO: deve vir ANTES de /:id para evitar conflito de rota
antecipacao.get('/parcelas-disponiveis', requireAuth, async (c) => {
  const user = c.get('user')
  const tipo = c.req.query('tipo') || 'financiamento' // financiamento | emprestimo
  const refId = c.req.query('ref_id')

  if (tipo === 'financiamento') {
    const where = refId ? 'AND f.id=?' : ''
    const params: any[] = refId ? [user.id, refId] : [user.id]
    const rows = await c.env.DB.prepare(
      `SELECT f.id, f.descricao, f.valor_parcela, f.saldo_devedor,
              f.parcelas_restantes, f.proximo_vencimento
       FROM financiamentos f
       WHERE f.user_id=? AND f.status='ativo' ${where}
       ORDER BY f.proximo_vencimento ASC LIMIT 20`
    ).bind(...params).all<any>()
    return c.json({ itens: rows.results || [] })
  } else {
    const where = refId ? 'AND e.id=?' : ''
    const params: any[] = refId ? [user.id, refId] : [user.id]
    const rows = await c.env.DB.prepare(
      `SELECT e.id, e.descricao, e.valor_parcela, e.saldo_devedor,
              e.parcelas_restantes, e.proximo_vencimento
       FROM emprestimos e
       WHERE e.user_id=? AND e.status='ativo' ${where}
       ORDER BY e.proximo_vencimento ASC LIMIT 20`
    ).bind(...params).all<any>()
    return c.json({ itens: rows.results || [] })
  }
})

// ── PUT /api/antecipacao/:id — editar antecipação ─────────────────────────
antecipacao.put('/:id', requireAuth, async (c) => {
  const user = c.get('user')
  const id = c.req.param('id')
  const ant = await c.env.DB.prepare(
    `SELECT * FROM antecipacoes WHERE id=? AND user_id=?`
  ).bind(id, user.id).first() as any
  if (!ant) return c.json({ error: 'Não encontrada' }, 404)

  const body = await c.req.json()
  const descricao      = body.descricao      ?? ant.descricao
  const valor_total    = body.valor_total    != null ? parseFloat(body.valor_total) : ant.valor_total
  const economia_juros = body.economia_juros != null ? parseFloat(body.economia_juros) : ant.economia_juros
  const data_antecipacao          = body.data_antecipacao          ?? ant.data_antecipacao
  const data_vencimento_original  = body.data_vencimento_original  ?? ant.data_vencimento_original
  const tipo        = body.tipo        ?? ant.tipo
  const status      = body.status      ?? ant.status
  const observacoes = body.observacoes !== undefined ? (body.observacoes || null) : ant.observacoes
  const referencia_id   = body.referencia_id   !== undefined ? (body.referencia_id || null)   : ant.referencia_id
  const referencia_tipo = body.referencia_tipo !== undefined ? (body.referencia_tipo || null) : ant.referencia_tipo

  await c.env.DB.prepare(
    `UPDATE antecipacoes
     SET descricao=?, valor_total=?, economia_juros=?, data_antecipacao=?,
         data_vencimento_original=?, tipo=?, status=?, observacoes=?,
         referencia_id=?, referencia_tipo=?
     WHERE id=? AND user_id=?`
  ).bind(descricao, valor_total, economia_juros, data_antecipacao,
    data_vencimento_original, tipo, status, observacoes,
    referencia_id, referencia_tipo, id, user.id).run()

  return c.json({ success: true, message: 'Antecipação atualizada!' })
})

// ── PATCH /api/antecipacao/:id/status ────────────────────────────────────
// Ao confirmar (status='antecipada'): cria despesa no mês atual e cancela original
antecipacao.patch('/:id/status', requireAuth, async (c) => {
  const user = c.get('user')
  const id = c.req.param('id')
  const { status } = await c.req.json()
  const validos = ['pendente', 'antecipada', 'cancelada']
  if (!validos.includes(status)) return c.json({ error: 'Status inválido' }, 400)

  const ant = await c.env.DB.prepare(
    `SELECT * FROM antecipacoes WHERE id=? AND user_id=?`
  ).bind(id, user.id).first() as any
  if (!ant) return c.json({ error: 'Antecipação não encontrada' }, 404)

  await c.env.DB.prepare(
    `UPDATE antecipacoes SET status=? WHERE id=? AND user_id=?`
  ).bind(status, id, user.id).run()

  let despesaId: number | null = null

  // Ao confirmar: criar despesa no mês atual (se ainda não criada)
  if (status === 'antecipada' && ant.status !== 'antecipada') {
    const dataRef = ant.data_antecipacao || new Date().toISOString().split('T')[0]
    const categ = ant.tipo === 'fatura_cartao' ? 'Fatura Cartão'
                : ant.tipo === 'financiamento'  ? 'Financiamento'
                : ant.tipo === 'emprestimo'     ? 'Empréstimo'
                : ant.tipo === 'parcela'        ? 'Parcelas'
                : 'Antecipação'

    const dr = await c.env.DB.prepare(
      `INSERT INTO despesas (user_id, descricao, valor, data, vencimento, categoria, status)
       VALUES (?, ?, ?, ?, ?, ?, 'pago')`
    ).bind(user.id, `[Antecipado] ${ant.descricao}`, ant.valor_total, dataRef, dataRef, categ).run()
    despesaId = dr.meta.last_row_id

    // Cancelar despesa original futura se referenciada diretamente
    if (ant.referencia_id && ant.referencia_tipo === 'despesa') {
      await c.env.DB.prepare(
        `UPDATE despesas SET status='cancelado',
            observacoes=COALESCE(observacoes||' ','') || '[Antecipado - ver antecipacao #${id}]'
         WHERE id=? AND user_id=? AND status='pendente'`
      ).bind(ant.referencia_id, user.id).run()
    }

    // Para empréstimo/financiamento sem referencia direta: cancelar despesa automática
    // do mês original (gerada automaticamente pelo sistema de parcelas)
    if (!ant.referencia_id && (ant.tipo === 'emprestimo' || ant.tipo === 'financiamento') && ant.data_vencimento_original) {
      const dataVencOrig = ant.data_vencimento_original
      const dtParts      = dataVencOrig.split('-')
      const anoStr       = dtParts[0] || ''
      const mesPad       = dtParts[1] || ''
      if (anoStr && mesPad) {
        const tipoLabel = ant.tipo === 'emprestimo' ? 'Empréstimo' : 'Financiamento'
        await c.env.DB.prepare(
          `UPDATE despesas SET status='cancelado',
              observacoes=COALESCE(observacoes||' ','') || '[Antecipado - ver antecipacao #${id}]'
           WHERE user_id=? AND status='pendente'
             AND strftime('%m', COALESCE(vencimento, data)) = ?
             AND strftime('%Y', COALESCE(vencimento, data)) = ?
             AND ABS(valor - ?) < 0.02
             AND observacoes LIKE ?`
        ).bind(user.id, mesPad, anoStr, ant.valor_total, `%${tipoLabel} automático%`).run().catch(() => {})
      }
    }

    // Se for fatura de cartão: cancelar despesas do cartão naquele mês E card_charges
    if (ant.tipo === 'fatura_cartao' && ant.referencia_id && ant.referencia_tipo === 'cartao') {
      // Extrair mês/ano do data_vencimento_original da antecipação
      const dataVenc = ant.data_vencimento_original || ant.data_antecipacao
      const dtParts  = dataVenc ? dataVenc.split('-') : []
      const anoStr   = dtParts[0] || String(new Date().getFullYear())
      const mesPad   = dtParts[1] || String(new Date().getMonth() + 1).padStart(2,'0')
      const cartaoId = ant.referencia_id

      // Cancelar despesas pendentes do cartão naquele mês
      await c.env.DB.prepare(
        `UPDATE despesas SET status='cancelado',
            observacoes=COALESCE(observacoes||' ','') || '[Fatura antecipada - ver antecipacao #${id}]'
         WHERE user_id=? AND cartao_id=? AND status='pendente'
           AND (
             (billing_month=? AND billing_year=?)
             OR (billing_month IS NULL AND strftime('%m', vencimento)=? AND strftime('%Y', vencimento)=?)
           )`
      ).bind(user.id, cartaoId, parseInt(mesPad), parseInt(anoStr), mesPad, anoStr).run().catch(() => {})

      // Marcar card_charges do cartão naquele mês como pago
      await c.env.DB.prepare(
        `UPDATE card_charges SET status='pago'
         WHERE card_id=? AND status='pendente'
           AND strftime('%m', data_vencimento)=? AND strftime('%Y', data_vencimento)=?`
      ).bind(cartaoId, mesPad, anoStr).run().catch(() => {})
    }
  }

  return c.json({ success: true, despesa_criada_id: despesaId })
})

// ── DELETE /api/antecipacao/:id ───────────────────────────────────────────
antecipacao.delete('/:id', requireAuth, async (c) => {
  const user = c.get('user')
  const id = c.req.param('id')
  await c.env.DB.prepare(`DELETE FROM antecipacoes WHERE id=? AND user_id=?`).bind(id, user.id).run()
  return c.json({ success: true })
})

// ── GET /api/antecipacao/sugestoes — contas próximas de vencer ────────────
antecipacao.get('/sugestoes', requireAuth, async (c) => {
  const user = c.get('user')
  // Buscar despesas pendentes nos próximos 60 dias que ainda não foram antecipadas
  const rows = await c.env.DB.prepare(
    `SELECT d.id, d.descricao, d.valor, d.vencimento, d.categoria,
            d.cartao_id, c.nome as cartao_nome
     FROM despesas d
     LEFT JOIN cartoes c ON c.id = d.cartao_id
     WHERE d.user_id=? AND d.status='pendente'
       AND d.vencimento IS NOT NULL
       AND d.vencimento BETWEEN date('now') AND date('now', '+60 days')
       AND d.id NOT IN (SELECT referencia_id FROM antecipacoes WHERE user_id=? AND referencia_tipo='despesa' AND status != 'cancelada')
     ORDER BY d.vencimento ASC
     LIMIT 20`
  ).bind(user.id, user.id).all<any>()

  // Calcular economia estimada (1% do valor por mês antecipado como estimativa)
  const hoje = new Date()
  const sugestoes = (rows.results || []).map((d: any) => {
    const venc = new Date(d.vencimento + 'T12:00:00')
    const diasAntecipados = Math.max(1, Math.floor((venc.getTime() - hoje.getTime()) / 86400000))
    const economia_estimada = Math.round(d.valor * 0.01 * (diasAntecipados / 30) * 100) / 100
    return { ...d, dias_ate_vencimento: diasAntecipados, economia_estimada }
  })

  return c.json({ sugestoes })
})

// ── GET /api/recebimentos — listar recebimentos parcelados ────────────────
antecipacao.get('/recebimentos', requireAuth, async (c) => {
  const user = c.get('user')
  const rows = await c.env.DB.prepare(
    `SELECT r.*,
            COUNT(p.id) as total_parcelas_count,
            SUM(CASE WHEN p.status='recebida' THEN 1 ELSE 0 END) as parcelas_recebidas,
            SUM(CASE WHEN p.status='recebida' THEN p.valor ELSE 0 END) as total_recebido
     FROM recebimentos_parcelados r
     LEFT JOIN recebimentos_parcelas p ON p.recebimento_id = r.id
     WHERE r.user_id=?
     GROUP BY r.id
     ORDER BY r.created_at DESC`
  ).bind(user.id).all<any>()

  return c.json({ recebimentos: rows.results || [] })
})

// ── POST /api/recebimentos — criar recebimento parcelado ──────────────────
antecipacao.post('/recebimentos', requireAuth, async (c) => {
  const user = c.get('user')
  const body = await c.req.json()
  const { descricao, valor_total, numero_parcelas, valor_parcela,
    data_inicio, tipo = 'venda', pagador, observacoes } = body

  if (!descricao || !valor_total || !numero_parcelas || !data_inicio) {
    return c.json({ error: 'Campos obrigatórios: descricao, valor_total, numero_parcelas, data_inicio' }, 400)
  }

  const nParcelas = parseInt(numero_parcelas)
  const vTotal = parseFloat(valor_total)
  const vParcela = valor_parcela ? parseFloat(valor_parcela) : Math.round((vTotal / nParcelas) * 100) / 100
  const dataInicio = new Date(data_inicio + 'T12:00:00')
  const dataFim = new Date(dataInicio)
  dataFim.setMonth(dataFim.getMonth() + nParcelas - 1)

  const res = await c.env.DB.prepare(
    `INSERT INTO recebimentos_parcelados (user_id, descricao, valor_total, numero_parcelas, valor_parcela, data_inicio, data_fim, tipo, pagador, observacoes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(user.id, descricao, vTotal, nParcelas, vParcela,
    data_inicio, dataFim.toISOString().split('T')[0], tipo, pagador || null, observacoes || null).run()

  const recId = res.meta.last_row_id

  // Criar parcelas automaticamente (mensalmente)
  const batch = []
  for (let i = 0; i < nParcelas; i++) {
    const dataParcela = new Date(dataInicio)
    dataParcela.setMonth(dataParcela.getMonth() + i)
    batch.push(c.env.DB.prepare(
      `INSERT INTO recebimentos_parcelas (recebimento_id, user_id, numero_parcela, valor, data_prevista)
       VALUES (?, ?, ?, ?, ?)`
    ).bind(recId, user.id, i + 1, vParcela, dataParcela.toISOString().split('T')[0]))
  }
  if (batch.length > 0) await c.env.DB.batch(batch)

  // Conquista
  await c.env.DB.prepare('INSERT OR IGNORE INTO conquistas_usuario (user_id, conquista_codigo, visualizado) VALUES (?,?,0)').bind(user.id, 'primeiro_recebimento_parcelado').run()

  return c.json({ success: true, id: recId, parcelas_criadas: nParcelas, message: `Recebimento criado com ${nParcelas} parcela(s)!` })
})

// ── GET /api/recebimentos/:id/parcelas ────────────────────────────────────
antecipacao.get('/recebimentos/:id/parcelas', requireAuth, async (c) => {
  const user = c.get('user')
  const id = c.req.param('id')

  const rec = await c.env.DB.prepare(
    `SELECT * FROM recebimentos_parcelados WHERE id=? AND user_id=?`
  ).bind(id, user.id).first() as any
  if (!rec) return c.json({ error: 'Recebimento não encontrado' }, 404)

  const parcelas = await c.env.DB.prepare(
    `SELECT * FROM recebimentos_parcelas WHERE recebimento_id=? ORDER BY numero_parcela ASC`
  ).bind(id).all<any>()

  return c.json({ recebimento: rec, parcelas: parcelas.results || [] })
})

// ── PATCH /api/recebimentos/parcelas/:id/receber ─────────────────────────
// ── PATCH /api/recebimentos/parcelas/:id/valor — ajustar valor previsto ─────
antecipacao.patch('/recebimentos/parcelas/:id/valor', requireAuth, async (c) => {
  const user = c.get('user')
  const parcelaId = c.req.param('id')
  const { valor } = await c.req.json()
  if (!valor || isNaN(parseFloat(valor))) return c.json({ error: 'Valor inválido' }, 400)

  const parcela = await c.env.DB.prepare(
    `SELECT p.id FROM recebimentos_parcelas p
     JOIN recebimentos_parcelados r ON r.id = p.recebimento_id
     WHERE p.id=? AND p.user_id=? AND p.status='pendente'`
  ).bind(parcelaId, user.id).first()
  if (!parcela) return c.json({ error: 'Parcela não encontrada ou já recebida' }, 404)

  await c.env.DB.prepare(
    `UPDATE recebimentos_parcelas SET valor=? WHERE id=? AND user_id=?`
  ).bind(parseFloat(valor), parcelaId, user.id).run()

  return c.json({ success: true, message: 'Valor da parcela atualizado!' })
})

antecipacao.patch('/recebimentos/parcelas/:id/receber', requireAuth, async (c) => {
  const user = c.get('user')
  const parcelaId = c.req.param('id')
  const body = await c.req.json()
  // valor_real: permite informar o valor efetivamente recebido (reajuste INCC, etc)
  const { data_recebimento, criar_receita = true, valor_real, observacoes } = body

  const parcela = await c.env.DB.prepare(
    `SELECT p.*, r.descricao as rec_descricao, r.tipo as rec_tipo
     FROM recebimentos_parcelas p
     JOIN recebimentos_parcelados r ON r.id = p.recebimento_id
     WHERE p.id=? AND p.user_id=?`
  ).bind(parcelaId, user.id).first() as any
  if (!parcela) return c.json({ error: 'Parcela não encontrada' }, 404)

  const dataRec = data_recebimento || new Date().toISOString().split('T')[0]
  // Usa valor_real se informado (reajuste por INCC/índice), senão usa valor original da parcela
  const valorEfetivo = valor_real ? parseFloat(valor_real) : parcela.valor
  const diferenca = Math.round((valorEfetivo - parcela.valor) * 100) / 100

  // Criar receita automaticamente se solicitado
  let receitaId = null
  if (criar_receita) {
    const descReceita = diferenca !== 0
      ? `${parcela.rec_descricao} — Parcela ${parcela.numero_parcela} (reaj. ${diferenca > 0 ? '+' : ''}${diferenca.toFixed(2)})`
      : `${parcela.rec_descricao} — Parcela ${parcela.numero_parcela}`
    const res = await c.env.DB.prepare(
      `INSERT INTO receitas (user_id, descricao, valor, data, categoria, tipo)
       VALUES (?, ?, ?, ?, 'Recebimento Parcelado', 'receita')`
    ).bind(user.id, descReceita, valorEfetivo, dataRec).run()
    receitaId = res.meta.last_row_id
  }

  // Atualiza a parcela com o valor real recebido
  await c.env.DB.prepare(
    `UPDATE recebimentos_parcelas
     SET status='recebida', data_recebimento=?, receita_id=?, valor=?, observacoes=?
     WHERE id=? AND user_id=?`
  ).bind(dataRec, receitaId, valorEfetivo, observacoes || parcela.observacoes || null, parcelaId, user.id).run()

  // Verificar se todas as parcelas foram recebidas
  const pendentes = await c.env.DB.prepare(
    `SELECT COUNT(*) as cnt FROM recebimentos_parcelas
     WHERE recebimento_id=? AND status NOT IN ('recebida','cancelada')`
  ).bind(parcela.recebimento_id).first() as any

  if ((pendentes?.cnt || 0) === 0) {
    await c.env.DB.prepare(
      `UPDATE recebimentos_parcelados SET status='concluido' WHERE id=?`
    ).bind(parcela.recebimento_id).run()
    await c.env.DB.prepare('INSERT OR IGNORE INTO conquistas_usuario (user_id, conquista_codigo, visualizado) VALUES (?,?,0)').bind(user.id, 'recebimento_concluido').run()
  }

  return c.json({ success: true, receita_id: receitaId, message: `Parcela ${parcela.numero_parcela} marcada como recebida!` })
})

// ── DELETE /api/recebimentos/:id ──────────────────────────────────────────
antecipacao.delete('/recebimentos/:id', requireAuth, async (c) => {
  const user = c.get('user')
  const id = c.req.param('id')
  await c.env.DB.prepare(`DELETE FROM recebimentos_parcelados WHERE id=? AND user_id=?`).bind(id, user.id).run()
  return c.json({ success: true })
})

export default antecipacao
