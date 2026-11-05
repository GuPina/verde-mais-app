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

// Reorganizar é a operação mais perigosa desta tela: ela APAGA as parcelas
// pendentes para recriá-las. A trava que importa é a cláusula de status no
// DELETE — sem ela, um contrato com cinco recebimentos lançados como receita
// perderia os cinco, e o extrato do mês passado mudaria sozinho.
test('reorganizar: refaz o que falta e não encosta no que já entrou', async (t) => {
  const MINIMO = 1147.33, CONTRATADO = 39009.35
  const rec = await api('POST', 'antecipacao/recebimentos', {
    descricao: 'Reorg E2E', valor_total: CONTRATADO, numero_parcelas: 34,
    valor_parcela: MINIMO, data_inicio: '2026-04-30', tipo: 'contrato',
  })
  assert.ok(rec.status < 300)
  const id = rec.body.id

  const ps = (await api('GET', `antecipacao/recebimentos/${id}/parcelas`)).body.parcelas
  const recebidos = [1147.33, 1160.00, 1221.63]
  for (let i = 0; i < recebidos.length; i++) {
    const r = await api('PATCH', `antecipacao/recebimentos/parcelas/${ps[i].id}/receber`,
                        { valor_real: recebidos[i] })
    assert.ok(r.status < 300)
  }
  const antes = (await api('GET', `antecipacao/recebimentos/${id}/parcelas`)).body
  const recebidasAntes = antes.parcelas.filter(p => p.status === 'recebida')
    .map(p => `${p.numero_parcela}:${cent(p.valor)}:${cent(p.valor_previsto)}`).sort().join(' ')
  assert.equal(recebidasAntes.split(' ').length, 3)

  // Simular não pode escrever nada.
  const sim = await api('POST', `antecipacao/recebimentos/${id}/reorganizar`,
    { numero_parcelas: 20, valor_parcela: 1400, simular: true })
  assert.ok(sim.status < 300, JSON.stringify(sim.body))
  assert.equal(sim.body.resumo.pendentes_antes, 31)
  assert.equal(sim.body.resumo.pendentes_depois, 20)
  assert.equal(cent(sim.body.resumo.a_receber), 28000)
  const depoisDaSimulacao = (await api('GET', `antecipacao/recebimentos/${id}/parcelas`)).body.parcelas
  assert.equal(depoisDaSimulacao.length, 34, 'a simulação escreveu no banco')

  // Agora vale.
  const r = await api('POST', `antecipacao/recebimentos/${id}/reorganizar`,
    { numero_parcelas: 20, valor_parcela: 1400 })
  assert.ok(r.status < 300, JSON.stringify(r.body))

  const fim = (await api('GET', `antecipacao/recebimentos/${id}/parcelas`)).body
  const recebidasDepois = fim.parcelas.filter(p => p.status === 'recebida')
    .map(p => `${p.numero_parcela}:${cent(p.valor)}:${cent(p.valor_previsto)}`).sort().join(' ')
  assert.equal(recebidasDepois, recebidasAntes, 'uma parcela recebida foi alterada ou apagada')

  const pend = fim.parcelas.filter(p => p.status !== 'recebida')
  assert.equal(pend.length, 20, 'não recriou 20 pendentes')
  assert.ok(pend.every(p => cent(p.valor) === 1400 && cent(p.valor_previsto) === 1400),
    'pendente nasceu com valor ou previsto errado')
  // Numeradas depois da última recebida, sem colidir nem pular.
  const nums = pend.map(p => Number(p.numero_parcela)).sort((a, b) => a - b)
  assert.equal(nums[0], 4, `a primeira nova deveria ser a 4, veio ${nums[0]}`)
  assert.equal(nums[nums.length - 1], 23)

  // O contratado é referência histórica: não se mexe.
  assert.equal(cent(fim.correcao.contratado), CONTRATADO, 'o contratado foi reescrito')
  // E a correção já recebida continua de pé: 12,67 + 74,30 da 2ª e 3ª parcelas.
  assert.equal(cent(fim.correcao.correcao), 86.97)
  t.diagnostic(`a receber agora: ${cent(fim.correcao.a_receber)}`)
})

