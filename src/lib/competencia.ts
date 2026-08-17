/**
 * VerdeMais — regra única de competência de despesa
 * ============================================================================
 * Antes desta camada o app tinha TRÊS regras diferentes para responder
 * "quanto eu gastei neste mês", escritas à mão em módulos diferentes:
 *
 *   A) `despesas.ts`, score de saúde e assistente  → sempre por `data`
 *   B) `dashboard.ts`                              → `data` se paga, senão
 *                                                    `vencimento`; sem aportes
 *   C) `relatorio.ts`, `comparativo.ts`, insights  → sempre por `vencimento`;
 *                                                    com aportes
 *
 * Medido em produção, na mesma conta e no mesmo instante, agosto/2026:
 * R$ 5.838,60 (A) · R$ 9.338,60 (B) · R$ 10.838,60 (C). Três telas, três
 * respostas para o mesmo dinheiro.
 *
 * A regra escolhida é a (B), a de fluxo de caixa:
 *
 *   • despesa PAGA      → conta no mês em que o dinheiro saiu (`data`)
 *   • despesa PENDENTE  → conta no mês em que vai vencer (`vencimento`,
 *                         caindo para `data` quando não houver vencimento)
 *   • APORTE            → não é gasto, é transferência de patrimônio. Fica
 *                         fora de toda soma de despesa e aparece na tela
 *                         própria de Aportes.
 *
 * Todo módulo que soma despesa usa as funções daqui. Nenhum monta o filtro à
 * mão — foi assim que as três regras nasceram.
 */

const pref = (alias: string) => (alias ? `${alias}.` : '')

/**
 * A data de competência em si ('YYYY-MM-DD'). Útil em consultas por intervalo
 * (`BETWEEN`) e em `GROUP BY`, onde mês e ano separados não bastam.
 */
export function competenciaData(alias = ''): string {
  const c = pref(alias)
  return `CASE WHEN ${c}status = 'pago'
               THEN ${c}data
               ELSE COALESCE(${c}vencimento, ${c}data) END`
}

/** Mês de competência ('01'–'12') como expressão SQL. */
export function competenciaMes(alias = ''): string {
  const c = pref(alias)
  return `CASE WHEN ${c}status = 'pago'
               THEN strftime('%m', ${c}data)
               ELSE strftime('%m', COALESCE(${c}vencimento, ${c}data)) END`
}

/** Ano de competência ('YYYY') como expressão SQL. */
export function competenciaAno(alias = ''): string {
  const c = pref(alias)
  return `CASE WHEN ${c}status = 'pago'
               THEN strftime('%Y', ${c}data)
               ELSE strftime('%Y', COALESCE(${c}vencimento, ${c}data)) END`
}

/**
 * Filtro de mês+ano. Consome DOIS placeholders, nesta ordem: mês, ano.
 * O mês precisa vir com dois dígitos ('08', não '8') — use `mesDoisDigitos`.
 */
export function filtroCompetencia(alias = ''): string {
  return `(${competenciaMes(alias)}) = ? AND (${competenciaAno(alias)}) = ?`
}

/** Filtro só de ano. Consome UM placeholder. */
export function filtroCompetenciaAno(alias = ''): string {
  return `(${competenciaAno(alias)}) = ?`
}

/**
 * Exclui aportes patrimoniais da soma de despesa.
 *
 * Um aporte é dinheiro que sai da conta corrente e vira investimento — o
 * patrimônio não diminuiu, mudou de lugar. Contá-lo como gasto faz quem
 * investe parecer gastador e derruba o score de quem está indo bem.
 */
export function filtroSemAporte(alias = ''): string {
  const c = pref(alias)
  return `COALESCE(${c}tipo,'normal') != 'aporte' AND COALESCE(${c}eh_aporte_patrimonial, 0) = 0`
}

/** O complemento: só os aportes. Usado pela tela de Aportes. */
export function filtroApenasAporte(alias = ''): string {
  const c = pref(alias)
  return `(COALESCE(${c}tipo,'normal') = 'aporte' OR COALESCE(${c}eh_aporte_patrimonial, 0) = 1)`
}

/** Despesa cancelada não é gasto. */
export function filtroNaoCancelada(alias = ''): string {
  return `${pref(alias)}status != 'cancelado'`
}

/**
 * O bloco completo que quase toda soma de despesa quer: não cancelada, não
 * aporte, no mês de competência. Já vem com o `AND` inicial.
 * Consome DOIS placeholders: mês, ano.
 */
export function filtroDespesaDoMes(alias = ''): string {
  return ` AND ${filtroNaoCancelada(alias)}
           AND ${filtroSemAporte(alias)}
           AND ${filtroCompetencia(alias)}`
}

/** Mesma coisa, o ano inteiro. Consome UM placeholder: ano. */
export function filtroDespesaDoAno(alias = ''): string {
  return ` AND ${filtroNaoCancelada(alias)}
           AND ${filtroSemAporte(alias)}
           AND ${filtroCompetenciaAno(alias)}`
}

/** '8' → '08'. O filtro compara string com string. */
export function mesDoisDigitos(mes: string | number): string {
  return String(mes).padStart(2, '0')
}
