// src/routes/importacao.ts — v3.0
// Importação CSV com: cartão, parcelas retroativas/futuras, tags sugeridas, detecção de duplicatas
import { Hono } from 'hono'
import { requireAuth } from './auth'

type Bindings = { DB: D1Database }
type Variables = { user: { id: number; nome: string; email: string; plano: string } }

const importacao = new Hono<{ Bindings: Bindings; Variables: Variables }>()

// ═══════════════════════════════════════════════════════════════════════════════
// UTILITÁRIOS
// ═══════════════════════════════════════════════════════════════════════════════

function norm(s: string): string {
  return (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim()
}

function normDesc(s: string): string {
  // Normaliza descrição para comparação: remove espaços duplos, acentos, caracteres especiais
  return norm(s).replace(/[\s\-_\/\\\.]+/g, ' ').replace(/\s+/g, ' ').trim()
}

function detectarCategoria(desc: string): string {
  const d = norm(desc)
  if (/uber|99|taxi|combustivel|gasolina|onibus|metro|transporte|estacion|pedagio|carro|automovel/.test(d)) return 'Transporte'
  if (/ifood|rappi|delivery|restaurante|lanche|almoco|jantar|pizza|hamburger|sushi|comida|alimenta|mercado|supermercado|padaria|acougue/.test(d)) return 'Alimentação'
  if (/aluguel|condominio|iptu|luz|energia|agua|gas|internet|telefone|moradia|casa|residencia|habitacao/.test(d)) return 'Moradia'
  if (/netflix|spotify|amazon|prime|youtube|hbo|disney|apple|streaming|assinatura|deezer|globoplay/.test(d)) return 'Streaming'
  if (/farmacia|medico|consulta|plano.saude|academia|saude|hospital|exame|dentista|otica/.test(d)) return 'Saúde'
  if (/faculdade|curso|livro|escola|educacao|material|estudo|universidade|colegio/.test(d)) return 'Educação'
  if (/roupa|sapato|vestuario|shopping|fashion|moda|calcado|bolsa/.test(d)) return 'Vestuário'
  if (/cinema|show|bar|festa|lazer|viagem|hotel|diversao|teatro|museu|parque/.test(d)) return 'Lazer'
  if (/pet|veterinario|racao|banho|tosa/.test(d)) return 'Pets'
  return 'Outros'
}

function detectarMeioPagamento(desc: string): string {
  const d = norm(desc)
  if (/\bpix\b|transf.*pix|pix.*transf/.test(d)) return 'pix'
  if (/ted\b|doc\b|transfer[eê]ncia|transf\b/.test(d)) return 'transferencia'
  if (/boleto|compensacao|comp\./.test(d)) return 'boleto'
  if (/d[eé]bito|deb\./.test(d)) return 'cartao_debito'
  if (/cr[eé]dito|cred\./.test(d)) return 'cartao_credito'
  return 'dinheiro'
}

// Detecta padrão de parcela na descrição: "3/12", "PARC 3/12", "3 DE 12", "3X", "3x de R$"
function detectarParcela(desc: string): { atual: number; total: number } | null {
  const d = desc.toUpperCase()

  // Padrão "3/12" ou "03/12"
  const m1 = d.match(/\b(\d{1,2})\s*[\/]\s*(\d{1,2})\b/)
  if (m1) {
    const atual = parseInt(m1[1]), total = parseInt(m1[2])
    if (total > 1 && atual >= 1 && atual <= total && total <= 72) return { atual, total }
  }

  // Padrão "PARCELA 3 DE 12" ou "PARC 03 DE 12"
  const m2 = d.match(/PARC[ELA]*\s*(\d{1,2})\s*(?:DE|OF)\s*(\d{1,2})/)
  if (m2) {
    const atual = parseInt(m2[1]), total = parseInt(m2[2])
    if (total > 1 && atual >= 1 && atual <= total) return { atual, total }
  }

  // Padrão "3X" ou "EM 3X" (sem saber parcela atual — assume parcela 1)
  const m3 = d.match(/\bEM\s+(\d{1,2})[Xx]\b|\b(\d{1,2})\s*[Xx]\s+DE\b/)
  if (m3) {
    const total = parseInt(m3[1] || m3[2])
    if (total > 1 && total <= 72) return { atual: 1, total }
  }

  return null
}

function parseValor(raw: string): number | null {
  if (!raw) return null
  let s = raw.replace(/[R$\s"']/g, '').trim()
  // Formato BR: 1.234,56
  if (/^\d{1,3}(\.\d{3})*(,\d+)?$/.test(s)) {
    s = s.replace(/\./g, '').replace(',', '.')
  } else {
    s = s.replace(/,/g, '')
  }
  const v = parseFloat(s)
  return isNaN(v) || v <= 0 ? null : v
}

function parseData(raw: string): string | null {
  if (!raw) return null
  const s = raw.trim().replace(/"/g, '')
  const m1 = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/)
  if (m1) return `${m1[3]}-${m1[2].padStart(2,'0')}-${m1[1].padStart(2,'0')}`
  const m2 = s.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/)
  if (m2) return `${m2[1]}-${m2[2].padStart(2,'0')}-${m2[3].padStart(2,'0')}`
  return null
}

function parseCsvLine(line: string): string[] {
  const result: string[] = []
  let current = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (inQuotes && line[i+1] === '"') { current += '"'; i++ }
      else inQuotes = !inQuotes
    } else if ((ch === ',' || ch === ';') && !inQuotes) {
      result.push(current.trim())
      current = ''
    } else {
      current += ch
    }
  }
  result.push(current.trim())
  return result
}

