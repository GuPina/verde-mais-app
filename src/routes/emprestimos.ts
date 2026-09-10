import { Hono } from 'hono'
import { requireAuth } from './auth'
import { getLimites, MSG_UPGRADE } from './planos'
import { ensureTag, tagDespesa, COR_MODULO } from '../utils/tags-helper'

type Bindings = { DB: D1Database }
type Variables = { user: { id: number; nome: string; email: string; plano: string } }

const emprestimos = new Hono<{ Bindings: Bindings; Variables: Variables }>()

// ─── Helpers de validação (EMP9/EMP11/EMP12/EMP16) ───────────────────────────
const MAX_PARCELAS = 600
const TIPOS_VALIDOS = ['pessoal', 'consignado', 'veiculo', 'estudantil', 'microempresa', 'amigos_familia', 'imovel', 'imovel_comercial', 'rural', 'outros']
// id de rota: só inteiro positivo, senão null → 400 (nunca 500) — EMP12
function parseId(v: any): number | null {
  const t = String(v ?? '')
  return /^\d+$/.test(t) && parseInt(t, 10) > 0 ? parseInt(t, 10) : null
}
// data válida (ISO ou DD/MM/AAAA) — EMP11/EMP19
function dataValida(s: any): boolean {
  return parseDataSegura(String(s ?? '')) !== null
}

// ─── S-E1: GET /api/emprestimos/resumo ───────────────────────────────────────
emprestimos.get('/resumo', requireAuth, async (c) => {
  const user = c.get('user')
  const result = await c.env.DB.prepare(
    'SELECT * FROM emprestimos WHERE user_id = ? ORDER BY data_criacao DESC'
  ).bind(user.id).all()

  const list = result.results as any[]
  const ativos = list.filter(e => e.status === 'ativo')
  const quitados = list.filter(e => e.status === 'quitado')

  // Agrupar por tipo com CET anualizado
  const grupos: Record<string, any> = {}
  for (const e of list) {
    const tipo = e.tipo || 'outros'
    if (!grupos[tipo]) grupos[tipo] = { tipo, count: 0, saldo_total: 0, parcela_mensal: 0 }
    grupos[tipo].count++
    if (e.status === 'ativo') {
      grupos[tipo].saldo_total += e.saldo_devedor
      grupos[tipo].parcela_mensal += e.valor_parcela
    }
  }

  // CET médio ponderado dos empréstimos ativos
  const totalSaldoAtivo = ativos.reduce((s, e) => s + e.saldo_devedor, 0)
  let cetMedioPonderado = 0
  if (totalSaldoAtivo > 0) {
    cetMedioPonderado = ativos.reduce((acc, e) => {
      const cetAnual = (Math.pow(1 + e.taxa_juros_mensal / 100, 12) - 1) * 100
      return acc + cetAnual * (e.saldo_devedor / totalSaldoAtivo)
    }, 0)
  }

  // Maior CET entre empréstimos ativos (candidato a quitação prioritária)
  const maiorCet = ativos.length > 0
    ? ativos.reduce((max, e) => e.taxa_juros_mensal > max.taxa_juros_mensal ? e : max, ativos[0])
    : null

  return c.json({
    resumo_por_tipo: Object.values(grupos).map(g => ({
      ...g,
      saldo_total: Math.round(g.saldo_total * 100) / 100,
      parcela_mensal: Math.round(g.parcela_mensal * 100) / 100
    })),
    totais: {
      total_emprestimos: list.length,
      ativos: ativos.length,
      quitados: quitados.length,
      saldo_devedor_total: Math.round(totalSaldoAtivo * 100) / 100,
      comprometimento_mensal: Math.round(ativos.reduce((s, e) => s + e.valor_parcela, 0) * 100) / 100,
      cet_medio_ponderado_anual: Math.round(cetMedioPonderado * 100) / 100
    },
    prioridade_quitacao: maiorCet ? {
      id: maiorCet.id,
      descricao: maiorCet.descricao,
      taxa_mensal: maiorCet.taxa_juros_mensal,
      cet_anual: Math.round((Math.pow(1 + maiorCet.taxa_juros_mensal / 100, 12) - 1) * 10000) / 100,
      saldo_devedor: maiorCet.saldo_devedor,
      motivo: 'Maior custo efetivo total — quitação reduz mais juros'
    } : null
  })
})

// ─── S-E2: PATCH /api/emprestimos/:id/quitado ────────────────────────────────
emprestimos.patch('/:id/quitado', requireAuth, async (c) => {
  const user = c.get('user')
  const id = parseId(c.req.param('id'))
  if (id === null) return c.json({ error: 'ID inválido.' }, 400)
  const emp = await c.env.DB.prepare(
    'SELECT * FROM emprestimos WHERE id = ? AND user_id = ?'
  ).bind(id, user.id).first() as any
  if (!emp) return c.json({ error: 'Empréstimo não encontrado' }, 404)
  if (emp.status === 'quitado') return c.json({ error: 'Empréstimo já está quitado' }, 400)

  const body = await c.req.json().catch(() => ({})) as any
  const observacoes = body?.observacoes || 'Quitação antecipada'
  const hoje = new Date().toISOString().split('T')[0]

  await c.env.DB.prepare(
    'UPDATE emprestimos SET status=?, saldo_devedor=0, parcelas_pagas=numero_parcelas, valor_pago=valor_original, observacoes=? WHERE id=? AND user_id=?'
  ).bind('quitado', observacoes, id, user.id).run()

  // Marcar todas as despesas pendentes como pagas
  await c.env.DB.prepare(
    `UPDATE despesas SET status='pago', data=? WHERE user_id=? AND categoria='Empréstimo' AND status='pendente' AND observacoes LIKE ?`
  ).bind(hoje, user.id, `%Empréstimo automático #${id} %`).run()

  await verificarConquista(c.env.DB, user.id, 'sem_dividas')
  if (emp.tipo === 'veiculo') await verificarConquista(c.env.DB, user.id, 'carro_quitado')

  const aindaTemDividas = await c.env.DB.prepare(
    `SELECT COUNT(*) as total FROM (
      SELECT id FROM emprestimos WHERE user_id=? AND status='ativo'
      UNION ALL SELECT id FROM financiamentos WHERE user_id=? AND status='ativo'
    )`
  ).bind(user.id, user.id).first() as any
  if ((aindaTemDividas?.total || 0) === 0) await verificarConquista(c.env.DB, user.id, 'sem_dividas_total')

  return c.json({
    success: true,
    message: `🎉 Empréstimo "${emp.descricao}" quitado com sucesso!`,
    economia_estimada: Math.round((emp.valor_parcela * (emp.numero_parcelas - emp.parcelas_pagas) - emp.saldo_devedor) * 100) / 100
  })
})

