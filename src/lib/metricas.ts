/**
 * VerdeMais — métricas: uma conta, um dono
 * ============================================================================
 * Auditoria de 14/09/2026, a mesma conta, no mesmo minuto:
 *
 *   pergunta                  Dashboard   360°      50/30/20   Projeção
 *   ─────────────────────────────────────────────────────────────────────
 *   Quanto você ganha/mês     5.440       5.440     5.440      7.880
 *   Quanto você deve          224.798     224.798   —          —
 *   Comprometimento da renda  —           87,7%     —          61,7%
 *   Score de saúde            15          17        50         —
 *
 * Três notas para a mesma pessoa, no mesmo dia. Não é bug de uma tela: é o
 * efeito de cada rota ir direto ao banco e inventar a sua própria definição de
 * renda, de dívida e de mês. Quando três telas discordam, o usuário não escolhe
 * uma — ele para de acreditar em todas.
 *
 * Este arquivo é o contrato. Cada número tem UMA definição, escrita uma vez,
 * e nenhuma tela tem permissão de somar isso por conta própria. É o mesmo
 * caminho que src/lib/limite-cartao.ts já abriu para o limite do cartão.
 *
 * As três decisões que mais mudam resultado, e o porquê:
 *
 *   1. MÊS FECHADO. Nada aqui olha o mês em curso. No dia 14 a receita ainda
 *      não caiu inteira e as parcelas do mês já estão todas lançadas — contar
 *      isso faz o app declarar crise todo dia 14 e desmentir-se no dia 30.
 *
 *   2. VÍNCULO, NÃO CATEGORIA. A parcela de um contrato é achada pelo carimbo
 *      que o próprio sistema pôs na despesa, nunca pelo nome da categoria.
 *      Filtrar por categoria 'Financiamento' pega "PgConta VICTOR" e uma
 *      cobrança avulsa da Caixa — R$ 1.623,75 de prestação que não existe.
 *
 *   3. ESTOQUE ≠ FLUXO. O saldo do cartão é dívida (balanço). A parcela do mês
 *      é prestação (comprometimento). Somar o saldo no comprometimento foi o
 *      que produziu os 87,7%.
 */

import { competenciaData, filtroNaoCancelada, filtroSemAporte } from './competencia'

const cent = (v: number) => Math.round((Number(v) || 0) * 100) / 100

// ─── Janela de meses fechados ────────────────────────────────────────────────

export interface MesFechado {
  mes: number
  ano: number
  label: string
  receitas: number
  despesas: number
  saldo: number
  /** Parcela ou recorrência: já está contratado, não é hábito. */
  despesas_deterministicas: number
  /** Mercado, lazer, imprevisto: a parte que responde a decisão. */
  despesas_variaveis: number
}

const MESES = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez']

/** Mediana — resistente a um mês fora da curva, ao contrário da média. */
function mediana(arr: number[]): number {
  if (!arr.length) return 0
  const o = [...arr].sort((a, b) => a - b)
  const m = Math.floor(o.length / 2)
  return o.length % 2 ? o[m] : (o[m - 1] + o[m]) / 2
}

/** Desvio absoluto mediano: a régua de "normal" tirada do próprio usuário. */
function mad(arr: number[]): number {
  if (!arr.length) return 0
  const med = mediana(arr)
  return mediana(arr.map(v => Math.abs(v - med)))
}

export interface JanelaHistorica {
  meses: MesFechado[]          // meses fechados com os dois lados lançados
  base: MesFechado[]           // os mesmos, sem os atípicos
  atipicos: Array<{ label: string; receitas: number; despesas: number; motivo: string }>
  mes_corrente: string | null
}

/**
 * Lê os últimos `limite` meses FECHADOS e separa os atípicos.
 *
 * Um mês só serve de observação se tiver os dois lados lançados: mês com
 * despesa e receita zerada é mês sem dado, não mês ruim, e entrava na conta
 * como prejuízo integral.
 *
 * A régua do atípico sai do próprio usuário — 3 × MAD em vez de um
 * multiplicador fixo. Quem é assalariado ganha uma faixa estreita; quem vive de
 * comissão, uma larga. Ninguém configura nada.
 *
 * E ponto fora da curva não é mudança de patamar: se os três últimos meses
 * estão todos do mesmo lado da mediana, isso é o novo normal (um aumento, uma
 * troca de emprego) e nada é excluído — senão a projeção viveria no passado.
 */
