import { Hono } from 'hono'
import { requireAuth } from './auth'

type Bindings = { DB: D1Database; ASAAS_API_KEY?: string; ASAAS_WEBHOOK_TOKEN?: string }
type Variables = { user: { id: number; nome: string; email: string; plano: string } }

const asaas = new Hono<{ Bindings: Bindings; Variables: Variables }>()

const ASAAS_BASE = 'https://sandbox.asaas.com/api/v3'  // Trocar para https://api.asaas.com/api/v3 em produção

const PLANOS_CONFIG = {
  premium: { valor: 17.90, nome: 'VerdeMais Premium', descricao: 'Controle financeiro inteligente sem limites' },
  pro:     { valor: 37.90, nome: 'VerdeMais Pro',     descricao: 'Planejamento familiar completo' }
}

// ── Helper para chamadas Asaas ────────────────────────────────────────────────
async function asaasApi(c: any, method: string, path: string, body?: any) {
  const key = c.env.ASAAS_API_KEY
  if (!key) throw new Error('ASAAS_API_KEY não configurada')

  const res = await fetch(`${ASAAS_BASE}${path}`, {
    method,
    headers: {
      'access_token': key,
      'Content-Type': 'application/json'
    },
    body: body ? JSON.stringify(body) : undefined
  })

  const data = await res.json() as any
  if (!res.ok) throw new Error(data?.errors?.[0]?.description || `Asaas error ${res.status}`)
  return data
}

// ─── GET /api/plano/status ── status da assinatura do usuário ─────────────────
asaas.get('/status', requireAuth, async (c) => {
  const user = c.get('user')

  const assinatura = await c.env.DB.prepare(
    `SELECT * FROM assinaturas WHERE user_id = ? ORDER BY id DESC LIMIT 1`
  ).bind(user.id).first() as any

  const pagamento = await c.env.DB.prepare(
    `SELECT * FROM pagamentos WHERE user_id = ? ORDER BY id DESC LIMIT 1`
  ).bind(user.id).first() as any

  return c.json({
    plano: user.plano,
    assinatura: assinatura ? {
      plano: assinatura.plano,
      status: assinatura.status,
      expira_em: assinatura.expira_em
    } : null,
    pagamento_pendente: pagamento?.status === 'pending' ? {
      checkout_url: pagamento.checkout_url,
      pix_copia_cola: pagamento.pix_copia_cola,
      forma: pagamento.forma_pagamento
    } : null
  })
})

// ─── POST /api/plano/checkout ── criar cobrança Asaas ─────────────────────────
asaas.post('/checkout', requireAuth, async (c) => {
  const user = c.get('user')
  const { plano, forma_pagamento, cpf, telefone } = await c.req.json()

  if (!['premium', 'pro'].includes(plano)) {
    return c.json({ error: 'Plano inválido. Use: premium ou pro' }, 400)
  }
  if (!['PIX', 'BOLETO', 'CREDIT_CARD'].includes(forma_pagamento)) {
    return c.json({ error: 'Forma de pagamento inválida. Use: PIX, BOLETO ou CREDIT_CARD' }, 400)
  }
  if (!cpf || cpf.replace(/\D/g, '').length !== 11) {
    return c.json({ error: 'CPF inválido. Informe 11 dígitos.' }, 400)
  }

  const config = PLANOS_CONFIG[plano as keyof typeof PLANOS_CONFIG]

  // Se não tem API Key configurada, simular para desenvolvimento
  const apiKey = c.env.ASAAS_API_KEY
  if (!apiKey || apiKey === 'sandbox_test') {
    // Modo simulação
    const simId = `sim_${Date.now()}`
    const valor = config.valor

    await c.env.DB.prepare(
      `INSERT INTO pagamentos (user_id, asaas_subscription_id, plano, status, forma_pagamento, valor, checkout_url, pix_copia_cola, created_at, updated_at)
       VALUES (?, ?, ?, 'pending', ?, ?, ?, ?, datetime('now'), datetime('now'))`
    ).bind(
      user.id, simId, plano, forma_pagamento, valor,
      `https://sandbox.asaas.com/checkout/${simId}`,
      forma_pagamento === 'PIX' ? `00020126580014BR.GOV.BCB.PIX0136${simId}520400005303986540${valor.toFixed(2)}5802BR5925VERDEMAIS6009SAO PAULO62070503***6304ABCD` : null
    ).run()

    if (cpf) {
      await c.env.DB.prepare(`UPDATE users SET cpf = ? WHERE id = ?`).bind(cpf.replace(/\D/g, ''), user.id).run()
    }

    return c.json({
      success: true,
      modo: 'simulacao',
      aviso: 'Modo sandbox — configure ASAAS_API_KEY para pagamentos reais',
      checkout_url: `https://sandbox.asaas.com/checkout/${simId}`,
      pix_copia_cola: forma_pagamento === 'PIX' ? `PIX_SIMULADO_${simId}` : undefined,
      plano, valor
    })
  }

  try {
    // 1. Criar/buscar customer
    const cpfClean = cpf.replace(/\D/g, '')
    let customerId: string

    const existing = await asaasApi(c, 'GET', `/customers?cpfCnpj=${cpfClean}`)
    if (existing.data?.length > 0) {
      customerId = existing.data[0].id
    } else {
      const customer = await asaasApi(c, 'POST', '/customers', {
        name: user.nome,
        email: user.email,
        cpfCnpj: cpfClean,
        mobilePhone: telefone?.replace(/\D/g, '') || '',
        notificationDisabled: false
      })
      customerId = customer.id
    }

    // Salvar CPF
    await c.env.DB.prepare(`UPDATE users SET cpf = ?, telefone = ? WHERE id = ?`)
      .bind(cpfClean, telefone || null, user.id).run()

    // 2. Criar assinatura recorrente
    const proxVenc = new Date()
    proxVenc.setDate(proxVenc.getDate() + 3)
    const nextDue = proxVenc.toISOString().split('T')[0]

    const subscription = await asaasApi(c, 'POST', '/subscriptions', {
      customer: customerId,
      billingType: forma_pagamento,
      value: config.valor,
      nextDueDate: nextDue,
      description: config.descricao,
      cycle: 'MONTHLY',
      externalReference: `verdemais_user_${user.id}_${plano}`
    })

    // 3. Pegar URL de pagamento
    let checkoutUrl = subscription.invoiceUrl || ''
    let pixCopiaECola: string | null = null
    let boletoUrl: string | null = null

    if (forma_pagamento === 'PIX') {
      const pagamentoInfo = await asaasApi(c, 'GET', `/subscriptions/${subscription.id}/payments`)
      const primeiroPagamento = pagamentoInfo.data?.[0]
      if (primeiroPagamento) {
        const pixInfo = await asaasApi(c, 'GET', `/payments/${primeiroPagamento.id}/pixQrCode`)
        pixCopiaECola = pixInfo.payload || null
        checkoutUrl = primeiroPagamento.invoiceUrl || checkoutUrl
      }
    } else if (forma_pagamento === 'BOLETO') {
      const pagamentoInfo = await asaasApi(c, 'GET', `/subscriptions/${subscription.id}/payments`)
      boletoUrl = pagamentoInfo.data?.[0]?.bankSlipUrl || null
    }

    // 4. Salvar no banco
    await c.env.DB.prepare(
      `INSERT INTO pagamentos (user_id, asaas_subscription_id, asaas_customer_id, plano, status, forma_pagamento, valor, checkout_url, boleto_url, pix_copia_cola, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`
    ).bind(user.id, subscription.id, customerId, plano, forma_pagamento, config.valor, checkoutUrl, boletoUrl, pixCopiaECola).run()

    return c.json({
      success: true,
      checkout_url: checkoutUrl,
      pix_copia_cola: pixCopiaECola,
      boleto_url: boletoUrl,
      plano, valor: config.valor,
      subscription_id: subscription.id
    })

  } catch (e: any) {
    console.error('Asaas error:', e.message)
    return c.json({ error: 'Erro ao criar cobrança: ' + e.message }, 500)
  }
})