// ── Recorrências: a linha do tempo lê o lançamento real, o rastreio acha o
// que se repete, a regra vincula o que entra — e nada disso apaga dado real.
test('recorrências: ajuste em Despesas aparece na linha do tempo; regra vincula; rastreio acha', async (t) => {
  const criar = await api('POST', 'recorrencias', {
    tipo: 'despesa', descricao: 'Netflix', valor: 55.9, categoria: 'assinaturas',
    dia_vencimento: 15, data_inicio: '2026-06-01',
  })
  assert.equal(criar.status, 200, JSON.stringify(criar.body))
  const recId = criar.body.id

  for (const mes of [6, 7, 8]) {
    const r = await api('POST', `recorrencias/${recId}/lancar`, { mes, ano: 2026 })
    assert.equal(r.status, 200, `lançar ${mes}: ${JSON.stringify(r.body)}`)
  }

  // A pessoa abre Despesas e corrige agosto para o preço novo.
  const ago = lista((await api('GET', 'despesas?mes=08&ano=2026')).body).find(d => Number(d.recorrencia_id) === recId)
  assert.ok(ago, 'o lançamento de agosto não apareceu em Despesas')
  const put = await api('PUT', `despesas/${ago.id}`, {
    descricao: ago.descricao, categoria: ago.categoria, data: String(ago.data).slice(0, 10),
    valor: 59.9, status: 'pago', data_pagamento: String(ago.data).slice(0, 10),
  })
  assert.equal(put.status, 200, JSON.stringify(put.body))

  let lt = (await api('GET', `recorrencias/${recId}/linha-do-tempo`)).body
  const mAgo = lt.passadas.find(m => m.mes === '2026-08')
  assert.equal(cent(mAgo.lancamentos[0].valor), 59.9, 'a linha do tempo mostrou o valor antigo')
  assert.equal(cent(mAgo.lancamentos[0].ajuste), 4)

  // Entra uma despesa com o nome do banco: a regra padrão vincula sozinha.
  const set = await api('POST', 'despesas', { descricao: 'NETFLIX.COM', categoria: 'assinaturas', valor: 56.9, data: '2026-09-16', status: 'pago' })
  assert.equal(set.status, 201, JSON.stringify(set.body))
  assert.equal(set.body.recorrencia?.vinculados?.length, 1, `não vinculou: ${JSON.stringify(set.body.recorrencia)}`)
  const setId = set.body.ids[0]

  // Uma segunda no mesmo mês não é vinculada às cegas — vira sugestão.
  const dup = await api('POST', 'despesas', { descricao: 'NETFLIX.COM', categoria: 'assinaturas', valor: 56.9, data: '2026-09-18', status: 'pago' })
  assert.equal(dup.body.recorrencia?.vinculados?.length, 0)
  assert.equal(dup.body.recorrencia?.sugestoes?.[0]?.motivo, 'mes_ocupado')

  lt = (await api('GET', `recorrencias/${recId}/linha-do-tempo`)).body
  assert.equal(lt.passadas.find(m => m.mes === '2026-09').estado, 'pago')
  assert.equal(lt.passadas.find(m => m.mes === '2026-10').estado, 'faltou')
  assert.ok(lt.proximas.length >= 1 && lt.proximas.every(m => m.estado === 'previsto' || m.estado === 'pendente'))

  // Rastreio: academia em 4 meses vira sugestão; o sofá em 12x, nunca.
  for (const m of ['07', '08', '09', '10'])
    await api('POST', 'despesas', { descricao: 'SMARTFIT ACADEMIA', categoria: 'saude', valor: 99.9, data: `2026-${m}-05`, status: 'pago' })
  for (const m of ['07', '08', '09', '10'])
    await api('POST', 'receitas', { descricao: 'SALARIO ACME LTDA', categoria: 'salario', valor: 6200, data: `2026-${m}-05` })

  const rast = (await api('GET', 'recorrencias/rastrear')).body
  t.diagnostic(`novas: ${rast.despesa.novas.map(n => n.chave).join(', ')} | ${rast.receita.novas.map(n => n.chave).join(', ')}`)
  const acad = rast.despesa.novas.find(n => n.chave === 'SMARTFIT ACADEMIA')
  assert.ok(acad, 'a academia não foi sugerida')
  assert.ok(!rast.despesa.novas.some(n => /SOFA/.test(n.chave)), 'compra parcelada sugerida como recorrência')
  assert.ok(rast.receita.novas.some(n => n.chave === 'SALARIO ACME LTDA'), 'o salário não foi sugerido em entradas')
  assert.ok(rast.despesa.soltas.some(s => s.recorrencia_id === recId), 'a segunda Netflix de setembro não apareceu como solta')

  const nova = await api('POST', 'recorrencias/rastrear/criar', {
    tipo: 'despesa', descricao: acad.nome, valor: acad.padrao.valor_mediano, dia_vencimento: acad.padrao.dia_tipico,
    categoria: acad.categoria, ids: acad.ids, regra: acad.regra,
  })
  assert.equal(nova.status, 200, JSON.stringify(nova.body))
  assert.equal(nova.body.vinculados, 4)
  const ltA = (await api('GET', `recorrencias/${nova.body.id}/linha-do-tempo`)).body
  assert.equal(ltA.resumo.meses_pagos, 4)
  assert.equal(ltA.regra_personalizada, true)
  assert.ok(!(await api('GET', 'recorrencias/rastrear?tipo=despesa')).body.despesa.novas.some(n => n.chave === 'SMARTFIT ACADEMIA'))

  // Regra: testar mostra o que pegaria; qualquer valor pega as duas Netflix.
  const teste = await api('POST', `recorrencias/${recId}/regra/testar`, { texto: 'netflix', tol_valor_pct: null, tol_dias: 5 })
  assert.equal(teste.status, 200, JSON.stringify(teste.body))
  assert.ok(teste.body.pegaria.some(l => l.id === dup.body.ids[0]))
  assert.equal((await api('PUT', `recorrencias/${recId}/regra`, { texto: 'x' })).status, 400, 'regra de 1 letra passou')

  // Excluir a recorrência leva só o previsto que ela gerou — a despesa real
  // que a regra vinculou continua lá.
  assert.equal((await api('DELETE', `recorrencias/${recId}`)).status, 200)
  const aindaLa = lista((await api('GET', 'despesas?mes=09&ano=2026')).body).some(d => d.id === setId)
  assert.ok(aindaLa, 'excluir a recorrência apagou uma despesa real')
})