export async function janelaHistorica(
  db: D1Database, userId: number, limite = 12,
): Promise<JanelaHistorica> {
  const hoje = new Date()
  const mesAtual = hoje.getMonth() + 1
  const anoAtual = hoje.getFullYear()

  const meses: MesFechado[] = []
  for (let i = limite; i >= 1; i--) {
    let m = mesAtual - i, a = anoAtual
    while (m <= 0) { m += 12; a -= 1 }
    const mesStr = String(m).padStart(2, '0')

    const rec = await db.prepare(
      `SELECT COALESCE(SUM(valor),0) as total FROM receitas
       WHERE user_id = ? AND strftime('%m', data) = ? AND strftime('%Y', data) = ?`
    ).bind(userId, mesStr, String(a)).first() as any

    const desp = await db.prepare(
      `SELECT COALESCE(SUM(valor),0) as total FROM despesas
       WHERE user_id = ? AND status IN ('pago','pendente') AND ${filtroSemAporte()}
         AND strftime('%m', ${competenciaData()}) = ?
         AND strftime('%Y', ${competenciaData()}) = ?`
    ).bind(userId, mesStr, String(a)).first() as any

    // Quanto DESTE total já é parcela ou recorrência. Sem separar, somar as
    // parcelas futuras à média histórica conta o mesmo dinheiro duas vezes.
    const det = await db.prepare(
      `SELECT COALESCE(SUM(valor),0) as total FROM despesas
       WHERE user_id = ? AND status IN ('pago','pendente') AND ${filtroSemAporte()}
         AND (parcelado = 1 OR COALESCE(numero_parcelas,1) > 1 OR recorrencia_id IS NOT NULL)
         AND strftime('%m', ${competenciaData()}) = ?
         AND strftime('%Y', ${competenciaData()}) = ?`
    ).bind(userId, mesStr, String(a)).first() as any

    const r = cent(rec?.total), d = cent(desp?.total), dd = cent(det?.total)
    meses.push({
      mes: m, ano: a, label: `${MESES[m - 1]}/${a}`,
      receitas: r, despesas: d, saldo: cent(r - d),
      despesas_deterministicas: dd,
      despesas_variaveis: cent(Math.max(0, d - dd)),
    })
  }

  const comDados = meses.filter(m => m.receitas > 0 && m.despesas > 0)

  // Patamar novo não é outlier: três últimos do mesmo lado = a vida mudou.
  const medRec = mediana(comDados.map(m => m.receitas))
  const ultimos3 = comDados.slice(-3)
  const mudouPatamar = ultimos3.length === 3 &&
    (ultimos3.every(m => m.receitas > medRec) || ultimos3.every(m => m.receitas < medRec))

  const madRec = mad(comDados.map(m => m.receitas))
  const madDesp = mad(comDados.map(m => m.despesas))
  const medDesp = mediana(comDados.map(m => m.despesas))

  const atipicos: JanelaHistorica['atipicos'] = []
  if (comDados.length >= 5 && !mudouPatamar) {
    for (const m of comDados) {
      let motivo: string | null = null
      if (madRec > 0 && Math.abs(m.receitas - medRec) > 3 * madRec) {
        motivo = m.receitas > medRec
          ? (m.mes === 12 || m.mes === 1 ? 'receita muito acima do normal — provável 13º' : 'receita muito acima do seu normal')
          : 'receita muito abaixo do normal — confira se o mês está todo lançado'
      } else if (madDesp > 0 && m.despesas - medDesp > 3 * madDesp) {
        motivo = 'despesa muito acima do seu normal — provável gasto pontual'
      }
      if (motivo) atipicos.push({ label: m.label, receitas: m.receitas, despesas: m.despesas, motivo })
    }
  }

  // Teto de 25%: se metade dos meses parece atípica, a pessoa tem renda
  // volátil — e o lugar de dizer isso é a confiança, não a exclusão.
  const teto = Math.floor(comDados.length * 0.25)
  const cortados = atipicos.slice(0, Math.max(0, teto)).map(a => a.label)
  const fora = new Set(cortados)
  const base = comDados.filter(m => !fora.has(m.label))

  return {
    meses: comDados,
    base: base.length >= 3 ? base : comDados,
    atipicos: atipicos.filter(a => fora.has(a.label)),
    mes_corrente: `${MESES[mesAtual - 1]}/${anoAtual}`,
  }
}

