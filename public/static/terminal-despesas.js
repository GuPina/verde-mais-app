(function () {
  const esc = (v) => String(v ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;')
  const money = (v) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 2 }).format(Number(v) || 0)
  const safeColor = (c, fb) => (typeof c === 'string' && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(c.trim())) ? c.trim() : fb
  const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro']
  const MESES_ABR = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
  const CATS = ['Alimentação', 'Moradia', 'Transporte', 'Saúde', 'Educação', 'Lazer', 'Vestuário', 'Assinaturas', 'Utilidades', 'Pets', 'Beleza', 'Tecnologia', 'Viagem', 'Academia', 'Serviços', 'Presentes', 'Outros']
  const MEIOS = [['dinheiro', 'Dinheiro'], ['pix', 'PIX'], ['cartao_debito', 'Débito'], ['cartao_credito', 'Crédito'], ['boleto', 'Boleto'], ['transferencia', 'Transferência']]
  const MEIO_LABEL = { dinheiro: 'Dinheiro', pix: 'PIX', cartao_debito: 'Débito', cartao_credito: 'Crédito', boleto: 'Boleto', transferencia: 'Transferência', parcelado_cartao: 'Parcelado' }

  const dateShort = (iso) => {
    if (!iso) return '—'
    const d = new Date(String(iso).slice(0, 10) + 'T12:00:00')
    if (isNaN(d.getTime())) return '—'
    return `${String(d.getDate()).padStart(2, '0')} ${MESES_ABR[d.getMonth()]}`
  }
  const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
  const parseValorBR = (s) => {
    let t = String(s == null ? '' : s).replace(/[^\d.,]/g, '')
    if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.')
    const n = parseFloat(t)
    return Number.isFinite(n) ? n : NaN
  }

  window.VMTerminalDespesas = {
    _active: false,
    _novoTipo: 'despesa',
    _novoStatus: 'pendente',

    async render(vm) {
      this._vm = vm
      this._active = true
      const content = document.getElementById('page-content')
      if (!content) return
      document.body.classList.add('terminal-dashboard-active')
      const now = new Date()
      const saved = vm._despesaFiltro || {}
      this._mes = saved.mes !== undefined ? saved.mes : String(now.getMonth() + 1)
      this._ano = saved.ano || String(now.getFullYear())
      this._cat = saved.cat || ''
      this._status = saved.status || ''
      this._meio = saved.meio || ''
      this._busca = saved.busca || ''
      this._pagina = 1
      this._novoTipo = 'despesa'
      this._novoStatus = 'pendente'
      this._paintShell()
      this.load(1)
    },
    reload() { if (this._active) this.load(this._pagina || 1) },

    _paintShell() {
      const content = document.getElementById('page-content')
      if (!content) return
      const yearOpts = (this._vm._anosOpcoes ? this._vm._anosOpcoes(this._ano) : `<option>${this._ano}</option>`)
      content.innerHTML = `<div class="td-dashboard lg lg--despesas">
        <header class="td-dashboard__header">
          <div>
            <span class="td-eyebrow">Saídas</span>
            <h1>Despesas. <em>Para onde o dinheiro vai.</em></h1>
            <p>Gastos, contas e aportes num extrato claro — filtre, registre e acompanhe.</p>
          </div>
          <div class="td-dashboard__header-actions">
            <button class="td-button" onclick="VM._exportarDespesasCSV&&VM._exportarDespesasCSV()"><i class="fas fa-download"></i> CSV</button>
          </div>
        </header>

        <div class="lg-toolbar">
          <div class="lg-pill lg-pill--period">
            <select id="lgd-mes" onchange="VMTerminalDespesas.filtrar()">
              <option value="">Todos os meses</option>
              ${MESES.map((m, i) => `<option value="${i + 1}" ${String(i + 1) === String(this._mes) ? 'selected' : ''}>${m}</option>`).join('')}
            </select>
            <select id="lgd-ano" onchange="VMTerminalDespesas.filtrar()">${yearOpts}</select>
          </div>
          <div class="lg-pill">
            <select id="lgd-status" onchange="VMTerminalDespesas.filtrar()">
              <option value="">Todos os status</option>
              <option value="pago" ${this._status === 'pago' ? 'selected' : ''}>Pagas</option>
              <option value="pendente" ${this._status === 'pendente' ? 'selected' : ''}>Pendentes</option>
            </select>
          </div>
          <div class="lg-pill">
            <select id="lgd-cat" onchange="VMTerminalDespesas.filtrar()">
              <option value="">Todas categorias</option>
              ${CATS.map(cat => `<option value="${esc(cat)}" ${cat === this._cat ? 'selected' : ''}>${esc(cat)}</option>`).join('')}
            </select>
          </div>
          <div class="lg-pill">
            <select id="lgd-meio" onchange="VMTerminalDespesas.filtrar()">
              <option value="">Todos os meios</option>
              ${MEIOS.map(([v, l]) => `<option value="${v}" ${v === this._meio ? 'selected' : ''}>${l}</option>`).join('')}
            </select>
          </div>
          <div class="lg-pill lg-pill--search">
            <i class="fas fa-search"></i>
            <input id="lgd-busca" type="text" placeholder="Buscar descrição…" value="${esc(this._busca)}" oninput="clearTimeout(VMTerminalDespesas._t);VMTerminalDespesas._t=setTimeout(()=>VMTerminalDespesas.filtrar(),380)">
          </div>
        </div>

        <div class="lg-shell">
          <div class="lg-main">
            <div class="lg-kpis" id="lgd-kpis">${this._kpiSkeleton()}</div>
            <article class="lg-tablecard">
              <div class="lg-tablewrap">
                <table class="lg-table">
                  <thead><tr><th class="lg-th-date">Data</th><th>Descrição</th><th>Tag</th><th>Meio</th><th class="lg-th-val">Valor</th><th aria-label="Ações"></th></tr></thead>
                  <tbody id="lgd-tbody"><tr><td colspan="6"><div class="td-loading"><span></span><span></span><span></span></div></td></tr></tbody>
                </table>
              </div>
              <div class="lg-foot" id="lgd-foot"></div>
            </article>
          </div>
          ${this._entryPanel()}
        </div>
      </div>`
    },

    _kpiSkeleton() {
      return Array.from({ length: 4 }).map(() => '<div class="lg-kpi"><span class="lg-kpi__lbl">—</span><strong>—</strong></div>').join('')
    },

    _entryPanel() {
      return `<aside class="lg-entry lg-entry--desp">
        <div class="lg-entry__head"><span class="td-eyebrow">Novo lançamento</span><h3>Registrar saída</h3></div>
        <div class="lg-seg" id="lgd-tipo-seg">
          <button class="is-on" data-tipo="despesa" onclick="VMTerminalDespesas.setTipo('despesa')">Despesa</button>
          <button data-tipo="aporte" onclick="VMTerminalDespesas.setTipo('aporte')">Aporte</button>
        </div>
        <label class="lg-field lg-field--money"><span>Valor</span>
          <div class="lg-money lg-money--neg"><i>R$</i><input id="lgd-f-val" inputmode="decimal" placeholder="0,00" onkeydown="if(event.key==='Enter')VMTerminalDespesas.salvar()"></div>
        </label>
        <label class="lg-field"><span>Descrição</span>
          <input id="lgd-f-desc" type="text" placeholder="Ex.: Supermercado, Aluguel…" onkeydown="if(event.key==='Enter')VMTerminalDespesas.salvar()">
        </label>
        <div class="lg-field-row">
          <label class="lg-field"><span>Categoria</span>
            <select id="lgd-f-cat">${CATS.map(cat => `<option value="${esc(cat)}">${esc(cat)}</option>`).join('')}</select>
          </label>
          <label class="lg-field"><span>Meio</span>
            <select id="lgd-f-meio">${MEIOS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select>
          </label>
        </div>
        <div class="lg-field-row">
          <label class="lg-field"><span>Data</span>
            <input id="lgd-f-data" type="date" value="${todayISO()}">
          </label>
          <div class="lg-field" id="lgd-status-wrap"><span>Situação</span>
            <div class="lg-seg lg-seg--sm" id="lgd-status-seg">
              <button class="is-on" data-st="pendente" onclick="VMTerminalDespesas.setStatus('pendente')">Pendente</button>
              <button data-st="pago" onclick="VMTerminalDespesas.setStatus('pago')">Pago</button>
            </div>
          </div>
        </div>
        <button class="lg-save lg-save--neg" onclick="VMTerminalDespesas.salvar()"><i class="fas fa-check"></i> Salvar lançamento</button>
        <p class="lg-entry__hint" id="lgd-hint"><i class="fas fa-circle-info"></i> Marque como <b>Pago</b> se o dinheiro já saiu; <b>Pendente</b> entra na agenda de vencimentos.</p>
      </aside>`
    },

    setTipo(t) {
      this._novoTipo = t
      document.querySelectorAll('#lgd-tipo-seg button').forEach(b => b.classList.toggle('is-on', b.dataset.tipo === t))
      const stWrap = document.getElementById('lgd-status-wrap')
      const hint = document.getElementById('lgd-hint')
      if (t === 'aporte') {
        if (stWrap) stWrap.style.visibility = 'hidden'
        if (hint) hint.innerHTML = '<i class="fas fa-seedling"></i> Aporte é transferência para patrimônio — fica <b>fora</b> da soma de gastos e aparece na tela de Aportes.'
      } else {
        if (stWrap) stWrap.style.visibility = 'visible'
        if (hint) hint.innerHTML = '<i class="fas fa-circle-info"></i> Marque como <b>Pago</b> se o dinheiro já saiu; <b>Pendente</b> entra na agenda de vencimentos.'
      }
    },
    setStatus(s) {
      this._novoStatus = s
      document.querySelectorAll('#lgd-status-seg button').forEach(b => b.classList.toggle('is-on', b.dataset.st === s))
    },

    filtrar() {
      this._mes = document.getElementById('lgd-mes')?.value ?? this._mes
      this._ano = document.getElementById('lgd-ano')?.value ?? this._ano
      this._status = document.getElementById('lgd-status')?.value ?? this._status
      this._cat = document.getElementById('lgd-cat')?.value ?? this._cat
      this._meio = document.getElementById('lgd-meio')?.value ?? this._meio
      this._busca = document.getElementById('lgd-busca')?.value ?? this._busca
      this.load(1)
    },

    async load(pagina) {
      const vm = this._vm
      this._pagina = pagina || 1
      const limit = 20, offset = (this._pagina - 1) * limit
      vm._despesaFiltro = { mes: this._mes, ano: this._ano, cat: this._cat, status: this._status, meio: this._meio, busca: this._busca }
      const params = new URLSearchParams({ ano: this._ano || String(new Date().getFullYear()), limit: String(limit), offset: String(offset) })
      if (this._mes) params.set('mes', this._mes)
      if (this._cat) params.set('categoria', this._cat)
      if (this._status) params.set('status', this._status)
      if (this._meio) params.set('meio_pagamento', this._meio)
      if (this._busca) params.set('busca', this._busca)
      const tbody = document.getElementById('lgd-tbody')
      try {
        const data = await vm.api('GET', `despesas?${params.toString()}`)
        this._data = data
        this._renderKpis(data)
        this._renderRows(data.despesas || [])
        this._renderFoot(data.total_count || 0, limit)
      } catch (e) {
        if (tbody) tbody.innerHTML = `<tr><td colspan="6"><div class="td-empty-row"><span>${esc(e.response?.data?.error || 'Erro ao carregar despesas.')}</span></div></td></tr>`
      }
    },

    _renderKpis(d) {
      const el = document.getElementById('lgd-kpis')
      if (!el) return
      el.innerHTML = `
        <div class="lg-kpi lg-kpi--hero lg-kpi--neg"><span class="lg-kpi__lbl">Saídas</span><strong>${money(d.total)}</strong><small>${Number(d.total_count) || 0} lançamento${Number(d.total_count) === 1 ? '' : 's'}</small></div>
        <div class="lg-kpi"><span class="lg-kpi__lbl">Pagas</span><strong>${money(d.total_pago)}</strong><small>${Number(d.count_pago) || 0} já quitada${Number(d.count_pago) === 1 ? '' : 's'}</small></div>
        <div class="lg-kpi"><span class="lg-kpi__lbl">Pendentes</span><strong class="is-warn">${money(d.total_pendente)}</strong><small>${Number(d.count_pendente) || 0} a vencer</small></div>
        <div class="lg-kpi"><span class="lg-kpi__lbl">Lançamentos</span><strong>${Number(d.total_count) || 0}</strong><small>no período</small></div>`
    },

    _renderRows(rows) {
      const tbody = document.getElementById('lgd-tbody')
      if (!tbody) return
      if (!rows.length) {
        tbody.innerHTML = `<tr><td colspan="6"><div class="lg-empty"><i class="fas fa-inbox"></i><p>Nenhuma despesa neste filtro.</p><button class="lg-save lg-save--sm lg-save--neg" onclick="document.getElementById('lgd-f-val')?.focus()">Registrar a primeira</button></div></td></tr>`
        return
      }
      tbody.innerHTML = rows.map(d => {
        const tags = []
        const arr = Array.isArray(d.tags) ? d.tags.filter(t => t && t.nome) : []
        if (arr.length) {
          for (const t of arr.slice(0, 2)) {
            const cor = safeColor(t.cor, '')
            tags.push(`<span class="lg-tag"${cor ? ` style="color:${cor};border-color:${cor}55;background:${cor}1a"` : ''}>${esc(t.nome)}</span>`)
          }
        } else {
          tags.push(`<span class="lg-tag lg-tag--neg">${esc(d.categoria || 'Outros')}</span>`)
        }
        if (d.status === 'pendente') tags.push('<span class="lg-tag lg-tag--warn">pendente</span>')
        return `<tr>
          <td class="lg-td-date">${dateShort((d.status === 'pago' ? (d.data_pagamento || d.data) : (d.vencimento || d.data)))}</td>
          <td class="lg-td-desc">${esc(d.descricao)}</td>
          <td class="lg-td-tags">${tags.join('')}</td>
          <td class="lg-td-meio">${esc(MEIO_LABEL[d.meio_pagamento] || d.meio_pagamento || '—')}</td>
          <td class="lg-td-val lg-td-val--neg">− ${money(d.valor)}</td>
          <td class="lg-td-act"><div class="lg-act">
            <button title="Editar" onclick="VMTerminalDespesas.editar(${Number(d.id)})"><i class="fas fa-pen"></i></button>
            <button title="Excluir" onclick="VMTerminalDespesas.excluir(${Number(d.id)})"><i class="fas fa-trash"></i></button>
          </div></td>
        </tr>`
      }).join('')
    },

    _renderFoot(totalCount, limit) {
      const el = document.getElementById('lgd-foot')
      if (!el) return
      const totalPages = Math.max(1, Math.ceil(totalCount / limit))
      if (totalPages <= 1) { el.innerHTML = `<span class="lg-foot__count">${totalCount} lançamento${totalCount === 1 ? '' : 's'}</span>`; return }
      el.innerHTML = `<span class="lg-foot__count">${totalCount} lançamentos</span>
        <div class="lg-pager">
          <button ${this._pagina <= 1 ? 'disabled' : ''} onclick="VMTerminalDespesas.load(${this._pagina - 1})"><i class="fas fa-chevron-left"></i></button>
          <span>${this._pagina} / ${totalPages}</span>
          <button ${this._pagina >= totalPages ? 'disabled' : ''} onclick="VMTerminalDespesas.load(${this._pagina + 1})"><i class="fas fa-chevron-right"></i></button>
        </div>`
    },

    editar(id) {
      const d = (this._data?.despesas || []).find(x => Number(x.id) === Number(id))
      if (d && this._vm.modalDespesa) this._vm.modalDespesa(d)
    },
    async excluir(id) {
      const vm = this._vm
      const ok = await vm.vmConfirm('Excluir esta despesa permanentemente?', { titulo: 'Excluir despesa', corBotao: '#ef4444', textoBotao: 'Excluir', icone: '🗑️' })
      if (!ok) return
      try { await vm.api('DELETE', `despesas/${id}`); vm.toast('Despesa excluída.', 'success'); this.load(this._pagina) }
      catch (e) { vm.toast(e.response?.data?.error || 'Erro ao excluir.', 'error') }
    },

    async salvar() {
      const vm = this._vm
      const val = parseValorBR(document.getElementById('lgd-f-val')?.value)
      const desc = (document.getElementById('lgd-f-desc')?.value || '').trim()
      const cat = document.getElementById('lgd-f-cat')?.value || 'Outros'
      const meio = document.getElementById('lgd-f-meio')?.value || 'dinheiro'
      const data = document.getElementById('lgd-f-data')?.value || todayISO()
      const aporte = this._novoTipo === 'aporte'
      if (!Number.isFinite(val) || val <= 0) { vm.toast('Informe um valor maior que zero.', 'error'); document.getElementById('lgd-f-val')?.focus(); return }
      if (!desc) { vm.toast('Informe uma descrição.', 'error'); document.getElementById('lgd-f-desc')?.focus(); return }
      const payload = {
        descricao: desc, data, categoria: aporte ? (cat || 'Investimentos') : cat, valor: val,
        meio_pagamento: meio, status: aporte ? 'pago' : this._novoStatus,
        fixa_ou_variavel: 'variavel', eh_aporte_patrimonial: aporte
      }
      const btn = document.querySelector('.lg-entry .lg-save')
      if (btn) { btn.disabled = true; btn.classList.add('is-loading') }
      try {
        await vm.api('POST', 'despesas', payload)
        vm.toast(aporte ? 'Aporte registrado (veja na tela de Aportes).' : 'Despesa adicionada!', 'success')
        const v = document.getElementById('lgd-f-val'); if (v) v.value = ''
        const de = document.getElementById('lgd-f-desc'); if (de) de.value = ''
        this.load(1)
      } catch (e) {
        vm.toast(e.response?.data?.error || 'Erro ao salvar despesa.', 'error')
      } finally {
        if (btn) { btn.disabled = false; btn.classList.remove('is-loading') }
      }
    }
  }
})()
