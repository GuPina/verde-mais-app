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

test('recorrências: lançar o mês que faltou com a cara dos outros (cartão, tag, categoria, pago/pendente)', async () => {
  const cartao = await api('POST', 'cartoes', { nome: 'Cartão Spotify', bandeira: 'visa', banco: 'E2E', limite_total: 5000, dia_fechamento: 25, dia_vencimento: 5 })
  const cardId = cartao.body.id ?? cartao.body?.cartao?.id
  const rec = await api('POST', 'recorrencias', { tipo: 'despesa', descricao: 'Spotify Família', valor: 34.9, categoria: 'assinaturas', dia_vencimento: 12, data_inicio: '2026-05-01' })
  const recId = rec.body.id
  // Um lançamento real, no cartão, com tag e categoria própria: é o modelo.
  const modelo = await api('POST', 'despesas', { descricao: 'Spotify Família', categoria: 'Streaming', valor: 34.9, data: '2026-08-12',
    meio_pagamento: 'cartao_credito', cartao_id: cardId, status: 'pago' })
  assert.equal(modelo.status, 201, JSON.stringify(modelo.body))
  assert.equal(modelo.body.recorrencia?.vinculados?.length, 1, 'o modelo não vinculou')
  const tag = await api('POST', 'tags', { nome: 'Streaming família' })
  const tagId = tag.body.id ?? tag.body?.tag?.id
  await api('POST', `tags/despesa/${modelo.body.ids[0]}`, { tag_ids: [tagId] })

  // Outubro passou sem lançamento: entra pago, na fatura que VENCE em outubro.
  const out = await api('POST', `recorrencias/${recId}/preencher`, { mes: '2026-10' })
  assert.equal(out.status, 200, JSON.stringify(out.body))
  assert.equal(out.body.status, 'pago')
  assert.equal(out.body.data.slice(0, 7), '2026-10', `vencimento fora de outubro: ${out.body.data}`)
  assert.equal(out.body.cartao_id, cardId)
  const desp = lista((await api('GET', 'despesas?mes=10&ano=2026')).body).find(d => d.id === out.body.id)
  assert.ok(desp, 'o lançamento não apareceu em Despesas de outubro')
  assert.equal(desp.categoria, 'Streaming', 'não copiou a categoria do modelo')
  assert.equal(Number(desp.cartao_id), cardId)
  assert.ok((desp.tags || []).some(t => t.id === tagId), `não copiou a tag: ${JSON.stringify(desp.tags)}`)

  // Janeiro de 2027 ainda não chegou: pendente.
  const jan = await api('POST', `recorrencias/${recId}/preencher`, { mes: '2027-01' })
  assert.equal(jan.body.status, 'pendente', JSON.stringify(jan.body))
  // E o mesmo mês duas vezes, não.
  assert.equal((await api('POST', `recorrencias/${recId}/preencher`, { mes: '2026-10' })).status, 409)

  const lt = (await api('GET', `recorrencias/${recId}/linha-do-tempo`)).body
  assert.equal(lt.passadas.find(m => m.mes === '2026-10').estado, 'pago')
  assert.equal(lt.proximas.find(m => m.mes === '2027-01').estado, 'pendente')
})

