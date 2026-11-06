/**
 * VerdeMais — o motor de recorrências
 * ============================================================================
 * Cada teste aqui é um jeito concreto de o rastreio mentir: sugerir uma
 * compra em 12x como conta mensal, recusar o aluguel que vence no fim do mês,
 * chamar o Uber de assinatura, esconder o reajuste que a pessoa fez na tela
 * de Despesas.
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  temDono, medirPadrao, motivoRecusa, rastrear, linhaDoTempo, casaRegra, regraPadrao, candidatosPara, aprenderApelidos,
  type Lancamento, type Recorrencia,
} from '../src/lib/recorrencias'
import { compraQueVenceEm, faturaDaCompra } from '../src/lib/fatura'

const HOJE = '2026-11-05'
let seq = 1
const L = (descricao: string, data: string, valor: number, extra: Partial<Lancamento> = {}): Lancamento =>
  ({ id: seq++, descricao, data, valor, status: 'pago', ...extra })

/** Uma linha por mês, do mês `de` (YYYY-MM) por `n` meses, no dia `dia`. */
function mensal(descricao: string, de: string, n: number, dia: number, valor: number | ((i: number) => number), extra: Partial<Lancamento> = {}) {
  let [a, m] = de.split('-').map(Number)
  const out: Lancamento[] = []
  for (let i = 0; i < n; i++) {
    const ult = new Date(Date.UTC(a, m, 0)).getUTCDate()
    const d = Math.min(dia, ult)
    out.push(L(descricao, `${a}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`,
      typeof valor === 'function' ? valor(i) : valor, extra))
    m++; if (m > 12) { m = 1; a++ }
  }
  return out
}

// ─── Séries com dono ─────────────────────────────────────────────────────────

test('compra em 12x no cartão nunca vira sugestão de recorrência', () => {
  const compra = mensal('NOTEBOOK DELL', '2026-01', 11, 10, 450, { numero_parcelas: 12, parcelado: 1, cartao_id: 1 })
    .map((l, i) => ({ ...l, descricao: `NOTEBOOK DELL (${i + 1}/12)` }))
  const r = rastrear({ tipo: 'despesa', lancamentos: compra, recorrencias: [], hoje: HOJE })
  assert.equal(r.novas.length, 0)
  assert.equal(r.ignoradas_com_dono, 11)
})

test('importada sem "(3/12)" no texto e sem flag de parcelado: o número de parcelas basta', () => {
  const ls = mensal('NOTEBOOK DELL', '2026-01', 10, 10, 450, { numero_parcelas: 12, parcelado: 0 })
  assert.equal(rastrear({ tipo: 'despesa', lancamentos: ls, recorrencias: [], hoje: HOJE }).novas.length, 0)
})

test('vence dia 31 com folga zero: 28 de fevereiro e 30 de abril ainda batem', () => {
  const aluguel: Recorrencia = { id: 7, tipo: 'despesa', descricao: 'Aluguel', valor: 1800, dia_vencimento: 31 }
  const regra = { ...regraPadrao(aluguel), tol_dias: 0 }
  assert.equal(casaRegra(L('ALUGUEL', '2026-02-28', 1800), aluguel, regra).dia, true)
  assert.equal(casaRegra(L('ALUGUEL', '2026-04-30', 1800), aluguel, regra).dia, true)
  assert.equal(casaRegra(L('ALUGUEL', '2026-04-20', 1800), aluguel, regra).dia, false)
})

test('parcela só no texto ("LOJA 03/12") também tem dono; data no texto ("LUZ 15/11") não', () => {
  assert.equal(temDono(L('MAGAZINE LUIZA 03/12', '2026-10-01', 100)), true)
  assert.equal(temDono(L('PARC 3/10 RENNER', '2026-10-01', 100)), true)
  assert.equal(temDono(L('CONTA LUZ 15/11', '2026-10-01', 100)), false)
  assert.equal(temDono(L('Financiamento', '2026-10-01', 100, { observacoes: 'Financiamento automático #4' })), true)
  assert.equal(temDono(L('Restituição', '2026-10-01', 100, { observacoes: '[recebimento #7] parcela' })), true)
  // Vínculo com RECORRÊNCIA não é dono: é exatamente o que o motor quer ler.
  assert.equal(temDono(L('Netflix', '2026-10-01', 55.9, { recorrencia_id: 3 })), false)
})

