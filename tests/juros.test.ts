/**
 * VerdeMais — juros do parcelamento
 * O caso que motivou: uma conta de R$ 5.000 em dezembro, parcelada no cartão
 * em 12x de R$ 473,33 porque o dinheiro não estava lá.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { separarJuros, taxaMensal, compararComReserva } from '../src/lib/juros'

const cent = (v: number) => Math.round(v * 100) / 100
const DOZE = Array.from({ length: 12 }, () => 473.33)

test('5.000 à vista em 12x de 473,33: 679,96 de juros a ~2% ao mês', () => {
  const s = separarJuros(5000, DOZE)!
  assert.equal(s.total, 5679.96)
  assert.equal(s.juros_total, 679.96)
  assert.ok(s.taxa_mensal > 1.99 && s.taxa_mensal < 2.03, String(s.taxa_mensal))
  assert.ok(s.taxa_anual > 26 && s.taxa_anual < 28, String(s.taxa_anual))
})

test('as partes de juros somam o total exato e caem a cada parcela', () => {
  const s = separarJuros(5000, DOZE)!
  assert.equal(cent(s.juros.reduce((a, b) => a + b, 0)), s.juros_total)
  assert.equal(s.juros.length, 12)
  for (let k = 1; k < 11; k++) assert.ok(s.juros[k] < s.juros[k - 1], `parcela ${k + 1} com mais juros que a anterior`)
  assert.ok(s.juros[0] > 95 && s.juros[0] < 105, String(s.juros[0]))   // 2% de 5.000
})

test('sem juros (à vista igual ao total) e parcela com centavos na última', () => {
  const s = separarJuros(1200, [400, 400, 400])!
  assert.equal(s.juros_total, 0)
  assert.deepEqual(s.juros, [0, 0, 0])
  assert.equal(taxaMensal(1000, [333.33, 333.33, 333.34]), 0)
  const t = separarJuros(1000, [350, 350, 350.01])!
  assert.equal(cent(t.juros.reduce((a, b) => a + b, 0)), 50.01)
})

test('à vista inválido ou parcela zerada não calcula', () => {
  assert.equal(separarJuros(0, DOZE), null)
  assert.equal(separarJuros(5000, []), null)
  assert.equal(separarJuros(5000, [100, 0]), null)
})

test('reserva a 0,9% contra parcelamento a 2%: usar a reserva sai mais barato', () => {
  const r = compararComReserva(5000, DOZE, 0.009)
  assert.equal(r.melhor, 'reserva')
  assert.ok(r.economia > 300 && r.economia < 450, String(r.economia))
})

test('parcelado SEM juros: deixar o dinheiro rendendo ganha da reserva', () => {
  const r = compararComReserva(1200, [100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100], 0.009)
  assert.equal(r.melhor, 'parcelar')
  assert.ok(r.economia > 50, String(r.economia))
})
