// src/routes/importacao.ts — v4.0
// Melhorias: tag automática por categoria, meio_pagamento por cartão, status correto por meio
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

// Cor padrão por categoria para criação automática de tags
const COR_CATEGORIA: Record<string, string> = {
  'Alimentação': '#10B981',
  'Transporte':  '#3B82F6',
  'Streaming':   '#8B5CF6',
  'Saúde':       '#EF4444',
  'Moradia':     '#F59E0B',
  'Educação':    '#F97316',
  'Lazer':       '#EC4899',
  'Vestuário':   '#92400E',
  'Pets':        '#78716C',
  'Outros':      '#6B7280',
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

// Regra de status por meio de pagamento
// cartao_credito / parcelado_cartao → pendente (entra na fatura)
// demais (dinheiro, pix, debito, boleto, transferencia) → pago (já debitou)
function statusPorMeio(meio: string, dataISO: string): string {
  if (meio === 'cartao_credito' || meio === 'parcelado_cartao') return 'pendente'
  return 'pago'
}

// Para parcelas: passadas → pago, atual/futuras → pendente (sempre, independente do meio)
function statusParcela(dataParcela: string, meio: string): string {
  const hoje = new Date().toISOString().slice(0, 10)
  if (meio === 'dinheiro' || meio === 'pix' || meio === 'cartao_debito' ||
      meio === 'transferencia' || meio === 'boleto') {
    // Débito imediato: só parcelas passadas ficam pagas
    return dataParcela < hoje ? 'pago' : 'pendente'
  }
  // Cartão de crédito: todas pendentes (fatura)
  return 'pendente'
}

function detectarParcela(desc: string): { atual: number; total: number } | null {
  const d = desc.toUpperCase()
  const m1 = d.match(/\b(\d{1,2})\s*[\/]\s*(\d{1,2})\b/)
  if (m1) {
    const atual = parseInt(m1[1]), total = parseInt(m1[2])
    if (total > 1 && atual >= 1 && atual <= total && total <= 72) return { atual, total }
  }
  const m2 = d.match(/PARC[ELA]*\s*(\d{1,2})\s*(?:DE|OF)\s*(\d{1,2})/)
  if (m2) {
    const atual = parseInt(m2[1]), total = parseInt(m2[2])
    if (total > 1 && atual >= 1 && atual <= total) return { atual, total }
  }
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

function addMonths(isoDate: string, months: number): string {
  const [y, m, d] = isoDate.split('-').map(Number)
  let nm = m + months
  let ny = y
  while (nm > 12) { nm -= 12; ny++ }
  while (nm < 1)  { nm += 12; ny-- }
  const lastDay = new Date(ny, nm, 0).getDate()
  return `${ny}-${String(nm).padStart(2,'0')}-${String(Math.min(d, lastDay)).padStart(2,'0')}`
}

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

// Busca ou cria tag por nome de categoria para um usuário
async function buscarOuCriarTag(db: D1Database, userId: number, nome: string, tagsCache: Map<string, any>): Promise<any> {
  const nomeNorm = norm(nome)
  if (tagsCache.has(nomeNorm)) return tagsCache.get(nomeNorm)

  // Buscar existente pelo nome normalizado
  const existente = await db.prepare(
    `SELECT id, nome, cor FROM tags WHERE user_id=? AND lower(replace(replace(replace(replace(replace(replace(nome,'á','a'),'ã','a'),'â','a'),'é','e'),'ê','e'),'ó','o')) LIKE ?`
  ).bind(userId, '%' + nomeNorm + '%').first<any>()

  if (existente) {
    tagsCache.set(nomeNorm, existente)
    return existente
  }

  // Criar nova tag com cor da categoria
  const cor = COR_CATEGORIA[nome] || '#6B7280'
  const r = await db.prepare(
    `INSERT INTO tags (user_id, nome, cor) VALUES (?,?,?)`
  ).bind(userId, nome, cor).run()

  const novaTag = { id: r.meta.last_row_id as number, nome, cor, criada_agora: true }
  tagsCache.set(nomeNorm, novaTag)
  return novaTag
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

    const idxData  = cabecalho.findIndex(h => /^(data|date|dt|data_compra|data_lancamento)$/.test(h) || /data|date/.test(h))
    const idxDesc  = cabecalho.findIndex(h => /^(descricao|descr|desc|historico|nome|titulo|estabelecimento)$/.test(h) || /descr|historico|estabelec/.test(h))
    const idxValor = cabecalho.findIndex(h => /^(valor|value|amount|total|montante|debito|debit)$/.test(h) || /valor|amount|total/.test(h))
    const idxCat   = cabecalho.findIndex(h => /^(categoria|categ|category|tipo|grupo)$/.test(h))
    const idxMeio  = cabecalho.findIndex(h => /^(meio|pagamento|forma|tipo_pagamento|payment)$/.test(h))

    if (idxValor === -1) return c.json({ error: 'Coluna de valor não encontrada.' }, 400)

    // Buscar dados do usuário
    const [cartoesList, tagsList, despesasRec] = await Promise.all([
      c.env.DB.prepare(`SELECT id, nome, bandeira, limite_total, limite_disponivel FROM cartoes WHERE user_id=? ORDER BY nome`).bind(user.id).all<any>(),
      c.env.DB.prepare(`SELECT id, nome, cor FROM tags WHERE user_id=? ORDER BY nome`).bind(user.id).all<any>(),
      c.env.DB.prepare(`SELECT id, descricao, valor, data, categoria FROM despesas WHERE user_id=? AND data >= date('now','-90 days') ORDER BY data DESC LIMIT 500`).bind(user.id).all<any>(),
    ])

    const todasDespesas = despesasRec.results || []
    const tagsDisp = tagsList.results || []
    // Cache de tags por nome normalizado (nome → objeto tag)
    const tagsMap = new Map<string, any>()
    for (const t of tagsDisp) tagsMap.set(norm(t.nome), t)

    const preview: any[] = []
    const erros: string[] = []
    const totalLinhas = linhas.length - 1

    for (let i = 1; i < linhas.length; i++) {
      const cols = parseCsvLine(linhas[i])
      if (cols.length < 2 || cols.every((c: string) => !c.trim())) continue

      const valorRaw = idxValor >= 0 ? cols[idxValor] : ''
      const valor    = parseValor(valorRaw)
      const dataRaw  = idxData  >= 0 ? cols[idxData]  : ''
      const data     = parseData(dataRaw) || new Date().toISOString().slice(0, 10)
      const desc     = (idxDesc >= 0 ? cols[idxDesc]?.trim() : '') || `Importado linha ${i}`
      const catBruta = idxCat  >= 0 ? cols[idxCat]?.trim()  : ''
      const meioRaw  = idxMeio >= 0 ? cols[idxMeio]?.trim() : ''

      if (!valor) { erros.push(`Linha ${i+1}: valor inválido ("${valorRaw}")`); continue }
      if (!parseData(dataRaw) && dataRaw) { erros.push(`Linha ${i+1}: data inválida ("${dataRaw}")`); continue }

      const cat  = catBruta || detectarCategoria(desc)
      const meio = meioRaw ? detectarMeioPagamento(meioRaw) : detectarMeioPagamento(desc)

      // ── Detecção de parcelas ──────────────────────────────────────────────
      const parcela = detectarParcela(desc)
      let parcelaInfo: any = null
      if (parcela) {
        const { atual, total } = parcela
        const dataBase = addMonths(data, -(atual - 1))
        parcelaInfo = { atual, total, retroativas: atual - 1, futuras: total - atual, dataBase, valorParcela: valor }
      }

      // ── Tag automática por categoria ──────────────────────────────────────
      // 1. Buscar tag existente cujo nome contenha a categoria ou vice-versa
      const catNorm = norm(cat)
      let tagAuto: any = null

      // Procurar match exato primeiro
      if (tagsMap.has(catNorm)) {
        tagAuto = tagsMap.get(catNorm)
      } else {
        // Match parcial: tag contém categoria ou categoria contém tag
        for (const [tnorm, t] of tagsMap) {
          if (catNorm.includes(tnorm) || tnorm.includes(catNorm)) {
            tagAuto = t; break
          }
        }
      }

      // Se não encontrou por categoria, tentar pela descrição
      if (!tagAuto) {
        const descNormTag = normDesc(desc)
        for (const [tnorm, t] of tagsMap) {
          if (descNormTag.includes(tnorm) || tnorm.includes(descNormTag.split(' ')[0])) {
            tagAuto = t; break
          }
        }
      }

      // Se ainda não tem tag → será criada na execução (mostrar no preview como "nova")
      if (!tagAuto) {
        // Verificar se já está no cache (pode ter sido adicionada por linha anterior)
        if (tagsMap.has(catNorm)) {
          tagAuto = tagsMap.get(catNorm)
        } else {
          // Tag nova a ser criada: montar objeto provisório
          tagAuto = {
            id: null,
            nome: cat,
            cor: COR_CATEGORIA[cat] || '#6B7280',
            nova: true,  // flag para mostrar "será criada" no frontend
          }
          // Adicionar ao map para próximas linhas da mesma categoria não repetirem
          tagsMap.set(catNorm, tagAuto)
        }
      }

      // ── Status sugerido ───────────────────────────────────────────────────
      const statusSugerido = statusPorMeio(meio, data)

      // ── Detecção de duplicatas ────────────────────────────────────────────
      let duplicata: any = null
      const descNorm = normDesc(desc)
      const valorArredondado = Math.round(valor * 100)

      for (const d2 of todasDespesas) {
        const d2Norm  = normDesc(d2.descricao || '')
        const d2Valor = Math.round((d2.valor || 0) * 100)
        const d2Data  = d2.data || ''
        const diasDif = Math.abs(new Date(data).getTime() - new Date(d2Data).getTime()) / 86400000

        if (d2Norm === descNorm && d2Valor === valorArredondado && diasDif <= 3) {
          duplicata = { nivel: 'provavel', motivo: `Mesma descrição + valor + data (${d2Data})`, id: d2.id, data_existente: d2Data }
          break
        }
        if (d2Norm === descNorm && d2Valor === valorArredondado && diasDif > 3 && diasDif <= 40) {
          duplicata = { nivel: 'possivel', motivo: `Mesma descrição + valor em data próxima (${d2Data})`, id: d2.id, data_existente: d2Data }
          break
        }
        if (d2Valor === valorArredondado && diasDif >= 25 && diasDif <= 40) {
          const wordsA = descNorm.split(' ').filter((w: string) => w.length > 3)
          const wordsB = d2Norm.split(' ').filter((w: string) => w.length > 3)
          const common = wordsA.filter((w: string) => wordsB.includes(w))
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
        status_sugerido: statusSugerido,
        parcela: parcelaInfo,
        tag_sugerida: tagAuto,
        duplicata,
        decisao: duplicata ? null : true,
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
      tags: tagsList.results || [],
      stats: {
        total: preview.length,
        duplicatas_provaveis:  preview.filter(p => p.duplicata?.nivel === 'provavel').length,
        duplicatas_possiveis:  preview.filter(p => p.duplicata?.nivel === 'possivel').length,
        parcelas_detectadas:   preview.filter(p => p.parcela).length,
        tags_novas:            preview.filter(p => p.tag_sugerida?.nova).length,
        tags_vinculadas:       preview.filter(p => p.tag_sugerida?.id).length,
      }
    })
  } catch (e: any) {
    return c.json({ error: 'Erro ao processar CSV: ' + e.message }, 500)
  }
})

// ═══════════════════════════════════════════════════════════════════════════════
// POST /api/importacao/executar — v4
// ═══════════════════════════════════════════════════════════════════════════════
importacao.post('/executar', requireAuth, async (c) => {
  const user = c.get('user')
  try {
    const body = await c.req.json()
    const {
      csv, tipo, mapeamento,
      cartao_id,
      linhas_config,
    } = body

    if (!csv || !tipo || !mapeamento) return c.json({ error: 'Parâmetros inválidos' }, 400)
    if (!['despesas','receitas'].includes(tipo)) return c.json({ error: 'Tipo inválido' }, 400)

    const linhasCsv = csv.split('\n').filter((l: string) => l.trim())
    if (linhasCsv.length < 2) return c.json({ error: 'CSV vazio' }, 400)

    const { data: idxData, descricao: idxDesc, valor: idxValor, categoria: idxCat } = mapeamento

    // Cartão do lote
    let cartaoLote: any = null
    const cIdLote = cartao_id ? parseInt(String(cartao_id)) : null
    if (cIdLote) {
      cartaoLote = await c.env.DB.prepare(
        `SELECT * FROM cartoes WHERE id=? AND user_id=?`
      ).bind(cIdLote, user.id).first() as any
    }

    // Indexar config por linha
    const configPorLinha: Record<number, any> = {}
    if (Array.isArray(linhas_config)) {
      for (const lc of linhas_config) configPorLinha[lc.linha] = lc
    }

    // Cache de tags para não re-criar na mesma execução
    const tagsCache = new Map<string, any>()
    // Popular cache com tags já existentes
    const tagsExist = await c.env.DB.prepare(`SELECT id, nome, cor FROM tags WHERE user_id=?`).bind(user.id).all<any>()
    for (const t of (tagsExist.results || [])) tagsCache.set(norm(t.nome), t)

    let importados = 0
    let ignorados  = 0
    let parcelas_criadas = 0
    let tags_criadas = 0
    const erroDetalhes: string[] = []
    const idsImportados: number[] = []

    for (let i = 1; i < linhasCsv.length; i++) {
      const numLinha = i + 1
      const cols = parseCsvLine(linhasCsv[i])
      if (cols.length < 2 || cols.every((c: string) => !c.trim())) continue

      const cfg = configPorLinha[numLinha] || {}
      if (cfg.importar === false) { ignorados++; continue }

      const valor = idxValor !== undefined ? parseValor(cols[idxValor]) : null
      const data  = idxData  !== undefined ? parseData(cols[idxData])   : new Date().toISOString().slice(0, 10)
      const desc  = idxDesc  !== undefined ? (cols[idxDesc]?.trim().slice(0, 200) || `Importado ${i}`) : `Importado linha ${i}`
      const catBruta = idxCat !== undefined ? cols[idxCat]?.trim() : ''
      const cat   = catBruta || detectarCategoria(desc)

      if (!valor || !data) {
        ignorados++
        erroDetalhes.push(`Linha ${numLinha}: ${!valor ? 'valor inválido' : 'data inválida'}`)
        continue
      }

      // Cartão: override por linha > lote geral
      const cIdFinal = cfg.cartao_id_override ? parseInt(String(cfg.cartao_id_override)) : cIdLote
      let cartaoFinal: any = null
      if (cIdFinal) {
        cartaoFinal = (cIdFinal === cIdLote ? cartaoLote : null)
        if (!cartaoFinal) {
          cartaoFinal = await c.env.DB.prepare(
            `SELECT * FROM cartoes WHERE id=? AND user_id=?`
          ).bind(cIdFinal, user.id).first() as any
        }
      }

      // Meio de pagamento: cartão selecionado → cartao_credito
      const meio = cartaoFinal ? 'cartao_credito' : detectarMeioPagamento(desc)

      // Status: override do usuário (cfg.status) ou regra automática
      const statusBase = cfg.status || statusPorMeio(meio, data)

      try {
        if (tipo === 'receitas') {
          const r = await c.env.DB.prepare(
            `INSERT INTO receitas (user_id, descricao, valor, categoria, data, observacoes)
             VALUES (?, ?, ?, ?, ?, 'Importado via CSV')`
          ).bind(user.id, desc, valor, cat, data).run()
          idsImportados.push(r.meta.last_row_id as number)
          importados++

        } else {
          // ── DESPESA ──────────────────────────────────────────────────────
          const parcela = detectarParcela(desc)

          if (parcela && parcela.total > 1) {
            // Criar histórico completo de parcelas
            const { atual, total } = parcela
            const dataBase     = addMonths(data, -(atual - 1))
            const valorParcela = valor
            const groupId      = gerarUUID()
            let primeiroId: number | null = null

            for (let p = 1; p <= total; p++) {
              const dataParcela   = addMonths(dataBase, p - 1)
              const statusParc    = cfg.status || statusParcela(dataParcela, meio)
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

              const r = await c.env.DB.prepare(
                `INSERT INTO despesas (user_id, descricao, data, categoria, valor,
                 parcelado, numero_parcelas, parcela_atual, status, fixa_ou_variavel,
                 vencimento, observacoes, cartao_id, meio_pagamento,
                 billing_month, billing_year, purchase_group_id, tipo)
                 VALUES (?,?,?,?,?,1,?,?,?,?,?,?,?,?,?,?,?,?)`
              ).bind(
                user.id, descParcela, dataParaGravar, cat, valorParcela,
                total, p, statusParc, 'variavel',
                dataVenc, 'Importado via CSV',
                cIdFinal || null, cartaoFinal ? 'cartao_credito' : meio,
                bMonth, bYear, groupId, 'normal'
              ).run()

              const newId = r.meta.last_row_id as number
              if (p === 1) primeiroId = newId
              idsImportados.push(newId)
              parcelas_criadas++

              if (cartaoFinal && bMonth && bYear && dataVenc) {
                await c.env.DB.prepare(
                  `INSERT INTO card_charges (card_id, expense_id, descricao, valor, data_compra,
                   data_vencimento, billing_month, billing_year, parcela_atual, total_parcelas,
                   purchase_group_id, status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
                ).bind(
                  cIdFinal, newId, descParcela, valorParcela,
                  dataParcela, dataVenc, bMonth, bYear, p, total, groupId, statusParc
                ).run().catch(() => {})
              }
            }

            // Atualizar limite do cartão pelas parcelas pendentes
            if (cartaoFinal) {
              const hoje = new Date().toISOString().slice(0, 10)
              let pendentesCount = 0
              for (let p = 1; p <= total; p++) {
                const dp = addMonths(dataBase, p - 1)
                if (dp >= hoje) pendentesCount++
              }
              if (pendentesCount > 0) {
                await c.env.DB.prepare(
                  `UPDATE cartoes SET limite_disponivel = MAX(0, limite_disponivel - ?) WHERE id=? AND user_id=?`
                ).bind(valorParcela * pendentesCount, cIdFinal, user.id).run().catch(() => {})
              }
            }

            importados++

            // Tag para a primeira parcela
            const tagId = cfg.tag_id ? parseInt(String(cfg.tag_id)) : null
            const semTag = cfg.sem_tag === true
            if (tagId && primeiroId) {
              await c.env.DB.prepare(
                `INSERT OR IGNORE INTO despesa_tags (despesa_id, tag_id) VALUES (?,?)`
              ).bind(primeiroId, tagId).run().catch(() => {})
            } else if (!tagId && !semTag && primeiroId) {
              // Tag automática por categoria
              const tagAuto = await buscarOuCriarTag(c.env.DB, user.id, cat, tagsCache)
              if (tagAuto?.id) {
                if (tagAuto.criada_agora) tags_criadas++
                await c.env.DB.prepare(
                  `INSERT OR IGNORE INTO despesa_tags (despesa_id, tag_id) VALUES (?,?)`
                ).bind(primeiroId, tagAuto.id).run().catch(() => {})
              }
            }

          } else {
            // ── Despesa simples ───────────────────────────────────────────
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
               VALUES (?,?,?,?,?,0,1,1,?,?,?,?,?,?,?,?,?)`
            ).bind(
              user.id, desc, dataParaGravar, cat, valor,
              statusBase, 'variavel',
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
                dataVenc, bMonth, bYear, null, null, null, statusBase
              ).run().catch(() => {})

              await c.env.DB.prepare(
                `UPDATE cartoes SET limite_disponivel = MAX(0, limite_disponivel - ?) WHERE id=? AND user_id=?`
              ).bind(valor, cIdFinal, user.id).run().catch(() => {})
            }

            importados++

            // Tag: manual > automática por categoria (respeitando sem_tag)
            const tagId = cfg.tag_id ? parseInt(String(cfg.tag_id)) : null
            const semTagSimples = cfg.sem_tag === true
            if (tagId) {
              await c.env.DB.prepare(
                `INSERT OR IGNORE INTO despesa_tags (despesa_id, tag_id) VALUES (?,?)`
              ).bind(newId, tagId).run().catch(() => {})
            } else if (!semTagSimples) {
              const tagAuto = await buscarOuCriarTag(c.env.DB, user.id, cat, tagsCache)
              if (tagAuto?.id) {
                if (tagAuto.criada_agora) tags_criadas++
                await c.env.DB.prepare(
                  `INSERT OR IGNORE INTO despesa_tags (despesa_id, tag_id) VALUES (?,?)`
                ).bind(newId, tagAuto.id).run().catch(() => {})
              }
            }
          }
        }

      } catch (insertErr: any) {
        ignorados++
        const msg = insertErr?.message || insertErr?.cause?.message || 'erro ao inserir'
        erroDetalhes.push(`Linha ${numLinha}: ${msg}`)
      }
    }

    return c.json({
      success: true,
      importados,
      ignorados,
      parcelas_criadas,
      tags_criadas,
      erros_detalhes: erroDetalhes.slice(0, 20),
      ids_importados: idsImportados.slice(0, 50),
      mensagem: `${importados} ${tipo} importadas com sucesso${ignorados > 0 ? `. ${ignorados} linha(s) ignoradas.` : '.'}`
        + (parcelas_criadas > 0 ? ` (${parcelas_criadas} parcelas geradas)` : '')
        + (tags_criadas > 0 ? ` | ${tags_criadas} tag(s) criada(s) automaticamente` : '')
    })
  } catch (e: any) {
    return c.json({ error: 'Erro na importação: ' + e.message }, 500)
  }
})

export default importacao
