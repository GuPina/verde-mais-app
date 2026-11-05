(function () {
  const esc = (v) => String(v ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;')
  const money = (v) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 2 }).format(Number(v) || 0)
  const BEM = { imovel: '🏠 Imóvel', imovel_comercial: '🏢 Imóvel comercial', veiculo: '🚗 Veículo', rural: '🌾 Rural', outros: '📦 Outros' }
  const SIST = { price: 'PRICE', sac: 'SAC', sacre: 'SACRE' }
  const TIPO_FIN = [['pronto', 'Pronto'], ['planta', 'Na planta'], ['construcao', 'Em construção'], ['terreno', 'Terreno'], ['reforma', 'Reforma'], ['veiculo', 'Veículo'], ['outros', 'Outros']]
  const PAPEL = { entrada: 'Entrada', obra: 'Evolução de obra', parcela: 'Parcelas', seguro: 'Seguros e taxas', extra: 'ITBI, cartório e extras' }
  const COR = { entrada: 'var(--fp-entrada)', obra: 'var(--fp-obra)', parcela: 'var(--fp-parcela)', seguro: 'var(--fp-seguro)', extra: 'var(--fp-extra)' }
  const MES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
  const rotMes = (k) => { const [a, m] = String(k).split('-').map(Number); return `${MES[m - 1]}/${String(a).slice(2)}` }
  const dfmt = (iso) => { const [a, m, d] = String(iso || '').slice(0, 10).split('-'); return a && m && d ? `${d}/${m}/${a.slice(2)}` : '—' }
  const pct = (v) => (Number(v) || 0).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + '%'

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
      return `<article class="fe-card fe-card--clicavel ${quit ? 'fe-card--done' : ''}" role="button" tabindex="0" title="Abrir o painel"
        onclick="VMTerminalFinanciamentos.abrir(${Number(f.id)})"
        onkeydown="if(event.key==='Enter'){VMTerminalFinanciamentos.abrir(${Number(f.id)})}">
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

        <div class="tr-card__hint"><i class="fas fa-chart-column"></i> Toque para abrir o painel${f.tipo_financiamento === 'planta' || f.tipo_financiamento === 'construcao' ? ' da obra' : ''}</div>
        <div class="fe-card__actions" onclick="event.stopPropagation()" onkeydown="event.stopPropagation()">
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
      return `<div style="font-family:var(--terminal-font);color:var(--terminal-ink);width:100%;min-width:0">
        <div style="font-size:16px;font-weight:640">${f ? 'Editar financiamento' : 'Novo financiamento'}</div>
        <div style="color:var(--terminal-ink-soft);font-size:12px;margin:4px 0 18px">Preencha os dados do contrato</div>
        <div style="display:flex;flex-direction:column;gap:13px;max-height:64vh;overflow:auto;padding-right:4px">
          <div>${this._lab('Descrição')}<input id="f-desc" style="${s}" value="${esc(v.descricao || '')}" placeholder="Ex.: Apto Jardins"></div>
          <div style="display:flex;gap:10px;flex-wrap:wrap">
            <div style="flex:2;min-width:160px">${this._lab('Banco')}<input id="f-banco" style="${s}" value="${esc(v.banco || '')}" placeholder="Ex.: Caixa"></div>
            <div style="flex:1;min-width:120px">${this._lab('Tipo')}<select id="f-bem" style="${s}">${bemOpts}</select></div>
          </div>
          <div style="display:flex;gap:10px;flex-wrap:wrap">
            <div style="flex:1;min-width:120px">${this._lab('Valor do bem')}<input id="f-imovel" type="number" step="0.01" min="0" style="${s}" value="${Number(v.valor_imovel) || ''}"></div>
            <div style="flex:1;min-width:120px">${this._lab('Entrada')}<input id="f-entrada" type="number" step="0.01" min="0" style="${s}" value="${Number(v.valor_entrada) || 0}"></div>
            <div style="flex:1;min-width:120px">${this._lab('Financiado')}<input id="f-fin" type="number" step="0.01" min="0" style="${s}" value="${Number(v.valor_financiado) || ''}"></div>
          </div>
          <div style="display:flex;gap:10px;flex-wrap:wrap">
            <div style="flex:1;min-width:120px">${this._lab('Taxa % a.a.')}<input id="f-taxa" type="number" step="0.01" min="0" style="${s}" value="${Number(v.taxa_juros_anual) || ''}"></div>
            <div style="flex:1;min-width:120px">${this._lab('Nº parcelas')}<input id="f-np" type="number" min="1" max="600" style="${s}" value="${Number(v.numero_parcelas) || ''}"></div>
            <div style="flex:1;min-width:120px">${this._lab('Já pagas')}<input id="f-pp" type="number" min="0" style="${s}" value="${Number(v.parcelas_pagas) || 0}"></div>
          </div>
          <div style="display:flex;gap:10px;flex-wrap:wrap">
            <div style="flex:1;min-width:120px">${this._lab('Valor da parcela')}<input id="f-parc" type="number" step="0.01" min="0" style="${s}" value="${Number(v.valor_parcela) || ''}"></div>
            <div style="flex:1;min-width:120px">${this._lab('Sistema')}<select id="f-sist" style="${s}">${sistOpts}</select></div>
            <div style="flex:1;min-width:120px">${this._lab('Início')}<input id="f-data" type="date" style="${s}" value="${String(v.data_inicio || '').slice(0, 10)}"></div>
          </div>
          <div class="fp-form-bloco">
            <div class="fp-form-bloco__tit">Imóvel na planta ou em construção</div>
            <div style="display:flex;gap:10px;flex-wrap:wrap">
              <div style="flex:1;min-width:140px">${this._lab('Situação')}<select id="f-tipofin" style="${s}">${TIPO_FIN.map(([k, l]) => `<option value="${k}" ${(v.tipo_financiamento || 'pronto') === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
              <div style="flex:1;min-width:140px">${this._lab('Chaves previstas')}<input id="f-chaves" type="date" style="${s}" value="${String(v.data_chaves || '').slice(0, 10)}"></div>
            </div>
            <div style="display:flex;gap:10px;flex-wrap:wrap">
              <div style="flex:2;min-width:160px">${this._lab('Construtora')}<input id="f-constr" style="${s}" value="${esc(v.construtora || '')}" placeholder="Ex.: MRV"></div>
              <div style="flex:1;min-width:110px">${this._lab('% da obra')}<input id="f-obra" type="number" min="0" max="100" step="0.1" style="${s}" value="${v.evolucao_obra_pct != null && v.evolucao_obra_pct !== '' ? Number(v.evolucao_obra_pct) : ''}"></div>
            </div>
          </div>
          <div style="display:flex;gap:8px;margin-top:6px">
            <button class="td-button td-button--primary" style="flex:1" onclick="VMTerminalFinanciamentos.salvar(${f ? Number(v.id) : 0})"><i class="fas fa-check"></i> ${f ? 'Salvar' : 'Cadastrar'}</button>
            <button class="td-button" onclick="VM.closeModal()">Cancelar</button>
          </div>
        </div></div>`
    },
    novo() { this._vm.showModal(this._form(null), { largura: 560 }) },
    editar(id) {
      const f = (this._painelDados && Number(this._painelDados.financiamento.id) === Number(id) ? this._painelDados.financiamento : null)
        || (this._fins || []).find(x => Number(x.id) === Number(id))
      if (f) this._vm.showModal(this._form(f), { largura: 560 })
    },
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
      if (!r?.success) return vm.toast(r?.error || 'Erro ao salvar.', 'error')
      const fid = id || r.id
      if (fid) {
        const obra = g('f-obra')?.value
        const ri = await vm.api('PATCH', `financiamentos/${fid}/imobiliario`, {
          tipo_financiamento: g('f-tipofin')?.value || 'pronto', data_chaves: g('f-chaves')?.value || null,
          construtora: g('f-constr')?.value || null, ...(obra !== '' && obra != null ? { evolucao_obra_pct: Number(obra) } : {}),
        }).catch(e => ({ error: e.response?.data?.error }))
        if (!ri?.success) vm.toast(ri?.error || 'Os dados da obra não foram salvos.', 'error')
      }
      vm.closeModal(); vm.toast(id ? 'Financiamento atualizado.' : 'Financiamento cadastrado.', 'success')
      if (this._abertoId === Number(id)) this.abrir(id); else this.reload()
    },

    async pagar(id, pagas, total) {
      const vm = this._vm
      if (!await (window.VM).vmConfirm(`Registrar o pagamento da parcela ${Number(pagas) + 1}/${total}?`)) return
      const r = await vm.api('PATCH', `financiamentos/${id}/parcela`).catch(e => ({ error: e.response?.data?.error }))
      if (r?.success) { vm.toast(r.message || 'Parcela paga.', 'success'); this.reload() }
      else vm.toast(r?.error || 'Erro ao registrar pagamento.', 'error')
    },
    async amortizar(id) {
      const vm = this._vm
      const txt = await window.VM.vmPrompt('Esse valor abate o saldo devedor e encurta o financiamento.', { titulo: 'Amortização extraordinária', tipo: 'number', min: 0, step: '0.01', sufixo: 'R$', icone: '💸', textoBotao: 'Amortizar' })
      if (txt === null) return
      const valor = parseFloat(txt)
      if (!(valor > 0)) return vm.toast('Valor inválido.', 'error')
      const r = await vm.api('PATCH', `financiamentos/${id}/amortizacao`, { valor }).catch(e => ({ error: e.response?.data?.error }))
      if (r?.success) { vm.toast(r.message || 'Amortização aplicada.', 'success'); this.reload() }
      else vm.toast(r?.error || 'Erro ao amortizar.', 'error')
    },
    async excluir(id, nome) {
      const vm = this._vm
      if (!await (window.VM).vmConfirm(`Excluir o financiamento "${nome}" e todas as suas parcelas no fluxo de caixa?`)) return
      const r = await vm.api('DELETE', `financiamentos/${id}`).catch(e => ({ error: e.response?.data?.error }))
      if (r?.success) { vm.toast('Financiamento removido.', 'success'); this.reload() }
      else vm.toast(r?.error || 'Erro ao excluir.', 'error')
    },

    // ══ Painel do financiamento ════════════════════════════════════════════
    async abrir(id) {
      const vm = this._vm
      this._abertoId = Number(id)
      const content = document.getElementById('page-content')
      if (!content) return
      content.innerHTML = '<div class="td-loading"><span></span><span></span><span></span></div>'
      const d = await vm.api('GET', `financiamentos/${id}/painel`).catch(e => ({ error: e.response?.data?.error }))
      if (!d || d.error) {
        content.innerHTML = `<div class="td-error"><h2>Não foi possível abrir o painel</h2><p>${esc(d?.error || 'Tente novamente.')}</p><button class="td-button" onclick="VMTerminalFinanciamentos.voltar()">Voltar</button></div>`
        return
      }
      this._painelDados = d
      const f = d.financiamento, p = d.painel, ind = d.indicadores
      const imob = p.imobiliario
      const bloco = (b) => `<article class="fp-bloco" style="--c:${COR[b.papel]}">
          <header><span class="fp-dot"></span><strong>${esc(b.rotulo)}</strong>${b.custo ? '<em>custo</em>' : '<em class="is-pat">patrimônio</em>'}</header>
          <div class="fp-bloco__val">${money(b.pago)}</div>
          <small>${b.n_pagos} pago${b.n_pagos === 1 ? '' : 's'}${b.pendente ? ` · ${money(b.pendente)} a pagar (${b.n_pendentes})` : ''}</small>
          <small>${b.ultimo ? `último ${money(b.ultimo.valor)} em ${dfmt(b.ultimo.data)}` : 'nenhum lançamento ligado'}${b.media_mensal ? ` · média ${money(b.media_mensal)}/mês` : ''}</small>
        </article>`
      const fases = imob ? this._fases(f, p) : ''
      const entrada = p.entrada.contratada > 0 ? `<article class="td-panel fp-entrada">
          <div class="td-panel__head"><div><span class="td-eyebrow">Entrada</span><h2>${money(p.entrada.paga)} de ${money(p.entrada.contratada)}</h2></div><strong class="fp-big">${pct(p.entrada.pct)}</strong></div>
          <div class="to-bar" style="height:10px"><span style="width:${Math.min(100, p.entrada.pct)}%;background:var(--fp-entrada)"></span></div>
          <p class="fp-nota">Falta ${money(p.entrada.falta)}${p.entrada.pendente_lancada ? ` · ${money(p.entrada.pendente_lancada)} já lançados como a pagar` : ''}.</p>
        </article>` : ''

      content.innerHTML = `<div class="td-dashboard fe fp">
        <header class="td-dashboard__header">
          <div>
            <button class="fp-voltar" onclick="VMTerminalFinanciamentos.voltar()"><i class="fas fa-arrow-left"></i> Financiamentos</button>
            <span class="td-eyebrow">${esc(BEM[f.tipo_bem] || 'Financiamento')}${f.banco ? ' · ' + esc(f.banco) : ''}${f.construtora ? ' · ' + esc(f.construtora) : ''}</span>
            <h1>${esc(f.descricao)}</h1>
            <p>${p.fase === 'obra' ? `Em obra${p.meses_ate_chaves != null ? ` · chaves em ${p.meses_ate_chaves} ${p.meses_ate_chaves === 1 ? 'mês' : 'meses'}` : ''}` : p.fase === 'quitado' ? 'Quitado' : `Amortizando · ${f.parcelas_pagas}/${f.numero_parcelas} parcelas`}</p>
          </div>
          <div class="td-dashboard__header-actions">
            <button class="td-button td-button--primary" onclick="VMTerminalFinanciamentos.procurar(${Number(f.id)})"><i class="fas fa-wand-magic-sparkles"></i> Procurar lançamentos</button>
            ${imob ? `<button class="td-button" onclick="VMTerminalFinanciamentos.atualizarObra(${Number(f.id)})"><i class="fas fa-helmet-safety"></i> % da obra</button>` : ''}
            <button class="td-button" onclick="VMTerminalFinanciamentos.editar(${Number(f.id)})"><i class="fas fa-pen"></i> Editar</button>
          </div>
        </header>

        ${fases}

        <section class="tm-kpis fp-kpis">
          <article class="td-kpi"><span>Já pago</span><strong>${money(ind.total_pago)}</strong><span class="td-kpi__delta td-kpi__delta--muted">em ${d.lancamentos.filter(l => l.status === 'pago').length} lançamentos</span></article>
          <article class="td-kpi"><span>Virou patrimônio</span><strong class="is-pos">${money(ind.virou_patrimonio)}</strong><span class="td-kpi__delta td-kpi__delta--muted">entrada + amortização</span></article>
          <article class="td-kpi"><span>Foi custo</span><strong class="is-neg">${money(ind.custo)}</strong><span class="td-kpi__delta td-kpi__delta--muted">obra, juros, seguros, taxas</span></article>
          <article class="td-kpi"><span>${p.fase === 'obra' ? 'Parcela depois das chaves' : 'Saldo devedor'}</span><strong>${money(p.fase === 'obra' ? ind.primeira_parcela_pos_chaves : f.saldo_devedor)}</strong>
            <span class="td-kpi__delta ${ind.pct_renda_pos_chaves > 30 && p.fase === 'obra' ? 'td-kpi__delta--negative' : 'td-kpi__delta--muted'}">${p.fase === 'obra' ? (ind.pct_renda_pos_chaves != null ? `${pct(ind.pct_renda_pos_chaves)} da renda` : 'prevista no contrato') : `${money(f.valor_parcela)}/mês`}</span></article>
        </section>

        ${entrada}

        <article class="td-panel">
          <div class="td-panel__head"><div><span class="td-eyebrow">Mês a mês</span><h2>O que saiu para o imóvel</h2></div>
            <span class="fp-nota">${ind.gasto_mensal_medio ? `média dos últimos 3 meses: <b>${money(ind.gasto_mensal_medio)}</b>${ind.pct_renda != null ? ` (${pct(ind.pct_renda)} da renda)` : ''}` : ''}</span></div>
          ${this._grafico(p.serie)}
          <div class="fp-legenda">${Object.keys(PAPEL).map(k => `<span><i style="background:${COR[k]}"></i>${PAPEL[k]}</span>`).join('')}<span><i class="is-futuro"></i>a pagar</span></div>
        </article>

        <section class="fp-blocos">${p.blocos.filter(b => b.pago || b.pendente || ['entrada', 'obra', 'parcela'].includes(b.papel)).map(bloco).join('')}</section>

        ${imob && ind.obra.serie.length ? this._painelObra(f, ind, d.obra_hist) : ''}

        ${d.sugestoes.length ? `<article class="td-panel fp-sug">
          <div class="td-panel__head"><div><span class="td-eyebrow">Para pensar</span><h2>Sugestões</h2></div></div>
          <ul>${d.sugestoes.map(s => `<li class="fp-sug__${s.tipo}"><strong>${esc(s.titulo)}</strong><p>${esc(s.texto)}</p></li>`).join('')}</ul>
        </article>` : ''}

        <article class="td-panel">
          <div class="td-panel__head"><div><span class="td-eyebrow">Ligados a este financiamento</span><h2>${d.lancamentos.length} lançamento${d.lancamentos.length === 1 ? '' : 's'}</h2></div></div>
          ${this._lancamentos(d)}
        </article>
      </div>`
    },

    voltar() { this._abertoId = null; this.reload() },

    _fases(f, p) {
      const obraPct = Math.min(100, Number(f.evolucao_obra_pct) || 0)
      const amortPct = Number(f.numero_parcelas) > 0 ? Math.round(Number(f.parcelas_pagas) / Number(f.numero_parcelas) * 100) : 0
      const at = p.fase
      const etapa = (chave, titulo, sub, pctv, ativa, feita) => `<div class="fp-fase${ativa ? ' is-ativa' : ''}${feita ? ' is-feita' : ''}">
          <span class="fp-fase__tit">${titulo}</span><small>${sub}</small>
          ${pctv != null ? `<div class="to-bar" style="height:6px"><span style="width:${pctv}%;background:var(--terminal-primary)"></span></div>` : ''}
        </div>`
      return `<section class="fp-fases">
        ${etapa('obra', 'Obra', f.evolucao_obra_pct != null ? `${pct(obraPct)} concluída` : 'informe o % da obra', obraPct, at === 'obra', at !== 'obra')}
        ${etapa('chaves', 'Chaves', f.data_chaves ? dfmt(f.data_chaves) + (p.meses_ate_chaves != null ? ` · em ${p.meses_ate_chaves} meses` : '') : 'data não informada', null, false, at !== 'obra')}
        ${etapa('amort', 'Amortização', `${f.parcelas_pagas}/${f.numero_parcelas} parcelas`, amortPct, at === 'amortizacao', at === 'quitado')}
      </section>`
    },

    _grafico(serie) {
      const W = 720, H = 200, pad = 26, n = serie.length
      const max = Math.max(1, ...serie.map(m => m.total))
      const bw = (W - pad) / n
      const ordem = ['entrada', 'obra', 'parcela', 'seguro', 'extra']
      const barras = serie.map((m, i) => {
        let y = H - pad
        const x = pad + i * bw + bw * 0.15, w = bw * 0.7
        const segs = ordem.map(k => {
          const v = m.por_papel[k]; if (!v) return ''
          const h = (v / max) * (H - pad - 10); y -= h
          return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${Math.max(1, h).toFixed(1)}" fill="${COR[k]}" ${m.futuro ? 'fill-opacity=".35"' : ''} rx="2"><title>${rotMes(m.mes)} · ${PAPEL[k]}: ${money(v)}</title></rect>`
        }).join('')
        const rot = (i % 3 === 0 || i === n - 1) ? `<text x="${(x + w / 2).toFixed(1)}" y="${H - 8}" text-anchor="middle">${rotMes(m.mes)}</text>` : ''
        return segs + rot
      }).join('')
      const hoje = serie.findIndex(m => m.futuro)
      const linhaHoje = hoje > 0 ? `<line x1="${(pad + hoje * bw).toFixed(1)}" x2="${(pad + hoje * bw).toFixed(1)}" y1="6" y2="${H - pad}" class="fp-hoje"/>` : ''
      return `<svg class="fp-graf" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Pagamentos do imóvel por mês">
        <line x1="${pad}" x2="${W}" y1="${H - pad}" y2="${H - pad}" class="fp-eixo"/>
        <text x="2" y="14" class="fp-max">${money(max).replace('R$', '').trim()}</text>
        ${linhaHoje}${barras}</svg>`
    },

    _painelObra(f, ind, hist) {
      const s = ind.obra.serie, max = Math.max(1, ...s.map(x => x.valor))
      const W = 720, H = 140, pad = 20, step = s.length > 1 ? (W - pad * 2) / (s.length - 1) : 0
      const pts = s.map((x, i) => `${(pad + i * step).toFixed(1)},${(H - pad - (x.valor / max) * (H - pad * 2)).toFixed(1)}`).join(' ')
      const prox = ind.obra.proximo
      return `<article class="td-panel fp-obra">
        <div class="td-panel__head"><div><span class="td-eyebrow">Evolução de obra</span><h2>Quanto ela custa por mês</h2></div>
          ${prox?.por_tendencia ? `<div class="fp-prox"><span>próxima, estimada</span><strong>${money(prox.por_tendencia)}</strong>${prox.pelo_pct ? `<small>pelo % da obra: ${money(prox.pelo_pct)}</small>` : ''}</div>` : ''}</div>
        <svg class="fp-graf fp-graf--linha" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Evolução de obra por mês">
          <polyline points="${pts}" fill="none" stroke="var(--fp-obra)" stroke-width="2.5" vector-effect="non-scaling-stroke"/>
          ${s.map((x, i) => `<circle cx="${(pad + i * step).toFixed(1)}" cy="${(H - pad - (x.valor / max) * (H - pad * 2)).toFixed(1)}" r="3.5" fill="var(--fp-obra)"><title>${rotMes(x.mes)}: ${money(x.valor)}</title></circle>`).join('')}
        </svg>
        <div class="fp-obra__rod"><span>${rotMes(s[0].mes)}: ${money(s[0].valor)}</span>
          ${ind.obra.ritmo_pct != null ? `<span>ritmo: +${pct(ind.obra.ritmo_pct)}/mês</span>` : ''}
          <span>${rotMes(s[s.length - 1].mes)}: ${money(s[s.length - 1].valor)}</span></div>
        ${hist.length ? `<p class="fp-nota">% da obra registrado: ${hist.slice(-6).map(h => `${dfmt(h.data)} ${pct(h.pct)}`).join(' · ')}</p>` : ''}
      </article>`
    },

    _lancamentos(d) {
      if (!d.lancamentos.length) return `<p class="fp-nota">Nenhum ainda. Use <b>Procurar lançamentos</b> para trazer a entrada, a evolução de obra e o resto que está em Despesas.</p>`
      const fid = Number(d.financiamento.id)
      return `<ul class="fp-lanc">${d.lancamentos.slice(0, 120).map(l => `<li>
          <span class="fp-dot" style="--c:${COR[l.papel]}"></span>
          <span class="fp-lanc__corpo"><strong>${esc(l.descricao)}${Number(l.numero_parcelas) > 1 && !/\(\d+\/\d+\)/.test(l.descricao) ? ` <span class="fp-parc">${Number(l.parcela_atual)}/${Number(l.numero_parcelas)}</span>` : ''}</strong><small>${dfmt(l.data)} · ${l.status === 'pago' ? 'pago' : 'a pagar'}${l.automatica ? ' · gerada pelo financiamento' : ''}</small></span>
          <b>${money(l.valor)}</b>
          ${l.automatica ? `<span class="fp-lanc__papel">${PAPEL[l.papel]}</span>` : `<select class="fp-lanc__papel" onchange="VMTerminalFinanciamentos.trocarPapel(${fid}, ${Number(l.id)}, this.value)">
            ${Object.keys(PAPEL).map(k => `<option value="${k}" ${k === l.papel ? 'selected' : ''}>${PAPEL[k]}</option>`).join('')}</select>
          <button class="tl-link" onclick="VMTerminalFinanciamentos.desvincular(${fid}, ${Number(l.id)})">tirar</button>`}
        </li>`).join('')}</ul>${d.lancamentos.length > 120 ? `<p class="fp-nota">Mostrando os 120 mais recentes.</p>` : ''}`
    },

    async trocarPapel(fid, did, papel) {
      const r = await this._vm.api('PATCH', `financiamentos/${fid}/papel`, { despesa_id: did, papel }).catch(() => null)
      if (r?.success) this.abrir(fid); else this._vm.toast('Não foi possível trocar.', 'error')
    },
    async desvincular(fid, did) {
      if (!await window.VM.vmConfirm('Tirar este lançamento do financiamento? Ele continua em Despesas.', { titulo: 'Tirar do financiamento', textoBotao: 'Tirar' })) return
      const r = await this._vm.api('POST', `financiamentos/${fid}/desvincular`, { despesa_id: did }).catch(() => null)
      if (r?.success) this.abrir(fid); else this._vm.toast('Não foi possível tirar.', 'error')
    },
    async atualizarObra(fid) {
      const atual = this._painelDados?.financiamento?.evolucao_obra_pct
      const txt = await window.VM.vmPrompt('Quanto da obra está concluído, segundo o último extrato do banco ou da construtora?',
        { titulo: '% da obra', tipo: 'number', min: 0, step: '0.1', sufixo: '%', icone: '🏗️', textoBotao: 'Salvar', valor: atual ?? '' })
      if (txt === null) return
      const r = await this._vm.api('PATCH', `financiamentos/${fid}/imobiliario`, { evolucao_obra_pct: Number(txt) }).catch(e => ({ error: e.response?.data?.error }))
      if (!r?.success) return this._vm.toast(r?.error || 'Não foi possível salvar.', 'error')
      this.abrir(fid)
    },

    // ── Procurar lançamentos (sim/não, com papel) ──
    async procurar(fid) {
      const vm = this._vm
      vm.showModal('<div class="rp-modal"><div class="rp-vazio">Procurando em Despesas…</div></div>', { largura: 720 })
      const d = await vm.api('GET', `financiamentos/${fid}/candidatos`).catch(e => ({ error: e.response?.data?.error }))
      if (!d || d.error) return vm.toast(d?.error || 'Não foi possível procurar.', 'error')
      this._cand = d; this._resp = {}; this._papelEsc = {}; this._papelSerie = {}; this._abertas = new Set()
      this._pintarProcura()
    },
    _pintarProcura() {
      const d = this._cand, fid = Number(d.financiamento.id)
      const series = d.series || []
      const naSerie = new Set(series.flatMap(x => x.ids))
      const porId = new Map(d.candidatos.map(c => [c.id, c]))
      const selPapel = (id, papel, fn) => `<select class="fp-lanc__papel" onchange="VMTerminalFinanciamentos.${fn}(${Number(id)}, this.value)">
          ${Object.keys(PAPEL).map(k => `<option value="${k}" ${k === papel ? 'selected' : ''}>${PAPEL[k]}</option>`).join('')}</select>`
      const item = (c, dentro) => {
        const r = this._resp[c.id], papel = this._papelEsc[c.id] || c.papel
        // O número só aparece quando o nome não traz o "(3/10)" — é o caso que confunde.
        const parc = c.parcela && !/\d+\s*\/\s*\d+/.test(c.descricao) ? `<span class="fp-parc">parcela ${c.parcela.atual}/${c.parcela.total}</span>` : ''
        return `<li class="rt-item rc-item${r === 'sim' ? ' is-sim' : r === 'nao' ? ' is-nao' : ''}${dentro ? ' fp-sub' : ''}">
          <div class="rt-item__top"><strong>${esc(c.descricao)} ${parc}</strong><span>${money(c.valor)}</span></div>
          <small>${dfmt(c.data)}${c.data_compra ? ` · comprado em ${dfmt(c.data_compra)}` : ''} · ${c.status === 'pago' ? 'pago' : 'a pagar'}${dentro ? '' : ` · ${Number(c.pontos)} pontos · ${c.motivos.map(esc).join(' · ')}`}</small>
          <div class="rt-acoes">
            ${dentro ? '' : selPapel(c.id, papel, '_papel')}
            <button class="ds-btn ds-btn--sm ${r === 'sim' ? 'ds-btn--primary' : ''}" onclick="VMTerminalFinanciamentos._marcar(${Number(c.id)}, 'sim')"><i class="fas fa-check"></i> Sim</button>
            <button class="ds-btn ds-btn--sm ${r === 'nao' ? 'rc-nao-ativo' : ''}" onclick="VMTerminalFinanciamentos._marcar(${Number(c.id)}, 'nao')"><i class="fas fa-xmark"></i> Não</button>
          </div></li>`
      }
      const serie = (sr, k) => {
        const xs = sr.ids.map(id => porId.get(id)).filter(Boolean)
        const sims = xs.filter(x => this._resp[x.id] === 'sim').length, naos = xs.filter(x => this._resp[x.id] === 'nao').length
        const aberta = this._abertas?.has(sr.chave)
        const papel = this._papelSerie?.[sr.chave] || sr.papel
        return `<li class="fp-serie${sims === xs.length ? ' is-sim' : naos === xs.length ? ' is-nao' : ''}">
          <div class="rt-item__top"><strong>${esc(sr.descricao)} <span class="fp-parc">${sr.total_parcelas}x</span></strong><span>${money(sr.valor_total)}</span></div>
          <small>${xs.length} de ${sr.total_parcelas} parcelas nesta lista${sr.data_compra ? ` · comprado em ${dfmt(sr.data_compra)}` : ''} · ${sr.pagas} paga${sr.pagas === 1 ? '' : 's'}, ${sr.a_pagar} a pagar
            ${sims || naos ? ` · <b>${sims} sim, ${naos} não</b>` : ''}</small>
          ${sr.repetidas.length ? `<small class="fp-alerta">⚠ Parcela ${sr.repetidas.join(', ')} aparece mais de uma vez nesta compra — provável lançamento duplicado. “Sim na compra” liga só uma de cada; abra as parcelas para conferir.</small>` : ''}
          ${sr.ausentes.length ? `<small>Fora da lista: ${sr.ausentes.length > 8 ? `${sr.ausentes.length} parcelas` : `parcela${sr.ausentes.length > 1 ? 's' : ''} ${sr.ausentes.join(', ')}`} (já ligadas, apagadas ou ainda não lançadas).</small>` : ''}
          <div class="rt-acoes">
            ${selPapel(k, papel, '_papelDaSerie')}
            <button class="ds-btn ds-btn--sm ${sims === xs.length ? 'ds-btn--primary' : ''}" onclick="VMTerminalFinanciamentos._serie(${k}, 'sim')"><i class="fas fa-check"></i> Sim, a compra toda</button>
            <button class="ds-btn ds-btn--sm ${naos === xs.length ? 'rc-nao-ativo' : ''}" onclick="VMTerminalFinanciamentos._serie(${k}, 'nao')"><i class="fas fa-xmark"></i> Não</button>
            <button class="tl-link" onclick="VMTerminalFinanciamentos._abrirSerie(${k})">${aberta ? 'esconder' : 'ver'} as ${xs.length} parcelas</button>
          </div>
          ${aberta ? `<ul class="fp-serie__parc">${xs.map(x => item(x, true)).join('')}</ul>` : ''}
        </li>`
      }
      const avulsos = d.candidatos.filter(c => !naSerie.has(c.id))
      const sims = Object.values(this._resp).filter(v => v === 'sim').length
      const naos = Object.values(this._resp).filter(v => v === 'nao').length
      this._vm.showModal(`<div class="rp-modal rt-modal">
        <header class="rp-cab"><div>
          <h3>Lançamentos de ${esc(d.financiamento.descricao)}?</h3>
          <p>Despesas dos últimos 5 anos e as futuras que parecem deste financiamento. As parcelas de uma mesma compra vêm juntas — pelo número da parcela gravado na despesa, mesmo quando o nome não tem “(3/10)”. Cada parcela é somada uma vez, pelo seu valor; o status (pago ou a pagar) vem de Despesas.</p>
        </div></header>
        <div class="rp-lista rt-lista">
          ${series.length ? `<h4 class="rt-sec">Compras parceladas · ${series.length}</h4><ul>${series.map(serie).join('')}</ul>` : ''}
          ${avulsos.length ? `<h4 class="rt-sec">Lançamentos avulsos · ${avulsos.length}</h4><ul>${avulsos.map(c => item(c, false)).join('')}</ul>` : ''}
          ${!d.candidatos.length ? '<div class="rp-vazio">Nada parecido sem vínculo.</div>' : ''}
        </div>
        <label class="rc-aprender"><input type="checkbox" id="fp-aprender" ${this._aprender === false ? '' : 'checked'} style="accent-color:var(--terminal-primary)"
          onchange="VMTerminalFinanciamentos._aprender = this.checked">
          Aprender os nomes confirmados (os próximos lançamentos com esse nome entram sozinhos)</label>
        <div class="rp-rodape rt-rodape">
          <button class="ds-btn ds-btn--primary" ${sims + naos ? '' : 'disabled'} onclick="VMTerminalFinanciamentos._confirmar(${fid})">Confirmar ${sims} sim · ${naos} não</button>
          <button class="ds-btn" onclick="VM.closeModal()">Fechar</button>
        </div></div>`, { largura: 720 })
    },
    _serie(k, r) {
      const sr = (this._cand.series || [])[k]; if (!sr) return
      const xs = sr.ids.map(id => this._cand.candidatos.find(c => c.id === id)).filter(Boolean)
      const todos = xs.every(x => this._resp[x.id] === r)
      const visto = new Set()
      for (const x of xs) {
        if (todos) { this._resp[x.id] = undefined; continue }
        // Duplicada: só a primeira de cada número de parcela leva o "sim".
        const num = x.parcela?.atual
        if (r === 'sim' && num != null && visto.has(num)) { this._resp[x.id] = undefined; continue }
        if (num != null) visto.add(num)
        this._resp[x.id] = r
        this._papelEsc[x.id] = this._papelSerie?.[sr.chave] || sr.papel
      }
      this._repintar()
    },
    _papelDaSerie(k, p) {
      const sr = (this._cand.series || [])[k]; if (!sr) return
      this._papelSerie = this._papelSerie || {}; this._papelSerie[sr.chave] = p
      for (const id of sr.ids) this._papelEsc[id] = p
    },
    _abrirSerie(k) {
      const sr = (this._cand.series || [])[k]; if (!sr) return
      this._abertas = this._abertas || new Set()
      this._abertas.has(sr.chave) ? this._abertas.delete(sr.chave) : this._abertas.add(sr.chave)
      this._repintar()
    },
    _repintar() {
      const l = document.querySelector('.rt-lista'), t = l ? l.scrollTop : 0
      this._pintarProcura()
      const n = document.querySelector('.rt-lista'); if (n) n.scrollTop = t
    },
    _marcar(id, r) { this._resp[id] = this._resp[id] === r ? undefined : r; this._repintar() },
    _papel(id, p) { this._papelEsc[id] = p },
    async _confirmar(fid) {
      const vm = this._vm, cs = this._cand.candidatos
      const itens = cs.filter(c => this._resp[c.id] === 'sim').map(c => ({ despesa_id: c.id, papel: this._papelEsc[c.id] || c.papel }))
      const nao = cs.filter(c => this._resp[c.id] === 'nao').map(c => c.id)
      const r = await vm.api('POST', `financiamentos/${fid}/vincular`, { itens, nao, aprender: this._aprender !== false })
        .catch(e => ({ error: e.response?.data?.error }))
      if (!r?.success) return vm.toast(r?.error || 'Não foi possível salvar.', 'error')
      vm.closeModal()
      vm.toast(`${r.vinculados} lançamento(s) ligados${r.aprendidos?.length ? ` · ${r.aprendidos.length} nome(s) aprendido(s)` : ''}.`, 'success')
      this.abrir(fid)
    },
  }
})()
