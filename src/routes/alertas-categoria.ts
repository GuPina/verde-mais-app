// src/routes/alertas-categoria.ts
// Alerta quando gasto de uma categoria está >20% acima da média dos últimos 3 meses
import { Hono } from 'hono'
import { requireAuth } from './auth'

type Bindings = { DB: D1Database }
type Variables = { user: { id: number; nome: string; email: string; plano: string } }

const alertasCategoria = new Hono<{ Bindings: Bindings; Variables: Variables }>()

// GET /api/alertas-categoria?mes=3&ano=2026
alertasCategoria.get('/', requireAuth, async (c) => {
  const user = c.get('user')
  const now = new Date()
  const mes = parseInt(c.req.query('mes') || String(now.getMonth() + 1))
  const ano = parseInt(c.req.query('ano') || String(now.getFullYear()))

  // Mês atual por categoria
  const atual = await c.env.DB.prepare(`
    SELECT categoria, SUM(valor) as total
    FROM despesas
    WHERE user_id = ? 
      AND strftime('%m', data) = ? 
      AND strftime('%Y', data) = ?
    GROUP BY categoria
  `).bind(user.id, String(mes).padStart(2,'0'), String(ano)).all()

  // Média dos 3 meses anteriores por categoria
  const media = await c.env.DB.prepare(`
    SELECT categoria, AVG(total) as media_3m
    FROM (
      SELECT categoria, strftime('%Y-%m', data) as periodo, SUM(valor) as total
      FROM despesas
      WHERE user_id = ?
        AND data < date(? || '-' || printf('%02d', ?) || '-01')
        AND data >= date(? || '-' || printf('%02d', ?) || '-01', '-3 months')
      GROUP BY categoria, strftime('%Y-%m', data)
    )
    GROUP BY categoria
  `).bind(user.id, String(ano), mes, String(ano), mes).all()

  const mediaMap: Record<string, number> = {}
  for (const r of (media.results as any[])) {
    mediaMap[r.categoria] = parseFloat(r.media_3m) || 0
  }

  const alertas = []
  for (const row of (atual.results as any[])) {
    const cat = row.categoria
    const totalAtual = parseFloat(row.total) || 0
    const mediaAnterior = mediaMap[cat] || 0

    if (mediaAnterior > 0) {
      const pct = ((totalAtual - mediaAnterior) / mediaAnterior) * 100
      if (pct >= 20) {
        alertas.push({
          categoria: cat,
          total_atual: totalAtual,
          media_3m: mediaAnterior,
          variacao_pct: Math.round(pct),
          nivel: pct >= 50 ? 'critico' : 'atencao',
          mensagem: `${cat} está ${Math.round(pct)}% acima da média dos últimos 3 meses`
        })
      }
    } else if (totalAtual > 0) {
      // Categoria nova — sem histórico para comparar
    }
  }

  // Ordenar pelo maior desvio
  alertas.sort((a, b) => b.variacao_pct - a.variacao_pct)

  return c.json({
    alertas,
    total_alertas: alertas.length,
    mes, ano,
    has_alertas: alertas.length > 0
  })
})

export default alertasCategoria
