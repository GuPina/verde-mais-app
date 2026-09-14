/**
 * VerdeMais — regra única de fatura de cartão
 * ============================================================================
 * O ciclo do cartão tem duas datas e as duas confundem: a compra entra na
 * fatura que ainda não fechou, e essa fatura vence depois. Errar isso não dá
 * erro nenhum — a despesa só aparece no mês errado, e o usuário descobre
 * quando a conta não bate.
 *
 * Era exatamente o que estava acontecendo: `cartoes.ts` tinha as funções
 * certas e `despesas.ts` tinha o mesmo algoritmo redigitado à mão, sem o
 * clamp do dia de fechamento. Um cartão que fecha dia 31 em mês de 30 dias
 * nunca fechava pela cópia — `dia >= 31` não acontece em abril —, e todas as
 * compras do mês caíam na fatura anterior à correta.
 *
 * Daqui em diante existe uma implementação só.
 */

/** Último dia do mês (1-12). */
function ultimoDia(ano: number, mes: number): number {
  return new Date(ano, mes, 0).getDate()
}

/**
 * A fatura em que a compra entra.
 *
 * Compra ANTES do fechamento entra na fatura que fecha neste mês; compra NO
 * dia do fechamento ou depois já é da próxima. O dia de fechamento é limitado
 * ao tamanho do mês: em cartão que fecha dia 31, fevereiro fecha dia 28.
 */
export function periodoFatura(dataCompra: string, diaFechamento: number): { mes: number; ano: number } {
  const d = new Date(dataCompra + 'T12:00:00')
  let mes = d.getMonth() + 1
  let ano = d.getFullYear()
  const fechamento = Math.min(
    Math.max(1, Number(diaFechamento) || 1),
    ultimoDia(ano, mes),
  )
  if (d.getDate() >= fechamento) {
    mes++
    if (mes > 12) { mes = 1; ano++ }
  }
  return { mes, ano }
}

/**
 * O vencimento da fatura.
 *
 * O vencimento vem sempre depois do fechamento. Quando o dia de vencimento é
 * menor ou igual ao de fechamento (fecha dia 25, vence dia 5), ele só pode
 * cair no mês seguinte ao da fatura.
 */
export function vencimentoFatura(
  mesFatura: number, anoFatura: number, diaVencimento: number, diaFechamento: number,
): string {
  let mes = mesFatura
  let ano = anoFatura
  if (Number(diaVencimento) <= Number(diaFechamento)) {
    mes++
    if (mes > 12) { mes = 1; ano++ }
  }
  const dia = Math.min(Math.max(1, Number(diaVencimento) || 1), ultimoDia(ano, mes))
  return `${ano}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`
}

/**
 * Tudo que um lançamento de cartão precisa saber, de uma vez: em que fatura
 * entra e quando ela vence. Quem grava despesa chama isto e não recalcula
 * nada por conta própria.
 */
export function faturaDaCompra(
  dataCompra: string, diaFechamento: number, diaVencimento: number,
): { mes: number; ano: number; vencimento: string } {
  const { mes, ano } = periodoFatura(dataCompra, diaFechamento)
  return { mes, ano, vencimento: vencimentoFatura(mes, ano, diaVencimento, diaFechamento) }
}

/**
 * Soma meses a uma data preservando o dia — travando no último dia do mês
 * quando o destino é mais curto.
 *
 * `d.setMonth(d.getMonth() + n)` é a forma óbvia e está errada para todo dia
 * 29, 30 ou 31. O JavaScript não trunca: ele transborda. 31/08 + 1 mês vira
 * 31/09, que não existe, e o motor "conserta" para 01/10.
 *
 * Numa compra parcelada isso é destrutivo. Comprando em 31/08 em 6x, as
 * parcelas caíam em:
 *
 *     ago · out · out · dez · dez · jan
 *
 * Setembro e novembro simplesmente não recebiam parcela, outubro e dezembro
 * recebiam duas, e a fatura de cada uma era calculada a partir dessa data
 * errada. É o "a primeira mensalidade não aparece em setembro".
 *
 * Com o clamp: ago · set · out · nov · dez · jan. Um mês curto no meio
 * (fevereiro) puxa a parcela para o dia 28, e as seguintes voltam ao dia
 * original — que é como qualquer banco faz.
 */