// GET /api/emprestimos
emprestimos.get('/', requireAuth, async (c) => {
  const user = c.get('user')
  const result = await c.env.DB.prepare(
    'SELECT * FROM emprestimos WHERE user_id = ? ORDER BY data_criacao DESC'
  ).bind(user.id).all()

  // ── Conciliação com o fluxo de caixa ──────────────────────────────────────
  //
  // Existem DOIS livros para a mesma dívida: a linha em `emprestimos`
  // (parcelas_pagas) e as despesas que o cadastro gerou. Quem paga pelo botão
  // do empréstimo atualiza os dois; quem dá baixa pela tela de Despesas — que
  // é o caminho natural, porque é lá que a parcela aparece todo mês —
  // atualiza só um. Os dois divergem em silêncio e o usuário vê um saldo que
  // não corresponde ao que ele pagou.
  //
  // Não dá para "consertar" isso escolhendo um lado por conta própria: o
  // contrato pode estar certo (baixa a mais nas despesas) ou as despesas podem
  // estar certas (baixa que nunca chegou no contrato). O que o sistema pode
  // fazer é PARAR DE CALAR: contar os dois e mostrar a diferença.
  const baixas = await c.env.DB.prepare(
    `SELECT observacoes, COUNT(*) as pagas FROM despesas
     WHERE user_id = ? AND categoria = 'Empréstimo' AND status = 'pago'
       AND observacoes LIKE '%Empréstimo automático #%'
       AND descricao NOT LIKE '%Amortiza%'
     GROUP BY observacoes`
  ).bind(user.id).all()

  const pagasPorEmprestimo: Record<number, number> = {}
  for (const row of ((baixas.results as any[]) || [])) {
    const m = String(row.observacoes || '').match(/Empréstimo automático #(\d+)/)
    if (!m) continue
    const empId = Number(m[1])
    pagasPorEmprestimo[empId] = (pagasPorEmprestimo[empId] || 0) + Number(row.pagas || 0)
  }

  const list = (result.results as any[]).map(e => {
    const num = numerosEmprestimo(e)
    const baixadas = pagasPorEmprestimo[Number(e.id)] || 0
    return {
      ...e,
      ...num,
      conciliacao: {
        parcelas_no_contrato: num.parcelas_pagas,
        parcelas_baixadas_nas_despesas: baixadas,
        divergencia: baixadas - num.parcelas_pagas,
        aviso: baixadas !== num.parcelas_pagas
          ? `O contrato registra ${num.parcelas_pagas} parcela${num.parcelas_pagas === 1 ? '' : 's'} paga${num.parcelas_pagas === 1 ? '' : 's'}, mas ${baixadas} já ${baixadas === 1 ? 'foi baixada' : 'foram baixadas'} na tela de Despesas. Baixar a parcela por lá não atualiza o contrato — é essa a origem da diferença.`
          : null,
      },
    }
  })

  const totalSaldo = list.reduce((s, e) => s + (e.status === 'ativo' ? e.saldo_devedor : 0), 0)
  const totalMensal = list.reduce((s, e) => s + (e.status === 'ativo' ? e.valor_parcela : 0), 0)

  return c.json({ emprestimos: list, resumo: { total_saldo_devedor: totalSaldo, total_parcelas_mes: totalMensal } })
})

// GET /api/emprestimos/:id — detalhe individual com campos calculados
emprestimos.get('/:id', requireAuth, async (c) => {
  const user = c.get('user')
  const id = parseId(c.req.param('id'))
  if (id === null) return c.json({ error: 'ID inválido.' }, 400)
  const e = await c.env.DB.prepare(
    'SELECT * FROM emprestimos WHERE id = ? AND user_id = ?'
  ).bind(id, user.id).first() as any
  if (!e) return c.json({ error: 'Empréstimo não encontrado' }, 404)

  return c.json({ ...e, ...numerosEmprestimo(e) })
})

// POST /api/emprestimos
emprestimos.post('/', requireAuth, async (c) => {
  const user = c.get('user')

  // ── Limite de plano ──
  const lim = getLimites(user.plano)
  if (lim.emprestimos !== Infinity) {
    const count = await c.env.DB.prepare('SELECT COUNT(*) as n FROM emprestimos WHERE user_id = ? AND status = \'ativo\'').bind(user.id).first() as any
    if ((count?.n || 0) >= lim.emprestimos)
      return c.json({ error: MSG_UPGRADE.emprestimos, upgrade: true, limite: lim.emprestimos, feature: 'emprestimos' }, 403)
  }

  const body = await c.req.json()
  const {
    descricao, tipo = 'pessoal', valor_original, saldo_devedor: saldoInformado,
    taxa_juros_mensal, numero_parcelas,
    parcelas_pagas = 0, valor_parcela, data_inicio, data_primeira_parcela,
    dia_vencimento, credor, observacoes
  } = body

  const obrigatorios = { descricao, valor_original, taxa_juros_mensal, numero_parcelas, valor_parcela, data_inicio }
  const faltando = Object.entries(obrigatorios).filter(([, valor]) => valor === undefined || valor === null || valor === '').map(([campo]) => campo)
  if (faltando.length) return c.json({ error: `Preencha os campos obrigatórios: ${faltando.join(', ')}`, campos: faltando }, 400)

  const totalParcelas = parseInt(numero_parcelas)
  const parcelasPagasN = parseInt(parcelas_pagas)
  const valoresInvalidos = [valor_original, taxa_juros_mensal, numero_parcelas, parcelas_pagas, valor_parcela]
    .some(valor => !Number.isFinite(Number(valor)) || Number(valor) < 0)
  if (valoresInvalidos || totalParcelas < 1 || parcelasPagasN > totalParcelas) {
    return c.json({ error: 'Revise os valores: parcelas e valores devem ser positivos, e parcelas pagas não pode superar o total.' }, 400)
  }
  if (saldoInformado !== undefined && saldoInformado !== null && saldoInformado !== '' && (!Number.isFinite(Number(saldoInformado)) || Number(saldoInformado) < 0)) {
    return c.json({ error: 'Saldo devedor deve ser um número maior ou igual a zero.' }, 400)
  }
  // EMP16: teto de parcelas
  if (totalParcelas > MAX_PARCELAS) return c.json({ error: `Número de parcelas muito alto (máximo ${MAX_PARCELAS}).` }, 400)
  // EMP11: data de início precisa ser válida (senão .toISOString() dá 500)
  if (!dataValida(data_inicio)) return c.json({ error: 'Data de início inválida (use AAAA-MM-DD).' }, 400)
  // EMP9: dia de vencimento entre 1 e 31
  if (dia_vencimento !== undefined && dia_vencimento !== null && dia_vencimento !== '') {
    const dv = parseInt(dia_vencimento)
    if (!Number.isInteger(dv) || dv < 1 || dv > 31) return c.json({ error: 'Dia de vencimento deve ser entre 1 e 31.' }, 400)
  }

  // EMP10: tipo inválido é RECUSADO (não coagido para 'outros')
  if (!TIPOS_VALIDOS.includes(tipo)) return c.json({ error: 'Tipo inválido.', tipos_validos: TIPOS_VALIDOS }, 400)
  const tipoNormalizado = tipo

  const taxaM = parseFloat(taxa_juros_mensal) / 100
  const taxaA = (Math.pow(1 + taxaM, 12) - 1) * 100
  // REGRA: se o usuário informou saldo_devedor_atual, usa ele. Senão, calcula automaticamente.
  let saldoDevedor: number
  const saldoFoiInformado = saldoInformado !== undefined && saldoInformado !== null && saldoInformado !== ''
  if (saldoFoiInformado && Number(saldoInformado) >= 0) {
    saldoDevedor = parseFloat(saldoInformado)
  } else {
    // Modelo de caixa: falta pagar o que falta de parcela. Antes vinha da
    // Price sobre valor_original, que só faz sentido se valor_original for o
    // principal — e quase todo mundo digita ali o total do contrato.
    saldoDevedor = Math.round((parseInt(numero_parcelas) - parcelasPagasN) * parseFloat(valor_parcela) * 100) / 100
  }

  const dataInicio = parseDataSegura(data_inicio) || new Date(data_inicio)  // EMP19: ancora ao meio-dia
  const dataFim = new Date(dataInicio)
  dataFim.setMonth(dataFim.getMonth() + parseInt(numero_parcelas))

  const result = await c.env.DB.prepare(
    `INSERT INTO emprestimos (user_id, descricao, tipo, valor_original, valor_pago, saldo_devedor, taxa_juros_mensal, taxa_juros_anual, numero_parcelas, parcelas_pagas, valor_parcela, data_inicio, data_previsao_fim, dia_vencimento, credor, observacoes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(user.id, descricao, tipoNormalizado, parseFloat(valor_original), parseFloat(valor_parcela) * parcelasPagasN, saldoDevedor, parseFloat(taxa_juros_mensal), Math.round(taxaA * 100) / 100, parseInt(numero_parcelas), parcelasPagasN, parseFloat(valor_parcela), data_inicio, dataFim.toISOString().split('T')[0], parseInt(dia_vencimento) || null, credor || null, observacoes || null).run()

  const empId = result.meta.last_row_id as number

  // Conquistas por tipo
  await verificarConquista(c.env.DB, user.id, 'primeiro_emprestimo')
  if (tipo === 'veiculo') await verificarConquista(c.env.DB, user.id, 'primeiro_carro')
  const valorParc = parseFloat(valor_parcela)
  const diaVenc = parseInt(dia_vencimento) || dataInicio.getDate()

  // Referência para datas das parcelas:
  let dataPrimeiraRef: Date
  if (data_primeira_parcela) {
    const parsed = parseDataSegura(data_primeira_parcela)
    dataPrimeiraRef = parsed || new Date(dataInicio.getFullYear(), dataInicio.getMonth(), diaVenc)
    if (!parsed) {
      // data inválida — cair no cálculo automático
      if (dataPrimeiraRef <= dataInicio) dataPrimeiraRef.setMonth(dataPrimeiraRef.getMonth() + 1)
    }
  } else {
    dataPrimeiraRef = new Date(dataInicio.getFullYear(), dataInicio.getMonth(), diaVenc)
    if (dataPrimeiraRef <= dataInicio) {
      dataPrimeiraRef.setMonth(dataPrimeiraRef.getMonth() + 1)
    }
  }

  // Inserir despesas em batch para evitar timeout
  const LOTE = 100
  for (let base = parcelasPagasN; base < totalParcelas; base += LOTE) {
    const stmts = []
    for (let i = base; i < Math.min(base + LOTE, totalParcelas); i++) {
      const dataParc = new Date(dataPrimeiraRef)
      dataParc.setMonth(dataPrimeiraRef.getMonth() + (i - parcelasPagasN))
      const maxDia = new Date(dataParc.getFullYear(), dataParc.getMonth() + 1, 0).getDate()
      dataParc.setDate(Math.min(diaVenc, maxDia))
      const dataParcStr = dataParc.toISOString().split('T')[0]
      stmts.push(
        c.env.DB.prepare(
          `INSERT INTO despesas (user_id, descricao, data, categoria, valor, parcelado, numero_parcelas, parcela_atual, status, fixa_ou_variavel, recorrente, vencimento, observacoes, meio_pagamento)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(
          user.id,
          `${descricao} (${i + 1}/${totalParcelas})`,
          dataParcStr,
          'Empréstimo',
          valorParc,
          1, totalParcelas, i + 1,
          'pendente',
          'fixa', 0,
          dataParcStr,
          `Empréstimo automático #${empId} — ${credor || tipo}`,
          'transferencia'
        )
      )
    }
    await c.env.DB.batch(stmts)
  }

  // ── Tags automáticas para as despesas geradas ──────────────────────────
  try {
    const despGeradas = await c.env.DB.prepare(
      `SELECT id FROM despesas WHERE user_id=? AND observacoes LIKE ? ORDER BY id ASC`
    ).bind(user.id, `Empréstimo automático #${empId} %`).all<{id:number}>()
    const despIds = (despGeradas.results || []).map(r => r.id)
    if (despIds.length > 0) {
      const tagEmpId  = await ensureTag(c.env.DB, user.id, 'Empréstimo', COR_MODULO.emprestimo)
      const tagItemId = await ensureTag(c.env.DB, user.id, descricao.trim().slice(0, 30), COR_MODULO.emprestimo)
      for (const did of despIds) {
        await tagDespesa(c.env.DB, did, tagEmpId)
        if (tagItemId !== tagEmpId) await tagDespesa(c.env.DB, did, tagItemId)
      }
    }
  } catch (_) { /* tag automática é best-effort */ }

  return c.json({ success: true, id: empId, saldo_devedor: saldoDevedor, saldo_origem: saldoFoiInformado ? 'informado' : 'calculado', message: 'Empréstimo cadastrado e despesas criadas automaticamente!' }, 201)
})

