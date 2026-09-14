(function () {
  const esc = (v) => String(v ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;')
  const money = (v) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 2 }).format(Number(v) || 0)
  const moneyK = (v) => { const n = Number(v) || 0; return Math.abs(n) >= 1000 ? 'R$ ' + (n / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + 'k' : money(n) }
  const pct = (v, d = 1) => (Number(v) || 0).toLocaleString('pt-BR', { maximumFractionDigits: d }) + '%'
  const MES_LONGO = { jan:'janeiro', fev:'fevereiro', mar:'março', abr:'abril', mai:'maio', jun:'junho',
                      jul:'julho', ago:'agosto', set:'setembro', out:'outubro', nov:'novembro', dez:'dezembro' }
  /** 'Set/2027' → 'setembro de 2027'. O eixo do gráfico cabe abreviado; frase não. */
  const porExtenso = (lbl) => {
    const m = String(lbl || '').match(/^([A-Za-zçÇ]{3})\/?(\d{4})?$/)
    if (!m) return String(lbl || '')
    const nome = MES_LONGO[m[1].toLowerCase()] || m[1]
    return m[2] ? `${nome} de ${m[2]}` : nome
  }

  window.VMTerminalProjecao = {
    async render(vm) {
      this._vm = vm
      const content = document.getElementById('page-content')
      if (!content) return
      document.body.classList.add('terminal-dashboard-active')
      content.innerHTML = '<div class="td-loading"><span></span><span></span><span></span></div>'
      try {
        const d = await vm.api('GET', 'projecao?meses=12')
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
      const b = d.balanco || {}
      content.innerHTML = this._shell(`
        ${this._indice()}
        ${this._comoLer(d)}
        <div id="pj-retrato">${this._retrato(d, b)}</div>
        <div id="pj-gastos">${this._gastos(d)}</div>
        <div id="pj-dividas">${this._endividamento(d)}</div>
        <div id="pj-plano">${this._plano(d)}</div>
        <div id="pj-futuro">${this._futuro(d)}</div>
      `)
      // O plano nasce com os alvos vazios: quem os preenche é a simulação do
      // cliente, a mesma que roda a cada tecla. Uma função, um resultado.
      this._planoLive()
    },

    _indice() {
      // Sem gasto categorizado na janela, a seção não é renderizada — o atalho
      // para ela também não pode existir, senão leva a lugar nenhum.
      const temGastos = !!(this._d?.gastos?.categorias?.length)
      const alvos = [['pj-retrato', 'Retrato'],
        ...(temGastos ? [['pj-gastos', 'Gastos']] : []),
        ['pj-dividas', 'Dívidas'], ['pj-plano', 'Plano'], ['pj-futuro', 'Futuro']]
      return `<nav class="pj-indice">
        <span class="pj-indice__lbl">Ir para</span>
        ${alvos.map(([id, nome]) => `<button type="button" class="pj-indice__b" onclick="VMTerminalProjecao.irPara('${id}')">${nome}</button>`).join('')}
      </nav>`
    },
    irPara(id) {
      const el = document.getElementById(id)
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    },

    // ── 1 · 2 · 3 e o patrimônio ─────────────────────────────────────────────
    _retrato(d, b) {
      const tem = b.tem || {}, deve = b.deve || {}, renda = b.renda || {}, idx = b.indices || {}
      const pl = Number(b.patrimonio_liquido) || 0
      const contratada = Number(deve.contratada) || 0
      const futura = (deve.lista || []).find(x => !x.vigente)

      return `
        <h2 class="pj-h2">Onde você está</h2>
        <div class="pj-secoes">
          <div class="pj-col">
            ${this._bloco('1', 'O que você tem', money(tem.total), '', [
              Number(tem.bens_quitados) > 0 ? ['Bens quitados', money(tem.bens_quitados), ''] : null,
              Number(tem.bens_em_formacao) > 0 ? ['Financiado · o que já foi pago', money(tem.bens_em_formacao),
                'o bem ainda não é seu, mas esse dinheiro é'] : null,
              ['Investimentos', money(tem.investimentos), ''],
              ['Reserva de emergência', money(tem.reserva), ''],
            ], 'de Bens · Financiamentos · Investimentos · Reserva')}

            ${this._bloco('2', 'O que você deve', money(deve.total), 'neg', [
              Number(deve.financiamentos) > 0 ? ['Financiamentos', money(deve.financiamentos),
                contratada > 0 && futura ? `1ª parcela em ${this._data(futura.comeca_em)} · você deve, e ainda não tem o bem` : ''] : null,
              Number(deve.cartoes) > 0 ? ['Cartões', money(deve.cartoes), 'saldo total, não a fatura do mês'] : null,
              Number(deve.emprestimos) > 0 ? ['Empréstimos', money(deve.emprestimos), ''] : null,
              Number(deve.entradas) > 0 ? ['Entradas em aberto', money(deve.entradas), ''] : null,
            ], 'de Financiamentos · Cartões · Empréstimos')}

            ${this._bloco('3', 'Sua renda', money(renda.mensal) + '<em>/mês</em>', '', [
              ['Média dos meses fechados', money(renda.media_lancada), ''],
              Number(renda.recorrente) > 0 ? ['Receita recorrente', money(renda.recorrente), ''] : null,
              ['Oscilação mês a mês', '± ' + money(renda.oscilacao),
                `${renda.meses_base} ${renda.meses_base === 1 ? 'mês' : 'meses'} de base`],
            ], 'de Receitas')}
          </div>

          <div class="pj-col">
            <div class="pj-pl ${pl >= 0 ? 'is-ok' : 'is-neg'}">
              <span class="pj-pl__lbl">Patrimônio líquido</span>
              <div class="pj-pl__val">${pl >= 0 ? '' : '−'}${money(Math.abs(pl))}</div>
              <p class="pj-pl__txt">
                Você tem <b>${money(tem.total)}</b> e deve <b>${money(deve.total)}</b>.
                ${contratada > 0
                  ? `Boa parte da dívida é um compromisso que ainda não começou a ser pago — você deve, e o bem ainda não é seu. Conforme você paga, o saldo migra da coluna da dívida para a do que é seu.`
                  : `Conforme você paga, o saldo migra da coluna da dívida para a do que é seu.`}
              </p>
              <span class="ds-pill ds-pill--${pl >= 0 ? 'ok' : 'neg'}">${pl >= 0 ? 'no azul' : 'patrimônio líquido negativo'}</span>
            </div>
            ${this._trabalha(b)}
          </div>
        </div>

        <h3 class="pj-h3">Radiografia do patrimônio</h3>
        <div class="dg-kpis">
          ${this._kpi('Disponibilidade', pct(idx.disponibilidade), idx.disponibilidade >= 20 ? 'ok' : 'neg',
            'do que você tem, quanto vira dinheiro sem vender nada')}
          ${this._kpi('Imobilização', pct(idx.imobilizacao), idx.imobilizacao >= 80 ? 'warn' : 'ok',
            'preso em bem de uso, que não paga conta')}
          ${this._kpi('Gera renda', pct(idx.gera_renda), idx.gera_renda >= 20 ? 'ok' : 'neg',
            'a parte do seu patrimônio que trabalha por você')}
          ${this._kpi('Reserva cobre', `${(Number(idx.reserva_meses) || 0).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} ${Number(idx.reserva_meses) === 1 ? 'mês' : 'meses'}`,
            Number(idx.reserva_meses) >= 3 ? 'ok' : 'neg',
            `o alvo, a ${b.reserva?.alvo_meses || 6} meses de gasto, é ${money(b.reserva?.alvo_valor)}`)}
        </div>`
    },

    _bloco(n, titulo, valor, tom, linhas, fonte) {
      const ls = (linhas || []).filter(Boolean)
      return `<article class="pj-bloco">
        <div class="pj-bloco__top">
          <div><span class="pj-bloco__n">${n}</span><span class="pj-bloco__tit">${esc(titulo)}</span></div>
          <span class="pj-bloco__val ${tom === 'neg' ? 'is-neg' : ''}">${valor}</span>
        </div>
        <div class="pj-linhas">
          ${ls.map(([k, v, nota]) => `<div class="pj-linha">
            <span>${esc(k)}${nota ? `<small>${esc(nota)}</small>` : ''}</span><b>${v}</b>
          </div>`).join('')}
        </div>
        ${fonte ? `<p class="pj-fonte">${esc(fonte)}</p>` : ''}
      </article>`
    },

    /** Uma barra empilhada diz "nada trabalha por você" mais rápido que um número. */
    _trabalha(b) {
      const tem = b.tem || {}
      const total = Number(tem.total) || 0
      if (total <= 0) return ''
      const fatia = (v) => Math.max(0, (Number(v) || 0) / total * 100)
      const uso = fatia(tem.bens_quitados), form = fatia(tem.bens_em_formacao)
      const trab = fatia(Number(tem.investimentos) + Number(tem.reserva))
      return `<div class="pj-trab">
        <span class="dg-kpi__lbl">O que trabalha por você</span>
        <div class="pj-trab__barra" role="img" aria-label="Composição do patrimônio">
          ${uso > 0 ? `<span style="width:${uso}%;background:var(--terminal-accent)" title="Bem de uso"></span>` : ''}
          ${form > 0 ? `<span style="width:${form}%;background:#6BA8FF" title="Em formação"></span>` : ''}
          ${trab > 0 ? `<span style="width:${trab}%;background:var(--terminal-primary)" title="Gera renda"></span>` : ''}
        </div>
        <div class="pj-trab__leg">
          ${uso > 0 ? `<span><i style="background:var(--terminal-accent)"></i>Bem de uso · ${pct(uso)}</span>` : ''}
          ${form > 0 ? `<span><i style="background:#6BA8FF"></i>Em formação · ${pct(form)}</span>` : ''}
          <span><i style="background:var(--terminal-primary)"></i>Gera renda · ${pct(trab)}</span>
        </div>
      </div>`
    },

    // ── Endividamento ────────────────────────────────────────────────────────
    _endividamento(d) {
      const e = d.endividamento || {}
      const comp = Number(e.comprometimento) || 0
      const lim = Number(e.limite_sugerido) || 30
      const det = (e.detalhe || []).slice().sort((a, b) => b.valor - a.valor)
      const maior = Math.max(1, ...det.map(x => Number(x.valor) || 0))
      const tom = comp <= lim ? 'ok' : comp <= lim * 2 ? 'warn' : 'neg'
      const futura = (d.balanco?.deve?.lista || []).filter(x => !x.vigente && x.parcela > 0)

      return `<article class="td-panel pj-sec">
        <div class="td-panel__head"><div><span class="td-eyebrow">Quanto da renda já tem dono</span>
          <h2>Diagnóstico de endividamento</h2></div></div>
        <div class="pj-secoes">
          <div>
            <span class="dg-kpi__lbl">Comprometimento da renda</span>
            <div class="pj-grande is-${tom}">${pct(comp)}</div>
            <div class="pj-semaforo">
              <div class="pj-semaforo__trilho">
                <span class="pj-semaforo__fill" style="width:${Math.min(100, comp)}%"></span>
                <span class="pj-semaforo__marca" style="left:${lim}%"></span>
              </div>
              <div class="pj-semaforo__leg"><span>0%</span><span class="is-forte">sugestão: ${lim}%</span><span>100%</span></div>
            </div>
            <p class="pj-nota-txt">
              ${money(e.prestacoes)} saem por mês em prestações, de ${money(d.balanco?.renda?.mensal)} que entram.
              Sobram <b>${money(e.sobra_depois_das_prestacoes)}</b> para viver e guardar.
            </p>
            <p class="pj-nota-txt">${esc(e.nota || '')}</p>
          </div>
          <div class="pj-barras">
            ${det.map(x => `<div>
              <div class="pj-barra__top"><span>${esc(x.nome)}</span><b>${money(x.valor)} · ${pct((Number(x.valor) / (Number(d.balanco?.renda?.mensal) || 1)) * 100)}</b></div>
              <div class="pj-barra__trilho"><span style="width:${(Number(x.valor) / maior) * 100}%;background:${x.origem === 'cartao' ? 'var(--terminal-negative)' : 'var(--terminal-accent)'}"></span></div>
            </div>`).join('')}
            ${futura.map(x => `<div>
              <div class="pj-barra__top"><span>${esc(x.nome)} <span class="pj-fraco">· a partir de ${this._data(x.comeca_em)}</span></span><b>${money(x.parcela)}</b></div>
              <div class="pj-barra__trilho"><span style="width:${(Number(x.parcela) / maior) * 100}%;background:#2a3f5d"></span></div>
            </div>`).join('')}
            ${det.length ? `<p class="pj-nota-txt">${this._ondeEstaOPeso(det, e.prestacoes)}</p>` : ''}
          </div>
        </div>
      </article>`
    },

    _ondeEstaOPeso(det, total) {
      const t = Number(total) || 0
      if (!t || !det.length) return ''
      const maior = det[0]
      const p = Math.round((Number(maior.valor) / t) * 100)
      if (p < 45) return 'O peso está dividido entre vários compromissos — não há um único a atacar.'
      return `O peso está em <b>${esc(maior.nome)}</b>: ${p}% de tudo que você paga em prestação. É ali que uma decisão sua muda o número.`
    },

    // ── Para onde o dinheiro está indo ───────────────────────────────────────
    //
    // Duas leituras da mesma janela, porque respondem a coisas diferentes:
    // categoria é o mapa oficial (obrigatória, uma por despesa, a soma fecha
    // com o total); tag é o corte transversal (opcional, múltipla, a soma NÃO
    // fecha e não é fatia de bolo). Misturar as duas na mesma barra seria
    // mentir sobre o denominador — por isso o botão troca a leitura inteira,
    // rótulo, nota de rodapé e tudo.
    _gastos(d) {
      const g = d.gastos
      if (!g || !g.categorias || !g.categorias.length) return ''
      const modo = this._modoGasto || 'categorias'
      const lista = modo === 'tags' ? (g.tags || []) : g.categorias
      const rendaM = Number(d.balanco?.renda?.mensal) || 0

      const cabeca = `<div class="td-panel__head">
        <div><span class="td-eyebrow">Em que foi parar</span>
          <h2>Para onde o dinheiro está indo</h2></div>
        <div class="pj-gs__toggle">
          <button type="button" class="pj-sim__b ${modo === 'categorias' ? 'is-on' : ''}"
                  onclick="VMTerminalProjecao.mudarModoGasto('categorias')">Categorias</button>
          <button type="button" class="pj-sim__b ${modo === 'tags' ? 'is-on' : ''}"
                  onclick="VMTerminalProjecao.mudarModoGasto('tags')">Tags</button>
        </div>
      </div>`

      if (modo === 'tags' && !lista.length) {
        return `<article class="td-panel pj-sec">
          ${cabeca}
          <div class="ds-note ds-note--info pj-nota">
            <i class="fas fa-tag ds-note__ico"></i>
            <div><b>Você ainda não etiquetou nenhuma despesa.</b> A categoria responde
              “que tipo de gasto é este”. A tag responde outra pergunta, que categoria
              nenhuma alcança: <i>quanto custou a mudança</i>, <i>quanto custou o carro</i>,
              <i>quanto foi de viagem</i> — atravessando categorias diferentes.
              Marque algumas despesas com a mesma etiqueta e o total aparece aqui.</div>
          </div>
        </article>`
      }

      const maior = Math.max(...lista.map(x => Number(x.total) || 0), 1)
      const visiveis = lista.slice(0, 8)
      const resto = lista.slice(8)
      const restoTotal = resto.reduce((s, x) => s + (Number(x.total) || 0), 0)

      const barra = (x) => {
        const t = Number(x.total) || 0
        const contratado = Number(x.contratado) || 0
        const pctContratado = t > 0 ? (contratado / t) * 100 : 0
        return `<div>
          <div class="pj-barra__top">
            <span>${esc(x.nome)} <span class="pj-fraco">· ${x.lancamentos} ${x.lancamentos === 1 ? 'lançamento' : 'lançamentos'}</span></span>
            <b>${money(x.media)}<span class="pj-fraco">/mês</span> · ${pct(x.pct)}</b>
          </div>
          <div class="pj-barra__trilho" title="${esc(x.nome)}: ${money(t)} em ${g.meses} meses">
            <span style="width:${(t / maior) * 100}%;background:var(--terminal-accent)"></span>
            ${pctContratado >= 8 ? `<span class="pj-barra__fixo" style="width:${(t / maior) * pctContratado}%"></span>` : ''}
          </div>
        </div>`
      }

      const dup = (g.duplicadas || [])[0]

      return `<article class="td-panel pj-sec">
        ${cabeca}
        <p class="pj-fonte">${esc(g.periodo)} · ${g.meses} ${g.meses === 1 ? 'mês fechado' : 'meses fechados'} ·
          ${money(g.media_mensal)} por mês em média${rendaM > 0 ? `, ou ${pct((g.media_mensal / rendaM) * 100)} do que entra` : ''}.
          O mês em curso fica de fora: ele ainda não terminou.</p>

        ${modo === 'categorias' && dup ? `<div class="ds-note ds-note--warn pj-nota">
          <i class="fas fa-triangle-exclamation ds-note__ico"></i>
          <div><b>${dup.nomes.map(n => `“${esc(n.nome)}”`).join(' e ')} são o mesmo assunto escrito de dois jeitos.</b>
            Enquanto forem duas categorias, esse gasto aparece partido —
            ${dup.nomes.map(n => money(n.total)).join(' de um lado, ')} do outro, quando na verdade é
            ${money(dup.total)}. Isto se resolve numa pergunta na Central de Organização —
            e resolve para todos os relatórios de uma vez, não só para este.</div>
          <button class="ds-btn ds-btn--sm pj-gs__ir" onclick="VM.navigate('organizador')">Resolver</button>
        </div>` : ''}

        <div class="pj-barras pj-gs__barras">
          ${visiveis.map(barra).join('')}
          ${resto.length ? `<div class="pj-gs__resto">
            <span>+ ${resto.length} ${modo === 'tags' ? (resto.length === 1 ? 'outra etiqueta' : 'outras etiquetas') : (resto.length === 1 ? 'outra categoria' : 'outras categorias')}</span>
            <b>${money(restoTotal / g.meses)}<span class="pj-fraco">/mês</span></b>
          </div>` : ''}
        </div>

        ${modo === 'categorias'
          ? `<p class="pj-nota-txt">As três maiores categorias levam <b>${pct(g.top3_pct)}</b> de tudo que sai.
              A faixa clara dentro da barra é a parte já contratada — parcela ou recorrência — que não muda
              com decisão deste mês.${g.categorias.some(c => c.nome === 'Sem categoria')
                ? ' Há gasto sem categoria: enquanto existir, o ranking está incompleto.' : ''}</p>`
          : `<p class="pj-nota-txt">Etiqueta não é fatia de bolo: a mesma despesa pode levar duas, então
              estes valores se sobrepõem e <b>não somam o total</b>. Leia cada linha sozinha —
              “quanto custou isto”, não “que porcentagem do meu dinheiro é isto”.
              ${(g.sem_tag && g.sem_tag.pct > 0) ? `Hoje ${pct(g.sem_tag.pct)} do gasto não tem etiqueta nenhuma.` : ''}</p>`}
      </article>`
    },

    mudarModoGasto(m) {
      this._modoGasto = m
      const alvo = document.getElementById('pj-gastos')
      if (alvo) alvo.innerHTML = this._gastos(this._d)
    },

    // ── Plano de quitação ────────────────────────────────────────────────────
    //
    // A simulação roda AQUI, no navegador, a cada tecla. É aritmética sobre uma
    // lista que já veio no payload — não há nada para perguntar ao servidor, e
    // fazer a viagem só para refazer a mesma conta obrigava o usuário a apertar
    // Enter e ainda tirava o cursor do campo. O campo agora nunca é
    // re-renderizado: só os três pedaços que dependem dele.
    _simular(dividas, ordem, extra) {
      const r2 = (v) => Math.round(v * 100) / 100
      const fila = (dividas || []).map(a => ({
        nome: a.nome, saldo: Number(a.saldo) || 0,
        parcela: Number(a.parcela) || 0, taxa: Number(a.taxa) || 0,
      }))
      fila.sort((a, b) => ordem === 'neve' ? a.saldo - b.saldo : (b.taxa - a.taxa) || (a.saldo - b.saldo))
      let mes = 0, juros = 0, pago = 0
      let rolo = Math.max(0, Number(extra) || 0)
      const quitacoes = []
      const TETO = 600
      while (fila.some(f => f.saldo > 0.01) && mes < TETO) {
        mes++
        let sobra = rolo
        for (const f of fila) {
          if (f.saldo <= 0.01) continue
          const j = r2(f.saldo * (f.taxa / 100))
          juros += j
          let pagamento = f.parcela
          if (sobra > 0) { pagamento += sobra; sobra = 0 }
          const devido = f.saldo + j
          const efetivo = Math.min(pagamento, devido)
          pago += efetivo
          f.saldo = r2(devido - efetivo)
          if (f.saldo <= 0.01) {
            f.saldo = 0
            quitacoes.push({ nome: f.nome, mes })
            rolo += f.parcela   // a parcela de quem terminou passa para o próximo
          }
        }
      }
      return {
        meses: mes, juros: r2(juros), total_pago: r2(pago), quitacoes,
        // Quem RECEBE o esforço extra — não quem termina primeiro, que costuma
        // ser outro por causa do rolo da parcela.
        alvo: fila.length ? fila[0].nome : null,
        estourou: mes >= TETO,
      }
    },

    _plano(d) {
      const p = d.plano_quitacao || {}
      if (!p.bola_de_neve) return ''
      const extra = Number(this._extra) || 0

      return `<article class="td-panel pj-sec">
        <div class="td-panel__head"><div><span class="td-eyebrow">Como sair</span>
          <h2>Plano de quitação</h2></div></div>

        <div class="pj-sim">
          <div>
            <span class="dg-kpi__lbl">Quanto consigo pagar a mais por mês</span>
            <div class="pj-sim__campo">
              <span>R$</span>
              <input id="pj-extra" type="number" min="0" step="50" inputmode="decimal"
                     value="${extra || ''}" placeholder="0"
                     oninput="VMTerminalProjecao.mudarExtra(this.value)">
            </div>
            <div class="pj-sim__toggle">
              <button type="button" id="pj-b-neve" class="pj-sim__b" onclick="VMTerminalProjecao.mudarEstrategia('neve')">Bola de neve</button>
              <button type="button" id="pj-b-aval" class="pj-sim__b" onclick="VMTerminalProjecao.mudarEstrategia('avalanche')">Avalanche</button>
            </div>
            <p class="pj-nota-txt" id="pj-plano-modo"></p>
          </div>
          <div class="pj-sim__res" id="pj-plano-res"></div>
        </div>

        <div id="pj-plano-nota"></div>

        <div class="ds-tablewrap">
          <table class="ds-table">
            <thead><tr><th>Dívida</th><th class="pj-tar">Saldo</th><th class="pj-tar">Juro a.m.</th>
              <th class="pj-tar">Parcela</th><th class="pj-tar">Quita em</th></tr></thead>
            <tbody id="pj-plano-tb"></tbody>
          </table>
        </div>
      </article>`
    },

    /**
     * Recalcula e reescreve SÓ o que depende do valor digitado. O <input> não
     * é tocado — é isso que preserva o cursor, a seleção e o que a pessoa está
     * no meio de digitar.
     */
    _planoLive() {
      const d = this._d
      if (!d) return
      const p = d.plano_quitacao || {}
      if (!p.bola_de_neve) return
      const alvoRes = document.getElementById('pj-plano-res')
      if (!alvoRes) return

      const est = this._estrategia || 'neve'
      const extra = Number(this._extra) || 0
      const lista = p.dividas || []

      const sim = this._simular(lista, est, extra)
      const outra = this._simular(lista, est === 'neve' ? 'avalanche' : 'neve', extra)
      const sem = this._simular(lista, est, 0)
      const neve = est === 'neve' ? sim : outra
      const aval = est === 'neve' ? outra : sim
      const concordam = !!(neve.alvo && neve.alvo === aval.alvo)

      const nunca = sim.estourou
      const prazo = nunca
        ? '<b class="is-bad">não fecha</b>'
        : `<b class="is-ok">${sim.meses} ${sim.meses === 1 ? 'mês' : 'meses'}</b>`
      const economia = sem.meses - sim.meses

      alvoRes.innerHTML = `
        <div><span>Livre da dívida de consumo</span>${prazo}</div>
        ${(!nunca && extra > 0 && economia > 0)
          ? `<div><span>Sem esses ${money(extra)}/mês</span><b>${sem.meses} meses <span class="pj-fraco">(${economia} a mais)</span></b></div>`
          : ''}
        ${sim.juros > 0 ? `<div><span>Juros até o fim</span><b>${money(sim.juros)}</b></div>` : ''}
        <div><span>Folga liberada quando acabar</span><b class="is-ok">${money(p.parcela_alvo)}/mês</b></div>`

      const modo = document.getElementById('pj-plano-modo')
      if (modo) modo.innerHTML = est === 'neve'
        ? 'Ataca o menor saldo primeiro: a primeira vitória vem rápido.'
        : 'Ataca o maior juro primeiro: paga menos juro no total.'

      const bn = document.getElementById('pj-b-neve'), ba = document.getElementById('pj-b-aval')
      if (bn) bn.classList.toggle('is-on', est === 'neve')
      if (ba) ba.classList.toggle('is-on', est === 'avalanche')

      const nota = document.getElementById('pj-plano-nota')
      if (nota) {
        nota.innerHTML = nunca
          ? `<div class="ds-note ds-note--warn pj-nota">
              <i class="fas fa-triangle-exclamation ds-note__ico"></i>
              <div><b>Nesse ritmo a dívida não fecha.</b> O juro do mês come a parcela antes de o
                saldo cair. É o caso em que qualquer valor a mais aqui em cima muda o desfecho —
                experimente.</div>
            </div>`
          : concordam
          ? `<div class="ds-note ds-note--ok pj-nota">
              <i class="fas fa-circle-check ds-note__ico"></i>
              <div><b>As duas estratégias apontam para o mesmo lugar.</b> ${esc(neve.alvo || '')} é ao
                mesmo tempo o menor saldo e o maior juro — atacar essa dívida primeiro não tem
                contrapartida.</div>
            </div>`
          : `<div class="ds-note ds-note--info pj-nota">
              <i class="fas fa-circle-info ds-note__ico"></i>
              <div>A bola de neve ataca <b>${esc(neve.alvo || '—')}</b>; a avalanche,
                <b>${esc(aval.alvo || '—')}</b>. A diferença de juros entre os dois caminhos é
                ${money(Math.abs(neve.juros - aval.juros))}.</div>
            </div>`
      }

      const tb = document.getElementById('pj-plano-tb')
      if (tb) {
        const divs = lista.slice().sort((a, b) => est === 'neve'
          ? a.saldo - b.saldo : (b.taxa - a.taxa) || (a.saldo - b.saldo))
        tb.innerHTML = divs.map((x, i) => {
          const q = (sim.quitacoes || []).find(k => k.nome === x.nome)
          return `<tr>
            <td><span class="pj-ordem">${i + 1}</span>${esc(x.nome)}</td>
            <td class="pj-tar">${money(x.saldo)}</td>
            <td class="pj-tar">${pct(x.taxa, 2)}</td>
            <td class="pj-tar">${money(x.parcela)}</td>
            <td class="pj-tar">${q ? `mês ${q.mes}` : '—'}</td>
          </tr>`
        }).join('')
      }
    },

    mudarEstrategia(e) { this._estrategia = e; this._planoLive() },

    /** A cada tecla. Sem ida ao servidor, sem repintar a tela, sem perder o cursor. */
    mudarExtra(v) {
      const n = Math.max(0, parseFloat(v) || 0)
      this._extra = n
      this._planoLive()
    },

    // ── 4 · Para onde isso vai ───────────────────────────────────────────────
    _futuro(d) {
      const proj = d.projecoes || []
      const resumo = d.resumo || {}
      const cd = d.confianca_detalhe || {}
      const conf = Number(d.confianca) || 0
      const nivel = cd.nivel || (conf >= 70 ? 'alta' : conf >= 40 ? 'média' : 'baixa')
      const ultimo = proj[proj.length - 1]?.label || ''
      const cal = d.calendario || []
      const tc = d.teste_de_caber

      return `<article class="td-panel pj-sec">
        <div class="td-panel__head"><div>
          <span class="td-eyebrow"><span class="pj-bloco__n">4</span>O ritmo que você já tem</span>
          <h2>Para onde isso vai</h2></div>
          <button type="button" class="ds-btn ds-btn--sm" onclick="VMTerminalProjecao.explicarConfianca()">
            confiança ${conf}% · ${esc(nivel)}</button>
        </div>
        <p class="pj-nota-txt">A linha começa do zero: mede o que entra menos o que sai a partir de hoje,
          não o saldo da sua conta.</p>

        <div class="pj-chart">${this._chart(proj, d.cenarios)}</div>

        <div class="pj-cenarios">
          ${this._cenario('Se tudo melhorar', resumo.cenario_otimista_12m, 'ok',
            'Receitas 10% maiores e despesas 5% menores que a sua média. É o teto realista.')}
          ${this._cenario('Se nada mudar', resumo.projecao_12m, 'base',
            `Você mantém o padrão dos últimos meses até ${porExtenso(ultimo)}. É o que a linha desenha.`)}
          ${this._cenario('Se apertar', resumo.cenario_pessimista_12m, 'neg',
            'Receitas 10% menores e despesas 10% maiores. Responde uma pergunta só: eu aguento?')}
        </div>

        ${cal.length ? `
        <h3 class="pj-h3">O que vem pela frente</h3>
        <div class="pj-cal">
          ${cal.map(ev => `<div class="pj-ev">
            <span class="pj-ev__mes">${esc(ev.quando)}</span>
            <span class="pj-ev__dot is-${ev.tipo}"></span>
            <span class="pj-ev__txt"><b>${esc(ev.titulo)}</b><small>${esc(ev.detalhe)}</small></span>
            <span class="pj-ev__val ${Number(ev.valor) >= 0 ? 'is-ok' : 'is-neg'}">${Number(ev.valor) >= 0 ? '+' : '−'}${money(Math.abs(Number(ev.valor)))}</span>
          </div>`).join('')}
        </div>` : ''}

        ${tc ? `<div class="ds-note ds-note--${tc.cabe ? 'ok' : 'warn'} pj-nota">
          <i class="fas fa-${tc.cabe ? 'circle-check' : 'triangle-exclamation'} ds-note__ico"></i>
          <div><b>A prestação que vem cabe${tc.cabe ? '' : '?'}</b>
            Em ${this._data(tc.comeca_em)} entram ${money(tc.prestacao_futura)} por mês.
            A dívida de consumo acaba em ${tc.meses_ate_liberar} ${tc.meses_ate_liberar === 1 ? 'mês' : 'meses'},
            liberando ${money(tc.folga_liberada)} — ${tc.cabe
              ? '<b>cabe com folga, desde que ela não seja reocupada por parcelamento novo.</b>'
              : '<b>não cobre sozinha: a diferença precisa sair de outro lugar.</b>'}</div>
        </div>` : ''}
      </article>`
    },

    // ── auxiliares ───────────────────────────────────────────────────────────
    _data(iso) {
      if (!iso) return '—'
      const [a, m] = String(iso).slice(0, 10).split('-')
      const nomes = ['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro']
      return `${nomes[Number(m) - 1] || m} de ${a}`
    },

    _kpi(lbl, val, tone, hint) {
      return `<div class="dg-kpi">
        <span class="dg-kpi__lbl">${esc(lbl)}</span>
        <span class="dg-kpi__val dg-kpi__val--${tone || 'neutral'}">${val}</span>
        ${hint ? `<span class="pj-kpi__hint">${esc(hint)}</span>` : ''}
      </div>`
    },

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
     * Linha do cenário base com a banda entre otimista e pessimista. O viewBox
     * tem a proporção do desenho e o SVG escala junto — com preserveAspectRatio
     * "none" o traço saía com espessura desigual e a curva achatada.
     */
    _chart(proj, cenarios) {
      if (!proj.length) return '<div class="td-empty-row"><i class="fas fa-chart-line"></i><span>Sem dados para projetar.</span></div>'
      const W = 560, H = 230, pL = 64, pR = 10, pT = 14, pB = 26
      const pw = W - pL - pR, ph = H - pT - pB
      const base = proj.map(p => Number(p.valor) || 0)
      const otim = (cenarios?.otimista || []).map(p => Number(p.valor) || 0)
      const pess = (cenarios?.pessimista || []).map(p => Number(p.valor) || 0)
      let min = Math.min(...base.concat(otim, pess), 0), max = Math.max(...base.concat(otim, pess), 0)
      const folga = ((max - min) || 1) * 0.08
      min -= folga; max += folga
      const span = (max - min) || 1
      const x = (i, n) => pL + (n <= 1 ? pw / 2 : (i / (n - 1)) * pw)
      const y = (v) => pT + ph * (1 - (v - min) / span)
      const line = (arr) => arr.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i, arr.length).toFixed(1)},${y(v).toFixed(1)}`).join(' ')

      let marcas = [min, min + span / 3, min + 2 * span / 3, max]
      if (min < 0 && max > 0) {
        marcas = marcas.filter(v => Math.abs(v) > span * 0.12)
        marcas.push(0)
      }
      const temBanda = otim.length === base.length && pess.length === base.length && base.length > 1
      const banda = temBanda
        ? `<polygon points="${otim.map((v, i) => `${x(i, otim.length).toFixed(1)},${y(v).toFixed(1)}`).join(' ')} ${pess.map((v, i) => `${x(i, pess.length).toFixed(1)},${y(v).toFixed(1)}`).reverse().join(' ')}" fill="var(--terminal-primary)" opacity=".1"/>`
        : ''

      return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;display:block" role="img" aria-label="Projeção de saldo acumulado mês a mês">
        ${marcas.map(v => `
          <line x1="${pL}" y1="${y(v).toFixed(1)}" x2="${W - pR}" y2="${y(v).toFixed(1)}"
                stroke="${v === 0 ? 'var(--terminal-ink-soft)' : 'var(--terminal-line)'}"
                stroke-width="1" ${v === 0 ? 'stroke-dasharray="4 4" opacity=".6"' : ''}/>
          <text x="${pL - 6}" y="${(y(v) + 3.5).toFixed(1)}" text-anchor="end" font-size="9"
                fill="var(--terminal-ink-soft)" font-family="var(--terminal-mono)">${v === 0 ? 'R$ 0' : moneyK(v)}</text>`).join('')}
        ${banda}
        <path d="${line(base)}" fill="none" stroke="var(--terminal-primary)" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
        ${base.map((v, i) => `<circle cx="${x(i, base.length).toFixed(1)}" cy="${y(v).toFixed(1)}" r="${i === base.length - 1 ? 4.5 : 2.5}" fill="${i === base.length - 1 ? 'var(--terminal-primary)' : 'var(--terminal-bg)'}" stroke="var(--terminal-primary)" stroke-width="1.5"><title>${esc(proj[i]?.label || '')}: ${money(v)}</title></circle>`).join('')}
      </svg>
      <div class="pj-chart__axis"><span>${esc(proj[0]?.label || '')}</span><span>${esc(proj[proj.length - 1]?.label || '')}</span></div>
      ${temBanda ? `<div class="pj-chart__leg"><i></i> A faixa clara é o intervalo entre o cenário otimista e o pessimista.</div>` : ''}`
    },

    /** Bloco "como ler" — fica, não some depois do primeiro acesso. */
    _comoLer(d) {
      let escondido = false
      try { escondido = localStorage.getItem('vm_pj_comoler') === 'off' } catch (e) {}
      if (escondido) {
        return `<p class="pj-glosslink"><button type="button" class="ds-btn ds-btn--ghost ds-btn--sm" onclick="VMTerminalProjecao.abrirComoLer()"><i class="fas fa-book-open"></i> Como ler esta tela</button></p>`
      }
      return `<article class="td-panel pj-sec pj-comoler">
        <div class="td-panel__head">
          <div><span class="td-eyebrow">Primeira vez por aqui?</span><h2>Como ler esta tela</h2></div>
          <button class="ds-btn ds-btn--ghost ds-btn--sm" onclick="VMTerminalProjecao.fecharComoLer()">Entendi, pode esconder</button>
        </div>
        <div class="pj-comoler__grid">
          <div class="pj-comoler__item"><strong>Os três primeiros blocos são uma foto</strong>
            <p>Tudo o que você tem, tudo o que deve e quanto entra por mês. Nada é digitado: cada número
              vem de uma tela do VerdeMais e diz qual.</p></div>
          <div class="pj-comoler__item"><strong>O que já é certo e o que é estimativa</strong>
            <p>Parcelas e contas fixas entram pelo valor exato de cada mês. Mercado, lazer e imprevisto
              entram pela sua média — e é só essa parte que responde a uma decisão sua.</p></div>
          <div class="pj-comoler__item"><strong>Dívida e prestação são coisas diferentes</strong>
            <p>O saldo do cartão é dívida e conta no balanço. O comprometimento da renda só olha o que
              sai por mês — misturar os dois infla o número até ele perder o sentido.</p></div>
          <div class="pj-comoler__item"><strong>O último bloco é o filme</strong>
            <p>Seu ritmo levado para frente: quando aperta, quando alivia, e o que muda se você mudar
              alguma coisa.</p></div>
        </div>
      </article>`
    },
    fecharComoLer() { try { localStorage.setItem('vm_pj_comoler', 'off') } catch (e) {} this._paint() },
    abrirComoLer() { try { localStorage.removeItem('vm_pj_comoler') } catch (e) {} this._paint() },

    /** A conta da confiança, linha a linha. */
    explicarConfianca() {
      const d = this._d || {}
      const cd = d.confianca_detalhe || {}
      const linhas = []
      linhas.push(['Meses usados no cálculo', `${cd.meses_usados || 0} de até ${cd.janela_maxima || 12}`])
      if ((cd.meses_labels || []).length) linhas.push(['Quais', cd.meses_labels.join(', ')])
      if (cd.mes_corrente_ignorado) linhas.push(['Mês em curso (fora)', `${cd.mes_corrente_ignorado} — ainda não terminou`])
      ;(cd.meses_atipicos || []).forEach(m => linhas.push(['Mês atípico (fora)', `${m.label} — ${m.motivo}`]))
      linhas.push(['Sua renda média', money(cd.receita_referencia)])
      linhas.push(['Quanto o resultado oscila', `${money(cd.oscilacao_mensal)} por mês, para mais ou para menos`])
      linhas.push(['Isso equivale a', `${(Number(cd.oscilacao_pct_renda) || 0).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}% da sua renda`])
      linhas.push(['Nota por histórico', `${cd.fator_amostra || 0}%`])
      linhas.push(['Nota por regularidade', `${cd.fator_estabilidade || 0}%`])
      linhas.push(['Confiança final', `${d.confianca || 0}% (as duas notas multiplicadas)`])

      const corpo = `
        <p class="pj-modal__intro">${esc(d.explicacoes?.confianca || '')}</p>
        <table class="ds-table pj-modal__tab"><tbody>
          ${linhas.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join('')}
        </tbody></table>
        <p class="pj-modal__rodape">Confiança <strong>não</strong> é a chance de o número acontecer. É o
          quanto os seus meses se parecem entre si — ou seja, o quanto vale a pena levar a projeção a
          sério na hora de decidir.</p>`

      if (window.VM?.vmInfo) return void window.VM.vmInfo(corpo, { titulo: 'De onde vem a confiança', icone: '🎯' })
      alert(String(d.explicacoes?.confianca || '').replace(/<[^>]+>/g, ''))
    },

    _upsell(d) {
      return `<section class="td-onboarding"><div class="td-onboarding__copy">
        <span class="td-eyebrow">Recurso Premium</span>
        <h2>Veja seu retrato financeiro.</h2>
        <p>${esc(d.error || 'O balanço, o endividamento, o plano de quitação e a projeção fazem parte dos planos pagos.')}</p>
        <div class="td-onboarding__actions"><button class="ds-btn ds-btn--primary" onclick="VM.navigate('planos')"><i class="fas fa-arrow-up"></i> Ver planos</button></div>
      </div></section>`
    },

    _shell(inner) {
      return `<div class="td-dashboard pj">
        <header class="td-dashboard__header">
          <div>
            <span class="td-eyebrow">Onde você está e para onde vai</span>
            <h1>Projeção. <em>O retrato e a direção.</em></h1>
            <p>Tudo abaixo sai do que você já lançou — nenhum campo para preencher.</p>
          </div>
        </header>
        ${inner}
      </div>`
    }
  }
})()
