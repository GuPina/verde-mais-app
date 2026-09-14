/**
 * VerdeMais — Cartões & Faturas
 * ============================================================================
 * Layout: régua de cartões no topo (fatura, fechamento, uso do limite), fatura
 * do cartão selecionado à esquerda e leitura da fatura à direita (gastos por
 * categoria + alerta). Todas as ações são as que o app já tem.
 */
(function () {
  const esc = (v) => String(v ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;')
  const money = (v) => new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL',maximumFractionDigits:2}).format(Number(v)||0)
  const MESES = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro']
  const ABR = ['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez']
  const PALETA = ['#3DDC84','#F2C94C','#8B5CF6','#6EA8FE','#EC4899','#F97316','#06B6D4','#84CC16']
  const safeCor = (c,i) => (typeof c==='string' && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(c.trim())) ? c.trim() : PALETA[i % PALETA.length]
  const dia = (iso) => { if(!iso) return '—'; const d=new Date(String(iso).slice(0,10)+'T12:00:00'); return isNaN(d)?'—':`${String(d.getDate()).padStart(2,'0')} ${ABR[d.getMonth()]}` }

  window.VMTerminalCartoes = {
    _sel: null, _mes: null, _ano: null,

    async render(vm) {
      this._vm = vm
      const content = document.getElementById('page-content')
      if (!content) return
      document.body.classList.add('terminal-dashboard-active')
      const hoje = new Date()
      if (this._mes == null) { this._mes = hoje.getMonth()+1; this._ano = hoje.getFullYear() }
      content.innerHTML = '<div class="td-loading"><span></span><span></span><span></span></div>'
      try {
        const resumo = await vm.api('GET','cartoes/resumo-faturas')
        this._cartoes = resumo.cartoes || resumo.resumo || (Array.isArray(resumo) ? resumo : [])
        if (!this._sel && this._cartoes.length) this._sel = this._cartoes[0].id
        this._paint()
        if (this._sel) this.abrirFatura(this._sel)
      } catch (e) {
        content.innerHTML = `<div class="td-error"><i class="fas fa-triangle-exclamation"></i><h2>Não foi possível carregar seus cartões</h2><p>${esc(e.response?.data?.error||'Tente novamente.')}</p><button class="ds-btn ds-btn--primary" onclick="VM.pageCartoes()">Tentar novamente</button></div>`
      }
    },
    reload() { this.render(this._vm) },

    _paint() {
      const content = document.getElementById('page-content')
      if (!content) return
      const cs = this._cartoes || []
      content.innerHTML = `<div class="td-dashboard ct">
        <header class="td-dashboard__header">
          <div>
            <span class="ds-eyebrow">${esc(MESES[this._mes-1])} · ${this._ano}</span>
            <h1 class="ds-h1" style="margin:6px 0 0">Cartões &amp; Faturas</h1>
          </div>
          <div class="td-dashboard__header-actions">
            <button class="ds-btn ds-btn--sm" onclick="VM.modalGerenciarCompras()"><i class="fas fa-layer-group"></i> Compras parceladas</button>
            <button class="ds-btn ds-btn--sm" onclick="VM.modalLancarCompraAnterior()"><i class="fas fa-history"></i> Compra anterior</button>
            <button class="ds-btn ds-btn--sm" onclick="VMTerminalCartoes.diagnostico()"><i class="fas fa-stethoscope"></i> Conferir faturas</button>
            <button class="ds-btn ds-btn--primary" onclick="VM.modalCartao()"><i class="fas fa-plus"></i> Novo cartão</button>
          </div>
        </header>

        <!-- Duas parcelas da mesma compra na mesma fatura, ou um lançamento em
             dobro. Só aparece quando existe: era a única coisa que o usuário
             tinha que descobrir sozinho abrindo a fatura e reparando. -->
        <div id="ct-duplicatas"></div>

        ${cs.length ? `<section class="ct-rail">${cs.map((c,i)=>this._tile(c,i)).join('')}</section>` : `
          <div class="ds-card ds-empty"><i class="fas fa-credit-card"></i>
            <p>Você ainda não tem cartões cadastrados. Cadastre um para acompanhar fatura, limite e parcelas.</p>
            <button class="ds-btn ds-btn--primary" onclick="VM.modalCartao()"><i class="fas fa-plus"></i> Cadastrar cartão</button>
          </div>`}

        ${cs.length ? `<section class="ct-grid">
          <article class="ds-card ct-fatura" id="ct-fatura"><div class="td-loading"><span></span><span></span><span></span></div></article>
          <aside class="ct-side">
            <article class="ds-card" id="ct-cats"></article>
            <div id="ct-alerta"></div>
          </aside>
        </section>` : ''}
      </div>`

      // Sem await: o aviso é um extra e não deve atrasar a fatura.
      this._duplicatas()
    },

    /** Cartão da régua superior — cor do cartão, fatura, fechamento e uso. */
    _tile(c, i) {
      const cor = safeCor(c.cor, i)
      const uso = Number(c.percentual_uso) || 0
      const tone = uso >= 90 ? 'neg' : uso >= 70 ? 'warn' : 'ok'
      const ativo = String(this._sel) === String(c.id)
      return `<button class="ct-tile${ativo?' is-on':''}" style="--cc:${cor}" onclick="VMTerminalCartoes.abrirFatura(${Number(c.id)})">
        <div class="ct-tile__top">
          <span class="ct-tile__nome">${esc(c.apelido || c.nome)}</span>
          <span class="ct-tile__fecha">fecha ${c.dia_fechamento ? 'dia '+c.dia_fechamento : '—'}</span>
        </div>
        <span class="ds-eyebrow">Fatura atual</span>
        <strong class="ct-tile__val">${money(c.fatura_atual)}</strong>
        <small class="ct-tile__sub">${uso}% do limite · restam ${money(c.limite_disponivel)}</small>
        <span class="ds-bar ct-tile__bar"><span class="is-${tone}" style="width:${Math.min(100,uso)}%"></span></span>
      </button>`
    },

    async abrirFatura(id) {
      this._sel = id
      document.querySelectorAll('.ct-tile').forEach(el => el.classList.remove('is-on'))
      const cs = this._cartoes || []
      const idx = cs.findIndex(c => String(c.id) === String(id))
      const tiles = document.querySelectorAll('.ct-tile')
      if (tiles[idx]) tiles[idx].classList.add('is-on')
      const alvo = document.getElementById('ct-fatura')
      if (alvo) alvo.innerHTML = '<div class="td-loading"><span></span><span></span><span></span></div>'
      try {
        const d = await this._vm.api('GET', `cartoes/${id}/fatura?mes=${this._mes}&ano=${this._ano}`)
        this._fatura = d
        this._pintarFatura(d)
        this._pintarCategorias(d)
        this._pintarAlerta(d)
      } catch (e) {
        if (alvo) alvo.innerHTML = `<div class="ds-empty"><i class="fas fa-triangle-exclamation"></i><p>${esc(e.response?.data?.error||'Erro ao carregar a fatura.')}</p></div>`
      }
    },

    /** O mês da fatura vive no módulo, não na URL: navegar é repintar. */
    mudarMes(delta) {
      let m = (this._mes || 1) + delta, a = this._ano
      if (m < 1) { m = 12; a-- }
      if (m > 12) { m = 1; a++ }
      this._mes = m; this._ano = a
      // O cabeçalho da tela mostra o mês; a régua superior é do mês corrente
      // e não muda. Só o painel da fatura recarrega.
      const eyebrow = document.querySelector('.ct .ds-eyebrow')
      if (eyebrow) eyebrow.textContent = `${MESES[m-1]} · ${a}`
      if (this._sel) this.abrirFatura(this._sel)
    },
    irParaHoje() {
      const h = new Date()
      this._mes = h.getMonth() + 1; this._ano = h.getFullYear()
      const eyebrow = document.querySelector('.ct .ds-eyebrow')
      if (eyebrow) eyebrow.textContent = `${MESES[this._mes-1]} · ${this._ano}`
      if (this._sel) this.abrirFatura(this._sel)
    },
    _ehMesCorrente() {
      const h = new Date()
      return this._mes === h.getMonth() + 1 && this._ano === h.getFullYear()
    },

    /**
     * Confere se cada compra está na fatura que o ciclo do cartão manda.
     *
     * Dois bugs corrigidos deixaram dados errados para trás: o update de
     * despesa não recalculava a fatura ao mudar data ou cartão, e o gerador
     * de parcelas transbordava o dia em compras feitas nos dias 29, 30 e 31.
     * Corrigir o código não conserta o que já está gravado — esta tela mostra
     * o que ficou torto e oferece o reparo.
     */
    /**
     * O aviso de fatura com parcela repetida.
     *
     * Nasce vazio e some sozinho. Separa os dois casos porque a correção é
     * oposta: parcela empilhada se RECOLOCA (nenhuma linha sobra), lançamento
     * em dobro se EXCLUI — e esse segundo nunca sem o usuário conferir, porque
     * apagar lançamento por conta própria é o tipo de ajuda que ninguém pede.
     */
    async _duplicatas() {
      const el = document.getElementById('ct-duplicatas')
      if (!el) return
      try {
        const d = await this._vm.api('GET', 'cartoes/duplicatas')
        this._dup = d
        const emp = d.empilhadas || [], dob = d.em_dobro || [], bur = d.buracos || []
        if (!emp.length && !dob.length && !bur.length) { el.innerHTML = ''; return }

        const linha = (x) => `<li><b>${esc(x.descricao)}</b> · fatura ${esc(x.fatura)} ·
          ${esc(x.cartao)} — ${x.parcelas.map(p => `${esc(p.rotulo)} (${money(p.valor)})`).join(' e ')}</li>`

        el.innerHTML = `<div class="ct-dup">
          <i class="fas fa-clone ct-dup__ico"></i>
          <div class="ct-dup__corpo">
            <strong>${emp.length + dob.length + bur.length === 1
              ? 'Encontrei uma fatura com problema'
              : `Encontrei ${emp.length + dob.length + bur.length} faturas com problema`}</strong>

            ${emp.length ? `<div class="ct-dup__bloco">
              <span class="ct-dup__tag">parcela na fatura errada</span>
              <ul>${emp.map(x => linha(x) + (x.reparo_alcanca === false
                ? `<li class="ct-dup__fora">${esc(d.como_resolver?.importado || '')}</li>` : '')).join('')}</ul>
              <p>${esc(d.como_resolver?.empilhada || '')}</p>
              ${emp.some(x => x.reparo_alcanca !== false) ? `
                <button class="ds-btn ds-btn--sm ds-btn--primary" onclick="VMTerminalCartoes.corrigirFaturas()">
                  Recolocar na fatura certa</button>` : ''}
            </div>` : ''}

            ${bur.length ? `<div class="ct-dup__bloco">
              <span class="ct-dup__tag">mês sem parcela</span>
              <ul>${bur.map(x => `<li><b>${esc(x.descricao)}</b> · ${esc(x.cartao)} —
                ${x.parcelas} de ${x.total_parcelas} parcelas lançadas, sem nada em
                ${x.faturas_sem_parcela.map(f => esc(f)).join(', ')}</li>`).join('')}</ul>
              <p>${esc(d.como_resolver?.buraco || '')}</p>
              ${(emp.length || !bur.some(x => x.reparo_alcanca !== false)) ? '' : `
                <button class="ds-btn ds-btn--sm ds-btn--primary" onclick="VMTerminalCartoes.corrigirFaturas()">
                  Recolocar na fatura certa</button>`}
            </div>` : ''}

            ${dob.length ? `<div class="ct-dup__bloco">
              <span class="ct-dup__tag is-neg">lançamento em dobro</span>
              <ul>${dob.map(linha).join('')}</ul>
              <p>${esc(d.como_resolver?.em_dobro || '')}</p>
              <button class="ds-btn ds-btn--sm" onclick="VM.modalGerenciarCompras()">Abrir compras parceladas</button>
            </div>` : ''}
          </div>
        </div>`
      } catch (e) {
        el.innerHTML = ''
      }
    },

    async corrigirFaturas() {
      const vm = this._vm
      // Simula primeiro: o número de lançamentos afetados tem que caber na
      // pergunta, senão "corrigir" é um botão que se aperta no escuro.
      const sim = await vm.api('POST', 'cartoes/reparar-faturas', { simular: true })
        .catch(e => ({ error: e.response?.data?.error }))
      if (!sim || sim.error) return vm.toast(sim?.error || 'Não foi possível conferir.', 'error')
      if (!sim.total) return vm.toast('Nenhum lançamento está fora da fatura certa.', 'success')

      const ok = await window.VM.vmConfirm(
        `Recolocar <strong>${sim.total}</strong> ${sim.total === 1 ? 'lançamento' : 'lançamentos'} ` +
        `na fatura certa? Nenhum lançamento é criado nem excluído — eles só mudam de mês.`)
      if (!ok) return

      const r = await vm.api('POST', 'cartoes/reparar-faturas', {})
        .catch(e => ({ error: e.response?.data?.error }))
      if (r && r.success) { vm.toast(r.message || 'Faturas corrigidas.', 'success'); this.reload() }
      else vm.toast(r?.error || 'Erro ao corrigir.', 'error')
    },

    async diagnostico() {
      const vm = this._vm
      vm.showModal('<div class="td-loading"><span></span><span></span><span></span></div>')
      const d = await vm.api('GET', 'cartoes/diagnostico').catch(e => ({ error: e.response?.data?.error }))
      if (d?.error) { vm.closeModal(); return vm.toast(d.error, 'error') }

      const probs = d.problemas || []
      const buracos = d.parcelamentos_com_buraco || []
      if (!probs.length && !buracos.length) {
        return vm.showModal(`<div class="ct-diag">
          <div class="ct-diag__head"><span class="ct-diag__ico is-ok"><i class="fas fa-circle-check"></i></span>
            <div><strong>Está tudo no lugar</strong><small>${d.total_analisado} lançamentos conferidos contra o ciclo de cada cartão.</small></div></div>
          <button class="ds-btn ds-btn--block" onclick="VM.closeModal()">Fechar</button>
        </div>`)
      }

      vm.showModal(`<div class="ct-diag">
        <div class="ct-diag__head">
          <span class="ct-diag__ico is-warn"><i class="fas fa-triangle-exclamation"></i></span>
          <div>
            <strong>${probs.length} lançamento${probs.length === 1 ? '' : 's'} fora da fatura correta</strong>
            <small>De ${d.total_analisado} conferidos.${d.importados_ignorados ? ` ${d.importados_ignorados} lançamentos de fatura importada foram deixados de fora — neles a data da compra não é confiável.` : ''}</small>
          </div>
        </div>

        ${buracos.length ? `<div class="ds-note ds-note--warn" style="margin-bottom:14px">
          <i class="fas fa-calendar-xmark ds-note__ico"></i>
          <div><strong>${buracos.length} parcelamento(s) com mês pulado.</strong> Compra feita em dia 29, 30 ou 31 pulava um mês e colocava duas parcelas no seguinte. É por isso que uma mensalidade pode não aparecer no mês esperado.</div>
        </div>` : ''}

        <div class="ds-tablewrap ct-diag__tabela"><table class="ds-table">
          <thead><tr><th>Lançamento</th><th>Comprado em</th><th>Está na fatura</th><th>Deveria estar</th></tr></thead>
          <tbody>${probs.slice(0, 60).map(p => `<tr>
            <td><strong>${esc(String(p.descricao || '').replace(/\s*\(\d+\/\d+\)\s*$/, ''))}</strong>
                ${p.parcela ? `<span class="ds-pill">${esc(p.parcela)}</span>` : ''}
                <br><small class="ds-muted">${esc(p.cartao || '')} · ${money(p.valor)}</small>
                <br><small class="ds-muted">${esc(p.explica || '')}</small></td>
            <td class="ds-mono">${esc(String(p.data_compra || '').split('-').reverse().join('/'))}</td>
            <td class="ds-mono" style="color:var(--terminal-negative)">${esc(p.gravado?.fatura || '—')}</td>
            <td class="ds-mono" style="color:var(--terminal-primary)">${esc(p.correto?.fatura || '—')}</td>
          </tr>`).join('')}</tbody>
        </table></div>
        ${probs.length > 60 ? `<p class="ds-micro" style="margin:10px 0 0">Mostrando 60 de ${probs.length}. O reparo vale para todos.</p>` : ''}

        <div class="ct-diag__acoes">
          <button class="ds-btn ds-btn--primary" style="flex:1" onclick="VMTerminalCartoes.reparar()"><i class="fas fa-wrench"></i> Recolocar na fatura certa (${d.reparavel})</button>
          <button class="ds-btn" onclick="VM.closeModal()">Agora não</button>
        </div>
        <p class="ds-micro" style="margin:10px 0 0">O reparo recalcula fatura e vencimento a partir da data da compra. Não muda valor, descrição, categoria nem o que já está pago.</p>
      </div>`)
    },

    /**
     * Simula antes de escrever.
     *
     * Mexer em fatura é mexer em dinheiro no lugar errado, e a versão
     * anterior desta rota — que recalculava tudo a partir da data da compra —
     * teria empurrado dezenas de lançamentos importados corretos para a
     * fatura seguinte. Agora a pessoa vê linha a linha o que vai mudar antes
     * de confirmar.
     */
    async reparar() {
      const vm = this._vm
      const prev = await vm.api('POST', 'cartoes/reparar-faturas', { simular: true })
        .catch(e => ({ error: e.response?.data?.error }))
      if (prev?.error) return vm.toast(prev.error, 'error')
      const acoes = prev.acoes || []
      if (!acoes.length) {
        return vm.toast('Nada a corrigir — todos os lançamentos já estão na fatura certa.', 'info')
      }
      const linhas = acoes.map(a => `<tr>
        <td><strong>${esc(a.desc || a.descricao || '')}</strong><br><small class="ds-muted">${a.motivo === 'data_da_parcela' ? 'a data desta parcela pulou um mês' : 'fora do ciclo do cartão'}</small></td>
        <td class="ds-mono">${esc(a.de)} → <span style="color:var(--terminal-primary)">${esc(a.para)}</span></td>
        <td class="ds-mono">${esc(a.fatura_de)} → <span style="color:var(--terminal-primary)">${esc(a.fatura_para)}</span></td>
      </tr>`).join('')

      vm.showModal(`<div class="ct-diag">
        <div class="ct-diag__head">
          <span class="ct-diag__ico is-warn"><i class="fas fa-wrench"></i></span>
          <div><strong>${acoes.length} lançamento${acoes.length === 1 ? '' : 's'} será${acoes.length === 1 ? '' : 'ão'} corrigido${acoes.length === 1 ? '' : 's'}</strong>
            <small>${prev.ignorados_importados || 0} lançamentos vindos de importação de fatura ficam como estão — neles a data da compra não é confiável, e recalcular jogaria a compra para a fatura seguinte.</small></div>
        </div>
        <div class="ds-tablewrap ct-diag__tabela"><table class="ds-table">
          <thead><tr><th>Lançamento</th><th>Data da parcela</th><th>Fatura</th></tr></thead>
          <tbody>${linhas}</tbody></table></div>
        <div class="ct-diag__acoes">
          <button class="ds-btn ds-btn--primary" style="flex:1" onclick="VMTerminalCartoes._reparoConfirmado()"><i class="fas fa-check"></i> Confirmar correção</button>
          <button class="ds-btn" onclick="VM.closeModal()">Cancelar</button>
        </div>
        <p class="ds-micro" style="margin:10px 0 0">Valor, descrição, categoria e status de pagamento não mudam.</p>
      </div>`)
    },

    async _reparoConfirmado() {
      const vm = this._vm
      const r = await vm.api('POST', 'cartoes/reparar-faturas', {}).catch(e => ({ error: e.response?.data?.error }))
      if (r?.error) return vm.toast(r.error, 'error')
      vm.closeModal()
      vm.toast(r?.message || 'Faturas recalculadas.', 'success')
      this.reload()
    },

    _pintarFatura(d) {
      const el = document.getElementById('ct-fatura')
      if (!el) return
      const c = d.cartao || {}, f = d.fatura || {}, itens = d.lancamentos || []
      const st = f.status === 'paga' ? ['ok','Paga'] : f.status === 'vencida' ? ['neg','Vencida'] : ['warn','Em aberto']
      el.innerHTML = `
        <div class="ds-card__head">
          <div>
            <span class="ds-eyebrow">Fatura · ${esc(MESES[(f.mes||1)-1])}</span>
            <h2 class="ds-h2" style="margin:5px 0 0">${esc(c.apelido || c.nome || 'Cartão')}</h2>
            <p class="ds-micro" style="margin:4px 0 0">Vence ${dia(f.data_vencimento)} · ${f.qtd_lancamentos||0} lançamento${(f.qtd_lancamentos||0)===1?'':'s'}</p>
          </div>
          <div class="ct-acoes">
            <span class="ds-pill ds-pill--${st[0]}">${st[1]}</span>
            <button class="ds-btn ds-btn--sm" onclick="VM.modalSplitCompra&&VM.modalSplitCompra(${Number(c.id)})"><i class="fas fa-scissors"></i> Parcelar</button>
            <button class="ds-btn ds-btn--sm" onclick="VM.modalLimitesCategoria&&VM.modalLimitesCategoria(${Number(c.id)})"><i class="fas fa-sliders"></i> Limites</button>
            <button class="ds-icon-btn" title="Editar cartão" onclick="VM.modalCartao(${Number(c.id)})"><i class="fas fa-pen"></i></button>
            <button class="ds-icon-btn" title="Excluir cartão" onclick="VM._ctExcluir(${Number(c.id)}, ${JSON.stringify(c.apelido || c.nome || 'este cartão')})"><i class="fas fa-trash"></i></button>
          </div>
        </div>

        <nav class="ct-nav" aria-label="Navegar entre faturas">
          <button class="ds-icon-btn" title="Fatura anterior" onclick="VMTerminalCartoes.mudarMes(-1)"><i class="fas fa-chevron-left"></i></button>
          <span class="ct-nav__lbl">${esc(MESES[(this._mes||1)-1])} <em>${this._ano}</em></span>
          <button class="ds-icon-btn" title="Próxima fatura" onclick="VMTerminalCartoes.mudarMes(1)"><i class="fas fa-chevron-right"></i></button>
          ${this._ehMesCorrente() ? '' : '<button class="ds-btn ds-btn--sm ds-btn--ghost" onclick="VMTerminalCartoes.irParaHoje()">Fatura atual</button>'}
        </nav>

        <div class="ct-totais">
          <div><span class="ds-kpi__lbl">Total da fatura</span><strong class="ds-kpi__val">${money(f.total)}</strong></div>
          <div><span class="ds-kpi__lbl">Pago</span><strong class="ds-kpi__val ds-kpi__val--ok">${money(f.total_pago)}</strong></div>
          <div><span class="ds-kpi__lbl">Em aberto</span><strong class="ds-kpi__val ds-kpi__val--warn">${money(f.total_pendente)}</strong></div>
        </div>

        ${itens.length ? `<div class="ds-tablewrap"><table class="ds-table ct-table">
          <thead><tr><th>Data</th><th>Descrição</th><th>Categoria</th><th>Parcela</th><th class="ds-num">Valor</th></tr></thead>
          <tbody>${itens.map(l => `<tr>
            <td class="ct-data">${dia(l.data_compra)}</td>
            <td class="ct-desc">${esc(String(l.descricao||'').replace(/\s*\(\d+\/\d+\)\s*$/,''))}</td>
            <td>${l.categoria ? `<span class="ds-pill">${esc(l.categoria)}</span>` : '<span class="ds-muted">—</span>'}</td>
            <td class="ds-mono ct-parc">${Number(l.total_parcelas)>1 ? `${l.parcela_atual}/${l.total_parcelas}` : '<span class="ds-muted">à vista</span>'}</td>
            <td class="ds-num">${money(l.valor)}</td>
          </tr>`).join('')}</tbody>
        </table></div>` : `<div class="ds-empty"><i class="fas fa-receipt"></i><p>Nenhum lançamento nesta fatura.</p></div>`}`
    },

    /** Rosca de gastos por categoria da fatura aberta. */
    _pintarCategorias(d) {
      const el = document.getElementById('ct-cats')
      if (!el) return
      const itens = d.lancamentos || []
      const mapa = {}
      for (const l of itens) { const k = l.categoria || 'Sem categoria'; mapa[k] = (mapa[k]||0) + (Number(l.valor)||0) }
      const cats = Object.entries(mapa).sort((a,b)=>b[1]-a[1]).slice(0,6)
      const total = cats.reduce((s,[,v])=>s+v,0)
      if (!total) { el.innerHTML = `<span class="ds-eyebrow">Gastos por categoria</span><div class="ds-empty"><i class="fas fa-chart-pie"></i><p>Sem lançamentos para distribuir.</p></div>`; return }
      const R=52, C=2*Math.PI*R
      let acc = 0
      const arcos = cats.map(([nome,v],i)=>{
        const frac = v/total, cor = PALETA[i%PALETA.length]
        const seg = `<circle cx="70" cy="70" r="${R}" fill="none" stroke="${cor}" stroke-width="18"
          stroke-dasharray="${(frac*C).toFixed(1)} ${(C-frac*C).toFixed(1)}"
          stroke-dashoffset="${(-acc*C).toFixed(1)}" transform="rotate(-90 70 70)"><title>${esc(nome)}: ${money(v)}</title></circle>`
        acc += frac
        return seg
      }).join('')
      el.innerHTML = `<span class="ds-eyebrow">Gastos por categoria</span>
        <div class="ct-donut">
          <svg viewBox="0 0 140 140" width="150" height="150" aria-hidden="true">
            <circle cx="70" cy="70" r="${R}" fill="none" stroke="var(--terminal-line)" stroke-width="18"/>
            ${arcos}
          </svg>
          <div class="ct-donut__c"><strong>${money(total)}</strong><small>na fatura</small></div>
        </div>
        <ul class="ct-legend">${cats.map(([nome,v],i)=>`<li>
          <i style="background:${PALETA[i%PALETA.length]}"></i><span>${esc(nome)}</span>
          <b class="ds-mono">${Math.round(v/total*100)}%</b><em class="ds-mono">${money(v)}</em>
        </li>`).join('')}</ul>`
    },

    /** Leitura automática da fatura — o "alerta inteligente" do layout. */
    _pintarAlerta(d) {
      const el = document.getElementById('ct-alerta')
      if (!el) return
      const c = d.cartao || {}, f = d.fatura || {}, itens = d.lancamentos || []
      const uso = Number(c.limite_total)>0 ? Math.round((Number(c.limite_utilizado)/Number(c.limite_total))*100) : 0
      const parceladas = itens.filter(l => Number(l.total_parcelas) > 1)
      const notas = []

      if (uso >= 70) notas.push(['warn','gauge-high',`Você já usa <strong>${uso}%</strong> do limite deste cartão. Acima de 70% o crédito começa a pesar na sua análise bancária.`])
      if (parceladas.length) {
        const soma = parceladas.reduce((s,l)=>s+(Number(l.valor)||0),0)
        notas.push(['info','layer-group',`<strong>${parceladas.length}</strong> parcela${parceladas.length===1?'':'s'} desta fatura ${parceladas.length===1?'vem':'vêm'} de compras parceladas, somando <strong>${money(soma)}</strong>.`])
      }
      const mapa = {}
      for (const l of itens) { const k = l.categoria || 'Sem categoria'; mapa[k] = (mapa[k]||0)+(Number(l.valor)||0) }
      const top = Object.entries(mapa).sort((a,b)=>b[1]-a[1])[0]
      if (top && f.total > 0) {
        const pct = Math.round(top[1]/f.total*100)
        if (pct >= 35) notas.push(['warn','chart-pie',`<strong>${esc(top[0])}</strong> concentra <strong>${pct}%</strong> desta fatura (${money(top[1])}).`])
      }
      if (f.status === 'paga') notas.push(['ok','circle-check','Fatura quitada. Nada em aberto neste cartão para o mês.'])
      else if (f.total_pendente > 0) notas.push(['ok','circle-info',`Faltam <strong>${money(f.total_pendente)}</strong> para fechar esta fatura.`])

      el.innerHTML = notas.length
        ? notas.map(([tom,ico,txt]) => `<div class="ds-note ds-note--${tom}"><i class="ds-note__ico fas fa-${ico}"></i><div>${txt}</div></div>`).join('')
        : ''
    },
  }
})()
