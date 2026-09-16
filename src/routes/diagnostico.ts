/**
 * VerdeMais — Diagnóstico
 * ============================================================================
 * O Diagnóstico 360° não estava defasado: estava calculando por conta própria,
 * como todas as outras. Três defeitos, todos verificados na base real:
 *
 *   1. OLHAVA UM MÊS, E UM MÊS PELA METADE. Receita R$ 5.440 (a média é
 *      R$ 7.880,33), despesa R$ 7.502,14, veredicto "🚨 Situação Crítica",
 *      ação "cortar R$ 2.062,14". Todo dia 14 de todo mês a tela ia dizer que
 *      a pessoa está em crise, e no dia 30 ia dizer outra coisa. Um
 *      diagnóstico que muda de veredicto conforme o dia do mês não é
 *      diagnóstico.
 *
 *   2. A DÍVIDA ESTAVA ERRADA DOS DOIS LADOS. R$ 224.797,88 incluía os
 *      R$ 208.435 de um financiamento que começa em junho de 2028 e esquecia
 *      os R$ 24.233,07 de cartão. Daí saía um comprometimento de 87,7% quando
 *      o real é 60,4%.
 *
 *   3. ALERTA SEM PISO DE MATERIALIDADE. A tela exibia, com ícone vermelho:
 *      "Conflito Matemático Detectado — você tem R$ 0,02 investidos rendendo
 *      12% a.a. mas paga 34,5% a.a. em dívidas". A regra está certa e disparou
 *      sobre dois centavos. Alarme vermelho sobre valor irrelevante é o que faz
 *      a pessoa parar de ler os alertas — inclusive os bons.
 *
 * O que ela tinha de bom, e nenhuma outra tela tem: REGRAS QUE CRUZAM DUAS
 * ÁREAS. "Você investe enquanto paga juro maior." "Você aporta sem ter
 * reserva." Isso não se perde — é o que sobrou aqui.
 *
 * ── A DIVISÃO DE TRABALHO ───────────────────────────────────────────────────
 *
 *   PROJEÇÃO      responde QUANTO, e QUANDO. Balanço, dívidas, gastos, plano,
 *                 calendário. Você abre para consultar um número.
 *   DIAGNÓSTICO   responde E DAÍ? O QUE EU FAÇO. A nota, o que ajuda, o que
 *                 atrapalha, o que fazer. Você abre para decidir.
 *
 * São dois trabalhos: os números, e a leitura dos números. Eles não voltam a
 * ser 15 contra 17 porque os dois leem da mesma camada — o problema nunca foi
 * ter duas telas, foi ter duas contas.
 */

import { Hono } from 'hono'
import {
  janelaHistorica, renda as calcRenda, dividas as calcDividas,
  prestacoes as calcPrestacoes, comprometimento as calcComprometimento,
  patrimonio as calcPatrimonio, reserva as calcReserva, baseDeReserva,
  score as calcScore, recomendacoes as calcRecomendacoes,
  confianca as calcConfianca,
} from '../lib/metricas'
import { requireAuth } from './auth'

type Bindings = { DB: D1Database }
type Variables = { user: { id: number; nome: string; email: string; plano: string } }

const diagnostico = new Hono<{ Bindings: Bindings; Variables: Variables }>()

const cent = (v: number) => Math.round((Number(v) || 0) * 100) / 100

/**
 * Dinheiro em português. O 360° antigo exibia "R$ 0.459,92" e "0.0 meses" —
 * ponto decimal americano em texto português, dentro de um alerta vermelho.
 * Um número formatado errado faz o leitor duvidar do número certo ao lado.
 */
const fmt = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(v) || 0)

const pct1 = (v: number) =>
  (Number(v) || 0).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + '%'

export interface Alerta {
  chave: string
  severidade: 'critico' | 'alto' | 'medio'
  titulo: string
  descricao: string
  acao: string
  /** Quanto dinheiro está em jogo. É por aqui que o piso de 1% decide. */
  valor: number
  /** Onde este alerta também aparece, no momento da decisão. */
  no_contexto: string | null
}

