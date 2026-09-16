/**
 * VerdeMais — a divisão do gasto em quatro
 * ============================================================================
 * Auditoria da tela 50/30/20 em 14/09/2026, com os números dela mesma:
 *
 *   Necessidades          R$ 2.642,06    48,6%
 *   Desejos               R$ 2.167,38    39,8%
 *   Poupança              R$     0,00     0,0%
 *   ────────────────────────────────────────
 *   Soma das três         R$ 4.809,44    88,4%
 *   Despesa real do mês   R$ 7.502,14   137,9%
 *   FORA DO GRÁFICO       R$ 2.692,70    36,0%
 *
 * 36% do dinheiro saía do gráfico. O modelo 50/30/20 não tem gaveta para
 * pagamento de dívida, e a tela simplesmente não mostrava o que não
 * classificava — e então dizia "48,6% de necessidades, quase no ideal" para
 * alguém cujo mês fecha no vermelho. Era por isso que ela dava nota 50
 * enquanto o Diagnóstico dava 17: uma estava olhando 64% da vida da pessoa.
 *
 * Aqui são QUATRO fatias: Necessidades · Desejos · Dívidas · Poupança. O ideal
 * clássico (50/30/20) continua sendo a referência, mas com a dívida à vista —
 * porque é dela que sai a poupança que não existe. A soma pode passar de 100%,
 * e deve: quando passa, o mês fechou no vermelho, e é exatamente isso que a
 * tela precisa conseguir mostrar em vez de esconder.
 *
 * ── DUAS REGRAS ─────────────────────────────────────────────────────────────
 *
 * 1. DÍVIDA VEM DO VÍNCULO, NÃO DO NOME DA CATEGORIA. Uma parcela é achada
 *    pelo carimbo que o próprio sistema pôs na despesa. Filtrar por categoria
 *    "Financiamento" pegava "PgConta VICTOR" e uma cobrança avulsa da Caixa —
 *    R$ 1.623,75 de prestação que não existe.
 *
 * 2. CATEGORIA DESCONHECIDA NÃO VIRA DESEJO. A regra antiga mandava todo nome
 *    que ela não reconhecia para "Desejos" — inclusive "Outros", que tem 44
 *    lançamentos nesta base. Chamar de supérfluo o que o sistema não soube
 *    ler é acusar o usuário de um defeito do sistema. Agora sobra numa quinta
 *    caixa, `nao_classificado`, que a tela mostra e oferece resolver.
 */

import { vinculoDe, raizCategoria, categoriaCanonica } from './identidade'

const cent = (v: number) => Math.round((Number(v) || 0) * 100) / 100

export type Fatia = 'necessidades' | 'desejos' | 'dividas' | 'poupanca' | 'nao_classificado'

/**
 * Necessidade é o que você continua pagando no mês em que a renda falta: onde
 * você mora, como você chega no trabalho, o que você come, o remédio que você
 * toma. É esta lista — e não o total de saídas — que define o tamanho da
 * reserva de emergência, porque no mês ruim você corta o streaming, não o
 * aluguel.
 */
const NECESSIDADE = [
  'moradia', 'aluguel', 'condominio', 'iptu', 'agua', 'luz', 'energia', 'gas',
  'internet', 'telefone', 'celular', 'mercado', 'supermercado', 'feira',
  'alimentacao', 'comida', 'saude', 'farmacia', 'remedio', 'medico', 'dentista',
  'plano de saude', 'transporte', 'combustivel', 'gasolina', 'etanol', 'onibus',
  'metro', 'educacao', 'escola', 'faculdade', 'creche', 'mensalidade escolar',
  'seguro', 'servico', 'conta', 'imposto', 'taxa', 'trabalho', 'pensao',
]

/** O que se corta primeiro sem mudar de vida — só de humor. */
const DESEJO = [
  'lazer', 'viagem', 'entretenimento', 'diversao', 'cinema', 'bar', 'jogo',
  'game', 'hobby', 'restaurante', 'delivery', 'ifood', 'lanche', 'roupa',
  'vestuario', 'calcado', 'moda', 'beleza', 'cosmetico', 'cabeleireiro',
  'barbearia', 'academia', 'esporte', 'assinatura', 'streaming', 'software',
  'app', 'aplicativo', 'eletronico', 'tecnologia', 'shopping', 'presente',
  'pet', 'petshop', 'veterinario', 'cuidado pessoal',
]

