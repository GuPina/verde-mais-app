(function () {
  const esc = (v) => String(v ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;')
  const money = (v) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 2 }).format(Number(v) || 0)
  const dfmt = (d) => { const x = new Date(String(d || '').slice(0, 10) + 'T12:00:00'); return Number.isNaN(x.getTime()) ? '' : x.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }).replace('.', '') }

  window.VMTerminalDespesasComp = {
    async render(vm) {
      this._vm = vm
      const content = document.getElementById('page-content')
      if (!content) return
      document.body.classList.add('terminal-dashboard-active')
      content.innerHTML = '<div class="td-loading"><span></span><span></span><span></span></div>'
      try {
        const [d, p] = await Promise.all([
          vm.api('GET', 'despesas-compartilhadas'),
          vm.api('GET', 'despesas-compartilhadas/resumo/pendencias').catch(() => ({ pendencias_por_parceiro: [], total_a_receber: 0 }))
        ])
        this._itens = d.despesas || []
        this._resumo = d.resumo || {}
        this._pend = p
        this._paint()
      } catch (e) {
        content.innerHTML = `<div class="td-error"><i class="fas fa-triangle-exclamation"></i><h2>Não foi possível carregar</h2><p>${esc(e.response?.data?.error || 'Tente novamente.')}</p><button class="td-button td-button--primary" onclick="VMTerminalDespesasComp.reload()">Tentar novamente</button></div>`
      }
    },
    reload() { this.render(this._vm) },

    _paint() {
      const content = document.getElementById('page-content')
      if (!content) return
      const it = this._itens
      const aReceber = Number(this._pend?.total_a_receber) || 0
      const pend = this._pend?.pendencias_por_parceiro || []

      content.innerHTML = this._shell(`
        <section class="fe-hero">
          <div class="fe-hero__main">
            <span class="td-eyebrow">A receber de parceiros</span>
            <div class="fe-hero__big">${money(aReceber)}</div>
            <p>${(this._resumo.pendentes || 0)} divisão(ões) pendente(s) de ${this._resumo.total || 0} no total</p>
          </div>
          <div class="fe-hero__gauge" style="max-width:280px">
            ${pend.length ? pend.slice(0, 4).map(p => `<div class="dc-pend"><span>${esc(p.partner_name)}</span><strong>${money(p.total_a_receber)}</strong></div>`).join('') : '<small style="color:var(--terminal-ink-soft)">ninguém te devendo 🎉</small>'}
          </div>
        </section>

        <div class="mr-toolbar">
          <div><span class="td-eyebrow">Divisões</span><h2>${it.length} conta${it.length === 1 ? '' : 's'} dividida${it.length === 1 ? '' : 's'}</h2></div>
          <button class="td-button td-button--primary" onclick="VMTerminalDespesasComp.nova()"><i class="fas fa-plus"></i> Dividir uma conta</button>
        </div>

        ${it.length ? `<div class="an-list">${it.map(x => this._row(x)).join('')}</div>` : this._empty()}
      `)
    },

    _row(x) {
      const settled = x.status === 'settled'
      return `<article class="an-card">
        <div class="an-card__main">
          <strong>${esc(x.descricao || 'Conta dividida')}</strong>
          <small>com ${esc(x.partner_name)} · ${esc(x.categoria || '')}${x.data ? ' · ' + dfmt(x.data) : ''} · total ${money(x.total_conta)}</small>
        </div>
        <div class="an-card__vals">
          <span class="an-card__val">${money(x.parte_parceiro)}</span>
          <small class="an-card__eco">parte de ${esc(x.partner_name.split(' ')[0])} (${Math.round(Number(x.partner_percentage) || 0)}%)</small>
        </div>
        <span class="an-badge an-badge--${settled ? 'ok' : 'warn'}">${settled ? 'quitado' : 'pendente'}</span>
        <div class="an-card__actions">
          ${settled ? '' : `<button class="td-button td-button--sm td-button--primary" onclick="VMTerminalDespesasComp.quitar(${Number(x.id)})"><i class="fas fa-check"></i> Recebi</button>`}
          <button class="td-button td-button--sm" onclick="VMTerminalDespesasComp.excluir(${Number(x.id)})"><i class="fas fa-trash"></i></button>
        </div>
      </article>`
    },

    _empty() {
      return `<section class="td-onboarding"><div class="td-onboarding__copy">
        <span class="td-eyebrow">Racha sem dor de cabeça</span>
        <h2>Divida uma conta com alguém.</h2>
        <p>Aluguel, jantar, viagem — registre a divisão, acompanhe quem te deve e marque quando receber.</p>
        <div class="td-onboarding__actions"><button class="td-button td-button--primary" onclick="VMTerminalDespesasComp.nova()"><i class="fas fa-plus"></i> Dividir uma conta</button></div>
      </div></section>`
    },

    _st() { return 'width:100%;background:var(--terminal-bg);border:1px solid var(--terminal-line);color:var(--terminal-ink);border-radius:var(--terminal-radius-sm);padding:10px 12px;font-size:13px;font-family:var(--terminal-font)' },
    _lab(t) { return `<label style="display:block;font:700 10px/1 var(--terminal-mono);letter-spacing:.1em;text-transform:uppercase;color:var(--terminal-ink-soft);margin-bottom:6px">${t}</label>` },

    nova() {
      const s = this._st(), hoje = new Date().toISOString().slice(0, 10)
      this._vm.showModal(`<div style="font-family:var(--terminal-font);color:var(--terminal-ink);min-width:min(440px,92vw)">
        <div style="font-size:16px;font-weight:640">Dividir uma conta</div>
        <div style="color:var(--terminal-ink-soft);font-size:12px;margin:4px 0 18px">Cria a despesa da sua parte e registra a divisão</div>
        <div style="display:flex;flex-direction:column;gap:13px">
          <div>${this._lab('Descrição')}<input id="dc-desc" style="${s}" placeholder="Ex.: Jantar aniversário"></div>
          <div style="display:flex;gap:10px">
            <div style="flex:1">${this._lab('Valor total (R$)')}<input id="dc-valor" type="number" min="0.01" step="0.01" style="${s}"></div>
            <div style="flex:1">${this._lab('Data')}<input id="dc-data" type="date" style="${s}" value="${hoje}"></div>
          </div>
          <div style="display:flex;gap:10px">
            <div style="flex:2">${this._lab('Dividir com')}<input id="dc-parceiro" style="${s}" placeholder="Nome"></div>
            <div style="flex:1">${this._lab('Sua parte (%)')}<input id="dc-pct" type="number" min="0" max="100" style="${s}" value="50"></div>
          </div>
          <div>${this._lab('Categoria')}<input id="dc-cat" style="${s}" value="Outros"></div>
          <div style="display:flex;gap:8px;margin-top:6px"><button class="td-button td-button--primary" style="flex:1" onclick="VMTerminalDespesasComp.salvar()"><i class="fas fa-check"></i> Dividir</button><button class="td-button" onclick="VM.closeModal()">Cancelar</button></div>
        </div></div>`)
    },
    async salvar() {
      const vm = this._vm, g = i => document.getElementById(i)
      const valor = parseFloat(g('dc-valor')?.value)
      if (!g('dc-desc')?.value?.trim()) return vm.toast('Informe a descrição.', 'error')
      if (!(valor > 0)) return vm.toast('Valor deve ser maior que zero.', 'error')
      if (!g('dc-parceiro')?.value?.trim()) return vm.toast('Informe com quem dividir.', 'error')
      const payload = {
        criar_despesa: true,
        descricao: g('dc-desc').value.trim(),
        valor, data: g('dc-data')?.value,
        categoria: g('dc-cat')?.value?.trim() || 'Outros',
        partner_name: g('dc-parceiro').value.trim(),
        user_percentage: parseFloat(g('dc-pct')?.value) || 50,
      }
      const r = await vm.api('POST', 'despesas-compartilhadas', payload).catch(e => ({ error: e.response?.data?.error }))
      if (r?.success) { vm.closeModal(); vm.toast(r.message || 'Conta dividida.', 'success'); this.reload() }
      else vm.toast(r?.error || 'Erro ao dividir.', 'error')
    },
    async quitar(id) {
      const vm = this._vm
      const r = await vm.api('PATCH', `despesas-compartilhadas/${id}/status`, { status: 'settled' }).catch(e => ({ error: e.response?.data?.error }))
      if (r?.success) { vm.toast('Marcado como recebido.', 'success'); this.reload() }
      else vm.toast(r?.error || 'Erro.', 'error')
    },
    async excluir(id) {
      const vm = this._vm
      if (!window.confirm('Remover esta divisão?')) return
      const r = await vm.api('DELETE', `despesas-compartilhadas/${id}`).catch(e => ({ error: e.response?.data?.error }))
      if (r?.success) { vm.toast('Divisão removida.', 'success'); this.reload() }
      else vm.toast(r?.error || 'Erro.', 'error')
    },

    _shell(inner) {
      return `<div class="td-dashboard dc">
        <header class="td-dashboard__header">
          <div>
            <span class="td-eyebrow">Cada um paga a sua parte</span>
            <h1>Despesas compartilhadas. <em>Racha justo, conta certa.</em></h1>
            <p>Divida uma conta, veja quanto cada um deve e acompanhe quem já acertou.</p>
          </div>
        </header>
        ${inner}
      </div>`
    }
  }
})()
