import { Hono } from 'hono'
import { requireAuth } from './auth'

type Bindings = { DB: D1Database }
type Variables = { user: { id: number; nome: string; email: string; plano: string } }

const desafio52 = new Hono<{ Bindings: Bindings; Variables: Variables }>()

function getWeekNumber(date: Date): number {
  const start = new Date(date.getFullYear(), 0, 1)
  const diff = date.getTime() - start.getTime()
  const w = Math.ceil(((diff / 86400000) + start.getDay() + 1) / 7)
  return Math.min(52, Math.max(1, w))   // D52-13: nunca 53/54
}

// ── Validação ────────────────────────────────────────────────────────────────
function parseAno(v: unknown): number | null { const n = parseInt(String(v ?? ''), 10); return Number.isInteger(n) && n >= 2020 && n <= 2100 ? n : null }
function parseSemana(v: unknown): number | null { const n = parseInt(String(v ?? ''), 10); return Number.isInteger(n) && n >= 1 && n <= 52 ? n : null }
function parseNumFinito(v: unknown, min: number, max: number): number | null {
  const n = parseFloat(String(v))
  if (!Number.isFinite(n)) return null
  return Math.max(min, Math.min(max, n))
}

type Cfg = { valor_base: number; multiplicador: number; modo_invertido: boolean; meta_vinculada: number | null; investimento_vinculado: number | null }
async function getConfig(db: D1Database, userId: number): Promise<Cfg> {
  const c = await db.prepare(
    `SELECT valor_base, multiplicador, modo_invertido, meta_vinculada, investimento_vinculado FROM desafio_config WHERE user_id = ? ORDER BY id DESC LIMIT 1`
  ).bind(userId).first() as any
  return {
    valor_base: Number(c?.valor_base) > 0 ? Number(c.valor_base) : 1,
    multiplicador: Number(c?.multiplicador) > 0 ? Number(c.multiplicador) : 1,
    modo_invertido: !!(c?.modo_invertido),
    meta_vinculada: c?.meta_vinculada ? Number(c.meta_vinculada) : null,
    investimento_vinculado: c?.investimento_vinculado ? Number(c.investimento_vinculado) : null,
  }
}
// D52-1/D52-5: a config finalmente define o valor de cada semana.
function targetForWeek(w: number, cfg: Cfg): number {
  const semana = cfg.modo_invertido ? (53 - w) : w
  return Math.round(semana * cfg.valor_base * cfg.multiplicador * 100) / 100
}

// ── GET /api/desafio-52?ano=A ──────────────────────────────────────────────
desafio52.get('/', requireAuth, async (c) => {
  const user = c.get('user')
  const ano = parseAno(c.req.query('ano') ?? String(new Date().getFullYear()))   // D52-11
  if (ano === null) return c.json({ error: 'ano inválido (2020–2100).' }, 400)
  const anoAtual = new Date().getFullYear()

  const cfg = await getConfig(c.env.DB, user.id)

  // Buscar semanas existentes
  const result = await c.env.DB.prepare(`
    SELECT * FROM weekly_challenges WHERE user_id = ? AND year = ? ORDER BY week_number ASC
  `).bind(user.id, ano).all()
  const existing = result.results as any[]

  // D52-4/D52-15: só INICIALIZA (escreve) para anos plausíveis. Antes, GET /?ano=3000
  // criava 52 linhas de lixo em qualquer leitura, sem rota para apagar.
  if (ano <= anoAtual + 1 && existing.length < 52) {
    const existingWeeks = new Set(existing.map((r: any) => r.week_number))
    const batch = []
    for (let w = 1; w <= 52; w++) {
      if (!existingWeeks.has(w)) {
        batch.push(c.env.DB.prepare(
          `INSERT OR IGNORE INTO weekly_challenges (user_id, year, week_number, target_amount, status) VALUES (?, ?, ?, ?, 'pending')`
        ).bind(user.id, ano, w, targetForWeek(w, cfg)))   // D52-1: alvo vem da config
      }
    }
    if (batch.length) await c.env.DB.batch(batch)
    if (existing.length === 0) {
      await c.env.DB.prepare(
        `INSERT OR IGNORE INTO conquistas_usuario (user_id, conquista_codigo, visualizado) VALUES (?, 'desafio_52_iniciou', 0)`
      ).bind(user.id).run()
    }
  }

  const allWeeks = await c.env.DB.prepare(`
    SELECT * FROM weekly_challenges WHERE user_id = ? AND year = ? ORDER BY week_number ASC
  `).bind(user.id, ano).all()

  const weeks = allWeeks.results as any[]
  const currentWeek = getWeekNumber(new Date())
  const completed = weeks.filter(w => w.status === 'completed').length
  const totalTarget = weeks.reduce((s, w) => s + Number(w.target_amount), 0)
  const totalSaved = weeks.filter(w => w.status === 'completed').reduce((s, w) => s + Number(w.target_amount), 0)

  // Conquista metade
  if (completed >= 26) {
    await c.env.DB.prepare(
      `INSERT OR IGNORE INTO conquistas_usuario (user_id, conquista_codigo, visualizado) VALUES (?, 'desafio_52_metade', 0)`
    ).bind(user.id).run()
  }
  if (completed >= 52) {
    await c.env.DB.prepare(
      `INSERT OR IGNORE INTO conquistas_usuario (user_id, conquista_codigo, visualizado) VALUES (?, 'desafio_52_completo', 0)`
    ).bind(user.id).run()
  }

  return c.json({
    year: ano,
    weeks,
    current_week: currentWeek,
    config: { ...cfg, total_anual: Math.round(totalTarget * 100) / 100 },   // D52-1: total bate com as semanas
    summary: {
      completed,
      pending: weeks.filter(w => w.status === 'pending').length,
      skipped: weeks.filter(w => w.status === 'skipped').length,
      total_saved: Math.round(totalSaved * 100) / 100,
      total_target: Math.round(totalTarget * 100) / 100,
      progress_pct: Math.round((completed / 52) * 100),
    }
  })
})