// PUT /api/emprestimos/:id
emprestimos.put('/:id', requireAuth, async (c) => {
  const user = c.get('user')
  const id = parseId(c.req.param('id'))
  if (id === null) return c.json({ error: 'ID inválido.' }, 400)
  const existing = await c.env.DB.prepare('SELECT id FROM emprestimos WHERE id = ? AND user_id = ?').bind(id, user.id).first()
  if (!existing) return c.json({ error: 'Empréstimo não encontrado' }, 404)

  const body = await c.req.json()
  const { descricao, tipo: tipoPut, valor_original, saldo_devedor: saldoInformado, taxa_juros_mensal, numero_parcelas, parcelas_pagas, valor_parcela, data_inicio, dia_vencimento, credor, status, observacoes } = body

  const obrigatoriosPut = { descricao, valor_original, taxa_juros_mensal, numero_parcelas, parcelas_pagas, valor_parcela, data_inicio }
  const faltandoPut = Object.entries(obrigatoriosPut).filter(([, valor]) => valor === undefined || valor === null || valor === '').map(([campo]) => campo)
  if (faltandoPut.length) return c.json({ error: `Preencha os campos obrigatórios: ${faltandoPut.join(', ')}`, campos: faltandoPut }, 400)
  if ([valor_original, taxa_juros_mensal, numero_parcelas, parcelas_pagas, valor_parcela].some(valor => !Number.isFinite(Number(valor)) || Number(valor) < 0) || Number(numero_parcelas) < 1 || Number(parcelas_pagas) > Number(numero_parcelas)) {
    return c.json({ error: 'Revise os valores: parcelas e valores devem ser positivos, e parcelas pagas não pode superar o total.' }, 400)
  }
  if (saldoInformado !== undefined && saldoInformado !== null && saldoInformado !== '' && (!Number.isFinite(Number(saldoInformado)) || Number(saldoInformado) < 0)) {
    return c.json({ error: 'Saldo devedor deve ser um número maior ou igual a zero.' }, 400)
  }
  if (Number(numero_parcelas) > MAX_PARCELAS) return c.json({ error: `Número de parcelas muito alto (máximo ${MAX_PARCELAS}).` }, 400)
  if (!dataValida(data_inicio)) return c.json({ error: 'Data de início inválida (use AAAA-MM-DD).' }, 400)
  if (dia_vencimento !== undefined && dia_vencimento !== null && dia_vencimento !== '') {
    const dv = parseInt(dia_vencimento)
    if (!Number.isInteger(dv) || dv < 1 || dv > 31) return c.json({ error: 'Dia de vencimento deve ser entre 1 e 31.' }, 400)
  }
  if (status !== undefined && status !== null && status !== '' && !['ativo', 'quitado', 'em_atraso', 'negociado'].includes(status))
    return c.json({ error: 'Status inválido.' }, 400)

  // EMP10: tipo inválido é RECUSADO (não coagido)
  if (!TIPOS_VALIDOS.includes(tipoPut)) return c.json({ error: 'Tipo inválido.', tipos_validos: TIPOS_VALIDOS }, 400)
  const tipoNormalizadoPut = tipoPut

  const taxaM = parseFloat(taxa_juros_mensal) / 100
  const taxaA = (Math.pow(1 + taxaM, 12) - 1) * 100
  const parcelasPagasN = parseInt(parcelas_pagas)

  // ── Salvar a edição NÃO pode reescrever a dívida ──────────────────────────
  //
  // Este bloco recalculava o saldo pela Price toda vez que a tela de edição
  // era salva, mesmo sem o usuário tocar em nada relacionado. Quem tinha
  // pagado parcelas pelo botão via o saldo saltar para outro valor só por ter
  // corrigido o nome do credor. Agora só há duas origens: o que o usuário
  // informou, ou o modelo de caixa — e a amortização extraordinária já feita
  // é preservada, senão editar o contrato devolveria a dívida já abatida.
  const anterior = await c.env.DB.prepare(
    'SELECT numero_parcelas, parcelas_pagas, valor_parcela, saldo_devedor FROM emprestimos WHERE id=? AND user_id=?'
  ).bind(id, user.id).first() as any
  const amortizadoAntes = anterior
    ? Math.max(0, Math.round(((Math.max(0, Number(anterior.numero_parcelas) - Number(anterior.parcelas_pagas)) * Number(anterior.valor_parcela)) - Number(anterior.saldo_devedor)) * 100) / 100)
    : 0

  let saldoDevedor: number
  const saldoFoiInformadoPut = saldoInformado !== undefined && saldoInformado !== null && saldoInformado !== ''
  if (saldoFoiInformadoPut && Number(saldoInformado) >= 0) {
    saldoDevedor = parseFloat(saldoInformado)
  } else {
    const restantesPut = Math.max(0, parseInt(numero_parcelas) - parcelasPagasN)
    saldoDevedor = Math.max(0, Math.round((restantesPut * parseFloat(valor_parcela) - amortizadoAntes) * 100) / 100)
  }

  const valorPago = parseFloat(valor_parcela) * parcelasPagasN

  // Recalcular data_previsao_fim
  const dataInicioPut = parseDataSegura(data_inicio) || new Date(data_inicio)  // EMP19
  const dataFimPut = new Date(dataInicioPut)
  dataFimPut.setMonth(dataFimPut.getMonth() + parseInt(numero_parcelas))

  await c.env.DB.prepare(
    `UPDATE emprestimos SET descricao=?, tipo=?, valor_original=?, valor_pago=?, saldo_devedor=?, taxa_juros_mensal=?, taxa_juros_anual=?, numero_parcelas=?, parcelas_pagas=?, valor_parcela=?, data_inicio=?, data_previsao_fim=?, dia_vencimento=?, credor=?, status=?, observacoes=? WHERE id=? AND user_id=?`
  ).bind(descricao, tipoNormalizadoPut, parseFloat(valor_original), valorPago, saldoDevedor, parseFloat(taxa_juros_mensal), Math.round(taxaA * 100) / 100, parseInt(numero_parcelas), parcelasPagasN, parseFloat(valor_parcela), data_inicio, dataFimPut.toISOString().split('T')[0], parseInt(dia_vencimento) || null, credor || null, status || 'ativo', observacoes || null, id, user.id).run()

  if (status === 'quitado') await verificarConquista(c.env.DB, user.id, 'sem_dividas')

  // Sincronizar valor das despesas pendentes vinculadas a este empréstimo
  // (caso o valor_parcela tenha mudado na edição)
  await c.env.DB.prepare(
    // "(2/24.0)" — o número de parcelas chegava aqui como numérico e o
    // CAST para texto trazia a casa decimal junto. Ambos os lados agora são
    // inteiros explícitos: o da esquerda pelo CAST duplo, o da direita porque
    // vai como string já formada.
    `UPDATE despesas SET valor = ?, descricao = REPLACE(descricao, SUBSTR(descricao, INSTR(descricao, '(')), '') || '(' || CAST(CAST(parcela_atual AS INTEGER) AS TEXT) || '/' || ? || ')'
     WHERE user_id = ? AND categoria = 'Empréstimo' AND status = 'pendente' AND observacoes LIKE ?`
  ).bind(parseFloat(valor_parcela), String(parseInt(numero_parcelas)), user.id, `%Empréstimo automático #${id} %`).run()

  return c.json({ success: true, saldo_devedor: saldoDevedor, saldo_origem: saldoFoiInformadoPut ? 'informado' : 'calculado', message: 'Empréstimo atualizado!' })
})

