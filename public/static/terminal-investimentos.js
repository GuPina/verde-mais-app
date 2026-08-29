(function () {
  const esc = (v) => String(v ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;')
  const money = (v) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 2 }).format(Number(v) || 0)
  const pct = (v) => `${Number(v) >= 0 ? '+' : ''}${(Number(v) || 0).toFixed(2)}%`

  const TIPOS = { tesouro_direto: 'Tesouro Direto', cdb: 'CDB', lci: 'LCI', lca: 'LCA', acoes: 'Ações', fii: 'FII', cripto: 'Cripto', poupanca: 'Poupança', caixinha: 'Caixinha', outros: 'Outros' }
  const COLORS = ['#3DDC84', '#F2C94C', '#6EA8FE', '#B58AF4', '#FF8C69', '#8BA397', '#5AD1C4', '#E5709B']

  window.VMTerminalInvestimentos = {
    async render(vm) {
      this._vm = vm
      const content = document.getElementById('page-content')
      if (!content) return
      document.body.classList.add('terminal-dashboard-active')
      content.innerHTML = '<div class="td-loading"><span></span><span></span><span></span></div>'
      try {
        const data = await vm.api('GET', 'investimentos')
        this._cache = data.investimentos || []
        this._resumo = data.resumo || {}
        this._cdi = data.cdi_atual
        this._paint()
      } catch (e) {
        content.innerHTML = `<div class="td-error"><i class="fas fa-triangle-exclamation"></i><h2>Não foi possível carregar os Investimentos</h2><p>${esc(e.response?.data?.error || 'Tente novamente.')}</p><button class="td-button td-button--primary" onclick="VM.pageInvestimentos()">Tentar novamente</button></div>`
      }
    },
    reload() { this.render(this._vm) },

    _paint() {
      const content = document.getElementById('page-content')
      if (!content) return
      const list = this._cache || []
      const r = this._resumo || {}
      const lucro = Number(r.lucro_prejuizo || 0)

      // alocação por tipo
      const porTipo = {}
      for (const i of list) porTipo[i.tipo] = (porTipo[i.tipo] || 0) + Number(i.valor_atual || 0)
      const totalAtual = Number(r.total_atual || list.reduce((s, i) => s + Number(i.valor_atual || 0), 0))
      const aloc = Object.entries(porTipo).map(([t, v], idx) => ({ tipo: t, valor: v, pct: totalAtual > 0 ? (v / totalAtual) * 100 : 0, cor: COLORS[idx % COLORS.length] })).sort((a, b) => b.valor - a.valor)

      content.innerHTML = `<div class="td-dashboard ti">
        <header class="td-dashboard__header">
          <div>
            <span class="td-eyebrow">Patrimônio & rentabilidade</span>
            <h1>Investimentos. <em>Faça o dinheiro render.</em></h1>
            <p>Sua carteira, a rentabilidade de cada ativo e a comparação com o CDI.</p>
          </div>
          <div class="td-dashboard__header-actions">
            <button class="td-button td-button--primary" onclick="VMTerminalInvestimentos.novo()"><i class="fas fa-plus"></i> Novo aporte</button>
          </div>
        </header>

        <section class="ti-top">
          <article class="ti-patrimony">
            <div class="td-patrimony__top"><span class="td-eyebrow">Patrimônio investido</span><span class="td-chip"><i class="fas fa-chart-line"></i> ${list.length} ativo(s)</span></div>
            <strong>${money(r.total_atual)}</strong>
            <div class="ti-patrimony__row">
              <span class="${lucro >= 0 ? 'is-pos' : 'is-neg'}">${lucro >= 0 ? '▲' : '▼'} ${money(Math.abs(lucro))} <small>(${pct(r.rentabilidade_total)})</small></span>
              <span class="ti-cdi">CDI ${this._cdi ? Number(this._cdi).toFixed(2) + '% a.a.' : '—'}</span>
            </div>
            <div class="ti-invested"><small>Total investido</small> <b>${money(r.total_investido)}</b></div>
          </article>
          <article class="td-panel ti-aloc">
            <div class="td-panel__head"><div><span class="td-eyebrow">Distribuição</span><h2>Alocação por tipo</h2></div></div>
            ${aloc.length ? `
              <div class="ti-aloc__bar">${aloc.map(a => `<span style="width:${Math.max(1, a.pct)}%;background:${a.cor}" title="${TIPOS[a.tipo] || a.tipo}: ${money(a.valor)}"></span>`).join('')}</div>
              <div class="ti-aloc__list">${aloc.map(a => `<div><i style="background:${a.cor}"></i><span>${esc(TIPOS[a.tipo] || a.tipo)}</span><em>${a.pct.toFixed(0)}%</em><b>${money(a.valor)}</b></div>`).join('')}</div>
            ` : '<div class="td-empty-row"><i class="fas fa-chart-pie"></i><span>Sem ativos para distribuir.</span></div>'}
          </article>
        </section>

        ${list.length === 0 ? this._empty() : `
          <div class="tm-group__head" style="margin-top:8px"><span class="td-eyebrow">Carteira · ${list.length}</span></div>
          <div class="ti-grid">${list.map((i, idx) => this._card(i, idx)).join('')}</div>`}
      </div>`
    },

    _card(i, idx) {
      const rent = Number(i.rentabilidade_percentual || 0)
      const cor = COLORS[Object.keys(TIPOS).indexOf(i.tipo) % COLORS.length] || 'var(--terminal-primary)'
      const j = esc(JSON.stringify({ id: i.id, nome: i.nome, tipo: i.tipo, valor_investido: Number(i.valor_investido), rentabilidade_percentual: rent, risco: i.risco, data_inicio: i.data_inicio, data_vencimento: i.data_vencimento, instituicao: i.instituicao, symbol: i.symbol, meta_valor: i.meta_valor }))
      const live = i.cotacao_ao_vivo
      return `<article class="ti-card">
        <div class="ti-card__head">
          <span class="ti-tag" style="color:${cor};border-color:${cor}55">${esc(TIPOS[i.tipo] || i.tipo)}</span>
          ${i.instituicao ? `<small>${esc(i.instituicao)}</small>` : ''}
        </div>
        <strong class="ti-card__name">${esc(i.nome)}${i.symbol ? ` <em>${esc(i.symbol)}</em>` : ''}</strong>
        <div class="ti-card__val">${money(i.valor_atual)}</div>
        <div class="ti-card__rent ${rent >= 0 ? 'is-pos' : 'is-neg'}">${pct(rent)}${live && live.variacao_24h != null ? ` <small style="color:${live.variacao_24h >= 0 ? 'var(--terminal-primary)' : 'var(--terminal-negative)'}">24h ${pct(live.variacao_24h)}</small>` : ''}</div>
        ${i.meta_valor && i.progresso_meta != null ? `<div class="to-bar" style="margin-top:2px"><span style="width:${Math.min(100, i.progresso_meta)}%;background:${cor}"></span></div><small style="color:var(--terminal-ink-soft);font-size:11px">${Math.round(i.progresso_meta)}% da meta ${money(i.meta_valor)}</small>` : ''}
        <div class="ti-card__actions">
          <button class="td-button td-button--primary" title="Aportar" onclick='VMTerminalInvestimentos.aportar(${Number(i.id)}, ${esc(JSON.stringify(i.nome))})'><i class="fas fa-plus"></i></button>
          <button class="td-button" title="Resgatar" onclick='VMTerminalInvestimentos.resgatar(${Number(i.id)}, ${esc(JSON.stringify(i.nome))}, ${Number(i.valor_atual)})'><i class="fas fa-arrow-down"></i></button>
          <button class="td-button" title="Editar" onclick='VMTerminalInvestimentos.editar(${j})'><i class="fas fa-pen"></i></button>
          <button class="td-button" title="Histórico" onclick='VMTerminalInvestimentos.historico(${Number(i.id)}, ${esc(JSON.stringify(i.nome))})'><i class="fas fa-clock-rotate-left"></i></button>
          <button class="td-button" title="Excluir" onclick='VMTerminalInvestimentos.excluir(${Number(i.id)}, ${esc(JSON.stringify(i.nome))})'><i class="fas fa-trash"></i></button>
        </div>
      </article>`
    },

    _empty() {
      return `<section class="td-onboarding tm-empty"><div class="td-onboarding__copy">
        <span class="td-eyebrow">Comece a construir patrimônio</span>
        <h2>Registre seu primeiro investimento.</h2>
        <p>Tesouro, CDB, ações, FIIs, cripto ou caixinha — acompanhe a rentabilidade de cada um.</p>
        <div class="td-onboarding__actions"><button class="td-button td-button--primary" onclick="VMTerminalInvestimentos.novo()"><i class="fas fa-plus"></i> Adicionar investimento</button></div>
      </div></section>`
    },

    // ── modais / ações ──
    _st() { return 'width:100%;background:var(--terminal-bg);border:1px solid var(--terminal-line);color:var(--terminal-ink);border-radius:var(--terminal-radius-sm);padding:10px 12px;font-size:13px;font-family:var(--terminal-font)' },
    _lab(t) { return `<label style="display:block;font:700 10px/1 var(--terminal-mono);letter-spacing:.1em;text-transform:uppercase;color:var(--terminal-ink-soft);margin-bottom:6px">${t}</label>` },
    _form(inv) {
      const s = this._st(), tipo = inv?.tipo || 'cdb'
      const opts = Object.entries(TIPOS).map(([k, v]) => `<option value="${k}" ${k === tipo ? 'selected' : ''}>${v}</option>`).join('')
      const riscos = ['baixo', 'medio', 'alto'].map(r => `<option value="${r}" ${r === (inv?.risco || 'baixo') ? 'selected' : ''}>${r}</option>`).join('')
      return `<div style="font-family:var(--terminal-font);color:var(--terminal-ink)">
        <div style="font-size:16px;font-weight:640">${inv ? 'Editar investimento' : 'Novo investimento'}</div>
        <div style="color:var(--terminal-ink-soft);font-size:12px;margin:4px 0 18px">${inv ? '' : 'Deixe "valor atual" vazio se não souber — mantemos o histórico.'}</div>
        <div style="display:flex;flex-direction:column;gap:13px">
          <div style="display:flex;gap:10px">
            <div style="flex:2">${this._lab('Nome')}<input id="ti-nome" style="${s}" value="${esc(inv?.nome || '')}" placeholder="Ex.: Tesouro Selic 2029"></div>
            <div style="flex:1">${this._lab('Tipo')}<select id="ti-tipo" style="${s}" onchange="VMTerminalInvestimentos._tipoChange()">${opts}</select></div>
          </div>
          <div style="display:flex;gap:10px">
            <div style="flex:1">${this._lab('Valor investido (R$)')}<input id="ti-inv" type="number" min="0.01" step="0.01" style="${s}" value="${inv?.valor_investido ?? ''}"></div>
            <div style="flex:1">${this._lab('Rentabilidade (%)')}<input id="ti-rent" type="number" step="0.01" style="${s}" value="${inv?.rentabilidade_percentual ?? 0}"></div>
          </div>
          <div id="ti-symbol-wrap" style="display:${tipo === 'cripto' ? 'block' : 'none'}">${this._lab('Símbolo (cripto — ex.: BTC)')}<input id="ti-symbol" style="${s}" value="${esc(inv?.symbol || '')}" placeholder="BTC, ETH…"></div>
          <div style="display:flex;gap:10px">
            <div style="flex:1">${this._lab('Início')}<input id="ti-ini" type="date" style="${s}" value="${inv?.data_inicio ? String(inv.data_inicio).slice(0, 10) : new Date().toISOString().slice(0, 10)}"></div>
            <div style="flex:1">${this._lab('Vencimento (opcional)')}<input id="ti-venc" type="date" style="${s}" value="${inv?.data_vencimento ? String(inv.data_vencimento).slice(0, 10) : ''}"></div>
          </div>
          <div style="display:flex;gap:10px">
            <div style="flex:1">${this._lab('Risco')}<select id="ti-risco" style="${s}">${riscos}</select></div>
            <div style="flex:1">${this._lab('Instituição (opcional)')}<input id="ti-inst" style="${s}" value="${esc(inv?.instituicao || '')}"></div>
          </div>
          ${inv ? `<div>${this._lab('Valor atual (opcional)')}<input id="ti-atual" type="number" step="0.01" style="${s}" placeholder="deixe vazio para manter"></div>` : ''}
          <div style="display:flex;gap:8px;margin-top:6px">
            <button class="td-button td-button--primary" style="flex:1" onclick="VMTerminalInvestimentos.salvar(${inv ? Number(inv.id) : 'null'})"><i class="fas fa-check"></i> Salvar</button>
            <button class="td-button" onclick="VM.closeModal()">Cancelar</button>
          </div>
        </div></div>`
    },
    _tipoChange() { const w = document.getElementById('ti-symbol-wrap'); if (w) w.style.display = document.getElementById('ti-tipo')?.value === 'cripto' ? 'block' : 'none' },
    novo() { this._vm.showModal(this._form(null)) },
    editar(inv) { this._vm.showModal(this._form(inv)) },
    async salvar(id) {
      const vm = this._vm
      const g = (x) => document.getElementById(x)
      const nome = g('ti-nome')?.value?.trim()
      const tipo = g('ti-tipo')?.value
      const valor_investido = parseFloat(g('ti-inv')?.value)
      const rent = parseFloat(g('ti-rent')?.value) || 0
      const symbol = g('ti-symbol')?.value?.trim() || null
      const data_inicio = g('ti-ini')?.value
      const data_vencimento = g('ti-venc')?.value || null
      const risco = g('ti-risco')?.value
      const instituicao = g('ti-inst')?.value?.trim() || null
      const vAtual = g('ti-atual')?.value
      if (!nome) return vm.toast('Informe o nome.', 'error')
      if (!(valor_investido > 0)) return vm.toast('Valor investido deve ser maior que zero.', 'error')
      const body = { nome, tipo, valor_investido, rentabilidade_percentual: rent, risco, data_inicio, data_vencimento, symbol, instituicao }
      if (id && vAtual !== undefined && vAtual !== '') body.valor_atual = parseFloat(vAtual)
      const r = await vm.api(id ? 'PUT' : 'POST', id ? `investimentos/${id}` : 'investimentos', body).catch(e => ({ error: e.response?.data?.error }))
      if (r?.success) { vm.closeModal(); vm.toast(id ? 'Investimento atualizado.' : 'Investimento adicionado.', 'success'); this.reload() }
      else vm.toast(r?.error || 'Erro ao salvar.', 'error')
    },
    async aportar(id, nome) {
      const vm = this._vm
      const txt = window.prompt(`Aportar quanto em "${nome}"?`, '')
      if (txt === null) return
      const valor = parseFloat(txt)
      if (!(valor > 0)) return vm.toast('Valor inválido.', 'error')
      const r = await vm.api('PATCH', `investimentos/${id}/rebalancear`, { valor }).catch(e => ({ error: e.response?.data?.error }))
      if (r?.success) { vm.toast('Aporte registrado.', 'success'); this.reload() }
      else vm.toast(r?.error || 'Erro ao aportar.', 'error')
    },
    async resgatar(id, nome, disponivel) {
      const vm = this._vm
      const txt = window.prompt(`Resgatar quanto de "${nome}"? (disponível: ${money(disponivel)})`, '')
      if (txt === null) return
      const valor = parseFloat(txt)
      if (!(valor > 0)) return vm.toast('Valor inválido.', 'error')
      const r = await vm.api('PATCH', `investimentos/${id}/resgate`, { valor, registrar_receita: true }).catch(e => ({ error: e.response?.data?.error }))
      if (r?.success) { vm.toast('Resgate realizado.', 'success'); this.reload() }
      else vm.toast(r?.error || 'Erro ao resgatar.', 'error')
    },
    async historico(id, nome) {
      const vm = this._vm
      const r = await vm.api('GET', `investimentos/${id}/historico`).catch(() => ({ historico: [] }))
      const rows = (r.historico || []).map(h => `<div style="display:flex;justify-content:space-between;gap:12px;padding:9px 0;border-bottom:1px solid var(--terminal-line);font-size:13px"><span>${esc(String(h.data).slice(0, 10))}</span><span style="flex:1;color:var(--terminal-ink-soft)">${esc(h.descricao)}</span><b style="font-family:var(--terminal-mono)">${money(h.valor)}</b></div>`).join('') || '<div style="color:var(--terminal-ink-soft);font-size:13px;padding:12px 0">Nenhum aporte registrado ainda.</div>'
      vm.showModal(`<div style="font-family:var(--terminal-font);color:var(--terminal-ink)">
        <div style="font-size:16px;font-weight:640">Histórico — ${esc(nome)}</div>
        <div style="color:var(--terminal-ink-soft);font-size:12px;margin:4px 0 14px">Total aportado: ${money(r.total_aportado)}</div>
        <div style="max-height:340px;overflow:auto">${rows}</div>
        <div style="margin-top:14px"><button class="td-button" onclick="VM.closeModal()">Fechar</button></div>
      </div>`)
    },
    async excluir(id, nome) {
      const vm = this._vm
      const ok = await vm.vmConfirm(`Excluir <strong>${esc(nome)}</strong> da carteira?`, { titulo: 'Excluir investimento', corBotao: '#FF6B6B', textoBotao: 'Excluir', icone: '🗑️' })
      if (!ok) return
      const r = await vm.api('DELETE', `investimentos/${id}`).catch(e => ({ error: e.response?.data?.error }))
      if (r?.success) { vm.toast('Investimento excluído.', 'success'); this.reload() }
      else vm.toast(r?.error || 'Erro ao excluir.', 'error')
    }
  }
})()
