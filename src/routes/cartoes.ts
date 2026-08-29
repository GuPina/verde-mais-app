import { Hono } from 'hono'
import { limiteDoCartao, limitesDosCartoes } from '../lib/limite-cartao'

/** Dinheiro em mensagem para o usuário: pt-BR, não "R$ 900.00". */
const emReais = (v: number) =>
  `R$ ${Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
import { requireAuth } from './auth'
import { getLimites, MSG_UPGRADE } from './planos'

type Bindings  = { DB: D1Database }
type Variables = { user: { id: number; nome: string; email: string; plano: string } }

const cartoes = new Hono<{ Bindings: Bindings; Variables: Variables }>()

const BANDEIRAS_VALIDAS = ['visa', 'mastercard', 'elo', 'amex', 'hipercard', 'outros']
const MAX_VALOR_CARTAO = 1_000_000_000
const MAX_PARCELAS_CARTAO = 60
const MAX_TEXTO_CARTAO = 500

function textoObrigatorio(valor: unknown, campo: string, max = MAX_TEXTO_CARTAO) {
  const texto = String(valor ?? '').trim()
  if (!texto) return { error: `${campo} é obrigatório` }
  if (texto.length > max) return { error: `${campo} deve ter no máximo ${max} caracteres` }
  return { value: texto }
}

function textoOpcional(valor: unknown, max = MAX_TEXTO_CARTAO) {
  if (valor === undefined || valor === null) return null
  const texto = String(valor).trim()
  if (!texto) return null
  return texto.length > max ? texto.slice(0, max) : texto
}

function numeroPositivo(valor: unknown, campo: string, max = MAX_VALOR_CARTAO) {
  const n = Number(valor)
  if (!Number.isFinite(n) || n <= 0) return { error: `${campo} deve ser um número maior que zero` }
  if (n > max) return { error: `${campo} excede o limite máximo permitido` }
  return { value: Math.round(n * 100) / 100 }
}

function inteiroEntre(valor: unknown, campo: string, min: number, max: number) {
  const n = Number(valor)
  if (!Number.isInteger(n) || n < min || n > max) return { error: `${campo} deve ser um número inteiro entre ${min} e ${max}` }
  return { value: n }
}

function dataIso(valor: unknown, campo = 'data_compra') {
  const data = String(valor ?? '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) return { error: `${campo} deve estar no formato AAAA-MM-DD` }
  const d = new Date(data + 'T12:00:00')
  if (Number.isNaN(d.getTime())) return { error: `${campo} inválida` }
  return { value: data }
}

function mesAnoValidos(mesValor: unknown, anoValor: unknown) {
  const mes = inteiroEntre(mesValor, 'mes', 1, 12)
  if ('error' in mes) return { error: mes.error }
  const ano = inteiroEntre(anoValor, 'ano', 2000, 2100)
  if ('error' in ano) return { error: ano.error }
  return { mes: mes.value, ano: ano.value }
}

function corCartao(valor: unknown) {
  const cor = String(valor || '#2FBF71').trim()
  return /^#[0-9A-Fa-f]{6}$/.test(cor) ? cor : '#2FBF71'
}

function ultimosDigitos(valor: unknown) {
  const digitos = String(valor ?? '').replace(/\D/g, '').slice(-4)
  return digitos || null
}

async function limiteDisponivelParaCompra(db: D1Database, cardId: number, limiteTotal: number) {
  const usoAtual = await db.prepare(
    `SELECT COALESCE(SUM(valor),0) as total FROM card_charges
     WHERE card_id = ? AND status = 'pendente'`
  ).bind(cardId).first() as any
  const utilizado  = Math.round(Number(usoAtual?.total || 0) * 100) / 100
  const disponivel = Math.round((Number(limiteTotal || 0) - utilizado) * 100) / 100
  return { utilizado, disponivel }
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS DE CÁLCULO BANCÁRIO
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Retorna {month, year} da FATURA onde a compra vai cair.
 * Regra bancária: compra no fechamento ou APÓS → próxima fatura.
 */
function calcBillingPeriod(purchaseDateStr: string, closingDay: number) {
  const d    = new Date(purchaseDateStr + 'T12:00:00')
  let month  = d.getMonth() + 1   // 1-12
  let year   = d.getFullYear()
  const effectiveClosingDay = Math.min(
    Math.max(1, Number(closingDay) || 1),
    new Date(year, month, 0).getDate()
  )
  if (d.getDate() >= effectiveClosingDay) { // >= inclui o próprio dia de fechamento
    month++
    if (month > 12) { month = 1; year++ }
  }
  return { month, year }
}

/**
 * Retorna a data de vencimento da fatura (dia_vencimento do cartão).
 *
 * Regra bancária: o vencimento ocorre APÓS o fechamento.
 * • Se dueDay > closingDay  → vencimento no mesmo mês da fatura
 *   Ex: fechamento 25, vencimento 28, ciclo março → vence 28/03
 * • Se dueDay <= closingDay → vencimento no mês SEGUINTE ao da fatura
 *   Ex: fechamento 25, vencimento 1,  ciclo março → vence 01/04
 *   Ex: fechamento 25, vencimento 10, ciclo março → vence 10/04
 *
 * @param billingMonth   Mês da fatura (1-12) retornado por calcBillingPeriod
 * @param billingYear    Ano da fatura retornado por calcBillingPeriod
 * @param dueDay         Dia de vencimento configurado no cartão
 * @param closingDay     Dia de fechamento configurado no cartão
 */
function calcDueDate(billingMonth: number, billingYear: number, dueDay: number, closingDay: number): string {
  let month = billingMonth
  let year  = billingYear

  // Vencimento <= fechamento → vence no mês seguinte ao da fatura
  if (dueDay <= closingDay) {
    month++
    if (month > 12) { month = 1; year++ }
  }

  // Cuidado: dueDay pode ser 31 em mês de 30 dias → usar último dia do mês
  const lastDay = new Date(year, month, 0).getDate()
  const day     = Math.min(dueDay, lastDay)
  return `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`
}

/** Gera um UUID v4 simples compatível com Cloudflare Workers */
function uuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/cartoes
// ─────────────────────────────────────────────────────────────────────────────
cartoes.get('/', requireAuth, async (c) => {
  const user   = c.get('user')
  const result = await c.env.DB.prepare(
    'SELECT * FROM cartoes WHERE user_id = ? AND ativo = 1 ORDER BY nome ASC'
  ).bind(user.id).all()

  // Uma query só para todos os cartões, em vez de uma por cartão.
  const limites = await limitesDosCartoes(c.env.DB, user.id)
  const cartoesComUso = (result.results as any[]).map((cartao) => ({
    ...cartao,
    ...(limites.get(Number(cartao.id)) ?? {
      limite_total: Number(cartao.limite_total || 0),
      limite_utilizado: 0,
      limite_disponivel: Number(cartao.limite_total || 0),
      percentual_uso: 0,
    }),
  }))

  return c.json({ cartoes: cartoesComUso })
})

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/cartoes
// ─────────────────────────────────────────────────────────────────────────────
cartoes.post('/', requireAuth, async (c) => {
  const user = c.get('user')
  const lim  = getLimites(user.plano)
  if (lim.cartoes !== Infinity) {
    const cnt = await c.env.DB.prepare(
      'SELECT COUNT(*) as n FROM cartoes WHERE user_id = ? AND ativo = 1'
    ).bind(user.id).first() as any
    if ((cnt?.n || 0) >= lim.cartoes)
      return c.json({ error: MSG_UPGRADE.cartoes, upgrade: true, limite: lim.cartoes }, 403)
  }

  const { nome, bandeira: bandeiraBruta, banco, apelido, limite_total, dia_vencimento, dia_fechamento, cor, ultimos_digitos } = await c.req.json()
  if (nome === undefined || bandeiraBruta === undefined || banco === undefined || limite_total === undefined || dia_vencimento === undefined || dia_fechamento === undefined)
    return c.json({ error: 'Campos obrigatórios: nome, bandeira, banco, limite_total, dia_vencimento, dia_fechamento' }, 400)

  const nomeValidado = textoObrigatorio(nome, 'nome', 120)
  if ('error' in nomeValidado) return c.json({ error: nomeValidado.error }, 400)

  const bancoValidado = textoObrigatorio(banco, 'banco', 120)
  if ('error' in bancoValidado) return c.json({ error: bancoValidado.error }, 400)

  // C2: normalizar bandeira para lowercase e validar enum
  const bandeira = String(bandeiraBruta).trim().toLowerCase()
  if (!BANDEIRAS_VALIDAS.includes(bandeira))
    return c.json({ error: `Bandeira inválida. Use: ${BANDEIRAS_VALIDAS.join(', ')}` }, 400)

  const limiteValidado = numeroPositivo(limite_total, 'limite_total')
  if ('error' in limiteValidado) return c.json({ error: limiteValidado.error }, 400)

  const vencimentoValidado = inteiroEntre(dia_vencimento, 'dia_vencimento', 1, 31)
  if ('error' in vencimentoValidado) return c.json({ error: vencimentoValidado.error }, 400)

  const fechamentoValidado = inteiroEntre(dia_fechamento, 'dia_fechamento', 1, 31)
  if ('error' in fechamentoValidado) return c.json({ error: fechamentoValidado.error }, 400)

  const r = await c.env.DB.prepare(
    `INSERT INTO cartoes (user_id, nome, bandeira, banco, apelido, limite_total, limite_disponivel,
     dia_vencimento, dia_fechamento, cor, ultimos_digitos)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(user.id, nomeValidado.value, bandeira, bancoValidado.value, textoOpcional(apelido, 80),
    limiteValidado.value, limiteValidado.value,
    vencimentoValidado.value, fechamentoValidado.value,
    corCartao(cor), ultimosDigitos(ultimos_digitos)
  ).run()

  await verificarConquista(c.env.DB, user.id, 'carteirinha')
  // Verificar conquistas de quantidade de cartões
  const totalCartoes = await c.env.DB.prepare('SELECT COUNT(*) as n FROM cartoes WHERE user_id = ? AND ativo = 1').bind(user.id).first() as any
  if ((totalCartoes?.n || 0) >= 2) await verificarConquista(c.env.DB, user.id, 'dois_cartoes')
  if ((totalCartoes?.n || 0) >= 5) await verificarConquista(c.env.DB, user.id, 'cinco_cartoes')
  return c.json({ success: true, id: r.meta.last_row_id, message: 'Cartão cadastrado!' }, 201)
})

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/cartoes/:id
// ─────────────────────────────────────────────────────────────────────────────
cartoes.put('/:id', requireAuth, async (c) => {
  const user = c.get('user')
  const id   = c.req.param('id')
  const ex   = await c.env.DB.prepare('SELECT id FROM cartoes WHERE id = ? AND user_id = ?').bind(id, user.id).first()
  if (!ex) return c.json({ error: 'Cartão não encontrado' }, 404)

  const { nome, bandeira: bandeiraBrutaEdit, banco, apelido: apelidoEdit, limite_total, dia_vencimento, dia_fechamento, cor, ultimos_digitos } = await c.req.json()

  // C2: normalizar bandeira PUT também
  const bandeiraEdit = bandeiraBrutaEdit !== undefined ? String(bandeiraBrutaEdit).trim().toLowerCase() : undefined
  if (bandeiraEdit && !BANDEIRAS_VALIDAS.includes(bandeiraEdit))
    return c.json({ error: `Bandeira inválida. Use: ${BANDEIRAS_VALIDAS.join(', ')}` }, 400)

  // montar update dinâmico para não causar NaN com campos ausentes
  const updFields: string[] = []
  const updVals: any[] = []

  if (nome !== undefined) {
    const nomeEdit = textoObrigatorio(nome, 'nome', 120)
    if ('error' in nomeEdit) return c.json({ error: nomeEdit.error }, 400)
    updFields.push('nome=?'); updVals.push(nomeEdit.value)
  }
  if (bandeiraEdit !== undefined)   { updFields.push('bandeira=?');       updVals.push(bandeiraEdit) }
  if (banco !== undefined) {
    const bancoEdit = textoObrigatorio(banco, 'banco', 120)
    if ('error' in bancoEdit) return c.json({ error: bancoEdit.error }, 400)
    updFields.push('banco=?'); updVals.push(bancoEdit.value)
  }
  if (apelidoEdit !== undefined)    { updFields.push('apelido=?');        updVals.push(textoOpcional(apelidoEdit, 80)) }
  if (limite_total !== undefined) {
    const limNum = numeroPositivo(limite_total, 'limite_total')
    if ('error' in limNum) return c.json({ error: limNum.error }, 400)
    updFields.push('limite_total=?'); updVals.push(limNum.value)
  }
  if (dia_vencimento !== undefined) {
    const dv = inteiroEntre(dia_vencimento, 'dia_vencimento', 1, 31)
    if ('error' in dv) return c.json({ error: dv.error }, 400)
    updFields.push('dia_vencimento=?'); updVals.push(dv.value)
  }
  if (dia_fechamento !== undefined) {
    const df = inteiroEntre(dia_fechamento, 'dia_fechamento', 1, 31)
    if ('error' in df) return c.json({ error: df.error }, 400)
    updFields.push('dia_fechamento=?'); updVals.push(df.value)
  }
  if (cor !== undefined)            { updFields.push('cor=?');            updVals.push(corCartao(cor)) }
  if (ultimos_digitos !== undefined){ updFields.push('ultimos_digitos=?');updVals.push(ultimosDigitos(ultimos_digitos)) }

  if (updFields.length === 0) return c.json({ success: true, message: 'Nada a atualizar.' })

  updVals.push(id, user.id)
  await c.env.DB.prepare(
    `UPDATE cartoes SET ${updFields.join(', ')} WHERE id=? AND user_id=?`
  ).bind(...updVals).run()
  return c.json({ success: true, message: 'Cartão atualizado!' })
})

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/cartoes/:id
// ─────────────────────────────────────────────────────────────────────────────
cartoes.delete('/:id', requireAuth, async (c) => {
  const user = c.get('user')
  const id   = c.req.param('id')
  // Verificar se cartão existe e pertence ao usuário
  const ex = await c.env.DB.prepare('SELECT id FROM cartoes WHERE id = ? AND user_id = ? AND ativo = 1').bind(id, user.id).first()
  if (!ex) return c.json({ error: 'Cartão não encontrado' }, 404)

  try {
    // 1. Preserva histórico: despesas seguem existindo, apenas deixam de apontar
    // para um cartão arquivado. Excluir histórico financeiro real é perigoso.
    await c.env.DB.prepare('UPDATE despesas SET cartao_id = NULL WHERE cartao_id = ? AND user_id = ?').bind(id, user.id).run()
    // 2. card_charges são artefatos da fatura do cartão arquivado.
    await c.env.DB.prepare('DELETE FROM card_charges WHERE card_id = ?').bind(id).run()
    // 3. alertas_cartao
    await c.env.DB.prepare('DELETE FROM alertas_cartao WHERE cartao_id = ?').bind(id).run()
    // 4. Arquivar em vez de apagar o cartão
    await c.env.DB.prepare('UPDATE cartoes SET ativo = 0 WHERE id = ? AND user_id = ?').bind(id, user.id).run()
  } catch (e: any) {
    return c.json({ error: 'Erro ao excluir cartão: ' + (e?.message || String(e)) }, 500)
  }

  return c.json({ success: true, message: 'Cartão arquivado. As despesas históricas foram preservadas.' })
})

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/cartoes/fatura-resumo — dashboard: todas faturas do mês corrente
// IMPORTANTE: deve ficar ANTES de /:id/* para não ser capturado pelo param
// ─────────────────────────────────────────────────────────────────────────────
cartoes.get('/fatura-resumo', requireAuth, async (c) => {
  const user = c.get('user')
  const now  = new Date()
  const mes  = now.getMonth() + 1
  const ano  = now.getFullYear()

  const lista = await c.env.DB.prepare(
    'SELECT * FROM cartoes WHERE user_id = ? AND ativo = 1'
  ).bind(user.id).all()
  const resumo = []

  for (const cartao of lista.results as any[]) {
    const fat = await c.env.DB.prepare(
      `SELECT COALESCE(SUM(valor),0) as total,
              COALESCE(SUM(CASE WHEN status='pendente' THEN valor ELSE 0 END),0) as pendente
       FROM card_charges WHERE card_id = ? AND billing_month = ? AND billing_year = ?`
    ).bind(cartao.id, mes, ano).first() as any

    const usoG = await c.env.DB.prepare(
      `SELECT COALESCE(SUM(valor),0) as total FROM card_charges
       WHERE card_id = ? AND status = 'pendente'`
    ).bind(cartao.id).first() as any

    const limite_utilizado  = Number(usoG?.total || 0)
    const limite_disponivel = Math.max(0, cartao.limite_total - limite_utilizado)

    resumo.push({
      ...cartao,
      fatura_atual: Number(fat?.total || 0),
      fatura_pendente: Number(fat?.pendente || 0),
      limite_utilizado,
      limite_disponivel
    })
  }
  return c.json({ resumo })
})

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/cartoes/resumo-faturas — S-C2: resumo unificado com próximo vencimento
// Retorna para cada cartão: fatura atual, pendente, próxima data de vencimento,
// dias até o vencimento, dias até o fechamento e status de alerta de limite (S-C3)
// IMPORTANTE: deve ficar ANTES de /:id/* para não ser capturado pelo param
// ─────────────────────────────────────────────────────────────────────────────
cartoes.get('/resumo-faturas', requireAuth, async (c) => {
  const user = c.get('user')
  const now  = new Date()
  const hoje = now.toISOString().split('T')[0]
  const mes  = now.getMonth() + 1
  const ano  = now.getFullYear()

  const lista = await c.env.DB.prepare(
    'SELECT * FROM cartoes WHERE user_id = ? AND ativo = 1 ORDER BY id ASC'
  ).bind(user.id).all()

  const resumo = []
  let totalFaturasAbertas = 0
  let totalFaturasPendentes = 0

  for (const cartao of lista.results as any[]) {
    // Determinar mês de fatura atual (baseado no dia de fechamento)
    let mesFat = mes, anoFat = ano
    if (now.getDate() >= cartao.dia_fechamento) {
      mesFat++; if (mesFat > 12) { mesFat = 1; anoFat++ }
    }

    const fat = await c.env.DB.prepare(
      `SELECT COALESCE(SUM(valor),0) as total,
              COALESCE(SUM(CASE WHEN status='pendente' THEN valor ELSE 0 END),0) as pendente,
              COUNT(*) as qtd
       FROM card_charges WHERE card_id = ? AND billing_month = ? AND billing_year = ?`
    ).bind(cartao.id, mesFat, anoFat).first() as any

    const usoG = await c.env.DB.prepare(
      `SELECT COALESCE(SUM(valor),0) as total FROM card_charges
       WHERE card_id = ? AND status = 'pendente'`
    ).bind(cartao.id).first() as any

    const limite_utilizado  = Math.round(Number(usoG?.total || 0) * 100) / 100
    const limite_disponivel = Math.round(Math.max(0, cartao.limite_total - limite_utilizado) * 100) / 100
    const percentual_uso    = cartao.limite_total > 0 ? Math.round((limite_utilizado / cartao.limite_total) * 100) : 0

    // S-C1: calcular próxima data de vencimento
    const proxVencimento = calcDueDate(mesFat, anoFat, cartao.dia_vencimento, cartao.dia_fechamento)
    const diffVenc = Math.ceil((new Date(proxVencimento + 'T12:00:00').getTime() - new Date(hoje + 'T12:00:00').getTime()) / (1000 * 60 * 60 * 24))

    // Dias até o fechamento da fatura corrente
    let dataFechamento = `${ano}-${String(mes).padStart(2,'0')}-${String(Math.min(cartao.dia_fechamento, 28)).padStart(2,'0')}`
    const diffFech = Math.ceil((new Date(dataFechamento + 'T12:00:00').getTime() - new Date(hoje + 'T12:00:00').getTime()) / (1000 * 60 * 60 * 24))

    // S-C3: alerta de limite
    const alerta_limite = percentual_uso >= 90 ? 'critico' : percentual_uso >= 70 ? 'atencao' : 'ok'

    const fatura_atual    = Math.round(Number(fat?.total    || 0) * 100) / 100
    const fatura_pendente = Math.round(Number(fat?.pendente || 0) * 100) / 100

    totalFaturasAbertas   += fatura_atual
    totalFaturasPendentes += fatura_pendente

    resumo.push({
      id: cartao.id,
      nome: cartao.nome,
      apelido: cartao.apelido || null,
      bandeira: cartao.bandeira,
      banco: cartao.banco,
      cor: cartao.cor,
      limite_total: cartao.limite_total,
      limite_utilizado,
      limite_disponivel,
      percentual_uso,
      alerta_limite,
      fatura_atual,
      fatura_pendente,
      fatura_mes: mesFat,
      fatura_ano: anoFat,
      prox_vencimento: proxVencimento,
      dias_para_vencer: diffVenc,
      dias_para_fechar: diffFech,
      qtd_lancamentos: Number(fat?.qtd || 0)
    })
  }

  return c.json({
    resumo,
    totais: {
      total_faturas: Math.round(totalFaturasAbertas * 100) / 100,
      total_pendente: Math.round(totalFaturasPendentes * 100) / 100,
      qtd_cartoes: resumo.length
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/cartoes/:id/fatura?mes=3&ano=2026
// Interface bancária real: navega por mês/ano, mostra card_charges
// ─────────────────────────────────────────────────────────────────────────────
// ─── GET /api/cartoes/analise ────────────────────────────────────────────────
// Análise histórica de uso dos cartões.
//
// Tudo aqui sai de `card_charges`, que já guarda a fatura (billing_month/year)
// de cada lançamento — então dá para reconstruir o histórico sem pedir nada
// novo ao usuário.
//
// A pergunta que a tela responde não é "quanto gastei" (isso Despesas já diz),
// e sim: **minha fatura está subindo?** e **quanto dos próximos meses eu já
// vendi?** — a segunda é a que ninguém calcula à mão e a que mais dói.
cartoes.get('/analise', requireAuth, async (c) => {
  const user = c.get('user')
  // AC3: parseInt('abc')=NaN → Math.max(3,NaN)=NaN → janela vazia → janela[0] estourava 500.
  const mesesRaw = parseInt(c.req.query('meses') || '12', 10)
  const meses = Math.min(24, Math.max(3, Number.isInteger(mesesRaw) ? mesesRaw : 12))
  const cartaoFiltroRaw = c.req.query('cartao_id')
  if (cartaoFiltroRaw && !/^\d+$/.test(cartaoFiltroRaw)) return c.json({ error: 'cartao_id inválido.' }, 400)
  const cartaoFiltro: number | null = cartaoFiltroRaw ? parseInt(cartaoFiltroRaw, 10) : null

  const hoje = new Date()
  const mesAtual = hoje.getMonth() + 1
  const anoAtual = hoje.getFullYear()

  // Janela: `meses` para trás, contando o mês corrente.
  const janela: Array<{ m: number; a: number; chave: string; label: string }> = []
  const NOMES = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez']
  for (let i = meses - 1; i >= 0; i--) {
    let m = mesAtual - i, a = anoAtual
    while (m <= 0) { m += 12; a -= 1 }
    janela.push({ m, a, chave: `${a}-${String(m).padStart(2,'0')}`, label: `${NOMES[m-1]}/${String(a).slice(2)}` })
  }
  const maisAntigo = janela[0]

  const filtroCartao = cartaoFiltro ? ' AND cc.card_id = ?' : ''
  const paramsCartao = cartaoFiltro ? [cartaoFiltro] : []

  const [porMes, porCartaoMes, futuras, categorias, recorrentes, cartoesLista] = await Promise.all([
    // Fatura de cada mês da janela
    c.env.DB.prepare(
      `SELECT cc.billing_year as ano, cc.billing_month as mes,
              COALESCE(SUM(cc.valor),0) as total, COUNT(*) as lancamentos
       FROM card_charges cc
       JOIN cartoes c2 ON c2.id = cc.card_id
       WHERE c2.user_id = ? AND cc.status != 'cancelado'
         AND (cc.billing_year > ? OR (cc.billing_year = ? AND cc.billing_month >= ?))${filtroCartao}
       GROUP BY cc.billing_year, cc.billing_month`
    ).bind(user.id, maisAntigo.a, maisAntigo.a, maisAntigo.m, ...paramsCartao).all(),

    // Quebra por cartão, para empilhar a barra
    c.env.DB.prepare(
      `SELECT cc.card_id, c2.nome as cartao, c2.cor,
              cc.billing_year as ano, cc.billing_month as mes,
              COALESCE(SUM(cc.valor),0) as total
       FROM card_charges cc
       JOIN cartoes c2 ON c2.id = cc.card_id
       WHERE c2.user_id = ? AND cc.status != 'cancelado'
         AND (cc.billing_year > ? OR (cc.billing_year = ? AND cc.billing_month >= ?))${filtroCartao}
       GROUP BY cc.card_id, c2.nome, c2.cor, cc.billing_year, cc.billing_month`
    ).bind(user.id, maisAntigo.a, maisAntigo.a, maisAntigo.m, ...paramsCartao).all(),

    // ── O número que ninguém calcula: parcelas já contratadas nos meses que
    // ainda vão chegar. É o "mês do sufoco" aparecendo com antecedência.
    c.env.DB.prepare(
      `SELECT cc.billing_year as ano, cc.billing_month as mes,
              COALESCE(SUM(cc.valor),0) as total, COUNT(*) as lancamentos
       FROM card_charges cc
       JOIN cartoes c2 ON c2.id = cc.card_id
       WHERE c2.user_id = ? AND cc.status = 'pendente'
         AND (cc.billing_year > ? OR (cc.billing_year = ? AND cc.billing_month > ?))${filtroCartao}
       GROUP BY cc.billing_year, cc.billing_month
       ORDER BY cc.billing_year, cc.billing_month`
    ).bind(user.id, anoAtual, anoAtual, mesAtual, ...paramsCartao).all(),

    // Categorias — vem da despesa vinculada ao lançamento
    c.env.DB.prepare(
      `SELECT COALESCE(d.categoria,'Sem categoria') as categoria,
              COALESCE(SUM(cc.valor),0) as total, COUNT(*) as qtd
       FROM card_charges cc
       JOIN cartoes c2 ON c2.id = cc.card_id
       LEFT JOIN despesas d ON d.id = cc.expense_id
       WHERE c2.user_id = ? AND cc.status != 'cancelado'
         AND cc.billing_year = ? AND cc.billing_month = ?${filtroCartao}
       GROUP BY COALESCE(d.categoria,'Sem categoria')
       ORDER BY total DESC LIMIT 6`
    ).bind(user.id, anoAtual, mesAtual, ...paramsCartao).all(),

    // Cobranças que se repetem com o MESMO valor em meses diferentes:
    // assinatura disfarçada de compra avulsa.
    c.env.DB.prepare(
      `SELECT cc.descricao, cc.valor, COUNT(DISTINCT cc.billing_year * 12 + cc.billing_month) as meses
       FROM card_charges cc
       JOIN cartoes c2 ON c2.id = cc.card_id
       WHERE c2.user_id = ? AND cc.status != 'cancelado'
         AND COALESCE(cc.total_parcelas, 1) <= 1
         AND (cc.billing_year > ? OR (cc.billing_year = ? AND cc.billing_month >= ?))${filtroCartao}
       GROUP BY cc.descricao, cc.valor
       HAVING COUNT(DISTINCT cc.billing_year * 12 + cc.billing_month) >= 3
       ORDER BY cc.valor DESC LIMIT 10`
    ).bind(user.id, maisAntigo.a, maisAntigo.a, maisAntigo.m, ...paramsCartao).all(),

    c.env.DB.prepare(
      `SELECT id, nome, cor, limite_total FROM cartoes WHERE user_id = ? AND ativo = 1 ORDER BY nome`
    ).bind(user.id).all(),
  ])

  // ── Série mensal, já com a variação sobre o mês anterior ──────────────────
  const mapaMes = new Map<string, { total: number; lancamentos: number }>()
  for (const r of (porMes.results as any[] || [])) {
    mapaMes.set(`${r.ano}-${String(r.mes).padStart(2,'0')}`, {
      total: Number(r.total), lancamentos: Number(r.lancamentos),
    })
  }

  const limiteTotalSomado = (cartoesLista.results as any[] || [])
    .filter(c2 => !cartaoFiltro || Number(c2.id) === cartaoFiltro)
    .reduce((s, c2) => s + Number(c2.limite_total || 0), 0)

  const serie = janela.map((j, i) => {
    const atual = mapaMes.get(j.chave)?.total ?? 0
    const anterior = i > 0 ? (mapaMes.get(janela[i-1].chave)?.total ?? 0) : null
    // Variação só faz sentido quando havia base. De 0 para 500 não é "+∞%",
    // é o primeiro mês — a tela mostra "—".
    const variacao = anterior && anterior > 0
      ? Math.round(((atual - anterior) / anterior) * 1000) / 10
      : null
    return {
      chave: j.chave, label: j.label, mes: j.m, ano: j.a,
      total: Math.round(atual * 100) / 100,
      lancamentos: mapaMes.get(j.chave)?.lancamentos ?? 0,
      variacao_pct: variacao,
      variacao_valor: anterior !== null ? Math.round((atual - anterior) * 100) / 100 : null,
      comprometimento_pct: limiteTotalSomado > 0
        ? Math.round((atual / limiteTotalSomado) * 100) : null,
    }
  })

  // Empilhamento por cartão
  const porCartao = new Map<number, any>()
  for (const r of (porCartaoMes.results as any[] || [])) {
    const id = Number(r.card_id)
    if (!porCartao.has(id)) porCartao.set(id, { card_id: id, nome: r.cartao, cor: r.cor, meses: {} })
    porCartao.get(id).meses[`${r.ano}-${String(r.mes).padStart(2,'0')}`] = Math.round(Number(r.total) * 100) / 100
  }

  // ── Estatísticas ──────────────────────────────────────────────────────────
  const comValor = serie.filter(s => s.total > 0)
  const mediaGeral = comValor.length ? comValor.reduce((a, s) => a + s.total, 0) / comValor.length : 0
  const ultimos6 = comValor.slice(-6)
  const media6 = ultimos6.length ? ultimos6.reduce((a, s) => a + s.total, 0) / ultimos6.length : 0
  const faturaAtual = serie[serie.length - 1]?.total ?? 0
  const maior = comValor.reduce((mx, s) => (s.total > (mx?.total ?? -1) ? s : mx), null as any)
  const menor = comValor.reduce((mn, s) => (s.total < (mn?.total ?? Infinity) ? s : mn), null as any)

  const futurasLista = (futuras.results as any[] || []).map(r => ({
    chave: `${r.ano}-${String(r.mes).padStart(2,'0')}`,
    label: `${NOMES[Number(r.mes)-1]}/${String(r.ano).slice(2)}`,
    total: Math.round(Number(r.total) * 100) / 100,
    lancamentos: Number(r.lancamentos),
  }))
  const totalComprometido = futurasLista.reduce((a, f) => a + f.total, 0)
  const piorMes = futurasLista.reduce((mx, f) => (f.total > (mx?.total ?? -1) ? f : mx), null as any)

  // ── Leitura em português, para a tela não ser só números ──────────────────
  const reais = emReais
  const leitura: string[] = []
  if (media6 > 0 && faturaAtual > 0) {
    const dif = Math.round(((faturaAtual - media6) / media6) * 100)
    if (dif > 15) leitura.push(`A fatura deste mês está ${dif}% acima da sua média dos últimos 6 meses.`)
    else if (dif < -15) leitura.push(`A fatura deste mês está ${Math.abs(dif)}% abaixo da sua média — bom mês.`)
    else leitura.push('A fatura deste mês está dentro da sua média dos últimos 6 meses.')
  }
  if (limiteTotalSomado > 0) {
    const pct = Math.round((faturaAtual / limiteTotalSomado) * 100)
    if (pct > 30) leitura.push(`Você está usando ${pct}% do limite. Acima de 30% costuma pesar na análise de crédito.`)
  }
  if (piorMes && totalComprometido > 0) {
    leitura.push(`Os próximos meses já têm ${reais(totalComprometido)} em parcelas contratadas — o mês mais pesado é ${piorMes.label}, com ${reais(piorMes.total)}.`)
  }
  const recLista = (recorrentes.results as any[] || [])
  if (recLista.length) {
    // AC6: antes dizia "todo mês" mesmo com 3–4 aparições em 12 meses. Agora
    // fala em "recorrentes" e projeta o anual como hipótese ("se mantidas").
    const anual = recLista.reduce((a, r) => a + Number(r.valor) * 12, 0)
    leitura.push(`${recLista.length} cobrança(s) recorrente(s) no cartão — até ${reais(anual)} por ano se mantidas todos os meses.`)
  }

  return c.json({
    periodo: { meses, de: janela[0].chave, ate: janela[janela.length-1].chave },
    serie,
    por_cartao: [...porCartao.values()],
    cartoes: (cartoesLista.results as any[] || []),
    limite_total_somado: Math.round(limiteTotalSomado * 100) / 100,
    resumo: {
      fatura_atual: Math.round(faturaAtual * 100) / 100,
      media_6m: Math.round(media6 * 100) / 100,
      media_periodo: Math.round(mediaGeral * 100) / 100,
      maior_fatura: maior ? { label: maior.label, total: maior.total } : null,
      menor_fatura: menor ? { label: menor.label, total: menor.total } : null,
      comprometimento_pct: limiteTotalSomado > 0 ? Math.round((faturaAtual / limiteTotalSomado) * 100) : null,
    },
    futuro: {
      meses: futurasLista,
      total_comprometido: Math.round(totalComprometido * 100) / 100,
      pior_mes: piorMes,
    },
    categorias_do_mes: (categorias.results as any[] || []).map(r => ({
      categoria: r.categoria, total: Math.round(Number(r.total) * 100) / 100, qtd: Number(r.qtd),
    })),
    recorrentes: recLista.map(r => ({
      descricao: r.descricao, valor: Math.round(Number(r.valor) * 100) / 100,
      meses: Number(r.meses), custo_anual: Math.round(Number(r.valor) * 12 * 100) / 100,
    })),
    leitura,
  })
})

cartoes.get('/:id/fatura', requireAuth, async (c) => {
  const user    = c.get('user')
  const cardId  = c.req.param('id')
  const now     = new Date()
  const mes     = parseInt(c.req.query('mes')  || String(now.getMonth() + 1))
  const ano     = parseInt(c.req.query('ano')  || String(now.getFullYear()))

  const cartao = await c.env.DB.prepare(
    'SELECT * FROM cartoes WHERE id = ? AND user_id = ?'
  ).bind(cardId, user.id).first() as any
  if (!cartao) return c.json({ error: 'Cartão não encontrado' }, 404)

  // Lançamentos do mês/ano de fatura
  const charges = await c.env.DB.prepare(
    `SELECT cc.*, d.categoria, d.observacoes as obs_despesa
     FROM card_charges cc
     LEFT JOIN despesas d ON d.id = cc.expense_id
     WHERE cc.card_id = ? AND cc.billing_month = ? AND cc.billing_year = ?
     ORDER BY cc.data_compra DESC, cc.parcela_atual ASC`
  ).bind(cardId, mes, ano).all()

  const lista = charges.results as any[]
  const totalFatura   = lista.reduce((s, r) => s + Number(r.valor), 0)
  const totalPago     = lista.filter(r => r.status === 'pago').reduce((s, r) => s + Number(r.valor), 0)
  const totalPendente = totalFatura - totalPago

  // Limite dinâmico (calculado em real-time)
  const usoGlobal = await c.env.DB.prepare(
    `SELECT COALESCE(SUM(valor),0) as total FROM card_charges
     WHERE card_id = ? AND status = 'pendente'`
  ).bind(cardId).first() as any
  const limite_utilizado  = Math.round(Number(usoGlobal?.total || 0) * 100) / 100
  const limite_disponivel = Math.round(Math.max(0, cartao.limite_total - limite_utilizado) * 100) / 100

  // Data de vencimento desta fatura
  const data_vencimento = calcDueDate(mes, ano, cartao.dia_vencimento, cartao.dia_fechamento)

  // Status da fatura: futura / aberta / fechada / paga
  const hoje      = new Date()
  const dataFech  = new Date(`${ano}-${String(mes).padStart(2,'0')}-${String(cartao.dia_fechamento).padStart(2,'0')}`)
  const statusFatura =
    ano > hoje.getFullYear() || (ano === hoje.getFullYear() && mes > hoje.getMonth() + 1) ? 'futura' :
    totalPendente === 0 && lista.length > 0 ? 'paga' :
    hoje > dataFech ? 'fechada' : 'aberta'

  return c.json({
    cartao: {
      ...cartao,
      limite_utilizado,
      limite_disponivel
    },
    fatura: {
      mes, ano,
      data_vencimento,
      total: Math.round(totalFatura * 100) / 100,
      total_pago: Math.round(totalPago * 100) / 100,
      total_pendente: Math.round(totalPendente * 100) / 100,
      status: statusFatura,
      qtd_lancamentos: lista.length
    },
    lancamentos: lista
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/cartoes/:id/compra
// Lança uma compra nova (à vista ou parcelada) com lógica de fechamento correta
// ─────────────────────────────────────────────────────────────────────────────
cartoes.post('/:id/compra', requireAuth, async (c) => {
  const user   = c.get('user')
  const cardId = c.req.param('id')

  const cartao = await c.env.DB.prepare(
    'SELECT * FROM cartoes WHERE id = ? AND user_id = ?'
  ).bind(cardId, user.id).first() as any
  if (!cartao) return c.json({ error: 'Cartão não encontrado' }, 404)

  const { descricao, categoria, valor_total, numero_parcelas = 1,
          data_compra, observacoes, meio_pagamento = 'cartao_credito' } = await c.req.json()

  if (descricao === undefined || categoria === undefined || valor_total === undefined || data_compra === undefined)
    return c.json({ error: 'Campos obrigatórios: descricao, categoria, valor_total, data_compra' }, 400)

  const descricaoValidada = textoObrigatorio(descricao, 'descricao')
  if ('error' in descricaoValidada) return c.json({ error: descricaoValidada.error }, 400)
  const categoriaValidada = textoObrigatorio(categoria, 'categoria', 120)
  if ('error' in categoriaValidada) return c.json({ error: categoriaValidada.error }, 400)
  const valorValidado = numeroPositivo(valor_total, 'valor_total')
  if ('error' in valorValidado) return c.json({ error: valorValidado.error }, 400)
  const parcelasValidadas = inteiroEntre(numero_parcelas, 'numero_parcelas', 1, MAX_PARCELAS_CARTAO)
  if ('error' in parcelasValidadas) return c.json({ error: parcelasValidadas.error }, 400)
  const dataValidada = dataIso(data_compra)
  if ('error' in dataValidada) return c.json({ error: dataValidada.error }, 400)

  const nparcelas    = parcelasValidadas.value
  const valorTotal    = valorValidado.value
  const valorParcela = Math.round((valorTotal / nparcelas) * 100) / 100

  // ── Limite disponível ──────────────────────────────────────────────────────
  // O cartão aceitava qualquer valor: uma compra de R$ 999.999 num limite de
  // R$ 15.000 entrava com 201 e sem aviso, e o "disponível" ficava travado em
  // zero enquanto o percentual de uso ia a 6.687%. Um cartão de verdade recusa.
  const { utilizado, disponivel } = await limiteDisponivelParaCompra(c.env.DB, parseInt(cardId), Number(cartao.limite_total))

  if (valorTotal > disponivel) {
    return c.json({
      error: `Compra de ${emReais(valorTotal)} excede o limite disponível do ${cartao.nome}.`,
      limite_total:      Number(cartao.limite_total),
      limite_utilizado:  utilizado,
      limite_disponivel: Math.max(0, disponivel),
      valor_solicitado:  valorTotal,
    }, 422)
  }
  const groupId      = uuid()
  const chargeIds: number[] = []
  const despesaIds:  number[] = []

  for (let i = 1; i <= nparcelas; i++) {
    // Data da compra desta parcela: mês i-1 após a data original
    const parcelaDate = new Date(dataValidada.value + 'T12:00:00')
    parcelaDate.setMonth(parcelaDate.getMonth() + (i - 1))
    const parcelaDateStr = parcelaDate.toISOString().split('T')[0]

    // Período de faturamento calculado pelo fechamento do cartão
    const { month: bMonth, year: bYear } = calcBillingPeriod(parcelaDateStr, cartao.dia_fechamento)
    const dataVenc = calcDueDate(bMonth, bYear, cartao.dia_vencimento, cartao.dia_fechamento)
    const descParcela = nparcelas > 1 ? `${descricaoValidada.value} (${i}/${nparcelas})` : descricaoValidada.value

    // CORREÇÃO: campo 'data' deve ser dataVenc (data de vencimento da fatura),
    // não parcelaDateStr (data da compra). Isso garante que a despesa aparece
    // no mês correto na tela de Despesas (que filtra por 'data').
    // parcelaDateStr é preservado apenas no card_charges.data_compra.
    const despesaData = dataVenc

    // 1. Criar despesa
    const dr = await c.env.DB.prepare(
      `INSERT INTO despesas (user_id, descricao, data, categoria, valor, parcelado,
       numero_parcelas, parcela_atual, status, fixa_ou_variavel, vencimento,
       observacoes, cartao_id, meio_pagamento, billing_month, billing_year, purchase_group_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pendente', 'variavel', ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      user.id, descParcela, despesaData, categoriaValidada.value,
      valorParcela, nparcelas > 1 ? 1 : 0, nparcelas, i,
      dataVenc, textoOpcional(observacoes), parseInt(cardId), meio_pagamento,
      bMonth, bYear, groupId
    ).run()
    despesaIds.push(dr.meta.last_row_id as number)

    // 2. Criar card_charge vinculado
    const cr = await c.env.DB.prepare(
      `INSERT INTO card_charges (card_id, expense_id, descricao, valor, data_compra,
       data_vencimento, billing_month, billing_year, parcela_atual, total_parcelas,
       purchase_group_id, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pendente')`
    ).bind(
      parseInt(cardId), dr.meta.last_row_id, descParcela, valorParcela,
      parcelaDateStr, dataVenc, bMonth, bYear,
      nparcelas > 1 ? i : null, nparcelas > 1 ? nparcelas : null, groupId
    ).run()
    chargeIds.push(cr.meta.last_row_id as number)
  }

  return c.json({
    success: true,
    purchase_group_id: groupId,
    despesa_ids: despesaIds,
    charge_ids: chargeIds,
    parcelas: nparcelas,
    message: nparcelas > 1 ? `${nparcelas} parcelas lançadas na fatura correta!` : 'Compra lançada na fatura!'
  }, 201)
})

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/cartoes/:id/compra-retroativa
// Cadastra compra já em andamento (ex: 10x feita em Jan, estamos em Mar → 8 restantes)
// ─────────────────────────────────────────────────────────────────────────────
cartoes.post('/:id/compra-retroativa', requireAuth, async (c) => {
  const user   = c.get('user')
  const cardId = c.req.param('id')

  const cartao = await c.env.DB.prepare(
    'SELECT * FROM cartoes WHERE id = ? AND user_id = ?'
  ).bind(cardId, user.id).first() as any
  if (!cartao) return c.json({ error: 'Cartão não encontrado' }, 404)

  const { descricao, categoria, valor_total, numero_parcelas,
          parcelas_pagas = 0, data_compra, observacoes } = await c.req.json()

  if (descricao === undefined || categoria === undefined || valor_total === undefined || numero_parcelas === undefined || data_compra === undefined)
    return c.json({ error: 'Campos obrigatórios: descricao, categoria, valor_total, numero_parcelas, data_compra' }, 400)

  const descricaoValidada = textoObrigatorio(descricao, 'descricao')
  if ('error' in descricaoValidada) return c.json({ error: descricaoValidada.error }, 400)
  const categoriaValidada = textoObrigatorio(categoria, 'categoria', 120)
  if ('error' in categoriaValidada) return c.json({ error: categoriaValidada.error }, 400)
  const valorValidado = numeroPositivo(valor_total, 'valor_total')
  if ('error' in valorValidado) return c.json({ error: valorValidado.error }, 400)
  const parcelasValidadas = inteiroEntre(numero_parcelas, 'numero_parcelas', 2, MAX_PARCELAS_CARTAO)
  if ('error' in parcelasValidadas) return c.json({ error: parcelasValidadas.error }, 400)
  const pagasValidadas = inteiroEntre(parcelas_pagas, 'parcelas_pagas', 0, parcelasValidadas.value - 1)
  if ('error' in pagasValidadas) return c.json({ error: pagasValidadas.error }, 400)
  const dataValidada = dataIso(data_compra)
  if ('error' in dataValidada) return c.json({ error: dataValidada.error }, 400)

  const nparcelas      = parcelasValidadas.value
  const jaPagas        = pagasValidadas.value
  const parcelasRest   = nparcelas - jaPagas

  if (parcelasRest <= 0)
    return c.json({ error: 'Todas as parcelas já foram pagas' }, 400)

  const valorTotal = valorValidado.value
  const valorParcela = Math.round((valorTotal / nparcelas) * 100) / 100
  const valorPendenteProjetado = Math.round(valorParcela * parcelasRest * 100) / 100
  const { utilizado, disponivel } = await limiteDisponivelParaCompra(c.env.DB, parseInt(cardId), Number(cartao.limite_total))
  if (valorPendenteProjetado > disponivel) {
    return c.json({
      error: `Parcelas pendentes de ${emReais(valorPendenteProjetado)} excedem o limite disponível do ${cartao.nome}.`,
      limite_total: Number(cartao.limite_total),
      limite_utilizado: utilizado,
      limite_disponivel: Math.max(0, disponivel),
      valor_solicitado: valorPendenteProjetado,
    }, 422)
  }
  const groupId      = uuid()
  const chargeIds: number[] = []
  const despesaIds:  number[] = []

  // Gerar TODAS as parcelas:
  // - Parcelas passadas (já pagas): status='pago', sem afetar limite
  // - Parcelas restantes: status='pendente', afetam limite
  for (let i = 1; i <= nparcelas; i++) {
    const parcelaDate = new Date(dataValidada.value + 'T12:00:00')
    parcelaDate.setMonth(parcelaDate.getMonth() + (i - 1))
    const parcelaDateStr = parcelaDate.toISOString().split('T')[0]

    const { month: bMonth, year: bYear } = calcBillingPeriod(parcelaDateStr, cartao.dia_fechamento)
    const dataVenc    = calcDueDate(bMonth, bYear, cartao.dia_vencimento, cartao.dia_fechamento)
    const isPaid      = i <= jaPagas
    const statusParcela = isPaid ? 'pago' : 'pendente'
    const descParcela = `${descricaoValidada.value} (${i}/${nparcelas})`

    // CORREÇÃO: campo 'data' deve ser dataVenc (vencimento da fatura),
    // para que a despesa apareça no mês correto na tela de Despesas.
    const despesaDataRetro = dataVenc

    const dr = await c.env.DB.prepare(
      `INSERT INTO despesas (user_id, descricao, data, categoria, valor, parcelado,
       numero_parcelas, parcela_atual, status, fixa_ou_variavel, vencimento,
       observacoes, cartao_id, meio_pagamento, billing_month, billing_year, purchase_group_id)
       VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, 'variavel', ?, ?, ?, 'cartao_credito', ?, ?, ?)`
    ).bind(
      user.id, descParcela, despesaDataRetro, categoriaValidada.value,
      valorParcela, nparcelas, i, statusParcela,
      dataVenc,
      textoOpcional(observacoes) ? `[Retroativo] ${textoOpcional(observacoes)}` : '[Retroativo]',
      parseInt(cardId), bMonth, bYear, groupId
    ).run()
    despesaIds.push(dr.meta.last_row_id as number)

    const cr = await c.env.DB.prepare(
      `INSERT INTO card_charges (card_id, expense_id, descricao, valor, data_compra,
       data_vencimento, billing_month, billing_year, parcela_atual, total_parcelas,
       purchase_group_id, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      parseInt(cardId), dr.meta.last_row_id, descParcela, valorParcela,
      parcelaDateStr, dataVenc, bMonth, bYear, i, nparcelas, groupId, statusParcela
    ).run()
    chargeIds.push(cr.meta.last_row_id as number)
  }

  const valorPendente = valorParcela * parcelasRest
  return c.json({
    success: true,
    purchase_group_id: groupId,
    despesa_ids:   despesaIds,
    charge_ids:    chargeIds,
    parcelas_total:     nparcelas,
    parcelas_pagas:     jaPagas,
    parcelas_pendentes: parcelasRest,
    valor_pendente:     valorPendente,
    message: `Compra retroativa registrada! ${jaPagas} já pagas + ${parcelasRest} pendentes distribuídas nas faturas corretas.`
  }, 201)
})

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/cartoes/charges/:id/pagar — Baixa unificada (atualiza despesa E charge)
// ─────────────────────────────────────────────────────────────────────────────
cartoes.patch('/charges/:id/pagar', requireAuth, async (c) => {
  const user     = c.get('user')
  const chargeId = c.req.param('id')

  // Buscar charge validando propriedade via JOIN com cartoes
  const charge = await c.env.DB.prepare(
    `SELECT cc.* FROM card_charges cc
     INNER JOIN cartoes ca ON ca.id = cc.card_id AND ca.user_id = ?
     WHERE cc.id = ?`
  ).bind(user.id, chargeId).first() as any
  if (!charge)  return c.json({ error: 'Lançamento não encontrado' }, 404)
  if (charge.status === 'pago') return c.json({ error: 'Lançamento já pago' }, 400)

  // 1. Marcar charge como pago
  await c.env.DB.prepare(
    "UPDATE card_charges SET status = 'pago' WHERE id = ?"
  ).bind(chargeId).run()

  // 2. Marcar despesa vinculada como paga (se existir)
  if (charge.expense_id) {
    await c.env.DB.prepare(
      "UPDATE despesas SET status = 'pago' WHERE id = ? AND user_id = ?"
    ).bind(charge.expense_id, user.id).run()
  }

  await verificarConquista(c.env.DB, user.id, 'zero_divida_cartao')
  return c.json({ success: true, message: 'Parcela paga! Limite restaurado.' })
})

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/cartoes/:id/pagar-fatura — Paga TODA a fatura de um mês
// ─────────────────────────────────────────────────────────────────────────────
cartoes.patch('/:id/pagar-fatura', requireAuth, async (c) => {
  const user   = c.get('user')
  const cardId = c.req.param('id')
  const { mes, ano } = await c.req.json()
  if (!mes || !ano) return c.json({ error: 'Informe mes e ano' }, 400)

  const cartao = await c.env.DB.prepare(
    'SELECT * FROM cartoes WHERE id = ? AND user_id = ?'
  ).bind(cardId, user.id).first() as any
  if (!cartao) return c.json({ error: 'Cartão não encontrado' }, 404)

  // Buscar todos os charges pendentes da fatura
  const pendentes = await c.env.DB.prepare(
    `SELECT cc.* FROM card_charges cc WHERE cc.card_id = ? AND cc.billing_month = ?
     AND cc.billing_year = ? AND cc.status = 'pendente'`
  ).bind(cardId, mes, ano).all()

  if ((pendentes.results as any[]).length === 0)
    return c.json({ error: 'Nenhuma parcela pendente nesta fatura' }, 400)

  const totalPago = (pendentes.results as any[]).reduce((s, r) => s + Number(r.valor), 0)

  // Atualizar todos de uma vez
  for (const ch of pendentes.results as any[]) {
    await c.env.DB.prepare("UPDATE card_charges SET status = 'pago' WHERE id = ?").bind(ch.id).run()
    if (ch.expense_id) {
      await c.env.DB.prepare("UPDATE despesas SET status = 'pago' WHERE id = ?").bind(ch.expense_id).run()
    }
  }

  await verificarConquista(c.env.DB, user.id, 'fatura_em_dia')
  return c.json({
    success: true,
    parcelas_pagas: (pendentes.results as any[]).length,
    total_pago: Math.round(totalPago * 100) / 100,
    message: `Fatura paga! ${(pendentes.results as any[]).length} lançamento(s) quitado(s).`
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/cartoes/:id/pendente-fatura — Reverte TODA a fatura de um mês para pendente
// ─────────────────────────────────────────────────────────────────────────────
cartoes.patch('/:id/pendente-fatura', requireAuth, async (c) => {
  const user   = c.get('user')
  const cardId = c.req.param('id')
  const { mes, ano } = await c.req.json()
  if (!mes || !ano) return c.json({ error: 'Informe mes e ano' }, 400)

  const cartao = await c.env.DB.prepare(
    'SELECT * FROM cartoes WHERE id = ? AND user_id = ?'
  ).bind(cardId, user.id).first() as any
  if (!cartao) return c.json({ error: 'Cartão não encontrado' }, 404)

  // Buscar todos os charges pagos/cancelados da fatura
  const charges = await c.env.DB.prepare(
    `SELECT cc.*, d.status as despesa_status FROM card_charges cc
     LEFT JOIN despesas d ON d.id = cc.expense_id
     WHERE cc.card_id = ? AND cc.billing_month = ? AND cc.billing_year = ?
       AND cc.status IN ('pago', 'cancelado')`
  ).bind(cardId, mes, ano).all()

  const lista = charges.results as any[]
  if (lista.length === 0)
    return c.json({ error: 'Nenhum lançamento pago/cancelado nesta fatura' }, 400)

  const totalRevertido = lista
    .filter(r => r.status === 'pago')
    .reduce((s, r) => s + Number(r.valor), 0)

  for (const ch of lista) {
    // Reverter charge
    await c.env.DB.prepare(
      "UPDATE card_charges SET status = 'pendente' WHERE id = ?"
    ).bind(ch.id).run()
    // Reverter despesa vinculada
    if (ch.expense_id) {
      await c.env.DB.prepare(
        "UPDATE despesas SET status = 'pendente', data_pagamento = NULL WHERE id = ? AND user_id = ?"
      ).bind(ch.expense_id, user.id).run()
    }
  }

  if (totalRevertido > 0) {
  }

  return c.json({
    success: true,
    revertidos: lista.length,
    message: `${lista.length} lançamento(s) revertido(s) para pendente.`
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/cartoes/:id/compras — lista compras agrupadas por purchase_group_id
// ─────────────────────────────────────────────────────────────────────────────
cartoes.get('/:id/compras', requireAuth, async (c) => {
  const user   = c.get('user')
  const cardId = c.req.param('id')

  const cartao = await c.env.DB.prepare('SELECT id FROM cartoes WHERE id = ? AND user_id = ?').bind(cardId, user.id).first()
  if (!cartao) return c.json({ error: 'Cartão não encontrado' }, 404)

  const charges = await c.env.DB.prepare(
    `SELECT * FROM card_charges WHERE card_id = ?
     ORDER BY data_compra DESC, parcela_atual ASC`
  ).bind(cardId).all()

  // Agrupar por purchase_group_id (ou por descricao se não tiver grupo)
  const grupos: Record<string, any> = {}
  for (const ch of charges.results as any[]) {
    const key = ch.purchase_group_id || `solo_${ch.id}`
    if (!grupos[key]) {
      const descBase = (ch.descricao || '').replace(/\s*\(\d+\/\d+\)$/, '')
      grupos[key] = {
        purchase_group_id: ch.purchase_group_id,
        descricao: descBase,
        valor_parcela: Number(ch.valor),
        total_parcelas: ch.total_parcelas || 1,
        data_compra: ch.data_compra,
        parcelas: [], pagas: 0, pendentes: 0
      }
    }
    grupos[key].parcelas.push(ch)
    if (ch.status === 'pago') grupos[key].pagas++
    else grupos[key].pendentes++
  }

  const compras = Object.values(grupos).map((g: any) => ({
    ...g,
    valor_total_compra: Math.round(g.valor_parcela * g.total_parcelas * 100) / 100
  })).sort((a: any, b: any) =>
    new Date(b.data_compra).getTime() - new Date(a.data_compra).getTime()
  )

  return c.json({ compras })
})

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/cartoes/compras/:groupId — remove grupo de parcelas
// ─────────────────────────────────────────────────────────────────────────────
cartoes.delete('/compras/:groupId', requireAuth, async (c) => {
  const user    = c.get('user')
  const groupId = c.req.param('groupId')

  // Confirmar que pelo menos um charge pertence ao usuário
  const chk = await c.env.DB.prepare(
    `SELECT cc.* FROM card_charges cc
     INNER JOIN cartoes ca ON ca.id = cc.card_id AND ca.user_id = ?
     WHERE cc.purchase_group_id = ? LIMIT 1`
  ).bind(user.id, groupId).first() as any
  if (!chk) return c.json({ error: 'Compra não encontrada' }, 404)

  // Valor pendente para restaurar limite
  const pendValue = await c.env.DB.prepare(
    `SELECT COALESCE(SUM(cc.valor),0) as total FROM card_charges cc
     WHERE cc.purchase_group_id = ? AND cc.status = 'pendente'`
  ).bind(groupId).first() as any

  // Apagar charges (despesas ficam via ON DELETE SET NULL em expense_id)
  await c.env.DB.prepare(
    'DELETE FROM card_charges WHERE purchase_group_id = ?'
  ).bind(groupId).run()

  // Apagar despesas do grupo
  await c.env.DB.prepare(
    'DELETE FROM despesas WHERE purchase_group_id = ? AND user_id = ?'
  ).bind(groupId, user.id).run()

  if (Number(pendValue?.total) > 0) {
  }

  return c.json({ success: true, message: 'Compra e parcelas removidas!' })
})

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/cartoes/compras/:groupId — editar nome/valor de compra parcelada
// ─────────────────────────────────────────────────────────────────────────────
cartoes.patch('/compras/:groupId', requireAuth, async (c) => {
  const user    = c.get('user')
  const groupId = c.req.param('groupId')

  const chk = await c.env.DB.prepare(
    `SELECT cc.*, ca.user_id FROM card_charges cc
     INNER JOIN cartoes ca ON ca.id = cc.card_id AND ca.user_id = ?
     WHERE cc.purchase_group_id = ? LIMIT 1`
  ).bind(user.id, groupId).first() as any
  if (!chk) return c.json({ error: 'Compra não encontrada' }, 404)

  const body = await c.req.json()
  const { descricao, valor_parcela } = body

  if (!descricao && !valor_parcela) {
    return c.json({ error: 'Informe pelo menos descricao ou valor_parcela' }, 400)
  }

  if (descricao) {
    // Atualizar descrição em todos os charges do grupo
    await c.env.DB.prepare(
      `UPDATE card_charges SET descricao = ? WHERE purchase_group_id = ?`
    ).bind(descricao, groupId).run()
    // Atualizar despesas vinculadas também
    await c.env.DB.prepare(
      `UPDATE despesas SET descricao = ? WHERE purchase_group_id = ? AND user_id = ?`
    ).bind(descricao, groupId, user.id).run()
  }

  if (valor_parcela) {
    const vp = parseFloat(valor_parcela)
    if (isNaN(vp) || vp <= 0) return c.json({ error: 'Valor inválido' }, 400)
    // Atualizar apenas parcelas pendentes
    await c.env.DB.prepare(
      `UPDATE card_charges SET valor = ? WHERE purchase_group_id = ? AND status = 'pendente'`
    ).bind(vp, groupId).run()
    await c.env.DB.prepare(
      `UPDATE despesas SET valor = ? WHERE purchase_group_id = ? AND user_id = ? AND status = 'pendente'`
    ).bind(vp, groupId, user.id).run()
  }

  return c.json({ success: true, message: 'Compra atualizada!' })
})

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/cartoes/compras/:groupId/tags — vincular tags a todas as despesas do grupo
// ─────────────────────────────────────────────────────────────────────────────
cartoes.post('/compras/:groupId/tags', requireAuth, async (c) => {
  const user    = c.get('user')
  const groupId = c.req.param('groupId')

  const chk = await c.env.DB.prepare(
    `SELECT d.id FROM despesas d
     INNER JOIN cartoes ca ON ca.id = d.cartao_id AND ca.user_id = ?
     WHERE d.purchase_group_id = ? LIMIT 1`
  ).bind(user.id, groupId).first() as any
  if (!chk) return c.json({ error: 'Compra não encontrada' }, 404)

  const { tag_ids } = await c.req.json()
  if (!Array.isArray(tag_ids)) return c.json({ error: 'tag_ids deve ser um array' }, 400)

  // Buscar todas as despesas do grupo
  const despesas = await c.env.DB.prepare(
    `SELECT id FROM despesas WHERE purchase_group_id = ? AND user_id = ?`
  ).bind(groupId, user.id).all<any>()

  const despIds = (despesas.results || []).map((d: any) => d.id)
  if (despIds.length === 0) return c.json({ error: 'Nenhuma despesa encontrada' }, 404)

  // Para cada despesa, substituir as tags
  for (const despId of despIds) {
    // Remover tags existentes
    await c.env.DB.prepare(
      `DELETE FROM despesa_tags WHERE despesa_id = ?`
    ).bind(despId).run()
    // Inserir novas tags
    for (const tagId of tag_ids) {
      await c.env.DB.prepare(
        `INSERT OR IGNORE INTO despesa_tags (despesa_id, tag_id) VALUES (?, ?)`
      ).bind(despId, tagId).run().catch(() => {})
    }
  }

  return c.json({ success: true, despesas_atualizadas: despIds.length, message: 'Tags aplicadas em todas as parcelas!' })
})

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/cartoes/:id/limite — S-C4: ajuste manual de limite disponível
// Permite ao usuário sincronizar o limite disponível com o banco real
// ─────────────────────────────────────────────────────────────────────────────
cartoes.patch('/:id/limite', requireAuth, async (c) => {
  const user = c.get('user')
  const id   = c.req.param('id')

  const cartao = await c.env.DB.prepare(
    'SELECT * FROM cartoes WHERE id = ? AND user_id = ? AND ativo = 1'
  ).bind(id, user.id).first() as any
  if (!cartao) return c.json({ error: 'Cartão não encontrado' }, 404)

  // ── Ajuste manual do limite DISPONÍVEL ────────────────────────────────────
  // Este endpoint gravava um valor arbitrário em `cartoes.limite_disponivel`.
  // Agora que o disponível é derivado das faturas em aberto, não existe mais
  // "ajustar o disponível": ele é uma consequência, não um dado.
  //
  // Escrever ali de novo recriaria a divergência que acabamos de eliminar —
  // por isso o endpoint recusa e explica o que fazer no lugar. A rota
  // continua existindo (em vez de sumir com 404) para que a tela antiga
  // receba uma mensagem clara em vez de um erro seco.
  const atual = await limiteDoCartao(c.env.DB, cartao.id, cartao.limite_total)
  return c.json({
    error: 'O limite disponível é calculado a partir das faturas em aberto e não pode ser digitado.',
    como_resolver: [
      'Para mudar o limite do cartão, edite o limite total do cartão.',
      'Para liberar limite, pague ou exclua os lançamentos em aberto.',
    ],
    ...atual,
  }, 409)
})

// ─────────────────────────────────────────────────────────────────────────────
// Endpoints legacy (mantidos para compatibilidade com frontend antigo)
// ─────────────────────────────────────────────────────────────────────────────

// GET /api/cartoes/:id/lancamentos (mapeia para fatura)
cartoes.get('/:id/lancamentos', requireAuth, async (c) => {
  const user   = c.get('user')
  const id     = c.req.param('id')
  const now    = new Date()
  const periodo = mesAnoValidos(c.req.query('mes') || String(now.getMonth() + 1), c.req.query('ano') || String(now.getFullYear()))
  if ('error' in periodo) return c.json({ error: periodo.error }, 400)
  const mes    = periodo.mes
  const ano    = periodo.ano

  // Verificar posse do cartão antes de retornar dados (segurança)
  const cartao = await c.env.DB.prepare(
    'SELECT id FROM cartoes WHERE id = ? AND user_id = ? AND ativo = 1'
  ).bind(id, user.id).first()
  if (!cartao) return c.json({ error: 'Cartão não encontrado' }, 404)

  const charges = await c.env.DB.prepare(
    `SELECT cc.*, d.categoria, d.observacoes as obs_despesa
     FROM card_charges cc
     LEFT JOIN despesas d ON d.id = cc.expense_id
     WHERE cc.card_id = ? AND cc.billing_month = ? AND cc.billing_year = ?
     ORDER BY cc.data_compra DESC`
  ).bind(id, mes, ano).all()

  const total = (charges.results as any[]).reduce((s, r) => s + Number(r.valor), 0)
  return c.json({ lancamentos: charges.results, total_fatura: total })
})

// POST /api/cartoes/:id/lancamentos (redireciona para /compra)
cartoes.post('/:id/lancamentos', requireAuth, async (c) => {
  const user   = c.get('user')
  const cardId = c.req.param('id')

  const cartao = await c.env.DB.prepare(
    'SELECT * FROM cartoes WHERE id = ? AND user_id = ?'
  ).bind(cardId, user.id).first() as any
  if (!cartao) return c.json({ error: 'Cartão não encontrado' }, 404)

  const { descricao, categoria, valor_total, numero_parcelas = 1, data_compra, observacoes } = await c.req.json()
  if (descricao === undefined || categoria === undefined || valor_total === undefined || data_compra === undefined)
    return c.json({ error: 'Campos obrigatórios faltando' }, 400)

  const descricaoValidada = textoObrigatorio(descricao, 'descricao')
  if ('error' in descricaoValidada) return c.json({ error: descricaoValidada.error }, 400)
  const categoriaValidada = textoObrigatorio(categoria, 'categoria', 120)
  if ('error' in categoriaValidada) return c.json({ error: categoriaValidada.error }, 400)
  const valorValidado = numeroPositivo(valor_total, 'valor_total')
  if ('error' in valorValidado) return c.json({ error: valorValidado.error }, 400)
  const parcelasValidadas = inteiroEntre(numero_parcelas, 'numero_parcelas', 1, MAX_PARCELAS_CARTAO)
  if ('error' in parcelasValidadas) return c.json({ error: parcelasValidadas.error }, 400)
  const dataValidada = dataIso(data_compra)
  if ('error' in dataValidada) return c.json({ error: dataValidada.error }, 400)

  const nparcelas    = parcelasValidadas.value
  const valorTotal    = valorValidado.value
  const valorParcela = Math.round((valorTotal / nparcelas) * 100) / 100
  const { utilizado, disponivel } = await limiteDisponivelParaCompra(c.env.DB, parseInt(cardId), Number(cartao.limite_total))
  if (valorTotal > disponivel) {
    return c.json({
      error: `Compra de ${emReais(valorTotal)} excede o limite disponível do ${cartao.nome}.`,
      limite_total: Number(cartao.limite_total),
      limite_utilizado: utilizado,
      limite_disponivel: Math.max(0, disponivel),
      valor_solicitado: valorTotal,
    }, 422)
  }
  const groupId      = uuid()
  const ids: number[] = []

  for (let i = 1; i <= nparcelas; i++) {
    const parcelaDate = new Date(dataValidada.value + 'T12:00:00')
    parcelaDate.setMonth(parcelaDate.getMonth() + (i - 1))
    const parcelaDateStr = parcelaDate.toISOString().split('T')[0]
    const { month: bMonth, year: bYear } = calcBillingPeriod(parcelaDateStr, cartao.dia_fechamento)
    const dataVenc = calcDueDate(bMonth, bYear, cartao.dia_vencimento, cartao.dia_fechamento)
    const desc     = nparcelas > 1 ? `${descricaoValidada.value} (${i}/${nparcelas})` : descricaoValidada.value

    const dr = await c.env.DB.prepare(
      `INSERT INTO despesas (user_id, descricao, data, categoria, valor, parcelado,
       numero_parcelas, parcela_atual, status, fixa_ou_variavel, vencimento,
       observacoes, cartao_id, meio_pagamento, billing_month, billing_year, purchase_group_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pendente', 'variavel', ?, ?, ?, 'cartao_credito', ?, ?, ?)`
    ).bind(user.id, desc, dataVenc, categoriaValidada.value, valorParcela,
      nparcelas > 1 ? 1 : 0, nparcelas, i, dataVenc, observacoes || null,
      parseInt(cardId), bMonth, bYear, groupId).run()

    await c.env.DB.prepare(
      `INSERT INTO card_charges (card_id, expense_id, descricao, valor, data_compra,
       data_vencimento, billing_month, billing_year, parcela_atual, total_parcelas,
       purchase_group_id, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pendente')`
    ).bind(parseInt(cardId), dr.meta.last_row_id, desc, valorParcela,
      parcelaDateStr, dataVenc, bMonth, bYear,
      nparcelas > 1 ? i : null, nparcelas > 1 ? nparcelas : null, groupId).run()

    ids.push(dr.meta.last_row_id as number)
  }

  return c.json({ success: true, ids, parcelas: nparcelas,
    message: nparcelas > 1 ? `${nparcelas} parcelas lançadas!` : 'Compra lançada!' }, 201)
})

// POST /api/cartoes/:id/lancamentos-retroativos (legacy)
cartoes.post('/:id/lancamentos-retroativos', requireAuth, async (c) => {
  // Redireciona para o novo endpoint
  c.req.param  // manter compatibilidade
  const user   = c.get('user')
  const cardId = c.req.param('id')
  const body   = await c.req.json()
  const { descricao, categoria, valor_total, numero_parcelas, parcelas_pagas = 0, data_compra, observacoes } = body

  const cartao = await c.env.DB.prepare('SELECT * FROM cartoes WHERE id = ? AND user_id = ?').bind(cardId, user.id).first() as any
  if (!cartao) return c.json({ error: 'Cartão não encontrado' }, 404)

  if (descricao === undefined || categoria === undefined || valor_total === undefined || numero_parcelas === undefined || data_compra === undefined)
    return c.json({ error: 'Campos obrigatórios: descricao, categoria, valor_total, numero_parcelas, data_compra' }, 400)

  const descricaoValidada = textoObrigatorio(descricao, 'descricao')
  if ('error' in descricaoValidada) return c.json({ error: descricaoValidada.error }, 400)
  const categoriaValidada = textoObrigatorio(categoria, 'categoria', 120)
  if ('error' in categoriaValidada) return c.json({ error: categoriaValidada.error }, 400)
  const valorValidado = numeroPositivo(valor_total, 'valor_total')
  if ('error' in valorValidado) return c.json({ error: valorValidado.error }, 400)
  const parcelasValidadas = inteiroEntre(numero_parcelas, 'numero_parcelas', 2, MAX_PARCELAS_CARTAO)
  if ('error' in parcelasValidadas) return c.json({ error: parcelasValidadas.error }, 400)
  const pagasValidadas = inteiroEntre(parcelas_pagas, 'parcelas_pagas', 0, parcelasValidadas.value - 1)
  if ('error' in pagasValidadas) return c.json({ error: pagasValidadas.error }, 400)
  const dataValidada = dataIso(data_compra)
  if ('error' in dataValidada) return c.json({ error: dataValidada.error }, 400)

  const nparcelas    = parcelasValidadas.value
  const jaPagas      = pagasValidadas.value
  const parcelasRest = nparcelas - jaPagas
  if (parcelasRest <= 0) return c.json({ error: 'Todas as parcelas já foram pagas' }, 400)

  const valorParcela = Math.round((valorValidado.value / nparcelas) * 100) / 100
  const valorPendenteProjetado = Math.round(valorParcela * parcelasRest * 100) / 100
  const { utilizado, disponivel } = await limiteDisponivelParaCompra(c.env.DB, parseInt(cardId), Number(cartao.limite_total))
  if (valorPendenteProjetado > disponivel) {
    return c.json({
      error: `Parcelas pendentes de ${emReais(valorPendenteProjetado)} excedem o limite disponível do ${cartao.nome}.`,
      limite_total: Number(cartao.limite_total),
      limite_utilizado: utilizado,
      limite_disponivel: Math.max(0, disponivel),
      valor_solicitado: valorPendenteProjetado,
    }, 422)
  }
  const groupId      = uuid()
  const ids: number[] = []

  for (let i = 1; i <= nparcelas; i++) {
    const parcelaDate = new Date(dataValidada.value + 'T12:00:00')
    parcelaDate.setMonth(parcelaDate.getMonth() + (i - 1))
    const parcelaDateStr = parcelaDate.toISOString().split('T')[0]
    const { month: bMonth, year: bYear } = calcBillingPeriod(parcelaDateStr, cartao.dia_fechamento)
    const dataVenc   = calcDueDate(bMonth, bYear, cartao.dia_vencimento, cartao.dia_fechamento)
    const isPaid     = i <= jaPagas
    const desc       = `${descricaoValidada.value} (${i}/${nparcelas})`

    const dr = await c.env.DB.prepare(
      `INSERT INTO despesas (user_id, descricao, data, categoria, valor, parcelado,
       numero_parcelas, parcela_atual, status, fixa_ou_variavel, vencimento,
       observacoes, cartao_id, meio_pagamento, billing_month, billing_year, purchase_group_id)
       VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, 'variavel', ?, ?, ?, 'cartao_credito', ?, ?, ?)`
    ).bind(user.id, desc, dataVenc, categoriaValidada.value, valorParcela, nparcelas, i,
      isPaid ? 'pago' : 'pendente', dataVenc,
      textoOpcional(observacoes) ? `[Retroativo] ${textoOpcional(observacoes)}` : '[Retroativo]',
      parseInt(cardId), bMonth, bYear, groupId).run()

    await c.env.DB.prepare(
      `INSERT INTO card_charges (card_id, expense_id, descricao, valor, data_compra,
       data_vencimento, billing_month, billing_year, parcela_atual, total_parcelas,
       purchase_group_id, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(parseInt(cardId), dr.meta.last_row_id, desc, valorParcela,
      parcelaDateStr, dataVenc, bMonth, bYear, i, nparcelas, groupId,
      isPaid ? 'pago' : 'pendente').run()

    ids.push(dr.meta.last_row_id as number)
  }

  const valorPendente = valorParcela * parcelasRest
  return c.json({
    success: true, ids, parcelas_restantes: parcelasRest,
    valor_total_restante: valorPendente,
    message: `${parcelasRest} parcela(s) pendentes registradas! (${jaPagas}/${nparcelas} já pagas)`
  }, 201)
})

// PATCH /api/cartoes/lancamentos/:id/status (legacy → sincroniza charge E despesa)
cartoes.patch('/lancamentos/:id/status', requireAuth, async (c) => {
  const user   = c.get('user')
  const id     = c.req.param('id')
  const { status } = await c.req.json()

  const STATUS_VALIDOS = ['pendente', 'pago', 'cancelado']
  if (!status || !STATUS_VALIDOS.includes(status))
    return c.json({ error: `Status inválido. Use: ${STATUS_VALIDOS.join(', ')}` }, 400)

  // Tentar pelo charge_id primeiro
  const charge = await c.env.DB.prepare(
    `SELECT cc.* FROM card_charges cc
     INNER JOIN cartoes ca ON ca.id = cc.card_id AND ca.user_id = ?
     WHERE cc.id = ?`
  ).bind(user.id, id).first() as any

  if (charge) {
    await c.env.DB.prepare("UPDATE card_charges SET status = ? WHERE id = ?").bind(status, id).run()
    if (charge.expense_id) {
      await c.env.DB.prepare("UPDATE despesas SET status = ? WHERE id = ?").bind(status, charge.expense_id).run()
    }
    if (status === 'pago') {
      await verificarConquista(c.env.DB, user.id, 'zero_divida_cartao')
    }
    return c.json({ success: true })
  }
  return c.json({ error: 'Lançamento não encontrado' }, 404)
})

// DELETE /api/cartoes/lancamentos/:id (legacy)
cartoes.delete('/lancamentos/:id', requireAuth, async (c) => {
  const user = c.get('user')
  const id   = c.req.param('id')

  const charge = await c.env.DB.prepare(
    `SELECT cc.* FROM card_charges cc
     INNER JOIN cartoes ca ON ca.id = cc.card_id AND ca.user_id = ?
     WHERE cc.id = ?`
  ).bind(user.id, id).first() as any

  if (charge) {
    if (charge.status === 'pendente') {
    }
    await c.env.DB.prepare('DELETE FROM card_charges WHERE id = ?').bind(id).run()
    if (charge.expense_id) {
      await c.env.DB.prepare('DELETE FROM despesas WHERE id = ? AND user_id = ?').bind(charge.expense_id, user.id).run()
    }
    return c.json({ success: true, message: 'Lançamento removido!' })
  }
  return c.json({ error: 'Lançamento não encontrado' }, 404)
})

// ─────────────────────────────────────────────────────────────────────────────
async function verificarConquista(db: D1Database, userId: number, codigo: string) {
  try {
    await db.prepare(
      'INSERT OR IGNORE INTO conquistas_usuario (user_id, conquista_codigo, visualizado) VALUES (?, ?, 0)'
    ).bind(userId, codigo).run()
  } catch { /* ignora */ }
}

// ─── POST /api/cartoes/sincronizar-despesas ── sincroniza despesas existentes ─
// Garante que despesas de cartão criadas antes da v2 tenham card_charges
cartoes.post('/sincronizar-despesas', requireAuth, async (c) => {
  const user = c.get('user')

  // Buscar despesas de cartão do usuário que NÃO têm card_charge associado
  // SEGURANÇA: garante que o cartao_id também pertence ao mesmo usuário
  const orfas = await c.env.DB.prepare(`
    SELECT d.* FROM despesas d
    INNER JOIN cartoes ca ON ca.id = d.cartao_id AND ca.user_id = d.user_id
    LEFT JOIN card_charges cc ON cc.expense_id = d.id
    WHERE d.user_id = ? 
      AND d.cartao_id IS NOT NULL
      AND d.meio_pagamento IN ('cartao_credito','parcelado_cartao')
      AND cc.id IS NULL
      AND d.status != 'cancelado'
    LIMIT 200
  `).bind(user.id).all()

  let sincronizadas = 0
  for (const d of (orfas.results as any[])) {
    try {
      // Buscar cartão — OBRIGATÓRIO pertencer ao usuário
      const cartao = await c.env.DB.prepare(
        'SELECT * FROM cartoes WHERE id = ? AND user_id = ?'
      ).bind(d.cartao_id, user.id).first() as any
      if (!cartao) continue

      // Verificar novamente se já existe charge (evita race condition)
      const jaExiste = await c.env.DB.prepare(
        'SELECT id FROM card_charges WHERE expense_id = ?'
      ).bind(d.id).first()
      if (jaExiste) continue

      // Calcular billing se não tiver
      let bMonth = d.billing_month
      let bYear  = d.billing_year
      if (!bMonth || !bYear) {
        const { month, year } = calcBillingPeriod(d.data, cartao.dia_fechamento)
        bMonth = month; bYear = year
        // Atualizar despesa com billing_month/year
        await c.env.DB.prepare(
          'UPDATE despesas SET billing_month=?, billing_year=? WHERE id=? AND user_id=?'
        ).bind(bMonth, bYear, d.id, user.id).run()
      }

      const dataVenc = calcDueDate(bMonth, bYear, cartao.dia_vencimento, cartao.dia_fechamento)
      const groupId  = d.purchase_group_id || null

      await c.env.DB.prepare(`
        INSERT INTO card_charges
          (card_id, expense_id, descricao, valor, data_compra, data_vencimento,
           billing_month, billing_year, parcela_atual, total_parcelas,
           purchase_group_id, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        d.cartao_id, d.id, d.descricao, d.valor,
        d.data, dataVenc, bMonth, bYear,
        d.parcela_atual || null, d.numero_parcelas > 1 ? d.numero_parcelas : null,
        groupId,
        d.status === 'pago' ? 'pago' : 'pendente'
      ).run()

      sincronizadas++
    } catch(err) { /* continua */ }
  }

  return c.json({ success: true, sincronizadas, total_orfas: orfas.results.length })
})

// ─── GET /api/cartoes/:id/info ── info rápida do cartão (billing period) ──────
cartoes.get('/:id/info', requireAuth, async (c) => {
  const user = c.get('user')
  const cartaoId = c.req.param('id')
  const dataCompra = c.req.query('data') || new Date().toISOString().split('T')[0]

  const cartao = await c.env.DB.prepare(
    'SELECT * FROM cartoes WHERE id = ? AND user_id = ?'
  ).bind(parseInt(cartaoId), user.id).first() as any
  if (!cartao) return c.json({ error: 'Cartão não encontrado' }, 404)

  const { month: bMonth, year: bYear } = calcBillingPeriod(dataCompra, cartao.dia_fechamento)
  const dataVenc = calcDueDate(bMonth, bYear, cartao.dia_vencimento, cartao.dia_fechamento)

  return c.json({
    cartao_id: cartao.id,
    nome: cartao.nome,
    dia_fechamento: cartao.dia_fechamento,
    dia_vencimento: cartao.dia_vencimento,
    billing_month: bMonth,
    billing_year: bYear,
    data_vencimento: dataVenc,
    // Era `cartao.limite_disponivel` — a coluna congelada. Este endpoint
    // alimenta o modal de nova despesa, e por isso aumentar o limite do cartão
    // não aparecia na hora de lançar a compra. Ver src/lib/limite-cartao.ts.
    ...(await limiteDoCartao(c.env.DB, cartao.id, cartao.limite_total)),
  })
})

export default cartoes

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/cartoes/:id/contestar/:chargeId — Contestar lançamento
// ─────────────────────────────────────────────────────────────────────────────
cartoes.post('/:id/contestar/:chargeId', requireAuth, async (c) => {
  const user    = c.get('user')
  const cardId  = c.req.param('id')
  const chargeId= c.req.param('chargeId')

  // Validar posse do charge
  const charge = await c.env.DB.prepare(
    `SELECT cc.* FROM card_charges cc
     INNER JOIN cartoes ca ON ca.id = cc.card_id AND ca.user_id = ?
     WHERE cc.id = ? AND cc.card_id = ?`
  ).bind(user.id, chargeId, cardId).first() as any
  if (!charge) return c.json({ error: 'Lançamento não encontrado' }, 404)

  const { motivo, observacao } = await c.req.json()
  if (!motivo || motivo.trim().length < 5)
    return c.json({ error: 'Motivo é obrigatório (mín. 5 caracteres)' }, 400)

  // Verificar se já existe contestação aberta para este charge
  const jaContest = await c.env.DB.prepare(
    `SELECT id FROM card_contestacoes WHERE charge_id = ? AND status IN ('aberta','em_analise')`
  ).bind(chargeId).first()

  if (jaContest) return c.json({ error: 'Já existe uma contestação aberta para este lançamento' }, 409)

  const r = await c.env.DB.prepare(
    `INSERT INTO card_contestacoes (charge_id, user_id, motivo, observacao)
     VALUES (?, ?, ?, ?)`
  ).bind(chargeId, user.id, motivo.trim(), observacao?.trim() || null).run()

  return c.json({
    success: true,
    contestacao_id: r.meta.last_row_id,
    message: 'Contestação registrada! Verifique com seu banco.'
  }, 201)
})

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/cartoes/:id/contestacoes — Listar contestações do cartão
// ─────────────────────────────────────────────────────────────────────────────
cartoes.get('/:id/contestacoes', requireAuth, async (c) => {
  const user   = c.get('user')
  const cardId = c.req.param('id')

  const cartao = await c.env.DB.prepare(
    'SELECT id FROM cartoes WHERE id = ? AND user_id = ? AND ativo = 1'
  ).bind(cardId, user.id).first()
  if (!cartao) return c.json({ error: 'Cartão não encontrado' }, 404)

  const rows = await c.env.DB.prepare(
    `SELECT cc2.id as contestacao_id, cc2.motivo, cc2.status, cc2.observacao, cc2.created_at,
            cc.descricao as lancamento_descricao, cc.valor, cc.data_compra
     FROM card_contestacoes cc2
     INNER JOIN card_charges cc ON cc.id = cc2.charge_id
     WHERE cc.card_id = ? AND cc2.user_id = ?
     ORDER BY cc2.created_at DESC`
  ).bind(cardId, user.id).all()

  return c.json({ contestacoes: rows.results })
})

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/cartoes/split-compra — Divide compra entre dois cartões
// Body: { descricao, categoria, valor_total, data_compra, parcelas_cartao1, 
//          cartao1_id, cartao1_parcelas, cartao2_id, cartao2_parcelas, observacoes }
// ─────────────────────────────────────────────────────────────────────────────
cartoes.post('/split-compra', requireAuth, async (c) => {
  const user = c.get('user')
  const {
    descricao, categoria, valor_total, data_compra, observacoes,
    cartao1_id, cartao1_valor, cartao1_parcelas = 1,
    cartao2_id, cartao2_valor, cartao2_parcelas = 1
  } = await c.req.json()

  if (!descricao || !categoria || !valor_total || !data_compra || !cartao1_id || !cartao2_id)
    return c.json({ error: 'Campos obrigatórios: descricao, categoria, valor_total, data_compra, cartao1_id, cartao2_id' }, 400)

  if (cartao1_id === cartao2_id)
    return c.json({ error: 'Os dois cartões devem ser diferentes' }, 400)

  // Validar soma dos valores
  const v1 = parseFloat(cartao1_valor)
  const v2 = parseFloat(cartao2_valor)
  const vTotal = parseFloat(valor_total)
  if (isNaN(v1) || isNaN(v2) || v1 <= 0 || v2 <= 0)
    return c.json({ error: 'Valores dos cartões inválidos' }, 400)
  if (Math.abs((v1 + v2) - vTotal) > 0.02)
    return c.json({ error: `Soma dos valores (${v1+v2}) difere do total (${vTotal})` }, 400)

  // Verificar posse dos dois cartões
  const c1 = await c.env.DB.prepare('SELECT * FROM cartoes WHERE id = ? AND user_id = ?').bind(cartao1_id, user.id).first() as any
  const c2 = await c.env.DB.prepare('SELECT * FROM cartoes WHERE id = ? AND user_id = ?').bind(cartao2_id, user.id).first() as any
  if (!c1) return c.json({ error: 'Cartão 1 não encontrado' }, 404)
  if (!c2) return c.json({ error: 'Cartão 2 não encontrado' }, 404)

  const splitGroupId = uuid()
  const results: any[] = []

  // Função helper para lançar parcelas em um cartão
  const lancarNoCartao = async (cartao: any, valor: number, numParcelas: number, sufixo: string) => {
    const valorParc = Math.round((valor / numParcelas) * 100) / 100
    const groupId = uuid()
    const chargeIds: number[] = []

    for (let i = 1; i <= numParcelas; i++) {
      const parcelaDate = new Date(data_compra + 'T12:00:00')
      parcelaDate.setMonth(parcelaDate.getMonth() + (i - 1))
      const parcelaDateStr = parcelaDate.toISOString().split('T')[0]

      const { month: bMonth, year: bYear } = calcBillingPeriod(parcelaDateStr, cartao.dia_fechamento)
      const dataVenc = calcDueDate(bMonth, bYear, cartao.dia_vencimento, cartao.dia_fechamento)
      const descParcela = numParcelas > 1
        ? `${descricao} ${sufixo} (${i}/${numParcelas})`
        : `${descricao} ${sufixo}`

      const dr = await c.env.DB.prepare(
        `INSERT INTO despesas (user_id, descricao, data, categoria, valor, parcelado,
         numero_parcelas, parcela_atual, status, fixa_ou_variavel, vencimento,
         observacoes, cartao_id, meio_pagamento, billing_month, billing_year, purchase_group_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pendente', 'variavel', ?, ?, ?, 'cartao_credito', ?, ?, ?)`
      ).bind(
        user.id, descParcela, dataVenc, categoria,
        valorParc, numParcelas > 1 ? 1 : 0, numParcelas, i,
        dataVenc, observacoes ? `[Split] ${observacoes}` : '[Split]',
        cartao.id, bMonth, bYear, groupId
      ).run()

      const cr = await c.env.DB.prepare(
        `INSERT INTO card_charges (card_id, expense_id, descricao, valor, data_compra,
         data_vencimento, billing_month, billing_year, parcela_atual, total_parcelas,
         purchase_group_id, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pendente')`
      ).bind(
        cartao.id, dr.meta.last_row_id, descParcela, valorParc,
        parcelaDateStr, dataVenc, bMonth, bYear,
        numParcelas > 1 ? i : null, numParcelas > 1 ? numParcelas : null, groupId
      ).run()
      chargeIds.push(cr.meta.last_row_id as number)
    }

    // Atualizar limite
    return { cartao_id: cartao.id, cartao_nome: cartao.nome, valor, parcelas: numParcelas, group_id: groupId, charge_ids: chargeIds }
  }

  results.push(await lancarNoCartao(c1, v1, parseInt(cartao1_parcelas), '[Cartão 1]'))
  results.push(await lancarNoCartao(c2, v2, parseInt(cartao2_parcelas), '[Cartão 2]'))

  return c.json({
    success: true,
    split_group_id: splitGroupId,
    descricao,
    valor_total: vTotal,
    splits: results,
    message: `Compra dividida entre ${c1.nome} e ${c2.nome}!`
  }, 201)
})

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/cartoes/:id/limites-categoria?mes=&ano=
// Lista limites por categoria e uso atual no mês
// ─────────────────────────────────────────────────────────────────────────────
cartoes.get('/:id/limites-categoria', requireAuth, async (c) => {
  const user   = c.get('user')
  const cardId = c.req.param('id')
  const now    = new Date()
  const mes    = parseInt(c.req.query('mes') || String(now.getMonth() + 1))
  const ano    = parseInt(c.req.query('ano') || String(now.getFullYear()))

  const cartao = await c.env.DB.prepare(
    'SELECT id FROM cartoes WHERE id = ? AND user_id = ? AND ativo = 1'
  ).bind(cardId, user.id).first()
  if (!cartao) return c.json({ error: 'Cartão não encontrado' }, 404)

  // Limites configurados
  const limites = await c.env.DB.prepare(
    'SELECT * FROM card_category_limits WHERE card_id = ? AND user_id = ? ORDER BY categoria ASC'
  ).bind(cardId, user.id).all()

  // Uso por categoria no mês
  const usos = await c.env.DB.prepare(
    `SELECT d.categoria, COALESCE(SUM(cc.valor), 0) as gasto
     FROM card_charges cc
     LEFT JOIN despesas d ON d.id = cc.expense_id
     WHERE cc.card_id = ? AND cc.billing_month = ? AND cc.billing_year = ?
     GROUP BY d.categoria`
  ).bind(cardId, mes, ano).all()

  const mapaUsos: Record<string, number> = {}
  for (const u of usos.results as any[]) {
    mapaUsos[u.categoria] = Number(u.gasto)
  }

  const resultado = (limites.results as any[]).map(l => ({
    id: l.id,
    categoria: l.categoria,
    limite_mensal: l.limite_mensal,
    gasto_mes: mapaUsos[l.categoria] || 0,
    disponivel: Math.max(0, l.limite_mensal - (mapaUsos[l.categoria] || 0)),
    percentual: l.limite_mensal > 0
      ? Math.round(((mapaUsos[l.categoria] || 0) / l.limite_mensal) * 100)
      : 0,
    status: (mapaUsos[l.categoria] || 0) >= l.limite_mensal ? 'estourado'
          : (mapaUsos[l.categoria] || 0) >= l.limite_mensal * 0.8 ? 'atencao' : 'ok'
  }))

  return c.json({ limites: resultado, mes, ano })
})

// POST /api/cartoes/:id/limites-categoria — Criar/atualizar limite por categoria
cartoes.post('/:id/limites-categoria', requireAuth, async (c) => {
  const user   = c.get('user')
  const cardId = c.req.param('id')

  const cartao = await c.env.DB.prepare(
    'SELECT id FROM cartoes WHERE id = ? AND user_id = ? AND ativo = 1'
  ).bind(cardId, user.id).first()
  if (!cartao) return c.json({ error: 'Cartão não encontrado' }, 404)

  const { categoria, limite_mensal } = await c.req.json()
  if (categoria === undefined || limite_mensal === undefined) return c.json({ error: 'categoria e limite_mensal são obrigatórios' }, 400)
  const categoriaValidada = textoObrigatorio(categoria, 'categoria', 120)
  if ('error' in categoriaValidada) return c.json({ error: categoriaValidada.error }, 400)
  const limValidado = numeroPositivo(limite_mensal, 'limite_mensal')
  if ('error' in limValidado) return c.json({ error: limValidado.error }, 400)
  const lim = limValidado.value

  await c.env.DB.prepare(
    `INSERT INTO card_category_limits (card_id, user_id, categoria, limite_mensal)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(card_id, categoria) DO UPDATE SET limite_mensal = excluded.limite_mensal`
  ).bind(cardId, user.id, categoriaValidada.value, lim).run()

  return c.json({ success: true, message: `Limite de ${emReais(lim)}/mês definido para "${categoriaValidada.value}"` }, 201)
})

// DELETE /api/cartoes/:id/limites-categoria/:categoria — Remover limite
cartoes.delete('/:id/limites-categoria/:categoria', requireAuth, async (c) => {
  const user      = c.get('user')
  const cardId    = c.req.param('id')
  const categoria = decodeURIComponent(c.req.param('categoria'))

  const cartao = await c.env.DB.prepare(
    'SELECT id FROM cartoes WHERE id = ? AND user_id = ? AND ativo = 1'
  ).bind(cardId, user.id).first()
  if (!cartao) return c.json({ error: 'Cartão não encontrado' }, 404)

  const existente = await c.env.DB.prepare(
    'SELECT id FROM card_category_limits WHERE card_id = ? AND user_id = ? AND categoria = ?'
  ).bind(cardId, user.id, categoria).first()
  if (!existente) return c.json({ error: 'Limite de categoria não encontrado' }, 404)

  await c.env.DB.prepare(
    'DELETE FROM card_category_limits WHERE card_id = ? AND user_id = ? AND categoria = ?'
  ).bind(cardId, user.id, categoria).run()

  return c.json({ success: true, message: 'Limite removido!' })
})

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/cartoes/:id/fatura-pdf?mes=&ano= — HTML formatado para impressão/PDF
// ─────────────────────────────────────────────────────────────────────────────
cartoes.get('/:id/fatura-pdf', requireAuth, async (c) => {
  const user   = c.get('user')
  const cardId = c.req.param('id')
  const now    = new Date()
  const mes    = parseInt(c.req.query('mes') || String(now.getMonth() + 1))
  const ano    = parseInt(c.req.query('ano') || String(now.getFullYear()))

  const cartao = await c.env.DB.prepare(
    'SELECT * FROM cartoes WHERE id = ? AND user_id = ?'
  ).bind(cardId, user.id).first() as any
  if (!cartao) return c.json({ error: 'Cartão não encontrado' }, 404)

  const charges = await c.env.DB.prepare(
    `SELECT cc.*, d.categoria, d.observacoes as obs_despesa
     FROM card_charges cc
     LEFT JOIN despesas d ON d.id = cc.expense_id
     WHERE cc.card_id = ? AND cc.billing_month = ? AND cc.billing_year = ?
     ORDER BY cc.data_compra ASC`
  ).bind(cardId, mes, ano).all()

  const lista = charges.results as any[]
  const total   = lista.reduce((s, r) => s + Number(r.valor), 0)
  const pago    = lista.filter(r => r.status === 'pago').reduce((s, r) => s + Number(r.valor), 0)
  const pendente= total - pago
  const dataVenc= calcDueDate(mes, ano, cartao.dia_vencimento, cartao.dia_fechamento)

  const meses = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez']
  const fmt = (v: number) => `R$ ${v.toFixed(2).replace('.',',').replace(/\B(?=(\d{3})+(?!\d))/g,'.')}`
  const fmtDate = (s: string) => { if(!s) return '-'; const [y,m,d] = s.split('-'); return `${d}/${m}/${y}` }

  // Agrupar por categoria
  const grupos: Record<string, any[]> = {}
  for (const ch of lista) {
    const cat = ch.categoria || 'Outros'
    if (!grupos[cat]) grupos[cat] = []
    grupos[cat].push(ch)
  }

  let rowsHtml = ''
  for (const [cat, items] of Object.entries(grupos)) {
    const subTotal = items.reduce((s, r) => s + Number(r.valor), 0)
    rowsHtml += `<tr class="cat-header"><td colspan="5">${cat}</td><td class="val">${fmt(subTotal)}</td></tr>`
    for (const ch of items) {
      const parc = ch.total_parcelas > 1 ? ` (${ch.parcela_atual}/${ch.total_parcelas})` : ''
      rowsHtml += `
      <tr>
        <td>${fmtDate(ch.data_compra)}</td>
        <td>${ch.descricao?.replace(/\s*\(\d+\/\d+\)$/,'') || '-'}${parc}</td>
        <td>${cat}</td>
        <td>${ch.status === 'pago' ? '✅ Pago' : '⏳ Pendente'}</td>
        <td>${ch.total_parcelas > 1 ? `${ch.total_parcelas - (ch.parcela_atual||0) + 1} restam` : '—'}</td>
        <td class="val">${fmt(Number(ch.valor))}</td>
      </tr>`
    }
  }

  const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<title>Fatura ${meses[mes-1]}/${ano} — ${cartao.nome}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Arial, sans-serif; font-size: 12px; color: #222; padding: 20px; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 24px; border-bottom: 3px solid ${cartao.cor || '#2FBF71'}; padding-bottom: 16px; }
  .header h1 { font-size: 20px; color: ${cartao.cor || '#2FBF71'}; }
  .header .meta { text-align: right; color: #555; line-height: 1.6; }
  .totais { display: flex; gap: 16px; margin-bottom: 20px; }
  .totais .box { flex: 1; background: #f4f4f4; border-radius: 8px; padding: 12px; text-align: center; }
  .totais .box .label { font-size: 10px; color: #888; text-transform: uppercase; }
  .totais .box .val { font-size: 18px; font-weight: bold; margin-top: 4px; }
  .totais .box.destaque .val { color: ${cartao.cor || '#2FBF71'}; }
  table { width: 100%; border-collapse: collapse; }
  th { background: ${cartao.cor || '#2FBF71'}; color: white; text-align: left; padding: 8px 6px; font-size: 11px; }
  td { padding: 6px; border-bottom: 1px solid #eee; font-size: 11px; }
  td.val { text-align: right; font-weight: bold; }
  tr:hover td { background: #fafafa; }
  .cat-header td { background: #f0f0f0; font-weight: bold; font-size: 11px; color: #444; padding: 5px 6px; }
  .cat-header td.val { text-align: right; }
  .footer { margin-top: 24px; font-size: 10px; color: #aaa; text-align: center; }
  @media print { body { padding: 10px; } .footer { display: none; } }
</style>
</head>
<body>
<div class="header">
  <div>
    <h1>💳 ${cartao.nome}${cartao.apelido ? ` — ${cartao.apelido}` : ''}</h1>
    <div style="color:#555;margin-top:4px;">${cartao.banco} · ${cartao.bandeira?.toUpperCase()} · ${cartao.tipo_cartao || 'PF'}${cartao.ultimos_digitos ? ` ···· ${cartao.ultimos_digitos}` : ''}</div>
  </div>
  <div class="meta">
    <div><strong>Fatura de ${meses[mes-1]}/${ano}</strong></div>
    <div>Vencimento: ${fmtDate(dataVenc)}</div>
    <div>Fechamento: dia ${cartao.dia_fechamento}</div>
    <div>Gerado em: ${fmtDate(new Date().toISOString().split('T')[0])}</div>
  </div>
</div>
<div class="totais">
  <div class="box destaque">
    <div class="label">Total Fatura</div>
    <div class="val">${fmt(total)}</div>
  </div>
  <div class="box">
    <div class="label">Pago</div>
    <div class="val" style="color:#10b981">${fmt(pago)}</div>
  </div>
  <div class="box">
    <div class="label">Pendente</div>
    <div class="val" style="color:#ef4444">${fmt(pendente)}</div>
  </div>
  <div class="box">
    <div class="label">Lançamentos</div>
    <div class="val">${lista.length}</div>
  </div>
</div>
<table>
  <thead><tr>
    <th>Data Compra</th><th>Descrição</th><th>Categoria</th><th>Status</th><th>Parcelas</th><th style="text-align:right">Valor</th>
  </tr></thead>
  <tbody>${rowsHtml}</tbody>
  <tfoot><tr>
    <td colspan="5" style="text-align:right;font-weight:bold;padding:10px 6px;">TOTAL</td>
    <td class="val" style="font-size:15px;">${fmt(total)}</td>
  </tr></tfoot>
</table>
<div class="footer">VerdeMais · Fatura exportada automaticamente · ${new Date().toLocaleString('pt-BR')}</div>
</body>
</html>`

  return c.text(html, 200, { 'Content-Type': 'text/html; charset=utf-8' })
})