// PATCH /api/emprestimos/:id/parcela
// Lógica correta: subtrai (parcela - juros_sobre_saldo_atual) do saldo_devedor
emprestimos.patch('/:id/parcela', requireAuth, async (c) => {
  const user = c.get('user')
  const id = parseId(c.req.param('id'))
  if (id === null) return c.json({ error: 'ID inválido.' }, 400)
  const emp = await c.env.DB.prepare('SELECT * FROM emprestimos WHERE id = ? AND user_id = ?').bind(id, user.id).first() as any
  if (!emp) return c.json({ error: 'Empréstimo não encontrado' }, 404)

  // EMP4: não pagar parcela de empréstimo já quitado (evita parcelas_restantes negativo)
  if (emp.parcelas_pagas >= emp.numero_parcelas || emp.saldo_devedor <= 0)
    return c.json({ error: 'Empréstimo já quitado — não há parcelas a pagar.' }, 400)

  const novasParcelas = emp.parcelas_pagas + 1

  // ── Pagar parcela abate a parcela inteira ─────────────────────────────────
  //
  // Antes: juros do mês sobre o saldo, e só a diferença abatia. Isso trata
  // valor_original como principal e cobra juros POR CIMA de um valor que, na
  // prática, o usuário digita já com os juros dentro — o contrato do usuário
  // real tinha 24 × 936,36 = exatamente o "valor tomado", isto é, juros zero,
  // e mesmo assim a rotina cobrava 2,5% ao mês sobre o saldo.
  //
  // No modelo de caixa a conta é a que qualquer pessoa faz de cabeça: você
  // pagou uma parcela, falta uma parcela a menos. O juro do contrato aparece
  // separado, em `juros_embutidos`, e não é cobrado duas vezes.
  const saldoAntes = Number(emp.saldo_devedor) || 0
  const parcelaVal = Number(emp.valor_parcela) || 0
  const novoSaldo = Math.max(0, Math.round((saldoAntes - parcelaVal) * 100) / 100)
  const novoValorPago = Math.round((Number(emp.valor_pago || 0) + parcelaVal) * 100) / 100
  const status = novasParcelas >= emp.numero_parcelas ? 'quitado' : 'ativo'

  await c.env.DB.prepare('UPDATE emprestimos SET parcelas_pagas=?, saldo_devedor=?, valor_pago=?, status=? WHERE id=? AND user_id=?').bind(novasParcelas, novoSaldo, novoValorPago, status, id, user.id).run()

  // Marcar a despesa correspondente como paga (se existir)
  const parcelaNum = novasParcelas
  await c.env.DB.prepare(
    `UPDATE despesas SET status='pago' WHERE user_id=? AND categoria='Empréstimo' AND parcela_atual=? AND status='pendente' AND observacoes LIKE ?`
  ).bind(user.id, parcelaNum, `%Empréstimo automático #${id} %`).run()

  if (status === 'quitado') {
    await verificarConquista(c.env.DB, user.id, 'sem_dividas')
    if (emp.tipo === 'veiculo') await verificarConquista(c.env.DB, user.id, 'carro_quitado')
    // sem_dividas_total: verifica se ainda há dívidas ativas
    const aindaTemDividas = await c.env.DB.prepare(
      `SELECT COUNT(*) as total FROM (
        SELECT id FROM emprestimos WHERE user_id=? AND status='ativo'
        UNION ALL
        SELECT id FROM financiamentos WHERE user_id=? AND status='ativo'
      )`
    ).bind(user.id, user.id).first() as any
    if ((aindaTemDividas?.total || 0) === 0) await verificarConquista(c.env.DB, user.id, 'sem_dividas_total')
  }

  return c.json({
    success: true,
    parcelas_pagas: novasParcelas,
    saldo_devedor: novoSaldo,
    amortizacao: Math.round(parcelaVal * 100) / 100,
    status,
    message: status === 'quitado'
      ? '🎉 Empréstimo quitado!'
      : `Parcela ${novasParcelas}/${Math.round(Number(emp.numero_parcelas))} paga. Falta pagar R$ ${novoSaldo.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}.`
  })
})

