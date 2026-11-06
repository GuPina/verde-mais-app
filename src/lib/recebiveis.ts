/**
 * VerdeMais — o contrato corrigido por índice
 * ============================================================================
 * Um parcelamento a receber tem DOIS totais, e a tela mostrava só um.
 *
 * A Restituição Cooperativa do Gustavo: 34 parcelas de R$ 1.147,33, total
 * contratado R$ 39.009,35. Esse número é o piso — o mínimo que entra todo mês —
 * e ele não muda nunca. Mas o saldo é corrigido pelo INCC, então cada parcela
 * chega valendo o mínimo MAIS a correção do mês:
 *
 *     parcela 1    1.147,33      0,00
 *     parcela 2    1.147,33      0,00
 *     parcela 3    1.160,00    +12,67
 *     parcela 4    1.221,63    +74,30
 *     parcela 5    1.193,72    +46,39
 *     ──────────────────────────────────
 *                             +133,36
 *
 * A tela dizia "Total: R$ 39.009,35" com cinco parcelas já recebidas acima
 * disso. O contrato vale mais do que o contratado, e o app não tinha como
 * dizer quanto.
 *
 * ── AS DUAS CONTAS ──────────────────────────────────────────────────────────
 *
 *   contratado      o que está escrito no contrato, sem índice. Base fixa.
 *   correcao        a soma dos excedentes JÁ RECEBIDOS. Cresce a cada lançamento.
 *   corrigido       contratado + correcao. É este que a tela mostra como total.
 *
 * O que NÃO é feito aqui, de propósito: projetar a correção sobre as parcelas
 * que ainda não vieram. O INCC de um mês não prevê o do seguinte — entre a
 * parcela 4 e a 5 desta base ele CAIU — e 29 meses de projeção tirados de
 * quatro observações seria um número inventado com cara de medição. As
 * pendentes valem o mínimo contratual, que é o único valor que se sabe.
 */

const cent = (v: number) => Math.round((Number(v) || 0) * 100) / 100

export interface ParcelaRecebivel {
  numero_parcela?: number | null
  /** O que o contrato manda: o piso. */
  valor_previsto?: number | null
  /** Pendente: o previsto. Recebida: o que entrou de verdade. */
  valor: number
  status?: string | null
}

export interface Correcao {
  /** Base do contrato, sem índice. Não se move. */
  contratado: number
  /** Soma dos excedentes das parcelas já recebidas. */
  correcao: number
  /** contratado + correcao — o total que a tela mostra. */
  corrigido: number
  /** O que já entrou na conta. */
  recebido: number
  /** corrigido − recebido: o que ainda vem, no mínimo. */
  a_receber: number
  /** Quanto a correção representa sobre a base, em %. */
  correcao_pct: number
  parcelas_recebidas: number
  parcelas_total: number
  /**
   * Parcela que veio ABAIXO do mínimo contratual. Pelo contrato não deveria
   * existir — e por isso é denunciada em vez de somada em silêncio. Um número
   * negativo escondido dentro de "correção" faria a tela dizer que o índice
   * devolveu menos do que devolveu.
   */
  abaixo_do_minimo: Array<{ numero: number; previsto: number; recebido: number }>
}

/**
 * A correção de um contrato, a partir das suas parcelas.
 *
 * `contratado` vem do contrato e não da soma das parcelas: são números
 * diferentes por arredondamento (34 × 1.147,33 = 39.009,22, e o contrato diz
 * 39.009,35), e quem manda é o que está escrito.
 */
export function corrigir(contratado: number, parcelas: ParcelaRecebivel[]): Correcao {
  const base = cent(contratado)
  let correcao = 0
  let recebido = 0
  let recebidas = 0
  const abaixo: Correcao['abaixo_do_minimo'] = []

  for (const p of parcelas) {
    if (String(p.status || 'pendente') !== 'recebida') continue
    const valor = Number(p.valor) || 0
    // Sem previsto gravado — linha anterior à migração 0009 — o excedente é
    // zero, e não o valor inteiro: chutar aqui inflaria a correção em milhares.
    const previsto = p.valor_previsto == null ? valor : Number(p.valor_previsto) || 0
    recebidas++
    recebido += valor
    const excedente = valor - previsto
    if (excedente < -0.005) {
      abaixo.push({ numero: Number(p.numero_parcela) || 0,
                    previsto: cent(previsto), recebido: cent(valor) })
      continue
    }
    correcao += excedente
  }

  const corrigido = cent(base + correcao)
  return {
    contratado: base,
    correcao: cent(correcao),
    corrigido,
    recebido: cent(recebido),
    a_receber: cent(Math.max(0, corrigido - recebido)),
    correcao_pct: base > 0 ? Math.round((correcao / base) * 10000) / 100 : 0,
    parcelas_recebidas: recebidas,
    parcelas_total: parcelas.length,
    abaixo_do_minimo: abaixo,
  }
}