/** Peso linear: o mês mais recente vale 3× o mais antigo da janela. */
function pesos(n: number): number[] {
  return Array.from({ length: n }, (_, i) => (n > 1 ? 1 + (2 * i) / (n - 1) : 1))
}
function mediaPesada(vals: number[]): number {
  if (!vals.length) return 0
  const p = pesos(vals.length)
  const soma = p.reduce((a, b) => a + b, 0)
  return vals.reduce((acc, v, i) => acc + v * p[i], 0) / soma
}

// ─── 1. Renda ────────────────────────────────────────────────────────────────

export interface Renda {
  mensal: number
  media_lancada: number
  recorrente: number
  oscilacao: number
  meses_base: number
  meses_labels: string[]
}

export async function renda(db: D1Database, userId: number, janela: JanelaHistorica): Promise<Renda> {
  const rec = await db.prepare(
    `SELECT COALESCE(SUM(valor),0) as total FROM recorrencias
     WHERE user_id = ? AND ativa = 1 AND tipo = 'receita'
       AND (data_fim IS NULL OR data_fim > date('now'))`
  ).bind(userId).first() as any

  const vals = janela.base.map(m => m.receitas)
  const media = mediaPesada(vals)
  const saldos = janela.base.map(m => m.saldo)
  const mSaldo = mediaPesada(saldos)
  const p = pesos(saldos.length)
  const somaP = p.reduce((a, b) => a + b, 0) || 1
  const desvio = saldos.length
    ? Math.sqrt(saldos.reduce((acc, v, i) => acc + p[i] * Math.pow(v - mSaldo, 2), 0) / somaP)
    : 0

  return {
    mensal: cent(media + Number(rec?.total || 0)),
    media_lancada: cent(media),
    recorrente: cent(rec?.total),
    oscilacao: cent(desvio),
    meses_base: janela.base.length,
    meses_labels: janela.base.map(m => m.label),
  }
}

// ─── 2. Dívidas ──────────────────────────────────────────────────────────────

export interface Divida {
  tipo: 'cartao' | 'emprestimo' | 'financiamento' | 'entrada'
  id: number | null
  nome: string
  saldo: number
  parcela: number
  taxa_mensal: number
  vigente: boolean
  comeca_em: string | null
  parcelas_restantes: number | null
}

export interface Dividas {
  lista: Divida[]
  vigente: number
  contratada: number
  total: number
  cartoes: number
  emprestimos: number
  financiamentos: number
  entradas: number
}

/**
 * Um financiamento com `data_inicio` no futuro é dívida — a pessoa deve — mas
 * a prestação ainda não sai da conta. As duas coisas são verdade ao mesmo
 * tempo, e é por isso que `vigente` e `contratada` existem separados: o
 * balanço soma tudo, o comprometimento só olha o que já está saindo.
 */