test('recorrências: "Evolução de obra" confirmado em "Juros de obra" ensina o nome; dividir separa ChatGPT de Claude', async () => {
  const obra = await api('POST', 'recorrencias', { tipo: 'despesa', descricao: 'Juros de obra', valor: 0, valor_variavel: true, categoria: 'moradia', dia_vencimento: 20, data_inicio: '2026-03-01' })
  const obraId = obra.body.id
  for (const [m, v] of [['06', 452.1], ['07', 463.8], ['08', 471.25]])
    await api('POST', 'despesas', { descricao: 'EVOLUCAO DE OBRA', categoria: 'moradia', valor: v, data: `2026-${m}-21`, status: 'pago' })

  const cand = (await api('GET', `recorrencias/${obraId}/candidatos?ia=0`)).body
  const evo = cand.candidatos.filter(c => c.descricao === 'EVOLUCAO DE OBRA')
  assert.equal(evo.length, 3, JSON.stringify(cand.candidatos.map(c => [c.descricao, c.pontos])))
  const resp = await api('POST', `recorrencias/${obraId}/candidatos/responder`, { sim: evo.slice(0, 2).map(c => c.id), nao: [evo[2].id], aprender: true })
  assert.equal(resp.body.vinculados, 2)
  assert.deepEqual(resp.body.apelidos, ['EVOLUCAO DE OBRA'])
  // O "não" não volta; o apelido faz o próximo entrar sozinho.
  assert.ok(!(await api('GET', `recorrencias/${obraId}/candidatos?ia=0`)).body.candidatos.some(c => c.id === evo[2].id))
  const set = await api('POST', 'despesas', { descricao: 'EVOLUCAO DE OBRA', categoria: 'moradia', valor: 480, data: '2026-09-21', status: 'pago' })
  assert.equal(set.body.recorrencia?.vinculados?.[0]?.recorrencia_id, obraId, JSON.stringify(set.body.recorrencia))
  // Editar a tolerância no formulário (sem mandar apelidos) não apaga o que foi aprendido.
  await api('PUT', `recorrencias/${obraId}/regra`, { texto: 'Juros de obra', tol_valor_pct: null, tol_dias: 6 })
  assert.deepEqual((await api('GET', `recorrencias/${obraId}/regra`)).body.regra.apelidos, ['EVOLUCAO DE OBRA'])

  // "IA (ChatGPT/Claude)": duas assinaturas numa recorrência só.
  const ia = await api('POST', 'recorrencias', { tipo: 'despesa', descricao: 'IA (ChatGPT/Claude)', valor: 120.72, categoria: 'assinaturas', dia_vencimento: 1 })
  const iaId = ia.body.id
  const ids = []
  for (const [d, v] of [['OPENAI CHATGPT', 120.72], ['CLAUDE AI', 110.0]]) {
    const r = await api('POST', 'despesas', { descricao: d, categoria: 'assinaturas', valor: v, data: '2026-10-01', status: 'pago' })
    ids.push(r.body.ids[0])
    await api('POST', `recorrencias/${iaId}/vincular`, { lancamento_ids: [r.body.ids[0]] })
  }
  const div = await api('POST', `recorrencias/${iaId}/dividir`, { descricao: 'Claude', valor: 110, lancamento_ids: [ids[1]] })
  assert.equal(div.status, 200, JSON.stringify(div.body))
  assert.equal(div.body.movidos, 1)
  const ltClaude = (await api('GET', `recorrencias/${div.body.id}/linha-do-tempo`)).body
  assert.equal(ltClaude.passadas.find(m => m.mes === '2026-10').lancamentos[0].id, ids[1])
  assert.equal(ltClaude.recorrencia.categoria, 'assinaturas', 'a nova não herdou a categoria')
  const ltIA = (await api('GET', `recorrencias/${iaId}/linha-do-tempo`)).body
  assert.deepEqual(ltIA.passadas.find(m => m.mes === '2026-10').lancamentos.map(l => l.id), [ids[0]])
})

test('assinaturas fantasma: ChatGPT e Claude saem com o nome de cada um, não "IA (ChatGPT/Claude)"', async () => {
  for (const m of ['07', '08', '09', '10']) {
    await api('POST', 'despesas', { descricao: 'CHATGPT SUBSCRIPTION', categoria: 'assinaturas', valor: 104.9, data: `2026-${m}-03`, status: 'pago' })
    await api('POST', 'despesas', { descricao: 'CLAUDE.AI SUBSCRIPTION', categoria: 'assinaturas', valor: 110, data: `2026-${m}-08`, status: 'pago' })
  }
  const det = (await api('POST', 'assinaturas-fantasma/scan', { usar_ia: false })).body.detected || []
  const nomes = det.map(d => d.service_nome)
  assert.ok(nomes.includes('ChatGPT'), JSON.stringify(nomes))
  assert.ok(nomes.includes('Claude'), JSON.stringify(nomes))
  assert.ok(!nomes.includes('IA (ChatGPT/Claude)'))
})

