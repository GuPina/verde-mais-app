/**
 * VerdeMais — a fila de decisões da Central de Organização
 * ============================================================================
 * A Central de hoje mostra uma lista de categorias e espera que o usuário
 * descubra sozinho o que juntar. É trabalho de auditoria disfarçado de tela.
 *
 * Aqui ela vira o contrário: o sistema faz a auditoria, ordena o resultado por
 * QUANTO DINHEIRO cada decisão destrava, e pergunta uma coisa por vez. Cada
 * resposta arruma tudo de uma vez — inclusive o que vier depois, porque a
 * decisão fica gravada na identidade.
 *
 * Este arquivo é PURO de propósito: entra uma lista de despesas, sai a fila.
 * Sem banco, sem Hono, sem `await`. É o que permite testar contra 834 linhas
 * de verdade sem subir nada — e a rota acima fica com três linhas de lógica.
 *
 * A ordem da fila não é estética. Resolver "MP CAIXAECONOMICAFEDERAL"
 * (63 lançamentos, R$ 9.162,83, partido entre duas categorias) vale mais que
 * resolver uma categoria com dois lançamentos de R$ 12 — e quem abre a tela
 * tem cinco minutos, não uma tarde.
 */

import {
  normalizarDescricao, chaveIdentidade, vinculoDe, rotuloDe,
  raizCategoria, categoriaCanonica, proporParecidas,
  VOCABULARIO, type Decisao, type Opcao,
} from './identidade'

const cent = (v: number) => Math.round((Number(v) || 0) * 100) / 100

export interface DespesaCrua {
  id: number
  descricao: string | null
  categoria: string | null
  valor: number
  data: string | null
  status?: string | null
  observacoes?: string | null
  recorrencia_id?: number | null
}

export interface Identidade {
  chave: string
  nome: string
  lancamentos: number
  total: number
  valor_tipico: number
  primeira: string | null
  ultima: string | null
  /** Categoria → quantos lançamentos dela estão nessa categoria. */
  categorias: Map<string, number>
  ids: number[]
  vinculo: string | null
}

/** Mesma regra do VAZIO de divisao.ts: comparado contra a raiz, montado da grafia. */
const SEM_DONO = new Set(
  ['Outros', 'Outro', 'Sem categoria', 'Diversos', 'Diverso', 'Geral', '']
    .map(n => raizCategoria(n))
)

function mediana(a: number[]): number {
  if (!a.length) return 0
  const o = [...a].sort((x, y) => x - y)
  const m = Math.floor(o.length / 2)
  return o.length % 2 ? o[m] : (o[m - 1] + o[m]) / 2
}

/**
 * Agrupa as despesas em identidades — as "coisas de verdade".
 *
 * 834 lançamentos, 659 descrições distintas, 222 identidades. A diferença
 * entre 659 e 222 é só normalização: nenhum palpite entrou aqui.
 */
export function agruparIdentidades(despesas: DespesaCrua[]): Identidade[] {
  const mapa = new Map<string, Identidade & { _valores: number[]; _textos: string[] }>()

  for (const d of despesas) {
    const chave = chaveIdentidade(d)
    if (!chave) continue
    let g = mapa.get(chave)
    if (!g) {
      g = {
        chave, nome: '', lancamentos: 0, total: 0, valor_tipico: 0,
        primeira: null, ultima: null, categorias: new Map(), ids: [],
        vinculo: vinculoDe(d)?.tipo ?? null,
        _valores: [], _textos: [],
      }
      mapa.set(chave, g)
    }
    const v = Number(d.valor) || 0
    g.lancamentos++
    g.total = cent(g.total + v)
    g._valores.push(v)
    if (d.descricao) g._textos.push(String(d.descricao).trim())
    const cat = String(d.categoria || '').trim() || 'Sem categoria'
    g.categorias.set(cat, (g.categorias.get(cat) || 0) + 1)
    g.ids.push(d.id)
    const dt = d.data || null
    if (dt) {
      if (!g.primeira || dt < g.primeira) g.primeira = dt
      if (!g.ultima || dt > g.ultima) g.ultima = dt
    }
  }

  const fora: Identidade[] = []
  for (const g of mapa.values()) {
    g.valor_tipico = cent(mediana(g._valores))
    g.nome = rotuloDe(g.chave, g._textos)
    const { _valores, _textos, ...limpo } = g as any
    fora.push(limpo)
  }
  return fora.sort((a, b) => b.total - a.total)
}

