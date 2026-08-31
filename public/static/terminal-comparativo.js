(function () {
  const esc = (v) => String(v ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;')
  const money = (v) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 2 }).format(Number(v) || 0)
  const signed = (v) => (Number(v) >= 0 ? '+' : '') + money(v)

  window.VMTerminalComparativo = {
    async render(vm) {
      this._vm = vm
      const content = document.getElementById('page-content')
      if (!content) return
      document.body.classList.add('terminal-dashboard-active')
      const now = new Date()
      this._mes = this._mes || (now.getMonth() + 1)
      this._ano = this._ano || now.getFullYear()
      content.innerHTML = '<div class="td-loading"><span></span><span></span><span></span></div>'
      try {
        const [d, h] = await Promise.all([
          vm.api('GET', `comparativo?mes=${this._mes}&ano=${this._ano}`),
          vm.api('GET', 'comparativo/historico?meses=6').catch(() => ({ historico: [] }))
        ])
        this._d = d
        this._hist = h.historico || []
        this._paint()
      } catch (e) {
        content.innerHTML = `<div class="td-error"><i class="fas fa-triangle-exclamation"></i><h2>Não foi possível carregar o comparativo</h2><p>${esc(e.response?.data?.error || 'Tente novamente.')}</p><button class="td-button td-button--primary" onclick="VMTerminalComparativo.reload()">Tentar novamente</button></div>`
      }
    },
    reload() { this.render(this._vm) },

    _paint() {
      const content = document.getElementById('page-content')
      if (!content) return
      const d = this._d, r = d.resumo || {}, p = d.periodo || {}
      const cats = (d.categorias || []).slice(0, 12)

      content.innerHTML = this._shell(`
        <div class="mr-toolbar">
          <div><span class="td-eyebrow">${esc(p.label_ant || '')} → ${esc(p.label || '')}</span><h2>Comparativo por categoria</h2></div>
        </div>

        <div class="dg-kpis">
          ${this._delta('Receitas', r.receitas_atual, r.receitas_ant, r.tendencia_receitas, r.var_receitas, true)}
          ${this._delta('Despesas', r.despesas_atual, r.despesas_ant, r.tendencia_despesas, r.var_despesas, false)}
          ${this._delta('Saldo', r.saldo_atual, r.saldo_ant, r.tendencia_saldo, r.var_saldo, null)}
        </div>

        <article class="td-panel" style="margin-top:16px">
          <div class="td-panel__head"><div><span class="td-eyebrow">Últimos 6 meses</span><h2>Receitas × Despesas × Saldo</h2></div></div>
          ${this._chart(this._hist)}
        </article>

        ${(d.insights || []).length ? `<article class="td-panel" style="margin-top:16px">
          <div class="td-panel__head"><div><span class="td-eyebrow">Leitura</span><h2>Insights</h2></div></div>
          <ul class="pj-insights">${d.insights.map(i => `<li>${esc(i)}</li>`).join('')}</ul>
        </article>` : ''}

        <article class="td-panel" style="margin-top:16px">
          <div class="td-panel__head"><div><span class="td-eyebrow">Detalhe</span><h2>Variação por categoria</h2></div></div>
          <div class="cm-list">
            ${cats.length ? cats.map(c => this._row(c)).join('') : '<div class="td-empty-row"><span>Sem despesas para comparar.</span></div>'}
          </div>
        </article>
      `)
    },

    _delta(lbl, atual, ant, tend, varPct, higherIsGood) {
      const up = tend === 'alta', down = tend === 'queda'
      const diff = (Number(atual) || 0) - (Number(ant) || 0)
      // cor: para saldo/receita, subir é bom; para despesa, subir é ruim
      let tone = 'neutral'
      if (higherIsGood === null) tone = diff > 0 ? 'ok' : diff < 0 ? 'neg' : 'neutral'
      else if (higherIsGood) tone = diff > 0 ? 'ok' : diff < 0 ? 'neg' : 'neutral'
      else tone = diff > 0 ? 'neg' : diff < 0 ? 'ok' : 'neutral'
      const arrow = up ? '▲' : down ? '▼' : '■'
      return `<div class="dg-kpi">
        <span class="dg-kpi__lbl">${esc(lbl)}</span>
        <span class="dg-kpi__val dg-kpi__val--${tone}">${money(atual)}</span>
        <span class="cm-delta cm-delta--${tone}">${arrow} ${signed(diff)} vs ${money(ant)}</span>
      </div>`
    },

    _row(c) {
      const nova = c.nova || c.status === 'nova'
      const up = c.status === 'alta', down = c.status === 'queda'
      const tone = nova ? 'new' : up ? 'neg' : down ? 'ok' : 'neutral'
      const badge = nova ? 'NOVA' : (c.variacao >= 0 ? '+' : '') + Number(c.variacao).toFixed(0) + '%'
      const max = Math.max(Number(c.atual) || 0, Number(c.anterior) || 0, 1)
      return `<div class="cm-cat">
        <div class="cm-cat__id"><strong>${esc(c.categoria)}</strong><span class="cm-badge cm-badge--${tone}">${badge}</span></div>
        <div class="cm-bars">
          <div class="cm-bar"><span class="cm-bar__t">ant</span><div class="cm-bar__track"><span style="width:${(Number(c.anterior) / max * 100).toFixed(0)}%;background:var(--terminal-ink-soft)"></span></div><span class="cm-bar__v">${money(c.anterior)}</span></div>
          <div class="cm-bar"><span class="cm-bar__t">atual</span><div class="cm-bar__track"><span style="width:${(Number(c.atual) / max * 100).toFixed(0)}%;background:${up ? 'var(--terminal-negative)' : down ? 'var(--terminal-primary)' : 'var(--terminal-accent)'}"></span></div><span class="cm-bar__v">${money(c.atual)}</span></div>
        </div>
        <span class="cm-cat__diff cm-cat__diff--${tone}">${signed(c.diferenca)}</span>
      </div>`
    },

    _chart(hist) {
      if (!hist.length) return '<div class="td-empty-row"><span>Sem histórico.</span></div>'
      const W = 640, H = 200, pad = 10
      const rec = hist.map(h => Number(h.receitas) || 0)
      const desp = hist.map(h => Number(h.despesas) || 0)
      const sal = hist.map(h => Number(h.saldo) || 0)
      const all = rec.concat(desp, sal)
      const min = Math.min(...all, 0), max = Math.max(...all, 0), span = (max - min) || 1
      const x = (i, n) => pad + (i / Math.max(1, n - 1)) * (W - 2 * pad)
      const y = (v) => H - pad - ((v - min) / span) * (H - 2 * pad)
      const path = (arr) => arr.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i, arr.length).toFixed(1)},${y(v).toFixed(1)}`).join(' ')
      return `<svg viewBox="0 0 ${W} ${H}" width="100%" preserveAspectRatio="none" style="max-height:210px">
        <line x1="${pad}" y1="${y(0).toFixed(1)}" x2="${W - pad}" y2="${y(0).toFixed(1)}" stroke="var(--terminal-line)" stroke-dasharray="3 3"/>
        <path d="${path(rec)}" fill="none" stroke="var(--terminal-primary)" stroke-width="2"/>
        <path d="${path(desp)}" fill="none" stroke="var(--terminal-negative)" stroke-width="2"/>
        <path d="${path(sal)}" fill="none" stroke="var(--terminal-accent)" stroke-width="2" stroke-dasharray="5 3"/>
      </svg>
      <div class="cm-legend"><span><i style="background:var(--terminal-primary)"></i>Receitas</span><span><i style="background:var(--terminal-negative)"></i>Despesas</span><span><i style="background:var(--terminal-accent)"></i>Saldo</span></div>
      <div class="pj-chart__axis"><span>${esc(hist[0]?.label || '')}</span><span>${esc(hist[hist.length - 1]?.label || '')}</span></div>`
    },

    _shell(inner) {
      return `<div class="td-dashboard cm">
        <header class="td-dashboard__header">
          <div>
            <span class="td-eyebrow">Como venho indo</span>
            <h1>Comparativo mensal. <em>Mês a mês, sem autoengano.</em></h1>
            <p>Onde os gastos subiram, onde caíram, e para onde o saldo está indo — de verdade.</p>
          </div>
        </header>
        ${inner}
      </div>`
    }
  }
})()
