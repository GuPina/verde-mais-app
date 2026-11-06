(function () {
  const MES_ABREV = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']
  const esc = (v) => String(v ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;')
  const dfmt = (iso) => { const [a, m, d] = String(iso || '').slice(0, 10).split('-'); return a && m && d ? `${d}/${m}/${a.slice(2)}` : '—' }
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
        this._recebimentos = data.recebimentos || []
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
      const rcbs = this._recebimentos || []
      const entradasRec = ativas.filter(r => r.tipo === 'receita' && !r.valor_variavel).reduce((s, r) => s + Number(r.valor || 0), 0)
      // Recebimentos parcelados entram pela próxima parcela de cada um.
      const entradas = entradasRec + rcbs.reduce((s, f) => s + Number(f.valor_mensal || 0), 0)
      const variaveis = ativas.filter(r => r.valor_variavel).length

      content.innerHTML = `<div class="td-dashboard tr">
        <header class="td-dashboard__header">
          <div>
            <span class="td-eyebrow">No automático</span>
            <h1>Recorrências. <em>Zero digitação.</em></h1>
            <p>Contas fixas e receitas que se repetem — geradas para você a cada mês.</p>
          </div>
          <div class="td-dashboard__header-actions">
            <button class="td-button" onclick="VMTerminalRecorrencias.rastrear()"><i class="fas fa-magnifying-glass-chart"></i> Rastrear recorrências</button>
            <button class="td-button" onclick="VMTerminalRecorrencias.processar()"><i class="fas fa-wand-magic-sparkles"></i> Processar mês</button>
            <button class="td-button td-button--primary" onclick="VMTerminalRecorrencias.novo()"><i class="fas fa-plus"></i> Nova recorrência</button>
          </div>
        </header>

        <section class="tm-kpis">
          <article class="td-kpi"><span>Saídas fixas / mês</span><strong>${money(saidas)}</strong><span class="td-kpi__delta td-kpi__delta--muted">${despesas.length} despesa(s) recorrente(s)</span></article>
          <article class="td-kpi"><span>Entradas fixas / mês</span><strong>${money(entradas)}</strong><span class="td-kpi__delta td-kpi__delta--muted">${receitas.length} receita(s) recorrente(s)${rcbs.length ? ` · ${rcbs.length} recebimento(s) parcelado(s)` : ''}</span></article>
          <article class="td-kpi"><span>Saldo projetado / mês</span><strong>${money(entradas - saidas)}</strong><span class="td-kpi__delta ${entradas - saidas >= 0 ? 'td-kpi__delta--positive' : 'td-kpi__delta--negative'}">${variaveis ? `${variaveis} variável(is) fora da conta` : 'só valores fixos'}</span></article>
        </section>

        ${this._projecao(ativas)}

        ${recs.length === 0 && !rcbs.length ? this._empty() : `
          ${this._group('Despesas fixas', 'arrow-up', despesas)}
          ${this._group('Receitas fixas', 'arrow-down', receitas)}
          ${this._grupoRecebimentos(rcbs)}
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
        // Parcelas a receber que caem neste mês, pelo valor de cada uma.
        for (const f of (this._recebimentos || [])) {
          saldo += Number(f.por_mes?.[ref.slice(0, 7)] || 0)
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
      // O cartão inteiro abre a linha do tempo; os botões de ação não.
      return `<article class="tr-card tr-card--clicavel ${inativa ? 'tr-card--off' : ''}" role="button" tabindex="0"
        title="Ver meses passados e próximos"
        onclick="VMTerminalRecorrencias.verLinha(${Number(r.id)})"
        onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();VMTerminalRecorrencias.verLinha(${Number(r.id)})}">
        <div class="tr-card__top">
          <div class="tr-card__id">
            <strong>${esc(r.descricao)}</strong>
            <small>${esc(CAT_LABEL[r.categoria] || r.categoria || '—')} · vence dia ${Number(r.dia_vencimento) || '—'}</small>
          </div>
          ${r.gerada_mes_atual ? '<span class="tr-badge tr-badge--done"><i class="fas fa-check"></i> gerada</span>' : (inativa ? '<span class="tr-badge">pausada</span>' : '')}
        </div>
        <div class="tr-card__val ${r.tipo === 'receita' ? 'is-pos' : ''}">${r.valor_variavel ? '<em>valor variável</em>' : money(r.valor)}</div>
        <div class="tr-card__hint"><i class="fas fa-clock-rotate-left"></i> Toque para ver o histórico e os próximos meses</div>
        <div class="tr-card__actions" onclick="event.stopPropagation()" onkeydown="event.stopPropagation()">
          ${!inativa ? `<button class="td-button td-button--primary" onclick='VMTerminalRecorrencias.lancar(${j})'><i class="fas fa-bolt"></i> Lançar mês</button>` : ''}
          <button class="td-button" title="${inativa ? 'Ativar' : 'Pausar'}" onclick="VMTerminalRecorrencias.toggle(${Number(r.id)}, ${r.ativa ? 1 : 0})"><i class="fas fa-${inativa ? 'play' : 'pause'}"></i></button>
          <button class="td-button" title="Editar" onclick='VMTerminalRecorrencias.editar(${j})'><i class="fas fa-pen"></i></button>
          <button class="td-button" title="Excluir" onclick="VMTerminalRecorrencias.deletar(${Number(r.id)}, '${esc(r.descricao)}')"><i class="fas fa-trash"></i></button>
        </div>
      </article>`
    },

    _grupoRecebimentos(lista) {
      if (!lista.length) return ''
      const card = (f, i) => `<article class="tr-card tr-card--clicavel tr-card--rcb" role="button" tabindex="0" title="Ver parcelas recebidas e a receber"
          onclick="VMTerminalRecorrencias.verRecebimento(${i})" onkeydown="if(event.key==='Enter'){VMTerminalRecorrencias.verRecebimento(${i})}">
          <div class="tr-card__top">
            <div class="tr-card__id">
              <strong>${esc(f.descricao)}</strong>
              <small>${f.pagador ? esc(f.pagador) + ' · ' : ''}${f.recebidas} de ${f.total_parcelas} recebidas${f.ultima_data ? ` · até ${MES_ABREV[Number(f.ultima_data.slice(5, 7)) - 1]}/${f.ultima_data.slice(2, 4)}` : ''}</small>
            </div>
            ${f.em_atraso ? `<span class="tr-badge tr-badge--atraso">${f.em_atraso} atrasada${f.em_atraso > 1 ? 's' : ''}</span>` : '<span class="tr-badge">parcelado</span>'}
          </div>
          <div class="tr-card__val is-pos">${money(f.valor_mensal)}</div>
          <div class="tr-card__hint"><i class="fas fa-calendar-check"></i> ${f.proxima ? `próxima: parcela ${f.proxima.numero} em ${dfmt(f.proxima.data)}` : ''} · falta ${money(f.total_a_receber)}</div>
          <div class="tr-card__actions" onclick="event.stopPropagation()">
            <button class="td-button" onclick="VM.navigate('recebimentos-parcelados')"><i class="fas fa-hand-holding-dollar"></i> Abrir em Parcelamentos recebidos</button>
          </div>
        </article>`
      return `<div class="tm-group"><div class="tm-group__head"><span class="td-eyebrow"><i class="fas fa-hand-holding-dollar"></i> Recebimentos parcelados · ${lista.length}</span>
          <small class="tr-group-nota">Entradas que se repetem até a última parcela. Vêm de Parcelamentos recebidos e já entram no fluxo acima — receber continua sendo lá.</small></div>
        <div class="tr-grid">${lista.map(card).join('')}</div></div>`
    },

    verRecebimento(i, aba) {
      const f = (this._recebimentos || [])[i]
      if (!f) return
      this._rcbAba = aba || 'proximas'
      const passadas = f.passadas.map(p => `<li class="rp-linha tl-linha is-ok"><span class="tl-mes">${MES_ABREV[Number(p.data.slice(5, 7)) - 1]}/${p.data.slice(0, 4)}</span>
          <span class="rp-corpo"><strong>${money(p.valor)}</strong><small class="tl-estado is-ok">parcela ${p.numero} recebida em ${dfmt(p.data)}${p.correcao > 0 ? ` · <b class="is-verde">+${money(p.correcao)} de correção</b>` : ''}</small></span></li>`).join('')
      const proximas = f.proximas.map(p => `<li class="rp-linha tl-linha ${p.atrasada ? 'is-falta' : 'is-prev'}"><span class="tl-mes">${MES_ABREV[Number(p.data.slice(5, 7)) - 1]}/${p.data.slice(0, 4)}</span>
          <span class="rp-corpo"><strong>${money(p.valor)}</strong><small class="tl-estado ${p.atrasada ? 'is-falta' : 'is-pend'}">parcela ${p.numero} · ${p.atrasada ? 'atrasada desde' : 'prevista para'} ${dfmt(p.data)}</small></span></li>`).join('')
      const aba2 = (k, rot, n) => `<button class="rp-aba${this._rcbAba === k ? ' is-ativa' : ''}" onclick="VMTerminalRecorrencias.verRecebimento(${i}, '${k}')">${rot} <b>${n}</b></button>`
      this._vm.showModal(`<div class="rp-modal tl-modal">
        <header class="rp-cab"><div>
          <h3>${esc(f.descricao)}</h3>
          <p>Recebimento parcelado${f.pagador ? ' · ' + esc(f.pagador) : ''} · ${f.recebidas} de ${f.total_parcelas} recebidas</p>
        </div>
        <button class="ds-btn ds-btn--sm" onclick="VM.closeModal();VM.navigate('recebimentos-parcelados')"><i class="fas fa-hand-holding-dollar"></i> Receber / reorganizar</button></header>
        <nav class="rp-abas">${aba2('proximas', 'A receber', f.proximas.length)}${aba2('passadas', 'Recebidas', f.passadas.length)}</nav>
        <ul class="rp-lista">${(this._rcbAba === 'passadas' ? passadas : proximas) || '<li class="rp-vazio">Nada nesta aba.</li>'}</ul>
        <footer class="rp-resumo">
          <div><span>Recebido</span><strong class="is-verde">${money(f.total_recebido)}</strong></div>
          <div><span>A receber</span><strong>${money(f.total_a_receber)}</strong></div>
          <div><span>Próxima</span><strong>${f.proxima ? money(f.proxima.valor) : '—'}</strong></div>
          <div><span>Atrasadas</span><strong>${f.em_atraso}</strong></div>
        </footer>
        <div class="rp-rodape"><button class="ds-btn" onclick="VM.closeModal()">Fechar</button></div>
      </div>`, { largura: 640 })
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
    _form(rec, extra) {
      const tipo = rec?.tipo || 'despesa'
      const s = this._inputStyle()
      const regraHtml = extra ? this._regraCampos(extra.regra, extra.cartoes, 'rg') : ''
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
          ${regraHtml ? `<div class="rg-bloco">
            <div class="rg-bloco__tit"><i class="fas fa-crosshairs"></i> Regra de match <small>— o que conta como lançamento desta recorrência</small></div>
            ${regraHtml}
            <div class="rg-bloco__acoes">
              <button class="td-button" onclick="VMTerminalRecorrencias.testarRegra(${Number(rec.id)})"><i class="fas fa-flask"></i> Testar regra</button>
              <button class="td-button" onclick="VMTerminalRecorrencias.candidatos(${Number(rec.id)})"><i class="fas fa-wand-magic-sparkles"></i> Procurar lançamentos desta</button>
              <button class="td-button" onclick="VMTerminalRecorrencias.dividir(${Number(rec.id)})"><i class="fas fa-code-branch"></i> Dividir em duas</button>
            </div>
          </div>` : ''}
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
    async editar(rec) {
      const vm = this._vm
      // Abre na hora; a regra chega em seguida (é ela que tem o botão Testar).
      const [g, cs] = await Promise.all([
        vm.api('GET', `recorrencias/${rec.id}/regra`).catch(() => null),
        vm.api('GET', 'cartoes').catch(() => ({ cartoes: [] })),
      ])
      this._regraOriginal = g?.regra ? JSON.stringify(g.regra) : null
      this._editando = rec
      vm.showModal(this._form(rec, g?.regra ? { regra: g.regra, cartoes: cs?.cartoes || [] } : null), { largura: 600 })
    },
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
      if (!r?.success) return vm.toast(r?.error || 'Erro ao salvar.', 'error')
      // A regra só é gravada se mudou — gravar a padrão sem mudança a
      // congelaria no nome antigo quando a recorrência fosse renomeada.
      if (id && document.getElementById('rg-texto')) {
        const regra = this._regraDoForm()
        const mudou = JSON.stringify({ ...JSON.parse(this._regraOriginal || '{}'), ...regra }) !== this._regraOriginal
        if (mudou) {
          const rr = await vm.api('PUT', `recorrencias/${id}/regra`, regra).catch(e => ({ error: e.response?.data?.error }))
          if (!rr?.success) return vm.toast(rr?.error || 'A recorrência foi salva, mas a regra não.', 'error')
        }
      }
      vm.closeModal(); vm.toast(id ? 'Recorrência atualizada.' : 'Recorrência criada.', 'success'); this.reload()
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
        const txt = await window.VM.vmPrompt(`Valor de <strong>${esc(rec.descricao)}</strong> neste mês.`, { titulo: 'Valor do mês', tipo: 'number', min: 0, step: '0.01', sufixo: 'R$', icone: '🔁', textoBotao: 'Lançar' })
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
    },

    // ══ Linha do tempo ═════════════════════════════════════════════════════
    // Lê os lançamentos REAIS ligados à recorrência (com o valor que ficou
    // depois de qualquer ajuste em Despesas/Receitas), mês a mês.
    async verLinha(id, aba) {
      const vm = this._vm
      this._linhaId = Number(id)
      this._linhaAba = aba || this._linhaAba || 'passadas'
      const d = await vm.api('GET', `recorrencias/${id}/linha-do-tempo`).catch(e => ({ error: e.response?.data?.error }))
      if (!d || d.error) return vm.toast(d?.error || 'Não foi possível abrir a linha do tempo.', 'error')
      this._linha = d
      const r = d.recorrencia
      const receita = r.tipo === 'receita'
      const lista = this._linhaAba === 'proximas' ? d.proximas : d.passadas

      const EST = {
        pago: ['pago', 'is-ok'], recebido: ['recebido', 'is-ok'], pendente: ['lançado, a pagar', 'is-pend'],
        faltou: ['sem lançamento', 'is-falta'], aguardando: ['ainda não lançado', 'is-pend'], previsto: ['previsto', 'is-prev'],
      }
      const linha = (m) => {
        const [rot, cls] = EST[m.estado] || [m.estado, '']
        const total = m.lancamentos.reduce((s, l) => s + Number(l.valor), 0)
        const valor = m.lancamentos.length ? money(total) : (m.previsto != null ? money(m.previsto) : 'valor variável')
        const lancs = m.lancamentos.map(l => {
          const aj = l.ajuste != null
            ? ` · <b class="${(l.ajuste > 0) === receita ? 'is-verde' : 'is-verm'}">${l.ajuste > 0 ? '+' : '−'}${money(Math.abs(l.ajuste))} vs. previsto</b>` : ''
          const jr = l.juros ? ` · <b class="is-verm">${money(l.juros)} de juros/taxa</b>` : ''
          return `<small>${esc(l.descricao)} · ${dfmt(l.data)}${m.lancamentos.length > 1 ? ` · ${money(l.valor)}` : ''}${aj}${jr}
            <button class="tl-link" title="Este lançamento não é desta recorrência"
              onclick="VMTerminalRecorrencias.desvincular(${Number(r.id)}, ${Number(l.id)})">desvincular</button></small>`
        }).join('')
        // Mês sem lançamento: criar com a cara dos outros. Passado entra pago,
        // futuro entra pendente — quem decide é a data, no servidor.
        const vazio = !m.lancamentos.length && ['faltou', 'aguardando', 'previsto'].includes(m.estado)
        const criar = vazio ? `<small class="tl-criar"><button class="ds-btn ds-btn--sm" onclick="VMTerminalRecorrencias.preencher(${Number(r.id)}, '${m.mes}')">
            <i class="fas fa-plus"></i> Lançar ${esc(m.rotulo)} ${m.estado === 'faltou' ? 'como pago' : m.estado === 'previsto' ? 'como pendente' : ''}</button></small>` : ''
        const poss = (m.possiveis || []).map(s => `<small class="tl-poss"><i class="fas fa-link"></i>
            Parece ser: ${esc(s.descricao)} · ${dfmt(s.data)} · ${money(s.valor)}
            <button class="ds-btn ds-btn--sm ds-btn--primary" onclick="VMTerminalRecorrencias.vincular(${Number(r.id)}, ${Number(s.lancamento_id)}, false, 'linha')">Vincular</button></small>`).join('')
        return `<li class="rp-linha tl-linha ${cls}">
          <span class="tl-mes">${esc(m.rotulo)}</span>
          <span class="rp-corpo">
            <strong>${valor}${m.duplicado ? ' <span class="tl-tag is-falta">2 lançamentos</span>' : ''}</strong>
            <small class="tl-estado ${cls}">${rot}</small>
            ${lancs}${poss}${criar}
          </span>
        </li>`
      }

      const aba2 = (chave, rotulo, n) => `<button class="rp-aba${this._linhaAba === chave ? ' is-ativa' : ''}"
        onclick="VMTerminalRecorrencias.verLinha(${Number(r.id)}, '${chave}')">${rotulo} <b>${n}</b></button>`

      const rj = d.reajuste
      const banner = rj ? `<div class="tl-aviso">
          <span>Os últimos ${rj.meses} lançamentos vieram <b>${money(rj.para)}</b>, e a recorrência ainda prevê ${money(rj.de)}.</span>
          <button class="ds-btn ds-btn--sm ds-btn--primary" onclick="VMTerminalRecorrencias.atualizarValor(${Number(r.id)}, ${Number(rj.para)})">Atualizar para ${money(rj.para)}</button>
        </div>` : ''
      const soltas = (d.soltas || []).filter(s => !(d.passadas || []).some(m => (m.possiveis || []).some(p => p.lancamento_id === s.lancamento_id)))
      const bannerSoltas = soltas.length ? `<div class="tl-aviso tl-aviso--leve">
          <span>${soltas.length} lançamento${soltas.length > 1 ? 's' : ''} sem vínculo parece${soltas.length > 1 ? 'm' : ''} desta recorrência.</span>
          <button class="ds-btn ds-btn--sm" onclick="VMTerminalRecorrencias.rastrear()">Revisar no rastreio</button>
        </div>` : ''

      const g = d.regra || {}
      const outros = (g.apelidos || []).map(a => `“${esc(a)}”`).join(' ou ')
      const regraTxt = `contém “${esc(g.texto)}”${outros ? ` ou ${outros}` : ''}, ${g.tol_valor_pct == null ? 'qualquer valor' : `valor ±${Number(g.tol_valor_pct)}%`}, dia ±${Number(g.tol_dias)}${g.cartao_id ? ', só no cartão escolhido' : ''}${g.auto_vincular ? '' : ', sem vínculo automático'}`
      const rs = d.resumo || {}

      vm.showModal(`<div class="rp-modal tl-modal">
        <header class="rp-cab">
          <div>
            <h3>${esc(r.descricao)}</h3>
            <p>${receita ? 'Receita' : 'Despesa'} · ${r.valor_variavel ? 'valor variável' : money(r.valor)} · dia ${Number(r.dia_vencimento)}</p>
            <p class="tl-regra"><i class="fas fa-crosshairs"></i> Match: ${regraTxt}${d.regra_personalizada ? '' : ' (padrão)'}</p>
          </div>
          <div class="tl-cab-acoes">
            <button class="ds-btn ds-btn--sm ds-btn--primary" onclick="VMTerminalRecorrencias.candidatos(${Number(r.id)})"><i class="fas fa-wand-magic-sparkles"></i> Procurar lançamentos</button>
            <button class="ds-btn ds-btn--sm" onclick="VMTerminalRecorrencias.editarRegra(${Number(r.id)})"><i class="fas fa-sliders"></i> Regra e teste</button>
            <button class="ds-btn ds-btn--sm" onclick="VMTerminalRecorrencias.editar(VMTerminalRecorrencias._linha.recorrencia)"><i class="fas fa-pen"></i> Editar</button>
          </div>
        </header>
        ${banner}${bannerSoltas}
        <nav class="rp-abas">
          ${aba2('passadas', 'Passadas', (d.passadas || []).length)}
          ${aba2('proximas', 'Próximas', (d.proximas || []).length)}
        </nav>
        <ul class="rp-lista">${(lista || []).map(linha).join('') || '<li class="rp-vazio">Nada nesta aba.</li>'}</ul>
        <footer class="rp-resumo">
          <div><span>${receita ? 'Meses recebidos' : 'Meses pagos'}</span><strong class="is-verde">${Number(rs.meses_pagos) || 0}</strong></div>
          <div><span>Sem lançamento</span><strong>${Number(rs.meses_faltando) || 0}</strong></div>
          <div><span>Com ajuste</span><strong>${Number(rs.meses_ajustados) || 0}</strong></div>
          <div><span>Total lançado</span><strong>${money(rs.total_lancado)}</strong></div>
        </footer>
        <div class="rp-rodape"><button class="ds-btn" onclick="VM.closeModal()">Fechar</button></div>
      </div>`, { largura: 640 })
    },

    async atualizarValor(id, valor) {
      const vm = this._vm
      const r = await vm.api('PUT', `recorrencias/${id}`, { valor }).catch(e => ({ error: e.response?.data?.error }))
      if (!r?.success) return vm.toast(r?.error || 'Não foi possível atualizar.', 'error')
      vm.toast(`Recorrência atualizada para ${money(valor)}.`, 'success')
      this._recarregarFundo()
      this.verLinha(id)
    },

    async vincular(recId, lancId, substituir, volta) {
      const vm = this._vm
      const r = await vm.api('POST', `recorrencias/${recId}/vincular`, { lancamento_ids: [lancId], substituir: !!substituir })
        .catch(e => ({ error: e.response?.data?.error }))
      if (!r?.success || !r.vinculados) return vm.toast(r?.error || 'Esse lançamento já tem vínculo.', 'error')
      vm.toast(r.substituidos ? 'Vinculado — o previsto daquele mês saiu.' : 'Lançamento vinculado.', 'success')
      this._recarregarFundo()
      if (volta === 'linha') this.verLinha(recId); else this.rastrear(this._rastAba)
    },

    async desvincular(recId, lancId) {
      const vm = this._vm
      const ok = await vm.vmConfirm('Tirar este lançamento da recorrência? Ele continua existindo — só deixa de contar como deste mês.',
        { titulo: 'Desvincular', textoBotao: 'Desvincular', icone: '🔗' })
      if (!ok) return
      const r = await vm.api('POST', `recorrencias/${recId}/desvincular`, { lancamento_id: lancId }).catch(e => ({ error: e.response?.data?.error }))
      if (!r?.success) return vm.toast(r?.error || 'Não foi possível desvincular.', 'error')
      this._recarregarFundo()
      this.verLinha(recId)
    },

    // ══ Rastreio ═══════════════════════════════════════════════════════════
    async rastrear(aba) {
      const vm = this._vm
      this._rastAba = aba || this._rastAba || 'despesa'
      const d = await vm.api('GET', 'recorrencias/rastrear').catch(e => ({ error: e.response?.data?.error }))
      if (!d || d.error) return vm.toast(d?.error || 'Não foi possível rastrear.', 'error')
      this._rast = d
      const t = this._rastAba
      const r = d[t] || { novas: [], soltas: [] }
      const receita = t === 'receita'

      const nova = (n, i) => `<li class="rt-item">
          <div class="rt-item__top">
            <strong>${esc(n.nome)}</strong>
            <span class="tl-tag ${n.confianca >= 80 ? 'is-ok' : n.confianca >= 60 ? 'is-pend' : ''}">${Number(n.confianca)}% de certeza</span>
          </div>
          <small>${esc(n.porque)}</small>
          <small class="rt-regra">Match proposto: contém “${esc(n.regra.texto)}”, ${n.regra.tol_valor_pct == null ? 'qualquer valor' : `valor ±${Number(n.regra.tol_valor_pct)}%`}, dia ±${Number(n.regra.tol_dias)}</small>
          <div class="rt-acoes">
            <button class="ds-btn ds-btn--sm ds-btn--primary" onclick="VMTerminalRecorrencias.criarDeSugestao('${t}', ${i})"><i class="fas fa-plus"></i> Criar recorrência</button>
            <button class="ds-btn ds-btn--sm" onclick="VMTerminalRecorrencias.dispensarNova('${t}', ${i})">Não é recorrência</button>
          </div>
        </li>`

      const ok = (b) => b ? '<i class="fas fa-check is-verde"></i>' : '<i class="fas fa-xmark is-verm"></i>'
      const solta = (s) => `<li class="rt-item">
          <div class="rt-item__top">
            <strong>${esc(s.descricao)}</strong>
            <span>${money(s.valor)}</span>
          </div>
          <small>${dfmt(s.data)} · parece ser <b>${esc(s.recorrencia)}</b></small>
          <small class="rt-crit">${ok(s.criterios.texto)} nome ${ok(s.criterios.valor)} valor ${ok(s.criterios.dia)} dia
            ${s.mes_ocupado ? ' · <span class="is-verm">o mês já tem um lançamento desta recorrência</span>' : ''}</small>
          <div class="rt-acoes">
            ${s.mes_ocupado
              ? `${receita ? '' : `<button class="ds-btn ds-btn--sm ds-btn--primary" title="Vincula este e apaga o previsto pendente que a recorrência gerou no mês"
                  onclick="VMTerminalRecorrencias.vincular(${Number(s.recorrencia_id)}, ${Number(s.lancamento_id)}, true)">Usar este no lugar do previsto</button>`}
                 <button class="ds-btn ds-btn--sm" onclick="VMTerminalRecorrencias.vincular(${Number(s.recorrencia_id)}, ${Number(s.lancamento_id)}, false)">Vincular mesmo assim</button>`
              : `<button class="ds-btn ds-btn--sm ds-btn--primary" onclick="VMTerminalRecorrencias.vincular(${Number(s.recorrencia_id)}, ${Number(s.lancamento_id)}, false)">Vincular</button>`}
            <button class="ds-btn ds-btn--sm" onclick="VMTerminalRecorrencias.dispensar('solta:${Number(s.recorrencia_id)}:${Number(s.lancamento_id)}')">Não é desta</button>
          </div>
        </li>`

      const abaR = (chave, rotulo) => {
        const x = d[chave] || { novas: [], soltas: [] }
        return `<button class="rp-aba${t === chave ? ' is-ativa' : ''}" onclick="VMTerminalRecorrencias.rastrear('${chave}')">${rotulo} <b>${x.novas.length + x.soltas.length}</b></button>`
      }

      vm.showModal(`<div class="rp-modal rt-modal">
        <header class="rp-cab">
          <div>
            <h3>Rastrear recorrências</h3>
            <p>Últimos ${Number(d.janela_meses)} meses. Entra quem se repete uma vez por mês, há pelo menos ${Number(d.criterio?.minimo_meses || 3)} meses, no mesmo dia (±${Number(d.criterio?.dispersao_dia_max || 5)}) e ainda está ativo. Parcelas, empréstimos e financiamentos ficam de fora${r.ignoradas_com_dono ? ` (${Number(r.ignoradas_com_dono)} lançamentos)` : ''}.</p>
          </div>
        </header>
        <nav class="rp-abas">${abaR('despesa', 'Saídas')}${abaR('receita', 'Entradas')}</nav>
        <div class="rp-lista rt-lista">
          <h4 class="rt-sec">Novas recorrências sugeridas · ${r.novas.length}</h4>
          <ul>${r.novas.map(nova).join('') || '<li class="rp-vazio">Nenhum padrão novo nesta aba.</li>'}</ul>
          <h4 class="rt-sec">Lançamentos soltos de recorrências que já existem · ${r.soltas.length}</h4>
          <ul>${r.soltas.map(solta).join('') || '<li class="rp-vazio">Tudo vinculado.</li>'}</ul>
          ${(r.quase || []).length ? `<h4 class="rt-sec">Quase entraram · ${r.quase.length}</h4>
            <p class="fp-nota" style="margin:0 0 6px">Repetem, mas não passaram no critério — e o porquê. Se alguma for conta mensal de verdade, crie a recorrência à mão em “Nova recorrência”.</p>
            <ul>${r.quase.map(q => `<li class="rt-item"><div class="rt-item__top"><strong>${esc(q.nome)}</strong><span>${money(q.valor_mediano)}</span></div>
              <small>${Number(q.n)} lançamentos · ${esc(q.motivo)}</small></li>`).join('')}</ul>` : ''}
          ${receita && (this._recebimentos || []).length ? `<p class="fp-nota">Parcelas de Parcelamentos recebidos não entram aqui: elas já aparecem na seção “Recebimentos parcelados” da tela.</p>` : ''}
        </div>
        <div class="rp-rodape rt-rodape">
          <button class="ds-btn" onclick="VM.closeModal()">Fechar</button>
          <button class="tl-link" onclick="VMTerminalRecorrencias.restaurarDispensas()">Voltar a mostrar o que dispensei</button>
        </div>
      </div>`, { largura: 680 })
    },

    async dispensar(chave) {
      const vm = this._vm
      const r = await vm.api('POST', 'recorrencias/rastrear/dispensar', { chave }).catch(e => ({ error: e.response?.data?.error }))
      if (!r?.success) return vm.toast(r?.error || 'Não foi possível dispensar.', 'error')
      this.rastrear(this._rastAba)
    },

    dispensarNova(tipo, i) {
      const n = this._rast?.[tipo]?.novas?.[i]
      if (n) this.dispensar(`nova:${tipo}:${n.chave}`)
    },

    async restaurarDispensas() {
      const vm = this._vm
      const r = await vm.api('DELETE', 'recorrencias/rastrear/dispensas').catch(() => null)
      vm.toast(`${Number(r?.removidas) || 0} sugestão(ões) de volta.`, 'success')
      this.rastrear(this._rastAba)
    },

    criarDeSugestao(tipo, i) {
      const n = this._rast?.[tipo]?.novas?.[i]
      if (!n) return
      this._sug = n
      const s = this._inputStyle()
      const p = n.padrao
      const cats = CATS[tipo].includes(n.categoria) || !n.categoria ? CATS[tipo] : [n.categoria, ...CATS[tipo]]
      const g = n.regra
      this._vm.showModal(`<div style="font-family:var(--terminal-font);color:var(--terminal-ink)">
        <div style="font-size:16px;font-weight:640">Criar recorrência</div>
        <div style="color:var(--terminal-ink-soft);font-size:12px;margin:4px 0 16px">${esc(n.porque)}. Os ${n.ids.length} lançamentos já existentes entram vinculados.</div>
        <div style="display:flex;flex-direction:column;gap:12px">
          <div>${this._label('Nome')}<input id="rs-nome" style="${s}" value="${esc(n.nome)}"></div>
          <div style="display:flex;gap:10px;flex-wrap:wrap">
            <div style="flex:1;min-width:120px">${this._label('Valor (R$)')}<input id="rs-valor" type="number" step="0.01" min="0" style="${s}" value="${p.valor_variavel ? '' : Number(p.valor_mediano)}"></div>
            <div style="flex:1;min-width:90px">${this._label('Dia')}<input id="rs-dia" type="number" min="1" max="31" style="${s}" value="${Number(p.dia_tipico)}"></div>
          </div>
          <label style="display:flex;align-items:center;gap:9px;font-size:12px;color:var(--terminal-ink-soft)"><input type="checkbox" id="rs-var" ${p.valor_variavel ? 'checked' : ''} style="accent-color:var(--terminal-primary)"> Valor variável</label>
          <div>${this._label('Categoria')}<select id="rs-cat" style="${s}">${cats.map(c => `<option value="${esc(c)}" ${c === n.categoria ? 'selected' : ''}>${esc(CAT_LABEL[c] || c)}</option>`).join('')}</select></div>
          <div class="rt-param">
            <div>${this._label('Match: a descrição contém')}<input id="rs-texto" style="${s}" value="${esc(g.texto)}"></div>
            <div style="display:flex;gap:10px;flex-wrap:wrap">
              <div style="flex:1;min-width:120px">${this._label('Valor pode variar (%)')}<input id="rs-tol" type="number" min="0" max="100" style="${s}" value="${g.tol_valor_pct == null ? '' : Number(g.tol_valor_pct)}" placeholder="vazio = qualquer"></div>
              <div style="flex:1;min-width:120px">${this._label('Folga no dia (±)')}<input id="rs-dias" type="number" min="0" max="15" style="${s}" value="${Number(g.tol_dias)}"></div>
            </div>
          </div>
          <div style="display:flex;gap:8px;margin-top:4px">
            <button class="td-button td-button--primary" style="flex:1" onclick="VMTerminalRecorrencias.salvarSugestao('${tipo}')"><i class="fas fa-check"></i> Criar e vincular</button>
            <button class="td-button" onclick="VMTerminalRecorrencias.rastrear('${tipo}')">Voltar</button>
          </div>
        </div></div>`)
    },

    async salvarSugestao(tipo) {
      const vm = this._vm, n = this._sug, v = (i) => document.getElementById(i)?.value
      if (!n) return
      const variavel = !!document.getElementById('rs-var')?.checked
      const tol = v('rs-tol')
      const body = {
        tipo, descricao: (v('rs-nome') || '').trim(), valor: variavel ? null : parseFloat(v('rs-valor')),
        valor_variavel: variavel, dia_vencimento: parseInt(v('rs-dia')), categoria: v('rs-cat'), ids: n.ids,
        regra: { texto: v('rs-texto'), modo: 'contem', tol_valor_pct: tol === '' ? null : Number(tol), tol_dias: parseInt(v('rs-dias')) },
      }
      const r = await vm.api('POST', 'recorrencias/rastrear/criar', body).catch(e => ({ error: e.response?.data?.error }))
      if (!r?.success) return vm.toast(r?.error || 'Não foi possível criar.', 'error')
      vm.toast(`Recorrência criada com ${r.vinculados} lançamento(s) vinculados.`, 'success')
      this._recarregarFundo()
      this.verLinha(r.id, 'passadas')
    },

    // ══ Lançar um mês que ficou vazio ══════════════════════════════════════
    async preencher(id, mes) {
      const vm = this._vm
      const r = this._linha?.recorrencia
      let valor
      if (r && r.valor_variavel) {
        const ult = (this._linha.passadas || []).find(m => m.lancamentos.length)
        const txt = await window.VM.vmPrompt(`Valor de <strong>${esc(r.descricao)}</strong> em ${esc(mes.split('-').reverse().join('/'))}.`,
          { titulo: 'Valor do mês', tipo: 'number', min: 0, step: '0.01', sufixo: 'R$', icone: '🔁', textoBotao: 'Lançar',
            valor: ult ? Number(ult.lancamentos[0].valor) : '' })
        if (txt === null) return
        valor = parseFloat(txt)
        if (!(valor > 0)) return vm.toast('Valor inválido.', 'error')
      }
      const res = await vm.api('POST', `recorrencias/${id}/preencher`, { mes, ...(valor ? { valor } : {}) })
        .catch(e => ({ error: e.response?.data?.error }))
      if (!res?.success) return vm.toast(res?.error || 'Não foi possível lançar.', 'error')
      const como = res.status === 'pago' ? 'paga' : res.status === 'pendente' ? 'pendente' : res.status === 'recebido' ? 'recebida' : 'prevista'
      vm.toast(`Lançado em ${dfmt(res.data)} como ${como}${res.cartao_id ? ', na fatura do cartão' : ''}.`, 'success')
      this._recarregarFundo()
      this.verLinha(id)
    },

    // ══ Procurar lançamentos desta recorrência (com IA, se houver) ═════════
    async candidatos(id) {
      const vm = this._vm
      this._candId = Number(id)
      vm.showModal(`<div class="rp-modal"><div class="rp-vazio">Procurando lançamentos parecidos${'…'}</div></div>`, { largura: 680 })
      const d = await vm.api('GET', `recorrencias/${id}/candidatos`).catch(e => ({ error: e.response?.data?.error }))
      if (!d || d.error) return vm.toast(d?.error || 'Não foi possível procurar.', 'error')
      this._cand = d
      this._resp = {}
      this._pintarCandidatos()
    },

    _pintarCandidatos() {
      const d = this._cand, r = d.recorrencia
      const item = (c) => {
        const resp = this._resp[c.id]
        const ia = c.ia ? `<span class="tl-tag ${c.ia.mesma ? 'is-ok' : 'is-falta'}" title="${esc(c.ia.motivo)}">IA: ${c.ia.mesma ? 'provável' : 'improvável'} · ${Number(c.ia.confianca)}%</span>` : ''
        return `<li class="rt-item rc-item${resp === 'sim' ? ' is-sim' : resp === 'nao' ? ' is-nao' : ''}">
          <div class="rt-item__top"><strong>${esc(c.descricao)}</strong><span>${money(c.valor)}</span></div>
          <small>${dfmt(c.data)}${c.categoria ? ' · ' + esc(c.categoria) : ''} · ${Number(c.pontos)} pontos${c.mes_ocupado ? ' · <span class="is-verm">o mês já tem lançamento</span>' : ''}</small>
          <small>${c.motivos.map(esc).join(' · ')}</small>
          ${c.ia?.motivo ? `<small class="rc-ia">${ia} ${esc(c.ia.motivo)}</small>` : ia ? `<small>${ia}</small>` : ''}
          <div class="rt-acoes">
            <button class="ds-btn ds-btn--sm ${resp === 'sim' ? 'ds-btn--primary' : ''}" onclick="VMTerminalRecorrencias._marcar(${Number(c.id)}, 'sim')"><i class="fas fa-check"></i> Sim, é desta</button>
            <button class="ds-btn ds-btn--sm ${resp === 'nao' ? 'rc-nao-ativo' : ''}" onclick="VMTerminalRecorrencias._marcar(${Number(c.id)}, 'nao')"><i class="fas fa-xmark"></i> Não</button>
          </div>
        </li>`
      }
      const sims = Object.values(this._resp).filter(v => v === 'sim').length
      const naos = Object.values(this._resp).filter(v => v === 'nao').length
      const aviso = d.ia_disponivel
        ? (d.ia_respondeu ? 'A IA deu uma segunda opinião em cada um — mas quem decide é você.' : 'A IA não respondeu agora; a lista está ordenada só pela pontuação.')
        : 'Ordenado por pontuação: palavra em comum, valor, dia, categoria e mês vazio.'
      this._vm.showModal(`<div class="rp-modal rt-modal">
        <header class="rp-cab"><div>
          <h3>Lançamentos de ${esc(r.descricao)}?</h3>
          <p>Lançamentos sem vínculo dos últimos 13 meses que podem ser esta conta com outro nome. ${aviso}</p>
        </div></header>
        <div class="rp-lista rt-lista"><ul>${d.candidatos.map(item).join('') || '<li class="rp-vazio">Nada parecido sem vínculo. Tudo certo por aqui.</li>'}</ul></div>
        <label class="rc-aprender"><input type="checkbox" id="rc-aprender" checked style="accent-color:var(--terminal-primary)">
          Aprender os nomes confirmados (os próximos lançamentos com esse nome entram sozinhos)</label>
        <div class="rp-rodape rt-rodape">
          <button class="ds-btn ds-btn--primary" ${sims + naos ? '' : 'disabled'} onclick="VMTerminalRecorrencias._responder()">Confirmar ${sims} sim · ${naos} não</button>
          <button class="ds-btn" onclick="VMTerminalRecorrencias.verLinha(${Number(r.id)})">Voltar</button>
        </div>
      </div>`, { largura: 680 })
    },

    _marcar(lid, resp) {
      const aprender = document.getElementById('rc-aprender')?.checked
      this._resp[lid] = this._resp[lid] === resp ? undefined : resp
      const lista = document.querySelector('.rt-lista'), topo = lista ? lista.scrollTop : 0
      this._pintarCandidatos()
      const nova = document.querySelector('.rt-lista'); if (nova) nova.scrollTop = topo
      const cb = document.getElementById('rc-aprender'); if (cb && aprender === false) cb.checked = false
    },

    async _responder() {
      const vm = this._vm, id = this._candId
      const sim = Object.keys(this._resp).filter(k => this._resp[k] === 'sim').map(Number)
      const nao = Object.keys(this._resp).filter(k => this._resp[k] === 'nao').map(Number)
      const aprender = !!document.getElementById('rc-aprender')?.checked
      const r = await vm.api('POST', `recorrencias/${id}/candidatos/responder`, { sim, nao, aprender })
        .catch(e => ({ error: e.response?.data?.error }))
      if (!r?.success) return vm.toast(r?.error || 'Não foi possível salvar as respostas.', 'error')
      vm.toast(`${r.vinculados} vinculado(s)${r.substituidos ? `, ${r.substituidos} previsto(s) substituído(s)` : ''}${r.apelidos?.length ? ` · a regra agora também reconhece: ${r.apelidos.join(', ')}` : ''}.`, 'success')
      this._recarregarFundo()
      this.verLinha(id)
    },

    // ══ Dividir em duas ════════════════════════════════════════════════════
    async dividir(id) {
      const vm = this._vm
      const d = await vm.api('GET', `recorrencias/${id}/linha-do-tempo?passados=24&futuros=6`).catch(() => null)
      if (!d?.recorrencia) return vm.toast('Não foi possível abrir a recorrência.', 'error')
      this._linha = d
      const r = d.recorrencia, s = this._inputStyle()
      const lancs = [...d.proximas, ...d.passadas].flatMap(m => m.lancamentos)
      vm.showModal(`<div class="rp-modal">
        <header class="rp-cab"><div>
          <h3>Dividir “${esc(r.descricao)}” em duas</h3>
          <p>A nova recorrência nasce com a mesma categoria, meio e datas. Marque os lançamentos que são dela — eles mudam de recorrência; nada é apagado.
          Depois, se quiser, renomeie esta em Editar.</p>
        </div></header>
        <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:12px">
          <div style="flex:2;min-width:180px">${this._label('Nome da nova')}<input id="dv-nome" style="${s}" placeholder="Ex.: Claude"></div>
          <div style="flex:1;min-width:110px">${this._label('Valor (R$)')}<input id="dv-valor" type="number" min="0" step="0.01" style="${s}"></div>
          <div style="flex:1;min-width:90px">${this._label('Dia')}<input id="dv-dia" type="number" min="1" max="31" style="${s}" value="${Number(r.dia_vencimento)}"></div>
        </div>
        <label style="display:flex;align-items:center;gap:9px;font-size:12px;color:var(--terminal-ink-soft);margin-bottom:10px"><input type="checkbox" id="dv-var" style="accent-color:var(--terminal-primary)"> Valor variável</label>
        <ul class="rp-lista dv-lista">${lancs.map(l => `<li class="rp-linha"><label class="dv-item">
            <input type="checkbox" class="dv-l" value="${Number(l.id)}" style="accent-color:var(--terminal-primary)">
            <span class="rp-corpo"><strong>${esc(l.descricao)}</strong><small>${dfmt(l.data)} · ${money(l.valor)}</small></span></label></li>`).join('')
          || '<li class="rp-vazio">Esta recorrência ainda não tem lançamentos vinculados. A nova será criada vazia — use “Procurar lançamentos” nela depois.</li>'}</ul>
        <div class="rp-rodape rt-rodape">
          <button class="ds-btn ds-btn--primary" onclick="VMTerminalRecorrencias._salvarDivisao(${Number(r.id)})"><i class="fas fa-code-branch"></i> Criar e mover os marcados</button>
          <button class="ds-btn" onclick="VMTerminalRecorrencias.verLinha(${Number(r.id)})">Voltar</button>
        </div>
      </div>`, { largura: 620 })
    },

    async _salvarDivisao(id) {
      const vm = this._vm, v = (i) => document.getElementById(i)?.value
      const variavel = !!document.getElementById('dv-var')?.checked
      const ids = [...document.querySelectorAll('.dv-l:checked')].map(e => Number(e.value))
      const body = { descricao: (v('dv-nome') || '').trim(), valor: variavel ? null : parseFloat(v('dv-valor')),
        valor_variavel: variavel, dia_vencimento: parseInt(v('dv-dia')), lancamento_ids: ids }
      if (!body.descricao) return vm.toast('Dê um nome à nova recorrência.', 'error')
      const r = await vm.api('POST', `recorrencias/${id}/dividir`, body).catch(e => ({ error: e.response?.data?.error }))
      if (!r?.success) return vm.toast(r?.error || 'Não foi possível dividir.', 'error')
      vm.toast(`“${body.descricao}” criada com ${r.movidos} lançamento(s).`, 'success')
      this._recarregarFundo()
      this.verLinha(r.id)
    },

    // ══ Regra de match ═════════════════════════════════════════════════════
    /** Os campos da regra — usados no formulário de edição e no modal da regra. */
    _regraCampos(r, cartoes) {
      const s = this._inputStyle()
      const apelidos = (r.apelidos || [])
      return `<div style="display:flex;flex-direction:column;gap:12px">
          <div style="display:flex;gap:10px;flex-wrap:wrap">
            <div style="flex:2;min-width:180px">${this._label('A descrição')}<input id="rg-texto" style="${s}" value="${esc(r.texto)}"></div>
            <div style="flex:1;min-width:120px">${this._label('Como')}<select id="rg-modo" style="${s}">
              ${[['contem', 'contém'], ['comeca', 'começa com'], ['igual', 'é igual a']].map(([k, l]) => `<option value="${k}" ${r.modo === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
          </div>
          <div>${this._label('Também conhecida como')}
            <div id="rg-apelidos" class="rg-apelidos">${apelidos.map(a => `<span class="rg-apelido" data-v="${esc(a)}">${esc(a)}<button type="button" title="Tirar este nome" onclick="this.parentElement.remove()">×</button></span>`).join('')}
              <span class="rg-apelidos__vazio">${apelidos.length ? '' : 'Nenhum outro nome ainda. Confirmar um lançamento com nome diferente em “Procurar lançamentos” ensina aqui.'}</span></div></div>
          <div style="display:flex;gap:10px;flex-wrap:wrap">
            <div style="flex:1;min-width:120px">${this._label('Valor pode variar (%)')}<input id="rg-tol" type="number" min="0" max="100" style="${s}" value="${r.tol_valor_pct == null ? '' : Number(r.tol_valor_pct)}" placeholder="vazio = qualquer valor"></div>
            <div style="flex:1;min-width:120px">${this._label('Folga no dia (±)')}<input id="rg-dias" type="number" min="0" max="15" style="${s}" value="${Number(r.tol_dias)}"></div>
          </div>
          <div>${this._label('Só no cartão (opcional)')}<select id="rg-cartao" style="${s}"><option value="">qualquer meio</option>
            ${(cartoes || []).map(c => `<option value="${Number(c.id)}" ${Number(r.cartao_id) === Number(c.id) ? 'selected' : ''}>${esc(c.nome || c.apelido || ('Cartão ' + c.id))}</option>`).join('')}</select></div>
          <label style="display:flex;align-items:center;gap:9px;font-size:12px;color:var(--terminal-ink-soft)"><input type="checkbox" id="rg-auto" ${r.auto_vincular ? 'checked' : ''} style="accent-color:var(--terminal-primary)"> Vincular sozinho quando bater em tudo</label>
          <div id="rg-teste" class="rg-teste"></div>
        </div>`
    },

    async editarRegra(id) {
      const vm = this._vm
      const [g, cs] = await Promise.all([
        vm.api('GET', `recorrencias/${id}/regra`).catch(() => null),
        vm.api('GET', 'cartoes').catch(() => ({ cartoes: [] })),
      ])
      if (!g?.regra) return vm.toast('Não foi possível abrir a regra.', 'error')
      const rec = this._linha?.recorrencia
      vm.showModal(`<div style="font-family:var(--terminal-font);color:var(--terminal-ink)">
        <div style="font-size:16px;font-weight:640">Regra de match${rec ? ` · ${esc(rec.descricao)}` : ''}</div>
        <div style="color:var(--terminal-ink-soft);font-size:12px;line-height:1.5;margin:4px 0 16px">
          Quando um lançamento entra — digitado, no cartão ou importado — e bate em tudo isto, ele é vinculado sozinho.
          Se duas recorrências baterem, ou o mês já tiver lançamento, ele vira sugestão no rastreio.</div>
        ${this._regraCampos(g.regra, cs?.cartoes || [])}
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:14px">
          <button class="td-button td-button--primary" style="flex:1" onclick="VMTerminalRecorrencias.salvarRegra(${Number(id)})"><i class="fas fa-check"></i> Salvar</button>
          <button class="td-button" onclick="VMTerminalRecorrencias.testarRegra(${Number(id)})"><i class="fas fa-flask"></i> Testar regra</button>
          ${g.personalizada ? `<button class="td-button" onclick="VMTerminalRecorrencias.regraPadrao(${Number(id)})">Voltar ao padrão</button>` : ''}
          <button class="td-button" onclick="VMTerminalRecorrencias.verLinha(${Number(id)})">Voltar</button>
        </div></div>`, { largura: 560 })
    },

    _regraDoForm() {
      const v = (i) => document.getElementById(i)?.value
      const tol = v('rg-tol')
      const r = { texto: v('rg-texto'), modo: v('rg-modo'), tol_valor_pct: tol === '' || tol == null ? null : Number(tol),
        tol_dias: parseInt(v('rg-dias')), cartao_id: v('rg-cartao') ? Number(v('rg-cartao')) : null,
        auto_vincular: !!document.getElementById('rg-auto')?.checked }
      const cx = document.getElementById('rg-apelidos')
      if (cx) r.apelidos = [...cx.querySelectorAll('.rg-apelido')].map(e => e.dataset.v)
      return r
    },

    _mostrarTeste(t) {
      const el = document.getElementById('rg-teste')
      if (!el) return
      const item = (l) => `<li><span>${dfmt(l.data)}</span><span>${esc(l.descricao)}</span><b>${money(l.valor)}</b>${l.de_outra ? '<em>de outra recorrência</em>' : l.ja_vinculado ? '<em>já vinculado</em>' : ''}</li>`
      el.innerHTML = `<div class="rg-teste__tit">Nos últimos meses esta regra pegaria <b>${t.pegaria.length}</b> lançamento(s)</div>
        <ul>${t.pegaria.slice(0, 12).map(item).join('') || '<li><span>nenhum</span></li>'}</ul>
        ${t.quase.length ? `<div class="rg-teste__tit">Têm o nome mas ficaram fora (valor ou dia): <b>${t.quase.length}</b></div><ul>${t.quase.slice(0, 6).map(item).join('')}</ul>` : ''}`
    },

    async testarRegra(id) {
      const vm = this._vm
      const r = await vm.api('POST', `recorrencias/${id}/regra/testar`, this._regraDoForm()).catch(e => ({ error: e.response?.data?.error }))
      if (!r || r.error) return vm.toast(r?.error || 'Não foi possível testar.', 'error')
      this._mostrarTeste(r)
    },

    async salvarRegra(id) {
      const vm = this._vm
      const r = await vm.api('PUT', `recorrencias/${id}/regra`, this._regraDoForm()).catch(e => ({ error: e.response?.data?.error }))
      if (!r?.success) return vm.toast(r?.error || 'Não foi possível salvar a regra.', 'error')
      vm.toast('Regra salva. Vale para os próximos lançamentos; os soltos aparecem no rastreio.', 'success')
      this.verLinha(id)
    },

    async regraPadrao(id) {
      await this._vm.api('DELETE', `recorrencias/${id}/regra`).catch(() => {})
      this.editarRegra(id)
    },

    /** Atualiza a lista atrás do modal sem fechá-lo. */
    async _recarregarFundo() {
      try {
        const data = await this._vm.api('GET', 'recorrencias')
        this._cache = data.recorrencias || []
        this._resumo = data.resumo || {}
        this._paint()
      } catch (_) { /* a lista atualiza no próximo render */ }
    }
  }
})()
