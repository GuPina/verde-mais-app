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