/** Dinheiro que muda de lugar, não que sai da vida. */
const POUPANCA = [
  'investimento', 'poupanca', 'reserva', 'aplicacao', 'tesouro', 'previdencia',
  'cdb', 'lci', 'lca', 'fundo', 'aporte',
]

/**
 * Nomes que são, eles próprios, a confissão de que ninguém classificou.
 *
 * A comparação é contra `raizCategoria`, então as entradas ficam no singular
 * que ela produz — e é por isso que a lista é montada a partir das grafias
 * correntes em vez de escrita já normalizada à mão. Até 16/09/2026 havia um
 * `'divero'` aqui, erro de digitação de `'diverso'` que nenhuma categoria
 * jamais igualaria.
 */
const VAZIO = new Set(
  ['Outros', 'Outro', 'Sem categoria', 'Diversos', 'Diverso', 'Geral', '']
    .map(n => raizCategoria(n))
)

function bate(raiz: string, lista: string[]): boolean {
  return lista.some(t => raiz === t || raiz.startsWith(t + ' ') || raiz.includes(' ' + t))
}

export interface DespesaDivisivel {
  id?: number
  descricao?: string | null
  categoria?: string | null
  valor: number
  observacoes?: string | null
  recorrencia_id?: number | null
  /** Parcelamento no cartão: é prestação mesmo sem carimbo de contrato. */
  numero_parcelas?: number | null
  cartao_id?: number | null
  /** Decisão gravada pelo usuário na identidade, quando existir. Ela manda. */
  fatia_manual?: Fatia | null
}

/**
 * Em qual das quatro esta despesa cai.
 *
 * A ordem importa: decisão do usuário → vínculo de dívida → poupança →
 * necessidade → desejo → não classificado. Vínculo vem antes de qualquer
 * palavra porque é fato; e "não classificado" existe justamente para que
 * nenhuma etapa precise chutar.
 */
export function fatiaDe(d: DespesaDivisivel): Fatia {
  if (d.fatia_manual) return d.fatia_manual

  // 1. Dívida pelo vínculo do sistema — empréstimo, financiamento.
  const v = vinculoDe(d)
  if (v && (v.tipo === 'emprestimo' || v.tipo === 'financiamento')) return 'dividas'

  // 2. Parcelamento no cartão é prestação: já está contratado e sai todo mês
  //    até acabar, exatamente como uma parcela de empréstimo.
  if (d.cartao_id && Number(d.numero_parcelas || 1) > 1) return 'dividas'

  // 3. O nome que a pessoa escreveu, lido ao pé da letra.
  const bruta = d.categoria || ''
  const raiz = raizCategoria(bruta)
  if (!raiz || VAZIO.has(raiz)) return 'nao_classificado'

  const direta = porPalavra(raiz)
  if (direta) return direta

  // 4. Só então, traduzido para o vocabulário do sistema.
  //
  // A tradução é RESGATE, nunca correção: ela só é consultada para o que
  // acabou de cair fora. Tentar traduzir antes parece mais limpo e destrói a
  // divisão — medido em 16/09/2026, `categoriaCanonica` manda "Delivery",
  // "iFood" e "Lanche" para Alimentação, e Alimentação é necessidade; um único
  // `||` a mais na linha acima virava iFood em despesa essencial, e a diferença
  // entre necessidade e desejo é a tela inteira do 50/30/20.
  //
  // Sem a etapa 4, porém, as listas só reconheciam quem já escrevia como elas:
  // o mesmo mês digitado como as pessoas digitam ("Contas da casa", "Compras
  // do mês", "Posto") derrubava o gasto essencial de R$ 3.900 para R$ 1.800 e o
  // alvo de reserva de R$ 23.400 para R$ 10.800 — o pilar Fôlego dizendo "você
  // está coberto" anos antes da hora.
  //
  // Nesta ordem, nada que já era classificado muda de fatia. Só o que estava
  // perdido pode ser achado.
  const canonica = categoriaCanonica(bruta)
  if (canonica) {
    const raizCanonica = raizCategoria(canonica)
    if (raizCanonica && !VAZIO.has(raizCanonica)) {
      const viaDicionario = porPalavra(raizCanonica)
      if (viaDicionario) return viaDicionario
    }
  }

  return 'nao_classificado'
}

