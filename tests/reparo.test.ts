/**
 * VerdeMais — o reparo de faturas
 * ============================================================================
 * 18/09/2026. Gustavo trocou umas despesas de "Financiamento" para "Moradia" e
 * as parcelas de outubro sumiram. A tela de Cartões dizia, ao mesmo tempo:
 *
 *   "Encontrei 12 faturas com problema"
 *   "6 parcelamento(s) com mês pulado"
 *   "Recolocar na fatura certa (2)"
 *
 * Os 2 eram dois lançamentos triviais de julho. As compras que sumiram — todas
 * vindas de importação de fatura — estavam fora da conta do botão, e o botão do
 * painel nem aparecia. O app apontava o buraco e escondia a pá.
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import { planejarReparo, importado } from '../src/routes/cartoes'
import { faturaDaParcela } from '../src/lib/fatura'

/** Uma série parcelada como o banco a guarda, com a fatura de cada parcela. */
function serie(opcoes: {
  grupo: string; n: number; faturas: Array<[number, number]>
  importada?: boolean; diaFechamento?: number; diaVencimento?: number
}) {
  const { grupo, n, faturas, importada = true } = opcoes
  return faturas.map(([mes, ano], i) => {
    const venc = `${ano}-${String(mes).padStart(2, '0')}-10`
    return {
      charge_id: `${grupo}-${i + 1}`, expense_id: 1000 + i,
      descricao: `Compra (${i + 1}/${n})`, valor: 150.23,
      // Importada: data_compra guarda o VENCIMENTO, não a data da compra.
      data_compra: importada ? venc : `2026-01-${String(5 + i).padStart(2, '0')}`,
      data_vencimento: venc,
      billing_month: mes, billing_year: ano,
      parcela_atual: i + 1, total_parcelas: n,
      purchase_group_id: grupo,
      dia_fechamento: opcoes.diaFechamento ?? 1,
      dia_vencimento: opcoes.diaVencimento ?? 10,
      cartao_nome: 'MercadoPago',
    }
  })
}

test('o caso do Gustavo: outubro vazio, novembro com duas, volta ao lugar', () => {
  // 10 parcelas começando em 3/2026. As parcelas 9 e 10 foram parar as duas em
  // 11/2026 e 10/2026 ficou sem nada — exatamente o que a tela mostrava.
  const faturas: Array<[number, number]> = [
    [3, 2026], [4, 2026], [5, 2026], [6, 2026], [7, 2026],
    [8, 2026], [9, 2026], [10, 2026], [11, 2026], [11, 2026],
  ]
  // A 8ª está em 10/2026 e a 9ª saltou para 11/2026: o buraco real é o da 9ª.
  faturas[7] = [11, 2026]   // a 8 pulou outubro
  const linhas = serie({ grupo: 'g1', n: 10, faturas })

  assert.ok(linhas.every(importado), 'a série de teste precisa ser importada')

  const acoes = planejarReparo(linhas)
  assert.ok(acoes.length > 0, 'o reparo não enxergou nada — foi isso que aconteceu de verdade')

  // Aplica o plano e confere o resultado: uma parcela por fatura, sem buraco.
  const depois = new Map(linhas.map(l => [l.charge_id, { mes: l.billing_month, ano: l.billing_year }]))
  for (const a of acoes) depois.set(a.charge_id, { mes: a.mes, ano: a.ano })

  const chaves = [...depois.values()].map(f => `${f.ano}-${String(f.mes).padStart(2, '0')}`)
  assert.equal(new Set(chaves).size, 10, `faturas repetidas depois do reparo: ${chaves.join(', ')}`)
  assert.ok(chaves.includes('2026-10'), 'outubro continuou vazio')

  // E a série fica contígua, uma fatura por mês.
  const ord = [...new Set(chaves)].sort()
  for (let i = 1; i < ord.length; i++) {
    const [a1, m1] = ord[i - 1].split('-').map(Number)
    const [a2, m2] = ord[i].split('-').map(Number)
    assert.equal(a2 * 12 + m2 - (a1 * 12 + m1), 1, `buraco entre ${ord[i - 1]} e ${ord[i]}`)
  }
})

test('série importada já correta não é tocada', () => {
  const faturas: Array<[number, number]> = Array.from({ length: 10 },
    (_, i) => [((2 + i) % 12) + 1, 2026 + Math.floor((2 + i) / 12)] as [number, number])
  const acoes = planejarReparo(serie({ grupo: 'g2', n: 10, faturas }))
  assert.equal(acoes.length, 0, 'o reparo mexeu no que já estava certo')
})

// A parte 2 do reparo recalcula o ciclo a partir de `data_compra`. Numa parcela
// isso é a regra errada, e enquanto ela não pulava parcelamento o reparo
// desfazia o próprio trabalho: toda parcela que a parte 1 considerou CERTA não
// entrava em `jaTratado`, caía na parte 2 e voltava para a fatura empilhada.
//
// O caso abaixo é um dos 53 em que as duas regras discordam: compra em
// 30/01/2026 num cartão que fecha dia 31. A parcela 2 pertence à fatura 2/2026
// pela contagem da série, e a regra da parte 2 a manda para 3/2026 — em cima
// da parcela 3.
test('o reparo não desfaz o próprio trabalho', () => {
  const compra = '2026-01-30'
  const fech = 31
  // A série como os geradores a criam hoje: certa pela regra ancorada.
  const linhas = Array.from({ length: 6 }, (_, i) => {
    const f = faturaDaParcela(compra, fech, 10, i)
    return {
      charge_id: `g3-${i + 1}`, expense_id: 3000 + i,
      descricao: `Compra (${i + 1}/6)`, valor: 100,
      data_compra: f.data_parcela, data_vencimento: f.vencimento,
      billing_month: f.mes, billing_year: f.ano,
      parcela_atual: i + 1, total_parcelas: 6, purchase_group_id: 'g3',
      dia_fechamento: fech, dia_vencimento: 10, cartao_nome: 'Itaú',
    }
  })

  // Nenhuma é importada: data_compra difere do vencimento.
  assert.ok(!linhas.some(importado))
  // E a série já ocupa seis faturas distintas — não há nada a consertar.
  assert.equal(new Set(linhas.map(l => `${l.billing_year}-${l.billing_month}`)).size, 6)

  const acoes = planejarReparo(linhas)
  assert.equal(acoes.length, 0,
    'o reparo quis mexer numa série já correta — é a parte 2 desfazendo a parte 1: ' +
    acoes.map((a: any) => `${a.charge_id} ${a.fatura_de}→${a.fatura_para}`).join(', '))
})
