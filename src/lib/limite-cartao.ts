/**
 * VerdeMais — limite de cartão: uma fonte de verdade só
 * ============================================================================
 * O app respondia "quanto sobra neste cartão" de duas maneiras que discordavam:
 *
 *   A) derivando de `card_charges` — limite_total menos a soma das faturas
 *      pendentes. É o que a tela de Cartões usava. Sempre certo, porque sai
 *      dos lançamentos reais.
 *
 *   B) lendo a coluna `cartoes.limite_disponivel` — um saldo que o código ia
 *      somando e subtraindo à mão a cada compra, estorno, edição, exclusão,
 *      pagamento de fatura e importação de CSV. Eram 25 UPDATEs espalhados por
 *      cartoes.ts, despesas.ts e importacao.ts.
 *
 * Bastava um desses 25 pontos errar — ou não existir — para a coluna
 * descolar da realidade e nunca mais voltar. E era o que acontecia: o
 * `PUT /api/cartoes/:id`, que altera o limite do cartão, não mexia nela.
 *
 * Medido em produção: cartão com limite aumentado de R$ 1.000 para R$ 6.000 e
 * R$ 900 de fatura. A tela de Cartões dizia R$ 5.100 disponíveis; o modal de
 * nova despesa dizia R$ 100 — e ainda assim exibia o limite total novo, porque
 * esse campo vinha da linha do cartão e o outro da coluna congelada.
 *
 * Quem lia a coluna congelada e mostrava número errado: o modal de despesa, os
 * alertas de cartão, as conquistas de cartão, o assistente, o diagnóstico 360°
 * e a antecipação.
 *
 * Daqui para frente só existe (A). A coluna continua no banco por
 * compatibilidade, mas ninguém decide nada com base nela.
 */

export interface LimiteCartao {
  limite_total: number
  limite_utilizado: number
  limite_disponivel: number
  percentual_uso: number
}

/** Soma das faturas em aberto de um cartão. É o que ocupa limite. */
export async function limiteDoCartao(
  db: D1Database,
  cardId: number,
  limiteTotal: number,
): Promise<LimiteCartao> {
  const uso = await db.prepare(
    `SELECT COALESCE(SUM(valor),0) as total FROM card_charges
     WHERE card_id = ? AND status = 'pendente'`
  ).bind(cardId).first() as any

  return montar(Number(limiteTotal || 0), Number(uso?.total || 0))
}

/**
 * Versão em lote — uma query só para todos os cartões do usuário, para não
 * fazer N+1 em tela que lista cartões.
 * Devolve um mapa `card_id -> LimiteCartao`.
 */
export async function limitesDosCartoes(
  db: D1Database,
  userId: number,
): Promise<Map<number, LimiteCartao>> {
  const rows = await db.prepare(
    `SELECT c.id, c.limite_total, COALESCE(SUM(cc.valor), 0) as utilizado
     FROM cartoes c
     LEFT JOIN card_charges cc ON cc.card_id = c.id AND cc.status = 'pendente'
     WHERE c.user_id = ?
     GROUP BY c.id, c.limite_total`
  ).bind(userId).all()

  const mapa = new Map<number, LimiteCartao>()
  for (const r of (rows.results as any[] || [])) {
    mapa.set(Number(r.id), montar(Number(r.limite_total || 0), Number(r.utilizado || 0)))
  }
  return mapa
}

function montar(total: number, utilizado: number): LimiteCartao {
  const util = arred(utilizado)
  // O disponível pode ficar negativo se o limite for reduzido abaixo do que já
  // está em aberto. Mostrar 0 nesse caso esconderia o problema do usuário —
  // melhor ele ver que está estourado.
  const disp = arred(total - util)
  return {
    limite_total:      arred(total),
    limite_utilizado:  util,
    limite_disponivel: disp,
    percentual_uso:    total > 0 ? Math.round((util / total) * 100) : 0,
  }
}

const arred = (v: number) => Math.round(v * 100) / 100

/**
 * Expressão SQL do limite disponível, para consultas que já leem a tabela
 * `cartoes` e só precisam do número junto — sem uma segunda ida ao banco.
 *
 * Use no lugar da coluna `limite_disponivel`:
 *   SELECT id, nome, limite_total, ${sqlLimiteDisponivel('c')} AS limite_disponivel
 *   FROM cartoes c ...
 */
export function sqlLimiteDisponivel(alias = 'cartoes'): string {
  return `(${alias}.limite_total - COALESCE(
    (SELECT SUM(cc.valor) FROM card_charges cc
      WHERE cc.card_id = ${alias}.id AND cc.status = 'pendente'), 0))`
}

/** O complemento: quanto está ocupado. */
export function sqlLimiteUtilizado(alias = 'cartoes'): string {
  return `COALESCE((SELECT SUM(cc.valor) FROM card_charges cc
      WHERE cc.card_id = ${alias}.id AND cc.status = 'pendente'), 0)`
}
