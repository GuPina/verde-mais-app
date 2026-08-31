(function () {
  const esc = (v) => String(v ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;')
  const SUG_INICIAIS = ['Como estão minhas finanças?', 'Onde gastei mais este mês?', 'Como está minha reserva de emergência?', 'Quanto posso investir por mês?']

  window.VMTerminalAssistente = {
    async render(vm) {
      this._vm = vm
      const content = document.getElementById('page-content')
      if (!content) return
      document.body.classList.add('terminal-dashboard-active')
      content.innerHTML = '<div class="td-loading"><span></span><span></span><span></span></div>'
      this._msgs = []
      try {
        const h = await vm.api('GET', 'assistente/historico?limit=20').catch(() => ({ historico: [] }))
        const hist = (h.historico || []).slice().reverse()
        for (const c of hist) {
          if (c.mensagem_usuario) this._msgs.push({ role: 'user', texto: c.mensagem_usuario })
          if (c.resposta_ia) this._msgs.push({ role: 'bot', texto: c.resposta_ia })
        }
      } catch (_) {}
      this._sug = SUG_INICIAIS
      this._paint()
    },
    reload() { this.render(this._vm) },

    _paint() {
      const content = document.getElementById('page-content')
      if (!content) return
      content.innerHTML = this._shell(`
        <article class="td-panel as-panel">
          <div class="td-panel__head"><div><span class="td-eyebrow">Conversa</span><h2>Pergunte sobre suas finanças</h2></div>
            ${this._msgs.length ? `<button class="td-icon-btn" title="Limpar conversa" onclick="VMTerminalAssistente.limpar()"><i class="fas fa-trash"></i></button>` : ''}
          </div>
          <div class="as-chat" id="as-chat">${this._msgs.length ? this._msgs.map(m => this._bubble(m)).join('') : this._welcome()}</div>
          ${this._sug && this._sug.length ? `<div class="as-sug">${this._sug.map(s => `<button class="as-chip" onclick="VMTerminalAssistente.enviar(this.textContent)">${esc(s)}</button>`).join('')}</div>` : ''}
          <div class="as-input">
            <input id="as-msg" placeholder="Escreva sua pergunta…" style="flex:1;background:var(--terminal-bg);border:1px solid var(--terminal-line);color:var(--terminal-ink);border-radius:var(--terminal-radius-sm);padding:12px 14px;font-size:13px;font-family:var(--terminal-font)" onkeydown="if(event.key==='Enter'){VMTerminalAssistente.enviar()}">
            <button class="td-button td-button--primary" onclick="VMTerminalAssistente.enviar()"><i class="fas fa-paper-plane"></i></button>
          </div>
        </article>
      `)
      this._scroll()
    },

    _bubble(m) {
      return `<div class="as-row as-row--${m.role}"><div class="as-bubble as-bubble--${m.role}">${esc(m.texto).replace(/\n/g, '<br>')}</div></div>`
    },
    _welcome() {
      return `<div class="as-welcome"><div class="as-avatar">🌱</div><strong>Oi! Sou o assistente do VerdeMais.</strong><p>Pergunte sobre seus gastos, reserva, metas, dívidas ou investimentos — respondo com base nos seus dados.</p></div>`
    },
    _scroll() { const el = document.getElementById('as-chat'); if (el) el.scrollTop = el.scrollHeight },

    async enviar(texto) {
      const vm = this._vm
      const inp = document.getElementById('as-msg')
      const msg = (texto || inp?.value || '').trim()
      if (!msg) return
      if (inp) inp.value = ''
      this._sug = null
      this._msgs.push({ role: 'user', texto: msg })
      this._msgs.push({ role: 'bot', texto: '…', _loading: true })
      this._paint()
      try {
        const r = await vm.api('POST', 'assistente/chat', { mensagem: msg })
        this._msgs.pop() // remove loading
        this._msgs.push({ role: 'bot', texto: r?.resposta || 'Não consegui responder agora.' })
        this._sug = (r?.sugestoes && r.sugestoes.length) ? r.sugestoes : null
      } catch (e) {
        this._msgs.pop()
        this._msgs.push({ role: 'bot', texto: e.response?.data?.error || 'Não consegui responder agora. Tente de novo.' })
      }
      this._paint()
    },
    async limpar() {
      const vm = this._vm
      if (!window.confirm('Limpar todo o histórico da conversa?')) return
      await vm.api('DELETE', 'assistente/historico').catch(() => {})
      this._msgs = []; this._sug = SUG_INICIAIS
      vm.toast('Conversa limpa.', 'success')
      this._paint()
    },

    _shell(inner) {
      return `<div class="td-dashboard as">
        <header class="td-dashboard__header">
          <div>
            <span class="td-eyebrow">Seu copiloto financeiro</span>
            <h1>Assistente VerdeMais. <em>Pergunte, entenda, decida.</em></h1>
            <p>Um bate-papo que lê os seus dados: gastos, reserva, metas e dívidas — respostas no seu contexto.</p>
          </div>
        </header>
        ${inner}
      </div>`
    }
  }
})()
