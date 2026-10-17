/**
 * VerdeMais — fluxos de ponta a ponta contra o app rodando.
 *
 * Cada bloco aqui nasceu de um defeito que chegou à produção. Os testes de
 * `lib/` provam a regra; estes provam que a regra ainda vale depois de passar
 * pela rota, pelo SQL e pelo banco — que é onde as três últimas quebras
 * aconteceram.
 *
 * Roda via `scripts/e2e.sh`, que cuida do banco e do servidor.
 */
import test from 'node:test'
import assert from 'node:assert/strict'

const BASE = process.env.E2E_BASE || 'http://localhost:3300/api'
const EMAIL = process.env.E2E_EMAIL
const SENHA = process.env.E2E_SENHA
if (!EMAIL || !SENHA) throw new Error('E2E_EMAIL e E2E_SENHA são definidos por scripts/e2e.sh')

let TOKEN = null
async function api(metodo, rota, corpo, token) {
  const t = token !== undefined ? token : TOKEN
  const r = await fetch(`${BASE}/${rota}`, {
    method: metodo,
    headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: `Bearer ${t}` } : {}) },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  })
  let body = {}
  try { body = await r.json() } catch { /* resposta sem corpo */ }
  return { status: r.status, body }
}
const lista = r => (Array.isArray(r) ? r : (r?.despesas || r?.data || []))
const cent = v => Math.round((Number(v) || 0) * 100) / 100

test('portaria: sem token e com token inválido, a porta fica fechada', async () => {
  const login = await api('POST', 'auth/login', { email: EMAIL, senha: SENHA }, null)
  assert.equal(login.status, 200, 'login do usuário de teste falhou')
  assert.ok(login.body.token)
  TOKEN = login.body.token

  assert.equal((await api('GET', 'despesas', undefined, null)).status, 401)
  assert.equal((await api('GET', 'despesas', undefined, 'nao-existe')).status, 401)
})

test('entrada: o que não pode entrar, não entra', async () => {
  const base = { descricao: 'teste', categoria: 'Moradia', valor: 10, data: '2026-05-10' }
  const recusar = [
    ['31 de fevereiro', { ...base, data: '2026-02-31' }],
    ['valor negativo', { ...base, valor: -10 }],
    ['valor zero', { ...base, valor: 0 }],
    ['valor em texto', { ...base, valor: 'abc' }],
    ['sem descrição', { ...base, descricao: '' }],
    ['201 parcelas', { ...base, parcelado: true, numero_parcelas: 201 }],
    ['descrição de 5000 letras', { ...base, descricao: 'x'.repeat(5000) }],
  ]
  for (const [nome, corpo] of recusar) {
    const r = await api('POST', 'despesas', corpo)
    assert.equal(r.status, 400, `"${nome}" passou com status ${r.status}`)
  }
  // Texto com SQL é DADO, não comando: entra e não derruba a tabela.
  const sql = await api('POST', 'despesas', { ...base, descricao: "'); DROP TABLE despesas; --" })
  assert.ok(sql.status < 300, `texto com SQL recusado (${sql.status})`)
  assert.equal((await api('GET', 'despesas?limit=5')).status, 200, 'a tabela não sobreviveu')
})

// Dia 30 com fechamento 31 é uma das 53 combinações em que a regra antiga
// empilhava duas parcelas numa fatura e deixava a anterior vazia.
test('cartão: 12 parcelas ocupam 12 faturas, sem buraco nem empilhamento', async (t) => {
  const cartao = await api('POST', 'cartoes', {
    nome: 'E2E Card', bandeira: 'visa', banco: 'E2E Bank',
    limite_total: 50000, dia_fechamento: 31, dia_vencimento: 10,
  })
  assert.ok(cartao.status < 300, `cartão recusado: ${JSON.stringify(cartao.body)}`)
  const cardId = cartao.body.id ?? cartao.body?.cartao?.id
  t.diagnostic(`cartão ${cardId}`)

  const compra = await api('POST', `cartoes/${cardId}/compra`, {
    descricao: 'Sofá E2E', categoria: 'Moradia', valor_total: 12000,
    numero_parcelas: 12, data_compra: '2026-01-30',
  })
  assert.ok(compra.status < 300, `compra recusada: ${JSON.stringify(compra.body)}`)

  const ps = lista((await api('GET', 'despesas?busca=Sof%C3%A1%20E2E&limit=40')).body)
  assert.equal(ps.length, 12, 'não criou 12 parcelas')
  const faturas = new Set(ps.map(d => `${d.billing_year}-${d.billing_month}`))
  assert.equal(faturas.size, 12,
    `12 parcelas em ${faturas.size} faturas: ${[...faturas].sort().join(' ')}`)

  // E a série é contígua: nenhum mês pulado no meio.
  const ord = [...faturas].map(k => { const [a, m] = k.split('-').map(Number); return a * 12 + m }).sort((x, y) => x - y)
  for (let i = 1; i < ord.length; i++) assert.equal(ord[i] - ord[i - 1], 1, 'mês pulado na série')

  // ── O defeito de outubro ────────────────────────────────────────────────
  // Trocar a CATEGORIA reenvia o cartão no formulário, o bloco de cartão roda,
  // e a regra antiga recalculava a fatura de cada irmã a partir da data já
  // deslocada da parcela. Resultado: parcelas sumiam de um mês e dobravam no
  // seguinte, sem ninguém tocar em data nem em cartão.
  const antes = ps.map(d => `${d.parcela_atual}:${d.billing_month}/${d.billing_year}`).sort().join(' ')
  const alvo = ps.find(d => Number(d.parcela_atual) === 5) ?? ps[4]
  const ed = await api('PUT', `despesas/${alvo.id}`, {
    descricao: alvo.descricao, categoria: 'Lazer', valor: alvo.valor,
    data: String(alvo.data).slice(0, 10), cartao_id: alvo.cartao_id, escopo: 'todas',
  })
  assert.ok(ed.status < 300, `edição recusada: ${JSON.stringify(ed.body)}`)

  const depoisPs = lista((await api('GET', 'despesas?busca=Sof%C3%A1%20E2E&limit=40')).body)
  const depois = depoisPs.map(d => `${d.parcela_atual}:${d.billing_month}/${d.billing_year}`).sort().join(' ')
  assert.equal(depois, antes, 'trocar a categoria moveu parcela de fatura')
  assert.equal(depoisPs.filter(d => d.categoria === 'Lazer').length, 12, 'a categoria não se propagou')
})

