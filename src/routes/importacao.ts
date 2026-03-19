// src/routes/importacao.ts — v5.0
// Melhorias v5: detecção de investimentos, recorrências, OCR via OpenAI Vision
import { Hono } from 'hono'
import { requireAuth } from './auth'

type Bindings = { DB: D1Database; OPENAI_API_KEY: string; OPENAI_BASE_URL: string }
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
  'Alimentação':      '#10B981',
  'Transporte':       '#3B82F6',
  'Streaming':        '#8B5CF6',
  'Saúde':            '#EF4444',
  'Saúde/Farmácia':   '#EF4444',
  'Moradia':          '#F59E0B',
  'Educação':         '#F97316',
  'Lazer':            '#EC4899',
  'Vestuário':        '#92400E',
  'Pets':             '#78716C',
  'Telecomunicações': '#06B6D4',
  'Taxas Bancárias':  '#DC2626',
  'Previdência':      '#7C3AED',
  'Seguros':          '#0EA5E9',
  'Financiamentos':   '#B45309',
  'Cartão de Crédito':'#6366F1',
  'Transferência':    '#64748B',
  'Receitas Extras':  '#34D399',
  'Rendimentos':      '#A3E635',
  'Salário':          '#22C55E',
  'Empréstimos':      '#F87171',
  'Compras':          '#FB923C',
  'Doações':          '#E879F9',
  'Contas Básicas':   '#FBBF24',
  'Outros':           '#6B7280',
}

function detectarMeioPagamento(desc: string): string {
  const d = norm(desc)
  if (/\bpix\b|transf.*pix|pix.*transf/.test(d)) return 'pix'
  if (/ted\b|doc\b|transfer[eê]ncia|transf\b/.test(d)) return 'transferencia'
  if (/boleto|compensacao|comp\./.test(d)) return 'boleto'
  if (/d[eé]bito|deb\./.test(d)) return 'cartao_debito'
  // Só cartão de crédito se vier junto de "cartão" ou "fatura" — evitar falso-positivo em "crédito consignado"
  if (/cart[aã]o.*cr[eé]d|cr[eé]d.*cart[aã]o|fatura.*cr[eé]d|cr[eé]d.*fatura|\bcred\.\b/.test(d)) return 'cartao_credito'
  if (/pagto salario|adiantamento|consignado|salario|rendimento|rend pago/.test(d)) return 'transferencia'
  return 'dinheiro'
}

// ── Detecção de investimento ──────────────────────────────────────────────────
// Retorna o tipo de investimento se reconhecido, ou null
function detectarInvestimento(desc: string, cat: string): { tipo: string; nome: string } | null {
  const d = norm(desc)
  const c = norm(cat)
  // Aplicações automáticas de banco
  if (/aplic\s*aut|aplicacao\s*aut|rend\s*pago\s*aplic|aplic\s*financ/.test(d)) return { tipo: 'caixinha', nome: 'Aplicação Automática' }
  // Tesouro Direto
  if (/tesouro\s*direto|tesouro\s*selic|tesouro\s*ipca|ntnb|ntnf|lft\b/.test(d)) return { tipo: 'tesouro_direto', nome: 'Tesouro Direto' }
  // CDB / RDB
  if (/\bcdb\b|\brdb\b|certif.*deposito/.test(d)) return { tipo: 'cdb', nome: 'CDB' }
  // LCI / LCA
  if (/\blci\b|\blca\b/.test(d)) return { tipo: /lci/.test(d) ? 'lci' : 'lca', nome: /lci/.test(d) ? 'LCI' : 'LCA' }
  // Ações / FII
  if (/\bbovespa\b|b3\b|acao\b|acoes\b|\bfii\b|fundo\s*imob/.test(d)) return { tipo: /fii/.test(d) ? 'fii' : 'acoes', nome: 'Renda Variável' }
  // Cripto
  if (/bitcoin|ethereum|cripto|crypto|btc\b|eth\b|binance|coinbase/.test(d)) return { tipo: 'cripto', nome: 'Criptoativo' }
  // Poupança
  if (/poupanca|caderneta/.test(d)) return { tipo: 'poupanca', nome: 'Poupança' }
  // Previdência
  if (/previdencia|pgbl|vgbl|fundo\s*prev/.test(d)) return { tipo: 'outros', nome: 'Previdência' }
  // Categoria explícita
  if (/investimento|rendimento|aplica/.test(c)) return { tipo: 'outros', nome: desc.slice(0, 60) }
  return null
}

