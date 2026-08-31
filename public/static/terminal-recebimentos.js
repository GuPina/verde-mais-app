(function () {
  const esc = (v) => String(v ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;')
  const money = (v) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 2 }).format(Number(v) || 0)
  const TIPOS = [['venda', 'Venda'], ['servico', 'Serviço'], ['aluguel', 'Aluguel'], ['emprestimo_a_receber', 'Empréstimo a receber'], ['contrato', 'Contrato'], ['outros', 'Outros']]
  const TIPO_LBL = Object.fromEntries(TIPOS)
  const dfmt = (d) => { const x = new Date(String(d || '').slice(0, 10) + 'T12:00:00'); return Number.isNaN(x.getTime()) ? '—' : x.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }).replace('.', '') }

  window.VMTerminalRecebimentos = {
    async render(vm) {
      this._vm = vm
      const content = document.getElementById('page-content')
      if (!content) return
      document.body.classList.add('terminal-dashboard-active')
      content.innerHTML = '<div class="td-loading"><span></span><span></span><span></span></div>'
      try {
        const data = await vm.api('GET', 'antecipacao/recebimentos')
        this._recs = data.recebimentos || []
        this._paint()
      } catch (e) {
        content.innerHTML = `<div class="td-error"><i class="fas fa-triangle-exclamation"></i><h2>Não foi possível carregar os recebimentos</h2><p>${esc(e.response?.data?.error || 'Tente novamente.')}</p><button class="td-button td-button--primary" onclick="VMTerminalRecebimentos.reload()">Tentar novamente</button></div>`
      }
    },
    reload() { this.render(this._vm) },

    _paint() {
      const content = document.getElementById('page-content')
      if (!content) return
      const recs = this._recs
      if (!recs.length) return void (content.innerHTML = this._shell(this._empty()))

      const totalContratado = recs.reduce((s, r) => s + Number(r.valor_total || 0), 0)
      const totalRecebido = recs.reduce((s, r) => s + Number(r.total_recebido || 0), 0)
      const aReceber = Math.max(0, totalContratado - totalRecebido)
      const pct = totalContratado > 0 ? Math.round((totalRecebido / totalContratado) * 100) : 0

      content.innerHTML = this._shell(`
        <section class="fe-hero">
          <div class="fe-hero__main">
            <span class="td-eyebrow">A receber</span>
            <div class="fe-hero__big">${money(aReceber)}</div>
            <p>${recs.length} contrato${recs.length === 1 ? '' : 's'} · ${money(totalRecebido)} já recebido de ${money(totalContratado)}</p>
          </div>
          <div class="fe-hero__gauge">
            <div class="to-bar" style="height:12px"><span style="width:${Math.min(100, pct)}%;background:var(--terminal-primary)"></span></div>
            <div class="fe-hero__nums"><span class="to-status to-status--ok">${pct}% recebido</span></div>
          </div>
        </section>

        <div class="mr-toolbar">
          <div><span class="td-eyebrow">Contratos</span><h2>${recs.length} recebimento${recs.length === 1 ? '' : 's'}</h2></div>
          <button class="td-button td-button--primary" onclick="VMTerminalRecebimentos.novo()"><i class="fas fa-plus"></i> Novo recebimento</button>
        </div>

        <div class="fe-grid">${recs.map(r => this._card(r)).join('')}</div>
      `)
    },

    _card(r) {
      const total = Number(r.total_parcelas_count) || Number(r.numero_parcelas) || 0
      const receb = Number(r.parcelas_recebidas) || 0
      const pct = total > 0 ? Math.round((receb / total) * 100) : 0
      const done = r.status === 'concluido'
      const cor = done ? 'var(--terminal-primary)' : pct >= 50 ? 'var(--terminal-primary)' : 'var(--terminal-accent)'
      return `<article class="fe-card ${done ? 'fe-card--done' : ''}">
        <div class="fe-card__top">
          <div class="fe-card__id">
            <strong>${esc(r.descricao)}</strong>
            <small>${esc(TIPO_LBL[r.tipo] || r.tipo || 'Recebimento')}${r.pagador ? ' · ' + esc(r.pagador) : ''}</small>
          </div>
          <span class="fe-badge">${money(r.valor_parcela)}</span>
        </div>
        <div class="fe-card__saldo">
          <div><span class="fe-lbl">Já recebido</span><span class="fe-val fe-val--big">${money(r.total_recebido)}</span></div>
          <div><span class="fe-lbl">Total</span><span class="fe-val">${money(r.valor_total)}</span></div>
        </div>
        <div class="to-bar" style="height:8px"><span style="width:${Math.min(100, pct)}%;background:${cor}"></span></div>
        <div class="fe-card__meta">
          <span class="to-status to-status--${pct >= 50 ? 'ok' : 'warn'}">${receb}/${total} parcelas</span>
          <small>${done ? 'concluído 🎉' : `faltam ${Math.max(0, total - receb)}`}</small>
        </div>
        <div class="fe-card__actions">
          <button class="td-button td-button--sm td-button--primary" onclick="VMTerminalRecebimentos.verParcelas(${Number(r.id)}, '${esc(r.descricao).replace(/'/g, '')}')"><i class="fas fa-list"></i> Parcelas</button>
          <button class="td-button td-button--sm" onclick="VMTerminalRecebimentos.excluir(${Number(r.id)}, '${esc(r.descricao).replace(/'/g, '')}')"><i class="fas fa-trash"></i></button>
        </div>
      </article>`
    },

    _shell(inner) {
      return `<div class="td-dashboard fe">
        <header class="td-dashboard__header">
          <div>
            <span class="td-eyebrow">O dinheiro que ainda vem</span>
            <h1>Parcelamentos recebidos. <em>Cada entrada no seu lugar.</em></h1>
            <p>Vendas, serviços e contratos parcelados — receba cada parcela e ela vira receita automaticamente.</p>
          </div>
        </header>
        ${inner}
      </div>`
    },

    _empty() {
      return `<section class="td-onboarding"><div class="td-onboarding__copy">
        <span class="td-eyebrow">Comece agora</span>
        <h2>Cadastre um recebimento parcelado.</h2>
        <p>Uma venda em 12x, um contrato mensal, um empréstimo que você tem a receber — o VerdeMais gera as parcelas e lança a receita a cada entrada.</p>
        <div class="td-onboarding__actions"><button class="td-button td-button--primary" onclick="VMTerminalRecebimentos.novo()"><i class="fas fa-plus"></i> Novo recebimento</button></div>
      </div></section>`
    },

    _st() { return 'width:100%;background:var(--terminal-bg);border:1px solid var(--terminal-line);color:var(--terminal-ink);border-radius:var(--terminal-radius-sm);padding:10px 12px;font-size:13px;font-family:var(--terminal-font)' },
    _lab(t) { return `<label style="display:block;font:700 10px/1 var(--terminal-mono);letter-spacing:.1em;text-transform:uppercase;color:var(--terminal-ink-soft);margin-bottom:6px">${t}</label>` },

    novo() {
      const s = this._st()
      const hoje = new Date().toISOString().slice(0, 10)
      const opts = TIPOS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')
      this._vm.showModal(`<div style="font-family:var(--terminal-font);color:var(--terminal-ink);min-width:min(440px,92vw)">
        <div style="font-size:16px;font-weight:640">Novo recebimento parcelado</div>
        <div style="color:var(--terminal-ink-soft);font-size:12px;margin:4px 0 18px">O VerdeMais cria uma parcela por mês</div>
        <div style="display:flex;flex-direction:column;gap:13px">
          <div>${this._lab('Descrição')}<input id="rc-desc" style="${s}" placeholder="Ex.: Venda notebook 10x"></div>
          <div style="display:flex;gap:10px">
            <div style="flex:2">${this._lab('Pagador (opc.)')}<input id="rc-pagador" style="${s}" placeholder="Ex.: João"></div>
            <div style="flex:1">${this._lab('Tipo')}<select id="rc-tipo" style="${s}">${opts}</select></div>
          </div>
          <div style="display:flex;gap:10px">
            <div style="flex:1">${this._lab('Valor total (R$)')}<input id="rc-total" type="number" step="0.01" min="0.01" style="${s}"></div>
            <div style="flex:1">${this._lab('Nº parcelas')}<input id="rc-np" type="number" min="1" max="360" style="${s}" value="1"></div>
            <div style="flex:1">${this._lab('1ª parcela em')}<input id="rc-data" type="date" style="${s}" value="${hoje}"></div>
          </div>
          <div style="display:flex;gap:8px;margin-top:6px"><button class="td-button td-button--primary" style="flex:1" onclick="VMTerminalRecebimentos.salvarNovo()"><i class="fas fa-check"></i> Criar</button><button class="td-button" onclick="VM.closeModal()">Cancelar</button></div>
        </div></div>`)
    },
    async salvarNovo() {
      const vm = this._vm, g = i => document.getElementById(i)
      const valor_total = parseFloat(g('rc-total')?.value)
      const numero_parcelas = parseInt(g('rc-np')?.value)
      if (!g('rc-desc')?.value?.trim()) return vm.toast('Informe a descrição.', 'error')
      if (!(valor_total > 0)) return vm.toast('Valor total deve ser maior que zero.', 'error')
      if (!(numero_parcelas >= 1)) return vm.toast('Número de parcelas inválido.', 'error')
      const payload = {
        descricao: g('rc-desc').value.trim(),
        pagador: g('rc-pagador')?.value?.trim() || null,
        tipo: g('rc-tipo')?.value || 'venda',
        valor_total, numero_parcelas,
        data_inicio: g('rc-data')?.value,
      }
      const r = await vm.api('POST', 'antecipacao/recebimentos', payload).catch(e => ({ error: e.response?.data?.error }))
      if (r?.success) { vm.closeModal(); vm.toast(r.message || 'Recebimento criado.', 'success'); this.reload() }
      else vm.toast(r?.error || 'Erro ao criar.', 'error')
    },
    async verParcelas(id, nome) {
      const vm = this._vm
      const data = await vm.api('GET', `antecipacao/recebimentos/${id}/parcelas`).catch(() => ({ parcelas: [] }))
      const ps = data.parcelas || []
      const rows = ps.map(p => {
        const rec = p.status === 'recebida'
        return `<div class="ap-row">
          <span class="ap-row__date">#${p.numero_parcela} · ${dfmt(p.data_prevista)}</span>
          <span class="ap-row__main"><strong>${money(p.valor)}</strong><small>${rec ? 'recebida ' + dfmt(p.data_recebimento) : 'pendente'}</small></span>
          ${rec ? '<span class="ap-row__val" style="color:var(--terminal-primary)">✓</span>'
                : `<button class="td-button td-button--sm td-button--primary" onclick="VMTerminalRecebimentos.receber(${Number(id)}, ${Number(p.id)}, ${Number(p.valor)})">Receber</button>`}
        </div>`
      }).join('')
      vm.showModal(`<div style="font-family:var(--terminal-font);color:var(--terminal-ink);min-width:min(480px,92vw)">
        <div style="font-size:16px;font-weight:640">Parcelas — ${esc(nome)}</div>
        <div style="color:var(--terminal-ink-soft);font-size:12px;margin:4px 0 14px">Marque cada parcela ao receber — vira receita automaticamente</div>
        <div class="ap-list" style="max-height:56vh;overflow:auto">${rows || '<div class="td-empty-row"><span>Sem parcelas.</span></div>'}</div>
        <div style="margin-top:14px"><button class="td-button" onclick="VM.closeModal()">Fechar</button></div>
      </div>`)
    },
    async receber(recId, parcelaId, valor) {
      const vm = this._vm
      const txt = window.prompt(`Valor recebido desta parcela (previsto ${money(valor)}):`, String(valor))
      if (txt === null) return
      const valor_real = parseFloat(txt)
      if (!(valor_real > 0)) return vm.toast('Valor inválido.', 'error')
      const r = await vm.api('PATCH', `antecipacao/recebimentos/parcelas/${parcelaId}/receber`, { valor_real }).catch(e => ({ error: e.response?.data?.error }))
      if (r?.success) { vm.toast(r.message || 'Parcela recebida.', 'success'); this.verParcelas(recId, this._recs.find(x => Number(x.id) === Number(recId))?.descricao || '') ; this._silentReload() }
      else vm.toast(r?.error || 'Erro ao receber.', 'error')
    },
    async _silentReload() {
      try { const data = await this._vm.api('GET', 'antecipacao/recebimentos'); this._recs = data.recebimentos || [] } catch (_) {}
    },
    async excluir(id, nome) {
      const vm = this._vm
      if (!window.confirm(`Excluir o recebimento "${nome}"? As parcelas e as receitas geradas por ele também são removidas.`)) return
      const r = await vm.api('DELETE', `antecipacao/recebimentos/${id}`).catch(e => ({ error: e.response?.data?.error }))
      if (r?.success) { vm.toast('Recebimento removido.', 'success'); this.reload() }
      else vm.toast(r?.error || 'Erro ao excluir.', 'error')
    }
  }
})()