test('assinaturas fantasma: aumento de preço não vira duas assinaturas; parcela não é assinatura', async () => {
  for (const [m, v] of [['07', 19.9], ['08', 19.9], ['09', 21.9], ['10', 21.9]])
    await api('POST', 'despesas', { descricao: 'SPOTIFY BR', categoria: 'assinaturas', valor: v, data: `2026-${m}-12`, status: 'pago' })
  const scan = await api('POST', 'assinaturas-fantasma/scan', { usar_ia: false })
  assert.equal(scan.status, 200, JSON.stringify(scan.body).slice(0, 300))
  const det = scan.body.detected || scan.body.assinaturas || []
  const spot = det.filter(d => /spotify/i.test(d.normalized_description || d.original_description || ''))
  assert.equal(spot.length, 1, `Spotify apareceu ${spot.length}x: ${JSON.stringify(spot.map(s => [s.normalized_description, s.amount]))}`)
  assert.equal(cent(spot[0].amount), 21.9, 'a assinatura ficou com o preço antigo')
  assert.ok(!det.some(d => /sofa/i.test(d.normalized_description || '')), 'compra parcelada virou assinatura')
})

test('importação: a receita do extrato entra já vinculada à recorrência dela', async () => {
  const rec = await api('POST', 'recorrencias', {
    tipo: 'receita', descricao: 'Aluguel Apto 12', valor: 1500, categoria: 'aluguel', dia_vencimento: 10, data_inicio: '2026-01-01',
  })
  assert.equal(rec.status, 200, JSON.stringify(rec.body))
  const csv = 'data,descricao,valor\n2026-10-10,PIX RECEBIDO ALUGUEL APTO 12,1500.00\n2026-10-11,PIX RECEBIDO JOAO,80.00\n'
  const imp = await api('POST', 'importacao/executar', {
    csv, tipo: 'receitas', mapeamento: { data: 0, descricao: 1, valor: 2 },
  })
  assert.equal(imp.status, 200, JSON.stringify(imp.body))
  assert.equal(imp.body.importados, 2)
  assert.equal(imp.body.recorrencia?.vinculados?.length, 1, JSON.stringify(imp.body.recorrencia))
  const lt = (await api('GET', `recorrencias/${rec.body.id}/linha-do-tempo`)).body
  assert.equal(lt.passadas.find(m => m.mes === '2026-10').estado, 'recebido')
})