// ── Detecção de recorrência ───────────────────────────────────────────────────
// Retorna sugestão de recorrência se o lançamento parece ser fixo
function detectarRecorrencia(desc: string, cat: string, tipo: 'despesa' | 'receita'): { descricao: string; categoria: string; tipo_rec: string } | null {
  const d = norm(desc)
  const c = norm(cat)
  // Salário / renda fixa
  if (/pagto\s*salario|salario|adiantamento\s*sal|13\s*salario/.test(d)) return { descricao: 'Salário', categoria: 'Salário', tipo_rec: 'receita' }
  if (/rend\s*pago|rendimento|dividendo|aluguel\s*receb/.test(d)) return { descricao: desc.slice(0, 60), categoria: 'Rendimentos', tipo_rec: 'receita' }
  // Contas fixas
  if (/energia|luz\b|enel|cemig|copel|coelba|celpe/.test(d)) return { descricao: 'Conta de Luz', categoria: 'Moradia', tipo_rec: 'despesa' }
  if (/agua\b|saneamento|sabesp|cedae|cagece/.test(d)) return { descricao: 'Conta de Água', categoria: 'Moradia', tipo_rec: 'despesa' }
  if (/internet|fibra|net\b|claro\b|vivo\b|oi\b|tim\b|celular/.test(d)) return { descricao: 'Internet / Telefone', categoria: 'Telecomunicações', tipo_rec: 'despesa' }
  if (/aluguel/.test(d)) return { descricao: 'Aluguel', categoria: 'Moradia', tipo_rec: 'despesa' }
  if (/condominio/.test(d)) return { descricao: 'Condomínio', categoria: 'Moradia', tipo_rec: 'despesa' }
  if (/netflix|spotify|amazon\s*prime|youtube\s*premium|disney|hbo|globoplay|deezer/.test(d)) return { descricao: desc.slice(0, 60), categoria: 'Streaming', tipo_rec: 'despesa' }
  if (/plano\s*saude|unimed|amil|bradesco\s*saude|sulamerica|hapvida/.test(d)) return { descricao: 'Plano de Saúde', categoria: 'Saúde', tipo_rec: 'despesa' }
  if (/academia|smartfit|bluefit/.test(d)) return { descricao: 'Academia', categoria: 'Saúde', tipo_rec: 'despesa' }
  if (/seguro\s*(auto|vida|resid|imovel)|porto\s*seg|tokio\s*mar|zurich/.test(d)) return { descricao: 'Seguro', categoria: 'Seguros', tipo_rec: 'despesa' }
  if (/financiamento|prestacao|credito\s*consignado|emprestimo/.test(d)) return { descricao: desc.slice(0, 60), categoria: 'Financiamentos', tipo_rec: 'despesa' }
  if (/iptu|ipva/.test(d)) return { descricao: /iptu/.test(d) ? 'IPTU' : 'IPVA', categoria: 'Contas Básicas', tipo_rec: 'despesa' }
  return null
}

// Regra de status por meio de pagamento
// cartao_credito / parcelado_cartao → pendente (entra na fatura)
// demais (dinheiro, pix, debito, boleto, transferencia) → pago (já debitou)
function statusPorMeio(meio: string, dataISO: string): string {
  if (meio === 'cartao_credito' || meio === 'parcelado_cartao') return 'pendente'
  return 'pago'
}

// Para parcelas retroativas:
// - data < hoje → 'pago' (já foi cobrado, independente do meio)
// - data >= hoje → 'pendente' (ainda vai cobrar / cair na fatura)
// Isso garante que parcelas passadas não consumam limite do cartão e apareçam como pagas.
function statusParcela(dataParcela: string, _meio: string): string {
  const hoje = new Date().toISOString().slice(0, 10)
  return dataParcela < hoje ? 'pago' : 'pendente'
}

function detectarParcela(desc: string): { atual: number; total: number } | null {
  const d = desc.toUpperCase()
  // Padrão X/Y: só considerar parcela se vier após espaço ou separador explícito
  // Evita confundir datas (17/03) e outros números com padrão de parcela
  const m1 = d.match(/(?:PARC(?:ELA)?|\s)(\d{1,2})\s*\/\s*(\d{1,2})(?:\s|$)/)
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

  // Guardar sinal negativo (despesas exportadas com - no início)
  const negativo = s.startsWith('-')
  if (negativo) s = s.slice(1).trim()

  // Formato brasileiro com ponto separador de milhar: 1.044,28
  if (/^\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(s)) {
    s = s.replace(/\./g, '').replace(',', '.')
  // Formato com apenas vírgula decimal sem ponto de milhar: 1044,28
  } else if (/^\d+(,\d{1,2})$/.test(s)) {
    s = s.replace(',', '.')
  // Formato americano com ponto decimal: 1044.28
  } else if (/^\d+(\.\d{1,2})?$/.test(s)) {
    // já está correto
  } else {
    // último recurso: remover vírgulas (pode ser separador de milhar no padrão americano)
    s = s.replace(/,/g, '')
  }

  const v = parseFloat(s)
  // Aceitar zero e negativos — zero é valor válido (ex: rendimentos de R$ 0,00)
  // Retorna sempre positivo; o tipo (despesa/receita) é definido pelo contexto da importação
  if (isNaN(v)) return null
  return Math.abs(v) === 0 ? 0.01 : Math.abs(v)  // centavos mínimos viram 0.01 se zerado pelo parse
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

// Detecta o delimitador dominante de um CSV analisando as primeiras linhas
function detectarDelimitador(linhas: string[]): ',' | ';' | '\t' {
  const amostra = linhas.slice(0, Math.min(5, linhas.length)).join('\n')
  const pontoVirgulas = (amostra.match(/;/g) || []).length
  const virgulas      = (amostra.match(/,/g) || []).length
  const tabs          = (amostra.match(/\t/g) || []).length
  if (tabs > pontoVirgulas && tabs > virgulas) return '\t'
  if (pontoVirgulas >= virgulas) return ';'
  return ','
}

function parseCsvLine(line: string, delimitador: string = ','): string[] {
  const result: string[] = []
  let current = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (inQuotes && line[i+1] === '"') { current += '"'; i++ }
      else inQuotes = !inQuotes
    } else if (ch === delimitador && !inQuotes) {
      result.push(current.trim())
      current = ''
    } else {
      current += ch
    }
  }
  result.push(current.trim())
  return result
}

