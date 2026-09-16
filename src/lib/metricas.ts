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
import { raizCategoria } from './identidade'
import { gastoEssencial, dividir, type DespesaDivisivel } from './divisao'
import { montarFila, type DespesaCrua } from './fila-decisoes'

const cent = (v: number) => Math.round((Number(v) || 0) * 100) / 100

// ─── Janela de meses fechados ────────────────────────────────────────────────

export interface MesFechado {
  mes: number
  ano: number
  label: string
  receitas: number
  /**
   * O que entrou SEM vir de uma recorrência de receita que ainda está ativa.
   *
   * `receitas` continua sendo a verdade do mês — é ela que alimenta o saldo, a
   * oscilação e o teste de "o mês tem os dois lados lançados". Esta aqui existe
   * só para a média da renda: ver o comentário em `renda()`.
   */
  receitas_avulsas: number
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

  // Quais recorrências de receita `renda()` vai somar adiante. As linhas que
  // ELAS geraram precisam sair da média, senão o mesmo salário entra duas
  // vezes — uma como linha lançada, outra como recorrência. As de recorrência
  // já encerrada ficam: elas não estão na soma de `renda()`, e o que entrou no
  // passado entrou de verdade.
  const ativasQ = await db.prepare(
    `SELECT id FROM recorrencias
     WHERE user_id = ? AND ativa = 1 AND tipo = 'receita'
       AND (data_fim IS NULL OR data_fim > date('now'))`
  ).bind(userId).all()
  const ativas = ((ativasQ.results as any[]) || []).map(r => Number(r.id)).filter(Boolean)
  const foraDaMedia = ativas.length
    ? ` AND (recorrencia_id IS NULL OR recorrencia_id NOT IN (${ativas.join(',')}))`
    : ''

