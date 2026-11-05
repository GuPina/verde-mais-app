/**
 * VerdeMais — financiamento imobiliário
 * ============================================================================
 * Os números imitam o caso do Gustavo: apartamento na planta, entrada em
 * dezenas de parcelas de R$ 150 a R$ 600, evolução de obra crescendo mês a
 * mês, chaves no futuro.
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import { candidatos, agruparSeries, painel, indicadores, sugestoes, papelPorApelido, simularAmortizacao, type Fin, type Pago, type Linha } from '../src/lib/imobiliario'

const HOJE = '2026-11-05'
const FIN: Fin = {
  id: 1, descricao: 'Apto Vila Prime', banco: 'Caixa', construtora: 'MRV', tipo_financiamento: 'planta', tipo_bem: 'imovel',
  valor_imovel: 400000, valor_entrada: 40000, valor_financiado: 320000, saldo_devedor: 320000, valor_parcela: 2850,
  taxa_juros_mensal: 0.8, numero_parcelas: 360, parcelas_pagas: 0, sistema_amortizacao: 'sac',
  data_inicio: '2028-03-01', data_chaves: '2028-02-15', evolucao_obra_pct: 42,
}
let seq = 1
const L = (descricao: string, data: string, valor: number, extra: Partial<Linha> = {}): Linha =>
  ({ id: seq++, descricao, data, valor, categoria: 'Moradia', status: 'pago', ...extra })

test('entrada parcelada (com "(3/36)") é candidata; parcela de outro dono e compra qualquer não', () => {
  const linhas = [
    L('ENTRADA APTO VILA PRIME (3/36)', '2026-06-10', 420),
    L('ENTRADA APTO VILA PRIME (4/36)', '2026-07-10', 435),
    L('MRV ENGENHARIA PARC 5/36', '2026-08-10', 180),
    L('EVOLUCAO DE OBRA CAIXA', '2026-08-20', 610),
    L('NOTEBOOK DELL (3/12)', '2026-08-10', 450, { categoria: 'Tecnologia' }),
    L('PARCELA FINANCIAMENTO CAIXA', '2026-08-10', 300, { observacoes: 'Empréstimo automático #2' }),
    L('MERCADO EXTRA', '2026-08-10', 380, { categoria: 'Alimentação' }),
    L('ITBI PREFEITURA', '2026-07-01', 8000, { categoria: 'Impostos' }),
  ]
  const c = candidatos({ fin: FIN, linhas, vinculados: [], apelidos: [] })
  const por = Object.fromEntries(c.map(x => [x.descricao, x.papel]))
  assert.equal(por['ENTRADA APTO VILA PRIME (3/36)'], 'entrada')
  assert.equal(por['MRV ENGENHARIA PARC 5/36'] !== undefined, true, 'construtora no nome não foi achada')
  assert.equal(por['EVOLUCAO DE OBRA CAIXA'], 'obra')
  assert.equal(por['NOTEBOOK DELL (3/12)'], undefined)
  assert.equal(por['PARCELA FINANCIAMENTO CAIXA'], undefined, 'parcela de empréstimo virou candidata')
  assert.equal(por['MERCADO EXTRA'], undefined)
  assert.equal(por['ITBI PREFEITURA'], 'extra', 'ITBI fora da categoria de moradia ficou de fora')
})

test('já vinculada a um financiamento ou dispensada não volta', () => {
  const a = L('ENTRADA APTO VILA PRIME', '2026-06-10', 420, { financiamento_id: 9 })
  const b = L('ENTRADA APTO VILA PRIME', '2026-07-10', 420)
  const c0 = L('ENTRADA APTO VILA PRIME', '2026-08-10', 420)
  const c = candidatos({ fin: FIN, linhas: [a, b, c0], vinculados: [], apelidos: [], dispensadas: new Set([`fin:1:${b.id}`]) })
  assert.deepEqual(c.map(x => x.id), [c0.id], 'só a livre e não dispensada pode aparecer')
})

test('apelido confirmado decide o papel e pesa mais que palavra-chave', () => {
  const l = L('PIX MARIA SILVA CORRETORA', '2026-08-10', 300)
  assert.equal(candidatos({ fin: FIN, linhas: [l], vinculados: [], apelidos: [] }).length, 0)
  const c = candidatos({ fin: FIN, linhas: [l], vinculados: [], apelidos: [{ papel: 'extra', texto: 'MARIA SILVA CORRETORA' }] })
  assert.equal(c[0].papel, 'extra')
})

test('vínculo automático por apelido só quando um único financiamento/papel casa', () => {
  const ap = [{ financiamento_id: 1, papel: 'obra' as const, texto: 'EVOLUCAO DE OBRA' }]
  assert.equal(papelPorApelido('EVOLUCAO DE OBRA 11/2026', ap)?.papel, 'obra')
  assert.equal(papelPorApelido('EVOLUCAO DE OBRA', [...ap, { financiamento_id: 2, papel: 'obra' as const, texto: 'EVOLUCAO DE OBRA' }]), null)
  assert.equal(papelPorApelido('CONTA DE LUZ', ap), null)
})

// ─── Painel ──────────────────────────────────────────────────────────────────

function historia(): Pago[] {
  const ps: Pago[] = []
  let id = 1000
  for (let m = 1; m <= 10; m++) {
    const mm = String(m).padStart(2, '0')
    ps.push({ id: id++, descricao: `ENTRADA (${m}/36)`, valor: 150 + m * 40, data: `2026-${mm}-10`, status: 'pago', papel: 'entrada' })
    if (m >= 5) ps.push({ id: id++, descricao: 'EVOLUCAO DE OBRA', valor: 300 + (m - 5) * 60, data: `2026-${mm}-20`, status: 'pago', papel: 'obra' })
  }
  ps.push({ id: id++, descricao: 'ITBI', valor: 8000, data: '2026-02-01', status: 'pago', papel: 'extra' })
  ps.push({ id: id++, descricao: 'ENTRADA (11/36)', valor: 590, data: '2026-11-10', status: 'pendente', papel: 'entrada' })
  return ps
}

test('painel separa o que virou patrimônio do que foi custo', () => {
  const p = painel({ fin: FIN, pagos: historia(), hoje: HOJE })
  const entrada = p.blocos.find(b => b.papel === 'entrada')!
  assert.equal(entrada.pago, 10 * 150 + 40 * 55)          // 3.700
  assert.equal(entrada.pendente, 590)
  assert.equal(p.entrada.contratada, 40000)
  assert.equal(p.entrada.falta, 40000 - 3700)
  assert.equal(p.totais.custo, (300 + 360 + 420 + 480 + 540 + 600) + 8000)
  assert.equal(p.totais.patrimonio, 3700)
  assert.equal(p.fase, 'obra')
  assert.equal(p.meses_ate_chaves, 15)
})

test('série mensal empilha por papel e marca o futuro', () => {
  const p = painel({ fin: FIN, pagos: historia(), hoje: HOJE })
  const out = p.serie.find(m => m.mes === '2026-10')!
  assert.deepEqual([out.por_papel.entrada, out.por_papel.obra], [550, 600])
  assert.equal(out.total, 1150)
  assert.equal(p.serie.find(m => m.mes === '2026-12')!.futuro, true)
})

test('financiamento pronto (sem planta) já está em amortização', () => {
  const p = painel({ fin: { ...FIN, tipo_financiamento: 'pronto', data_chaves: null }, pagos: [], hoje: HOJE })
  assert.equal(p.fase, 'amortizacao')
})

// ─── Indicadores e sugestões ─────────────────────────────────────────────────

test('próxima evolução de obra pela tendência, e alerta quando acelera', () => {
  const ps = historia()
  const p = painel({ fin: FIN, pagos: ps, hoje: HOJE })
  const ind = indicadores({ fin: FIN, painel: p, pagos: ps, hoje: HOJE, renda_mensal: 9000 })
  // 480 → 540 → 600: cresce ~11% ao mês; a próxima fica perto de 666.
  assert.ok(ind.obra.proximo!.por_tendencia! > 640 && ind.obra.proximo!.por_tendencia! < 690, String(ind.obra.proximo!.por_tendencia))
  assert.equal(ind.obra.proximo!.pelo_pct, Math.round(320000 * 0.42 * 0.008 * 100) / 100)
  // Subiu 11% num mês em que o ritmo vinha 12–20%: crescimento normal, sem alerta.
  assert.ok(!sugestoes({ fin: FIN, painel: p, ind }).some(s => s.titulo.includes('acelerou')))

  const salto = [...ps, { id: 9999, descricao: 'EVOLUCAO DE OBRA', valor: 900, data: '2026-11-03', status: 'pago', papel: 'obra' as const }]
  const p2 = painel({ fin: FIN, pagos: salto, hoje: HOJE })
  const ind2 = indicadores({ fin: FIN, painel: p2, pagos: salto, hoje: HOJE, renda_mensal: 9000 })
  assert.ok(sugestoes({ fin: FIN, painel: p2, ind: ind2 }).some(s => s.titulo.includes('acelerou')))
})

test('parcela pós-chaves acima de 30% da renda vira alerta', () => {
  const p = painel({ fin: FIN, pagos: [], hoje: HOJE })
  const ind = indicadores({ fin: FIN, painel: p, pagos: [], hoje: HOJE, renda_mensal: 8000 })
  assert.equal(ind.pct_renda_pos_chaves, 35.6)
  assert.ok(sugestoes({ fin: FIN, painel: p, ind }).some(s => s.tipo === 'alerta' && s.titulo.includes('chaves')))
})

test('amortizado só conta o que as parcelas vinculadas mostram', () => {
  const fin = { ...FIN, tipo_financiamento: 'pronto', saldo_devedor: 300000, parcelas_pagas: 10 }
  const sem = indicadores({ fin, painel: painel({ fin, pagos: [], hoje: HOJE }), pagos: [], hoje: HOJE })
  assert.equal(sem.amortizado, 0)
  assert.equal(sem.amortizado_contrato, 20000)
  const ps: Pago[] = Array.from({ length: 10 }, (_, k) => ({ id: k + 1, descricao: 'Prestação', valor: 2850, data: `2026-0${(k % 9) + 1}-05`, status: 'pago', papel: 'parcela' }))
  const com = indicadores({ fin, painel: painel({ fin, pagos: ps, hoje: HOJE }), pagos: ps, hoje: HOJE })
  assert.equal(com.amortizado, 20000)
  assert.equal(com.custo_detalhe.juros_nas_parcelas, 28500 - 20000)
})

test('amortização extra: reduzir prazo economiza mais juros que reduzir parcela', () => {
  const fin = { ...FIN, sistema_amortizacao: 'price', saldo_devedor: 300000, parcelas_pagas: 10 }
  const prazo = simularAmortizacao(fin, 15000, 'prazo')!
  const parcela = simularAmortizacao(fin, 15000, 'parcela')!
  assert.ok(prazo.meses_a_menos > 0)
  assert.ok(prazo.juros_economizados > parcela.juros_economizados)
  assert.ok(parcela.parcela_nova! < 300000 * 0.008 / (1 - Math.pow(1.008, -350)))
})

// ─── Parcelas de uma mesma compra ────────────────────────────────────────────

test('parcelas sem "(3/10)" no nome são reconhecidas pelos campos e agrupadas por compra', () => {
  const g1 = 'aaaa-1111', g2 = 'bbbb-2222'
  const linhas: Linha[] = [
    L('Entrada Apartamento (2/10)', '2026-11-07', 157.94, { parcela_atual: 2, numero_parcelas: 10, purchase_group_id: g1, status: 'pendente' }),
    L('Entrada Apartamento', '2026-12-07', 157.94, { parcela_atual: 3, numero_parcelas: 10, purchase_group_id: g1, status: 'pendente' }),
    L('Entrada Apartamento', '2026-11-07', 157.03, { parcela_atual: 3, numero_parcelas: 10, purchase_group_id: g2, status: 'pendente' }),
    L('Entrada Apartamento (4/10)', '2026-12-07', 157.03, { parcela_atual: 4, numero_parcelas: 10, purchase_group_id: g2, status: 'pendente' }),
    L('Entrada Apartamento', '2026-12-07', 157.03, { parcela_atual: 4, numero_parcelas: 10, purchase_group_id: g2, status: 'pendente' }),
    L('Entrada Apartamento 5/7', '2026-11-07', 210.36, { parcela_atual: 5, numero_parcelas: 7, data_compra: '2026-10-26', status: 'pendente' }),
    L('Entrada Apartamento 6/7', '2026-12-07', 210.36, { parcela_atual: 6, numero_parcelas: 7, data_compra: '2026-10-26', status: 'pendente' }),
  ]
  const c = candidatos({ fin: FIN, linhas, vinculados: [], apelidos: [] })
  assert.equal(c.length, 7)
  const sem = c.find(x => x.descricao === 'Entrada Apartamento' && x.valor === 157.94)!
  assert.deepEqual(sem.parcela, { atual: 3, total: 10 }, 'parcela sem número no nome perdeu o 3/10')

  const ss = agruparSeries(c)
  assert.equal(ss.length, 3, 'duas compras em 10x e uma em 7x são três séries')
  const s2 = ss.find(x => x.chave === `g:${g2}`)!
  assert.deepEqual(s2.repetidas, [4], 'a 4/10 lançada duas vezes não foi apontada')
  assert.equal(s2.valor_total, 471.09)
  assert.deepEqual(s2.ausentes, [1, 2, 5, 6, 7, 8, 9, 10])
  const s7 = ss.find(x => x.total_parcelas === 7)!
  assert.equal(s7.descricao, 'Entrada Apartamento', 'o "5/7" ficou no nome da série')
  assert.equal(s7.data_compra, '2026-10-26')
  assert.equal(s7.papel, 'entrada')
})
