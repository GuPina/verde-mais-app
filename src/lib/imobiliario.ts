/**
 * VerdeMais — o financiamento imobiliário visto pelo que foi pago
 * ============================================================================
 * O contrato diz quanto se deve. Os lançamentos dizem quanto se pagou, e em
 * quê. Este módulo junta os dois, sem banco: a rota carrega as linhas e
 * chama `painel()`, `candidatos()` e `sugestoes()`.
 *
 * Cada despesa ligada ao financiamento tem UM papel:
 *
 *   entrada  — sinal, ato, parcelas e intermediárias da entrada
 *   obra     — evolução de obra / juros de obra (custo puro: não abate dívida)
 *   parcela  — a prestação do financiamento depois das chaves
 *   seguro   — MIP, DFI, taxa de administração
 *   extra    — ITBI, cartório, escritura, registro, avaliação
 *
 * A separação existe por causa da pergunta que importa num imóvel na planta:
 * de tudo que já saiu do bolso, quanto virou patrimônio (entrada, amortização)
 * e quanto foi custo (obra, juros, seguros, taxas)?
 */

import { normalizarDescricao, vinculoDe } from './identidade'

export type Papel = 'entrada' | 'obra' | 'parcela' | 'seguro' | 'extra'
export const PAPEIS: Papel[] = ['entrada', 'obra', 'parcela', 'seguro', 'extra']
export const ROTULO: Record<Papel, string> = {
  entrada: 'Entrada', obra: 'Evolução de obra', parcela: 'Parcelas', seguro: 'Seguros e taxas', extra: 'ITBI, cartório e extras',
}
/** O que cada papel costuma ter escrito na descrição. */
const PALAVRAS_DO_PAPEL: Record<Papel, string[]> = {
  entrada: ['ENTRADA', 'SINAL', 'ATO', 'INTERMEDIARIA', 'INTERMEDIARIAS', 'BALAO', 'ANUAL', 'SEMESTRAL'],
  obra: ['EVOLUCAO', 'OBRA', 'OBRAS', 'CONSTRUCAO', 'JUROS'],
  parcela: ['FINANCIAMENTO', 'PRESTACAO', 'HABITACIONAL', 'SFH', 'SFI', 'HABITACAO'],
  seguro: ['SEGURO', 'MIP', 'DFI', 'TAXA', 'ADMINISTRACAO', 'TARIFA'],
  extra: ['ITBI', 'CARTORIO', 'ESCRITURA', 'REGISTRO', 'AVALIACAO', 'VISTORIA', 'LAUDO', 'DESPACHANTE', 'CERTIDAO'],
}
/** Palavras que só aparecem nesse contexto: sozinhas já bastam para sugerir. */
const PALAVRAS_FORTES = new Set(['ITBI', 'CARTORIO', 'ESCRITURA', 'MIP', 'DFI', 'INTERMEDIARIA', 'INTERMEDIARIAS', 'HABITACIONAL', 'SFH'])

/** Custo é o que sai do bolso e não vira patrimônio. */
export const EH_CUSTO: Record<Papel, boolean> = { entrada: false, obra: true, parcela: false, seguro: true, extra: true }

const cent = (v: number) => Math.round((Number(v) || 0) * 100) / 100
const ymd = (s: string) => String(s || '').slice(0, 10)
const mesDe = (s: string) => ymd(s).slice(0, 7)
const VAZIAS = new Set(['DE', 'DA', 'DO', 'DAS', 'DOS', 'E', 'EM', 'COM', 'PARA', 'POR', 'NO', 'NA', 'A', 'O', 'AO', 'APTO', 'AP'])
const palavras = (s: string) => new Set(normalizarDescricao(s || '').split(' ').filter(p => p.length >= 3 && !VAZIAS.has(p)))

export function somarMes(k: string, n: number) {
  let [a, m] = k.split('-').map(Number)
  m += n
  while (m > 12) { m -= 12; a++ }
  while (m < 1) { m += 12; a-- }
  return `${a}-${String(m).padStart(2, '0')}`
}

