(function () {
  const esc = (value) => String(value ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#039;')

  const money = (value) => new Intl.NumberFormat('pt-BR', {
    style: 'currency', currency: 'BRL', maximumFractionDigits: 2
  }).format(Number(value) || 0)

  const shortMoney = (value) => new Intl.NumberFormat('pt-BR', {
    style: 'currency', currency: 'BRL', notation: 'compact', maximumFractionDigits: 1
  }).format(Number(value) || 0)

  const dateLabel = (value) => {
    if (!value) return 'sem prazo'
    const d = new Date(`${String(value).slice(0, 10)}T12:00:00`)
    return Number.isNaN(d.getTime()) ? 'sem prazo' : d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' }).replace('.', '')
  }

  // Estágio da meta pelo progresso — linguagem do jardim (deck Terminal)
  const stage = (pct, atrasada, concluida) => {
    if (concluida) return { label: 'colhida', tone: 'done' }
    if (atrasada) return { label: 'atrasada', tone: 'risk' }
    if (pct >= 80) return { label: 'colhendo', tone: 'good' }
    if (pct >= 40) return { label: 'crescendo', tone: 'grow' }
    return { label: 'plantada', tone: 'seed' }
  }

  const ORDERS = { prazo: 'Prazo', percentual: '%', valor: 'Valor' }

  window.VMTerminalMetas = {
    _order: 'prazo',
    _view: 'cards',

    async render(vm) {
      this._vm = vm
      const content = document.getElementById('page-content')
      if (!content) return
      document.body.classList.add('terminal-dashboard-active')
      content.innerHTML = '<div class="td-loading"><span></span><span></span><span></span></div>'

      try {
        const [data, resumo] = await Promise.all([
          vm.api('GET', 'metas'),
          vm.api('GET', 'metas/resumo').catch(() => null)
        ])
        this._cache = data.metas || []
        this._resumo = resumo?.totais || null
        if (data.limites) vm.limites = data.limites
        this._paint()
      } catch (error) {
        content.innerHTML = `<div class="td-error"><i class="fas fa-triangle-exclamation"></i><h2>Não foi possível carregar as Metas</h2><p>${esc(error.response?.data?.error || 'Tente novamente em instantes.')}</p><button class="td-button td-button--primary" onclick="VM.pageMetas()">Tentar novamente</button></div>`
      }
    },

    _paint() {
      const content = document.getElementById('page-content')
      if (!content) return
      const all = this._cache || []
      const totais = this._resumo || {}

      const ativas     = this._sort(all.filter(m => m.status === 'ativa'))
      const concluidas = all.filter(m => m.status === 'concluida')
      const arquivadas = all.filter(m => m.status === 'arquivada' || m.status === 'cancelada')
      const atrasadas  = ativas.filter(m => m.atrasada)

      const limiteMetas = this._vm?.limites?.metas
      const limiteHint = (limiteMetas && limiteMetas !== Infinity && limiteMetas < 900)
        ? `de ${limiteMetas} no seu plano` : 'objetivos em andamento'

      // Próxima colheita: meta ativa mais próxima de bater o objetivo
      const proxima = [...ativas].filter(m => !m.atrasada).sort((a, b) => (b.percentual || 0) - (a.percentual || 0))[0]

      const totalGuardado = totais.total_atual ?? all.reduce((s, m) => s + Number(m.valor_atual || 0), 0)
      const totalObjetivo = totais.total_objetivo ?? ativas.reduce((s, m) => s + Number(m.valor_objetivo || 0), 0)
      const faltaGuardar  = Math.max(0, totalObjetivo - totalGuardado)

      content.innerHTML = `<div class="td-dashboard tm">
        <header class="td-dashboard__header">
          <div>
            <span class="td-eyebrow">Objetivos</span>
            <h1>Metas. <em>Plante hoje.</em></h1>
            <p>Cada objetivo com seu prazo, seu ritmo e a próxima colheita à vista.</p>
          </div>
          <div class="td-dashboard__header-actions">
            <button class="td-button td-button--primary" onclick="VM.modalMeta()"><i class="fas fa-plus"></i> Nova meta</button>
          </div>
        </header>

        <section class="tm-kpis">
          <article class="td-kpi"><span>Metas ativas</span><strong>${ativas.length}</strong><span class="td-kpi__delta td-kpi__delta--muted">${esc(limiteHint)}</span></article>
          <article class="td-kpi"><span>Total guardado</span><strong>${money(totalGuardado)}</strong><span class="td-kpi__delta td-kpi__delta--muted">somando todas as metas</span></article>
          <article class="td-kpi"><span>Falta guardar</span><strong>${money(faltaGuardar)}</strong><span class="td-kpi__delta td-kpi__delta--muted">para os objetivos ativos</span></article>
          <article class="td-kpi td-kpi--score">${proxima
            ? `<span>Próxima colheita</span><strong style="font-size:clamp(20px,2vw,26px)">${esc(proxima.nome)}</strong><span class="td-kpi__delta td-kpi__delta--positive">${Math.round(proxima.percentual)}% · ${proxima.meses_restantes ?? 0} ${(proxima.meses_restantes === 1) ? 'mês' : 'meses'}</span>`
            : `<span>Próxima colheita</span><strong style="font-size:clamp(20px,2vw,26px)">—</strong><span class="td-kpi__delta td-kpi__delta--muted">crie sua primeira meta</span>`}</article>
        </section>

        ${atrasadas.length ? `<div class="td-notice tm-notice--risk"><i class="fas fa-triangle-exclamation"></i><div><strong>${atrasadas.length} meta${atrasadas.length > 1 ? 's' : ''} atrasada${atrasadas.length > 1 ? 's' : ''}.</strong><span>O prazo passou e ainda não bateram o objetivo: ${atrasadas.map(m => esc(m.nome)).join(', ')}.</span></div></div>` : ''}

        <section class="tm-controls">
          <div class="tm-segment">${Object.entries(ORDERS).map(([key, label]) => `<button class="${this._order === key ? 'is-active' : ''}" onclick="VMTerminalMetas.setOrder('${key}')">${label}</button>`).join('')}</div>
          <div class="tm-segment">
            <button class="${this._view === 'cards' ? 'is-active' : ''}" onclick="VMTerminalMetas.setView('cards')"><i class="fas fa-table-cells-large"></i> Cards</button>
            <button class="${this._view === 'timeline' ? 'is-active' : ''}" onclick="VMTerminalMetas.setView('timeline')"><i class="fas fa-stream"></i> Linha do tempo</button>
          </div>
        </section>

        ${all.length === 0 ? this._empty() : this._view === 'timeline'
          ? this._timeline([...ativas, ...concluidas])
          : `
            ${ativas.length ? `<div class="tm-group"><div class="tm-group__head"><span class="td-eyebrow">Ativas · ${ativas.length}</span></div><div class="tm-grid">${ativas.map(m => this._card(m)).join('')}</div></div>` : ''}
            ${concluidas.length ? `<div class="tm-group"><div class="tm-group__head"><span class="td-eyebrow">🏆 Concluídas · ${concluidas.length}</span></div><div class="tm-grid">${concluidas.map(m => this._card(m)).join('')}</div></div>` : ''}
            ${arquivadas.length ? `<div class="tm-group"><details><summary>Arquivadas / canceladas · ${arquivadas.length}</summary><div class="tm-grid" style="margin-top:14px">${arquivadas.map(m => this._card(m)).join('')}</div></details></div>` : ''}
          `}
      </div>`
    },

    _empty() {
      return `<section class="td-onboarding tm-empty">
        <div class="td-onboarding__copy">
          <span class="td-eyebrow">Seu primeiro objetivo</span>
          <h2>Transforme o saldo em uma decisão concreta.</h2>
          <p>Uma meta com prazo faz o VerdeMais calcular quanto guardar por mês e acompanhar cada colheita.</p>
          <div class="td-onboarding__actions"><button class="td-button td-button--primary" onclick="VM.modalMeta()"><i class="fas fa-plus"></i> Criar minha primeira meta</button></div>
        </div>
      </section>`
    },

    _card(m) {
      const pct = Math.min(100, Math.round(Number(m.percentual) || 0))
      const concluida = m.status === 'concluida'
      const st = stage(pct, m.atrasada, concluida)
      const cor = /^#[0-9a-fA-F]{3,8}$/.test(String(m.cor || '')) ? m.cor : 'var(--terminal-primary)'
      const nomeAttr = esc(m.nome)
      const mensal = Number(m.mensalidade_necessaria || 0)
      return `<article class="tm-card tm-card--${st.tone}">
        <div class="tm-card__head">
          <span class="tm-card__icon" style="color:${cor}"><i class="fas fa-${esc(m.icone || 'bullseye')}"></i></span>
          <div class="tm-card__title">
            <strong>${esc(m.nome)}</strong>
            <small><i class="far fa-calendar"></i> ${dateLabel(m.data_meta)}</small>
          </div>
          <span class="tm-stage tm-stage--${st.tone}">${st.label}</span>
        </div>
        <div class="tm-card__values">
          <strong>${money(m.valor_atual)}</strong>
          <small>de ${money(m.valor_objetivo)}</small>
          <span class="tm-pct">${pct}%</span>
        </div>
        <div class="tm-bar"><span style="width:${pct}%;background:${concluida ? 'var(--terminal-primary)' : cor}"></span></div>
        ${!concluida ? `<p class="tm-card__hint">${m.atrasada
            ? `<i class="fas fa-triangle-exclamation"></i> Prazo vencido — falta ${money(m.valor_faltante)}`
            : mensal > 0
              ? `<i class="fas fa-seedling"></i> Guarde ${money(mensal)}/mês para bater o prazo`
              : `<i class="fas fa-check"></i> No ritmo certo`}</p>` : `<p class="tm-card__hint tm-card__hint--done"><i class="fas fa-trophy"></i> Objetivo alcançado</p>`}
        <div class="tm-card__actions">
          ${!concluida ? `<button class="td-button td-button--primary" onclick="VM.modalDeposito(${m.id}, '${nomeAttr}')"><i class="fas fa-plus"></i> Depositar</button>` : ''}
          <button class="td-button" onclick="VM.modalMeta(${m.id})"><i class="fas fa-pen"></i></button>
          <button class="td-button" onclick="VM.modalHistoricoMeta(${m.id}, '${nomeAttr}')"><i class="fas fa-clock-rotate-left"></i></button>
        </div>
      </article>`
    },

    _timeline(metas) {
      if (!metas.length) return this._empty()
      const sorted = [...metas].sort((a, b) => new Date(a.data_meta) - new Date(b.data_meta))
      return `<div class="tm-timeline">${sorted.map(m => {
        const pct = Math.min(100, Math.round(Number(m.percentual) || 0))
        const concluida = m.status === 'concluida'
        const st = stage(pct, m.atrasada, concluida)
        const cor = /^#[0-9a-fA-F]{3,8}$/.test(String(m.cor || '')) ? m.cor : 'var(--terminal-primary)'
        return `<div class="tm-timeline__item tm-card--${st.tone}">
          <span class="tm-timeline__dot" style="background:${concluida ? 'var(--terminal-primary)' : cor}"></span>
          <div class="tm-timeline__body">
            <div class="tm-timeline__top">
              <strong>${esc(m.nome)}</strong>
              <span class="tm-stage tm-stage--${st.tone}">${concluida ? '🏆 colhida' : st.label} · ${dateLabel(m.data_meta)}</span>
            </div>
            <div class="tm-card__values"><strong>${money(m.valor_atual)}</strong><small>de ${money(m.valor_objetivo)}</small><span class="tm-pct">${pct}%</span></div>
            <div class="tm-bar"><span style="width:${pct}%;background:${concluida ? 'var(--terminal-primary)' : cor}"></span></div>
            ${!concluida ? `<div class="tm-card__actions"><button class="td-button td-button--primary" onclick="VM.modalDeposito(${m.id}, '${esc(m.nome)}')"><i class="fas fa-plus"></i> Depositar</button><button class="td-button" onclick="VM.modalHistoricoMeta(${m.id}, '${esc(m.nome)}')"><i class="fas fa-clock-rotate-left"></i> Histórico</button></div>` : ''}
          </div>
        </div>`
      }).join('')}</div>`
    },

    _sort(metas) {
      const arr = [...metas]
      if (this._order === 'prazo')      return arr.sort((a, b) => new Date(a.data_meta) - new Date(b.data_meta))
      if (this._order === 'percentual') return arr.sort((a, b) => (b.percentual || 0) - (a.percentual || 0))
      if (this._order === 'valor')      return arr.sort((a, b) => (b.valor_objetivo || 0) - (a.valor_objetivo || 0))
      return arr
    },

    setOrder(order) { if (ORDERS[order]) { this._order = order; this._paint() } },
    setView(view)   { if (view === 'cards' || view === 'timeline') { this._view = view; this._paint() } }
  }
})()
