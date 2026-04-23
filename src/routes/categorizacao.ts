/**
 * categorizacao.ts — VerdeMais
 *
 * CategorizacaoService: categorização automática de despesas via OpenAI.
 * Endpoints:
 *   POST /api/categorizacao/sugerir          → categoriza 1 descrição
 *   POST /api/categorizacao/lote             → categoriza array de descrições (máx 50)
 *   POST /api/categorizacao/higienizar-outros → classifica TODAS as despesas "Outros" do mês
 *   POST /api/categorizacao/aplicar-lote      → aplica sugestões confirmadas pelo usuário
 */

import { Hono } from 'hono'
import { requireAuth } from './auth'

type Bindings = { DB: D1Database; OPENAI_API_KEY?: string; OPENAI_BASE_URL?: string }
type Variables = { user: { id: number; nome: string; email: string; plano: string } }

const router = new Hono<{ Bindings: Bindings; Variables: Variables }>()

// ── Categorias permitidas (lista canônica) ─────────────────────────────────
export const CATEGORIAS_VALIDAS = [
  'Alimentação', 'Moradia', 'Transporte', 'Saúde', 'Educação',
  'Lazer', 'Vestuário', 'Assinaturas', 'Investimento', 'Beleza',
  'Pets', 'Tecnologia', 'Viagem', 'Outros',
  // aliases aceitos no sistema (não quebrar compatibilidade)
  'Roupas', 'Academia', 'Serviços', 'Presentes', 'Assinaturas/Streaming',
]

// Mapeamento de aliases da IA para valores canônicos do sistema
const ALIAS_MAP: Record<string, string> = {
  'Assinaturas/Streaming': 'Assinaturas',
  'Streaming':             'Assinaturas',
  'Vestuário':             'Roupas',
}

function normalizarCategoria(raw: string): string {
  const trimmed = (raw || '').trim()
  // Retornar alias mapeado se existir
  if (ALIAS_MAP[trimmed]) return ALIAS_MAP[trimmed]
  // Verificar se é categoria válida (case-insensitive)
  const found = CATEGORIAS_VALIDAS.find(c => c.toLowerCase() === trimmed.toLowerCase())
  return found || 'Outros'
}

function sanitizarDescricao(desc: string): string {
  return (desc || '')
    .trim()
    .replace(/[<>{}[\]\\]/g, '')
    .substring(0, 120)
}