export async function dividas(db: D1Database, userId: number): Promise<Dividas> {
  const hojeISO = new Date().toISOString().slice(0, 10)
  const lista: Divida[] = []

  const cartoes = await db.prepare(
    `SELECT c.id, c.nome,
            COALESCE((SELECT SUM(cc.valor) FROM card_charges cc
                      WHERE cc.card_id = c.id AND cc.status = 'pendente'), 0) as saldo
     FROM cartoes c WHERE c.user_id = ? AND c.ativo = 1`
  ).bind(userId).all()
  for (const r of ((cartoes.results as any[]) || [])) {
    if (cent(r.saldo) <= 0) continue
    lista.push({ tipo: 'cartao', id: Number(r.id), nome: String(r.nome), saldo: cent(r.saldo),
      parcela: 0, taxa_mensal: 0, vigente: true, comeca_em: null, parcelas_restantes: null })
  }

  const emps = await db.prepare(
    `SELECT id, descricao, saldo_devedor, valor_parcela, taxa_juros_mensal,
            numero_parcelas, parcelas_pagas
     FROM emprestimos WHERE user_id = ? AND status IN ('ativo','em_atraso')`
  ).bind(userId).all()
  for (const r of ((emps.results as any[]) || [])) {
    lista.push({ tipo: 'emprestimo', id: Number(r.id), nome: String(r.descricao),
      saldo: cent(r.saldo_devedor), parcela: cent(r.valor_parcela),
      taxa_mensal: Number(r.taxa_juros_mensal) || 0, vigente: true, comeca_em: null,
      parcelas_restantes: Math.max(0, Math.round(Number(r.numero_parcelas) - Number(r.parcelas_pagas))) })
  }

  const fins = await db.prepare(
    `SELECT id, descricao, saldo_devedor, valor_parcela, taxa_juros_mensal, data_inicio,
            numero_parcelas, parcelas_pagas, valor_entrada,
            entrada_parcelada, entrada_num_parcelas, entrada_parcelas_pagas, entrada_valor_parcela
     FROM financiamentos WHERE user_id = ? AND status = 'ativo'`
  ).bind(userId).all()
  for (const r of ((fins.results as any[]) || [])) {
    const inicio = String(r.data_inicio || '').slice(0, 10)
    const jaComecou = !inicio || inicio <= hojeISO
    lista.push({ tipo: 'financiamento', id: Number(r.id), nome: String(r.descricao),
      saldo: cent(r.saldo_devedor), parcela: cent(r.valor_parcela),
      taxa_mensal: Number(r.taxa_juros_mensal) || 0, vigente: jaComecou,
      comeca_em: jaComecou ? null : inicio,
      parcelas_restantes: Math.max(0, Math.round(Number(r.numero_parcelas) - Number(r.parcelas_pagas))) })

    // Entrada em aberto: essa sim já está saindo do bolso hoje.
    const entradaFalta = Number(r.entrada_parcelada) === 1
      ? cent((Number(r.entrada_num_parcelas || 0) - Number(r.entrada_parcelas_pagas || 0)) * Number(r.entrada_valor_parcela || 0))
      : 0
    if (entradaFalta > 0) {
      lista.push({ tipo: 'entrada', id: Number(r.id), nome: `Entrada · ${r.descricao}`,
        saldo: entradaFalta, parcela: cent(r.entrada_valor_parcela), taxa_mensal: 0,
        vigente: true, comeca_em: null,
        parcelas_restantes: Math.max(0, Math.round(Number(r.entrada_num_parcelas || 0) - Number(r.entrada_parcelas_pagas || 0))) })
    }
  }

  const soma = (f: (d: Divida) => boolean) => cent(lista.filter(f).reduce((s, d) => s + d.saldo, 0))
  return {
    lista,
    vigente: soma(d => d.vigente),
    contratada: soma(d => !d.vigente),
    total: soma(() => true),
    cartoes: soma(d => d.tipo === 'cartao'),
    emprestimos: soma(d => d.tipo === 'emprestimo'),
    financiamentos: soma(d => d.tipo === 'financiamento'),
    entradas: soma(d => d.tipo === 'entrada'),
  }
}

// ─── 3. Prestações e comprometimento ─────────────────────────────────────────

export interface Prestacoes {
  total: number
  cartao_parcelado: number
  contratos: number
  detalhe: Array<{ nome: string; valor: number; origem: string }>
}

/**
 * O que sai por mês em dívida. Parcela de contrato vem do VÍNCULO — o carimbo
 * `Empréstimo automático #N` que o próprio sistema pôs na despesa quando a
 * gerou. Casar por categoria pega o que só tem nome parecido.
 */