// ─── Padrão ──────────────────────────────────────────────────────────────────

test('aluguel no fim do mês é reconhecido, mesmo com fevereiro no meio', () => {
  const aluguel = mensal('ALUGUEL APTO', '2026-01', 10, 31, 1800)
  const p = medirPadrao(aluguel, HOJE)!
  assert.equal(p.dia_tipico, 31)
  assert.equal(p.dispersao_dia, 0)
  assert.equal(motivoRecusa(p), null)
})

test('dia 30 e dia 2 estão perto: atraso na virada do mês não quebra o padrão', () => {
  const ls = [L('ACADEMIA', '2026-06-30', 99), L('ACADEMIA', '2026-08-02', 99), L('ACADEMIA', '2026-08-30', 99),
    L('ACADEMIA', '2026-09-30', 99), L('ACADEMIA', '2026-10-30', 99)]
  const p = medirPadrao(ls, HOJE)!
  assert.ok(p.dispersao_dia <= 2, `dispersão ${p.dispersao_dia}`)
})

test('Uber várias vezes por mês é hábito, não recorrência', () => {
  const ls: Lancamento[] = []
  for (let m = 5; m <= 10; m++) for (const d of [3, 11, 19, 26]) ls.push(L('UBER *TRIP', `2026-${String(m).padStart(2, '0')}-${d}`, 20 + d))
  const r = rastrear({ tipo: 'despesa', lancamentos: ls, recorrencias: [], hoje: HOJE })
  assert.equal(r.novas.length, 0)
  assert.equal(motivoRecusa(medirPadrao(ls, HOJE)!), 'repete mais de uma vez por mês')
})

test('conta de luz com valor que varia é sugerida como recorrência de valor variável', () => {
  const luz = mensal('ENEL SP', '2026-03', 8, 12, i => [180, 240, 210, 305, 190, 260, 220, 280][i])
  const r = rastrear({ tipo: 'despesa', lancamentos: luz, recorrencias: [], hoje: HOJE })
  assert.equal(r.novas.length, 1)
  assert.equal(r.novas[0].padrao.valor_variavel, true)
  assert.equal(r.novas[0].regra.tol_valor_pct, null, 'regra de conta variável não pode travar no valor')
})

test('assinatura que parou há meses não é sugerida', () => {
  const ls = mensal('SPOTIFY', '2025-11', 5, 8, 21.9)
  assert.match(String(motivoRecusa(medirPadrao(ls, HOJE)!)), /parou há/)
})

test('salário é rastreado em receitas, separado das despesas', () => {
  const sal = mensal('SALARIO EMPRESA X', '2026-04', 7, 5, 6200)
  const rd = rastrear({ tipo: 'receita', lancamentos: sal, recorrencias: [], hoje: HOJE })
  assert.equal(rd.novas.length, 1)
  assert.equal(rd.novas[0].tipo, 'receita')
  assert.equal(rd.novas[0].ids.length, 7)
})

// ─── Soltas e regra ──────────────────────────────────────────────────────────

const NETFLIX: Recorrencia = { id: 9, tipo: 'despesa', descricao: 'Netflix', valor: 55.9, dia_vencimento: 15, valor_variavel: 0 }

test('lançamento sem vínculo que bate na regra aparece como solto, não como recorrência nova', () => {
  const ligados = mensal('NETFLIX.COM', '2026-05', 4, 15, 55.9, { recorrencia_id: 9 })
  const solto = L('NETFLIX.COM', '2026-09-16', 59.9) // reajustou e não foi vinculado
  const r = rastrear({ tipo: 'despesa', lancamentos: [...ligados, solto], recorrencias: [NETFLIX], hoje: HOJE })
  assert.equal(r.soltas.length, 1)
  assert.equal(r.soltas[0].lancamento_id, solto.id)
  assert.equal(r.soltas[0].criterios.valor, true, '59,90 está dentro dos 10% de 55,90')
  assert.equal(r.novas.length, 0)
})

test('mesmo texto, mas valor E dia fora: não vira solta nem recorrência duplicada', () => {
  // Maio a outubro: padrão mensal ativo, que SERIA sugerido se o texto não
  // fosse de uma recorrência existente.
  const ls = mensal('NETFLIX.COM', '2026-05', 6, 2, 120)
  const r = rastrear({ tipo: 'despesa', lancamentos: ls, recorrencias: [NETFLIX], hoje: HOJE })
  assert.equal(r.soltas.length, 0)
  assert.equal(r.novas.length, 0)
})

