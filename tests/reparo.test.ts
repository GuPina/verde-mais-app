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

// ─── O caso que sobreviveu a duas correções ──────────────────────────────────
//
// Dados reais da conta do Gustavo, lidos do app em 18/09/2026. PgConta VICTOR
// Anual, 12 parcelas importadas no Itaú. Onze têm `data_compra` igual ao
// vencimento, como toda linha importada. A parcela 9 tem data_compra 08/10 e
// vencimento 08/11 — o UPDATE moveu a fatura dela e deixou a data_compra para
// trás.
//
// Essa diferença é EXATAMENTE o que `importado()` mede. O grupo era rasgado em
// dois: as onze sadias pela regra de importado, fechando certo entre si; a
// quebrada sozinha pela regra de compra, fechando certo como grupo de uma. As
// duas metades sem erro, outubro vazio, e a tela dizendo "está tudo no lugar".
const PGCONTA_VICTOR_ANUAL = [
  { p: 1,  fat: [2, 2026],  data: '2026-02-08', dc: '2026-02-08' },
  { p: 2,  fat: [3, 2026],  data: '2026-03-08', dc: '2026-03-08' },
  { p: 3,  fat: [4, 2026],  data: '2026-04-08', dc: '2026-04-08' },
  { p: 4,  fat: [5, 2026],  data: '2026-05-08', dc: '2026-05-08' },
  { p: 5,  fat: [6, 2026],  data: '2026-06-08', dc: '2026-06-08' },
  { p: 6,  fat: [7, 2026],  data: '2026-07-08', dc: '2026-07-08' },
  { p: 7,  fat: [8, 2026],  data: '2026-08-08', dc: '2026-08-08' },
  { p: 8,  fat: [9, 2026],  data: '2026-09-08', dc: '2026-09-08' },
  // A parcela que escapava da checagem por estar quebrada:
  { p: 9,  fat: [11, 2026], data: '2026-11-08', dc: '2026-10-08' },
  { p: 10, fat: [11, 2026], data: '2026-11-08', dc: '2026-11-08' },
  { p: 11, fat: [12, 2026], data: '2026-12-08', dc: '2026-12-08' },
  { p: 12, fat: [1, 2027],  data: '2027-01-08', dc: '2027-01-08' },
]

test('a parcela 9 volta para outubro — o caso real, ponta a ponta', () => {
  const linhas = PGCONTA_VICTOR_ANUAL.map(x => ({
    charge_id: `v-${x.p}`, expense_id: 9000 + x.p,
    descricao: `PgConta VICTOR - Anual Parcela (${x.p}/12)`, valor: 645.44,
    data_compra: x.dc, data_vencimento: x.data,
    billing_month: x.fat[0], billing_year: x.fat[1],
    parcela_atual: x.p, total_parcelas: 12, purchase_group_id: 'victor-anual',
    dia_fechamento: 1, dia_vencimento: 8, cartao_nome: 'Itaú',
  }))

  // A armadilha, registrada: onze linhas parecem importadas e uma não.
  assert.equal(linhas.filter(importado).length, 11)
  assert.equal(importado(linhas.find(l => l.parcela_atual === 9)!), false)

  const acoes = planejarReparo(linhas)
  assert.ok(acoes.length > 0, 'o reparo não viu nada — foi o que aconteceu de verdade')

  const daNove = acoes.find((a: any) => a.charge_id === 'v-9')
  assert.ok(daNove, 'a parcela 9 não entrou no plano')
  assert.equal(daNove.fatura_para, '10/2026', 'a parcela 9 precisa voltar para outubro')

  // Aplicado o plano: doze parcelas, doze faturas, nenhuma repetida, sem buraco.
  const depois = new Map(linhas.map(l => [l.charge_id, l.billing_year * 12 + l.billing_month]))
  for (const a of acoes) depois.set(a.charge_id, a.ano * 12 + a.mes)
  const meses = [...depois.values()].sort((x, y) => x - y)
  assert.equal(new Set(meses).size, 12, 'sobrou fatura com duas parcelas')
  for (let i = 1; i < meses.length; i++) {
    assert.equal(meses[i] - meses[i - 1], 1, 'sobrou mês sem parcela')
  }

  // E uma segunda passada não quer mudar mais nada.
  const aplicadas = linhas.map(l => {
    const a = acoes.find((x: any) => x.charge_id === l.charge_id)
    return a ? { ...l, billing_month: a.mes, billing_year: a.ano,
                 data_vencimento: a.vencimento, data_compra: a.data_compra } : l
  })
  assert.equal(planejarReparo(aplicadas).length, 0, 'o reparo não converge')
})
