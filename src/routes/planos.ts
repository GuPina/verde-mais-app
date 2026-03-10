/**
 * VerdeMais — Definições e middleware de planos
 *
 * FREE     → grátis, para sempre, funcionalidades essenciais com limites
 * PREMIUM  → R$19/mês, tudo do free sem limites + score + IA + relatórios
 * PRO      → R$49/mês, tudo do premium + projeções avançadas + API
 */

export type Plano = 'free' | 'premium' | 'pro'

// ─── Limites por plano ────────────────────────────────────────────────────────
export const LIMITES: Record<Plano, {
  // Contagens máximas (Infinity = sem limite)
  metas: number
  cartoes: number
  lembretes: number
  investimentos: number
  emprestimos: number
  financiamentos: number
  despesas_mes: number   // despesas por mês
  receitas_mes: number   // receitas por mês
  // Funcionalidades booleanas
  score_saude: boolean
  ia_insights: boolean
  relatorio_anual: boolean
  simulacao: boolean
  exportar_pdf: boolean
  reserva_emergencia: boolean
  conquistas: boolean
  cartao_compras: boolean   // lançamentos em cartão
  amortizacao: boolean      // amortização extraordinária
  api_acesso: boolean       // acesso à API externa
}> = {
  free: {
    metas:              3,
    cartoes:            2,
    lembretes:          5,
    investimentos:      3,
    emprestimos:        2,
    financiamentos:     1,
    despesas_mes:       30,
    receitas_mes:       10,
    score_saude:        false,
    ia_insights:        false,
    relatorio_anual:    false,
    simulacao:          false,
    exportar_pdf:       false,
    reserva_emergencia: true,
    conquistas:         true,
    cartao_compras:     true,
    amortizacao:        false,
    api_acesso:         false,
  },
  premium: {
    metas:              Infinity,
    cartoes:            10,
    lembretes:          Infinity,
    investimentos:      Infinity,
    emprestimos:        Infinity,
    financiamentos:     Infinity,
    despesas_mes:       Infinity,
    receitas_mes:       Infinity,
    score_saude:        true,
    ia_insights:        true,
    relatorio_anual:    true,
    simulacao:          true,
    exportar_pdf:       true,
    reserva_emergencia: true,
    conquistas:         true,
    cartao_compras:     true,
    amortizacao:        true,
    api_acesso:         false,
  },
  pro: {
    metas:              Infinity,
    cartoes:            Infinity,
    lembretes:          Infinity,
    investimentos:      Infinity,
    emprestimos:        Infinity,
    financiamentos:     Infinity,
    despesas_mes:       Infinity,
    receitas_mes:       Infinity,
    score_saude:        true,
    ia_insights:        true,
    relatorio_anual:    true,
    simulacao:          true,
    exportar_pdf:       true,
    reserva_emergencia: true,
    conquistas:         true,
    cartao_compras:     true,
    amortizacao:        true,
    api_acesso:         true,
  },
}

// ─── Helper: retorna limites do plano do usuário ──────────────────────────────
export function getLimites(plano: string) {
  return LIMITES[(plano as Plano)] ?? LIMITES.free
}

// ─── Helper: checa se feature está disponível ────────────────────────────────
export function podeUsar(plano: string, feature: keyof typeof LIMITES.free): boolean {
  const lim = getLimites(plano)
  const val = lim[feature]
  if (typeof val === 'boolean') return val
  return (val as number) > 0
}

// ─── Mensagens de upgrade ────────────────────────────────────────────────────
export const MSG_UPGRADE: Record<string, string> = {
  metas:              'O plano Free permite até 3 metas. Faça upgrade para o Premium e tenha metas ilimitadas.',
  cartoes:            'O plano Free permite até 2 cartões. Faça upgrade para o Premium.',
  lembretes:          'O plano Free permite até 5 lembretes. Faça upgrade para o Premium.',
  investimentos:      'O plano Free permite até 3 investimentos. Faça upgrade para o Premium.',
  emprestimos:        'O plano Free permite até 2 empréstimos. Faça upgrade para o Premium.',
  financiamentos:     'O plano Free permite apenas 1 financiamento. Faça upgrade para o Premium.',
  despesas_mes:       'Você atingiu o limite de 30 despesas por mês do plano Free. Faça upgrade para o Premium.',
  receitas_mes:       'Você atingiu o limite de 10 receitas por mês do plano Free. Faça upgrade para o Premium.',
  score_saude:        'O Score de Saúde Financeira está disponível no plano Premium.',
  ia_insights:        'A análise por IA está disponível no plano Premium.',
  relatorio_anual:    'Relatórios anuais estão disponíveis no plano Premium.',
  simulacao:          'A simulação de investimentos está disponível no plano Premium.',
  exportar_pdf:       'Exportação em PDF está disponível no plano Premium.',
  amortizacao:        'A amortização extraordinária está disponível no plano Premium.',
  api_acesso:         'Acesso à API está disponível no plano Pro.',
}