// Detecção de colunas por conteúdo (fallback quando não há cabeçalho nomeado)
// Inspeciona as primeiras linhas de dados para inferir os índices
function detectarColunasPorConteudo(linhas: string[], delimitador: string): { idxData: number, idxDesc: number, idxValor: number, idxCat: number } {
  // Tenta 3 linhas de dados para votar nos tipos de cada coluna
  const votos: Record<number, { data: number, valor: number, texto: number }> = {}
  const amostras = linhas.slice(0, Math.min(4, linhas.length))
  for (const linha of amostras) {
    const cols = parseCsvLine(linha, delimitador)
    for (let c = 0; c < cols.length; c++) {
      if (!votos[c]) votos[c] = { data: 0, valor: 0, texto: 0 }
      const v = cols[c].trim()
      if (/^\d{2}[\/\-]\d{2}[\/\-]\d{4}$/.test(v) || /^\d{4}[\/\-]\d{2}[\/\-]\d{2}$/.test(v)) votos[c].data++
      else if (/^-?\d+[,.]?\d*$/.test(v.replace(/[R$\s.]/g, '').trim())) votos[c].valor++
      else if (v.length > 5) votos[c].texto++
    }
  }
  const numCols = Math.max(...Object.keys(votos).map(Number)) + 1
  let idxData = -1, idxValor = -1, idxDesc = -1
  let melhorData = -1, melhorValor = -1, melhorTexto = -1
  for (let c = 0; c < numCols; c++) {
    const v = votos[c] || { data: 0, valor: 0, texto: 0 }
    if (v.data > melhorData)   { melhorData   = v.data;   idxData  = c }
    if (v.valor > melhorValor) { melhorValor  = v.valor;  idxValor = c }
    if (v.texto > melhorTexto) { melhorTexto  = v.texto;  idxDesc  = c }
  }
  // Se data e valor caíram no mesmo índice, desempatar
  if (idxData === idxValor) idxValor = idxData + 2
  if (idxDesc === idxData || idxDesc === idxValor) {
    for (let c = 0; c < numCols; c++) {
      if (c !== idxData && c !== idxValor) { idxDesc = c; break }
    }
  }
  return { idxData, idxDesc, idxValor, idxCat: -1 }
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

/**
 * Dado um bMonth/bYear (mês da fatura) e o cartão, retorna a data de vencimento.
 * Usada ao gerar séries de parcelas a partir do mês de faturamento.
 */
function calcDueFromBilling(bMonth: number, bYear: number, cartao: any): string {
  let vm = bMonth, vy = bYear
  if (cartao.dia_vencimento <= cartao.dia_fechamento) {
    vm++; if (vm > 12) { vm = 1; vy++ }
  }
  const lastDay = new Date(vy, vm, 0).getDate()
  const vd = Math.min(cartao.dia_vencimento, lastDay)
  return `${vy}-${String(vm).padStart(2,'0')}-${String(vd).padStart(2,'0')}`
}

/** Soma/subtrai N meses de um bMonth/bYear, retornando o novo par */
function addBillingMonths(bMonth: number, bYear: number, n: number): { bm: number; by: number } {
  let bm = bMonth + n
  let by = bYear
  while (bm > 12) { bm -= 12; by++ }
  while (bm < 1)  { bm += 12; by-- }
  return { bm, by }
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
    if (linhas.length < 2) return c.json({ error: 'CSV precisa ter ao menos 1 linha de dados' }, 400)

    // Detectar delimitador correto ANTES de parsear qualquer linha
    const delimitador = detectarDelimitador(linhas)

    const cabecalho = parseCsvLine(linhas[0], delimitador).map(h => norm(h))

    let idxData  = cabecalho.findIndex(h => /^(data|date|dt|data_compra|data_lancamento)$/.test(h) || /data|date/.test(h))
    let idxDesc  = cabecalho.findIndex(h => /^(descricao|descr|desc|historico|nome|titulo|estabelecimento)$/.test(h) || /descr|historico|estabelec/.test(h))
    let idxValor = cabecalho.findIndex(h => /^(valor|value|amount|total|montante|debito|debit|credito)$/.test(h) || /valor|amount|total/.test(h))
    let idxCat   = cabecalho.findIndex(h => /^(categoria|categ|category|tipo|grupo)$/.test(h))
    const idxMeio  = cabecalho.findIndex(h => /^(meio|pagamento|forma|tipo_pagamento|payment)$/.test(h))

    // Se cabeçalho não reconhecido (CSV sem header), detectar colunas pelo conteúdo
    const semCabecalhoNomeado = idxValor === -1 && idxData === -1 && idxDesc === -1
    if (semCabecalhoNomeado) {
      // Usar todas as linhas como dados (nenhuma linha é cabeçalho)
      const inf = detectarColunasPorConteudo(linhas, delimitador)
      idxData  = inf.idxData
      idxDesc  = inf.idxDesc
      idxValor = inf.idxValor
      idxCat   = inf.idxCat
    }

    if (idxValor === -1) return c.json({ error: 'Coluna de valor não encontrada. Verifique se o CSV tem cabeçalho (ex: Data;Descricao;Valor;Categoria).' }, 400)

    // Buscar dados do usuário
    const [cartoesList, tagsList, despesasRec] = await Promise.all([
      c.env.DB.prepare(`SELECT id, nome, bandeira, limite_total, dia_fechamento, dia_vencimento FROM cartoes WHERE user_id=? AND ativo=1 ORDER BY nome`).bind(user.id).all<any>(),
      c.env.DB.prepare(`SELECT id, nome, cor FROM tags WHERE user_id=? ORDER BY nome`).bind(user.id).all<any>(),
      c.env.DB.prepare(`SELECT id, descricao, valor, data, categoria FROM despesas WHERE user_id=? AND data >= date('now','-90 days') ORDER BY data DESC LIMIT 500`).bind(user.id).all<any>(),
    ])

    // Calcular limite_disponivel dinamicamente (mesmo critério do GET /cartoes)
    const cartoesComLimite = await Promise.all((cartoesList.results || []).map(async (c2: any) => {
      const uso = await c.env.DB.prepare(
        `SELECT COALESCE(SUM(valor),0) as total FROM card_charges WHERE card_id=? AND status='pendente'`
      ).bind(c2.id).first() as any
      const utilizado  = Math.round(Number(uso?.total || 0) * 100) / 100
      const disponivel = Math.round(Math.max(0, c2.limite_total - utilizado) * 100) / 100
      return { ...c2, limite_disponivel: disponivel, limite_utilizado: utilizado }
    }))

    const todasDespesas = despesasRec.results || []
    const tagsDisp = tagsList.results || []
    // Cache de tags por nome normalizado (nome → objeto tag)
    const tagsMap = new Map<string, any>()
    for (const t of tagsDisp) tagsMap.set(norm(t.nome), t)

    const preview: any[] = []
    const erros: string[] = []
    // Início do loop de dados: se CSV sem cabeçalho nomeado, começar da linha 0
    const inicioLoop = semCabecalhoNomeado ? 0 : 1
    const totalLinhas = linhas.length - inicioLoop

    for (let i = inicioLoop; i < linhas.length; i++) {
      const cols = parseCsvLine(linhas[i], delimitador)
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
      // Gera histórico completo para qualquer parcela X/Y
      // A data do CSV representa o mês em que a parcela ATUAL foi lançada.
      // dataBase = primeiro dia do mês (atual - 1 meses antes do mês do CSV)
      if (parcela && parcela.total > 1) {
        const { atual, total } = parcela
        // bMesAtual = mês/ano do CSV (sem regra de fechamento no preview — cartão não está selecionado)
        const [csvY, csvM] = data.split('-').map(Number)
        const dataBase = addMonths(data, -(atual - 1))  // mantido só para exibição retroativa
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

      // ── Detecção de investimento sugerido ────────────────────────────────
      const investimentoSugerido = detectarInvestimento(desc, cat)

      // ── Detecção de recorrência sugerida ─────────────────────────────────
      const recorrenciaSugerida = detectarRecorrencia(desc, cat, tipo as 'despesa' | 'receita')

      // ── Status sugerido ───────────────────────────────────────────────────
      const statusSugerido = statusPorMeio(meio, data)

      // ── Detecção de duplicatas ────────────────────────────────────────────
      // Regra: só marca duplicata se a descrição E valor forem idênticos
      // (ou muito próximos) numa janela de até 3 dias (provável) ou 7 dias (possível).
      // NÃO usa comparação fuzzy por valor para evitar falsos positivos com parcelas.
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
        if (d2Norm === descNorm && d2Valor === valorArredondado && diasDif > 3 && diasDif <= 7) {
          duplicata = { nivel: 'possivel', motivo: `Mesma descrição + valor em data próxima (${d2Data})`, id: d2.id, data_existente: d2Data }
          break
        }
        // Regra fuzzy desativada para evitar falsos positivos em parcelas mensais
        // (parcelas do mesmo grupo têm valores idênticos mas são lançamentos distintos)
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
        investimento_sugerido: investimentoSugerido,
        recorrencia_sugerida: recorrenciaSugerida,
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
      cartoes: cartoesComLimite,
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

    // Detectar delimitador consistente com o preview
    const delimitadorExec = detectarDelimitador(linhasCsv)

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
      const cols = parseCsvLine(linhasCsv[i], delimitadorExec)
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

      // Status: override do usuário (cfg.status) ou regra automática.
      // Para importação de CSV (dados históricos), se a data já passou → 'pago',
      // independente do meio. Isso evita que compras retroativas consumam limite do cartão.
      const hoje0 = new Date().toISOString().slice(0, 10)
      const statusBase = data < hoje0
        ? 'pago'
        : (cfg.status || statusPorMeio(meio, data))

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
            // Gerar histórico completo para qualquer parcela X/Y
            // A data do CSV representa o mês em que a parcela ATUAL foi lançada.
            // Regra bancária: se dia do CSV >= dia_fechamento → fatura do mês seguinte.
            const { atual, total } = parcela
            const valorParcela = valor
            const groupId      = gerarUUID()
            let primeiroId: number | null = null

            // Determinar o mês de faturamento da parcela ATUAL (âncora)
            // IMPORTANTE: no CSV de extrato, a data já é a data do lançamento/débito.
            // Portanto usamos o mês do CSV diretamente como bMesAtual, sem calcBilling.
            // calcBilling é para COMPRAS NOVAS (data de compra → qual fatura vai cair).
            // Aqui a parcela JÁ está na fatura do mês da data do CSV.
            const bMesAtual = parseInt(data.split('-')[1])
            const bAnoAtual = parseInt(data.split('-')[0])

            for (let p = 1; p <= total; p++) {
              // bMonth(p) = bMesAtual + (p - atual)
              const { bm: bm_p, by: by_p } = addBillingMonths(bMesAtual, bAnoAtual, p - atual)

              let bMonth: number | null = bm_p
              let bYear:  number | null = by_p
              let dataVenc: string | null = null
              let dataParaGravar: string

              if (cartaoFinal) {
                // Com cartão: data de vencimento calculada a partir do mês de fatura
                dataVenc = calcDueFromBilling(bm_p, by_p, cartaoFinal)
                dataParaGravar = dataVenc
              } else {
                // Sem cartão: data da parcela = mesmo dia do CSV, avançando meses
                dataParaGravar = addMonths(data, p - atual)
              }

              // Parcelas retroativas (data já passou) SEMPRE são 'pago',
              // mesmo que o usuário tenha selecionado outro status no CSV.
              // Apenas parcelas futuras/hoje respeitam o cfg.status do usuário.
              const statusParc = statusParcela(dataParaGravar, meio) === 'pago'
                ? 'pago'
                : (cfg.status || 'pendente')

              // Remove o padrão X/Y original da descrição e adiciona (p/total)
              const descBase = desc
                .replace(/\s*\d{1,2}\s*\/\s*\d{1,2}\s*/g, ' ')
                .replace(/\s+/g, ' ')
                .trim()
              const descParcela = `${descBase} (${p}/${total})`

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
                  dataParaGravar, dataVenc, bMonth, bYear, p, total, groupId, statusParc
                ).run().catch(() => {})
              }
            }

            // Atualizar limite do cartão pelas parcelas pendentes
            if (cartaoFinal) {
              const hoje = new Date().toISOString().slice(0, 10)
              let pendentesCount = 0
              for (let p = 1; p <= total; p++) {
                const { bm: bm_p, by: by_p } = addBillingMonths(bMesAtual, bAnoAtual, p - atual)
                const dvp = calcDueFromBilling(bm_p, by_p, cartaoFinal)
                if (dvp >= hoje) pendentesCount++
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

              // Só decrementa limite para despesas pendentes (futuras/hoje).
              // Despesas passadas já foram cobradas e não consomem limite disponível.
              if (statusBase !== 'pago') {
                await c.env.DB.prepare(
                  `UPDATE cartoes SET limite_disponivel = MAX(0, limite_disponivel - ?) WHERE id=? AND user_id=?`
                ).bind(valor, cIdFinal, user.id).run().catch(() => {})
              }
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

// ═══════════════════════════════════════════════════════════════════════════════
// POST /api/importacao/ocr — Extrai dados de foto/PDF de extrato via OpenAI Vision
// ═══════════════════════════════════════════════════════════════════════════════
importacao.post('/ocr', requireAuth, async (c) => {
  try {
    const body = await c.req.json().catch(() => null)
    if (!body) return c.json({ error: 'Corpo da requisição inválido.' }, 400)

    const { imagem_base64, mime_type, tipo } = body

    if (!imagem_base64 || !mime_type) {
      return c.json({ error: 'Imagem base64 e mime_type são obrigatórios.' }, 400)
    }

    // Validar que é uma imagem (não PDF — o frontend deve converter PDF para imagem antes)
    const mimesPermitidos = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif']
    if (!mimesPermitidos.includes(mime_type.toLowerCase())) {
      return c.json({ error: `Formato não suportado: ${mime_type}. Envie uma imagem (JPEG, PNG, WEBP). PDFs devem ser convertidos para imagem antes do envio.` }, 400)
    }

    // Verificar tamanho aproximado (base64 ~4/3 do tamanho original)
    const tamanhoKB = Math.round(imagem_base64.length * 0.75 / 1024)
    if (tamanhoKB > 4096) {
      return c.json({ error: `Imagem muito grande (${tamanhoKB}KB). Reduza para menos de 4MB.` }, 400)
    }

    const apiKey  = c.env.OPENAI_API_KEY
    const baseUrl = (c.env.OPENAI_BASE_URL || 'https://www.genspark.ai/api/llm_proxy/v1').replace(/\/$/, '')

    if (!apiKey) {
      return c.json({ error: 'Chave de API não configurada. Contate o suporte.' }, 503)
    }

    const prompt = `Você é um assistente especializado em extrair lançamentos financeiros de extratos bancários brasileiros.

Analise esta imagem de extrato bancário (pode ser Itaú, Nubank, Bradesco, Santander, Banco do Brasil, Caixa, Mercado Pago, Inter, C6, XP ou qualquer outro banco brasileiro).

Extraia TODOS os lançamentos visíveis e retorne EXCLUSIVAMENTE um JSON válido no seguinte formato:
{
  "banco_detectado": "nome do banco se identificado",
  "periodo": "período do extrato se visível",
  "lancamentos": [
    {
      "data": "DD/MM/AAAA",
      "descricao": "descrição exata do lançamento",
      "valor": "valor numérico com vírgula decimal ex: 198,55",
      "tipo": "despesa ou receita (débito=despesa, crédito=receita)",
      "categoria_sugerida": "categoria mais adequada"
    }
  ]
}

Regras importantes:
- Valores de débito/saída: tipo = "despesa"  
- Valores de crédito/entrada: tipo = "receita"
- Mantenha os valores positivos, sem sinal negativo
- Se a data não aparecer em algum lançamento, use a data mais próxima visível
- Categorias sugeridas: Alimentação, Transporte, Moradia, Saúde, Educação, Lazer, Streaming, Telecomunicações, Seguros, Financiamentos, Transferência, Salário, Rendimentos, Investimentos, Outros
- Retorne APENAS o JSON, sem texto adicional`

    const aiResp = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-5',
        max_tokens: 4000,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image_url',
                image_url: {
                  url: `data:${mime_type};base64,${imagem_base64}`,
                  detail: 'high'
                }
              },
              { type: 'text', text: prompt }
            ]
          }
        ]
      })
    })

    if (!aiResp.ok) {
      const errText = await aiResp.text().catch(() => 'sem detalhe')
      return c.json({ error: `Erro na IA (${aiResp.status}): ${errText.slice(0, 200)}` }, 502)
    }

    const aiData = await aiResp.json() as any
    const content = aiData.choices?.[0]?.message?.content || ''

    if (!content) {
      return c.json({ error: 'A IA não retornou conteúdo. Tente novamente.' }, 422)
    }

    // Extrair JSON da resposta (às vezes vem com markdown ```json...```)
    const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/) || content.match(/(\{[\s\S]*\})/)
    const jsonStr = jsonMatch ? (jsonMatch[1] || jsonMatch[0]) : content

    let dados: any
    try {
      dados = JSON.parse(jsonStr)
    } catch {
      return c.json({ error: 'Não foi possível interpretar a resposta da IA. Tente uma imagem mais nítida.', raw: content.slice(0, 500) }, 422)
    }

    const lancamentos = dados.lancamentos || []
    if (lancamentos.length === 0) {
      return c.json({ error: 'Nenhum lançamento encontrado na imagem. Verifique se a foto está nítida e mostra um extrato bancário.', banco: dados.banco_detectado }, 422)
    }

    // Converter para CSV — filtrar pelo tipo solicitado
    const filtrado = tipo
      ? lancamentos.filter((l: any) => l.tipo === (tipo === 'despesas' ? 'despesa' : 'receita'))
      : lancamentos

    if (filtrado.length === 0) {
      const tipoLabel = tipo === 'despesas' ? 'despesas (débitos)' : 'receitas (créditos)'
      return c.json({ error: `Nenhuma ${tipoLabel} encontrada na imagem. Tente importar como "${tipo === 'despesas' ? 'receitas' : 'despesas'}" ou use ambos.` }, 422)
    }

    const linhasCSV = filtrado.map((l: any) => {
      const valor = tipo === 'despesas' || l.tipo === 'despesa' ? `-${l.valor}` : l.valor
      return `${l.data};${l.descricao};${valor};${l.categoria_sugerida || 'Outros'}`
    })

    return c.json({
      sucesso: true,
      banco_detectado: dados.banco_detectado || 'Não identificado',
      periodo: dados.periodo || '',
      total_lancamentos: lancamentos.length,
      total_filtrados: filtrado.length,
      csv: linhasCSV.join('\n'),
    })

  } catch (e: any) {
    return c.json({ error: 'Erro interno: ' + (e?.message || String(e)) }, 500)
  }
})

