import { Hono } from 'hono'
import { requireAuth } from './auth'

type Bindings  = { DB: D1Database }
type Variables = { user: { id: number; nome: string; plano: string } }

const bens = new Hono<{ Bindings: Bindings; Variables: Variables }>()

const TIPOS = ['imovel', 'veiculo', 'equipamento', 'joia', 'colecao', 'outros']
const LIQUIDEZ = ['alta', 'media', 'baixa']
const MAX_VALOR = 1_000_000_000

const r2 = (v: any) => Math.round((Number(v) || 0) * 100) / 100

function parseId(v: string | undefined): number | null {
  return v && /^\d+$/.test(v) ? parseInt(v, 10) : null
}
function parseValor(v: unknown, obrigatorio = true): number | null {
  if (v === undefined || v === null || v === '') return obrigatorio ? null : 0
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(',', '.'))
  if (!Number.isFinite(n) || n < 0 || n > MAX_VALOR) return null
  return r2(n)
}

// ─── GET /api/bens ───────────────────────────────────────────────────────────
// Lista os bens e o consolidado do patrimônio: financeiro (investimentos +
// reservas), material (bens) e as dívidas — que é o que a tela precisa para
// mostrar líquido x ilíquido sem refazer conta no front.
bens.get('/', requireAuth, async (c) => {
  const user = c.get('user')

  const [lista, inv, resEsp, resLeg, fin, emp] = await Promise.all([
    c.env.DB.prepare(
      `SELECT b.*, f.descricao as financiamento_descricao, f.saldo_devedor as financiamento_saldo
       FROM bens_patrimoniais b
       LEFT JOIN financiamentos f ON f.id = b.financiamento_id AND f.user_id = b.user_id
       WHERE b.user_id = ? AND b.ativo = 1
       ORDER BY b.valor_atual DESC`
    ).bind(user.id).all<any>(),
    c.env.DB.prepare(
      `SELECT COALESCE(SUM(valor_atual),0) as atual, COALESCE(SUM(valor_investido),0) as investido
       FROM investimentos WHERE user_id = ?`
    ).bind(user.id).first<any>(),
    c.env.DB.prepare(
      `SELECT COALESCE(SUM(current_amount),0) as total FROM specialized_reserves
       WHERE user_id = ? AND status IN ('active','completed')`
    ).bind(user.id).first<any>(),
    c.env.DB.prepare(
      `SELECT COALESCE(valor_atual,0) as total FROM reserva_emergencia
       WHERE user_id = ? ORDER BY id DESC LIMIT 1`
    ).bind(user.id).first<any>(),
    c.env.DB.prepare(
      `SELECT COALESCE(SUM(saldo_devedor),0) as total FROM financiamentos
       WHERE user_id = ? AND status = 'ativo'`
    ).bind(user.id).first<any>(),
    c.env.DB.prepare(
      `SELECT COALESCE(SUM(saldo_devedor),0) as total FROM emprestimos
       WHERE user_id = ? AND status = 'ativo'`
    ).bind(user.id).first<any>(),
  ])

  const itens = (lista.results || []).map((b: any) => {
    const aq = r2(b.valor_aquisicao), at = r2(b.valor_atual)
    const saldo = r2(b.financiamento_saldo)
    return {
      id: b.id,
      nome: b.nome,
      tipo: b.tipo,
      valor_aquisicao: aq,
      valor_atual: at,
      // Quanto o bem ganhou ou perdeu desde a compra — o número que justifica
      // guardar aquisição e atual em colunas separadas.
      variacao_valor: r2(at - aq),
      variacao_pct: aq > 0 ? Math.round(((at - aq) / aq) * 1000) / 10 : null,
      variacao_anual: Number(b.variacao_anual) || 0,
      data_aquisicao: b.data_aquisicao || null,
      liquidez: b.liquidez,
      observacoes: b.observacoes || null,
      financiamento_id: b.financiamento_id || null,
      financiamento_descricao: b.financiamento_descricao || null,
      financiamento_saldo: saldo,
      // Parte do bem que já é sua de fato.
      patrimonio_liquido_bem: r2(at - saldo),
    }
  })

  const totalBens       = r2(itens.reduce((s, b) => s + b.valor_atual, 0))
  const totalAquisicao  = r2(itens.reduce((s, b) => s + b.valor_aquisicao, 0))
  const investimentos   = r2(inv?.atual)
  const reservas        = r2(Number(resEsp?.total || 0) + Number(resLeg?.total || 0))
  const dividas         = r2(Number(fin?.total || 0) + Number(emp?.total || 0))
  const financeiro      = r2(investimentos + reservas)
  const bruto           = r2(financeiro + totalBens)

  return c.json({
    bens: itens,
    resumo: {
      total_bens: totalBens,
      total_aquisicao: totalAquisicao,
      valorizacao: r2(totalBens - totalAquisicao),
      count: itens.length,
      investimentos,
      investido: r2(inv?.investido),
      reservas,
      financeiro,
      dividas,
      patrimonio_bruto: bruto,
      patrimonio_liquido: r2(bruto - dividas),
      // Quanto do patrimônio vira dinheiro rápido, se precisar.
      liquido_rapido: r2(financeiro + itens.filter(b => b.liquidez === 'alta').reduce((s, b) => s + b.valor_atual, 0)),
      pct_material: bruto > 0 ? Math.round((totalBens / bruto) * 100) : 0,
      pct_financeiro: bruto > 0 ? Math.round((financeiro / bruto) * 100) : 0,
    },
    por_tipo: Object.entries(
      itens.reduce((acc: Record<string, number>, b) => {
        acc[b.tipo] = (acc[b.tipo] || 0) + b.valor_atual
        return acc
      }, {})
    ).map(([tipo, total]) => ({ tipo, total: r2(total) })).sort((a, b) => b.total - a.total),
  })
})

