(function () {
  const esc = (v) => String(v ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;')
  const money = (v) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 2 }).format(Number(v) || 0)
  const num = (v, d = 2) => Number(v || 0).toLocaleString('pt-BR', { maximumFractionDigits: d })
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
        content.innerHTML = `<div class="td-error"><i class="fas fa-triangle-exclamation"></i><h2>Não foi possível carregar os empréstimos</h2><p>${esc(e.response?.data?.error || 'Tente novamente.')}</p><button class="ds-btn ds-btn--primary" onclick="VMTerminalEmprestimos.reload()">Tentar novamente</button></div>`
      }
    },
    reload() { this.render(this._vm) },

    _paint() {
      const content = document.getElementById('page-content')
      if (!content) return
      const emps = this._emps
      if (!emps.length) return void (content.innerHTML = this._shell(this._empty()))

      const ativos = emps.filter(e => e.status === 'ativo' || e.status === 'em_atraso')
      // Uma fonte só para cada número. A versão anterior misturava
      // `total_saldo_devedor` do resumo, `valor_original − saldo_devedor` no
      // topo e `valor_pago` no card — três contas para a mesma dívida na mesma
      // tela.
      const faltaPagar = ativos.reduce((s, e) => s + Number(e.falta_pagar ?? e.saldo_devedor ?? 0), 0)
      const parcelaMes = ativos.reduce((s, e) => s + Number(e.valor_parcela || 0), 0)
      const totalContratado = emps.reduce((s, e) => s + Number(e.total_a_pagar || 0), 0)
      const jaPago = emps.reduce((s, e) => s + Number(e.valor_pago || 0), 0)
      const pctPago = totalContratado > 0 ? Math.round((jaPago / totalContratado) * 100) : 0
      const caro = ativos.slice().sort((a, b) => Number(b.taxa_juros_mensal) - Number(a.taxa_juros_mensal))[0]

      const avisos = []
      for (const e of emps) {
        if (e.conciliacao?.aviso) avisos.push({ tom: 'warn', ico: 'fa-scale-unbalanced', id: e.id, txt: e.conciliacao.aviso, acao: e.conciliacao })
        if (e.aviso_dados) avisos.push({ tom: 'info', ico: 'fa-circle-question', id: e.id, txt: e.aviso_dados })
      }

      content.innerHTML = this._shell(`
        <section class="fe-hero">
          <div class="fe-hero__main">
            <span class="td-eyebrow">Falta pagar</span>
            <div class="fe-hero__big">${money(faltaPagar)}</div>
            <p>${ativos.length} empréstimo${ativos.length === 1 ? '' : 's'} ativo${ativos.length === 1 ? '' : 's'} · ${money(parcelaMes)}/mês em parcelas</p>
          </div>
          <div class="fe-hero__gauge">
            <div class="ds-bar ds-bar--lg"><span style="width:${Math.min(100, pctPago)}%"></span></div>
            <div class="fe-hero__nums"><span class="ds-pill ds-pill--ok">${pctPago}% quitado</span><small>${money(jaPago)} de ${money(totalContratado)}</small></div>
          </div>
        </section>

        ${avisos.map(a => `<div class="ds-note ds-note--${a.tom} fe-aviso">
          <i class="fas ${a.ico} ds-note__ico"></i>
          <div>
            ${esc(a.txt)}
            ${a.acao ? `<div class="fe-aviso__acoes">
              <button class="ds-btn ds-btn--sm ds-btn--primary" onclick="VMTerminalEmprestimos.conciliar(${Number(a.id)})"><i class="fas fa-scale-balanced"></i> Conciliar</button>
            </div>` : ''}
          </div>
        </div>`).join('')}

        ${caro && Number(caro.juros_embutidos) > 0 ? `<div class="ds-note ds-note--info fe-aviso"><i class="fas fa-fire ds-note__ico"></i><div><strong>Quite primeiro: ${esc(caro.descricao)}.</strong> É o de maior juro (${num(caro.taxa_juros_mensal)}% a.m.) — cada real amortizado aqui rende mais.</div></div>` : ''}

        <div class="mr-toolbar">
          <div><span class="td-eyebrow">Contratos</span><h2>${emps.length} empréstimo${emps.length === 1 ? '' : 's'}</h2></div>
          <button class="ds-btn ds-btn--primary" onclick="VMTerminalEmprestimos.novo()"><i class="fas fa-plus"></i> Novo empréstimo</button>
        </div>

        <div class="fe-grid">${emps.map(e => this._card(e)).join('')}</div>
      `)
    },

    _card(e) {
      const n = Math.round(Number(e.numero_parcelas) || 0)
      const pagas = Math.round(Number(e.parcelas_pagas) || 0)
      const pct = n > 0 ? Math.round((pagas / n) * 100) : 0
      const quit = e.status === 'quitado'
      const atraso = e.status === 'em_atraso'
      const restam = Math.max(0, n - pagas)
      const juros = Number(e.juros_embutidos) || 0
      const falta = Number(e.falta_pagar ?? e.saldo_devedor ?? 0) || 0
      const tom = quit ? 'ok' : atraso ? 'neg' : pct >= 50 ? 'ok' : 'warn'

      return `<article class="fe-card ${quit ? 'fe-card--done' : ''}">
        <div class="fe-card__top">
          <div class="fe-card__id">
            <strong>${esc(e.descricao)}</strong>
            <small>${esc(TIPO_LBL[e.tipo] || e.tipo || 'Empréstimo')}${e.credor ? ' · ' + esc(e.credor) : ''}</small>
          </div>
          <span class="ds-pill ds-pill--${atraso ? 'neg' : juros > 0 ? 'warn' : 'info'}">${atraso ? 'em atraso' : juros > 0 ? num(e.taxa_juros_mensal) + '% a.m.' : 'sem juros'}</span>
        </div>

        <div class="fe-card__saldo">
          <div><span class="fe-lbl">Falta pagar</span><span class="fe-val fe-val--big">${money(falta)}</span></div>
          <div><span class="fe-lbl">Parcela</span><span class="fe-val">${money(e.valor_parcela)}<em>/mês</em></span></div>
        </div>

        <div class="ds-bar"><span style="width:${Math.min(100, pct)}%"></span></div>
        <div class="fe-card__meta">
          <span class="ds-pill ds-pill--${tom}">${pagas}/${n} pagas</span>
          <small>${quit ? 'quitado 🎉' : `faltam ${restam} parcela${restam === 1 ? '' : 's'}`}</small>
        </div>

        <dl class="fe-nums">
          <div><dt>Total do contrato</dt><dd>${money(e.total_a_pagar)}</dd></div>
          <div><dt>Já pago</dt><dd>${money(e.valor_pago)}</dd></div>
          ${juros > 0 ? `<div><dt>Juros embutidos</dt><dd>${money(juros)}</dd></div>` : ''}
          ${Number(e.amortizado_extra) > 0 ? `<div><dt>Amortizado à parte</dt><dd>${money(e.amortizado_extra)}</dd></div>` : ''}
          ${e.valor_quitacao_hoje ? `<div><dt>Quitando hoje</dt><dd>${money(e.valor_quitacao_hoje)}</dd></div>` : ''}
        </dl>

        <div class="fe-card__actions">
          ${quit ? '' : `
          <button class="ds-btn ds-btn--sm ds-btn--primary" onclick="VMTerminalEmprestimos.pagar(${Number(e.id)}, ${pagas}, ${n})"><i class="fas fa-check"></i> Pagar parcela</button>
          <button class="ds-btn ds-btn--sm" onclick="VMTerminalEmprestimos.amortizar(${Number(e.id)})"><i class="fas fa-bolt"></i> Amortizar</button>
          <button class="ds-btn ds-btn--sm" onclick="VMTerminalEmprestimos.conciliar(${Number(e.id)})"><i class="fas fa-scale-balanced"></i> Conciliar</button>
          <button class="ds-btn ds-btn--sm" onclick="VMTerminalEmprestimos.quitar(${Number(e.id)}, ${JSON.stringify(String(e.descricao))})"><i class="fas fa-flag-checkered"></i> Quitar</button>`}
          <button class="ds-btn ds-btn--sm" title="Editar" onclick="VMTerminalEmprestimos.editar(${Number(e.id)})"><i class="fas fa-pen"></i> Editar</button>
          <button class="ds-btn ds-btn--sm ds-btn--danger" title="Excluir" onclick="VMTerminalEmprestimos.excluir(${Number(e.id)}, ${JSON.stringify(String(e.descricao))})"><i class="fas fa-trash"></i></button>
        </div>
      </article>`
    },

    _shell(inner) {
      return `<div class="td-dashboard fe">
        <header class="td-dashboard__header">
          <div>
            <span class="td-eyebrow">Saia do vermelho</span>
            <h1>Empréstimos. <em>Um plano para zerar cada dívida.</em></h1>
            <p>O que falta pagar, o que já saiu do bolso e quanto do contrato é juro.</p>
          </div>
        </header>
        ${inner}
      </div>`
    },

    _empty() {
      return `<section class="td-onboarding"><div class="td-onboarding__copy">
        <span class="td-eyebrow">Comece agora</span>
        <h2>Cadastre seus empréstimos.</h2>
        <p>Pessoal, consignado, com amigos — o VerdeMais mostra quanto falta pagar, quanto do contrato é juro e por onde começar a quitar.</p>
        <div class="td-onboarding__actions"><button class="ds-btn ds-btn--primary ds-btn--lg" onclick="VMTerminalEmprestimos.novo()"><i class="fas fa-plus"></i> Novo empréstimo</button></div>
      </div></section>`
    },

    // ── formulário ────────────────────────────────────────────────────────────
    _campo(label, inner, dica) {
      return `<div class="ct-form__campo">
        <label class="ct-form__lbl">${label}</label>
        ${inner}
        ${dica ? `<small class="ct-form__dica">${dica}</small>` : ''}
      </div>`
    },

    _form(e) {
      const v = e || {}
      const tipoOpts = TIPOS.map(([k, l]) => `<option value="${k}" ${v.tipo === k ? 'selected' : ''}>${l}</option>`).join('')
      const inp = (id, tipo, val, extra = '') => `<input id="${id}" type="${tipo}" class="ct-form__in" value="${esc(val ?? '')}" ${extra}>`
      return `<div class="ct-form fe-form">
        <div class="ct-form__head">
          <div class="ct-form__ico"><i class="fas fa-hand-holding-dollar"></i></div>
          <div>
            <strong>${e ? 'Editar empréstimo' : 'Novo empréstimo'}</strong>
            <small>Informe o contrato como ele é: o valor que caiu na sua conta, a parcela e quantas você já pagou.</small>
          </div>
        </div>

        <div class="ct-form__grid">
          ${this._campo('Descrição', inp('e-desc', 'text', v.descricao || '', 'placeholder="Ex.: Empréstimo carro"'))}
          <div class="ct-form__linha">
            ${this._campo('Credor', inp('e-credor', 'text', v.credor || '', 'placeholder="Ex.: Itaú"'))}
            ${this._campo('Tipo', `<select id="e-tipo" class="ct-form__in">${tipoOpts}</select>`)}
          </div>
          <div class="ct-form__linha">
            ${this._campo('Valor que você tomou', inp('e-orig', 'number', Number(v.valor_original) || '', 'step="0.01" min="0" inputmode="decimal"'),
              'O que entrou na sua conta — não o total das parcelas.')}
            ${this._campo('Taxa % a.m.', inp('e-taxa', 'number', Number(v.taxa_juros_mensal) || '', 'step="0.01" min="0" inputmode="decimal"'),
              'Deixe zero se a parcela já inclui tudo.')}
          </div>
          <div class="ct-form__linha">
            ${this._campo('Nº parcelas', inp('e-np', 'number', Math.round(Number(v.numero_parcelas)) || '', 'min="1" max="600"'))}
            ${this._campo('Já pagas', inp('e-pp', 'number', Math.round(Number(v.parcelas_pagas)) || 0, 'min="0"'))}
            ${this._campo('Valor da parcela', inp('e-parc', 'number', Number(v.valor_parcela) || '', 'step="0.01" min="0" inputmode="decimal"'))}
          </div>
          <div class="ct-form__linha">
            ${this._campo('Dia do vencimento', inp('e-dia', 'number', Number(v.dia_vencimento) || '', 'min="1" max="31"'))}
            ${this._campo('Início do contrato', inp('e-data', 'date', String(v.data_inicio || '').slice(0, 10)))}
          </div>
          <div id="e-previa" class="ds-note ds-note--info fe-previa"></div>
        </div>

        <div class="ct-form__acoes">
          <button class="ds-btn" onclick="VM.closeModal()">Cancelar</button>
          <button class="ds-btn ds-btn--primary" onclick="VMTerminalEmprestimos.salvar(${e ? Number(v.id) : 0})"><i class="fas fa-check"></i> ${e ? 'Salvar' : 'Cadastrar'}</button>
        </div>
      </div>`
    },

    /** Prévia ao vivo: o usuário vê a conta antes de salvar, não depois. */
    _previa() {
      const g = i => parseFloat(document.getElementById(i)?.value)
      const el = document.getElementById('e-previa')
      if (!el) return
      const n = Math.round(g('e-np')), parc = g('e-parc')
      const pagas = Math.round(g('e-pp')) || 0, tomado = g('e-orig'), taxa = g('e-taxa') || 0
      if (!(n > 0) || !(parc > 0)) { el.innerHTML = '<i class="fas fa-circle-info ds-note__ico"></i><div>Preencha nº de parcelas e valor da parcela para ver a conta.</div>'; return }
      const total = n * parc
      const juros = tomado > 0 ? total - tomado : null
      const falta = Math.max(0, (n - pagas) * parc)
      const contradiz = taxa > 0 && juros !== null && juros <= 0.01
      el.className = 'ds-note ds-note--' + (contradiz ? 'warn' : 'info') + ' fe-previa'
      el.innerHTML = `<i class="fas fa-${contradiz ? 'triangle-exclamation' : 'calculator'} ds-note__ico"></i><div>
        Total do contrato <strong>${money(total)}</strong>${juros !== null ? ` · juros embutidos <strong>${money(Math.max(0, juros))}</strong>` : ''} · falta pagar <strong>${money(falta)}</strong>.
        ${contradiz ? `<br><strong>Atenção:</strong> as ${n} parcelas somam exatamente o valor que você informou ter tomado, ou seja, juro zero — mas há ${num(taxa)}% a.m. cadastrado. Um dos dois está errado.` : ''}
      </div>`
    },

    novo() { this._vm.showModal(this._form(null)); this._ligarPrevia() },
    editar(id) { const e = this._emps.find(x => Number(x.id) === Number(id)); if (e) { this._vm.showModal(this._form(e)); this._ligarPrevia() } },
    _ligarPrevia() {
      setTimeout(() => {
        ;['e-np', 'e-parc', 'e-pp', 'e-orig', 'e-taxa'].forEach(id => {
          const el = document.getElementById(id)
          if (el) el.addEventListener('input', () => this._previa())
        })
        this._previa()
      }, 60)
    },

    async salvar(id) {
      const vm = this._vm, g = i => document.getElementById(i)
      const payload = {
        descricao: g('e-desc')?.value?.trim(),
        credor: g('e-credor')?.value?.trim() || null,
        tipo: g('e-tipo')?.value,
        valor_original: parseFloat(g('e-orig')?.value),
        taxa_juros_mensal: parseFloat(g('e-taxa')?.value) || 0,
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

    // ── ações ────────────────────────────────────────────────────────────────
    async pagar(id, pagas, total) {
      const vm = this._vm
      if (!await VM.vmConfirm(`Registrar o pagamento da parcela ${Number(pagas) + 1}/${total}?`,
        { titulo: 'Pagar parcela', textoBotao: 'Registrar', corBotao: '#3DDC84', icone: '✓' })) return
      const r = await vm.api('PATCH', `emprestimos/${id}/parcela`, {}).catch(e => ({ error: e.response?.data?.error }))
      if (r?.success) { vm.toast(r.message || 'Parcela paga.', 'success'); this.reload() }
      else vm.toast(r?.error || 'Erro ao registrar pagamento.', 'error')
    },

    /**
     * O contrato e o fluxo de caixa são dois livros. Dar baixa na parcela pela
     * tela de Despesas — que é onde ela aparece todo mês — não mexia no
     * contrato, e não havia como corrigir a diferença a não ser clicando
     * "pagar parcela" repetidamente, o que lança pagamento em cima de
     * pagamento. Aqui ele diz de uma vez quantas pagou.
     */
    async conciliar(id) {
      const vm = this._vm
      const e = this._emps.find(x => Number(x.id) === Number(id))
      if (!e) return
      const n = Math.round(Number(e.numero_parcelas) || 0)
      const sugerido = e.conciliacao?.parcelas_baixadas_nas_despesas ?? e.parcelas_pagas
      const txt = await VM.vmPrompt(
        `O contrato registra <strong>${e.parcelas_pagas}</strong> parcela(s) paga(s) e a tela de Despesas tem <strong>${e.conciliacao?.parcelas_baixadas_nas_despesas ?? '—'}</strong> baixada(s). Quantas você pagou de verdade?`,
        { titulo: 'Conciliar contrato', tipo: 'number', valor: String(sugerido), min: 0, max: n, step: '1', icone: '⚖️', textoBotao: 'Conciliar',
          dica: `De 0 a ${n}. A amortização extraordinária que você já fez é preservada.` })
      if (txt === null) return
      const qtd = parseInt(txt)
      if (!Number.isFinite(qtd) || qtd < 0 || qtd > n) return vm.toast('Informe um número entre 0 e ' + n + '.', 'error')
      const r = await vm.api('PATCH', `emprestimos/${id}/conciliar`, { parcelas_pagas: qtd }).catch(e2 => ({ error: e2.response?.data?.error }))
      if (r?.success) { vm.toast(r.message || 'Contrato conciliado.', 'success'); this.reload() }
      else vm.toast(r?.error || 'Erro ao conciliar.', 'error')
    },

    async amortizar(id) {
      const vm = this._vm
      const txt = await VM.vmPrompt('Esse valor abate o que falta pagar, sem mexer no número de parcelas.',
        { titulo: 'Amortização extraordinária', tipo: 'number', min: 0, step: '0.01', sufixo: 'R$', icone: '💸', textoBotao: 'Amortizar' })
      if (txt === null) return
      const valor = parseFloat(txt)
      if (!(valor > 0)) return vm.toast('Valor inválido.', 'error')
      const r = await vm.api('PATCH', `emprestimos/${id}/amortizacao`, { valor_amortizado: valor }).catch(e => ({ error: e.response?.data?.error }))
      if (r?.success) { vm.toast(r.message || 'Amortização aplicada.', 'success'); this.reload() }
      else vm.toast(r?.error || 'Erro ao amortizar.', 'error')
    },

    async quitar(id, nome) {
      const vm = this._vm
      if (!await VM.vmConfirm(`Marcar "${esc(nome)}" como quitado? Todas as parcelas pendentes serão baixadas.`,
        { titulo: 'Quitar empréstimo', textoBotao: 'Quitar', corBotao: '#3DDC84', icone: '🏁' })) return
      const r = await vm.api('PATCH', `emprestimos/${id}/quitado`, {}).catch(e => ({ error: e.response?.data?.error }))
      if (r?.success) { vm.toast(r.message || 'Empréstimo quitado.', 'success'); this.reload() }
      else vm.toast(r?.error || 'Erro ao quitar.', 'error')
    },

    async excluir(id, nome) {
      const vm = this._vm
      if (!await VM.vmConfirm(`Excluir o empréstimo "${esc(nome)}" e suas parcelas no fluxo de caixa?`,
        { titulo: 'Excluir empréstimo', textoBotao: 'Excluir', corBotao: '#ef4444', icone: '🗑️' })) return
      const r = await vm.api('DELETE', `emprestimos/${id}`).catch(e => ({ error: e.response?.data?.error }))
      if (r?.success) { vm.toast('Empréstimo removido.', 'success'); this.reload() }
      else vm.toast(r?.error || 'Erro ao excluir.', 'error')
    }
  }
})()
