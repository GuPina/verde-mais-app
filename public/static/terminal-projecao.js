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
        content.innerHTML = `<div class="td-error"><i class="fas fa-triangle-exclamation"></i><h2>Não foi possível gerar a projeção</h2><p>${esc(err?.error || 'Tente novamente.')}</p><button class="ds-btn ds-btn--primary" onclick="VMTerminalProjecao.reload()">Tentar novamente</button></div>`
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
      const ultimoLabel = proj[proj.length - 1]?.label || `${d.horizonte_meses || 12} meses`

      content.innerHTML = this._shell(`
        <section class="pj-hero">
          <div class="pj-hero__main">
            <span class="td-eyebrow">Projeção em ${d.horizonte_meses || 12} meses</span>
            <div class="pj-big ${baixaConf ? 'pj-big--muted' : ''}">${money(proj12)}</div>
            <div class="pj-hero__tags">
              <span class="to-status to-status--${tendCls}">${tendLbl}</span>
              <span class="pj-conf pj-conf--${baixaConf ? 'low' : conf < 70 ? 'mid' : 'high'}"
                    title="Quanto mais meses de histórico lançados, maior a confiança da projeção.">confiança ${conf}%${baixaConf ? ' · baixa' : ''}</span>
            </div>
            <p class="pj-hero__sub">É o seu saldo acumulado em <strong>${esc(ultimoLabel)}</strong>, se o padrão dos últimos meses se mantiver. Já entram as parcelas e recorrências que você tem contratadas; não entram aportes nem resgates de investimento.</p>
            ${baixaConf ? `<p class="pj-warn"><i class="fas fa-circle-info"></i> Poucos meses de histórico — este número tem baixa confiança. Lance mais receitas e despesas para uma projeção firme.</p>` : ''}
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
        <article class="td-panel pj-sec">
          <div class="td-panel__head"><div><span class="td-eyebrow">O que já está contratado</span><h2>Dados certos na projeção</h2></div></div>
          <div class="pj-certos">
            ${Number(dc.recorrencias_mensais) > 0 ? `<div class="pj-certo"><span class="pj-certo__lbl">Recorrências mensais</span><span class="pj-certo__val">${money(dc.recorrencias_mensais)}/mês</span></div>` : ''}
            ${Number(dc.total_parcelas_futuras) > 0 ? `<div class="pj-certo"><span class="pj-certo__lbl">Parcelas futuras (12m)</span><span class="pj-certo__val">${money(dc.total_parcelas_futuras)}</span></div>` : ''}
            ${Number(dc.lembretes_estimados) > 0 ? `<div class="pj-certo"><span class="pj-certo__lbl">Lembretes estimados</span><span class="pj-certo__val">${money(dc.lembretes_estimados)}</span></div>` : ''}
          </div>
        </article>` : ''}

        <div class="dg-kpis dg-kpis--seg">
          ${this._kpi('Cenário otimista (12m)', money(resumo.cenario_otimista_12m), 'ok', 'receitas +10%, despesas −5%')}
          ${this._kpi('Cenário base (12m)', money(resumo.projecao_12m), 'neutral')}
          ${this._kpi('Cenário pessimista (12m)', money(resumo.cenario_pessimista_12m), 'neg', 'receitas −10%, despesas +10%')}
        </div>

        ${metas.length ? `
        <article class="td-panel pj-sec">
          <div class="td-panel__head"><div><span class="td-eyebrow">Integração com metas</span><h2>Metas em risco</h2></div></div>
          <div class="dg-alertas">${metas.map(m => `<div class="dg-alerta"><i class="fas fa-triangle-exclamation"></i><div><strong>${esc(m.nome)}</strong><span>${esc(m.alerta)}</span></div></div>`).join('')}</div>
        </article>` : ''}

        ${(d.insights || []).length ? `
        <article class="td-panel pj-sec">
          <div class="td-panel__head"><div><span class="td-eyebrow">Leitura</span><h2>Insights</h2></div></div>
          <ul class="pj-insights">${(d.insights || []).map(i => `<li>${esc(i)}</li>`).join('')}</ul>
        </article>` : ''}
      `)
    },

    /**
     * O gráfico usava `preserveAspectRatio="none"` com largura fluida: o
     * viewBox de 520×200 era esticado até a largura do painel, e como o
     * estiramento é só horizontal a linha saía com espessura desigual e a
     * curva, achatada. Agora o viewBox tem a proporção do desenho e o SVG
     * escala junto, então traço e curva ficam fiéis.
     *
     * Também ganhou o que faltava para o número ser lido: linhas de grade
     * com valor, o zero marcado quando o cenário cruza para o negativo, e a
     * legenda dizendo que a banda é o intervalo entre otimista e pessimista.
     */
    _chart(proj, cenarios) {
      if (!proj.length) return '<div class="td-empty-row"><i class="fas fa-chart-line"></i><span>Sem dados para projetar.</span></div>'
      const W = 560, H = 230, pL = 64, pR = 10, pT = 14, pB = 26
      const pw = W - pL - pR, ph = H - pT - pB
      const base = proj.map(p => Number(p.valor) || 0)
      const otim = (cenarios?.otimista || []).map(p => Number(p.valor) || 0)
      const pess = (cenarios?.pessimista || []).map(p => Number(p.valor) || 0)
      const all = base.concat(otim, pess)
      let min = Math.min(...all, 0), max = Math.max(...all, 0)
      // Um respiro em cima e embaixo: linha encostada na borda parece cortada.
      const folga = ((max - min) || 1) * 0.08
      min -= folga; max += folga
      const span = (max - min) || 1
      const x = (i, n) => pL + (n <= 1 ? pw / 2 : (i / (n - 1)) * pw)
      const y = (v) => pT + ph * (1 - (v - min) / span)
      const line = (arr) => arr.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i, arr.length).toFixed(1)},${y(v).toFixed(1)}`).join(' ')

      // Quatro marcas, mais o zero quando a projeção cruza para o negativo —
      // é a fronteira que importa aqui. Marca colada em outra vira rótulo
      // sobreposto, então o zero substitui a vizinha em vez de somar.
      let marcas = [min, min + span / 3, min + 2 * span / 3, max]
      if (min < 0 && max > 0) {
        marcas = marcas.filter(v => Math.abs(v - 0) > span * 0.12)
        marcas.push(0)
      }

      const temBanda = otim.length === pess.length && otim.length === base.length && otim.length > 1
      const banda = temBanda
        ? `<polygon points="${otim.map((v, i) => `${x(i, otim.length).toFixed(1)},${y(v).toFixed(1)}`).join(' ')} ${pess.map((v, i) => `${x(i, pess.length).toFixed(1)},${y(v).toFixed(1)}`).reverse().join(' ')}" fill="var(--terminal-primary)" opacity=".1"/>`
        : ''

      return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;display:block" role="img" aria-label="Projeção de saldo mês a mês">
        ${marcas.map(v => `
          <line x1="${pL}" y1="${y(v).toFixed(1)}" x2="${W - pR}" y2="${y(v).toFixed(1)}"
                stroke="${v === 0 ? 'var(--terminal-ink-soft)' : 'var(--terminal-line)'}"
                stroke-width="1" ${v === 0 ? 'stroke-dasharray="4 4" opacity=".6"' : ''}/>
          <text x="${pL - 6}" y="${(y(v) + 3.5).toFixed(1)}" text-anchor="end" font-size="9"
                fill="var(--terminal-ink-soft)" font-family="var(--terminal-mono)">${moneyK(v)}</text>`).join('')}
        ${banda}
        <path d="${line(base)}" fill="none" stroke="var(--terminal-primary)" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
        ${base.map((v, i) => `<circle cx="${x(i, base.length).toFixed(1)}" cy="${y(v).toFixed(1)}" r="${i === base.length - 1 ? 4.5 : 2.5}" fill="${i === base.length - 1 ? 'var(--terminal-primary)' : 'var(--terminal-bg)'}" stroke="var(--terminal-primary)" stroke-width="1.5"><title>${esc(proj[i]?.label || '')}: ${money(v)}</title></circle>`).join('')}
      </svg>
      <div class="pj-chart__axis"><span>${esc(proj[0]?.label || '')}</span><span>${esc(proj[proj.length - 1]?.label || '')}</span></div>
      ${temBanda ? `<div class="pj-chart__leg"><i></i> A faixa clara é o intervalo entre o cenário otimista e o pessimista.</div>` : ''}`
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
        <div class="td-onboarding__actions"><button class="ds-btn ds-btn--primary" onclick="VM.navigate('planos')"><i class="fas fa-arrow-up"></i> Ver planos</button></div>
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