// Contrato com piso fixo e correção por índice: o total não pode ficar parado
// no contratado enquanto as parcelas chegam acima do mínimo.
test('recebimento: a correção entra no total a cada parcela lançada', async () => {
  const MINIMO = 1147.33, CONTRATADO = 39009.35
  const rec = await api('POST', 'antecipacao/recebimentos', {
    descricao: 'Restituição E2E', valor_total: CONTRATADO, numero_parcelas: 34,
    valor_parcela: MINIMO, data_inicio: '2026-04-30', tipo: 'contrato',
  })
  assert.ok(rec.status < 300, `recebimento recusado: ${JSON.stringify(rec.body)}`)
  const id = rec.body.id

  const inicial = await api('GET', `antecipacao/recebimentos/${id}/parcelas`)
  const parcelas = inicial.body.parcelas || []
  assert.equal(parcelas.length, 34)
  assert.ok(parcelas.every(p => p.valor_previsto != null),
    'parcela nasceu sem valor_previsto — sem ele a correção não é calculável')
  assert.equal(cent(inicial.body.correcao?.corrigido), CONTRATADO, 'sem recebimento, corrigido = contratado')

  const recebidos = [1147.33, 1147.33, 1160.00, 1221.63, 1193.72]
  for (let i = 0; i < recebidos.length; i++) {
    const r = await api('PATCH', `antecipacao/recebimentos/parcelas/${parcelas[i].id}/receber`,
                        { valor_real: recebidos[i] })
    assert.ok(r.status < 300, `receber parcela ${i + 1} falhou: ${JSON.stringify(r.body)}`)
  }

  const fim = (await api('GET', `antecipacao/recebimentos/${id}/parcelas`)).body
  const c = fim.correcao
  assert.equal(cent(c.contratado), 39009.35, 'a base do contrato se mexeu')
  assert.equal(cent(c.correcao), 133.36)
  assert.equal(cent(c.corrigido), 39142.71, 'o total continuou congelado')
  assert.equal(cent(c.recebido), 5870.01)

  // O previsto sobrevive ao lançamento do valor real.
  const p4 = (fim.parcelas || []).find(p => Number(p.numero_parcela) === 4)
  assert.equal(cent(p4.valor_previsto), MINIMO, 'o recebimento destruiu o mínimo contratado')
})

test('isolamento: uma conta não alcança o lançamento da outra', async () => {
  const minha = lista((await api('GET', 'despesas?limit=3')).body)[0]
  assert.ok(minha, 'preciso de ao menos uma despesa para testar')

  const senhaB = 'e2e-' + Math.random().toString(36).slice(2) + '-Local1'
  await api('POST', 'auth/register', { nome: 'Intruso E2E', email: 'intruso-e2e@local.test', senha: senhaB }, null)
  const lb = await api('POST', 'auth/login', { email: 'intruso-e2e@local.test', senha: senhaB }, null)
  const tokenB = lb.body?.token
  if (!tokenB) return   // registro exige verificação neste ambiente: nada a testar

  for (const [verbo, rota, corpo] of [
    ['GET', `despesas/${minha.id}`, undefined],
    ['PUT', `despesas/${minha.id}`, { descricao: 'INVADIDO', categoria: 'Lazer', valor: 1, data: '2026-05-10' }],
    ['DELETE', `despesas/${minha.id}`, undefined],
  ]) {
    const r = await api(verbo, rota, corpo, tokenB)
    assert.ok(r.status >= 400, `conta B conseguiu ${verbo} na despesa da conta A (${r.status})`)
  }
})

// Três telas, uma fonte. Era isto que faltava quando o Dashboard dizia 15, o
// Diagnóstico 17 e o 50/30/20 dizia 50 sobre os mesmos meses.
test('coerência: Dashboard, Diagnóstico e Projeção contam a mesma história', async (t) => {
  const [dash, diag, proj] = await Promise.all([
    api('GET', 'dashboard'), api('GET', 'diagnostico'), api('GET', 'projecao')])
  for (const [nome, r] of [['dashboard', dash], ['diagnostico', diag], ['projecao', proj]]) {
    assert.ok(r.status < 400, `${nome} respondeu ${r.status}`)
  }
  const score = [dash.body?.score_detalhe?.total, diag.body?.score?.total].filter(v => v != null)
  const conf = [dash.body?.confianca?.nota, diag.body?.confianca?.nota, proj.body?.confianca].filter(v => v != null)
  t.diagnostic(`score ${score.join('/')} · confiança ${conf.join('/')}`)

  // Zero em todas passaria sem provar nada: a base precisa ter história.
  assert.ok(score.length >= 2 && score[0] > 0,
    'score zerado — semeie meses fechados antes, senão este teste não mede nada')
  assert.equal(new Set(score).size, 1, `score diverge entre telas: ${score.join(' vs ')}`)
  assert.equal(new Set(conf).size, 1, `confiança diverge entre telas: ${conf.join(' vs ')}`)
})