test('solta num mês que já tem lançamento vinculado vem marcada como mês ocupado', () => {
  const ligado = L('NETFLIX.COM', '2026-10-15', 55.9, { recorrencia_id: 9 })
  const outro = L('NETFLIX.COM', '2026-10-17', 55.9)
  const r = rastrear({ tipo: 'despesa', lancamentos: [ligado, outro], recorrencias: [NETFLIX], hoje: HOJE })
  assert.equal(r.soltas[0].mes_ocupado, true)
})

test('dispensar uma sugestão faz ela sumir do próximo rastreio', () => {
  const sal = mensal('SALARIO EMPRESA X', '2026-04', 7, 5, 6200)
  const r = rastrear({ tipo: 'receita', lancamentos: sal, recorrencias: [], hoje: HOJE,
    dispensadas: new Set(['nova:receita:SALARIO EMPRESA X']) })
  assert.equal(r.novas.length, 0)
})

test('regra: tolerância de valor, de dia, e cartão', () => {
  const regra = { ...regraPadrao(NETFLIX), cartao_id: 2 }
  assert.equal(casaRegra(L('NETFLIX.COM', '2026-10-18', 60, { cartao_id: 2 }), NETFLIX, regra).total, true)
  assert.equal(casaRegra(L('NETFLIX.COM', '2026-10-18', 70, { cartao_id: 2 }), NETFLIX, regra).valor, false)
  // Fora do cartão o dia conta; no cartão a data é o vencimento da fatura e não diz nada.
  assert.equal(casaRegra(L('NETFLIX.COM', '2026-10-25', 55.9), NETFLIX, regraPadrao(NETFLIX)).dia, false)
  assert.equal(casaRegra(L('NETFLIX.COM', '2026-10-25', 55.9, { cartao_id: 2 }), NETFLIX, regra).dia, true)
  assert.equal(casaRegra(L('NETFLIX.COM', '2026-10-15', 55.9, { cartao_id: 3 }), NETFLIX, regra).cartao, false)
  assert.equal(casaRegra(L('AMAZON PRIME', '2026-10-15', 55.9, { cartao_id: 2 }), NETFLIX, regra).texto, false)
})

// ─── Linha do tempo ──────────────────────────────────────────────────────────

test('linha do tempo mostra o valor ajustado em Despesas, não o da recorrência', () => {
  const ls = mensal('Netflix', '2026-06', 5, 15, i => (i < 3 ? 55.9 : 59.9), { recorrencia_id: 9 })
  const t = linhaDoTempo({ recorrencia: { ...NETFLIX, data_inicio: '2026-06-01' }, vinculados: ls, hoje: HOJE })
  const out = t.passadas.find(m => m.mes === '2026-10')!
  assert.equal(out.lancamentos[0].valor, 59.9)
  assert.equal(out.lancamentos[0].ajuste, 4)
  assert.equal(t.resumo.meses_ajustados, 2)
  assert.deepEqual(t.reajuste, { de: 55.9, para: 59.9, meses: 2 })
})

test('mês sem lançamento: faltou no passado, aguardando no mês corrente, previsto no futuro', () => {
  const ls = [L('Netflix', '2026-08-15', 55.9, { recorrencia_id: 9 }), L('Netflix', '2026-10-15', 55.9, { recorrencia_id: 9 })]
  const t = linhaDoTempo({ recorrencia: { ...NETFLIX, data_inicio: '2026-08-01' }, vinculados: ls, hoje: HOJE, meses_futuros: 2 })
  const est = Object.fromEntries(t.passadas.map(m => [m.mes, m.estado]))
  assert.deepEqual(est, { '2026-11': 'aguardando', '2026-10': 'pago', '2026-09': 'faltou', '2026-08': 'pago' })
  assert.deepEqual(t.proximas.map(m => m.estado), ['previsto', 'previsto'])
  assert.equal(t.reajuste, null)
})

test('lançamento futuro já gerado aparece nas próximas como pendente', () => {
  const futura = L('Netflix', '2026-12-15', 55.9, { recorrencia_id: 9, status: 'pendente' })
  const t = linhaDoTempo({ recorrencia: NETFLIX, vinculados: [futura], hoje: HOJE, meses_futuros: 3 })
  assert.equal(t.proximas[0].estado, 'pendente')
  assert.equal(t.proximas[0].lancamentos[0].id, futura.id)
})

