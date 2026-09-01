(function () {
  const esc = (v) => String(v ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;')
  const money = (v) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 2 }).format(Number(v) || 0)
  const shortMoney = (v) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', notation: 'compact', maximumFractionDigits: 1 }).format(Number(v) || 0)
  const PALETA = ['#3DDC84', '#F2C94C', '#8B5CF6', '#3B82F6', '#EC4899', '#F97316', '#06B6D4', '#84CC16']
  const corDe = (c, i) => (c && c !== '#000000' && c !== 'null') ? c : PALETA[i % PALETA.length]

  window.VMTerminalAnaliseCartoes = {
    _meses: 12, _cartao: '',
    _parcFiltro: { busca: '', cartao: '', categoria: '', status: '' },
    async render(vm) {
      this._vm = vm
      const content = document.getElementById('page-content')
      if (!content) return
      document.body.classList.add('terminal-dashboard-active')
      content.innerHTML = '<div class="td-loading"><span></span><span></span><span></span></div>'
      try {
        const q = `cartoes/analise?meses=${this._meses}${this._cartao ? `&cartao_id=${this._cartao}` : ''}`
        this._data = await vm.api('GET', q)
        this._paint()
      } catch (e) {
        content.innerHTML = `<div class="td-error"><i class="fas fa-triangle-exclamation"></i><h2>Não foi possível carregar a Análise</h2><p>${esc(e.response?.data?.error || 'Tente novamente.')}</p><button class="td-button td-button--primary" onclick="VM.pageAnaliseCartoes()">Tentar novamente</button></div>`
      }
    },
    reload() { this.render(this._vm) },

    _paint() {
      const content = document.getElementById('page-content')
      if (!content) return
      const d = this._data
      const r = d.resumo || {}
      const cartoes = d.cartoes || []
      const uso = d.uso_total || {}
      const serieFull = d.serie || []
      const firstIdx = serieFull.findIndex(s => s.total > 0 || s.lancamentos > 0)
      const serie = firstIdx >= 0 ? serieFull.slice(firstIdx) : []

      content.innerHTML = `<div class="td-dashboard ac">
        <header class="td-dashboard__header">
          <div>
            <span class="td-eyebrow">Cartões · leitura do histórico</span>
            <h1>Análise de cartões. <em>A fatura está subindo?</em></h1>
            <p>Como sua fatura evolui, quanto do limite você já usa e quanto dos próximos meses já comprometeu.</p>
          </div>
          <div class="td-dashboard__header-actions">
            <label class="ac-select"><span>Cartão</span><select onchange="VMTerminalAnaliseCartoes.setCartao(this.value)"><option value="">Todos</option>${cartoes.map(c => `<option value="${c.id}" ${String(this._cartao) === String(c.id) ? 'selected' : ''}>${esc(c.nome)}</option>`).join('')}</select></label>
            <label class="ac-select"><span>Período</span><select onchange="VMTerminalAnaliseCartoes.setMeses(this.value)">${[6, 12, 18, 24].map(m => `<option value="${m}" ${this._meses === m ? 'selected' : ''}>${m} meses</option>`).join('')}</select></label>
          </div>
        </header>

        <section class="tm-kpis" style="grid-template-columns:repeat(auto-fit,minmax(200px,1fr))">
          <article class="td-kpi"><span>Fatura atual</span><strong>${money(r.fatura_atual)}</strong><span class="td-kpi__delta td-kpi__delta--muted">média 6m ${money(r.media_6m)}</span></article>
          <article class="td-kpi"><span>Gasto em ${d.gasto_ano?.ano || ''}</span><strong>${money(d.gasto_ano?.total)}</strong><span class="td-kpi__delta td-kpi__delta--muted">${d.gasto_ano?.lancamentos || 0} lançamento${(d.gasto_ano?.lancamentos || 0) === 1 ? '' : 's'} no ano</span></article>
          <article class="td-kpi"><span>Limite total usado</span><strong>${uso.pct == null ? '—' : `${uso.pct}<small>%</small>`}</strong><span class="td-kpi__delta td-kpi__delta--muted">${money(uso.utilizado)} de ${money(uso.limite)}</span></article>
          <article class="td-kpi"><span>Já comprometido à frente</span><strong>${money(d.futuro?.total_comprometido)}</strong><span class="td-kpi__delta td-kpi__delta--muted">${(d.futuro?.meses || []).length} mês(es) com parcelas</span></article>
        </section>

        <section class="ac-uso">
          <article class="td-panel ac-gauge-panel">
            <div class="td-panel__head"><div><span class="td-eyebrow">Mostrador</span><h2>Limite usado — todos os cartões</h2></div></div>
            ${this._gauge(uso)}
          </article>
          <article class="td-panel">
            <div class="td-panel__head"><div><span class="td-eyebrow">Por cartão</span><h2>Quanto de cada limite você já usa</h2></div></div>
            ${this._usoPorCartao(d.cartoes_uso || [])}
          </article>
        </section>

        <section class="ac-chart-wrap">
          <article class="td-panel">
            <div class="td-panel__head"><div><span class="td-eyebrow">Evolução da fatura${!this._cartao && (d.por_cartao || []).length > 1 ? ' · empilhada por cartão' : ''}</span><h2>Últimos ${serie.length} meses</h2></div></div>
            ${this._chart(serie, d.por_cartao || [])}
          </article>
          <article class="td-panel ac-future">
            <div class="td-panel__head"><div><span class="td-eyebrow">Parcelas já contratadas</span><h2>Meses que ainda vão chegar</h2></div></div>
            ${(d.futuro?.meses || []).length ? `<div class="ac-future__list">${d.futuro.meses.map(f => `<div><span>${esc(f.label)}</span><b>${money(f.total)}</b></div>`).join('')}</div>${d.futuro.pior_mes ? `<p class="td-explainer"><i class="fas fa-circle-info"></i> Mês mais pesado: <b>${esc(d.futuro.pior_mes.label)}</b> com ${money(d.futuro.pior_mes.total)}.</p>` : ''}` : '<div class="td-empty-row"><i class="far fa-calendar-check"></i><span>Nenhuma parcela futura contratada.</span></div>'}
          </article>
        </section>

        <section class="ac-bottom">
          <article class="td-panel">
            <div class="td-panel__head"><div><span class="td-eyebrow">Este mês</span><h2>Por categoria</h2></div></div>
            ${(d.categorias_do_mes || []).length ? `<div class="ac-cats">${d.categorias_do_mes.map(c => `<div><span>${esc(c.categoria)}</span><b>${money(c.total)}</b><small>${c.qtd}×</small></div>`).join('')}</div>` : '<div class="td-empty-row"><i class="fas fa-tags"></i><span>Sem lançamentos categorizados este mês.</span></div>'}
          </article>
          <article class="td-panel">
            <div class="td-panel__head"><div><span class="td-eyebrow">Assinaturas fantasma</span><h2>Cobranças recorrentes</h2></div></div>
            ${(d.recorrentes || []).length ? `<div class="ac-rec">${d.recorrentes.map(r2 => `<div><span>${esc(r2.descricao)}</span><em>em ${r2.meses} meses</em><b>${money(r2.valor)}</b></div>`).join('')}</div>` : '<div class="td-empty-row"><i class="fas fa-ghost"></i><span>Nenhuma cobrança recorrente detectada.</span></div>'}
          </article>
        </section>

        ${this._parcSection(cartoes)}

        ${(d.leitura || []).length ? `<section class="ac-leitura">${d.leitura.map(l => `<p><i class="fas fa-lightbulb"></i> ${esc(l)}</p>`).join('')}</section>` : ''}
      </div>`

      this.loadParceladas()
    },

    _parcSection(cartoes) {
      const f = this._parcFiltro
      return `<section class="ac-parc">
        <article class="td-panel">
          <div class="td-panel__head"><div><span class="td-eyebrow">Cartões · compras parceladas</span><h2>Suas compras parceladas</h2></div><span class="td-chip" id="ac-parc-count">—</span></div>
          <div class="ac-parc-sum" id="ac-parc-sum"></div>
          <div class="ac-parc__filters">
            <div class="ac-parc__search"><i class="fas fa-search"></i><input id="ac-parc-busca" type="text" placeholder="Buscar compra…" value="${esc(f.busca)}" oninput="clearTimeout(VMTerminalAnaliseCartoes._pt);VMTerminalAnaliseCartoes._pt=setTimeout(()=>VMTerminalAnaliseCartoes.filtrarParceladas(),360)"></div>
            <select id="ac-parc-cartao" onchange="VMTerminalAnaliseCartoes.filtrarParceladas()">
              <option value="">Todos os cartões</option>
              ${(cartoes || []).map(c => `<option value="${c.id}" ${String(f.cartao) === String(c.id) ? 'selected' : ''}>${esc(c.nome)}</option>`).join('')}
            </select>
            <select id="ac-parc-cat" onchange="VMTerminalAnaliseCartoes.filtrarParceladas()"><option value="">Todas categorias</option></select>
            <select id="ac-parc-status" onchange="VMTerminalAnaliseCartoes.filtrarParceladas()">
              <option value="">Todas</option>
              <option value="andamento" ${f.status === 'andamento' ? 'selected' : ''}>Em andamento</option>
              <option value="quitada" ${f.status === 'quitada' ? 'selected' : ''}>Quitadas</option>
            </select>
          </div>
          <div class="ac-parc__wrap" id="ac-parc-body"><div class="td-loading"><span></span><span></span><span></span></div></div>
        </article>

        <article class="td-panel" style="margin-top:16px">
          <div class="td-panel__head"><div><span class="td-eyebrow">Compras parceladas · mês a mês</span><h2>Entraram × encerraram</h2></div><div class="ac-evo-legend"><span><i class="ac-evo-sw ac-evo-sw--in"></i>entram</span><span><i class="ac-evo-sw ac-evo-sw--out"></i>encerram</span></div></div>
          <div id="ac-parc-evo"><div class="td-loading"><span></span><span></span><span></span></div></div>
        </article>

        <section class="ac-leitura" id="ac-parc-insights"></section>
      </section>`
    },

    filtrarParceladas() {
      this._parcFiltro = {
        busca: document.getElementById('ac-parc-busca')?.value || '',
        cartao: document.getElementById('ac-parc-cartao')?.value || '',
        categoria: document.getElementById('ac-parc-cat')?.value || '',
        status: document.getElementById('ac-parc-status')?.value || '',
      }
      this.loadParceladas()
    },

    async loadParceladas() {
      const body = document.getElementById('ac-parc-body')
      if (!body) return
      const f = this._parcFiltro
      const p = new URLSearchParams()
      if (f.busca) p.set('busca', f.busca)
      if (f.cartao) p.set('cartao_id', f.cartao)
      if (f.categoria) p.set('categoria', f.categoria)
      if (f.status) p.set('status', f.status)
      try {
        const d = await this._vm.api('GET', `cartoes/parceladas${p.toString() ? '?' + p.toString() : ''}`)
        // popular categorias (uma vez)
        const catSel = document.getElementById('ac-parc-cat')
        if (catSel && catSel.options.length <= 1 && (d.categorias || []).length) {
          catSel.innerHTML = '<option value="">Todas categorias</option>' + d.categorias.map(cat => `<option value="${esc(cat)}" ${f.categoria === cat ? 'selected' : ''}>${esc(cat)}</option>`).join('')
        }
        const r = d.resumo || {}
        const cnt = document.getElementById('ac-parc-count')
        if (cnt) cnt.textContent = `${r.count || 0} compra${(r.count || 0) === 1 ? '' : 's'} · ${r.em_andamento || 0} em andamento`
        const sum = document.getElementById('ac-parc-sum')
        if (sum) {
          const pctPago = Number(r.total_compras) > 0 ? Math.round((Number(r.total_pago) / Number(r.total_compras)) * 100) : 0
          sum.innerHTML = `
            <div class="ac-sum-tile"><span class="ac-sum-lbl">Total das compras</span><strong>${money(r.total_compras)}</strong><small>${r.count || 0} compra${(r.count || 0) === 1 ? '' : 's'} parcelada${(r.count || 0) === 1 ? '' : 's'}</small></div>
            <div class="ac-sum-tile ac-sum-tile--ok"><span class="ac-sum-lbl">Já pago</span><strong>${money(r.total_pago)}</strong><small>${pctPago}% do total${r.quitadas ? ` · ${r.quitadas} quitada${r.quitadas === 1 ? '' : 's'}` : ''}</small>
              <div class="ac-sum-bar"><span style="width:${Math.min(100, pctPago)}%"></span></div></div>
            <div class="ac-sum-tile ac-sum-tile--warn"><span class="ac-sum-lbl">Falta pagar</span><strong>${money(r.total_restante)}</strong><small>${r.em_andamento || 0} em andamento</small></div>`
        }
        this._parcRows(d.compras || [], body)
        this._parcEvo(d.evolucao || [], d.mes_atual_idx)
        this._parcInsights(d)
      } catch (e) {
        body.innerHTML = `<div class="td-empty-row"><i class="fas fa-triangle-exclamation"></i><span>${esc(e.response?.data?.error || 'Erro ao carregar as compras parceladas.')}</span></div>`
      }
    },

    _parcEvo(evo, nowIdx) {
      const el = document.getElementById('ac-parc-evo')
      if (!el) return
      if (!evo.length) { el.innerHTML = '<div class="td-empty-row"><i class="fas fa-wave-square"></i><span>Sem parcelas para montar o evolutivo.</span></div>'; return }
      const maxV = Math.max(1, ...evo.flatMap(e => [e.entram.valor, e.saem.valor]))
      const rows = evo.map(e => {
        const isNow = e.idx === nowIdx
        const tone = e.saldo > 0.005 ? 'neg' : e.saldo < -0.005 ? 'ok' : 'muted'
        const eW = (e.entram.valor / maxV * 100), sW = (e.saem.valor / maxV * 100)
        return `<tr class="${isNow ? 'is-now' : ''}${e.futuro ? ' is-fut' : ''}">
          <td class="ac-evo-m">${esc(e.label)}${isNow ? ' <span class="ac-evo-tag">agora</span>' : e.futuro ? ' <span class="ac-evo-tag ac-evo-tag--fut">prev.</span>' : ''}</td>
          <td class="ac-evo-e">${e.entram.qtd ? `<b>${e.entram.qtd}</b> · ${money(e.entram.valor)}` : '<span class="ac-evo-dash">—</span>'}</td>
          <td class="ac-evo-s">${e.saem.qtd ? `<b>${e.saem.qtd}</b> · ${money(e.saem.valor)}` : '<span class="ac-evo-dash">—</span>'}</td>
          <td class="ac-evo-bar"><div class="ac-evo-track"><span class="ac-evo-in" style="width:${eW.toFixed(1)}%"></span><span class="ac-evo-out" style="width:${sW.toFixed(1)}%"></span></div></td>
          <td class="ac-evo-saldo ac-evo-saldo--${tone}">${e.saldo > 0.005 ? '+' : ''}${money(e.saldo)}</td>
        </tr>`
      }).join('')
      el.innerHTML = `<div class="ac-evo-wrap"><table class="ac-evo-table">
        <thead><tr><th>Mês</th><th>Novas compras</th><th>Encerraram</th><th>Fluxo</th><th class="ac-evo-saldo">Δ compromisso</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>
      <p class="td-explainer"><i class="fas fa-circle-info"></i> <b>Novas</b> = 1ª parcela de compras que entraram no mês. <b>Encerraram</b> = última parcela de compras que terminaram. <b>Δ</b> positivo = seu compromisso mensal de parcelas cresceu; negativo = aliviou.</p>`
    },

    _parcInsights(d) {
      const el = document.getElementById('ac-parc-insights')
      if (!el) return
      const evo = d.evolucao || [], r = d.resumo || {}, now = d.mes_atual_idx
      const compras = d.compras || []
      const ins = []
      const futSaem = evo.filter(e => e.idx >= now && e.saem.qtd > 0)
      if (futSaem.length) {
        const mx = futSaem.reduce((a, e) => e.saem.valor > a.saem.valor ? e : a, futSaem[0])
        ins.push(`Em <b>${esc(mx.label)}</b> encerram <b>${mx.saem.qtd}</b> parcela${mx.saem.qtd === 1 ? '' : 's'} somando <b>${money(mx.saem.valor)}/mês</b> — é quando sua fatura mais alivia.`)
      }
      if (Number(r.total_restante) > 0) {
        ins.push(`Ainda faltam <b>${money(r.total_restante)}</b> em <b>${r.em_andamento || 0}</b> compra${(r.em_andamento || 0) === 1 ? '' : 's'} parcelada${(r.em_andamento || 0) === 1 ? '' : 's'} em aberto.`)
      }
      const prox3 = evo.filter(e => e.idx >= now && e.idx < now + 3)
      if (prox3.length) {
        const s3 = prox3.reduce((s, e) => s + e.saldo, 0)
        if (s3 < -0.005) ins.push(`Nos próximos 3 meses encerram mais parcelas do que entram: seu compromisso mensal tende a cair <b>${money(Math.abs(s3))}</b>.`)
        else if (s3 > 0.005) ins.push(`Nos próximos 3 meses entram mais compras do que encerram (<b>+${money(s3)}/mês</b>) — atenção para não pesar a fatura.`)
      }
      const aberto = compras.filter(g => !g.quitada)
      if (aberto.length) {
        const mc = aberto.reduce((a, g) => (g.valor_restante || 0) > (a.valor_restante || 0) ? g : a, aberto[0])
        ins.push(`Sua maior compra em aberto é <b>${esc(mc.descricao)}</b> (${esc(mc.cartao_nome || '—')}): faltam <b>${money(mc.valor_restante)}</b> em ${mc.parcelas_restantes} parcela${mc.parcelas_restantes === 1 ? '' : 's'}.`)
      }
      // categoria que mais compromete em aberto
      const porCat = {}
      for (const g of aberto) { const k = g.categoria || 'Sem categoria'; porCat[k] = (porCat[k] || 0) + (g.valor_restante || 0) }
      const catArr = Object.entries(porCat).sort((a, b) => b[1] - a[1])
      if (catArr.length > 1 && catArr[0][1] > 0) {
        ins.push(`A categoria que mais pesa nas parcelas em aberto é <b>${esc(catArr[0][0])}</b>, com <b>${money(catArr[0][1])}</b> a pagar.`)
      }
      if (!ins.length) { el.innerHTML = ''; return }
      el.innerHTML = `<div class="ac-parc-ins__head"><span class="td-eyebrow"><i class="fas fa-lightbulb"></i> Insights das parcelas</span></div>${ins.map(t => `<p>${t}</p>`).join('')}`
    },

    _parcRows(compras, body) {
      if (!compras.length) {
        body.innerHTML = '<div class="td-empty-row"><i class="fas fa-layer-group"></i><span>Nenhuma compra parcelada com esse filtro.</span></div>'
        return
      }
      const rows = compras.map(g => {
        const cor = corDe(g.cartao_cor, 0)
        const pagas = g.parcelas_pagas || 0, tot = g.total_parcelas || 0
        const pct = tot > 0 ? Math.round((pagas / tot) * 100) : 0
        const tags = (g.tags || []).slice(0, 3).map(t => `<span class="ac-parc-tag" style="--tc:${corDe(t.cor, 1)}">${esc(t.nome)}</span>`).join('')
        const catLine = g.categoria ? `<span class="ac-parc-cat">${esc(g.categoria)}</span>` : ''
        return `<tr class="${g.quitada ? 'is-quit' : ''}">
          <td class="ac-parc-desc"><strong>${esc(g.descricao)}</strong>${g.encerra_em ? `<small>encerra em ${esc(g.encerra_em.label)}</small>` : ''}</td>
          <td class="ac-parc-card"><span class="ac-dot" style="background:${cor}"></span>${esc(g.cartao_nome || '—')}</td>
          <td class="ac-parc-tags">${catLine}${tags || (catLine ? '' : '<span class="ac-parc-muted">—</span>')}</td>
          <td class="ac-parc-num">${money(g.valor_parcela)}</td>
          <td class="ac-parc-prog">
            <div class="ac-parc-prog__top"><span>${pagas}/${tot}</span>${g.quitada ? '<span class="ac-parc-quit">quitada</span>' : `<span class="ac-parc-rest">faltam ${g.parcelas_restantes}</span>`}</div>
            <div class="to-bar" style="height:6px"><span style="width:${pct}%;background:${cor}"></span></div>
          </td>
          <td class="ac-parc-num ac-parc-total">${money(g.valor_total)}</td>
        </tr>`
      }).join('')
      body.innerHTML = `<div class="ac-parc__scroll"><table class="ac-parc-table">
        <thead><tr><th>Compra</th><th>Cartão</th><th>Categoria · Tags</th><th class="ac-parc-num">Parcela</th><th>Parcelas</th><th class="ac-parc-num">Total</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>`
    },

    // ── Mostrador circular do uso total ──
    _gauge(uso) {
      const pct = Number(uso.pct)
      if (uso.pct == null || !(Number(uso.limite) > 0)) return '<div class="td-empty-row"><i class="fas fa-gauge"></i><span>Defina o limite dos seus cartões para ver o mostrador.</span></div>'
      const cor = pct <= 30 ? 'var(--terminal-primary)' : pct <= 60 ? 'var(--terminal-accent)' : 'var(--terminal-negative)'
      const R = 54, C = 2 * Math.PI * R
      const off = C * (1 - Math.min(100, Math.max(0, pct)) / 100)
      const lbl = pct <= 30 ? 'dentro do saudável' : pct <= 60 ? 'atenção — acima de 30% pesa no crédito' : 'uso alto do limite'
      return `<div class="ac-gauge">
        <svg viewBox="0 0 130 130" width="150" height="150">
          <circle cx="65" cy="65" r="${R}" fill="none" stroke="var(--terminal-line)" stroke-width="12"/>
          <circle cx="65" cy="65" r="${R}" fill="none" stroke="${cor}" stroke-width="12" stroke-linecap="round" stroke-dasharray="${C.toFixed(1)}" stroke-dashoffset="${off.toFixed(1)}" transform="rotate(-90 65 65)"/>
          <text x="65" y="62" text-anchor="middle" font-size="30" font-weight="700" fill="var(--terminal-ink)" font-family="var(--terminal-font)">${pct}%</text>
          <text x="65" y="82" text-anchor="middle" font-size="9" fill="var(--terminal-ink-soft)" font-family="var(--terminal-mono)">usado</text>
        </svg>
        <div class="ac-gauge__side">
          <div class="ac-gauge__row"><span>Utilizado</span><b style="color:${cor}">${money(uso.utilizado)}</b></div>
          <div class="ac-gauge__row"><span>Disponível</span><b>${money(uso.disponivel)}</b></div>
          <div class="ac-gauge__row"><span>Limite total</span><b>${money(uso.limite)}</b></div>
          <p class="ac-gauge__note">${lbl}</p>
        </div>
      </div>`
    },

    // ── Barras de % por cartão ──
    _usoPorCartao(lista) {
      if (!lista.length) return '<div class="td-empty-row"><i class="fas fa-credit-card"></i><span>Nenhum cartão ativo.</span></div>'
      return `<div class="ac-usolist">${lista.map((c, i) => {
        const pct = c.uso_pct
        const cor = corDe(c.cor, i)
        const tone = pct == null ? '' : pct <= 30 ? 'ok' : pct <= 60 ? 'warn' : 'neg'
        return `<div class="ac-usorow">
          <div class="ac-usorow__top"><span class="ac-dot" style="background:${cor}"></span><strong>${esc(c.nome)}</strong><span class="ac-usorow__pct ac-usorow__pct--${tone}">${pct == null ? '—' : pct + '%'}</span></div>
          <div class="to-bar" style="height:8px"><span style="width:${Math.min(100, pct || 0)}%;background:${cor}"></span></div>
          <small class="ac-usorow__val">${money(c.utilizado)} de ${money(c.limite_total)}${Number(c.disponivel) > 0 ? ` · livre ${money(c.disponivel)}` : ''}</small>
        </div>`
      }).join('')}</div>`
    },

    // ── Gráfico de evolução: empilhado por cartão quando "Todos" ──
    _chart(serie, porCartao) {
      if (!serie.length) return '<div class="td-empty-row"><i class="fas fa-chart-column"></i><span>Sem histórico de fatura ainda.</span></div>'
      const totals = serie.map(s => s.total)
      const sorted = [...totals].sort((a, b) => b - a)
      const max = sorted[0] || 1, second = sorted[1] || 0
      const outlier = second > 0 && max > second * 2.5
      const scaleMax = (outlier ? second : max) * 1.12 || 1
      const stack = !this._cartao && porCartao.length > 1
      const cards = stack ? porCartao.map((c, i) => ({ ...c, _cor: corDe(c.cor, i) })) : []

      const cols = serie.map(s => {
        const isOut = outlier && s.total === max
        const hTot = Math.max(2, Math.min(100, (s.total / scaleMax) * 100))
        let inner
        if (stack && s.total > 0) {
          // segmentos proporcionais dentro da barra do mês
          inner = cards.map(c => {
            const v = Number(c.meses?.[s.chave] || 0)
            if (v <= 0) return ''
            const seg = (v / s.total) * 100
            return `<i class="ac-seg" style="height:${seg}%;background:${c._cor}" title="${esc(c.nome)}: ${money(v)}"></i>`
          }).join('')
        } else {
          inner = isOut ? '<i class="fas fa-bolt" title="fora de escala"></i>' : ''
        }
        const up = s.variacao_pct != null && s.variacao_pct > 0
        return `<div class="ac-chart__col" title="${esc(s.label)}: ${money(s.total)}${s.variacao_pct != null ? ` (${up ? '+' : ''}${s.variacao_pct}%)` : ''}">
          <div class="ac-chart__bar"><span class="${isOut && !stack ? 'is-out' : ''} ${stack ? 'is-stack' : ''}" style="height:${hTot}%">${inner}</span></div>
          <small class="ac-chart__val">${shortMoney(s.total)}</small>
          <small class="ac-chart__lbl">${esc(s.label)}</small>
        </div>`
      }).join('')

      const legenda = stack ? `<div class="ac-legend">${cards.map(c => `<span><i style="background:${c._cor}"></i>${esc(c.nome)}</span>`).join('')}</div>` : ''
      const nota = outlier && !stack ? '<p class="td-explainer"><i class="fas fa-bolt"></i> Um mês fora de escala foi limitado para não achatar os demais.</p>' : ''
      return `<div class="ac-chart">${cols}</div>${legenda}${nota}`
    },

    setMeses(m) { this._meses = Number(m) || 12; this.reload() },
    setCartao(c) { this._cartao = c || ''; this.reload() }
  }
})()
