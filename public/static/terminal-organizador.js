(function () {
  const esc = (v) => String(v ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;')
  const money = (v) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 2 }).format(Number(v) || 0)

  window.VMTerminalOrganizador = {
    async render(vm) {
      this._vm = vm
      const content = document.getElementById('page-content')
      if (!content) return
      document.body.classList.add('terminal-dashboard-active')
      content.innerHTML = '<div class="td-loading"><span></span><span></span><span></span></div>'
      try {
        const c = await vm.api('GET', 'organizador/categorias')
        this._cats = c.categorias || []
        this._paint()
      } catch (e) {
        content.innerHTML = `<div class="td-error"><i class="fas fa-triangle-exclamation"></i><h2>Não foi possível carregar</h2><p>${esc(e.response?.data?.error || 'Tente novamente.')}</p><button class="td-button td-button--primary" onclick="VMTerminalOrganizador.reload()">Tentar novamente</button></div>`
      }
    },
    reload() { this.render(this._vm) },

    _paint() {
      const content = document.getElementById('page-content')
      if (!content) return
      const cats = this._cats
      const comDup = cats.filter(c => c.tem_duplicata)
      const totalValor = cats.reduce((s, c) => s + (Number(c.total_valor) || 0), 0)

      content.innerHTML = this._shell(`
        <div class="dg-kpis">
          ${this._kpi('Categorias', String(cats.length))}
          ${this._kpi('Possíveis duplicatas', String(comDup.length), comDup.length ? 'warn' : 'ok')}
          ${this._kpi('Total classificado', money(totalValor))}
        </div>

        ${comDup.length ? `
        <article class="td-panel" style="margin-top:16px">
          <div class="td-panel__head"><div><span class="td-eyebrow">Limpeza sugerida</span><h2>Categorias parecidas</h2></div></div>
          <div class="or-dups">${comDup.map(c => this._dupRow(c)).join('')}</div>
        </article>` : ''}

        <article class="td-panel" style="margin-top:16px">
          <div class="td-panel__head"><div><span class="td-eyebrow">Todas as categorias</span><h2>${cats.length} em uso</h2></div></div>
          <div class="or-list">
            ${cats.map(c => this._row(c)).join('')}
          </div>
        </article>
      `)
    },

    _kpi(lbl, val, tone) { return `<div class="dg-kpi"><span class="dg-kpi__lbl">${esc(lbl)}</span><span class="dg-kpi__val dg-kpi__val--${tone || 'neutral'}">${val}</span></div>` },

    _dupRow(c) {
      const sims = (c.possiveis_duplicatas || [])
      return `<div class="or-dup">
        <div class="or-dup__main"><strong>${esc(c.categoria)}</strong><small>parecida com: ${sims.map(s => esc(s)).join(', ')}</small></div>
        <button class="td-button td-button--sm" onclick="VMTerminalOrganizador.mesclar('${esc(c.categoria).replace(/'/g, '')}')"><i class="fas fa-object-group"></i> Unificar</button>
      </div>`
    },

    _row(c) {
      const max = Math.max(...this._cats.map(x => Number(x.total_valor) || 0), 1)
      const w = (Number(c.total_valor) || 0) / max * 100
      return `<div class="or-cat">
        <div class="or-cat__id"><strong>${esc(c.categoria || 'Sem categoria')}</strong>${c.tem_duplicata ? '<span class="or-flag">dup?</span>' : ''}</div>
        <div class="or-cat__bar"><div class="to-bar" style="height:7px"><span style="width:${w.toFixed(0)}%;background:var(--terminal-primary)"></span></div></div>
        <span class="or-cat__meta">${c.total_despesas} lanç. · ${money(c.total_valor)}</span>
        <button class="td-icon-btn" title="Renomear" onclick="VMTerminalOrganizador.renomear('${esc(c.categoria).replace(/'/g, '')}')"><i class="fas fa-pen"></i></button>
      </div>`
    },

    async mesclar(destino) {
      const vm = this._vm
      const cat = this._cats.find(c => c.categoria === destino)
      const lista = (cat && cat.possiveis_duplicatas) || []
      if (!lista.length) return
      if (!window.confirm(`Unificar ${lista.map(x => `"${x}"`).join(', ')} em "${destino}"? Os lançamentos passam todos para "${destino}".`)) return
      const r = await vm.api('POST', 'organizador/mesclar', { categorias_origem: lista, categoria_destino: destino }).catch(e => ({ error: e.response?.data?.error }))
      if (r && (r.success || r.message)) { vm.toast('Categorias unificadas.', 'success'); this.reload() }
      else vm.toast(r?.error || 'Erro ao unificar.', 'error')
    },
    async renomear(atual) {
      const vm = this._vm
      const novo = window.prompt(`Renomear a categoria "${atual}" para:`, atual)
      if (novo === null) return
      const nome = novo.trim()
      if (!nome || nome === atual) return
      const r = await vm.api('POST', 'organizador/renomear', { categoria_antiga: atual, categoria_nova: nome, nome_antigo: atual, nome_novo: nome }).catch(e => ({ error: e.response?.data?.error }))
      if (r && (r.success || r.message)) { vm.toast('Categoria renomeada.', 'success'); this.reload() }
      else vm.toast(r?.error || 'Erro ao renomear.', 'error')
    },

    _shell(inner) {
      return `<div class="td-dashboard or">
        <header class="td-dashboard__header">
          <div>
            <span class="td-eyebrow">Casa arrumada</span>
            <h1>Central de organização. <em>Sem categoria repetida.</em></h1>
            <p>Encontre categorias duplicadas, unifique o que é a mesma coisa e mantenha seus relatórios limpos.</p>
          </div>
        </header>
        ${inner}
      </div>`
    }
  }
})()
