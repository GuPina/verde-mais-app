(function () {
  const esc = (v) => String(v ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;')
  const money = (v) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 2 }).format(Number(v) || 0)
  const TIPO_LBL = { conta: 'Conta', parcela: 'Parcela', fatura: 'Fatura', fatura_cartao: 'Fatura de cartão', emprestimo: 'Empréstimo', financiamento: 'Financiamento' }
  const dfmt = (d) => { const x = new Date(String(d || '').slice(0, 10) + 'T12:00:00'); return Number.isNaN(x.getTime()) ? '—' : x.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }).replace('.', '') }

  window.VMTerminalAntecipacao = {
    async render(vm) {
      this._vm = vm
      const content = document.getElementById('page-content')
      if (!content) return
      document.body.classList.add('terminal-dashboard-active')
      content.innerHTML = '<div class="td-loading"><span></span><span></span><span></span></div>'
      try {
        const [data, sug] = await Promise.all([
          vm.api('GET', 'antecipacao'),
          vm.api('GET', 'antecipacao/sugestoes').catch(() => ({ sugestoes: [] }))
        ])
        this._ant = data.antecipacoes || []
        this._totEco = Number(data.total_economizado) || 0
        this._totAnt = Number(data.total_antecipado) || 0
        this._sug = sug.sugestoes || []
        this._paint()
      } catch (e) {
        content.innerHTML = `<div class="td-error"><i class="fas fa-triangle-exclamation"></i><h2>Não foi possível carregar as antecipações</h2><p>${esc(e.response?.data?.error || 'Tente novamente.')}</p><button class="td-button td-button--primary" onclick="VMTerminalAntecipacao.reload()">Tentar novamente</button></div>`
      }
    },
    reload() { this.render(this._vm) },

    _paint() {
      const content = document.getElementById('page-content')
      if (!content) return
      const ant = this._ant, sug = this._sug
      const pend = ant.filter(a => a.status === 'pendente')
      const conf = ant.filter(a => a.status === 'antecipada')

      content.innerHTML = this._shell(`
        <section class="fe-hero">
          <div class="fe-hero__main">
            <span class="td-eyebrow">Total antecipado</span>
            <div class="fe-hero__big">${money(this._totAnt)}</div>
            <p>${conf.length} confirmada${conf.length === 1 ? '' : 's'} · ${pend.length} pendente${pend.length === 1 ? '' : 's'}</p>
          </div>
          <div class="fe-hero__gauge" style="text-align:right">
            <span class="td-eyebrow">Economia em juros</span>
            <div class="an-eco">${money(this._totEco)}</div>
            <small style="color:var(--terminal-ink-soft)">calculada no fechamento de cada antecipação</small>
          </div>
        </section>

        ${sug.length ? `
        <article class="td-panel" style="margin-top:18px">
          <div class="td-panel__head"><div><span class="td-eyebrow">Oportunidades</span><h2>Contas a vencer em até 60 dias</h2></div></div>
          <div class="an-sug">${sug.slice(0, 6).map(s => this._sugRow(s)).join('')}</div>
        </article>` : ''}

        <div class="mr-toolbar">
          <div><span class="td-eyebrow">Antecipações</span><h2>${ant.length} registro${ant.length === 1 ? '' : 's'}</h2></div>
          <button class="td-button td-button--primary" onclick="VMTerminalAntecipacao.nova()"><i class="fas fa-plus"></i> Nova antecipação</button>
        </div>

        ${ant.length ? `<div class="an-list">${ant.map(a => this._row(a)).join('')}</div>` : this._empty()}
      `)
    },

    _sugRow(s) {
      return `<div class="an-sug__row">
        <div class="an-sug__main"><strong>${esc(s.descricao)}</strong><small>vence ${dfmt(s.vencimento)} · ${s.dias_ate_vencimento} dia(s)${s.cartao_nome ? ' · ' + esc(s.cartao_nome) : ''}</small></div>
        <span class="an-sug__val">${money(s.valor)}</span>
        <button class="td-button td-button--sm td-button--primary" onclick="VMTerminalAntecipacao.anteciparSugestao(${Number(s.id)})"><i class="fas fa-bolt"></i> Antecipar</button>
      </div>`
    },

    _row(a) {
      const st = a.status
      const cls = st === 'antecipada' ? 'ok' : st === 'cancelada' ? 'neg' : 'warn'
      const lbl = st === 'antecipada' ? 'Confirmada' : st === 'cancelada' ? 'Cancelada' : 'Pendente'
      return `<article class="an-card">
        <div class="an-card__main">
          <strong>${esc(a.descricao)}</strong>
          <small>${esc(TIPO_LBL[a.tipo] || a.tipo || 'Conta')}${a.cartao_nome ? ' · ' + esc(a.cartao_nome) : ''} · antecipada em ${dfmt(a.data_antecipacao)}${a.data_vencimento_original ? ' (vencia ' + dfmt(a.data_vencimento_original) + ')' : ''}</small>
        </div>
        <div class="an-card__vals">
          <span class="an-card__val">${money(a.valor_total)}</span>
          ${Number(a.economia_juros) > 0 ? `<small class="an-card__eco">economia ${money(a.economia_juros)}</small>` : ''}
        </div>
        <span class="an-badge an-badge--${cls}">${lbl}</span>
        <div class="an-card__actions">
          ${st === 'pendente' ? `<button class="td-button td-button--sm td-button--primary" onclick="VMTerminalAntecipacao.confirmar(${Number(a.id)})"><i class="fas fa-check"></i> Confirmar</button>` : ''}
          ${st === 'antecipada' ? `<button class="td-button td-button--sm" onclick="VMTerminalAntecipacao.cancelar(${Number(a.id)}, '${esc(a.descricao).replace(/'/g, '')}')"><i class="fas fa-rotate-left"></i> Reverter</button>` : ''}
          <button class="td-button td-button--sm" onclick="VMTerminalAntecipacao.excluir(${Number(a.id)}, '${esc(a.descricao).replace(/'/g, '')}')"><i class="fas fa-trash"></i></button>
        </div>
      </article>`
    },

    _shell(inner) {
      return `<div class="td-dashboard an">
        <header class="td-dashboard__header">
          <div>
            <span class="td-eyebrow">Pague antes, pague menos</span>
            <h1>Antecipação de contas. <em>Menos juros, mais controle.</em></h1>
            <p>Traga uma conta futura para hoje e acompanhe quanto isso te poupa em juros.</p>
          </div>
        </header>
        ${inner}
      </div>`
    },

    _empty() {
      return `<section class="td-onboarding"><div class="td-onboarding__copy">
        <span class="td-eyebrow">Comece agora</span>
        <h2>Nenhuma antecipação ainda.</h2>
        <p>Registre um pagamento antecipado — de uma conta, parcela, fatura, empréstimo ou financiamento.</p>
        <div class="td-onboarding__actions"><button class="td-button td-button--primary" onclick="VMTerminalAntecipacao.nova()"><i class="fas fa-plus"></i> Nova antecipação</button></div>
      </div></section>`
    },

    _st() { return 'width:100%;background:var(--terminal-bg);border:1px solid var(--terminal-line);color:var(--terminal-ink);border-radius:var(--terminal-radius-sm);padding:10px 12px;font-size:13px;font-family:var(--terminal-font)' },
    _lab(t) { return `<label style="display:block;font:700 10px/1 var(--terminal-mono);letter-spacing:.1em;text-transform:uppercase;color:var(--terminal-ink-soft);margin-bottom:6px">${t}</label>` },

    nova(pre) {
      const s = this._st()
      const hoje = new Date().toISOString().slice(0, 10)
      const p = pre || {}
      const tipoOpts = Object.entries(TIPO_LBL).map(([k, l]) => `<option value="${k}" ${p.tipo === k ? 'selected' : ''}>${l}</option>`).join('')
      this._vm.showModal(`<div style="font-family:var(--terminal-font);color:var(--terminal-ink);min-width:min(440px,92vw)">
        <div style="font-size:16px;font-weight:640">Nova antecipação</div>
        <div style="color:var(--terminal-ink-soft);font-size:12px;margin:4px 0 18px">Traga uma conta futura para hoje</div>
        <div style="display:flex;flex-direction:column;gap:13px">
          <div>${this._lab('Descrição')}<input id="an-desc" style="${s}" value="${esc(p.descricao || '')}" placeholder="Ex.: Parcela financiamento"></div>
          <div style="display:flex;gap:10px">
            <div style="flex:1">${this._lab('Valor (R$)')}<input id="an-val" type="number" step="0.01" min="0.01" style="${s}" value="${p.valor || ''}"></div>
            <div style="flex:1">${this._lab('Tipo')}<select id="an-tipo" style="${s}">${tipoOpts}</select></div>
          </div>
          <div style="display:flex;gap:10px">
            <div style="flex:1">${this._lab('Antecipar em')}<input id="an-data" type="date" style="${s}" value="${hoje}"></div>
            <div style="flex:1">${this._lab('Vencia em (opc.)')}<input id="an-venc" type="date" style="${s}" value="${p.vencimento || ''}"></div>
          </div>
          <div>${this._lab('Economia de juros (opc., R$)')}<input id="an-eco" type="number" step="0.01" min="0" style="${s}" placeholder="0,00"></div>
          <label style="display:flex;align-items:center;gap:8px;font-size:12px;color:var(--terminal-ink-soft)"><input id="an-confirm" type="checkbox" checked> Confirmar agora (lança no mês atual)</label>
          <div style="display:flex;gap:8px;margin-top:6px"><button class="td-button td-button--primary" style="flex:1" onclick="VMTerminalAntecipacao.salvar(${p.refId ? Number(p.refId) : 0})"><i class="fas fa-check"></i> Registrar</button><button class="td-button" onclick="VM.closeModal()">Cancelar</button></div>
        </div></div>`)
    },
    anteciparSugestao(id) {
      const s = this._sug.find(x => Number(x.id) === Number(id))
      if (!s) return
      this.nova({ descricao: s.descricao, valor: s.valor, vencimento: String(s.vencimento || '').slice(0, 10), tipo: 'conta', refId: id })
    },
    async salvar(refId) {
      const vm = this._vm, g = i => document.getElementById(i)
      const valor = parseFloat(g('an-val')?.value)
      if (!g('an-desc')?.value?.trim()) return vm.toast('Informe a descrição.', 'error')
      if (!(valor > 0)) return vm.toast('Valor deve ser maior que zero.', 'error')
      const payload = {
        descricao: g('an-desc').value.trim(),
        valor_total: valor,
        tipo: g('an-tipo')?.value || 'conta',
        data_antecipacao: g('an-data')?.value,
        data_vencimento_original: g('an-venc')?.value || undefined,
        economia_juros: g('an-eco')?.value ? parseFloat(g('an-eco').value) : 0,
        status: g('an-confirm')?.checked ? 'antecipada' : 'pendente',
      }
      if (refId) { payload.referencia_id = Number(refId); payload.referencia_tipo = 'despesa' }
      const r = await vm.api('POST', 'antecipacao', payload).catch(e => ({ error: e.response?.data?.error }))
      if (r?.success) { vm.closeModal(); vm.toast(r.message || 'Antecipação registrada.', 'success'); this.reload() }
      else vm.toast(r?.error || 'Erro ao registrar.', 'error')
    },
    async confirmar(id) {
      const vm = this._vm
      if (!window.confirm('Confirmar esta antecipação? Ela será lançada como paga no mês atual.')) return
      const r = await vm.api('PATCH', `antecipacao/${id}/status`, { status: 'antecipada' }).catch(e => ({ error: e.response?.data?.error }))
      if (r?.success) { vm.toast('Antecipação confirmada.', 'success'); this.reload() }
      else vm.toast(r?.error || 'Erro ao confirmar.', 'error')
    },
    async cancelar(id, nome) {
      const vm = this._vm
      if (!window.confirm(`Reverter a antecipação "${nome}"? A conta original volta ao mês de origem e o lançamento antecipado é removido.`)) return
      const r = await vm.api('PATCH', `antecipacao/${id}/status`, { status: 'cancelada' }).catch(e => ({ error: e.response?.data?.error }))
      if (r?.success) { vm.toast('Antecipação revertida.', 'success'); this.reload() }
      else vm.toast(r?.error || 'Erro ao reverter.', 'error')
    },
    async excluir(id, nome) {
      const vm = this._vm
      if (!window.confirm(`Excluir a antecipação "${nome}"? Se estava confirmada, os efeitos são revertidos.`)) return
      const r = await vm.api('DELETE', `antecipacao/${id}`).catch(e => ({ error: e.response?.data?.error }))
      if (r?.success) { vm.toast('Antecipação removida.', 'success'); this.reload() }
      else vm.toast(r?.error || 'Erro ao excluir.', 'error')
    }
  }
})()
