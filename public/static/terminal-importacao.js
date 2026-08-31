(function () {
  const esc = (v) => String(v ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;')
  const money = (v) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 2 }).format(Number(v) || 0)

  window.VMTerminalImportacao = {
    async render(vm) {
      this._vm = vm
      const content = document.getElementById('page-content')
      if (!content) return
      document.body.classList.add('terminal-dashboard-active')
      this._tipo = this._tipo || 'despesas'
      content.innerHTML = this._shell(this._formHtml() + '<div id="im-out"></div>')
    },
    reload() { this._preview = null; this._csv = ''; this.render(this._vm) },

    _st() { return 'width:100%;background:var(--terminal-bg);border:1px solid var(--terminal-line);color:var(--terminal-ink);border-radius:var(--terminal-radius-sm);padding:10px 12px;font-size:13px;font-family:var(--terminal-mono)' },
    _lab(t) { return `<label style="display:block;font:700 10px/1 var(--terminal-mono);letter-spacing:.1em;text-transform:uppercase;color:var(--terminal-ink-soft);margin-bottom:6px">${t}</label>` },

    _formHtml() {
      const s = this._st()
      return `<article class="td-panel im-form">
        <div class="td-panel__head"><div><span class="td-eyebrow">Passo 1</span><h2>Cole ou envie seu extrato</h2></div></div>
        <div class="im-tipo">
          <label class="am-mode"><input type="radio" name="im-tipo" value="despesas" ${this._tipo === 'despesas' ? 'checked' : ''} onchange="VMTerminalImportacao._setTipo('despesas')"> Despesas</label>
          <label class="am-mode"><input type="radio" name="im-tipo" value="receitas" ${this._tipo === 'receitas' ? 'checked' : ''} onchange="VMTerminalImportacao._setTipo('receitas')"> Receitas</label>
          <label class="td-button td-button--sm" style="cursor:pointer;margin-left:auto"><i class="fas fa-file-arrow-up"></i> Enviar .csv<input type="file" accept=".csv,text/csv" style="display:none" onchange="VMTerminalImportacao._file(event)"></label>
        </div>
        <div style="margin-top:12px">${this._lab('CSV (Data;Descrição;Valor;Categoria)')}<textarea id="im-csv" rows="7" style="${s};resize:vertical" placeholder="Data;Descricao;Valor;Categoria&#10;2026-08-01;Mercado;-180,50;Alimentacao&#10;2026-08-03;Salario;5000,00;Renda">${esc(this._csv || '')}</textarea></div>
        <div style="margin-top:12px"><button class="td-button td-button--primary" onclick="VMTerminalImportacao.analisar()"><i class="fas fa-magnifying-glass-chart"></i> Analisar</button></div>
      </article>`
    },
    _setTipo(t) { this._tipo = t },
    _file(ev) {
      const f = ev.target.files && ev.target.files[0]; if (!f) return
      const rd = new FileReader()
      rd.onload = () => { const ta = document.getElementById('im-csv'); if (ta) ta.value = String(rd.result || '') }
      rd.readAsText(f)
    },

    async analisar() {
      const vm = this._vm
      const csv = (document.getElementById('im-csv')?.value || '').trim()
      if (!csv) return vm.toast('Cole o conteúdo do CSV.', 'error')
      this._csv = csv
      const out = document.getElementById('im-out')
      if (out) out.innerHTML = '<div class="td-loading"><span></span><span></span><span></span></div>'
      try {
        const d = await vm.api('POST', 'importacao/preview', { csv, tipo: this._tipo })
        this._preview = d
        this._renderPreview(d)
      } catch (e) {
        if (out) out.innerHTML = `<div class="td-notice" style="margin-top:16px"><i class="fas fa-triangle-exclamation"></i><div><span>${esc(e.response?.data?.error || 'Não foi possível ler o CSV.')}</span></div></div>`
      }
    },

    _renderPreview(d) {
      const out = document.getElementById('im-out')
      if (!out) return
      const rows = d.preview || []
      const st = d.stats || {}
      const col = d.colunas_detectadas || {}
      const linhas = rows.slice(0, 40).map(p => {
        const dup = p.duplicata?.nivel
        const flag = dup === 'provavel' ? '<span class="im-flag im-flag--neg">duplicata?</span>' : dup === 'possivel' ? '<span class="im-flag im-flag--warn">possível dup</span>' : p.parcela ? '<span class="im-flag">parcela</span>' : ''
        return `<tr><td>${esc(p.data || '')}</td><td>${esc(p.descricao || '')}</td><td style="text-align:right">${money(p.valor)}</td><td>${esc(p.categoria || '')}</td><td>${flag}</td></tr>`
      }).join('')
      out.innerHTML = `
        <article class="td-panel" style="margin-top:16px">
          <div class="td-panel__head"><div><span class="td-eyebrow">Passo 2</span><h2>Confira antes de importar</h2></div>
            <button class="td-button td-button--primary" onclick="VMTerminalImportacao.importar()"><i class="fas fa-check"></i> Importar ${st.total || rows.length} lançamento(s)</button>
          </div>
          <div class="dg-kpis" style="margin-bottom:14px">
            ${this._kpi('Linhas', String(st.total || rows.length))}
            ${this._kpi('Duplicatas prováveis', String(st.duplicatas_provaveis || 0), (st.duplicatas_provaveis || 0) ? 'neg' : 'ok')}
            ${this._kpi('Parcelas detectadas', String(st.parcelas_detectadas || 0))}
            ${this._kpi('Colunas', `${col.data || '?'} · ${col.valor || '?'}`)}
          </div>
          <div style="overflow-x:auto"><table class="im-table"><thead><tr><th>Data</th><th>Descrição</th><th style="text-align:right">Valor</th><th>Categoria</th><th></th></tr></thead><tbody>${linhas || '<tr><td colspan="5">Sem linhas.</td></tr>'}</tbody></table></div>
          ${rows.length > 40 ? `<p style="color:var(--terminal-ink-soft);font-size:12px;margin-top:10px">Mostrando 40 de ${rows.length} linhas — todas serão importadas.</p>` : ''}
        </article>`
    },
    _kpi(lbl, val, tone) { return `<div class="dg-kpi"><span class="dg-kpi__lbl">${esc(lbl)}</span><span class="dg-kpi__val dg-kpi__val--${tone || 'neutral'}" style="font-size:14px">${esc(val)}</span></div>` },

    async importar() {
      const vm = this._vm, d = this._preview
      if (!d) return
      const cab = d.cabecalho_original || []
      const col = d.colunas_detectadas || {}
      const idx = (nome) => nome ? cab.indexOf(nome) : -1
      const mapeamento = { data: idx(col.data), descricao: idx(col.descricao), valor: idx(col.valor), categoria: idx(col.categoria) }
      if (mapeamento.valor < 0) return vm.toast('Não identifiquei a coluna de valor.', 'error')
      if (!window.confirm(`Importar ${d.stats?.total || (d.preview || []).length} lançamento(s) como ${this._tipo}?`)) return
      const out = document.getElementById('im-out')
      const r = await vm.api('POST', 'importacao/executar', { csv: this._csv, tipo: this._tipo, mapeamento }).catch(e => ({ error: e.response?.data?.error }))
      if (r && (r.success || r.importadas || r.total_importadas || !r.error)) {
        const n = r.importadas ?? r.total_importadas ?? r.total ?? ''
        if (out) out.innerHTML = `<div class="td-notice" style="margin-top:16px;border-color:color-mix(in srgb,var(--terminal-primary) 30%,var(--terminal-line))"><i class="fas fa-circle-check" style="color:var(--terminal-primary)"></i><div><strong>Importação concluída${n !== '' ? ' — ' + n + ' lançamento(s)' : ''}.</strong><span>Seus lançamentos já estão no VerdeMais.</span></div></div>`
        vm.toast('Importado com sucesso.', 'success')
      } else vm.toast(r?.error || 'Erro ao importar.', 'error')
    },

    _shell(inner) {
      return `<div class="td-dashboard im">
        <header class="td-dashboard__header">
          <div>
            <span class="td-eyebrow">Do banco para o VerdeMais</span>
            <h1>Importar CSV. <em>Seu extrato em segundos.</em></h1>
            <p>Cole o extrato do banco ou do cartão — o VerdeMais reconhece colunas, detecta duplicatas e parcelas antes de importar.</p>
          </div>
        </header>
        ${inner}
      </div>`
    }
  }
})()
