/**
 * VerdeMais — Desafio das 52 semanas
 * ============================================================================
 * A tela mostrava a grade das 52 semanas e o total guardado. Faltava o que
 * decide se alguém termina um desafio de um ano: saber se está em dia. Quem
 * marcou 12 semanas na semana 20 não está "com 23%" — está oito semanas
 * atrás, e é esse número que faz a pessoa correr atrás.
 *
 * Agora a tela abre com o ritmo, mostra o que já venceu e não foi guardado,
 * projeta o fechamento do ano no ritmo atual e separa a grade por trimestre.
 */
(function () {
  const esc = (v) => String(v ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;')
  const money = (v) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 2 }).format(Number(v) || 0)
  const TRI = [[1, 13, '1º trimestre'], [14, 26, '2º trimestre'], [27, 39, '3º trimestre'], [40, 52, '4º trimestre']]

  window.VMTerminalDesafio = {
    async render(vm, ano) {
      this._vm = vm
      this._ano = Number(ano || this._ano || new Date().getFullYear())
      const content = document.getElementById('page-content')
      if (!content) return
      document.body.classList.add('terminal-dashboard-active')
      content.innerHTML = '<div class="td-loading"><span></span><span></span><span></span></div>'
      try {
        const [data, metas] = await Promise.all([
          vm.api('GET', `desafio-52?ano=${this._ano}`),
          vm.api('GET', 'metas').catch(() => ({ metas: [] })),
        ])
        this._data = data
        this._metas = (metas.metas || []).filter(m => m.status === 'ativa')
        this._paint()
      } catch (e) {
        content.innerHTML = `<div class="td-error"><i class="fas fa-triangle-exclamation"></i><h2>Não foi possível carregar o Desafio 52</h2><p>${esc(e.response?.data?.error || 'Tente novamente.')}</p><button class="ds-btn ds-btn--primary" onclick="VM.pageDesafio52()">Tentar novamente</button></div>`
      }
    },
    reload() { this.render(this._vm, this._ano) },
    setAno(a) { this.render(this._vm, Number(a)) },

    /**
     * Tudo que a tela precisa e o backend não calcula. O ano passado tem 52
     * semanas todas vencidas; o ano que vem, nenhuma — daí o clamp.
     */
    _calc() {
      const d = this._data
      const weeks = (d.weeks || []).slice().sort((a, b) => a.week_number - b.week_number)
      const s = d.summary || {}
      const anoAtual = new Date().getFullYear()
      const semanaAgora = this._ano < anoAtual ? 52 : this._ano > anoAtual ? 0 : Math.min(52, Math.max(1, Number(d.current_week) || 1))
      const feitas = weeks.filter(w => w.status === 'completed')
      const vencidas = weeks.filter(w => w.week_number <= semanaAgora)
      // "Atrasada" é semana já vencida que não foi guardada nem pulada de
      // propósito: pular é uma decisão, esquecer não.
      const atrasadas = vencidas.filter(w => w.status === 'pending')
      const totalAno = Number(d.config?.total_anual || s.total_target || 0)
      const guardado = Number(s.total_saved || 0)
      const emAtraso = atrasadas.reduce((acc, w) => acc + Number(w.target_amount || 0), 0)
      // Projeção pelo ritmo real: quanto ele guarda por semana vencida,
      // estendido às 52. Sem semana vencida ainda, não há ritmo a projetar.
      const ritmo = vencidas.length ? guardado / vencidas.length : 0
      const projecao = vencidas.length ? Math.min(totalAno, ritmo * 52) : totalAno
      const aderencia = vencidas.length ? Math.round((feitas.length / vencidas.length) * 100) : 100
      const proxima = weeks.find(w => w.week_number > semanaAgora) || null
      const atual = weeks.find(w => w.week_number === semanaAgora) || null
      return {
        weeks, s, semanaAgora, feitas, vencidas, atrasadas, totalAno, guardado,
        emAtraso, projecao, aderencia, proxima, atual,
        falta: Math.max(0, totalAno - guardado),
        emDia: atrasadas.length === 0,
      }
    },

    _paint() {
      const content = document.getElementById('page-content')
      if (!content) return
      const d = this._data
      const cfg = d.config || {}
      const c = this._calc()
      const concluido = c.feitas.length >= 52
      const anos = [this._ano - 1, this._ano, this._ano + 1]
      const stSel = 'background:var(--terminal-surface);border:1px solid var(--terminal-line);color:var(--terminal-ink);border-radius:var(--terminal-radius-sm);padding:9px 12px;font-size:13px;font-family:var(--terminal-font)'

      content.innerHTML = `<div class="td-dashboard d52">
        <header class="td-dashboard__header">
          <div>
            <span class="td-eyebrow">Poupança gamificada</span>
            <h1>Desafio 52. <em>Uma semana de cada vez.</em></h1>
            <p>Guarde um valor por semana. O que importa não é o total no fim — é não deixar semana passar em branco.</p>
          </div>
          <div class="td-dashboard__header-actions">
            <select style="${stSel}" onchange="VMTerminalDesafio.setAno(this.value)">
              ${anos.map(a => `<option value="${a}" ${a === this._ano ? 'selected' : ''}>${a}</option>`).join('')}
            </select>
            <button class="ds-btn" onclick="VMTerminalDesafio.config()"><i class="fas fa-sliders"></i> Personalizar</button>
            <button class="ds-btn ds-btn--danger" onclick="VMTerminalDesafio.reset()"><i class="fas fa-rotate-left"></i> Reiniciar</button>
          </div>
        </header>

        ${concluido ? this._fechamento(c) : ''}
        ${this._hero(c, cfg)}
        ${this._kpis(c)}
        ${this._notas(c, cfg)}
        ${this._trilha(c)}
        ${c.atrasadas.length ? this._atrasadas(c) : ''}
      </div>`
    },

    // ── ação da semana + progresso ───────────────────────────────────────────
    _hero(c, cfg) {
      const pct = c.totalAno > 0 ? Math.min(100, (c.guardado / c.totalAno) * 100) : 0
      const alvoRitmo = c.vencidas.length ? (c.vencidas.reduce((a, w) => a + Number(w.target_amount || 0), 0)) : 0
      const w = c.atual
      const acaoTitulo = this._ano > new Date().getFullYear()
        ? `O desafio de ${this._ano} ainda não começou`
        : w && w.status === 'completed' ? `Semana ${c.semanaAgora} guardada ✓`
        : w ? `Guarde ${money(w.target_amount)} nesta semana`
        : 'Desafio encerrado'

      return `<section class="d52-hero">
        <article class="d52-hero__main">
          <div class="d52-act">
            <div>
              <span class="td-eyebrow">${c.semanaAgora ? `Semana ${c.semanaAgora} de 52` : `Ano de ${this._ano}`}</span>
              <h2>${acaoTitulo}</h2>
              <p>${c.emDia
                ? 'Você não deixou nenhuma semana vencida para trás. Esse é o jogo inteiro.'
                : c.atrasadas.length === 1
                  ? `Uma semana venceu sem ser guardada — ${money(c.emAtraso)} em atraso.`
                  : `${c.atrasadas.length} semanas venceram sem ser guardadas — ${money(c.emAtraso)} em atraso.`}</p>
            </div>
            ${w && w.status !== 'completed' && this._ano <= new Date().getFullYear()
              ? `<button class="ds-btn ds-btn--primary ds-btn--lg" onclick="VMTerminalDesafio.marcar(${w.week_number}, 'completed')"><i class="fas fa-check"></i> Marcar como guardada</button>`
              : ''}
          </div>

          <div class="d52-prog">
            <div class="d52-prog__top">
              <span>${money(c.guardado)} <em>de ${money(c.totalAno)}</em></span>
              <span>${pct.toFixed(0)}%</span>
            </div>
            <div class="ds-bar ds-bar--lg">
              <span style="width:${pct}%"></span>
              ${alvoRitmo > 0 && c.totalAno > 0 ? `<i class="d52-prog__pace" style="left:${Math.min(100, (alvoRitmo / c.totalAno) * 100)}%" title="Onde você estaria em dia: ${money(alvoRitmo)}"></i>` : ''}
            </div>
            <div class="d52-prog__foot">
              <small>${alvoRitmo > 0 ? `A marca mostra onde você estaria em dia: ${money(alvoRitmo)}` : 'Comece marcando a primeira semana.'}</small>
              <small>faltam ${money(c.falta)}</small>
            </div>
          </div>
        </article>

        <aside class="d52-side">
          <div class="d52-ring">
            ${this._ring(c.aderencia)}
            <div class="d52-ring__label"><strong>${c.aderencia}%</strong><small>em dia</small></div>
          </div>
          <div class="d52-side__stats">
            <div><strong>${c.feitas.length}</strong><small>guardadas</small></div>
            <div><strong>${c.vencidas.length}</strong><small>vencidas</small></div>
          </div>
          <div class="d52-side__meta">Meta do ano: <strong>${money(c.totalAno)}</strong>${cfg.modo_invertido ? ' · <span style="color:#6EA8FE">modo invertido</span>' : ''}</div>
        </aside>
      </section>`
    },

    _kpis(c) {
      const proj = c.projecao
      const bateMeta = proj >= c.totalAno * 0.995
      return `<div class="ds-kpi-grid" style="margin:0 0 16px">
        <article class="ds-kpi">
          <span class="ds-kpi__lbl">Guardado</span>
          <b class="ds-kpi__val ds-kpi__val--ok">${money(c.guardado)}</b>
          <span class="ds-kpi__hint">${c.feitas.length} de 52 semanas</span>
        </article>
        <article class="ds-kpi">
          <span class="ds-kpi__lbl">Em atraso</span>
          <b class="ds-kpi__val ${c.emAtraso > 0 ? 'ds-kpi__val--neg' : ''}">${money(c.emAtraso)}</b>
          <span class="ds-kpi__hint">${c.atrasadas.length === 0 ? 'nada pendente — em dia' : c.atrasadas.length === 1 ? '1 semana vencida sem guardar' : `${c.atrasadas.length} semanas vencidas sem guardar`}</span>
        </article>
        <article class="ds-kpi">
          <span class="ds-kpi__lbl">Projeção do ano</span>
          <b class="ds-kpi__val ${bateMeta ? 'ds-kpi__val--ok' : 'ds-kpi__val--warn'}">${money(proj)}</b>
          <span class="ds-kpi__hint">no ritmo atual${bateMeta ? ' você fecha a meta' : ` · ${money(c.totalAno - proj)} abaixo`}</span>
        </article>
        <article class="ds-kpi">
          <span class="ds-kpi__lbl">Próxima semana</span>
          <b class="ds-kpi__val">${c.proxima ? money(c.proxima.target_amount) : '—'}</b>
          <span class="ds-kpi__hint">${c.proxima ? `semana ${c.proxima.week_number}` : 'ano concluído'}</span>
        </article>
      </div>`
    },

    _notas(c, cfg) {
      const notas = []
      if (this._ano > new Date().getFullYear()) {
        notas.push({ t: 'info', ico: 'fa-hourglass-start', txt: `<strong>${this._ano} ainda não começou.</strong> A grade já está montada — dá para conferir o valor de cada semana e ajustar a configuração antes da virada.` })
      } else if (c.atrasadas.length >= 4) {
        notas.push({ t: 'neg', ico: 'fa-triangle-exclamation', txt: `<strong>${c.atrasadas.length} semanas venceram sem ser guardadas.</strong> Recuperar tudo de uma vez costuma não acontecer — marque como pulada o que não vai voltar e guarde a semana atual. Um desafio com furos ainda é melhor que um abandonado.` })
      } else if (c.emDia && c.feitas.length > 0) {
        notas.push({ t: 'ok', ico: 'fa-fire', txt: `<strong>${c.feitas.length} semanas seguidas em dia.</strong> A constância é o que faz o total no fim — no ritmo atual você fecha ${this._ano} com ${money(c.projecao)}.` })
      }
      if (c.proxima && c.vencidas.length > 0) {
        const restantes = c.weeks.filter(w => w.week_number > c.semanaAgora)
        const soma = restantes.reduce((a, w) => a + Number(w.target_amount || 0), 0)
        const mediaSemana = restantes.length ? soma / restantes.length : 0
        notas.push({ t: 'info', ico: 'fa-calendar-days', txt: `<strong>Faltam ${restantes.length} semanas, somando ${money(soma)}.</strong> São ${money(mediaSemana)} por semana daqui até o fim — ${cfg.modo_invertido ? 'e no modo invertido a parte pesada já passou' : 'a parte pesada do desafio está no fim do ano'}.` })
      }
      const puladas = c.weeks.filter(w => w.status === 'skipped')
      if (puladas.length >= 3) {
        const perdido = puladas.reduce((a, w) => a + Number(w.target_amount || 0), 0)
        notas.push({ t: 'warn', ico: 'fa-forward', txt: `<strong>${puladas.length} semanas puladas somam ${money(perdido)}.</strong> Se o valor semanal está apertando, vale reduzir a base em Personalizar em vez de pular: um desafio menor que você cumpre rende mais que um grande que você abandona.` })
      }
      if (!notas.length) return ''
      return `<section class="tp-notes">${notas.slice(0, 3).map(n =>
        `<div class="ds-note ds-note--${n.t}"><i class="fas ${n.ico} ds-note__ico"></i><div>${n.txt}</div></div>`).join('')}</section>`
    },

    // ── grade por trimestre ──────────────────────────────────────────────────
    _trilha(c) {
      return `<article class="td-panel">
        <div class="td-panel__head">
          <div><span class="td-eyebrow">A trilha</span><h2>As 52 semanas de ${this._ano}</h2></div>
          <span class="d52-legend">
            <i style="background:var(--terminal-primary)"></i> guardada
            <i style="background:var(--terminal-accent)"></i> atual
            <i style="background:color-mix(in srgb, var(--terminal-negative) 45%, transparent)"></i> atrasada
            <i style="background:var(--terminal-line)"></i> pulada
          </span>
        </div>
        <p class="d52-help">Clique numa semana para alternar entre guardada, pulada e pendente.</p>
        <div class="d52-tri">
          ${TRI.map(([ini, fim, rot]) => {
            const ws = c.weeks.filter(w => w.week_number >= ini && w.week_number <= fim)
            const feitas = ws.filter(w => w.status === 'completed')
            const soma = feitas.reduce((a, w) => a + Number(w.target_amount || 0), 0)
            const total = ws.reduce((a, w) => a + Number(w.target_amount || 0), 0)
            return `<div class="d52-tri__bloco">
              <div class="d52-tri__head"><span>${rot}</span><b>${money(soma)} <em>/ ${money(total)}</em></b></div>
              <div class="d52-grid">${ws.map(w => this._cell(w, c)).join('')}</div>
            </div>`
          }).join('')}
        </div>
      </article>`
    },

    _cell(w, c) {
      const isCur = w.week_number === c.semanaAgora
      const atrasada = w.status === 'pending' && w.week_number < c.semanaAgora
      const cls = w.status === 'completed' ? 'is-done' : w.status === 'skipped' ? 'is-skip' : atrasada ? 'is-late' : 'is-pend'
      const rot = w.status === 'completed' ? 'guardada' : w.status === 'skipped' ? 'pulada' : atrasada ? 'atrasada' : 'pendente'
      return `<button class="d52-cell ${cls} ${isCur ? 'is-cur' : ''}" title="Semana ${w.week_number} · ${money(w.target_amount)} · ${rot}" onclick="VMTerminalDesafio.toggle(${w.week_number})">${w.week_number}</button>`
    },

    _atrasadas(c) {
      const lista = c.atrasadas.slice().sort((a, b) => a.week_number - b.week_number)
      return `<article class="td-panel" style="margin-top:16px">
        <div class="td-panel__head"><div><span class="td-eyebrow">Pendências</span><h2>Semanas que venceram sem ser guardadas</h2></div></div>
        <div class="ds-tablewrap"><table class="ds-table">
          <thead><tr><th>Semana</th><th class="ds-num">Valor</th><th style="text-align:right">Resolver</th></tr></thead>
          <tbody>${lista.map(w => `<tr>
            <td>Semana ${w.week_number}</td>
            <td class="ds-num">${money(w.target_amount)}</td>
            <td style="text-align:right;white-space:nowrap">
              <button class="ds-btn ds-btn--sm ds-btn--primary" onclick="VMTerminalDesafio.marcar(${w.week_number}, 'completed')"><i class="fas fa-check"></i> Guardei</button>
              <button class="ds-btn ds-btn--sm" onclick="VMTerminalDesafio.marcar(${w.week_number}, 'skipped')"><i class="fas fa-forward"></i> Pular</button>
            </td></tr>`).join('')}
          </tbody>
        </table></div>
      </article>`
    },

    _ring(pct) {
      const r = 52, cir = 2 * Math.PI * r
      const p = Math.min(100, Math.max(0, Number(pct) || 0))
      const off = cir - (p / 100) * cir
      const cor = p >= 90 ? 'var(--terminal-primary)' : p >= 60 ? 'var(--terminal-accent)' : 'var(--terminal-negative)'
      return `<svg width="130" height="130" viewBox="0 0 130 130" aria-hidden="true">
        <circle cx="65" cy="65" r="${r}" fill="none" stroke="var(--terminal-line)" stroke-width="10"/>
        <circle cx="65" cy="65" r="${r}" fill="none" stroke="${cor}" stroke-width="10" stroke-linecap="round"
          stroke-dasharray="${cir.toFixed(1)}" stroke-dashoffset="${off.toFixed(1)}" transform="rotate(-90 65 65)"/>
      </svg>`
    },

    _fechamento(c) {
      const puladas = c.weeks.filter(w => w.status === 'skipped').length
      return `<section class="d52-done">
        <div><span class="td-eyebrow" style="color:var(--terminal-primary)">🏆 Desafio completo</span>
          <h2>Você fechou as 52 semanas — ${money(c.guardado)} guardados.</h2>
          <p>${puladas === 0 ? 'Sem pular nenhuma semana. ' : puladas === 1 ? 'Uma semana pulada e recuperada depois. ' : `${puladas} semanas puladas e recuperadas depois. `}Pronto para repetir a dose?</p>
        </div>
        <button class="ds-btn ds-btn--primary" onclick="VMTerminalDesafio.novoAno()"><i class="fas fa-seedling"></i> Começar ${this._ano + 1}</button>
      </section>`
    },

    // ── ações ────────────────────────────────────────────────────────────────
    async toggle(w) {
      const week = (this._data.weeks || []).find(x => x.week_number === w)
      if (!week) return
      const next = week.status === 'pending' ? 'completed' : week.status === 'completed' ? 'skipped' : 'pending'
      this.marcar(w, next)
    },
    async marcar(w, status) {
      const vm = this._vm
      const r = await vm.api('PATCH', `desafio-52/${w}?ano=${this._ano}`, { status }).catch(e => ({ error: e.response?.data?.error }))
      if (r?.success) this.reload()
      else vm.toast(r?.error || 'Não foi possível atualizar a semana.', 'error')
    },
    async reset() {
      const vm = this._vm
      const ok = await vm.vmConfirm('Reiniciar o desafio? As semanas voltam a pendente e o valor já creditado na meta/investimento vinculado é estornado.', { titulo: 'Reiniciar desafio', corBotao: '#FF6B6B', textoBotao: 'Reiniciar', icone: '🔄' })
      if (!ok) return
      const r = await vm.api('POST', `desafio-52/reset?ano=${this._ano}`, {}).catch(e => ({ error: e.response?.data?.error }))
      if (r?.success) { vm.toast('Desafio reiniciado.', 'success'); this.reload() }
      else vm.toast(r?.error || 'Erro ao reiniciar.', 'error')
    },
    novoAno() { this.render(this._vm, this._ano + 1) },

    config() {
      const vm = this._vm
      const cfg = this._data.config || {}
      const s = 'width:100%;background:var(--terminal-bg);border:1px solid var(--terminal-line);color:var(--terminal-ink);border-radius:var(--terminal-radius-sm);padding:10px 12px;font-size:13px;font-family:var(--terminal-font)'
      const lab = (t) => `<label style="display:block;font:700 10px/1 var(--terminal-mono);letter-spacing:.1em;text-transform:uppercase;color:var(--terminal-ink-soft);margin-bottom:6px">${t}</label>`
      const metaOpts = ['<option value="">Nenhuma</option>'].concat((this._metas || []).map(m => `<option value="${m.id}" ${Number(cfg.meta_vinculada) === m.id ? 'selected' : ''}>${esc(m.nome)}</option>`)).join('')
      vm.showModal(`<div style="font-family:var(--terminal-font);color:var(--terminal-ink)">
        <div style="font-size:16px;font-weight:640">Personalizar desafio</div>
        <div style="color:var(--terminal-ink-soft);font-size:12px;margin:4px 0 18px">O valor de cada semana é <b>semana × base × multiplicador</b>. Um desafio menor que você cumpre rende mais que um grande que você abandona.</div>
        <div style="display:flex;flex-direction:column;gap:14px">
          <div style="display:flex;gap:10px">
            <div style="flex:1">${lab('Valor base (R$)')}<input id="ds-base" type="number" min="0.5" max="100" step="0.5" style="${s}" value="${cfg.valor_base ?? 1}"></div>
            <div style="flex:1">${lab('Multiplicador')}<input id="ds-mult" type="number" min="0.5" max="10" step="0.5" style="${s}" value="${cfg.multiplicador ?? 1}"></div>
          </div>
          <label style="display:flex;align-items:center;gap:9px;cursor:pointer;font-size:12px;color:var(--terminal-ink-soft)"><input type="checkbox" id="ds-inv" ${cfg.modo_invertido ? 'checked' : ''} style="accent-color:var(--terminal-primary)"> Modo invertido (começa alto, termina baixo)</label>
          <div>${lab('Creditar numa meta (opcional)')}<select id="ds-meta" style="${s}">${metaOpts}</select></div>
          <div id="ds-preview" style="font:700 12px var(--terminal-mono);color:var(--terminal-primary)"></div>
          <div style="display:flex;gap:8px;margin-top:6px">
            <button class="ds-btn ds-btn--primary" style="flex:1" onclick="VMTerminalDesafio.salvarConfig()"><i class="fas fa-check"></i> Salvar</button>
            <button class="ds-btn" onclick="VM.closeModal()">Cancelar</button>
          </div>
        </div></div>`)
      this._preview()
      ;['ds-base', 'ds-mult', 'ds-inv'].forEach(id => document.getElementById(id)?.addEventListener('input', () => this._preview()))
    },
    _preview() {
      const base = parseFloat(document.getElementById('ds-base')?.value) || 0
      const mult = parseFloat(document.getElementById('ds-mult')?.value) || 0
      const inv = document.getElementById('ds-inv')?.checked
      let total = 0
      for (let w = 1; w <= 52; w++) total += (inv ? 53 - w : w) * base * mult
      const s1 = (inv ? 52 : 1) * base * mult, s52 = (inv ? 1 : 52) * base * mult
      const el = document.getElementById('ds-preview')
      if (el) el.textContent = `Semana 1: ${money(s1)} · Semana 52: ${money(s52)} · Total/ano: ${money(total)}`
    },
    async salvarConfig() {
      const vm = this._vm
      const valor_base = parseFloat(document.getElementById('ds-base')?.value)
      const multiplicador = parseFloat(document.getElementById('ds-mult')?.value)
      const modo_invertido = document.getElementById('ds-inv')?.checked || false
      const meta_vinculada = document.getElementById('ds-meta')?.value || null
      if (!(valor_base > 0) || !(multiplicador > 0)) return vm.toast('Valor base e multiplicador devem ser maiores que zero.', 'error')
      const r = await vm.api('POST', 'desafio-52/config', { valor_base, multiplicador, modo_invertido, meta_vinculada }).catch(e => ({ error: e.response?.data?.error }))
      if (r?.success) { vm.closeModal(); vm.toast('Configuração salva.', 'success'); this.reload() }
      else vm.toast(r?.error || 'Erro ao salvar.', 'error')
    },
  }
})()
