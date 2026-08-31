import { Hono } from 'hono'
import { sqlLimiteDisponivel } from '../lib/limite-cartao'
import { requireAuth } from './auth'

type Bindings = { DB: D1Database }
type Variables = { user: { id: number; nome: string; plano: string } }

const antecipacao = new Hono<{ Bindings: Bindings; Variables: Variables }>()

// ─── Helpers de validação (AN4/AN5/AN6/AN8/AN14 · RP2/RP4/RP5/RP6/RP7) ───────
const MAX_VALOR = 1_000_000_000
const TIPOS_ANTECIPACAO = ['conta', 'parcela', 'fatura', 'fatura_cartao', 'emprestimo', 'financiamento']
const STATUS_ANTECIPACAO = ['pendente', 'antecipada', 'cancelada']
const TIPOS_RECEBIMENTO = ['venda', 'servico', 'aluguel', 'emprestimo_a_receber', 'contrato', 'outros']
// id de rota: só inteiro positivo, senão null → 400 (nunca 500)
function parseId(v: any): number | null {
  const t = String(v ?? '')
  return /^\d+$/.test(t) && parseInt(t, 10) > 0 ? parseInt(t, 10) : null
}
// valor > 0 e finito; inválido → null
function parseValorPos(v: any): number | null {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 && n <= MAX_VALOR ? Math.round(n * 100) / 100 : null
}
// valor >= 0 e finito; '' / null / undefined → 0; inválido → null
function parseValorNaoNeg(v: any): number | null {
  if (v === '' || v === null || v === undefined) return 0
  const n = Number(v)
  return Number.isFinite(n) && n >= 0 && n <= MAX_VALOR ? Math.round(n * 100) / 100 : null
}
// data YYYY-MM-DD válida
function dataValida(s: any): boolean {
  if (!s) return false
  const str = String(s)
  if (!/^\d{4}-\d{2}-\d{2}/.test(str)) return false
  const d = new Date(str.slice(0, 10) + 'T12:00:00')
  return !Number.isNaN(d.getTime())
}

