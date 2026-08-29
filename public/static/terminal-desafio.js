(function () {
  const esc = (v) => String(v ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;')
  const money = (v) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 2 }).format(Number(v) || 0)

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
          vm.api('GET', 'metas').catch(() => ({ metas: [] }))
        ])
        this._data = data
        this._metas = (metas.metas || []).filter(m => m.status === 'ativa')
        this._paint()
      } catch (e) {
        content.innerHTML = `<div class="td-error"><i class="fas fa-triangle-exclamation"></i><h2>Não foi possível carregar o Desafio 52</h2><p>${esc(e.response?.data?.error || 'Tente novamente.')}</p><button class="td-button td-button--primary" onclick="VM.pageDesafio52()">Tentar novamente</button></div>`
      }
    },
    reload() { this.render(this._vm, this._ano) },

    _paint() {
      const content = document.getElementById('page-content')
      if (!content) return
      const d = this._data
      const weeks = (d.weeks || []).slice().sort((a, b) => a.week_number - b.week_number)
      const s = d.summary || {}
      const cur = d.current_week || 1
      const cfg = d.config || {}
      const curWeek = weeks.find(w => w.week_number === cur)
      const concluido = s.completed >= 52

      content.innerHTML = `<div class="td-dashboard ds">
        <header class="td-dashboard__header">
          <div>
            <span class="td-eyebrow">Poupança gamificada · ${this._ano}</span>
            <h1>Desafio 52. <em>Uma semana de cada vez.</em></h1>
            <p>Guarde um valor por semana e veja a colheita do ano crescer.</p>
          </div>
          <div class="td-dashboard__header-actions">
            <button class="td-button" onclick="VMTerminalDesafio.config()"><i class="fas fa-sliders"></i> Personalizar</button>
            <button class="td-button" onclick="VMTerminalDesafio.reset()"><i class="fas fa-rotate-left"></i> Reiniciar</button>
          </div>
        </header>

        ${concluido ? this._fechamento(s) : ''}

        <section class="ds-hero">
          <article class="ds-hero__main">
            <div class="ds-hero__top">
              <div><span class="td-eyebrow">Semana atual</span><div class="ds-hero__week">${cur}<em>de 52</em></div></div>
              <div style="text-align:right"><span class="td-eyebrow">Guardado até aqui</span><div class="ds-hero__saved">${money(s.total_saved)}</div></div>
            </div>
            <div class="ds-grid">${weeks.map(w => this._cell(w, cur)).join('')}</div>
            <div class="ds-hero__foot">
              <span>${curWeek && curWeek.status !== 'completed' ? `Guardar esta semana: <strong>${money(curWeek.target_amount)}</strong>` : 'Semana atual em dia ✓'}</span>
              <span class="ds-legend"><i style="background:var(--terminal-primary)"></i> concluída <i style="background:var(--terminal-accent)"></i> atual <i style="background:var(--terminal-line)"></i> pulada</span>
            </div>
          </article>
          <aside class="ds-side">
            <div class="ds-ring">${this._ring(s.progress_pct || 0)}<div class="ds-ring__label"><strong>${s.completed || 0}</strong><small>de 52</small></div></div>
            <div class="ds-side__stats">
              <div><strong>${money(s.total_saved)}</strong><small>guardado</small></div>
              <div><strong>${money((cfg.total_anual || s.total_target) - (s.total_saved || 0))}</strong><small>faltam</small></div>
            </div>
            <div class="ds-side__meta">Meta do ano: <strong>${money(cfg.total_anual || s.total_target)}</strong>${cfg.modo_invertido ? ' · <span style="color:#6EA8FE">modo invertido</span>' : ''}</div>
          </aside>
        </section>
      </div>`
    },

    _cell(w, cur) {
      const st = w.status
      const isCur = w.week_number === cur
      const cls = st === 'completed' ? 'is-done' : st === 'skipped' ? 'is-skip' : 'is-pend'
      return `<button class="ds-cell ${cls} ${isCur ? 'is-cur' : ''}" title="Semana ${w.week_number} · ${money(w.target_amount)}${isCur ? ' · atual' : ''}" onclick="VMTerminalDesafio.toggle(${w.week_number})">${w.week_number}</button>`
    },

    _ring(pct) {
      const r = 52, c = 2 * Math.PI * r
      const off = c - (Math.min(100, Math.max(0, pct)) / 100) * c
      return `<svg width="130" height="130" viewBox="0 0 130 130">
        <circle cx="65" cy="65" r="${r}" fill="none" stroke="var(--terminal-primary-soft)" stroke-width="10"/>
        <circle cx="65" cy="65" r="${r}" fill="none" stroke="var(--terminal-primary)" stroke-width="10" stroke-linecap="round"
          stroke-dasharray="${c}" stroke-dashoffset="${off}" transform="rotate(-90 65 65)"/>
      </svg>`
    },

    _fechamento(s) {
      // D52-25: ao completar as 52 semanas, uma retrospectiva e o convite ao próximo ano.
      return `<section class="ds-done">
        <div><span class="td-eyebrow" style="color:var(--terminal-primary)">🏆 Desafio completo</span>
          <h2>Você fechou as 52 semanas — ${money(s.total_saved)} guardados.</h2>
          <p>${s.skipped ? `${s.skipped} semana(s) pulada(s), recuperadas depois. ` : 'Sem pular nenhuma semana. '}Pronto para repetir a dose?</p>
        </div>
        <button class="td-button td-button--primary" onclick="VMTerminalDesafio.novoAno()"><i class="fas fa-seedling"></i> Começar ${this._ano + 1}</button>
      </section>`
    },

    _empty() { return '' },

    // ── ações ──
    async toggle(w) {
      const vm = this._vm
      const week = (this._data.weeks || []).find(x => x.week_number === w)
      if (!week) return
      // ciclo: pendente → concluída → pulada → pendente
      const next = week.status === 'pending' ? 'completed' : week.status === 'completed' ? 'skipped' : 'pending'
      const r = await vm.api('PATCH', `desafio-52/${w}?ano=${this._ano}`, { status: next }).catch(e => ({ error: e.response?.data?.error }))
      if (r?.success) { this.reload() }
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
        <div style="color:var(--terminal-ink-soft);font-size:12px;margin:4px 0 18px">O valor de cada semana é <b>semana × base × multiplicador</b></div>
        <div style="display:flex;flex-direction:column;gap:14px">
          <div style="display:flex;gap:10px">
            <div style="flex:1">${lab('Valor base (R$)')}<input id="ds-base" type="number" min="0.5" max="100" step="0.5" style="${s}" value="${cfg.valor_base ?? 1}"></div>
            <div style="flex:1">${lab('Multiplicador')}<input id="ds-mult" type="number" min="0.5" max="10" step="0.5" style="${s}" value="${cfg.multiplicador ?? 1}"></div>
          </div>
          <label style="display:flex;align-items:center;gap:9px;cursor:pointer;font-size:12px;color:var(--terminal-ink-soft)"><input type="checkbox" id="ds-inv" ${cfg.modo_invertido ? 'checked' : ''} style="accent-color:var(--terminal-primary)"> Modo invertido (começa alto, termina baixo)</label>
          <div>${lab('Creditar numa meta (opcional)')}<select id="ds-meta" style="${s}">${metaOpts}</select></div>
          <div id="ds-preview" style="font:700 12px var(--terminal-mono);color:var(--terminal-primary)"></div>
          <div style="display:flex;gap:8px;margin-top:6px">
            <button class="td-button td-button--primary" style="flex:1" onclick="VMTerminalDesafio.salvarConfig()"><i class="fas fa-check"></i> Salvar</button>
            <button class="td-button" onclick="VM.closeModal()">Cancelar</button>
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
    }
  }
})()