/** As quatro listas de palavras, na ordem. `null` quando nenhuma reconhece. */
function porPalavra(raiz: string): Fatia | null {
  if (bate(raiz, POUPANCA)) return 'poupanca'
  // Um nome de categoria que fala de dívida, quando não há vínculo, ainda
  // conta — mas só quando é inequívoco.
  if (bate(raiz, ['financiamento', 'emprestimo', 'consorcio', 'divida'])) return 'dividas'
  if (bate(raiz, NECESSIDADE)) return 'necessidades'
  if (bate(raiz, DESEJO)) return 'desejos'
  return null
}

export interface Divisao {
  necessidades: number
  desejos: number
  dividas: number
  poupanca: number
  nao_classificado: number
  total: number
  /** Percentuais sobre a RENDA, não sobre o total gasto. */
  pct: Record<Fatia, number>
  /** Quanto de cada fatia, por categoria — para a tela abrir a gaveta. */
  detalhe: Record<Fatia, Array<{ nome: string; valor: number; n: number }>>
}

const ZERO_PCT: Record<Fatia, number> = {
  necessidades: 0, desejos: 0, dividas: 0, poupanca: 0, nao_classificado: 0,
}

/**
 * Divide um conjunto de despesas nas quatro fatias.
 *
 * Os percentuais são sobre a RENDA e não sobre o total gasto — é a única forma
 * de a soma poder passar de 100% e denunciar o mês no vermelho. Percentual
 * sobre o próprio gasto sempre fecha em 100% e esconde exatamente o que
 * interessa.
 */
export function dividir(despesas: DespesaDivisivel[], rendaMensal: number): Divisao {
  const soma: Record<Fatia, number> = {
    necessidades: 0, desejos: 0, dividas: 0, poupanca: 0, nao_classificado: 0,
  }
  const porCat: Record<Fatia, Map<string, { valor: number; n: number }>> = {
    necessidades: new Map(), desejos: new Map(), dividas: new Map(),
    poupanca: new Map(), nao_classificado: new Map(),
  }

  for (const d of despesas) {
    const f = fatiaDe(d)
    const v = Number(d.valor) || 0
    soma[f] = cent(soma[f] + v)
    const nome = String(d.categoria || '').trim() || 'Sem categoria'
    const a = porCat[f].get(nome) || { valor: 0, n: 0 }
    a.valor = cent(a.valor + v); a.n++
    porCat[f].set(nome, a)
  }

  const total = cent(soma.necessidades + soma.desejos + soma.dividas +
                     soma.poupanca + soma.nao_classificado)
  const pct = { ...ZERO_PCT }
  if (rendaMensal > 0) {
    for (const k of Object.keys(soma) as Fatia[]) {
      pct[k] = Math.round((soma[k] / rendaMensal) * 1000) / 10
    }
  }

  const detalhe = {} as Divisao['detalhe']
  for (const k of Object.keys(porCat) as Fatia[]) {
    detalhe[k] = [...porCat[k].entries()]
      .map(([nome, x]) => ({ nome, valor: x.valor, n: x.n }))
      .sort((a, b) => b.valor - a.valor)
  }

  return { ...soma, total, pct, detalhe }
}

/**
 * O gasto que a reserva de emergência precisa cobrir.
 *
 * Só necessidades. A reserva existe para o mês em que a renda falta, e nesse
 * mês você corta delivery e assinatura — não o aluguel nem o remédio. Usar
 * todo o fluxo de saída dobraria o alvo (R$ 45.995 em vez de R$ 23.598) e
 * manteria o pilar Fôlego em zero por anos, o que não informa nada.
 *
 * As prestações também ficam de fora, mas por outro motivo: numa perda de
 * renda elas são renegociáveis, e guardar seis meses de parcela para pagar em
 * dia uma dívida que se pode suspender é otimizar o número errado.
 */
export function gastoEssencial(despesas: DespesaDivisivel[]): number {
  let t = 0
  for (const d of despesas) if (fatiaDe(d) === 'necessidades') t += Number(d.valor) || 0
  return cent(t)
}

export const ALVO_CLASSICO = { necessidades: 50, desejos: 30, poupanca: 20 }

export { cent }
