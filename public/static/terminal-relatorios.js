(function () {
  const esc = (v) => String(v ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;')
  const money = (v) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 2 }).format(Number(v) || 0)
  const safeColor = (c, fallback) => (typeof c === 'string' && /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(c.trim())) ? c.trim() : fallback
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

        <div class="rl-cols" style="margin-top:16px">
          <article class="td-panel">
            <div class="td-panel__head"><div><span class="td-eyebrow">Para onde foi</span><h2>Top categorias de despesas</h2></div></div>
            ${this._rankCats(d.top_categorias, Number(t.despesas) || 0)}
          </article>
          <article class="td-panel">
            <div class="td-panel__head"><div><span class="td-eyebrow">Seus rótulos</span><h2>Top tags do ano</h2></div></div>
            ${this._rankTags(d.top_tags, Number(t.despesas) || 0)}
          </article>
        </div>

        <div class="rl-cols" style="margin-top:16px">
          <article class="td-panel">
            <div class="td-panel__head"><div><span class="td-eyebrow">Ano vs ano</span><h2>Comparação ${d.ano} × ${d.ano - 1}</h2></div></div>
            ${this._cmp(d.comparativo)}
          </article>
          <article class="td-panel">
            <div class="td-panel__head"><div><span class="td-eyebrow">Olhando à frente</span><h2>Projeção para o restante do ano</h2></div></div>
            ${this._proj(d.projecao, d.ano)}
          </article>
        </div>

        <article class="td-panel" style="margin-top:16px">
          <div class="td-panel__head"><div><span class="td-eyebrow">Mês a mês</span><h2>Detalhamento mensal</h2></div></div>
          ${this._table(meses, d.ano, t)}
        </article>
      `)
    },

    _rankCats(cats, totDesp) {
      if (!cats || !cats.length) return '<div class="td-empty-row"><span>Sem despesas categorizadas neste ano.</span></div>'
      const max = Math.max(...cats.map(c => Number(c.total) || 0), 1)
      return `<ul class="rl-rank">${cats.map((c, i) => {
        const val = Number(c.total) || 0
        const pct = totDesp > 0 ? (val / totDesp * 100) : 0
        const w = (val / max * 100)
        return `<li class="rl-rank__it">
          <div class="rl-rank__top"><span class="rl-rank__name"><span class="rl-rank__pos">${i + 1}</span>${esc(c.categoria)}</span><span class="rl-rank__val">${money(val)}</span></div>
          <div class="rl-rank__bar"><span style="width:${w.toFixed(1)}%"></span></div>
          <div class="rl-rank__sub">${pct.toFixed(1)}% das despesas · ${c.qtd} ${Number(c.qtd) === 1 ? 'lançamento' : 'lançamentos'}</div>
        </li>`
      }).join('')}</ul>`
    },

    _rankTags(tags, totDesp) {
      if (!tags || !tags.length) return '<div class="td-empty-row"><span>Nenhuma tag usada em despesas neste ano.</span></div>'
      const max = Math.max(...tags.map(t => Number(t.total) || 0), 1)
      return `<ul class="rl-rank">${tags.map(t => {
        const cor = safeColor(t.cor, 'var(--terminal-accent)')
        const val = Number(t.total) || 0
        const pct = totDesp > 0 ? (val / totDesp * 100) : 0
        const w = (val / max * 100)
        return `<li class="rl-rank__it">
          <div class="rl-rank__top"><span class="rl-rank__name"><i class="rl-rank__dot" style="background:${cor}"></i>${esc(t.tag)}</span><span class="rl-rank__val">${money(val)}</span></div>
          <div class="rl-rank__bar"><span style="width:${w.toFixed(1)}%;background:${cor}"></span></div>
          <div class="rl-rank__sub">${pct.toFixed(1)}% das despesas · ${t.qtd} ${Number(t.qtd) === 1 ? 'lançamento' : 'lançamentos'}</div>
        </li>`
      }).join('')}</ul>`
    },

    _cmp(cmp) {
      if (!cmp) return '<div class="td-empty-row"><span>Sem dados de comparação.</span></div>'
      const a = cmp.atual || {}, b = cmp.anterior || {}
      const prevEmpty = !((Number(b.receitas) || 0) || (Number(b.despesas) || 0))
      const row = (lbl, cur, prev, good) => {
        cur = Number(cur) || 0; prev = Number(prev) || 0
        const diff = cur - prev
        const pct = prev !== 0 ? (diff / Math.abs(prev) * 100) : null
        let tone = 'neutral'
        if (Math.abs(diff) >= 0.01) tone = ((good === 'up') ? diff > 0 : diff < 0) ? 'ok' : 'neg'
        const arrow = diff > 0.009 ? '▲' : diff < -0.009 ? '▼' : '–'
        const pctTxt = pct === null ? '—' : `${pct > 0 ? '+' : ''}${pct.toFixed(0)}%`
        return `<tr>
          <td class="rl-cmp__lbl">${lbl}</td>
          <td class="rl-cmp__num">${money(prev)}</td>
          <td class="rl-cmp__num">${money(cur)}</td>
          <td class="rl-cmp__delta rl-cmp__delta--${tone}"><span class="rl-cmp__arr">${arrow}</span> ${money(Math.abs(diff))} <span class="rl-cmp__pct">${pctTxt}</span></td>
        </tr>`
      }
      return `<div class="rl-tablewrap"><table class="rl-cmp">
        <thead><tr><th></th><th>${cmp.ano_anterior}</th><th>${cmp.ano_atual}</th><th>Variação</th></tr></thead>
        <tbody>
          ${row('Receitas', a.receitas, b.receitas, 'up')}
          ${row('Despesas', a.despesas, b.despesas, 'down')}
          ${row('Saldo', a.saldo, b.saldo, 'up')}
        </tbody>
      </table></div>${prevEmpty ? `<p class="rl-note">Sem lançamentos em ${esc(cmp.ano_anterior)} para comparar — os números acima são só de ${esc(cmp.ano_atual)}.</p>` : ''}`
    },

    _proj(p, ano) {
      if (!p || !p.aplicavel) {
        const msg = (p && ano < p.ano_atual)
          ? `${ano} já está encerrado — o resultado acima é o número final do ano.`
          : (p && ano > p.ano_atual)
            ? `Ainda não há lançamentos em ${ano} para projetar.`
            : 'Ainda não há meses com movimento suficientes para projetar o restante do ano.'
        return `<div class="rl-proj rl-proj--na"><i class="fas fa-hourglass-half"></i><p>${msg}</p></div>`
      }
      const tone = p.proj_saldo_ano >= 0 ? 'ok' : 'neg'
      return `<div class="rl-proj">
        <div class="rl-proj__hero rl-proj__hero--${tone}">
          <span class="rl-proj__lbl">Saldo projetado ao fechar ${ano}</span>
          <strong class="rl-proj__val">${money(p.proj_saldo_ano)}</strong>
          <span class="rl-proj__sub">${p.meses_restantes} ${p.meses_restantes === 1 ? 'mês restante' : 'meses restantes'} · base na média de ${p.meses_com_dados} ${p.meses_com_dados === 1 ? 'mês' : 'meses'} com dados</span>
        </div>
        <div class="rl-proj__grid">
          <div class="rl-proj__cell"><span>Média mensal (saldo)</span><strong class="${p.media_saldo >= 0 ? 'is-ok' : 'is-neg'}">${money(p.media_saldo)}</strong></div>
          <div class="rl-proj__cell"><span>Receitas a entrar</span><strong class="is-ok">${money(p.proj_receitas_restante)}</strong></div>
          <div class="rl-proj__cell"><span>Despesas a vir</span><strong class="is-neg">${money(p.proj_despesas_restante)}</strong></div>
          <div class="rl-proj__cell"><span>Saldo restante estimado</span><strong class="${p.proj_saldo_restante >= 0 ? 'is-ok' : 'is-neg'}">${money(p.proj_saldo_restante)}</strong></div>
        </div>
        <p class="rl-note">Estimativa linear pela média dos meses com movimento — referência, não previsão garantida.</p>
      </div>`
    },

    _table(meses, ano, t) {
      const rows = meses.map(m => {
        const has = m.receitas > 0 || m.despesas > 0
        const tone = !has ? 'muted' : m.saldo >= 0 ? 'ok' : 'neg'
        const badge = !has
          ? '<span class="rl-badge rl-badge--muted">Sem dados</span>'
          : m.saldo >= 0
            ? '<span class="rl-badge rl-badge--ok"><i class="fas fa-circle-check"></i> Positivo</span>'
            : '<span class="rl-badge rl-badge--neg"><i class="fas fa-circle-xmark"></i> Negativo</span>'
        return `<tr class="rl-tr rl-tr--${tone}">
          <td class="rl-td-m">${esc(m.label)}/${ano}</td>
          <td class="rl-num rl-num--rec">${has ? money(m.receitas) : '—'}</td>
          <td class="rl-num rl-num--desp">${has ? money(m.despesas) : '—'}</td>
          <td class="rl-num rl-num--${tone}">${has ? money(m.saldo) : '—'}</td>
          <td class="rl-st">${badge}</td>
        </tr>`
      }).join('')
      const tt = t || {}
      const totTone = Number(tt.saldo) >= 0 ? 'ok' : 'neg'
      return `<div class="rl-tablewrap"><table class="rl-table">
        <thead><tr><th>Mês</th><th class="rl-num">Receitas</th><th class="rl-num">Despesas</th><th class="rl-num">Saldo</th><th class="rl-st">Status</th></tr></thead>
        <tbody>${rows}</tbody>
        <tfoot><tr class="rl-tr rl-tr--total">
          <td class="rl-td-m">Total ${ano}</td>
          <td class="rl-num rl-num--rec">${money(tt.receitas)}</td>
          <td class="rl-num rl-num--desp">${money(tt.despesas)}</td>
          <td class="rl-num rl-num--${totTone}">${money(tt.saldo)}</td>
          <td class="rl-st"></td>
        </tr></tfoot>
      </table></div>`
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

      // hover hit-areas (full-height per month) + highlight band
      const hits = meses.map((m, i) => {
        const sx = (pL + slotW * i).toFixed(1)
        return `<rect x="${sx}" y="${pT}" width="${slotW.toFixed(1)}" height="${pH.toFixed(1)}" fill="transparent" style="cursor:pointer" onmousemove="VMTerminalRelatorios._tip(event,${i})" onmouseenter="VMTerminalRelatorios._tip(event,${i})" onmouseleave="VMTerminalRelatorios._tipHide()"/>`
      }).join('')

      this._geo = { pL, slotW, pT, pH }

      return `<div class="rl-chartwrap"><div class="rl-tip" id="rl-tip"></div><svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Receitas e despesas mês a mês" style="display:block">
        ${grid}
        <rect id="rl-band" x="0" y="${pT}" width="${slotW.toFixed(1)}" height="${pH.toFixed(1)}" fill="var(--terminal-ink)" opacity="0" rx="4"/>
        ${bars}
        <polyline points="${linePts}" fill="none" stroke="var(--terminal-accent)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
        ${dots}
        ${xlabels}
        ${hits}
      </svg></div>
      <div class="cm-legend"><span><i style="background:var(--terminal-primary)"></i>Receitas</span><span><i style="background:var(--terminal-negative)"></i>Despesas</span><span><i style="background:var(--terminal-accent)"></i>Saldo</span></div>`
    },

    _tip(ev, i) {
      const tip = document.getElementById('rl-tip')
      if (!tip || !this._d) return
      const m = (this._d.meses || [])[i]
      if (!m) return
      const wrap = tip.parentElement
      const r = Number(m.receitas) || 0, dp = Number(m.despesas) || 0, s = Number(m.saldo) || 0
      const has = r > 0 || dp > 0
      const sCls = s >= 0 ? 'rl-tip__pos' : 'rl-tip__neg'
      tip.innerHTML = `<strong class="rl-tip__t">${esc(m.label)}</strong>` +
        (has
          ? `<span class="rl-tip__ln"><i style="background:var(--terminal-primary)"></i>Receitas <b>${money(r)}</b></span>` +
            `<span class="rl-tip__ln"><i style="background:var(--terminal-negative)"></i>Despesas <b>${money(dp)}</b></span>` +
            `<span class="rl-tip__ln rl-tip__sep"><i style="background:var(--terminal-accent)"></i>Saldo <b class="${sCls}">${money(s)}</b></span>`
          : `<span class="rl-tip__ln rl-tip__muted">Sem movimento neste mês</span>`)
      tip.classList.add('is-on')
      const rect = wrap.getBoundingClientRect()
      const x = ev.clientX - rect.left + (wrap.scrollLeft || 0)
      const y = ev.clientY - rect.top
      const half = tip.offsetWidth / 2
      const cx = Math.max(half + 4, Math.min(x, wrap.clientWidth - half - 4 + (wrap.scrollLeft || 0)))
      tip.style.left = cx + 'px'
      tip.style.top = Math.max(6, y - 14) + 'px'
      const band = document.getElementById('rl-band')
      if (band && this._geo) { band.setAttribute('x', (this._geo.pL + this._geo.slotW * i).toFixed(1)); band.setAttribute('opacity', '0.06') }
    },
    _tipHide() {
      const tip = document.getElementById('rl-tip'); if (tip) tip.classList.remove('is-on')
      const band = document.getElementById('rl-band'); if (band) band.setAttribute('opacity', '0')
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
