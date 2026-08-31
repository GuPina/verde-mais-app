(function () {
  const esc = (v) => String(v ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;')
  const money = (v) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 2 }).format(Number(v) || 0)
  const shortMoney = (v) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', notation: 'compact', maximumFractionDigits: 1 }).format(Number(v) || 0)
  const PALETA = ['#3DDC84', '#F2C94C', '#8B5CF6', '#3B82F6', '#EC4899', '#F97316', '#06B6D4', '#84CC16']
  const corDe = (c, i) => (c && c !== '#000000' && c !== 'null') ? c : PALETA[i % PALETA.length]

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
      const uso = d.uso_total || {}
      const serieFull = d.serie || []
      const firstIdx = serieFull.findIndex(s => s.total > 0 || s.lancamentos > 0)
      const serie = firstIdx >= 0 ? serieFull.slice(firstIdx) : []

      content.innerHTML = `<div class="td-dashboard ac">
        <header class="td-dashboard__header">
          <div>
            <span class="td-eyebrow">Cartões · leitura do histórico</span>
            <h1>Análise de cartões. <em>A fatura está subindo?</em></h1>
            <p>Como sua fatura evolui, quanto do limite você já usa e quanto dos próximos meses já comprometeu.</p>
          </div>
          <div class="td-dashboard__header-actions">
            <label class="ac-select"><span>Cartão</span><select onchange="VMTerminalAnaliseCartoes.setCartao(this.value)"><option value="">Todos</option>${cartoes.map(c => `<option value="${c.id}" ${String(this._cartao) === String(c.id) ? 'selected' : ''}>${esc(c.nome)}</option>`).join('')}</select></label>
            <label class="ac-select"><span>Período</span><select onchange="VMTerminalAnaliseCartoes.setMeses(this.value)">${[6, 12, 18, 24].map(m => `<option value="${m}" ${this._meses === m ? 'selected' : ''}>${m} meses</option>`).join('')}</select></label>
          </div>
        </header>

        <section class="tm-kpis" style="grid-template-columns:repeat(3,1fr)">
          <article class="td-kpi"><span>Fatura atual</span><strong>${money(r.fatura_atual)}</strong><span class="td-kpi__delta td-kpi__delta--muted">média 6m ${money(r.media_6m)}</span></article>
          <article class="td-kpi"><span>Limite total usado</span><strong>${uso.pct == null ? '—' : `${uso.pct}<small>%</small>`}</strong><span class="td-kpi__delta td-kpi__delta--muted">${money(uso.utilizado)} de ${money(uso.limite)}</span></article>
          <article class="td-kpi"><span>Já comprometido à frente</span><strong>${money(d.futuro?.total_comprometido)}</strong><span class="td-kpi__delta td-kpi__delta--muted">${(d.futuro?.meses || []).length} mês(es) com parcelas</span></article>
        </section>

        <section class="ac-uso">
          <article class="td-panel ac-gauge-panel">
            <div class="td-panel__head"><div><span class="td-eyebrow">Mostrador</span><h2>Limite usado — todos os cartões</h2></div></div>
            ${this._gauge(uso)}
          </article>
          <article class="td-panel">
            <div class="td-panel__head"><div><span class="td-eyebrow">Por cartão</span><h2>Quanto de cada limite você já usa</h2></div></div>
            ${this._usoPorCartao(d.cartoes_uso || [])}
          </article>
        </section>

        <section class="ac-chart-wrap">
          <article class="td-panel">
            <div class="td-panel__head"><div><span class="td-eyebrow">Evolução da fatura${!this._cartao && (d.por_cartao || []).length > 1 ? ' · empilhada por cartão' : ''}</span><h2>Últimos ${serie.length} meses</h2></div></div>
            ${this._chart(serie, d.por_cartao || [])}
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

    // ── Mostrador circular do uso total ──
    _gauge(uso) {
      const pct = Number(uso.pct)
      if (uso.pct == null || !(Number(uso.limite) > 0)) return '<div class="td-empty-row"><i class="fas fa-gauge"></i><span>Defina o limite dos seus cartões para ver o mostrador.</span></div>'
      const cor = pct <= 30 ? 'var(--terminal-primary)' : pct <= 60 ? 'var(--terminal-accent)' : 'var(--terminal-negative)'
      const R = 54, C = 2 * Math.PI * R
      const off = C * (1 - Math.min(100, Math.max(0, pct)) / 100)
      const lbl = pct <= 30 ? 'dentro do saudável' : pct <= 60 ? 'atenção — acima de 30% pesa no crédito' : 'uso alto do limite'
      return `<div class="ac-gauge">
        <svg viewBox="0 0 130 130" width="150" height="150">
          <circle cx="65" cy="65" r="${R}" fill="none" stroke="var(--terminal-line)" stroke-width="12"/>
          <circle cx="65" cy="65" r="${R}" fill="none" stroke="${cor}" stroke-width="12" stroke-linecap="round" stroke-dasharray="${C.toFixed(1)}" stroke-dashoffset="${off.toFixed(1)}" transform="rotate(-90 65 65)"/>
          <text x="65" y="62" text-anchor="middle" font-size="30" font-weight="700" fill="var(--terminal-ink)" font-family="var(--terminal-font)">${pct}%</text>
          <text x="65" y="82" text-anchor="middle" font-size="9" fill="var(--terminal-ink-soft)" font-family="var(--terminal-mono)">usado</text>
        </svg>
        <div class="ac-gauge__side">
          <div class="ac-gauge__row"><span>Utilizado</span><b style="color:${cor}">${money(uso.utilizado)}</b></div>
          <div class="ac-gauge__row"><span>Disponível</span><b>${money(uso.disponivel)}</b></div>
          <div class="ac-gauge__row"><span>Limite total</span><b>${money(uso.limite)}</b></div>
          <p class="ac-gauge__note">${lbl}</p>
        </div>
      </div>`
    },

    // ── Barras de % por cartão ──
    _usoPorCartao(lista) {
      if (!lista.length) return '<div class="td-empty-row"><i class="fas fa-credit-card"></i><span>Nenhum cartão ativo.</span></div>'
      return `<div class="ac-usolist">${lista.map((c, i) => {
        const pct = c.uso_pct
        const cor = corDe(c.cor, i)
        const tone = pct == null ? '' : pct <= 30 ? 'ok' : pct <= 60 ? 'warn' : 'neg'
        return `<div class="ac-usorow">
          <div class="ac-usorow__top"><span class="ac-dot" style="background:${cor}"></span><strong>${esc(c.nome)}</strong><span class="ac-usorow__pct ac-usorow__pct--${tone}">${pct == null ? '—' : pct + '%'}</span></div>
          <div class="to-bar" style="height:8px"><span style="width:${Math.min(100, pct || 0)}%;background:${cor}"></span></div>
          <small class="ac-usorow__val">${money(c.utilizado)} de ${money(c.limite_total)}${Number(c.disponivel) > 0 ? ` · livre ${money(c.disponivel)}` : ''}</small>
        </div>`
      }).join('')}</div>`
    },

    // ── Gráfico de evolução: empilhado por cartão quando "Todos" ──
    _chart(serie, porCartao) {
      if (!serie.length) return '<div class="td-empty-row"><i class="fas fa-chart-column"></i><span>Sem histórico de fatura ainda.</span></div>'
      const totals = serie.map(s => s.total)
      const sorted = [...totals].sort((a, b) => b - a)
      const max = sorted[0] || 1, second = sorted[1] || 0
      const outlier = second > 0 && max > second * 2.5
      const scaleMax = (outlier ? second : max) * 1.12 || 1
      const stack = !this._cartao && porCartao.length > 1
      const cards = stack ? porCartao.map((c, i) => ({ ...c, _cor: corDe(c.cor, i) })) : []

      const cols = serie.map(s => {
        const isOut = outlier && s.total === max
        const hTot = Math.max(2, Math.min(100, (s.total / scaleMax) * 100))
        let inner
        if (stack && s.total > 0) {
          // segmentos proporcionais dentro da barra do mês
          inner = cards.map(c => {
            const v = Number(c.meses?.[s.chave] || 0)
            if (v <= 0) return ''
            const seg = (v / s.total) * 100
            return `<i class="ac-seg" style="height:${seg}%;background:${c._cor}" title="${esc(c.nome)}: ${money(v)}"></i>`
          }).join('')
        } else {
          inner = isOut ? '<i class="fas fa-bolt" title="fora de escala"></i>' : ''
        }
        const up = s.variacao_pct != null && s.variacao_pct > 0
        return `<div class="ac-chart__col" title="${esc(s.label)}: ${money(s.total)}${s.variacao_pct != null ? ` (${up ? '+' : ''}${s.variacao_pct}%)` : ''}">
          <div class="ac-chart__bar"><span class="${isOut && !stack ? 'is-out' : ''} ${stack ? 'is-stack' : ''}" style="height:${hTot}%">${inner}</span></div>
          <small class="ac-chart__val">${shortMoney(s.total)}</small>
          <small class="ac-chart__lbl">${esc(s.label)}</small>
        </div>`
      }).join('')

      const legenda = stack ? `<div class="ac-legend">${cards.map(c => `<span><i style="background:${c._cor}"></i>${esc(c.nome)}</span>`).join('')}</div>` : ''
      const nota = outlier && !stack ? '<p class="td-explainer"><i class="fas fa-bolt"></i> Um mês fora de escala foi limitado para não achatar os demais.</p>' : ''
      return `<div class="ac-chart">${cols}</div>${legenda}${nota}`
    },

    setMeses(m) { this._meses = Number(m) || 12; this.reload() },
    setCartao(c) { this._cartao = c || ''; this.reload() }
  }
})()
