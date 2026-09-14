/**
 * Central de Organização — a fila de decisões.
 *
 * A versão anterior mostrava uma lista de 48 categorias e um botão de lápis, e
 * esperava que o usuário descobrisse sozinho o que juntar. (Além disso os dois
 * botões estavam quebrados: o de renomear mandava campos que a rota não lia e
 * devolvia 400, e os dois testavam `r.success` numa resposta que devolve `ok`.
 * Nada ali funcionava havia meses.)
 *
 * Aqui a tela pergunta UMA coisa por vez, na ordem de quanto dinheiro cada
 * resposta destrava, e diz quantos lançamentos vai mexer antes de mexer.
 * Nada é aplicado sozinho, e tudo é desfazível por 30 dias.
 */
(function () {
  const esc = (v) => String(v ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;')
  const money = (v) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 2 }).format(Number(v) || 0)
  const n = (v) => (Number(v) || 0).toLocaleString('pt-BR')

  /** O backend manda **negrito** nas perguntas; aqui vira <b>, com escape antes. */
  const rico = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')

  const SELO_TOM = {
    conflito: 'neg', duplicata: 'warn', sem_dono: 'warn',
    vocabulario: 'info', parecidas: 'info',
  }

  window.VMTerminalOrganizador = {
    async render(vm) {
      this._vm = vm
      const content = document.getElementById('page-content')
      if (!content) return
      document.body.classList.add('terminal-dashboard-active')
      content.innerHTML = '<div class="td-loading"><span></span><span></span><span></span></div>'
      try {
        this._d = await vm.api('GET', 'organizador/decisoes')
        this._escolhas = {}
        this._vocabOff = new Set()
        this._paint()
      } catch (e) {
        content.innerHTML = `<div class="td-error"><i class="fas fa-triangle-exclamation"></i>
          <h2>Não foi possível carregar</h2><p>${esc(e.response?.data?.error || 'Tente novamente.')}</p>
          <button class="ds-btn ds-btn--primary" onclick="VMTerminalOrganizador.reload()">Tentar novamente</button></div>`
      }
    },
    reload() { this.render(this._vm) },

    _paint() {
      const content = document.getElementById('page-content')
      if (!content) return
      const d = this._d || {}
      const r = d.resumo || {}
      const fila = d.decisoes || []

      content.innerHTML = this._shell(`
        ${this._retrato(r)}
        ${this._desfazer(d.acoes || [])}
        ${fila.length ? `<div class="og-fila">${fila.map((x, i) => this._card(x, i)).join('')}</div>` : this._vazio(r)}
        ${fila.length ? `<div class="ds-note ds-note--warn og-rodape">
          <i class="fas fa-hand ds-note__ico"></i>
          <div><b>Nada é aplicado sozinho.</b> O sistema detecta, ordena e propõe; quem decide é você.
            Toda decisão mostra quantos lançamentos muda antes de mudar, e volta atrás por 30 dias.</div>
        </div>` : ''}
      `)
    },

    // ── O tamanho do problema, em uma linha ──────────────────────────────────
    _retrato(r) {
      // 834 → 659 → 222 é a história inteira em três números: quantos
      // lançamentos existem, quantos textos diferentes foram digitados, e
      // quantas coisas de verdade isso é. A distância entre o segundo e o
      // terceiro é o trabalho que esta tela faz sozinha.
      return `<div class="og-retrato">
        ${this._stat('Lançamentos', n(r.despesas))}
        ${this._stat('Descrições digitadas', n(r.descricoes), 'warn')}
        ${this._stat('Coisas de verdade', n(r.identidades), 'ok', 'depois de normalizar')}
        ${this._stat('Categorias em uso', n(r.categorias), r.categorias > 25 ? 'warn' : '')}
        ${this._stat('Em duas gavetas', n(r.conflitos), r.conflitos ? 'neg' : 'ok', 'a mesma coisa em categorias diferentes')}
      </div>`
    },
    _stat(lbl, val, tom, sub) {
      return `<div class="og-stat">
        <span class="og-stat__lbl">${esc(lbl)}</span>
        <span class="og-stat__val${tom ? ' is-' + tom : ''}">${esc(val)}</span>
        ${sub ? `<small>${esc(sub)}</small>` : ''}
      </div>`
    },

    _desfazer(acoes) {
      if (!acoes.length) return ''
      const a = acoes[0]
      return `<div class="ds-note ds-note--ok og-undo">
        <i class="fas fa-rotate-left ds-note__ico"></i>
        <div><b>Feito:</b> ${esc(a.resumo)} — ${n(a.afetados)} ${Number(a.afetados) === 1 ? 'lançamento' : 'lançamentos'}.</div>
        <button class="ds-btn ds-btn--sm" onclick="VMTerminalOrganizador.desfazer(${Number(a.id)})">Desfazer</button>
      </div>`
    },

    _vazio(r) {
      return `<article class="td-panel og-vazio">
        <i class="fas fa-circle-check"></i>
        <h2>Nada para decidir.</h2>
        <p>Suas ${n(r.identidades)} identidades estão cada uma em uma categoria só, e nenhum nome de
          categoria está repetido. É assim que o relatório por categoria fecha com o extrato.</p>
        <p class="og-vazio__p2">Quando você lançar algo que o sistema não reconhecer, ou que entrar
          em conflito com o que já existe, a pergunta aparece aqui.</p>
      </article>`
    },

    // ── Um cartão, uma pergunta ──────────────────────────────────────────────
    _card(x, i) {
      const foco = i === 0
      const corpo = x.tipo === 'vocabulario' ? this._vocab(x) : this._escolhasDe(x)
      return `<article class="og-card${foco ? ' is-foco' : ''}" id="og-${esc(x.id)}">
        <div class="og-card__top">
          <div class="og-card__id">
            <strong>${esc(x.titulo)}</strong>
            <small>${esc(x.subtitulo)}</small>
          </div>
          ${x.selo ? `<span class="og-pill og-pill--${SELO_TOM[x.tipo] || 'info'}">${esc(x.selo)}</span>` : ''}
        </div>
        <p class="og-card__perg">${rico(x.pergunta)}</p>
        ${corpo}
        ${this._acoes(x)}
      </article>`
    },

    _escolhasDe(x) {
      if (!x.opcoes || !x.opcoes.length) return ''
      const atual = this._escolhas[x.id] ?? (x.opcoes.find(o => o.sugerida) || x.opcoes[0]).valor
      this._escolhas[x.id] = atual
      return `<div class="og-escolhas">
        ${x.opcoes.map(o => `<button type="button" class="og-esc${o.valor === atual ? ' is-on' : ''}"
            onclick="VMTerminalOrganizador.escolher('${esc(x.id)}', this)" data-valor="${esc(o.valor)}">
          ${esc(o.valor)}
          ${o.lancamentos ? `<span>${o.lancamentos}</span>` : ''}
          ${o.nota ? `<span>${esc(o.nota)}</span>` : ''}
        </button>`).join('')}
      </div>`
    },

    // O lote do vocabulário é a única decisão com várias respostas de uma vez.
    // Cada par tem o seu interruptor: aceitar tudo é um clique, e discordar de
    // um item não obriga a recusar os outros dezesseis.
    _vocab(x) {
      const pares = (x.alvo && x.alvo.pares) || []
      return `<div class="og-vocab">
        ${pares.map((p, i) => `<label class="og-par${this._vocabOff.has(i) ? ' is-off' : ''}" data-i="${i}">
          <input type="checkbox" ${this._vocabOff.has(i) ? '' : 'checked'}
                 onchange="VMTerminalOrganizador.togglePar(${i}, this)">
          <span class="og-par__de">${esc(p.de)}</span>
          <i class="fas fa-arrow-right"></i>
          <span class="og-par__para">${esc(p.para)}</span>
          <span class="og-par__meta">${p.n} · ${money(p.total)}</span>
        </label>`).join('')}
      </div>`
    },

    _acoes(x) {
      const idj = esc(x.id)
      if (x.tipo === 'vocabulario') {
        return `<div class="og-btns">
          <button class="ds-btn ds-btn--primary" onclick="VMTerminalOrganizador.aplicar('${idj}')">Aplicar as selecionadas</button>
          <button class="ds-btn ds-btn--sm" onclick="VMTerminalOrganizador.dispensar('${idj}', 'recusada')">Manter meus nomes</button>
          <button class="ds-btn ds-btn--sm" onclick="VMTerminalOrganizador.dispensar('${idj}', 'adiada')">Depois</button>
        </div>`
      }
      const rotulo = {
        conflito: () => `Aplicar aos ${x.lancamentos}`,
        sem_dono: () => `Aplicar aos ${x.lancamentos}`,
        duplicata: () => 'Juntar num nome só',
        parecidas: () => 'É a mesma coisa',
      }[x.tipo] || (() => 'Aplicar')
      const recusa = {
        conflito: 'São coisas diferentes',
        sem_dono: 'Deixar como está',
        duplicata: 'Manter separadas',
        parecidas: 'São diferentes',
      }[x.tipo] || 'Ignorar'
      return `<div class="og-btns">
        <button class="ds-btn ds-btn--primary" onclick="VMTerminalOrganizador.aplicar('${idj}')">${esc(rotulo())}</button>
        <button class="ds-btn ds-btn--sm" onclick="VMTerminalOrganizador.dispensar('${idj}', 'recusada')">${esc(recusa)}</button>
        <button class="ds-btn ds-btn--sm" onclick="VMTerminalOrganizador.dispensar('${idj}', 'adiada')">Depois</button>
      </div>`
    },

    // ── Interação ────────────────────────────────────────────────────────────
    escolher(id, botao) {
      this._escolhas[id] = botao.dataset.valor
      // Repinta só o grupo de botões clicado: repintar a tela inteira rolaria
      // a página de volta ao topo no meio de uma fila de sete perguntas.
      const grupo = botao.parentElement
      for (const b of grupo.querySelectorAll('.og-esc')) b.classList.toggle('is-on', b === botao)
    },

    togglePar(i, input) {
      if (input.checked) this._vocabOff.delete(i)
      else this._vocabOff.add(i)
      input.closest('.og-par')?.classList.toggle('is-off', !input.checked)
    },

    _acharDecisao(id) { return (this._d?.decisoes || []).find(d => d.id === id) },

    async aplicar(id) {
      const vm = this._vm
      const x = this._acharDecisao(id)
      if (!x) return

      let corpo = { decisao_id: x.id, tipo: x.tipo, alvo: x.alvo, escolha: this._escolhas[x.id] || '' }
      let pergunta = ''

      if (x.tipo === 'vocabulario') {
        const pares = ((x.alvo && x.alvo.pares) || []).filter((_, i) => !this._vocabOff.has(i))
        if (!pares.length) return vm.toast('Nenhuma categoria selecionada.', 'error')
        const total = pares.reduce((s, p) => s + (Number(p.n) || 0), 0)
        corpo.alvo = { pares }
        pergunta = `Renomear ${pares.length} ${pares.length === 1 ? 'categoria' : 'categorias'}, ` +
          `mexendo em ${total} ${total === 1 ? 'lançamento' : 'lançamentos'}?`
      } else {
        if (!corpo.escolha) return vm.toast('Escolha uma opção primeiro.', 'error')
        pergunta = x.tipo === 'parecidas'
          ? `Tratar "${x.titulo}" como uma coisa só, com o nome <strong>${esc(corpo.escolha)}</strong>?`
          : `Mover ${x.lancamentos} ${x.lancamentos === 1 ? 'lançamento' : 'lançamentos'} para ` +
            `<strong>${esc(corpo.escolha)}</strong>?`
      }

      // A confirmação repete o NÚMERO de lançamentos de propósito. É a última
      // chance de notar que a decisão é maior do que parecia.
      if (!await window.VM.vmConfirm(pergunta + ' Dá para desfazer nos próximos 30 dias.')) return

      const r = await vm.api('POST', 'organizador/decisoes/aplicar', corpo)
        .catch(e => ({ error: e.response?.data?.error || 'Falha ao aplicar.' }))
      if (r && r.ok) { vm.toast(r.mensagem || 'Pronto.', 'success'); this.reload() }
      else vm.toast(r?.error || 'Erro ao aplicar.', 'error')
    },

    async dispensar(id, motivo) {
      const vm = this._vm
      const r = await vm.api('POST', 'organizador/decisoes/dispensar', { decisao_id: id, motivo })
        .catch(e => ({ error: e.response?.data?.error || 'Falha.' }))
      if (r && r.ok) { vm.toast(r.mensagem || 'Ok.', 'success'); this.reload() }
      else vm.toast(r?.error || 'Erro.', 'error')
    },

    async desfazer(acaoId) {
      const vm = this._vm
      if (!await window.VM.vmConfirm('Voltar os lançamentos ao que eram antes desta decisão?')) return
      const r = await vm.api('POST', 'organizador/desfazer', { acao_id: acaoId })
        .catch(e => ({ error: e.response?.data?.error || 'Falha ao desfazer.' }))
      if (r && r.ok) { vm.toast(r.mensagem || 'Desfeito.', 'success'); this.reload() }
      else vm.toast(r?.error || 'Erro ao desfazer.', 'error')
    },

    _shell(inner) {
      const r = (this._d || {}).resumo || {}
      const p = Number(r.pendentes) || 0
      return `<div class="td-dashboard og">
        <header class="td-dashboard__header">
          <div>
            <span class="td-eyebrow">Arrume uma vez, vale para sempre</span>
            <h1>Central de organização. <em>Uma pergunta por vez.</em></h1>
            <p>${p
              ? `${p} ${p === 1 ? 'decisão pendente' : 'decisões pendentes'} · afetam ${n(r.lancamentos_afetados)} lançamentos e ${money(r.valor_afetado)}. Cada resposta arruma tudo de uma vez, inclusive o que vier depois.`
              : 'Tudo em ordem por aqui. Quando algo entrar em conflito, a pergunta aparece nesta tela.'}</p>
          </div>
        </header>
        ${inner}
      </div>`
    },
  }
})()