test('financiamento na planta: entrada parcelada, evolução de obra e ITBI de Despesas viram o painel do imóvel', async () => {
  const fin = await api('POST', 'financiamentos', {
    descricao: 'Apto Vila Prime', tipo_bem: 'imovel', valor_imovel: 400000, valor_entrada: 40000, valor_financiado: 320000,
    taxa_juros_anual: 9.6, numero_parcelas: 360, parcelas_pagas: 0, valor_parcela: 2850, sistema_amortizacao: 'sac',
    data_inicio: '2028-03-10', banco: 'Caixa',
  })
  assert.equal(fin.status, 201, JSON.stringify(fin.body))
  const fid = fin.body.id
  const imo = await api('PATCH', `financiamentos/${fid}/imobiliario`, { tipo_financiamento: 'planta', data_chaves: '2028-02-15', construtora: 'MRV', evolucao_obra_pct: 42 })
  assert.equal(imo.status, 200, JSON.stringify(imo.body))

  // A entrada que o Gustavo parcelou, lançada em Despesas como parcelada.
  const ent = await api('POST', 'despesas', { descricao: 'Entrada Apto Vila Prime', categoria: 'moradia', valor: 1200, data: '2026-08-10',
    parcelado: true, numero_parcelas: 3, status: 'pago' })
  assert.equal(ent.status, 201, JSON.stringify(ent.body))
  const obraIds = []
  for (const [m, v] of [['08', 300], ['09', 360], ['10', 420]]) {
    const r = await api('POST', 'despesas', { descricao: 'EVOLUCAO DE OBRA CAIXA', categoria: 'moradia', valor: v, data: `2026-${m}-20`, status: 'pago' })
    obraIds.push(r.body.ids[0])
  }
  const itbi = await api('POST', 'despesas', { descricao: 'ITBI PREFEITURA', categoria: 'impostos', valor: 8000, data: '2026-07-01', status: 'pago' })

  const cand = (await api('GET', `financiamentos/${fid}/candidatos`)).body
  const papelDe = Object.fromEntries(cand.candidatos.map(c => [c.id, c.papel]))
  for (const id of ent.body.ids) assert.equal(papelDe[id], 'entrada', `parcela de entrada ${id} não sugerida como entrada: ${JSON.stringify(cand.candidatos.map(c => [c.descricao, c.papel, c.pontos]))}`)
  for (const id of obraIds) assert.equal(papelDe[id], 'obra')
  assert.equal(papelDe[itbi.body.ids[0]], 'extra')

  const vinc = await api('POST', `financiamentos/${fid}/vincular`, {
    itens: cand.candidatos.filter(c => [...ent.body.ids, ...obraIds, itbi.body.ids[0]].includes(c.id)).map(c => ({ despesa_id: c.id, papel: c.papel })),
    aprender: true,
  })
  assert.equal(vinc.body.vinculados, 7, JSON.stringify(vinc.body))

  // Novembro chega com o mesmo nome: entra no financiamento sozinho.
  const nov = await api('POST', 'despesas', { descricao: 'EVOLUCAO DE OBRA CAIXA', categoria: 'moradia', valor: 480, data: '2026-11-20', status: 'pendente' })
  assert.deepEqual(nov.body.recorrencia?.financiamento?.map(x => [x.financiamento_id, x.papel]), [[fid, 'obra']], JSON.stringify(nov.body.recorrencia))

  const pn = (await api('GET', `financiamentos/${fid}/painel`)).body
  const b = Object.fromEntries(pn.painel.blocos.map(x => [x.papel, x]))
  assert.equal(b.entrada.pago + b.entrada.pendente, 1200)
  assert.equal(b.obra.pago, 1080)
  assert.equal(b.obra.pendente, 480)
  assert.equal(b.extra.pago, 8000)
  assert.equal(pn.painel.fase, 'obra')
  assert.equal(pn.painel.entrada.contratada, 40000)
  assert.equal(pn.indicadores.custo, 1080 + 8000, 'obra e ITBI são custo')
  assert.ok(pn.indicadores.obra.proximo?.por_tendencia > 420)
  assert.equal(pn.obra_hist.length, 1)
  assert.ok(pn.sugestoes.length > 0)
  // As 360 parcelas que o financiamento gera também aparecem, como parcela.
  assert.equal(b.parcela.n_pendentes, 360)

  // Tirar um lançamento não apaga a despesa, e ele não volta na busca.
  await api('POST', `financiamentos/${fid}/desvincular`, { despesa_id: itbi.body.ids[0] })
  assert.ok(!(await api('GET', `financiamentos/${fid}/candidatos`)).body.candidatos.some(c => c.id === itbi.body.ids[0]))
  // Excluir o financiamento leva o vínculo, não a entrada nem a obra.
  assert.equal((await api('DELETE', `financiamentos/${fid}`)).status, 200)
  const ago = lista((await api('GET', 'despesas?mes=08&ano=2026')).body)
  assert.ok(ago.some(d => d.id === ent.body.ids[0]), 'excluir o financiamento apagou a entrada')
  assert.ok(ago.some(d => d.id === obraIds[0]), 'excluir o financiamento apagou a evolução de obra')
})

