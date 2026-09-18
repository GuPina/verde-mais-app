import { Hono } from 'hono'
import { limiteDoCartao, limitesDosCartoes } from '../lib/limite-cartao'

/** Dinheiro em mensagem para o usuário: pt-BR, não "R$ 900.00". */
const emReais = (v: number) =>
  `R$ ${Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
import { requireAuth } from './auth'
import { faturaDaCompra, faturaDaParcela, faturaDaParcelaAncorada, periodoFatura, somarMeses, vencimentoFatura } from '../lib/fatura'
import { ehDataISO } from '../lib/validacao'
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

/**
 * `new Date('2026-02-31T12:00:00')` NÃO é inválida em JavaScript: o motor
 * empurra para 3 de março e devolve um horário legítimo. O teste anterior
 * passava, e a string original — o 31 de fevereiro — seguia para
 * `periodoFatura` e `faturaDaParcela`, que é onde a data vira dinheiro.
 * `ehDataISO` conta os dias do mês de verdade, bissexto incluído.
 */
function dataIso(valor: unknown, campo = 'data_compra') {
  const data = String(valor ?? '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) return { error: `${campo} deve estar no formato AAAA-MM-DD` }
  if (!ehDataISO(data)) return { error: `${campo} não existe no calendário.` }
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
 * As duas funções de ciclo de fatura viviam aqui e estavam redigitadas em
 * despesas.ts. Agora saem de src/lib/fatura.ts; os nomes antigos ficam como
 * casca fina para não reescrever as ~20 chamadas deste arquivo.
 */
const calcBillingPeriod = (dataCompra: string, diaFechamento: number) => {
  const { mes, ano } = periodoFatura(dataCompra, diaFechamento)
  return { month: mes, year: ano }
}
const calcDueDate = (mesFatura: number, anoFatura: number, diaVenc: number, diaFech: number) =>
  vencimentoFatura(mesFatura, anoFatura, diaVenc, diaFech)

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

  const [porMes, porCartaoMes, futuras, categorias, recorrentes, cartoesLista, usoPorCartao] = await Promise.all([
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

    // Uso atual por cartão = limite comprometido (parcelas/lançamentos pendentes)
    c.env.DB.prepare(
      `SELECT cc.card_id, COALESCE(SUM(cc.valor),0) as utilizado
       FROM card_charges cc
       JOIN cartoes c2 ON c2.id = cc.card_id
       WHERE c2.user_id = ? AND cc.status = 'pendente'${filtroCartao}
       GROUP BY cc.card_id`
    ).bind(user.id, ...paramsCartao).all(),
  ])

  // ── Total gasto no ano corrente (todas as faturas do ano) ─────────────────
  const totalAnoR = await c.env.DB.prepare(
    `SELECT COALESCE(SUM(cc.valor),0) as total, COUNT(*) as lancamentos
     FROM card_charges cc
     JOIN cartoes c2 ON c2.id = cc.card_id
     WHERE c2.user_id = ? AND cc.status != 'cancelado'
       AND cc.billing_year = ?${filtroCartao}`
  ).bind(user.id, anoAtual, ...paramsCartao).first<any>()
  const gastoAno = Math.round((Number(totalAnoR?.total) || 0) * 100) / 100
  const gastoAnoLanc = Number(totalAnoR?.lancamentos) || 0

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

  // ── Uso por cartão (limite comprometido) e uso total somado ───────────────
  const usoMap = new Map<number, number>()
  for (const r of (usoPorCartao.results as any[] || [])) usoMap.set(Number(r.card_id), Number(r.utilizado || 0))
  const cartoesUso = (cartoesLista.results as any[] || [])
    .filter(c2 => !cartaoFiltro || Number(c2.id) === cartaoFiltro)
    .map(c2 => {
      const lim = Number(c2.limite_total || 0)
      const util = usoMap.get(Number(c2.id)) || 0
      return {
        id: Number(c2.id), nome: c2.nome, cor: c2.cor,
        limite_total: Math.round(lim * 100) / 100,
        utilizado: Math.round(util * 100) / 100,
        disponivel: Math.round(Math.max(0, lim - util) * 100) / 100,
        uso_pct: lim > 0 ? Math.round((util / lim) * 100) : null,
      }
    })
    .sort((a, b) => b.utilizado - a.utilizado)
  const utilizadoSomado = cartoesUso.reduce((s, c2) => s + c2.utilizado, 0)

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
    cartoes_uso: cartoesUso,
    uso_total: {
      limite: Math.round(limiteTotalSomado * 100) / 100,
      utilizado: Math.round(utilizadoSomado * 100) / 100,
      disponivel: Math.round(Math.max(0, limiteTotalSomado - utilizadoSomado) * 100) / 100,
      pct: limiteTotalSomado > 0 ? Math.round((utilizadoSomado / limiteTotalSomado) * 100) : null,
    },
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
    ano_atual: anoAtual,
    gasto_ano: { ano: anoAtual, total: gastoAno, lancamentos: gastoAnoLanc },
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
    // A fatura da parcela SEGUE A SÉRIE — ela não se recalcula a partir
    // da data deslocada. Recalcular empilhava duas parcelas na mesma
    // fatura e deixava o mês seguinte vazio; ver faturaDaParcela().
    const fp = faturaDaParcela(dataValidada.value, cartao.dia_fechamento, cartao.dia_vencimento, i - 1)
    const parcelaDateStr = fp.data_parcela
    const bMonth = fp.mes, bYear = fp.ano
    const dataVenc = fp.vencimento
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
    // A fatura da parcela SEGUE A SÉRIE — não se recalcula a partir da data
    // deslocada. Recalcular empilhava duas parcelas na mesma fatura e
    // deixava o mês seguinte vazio; ver faturaDaParcela().
    const fp = faturaDaParcela(dataValidada.value, cartao.dia_fechamento, cartao.dia_vencimento, i - 1)
    const parcelaDateStr = fp.data_parcela
    const bMonth = fp.mes, bYear = fp.ano
    const dataVenc    = fp.vencimento
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
    // A fatura da parcela SEGUE A SÉRIE — não se recalcula a partir da
    // data deslocada. Recalcular empilhava duas parcelas na mesma fatura
    // e deixava o mês seguinte vazio; ver faturaDaParcela().
    const fp = faturaDaParcela(dataValidada.value, cartao.dia_fechamento, cartao.dia_vencimento, i - 1)
    const parcelaDateStr = fp.data_parcela
    const bMonth = fp.mes, bYear = fp.ano
    const dataVenc = fp.vencimento
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
    // A fatura da parcela SEGUE A SÉRIE — não se recalcula a partir da data
    // deslocada. Recalcular empilhava duas parcelas na mesma fatura e
    // deixava o mês seguinte vazio; ver faturaDaParcela().
    const fp = faturaDaParcela(dataValidada.value, cartao.dia_fechamento, cartao.dia_vencimento, i - 1)
    const parcelaDateStr = fp.data_parcela
    const bMonth = fp.mes, bYear = fp.ano
    const dataVenc   = fp.vencimento
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

// ─── GET /api/cartoes/diagnostico ────────────────────────────────────────────
// Confere, lançamento a lançamento, se a fatura gravada bate com a fatura que
// o ciclo do cartão manda.
//
// Existe porque dois bugs deixaram dados errados no banco antes de serem
// corrigidos: o UPDATE de despesa não recalculava a fatura ao mudar data ou
// cartão, e o gerador de parcelas transbordava o dia em compras feitas nos
// dias 29, 30 e 31 (31/08 + 1 mês virava 01/10, pulando setembro). Corrigir o
// código não conserta o que já está gravado — isto mostra o que ficou torto e
// /reparar-faturas endireita.
cartoes.get('/diagnostico', requireAuth, async (c) => {
  const user = c.get('user')

  const linhas = await c.env.DB.prepare(
    `SELECT cc.id as charge_id, cc.expense_id, cc.descricao, cc.valor,
            cc.data_compra, cc.data_vencimento, cc.billing_month, cc.billing_year,
            cc.parcela_atual, cc.total_parcelas, cc.purchase_group_id, cc.status,
            ct.id as cartao_id, ct.nome as cartao_nome,
            ct.dia_fechamento, ct.dia_vencimento,
            d.data as despesa_data, d.vencimento as despesa_vencimento,
            d.billing_month as despesa_bmes, d.billing_year as despesa_bano,
            d.status as despesa_status
     FROM card_charges cc
     JOIN cartoes ct ON ct.id = cc.card_id
     LEFT JOIN despesas d ON d.id = cc.expense_id
     WHERE ct.user_id = ? AND ct.ativo = 1 AND cc.status != 'cancelado'
     ORDER BY cc.data_compra DESC
     LIMIT 500`
  ).bind(user.id).all()

  // A âncora de cada parcelamento: a primeira parcela do grupo, a única cujo
  // `data_compra` é mesmo a data da compra.
  const ancoras = new Map<string, { data_compra: string; parcela_atual: number }>()
  for (const r of (linhas.results as any[]) || []) {
    if (!r.purchase_group_id || !(Number(r.total_parcelas) > 1) || !r.data_compra) continue
    const n = Number(r.parcela_atual) || 1
    const atual = ancoras.get(r.purchase_group_id)
    if (!atual || n < atual.parcela_atual) {
      ancoras.set(r.purchase_group_id,
        { data_compra: String(r.data_compra).slice(0, 10), parcela_atual: n })
    }
  }

  // As linhas como o reparo as vê — consulta compartilhada, sem LIMIT, para
  // que o número do botão não seja tirado de uma amostra de 500.
  const todasAsLinhas = await linhasDeFatura(c.env.DB, user.id)

  const problemas: any[] = []
  const importados: any[] = []
  for (const r of (linhas.results as any[]) || []) {
    if (!r.data_compra) {
      problemas.push({ ...r, tipo: 'sem_data_compra',
        explica: 'O lançamento não guarda a data da compra, então não dá para dizer em que fatura ele deveria estar.' })
      continue
    }
    // Lançamento vindo de importação de fatura grava a data de VENCIMENTO no
    // campo data_compra — a fatura importada não diz quando cada compra foi
    // feita, só em que fatura ela caiu. Recalcular o ciclo a partir dessa data
    // joga o lançamento para a fatura seguinte, que é o oposto do certo.
    // O sinal é a data da compra ser idêntica ao vencimento.
    if (String(r.data_compra).slice(0, 10) === String(r.data_vencimento || '').slice(0, 10)) {
      importados.push({ charge_id: r.charge_id, descricao: r.descricao })
      continue
    }
    // Para uma parcela, a fatura esperada NÃO sai do `data_compra` dela — ele
    // já é uma data deslocada, e recalcular a partir dele é a própria regra que
    // empilha duas parcelas num mês. O detector usava essa regra para decidir o
    // que estava errado, então acusava como torto o que estava certo e vice-versa.
    const ancoraDesta = (Number(r.total_parcelas) > 1 && r.purchase_group_id)
      ? ancoras.get(r.purchase_group_id) : null
    const esperado = ancoraDesta
      ? faturaDaParcelaAncorada(ancoraDesta.data_compra, ancoraDesta.parcela_atual,
          r.parcela_atual, r.dia_fechamento, r.dia_vencimento)
      : faturaDaCompra(String(r.data_compra).slice(0, 10), r.dia_fechamento, r.dia_vencimento)
    const faturaErrada = Number(r.billing_month) !== esperado.mes || Number(r.billing_year) !== esperado.ano
    const vencErrado = String(r.data_vencimento || '').slice(0, 10) !== esperado.vencimento
    // A despesa e o charge têm que contar a mesma história.
    const despesaDivergente = r.expense_id && (
      Number(r.despesa_bmes) !== Number(r.billing_month) ||
      Number(r.despesa_bano) !== Number(r.billing_year) ||
      String(r.despesa_vencimento || '').slice(0, 10) !== String(r.data_vencimento || '').slice(0, 10) ||
      String(r.despesa_data || '').slice(0, 10) !== String(r.data_vencimento || '').slice(0, 10)
    )
    if (faturaErrada || vencErrado || despesaDivergente) {
      problemas.push({
        charge_id: r.charge_id, expense_id: r.expense_id,
        descricao: r.descricao, valor: Number(r.valor),
        cartao: r.cartao_nome, cartao_id: r.cartao_id,
        data_compra: String(r.data_compra).slice(0, 10),
        parcela: r.total_parcelas > 1 ? `${r.parcela_atual}/${r.total_parcelas}` : null,
        gravado: {
          fatura: `${r.billing_month}/${r.billing_year}`,
          vencimento: String(r.data_vencimento || '').slice(0, 10) || null,
          despesa_data: String(r.despesa_data || '').slice(0, 10) || null,
        },
        correto: { fatura: `${esperado.mes}/${esperado.ano}`, vencimento: esperado.vencimento },
        tipo: faturaErrada ? 'fatura_errada' : vencErrado ? 'vencimento_errado' : 'despesa_dessincronizada',
        explica: faturaErrada
          ? `Comprado em ${String(r.data_compra).slice(8,10)}/${String(r.data_compra).slice(5,7)}, com o cartão fechando dia ${r.dia_fechamento}, deveria estar na fatura ${esperado.mes}/${esperado.ano} — está na ${r.billing_month}/${r.billing_year}.`
          : vencErrado
            ? `A fatura ${r.billing_month}/${r.billing_year} vence em ${esperado.vencimento}, mas o lançamento está marcado para ${String(r.data_vencimento || '').slice(0,10)}.`
            : 'A despesa e a fatura discordam entre si — a lista de Despesas e a de Cartões vão mostrar meses diferentes para o mesmo gasto.',
      })
    }
  }

  // Parcelamento que pulou mês — o sintoma do transbordo de data.
  //
  // É um erro diferente do anterior e não se conserta recalculando a fatura:
  // a data da PARCELA já nasceu errada (31/08 + 1 mês virava 01/10 em vez de
  // 30/09), então recalcular o ciclo a partir dela devolve o mesmo mês errado.
  // Só se conserta recompondo as datas a partir da primeira parcela.
  const grupos: Record<string, any[]> = {}
  for (const r of (linhas.results as any[]) || []) {
    if (!r.purchase_group_id || !(Number(r.total_parcelas) > 1)) continue
    ;(grupos[r.purchase_group_id] ||= []).push(r)
  }
  const parcelamentosComBuraco = Object.entries(grupos).flatMap(([grupo, itens]) => {
    const meses = itens.map(r => Number(r.billing_year) * 12 + Number(r.billing_month))
    const ord = [...new Set(meses)].sort((a, b) => a - b)
    const buracos = ord.slice(1).filter((m, i) => m - ord[i] !== 1).length
    const duplicados = meses.length - ord.length
    if (!buracos && !duplicados) return []
    const primeira = itens.slice().sort((a, b) =>
      (Number(a.parcela_atual) || 0) - (Number(b.parcela_atual) || 0))[0]
    return [{
      purchase_group_id: grupo,
      descricao: String(primeira?.descricao || '').replace(/\s*\(\d+\/\d+\)\s*$/, ''),
      cartao: primeira?.cartao_nome,
      meses_pulados: buracos,
      parcelas_no_mesmo_mes: duplicados,
      parcelas: itens.length,
    }]
  })

  // ── O que o botão vai realmente fazer ─────────────────────────────────────
  //
  // Sai de `planejarReparo`, a MESMA função que o POST de reparo executa — e
  // não de uma contagem própria desta rota. A contagem própria era o defeito:
  // ela só enxergava `problemas`, que exclui linha importada, então o
  // parcelamento importado fora de ordem (o caso que apagou outubro) aparecia
  // como aviso amarelo e ficava fora do número do botão. A tela dizia
  // "6 parcelamentos com mês pulado" e logo abaixo "Recolocar na fatura certa
  // (2)", e os 2 eram dois lançamentos triviais de julho.
  const porCharge = new Map(todasAsLinhas.map(r => [r.charge_id, r]))
  const reparos = planejarReparo(todasAsLinhas).map(a => {
    const r: any = porCharge.get(a.charge_id) || {}
    return {
      ...a,
      descricao: String(r.descricao || '').replace(/\s*\(\d+\/\d+\)\s*$/, ''),
      parcela: r.parcela_atual && r.total_parcelas ? `${r.parcela_atual}/${r.total_parcelas}` : null,
      cartao: r.cartao_nome || null,
      valor: Number(r.valor) || 0,
      explica: a.motivo === 'parcela_na_fatura_errada'
        ? `A parcela ${r.parcela_atual} de ${r.total_parcelas} pertence à fatura ${a.fatura_para} — está na ${a.fatura_de}.`
        : a.motivo === 'data_da_parcela'
          ? 'A data desta parcela nasceu transbordada (compra no dia 29, 30 ou 31) e puxou a fatura junto.'
          : `O ciclo do cartão põe esta compra na fatura ${a.fatura_para} — está na ${a.fatura_de}.`,
    }
  })

  return c.json({
    // O total que o REPARO olhou, não o da amostra de 500 do detector. A tela
    // dizia "500 lançamentos conferidos" enquanto o plano cobria a base inteira.
    total_analisado: todasAsLinhas.length,
    total_amostra_detector: ((linhas.results as any[]) || []).length,
    problemas,
    total_problemas: problemas.length,
    // Não são erro por si: só não dá para reconferir o CICLO a partir deles.
    // Parcelamento importado fora de ordem continua reparável, por contagem.
    importados_ignorados: importados.length,
    parcelamentos_com_buraco: parcelamentosComBuraco,
    reparos,
    reparavel: reparos.length,
  })
})

/**
 * As linhas de fatura de um usuário — a MESMA consulta para conferir e para
 * reparar.
 *
 * O diagnóstico lia 500 linhas com um SELECT próprio e o reparo lia todas com
 * outro. Duas consultas e duas contas para a mesma pergunta: o botão dizia
 * "recolocar na fatura certa (2)" sobre uma base de 500, enquanto o reparo
 * trabalharia sobre 646.
 */
async function linhasDeFatura(db: D1Database, userId: number) {
  const r = await db.prepare(
    `SELECT cc.id as charge_id, cc.expense_id, cc.descricao, cc.valor,
            cc.data_compra, cc.billing_month, cc.billing_year, cc.data_vencimento,
            cc.parcela_atual, cc.total_parcelas, cc.purchase_group_id,
            ct.nome as cartao_nome, ct.dia_fechamento, ct.dia_vencimento
     FROM card_charges cc
     JOIN cartoes ct ON ct.id = cc.card_id
     WHERE ct.user_id = ? AND ct.ativo = 1 AND cc.status != 'cancelado'
       AND cc.data_compra IS NOT NULL`
  ).bind(userId).all()
  return ((r.results as any[]) || [])
}

/** Importado: data_compra é o vencimento, não serve para recalcular ciclo. */
export function importado(r: any) {
  return String(r.data_compra).slice(0, 10) === String(r.data_vencimento || '').slice(0, 10)
}

/**
 * O que precisa ser recolocado — a única função que decide isso.
 *
 * Era código dentro do POST de reparo, e o GET de diagnóstico tinha a SUA
 * própria noção de "problema" para contar no botão. As duas discordavam, e
 * discordavam justamente onde doía: o parcelamento importado fora de ordem —
 * o caso que apagou outubro — era invisível para o diagnóstico e reparável
 * pelo reparo. O usuário via "6 parcelamentos com mês pulado" logo acima de um
 * botão escrito "Recolocar na fatura certa (2)", e os 2 eram outra coisa.
 *
 * Agora o botão e o reparo leem a mesma lista. O número no botão é, por
 * construção, o número de linhas que vão mudar.
 */
export function planejarReparo(todas: any[]) {
  const acoes: any[] = []

  // ── Parcelamento: a série inteira, por uma regra só ───────────────────────
  //
  // "Importado" é propriedade da COMPRA, não da linha. Decidir linha a linha —
  // como era feito — rasga o grupo em dois e faz o defeito desaparecer:
  //
  //   PgConta VICTOR Anual, 12 parcelas importadas. Onze têm data_compra igual
  //   ao vencimento, como toda linha importada. A parcela 9 tem data_compra
  //   08/10 e vencimento 08/11 — porque o UPDATE de despesa moveu a fatura dela
  //   para novembro e deixou a data_compra para trás. Essa diferença é
  //   EXATAMENTE o que `importado()` mede.
  //
  //   Resultado: as onze sadias iam para a regra de importado e fechavam certo
  //   entre si; a quebrada ia sozinha para a regra de compra e, como grupo de
  //   uma parcela só, também fechava certo. Nenhuma das duas metades via erro.
  //   A linha quebrada escapava da checagem POR ESTAR QUEBRADA, e a tela dizia
  //   "está tudo no lugar" com outubro vazio.
  //
  // Agora o grupo inteiro é classificado pela maioria e passa por uma regra só.
  const grupos: Record<string, any[]> = {}
  for (const r of todas) {
    if (!r.purchase_group_id || !(Number(r.total_parcelas) > 1)) continue
    ;(grupos[r.purchase_group_id] ||= []).push(r)
  }

  for (const itens of Object.values(grupos)) {
    const ord = itens.slice().sort((a, b) => (Number(a.parcela_atual) || 0) - (Number(b.parcela_atual) || 0))
    const primeira = ord[0]
    if (!primeira) continue
    const nPrimeira = Number(primeira.parcela_atual) || 1

    // Maioria manda. Empate conta como importado: nesse caso a data da compra
    // é duvidosa na metade das linhas, e a contagem de faturas não depende dela.
    const nImportadas = itens.filter(importado).length
    const grupoImportado = nImportadas * 2 >= itens.length

    if (grupoImportado) {
      // A fatura da parcela N é a da primeira mais N meses. Contagem pura: não
      // depende de nenhuma data, que é o que permite consertar série importada.
      if (!primeira.billing_month || !primeira.billing_year) continue
      for (const r of ord) {
        const k = (Number(r.parcela_atual) || 1) - nPrimeira
        if (k < 0) continue
        let mes = Number(primeira.billing_month) + k
        const ano = Number(primeira.billing_year) + Math.floor((mes - 1) / 12)
        mes = ((mes - 1) % 12) + 1
        const venc = vencimentoFatura(mes, ano, r.dia_vencimento, r.dia_fechamento)
        if (Number(r.billing_month) === mes && Number(r.billing_year) === ano
            && String(r.data_vencimento || '').slice(0, 10) === venc) continue
        acoes.push({ charge_id: r.charge_id, expense_id: r.expense_id,
          motivo: 'parcela_na_fatura_errada',
          de: String(r.data_compra).slice(0, 10), para: venc,
          fatura_de: `${r.billing_month}/${r.billing_year}`, fatura_para: `${mes}/${ano}`,
          // A linha segue marcada como importada: data_compra acompanha o
          // vencimento, que é o que a identifica e a mantém fora da parte 2.
          data_compra: venc, mes, ano, vencimento: venc })
      }
    } else {
      // Compra de verdade: a data da primeira parcela É a data da compra, e a
      // série sai de faturaDaParcela — a mesma função dos geradores.
      const origem = String(primeira.data_compra).slice(0, 10)
      for (const r of ord) {
        const k = (Number(r.parcela_atual) || 1) - nPrimeira
        if (k < 0) continue
        const f = faturaDaParcela(origem, r.dia_fechamento, r.dia_vencimento, k)
        const dataErrada = f.data_parcela !== String(r.data_compra).slice(0, 10)
        const faturaErrada = Number(r.billing_month) !== f.mes
          || Number(r.billing_year) !== f.ano
          || String(r.data_vencimento || '').slice(0, 10) !== f.vencimento
        if (!dataErrada && !faturaErrada) continue
        acoes.push({ charge_id: r.charge_id, expense_id: r.expense_id,
          motivo: dataErrada ? 'data_da_parcela' : 'parcela_na_fatura_errada',
          de: String(r.data_compra).slice(0, 10), para: f.data_parcela,
          fatura_de: `${r.billing_month}/${r.billing_year}`, fatura_para: `${f.mes}/${f.ano}`,
          data_compra: f.data_parcela, mes: f.mes, ano: f.ano, vencimento: f.vencimento })
      }
    }
  }

  // ── À vista: fatura fora do ciclo, com a data da compra confiável ──────────
  //
  // Parcelamento NÃO passa por aqui em hipótese alguma: o bloco acima é dono da
  // série inteira. Esta regra recalcula o ciclo a partir de `data_compra`, que
  // numa parcela é uma data já deslocada — e enquanto ela alcançava parcela, o
  // reparo desfazia o próprio trabalho na mesma execução.
  const jaTratado = new Set(acoes.map(a => a.charge_id))
  for (const r of todas) {
    if (importado(r) || jaTratado.has(r.charge_id)) continue
    if (Number(r.total_parcelas) > 1 && r.purchase_group_id) continue
    const dc = String(r.data_compra).slice(0, 10)
    const f = faturaDaCompra(dc, r.dia_fechamento, r.dia_vencimento)
    const precisa = Number(r.billing_month) !== f.mes
      || Number(r.billing_year) !== f.ano
      || String(r.data_vencimento || '').slice(0, 10) !== f.vencimento
    if (precisa) {
      acoes.push({ charge_id: r.charge_id, expense_id: r.expense_id, motivo: 'fatura_fora_do_ciclo',
        de: dc, para: dc, fatura_de: `${r.billing_month}/${r.billing_year}`,
        fatura_para: `${f.mes}/${f.ano}`, data_compra: dc, ...f })
    }
  }

  return acoes
}

// ─── POST /api/cartoes/reparar-faturas ───────────────────────────────────────
// Conserta os dois estragos, cada um com o remédio certo — e nada além disso.
//
// Antes esta rota recalculava a fatura de TODO lançamento a partir da
// data_compra. Rodada sobre uma base com faturas importadas, ela empurraria
// dezenas de lançamentos corretos para a fatura seguinte, porque na
// importação data_compra guarda o VENCIMENTO, não a data da compra. Agora ela
// pula esses, e trata separado o parcelamento que pulou mês — que recalcular
// fatura não resolve, porque a data da própria parcela nasceu errada.
cartoes.post('/reparar-faturas', requireAuth, async (c) => {
  const user = c.get('user')
  const body = await c.req.json().catch(() => ({}))
  const simular = body.simular === true

  const todas = await linhasDeFatura(c.env.DB, user.id)

  const acoes = planejarReparo(todas)

  if (simular) {
    return c.json({
      success: true, simulacao: true, total: acoes.length,
      por_motivo: {
        data_da_parcela: acoes.filter(a => a.motivo === 'data_da_parcela').length,
        parcela_na_fatura_errada: acoes.filter(a => a.motivo === 'parcela_na_fatura_errada').length,
        fatura_fora_do_ciclo: acoes.filter(a => a.motivo === 'fatura_fora_do_ciclo').length,
      },
      ignorados_importados: todas.filter(importado).length,
      acoes: acoes.slice(0, 100),
    })
  }

  for (const a of acoes) {
    await c.env.DB.prepare(
      `UPDATE card_charges SET data_compra = ?, billing_month = ?, billing_year = ?,
       data_vencimento = ? WHERE id = ?`
    ).bind(a.data_compra, a.mes, a.ano, a.vencimento, a.charge_id).run()
    if (a.expense_id) {
      // Para despesa de cartão, `data` é o vencimento da fatura.
      await c.env.DB.prepare(
        `UPDATE despesas SET billing_month = ?, billing_year = ?, vencimento = ?, data = ?
         WHERE id = ? AND user_id = ?`
      ).bind(a.mes, a.ano, a.vencimento, a.vencimento, a.expense_id, user.id).run()
    }
  }

  return c.json({
    success: true,
    corrigidos: acoes.length,
    ignorados_importados: todas.filter(importado).length,
    message: acoes.length
      ? `${acoes.length} lançamento(s) recolocado(s) na fatura certa.`
      : 'Nenhum lançamento estava fora da fatura correta.',
  })
})

// ─── GET /api/cartoes/duplicatas ─────────────────────────────────────────────
//
// "Tenho duas compras iguais no mês de abril de 27, mas é a mesma compra."
//
// Era a única forma de descobrir isto: o usuário abrir a fatura e reparar. Não
// havia relatório, não havia alerta, e o banco não tem constraint que impeça —
// `card_charges` tem só PK e CHECKs, e seis lugares diferentes do código
// inserem parcela. Este endpoint é o olho que faltava.
//
// Ele NÃO apaga nada. Separa em dois casos porque a correção é oposta:
//
//   EMPILHADA  duas parcelas seguidas da mesma compra na mesma fatura (6/12 e
//              7/12 em abril). Nenhuma linha sobra — uma está no mês errado.
//              Conserta-se recolocando, e `reparar-faturas` faz isso.
//
//   EM DOBRO   a mesma parcela gravada duas vezes (6/12 e 6/12). Aí uma linha
//              é lixo de verdade: duplo clique no salvar, reimportação de CSV,
//              lançamento repetido. Só sai com confirmação de quem lançou.
cartoes.get('/duplicatas', requireAuth, async (c) => {
  const user = c.get('user')

  const r = await c.env.DB.prepare(
    `SELECT cc.id as charge_id, cc.expense_id, cc.card_id, cc.descricao, cc.valor,
            cc.data_compra, cc.data_vencimento, cc.billing_month, cc.billing_year,
            cc.parcela_atual, cc.total_parcelas, cc.purchase_group_id, cc.status,
            ct.nome as cartao, ct.dia_fechamento, ct.dia_vencimento
     FROM card_charges cc
     JOIN cartoes ct ON ct.id = cc.card_id
     WHERE ct.user_id = ? AND cc.status != 'cancelado'
     ORDER BY cc.billing_year, cc.billing_month, cc.id`
  ).bind(user.id).all()
  const todas = ((r.results as any[]) || [])

  const fatura = (x: any) => `${x.billing_year}-${String(x.billing_month).padStart(2, '0')}`

  // `reparar-faturas` ignora de propósito o que veio de importação: nessas
  // linhas `data_compra` é o vencimento, não a compra, e recalcular o ciclo a
  // partir dela daria lixo. Mas então o botão "recolocar na fatura certa" não
  // faria nada — e botão que não faz nada é pior que botão que não existe.
  // Por isso cada caso diz se o reparo alcança.
  const importado = (x: any) =>
    String(x.data_compra || '').slice(0, 10) === String(x.data_vencimento || '').slice(0, 10)

  const empilhadas: any[] = []
  const emDobro: any[] = []

  // ── Empilhadas: mesmo grupo de compra, mesma fatura ───────────────────────
  const porGrupoFatura = new Map<string, any[]>()
  for (const x of todas) {
    if (!x.purchase_group_id || !(Number(x.total_parcelas) > 1)) continue
    const k = `${x.purchase_group_id}|${fatura(x)}`
    if (!porGrupoFatura.has(k)) porGrupoFatura.set(k, [])
    porGrupoFatura.get(k)!.push(x)
  }
  for (const itens of porGrupoFatura.values()) {
    if (itens.length < 2) continue
    const parcelas = itens.map(x => Number(x.parcela_atual) || 0)
    const mesmaParcela = new Set(parcelas).size < parcelas.length
    const alvo = mesmaParcela ? emDobro : empilhadas
    alvo.push({
      tipo: mesmaParcela ? 'em_dobro' : 'empilhada',
      cartao: itens[0].cartao,
      fatura: `${itens[0].billing_month}/${itens[0].billing_year}`,
      descricao: String(itens[0].descricao || '').replace(/\s*\(\d+\/\d+\)\s*$/, ''),
      valor_total: Math.round(itens.reduce((s, x) => s + (Number(x.valor) || 0), 0) * 100) / 100,
      // O reparo alcança PARCELAMENTO mesmo quando a linha é importada: a
      // parcela 9 de 10 pertence à fatura da parcela 1 mais oito meses, e isso
      // é contagem, não ciclo — ver a parte 1b de /reparar-faturas. Enquanto
      // isto era `!itens.some(importado)`, a tela listava o problema e ESCONDIA
      // o botão de resolver, mandando corrigir à mão pela tela de Despesas.
      reparo_alcanca: true,
      parcelas: itens.map(x => ({
        charge_id: x.charge_id, expense_id: x.expense_id,
        rotulo: `${x.parcela_atual}/${x.total_parcelas}`,
        valor: Number(x.valor) || 0,
        data_compra: String(x.data_compra || '').slice(0, 10),
      })),
    })
  }

  // ── Em dobro: linhas gêmeas sem grupo em comum ────────────────────────────
  // Mesmo cartão, mesma descrição, mesmo valor, mesma fatura, grupos
  // diferentes (ou nenhum). É a assinatura de um lançamento repetido.
  const porGemea = new Map<string, any[]>()
  for (const x of todas) {
    const k = [x.card_id, String(x.descricao || '').trim().toLowerCase(),
               Number(x.valor).toFixed(2), fatura(x)].join('|')
    if (!porGemea.has(k)) porGemea.set(k, [])
    porGemea.get(k)!.push(x)
  }
  for (const itens of porGemea.values()) {
    if (itens.length < 2) continue
    const grupos = new Set(itens.map(x => x.purchase_group_id || ''))
    // Se todas são do mesmo grupo, o caso já foi classificado acima.
    if (grupos.size === 1 && itens[0].purchase_group_id) continue
    emDobro.push({
      tipo: 'em_dobro', cartao: itens[0].cartao,
      fatura: `${itens[0].billing_month}/${itens[0].billing_year}`,
      descricao: itens[0].descricao,
      valor_total: Math.round(itens.reduce((s, x) => s + (Number(x.valor) || 0), 0) * 100) / 100,
      parcelas: itens.map(x => ({
        charge_id: x.charge_id, expense_id: x.expense_id,
        rotulo: Number(x.total_parcelas) > 1 ? `${x.parcela_atual}/${x.total_parcelas}` : 'à vista',
        valor: Number(x.valor) || 0,
        data_compra: String(x.data_compra || '').slice(0, 10),
      })),
    })
  }

  // ── Buracos: mês sem parcela no meio de um parcelamento ───────────────────
  // O outro lado da mesma moeda. Quando duas parcelas se empilham, um mês fica
  // vazio — e esse é mais difícil de notar, porque falta em vez de sobrar.
  const porGrupo = new Map<string, any[]>()
  for (const x of todas) {
    if (!x.purchase_group_id || !(Number(x.total_parcelas) > 1)) continue
    if (!porGrupo.has(x.purchase_group_id)) porGrupo.set(x.purchase_group_id, [])
    porGrupo.get(x.purchase_group_id)!.push(x)
  }
  const buracos: any[] = []
  for (const itens of porGrupo.values()) {
    const meses = [...new Set(itens.map(x => Number(x.billing_year) * 12 + Number(x.billing_month)))]
      .sort((a, b) => a - b)
    const faltando: string[] = []
    for (let i = 1; i < meses.length; i++) {
      for (let m = meses[i - 1] + 1; m < meses[i]; m++) {
        faltando.push(`${((m - 1) % 12) + 1}/${Math.floor((m - 1) / 12)}`)
      }
    }
    if (faltando.length) {
      buracos.push({
        // O reparo alcança PARCELAMENTO mesmo quando a linha é importada: a
      // parcela 9 de 10 pertence à fatura da parcela 1 mais oito meses, e isso
      // é contagem, não ciclo — ver a parte 1b de /reparar-faturas. Enquanto
      // isto era `!itens.some(importado)`, a tela listava o problema e ESCONDIA
      // o botão de resolver, mandando corrigir à mão pela tela de Despesas.
      reparo_alcanca: true,
        cartao: itens[0].cartao,
        descricao: String(itens[0].descricao || '').replace(/\s*\(\d+\/\d+\)\s*$/, ''),
        parcelas: itens.length, total_parcelas: Number(itens[0].total_parcelas) || 0,
        faturas_sem_parcela: faltando,
      })
    }
  }

  return c.json({
    ok: true,
    total: empilhadas.length + emDobro.length,
    empilhadas, em_dobro: emDobro, buracos,
    // O que fazer com cada caso, escrito aqui para a tela não ter que saber.
    como_resolver: {
      empilhada: 'Nenhuma linha sobra: uma das parcelas está na fatura errada. ' +
        'O reparo de faturas recoloca todas na ordem, uma por mês.',
      em_dobro: 'Uma das linhas é um lançamento repetido e precisa ser excluída. ' +
        'Confira as duas antes — o VerdeMais não apaga lançamento sozinho.',
      buraco: 'Um mês ficou sem parcela. É o outro lado do empilhamento, e o mesmo ' +
        'reparo de faturas resolve.',
      importado: 'Este veio de importação de fatura: a data guardada é a do vencimento, ' +
        'não a da compra. Para um parcelamento isso não impede o reparo — a ordem das ' +
        'parcelas basta para saber a fatura de cada uma.',
    },
  })
})

// ─── GET /api/cartoes/parceladas ─────────────────────────────────────────────
// Todas as compras PARCELADAS de cartão, agregadas por compra (purchase_group).
// Cada linha: valor da parcela, nº de parcelas, valor total, categoria, tags,
// cartão e progresso. Suporta filtros: busca, cartao_id, categoria, status.
cartoes.get('/parceladas', requireAuth, async (c) => {
  const user = c.get('user')
  const cartaoIdRaw = c.req.query('cartao_id')
  if (cartaoIdRaw && !/^\d+$/.test(cartaoIdRaw)) return c.json({ error: 'cartao_id inválido.' }, 400)
  const cartaoId = cartaoIdRaw ? parseInt(cartaoIdRaw, 10) : null
  const busca = (c.req.query('busca') || '').trim().toLowerCase()
  const categoriaFiltro = (c.req.query('categoria') || '').trim().toLowerCase()
  const statusFiltro = c.req.query('status') || '' // 'andamento' | 'quitada'
  const faltamRaw = (c.req.query('faltam') || '').trim() // '1'..'5' exato, '6+' = 6 ou mais
  const evoAnoRaw = c.req.query('evo_ano')
  const evoAno = evoAnoRaw && /^\d{4}$/.test(evoAnoRaw) ? parseInt(evoAnoRaw, 10) : new Date().getFullYear()

  const filtroCartao = cartaoId ? ' AND cc.card_id = ?' : ''
  const binds: any[] = [user.id]
  if (cartaoId) binds.push(cartaoId)

  const rowsR = await c.env.DB.prepare(
    `SELECT cc.id, cc.card_id, cc.expense_id, cc.descricao, cc.valor, cc.data_compra,
            cc.data_vencimento, cc.billing_month, cc.billing_year, cc.parcela_atual,
            cc.total_parcelas, cc.purchase_group_id, cc.status,
            ct.nome as cartao_nome, ct.cor as cartao_cor,
            d.categoria as categoria
     FROM card_charges cc
     JOIN cartoes ct ON ct.id = cc.card_id
     LEFT JOIN despesas d ON d.id = cc.expense_id
     WHERE ct.user_id = ? AND cc.status != 'cancelado'
       AND COALESCE(cc.total_parcelas, 1) > 1${filtroCartao}
     ORDER BY cc.purchase_group_id, cc.parcela_atual`
  ).bind(...binds).all<any>()
  const rows = rowsR.results || []

  // Tags por despesa (expense_id) — 1 query com IN(...)
  const expenseIds = [...new Set(rows.map((r: any) => r.expense_id).filter((x: any) => x != null))]
  const tagsPorDespesa: Record<number, Array<{ nome: string; cor: string }>> = {}
  if (expenseIds.length) {
    const ph = expenseIds.map(() => '?').join(',')
    const tagsR = await c.env.DB.prepare(
      `SELECT dt.despesa_id, t.nome, t.cor
       FROM despesa_tags dt JOIN tags t ON t.id = dt.tag_id
       WHERE dt.despesa_id IN (${ph})`
    ).bind(...expenseIds).all<any>()
    for (const t of (tagsR.results || [])) {
      (tagsPorDespesa[t.despesa_id] ||= []).push({ nome: t.nome, cor: t.cor })
    }
  }

  const NOMES = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez']
  const limpar = (s: string) => String(s || '').replace(/\s*\(\d+\/\d+\)\s*$/, '').trim()
  const round2 = (v: number) => Math.round((Number(v) || 0) * 100) / 100

  // Agrupar por compra
  const grupos: Record<string, any> = {}
  for (const r of rows) {
    const key = r.purchase_group_id || `single-${r.id}`
    let g = grupos[key]
    if (!g) {
      g = grupos[key] = {
        group_id: key, cartao_id: r.card_id, cartao_nome: r.cartao_nome, cartao_cor: r.cartao_cor || '#6EA8FE',
        descricao: limpar(r.descricao) || 'Compra no cartão',
        categoria: r.categoria || null,
        total_declarado: Number(r.total_parcelas) || 0,
        valor_total: 0, valor_parcela: 0, parcelas_pagas: 0, valor_pago: 0,
        parcelas_pendentes: 0, valor_pendente: 0,
        data_compra: r.data_compra || null, _tagIds: new Set<string>(), tags: [] as any[],
        _encerra: null as any, _prox: null as any, _primeira: null as number | null,
        _first: null as any, _last: null as any,
      }
    }
    const v = Number(r.valor) || 0
    const pa = Number(r.parcela_atual) || 0
    g.valor_total += v
    g.total_declarado = Math.max(g.total_declarado, Number(r.total_parcelas) || 0)
    if (r.status === 'pago') { g.parcelas_pagas += 1; g.valor_pago += v }
    else if (r.status === 'pendente') { g.parcelas_pendentes += 1; g.valor_pendente += v }
    // primeira e última parcela REAIS da compra (por parcela_atual), p/ o evolutivo
    if (!g._first || pa < g._first.pa) g._first = { pa, m: r.billing_month, a: r.billing_year, valor: v }
    if (!g._last || pa > g._last.pa) g._last = { pa, m: r.billing_month, a: r.billing_year, valor: v }
    if (g._primeira === null || (Number(r.parcela_atual) || 99) < g._primeira) { g._primeira = Number(r.parcela_atual) || 1; g.valor_parcela = v }
    // última parcela → encerramento
    if (Number(r.parcela_atual) === Number(r.total_parcelas)) {
      g._encerra = { mes: r.billing_month, ano: r.billing_year, label: `${NOMES[(r.billing_month || 1) - 1]}/${String(r.billing_year).slice(2)}` }
    }
    // próxima pendente (menor vencimento)
    if (r.status === 'pendente') {
      if (!g._prox || String(r.data_vencimento || '') < String(g._prox.venc || '9999')) {
        g._prox = { venc: r.data_vencimento, mes: r.billing_month, ano: r.billing_year, valor: v, label: `${NOMES[(r.billing_month || 1) - 1]}/${String(r.billing_year).slice(2)}` }
      }
    }
    // tags (união do grupo)
    if (r.expense_id && tagsPorDespesa[r.expense_id]) {
      for (const t of tagsPorDespesa[r.expense_id]) {
        if (!g._tagIds.has(t.nome)) { g._tagIds.add(t.nome); g.tags.push(t) }
      }
    }
  }

  let compras = Object.values(grupos).map((g: any) => {
    const total = round2(g.valor_total)
    // "Quitada"/"faltam" saem das parcelas que REALMENTE existem (pago + pendente),
    // não do campo total_parcelas — que às vezes vem inconsistente entre as parcelas
    // da mesma compra (ex.: financiamento sincronizado) e fazia uma compra 100% paga
    // aparecer como "faltam 1".
    const geradas = g.parcelas_pagas + g.parcelas_pendentes
    const totalParcelas = Math.max(geradas, 1)
    const parcela = g.valor_parcela > 0 ? round2(g.valor_parcela) : round2(total / totalParcelas)
    const restantes = g.parcelas_pendentes
    const { _tagIds, _encerra, _prox, _primeira, _first, _last, total_declarado, valor_pendente, parcelas_pendentes, ...rest } = g
    return {
      ...rest,
      total_parcelas: totalParcelas,
      total_declarado,
      valor_parcela: parcela,
      valor_total: total,
      valor_pago: round2(g.valor_pago),
      parcelas_restantes: restantes,
      valor_restante: round2(g.valor_pendente),
      quitada: restantes === 0,
      encerra_em: _encerra,
      proxima: _prox ? { mes: _prox.mes, ano: _prox.ano, valor: round2(_prox.valor), label: _prox.label } : null,
    }
  })

  // Filtros em memória
  if (busca) compras = compras.filter(g => g.descricao.toLowerCase().includes(busca))
  if (categoriaFiltro) compras = compras.filter(g => (g.categoria || '').toLowerCase() === categoriaFiltro)
  if (statusFiltro === 'andamento') compras = compras.filter(g => !g.quitada)
  else if (statusFiltro === 'quitada') compras = compras.filter(g => g.quitada)
  if (faltamRaw) {
    if (faltamRaw === '6+') compras = compras.filter(g => (g.parcelas_restantes || 0) >= 6)
    else if (/^\d+$/.test(faltamRaw)) { const n = parseInt(faltamRaw, 10); compras = compras.filter(g => (g.parcelas_restantes || 0) === n) }
  }

  // Ordena: em andamento primeiro, depois por valor restante desc
  compras.sort((a, b) => (Number(a.quitada) - Number(b.quitada)) || (b.valor_restante - a.valor_restante) || (b.valor_total - a.valor_total))

  const categorias = [...new Set(Object.values(grupos).map((g: any) => g.categoria).filter(Boolean))].sort()
  const cartoesLista = [...new Map(rows.map((r: any) => [r.card_id, { id: r.card_id, nome: r.cartao_nome }])).values()]

  // ── Evolutivo mês a mês: parcelas que ENTRAM (1ª parcela de compra nova) vs
  // parcelas que SAEM (última parcela — compra que encerra). Base: todos os
  // grupos (respeita só o filtro de cartão), independente da busca/status. ─────
  const evoMap: Record<string, { a: number; m: number; entramQ: number; entramV: number; saemQ: number; saemV: number }> = {}
  const ensureEvo = (a: number, m: number) => {
    const k = `${a}-${String(m).padStart(2, '0')}`
    return evoMap[k] || (evoMap[k] = { a, m, entramQ: 0, entramV: 0, saemQ: 0, saemV: 0 })
  }
  for (const g of Object.values(grupos) as any[]) {
    if (g._first && g._first.a) { const e = ensureEvo(g._first.a, g._first.m); e.entramQ += 1; e.entramV += g._first.valor }
    if (g._last && g._last.a) { const e = ensureEvo(g._last.a, g._last.m); e.saemQ += 1; e.saemV += g._last.valor }
  }
  const now2 = new Date()
  const nowIdx = now2.getFullYear() * 12 + now2.getMonth() // índice do mês atual
  const anoAtual2 = now2.getFullYear()
  // Ano completo (Jan..Dez) do ano selecionado.
  const evolucao: any[] = []
  for (let m = 1; m <= 12; m++) {
    const i = evoAno * 12 + (m - 1)
    const e = evoMap[`${evoAno}-${String(m).padStart(2, '0')}`]
    const entramV = round2(e?.entramV || 0), saemV = round2(e?.saemV || 0)
    evolucao.push({
      label: `${NOMES[m - 1]}/${String(evoAno).slice(2)}`, mes: m, ano: evoAno, idx: i, futuro: i > nowIdx,
      entram: { qtd: e?.entramQ || 0, valor: entramV },
      saem: { qtd: e?.saemQ || 0, valor: saemV },
      saldo: round2(entramV - saemV),
    })
  }
  // Anos com dados + ano atual e os 2 próximos (para o seletor).
  const anosSet = new Set<number>([anoAtual2, anoAtual2 + 1, anoAtual2 + 2])
  for (const e of Object.values(evoMap)) anosSet.add(e.a)
  const evoAnos = [...anosSet].filter(a => a >= 2020 && a <= 2100).sort((a, b) => a - b)

  return c.json({
    compras,
    resumo: {
      count: compras.length,
      total_pago: round2(compras.reduce((s, g) => s + (g.valor_pago || 0), 0)),
      total_restante: round2(compras.reduce((s, g) => s + (g.quitada ? 0 : g.valor_restante), 0)),
      total_compras: round2(compras.reduce((s, g) => s + g.valor_total, 0)),
      em_andamento: compras.filter(g => !g.quitada).length,
      quitadas: compras.filter(g => g.quitada).length,
    },
    evolucao,
    evo_ano: evoAno,
    evo_anos: evoAnos,
    mes_atual_idx: nowIdx,
    categorias,
    cartoes: cartoesLista,
  })
})

// ─── GET /api/cartoes/pontuais ───────────────────────────────────────────────
// Compras À VISTA (não parceladas) de cartão — cada cobrança é uma compra.
// Espelha /parceladas: resumo (total/pago/pendente), evolutivo mensal por ano,
// filtros (busca, cartão, categoria, status) e insights (gerados no front).
cartoes.get('/pontuais', requireAuth, async (c) => {
  const user = c.get('user')
  const cartaoIdRaw = c.req.query('cartao_id')
  if (cartaoIdRaw && !/^\d+$/.test(cartaoIdRaw)) return c.json({ error: 'cartao_id inválido.' }, 400)
  const cartaoId = cartaoIdRaw ? parseInt(cartaoIdRaw, 10) : null
  const busca = (c.req.query('busca') || '').trim().toLowerCase()
  const categoriaFiltro = (c.req.query('categoria') || '').trim().toLowerCase()
  const statusFiltro = c.req.query('status') || '' // 'pago' | 'pendente'
  const anoRaw = c.req.query('ano')
  const now2 = new Date()
  const anoAtual2 = now2.getFullYear()
  const ano = anoRaw && /^\d{4}$/.test(anoRaw) ? parseInt(anoRaw, 10) : anoAtual2

  const filtroCartao = cartaoId ? ' AND cc.card_id = ?' : ''
  const bindsBase: any[] = [user.id, ano]
  if (cartaoId) bindsBase.push(cartaoId)

  const rowsR = await c.env.DB.prepare(
    `SELECT cc.id, cc.card_id, cc.expense_id, cc.descricao, cc.valor, cc.data_compra,
            cc.billing_month, cc.billing_year, cc.status,
            ct.nome as cartao_nome, ct.cor as cartao_cor,
            d.categoria as categoria
     FROM card_charges cc
     JOIN cartoes ct ON ct.id = cc.card_id
     LEFT JOIN despesas d ON d.id = cc.expense_id
     WHERE ct.user_id = ? AND cc.status != 'cancelado'
       AND COALESCE(cc.total_parcelas, 1) <= 1
       AND cc.billing_year = ?${filtroCartao}
     ORDER BY cc.billing_month DESC, cc.id DESC`
  ).bind(...bindsBase).all<any>()
  const rows = rowsR.results || []

  // Tags por despesa
  const expenseIds = [...new Set(rows.map((r: any) => r.expense_id).filter((x: any) => x != null))]
  const tagsPorDespesa: Record<number, Array<{ nome: string; cor: string }>> = {}
  if (expenseIds.length) {
    const ph = expenseIds.map(() => '?').join(',')
    const tagsR = await c.env.DB.prepare(
      `SELECT dt.despesa_id, t.nome, t.cor
       FROM despesa_tags dt JOIN tags t ON t.id = dt.tag_id
       WHERE dt.despesa_id IN (${ph})`
    ).bind(...expenseIds).all<any>()
    for (const t of (tagsR.results || [])) (tagsPorDespesa[t.despesa_id] ||= []).push({ nome: t.nome, cor: t.cor })
  }

  const NOMES2 = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez']
  const round2b = (v: number) => Math.round((Number(v) || 0) * 100) / 100

  let compras = rows.map((r: any) => ({
    id: r.id,
    descricao: r.descricao || 'Compra no cartão',
    cartao_id: r.card_id,
    cartao_nome: r.cartao_nome,
    cartao_cor: r.cartao_cor || '#6EA8FE',
    categoria: r.categoria || null,
    tags: r.expense_id ? (tagsPorDespesa[r.expense_id] || []) : [],
    valor: round2b(r.valor),
    status: r.status,
    data_compra: r.data_compra || null,
    mes: r.billing_month,
    mes_label: `${NOMES2[(r.billing_month || 1) - 1]}/${String(r.billing_year).slice(2)}`,
  }))

  // Evolutivo mensal (Jan..Dez do ano) — de TODAS as pontuais do ano (só filtro de cartão)
  const evoMap: Record<number, { q: number; v: number; pago: number; pend: number }> = {}
  for (const r of rows) {
    const m = Number(r.billing_month) || 0
    if (m < 1 || m > 12) continue
    const e = evoMap[m] || (evoMap[m] = { q: 0, v: 0, pago: 0, pend: 0 })
    const v = Number(r.valor) || 0
    e.q += 1; e.v += v
    if (r.status === 'pago') e.pago += v
    else if (r.status === 'pendente') e.pend += v
  }
  const nowIdx = anoAtual2 * 12 + now2.getMonth()
  const evolucao = []
  for (let m = 1; m <= 12; m++) {
    const e = evoMap[m]
    evolucao.push({
      label: `${NOMES2[m - 1]}/${String(ano).slice(2)}`, mes: m, ano, idx: ano * 12 + (m - 1), futuro: (ano * 12 + (m - 1)) > nowIdx,
      qtd: e?.q || 0, valor: round2b(e?.v || 0), pago: round2b(e?.pago || 0), pendente: round2b(e?.pend || 0),
    })
  }

  // Filtros em memória (na tabela)
  if (busca) compras = compras.filter(g => g.descricao.toLowerCase().includes(busca))
  if (categoriaFiltro) compras = compras.filter(g => (g.categoria || '').toLowerCase() === categoriaFiltro)
  if (statusFiltro === 'pago') compras = compras.filter(g => g.status === 'pago')
  else if (statusFiltro === 'pendente') compras = compras.filter(g => g.status === 'pendente')
  compras.sort((a, b) => (b.mes - a.mes) || (b.valor - a.valor))

  const total = round2b(compras.reduce((s, g) => s + g.valor, 0))
  const totalPago = round2b(compras.reduce((s, g) => s + (g.status === 'pago' ? g.valor : 0), 0))
  const totalPend = round2b(compras.reduce((s, g) => s + (g.status === 'pendente' ? g.valor : 0), 0))

  // Anos disponíveis
  const anosDataR = await c.env.DB.prepare(
    `SELECT DISTINCT cc.billing_year as ano
     FROM card_charges cc JOIN cartoes ct ON ct.id = cc.card_id
     WHERE ct.user_id = ? AND cc.status != 'cancelado' AND COALESCE(cc.total_parcelas,1) <= 1`
  ).bind(user.id).all<any>()
  const anosSet = new Set<number>([anoAtual2, anoAtual2 - 1])
  for (const r of (anosDataR.results || [])) { const a = Number(r.ano); if (a >= 2020 && a <= 2100) anosSet.add(a) }
  const anos = [...anosSet].sort((a, b) => b - a)

  const categorias = [...new Set(rows.map((r: any) => r.categoria).filter(Boolean))].sort()
  const cartoesLista = [...new Map(rows.map((r: any) => [r.card_id, { id: r.card_id, nome: r.cartao_nome }])).values()]

  return c.json({
    compras,
    resumo: {
      count: compras.length,
      total, total_pago: totalPago, total_pendente: totalPend,
      ticket_medio: compras.length ? round2b(total / compras.length) : 0,
    },
    evolucao,
    ano, anos,
    mes_atual_idx: nowIdx,
    categorias,
    cartoes: cartoesLista,
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
      // A fatura da parcela SEGUE A SÉRIE — não se recalcula a partir da
      // data deslocada. Recalcular empilhava duas parcelas na mesma fatura
      // e deixava o mês seguinte vazio; ver faturaDaParcela().
      const fp = faturaDaParcela(data_compra, cartao.dia_fechamento, cartao.dia_vencimento, i - 1)
      const parcelaDateStr = fp.data_parcela
      const bMonth = fp.mes, bYear = fp.ano
      const dataVenc = fp.vencimento
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