// Adiciona meses a uma data ISO sem UTC drift
function addMonths(isoDate: string, months: number): string {
  const [y, m, d] = isoDate.split('-').map(Number)
  let nm = m + months
  let ny = y
  while (nm > 12) { nm -= 12; ny++ }
  while (nm < 1)  { nm += 12; ny-- }
  const lastDay = new Date(ny, nm, 0).getDate()
  return `${ny}-${String(nm).padStart(2,'0')}-${String(Math.min(d, lastDay)).padStart(2,'0')}`
}

// Calcula billing_month/year de um cartão dado a data da compra
function calcBilling(cartao: any, dataCompra: string): { bMonth: number; bYear: number; dataVenc: string } {
  const [y, m, d] = dataCompra.split('-').map(Number)
  let bm = m, by = y
  if (d >= cartao.dia_fechamento) { bm++; if (bm > 12) { bm = 1; by++ } }

  let vm = bm, vy = by
  if (cartao.dia_vencimento <= cartao.dia_fechamento) {
    vm++; if (vm > 12) { vm = 1; vy++ }
  }
  const lastDay = new Date(vy, vm, 0).getDate()
  const vd = Math.min(cartao.dia_vencimento, lastDay)
  const dataVenc = `${vy}-${String(vm).padStart(2,'0')}-${String(vd).padStart(2,'0')}`
  return { bMonth: bm, bYear: by, dataVenc }
}

function gerarUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
  })
}