// ── PATCH /api/desafio-52/:semana ─────────────────────────────────────────
desafio52.patch('/:semana', requireAuth, async (c) => {
  const user = c.get('user')
  const weekNum = parseSemana(c.req.param('semana'))   // D52-10: 'abc'/0/99 → 400 (era 500)
  if (weekNum === null) return c.json({ error: 'Semana inválida (1–52).' }, 400)
  const ano = parseAno(c.req.query('ano') ?? String(new Date().getFullYear()))   // D52-11
  if (ano === null) return c.json({ error: 'ano inválido (2020–2100).' }, 400)
  const body = await c.req.json()
  // Aceitar status em pt-BR e en (retrocompatível)
  const statusMap: Record<string, string> = {
    'pago': 'completed',
    'concluido': 'completed',
    'concluído': 'completed',
    'completed': 'completed',
    'pulado': 'skipped',
    'pulei': 'skipped',
    'skipped': 'skipped',
    'pendente': 'pending',
    'pending': 'pending',
  }
  const status = statusMap[body.status?.toLowerCase()] || body.status

  if (!['completed', 'skipped', 'pending'].includes(status))
    return c.json({ error: 'Status inválido. Use: completed/pago, skipped/pulado, pending/pendente' }, 400)
  if (weekNum < 1 || weekNum > 52)
    return c.json({ error: 'Semana inválida' }, 400)

  const week = await c.env.DB.prepare(
    `SELECT * FROM weekly_challenges WHERE user_id = ? AND year = ? AND week_number = ?`
  ).bind(user.id, ano, weekNum).first() as any
  if (!week) return c.json({ error: 'Semana não encontrada' }, 404)

  const prevStatus = week.status
  const valor = Number(week.target_amount) || 0

  await c.env.DB.prepare(`
    UPDATE weekly_challenges SET
      status = ?,
      completed_at = CASE WHEN ? = 'completed' THEN datetime('now') ELSE NULL END
    WHERE user_id = ? AND year = ? AND week_number = ?
  `).bind(status, status, user.id, ano, weekNum).run()

  // ── Integração → Metas / Investimentos (idempotente, com estorno) ──────────
  // D52-2: reenviar 'completed' NÃO credita de novo (três toques dobravam o
  // depósito). D52-3: desmarcar/estornar devolve. D52-12: meta_atualizada só é
  // true quando uma linha foi realmente afetada.
  let meta_atualizada = false
  let investimento_atualizado = false
  const entrando = status === 'completed' && prevStatus !== 'completed'
  const saindo   = prevStatus === 'completed' && status !== 'completed'

  if ((entrando || saindo) && valor > 0) {
    const cfg = await getConfig(c.env.DB, user.id)

    if (cfg.meta_vinculada) {
      if (entrando) {
        const meta = await c.env.DB.prepare(
          `SELECT id FROM metas WHERE id = ? AND user_id = ? AND status = 'ativa'`
        ).bind(cfg.meta_vinculada, user.id).first()
        if (meta) {
          await c.env.DB.prepare(
            `UPDATE metas SET valor_atual = MIN(valor_atual + ?, valor_objetivo) WHERE id = ? AND user_id = ? AND status = 'ativa'`
          ).bind(valor, cfg.meta_vinculada, user.id).run()
          meta_atualizada = true
        }
      } else {
        await c.env.DB.prepare(
          `UPDATE metas SET valor_atual = MAX(0, valor_atual - ?) WHERE id = ? AND user_id = ?`
        ).bind(valor, cfg.meta_vinculada, user.id).run()
        meta_atualizada = true
      }
    }

    if (cfg.investimento_vinculado) {
      const delta = entrando ? valor : -valor
      await c.env.DB.prepare(
        `UPDATE investimentos SET valor_investido = MAX(0, valor_investido + ?), valor_atual = MAX(0, valor_atual + ?) WHERE id = ? AND user_id = ?`
      ).bind(delta, delta, cfg.investimento_vinculado, user.id).run()
      investimento_atualizado = true
    }
  }

  return c.json({
    success: true,
    week: weekNum,
    amount: week.target_amount,
    meta_atualizada,
    investimento_atualizado,
    message: status === 'completed'
      ? `Semana ${weekNum} concluída! +R$ ${valor.toFixed(2)} guardados${meta_atualizada ? ' — meta atualizada!' : ''}${investimento_atualizado ? ' — investimento atualizado!' : ''}`
      : status === 'skipped'
      ? `Semana ${weekNum} pulada.`
      : `Semana ${weekNum} marcada como pendente`
  })
})