// ── Lógica local (fallback sem API) ──────────────────────────────────────────
const REGRAS_LOCAIS: Array<{ patterns: RegExp[]; categoria: string }> = [
  { patterns: [/netflix|spotify|amazon prime|disney\+|hbo|globoplay|deezer|youtube premium|apple tv|paramount|star\+|telecine|mubi|crunchyroll|twitch|adobe|microsoft 365|office 365|google one|icloud|dropbox/i], categoria: 'Assinaturas' },
  { patterns: [/uber|99|cabify|taxi|ônibus|metro|trem|combustivel|gasolina|etanol|posto |shell|ipiranga|br ?(distribuidora)|petroleo brasileiro|pedágio|estacionamento|carro|oficina|mecanico/i], categoria: 'Transporte' },
  { patterns: [/ifood|rappi|uber eats|aiqfome|james|delivery|supermercado|mercado|extra |carrefour|pão de açúcar|atacadão|assaí|makro|aldi|lidl|hortifruti|padaria|restaurante|lancho|lanche|pizza|hamburguer|sushi|churrasco|mc donalds|mcdonald|burger king|kfc|subway|bobs|giraffas|outback|applebee/i], categoria: 'Alimentação' },
  { patterns: [/farmacia|drogaria|droga raia|drogasil|ultrafarma|pacheco|medic|hospital|clinica|dentista|ortodontista|plano de saude|unimed|hapvida|amil|bradesco saude|sulamerica saude|convenio|consulta|exame|laboratorio|raio x|cirurgia|psicólogo|psicologo|nutricionist/i], categoria: 'Saúde' },
  { patterns: [/aluguel|condominio|iptu|energia|luz |agua |gás |gas |conta de |internet|net |vivo |claro |tim |oi |sky |vivo fibra|renovacao|portaria|síndico|reforma|construção|pintura|eletricista|encanador|marido de aluguel/i], categoria: 'Moradia' },
  { patterns: [/escola|faculdade|universidade|curso |aula |livro |apostila |material escolar|uniforme|formatura|mensalidade|educação|ingles|inglês|idioma|udemy|coursera|alura|dio |rocketseat|udacity|skillshare/i], categoria: 'Educação' },
  { patterns: [/cinema|teatro|show |ingresso|parque |museu|netflix|lazer|jogo |steam|playstation|xbox|nintendo|ps4|ps5|diversão|festa |balada|clube |academia|smart fit|bodytech|crossfit|natação|futebol|golf|tênis/i], categoria: 'Lazer' },
  { patterns: [/renner|c&a|riachuelo|marisa|zara|forever 21|hering|levis|adidas|nike|puma|roupas|calçado|sapataria|roupa|vestuário|tenis |bermuda|camiseta|blusa|calça|vestido|saia|calcinha|cueca|meia |lingerie|moda/i], categoria: 'Vestuário' },
  { patterns: [/salão|salao|barbearia|cabelereiro|manicure|pedicure|depilação|depilacao|estetica|spa |massagem|bronzeamento|botox|maquiagem|botica|oboticario|natura |avon |sephora|mac cosmeticos|l'oreal|nivea|dove /i], categoria: 'Beleza' },
  { patterns: [/petlove|petz|cobasi|veterinário|veterinario|ração|racao|petshop|pet shop|aquário|aquario|cachorro|gato|passaro|passaro|hamster|coelho|reptil/i], categoria: 'Pets' },
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

// ── Chamada à OpenAI ──────────────────────────────────────────────────────
const SYSTEM_PROMPT = `Você é um classificador financeiro especializado em despesas pessoais brasileiras.

Sua função é receber descrições de despesas e retornar APENAS o nome da categoria, exatamente como está na lista abaixo:

Alimentação, Moradia, Transporte, Saúde, Educação, Lazer, Vestuário, Assinaturas, Investimento, Beleza, Pets, Tecnologia, Viagem, Outros

REGRAS OBRIGATÓRIAS:
- Use "Outros" SOMENTE se for impossível classificar
- Considere estabelecimentos brasileiros: Netflix/Spotify → Assinaturas; Uber/99 → Transporte; iFood/Rappi → Alimentação; Drogasil/Droga Raia → Saúde; Petlove/Petz → Pets
- NÃO invente categorias fora da lista
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
          max_tokens: 20,
          temperature: 0,
        }),
      })
      if (!res.ok) return [categorizarLocal(descricoes[0])]
      const data: any = await res.json()
      const raw = data?.choices?.[0]?.message?.content?.trim() || ''
      return [normalizarCategoria(raw) || categorizarLocal(descricoes[0])]
    } catch {
      return [categorizarLocal(descricoes[0])]
    }
  }

  // Para lote: enviar em JSON estruturado para uma só chamada
  const listaFormatada = descricoes
    .map((d, i) => `${i + 1}. ${d}`)
    .join('\n')

  try {
    const res = await fetch(`${baseURL}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'gpt-5.4-mini',
        messages: [
          { role: 'system', content: SYSTEM_PROMPT + '\n\nPara múltiplas descrições, responda com um JSON array de strings, na mesma ordem. Ex: ["Alimentação","Transporte","Saúde"]' },
          { role: 'user', content: `Classifique cada descrição abaixo:\n${listaFormatada}` }
        ],
        max_tokens: descricoes.length * 15 + 50,
        temperature: 0,
      }),
    })

    if (!res.ok) throw new Error('API error')
    const data: any = await res.json()
    const raw = data?.choices?.[0]?.message?.content?.trim() || ''

    // Extrair JSON array da resposta
    const match = raw.match(/\[[\s\S]*\]/)
    if (!match) throw new Error('no JSON array')
    const parsed: string[] = JSON.parse(match[0])

    if (!Array.isArray(parsed) || parsed.length !== descricoes.length) {
      throw new Error('array length mismatch')
    }

    return parsed.map((cat, i) => normalizarCategoria(cat) || categorizarLocal(descricoes[i]))
  } catch {
    // Fallback local para todo o lote
    return descricoes.map(d => categorizarLocal(d))
  }
}

// ── POST /api/categorizacao/sugerir ──────────────────────────────────────
// Body: { descricao: string }
// Retorna: { categoria: string, fonte: 'ia' | 'local' }
router.post('/sugerir', requireAuth, async (c) => {
  const body = await c.req.json().catch(() => ({})) as any
  const descricao = sanitizarDescricao(body?.descricao || '')

  if (!descricao) {
    return c.json({ error: 'Descrição obrigatória' }, 400)
  }

  // Tenta local primeiro (rápido, sem custo de API)
  const local = categorizarLocal(descricao)

  // Se local já achou categoria definida, retorna imediatamente
  if (local !== 'Outros') {
    return c.json({ categoria: local, fonte: 'local' })
  }

  // Caso contrário, tenta IA
  const [iaCategoria] = await categorizarViaIA([descricao], c.env)
  const fonte = c.env.OPENAI_API_KEY ? 'ia' : 'local'
  return c.json({ categoria: iaCategoria, fonte })
})

