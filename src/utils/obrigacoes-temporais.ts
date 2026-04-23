/**
 * obrigacoes-temporais.ts — VerdeMais
 *
 * Classifica empréstimos e financiamentos em ATIVAS vs FUTURAS
 * com base em data_inicio vs data atual.
 *
 * REGRA: data_inicio <= hoje  → ATIVA  (impacta caixa, score, comprometimento)
 *        data_inicio >  hoje  → FUTURA (planejamento apenas, NÃO impacta caixa)
 */

export interface ObrigacaoTemporal {
  id: number
  tipo: 'emprestimo' | 'financiamento'
  descricao: string
  saldo_devedor: number
  valor_parcela: number
  taxa_juros_anual: number
  data_inicio: string
  data_previsao_fim?: string
  status_temporal: 'ATIVA' | 'FUTURA'
  meses_para_inicio?: number     // preenchido apenas se FUTURA
}

export interface ClassificacaoObrigacoes {
  ativas: ObrigacaoTemporal[]
  futuras: ObrigacaoTemporal[]
  resumo: {
    total_saldo_ativo: number
    total_parcelas_ativas: number          // comprometimento real de caixa hoje
    total_saldo_futuro: number
    total_parcelas_futuras: number         // comprometimento futuro planejado
    comprometimento_pct_atual: number      // % sobre a receita informada
    comprometimento_pct_futuro: number
    taxa_max_ativa: number
    tem_obrigacoes_futuras: boolean
  }
}

/**
 * Classifica as obrigações de um usuário em ativas e futuras.
 *
 * @param db           Instância D1Database
 * @param userId       ID do usuário
 * @param receitaMensal Receita do mês (para cálculo de %)
 */
export async function classificarObrigacoesTemporais(
  db: D1Database,
  userId: number,
  receitaMensal: number
): Promise<ClassificacaoObrigacoes> {

  const hoje = new Date()
  // Normalizar para início do dia, sem fuso (ISO date only)
  const hojeStr = hoje.toISOString().split('T')[0]

  // Buscar empréstimos e financiamentos ativos
  const [empsR, finsR] = await db.batch([
    db.prepare(
      `SELECT id, descricao, saldo_devedor, valor_parcela,
              taxa_juros_anual, data_inicio, data_previsao_fim
       FROM emprestimos
       WHERE user_id = ? AND status = 'ativo'`
    ).bind(userId),
    db.prepare(
      `SELECT id, descricao, saldo_devedor, valor_parcela,
              taxa_juros_anual, data_inicio, data_previsao_fim
       FROM financiamentos
       WHERE user_id = ? AND status = 'ativo'`
    ).bind(userId),
  ])

  const emps = (empsR.results || []) as any[]
  const fins = (finsR.results || []) as any[]

  const todas: ObrigacaoTemporal[] = []

  for (const e of emps) {
    const dataInicio = e.data_inicio ? e.data_inicio.split('T')[0] : hojeStr
    const isAtiva = dataInicio <= hojeStr
    const mesesParaInicio = isAtiva ? 0 : calcularMeses(hoje, new Date(dataInicio + 'T12:00:00'))
    todas.push({
      id: e.id,
      tipo: 'emprestimo',
      descricao: e.descricao,
      saldo_devedor: Number(e.saldo_devedor || 0),
      valor_parcela: Number(e.valor_parcela || 0),
      taxa_juros_anual: Number(e.taxa_juros_anual || 0),
      data_inicio: dataInicio,
      data_previsao_fim: e.data_previsao_fim,
      status_temporal: isAtiva ? 'ATIVA' : 'FUTURA',
      meses_para_inicio: isAtiva ? undefined : mesesParaInicio,
    })
  }

  for (const f of fins) {
    const dataInicio = f.data_inicio ? f.data_inicio.split('T')[0] : hojeStr
    const isAtiva = dataInicio <= hojeStr
    const mesesParaInicio = isAtiva ? 0 : calcularMeses(hoje, new Date(dataInicio + 'T12:00:00'))
    todas.push({
      id: f.id,
      tipo: 'financiamento',
      descricao: f.descricao,
      saldo_devedor: Number(f.saldo_devedor || 0),
      valor_parcela: Number(f.valor_parcela || 0),
      taxa_juros_anual: Number(f.taxa_juros_anual || 0),
      data_inicio: dataInicio,
      data_previsao_fim: f.data_previsao_fim,
      status_temporal: isAtiva ? 'ATIVA' : 'FUTURA',
      meses_para_inicio: isAtiva ? undefined : mesesParaInicio,
    })
  }

  const ativas  = todas.filter(o => o.status_temporal === 'ATIVA')
  const futuras = todas.filter(o => o.status_temporal === 'FUTURA')

  const totalSaldoAtivo    = r2(ativas.reduce((s, o)  => s + o.saldo_devedor,  0))
  const totalParcelasAtivas= r2(ativas.reduce((s, o)  => s + o.valor_parcela,  0))
  const totalSaldoFuturo   = r2(futuras.reduce((s, o) => s + o.saldo_devedor,  0))
  const totalParcelasFuturas=r2(futuras.reduce((s, o) => s + o.valor_parcela,  0))
  const taxaMaxAtiva       = ativas.length > 0 ? Math.max(...ativas.map(o => o.taxa_juros_anual)) : 0

  return {
    ativas,
    futuras,
    resumo: {
      total_saldo_ativo:            totalSaldoAtivo,
      total_parcelas_ativas:        totalParcelasAtivas,
      total_saldo_futuro:           totalSaldoFuturo,
      total_parcelas_futuras:       totalParcelasFuturas,
      comprometimento_pct_atual:    receitaMensal > 0 ? r2((totalParcelasAtivas / receitaMensal) * 100) : 0,
      comprometimento_pct_futuro:   receitaMensal > 0 ? r2((totalParcelasFuturas / receitaMensal) * 100) : 0,
      taxa_max_ativa:               r2(taxaMaxAtiva),
      tem_obrigacoes_futuras:       futuras.length > 0,
    }
  }
}