// ── POST /api/desafio-52/reset ────────────────────────────────────────────
desafio52.post('/reset', requireAuth, async (c) => {
  const user = c.get('user')
  const ano = parseAno(c.req.query('ano') ?? String(new Date().getFullYear()))
  if (ano === null) return c.json({ error: 'ano inválido (2020–2100).' }, 400)

  // D52-3: o reset ESTORNA o que já foi creditado na meta/investimento vinculado,
  // em vez de zerar as semanas e deixar o dinheiro lá.
  const cfg = await getConfig(c.env.DB, user.id)
  if (cfg.meta_vinculada || cfg.investimento_vinculado) {
    const done = await c.env.DB.prepare(
      `SELECT COALESCE(SUM(target_amount),0) as total FROM weekly_challenges WHERE user_id = ? AND year = ? AND status = 'completed'`
    ).bind(user.id, ano).first() as any
    const total = Number(done?.total || 0)
    if (total > 0) {
      if (cfg.meta_vinculada)
        await c.env.DB.prepare(`UPDATE metas SET valor_atual = MAX(0, valor_atual - ?) WHERE id = ? AND user_id = ?`).bind(total, cfg.meta_vinculada, user.id).run()
      if (cfg.investimento_vinculado)
        await c.env.DB.prepare(`UPDATE investimentos SET valor_investido = MAX(0, valor_investido - ?), valor_atual = MAX(0, valor_atual - ?) WHERE id = ? AND user_id = ?`).bind(total, total, cfg.investimento_vinculado, user.id).run()
    }
  }

  await c.env.DB.prepare(
    `UPDATE weekly_challenges SET status = 'pending', completed_at = NULL WHERE user_id = ? AND year = ?`
  ).bind(user.id, ano).run()

  return c.json({ success: true, message: 'Desafio reiniciado!' })
})

// ── GET /api/desafio-52/config — Melhoria 3.1 ─────────────────────────────
desafio52.get('/config', requireAuth, async (c) => {
  const user = c.get('user')

  const config = await c.env.DB.prepare(
    `SELECT * FROM desafio_config WHERE user_id = ? ORDER BY id DESC LIMIT 1`
  ).bind(user.id).first() as any

  // Config padrão se não houver customização
  if (!config) {
    return c.json({
      valor_base: 1,
      multiplicador: 1,
      modo_invertido: false,
      descricao: 'Padrão: semana N = R$ N (total: R$ 1.378,00/ano)',
      total_anual: 1378
    })
  }

  const total = calcularTotalAnual(config.valor_base, config.multiplicador, config.modo_invertido)
  return c.json({ ...config, total_anual: total })
})

