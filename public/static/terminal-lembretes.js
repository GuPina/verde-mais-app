(function () {
  const esc = (v) => String(v ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;')
  const money = (v) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 2 }).format(Number(v) || 0)

  const TIPOS = ['conta', 'imposto', 'mensalidade', 'seguro', 'aluguel', 'investimento', 'saude', 'educacao', 'transporte', 'revisao', 'reuniao', 'tarefa', 'outros']
  const TIPO_ICON = { conta: 'file-invoice-dollar', imposto: 'landmark', mensalidade: 'repeat', seguro: 'shield-halved', aluguel: 'house', investimento: 'chart-line', saude: 'heart-pulse', educacao: 'graduation-cap', transporte: 'car', revisao: 'screwdriver-wrench', reuniao: 'users', tarefa: 'list-check', outros: 'bell' }
  const FREQS = ['semanal', 'quinzenal', 'mensal', 'bimestral', 'trimestral', 'semestral', 'anual']
  // LB10: fator de normalização mensal por frequência
  const FREQ_MES = { semanal: 4.3333, quinzenal: 2.1667, mensal: 1, bimestral: 1 / 2, trimestral: 1 / 3, semestral: 1 / 6, anual: 1 / 12 }

  window.VMTerminalLembretes = {
    async render(vm) {
      this._vm = vm
      const content = document.getElementById('page-content')
      if (!content) return
      document.body.classList.add('terminal-dashboard-active')
      content.innerHTML = '<div class="td-loading"><span></span><span></span><span></span></div>'
      try {
        const data = await vm.api('GET', 'lembretes')
        this._cache = data.lembretes || []
        this._paint()
      } catch (e) {
        content.innerHTML = `<div class="td-error"><i class="fas fa-triangle-exclamation"></i><h2>Não foi possível carregar os Lembretes</h2><p>${esc(e.response?.data?.error || 'Tente novamente.')}</p><button class="td-button td-button--primary" onclick="VM.pageLembretes()">Tentar novamente</button></div>`
      }
    },
    reload() { this.render(this._vm) },

    _paint() {
      const content = document.getElementById('page-content')
      if (!content) return
      const list = this._cache || []
      const ativos = list.filter(l => l.ativo)

      // LB9: uma única fonte de urgência (a do GET /), não três contagens.
      const criticos = list.filter(l => (l.urgente || l.atrasado) && l.status_mes === 'aguardando')
      const emDia = list.filter(l => !criticos.includes(l))

      // LB10: total mensal normalizado pela frequência (anual/12, semanal×4,33…).
      const totalMensal = ativos.reduce((s, l) => s + Number(l.valor_estimado || 0) * (FREQ_MES[l.frequencia] || 1), 0)
      const prox7 = ativos.filter(l => l.status_mes === 'aguardando' && l.dias_para_vencer !== null && l.dias_para_vencer >= 0 && l.dias_para_vencer <= 7).length

      content.innerHTML = `<div class="td-dashboard tl">
        <header class="td-dashboard__header">
          <div>
            <span class="td-eyebrow">Nunca pague multa</span>
            <h1>Lembretes. <em>No prazo, sempre.</em></h1>
            <p>Contas e compromissos que se repetem — com aviso antes de vencer.</p>
          </div>
          <div class="td-dashboard__header-actions">
            <button class="td-button td-button--primary" onclick="VMTerminalLembretes.novo()"><i class="fas fa-plus"></i> Novo lembrete</button>
          </div>
        </header>

        <section class="tm-kpis" style="grid-template-columns:repeat(3,1fr)">
          <article class="td-kpi"><span>Compromisso mensal</span><strong>${money(totalMensal)}</strong><span class="td-kpi__delta td-kpi__delta--muted">normalizado por frequência</span></article>
          <article class="td-kpi td-kpi--score"><span>Atrasados + urgentes</span><strong>${criticos.length}</strong><span class="td-kpi__delta ${criticos.length ? 'td-kpi__delta--negative' : 'td-kpi__delta--positive'}">${criticos.length ? 'pedem ação' : 'tudo em dia'}</span></article>
          <article class="td-kpi"><span>Próximos 7 dias</span><strong>${prox7}</strong><span class="td-kpi__delta td-kpi__delta--muted">a vencer em breve</span></article>
        </section>

        ${list.length === 0 ? this._empty() : `
          ${criticos.length ? `<div class="tm-group"><div class="tm-group__head"><span class="td-eyebrow" style="color:var(--terminal-negative)"><i class="fas fa-triangle-exclamation"></i> Atrasados & urgentes · ${criticos.length}</span></div><div class="tr-grid">${criticos.map(l => this._card(l)).join('')}</div></div>` : ''}
          ${emDia.length ? `<div class="tm-group"><div class="tm-group__head"><span class="td-eyebrow"><i class="far fa-calendar-check"></i> Em dia · ${emDia.length}</span></div><div class="tr-grid">${emDia.map(l => this._card(l)).join('')}</div></div>` : ''}
        `}
      </div>`
    },

    _statusChip(l) {
      if (l.status_mes && l.status_mes !== 'aguardando') return `<span class="tr-badge tr-badge--done"><i class="fas fa-check"></i> ${esc(l.status_mes)}</span>`
      if (l.atrasado) return `<span class="tr-badge tl-badge--late">${Math.abs(l.dias_para_vencer || 0)}d atrasado</span>`
      const d = l.dias_para_vencer
      if (d === 0) return '<span class="tr-badge tl-badge--today">vence hoje</span>'
      if (d !== null && d <= (l.alertar_dias_antes || 3)) return `<span class="tr-badge tl-badge--soon">em ${d}d</span>`
      return d !== null ? `<span class="tr-badge">em ${d}d</span>` : '<span class="tr-badge">—</span>'
    },

    _card(l) {
      const j = esc(JSON.stringify({ id: l.id, titulo: l.titulo, tipo: l.tipo, valor_estimado: Number(l.valor_estimado), dia_vencimento: l.dia_vencimento, frequencia: l.frequencia, alertar_dias_antes: l.alertar_dias_antes }))
      const pago = l.status_mes && l.status_mes !== 'aguardando'
      const off = !l.ativo
      return `<article class="tr-card ${off ? 'tr-card--off' : ''} ${l.atrasado ? 'tm-card--risk' : ''}">
        <div class="tr-card__top">
          <div class="tr-card__id">
            <strong><i class="fas fa-${TIPO_ICON[l.tipo] || 'bell'}" style="color:var(--terminal-ink-soft);margin-right:6px"></i>${esc(l.titulo)}</strong>
            <small>${esc(l.frequencia || 'mensal')} · vence dia ${Number(l.dia_vencimento) || '—'}</small>
          </div>
          ${this._statusChip(l)}
        </div>
        <div class="tr-card__val">${Number(l.valor_estimado) > 0 ? money(l.valor_estimado) : '<em>sem valor</em>'}</div>
        <div class="tr-card__actions">
          ${!pago && l.ativo ? `<button class="td-button td-button--primary" onclick="VMTerminalLembretes.pagar(${Number(l.id)})"><i class="fas fa-check"></i> Registrar</button>` : ''}
          ${!pago && l.ativo ? `<button class="td-button" title="Adiar" onclick="VMTerminalLembretes.adiar(${Number(l.id)}, '${esc(l.titulo)}')"><i class="fas fa-clock"></i></button>` : ''}
          <button class="td-button" title="Editar" onclick='VMTerminalLembretes.editar(${j})'><i class="fas fa-pen"></i></button>
          <button class="td-button" title="Excluir" onclick="VMTerminalLembretes.deletar(${Number(l.id)}, '${esc(l.titulo)}')"><i class="fas fa-trash"></i></button>
        </div>
      </article>`
    },

    _empty() {
      return `<section class="td-onboarding tm-empty"><div class="td-onboarding__copy">
        <span class="td-eyebrow">Nunca mais uma multa por atraso</span>
        <h2>Cadastre a conta uma vez e seja avisado.</h2>
        <p>IPTU, seguro, mensalidade — o VerdeMais lembra você antes de cada vencimento.</p>
        <div class="td-onboarding__actions"><button class="td-button td-button--primary" onclick="VMTerminalLembretes.novo()"><i class="fas fa-plus"></i> Criar primeiro lembrete</button></div>
      </div></section>`
    },

    // ── ações ──
    _label(t) { return `<label style="display:block;font:700 10px/1 var(--terminal-mono);letter-spacing:.1em;text-transform:uppercase;color:var(--terminal-ink-soft);margin-bottom:6px">${t}</label>` },
    _st() { return 'width:100%;background:var(--terminal-bg);border:1px solid var(--terminal-line);color:var(--terminal-ink);border-radius:var(--terminal-radius-sm);padding:10px 12px;font-size:13px;font-family:var(--terminal-font)' },
    _form(l) {
      const s = this._st()
      return `<div style="font-family:var(--terminal-font);color:var(--terminal-ink)">
        <div style="font-size:16px;font-weight:640">${l ? 'Editar lembrete' : 'Novo lembrete'}</div>
        <div style="color:var(--terminal-ink-soft);font-size:12px;margin:4px 0 18px">Uma conta ou compromisso que se repete</div>
        <div style="display:flex;flex-direction:column;gap:14px">
          <div>${this._label('Título')}<input id="tl-tit" style="${s}" value="${esc(l?.titulo || '')}" placeholder="Ex.: IPTU"></div>
          <div style="display:flex;gap:10px">
            <div style="flex:1">${this._label('Valor estimado (R$)')}<input id="tl-val" type="number" min="0" step="0.01" style="${s}" value="${l?.valor_estimado ?? ''}" placeholder="0,00"></div>
            <div style="flex:1">${this._label('Dia do vencimento')}<input id="tl-dia" type="number" min="1" max="31" style="${s}" value="${l?.dia_vencimento || ''}" placeholder="1–31"></div>
          </div>
          <div style="display:flex;gap:10px">
            <div style="flex:1">${this._label('Tipo')}<select id="tl-tipo" style="${s}">${TIPOS.map(t => `<option value="${t}" ${t === l?.tipo ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
            <div style="flex:1">${this._label('Frequência')}<select id="tl-freq" style="${s}">${FREQS.map(f => `<option value="${f}" ${f === (l?.frequencia || 'mensal') ? 'selected' : ''}>${f}</option>`).join('')}</select></div>
          </div>
          <div>${this._label('Avisar quantos dias antes')}<input id="tl-alerta" type="number" min="0" max="60" style="${s}" value="${l?.alertar_dias_antes ?? 3}"></div>
          <div style="display:flex;gap:8px;margin-top:6px">
            <button class="td-button td-button--primary" style="flex:1" onclick="VMTerminalLembretes.salvar(${l ? Number(l.id) : 'null'})"><i class="fas fa-check"></i> Salvar</button>
            <button class="td-button" onclick="VM.closeModal()">Cancelar</button>
          </div>
        </div></div>`
    },
    novo() { this._vm.showModal(this._form(null)) },
    editar(l) { this._vm.showModal(this._form(l)) },
    async salvar(id) {
      const vm = this._vm
      const titulo = document.getElementById('tl-tit')?.value?.trim()
      const valor = parseFloat(document.getElementById('tl-val')?.value) || 0
      const dia = parseInt(document.getElementById('tl-dia')?.value)
      const tipo = document.getElementById('tl-tipo')?.value
      const frequencia = document.getElementById('tl-freq')?.value
      const alerta = parseInt(document.getElementById('tl-alerta')?.value)
      if (!titulo) return vm.toast('Informe o título.', 'error')
      if (document.getElementById('tl-dia')?.value && !(dia >= 1 && dia <= 31)) return vm.toast('Dia deve ser 1–31.', 'error')
      const body = { titulo, tipo, frequencia, valor_estimado: valor, dia_vencimento: dia || null, alertar_dias_antes: Number.isFinite(alerta) ? alerta : 3 }
      const r = await vm.api(id ? 'PUT' : 'POST', id ? `lembretes/${id}` : 'lembretes', body).catch(e => ({ error: e.response?.data?.error }))
      if (r?.success) { vm.closeModal(); vm.toast(id ? 'Lembrete atualizado.' : 'Lembrete criado.', 'success'); this.reload() }
      else vm.toast(r?.error || 'Erro ao salvar.', 'error')
    },
    async pagar(id) {
      const vm = this._vm
      const r = await vm.api('PATCH', `lembretes/${id}/registrar`, { status: 'pago' }).catch(e => ({ error: e.response?.data?.error }))
      if (r?.success) { vm.toast('Registrado como pago.', 'success'); this.reload() }
      else vm.toast(r?.error || 'Não foi possível registrar.', 'error')
    },
    async adiar(id, titulo) {
      const vm = this._vm
      const txt = window.prompt(`Adiar "${titulo}" em quantos dias? (1–30)`, '3')
      if (txt === null) return
      const dias = parseInt(txt)
      if (!(dias >= 1 && dias <= 30)) return vm.toast('Informe de 1 a 30 dias.', 'error')
      const r = await vm.api('PATCH', `lembretes/${id}/snooze`, { dias }).catch(e => ({ error: e.response?.data?.error }))
      if (r?.success) { vm.toast(`Adiado ${dias} dia(s).`, 'success'); this.reload() }
      else vm.toast(r?.error || 'Não foi possível adiar.', 'error')
    },
    async deletar(id, titulo) {
      const vm = this._vm
      const ok = await vm.vmConfirm(`Excluir o lembrete <strong>${esc(titulo)}</strong>?`, { titulo: 'Excluir lembrete', corBotao: '#FF6B6B', textoBotao: 'Excluir', icone: '🗑️' })
      if (!ok) return
      const r = await vm.api('DELETE', `lembretes/${id}`).catch(e => ({ error: e.response?.data?.error }))
      if (r?.success) { vm.toast('Lembrete removido.', 'success'); this.reload() }
      else vm.toast(r?.error || 'Erro ao remover.', 'error')
    }
  }
})()
