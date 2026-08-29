import { Hono } from 'hono'
import { filtroDespesaDoMes } from '../lib/competencia'
import { requireAuth } from './auth'

type Bindings = { DB: D1Database }
type Variables = { user: { id: number; nome: string; email: string; plano: string } }

const orcamentos = new Hono<{ Bindings: Bindings; Variables: Variables }>()

// ── Validação de entrada (Postgres é estrito: NaN passa no CHECK, id/ mes não
// numérico estoura 500). Barra na porta. ──────────────────────────────────────
const MAX_VALOR = 1_000_000_000
function parseLimite(valor: unknown): number | null {
  if (typeof valor === 'string' && !/^\d+(\.\d+)?$/.test(valor.trim())) return null
  const n = typeof valor === 'number' ? valor : parseFloat(String(valor))
  if (!Number.isFinite(n) || n <= 0 || n > MAX_VALOR) return null
  return Math.round(n * 100) / 100
}
function parseMes(valor: unknown): number | null {
  const n = parseInt(String(valor ?? ''), 10)
  return Number.isInteger(n) && n >= 1 && n <= 12 ? n : null
}
function parseAno(valor: unknown): number | null {
  const n = parseInt(String(valor ?? ''), 10)
  return Number.isInteger(n) && n >= 2000 && n <= 2100 ? n : null
}
function parseId(valor: unknown): number | null {
  const t = String(valor ?? '')
  return /^\d+$/.test(t) && parseInt(t, 10) > 0 ? parseInt(t, 10) : null
}
const ERRO_PERIODO = 'Período inválido: mes deve ser 1–12 e ano entre 2000 e 2100.'
const MSG_FREE_ORC = { error: 'Orçamentos são exclusivos do plano Premium.', upgrade: true }

// ─── Categorias disponíveis (sync com despesas) ───────────────────────────────
const CATEGORIAS = [
  'alimentacao', 'moradia', 'transporte', 'saude', 'educacao',
  'lazer', 'vestuario', 'beleza', 'pets', 'assinaturas',
  'tecnologia', 'viagem', 'outros', 'fixo', 'supermercado'
]

const CATEGORIAS_LABEL: Record<string, string> = {
  alimentacao: 'Alimentação', moradia: 'Moradia',
  transporte: 'Transporte', saude: 'Saúde',
  educacao: 'Educação', lazer: 'Lazer',
  vestuario: 'Vestuário', beleza: 'Beleza',
  pets: 'Pets', assinaturas: 'Assinaturas',
  tecnologia: 'Tecnologia', viagem: 'Viagens',
  outros: 'Outros', fixo: 'Gastos Fixos',
  supermercado: 'Supermercado'
}

const CATEGORIAS_EMOJI: Record<string, string> = {
  alimentacao: '🍽️', moradia: '🏠', transporte: '🚗', saude: '🏥',
  educacao: '📚', lazer: '🎮', vestuario: '👕', beleza: '💄',
  pets: '🐾', assinaturas: '📱', tecnologia: '💻', viagem: '✈️',
  outros: '📦', fixo: '📌', supermercado: '🛒'
}

// Normaliza string para comparação: remove acentos e coloca em lowercase
function normCat(s: string): string {
  return s.toLowerCase()
    .replace(/[ãâáàä]/g, 'a').replace(/[çÇ]/g, 'c')
    .replace(/[éêèë]/g, 'e').replace(/[íîï]/g, 'i')
    .replace(/[óôõö]/g, 'o').replace(/[úûü]/g, 'u')
}

// SQL para normalizar categoria no banco (SQLite não tem suporte nativo a unicode folding)
function normSQL(col: string): string {
  const subs: [string, string][] = [
    ['\u00e3','a'],['\u00e2','a'],['\u00e1','a'],['\u00e0','a'],['\u00e4','a'],
    ['\u00e7','c'],
    ['\u00e9','e'],['\u00ea','e'],['\u00e8','e'],['\u00eb','e'],
    ['\u00ed','i'],['\u00ee','i'],['\u00ef','i'],
    ['\u00f3','o'],['\u00f4','o'],['\u00f5','o'],['\u00f6','o'],
    ['\u00fa','u'],['\u00fb','u'],['\u00fc','u'],
  ]
  let expr = col
  for (const [from, to] of subs) {
    expr = `REPLACE(${expr},char(${from.charCodeAt(0)}),'${to}')`
  }
  return `LOWER(${expr})`
}

// ─── Helper: calcula gastos reais de uma categoria num período ────────────────
async function getGastoCategoria(db: D1Database, userId: number, catNorm: string, mes: number, ano: number): Promise<number> {
  const normExpr = normSQL('categoria')
  const mesStr = String(mes).padStart(2,'0')
  const anoStr = String(ano)
  const raw = await db.prepare(
    `SELECT COALESCE(SUM(valor), 0) as total FROM despesas ` +
    `WHERE user_id = ? ` +
    `AND ${normExpr} = ? ` +
    filtroDespesaDoMes() +
    ` AND status IN ('pago', 'pendente')`
  ).bind(userId, catNorm, mesStr, anoStr).first() as any
  return Number(raw?.total || 0)
}

