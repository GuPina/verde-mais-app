(function () {
  const MES_ABREV = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']
  const esc = (v) => String(v ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;')
  const money = (v) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 2 }).format(Number(v) || 0)

  const CATS = {
    despesa: ['alimentacao', 'moradia', 'transporte', 'saude', 'educacao', 'lazer', 'vestuario', 'assinaturas', 'tecnologia', 'pets', 'beleza', 'fixo', 'supermercado', 'outros'],
    receita: ['salario', 'freelance', 'investimentos', 'aluguel', 'vendas', 'outros']
  }
  const CAT_LABEL = { alimentacao: 'Alimentação', moradia: 'Moradia', transporte: 'Transporte', saude: 'Saúde', educacao: 'Educação', lazer: 'Lazer', vestuario: 'Vestuário', assinaturas: 'Assinaturas', tecnologia: 'Tecnologia', pets: 'Pets', beleza: 'Beleza', fixo: 'Gastos Fixos', supermercado: 'Supermercado', outros: 'Outros', salario: 'Salário', freelance: 'Freelance', investimentos: 'Investimentos', aluguel: 'Aluguel', vendas: 'Vendas' }
  const MEIOS = ['pix', 'boleto', 'debito', 'credito', 'dinheiro', 'transferencia', 'outros']

  window.VMTerminalRecorrencias = {
    async render(vm) {
      this._vm = vm
      const content = document.getElementById('page-content')
      if (!content) return
      document.body.classList.add('terminal-dashboard-active')

      if ((vm.user?.plano || 'free') === 'free' && vm.upsellBlock) {
        content.innerHTML = vm.upsellBlock('recorrencias', '🔄 Recorrências automáticas',
          'Cadastre uma vez e o VerdeMais lança sozinho todo mês — contas fixas e receitas.',
          ['Geração automática do mês', 'Fluxo de caixa futuro (6 meses)', 'Valor fixo ou variável', 'Data de término', 'Zero digitação recorrente'])
        return
      }

      content.innerHTML = '<div class="td-loading"><span></span><span></span><span></span></div>'
      try {
        const data = await vm.api('GET', 'recorrencias')
        this._cache = data.recorrencias || []
        this._resumo = data.resumo || {}
        this._paint()
      } catch (e) {
        content.innerHTML = `<div class="td-error"><i class="fas fa-triangle-exclamation"></i><h2>Não foi possível carregar as Recorrências</h2><p>${esc(e.response?.data?.error || 'Tente novamente.')}</p><button class="td-button td-button--primary" onclick="VM.pageRecorrencias()">Tentar novamente</button></div>`
      }
    },
    reload() { this.render(this._vm) },

    _paint() {
      const content = document.getElementById('page-content')
      if (!content) return
      const recs = this._cache || []
      const ativas = recs.filter(r => r.ativa)
      const despesas = recs.filter(r => r.tipo === 'despesa')
      const receitas = recs.filter(r => r.tipo === 'receita')

      const saidas = ativas.filter(r => r.tipo === 'despesa' && !r.valor_variavel).reduce((s, r) => s + Number(r.valor || 0), 0)
      const entradas = ativas.filter(r => r.tipo === 'receita' && !r.valor_variavel).reduce((s, r) => s + Number(r.valor || 0), 0)
      const variaveis = ativas.filter(r => r.valor_variavel).length

      content.innerHTML = `<div class="td-dashboard tr">
        <header class="td-dashboard__header">
          <div>
            <span class="td-eyebrow">No automático</span>
            <h1>Recorrências. <em>Zero digitação.</em></h1>
            <p>Contas fixas e receitas que se repetem — geradas para você a cada mês.</p>
          </div>
          <div class="td-dashboard__header-actions">
            <button class="td-button" onclick="VMTerminalRecorrencias.processar()"><i class="fas fa-wand-magic-sparkles"></i> Processar mês</button>
            <button class="td-button td-button--primary" onclick="VMTerminalRecorrencias.novo()"><i class="fas fa-plus"></i> Nova recorrência</button>
          </div>
        </header>

        <section class="tm-kpis">
          <article class="td-kpi"><span>Saídas fixas / mês</span><strong>${money(saidas)}</strong><span class="td-kpi__delta td-kpi__delta--muted">${despesas.length} despesa(s) recorrente(s)</span></article>
          <article class="td-kpi"><span>Entradas fixas / mês</span><strong>${money(entradas)}</strong><span class="td-kpi__delta td-kpi__delta--muted">${receitas.length} receita(s) recorrente(s)</span></article>
          <article class="td-kpi"><span>Saldo projetado / mês</span><strong>${money(entradas - saidas)}</strong><span class="td-kpi__delta ${entradas - saidas >= 0 ? 'td-kpi__delta--positive' : 'td-kpi__delta--negative'}">${variaveis ? `${variaveis} variável(is) fora da conta` : 'só valores fixos'}</span></article>
        </section>

        ${this._projecao(ativas)}

        ${recs.length === 0 ? this._empty() : `
          ${this._group('Despesas fixas', 'arrow-up', despesas)}
          ${this._group('Receitas fixas', 'arrow-down', receitas)}
        `}
      </div>`
    },

    _projecao(ativas) {
      // RC10/RC11: um número por mês de verdade (respeitando início/fim), não o
      // mesmo valor 6x. RC12: disponível para Premium também (era só 'pro').
      const now = new Date()
      const cols = []
      for (let i = 0; i < 6; i++) {
        const d = new Date(now.getFullYear(), now.getMonth() + i, 1)
        const ref = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
        const fim = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-28`
        let saldo = 0
        for (const r of ativas) {
          if (r.valor_variavel) continue
          if (r.data_inicio && r.data_inicio > fim) continue
          if (r.data_fim && r.data_fim < ref) continue
          saldo += (r.tipo === 'receita' ? 1 : -1) * Number(r.valor || 0)
        }
        cols.push({ label: `${MES_ABREV[d.getMonth()]}/${String(d.getFullYear()).slice(2)}`, saldo })
      }
      const max = Math.max(1, ...cols.map(c => Math.abs(c.saldo)))
      return `<article class="td-panel tr-flow">
        <div class="td-panel__head"><div><span class="td-eyebrow">Próximos 6 meses</span><h2>Fluxo de caixa futuro</h2></div></div>
        <div class="tr-flow__grid">${cols.map(c => `
          <div class="tr-flow__col">
            <div class="tr-flow__bar"><span class="${c.saldo >= 0 ? 'is-pos' : 'is-neg'}" style="height:${Math.round(Math.abs(c.saldo) / max * 100)}%"></span></div>
            <strong class="${c.saldo >= 0 ? 'is-pos' : 'is-neg'}">${c.saldo >= 0 ? '+' : '−'}${money(Math.abs(c.saldo)).replace('R$', '').trim()}</strong>
            <small>${c.label}</small>
          </div>`).join('')}</div>
      </article>`
    },

    _group(title, icon, list) {
      if (!list.length) return ''
      return `<div class="tm-group"><div class="tm-group__head"><span class="td-eyebrow"><i class="fas fa-${icon}"></i> ${esc(title)} · ${list.length}</span></div>
        <div class="tr-grid">${list.map(r => this._card(r)).join('')}</div></div>`
    },

    _card(r) {
      const j = esc(JSON.stringify({ id: r.id, tipo: r.tipo, descricao: r.descricao, valor: Number(r.valor), categoria: r.categoria, dia_vencimento: r.dia_vencimento, meio_pagamento: r.meio_pagamento, valor_variavel: !!r.valor_variavel, data_fim: r.data_fim }))
      const inativa = !r.ativa
      return `<article class="tr-card ${inativa ? 'tr-card--off' : ''}">
        <div class="tr-card__top">
          <div class="tr-card__id">
            <strong>${esc(r.descricao)}</strong>
            <small>${esc(CAT_LABEL[r.categoria] || r.categoria || '—')} · vence dia ${Number(r.dia_vencimento) || '—'}</small>
          </div>
          ${r.gerada_mes_atual ? '<span class="tr-badge tr-badge--done"><i class="fas fa-check"></i> gerada</span>' : (inativa ? '<span class="tr-badge">pausada</span>' : '')}
        </div>
        <div class="tr-card__val ${r.tipo === 'receita' ? 'is-pos' : ''}">${r.valor_variavel ? '<em>valor variável</em>' : money(r.valor)}</div>
        <div class="tr-card__actions">
          ${!inativa ? `<button class="td-button td-button--primary" onclick='VMTerminalRecorrencias.lancar(${j})'><i class="fas fa-bolt"></i> Lançar mês</button>` : ''}
          <button class="td-button" title="${inativa ? 'Ativar' : 'Pausar'}" onclick="VMTerminalRecorrencias.toggle(${Number(r.id)}, ${r.ativa ? 1 : 0})"><i class="fas fa-${inativa ? 'play' : 'pause'}"></i></button>
          <button class="td-button" title="Editar" onclick='VMTerminalRecorrencias.editar(${j})'><i class="fas fa-pen"></i></button>
          <button class="td-button" title="Excluir" onclick="VMTerminalRecorrencias.deletar(${Number(r.id)}, '${esc(r.descricao)}')"><i class="fas fa-trash"></i></button>
        </div>
      </article>`
    },

    _empty() {
      return `<section class="td-onboarding tm-empty"><div class="td-onboarding__copy">
        <span class="td-eyebrow">Pare de digitar todo mês</span>
        <h2>Cadastre uma conta fixa e esqueça.</h2>
        <p>Aluguel, salário, assinatura — o VerdeMais gera o lançamento sozinho a cada mês.</p>
        <div class="td-onboarding__actions"><button class="td-button td-button--primary" onclick="VMTerminalRecorrencias.novo()"><i class="fas fa-plus"></i> Criar primeira recorrência</button></div>
      </div></section>`
    },

    // ── Modais / ações (terminal) ──────────────────────────────────────────
    _label(t) { return `<label style="display:block;font:700 10px/1 var(--terminal-mono);letter-spacing:.1em;text-transform:uppercase;color:var(--terminal-ink-soft);margin-bottom:6px">${t}</label>` },
    _inputStyle() { return 'width:100%;background:var(--terminal-bg);border:1px solid var(--terminal-line);color:var(--terminal-ink);border-radius:var(--terminal-radius-sm);padding:10px 12px;font-size:13px;font-family:var(--terminal-font)' },
    _catOptions(tipo, selected) {
      return CATS[tipo].map(c => `<option value="${c}" ${c === selected ? 'selected' : ''}>${CAT_LABEL[c] || c}</option>`).join('')
    },
    _form(rec) {
      const tipo = rec?.tipo || 'despesa'
      const s = this._inputStyle()
      return `<div style="font-family:var(--terminal-font);color:var(--terminal-ink)">
        <div style="font-size:16px;font-weight:640">${rec ? 'Editar recorrência' : 'Nova recorrência'}</div>
        <div style="color:var(--terminal-ink-soft);font-size:12px;margin:4px 0 18px">Uma transação que se repete todo mês</div>
        <div style="display:flex;flex-direction:column;gap:14px">
          <div><div style="display:flex;gap:6px;padding:3px;border:1px solid var(--terminal-line);border-radius:var(--terminal-radius-sm);background:var(--terminal-bg)">
            ${['despesa', 'receita'].map(t => `<button type="button" id="tr-tipo-${t}" onclick="VMTerminalRecorrencias._setTipo('${t}')" style="flex:1;padding:8px;border:0;border-radius:5px;cursor:pointer;font:700 12px var(--terminal-font);background:${t === tipo ? 'var(--terminal-primary)' : 'transparent'};color:${t === tipo ? 'var(--terminal-bg)' : 'var(--terminal-ink-soft)'}">${t === 'despesa' ? 'Despesa' : 'Receita'}</button>`).join('')}
          </div><input type="hidden" id="tr-tipo" value="${tipo}"></div>
          <div>${this._label('Descrição')}<input id="tr-desc" style="${s}" value="${esc(rec?.descricao || '')}" placeholder="Ex.: Aluguel"></div>
          <div style="display:flex;gap:10px">
            <div style="flex:1">${this._label('Valor (R$)')}<input id="tr-valor" type="number" min="0" step="0.01" style="${s}" value="${rec && !rec.valor_variavel ? rec.valor : ''}" placeholder="0,00"></div>
            <div style="flex:1">${this._label('Dia do vencimento')}<input id="tr-dia" type="number" min="1" max="31" style="${s}" value="${rec?.dia_vencimento || ''}" placeholder="1–31"></div>
          </div>
          <label style="display:flex;align-items:center;gap:9px;cursor:pointer;font-size:12px;color:var(--terminal-ink-soft)"><input type="checkbox" id="tr-var" ${rec?.valor_variavel ? 'checked' : ''} style="accent-color:var(--terminal-primary)"> Valor variável (informo a cada mês)</label>
          <div style="display:flex;gap:10px">
            <div style="flex:1">${this._label('Categoria')}<select id="tr-cat" style="${s}">${this._catOptions(tipo, rec?.categoria)}</select></div>
            <div style="flex:1">${this._label('Meio')}<select id="tr-meio" style="${s}">${MEIOS.map(m => `<option value="${m}" ${m === rec?.meio_pagamento ? 'selected' : ''}>${m}</option>`).join('')}</select></div>
          </div>
          <div>${this._label('Término (opcional)')}<input id="tr-fim" type="date" style="${s}" value="${rec?.data_fim ? String(rec.data_fim).slice(0, 10) : ''}"></div>
          <div style="display:flex;gap:8px;margin-top:6px">
            <button class="td-button td-button--primary" style="flex:1" onclick="VMTerminalRecorrencias.salvar(${rec ? Number(rec.id) : 'null'})"><i class="fas fa-check"></i> Salvar</button>
            <button class="td-button" onclick="VM.closeModal()">Cancelar</button>
          </div>
        </div></div>`
    },
    _setTipo(t) {
      document.getElementById('tr-tipo').value = t
      ;['despesa', 'receita'].forEach(x => {
        const b = document.getElementById('tr-tipo-' + x)
        if (b) { b.style.background = x === t ? 'var(--terminal-primary)' : 'transparent'; b.style.color = x === t ? 'var(--terminal-bg)' : 'var(--terminal-ink-soft)' }
      })
      const cat = document.getElementById('tr-cat')
      if (cat) cat.innerHTML = this._catOptions(t)
    },
    novo() { this._vm.showModal(this._form(null)) },
    editar(rec) { this._vm.showModal(this._form(rec)) },
    async salvar(id) {
      const vm = this._vm
      const tipo = document.getElementById('tr-tipo')?.value || 'despesa'
      const descricao = document.getElementById('tr-desc')?.value?.trim()
      const variavel = document.getElementById('tr-var')?.checked || false
      const valor = parseFloat(document.getElementById('tr-valor')?.value)
      const dia = parseInt(document.getElementById('tr-dia')?.value)
      const categoria = document.getElementById('tr-cat')?.value
      const meio = document.getElementById('tr-meio')?.value
      const fim = document.getElementById('tr-fim')?.value || null
      if (!descricao) return vm.toast('Informe a descrição.', 'error')
      if (!(dia >= 1 && dia <= 31)) return vm.toast('Dia de vencimento deve ser 1–31.', 'error')
      if (!variavel && !(valor > 0)) return vm.toast('Informe um valor maior que zero (ou marque valor variável).', 'error')
      const body = { tipo, descricao, categoria, dia_vencimento: dia, meio_pagamento: meio, valor_variavel: variavel, valor: variavel ? 0 : valor, data_fim: fim }
      const r = await vm.api(id ? 'PUT' : 'POST', id ? `recorrencias/${id}` : 'recorrencias', body).catch(e => ({ error: e.response?.data?.error }))
      if (r?.success) { vm.closeModal(); vm.toast(id ? 'Recorrência atualizada.' : 'Recorrência criada.', 'success'); this.reload() }
      else vm.toast(r?.error || 'Erro ao salvar.', 'error')
    },
    async toggle(id, ativa) {
      const vm = this._vm
      await vm.api('PATCH', `recorrencias/${id}/toggle`).catch(() => {})
      vm.toast(ativa ? 'Recorrência pausada.' : 'Recorrência ativada.', 'success')
      this.reload()
    },
    async deletar(id, desc) {
      const vm = this._vm
      const ok = await vm.vmConfirm(`Excluir <strong>${esc(desc)}</strong>?<br><span style="font-size:.8rem;color:var(--terminal-ink-soft)">Os lançamentos futuros ainda pendentes serão removidos. O histórico já pago é preservado.</span>`, { titulo: 'Excluir recorrência', corBotao: '#FF6B6B', textoBotao: 'Excluir', icone: '🗑️' })
      if (!ok) return
      const r = await vm.api('DELETE', `recorrencias/${id}`).catch(e => ({ error: e.response?.data?.error }))
      if (r?.success) { vm.toast('Recorrência removida.', 'success'); this.reload() }
      else vm.toast(r?.error || 'Erro ao remover.', 'error')
    },
    async lancar(rec) {
      const vm = this._vm
      const now = new Date()
      let valor
      if (rec.valor_variavel) {
        const txt = window.prompt(`Valor de "${rec.descricao}" para este mês:`, '')
        if (txt === null) return
        valor = parseFloat(txt)
        if (!(valor > 0)) return vm.toast('Valor inválido.', 'error')
      }
      const body = { mes: now.getMonth() + 1, ano: now.getFullYear() }
      if (valor) body.valor = valor
      const r = await vm.api('POST', `recorrencias/${rec.id}/lancar`, body).catch(e => ({ error: e.response?.data?.error }))
      if (r?.success) { vm.toast('Lançamento gerado para este mês.', 'success'); this.reload() }
      else vm.toast(r?.error || 'Não foi possível lançar.', 'error')
    },
    async processar() {
      const vm = this._vm
      const ok = await vm.vmConfirm('Gerar agora os lançamentos fixos deste mês que ainda não foram criados?', { titulo: 'Processar mês atual', corBotao: '#3DDC84', textoBotao: 'Processar', icone: '⚡' })
      if (!ok) return
      const r = await vm.api('POST', 'recorrencias/processar', {}).catch(e => ({ error: e.response?.data?.error }))
      if (r?.success) { vm.toast(`${r.geradas || 0} lançamento(s) gerado(s).`, 'success'); this.reload() }
      else vm.toast(r?.error || 'Erro ao processar.', 'error')
    }
  }
})()
