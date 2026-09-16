/**
 * VerdeMais — identidade do gasto
 * ============================================================================
 * Medido nesta base em 14/09/2026: 834 despesas, 659 descrições distintas,
 * 48 categorias, 22 conflitos. "Gasolina" aparece em Transporte, Outros E
 * Alimentação ao mesmo tempo — 11 lançamentos, R$ 1.469,99. "MP
 * CAIXAECONOMICAFEDERAL", 63 lançamentos e R$ 9.162,83, está partido entre
 * Financiamentos e Moradia.
 *
 * Nenhum relatório por categoria pode estar certo assim. E não é um problema
 * de disciplina do usuário: é que o sistema nunca soube que dois lançamentos
 * são a mesma coisa. Um lançamento tem descrição (texto livre, 659 variantes),
 * categoria (em quê) e tag (para quê). Falta a camada do meio — QUEM é esse
 * gasto. O posto onde você abastece é uma identidade; "Gasolina", "Posto
 * Shell" e "SHELL BOX" são três nomes dela.
 *
 * ── A REGRA QUE GOVERNA ESTE ARQUIVO ────────────────────────────────────────
 *
 * As camadas de agrupamento vão da mais segura para a mais arriscada, e SÓ AS
 * DUAS PRIMEIRAS APLICAM SOZINHAS:
 *
 *   1. NORMALIZAR      — tirar caixa, acento, sufixo "(3/18)" e número solto.
 *                        É reversível e não inventa nada. Aplica sozinha.
 *   2. VÍNCULO         — se a despesa nasceu de um empréstimo, financiamento
 *                        ou recorrência, ela já tem carimbo do próprio sistema.
 *                        Isso é fato, não palpite. Aplica sozinha.
 *   3. PREFIXO + VALOR — "PGCONTA VICTOR" e "PGCONTA VICTOR ANUAL" são
 *                        propostos como parecidos. Só propostos.
 *   4. SEMELHANÇA      — distância de edição. É aqui que mora o falso
 *                        positivo. Nunca aplica sozinha, nunca.
 *
 * O motivo de tanto cuidado não é teórico: há poucos dias, nesta mesma base,
 * uma rotina de reparo quase empurrou 69 faturas corretas para o mês errado.
 */

const cent = (v: number) => Math.round((Number(v) || 0) * 100) / 100

// ─── Camada 1 · Normalização ─────────────────────────────────────────────────

