/**
 * VerdeMais — o motor de recorrências
 * ============================================================================
 * Três perguntas, uma definição cada:
 *
 *   1. O que aconteceu com esta recorrência, mês a mês?        linhaDoTempo()
 *   2. Que coisas se repetem e ainda não são recorrência?       rastrear()
 *   3. Este lançamento que acabou de entrar é de qual?          casaRegra()
 *
 * Tudo aqui é função pura sobre linhas que a rota já carregou: o mesmo motor
 * serve a tela de Recorrências, o lançamento de despesa e receita, a
 * importação de CSV e as Assinaturas Fantasma. Antes cada um desses lugares
 * tinha a sua noção de "é a mesma coisa" — as Assinaturas tinham até um
 * normalizador próprio, diferente do da Central de Organização.
 *
 * ── A LINHA DO TEMPO LÊ DO LANÇAMENTO, NÃO DO HISTÓRICO ──────────────────────
 *
 * A tela antiga lia `recorrencias_historico`, uma foto tirada no botão
 * "Lançar" com o valor DAQUELE momento. Reajustar a despesa depois, na tela de
 * Despesas, nunca chegava lá — e o lançamento em lote (`processar-mes`) nem
 * escrevia nela. A verdade é a linha de despesa ou receita com
 * `recorrencia_id`, e é dela que este motor lê.
 *
 * ── A ARMADILHA DO RASTREIO ──────────────────────────────────────────────────
 *
 * Uma compra em 12x no cartão é a recorrência mais perfeita que existe: todo
 * mês, mesmo valor, mesmo texto — `normalizarDescricao` até tira o "(3/12)".
 * Empréstimo, financiamento e as parcelas de um recebimento também. Nada disso
 * é recorrência: é série com dono e com fim. `temDono()` tira essas linhas do
 * rastreio ANTES de qualquer medida, senão a primeira varredura sugeriria
 * dezenas de recorrências falsas.
 */

import { normalizarDescricao, vinculoDe, rotuloDe } from './identidade'

const cent = (v: number) => Math.round((Number(v) || 0) * 100) / 100

export type TipoRec = 'despesa' | 'receita'

export interface Lancamento {
  id: number
  descricao: string | null
  valor: number
  /** Data de competência — para cartão, o vencimento da fatura. */
  data: string
  status?: string | null
  observacoes?: string | null
  recorrencia_id?: number | null
  numero_parcelas?: number | null
  parcelado?: number | boolean | null
  cartao_id?: number | null
  categoria?: string | null
  meio_pagamento?: string | null
  parcela_atual?: number | null
  purchase_group_id?: string | null
  /** Quantas linhas do mesmo `purchase_group_id` vieram na consulta. */
  grupo_n?: number | null
  /** Total de parcelas no card_charge da linha (o "3/10" da fatura). */
  cc_total_parcelas?: number | null
  /** Parte de juros/taxa do valor, quando informada. */
  valor_juros?: number | null
}

export interface Recorrencia {
  id: number
  tipo: TipoRec
  descricao: string
  valor: number
  categoria?: string | null
  dia_vencimento: number
  valor_variavel?: number | boolean | null
  ativa?: number | boolean | null
  data_inicio?: string | null
  data_fim?: string | null
}

export interface Regra {
  /** Texto que a descrição normalizada do lançamento precisa conter. */
  texto: string
  modo: 'contem' | 'comeca' | 'igual'
  /** null = qualquer valor (conta de luz, de água). */
  tol_valor_pct: number | null
  tol_dias: number
  cartao_id?: number | null
  auto_vincular: boolean
  /**
   * Outros nomes da mesma conta. "Juros de obra" que o banco às vezes chama de
   * "Evolução de obra": quando a pessoa confirma um lançamento com outro nome,
   * o nome dele entra aqui e os próximos já casam.
   */
  apelidos?: string[]
}

// ─── Datas ───────────────────────────────────────────────────────────────────

const ymd = (s: string) => String(s || '').slice(0, 10)
const chaveMes = (s: string) => ymd(s).slice(0, 7)
function ultimoDia(ano: number, mes: number) { return new Date(Date.UTC(ano, mes, 0)).getUTCDate() }
function diasEntre(a: string, b: string) {
  return Math.round((Date.parse(ymd(b) + 'T12:00:00Z') - Date.parse(ymd(a) + 'T12:00:00Z')) / 86400000)
}

