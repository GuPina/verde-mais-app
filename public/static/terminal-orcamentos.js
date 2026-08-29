(function () {
  const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro']
  const MES_ABREV = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']

  const esc = (value) => String(value ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#039;')

  const money = (value) => new Intl.NumberFormat('pt-BR', {
    style: 'currency', currency: 'BRL', maximumFractionDigits: 2
  }).format(Number(value) || 0)

  const STATUS = {
    ok:         { label: 'no verde', cls: 'ok' },
    attention:  { label: 'atenção', cls: 'warn' },
    warning_70: { label: '70%+', cls: 'warn' },
    warning_90: { label: '90%+', cls: 'over' },
    warning:    { label: 'alerta', cls: 'over' },
    exceeded:   { label: 'excedido', cls: 'over' }
  }
  const barColor = (pct, excedido) => excedido || pct >= 100 ? 'var(--terminal-negative)' : pct >= 90 ? '#F97316' : pct >= 70 ? 'var(--terminal-accent)' : 'var(--terminal-primary)'

  window.VMTerminalOrcamentos = {
    async render(vm, mes, ano) {
      this._vm = vm
      const now = new Date()
      this._mes = Number(mes || this._mes || now.getMonth() + 1)
      this._ano = Number(ano || this._ano || now.getFullYear())
      const content = document.getElementById('page-content')
      if (!content) return
      document.body.classList.add('terminal-dashboard-active')

      // Gate de plano: mantém o upsell do app quando free
      if ((vm.user?.plano || 'free') === 'free' && vm.upsellBlock) {
        content.innerHTML = vm.upsellBlock('orcamentos', '📊 Orçamentos por Categoria',
          'Defina limites mensais por categoria e veja em tempo real quanto ainda pode gastar.',
          ['Alertas em 70%, 90% e 100% do limite', 'Orçamento global + por categoria', 'Rollover do saldo não gasto', 'Sugestão pelos últimos 3 meses', 'Aviso antes de estourar ao lançar despesa'])
        return
      }

      content.innerHTML = '<div class="td-loading"><span></span><span></span><span></span></div>'
      try {
        const data = await vm.api('GET', `orcamentos?mes=${this._mes}&ano=${this._ano}`)
        this._data = data
        if (data.limites) vm.limites = data.limites
        this._paint()
      } catch (error) {
        content.innerHTML = `<div class="td-error"><i class="fas fa-triangle-exclamation"></i><h2>Não foi possível carregar os Orçamentos</h2><p>${esc(error.response?.data?.error || 'Tente novamente em instantes.')}</p><button class="td-button td-button--primary" onclick="VMTerminalOrcamentos.reload()">Tentar novamente</button></div>`
      }
    },

    reload() { this.render(this._vm, this._mes, this._ano) },

    _paint() {
      const content = document.getElementById('page-content')
      if (!content) return
      const orcs = this._data.orcamentos || []
      const sem = this._data.semOrcamento || []
      const global = this._data.global || null

      const totalLimite = orcs.reduce((s, o) => s + (Number(o.limite_efetivo) || Number(o.limite) || 0), 0)
      const totalGasto  = orcs.reduce((s, o) => s + Number(o.gasto || 0), 0)
      const pctSoma     = totalLimite > 0 ? Math.round((totalGasto / totalLimite) * 100) : 0
      const excedidos   = orcs.filter(o => o.excedido || o.status === 'exceeded').length
      const emAlerta    = orcs.filter(o => ['attention', 'warning', 'warning_70', 'warning_90'].includes(o.status)).length
      const noVerde     = orcs.filter(o => o.status === 'ok').length

      const status = statusFor(this._mes, this._ano)

      content.innerHTML = `<div class="td-dashboard to">
        <header class="td-dashboard__header">
          <div>
            <span class="td-eyebrow">Planejamento</span>
            <h1>Orçamentos. <em>Cada real com destino.</em></h1>
            <p>Limites por categoria, alertas em 70/90/100% e rollover do que sobra.</p>
          </div>
          <div class="td-dashboard__header-actions">
            <button class="td-button" onclick="VMTerminalOrcamentos.abrirGlobal()"><i class="fas fa-globe"></i> Global</button>
            <button class="td-button" onclick="VMTerminalOrcamentos.rollover()"><i class="fas fa-rotate"></i> Rollover</button>
            <button class="td-button td-button--primary" onclick="VMTerminalOrcamentos.novo()"><i class="fas fa-plus"></i> Novo orçamento</button>
          </div>
        </header>

        <section class="td-period" aria-label="Filtro de período">
          <button onclick="VMTerminalOrcamentos.shift(-1)" aria-label="Mês anterior"><i class="fas fa-chevron-left"></i></button>
          <label><span>Mês</span><select id="to-month" onchange="VMTerminalOrcamentos.changePeriod()">${MESES.map((name, i) => `<option value="${i + 1}" ${this._mes === i + 1 ? 'selected' : ''}>${name}</option>`).join('')}</select></label>
          <label><span>Ano</span><select id="to-year" onchange="VMTerminalOrcamentos.changePeriod()">${this._vm._anosOpcoes(this._ano)}</select></label>
          <button onclick="VMTerminalOrcamentos.shift(1)" aria-label="Próximo mês"><i class="fas fa-chevron-right"></i></button>
          <button class="td-period__today" onclick="VMTerminalOrcamentos.today()">Hoje</button>
          <span class="td-period__status td-period__status--${status.key}"><i class="fas fa-circle"></i> ${status.label}</span>
        </section>

        <section class="to-summary">
          ${this._globalPanel(global)}
          ${this._sumPanel(totalGasto, totalLimite, pctSoma, orcs.length, excedidos, emAlerta, noVerde, global)}
        </section>

        ${orcs.length === 0 ? this._empty() : `
          <div class="tm-group__head" style="margin-top:6px"><span class="td-eyebrow">Por categoria · ${orcs.length}</span></div>
          <div class="to-grid">${orcs.map(o => this._card(o)).join('')}</div>`}

        ${sem.length ? `
          <div class="tm-group__head" style="margin-top:26px"><span class="td-eyebrow">Sem orçamento neste mês</span></div>
          <div class="to-suggest">${sem.map(s => `<button class="to-suggest__chip" onclick="VMTerminalOrcamentos.novo('${s.categoria}'${s.sugestao ? `, ${s.sugestao}` : ''})">${esc(s.label)}${s.sugestao ? ` <em>· sugestão ${money(s.sugestao)}</em>` : ''} <i class="fas fa-plus"></i></button>`).join('')}</div>` : ''}
      </div>`
    },

    _globalPanel(global) {
      if (!global) {
        return `<article class="to-aside" style="justify-content:center;align-items:flex-start;gap:10px">
          <span class="td-eyebrow">Orçamento global</span>
          <p style="margin:0;color:var(--terminal-ink-soft);font-size:12px">Um teto único para o mês inteiro, além dos limites por categoria.</p>
          <button class="td-button td-button--primary" onclick="VMTerminalOrcamentos.abrirGlobal()"><i class="fas fa-plus"></i> Definir teto global</button>
        </article>`
      }
      const pct = Number(global.percentual) || 0
      const over = global.status === 'exceeded'
      return `<article class="to-global ${over ? 'to-global--over' : ''}">
        <div class="to-global__top">
          <span class="td-eyebrow"><i class="fas fa-globe"></i> Teto global do mês</span>
          <span class="to-status to-status--${over ? 'over' : pct >= 70 ? 'warn' : 'ok'}">${pct}%</span>
        </div>
        <div class="to-global__value">${money(global.gasto)} <small>de ${money(global.limite_efetivo)}</small></div>
        <div class="to-bar">${pct >= 70 ? '<span class="to-bar__mark" style="left:70%"></span>' : ''}${pct >= 90 ? '<span class="to-bar__mark" style="left:90%"></span>' : ''}<span style="width:${Math.min(100, pct)}%;background:${barColor(pct, over)}"></span></div>
        <div class="to-card__foot">
          <span>${over ? `Excedeu ${money(Math.abs(global.limite_efetivo - global.gasto))}` : `Restam ${money(global.restante)}`}${global.rollover ? ` · rollover ${money(global.rollover)}` : ''}</span>
          <span class="to-card__actions">
            <button class="td-button" onclick="VMTerminalOrcamentos.abrirGlobal()"><i class="fas fa-pen"></i></button>
            <button class="td-button" onclick="VMTerminalOrcamentos.deletarGlobal()"><i class="fas fa-trash"></i></button>
          </span>
        </div>
      </article>`
    },

    _sumPanel(gasto, limite, pct, qtd, excedidos, emAlerta, noVerde, global) {
      // O9/O23: explicar a diferença entre soma das categorias e o teto global
      const nota = global
        ? `Soma das categorias: ${money(limite)}. O teto global do mês é ${money(global.limite_efetivo)} — números diferentes por definição.`
        : `Limite somado de todas as categorias com orçamento neste mês.`
      return `<article class="to-aside">
        <div class="to-aside__row"><span class="td-eyebrow">Soma das categorias</span><span class="to-status to-status--${pct > 100 ? 'over' : pct >= 70 ? 'warn' : 'ok'}">${pct}%</span></div>
        <div class="to-global__value" style="font-size:clamp(24px,2.6vw,32px)">${money(gasto)} <small>de ${money(limite)}</small></div>
        <div class="to-bar"><span style="width:${Math.min(100, pct)}%;background:${barColor(pct, pct > 100)}"></span></div>
        <div class="to-aside__stats">
          <div><strong style="color:var(--terminal-primary)">${noVerde}</strong><small>no verde</small></div>
          <div><strong style="color:var(--terminal-accent)">${emAlerta}</strong><small>em alerta</small></div>
          <div><strong style="color:var(--terminal-negative)">${excedidos}</strong><small>excedidos</small></div>
        </div>
        <p class="to-global__explain"><i class="fas fa-circle-info"></i> ${esc(nota)}</p>
      </article>`
    },

    _card(o) {
      const cfg = STATUS[o.status] || STATUS.ok
      const pct = Number(o.percentual) || 0
      const excedido = !!o.excedido || o.status === 'exceeded'
      const rollover = Number(o.rollover) || 0
      const oJson = esc(JSON.stringify({ id: o.id, categoria: o.categoria, limite: Number(o.limite), alerta_percentual: Number(o.alerta_percentual) || 80, label: o.label, gasto: Number(o.gasto) }))
      return `<article class="to-card to-card--${cfg.cls}">
        <div class="to-card__head">
          <span class="to-card__cat">${esc(o.label)}</span>
          <span class="to-status to-status--${cfg.cls}">${cfg.label}</span>
        </div>
        <div class="to-card__nums">
          <strong>${money(o.gasto)}</strong><small>de ${money(o.limite_efetivo)}</small>
          <span class="to-pct" style="color:${barColor(pct, excedido)}">${pct}%</span>
        </div>
        <div class="to-bar">${pct >= 70 && pct < 100 ? '<span class="to-bar__mark" style="left:70%"></span>' : ''}${pct >= 90 && pct < 100 ? '<span class="to-bar__mark" style="left:90%"></span>' : ''}<span style="width:${Math.min(100, pct)}%;background:${barColor(pct, excedido)}"></span></div>
        <div class="to-card__foot">
          <span>${excedido ? `<span style="color:var(--terminal-negative)">Excedeu ${money(Math.abs(o.restante_real))}</span>` : `Restam ${money(o.restante)}`}${rollover ? ` <span class="to-rollover"><i class="fas fa-rotate"></i>${rollover > 0 ? '+' : ''}${money(rollover)}</span>` : ''}</span>
          <span class="to-card__actions">
            <button class="td-button" title="Editar" onclick='VMTerminalOrcamentos.editar(${oJson})'><i class="fas fa-pen"></i></button>
            <button class="td-button" title="Excluir" onclick='VMTerminalOrcamentos.deletar(${oJson})'><i class="fas fa-trash"></i></button>
          </span>
        </div>
      </article>`
    },

    _empty() {
      return `<section class="td-onboarding tm-empty">
        <div class="td-onboarding__copy">
          <span class="td-eyebrow">Comece pelo essencial</span>
          <h2>Dê um teto para onde o dinheiro escorre.</h2>
          <p>Defina limites por categoria e o VerdeMais avisa em 70%, 90% e 100% — antes do estouro.</p>
          <div class="td-onboarding__actions"><button class="td-button td-button--primary" onclick="VMTerminalOrcamentos.novo()"><i class="fas fa-plus"></i> Criar meu primeiro orçamento</button></div>
        </div>
      </section>`
    },

    // ── Navegação de período ───────────────────────────────────────────────
    changePeriod() {
      const m = Number(document.getElementById('to-month')?.value)
      const y = Number(document.getElementById('to-year')?.value)
      if (m && y) this.render(this._vm, m, y)
    },
    shift(delta) {
      const d = new Date(this._ano, this._mes - 1 + delta, 1)
      this.render(this._vm, d.getMonth() + 1, d.getFullYear())
    },
    today() { const n = new Date(); this.render(this._vm, n.getMonth() + 1, n.getFullYear()) },

    // ── Ações (modais em estilo terminal) ──────────────────────────────────
    _fieldInput(id, attrs, value) {
      return `<input id="${id}" ${attrs} value="${value ?? ''}" style="width:100%;background:var(--terminal-bg);border:1px solid var(--terminal-line);color:var(--terminal-ink);border-radius:var(--terminal-radius-sm);padding:10px 12px;font-size:13px;font-family:var(--terminal-font)">`
    },
    _catOptions(selected) {
      const cats = { alimentacao: '🍽️ Alimentação', moradia: '🏠 Moradia', transporte: '🚗 Transporte', saude: '🏥 Saúde', educacao: '📚 Educação', lazer: '🎮 Lazer', vestuario: '👕 Vestuário', beleza: '💄 Beleza', pets: '🐾 Pets', assinaturas: '📱 Assinaturas', tecnologia: '💻 Tecnologia', viagem: '✈️ Viagens', outros: '📦 Outros', fixo: '📌 Gastos Fixos', supermercado: '🛒 Supermercado' }
      return Object.entries(cats).map(([k, v]) => `<option value="${k}" ${k === selected ? 'selected' : ''}>${v}</option>`).join('')
    },
    _modalShell(title, sub, bodyHtml) {
      return `<div style="font-family:var(--terminal-font);color:var(--terminal-ink)">
        <div style="font-size:16px;font-weight:640;letter-spacing:-.01em">${title}</div>
        <div style="color:var(--terminal-ink-soft);font-size:12px;margin:4px 0 18px">${sub}</div>
        ${bodyHtml}</div>`
    },
    _label(text) { return `<label style="display:block;font:700 10px/1 var(--terminal-mono);letter-spacing:.1em;text-transform:uppercase;color:var(--terminal-ink-soft);margin-bottom:6px">${text}</label>` },

    novo(catPre = '', sugestao = 0) {
      const vm = this._vm
      vm.showModal(this._modalShell('Novo orçamento', `Limite para ${MES_ABREV[this._mes - 1]}/${this._ano}`, `
        <div style="display:flex;flex-direction:column;gap:14px">
          <div>${this._label('Categoria')}<select id="to-cat" style="width:100%;background:var(--terminal-bg);border:1px solid var(--terminal-line);color:var(--terminal-ink);border-radius:var(--terminal-radius-sm);padding:10px 12px;font-size:13px">${this._catOptions(catPre)}</select></div>
          <div>${this._label('Limite (R$)')}${this._fieldInput('to-limite', 'type="number" min="1" step="0.01" placeholder="Ex.: 800,00"', sugestao || '')}</div>
          <div>${this._label('Alertar ao atingir (%)')}${this._fieldInput('to-alerta', 'type="number" min="50" max="100" step="1"', 80)}</div>
          <div style="display:flex;gap:8px;margin-top:6px">
            <button class="td-button td-button--primary" style="flex:1" onclick="VMTerminalOrcamentos.salvarNovo()"><i class="fas fa-check"></i> Salvar</button>
            <button class="td-button" onclick="VM.closeModal()">Cancelar</button>
          </div>
        </div>`))
    },
    async salvarNovo() {
      const vm = this._vm
      const categoria = document.getElementById('to-cat')?.value
      const limite = parseFloat(document.getElementById('to-limite')?.value)
      const alerta = parseInt(document.getElementById('to-alerta')?.value) || 80
      if (!categoria || !(limite > 0)) return vm.toast('Informe categoria e um limite maior que zero.', 'error')
      const r = await vm.api('POST', 'orcamentos', { categoria, mes: this._mes, ano: this._ano, limite, alerta_percentual: alerta })
        .catch(e => ({ error: e.response?.data?.error }))
      if (r?.success) { vm.closeModal(); vm.toast('Orçamento salvo.', 'success'); this.reload() }
      else vm.toast(r?.error || 'Erro ao salvar.', 'error')
    },
    editar(o) {
      const vm = this._vm
      vm.showModal(this._modalShell(`Editar ${esc(o.label || o.categoria)}`, `${MES_ABREV[this._mes - 1]}/${this._ano}`, `
        <div style="display:flex;flex-direction:column;gap:14px">
          <div>${this._label('Limite (R$)')}${this._fieldInput('to-limite', 'type="number" min="1" step="0.01"', o.limite)}</div>
          <div>${this._label('Alertar ao atingir (%)')}${this._fieldInput('to-alerta', 'type="number" min="50" max="100" step="1"', o.alerta_percentual || 80)}</div>
          <div style="display:flex;gap:8px;margin-top:6px">
            <button class="td-button td-button--primary" style="flex:1" onclick="VMTerminalOrcamentos.salvarEdicao(${Number(o.id)})"><i class="fas fa-check"></i> Salvar</button>
            <button class="td-button" onclick="VM.closeModal()">Cancelar</button>
          </div>
        </div>`))
    },
    async salvarEdicao(id) {
      const vm = this._vm
      const limite = parseFloat(document.getElementById('to-limite')?.value)
      const alerta = parseInt(document.getElementById('to-alerta')?.value) || 80
      if (!(limite > 0)) return vm.toast('Informe um limite maior que zero.', 'error')
      const r = await vm.api('PUT', `orcamentos/${id}`, { limite, alerta_percentual: alerta }).catch(e => ({ error: e.response?.data?.error }))
      if (r?.success) { vm.closeModal(); vm.toast('Orçamento atualizado.', 'success'); this.reload() }
      else vm.toast(r?.error || 'Erro ao atualizar.', 'error')
    },
    async deletar(o) {
      const vm = this._vm
      const nome = String(o.label || o.categoria).replace(/<[^>]*>/g, '').trim()
      let msg = `Excluir o orçamento de <strong>${esc(nome)}</strong>?`
      if (Number(o.gasto) > 0) msg += `<br><span style="font-size:.8rem;color:var(--terminal-accent)">Já foram gastos ${money(o.gasto)} nesta categoria este mês.</span>`
      const ok = await vm.vmConfirm(msg, { titulo: 'Excluir orçamento', corBotao: '#FF6B6B', textoBotao: 'Excluir', icone: '🗑️' })
      if (!ok) return
      const r = await vm.api('DELETE', `orcamentos/${o.id}`).catch(e => ({ error: e.response?.data?.error }))
      if (r?.success) { vm.toast('Orçamento removido.', 'success'); this.reload() }
      else vm.toast(r?.error || 'Erro ao remover.', 'error')
    },
    async abrirGlobal() {
      const vm = this._vm
      const atual = this._data?.global || null
      vm.showModal(this._modalShell('Teto global do mês', `${MES_ABREV[this._mes - 1]}/${this._ano} · limite total de gastos`, `
        <div style="display:flex;flex-direction:column;gap:14px">
          <div>${this._label('Limite global (R$)')}${this._fieldInput('to-glimite', 'type="number" min="1" step="0.01" placeholder="Ex.: 5000,00"', atual?.limite || '')}</div>
          <label style="display:flex;align-items:center;gap:10px;cursor:pointer;padding:12px;border:1px solid var(--terminal-line);border-radius:var(--terminal-radius-sm);background:var(--terminal-bg)">
            <input type="checkbox" id="to-groll" ${atual?.rollover_ativo ? 'checked' : ''} style="width:16px;height:16px;accent-color:var(--terminal-primary)">
            <span style="font-size:13px;font-weight:600"><i class="fas fa-rotate" style="color:#6EA8FE"></i> Ativar rollover<br><small style="color:var(--terminal-ink-soft);font-weight:400">O saldo não gasto soma no limite do mês seguinte.</small></span>
          </label>
          <div style="display:flex;gap:8px;margin-top:6px">
            <button class="td-button td-button--primary" style="flex:1" onclick="VMTerminalOrcamentos.salvarGlobal()"><i class="fas fa-check"></i> Salvar</button>
            <button class="td-button" onclick="VM.closeModal()">Cancelar</button>
          </div>
        </div>`))
    },
    async salvarGlobal() {
      const vm = this._vm
      const limite = parseFloat(document.getElementById('to-glimite')?.value)
      const rollover = document.getElementById('to-groll')?.checked || false
      if (!(limite > 0)) return vm.toast('Informe um limite global maior que zero.', 'error')
      const r = await vm.api('POST', 'orcamentos/global', { mes: this._mes, ano: this._ano, limite_global: limite, rollover }).catch(e => ({ error: e.response?.data?.error }))
      if (r?.success) { vm.closeModal(); vm.toast('Teto global salvo.', 'success'); this.reload() }
      else vm.toast(r?.error || 'Erro ao salvar.', 'error')
    },
    async deletarGlobal() {
      const vm = this._vm
      const ok = await vm.vmConfirm(`Remover o teto global de ${MES_ABREV[this._mes - 1]}/${this._ano}?`, { titulo: 'Remover teto global', corBotao: '#FF6B6B', textoBotao: 'Remover', icone: '🌐' })
      if (!ok) return
      const r = await vm.api('DELETE', `orcamentos/global?mes=${this._mes}&ano=${this._ano}`).catch(e => ({ error: e.response?.data?.error }))
      if (r?.removido === false) vm.toast('Não havia teto global neste mês.', 'info')
      else vm.toast('Teto global removido.', 'success')
      this.reload()
    },
    async rollover() {
      const vm = this._vm
      const d = new Date(this._ano, this._mes - 2, 1)
      const mesAnt = d.getMonth() + 1, anoAnt = d.getFullYear()
      const ok = await vm.vmConfirm(
        `Trazer o saldo não gasto de <strong>${MES_ABREV[mesAnt - 1]}/${anoAnt}</strong> para ${MES_ABREV[this._mes - 1]}/${this._ano}?<br><span style="font-size:.8rem;color:var(--terminal-ink-soft)">Categorias que sobraram somam ao limite; as que estouraram descontam.</span>`,
        { titulo: 'Calcular rollover', corBotao: '#F2C94C', textoBotao: 'Calcular', icone: '🔄' })
      if (!ok) return
      const r = await vm.api('POST', 'orcamentos/calcular-rollover', { mes_origem: mesAnt, ano_origem: anoAnt }).catch(e => ({ error: e.response?.data?.error }))
      if (r?.success) { vm.toast(`Rollover calculado — ${r.rollovers?.length || 0} categoria(s).`, 'success'); this.reload() }
      else vm.toast(r?.error || 'Erro ao calcular rollover.', 'error')
    }
  }

  function statusFor(mes, ano) {
    const now = new Date()
    const sel = Number(ano) * 12 + Number(mes) - 1
    const cur = now.getFullYear() * 12 + now.getMonth()
    if (sel > cur) return { key: 'future', label: 'Período futuro' }
    if (sel < cur) return { key: 'past', label: 'Período fechado' }
    return { key: 'current', label: 'Mês atual' }
  }
})()
