(function () {
  const esc = (v) => String(v ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;')
  const money = (v) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 2 }).format(Number(v) || 0)
  const short = (v) => {
    const n = Number(v) || 0, a = Math.abs(n), s = n < 0 ? '-' : ''
    if (a >= 1e6) return s + 'R$ ' + (a / 1e6).toFixed(a >= 1e7 ? 0 : 1).replace('.', ',') + 'M'
    if (a >= 1e3) return s + 'R$ ' + (a / 1e3).toFixed(a >= 1e4 ? 0 : 1).replace('.', ',') + 'k'
    return s + 'R$ ' + a.toFixed(0)
  }

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
      const mediaTone = Number(t.media_mensal) >= 0 ? 'ok' : 'neg'
      const melhorPos = !!dz.melhor_mes_positivo
      const comDados = Number(t.meses_com_dados) || 0

      content.innerHTML = this._shell(`
        <div class="mr-toolbar">
          <div class="rl-yearnav"><span class="td-eyebrow">Ano</span>
            <div class="rl-yearnav__row">
              <button class="td-icon-btn" onclick="VMTerminalRelatorios.mudarAno(-1)" title="Ano anterior"><i class="fas fa-chevron-left"></i></button>
              <strong>${d.ano}</strong>
              <button class="td-icon-btn" onclick="VMTerminalRelatorios.mudarAno(1)" title="Próximo ano"><i class="fas fa-chevron-right"></i></button>
            </div>
          </div>
          <div class="rl-actions">
            <button class="td-button td-button--sm" onclick="(window.VM.exportarRelatorioPDF&&VM.exportarRelatorioPDF())"><i class="fas fa-file-pdf"></i> PDF</button>
            <button class="td-button td-button--sm" onclick="(window.VM.exportarRelatorioExcel&&VM.exportarRelatorioExcel())"><i class="fas fa-file-excel"></i> Excel</button>
          </div>
        </div>

        <div class="rl-summary">
          <div class="rl-hero rl-hero--${saldoTone}">
            <span class="rl-hero__lbl">Saldo do ano ${d.ano}</span>
            <strong class="rl-hero__val">${money(t.saldo)}</strong>
            <span class="rl-hero__sub">${comDados ? `Fechado em ${comDados} ${comDados === 1 ? 'mês' : 'meses'} com movimento` : 'Sem movimento registrado ainda'}</span>
          </div>
          <div class="rl-stats">
            <div class="rl-stat">
              <span class="rl-stat__lbl"><i class="fas fa-arrow-down" style="color:var(--terminal-primary)"></i> Receitas</span>
              <strong class="rl-stat__val rl-stat__val--ok">${money(t.receitas)}</strong>
            </div>
            <div class="rl-stat">
              <span class="rl-stat__lbl"><i class="fas fa-arrow-up" style="color:var(--terminal-negative)"></i> Despesas</span>
              <strong class="rl-stat__val rl-stat__val--neg">${money(t.despesas)}</strong>
            </div>
            <div class="rl-stat">
              <span class="rl-stat__lbl">Média mensal</span>
              <strong class="rl-stat__val rl-stat__val--${mediaTone}">${money(t.media_mensal)}</strong>
              <span class="rl-stat__hint">saldo médio sobre 12 meses</span>
            </div>
          </div>
        </div>

        <div class="rl-highlights">
          <div class="rl-hl rl-hl--${melhorPos ? 'ok' : 'warn'}">
            <span class="rl-hl__ico">${melhorPos ? '🏆' : '🙂'}</span>
            <div class="rl-hl__body">
              <span class="rl-hl__lbl">${melhorPos ? 'Melhor mês' : 'Mês menos ruim'}</span>
              <strong class="rl-hl__mes">${esc(dz.melhor_mes || '—')}</strong>
              <span class="rl-hl__val">${money(dz.melhor_mes_saldo)}${melhorPos ? '' : ' · ainda negativo'}</span>
            </div>
          </div>
          <div class="rl-hl rl-hl--neg">
            <span class="rl-hl__ico">📉</span>
            <div class="rl-hl__body">
              <span class="rl-hl__lbl">Pior mês</span>
              <strong class="rl-hl__mes">${esc(dz.pior_mes || '—')}</strong>
              <span class="rl-hl__val">${money(dz.pior_mes_saldo)}</span>
            </div>
          </div>
        </div>

        <article class="td-panel" style="margin-top:16px">
          <div class="td-panel__head"><div><span class="td-eyebrow">Evolução ${d.ano}</span><h2>Receitas e despesas, mês a mês</h2></div></div>
          ${this._chart(meses)}
        </article>

        <article class="td-panel" style="margin-top:16px">
          <div class="td-panel__head"><div><span class="td-eyebrow">Mês a mês</span><h2>Saldo de cada mês</h2></div></div>
          <div class="rl-grid">
            ${meses.map(m => {
              const has = m.receitas > 0 || m.despesas > 0
              const tone = !has ? 'muted' : m.saldo >= 0 ? 'ok' : 'neg'
              return `<div class="rl-cell rl-cell--${tone}" title="${esc(m.label)}: ${has ? money(m.saldo) : 'sem movimento'}"><span class="rl-cell__m">${esc(m.label)}</span><span class="rl-cell__s">${has ? money(m.saldo) : '—'}</span></div>`
            }).join('')}
          </div>
        </article>
      `)
    },

    _chart(meses) {
      if (!meses.length) return '<div class="td-empty-row"><span>Sem dados.</span></div>'
      const temMov = meses.some(m => (Number(m.receitas) || 0) > 0 || (Number(m.despesas) || 0) > 0)
      if (!temMov) return '<div class="td-empty-row"><span>Nenhum lançamento neste ano ainda.</span></div>'

      const W = 760, H = 300
      const mL = 52, mR = 14, mT = 14, mB = 34
      const pL = mL, pR = W - mR, pT = mT, pB = H - mB
      const pW = pR - pL, pH = pB - pT

      const rec = meses.map(m => Number(m.receitas) || 0)
      const desp = meses.map(m => Number(m.despesas) || 0)
      const sal = meses.map(m => Number(m.saldo) || 0)
      let maxV = Math.max(...rec, ...desp, ...sal, 0)
      let minV = Math.min(...sal, 0)
      // headroom + nice-ish rounding for the top
      const rawTop = maxV * 1.08 || 1
      const pow = Math.pow(10, Math.floor(Math.log10(rawTop)))
      const niceTop = Math.ceil(rawTop / pow) * pow
      maxV = niceTop
      if (minV < 0) { const pB2 = Math.pow(10, Math.floor(Math.log10(Math.abs(minV) || 1))); minV = -Math.ceil(Math.abs(minV) * 1.08 / pB2) * pB2 }
      const span = (maxV - minV) || 1
      const y = (v) => pB - ((v - minV) / span) * pH

      // gridlines
      const ticks = []
      const nTicks = 4
      for (let i = 0; i <= nTicks; i++) { ticks.push(minV + (span * i / nTicks)) }
      const grid = ticks.map(v => {
        const yy = y(v)
        return `<line x1="${pL}" y1="${yy.toFixed(1)}" x2="${pR}" y2="${yy.toFixed(1)}" stroke="var(--terminal-line)" stroke-width="1" opacity="${Math.abs(v) < 1e-6 ? 0.9 : 0.35}"/><text x="${(pL - 8).toFixed(1)}" y="${(yy + 3.5).toFixed(1)}" text-anchor="end" font-size="10" fill="var(--terminal-ink-soft)" font-family="var(--terminal-mono)">${short(v)}</text>`
      }).join('')

      const slotW = pW / 12
      const groupW = slotW * 0.62
      const barW = groupW / 2 - 1.5
      const y0 = y(0)

      const bars = meses.map((m, i) => {
        const cx = pL + slotW * (i + 0.5)
        const gx = cx - groupW / 2
        const r = Number(m.receitas) || 0, dp = Number(m.despesas) || 0
        const rH = Math.abs(y0 - y(r)), dH = Math.abs(y0 - y(dp))
        const has = r > 0 || dp > 0
        const t = `<title>${esc(m.label)} — Receitas ${money(r)} · Despesas ${money(dp)} · Saldo ${money(Number(m.saldo) || 0)}</title>`
        const rBar = `<rect x="${gx.toFixed(1)}" y="${y(r).toFixed(1)}" width="${barW.toFixed(1)}" height="${rH.toFixed(1)}" rx="2" fill="var(--terminal-primary)" opacity="${has ? 0.92 : 0.25}">${t}</rect>`
        const dBar = `<rect x="${(gx + barW + 3).toFixed(1)}" y="${y(dp).toFixed(1)}" width="${barW.toFixed(1)}" height="${dH.toFixed(1)}" rx="2" fill="var(--terminal-negative)" opacity="${has ? 0.92 : 0.25}">${t}</rect>`
        return rBar + dBar
      }).join('')

      // saldo line + dots
      const cxs = meses.map((_, i) => pL + slotW * (i + 0.5))
      const linePts = meses.map((m, i) => `${cxs[i].toFixed(1)},${y(Number(m.saldo) || 0).toFixed(1)}`).join(' ')
      const dots = meses.map((m, i) => {
        const s = Number(m.saldo) || 0
        const has = m.receitas > 0 || m.despesas > 0
        if (!has) return ''
        return `<circle cx="${cxs[i].toFixed(1)}" cy="${y(s).toFixed(1)}" r="3" fill="var(--terminal-bg)" stroke="var(--terminal-accent)" stroke-width="2"/>`
      }).join('')

      const xlabels = meses.map((m, i) => `<text x="${cxs[i].toFixed(1)}" y="${(pB + 16).toFixed(1)}" text-anchor="middle" font-size="10" fill="var(--terminal-ink-soft)" font-family="var(--terminal-mono)">${esc((m.label || '').slice(0, 3))}</text>`).join('')

      return `<div class="rl-chartwrap"><svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Receitas e despesas mês a mês" style="display:block">
        ${grid}
        ${bars}
        <polyline points="${linePts}" fill="none" stroke="var(--terminal-accent)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
        ${dots}
        ${xlabels}
      </svg></div>
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