/** Acento fora, caixa alta. Tudo depois disto opera sobre ASCII maiúsculo. */
function semAcento(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

/**
 * Marcadores de parcela, em todas as formas que aparecem na base:
 * "(3/18)", "3/18", "- 3/18", "PARC 3/18", "PARCELA 3 DE 18", "[3/18]".
 * Some primeiro que os números soltos — senão "3/18" vira "3 18" e cada
 * parcela ganha uma identidade própria, que é o oposto do objetivo.
 */
const PARCELA = [
  /[\(\[]\s*\d{1,3}\s*[\/\-de ]{1,4}\s*\d{1,3}\s*[\)\]]/gi,
  /\bPARCELAS?\s*\d{1,3}\s*(?:\/|\bDE\b)\s*\d{1,3}\b/gi,
  /\bPARC\.?\s*\d{1,3}\s*\/\s*\d{1,3}\b/gi,
  /(?:^|\s)[-–]?\s*\d{1,3}\s*\/\s*\d{1,3}(?=\s|$)/g,
]

/**
 * Ruído que o banco e a maquininha põem na frente do nome real. Só prefixos
 * de PALAVRA INTEIRA: "PGCONTA VICTOR" continua "PGCONTA VICTOR", porque
 * "PGCONTA" pode ser o nome que a pessoa usa. Cortar dentro da palavra é como
 * se perdem identidades legítimas.
 */
const RUIDO_PREFIXO = /^(?:MP|PG|PGTO|PAGTO|PAGAMENTO|COMPRA|COMPRAS|DEB|DEBITO|CRED|CREDITO|TED|DOC|PIX|TRANSF|TRANSFERENCIA|CARTAO|CT|REC)\s+/

/**
 * Normaliza uma descrição até a chave de identidade.
 *
 * Só isto — sem nenhum palpite — levou 659 descrições distintas para 222
 * identidades nesta base. É a camada que mais entrega e a que menos arrisca.
 */
export function normalizarDescricao(desc: string): string {
  let s = semAcento(String(desc || '')).toUpperCase()

  for (const re of PARCELA) s = s.replace(re, ' ')

  // "IFOOD *IFOOD" e "UBER* UBER": a maquininha repete o nome com asterisco.
  s = s.replace(/\*/g, ' ')

  // Pontuação vira espaço. Mantém letras, dígitos e o espaço.
  s = s.replace(/[^A-Z0-9]+/g, ' ').trim()

  // Prefixo de ruído, no máximo dois (ex.: "PG COMPRA PADARIA").
  for (let i = 0; i < 2; i++) {
    const antes = s
    s = s.replace(RUIDO_PREFIXO, '')
    if (s === antes) break
  }

  // Número solto: data, sequencial, nº de documento. Preserva número COLADO
  // em letra ("SHELL24H", "POSTO7"), que costuma ser parte do nome.
  s = s.replace(/(?:^|\s)\d{1,8}(?=\s|$)/g, ' ')

  // Palavra repetida em sequência, efeito do asterisco da maquininha.
  const partes = s.split(/\s+/).filter(Boolean)
  const limpo: string[] = []
  for (const p of partes) if (limpo[limpo.length - 1] !== p) limpo.push(p)

  return limpo.join(' ').trim()
}

/**
 * Rótulo da identidade.
 *
 * A descrição original REPETIDA é o melhor rótulo que existe: tem os acentos e
 * a caixa que a pessoa escreveu. Mas quando nenhuma se repete — o caso das 18
 * parcelas de "Manutenção Vectra (1/18)" a "(18/18)" — escolher uma delas
 * batizaria a identidade com o número de uma parcela qualquer. Aí é melhor
 * reconstruir da chave: "Manutencao Vectra", sem parcela nenhuma.
 */
export function rotuloDe(chave: string, exemplos: string[] = []): string {
  const cont = new Map<string, number>()
  for (const e of exemplos) {
    const t = String(e || '').trim()
    if (t) cont.set(t, (cont.get(t) || 0) + 1)
  }
  if (cont.size) {
    const [texto, vezes] = [...cont.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].length - b[0].length)[0]
    // Repetiu, ou é o único texto que existe: serve.
    if (vezes > 1 || cont.size === 1) return texto
  }
  // Chave de vínculo ("@emprestimo:3") não é nome de nada. Reconstrói do texto
  // mais comum, já normalizado: "Parcela 3 do empréstimo" e "Parcela 4 do
  // empréstimo" viram "Parcela Do Emprestimo", que pelo menos é legível.
  const base = chave.startsWith('@')
    ? (cont.size ? normalizarDescricao([...cont.keys()][0]) : chave.slice(1).replace(':', ' '))
    : chave
  const titulo = (base || chave).toLowerCase().replace(/\b\w/g, m => m.toUpperCase())
  return titulo.trim() || chave
}

// ─── Camada 2 · Vínculo do sistema ───────────────────────────────────────────

/**
 * Carimbos que o próprio VerdeMais põe na despesa quando ela nasce de um
 * contrato. Achar a parcela por AQUI, e nunca pelo nome da categoria, é a
 * mesma regra que metricas.ts já segue — filtrar por categoria "Financiamento"
 * pegava "PgConta VICTOR" e uma cobrança avulsa da Caixa, R$ 1.623,75 de
 * prestação que não existe.
 */