// PATCH /api/emprestimos/:id/conciliar — alinhar o contrato ao que foi pago
//
// Os dois livros divergem porque dar baixa na parcela pela tela de Despesas —
// que é onde ela aparece todo mês, e portanto o caminho natural — não mexe no
// contrato. Sem uma saída, o usuário fica olhando um saldo que sabe estar
// errado e não tem como corrigir a não ser clicando "pagar parcela" várias
// vezes, o que lança pagamento em cima de pagamento.
//
// Aqui ele diz quantas parcelas pagou de fato, ou aceita a contagem das
// despesas, e o contrato se ajusta a isso. A amortização extraordinária já
// feita é preservada.
emprestimos.patch('/:id/conciliar', requireAuth, async (c) => {
  const user = c.get('user')
  const id = parseId(c.req.param('id'))
  if (id === null) return c.json({ error: 'ID inválido.' }, 400)
  const emp = await c.env.DB.prepare('SELECT * FROM emprestimos WHERE id = ? AND user_id = ?').bind(id, user.id).first() as any
  if (!emp) return c.json({ error: 'Empréstimo não encontrado' }, 404)

  let corpo: any = {}
  try { corpo = await c.req.json() } catch { corpo = {} }

  const n = Math.max(0, Math.round(Number(emp.numero_parcelas) || 0))
  const parcela = Number(emp.valor_parcela) || 0

  // Quantas parcelas deste empréstimo já estão baixadas no fluxo de caixa.
  const baixa = await c.env.DB.prepare(
    `SELECT COUNT(*) as pagas FROM despesas
     WHERE user_id = ? AND categoria = 'Empréstimo' AND status = 'pago'
       AND observacoes LIKE ? AND descricao NOT LIKE '%Amortiza%'`
  ).bind(user.id, `%Empréstimo automático #${id} %`).first() as any

  const doInformado = corpo.parcelas_pagas !== undefined && corpo.parcelas_pagas !== null && corpo.parcelas_pagas !== ''
  const alvoBruto = doInformado ? Number(corpo.parcelas_pagas) : Number(baixa?.pagas || 0)
  if (!Number.isFinite(alvoBruto) || alvoBruto < 0) return c.json({ error: 'Número de parcelas pagas inválido.' }, 400)
  const alvo = Math.min(n, Math.round(alvoBruto))

  // Amortização extraordinária já aplicada: é a diferença entre o que as
  // parcelas restantes somam e o saldo gravado. Se não preservar, conciliar
  // devolveria ao usuário uma dívida que ele já abateu.
  const restantesAntes = Math.max(0, n - (Number(emp.parcelas_pagas) || 0))
  const amortizado = Math.max(0, Math.round((restantesAntes * parcela - Number(emp.saldo_devedor)) * 100) / 100)

  const novoSaldo = Math.max(0, Math.round(((n - alvo) * parcela - amortizado) * 100) / 100)
  const novoPago = Math.round(alvo * parcela * 100) / 100
  const status = (alvo >= n || novoSaldo <= 0) ? 'quitado' : 'ativo'

  await c.env.DB.prepare(
    'UPDATE emprestimos SET parcelas_pagas=?, saldo_devedor=?, valor_pago=?, status=? WHERE id=? AND user_id=?'
  ).bind(alvo, novoSaldo, novoPago, status, id, user.id).run()

  if (status === 'quitado') await verificarConquista(c.env.DB, user.id, 'sem_dividas')

  return c.json({
    success: true,
    parcelas_pagas: alvo,
    parcelas_pagas_antes: Number(emp.parcelas_pagas) || 0,
    origem: doInformado ? 'informado' : 'despesas',
    saldo_devedor: novoSaldo,
    amortizacao_preservada: amortizado,
    status,
    message: `Contrato conciliado: ${alvo} de ${n} parcelas pagas. Falta pagar R$ ${novoSaldo.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}.`,
  })
})

