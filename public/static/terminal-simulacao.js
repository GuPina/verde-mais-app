(function () {
  const esc = (v) => String(v ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;')
  const money = (v) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 2 }).format(Number(v) || 0)
  const TIPOS = [
    ['poupanca', 'Poupança'], ['cdb', 'CDB'], ['lci', 'LCI'], ['lca', 'LCA'],
    ['tesouro_direto', 'Tesouro Direto'], ['acoes', 'Ações'], ['fii', 'FII'],
    ['cripto', 'Cripto'], ['caixinha', 'Caixinha (% do CDI)'], ['outros', 'Outros'],
  ]

  window.VMTerminalSimulacao = {
    async render(vm) {
      this._vm = vm
      const content = document.getElementById('page-content')
      if (!content) return
      document.body.classList.add('terminal-dashboard-active')
      this._form = this._form || { valor: 10000, tipo: 'cdb', prazo: 24, aporte: 500 }
      content.innerHTML = this._shell(this._formHtml() + '<div id="sim-out"></div>')
      if (this._last) this._renderResult(this._last)
      else this.simular()
    },
    reload() { this.render(this._vm) },

    _st() { return 'width:100%;background:var(--terminal-bg);border:1px solid var(--terminal-line);color:var(--terminal-ink);border-radius:var(--terminal-radius-sm);padding:10px 12px;font-size:13px;font-family:var(--terminal-font)' },
    _lab(t) { return `<label style="display:block;font:700 10px/1 var(--terminal-mono);letter-spacing:.1em;text-transform:uppercase;color:var(--terminal-ink-soft);margin-bottom:6px">${t}</label>` },

    _formHtml() {
      const s = this._st(), f = this._form
      const opts = TIPOS.map(([v, l]) => `<option value="${v}" ${f.tipo === v ? 'selected' : ''}>${l}</option>`).join('')
      return `<article class="td-panel sim-form">
        <div class="sim-grid">
          <div>${this._lab('Valor inicial (R$)')}<input id="sim-valor" type="number" min="1" step="100" style="${s}" value="${f.valor}"></div>
          <div>${this._lab('Aplicação')}<select id="sim-tipo" style="${s}">${opts}</select></div>
          <div>${this._lab('Prazo (meses)')}<input id="sim-prazo" type="number" min="1" max="600" style="${s}" value="${f.prazo}"></div>
          <div>${this._lab('Aporte mensal (R$)')}<input id="sim-aporte" type="number" min="0" step="50" style="${s}" value="${f.aporte}"></div>
          <div style="display:flex;align-items:flex-end"><button class="td-button td-button--primary" style="width:100%" onclick="VMTerminalSimulacao.simular()"><i class="fas fa-play"></i> Simular</button></div>
        </div>
      </article>`
    },

    async simular() {
      const vm = this._vm, g = i => document.getElementById(i)
      const valor = parseFloat(g('sim-valor')?.value)
      const tipo = g('sim-tipo')?.value || 'cdb'
      const prazo = parseInt(g('sim-prazo')?.value)
      const aporte = parseFloat(g('sim-aporte')?.value) || 0
      this._form = { valor, tipo, prazo, aporte }
      if (!(valor > 0)) return vm.toast('Valor inicial deve ser maior que zero.', 'error')
      if (!(prazo >= 1)) return vm.toast('Prazo inválido.', 'error')
      const out = document.getElementById('sim-out')
      if (out) out.innerHTML = '<div class="td-loading"><span></span><span></span><span></span></div>'
      try {
        const qs = `valor=${valor}&tipo=${encodeURIComponent(tipo)}&prazo_meses=${prazo}&aporte_mensal=${aporte}`
        const d = await vm.api('GET', `investimentos/simulacao?${qs}`)
        if (d && d.upgrade) return void (out.innerHTML = this._upsell(d))
        this._last = d
        this._renderResult(d)
      } catch (e) {
        const err = e.response?.data
        if (err && err.upgrade) { if (out) out.innerHTML = this._upsell(err); return }
        if (out) out.innerHTML = `<div class="td-notice" style="margin-top:16px"><i class="fas fa-triangle-exclamation"></i><div><span>${esc(err?.error || 'Não foi possível simular.')}</span></div></div>`
      }
    },

    _renderResult(d) {
      const out = document.getElementById('sim-out')
      if (!out) return
      const s = d.simulacao || {}
      const proj = s.projecao || []
      const tipoLbl = (TIPOS.find(t => t[0] === s.tipo) || [null, s.tipo])[1]
      out.innerHTML = `
        <section class="sim-hero">
          <div class="sim-hero__main">
            <span class="td-eyebrow">Em ${s.prazo_meses} meses · ${esc(tipoLbl)} · ${Number(s.taxa_mensal).toLocaleString('pt-BR', { maximumFractionDigits: 3 })}% a.m.</span>
            <div class="sim-big">${money(s.valor_final)}</div>
            <p>investido ${money(s.total_investido)} · lucro <strong style="color:var(--terminal-primary)">${money(s.lucro_total)}</strong> (${Number(s.rentabilidade_total).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%)</p>
          </div>
          <div class="sim-hero__chart">${this._chart(proj, Number(s.valor_inicial))}</div>
        </section>
        <div class="dg-kpis" style="margin-top:14px">
          ${this._kpi('Valor inicial', money(s.valor_inicial))}
          ${this._kpi('Total aportado', money(s.total_aportado))}
          ${this._kpi('Lucro', money(s.lucro_total), 'ok')}
          ${this._kpi('CDI hoje', Number(d.cdi_atual).toLocaleString('pt-BR', { maximumFractionDigits: 2 }) + '% a.a.')}
        </div>
        <p class="sim-aviso">${esc(d.aviso || '')}</p>`
    },

    _kpi(lbl, val, tone) {
      return `<div class="dg-kpi"><span class="dg-kpi__lbl">${esc(lbl)}</span><span class="dg-kpi__val dg-kpi__val--${tone || 'neutral'}">${val}</span></div>`
    },

    _chart(proj, valorInicial) {
      if (!proj.length) return ''
      const W = 460, H = 190, pad = 8
      const vals = [valorInicial].concat(proj.map(p => Number(p.valor) || 0))
      const inv = [valorInicial].concat(proj.map(p => Number(p.total_investido) || 0))
      const min = Math.min(...vals, ...inv, 0), max = Math.max(...vals, ...inv, 1), span = (max - min) || 1
      const x = (i, n) => pad + (i / Math.max(1, n - 1)) * (W - 2 * pad)
      const y = (v) => H - pad - ((v - min) / span) * (H - 2 * pad)
      const area = vals.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i, vals.length).toFixed(1)},${y(v).toFixed(1)}`).join(' ')
      const base = `L${x(vals.length - 1, vals.length).toFixed(1)},${y(min).toFixed(1)} L${x(0, vals.length).toFixed(1)},${y(min).toFixed(1)} Z`
      const invLine = inv.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i, inv.length).toFixed(1)},${y(v).toFixed(1)}`).join(' ')
      return `<svg viewBox="0 0 ${W} ${H}" width="100%" preserveAspectRatio="none" style="max-height:200px">
        <path d="${area} ${base}" fill="var(--terminal-primary)" opacity="0.1"/>
        <path d="${invLine}" fill="none" stroke="var(--terminal-ink-soft)" stroke-width="1.5" stroke-dasharray="4 3"/>
        <path d="${area}" fill="none" stroke="var(--terminal-primary)" stroke-width="2.5"/>
      </svg>
      <div class="cm-legend"><span><i style="background:var(--terminal-primary)"></i>Patrimônio</span><span><i style="background:var(--terminal-ink-soft)"></i>Investido</span></div>`
    },

    _upsell(d) {
      return `<section class="td-onboarding" style="margin-top:16px"><div class="td-onboarding__copy">
        <span class="td-eyebrow">Recurso Premium</span>
        <h2>Simulador de investimentos.</h2>
        <p>${esc(d.error || 'As simulações de rendimento fazem parte dos planos pagos.')}</p>
        <div class="td-onboarding__actions"><button class="td-button td-button--primary" onclick="VM.navigate('planos')"><i class="fas fa-arrow-up"></i> Ver planos</button></div>
      </div></section>`
    },

    _shell(inner) {
      return `<div class="td-dashboard sim">
        <header class="td-dashboard__header">
          <div>
            <span class="td-eyebrow">E se você investisse?</span>
            <h1>Simulações. <em>Veja o dinheiro trabalhar.</em></h1>
            <p>Projete CDB, Tesouro, ações e mais — com aporte mensal e juros compostos.</p>
          </div>
        </header>
        ${inner}
      </div>`
    }
  }
})()