// ═══════════════════════════════════════════════════════════════════════════════
// Helpers para /ocr-texto — parser e categorizador sem IA
// ═══════════════════════════════════════════════════════════════════════════════
function categorizarDescricao(desc: string): string {
  const d = desc.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  if (/\b(salario|pagto salario|adiantamento|pagto adiantamento|pro.?labore|ferias|bonus|13)\b/.test(d)) return 'Salário'
  if (/\b(pix transf|ted|doc|transferencia)\b/.test(d)) return 'Transferência'
  if (/\b(rend pago|rendimento|aplic aut|resgate|invest|cdb|lci|lca|tesouro|fundo|acao|dividendo|jcp)\b/.test(d)) return 'Rendimentos'
  if (/\b(fatura|cartao|credito|mastercard|visa|elo|amex|credicard|nubank|platinum)\b/.test(d)) return 'Cartão de Crédito'
  if (/\b(boleto|pag boleto)\b/.test(d)) return 'Pagamento de Boleto'
  if (/\b(sabesp|cedae|copasa|saneamento|agua|esgoto)\b/.test(d)) return 'Moradia'
  if (/\b(light|cemig|cpfl|enel|coelba|energia|eletricidade)\b/.test(d)) return 'Moradia'
  if (/\b(aluguel|condominio|iptu|imovel|casa|apartamento)\b/.test(d)) return 'Moradia'
  if (/\b(tim|claro|vivo|oi|nextel|telefone|celular|internet|fibra|banda larga|telecom)\b/.test(d)) return 'Telecomunicações'
  if (/\b(uber|99|cabify|onibus|metro|trem|autopass|combustivel|gasolina|posto|estacionamento|pedagio|etanol)\b/.test(d)) return 'Transporte'
  if (/\b(ifood|rappi|uber eats|delivery|restaurante|lanchonete|pizzaria|hamburgueria|sushi|acai|padaria|cafe|bakery)\b/.test(d)) return 'Alimentação'
  if (/\b(supermercado|mercado|carrefour|extra|atacadao|assai|pao de acucar|hortifruti|feira|sacolao|hortifrutti)\b/.test(d)) return 'Alimentação'
  if (/\b(farmacia|drogaria|droga|remedios|medicamento|raia|ultrafarma|pacheco|drogasil|drogao)\b/.test(d)) return 'Saúde'
  if (/\b(medico|consulta|clinica|hospital|exame|laboratorio|plano de saude|unimed|bradesco saude|sulamerica)\b/.test(d)) return 'Saúde'
  if (/\b(escola|faculdade|universidade|curso|ensino|educacao|colegio|mensalidade|matricula|material escolar)\b/.test(d)) return 'Educação'
  if (/\b(netflix|spotify|amazon|disney|hbo|globoplay|youtube|prime|apple|streaming|assinatura)\b/.test(d)) return 'Streaming'
  if (/\b(cinema|teatro|show|ingresso|lazer|recreacao|parque|academia|museu|cultura)\b/.test(d)) return 'Lazer'
  if (/\b(seguro|protecao|porto seguro|bradesco seguros|sulamerica|mapfre|tokio|vgbl|pgdl|premio)\b/.test(d)) return 'Seguros'
  if (/\b(financiamento|prestacao|parcela|consorcio|credito pessoal|emprestimo|realize|cred)\b/.test(d)) return 'Financiamentos'
  if (/\b(iof|tarifa|taxa|servico|manutencao|anuidade|pacote|sispag|clipping)\b/.test(d)) return 'Tarifas Bancárias'
  return 'Outros'
}