test('juros do parcelamento: conta de 5 mil em 12x no cartão separa os juros; Despesas também', async () => {
  const cartao = await api('POST', 'cartoes', { nome: 'Cartão Juros', bandeira: 'visa', banco: 'E2E', limite_total: 20000, dia_fechamento: 25, dia_vencimento: 5 })
  const cardId = cartao.body.id ?? cartao.body?.cartao?.id
  const compra = await api('POST', `cartoes/${cardId}/compra`, {
    descricao: 'Conta dezembro', categoria: 'Moradia', valor_total: 5679.96, numero_parcelas: 12, data_compra: '2026-12-02', valor_a_vista: 5000,
  })
  assert.ok(compra.status < 300, JSON.stringify(compra.body))
  assert.equal(compra.body.juros?.juros_total, 679.96, JSON.stringify(compra.body.juros))
  assert.ok(compra.body.juros.taxa_mensal > 1.9 && compra.body.juros.taxa_mensal < 2.1)

  const j = (await api('GET', 'despesas/juros?ano=2027')).body
  const c1 = j.compras.find(x => x.purchase_group_id === compra.body.purchase_group_id)
  assert.equal(c1.juros, 679.96)
  assert.equal(c1.a_vista, 5000)
  assert.ok(j.juros_ano > 0 && j.por_mes[0] > j.por_mes[10], 'juros não caem ao longo das parcelas')

  // Pela tela de Despesas, parcelado no cartão, com à vista.
  const desp = await api('POST', 'despesas', { descricao: 'Geladeira', categoria: 'Casa', valor: 3600, data: '2026-11-03', status: 'pendente',
    parcelado: true, numero_parcelas: 10, meio_pagamento: 'parcelado_cartao', cartao_id: cardId, valor_a_vista: 3200 })
  assert.equal(desp.status, 201, JSON.stringify(desp.body))
  assert.equal(desp.body.juros?.juros_total, 400)

  // Compra antiga, sem à vista: informar depois.
  const velha = await api('POST', `cartoes/${cardId}/compra`, { descricao: 'Sofá', categoria: 'Casa', valor_total: 2400, numero_parcelas: 6, data_compra: '2026-10-02' })
  const inf = await api('PATCH', `despesas/grupo/${velha.body.purchase_group_id}/juros`, { valor_a_vista: 2100 })
  assert.equal(inf.status, 200, JSON.stringify(inf.body))
  assert.equal(inf.body.juros_total, 300)
  const lim = await api('PATCH', `despesas/grupo/${velha.body.purchase_group_id}/juros`, { valor_a_vista: null })
  assert.equal(lim.body.limpo, true)
  assert.equal((await api('PATCH', `despesas/grupo/${velha.body.purchase_group_id}/juros`, { valor_a_vista: -5 })).status, 400)

  const sim = (await api('POST', 'despesas/simular-parcelamento', { valor_a_vista: 5000, numero_parcelas: 12, valor_parcela: 473.33 })).body
  assert.equal(sim.reserva.melhor, 'reserva', JSON.stringify(sim))
})

