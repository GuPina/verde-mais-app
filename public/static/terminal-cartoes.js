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
            <button class="ds-btn ds-btn--primary" onclick="VM.modalCartao()"><i class="fas fa-plus"></i> Novo cartão</button>
          </div>
        </header>

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
          </div>
        </div>

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
