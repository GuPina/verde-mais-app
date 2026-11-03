(function () {
  const esc = (v) => String(v ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;')
  const money = (v) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 2 }).format(Number(v) || 0)
  const TIPOS = [['venda', 'Venda'], ['servico', 'Serviço'], ['aluguel', 'Aluguel'], ['emprestimo_a_receber', 'Empréstimo a receber'], ['contrato', 'Contrato'], ['outros', 'Outros']]
  const TIPO_LBL = Object.fromEntries(TIPOS)
  const dfmt = (d) => { const x = new Date(String(d || '').slice(0, 10) + 'T12:00:00'); return Number.isNaN(x.getTime()) ? '—' : x.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }).replace('.', '') }

  window.VMTerminalRecebimentos = {
    async render(vm) {
      this._vm = vm
      const content = document.getElementById('page-content')
      if (!content) return
      document.body.classList.add('terminal-dashboard-active')
      content.innerHTML = '<div class="td-loading"><span></span><span></span><span></span></div>'
      try {
        const data = await vm.api('GET', 'antecipacao/recebimentos')
        this._recs = data.recebimentos || []
        this._paint()
      } catch (e) {
        content.innerHTML = `<div class="td-error"><i class="fas fa-triangle-exclamation"></i><h2>Não foi possível carregar os recebimentos</h2><p>${esc(e.response?.data?.error || 'Tente novamente.')}</p><button class="td-button td-button--primary" onclick="VMTerminalRecebimentos.reload()">Tentar novamente</button></div>`
      }
    },
    reload() { this.render(this._vm) },

    _paint() {
      const content = document.getElementById('page-content')
      if (!content) return
      const recs = this._recs
      if (!recs.length) return void (content.innerHTML = this._shell(this._empty()))

      // ── As duas contas de um contrato corrigido por índice ─────────────────
      //
      // `contratado` é o que está escrito no contrato, sem índice: o piso, que
      // não muda nunca. `corrigido` é ele mais a correção já recebida, e é este
      // que vale como total — era aqui que a tela travava em R$ 39.009,35 com
      // cinco parcelas já recebidas acima disso.
      //
      // As duas saem de lib/recebiveis.ts, no servidor. O `|| {}` cobre o
      // primeiro carregamento depois do deploy, antes de a migração rodar.
      const c = recs.map(r => r.correcao || {})
      const soma = (k) => c.reduce((a, x) => a + (Number(x[k]) || 0), 0)
      const contratado = soma('contratado') || recs.reduce((a, r) => a + Number(r.valor_total || 0), 0)
      const correcao = soma('correcao')
      const corrigido = soma('corrigido') || contratado
      const recebido = soma('recebido') || recs.reduce((a, r) => a + Number(r.total_recebido || 0), 0)
      const aReceber = Math.max(0, corrigido - recebido)
      const pct = corrigido > 0 ? Math.round((recebido / corrigido) * 100) : 0
      const correcaoPct = contratado > 0 ? Math.round((correcao / contratado) * 10000) / 100 : 0
      const abaixo = c.flatMap(x => x.abaixo_do_minimo || [])

      content.innerHTML = this._shell(`
        <section class="fe-hero">
          <div class="fe-hero__main">
            <span class="td-eyebrow">A receber, no mínimo</span>
            <div class="fe-hero__big">${money(aReceber)}</div>
            <p>${recs.length} contrato${recs.length === 1 ? '' : 's'} · ${money(recebido)} já recebido de ${money(corrigido)}</p>
          </div>
          <div class="fe-hero__gauge">
            <div class="to-bar" style="height:12px"><span style="width:${Math.min(100, pct)}%;background:var(--terminal-primary)"></span></div>
            <div class="fe-hero__nums"><span class="to-status to-status--ok">${pct}% recebido</span></div>
          </div>
        </section>

        <section class="rc-contas">
          <div class="rc-conta">
            <span class="rc-conta__lbl">Contratado, sem correção</span>
            <strong class="rc-conta__val">${money(contratado)}</strong>
            <small>O mínimo do contrato. Este número não se mexe.</small>
          </div>
          <div class="rc-conta rc-conta--ganho">
            <span class="rc-conta__lbl">Recebido a mais do que o combinado</span>
            <strong class="rc-conta__val">${correcao > 0 ? '+' : ''}${money(correcao)}</strong>
            <small>${correcaoPct > 0 ? `${String(correcaoPct).replace('.', ',')}% sobre o contratado · ` : ''}o que o índice já te devolveu</small>
          </div>
          <div class="rc-conta rc-conta--total">
            <span class="rc-conta__lbl">Total corrigido</span>
            <strong class="rc-conta__val">${money(corrigido)}</strong>
            <small>Sobe a cada parcela lançada acima do mínimo.</small>
          </div>
        </section>

        ${abaixo.length ? `<div class="ds-note ds-note--warn rc-alerta">
          <i class="fas fa-triangle-exclamation ds-note__ico"></i>
          <div><strong>${abaixo.length} parcela${abaixo.length === 1 ? '' : 's'} abaixo do mínimo contratual.</strong>
            ${abaixo.map(a => `#${a.numero}: recebeu ${money(a.recebido)} contra ${money(a.previsto)} previstos`).join(' · ')}.
            Não entra${abaixo.length === 1 ? '' : 'm'} na correção — confira o lançamento.</div>
        </div>` : ''}

        <div class="mr-toolbar">
          <div><span class="td-eyebrow">Contratos</span><h2>${recs.length} recebimento${recs.length === 1 ? '' : 's'}</h2></div>
          <button class="td-button td-button--primary" onclick="VMTerminalRecebimentos.novo()"><i class="fas fa-plus"></i> Novo recebimento</button>
        </div>

        <div class="fe-grid">${recs.map(r => this._card(r)).join('')}</div>
      `)
    },

    _card(r) {
      const cr = r.correcao || {}
      const total = Number(r.total_parcelas_count) || Number(r.numero_parcelas) || 0
      const receb = Number(r.parcelas_recebidas) || 0
      const pct = total > 0 ? Math.round((receb / total) * 100) : 0
      const done = r.status === 'concluido'
      const cor = done ? 'var(--terminal-primary)' : pct >= 50 ? 'var(--terminal-primary)' : 'var(--terminal-accent)'
      return `<article class="fe-card ${done ? 'fe-card--done' : ''}">
        <div class="fe-card__top">
          <div class="fe-card__id">
            <strong>${esc(r.descricao)}</strong>
            <small>${esc(TIPO_LBL[r.tipo] || r.tipo || 'Recebimento')}${r.pagador ? ' · ' + esc(r.pagador) : ''}</small>
          </div>
          <span class="fe-badge" title="Mínimo contratual de cada parcela — o índice entra por cima">${money(r.valor_parcela)}<small>/mín</small></span>
        </div>
        <div class="fe-card__saldo">
          <div><span class="fe-lbl">Já recebido</span><span class="fe-val fe-val--big">${money(cr.recebido ?? r.total_recebido)}</span></div>
          <div><span class="fe-lbl">Total corrigido</span><span class="fe-val">${money(cr.corrigido ?? r.valor_total)}</span></div>
        </div>
        ${Number(cr.correcao) > 0 ? `<p class="fe-card__correcao">
          <span>contratado ${money(cr.contratado)}</span>
          <b>+${money(cr.correcao)} de correção</b>
        </p>` : ''}
        <div class="to-bar" style="height:8px"><span style="width:${Math.min(100, pct)}%;background:${cor}"></span></div>
        <div class="fe-card__meta">
          <span class="to-status to-status--${pct >= 50 ? 'ok' : 'warn'}">${receb}/${total} parcelas</span>
          <small>${done ? 'concluído 🎉' : `faltam ${Math.max(0, total - receb)}`}</small>
        </div>
        <div class="fe-card__actions">
          <button class="td-button td-button--sm td-button--primary" onclick="VMTerminalRecebimentos.verParcelas(${Number(r.id)}, '${esc(r.descricao).replace(/'/g, '')}')"><i class="fas fa-list"></i> Parcelas</button>
          <button class="td-button td-button--sm" onclick="VMTerminalRecebimentos.excluir(${Number(r.id)}, '${esc(r.descricao).replace(/'/g, '')}')"><i class="fas fa-trash"></i></button>
        </div>
      </article>`
    },

    _shell(inner) {
      return `<div class="td-dashboard fe">
        <header class="td-dashboard__header">
          <div>
            <span class="td-eyebrow">O dinheiro que ainda vem</span>
            <h1>Parcelamentos recebidos. <em>Cada entrada no seu lugar.</em></h1>
            <p>Vendas, serviços e contratos parcelados — receba cada parcela e ela vira receita automaticamente.</p>
          </div>
        </header>
        ${inner}
      </div>`
    },

    _empty() {
      return `<section class="td-onboarding"><div class="td-onboarding__copy">
        <span class="td-eyebrow">Comece agora</span>
        <h2>Cadastre um recebimento parcelado.</h2>
        <p>Uma venda em 12x, um contrato mensal, um empréstimo que você tem a receber — o VerdeMais gera as parcelas e lança a receita a cada entrada.</p>
        <div class="td-onboarding__actions"><button class="td-button td-button--primary" onclick="VMTerminalRecebimentos.novo()"><i class="fas fa-plus"></i> Novo recebimento</button></div>
      </div></section>`
    },

    _st() { return 'width:100%;background:var(--terminal-bg);border:1px solid var(--terminal-line);color:var(--terminal-ink);border-radius:var(--terminal-radius-sm);padding:10px 12px;font-size:13px;font-family:var(--terminal-font)' },
    _lab(t) { return `<label style="display:block;font:700 10px/1 var(--terminal-mono);letter-spacing:.1em;text-transform:uppercase;color:var(--terminal-ink-soft);margin-bottom:6px">${t}</label>` },

    novo() {
      const s = this._st()
      const hoje = new Date().toISOString().slice(0, 10)
      const opts = TIPOS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')
      this._vm.showModal(`<div style="font-family:var(--terminal-font);color:var(--terminal-ink);min-width:min(440px,92vw)">
        <div style="font-size:16px;font-weight:640">Novo recebimento parcelado</div>
        <div style="color:var(--terminal-ink-soft);font-size:12px;margin:4px 0 18px">O VerdeMais cria uma parcela por mês</div>
        <div style="display:flex;flex-direction:column;gap:13px">
          <div>${this._lab('Descrição')}<input id="rc-desc" style="${s}" placeholder="Ex.: Venda notebook 10x"></div>
          <div style="display:flex;gap:10px">
            <div style="flex:2">${this._lab('Pagador (opc.)')}<input id="rc-pagador" style="${s}" placeholder="Ex.: João"></div>
            <div style="flex:1">${this._lab('Tipo')}<select id="rc-tipo" style="${s}">${opts}</select></div>
          </div>
          <div style="display:flex;gap:10px">
            <div style="flex:1">${this._lab('Valor total (R$)')}<input id="rc-total" type="number" step="0.01" min="0.01" style="${s}"></div>
            <div style="flex:1">${this._lab('Nº parcelas')}<input id="rc-np" type="number" min="1" max="360" style="${s}" value="1"></div>
            <div style="flex:1">${this._lab('1ª parcela em')}<input id="rc-data" type="date" style="${s}" value="${hoje}"></div>
          </div>
          <div style="display:flex;gap:8px;margin-top:6px"><button class="td-button td-button--primary" style="flex:1" onclick="VMTerminalRecebimentos.salvarNovo()"><i class="fas fa-check"></i> Criar</button><button class="td-button" onclick="VM.closeModal()">Cancelar</button></div>
        </div></div>`)
    },
    async salvarNovo() {
      const vm = this._vm, g = i => document.getElementById(i)
      const valor_total = parseFloat(g('rc-total')?.value)
      const numero_parcelas = parseInt(g('rc-np')?.value)
      if (!g('rc-desc')?.value?.trim()) return vm.toast('Informe a descrição.', 'error')
      if (!(valor_total > 0)) return vm.toast('Valor total deve ser maior que zero.', 'error')
      if (!(numero_parcelas >= 1)) return vm.toast('Número de parcelas inválido.', 'error')
      const payload = {
        descricao: g('rc-desc').value.trim(),
        pagador: g('rc-pagador')?.value?.trim() || null,
        tipo: g('rc-tipo')?.value || 'venda',
        valor_total, numero_parcelas,
        data_inicio: g('rc-data')?.value,
      }
      const r = await vm.api('POST', 'antecipacao/recebimentos', payload).catch(e => ({ error: e.response?.data?.error }))
      if (r?.success) { vm.closeModal(); vm.toast(r.message || 'Recebimento criado.', 'success'); this.reload() }
      else vm.toast(r?.error || 'Erro ao criar.', 'error')
    },
    /**
     * As parcelas de um contrato.
     *
     * A versão anterior usava `.ap-row`, que é da tela de Antecipação: três
     * colunas com a data presa em 70px. "#1 · 30 de abr" não cabia, quebrava em
     * duas linhas e o modal ganhava barra de rolagem horizontal — com o rodapé
     * cortado no meio de "TOTAL CORRIGIDO". Aqui a linha tem layout próprio, o
     * número vira etiqueta, e nada depende de caber numa largura fixa.
     *
     * Com 34 parcelas a lista também pedia um filtro: quem abre esta tela quer
     * ver o que falta receber, não rolar por 12 meses de recibo.
     */
    async verParcelas(id, nome, filtro) {
      const vm = this._vm
      this._verId = Number(id); this._verNome = nome
      this._filtro = filtro || this._filtro || 'pendentes'
      const data = await vm.api('GET', `antecipacao/recebimentos/${id}/parcelas`).catch(() => ({ parcelas: [] }))
      const ps = data.parcelas || []
      const cr = data.correcao || {}
      this._parcelas = ps

      const recebidas = ps.filter(p => p.status === 'recebida')
      const pendentes = ps.filter(p => p.status !== 'recebida')
      const visiveis = this._filtro === 'recebidas' ? recebidas
                     : this._filtro === 'todas' ? ps : pendentes

      const linha = (p) => {
        const rec = p.status === 'recebida'
        const previsto = p.valor_previsto == null ? Number(p.valor) : Number(p.valor_previsto)
        const extra = rec ? Math.round((Number(p.valor) - previsto) * 100) / 100 : 0
        return `<li class="rp-linha${rec ? ' is-recebida' : ''}">
          <span class="rp-num">${p.numero_parcela}</span>
          <span class="rp-corpo">
            <strong>${money(p.valor)}</strong>
            <small>${rec
              ? `recebida em ${dfmt(p.data_recebimento)}` +
                (extra > 0 ? ` · <b>+${money(extra)} de correção</b>` : '')
              : `prevista para ${dfmt(p.data_prevista)} · mínimo do contrato`}</small>
          </span>
          ${rec
            ? '<span class="rp-ok" title="recebida"><i class="fas fa-check"></i></span>'
            : `<button class="ds-btn ds-btn--sm ds-btn--primary rp-acao"
                 onclick="VMTerminalRecebimentos.receber(${Number(id)}, ${Number(p.id)}, ${previsto})">Receber</button>`}
        </li>`
      }

      const aba = (chave, rotulo, n) => `<button class="rp-aba${this._filtro === chave ? ' is-ativa' : ''}"
        onclick="VMTerminalRecebimentos.verParcelas(${Number(id)}, ${JSON.stringify(esc(nome))}, '${chave}')">${rotulo} <b>${n}</b></button>`

      // 620px: quatro números no rodapé não cabem em 440 sem transbordar.
      vm.showModal(`<div class="rp-modal">
        <header class="rp-cab">
          <div>
            <h3>${esc(nome)}</h3>
            <p>${recebidas.length} recebida${recebidas.length === 1 ? '' : 's'} ·
               ${pendentes.length} a receber${cr.correcao > 0 ? ` · <b>+${money(cr.correcao)}</b> de correção até agora` : ''}</p>
          </div>
          <button class="ds-btn ds-btn--sm" onclick="VMTerminalRecebimentos.reorganizar(${Number(id)})">
            <i class="fas fa-wand-magic-sparkles"></i> Reorganizar o que falta</button>
        </header>

        <nav class="rp-abas">
          ${aba('pendentes', 'A receber', pendentes.length)}
          ${aba('recebidas', 'Recebidas', recebidas.length)}
          ${aba('todas', 'Todas', ps.length)}
        </nav>

        <ul class="rp-lista">${visiveis.map(linha).join('') ||
          '<li class="rp-vazio">Nada nesta aba.</li>'}</ul>

        ${cr.contratado ? `<footer class="rp-resumo">
          <div><span>Contratado</span><strong>${money(cr.contratado)}</strong></div>
          <div><span>Correção recebida</span><strong class="is-verde">+${money(cr.correcao)}</strong></div>
          <div><span>Já recebido</span><strong>${money(cr.recebido)}</strong></div>
          <div><span>A receber</span><strong>${money(cr.a_receber)}</strong></div>
        </footer>` : ''}

        <div class="rp-rodape"><button class="ds-btn" onclick="VM.closeModal()">Fechar</button></div>
      </div>`, { largura: 620 })
    },

    /**
     * Refaz o que falta: quantas parcelas e de quanto.
     *
     * Simula antes de escrever. Mexer no fluxo de um contrato é mexer em
     * previsão de dinheiro, e a pessoa precisa ver o antes e o depois na mesma
     * tela antes de confirmar — ainda mais porque a operação APAGA as pendentes
     * atuais para recriá-las.
     */
    async reorganizar(id) {
      const vm = this._vm
      const rec = (this._recs || []).find(x => Number(x.id) === Number(id)) || {}
      const pend = (this._parcelas || []).filter(p => p.status !== 'recebida')
      const atual = pend.length ? Number(pend[0].valor_previsto ?? pend[0].valor) : Number(rec.valor_parcela || 0)

      const qtd = await window.VM.vmPrompt(
        `Hoje faltam ${pend.length} parcela(s). Quantas passam a faltar?`,
        { titulo: 'Reorganizar o que falta', tipo: 'number', min: 1, step: '1',
          valor: String(pend.length || 1), icone: '🔁', textoBotao: 'Continuar',
          dica: 'O que já foi recebido não muda.' })
      if (qtd === null) return
      const numero_parcelas = parseInt(qtd, 10)
      if (!(numero_parcelas >= 1)) return vm.toast('Quantidade inválida.', 'error')

      const val = await window.VM.vmPrompt(
        'Quanto passa a valer cada parcela que falta?',
        { titulo: 'Reorganizar o que falta', tipo: 'number', min: 0, step: '0.01', sufixo: 'R$',
          valor: String(atual || ''), icone: '💰', textoBotao: 'Simular',
          dica: `Valor atual: ${money(atual)}` })
      if (val === null) return
      const valor_parcela = parseFloat(val)
      if (!(valor_parcela > 0)) return vm.toast('Valor inválido.', 'error')

      const sim = await vm.api('POST', `antecipacao/recebimentos/${id}/reorganizar`,
        { numero_parcelas, valor_parcela, simular: true }).catch(e => ({ error: e.response?.data?.error }))
      if (!sim || sim.error) return vm.toast(sim?.error || 'Não foi possível simular.', 'error')
      const r = sim.resumo

      const ok = await window.VM.vmConfirm(
        `<div style="text-align:left;line-height:1.7">
          <b>${r.pendentes_antes}</b> parcela(s) de ${money(r.valor_antes)} viram
          <b>${r.pendentes_depois}</b> de ${money(r.valor_depois)}.<br>
          A receber: ${money(r.a_receber)} — de ${dfmt(r.primeira_nova)} a ${dfmt(r.ultima_nova)}.<br>
          <span style="color:var(--terminal-primary)">As ${r.recebidas} já recebidas
          (${money(r.total_recebido)}) não mudam.</span><br>
          <small style="color:var(--terminal-ink-soft)">O contratado de ${money(r.contratado)}
          segue como referência.</small>
        </div>`)
      if (!ok) return

      const res = await vm.api('POST', `antecipacao/recebimentos/${id}/reorganizar`,
        { numero_parcelas, valor_parcela }).catch(e => ({ error: e.response?.data?.error }))
      if (res?.success) {
        vm.toast(res.message || 'Fluxo reorganizado.', 'success')
        await this._silentReload()
        this.verParcelas(id, this._verNome || rec.descricao || '', 'pendentes')
      } else vm.toast(res?.error || 'Erro ao reorganizar.', 'error')
    },

    async receber(recId, parcelaId, valor) {
      const vm = this._vm
      const txt = await window.VM.vmPrompt('Lance o valor que entrou de verdade. O que vier acima do mínimo é contabilizado como correção do índice.', { titulo: 'Registrar recebimento', tipo: 'number', min: 0, step: '0.01', sufixo: 'R$', valor: String(valor), icone: '💰', textoBotao: 'Registrar', dica: `Mínimo contratual: ${money(valor)}` })
      if (txt === null) return
      const valor_real = parseFloat(txt)
      if (!(valor_real > 0)) return vm.toast('Valor inválido.', 'error')
      const r = await vm.api('PATCH', `antecipacao/recebimentos/parcelas/${parcelaId}/receber`, { valor_real }).catch(e => ({ error: e.response?.data?.error }))
      if (r?.success) { vm.toast(r.message || 'Parcela recebida.', 'success'); this.verParcelas(recId, this._recs.find(x => Number(x.id) === Number(recId))?.descricao || '') ; this._silentReload() }
      else vm.toast(r?.error || 'Erro ao receber.', 'error')
    },
    async _silentReload() {
      try { const data = await this._vm.api('GET', 'antecipacao/recebimentos'); this._recs = data.recebimentos || [] } catch (_) {}
    },
    async excluir(id, nome) {
      const vm = this._vm
      if (!await (window.VM).vmConfirm(`Excluir o recebimento "${nome}"? As parcelas e as receitas geradas por ele também são removidas.`)) return
      const r = await vm.api('DELETE', `antecipacao/recebimentos/${id}`).catch(e => ({ error: e.response?.data?.error }))
      if (r?.success) { vm.toast('Recebimento removido.', 'success'); this.reload() }
      else vm.toast(r?.error || 'Erro ao excluir.', 'error')
    }
  }
})()
