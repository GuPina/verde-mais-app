(function () {
  const esc = (v) => String(v ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;')
  const money = (v) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 2 }).format(Number(v) || 0)

  const INFO = {
    emergency:    { icon: '🚨', label: 'Emergência geral' },
    health:       { icon: '🏥', label: 'Fundo saúde' },
    unemployment: { icon: '💼', label: 'Proteção desemprego' },
    travel:       { icon: '✈️', label: 'Viagem' },
    education:    { icon: '🎓', label: 'Educação' },
    vehicle:      { icon: '🚗', label: 'Veículo' },
    family:       { icon: '🏠', label: 'Família' },
    event:        { icon: '💍', label: 'Evento especial' },
    custom:       { icon: '🎯', label: 'Personalizada' },
  }
  const TIPOS = [
    ['emergency', '🚨 Emergência geral'], ['unemployment', '💼 Desemprego'], ['health', '🏥 Saúde'],
    ['travel', '✈️ Viagem'], ['education', '🎓 Educação'], ['vehicle', '🚗 Veículo'],
    ['family', '🏠 Família'], ['event', '💍 Evento'], ['custom', '🎯 Personalizada'],
  ]

  window.VMTerminalReservasEsp = {
    async render(vm) {
      this._vm = vm
      const content = document.getElementById('page-content')
      if (!content) return
      document.body.classList.add('terminal-dashboard-active')
      content.innerHTML = '<div class="td-loading"><span></span><span></span><span></span></div>'
      try {
        const data = await vm.api('GET', 'reservas-esp')
        this._reserves = data.reserves || []
        this._summary = data.summary || {}
        this._paint()
      } catch (e) {
        content.innerHTML = `<div class="td-error"><i class="fas fa-triangle-exclamation"></i><h2>Não foi possível carregar suas reservas</h2><p>${esc(e.response?.data?.error || 'Tente novamente.')}</p><button class="td-button td-button--primary" onclick="VMTerminalReservasEsp.reload()">Tentar novamente</button></div>`
      }
    },
    reload() { this.render(this._vm) },

    _paint() {
      const content = document.getElementById('page-content')
      if (!content) return
      const rs = this._reserves, s = this._summary
      if (!rs.length) return void (content.innerHTML = this._shell(this._empty()))

      const plano = this._vm.user?.plano || 'free'
      const limite = plano === 'free' ? 1 : plano === 'premium' ? 3 : 99
      const ativas = rs.filter(r => r.status === 'active' || r.status === 'paused').length
      const podeCriar = ativas < limite

      content.innerHTML = this._shell(`
        <section class="mr-summary">
          <div class="mr-summary__main">
            <span class="td-eyebrow">Total guardado</span>
            <div class="mr-summary__big">${money(s.total_saved)}</div>
            <p>de ${money(s.total_target)} em ${rs.length} reserva${rs.length === 1 ? '' : 's'} · faltam ${money(s.total_remaining)}</p>
          </div>
          <div class="mr-summary__gauge">
            <div class="to-bar" style="height:12px"><span style="width:${Math.min(100, Number(s.overall_progress) || 0)}%;background:var(--terminal-primary)"></span></div>
            <div class="mr-summary__nums"><span class="to-status to-status--ok">${Number(s.overall_progress) || 0}% do total</span><small>${s.completed_count || 0} concluída${(s.completed_count || 0) === 1 ? '' : 's'}</small></div>
          </div>
        </section>

        <div class="mr-toolbar">
          <div><span class="td-eyebrow">Minhas reservas</span><h2>${ativas} ativa${ativas === 1 ? '' : 's'} de ${limite === 99 ? '∞' : limite}</h2></div>
          <button class="td-button td-button--primary" ${podeCriar ? '' : 'disabled title="Limite do plano atingido"'} onclick="VMTerminalReservasEsp.criar()"><i class="fas fa-plus"></i> Nova reserva</button>
        </div>

        <div class="mr-grid">
          ${rs.map(r => this._card(r)).join('')}
        </div>
      `)
    },

    _card(r) {
      const info = INFO[r.type] || INFO.custom
      const pct = Math.max(0, Math.min(100, Number(r.percent_complete) || 0))
      const done = r.status === 'completed'
      const cor = done ? 'var(--terminal-primary)' : pct >= 60 ? 'var(--terminal-primary)' : pct >= 30 ? 'var(--terminal-accent)' : 'var(--terminal-negative)'
      const prazo = r.deadline ? this._fmtPrazo(r.deadline) : ''
      const ritmo = (Number(r.monthly_target) > 0 && Number(r.remaining) > 0)
        ? `no seu ritmo: ~${Math.ceil(Number(r.remaining) / Number(r.monthly_target))} mês(es)` : ''
      return `<article class="mr-card ${done ? 'mr-card--done' : ''}">
        <div class="mr-card__top">
          <span class="mr-card__icon">${info.icon}</span>
          <div class="mr-card__id">
            <strong>${esc(r.name)}</strong>
            <small>${esc(info.label)}${done ? ' · concluída 🎉' : ''}</small>
          </div>
          <div class="mr-card__menu">
            <button class="td-icon-btn" title="Editar" onclick="VMTerminalReservasEsp.editar(${Number(r.id)})"><i class="fas fa-pen"></i></button>
            <button class="td-icon-btn" title="Excluir" onclick="VMTerminalReservasEsp.excluir(${Number(r.id)}, '${esc(r.name).replace(/'/g, '')}')"><i class="fas fa-trash"></i></button>
          </div>
        </div>
        <div class="mr-card__vals">
          <span class="mr-card__cur">${money(r.current_amount)}</span>
          <span class="mr-card__tgt">meta ${money(r.target_amount)}</span>
        </div>
        <div class="to-bar" style="height:8px"><span style="width:${pct}%;background:${cor}"></span></div>
        <div class="mr-card__meta">
          <span class="to-status to-status--${pct >= 60 ? 'ok' : 'warn'}">${pct}%</span>
          <small>${Number(r.remaining) > 0 ? `faltam ${money(r.remaining)}` : 'objetivo atingido'}</small>
          ${prazo ? `<small class="mr-card__prazo">${prazo}</small>` : ''}
        </div>
        ${ritmo ? `<div class="mr-card__ritmo">${ritmo}</div>` : ''}
        <div class="mr-card__actions">
          <button class="td-button td-button--sm td-button--primary" onclick="VMTerminalReservasEsp.depositar(${Number(r.id)}, '${esc(r.name).replace(/'/g, '')}')"><i class="fas fa-plus"></i> Depositar</button>
          <button class="td-button td-button--sm" ${Number(r.current_amount) > 0 ? '' : 'disabled'} onclick="VMTerminalReservasEsp.sacar(${Number(r.id)}, ${Number(r.current_amount)}, '${esc(r.name).replace(/'/g, '')}')"><i class="fas fa-arrow-down"></i> Sacar</button>
          <button class="td-button td-button--sm" onclick="VMTerminalReservasEsp.extrato(${Number(r.id)}, '${esc(r.name).replace(/'/g, '')}')"><i class="fas fa-receipt"></i> Extrato</button>
        </div>
      </article>`
    },

    _fmtPrazo(d) {
      const dt = new Date(String(d).slice(0, 10) + 'T12:00:00')
      if (Number.isNaN(dt.getTime())) return ''
      return 'até ' + dt.toLocaleDateString('pt-BR', { month: 'short', year: 'numeric' }).replace('.', '')
    },

    _shell(inner) {
      return `<div class="td-dashboard mr">
        <header class="td-dashboard__header">
          <div>
            <span class="td-eyebrow">Vários objetivos, um lugar</span>
            <h1>Minhas reservas. <em>Cada sonho no seu cofre.</em></h1>
            <p>Separe o dinheiro por objetivo e acompanhe cada um crescer.</p>
          </div>
        </header>
        ${inner}
      </div>`
    },

    _empty() {
      return `<section class="td-onboarding"><div class="td-onboarding__copy">
        <span class="td-eyebrow">Comece agora</span>
        <h2>Crie sua primeira reserva por objetivo.</h2>
        <p>Emergência, viagem, troca de carro — cada meta com seu próprio ritmo e prazo.</p>
        <div class="td-onboarding__actions"><button class="td-button td-button--primary" onclick="VMTerminalReservasEsp.criar()"><i class="fas fa-plus"></i> Criar reserva</button></div>
      </div></section>`
    },

    // ── inputs ──
    _st() { return 'width:100%;background:var(--terminal-bg);border:1px solid var(--terminal-line);color:var(--terminal-ink);border-radius:var(--terminal-radius-sm);padding:10px 12px;font-size:13px;font-family:var(--terminal-font)' },
    _lab(t) { return `<label style="display:block;font:700 10px/1 var(--terminal-mono);letter-spacing:.1em;text-transform:uppercase;color:var(--terminal-ink-soft);margin-bottom:6px">${t}</label>` },

    criar(pre) {
      const s = this._st()
      const opts = TIPOS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')
      this._vm.showModal(`<div style="font-family:var(--terminal-font);color:var(--terminal-ink);min-width:min(420px,90vw)">
        <div style="font-size:16px;font-weight:640">Nova reserva</div>
        <div style="color:var(--terminal-ink-soft);font-size:12px;margin:4px 0 18px">Dê um nome, escolha o tipo e defina a meta</div>
        <div style="display:flex;flex-direction:column;gap:14px">
          <div>${this._lab('Nome')}<input id="mr-nome" style="${s}" placeholder="Ex.: Viagem Europa 2027"></div>
          <div style="display:flex;gap:10px">
            <div style="flex:1">${this._lab('Tipo')}<select id="mr-tipo" style="${s}">${opts}</select></div>
            <div style="flex:1">${this._lab('Prioridade (1–5)')}<input id="mr-prio" type="number" min="1" max="5" style="${s}" value="3"></div>
          </div>
          <div style="display:flex;gap:10px">
            <div style="flex:1">${this._lab('Meta (R$)')}<input id="mr-meta" type="number" min="0.01" step="0.01" style="${s}" placeholder="0,00"></div>
            <div style="flex:1">${this._lab('Já tenho (R$)')}<input id="mr-atual" type="number" min="0" step="0.01" style="${s}" value="0"></div>
          </div>
          <div style="display:flex;gap:10px">
            <div style="flex:1">${this._lab('Aporte mensal (opc.)')}<input id="mr-aporte" type="number" min="0" step="0.01" style="${s}" placeholder="0,00"></div>
            <div style="flex:1">${this._lab('Prazo (opc.)')}<input id="mr-prazo" type="date" style="${s}"></div>
          </div>
          <div style="display:flex;gap:8px;margin-top:6px"><button class="td-button td-button--primary" style="flex:1" onclick="VMTerminalReservasEsp.salvarCriar()"><i class="fas fa-check"></i> Criar</button><button class="td-button" onclick="VM.closeModal()">Cancelar</button></div>
        </div></div>`)
    },
    async salvarCriar() {
      const vm = this._vm
      const g = id => document.getElementById(id)
      const nome = g('mr-nome')?.value?.trim()
      const meta_valor = parseFloat(g('mr-meta')?.value)
      if (!nome) return vm.toast('Informe um nome.', 'error')
      if (!(meta_valor > 0)) return vm.toast('Meta deve ser maior que zero.', 'error')
      const payload = {
        nome, tipo: g('mr-tipo')?.value || 'custom',
        prioridade: parseInt(g('mr-prio')?.value) || 3,
        meta_valor,
        valor_atual: parseFloat(g('mr-atual')?.value) || 0,
        aporte_mensal: g('mr-aporte')?.value ? parseFloat(g('mr-aporte').value) : undefined,
        prazo: g('mr-prazo')?.value || undefined,
      }
      const r = await vm.api('POST', 'reservas-esp', payload).catch(e => ({ error: e.response?.data?.error }))
      if (r?.success) { vm.closeModal(); vm.toast('Reserva criada.', 'success'); this.reload() }
      else vm.toast(r?.error || 'Erro ao criar.', 'error')
    },

    editar(id) {
      const r = this._reserves.find(x => Number(x.id) === Number(id))
      if (!r) return
      const s = this._st()
      const opts = TIPOS.map(([v, l]) => `<option value="${v}" ${r.type === v ? 'selected' : ''}>${l}</option>`).join('')
      this._vm.showModal(`<div style="font-family:var(--terminal-font);color:var(--terminal-ink);min-width:min(420px,90vw)">
        <div style="font-size:16px;font-weight:640">Editar reserva</div>
        <div style="color:var(--terminal-ink-soft);font-size:12px;margin:4px 0 18px">${esc(r.name)}</div>
        <div style="display:flex;flex-direction:column;gap:14px">
          <div>${this._lab('Nome')}<input id="mr-e-nome" style="${s}" value="${esc(r.name)}"></div>
          <div style="display:flex;gap:10px">
            <div style="flex:1">${this._lab('Tipo')}<select id="mr-e-tipo" style="${s}">${opts}</select></div>
            <div style="flex:1">${this._lab('Prioridade (1–5)')}<input id="mr-e-prio" type="number" min="1" max="5" style="${s}" value="${Number(r.priority) || 3}"></div>
          </div>
          <div style="display:flex;gap:10px">
            <div style="flex:1">${this._lab('Meta (R$)')}<input id="mr-e-meta" type="number" min="0.01" step="0.01" style="${s}" value="${Number(r.target_amount) || ''}"></div>
            <div style="flex:1">${this._lab('Saldo atual (R$)')}<input id="mr-e-atual" type="number" min="0" step="0.01" style="${s}" value="${Number(r.current_amount) || 0}"></div>
          </div>
          <div style="display:flex;gap:8px;margin-top:6px"><button class="td-button td-button--primary" style="flex:1" onclick="VMTerminalReservasEsp.salvarEditar(${Number(id)})"><i class="fas fa-check"></i> Salvar</button><button class="td-button" onclick="VM.closeModal()">Cancelar</button></div>
        </div></div>`)
    },
    async salvarEditar(id) {
      const vm = this._vm, g = i => document.getElementById(i)
      const meta_valor = parseFloat(g('mr-e-meta')?.value)
      if (!(meta_valor > 0)) return vm.toast('Meta deve ser maior que zero.', 'error')
      const payload = {
        nome: g('mr-e-nome')?.value?.trim(),
        tipo: g('mr-e-tipo')?.value,
        prioridade: parseInt(g('mr-e-prio')?.value) || 3,
        meta_valor,
        valor_atual: parseFloat(g('mr-e-atual')?.value) || 0,
      }
      const r = await vm.api('PUT', `reservas-esp/${id}`, payload).catch(e => ({ error: e.response?.data?.error }))
      if (r?.success) { vm.closeModal(); vm.toast('Reserva atualizada.', 'success'); this.reload() }
      else vm.toast(r?.error || 'Erro ao salvar.', 'error')
    },

    async depositar(id, nome) {
      const vm = this._vm
      const txt = window.prompt(`Depositar quanto em "${nome}"?`, '')
      if (txt === null) return
      const valor = parseFloat(txt)
      if (!(valor > 0)) return vm.toast('Valor inválido.', 'error')
      const r = await vm.api('POST', `reservas-esp/${id}/depositar`, { valor }).catch(e => ({ error: e.response?.data?.error }))
      if (r?.success) { vm.toast(r.message || 'Depósito registrado.', 'success'); this.reload() }
      else vm.toast(r?.error || 'Erro ao depositar.', 'error')
    },
    async sacar(id, disponivel, nome) {
      const vm = this._vm
      const txt = window.prompt(`Sacar quanto de "${nome}"? (disponível: ${money(disponivel)})`, '')
      if (txt === null) return
      const valor = parseFloat(txt)
      if (!(valor > 0)) return vm.toast('Valor inválido.', 'error')
      const r = await vm.api('POST', `reservas-esp/${id}/sacar`, { valor }).catch(e => ({ error: e.response?.data?.error }))
      if (r?.success) { vm.toast(r.message || 'Saque registrado.', 'success'); this.reload() }
      else vm.toast(r?.error || 'Erro ao sacar.', 'error')
    },
    async excluir(id, nome) {
      const vm = this._vm
      if (!window.confirm(`Excluir a reserva "${nome}"? O saldo vinculado a metas será devolvido.`)) return
      const r = await vm.api('DELETE', `reservas-esp/${id}`).catch(e => ({ error: e.response?.data?.error }))
      if (r?.success) { vm.toast('Reserva removida.', 'success'); this.reload() }
      else vm.toast(r?.error || 'Erro ao excluir.', 'error')
    },
    async extrato(id, nome) {
      const vm = this._vm
      const data = await vm.api('GET', `reservas-esp/${id}/historico`).catch(() => ({ transactions: [] }))
      const tx = data.transactions || []
      const rows = tx.length ? tx.map(t => {
        const dep = t.type === 'deposit'
        const dt = String(t.date || t.created_at || '').slice(0, 10)
        const d = dt ? new Date(dt + 'T12:00:00') : null
        const dl = d && !Number.isNaN(d.getTime()) ? d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }).replace('.', '') : '—'
        return `<div class="ap-row">
          <span class="ap-row__date">${dl}</span>
          <span class="ap-row__main"><strong>${esc(t.description || (dep ? 'Depósito' : 'Saque'))}</strong><small>${dep ? 'entrada' : 'saída'}</small></span>
          <span class="ap-row__val" style="color:${dep ? 'var(--terminal-primary)' : 'var(--terminal-negative)'}">${dep ? '+' : '−'} ${money(Math.abs(Number(t.amount) || 0))}</span>
        </div>`
      }).join('') : '<div class="td-empty-row"><i class="fas fa-receipt"></i><span>Nenhuma movimentação ainda.</span></div>'
      vm.showModal(`<div style="font-family:var(--terminal-font);color:var(--terminal-ink);min-width:min(460px,92vw)">
        <div style="font-size:16px;font-weight:640">Extrato — ${esc(nome)}</div>
        <div style="color:var(--terminal-ink-soft);font-size:12px;margin:4px 0 14px">Últimas movimentações</div>
        <div class="ap-list" style="max-height:52vh;overflow:auto">${rows}</div>
        <div style="margin-top:14px"><button class="td-button" onclick="VM.closeModal()">Fechar</button></div>
      </div>`)
    }
  }
})()
