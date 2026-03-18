// src/routes/importacao.ts
// Importação de dados via CSV — despesas e receitas
import { Hono } from 'hono'
import { requireAuth } from './auth'

type Bindings = { DB: D1Database }
type Variables = { user: { id: number; nome: string; email: string; plano: string } }

const importacao = new Hono<{ Bindings: Bindings; Variables: Variables }>()

// ── Normalizar texto ──────────────────────────────────────────────────────────
function norm(s: string): string {
  return (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim()
}

// ── Detectar categoria a partir da descrição ──────────────────────────────────
function detectarCategoria(desc: string): string {
  const d = norm(desc)
  if (/uber|99|taxi|combustivel|gasolina|onibus|metro|transporte|estacion|pedagio|carro/.test(d)) return 'Transporte'
  if (/ifood|rappi|delivery|restaurante|lanche|almoco|jantar|pizza|hamburger|sushi|comida|alimenta/.test(d)) return 'Alimentação'
  if (/aluguel|condominio|iptu|luz|energia|agua|gas|internet|telefone|moradia|casa/.test(d)) return 'Moradia'
  if (/netflix|spotify|amazon|prime|youtube|hbo|disney|apple|streaming|assinatura/.test(d)) return 'Streaming'
  if (/farmacia|medico|consulta|plano.saude|academia|saude|hospital|exame/.test(d)) return 'Saúde'
  if (/faculdade|curso|livro|escola|educacao|material|estudo/.test(d)) return 'Educação'
  if (/roupa|sapato|vestuario|shopping|fashion|moda/.test(d)) return 'Vestuário'
  if (/cinema|show|bar|festa|lazer|viagem|hotel|diversao/.test(d)) return 'Lazer'
  if (/salario|pagamento|freelance|renda|transferencia|pix|credito/.test(d)) return 'Outros'
  return 'Outros'
}

// ── Normalizar valor monetário BR/EN ──────────────────────────────────────────
function parseValor(raw: string): number | null {
  if (!raw) return null
  // Remove R$, espaços, aspas
  let s = raw.replace(/[R$\s"']/g, '').trim()
  // Detectar formato BR: 1.234,56 → 1234.56
  if (/^\d{1,3}(\.\d{3})*(,\d+)?$/.test(s)) {
    s = s.replace(/\./g, '').replace(',', '.')
  } else {
    // Formato EN: 1,234.56 → 1234.56
    s = s.replace(/,/g, '')
  }
  const v = parseFloat(s)
  return isNaN(v) || v <= 0 ? null : v
}

// ── Normalizar data ───────────────────────────────────────────────────────────
function parseData(raw: string): string | null {
  if (!raw) return null
  const s = raw.trim().replace(/"/g, '')
  // dd/mm/yyyy ou dd-mm-yyyy
  const m1 = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/)
  if (m1) return `${m1[3]}-${m1[2].padStart(2,'0')}-${m1[1].padStart(2,'0')}`
  // yyyy-mm-dd (ISO)
  const m2 = s.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/)
  if (m2) return `${m2[1]}-${m2[2].padStart(2,'0')}-${m2[3].padStart(2,'0')}`
  // mm/dd/yyyy (US)
  const m3 = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (m3 && parseInt(m3[1]) <= 12 && parseInt(m3[2]) > 12)
    return `${m3[3]}-${m3[1].padStart(2,'0')}-${m3[2].padStart(2,'0')}`
  return null
}

// ── Parser de CSV robusto ─────────────────────────────────────────────────────
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

// ── POST /api/importacao/preview — preview do CSV antes de importar ──────────
importacao.post('/preview', requireAuth, async (c) => {
  try {
    const body = await c.req.json()
    const { csv, tipo } = body  // tipo: 'despesas' | 'receitas' | 'auto'

    if (!csv || typeof csv !== 'string') {
      return c.json({ error: 'CSV inválido' }, 400)
    }

    const linhas = csv.split('\n').filter(l => l.trim())
    if (linhas.length < 2) return c.json({ error: 'CSV precisa ter cabeçalho + ao menos 1 linha' }, 400)

    const cabecalho = parseCsvLine(linhas[0]).map(h => norm(h))

    // Detectar colunas automaticamente
    const idxData  = cabecalho.findIndex(h => /data|date|dt/.test(h))
    const idxDesc  = cabecalho.findIndex(h => /descr|desc|titulo|name|nome|historico/.test(h))
    const idxValor = cabecalho.findIndex(h => /valor|value|amount|total|montante/.test(h))
    const idxCat   = cabecalho.findIndex(h => /categ|tipo|type|grupo/.test(h))
    const idxTipo  = cabecalho.findIndex(h => /tipo|type|lancamento|natureza/.test(h)) // para distinguir débito/crédito

    if (idxValor === -1) return c.json({ error: 'Coluna de valor não encontrada. Certifique-se de ter uma coluna "valor", "amount" ou "total".' }, 400)

    const preview: any[] = []
    const erros: string[] = []
    let processadas = 0

    for (let i = 1; i < Math.min(linhas.length, 6); i++) {
      const cols = parseCsvLine(linhas[i])
      const valor = idxValor >= 0 ? parseValor(cols[idxValor]) : null
      const data  = idxData  >= 0 ? parseData(cols[idxData])  : new Date().toISOString().slice(0,10)
      const desc  = idxDesc  >= 0 ? cols[idxDesc]?.slice(0,100) : `Importado linha ${i}`
      const catBruta = idxCat >= 0 ? cols[idxCat] : ''
      const cat   = catBruta || detectarCategoria(desc || '')

      if (!valor) { erros.push(`Linha ${i+1}: valor inválido`); continue }
      if (!data)  { erros.push(`Linha ${i+1}: data inválida`); continue }

      preview.push({ data, descricao: desc, valor, categoria: cat, linha: i+1 })
      processadas++
    }

    const totalLinhas = linhas.length - 1
    return c.json({
      preview,
      total_linhas: totalLinhas,
      colunas_detectadas: {
        data:      idxData  >= 0 ? cabecalho[idxData]  : null,
        descricao: idxDesc  >= 0 ? cabecalho[idxDesc]  : null,
        valor:     idxValor >= 0 ? cabecalho[idxValor] : null,
        categoria: idxCat   >= 0 ? cabecalho[idxCat]   : null,
      },
      cabecalho_original: cabecalho,
      erros_preview: erros
    })
  } catch (e: any) {
    return c.json({ error: 'Erro ao processar CSV: ' + e.message }, 500)
  }
})

// ── POST /api/importacao/executar — importação real ───────────────────────────
importacao.post('/executar', requireAuth, async (c) => {
  const user = c.get('user')
  try {
    const body = await c.req.json()
    const { csv, tipo, mapeamento } = body
    // tipo: 'despesas' | 'receitas'
    // mapeamento: { data: colIdx, descricao: colIdx, valor: colIdx, categoria: colIdx }

    if (!csv || !tipo || !mapeamento) return c.json({ error: 'Parâmetros inválidos' }, 400)
    if (!['despesas','receitas'].includes(tipo)) return c.json({ error: 'Tipo inválido' }, 400)

    const linhas = csv.split('\n').filter((l: string) => l.trim())
    if (linhas.length < 2) return c.json({ error: 'CSV vazio' }, 400)

    const cabecalho = parseCsvLine(linhas[0])
    const { data: idxData, descricao: idxDesc, valor: idxValor, categoria: idxCat } = mapeamento

    let importados = 0
    let erros = 0
    const erroDetalhes: string[] = []

    for (let i = 1; i < linhas.length; i++) {
      const cols = parseCsvLine(linhas[i])
      if (cols.length < 2) continue

      const valor = idxValor !== undefined ? parseValor(cols[idxValor]) : null
      const data  = idxData  !== undefined ? parseData(cols[idxData])  : new Date().toISOString().slice(0,10)
      const desc  = idxDesc  !== undefined ? (cols[idxDesc]?.trim().slice(0,200) || `Importado ${i}`) : `Importado linha ${i}`
      const catBruta = idxCat !== undefined ? cols[idxCat]?.trim() : ''
      const cat   = catBruta || detectarCategoria(desc)

      if (!valor || !data) {
        erros++
        erroDetalhes.push(`Linha ${i+1}: ${!valor ? 'valor inválido' : 'data inválida'}`)
        continue
      }

      try {
        if (tipo === 'despesas') {
          await c.env.DB.prepare(
            `INSERT INTO despesas (user_id, descricao, valor, categoria, data, status, tipo, origem)
             VALUES (?, ?, ?, ?, ?, 'pago', 'normal', 'importacao_csv')`
          ).bind(user.id, desc, valor, cat, data).run()
        } else {
          await c.env.DB.prepare(
            `INSERT INTO receitas (user_id, descricao, valor, categoria, data, tipo)
             VALUES (?, ?, ?, ?, ?, 'outros')`
          ).bind(user.id, desc, valor, cat, data).run()
        }
        importados++
      } catch {
        erros++
        erroDetalhes.push(`Linha ${i+1}: erro ao inserir`)
      }
    }

    return c.json({
      success: true,
      importados,
      erros,
      erros_detalhes: erroDetalhes.slice(0, 10),
      mensagem: `${importados} ${tipo} importadas com sucesso${erros > 0 ? `. ${erros} linhas ignoradas.` : '.'}`
    })
  } catch (e: any) {
    return c.json({ error: 'Erro na importação: ' + e.message }, 500)
  }
})

export default importacao