const CARIMBOS: Array<{ re: RegExp; tipo: 'emprestimo' | 'financiamento' | 'recorrencia' }> = [
  { re: /Empr[ée]stimo autom[áa]tico\s*#(\d+)/i, tipo: 'emprestimo' },
  { re: /Financiamento autom[áa]tico\s*#(\d+)/i, tipo: 'financiamento' },
  { re: /Recorr[êe]ncia autom[áa]tica\s*#(\d+)/i, tipo: 'recorrencia' },
]

export interface Vinculo { tipo: string; ref: number }

/**
 * Lê o carimbo de contrato de uma despesa. `recorrencia_id` preenchido é o
 * vínculo mais forte que existe: não é heurística, é chave estrangeira.
 */
export function vinculoDe(d: { observacoes?: string | null; recorrencia_id?: number | null }): Vinculo | null {
  if (d.recorrencia_id) return { tipo: 'recorrencia', ref: Number(d.recorrencia_id) }
  const obs = String(d.observacoes || '')
  for (const c of CARIMBOS) {
    const m = obs.match(c.re)
    if (m) return { tipo: c.tipo, ref: Number(m[1]) }
  }
  return null
}

/** A chave de agrupamento final: vínculo manda; sem vínculo, a descrição. */
export function chaveIdentidade(d: {
  descricao?: string | null
  observacoes?: string | null
  recorrencia_id?: number | null
}): string {
  const v = vinculoDe(d)
  if (v) return `@${v.tipo}:${v.ref}`
  return normalizarDescricao(d.descricao || '')
}

// ─── Camadas 3 e 4 · o que só PROPÕE ─────────────────────────────────────────

/**
 * Distância de edição com corte: para de contar assim que passa do teto.
 * Sem o corte, comparar 222 identidades duas a duas é trabalho jogado fora em
 * 99% dos pares, que nem de longe se parecem.
 */
export function distancia(a: string, b: string, teto = 4): number {
  if (a === b) return 0
  if (Math.abs(a.length - b.length) > teto) return teto + 1
  const m = a.length, n = b.length
  let anterior = Array.from({ length: n + 1 }, (_, j) => j)
  let atual = new Array(n + 1).fill(0)
  for (let i = 1; i <= m; i++) {
    atual[0] = i
    let melhorDaLinha = atual[0]
    for (let j = 1; j <= n; j++) {
      const custo = a[i - 1] === b[j - 1] ? 0 : 1
      atual[j] = Math.min(atual[j - 1] + 1, anterior[j] + 1, anterior[j - 1] + custo)
      if (atual[j] < melhorDaLinha) melhorDaLinha = atual[j]
    }
    if (melhorDaLinha > teto) return teto + 1
    ;[anterior, atual] = [atual, anterior]
  }
  return anterior[n]
}

/**
 * `curta` é o começo inteiro de `longa`, em palavras? "PGCONTA VICTOR" é o
 * começo de "PGCONTA VICTOR ANUAL"; "CONTA DE AGUA" não é o começo de
 * "CONTA DE LUZ".
 *
 * Exigir contenção, e não apenas duas palavras iguais no início, é o que
 * derruba o falso positivo óbvio: água e luz dividem "CONTA DE" e custam mais
 * ou menos o mesmo, e são coisas diferentes. Uma proposta errada dessas na
 * fila ensina o usuário a clicar em "não" sem ler — e aí a fila inteira morre.
 */
function ehExtensao(curta: string, longa: string): boolean {
  const a = curta.split(' ').filter(Boolean)
  const b = longa.split(' ').filter(Boolean)
  if (a.length >= b.length) return false
  // Corpo mínimo: uma palavra de 8+ letras, ou duas palavras quaisquer.
  if (a.length < 2 && curta.length < 8) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

export interface Parecidas {
  chaves: string[]
  motivo: 'prefixo' | 'texto'
  /** Quanto se parecem, 0 a 1 — só para ordenar a fila, nunca para decidir. */
  forca: number
}

/**
 * Propõe pares de identidades que PODEM ser a mesma coisa. Nada aqui aplica
 * nada: o retorno vai para a fila de decisões e morre lá se o usuário não
 * concordar.
 */
export function proporParecidas(
  ids: Array<{ chave: string; valor_tipico: number; lancamentos: number }>,
): Parecidas[] {
  const fora: Parecidas[] = []
  const vistos = new Set<string>()

  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const a = ids[i], b = ids[j]
      if (a.chave.startsWith('@') || b.chave.startsWith('@')) continue  // vínculo é fato, não se propõe
      const par = [a.chave, b.chave].sort().join('||')
      if (vistos.has(par)) continue

      // Camada 3 — uma é a extensão da outra E o valor típico está na mesma
      // ordem de grandeza. As duas condições juntas, nunca uma só.
      const [curta, longa] = a.chave.length <= b.chave.length
        ? [a.chave, b.chave] : [b.chave, a.chave]
      const temPrefixo = ehExtensao(curta, longa)
      const maior = Math.max(a.valor_tipico, b.valor_tipico)
      const menor = Math.min(a.valor_tipico, b.valor_tipico)
      const valorParecido = maior > 0 && menor / maior >= 0.6

      if (temPrefixo && valorParecido) {
        vistos.add(par)
        fora.push({ chaves: [a.chave, b.chave], motivo: 'prefixo', forca: 0.7 })
        continue
      }

      // Camada 4 — distância de edição relativa ao tamanho. Exige nomes com
      // algum corpo: em texto curto, duas letras de diferença já são outra
      // palavra ("UBER" e "IBER" distam 1 e não têm nada a ver).
      const menorLen = Math.min(a.chave.length, b.chave.length)
      if (menorLen < 8) continue
      const teto = menorLen <= 12 ? 2 : 3
      const d = distancia(a.chave, b.chave, teto)
      if (d <= teto) {
        vistos.add(par)
        fora.push({ chaves: [a.chave, b.chave], motivo: 'texto', forca: 1 - d / (menorLen || 1) })
      }
    }
  }

  return fora.sort((x, y) => y.forca - x.forca)
}

// ─── Vocabulário: as ~20 categorias ──────────────────────────────────────────

/**
 * A lista enxuta que a Central oferece. Ela é uma PROPOSTA, e é assim que a
 * tela a apresenta: quem decide é o dono da conta, porque categoria é o
 * vocabulário da pessoa, não um esquema que o app impõe. O valor de propor
 * está em 48 nomes com duplicata óbvia — Saúde e Saúde/Farmácia, Educação e
 * Educação Online e Pós-Graduação, Software e mais quatro Software/algo.
 */
export const VOCABULARIO: string[] = [
  'Moradia', 'Mercado', 'Alimentação', 'Transporte', 'Combustível',
  'Saúde', 'Educação', 'Lazer', 'Viagem', 'Vestuário',
  'Cuidados pessoais', 'Pets', 'Assinaturas', 'Software', 'Serviços',
  'Impostos e taxas', 'Financiamentos', 'Empréstimos', 'Presentes e doações', 'Outros',
]

/**
 * Sinônimos observados nesta base e os óbvios do domínio. O valor é a
 * categoria da lista enxuta.
 *
 * As chaves são escritas em português corrente — inclusive no plural, que é
 * como as pessoas nomeiam categoria. Elas NÃO estão na forma que a busca usa:
 * `categoriaCanonica` procura por `raizCategoria(texto)`, que singulariza. Por
 * isso o mapa é reindexado logo abaixo, e não escrito já normalizado à mão:
 * escrever `'roupa'` aqui obrigaria quem edita esta lista a conhecer o
 * normalizador de cor, e foi exatamente esse acoplamento que deixou 18 das 107
 * chaves inalcançáveis até 16/09/2026 — entre elas `roupas`, `impostos`,
 * `seguros`, `taxas`, `onibus` e `contas da casa`.
 */
const SINONIMOS_ESCRITOS: Record<string, string> = {
  // Moradia
  'casa': 'Moradia', 'aluguel': 'Moradia', 'condominio': 'Moradia', 'agua': 'Moradia',
  'luz': 'Moradia', 'energia': 'Moradia', 'gas': 'Moradia', 'internet': 'Moradia',
  'contas da casa': 'Moradia', 'imovel': 'Moradia', 'reforma': 'Moradia',
  // Mercado / Alimentação
  'supermercado': 'Mercado', 'compras do mes': 'Mercado', 'feira': 'Mercado',
  'padaria': 'Alimentação', 'restaurante': 'Alimentação', 'delivery': 'Alimentação',
  'lanche': 'Alimentação', 'comida': 'Alimentação', 'ifood': 'Alimentação',
  // Transporte
  'carro': 'Transporte', 'automotivo': 'Transporte', 'veiculo': 'Transporte',
  'uber': 'Transporte', 'taxi': 'Transporte', 'onibus': 'Transporte',
  'estacionamento': 'Transporte', 'pedagio': 'Transporte', 'ipva': 'Impostos e taxas',
  'mecanica': 'Transporte', 'oficina': 'Transporte', 'manutencao do carro': 'Transporte',
  'gasolina': 'Combustível', 'etanol': 'Combustível', 'alcool': 'Combustível',
  'diesel': 'Combustível', 'posto': 'Combustível', 'abastecimento': 'Combustível',
  // Saúde
  'farmacia': 'Saúde', 'medico': 'Saúde', 'plano de saude': 'Saúde',
  'dentista': 'Saúde', 'remedio': 'Saúde', 'academia': 'Saúde', 'terapia': 'Saúde',
  // Operadora de plano de saúde é o nome que as pessoas dão à categoria, e
  // não reconhecê-la sai caro: o plano é despesa essencial, e cair em "não
  // classificado" encolhe o alvo de reserva em seis vezes o valor dele.
  'unimed': 'Saúde', 'hapvida': 'Saúde', 'amil': 'Saúde', 'sulamerica': 'Saúde',
  'bradesco saude': 'Saúde', 'notredame': 'Saúde', 'intermedica': 'Saúde',
  // Educação
  'curso': 'Educação', 'cursos': 'Educação', 'faculdade': 'Educação',
  'pos graduacao': 'Educação', 'pos': 'Educação', 'escola': 'Educação',
  'livro': 'Educação', 'livros': 'Educação', 'educacao online': 'Educação',
  // Lazer / Viagem
  'entretenimento': 'Lazer', 'diversao': 'Lazer', 'cinema': 'Lazer', 'bar': 'Lazer',
  'hobby': 'Lazer', 'jogos': 'Lazer', 'games': 'Lazer',
  'viagens': 'Viagem', 'hospedagem': 'Viagem', 'passagem': 'Viagem',
  // Vestuário / cuidados
  'roupa': 'Vestuário', 'roupas': 'Vestuário', 'calcado': 'Vestuário',
  'cabeleireiro': 'Cuidados pessoais', 'barbearia': 'Cuidados pessoais',
  'beleza': 'Cuidados pessoais', 'higiene': 'Cuidados pessoais',
  // Pets
  'pet': 'Pets', 'pet shop': 'Pets', 'petshop': 'Pets', 'veterinario': 'Pets', 'animais': 'Pets',
  // Assinaturas / Software
  'assinatura': 'Assinaturas', 'streaming': 'Assinaturas', 'mensalidade': 'Assinaturas',
  'netflix': 'Assinaturas', 'spotify': 'Assinaturas',
  'softwares': 'Software', 'app': 'Software', 'aplicativo': 'Software',
  'ferramenta': 'Software', 'ia': 'Software', 'nuvem': 'Software',
  // Serviços / impostos
  'servico': 'Serviços', 'seguro': 'Serviços', 'seguros': 'Serviços',
  'banco': 'Serviços', 'tarifa': 'Serviços', 'tarifas': 'Serviços',
  'imposto': 'Impostos e taxas', 'impostos': 'Impostos e taxas',
  'taxa': 'Impostos e taxas', 'taxas': 'Impostos e taxas', 'multa': 'Impostos e taxas',
  // Dívida
  'financiamento': 'Financiamentos', 'emprestimo': 'Empréstimos',
  'consorcio': 'Financiamentos', 'cartao': 'Financiamentos',
  // Presentes
  'presente': 'Presentes e doações', 'presentes': 'Presentes e doações',
  'doacao': 'Presentes e doações', 'doacoes': 'Presentes e doações',
  // Resto
  'outro': 'Outros', 'diversos': 'Outros', 'geral': 'Outros', 'sem categoria': 'Outros',
}

/**
 * Raiz de uma categoria: sem acento, sem caixa, sem plural, sem pontuação.
 *
 * O corte de plural só vale em palavra com mais de 3 letras. Sem essa guarda,
 * "Pós-Graduação" virava "po graduacao" — o "s" de "pós" é raiz, não plural —
 * e a categoria deixava de casar com Educação.
 *
 * O plural em -ais/-eis/-ois/-uis vem de -al/-el/-ol/-ul e precisa voltar para
 * lá: cortar só o "s" transformava "pessoais" em "pessoai", e com isso
 * "Cuidados pessoais" — que está na própria lista do VOCABULARIO — não casava
 * nem consigo mesma.
 *
 * Esta é a MESMA função que a Projeção usa para dizer que "Financiamento" e
 * "Financiamentos" são o mesmo assunto. Duas implementações do que conta como
 * "mesmo nome" seria o começo de mais uma divergência entre telas.
 */
export function raizCategoria(nome: string): string {
  return semAcento(String(nome || ''))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .map(p => (p.length > 3 ? singular(p) : p))
    .join(' ')
}

function singular(p: string): string {
  // "animais" → "animal", "papeis" → "papel", "lencois" → "lencol".
  //
  // Exige 5 letras porque em palavra curta o -ais também é plural de -ai:
  // "pais" é o plural de "pai", não de "pal", e "mais" e "seis" não são
  // plural de nada. Acima de quatro letras o -al é a origem esmagadoramente
  // mais provável, e categoria de uma sílaba não existe.
  if (p.length >= 5) {
    const vogais = p.match(/^(.*[aeou])is$/)
    if (vogais) return vogais[1] + 'l'
  }
  return p.replace(/(oes|aes|ns|s)$/, '')
}

/**
 * O mesmo mapa, reindexado pela forma que a busca realmente usa.
 *
 * A grafia original fica também, para o caso de `raizCategoria` um dia deixar
 * de mexer numa chave que hoje ela altera. Colisão — duas grafias que caem na
 * mesma raiz apontando para categorias diferentes — é resolvida pela primeira,
 * e a lista é pequena e ordenada o bastante para isso ser uma decisão e não um
 * acidente.
 */
const SINONIMOS: Record<string, string> = (() => {
  const m: Record<string, string> = {}
  for (const [escrita, categoria] of Object.entries(SINONIMOS_ESCRITOS)) {
    const raiz = raizCategoria(escrita)
    if (raiz && m[raiz] === undefined) m[raiz] = categoria
    if (m[escrita] === undefined) m[escrita] = categoria
  }
  return m
})()

/**
 * A qual das ~20 esta categoria corresponde — ou null, se ela não se parece
 * com nenhuma e deve ficar como está.
 *
 * Ordem: nome idêntico a uma da lista → sinônimo conhecido → prefixo
 * ("Saúde/Farmácia" começa com "Saúde") → nada. O prefixo é o que resolve as
 * cinco variantes de Software desta base sem precisar listar cada uma.
 */
export function categoriaCanonica(nome: string): string | null {
  const bruto = String(nome || '').trim()
  if (!bruto) return 'Outros'

  const r = raizCategoria(bruto)
  if (!r) return 'Outros'

  for (const v of VOCABULARIO) if (raizCategoria(v) === r) return v

  const direto = SINONIMOS[r]
  if (direto) return direto

  // "Saúde/Farmácia", "Software/IA", "Educação Online": o primeiro pedaço
  // antes da barra, do hífen ou do espaço já diz a que família pertence.
  const cabeca = bruto.split(/[\/|\-–·]/)[0].trim()
  if (cabeca && cabeca !== bruto) {
    const c = categoriaCanonica(cabeca)
    if (c) return c
  }
  const primeira = r.split(' ')[0]
  if (primeira && primeira !== r) {
    for (const v of VOCABULARIO) if (raizCategoria(v) === primeira) return v
    const s = SINONIMOS[primeira]
    if (s) return s
  }

  return null
}

// ─── Tipos da fila de decisões ───────────────────────────────────────────────

export type TipoDecisao = 'conflito' | 'duplicata' | 'vocabulario' | 'sem_dono' | 'parecidas'

export interface Opcao {
  valor: string
  lancamentos: number
  sugerida?: boolean
  nota?: string
}

export interface Decisao {
  id: string
  tipo: TipoDecisao
  titulo: string
  subtitulo: string
  pergunta: string
  selo: string | null
  /** Quanto dinheiro esta decisão destrava — é por aqui que a fila é ordenada. */
  valor: number
  lancamentos: number
  opcoes: Opcao[]
  /** O que o POST /aplicar precisa receber de volta, intacto. */
  alvo: Record<string, unknown>
}

export { cent }
