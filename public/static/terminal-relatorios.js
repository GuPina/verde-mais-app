(function () {
  const esc = (v) => String(v ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;')
  const money = (v) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 2 }).format(Number(v) || 0)

  window.VMTerminalRelatorios = {
    async render(vm) {
      this._vm = vm
      const content = document.getElementById('page-content')
      if (!content) return
      document.body.classList.add('terminal-dashboard-active')
      this._ano = this._ano || new Date().getFullYear()
      content.innerHTML = '<div class="td-loading"><span></span><span></span><span></span></div>'
      try {
        const d = await vm.api('GET', `relatorio/anual?ano=${this._ano}`)
        if (d && d.upgrade) return void (content.innerHTML = this._shell(this._upsell(d)))
        this._d = d
        this._paint()
      } catch (e) {
        const err = e.response?.data
        if (err && err.upgrade) return void (content.innerHTML = this._shell(this._upsell(err)))
        content.innerHTML = `<div class="td-error"><i class="fas fa-triangle-exclamation"></i><h2>Não foi possível carregar o relatório</h2><p>${esc(err?.error || 'Tente novamente.')}</p><button class="td-button td-button--primary" onclick="VMTerminalRelatorios.reload()">Tentar novamente</button></div>`
      }
    },
    reload() { this.render(this._vm) },
    mudarAno(delta) { this._ano = (this._ano || new Date().getFullYear()) + delta; this.render(this._vm) },

    _paint() {
      const content = document.getElementById('page-content')
      if (!content) return
      const d = this._d, t = d.totais || {}, dz = d.destaques || {}
      const meses = d.meses || []
      const saldoTone = Number(t.saldo) >= 0 ? 'ok' : 'neg'
      // RL1: só é "melhor mês" (verde) se for positivo; senão é "mês menos ruim" (âmbar)
      const melhorPos = !!dz.melhor_mes_positivo
      const mediaTone = Number(t.media_mensal) >= 0 ? 'ok' : 'neg'

      content.innerHTML = this._shell(`
        <div class="mr-toolbar">
          <div><span class="td-eyebrow">Ano</span><h2 style="display:flex;align-items:center;gap:12px"><button class="td-icon-btn" onclick="VMTerminalRelatorios.mudarAno(-1)"><i class="fas fa-chevron-left"></i></button>${d.ano}<button class="td-icon-btn" onclick="VMTerminalRelatorios.mudarAno(1)"><i class="fas fa-chevron-right"></i></button></h2></div>
          <div style="display:flex;gap:8px">
            <button class="td-button td-button--sm" onclick="(window.VM.exportarRelatorioPDF&&VM.exportarRelatorioPDF())"><i class="fas fa-file-pdf"></i> PDF</button>
            <button class="td-button td-button--sm" onclick="(window.VM.exportarRelatorioExcel&&VM.exportarRelatorioExcel())"><i class="fas fa-file-excel"></i> Excel</button>
          </div>
        </div>

        <div class="dg-kpis">
          ${this._kpi('Receitas ' + d.ano, money(t.receitas), 'ok')}
          ${this._kpi('Despesas ' + d.ano, money(t.despesas), 'neg')}
          ${this._kpi('Saldo do ano', money(t.saldo), saldoTone)}
          ${this._kpi('Média mensal', money(t.media_mensal), mediaTone, 'sobre 12 meses, com o sinal real')}
        </div>

        <div class="dg-kpis" style="margin-top:12px">
          <div class="dg-kpi">
            <span class="dg-kpi__lbl">${melhorPos ? '🏆 Melhor mês' : 'Mês menos ruim'}</span>
            <span class="dg-kpi__val dg-kpi__val--${melhorPos ? 'ok' : 'warn'}">${esc(dz.melhor_mes || '—')}</span>
            <span class="pj-kpi__hint">${money(dz.melhor_mes_saldo)}${melhorPos ? '' : ' · ainda negativo'}</span>
          </div>
          <div class="dg-kpi">
            <span class="dg-kpi__lbl">Pior mês</span>
            <span class="dg-kpi__val dg-kpi__val--neg">${esc(dz.pior_mes || '—')}</span>
            <span class="pj-kpi__hint">${money(dz.pior_mes_saldo)}</span>
          </div>
        </div>

        <article class="td-panel" style="margin-top:16px">
          <div class="td-panel__head"><div><span class="td-eyebrow">Evolução ${d.ano}</span><h2>Receitas × Despesas × Saldo</h2></div></div>
          ${this._chart(meses)}
        </article>

        <article class="td-panel" style="margin-top:16px">
          <div class="td-panel__head"><div><span class="td-eyebrow">Mês a mês</span><h2>Fechamento de cada mês</h2></div></div>
          <div class="rl-grid">
            ${meses.map(m => {
              const has = m.receitas > 0 || m.despesas > 0
              const tone = !has ? 'muted' : m.saldo >= 0 ? 'ok' : 'neg'
              return `<div class="rl-cell rl-cell--${tone}"><span class="rl-cell__m">${esc(m.label)}</span><span class="rl-cell__s">${has ? money(m.saldo) : '—'}</span></div>`
            }).join('')}
          </div>
        </article>
      `)
    },

    _kpi(lbl, val, tone, hint) {
      return `<div class="dg-kpi"><span class="dg-kpi__lbl">${esc(lbl)}</span><span class="dg-kpi__val dg-kpi__val--${tone || 'neutral'}">${val}</span>${hint ? `<span class="pj-kpi__hint">${esc(hint)}</span>` : ''}</div>`
    },

    _chart(meses) {
      if (!meses.length) return '<div class="td-empty-row"><span>Sem dados.</span></div>'
      const W = 680, H = 210, pad = 12
      const rec = meses.map(m => Number(m.receitas) || 0)
      const desp = meses.map(m => Number(m.despesas) || 0)
      const sal = meses.map(m => Number(m.saldo) || 0)
      const all = rec.concat(desp, sal)
      const min = Math.min(...all, 0), max = Math.max(...all, 0), span = (max - min) || 1
      const x = (i) => pad + (i / 11) * (W - 2 * pad)
      const y = (v) => H - pad - ((v - min) / span) * (H - 2 * pad)
      const bw = (W - 2 * pad) / 12 * 0.36
      const bars = meses.map((m, i) => {
        const s = Number(m.saldo) || 0
        const y0 = y(0), ys = y(s)
        const col = (m.receitas > 0 || m.despesas > 0) ? (s >= 0 ? 'var(--terminal-primary)' : 'var(--terminal-negative)') : 'var(--terminal-line)'
        return `<rect x="${(x(i) - bw / 2).toFixed(1)}" y="${Math.min(y0, ys).toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.abs(ys - y0).toFixed(1)}" fill="${col}" opacity="0.55" rx="2"/>`
      }).join('')
      const path = (arr, col, dash) => `<path d="${arr.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')}" fill="none" stroke="${col}" stroke-width="2" ${dash ? 'stroke-dasharray="5 3"' : ''}/>`
      return `<svg viewBox="0 0 ${W} ${H}" width="100%" preserveAspectRatio="none" style="max-height:220px">
        <line x1="${pad}" y1="${y(0).toFixed(1)}" x2="${W - pad}" y2="${y(0).toFixed(1)}" stroke="var(--terminal-line)" stroke-dasharray="3 3"/>
        ${bars}
        ${path(rec, 'var(--terminal-primary)')}
        ${path(desp, 'var(--terminal-negative)')}
        ${path(sal, 'var(--terminal-accent)', true)}
      </svg>
      <div class="cm-legend"><span><i style="background:var(--terminal-primary)"></i>Receitas</span><span><i style="background:var(--terminal-negative)"></i>Despesas</span><span><i style="background:var(--terminal-accent)"></i>Saldo</span></div>`
    },

    _upsell(d) {
      return `<section class="td-onboarding"><div class="td-onboarding__copy">
        <span class="td-eyebrow">Recurso Premium</span>
        <h2>Relatório anual e exportação.</h2>
        <p>${esc(d.error || 'O relatório anual mês a mês e a exportação em PDF/Excel fazem parte dos planos pagos.')}</p>
        <div class="td-onboarding__actions"><button class="td-button td-button--primary" onclick="VM.navigate('planos')"><i class="fas fa-arrow-up"></i> Ver planos</button></div>
      </div></section>`
    },

    _shell(inner) {
      return `<div class="td-dashboard rl">
        <header class="td-dashboard__header">
          <div>
            <span class="td-eyebrow">O ano inteiro numa página</span>
            <h1>Relatórios. <em>Seu ano financeiro, honesto.</em></h1>
            <p>Evolução mês a mês, os destaques certos e exportação para levar aonde precisar.</p>
          </div>
        </header>
        ${inner}
      </div>`
    }
  }
})()
