(function () {
  const esc = (v) => String(v ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;')
  const money = (v) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 2 }).format(Number(v) || 0)
  const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro']
  const MESES_ABR = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
  const CATS = ['Salário', 'Freelance', 'Renda Extra', 'Investimentos', 'Aluguel', 'Dividendos', 'Vendas', 'Bônus', '13º Salário', 'Férias', 'Reembolso', 'Presente', 'Outros']
  const MEIOS = [['pix', 'PIX'], ['transferencia', 'Transferência'], ['dinheiro', 'Dinheiro'], ['cartao_debito', 'Débito'], ['cartao_credito', 'Crédito'], ['boleto', 'Boleto']]
  const MEIO_LABEL = { pix: 'PIX', transferencia: 'Transferência', dinheiro: 'Dinheiro', cartao_debito: 'Débito', cartao_credito: 'Crédito', boleto: 'Boleto', parcelado_cartao: 'Parcelado' }

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

  window.VMTerminalReceitas = {
    _active: false,

    async render(vm) {
      this._vm = vm
      this._active = true
      const content = document.getElementById('page-content')
      if (!content) return
      document.body.classList.add('terminal-dashboard-active')
      const now = new Date()
      const saved = vm._receitaFiltro || {}
      this._mes = saved.mes !== undefined ? saved.mes : String(now.getMonth() + 1)
      this._ano = saved.ano || String(now.getFullYear())
      this._cat = saved.cat || ''
      this._tipo = saved.tipo || ''
      this._busca = saved.busca || ''
      this._pagina = 1
      this._paintShell()
      this.load(1)
    },
    reload() { if (this._active) this.load(this._pagina || 1) },

    _paintShell() {
      const content = document.getElementById('page-content')
      if (!content) return
      const yearOpts = (this._vm._anosOpcoes ? this._vm._anosOpcoes(this._ano) : `<option>${this._ano}</option>`)
      content.innerHTML = `<div class="td-dashboard lg lg--receitas">
        <header class="td-dashboard__header">
          <div>
            <span class="td-eyebrow">Entradas</span>
            <h1>Receitas. <em>Cada real que entra.</em></h1>
            <p>Renda fixa, entradas avulsas e recorrências numa visão de extrato.</p>
          </div>
          <div class="td-dashboard__header-actions">
            <button class="td-button" onclick="VM._exportarReceitasCSV&&VM._exportarReceitasCSV()"><i class="fas fa-download"></i> CSV</button>
          </div>
        </header>

        <div class="lg-toolbar">
          <div class="lg-pill lg-pill--period">
            <select id="lgr-mes" onchange="VMTerminalReceitas.filtrar()">
              <option value="">Todos os meses</option>
              ${MESES.map((m, i) => `<option value="${i + 1}" ${String(i + 1) === String(this._mes) ? 'selected' : ''}>${m}</option>`).join('')}
            </select>
            <select id="lgr-ano" onchange="VMTerminalReceitas.filtrar()">${yearOpts}</select>
          </div>
          <div class="lg-pill">
            <select id="lgr-tipo" onchange="VMTerminalReceitas.filtrar()">
              <option value="">Todos os tipos</option>
              <option value="rec" ${this._tipo === 'rec' ? 'selected' : ''}>Recorrentes</option>
              <option value="avl" ${this._tipo === 'avl' ? 'selected' : ''}>Avulsas</option>
            </select>
          </div>
          <div class="lg-pill">
            <select id="lgr-cat" onchange="VMTerminalReceitas.filtrar()">
              <option value="">Todas categorias</option>
              ${CATS.map(cat => `<option value="${esc(cat)}" ${cat === this._cat ? 'selected' : ''}>${esc(cat)}</option>`).join('')}
            </select>
          </div>
          <div class="lg-pill lg-pill--search">
            <i class="fas fa-search"></i>
            <input id="lgr-busca" type="text" placeholder="Buscar descrição…" value="${esc(this._busca)}" oninput="clearTimeout(VMTerminalReceitas._t);VMTerminalReceitas._t=setTimeout(()=>VMTerminalReceitas.filtrar(),380)">
          </div>
        </div>

        <div class="lg-shell">
          <div class="lg-main">
            <div class="lg-kpis" id="lgr-kpis">${this._kpiSkeleton()}</div>
            <article class="lg-tablecard">
              <div class="lg-tablewrap">
                <table class="lg-table">
                  <thead><tr><th class="lg-th-date">Data</th><th>Descrição</th><th>Tag</th><th>Meio</th><th class="lg-th-val">Valor</th><th aria-label="Ações"></th></tr></thead>
                  <tbody id="lgr-tbody"><tr><td colspan="6"><div class="td-loading"><span></span><span></span><span></span></div></td></tr></tbody>
                </table>
              </div>
              <div class="lg-foot" id="lgr-foot"></div>
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
      return `<aside class="lg-entry">
        <div class="lg-entry__head"><span class="td-eyebrow">Nova entrada</span><h3>Registrar receita</h3></div>
        <label class="lg-field lg-field--money"><span>Valor</span>
          <div class="lg-money"><i>R$</i><input id="lgr-f-val" inputmode="decimal" placeholder="0,00" onkeydown="if(event.key==='Enter')VMTerminalReceitas.salvar()"></div>
        </label>
        <label class="lg-field"><span>Descrição</span>
          <input id="lgr-f-desc" type="text" placeholder="Ex.: Salário, Freelance…" onkeydown="if(event.key==='Enter')VMTerminalReceitas.salvar()">
        </label>
        <div class="lg-field-row">
          <label class="lg-field"><span>Categoria</span>
            <select id="lgr-f-cat">${CATS.map(cat => `<option value="${esc(cat)}">${esc(cat)}</option>`).join('')}</select>
          </label>
          <label class="lg-field"><span>Meio</span>
            <select id="lgr-f-meio">${MEIOS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select>
          </label>
        </div>
        <div class="lg-field-row">
          <label class="lg-field"><span>Data</span>
            <input id="lgr-f-data" type="date" value="${todayISO()}">
          </label>
          <label class="lg-check"><input id="lgr-f-rec" type="checkbox"><span>Recorrente</span></label>
        </div>
        <button class="lg-save" onclick="VMTerminalReceitas.salvar()"><i class="fas fa-check"></i> Salvar lançamento</button>
        <p class="lg-entry__hint"><i class="fas fa-seedling"></i> Marque como recorrente para renda fixa (salário, aluguel) e o Dashboard separa base mensal de extras.</p>
      </aside>`
    },

    filtrar() {
      this._mes = document.getElementById('lgr-mes')?.value ?? this._mes
      this._ano = document.getElementById('lgr-ano')?.value ?? this._ano
      this._tipo = document.getElementById('lgr-tipo')?.value ?? this._tipo
      this._cat = document.getElementById('lgr-cat')?.value ?? this._cat
      this._busca = document.getElementById('lgr-busca')?.value ?? this._busca
      this.load(1)
    },

    async load(pagina) {
      const vm = this._vm
      this._pagina = pagina || 1
      const limit = 20, offset = (this._pagina - 1) * limit
      this._vm._receitaFiltro = { mes: this._mes, ano: this._ano, cat: this._cat, tipo: this._tipo, busca: this._busca }
      const params = new URLSearchParams({ ano: this._ano || String(new Date().getFullYear()), limit: String(limit), offset: String(offset) })
      if (this._mes) params.set('mes', this._mes)
      if (this._cat) params.set('categoria', this._cat)
      if (this._busca) params.set('busca', this._busca)
      if (this._tipo === 'rec') params.set('recorrente', '1')
      if (this._tipo === 'avl') params.set('recorrente', '0')
      const tbody = document.getElementById('lgr-tbody')
      try {
        const data = await vm.api('GET', `receitas?${params.toString()}`)
        this._data = data
        this._renderKpis(data.metrics || {})
        this._renderRows(data.receitas || [])
        this._renderFoot(data.total_count || 0, limit)
      } catch (e) {
        if (tbody) tbody.innerHTML = `<tr><td colspan="6"><div class="td-empty-row"><span>${esc(e.response?.data?.error || 'Erro ao carregar receitas.')}</span></div></td></tr>`
      }
    },

    _renderKpis(m) {
      const el = document.getElementById('lgr-kpis')
      if (!el) return
      el.innerHTML = `
        <div class="lg-kpi lg-kpi--hero"><span class="lg-kpi__lbl">Entradas</span><strong>${money(m.total)}</strong><small>${Number(m.count) || 0} lançamento${Number(m.count) === 1 ? '' : 's'}</small></div>
        <div class="lg-kpi"><span class="lg-kpi__lbl">Recorrentes</span><strong>${money(m.total_recorrente)}</strong><small>renda fixa</small></div>
        <div class="lg-kpi"><span class="lg-kpi__lbl">Avulsas</span><strong>${money(m.total_avulso)}</strong><small>entradas pontuais</small></div>
        <div class="lg-kpi"><span class="lg-kpi__lbl">Média</span><strong>${money(m.media)}</strong><small>por lançamento</small></div>`
    },

    _renderRows(rows) {
      const tbody = document.getElementById('lgr-tbody')
      if (!tbody) return
      if (!rows.length) {
        tbody.innerHTML = `<tr><td colspan="6"><div class="lg-empty"><i class="fas fa-inbox"></i><p>Nenhuma receita neste filtro.</p><button class="lg-save lg-save--sm" onclick="document.getElementById('lgr-f-val')?.focus()">Registrar a primeira</button></div></td></tr>`
        return
      }
      tbody.innerHTML = rows.map(r => {
        const tags = []
        tags.push(`<span class="lg-tag lg-tag--rec">${esc(r.categoria || 'Outros')}</span>`)
        if (r.recorrente) tags.push('<span class="lg-tag lg-tag--soft">recorrente</span>')
        return `<tr>
          <td class="lg-td-date">${dateShort(r.data)}</td>
          <td class="lg-td-desc">${esc(r.descricao)}</td>
          <td class="lg-td-tags">${tags.join('')}</td>
          <td class="lg-td-meio">${esc(MEIO_LABEL[r.meio_pagamento] || r.meio_pagamento || '—')}</td>
          <td class="lg-td-val lg-td-val--pos">+ ${money(r.valor)}</td>
          <td class="lg-td-act"><div class="lg-act">
            <button title="Editar" onclick="VMTerminalReceitas.editar(${Number(r.id)})"><i class="fas fa-pen"></i></button>
            <button title="Excluir" onclick="VMTerminalReceitas.excluir(${Number(r.id)})"><i class="fas fa-trash"></i></button>
          </div></td>
        </tr>`
      }).join('')
    },

    _renderFoot(totalCount, limit) {
      const el = document.getElementById('lgr-foot')
      if (!el) return
      const totalPages = Math.max(1, Math.ceil(totalCount / limit))
      if (totalPages <= 1) { el.innerHTML = `<span class="lg-foot__count">${totalCount} lançamento${totalCount === 1 ? '' : 's'}</span>`; return }
      el.innerHTML = `<span class="lg-foot__count">${totalCount} lançamentos</span>
        <div class="lg-pager">
          <button ${this._pagina <= 1 ? 'disabled' : ''} onclick="VMTerminalReceitas.load(${this._pagina - 1})"><i class="fas fa-chevron-left"></i></button>
          <span>${this._pagina} / ${totalPages}</span>
          <button ${this._pagina >= totalPages ? 'disabled' : ''} onclick="VMTerminalReceitas.load(${this._pagina + 1})"><i class="fas fa-chevron-right"></i></button>
        </div>`
    },

    editar(id) {
      const r = (this._data?.receitas || []).find(x => Number(x.id) === Number(id))
      if (r && this._vm.modalReceita) this._vm.modalReceita(r)
    },
    async excluir(id) {
      const vm = this._vm
      const ok = await vm.vmConfirm('Excluir esta receita permanentemente?', { titulo: 'Excluir receita', corBotao: '#ef4444', textoBotao: 'Excluir', icone: '🗑️' })
      if (!ok) return
      try { await vm.api('DELETE', `receitas/${id}`); vm.toast('Receita excluída.', 'success'); this.load(this._pagina) }
      catch (e) { vm.toast(e.response?.data?.error || 'Erro ao excluir.', 'error') }
    },

    async salvar() {
      const vm = this._vm
      const val = parseValorBR(document.getElementById('lgr-f-val')?.value)
      const desc = (document.getElementById('lgr-f-desc')?.value || '').trim()
      const cat = document.getElementById('lgr-f-cat')?.value || 'Outros'
      const meio = document.getElementById('lgr-f-meio')?.value || 'pix'
      const data = document.getElementById('lgr-f-data')?.value || todayISO()
      const rec = !!document.getElementById('lgr-f-rec')?.checked
      if (!Number.isFinite(val) || val <= 0) { vm.toast('Informe um valor maior que zero.', 'error'); document.getElementById('lgr-f-val')?.focus(); return }
      if (!desc) { vm.toast('Informe uma descrição.', 'error'); document.getElementById('lgr-f-desc')?.focus(); return }
      const btn = document.querySelector('.lg-entry .lg-save')
      if (btn) { btn.disabled = true; btn.classList.add('is-loading') }
      try {
        await vm.api('POST', 'receitas', { descricao: desc, data, categoria: cat, valor: val, meio_pagamento: meio, recorrente: rec, frequencia: rec ? 'mensal' : null })
        vm.toast('Receita adicionada!', 'success')
        const v = document.getElementById('lgr-f-val'); if (v) v.value = ''
        const d = document.getElementById('lgr-f-desc'); if (d) d.value = ''
        const rc = document.getElementById('lgr-f-rec'); if (rc) rc.checked = false
        this.load(1)
      } catch (e) {
        vm.toast(e.response?.data?.error || 'Erro ao salvar receita.', 'error')
      } finally {
        if (btn) { btn.disabled = false; btn.classList.remove('is-loading') }
      }
    }
  }
})()
