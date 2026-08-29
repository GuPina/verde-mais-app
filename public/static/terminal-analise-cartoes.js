(function () {
  const esc = (v) => String(v ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;')
  const money = (v) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 2 }).format(Number(v) || 0)
  const shortMoney = (v) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', notation: 'compact', maximumFractionDigits: 1 }).format(Number(v) || 0)

  window.VMTerminalAnaliseCartoes = {
    _meses: 12, _cartao: '',
    async render(vm) {
      this._vm = vm
      const content = document.getElementById('page-content')
      if (!content) return
      document.body.classList.add('terminal-dashboard-active')
      content.innerHTML = '<div class="td-loading"><span></span><span></span><span></span></div>'
      try {
        const q = `cartoes/analise?meses=${this._meses}${this._cartao ? `&cartao_id=${this._cartao}` : ''}`
        this._data = await vm.api('GET', q)
        this._paint()
      } catch (e) {
        content.innerHTML = `<div class="td-error"><i class="fas fa-triangle-exclamation"></i><h2>Não foi possível carregar a Análise</h2><p>${esc(e.response?.data?.error || 'Tente novamente.')}</p><button class="td-button td-button--primary" onclick="VM.pageAnaliseCartoes()">Tentar novamente</button></div>`
      }
    },
    reload() { this.render(this._vm) },

    _paint() {
      const content = document.getElementById('page-content')
      if (!content) return
      const d = this._data
      const r = d.resumo || {}
      const cartoes = d.cartoes || []
      // AC8: cortar a janela no primeiro mês com dado (não mostrar 7 colunas zero)
      const serieFull = d.serie || []
      const firstIdx = serieFull.findIndex(s => s.total > 0 || s.lancamentos > 0)
      const serie = firstIdx >= 0 ? serieFull.slice(firstIdx) : []
      const comprometimento = r.comprometimento_pct

      content.innerHTML = `<div class="td-dashboard ac">
        <header class="td-dashboard__header">
          <div>
            <span class="td-eyebrow">Cartões · leitura do histórico</span>
            <h1>Análise de cartões. <em>A fatura está subindo?</em></h1>
            <p>Como sua fatura evolui e quanto dos próximos meses você já comprometeu.</p>
          </div>
          <div class="td-dashboard__header-actions">
            <label class="ac-select"><span>Cartão</span><select onchange="VMTerminalAnaliseCartoes.setCartao(this.value)"><option value="">Todos</option>${cartoes.map(c => `<option value="${c.id}" ${String(this._cartao) === String(c.id) ? 'selected' : ''}>${esc(c.nome)}</option>`).join('')}</select></label>
            <label class="ac-select"><span>Período</span><select onchange="VMTerminalAnaliseCartoes.setMeses(this.value)">${[6, 12, 18, 24].map(m => `<option value="${m}" ${this._meses === m ? 'selected' : ''}>${m} meses</option>`).join('')}</select></label>
          </div>
        </header>

        <section class="tm-kpis" style="grid-template-columns:repeat(3,1fr)">
          <article class="td-kpi"><span>Fatura atual</span><strong>${money(r.fatura_atual)}</strong><span class="td-kpi__delta td-kpi__delta--muted">média 6m ${money(r.media_6m)}</span></article>
          <article class="td-kpi td-kpi--score"><span>Uso do limite</span><strong>${comprometimento == null ? '—' : `${comprometimento}<small>%</small>`}</strong>${this._usoChip(comprometimento)}</article>
          <article class="td-kpi"><span>Já comprometido à frente</span><strong>${money(d.futuro?.total_comprometido)}</strong><span class="td-kpi__delta td-kpi__delta--muted">${(d.futuro?.meses || []).length} mês(es) com parcelas</span></article>
        </section>

        <section class="ac-chart-wrap">
          <article class="td-panel">
            <div class="td-panel__head"><div><span class="td-eyebrow">Evolução da fatura</span><h2>Últimos ${serie.length} meses</h2></div></div>
            ${this._chart(serie)}
          </article>
          <article class="td-panel ac-future">
            <div class="td-panel__head"><div><span class="td-eyebrow">Parcelas já contratadas</span><h2>Meses que ainda vão chegar</h2></div></div>
            ${(d.futuro?.meses || []).length ? `<div class="ac-future__list">${d.futuro.meses.map(f => `<div><span>${esc(f.label)}</span><b>${money(f.total)}</b></div>`).join('')}</div>${d.futuro.pior_mes ? `<p class="td-explainer"><i class="fas fa-circle-info"></i> Mês mais pesado: <b>${esc(d.futuro.pior_mes.label)}</b> com ${money(d.futuro.pior_mes.total)}.</p>` : ''}` : '<div class="td-empty-row"><i class="far fa-calendar-check"></i><span>Nenhuma parcela futura contratada.</span></div>'}
          </article>
        </section>

        <section class="ac-bottom">
          <article class="td-panel">
            <div class="td-panel__head"><div><span class="td-eyebrow">Este mês</span><h2>Por categoria</h2></div></div>
            ${(d.categorias_do_mes || []).length ? `<div class="ac-cats">${d.categorias_do_mes.map(c => `<div><span>${esc(c.categoria)}</span><b>${money(c.total)}</b><small>${c.qtd}×</small></div>`).join('')}</div>` : '<div class="td-empty-row"><i class="fas fa-tags"></i><span>Sem lançamentos categorizados este mês.</span></div>'}
          </article>
          <article class="td-panel">
            <div class="td-panel__head"><div><span class="td-eyebrow">Assinaturas fantasma</span><h2>Cobranças recorrentes</h2></div></div>
            ${(d.recorrentes || []).length ? `<div class="ac-rec">${d.recorrentes.map(r2 => `<div><span>${esc(r2.descricao)}</span><em>em ${r2.meses} meses</em><b>${money(r2.valor)}</b></div>`).join('')}</div>` : '<div class="td-empty-row"><i class="fas fa-ghost"></i><span>Nenhuma cobrança recorrente detectada.</span></div>'}
          </article>
        </section>

        ${(d.leitura || []).length ? `<section class="ac-leitura">${d.leitura.map(l => `<p><i class="fas fa-lightbulb"></i> ${esc(l)}</p>`).join('')}</section>` : ''}
      </div>`
    },

    _usoChip(pct) {
      if (pct == null) return '<span class="td-kpi__delta td-kpi__delta--muted">sem limite definido</span>'
      // AC9: acima de 100% pede outra mensagem, não a frase padrão de crédito
      if (pct > 100) return '<span class="td-kpi__delta td-kpi__delta--negative">acima do limite somado</span>'
      if (pct > 30) return '<span class="td-kpi__delta td-kpi__delta--negative">acima de 30% pesa no crédito</span>'
      return '<span class="td-kpi__delta td-kpi__delta--positive">dentro do saudável</span>'
    },

    _chart(serie) {
      if (!serie.length) return '<div class="td-empty-row"><i class="fas fa-chart-column"></i><span>Sem histórico de fatura ainda.</span></div>'
      const totals = serie.map(s => s.total)
      const sorted = [...totals].sort((a, b) => b - a)
      // AC5: um lançamento fora de escala (ex.: R$ 1M) achatava os 11 meses normais.
      // Escala pelo 2º maior quando o topo é um outlier (>2,5× o segundo); a barra
      // do outlier satura em 100% e ganha um marcador "fora de escala".
      const max = sorted[0] || 1
      const second = sorted[1] || 0
      const outlier = second > 0 && max > second * 2.5
      const scaleMax = (outlier ? second : max) * 1.12 || 1
      return `<div class="ac-chart">${serie.map(s => {
        const isOut = outlier && s.total === max
        const h = Math.max(2, Math.min(100, (s.total / scaleMax) * 100))
        const up = s.variacao_pct != null && s.variacao_pct > 0
        return `<div class="ac-chart__col" title="${esc(s.label)}: ${money(s.total)}${s.variacao_pct != null ? ` (${up ? '+' : ''}${s.variacao_pct}%)` : ''}">
          <div class="ac-chart__bar"><span class="${isOut ? 'is-out' : ''}" style="height:${h}%">${isOut ? '<i class="fas fa-bolt" title="fora de escala"></i>' : ''}</span></div>
          <small class="ac-chart__val">${shortMoney(s.total)}</small>
          <small class="ac-chart__lbl">${esc(s.label)}</small>
        </div>`
      }).join('')}</div>${outlier ? '<p class="td-explainer"><i class="fas fa-bolt"></i> Um mês fora de escala foi limitado para não achatar os demais.</p>' : ''}`
    },

    setMeses(m) { this._meses = Number(m) || 12; this.reload() },
    setCartao(c) { this._cartao = c || ''; this.reload() }
  }
})()