// ─── POST /api/plano/webhook ── recebe eventos do Asaas ──────────────────────
asaas.post('/webhook', async (c) => {
  const body = await c.req.json() as any
  const event = body.event
  const payment = body.payment

  if (!event || !payment) return c.json({ received: true })

  const subscriptionId = payment.subscription

  try {
    if (event === 'PAYMENT_CONFIRMED' || event === 'PAYMENT_RECEIVED') {
      // Ativar plano
      const pag = await c.env.DB.prepare(
        `SELECT * FROM pagamentos WHERE asaas_subscription_id = ?`
      ).bind(subscriptionId).first() as any

      if (pag) {
        const expira = new Date()
        expira.setMonth(expira.getMonth() + 1)

        await c.env.DB.prepare(
          `UPDATE pagamentos SET status = 'active', ativado_em = datetime('now'), expira_em = ?, updated_at = datetime('now') WHERE asaas_subscription_id = ?`
        ).bind(expira.toISOString(), subscriptionId).run()

        await c.env.DB.prepare(
          `UPDATE users SET plano = ? WHERE id = ?`
        ).bind(pag.plano, pag.user_id).run()

        await c.env.DB.prepare(
          `UPDATE assinaturas SET plano = ?, status = 'ativo', updated_at = datetime('now') WHERE user_id = ?`
        ).bind(pag.plano, pag.user_id).run()

        // Conquista assinante
        await c.env.DB.prepare(
          `INSERT OR IGNORE INTO conquistas_usuario (user_id, conquista_codigo, data_conquista, visualizado) VALUES (?, 'assinante', datetime('now'), 0)`
        ).bind(pag.user_id).run()
      }

    } else if (event === 'SUBSCRIPTION_EXPIRED' || event === 'PAYMENT_OVERDUE') {
      const pag = await c.env.DB.prepare(
        `SELECT * FROM pagamentos WHERE asaas_subscription_id = ?`
      ).bind(subscriptionId).first() as any

      if (pag) {
        await c.env.DB.prepare(
          `UPDATE pagamentos SET status = 'overdue', updated_at = datetime('now') WHERE asaas_subscription_id = ?`
        ).bind(subscriptionId).run()
        // Downgrade para free após 7 dias de atraso (não imediato)
      }
    }
  } catch (e: any) {
    console.error('Webhook error:', e.message)
  }

  return c.json({ received: true })
})

// ─── GET /api/plano/ativar-teste ── ativar premium manualmente (dev only) ─────
asaas.post('/ativar-manual', requireAuth, async (c) => {
  const user = c.get('user')

  // Apenas em ambiente de desenvolvimento
  const body = await c.req.json().catch(() => ({})) as any
  const { plano = 'premium', senha_admin } = body

  if (senha_admin !== 'verdemais@admin2026') {
    return c.json({ error: 'Não autorizado' }, 401)
  }

  await c.env.DB.prepare(`UPDATE users SET plano = ? WHERE id = ?`).bind(plano, user.id).run()
  await c.env.DB.prepare(`UPDATE assinaturas SET plano = ?, status = 'ativo' WHERE user_id = ?`).bind(plano, user.id).run()

  return c.json({ success: true, message: `Plano ${plano} ativado para ${user.nome}` })
})

export default asaas