test('recorrência encerrada não projeta meses depois do fim', () => {
  const t = linhaDoTempo({ recorrencia: { ...NETFLIX, data_inicio: '2026-01-01', data_fim: '2026-12-31' }, vinculados: [], hoje: HOJE, meses_futuros: 6 })
  assert.deepEqual(t.proximas.map(m => m.mes), ['2026-12'])
})

test('receita: mês com lançamento é "recebido"', () => {
  const rec: Recorrencia = { id: 4, tipo: 'receita', descricao: 'Salário', valor: 6200, dia_vencimento: 5 }
  const t = linhaDoTempo({ recorrencia: rec, vinculados: [L('Salário', '2026-11-05', 6200, { recorrencia_id: 4 })], hoje: HOJE })
  assert.equal(t.passadas[0].estado, 'recebido')
})

test('valor variável não inventa ajuste nem reajuste', () => {
  const luz: Recorrencia = { id: 5, tipo: 'despesa', descricao: 'Luz', valor: 200, dia_vencimento: 12, valor_variavel: 1 }
  const ls = mensal('Luz', '2026-07', 4, 12, i => 230 + i * 10, { recorrencia_id: 5 })
  const t = linhaDoTempo({ recorrencia: luz, vinculados: ls, hoje: HOJE })
  assert.equal(t.resumo.meses_ajustados, 0)
  assert.equal(t.reajuste, null)
})

test('duas recorrências casam com o mesmo lançamento: não é solta de nenhuma (decisão da pessoa)', () => {
  const a: Recorrencia = { id: 21, tipo: 'despesa', descricao: 'Google', valor: 9.99, dia_vencimento: 10 }
  const b: Recorrencia = { id: 22, tipo: 'despesa', descricao: 'Google One', valor: 9.99, dia_vencimento: 10 }
  const r = rastrear({ tipo: 'despesa', lancamentos: [L('GOOGLE ONE', '2026-10-10', 9.99)], recorrencias: [a, b], hoje: HOJE })
  assert.equal(r.soltas.length, 0)
})

// ─── Procurar lançamentos de uma recorrência ─────────────────────────────────

const OBRA: Recorrencia = { id: 30, tipo: 'despesa', descricao: 'Juros de obra', valor: 0, dia_vencimento: 20, valor_variavel: 1, categoria: 'Moradia' }

test('"Evolução de obra" aparece como candidato de "Juros de obra"; mercado não', () => {
  const ls = [
    ...mensal('Juros de obra', '2026-03', 3, 20, i => 410 + i * 12, { recorrencia_id: 30, categoria: 'Moradia' }),
    ...mensal('EVOLUCAO DE OBRA', '2026-06', 4, 21, i => 450 + i * 10, { categoria: 'Moradia' }),
    L('MERCADO PAO DE ACUCAR', '2026-07-20', 430, { categoria: 'Alimentação' }),
  ]
  const c = candidatosPara({ recorrencia: OBRA, regra: regraPadrao(OBRA), lancamentos: ls })
  assert.equal(c.length, 4, JSON.stringify(c.map(x => [x.descricao, x.pontos])))
  assert.ok(c.every(x => x.descricao === 'EVOLUCAO DE OBRA'))
  assert.ok(c[0].motivos.some(m => /obra/.test(m)))
})

test('candidato em mês já ocupado perde pontos para um igual em mês vazio', () => {
  const ls = [L('Juros de obra', '2026-06-20', 450, { recorrencia_id: 30, categoria: 'Moradia' }),
    L('EVOLUCAO DE OBRA', '2026-06-21', 450, { categoria: 'Moradia' }),
    L('EVOLUCAO DE OBRA', '2026-07-21', 450, { categoria: 'Moradia' })]
  const c = candidatosPara({ recorrencia: OBRA, regra: regraPadrao(OBRA), lancamentos: ls })
  const jun = c.find(x => x.data === '2026-06-21')!, jul = c.find(x => x.data === '2026-07-21')!
  assert.equal(jun.mes_ocupado, true)
  // +10 por ocupar um mês vazio e −15 por cair num mês que já tem o seu.
  assert.equal(jul.pontos - jun.pontos, 25)
})