function detectarBanco(texto: string): string {
  const t = texto.toLowerCase()
  if (t.includes('itau') || t.includes('itaú')) return 'Itaú'
  if (t.includes('nubank') || t.includes('nu pagamentos')) return 'Nubank'
  if (t.includes('bradesco')) return 'Bradesco'
  if (t.includes('santander')) return 'Santander'
  if (t.includes('banco do brasil') || t.includes('bb ')) return 'Banco do Brasil'
  if (t.includes('caixa economica') || t.includes('caixa federal')) return 'Caixa Econômica Federal'
  if (t.includes('inter ') || t.includes('banco inter')) return 'Banco Inter'
  if (t.includes('c6 bank') || t.includes('c6bank')) return 'C6 Bank'
  if (t.includes('mercado pago')) return 'Mercado Pago'
  if (t.includes('xp investimentos') || t.includes('xp inc')) return 'XP'
  if (t.includes('picpay')) return 'PicPay'
  if (t.includes('sicoob') || t.includes('sicredi')) return 'Cooperativa'
  return 'Não identificado'
}

function parsearExtratoBancario(texto: string, tipo: string): {
  banco: string, periodo: string,
  todos: any[], filtrados: any[], csv: string
} {
  const banco = detectarBanco(texto)

  // Detectar período
  const periodoMatch = texto.match(/per[íi]odo.*?(\d{2}\/\d{2}\/\d{4}).*?at[eé].*?(\d{2}\/\d{2}\/\d{4})/i)
  const periodo = periodoMatch ? `${periodoMatch[1]} a ${periodoMatch[2]}` : ''

  // Parser regex: DD/MM/AAAA DESCRIÇÃO -valor ou valor (saldo opcional no final)
  const pat = /^(\d{2}\/\d{2}\/\d{4})\s+(.+?)\s+([-]?\d{1,3}(?:\.\d{3})*,\d{2})(?:\s+[\d.,]+)?\s*$/

  const ignorar = ['SALDO DO DIA', 'saldo do dia']

  const linhas = texto.split('\n')
  const todos: any[] = []

  for (const linha of linhas) {
    const l = linha.trim()
    const m = l.match(pat)
    if (!m) continue
    const [, data, descRaw, valorRaw] = m
    const desc = descRaw.trim()
    if (ignorar.some(ig => desc.toUpperCase().includes(ig.toUpperCase()))) continue

    const negativo = valorRaw.startsWith('-')
    const valorAbs = valorRaw.replace('-', '').trim()
    const tipoLanc = negativo ? 'despesa' : 'receita'
    const categoria = categorizarDescricao(desc)

    todos.push({ data, descricao: desc, valor: valorAbs, tipo: tipoLanc, categoria_sugerida: categoria })
  }

  const filtrados = tipo
    ? todos.filter(l => l.tipo === (tipo === 'despesas' ? 'despesa' : 'receita'))
    : todos

  const csv = filtrados.map(l => {
    const v = l.tipo === 'despesa' ? `-${l.valor}` : l.valor
    return `${l.data};${l.descricao};${v};${l.categoria_sugerida}`
  }).join('\n')

  return { banco, periodo, todos, filtrados, csv }
}

