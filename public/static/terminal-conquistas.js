/**
 * VerdeMais — Conquistas
 * ============================================================================
 * O catálogo tem 213 conquistas. Uma grade única com 213 cartões não é uma
 * tela, é um paredão: ninguém encontra o que está perto de ganhar, e o que
 * era para puxar o uso do app vira ruído.
 *
 * A tela responde três perguntas, nessa ordem: onde eu estou (nível e
 * pontos), o que está ao meu alcance agora (as mais próximas), e onde estão
 * as minhas lacunas (progresso por categoria). Só depois vem a lista, e ela
 * vem filtrável.
 */
(function () {
  const esc = (v) => String(v ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;')
  const RAR = {
    comum:    { rot: 'Comum',    cor: 'var(--terminal-ink-soft)' },
    raro:     { rot: 'Raro',     cor: '#6EA8FE' },
    epico:    { rot: 'Épico',    cor: '#B58AF4' },
    lendario: { rot: 'Lendário', cor: 'var(--terminal-accent)' },
  }
  const rarDe = (v) => RAR[String(v || '').toLowerCase().replace('á', 'a').replace('é', 'e')] || RAR.comum

  // As categorias vieram de dezoito migrations diferentes ao longo de dois
  // anos, com singular e plural convivendo ('habito'/'habitos'). Agrupar por
  // string crua criaria abas duplicadas.
  const CATS = {
    geral:          { rot: 'Geral',          ico: 'fa-star' },
    financas:       { rot: 'Dia a dia',      ico: 'fa-wallet' },
    despesas:       { rot: 'Dia a dia',      ico: 'fa-wallet' },
    receitas:       { rot: 'Receitas',       ico: 'fa-arrow-up' },
    metas:          { rot: 'Metas',          ico: 'fa-bullseye' },
    investimentos:  { rot: 'Investimentos',  ico: 'fa-chart-line' },
    patrimonio:     { rot: 'Patrimônio',     ico: 'fa-house' },
    cartoes:        { rot: 'Cartões',        ico: 'fa-credit-card' },
    dividas:        { rot: 'Dívidas',        ico: 'fa-file-invoice-dollar' },
    financiamentos: { rot: 'Dívidas',        ico: 'fa-file-invoice-dollar' },
    emprestimos:    { rot: 'Dívidas',        ico: 'fa-file-invoice-dollar' },
    reservas:       { rot: 'Reservas',       ico: 'fa-shield-halved' },
    orcamentos:     { rot: 'Orçamentos',     ico: 'fa-chart-pie' },
    orcamento:      { rot: 'Orçamentos',     ico: 'fa-chart-pie' },
    habito:         { rot: 'Hábitos',        ico: 'fa-fire' },
    habitos:        { rot: 'Hábitos',        ico: 'fa-fire' },
    engajamento:    { rot: 'Hábitos',        ico: 'fa-fire' },
    lembretes:      { rot: 'Hábitos',        ico: 'fa-fire' },
    recorrencias:   { rot: 'Hábitos',        ico: 'fa-fire' },
    assinaturas:    { rot: 'Assinaturas',    ico: 'fa-repeat' },
    desafio:        { rot: 'Desafio 52',     ico: 'fa-calendar-check' },
    saude:          { rot: 'Saúde financeira', ico: 'fa-heart-pulse' },
    analises:       { rot: 'Saúde financeira', ico: 'fa-heart-pulse' },
    perfil:         { rot: 'Saúde financeira', ico: 'fa-heart-pulse' },
    marco:          { rot: 'Marcos',         ico: 'fa-trophy' },
  }
  const catDe = (v) => CATS[String(v || '').toLowerCase()] || CATS.geral

  /**
   * Níveis por pontos. Os cortes vêm do catálogo real, não de números
   * redondos: 207 conquistas somam 14.535 pontos, e cada faixa corresponde
   * a mais ou menos 10%, 25%, 40%, 55%, 70% e 85% do catálogo pelas
   * conquistas mais baratas. Assim o segundo nível chega cedo — antes de a
   * pessoa desistir de procurar — e o último continua sendo raro de ver.
   */
  const NIVEIS = [
    { min: 0,     nome: 'Iniciante' },
    { min: 300,   nome: 'Organizado' },
    { min: 1000,  nome: 'Disciplinado' },
    { min: 1950,  nome: 'Estrategista' },
    { min: 3250,  nome: 'Investidor' },
    { min: 5000,  nome: 'Patrimonialista' },
    { min: 7600,  nome: 'Mestre das Finanças' },
  ]

  window.VMTerminalConquistas = {
    _busca: '',
    _cat: 'todas',
    _so: 'todas',

    async render(vm) {
      this._vm = vm
      const content = document.getElementById('page-content')
      if (!content) return
      document.body.classList.add('terminal-dashboard-active')
      content.innerHTML = '<div class="td-loading"><span></span><span></span><span></span></div>'
      try {
        this._d = await vm.api('GET', 'conquistas')
        this._paint()
        vm.api('PATCH', 'conquistas/visualizar').catch(() => {})
      } catch (e) {
        content.innerHTML = `<div class="td-error"><i class="fas fa-triangle-exclamation"></i><h2>Não foi possível carregar as conquistas</h2><p>${esc(e.response?.data?.error || 'Tente novamente.')}</p><button class="ds-btn ds-btn--primary" onclick="VMTerminalConquistas.reload()">Tentar novamente</button></div>`
      }
    },
    reload() { this.render(this._vm) },

    /** Reprocessa o histórico: destrava o que a pessoa já fez antes da regra existir. */
    async reprocessar() {
      const vm = this._vm
      const btn = document.getElementById('cq-reproc')
      if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Verificando…' }
      const r = await vm.api('POST', 'conquistas/reprocessar', {}).catch(e => ({ error: e.response?.data?.error }))
      if (r?.success) {
        vm.toast(r.mensagem || 'Conquistas atualizadas.', r.novas_desbloqueadas ? 'success' : 'info')
        this.reload()
      } else {
        vm.toast(r?.error || 'Não foi possível verificar.', 'error')
        if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-rotate"></i> Reprocessar' }
      }
    },

    setBusca(v) { this._busca = String(v || '').toLowerCase(); this._pintarLista() },
    setCat(c) { this._cat = c; this._paint() },
    setSo(v) { this._so = v; this._paint() },

    _lista() { return this._d?.conquistas || [] },

    _paint() {
      const content = document.getElementById('page-content')
      if (!content) return
      const d = this._d
      const list = this._lista()
      const feitas = Number(d.total_conquistadas) || list.filter(c => c.conquistada).length
      const total = Number(d.total_disponivel) || list.length
      const pontos = Number(d.total_pontos) || 0

      content.innerHTML = `<div class="td-dashboard cq">
        <header class="td-dashboard__header">
          <div>
            <span class="td-eyebrow">Cada passo conta</span>
            <h1>Conquistas. <em>Seu progresso, recompensado.</em></h1>
            <p>Metas batidas, hábitos criados, dívidas quitadas — o VerdeMais celebra cada avanço seu.</p>
          </div>
          <div class="td-dashboard__header-actions">
            <button id="cq-reproc" class="ds-btn" onclick="VMTerminalConquistas.reprocessar()" title="Confere seu histórico e destrava o que você já fez"><i class="fas fa-rotate"></i> Reprocessar</button>
          </div>
        </header>

        ${this._hero(pontos, feitas, total)}
        ${this._quaseLa()}
        ${this._porCategoria()}
        ${this._filtros()}
        <div id="cq-lista"></div>
      </div>`
      this._pintarLista()
    },

    // ── nível e pontos ───────────────────────────────────────────────────────
    _hero(pontos, feitas, total) {
      let i = 0
      while (i + 1 < NIVEIS.length && pontos >= NIVEIS[i + 1].min) i++
      const atual = NIVEIS[i], prox = NIVEIS[i + 1] || null
      const base = atual.min
      const alvo = prox ? prox.min : base
      const pctNivel = prox ? Math.min(100, ((pontos - base) / (alvo - base)) * 100) : 100
      const pctTotal = total > 0 ? Math.round((feitas / total) * 100) : 0
      const dash = 2 * Math.PI * 52, off = dash * (1 - pctNivel / 100)

      return `<section class="cq-hero">
        <article class="cq-nivel">
          <div class="cq-nivel__ring">
            <svg viewBox="0 0 120 120" width="128" height="128" aria-hidden="true">
              <circle cx="60" cy="60" r="52" fill="none" stroke="var(--terminal-line)" stroke-width="9"/>
              <circle cx="60" cy="60" r="52" fill="none" stroke="var(--terminal-accent)" stroke-width="9" stroke-linecap="round"
                stroke-dasharray="${dash.toFixed(1)}" stroke-dashoffset="${off.toFixed(1)}" transform="rotate(-90 60 60)"/>
              <text x="60" y="56" text-anchor="middle" font-size="26" font-weight="700" fill="var(--terminal-ink)" font-family="var(--terminal-font)">${i + 1}</text>
              <text x="60" y="75" text-anchor="middle" font-size="9" fill="var(--terminal-ink-soft)" font-family="var(--terminal-mono)">NÍVEL</text>
            </svg>
          </div>
          <div class="cq-nivel__side">
            <span class="td-eyebrow">Seu nível</span>
            <h2>${atual.nome}</h2>
            <p>${pontos} pontos acumulados</p>
            ${prox
              ? `<div class="cq-nivel__prox">
                   <div class="ds-bar"><span style="width:${pctNivel}%;background:var(--terminal-accent)"></span></div>
                   <small>Faltam <b>${alvo - pontos} pontos</b> para <b>${prox.nome}</b></small>
                 </div>`
              : '<div class="cq-nivel__prox"><small>Nível máximo alcançado. Não sobrou conquista nenhuma na sua frente.</small></div>'}
          </div>
        </article>

        <article class="td-panel">
          <div class="td-panel__head"><div><span class="td-eyebrow">Coleção</span><h2>Quanto do catálogo você já tem</h2></div></div>
          <div class="cq-col">
            <div class="cq-col__num"><strong>${feitas}</strong><em>de ${total}</em></div>
            <div class="ds-bar ds-bar--lg"><span style="width:${pctTotal}%"></span></div>
            <small>${pctTotal}% do catálogo desbloqueado</small>
          </div>
          <div class="cq-rar-strip">
            ${Object.entries(RAR).map(([k, v]) => {
              const dessa = this._lista().filter(c => rarDe(c.raridade) === v)
              if (!dessa.length) return ''
              const ok = dessa.filter(c => c.conquistada).length
              return `<div><small style="color:${v.cor}">${v.rot}</small><b>${ok}<em>/${dessa.length}</em></b></div>`
            }).join('')}
          </div>
        </article>
      </section>`
    },

    // ── o que está ao alcance ────────────────────────────────────────────────
    _quaseLa() {
      const perto = this._lista()
        .filter(c => !c.conquistada && c.progresso && c.progresso.total > 0 && c.progresso.pct > 0)
        .sort((a, b) => b.progresso.pct - a.progresso.pct)
        .slice(0, 3)
      if (!perto.length) return ''
      return `<article class="td-panel cq-quase">
        <div class="td-panel__head"><div><span class="td-eyebrow">Ao seu alcance</span><h2>Quase lá</h2></div></div>
        <div class="cq-quase__grid">
          ${perto.map(c => `<div class="cq-quase__item">
            <span class="cq-quase__ic">${esc(c.icone || '🏆')}</span>
            <div>
              <strong>${esc(c.titulo || c.codigo)}</strong>
              <small>${esc(c.descricao || '')}</small>
              <div class="ds-bar"><span style="width:${Math.min(100, c.progresso.pct)}%;background:var(--terminal-accent)"></span></div>
              <em>${c.progresso.atual} de ${c.progresso.total} · +${c.pontos} pts</em>
            </div>
          </div>`).join('')}
        </div>
      </article>`
    },

    // ── onde estão as lacunas ────────────────────────────────────────────────
    _porCategoria() {
      const mapa = new Map()
      for (const c of this._lista()) {
        const cat = catDe(c.categoria)
        const cur = mapa.get(cat.rot) || { rot: cat.rot, ico: cat.ico, total: 0, ok: 0 }
        cur.total++
        if (c.conquistada) cur.ok++
        mapa.set(cat.rot, cur)
      }
      const linhas = [...mapa.values()].sort((a, b) => (b.ok / b.total) - (a.ok / a.total) || b.total - a.total)
      if (!linhas.length) return ''
      return `<article class="td-panel cq-cats">
        <div class="td-panel__head"><div><span class="td-eyebrow">Onde você está forte, onde está parado</span><h2>Progresso por área</h2></div></div>
        <div class="cq-cats__grid">
          ${linhas.map(l => {
            const pct = Math.round((l.ok / l.total) * 100)
            const cls = pct >= 70 ? '' : pct >= 30 ? 'is-warn' : 'is-neg'
            return `<button class="cq-cat" onclick="VMTerminalConquistas.setCat('${esc(l.rot)}')" title="Ver só ${esc(l.rot)}">
              <span class="cq-cat__top"><i class="fas ${l.ico}"></i> ${esc(l.rot)}<em>${l.ok}/${l.total}</em></span>
              <div class="ds-bar"><span class="${cls}" style="width:${pct}%"></span></div>
            </button>`
          }).join('')}
        </div>
      </article>`
    },

    _filtros() {
      const cats = ['todas', ...new Set(this._lista().map(c => catDe(c.categoria).rot))]
      const st = 'background:var(--terminal-bg);border:1px solid var(--terminal-line);color:var(--terminal-ink);border-radius:var(--terminal-radius-sm);padding:9px 12px;font-size:13px;font-family:var(--terminal-font)'
      return `<div class="cq-filtros">
        <div class="cq-busca">
          <i class="fas fa-magnifying-glass"></i>
          <input type="search" placeholder="Buscar conquista…" value="${esc(this._busca)}" oninput="VMTerminalConquistas.setBusca(this.value)">
        </div>
        <select style="${st}" onchange="VMTerminalConquistas.setCat(this.value)">
          ${cats.map(c => `<option value="${esc(c)}" ${c === this._cat ? 'selected' : ''}>${c === 'todas' ? 'Todas as áreas' : esc(c)}</option>`).join('')}
        </select>
        <div class="cq-seg">
          ${[['todas', 'Todas'], ['bloqueadas', 'Bloqueadas'], ['ganhas', 'Conquistadas']].map(([v, r]) =>
            `<button class="${this._so === v ? 'is-on' : ''}" onclick="VMTerminalConquistas.setSo('${v}')">${r}</button>`).join('')}
        </div>
      </div>`
    },

    _pintarLista() {
      const el = document.getElementById('cq-lista')
      if (!el) return
      let list = this._lista().slice()
      if (this._cat !== 'todas') list = list.filter(c => catDe(c.categoria).rot === this._cat)
      if (this._so === 'ganhas') list = list.filter(c => c.conquistada)
      if (this._so === 'bloqueadas') list = list.filter(c => !c.conquistada)
      if (this._busca) {
        const b = this._busca
        list = list.filter(c => `${c.titulo || ''} ${c.descricao || ''}`.toLowerCase().includes(b))
      }
      // Conquistada primeiro dentro de "todas" seria enterrar o que falta:
      // a ordem útil é o que está perto, depois o que vale mais.
      list.sort((a, b) => {
        if (!!a.conquistada !== !!b.conquistada) return a.conquistada ? 1 : -1
        const pa = a.progresso?.pct || 0, pb = b.progresso?.pct || 0
        return pb - pa || (b.pontos || 0) - (a.pontos || 0)
      })
      el.innerHTML = list.length
        ? `<div class="cq-grid">${list.map(c => this._card(c)).join('')}</div>`
        : '<div class="ds-empty"><i class="fas fa-magnifying-glass"></i><p>Nenhuma conquista com esses filtros.</p></div>'
    },

    _card(c) {
      const on = !!c.conquistada
      const prog = c.progresso
      const rar = rarDe(c.raridade)
      const cat = catDe(c.categoria)
      return `<article class="cq-card ${on ? 'cq-card--on' : 'cq-card--off'}" style="--rar:${rar.cor}">
        <div class="cq-card__ic">${esc(c.icone || '🏆')}</div>
        <div class="cq-card__body">
          <div class="cq-card__top"><strong>${esc(c.titulo || c.codigo)}</strong><span class="cq-pts">+${Number(c.pontos) || 0}</span></div>
          <p>${esc(c.descricao || '')}</p>
          ${!on && prog && prog.total ? `<div class="cq-prog"><div class="ds-bar"><span style="width:${Math.min(100, prog.pct || 0)}%;background:var(--terminal-accent)"></span></div><small>${prog.atual}/${prog.total}</small></div>` : ''}
          <div class="cq-card__foot">
            <span class="cq-rar" style="color:${rar.cor};border-color:${rar.cor}55">${rar.rot}</span>
            <span class="cq-cat-tag"><i class="fas ${cat.ico}"></i> ${esc(cat.rot)}</span>
            ${on ? '<span class="cq-done"><i class="fas fa-check"></i></span>' : '<span class="cq-lock"><i class="fas fa-lock"></i></span>'}
          </div>
        </div>
      </article>`
    },
  }
})()
