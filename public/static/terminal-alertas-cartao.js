(function () {
  const esc = (v) => String(v ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;')
  const ICON = { limite_alto: 'fa-gauge-high', fechamento_proximo: 'fa-calendar-day', vencimento_proximo: 'fa-bell' }
  const TONE = { limite_alto: 'neg', fechamento_proximo: 'warn', vencimento_proximo: 'warn' }

  window.VMTerminalAlertasCartao = {
    async render(vm) {
      this._vm = vm
      const content = document.getElementById('page-content')
      if (!content) return
      document.body.classList.add('terminal-dashboard-active')
      content.innerHTML = '<div class="td-loading"><span></span><span></span><span></span></div>'
      try {
        const d = await vm.api('GET', 'alertas-cartao')
        this._alertas = d.alertas || []
        this._paint()
      } catch (e) {
        content.innerHTML = `<div class="td-error"><i class="fas fa-triangle-exclamation"></i><h2>Não foi possível carregar os alertas</h2><p>${esc(e.response?.data?.error || 'Tente novamente.')}</p><button class="td-button td-button--primary" onclick="VMTerminalAlertasCartao.reload()">Tentar novamente</button></div>`
      }
    },
    reload() { this.render(this._vm) },

    _paint() {
      const content = document.getElementById('page-content')
      if (!content) return
      const a = this._alertas
      content.innerHTML = this._shell(`
        <div class="mr-toolbar">
          <div><span class="td-eyebrow">${a.length} alerta${a.length === 1 ? '' : 's'} não lido${a.length === 1 ? '' : 's'}</span><h2>Seus cartões, sob controle</h2></div>
          ${a.length ? `<button class="td-button td-button--sm" onclick="VMTerminalAlertasCartao.lerTodos()"><i class="fas fa-check-double"></i> Marcar todos como lidos</button>` : ''}
        </div>
        ${a.length ? `<div class="al-list">${a.map(x => this._row(x)).join('')}</div>` : this._empty()}
      `)
    },

    _row(x) {
      const tone = TONE[x.tipo] || 'warn'
      const icon = ICON[x.tipo] || 'fa-triangle-exclamation'
      const dt = new Date(String(x.created_at || '').replace(' ', 'T'))
      const dl = Number.isNaN(dt.getTime()) ? '' : dt.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }).replace('.', '')
      return `<article class="al-card al-card--${tone}">
        <i class="fas ${icon} al-card__ic"></i>
        <div class="al-card__main">
          <strong>${esc(x.titulo)}</strong>
          <span>${esc(x.mensagem)}</span>
          <small>${esc(x.cartao_nome || '')}${dl ? ' · ' + dl : ''}</small>
        </div>
        <button class="td-icon-btn" title="Marcar como lido" onclick="VMTerminalAlertasCartao.ler(${Number(x.id)})"><i class="fas fa-check"></i></button>
      </article>`
    },

    _empty() {
      return `<section class="td-onboarding"><div class="td-onboarding__copy">
        <span class="td-eyebrow">Tudo em ordem</span>
        <h2>Nenhum alerta no momento. 🎉</h2>
        <p>Quando um cartão passar de 80% do limite, estiver perto de fechar ou de vencer, o aviso aparece aqui.</p>
        <div class="td-onboarding__actions"><button class="td-button" onclick="VM.navigate('cartoes')"><i class="fas fa-credit-card"></i> Ver meus cartões</button></div>
      </div></section>`
    },

    async ler(id) {
      const vm = this._vm
      const r = await vm.api('PATCH', `alertas-cartao/${id}/lido`).catch(e => ({ error: e.response?.data?.error }))
      if (r?.success) { this._alertas = this._alertas.filter(x => Number(x.id) !== Number(id)); this._paint() }
      else vm.toast(r?.error || 'Erro.', 'error')
    },
    async lerTodos() {
      const vm = this._vm
      const r = await vm.api('PATCH', 'alertas-cartao/todos-lidos').catch(e => ({ error: e.response?.data?.error }))
      if (r?.success) { this._alertas = []; vm.toast('Alertas marcados como lidos.', 'success'); this._paint() }
      else vm.toast(r?.error || 'Erro.', 'error')
    },

    _shell(inner) {
      return `<div class="td-dashboard al">
        <header class="td-dashboard__header">
          <div>
            <span class="td-eyebrow">Nada te pega de surpresa</span>
            <h1>Alertas de cartão. <em>Antes da fatura doer.</em></h1>
            <p>Limite alto, fechamento e vencimento chegando — os avisos que evitam juros e sustos.</p>
          </div>
        </header>
        ${inner}
      </div>`
    }
  }
})()