/**
 * Dia do mês, com "fim de mês" valendo como um dia só.
 *
 * Quem paga "todo dia 30" paga 28 em fevereiro e 31 nunca. Sem isto a
 * dispersão do dia saltaria a cada fevereiro e uma recorrência de fim de mês
 * nunca seria reconhecida.
 */
function diaNormalizado(data: string): number {
  const [a, m, d] = ymd(data).split('-').map(Number)
  if (!a || !m || !d) return 0
  return d >= ultimoDia(a, m) - 1 ? 31 : d
}

/** Distância entre dois dias do mês num círculo de 31 — dia 30 e dia 2 estão perto. */
function distanciaDia(a: number, b: number) {
  const x = Math.abs(a - b)
  return Math.min(x, 31 - x)
}

function mediana(v: number[]) {
  if (!v.length) return 0
  const o = [...v].sort((a, b) => a - b)
  const m = Math.floor(o.length / 2)
  return o.length % 2 ? o[m] : (o[m - 1] + o[m]) / 2
}

// ─── Séries com dono ─────────────────────────────────────────────────────────

const PARCELA_NO_TEXTO = [
  /[\(\[]\s*\d{1,3}\s*\/\s*\d{1,3}\s*[\)\]]/,
  /\bparcelas?\b/i,
  /\bparc\.?\s*\d/i,
]
/** "LOJA 03/12" é parcela; "LUZ 15/11" é data — parcela nunca passa do total. */
const PARCELA_SOLTA = /(?:^|\s)[-–]?\s*(\d{1,3})\s*\/\s*(\d{1,3})(?=\s|$)/

/**
 * A linha pertence a uma série que já tem dono e fim?
 *
 * Parcelamento (cartão ou não), empréstimo, financiamento e parcela de
 * recebimento parcelado. Linha vinculada a uma RECORRÊNCIA não entra aqui:
 * essa é justamente o que o motor quer ver.
 */