// ═══════════════════════════════════════════════════════════════════════════════
// POST /api/importacao/ocr-texto — Extrai lançamentos de texto de extrato (PDF com texto)
// ═══════════════════════════════════════════════════════════════════════════════
importacao.post('/ocr-texto', requireAuth, async (c) => {
  try {
    const body = await c.req.json().catch(() => null)
    if (!body) return c.json({ error: 'Corpo da requisição inválido.' }, 400)

    const { texto_extrato, tipo } = body

    if (!texto_extrato || typeof texto_extrato !== 'string') {
      return c.json({ error: 'texto_extrato é obrigatório.' }, 400)
    }

    if (texto_extrato.length > 100000) {
      return c.json({ error: `Extrato muito longo (${texto_extrato.length} chars). Máximo: 100.000 caracteres.` }, 400)
    }

    const resultado = parsearExtratoBancario(texto_extrato, tipo || '')

    if (resultado.todos.length === 0) {
      return c.json({ error: 'Nenhum lançamento encontrado. Verifique se o PDF é um extrato bancário válido.' }, 422)
    }

    if (resultado.filtrados.length === 0) {
      const tipoLabel = tipo === 'despesas' ? 'despesas (débitos)' : 'receitas (créditos)'
      return c.json({
        error: `Nenhuma ${tipoLabel} encontrada no extrato. Tente importar como "${tipo === 'despesas' ? 'receitas' : 'despesas'}".`,
        total_lancamentos: resultado.todos.length,
        banco: resultado.banco
      }, 422)
    }

    return c.json({
      sucesso: true,
      banco_detectado: resultado.banco,
      periodo: resultado.periodo,
      total_lancamentos: resultado.todos.length,
      total_filtrados: resultado.filtrados.length,
      csv: resultado.csv,
    })

  } catch (e: any) {
    return c.json({ error: 'Erro interno: ' + (e?.message || String(e)) }, 500)
  }
})

