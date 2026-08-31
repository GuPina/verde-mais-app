(function () {
  const esc = (v) => String(v ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;')
  const money = (v) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 2 }).format(Number(v) || 0)

  window.VMTerminalAssinaturasFantasma = {
    async render(vm) {
      this._vm = vm
      const content = document.getElementById('page-content')
      if (!content) return
      document.body.classList.add('terminal-dashboard-active')
      content.innerHTML = '<div class="td-loading"><span></span><span></span><span></span></div>'
      try {
        const d = await vm.api('GET', 'assinaturas-fantasma')
        this._d = d
        this._paint()
      } catch (e) {
        content.innerHTML = `<div class="td-error"><i class="fas fa-triangle-exclamation"></i><h2>Não foi possível carregar</h2><p>${esc(e.response?.data?.error || 'Tente novamente.')}</p><button class="td-button td-button--primary" onclick="VMTerminalAssinaturasFantasma.reload()">Tentar novamente</button></div>`
      }
    },
    reload() { this.render(this._vm) },

    _paint() {
      const content = document.getElementById('page-content')
      if (!content) return
      const d = this._d
      const list = d.detected || []
      const anual = Number(d.total_anual ?? d.totalAnual) || 0
      const mensal = Number(d.total_mensal ?? d.totalMensal) || 0

      content.innerHTML = this._shell(`
        <section class="fe-hero">
          <div class="fe-hero__main">
            <span class="td-eyebrow">Detectadas nos seus gastos</span>
            <div class="fe-hero__big">${money(anual)}<em style="font-size:15px;color:var(--terminal-ink-soft);font-style:normal">/ano</em></div>
            <p>${list.length} cobrança(s) recorrente(s) · ${money(mensal)}/mês somados</p>
          </div>
          <div class="fe-hero__gauge" style="text-align:right">
            <button class="td-button td-button--primary" onclick="VMTerminalAssinaturasFantasma.escanear()"><i class="fas fa-radar"></i> Escanear novamente</button>
          </div>
        </section>

        ${list.length ? `<div class="an-list" style="margin-top:18px">${list.map(x => this._row(x)).join('')}</div>` : this._empty()}
      `)
    },

    _row(x) {
      const nome = x.service_nome || x.normalized_description || x.original_description || 'Cobrança recorrente'
      return `<article class="an-card">
        <div class="an-card__main">
          <strong>${esc(nome)}</strong>
          <small>${esc(x.frequency_label || 'mensal')}${x.service_type && x.service_type !== 'unknown' ? ' · ' + esc(x.service_type) : ''} · ${money(x.amount)}/mês</small>
        </div>
        <div class="an-card__vals">
          <span class="an-card__val">${money(x.yearly_cost || (Number(x.amount) || 0) * 12)}</span>
          <small class="an-card__eco">por ano</small>
        </div>
        <div class="an-card__actions">
          <button class="td-button td-button--sm td-button--primary" onclick="VMTerminalAssinaturasFantasma.feedback(${Number(x.id)}, 'want_cancel')"><i class="fas fa-scissors"></i> Vou cancelar</button>
          <button class="td-button td-button--sm" onclick="VMTerminalAssinaturasFantasma.feedback(${Number(x.id)}, 'use_regularly')">Uso sempre</button>
          <button class="td-button td-button--sm" onclick="VMTerminalAssinaturasFantasma.feedback(${Number(x.id)}, 'ignore')" title="Ignorar"><i class="fas fa-eye-slash"></i></button>
        </div>
      </article>`
    },

    _empty() {
      return `<section class="td-onboarding" style="margin-top:18px"><div class="td-onboarding__copy">
        <span class="td-eyebrow">Nada escondido</span>
        <h2>Nenhuma assinatura fantasma encontrada. 🎉</h2>
        <p>O VerdeMais varre seus gastos atrás de cobranças recorrentes que você pode ter esquecido. Rode um scan quando quiser.</p>
        <div class="td-onboarding__actions"><button class="td-button td-button--primary" onclick="VMTerminalAssinaturasFantasma.escanear()"><i class="fas fa-radar"></i> Escanear meus gastos</button></div>
      </div></section>`
    },

    async escanear() {
      const vm = this._vm
      vm.toast('Escaneando seus gastos…', 'info')
      const r = await vm.api('POST', 'assinaturas-fantasma/scan', {}).catch(e => ({ error: e.response?.data?.error }))
      if (r && !r.error) { vm.toast('Scan concluído.', 'success'); this.reload() }
      else vm.toast(r?.error || 'Erro no scan.', 'error')
    },
    async feedback(id, tipo) {
      const vm = this._vm
      if (tipo === 'want_cancel' && !window.confirm('Marcar como "vou cancelar"? Entra no seu histórico de economia.')) return
      const r = await vm.api('PATCH', `assinaturas-fantasma/${id}/feedback`, { feedback: tipo }).catch(e => ({ error: e.response?.data?.error }))
      if (r && (r.success || !r.error)) {
        vm.toast(tipo === 'want_cancel' ? 'Marcada para cancelar. 💰' : tipo === 'use_regularly' ? 'Ok, mantida.' : 'Ignorada.', 'success')
        this.reload()
      } else vm.toast(r?.error || 'Erro.', 'error')
    },

    _shell(inner) {
      return `<div class="td-dashboard af">
        <header class="td-dashboard__header">
          <div>
            <span class="td-eyebrow">O que suga sem você ver</span>
            <h1>Assinaturas fantasma. <em>Caça às cobranças esquecidas.</em></h1>
            <p>Serviços que renovam sozinhos e você nem lembra — o VerdeMais acha e mostra quanto custam por ano.</p>
          </div>
        </header>
        ${inner}
      </div>`
    }
  }
})()
