(function () {
  const esc = (v) => String(v ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;')
  const money = (v) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 2 }).format(Number(v) || 0)

  window.VMTerminalAmortizacao = {
    async render(vm) {
      this._vm = vm
      const content = document.getElementById('page-content')
      if (!content) return
      document.body.classList.add('terminal-dashboard-active')
      content.innerHTML = '<div class="td-loading"><span></span><span></span><span></span></div>'
      try {
        const fin = await vm.api('GET', 'financiamentos').catch(() => ({ financiamentos: [] }))
        this._fins = (fin.financiamentos || []).filter(f => f.status === 'ativo')
        content.innerHTML = this._shell(this._formHtml() + '<div id="am-out"></div>')
      } catch (e) {
        content.innerHTML = `<div class="td-error"><i class="fas fa-triangle-exclamation"></i><h2>Não foi possível carregar</h2><p>${esc(e.response?.data?.error || 'Tente novamente.')}</p><button class="td-button td-button--primary" onclick="VMTerminalAmortizacao.reload()">Tentar novamente</button></div>`
      }
    },
    reload() { this.render(this._vm) },

    _st() { return 'width:100%;background:var(--terminal-bg);border:1px solid var(--terminal-line);color:var(--terminal-ink);border-radius:var(--terminal-radius-sm);padding:10px 12px;font-size:13px;font-family:var(--terminal-font)' },
    _lab(t) { return `<label style="display:block;font:700 10px/1 var(--terminal-mono);letter-spacing:.1em;text-transform:uppercase;color:var(--terminal-ink-soft);margin-bottom:6px">${t}</label>` },

    _formHtml() {
      const s = this._st()
      const finOpts = this._fins.map(f => `<option value="${Number(f.id)}">${esc(f.descricao)} — saldo ${money(f.saldo_devedor)}</option>`).join('')
      const temFin = this._fins.length > 0
      return `<article class="td-panel am-form">
        <div class="td-panel__head"><div><span class="td-eyebrow">De onde vêm os dados</span><h2>Simular aporte extra</h2></div></div>
        ${temFin ? `
        <div class="am-modes">
          <label class="am-mode"><input type="radio" name="am-mode" value="fin" checked onchange="VMTerminalAmortizacao._toggle()"> Financiamento cadastrado</label>
          <label class="am-mode"><input type="radio" name="am-mode" value="manual" onchange="VMTerminalAmortizacao._toggle()"> Entrada manual</label>
        </div>` : ''}
        <div id="am-fin" style="${temFin ? '' : 'display:none'}">
          <div style="margin-top:12px">${this._lab('Financiamento')}<select id="am-fin-sel" style="${s}">${finOpts}</select></div>
        </div>
        <div id="am-manual" style="${temFin ? 'display:none' : ''}">
          <div class="sim-grid" style="margin-top:12px">
            <div>${this._lab('Saldo devedor (R$)')}<input id="am-balance" type="number" min="0" step="100" style="${s}"></div>
            <div>${this._lab('Parcela atual (R$)')}<input id="am-inst" type="number" min="0" step="10" style="${s}"></div>
            <div>${this._lab('Parcelas restantes')}<input id="am-months" type="number" min="2" max="600" style="${s}"></div>
            <div>${this._lab('Taxa % a.a.')}<input id="am-rate" type="number" min="0" step="0.1" style="${s}"></div>
            <div>${this._lab('Sistema')}<select id="am-sys" style="${s}"><option value="PRICE">PRICE</option><option value="SAC">SAC</option></select></div>
          </div>
        </div>
        <div class="sim-grid" style="margin-top:12px">
          <div>${this._lab('Valor da amortização (R$)')}<input id="am-extra" type="number" min="1" step="100" style="${s}" placeholder="Ex.: 10000"></div>
          <div style="display:flex;align-items:flex-end"><button class="td-button td-button--primary" style="width:100%" onclick="VMTerminalAmortizacao.simular()"><i class="fas fa-bolt"></i> Simular</button></div>
        </div>
      </article>`
    },
    _toggle() {
      const mode = (document.querySelector('input[name="am-mode"]:checked') || {}).value || 'fin'
      const fin = document.getElementById('am-fin'), man = document.getElementById('am-manual')
      if (fin) fin.style.display = mode === 'fin' ? '' : 'none'
      if (man) man.style.display = mode === 'manual' ? '' : 'none'
    },

    async simular() {
      const vm = this._vm, g = i => document.getElementById(i)
      const extra = parseFloat(g('am-extra')?.value)
      if (!(extra > 0)) return vm.toast('Informe o valor da amortização.', 'error')
      const mode = (document.querySelector('input[name="am-mode"]:checked') || {}).value || (this._fins.length ? 'fin' : 'manual')
      const payload = { amortization_amount: extra }
      if (mode === 'fin') {
        payload.financing_id = parseInt(g('am-fin-sel')?.value)
      } else {
        payload.manual_balance = parseFloat(g('am-balance')?.value)
        payload.manual_installment = parseFloat(g('am-inst')?.value)
        payload.manual_remaining_months = parseInt(g('am-months')?.value)
        payload.manual_annual_rate = parseFloat(g('am-rate')?.value)
        payload.manual_system = g('am-sys')?.value || 'PRICE'
      }
      const out = document.getElementById('am-out')
      if (out) out.innerHTML = '<div class="td-loading"><span></span><span></span><span></span></div>'
      try {
        const d = await vm.api('POST', 'amortizacao/simular', payload)
        if (d && d.upgrade) return void (out.innerHTML = this._upsell(d))
        this._renderResult(d)
      } catch (e) {
        const err = e.response?.data
        if (err && err.upgrade) { if (out) out.innerHTML = this._upsell(err); return }
        if (out) out.innerHTML = `<div class="td-notice" style="margin-top:16px"><i class="fas fa-triangle-exclamation"></i><div><span>${esc(err?.error || 'Não foi possível simular.')}</span></div></div>`
      }
    },

    _renderResult(d) {
      const out = document.getElementById('am-out')
      if (!out) return
      const o = d.original || {}, rp = d.reduce_payment || {}, rt = d.reduce_term || {}
      const rec = d.recommendation
      out.innerHTML = `
        <div class="am-notice"><i class="fas fa-lightbulb"></i><div><strong>${rec === 'reduce_term' ? 'Recomendado: reduzir o prazo' : 'Recomendado: reduzir a parcela'}</strong><span>${esc(d.reason || '')}</span></div></div>
        <div class="am-cards">
          <article class="am-card ${rec === 'reduce_payment' ? 'am-card--rec' : ''}">
            <div class="am-card__head"><span class="td-eyebrow">Cenário A</span><h3>Reduzir a parcela</h3>${rec === 'reduce_payment' ? '<span class="am-tag">recomendado</span>' : ''}</div>
            <div class="am-big">${money(rp.new_installment)}<em>/mês</em></div>
            <div class="am-rows">
              ${this._r('Economia mensal', money(rp.monthly_savings), 'ok')}
              ${this._r('Juros economizados', money(rp.interest_saved), 'ok')}
              ${this._r('Prazo', `${rp.remaining_months} meses (mantém)`, 'neutral')}
              ${this._r('Custo total', money(rp.total_cost), 'neutral')}
            </div>
          </article>
          <article class="am-card ${rec === 'reduce_term' ? 'am-card--rec' : ''}">
            <div class="am-card__head"><span class="td-eyebrow">Cenário B</span><h3>Reduzir o prazo</h3>${rec === 'reduce_term' ? '<span class="am-tag">recomendado</span>' : ''}</div>
            <div class="am-big">−${rt.months_saved} <em>meses</em></div>
            <div class="am-rows">
              ${this._r('Novo prazo', `${rt.remaining_months} meses`, 'ok')}
              ${this._r('Juros economizados', money(rt.interest_saved), 'ok')}
              ${this._r('Parcela', `${money(rt.new_installment)} (mantém)`, 'neutral')}
              ${this._r('Custo total', money(rt.total_cost), 'neutral')}
            </div>
          </article>
        </div>
        <div class="dg-kpis" style="margin-top:12px">
          ${this._kpi('Parcela hoje', money(o.installment))}
          ${this._kpi('Prazo hoje', `${o.remaining_months} meses`)}
          ${this._kpi('Juros sem amortizar', money(o.total_interest), 'neg')}
        </div>`
    },
    _r(lbl, val, tone) { return `<div class="am-row"><span>${esc(lbl)}</span><strong class="dg-kpi__val--${tone}">${val}</strong></div>` },
    _kpi(lbl, val, tone) { return `<div class="dg-kpi"><span class="dg-kpi__lbl">${esc(lbl)}</span><span class="dg-kpi__val dg-kpi__val--${tone || 'neutral'}">${val}</span></div>` },

    _upsell(d) {
      return `<section class="td-onboarding" style="margin-top:16px"><div class="td-onboarding__copy">
        <span class="td-eyebrow">Recurso Premium</span>
        <h2>Simulador de amortização.</h2>
        <p>${esc(d.error || 'Simular amortização extraordinária faz parte dos planos pagos.')}</p>
        <div class="td-onboarding__actions"><button class="td-button td-button--primary" onclick="VM.navigate('planos')"><i class="fas fa-arrow-up"></i> Ver planos</button></div>
      </div></section>`
    },

    _shell(inner) {
      return `<div class="td-dashboard am">
        <header class="td-dashboard__header">
          <div>
            <span class="td-eyebrow">Pague a mais, deva menos</span>
            <h1>Simulador de amortização. <em>Parcela menor ou dívida mais curta?</em></h1>
            <p>Um aporte extra hoje: veja os dois caminhos lado a lado e qual rende mais para você.</p>
          </div>
        </header>
        ${inner}
      </div>`
    }
  }
})()