test('confirmar "Evolução de obra" ensina o apelido, e a regra passa a casar sozinha', () => {
  const regra = regraPadrao(OBRA)
  const evo = L('EVOLUCAO DE OBRA', '2026-08-21', 470)
  assert.equal(casaRegra(evo, OBRA, regra).texto, false)
  const apelidos = aprenderApelidos(regra, OBRA, [evo, L('Juros de obra', '2026-08-20', 470)])
  assert.deepEqual(apelidos, ['EVOLUCAO DE OBRA'], 'o nome que a regra já pega não vira apelido')
  assert.equal(casaRegra(L('PIX EVOLUCAO DE OBRA 09/2026', '2026-09-21', 480), OBRA, { ...regra, apelidos }).texto, true)
})

test('dispensado não volta na busca', () => {
  const evo = L('EVOLUCAO DE OBRA', '2026-08-21', 470, { categoria: 'Moradia' })
  const c = candidatosPara({ recorrencia: OBRA, regra: regraPadrao(OBRA), lancamentos: [evo], dispensadas: new Set([`solta:30:${evo.id}`]) })
  assert.equal(c.length, 0)
})

// ─── Lançar o mês que faltou, no cartão ──────────────────────────────────────

test('cartão: a compra escolhida vence exatamente no mês pedido', () => {
  for (const [fech, venc] of [[25, 5], [3, 10], [31, 10], [10, 20], [28, 7]])
    for (const alvo of ['2026-01', '2026-03', '2026-10', '2026-12'])
      for (const dia of [1, 15, 28, 31]) {
        const f = compraQueVenceEm(alvo, dia, fech, venc)
        assert.ok(f, `sem compra para ${alvo} (fecha ${fech}, vence ${venc}, dia ${dia})`)
        assert.equal(faturaDaCompra(f!.data_compra, fech, venc).vencimento.slice(0, 7), alvo)
      }
})

// ─── Parcela sem número no nome ──────────────────────────────────────────────

test('parcela sem "(3/10)" no nome não vira recorrência: campos, card_charge ou grupo da compra denunciam', () => {
  // As 10 parcelas de uma compra no cartão, renomeadas sem o número.
  const viaGrupo = mensal('Entrada Apartamento', '2026-02', 9, 7, 157.94, { purchase_group_id: 'g-1', grupo_n: 9 })
  const viaCartao = mensal('Seguro Residencial', '2026-02', 9, 12, 89.9, { cc_total_parcelas: 10 })
  const r = rastrear({ tipo: 'despesa', lancamentos: [...viaGrupo, ...viaCartao], recorrencias: [], hoje: HOJE })
  assert.equal(r.novas.length, 0, JSON.stringify(r.novas.map(n => n.chave)))
  assert.equal(r.ignoradas_com_dono, 18)
  // Compra em 1x no cartão também tem grupo — sozinha no grupo, continua candidata.
  const umaVez = mensal('Netflix', '2026-05', 6, 15, 55.9, { purchase_group_id: 'x', grupo_n: 1 })
  assert.equal(temDono(umaVez[0]), false)
})

test('linha do tempo mostra os juros/taxa embutidos no lançamento', () => {
  const ls = [L('Condomínio no cartão', '2026-10-10', 1030, { recorrencia_id: 9, valor_juros: 30 })]
  const t = linhaDoTempo({ recorrencia: { ...NETFLIX, valor: 1030 }, vinculados: ls, hoje: HOJE })
  assert.equal(t.passadas.find(m => m.mes === '2026-10')!.lancamentos[0].juros, 30)
})

test('o que repete mas não passa no critério sai como "quase", com o motivo', () => {
  const ls = [
    ...mensal('SALARIO EMPRESA X', '2026-01', 6, 5, 6200),                 // parou em junho
    ...mensal('FREELA DESIGN', '2026-06', 4, 3, 900).map((l, i) => ({ ...l, data: ['2026-06-03', '2026-06-20', '2026-08-01', '2026-10-25'][i] })),
  ]
  const r = rastrear({ tipo: 'receita', lancamentos: ls, recorrencias: [], hoje: HOJE })
  assert.equal(r.novas.length, 0)
  const q = Object.fromEntries(r.quase.map(x => [x.chave, x.motivo]))
  assert.match(q['SALARIO EMPRESA X'], /parou há/)
  assert.ok(q['FREELA DESIGN'], JSON.stringify(r.quase))
})