export interface Fin {
  id: number
  descricao: string
  banco?: string | null
  construtora?: string | null
  tipo_financiamento?: string | null
  tipo_bem?: string | null
  valor_imovel?: number
  valor_entrada?: number
  valor_financiado: number
  saldo_devedor: number
  valor_parcela: number
  taxa_juros_mensal: number   // em %
  numero_parcelas: number
  parcelas_pagas: number
  sistema_amortizacao?: string | null
  data_inicio?: string | null
  data_chaves?: string | null
  evolucao_obra_pct?: number | null
}

export interface Pago {
  id: number
  descricao: string
  valor: number
  data: string
  status?: string | null
  papel: Papel
  /** Gerada pelo próprio financiamento (parcela do contrato). */
  automatica?: boolean
}

export const ehImobiliario = (f: Fin) =>
  ['imovel', 'imovel_comercial', 'rural'].includes(String(f.tipo_bem || 'imovel')) ||
  ['planta', 'construcao', 'terreno', 'reforma'].includes(String(f.tipo_financiamento || ''))
export const naPlanta = (f: Fin) => ['planta', 'construcao'].includes(String(f.tipo_financiamento || ''))

// ─── Procurar lançamentos do financiamento ───────────────────────────────────

export interface Linha {
  id: number
  descricao: string | null
  valor: number
  data: string
  categoria?: string | null
  observacoes?: string | null
  status?: string | null
  /** Já ligada a algum financiamento. */
  financiamento_id?: number | null
}

export interface CandidatoFin {
  id: number
  descricao: string
  valor: number
  data: string
  categoria: string | null
  papel: Papel
  pontos: number
  motivos: string[]
}

/**
 * Os lançamentos que parecem deste financiamento, cada um com o papel mais
 * provável. Ao contrário do rastreio de recorrências, PARCELA NÃO SAI: entrada
 * parcelada em 36x é exatamente o que se quer achar aqui. Sai só o que já tem
 * outro dono: outro financiamento, um empréstimo, um recebimento.
 */
