(function () {
  const esc = (v) => String(v ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;')
  const money = (v) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 2 }).format(Number(v) || 0)
  const pctTxt = (v) => `${Math.round(Number(v) || 0)}%`
  const MOD = [
    ['fluxo_caixa', 'Fluxo de caixa', 30], ['reserva', 'Reserva', 25], ['dividas', 'Dívidas', 25],
    ['investimentos', 'Investimentos', 100], ['metas', 'Metas', 100],
  ]

  window.VMTerminalDiagnostico = {
    async render(vm) {
      this._vm = vm
      const content = document.getElementById('page-content')
      if (!content) return
      document.body.classList.add('terminal-dashboard-active')
      content.innerHTML = '<div class="td-loading"><span></span><span></span><span></span></div>'
      try {
        this._d = await vm.api('GET', 'ia/insights')
        this._paint()
      } catch (e) {
        content.innerHTML = `<div class="td-error"><i class="fas fa-triangle-exclamation"></i><h2>Não foi possível gerar o diagnóstico</h2><p>${esc(e.response?.data?.error || 'Tente novamente.')}</p><button class="ds-btn ds-btn--primary" onclick="VMTerminalDiagnostico.reload()">Tentar novamente</button></div>`
      }
    },
    reload() { this.render(this._vm) },

    _paint() {
      const content = document.getElementById('page-content')
      if (!content) return
      const d = this._d
      const score = Math.round(Number(d.resumo_executivo?.score_geral ?? d.scores?.geral) || 0)
      const veredicto = d.resumo_executivo?.veredicto || ''
      const proxima = d.resumo_executivo?.proxima_acao || ''
      const k = d.kpis || {}
      const alertas = d.alertas_criticos || []
      const am = d.analise_modular || {}
      const cor = score >= 70 ? 'var(--terminal-primary)' : score >= 45 ? 'var(--terminal-accent)' : 'var(--terminal-negative)'
      const dash = 2 * Math.PI * 52
      const off = dash * (1 - Math.min(100, Math.max(0, score)) / 100)

      content.innerHTML = this._shell(`
        <section class="dg-hero">
          <div class="dg-ring">
            <svg viewBox="0 0 120 120" width="132" height="132">
              <circle cx="60" cy="60" r="52" fill="none" stroke="var(--terminal-line)" stroke-width="10"/>
              <circle cx="60" cy="60" r="52" fill="none" stroke="${cor}" stroke-width="10" stroke-linecap="round"
                stroke-dasharray="${dash.toFixed(1)}" stroke-dashoffset="${off.toFixed(1)}" transform="rotate(-90 60 60)"/>
              <text x="60" y="58" text-anchor="middle" font-size="30" font-weight="700" fill="var(--terminal-ink)" font-family="var(--terminal-font)">${score}</text>
              <text x="60" y="76" text-anchor="middle" font-size="10" fill="var(--terminal-ink-soft)" font-family="var(--terminal-mono)">/ 100</text>
            </svg>
          </div>
          <div class="dg-hero__main">
            <span class="td-eyebrow">Diagnóstico do mês</span>
            <h2>${esc(veredicto)}</h2>
            ${proxima ? `<p class="dg-next"><strong>Próxima ação:</strong> ${esc(proxima)}</p>` : ''}
            <div class="dg-rings">${MOD.map(([key, lbl, max]) => this._miniRing(d.scores?.[key], max, lbl)).join('')}</div>
          </div>
        </section>

        ${alertas.length ? `
        <article class="td-panel pj-sec">
          <div class="td-panel__head"><div><span class="td-eyebrow">Cruzamento de módulos</span><h2>Alertas críticos</h2></div></div>
          <div class="dg-alertas">${alertas.map(a => this._alerta(a)).join('')}</div>
        </article>` : ''}

        <div class="dg-kpis">
          ${this._kpi('Receita do mês', money(k.receita_mes), 'ok')}
          ${this._kpi('Despesa do mês', money(k.despesa_mes), 'neg')}
          ${this._kpi('Saldo do mês', money(k.saldo_mes), Number(k.saldo_mes) >= 0 ? 'ok' : 'neg')}
          ${this._kpi('Taxa de poupança', pctTxt(k.taxa_poupanca_pct), Number(k.taxa_poupanca_pct) >= 10 ? 'ok' : 'warn')}
          ${this._kpi('Dívida total', money(k.total_dividas), 'neg')}
          ${this._kpiPct('Comprometimento', k.comprometimento_pct, 40)}
          ${this._kpi('Reserva', `${Number(k.reserva_meses) || 0} meses`, Number(k.reserva_meses) >= 3 ? 'ok' : 'warn')}
          ${this._kpiPct('Uso do cartão', k.utilizacao_cartao_pct, 60)}
        </div>

        <div class="dg-modules">
          ${['fluxo_caixa', 'reserva_emergencia', 'dividas', 'investimentos', 'metas'].map(m => this._modCard(am[m])).filter(Boolean).join('')}
        </div>

        <article class="td-panel dg-ia pj-sec">
          <div class="td-panel__head"><div><span class="td-eyebrow">Consultor IA</span><h2>Insights personalizados</h2></div>
            <button class="ds-btn ds-btn--primary" id="dg-ia-btn" onclick="VMTerminalDiagnostico.gerarIA()"><i class="fas fa-wand-magic-sparkles"></i> Gerar insights</button>
          </div>
          <div id="dg-ia-out" class="dg-ia__out"><p style="color:var(--terminal-ink-soft);font-size:13px;margin:0">A análise acima é calculada localmente e sempre está disponível. Clique em <strong>Gerar insights</strong> para uma leitura escrita pela IA.</p></div>
        </article>
      `)
    },

    _miniRing(v, max, lbl) {
      const val = Math.round(Number(v) || 0)
      const pctv = Math.min(100, Math.round((val / (max || 100)) * 100))
      const cor = pctv >= 66 ? 'var(--terminal-primary)' : pctv >= 33 ? 'var(--terminal-accent)' : 'var(--terminal-negative)'
      return `<div class="dg-mini">
        <div class="dg-mini__bar"><span style="width:${pctv}%;background:${cor}"></span></div>
        <span class="dg-mini__lbl">${esc(lbl)}</span>
        <span class="dg-mini__val">${val}<em>/${max}</em></span>
      </div>`
    },
    _alerta(a) {
      const t = a.titulo || a.title || a.nome || 'Alerta'
      const m = a.mensagem || a.descricao || a.detalhe || a.texto || ''
      const ac = a.acao || a.recomendacao || ''
      return `<div class="dg-alerta">
        <i class="fas fa-triangle-exclamation"></i>
        <div><strong>${esc(t)}</strong>${m ? `<span>${esc(m)}</span>` : ''}${ac ? `<span class="dg-alerta__acao">→ ${esc(ac)}</span>` : ''}</div>
      </div>`
    },
    _kpi(lbl, val, tone) {
      return `<div class="dg-kpi">
        <span class="dg-kpi__lbl">${esc(lbl)}</span>
        <span class="dg-kpi__val dg-kpi__val--${tone || 'neutral'}">${val}</span>
      </div>`
    },
    // DG6: percentuais acima de 100% são sinalizados como dado a revisar, não exibidos crus como leitura normal
    _kpiPct(lbl, v, limiteBom) {
      const n = Math.round(Number(v) || 0)
      const suspeito = n > 100
      const tone = suspeito ? 'neg' : n <= (limiteBom || 100) ? 'ok' : 'warn'
      return `<div class="dg-kpi">
        <span class="dg-kpi__lbl">${esc(lbl)}${suspeito ? ' <i class="fas fa-circle-info" title="Acima de 100% — verifique os dados"></i>' : ''}</span>
        <span class="dg-kpi__val dg-kpi__val--${tone}">${n}%</span>
      </div>`
    },
    _modCard(m) {
      if (!m) return ''
      const cor = m.status === 'EXCELENTE' || m.status === 'BOM' ? 'ok' : m.status === 'ATENCAO' ? 'warn' : 'neg'
      return `<article class="dg-mod">
        <div class="dg-mod__head">
          <strong>${esc(m.mensagem || m.status || '')}</strong>
          <span class="to-status to-status--${cor}">${Math.round(Number(m.score) || 0)} pts</span>
        </div>
        ${m.recomendacao ? `<p class="dg-mod__rec">${esc(m.recomendacao)}</p>` : ''}
      </article>`
    },

    async gerarIA() {
      const vm = this._vm
      const out = document.getElementById('dg-ia-out')
      const btn = document.getElementById('dg-ia-btn')
      if (btn) { btn.disabled = true }
      if (out) out.innerHTML = '<div class="td-loading"><span></span><span></span><span></span></div>'
      try {
        const r = await vm.api('POST', 'ia/insights')
        const texto = r?.insights || r?.texto || r?.analise || (Array.isArray(r?.itens) ? r.itens.join('\n\n') : '')
        if (out) out.innerHTML = texto
          ? `<div class="dg-ia__text">${esc(texto).replace(/\n/g, '<br>')}</div>`
          : '<p style="color:var(--terminal-ink-soft);font-size:13px;margin:0">A IA respondeu, mas sem conteúdo. Tente novamente em instantes.</p>'
      } catch (e) {
        const code = e.response?.status
        const ec = e.response?.data?.error_code
        let msg
        if (code === 403) msg = 'Os insights escritos pela IA fazem parte dos planos pagos. A análise acima continua disponível para todos.'
        else if (ec === 'IA_NOT_CONFIGURED' || code === 503) msg = '🔧 O consultor por IA ainda não está ativo neste ambiente. Todo o diagnóstico acima é calculado localmente e não depende dele.'
        else msg = e.response?.data?.error || 'Não foi possível gerar os insights agora.'
        if (out) out.innerHTML = `<div class="td-notice" style="margin:0"><i class="fas fa-circle-info"></i><div><span>${esc(msg)}</span></div></div>`
      } finally {
        if (btn) btn.disabled = false
      }
    },

    _shell(inner) {
      return `<div class="td-dashboard dg">
        <header class="td-dashboard__header">
          <div>
            <span class="td-eyebrow">Sua saúde financeira em um raio-x</span>
            <h1>Diagnóstico 360°. <em>Onde você está, e o próximo passo.</em></h1>
            <p>Um score por área, os alertas que cruzam seus módulos e uma ação clara para este mês.</p>
          </div>
        </header>
        ${inner}
      </div>`
    }
  }
})()
