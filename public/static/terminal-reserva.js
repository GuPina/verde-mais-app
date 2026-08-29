(function () {
  const esc = (v) => String(v ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;')
  const money = (v) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 2 }).format(Number(v) || 0)

  window.VMTerminalReserva = {
    async render(vm) {
      this._vm = vm
      const content = document.getElementById('page-content')
      if (!content) return
      document.body.classList.add('terminal-dashboard-active')
      content.innerHTML = '<div class="td-loading"><span></span><span></span><span></span></div>'
      try {
        const [data, hist] = await Promise.all([
          vm.api('GET', 'reserva'),
          vm.api('GET', 'reserva/historico').catch(() => ({ historico: [] }))
        ])
        this._data = data
        this._hist = hist.historico || []
        this._paint()
      } catch (e) {
        content.innerHTML = `<div class="td-error"><i class="fas fa-triangle-exclamation"></i><h2>Não foi possível carregar a Reserva</h2><p>${esc(e.response?.data?.error || 'Tente novamente.')}</p><button class="td-button td-button--primary" onclick="VM.pageReserva()">Tentar novamente</button></div>`
      }
    },
    reload() { this.render(this._vm) },

    _paint() {
      const content = document.getElementById('page-content')
      if (!content) return
      const d = this._data
      const r = d.reserva
      if (!r) return void (content.innerHTML = this._shell(this._empty()))

      const readonly = !!r.somente_leitura
      const cobertura = Number(d.cobertura_pct) || 0
      const meses = Number(d.meses_cobertos) || 0
      const obj = Number(r.objetivo_meses) || 6
      const solida = meses >= obj

      content.innerHTML = this._shell(`
        ${readonly ? `<div class="td-notice"><i class="fas fa-circle-info"></i><div><strong>Esta reserva é gerida em "Minhas Reservas".</strong><span>Aqui você acompanha; para depositar ou sacar, abra a tela de Minhas Reservas.</span></div></div>` : ''}
        <section class="re-hero ${solida ? 're-hero--ok' : ''}">
          <div class="re-hero__main">
            <span class="td-eyebrow">Reserva de emergência</span>
            <div class="re-hero__months">${meses.toFixed(1)} <em>${meses === 1 ? 'mês' : 'meses'}</em></div>
            <p>de despesas essenciais cobertos${d.media_gastos_mensais ? ` · média mensal ${money(d.media_gastos_mensais)}` : ''}</p>
          </div>
          <div class="re-hero__gauge">
            <div class="to-bar" style="height:12px"><span style="width:${Math.min(100, cobertura)}%;background:${solida ? 'var(--terminal-primary)' : 'var(--terminal-accent)'}"></span></div>
            <div class="re-hero__nums"><span>${money(r.valor_atual)}</span><span>meta ${money(d.valor_ideal)}</span></div>
            <div class="re-hero__pill"><span class="to-status to-status--${solida ? 'ok' : 'warn'}">${cobertura.toFixed(0)}% · objetivo ${obj} meses</span>${d.faltando > 0 ? `<small>faltam ${money(d.faltando)}</small>` : '<small>objetivo atingido 🎉</small>'}</div>
          </div>
        </section>

        <div class="re-actions">
          ${readonly
            ? `<button class="td-button td-button--primary" onclick="VM.navigate('reservas-esp')"><i class="fas fa-arrow-right"></i> Gerenciar em Minhas Reservas</button>`
            : `<button class="td-button td-button--primary" onclick="VMTerminalReserva.depositar(${Number(r.id)})"><i class="fas fa-plus"></i> Depositar</button>
               <button class="td-button" onclick="VMTerminalReserva.sacar(${Number(r.id)}, ${Number(r.valor_atual)})"><i class="fas fa-arrow-down"></i> Sacar</button>
               <button class="td-button" onclick="VMTerminalReserva.editarMeta(${Number(r.id)}, ${obj})"><i class="fas fa-bullseye"></i> Objetivo</button>`}
        </div>

        <article class="td-panel" style="margin-top:16px">
          <div class="td-panel__head"><div><span class="td-eyebrow">Extrato</span><h2>Movimentações</h2></div></div>
          ${this._hist.length ? `<div class="ap-list">${this._hist.map(h => this._row(h)).join('')}</div>` : '<div class="td-empty-row"><i class="fas fa-receipt"></i><span>Nenhuma movimentação ainda.</span></div>'}
        </article>
      `)
    },

    _row(h) {
      const dep = (h.tipo === 'deposito' || h.type === 'deposit' || Number(h.amount) > 0) && h.tipo !== 'saque' && h.type !== 'withdrawal'
      const valor = Number(h.valor ?? h.amount ?? 0)
      const desc = h.descricao || h.description || h.note || (dep ? 'Depósito' : 'Saque')
      const data = String(h.data || h.date || '').slice(0, 10)
      const d = data ? new Date(data + 'T12:00:00') : null
      const dlabel = d && !Number.isNaN(d.getTime()) ? d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }).replace('.', '') : '—'
      return `<div class="ap-row">
        <span class="ap-row__date">${dlabel}</span>
        <span class="ap-row__main"><strong>${esc(desc)}</strong><small>${dep ? 'entrada' : 'saída'}</small></span>
        <span class="ap-row__val" style="color:${dep ? 'var(--terminal-primary)' : 'var(--terminal-negative)'}">${dep ? '+' : '−'} ${money(Math.abs(valor))}</span>
      </div>`
    },

    _shell(inner) {
      return `<div class="td-dashboard re">
        <header class="td-dashboard__header">
          <div>
            <span class="td-eyebrow">Seu colchão de segurança</span>
            <h1>Reserva de emergência. <em>Durma tranquilo.</em></h1>
            <p>Quantos meses das suas despesas essenciais você já tem guardado.</p>
          </div>
        </header>
        ${inner}
      </div>`
    },

    _empty() {
      return `<section class="td-onboarding tm-empty"><div class="td-onboarding__copy">
        <span class="td-eyebrow">A base de tudo</span>
        <h2>Comece sua reserva de emergência.</h2>
        <p>De 3 a 6 meses das suas despesas essenciais, para imprevistos não virarem dívida.</p>
        <div class="td-onboarding__actions"><button class="td-button td-button--primary" onclick="VMTerminalReserva.criar()"><i class="fas fa-plus"></i> Criar minha reserva</button></div>
      </div></section>`
    },

    // ── ações ──
    _st() { return 'width:100%;background:var(--terminal-bg);border:1px solid var(--terminal-line);color:var(--terminal-ink);border-radius:var(--terminal-radius-sm);padding:10px 12px;font-size:13px;font-family:var(--terminal-font)' },
    _lab(t) { return `<label style="display:block;font:700 10px/1 var(--terminal-mono);letter-spacing:.1em;text-transform:uppercase;color:var(--terminal-ink-soft);margin-bottom:6px">${t}</label>` },
    criar() {
      const vm = this._vm, s = this._st()
      vm.showModal(`<div style="font-family:var(--terminal-font);color:var(--terminal-ink)">
        <div style="font-size:16px;font-weight:640">Criar reserva de emergência</div>
        <div style="color:var(--terminal-ink-soft);font-size:12px;margin:4px 0 18px">Defina o objetivo em meses e o valor que já tem</div>
        <div style="display:flex;flex-direction:column;gap:14px">
          <div style="display:flex;gap:10px">
            <div style="flex:1">${this._lab('Objetivo (meses)')}<input id="re-obj" type="number" min="1" max="36" style="${s}" value="6"></div>
            <div style="flex:1">${this._lab('Valor atual (R$)')}<input id="re-val" type="number" min="0" step="0.01" style="${s}" value="0"></div>
          </div>
          <div>${this._lab('Banco (opcional)')}<input id="re-banco" style="${s}" placeholder="Ex.: Nubank"></div>
          <div style="display:flex;gap:8px;margin-top:6px"><button class="td-button td-button--primary" style="flex:1" onclick="VMTerminalReserva.salvarCriar()"><i class="fas fa-check"></i> Criar</button><button class="td-button" onclick="VM.closeModal()">Cancelar</button></div>
        </div></div>`)
    },
    async salvarCriar() {
      const vm = this._vm
      const objetivo_meses = parseInt(document.getElementById('re-obj')?.value) || 6
      const valor_atual = parseFloat(document.getElementById('re-val')?.value) || 0
      const banco = document.getElementById('re-banco')?.value?.trim() || null
      const r = await vm.api('POST', 'reserva', { objetivo_meses, valor_atual, banco }).catch(e => ({ error: e.response?.data?.error }))
      if (r?.success) { vm.closeModal(); vm.toast('Reserva criada.', 'success'); this.reload() }
      else vm.toast(r?.error || 'Erro ao criar.', 'error')
    },
    async depositar(id) {
      const vm = this._vm
      const txt = window.prompt('Depositar quanto na reserva?', '')
      if (txt === null) return
      const valor = parseFloat(txt)
      if (!(valor > 0)) return vm.toast('Valor inválido.', 'error')
      const r = await vm.api('PATCH', `reserva/${id}/depositar`, { valor }).catch(e => ({ error: e.response?.data?.error }))
      if (r?.success) { vm.toast('Depósito registrado.', 'success'); this.reload() }
      else vm.toast(r?.error || 'Erro ao depositar.', 'error')
    },
    async sacar(id, disponivel) {
      const vm = this._vm
      const txt = window.prompt(`Sacar quanto? (disponível: ${money(disponivel)})`, '')
      if (txt === null) return
      const valor = parseFloat(txt)
      if (!(valor > 0)) return vm.toast('Valor inválido.', 'error')
      const r = await vm.api('PATCH', `reserva/${id}/sacar`, { valor }).catch(e => ({ error: e.response?.data?.error }))
      if (r?.success) { vm.toast('Saque registrado.', 'success'); this.reload() }
      else vm.toast(r?.error || 'Erro ao sacar.', 'error')
    },
    async editarMeta(id, atual) {
      const vm = this._vm
      const txt = window.prompt('Objetivo em meses (1–36):', String(atual))
      if (txt === null) return
      const m = parseInt(txt)
      if (!(m >= 1 && m <= 36)) return vm.toast('Informe de 1 a 36 meses.', 'error')
      const r = await vm.api('PATCH', `reserva/${id}/meta-meses`, { objetivo_meses: m }).catch(e => ({ error: e.response?.data?.error }))
      if (r?.success) { vm.toast('Objetivo atualizado.', 'success'); this.reload() }
      else vm.toast(r?.error || 'Erro ao atualizar.', 'error')
    }
  }
})()