export function candidatos(opcoes: {
  fin: Fin
  linhas: Linha[]
  /** Já vinculados a ESTE financiamento, com papel — ensinam valor e vocabulário. */
  vinculados: Pago[]
  apelidos: Array<{ papel: Papel; texto: string }>
  dispensadas?: Set<string>
  limite?: number
}): CandidatoFin[] {
  const { fin } = opcoes
  const dispensadas = opcoes.dispensadas || new Set<string>()
  const doFin = new Set<string>()
  for (const t of [fin.descricao, fin.banco || '', fin.construtora || '']) for (const p of palavras(t)) doFin.add(p)

  const vocabPapel = new Map<Papel, Set<string>>()
  const faixa = new Map<Papel, [number, number]>()
  for (const p of PAPEIS) {
    const vs = opcoes.vinculados.filter(v => v.papel === p)
    const set = new Set<string>()
    for (const v of vs) for (const w of palavras(v.descricao)) set.add(w)
    vocabPapel.set(p, set)
    if (vs.length) faixa.set(p, [Math.min(...vs.map(v => Math.abs(v.valor))), Math.max(...vs.map(v => Math.abs(v.valor)))])
  }

  const out: CandidatoFin[] = []
  for (const l of opcoes.linhas) {
    if (l.financiamento_id) continue
    if (dispensadas.has(`fin:${fin.id}:${l.id}`)) continue
    const v = vinculoDe({ observacoes: l.observacoes })
    if (v && v.tipo !== 'recorrencia') continue                      // financiamento/empréstimo automático
    if (/\[recebimento\s*#\d+/i.test(String(l.observacoes || ''))) continue

    const desc = normalizarDescricao(l.descricao || '')
    const ws = palavras(l.descricao || '')
    const comFin = [...ws].filter(w => doFin.has(w))
    const valor = Math.abs(Number(l.valor) || 0)
    const catImovel = /MORADIA|HABITA|FINANCIA|IMOVEL|CASA|APART/.test(normalizarDescricao(l.categoria || ''))

    let melhor: CandidatoFin | null = null
    for (const p of PAPEIS) {
      let pontos = 0
      const motivos: string[] = []
      const apelido = opcoes.apelidos.find(a => a.papel === p && a.texto && desc.includes(a.texto))
      if (apelido) { pontos += 45; motivos.push(`nome já confirmado (${apelido.texto.toLowerCase()})`) }
      const chave = PALAVRAS_DO_PAPEL[p].filter(k => ws.has(k))
      const forte = chave.some(k => PALAVRAS_FORTES.has(k)) || (p === 'obra' && ws.has('EVOLUCAO') && ws.has('OBRA'))
      if (chave.length) { pontos += (forte ? 35 : 20) + Math.min(10, (chave.length - 1) * 5); motivos.push(`“${chave.slice(0, 2).join(' ').toLowerCase()}” na descrição`) }
      if (comFin.length) { pontos += 25; motivos.push(`nome do imóvel/banco: ${comFin.slice(0, 2).join(' ').toLowerCase()}`) }
      const comPapel = [...ws].filter(w => vocabPapel.get(p)!.has(w))
      if (comPapel.length) { pontos += 15; motivos.push('parecido com os já vinculados') }
      const fx = faixa.get(p)
      if (fx && valor >= fx[0] * 0.7 && valor <= fx[1] * 1.3) { pontos += 10; motivos.push('valor na faixa dos já vinculados') }
      if (catImovel) { pontos += 10; motivos.push('categoria de moradia/financiamento') }
      // Valor e categoria sozinhos somam 20: sem um laço de nome (apelido,
      // palavra do papel, nome do imóvel/banco/construtora) nunca chegam a 35.
      if (pontos < 35) continue
      if (!melhor || pontos > melhor.pontos) {
        melhor = { id: l.id, descricao: String(l.descricao || ''), valor: cent(l.valor), data: ymd(l.data), categoria: l.categoria ?? null, papel: p, pontos: Math.min(100, pontos), motivos }
      }
    }
    if (melhor) out.push(melhor)
  }
  out.sort((a, b) => b.pontos - a.pontos || b.data.localeCompare(a.data))
  return out.slice(0, opcoes.limite ?? 80)
}

/** O papel cujo apelido o lançamento contém — só se for exatamente um. */
export function papelPorApelido(descricao: string, apelidos: Array<{ financiamento_id: number; papel: Papel; texto: string }>) {
  const desc = normalizarDescricao(descricao || '')
  const hits = apelidos.filter(a => a.texto && desc.includes(a.texto))
  const unicos = new Map(hits.map(h => [`${h.financiamento_id}:${h.papel}`, h]))
  return unicos.size === 1 ? [...unicos.values()][0] : null
}

// ─── Painel ──────────────────────────────────────────────────────────────────

export interface Bloco {
  papel: Papel
  rotulo: string
  pago: number
  pendente: number
  n_pagos: number
  n_pendentes: number
  ultimo: { data: string; valor: number } | null
  media_mensal: number
  custo: boolean
}

export interface MesSerie { mes: string; futuro: boolean; total: number; por_papel: Record<Papel, number> }

export interface Painel {
  imobiliario: boolean
  fase: 'obra' | 'amortizacao' | 'quitado'
  meses_ate_chaves: number | null
  blocos: Bloco[]
  entrada: { contratada: number; paga: number; pendente_lancada: number; falta: number; pct: number }
  serie: MesSerie[]
  totais: { pago: number; patrimonio: number; custo: number; pendente: number }
}

const pago = (p: Pago, hoje: string) => String(p.status || '') === 'pago' || (!p.status && ymd(p.data) <= hoje)

export function painel(opcoes: { fin: Fin; pagos: Pago[]; hoje: string; meses_passados?: number; meses_futuros?: number }): Painel {
  const { fin, hoje } = opcoes
  const ps = opcoes.pagos
  const blocos: Bloco[] = PAPEIS.map(papel => {
    const xs = ps.filter(p => p.papel === papel)
    const feitos = xs.filter(p => pago(p, hoje)).sort((a, b) => ymd(a.data).localeCompare(ymd(b.data)))
    const abertos = xs.filter(p => !pago(p, hoje))
    const ult = feitos[feitos.length - 1]
    // Média dos últimos 6 meses com pagamento — o "quanto isso me custa por mês".
    const porMes = new Map<string, number>()
    for (const p of feitos) porMes.set(mesDe(p.data), (porMes.get(mesDe(p.data)) || 0) + Math.abs(p.valor))
    const ult6 = [...porMes.entries()].sort((a, b) => b[0].localeCompare(a[0])).slice(0, 6)
    return {
      papel, rotulo: ROTULO[papel],
      pago: cent(feitos.reduce((s, p) => s + Math.abs(p.valor), 0)),
      pendente: cent(abertos.reduce((s, p) => s + Math.abs(p.valor), 0)),
      n_pagos: feitos.length, n_pendentes: abertos.length,
      ultimo: ult ? { data: ymd(ult.data), valor: cent(ult.valor) } : null,
      media_mensal: ult6.length ? cent(ult6.reduce((s, [, v]) => s + v, 0) / ult6.length) : 0,
      custo: EH_CUSTO[papel],
    }
  })
  const b = (p: Papel) => blocos.find(x => x.papel === p)!

  const contratada = cent(Number(fin.valor_entrada) || 0)
  const paga = b('entrada').pago
  const entrada = {
    contratada, paga, pendente_lancada: b('entrada').pendente,
    falta: cent(Math.max(0, contratada - paga)),
    pct: contratada > 0 ? Math.min(100, Math.round((paga / contratada) * 1000) / 10) : 0,
  }

  // Série mês a mês, empilhada por papel.
  const atual = mesDe(hoje)
  const nP = opcoes.meses_passados ?? 18, nF = opcoes.meses_futuros ?? 6
  const serie: MesSerie[] = []
  for (let i = -(nP - 1); i <= nF; i++) {
    const k = somarMes(atual, i)
    const por: Record<Papel, number> = { entrada: 0, obra: 0, parcela: 0, seguro: 0, extra: 0 }
    for (const p of ps) if (mesDe(p.data) === k) por[p.papel] += Math.abs(p.valor)
    for (const p of PAPEIS) por[p] = cent(por[p])
    serie.push({ mes: k, futuro: k > atual, total: cent(PAPEIS.reduce((s, p) => s + por[p], 0)), por_papel: por })
  }

  const chaves = fin.data_chaves ? ymd(fin.data_chaves) : null
  const quitado = Number(fin.saldo_devedor) <= 0.01 && Number(fin.parcelas_pagas) >= Number(fin.numero_parcelas)
  const emObra = naPlanta(fin) && (!chaves || chaves > hoje)
  let mesesAteChaves: number | null = null
  if (chaves && chaves > hoje) {
    const [a1, m1] = hoje.split('-').map(Number), [a2, m2] = chaves.split('-').map(Number)
    mesesAteChaves = (a2 - a1) * 12 + (m2 - m1)
  }

  const pagoTotal = cent(blocos.reduce((s, x) => s + x.pago, 0))
  const custo = cent(blocos.filter(x => x.custo).reduce((s, x) => s + x.pago, 0))
  return {
    imobiliario: ehImobiliario(fin),
    fase: quitado ? 'quitado' : emObra ? 'obra' : 'amortizacao',
    meses_ate_chaves: mesesAteChaves,
    blocos, entrada, serie,
    totais: { pago: pagoTotal, patrimonio: cent(pagoTotal - custo), custo, pendente: cent(blocos.reduce((s, x) => s + x.pendente, 0)) },
  }
}

// ─── Indicadores e sugestões ─────────────────────────────────────────────────

/** Uma amortização extra de `extra` reais: quanto de juros e de prazo economiza. */
export function simularAmortizacao(f: Fin, extra: number, modo: 'prazo' | 'parcela') {
  const i = Number(f.taxa_juros_mensal) / 100
  const n = Math.max(0, Number(f.numero_parcelas) - Number(f.parcelas_pagas))
  const saldo = Math.max(0, Number(f.saldo_devedor))
  const sac = ['sac', 'sacre'].includes(String(f.sistema_amortizacao || '').toLowerCase())
  const jurosAte = (s0: number, nMax: number, parcelaPrice: number | null, amortSac: number | null) => {
    let s = s0, juros = 0, meses = 0
    while (s > 0.01 && meses < nMax + 600) {
      const j = s * i
      const a = amortSac != null ? Math.min(amortSac, s) : Math.min(Math.max(0, (parcelaPrice ?? 0) - j), s)
      if (a <= 0) break
      juros += j; s -= a; meses++
    }
    return { juros, meses }
  }
  const pmt = (s: number, nn: number) => (i > 0 ? s * i / (1 - Math.pow(1 + i, -nn)) : s / Math.max(1, nn))
  if (!n || !saldo) return null
  const base = sac ? jurosAte(saldo, n, null, saldo / n) : jurosAte(saldo, n, pmt(saldo, n), null)
  const novo = Math.max(0, saldo - extra)
  const sim = modo === 'prazo'
    ? (sac ? jurosAte(novo, n, null, saldo / n) : jurosAte(novo, n, pmt(saldo, n), null))
    : (sac ? jurosAte(novo, n, null, novo / n) : jurosAte(novo, n, pmt(novo, n), null))
  return {
    extra: cent(extra), modo,
    juros_economizados: cent(base.juros - sim.juros),
    meses_a_menos: Math.max(0, base.meses - sim.meses),
    parcela_nova: modo === 'parcela' ? cent(sac ? novo / n + novo * i : pmt(novo, n)) : null,
  }
}

export interface Sugestao { tipo: 'alerta' | 'dica' | 'info'; titulo: string; texto: string }

export function indicadores(opcoes: {
  fin: Fin
  painel: Painel
  pagos: Pago[]
  hoje: string
  renda_mensal?: number | null
  obra_hist?: Array<{ data: string; pct: number }>
}) {
  const { fin, painel: p, hoje } = opcoes
  const obra = opcoes.pagos.filter(x => x.papel === 'obra' && pago(x, hoje))
    .sort((a, b) => ymd(a.data).localeCompare(ymd(b.data)))
  const porMesObra = new Map<string, number>()
  for (const x of obra) porMesObra.set(mesDe(x.data), (porMesObra.get(mesDe(x.data)) || 0) + Math.abs(x.valor))
  const serieObra = [...porMesObra.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([mes, v]) => ({ mes, valor: cent(v) }))

  // Próximo juros de obra: pela tendência dos últimos meses (crescimento
  // mediano mês a mês) e, se houver % da obra e taxa, pelo saldo liberado.
  let proximoObra: { por_tendencia: number | null; pelo_pct: number | null } | null = null
  let aceleracao: number | null = null
  let ritmoObra: number | null = null, ultimoSalto: number | null = null
  if (serieObra.length >= 2) {
    const u = serieObra.slice(-4)
    const cresc = u.slice(1).map((x, k) => (u[k].valor > 0 ? x.valor / u[k].valor - 1 : 0)).sort((a, b) => a - b)
    const med = cresc[Math.floor(cresc.length / 2)]
    const ultimo = serieObra[serieObra.length - 1].valor
    // Aceleração é o último salto comparado ao RITMO de antes, não ao valor:
    // evolução de obra cresce todo mês por natureza, e comparar com a média
    // dos meses anteriores acusaria alerta em toda obra saudável.
    const todos = serieObra.slice(-7).map(x => x.valor)
    const saltos = todos.slice(1).map((v, k) => (todos[k] > 0 ? v / todos[k] - 1 : 0))
    if (saltos.length >= 2) {
      const antes = saltos.slice(0, -1).sort((a, b) => a - b)
      const ritmo = antes[Math.floor(antes.length / 2)]
      ritmoObra = Math.round(ritmo * 1000) / 10
      ultimoSalto = Math.round(saltos[saltos.length - 1] * 1000) / 10
      aceleracao = Math.round((saltos[saltos.length - 1] - ritmo) * 1000) / 10
    }
    const pct = Number(fin.evolucao_obra_pct) || 0
    const hist = (opcoes.obra_hist || []).slice().sort((a, b) => a.data.localeCompare(b.data))
    let ritmo = 0
    if (hist.length >= 2) {
      const h0 = hist[0], h1 = hist[hist.length - 1]
      const meses = Math.max(1, Math.round((Date.parse(h1.data) - Date.parse(h0.data)) / (30.44 * 86400000)))
      ritmo = (h1.pct - h0.pct) / meses
    }
    const i = Number(fin.taxa_juros_mensal) / 100
    proximoObra = {
      por_tendencia: cent(ultimo * (1 + Math.max(-0.5, Math.min(0.5, med)))),
      pelo_pct: pct > 0 && i > 0 ? cent(Number(fin.valor_financiado) * Math.min(100, pct + ritmo) / 100 * i) : null,
    }
  }

  // Amortizado pelo contrato (financiado − saldo). Só conta o que aparece
  // nas parcelas vinculadas: sem elas, o painel não afirma o que não vê.
  const amortizadoContrato = cent(Math.max(0, Number(fin.valor_financiado) - Number(fin.saldo_devedor)))
  const parcelasPagas = p.blocos.find(b => b.papel === 'parcela')!.pago
  const amortizado = cent(Math.min(amortizadoContrato, parcelasPagas))
  const jurosNasParcelas = cent(Math.max(0, parcelasPagas - amortizado))

  // Primeira parcela depois das chaves: a do contrato, ou PRICE/SAC sobre o saldo.
  const i = Number(fin.taxa_juros_mensal) / 100
  const nRest = Math.max(1, Number(fin.numero_parcelas) - Number(fin.parcelas_pagas))
  const saldo = Number(fin.saldo_devedor)
  const sac = ['sac', 'sacre'].includes(String(fin.sistema_amortizacao || '').toLowerCase())
  const calc = sac ? saldo / nRest + saldo * i : (i > 0 ? saldo * i / (1 - Math.pow(1 + i, -nRest)) : saldo / nRest)
  const primeiraPos = cent(Number(fin.valor_parcela) > 0 ? Number(fin.valor_parcela) : calc)

  // Quanto do mês o imóvel leva: média dos últimos 3 meses pagos.
  const ult3 = p.serie.filter(m => !m.futuro && m.total > 0).slice(-3)
  const mensal = ult3.length ? cent(ult3.reduce((s, m) => s + m.total, 0) / ult3.length) : 0
  const renda = Number(opcoes.renda_mensal) || 0

  return {
    total_pago: p.totais.pago,
    virou_patrimonio: cent(p.blocos.find(b => b.papel === 'entrada')!.pago + amortizado),
    custo: cent(p.totais.custo + jurosNasParcelas),
    custo_detalhe: {
      obra: p.blocos.find(b => b.papel === 'obra')!.pago,
      seguro: p.blocos.find(b => b.papel === 'seguro')!.pago,
      extra: p.blocos.find(b => b.papel === 'extra')!.pago,
      juros_nas_parcelas: jurosNasParcelas,
    },
    amortizado,
    amortizado_contrato: amortizadoContrato,
    gasto_mensal_medio: mensal,
    pct_renda: renda > 0 ? Math.round((mensal / renda) * 1000) / 10 : null,
    pct_renda_pos_chaves: renda > 0 ? Math.round((primeiraPos / renda) * 1000) / 10 : null,
    primeira_parcela_pos_chaves: primeiraPos,
    obra: { serie: serieObra, proximo: proximoObra, aceleracao_pct: aceleracao, ritmo_pct: ritmoObra, ultimo_salto_pct: ultimoSalto },
  }
}

export function sugestoes(opcoes: { fin: Fin; painel: Painel; ind: ReturnType<typeof indicadores> }): Sugestao[] {
  const { fin, painel: p, ind } = opcoes
  const out: Sugestao[] = []
  const brl = (v: number) => 'R$ ' + Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  if (p.fase === 'obra' && ind.obra.proximo?.por_tendencia)
    out.push({ tipo: 'info', titulo: 'Próxima evolução de obra',
      texto: `Pela tendência dos últimos meses, a próxima deve ficar perto de ${brl(ind.obra.proximo.por_tendencia)}` +
        (ind.obra.proximo.pelo_pct ? `; pelo % da obra e a taxa do contrato, ${brl(ind.obra.proximo.pelo_pct)}.` : '.') +
        ' Ela cresce conforme o banco libera dinheiro para a construtora, e nada dela abate a dívida.' })
  if (ind.obra.aceleracao_pct != null && ind.obra.aceleracao_pct >= 15)
    out.push({ tipo: 'alerta', titulo: 'Evolução de obra acelerou',
      texto: `O último pagamento subiu ${(ind.obra.ultimo_salto_pct ?? 0).toLocaleString('pt-BR')}% sobre o mês anterior, quando o ritmo vinha sendo ${(ind.obra.ritmo_pct ?? 0).toLocaleString('pt-BR')}% ao mês. Vale conferir o % de obra no extrato do banco.` })
  if (p.entrada.contratada > 0 && p.entrada.falta > 0 && p.entrada.pendente_lancada < p.entrada.falta - 1)
    out.push({ tipo: 'dica', titulo: 'Entrada sem todos os lançamentos',
      texto: `Faltam ${brl(p.entrada.falta)} da entrada contratada, mas só ${brl(p.entrada.pendente_lancada)} estão lançados como pendentes. Use “Procurar lançamentos” ou lance as parcelas que faltam para o fluxo de caixa enxergar.` })
  if (p.fase === 'obra' && ind.pct_renda_pos_chaves != null && ind.pct_renda_pos_chaves > 30)
    out.push({ tipo: 'alerta', titulo: 'A parcela depois das chaves pesa',
      texto: `A primeira parcela prevista (${brl(ind.primeira_parcela_pos_chaves)}) é ${ind.pct_renda_pos_chaves.toLocaleString('pt-BR')}% da sua renda. Acima de 30% o orçamento aperta — juntar para amortizar na entrega das chaves (ou usar o FGTS) baixa esse número.` })
  else if (p.fase === 'obra')
    out.push({ tipo: 'info', titulo: 'Depois das chaves',
      texto: `A primeira parcela prevista é ${brl(ind.primeira_parcela_pos_chaves)}${ind.pct_renda_pos_chaves != null ? ` (${ind.pct_renda_pos_chaves.toLocaleString('pt-BR')}% da sua renda)` : ''}. A evolução de obra para; começa a amortização.` })

  if (p.fase === 'amortizacao' && Number(fin.saldo_devedor) > 0) {
    const extra = Math.round(Number(fin.saldo_devedor) * 0.05 / 100) * 100
    const prazo = simularAmortizacao(fin, extra, 'prazo')
    const parc = simularAmortizacao(fin, extra, 'parcela')
    if (prazo && prazo.juros_economizados > 0)
      out.push({ tipo: 'dica', titulo: `Amortizar ${brl(extra)}`,
        texto: `Reduzindo o PRAZO: economiza ${brl(prazo.juros_economizados)} de juros e ${prazo.meses_a_menos} meses.` +
          (parc?.parcela_nova ? ` Reduzindo a PARCELA: ela cai para ${brl(parc.parcela_nova)} e economiza ${brl(parc.juros_economizados)}.` : '') +
          ' Prazo quase sempre economiza mais; parcela alivia o mês.' })
  }
  if (ind.custo > 0 && ind.total_pago > 0)
    out.push({ tipo: 'info', titulo: 'Para onde foi o dinheiro',
      texto: `De ${brl(ind.total_pago)} pagos, ${brl(ind.virou_patrimonio)} viraram patrimônio (entrada e amortização) e ${brl(ind.custo)} foram custo (obra, juros, seguros e taxas).` })
  return out
}
