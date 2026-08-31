(function () {
  const esc = (v) => String(v ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;')
  const money = (v) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 2 }).format(Number(v) || 0)

  window.VMTerminalRegra = {
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
        this._d = await vm.api('GET', `regra-503020?mes=${this._mes}&ano=${this._ano}`)
        this._paint()
      } catch (e) {
        content.innerHTML = `<div class="td-error"><i class="fas fa-triangle-exclamation"></i><h2>Não foi possível carregar a regra</h2><p>${esc(e.response?.data?.error || 'Tente novamente.')}</p><button class="td-button td-button--primary" onclick="VMTerminalRegra.reload()">Tentar novamente</button></div>`
      }
    },
    reload() { this.render(this._vm) },

    _paint() {
      const content = document.getElementById('page-content')
      if (!content) return
      const d = this._d, r = d.regra || {}, cur = d.current || {}, ideal = d.ideal || {}
      const score = Math.round(Number(d.score) || 0)
      const semRenda = !(Number(d.income) > 0)
      const cor = score >= 80 ? 'var(--terminal-primary)' : score >= 50 ? 'var(--terminal-accent)' : 'var(--terminal-negative)'
      const dash = 2 * Math.PI * 52, off = dash * (1 - Math.min(100, score) / 100)

      content.innerHTML = this._shell(`
        <section class="dg-hero">
          <div class="dg-ring">
            <svg viewBox="0 0 120 120" width="128" height="128">
              <circle cx="60" cy="60" r="52" fill="none" stroke="var(--terminal-line)" stroke-width="10"/>
              <circle cx="60" cy="60" r="52" fill="none" stroke="${cor}" stroke-width="10" stroke-linecap="round" stroke-dasharray="${dash.toFixed(1)}" stroke-dashoffset="${off.toFixed(1)}" transform="rotate(-90 60 60)"/>
              <text x="60" y="58" text-anchor="middle" font-size="30" font-weight="700" fill="var(--terminal-ink)" font-family="var(--terminal-font)">${score}</text>
              <text x="60" y="76" text-anchor="middle" font-size="9" fill="var(--terminal-ink-soft)" font-family="var(--terminal-mono)">aderência</text>
            </svg>
          </div>
          <div class="dg-hero__main">
            <span class="td-eyebrow">${esc(r.nome || 'Regra 50/30/20')}${r.personalizada ? ' · personalizada' : ''}</span>
            <h2>${semRenda ? 'Nenhuma receita neste mês' : score >= 80 ? 'Equilíbrio excelente' : score >= 50 ? 'No caminho' : 'Fora do equilíbrio'}</h2>
            <p style="color:var(--terminal-ink-soft);font-size:13px;margin:0 0 12px">Renda do mês: ${money(d.income)}</p>
            <div class="rg-bars">
              ${this._group('Necessidades', cur.needs, ideal.needs, r.pct_necessidades, 'need')}
              ${this._group('Desejos', cur.wants, ideal.wants, r.pct_desejos, 'want')}
              ${this._group('Poupança', cur.savings, ideal.savings, r.pct_poupanca, 'save')}
            </div>
          </div>
        </section>

        ${(d.recommendations || []).length ? `<article class="td-panel" style="margin-top:18px">
          <div class="td-panel__head"><div><span class="td-eyebrow">O que fazer</span><h2>Recomendações</h2></div></div>
          <ul class="pj-insights">${d.recommendations.map(i => `<li>${esc(i)}</li>`).join('')}</ul>
        </article>` : ''}

        ${(d.breakdown?.top_needs?.length || d.breakdown?.top_wants?.length) ? `<div class="rg-cols">
          ${this._topCol('Maiores necessidades', d.breakdown.top_needs, 'need')}
          ${this._topCol('Maiores desejos', d.breakdown.top_wants, 'want')}
        </div>` : ''}

        ${(d.sugestoes_orcamento || []).length ? `<article class="td-panel" style="margin-top:16px">
          <div class="td-panel__head"><div><span class="td-eyebrow">Sugestão</span><h2>Orçamentos recomendados</h2></div></div>
          <div class="an-list">${d.sugestoes_orcamento.map(s => `<div class="an-card"><div class="an-card__main"><strong>${esc(s.categoria)}</strong><small>${esc(s.motivo)}</small></div><div class="an-card__vals"><span class="an-card__val">${money(s.limite_sugerido)}</span><small class="an-card__eco">hoje ${money(s.gasto_atual)}</small></div></div>`).join('')}</div>
        </article>` : ''}
      `)
    },

    _group(lbl, cur, ideal, pct, kind) {
      const amount = Number(cur?.amount) || 0
      const perc = Number(cur?.percentage) || 0
      const idealV = Number(ideal) || 0
      const alvo = Number(pct) || 0
      // cor: necessidades/desejos acima do ideal = ruim; poupança acima = bom
      const acima = amount > idealV
      const tone = kind === 'save' ? (perc >= alvo ? 'ok' : 'warn') : (acima ? 'neg' : 'ok')
      const barCor = tone === 'ok' ? 'var(--terminal-primary)' : tone === 'warn' ? 'var(--terminal-accent)' : 'var(--terminal-negative)'
      const w = Math.min(100, perc)
      return `<div class="rg-group">
        <div class="rg-group__top"><span class="rg-group__lbl">${esc(lbl)}</span><span class="rg-group__pct rg-group__pct--${tone}">${perc.toFixed(0)}% <em>/ ${alvo}%</em></span></div>
        <div class="rg-track"><span class="rg-track__ideal" style="left:${Math.min(100, alvo)}%"></span><span class="rg-track__fill" style="width:${w}%;background:${barCor}"></span></div>
        <div class="rg-group__vals"><span>${money(amount)}</span><span>ideal ${money(idealV)}</span></div>
      </div>`
    },

    _topCol(title, arr, kind) {
      if (!arr || !arr.length) return ''
      const max = Math.max(...arr.map(a => Number(a.val) || 0), 1)
      return `<article class="td-panel">
        <div class="td-panel__head"><div><span class="td-eyebrow">${kind === 'need' ? 'Essenciais' : 'Estilo de vida'}</span><h2>${esc(title)}</h2></div></div>
        <div class="rg-top">${arr.map(a => `<div class="rg-top__row"><span class="rg-top__cat">${esc(a.cat)}</span><div class="rg-top__track"><span style="width:${(Number(a.val) / max * 100).toFixed(0)}%;background:${kind === 'need' ? 'var(--terminal-primary)' : 'var(--terminal-accent)'}"></span></div><span class="rg-top__val">${money(a.val)}</span></div>`).join('')}</div>
      </article>`
    },

    _shell(inner) {
      return `<div class="td-dashboard rg">
        <header class="td-dashboard__header">
          <div>
            <span class="td-eyebrow">Equilíbrio das suas finanças</span>
            <h1>Regra 50/30/20. <em>Onde cada real está indo.</em></h1>
            <p>Necessidades, desejos e poupança — quanto você gasta em cada, e quanto seria o ideal.</p>
          </div>
        </header>
        ${inner}
      </div>`
    }
  }
})()
