/**
 * categorizacao.ts — VerdeMais
 *
 * CategorizacaoService: categorização automática de despesas via OpenAI.
 * Endpoints:
 *   POST /api/categorizacao/sugerir          → categoriza 1 descrição
 *   POST /api/categorizacao/lote             → categoriza array de descrições (máx 50)
 *   POST /api/categorizacao/higienizar-outros → classifica TODAS as despesas "Outros" do mês
 *   POST /api/categorizacao/aplicar-lote      → aplica sugestões confirmadas pelo usuário
 *
 * Suporte a categorias livres (além das canônicas):
 *   - Se a IA ou regras locais identificam algo específico (ex: "Empréstimos", "Impostos"),
 *     o sistema aceita e cria a categoria automaticamente no banco.
 */

import { Hono } from 'hono'
import { requireAuth } from './auth'

type Bindings = { DB: D1Database; OPENAI_API_KEY?: string; OPENAI_BASE_URL?: string }
type Variables = { user: { id: number; nome: string; email: string; plano: string } }

const router = new Hono<{ Bindings: Bindings; Variables: Variables }>()

// ── Categorias canônicas do sistema ───────────────────────────────────────
export const CATEGORIAS_CANONICAS = [
  'Alimentação', 'Moradia', 'Transporte', 'Saúde', 'Educação',
  'Lazer', 'Vestuário', 'Assinaturas', 'Investimento', 'Beleza',
  'Pets', 'Tecnologia', 'Viagem', 'Outros',
  // aliases aceitos (compatibilidade)
  'Roupas', 'Academia', 'Serviços', 'Presentes', 'Assinaturas/Streaming',
]

// Categorias extras conhecidas (não canônicas, mas válidas)
export const CATEGORIAS_EXTRAS = [
  'Empréstimos', 'Financiamentos', 'Dívidas', 'Impostos', 'Taxas Bancárias',
  'Seguros', 'Doações', 'Multas', 'Cartão de Crédito', 'Condomínio',
]

// Todas as categorias conhecidas = canônicas + extras
export const CATEGORIAS_VALIDAS = [...CATEGORIAS_CANONICAS, ...CATEGORIAS_EXTRAS]

// Mapeamento de aliases da IA para valores canônicos/conhecidos
const ALIAS_MAP: Record<string, string> = {
  'Assinaturas/Streaming': 'Assinaturas',
  'Streaming':             'Assinaturas',
  'Vestuário':             'Roupas',
  'Emprestimo':            'Empréstimos',
  'Emprestimos':           'Empréstimos',
  'Empréstimo':            'Empréstimos',
  'Financiamento':         'Financiamentos',
  'Divida':                'Dívidas',
  'Dividas':               'Dívidas',
  'Imposto':               'Impostos',
  'Taxa Bancaria':         'Taxas Bancárias',
  'Taxas Bancarias':       'Taxas Bancárias',
  'Seguro':                'Seguros',
  'Doacao':                'Doações',
  'Multa':                 'Multas',
}

// ── Sanitização de categoria livre (para aceitar novas categorias da IA) ──
function sanitizarCategoria(raw: string): string {
  return (raw || '')
    .trim()
    .replace(/[<>{}[\]\\/]/g, '')   // sem HTML/injeção
    .replace(/\s+/g, ' ')           // colapsar espaços
    .substring(0, 40)               // máx 40 chars
}

function normalizarCategoria(raw: string): string {
  const trimmed = (raw || '').trim()
  if (!trimmed) return 'Outros'
  // 1. Alias direto
  if (ALIAS_MAP[trimmed]) return ALIAS_MAP[trimmed]
  // 2. Lista conhecida (case-insensitive)
  const found = CATEGORIAS_VALIDAS.find(c => c.toLowerCase() === trimmed.toLowerCase())
  if (found) return found
  // 3. Categoria livre: aceitar se parecer razoável (≥3 chars, sem números soltos)
  const sanitized = sanitizarCategoria(trimmed)
  if (sanitized.length >= 3 && !/^\d+$/.test(sanitized)) return sanitized
  return 'Outros'
}

