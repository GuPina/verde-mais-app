(function () {
  const esc = (v) => String(v ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;')
  const money = (v) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 2 }).format(Number(v) || 0)
  const moneyK = (v) => { const n = Number(v) || 0; return Math.abs(n) >= 1000 ? 'R$ ' + (n / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + 'k' : money(n) }

  window.VMTerminalProjecao = {
    async render(vm) {
      this._vm = vm
      const content = document.getElementById('page-content')
      if (!content) return
      document.body.classList.add('terminal-dashboard-active')
      content.innerHTML = '<div class="td-loading"><span></span><span></span><span></span></div>'
      try {
        const d = await vm.api('GET', 'projecao')
        if (d && d.upgrade) return void (content.innerHTML = this._shell(this._upsell(d)))
        this._d = d
        this._paint()
      } catch (e) {
        const err = e.response?.data
        if (err && err.upgrade) return void (document.getElementById('page-content').innerHTML = this._shell(this._upsell(err)))
        content.innerHTML = `<div class="td-error"><i class="fas fa-triangle-exclamation"></i><h2>Não foi possível gerar a projeção</h2><p>${esc(err?.error || 'Tente novamente.')}</p><button class="td-button td-button--primary" onclick="VMTerminalProjecao.reload()">Tentar novamente</button></div>`
      }
    },
    reload() { this.render(this._vm) },

    _paint() {
      const content = document.getElementById('page-content')
      if (!content) return
      const d = this._d
      const proj = d.projecoes || []
      const resumo = d.resumo || {}
      const conf = Number(d.confianca) || 0
      const baixaConf = conf < 40
      const proj12 = Number(resumo.projecao_12m ?? (proj[proj.length - 1]?.valor)) || 0
      const tend = d.tendencia
      const tendLbl = tend === 'positive' ? '📈 Tendência de alta' : tend === 'negative' ? '📉 Tendência de queda' : '📊 Estável'
      const tendCls = tend === 'positive' ? 'ok' : tend === 'negative' ? 'neg' : 'warn'
      const dc = d.dados_certos || {}
      const metas = (d.metas_analise || []).filter(m => m.alerta)

      content.innerHTML = this._shell(`
        <section class="pj-hero">
          <div class="pj-hero__main">
            <span class="td-eyebrow">Projeção em ${d.horizonte_meses || 12} meses</span>
            <div class="pj-big ${baixaConf ? 'pj-big--muted' : ''}">${money(proj12)}</div>
            <div class="pj-hero__tags">
              <span class="to-status to-status--${tendCls}">${tendLbl}</span>
              <span class="pj-conf pj-conf--${baixaConf ? 'low' : conf < 70 ? 'mid' : 'high'}">confiança ${conf}%${baixaConf ? ' · baixa' : ''}</span>
            </div>
            ${baixaConf ? `<p class="pj-warn">Poucos meses de histórico — este número tem baixa confiança. Lance mais receitas e despesas para uma projeção firme.</p>` : ''}
          </div>
          <div class="pj-chart">${this._chart(proj, d.cenarios)}</div>
        </section>

        <div class="dg-kpis">
          ${this._kpi('Sobra média/mês', money(d.media_mensal), Number(d.media_mensal) >= 0 ? 'ok' : 'neg', 'já descontando parcelas e recorrências contratadas')}
          ${this._kpi('Receita média/mês', money(d.media_receitas), 'ok')}
          ${this._kpi('Despesa variável/mês', money(d.media_despesas), 'warn', 'só mercado, lazer e imprevistos')}
          ${this._kpi('Ponto de partida', moneyK(d.saldo_atual), Number(d.saldo_atual) >= 0 ? 'ok' : 'neg', d.saldo_atual_desc || 'soma dos últimos 6 meses')}
        </div>

        ${(Number(dc.recorrencias_mensais) > 0 || Number(dc.total_parcelas_futuras) > 0) ? `
        <article class="td-panel" style="margin-top:18px">
          <div class="td-panel__head"><div><span class="td-eyebrow">O que já está contratado</span><h2>Dados certos na projeção</h2></div></div>
          <div class="pj-certos">
            ${Number(dc.recorrencias_mensais) > 0 ? `<div class="pj-certo"><span class="pj-certo__lbl">Recorrências mensais</span><span class="pj-certo__val">${money(dc.recorrencias_mensais)}/mês</span></div>` : ''}
            ${Number(dc.total_parcelas_futuras) > 0 ? `<div class="pj-certo"><span class="pj-certo__lbl">Parcelas futuras (12m)</span><span class="pj-certo__val">${money(dc.total_parcelas_futuras)}</span></div>` : ''}
            ${Number(dc.lembretes_estimados) > 0 ? `<div class="pj-certo"><span class="pj-certo__lbl">Lembretes estimados</span><span class="pj-certo__val">${money(dc.lembretes_estimados)}</span></div>` : ''}
          </div>
        </article>` : ''}

        <div class="dg-kpis" style="margin-top:12px">
          ${this._kpi('Cenário otimista (12m)', money(resumo.cenario_otimista_12m), 'ok', 'receitas +10%, despesas −5%')}
          ${this._kpi('Cenário base (12m)', money(resumo.projecao_12m), 'neutral')}
          ${this._kpi('Cenário pessimista (12m)', money(resumo.cenario_pessimista_12m), 'neg', 'receitas −10%, despesas +10%')}
        </div>

        ${metas.length ? `
        <article class="td-panel" style="margin-top:18px">
          <div class="td-panel__head"><div><span class="td-eyebrow">Integração com metas</span><h2>Metas em risco</h2></div></div>
          <div class="dg-alertas">${metas.map(m => `<div class="dg-alerta"><i class="fas fa-triangle-exclamation"></i><div><strong>${esc(m.nome)}</strong><span>${esc(m.alerta)}</span></div></div>`).join('')}</div>
        </article>` : ''}

        ${(d.insights || []).length ? `
        <article class="td-panel" style="margin-top:18px">
          <div class="td-panel__head"><div><span class="td-eyebrow">Leitura</span><h2>Insights</h2></div></div>
          <ul class="pj-insights">${(d.insights || []).map(i => `<li>${esc(i)}</li>`).join('')}</ul>
        </article>` : ''}
      `)
    },

    _chart(proj, cenarios) {
      if (!proj.length) return '<div class="td-empty-row"><span>Sem dados para projetar.</span></div>'
      const W = 520, H = 200, pad = 8
      const base = proj.map(p => Number(p.valor) || 0)
      const otim = (cenarios?.otimista || []).map(p => Number(p.valor) || 0)
      const pess = (cenarios?.pessimista || []).map(p => Number(p.valor) || 0)
      const all = base.concat(otim, pess)
      const min = Math.min(...all, 0), max = Math.max(...all, 0)
      const span = (max - min) || 1
      const x = (i, n) => pad + (i / Math.max(1, n - 1)) * (W - 2 * pad)
      const y = (v) => H - pad - ((v - min) / span) * (H - 2 * pad)
      const line = (arr) => arr.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i, arr.length).toFixed(1)},${y(v).toFixed(1)}`).join(' ')
      const zeroY = y(0)
      // banda otimista/pessimista
      let band = ''
      if (otim.length === pess.length && otim.length === base.length && otim.length > 1) {
        const top = otim.map((v, i) => `${x(i, otim.length).toFixed(1)},${y(v).toFixed(1)}`).join(' ')
        const bot = pess.map((v, i) => `${x(i, pess.length).toFixed(1)},${y(v).toFixed(1)}`).reverse().join(' ')
        band = `<polygon points="${top} ${bot}" fill="var(--terminal-primary)" opacity="0.08"/>`
      }
      return `<svg viewBox="0 0 ${W} ${H}" width="100%" preserveAspectRatio="none" style="max-height:210px">
        <line x1="${pad}" y1="${zeroY.toFixed(1)}" x2="${W - pad}" y2="${zeroY.toFixed(1)}" stroke="var(--terminal-line)" stroke-dasharray="3 3"/>
        ${band}
        <path d="${line(base)}" fill="none" stroke="var(--terminal-primary)" stroke-width="2.5" stroke-linejoin="round"/>
        ${base.map((v, i) => i === base.length - 1 ? `<circle cx="${x(i, base.length).toFixed(1)}" cy="${y(v).toFixed(1)}" r="4" fill="var(--terminal-primary)"/>` : '').join('')}
      </svg>
      <div class="pj-chart__axis"><span>${esc(proj[0]?.label || '')}</span><span>${esc(proj[proj.length - 1]?.label || '')}</span></div>`
    },

    _kpi(lbl, val, tone, hint) {
      return `<div class="dg-kpi">
        <span class="dg-kpi__lbl">${esc(lbl)}</span>
        <span class="dg-kpi__val dg-kpi__val--${tone || 'neutral'}">${val}</span>
        ${hint ? `<span class="pj-kpi__hint">${esc(hint)}</span>` : ''}
      </div>`
    },

    _upsell(d) {
      return `<section class="td-onboarding"><div class="td-onboarding__copy">
        <span class="td-eyebrow">Recurso Premium</span>
        <h2>Veja seu futuro financeiro.</h2>
        <p>${esc(d.error || 'A projeção financeira — tendência, cenários e viabilidade das metas — faz parte dos planos pagos.')}</p>
        <div class="td-onboarding__actions"><button class="td-button td-button--primary" onclick="VM.navigate('planos')"><i class="fas fa-arrow-up"></i> Ver planos</button></div>
      </div></section>`
    },

    _shell(inner) {
      return `<div class="td-dashboard pj">
        <header class="td-dashboard__header">
          <div>
            <span class="td-eyebrow">Para onde seu dinheiro vai</span>
            <h1>Projeção financeira. <em>O amanhã, com números de hoje.</em></h1>
            <p>Histórico real, o que já está contratado e cenários — sem contar o mesmo dinheiro duas vezes.</p>
          </div>
        </header>
        ${inner}
      </div>`
    }
  }
})()