// ── POST /api/desafio-52/config — Melhoria 3.1 ────────────────────────────
desafio52.post('/config', requireAuth, async (c) => {
  const user = c.get('user')
  const { valor_base = 1, multiplicador = 1, modo_invertido = false, meta_vinculada = null, investimento_vinculado = null } = await c.req.json()

  // D52-9: parseFloat('abc') era NaN e Math.max/min propagavam NaN até o banco.
  const vBase = parseNumFinito(valor_base, 0.5, 100)
  const mult = parseNumFinito(multiplicador, 0.5, 10)
  if (vBase === null || mult === null)
    return c.json({ error: 'valor_base e multiplicador devem ser números.' }, 400)
  const invertido = Boolean(modo_invertido)

  // D52-14: vincular meta/investimento de OUTRO usuário (ou inexistente) dava 500
  // por FK. Agora confere a posse e recusa com 400.
  let metaId: number | null = null
  if (meta_vinculada) {
    const mid = parseInt(meta_vinculada)
    if (!Number.isInteger(mid)) return c.json({ error: 'meta_vinculada inválida.' }, 400)
    const m = await c.env.DB.prepare(`SELECT id FROM metas WHERE id = ? AND user_id = ?`).bind(mid, user.id).first()
    if (!m) return c.json({ error: 'Meta vinculada não encontrada.' }, 400)
    metaId = mid
  }
  let investId: number | null = null
  if (investimento_vinculado) {
    const iid = parseInt(investimento_vinculado)
    if (!Number.isInteger(iid)) return c.json({ error: 'investimento_vinculado inválido.' }, 400)
    const i = await c.env.DB.prepare(`SELECT id FROM investimentos WHERE id = ? AND user_id = ?`).bind(iid, user.id).first()
    if (!i) return c.json({ error: 'Investimento vinculado não encontrado.' }, 400)
    investId = iid
  }

  const existing = await c.env.DB.prepare(`SELECT id FROM desafio_config WHERE user_id = ?`).bind(user.id).first()
  if (existing) {
    await c.env.DB.prepare(
      `UPDATE desafio_config SET valor_base=?, multiplicador=?, modo_invertido=?, meta_vinculada=?, investimento_vinculado=?, updated_at=CURRENT_TIMESTAMP WHERE user_id=?`
    ).bind(vBase, mult, invertido ? 1 : 0, metaId, investId, user.id).run()
  } else {
    await c.env.DB.prepare(
      `INSERT INTO desafio_config (user_id, valor_base, multiplicador, modo_invertido, meta_vinculada, investimento_vinculado) VALUES (?,?,?,?,?,?)`
    ).bind(user.id, vBase, mult, invertido ? 1 : 0, metaId, investId).run()
  }

  // D52-1: aplicar o novo alvo às semanas AINDA pendentes do ano corrente — sem a
  // recomputação, mudar a config não mexia em nenhuma semana.
  const anoAtual = new Date().getFullYear()
  const cfgNova: Cfg = { valor_base: vBase, multiplicador: mult, modo_invertido: invertido, meta_vinculada: metaId, investimento_vinculado: investId }
  const pend = await c.env.DB.prepare(
    `SELECT week_number FROM weekly_challenges WHERE user_id = ? AND year = ? AND status = 'pending'`
  ).bind(user.id, anoAtual).all()
  const pendRows = pend.results as any[]
  if (pendRows.length) {
    const batch = pendRows.map(r => c.env.DB.prepare(
      `UPDATE weekly_challenges SET target_amount = ? WHERE user_id = ? AND year = ? AND week_number = ?`
    ).bind(targetForWeek(Number(r.week_number), cfgNova), user.id, anoAtual, Number(r.week_number)))
    await c.env.DB.batch(batch)
  }

  const total = calcularTotalAnual(vBase, mult, invertido)

  return c.json({
    success: true,
    message: 'Configuração do desafio salva!',
    total_anual: total,
    preview: `Semana 1: R$ ${(vBase * mult).toFixed(2)} | Semana 52: R$ ${(invertido ? vBase * mult : 52 * vBase * mult).toFixed(2)}`
  })
})

function calcularTotalAnual(valorBase: number, multiplicador: number, invertido: boolean): number {
  let total = 0
  for (let w = 1; w <= 52; w++) {
    const semana = invertido ? (53 - w) : w
    total += semana * valorBase * multiplicador
  }
  return Math.round(total * 100) / 100
}

export default desafio52
