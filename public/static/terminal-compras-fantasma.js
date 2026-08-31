(function () {
  const esc = (v) => String(v ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;')
  const money = (v) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 2 }).format(Number(v) || 0)
  const dfmt = (d) => { const x = new Date(String(d || '').slice(0, 10) + 'T12:00:00'); return Number.isNaN(x.getTime()) ? '' : x.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }).replace('.', '') }

  window.VMTerminalComprasFantasma = {
    async render(vm) {
      this._vm = vm
      const content = document.getElementById('page-content')
      if (!content) return
      document.body.classList.add('terminal-dashboard-active')
      content.innerHTML = '<div class="td-loading"><span></span><span></span><span></span></div>'
      try {
        this._d = await vm.api('GET', 'compras-fantasma')
        this._paint()
      } catch (e) {
        content.innerHTML = `<div class="td-error"><i class="fas fa-triangle-exclamation"></i><h2>Não foi possível carregar</h2><p>${esc(e.response?.data?.error || 'Tente novamente.')}</p><button class="td-button td-button--primary" onclick="VMTerminalComprasFantasma.reload()">Tentar novamente</button></div>`
      }
    },
    reload() { this.render(this._vm) },

    _paint() {
      const content = document.getElementById('page-content')
      if (!content) return
      const d = this._d, r = d.resumo || {}
      const compras = d.compras_impulsivas || []
      const cats = d.categorias_impulsivas || []
      const pct = Number(r.percentual_impulsivo) || 0
      const tone = pct > 40 ? 'neg' : pct > 20 ? 'warn' : 'ok'

      content.innerHTML = this._shell(`
        <section class="fe-hero">
          <div class="fe-hero__main">
            <span class="td-eyebrow">Gasto potencialmente impulsivo</span>
            <div class="fe-hero__big">${money(r.total_impulsivo)}</div>
            <p>${r.qtd_impulsivas || compras.length} compra(s) em ${esc(r.periodo || '3 meses')} · economia potencial ${money(r.economia_potencial)}</p>
          </div>
          <div class="fe-hero__gauge">
            <div class="to-bar" style="height:12px"><span style="width:${Math.min(100, pct)}%;background:var(--terminal-${tone === 'ok' ? 'primary' : tone === 'warn' ? 'accent' : 'negative'})"></span></div>
            <div class="fe-hero__nums"><span class="to-status to-status--${tone === 'ok' ? 'ok' : 'warn'}">${pct.toFixed(0)}% dos gastos</span><small>meta: abaixo de 20%</small></div>
          </div>
        </section>

        ${(d.alertas || []).length ? `<article class="td-panel" style="margin-top:16px"><div class="dg-alertas">${d.alertas.map(a => `<div class="dg-alerta"><i class="fas fa-triangle-exclamation"></i><div><span>${esc(a)}</span></div></div>`).join('')}</div></article>` : ''}

        ${cats.length ? `<article class="td-panel" style="margin-top:16px">
          <div class="td-panel__head"><div><span class="td-eyebrow">Por tipo</span><h2>Onde o impulso pesa mais</h2></div></div>
          <div class="rg-top">${cats.map(c => { const max = Math.max(...cats.map(x => Number(x.total) || 0), 1); return `<div class="rg-top__row"><span class="rg-top__cat">${esc(c.emoji || '')} ${esc(c.categoria)}</span><div class="rg-top__track"><span style="width:${(Number(c.total) / max * 100).toFixed(0)}%;background:var(--terminal-accent)"></span></div><span class="rg-top__val">${money(c.total)}</span></div>` }).join('')}</div>
        </article>` : ''}

        <article class="td-panel" style="margin-top:16px">
          <div class="td-panel__head"><div><span class="td-eyebrow">Detalhe</span><h2>Compras marcadas</h2></div></div>
          <div class="cf-list">${compras.length ? compras.map(c => this._row(c)).join('') : '<div class="td-empty-row"><span>Nenhuma compra impulsiva detectada. 🎉</span></div>'}</div>
        </article>

        ${(d.dicas || []).length ? `<article class="td-panel" style="margin-top:16px"><div class="td-panel__head"><div><span class="td-eyebrow">Como reduzir</span><h2>Dicas</h2></div></div><ul class="pj-insights">${d.dicas.map(x => `<li>${esc(x)}</li>`).join('')}</ul></article>` : ''}
      `)
    },

    _row(c) {
      const score = Number(c.score_impulso ?? c.impulsive_score) || 0
      const tone = score >= 75 ? 'neg' : score >= 50 ? 'warn' : 'neutral'
      return `<div class="cf-row">
        <span class="cf-emoji">${esc(c.emoji || '❓')}</span>
        <div class="cf-main"><strong>${esc(c.descricao)}</strong><small>${esc(c.tipo_impulso || c.categoria)}${c.data ? ' · ' + dfmt(c.data) : ''}</small></div>
        <span class="cf-score cf-score--${tone}">${score}</span>
        <span class="cf-val">${money(c.valor)}</span>
      </div>`
    },

    _shell(inner) {
      return `<div class="td-dashboard cf">
        <header class="td-dashboard__header">
          <div>
            <span class="td-eyebrow">O gasto que não te serve</span>
            <h1>Compras fantasma. <em>O impulso, na conta certa.</em></h1>
            <p>O VerdeMais identifica os gastos por impulso dos últimos meses e mostra quanto dá para economizar.</p>
          </div>
        </header>
        ${inner}
      </div>`
    }
  }
})()