/** A mesma conta somada sobre vários contratos, para o topo da tela. */
export function somar(cs: Correcao[]): Correcao {
  const z: Correcao = {
    contratado: 0, correcao: 0, corrigido: 0, recebido: 0, a_receber: 0,
    correcao_pct: 0, parcelas_recebidas: 0, parcelas_total: 0, abaixo_do_minimo: [],
  }
  for (const c of cs) {
    z.contratado = cent(z.contratado + c.contratado)
    z.correcao = cent(z.correcao + c.correcao)
    z.corrigido = cent(z.corrigido + c.corrigido)
    z.recebido = cent(z.recebido + c.recebido)
    z.a_receber = cent(z.a_receber + c.a_receber)
    z.parcelas_recebidas += c.parcelas_recebidas
    z.parcelas_total += c.parcelas_total
    z.abaixo_do_minimo.push(...c.abaixo_do_minimo)
  }
  z.correcao_pct = z.contratado > 0 ? Math.round((z.correcao / z.contratado) * 10000) / 100 : 0
  return z
}

// ─── O recebimento parcelado visto como entrada que se repete ────────────────
//
// Na tela de Recorrências, um contrato com 34 parcelas mensais é uma entrada
// de todo mês — só que com fim, e com o valor vindo das parcelas (com a
// correção de cada uma), não de um valor fixo. Não vira recorrência: é lido
// direto das parcelas, para nunca duplicar a receita que o recebimento cria.

export interface ParcelaLinha {
  id: number
  numero_parcela: number
  valor: number
  valor_previsto?: number | null
  data_prevista: string
  data_recebimento?: string | null
  status?: string | null
}

export interface FluxoRecebimento {
  id: number
  descricao: string
  pagador: string | null
  total_parcelas: number
  recebidas: number
  pendentes: number
  em_atraso: number
  proxima: { numero: number; data: string; valor: number } | null
  ultima_data: string | null
  /** O que entra num mês típico daqui pra frente: a próxima parcela. */
  valor_mensal: number
  /** Soma das parcelas a receber por mês (YYYY-MM). */
  por_mes: Record<string, number>
  passadas: Array<{ numero: number; data: string; valor: number; previsto: number; correcao: number }>
  proximas: Array<{ numero: number; data: string; valor: number; atrasada: boolean }>
  total_recebido: number
  total_a_receber: number
}

export function fluxoRecebimento(
  rec: { id: number; descricao: string; pagador?: string | null },
  parcelas: ParcelaLinha[],
  hoje: string,
): FluxoRecebimento {
  const ymd = (s: string | null | undefined) => String(s || '').slice(0, 10)
  const vivas = parcelas.filter(p => p.status !== 'cancelada')
  const recebidas = vivas.filter(p => p.status === 'recebida')
    .sort((a, b) => ymd(b.data_recebimento || b.data_prevista).localeCompare(ymd(a.data_recebimento || a.data_prevista)))
  const pend = vivas.filter(p => p.status !== 'recebida').sort((a, b) => a.numero_parcela - b.numero_parcela)
  const por_mes: Record<string, number> = {}
  for (const p of pend) {
    const k = ymd(p.data_prevista).slice(0, 7)
    por_mes[k] = cent((por_mes[k] || 0) + Number(p.valor))
  }
  const prox = pend[0]
  return {
    id: rec.id, descricao: rec.descricao, pagador: rec.pagador ?? null,
    total_parcelas: vivas.length, recebidas: recebidas.length, pendentes: pend.length,
    em_atraso: pend.filter(p => ymd(p.data_prevista) < hoje).length,
    proxima: prox ? { numero: prox.numero_parcela, data: ymd(prox.data_prevista), valor: cent(prox.valor) } : null,
    ultima_data: pend.length ? ymd(pend[pend.length - 1].data_prevista) : null,
    valor_mensal: prox ? cent(prox.valor) : 0,
    por_mes,
    passadas: recebidas.map(p => {
      const previsto = cent(p.valor_previsto ?? p.valor)
      return { numero: p.numero_parcela, data: ymd(p.data_recebimento || p.data_prevista), valor: cent(p.valor), previsto, correcao: cent(Number(p.valor) - previsto) }
    }),
    proximas: pend.map(p => ({ numero: p.numero_parcela, data: ymd(p.data_prevista), valor: cent(p.valor), atrasada: ymd(p.data_prevista) < hoje })),
    total_recebido: cent(recebidas.reduce((s, p) => s + Number(p.valor), 0)),
    total_a_receber: cent(pend.reduce((s, p) => s + Number(p.valor), 0)),
  }
}

export { cent }
