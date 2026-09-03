/**
 * VerdeMais — Reserva de emergência
 * ============================================================================
 * Reserva não é uma meta como as outras: o número que importa não é quanto
 * tem guardado, é por quantos meses isso sustenta a vida se a renda parar
 * hoje. E a diferença entre 1 mês e 3 meses não é gradual — é a diferença
 * entre "resolvo um imprevisto" e "sobrevivo a uma demissão".
 *
 * Por isso a tela abre com a escada: os degraus de segurança (1, 3, 6, 12
 * meses), qual você já subiu e quanto falta para o próximo.
 */
(function () {
  const esc = (v) => String(v ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;')
  const money = (v) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 2 }).format(Number(v) || 0)
  const dataBR = (d) => {
    const t = String(d || '').slice(0, 10)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return '—'
    const dt = new Date(t + 'T12:00:00')
    return Number.isNaN(dt.getTime()) ? '—' : dt.toLocaleDateString('pt-BR')
  }

  // Os degraus: cada um resolve uma classe diferente de problema.
  const DEGRAUS = [
    { m: 1,  rot: 'Um mês',     desc: 'Cobre um imprevisto isolado — pneu, dentista, conserto.' },
    { m: 3,  rot: 'Três meses', desc: 'Absorve uma demissão sem virar dívida no cartão.' },
    { m: 6,  rot: 'Seis meses', desc: 'O padrão recomendado para renda estável (CLT).' },
    { m: 12, rot: 'Doze meses', desc: 'Para renda variável, autônomo ou fonte única.' },
  ]

  window.VMTerminalReserva = {
    async render(vm) {
      this._vm = vm
      const content = document.getElementById('page-content')
      if (!content) return
      document.body.classList.add('terminal-dashboard-active')
      content.innerHTML = '<div class="td-loading"><span></span><span></span><span></span></div>'
      try {
        const [data, hist, prog] = await Promise.all([
          vm.api('GET', 'reserva'),
          vm.api('GET', 'reserva/historico').catch(() => ({ historico: [] })),
          // 404 quando ainda não existe reserva — é resposta esperada, não erro.
          vm.api('GET', 'reserva/progresso').catch(() => null),
        ])
        this._data = data
        this._hist = hist.historico || []
        this._prog = prog
        this._paint()
      } catch (e) {
        content.innerHTML = `<div class="td-error"><i class="fas fa-triangle-exclamation"></i><h2>Não foi possível carregar a Reserva</h2><p>${esc(e.response?.data?.error || 'Tente novamente.')}</p><button class="ds-btn ds-btn--primary" onclick="VM.pageReserva()">Tentar novamente</button></div>`
      }
    },
    reload() { this.render(this._vm) },

    _paint() {
      const content = document.getElementById('page-content')
      if (!content) return
      const d = this._data
      const r = d.reserva
      if (!r) return void (content.innerHTML = this._shell(this._empty()))

      const readonly = !!r.somente_leitura
      const meses = Number(d.meses_cobertos) || 0
      const obj = Number(r.objetivo_meses) || 6
      const media = Number(d.media_gastos_mensais) || 0

      content.innerHTML = this._shell(`
        ${readonly ? `<div class="td-notice"><i class="fas fa-circle-info"></i><div><strong>Esta reserva é gerida em "Minhas Reservas".</strong><span>Aqui você acompanha; para depositar ou sacar, abra a tela de Minhas Reservas.</span></div></div>` : ''}
        ${this._hero(d, r, meses, obj, media)}
        ${this._escada(meses, media)}
        ${this._kpis(d, r, media)}
        ${this._notas(d, r, meses, obj, media)}
        <div class="re-cols">
          ${this._projecao()}
          ${this._extrato()}
        </div>
      `, readonly, r, obj)
    },

    // ── quantos meses você aguenta ───────────────────────────────────────────
    _hero(d, r, meses, obj, media) {
      const cobertura = Number(d.cobertura_pct) || 0
      const solida = meses >= obj
      const cor = meses >= 6 ? 'var(--terminal-primary)' : meses >= 3 ? 'var(--terminal-accent)' : 'var(--terminal-negative)'
      const veredito = meses >= 12 ? 'Blindado contra imprevistos'
        : meses >= 6 ? 'Reserva sólida'
        : meses >= 3 ? 'Já aguenta um susto'
        : meses >= 1 ? 'Começou, mas ainda é fino'
        : 'Sem colchão nenhum'

      return `<section class="re-hero ${solida ? 're-hero--ok' : ''}">
        <div class="re-hero__main">
          <span class="td-eyebrow">Se a renda parar hoje, você aguenta</span>
          <div class="re-hero__months" style="color:${cor}">${meses.toFixed(1)} <em>${meses === 1 ? 'mês' : 'meses'}</em></div>
          <p><strong>${veredito}.</strong> ${media > 0
            ? `A conta usa ${money(media)} por mês — a média dos seus gastos essenciais nos últimos três meses.`
            : 'Registre seus gastos para o app calcular quantos meses sua reserva cobre.'}</p>
        </div>
        <div class="re-hero__gauge">
          <div class="ds-bar ds-bar--lg"><span style="width:${Math.min(100, cobertura)}%;background:${cor}"></span></div>
          <div class="re-hero__nums"><span>${money(r.valor_atual)}</span><span>meta ${money(d.valor_ideal)}</span></div>
          <div class="re-hero__pill">
            <span class="ds-pill ${solida ? 'ds-pill--ok' : 'ds-pill--warn'}">${cobertura.toFixed(0)}% do objetivo de ${obj} meses</span>
            ${Number(d.faltando) > 0 ? `<small>faltam ${money(d.faltando)}</small>` : '<small>objetivo atingido 🎉</small>'}
          </div>
        </div>
      </section>`
    },

    _escada(meses, media) {
      const proximo = DEGRAUS.find(g => meses < g.m)
      // O que falta sai do saldo em reais, não de meses_cobertos: aquele já
      // vem arredondado e a diferença aparecia como alguns reais a menos.
      const saldo = Number(this._data?.reserva?.valor_atual) || 0
      return `<article class="td-panel re-escada">
        <div class="td-panel__head">
          <div><span class="td-eyebrow">A escada da segurança</span><h2>Cada degrau resolve um problema diferente</h2></div>
          ${proximo && media > 0 ? `<span class="ds-pill ds-pill--info">faltam ${money(Math.max(0, proximo.m * media - saldo))} para ${proximo.m} ${proximo.m === 1 ? 'mês' : 'meses'}</span>` : ''}
        </div>
        <div class="re-degraus">
          ${DEGRAUS.map((g, i) => {
            const atingido = meses >= g.m
            const atual = !atingido && (i === 0 || meses >= DEGRAUS[i - 1].m)
            // Progresso dentro do degrau, para o degrau em andamento não ficar vazio.
            const base = i === 0 ? 0 : DEGRAUS[i - 1].m
            const pct = atingido ? 100 : Math.max(0, Math.min(100, ((meses - base) / (g.m - base)) * 100))
            return `<div class="re-degrau ${atingido ? 'is-ok' : atual ? 'is-now' : ''}">
              <div class="re-degrau__top">
                <span class="re-degrau__mes">${g.m}<em>${g.m === 1 ? ' mês' : ' meses'}</em></span>
                ${atingido ? '<i class="fas fa-check re-degrau__ok"></i>' : atual ? '<span class="re-degrau__tag">você está aqui</span>' : ''}
              </div>
              <div class="ds-bar"><span style="width:${pct}%" class="${atingido ? '' : 'is-warn'}"></span></div>
              <strong>${g.rot}</strong>
              <small>${g.desc}</small>
              ${media > 0 ? `<b>${money(g.m * media)}</b>` : ''}
            </div>`
          }).join('')}
        </div>
      </article>`
    },

    _kpis(d, r, media) {
      const p = this._prog?.projecao || {}
      const aporte = Number(p.aporte_medio_mensal) || 0
      return `<div class="ds-kpi-grid" style="margin:16px 0">
        <article class="ds-kpi">
          <span class="ds-kpi__lbl">Guardado</span>
          <b class="ds-kpi__val ds-kpi__val--ok">${money(r.valor_atual)}</b>
          <span class="ds-kpi__hint">${r.banco ? esc(r.banco) : 'sua reserva de emergência'}</span>
        </article>
        <article class="ds-kpi">
          <span class="ds-kpi__lbl">Falta para a meta</span>
          <b class="ds-kpi__val ${Number(d.faltando) > 0 ? 'ds-kpi__val--warn' : 'ds-kpi__val--ok'}">${money(d.faltando)}</b>
          <span class="ds-kpi__hint">meta de ${money(d.valor_ideal)}</span>
        </article>
        <article class="ds-kpi">
          <span class="ds-kpi__lbl">Gasto essencial mensal</span>
          <b class="ds-kpi__val">${money(media)}</b>
          <span class="ds-kpi__hint">média dos últimos 3 meses</span>
        </article>
        <article class="ds-kpi">
          <span class="ds-kpi__lbl">Seu aporte médio</span>
          <b class="ds-kpi__val">${aporte > 0 ? money(aporte) : '—'}</b>
          <span class="ds-kpi__hint">${aporte > 0 ? 'por mês, pelo seu histórico' : 'sem depósitos registrados ainda'}</span>
        </article>
      </div>`
    },

    _notas(d, r, meses, obj, media) {
      const notas = []
      const p = this._prog?.projecao || {}
      const falta = Number(d.faltando) || 0
      const aporte = Number(p.aporte_medio_mensal) || 0

      if (media <= 0) {
        notas.push({ t: 'info', ico: 'fa-circle-info', txt: '<strong>Ainda não dá para dizer quantos meses sua reserva cobre.</strong> O cálculo usa a média dos seus gastos essenciais — registre as despesas do mês e este número aparece sozinho.' })
      } else if (meses < 1) {
        notas.push({ t: 'neg', ico: 'fa-triangle-exclamation', txt: `<strong>Sua reserva não cobre um mês de gastos.</strong> Hoje, qualquer imprevisto acima de ${money(r.valor_atual)} vira cartão ou empréstimo. O primeiro degrau — ${money(media)} — é o que mais muda sua vida financeira.` })
      } else if (meses < 3) {
        notas.push({ t: 'warn', ico: 'fa-shield-halved', txt: `<strong>Você cobre ${meses.toFixed(1)} meses.</strong> Dá para absorver um susto, mas não uma perda de renda. Os três meses — ${money(3 * media)} — são o degrau que tira o pânico de uma demissão.` })
      } else if (meses >= obj) {
        notas.push({ t: 'ok', ico: 'fa-shield-halved', txt: `<strong>Objetivo de ${obj} meses batido.</strong> Daqui em diante, dinheiro parado rende pouco: vale direcionar novos aportes para investimentos e manter a reserva onde tem liquidez diária.` })
      }
      if (falta > 0 && aporte > 0 && p.meses_para_atingir) {
        notas.push({ t: 'info', ico: 'fa-calendar-check', txt: `<strong>No seu ritmo de ${money(aporte)} por mês, você fecha a meta em ${p.meses_para_atingir} ${p.meses_para_atingir === 1 ? 'mês' : 'meses'}</strong> — por volta de ${dataBR(p.data_estimada_conclusao)}. Dobrar o aporte cortaria esse prazo pela metade.` })
      } else if (falta > 0 && aporte <= 0) {
        notas.push({ t: 'warn', ico: 'fa-hourglass-half', txt: `<strong>Sem depósitos registrados, não há ritmo para projetar.</strong> Guardando ${money(falta / 12)} por mês, a meta fecha em um ano.` })
      }
      const saques = (this._hist || []).filter(h => h.tipo === 'saque' || h.type === 'withdrawal')
      if (saques.length >= 2) {
        notas.push({ t: 'warn', ico: 'fa-arrow-trend-down', txt: `<strong>${saques.length} saques da reserva no histórico.</strong> Reserva que é sacada com frequência normalmente está cobrindo um orçamento apertado, não emergências — vale olhar o 50/30/20 antes de repor.` })
      }
      if (!notas.length) return ''
      return `<section class="tp-notes">${notas.slice(0, 3).map(n =>
        `<div class="ds-note ds-note--${n.t}"><i class="fas ${n.ico} ds-note__ico"></i><div>${n.txt}</div></div>`).join('')}</section>`
    },

    _projecao() {
      const p = this._prog?.projecao
      const m = this._prog?.meta
      if (!p || !m) return ''
      const atingida = !!m.atingida
      return `<article class="td-panel">
        <div class="td-panel__head"><div><span class="td-eyebrow">Projeção</span><h2>Quando você chega lá</h2></div></div>
        ${atingida
          ? `<div class="ds-note ds-note--ok" style="margin:0"><i class="fas fa-flag-checkered ds-note__ico"></i><div><strong>Meta atingida.</strong> Sua reserva já cobre o objetivo — o próximo passo é fazer o excedente render sem perder liquidez.</div></div>`
          : `<div class="re-proj">
              <div><small>Aporte médio</small><b>${p.aporte_medio_mensal > 0 ? money(p.aporte_medio_mensal) : '—'}</b></div>
              <div><small>Meses para a meta</small><b>${p.meses_para_atingir ?? '—'}</b></div>
              <div><small>Data estimada</small><b>${p.data_estimada_conclusao ? dataBR(p.data_estimada_conclusao) : '—'}</b></div>
              <div><small>Depósitos feitos</small><b>${p.total_depositos ?? 0}</b></div>
            </div>
            <div class="re-proj__bar">
              <div class="ds-bar"><span style="width:${Math.min(100, Number(m.cobertura_pct) || 0)}%"></span></div>
              <div class="re-proj__ends"><small>hoje · ${money(this._data?.reserva?.valor_atual)}</small><small>meta · ${money(m.valor_ideal)}</small></div>
            </div>
            ${this._eSe(p, m)}`}
      </article>`
    },

    /**
     * O número que muda comportamento não é "faltam 10 meses" — é ver que
     * 300 reais a mais por mês antecipam a meta em quase meio ano.
     */
    _eSe(p, m) {
      const aporte = Number(p.aporte_medio_mensal) || 0
      const falta = Number(m.faltando) || 0
      if (!(aporte > 0) || !(falta > 0)) return ''
      const base = Math.ceil(falta / aporte)
      const cenarios = [1.5, 2].map(k => {
        const novo = Math.ceil(falta / (aporte * k))
        return { extra: aporte * (k - 1), meses: novo, ganho: base - novo }
      }).filter(c => c.ganho > 0)
      if (!cenarios.length) return ''
      return `<div class="re-ese">
        <span class="td-eyebrow">E se você guardasse mais</span>
        ${cenarios.map(c => `<div class="re-ese__row">
          <span>+${money(c.extra)} por mês</span>
          <b>${c.meses} ${c.meses === 1 ? 'mês' : 'meses'}</b>
          <em>${c.ganho} ${c.ganho === 1 ? 'mês' : 'meses'} antes</em>
        </div>`).join('')}
      </div>`
    },

    _extrato() {
      const h = this._hist || []
      return `<article class="td-panel" style="padding-bottom:0">
        <div class="td-panel__head"><div><span class="td-eyebrow">Extrato</span><h2>Movimentações</h2></div></div>
        ${h.length ? `<div class="ds-tablewrap"><table class="ds-table">
          <thead><tr><th>Data</th><th>Movimento</th><th class="ds-num">Valor</th></tr></thead>
          <tbody>${h.map(x => this._row(x)).join('')}</tbody>
        </table></div>` : '<div class="ds-empty"><i class="fas fa-receipt"></i><p>Nenhuma movimentação ainda. O primeiro depósito aparece aqui.</p></div>'}
      </article>`
    },

    _row(h) {
      const saque = h.tipo === 'saque' || h.type === 'withdrawal'
      const valor = Number(h.valor ?? h.amount ?? 0)
      const desc = h.descricao || h.description || h.note || (saque ? 'Saque' : 'Depósito')
      return `<tr>
        <td style="white-space:nowrap">${dataBR(h.data || h.date)}</td>
        <td><strong>${esc(desc)}</strong><br><small style="color:var(--terminal-ink-soft)">${saque ? 'saída' : 'entrada'}</small></td>
        <td class="ds-num" style="color:${saque ? 'var(--terminal-negative)' : 'var(--terminal-primary)'}">${saque ? '−' : '+'} ${money(Math.abs(valor))}</td>
      </tr>`
    },

    _shell(inner, readonly, r, obj) {
      const acoes = r
        ? (readonly
          ? `<button class="ds-btn ds-btn--primary" onclick="VM.navigate('reservas-esp')"><i class="fas fa-arrow-right"></i> Gerenciar em Minhas Reservas</button>`
          : `<button class="ds-btn ds-btn--primary" onclick="VMTerminalReserva.depositar(${Number(r.id)})"><i class="fas fa-plus"></i> Depositar</button>
             <button class="ds-btn" onclick="VMTerminalReserva.sacar(${Number(r.id)}, ${Number(r.valor_atual)})"><i class="fas fa-arrow-down"></i> Sacar</button>
             <button class="ds-btn" onclick="VMTerminalReserva.editarMeta(${Number(r.id)}, ${Number(obj) || 6})"><i class="fas fa-bullseye"></i> Objetivo</button>`)
        : ''
      return `<div class="td-dashboard re">
        <header class="td-dashboard__header">
          <div>
            <span class="td-eyebrow">Seu colchão de segurança</span>
            <h1>Reserva de emergência. <em>Durma tranquilo.</em></h1>
            <p>Não é quanto você tem guardado — é por quantos meses isso sustenta sua vida se a renda parar hoje.</p>
          </div>
          ${acoes ? `<div class="td-dashboard__header-actions">${acoes}</div>` : ''}
        </header>
        ${inner}
      </div>`
    },

    _empty() {
      return `<section class="td-onboarding tm-empty"><div class="td-onboarding__copy">
        <span class="td-eyebrow">A base de tudo</span>
        <h2>Comece sua reserva de emergência.</h2>
        <p>Antes de investir, antes de qualquer meta: de 3 a 6 meses das suas despesas essenciais guardados com liquidez diária. É o que separa um imprevisto de uma dívida.</p>
        <div class="td-onboarding__actions"><button class="ds-btn ds-btn--primary" onclick="VMTerminalReserva.criar()"><i class="fas fa-plus"></i> Criar minha reserva</button></div>
      </div></section>`
    },

    // ── ações ────────────────────────────────────────────────────────────────
    _st() { return 'width:100%;background:var(--terminal-bg);border:1px solid var(--terminal-line);color:var(--terminal-ink);border-radius:var(--terminal-radius-sm);padding:10px 12px;font-size:13px;font-family:var(--terminal-font)' },
    _lab(t) { return `<label style="display:block;font:700 10px/1 var(--terminal-mono);letter-spacing:.1em;text-transform:uppercase;color:var(--terminal-ink-soft);margin-bottom:6px">${t}</label>` },

    criar() {
      const vm = this._vm, s = this._st()
      const media = Number(this._data?.media_gastos_mensais) || 0
      vm.showModal(`<div style="font-family:var(--terminal-font);color:var(--terminal-ink)">
        <div style="font-size:16px;font-weight:640">Criar reserva de emergência</div>
        <div style="color:var(--terminal-ink-soft);font-size:12px;margin:4px 0 18px">${media > 0
          ? `Seus gastos essenciais são de ${money(media)}/mês — seis meses seriam ${money(media * 6)}.`
          : 'Defina o objetivo em meses e o valor que já tem guardado.'}</div>
        <div style="display:flex;flex-direction:column;gap:14px">
          <div style="display:flex;gap:10px">
            <div style="flex:1">${this._lab('Objetivo (meses)')}<input id="re-obj" type="number" min="1" max="36" style="${s}" value="6"></div>
            <div style="flex:1">${this._lab('Valor atual (R$)')}<input id="re-val" type="number" min="0" step="0.01" style="${s}" value="0"></div>
          </div>
          <div>${this._lab('Banco (opcional)')}<input id="re-banco" style="${s}" placeholder="Ex.: Nubank"></div>
          <div style="display:flex;gap:8px;margin-top:6px"><button class="ds-btn ds-btn--primary" style="flex:1" onclick="VMTerminalReserva.salvarCriar()"><i class="fas fa-check"></i> Criar</button><button class="ds-btn" onclick="VM.closeModal()">Cancelar</button></div>
        </div></div>`)
    },
    async salvarCriar() {
      const vm = this._vm
      const objetivo_meses = parseInt(document.getElementById('re-obj')?.value) || 6
      const valor_atual = parseFloat(document.getElementById('re-val')?.value) || 0
      const banco = document.getElementById('re-banco')?.value?.trim() || null
      const r = await vm.api('POST', 'reserva', { objetivo_meses, valor_atual, banco }).catch(e => ({ error: e.response?.data?.error }))
      if (r?.success) { vm.closeModal(); vm.toast('Reserva criada.', 'success'); this.reload() }
      else vm.toast(r?.error || 'Erro ao criar.', 'error')
    },

    /** Um prompt do navegador não mostra saldo, nem sugestão, nem erro no lugar certo. */
    _modalValor({ titulo, dica, rotulo, sugestoes, acao }) {
      const s = this._st()
      this._acao = acao
      this._vm.showModal(`<div style="font-family:var(--terminal-font);color:var(--terminal-ink)">
        <div style="font-size:16px;font-weight:640">${titulo}</div>
        <div style="color:var(--terminal-ink-soft);font-size:12px;margin:4px 0 18px">${dica}</div>
        <div>${this._lab(rotulo)}<input id="re-mov" type="number" min="0.01" step="0.01" style="${s}" autofocus></div>
        ${sugestoes?.length ? `<div class="re-sug">${sugestoes.map(v =>
          `<button class="ds-btn ds-btn--sm" onclick="document.getElementById('re-mov').value=${v.valor}">${v.rot}</button>`).join('')}</div>` : ''}
        <div style="display:flex;gap:8px;margin-top:16px">
          <button class="ds-btn ds-btn--primary" style="flex:1" onclick="VMTerminalReserva._confirmarValor()"><i class="fas fa-check"></i> Confirmar</button>
          <button class="ds-btn" onclick="VM.closeModal()">Cancelar</button>
        </div></div>`)
      setTimeout(() => document.getElementById('re-mov')?.focus(), 40)
    },
    async _confirmarValor() {
      const vm = this._vm
      const valor = parseFloat(document.getElementById('re-mov')?.value)
      if (!(valor > 0)) return vm.toast('Informe um valor maior que zero.', 'error')
      const r = await this._acao(valor).catch(e => ({ error: e.response?.data?.error }))
      if (r?.success) { vm.closeModal(); vm.toast(r.message || 'Movimentação registrada.', 'success'); this.reload() }
      else vm.toast(r?.error || 'Não foi possível registrar.', 'error')
    },

    depositar(id) {
      const vm = this._vm
      const falta = Number(this._data?.faltando) || 0
      const media = Number(this._data?.media_gastos_mensais) || 0
      const sug = []
      if (media > 0) sug.push({ rot: `1 mês · ${money(media)}`, valor: Math.round(media * 100) / 100 })
      if (falta > 0) sug.push({ rot: `fechar a meta · ${money(falta)}`, valor: Math.round(falta * 100) / 100 })
      this._modalValor({
        titulo: 'Depositar na reserva',
        dica: falta > 0 ? `Faltam ${money(falta)} para o seu objetivo.` : 'Você já bateu o objetivo — todo extra aqui é folga.',
        rotulo: 'Valor do depósito (R$)',
        sugestoes: sug,
        acao: (valor) => vm.api('PATCH', `reserva/${id}/depositar`, { valor }),
      })
    },
    sacar(id, disponivel) {
      const vm = this._vm
      this._modalValor({
        titulo: 'Sacar da reserva',
        dica: `Disponível: ${money(disponivel)}. Reserva existe para ser usada em emergência — repor depois é parte do plano.`,
        rotulo: 'Valor do saque (R$)',
        sugestoes: [],
        acao: (valor) => vm.api('PATCH', `reserva/${id}/sacar`, { valor }),
      })
    },
    editarMeta(id, atual) {
      const vm = this._vm, s = this._st()
      const media = Number(this._data?.media_gastos_mensais) || 0
      vm.showModal(`<div style="font-family:var(--terminal-font);color:var(--terminal-ink)">
        <div style="font-size:16px;font-weight:640">Objetivo da reserva</div>
        <div style="color:var(--terminal-ink-soft);font-size:12px;margin:4px 0 18px">Quantos meses de gastos essenciais você quer cobrir.</div>
        <div class="re-obj-op">
          ${DEGRAUS.map(g => `<button class="re-obj-op__b ${g.m === Number(atual) ? 'is-on' : ''}" onclick="document.getElementById('re-meses').value=${g.m};VMTerminalReserva._marcarObj(${g.m})" data-m="${g.m}">
            <strong>${g.m}</strong><small>${g.rot.toLowerCase()}</small>${media > 0 ? `<em>${money(g.m * media)}</em>` : ''}
          </button>`).join('')}
        </div>
        <div style="margin-top:14px">${this._lab('Ou informe outro valor (1 a 36)')}<input id="re-meses" type="number" min="1" max="36" style="${s}" value="${Number(atual) || 6}"></div>
        <div style="display:flex;gap:8px;margin-top:16px">
          <button class="ds-btn ds-btn--primary" style="flex:1" onclick="VMTerminalReserva.salvarMeta(${Number(id)})"><i class="fas fa-check"></i> Salvar</button>
          <button class="ds-btn" onclick="VM.closeModal()">Cancelar</button>
        </div></div>`)
    },
    _marcarObj(m) {
      document.querySelectorAll('.re-obj-op__b').forEach(b => b.classList.toggle('is-on', Number(b.dataset.m) === Number(m)))
    },
    async salvarMeta(id) {
      const vm = this._vm
      const objetivo_meses = parseInt(document.getElementById('re-meses')?.value)
      if (!(objetivo_meses >= 1 && objetivo_meses <= 36)) return vm.toast('Informe de 1 a 36 meses.', 'error')
      const r = await vm.api('PATCH', `reserva/${id}/meta-meses`, { objetivo_meses }).catch(e => ({ error: e.response?.data?.error }))
      if (r?.success) { vm.closeModal(); vm.toast('Objetivo atualizado.', 'success'); this.reload() }
      else vm.toast(r?.error || 'Erro ao atualizar.', 'error')
    },
  }
})()
