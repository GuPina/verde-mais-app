import { Hono } from 'hono'
import { requireAuth } from './auth'

type Bindings  = { DB: D1Database }
type Variables = { user: { id: number; nome: string; plano: string } }

const alertasCartao = new Hono<{ Bindings: Bindings; Variables: Variables }>()

// ─── GET /api/alertas-cartao ─────────────────────────────────────────────────
alertasCartao.get('/', requireAuth, async (c) => {
  const user = c.get('user')

  // Gerar alertas dinâmicos em tempo real (sem cron necessário)
  await gerarAlertas(c.env.DB, user.id)

  const rows = await c.env.DB.prepare(
    `SELECT a.id, a.cartao_id, a.tipo, a.titulo, a.mensagem, a.lido, a.created_at,
            c.nome as cartao_nome, c.cor as cartao_cor
     FROM alertas_cartao a
     JOIN cartoes c ON c.id = a.cartao_id
     WHERE a.user_id=? AND a.lido=0
     ORDER BY a.created_at DESC
     LIMIT 20`
  ).bind(user.id).all<any>()

  const total_nao_lidos = (rows.results || []).length

  return c.json({ alertas: rows.results || [], total_nao_lidos })
})

// ─── PATCH /api/alertas-cartao/todos-lidos ────────────────────────────────────
// IMPORTANTE: deve ficar ANTES de /:id/lido para evitar conflito de rota
alertasCartao.patch('/todos-lidos', requireAuth, async (c) => {
  const user = c.get('user')
  await c.env.DB.prepare(
    `UPDATE alertas_cartao SET lido=1 WHERE user_id=?`
  ).bind(user.id).run()
  return c.json({ success: true })
})

// ─── PATCH /api/alertas-cartao/:id/lido ──────────────────────────────────────
alertasCartao.patch('/:id/lido', requireAuth, async (c) => {
  const user     = c.get('user')
  const alertaId = parseInt(c.req.param('id'))

  if (isNaN(alertaId)) return c.json({ error: 'ID inválido' }, 400)

  await c.env.DB.prepare(
    `UPDATE alertas_cartao SET lido=1 WHERE id=? AND user_id=?`
  ).bind(alertaId, user.id).run()

  return c.json({ success: true })
})

// ─── Gerador de Alertas Inteligentes ─────────────────────────────────────────
async function gerarAlertas(db: D1Database, userId: number) {
  const hoje    = new Date()
  const diaHoje = hoje.getDate()

  // Buscar cartões ativos do usuário
  const cartoes = await db.prepare(
    `SELECT id, nome, limite_total, limite_disponivel, dia_fechamento, dia_vencimento
     FROM cartoes WHERE user_id=? AND ativo=1`
  ).bind(userId).all<any>()

  for (const cartao of (cartoes.results || [])) {
    const limiteUsado       = (cartao.limite_total || 0) - (cartao.limite_disponivel || 0)
    const utilizacaoPercent = cartao.limite_total > 0
      ? (limiteUsado / cartao.limite_total) * 100
      : 0

    // Alerta 1: limite acima de 80%
    if (utilizacaoPercent >= 80) {
      const chave = `limite_alto_${cartao.id}_${hoje.getMonth()}_${hoje.getFullYear()}`
      const jaExiste = await db.prepare(
        `SELECT id FROM alertas_cartao
         WHERE user_id=? AND cartao_id=? AND tipo='limite_alto'
           AND date(created_at) >= date('now', '-7 days')`
      ).bind(userId, cartao.id).first()

      if (!jaExiste) {
        await db.prepare(
          `INSERT INTO alertas_cartao (user_id, cartao_id, tipo, titulo, mensagem)
           VALUES (?, ?, 'limite_alto', ?, ?)`
        ).bind(
          userId, cartao.id,
          `⚠️ ${cartao.nome}: Limite em ${utilizacaoPercent.toFixed(0)}%`,
          `Você usou R$ ${limiteUsado.toFixed(2)} de R$ ${cartao.limite_total.toFixed(2)}. Uso alto pode afetar seu score de crédito.`
        ).run().catch(() => {})
      }
    }

    // Alerta 2: fechamento em 3 dias
    const diasFechamento = cartao.dia_fechamento - diaHoje
    if (diasFechamento >= 1 && diasFechamento <= 3) {
      const jaExisteFech = await db.prepare(
        `SELECT id FROM alertas_cartao
         WHERE user_id=? AND cartao_id=? AND tipo='fechamento_proximo'
           AND date(created_at) >= date('now', '-3 days')`
      ).bind(userId, cartao.id).first()

      if (!jaExisteFech) {
        // Buscar fatura atual
        const mesAtual = hoje.getMonth() + 1
        const anoAtual = hoje.getFullYear()
        const faturaAtual = await db.prepare(
          `SELECT COALESCE(SUM(valor),0) as total
           FROM card_charges
           WHERE card_id=? AND billing_month=? AND billing_year=? AND status='pendente'`
        ).bind(cartao.id, mesAtual, anoAtual).first<{total:number}>()

        const totalFatura = faturaAtual?.total || 0

        await db.prepare(
          `INSERT INTO alertas_cartao (user_id, cartao_id, tipo, titulo, mensagem)
           VALUES (?, ?, 'fechamento_proximo', ?, ?)`
        ).bind(
          userId, cartao.id,
          `📅 ${cartao.nome} fecha em ${diasFechamento} dia(s)`,
          `Fatura atual: R$ ${totalFatura.toFixed(2)}. Evite novas compras para não aumentar o compromisso.`
        ).run().catch(() => {})
      }
    }

    // Alerta 3: vencimento em 5 dias
    const diasVencimento = cartao.dia_vencimento - diaHoje
    if (diasVencimento >= 1 && diasVencimento <= 5) {
      const jaExisteVenc = await db.prepare(
        `SELECT id FROM alertas_cartao
         WHERE user_id=? AND cartao_id=? AND tipo='vencimento_proximo'
           AND date(created_at) >= date('now', '-5 days')`
      ).bind(userId, cartao.id).first()

      if (!jaExisteVenc) {
        const mesAtual = hoje.getMonth() + 1
        const anoAtual = hoje.getFullYear()
        const fatura = await db.prepare(
          `SELECT COALESCE(SUM(valor),0) as total
           FROM card_charges
           WHERE card_id=? AND billing_month=? AND billing_year=? AND status='pendente'`
        ).bind(cartao.id, mesAtual, anoAtual).first<{total:number}>()

        const totalVenc = fatura?.total || 0

        await db.prepare(
          `INSERT INTO alertas_cartao (user_id, cartao_id, tipo, titulo, mensagem)
           VALUES (?, ?, 'vencimento_proximo', ?, ?)`
        ).bind(
          userId, cartao.id,
          `🔔 Fatura ${cartao.nome} vence em ${diasVencimento} dia(s)`,
          `Valor: R$ ${totalVenc.toFixed(2)}. Pague até dia ${cartao.dia_vencimento} para evitar juros.`
        ).run().catch(() => {})
      }
    }
  }

  // Limpar alertas antigos (> 30 dias) e lidos
  await db.prepare(
    `DELETE FROM alertas_cartao
     WHERE user_id=? AND (lido=1 OR date(created_at) < date('now', '-30 days'))`
  ).bind(userId).run().catch(() => {})
}

export { gerarAlertas }
export default alertasCartao