// ── POST /api/categorizacao/lote ─────────────────────────────────────────
// Body: { descricoes: string[] }   (máx 50)
// Retorna: { resultados: Array<{ descricao, categoria, fonte }> }
router.post('/lote', requireAuth, async (c) => {
  const body = await c.req.json().catch(() => ({})) as any
  const raw: string[] = Array.isArray(body?.descricoes) ? body.descricoes : []

  if (raw.length === 0) return c.json({ error: 'Array descricoes obrigatório' }, 400)
  if (raw.length > 50) return c.json({ error: 'Máximo 50 descrições por chamada' }, 400)

  const descricoes = raw.map(sanitizarDescricao)

  // Separar as que já têm resposta local
  const resultados: Array<{ descricao: string; categoria: string; fonte: string }> = []
  const precisamIA: Array<{ idx: number; desc: string }> = []

  for (let i = 0; i < descricoes.length; i++) {
    const local = categorizarLocal(descricoes[i])
    if (local !== 'Outros') {
      resultados[i] = { descricao: raw[i], categoria: local, fonte: 'local' }
    } else {
      precisamIA.push({ idx: i, desc: descricoes[i] })
      resultados[i] = { descricao: raw[i], categoria: 'Outros', fonte: 'local' } // placeholder
    }
  }

  // Chamar IA apenas para as que ficaram como "Outros"
  if (precisamIA.length > 0) {
    const iaDescs = precisamIA.map(x => x.desc)
    const iaCats = await categorizarViaIA(iaDescs, c.env)
    const fonte = c.env.OPENAI_API_KEY ? 'ia' : 'local'
    precisamIA.forEach((item, i) => {
      resultados[item.idx] = { descricao: raw[item.idx], categoria: iaCats[i], fonte }
    })
  }

  return c.json({ resultados })
})

// ── POST /api/categorizacao/higienizar-outros ────────────────────────────
// Body: { mes?: number, ano?: number }
// Retorna lista de despesas "Outros" com sugestão de categoria
router.post('/higienizar-outros', requireAuth, async (c) => {
  const user = c.get('user')
  const body = await c.req.json().catch(() => ({})) as any
  const now = new Date()
  const mes = body?.mes || (now.getMonth() + 1)
  const ano = body?.ano || now.getFullYear()
  const mesStr = String(mes).padStart(2, '0')
  const anoStr = String(ano)

  // Buscar despesas com categoria "Outros" no mês
  const result = await c.env.DB.prepare(`
    SELECT id, descricao, valor, data, categoria, status
    FROM despesas
    WHERE user_id = ?
      AND (
        -- pagas: usar data
        (status = 'pago' AND strftime('%m', data) = ? AND strftime('%Y', data) = ?)
        OR
        -- pendentes: usar vencimento ou data
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

  // Processar em blocos de 50
  const sugestoes: Array<{ id: number; descricao: string; valor: number; data: string; categoria_atual: string; categoria_sugerida: string; fonte: string }> = []

  for (let i = 0; i < despesas.length; i += 50) {
    const bloco = despesas.slice(i, i + 50)
    const descricoes = bloco.map((d: any) => sanitizarDescricao(d.descricao))
    const categorias = await categorizarViaIA(descricoes, c.env)
    const fonte = c.env.OPENAI_API_KEY ? 'ia' : 'local'

    bloco.forEach((d: any, j: number) => {
      sugestoes.push({
        id: d.id,
        descricao: d.descricao,
        valor: d.valor,
        data: d.data,
        categoria_atual: d.categoria || 'Outros',
        categoria_sugerida: categorias[j],
        fonte: categorias[j] !== 'Outros' ? fonte : 'sem_sugestao',
      })
    })
  }

  const comSugestao = sugestoes.filter(s => s.categoria_sugerida !== 'Outros').length
  return c.json({
    despesas: sugestoes,
    total: sugestoes.length,
    com_sugestao: comSugestao,
    sem_sugestao: sugestoes.length - comSugestao,
    mes,
    ano,
  })
})

// ── POST /api/categorizacao/aplicar-lote ─────────────────────────────────
// Body: { alteracoes: Array<{ id: number, categoria: string }> }
// Aplica as categorias confirmadas pelo usuário
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

  for (const alt of alteracoes) {
    if (!alt.id || !alt.categoria) continue
    const cat = normalizarCategoria(alt.categoria)
    if (!CATEGORIAS_VALIDAS.includes(cat)) {
      erros.push(`ID ${alt.id}: categoria "${alt.categoria}" inválida`)
      continue
    }
    try {
      const res = await c.env.DB.prepare(`
        UPDATE despesas SET categoria = ? WHERE id = ? AND user_id = ?
      `).bind(cat, alt.id, user.id).run()
      if ((res.meta?.changes || 0) > 0) aplicadas++
    } catch (e) {
      erros.push(`ID ${alt.id}: erro ao atualizar`)
    }
  }

  return c.json({
    aplicadas,
    ignoradas: alteracoes.length - aplicadas - erros.length,
    erros,
    mensagem: `${aplicadas} despesa(s) recategorizada(s) com sucesso.`,
  })
})

export default router
