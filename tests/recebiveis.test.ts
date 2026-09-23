/**
 * VerdeMais — contrato corrigido por índice
 * ============================================================================
 * Os números são os da Restituição Cooperativa do Gustavo, lidos do app em
 * 23/09/2026: 34 parcelas de R$ 1.147,33 (o mínimo contratual), total
 * contratado R$ 39.009,35, cinco parcelas recebidas com correção do INCC.
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import { corrigir, somar } from '../src/lib/recebiveis'

const MINIMO = 1147.33
const CONTRATADO = 39009.35
const N = 34

/** As cinco recebidas, como estão no banco, mais as 29 pendentes. */
function restituicaoCooperativa(recebidas: number[] = [1147.33, 1147.33, 1160.00, 1221.63, 1193.72]) {
  return Array.from({ length: N }, (_, i) => i < recebidas.length
    ? { numero_parcela: i + 1, valor_previsto: MINIMO, valor: recebidas[i], status: 'recebida' }
    : { numero_parcela: i + 1, valor_previsto: MINIMO, valor: MINIMO, status: 'pendente' })
}

test('a tela mostra os cinco números combinados', () => {
  const c = corrigir(CONTRATADO, restituicaoCooperativa())
  assert.equal(c.contratado, 39009.35, 'a base do contrato não pode se mexer')
  assert.equal(c.correcao, 133.36, 'a correção já recebida')
  assert.equal(c.corrigido, 39142.71, 'o total que deixa de ser fixo')
  assert.equal(c.recebido, 5870.01, 'confere com o total_recebido do app')
  assert.equal(c.a_receber, 33272.70, '29 parcelas no mínimo contratual')
  assert.equal(c.correcao_pct, 0.34)
  assert.equal(c.parcelas_recebidas, 5)
})

// O ponto do pedido: o total sobe a cada lançamento, em vez de ficar parado.
test('cada parcela lançada acima do mínimo move o total', () => {
  const totais = [0, 1, 2, 3, 4, 5].map(n =>
    corrigir(CONTRATADO, restituicaoCooperativa([1147.33, 1147.33, 1160.00, 1221.63, 1193.72].slice(0, n))).corrigido)

  assert.deepEqual(totais, [
    39009.35,   // nada recebido: o contratado
    39009.35,   // parcela 1 veio no mínimo: nada muda
    39009.35,   // parcela 2 idem
    39022.02,   // parcela 3 trouxe +12,67
    39096.32,   // parcela 4 trouxe +74,30
    39142.71,   // parcela 5 trouxe +46,39
  ])

  // E nunca desce: a correção é acumulada, não substituída.
  for (let i = 1; i < totais.length; i++) assert.ok(totais[i] >= totais[i - 1])
})

// As pendentes valem o mínimo, e só. Projetar índice sobre 29 meses a partir de
// quatro observações seria número inventado com cara de medição — e o INCC
// CAIU entre a parcela 4 e a 5 desta própria base.
test('as pendentes não são reprojetadas', () => {
  const c = corrigir(CONTRATADO, restituicaoCooperativa())
  const pendentes = N - c.parcelas_recebidas
  assert.equal(c.a_receber, Math.round((c.corrigido - c.recebido) * 100) / 100)
  // O que falta é exatamente o mínimo vezes o número de parcelas que faltam,
  // a menos do centavo de arredondamento entre 34 × 1.147,33 e o contratado.
  assert.ok(Math.abs(c.a_receber - pendentes * MINIMO) < 0.20,
    `a receber ${c.a_receber} contra ${pendentes} × ${MINIMO}`)
})

test('contrato sem nenhuma parcela recebida não inventa correção', () => {
  const c = corrigir(CONTRATADO, restituicaoCooperativa([]))
  assert.equal(c.correcao, 0)
  assert.equal(c.corrigido, CONTRATADO)
  assert.equal(c.recebido, 0)
  assert.equal(c.a_receber, CONTRATADO)
})

// Linha gravada antes da migração 0009 não tem previsto. Tratar o previsto
// ausente como zero faria o excedente ser o valor INTEIRO da parcela e a
// correção saltar milhares de reais — um total inflado com cara de correto.
test('parcela sem previsto gravado não vira correção', () => {
  const antigas = [
    { numero_parcela: 1, valor: 1147.33, status: 'recebida' },
    { numero_parcela: 2, valor: 1221.63, status: 'recebida' },
  ]
  const c = corrigir(CONTRATADO, antigas)
  assert.equal(c.correcao, 0)
  assert.equal(c.corrigido, CONTRATADO)
  assert.equal(c.recebido, 2368.96)
})

// Pelo contrato não acontece. Se acontecer, é denunciado e não somado em
// silêncio: um negativo escondido dentro da correção faria a tela dizer que o
// índice devolveu menos do que devolveu.
test('parcela abaixo do mínimo é denunciada, não somada', () => {
  const c = corrigir(CONTRATADO, [
    { numero_parcela: 1, valor_previsto: MINIMO, valor: 1160.00, status: 'recebida' },
    { numero_parcela: 2, valor_previsto: MINIMO, valor: 900.00, status: 'recebida' },
  ])
  assert.equal(c.correcao, 12.67, 'o excedente negativo não entra na correção')
  assert.equal(c.abaixo_do_minimo.length, 1)
  assert.deepEqual(c.abaixo_do_minimo[0], { numero: 2, previsto: 1147.33, recebido: 900 })
  // Mas o recebido continua sendo o que entrou de verdade.
  assert.equal(c.recebido, 2060.00)
})

test('somar contratos preserva as contas', () => {
  const a = corrigir(CONTRATADO, restituicaoCooperativa())
  const b = corrigir(10000, [
    { numero_parcela: 1, valor_previsto: 1000, valor: 1050, status: 'recebida' },
  ])
  const t = somar([a, b])
  assert.equal(t.contratado, 49009.35)
  assert.equal(t.correcao, 183.36)
  assert.equal(t.corrigido, 49192.71)
  assert.equal(t.recebido, 6920.01)
  assert.equal(t.parcelas_recebidas, 6)
})