// ── helpers ──────────────────────────────────────────────────────────────────

function r2(v: number): number {
  return Math.round(v * 100) / 100
}

function calcularMeses(de: Date, ate: Date): number {
  const diff = (ate.getFullYear() - de.getFullYear()) * 12 + (ate.getMonth() - de.getMonth())
  return Math.max(0, diff)
}

/**
 * Calcula a economia gerada ao amortizar um valor extra numa dívida ativa.
 * Usa tabela Price para ser conservador.
 */
export function calcularEconomiaAmortizacao(
  saldoDevedor: number,
  parcelaMensal: number,
  taxaAnual: number,
  valorAmortizacao: number
): { economia: number; taxaRetorno: number; mesesEconomizados: number } {

  if (saldoDevedor <= 0 || parcelaMensal <= 0 || taxaAnual <= 0) {
    return { economia: 0, taxaRetorno: 0, mesesEconomizados: 0 }
  }

  const taxaMensal = taxaAnual / 100 / 12
  const jurosSem  = calcularJurosRestantes(saldoDevedor, parcelaMensal, taxaMensal)
  const novoSaldo = Math.max(0, saldoDevedor - valorAmortizacao)
  const jurosCom  = calcularJurosRestantes(novoSaldo, parcelaMensal, taxaMensal)
  const economia  = r2(jurosSem - jurosCom)

  const parcelasSem = calcularNumeroParcelas(saldoDevedor,  parcelaMensal, taxaMensal)
  const parcelasCom = calcularNumeroParcelas(novoSaldo, parcelaMensal, taxaMensal)
  const mesesEconomizados = Math.max(0, parcelasSem - parcelasCom)

  const taxaRetorno = valorAmortizacao > 0 ? r2((economia / valorAmortizacao) * 100) : 0

  return { economia, taxaRetorno, mesesEconomizados }
}

function calcularJurosRestantes(saldo: number, parcela: number, taxaMensal: number): number {
  let s = saldo
  let juros = 0
  let maxIter = 600 // segurança
  while (s > 0.01 && maxIter-- > 0) {
    const j = s * taxaMensal
    juros += j
    s = s - (parcela - j)
    if (s < 0) s = 0
  }
  return r2(juros)
}

function calcularNumeroParcelas(saldo: number, parcela: number, taxaMensal: number): number {
  if (saldo <= 0) return 0
  if (taxaMensal === 0) return Math.ceil(saldo / parcela)
  // Fórmula inversa Price
  return Math.ceil(
    Math.log(parcela / (parcela - saldo * taxaMensal)) /
    Math.log(1 + taxaMensal)
  )
}
