/**
 * VerdeMais — Regra 50/30/20
 * ============================================================================
 * A tela mostrava o mês corrente e pronto. Só que um mês isolado não responde
 * a pergunta que importa — "eu estou melhorando?" — e um score de 0 a 100 sem
 * explicação não diz o que mudar. Agora a tela tem: o score aberto nos três
 * fatores que o compõem, um seletor de mês, e a linha do score ao longo do
 * ano, com o alvo configurado marcado.
 */
(function () {
  const esc = (v) => String(v ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;')
  const money = (v) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 2 }).format(Number(v) || 0)
  const MESES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']
  const MESES_LONGO = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro']
  const corScore = (s) => (s >= 80 ? 'var(--terminal-primary)' : s >= 50 ? 'var(--terminal-accent)' : 'var(--terminal-negative)')

  window.VMTerminalRegra = {
    async render(vm) {
      this._vm = vm
      const content = document.getElementById('page-content')
      if (!content) return
      document.body.classList.add('terminal-dashboard-active')
      const now = new Date()
      this._mes = this._mes || (now.getMonth() + 1)
      this._ano = this._ano || now.getFullYear()
      this._anoHist = this._anoHist || this._ano
      content.innerHTML = '<div class="td-loading"><span></span><span></span><span></span></div>'
      try {
        const [d, h] = await Promise.all([
          vm.api('GET', `regra-503020?mes=${this._mes}&ano=${this._ano}`),
          // O histórico é acessório: se falhar, o mês ainda tem que aparecer.
          vm.api('GET', `regra-503020/historico?ano=${this._anoHist}`).catch(() => null),
        ])
        this._d = d
        this._h = h
        this._paint()
      } catch (e) {
        content.innerHTML = `<div class="td-error"><i class="fas fa-triangle-exclamation"></i><h2>Não foi possível carregar a regra</h2><p>${esc(e.response?.data?.error || 'Tente novamente.')}</p><button class="ds-btn ds-btn--primary" onclick="VMTerminalRegra.reload()">Tentar novamente</button></div>`
      }
    },
    reload() { this.render(this._vm) },
    setPeriodo(mes, ano) { this._mes = Number(mes); this._ano = Number(ano); this._anoHist = Number(ano); this.reload() },
    setAnoHist(ano) { this._anoHist = Number(ano); this.reload() },

    _paint() {
      const content = document.getElementById('page-content')
      if (!content) return
      const d = this._d, r = d.regra || {}, cur = d.current || {}, ideal = d.ideal || {}
      const score = Math.round(Number(d.score) || 0)
      const semRenda = !(Number(d.income) > 0)

      content.innerHTML = `<div class="td-dashboard rg">
        <header class="td-dashboard__header">
          <div>
            <span class="td-eyebrow">Equilíbrio das suas finanças</span>
            <h1>Regra ${Number(r.pct_necessidades ?? 50)}/${Number(r.pct_desejos ?? 30)}/${Number(r.pct_poupanca ?? 20)}. <em>Onde cada real está indo.</em></h1>
            <p>Necessidades, desejos e poupança — quanto você gasta em cada, quanto seria o ideal e se você vem melhorando.</p>
          </div>
          <div class="td-dashboard__header-actions">${this._seletor()}</div>
        </header>

        ${this._heroScore(score, semRenda, d, r, cur, ideal)}
        ${this._historico()}
        ${this._leituras(d, r, cur, ideal, semRenda)}

        ${(d.breakdown?.top_needs?.length || d.breakdown?.top_wants?.length) ? `<div class="rg-cols">
          ${this._topCol('Maiores necessidades', d.breakdown.top_needs, 'need')}
          ${this._topCol('Maiores desejos', d.breakdown.top_wants, 'want')}
        </div>` : ''}

        ${(d.sugestoes_orcamento || []).length ? `<article class="td-panel" style="margin-top:16px">
          <div class="td-panel__head"><div><span class="td-eyebrow">Sugestão</span><h2>Orçamentos recomendados</h2></div></div>
          <div class="an-list">${d.sugestoes_orcamento.map(s => `<div class="an-card"><div class="an-card__main"><strong>${esc(s.categoria)}</strong><small>${esc(s.motivo)}</small></div><div class="an-card__vals"><span class="an-card__val">${money(s.limite_sugerido)}</span><small class="an-card__eco">hoje ${money(s.gasto_atual)}</small></div></div>`).join('')}</div>
        </article>` : ''}
      </div>`
    },

    _seletor() {
      const anos = [this._ano - 1, this._ano, this._ano + 1]
      const st = 'background:var(--terminal-surface);border:1px solid var(--terminal-line);color:var(--terminal-ink);border-radius:var(--terminal-radius-sm);padding:9px 12px;font-size:13px;font-family:var(--terminal-font)'
      return `<div class="rg-sel">
        <select style="${st}" onchange="VMTerminalRegra.setPeriodo(this.value, ${this._ano})">
          ${MESES_LONGO.map((m, i) => `<option value="${i + 1}" ${i + 1 === this._mes ? 'selected' : ''}>${m}</option>`).join('')}
        </select>
        <select style="${st}" onchange="VMTerminalRegra.setPeriodo(${this._mes}, this.value)">
          ${anos.map(a => `<option value="${a}" ${a === this._ano ? 'selected' : ''}>${a}</option>`).join('')}
        </select>
      </div>`
    },

    // ── score aberto ─────────────────────────────────────────────────────────
    _heroScore(score, semRenda, d, r, cur, ideal) {
      const cor = corScore(score)
      const dash = 2 * Math.PI * 52, off = dash * (1 - Math.min(100, score) / 100)
      const fatores = d.fatores_score || []
      const titulo = semRenda ? 'Nenhuma receita neste mês'
        : score >= 80 ? 'Equilíbrio excelente'
        : score >= 50 ? 'No caminho' : 'Fora do equilíbrio'

      return `<section class="rg-hero">
        <article class="rg-score">
          <div class="rg-score__ring">
            <svg viewBox="0 0 120 120" width="140" height="140" aria-hidden="true">
              <circle cx="60" cy="60" r="52" fill="none" stroke="var(--terminal-line)" stroke-width="10"/>
              <circle cx="60" cy="60" r="52" fill="none" stroke="${cor}" stroke-width="10" stroke-linecap="round" stroke-dasharray="${dash.toFixed(1)}" stroke-dashoffset="${off.toFixed(1)}" transform="rotate(-90 60 60)"/>
              <text x="60" y="58" text-anchor="middle" font-size="30" font-weight="700" fill="var(--terminal-ink)" font-family="var(--terminal-font)">${score}</text>
              <text x="60" y="77" text-anchor="middle" font-size="9" fill="var(--terminal-ink-soft)" font-family="var(--terminal-mono)">DE 100</text>
            </svg>
          </div>
          <div class="rg-score__side">
            <span class="td-eyebrow">${esc(r.nome || 'Regra 50/30/20')}${r.personalizada ? ' · personalizada' : ''}</span>
            <h2>${titulo}</h2>
            <p>${MESES_LONGO[this._mes - 1]} de ${this._ano} · renda de ${money(d.income)}</p>
            ${fatores.length ? `<div class="rg-fatores">
              ${fatores.map(f => {
                const nota = Number(f.nota) || 0
                return `<div class="rg-fator" title="Peso ${f.peso}% no score">
                  <span class="rg-fator__rot">${esc(f.rotulo)}<em>${f.peso}%</em></span>
                  <div class="ds-bar"><span style="width:${Math.min(100, nota)}%;background:${corScore(nota)}"></span></div>
                  <b style="color:${corScore(nota)}">${nota}</b>
                </div>`
              }).join('')}
              <p class="rg-fatores__nota">O score é a distância entre a sua distribuição real e a meta configurada. Poupar acima da meta nunca penaliza.</p>
            </div>` : ''}
            <div class="rg-score__foot">
              ${[['Renda', d.income, ''], ['Gastos', Number(cur.needs?.amount || 0) + Number(cur.wants?.amount || 0), ''], ['Guardado', cur.savings?.amount, 'ok']].map(([rot, v, tom]) =>
                `<div><small>${rot}</small><b ${tom === 'ok' ? 'style="color:var(--terminal-primary)"' : ''}>${money(v)}</b></div>`).join('')}
            </div>
          </div>
        </article>

        <article class="td-panel rg-dist">
          <div class="td-panel__head"><div><span class="td-eyebrow">Distribuição do mês</span><h2>Real vs. ideal</h2></div></div>
          <div class="rg-bars">
            ${this._group('Necessidades', cur.needs, ideal.needs, r.pct_necessidades, 'need')}
            ${this._group('Desejos', cur.wants, ideal.wants, r.pct_desejos, 'want')}
            ${this._group('Poupança', cur.savings, ideal.savings, r.pct_poupanca, 'save')}
          </div>
          <div class="rg-gaps">
            ${[['Necessidades', d.gaps?.needs, 'gasto'], ['Desejos', d.gaps?.wants, 'gasto'], ['Poupança', d.gaps?.savings, 'guardado']].map(([rot, v, tipo]) => {
              // O backend já entrega o gap com o sinal certo para cada grupo:
              // positivo é sempre "bom". O que muda é a palavra — sobrar
              // orçamento de gasto é folga; sobrar poupança é ter guardado a mais.
              const n = Number(v) || 0
              const bom = n >= 0
              const legenda = tipo === 'guardado'
                ? (bom ? 'acima da meta' : 'faltou guardar')
                : (bom ? 'de folga' : 'acima do alvo')
              return `<div><small>${rot}</small><b style="color:${bom ? 'var(--terminal-primary)' : 'var(--terminal-negative)'}">${n >= 0 ? '+' : '−'}${money(Math.abs(n))}</b><small>${legenda}</small></div>`
            }).join('')}
          </div>
        </article>
      </section>`
    },

    // ── histórico do score ───────────────────────────────────────────────────
    _historico() {
      const h = this._h
      if (!h || !Array.isArray(h.meses)) return ''
      const meses = h.meses, res = h.resumo || {}
      const anos = h.anos_disponiveis || [this._anoHist]
      const st = 'background:var(--terminal-bg);border:1px solid var(--terminal-line);color:var(--terminal-ink);border-radius:var(--terminal-radius-sm);padding:6px 10px;font-size:12px;font-family:var(--terminal-mono)'

      // Geometria da linha: 12 slots, escala fixa de 0 a 100 — score é sempre
      // comparável entre meses, então escala automática só confundiria.
      const W = 720, H = 190, pL = 34, pR = 12, pT = 14, pB = 26
      const pw = W - pL - pR, ph = H - pT - pB
      const x = (i) => pL + (pw / 11) * i
      const y = (v) => pT + ph * (1 - Math.min(100, Math.max(0, v)) / 100)
      const comDados = meses.filter(m => !m.sem_dados)
      const pontos = meses.map((m, i) => ({ ...m, i, cx: x(i), cy: y(m.score) }))
      // A linha só liga meses com dado — atravessar um mês vazio inventaria
      // uma queda que não aconteceu.
      const segmentos = []
      let atual = []
      for (const p of pontos) {
        if (p.sem_dados) { if (atual.length > 1) segmentos.push(atual); atual = [] }
        else atual.push(p)
      }
      if (atual.length > 1) segmentos.push(atual)

      const tend = Number(res.tendencia) || 0
      return `<article class="td-panel rg-hist">
        <div class="td-panel__head">
          <div><span class="td-eyebrow">Evolução</span><h2>Seu score ao longo de ${h.ano}</h2></div>
          <select style="${st}" onchange="VMTerminalRegra.setAnoHist(this.value)">
            ${anos.map(a => `<option value="${a}" ${Number(a) === Number(this._anoHist) ? 'selected' : ''}>${a}</option>`).join('')}
          </select>
        </div>

        ${comDados.length ? `
        <div class="rg-hist__stats">
          <div><small>Média do ano</small><b style="color:${corScore(res.media)}">${res.media}</b></div>
          <div><small>Melhor mês</small><b>${res.melhor_mes ? `${MESES[res.melhor_mes.mes - 1]} · ${res.melhor_mes.score}` : '—'}</b></div>
          <div><small>Pior mês</small><b>${res.pior_mes ? `${MESES[res.pior_mes.mes - 1]} · ${res.pior_mes.score}` : '—'}</b></div>
          <div><small>Tendência (3 meses)</small><b style="color:${tend > 0 ? 'var(--terminal-primary)' : tend < 0 ? 'var(--terminal-negative)' : 'var(--terminal-ink-soft)'}">${tend > 0 ? '▲ +' : tend < 0 ? '▼ −' : '■ '}${Math.abs(tend) || 'estável'}</b></div>
          <div><small>Meta de poupança batida</small><b>${res.meses_na_meta_poupanca}/${res.meses_com_dados} ${res.meses_com_dados === 1 ? 'mês' : 'meses'}</b></div>
        </div>

        <div class="rg-hist__chart">
          <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" style="width:100%;height:${H}px" role="img" aria-label="Score mês a mês">
            ${[0, 50, 80, 100].map(v => `
              <line x1="${pL}" y1="${y(v)}" x2="${W - pR}" y2="${y(v)}" stroke="var(--terminal-line)" stroke-width="1" ${v === 80 ? 'stroke-dasharray="4 4"' : ''}/>
              <text x="${pL - 7}" y="${y(v) + 3.5}" text-anchor="end" font-size="9" fill="var(--terminal-ink-soft)" font-family="var(--terminal-mono)">${v}</text>`).join('')}
            <text x="${W - pR}" y="${y(80) - 5}" text-anchor="end" font-size="9" fill="var(--terminal-primary)" font-family="var(--terminal-mono)">meta 80</text>
            ${segmentos.map(seg => `<polyline fill="none" stroke="var(--terminal-primary)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" points="${seg.map(p => `${p.cx.toFixed(1)},${p.cy.toFixed(1)}`).join(' ')}"/>`).join('')}
            ${pontos.map(p => p.sem_dados
              ? `<circle cx="${p.cx.toFixed(1)}" cy="${y(0).toFixed(1)}" r="2" fill="var(--terminal-line)"/>`
              : `<circle cx="${p.cx.toFixed(1)}" cy="${p.cy.toFixed(1)}" r="4" fill="var(--terminal-bg)" stroke="${corScore(p.score)}" stroke-width="2"><title>${MESES[p.i]}: score ${p.score} · necessidades ${p.pct_needs}% · desejos ${p.pct_wants}% · poupança ${p.pct_savings}%</title></circle>`).join('')}
            ${pontos.map(p => `<text x="${p.cx.toFixed(1)}" y="${H - 8}" text-anchor="middle" font-size="9" fill="${p.i + 1 === this._mes && Number(this._anoHist) === Number(this._ano) ? 'var(--terminal-primary)' : 'var(--terminal-ink-soft)'}" font-family="var(--terminal-mono)">${MESES[p.i]}</text>`).join('')}
          </svg>
        </div>` : '<div class="ds-empty"><i class="fas fa-chart-line"></i><p>Sem receitas registradas em ' + h.ano + ' — o score precisa de renda para ser calculado.</p></div>'}
      </article>`
    },

    // ── leituras ─────────────────────────────────────────────────────────────
    _leituras(d, r, cur, ideal, semRenda) {
      const notas = []
      const income = Number(d.income) || 0
      const pN = Number(cur.needs?.percentage) || 0
      const pW = Number(cur.wants?.percentage) || 0
      const pS = Number(cur.savings?.percentage) || 0
      const alvoN = Number(r.pct_necessidades ?? 50), alvoW = Number(r.pct_desejos ?? 30), alvoS = Number(r.pct_poupanca ?? 20)
      const h = this._h, res = h?.resumo || {}

      if (semRenda) {
        notas.push({ t: 'warn', ico: 'fa-circle-exclamation', txt: '<strong>Nenhuma receita registrada neste mês.</strong> Sem renda lançada, não há como dividir 100% dela — registre suas entradas para o score fazer sentido.' })
      } else {
        // Quanto sobraria por mês se ele fechasse a diferença — o número
        // acionável, não o percentual.
        const excessoN = Number(cur.needs?.amount || 0) - Number(ideal.needs || 0)
        const excessoW = Number(cur.wants?.amount || 0) - Number(ideal.wants || 0)
        if (excessoW > 0) {
          notas.push({ t: 'warn', ico: 'fa-cart-shopping', txt: `<strong>Desejos consumiram ${pW.toFixed(0)}% da renda (alvo ${alvoW}%).</strong> São ${money(excessoW)} a mais no mês — ${money(excessoW * 12)} ao longo de um ano se o padrão se repetir.` })
        }
        if (excessoN > 0) {
          notas.push({ t: 'neg', ico: 'fa-house', txt: `<strong>Necessidades em ${pN.toFixed(0)}% da renda (alvo ${alvoN}%).</strong> Custo fixo alto tira sua margem de manobra: ${money(excessoN)} acima do ideal todo mês, e é o gasto mais difícil de cortar às pressas.` })
        }
        if (pS >= alvoS) {
          notas.push({ t: 'ok', ico: 'fa-piggy-bank', txt: `<strong>Você poupou ${pS.toFixed(0)}% da renda</strong> — meta de ${alvoS}% batida. Mantendo esse ritmo, são ${money(Number(cur.savings?.amount || 0) * 12)} guardados em doze meses.` })
        } else if (income > 0) {
          const falta = Number(ideal.savings || 0) - Number(cur.savings?.amount || 0)
          notas.push({ t: 'warn', ico: 'fa-piggy-bank', txt: `<strong>Faltaram ${money(falta)} para bater a meta de poupança.</strong> É ${money(falta / 30)} por dia — normalmente cabe em delivery, transporte por app ou assinatura parada.` })
        }
        if (pN + pW > 100) {
          notas.push({ t: 'neg', ico: 'fa-triangle-exclamation', txt: `<strong>Seus gastos ultrapassaram a renda do mês.</strong> ${(pN + pW).toFixed(0)}% dela foi consumida só entre necessidades e desejos — a diferença virou saldo negativo ou dívida.` })
        }
      }
      if (res.meses_com_dados >= 3) {
        const t = Number(res.tendencia) || 0
        if (t >= 5) notas.push({ t: 'ok', ico: 'fa-arrow-trend-up', txt: `<strong>Seu score subiu ${t} pontos nos últimos três meses.</strong> A mudança está pegando — é o melhor momento para automatizar o aporte e travar o ganho.` })
        else if (t <= -5) notas.push({ t: 'neg', ico: 'fa-arrow-trend-down', txt: `<strong>Seu score caiu ${Math.abs(t)} pontos nos últimos três meses.</strong> Vale olhar o que mudou: gasto novo recorrente ou queda de renda são as causas mais comuns.` })
        if (res.meses_na_meta_poupanca === 0) {
          notas.push({ t: 'warn', ico: 'fa-calendar-xmark', txt: `<strong>Você não bateu a meta de poupança em nenhum mês de ${h.ano}.</strong> Talvez o alvo de ${alvoS}% não caiba na sua realidade — ajustar a meta para algo que você cumpre vale mais que uma meta bonita e ignorada.` })
        }
      }
      if (!notas.length) return ''
      return `<section class="tp-notes" style="margin-top:16px">${notas.slice(0, 4).map(n =>
        `<div class="ds-note ds-note--${n.t}"><i class="fas ${n.ico} ds-note__ico"></i><div>${n.txt}</div></div>`).join('')}</section>`
    },

    _group(lbl, cur, ideal, pct, kind) {
      const amount = Number(cur?.amount) || 0
      const perc = Number(cur?.percentage) || 0
      const idealV = Number(ideal) || 0
      const alvo = Number(pct) || 0
      const acima = amount > idealV
      const tone = kind === 'save' ? (perc >= alvo ? 'ok' : 'warn') : (acima ? 'neg' : 'ok')
      const barCor = tone === 'ok' ? 'var(--terminal-primary)' : tone === 'warn' ? 'var(--terminal-accent)' : 'var(--terminal-negative)'
      const w = Math.min(100, perc)
      return `<div class="rg-group">
        <div class="rg-group__top"><span class="rg-group__lbl">${esc(lbl)}</span><span class="rg-group__pct rg-group__pct--${tone}">${perc.toFixed(0)}% <em>/ ${alvo}%</em></span></div>
        <div class="rg-track"><span class="rg-track__ideal" style="left:${Math.min(100, alvo)}%"></span><span class="rg-track__fill" style="width:${w}%;background:${barCor}"></span></div>
        <div class="rg-group__vals"><span>${money(amount)}</span><span>ideal ${money(idealV)}</span></div>
      </div>`
    },

    _topCol(title, arr, kind) {
      if (!arr || !arr.length) return ''
      const max = Math.max(...arr.map(a => Number(a.val) || 0), 1)
      return `<article class="td-panel">
        <div class="td-panel__head"><div><span class="td-eyebrow">${kind === 'need' ? 'Essenciais' : 'Estilo de vida'}</span><h2>${esc(title)}</h2></div></div>
        <div class="rg-top">${arr.map(a => `<div class="rg-top__row"><span class="rg-top__cat" title="${esc(a.cat)}">${esc(a.cat)}</span><div class="rg-top__track"><span style="width:${(Number(a.val) / max * 100).toFixed(0)}%;background:${kind === 'need' ? 'var(--terminal-primary)' : 'var(--terminal-accent)'}"></span></div><span class="rg-top__val">${money(a.val)}</span></div>`).join('')}</div>
      </article>`
    },
  }
})()