function sanitizarDescricao(desc: string): string {
  return (desc || '')
    .trim()
    .replace(/[<>{}[\]\\]/g, '')
    .substring(0, 120)
}

// ── Regras locais (fallback sem IA) ──────────────────────────────────────
const REGRAS_LOCAIS: Array<{ patterns: RegExp[]; categoria: string }> = [
  // ── Dívidas e obrigações financeiras (ANTES das outras para não confundir) ──
  {
    patterns: [
      /\bemprestimo\b|\bempréstimo\b|financiamento|parcel(a|as) ?(d[eo]|emprestimo|financiamento|cartao|carro|imovel|casa)|pmto|pgto\s*(empr|fin)|cdc\s|consig|credito\s*pessoal|cred[it]+o\s+banco|itaú\s*empr|bradesco\s*empr|santander\s*empr|caixa\s*empr|nubank\s*empr|inter\s*empr|c6\s*empr|\bfgts\b|\bcgm\b|debenture|debênture/i,
    ],
    categoria: 'Empréstimos',
  },
  {
    patterns: [
      /\bfinanciam\w*\b|financiamento\s*(veiculo|carro|imovel|casa|apartamento)|leasing|consorcio|consorciado|cdc\s*(veiculo|auto)|alienacao\s*fiduciaria/i,
    ],
    categoria: 'Financiamentos',
  },
  {
    patterns: [
      /seguro\s*(vida|saude|auto|carro|residencial|viagem|prestamista|d\.p\.v\.a\.t|dpvat)|apólice|apolice/i,
    ],
    categoria: 'Seguros',
  },
  {
    patterns: [
      /\biptu\b|\bitr\b|\bicms\b|\biss\b|\birpf\b|\birpj\b|\biof\b|\bcsll\b|\bcofins\b|\bpis\b|\bimpostoderenda\b|imposto\s*(de\s*renda|municipal|estadual|federal|propriedade)|receita\s*federal|simples\s*nacional|guia\s*(darf|das|gps|gnre)/i,
    ],
    categoria: 'Impostos',
  },
  {
    patterns: [
      /multa\s*(transito|detran|transito|veiculo|atraso)|infração|infracao|estacionamento\s*multa|notificacao\s*multa/i,
    ],
    categoria: 'Multas',
  },
  {
    patterns: [
      /tarifa\s*(banco|bancaria|ted|doc|pix|extrato|manutencao|cadastro)|taxa\s*(bancaria|adm|administracao|cartao|anuidade|saque|transferencia)|anuidade\s*(cartao|banco)|iof\s*(cartao|emprestimo)|ted\s*banco|doc\s*banco|tarifas?\s*cobrança/i,
    ],
    categoria: 'Taxas Bancárias',
  },
  // ── Categorias canônicas ──────────────────────────────────────────────────
  { patterns: [/netflix|spotify|amazon prime|disney\+|hbo|globoplay|deezer|youtube premium|apple tv|paramount|star\+|telecine|mubi|crunchyroll|twitch|adobe|microsoft 365|office 365|google one|icloud|dropbox/i], categoria: 'Assinaturas' },
  { patterns: [/uber|99|cabify|taxi|ônibus|metro|trem|combustivel|gasolina|etanol|posto |shell|ipiranga|br ?(distribuidora)|petroleo brasileiro|pedágio|estacionamento|carro|oficina|mecanico/i], categoria: 'Transporte' },
  { patterns: [/ifood|rappi|uber eats|aiqfome|james|delivery|supermercado|mercado|extra |carrefour|pão de açúcar|atacadão|assaí|makro|aldi|lidl|hortifruti|padaria|restaurante|lancho|lanche|pizza|hamburguer|sushi|churrasco|mc donalds|mcdonald|burger king|kfc|subway|bobs|giraffas|outback|applebee/i], categoria: 'Alimentação' },
  { patterns: [/farmacia|drogaria|droga raia|drogasil|ultrafarma|pacheco|medic|hospital|clinica|dentista|ortodontista|plano de saude|unimed|hapvida|amil|bradesco saude|sulamerica saude|convenio|consulta|exame|laboratorio|raio x|cirurgia|psicólogo|psicologo|nutricionist/i], categoria: 'Saúde' },
  { patterns: [/aluguel|condominio|iptu|energia|luz |agua |gás |gas |conta de |internet|net |vivo |claro |tim |oi |sky |vivo fibra|renovacao|portaria|síndico|reforma|construção|pintura|eletricista|encanador|marido de aluguel/i], categoria: 'Moradia' },
  { patterns: [/escola|faculdade|universidade|curso |aula |livro |apostila |material escolar|uniforme|formatura|mensalidade|educação|ingles|inglês|idioma|udemy|coursera|alura|dio |rocketseat|udacity|skillshare/i], categoria: 'Educação' },
  { patterns: [/cinema|teatro|show |ingresso|parque |museu|lazer|jogo |steam|playstation|xbox|nintendo|ps4|ps5|diversão|festa |balada|clube |academia|smart fit|bodytech|crossfit|natação|futebol|golf|tênis/i], categoria: 'Lazer' },
  { patterns: [/renner|c&a|riachuelo|marisa|zara|forever 21|hering|levis|adidas|nike|puma|roupas|calçado|sapataria|roupa|vestuário|tenis |bermuda|camiseta|blusa|calça|vestido|saia|calcinha|cueca|meia |lingerie|moda/i], categoria: 'Vestuário' },
  { patterns: [/salão|salao|barbearia|cabelereiro|manicure|pedicure|depilação|depilacao|estetica|spa |massagem|bronzeamento|botox|maquiagem|botica|oboticario|natura |avon |sephora|mac cosmeticos|l'oreal|nivea|dove /i], categoria: 'Beleza' },
  { patterns: [/petlove|petz|cobasi|veterinário|veterinario|ração|racao|petshop|pet shop|aquário|aquario|cachorro|gato|passaro|hamster|coelho|reptil/i], categoria: 'Pets' },
  { patterns: [/apple|samsung|xiaomi|motorola|positivo|multilaser|notebook|celular|smartphone|tablet|tv |monitor|teclado|mouse|headset|fone |carregador|cabo usb|pendrive|hd |ssd |memória|impressora|scanner|amazon.com|aliexpress|gearbest|banggood|kabum|magazineluiza|americanas|ponto frio|casas bahia/i], categoria: 'Tecnologia' },
  { patterns: [/hotel|pousada|airbnb|booking|passagem|voo |aeroporto|cruzeiro|resort|agencia de viagem|cvc |decolar|submarino viagens|turismo|hostel/i], categoria: 'Viagem' },
  { patterns: [/investimento|aporte |previdencia|tesouro direto|cdb |lci |lca |rdb |fundo |ações|acoes|bolsa |b3 |corretora|nuinvest|xp |rico |clear |modal |genial|btg|itaú investimento|bradesco invest/i], categoria: 'Investimento' },
]

function categorizarLocal(descricao: string): string {
  const d = descricao.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  for (const regra of REGRAS_LOCAIS) {
    for (const pat of regra.patterns) {
      if (pat.test(d)) return regra.categoria
    }
  }
  return 'Outros'
}

// ── System prompt com suporte a categorias livres ────────────────────────
const SYSTEM_PROMPT = `Você é um classificador financeiro especializado em despesas pessoais brasileiras.

Sua função é receber descrições de despesas e retornar APENAS o nome da categoria mais adequada.

CATEGORIAS PREFERIDAS (use sempre que possível):
Alimentação, Moradia, Transporte, Saúde, Educação, Lazer, Vestuário, Assinaturas, Investimento, Beleza, Pets, Tecnologia, Viagem

CATEGORIAS ESPECÍFICAS (use quando o contexto indicar):
Empréstimos, Financiamentos, Seguros, Impostos, Taxas Bancárias, Multas, Doações

REGRAS OBRIGATÓRIAS:
- Parcelas de empréstimo/financiamento (ex: "Parcela Itaú 3/24", "Financiamento carro", "Empréstimo pessoal") → use "Empréstimos" ou "Financiamentos"
- Netflix/Spotify/Disney+ → Assinaturas; Uber/99 → Transporte; iFood/Rappi → Alimentação
- Drogasil/Droga Raia → Saúde; Petlove/Petz → Pets
- IPTU/IRPF/IOF → Impostos; Tarifa bancária/anuidade cartão → Taxas Bancárias
- Se nenhuma categoria se encaixar bem, você PODE criar um nome de categoria novo e específico (máx 25 caracteres, em português, capitalizado)
- Use "Outros" apenas se for completamente impossível identificar o tipo de despesa
- Responda APENAS com o nome da categoria, sem pontuação, sem explicação`

async function categorizarViaIA(
  descricoes: string[],
  env: Bindings
): Promise<string[]> {
  const apiKey = env.OPENAI_API_KEY
  if (!apiKey || descricoes.length === 0) {
    return descricoes.map(d => categorizarLocal(d))
  }

  const baseURL = (env.OPENAI_BASE_URL || 'https://www.genspark.ai/api/llm_proxy/v1').replace(/\/$/, '')

  // Para 1 descrição: chamada simples
  if (descricoes.length === 1) {
    try {
      const res = await fetch(`${baseURL}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: 'gpt-5.4-mini',
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: `Descrição da despesa: ${descricoes[0]}` }
          ],
          max_tokens: 25,
          temperature: 0,
        }),
      })
      if (!res.ok) return [categorizarLocal(descricoes[0])]
      const data: any = await res.json()
      const raw = data?.choices?.[0]?.message?.content?.trim() || ''
      const cat = normalizarCategoria(raw)
      return [cat !== 'Outros' ? cat : categorizarLocal(descricoes[0])]
    } catch {
      return [categorizarLocal(descricoes[0])]
    }
  }

  // Para lote: uma só chamada com JSON array
  const listaFormatada = descricoes.map((d, i) => `${i + 1}. ${d}`).join('\n')

  try {
    const res = await fetch(`${baseURL}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'gpt-5.4-mini',
        messages: [
          {
            role: 'system',
            content: SYSTEM_PROMPT + '\n\nPara múltiplas descrições, responda com um JSON array de strings, na mesma ordem. Ex: ["Alimentação","Empréstimos","Saúde"]',
          },
          { role: 'user', content: `Classifique cada descrição abaixo:\n${listaFormatada}` },
        ],
        max_tokens: descricoes.length * 20 + 50,
        temperature: 0,
      }),
    })

    if (!res.ok) throw new Error('API error')
    const data: any = await res.json()
    const raw = data?.choices?.[0]?.message?.content?.trim() || ''

    const match = raw.match(/\[[\s\S]*\]/)
    if (!match) throw new Error('no JSON array')
    const parsed: string[] = JSON.parse(match[0])

    if (!Array.isArray(parsed) || parsed.length !== descricoes.length) {
      throw new Error('array length mismatch')
    }

    return parsed.map((cat, i) => {
      const norm = normalizarCategoria(cat)
      // Se a IA devolveu "Outros", tentar regra local antes de aceitar
      return norm !== 'Outros' ? norm : categorizarLocal(descricoes[i])
    })
  } catch {
    return descricoes.map(d => categorizarLocal(d))
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────

/** Retorna true se a categoria não está na lista canônica (é uma categoria nova) */
function ehCategoriaLivre(cat: string): boolean {
  return !CATEGORIAS_CANONICAS.includes(cat) && cat !== 'Outros'
}

// ── POST /api/categorizacao/sugerir ──────────────────────────────────────
// Body: { descricao: string }
// Retorna: { categoria: string, fonte: 'ia'|'local', categoria_nova: boolean }
router.post('/sugerir', requireAuth, async (c) => {
  const body = await c.req.json().catch(() => ({})) as any
  const descricao = sanitizarDescricao(body?.descricao || '')

  if (!descricao) return c.json({ error: 'Descrição obrigatória' }, 400)

  // 1. Regra local primeiro (rápido, sem custo de API)
  const local = categorizarLocal(descricao)
  if (local !== 'Outros') {
    return c.json({ categoria: local, fonte: 'local', categoria_nova: ehCategoriaLivre(local) })
  }

  // 2. Tentar IA
  const [iaCategoria] = await categorizarViaIA([descricao], c.env)
  const fonte = c.env.OPENAI_API_KEY ? 'ia' : 'local'
  return c.json({ categoria: iaCategoria, fonte, categoria_nova: ehCategoriaLivre(iaCategoria) })
})

// ── POST /api/categorizacao/lote ─────────────────────────────────────────
// Body: { descricoes: string[] }  (máx 50)
// Retorna: { resultados: Array<{ descricao, categoria, fonte, categoria_nova }> }
router.post('/lote', requireAuth, async (c) => {
  const body = await c.req.json().catch(() => ({})) as any
  const raw: string[] = Array.isArray(body?.descricoes) ? body.descricoes : []

  if (raw.length === 0) return c.json({ error: 'Array descricoes obrigatório' }, 400)
  if (raw.length > 50) return c.json({ error: 'Máximo 50 descrições por chamada' }, 400)

  const descricoes = raw.map(sanitizarDescricao)
  const resultados: Array<{ descricao: string; categoria: string; fonte: string; categoria_nova: boolean }> = []
  const precisamIA: Array<{ idx: number; desc: string }> = []

  for (let i = 0; i < descricoes.length; i++) {
    const local = categorizarLocal(descricoes[i])
    if (local !== 'Outros') {
      resultados[i] = { descricao: raw[i], categoria: local, fonte: 'local', categoria_nova: ehCategoriaLivre(local) }
    } else {
      precisamIA.push({ idx: i, desc: descricoes[i] })
      resultados[i] = { descricao: raw[i], categoria: 'Outros', fonte: 'local', categoria_nova: false }
    }
  }

  if (precisamIA.length > 0) {
    const iaDescs = precisamIA.map(x => x.desc)
    const iaCats = await categorizarViaIA(iaDescs, c.env)
    const fonte = c.env.OPENAI_API_KEY ? 'ia' : 'local'
    precisamIA.forEach((item, i) => {
      resultados[item.idx] = {
        descricao: raw[item.idx],
        categoria: iaCats[i],
        fonte,
        categoria_nova: ehCategoriaLivre(iaCats[i]),
      }
    })
  }

  return c.json({ resultados })
})

// ── POST /api/categorizacao/higienizar-outros ────────────────────────────
// Body: { mes?: number, ano?: number }
router.post('/higienizar-outros', requireAuth, async (c) => {
  const user = c.get('user')
  const body = await c.req.json().catch(() => ({})) as any
  const now = new Date()
  const mes = body?.mes || (now.getMonth() + 1)
  const ano = body?.ano || now.getFullYear()
  const mesStr = String(mes).padStart(2, '0')
  const anoStr = String(ano)

  const result = await c.env.DB.prepare(`
    SELECT id, descricao, valor, data, categoria, status
    FROM despesas
    WHERE user_id = ?
      AND (
        (status = 'pago' AND strftime('%m', data) = ? AND strftime('%Y', data) = ?)
        OR
        (status != 'pago' AND (
          (vencimento IS NOT NULL AND strftime('%m', vencimento) = ? AND strftime('%Y', vencimento) = ?)
          OR
          (vencimento IS NULL AND strftime('%m', data) = ? AND strftime('%Y', data) = ?)
        ))
      )
      AND (categoria = 'Outros' OR categoria IS NULL OR categoria = '')
      AND eh_aporte_patrimonial != 1
      AND status != 'cancelado'
    ORDER BY data DESC
    LIMIT 100
  `).bind(user.id, mesStr, anoStr, mesStr, anoStr, mesStr, anoStr).all()

  const despesas = result.results as any[]

  if (despesas.length === 0) {
    return c.json({ despesas: [], total: 0, mensagem: 'Nenhuma despesa em "Outros" neste mês.' })
  }

  const sugestoes: Array<{
    id: number; descricao: string; valor: number; data: string
    categoria_atual: string; categoria_sugerida: string; fonte: string; categoria_nova: boolean
  }> = []

  for (let i = 0; i < despesas.length; i += 50) {
    const bloco = despesas.slice(i, i + 50)
    const descricoes = bloco.map((d: any) => sanitizarDescricao(d.descricao))
    const categorias = await categorizarViaIA(descricoes, c.env)
    const fonte = c.env.OPENAI_API_KEY ? 'ia' : 'local'

    bloco.forEach((d: any, j: number) => {
      const cat = categorias[j]
      sugestoes.push({
        id: d.id,
        descricao: d.descricao,
        valor: d.valor,
        data: d.data,
        categoria_atual: d.categoria || 'Outros',
        categoria_sugerida: cat,
        fonte: cat !== 'Outros' ? (ehCategoriaLivre(cat) ? `${fonte}_nova` : fonte) : 'sem_sugestao',
        categoria_nova: ehCategoriaLivre(cat),
      })
    })
  }

  const comSugestao = sugestoes.filter(s => s.categoria_sugerida !== 'Outros').length
  const categoriasNovas = [...new Set(sugestoes.filter(s => s.categoria_nova).map(s => s.categoria_sugerida))]

  return c.json({
    despesas: sugestoes,
    total: sugestoes.length,
    com_sugestao: comSugestao,
    sem_sugestao: sugestoes.length - comSugestao,
    categorias_novas: categoriasNovas,
    mes,
    ano,
  })
})

// ── POST /api/categorizacao/aplicar-lote ─────────────────────────────────
// Body: { alteracoes: Array<{ id: number, categoria: string }> }
// Aceita categorias canônicas E categorias livres (criadas pela IA)
router.post('/aplicar-lote', requireAuth, async (c) => {
  const user = c.get('user')
  const body = await c.req.json().catch(() => ({})) as any
  const alteracoes: Array<{ id: number; categoria: string }> = body?.alteracoes || []

  if (!Array.isArray(alteracoes) || alteracoes.length === 0) {
    return c.json({ error: 'Array alteracoes obrigatório' }, 400)
  }
  if (alteracoes.length > 100) {
    return c.json({ error: 'Máximo 100 alterações por chamada' }, 400)
  }

  let aplicadas = 0
  const erros: string[] = []
  const categoriasNovasCriadas: string[] = []

  for (const alt of alteracoes) {
    if (!alt.id || !alt.categoria) continue

    // Normalizar: aceita canônicas E livres
    const cat = normalizarCategoria(alt.categoria)

    // Rejeitar só se vier vazio ou for claramente inválido após sanitização
    if (!cat || cat.length < 2) {
      erros.push(`ID ${alt.id}: categoria inválida`)
      continue
    }

    // Registrar se é categoria nova
    if (ehCategoriaLivre(cat) && !categoriasNovasCriadas.includes(cat)) {
      categoriasNovasCriadas.push(cat)
    }

    try {
      const res = await c.env.DB.prepare(`
        UPDATE despesas SET categoria = ? WHERE id = ? AND user_id = ?
      `).bind(cat, alt.id, user.id).run()
      if ((res.meta?.changes || 0) > 0) aplicadas++
    } catch {
      erros.push(`ID ${alt.id}: erro ao atualizar`)
    }
  }

  return c.json({
    aplicadas,
    ignoradas: alteracoes.length - aplicadas - erros.length,
    erros,
    categorias_novas_criadas: categoriasNovasCriadas,
    mensagem: `${aplicadas} despesa(s) recategorizada(s) com sucesso.`,
  })
})

export default router