test('juros em compra à vista no cartão (1x) e parcelas sem número no nome agrupadas no financiamento', async () => {
  const cartao = await api('POST', 'cartoes', { nome: 'Cartão 1x', bandeira: 'visa', banco: 'E2E', limite_total: 20000, dia_fechamento: 25, dia_vencimento: 5 })
  const cardId = cartao.body.id ?? cartao.body?.cartao?.id
  // Conta de R$ 5.000 paga no cartão em 1x com taxa: R$ 5.150.
  const c1 = await api('POST', `cartoes/${cardId}/compra`, { descricao: 'Boleto condomínio no cartão', categoria: 'Moradia', valor_total: 5150, numero_parcelas: 1, data_compra: '2026-11-03', valor_a_vista: 5000 })
  assert.equal(c1.body.juros?.juros_total, 150, JSON.stringify(c1.body.juros))
  // Pela tela de Despesas, cartão de crédito à vista.
  const d1 = await api('POST', 'despesas', { descricao: 'IPVA no cartão', categoria: 'Transporte', valor: 2080, data: '2026-11-04', status: 'pendente',
    meio_pagamento: 'cartao_credito', cartao_id: cardId, valor_a_vista: 2000 })
  assert.equal(d1.body.juros?.juros_total, 80, JSON.stringify(d1.body))
  // Despesa já lançada, sem grupo: informar depois pelo id.
  const d2 = await api('POST', 'despesas', { descricao: 'Seguro carro no cartão', categoria: 'Transporte', valor: 1260, data: '2026-11-05', status: 'pendente', meio_pagamento: 'cartao_credito', cartao_id: cardId })
  const inf = await api('PATCH', `despesas/${d2.body.ids[0]}/juros`, { valor_a_vista: 1200 })
  assert.equal(inf.status, 200, JSON.stringify(inf.body))
  assert.equal(inf.body.juros_total, 60)
  const j = (await api('GET', 'despesas/juros?ano=2026&mes=11')).body
  assert.ok(j.compras.some(x => x.despesa_id === d2.body.ids[0] && x.juros === 60 && x.parcelas === 1), JSON.stringify(j.compras.slice(0, 5)))

  // Financiamento: duas compras de entrada em 10x, uma com parcela duplicada.
  const fin = await api('POST', 'financiamentos', { descricao: 'Apto Teste Serie', tipo_bem: 'imovel', valor_imovel: 300000, valor_entrada: 30000,
    valor_financiado: 240000, taxa_juros_anual: 9, numero_parcelas: 300, valor_parcela: 2300, sistema_amortizacao: 'sac', data_inicio: '2029-01-10' })
  const fid = fin.body.id
  const a = await api('POST', `cartoes/${cardId}/compra`, { descricao: 'Entrada Apto Teste Serie', categoria: 'Moradia', valor_total: 1579.4, numero_parcelas: 10, data_compra: '2026-10-14' })
  const b = await api('POST', `cartoes/${cardId}/compra`, { descricao: 'Entrada Apto Teste Serie', categoria: 'Moradia', valor_total: 1570.3, numero_parcelas: 10, data_compra: '2026-10-11' })
  // Duplica a parcela 3 da segunda compra (o mesmo lançamento entrou duas vezes).
  const p3 = lista((await api('GET', `despesas?purchase_group_id=${b.body.purchase_group_id}&limit=50`)).body).find(d => Number(d.parcela_atual) === 3)
  const dup = await api('POST', 'despesas', { descricao: 'Entrada Apto Teste Serie', categoria: 'Moradia', valor: p3.valor, data: String(p3.data).slice(0, 10), status: 'pendente' })
  // A duplicada não tem grupo nem número: fica avulsa — a série de b continua inteira.
  const cand = (await api('GET', `financiamentos/${fid}/candidatos`)).body
  const sa = cand.series.find(x => x.chave === `g:${a.body.purchase_group_id}`)
  const sb = cand.series.find(x => x.chave === `g:${b.body.purchase_group_id}`)
  assert.ok(sa && sb, `séries não encontradas: ${JSON.stringify(cand.series.map(x => x.chave))}`)
  assert.equal(sa.ids.length, 10)
  assert.equal(sb.ids.length, 10)
  assert.equal(sa.valor_total, 1579.4)
  assert.ok(cand.candidatos.some(c => c.id === dup.body.ids[0] && !c.serie), 'a duplicada sem número entrou numa série')
  const v = await api('POST', `financiamentos/${fid}/vincular`, { itens: [...sa.ids, ...sb.ids].map(id => ({ despesa_id: id, papel: 'entrada' })), nao: [dup.body.ids[0]] })
  assert.equal(v.body.vinculados, 20)
  const pn = (await api('GET', `financiamentos/${fid}/painel`)).body
  const ent = pn.painel.blocos.find(x => x.papel === 'entrada')
  assert.equal(Math.round((ent.pago + ent.pendente) * 100) / 100, 3149.7, 'cada parcela soma uma vez, pelo seu valor')
})