// PATCH /api/emprestimos/:id/amortizacao — amortização extraordinária
emprestimos.patch('/:id/amortizacao', requireAuth, async (c) => {
  const user = c.get('user')
  const id = parseId(c.req.param('id'))
  if (id === null) return c.json({ error: 'ID inválido.' }, 400)
  const emp = await c.env.DB.prepare('SELECT * FROM emprestimos WHERE id = ? AND user_id = ?').bind(id, user.id).first() as any
  if (!emp) return c.json({ error: 'Empréstimo não encontrado' }, 404)

  const { valor_amortizado, parcelas_antecipadas = 0, observacoes } = await c.req.json()
  // EMP3/EMP22: valor precisa ser positivo; o novo saldo é SEMPRE calculado no
  // servidor (novo_saldo do corpo é ignorado — o cliente não escolhe a dívida)
  const valorAmort = Number(valor_amortizado)
  if (!Number.isFinite(valorAmort) || valorAmort <= 0)
    return c.json({ error: 'Valor da amortização deve ser um número maior que zero.' }, 400)

  const novasPagasPorAntecipacao = Math.max(0, parseInt(parcelas_antecipadas) || 0)
  const novasParcelas = Math.min(emp.numero_parcelas, emp.parcelas_pagas + novasPagasPorAntecipacao)
  const novoSaldoVal = Math.max(0, Math.round((Number(emp.saldo_devedor) - valorAmort) * 100) / 100)
  const novoValorPago = Math.round((Number(emp.valor_pago || 0) + valorAmort) * 100) / 100
  const status = novoSaldoVal <= 0 || novasParcelas >= emp.numero_parcelas ? 'quitado' : 'ativo'

  await c.env.DB.prepare(
    'UPDATE emprestimos SET saldo_devedor=?, valor_pago=?, parcelas_pagas=?, status=? WHERE id=? AND user_id=?'
  ).bind(novoSaldoVal, novoValorPago, novasParcelas, status, id, user.id).run()

  // Registrar na tabela de despesas como pagamento extra
  const hoje = new Date().toISOString().split('T')[0]
  await c.env.DB.prepare(
    `INSERT INTO despesas (user_id, descricao, data, categoria, valor, status, fixa_ou_variavel, observacoes, meio_pagamento)
     VALUES (?, ?, ?, ?, ?, 'pago', 'variavel', ?, 'transferencia')`
  ).bind(user.id, `Amortização Extraordinária — ${emp.descricao}`, hoje, 'Empréstimo', valorAmort, `Empréstimo automático #${id} — Amortização extraordinária${observacoes ? ': ' + observacoes : ''}`).run()

  // Marcar parcelas antecipadas como pagas nas despesas
  if (novasPagasPorAntecipacao > 0) {
    for (let p = emp.parcelas_pagas + 1; p <= novasParcelas; p++) {
      await c.env.DB.prepare(
        `UPDATE despesas SET status='pago' WHERE user_id=? AND categoria='Empréstimo' AND parcela_atual=? AND status='pendente' AND observacoes LIKE ?`
      ).bind(user.id, p, `%Empréstimo automático #${id} %`).run()
    }
  }

  if (status === 'quitado') await verificarConquista(c.env.DB, user.id, 'sem_dividas')
  await verificarConquista(c.env.DB, user.id, 'amortizou')

  return c.json({
    success: true,
    novo_saldo: novoSaldoVal,
    parcelas_pagas: novasParcelas,
    status,
    message: status === 'quitado' ? '🎉 Empréstimo quitado!' : `⚡ Amortização de R$${valorAmort.toFixed(2)} aplicada! Novo saldo: R$${novoSaldoVal.toFixed(2)}`
  })
})

// GET /api/emprestimos/:id/simulacao — simula cenários de pagamento antecipado
emprestimos.get('/:id/simulacao', requireAuth, async (c) => {
  const user = c.get('user')
  const id = parseId(c.req.param('id'))
  if (id === null) return c.json({ error: 'ID inválido.' }, 400)

  const emp = await c.env.DB.prepare(
    'SELECT * FROM emprestimos WHERE id = ? AND user_id = ?'
  ).bind(id, user.id).first() as any

  if (!emp) return c.json({ error: 'Empréstimo não encontrado' }, 404)

  const saldo = emp.saldo_devedor || 0
  const taxaMensal = emp.taxa_juros_mensal / 100
  const parcelasRestantes = emp.numero_parcelas - emp.parcelas_pagas
  const valorParcela = emp.valor_parcela

  // Calcular total a pagar no ritmo atual
  const totalAtual = valorParcela * parcelasRestantes
  const jurosAtual = totalAtual - saldo

  // Simular amortização extra de 10%, 20%, 30% do saldo
  const cenarios = [10, 20, 30].map(pct => {
    const extra = Math.round(saldo * pct / 100 * 100) / 100
    const novoSaldo = Math.max(0, saldo - extra)
    if (novoSaldo <= 0) return { pct, extra, parcelas_economizadas: parcelasRestantes, economia: jurosAtual, novo_saldo: 0 }

    // Calcular nova parcela com SAC simplificado
    let novasParcelas = parcelasRestantes
    let saldoCalc = novoSaldo
    let totalJurosNovo = 0
    for (let i = 0; i < parcelasRestantes; i++) {
      const jMes = saldoCalc * taxaMensal
      totalJurosNovo += jMes
      saldoCalc = saldoCalc - (valorParcela - jMes)
      if (saldoCalc <= 0) { novasParcelas = i + 1; break }
    }

    return {
      pct,
      extra,
      novo_saldo: Math.round(novoSaldo * 100) / 100,
      parcelas_economizadas: parcelasRestantes - novasParcelas,
      economia_juros: Math.round((jurosAtual - totalJurosNovo) * 100) / 100
    }
  })

  return c.json({
    emprestimo_id: emp.id,
    saldo_atual: saldo,
    taxa_mensal: emp.taxa_juros_mensal,
    parcelas_restantes: parcelasRestantes,
    valor_parcela: valorParcela,
    total_a_pagar: Math.round(totalAtual * 100) / 100,
    juros_projetados: Math.round(jurosAtual * 100) / 100,
    cenarios_amortizacao: cenarios
  })
})