// ═══════════════════════════════════════════════════════════════════════════════
// POST /api/importacao/criar-recorrencia — Cria recorrência a partir do preview
// ═══════════════════════════════════════════════════════════════════════════════
importacao.post('/criar-recorrencia', requireAuth, async (c) => {
  const user = c.get('user')
  try {
    const body = await c.req.json()
    const { descricao, valor, categoria, dia_vencimento, tipo, meio_pagamento, notas } = body

    if (!descricao || !valor || !tipo) {
      return c.json({ error: 'descricao, valor e tipo são obrigatórios.' }, 400)
    }

    // Verificar se já existe recorrência com mesmo nome para evitar duplicata
    const existente = await c.env.DB.prepare(
      `SELECT id FROM recorrencias WHERE user_id=? AND lower(descricao)=lower(?) AND ativa=1 LIMIT 1`
    ).bind(user.id, descricao).first<any>()

    if (existente) {
      return c.json({ error: 'Já existe uma recorrência ativa com esse nome.', id_existente: existente.id }, 409)
    }

    const dia = dia_vencimento || new Date().getDate()
    const result = await c.env.DB.prepare(`
      INSERT INTO recorrencias (user_id, tipo, descricao, valor, categoria, dia_vencimento, meio_pagamento, ativa, notas)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)
    `).bind(user.id, tipo, descricao, valor, categoria || 'Outros', dia, meio_pagamento || 'outros', notas || null).run()

    return c.json({ sucesso: true, id: result.meta.last_row_id, mensagem: `Recorrência "${descricao}" criada com sucesso.` })
  } catch (e: any) {
    return c.json({ error: 'Erro ao criar recorrência: ' + e.message }, 500)
  }
})