// ─── Helper: busca gasto total do mês (todas categorias) ─────────────────────
async function getGastoGlobal(db: D1Database, userId: number, mes: number, ano: number): Promise<number> {
  const mesStr = String(mes).padStart(2,'0')
  const raw = await db.prepare(
    `SELECT COALESCE(SUM(valor), 0) as total FROM despesas ` +
    `WHERE user_id = ? ` +
    filtroDespesaDoMes() +
    ` AND status IN ('pago', 'pendente')`
  ).bind(userId, mesStr, String(ano)).first() as any
  return Number(raw?.total || 0)
}

// ─── Helper: calcula rollover (saldo não gasto do mês anterior) ───────────────
async function getRolloverCategoria(db: D1Database, userId: number, cat: string, mes: number, ano: number): Promise<number> {
  const row = await db.prepare(
    `SELECT saldo_rollover FROM orcamento_rollover WHERE user_id=? AND categoria=? AND mes_destino=? AND ano_destino=?`
  ).bind(userId, cat, mes, ano).first() as any
  return Number(row?.saldo_rollover || 0)
}

// ─── Helper: calcula média dos gastos dos últimos N meses por categoria ────────
async function getSugestaoCategoria(db: D1Database, userId: number, catNorm: string, mesAtual: number, anoAtual: number, meses = 3): Promise<number | null> {
  const periodos: { mes: number; ano: number }[] = []
  for (let i = 1; i <= meses; i++) {
    const d = new Date(anoAtual, mesAtual - 1 - i, 1)
    periodos.push({ mes: d.getMonth() + 1, ano: d.getFullYear() })
  }
  const gastos: number[] = []
  for (const p of periodos) {
    const g = await getGastoCategoria(db, userId, catNorm, p.mes, p.ano)
    if (g > 0) gastos.push(g)
  }
  if (gastos.length === 0) return null
  return Math.round(gastos.reduce((a, b) => a + b, 0) / gastos.length * 100) / 100
}

