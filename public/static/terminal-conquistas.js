(function () {
  const esc = (v) => String(v ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;')
  const RAR = { comum: 'Comum', raro: 'Raro', epico: 'Épico', lendario: 'Lendário', lendária: 'Lendário' }

  window.VMTerminalConquistas = {
    async render(vm) {
      this._vm = vm
      const content = document.getElementById('page-content')
      if (!content) return
      document.body.classList.add('terminal-dashboard-active')
      content.innerHTML = '<div class="td-loading"><span></span><span></span><span></span></div>'
      try {
        this._d = await vm.api('GET', 'conquistas')
        this._paint()
        vm.api('PATCH', 'conquistas/visualizar').catch(() => {})
      } catch (e) {
        content.innerHTML = `<div class="td-error"><i class="fas fa-triangle-exclamation"></i><h2>Não foi possível carregar as conquistas</h2><p>${esc(e.response?.data?.error || 'Tente novamente.')}</p><button class="td-button td-button--primary" onclick="VMTerminalConquistas.reload()">Tentar novamente</button></div>`
      }
    },
    reload() { this.render(this._vm) },

    _paint() {
      const content = document.getElementById('page-content')
      if (!content) return
      const d = this._d
      const list = (d.conquistas || []).slice().sort((a, b) => (b.conquistada - a.conquistada) || (b.pontos - a.pontos))
      const feitas = Number(d.total_conquistadas) || 0
      const total = Number(d.total_disponivel) || list.length
      const pct = total > 0 ? Math.round((feitas / total) * 100) : 0

      content.innerHTML = this._shell(`
        <section class="fe-hero">
          <div class="fe-hero__main">
            <span class="td-eyebrow">Pontos acumulados</span>
            <div class="fe-hero__big">${Number(d.total_pontos) || 0} <em style="font-size:16px;color:var(--terminal-ink-soft);font-style:normal">pts</em></div>
            <p>${feitas} de ${total} conquistas desbloqueadas</p>
          </div>
          <div class="fe-hero__gauge">
            <div class="to-bar" style="height:12px"><span style="width:${pct}%;background:var(--terminal-primary)"></span></div>
            <div class="fe-hero__nums"><span class="to-status to-status--ok">${pct}% completo</span></div>
          </div>
        </section>

        <div class="cq-grid">${list.map(c => this._card(c)).join('')}</div>
      `)
    },

    _card(c) {
      const on = !!c.conquistada
      const prog = c.progresso
      const rar = RAR[String(c.raridade || '').toLowerCase()] || (c.raridade || '')
      return `<article class="cq-card ${on ? 'cq-card--on' : 'cq-card--off'}">
        <div class="cq-card__ic">${esc(c.icone || '🏆')}</div>
        <div class="cq-card__body">
          <div class="cq-card__top"><strong>${esc(c.titulo || c.codigo)}</strong><span class="cq-pts">${Number(c.pontos) || 0} pts</span></div>
          <p>${esc(c.descricao || '')}</p>
          ${!on && prog && prog.total ? `<div class="cq-prog"><div class="to-bar" style="height:6px"><span style="width:${Math.min(100, prog.pct || 0)}%;background:var(--terminal-accent)"></span></div><small>${prog.atual}/${prog.total}</small></div>` : ''}
          <div class="cq-card__foot">${rar ? `<span class="cq-rar cq-rar--${String(c.raridade || '').toLowerCase()}">${esc(rar)}</span>` : ''}${on ? '<span class="cq-done">✓ conquistada</span>' : '<span class="cq-lock"><i class="fas fa-lock"></i> bloqueada</span>'}</div>
        </div>
      </article>`
    },

    _shell(inner) {
      return `<div class="td-dashboard cq">
        <header class="td-dashboard__header">
          <div>
            <span class="td-eyebrow">Cada passo conta</span>
            <h1>Conquistas. <em>Seu progresso, recompensado.</em></h1>
            <p>Metas batidas, hábitos criados, dívidas quitadas — o VerdeMais celebra cada avanço seu.</p>
          </div>
        </header>
        ${inner}
      </div>`
    }
  }
})()
