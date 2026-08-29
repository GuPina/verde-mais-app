(function () {
  const esc = (v) => String(v ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;')
  const money = (v) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 2 }).format(Number(v) || 0)
  const BEM = { imovel: '🏠 Imóvel', imovel_comercial: '🏢 Imóvel comercial', veiculo: '🚗 Veículo', rural: '🌾 Rural', outros: '📦 Outros' }
  const SIST = { price: 'PRICE', sac: 'SAC', sacre: 'SACRE' }

  window.VMTerminalFinanciamentos = {
    async render(vm) {
      this._vm = vm
      const content = document.getElementById('page-content')
      if (!content) return
      document.body.classList.add('terminal-dashboard-active')
      content.innerHTML = '<div class="td-loading"><span></span><span></span><span></span></div>'
      try {
        const data = await vm.api('GET', 'financiamentos')
        this._fins = data.financiamentos || []
        this._resumo = data.resumo || {}
        this._paint()
      } catch (e) {
        content.innerHTML = `<div class="td-error"><i class="fas fa-triangle-exclamation"></i><h2>Não foi possível carregar os financiamentos</h2><p>${esc(e.response?.data?.error || 'Tente novamente.')}</p><button class="td-button td-button--primary" onclick="VMTerminalFinanciamentos.reload()">Tentar novamente</button></div>`
      }
    },
    reload() { this.render(this._vm) },

    _paint() {
      const content = document.getElementById('page-content')
      if (!content) return
      const fins = this._fins
      if (!fins.length) return void (content.innerHTML = this._shell(this._empty()))

      const ativos = fins.filter(f => f.status === 'ativo')
      const saldoTotal = Number(this._resumo.total_saldo_devedor) || ativos.reduce((s, f) => s + Number(f.saldo_devedor || 0), 0)
      const parcelaMes = Number(this._resumo.total_parcelas_mes) || ativos.reduce((s, f) => s + Number(f.valor_parcela || 0), 0)
      const totalFinanciado = fins.reduce((s, f) => s + Number(f.valor_financiado || 0), 0)
      const totalPago = fins.reduce((s, f) => s + (Number(f.valor_financiado || 0) - Number(f.saldo_devedor || 0)), 0)
      const pctPago = totalFinanciado > 0 ? Math.round((totalPago / totalFinanciado) * 100) : 0

      content.innerHTML = this._shell(`
        <section class="fe-hero">
          <div class="fe-hero__main">
            <span class="td-eyebrow">Saldo devedor total</span>
            <div class="fe-hero__big">${money(saldoTotal)}</div>
            <p>${ativos.length} financiamento${ativos.length === 1 ? '' : 's'} ativo${ativos.length === 1 ? '' : 's'} · compromete ${money(parcelaMes)}/mês</p>
          </div>
          <div class="fe-hero__gauge">
            <div class="to-bar" style="height:12px"><span style="width:${Math.min(100, pctPago)}%;background:var(--terminal-primary)"></span></div>
            <div class="fe-hero__nums"><span class="to-status to-status--ok">${pctPago}% amortizado</span><small>${money(totalPago)} de ${money(totalFinanciado)}</small></div>
          </div>
        </section>

        <div class="mr-toolbar">
          <div><span class="td-eyebrow">Contratos</span><h2>${fins.length} financiamento${fins.length === 1 ? '' : 's'}</h2></div>
          <button class="td-button td-button--primary" onclick="VMTerminalFinanciamentos.novo()"><i class="fas fa-plus"></i> Novo financiamento</button>
        </div>

        <div class="fe-grid">${fins.map(f => this._card(f)).join('')}</div>
      `)
    },

    _card(f) {
      const pct = Number(f.numero_parcelas) > 0 ? Math.round((Number(f.parcelas_pagas) / Number(f.numero_parcelas)) * 100) : 0
      const quit = f.status === 'quitado'
      const restam = Number(f.numero_parcelas) - Number(f.parcelas_pagas)
      const cor = quit ? 'var(--terminal-primary)' : pct >= 50 ? 'var(--terminal-primary)' : 'var(--terminal-accent)'
      return `<article class="fe-card ${quit ? 'fe-card--done' : ''}">
        <div class="fe-card__top">
          <div class="fe-card__id">
            <strong>${esc(f.descricao)}</strong>
            <small>${esc(BEM[f.tipo_bem] || f.tipo_bem || 'Financiamento')}${f.banco ? ' · ' + esc(f.banco) : ''}</small>
          </div>
          <span class="fe-badge">${esc(SIST[String(f.sistema_amortizacao || '').toLowerCase()] || 'PRICE')}</span>
        </div>

        <div class="fe-card__saldo">
          <div><span class="fe-lbl">Saldo devedor</span><span class="fe-val fe-val--big">${money(f.saldo_devedor)}</span></div>
          <div><span class="fe-lbl">Parcela</span><span class="fe-val">${money(f.valor_parcela)}<em>/mês</em></span></div>
        </div>

        <div class="to-bar" style="height:8px"><span style="width:${Math.min(100, pct)}%;background:${cor}"></span></div>
        <div class="fe-card__meta">
          <span class="to-status to-status--${pct >= 50 ? 'ok' : 'warn'}">${f.parcelas_pagas}/${f.numero_parcelas} pagas</span>
          <small>${quit ? 'quitado 🎉' : `faltam ${restam} · ${Number(f.taxa_juros_anual || 0).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}% a.a.`}</small>
        </div>

        <div class="fe-card__actions">
          ${quit ? '' : `<button class="td-button td-button--sm td-button--primary" onclick="VMTerminalFinanciamentos.pagar(${Number(f.id)}, ${Number(f.parcelas_pagas)}, ${Number(f.numero_parcelas)})"><i class="fas fa-check"></i> Pagar parcela</button>
          <button class="td-button td-button--sm" onclick="VMTerminalFinanciamentos.amortizar(${Number(f.id)})"><i class="fas fa-bolt"></i> Amortizar</button>`}
          <button class="td-button td-button--sm" onclick="VMTerminalFinanciamentos.editar(${Number(f.id)})"><i class="fas fa-pen"></i></button>
          <button class="td-button td-button--sm" onclick="VMTerminalFinanciamentos.excluir(${Number(f.id)}, '${esc(f.descricao).replace(/'/g, '')}')"><i class="fas fa-trash"></i></button>
        </div>
      </article>`
    },

    _shell(inner) {
      return `<div class="td-dashboard fe">
        <header class="td-dashboard__header">
          <div>
            <span class="td-eyebrow">Dívida com propósito</span>
            <h1>Financiamentos. <em>Cada parcela mais perto do fim.</em></h1>
            <p>Acompanhe o saldo devedor, amortize com estratégia e veja a dívida encolher.</p>
          </div>
        </header>
        ${inner}
      </div>`
    },

    _empty() {
      return `<section class="td-onboarding"><div class="td-onboarding__copy">
        <span class="td-eyebrow">Comece agora</span>
        <h2>Cadastre seu primeiro financiamento.</h2>
        <p>Imóvel, carro ou obra — o VerdeMais gera as parcelas no seu fluxo e mostra o saldo devedor real.</p>
        <div class="td-onboarding__actions"><button class="td-button td-button--primary" onclick="VMTerminalFinanciamentos.novo()"><i class="fas fa-plus"></i> Novo financiamento</button></div>
      </div></section>`
    },

    // ── inputs ──
    _st() { return 'width:100%;background:var(--terminal-bg);border:1px solid var(--terminal-line);color:var(--terminal-ink);border-radius:var(--terminal-radius-sm);padding:10px 12px;font-size:13px;font-family:var(--terminal-font)' },
    _lab(t) { return `<label style="display:block;font:700 10px/1 var(--terminal-mono);letter-spacing:.1em;text-transform:uppercase;color:var(--terminal-ink-soft);margin-bottom:6px">${t}</label>` },

    _form(f) {
      const s = this._st(), v = f || {}
      const bemOpts = Object.entries(BEM).map(([k, l]) => `<option value="${k}" ${v.tipo_bem === k ? 'selected' : ''}>${l}</option>`).join('')
      const sistOpts = Object.entries(SIST).map(([k, l]) => `<option value="${k}" ${String(v.sistema_amortizacao || 'price').toLowerCase() === k ? 'selected' : ''}>${l}</option>`).join('')
      return `<div style="font-family:var(--terminal-font);color:var(--terminal-ink);min-width:min(480px,92vw)">
        <div style="font-size:16px;font-weight:640">${f ? 'Editar financiamento' : 'Novo financiamento'}</div>
        <div style="color:var(--terminal-ink-soft);font-size:12px;margin:4px 0 18px">Preencha os dados do contrato</div>
        <div style="display:flex;flex-direction:column;gap:13px;max-height:64vh;overflow:auto;padding-right:4px">
          <div>${this._lab('Descrição')}<input id="f-desc" style="${s}" value="${esc(v.descricao || '')}" placeholder="Ex.: Apto Jardins"></div>
          <div style="display:flex;gap:10px">
            <div style="flex:2">${this._lab('Banco')}<input id="f-banco" style="${s}" value="${esc(v.banco || '')}" placeholder="Ex.: Caixa"></div>
            <div style="flex:1">${this._lab('Tipo')}<select id="f-bem" style="${s}">${bemOpts}</select></div>
          </div>
          <div style="display:flex;gap:10px">
            <div style="flex:1">${this._lab('Valor do bem')}<input id="f-imovel" type="number" step="0.01" min="0" style="${s}" value="${Number(v.valor_imovel) || ''}"></div>
            <div style="flex:1">${this._lab('Entrada')}<input id="f-entrada" type="number" step="0.01" min="0" style="${s}" value="${Number(v.valor_entrada) || 0}"></div>
            <div style="flex:1">${this._lab('Financiado')}<input id="f-fin" type="number" step="0.01" min="0" style="${s}" value="${Number(v.valor_financiado) || ''}"></div>
          </div>
          <div style="display:flex;gap:10px">
            <div style="flex:1">${this._lab('Taxa % a.a.')}<input id="f-taxa" type="number" step="0.01" min="0" style="${s}" value="${Number(v.taxa_juros_anual) || ''}"></div>
            <div style="flex:1">${this._lab('Nº parcelas')}<input id="f-np" type="number" min="1" max="600" style="${s}" value="${Number(v.numero_parcelas) || ''}"></div>
            <div style="flex:1">${this._lab('Já pagas')}<input id="f-pp" type="number" min="0" style="${s}" value="${Number(v.parcelas_pagas) || 0}"></div>
          </div>
          <div style="display:flex;gap:10px">
            <div style="flex:1">${this._lab('Valor da parcela')}<input id="f-parc" type="number" step="0.01" min="0" style="${s}" value="${Number(v.valor_parcela) || ''}"></div>
            <div style="flex:1">${this._lab('Sistema')}<select id="f-sist" style="${s}">${sistOpts}</select></div>
            <div style="flex:1">${this._lab('Início')}<input id="f-data" type="date" style="${s}" value="${String(v.data_inicio || '').slice(0, 10)}"></div>
          </div>
          <div style="display:flex;gap:8px;margin-top:6px">
            <button class="td-button td-button--primary" style="flex:1" onclick="VMTerminalFinanciamentos.salvar(${f ? Number(v.id) : 0})"><i class="fas fa-check"></i> ${f ? 'Salvar' : 'Cadastrar'}</button>
            <button class="td-button" onclick="VM.closeModal()">Cancelar</button>
          </div>
        </div></div>`
    },
    novo() { this._vm.showModal(this._form(null)) },
    editar(id) { const f = this._fins.find(x => Number(x.id) === Number(id)); if (f) this._vm.showModal(this._form(f)) },
    async salvar(id) {
      const vm = this._vm, g = i => document.getElementById(i)
      const payload = {
        descricao: g('f-desc')?.value?.trim(),
        banco: g('f-banco')?.value?.trim() || null,
        tipo_bem: g('f-bem')?.value,
        valor_imovel: parseFloat(g('f-imovel')?.value),
        valor_entrada: parseFloat(g('f-entrada')?.value) || 0,
        valor_financiado: parseFloat(g('f-fin')?.value),
        taxa_juros_anual: parseFloat(g('f-taxa')?.value),
        numero_parcelas: parseInt(g('f-np')?.value),
        parcelas_pagas: parseInt(g('f-pp')?.value) || 0,
        valor_parcela: parseFloat(g('f-parc')?.value),
        sistema_amortizacao: g('f-sist')?.value,
        data_inicio: g('f-data')?.value,
      }
      if (!payload.descricao) return vm.toast('Informe a descrição.', 'error')
      if (!(payload.valor_financiado > 0) || !(payload.numero_parcelas > 0) || !(payload.valor_parcela > 0)) return vm.toast('Preencha valores, parcelas e valor da parcela.', 'error')
      if (!payload.data_inicio) return vm.toast('Informe a data de início.', 'error')
      const r = id
        ? await vm.api('PUT', `financiamentos/${id}`, payload).catch(e => ({ error: e.response?.data?.error }))
        : await vm.api('POST', 'financiamentos', payload).catch(e => ({ error: e.response?.data?.error }))
      if (r?.success) { vm.closeModal(); vm.toast(id ? 'Financiamento atualizado.' : 'Financiamento cadastrado.', 'success'); this.reload() }
      else vm.toast(r?.error || 'Erro ao salvar.', 'error')
    },

    async pagar(id, pagas, total) {
      const vm = this._vm
      if (!window.confirm(`Registrar o pagamento da parcela ${Number(pagas) + 1}/${total}?`)) return
      const r = await vm.api('PATCH', `financiamentos/${id}/parcela`).catch(e => ({ error: e.response?.data?.error }))
      if (r?.success) { vm.toast(r.message || 'Parcela paga.', 'success'); this.reload() }
      else vm.toast(r?.error || 'Erro ao registrar pagamento.', 'error')
    },
    async amortizar(id) {
      const vm = this._vm
      const txt = window.prompt('Valor da amortização extraordinária (R$):', '')
      if (txt === null) return
      const valor = parseFloat(txt)
      if (!(valor > 0)) return vm.toast('Valor inválido.', 'error')
      const r = await vm.api('PATCH', `financiamentos/${id}/amortizacao`, { valor }).catch(e => ({ error: e.response?.data?.error }))
      if (r?.success) { vm.toast(r.message || 'Amortização aplicada.', 'success'); this.reload() }
      else vm.toast(r?.error || 'Erro ao amortizar.', 'error')
    },
    async excluir(id, nome) {
      const vm = this._vm
      if (!window.confirm(`Excluir o financiamento "${nome}" e todas as suas parcelas no fluxo de caixa?`)) return
      const r = await vm.api('DELETE', `financiamentos/${id}`).catch(e => ({ error: e.response?.data?.error }))
      if (r?.success) { vm.toast('Financiamento removido.', 'success'); this.reload() }
      else vm.toast(r?.error || 'Erro ao excluir.', 'error')
    }
  }
})()