// ─── POST /api/bens ──────────────────────────────────────────────────────────
bens.post('/', requireAuth, async (c) => {
  const user = c.get('user')
  const body = await c.req.json().catch(() => ({}))
  const nome = String(body.nome || '').trim()
  if (!nome) return c.json({ error: 'Informe o nome do bem.' }, 400)
  if (nome.length > 120) return c.json({ error: 'Nome deve ter até 120 caracteres.' }, 400)

  const tipo = TIPOS.includes(body.tipo) ? body.tipo : 'outros'
  const liquidez = LIQUIDEZ.includes(body.liquidez) ? body.liquidez : 'baixa'

  const aq = parseValor(body.valor_aquisicao)
  if (aq === null) return c.json({ error: 'Valor de aquisição inválido.' }, 400)
  // Sem valor atual informado, assume o de aquisição — melhor do que zerar o bem.
  const at = body.valor_atual === undefined || body.valor_atual === null || body.valor_atual === ''
    ? aq : parseValor(body.valor_atual)
  if (at === null) return c.json({ error: 'Valor atual inválido.' }, 400)

  let finId: number | null = null
  if (body.financiamento_id !== undefined && body.financiamento_id !== null && body.financiamento_id !== '') {
    finId = parseId(String(body.financiamento_id))
    if (!finId) return c.json({ error: 'Financiamento inválido.' }, 400)
    const ok = await c.env.DB.prepare('SELECT id FROM financiamentos WHERE id = ? AND user_id = ?')
      .bind(finId, user.id).first()
    if (!ok) return c.json({ error: 'Financiamento não encontrado.' }, 404)
  }

  const varAnual = Number(body.variacao_anual)
  const res = await c.env.DB.prepare(
    `INSERT INTO bens_patrimoniais
       (user_id, nome, tipo, valor_aquisicao, valor_atual, data_aquisicao, variacao_anual,
        financiamento_id, liquidez, observacoes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    user.id, nome, tipo, aq, at,
    body.data_aquisicao || null,
    Number.isFinite(varAnual) ? varAnual : 0,
    finId, liquidez,
    body.observacoes ? String(body.observacoes).slice(0, 500) : null
  ).run()

  return c.json({ success: true, id: res.meta.last_row_id, message: 'Bem adicionado ao patrimônio!' }, 201)
})

// ─── PUT /api/bens/:id ───────────────────────────────────────────────────────
bens.put('/:id', requireAuth, async (c) => {
  const user = c.get('user')
  const id = parseId(c.req.param('id'))
  if (!id) return c.json({ error: 'ID inválido.' }, 400)

  const atual = await c.env.DB.prepare('SELECT id FROM bens_patrimoniais WHERE id = ? AND user_id = ?')
    .bind(id, user.id).first()
  if (!atual) return c.json({ error: 'Bem não encontrado.' }, 404)

  const body = await c.req.json().catch(() => ({}))
  const sets: string[] = []
  const vals: any[] = []

  if (body.nome !== undefined) {
    const nome = String(body.nome).trim()
    if (!nome) return c.json({ error: 'Informe o nome do bem.' }, 400)
    sets.push('nome = ?'); vals.push(nome.slice(0, 120))
  }
  if (body.tipo !== undefined) {
    if (!TIPOS.includes(body.tipo)) return c.json({ error: 'Tipo inválido.' }, 400)
    sets.push('tipo = ?'); vals.push(body.tipo)
  }
  if (body.liquidez !== undefined) {
    if (!LIQUIDEZ.includes(body.liquidez)) return c.json({ error: 'Liquidez inválida.' }, 400)
    sets.push('liquidez = ?'); vals.push(body.liquidez)
  }
  for (const [campo, chave] of [['valor_aquisicao', 'valor_aquisicao'], ['valor_atual', 'valor_atual']] as const) {
    if (body[chave] !== undefined) {
      const v = parseValor(body[chave])
      if (v === null) return c.json({ error: `Valor inválido em ${campo}.` }, 400)
      sets.push(`${campo} = ?`); vals.push(v)
    }
  }
  if (body.data_aquisicao !== undefined) { sets.push('data_aquisicao = ?'); vals.push(body.data_aquisicao || null) }
  if (body.variacao_anual !== undefined) {
    const v = Number(body.variacao_anual)
    sets.push('variacao_anual = ?'); vals.push(Number.isFinite(v) ? v : 0)
  }
  if (body.observacoes !== undefined) { sets.push('observacoes = ?'); vals.push(body.observacoes ? String(body.observacoes).slice(0, 500) : null) }
  if (body.financiamento_id !== undefined) {
    if (body.financiamento_id === null || body.financiamento_id === '') {
      sets.push('financiamento_id = ?'); vals.push(null)
    } else {
      const finId = parseId(String(body.financiamento_id))
      if (!finId) return c.json({ error: 'Financiamento inválido.' }, 400)
      const ok = await c.env.DB.prepare('SELECT id FROM financiamentos WHERE id = ? AND user_id = ?')
        .bind(finId, user.id).first()
      if (!ok) return c.json({ error: 'Financiamento não encontrado.' }, 404)
      sets.push('financiamento_id = ?'); vals.push(finId)
    }
  }

  if (!sets.length) return c.json({ error: 'Nenhum campo para atualizar.' }, 400)
  sets.push("data_atualizacao = to_char((now() AT TIME ZONE 'UTC'),'YYYY-MM-DD HH24:MI:SS')")
  vals.push(id, user.id)

  await c.env.DB.prepare(
    `UPDATE bens_patrimoniais SET ${sets.join(', ')} WHERE id = ? AND user_id = ?`
  ).bind(...vals).run()

  return c.json({ success: true, message: 'Bem atualizado!' })
})

// ─── DELETE /api/bens/:id ────────────────────────────────────────────────────
// Baixa lógica: o histórico de patrimônio não deve mudar retroativamente só
// porque o usuário vendeu o carro hoje.
bens.delete('/:id', requireAuth, async (c) => {
  const user = c.get('user')
  const id = parseId(c.req.param('id'))
  if (!id) return c.json({ error: 'ID inválido.' }, 400)
  const ex = await c.env.DB.prepare('SELECT id FROM bens_patrimoniais WHERE id = ? AND user_id = ? AND ativo = 1')
    .bind(id, user.id).first()
  if (!ex) return c.json({ error: 'Bem não encontrado.' }, 404)
  await c.env.DB.prepare('UPDATE bens_patrimoniais SET ativo = 0 WHERE id = ? AND user_id = ?')
    .bind(id, user.id).run()
  return c.json({ success: true, message: 'Bem removido do patrimônio.' })
})

export default bens
