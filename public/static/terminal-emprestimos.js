(function () {
  const esc = (v) => String(v ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;')
  const money = (v) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 2 }).format(Number(v) || 0)
  const TIPOS = [
    ['pessoal', 'Pessoal'], ['consignado', 'Consignado'], ['veiculo', 'Veículo'], ['estudantil', 'Estudantil'],
    ['microempresa', 'Microempresa'], ['amigos_familia', 'Amigos/Família'], ['imovel', 'Imóvel'],
    ['imovel_comercial', 'Imóvel comercial'], ['rural', 'Rural'], ['outros', 'Outros'],
  ]
  const TIPO_LBL = Object.fromEntries(TIPOS)

  window.VMTerminalEmprestimos = {
    async render(vm) {
      this._vm = vm
      const content = document.getElementById('page-content')
      if (!content) return
      document.body.classList.add('terminal-dashboard-active')
      content.innerHTML = '<div class="td-loading"><span></span><span></span><span></span></div>'
      try {
        const data = await vm.api('GET', 'emprestimos')
        this._emps = data.emprestimos || []
        this._resumo = data.resumo || {}
        this._paint()
      } catch (e) {
        content.innerHTML = `<div class="td-error"><i class="fas fa-triangle-exclamation"></i><h2>Não foi possível carregar os empréstimos</h2><p>${esc(e.response?.data?.error || 'Tente novamente.')}</p><button class="td-button td-button--primary" onclick="VMTerminalEmprestimos.reload()">Tentar novamente</button></div>`
      }
    },
    reload() { this.render(this._vm) },

    _paint() {
      const content = document.getElementById('page-content')
      if (!content) return
      const emps = this._emps
      if (!emps.length) return void (content.innerHTML = this._shell(this._empty()))

      const ativos = emps.filter(e => e.status === 'ativo' || e.status === 'em_atraso')
      const saldoTotal = Number(this._resumo.total_saldo_devedor) || ativos.reduce((s, e) => s + Number(e.saldo_devedor || 0), 0)
      const parcelaMes = Number(this._resumo.total_parcelas_mes) || ativos.reduce((s, e) => s + Number(e.valor_parcela || 0), 0)
      const totalOrig = emps.reduce((s, e) => s + Number(e.valor_original || 0), 0)
      const totalPago = emps.reduce((s, e) => s + (Number(e.valor_original || 0) - Number(e.saldo_devedor || 0)), 0)
      const pctPago = totalOrig > 0 ? Math.round((totalPago / totalOrig) * 100) : 0
      // maior taxa (candidato à quitação prioritária)
      const caro = ativos.slice().sort((a, b) => Number(b.taxa_juros_mensal) - Number(a.taxa_juros_mensal))[0]

      content.innerHTML = this._shell(`
        <section class="fe-hero">
          <div class="fe-hero__main">
            <span class="td-eyebrow">Saldo devedor total</span>
            <div class="fe-hero__big">${money(saldoTotal)}</div>
            <p>${ativos.length} empréstimo${ativos.length === 1 ? '' : 's'} ativo${ativos.length === 1 ? '' : 's'} · ${money(parcelaMes)}/mês em parcelas</p>
          </div>
          <div class="fe-hero__gauge">
            <div class="to-bar" style="height:12px"><span style="width:${Math.min(100, pctPago)}%;background:var(--terminal-primary)"></span></div>
            <div class="fe-hero__nums"><span class="to-status to-status--ok">${pctPago}% quitado</span><small>${money(totalPago)} de ${money(totalOrig)}</small></div>
          </div>
        </section>

        ${caro && Number(caro.taxa_juros_mensal) > 0 ? `<div class="td-notice"><i class="fas fa-fire"></i><div><strong>Quite primeiro: ${esc(caro.descricao)}.</strong><span>É o de maior juro (${Number(caro.taxa_juros_mensal).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}% a.m.) — cada real amortizado aqui rende mais.</span></div></div>` : ''}

        <div class="mr-toolbar">
          <div><span class="td-eyebrow">Contratos</span><h2>${emps.length} empréstimo${emps.length === 1 ? '' : 's'}</h2></div>
          <button class="td-button td-button--primary" onclick="VMTerminalEmprestimos.novo()"><i class="fas fa-plus"></i> Novo empréstimo</button>
        </div>

        <div class="fe-grid">${emps.map(e => this._card(e)).join('')}</div>
      `)
    },

    _card(e) {
      const pct = Number(e.numero_parcelas) > 0 ? Math.round((Number(e.parcelas_pagas) / Number(e.numero_parcelas)) * 100) : 0
      const quit = e.status === 'quitado'
      const atraso = e.status === 'em_atraso'
      const restam = Math.max(0, Number(e.numero_parcelas) - Number(e.parcelas_pagas))
      const cor = quit ? 'var(--terminal-primary)' : atraso ? 'var(--terminal-negative)' : pct >= 50 ? 'var(--terminal-primary)' : 'var(--terminal-accent)'
      return `<article class="fe-card ${quit ? 'fe-card--done' : ''}">
        <div class="fe-card__top">
          <div class="fe-card__id">
            <strong>${esc(e.descricao)}</strong>
            <small>${esc(TIPO_LBL[e.tipo] || e.tipo || 'Empréstimo')}${e.credor ? ' · ' + esc(e.credor) : ''}</small>
          </div>
          <span class="fe-badge ${atraso ? 'fe-badge--danger' : ''}">${atraso ? 'EM ATRASO' : Number(e.taxa_juros_mensal || 0).toLocaleString('pt-BR', { maximumFractionDigits: 2 }) + '% a.m.'}</span>
        </div>

        <div class="fe-card__saldo">
          <div><span class="fe-lbl">Saldo devedor</span><span class="fe-val fe-val--big">${money(e.saldo_devedor)}</span></div>
          <div><span class="fe-lbl">Parcela</span><span class="fe-val">${money(e.valor_parcela)}<em>/mês</em></span></div>
        </div>

        <div class="to-bar" style="height:8px"><span style="width:${Math.min(100, pct)}%;background:${cor}"></span></div>
        <div class="fe-card__meta">
          <span class="to-status to-status--${quit ? 'ok' : atraso ? 'warn' : pct >= 50 ? 'ok' : 'warn'}">${e.parcelas_pagas}/${e.numero_parcelas} pagas</span>
          <small>${quit ? 'quitado 🎉' : `faltam ${restam} · ${money(e.total_juros)} de juros`}</small>
        </div>

        <div class="fe-card__actions">
          ${quit ? '' : `<button class="td-button td-button--sm td-button--primary" onclick="VMTerminalEmprestimos.pagar(${Number(e.id)}, ${Number(e.parcelas_pagas)}, ${Number(e.numero_parcelas)})"><i class="fas fa-check"></i> Pagar parcela</button>
          <button class="td-button td-button--sm" onclick="VMTerminalEmprestimos.amortizar(${Number(e.id)})"><i class="fas fa-bolt"></i> Amortizar</button>
          <button class="td-button td-button--sm" onclick="VMTerminalEmprestimos.quitar(${Number(e.id)}, '${esc(e.descricao).replace(/'/g, '')}')"><i class="fas fa-flag-checkered"></i></button>`}
          <button class="td-button td-button--sm" onclick="VMTerminalEmprestimos.editar(${Number(e.id)})"><i class="fas fa-pen"></i></button>
          <button class="td-button td-button--sm" onclick="VMTerminalEmprestimos.excluir(${Number(e.id)}, '${esc(e.descricao).replace(/'/g, '')}')"><i class="fas fa-trash"></i></button>
        </div>
      </article>`
    },

    _shell(inner) {
      return `<div class="td-dashboard fe">
        <header class="td-dashboard__header">
          <div>
            <span class="td-eyebrow">Saia do vermelho</span>
            <h1>Empréstimos. <em>Um plano para zerar cada dívida.</em></h1>
            <p>Veja o custo real de cada empréstimo e ataque primeiro o que mais pesa.</p>
          </div>
        </header>
        ${inner}
      </div>`
    },

    _empty() {
      return `<section class="td-onboarding"><div class="td-onboarding__copy">
        <span class="td-eyebrow">Comece agora</span>
        <h2>Cadastre seus empréstimos.</h2>
        <p>Pessoal, consignado, com amigos — o VerdeMais mostra o saldo devedor, o custo efetivo e por onde começar a quitar.</p>
        <div class="td-onboarding__actions"><button class="td-button td-button--primary" onclick="VMTerminalEmprestimos.novo()"><i class="fas fa-plus"></i> Novo empréstimo</button></div>
      </div></section>`
    },

    // ── inputs ──
    _st() { return 'width:100%;background:var(--terminal-bg);border:1px solid var(--terminal-line);color:var(--terminal-ink);border-radius:var(--terminal-radius-sm);padding:10px 12px;font-size:13px;font-family:var(--terminal-font)' },
    _lab(t) { return `<label style="display:block;font:700 10px/1 var(--terminal-mono);letter-spacing:.1em;text-transform:uppercase;color:var(--terminal-ink-soft);margin-bottom:6px">${t}</label>` },

    _form(e) {
      const s = this._st(), v = e || {}
      const tipoOpts = TIPOS.map(([k, l]) => `<option value="${k}" ${v.tipo === k ? 'selected' : ''}>${l}</option>`).join('')
      return `<div style="font-family:var(--terminal-font);color:var(--terminal-ink);min-width:min(460px,92vw)">
        <div style="font-size:16px;font-weight:640">${e ? 'Editar empréstimo' : 'Novo empréstimo'}</div>
        <div style="color:var(--terminal-ink-soft);font-size:12px;margin:4px 0 18px">Preencha os dados do contrato</div>
        <div style="display:flex;flex-direction:column;gap:13px;max-height:64vh;overflow:auto;padding-right:4px">
          <div>${this._lab('Descrição')}<input id="e-desc" style="${s}" value="${esc(v.descricao || '')}" placeholder="Ex.: Empréstimo carro"></div>
          <div style="display:flex;gap:10px">
            <div style="flex:2">${this._lab('Credor')}<input id="e-credor" style="${s}" value="${esc(v.credor || '')}" placeholder="Ex.: Banco X"></div>
            <div style="flex:1">${this._lab('Tipo')}<select id="e-tipo" style="${s}">${tipoOpts}</select></div>
          </div>
          <div style="display:flex;gap:10px">
            <div style="flex:1">${this._lab('Valor tomado')}<input id="e-orig" type="number" step="0.01" min="0" style="${s}" value="${Number(v.valor_original) || ''}"></div>
            <div style="flex:1">${this._lab('Taxa % a.m.')}<input id="e-taxa" type="number" step="0.01" min="0" style="${s}" value="${Number(v.taxa_juros_mensal) || ''}"></div>
          </div>
          <div style="display:flex;gap:10px">
            <div style="flex:1">${this._lab('Nº parcelas')}<input id="e-np" type="number" min="1" max="600" style="${s}" value="${Number(v.numero_parcelas) || ''}"></div>
            <div style="flex:1">${this._lab('Já pagas')}<input id="e-pp" type="number" min="0" style="${s}" value="${Number(v.parcelas_pagas) || 0}"></div>
            <div style="flex:1">${this._lab('Valor parcela')}<input id="e-parc" type="number" step="0.01" min="0" style="${s}" value="${Number(v.valor_parcela) || ''}"></div>
          </div>
          <div style="display:flex;gap:10px">
            <div style="flex:1">${this._lab('Dia vencimento')}<input id="e-dia" type="number" min="1" max="31" style="${s}" value="${Number(v.dia_vencimento) || ''}"></div>
            <div style="flex:1">${this._lab('Início')}<input id="e-data" type="date" style="${s}" value="${String(v.data_inicio || '').slice(0, 10)}"></div>
          </div>
          <div style="display:flex;gap:8px;margin-top:6px">
            <button class="td-button td-button--primary" style="flex:1" onclick="VMTerminalEmprestimos.salvar(${e ? Number(v.id) : 0})"><i class="fas fa-check"></i> ${e ? 'Salvar' : 'Cadastrar'}</button>
            <button class="td-button" onclick="VM.closeModal()">Cancelar</button>
          </div>
        </div></div>`
    },
    novo() { this._vm.showModal(this._form(null)) },
    editar(id) { const e = this._emps.find(x => Number(x.id) === Number(id)); if (e) this._vm.showModal(this._form(e)) },
    async salvar(id) {
      const vm = this._vm, g = i => document.getElementById(i)
      const payload = {
        descricao: g('e-desc')?.value?.trim(),
        credor: g('e-credor')?.value?.trim() || null,
        tipo: g('e-tipo')?.value,
        valor_original: parseFloat(g('e-orig')?.value),
        taxa_juros_mensal: parseFloat(g('e-taxa')?.value),
        numero_parcelas: parseInt(g('e-np')?.value),
        parcelas_pagas: parseInt(g('e-pp')?.value) || 0,
        valor_parcela: parseFloat(g('e-parc')?.value),
        dia_vencimento: g('e-dia')?.value ? parseInt(g('e-dia').value) : null,
        data_inicio: g('e-data')?.value,
      }
      if (!payload.descricao) return vm.toast('Informe a descrição.', 'error')
      if (!(payload.valor_original > 0) || !(payload.numero_parcelas > 0) || !(payload.valor_parcela > 0)) return vm.toast('Preencha valor, parcelas e valor da parcela.', 'error')
      if (!payload.data_inicio) return vm.toast('Informe a data de início.', 'error')
      const r = id
        ? await vm.api('PUT', `emprestimos/${id}`, payload).catch(e => ({ error: e.response?.data?.error }))
        : await vm.api('POST', 'emprestimos', payload).catch(e => ({ error: e.response?.data?.error }))
      if (r?.success) { vm.closeModal(); vm.toast(id ? 'Empréstimo atualizado.' : 'Empréstimo cadastrado.', 'success'); this.reload() }
      else vm.toast(r?.error || 'Erro ao salvar.', 'error')
    },

    async pagar(id, pagas, total) {
      const vm = this._vm
      if (!window.confirm(`Registrar o pagamento da parcela ${Number(pagas) + 1}/${total}?`)) return
      const r = await vm.api('PATCH', `emprestimos/${id}/parcela`).catch(e => ({ error: e.response?.data?.error }))
      if (r?.success) { vm.toast(r.message || 'Parcela paga.', 'success'); this.reload() }
      else vm.toast(r?.error || 'Erro ao registrar pagamento.', 'error')
    },
    async amortizar(id) {
      const vm = this._vm
      const txt = window.prompt('Valor da amortização extraordinária (R$):', '')
      if (txt === null) return
      const valor = parseFloat(txt)
      if (!(valor > 0)) return vm.toast('Valor inválido.', 'error')
      const r = await vm.api('PATCH', `emprestimos/${id}/amortizacao`, { valor_amortizado: valor }).catch(e => ({ error: e.response?.data?.error }))
      if (r?.success) { vm.toast(r.message || 'Amortização aplicada.', 'success'); this.reload() }
      else vm.toast(r?.error || 'Erro ao amortizar.', 'error')
    },
    async quitar(id, nome) {
      const vm = this._vm
      if (!window.confirm(`Marcar "${nome}" como quitado? Todas as parcelas pendentes serão baixadas.`)) return
      const r = await vm.api('PATCH', `emprestimos/${id}/quitado`, {}).catch(e => ({ error: e.response?.data?.error }))
      if (r?.success) { vm.toast(r.message || 'Empréstimo quitado.', 'success'); this.reload() }
      else vm.toast(r?.error || 'Erro ao quitar.', 'error')
    },
    async excluir(id, nome) {
      const vm = this._vm
      if (!window.confirm(`Excluir o empréstimo "${nome}" e suas parcelas no fluxo de caixa?`)) return
      const r = await vm.api('DELETE', `emprestimos/${id}`).catch(e => ({ error: e.response?.data?.error }))
      if (r?.success) { vm.toast('Empréstimo removido.', 'success'); this.reload() }
      else vm.toast(r?.error || 'Erro ao excluir.', 'error')
    }
  }
})()