// DELETE /api/emprestimos/:id — cascade: apaga todas as despesas pendentes vinculadas
emprestimos.delete('/:id', requireAuth, async (c) => {
  const user = c.get('user')
  const id = parseId(c.req.param('id'))
  if (id === null) return c.json({ error: 'ID inválido.' }, 400)

  // Verifica existência antes de apagar
  const existing = await c.env.DB.prepare('SELECT id FROM emprestimos WHERE id = ? AND user_id = ?').bind(id, user.id).first()
  if (!existing) return c.json({ error: 'Empréstimo não encontrado' }, 404)

  // Remove todas as despesas vinculadas (pagas e pendentes) com observacao referenciando este empréstimo
  await c.env.DB.prepare(
    `DELETE FROM despesas WHERE user_id = ? AND categoria = 'Empréstimo' AND observacoes LIKE ?`
  ).bind(user.id, `%Empréstimo automático #${id} %`).run()

  // Remove o empréstimo
  await c.env.DB.prepare('DELETE FROM emprestimos WHERE id = ? AND user_id = ?').bind(id, user.id).run()

  return c.json({ success: true, message: 'Empréstimo e parcelas removidos!' })
})

/**
 * parseDataSegura: converte string de data em Date sem explodir.
 * Aceita YYYY-MM-DD e DD/MM/YYYY.
 */
function parseDataSegura(str: string): Date | null {
  if (!str) return null
  // Formato ISO: YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return new Date(str + 'T12:00:00')
  // Formato BR: DD/MM/YYYY
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(str)) {
    const [d, m, y] = str.split('/')
    return new Date(`${y}-${m}-${d}T12:00:00`)
  }
  // Tentativa genérica
  const d = new Date(str)
  return isNaN(d.getTime()) ? null : d
}

/**
 * ── Um saldo, um dono ────────────────────────────────────────────────────────
 *
 * O saldo devedor tinha TRÊS donos e três respostas diferentes para a mesma
 * dívida:
 *
 *   1. calcSaldo(), fórmula Price, tratando valor_original como PRINCIPAL —
 *      usado no POST e, pior, no PUT, que sobrescrevia o saldo toda vez que o
 *      usuário abria e salvava a edição;
 *   2. PATCH /parcela, que calculava juros sobre o saldo e amortizava o resto;
 *   3. a tela, que exibia `valor_original − saldo_devedor` como "já pago"
 *      enquanto o card mostrava `valor_pago`, que é outra conta.
 *
 * Nos dados reais de um usuário isso produzia, na MESMA tela: "R$ 5.173,40 de
 * R$ 22.472,64" pagos no topo, "23% quitado" ao lado, "5/24 pagas" no card
 * (= R$ 4.681,80) e "21%" vindo da API. Quatro números, quatro contas.
 *
 * Agora existe um modelo só, e é o de CAIXA: saldo devedor é quanto ainda vai
 * sair do bolso. Some o que você paga, nada mais. É o único número que o
 * usuário consegue conferir contra o extrato do banco.
 *
 * O juro não sumiu — ele aparece separado, como `juros_embutidos`, que é o que
 * o contrato cobra a mais do que foi tomado. E `valor_quitacao_hoje` responde
 * a outra pergunta, também legítima: quanto o banco aceitaria hoje para
 * encerrar o contrato (valor presente das parcelas que faltam).
 */
function numerosEmprestimo(e: any) {
  const cent = (v: number) => Math.round((Number(v) || 0) * 100) / 100
  const n = Math.max(0, Math.round(Number(e.numero_parcelas) || 0))
  const pagas = Math.min(n, Math.max(0, Math.round(Number(e.parcelas_pagas) || 0)))
  const parcela = cent(e.valor_parcela)
  const restantes = Math.max(0, n - pagas)
  const tomado = cent(e.valor_original)
  const taxa = Number(e.taxa_juros_mensal) || 0

  const total_a_pagar = cent(parcela * n)
  const ja_pago = cent(parcela * pagas)
  // O saldo gravado é a verdade sobre o caixa: ele já desconta amortização
  // extraordinária, que não reduz o número de parcelas. Só cai para a conta
  // teórica quando a coluna está vazia ou incoerente (dívida antiga, importada).
  const previsto = cent(parcela * restantes)
  const gravado = Number(e.saldo_devedor)
  const saldoOk = Number.isFinite(gravado) && gravado >= 0 && gravado <= total_a_pagar + 0.01
  const falta_pagar = saldoOk ? cent(gravado) : previsto
  // A diferença entre o que falta e (restantes × parcela) é exatamente o que
  // já foi amortizado por fora das parcelas.
  const amortizado_extra = cent(Math.max(0, previsto - falta_pagar))

  const juros_embutidos = cent(Math.max(0, total_a_pagar - tomado))

  let valor_quitacao_hoje: number | null = null
  if (taxa > 0 && juros_embutidos > 0.01 && restantes > 0) {
    const i = taxa / 100
    valor_quitacao_hoje = cent(parcela * (1 - Math.pow(1 + i, -restantes)) / i)
  }

  // Taxa cadastrada mas parcelas que não cobrem nem o valor tomado: o usuário
  // digitou o TOTAL do contrato no campo "valor tomado". Os dois números não
  // podem estar certos ao mesmo tempo, e calar sobre isso é como o sistema
  // vinha exibindo "2,5% a.m." ao lado de "R$ 0,00 de juros".
  const dados_contraditorios = taxa > 0 && tomado > 0 && juros_embutidos <= 0.01

  return {
    parcelas_pagas: pagas,
    parcelas_restantes: restantes,
    perc_pago: n > 0 ? Math.round((pagas / n) * 100) : 0,
    total_a_pagar,
    valor_pago: ja_pago,
    saldo_devedor: falta_pagar,
    falta_pagar,
    amortizado_extra,
    juros_embutidos,
    total_juros: juros_embutidos,
    custo_efetivo_total: tomado > 0 ? cent((juros_embutidos / tomado) * 100) : 0,
    valor_quitacao_hoje,
    dados_contraditorios,
    aviso_dados: dados_contraditorios
      ? `Este contrato tem ${taxa.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}% a.m. de juros cadastrado, mas as ${n} parcelas somam exatamente o valor informado como tomado — ou seja, juros zero. Provavelmente o campo "valor tomado" recebeu o total do contrato. Corrija o valor tomado para o que caiu na sua conta, ou zere a taxa.`
      : null,
  }
}

async function verificarConquista(db: D1Database, userId: number, codigo: string) {
  try {
    await db.prepare('INSERT OR IGNORE INTO conquistas_usuario (user_id, conquista_codigo, visualizado) VALUES (?, ?, 0)').bind(userId, codigo).run()
  } catch { }
}