export async function prestacoes(db: D1Database, userId: number): Promise<Prestacoes> {
  const hoje = new Date()
  const mesStr = String(hoje.getMonth() + 1).padStart(2, '0')
  const anoStr = String(hoje.getFullYear())
  const detalhe: Prestacoes['detalhe'] = []

  // Parcelamentos no cartão: estão na fatura e são compromisso do mês.
  const cart = await db.prepare(
    `SELECT COALESCE(SUM(valor),0) as total FROM despesas
     WHERE user_id = ? AND cartao_id IS NOT NULL AND COALESCE(numero_parcelas,1) > 1
       AND ${filtroNaoCancelada()} AND ${filtroSemAporte()}
       AND strftime('%m', ${competenciaData()}) = ?
       AND strftime('%Y', ${competenciaData()}) = ?`
  ).bind(userId, mesStr, anoStr).first() as any
  const cartaoParcelado = cent(cart?.total)
  if (cartaoParcelado > 0) detalhe.push({ nome: 'Parcelamentos no cartão', valor: cartaoParcelado, origem: 'cartao' })

  // Contratos vigentes: a parcela sai do cadastro, não de uma busca por texto.
  const hojeISO = hoje.toISOString().slice(0, 10)
  const emps = await db.prepare(
    `SELECT descricao, valor_parcela FROM emprestimos
     WHERE user_id = ? AND status IN ('ativo','em_atraso') AND parcelas_pagas < numero_parcelas`
  ).bind(userId).all()
  for (const r of ((emps.results as any[]) || [])) {
    detalhe.push({ nome: String(r.descricao), valor: cent(r.valor_parcela), origem: 'emprestimo' })
  }
  const fins = await db.prepare(
    `SELECT descricao, valor_parcela, data_inicio, entrada_parcelada,
            entrada_num_parcelas, entrada_parcelas_pagas, entrada_valor_parcela
     FROM financiamentos WHERE user_id = ? AND status = 'ativo' AND parcelas_pagas < numero_parcelas`
  ).bind(userId).all()
  for (const r of ((fins.results as any[]) || [])) {
    const inicio = String(r.data_inicio || '').slice(0, 10)
    if (!inicio || inicio <= hojeISO) {
      detalhe.push({ nome: String(r.descricao), valor: cent(r.valor_parcela), origem: 'financiamento' })
    }
    if (Number(r.entrada_parcelada) === 1 &&
        Number(r.entrada_parcelas_pagas || 0) < Number(r.entrada_num_parcelas || 0)) {
      detalhe.push({ nome: `Entrada · ${r.descricao}`, valor: cent(r.entrada_valor_parcela), origem: 'entrada' })
    }
  }

  const contratos = cent(detalhe.filter(d => d.origem !== 'cartao').reduce((s, d) => s + d.valor, 0))
  return { total: cent(cartaoParcelado + contratos), cartao_parcelado: cartaoParcelado, contratos, detalhe }
}

/** Fluxo contra fluxo. Saldo de cartão nunca entra aqui — só a parcela. */
export function comprometimento(prest: number, rendaMensal: number): number {
  if (!(rendaMensal > 0)) return 0
  return Math.round((prest / rendaMensal) * 1000) / 10
}

// ─── 4. Patrimônio ───────────────────────────────────────────────────────────

export interface Patrimonio {
  total: number
  liquido: number
  bens_quitados: number
  bens_em_formacao: number
  investimentos: number
  reserva: number
  gera_renda: number
  pct_disponibilidade: number
  pct_imobilizacao: number
  pct_gera_renda: number
  detalhe: Array<{ nome: string; valor: number; classe: string }>
}

/**
 * A regra do patrimônio: você tem o que já pagou.
 *
 * Bem financiado entra pela fração que já saiu do seu bolso e foi para ele —
 * zero pago, zero no patrimônio; metade paga, metade. Resolve com uma frase os
 * dois casos: o apartamento que ainda não começou a ser pago não vira bem, e o
 * dinheiro de entrada que já saiu para de ser dinheiro vazio.
 *
 * O que conta como "já pago" é o PRINCIPAL AMORTIZADO (valor financiado menos
 * saldo devedor) mais a entrada quitada. Juro pago é custo, não vira
 * patrimônio — contar o desembolso inteiro daria à pessoa um bem maior do que
 * ela tem.
 */
