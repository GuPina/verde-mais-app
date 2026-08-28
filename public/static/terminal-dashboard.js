(function () {
  const months = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro']
  const colors = ['#3DDC84', '#F2C94C', '#8BA397', '#6EA8FE', '#B58AF4', '#FF8C69']

  const esc = (value) => String(value ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#039;')

  const money = (value) => new Intl.NumberFormat('pt-BR', {
    style: 'currency', currency: 'BRL', maximumFractionDigits: 2
  }).format(Number(value) || 0)

  const shortMoney = (value) => new Intl.NumberFormat('pt-BR', {
    style: 'currency', currency: 'BRL', notation: 'compact', maximumFractionDigits: 1
  }).format(Number(value) || 0)

  const periodIndex = (month, year) => Number(year) * 12 + Number(month) - 1
  const routeFromLink = (link) => {
    const route = String(link || '').replace(/^#/, '').replace(/^\//, '')
    const allowed = new Set(['receitas', 'despesas', 'orcamentos', 'reserva', 'reservas-esp', 'amortizacao', 'cartoes', 'metas', 'investimentos', 'tags', 'assinaturas-fantasma'])
    return allowed.has(route) ? route : 'dashboard'
  }

  const periodLabel = (month, year) => `${months[Number(month) - 1]} de ${year}`

  const statusForPeriod = (month, year) => {
    const now = new Date()
    const selected = periodIndex(month, year)
    const current = periodIndex(now.getMonth() + 1, now.getFullYear())
    if (selected > current) return { key: 'future', label: 'Período futuro', help: 'Previsão aberta: lançamentos e valores ainda podem mudar.' }
    if (selected < current) return { key: 'past', label: 'Período fechado', help: 'Histórico consolidado do mês selecionado.' }
    return { key: 'current', label: 'Mês atual', help: 'Atualizado com seus lançamentos até hoje.' }
  }

  const delta = (value, invert) => {
    if (value === null || value === undefined) return '<span class="td-kpi__delta td-kpi__delta--muted">Sem base anterior</span>'
    const positive = invert ? Number(value) <= 0 : Number(value) >= 0
    return `<span class="td-kpi__delta ${positive ? 'td-kpi__delta--positive' : 'td-kpi__delta--negative'}"><i class="fas fa-${Number(value) >= 0 ? 'arrow-up' : 'arrow-down'}"></i> ${Math.abs(Number(value)).toFixed(1)}% vs. mês anterior</span>`
  }

  const emptyState = (vm, period) => `
    <section class="td-onboarding" aria-labelledby="td-empty-title">
      <div class="td-onboarding__copy">
        <span class="td-eyebrow">Sua primeira colheita</span>
        <h2 id="td-empty-title">Monte um painel que fale sobre a sua vida.</h2>
        <p>Com três registros o VerdeMais já começa a calcular saldo, ritmo de gastos e próximos passos — sem a parede de indicadores zerados.</p>
        <div class="td-onboarding__actions">
          <button class="td-button td-button--primary" onclick="VM.modalReceita()"><i class="fas fa-plus"></i> Adicionar renda</button>
          <button class="td-button" onclick="VM.modalDespesa()"><i class="fas fa-receipt"></i> Registrar despesa</button>
          <a class="td-button td-button--ghost" href="/onboarding"><i class="fas fa-sliders"></i> Personalizar perfil</a>
        </div>
      </div>
      <ol class="td-checklist">
        <li><span>01</span><div><strong>Informe sua renda</strong><small>Base para saldo, score e comprometimento.</small></div></li>
        <li><span>02</span><div><strong>Registre despesas fixas</strong><small>Contas recorrentes deixam a previsão confiável.</small></div></li>
        <li><span>03</span><div><strong>Crie seu primeiro objetivo</strong><small>Transforme o saldo em uma decisão concreta.</small></div></li>
      </ol>
      <div class="td-onboarding__period"><i class="far fa-calendar"></i> ${esc(period)}</div>
    </section>`

  const transactionRows = (transactions) => {
    if (!transactions.length) return '<div class="td-empty-row"><i class="fas fa-list"></i><span>Nenhum lançamento ocorrido neste período.</span></div>'
    return transactions.slice(0, 6).map(item => {
      const income = item.tipo === 'receita'
      const date = item.data ? new Date(`${String(item.data).slice(0, 10)}T12:00:00`) : null
      const dateLabel = date && !Number.isNaN(date.getTime()) ? date.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }).replace('.', '') : '—'
      return `<button class="td-transaction" onclick="VM.navigate('${income ? 'receitas' : 'despesas'}')">
        <span class="td-icon"><i class="fas fa-${income ? 'arrow-down' : 'arrow-up'}"></i></span>
        <span class="td-transaction__main"><strong>${esc(item.descricao)}</strong><small>${esc(item.categoria || 'Sem categoria')} · ${dateLabel}</small></span>
        <span class="td-transaction__value ${income ? 'is-positive' : ''}">${income ? '+' : '−'} ${money(item.valor)}</span>
      </button>`
    }).join('')
  }

  const actionRows = (actions) => {
    if (!actions.length) return '<div class="td-empty-row"><i class="fas fa-check"></i><span>Nenhuma ação urgente para este período.</span></div>'
    return actions.slice(0, 4).map((action) => {
      const route = routeFromLink(action.link || action.rota)
      const priority = action.prioridade === 'risco' ? 'risk' : 'opportunity'
      return `<button class="td-action" onclick="VM.navigate('${route}')">
        <span class="td-action__mark td-action__mark--${priority}"><i class="fas fa-${priority === 'risk' ? 'triangle-exclamation' : 'lightbulb'}"></i></span>
        <span><strong>${esc(action.titulo)}</strong><small>${esc(action.descricao || 'Abra para conferir os detalhes.')}</small></span>
        <i class="fas fa-arrow-right"></i>
      </button>`
    }).join('')
  }

  const dueRows = (items) => {
    if (!items.length) return '<div class="td-empty-row"><i class="far fa-calendar-check"></i><span>Nenhum vencimento nos próximos 7 dias.</span></div>'
    window.VMTerminalDashboard._dueDescriptions = Object.fromEntries(items.map(item => [Number(item.id), String(item.descricao || 'Despesa')]))
    return items.slice(0, 4).map(item => {
      const date = item.vencimento ? new Date(`${String(item.vencimento).slice(0, 10)}T12:00:00`) : null
      const dateLabel = date && !Number.isNaN(date.getTime()) ? date.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }).replace('.', '') : '—'
      return `<div class="td-due">
        <span class="td-due__date">${dateLabel}</span>
        <span><strong>${esc(item.descricao)}</strong><small>${esc(item.categoria || 'Despesa')} · ${money(item.valor)}</small></span>
        <button title="Marcar como pago" aria-label="Marcar ${esc(item.descricao)} como pago" onclick="VMTerminalDashboard.pay(${Number(item.id)}, event)"><i class="fas fa-check"></i></button>
      </div>`
    }).join('')
  }

  const categories = (items, total) => {
    if (!items.length || !total) return '<div class="td-empty-row"><i class="fas fa-chart-pie"></i><span>Cadastre despesas para visualizar a distribuição.</span></div>'
    return `<div class="td-category-bar" aria-label="Distribuição de despesas">${items.slice(0, 6).map((item, index) => `<span style="width:${Math.max(2, (Number(item.total) / total) * 100)}%;background:${colors[index % colors.length]}" title="${esc(item.categoria)}: ${money(item.total)}"></span>`).join('')}</div>
      <div class="td-category-list">${items.slice(0, 5).map((item, index) => `<button onclick="VM.navigate('despesas')"><i style="background:${colors[index % colors.length]}"></i><span>${esc(item.categoria || 'Sem categoria')}</span><strong>${Math.round((Number(item.total) / total) * 100)}%</strong><small>${money(item.total)}</small></button>`).join('')}</div>`
  }

  window.VMTerminalDashboard = {
    async render(vm, mesFiltro, anoFiltro) {
      this._vm = vm
      const content = document.getElementById('page-content')
      if (!content) return
      document.body.classList.add('terminal-dashboard-active')
      const now = new Date()
      vm._dashMes = String(mesFiltro || vm._dashMes || now.getMonth() + 1).padStart(2, '0')
      vm._dashAno = String(anoFiltro || vm._dashAno || now.getFullYear())
      const period = periodLabel(vm._dashMes, vm._dashAno)
      const status = statusForPeriod(vm._dashMes, vm._dashAno)

      content.innerHTML = '<div class="td-loading"><span></span><span></span><span></span></div>'
      try {
        const data = await vm.api('GET', `dashboard?mes=${vm._dashMes}&ano=${vm._dashAno}`)
        const resumo = data.resumo || {}
        const obligations = data.obrigacoes_temporais || {}
        const obligationSummary = obligations.resumo || {}
        const commitment = Number(obligations.comprometimento_ajustado_pct ?? obligationSummary.comprometimento_pct_atual ?? 0)
        const installment = Number(obligationSummary.total_parcelas_ativas ?? resumo.parcelas_emp_fin ?? 0)
        const score = data.score_saude
        const savings = resumo.taxa_poupanca
        const newAccount = [resumo.total_receitas, resumo.total_despesas, resumo.total_investimentos, resumo.total_devedor, data.metas?.ativas]
          .every(value => Number(value || 0) === 0)

        if (data.limites) vm.limites = data.limites
        const titleName = esc(vm.user?.nome?.split(' ')[0] || 'você')
        const recommendationCount = (data.acoes_para_hoje || []).length
        const categoriesTotal = (data.categorias_despesas || []).reduce((sum, item) => sum + Number(item.total || 0), 0)
        const patrimoineTone = Number(resumo.patrimonio_liquido || 0) >= 0 ? 'positive' : 'negative'

        content.innerHTML = `<div class="td-dashboard">
          <header class="td-dashboard__header">
            <div>
              <span class="td-eyebrow">${esc(period)}</span>
              <h1>Olá, ${titleName}. <em>Bora colher?</em></h1>
              <p>${esc(status.help)}</p>
            </div>
            <div class="td-dashboard__header-actions">
              <button class="td-button" onclick="VM.navigate('alertas-cartao')"><i class="far fa-bell"></i> Alertas</button>
              <button class="td-button td-button--primary" onclick="VM.abrirLancamentoRapido()"><i class="fas fa-plus"></i> Novo lançamento</button>
            </div>
          </header>

          <section class="td-period" aria-label="Filtro de período">
            <button onclick="VMTerminalDashboard.shiftPeriod(-1)" aria-label="Mês anterior"><i class="fas fa-chevron-left"></i></button>
            <label><span>Mês</span><select id="td-month" onchange="VMTerminalDashboard.changePeriod()">${months.map((name, index) => `<option value="${String(index + 1).padStart(2, '0')}" ${Number(vm._dashMes) === index + 1 ? 'selected' : ''}>${name}</option>`).join('')}</select></label>
            <label><span>Ano</span><select id="td-year" onchange="VMTerminalDashboard.changePeriod()">${vm._anosOpcoes(vm._dashAno)}</select></label>
            <button onclick="VMTerminalDashboard.shiftPeriod(1)" aria-label="Próximo mês"><i class="fas fa-chevron-right"></i></button>
            <button class="td-period__today" onclick="VMTerminalDashboard.today()">Hoje</button>
            <span class="td-period__status td-period__status--${status.key}"><i class="fas fa-circle"></i> ${status.label}</span>
          </section>

          ${status.key === 'future' ? `<div class="td-notice"><i class="fas fa-wand-magic-sparkles"></i><div><strong>Este mês ainda está em construção.</strong><span>Os valores refletem somente lançamentos já planejados e podem mudar até o fechamento.</span></div></div>` : ''}
          ${newAccount ? emptyState(vm, period) : `
            <section class="td-hero-grid">
              <article class="td-patrimony td-patrimony--${patrimoineTone}" onclick="VM.navigate('investimentos')">
                <div class="td-patrimony__top"><span class="td-eyebrow">Patrimônio líquido</span><span class="td-chip"><i class="fas fa-seedling"></i> posição atual</span></div>
                <strong>${money(resumo.patrimonio_liquido)}</strong>
                <p>O que você construiu menos o saldo de todas as dívidas ativas.</p>
                <div class="td-patrimony__breakdown">
                  <span><small>Investimentos</small><b>${shortMoney(resumo.total_investimentos)}</b></span>
                  <span><small>Reservas</small><b>${shortMoney(resumo.total_reservas)}</b></span>
                  <span><small>Dívidas</small><b class="is-negative">− ${shortMoney(resumo.total_devedor)}</b></span>
                </div>
              </article>
              <div class="td-kpis">
                <article class="td-kpi"><span>Saldo do mês</span><strong>${money(resumo.saldo_liquido)}</strong>${savings === null ? '<span class="td-kpi__delta td-kpi__delta--muted">Taxa de poupança —</span>' : `<span class="td-kpi__delta ${Number(savings) >= 0 ? 'td-kpi__delta--positive' : 'td-kpi__delta--negative'}">Taxa de poupança ${Number(savings).toFixed(1)}%</span>`}</article>
                <article class="td-kpi"><span>Receitas</span><strong>${money(resumo.total_receitas)}</strong>${delta(resumo.var_receitas_pct, false)}</article>
                <article class="td-kpi"><span>Despesas</span><strong>${money(resumo.total_despesas)}</strong>${delta(resumo.var_despesas_pct, true)}</article>
                <article class="td-kpi td-kpi--score" onclick="${data.score_bloqueado ? "VM.upsellModal('score_saude')" : "VM.navigate('ia')"}"><span>Score de saúde</span><strong>${score === null ? '—' : `${Number(score)}<small>/100</small>`}</strong><span class="td-kpi__delta">${score === null ? 'Disponível no Premium' : score >= 80 ? 'Muito bom' : score >= 60 ? 'Bom caminho' : 'Pede atenção'}</span></article>
              </div>
            </section>

            <section class="td-insights-grid">
              <article class="td-panel td-panel--wide">
                <div class="td-panel__head"><div><span class="td-eyebrow">Fluxo dos últimos 6 meses</span><h2>Evolução financeira</h2></div><a onclick="VM.navigate('comparativo')">Ver comparativo <i class="fas fa-arrow-right"></i></a></div>
                <div class="td-chart"><canvas id="td-evolution-chart"></canvas></div>
              </article>
              <article class="td-panel">
                <div class="td-panel__head"><div><span class="td-eyebrow">Comprometimento</span><h2>Obrigações ativas</h2></div><span class="td-chip ${commitment > 30 ? 'is-danger' : ''}">${commitment.toFixed(1)}%</span></div>
                <strong class="td-big-number">${money(installment)}<small>/mês</small></strong>
                <p class="td-explainer"><i class="fas fa-circle-info"></i> As parcelas acima já estão incluídas no total de despesas do mês — não são somadas duas vezes.</p>
                <div class="td-progress"><span style="width:${Math.min(100, commitment)}%"></span></div>
                <div class="td-progress__legend"><span>0%</span><span>limite saudável: 30%</span><span>100%</span></div>
                <button class="td-link-button" onclick="VM.navigate('amortizacao')">Simular amortização <i class="fas fa-arrow-right"></i></button>
              </article>
            </section>

            <section class="td-content-grid">
              <article class="td-panel td-panel--list">
                <div class="td-panel__head"><div><span class="td-eyebrow">${esc(period)}</span><h2>Últimos lançamentos</h2></div><button onclick="VM.navigate('despesas')">Ver todos</button></div>
                ${transactionRows(data.ultimas_transacoes || [])}
              </article>
              <article class="td-panel td-panel--list">
                <div class="td-panel__head"><div><span class="td-eyebrow">Próximos 7 dias</span><h2>Vencimentos</h2></div><button onclick="VM.navigate('lembretes')">Agenda</button></div>
                ${dueRows(data.proximos_vencimentos || [])}
              </article>
            </section>

            <section class="td-content-grid td-content-grid--bottom">
              <article class="td-panel td-panel--list">
                <div class="td-panel__head"><div><span class="td-eyebrow">Prioridades</span><h2>Ações para hoje</h2></div><span class="td-chip">${recommendationCount} recomendaç${recommendationCount === 1 ? 'ão' : 'ões'}</span></div>
                ${actionRows(data.acoes_para_hoje || [])}
              </article>
              <article class="td-panel">
                <div class="td-panel__head"><div><span class="td-eyebrow">Leitura do mês</span><h2>Despesas por categoria</h2></div><button onclick="VM.navigate('tags')">Tags & filtros</button></div>
                ${categories(data.categorias_despesas || [], categoriesTotal)}
              </article>
            </section>
          `}
        </div>`

        if (!newAccount) this.renderChart(vm, data.evolucao || [])
      } catch (error) {
        content.innerHTML = `<div class="td-error"><i class="fas fa-triangle-exclamation"></i><h2>Não foi possível carregar o Dashboard</h2><p>${esc(error.response?.data?.error || 'Tente novamente em instantes.')}</p><button class="td-button td-button--primary" onclick="VM.pageDashboard(VM._dashMes, VM._dashAno)">Tentar novamente</button></div>`
      }
    },

    renderChart(vm, evolution) {
      const canvas = document.getElementById('td-evolution-chart')
      if (!canvas || typeof Chart === 'undefined') return
      if (vm.charts.terminalDashboard) vm.charts.terminalDashboard.destroy()
      vm.charts.terminalDashboard = new Chart(canvas, {
        type: 'line',
        data: {
          labels: evolution.map(item => item.mes),
          datasets: [
            { label: 'Receitas', data: evolution.map(item => Number(item.receitas || 0)), borderColor: '#3DDC84', backgroundColor: 'rgba(61,220,132,.08)', borderWidth: 2, pointRadius: 3, pointBackgroundColor: '#3DDC84', tension: .35, fill: true },
            { label: 'Despesas', data: evolution.map(item => Number(item.despesas || 0)), borderColor: '#F2C94C', backgroundColor: 'transparent', borderWidth: 2, pointRadius: 3, pointBackgroundColor: '#F2C94C', tension: .35 }
          ]
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: { legend: { labels: { color: '#7A8B80', usePointStyle: true, boxWidth: 8, font: { family: 'Inter', size: 11 } } }, tooltip: { callbacks: { label: (context) => `${context.dataset.label}: ${money(context.parsed.y)}` } } },
          scales: { x: { ticks: { color: '#7A8B80' }, grid: { display: false } }, y: { ticks: { color: '#7A8B80', callback: value => shortMoney(value) }, grid: { color: 'rgba(122,139,128,.12)' }, beginAtZero: true } }
        }
      })
    },

    changePeriod() {
      const month = document.getElementById('td-month')?.value
      const year = document.getElementById('td-year')?.value
      if (month && year) this._vm?.pageDashboard(month, year)
    },

    shiftPeriod(delta) {
      const date = new Date(Number(this._vm?._dashAno), Number(this._vm?._dashMes) - 1 + delta, 1)
      this._vm?.pageDashboard(String(date.getMonth() + 1).padStart(2, '0'), String(date.getFullYear()))
    },

    today() {
      const now = new Date()
      this._vm?.pageDashboard(String(now.getMonth() + 1).padStart(2, '0'), String(now.getFullYear()))
    },

    async pay(id, event) {
      event?.stopPropagation()
      const description = this._dueDescriptions?.[Number(id)] || 'esta despesa'
      const ok = await this._vm.vmConfirm(`Marcar “${description}” como pago?`, {
        titulo: 'Confirmar pagamento', textoBotao: 'Confirmar', corBotao: '#3DDC84', icone: '✓'
      })
      if (!ok) return
      try {
        await this._vm.api('PATCH', `despesas/${id}`, { status: 'pago', data: new Date().toISOString().split('T')[0] })
        this._vm.toast('Pagamento registrado.', 'success')
        this._vm.pageDashboard(this._vm._dashMes, this._vm._dashAno)
      } catch (error) {
        this._vm.toast(error.response?.data?.error || 'Erro ao registrar pagamento.', 'error')
      }
    }
  }
})()
