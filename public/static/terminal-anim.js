/**
 * VerdeMais — VMAnim
 * ============================================================================
 * Anima o que já foi renderizado, sem exigir mudança em nenhuma das ~35 telas.
 * Um MutationObserver observa o #page-content; quando uma tela troca, aplica:
 *   • contagem dos números grandes (KPIs, heróis, totais);
 *   • entrada escalonada de cards e linhas de tabela.
 * Cada elemento é marcado com data-vm-anim para nunca animar duas vezes.
 *
 * Nada aqui altera texto final: a contagem termina restaurando exatamente a
 * string que o render produziu, então formatação/centavos ficam intactos.
 */
(function () {
  const REDUZIR = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches

  // Números grandes que valem contagem. Linhas de tabela ficam de fora de
  // propósito: dezenas de números subindo ao mesmo tempo viram ruído.
  const SEL_NUM = [
    '.td-kpi > strong', '.td-patrimony > strong', '.td-big-number',
    '.td-metric__body strong', '.td-score__center strong', '.td-cards__fatura strong',
    '.lg-kpi strong', '.ac-sum-tile strong', '.rl-hero__val', '.rl-stat__val',
    '.sim-big', '.tf-screen .stat-value',
  ].join(',')

  // Blocos e linhas que entram escalonados.
  const SEL_BLOCO = ['.td-kpi', '.td-metric', '.lg-kpi', '.ac-sum-tile', '.rl-stat', '.rl-hl'].join(',')
  const SEL_LINHA = [
    '.td-transaction', '.td-due', '.td-action', '.td-card-row',
    '.lg-table tbody tr', '.rl-table tbody tr', '.ac-parc-table tbody tr',
    '.ac-evo-table tbody tr', '.td-enc-table tbody tr', '.ac-usorow', '.rl-rank__it',
  ].join(',')

  const PASSO_BLOCO = 45   // ms entre blocos
  const PASSO_LINHA = 26   // ms entre linhas
  const MAX_STAGGER = 12   // além disso todo mundo entra junto — lista longa não pode ter fila

  /** "R$ 1.234,56" → { n: 1234.56, pre: "R$ ", pos: "", dec: 2 } */
  function dissecar(txt) {
    const m = String(txt).match(/^(\D*?)(-?[\d.]+(?:,\d+)?)(\D*)$/)
    if (!m) return null
    const [, pre, num, pos] = m
    const limpo = num.replace(/\./g, '').replace(',', '.')
    const n = parseFloat(limpo)
    if (!Number.isFinite(n)) return null
    const dec = num.includes(',') ? (num.split(',')[1] || '').length : 0
    return { n, pre, pos, dec }
  }

  const fmt = (n, dec) => n.toLocaleString('pt-BR', { minimumFractionDigits: dec, maximumFractionDigits: dec })

  function contar(el) {
    const original = el.textContent
    const d = dissecar(original.trim())
    // Só conta valores com peso: 0, 1 ou 2 não ganham nada com animação.
    if (!d || Math.abs(d.n) < 3) return
    const alvo = d.n
    const dur = 700
    const t0 = performance.now()
    el.classList.add('vm-counting')

    function passo(t) {
      const p = Math.min(1, (t - t0) / dur)
      // easeOutExpo: rápido no começo, freia no fim — parece "assentar".
      const e = p === 1 ? 1 : 1 - Math.pow(2, -10 * p)
      if (p < 1) {
        el.textContent = d.pre + fmt(alvo * e, d.dec) + d.pos
        requestAnimationFrame(passo)
      } else {
        // Termina restaurando exatamente a string do render: nenhum centavo
        // ou formatação se perde por causa da animação.
        el.textContent = original
        el.classList.remove('vm-counting')
      }
    }
    requestAnimationFrame(passo)
  }

  /** Coleta os que casam com `sel` dentro de `raiz` — e a própria `raiz`. */
  function achar(raiz, sel) {
    const out = raiz.querySelectorAll ? Array.from(raiz.querySelectorAll(sel)) : []
    if (raiz.matches && raiz.matches(sel)) out.unshift(raiz)
    return out
  }

  function aplicar(raiz) {
    if (!raiz || raiz.nodeType !== 1) return

    // 1) contagem dos números grandes
    achar(raiz, SEL_NUM).forEach(el => {
      if (el.dataset.vmAnim) return
      el.dataset.vmAnim = '1'
      // Elementos com HTML filho complexo (ex.: <small>) ficam de fora: o custo
      // de reconstruir o markup a cada frame não paga o efeito.
      if (el.children.length === 0) contar(el)
    })

    // 2) entrada escalonada
    let i = 0
    achar(raiz, SEL_BLOCO).forEach(el => {
      if (el.dataset.vmAnim) return
      el.dataset.vmAnim = '1'
      el.style.setProperty('--vm-d', `${Math.min(i, MAX_STAGGER) * PASSO_BLOCO}ms`)
      el.classList.add('vm-in'); i++
    })
    let j = 0
    achar(raiz, SEL_LINHA).forEach(el => {
      if (el.dataset.vmAnim) return
      el.dataset.vmAnim = '1'
      el.style.setProperty('--vm-d', `${Math.min(j, MAX_STAGGER) * PASSO_LINHA}ms`)
      el.classList.add('vm-in-row'); j++
    })
  }

  // Só os nós REALMENTE adicionados entram na fila. Varrer o #page-content
  // inteiro a cada mutação seria caro: o tooltip do gráfico de Relatórios, por
  // exemplo, reescreve seu conteúdo a cada mousemove.
  const fila = new Set()
  let agendado = null
  function agendar() {
    if (agendado) return
    agendado = requestAnimationFrame(() => {
      agendado = null
      const nos = Array.from(fila); fila.clear()
      nos.forEach(aplicar)
    })
  }

  function observar() {
    const alvo = document.getElementById('page-content')
    if (!alvo) return false
    aplicar(alvo)
    new MutationObserver((muts) => {
      let tem = false
      for (const m of muts) {
        for (const n of m.addedNodes) {
          if (n.nodeType === 1) { fila.add(n); tem = true }
        }
      }
      if (tem) agendar()
    }).observe(alvo, { childList: true, subtree: true })
    return true
  }

  window.VMAnim = {
    reduzir: REDUZIR,
    aplicar(raiz) { if (!REDUZIR) aplicar(raiz || document.getElementById('page-content')) },
    /** Envolve uma troca de tela numa View Transition quando o browser suporta. */
    transicao(fn) {
      if (REDUZIR || !document.startViewTransition) return fn()
      // O callback roda só a parte SÍNCRONA do render (que pinta o skeleton).
      // Não devolvemos a promise de propósito: esperar o fetch inteiro
      // congelaria a tela no estado antigo até os dados chegarem.
      try { document.startViewTransition(() => { fn() }) } catch (_) { fn() }
    },
  }

  if (REDUZIR) return
  if (!observar()) document.addEventListener('DOMContentLoaded', observar, { once: true })
})()