test('recorrência: mês lançado pela linha do tempo leva os juros/taxa do modelo; parcela renomeada não vira sugestão', async () => {
  const cartao = await api('POST', 'cartoes', { nome: 'Cartão Cond', bandeira: 'visa', banco: 'E2E', limite_total: 20000, dia_fechamento: 25, dia_vencimento: 5 })
  const cardId = cartao.body.id ?? cartao.body?.cartao?.id
  const rec = await api('POST', 'recorrencias', { tipo: 'despesa', descricao: 'Condomínio no cartão', valor: 1030, categoria: 'moradia', dia_vencimento: 5, data_inicio: '2026-06-01' })
  const recId = rec.body.id
  const m = await api('POST', `cartoes/${cardId}/compra`, { descricao: 'Condomínio no cartão', categoria: 'Moradia', valor_total: 1030, numero_parcelas: 1, data_compra: '2026-08-20', valor_a_vista: 1000 })
  assert.equal(m.body.juros?.juros_total, 30)
  await api('POST', `recorrencias/${recId}/vincular`, { lancamento_ids: m.body.despesa_ids })
  const set = await api('POST', `recorrencias/${recId}/preencher`, { mes: '2026-10' })
  assert.equal(set.status, 200, JSON.stringify(set.body))
  const lt = (await api('GET', `recorrencias/${recId}/linha-do-tempo`)).body
  assert.equal(lt.passadas.find(x => x.mes === '2026-10').lancamentos[0].juros, 30, 'o mês lançado perdeu os juros do modelo')

  // Compra em 10x cujas parcelas foram renomeadas sem o número.
  const c10 = await api('POST', `cartoes/${cardId}/compra`, { descricao: 'Sinal Apartamento Novo', categoria: 'Moradia', valor_total: 1500, numero_parcelas: 10, data_compra: '2026-03-10' })
  for (const id of c10.body.despesa_ids) {
    const d = lista((await api('GET', `despesas?purchase_group_id=${c10.body.purchase_group_id}&limit=50`)).body).find(x => x.id === id)
    await api('PUT', `despesas/${id}`, { descricao: 'Sinal Apartamento Novo', categoria: d.categoria, data: String(d.data).slice(0, 10), valor: d.valor, escopo: 'uma' })
  }
  const rast = (await api('GET', 'recorrencias/rastrear?tipo=despesa')).body
  assert.ok(!rast.despesa.novas.some(n => /SINAL APARTAMENTO/.test(n.chave)), 'parcela renomeada virou sugestão de recorrência')
})
