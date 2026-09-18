/**
 * VerdeMais — os testes do núcleo
 * ============================================================================
 * Esta suíte nasceu da auditoria de 16/09/2026, e cada bloco aqui é um defeito
 * que existiu em produção. Os quatro primeiros tinham a mesma assinatura: eram
 * invisíveis, porque erravam para o lado que deixa os números bonitos.
 *
 *   `npm test`
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import { renda, janelaHistorica } from '../src/lib/metricas'
import { raizCategoria, categoriaCanonica } from '../src/lib/identidade'
import { fatiaDe, gastoEssencial } from '../src/lib/divisao'
import { ehDataISO, normalizarData } from '../src/lib/validacao'
import { faturaDaParcela } from '../src/lib/fatura'

// ─── 1. A renda não pode ser contada duas vezes ──────────────────────────────
//
// A recorrência de receita MATERIALIZA linhas em `receitas`. Somar a média das
// linhas com o valor das recorrências ativas dava, para um salário de R$ 5.000,
// uma renda de R$ 10.000 — e renda é o denominador do comprometimento, da
// sobra, dos quatro pilares do score e dos percentuais do 50/30/20.

const SALARIO = 5000

function bancoDeMentira(cenario: 'gerada' | 'manual' | 'so_recorrencia') {
  return {
    prepare(sql: string) {
      return {
        bind() {
          return {
            async first() {
              if (/FROM recorrencias/.test(sql)) {
                return { total: cenario === 'manual' ? 0 : SALARIO }
              }
              if (/FROM receitas/.test(sql)) {
                if (cenario === 'so_recorrencia') return { total: 0 }
                if (cenario === 'manual') return { total: SALARIO }
                return { total: /NOT IN/.test(sql) ? 0 : SALARIO }
              }
              return { total: 3000 }   // despesas
            },
            async all() {
              if (/FROM recorrencias/.test(sql)) {
                return { results: cenario === 'manual' ? [] : [{ id: 7 }] }
              }
              return { results: [] }
            },
            async run() { return {} },
          }
        },
      }
    },
  } as any
}

for (const cenario of ['gerada', 'manual', 'so_recorrencia'] as const) {
  test(`renda: R$ ${SALARIO} continua R$ ${SALARIO} (${cenario})`, async () => {
    const db = bancoDeMentira(cenario)
    const r = await renda(db, 1, await janelaHistorica(db, 1, 12))
    assert.equal(r.mensal, SALARIO)
  })
}

// ─── 2. O dicionário de sinônimos precisa ser alcançável ─────────────────────
//
// `categoriaCanonica` busca por `raizCategoria(texto)`, que singulariza. As
// chaves do mapa estão em português corrente. 18 das 107 estavam mortas.

test('sinônimos: as chaves no plural respondem', () => {
  const esperado: Record<string, string> = {
    'Roupas': 'Vestuário', 'Impostos': 'Impostos e taxas', 'Taxas': 'Impostos e taxas',
    'Ônibus': 'Transporte', 'Contas da casa': 'Moradia', 'Compras do mês': 'Mercado',
    'Presentes': 'Presentes e doações', 'Doações': 'Presentes e doações',
    'Livros': 'Educação', 'Cursos': 'Educação', 'Jogos': 'Lazer', 'Viagens': 'Viagem',
    'Softwares': 'Software', 'Animais': 'Pets', 'Seguros': 'Serviços',
  }
  for (const [nome, categoria] of Object.entries(esperado)) {
    assert.equal(categoriaCanonica(nome), categoria, `"${nome}"`)
  }
})

// O plural em -ais vem de -al: cortar só o "s" fazia "pessoais" virar
// "pessoai", e "Cuidados pessoais" — que está no VOCABULARIO — não casava nem
// consigo mesma. A guarda de 5 letras existe porque "pais" é plural de "pai".
test('raiz: o plural em -ais volta para -al, sem estragar palavra curta', () => {
  const casos: Array<[string, string]> = [
    ['Cuidados pessoais', 'cuidado pessoal'], ['Animais', 'animal'],
    ['Papéis', 'papel'], ['Lençóis', 'lencol'], ['Jornais', 'jornal'],
    ['Hospitais', 'hospital'], ['Casais', 'casal'],
    ['Pais', 'pai'], ['Mais', 'mai'], ['Seis', 'sei'],
    ['Pós-Graduação', 'pos graduacao'], ['Financiamentos', 'financiamento'],
  ]
  for (const [entrada, raiz] of casos) assert.equal(raizCategoria(entrada), raiz, entrada)
})

// ─── 3. Categoria mal escrita não pode encolher a reserva ────────────────────
//
// O mesmo mês, escrito de duas maneiras, precisa dar o mesmo gasto essencial.
// Antes: R$ 3.900 contra R$ 1.800, e o alvo de reserva caía de R$ 23.400 para
// R$ 10.800 — o pilar Fôlego dizendo "você está coberto" anos antes da hora.

const MES_LIMPO = [
  { categoria: 'Moradia', valor: 1800 }, { categoria: 'Mercado', valor: 1200 },
  { categoria: 'Combustível', valor: 400 }, { categoria: 'Saúde', valor: 500 },
  { categoria: 'Assinaturas', valor: 55 },
]
const MES_COMO_SE_DIGITA = [
  { categoria: 'Contas da casa', valor: 1800 }, { categoria: 'Compras do mês', valor: 1200 },
  { categoria: 'Posto', valor: 400 }, { categoria: 'Unimed', valor: 500 },
  { categoria: 'Outros', valor: 55 },
]

test('reserva: as duas grafias do mesmo mês dão o mesmo essencial', () => {
  assert.equal(gastoEssencial(MES_LIMPO as any), 3900)
  assert.equal(gastoEssencial(MES_COMO_SE_DIGITA as any), 3900)
})

// A tradução é RESGATE, nunca correção: ela só vale para o que caiu fora das
// listas. Traduzir ANTES manda "Delivery" e "iFood" para Alimentação, que é
// necessidade — e a diferença entre necessidade e desejo é a tela do 50/30/20.
test('fatia: a tradução não promove desejo a necessidade', () => {
  for (const n of ['Restaurante', 'Delivery', 'iFood', 'Lanche', 'Academia', 'Beleza']) {
    assert.equal(fatiaDe({ categoria: n, valor: 100 } as any), 'desejos', n)
  }
  for (const n of ['Mensalidade escolar', 'Conta de luz', 'Aluguel', 'Uber', 'Posto']) {
    assert.equal(fatiaDe({ categoria: n, valor: 100 } as any), 'necessidades', n)
  }
})

// Nome que é a própria confissão de que ninguém classificou não vira desejo.
test('fatia: os nomes vazios caem em nao_classificado', () => {
  for (const n of ['Outros', 'Outro', 'Diversos', 'Diverso', 'Sem categoria', 'Geral', '', '  ']) {
    assert.equal(fatiaDe({ categoria: n, valor: 100 } as any), 'nao_classificado', JSON.stringify(n))
  }
})

// ─── 4. Data que não existe no calendário não entra ──────────────────────────
//
// `new Date('2026-02-31T12:00:00')` NÃO é inválida em JavaScript: o motor
// empurra para 3 de março. Três validadores confiavam nisso.

test('data: 31 de fevereiro é recusado, 29 só em ano bissexto', () => {
  for (const d of ['2026-02-31', '2026-04-31', '2026-13-01', '2027-02-29', '2026-00-10']) {
    assert.equal(ehDataISO(d), false, d)
  }
  for (const d of ['2028-02-29', '2026-08-17', '2026-12-31']) {
    assert.equal(ehDataISO(d), true, d)
  }
  assert.equal(normalizarData('31/02/2026'), null)
  assert.equal(normalizarData('17/08/2026'), '2026-08-17')
})

// ─── 5. Uma compra em 12x cabe em 12 faturas ─────────────────────────────────
//
// A parcela N sai da fatura da compra MAIS N meses — contada, não recalculada.
// Recalcular cruzava dois arredondamentos independentes e empilhava duas
// parcelas na mesma fatura.

test('fatura: 24 parcelas caem em 24 faturas distintas, em qualquer dia', () => {
  for (let dia = 1; dia <= 28; dia++) {
    for (const fechamento of [1, 5, 15, 28, 31]) {
      const compra = `2026-${String(((dia % 12) + 1)).padStart(2, '0')}-${String(dia).padStart(2, '0')}`
      const vistas = new Set<string>()
      for (let i = 0; i < 24; i++) {
        const f = faturaDaParcela(compra, fechamento, 10, i)
        vistas.add(`${f.ano}-${f.mes}`)
      }
      assert.equal(vistas.size, 24, `${compra} fech=${fechamento}`)
    }
  }
})

// ─── 6. Editar a categoria não pode mover a parcela de fatura ────────────────
//
// 18/09/2026: Gustavo trocou umas despesas de "Financiamento" para "Moradia"
// e as parcelas de OUTUBRO sumiram. O UPDATE de despesa recalculava a fatura de
// cada parcela irmã com `faturaDaCompra(data_compra_dela)` — e o `data_compra`
// de uma parcela não é a data da compra: é `somarMeses(compra, n-1)`, já com
// clamp. Recalcular a partir dela cruza dois arredondamentos independentes,
// empilha duas parcelas numa fatura e esvazia a anterior.
//
// Pior: o laço rodava em QUALQUER edição com cartão. O formulário reenvia o
// `cartao_id`, então trocar só a categoria bastava.

import { faturaDaCompra, faturaDaParcelaAncorada, somarMeses } from '../src/lib/fatura'

test('a regra velha empilha parcelas; a ancorada não, em nenhuma combinação', () => {
  let empilhadasVelha = 0, empilhadasNova = 0
  let exemplo: string | null = null

  for (let dia = 1; dia <= 31; dia++) {
    for (let mes = 1; mes <= 12; mes++) {
      const ultimo = new Date(Date.UTC(2026, mes, 0)).getUTCDate()
      if (dia > ultimo) continue
      const compra = `2026-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`
      for (const fechamento of [1, 5, 10, 15, 20, 25, 28, 30, 31]) {
        const velha = new Set<string>(), nova = new Set<string>()
        for (let n = 1; n <= 12; n++) {
          // Como o UPDATE fazia: a data já deslocada da parcela, recalculada.
          const dataDaParcela = somarMeses(compra, n - 1)
          const v = faturaDaCompra(dataDaParcela, fechamento, 10)
          velha.add(`${v.ano}-${v.mes}`)
          // Como passa a fazer: a série contada a partir da primeira.
          const a = faturaDaParcelaAncorada(compra, 1, n, fechamento, 10)
          nova.add(`${a.ano}-${a.mes}`)
        }
        if (velha.size < 12) {
          empilhadasVelha++
          if (!exemplo) exemplo = `${compra}, fechamento ${fechamento}: ${velha.size} faturas para 12 parcelas`
        }
        if (nova.size < 12) empilhadasNova++
      }
    }
  }

  // A guarda de que o teste está medindo alguma coisa: se a regra velha parar
  // de falhar, é o teste que quebrou, não o bug que sumiu.
  assert.ok(empilhadasVelha > 0, 'a regra velha deveria falhar — o teste não está medindo nada')
  assert.equal(empilhadasNova, 0,
    `a regra ancorada empilhou em ${empilhadasNova} combinações`)
  // 53 combinações de (data da compra × dia de fechamento) na varredura, medido
  // em 18/09/2026 — entre elas 2026-01-28 com fechamento 30, que dá 11 faturas
  // para 12 parcelas. Uma delas era a de outubro do Gustavo.
  assert.ok(empilhadasVelha >= 50, `só ${empilhadasVelha} combinações quebradas (${exemplo})`)
})

test('a âncora vale mesmo quando a série não começa em 1/N', () => {
  // Compra importada com parcelas já pagas: o grupo pode começar em 3/10.
  const compra = '2026-01-31'
  const vistas = new Set<string>()
  for (let n = 3; n <= 10; n++) {
    const f = faturaDaParcelaAncorada(compra, 3, n, 31, 10)
    vistas.add(`${f.ano}-${f.mes}`)
  }
  assert.equal(vistas.size, 8)
})

// ─── 7. O reparo de parcelamento importado ───────────────────────────────────
//
// Numa linha vinda de importação, `data_compra` é o vencimento, não a compra —
// então a regra de ciclo não se aplica. Mas a parcela 9 de 10 pertence à fatura
// da parcela 1 mais oito meses, e isso é CONTAGEM, não ciclo. As três compras
// que sumiram de outubro na conta do Gustavo eram todas importadas.
function serieImportada(mes1: number, ano1: number, n: number) {
  const fora: Array<{ parcela: number; mes: number; ano: number }> = []
  for (let k = 0; k < n; k++) {
    let m = mes1 + k
    const a = ano1 + Math.floor((m - 1) / 12)
    m = ((m - 1) % 12) + 1
    fora.push({ parcela: k + 1, mes: m, ano: a })
  }
  return fora
}

test('parcelamento importado: uma fatura por parcela, atravessando o ano', () => {
  // O caso real: 10 parcelas começando em 2/2026 — a 9ª cai em 10/2026, que é
  // o mês que tinha ficado vazio, e a 10ª em 11/2026, onde estavam as duas.
  const serie = serieImportada(2, 2026, 10)
  const meses = new Set(serie.map(s => `${s.ano}-${s.mes}`))
  assert.equal(meses.size, 10, 'duas parcelas caíram na mesma fatura')
  assert.deepEqual(serie[8], { parcela: 9, mes: 10, ano: 2026 })
  assert.deepEqual(serie[9], { parcela: 10, mes: 11, ano: 2026 })

  // E a virada de ano continua inteira.
  const virada = serieImportada(11, 2026, 4)
  assert.deepEqual(virada.map(v => `${v.mes}/${v.ano}`),
    ['11/2026', '12/2026', '1/2027', '2/2027'])
})