// ═══════════════════════════════════════════════════════════════════════════════
// POST /api/importacao/preview
// ═══════════════════════════════════════════════════════════════════════════════
importacao.post('/preview', requireAuth, async (c) => {
  const user = c.get('user')
  try {
    const body = await c.req.json()
    const { csv, tipo } = body

    if (!csv || typeof csv !== 'string') return c.json({ error: 'CSV inválido' }, 400)

    const linhas = csv.split('\n').filter((l: string) => l.trim())
    if (linhas.length < 2) return c.json({ error: 'CSV precisa ter cabeçalho + ao menos 1 linha' }, 400)

    const cabecalho = parseCsvLine(linhas[0]).map(h => norm(h))

    // Detectar colunas
    const idxData  = cabecalho.findIndex(h => /^(data|date|dt|data_compra|data_lancamento)$/.test(h) || /data|date/.test(h))
    const idxDesc  = cabecalho.findIndex(h => /^(descricao|descr|desc|historico|nome|titulo|estabelecimento)$/.test(h) || /descr|historico|estabelec/.test(h))
    const idxValor = cabecalho.findIndex(h => /^(valor|value|amount|total|montante|debito|debit)$/.test(h) || /valor|amount|total/.test(h))
    const idxCat   = cabecalho.findIndex(h => /^(categoria|categ|category|tipo|grupo)$/.test(h))
    const idxMeio  = cabecalho.findIndex(h => /^(meio|pagamento|forma|tipo_pagamento|payment)$/.test(h))

    if (idxValor === -1) return c.json({ error: 'Coluna de valor não encontrada. Certifique-se de ter uma coluna "valor", "amount" ou "total".' }, 400)

    // Buscar cartões do usuário
    const cartoesList = await c.env.DB.prepare(
      `SELECT id, nome, bandeira, limite_total, limite_disponivel FROM cartoes WHERE user_id=? ORDER BY nome`
    ).bind(user.id).all<any>()

    // Buscar tags do usuário
    const tagsList = await c.env.DB.prepare(
      `SELECT id, nome, cor FROM tags WHERE user_id=? ORDER BY nome`
    ).bind(user.id).all<any>()

    // Buscar despesas recentes para detecção de duplicatas (últimos 90 dias)
    const despesasRecentes = await c.env.DB.prepare(
      `SELECT id, descricao, valor, data, categoria FROM despesas
       WHERE user_id=? AND data >= date('now','-90 days')
       ORDER BY data DESC LIMIT 500`
    ).bind(user.id).all<any>()

    const todasDespesas = despesasRecentes.results || []
    const tagsDisp = tagsList.results || []

    const preview: any[] = []
    const erros: string[] = []

    const totalLinhas = linhas.length - 1

    // Processar TODAS as linhas para preview enriquecido
    for (let i = 1; i < linhas.length; i++) {
      const cols = parseCsvLine(linhas[i])
      if (cols.length < 2 || cols.every(c => !c.trim())) continue

      const valorRaw = idxValor >= 0 ? cols[idxValor] : ''
      const valor    = parseValor(valorRaw)
      const dataRaw  = idxData  >= 0 ? cols[idxData]  : ''
      const data     = parseData(dataRaw) || new Date().toISOString().slice(0,10)
      const desc     = (idxDesc >= 0 ? cols[idxDesc]?.trim() : '') || `Importado linha ${i}`
      const catBruta = idxCat  >= 0 ? cols[idxCat]?.trim()  : ''
      const meioRaw  = idxMeio >= 0 ? cols[idxMeio]?.trim() : ''

      if (!valor) { erros.push(`Linha ${i+1}: valor inválido ("${valorRaw}")`); continue }
      if (!parseData(dataRaw) && dataRaw) { erros.push(`Linha ${i+1}: data inválida ("${dataRaw}")`); continue }

      const cat  = catBruta || detectarCategoria(desc)
      const meio = meioRaw  ? detectarMeioPagamento(meioRaw) : detectarMeioPagamento(desc)

      // ── Detecção de parcelas ──────────────────────────────────────────────
      const parcela = detectarParcela(desc)
      let parcelaInfo: any = null
      if (parcela) {
        const { atual, total } = parcela
        const retroativas  = atual - 1          // meses já passados
        const futuras      = total - atual       // meses futuros
        // Data base = data da linha ajustada para ser a compra original (mês - (atual-1))
        const dataBase = addMonths(data, -(atual - 1))
        parcelaInfo = { atual, total, retroativas, futuras, dataBase, valorParcela: valor }
      }

      // ── Sugestão de tag ───────────────────────────────────────────────────
      let tagSugerida: any = null
      const dNorm = normDesc(desc)
      const catNorm = norm(cat)
      for (const t of tagsDisp) {
        const tNorm = norm(t.nome)
        if (dNorm.includes(tNorm) || tNorm.includes(dNorm.split(' ')[0])) {
          tagSugerida = t; break
        }
        if (catNorm.includes(tNorm) || tNorm.includes(catNorm)) {
          tagSugerida = t; break
        }
      }

      // ── Detecção de duplicatas ────────────────────────────────────────────
      let duplicata: any = null
      const descNorm = normDesc(desc)
      const valorArredondado = Math.round(valor * 100)

      for (const d2 of todasDespesas) {
        const d2Norm  = normDesc(d2.descricao || '')
        const d2Valor = Math.round((d2.valor || 0) * 100)
        const d2Data  = d2.data || ''
        const diasDif = Math.abs(new Date(data).getTime() - new Date(d2Data).getTime()) / 86400000

        // 🔴 Duplicata Provável: mesma desc + mesmo valor + mesma data (±3 dias)
        if (d2Norm === descNorm && d2Valor === valorArredondado && diasDif <= 3) {
          duplicata = { nivel: 'provavel', motivo: `Mesma descrição + valor + data (${d2Data})`, id: d2.id, data_existente: d2Data }
          break
        }
        // 🟡 Duplicata Possível: mesma desc + mesmo valor + diferente mês (parcela?)
        if (d2Norm === descNorm && d2Valor === valorArredondado && diasDif > 3 && diasDif <= 40) {
          duplicata = { nivel: 'possivel', motivo: `Mesma descrição + valor em data próxima (${d2Data})`, id: d2.id, data_existente: d2Data }
          break
        }
        // 🟡 Parcela já cadastrada: valor igual + desc similar (70%+ match) + ~30 dias
        if (d2Valor === valorArredondado && diasDif >= 25 && diasDif <= 40) {
          const wordsA = descNorm.split(' ').filter(w => w.length > 3)
          const wordsB = d2Norm.split(' ').filter(w => w.length > 3)
          const common = wordsA.filter(w => wordsB.includes(w))
          const similarity = wordsA.length > 0 ? common.length / wordsA.length : 0
          if (similarity >= 0.6) {
            duplicata = { nivel: 'possivel', motivo: `Possível parcela já cadastrada (${d2Data}, R$ ${d2.valor?.toFixed(2)})`, id: d2.id, data_existente: d2Data }
            break
          }
        }
      }

      preview.push({
        linha: i + 1,
        data,
        descricao: desc.slice(0, 200),
        valor,
        categoria: cat,
        meio_pagamento: meio,
        parcela: parcelaInfo,
        tag_sugerida: tagSugerida,
        duplicata,
        // decisão do usuário: null=pendente, true=importar, false=ignorar
        decisao: duplicata ? null : true
      })
    }

    return c.json({
      preview,
      total_linhas: totalLinhas,
      colunas_detectadas: {
        data:      idxData  >= 0 ? cabecalho[idxData]  : null,
        descricao: idxDesc  >= 0 ? cabecalho[idxDesc]  : null,
        valor:     idxValor >= 0 ? cabecalho[idxValor] : null,
        categoria: idxCat   >= 0 ? cabecalho[idxCat]   : null,
        meio:      idxMeio  >= 0 ? cabecalho[idxMeio]  : null,
      },
      cabecalho_original: cabecalho,
      erros_preview: erros,
      cartoes: cartoesList.results || [],
      tags: tagsDisp,
      stats: {
        total: preview.length,
        duplicatas_provaveis:  preview.filter(p => p.duplicata?.nivel === 'provavel').length,
        duplicatas_possiveis:  preview.filter(p => p.duplicata?.nivel === 'possivel').length,
        parcelas_detectadas:   preview.filter(p => p.parcela).length,
        tags_sugeridas:        preview.filter(p => p.tag_sugerida).length,
      }
    })
  } catch (e: any) {
    return c.json({ error: 'Erro ao processar CSV: ' + e.message }, 500)
  }
})