// ─── GET /api/diagnostico ────────────────────────────────────────────────────
diagnostico.get('/', requireAuth, async (c) => {
  const user = c.get('user')
  const db = c.env.DB

  // Tudo abaixo vem da camada. Esta rota não soma nada por conta própria — é
  // literalmente a regra que faltava quando três telas davam três notas.
  const janela = await janelaHistorica(db, user.id, 12)
  const rendaM = await calcRenda(db, user.id, janela)
  const divs = await calcDividas(db, user.id)
  const prest = await calcPrestacoes(db, user.id)
  const patr = await calcPatrimonio(db, user.id, divs.total)
  const base = await baseDeReserva(db, user.id, janela)
  const res = calcReserva(patr.reserva, janela, 6, base)
  const comp = calcComprometimento(prest.total, rendaM.mensal)

  const variavelMedia = janela.base.length
    ? janela.base.reduce((a, m) => a + m.despesas_variaveis, 0) / janela.base.length
    : 0
  const sobra = cent(rendaM.mensal - prest.total - variavelMedia)

  const entradas = {
    reserva: res, comprometimento: comp, sobra_proximo_mes: sobra,
    renda: rendaM.mensal, patrimonio: patr, janela,
  }
  const sc = calcScore(entradas)

  // ── O quanto esta nota sabe de si mesma ───────────────────────────────────
  //
  // A fila de decisões já media o tamanho da dúvida — `valor_em_disputa` — e
  // nenhuma tela perguntava a ela. O Diagnóstico dava nota, alerta e conselho
  // com a mesma cara séria sobre 3 meses sujos ou 12 limpos.
  //
  // Abaixo do piso, a nota não vira número: o app diz o que falta para ela
  // valer. Segurar uma recomendação de quitar R$ 18.000 calculada sobre uma
  // base em que 40% do dinheiro está em disputa não é cautela — é a única
  // resposta honesta possível.
  //
  // O que NÃO cala são os alertas. Eles não são inferência sobre a janela: são
  // fatos sobre contrato assinado e taxa contratada — "você deve R$ 12.000 a 8%
  // ao mês e tem R$ 5.000 rendendo 0,9%" continua verdade com três meses sujos.
  // Abaixo do piso o app não fica mudo, fica específico: perde o agregado e
  // mantém os fatos, dizendo o que consertar para o agregado voltar.
  const conf = calcConfianca({
    janela,
    gasto_total: base.gasto_total,
    gasto_nao_classificado: base.gasto_nao_classificado,
    valor_em_disputa: base.valor_em_disputa,
    lancamentos_em_disputa: base.lancamentos_em_disputa,
    renda: rendaM,
  })

  const recs = conf.suficiente
    ? calcRecomendacoes({ ...entradas, dividas: divs, prestacoes: prest })
    : []

  // ── O piso de materialidade ───────────────────────────────────────────────
  //
  // Nenhum alerta existe abaixo de 1% da renda mensal. É a regra que teria
  // impedido o alarme vermelho sobre R$ 0,02 — e, mais importante, é o que
  // preserva a credibilidade dos alertas que importam. Quem aprende que os
  // alertas desta tela são barulho para de ler os cinco.
  const PISO = Math.max(50, cent(rendaM.mensal * 0.01))

  const alertas: Alerta[] = []
  const push = (a: Alerta) => { if (a.valor >= PISO) alertas.push(a) }

  // 1 · Investe enquanto paga juro maior.
  const jurosMaiores = divs.lista
    .filter(d => d.vigente && d.taxa_mensal > 0)
    .sort((a, b) => b.taxa_mensal - a.taxa_mensal)[0]
  if (patr.investimentos > 0 && jurosMaiores) {
    const anual = Math.round((Math.pow(1 + jurosMaiores.taxa_mensal / 100, 12) - 1) * 1000) / 10
    // Compara com a Selic como piso de rendimento conservador. Se o juro da
    // dívida não supera isso, não há conflito nenhum a apontar.
    const RENDIMENTO_REF = 12
    if (anual > RENDIMENTO_REF + 2) {
      const emJogo = cent(Math.min(patr.investimentos, jurosMaiores.saldo))
      push({
        chave: 'juro_maior_que_rendimento', severidade: 'critico',
        titulo: 'Seu dinheiro rende menos do que a sua dívida cobra',
        descricao: `Você tem ${fmt(patr.investimentos)} investidos, rendendo algo perto de ` +
          `${RENDIMENTO_REF}% ao ano, e deve ${fmt(jurosMaiores.saldo)} em "${jurosMaiores.nome}" ` +
          `a ${pct1(anual)} ao ano. Cada real parado ali custa ${pct1(anual - RENDIMENTO_REF)} ao ano.`,
        acao: `Usar ${fmt(emJogo)} para abater essa dívida rende mais, com certeza, do que ` +
          `qualquer investimento com risco parecido.`,
        valor: cent(emJogo * (anual - RENDIMENTO_REF) / 100),
        no_contexto: 'Plano de quitação, na Projeção',
      })
    }
  }

  // 2 · Aporta sem ter reserva.
  if (patr.investimentos > 0 && res.meses_cobertos < 3) {
    push({
      chave: 'aporte_sem_reserva', severidade: 'alto',
      titulo: 'Investindo antes de ter com que se defender',
      descricao: `São ${fmt(patr.investimentos)} investidos e ` +
        `${res.meses_cobertos.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} ` +
        `${res.meses_cobertos === 1 ? 'mês' : 'meses'} de reserva. O mínimo para dormir tranquilo ` +
        `são 3 meses de gasto essencial — ${fmt(res.gasto_medio * 3)}.`,
      acao: `Direcione os próximos aportes para a reserva até chegar em ${fmt(res.gasto_medio * 3)}. ` +
        `Investimento com reserva vazia é investimento que você resgata no pior momento.`,
      valor: cent(Math.max(0, res.gasto_medio * 3 - res.atual)),
      no_contexto: 'Tela de Aportes',
    })
  }

  // 3 · Comprometimento alto.
  if (comp > 40 && rendaM.mensal > 0) {
    push({
      chave: 'comprometimento_alto',
      severidade: comp > 60 ? 'critico' : 'alto',
      titulo: `${pct1(comp)} da renda já tem dono antes de você acordar`,
      descricao: `${fmt(prest.total)} por mês saem em prestação, de ${fmt(rendaM.mensal)} que entram. ` +
        `Os 30% que se costuma citar são referência de mercado, não regra — o que decide é ` +
        `quanto sobra em reais: hoje ${fmt(rendaM.mensal - prest.total)}.`,
      acao: 'O plano de quitação mostra em quantos meses isso acaba, e o que muda se você ' +
        'conseguir pagar um pouco a mais.',
      valor: prest.total,
      no_contexto: 'Plano de quitação, na Projeção',
    })
  }

  // 4 · O mês não fecha — mas medido em meses FECHADOS, não no dia 14.
  if (sobra < 0 && rendaM.mensal > 0) {
    const negativos = janela.base.filter(m => m.saldo < 0).length
    push({
      chave: 'mes_nao_fecha', severidade: 'critico',
      titulo: 'No ritmo atual, o mês não fecha',
      descricao: `Somando o que entra e tirando prestações e o gasto variável médio, faltam ` +
        `${fmt(Math.abs(sobra))} por mês. Isso não é leitura de um dia: ${negativos} dos ` +
        `${janela.base.length} meses fechados terminaram no vermelho.`,
      acao: `O buraco tem dois lados. Prestação: ${fmt(prest.total)}, que o plano de quitação ` +
        `ataca. Gasto variável: ${fmt(variavelMedia)}, que responde a decisão sua neste mês.`,
      valor: Math.abs(sobra),
      no_contexto: 'Para onde o dinheiro está indo, na Projeção',
    })
  }

  // 5 · Dívida contratada que ainda vai começar.
  if (divs.contratada > 0) {
    const futura = divs.lista.filter(d => !d.vigente).sort((a, b) => b.saldo - a.saldo)[0]
    push({
      chave: 'divida_contratada', severidade: 'medio',
      titulo: 'Há uma prestação assinada que ainda não começou',
      descricao: `${fmt(divs.contratada)} já estão contratados${futura?.comeca_em
        ? ` — "${futura.nome}" começa a sair em ${mesExtenso(futura.comeca_em)}` : ''}. ` +
        `Isso não entra no comprometimento de hoje, porque ainda não sai da conta. Mas entra no ` +
        `que você deve, e é bom que entre: a dívida existe mesmo antes da primeira parcela.`,
      acao: `Quando começar, ${futura?.parcela ? fmt(futura.parcela) : 'a parcela'} por mês ` +
        `se somam aos ${fmt(prest.total)} de hoje. O calendário da Projeção mostra o mês exato.`,
      valor: divs.contratada,
      no_contexto: 'Calendário, na Projeção',
    })
  }

  const ordem = { critico: 0, alto: 1, medio: 2 }
  alertas.sort((a, b) => (ordem[a.severidade] - ordem[b.severidade]) || (b.valor - a.valor))

  // ── O histórico da nota ───────────────────────────────────────────────────
  //
  // Um score sem histórico é uma nota; um score com histórico é um retorno. É
  // o que transforma a tela em algo que se abre de novo no mês seguinte, em
  // vez de uma foto que já foi vista.
  const mesAtual = new Date().toISOString().slice(0, 7)
  let historico: Array<{ mes: string; score: number }> = []
  let variacao: { pontos: number; desde: string; pilar: string | null } | null = null
  try {
    // Nota de confiança baixa não entra no histórico: gravá-la faria o gráfico
    // do mês seguinte comparar uma medição com um palpite, e o degrau
    // apareceria como progresso.
    if (sc.disponivel && conf.suficiente) {
      await db.prepare(
        `INSERT INTO score_historico (user_id, mes, score_geral)
         VALUES (?, ?, ?)
         ON CONFLICT (user_id, mes) DO UPDATE SET score_geral = ?`
      ).bind(user.id, mesAtual, sc.total, sc.total).run()
    }
    const h = await db.prepare(
      `SELECT mes, score_geral FROM score_historico
       WHERE user_id = ? ORDER BY mes ASC LIMIT 24`
    ).bind(user.id).all()
    historico = ((h.results as any[]) || []).map(r => ({
      mes: String(r.mes), score: Number(r.score_geral) || 0,
    }))
    if (historico.length >= 2 && conf.suficiente) {
      const anterior = historico[historico.length - 2]
      const pontos = Math.round((sc.total - anterior.score) * 10) / 10
      // Qual pilar mais explica a mudança: o de maior distância do peso cheio
      // não serve — o que serve é o que mais rendeu. Sem histórico por pilar,
      // aponta o de melhor desempenho e diz que é de onde veio o movimento.
      const melhor = [...sc.pilares].sort((a, b) =>
        (b.pontos / b.peso) - (a.pontos / a.peso))[0]
      if (pontos !== 0) variacao = { pontos, desde: anterior.mes, pilar: melhor?.nome ?? null }
    }
  } catch (e) {
    // Histórico é um plus. Se a tabela falhar, a nota de hoje continua de pé.
    historico = []
  }

  return c.json({
    score: conf.suficiente ? sc : {
      ...sc,
      disponivel: false,
      motivo_indisponivel: conf.motivo,
    },
    confianca: conf,
    variacao,
    historico,
    alertas,
    piso_alerta: PISO,
    recomendacoes: recs,
    // Os números de apoio que a tela cita nos textos. Vêm da camada, e são
    // exatamente os mesmos que a Projeção e o Dashboard exibem.
    contexto: {
      renda: rendaM.mensal,
      renda_meses_base: rendaM.meses_base,
      prestacoes: prest.total,
      comprometimento: comp,
      divida_vigente: divs.vigente,
      divida_contratada: divs.contratada,
      divida_total: divs.total,
      patrimonio_liquido: patr.liquido,
      reserva_atual: res.atual,
      reserva_alvo: res.alvo_valor,
      reserva_meses: res.meses_cobertos,
      gasto_essencial: res.gasto_medio,
      gasto_total: res.gasto_total,
      sobra_proximo_mes: sobra,
      meses_fechados: janela.base.length,
      gasto_nao_classificado: base.gasto_nao_classificado,
      valor_em_disputa: base.valor_em_disputa,
      atipicos: janela.atipicos.map(a => ({ label: a.label, motivo: a.motivo })),
    },
  })
})

const MES_EXT = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
                 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']

/** "2028-06-10" → "junho de 2028". Data crua num alerta não diz nada. */
function mesExtenso(d: string | null): string {
  if (!d) return ''
  const m = String(d).match(/^(\d{4})-(\d{2})/)
  return m ? `${MES_EXT[Number(m[2]) - 1]} de ${m[1]}` : String(d)
}

export default diagnostico