// ─── Helper: dispara alertas progressivos e retorna nível ────────────────────
async function dispararAlertasProgressivos(db: D1Database, orc: any, percentual: number): Promise<{ nivel: string; novo: boolean }> {
  let nivel = 'ok'
  let novo = false

  if (percentual >= 100 && !orc.alerta_100_disparado) {
    nivel = 'exceeded'
    novo = true
    await db.prepare(`UPDATE orcamentos SET alerta_100_disparado=1, alerta_disparado=1 WHERE id=?`).bind(orc.id).run()
  } else if (percentual >= 90 && !orc.alerta_90_disparado) {
    nivel = 'warning_90'
    novo = true
    await db.prepare(`UPDATE orcamentos SET alerta_90_disparado=1 WHERE id=?`).bind(orc.id).run()
  } else if (percentual >= 70 && !orc.alerta_70_disparado) {
    nivel = 'warning_70'
    novo = true
    await db.prepare(`UPDATE orcamentos SET alerta_70_disparado=1 WHERE id=?`).bind(orc.id).run()
  } else {
    nivel = percentual >= 100 ? 'exceeded' : percentual >= 90 ? 'warning_90' : percentual >= 70 ? 'warning_70' : percentual >= (Number(orc.alerta_percentual) || 80) ? 'attention' : 'ok'
  }

  return { nivel, novo }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/orcamentos?mes=3&ano=2026
// ─────────────────────────────────────────────────────────────────────────────
orcamentos.get('/', requireAuth, async (c) => {
  const user = c.get('user')
  const mesQ = c.req.query('mes'); const anoQ = c.req.query('ano')
  const mes  = mesQ === undefined ? new Date().getMonth() + 1 : parseMes(mesQ)
  const ano  = anoQ === undefined ? new Date().getFullYear() : parseAno(anoQ)
  if (mes === null || ano === null) return c.json({ error: ERRO_PERIODO }, 400)

  const orcs = await c.env.DB.prepare(
    'SELECT * FROM orcamentos WHERE user_id = ? AND mes = ? AND ano = ? ORDER BY categoria'
  ).bind(user.id, mes, ano).all()

  // Buscar orçamento global
  const globalRow = await c.env.DB.prepare(
    'SELECT * FROM orcamento_global WHERE user_id = ? AND mes = ? AND ano = ?'
  ).bind(user.id, mes, ano).first() as any

  const gastoGlobal = await getGastoGlobal(c.env.DB, user.id, mes, ano)
  const rolloverGlobal = globalRow ? await getRolloverCategoria(c.env.DB, user.id, 'GLOBAL', mes, ano) : 0
  const limiteGlobalEfetivo = globalRow ? (Number(globalRow.limite_global) + rolloverGlobal) : 0
  // O2: limite efetivo <= 0 (rollover negativo estourou o mês) já é "excedido".
  const globalExcedido = globalRow ? (limiteGlobalEfetivo > 0 ? gastoGlobal > limiteGlobalEfetivo : true) : false
  const percentualGlobal = limiteGlobalEfetivo > 0 ? Math.round((gastoGlobal / limiteGlobalEfetivo) * 100) : (globalExcedido ? 100 : 0)

  const result = []
  for (const o of (orcs.results as any[])) {
    const catNorm    = normCat(o.categoria)
    const gasto_real = await getGastoCategoria(c.env.DB, user.id, catNorm, mes, ano)
    const rollover   = await getRolloverCategoria(c.env.DB, user.id, catNorm, mes, ano)
    const limiteBase = Number(o.limite)
    const limiteEfetivo = limiteBase + rollover
    const alertaP = (Number(o.alerta_percentual) || 80) / 100

    // O11: status derivado da razão real — Math.round(99.5)=100 dizia "Excedido"
    // com dinheiro sobrando. O2: efetivo <= 0 conta como excedido de imediato.
    // O5: a leitura NÃO grava mais flags de alerta; status é cálculo puro.
    const excedido = limiteEfetivo > 0 ? gasto_real > limiteEfetivo : (limiteBase > 0)
    const ratio = limiteEfetivo > 0 ? gasto_real / limiteEfetivo : (excedido ? 1 : 0)
    const percentual = limiteEfetivo > 0 ? Math.round(ratio * 100) : (excedido ? 100 : 0)

    const status =
      excedido        ? 'exceeded'   :
      ratio >= 0.90   ? 'warning_90' :
      ratio >= 0.70   ? 'warning_70' :
      ratio >= alertaP ? 'attention' : 'ok'

    // Sugestão baseada nos últimos 3 meses
    const sugestao = await getSugestaoCategoria(c.env.DB, user.id, catNorm, mes, ano)

    const emoji = CATEGORIAS_EMOJI[catNorm] || '📦'
    const label = CATEGORIAS_LABEL[catNorm] || o.categoria

    result.push({
      ...o,
      limite: limiteBase,
      limite_efetivo: limiteEfetivo,  // limite + rollover
      rollover,
      gasto: gasto_real,
      restante: Math.max(0, limiteEfetivo - gasto_real),
      restante_real: limiteEfetivo - gasto_real,  // pode ser negativo
      percentual,
      status,
      nivel_alerta: status,
      alerta_ativo: false,   // O5: notificar é trabalho de job, não de GET
      excedido,
      sugestao,  // média dos 3 meses anteriores ou null
      label: `${emoji} ${label}`
    })
  }

  const comOrcamento = result.map(r => normCat(r.categoria))
  // Sugestões para categorias sem orçamento
  const semOrcamento = await Promise.all(
    CATEGORIAS
      .filter(cat => !comOrcamento.includes(cat))
      .map(async cat => {
        const sug = await getSugestaoCategoria(c.env.DB, user.id, cat, mes, ano)
        return {
          categoria: cat,
          label: `${CATEGORIAS_EMOJI[cat] || '📦'} ${CATEGORIAS_LABEL[cat] || cat}`,
          sugestao: sug
        }
      })
  )

  return c.json({
    orcamentos: result,
    semOrcamento,
    mes, ano,
    global: globalRow ? {
      id: globalRow.id,
      limite: Number(globalRow.limite_global),
      limite_efetivo: limiteGlobalEfetivo,
      rollover: rolloverGlobal,
      gasto: gastoGlobal,
      restante: Math.max(0, limiteGlobalEfetivo - gastoGlobal),
      percentual: percentualGlobal,
      status: globalExcedido ? 'exceeded' : percentualGlobal >= 90 ? 'warning_90' : percentualGlobal >= 70 ? 'warning_70' : percentualGlobal >= 80 ? 'attention' : 'ok',
      rollover_ativo: Boolean(globalRow.rollover)
    } : null
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/orcamentos/resumo
// ─────────────────────────────────────────────────────────────────────────────
orcamentos.get('/resumo', requireAuth, async (c) => {
  const user = c.get('user')
  const mesQ = c.req.query('mes'); const anoQ = c.req.query('ano')
  const mes  = mesQ === undefined ? new Date().getMonth() + 1 : parseMes(mesQ)
  const ano  = anoQ === undefined ? new Date().getFullYear() : parseAno(anoQ)
  if (mes === null || ano === null) return c.json({ error: ERRO_PERIODO }, 400)

  const total = await c.env.DB.prepare(
    'SELECT COUNT(*) as qtd, SUM(limite) as total_limite FROM orcamentos WHERE user_id = ? AND mes = ? AND ano = ?'
  ).bind(user.id, mes, ano).first() as any

  const normD = normSQL('d.categoria')
  const normO = normSQL('o.categoria')
  const mesStr = String(mes).padStart(2,'0')
  const anoStr = String(ano)

  const gasto = await c.env.DB.prepare(
    `SELECT COALESCE(SUM(d.valor), 0) as total ` +
    `FROM despesas d ` +
    `INNER JOIN orcamentos o ON ${normD} = ${normO} AND o.user_id = d.user_id ` +
    `WHERE d.user_id = ? AND o.mes = ? AND o.ano = ? ` +
    filtroDespesaDoMes('d') +
    ` AND d.status IN ('pago', 'pendente')`
  ).bind(user.id, mes, ano, mesStr, anoStr).first() as any

  return c.json({
    qtd_orcamentos: total?.qtd || 0,
    total_limite: Number(total?.total_limite || 0),
    total_gasto: Number(gasto?.total || 0),
    mes, ano
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/orcamentos/verificar-despesa?categoria=X&valor=Y&mes=M&ano=A
// Verifica se lançar uma despesa ultrapassaria algum orçamento (bloqueio proativo)
// ─────────────────────────────────────────────────────────────────────────────
orcamentos.get('/verificar-despesa', requireAuth, async (c) => {
  const user     = c.get('user')
  const catRaw   = c.req.query('categoria') || ''
  const valor    = parseFloat(c.req.query('valor') || '0')
  const mesQ = c.req.query('mes'); const anoQ = c.req.query('ano')
  const mes  = mesQ === undefined ? new Date().getMonth() + 1 : parseMes(mesQ)
  const ano  = anoQ === undefined ? new Date().getFullYear() : parseAno(anoQ)
  if (mes === null || ano === null) return c.json({ error: ERRO_PERIODO }, 400)

  if (!catRaw) {
    return c.json({ error: 'Parâmetro obrigatório: categoria' }, 400)
  }
  if (isNaN(valor) || valor <= 0) {
    return c.json({ error: 'Parâmetro obrigatório: valor (deve ser maior que zero)' }, 400)
  }

  const catNorm = normCat(catRaw)
  const avisos: any[] = []

  // 1. Verificar orçamento da categoria
  const orc = await c.env.DB.prepare(
    `SELECT * FROM orcamentos WHERE user_id=? AND mes=? AND ano=? AND ${normSQL('categoria')}=?`
  ).bind(user.id, mes, ano, catNorm).first() as any

  if (orc) {
    const gastoAtual = await getGastoCategoria(c.env.DB, user.id, catNorm, mes, ano)
    const rollover   = await getRolloverCategoria(c.env.DB, user.id, catNorm, mes, ano)
    const limiteEf   = Number(orc.limite) + rollover
    const novoTotal  = gastoAtual + valor
    const pctAtual   = limiteEf > 0 ? Math.round((gastoAtual / limiteEf) * 100) : 0
    const pctNovo    = limiteEf > 0 ? Math.round((novoTotal / limiteEf) * 100) : 0

    if (pctNovo >= 100) {
      avisos.push({
        tipo: 'excede_categoria',
        nivel: 'error',
        categoria: catRaw,
        label: `${CATEGORIAS_EMOJI[catNorm] || '📦'} ${CATEGORIAS_LABEL[catNorm] || catRaw}`,
        limite: limiteEf,
        gasto_atual: gastoAtual,
        valor_novo: valor,
        novo_total: novoTotal,
        percentual_atual: pctAtual,
        percentual_novo: pctNovo,
        mensagem: `Esta despesa fará você ultrapassar o orçamento de ${CATEGORIAS_LABEL[catNorm] || catRaw} (${pctNovo}% do limite de R$ ${limiteEf.toFixed(2)})`
      })
    } else if (pctNovo >= 90) {
      avisos.push({
        tipo: 'alerta_90_categoria',
        nivel: 'warning',
        categoria: catRaw,
        label: `${CATEGORIAS_EMOJI[catNorm] || '📦'} ${CATEGORIAS_LABEL[catNorm] || catRaw}`,
        percentual_novo: pctNovo,
        mensagem: `Com esta despesa você atingirá ${pctNovo}% do orçamento de ${CATEGORIAS_LABEL[catNorm] || catRaw}`
      })
    } else if (pctNovo >= 70) {
      avisos.push({
        tipo: 'alerta_70_categoria',
        nivel: 'info',
        categoria: catRaw,
        label: `${CATEGORIAS_EMOJI[catNorm] || '📦'} ${CATEGORIAS_LABEL[catNorm] || catRaw}`,
        percentual_novo: pctNovo,
        mensagem: `Com esta despesa você atingirá ${pctNovo}% do orçamento de ${CATEGORIAS_LABEL[catNorm] || catRaw}`
      })
    }
  }

  // 2. Verificar orçamento global
  const globalOrc = await c.env.DB.prepare(
    'SELECT * FROM orcamento_global WHERE user_id=? AND mes=? AND ano=?'
  ).bind(user.id, mes, ano).first() as any

  if (globalOrc) {
    const gastoGlobal = await getGastoGlobal(c.env.DB, user.id, mes, ano)
    const rolloverG   = await getRolloverCategoria(c.env.DB, user.id, 'GLOBAL', mes, ano)
    const limiteGEf   = Number(globalOrc.limite_global) + rolloverG
    const novoGlobal  = gastoGlobal + valor
    const pctGNovo    = limiteGEf > 0 ? Math.round((novoGlobal / limiteGEf) * 100) : 0

    if (pctGNovo >= 100) {
      avisos.push({
        tipo: 'excede_global',
        nivel: 'error',
        limite: limiteGEf,
        gasto_atual: gastoGlobal,
        percentual_novo: pctGNovo,
        mensagem: `Esta despesa fará você ultrapassar o orçamento global do mês (${pctGNovo}% de R$ ${limiteGEf.toFixed(2)})`
      })
    } else if (pctGNovo >= 90) {
      avisos.push({
        tipo: 'alerta_90_global',
        nivel: 'warning',
        percentual_novo: pctGNovo,
        mensagem: `Com esta despesa você atingirá ${pctGNovo}% do orçamento global`
      })
    }
  }

  const temErro = avisos.some(a => a.nivel === 'error')
  return c.json({ ok: !temErro, avisos, pode_lancar: !temErro })
})

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/orcamentos/sugestoes?mes=M&ano=A
// Retorna sugestão de limite para cada categoria baseado nos 3 meses anteriores
// ─────────────────────────────────────────────────────────────────────────────
orcamentos.get('/sugestoes', requireAuth, async (c) => {
  const user = c.get('user')
  const mes  = parseInt(c.req.query('mes')  || String(new Date().getMonth() + 1))
  const ano  = parseInt(c.req.query('ano')  || String(new Date().getFullYear()))

  const sugestoes: Record<string, any> = {}
  for (const cat of CATEGORIAS) {
    const media = await getSugestaoCategoria(c.env.DB, user.id, cat, mes, ano)
    if (media !== null) {
      sugestoes[cat] = {
        categoria: cat,
        label: `${CATEGORIAS_EMOJI[cat] || '📦'} ${CATEGORIAS_LABEL[cat] || cat}`,
        sugestao: media,
        sugestao_com_margem: Math.round(media * 1.1 * 100) / 100  // +10% de margem
      }
    }
  }
  return c.json({ sugestoes, mes, ano })
})

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/orcamentos/historico?categoria=alimentacao&meses=6
// ─────────────────────────────────────────────────────────────────────────────
orcamentos.get('/historico', requireAuth, async (c) => {
  const user      = c.get('user')
  const catRaw    = c.req.query('categoria') || ''
  // O17: meses='abc' virava NaN → série vazia e meses:null. Clampa em [1,24].
  const meses     = Math.min(Math.max(1, parseInt(c.req.query('meses') || '6', 10) || 6), 24)

  if (!catRaw) {
    return c.json({ error: 'Parâmetro obrigatório: categoria' }, 400)
  }

  const periodos: { mes: number; ano: number; label: string }[] = []
  const ref = new Date()
  for (let i = meses - 1; i >= 0; i--) {
    const d = new Date(ref.getFullYear(), ref.getMonth() - i, 1)
    periodos.push({ mes: d.getMonth() + 1, ano: d.getFullYear(), label: `${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}` })
  }

  if (catRaw) {
    const cat = normCat(catRaw)
    const serie = []
    for (const p of periodos) {
      const orc = await c.env.DB.prepare(
        'SELECT limite, alerta_percentual, notas FROM orcamentos WHERE user_id = ? AND mes = ? AND ano = ? AND ' + normSQL('categoria') + ' = ?'
      ).bind(user.id, p.mes, p.ano, cat).first() as any

      const gasto    = await getGastoCategoria(c.env.DB, user.id, cat, p.mes, p.ano)
      const rollover = await getRolloverCategoria(c.env.DB, user.id, cat, p.mes, p.ano)
      const limite   = Number(orc?.limite || 0)
      const limiteEf = limite + rollover
      serie.push({
        ...p,
        limite,
        limite_efetivo: limiteEf,
        rollover,
        gasto: Math.round(gasto * 100) / 100,
        percentual: limiteEf > 0 ? Math.round((gasto / limiteEf) * 100) : null,
        status: !limiteEf ? 'sem_orcamento' : gasto > limiteEf ? 'exceeded' : gasto >= limiteEf * (Number(orc?.alerta_percentual || 80) / 100) ? 'warning' : 'ok',
        notas: orc?.notas || null
      })
    }
    return c.json({
      categoria: cat,
      label: `${CATEGORIAS_EMOJI[cat] || '📦'} ${CATEGORIAS_LABEL[cat] || catRaw}`,
      serie,
      meses
    })
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/orcamentos/global — criar/atualizar orçamento global
// Body: { mes, ano, limite_global, rollover? }
// ─────────────────────────────────────────────────────────────────────────────
orcamentos.post('/global', requireAuth, async (c) => {
  const user = c.get('user')

  if (user.plano === 'free') {
    return c.json({ error: 'Orçamentos são exclusivos do plano Premium.', upgrade: true }, 403)
  }

  const { mes: mesRaw, ano: anoRaw, limite_global, rollover = false } = await c.req.json()

  const mes = parseMes(mesRaw); const ano = parseAno(anoRaw)
  if (mes === null || ano === null) return c.json({ error: ERRO_PERIODO }, 400)
  // O1: 'abc' → NaN passava (Number('abc')<=0 é false e Postgres aceita NaN).
  const limiteNum = parseLimite(limite_global)
  if (limiteNum === null) return c.json({ error: 'limite_global deve ser um número maior que zero.' }, 400)

  await c.env.DB.prepare(
    `INSERT INTO orcamento_global (user_id, mes, ano, limite_global, rollover, updated_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(user_id, mes, ano)
     DO UPDATE SET limite_global=excluded.limite_global, rollover=excluded.rollover, updated_at=datetime('now')`
  ).bind(user.id, mes, ano, limiteNum, rollover ? 1 : 0).run()

  const row = await c.env.DB.prepare(
    'SELECT * FROM orcamento_global WHERE user_id=? AND mes=? AND ano=?'
  ).bind(user.id, mes, ano).first()

  return c.json({ success: true, global: row })
})

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/orcamentos/global?mes=M&ano=A — remover orçamento global
// ─────────────────────────────────────────────────────────────────────────────
orcamentos.delete('/global', requireAuth, async (c) => {
  const user = c.get('user')
  if (user.plano === 'free') return c.json(MSG_FREE_ORC, 403)   // O14: free não apaga o global
  const mesQ = c.req.query('mes'); const anoQ = c.req.query('ano')
  const mes  = mesQ === undefined ? new Date().getMonth() + 1 : parseMes(mesQ)
  const ano  = anoQ === undefined ? new Date().getFullYear() : parseAno(anoQ)
  if (mes === null || ano === null) return c.json({ error: ERRO_PERIODO }, 400)

  // O16: informa se realmente havia algo para remover, em vez de mentir "removido".
  const existia = await c.env.DB.prepare(
    'SELECT id FROM orcamento_global WHERE user_id=? AND mes=? AND ano=?'
  ).bind(user.id, mes, ano).first()

  await c.env.DB.prepare(
    'DELETE FROM orcamento_global WHERE user_id=? AND mes=? AND ano=?'
  ).bind(user.id, mes, ano).run()

  return c.json({ success: true, removido: !!existia })
})

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/orcamentos/calcular-rollover
// Calcula e salva o rollover do mês anterior para o mês atual
// Body: { mes_origem, ano_origem }  → cria rollover para mes_destino (seguinte)
// ─────────────────────────────────────────────────────────────────────────────
orcamentos.post('/calcular-rollover', requireAuth, async (c) => {
  const user = c.get('user')

  if (user.plano === 'free') {
    return c.json({ error: 'Rollover é exclusivo do plano Premium.', upgrade: true }, 403)
  }

  const body = await c.req.json()
  // O13: mes_origem=99 gerava destino "4/2034". Valida faixa 1–12 / ano real.
  const mesO = parseMes(body.mes_origem)
  const anoO = parseAno(body.ano_origem)

  if (mesO === null || anoO === null) return c.json({ error: ERRO_PERIODO }, 400)

  // Calcular mês destino (próximo mês)
  const dDest = new Date(anoO, mesO, 1)  // next month
  const mesD  = dDest.getMonth() + 1
  const anoD  = dDest.getFullYear()

  const rollovers: any[] = []

  // Orçamentos por categoria
  const orcsOrigem = await c.env.DB.prepare(
    'SELECT * FROM orcamentos WHERE user_id=? AND mes=? AND ano=?'
  ).bind(user.id, mesO, anoO).all()

  for (const orc of (orcsOrigem.results as any[])) {
    const catNorm   = normCat(orc.categoria)
    const gasto     = await getGastoCategoria(c.env.DB, user.id, catNorm, mesO, anoO)
    const rolloverAnt = await getRolloverCategoria(c.env.DB, user.id, catNorm, mesO, anoO)
    const limiteEf  = Number(orc.limite) + rolloverAnt
    const saldo     = limiteEf - gasto  // positivo = sobrou, negativo = excedeu

    if (saldo !== 0) {
      await c.env.DB.prepare(
        `INSERT INTO orcamento_rollover (user_id, categoria, mes_origem, ano_origem, mes_destino, ano_destino, saldo_rollover)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id, categoria, mes_destino, ano_destino)
         DO UPDATE SET saldo_rollover=excluded.saldo_rollover`
      ).bind(user.id, catNorm, mesO, anoO, mesD, anoD, saldo).run()
      rollovers.push({ categoria: catNorm, saldo })
    }
  }

  // Orçamento global
  const globalO = await c.env.DB.prepare(
    'SELECT * FROM orcamento_global WHERE user_id=? AND mes=? AND ano=?'
  ).bind(user.id, mesO, anoO).first() as any

  if (globalO && globalO.rollover) {
    const gastoG    = await getGastoGlobal(c.env.DB, user.id, mesO, anoO)
    const rollAnt   = await getRolloverCategoria(c.env.DB, user.id, 'GLOBAL', mesO, anoO)
    const limiteGEf = Number(globalO.limite_global) + rollAnt
    const saldoG    = limiteGEf - gastoG

    await c.env.DB.prepare(
      `INSERT INTO orcamento_rollover (user_id, categoria, mes_origem, ano_origem, mes_destino, ano_destino, saldo_rollover)
       VALUES (?, 'GLOBAL', ?, ?, ?, ?, ?)
       ON CONFLICT(user_id, categoria, mes_destino, ano_destino)
       DO UPDATE SET saldo_rollover=excluded.saldo_rollover`
    ).bind(user.id, mesO, anoO, mesD, anoD, saldoG).run()
    rollovers.push({ categoria: 'GLOBAL', saldo: saldoG })
  }

  return c.json({
    success: true,
    mes_origem: `${mesO}/${anoO}`,
    mes_destino: `${mesD}/${anoD}`,
    rollovers
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/orcamentos/copiar-mes
// ─────────────────────────────────────────────────────────────────────────────
orcamentos.post('/copiar-mes', requireAuth, async (c) => {
  const user = c.get('user')

  if (user.plano === 'free') {
    return c.json({ error: 'Orçamentos são exclusivos do plano Premium.', upgrade: true }, 403)
  }

  const body = await c.req.json()
  const { mes_origem, ano_origem, mes_destino, ano_destino, sobrescrever = false } = body

  if (!mes_origem || !ano_origem || !mes_destino || !ano_destino)
    return c.json({ error: 'Campos obrigatórios: mes_origem, ano_origem, mes_destino, ano_destino' }, 400)

  const mesO = parseMes(mes_origem); const anoO = parseAno(ano_origem)
  const mesD = parseMes(mes_destino); const anoD = parseAno(ano_destino)

  if (mesO === null || anoO === null || mesD === null || anoD === null)
    return c.json({ error: ERRO_PERIODO }, 400)

  const origem = await c.env.DB.prepare(
    'SELECT * FROM orcamentos WHERE user_id = ? AND mes = ? AND ano = ?'
  ).bind(user.id, mesO, anoO).all()

  if ((origem.results as any[]).length === 0)
    return c.json({ error: `Nenhum orçamento encontrado em ${mesO}/${anoO}` }, 404)

  let copiados = 0; let ignorados = 0
  for (const o of (origem.results as any[])) {
    const catNorm = normCat(o.categoria)
    if (!sobrescrever) {
      const existe = await c.env.DB.prepare(
        'SELECT id FROM orcamentos WHERE user_id = ? AND ' + normSQL('categoria') + ' = ? AND mes = ? AND ano = ?'
      ).bind(user.id, catNorm, mesD, anoD).first()
      if (existe) { ignorados++; continue }
    }

    await c.env.DB.prepare(
      `INSERT INTO orcamentos (user_id, categoria, mes, ano, limite, alerta_percentual, notas, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(user_id, categoria, mes, ano)
       DO UPDATE SET limite = excluded.limite, alerta_percentual = excluded.alerta_percentual, notas = excluded.notas, updated_at = datetime('now')`
    ).bind(user.id, catNorm, mesD, anoD, o.limite, o.alerta_percentual, o.notas || null).run()
    copiados++
  }

  return c.json({
    success: true,
    copiados,
    ignorados,
    message: `${copiados} orçamento(s) copiado(s) de ${mesO}/${anoO} → ${mesD}/${anoD}${ignorados > 0 ? `, ${ignorados} ignorado(s) (já existiam)` : ''}.`
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/orcamentos  (upsert por categoria)
// ─────────────────────────────────────────────────────────────────────────────
orcamentos.post('/', requireAuth, async (c) => {
  const user = c.get('user')

  if (user.plano === 'free') {
    return c.json({ error: 'Orçamentos por categoria são exclusivos do plano Premium.', upgrade: true, feature: 'orcamentos' }, 403)
  }

  const { categoria: categoriaRaw, mes: mesRaw, ano: anoRaw, limite, alerta_percentual = 80, notas } = await c.req.json()

  if (!categoriaRaw || limite === undefined || limite === null || limite === '')
    return c.json({ error: 'Campos obrigatórios: categoria, mes, ano, limite' }, 400)

  const mes = parseMes(mesRaw); const ano = parseAno(anoRaw)
  if (mes === null || ano === null) return c.json({ error: ERRO_PERIODO }, 400)

  const categoria = normCat(String(categoriaRaw))

  if (!CATEGORIAS.includes(categoria))
    return c.json({ error: `Categoria inválida. Aceitas: ${CATEGORIAS.join(', ')}` }, 400)
  // O1: parseLimite recusa NaN, ∞, negativo e acima do teto.
  const limiteNum = parseLimite(limite)
  if (limiteNum === null)
    return c.json({ error: 'Limite deve ser um número maior que zero.' }, 400)
  const alertaNum = Number(alerta_percentual)
  if (isNaN(alertaNum) || alertaNum < 50 || alertaNum > 100)
    return c.json({ error: 'alerta_percentual deve ser entre 50 e 100' }, 400)

  const existing = await c.env.DB.prepare(
    'SELECT id FROM orcamentos WHERE user_id = ? AND categoria = ? AND mes = ? AND ano = ?'
  ).bind(user.id, categoria, mes, ano).first()
  const isUpdate = !!existing

  await c.env.DB.prepare(
    `INSERT INTO orcamentos (user_id, categoria, mes, ano, limite, alerta_percentual, notas, updated_at) ` +
    `VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now')) ` +
    `ON CONFLICT(user_id, categoria, mes, ano) ` +
    `DO UPDATE SET limite = excluded.limite, alerta_percentual = excluded.alerta_percentual, notas = excluded.notas, ` +
    `alerta_70_disparado=0, alerta_90_disparado=0, alerta_100_disparado=0, alerta_disparado=0, updated_at = datetime('now')`
  ).bind(user.id, categoria, mes, ano, limiteNum, alertaNum, notas || null).run()

  const orc = await c.env.DB.prepare(
    'SELECT * FROM orcamentos WHERE user_id = ? AND categoria = ? AND mes = ? AND ano = ?'
  ).bind(user.id, categoria, mes, ano).first()

  if (!isUpdate) {
    await verificarConquista(c.env.DB, user.id, 'primeiro_orcamento')
  }

  return c.json({
    success: true,
    is_update: isUpdate,
    message: isUpdate ? 'Orçamento atualizado!' : 'Orçamento criado!',
    orcamento: orc
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/orcamentos/:id
// ─────────────────────────────────────────────────────────────────────────────
orcamentos.put('/:id', requireAuth, async (c) => {
  const user = c.get('user')
  if (user.plano === 'free') return c.json(MSG_FREE_ORC, 403)   // O14: free não edita
  const id   = parseId(c.req.param('id'))                        // O8: id não-numérico → 404, não 500
  if (!id) return c.json({ error: 'Orçamento não encontrado' }, 404)

  const orc = await c.env.DB.prepare(
    'SELECT * FROM orcamentos WHERE id = ? AND user_id = ?'
  ).bind(id, user.id).first() as any
  if (!orc) return c.json({ error: 'Orçamento não encontrado' }, 404)

  const body = await c.req.json()
  const { limite, alerta_percentual, notas } = body

  // O1: valida limite (recusa NaN/∞/negativo) também na edição.
  let novoLimite = Number(orc.limite)
  if (limite !== undefined) {
    const v = parseLimite(limite)
    if (v === null) return c.json({ error: 'Limite deve ser um número maior que zero.' }, 400)
    novoLimite = v
  }
  if (alerta_percentual !== undefined) {
    const ap = Number(alerta_percentual)
    if (isNaN(ap) || ap < 50 || ap > 100)
      return c.json({ error: 'alerta_percentual deve ser entre 50 e 100' }, 400)
  }

  const novoAlerta  = alerta_percentual !== undefined ? Number(alerta_percentual) : Number(orc.alerta_percentual)
  const novasNotas  = notas !== undefined ? (notas || null) : orc.notas

  await c.env.DB.prepare(
    `UPDATE orcamentos SET limite = ?, alerta_percentual = ?, notas = ?,
     alerta_disparado = 0, alerta_70_disparado=0, alerta_90_disparado=0, alerta_100_disparado=0, updated_at = datetime('now')
     WHERE id = ? AND user_id = ?`
  ).bind(novoLimite, novoAlerta, novasNotas, id, user.id).run()

  const updated = await c.env.DB.prepare('SELECT * FROM orcamentos WHERE id = ?').bind(id).first()
  return c.json({ success: true, message: 'Orçamento atualizado!', orcamento: updated })
})

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/orcamentos/:id
// ─────────────────────────────────────────────────────────────────────────────
orcamentos.delete('/:id', requireAuth, async (c) => {
  const user = c.get('user')
  if (user.plano === 'free') return c.json(MSG_FREE_ORC, 403)   // O14
  const id   = parseId(c.req.param('id'))                        // O8
  if (!id) return c.json({ error: 'Orçamento não encontrado' }, 404)

  const orc = await c.env.DB.prepare(
    'SELECT id FROM orcamentos WHERE id = ? AND user_id = ?'
  ).bind(id, user.id).first()
  if (!orc) return c.json({ error: 'Orçamento não encontrado' }, 404)

  await c.env.DB.prepare('DELETE FROM orcamentos WHERE id = ? AND user_id = ?').bind(id, user.id).run()
  return c.json({ success: true })
})

async function verificarConquista(db: D1Database, userId: number, codigo: string) {
  await db.prepare(
    `INSERT OR IGNORE INTO conquistas_usuario (user_id, conquista_codigo, data_conquista, visualizado) ` +
    `VALUES (?, ?, datetime('now'), 0)`
  ).bind(userId, codigo).run()
}

export default orcamentos