export async function patrimonio(
  db: D1Database, userId: number, dividaTotal: number,
): Promise<Patrimonio> {
  const detalhe: Patrimonio['detalhe'] = []

  const bens = await db.prepare(
    `SELECT nome, valor_atual, liquidez, financiamento_id FROM bens_patrimoniais
     WHERE user_id = ? AND ativo = 1`
  ).bind(userId).all()
  let quitados = 0, liquidoRapido = 0
  for (const b of ((bens.results as any[]) || [])) {
    // Bem com financiamento vinculado não entra inteiro: a parte paga dele já
    // é contada pelo bloco de financiamentos abaixo.
    if (b.financiamento_id) continue
    const v = cent(b.valor_atual)
    quitados += v
    if (String(b.liquidez) === 'alta') liquidoRapido += v
    detalhe.push({ nome: String(b.nome), valor: v, classe: 'bem' })
  }

  const fins = await db.prepare(
    `SELECT descricao, valor_financiado, saldo_devedor, valor_entrada, entrada_parcelada,
            entrada_parcelas_pagas, entrada_valor_parcela
     FROM financiamentos WHERE user_id = ? AND status = 'ativo'`
  ).bind(userId).all()
  let emFormacao = 0
  for (const f of ((fins.results as any[]) || [])) {
    const amortizado = Math.max(0, cent(Number(f.valor_financiado) - Number(f.saldo_devedor)))
    const entradaPaga = Number(f.entrada_parcelada) === 1
      ? cent(Number(f.entrada_parcelas_pagas || 0) * Number(f.entrada_valor_parcela || 0))
      : cent(f.valor_entrada)
    const pago = cent(amortizado + entradaPaga)
    if (pago > 0) {
      emFormacao += pago
      detalhe.push({ nome: `${f.descricao} · o que já foi pago`, valor: pago, classe: 'em_formacao' })
    }
  }

  const inv = await db.prepare(
    `SELECT COALESCE(SUM(valor_atual),0) as total FROM investimentos WHERE user_id = ?`
  ).bind(userId).first() as any
  const invest = cent(inv?.total)
  if (invest > 0) detalhe.push({ nome: 'Investimentos', valor: invest, classe: 'gera_renda' })

  const res = await db.prepare(
    `SELECT COALESCE(valor_atual,0) as total FROM reserva_emergencia WHERE user_id = ? LIMIT 1`
  ).bind(userId).first() as any
  const resEsp = await db.prepare(
    `SELECT COALESCE(SUM(current_amount),0) as total FROM specialized_reserves WHERE user_id = ?`
  ).bind(userId).first() as any
  const reserva = cent(Number(res?.total || 0) + Number(resEsp?.total || 0))
  if (reserva > 0) detalhe.push({ nome: 'Reserva de emergência', valor: reserva, classe: 'gera_renda' })

  const total = cent(quitados + emFormacao + invest + reserva)
  const geraRenda = cent(invest + reserva)
  const pct = (v: number) => (total > 0 ? Math.round((v / total) * 1000) / 10 : 0)

  return {
    total,
    liquido: cent(total - dividaTotal),
    bens_quitados: cent(quitados),
    bens_em_formacao: cent(emFormacao),
    investimentos: invest,
    reserva,
    gera_renda: geraRenda,
    pct_disponibilidade: pct(cent(liquidoRapido + invest + reserva)),
    pct_imobilizacao: pct(cent(quitados - liquidoRapido + emFormacao)),
    pct_gera_renda: pct(geraRenda),
    detalhe: detalhe.sort((a, b) => b.valor - a.valor),
  }
}

// ─── 5. Reserva ──────────────────────────────────────────────────────────────

export interface Reserva {
  atual: number
  gasto_medio: number
  meses_cobertos: number
  alvo_meses: number
  alvo_valor: number
  falta: number
}

/** Usa o MESMO gasto médio que a projeção usa. Antes eram duas contas. */
export function reserva(atual: number, janela: JanelaHistorica, alvoMeses = 6): Reserva {
  const gasto = mediaPesada(janela.base.map(m => m.despesas))
  const alvo = cent(gasto * alvoMeses)
  return {
    atual: cent(atual),
    gasto_medio: cent(gasto),
    meses_cobertos: gasto > 0 ? Math.round((atual / gasto) * 10) / 10 : 0,
    alvo_meses: alvoMeses,
    alvo_valor: alvo,
    falta: cent(Math.max(0, alvo - atual)),
  }
}

// ─── 6. Score ────────────────────────────────────────────────────────────────

export interface Pilar {
  chave: string
  nome: string
  peso: number
  nota: number
  pontos: number
  valor: string
  explicacao: string
}

export interface Score {
  total: number
  nivel: 'boa' | 'atenção' | 'crítica'
  pilares: Pilar[]
  positivos: string[]
  negativos: string[]
  disponivel: boolean
  motivo_indisponivel: string | null
}

const escala = (v: number, bom: number, ruim: number) => {
  if (bom > ruim) return Math.max(0, Math.min(100, ((v - ruim) / (bom - ruim)) * 100))
  return Math.max(0, Math.min(100, ((ruim - v) / (ruim - bom)) * 100))
}

/**
 * Cinco pilares, peso fixo, tudo em cima de meses fechados — para a nota não
 * mudar conforme o dia do mês. Cada pilar diz o que mede e o que o move; um
 * número de 0 a 100 sozinho não manda ninguém fazer nada.
 */
