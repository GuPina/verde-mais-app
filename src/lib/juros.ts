/**
 * VerdeMais — quanto custou parcelar
 * ============================================================================
 * Uma conta de R$ 5.000 parcelada em 12x de R$ 473,33 custa R$ 5.680. Lançada
 * pelo valor da fatura, ela aparece como R$ 5.680 de "Moradia" — e os R$ 680
 * de juros somem dentro da categoria. Aqui eles voltam a ser visíveis.
 *
 * Com o valor à vista e as parcelas, a taxa sai da equação de valor presente
 * (a mesma da tabela PRICE). Cada parcela carrega a sua parte de juros pela
 * amortização: mais juros no começo, menos no fim — como o banco cobra. A
 * soma das partes fecha exatamente com o total; o último centavo vai para a
 * última parcela.
 */

const cent = (v: number) => Math.round((Number(v) || 0) * 100) / 100

/** Valor presente das parcelas a uma taxa mensal `i`. */
function vp(pmts: number[], i: number) {
  let s = 0
  for (let k = 0; k < pmts.length; k++) s += pmts[k] / Math.pow(1 + i, k + 1)
  return s
}

/** A taxa mensal que iguala as parcelas ao valor à vista (bisseção; 0 a 50% a.m.). */
export function taxaMensal(aVista: number, pmts: number[]): number {
  const total = pmts.reduce((s, v) => s + v, 0)
  if (!(aVista > 0) || !pmts.length || total <= aVista + 0.005) return 0
  let lo = 0, hi = 0.5
  for (let it = 0; it < 200; it++) {
    const mid = (lo + hi) / 2
    if (vp(pmts, mid) > aVista) lo = mid; else hi = mid
  }
  return (lo + hi) / 2
}

export interface Separacao {
  a_vista: number
  total: number
  juros_total: number
  taxa_mensal: number   // em %
  taxa_anual: number    // em %
  /** Juros dentro de cada parcela, na ordem. */
  juros: number[]
}

export function separarJuros(aVista: number, pmts: number[]): Separacao | null {
  const pv = Number(aVista)
  if (!(pv > 0) || !pmts.length || pmts.some(v => !(Number(v) > 0))) return null
  const total = cent(pmts.reduce((s, v) => s + Number(v), 0))
  const jurosTotal = cent(Math.max(0, total - pv))
  const i = taxaMensal(pv, pmts)
  const juros: number[] = []
  let saldo = pv, acumulado = 0
  for (let k = 0; k < pmts.length; k++) {
    if (k === pmts.length - 1) { juros.push(cent(jurosTotal - acumulado)); break }
    const j = cent(Math.min(pmts[k], Math.max(0, saldo * i)))
    juros.push(j); acumulado = cent(acumulado + j)
    saldo = saldo + j - pmts[k]
  }
  return {
    a_vista: cent(pv), total, juros_total: jurosTotal,
    taxa_mensal: Math.round(i * 100 * 100) / 100,
    taxa_anual: Math.round((Math.pow(1 + i, 12) - 1) * 100 * 100) / 100,
    juros,
  }
}

/**
 * Parcelar ou tirar da reserva? Com a reserva rendendo `rendMensal` (fração),
 * simula as duas estradas até a última parcela: pagando à vista, a reserva
 * perde o valor hoje; parcelando, ela fica rendendo e paga as parcelas mês a
 * mês. A diferença no fim é quanto uma estrada deixa a mais que a outra.
 */
export function compararComReserva(aVista: number, pmts: number[], rendMensal: number) {
  const r = Math.max(0, Number(rendMensal) || 0)
  let parcelando = Number(aVista)              // o dinheiro que fica na reserva
  for (const p of pmts) parcelando = parcelando * (1 + r) - p
  const diferenca = cent(parcelando)            // > 0: parcelar deixou dinheiro sobrando
  return {
    rendimento_mensal: Math.round(r * 10000) / 100,
    sobra_parcelando: diferenca,
    melhor: Math.abs(diferenca) < 1 ? 'empate' as const : diferenca > 0 ? 'parcelar' as const : 'reserva' as const,
    economia: cent(Math.abs(diferenca)),
  }
}

/** CDI anual (%) a partir da taxa diária do BCB (% ao dia), 252 dias úteis. */
export const cdiAnualDeDiaria = (t: number) => (Math.pow(1 + t / 100, 252) - 1) * 100
export const mensalDeAnual = (a: number) => Math.pow(1 + a / 100, 1 / 12) - 1
