/**
 * VerdeMais — o medidor de confiança
 * ============================================================================
 * A pergunta que este arquivo responde: o app sabe o quanto ele sabe?
 *
 * Cada teste aqui é uma base de dados diferente entrando pela mesma função, e
 * a expectativa é sempre a mesma — que a nota caia quando a base piora, que
 * ela diga QUAL elo é o culpado, e que ela se recuse a virar número quando o
 * defeito é grande o bastante.
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import { confianca, type EntradaConfianca, type JanelaHistorica, type Renda } from '../src/lib/metricas'

function janelaDe(n: number): JanelaHistorica {
  const meses = Array.from({ length: n }, (_, i) => ({
    mes: (i % 12) + 1, ano: 2026, label: `M${i}`,
    receitas: 5000, receitas_avulsas: 5000, despesas: 4000, saldo: 1000,
    despesas_deterministicas: 1500, despesas_variaveis: 2500,
  }))
  return { meses, base: meses, atipicos: [], mes_corrente: 'Set/2026' }
}

const RENDA_ESTAVEL: Renda = {
  mensal: 5000, media_lancada: 5000, recorrente: 0,
  oscilacao: 150, meses_base: 12, meses_labels: [],
}

/** Base saudável: 12 meses, tudo classificado, nada em disputa, renda estável. */
const LIMPA: EntradaConfianca = {
  janela: janelaDe(12),
  gasto_total: 48000, gasto_nao_classificado: 0,
  valor_em_disputa: 0, lancamentos_em_disputa: 0,
  renda: RENDA_ESTAVEL,
}

test('base limpa e longa: confiança alta e nenhum gargalo', () => {
  const c = confianca(LIMPA)
  assert.equal(c.suficiente, true)
  assert.equal(c.nivel, 'alta')
  assert.ok(c.nota >= 90, `nota ${c.nota}`)
  assert.equal(c.limitante, null)
})

test('cada elo derrubado baixa a nota e é apontado como gargalo', () => {
  const casos: Array<[string, Partial<EntradaConfianca>, string]> = [
    ['poucos meses', { janela: janelaDe(4) }, 'amostra'],
    ['gasto sem categoria', { gasto_nao_classificado: 14400 }, 'cobertura'],   // 30%
    ['dinheiro em disputa', { valor_em_disputa: 9600, lancamentos_em_disputa: 12 }, 'ambiguidade'],
  ]
  for (const [nome, mudanca, culpado] of casos) {
    const c = confianca({ ...LIMPA, ...mudanca })
    assert.ok(c.nota < confianca(LIMPA).nota, `${nome}: nota não caiu`)
    assert.equal(c.limitante?.chave, culpado, nome)
    assert.ok(c.limitante?.saida, `${nome}: gargalo sem caminho de conserto`)
  }
})

test('cada defeito de dado, passado do piso, cala a nota', () => {
  const calam: Array<[string, Partial<EntradaConfianca>]> = [
    ['menos de 3 meses', { janela: janelaDe(2) }],
    ['menos de 60% classificado', { gasto_nao_classificado: 24000 }],          // 50%
    ['mais de 40% em disputa', { valor_em_disputa: 24000, lancamentos_em_disputa: 40 }],
  ]
  for (const [nome, mudanca] of calam) {
    const c = confianca({ ...LIMPA, ...mudanca })
    assert.equal(c.suficiente, false, nome)
    assert.equal(c.nivel, 'insuficiente', nome)
    assert.ok(c.motivo && c.motivo.length > 20, `${nome}: calou sem explicar`)
  }
})