export function somarMeses(dataISO: string, meses: number): string {
  const base = new Date(dataISO + 'T12:00:00')
  const diaOriginal = base.getDate()
  const alvo = new Date(base.getFullYear(), base.getMonth() + meses, 1, 12, 0, 0)
  const ultimo = new Date(alvo.getFullYear(), alvo.getMonth() + 1, 0).getDate()
  alvo.setDate(Math.min(diaOriginal, ultimo))
  const a = alvo.getFullYear()
  const m = String(alvo.getMonth() + 1).padStart(2, '0')
  const d = String(alvo.getDate()).padStart(2, '0')
  return `${a}-${m}-${d}`
}

/**
 * A fatura da parcela N de uma compra parcelada.
 *
 * ── O DEFEITO QUE ISTO CORRIGE ──────────────────────────────────────────────
 *
 * Todos os geradores de parcela do app faziam a mesma coisa:
 *
 *     faturaDaCompra(somarMeses(dataCompra, i), fechamento, vencimento)
 *
 * — ou seja, cada parcela recalculava a PRÓPRIA fatura, do zero, a partir da
 * própria data. Parece equivalente a "uma parcela por fatura" e não é, porque
 * as duas funções envolvidas fazem clamp em momentos diferentes:
 *
 *   • somarMeses trava a DATA no último dia do mês curto (28/01 + 1 = 28/02),
 *   • periodoFatura trava o DIA DE FECHAMENTO no último dia daquele mês.
 *
 * Quando os dois clamps se cruzam, duas parcelas consecutivas caem na mesma
 * fatura — e o mês seguinte fica sem parcela nenhuma. Exemplo real, varrido
 * sobre todas as combinações de dia de compra × dia de fechamento:
 *
 *     compra 28/01/2025, cartão fecha dia 29
 *     parcela 14 → 28/02/2026 · fechamento travado em 28 · 28 >= 28 → mar/2026
 *     parcela 15 → 28/03/2026 · fechamento 29        · 28 <  29 → mar/2026
 *
 * Duas parcelas em março, zero em abril. Na tela: "tenho duas compras iguais
 * no mesmo mês". Acontece em faturas de março, maio, julho, outubro e
 * dezembro — sempre o mês seguinte a um mês curto.
 *
 * ── A REGRA CERTA ───────────────────────────────────────────────────────────
 *
 * Uma compra em 12x aparece em 12 faturas CONSECUTIVAS. Sempre. É assim em
 * qualquer banco, e é o que o usuário espera: parcela 1 na fatura X, parcela 2
 * na X+1, sem exceção.
 *
 * Então a fatura da parcela não se recalcula: ela se conta. A compra define a
 * primeira fatura; a parcela N entra N meses depois daquela. O clamp de data
 * continua existindo para a data da parcela — que é informação real e vai para
 * `card_charges.data_compra` —, mas deixou de mandar na fatura.
 *
 * Isto também imuniza a série contra uma mudança no ciclo do cartão: se o dia
 * de fechamento muda no meio de um parcelamento, as parcelas continuam uma por
 * fatura, em vez de se empilharem na emenda entre o ciclo velho e o novo.
 */
export function faturaDaParcela(
  dataCompra: string, diaFechamento: number, diaVencimento: number, indice: number,
): { mes: number; ano: number; vencimento: string; data_parcela: string } {
  const base = periodoFatura(dataCompra, diaFechamento)

  let mes = base.mes + Math.max(0, Math.trunc(Number(indice) || 0))
  let ano = base.ano + Math.floor((mes - 1) / 12)
  mes = ((mes - 1) % 12) + 1

  return {
    mes, ano,
    vencimento: vencimentoFatura(mes, ano, diaVencimento, diaFechamento),
    // A data da parcela continua sendo a data real deslocada, com clamp: é ela
    // que o extrato mostra e que o usuário reconhece.
    data_parcela: somarMeses(dataCompra, Math.max(0, Math.trunc(Number(indice) || 0))),
  }
}