export function score(dados: {
  reserva: Reserva
  comprometimento: number
  sobra_proximo_mes: number
  renda: number
  patrimonio: Patrimonio
  janela: JanelaHistorica
}): Score {
  const { janela } = dados
  if (janela.base.length < 3) {
    return {
      total: 0, nivel: 'atenção', pilares: [], positivos: [], negativos: [], disponivel: false,
      motivo_indisponivel: `Com ${janela.base.length} ${janela.base.length === 1 ? 'mês fechado' : 'meses fechados'} não dá para dizer o que é normal para você. A nota aparece a partir de 3.`,
    }
  }

  const u3 = janela.base.slice(-3), a3 = janela.base.slice(-6, -3)
  const mediaU3 = u3.length ? u3.reduce((s, m) => s + m.saldo, 0) / u3.length : 0
  const mediaA3 = a3.length ? a3.reduce((s, m) => s + m.saldo, 0) / a3.length : mediaU3
  const melhora = mediaU3 - mediaA3

  const pilares: Pilar[] = [
    { chave: 'folego', nome: 'Fôlego', peso: 25,
      nota: escala(dados.reserva.meses_cobertos, 6, 0),
      pontos: 0, valor: `${dados.reserva.meses_cobertos} ${dados.reserva.meses_cobertos === 1 ? 'mês' : 'meses'}`,
      explicacao: 'Quantos meses de gasto sua reserva cobre. O alvo é 6.' },
    { chave: 'endividamento', nome: 'Endividamento', peso: 25,
      nota: escala(dados.comprometimento, 30, 70),
      pontos: 0, valor: `${dados.comprometimento}%`,
      explicacao: 'Quanto da renda já tem dono. Nota cheia até 30%, zero a partir de 70%.' },
    { chave: 'sobra', nome: 'Sobra', peso: 20,
      nota: escala(dados.sobra_proximo_mes, dados.renda * 0.2, 0),
      pontos: 0, valor: fmtSinal(dados.sobra_proximo_mes),
      explicacao: 'O que resta no próximo mês. O alvo é 20% da renda.' },
    { chave: 'patrimonio', nome: 'Patrimônio', peso: 15,
      nota: Math.min(100, escala(dados.patrimonio.pct_gera_renda, 40, 0) * 0.6 + (dados.patrimonio.liquido > 0 ? 40 : 0)),
      pontos: 0, valor: `${dados.patrimonio.pct_gera_renda}% gera renda`,
      explicacao: 'Quanto do que você tem trabalha por você, e se o líquido é positivo.' },
    { chave: 'rumo', nome: 'Rumo', peso: 15,
      nota: escala(melhora, dados.renda * 0.1, -dados.renda * 0.1),
      pontos: 0, valor: `${melhora >= 0 ? '+' : '−'}${fmt(Math.abs(melhora))}/mês`,
      explicacao: 'Seus últimos 3 meses fechados contra os 3 anteriores.' },
  ]

  let total = 0
  for (const p of pilares) {
    p.nota = Math.round(p.nota * 10) / 10
    p.pontos = Math.round((p.peso * p.nota) / 100 * 10) / 10
    total += p.pontos
  }
  total = Math.round(total)

  const positivos = pilares.filter(p => p.nota >= 60)
    .map(p => `${p.nome}: ${p.valor} — ${p.pontos} de ${p.peso} pontos.`)
  const negativos = pilares.filter(p => p.nota < 60)
    .sort((a, b) => (b.peso - b.pontos) - (a.peso - a.pontos))
    .map(p => `${p.nome}: ${p.valor} — deixa ${Math.round((p.peso - p.pontos) * 10) / 10} pontos na mesa.`)

  return {
    total,
    nivel: total >= 60 ? 'boa' : total >= 35 ? 'atenção' : 'crítica',
    pilares, positivos, negativos, disponivel: true, motivo_indisponivel: null,
  }
}

function fmt(v: number): string {
  return 'R$ ' + Math.abs(Math.round(v)).toLocaleString('pt-BR')
}

/** Sobra negativa precisa do sinal: "R$ 1.748" e "−R$ 1.748" são vidas diferentes. */
function fmtSinal(v: number): string {
  return (v < 0 ? '−' : '') + fmt(v)
}