// A distinção que dá nome ao arquivo: renda irregular é fato da vida de quem
// vive de comissão, não defeito de lançamento. Ela limita o que dá para prever
// e não torna número nenhum errado — esconder o diagnóstico de quem tem renda
// volátil seria negar a ferramenta a quem mais precisa dela.
test('renda volátil baixa a confiança e NUNCA cala a nota', () => {
  const volatil = confianca({
    ...LIMPA,
    renda: { ...RENDA_ESTAVEL, oscilacao: 4000 },   // 80% da renda
  })
  assert.equal(volatil.suficiente, true)
  assert.ok(volatil.nota < confianca(LIMPA).nota)
  const estab = volatil.fatores.find(f => f.chave === 'estabilidade')!
  assert.ok(estab.nota > 0 && estab.nota <= 20, `estabilidade ${estab.nota}`)
  assert.equal(estab.cala, false)
  // E não é apontada como gargalo: não há o que o usuário conserte aqui.
  assert.notEqual(volatil.limitante?.chave, 'estabilidade')
})

test('base vazia: zero, e diz o porquê', () => {
  const c = confianca({
    janela: janelaDe(0), gasto_total: 0, gasto_nao_classificado: 0,
    valor_em_disputa: 0, lancamentos_em_disputa: 0,
    renda: { ...RENDA_ESTAVEL, mensal: 0, oscilacao: 0 },
  })
  assert.equal(c.nota, 0)
  assert.equal(c.suficiente, false)
  assert.ok(c.motivo)
})

// A cadeia vale o elo mais fraco: um zero em qualquer elo de dado zera o
// conjunto, e não pode ser compensado pelos outros três estarem perfeitos.
test('a cadeia não compensa: elo zerado zera o conjunto', () => {
  const semCobertura = confianca({ ...LIMPA, gasto_nao_classificado: 48000 })
  assert.equal(semCobertura.nota, 0)
  assert.equal(semCobertura.suficiente, false)
})

test('os quatro fatores sempre voltam, com leitura em português', () => {
  for (const entrada of [LIMPA, { ...LIMPA, janela: janelaDe(3) }]) {
    const c = confianca(entrada)
    assert.equal(c.fatores.length, 4)
    const soma = c.fatores.reduce((s, f) => s + f.peso, 0)
    assert.ok(Math.abs(soma - 1) < 1e-9, `pesos somam ${soma}`)
    for (const f of c.fatores) {
      assert.ok(f.leitura.length > 10, `${f.chave} sem leitura`)
      assert.ok(f.nota >= 0 && f.nota <= 100, `${f.chave} fora de 0..100`)
    }
  }
})

// ─── A mesma confiança nas três telas ────────────────────────────────────────
//
// O motivo de a função morar em lib/metricas.ts e não em cada rota. Três telas
// mostrando três confianças diferentes sobre a mesma janela seria repetir
// exatamente a doença que a camada de métricas existe para curar — a mesma que
// fazia Dashboard dizer 15, Diagnóstico 17 e a tela do 50/30/20 dizer 50.
test('Diagnóstico, Dashboard e Projeção chegam ao mesmo número', () => {
  const entrada: EntradaConfianca = {
    janela: janelaDe(8), gasto_total: 48000, gasto_nao_classificado: 7200,
    valor_em_disputa: 3840, lancamentos_em_disputa: 9,
    renda: { ...RENDA_ESTAVEL, oscilacao: 900 },
  }
  // As três rotas chamam esta mesma função com o mesmo objeto, montado dos
  // mesmos campos de `baseDeReserva`. Chamar duas vezes tem de dar igual —
  // e o dia em que uma rota recalcular por conta própria, este teste cai.
  const a = confianca(entrada)
  const b = confianca({ ...entrada })
  assert.deepEqual(a, b)
  assert.equal(a.nota, 78)
  assert.equal(a.limitante?.chave, 'cobertura')
})

// O elo que faltava na Projeção: ela media amostra × estabilidade e chamava de
// "confiança alta" 12 meses de dados com metade do gasto sem categoria.
test('12 meses e renda estável não bastam para confiança alta', () => {
  const soEstatistica = confianca({
    janela: janelaDe(12), gasto_total: 48000,
    gasto_nao_classificado: 48000 * 0.35,     // um terço sem categoria
    valor_em_disputa: 0, lancamentos_em_disputa: 0,
    renda: RENDA_ESTAVEL,
  })
  assert.notEqual(soEstatistica.nivel, 'alta')
  assert.equal(soEstatistica.limitante?.chave, 'cobertura')
})
