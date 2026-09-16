/**
 * Diagnóstico — a leitura dos números.
 *
 * A tela antiga tinha score próprio (17), KPIs do mês corrente e um veredicto
 * "🚨 Situação Crítica" que só existia porque era dia 14. Tudo isso saiu.
 *
 * O que ficou é o que nenhuma outra tela faz: a MESMA nota do Dashboard,
 * aberta — de onde vêm os pontos, para onde foram os que faltam, e o que
 * devolve cada um. Mais os alertas de cruzamento, que são a coisa original
 * daqui: regras que olham duas áreas ao mesmo tempo.
 *
 * A Projeção responde "quanto, e quando". Esta responde "e daí, o que eu
 * faço". Não voltam a discordar porque as duas leem da mesma camada.
 */
(function () {
  const esc = (v) => String(v ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;')
  const money = (v) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 2 }).format(Number(v) || 0)
  const moneyR = (v) => 'R$ ' + Math.abs(Math.round(Number(v) || 0)).toLocaleString('pt-BR')
  const pct = (v, d = 1) => (Number(v) || 0).toLocaleString('pt-BR', { maximumFractionDigits: d }) + '%'

  const MES3 = { '01': 'jan', '02': 'fev', '03': 'mar', '04': 'abr', '05': 'mai', '06': 'jun',
                 '07': 'jul', '08': 'ago', '09': 'set', '10': 'out', '11': 'nov', '12': 'dez' }
  const mesCurto = (s) => {
    const m = String(s || '').match(/^(\d{4})-(\d{2})/)
    return m ? `${MES3[m[2]]}/${m[1].slice(2)}` : String(s || '')
  }

  const TOM = { critico: 'neg', alto: 'warn', medio: 'info' }
  const TOM_ICO = { critico: 'fa-circle-exclamation', alto: 'fa-triangle-exclamation', medio: 'fa-circle-info' }

  window.VMTerminalDiagnostico = {
    async render(vm) {
      this._vm = vm
      const content = document.getElementById('page-content')
      if (!content) return
      document.body.classList.add('terminal-dashboard-active')
      content.innerHTML = '<div class="td-loading"><span></span><span></span><span></span></div>'
      try {
        this._d = await vm.api('GET', 'diagnostico')
        this._paint()
      } catch (e) {
        const err = e.response?.data
        content.innerHTML = `<div class="td-error"><i class="fas fa-triangle-exclamation"></i>
          <h2>Não foi possível gerar o diagnóstico</h2><p>${esc(err?.error || 'Tente novamente.')}</p>
          <button class="ds-btn ds-btn--primary" onclick="VMTerminalDiagnostico.reload()">Tentar novamente</button></div>`
      }
    },
    reload() { this.render(this._vm) },

    _paint() {
      const content = document.getElementById('page-content')
      if (!content) return
      const d = this._d || {}
      const sc = d.score || {}

      if (!sc.disponivel) {
        return void (content.innerHTML = this._shell(`
          ${this._semDados(sc, d)}
          ${this._alertas(d)}
        `))
      }

      content.innerHTML = this._shell(`
        ${this._nota(d, sc)}
        ${this._confianca(d)}
        ${this._pilares(sc)}
        ${this._alertas(d)}
        ${this._recomendacoes(d, sc)}
        ${this._rodape(d)}
      `)
    },

    // ── O quanto esta tela sabe de si mesma ──────────────────────────────────
    //
    // Fica logo abaixo da nota de propósito. Uma nota sozinha convida a
    // acreditar; uma nota com o seu próprio grau de certeza ao lado convida a
    // conferir — e diz onde conferir primeiro.
    _confianca(d) {
      const c = d.confianca
      if (!c || !c.fatores?.length) return ''

      const cor = c.nota >= 70 ? 'var(--terminal-primary)'
        : c.nota >= 45 ? 'var(--terminal-accent)' : 'var(--terminal-negative)'
      const rotulo = { alta: 'confiança alta', media: 'confiança média',
                       baixa: 'confiança baixa', insuficiente: 'confiança insuficiente' }[c.nivel] || ''

      const barras = c.fatores.map(f => `
        <div class="dg-conf__fator${c.limitante && f.chave === c.limitante.chave ? ' is-gargalo' : ''}">
          <div class="dg-conf__topo">
            <span class="dg-conf__rot">${esc(f.rotulo)}</span>
            <span class="dg-conf__num">${f.nota}</span>
          </div>
          <div class="dg-conf__trilho">
            <i style="width:${Math.max(2, f.nota)}%;background:${
              f.nota >= 70 ? 'var(--terminal-primary)'
                : f.nota >= 40 ? 'var(--terminal-accent)' : 'var(--terminal-negative)'};"></i>
          </div>
          <p>${esc(f.leitura)}</p>
        </div>`).join('')

      const gargalo = c.limitante && c.limitante.saida
        ? `<p class="dg-conf__saida"><b>Onde você ganha mais:</b> ${esc(c.limitante.saida)}</p>`
        : ''

      return `<section class="td-panel dg-conf dg-sec">
        <header class="dg-conf__cab">
          <div>
            <span class="td-eyebrow">O quanto eu sei</span>
            <h2>Esta leitura está <em style="color:${cor}">${c.nota}% certa</em>.</h2>
          </div>
          <span class="dg-nota__nivel ${c.nota >= 70 ? 'is-ok' : c.nota >= 45 ? 'is-warn' : 'is-neg'}">${esc(rotulo)}</span>
        </header>
        <p class="dg-fonte">A nota acima vale o que valem os dados por trás dela. Estes são os
          quatro elos, e a corrente vale o mais fraco — não a média deles.</p>
        <div class="dg-conf__grade">${barras}</div>
        ${gargalo}
      </section>`
    },

    // ── A nota, e o que ela não é ────────────────────────────────────────────
    _nota(d, sc) {
      const v = d.variacao
      const hist = d.historico || []
      const cor = sc.total >= 60 ? 'var(--terminal-primary)'
        : sc.total >= 35 ? 'var(--terminal-accent)' : 'var(--terminal-negative)'
      const circ = 2 * Math.PI * 38

      // A frase do topo tem que dizer o que a nota é e o que está por trás
      // dela. "Situação crítica" sozinho não é diagnóstico, é adjetivo.
      const melhor = [...(sc.pilares || [])].sort((a, b) => (b.pontos / b.peso) - (a.pontos / a.peso))[0]
      const pior = [...(sc.pilares || [])].sort((a, b) => (a.pontos / a.peso) - (b.pontos / b.peso))[0]

      return `<article class="td-panel dg-nota">
        <div class="dg-nota__anel">
          <svg viewBox="0 0 96 96" width="128" height="128" aria-label="nota ${sc.total} de 100">
            <circle cx="48" cy="48" r="38" fill="none" stroke="var(--terminal-line)" stroke-width="10"/>
            <circle cx="48" cy="48" r="38" fill="none" stroke="${cor}" stroke-width="10"
                    stroke-linecap="round" stroke-dasharray="${(sc.total / 100) * circ} ${circ}"
                    transform="rotate(-90 48 48)"/>
            <text x="48" y="46" text-anchor="middle" font-size="26" font-weight="700"
                  fill="var(--terminal-ink)">${sc.total}</text>
            <text x="48" y="62" text-anchor="middle" font-size="9"
                  font-family="var(--terminal-mono)" fill="var(--terminal-ink-soft)">/ 100</text>
          </svg>
          <span class="dg-nota__nivel is-${sc.nivel === 'boa' ? 'ok' : sc.nivel === 'atenção' ? 'warn' : 'neg'}">${esc(sc.nivel)}</span>
        </div>
        <div class="dg-nota__txt">
          <span class="td-eyebrow">A mesma nota do painel, aberta</span>
          <h2>${pior && melhor ? `${esc(pior.nome)} é o que mais pesa contra. ${esc(melhor.nome)} é o que está te segurando.` : 'Sua saúde financeira'}</h2>
          <p>${this._frase(d, sc)}</p>
          ${v ? `<div class="dg-var ${v.pontos > 0 ? 'is-ok' : 'is-neg'}">
            <i class="fas fa-arrow-${v.pontos > 0 ? 'up' : 'down'}"></i>
            <span><b>${v.pontos > 0 ? '+' : ''}${v.pontos} ${Math.abs(v.pontos) === 1 ? 'ponto' : 'pontos'}</b>
              desde ${esc(mesCurto(v.desde))}${v.pilar ? ` — o que mais rende hoje é ${esc(v.pilar)}` : ''}.</span>
          </div>` : ''}
          ${hist.length >= 3 ? this._spark(hist) : ''}
        </div>
      </article>`
    },

    _frase(d, sc) {
      const x = d.contexto || {}
      const partes = []
      if (Number(x.reserva_meses) < 1) partes.push('sem reserva')
      else partes.push(`${pct(x.reserva_meses, 1).replace('%', '')} ${Number(x.reserva_meses) === 1 ? 'mês' : 'meses'} de reserva`)
      if (Number(x.comprometimento) > 0) partes.push(`${pct(x.comprometimento)} da renda comprometida`)
      const rumo = (sc.pilares || []).find(p => p.chave === 'rumo')
      const cauda = rumo && rumo.nota >= 60 ? ' — mas melhorando' : ''
      return `${partes.join(' e ')}${cauda}. A nota olha só meses fechados: ela não muda conforme o dia do mês.`
    },

    /**
     * Um score sem histórico é uma nota; com histórico, é um retorno.
     *
     * A escala é a FAIXA DOS DADOS com folga, não 0–100. Numa conta que foi de
     * 11 a 23 pontos, o eixo fixo desenharia uma reta rente ao chão e
     * esconderia justamente o que a linha existe para mostrar: que mudou.
     */
    _spark(hist) {
      const ult = hist.slice(-12)
      const w = 220, h = 44
      const vals = ult.map(p => p.score)
      const lo = Math.min(...vals), hi = Math.max(...vals)
      const folga = Math.max(4, (hi - lo) * 0.25)
      const min = Math.max(0, lo - folga), max = Math.min(100, hi + folga)
      const faixa = Math.max(1, max - min)
      const px = (i) => (i / Math.max(1, ult.length - 1)) * (w - 8) + 4
      const py = (v) => h - 6 - ((v - min) / faixa) * (h - 12)
      const pts = ult.map((p, i) => `${px(i).toFixed(1)},${py(p.score).toFixed(1)}`).join(' ')
      return `<div class="dg-spark">
        <svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-label="nota nos últimos meses">
          <polyline fill="none" stroke="var(--terminal-primary)" stroke-width="2"
                    stroke-linejoin="round" points="${pts}"/>
          <circle cx="${px(ult.length - 1).toFixed(1)}" cy="${py(ult[ult.length - 1].score).toFixed(1)}"
                  r="3" fill="var(--terminal-primary)"/>
        </svg>
        <span>${esc(mesCurto(ult[0].mes))} → ${esc(mesCurto(ult[ult.length - 1].mes))} · ${lo} a ${hi}</span>
      </div>`
    },

    // ── De onde vêm os pontos ────────────────────────────────────────────────
    _pilares(sc) {
      const p = sc.pilares || []
      const perdidos = p.reduce((s, x) => s + (x.peso - x.pontos), 0)
      return `<article class="td-panel dg-sec">
        <div class="td-panel__head"><div><span class="td-eyebrow">De onde vêm os ${sc.total} pontos</span>
          <h2>Os cinco pilares</h2></div></div>
        <p class="dg-fonte">Cada pilar tem um peso fixo. Os ${Math.round(perdidos * 10) / 10} pontos
          que faltam para 100 não são castigo: cada um está num lugar concreto, e a tabela mais
          abaixo diz quanto custa ir buscá-lo.</p>
        <div class="dg-pilares">
          ${p.map(x => this._pilar(x)).join('')}
        </div>
      </article>`
    },

    _pilar(x) {
      const cheio = x.peso > 0 ? (x.pontos / x.peso) * 100 : 0
      const cor = cheio >= 60 ? 'var(--terminal-primary)' : cheio > 0 ? 'var(--terminal-accent)' : 'var(--terminal-negative)'
      return `<div class="dg-pilar">
        <div class="dg-pilar__top">
          <strong>${esc(x.nome)}</strong>
          <b>${x.pontos}<span>/${x.peso}</span></b>
        </div>
        <div class="dg-pilar__trilho"><span style="width:${Math.max(2, cheio).toFixed(0)}%;background:${cor}"></span></div>
        <div class="dg-pilar__pe"><span>${esc(x.valor)}</span></div>
        <p>${esc(x.explicacao)}</p>
      </div>`
    },

    // ── Os alertas de cruzamento ─────────────────────────────────────────────
    _alertas(d) {
      const a = d.alertas || []
      if (!a.length) {
        return `<article class="td-panel dg-sec">
          <div class="td-panel__head"><div><span class="td-eyebrow">O que atrapalha</span>
            <h2>Nenhum conflito entre áreas</h2></div></div>
          <p class="dg-fonte">Estas regras olham duas coisas ao mesmo tempo — investir enquanto se
            paga juro maior, aportar sem ter reserva, assinar o que ainda não começou a sair.
            Hoje nenhuma delas dispara para você.</p>
        </article>`
      }
      return `<article class="td-panel dg-sec">
        <div class="td-panel__head"><div><span class="td-eyebrow">O que atrapalha</span>
          <h2>${a.length} ${a.length === 1 ? 'conflito entre áreas' : 'conflitos entre áreas'}</h2></div></div>
        <p class="dg-fonte">Cada um destes olha duas coisas ao mesmo tempo — é o que nenhuma outra
          tela faz. Nada abaixo de ${money(d.piso_alerta)} aparece aqui: alarme vermelho sobre
          valor irrelevante é o que faz alguém parar de ler os alertas bons.</p>
        <div class="dg-alertas">${a.map(x => this._alerta(x)).join('')}</div>
      </article>`
    },

    _alerta(x) {
      const t = TOM[x.severidade] || 'info'
      return `<div class="dg-alerta is-${t}">
        <i class="fas ${TOM_ICO[x.severidade] || 'fa-circle-info'} dg-alerta__ico"></i>
        <div class="dg-alerta__corpo">
          <strong>${esc(x.titulo)}</strong>
          <p>${esc(x.descricao)}</p>
          <p class="dg-alerta__acao"><b>O que fazer:</b> ${esc(x.acao)}</p>
          ${x.no_contexto ? `<span class="dg-alerta__onde">também aparece em ${esc(x.no_contexto)}</span>` : ''}
        </div>
      </div>`
    },

    // ── O que fazer, com o preço de cada coisa ───────────────────────────────
    _recomendacoes(d, sc) {
      const r = d.recomendacoes || []
      if (!r.length) return ''
      const semEfeito = r.filter(x => x.devolve <= 0)
      return `<article class="td-panel dg-sec">
        <div class="td-panel__head"><div><span class="td-eyebrow">O que fazer</span>
          <h2>Cada ação, e o que ela devolve da nota</h2></div></div>
        <p class="dg-fonte">"Melhore sua saúde financeira" é conselho de biscoito da sorte.
          Cada linha abaixo é a MESMA fórmula da nota recalculada sobre o cenário em que você fez
          aquilo — não uma estimativa à parte.</p>
        <div class="ds-tablewrap">
          <table class="ds-table dg-tab">
            <thead><tr><th>Se você…</th><th class="dg-tar">Custa</th>
              <th class="dg-tar">Devolve</th><th class="dg-tar">Nota vai a</th></tr></thead>
            <tbody>
              ${r.map(x => `<tr class="${x.ordem ? 'is-ordem' : ''}">
                <td>${esc(x.acao)}${x.nota ? `<small>${esc(x.nota)}</small>` : ''}</td>
                <td class="dg-tar">${x.custa > 0 ? money(x.custa) : '—'}</td>
                <td class="dg-tar"><b class="${x.devolve > 0 ? 'is-ok' : 'is-mudo'}">${x.devolve > 0 ? '+' : ''}${x.devolve}</b></td>
                <td class="dg-tar">${x.nota_depois}</td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>
        ${semEfeito.length ? `<div class="ds-note ds-note--info dg-nota-txt">
          <i class="fas fa-scale-balanced ds-note__ico"></i>
          <div><b>Olhe as linhas que devolvem zero.</b> Elas continuam valendo a pena pelo dinheiro —
            o score é que não tem mais o que premiar naquele pilar. Ele mede saúde, não mérito, e
            dizer isso em voz alta é o que impede alguém de otimizar o número em vez do dinheiro.</div>
        </div>` : ''}
      </article>`
    },

    _rodape(d) {
      const x = d.contexto || {}
      const at = x.atipicos || []
      return `<article class="td-panel dg-sec dg-base">
        <div class="td-panel__head"><div><span class="td-eyebrow">De onde saem estes números</span>
          <h2>A régua</h2></div></div>
        <div class="dg-grade">
          ${this._ref('Renda de referência', money(x.renda), `média de ${x.renda_meses_base} meses fechados + recorrentes`)}
          ${this._ref('Prestações do mês', money(x.prestacoes), `${pct(x.comprometimento)} da renda`)}
          ${this._ref('Dívida que já sai', money(x.divida_vigente), 'cartões, empréstimos e financiamentos iniciados')}
          ${this._ref('Dívida contratada', money(x.divida_contratada), 'assinada, ainda não começou a sair')}
          ${this._ref('Gasto essencial', money(x.gasto_essencial), `de ${money(x.gasto_total)} que saem no total`)}
          ${this._ref('Reserva', money(x.reserva_atual), `alvo ${money(x.reserva_alvo)} · 6 meses de essencial`)}
        </div>
        <p class="dg-fonte">Todos estes números vêm da mesma camada que a Projeção e o painel leem.
          Se algum deles estiver errado, está errado nas três telas ao mesmo tempo — que é
          exatamente o que se queria: um número, um dono.
          ${at.length ? ` ${at.length} ${at.length === 1 ? 'mês ficou de fora por ser atípico' : 'meses ficaram de fora por serem atípicos'}: ${at.map(a => `${esc(a.label)} (${esc(a.motivo)})`).join(', ')}.` : ''}</p>
      </article>`
    },

    _ref(lbl, val, sub) {
      return `<div class="dg-ref"><span>${esc(lbl)}</span><b>${val}</b><small>${esc(sub)}</small></div>`
    },

    // ── Quando o app não sabe o suficiente ───────────────────────────────────
    //
    // Não fica mudo: fica específico. Some o agregado — a nota e as
    // recomendações precificadas — e ficam os fatos, que continuam valendo
    // (os alertas são sobre contrato assinado, não sobre a janela), mais a
    // conta exata do que falta para o agregado voltar.
    _semDados(sc, d) {
      const n = d.contexto?.meses_fechados ?? 0
      const c = d.confianca
      const culpados = (c?.fatores || []).filter(f => f.cala)

      const lista = culpados.length ? `<ul class="dg-vazio__lista">${culpados.map(f => `
        <li><b>${esc(f.rotulo)}.</b> ${esc(f.leitura)}${f.saida ? ` <span>${esc(f.saida)}</span>` : ''}</li>`).join('')}</ul>` : ''

      const destino = culpados.some(f => f.chave === 'amostra') ? 'despesas' : 'organizador'
      const botao = destino === 'despesas' ? 'Lançar o que falta' : 'Abrir a Central de Organização'

      return `<article class="td-panel dg-vazio">
        <i class="fas fa-seedling"></i>
        <h2>Ainda não dá para te dar uma nota.</h2>
        <p>${esc(sc.motivo_indisponivel || c?.motivo || `Com ${n} meses fechados não dá para dizer o que é normal para você.`)}</p>
        ${lista}
        <p class="dg-vazio__p2">Isto é de propósito. Uma nota tirada de dado pela metade pareceria
          precisa e não seria — e você tomaria decisão em cima dela. Os alertas abaixo continuam
          valendo: eles são sobre contrato assinado, não sobre média de mês.</p>
        <button class="ds-btn ds-btn--primary" onclick="VM.navigate('${destino}')">${botao}</button>
      </article>`
    },

    _shell(inner) {
      return `<div class="td-dashboard dg">
        <header class="td-dashboard__header">
          <div>
            <span class="td-eyebrow">E daí? O que eu faço?</span>
            <h1>Diagnóstico. <em>A leitura dos números.</em></h1>
            <p>A Projeção diz quanto e quando. Esta tela diz o que isso significa e o que fazer a
              respeito — com o preço de cada decisão em pontos.</p>
          </div>
        </header>
        ${inner}
      </div>`
    },
  }
})()