// Reverte os efeitos de uma antecipação confirmada (AN2): apaga a despesa
// "[Antecipado]" criada e restaura a original que havia sido cancelada.
// O marcador "#<id> " (com espaço/`]` após o id) evita colisão entre #1 e #10.
async function reverterAntecipacao(db: D1Database, userId: number, id: number) {
  // 1. remove a despesa [Antecipado] criada por esta antecipação
  await db.prepare(
    `DELETE FROM despesas WHERE user_id=? AND observacoes LIKE ?`
  ).bind(userId, `%[Antecipacao #${id} ]%`).run().catch(() => {})
  // 2. restaura as despesas originais que esta antecipação cancelou
  await db.prepare(
    `UPDATE despesas SET status='pendente' WHERE user_id=? AND status='cancelado' AND observacoes LIKE ?`
  ).bind(userId, `%antecipacao #${id}]%`).run().catch(() => {})
}

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

  if (!descricao || valor_total == null || valor_total === '' || !data_antecipacao) {
    return c.json({ error: 'Campos obrigatórios: descricao, valor_total, data_antecipacao' }, 400)
  }

  // AN4: valor precisa ser > 0 e finito (mata negativo e NaN)
  const valorTotal = parseValorPos(valor_total)
  if (valorTotal === null) return c.json({ error: 'Valor deve ser um número maior que zero.' }, 400)
  // AN5: tipo precisa ser válido (senão o CHECK do banco dá 500)
  if (!TIPOS_ANTECIPACAO.includes(tipo)) return c.json({ error: 'Tipo inválido.', tipos_validos: TIPOS_ANTECIPACAO }, 400)
  // AN6: status inválido é RECUSADO (não coagido silenciosamente para pendente)
  if (!STATUS_ANTECIPACAO.includes(status)) return c.json({ error: 'Status inválido.', status_validos: STATUS_ANTECIPACAO }, 400)
  // AN14: datas válidas
  if (!dataValida(data_antecipacao)) return c.json({ error: 'Data de antecipação inválida.' }, 400)
  if (data_vencimento_original && !dataValida(data_vencimento_original)) return c.json({ error: 'Data de vencimento original inválida.' }, 400)

  const dataVenc = data_vencimento_original || data_antecipacao
  // AN3/AN11: economia não vem crua do corpo — validada e capada ao valor antecipado
  const ecoRaw = economia_juros != null ? parseValorNaoNeg(economia_juros) : 0
  if (ecoRaw === null) return c.json({ error: 'Economia de juros inválida.' }, 400)
  const eco = Math.min(ecoRaw, valorTotal)
  const statusFinal = status

  // Determinar referência para cartão
  const refId   = referencia_id   || cartao_id   || null
  const refTipo = referencia_tipo || (cartao_id ? 'cartao' : null)

  // Para fatura_cartao: garantir mes_fatura/ano_fatura a partir do data_vencimento_original se não informado
  const mesFaturaFinal = mes_fatura || (tipo === 'fatura_cartao' && dataVenc ? parseInt(dataVenc.split('-')[1]) : null)
  const anoFaturaFinal = ano_fatura || (tipo === 'fatura_cartao' && dataVenc ? parseInt(dataVenc.split('-')[0]) : null)

  const res = await c.env.DB.prepare(
    `INSERT INTO antecipacoes (user_id, descricao, valor_total, data_vencimento_original, data_antecipacao, economia_juros, tipo, referencia_id, referencia_tipo, observacoes, status, mes_fatura, ano_fatura)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(user.id, descricao, valorTotal, dataVenc, data_antecipacao,
    eco, tipo, refId, refTipo, observacoes || null, statusFinal,
    mesFaturaFinal || null, anoFaturaFinal || null).run()

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
      `INSERT INTO despesas (user_id, descricao, valor, data, vencimento, categoria, status, purchase_group_id, observacoes)
       VALUES (?, ?, ?, ?, ?, ?, 'pago', NULL, ?)`
    ).bind(user.id, `[Antecipado] ${descricao}`, valorTotal, data_antecipacao, data_antecipacao, categ, `[Antecipacao #${antecipacaoId} ]`).run()
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
    // Usa mes_fatura/ano_fatura (enviados pelo frontend) como fonte primária;
    // fallback para o mês/ano derivado do data_vencimento_original
    const mesFaturaCancel = mes_fatura || mesFaturaFinal
    const anoFaturaCancel = ano_fatura || anoFaturaFinal
    // Aceitar cartao_id direto ou via refId (referencia_id)
    const cartaoIdCancel = cartao_id || (referencia_tipo === 'cartao' ? referencia_id : null) || (refTipo === 'cartao' ? refId : null)
    if (tipo === 'fatura_cartao' && cartaoIdCancel && mesFaturaCancel && anoFaturaCancel) {
      const mesPad = String(mesFaturaCancel).padStart(2,'0')
      const anoStr = String(anoFaturaCancel)

      // 3a. Cancelar despesas pendentes do cartão naquele mês (billing_month/billing_year ou vencimento)
      await c.env.DB.prepare(
        `UPDATE despesas SET status='cancelado',
            observacoes=COALESCE(observacoes||' ','') || '[Fatura antecipada - ver antecipacao #${antecipacaoId}]'
         WHERE user_id=? AND cartao_id=? AND status='pendente'
           AND (
             (billing_month=? AND billing_year=?)
             OR (billing_month IS NULL AND strftime('%m', vencimento)=? AND strftime('%Y', vencimento)=?)
           )`
      ).bind(user.id, cartaoIdCancel, parseInt(mesPad), parseInt(anoStr), mesPad, anoStr).run().catch(() => {})

      // 3b. Marcar card_charges do cartão naquele mês como pago
      // AN1 (SEGURANÇA): restringe ao cartão DO PRÓPRIO usuário — sem isto uma
      // conta conseguia quitar a fatura do cartão de outra pelo card_id do corpo
      await c.env.DB.prepare(
        `UPDATE card_charges SET status='pago'
         WHERE card_id=? AND status='pendente'
           AND card_id IN (SELECT id FROM cartoes WHERE user_id=?)
           AND strftime('%m', data_vencimento)=? AND strftime('%Y', data_vencimento)=?`
      ).bind(cartaoIdCancel, user.id, mesPad, anoStr).run().catch(() => {})
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
    `SELECT id, nome, bandeira, limite_total, dia_vencimento,
            ${sqlLimiteDisponivel('cartoes')} AS limite_disponivel
     FROM cartoes WHERE id=? AND user_id=?`
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

  // Calcular data de vencimento da fatura para o mês/ano selecionado
  const diaVenc = cartao.dia_vencimento || 10
  const anoNum  = parseInt(ano)
  const mesNum  = parseInt(mes)
  const maxDia  = new Date(anoNum, mesNum, 0).getDate() // último dia do mês
  const diaFinal = Math.min(diaVenc, maxDia)
  const dataVencFatura = `${anoNum}-${mesPad}-${String(diaFinal).padStart(2,'0')}`

  return c.json({
    cartao: { id: cartao.id, nome: cartao.nome, bandeira: cartao.bandeira, dia_vencimento: diaVenc },
    mes: mesNum, ano: anoNum,
    valor_fatura: Math.round(totalFatura * 100) / 100,
    qtd_lancamentos: Number(chargesRow?.qtd || faturaRow?.qtd || 0),
    data_vencimento_fatura: dataVencFatura
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
  const id = parseId(c.req.param('id')) // AN8
  if (id === null) return c.json({ error: 'ID inválido.' }, 400)
  const ant = await c.env.DB.prepare(
    `SELECT * FROM antecipacoes WHERE id=? AND user_id=?`
  ).bind(id, user.id).first() as any
  if (!ant) return c.json({ error: 'Não encontrada' }, 404)

  const body = await c.req.json()
  // AN10: uma antecipação já confirmada não pode ter valor/tipo/referência trocados
  // por baixo (os efeitos já foram aplicados) — só descrição/observações/datas.
  const travada = ant.status === 'antecipada'
  const descricao      = body.descricao      ?? ant.descricao
  const valorRaw       = (!travada && body.valor_total != null) ? parseValorPos(body.valor_total) : ant.valor_total
  if (valorRaw === null) return c.json({ error: 'Valor deve ser um número maior que zero.' }, 400)
  const valor_total    = valorRaw
  const ecoRaw         = body.economia_juros != null ? parseValorNaoNeg(body.economia_juros) : ant.economia_juros
  if (ecoRaw === null) return c.json({ error: 'Economia de juros inválida.' }, 400)
  const economia_juros = Math.min(ecoRaw, valor_total)
  const data_antecipacao          = body.data_antecipacao          ?? ant.data_antecipacao
  const data_vencimento_original  = body.data_vencimento_original  ?? ant.data_vencimento_original
  if (body.data_antecipacao && !dataValida(body.data_antecipacao)) return c.json({ error: 'Data de antecipação inválida.' }, 400)
  const tipoRaw     = (!travada && body.tipo != null) ? body.tipo : ant.tipo
  if (!TIPOS_ANTECIPACAO.includes(tipoRaw)) return c.json({ error: 'Tipo inválido.' }, 400)
  const tipo        = tipoRaw
  const status      = ant.status // status muda só via PATCH /:id/status (que reverte corretamente)
  const observacoes = body.observacoes !== undefined ? (body.observacoes || null) : ant.observacoes
  const referencia_id   = travada ? ant.referencia_id   : (body.referencia_id   !== undefined ? (body.referencia_id || null)   : ant.referencia_id)
  const referencia_tipo = travada ? ant.referencia_tipo : (body.referencia_tipo !== undefined ? (body.referencia_tipo || null) : ant.referencia_tipo)

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
  const id = parseId(c.req.param('id')) // AN8
  if (id === null) return c.json({ error: 'ID inválido.' }, 400)
  const { status } = await c.req.json()
  if (!STATUS_ANTECIPACAO.includes(status)) return c.json({ error: 'Status inválido' }, 400)

  const ant = await c.env.DB.prepare(
    `SELECT * FROM antecipacoes WHERE id=? AND user_id=?`
  ).bind(id, user.id).first() as any
  if (!ant) return c.json({ error: 'Antecipação não encontrada' }, 404)

  // AN2: cancelar uma antecipação confirmada REVERTE os efeitos
  if (status === 'cancelada' && ant.status === 'antecipada') {
    await reverterAntecipacao(c.env.DB, user.id, id)
  }

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
      `INSERT INTO despesas (user_id, descricao, valor, data, vencimento, categoria, status, observacoes)
       VALUES (?, ?, ?, ?, ?, ?, 'pago', ?)`
    ).bind(user.id, `[Antecipado] ${ant.descricao}`, ant.valor_total, dataRef, dataRef, categ, `[Antecipacao #${id} ]`).run()
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
      // Usar mes_fatura/ano_fatura armazenados como fonte primária (confiável)
      // Fallback: derivar do data_vencimento_original
      let mesPad: string
      let anoStr: string
      if (ant.mes_fatura && ant.ano_fatura) {
        mesPad = String(ant.mes_fatura).padStart(2,'0')
        anoStr = String(ant.ano_fatura)
      } else {
        const dataVenc = ant.data_vencimento_original || ant.data_antecipacao
        const dtParts  = dataVenc ? dataVenc.split('-') : []
        anoStr = dtParts[0] || String(new Date().getFullYear())
        mesPad = dtParts[1] || String(new Date().getMonth() + 1).padStart(2,'0')
      }
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
      // AN1 (SEGURANÇA): restringe ao cartão do próprio usuário
      await c.env.DB.prepare(
        `UPDATE card_charges SET status='pago'
         WHERE card_id=? AND status='pendente'
           AND card_id IN (SELECT id FROM cartoes WHERE user_id=?)
           AND strftime('%m', data_vencimento)=? AND strftime('%Y', data_vencimento)=?`
      ).bind(cartaoId, user.id, mesPad, anoStr).run().catch(() => {})
    }
  }

  return c.json({ success: true, despesa_criada_id: despesaId })
})

