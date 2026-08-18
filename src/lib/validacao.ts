/**
 * VerdeMais — validação de data
 * ============================================================================
 * Os filtros por mês do app recortam a string da data por posição
 * (`substr(data,6,2)` para o mês, `substr(data,1,4)` para o ano). Isso só
 * funciona no formato ISO `YYYY-MM-DD`.
 *
 * A API aceitava qualquer texto. Uma receita gravada com `31/12/2026` entrava
 * com HTTP 201 e virava um registro fantasma: o recorte lia `2/2` como mês e
 * `31/1` como ano, então ela não aparecia em nenhuma tela, em nenhum mês —
 * existia no banco e era invisível para o dono.
 *
 * A interface sempre manda ISO (`<input type="date">`), então isto protege
 * quem chama a API direto e importações mal formatadas.
 */

/** `true` se for uma data ISO real — rejeita `2026-02-31` e `2026-13-01`. */
export function ehDataISO(valor: unknown): boolean {
  if (typeof valor !== 'string') return false
  if (!/^\d{4}-\d{2}-\d{2}$/.test(valor)) return false
  const [ano, mes, dia] = valor.split('-').map(Number)
  if (mes < 1 || mes > 12 || dia < 1) return false
  // Dia 0 do mês seguinte = último dia deste mês. Pega ano bissexto de graça.
  const ultimoDia = new Date(Date.UTC(ano, mes, 0)).getUTCDate()
  return dia <= ultimoDia
}

/**
 * Devolve a data em ISO, ou `null` se não der para aproveitar.
 *
 * Aceita também `DD/MM/YYYY` — formato que brasileiro digita sem pensar e que
 * é inequívoco aqui — convertendo em vez de recusar. Qualquer outra coisa é
 * recusada, porque adivinhar gera o registro fantasma descrito acima.
 */
export function normalizarData(valor: unknown): string | null {
  if (typeof valor !== 'string') return null
  const limpo = valor.trim()
  if (ehDataISO(limpo)) return limpo

  const br = limpo.match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  if (br) {
    const iso = `${br[3]}-${br[2]}-${br[1]}`
    return ehDataISO(iso) ? iso : null
  }

  // `2026-08-17T12:00:00.000Z` e variantes com hora: fica só a parte da data.
  const comHora = limpo.match(/^(\d{4}-\d{2}-\d{2})[T ]/)
  if (comHora && ehDataISO(comHora[1])) return comHora[1]

  return null
}

/** Mensagem única, para o erro sair igual em toda rota. */
export const ERRO_DATA = 'Data inválida. Use o formato AAAA-MM-DD (ex.: 2026-08-17).'
