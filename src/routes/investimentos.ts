import { Hono } from 'hono'
import { requireAuth } from './auth'
import { getLimites, MSG_UPGRADE } from './planos'

type Bindings = { DB: D1Database }
type Variables = { user: { id: number; nome: string; email: string; plano: string } }

const investimentos = new Hono<{ Bindings: Bindings; Variables: Variables }>()

// CDI atual padrão (% ao ano) - pode ser atualizado pelo usuário
const CDI_PADRAO_AA = 13.65

// Calcular rendimento diário da Caixinha
function calcularCaixinha(valorInvestido: number, percentualCdi: number, cdiAnual: number, diasDecorridos: number): number {
  // CDI diário: (1 + CDI_aa/100) ^ (1/252) - 1
  const cdiDiario = Math.pow(1 + cdiAnual / 100, 1 / 252) - 1
  // Rendimento da caixinha: % do CDI diário
  const taxaDiaria = cdiDiario * (percentualCdi / 100)
  // Valor atual com juros compostos
  return valorInvestido * Math.pow(1 + taxaDiaria, diasDecorridos)
}

// GET /api/investimentos
investimentos.get('/', requireAuth, async (c) => {
  const user = c.get('user')
  const result = await c.env.DB.prepare(
    'SELECT * FROM investimentos WHERE user_id = ? ORDER BY valor_atual DESC'
  ).bind(user.id).all()

  const hoje = new Date().toISOString().split('T')[0]

  const lista = (result.results as any[]).map(inv => {
    if (inv.tipo === 'caixinha' && inv.percentual_cdi && inv.data_inicio) {
      // Recalcular valor atual para Caixinha
      const dataInicio = new Date(inv.data_inicio + 'T00:00:00')
      const dataHoje = new Date()
      const diasDecorridos = Math.floor((dataHoje.getTime() - dataInicio.getTime()) / (1000 * 60 * 60 * 24))
      const cdiAnual = inv.cdi_atual || CDI_PADRAO_AA
      const valorAtualCalc = calcularCaixinha(inv.valor_investido, inv.percentual_cdi, cdiAnual, diasDecorridos)
      const rentab = inv.valor_investido > 0 ? ((valorAtualCalc - inv.valor_investido) / inv.valor_investido) * 100 : 0
      return {
        ...inv,
        valor_atual: Math.round(valorAtualCalc * 100) / 100,
        rentabilidade_percentual: Math.round(rentab * 100) / 100,
        dias_decorridos: diasDecorridos,
        cdi_info: `${inv.percentual_cdi}% do CDI (CDI: ${cdiAnual}% a.a.)`
      }
    }
    return inv
  })

  const total_investido = lista.reduce((sum, i) => sum + i.valor_investido, 0)
  const total_atual = lista.reduce((sum, i) => sum + (i.valor_atual || i.valor_investido), 0)
  const rentabilidade_total = total_investido > 0 ? ((total_atual - total_investido) / total_investido) * 100 : 0

  return c.json({ 
    investimentos: lista,
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

  // ── Limite de plano ──
  const lim = getLimites(user.plano)
  if (lim.investimentos !== Infinity) {
    const count = await c.env.DB.prepare('SELECT COUNT(*) as n FROM investimentos WHERE user_id = ?').bind(user.id).first() as any
    if ((count?.n || 0) >= lim.investimentos)
      return c.json({ error: MSG_UPGRADE.investimentos, upgrade: true, limite: lim.investimentos, feature: 'investimentos' }, 403)
  }

  const body = await c.req.json()
  const { 
    nome, tipo, valor_investido, rentabilidade_percentual = 0, risco = 'baixo', 
    data_inicio, data_vencimento, instituicao, observacoes,
    percentual_cdi = null, cdi_atual = CDI_PADRAO_AA,
    // Bloco 1.2: registra_saida_saldo — se true, registra saída do saldo bancário como despesa tipo='aporte'
    registrar_aporte = false,
    registra_saida_saldo = true
  } = body

  if (!nome || !tipo || !valor_investido || !data_inicio) {
    return c.json({ error: 'Campos obrigatórios: nome, tipo, valor_investido, data_inicio' }, 400)
  }

  let valor_atual = parseFloat(valor_investido)
  let rentab = parseFloat(rentabilidade_percentual)

  // Para Caixinha: calcular rentabilidade desde data de início
  if (tipo === 'caixinha' && percentual_cdi) {
    const dataInicio = new Date(data_inicio + 'T00:00:00')
    const diasDecorridos = Math.floor((new Date().getTime() - dataInicio.getTime()) / (1000 * 60 * 60 * 24))
    if (diasDecorridos > 0) {
      valor_atual = calcularCaixinha(parseFloat(valor_investido), parseFloat(percentual_cdi), parseFloat(cdi_atual) || CDI_PADRAO_AA, diasDecorridos)
      rentab = ((valor_atual - parseFloat(valor_investido)) / parseFloat(valor_investido)) * 100
    }
  } else {
    valor_atual = parseFloat(valor_investido) * (1 + parseFloat(rentabilidade_percentual) / 100)
  }

  const registraSaidaFinal = registra_saida_saldo !== undefined ? !!registra_saida_saldo : !!registrar_aporte

  const result = await c.env.DB.prepare(
    'INSERT INTO investimentos (user_id, nome, tipo, valor_investido, rentabilidade_percentual, valor_atual, risco, data_inicio, data_vencimento, instituicao, observacoes, percentual_cdi, cdi_atual, data_ultimo_calculo, registra_saida_saldo) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(
    user.id, nome, tipo, parseFloat(valor_investido), Math.round(rentab * 100) / 100, 
    Math.round(valor_atual * 100) / 100, risco, data_inicio, 
    data_vencimento || null, instituicao || null, observacoes || null,
    percentual_cdi ? parseFloat(percentual_cdi) : null,
    tipo === 'caixinha' ? (parseFloat(cdi_atual) || CDI_PADRAO_AA) : null,
    tipo === 'caixinha' ? new Date().toISOString().split('T')[0] : null,
    registraSaidaFinal ? 1 : 0
  ).run()

  // Bloco 1.2: Registrar aporte como despesa com eh_aporte_patrimonial=1 e tipo='aporte'
  // NÃO aparece em relatórios de despesas nem no total de gastos
  if (registraSaidaFinal && parseFloat(valor_investido) > 0) {
    await c.env.DB.prepare(
      `INSERT INTO despesas (user_id, descricao, data, categoria, subcategoria, valor, status, meio_pagamento, tipo, eh_aporte_patrimonial, observacoes)
       VALUES (?, ?, ?, 'Aporte Patrimonial', 'Investimento', ?, 'pago', 'transferencia', 'aporte', 1, ?)`
    ).bind(
      user.id,
      `Aporte: ${nome}`,
      data_inicio,
      parseFloat(valor_investido),
      `Aporte em ${tipo.toUpperCase()} — ${nome}`
    ).run()
  }

  // Conquistas por tipo de investimento
  if (tipo === 'caixinha') await verificarConquista(c.env.DB, user.id, 'investidor_cdi')
  if (tipo === 'acoes') await verificarConquista(c.env.DB, user.id, 'investidor_acoes')
  if (tipo === 'fii') await verificarConquista(c.env.DB, user.id, 'investidor_fii')
  if (tipo === 'cripto') await verificarConquista(c.env.DB, user.id, 'investidor_cripto')
  if (tipo === 'tesouro_direto') await verificarConquista(c.env.DB, user.id, 'investidor_tesouro')
  if (tipo === 'cdb') await verificarConquista(c.env.DB, user.id, 'investidor_cdb')
  await verificarConquista(c.env.DB, user.id, 'investidor')

  // Verificar conquista poupador_dedicado e portfólio diversificado
  const totalInv = await c.env.DB.prepare(
    'SELECT COALESCE(SUM(valor_atual), 0) as total FROM investimentos WHERE user_id = ?'
  ).bind(user.id).first() as any
  if ((totalInv?.total || 0) >= 10000) await verificarConquista(c.env.DB, user.id, 'poupador_dedicado')

  // Diversificado: 3+ tipos diferentes
  const tiposDistintos = await c.env.DB.prepare(
    'SELECT COUNT(DISTINCT tipo) as cnt FROM investimentos WHERE user_id = ?'
  ).bind(user.id).first() as any
  if ((tiposDistintos?.cnt || 0) >= 3) await verificarConquista(c.env.DB, user.id, 'investidor_diversificado')

  // Milionário: R$100k+ investidos
  if ((totalInv?.total || 0) >= 100000) await verificarConquista(c.env.DB, user.id, 'milionario')

  return c.json({ success: true, id: result.meta.last_row_id, message: 'Investimento adicionado!' }, 201)
})

// PUT /api/investimentos/:id
investimentos.put('/:id', requireAuth, async (c) => {
  const user = c.get('user')
  const id = c.req.param('id')
  const body = await c.req.json()

  const existing = await c.env.DB.prepare('SELECT id FROM investimentos WHERE id = ? AND user_id = ?').bind(id, user.id).first()
  if (!existing) return c.json({ error: 'Investimento não encontrado' }, 404)

  const { 
    nome, tipo, valor_investido, rentabilidade_percentual, valor_atual: vAtualBody, 
    risco, data_inicio, data_vencimento, instituicao, observacoes,
    percentual_cdi = null, cdi_atual = CDI_PADRAO_AA
  } = body

  let valor_atual = vAtualBody ? parseFloat(vAtualBody) : parseFloat(valor_investido)
  let rentab = parseFloat(rentabilidade_percentual || 0)

  if (tipo === 'caixinha' && percentual_cdi) {
    const dataInicio = new Date(data_inicio + 'T00:00:00')
    const diasDecorridos = Math.floor((new Date().getTime() - dataInicio.getTime()) / (1000 * 60 * 60 * 24))
    if (diasDecorridos > 0) {
      valor_atual = calcularCaixinha(parseFloat(valor_investido), parseFloat(percentual_cdi), parseFloat(cdi_atual) || CDI_PADRAO_AA, diasDecorridos)
      rentab = ((valor_atual - parseFloat(valor_investido)) / parseFloat(valor_investido)) * 100
    }
  }

  await c.env.DB.prepare(
    'UPDATE investimentos SET nome = ?, tipo = ?, valor_investido = ?, rentabilidade_percentual = ?, valor_atual = ?, risco = ?, data_inicio = ?, data_vencimento = ?, instituicao = ?, observacoes = ?, percentual_cdi = ?, cdi_atual = ?, data_ultimo_calculo = ? WHERE id = ? AND user_id = ?'
  ).bind(
    nome, tipo, parseFloat(valor_investido), Math.round(rentab * 100) / 100, 
    Math.round(valor_atual * 100) / 100, risco, data_inicio, 
    data_vencimento || null, instituicao || null, observacoes || null,
    percentual_cdi ? parseFloat(percentual_cdi) : null,
    tipo === 'caixinha' ? (parseFloat(cdi_atual) || CDI_PADRAO_AA) : null,
    tipo === 'caixinha' ? new Date().toISOString().split('T')[0] : null,
    id, user.id
  ).run()

  // Verificar conquistas após atualização
  const totalInvAtualizado = await c.env.DB.prepare(
    'SELECT COALESCE(SUM(valor_atual), 0) as total FROM investimentos WHERE user_id = ?'
  ).bind(user.id).first() as any
  if ((totalInvAtualizado?.total || 0) >= 10000) await verificarConquista(c.env.DB, user.id, 'poupador_dedicado')
  if ((totalInvAtualizado?.total || 0) >= 100000) await verificarConquista(c.env.DB, user.id, 'milionario')

  const tiposDistintosAtualizados = await c.env.DB.prepare(
    'SELECT COUNT(DISTINCT tipo) as cnt FROM investimentos WHERE user_id = ?'
  ).bind(user.id).first() as any
  if ((tiposDistintosAtualizados?.cnt || 0) >= 3) await verificarConquista(c.env.DB, user.id, 'investidor_diversificado')

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
  const { valor, tipo, prazo_meses = '12', taxa_personalizada, percentual_cdi } = c.req.query()

  if (!valor || !tipo) {
    return c.json({ error: 'Parâmetros: valor, tipo, prazo_meses' }, 400)
  }

  // Buscar CDI real do cache local (tabela cdi_historico)
  let CDI_EFETIVO = CDI_PADRAO_AA
  try {
    const cdiCached = await c.env.DB.prepare(
      `SELECT taxa, data FROM cdi_historico ORDER BY data DESC LIMIT 1`
    ).first<{taxa:number; data:string}>()
    if (cdiCached?.taxa) {
      // Converter taxa diária para anual: (1 + taxa_diaria/100)^252 - 1
      CDI_EFETIVO = (Math.pow(1 + cdiCached.taxa / 100, 252) - 1) * 100
    }
  } catch (_) {}

  const taxas: Record<string, number> = {
    'poupanca': 0.005,
    'cdb': 0.009,
    'lci': 0.0085,
    'lca': 0.0085,
    'tesouro_direto': 0.0083,
    'acoes': 0.012,
    'fii': 0.008,
    'cripto': 0.02,
    'caixinha': 0, // calculado abaixo
    'outros': 0.007
  }

  let taxaMensal: number
  if (tipo === 'caixinha' && percentual_cdi) {
    // CDI mensal: (1 + CDI_aa/100)^(1/12) - 1
    const cdiMensal = Math.pow(1 + CDI_EFETIVO / 100, 1 / 12) - 1
    taxaMensal = cdiMensal * (parseFloat(percentual_cdi) / 100)
  } else {
    taxaMensal = taxa_personalizada ? parseFloat(taxa_personalizada) / 100 : (taxas[tipo] || 0.008)
  }

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
      taxa_mensal: Math.round(taxaMensal * 10000) / 100,
      valor_final: Math.round(valorFinal * 100) / 100,
      lucro_total: Math.round(lucroTotal * 100) / 100,
      rentabilidade_total: Math.round(rentabilidadeTotal * 100) / 100,
      projecao
    },
    aviso: tipo === 'caixinha'
      ? `Simulação com ${percentual_cdi || 100}% do CDI (CDI atual: ${CDI_PADRAO_AA}% a.a.). Rendimento calculado com capitalização diária.`
      : 'Esta é uma simulação educacional. Rentabilidades passadas não garantem resultados futuros.'
  })
})

async function verificarConquista(db: D1Database, userId: number, codigo: string) {
  try {
    await db.prepare('INSERT OR IGNORE INTO conquistas_usuario (user_id, conquista_codigo, visualizado) VALUES (?, ?, 0)').bind(userId, codigo).run()
  } catch { }
}

export default investimentos
