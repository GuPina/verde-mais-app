/**
 * VerdeMais — Investimentos & Patrimônio
 * ============================================================================
 * A tela antiga só sabia da carteira. Mas o patrimônio de quem usa o app não
 * é só o que rende: é o carro, o apartamento, o equipamento de trabalho — e é
 * também o financiamento que ainda pesa em cima desses bens. Esta tela junta
 * as três pontas (financeiro, material e dívida) e só então mostra o que de
 * fato é do usuário.
 *
 * A carteira continua sendo desenhada por VMTerminalInvestimentos; aqui ela
 * entra como uma aba, sem duplicar código.
 */
(function () {
  const esc = (v) => String(v ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;')
  const money = (v) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 2 }).format(Number(v) || 0)
  const short = (v) => {
    const n = Math.abs(Number(v) || 0)
    if (n >= 1e6) return `${(Number(v) / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace('.', ',')} mi`
    if (n >= 1e4) return `${(Number(v) / 1e3).toFixed(0)} mil`
    return money(v)
  }
  const pct = (v) => `${Number(v) >= 0 ? '+' : ''}${(Number(v) || 0).toFixed(1).replace('.', ',')}%`
  const dataBR = (d) => (d ? String(d).slice(0, 10).split('-').reverse().join('/') : '—')

  const TIPOS = {
    imovel:      { rot: 'Imóvel',      ico: 'fa-house',            cor: '#3DDC84' },
    veiculo:     { rot: 'Veículo',     ico: 'fa-car',              cor: '#6EA8FE' },
    equipamento: { rot: 'Equipamento', ico: 'fa-laptop',           cor: '#F2C94C' },
    joia:        { rot: 'Joia',        ico: 'fa-gem',              cor: '#B58AF4' },
    colecao:     { rot: 'Coleção',     ico: 'fa-box-archive',      cor: '#FF8C69' },
    outros:      { rot: 'Outros',      ico: 'fa-cube',             cor: '#8BA397' },
  }
  const LIQ = {
    alta:  { rot: 'Alta',  cls: 'ds-pill--ok',   dica: 'Vira dinheiro em dias' },
    media: { rot: 'Média', cls: 'ds-pill--warn', dica: 'Vira dinheiro em semanas' },
    baixa: { rot: 'Baixa', cls: 'ds-pill--neg',  dica: 'Pode levar meses para vender' },
  }
  const tipoDe = (t) => TIPOS[t] || TIPOS.outros

  window.VMTerminalPatrimonio = {
    _aba: 'carteira',

    async render(vm) {
      this._vm = vm
      if (window.VMTerminalInvestimentos) window.VMTerminalInvestimentos._vm = vm
      const content = document.getElementById('page-content')
      if (!content) return
      document.body.classList.add('terminal-dashboard-active')
      content.innerHTML = '<div class="td-loading"><span></span><span></span><span></span></div>'
      try {
        const [inv, pat] = await Promise.all([
          vm.api('GET', 'investimentos'),
          // Se o endpoint de bens falhar, a carteira ainda tem que aparecer.
          vm.api('GET', 'bens').catch(() => ({ bens: [], resumo: {}, por_tipo: [] })),
        ])
        if (window.VMTerminalInvestimentos) {
          window.VMTerminalInvestimentos._cache = inv.investimentos || []
          window.VMTerminalInvestimentos._resumo = inv.resumo || {}
          window.VMTerminalInvestimentos._cdi = inv.cdi_atual
        }
        this._inv = inv
        this._bens = pat.bens || []
        this._resumo = pat.resumo || {}
        this._paint()
      } catch (e) {
        content.innerHTML = `<div class="td-error"><i class="fas fa-triangle-exclamation"></i><h2>Não foi possível carregar seu patrimônio</h2><p>${esc(e.response?.data?.error || 'Tente novamente.')}</p><button class="ds-btn ds-btn--primary" onclick="VM.pageInvestimentos()">Tentar novamente</button></div>`
      }
    },

    reload() { this.render(this._vm) },
    setAba(a) { this._aba = a; this._paint() },

    // ── shell ────────────────────────────────────────────────────────────────
    _paint() {
      const content = document.getElementById('page-content')
      if (!content) return
      const r = this._resumo || {}
      const carteira = (this._inv?.investimentos || []).length
      const bens = this._bens.length

      content.innerHTML = `<div class="td-dashboard ti tp">
        <header class="td-dashboard__header">
          <div>
            <span class="td-eyebrow">Patrimônio consolidado</span>
            <h1>Investimentos & Patrimônio. <em>Tudo que é seu, somado.</em></h1>
            <p>O que rende, o que você conquistou e o que ainda deve — para saber o que sobra de fato.</p>
          </div>
          <div class="td-dashboard__header-actions">
            <button class="ds-btn ds-btn--primary" onclick="VMTerminalInvestimentos.novo()"><i class="fas fa-chart-line"></i> Novo aporte</button>
            <button class="ds-btn" onclick="VMTerminalPatrimonio.novoBem()"><i class="fas fa-plus"></i> Novo bem</button>
          </div>
        </header>

        ${this._hero(r)}
        ${this._kpis(r)}
        ${this._insights(r)}

        <nav class="tp-tabs" role="tablist">
          <button class="tp-tab ${this._aba === 'carteira' ? 'is-on' : ''}" onclick="VMTerminalPatrimonio.setAba('carteira')"><i class="fas fa-chart-line"></i> Carteira <em>${carteira}</em></button>
          <button class="tp-tab ${this._aba === 'bens' ? 'is-on' : ''}" onclick="VMTerminalPatrimonio.setAba('bens')"><i class="fas fa-house"></i> Bens materiais <em>${bens}</em></button>
        </nav>

        <div id="tp-body">${this._aba === 'bens' ? this._abaBens() : this._abaCarteira()}</div>
      </div>`
    },

    // ── patrimônio líquido + composição ──────────────────────────────────────
    _hero(r) {
      const bruto = Number(r.patrimonio_bruto || 0)
      const liquido = Number(r.patrimonio_liquido || 0)
      const dividas = Number(r.dividas || 0)
      const fin = Number(r.financeiro || 0)
      const mat = Number(r.total_bens || 0)
      const pMat = bruto > 0 ? (mat / bruto) * 100 : 0
      const pFin = bruto > 0 ? (fin / bruto) * 100 : 0
      // A barra compara tudo contra o bruto: a dívida aparece como o pedaço do
      // patrimônio que ainda é do banco, não como um número solto.
      const pDiv = bruto > 0 ? Math.min(100, (dividas / bruto) * 100) : 0

      const linhas = [
        { rot: 'Investimentos',  val: Number(r.investimentos || 0), cor: 'var(--terminal-primary)', ico: 'fa-chart-line' },
        { rot: 'Reservas',       val: Number(r.reservas || 0),      cor: '#5AD1C4',                 ico: 'fa-shield-halved' },
        { rot: 'Bens materiais', val: mat,                          cor: '#6EA8FE',                 ico: 'fa-house' },
        { rot: 'Dívidas',        val: -dividas,                     cor: 'var(--terminal-negative)', ico: 'fa-file-invoice-dollar' },
      ]
      const maior = Math.max(1, ...linhas.map(l => Math.abs(l.val)))

      return `<section class="ti-top">
        <article class="ti-patrimony">
          <div class="td-patrimony__top">
            <span class="td-eyebrow">Patrimônio líquido</span>
            <span class="td-chip"><i class="fas fa-scale-balanced"></i> bruto − dívidas</span>
          </div>
          <strong style="${liquido < 0 ? 'color:var(--terminal-negative)' : ''}">${money(liquido)}</strong>
          <div class="tp-hero__split">
            <div><small>Patrimônio bruto</small><b>${money(bruto)}</b></div>
            <div><small>Dívidas em aberto</small><b class="is-neg">${dividas > 0 ? '−' : ''}${money(dividas)}</b></div>
          </div>
          <div class="tp-mix">
            <div class="tp-mix__bar">
              <span style="width:${pFin}%;background:var(--terminal-primary)" title="Financeiro: ${money(fin)}"></span>
              <span style="width:${pMat}%;background:#6EA8FE" title="Material: ${money(mat)}"></span>
            </div>
            ${pDiv > 0 ? `<div class="tp-mix__debt" title="Dívidas: ${money(dividas)}"><span style="width:${pDiv}%"></span></div>` : ''}
            <div class="tp-mix__legend">
              <span><i style="background:var(--terminal-primary)"></i> Financeiro ${Math.round(pFin)}%</span>
              <span><i style="background:#6EA8FE"></i> Material ${Math.round(pMat)}%</span>
              ${pDiv > 0 ? `<span><i style="background:var(--terminal-negative)"></i> ${Math.round(pDiv)}% comprometido com dívida</span>` : ''}
            </div>
          </div>
          <div class="ti-invested">
            <small><i class="fas fa-bolt"></i> Liquidez rápida — o que vira dinheiro em dias</small>
            <b>${money(r.liquido_rapido)}</b>
          </div>
        </article>

        <article class="td-panel">
          <div class="td-panel__head"><div><span class="td-eyebrow">Composição</span><h2>De onde vem o seu patrimônio</h2></div></div>
          <div class="tp-comp">
            ${linhas.map(l => `
              <div class="tp-comp__row">
                <span class="tp-comp__rot"><i class="fas ${l.ico}" style="color:${l.cor}"></i> ${l.rot}</span>
                <div class="ds-bar"><span style="width:${(Math.abs(l.val) / maior) * 100}%;background:${l.cor}"></span></div>
                <b class="tp-comp__val" style="${l.val < 0 ? 'color:var(--terminal-negative)' : ''}">${l.val < 0 ? '−' : ''}${money(Math.abs(l.val))}</b>
              </div>`).join('')}
            <div class="tp-comp__row tp-comp__row--total">
              <span class="tp-comp__rot"><i class="fas fa-equals"></i> Patrimônio líquido</span>
              <div></div>
              <b class="tp-comp__val" style="${liquido < 0 ? 'color:var(--terminal-negative)' : 'color:var(--terminal-primary)'}">${money(liquido)}</b>
            </div>
          </div>
        </article>
      </section>`
    },

    _kpis(r) {
      const valoriz = Number(r.valorizacao || 0)
      const rentab = Number(this._inv?.resumo?.rentabilidade_total || 0)
      const bruto = Number(r.patrimonio_bruto || 0)
      const dividas = Number(r.dividas || 0)
      const alav = bruto > 0 ? (dividas / bruto) * 100 : 0
      return `<div class="ds-kpi-grid" style="margin:0 0 16px">
        <article class="ds-kpi">
          <span class="ds-kpi__lbl">Carteira investida</span>
          <b class="ds-kpi__val">${short(r.investimentos)}</b>
          <span class="ds-kpi__hint ${rentab >= 0 ? '' : ''}">${(this._inv?.investimentos || []).length} ativo(s) · ${pct(rentab)}</span>
        </article>
        <article class="ds-kpi">
          <span class="ds-kpi__lbl">Reservas</span>
          <b class="ds-kpi__val">${short(r.reservas)}</b>
          <span class="ds-kpi__hint">Emergência + reservas específicas</span>
        </article>
        <article class="ds-kpi">
          <span class="ds-kpi__lbl">Bens materiais</span>
          <b class="ds-kpi__val">${short(r.total_bens)}</b>
          <span class="ds-kpi__hint" style="color:${valoriz >= 0 ? 'var(--terminal-primary)' : 'var(--terminal-negative)'}">${valoriz >= 0 ? '▲' : '▼'} ${money(Math.abs(valoriz))} vs. compra</span>
        </article>
        <article class="ds-kpi">
          <span class="ds-kpi__lbl">Dívidas</span>
          <b class="ds-kpi__val ${dividas > 0 ? 'ds-kpi__val--neg' : ''}">${short(dividas)}</b>
          <span class="ds-kpi__hint">${alav.toFixed(0)}% do patrimônio bruto</span>
        </article>
      </div>`
    },

    // ── leituras ─────────────────────────────────────────────────────────────
    _insights(r) {
      const notas = []
      const bruto = Number(r.patrimonio_bruto || 0)
      const dividas = Number(r.dividas || 0)
      const fin = Number(r.financeiro || 0)
      const mat = Number(r.total_bens || 0)
      const pMat = Number(r.pct_material || 0)

      if (bruto <= 0 && dividas <= 0) {
        notas.push({ t: 'info', ico: 'fa-seedling', txt: '<strong>Seu patrimônio começa aqui.</strong> Cadastre seus investimentos e os bens que já conquistou para ver o número real.' })
      }
      if (pMat >= 70 && mat > 0) {
        notas.push({ t: 'warn', ico: 'fa-house', txt: `<strong>${pMat}% do seu patrimônio está em bens materiais.</strong> Bem não paga conta: se precisar de dinheiro rápido, você depende de vender. Vale reforçar a parte financeira.` })
      } else if (pMat > 0 && pMat <= 25 && fin > 0) {
        notas.push({ t: 'ok', ico: 'fa-scale-balanced', txt: `<strong>Composição saudável.</strong> ${100 - pMat}% do patrimônio está em ativos financeiros — dinheiro acessível quando você precisar.` })
      }
      if (dividas > fin && dividas > 0) {
        notas.push({ t: 'neg', ico: 'fa-triangle-exclamation', txt: `<strong>Suas dívidas (${money(dividas)}) superam seu patrimônio financeiro (${money(fin)}).</strong> Um imprevisto hoje viraria dívida nova. Priorize reserva antes de novos bens.` })
      }
      const submarino = this._bens.filter(b => Number(b.financiamento_saldo || 0) > Number(b.valor_atual || 0))
      if (submarino.length) {
        notas.push({ t: 'neg', ico: 'fa-arrow-trend-down', txt: `<strong>${submarino.length === 1 ? `"${esc(submarino[0].nome)}" vale menos do que você ainda deve nele.` : `${submarino.length} bens valem menos do que você ainda deve neles.`}</strong> Vender hoje não quitaria o financiamento — é patrimônio negativo.` })
      }
      const desvaloriza = this._bens.filter(b => Number(b.variacao_pct || 0) <= -20)
      if (desvaloriza.length) {
        const pior = desvaloriza.sort((a, b) => Number(a.variacao_pct) - Number(b.variacao_pct))[0]
        notas.push({ t: 'warn', ico: 'fa-chart-line', txt: `<strong>${esc(pior.nome)} já perdeu ${Math.abs(Number(pior.variacao_pct)).toFixed(0)}% do valor de compra.</strong> Normal em veículo e eletrônico — o importante é não tratar isso como investimento.` })
      }
      const liq = Number(r.liquido_rapido || 0)
      if (liq > 0 && bruto > 0) {
        notas.push({ t: 'info', ico: 'fa-bolt', txt: `<strong>${money(liq)} do seu patrimônio vira dinheiro rápido</strong> — ${Math.round((liq / bruto) * 100)}% do total. É o seu colchão real diante de um imprevisto.` })
      }
      if (!notas.length) return ''
      return `<section class="tp-notes">${notas.slice(0, 4).map(n => `
        <div class="ds-note ds-note--${n.t}"><i class="fas ${n.ico} ds-note__ico"></i><div>${n.txt}</div></div>`).join('')}</section>`
    },

    // ── aba: carteira ────────────────────────────────────────────────────────
    _abaCarteira() {
      const I = window.VMTerminalInvestimentos
      const list = (this._inv?.investimentos || [])
      if (!I) return '<div class="ds-empty"><i class="fas fa-chart-line"></i><p>Carteira indisponível.</p></div>'
      if (!list.length) return I._empty()
      const r = this._inv?.resumo || {}
      const lucro = Number(r.lucro_prejuizo || 0)
      const cdi = this._inv?.cdi_atual
      return `
        <div class="tp-strip">
          <div><small>Valor atual</small><b>${money(r.total_atual)}</b></div>
          <div><small>Total investido</small><b>${money(r.total_investido)}</b></div>
          <div><small>Resultado</small><b class="${lucro >= 0 ? 'is-pos' : 'is-neg'}">${lucro >= 0 ? '▲' : '▼'} ${money(Math.abs(lucro))}</b></div>
          <div><small>CDI hoje</small><b>${cdi ? Number(cdi).toFixed(2) + '% a.a.' : '—'}</b></div>
        </div>
        <div class="ti-grid">${list.map((i, idx) => I._card(i, idx)).join('')}</div>`
    },

    // ── aba: bens ────────────────────────────────────────────────────────────
    _abaBens() {
      const bens = this._bens
      if (!bens.length) {
        return `<section class="td-onboarding tm-empty"><div class="td-onboarding__copy">
          <span class="td-eyebrow">Patrimônio material</span>
          <h2>Registre o que você já conquistou.</h2>
          <p>Casa, carro, moto, equipamento de trabalho, joia, coleção. O app guarda quanto custou e quanto vale hoje — e desconta o financiamento que ainda está em aberto, para mostrar quanto do bem é seu de verdade.</p>
          <div class="td-onboarding__actions"><button class="ds-btn ds-btn--primary" onclick="VMTerminalPatrimonio.novoBem()"><i class="fas fa-plus"></i> Adicionar bem</button></div>
        </div></section>`
      }
      const totalAtual = bens.reduce((s, b) => s + Number(b.valor_atual || 0), 0)
      const totalLiq = bens.reduce((s, b) => s + Number(b.patrimonio_liquido_bem || 0), 0)
      const totalDiv = bens.reduce((s, b) => s + Number(b.financiamento_saldo || 0), 0)

      return `
        <div class="tp-strip">
          <div><small>Valor de mercado</small><b>${money(totalAtual)}</b></div>
          <div><small>Ainda financiado</small><b class="${totalDiv > 0 ? 'is-neg' : ''}">${money(totalDiv)}</b></div>
          <div><small>Efetivamente seu</small><b class="is-pos">${money(totalLiq)}</b></div>
          <div><small>Custo de aquisição</small><b>${money(this._resumo?.total_aquisicao)}</b></div>
        </div>
        <article class="td-panel" style="padding:0;overflow:hidden">
          <div class="ds-tablewrap"><table class="ds-table">
            <thead><tr>
              <th>Bem</th>
              <th class="ds-num">Comprei por</th>
              <th class="ds-num">Vale hoje</th>
              <th class="ds-num">Variação</th>
              <th class="ds-num">Financiado</th>
              <th class="ds-num">É seu</th>
              <th>Liquidez</th>
              <th style="text-align:right">Ações</th>
            </tr></thead>
            <tbody>${bens.map(b => this._linhaBem(b)).join('')}</tbody>
          </table></div>
        </article>
        <div class="tp-foot">
          <button class="ds-btn ds-btn--primary" onclick="VMTerminalPatrimonio.novoBem()"><i class="fas fa-plus"></i> Adicionar bem</button>
        </div>`
    },

    _linhaBem(b) {
      const t = tipoDe(b.tipo)
      const varv = Number(b.variacao_valor || 0)
      const varp = b.variacao_pct
      const saldo = Number(b.financiamento_saldo || 0)
      const liqInfo = LIQ[b.liquidez] || LIQ.baixa
      const negativo = saldo > Number(b.valor_atual || 0)
      const j = esc(JSON.stringify(b))
      return `<tr>
        <td>
          <div class="tp-bem">
            <span class="tp-bem__ico" style="color:${t.cor};border-color:${t.cor}55"><i class="fas ${t.ico}"></i></span>
            <div>
              <strong>${esc(b.nome)}</strong>
              <small>${t.rot}${b.data_aquisicao ? ` · desde ${dataBR(b.data_aquisicao)}` : ''}</small>
            </div>
          </div>
        </td>
        <td class="ds-num">${money(b.valor_aquisicao)}</td>
        <td class="ds-num">${money(b.valor_atual)}</td>
        <td class="ds-num" style="color:${varv >= 0 ? 'var(--terminal-primary)' : 'var(--terminal-negative)'}">
          ${varv >= 0 ? '+' : '−'}${money(Math.abs(varv))}${varp !== null && varp !== undefined ? `<br><small style="opacity:.7">${pct(varp)}</small>` : ''}
        </td>
        <td class="ds-num">${saldo > 0 ? `${money(saldo)}${b.financiamento_descricao ? `<br><small style="opacity:.7">${esc(b.financiamento_descricao)}</small>` : ''}` : '<span style="opacity:.4">—</span>'}</td>
        <td class="ds-num" style="color:${negativo ? 'var(--terminal-negative)' : 'var(--terminal-ink)'};font-weight:600">${money(b.patrimonio_liquido_bem)}</td>
        <td><span class="ds-pill ${liqInfo.cls}" title="${liqInfo.dica}">${liqInfo.rot}</span></td>
        <td style="text-align:right;white-space:nowrap">
          <button class="ds-btn ds-btn--sm" title="Editar" onclick='VMTerminalPatrimonio.editarBem(${j})'><i class="fas fa-pen"></i></button>
          <button class="ds-btn ds-btn--sm ds-btn--danger" title="Remover" onclick='VMTerminalPatrimonio.excluirBem(${Number(b.id)}, ${esc(JSON.stringify(b.nome))})'><i class="fas fa-trash"></i></button>
        </td>
      </tr>`
    },

    // ── modal do bem ─────────────────────────────────────────────────────────
    _st() { return 'width:100%;background:var(--terminal-bg);border:1px solid var(--terminal-line);color:var(--terminal-ink);border-radius:var(--terminal-radius-sm);padding:10px 12px;font-size:13px;font-family:var(--terminal-font)' },
    _lab(t, dica) { return `<label style="display:block;font:700 10px/1 var(--terminal-mono);letter-spacing:.1em;text-transform:uppercase;color:var(--terminal-ink-soft);margin-bottom:6px">${t}${dica ? ` <span style="text-transform:none;letter-spacing:0;font-weight:500;opacity:.7">${dica}</span>` : ''}</label>` },

    async novoBem() { this._abrirForm(null) },
    async editarBem(b) { this._abrirForm(b) },

    async _abrirForm(bem) {
      const vm = this._vm
      // A lista de financiamentos só é útil aqui — não vale carregar junto da tela.
      if (!this._fins) {
        const r = await vm.api('GET', 'financiamentos').catch(() => ({ financiamentos: [] }))
        this._fins = (r.financiamentos || []).filter(f => f.status === 'ativo')
      }
      const s = this._st()
      const tipo = bem?.tipo || 'veiculo'
      const liq = bem?.liquidez || 'baixa'
      const opTipos = Object.entries(TIPOS).map(([k, v]) => `<option value="${k}" ${k === tipo ? 'selected' : ''}>${v.rot}</option>`).join('')
      const opLiq = Object.entries(LIQ).map(([k, v]) => `<option value="${k}" ${k === liq ? 'selected' : ''}>${v.rot} — ${v.dica.toLowerCase()}</option>`).join('')
      const opFin = ['<option value="">Nenhum — já é quitado</option>']
        .concat(this._fins.map(f => `<option value="${f.id}" ${String(bem?.financiamento_id || '') === String(f.id) ? 'selected' : ''}>${esc(f.descricao)} — saldo ${money(f.saldo_devedor)}</option>`)).join('')

      vm.showModal(`<div style="font-family:var(--terminal-font);color:var(--terminal-ink)">
        <div style="font-size:16px;font-weight:640">${bem ? 'Editar bem' : 'Novo bem material'}</div>
        <div style="color:var(--terminal-ink-soft);font-size:12px;margin:4px 0 18px">Guardamos o que você pagou e o que vale hoje — é a diferença entre os dois que conta a verdade sobre o bem.</div>
        <div style="display:flex;flex-direction:column;gap:13px">
          <div style="display:flex;gap:10px;flex-wrap:wrap">
            <div style="flex:2;min-width:180px">${this._lab('Nome')}<input id="tp-nome" style="${s}" value="${esc(bem?.nome || '')}" placeholder="Ex.: Honda Civic 2021"></div>
            <div style="flex:1;min-width:140px">${this._lab('Tipo')}<select id="tp-tipo" style="${s}">${opTipos}</select></div>
          </div>
          <div style="display:flex;gap:10px;flex-wrap:wrap">
            <div style="flex:1;min-width:140px">${this._lab('Comprei por (R$)')}<input id="tp-aq" type="number" min="0" step="0.01" style="${s}" value="${bem?.valor_aquisicao ?? ''}"></div>
            <div style="flex:1;min-width:140px">${this._lab('Vale hoje (R$)', '(opcional)')}<input id="tp-at" type="number" min="0" step="0.01" style="${s}" value="${bem?.valor_atual ?? ''}" placeholder="igual à compra"></div>
          </div>
          <div style="display:flex;gap:10px;flex-wrap:wrap">
            <div style="flex:1;min-width:140px">${this._lab('Data da aquisição')}<input id="tp-data" type="date" style="${s}" value="${bem?.data_aquisicao ? String(bem.data_aquisicao).slice(0, 10) : ''}"></div>
            <div style="flex:1;min-width:140px">${this._lab('Variação anual (%)', '(estimada)')}<input id="tp-var" type="number" step="0.1" style="${s}" value="${bem?.variacao_anual ?? 0}" placeholder="-10 para carro"></div>
          </div>
          <div>${this._lab('Liquidez')}<select id="tp-liq" style="${s}">${opLiq}</select></div>
          <div>${this._lab('Financiamento vinculado')}<select id="tp-fin" style="${s}">${opFin}</select>
            <div style="font-size:11px;color:var(--terminal-ink-soft);margin-top:6px">Vinculando, o saldo devedor é descontado do valor do bem no patrimônio.</div>
          </div>
          <div>${this._lab('Observações', '(opcional)')}<textarea id="tp-obs" rows="2" style="${s};resize:vertical">${esc(bem?.observacoes || '')}</textarea></div>
          <div style="display:flex;gap:8px;margin-top:6px">
            <button class="ds-btn ds-btn--primary" style="flex:1" onclick="VMTerminalPatrimonio.salvarBem(${bem ? Number(bem.id) : 'null'})"><i class="fas fa-check"></i> Salvar</button>
            <button class="ds-btn" onclick="VM.closeModal()">Cancelar</button>
          </div>
        </div></div>`)
    },

    async salvarBem(id) {
      const vm = this._vm
      const g = (x) => document.getElementById(x)
      const nome = g('tp-nome')?.value?.trim()
      const aq = parseFloat(g('tp-aq')?.value)
      const atRaw = g('tp-at')?.value
      if (!nome) return vm.toast('Informe o nome do bem.', 'error')
      if (!(aq >= 0) || !Number.isFinite(aq)) return vm.toast('Informe quanto você pagou pelo bem.', 'error')
      const body = {
        nome,
        tipo: g('tp-tipo')?.value,
        valor_aquisicao: aq,
        valor_atual: atRaw === '' ? aq : parseFloat(atRaw),
        data_aquisicao: g('tp-data')?.value || null,
        variacao_anual: parseFloat(g('tp-var')?.value) || 0,
        liquidez: g('tp-liq')?.value,
        financiamento_id: g('tp-fin')?.value || null,
        observacoes: g('tp-obs')?.value?.trim() || null,
      }
      const r = await vm.api(id ? 'PUT' : 'POST', id ? `bens/${id}` : 'bens', body).catch(e => ({ error: e.response?.data?.error }))
      if (r?.success) { vm.closeModal(); vm.toast(id ? 'Bem atualizado.' : 'Bem adicionado ao patrimônio.', 'success'); this._aba = 'bens'; this.reload() }
      else vm.toast(r?.error || 'Erro ao salvar.', 'error')
    },

    async excluirBem(id, nome) {
      const vm = this._vm
      const ok = await vm.vmConfirm(`Remover <strong>${esc(nome)}</strong> do seu patrimônio?`, { titulo: 'Remover bem', corBotao: '#FF6B6B', textoBotao: 'Remover', icone: '🗑️' })
      if (!ok) return
      const r = await vm.api('DELETE', `bens/${id}`).catch(e => ({ error: e.response?.data?.error }))
      if (r?.success) { vm.toast('Bem removido.', 'success'); this._aba = 'bens'; this.reload() }
      else vm.toast(r?.error || 'Erro ao remover.', 'error')
    },
  }
})()