// ═══════════════════════════════════════════════════════════════════════════════
// POST /api/importacao/criar-investimento — Cria investimento a partir do preview
// ═══════════════════════════════════════════════════════════════════════════════
importacao.post('/criar-investimento', requireAuth, async (c) => {
  const user = c.get('user')
  try {
    const body = await c.req.json()
    const { nome, tipo, valor_investido, data_inicio, instituicao, observacoes } = body

    if (!nome || !tipo || !valor_investido) {
      return c.json({ error: 'nome, tipo e valor_investido são obrigatórios.' }, 400)
    }

    const tiposValidos = ['tesouro_direto','cdb','lci','lca','acoes','fii','cripto','poupanca','caixinha','outros']
    const tipoFinal = tiposValidos.includes(tipo) ? tipo : 'outros'

    const result = await c.env.DB.prepare(`
      INSERT INTO investimentos (user_id, nome, tipo, valor_investido, valor_atual, data_inicio, instituicao, observacoes, risco)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      user.id, nome, tipoFinal, valor_investido, valor_investido,
      data_inicio || new Date().toISOString().slice(0, 10),
      instituicao || null, observacoes || null,
      ['acoes','fii','cripto'].includes(tipoFinal) ? 'alto' : tipoFinal === 'caixinha' ? 'baixo' : 'medio'
    ).run()

    return c.json({ sucesso: true, id: result.meta.last_row_id, mensagem: `Investimento "${nome}" criado com sucesso.` })
  } catch (e: any) {
    return c.json({ error: 'Erro ao criar investimento: ' + e.message }, 500)
  }
})

export default importacao