// ─── Construção da fila ──────────────────────────────────────────────────────

const fmt = (v: number) => 'R$ ' + (Number(v) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const lanc = (n: number) => `${n} ${n === 1 ? 'lançamento' : 'lançamentos'}`

/** "2025-03-14" → "mar/2025". Data crua na tela não diz nada a ninguém. */
const MES3 = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
function mesAno(d: string | null): string {
  if (!d) return ''
  const m = String(d).match(/^(\d{4})-(\d{2})/)
  return m ? `${MES3[Number(m[2]) - 1]}/${m[1]}` : ''
}

export interface FilaOpcoes {
  /** Ids de decisão que o usuário adiou ou recusou — não voltam para a fila. */
  dispensadas?: Set<string>
  /** Teto de decisões devolvidas. A fila existe para ter fim. */
  limite?: number
  /**
   * Pula a camada 4 (distância de edição). O aviso no contexto roda a cada
   * carga da tela de Despesas e só exibe conflito e duplicata — comparar 120
   * identidades duas a duas ali é trabalho que ninguém vai ler.
   */
  sem_parecidas?: boolean
}

export interface Fila {
  decisoes: Decisao[]
  /** Números do topo da tela — o tamanho do problema, em uma linha. */
  resumo: {
    despesas: number
    descricoes: number
    identidades: number
    categorias: number
    conflitos: number
    sem_dono: number
    pendentes: number
    lancamentos_afetados: number
    valor_afetado: number
  }
}

export function montarFila(despesas: DespesaCrua[], opcoes: FilaOpcoes = {}): Fila {
  const dispensadas = opcoes.dispensadas || new Set<string>()
  const ids = agruparIdentidades(despesas)
  const decisoes: Decisao[] = []

  // Quanto vale cada nome de categoria hoje — usado em quase toda decisão.
  const porCategoria = new Map<string, { n: number; total: number }>()
  for (const d of despesas) {
    const cat = String(d.categoria || '').trim() || 'Sem categoria'
    const a = porCategoria.get(cat) || { n: 0, total: 0 }
    a.n++; a.total = cent(a.total + (Number(d.valor) || 0))
    porCategoria.set(cat, a)
  }

  // ── 1 · CONFLITO ──────────────────────────────────────────────────────────
  // A mesma coisa em duas gavetas. É a decisão mais valiosa da fila porque é
  // a única em que o número de HOJE já está errado: some do relatório de uma
  // categoria e aparece na outra, e a soma das duas não bate com nada.
  let conflitos = 0
  for (const g of ids) {
    if (g.categorias.size < 2) continue
    conflitos++

    const opts = [...g.categorias.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([valor, n]): Opcao => ({ valor, lancamentos: n }))

    // A sugerida: a canônica da mais frequente, se ela estiver entre as
    // opções; senão a mais frequente mesmo. Nunca uma categoria que o usuário
    // não usa — sugestão que inventa nome é sugestão que ninguém aceita.
    const canon = categoriaCanonica(opts[0].valor)
    const alvo = canon && opts.some(o => o.valor === canon) ? canon : opts[0].valor
    for (const o of opts) if (o.valor === alvo) o.sugerida = true

    // Um único lançamento fora de um grupo grande é a forma mais confiável de
    // apontar um engano — e a única que eu aceito escrever na tela.
    //
    // A versão anterior chamava de "engano de digitação" qualquer opção
    // minoritária, e dizia que o Seguro Auto em "Transporte" era erro. Não é:
    // seguro de carro em Transporte é uma leitura perfeitamente defensável.
    // Chamar de erro a escolha razoável do usuário é como a fila perde
    // autoridade — depois disso ele não acredita mais em nenhum aviso.
    const solitaria = g.lancamentos >= 5 ? opts.find(o => o.lancamentos === 1) : undefined

    const id = `conflito:${g.chave}`
    if (dispensadas.has(id)) continue
    decisoes.push({
      id, tipo: 'conflito',
      titulo: g.nome,
      subtitulo: `${lanc(g.lancamentos)} · ${fmt(g.total)}${g.primeira ? ` · desde ${mesAno(g.primeira)}` : ''}`,
      selo: `${g.categorias.size} categorias`,
      pergunta: `Estes ${g.lancamentos} lançamentos são a mesma cobrança, mas estão em ${g.categorias.size === 2 ? 'duas gavetas' : `${g.categorias.size} gavetas`}: ` +
        opts.map(o => `**${o.lancamentos} em ${o.valor}**`).join(', ') + '. Qual é a certa?' +
        (solitaria ? ` Só 1 dos ${g.lancamentos} está em "${solitaria.valor}" — se não foi de propósito, escolher aqui arruma junto.` : ''),
      valor: g.total,
      lancamentos: g.lancamentos,
      opcoes: opts,
      alvo: { chave: g.chave, nome: g.nome, ids: g.ids },
    })
  }

  /** Quais lançamentos estão nestes nomes de categoria. */
  const idsDasCategorias = (nomes: string[]): number[] => {
    const alvo = new Set(nomes)
    return despesas
      .filter(d => alvo.has(String(d.categoria || '').trim() || 'Sem categoria'))
      .map(d => d.id)
  }

  // ── 2 · DUPLICATA DE NOME ─────────────────────────────────────────────────
  // "Financiamento" e "Financiamentos". Mesmo assunto, dois nomes, e portanto
  // todo ranking por categoria está partido ao meio.
  const porRaiz = new Map<string, string[]>()
  for (const nome of porCategoria.keys()) {
    const r = raizCategoria(nome)
    if (!r) continue
    if (!porRaiz.has(r)) porRaiz.set(r, [])
    porRaiz.get(r)!.push(nome)
  }
  for (const [, nomes] of porRaiz) {
    if (nomes.length < 2) continue
    const info = nomes.map(n => ({ nome: n, ...(porCategoria.get(n) || { n: 0, total: 0 }) }))
      .sort((a, b) => b.total - a.total)
    const total = cent(info.reduce((s, x) => s + x.total, 0))
    const n = info.reduce((s, x) => s + x.n, 0)
    const id = `duplicata:${nomes.slice().sort().join('|')}`
    if (dispensadas.has(id)) continue
    decisoes.push({
      id, tipo: 'duplicata',
      titulo: info.map(x => x.nome).join(' · '),
      subtitulo: `${nomes.length} nomes · ${lanc(n)} · ${fmt(total)}`,
      selo: 'juntar?',
      pergunta: `${info.map(x => `**${x.nome}**`).join(' e ')} são o mesmo assunto escrito de ` +
        `${nomes.length === 2 ? 'dois jeitos' : `${nomes.length} jeitos`}. Enquanto forem ` +
        `${nomes.length} categorias, esse gasto aparece partido — ` +
        `${info.map(x => fmt(x.total)).join(' de um lado, ')} do outro, quando na verdade é ${fmt(total)}. ` +
        `Você não perde detalhe: a identidade de cada lançamento continua separada.`,
      valor: total,
      lancamentos: n,
      opcoes: info.map((x, i): Opcao => ({
        valor: x.nome, lancamentos: x.n, sugerida: i === 0,
        nota: i === 0 ? 'o nome mais usado' : undefined,
      })),
      alvo: { nomes, ids: idsDasCategorias(nomes) },
    })
  }

  // ── 3 · SEM DONO ──────────────────────────────────────────────────────────
  // "Outros" é onde o dinheiro some do relatório. Uma decisão por identidade,
  // com palpite quando dá — e sem palpite quando não dá, o que é metade dos
  // casos e precisa ser dito assim.
  let semDonoLanc = 0
  for (const g of ids) {
    if (g.categorias.size !== 1) continue           // conflito já cobriu
    const unica = [...g.categorias.keys()][0]
    if (!SEM_DONO.has(raizCategoria(unica))) continue
    semDonoLanc += g.lancamentos

    // O palpite sai do NOME da coisa, não da categoria que ela não tem.
    const palpite = categoriaCanonica(normalizarDescricao(g.nome).toLowerCase())
    const usadas = [...porCategoria.entries()]
      .filter(([nome]) => !SEM_DONO.has(raizCategoria(nome)))
      .sort((a, b) => b[1].total - a[1].total)
      .slice(0, 4)
      .map(([nome, v]): Opcao => ({ valor: nome, lancamentos: v.n }))

    const opts: Opcao[] = []
    if (palpite && palpite !== 'Outros') {
      opts.push({ valor: palpite, lancamentos: 0, sugerida: true, nota: 'palpite do sistema' })
    }
    for (const u of usadas) if (!opts.some(o => o.valor === u.valor)) opts.push(u)

    const id = `sem_dono:${g.chave}`
    if (dispensadas.has(id)) continue
    decisoes.push({
      id, tipo: 'sem_dono',
      titulo: g.nome,
      subtitulo: `${lanc(g.lancamentos)} · ${fmt(g.total)} · hoje em "${unica}"`,
      selo: 'sem dono',
      pergunta: palpite && palpite !== 'Outros'
        ? `Pelo nome, isto parece **${palpite}**. Enquanto ficar em "${unica}", esse dinheiro não ` +
          `aparece em nenhum relatório por categoria.`
        : `O sistema não tem palpite para isto — o nome não parece com nada que ele conheça. ` +
          `Enquanto ficar em "${unica}", esse dinheiro some do relatório.`,
      valor: g.total,
      lancamentos: g.lancamentos,
      opcoes: opts,
      alvo: { chave: g.chave, nome: g.nome, ids: g.ids },
    })
  }

  // ── 4 · VOCABULÁRIO ───────────────────────────────────────────────────────
  // Uma decisão só, em lote: as categorias que têm equivalente na lista enxuta.
  // Fica por último de propósito — é a mais invasiva e a menos urgente, e o
  // usuário deve chegar nela depois de ver que as outras três funcionaram.
  const pares: Array<{ de: string; para: string; n: number; total: number }> = []
  for (const [nome, v] of porCategoria) {
    const canon = categoriaCanonica(nome)
    if (!canon || canon === nome) continue
    if (raizCategoria(canon) === raizCategoria(nome)) continue   // já é duplicata
    pares.push({ de: nome, para: canon, n: v.n, total: v.total })
  }
  if (pares.length >= 2 && !dispensadas.has('vocabulario')) {
    pares.sort((a, b) => b.total - a.total)
    const total = cent(pares.reduce((s, p) => s + p.total, 0))
    const n = pares.reduce((s, p) => s + p.n, 0)
    const destino = new Set(pares.map(p => p.para)).size
    decisoes.push({
      id: 'vocabulario', tipo: 'vocabulario',
      titulo: `${pares.length} categorias com equivalente na lista enxuta`,
      subtitulo: `${porCategoria.size} nomes em uso · ${lanc(n)} · ${fmt(total)}`,
      selo: `${porCategoria.size} → ~${VOCABULARIO.length}`,
      pergunta: `${pares.length} das suas ${porCategoria.size} categorias cabem em ${destino} nomes ` +
        `de uma lista enxuta — ${pares.slice(0, 3).map(p => `**${p.de}** vira ${p.para}`).join(', ')}` +
        `${pares.length > 3 ? `, e mais ${pares.length - 3}` : ''}. ` +
        `Isto é uma proposta, não uma regra: categoria é o seu vocabulário. ` +
        `Dá para aceitar tudo, escolher uma a uma, ou ignorar.`,
      valor: total,
      lancamentos: n,
      opcoes: [],
      alvo: { pares, ids: idsDasCategorias(pares.map(p => p.de)) },
    })
  }

  // ── 5 · PARECIDAS ─────────────────────────────────────────────────────────
  // Camada 4: a que erra. Entra na fila com o menor peso possível e com a
  // dúvida escrita na pergunta — se o usuário tiver que pensar, que pense
  // sabendo que o sistema também não tem certeza.
  const candidatas = opcoes.sem_parecidas ? [] : ids
    .filter(g => !g.chave.startsWith('@') && g.lancamentos >= 1)
    .slice(0, 120)                       // 120² / 2 = 7.140 comparações, instantâneo
    .map(g => ({ chave: g.chave, valor_tipico: g.valor_tipico, lancamentos: g.lancamentos }))
  const porChave = new Map(ids.map(g => [g.chave, g]))

  for (const p of proporParecidas(candidatas).slice(0, 8)) {
    const [a, b] = p.chaves.map(k => porChave.get(k)!).filter(Boolean)
    if (!a || !b) continue
    const id = `parecidas:${p.chaves.slice().sort().join('|')}`
    if (dispensadas.has(id)) continue
    const total = cent(a.total + b.total)
    decisoes.push({
      id, tipo: 'parecidas',
      titulo: `${a.nome} · ${b.nome}`,
      subtitulo: `${lanc(a.lancamentos + b.lancamentos)} · ${fmt(total)}`,
      selo: p.motivo === 'prefixo' ? 'um é extensão do outro' : 'nomes parecidos',
      pergunta: p.motivo === 'prefixo'
        ? `**${a.nome}** e **${b.nome}**: um nome é o começo do outro e o valor típico é parecido ` +
          `(${fmt(a.valor_tipico)} e ${fmt(b.valor_tipico)}). Pode ser a mesma coisa com um sufixo, ` +
          `ou duas coisas de verdade — o sistema não sabe dizer.`
        : `**${a.nome}** e **${b.nome}** diferem por poucas letras. Costuma ser erro de digitação, ` +
          `mas esta é a única detecção aqui que erra com frequência: confira antes de juntar.`,
      // Peso deliberadamente baixo: uma proposta incerta nunca deve empurrar
      // um conflito real para o fim da fila.
      valor: cent(total * 0.1),
      lancamentos: a.lancamentos + b.lancamentos,
      opcoes: [
        { valor: a.nome, lancamentos: a.lancamentos, sugerida: a.lancamentos >= b.lancamentos },
        { valor: b.nome, lancamentos: b.lancamentos, sugerida: b.lancamentos > a.lancamentos },
      ],
      alvo: { chaves: p.chaves, motivo: p.motivo, ids: [...a.ids, ...b.ids] },
    })
  }

  // Ordenação em dois níveis, e o primeiro não é o dinheiro.
  //
  // Conflito, duplicata e sem-dono fazem o número de HOJE estar errado: o
  // gasto some de um relatório e aparece em outro, e a soma não bate com nada.
  // Vocabulário e parecidas são arrumação de nome — úteis, não urgentes, e a
  // de vocabulário some com todas as outras se puser só o valor no critério
  // (ela cobre várias categorias de uma vez e ganharia sempre o topo).
  const PESO: Record<string, number> = {
    conflito: 0, duplicata: 0, sem_dono: 0, vocabulario: 1, parecidas: 1,
  }
  decisoes.sort((a, b) => (PESO[a.tipo] - PESO[b.tipo]) || (b.valor - a.valor))
  const limitadas = decisoes.slice(0, opcoes.limite ?? 40)

  // Os afetados contam a fila INTEIRA, não a página: dizer "7 decisões, 168
  // lançamentos" e mostrar 40 seria mentir sobre o tamanho do trabalho.
  //
  // E conta LANÇAMENTO DISTINTO, não a soma das decisões: o mesmo lançamento
  // costuma aparecer em duas (um conflito de identidade E uma duplicata de
  // nome). Somar os valores das decisões dava R$ 32.717 numa base de R$ 24.317
  // — um total maior que a própria conta, que é o tipo de número que faz o
  // usuário parar de confiar na tela inteira.
  const idsAfetados = new Set<number>()
  for (const d of decisoes) {
    const alvoIds = (d.alvo as any)?.ids as number[] | undefined
    if (alvoIds) for (const i of alvoIds) idsAfetados.add(i)
  }
  const valorAfetado = cent(
    despesas.filter(d => idsAfetados.has(d.id)).reduce((s, d) => s + (Number(d.valor) || 0), 0)
  )

  return {
    decisoes: limitadas,
    resumo: {
      despesas: despesas.length,
      descricoes: new Set(despesas.map(d => String(d.descricao || '').trim())).size,
      identidades: ids.length,
      categorias: porCategoria.size,
      conflitos,
      sem_dono: semDonoLanc,
      pendentes: decisoes.length,
      lancamentos_afetados: idsAfetados.size,
      valor_afetado: valorAfetado,
    },
  }
}