  const meses: MesFechado[] = []
  for (let i = limite; i >= 1; i--) {
    let m = mesAtual - i, a = anoAtual
    while (m <= 0) { m += 12; a -= 1 }
    const mesStr = String(m).padStart(2, '0')

    const rec = await db.prepare(
      `SELECT COALESCE(SUM(valor),0) as total FROM receitas
       WHERE user_id = ? AND strftime('%m', data) = ? AND strftime('%Y', data) = ?`
    ).bind(userId, mesStr, String(a)).first() as any

    const avu = foraDaMedia
      ? await db.prepare(
          `SELECT COALESCE(SUM(valor),0) as total FROM receitas
           WHERE user_id = ? AND strftime('%m', data) = ? AND strftime('%Y', data) = ?${foraDaMedia}`
        ).bind(userId, mesStr, String(a)).first() as any
      : rec

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
      receitas: r, receitas_avulsas: cent(avu?.total), despesas: d, saldo: cent(r - d),
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

/**
 * A renda mensal de referência.
 *
 * `mensal = média do que varia + soma do que se repete`. Parece óbvio e não é:
 * a recorrência de receita do VerdeMais **materializa** linhas em `receitas`
 * (recorrencias.ts, linhas 513, 587 e 659). Somar a média das linhas lançadas
 * com o valor das recorrências ativas contava o mesmo salário duas vezes —
 * medido em 16/09/2026: salário de R$ 5.000 virava renda de R$ 10.000.
 *
 * E `renda.mensal` é o denominador de quase tudo: comprometimento, sobra,
 * os quatro pilares do score, os percentuais do 50/30/20, o piso de 1% dos
 * alertas. O erro não aparecia em lugar nenhum — ele deixava todos os números
 * bonitos ao mesmo tempo, que é a única forma de erro que ninguém desconfia.
 *
 * Por isso a média usa `receitas_avulsas`: o que entrou sem vir de uma
 * recorrência que ainda está ativa. Recorrência encerrada continua contando na
 * média, porque ela não entra na soma abaixo e o dinheiro entrou de verdade.
 */
export async function renda(db: D1Database, userId: number, janela: JanelaHistorica): Promise<Renda> {
  const rec = await db.prepare(
    `SELECT COALESCE(SUM(valor),0) as total FROM recorrencias
     WHERE user_id = ? AND ativa = 1 AND tipo = 'receita'
       AND (data_fim IS NULL OR data_fim > date('now'))`
  ).bind(userId).first() as any

  const vals = janela.base.map(m => m.receitas_avulsas ?? m.receitas)
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

export interface BaseDeReserva {
  /** Só necessidades: é isto que a reserva precisa cobrir. */
  essencial: number
  /** Todo o fluxo de saída, para a tela poder mostrar a diferença. */
  total: number
  meses: number
  /**
   * O que a confiança precisa saber sobre estas mesmas linhas. Sai daqui, e
   * não de uma consulta própria, porque `baseDeReserva` já pagou o SELECT:
   * medir o quanto se sabe não pode custar mais caro que saber.
   */
  gasto_total: number
  gasto_nao_classificado: number
  valor_em_disputa: number
  lancamentos_em_disputa: number
}

export interface Reserva {
  atual: number
  /** O gasto que a reserva cobre — ESSENCIAL, não todo o fluxo de saída. */
  gasto_medio: number
  /** Todo o fluxo de saída, exibido ao lado para o usuário ver a diferença. */
  gasto_total: number
  meses_cobertos: number
  alvo_meses: number
  alvo_valor: number
  /** O alvo se a régua fosse todo o gasto — o cenário confortável. */
  alvo_confortavel: number
  falta: number
}

/**
 * Quanto custa um mês da sua vida, em duas leituras.
 *
 * Havia duas contas divergentes no app: a camada somava todo o fluxo de saída
 * (R$ 7.665,80) e a tela de Reserva somava uma lista fixa de categorias
 * "essenciais" escrita no código (R$ 3.932,98). Seis meses de reserva davam
 * R$ 45.995 numa e R$ 23.598 na outra — dois alvos para a mesma pessoa.
 *
 * A régua agora é uma: o gasto ESSENCIAL, classificado pela mesma função que
 * desenha as quatro fatias da 50/30/20. Reserva existe para o mês em que a
 * renda falta, e nesse mês você corta streaming, não aluguel. E a lista de
 * essenciais deixa de ser uma constante do código para virar uma classificação
 * que o usuário pode corrigir por identidade.
 */
export async function baseDeReserva(
  db: D1Database, userId: number, janela: JanelaHistorica,
): Promise<BaseDeReserva> {
  const chaves = janela.base.map(m => `${m.ano}-${String(m.mes).padStart(2, '0')}`)
  const VAZIA: BaseDeReserva = {
    essencial: 0, total: 0, meses: 0,
    gasto_total: 0, gasto_nao_classificado: 0,
    valor_em_disputa: 0, lancamentos_em_disputa: 0,
  }
  if (!chaves.length) return VAZIA
  const ph = chaves.map(() => '?').join(',')

  const r = await db.prepare(
    `SELECT d.id, d.descricao, d.categoria, d.valor, d.observacoes, d.recorrencia_id,
            d.numero_parcelas, d.cartao_id, d.data, d.status
     FROM despesas d
     WHERE d.user_id = ? AND d.status IN ('pago','pendente')
       AND ${filtroSemAporte('d')} AND ${filtroNaoCancelada('d')}
       AND (strftime('%Y-%m', ${competenciaData('d')})) IN (${ph})`
  ).bind(userId, ...chaves).all()

  const linhas = ((r.results as any[]) || []).map((x): DespesaDivisivel => ({
    id: Number(x.id), descricao: x.descricao ?? null, categoria: x.categoria ?? null,
    valor: Number(x.valor) || 0, observacoes: x.observacoes ?? null,
    recorrencia_id: x.recorrencia_id ?? null,
    numero_parcelas: x.numero_parcelas ?? null, cartao_id: x.cartao_id ?? null,
  }))

  const meses = chaves.length
  const total = cent(linhas.reduce((s, d) => s + d.valor, 0) / meses)

  // As mesmas linhas, lidas mais duas vezes: uma para saber quanto ficou fora
  // das quatro fatias, outra para saber quanto está em disputa. As duas são
  // funções puras sobre o que já está na memória — nenhuma consulta a mais.
  const div = dividir(linhas, 0)
  const cruas: DespesaCrua[] = ((r.results as any[]) || []).map(x => ({
    id: Number(x.id), descricao: x.descricao ?? null, categoria: x.categoria ?? null,
    valor: Number(x.valor) || 0, data: x.data ?? null, status: x.status ?? null,
    observacoes: x.observacoes ?? null, recorrencia_id: x.recorrencia_id ?? null,
  }))
  const fila = montarFila(cruas, { sem_parecidas: true })

  return {
    essencial: cent(gastoEssencial(linhas) / meses),
    total, meses,
    gasto_total: cent(div.total),
    gasto_nao_classificado: cent(div.nao_classificado),
    valor_em_disputa: fila.resumo.valor_em_disputa,
    lancamentos_em_disputa: fila.resumo.lancamentos_em_disputa,
  }
}

/**
 * A reserva contra o gasto essencial.
 *
 * `base` pode vir null quando o chamador não quis pagar a consulta extra — aí
 * cai para a média de TODO o gasto, que é conservadora demais mas nunca
 * otimista. Errar para o lado de pedir reserva demais é aceitável; errar para
 * o lado de dizer "você está coberto" não é.
 */
export function reserva(
  atual: number, janela: JanelaHistorica, alvoMeses = 6, base?: BaseDeReserva | null,
): Reserva {
  const totalMedio = mediaPesada(janela.base.map(m => m.despesas))
  const gasto = base && base.essencial > 0 ? base.essencial : totalMedio
  const alvo = cent(gasto * alvoMeses)
  return {
    atual: cent(atual),
    gasto_medio: cent(gasto),
    gasto_total: cent(base?.total || totalMedio),
    meses_cobertos: gasto > 0 ? Math.round((atual / gasto) * 10) / 10 : 0,
    alvo_meses: alvoMeses,
    alvo_valor: alvo,
    alvo_confortavel: cent((base?.total || totalMedio) * alvoMeses),
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

// ─── Para onde o dinheiro está indo ──────────────────────────────────────────

export interface FatiaGasto {
  nome: string
  total: number
  /** Média por mês da janela — é ela que se compara com a renda mensal. */
  media: number
  lancamentos: number
  /** Fatia do total gasto na janela. */
  pct: number
  /** Quanto desta fatia já é parcela ou recorrência (contratado, não hábito). */
  contratado: number
}

export interface Gastos {
  meses: number
  periodo: string
  total: number
  media_mensal: number
  categorias: FatiaGasto[]
  tags: FatiaGasto[]
  /** Gasto sem nenhuma etiqueta: o pedaço que nenhuma pergunta alcança. */
  sem_tag: { total: number; pct: number; lancamentos: number }
  /**
   * Nomes de categoria que são o mesmo assunto escrito de dois jeitos
   * ("Financiamento" e "Financiamentos"). Enquanto existirem, toda soma por
   * categoria está partida ao meio e nenhum ranking é verdade.
   */
  duplicadas: Array<{ nomes: Array<{ nome: string; total: number }>; total: number }>
  /** Concentração: quanto das três maiores categorias sobre o total. */
  top3_pct: number
}

/**
 * O que o retrato e o plano não contam: em que o dinheiro foi parar.
 *
 * Duas leituras da mesma janela de meses fechados, porque respondem a
 * perguntas diferentes:
 *
 *   CATEGORIA — obrigatória, exclusiva, uma por despesa. Soma fecha com o
 *     total. É o mapa oficial do gasto.
 *   TAG — opcional, múltipla. A mesma despesa pode levar duas etiquetas, então
 *     a soma das tags NÃO fecha com o total e não deve ser lida como fatia de
 *     um bolo. Serve para atravessar o mapa oficial: "quanto custou a mudança",
 *     "quanto custou o carro" — perguntas que nenhuma categoria responde.
 *
 * Mês corrente fica de fora pela mesma razão de todo o resto deste arquivo:
 * no dia 14 as parcelas já estão lançadas e o mercado do mês ainda não.
 */
export async function gastos(
  db: D1Database, userId: number, janela: JanelaHistorica,
): Promise<Gastos> {
  const chaves = janela.meses.map(m => `${m.ano}-${String(m.mes).padStart(2, '0')}`)
  const vazio: Gastos = {
    meses: 0, periodo: '', total: 0, media_mensal: 0, categorias: [], tags: [],
    sem_tag: { total: 0, pct: 0, lancamentos: 0 }, duplicadas: [], top3_pct: 0,
  }
  if (!chaves.length) return vazio

  const ph = chaves.map(() => '?').join(',')
  const escopo = `d.user_id = ? AND d.status IN ('pago','pendente')
    AND ${filtroSemAporte('d')} AND ${filtroNaoCancelada('d')}
    AND (strftime('%Y-%m', ${competenciaData('d')})) IN (${ph})`

  const cats = await db.prepare(
    `SELECT COALESCE(NULLIF(TRIM(d.categoria), ''), 'Sem categoria') as nome,
            COALESCE(SUM(d.valor), 0) as total,
            COUNT(*) as n,
            COALESCE(SUM(CASE WHEN d.parcelado = 1 OR COALESCE(d.numero_parcelas,1) > 1
                                OR d.recorrencia_id IS NOT NULL THEN d.valor ELSE 0 END), 0) as contratado
     FROM despesas d
     WHERE ${escopo}
     GROUP BY COALESCE(NULLIF(TRIM(d.categoria), ''), 'Sem categoria')
     ORDER BY total DESC`
  ).bind(userId, ...chaves).all()

  const linhasCat = ((cats.results as any[]) || [])
  const total = cent(linhasCat.reduce((s, r) => s + Number(r.total || 0), 0))
  const nMeses = chaves.length

  const fatia = (nome: string, t: number, n: number, contratado: number): FatiaGasto => ({
    nome, total: cent(t), media: cent(t / nMeses), lancamentos: Number(n) || 0,
    pct: total > 0 ? Math.round((t / total) * 1000) / 10 : 0,
    contratado: cent(contratado),
  })

  const categorias = linhasCat.map(r =>
    fatia(String(r.nome), Number(r.total || 0), Number(r.n || 0), Number(r.contratado || 0)))

  // Tags: sem tabela, sem bloco. A ausência não é erro — a maioria dos usuários
  // nunca etiquetou nada, e a tela precisa continuar de pé.
  let tags: FatiaGasto[] = []
  let semTag = { total: 0, pct: 0, lancamentos: 0 }
  try {
    const tg = await db.prepare(
      `SELECT t.nome as nome,
              COALESCE(SUM(d.valor), 0) as total,
              COUNT(*) as n,
              COALESCE(SUM(CASE WHEN d.parcelado = 1 OR COALESCE(d.numero_parcelas,1) > 1
                                  OR d.recorrencia_id IS NOT NULL THEN d.valor ELSE 0 END), 0) as contratado
       FROM despesas d
       JOIN despesa_tags dt ON dt.despesa_id = d.id
       JOIN tags t ON t.id = dt.tag_id
       WHERE ${escopo}
       GROUP BY t.nome
       ORDER BY total DESC`
    ).bind(userId, ...chaves).all()
    tags = ((tg.results as any[]) || []).map(r =>
      fatia(String(r.nome), Number(r.total || 0), Number(r.n || 0), Number(r.contratado || 0)))

    const st = await db.prepare(
      `SELECT COALESCE(SUM(d.valor), 0) as total, COUNT(*) as n
       FROM despesas d
       WHERE ${escopo}
         AND NOT EXISTS (SELECT 1 FROM despesa_tags dt WHERE dt.despesa_id = d.id)`
    ).bind(userId, ...chaves).first() as any
    const stTotal = cent(st?.total)
    semTag = {
      total: stTotal, lancamentos: Number(st?.n || 0),
      pct: total > 0 ? Math.round((stTotal / total) * 1000) / 10 : 0,
    }
  } catch (e) {
    tags = []
  }

  // ── Nomes que são o mesmo assunto ─────────────────────────────────────────
  // Sem acento, sem caixa, sem plural: "Financiamento" e "Financiamentos"
  // caem na mesma chave. Não juntamos os valores por conta própria — só
  // apontamos, porque quem decide se são a mesma coisa é o dono da conta.
  //
  // A régua vem de identidade.ts, a mesma que a Central de Organização usa
  // para montar a fila de decisões. Se as duas telas discordassem sobre o que
  // é "o mesmo nome", a Projeção acusaria um conflito que a Central não sabe
  // resolver — e o botão de resolver não levaria a lugar nenhum.
  const grupos = new Map<string, Array<{ nome: string; total: number }>>()
  for (const c of categorias) {
    const k = raizCategoria(c.nome)
    if (!k) continue
    if (!grupos.has(k)) grupos.set(k, [])
    grupos.get(k)!.push({ nome: c.nome, total: c.total })
  }
  const duplicadas = [...grupos.values()]
    .filter(g => g.length > 1)
    .map(g => ({ nomes: g.sort((a, b) => b.total - a.total), total: cent(g.reduce((s, x) => s + x.total, 0)) }))
    .sort((a, b) => b.total - a.total)

  const top3 = categorias.slice(0, 3).reduce((s, c) => s + c.total, 0)

  return {
    meses: nMeses,
    periodo: janela.meses.length
      ? `${janela.meses[0].label} a ${janela.meses[janela.meses.length - 1].label}`
      : '',
    total,
    media_mensal: cent(total / nMeses),
    categorias,
    tags,
    sem_tag: semTag,
    duplicadas,
    top3_pct: total > 0 ? Math.round((top3 / total) * 1000) / 10 : 0,
  }
}

// ─── 7. Recomendações: cada ação com o preço em pontos ───────────────────────

export interface Recomendacao {
  chave: string
  acao: string
  /** Quanto dinheiro a ação exige. 0 quando não custa dinheiro, só tempo. */
  custa: number
  /** Quantos pontos ela devolve da nota. */
  devolve: number
  nota_depois: number
  pilar: string
  /** Quando a ação não move a nota, a tela precisa DIZER isso, não escondê-la. */
  nota: string | null
  /** Linha que compara ORDEM entre duas ações, não uma ação isolada. */
  ordem?: boolean
}

/** Entradas do score, isoladas para poder simular um cenário alternativo. */
interface EntradaScore {
  reserva: Reserva
  comprometimento: number
  sobra_proximo_mes: number
  renda: number
  patrimonio: Patrimonio
  janela: JanelaHistorica
}

/**
 * O que cada decisão devolve da nota.
 *
 * "Melhore sua saúde financeira" é conselho de biscoito da sorte. A única
 * recomendação que vale alguma coisa é a que diz quanto custa e quanto rende —
 * e, quando não rende nada, que diz isso em voz alta.
 *
 * Cada linha é o MESMO score recalculado sobre um cenário alternativo, não uma
 * estimativa à parte. Se a fórmula do score mudar amanhã, estes números mudam
 * junto; não há como as duas coisas divergirem.
 *
 * A honestidade que isto compra: depois de zerar o cartão, quitar o empréstimo
 * costuma devolver ZERO ponto — porque o comprometimento já caiu abaixo de 30%
 * e o pilar está no teto. O score mede saúde, não mérito, e a tela precisa
 * admitir isso. Senão alguém otimiza o número em vez do dinheiro.
 */
export function recomendacoes(dados: EntradaScore & {
  /** Saldos por tipo, para saber o que há para quitar. */
  dividas: Dividas
  prestacoes: Prestacoes
}): Recomendacao[] {
  const base = score(dados)
  if (!base.disponivel) return []

  const fora: Recomendacao[] = []
  const alvoMeses = dados.reserva.alvo_meses || 6
  const gastoEss = dados.reserva.gasto_medio

  const simular = (mudanca: Partial<EntradaScore>) =>
    score({ ...dados, ...mudanca })

  // ── Reserva: 1 e 3 meses ──────────────────────────────────────────────────
  for (const meses of [1, 3]) {
    const precisa = cent(gastoEss * meses)
    if (gastoEss <= 0 || dados.reserva.atual >= precisa) continue
    const custa = cent(precisa - dados.reserva.atual)
    const nova = simular({
      reserva: { ...dados.reserva, atual: precisa, meses_cobertos: meses,
                 falta: cent(Math.max(0, dados.reserva.alvo_valor - precisa)) },
      patrimonio: { ...dados.patrimonio, reserva: precisa },
    })
    fora.push({
      chave: `reserva_${meses}m`,
      acao: `Montar ${meses} ${meses === 1 ? 'mês' : 'meses'} de reserva`,
      custa, devolve: Math.round((nova.total - base.total) * 10) / 10,
      nota_depois: nova.total, pilar: 'Fôlego',
      nota: meses === alvoMeses ? null : `${meses} de ${alvoMeses} meses do alvo.`,
    })
  }

  // ── Dívidas: zerar cada tipo, e depois a ORDEM entre elas ────────────────
  const porTipo: Array<{ chave: string; rotulo: string; saldo: number; parcela: number }> = [
    { chave: 'cartao', rotulo: 'os parcelamentos do cartão',
      saldo: dados.dividas.cartoes, parcela: dados.prestacoes.cartao_parcelado },
    { chave: 'emprestimo', rotulo: 'o empréstimo',
      saldo: dados.dividas.emprestimos,
      parcela: dados.prestacoes.detalhe
        .filter(d => d.origem === 'emprestimo').reduce((s, d) => s + d.valor, 0) },
  ].filter(x => x.saldo > 0 && x.parcela > 0)

  for (const alvo of porTipo) {
    const prestDepois = cent(Math.max(0, dados.prestacoes.total - alvo.parcela))
    const nova = simular({
      comprometimento: comprometimento(prestDepois, dados.renda),
      sobra_proximo_mes: cent(dados.sobra_proximo_mes + alvo.parcela),
      patrimonio: { ...dados.patrimonio, liquido: cent(dados.patrimonio.liquido + alvo.saldo) },
    })
    const devolve = Math.round((nova.total - base.total) * 10) / 10
    fora.push({
      chave: `quitar_${alvo.chave}`,
      acao: `Zerar ${alvo.rotulo}`,
      custa: alvo.saldo, devolve, nota_depois: nova.total, pilar: 'Endividamento',
      nota: devolve <= 0
        ? 'Sozinha, esta não move a nota — o pilar já estaria onde dá para chegar.'
        : `Libera ${fmt(alvo.parcela)} por mês.`,
    })
  }

  // ── A ordem entre as duas dívidas ─────────────────────────────────────────
  //
  // Esta é a linha mais importante da tabela, e é a que só aparece porque as
  // duas anteriores foram calculadas de forma independente: aqui a segunda
  // dívida é quitada DEPOIS da primeira, e costuma devolver ZERO.
  //
  // O motivo é que o comprometimento já caiu abaixo de 30% e o pilar está no
  // teto — não há mais ponto para ganhar ali. Isso é o score sendo honesto
  // sobre o próprio limite: ele mede saúde, não mérito. Esconder esta linha
  // deixaria o usuário otimizando o número em vez do dinheiro.
  if (porTipo.length >= 2) {
    const ordenadas = porTipo
      .map(t => ({ t, r: fora.find(f => f.chave === `quitar_${t.chave}`) }))
      .filter(x => !!x.r)
      .sort((a, b) => (b.r!.devolve - a.r!.devolve))
    const primeira = ordenadas[0]?.t
    const segunda = ordenadas[1]?.t
    if (primeira && segunda) {
      const prestSemAmbas = cent(Math.max(0, dados.prestacoes.total - primeira.parcela - segunda.parcela))
      const prestSemPrimeira = cent(Math.max(0, dados.prestacoes.total - primeira.parcela))
      const depoisDaPrimeira = score({
        ...dados,
        comprometimento: comprometimento(prestSemPrimeira, dados.renda),
        sobra_proximo_mes: cent(dados.sobra_proximo_mes + primeira.parcela),
        patrimonio: { ...dados.patrimonio, liquido: cent(dados.patrimonio.liquido + primeira.saldo) },
      })
      const ambas = score({
        ...dados,
        comprometimento: comprometimento(prestSemAmbas, dados.renda),
        sobra_proximo_mes: cent(dados.sobra_proximo_mes + primeira.parcela + segunda.parcela),
        patrimonio: { ...dados.patrimonio,
          liquido: cent(dados.patrimonio.liquido + primeira.saldo + segunda.saldo) },
      })
      const devolve = Math.round((ambas.total - depoisDaPrimeira.total) * 10) / 10
      fora.push({
        chave: `quitar_${segunda.chave}_depois`,
        acao: `Zerar ${segunda.rotulo} DEPOIS de zerar ${primeira.rotulo}`,
        custa: segunda.saldo, devolve, nota_depois: ambas.total, pilar: 'Endividamento',
        nota: devolve <= 0
          ? 'Nesta ordem, não move a nota: o pilar de Endividamento já estaria no teto. ' +
            'Continua valendo a pena pelo dinheiro — o score é que não tem mais o que premiar.'
          : 'Feita nesta ordem, ainda rende.',
        ordem: true,
      })
    }
  }

  // Ordena por pontos devolvidos, e não por valor: a pergunta é "o que rende
  // mais", não "o que é mais caro". A linha de ordem fica sempre por último,
  // porque ela só faz sentido lida depois das duas que ela compara.
  return fora.sort((a, b) => (a.ordem ? 1 : 0) - (b.ordem ? 1 : 0) || b.devolve - a.devolve)
}

// ─── 9. Confiança ────────────────────────────────────────────────────────────

/**
 * O QUANTO O SISTEMA SABE — e não o que ele acha.
 *
 * Todo número deste arquivo era apresentado com a mesma cara: uma nota
 * construída sobre 3 meses com 40% do gasto em "Outros" saía idêntica a uma
 * construída sobre 12 meses limpos. A Projeção era a única tela com uma medida
 * de confiança, e ela media volatilidade do saldo — que é um fato sobre a vida
 * da pessoa, não sobre a qualidade do dado.
 *
 * A confiança aqui é uma CADEIA de quatro elos, e uma cadeia vale o que vale o
 * elo mais fraco. Por isso a combinação é média geométrica ponderada e não
 * média simples: zero em qualquer um zera o conjunto, que é o comportamento
 * correto — sem meses não há normal, sem classificação não há divisão, e com
 * metade do dinheiro em disputa não há soma.
 *
 * ── A DISTINÇÃO QUE IMPORTA ─────────────────────────────────────────────────
 *
 * Três elos são DEFEITO DE DADO e podem calar a nota: amostra curta, gasto sem
 * classificação, dinheiro em disputa. Cada um tem um caminho de conserto que
 * cabe numa frase, e o app sabe dizer qual é.
 *
 * O quarto — estabilidade — é FATO DA VIDA. Renda de comissionado oscila, e
 * isso limita o que se pode prever, mas não torna nenhum número errado. Ele
 * baixa a confiança e NUNCA cala a nota: esconder o diagnóstico de quem tem
 * renda irregular seria negar a ferramenta a quem mais precisa dela.
 */

export interface FatorConfianca {
  chave: 'amostra' | 'cobertura' | 'ambiguidade' | 'estabilidade'
  rotulo: string
  /**
   * 0 a 100: o quanto ESTE elo está pronto — 0 no piso, 100 sem ressalva.
   *
   * Não é a medida crua. 70% do gasto classificado não vale 70 aqui: o piso é
   * 60%, então 70% é um quarto do caminho entre "inaceitável" e "perfeito", e
   * vale 25. A medida crua, em português e com o valor em reais, está na
   * `leitura` — que é o que a tela mostra. Um elo que exibisse 70 quando está a
   * dez pontos de calar a nota inteira seria um medidor que mente baixo.
   */
  nota: number
  peso: number
  /** O que este elo está vendo, em números e em português. */
  leitura: string
  /** O que fazer para melhorar — null quando não há o que fazer. */
  saida: string | null
  /** Se este elo sozinho basta para o app se calar. */
  cala: boolean
}

export interface Confianca {
  nota: number
  nivel: 'alta' | 'media' | 'baixa' | 'insuficiente'
  /** Falso quando algum elo de dado furou o piso: a nota não deve virar número. */
  suficiente: boolean
  fatores: FatorConfianca[]
  /** O pior elo consertável — é nele que o usuário ganha mais mexendo. */
  limitante: FatorConfianca | null
  /** Quando insuficiente, a frase que substitui o número. */
  motivo: string | null
}

export interface EntradaConfianca {
  janela: JanelaHistorica
  /** Gasto do período, e quanto dele ficou fora das quatro fatias. */
  gasto_total: number
  gasto_nao_classificado: number
  /** Dinheiro parado em conflito, duplicata ou sem dono. */
  valor_em_disputa: number
  lancamentos_em_disputa: number
  renda: Renda
}

/** Pisos por elo. Furar um deles cala a nota: abaixo disso o app não sabe. */
const PISO_MESES = 3
const MESES_CHEIOS = 6
const PISO_COBERTURA = 0.6
const TETO_DISPUTA = 0.4
/** Acima de 60% da renda de oscilação mensal, previsão vira chute. */
const LIMITE_VOLATILIDADE = 0.6
/**
 * A estabilidade nunca desce abaixo disto na corrente.
 *
 * Ela é o único elo que não é defeito de dado, e por isso não pode ter o poder
 * de zerar o conjunto — zerar significa "sem isto não há o que calcular", e com
 * renda de comissionado há: há tudo, com menos poder de previsão. Deixá-la
 * zerar escondia o diagnóstico inteiro de quem vive de comissão, que é
 * exatamente quem mais precisa dele.
 */
const PISO_ESTABILIDADE = 0.15

const pct1 = (v: number) => Math.round(v * 1000) / 10

/** Do piso até o ideal, em 0..1. Abaixo do piso é zero — e o piso cala. */
function doPisoAteOIdeal(valor: number, piso: number, ideal: number): number {
  if (valor <= piso) return 0
  return Math.max(0.05, Math.min(1, (valor - piso) / (ideal - piso)))
}

export function confianca(e: EntradaConfianca): Confianca {
  const meses = e.janela.base.length
  const gasto = Math.max(0, e.gasto_total)

  // ── Elo 1: amostra ────────────────────────────────────────────────────────
  const fAmostra: FatorConfianca = {
    chave: 'amostra', rotulo: 'Meses observados', peso: 0.30,
    nota: Math.round(doPisoAteOIdeal(meses, PISO_MESES - 1, MESES_CHEIOS) * 100),
    leitura: meses === 0
      ? 'Nenhum mês fechado com os dois lados lançados.'
      : `${meses} ${meses === 1 ? 'mês fechado' : 'meses fechados'} com receita e despesa lançadas.`,
    saida: meses >= MESES_CHEIOS ? null
      : `Faltam ${MESES_CHEIOS - meses} ${MESES_CHEIOS - meses === 1 ? 'mês' : 'meses'} para a janela cheia.`,
    cala: meses < PISO_MESES,
  }

  // ── Elo 2: cobertura ──────────────────────────────────────────────────────
  //
  // Fração do gasto que caiu numa das quatro fatias. Dinheiro sem classificação
  // não some da conta — some da ANÁLISE, e some justo para o lado otimista: o
  // que não é reconhecido como necessidade não entra no alvo da reserva.
  const coberto = gasto > 0 ? Math.max(0, gasto - e.gasto_nao_classificado) / gasto : 0
  const fCobertura: FatorConfianca = {
    chave: 'cobertura', rotulo: 'Gasto classificado', peso: 0.30,
    nota: gasto > 0 ? Math.round(doPisoAteOIdeal(coberto, PISO_COBERTURA, 1) * 100) : 0,
    leitura: gasto <= 0
      ? 'Nenhuma despesa no período.'
      : `${pct1(coberto)}% do gasto tem categoria que o sistema reconhece` +
        (e.gasto_nao_classificado > 0 ? ` — ${fmt(e.gasto_nao_classificado)} não têm.` : '.'),
    saida: coberto >= 0.95 ? null
      : 'Dar categoria ao que está como "Outros" ou sem nome, na Central de Organização.',
    cala: gasto > 0 && coberto < PISO_COBERTURA,
  }

  // ── Elo 3: ambiguidade ────────────────────────────────────────────────────
  //
  // O mesmo gasto com dois nomes, ou duas categorias para a mesma coisa: a soma
  // existe, mas não se sabe de que lado ela cai. Só entram as decisões do
  // primeiro degrau da fila — as que fazem o número de HOJE estar errado.
  const disputa = gasto > 0 ? Math.min(1, e.valor_em_disputa / gasto) : 0
  const fAmbiguidade: FatorConfianca = {
    chave: 'ambiguidade', rotulo: 'Dinheiro sem dúvida', peso: 0.20,
    nota: Math.round(doPisoAteOIdeal(1 - disputa, 1 - TETO_DISPUTA, 1) * 100),
    leitura: e.valor_em_disputa <= 0
      ? 'Nenhum lançamento em conflito ou sem dono.'
      : `${fmt(e.valor_em_disputa)} em ${e.lancamentos_em_disputa} ` +
        `${e.lancamentos_em_disputa === 1 ? 'lançamento' : 'lançamentos'} ` +
        `com conflito, duplicata ou sem dono — ${pct1(disputa)}% do gasto.`,
    saida: e.valor_em_disputa <= 0 ? null
      : 'Resolver a fila de decisões da Central de Organização.',
    cala: disputa > TETO_DISPUTA,
  }

  // ── Elo 4: estabilidade ───────────────────────────────────────────────────
  //
  // Este NÃO cala e não pode zerar. Renda que oscila é fato da vida de quem
  // vive de comissão, não defeito de lançamento: limita o que dá para prever e
  // não torna número nenhum errado.
  const volatilidade = e.renda.mensal > 0 ? e.renda.oscilacao / e.renda.mensal : 1
  const estabilidade = meses === 0 ? 0
    : Math.max(PISO_ESTABILIDADE, Math.min(1, 1 - volatilidade / LIMITE_VOLATILIDADE))
  const fEstabilidade: FatorConfianca = {
    chave: 'estabilidade', rotulo: 'Regularidade do mês', peso: 0.20,
    nota: Math.round(estabilidade * 100),
    leitura: e.renda.mensal <= 0
      ? 'Sem renda de referência para comparar.'
      : `O resultado do mês oscila ${fmt(e.renda.oscilacao)}, ${pct1(volatilidade)}% da renda.`,
    saida: estabilidade >= 0.8 ? null
      : 'Nada a corrigir aqui: é o seu mês que varia, e a projeção já conta com isso.',
    cala: false,
  }

  const fatores = [fAmostra, fCobertura, fAmbiguidade, fEstabilidade]

  // ── A combinação ──────────────────────────────────────────────────────────
  //
  // Média geométrica ponderada, e não média simples: uma cadeia vale o que vale
  // o elo mais fraco, e um zero em qualquer elo de DADO zera o conjunto — que é
  // o comportamento correto. Sem meses não há normal; sem classificação não há
  // divisão; com metade do dinheiro em disputa não há soma. Média simples
  // deixaria três elos bons comprarem o silêncio de um elo quebrado.
  let log = 0
  let somaPesos = 0
  let zerou = false
  for (const f of fatores) {
    const x = Math.max(0, Math.min(1, f.nota / 100))
    if (x <= 0) { zerou = true; break }
    log += f.peso * Math.log(x)
    somaPesos += f.peso
  }
  const nota = zerou || somaPesos <= 0 ? 0 : Math.round(100 * Math.exp(log / somaPesos))

  const calando = fatores.filter(f => f.cala)
  const suficiente = calando.length === 0 && nota > 0

  // O limitante sai só dos elos que a pessoa PODE consertar: apontar
  // "estabilidade" como gargalo mandaria alguém arrumar o próprio salário.
  const consertaveis = fatores.filter(f => f.chave !== 'estabilidade')
  const pior = consertaveis.reduce<FatorConfianca | null>(
    (p, f) => (!p || f.nota < p.nota ? f : p), null)

  return {
    nota,
    nivel: !suficiente ? 'insuficiente' : nota >= 70 ? 'alta' : nota >= 45 ? 'media' : 'baixa',
    suficiente,
    fatores,
    limitante: pior && pior.nota < 100 ? pior : null,
    motivo: suficiente ? null
      : calando.length
        ? calando.map(f => f.leitura).join(' ') +
          (calando.find(f => f.saida) ? ' ' + calando.find(f => f.saida)!.saida : '')
        : 'Ainda não há dado suficiente para uma leitura honesta.',
  }
}