export function temDono(l: Lancamento): boolean {
  // O número da parcela nem sempre está no nome: "Entrada Apartamento" pode
  // ser a 3/10. Os campos da despesa, o card_charge e o grupo da compra dizem.
  if (Number(l.numero_parcelas || 1) > 1) return true
  if (Number(l.cc_total_parcelas || 1) > 1) return true
  if (Number(l.grupo_n || 1) > 1) return true
  if (l.parcelado === true || Number(l.parcelado) === 1) return true
  const v = vinculoDe(l)
  if (v && v.tipo !== 'recorrencia') return true
  if (/\[recebimento\s*#\d+/i.test(String(l.observacoes || ''))) return true
  const desc = String(l.descricao || '')
  if (PARCELA_NO_TEXTO.some(re => re.test(desc))) return true
  const m = desc.match(PARCELA_SOLTA)
  return !!m && Number(m[2]) >= 2 && Number(m[1]) >= 1 && Number(m[1]) <= Number(m[2])
}

/**
 * A recorrência a que a linha pertence: a chave estrangeira, ou o carimbo
 * "Recorrência automática #N" que lançamentos antigos levavam só no texto.
 */
export function recorrenciaDe(l: Lancamento): number | null {
  if (l.recorrencia_id) return Number(l.recorrencia_id)
  const v = vinculoDe(l)
  return v && v.tipo === 'recorrencia' ? v.ref : null
}

// ─── Padrão de repetição ─────────────────────────────────────────────────────

export interface Padrao {
  n: number
  meses: number
  primeira: string
  ultima: string
  intervalo_mediano: number
  /** Fração dos intervalos consecutivos que parecem mensais (20 a 40 dias). */
  regularidade: number
  dia_tipico: number
  dispersao_dia: number
  valor_mediano: number
  valor_min: number
  valor_max: number
  /** Coeficiente de variação do valor. */
  cv: number
  valor_variavel: boolean
  dias_desde_ultima: number
}

export const CRITERIO = {
  minimo_ocorrencias: 3,
  minimo_meses: 3,
  intervalo_min: 25,
  intervalo_max: 35,
  regularidade_min: 0.7,
  dispersao_dia_max: 5,
  /** Acima disto o valor é "variável" — ainda é recorrência, só não tem valor fixo. */
  cv_valor_fixo: 0.15,
  dias_para_inativa: 45,
  /** Mais de 1,2 por mês é hábito (Uber, mercado), não conta mensal. */
  por_mes_max: 1.2,
}

export function medirPadrao(linhas: Array<{ data: string; valor: number }>, hoje: string): Padrao | null {
  const ord = linhas
    .filter(l => /^\d{4}-\d{2}-\d{2}/.test(ymd(l.data)))
    .slice().sort((a, b) => ymd(a.data).localeCompare(ymd(b.data)))
  if (!ord.length) return null

  const intervalos: number[] = []
  for (let i = 1; i < ord.length; i++) intervalos.push(diasEntre(ord[i - 1].data, ord[i].data))
  const mensais = intervalos.filter(d => d >= 20 && d <= 40).length

  const dias = ord.map(l => diaNormalizado(l.data))
  // Dia típico: o que minimiza a distância circular aos demais.
  let diaTipico = dias[0], melhor = Infinity
  for (const cand of new Set(dias)) {
    const soma = dias.reduce((s, d) => s + distanciaDia(d, cand), 0)
    if (soma < melhor) { melhor = soma; diaTipico = cand }
  }
  const dispersao = mediana(dias.map(d => distanciaDia(d, diaTipico)))

  const valores = ord.map(l => Math.abs(Number(l.valor) || 0))
  const media = valores.reduce((s, v) => s + v, 0) / valores.length
  const dp = Math.sqrt(valores.reduce((s, v) => s + (v - media) ** 2, 0) / valores.length)
  const cv = media > 0 ? dp / media : 0

  return {
    n: ord.length,
    meses: new Set(ord.map(l => chaveMes(l.data))).size,
    primeira: ymd(ord[0].data),
    ultima: ymd(ord[ord.length - 1].data),
    intervalo_mediano: mediana(intervalos),
    regularidade: intervalos.length ? mensais / intervalos.length : 0,
    dia_tipico: diaTipico,
    dispersao_dia: dispersao,
    valor_mediano: cent(mediana(valores)),
    valor_min: cent(Math.min(...valores)),
    valor_max: cent(Math.max(...valores)),
    cv: Math.round(cv * 1000) / 1000,
    valor_variavel: cv > CRITERIO.cv_valor_fixo,
    dias_desde_ultima: diasEntre(ord[ord.length - 1].data, hoje),
  }
}

/**
 * Este padrão é uma recorrência mensal? Devolve o motivo da recusa, ou null.
 *
 * O motivo existe para o teste e para a tela poderem dizer POR QUE algo não
 * foi sugerido — "não aparece" sem explicação vira desconfiança no rastreio.
 */
export function motivoRecusa(p: Padrao): string | null {
  const C = CRITERIO
  if (p.n < C.minimo_ocorrencias) return `só ${p.n} ocorrência(s)`
  if (p.meses < C.minimo_meses) return `só ${p.meses} mês(es) diferente(s)`
  if (p.n / p.meses > C.por_mes_max) return 'repete mais de uma vez por mês'
  if (p.intervalo_mediano < C.intervalo_min || p.intervalo_mediano > C.intervalo_max)
    return `intervalo típico de ${p.intervalo_mediano} dias`
  if (p.regularidade < C.regularidade_min) return 'ritmo irregular'
  if (p.dispersao_dia > C.dispersao_dia_max) return 'dia do mês muda muito'
  if (p.dias_desde_ultima > C.dias_para_inativa) return `parou há ${p.dias_desde_ultima} dias`
  return null
}

/** 0 a 100: o quanto o padrão se parece com conta mensal de verdade. */
export function confiancaPadrao(p: Padrao): number {
  const C = CRITERIO
  const ritmo = p.regularidade
  const dia = Math.max(0, 1 - p.dispersao_dia / (C.dispersao_dia_max + 1))
  const volume = Math.min(1, p.meses / 6)
  const valor = p.valor_variavel ? 0.6 : Math.max(0.6, 1 - p.cv)
  return Math.round(100 * (0.35 * ritmo + 0.25 * dia + 0.25 * volume + 0.15 * valor))
}

const MESES_TXT = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
const brl = (v: number) => 'R$ ' + Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export function explicarPadrao(p: Padrao): string {
  const dia = p.dia_tipico === 31 ? 'no fim do mês' : `todo dia ${p.dia_tipico}${p.dispersao_dia ? ` ±${Math.ceil(p.dispersao_dia)}` : ''}`
  const valor = p.valor_variavel
    ? `valor entre ${brl(p.valor_min)} e ${brl(p.valor_max)}`
    : p.valor_min === p.valor_max ? `sempre ${brl(p.valor_mediano)}` : `em torno de ${brl(p.valor_mediano)}`
  const [a, m] = p.primeira.split('-').map(Number)
  return `${p.n} lançamentos desde ${MESES_TXT[m - 1]}/${a}, ${dia}, ${valor}`
}

// ─── Regra de match ──────────────────────────────────────────────────────────

/** A regra que vale quando o usuário ainda não escreveu uma. */
export function regraPadrao(r: Recorrencia): Regra {
  return {
    texto: normalizarDescricao(r.descricao),
    modo: 'contem',
    tol_valor_pct: (r.valor_variavel === true || Number(r.valor_variavel) === 1) ? null : 10,
    tol_dias: 5,
    cartao_id: null,
    auto_vincular: true,
    apelidos: [],
  }
}

/** A regra que o rastreio propõe, tirada do que ele observou. */
export function regraSugerida(chave: string, p: Padrao): Regra {
  return {
    texto: chave,
    modo: 'contem',
    tol_valor_pct: p.valor_variavel ? null : Math.max(10, Math.ceil(p.cv * 200)),
    tol_dias: Math.min(7, Math.max(3, Math.ceil(p.dispersao_dia) + 2)),
    cartao_id: null,
    auto_vincular: true,
    apelidos: [],
  }
}

export interface ResultadoMatch {
  texto: boolean
  valor: boolean
  dia: boolean
  cartao: boolean
  /** Tudo bateu: candidato a vínculo automático. */
  total: boolean
}

export function casaRegra(l: Lancamento, r: Recorrencia, regra: Regra): ResultadoMatch {
  const desc = normalizarDescricao(l.descricao || '')
  const casaTexto = (bruto: string) => {
    const alvo = normalizarDescricao(bruto || '')
    return !!alvo && (
      regra.modo === 'igual' ? desc === alvo
      : regra.modo === 'comeca' ? desc.startsWith(alvo)
      : desc.includes(alvo))
  }
  // Apelido é um nome inteiro já confirmado pela pessoa: casa por igualdade
  // ou por contenção, como o texto principal no modo "contém".
  const texto = casaTexto(regra.texto) || (regra.apelidos || []).some(a => {
    const alvo = normalizarDescricao(a || '')
    return !!alvo && (desc === alvo || desc.includes(alvo))
  })

  const base = Math.abs(Number(r.valor) || 0)
  const v = Math.abs(Number(l.valor) || 0)
  const valor = regra.tol_valor_pct == null
    ? true
    : base > 0 && Math.abs(v - base) / base <= regra.tol_valor_pct / 100 + 1e-9

  const diaL = diaNormalizado(l.data)
  const [a, m] = ymd(l.data).split('-').map(Number)
  const diaR = Number(r.dia_vencimento) >= (a && m ? ultimoDia(a, m) - 1 : 30) ? 31 : Number(r.dia_vencimento)
  // No cartão a data gravada é o vencimento da FATURA, não o dia da cobrança:
  // o dia não diz nada sobre ser ou não a mesma conta.
  const dia = l.cartao_id ? true : distanciaDia(diaL, diaR) <= regra.tol_dias

  const cartao = !regra.cartao_id || Number(l.cartao_id) === Number(regra.cartao_id)

  return { texto, valor, dia, cartao, total: texto && valor && dia && cartao }
}

// ─── Rastreio ────────────────────────────────────────────────────────────────

export interface CandidatoNovo {
  chave: string
  tipo: TipoRec
  nome: string
  categoria: string | null
  padrao: Padrao
  confianca: number
  porque: string
  regra: Regra
  ids: number[]
  valor_total: number
}

export interface CandidatoSolto {
  recorrencia_id: number
  recorrencia: string
  lancamento_id: number
  descricao: string
  data: string
  valor: number
  /** Já existe outro lançamento vinculado a esta recorrência no mesmo mês. */
  mes_ocupado: boolean
  criterios: ResultadoMatch
}

export interface Rastreio {
  novas: CandidatoNovo[]
  soltas: CandidatoSolto[]
  /** Quantas linhas saíram do rastreio por serem série com dono. */
  ignoradas_com_dono: number
}

export function rastrear(opcoes: {
  tipo: TipoRec
  lancamentos: Lancamento[]
  recorrencias: Recorrencia[]
  regras?: Map<number, Regra>
  dispensadas?: Set<string>
  hoje: string
}): Rastreio {
  const { tipo, hoje } = opcoes
  const dispensadas = opcoes.dispensadas || new Set<string>()
  const recs = opcoes.recorrencias.filter(r => r.tipo === tipo)
  const regraDe = (r: Recorrencia) => opcoes.regras?.get(r.id) || regraPadrao(r)

  let comDono = 0
  const livres: Lancamento[] = []
  for (const l of opcoes.lancamentos) {
    if (temDono(l)) { comDono++; continue }
    livres.push(l)
  }

  // Meses que cada recorrência já tem preenchidos — para não sugerir vincular
  // uma segunda linha num mês que já tem a sua.
  const ocupado = new Map<number, Set<string>>()
  for (const l of livres) {
    const k = recorrenciaDe(l)
    if (!k) continue
    if (!ocupado.has(k)) ocupado.set(k, new Set())
    ocupado.get(k)!.add(chaveMes(l.data))
  }

  // ── Soltas: linha sem vínculo que bate na regra de uma recorrência ──────────
  const soltas: CandidatoSolto[] = []
  const tomadas = new Set<number>()
  for (const l of livres) {
    if (recorrenciaDe(l)) continue
    const casam = recs
      .map(r => ({ r, m: casaRegra(l, r, regraDe(r)) }))
      // Texto é obrigatório para ser solta; valor e dia podem falhar, e a tela
      // mostra qual falhou — reajuste muda o valor, atraso muda o dia.
      .filter(x => x.m.texto && (x.m.valor || x.m.dia))
    if (casam.length !== 1) continue
    const { r, m } = casam[0]
    if (dispensadas.has(`solta:${r.id}:${l.id}`)) continue
    soltas.push({
      recorrencia_id: r.id, recorrencia: r.descricao,
      lancamento_id: l.id, descricao: String(l.descricao || ''),
      data: ymd(l.data), valor: cent(l.valor),
      mes_ocupado: !!ocupado.get(r.id)?.has(chaveMes(l.data)),
      criterios: m,
    })
    tomadas.add(l.id)
  }

  // ── Novas: grupos que se repetem e não pertencem a recorrência nenhuma ──────
  const grupos = new Map<string, Lancamento[]>()
  for (const l of livres) {
    if (recorrenciaDe(l) || tomadas.has(l.id)) continue
    // Texto de uma recorrência que já existe não vira sugestão de OUTRA: é
    // a mesma conta com valor ou dia fora da regra, e duplicá-la só confunde.
    if (recs.some(r => casaRegra(l, r, regraDe(r)).texto)) continue
    const k = normalizarDescricao(l.descricao || '')
    if (!k) continue
    if (!grupos.has(k)) grupos.set(k, [])
    grupos.get(k)!.push(l)
  }

  const novas: CandidatoNovo[] = []
  for (const [chave, itens] of grupos) {
    if (dispensadas.has(`nova:${tipo}:${chave}`)) continue
    const p = medirPadrao(itens, hoje)
    if (!p || motivoRecusa(p)) continue
    const cats = new Map<string, number>()
    for (const l of itens) if (l.categoria) cats.set(l.categoria, (cats.get(l.categoria) || 0) + 1)
    const categoria = [...cats.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
    novas.push({
      chave, tipo,
      nome: rotuloDe(chave, itens.map(l => String(l.descricao || ''))),
      categoria,
      padrao: p,
      confianca: confiancaPadrao(p),
      porque: explicarPadrao(p),
      regra: regraSugerida(chave, p),
      ids: itens.map(l => l.id),
      valor_total: cent(itens.reduce((s, l) => s + Math.abs(Number(l.valor) || 0), 0)),
    })
  }
  novas.sort((a, b) => b.confianca - a.confianca || b.valor_total - a.valor_total)

  return { novas, soltas, ignoradas_com_dono: comDono }
}

// ─── Linha do tempo ──────────────────────────────────────────────────────────

export type EstadoMes = 'pago' | 'recebido' | 'pendente' | 'faltou' | 'aguardando' | 'previsto'

export interface MesLinha {
  mes: string            // YYYY-MM
  rotulo: string         // "out/2026"
  estado: EstadoMes
  previsto: number | null
  lancamentos: Array<{
    id: number; descricao: string; data: string; valor: number
    status: string | null; ajuste: number | null
    /** Juros/taxa embutidos no valor (compra com acréscimo no cartão). */
    juros: number | null
  }>
  /** Lançamentos sem vínculo que parecem ser deste mês. */
  possiveis: CandidatoSolto[]
  duplicado: boolean
}

export interface LinhaDoTempo {
  passadas: MesLinha[]
  proximas: MesLinha[]
  resumo: {
    meses_pagos: number
    meses_faltando: number
    meses_ajustados: number
    total_lancado: number
  }
  /** Os últimos lançamentos vieram diferentes no mesmo sentido: talvez reajuste. */
  reajuste: { de: number; para: number; meses: number } | null
}

function mesesEntre(inicio: string, fim: string): string[] {
  const out: string[] = []
  let [a, m] = inicio.split('-').map(Number)
  const [af, mf] = fim.split('-').map(Number)
  while (a < af || (a === af && m <= mf)) {
    out.push(`${a}-${String(m).padStart(2, '0')}`)
    m++; if (m > 12) { m = 1; a++ }
  }
  return out
}
const rotuloMes = (k: string) => { const [a, m] = k.split('-').map(Number); return `${MESES_TXT[m - 1]}/${a}` }
const somarMes = (k: string, n: number) => {
  let [a, m] = k.split('-').map(Number)
  m += n
  while (m > 12) { m -= 12; a++ }
  while (m < 1) { m += 12; a-- }
  return `${a}-${String(m).padStart(2, '0')}`
}

export function linhaDoTempo(opcoes: {
  recorrencia: Recorrencia
  vinculados: Lancamento[]
  soltas?: CandidatoSolto[]
  hoje: string
  meses_passados?: number
  meses_futuros?: number
}): LinhaDoTempo {
  const r = opcoes.recorrencia
  const variavel = r.valor_variavel === true || Number(r.valor_variavel) === 1
  const previsto = variavel ? null : cent(r.valor)
  const atual = chaveMes(opcoes.hoje)
  const nPass = Math.max(1, opcoes.meses_passados ?? 12)
  const nFut = Math.max(0, opcoes.meses_futuros ?? 6)

  const porMes = new Map<string, Lancamento[]>()
  for (const l of opcoes.vinculados) {
    const k = chaveMes(l.data)
    if (!porMes.has(k)) porMes.set(k, [])
    porMes.get(k)!.push(l)
  }
  const soltasPorMes = new Map<string, CandidatoSolto[]>()
  for (const s of opcoes.soltas || []) {
    const k = chaveMes(s.data)
    if (!soltasPorMes.has(k)) soltasPorMes.set(k, [])
    soltasPorMes.get(k)!.push(s)
  }

  // Início: o mais antigo entre o início declarado e o primeiro lançamento,
  // limitado à janela. Fim: o fim declarado, se houver.
  const primeiros = [...porMes.keys()].sort()
  const inicioDecl = r.data_inicio ? chaveMes(r.data_inicio) : null
  let inicio = [inicioDecl, primeiros[0]].filter(Boolean).sort()[0] || atual
  const limite = somarMes(atual, -(nPass - 1))
  if (inicio < limite) inicio = limite
  const fimDecl = r.data_fim ? chaveMes(r.data_fim) : null

  const tipoPago: EstadoMes = r.tipo === 'receita' ? 'recebido' : 'pago'
  const fazer = (k: string, passado: boolean): MesLinha => {
    const ls = (porMes.get(k) || []).slice().sort((a, b) => ymd(a.data).localeCompare(ymd(b.data)))
    const lanc = ls.map(l => ({
      id: l.id, descricao: String(l.descricao || ''), data: ymd(l.data),
      valor: cent(l.valor), status: l.status ?? null,
      ajuste: previsto != null && Math.abs(cent(l.valor) - previsto) >= 0.01 ? cent(cent(l.valor) - previsto) : null,
      juros: Number(l.valor_juros) > 0 ? cent(Number(l.valor_juros)) : null,
    }))
    let estado: EstadoMes
    if (lanc.length) {
      const pend = r.tipo === 'despesa' && lanc.every(x => String(x.status || '') === 'pendente')
      estado = pend ? 'pendente' : tipoPago
    } else if (!passado) estado = 'previsto'
    else estado = k === atual ? 'aguardando' : 'faltou'
    return {
      mes: k, rotulo: rotuloMes(k), estado, previsto,
      lancamentos: lanc,
      possiveis: lanc.length ? [] : (soltasPorMes.get(k) || []),
      duplicado: lanc.length > 1,
    }
  }

  const passadas = mesesEntre(inicio, atual)
    .filter(k => !fimDecl || k <= fimDecl)
    .map(k => fazer(k, true))
    .reverse()

  const proximas: MesLinha[] = []
  for (let i = 1; i <= nFut; i++) {
    const k = somarMes(atual, i)
    if (fimDecl && k > fimDecl) break
    proximas.push(fazer(k, false))
  }

  // ── Reajuste: os últimos lançamentos vieram diferentes, no mesmo sentido ────
  let reajuste: LinhaDoTempo['reajuste'] = null
  if (previsto != null) {
    const ultimos = [...passadas].filter(m => m.lancamentos.length === 1).slice(0, 3)
      .map(m => m.lancamentos[0].valor)
    let iguais = 0
    for (const v of ultimos) {
      if (Math.abs(v - previsto) < 0.01) break
      if (iguais && Math.sign(v - previsto) !== Math.sign(ultimos[0] - previsto)) break
      iguais++
    }
    if (iguais >= 2) reajuste = { de: previsto, para: ultimos[0], meses: iguais }
  }

  return {
    passadas, proximas,
    resumo: {
      meses_pagos: passadas.filter(m => m.estado === 'pago' || m.estado === 'recebido').length,
      meses_faltando: passadas.filter(m => m.estado === 'faltou').length,
      meses_ajustados: passadas.filter(m => m.lancamentos.some(l => l.ajuste != null)).length,
      total_lancado: cent(passadas.reduce((s, m) => s + m.lancamentos.reduce((t, l) => t + l.valor, 0), 0)),
    },
    reajuste,
  }
}

// ─── Procurar lançamentos de UMA recorrência ─────────────────────────────────
//
// O rastreio acha o que tem o mesmo nome. Aqui é o caso contrário: a conta
// existe, mas o banco a escreve de outro jeito — "Juros de obra" chega como
// "EVOLUCAO DE OBRA". Nome sozinho não resolve; o que denuncia é o conjunto:
// uma palavra em comum, valor na faixa, mesmo dia, mesma categoria, e um mês
// que ainda está vazio na linha do tempo. A pessoa decide sim ou não.

const PALAVRAS_VAZIAS = new Set(['DE', 'DA', 'DO', 'DAS', 'DOS', 'E', 'EM', 'COM', 'PARA', 'POR', 'NO', 'NA', 'A', 'O', 'AO'])
const palavras = (s: string) => new Set(normalizarDescricao(s || '').split(' ').filter(p => p.length >= 3 && !PALAVRAS_VAZIAS.has(p)))
const raizCat = (c?: string | null) => normalizarDescricao(String(c || '')).split(' ')[0] || ''

export interface Candidato {
  id: number
  descricao: string
  data: string
  valor: number
  categoria: string | null
  pontos: number
  motivos: string[]
  mes_ocupado: boolean
  criterios: ResultadoMatch
}

export function candidatosPara(opcoes: {
  recorrencia: Recorrencia
  regra: Regra
  /** Lançamentos do mesmo tipo, vinculados ou não. */
  lancamentos: Lancamento[]
  dispensadas?: Set<string>
  limite?: number
}): Candidato[] {
  const r = opcoes.recorrencia, regra = opcoes.regra
  const dispensadas = opcoes.dispensadas || new Set<string>()
  const vinculados = opcoes.lancamentos.filter(l => recorrenciaDe(l) === r.id)
  const ocupados = new Set(vinculados.map(l => chaveMes(l.data)))

  // O vocabulário da conta: o nome, a regra, os apelidos e o que já foi
  // vinculado — se a pessoa já ligou um "EVOLUCAO OBRA", ele também ensina.
  const vocab = new Set<string>()
  for (const t of [r.descricao, regra.texto, ...(regra.apelidos || []), ...vinculados.map(l => l.descricao || '')])
    for (const p of palavras(t)) vocab.add(p)

  // Valor de referência: o fixo, ou a mediana do que já foi lançado.
  const valoresV = vinculados.map(l => Math.abs(Number(l.valor) || 0)).filter(v => v > 0)
  const variavel = r.valor_variavel === true || Number(r.valor_variavel) === 1
  const ref = !variavel && Number(r.valor) > 0 ? Math.abs(Number(r.valor)) : mediana(valoresV)
  const catsV = new Set([raizCat(r.categoria), ...vinculados.map(l => raizCat(l.categoria))].filter(Boolean))

  const out: Candidato[] = []
  for (const l of opcoes.lancamentos) {
    if (recorrenciaDe(l) || temDono(l)) continue
    if (dispensadas.has(`solta:${r.id}:${l.id}`)) continue
    const m = casaRegra(l, r, regra)
    const motivos: string[] = []
    let pontos = 0

    const comuns = [...palavras(l.descricao || '')].filter(p => vocab.has(p))
    if (m.texto) { pontos += 40; motivos.push('nome bate na regra') }
    else if (comuns.length) { pontos += 15 + Math.min(15, comuns.length * 7); motivos.push(`palavra em comum: ${comuns.slice(0, 3).join(', ').toLowerCase()}`) }

    const v = Math.abs(Number(l.valor) || 0)
    let valorPerto = false
    if (ref > 0) {
      const dif = Math.abs(v - ref) / ref
      const tol = (regra.tol_valor_pct ?? 25) / 100
      if (dif <= Math.max(tol, 0.05)) { pontos += 25; valorPerto = true; motivos.push('valor na faixa') }
      else if (dif <= 0.25) { pontos += 15; valorPerto = true; motivos.push('valor próximo') }
      else if (dif <= 0.5) { pontos += 5 }
    }

    if (l.cartao_id) pontos += 8
    else {
      const [a, mm] = ymd(l.data).split('-').map(Number)
      const diaR = Number(r.dia_vencimento) >= (a && mm ? ultimoDia(a, mm) - 1 : 30) ? 31 : Number(r.dia_vencimento)
      const dd = distanciaDia(diaNormalizado(l.data), diaR)
      if (dd <= regra.tol_dias) { pontos += 15; motivos.push('mesmo dia do mês') }
      else if (dd <= regra.tol_dias * 2) pontos += 7
    }

    const mesmaCat = !!l.categoria && catsV.has(raizCat(l.categoria))
    if (mesmaCat) { pontos += 10; motivos.push('mesma categoria') }

    const ocupado = ocupados.has(chaveMes(l.data))
    if (ocupado) pontos -= 15
    else { pontos += 10; motivos.push('mês ainda vazio na recorrência') }

    // Sem nenhum laço de nome, só valor + categoria juntos justificam mostrar.
    const temLaco = m.texto || comuns.length > 0 || (valorPerto && mesmaCat)
    if (!temLaco || pontos < 40) continue
    out.push({
      id: l.id, descricao: String(l.descricao || ''), data: ymd(l.data), valor: cent(l.valor),
      categoria: l.categoria ?? null, pontos: Math.min(100, pontos), motivos, mes_ocupado: ocupado, criterios: m,
    })
  }
  out.sort((a, b) => b.pontos - a.pontos || b.data.localeCompare(a.data))
  return out.slice(0, opcoes.limite ?? 40)
}

/**
 * Inclui no apelido os nomes confirmados que a regra ainda não pega.
 * Devolve a lista nova (sem repetição, no máximo 12).
 */
export function aprenderApelidos(regra: Regra, r: Recorrencia, confirmados: Lancamento[]): string[] {
  const atuais = (regra.apelidos || []).map(a => normalizarDescricao(a)).filter(Boolean)
  const novos = [...atuais]
  for (const l of confirmados) {
    if (casaRegra({ ...l, cartao_id: null }, r, { ...regra, apelidos: novos, tol_valor_pct: null, tol_dias: 31 }).texto) continue
    const k = normalizarDescricao(l.descricao || '')
    if (k.length >= 3 && !novos.includes(k)) novos.push(k)
  }
  return novos.slice(0, 12)
}

export { cent }
