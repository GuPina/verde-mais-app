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
