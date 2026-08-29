(function () {
  const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro']
  const ABREV = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']
  const esc = (v) => String(v ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;')
  const money = (v) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 2 }).format(Number(v) || 0)
  const shortMoney = (v) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', notation: 'compact', maximumFractionDigits: 1 }).format(Number(v) || 0)
  const COLORS = ['#3DDC84', '#F2C94C', '#6EA8FE', '#B58AF4', '#FF8C69', '#8BA397']

  window.VMTerminalAportes = {
    async render(vm, mes, ano) {
      this._vm = vm
      const now = new Date()
      this._mes = Number(mes || this._mes || now.getMonth() + 1)
      this._ano = Number(ano || this._ano || now.getFullYear())
      const content = document.getElementById('page-content')
      if (!content) return
      document.body.classList.add('terminal-dashboard-active')
      content.innerHTML = '<div class="td-loading"><span></span><span></span><span></span></div>'
      try {
        this._data = await vm.api('GET', `aportes?mes=${this._mes}&ano=${this._ano}`)
        this._paint()
      } catch (e) {
        content.innerHTML = `<div class="td-error"><i class="fas fa-triangle-exclamation"></i><h2>Não foi possível carregar os Aportes</h2><p>${esc(e.response?.data?.error || 'Tente novamente.')}</p><button class="td-button td-button--primary" onclick="VM.pageAportes()">Tentar novamente</button></div>`
      }
    },
    reload() { this.render(this._vm, this._mes, this._ano) },

    _paint() {
      const content = document.getElementById('page-content')
      if (!content) return
      const d = this._data
      const r = d.resumo || {}
      const destinos = d.por_destino || []
      const totalDest = destinos.reduce((s, x) => s + Number(x.total || 0), 0)

      content.innerHTML = `<div class="td-dashboard ap">
        <header class="td-dashboard__header">
          <div>
            <span class="td-eyebrow">Para onde vai o dinheiro</span>
            <h1>Aportes. <em>Saiu da conta, virou seu.</em></h1>
            <p>O que você tirou da conta corrente e transformou em patrimônio.</p>
          </div>
          <div class="td-dashboard__header-actions">
            <label class="ac-select"><span>Mês</span><select onchange="VMTerminalAportes.setMes(this.value)">${MESES.map((m, i) => `<option value="${i + 1}" ${this._mes === i + 1 ? 'selected' : ''}>${m}</option>`).join('')}</select></label>
            <label class="ac-select"><span>Ano</span><select onchange="VMTerminalAportes.setAno(this.value)">${this._anos().map(y => `<option value="${y}" ${this._ano === y ? 'selected' : ''}>${y}</option>`).join('')}</select></label>
          </div>
        </header>

        <section class="tm-kpis">
          <article class="td-kpi"><span>Aportado no mês</span><strong>${money(r.total_mes)}</strong><span class="td-kpi__delta td-kpi__delta--muted">${r.qtd_mes || 0} aporte(s) em ${ABREV[this._mes - 1]}</span></article>
          <article class="td-kpi"><span>Aportado em ${this._ano}</span><strong>${money(r.total_ano)}</strong><span class="td-kpi__delta td-kpi__delta--muted">${r.qtd_ano || 0} aporte(s) no ano</span></article>
          <article class="td-kpi"><span>Em investimentos</span><strong>${shortMoney(r.patrimonio_investimentos)}</strong><span class="td-kpi__delta td-kpi__delta--muted">posição atual</span></article>
          <article class="td-kpi"><span>Em reservas</span><strong>${shortMoney(r.patrimonio_reservas)}</strong><span class="td-kpi__delta td-kpi__delta--muted">posição atual</span></article>
        </section>

        <section class="ac-chart-wrap">
          <article class="td-panel">
            <div class="td-panel__head"><div><span class="td-eyebrow">Últimos 12 meses</span><h2>Evolução dos aportes</h2></div></div>
            ${this._chart(d.evolucao || [])}
          </article>
          <article class="td-panel">
            <div class="td-panel__head"><div><span class="td-eyebrow">Em ${this._ano}</span><h2>Para onde foi</h2></div></div>
            ${destinos.length && totalDest > 0 ? `
              <div class="ti-aloc__bar">${destinos.map((x, i) => `<span style="width:${Math.max(2, (Number(x.total) / totalDest) * 100)}%;background:${COLORS[i % COLORS.length]}" title="${esc(x.destino)}: ${money(x.total)}"></span>`).join('')}</div>
              <div class="ti-aloc__list">${destinos.map((x, i) => `<div><i style="background:${COLORS[i % COLORS.length]}"></i><span>${esc(x.destino)}</span><em>${Math.round((Number(x.total) / totalDest) * 100)}%</em><b>${money(x.total)}</b></div>`).join('')}</div>
            ` : '<div class="td-empty-row"><i class="fas fa-chart-pie"></i><span>Sem aportes registrados neste ano.</span></div>'}
          </article>
        </section>

        <article class="td-panel" style="margin-top:14px">
          <div class="td-panel__head"><div><span class="td-eyebrow">${MESES[this._mes - 1]} de ${this._ano}</span><h2>Aportes do mês</h2></div><button onclick="VM.navigate('investimentos')">Ver carteira</button></div>
          ${(d.aportes || []).length ? `<div class="ap-list">${d.aportes.map(a => this._row(a)).join('')}</div>` : '<div class="td-empty-row"><i class="fas fa-seedling"></i><span>Nenhum aporte neste mês. Aportes vêm do fluxo de Investimentos e Reservas.</span></div>'}
        </article>

        <p class="to-global__explain" style="margin-top:12px"><i class="fas fa-circle-info"></i> ${esc(d.explicacao || '')} Os cards de patrimônio mostram a posição de hoje — não o resultado direto dos aportes deste ano.</p>
      </div>`
    },

    _row(a) {
      const dt = a.data ? new Date(`${String(a.data).slice(0, 10)}T12:00:00`) : null
      const dlabel = dt && !Number.isNaN(dt.getTime()) ? dt.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }).replace('.', '') : '—'
      return `<div class="ap-row">
        <span class="ap-row__date">${dlabel}</span>
        <span class="ap-row__main"><strong>${esc(a.descricao)}</strong><small>${esc(a.subcategoria || a.categoria || 'Aporte')}</small></span>
        <span class="ap-row__val">${money(a.valor)}</span>
      </div>`
    },

    _chart(evol) {
      // AP2: montar 12 meses de verdade (preenchendo os vazios com zero e com o
      // ano no rótulo) — antes o gráfico só tinha os meses com aporte, colados.
      const map = {}
      for (const e of evol) map[e.ym] = Number(e.total || 0)
      const cols = []
      const base = new Date(this._ano, this._mes - 1, 1)
      for (let i = 11; i >= 0; i--) {
        const d = new Date(base.getFullYear(), base.getMonth() - i, 1)
        const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
        cols.push({ label: ABREV[d.getMonth()], sub: String(d.getFullYear()).slice(2), total: map[ym] || 0 })
      }
      const max = Math.max(1, ...cols.map(c => c.total))
      return `<div class="ac-chart">${cols.map(c => `
        <div class="ac-chart__col" title="${c.label}/${c.sub}: ${money(c.total)}">
          <div class="ac-chart__bar"><span style="height:${Math.max(2, (c.total / max) * 100)}%"></span></div>
          <small class="ac-chart__val">${c.total > 0 ? shortMoney(c.total) : '—'}</small>
          <small class="ac-chart__lbl">${c.label}/${c.sub}</small>
        </div>`).join('')}</div>`
    },

    _anos() {
      const y = new Date().getFullYear()
      return [y - 2, y - 1, y, y + 1]
    },
    setMes(m) { this.render(this._vm, Number(m), this._ano) },
    setAno(a) { this.render(this._vm, this._mes, Number(a)) }
  }
})()