// ═══════════════════════════════════════════════════════════════════════════════
// POST /api/importacao/executar — importação real v3
// ═══════════════════════════════════════════════════════════════════════════════
importacao.post('/executar', requireAuth, async (c) => {
  const user = c.get('user')
  try {
    const body = await c.req.json()
    const {
      csv, tipo, mapeamento,
      cartao_id,          // opcional: id do cartão para vincular ao lote inteiro
      linhas_config,      // array: [{ linha, importar, tag_id, cartao_id_override }]
    } = body

    if (!csv || !tipo || !mapeamento) return c.json({ error: 'Parâmetros inválidos' }, 400)
    if (!['despesas','receitas'].includes(tipo)) return c.json({ error: 'Tipo inválido' }, 400)

    const linhasCsv = csv.split('\n').filter((l: string) => l.trim())
    if (linhasCsv.length < 2) return c.json({ error: 'CSV vazio' }, 400)

    const { data: idxData, descricao: idxDesc, valor: idxValor, categoria: idxCat } = mapeamento

    // Buscar cartão do lote (se informado)
    let cartaoLote: any = null
    const cIdLote = cartao_id ? parseInt(String(cartao_id)) : null
    if (cIdLote) {
      cartaoLote = await c.env.DB.prepare(
        `SELECT * FROM cartoes WHERE id=? AND user_id=?`
      ).bind(cIdLote, user.id).first() as any
    }

    // Indexar config por linha (1-based)
    const configPorLinha: Record<number, any> = {}
    if (Array.isArray(linhas_config)) {
      for (const lc of linhas_config) configPorLinha[lc.linha] = lc
    }

    let importados = 0
    let ignorados  = 0
    let parcelas_criadas = 0
    const erroDetalhes: string[] = []
    const idsImportados: number[] = []

    for (let i = 1; i < linhasCsv.length; i++) {
      const numLinha = i + 1
      const cols = parseCsvLine(linhasCsv[i])
      if (cols.length < 2 || cols.every((c: string) => !c.trim())) continue

      const cfg = configPorLinha[numLinha] || {}

      // Se decisão explícita for false → ignorar
      if (cfg.importar === false) { ignorados++; continue }

      const valor = idxValor !== undefined ? parseValor(cols[idxValor]) : null
      const data  = idxData  !== undefined ? parseData(cols[idxData])   : new Date().toISOString().slice(0,10)
      const desc  = idxDesc  !== undefined ? (cols[idxDesc]?.trim().slice(0,200) || `Importado ${i}`) : `Importado linha ${i}`
      const catBruta = idxCat !== undefined ? cols[idxCat]?.trim() : ''
      const cat   = catBruta || detectarCategoria(desc)

      if (!valor || !data) {
        ignorados++
        erroDetalhes.push(`Linha ${numLinha}: ${!valor ? 'valor inválido' : 'data inválida'}`)
        continue
      }

      // Cartão: override por linha > lote geral
      const cIdFinal = cfg.cartao_id_override
        ? parseInt(String(cfg.cartao_id_override))
        : cIdLote
      let cartaoFinal: any = null
      if (cIdFinal) {
        cartaoFinal = cartaoFinal || (cIdFinal === cIdLote ? cartaoLote : null)
        if (!cartaoFinal) {
          cartaoFinal = await c.env.DB.prepare(
            `SELECT * FROM cartoes WHERE id=? AND user_id=?`
          ).bind(cIdFinal, user.id).first() as any
        }
      }

      const meio = cartaoFinal ? 'cartao_credito' : detectarMeioPagamento(desc)

      try {
        if (tipo === 'receitas') {
          // ── RECEITA (simples, sem parcelas) ─────────────────────────────────
          const r = await c.env.DB.prepare(
            `INSERT INTO receitas (user_id, descricao, valor, categoria, data, observacoes)
             VALUES (?, ?, ?, ?, ?, 'Importado via CSV')`
          ).bind(user.id, desc, valor, cat, data).run()
          idsImportados.push(r.meta.last_row_id as number)
          importados++

        } else {
          // ── DESPESA ──────────────────────────────────────────────────────────
          const parcela = detectarParcela(desc)

          if (parcela && parcela.total > 1) {
            // Criar histórico COMPLETO (retroativas + futuras)
            const { atual, total } = parcela
            const dataBase    = addMonths(data, -(atual - 1))  // mês da compra original
            const valorParcela = valor  // valor já é o da parcela
            const groupId      = gerarUUID()

            for (let p = 1; p <= total; p++) {
              const dataParcela = addMonths(dataBase, p - 1)
              let bMonth: number | null = null
              let bYear:  number | null = null
              let dataVenc: string | null = null
              let dataParaGravar = dataParcela

              if (cartaoFinal) {
                const bc = calcBilling(cartaoFinal, dataParcela)
                bMonth = bc.bMonth; bYear = bc.bYear; dataVenc = bc.dataVenc
                dataParaGravar = dataVenc
              }

              const descParcela = `${desc.replace(/\s*\d{1,2}\/\d{1,2}\s*/, ' ').trim()} (${p}/${total})`
              const statusParcela = dataParcela <= new Date().toISOString().slice(0,10) ? 'pago' : 'pendente'

              const r = await c.env.DB.prepare(
                `INSERT INTO despesas (user_id, descricao, data, categoria, valor,
                 parcelado, numero_parcelas, parcela_atual, status, fixa_ou_variavel,
                 vencimento, observacoes, cartao_id, meio_pagamento,
                 billing_month, billing_year, purchase_group_id, tipo)
                 VALUES (?,?,?,?,?,1,?,?,?,?, ?,?,?,?, ?,?,?,?)`
              ).bind(
                user.id, descParcela, dataParaGravar, cat, valorParcela,
                total, p, statusParcela, 'variavel',
                dataVenc, 'Importado via CSV',
                cIdFinal || null, cartaoFinal ? 'cartao_credito' : meio,
                bMonth, bYear, groupId, 'normal'
              ).run()

              const newId = r.meta.last_row_id as number
              idsImportados.push(newId)
              parcelas_criadas++

              // card_charge se cartão
              if (cartaoFinal && bMonth && bYear && dataVenc) {
                await c.env.DB.prepare(
                  `INSERT INTO card_charges (card_id, expense_id, descricao, valor, data_compra,
                   data_vencimento, billing_month, billing_year, parcela_atual, total_parcelas,
                   purchase_group_id, status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
                ).bind(
                  cIdFinal, newId, descParcela, valorParcela,
                  dataParcela, dataVenc, bMonth, bYear, p, total, groupId,
                  statusParcela
                ).run().catch(() => {})
              }
            }

            // Reduzir limite do cartão pelas parcelas pendentes
            if (cartaoFinal) {
              const pendentes = Array.from({ length: total }, (_, k) => {
                const dp = addMonths(dataBase, k)
                return dp > new Date().toISOString().slice(0,10)
              }).filter(Boolean).length
              if (pendentes > 0) {
                await c.env.DB.prepare(
                  `UPDATE cartoes SET limite_disponivel = MAX(0, limite_disponivel - ?) WHERE id=? AND user_id=?`
                ).bind(valorParcela * pendentes, cIdFinal, user.id).run().catch(() => {})
              }
            }

            importados++

          } else {
            // ── Despesa simples (sem parcelas detectadas) ─────────────────────
            let bMonth: number | null = null
            let bYear:  number | null = null
            let dataVenc: string | null = null
            let dataParaGravar = data

            if (cartaoFinal) {
              const bc = calcBilling(cartaoFinal, data)
              bMonth = bc.bMonth; bYear = bc.bYear; dataVenc = bc.dataVenc
              dataParaGravar = dataVenc
            }

            const r = await c.env.DB.prepare(
              `INSERT INTO despesas (user_id, descricao, data, categoria, valor,
               parcelado, numero_parcelas, parcela_atual, status, fixa_ou_variavel,
               vencimento, observacoes, cartao_id, meio_pagamento,
               billing_month, billing_year, tipo)
               VALUES (?,?,?,?,?, 0,1,1,?,?, ?,?,?,?, ?,?,?)`
            ).bind(
              user.id, desc, dataParaGravar, cat, valor,
              'pago', 'variavel',
              dataVenc, 'Importado via CSV',
              cIdFinal || null, cartaoFinal ? 'cartao_credito' : meio,
              bMonth, bYear, 'normal'
            ).run()

            const newId = r.meta.last_row_id as number
            idsImportados.push(newId)

            if (cartaoFinal && bMonth && bYear && dataVenc) {
              await c.env.DB.prepare(
                `INSERT INTO card_charges (card_id, expense_id, descricao, valor, data_compra,
                 data_vencimento, billing_month, billing_year, parcela_atual, total_parcelas,
                 purchase_group_id, status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
              ).bind(
                cIdFinal, newId, desc, valor, data,
                dataVenc, bMonth, bYear, null, null, null, 'pago'
              ).run().catch(() => {})

              // Reduzir limite se pendente
              await c.env.DB.prepare(
                `UPDATE cartoes SET limite_disponivel = MAX(0, limite_disponivel - ?) WHERE id=? AND user_id=?`
              ).bind(valor, cIdFinal, user.id).run().catch(() => {})
            }

            importados++
          }

          // ── Vincular tags ─────────────────────────────────────────────────
          const tagId = cfg.tag_id ? parseInt(String(cfg.tag_id)) : null
          if (tagId && idsImportados.length > 0) {
            const lastId = idsImportados[idsImportados.length - 1]
            // Para parceladas, vincular apenas à primeira parcela
            const idParaTag = parcelas_criadas > 1
              ? idsImportados[idsImportados.length - (parcelas_criadas > 0 ? parcelas_criadas : 1)]
              : lastId
            await c.env.DB.prepare(
              `INSERT OR IGNORE INTO despesa_tags (despesa_id, tag_id) VALUES (?,?)`
            ).bind(idParaTag || lastId, tagId).run().catch(() => {})
          }
        }

      } catch (insertErr: any) {
        ignorados++
        const msg = insertErr?.message || insertErr?.cause?.message || 'erro ao inserir'
        erroDetalhes.push(`Linha ${numLinha}: ${msg}`)
      }
    }

    const totalReal = importados + ignorados
    return c.json({
      success: true,
      importados,
      ignorados,
      parcelas_criadas,
      erros_detalhes: erroDetalhes.slice(0, 20),
      ids_importados: idsImportados.slice(0, 50),
      mensagem: `${importados} ${tipo} importadas com sucesso${ignorados > 0 ? `. ${ignorados} linha(s) ignoradas.` : '.'}`
        + (parcelas_criadas > 0 ? ` (${parcelas_criadas} parcelas geradas)` : '')
    })
  } catch (e: any) {
    return c.json({ error: 'Erro na importação: ' + e.message }, 500)
  }
})

export default importacao