// ── DELETE /api/antecipacao/:id ───────────────────────────────────────────
antecipacao.delete('/:id', requireAuth, async (c) => {
  const user = c.get('user')
  const id = parseId(c.req.param('id')) // AN8
  if (id === null) return c.json({ error: 'ID inválido.' }, 400)

  // AN7: confere existência antes (não mente "success" para o que não existe)
  const ant = await c.env.DB.prepare(
    `SELECT id, status FROM antecipacoes WHERE id=? AND user_id=?`
  ).bind(id, user.id).first() as any
  if (!ant) return c.json({ error: 'Antecipação não encontrada' }, 404)

  // AN2: excluir uma antecipação confirmada também reverte os efeitos
  if (ant.status === 'antecipada') {
    await reverterAntecipacao(c.env.DB, user.id, id)
  }

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

  if (!descricao || valor_total == null || valor_total === '' || !numero_parcelas || !data_inicio) {
    return c.json({ error: 'Campos obrigatórios: descricao, valor_total, numero_parcelas, data_inicio' }, 400)
  }

  // RP5: valor_total > 0 e finito (mata NaN)
  const vTotal = parseValorPos(valor_total)
  if (vTotal === null) return c.json({ error: 'Valor total deve ser um número maior que zero.' }, 400)
  // RP4: numero_parcelas inteiro >= 1 (barra negativo e 0)
  const nParcelas = parseInt(numero_parcelas)
  if (!Number.isInteger(nParcelas) || nParcelas < 1 || nParcelas > 360)
    return c.json({ error: 'Número de parcelas deve ser um inteiro entre 1 e 360.' }, 400)
  // RP10: tipo e data válidos
  if (!TIPOS_RECEBIMENTO.includes(tipo)) return c.json({ error: 'Tipo inválido.', tipos_validos: TIPOS_RECEBIMENTO }, 400)
  if (!dataValida(data_inicio)) return c.json({ error: 'Data de início inválida.' }, 400)
  const vParcelaRaw = valor_parcela ? parseValorPos(valor_parcela) : Math.round((vTotal / nParcelas) * 100) / 100
  if (vParcelaRaw === null) return c.json({ error: 'Valor da parcela inválido.' }, 400)
  const vParcela = vParcelaRaw
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
  const id = parseId(c.req.param('id')) // RP7
  if (id === null) return c.json({ error: 'ID inválido.' }, 400)

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
  const parcelaId = parseId(c.req.param('id')) // RP7
  if (parcelaId === null) return c.json({ error: 'ID inválido.' }, 400)
  const { valor } = await c.req.json()
  // RP6: valor > 0 (não aceita negativo)
  const valorNovo = parseValorPos(valor)
  if (valorNovo === null) return c.json({ error: 'Valor deve ser maior que zero.' }, 400)

  const parcela = await c.env.DB.prepare(
    `SELECT p.id FROM recebimentos_parcelas p
     JOIN recebimentos_parcelados r ON r.id = p.recebimento_id
     WHERE p.id=? AND p.user_id=? AND p.status='pendente'`
  ).bind(parcelaId, user.id).first()
  if (!parcela) return c.json({ error: 'Parcela não encontrada ou já recebida' }, 404)

  await c.env.DB.prepare(
    `UPDATE recebimentos_parcelas SET valor=? WHERE id=? AND user_id=?`
  ).bind(valorNovo, parcelaId, user.id).run()

  return c.json({ success: true, message: 'Valor da parcela atualizado!' })
})

