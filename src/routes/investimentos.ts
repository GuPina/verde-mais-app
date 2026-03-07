import { Hono } from 'hono'
import { requireAuth } from './auth'

type Bindings = { DB: D1Database }
type Variables = { user: { id: number; nome: string; email: string; plano: string } }

const investimentos = new Hono<{ Bindings: Bindings; Variables: Variables }>()

// GET /api/investimentos
investimentos.get('/', requireAuth, async (c) => {
  const user = c.get('user')
  const result = await c.env.DB.prepare(
    'SELECT * FROM investimentos WHERE user_id = ? ORDER BY valor_atual DESC'
  ).bind(user.id).all()

  const total_investido = (result.results as any[]).reduce((sum, i) => sum + i.valor_investido, 0)
  const total_atual = (result.results as any[]).reduce((sum, i) => sum + (i.valor_atual || i.valor_investido), 0)
  const rentabilidade_total = total_investido > 0 ? ((total_atual - total_investido) / total_investido) * 100 : 0

  return c.json({ 
    investimentos: result.results,
    resumo: {
      total_investido,
      total_atual,
      rentabilidade_total: Math.round(rentabilidade_total * 100) / 100,
      lucro_prejuizo: total_atual - total_investido
    }
  })
})

// POST /api/investimentos
investimentos.post('/', requireAuth, async (c) => {
  const user = c.get('user')
  const body = await c.req.json()
  const { nome, tipo, valor_investido, rentabilidade_percentual = 0, risco = 'baixo', data_inicio, data_vencimento, instituicao, observacoes } = body

  if (!nome || !tipo || !valor_investido || !data_inicio) {
    return c.json({ error: 'Campos obrigatórios: nome, tipo, valor_investido, data_inicio' }, 400)
  }

  const valor_atual = parseFloat(valor_investido) * (1 + parseFloat(rentabilidade_percentual) / 100)

  const result = await c.env.DB.prepare(
    'INSERT INTO investimentos (user_id, nome, tipo, valor_investido, rentabilidade_percentual, valor_atual, risco, data_inicio, data_vencimento, instituicao, observacoes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(user.id, nome, tipo, parseFloat(valor_investido), parseFloat(rentabilidade_percentual), valor_atual, risco, data_inicio, data_vencimento || null, instituicao || null, observacoes || null).run()

  return c.json({ success: true, id: result.meta.last_row_id, message: 'Investimento adicionado!' }, 201)
})

// PUT /api/investimentos/:id
investimentos.put('/:id', requireAuth, async (c) => {
  const user = c.get('user')
  const id = c.req.param('id')
  const body = await c.req.json()

  const existing = await c.env.DB.prepare('SELECT id FROM investimentos WHERE id = ? AND user_id = ?').bind(id, user.id).first()
  if (!existing) return c.json({ error: 'Investimento não encontrado' }, 404)

  const { nome, tipo, valor_investido, rentabilidade_percentual, valor_atual, risco, data_inicio, data_vencimento, instituicao, observacoes } = body

  await c.env.DB.prepare(
    'UPDATE investimentos SET nome = ?, tipo = ?, valor_investido = ?, rentabilidade_percentual = ?, valor_atual = ?, risco = ?, data_inicio = ?, data_vencimento = ?, instituicao = ?, observacoes = ? WHERE id = ? AND user_id = ?'
  ).bind(nome, tipo, parseFloat(valor_investido), parseFloat(rentabilidade_percentual || 0), parseFloat(valor_atual || valor_investido), risco, data_inicio, data_vencimento || null, instituicao || null, observacoes || null, id, user.id).run()

  return c.json({ success: true, message: 'Investimento atualizado!' })
})

// DELETE /api/investimentos/:id
investimentos.delete('/:id', requireAuth, async (c) => {
  const user = c.get('user')
  const id = c.req.param('id')

  const existing = await c.env.DB.prepare('SELECT id FROM investimentos WHERE id = ? AND user_id = ?').bind(id, user.id).first()
  if (!existing) return c.json({ error: 'Investimento não encontrado' }, 404)

  await c.env.DB.prepare('DELETE FROM investimentos WHERE id = ? AND user_id = ?').bind(id, user.id).run()
  return c.json({ success: true, message: 'Investimento excluído!' })
})

// GET /api/investimentos/simulacao
investimentos.get('/simulacao', async (c) => {
  const { valor, tipo, prazo_meses = '12', taxa_personalizada } = c.req.query()

  if (!valor || !tipo) {
    return c.json({ error: 'Parâmetros: valor, tipo, prazo_meses' }, 400)
  }

  const taxas: Record<string, number> = {
    'poupanca': 0.005, // 0.5% ao mês (aprox 6% a.a.)
    'cdb': 0.009,      // 0.9% ao mês (aprox 11% a.a.)
    'lci': 0.0085,     // 0.85% ao mês (aprox 10.5% a.a.)
    'lca': 0.0085,
    'tesouro_direto': 0.0083, // SELIC ~10% a.a.
    'acoes': 0.012,    // 12% ao mês estimado
    'fii': 0.008,
    'cripto': 0.02,    // Alto risco
    'outros': 0.007
  }

  const taxaMensal = taxa_personalizada ? parseFloat(taxa_personalizada) / 100 : (taxas[tipo] || 0.008)
  const valorInicial = parseFloat(valor)
  const meses = parseInt(prazo_meses)

  const projecao = []
  let valorAtual = valorInicial

  for (let mes = 1; mes <= meses; mes++) {
    valorAtual = valorAtual * (1 + taxaMensal)
    if (mes % 3 === 0 || mes === meses) {
      projecao.push({
        mes,
        valor: Math.round(valorAtual * 100) / 100,
        lucro: Math.round((valorAtual - valorInicial) * 100) / 100
      })
    }
  }

  const valorFinal = valorInicial * Math.pow(1 + taxaMensal, meses)
  const lucroTotal = valorFinal - valorInicial
  const rentabilidadeTotal = ((valorFinal / valorInicial) - 1) * 100

  return c.json({
    simulacao: {
      valor_inicial: valorInicial,
      tipo,
      prazo_meses: meses,
      taxa_mensal: taxaMensal * 100,
      valor_final: Math.round(valorFinal * 100) / 100,
      lucro_total: Math.round(lucroTotal * 100) / 100,
      rentabilidade_total: Math.round(rentabilidadeTotal * 100) / 100,
      projecao
    },
    aviso: 'Esta é uma simulação educacional. Rentabilidades passadas não garantem resultados futuros.'
  })
})

export default investimentos
