(function () {
  const esc = (v) => String(v ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;')
  const money = (v) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 2 }).format(Number(v) || 0)
  const MES_LONGO = { jan:'janeiro', fev:'fevereiro', mar:'março', abr:'abril', mai:'maio', jun:'junho',
                      jul:'julho', ago:'agosto', set:'setembro', out:'outubro', nov:'novembro', dez:'dezembro' }
  /** 'Set/2027' → 'setembro de 2027'. O eixo do gráfico cabe abreviado; frase não. */
  const porExtenso = (lbl) => {
    const m = String(lbl || '').match(/^([A-Za-zçÇ]{3})\/?(\d{4})?$/)
    if (!m) return String(lbl || '')
    const nome = MES_LONGO[m[1].toLowerCase()] || m[1]
    return m[2] ? `${nome} de ${m[2]}` : nome
  }
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
            <p class="pj-hero__sub">É o seu saldo acumulado em <strong>${esc(porExtenso(ultimoLabel))}</strong>, se o padrão dos últimos meses se mantiver. Já entram as parcelas e recorrências que você tem contratadas; não entram aportes nem resgates de investimento.</p>
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

        <article class="td-panel pj-sec">
          <div class="td-panel__head"><div><span class="td-eyebrow">Três futuros possíveis</span><h2>Onde você fecha ${esc(porExtenso(ultimoLabel))}</h2></div></div>
          <div class="pj-cenarios">
            ${this._cenario('Se tudo melhorar', resumo.cenario_otimista_12m, 'ok',
              'Receitas 10% maiores e despesas 5% menores que a sua média. É o teto realista — não a sorte grande.')}
            ${this._cenario('Se nada mudar', resumo.projecao_12m, 'base',
              'Você mantém exatamente o padrão dos últimos meses. É o cenário mais provável, e o que a linha do gráfico desenha.')}
            ${this._cenario('Se apertar', resumo.cenario_pessimista_12m, 'neg',
              'Receitas 10% menores e despesas 10% maiores. Serve para responder uma pergunta só: eu aguento?')}
          </div>
        </article>

        ${this._analise(d)}

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

    /** Um cenário, com o que ele assume dito em português. */
    _cenario(titulo, valor, tone, explica) {
      const v = Number(valor) || 0
      const cor = tone === 'ok' ? 'var(--terminal-primary)' : tone === 'neg' ? 'var(--terminal-negative)' : 'var(--terminal-ink)'
      return `<article class="pj-cen pj-cen--${tone}">
        <span class="td-eyebrow">${esc(titulo)}</span>
        <strong style="color:${cor}">${money(v)}</strong>
        <p>${esc(explica)}</p>
      </article>`
    },

    /**
     * A leitura que faltava.
     *
     * A tela dava três totais e nenhuma conclusão. Aqui entram as perguntas
     * que decidem alguma coisa: de onde sai a sobra do mês, quando o dinheiro
     * acaba se acabar, e quanto uma mudança de hábito muda o fim do ano.
     */
    _analise(d) {
      const a = d.analise
      if (!a) return ''
      const comp = a.composicao || []
      const maior = Math.max(1, ...comp.map(x => Math.abs(Number(x.valor) || 0)))
      const sobra = Number(a.sobra_mensal) || 0
      const MES = { '01':'janeiro','02':'fevereiro','03':'março','04':'abril','05':'maio','06':'junho','07':'julho','08':'agosto','09':'setembro','10':'outubro','11':'novembro','12':'dezembro' }
      const porExtenso = (chave) => {
        if (!chave) return ''
        const [ano, mes] = String(chave).split('-')
        return `${MES[mes] || mes} de ${ano}`
      }

      const notas = []
      if (a.zera_base) {
        notas.push({ t: 'neg', ico: 'fa-triangle-exclamation', txt: `<strong>Mantido o padrão atual, seu saldo fica negativo em ${esc(porExtenso(a.zera_base.label))}.</strong> Não é uma previsão de catástrofe — é o que acontece se nada mudar até lá. Faltam ${money(a.ajuste_necessario)} por mês para virar o jogo.` })
      } else if (a.zera_pessimista) {
        notas.push({ t: 'warn', ico: 'fa-shield-halved', txt: `<strong>No cenário base você fecha no positivo; no aperto, o saldo zera em ${esc(porExtenso(a.zera_pessimista.label))}.</strong> É a margem que você tem antes de precisar mexer em alguma coisa.` })
      } else {
        notas.push({ t: 'ok', ico: 'fa-circle-check', txt: `<strong>Você fecha o horizonte no positivo nos três cenários.</strong> Mesmo com receita 10% menor e despesa 10% maior, a conta se sustenta.` })
      }

      if (a.pct_comprometido > 0) {
        const alto = a.pct_comprometido >= 40
        notas.push({ t: alto ? 'warn' : 'info', ico: 'fa-lock', txt: `<strong>${a.pct_comprometido}% da sua receita já está comprometida</strong> com recorrências e parcelas antes de você decidir qualquer coisa no mês. ${alto ? 'Acima de 40%, sobra pouca margem para imprevisto.' : 'O resto é o que você consegue realocar.'}` })
      }

      if (a.mes_alivio_parcelas) {
        notas.push({ t: 'ok', ico: 'fa-calendar-check', txt: `<strong>O peso das parcelas cai pela metade em ${esc(porExtenso(a.mes_alivio_parcelas.chave))}</strong> — de ${money(a.mes_alivio_parcelas.pico)} para ${money(a.mes_alivio_parcelas.valor)} no mês. Essa folga já está contratada; é só não preenchê-la com parcela nova.` })
      }

      notas.push({ t: 'info', ico: 'fa-calculator', txt: `<strong>Cada R$ 100 a menos por mês viram ${money(a.impacto_100_por_mes)} em ${a.horizonte_meses} meses.</strong> É a régua para decidir se um corte vale o incômodo.` })

      return `<article class="td-panel pj-sec">
        <div class="td-panel__head"><div><span class="td-eyebrow">Leitura do cenário</span><h2>De onde sai esse número</h2></div></div>

        <div class="pj-analise">
          <div class="pj-comp">
            ${comp.map(x => {
              const v = Math.abs(Number(x.valor) || 0)
              const pos = Number(x.sinal) > 0
              return `<div class="pj-comp__row">
                <div class="pj-comp__rot"><strong>${esc(x.rotulo)}</strong><small>${esc(x.detalhe)}</small></div>
                <div class="ds-bar"><span class="${pos ? '' : 'is-neg'}" style="width:${(v / maior) * 100}%"></span></div>
                <b style="color:${pos ? 'var(--terminal-primary)' : 'var(--terminal-negative)'}">${pos ? '+' : '−'}${money(v)}</b>
              </div>`
            }).join('')}
            <div class="pj-comp__row pj-comp__row--total">
              <div class="pj-comp__rot"><strong>Sobra por mês</strong><small>é o que empurra a linha do gráfico para cima</small></div>
              <div></div>
              <b style="color:${sobra >= 0 ? 'var(--terminal-primary)' : 'var(--terminal-negative)'}">${sobra >= 0 ? '+' : '−'}${money(Math.abs(sobra))}</b>
            </div>
          </div>

          <div class="pj-analise__notas">
            ${notas.slice(0, 4).map(n => `<div class="ds-note ds-note--${n.t}"><i class="fas ${n.ico} ds-note__ico"></i><div>${n.txt}</div></div>`).join('')}
          </div>
        </div>
      </article>`
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