antecipacao.patch('/recebimentos/parcelas/:id/receber', requireAuth, async (c) => {
  const user = c.get('user')
  const parcelaId = parseId(c.req.param('id')) // RP7
  if (parcelaId === null) return c.json({ error: 'ID inválido.' }, 400)
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

  // RP1: idempotência — receber uma parcela já recebida NÃO cria segunda receita
  if (parcela.status === 'recebida')
    return c.json({ error: 'Esta parcela já foi recebida.' }, 400)

  const dataRec = data_recebimento || new Date().toISOString().split('T')[0]
  if (data_recebimento && !dataValida(data_recebimento)) return c.json({ error: 'Data de recebimento inválida.' }, 400)
  // RP2: valor_real, quando informado, precisa ser > 0 (não cria receita negativa)
  let valorEfetivo = Number(parcela.valor)
  if (valor_real !== undefined && valor_real !== null && valor_real !== '') {
    const vr = parseValorPos(valor_real)
    if (vr === null) return c.json({ error: 'Valor recebido deve ser maior que zero.' }, 400)
    valorEfetivo = vr
  }
  const diferenca = Math.round((valorEfetivo - parcela.valor) * 100) / 100

  // Criar receita automaticamente se solicitado
  let receitaId = null
  if (criar_receita) {
    const descReceita = diferenca !== 0
      ? `${parcela.rec_descricao} — Parcela ${parcela.numero_parcela} (reaj. ${diferenca > 0 ? '+' : ''}${diferenca.toFixed(2)})`
      : `${parcela.rec_descricao} — Parcela ${parcela.numero_parcela}`
    // RP8: grava o vínculo de volta (recebimento/parcela) na própria receita
    const res = await c.env.DB.prepare(
      `INSERT INTO receitas (user_id, descricao, valor, data, categoria, tipo, observacoes)
       VALUES (?, ?, ?, ?, 'Recebimento Parcelado', 'receita', ?)`
    ).bind(user.id, descReceita, valorEfetivo, dataRec, `[recebimento #${parcela.recebimento_id} parcela #${parcelaId} ]`).run()
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
  const id = parseId(c.req.param('id')) // RP7
  if (id === null) return c.json({ error: 'ID inválido.' }, 400)

  const rec = await c.env.DB.prepare(
    `SELECT id FROM recebimentos_parcelados WHERE id=? AND user_id=?`
  ).bind(id, user.id).first() as any
  if (!rec) return c.json({ error: 'Recebimento não encontrado' }, 404)

  // RP3: cascata de verdade — estorna as receitas geradas e remove as parcelas
  await c.env.DB.prepare(
    `DELETE FROM receitas WHERE user_id=? AND categoria='Recebimento Parcelado' AND observacoes LIKE ?`
  ).bind(user.id, `%[recebimento #${id} parcela%`).run().catch(() => {})
  await c.env.DB.prepare(
    `DELETE FROM recebimentos_parcelas WHERE recebimento_id=? AND user_id=?`
  ).bind(id, user.id).run().catch(() => {})
  await c.env.DB.prepare(`DELETE FROM recebimentos_parcelados WHERE id=? AND user_id=?`).bind(id, user.id).run()
  return c.json({ success: true })
})

export default antecipacao