// GET /api/emprestimos/:id/calendario — retorna todas as parcelas futuras com datas
emprestimos.get('/:id/calendario', requireAuth, async (c) => {
  const user = c.get('user')
  const id = parseId(c.req.param('id'))
  if (id === null) return c.json({ error: 'ID inválido.' }, 400)

  const emp = await c.env.DB.prepare(
    'SELECT * FROM emprestimos WHERE id = ? AND user_id = ?'
  ).bind(id, user.id).first() as any

  if (!emp) return c.json({ error: 'Empréstimo não encontrado' }, 404)

  const taxaM = emp.taxa_juros_mensal / 100
  const hoje = new Date()
  const parcelas: any[] = []

  // Determinar data base para cálculo das parcelas
  let diaVenc = emp.dia_vencimento || 1
  let saldoCalc = emp.saldo_devedor
  let parcelaAtual = emp.parcelas_pagas

  // Data da próxima parcela
  let dataProxima = new Date(hoje.getFullYear(), hoje.getMonth(), diaVenc)
  if (dataProxima <= hoje) dataProxima.setMonth(dataProxima.getMonth() + 1)

  const parcelasRestantes = emp.numero_parcelas - parcelaAtual

  for (let i = 0; i < parcelasRestantes; i++) {
    const numParcela = parcelaAtual + i + 1
    const jurosMes = Math.round(saldoCalc * taxaM * 100) / 100
    const amort = Math.round((emp.valor_parcela - jurosMes) * 100) / 100
    saldoCalc = Math.max(0, Math.round((saldoCalc - amort) * 100) / 100)

    const dataVenc = new Date(dataProxima)
    dataVenc.setMonth(dataProxima.getMonth() + i)

    const isAtrasada = dataVenc < hoje && i === 0
    const status = isAtrasada ? 'em_atraso' : (i === 0 ? 'proxima' : 'futura')

    parcelas.push({
      numero: numParcela,
      data_vencimento: dataVenc.toISOString().split('T')[0],
      valor: emp.valor_parcela,
      juros: jurosMes,
      amortizacao: Math.max(0, amort),
      saldo_pos: saldoCalc,
      status
    })
  }

  const totalJurosFuturos = parcelas.reduce((s: number, p: any) => s + p.juros, 0)
  const totalPagoJuros = emp.valor_pago - (emp.valor_original - (emp.valor_original - emp.saldo_devedor))

  return c.json({
    emprestimo: {
      id: emp.id,
      descricao: emp.descricao,
      valor_original: emp.valor_original,
      saldo_devedor: emp.saldo_devedor,
      parcelas_pagas: emp.parcelas_pagas,
      numero_parcelas: emp.numero_parcelas,
      valor_parcela: emp.valor_parcela,
      taxa_juros_mensal: emp.taxa_juros_mensal
    },
    parcelas,
    resumo: {
      total_parcelas_restantes: parcelasRestantes,
      total_a_pagar: Math.round(emp.valor_parcela * parcelasRestantes * 100) / 100,
      total_juros_futuros: Math.round(totalJurosFuturos * 100) / 100,
      proxima_data: parcelas[0]?.data_vencimento || null
    }
  })
})

// POST /api/emprestimos/verificar-atrasos — marca empréstimos em atraso automaticamente
emprestimos.post('/verificar-atrasos', requireAuth, async (c) => {
  const user = c.get('user')
  const hoje = new Date()

  // Busca empréstimos ativos com dia_vencimento definido
  const ativos = await c.env.DB.prepare(
    `SELECT * FROM emprestimos WHERE user_id = ? AND status = 'ativo' AND dia_vencimento IS NOT NULL`
  ).bind(user.id).all() as any

  let atualizados = 0
  for (const emp of (ativos.results || [])) {
    const diaVenc = emp.dia_vencimento
    // Calcula a data esperada da próxima parcela
    const dataEsperada = new Date(hoje.getFullYear(), hoje.getMonth(), diaVenc)
    // Se já passou o dia de vencimento deste mês e a última parcela esperada ainda não foi paga
    // (heurística: parcelas_pagas < parcelas que deveriam ter sido pagas até hoje)
    const mesesDesdeInicio = (hoje.getFullYear() - new Date(emp.data_inicio).getFullYear()) * 12
      + (hoje.getMonth() - new Date(emp.data_inicio).getMonth())
    const parcelasEsperadas = Math.min(mesesDesdeInicio + (hoje.getDate() >= diaVenc ? 1 : 0), emp.numero_parcelas)

    if (emp.parcelas_pagas < parcelasEsperadas && emp.status === 'ativo') {
      await c.env.DB.prepare(
        `UPDATE emprestimos SET status = 'em_atraso' WHERE id = ? AND user_id = ?`
      ).bind(emp.id, user.id).run()
      atualizados++
    }
  }

  return c.json({ success: true, atualizados, message: `${atualizados} empréstimo(s) marcado(s) como em atraso` })
})

// POST /api/emprestimos/:id/lembrete — cria lembrete automático para a próxima parcela
emprestimos.post('/:id/lembrete', requireAuth, async (c) => {
  const user = c.get('user')
  const id = parseId(c.req.param('id'))
  if (id === null) return c.json({ error: 'ID inválido.' }, 400)
  const { dias_antes = 3 } = await c.req.json().catch(() => ({})) as any

  const emp = await c.env.DB.prepare(
    'SELECT * FROM emprestimos WHERE id = ? AND user_id = ?'
  ).bind(id, user.id).first() as any
  if (!emp) return c.json({ error: 'Empréstimo não encontrado' }, 404)

  // Calcular próxima data de vencimento
  const hoje = new Date()
  const diaVenc = emp.dia_vencimento || 1
  let proxVenc = new Date(hoje.getFullYear(), hoje.getMonth(), diaVenc)
  if (proxVenc <= hoje) proxVenc.setMonth(proxVenc.getMonth() + 1)

  const dataLembrete = new Date(proxVenc)
  dataLembrete.setDate(dataLembrete.getDate() - parseInt(dias_antes))

  // Inserir lembrete usando schema real da tabela lembretes
  try {
    await c.env.DB.prepare(
      `INSERT INTO lembretes (user_id, titulo, descricao, tipo, dia_vencimento, frequencia, ativo, alertar_dias_antes, proximo_vencimento, notas)
       VALUES (?, ?, ?, 'conta', ?, 'mensal', 1, ?, ?, ?)`
    ).bind(
      user.id,
      `📅 Parcela: ${emp.descricao}`,
      `Parcela ${emp.parcelas_pagas + 1}/${emp.numero_parcelas} de ${emp.descricao}. Valor: R$ ${emp.valor_parcela.toFixed(2)}`,
      emp.dia_vencimento || proxVenc.getDate(),
      parseInt(dias_antes),
      proxVenc.toISOString().split('T')[0],
      `Empréstimo #${emp.id} — ${emp.credor || emp.tipo}`
    ).run()
    return c.json({ success: true, data_lembrete: dataLembrete.toISOString().split('T')[0], dias_antes, proximo_vencimento: proxVenc.toISOString().split('T')[0] })
  } catch (e2: any) {
    return c.json({ error: 'Erro ao criar lembrete: ' + e2.message }, 500)
  }
})

export default emprestimos
