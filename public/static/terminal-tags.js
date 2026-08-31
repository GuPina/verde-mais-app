(function () {
  const esc = (v) => String(v ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;')
  const money = (v) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 2 }).format(Number(v) || 0)
  const CORES = ['#3DDC84', '#F2C94C', '#FF6B6B', '#8B5CF6', '#3B82F6', '#EC4899', '#06B6D4', '#F97316', '#84CC16', '#6366F1']

  window.VMTerminalTags = {
    async render(vm) {
      this._vm = vm
      const content = document.getElementById('page-content')
      if (!content) return
      document.body.classList.add('terminal-dashboard-active')
      content.innerHTML = '<div class="td-loading"><span></span><span></span><span></span></div>'
      try {
        const d = await vm.api('GET', 'tags')
        this._tags = Array.isArray(d) ? d : (d.tags || [])
        this._paint()
      } catch (e) {
        content.innerHTML = `<div class="td-error"><i class="fas fa-triangle-exclamation"></i><h2>Não foi possível carregar as tags</h2><p>${esc(e.response?.data?.error || 'Tente novamente.')}</p><button class="td-button td-button--primary" onclick="VMTerminalTags.reload()">Tentar novamente</button></div>`
      }
    },
    reload() { this.render(this._vm) },

    _paint() {
      const content = document.getElementById('page-content')
      if (!content) return
      const t = this._tags
      const totalGasto = t.reduce((s, x) => s + (Number(x.total_despesas) || 0), 0)
      const usadas = t.filter(x => (Number(x.usos) || 0) > 0).length

      content.innerHTML = this._shell(`
        <div class="mr-toolbar">
          <div><span class="td-eyebrow">${t.length} tag${t.length === 1 ? '' : 's'} · ${usadas} em uso · ${money(totalGasto)} marcados</span><h2>Suas etiquetas</h2></div>
          <button class="td-button td-button--primary" onclick="VMTerminalTags.nova()"><i class="fas fa-plus"></i> Nova tag</button>
        </div>
        ${t.length ? `<div class="tg-grid">${t.map(x => this._card(x)).join('')}</div>` : this._empty()}
      `)
    },

    _card(t) {
      const usos = Number(t.usos) || 0
      return `<article class="tg-card">
        <span class="tg-dot" style="background:${esc(t.cor || '#3DDC84')}"></span>
        <div class="tg-card__main">
          <strong>${esc(t.nome)}</strong>
          <small>${usos} uso${usos === 1 ? '' : 's'}${Number(t.total_despesas) ? ' · ' + money(t.total_despesas) : ''}</small>
        </div>
        <div class="tg-card__act">
          <button class="td-icon-btn" title="Editar" onclick="VMTerminalTags.editar(${Number(t.id)})"><i class="fas fa-pen"></i></button>
          <button class="td-icon-btn" title="Excluir" onclick="VMTerminalTags.excluir(${Number(t.id)}, '${esc(t.nome).replace(/'/g, '')}')"><i class="fas fa-trash"></i></button>
        </div>
      </article>`
    },

    _empty() {
      return `<section class="td-onboarding"><div class="td-onboarding__copy">
        <span class="td-eyebrow">Organize do seu jeito</span>
        <h2>Crie sua primeira tag.</h2>
        <p>Etiquetas cruzam categorias — "viagem japão", "reforma", "trabalho" — e somam gastos que a categoria não junta.</p>
        <div class="td-onboarding__actions"><button class="td-button td-button--primary" onclick="VMTerminalTags.nova()"><i class="fas fa-plus"></i> Nova tag</button></div>
      </div></section>`
    },

    _st() { return 'width:100%;background:var(--terminal-bg);border:1px solid var(--terminal-line);color:var(--terminal-ink);border-radius:var(--terminal-radius-sm);padding:10px 12px;font-size:13px;font-family:var(--terminal-font)' },
    _lab(t) { return `<label style="display:block;font:700 10px/1 var(--terminal-mono);letter-spacing:.1em;text-transform:uppercase;color:var(--terminal-ink-soft);margin-bottom:6px">${t}</label>` },
    _swatches(sel) {
      return `<div class="tg-swatches">${CORES.map(c => `<button type="button" class="tg-sw ${sel === c ? 'tg-sw--on' : ''}" style="background:${c}" data-cor="${c}" onclick="VMTerminalTags._pick('${c}')"></button>`).join('')}</div>`
    },
    _pick(c) { this._cor = c; document.querySelectorAll('.tg-sw').forEach(b => b.classList.toggle('tg-sw--on', b.dataset.cor === c)) },

    nova() {
      this._cor = CORES[0]
      const s = this._st()
      this._vm.showModal(`<div style="font-family:var(--terminal-font);color:var(--terminal-ink);min-width:min(380px,92vw)">
        <div style="font-size:16px;font-weight:640">Nova tag</div>
        <div style="color:var(--terminal-ink-soft);font-size:12px;margin:4px 0 18px">Escolha um nome e uma cor</div>
        <div style="display:flex;flex-direction:column;gap:14px">
          <div>${this._lab('Nome')}<input id="tg-nome" style="${s}" placeholder="Ex.: Viagem Japão"></div>
          <div>${this._lab('Cor')}${this._swatches(this._cor)}</div>
          <div style="display:flex;gap:8px;margin-top:6px"><button class="td-button td-button--primary" style="flex:1" onclick="VMTerminalTags.salvar(0)"><i class="fas fa-check"></i> Criar</button><button class="td-button" onclick="VM.closeModal()">Cancelar</button></div>
        </div></div>`)
    },
    editar(id) {
      const t = this._tags.find(x => Number(x.id) === Number(id)); if (!t) return
      this._cor = t.cor || CORES[0]
      const s = this._st()
      this._vm.showModal(`<div style="font-family:var(--terminal-font);color:var(--terminal-ink);min-width:min(380px,92vw)">
        <div style="font-size:16px;font-weight:640">Editar tag</div>
        <div style="color:var(--terminal-ink-soft);font-size:12px;margin:4px 0 18px">${esc(t.nome)}</div>
        <div style="display:flex;flex-direction:column;gap:14px">
          <div>${this._lab('Nome')}<input id="tg-nome" style="${s}" value="${esc(t.nome)}"></div>
          <div>${this._lab('Cor')}${this._swatches(this._cor)}</div>
          <div style="display:flex;gap:8px;margin-top:6px"><button class="td-button td-button--primary" style="flex:1" onclick="VMTerminalTags.salvar(${Number(id)})"><i class="fas fa-check"></i> Salvar</button><button class="td-button" onclick="VM.closeModal()">Cancelar</button></div>
        </div></div>`)
    },
    async salvar(id) {
      const vm = this._vm
      const nome = document.getElementById('tg-nome')?.value?.trim()
      if (!nome) return vm.toast('Informe o nome da tag.', 'error')
      const payload = { nome, cor: this._cor || CORES[0] }
      const r = id
        ? await vm.api('PATCH', `tags/${id}`, payload).catch(e => ({ error: e.response?.data?.error }))
        : await vm.api('POST', 'tags', payload).catch(e => ({ error: e.response?.data?.error }))
      if (r && (r.success || r.id || r.nome)) { vm.closeModal(); vm.toast(id ? 'Tag atualizada.' : 'Tag criada.', 'success'); this.reload() }
      else vm.toast(r?.error || 'Erro ao salvar.', 'error')
    },
    async excluir(id, nome) {
      const vm = this._vm
      if (!window.confirm(`Excluir a tag "${nome}"? Ela sai de todos os lançamentos marcados.`)) return
      const r = await vm.api('DELETE', `tags/${id}`).catch(e => ({ error: e.response?.data?.error }))
      if (r && (r.success || r.message)) { vm.toast('Tag removida.', 'success'); this.reload() }
      else vm.toast(r?.error || 'Erro ao excluir.', 'error')
    },

    _shell(inner) {
      return `<div class="td-dashboard tg">
        <header class="td-dashboard__header">
          <div>
            <span class="td-eyebrow">Além das categorias</span>
            <h1>Tags & filtros. <em>Seus gastos, do seu jeito.</em></h1>
            <p>Etiquetas que cruzam categorias e somam o que importa para você — um projeto, uma viagem, uma meta.</p>
          </div>
        </header>
        ${inner}
      </div>`
    }
  }
})()
