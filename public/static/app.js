// VerdeMais - Frontend SPA Engine
// ==========================================

const VM = {
  token: null,
  user: null,
  currentPage: null,
  charts: {},
  limites: null, // limites do plano atual, carregados junto com o dashboard

  // ======= UPSELL / PLANOS =======
  planoTem(feature) {
    if (!this.limites) return true // se ainda não carregou, permite (o backend vai bloquear)
    const v = this.limites[feature]
    if (typeof v === 'boolean') return v
    if (typeof v === 'number') return v === -1 || v > 0  // -1 = sem limite (Pro/Premium)
    return true
  },

  upsellModal(feature, tituloExtra) {
    const msgs = {
      score_saude: { titulo: '🧠 Score de Saúde Financeira', desc: 'Veja sua pontuação de 0 a 100, os fatores que afetam suas finanças e dicas personalizadas para melhorar.' },
      ia_insights: { titulo: '🤖 Análise com IA', desc: 'Insights inteligentes sobre seus gastos, receitas e investimentos. A IA identifica padrões e sugere ações concretas.' },
      relatorio_anual: { titulo: '📋 Relatório Anual', desc: 'Veja sua evolução financeira mês a mês, totais anuais e comparativos de receitas x despesas.' },
      simulacao: { titulo: '🧮 Simulador de Investimentos', desc: 'Simule Tesouro Direto, CDB, Ações e outros. Veja projeções patrimoniais e compare rendimentos.' },
      exportar_pdf: { titulo: '📄 Exportar PDF', desc: 'Exporte seus relatórios em PDF para arquivar ou compartilhar com seu contador.' },
      amortizacao: { titulo: '⚡ Amortização Extraordinária', desc: 'Pague a mais nas parcelas do seu financiamento e reduza juros e prazo. Recurso exclusivo Premium.' },
      metas: { titulo: '🎯 Metas Ilimitadas', desc: 'O plano Free permite até 3 metas. Com o Premium você cria metas ilimitadas e acompanha todas.' },
      cartoes: { titulo: '💳 Mais Cartões', desc: 'Adicione até 10 cartões no Premium e controle todos os seus gastos.' },
      lembretes: { titulo: '🔔 Lembretes Ilimitados', desc: 'Com o Premium você cria lembretes ilimitados e nunca mais perde um vencimento.' },
      investimentos: { titulo: '📈 Mais Investimentos', desc: 'Registre todos os seus investimentos sem limites no plano Premium.' },
      emprestimos: { titulo: '💰 Mais Empréstimos', desc: 'Controle todos os seus empréstimos ativos sem restrições no Premium.' },
      financiamentos: { titulo: '🏠 Mais Financiamentos', desc: 'Gerencie múltiplos financiamentos simultaneamente com o plano Premium.' },
      despesas_mes: { titulo: '📊 Mais Despesas por Mês', desc: 'O plano Free aceita até 30 despesas por mês. No Premium você tem despesas ilimitadas.' },
      receitas_mes: { titulo: '💵 Mais Receitas por Mês', desc: 'O plano Free aceita até 10 receitas por mês. No Premium você tem receitas ilimitadas.' },
    }
    const info = msgs[feature] || { titulo: tituloExtra || '🌟 Recurso Premium', desc: 'Este recurso está disponível nos planos pagos.' }
    const plano = this.user?.plano || 'free'
    const proximo = plano === 'free' ? 'Premium (R$ 19/mês)' : 'Pro (R$ 49/mês)'
    this.showModal(`
      <div style="text-align:center;padding:8px 0;">
        <div style="font-size:2.5rem;margin-bottom:12px;">🔒</div>
        <h3 style="font-size:1.2rem;font-weight:700;margin-bottom:8px;">${info.titulo}</h3>
        <p style="color:#888;margin-bottom:20px;font-size:0.9rem;line-height:1.5;">${info.desc}</p>
        <div style="background:rgba(47,191,113,0.08);border:1px solid rgba(47,191,113,0.2);border-radius:12px;padding:16px;margin-bottom:20px;">
          <div style="font-size:0.8rem;color:#2FBF71;font-weight:600;margin-bottom:4px;">Disponível no plano</div>
          <div style="font-size:1.1rem;font-weight:700;">${proximo}</div>
          <div style="font-size:0.78rem;color:#666;margin-top:4px;">Cancele quando quiser · Sem burocracia</div>
        </div>
        <button onclick="VM.closeModal();VM.openPricingModal()" class="btn-primary" style="width:100%;justify-content:center;">
          <i class="fas fa-crown"></i> Ver Planos e Fazer Upgrade
        </button>
        <button onclick="VM.closeModal()" class="btn-secondary" style="width:100%;margin-top:10px;justify-content:center;">Agora não</button>
      </div>
    `)
  },

  init() {
    this.token = localStorage.getItem('vm_token')
    const userStr = localStorage.getItem('vm_user')
    if (userStr) this.user = JSON.parse(userStr)

    // Aviso de sessão próxima de expirar (após 6 dias dos 7 disponíveis)
    const loginAt = parseInt(localStorage.getItem('vm_login_at') || '0')
    if (loginAt && this.token) {
      const diffDias = (Date.now() - loginAt) / (1000 * 60 * 60 * 24)
      if (diffDias >= 6) {
        setTimeout(() => {
          this.toast(`⚠️ Sua sessão expira em breve. Faça login novamente para continuar.`, 'warning', 8000)
        }, 3000)
      }
    }
    
    const path = window.location.pathname
    if (path === '/login') return this.renderLogin()
    if (path === '/cadastro') return this.renderCadastro()
    if (path === '/verificar-email') return this.renderOTP()
    if (path === '/' || path === '') return window.location.href = '/'
    if (path.startsWith('/onboarding')) {
      if (!this.token) return window.location.href = '/login'
      return this.renderOnboarding()
    }
    if (path.startsWith('/app')) {
      if (!this.token) return window.location.href = '/login'
      this.renderApp()
      // Iniciar polling de conquistas (F2)
      setTimeout(() => this.startConqPoll(), 5000)

      // ── MutationObserver: corrigir scroll ao abrir qualquer modal ──────────
      const modalCont = document.getElementById('modal-container')
      if (modalCont) {
        new MutationObserver((mutations) => {
          for (const m of mutations) {
            if (m.addedNodes.length > 0) {
              // Modal foi inserido: rolar para o topo e bloquear body scroll
              requestAnimationFrame(() => {
                const modal = modalCont.querySelector('.modal, .modal-card')
                if (modal) modal.scrollTop = 0
                if (window.innerWidth <= 768) document.body.style.overflow = 'hidden'
              })
            }
            if (m.type === 'childList' && modalCont.innerHTML === '') {
              // Modal foi removido: restaurar body scroll
              document.body.style.overflow = ''
            }
          }
        }).observe(modalCont, { childList: true })
      }
    }
  },

  // ======= MODAL DE CONFIRMAÇÃO CUSTOMIZADO (substitui confirm() nativo) =======
  vmConfirm(mensagem, { titulo = 'Confirmar ação', corBotao = '#ef4444', textoBotao = 'Confirmar', icone = '⚠️' } = {}) {
    return new Promise((resolve) => {
      const id = 'vm-confirm-' + Date.now()
      const overlay = document.createElement('div')
      overlay.id = id
      overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:99999;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(4px);animation:fadeIn 0.15s ease;'
      overlay.innerHTML = `
        <div style="background:#1a1a2e;border:1px solid rgba(255,255,255,0.1);border-radius:16px;padding:28px 28px 24px;max-width:400px;width:90%;box-shadow:0 20px 60px rgba(0,0,0,0.5);animation:slideUp 0.2s ease;">
          <div style="text-align:center;margin-bottom:18px;">
            <div style="font-size:2.2rem;margin-bottom:10px;">${icone}</div>
            <div style="font-size:1rem;font-weight:700;color:#f1f5f9;margin-bottom:8px;">${titulo}</div>
            <div style="font-size:0.88rem;color:#94a3b8;line-height:1.5;">${mensagem}</div>
          </div>
          <div style="display:flex;gap:10px;margin-top:4px;">
            <button id="${id}-cancel" style="flex:1;padding:10px;border-radius:10px;border:1px solid rgba(255,255,255,0.12);background:rgba(255,255,255,0.06);color:#cbd5e1;cursor:pointer;font-size:0.9rem;font-weight:600;transition:all 0.2s;">
              Cancelar
            </button>
            <button id="${id}-ok" style="flex:1;padding:10px;border-radius:10px;border:none;background:${corBotao};color:#fff;cursor:pointer;font-size:0.9rem;font-weight:700;transition:all 0.2s;">
              ${textoBotao}
            </button>
          </div>
        </div>
      `
      document.body.appendChild(overlay)
      const close = (val) => { overlay.remove(); resolve(val) }
      document.getElementById(`${id}-ok`).onclick = () => close(true)
      document.getElementById(`${id}-cancel`).onclick = () => close(false)
      overlay.addEventListener('click', (e) => { if (e.target === overlay) close(false) })
    })
  },

  api(method, endpoint, data) {
    // Cache front-end para endpoints públicos pesados (CDI e cotações)
    const CACHE_ENDPOINTS = { 'cdi/atual': 10 * 60 * 1000, 'investimentos/cotacoes': 15 * 60 * 1000 }
    const cacheKey = `_apiCache_${endpoint}`
    if (method === 'GET' && CACHE_ENDPOINTS[endpoint]) {
      const cached = this[cacheKey]
      if (cached && Date.now() - cached.ts < CACHE_ENDPOINTS[endpoint]) {
        return Promise.resolve(cached.data)
      }
    }
    return axios({
      method,
      url: `/api/${endpoint}`,
      data,
      headers: this.token ? { Authorization: `Bearer ${this.token}` } : {}
    }).then(r => {
      if (method === 'GET' && CACHE_ENDPOINTS[endpoint]) {
        this[cacheKey] = { data: r.data, ts: Date.now() }
      }
      return r.data
    }).catch(e => {
      if (e.response?.status === 401) {
        this.logout()
        throw e
      }
      // Interceptar erro 403 com flag upgrade = true — mostrar upsell
      if (e.response?.status === 403 && e.response?.data?.upgrade) {
        const feature = e.response.data.feature
        const msg = e.response.data.error
        this.upsellModal(feature, msg)
        throw e
      }
      throw e
    })
  },

  toast(msg, type = 'success', duration = 4000) {
    let container = document.getElementById('toast-container')
    if (!container) {
      container = document.createElement('div')
      container.id = 'toast-container'
      container.className = 'toast-container'
      document.body.appendChild(container)
    }
    const t = document.createElement('div')
    t.className = `toast ${type}`
    const icons = { success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️' }
    t.innerHTML = `<span>${icons[type] || '💬'}</span><span>${msg}</span>`
    container.appendChild(t)
    setTimeout(() => t.remove(), duration)
  },

  formatMoney(v) {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v || 0)
  },

  // Alias curto para formatMoney
  fmt(v) {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v || 0)
  },

  onChangeMeioPagamento(meio) {
    const cartaoWrapper = document.getElementById('d-cartao-wrapper')
    const parcelasWrapper = document.getElementById('d-parcelas-wrapper')
    if (cartaoWrapper) cartaoWrapper.style.display = (meio === 'cartao_credito' || meio === 'parcelado_cartao') ? 'block' : 'none'
    if (parcelasWrapper) parcelasWrapper.style.display = meio === 'parcelado_cartao' ? 'block' : 'none'
    // Se mudar pra não-parcelado, limpar campos de parcela
    if (meio !== 'parcelado_cartao') {
      const retroEl = document.getElementById('d-retroativa-wrapper')
      if (retroEl) retroEl.style.display = 'none'
    }
    // Inferir mês de faturamento ao selecionar cartão
    if (meio === 'cartao_credito' || meio === 'parcelado_cartao') {
      const cartaoId = document.getElementById('d-cartao-id')?.value
      if (cartaoId) this.inferirMesFaturamento(cartaoId)
    } else {
      const infoEl = document.getElementById('d-billing-info')
      if (infoEl) infoEl.style.display = 'none'
    }
  },

  // Calcula e exibe o mês de faturamento com base no cartão e data selecionada
  async inferirMesFaturamento(cartaoId) {
    if (!cartaoId) return
    try {
      const dataInput = document.getElementById('d-data')?.value || document.getElementById('cv-data')?.value
      if (!dataInput) return
      // Usar endpoint dedicado para billing info
      const info = await this.api('GET', `cartoes/${cartaoId}/info?data=${dataInput}`)
      const mesesNomes = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro']
      const mesF = info.billing_month, anoF = info.billing_year
      const diaCompra = new Date(dataInput + 'T12:00:00').getDate()
      const infoEl = document.getElementById('d-billing-info')
      if (infoEl) {
        infoEl.style.display = 'block'
        infoEl.innerHTML = `
          <div style="background:rgba(47,191,113,0.08);border:1px solid rgba(47,191,113,0.3);border-radius:8px;padding:10px 14px;font-size:0.8rem;">
            📅 <strong>Fatura de ${mesesNomes[mesF-1]}/${anoF}</strong>
            <span style="color:#888;margin-left:8px;">Fechamento dia ${info.dia_fechamento} · Vencimento dia ${info.dia_vencimento} · ${this.formatDate(info.data_vencimento)}</span>
            ${diaCompra >= info.dia_fechamento
              ? `<div style="color:#ffc400;margin-top:3px;">⚠️ Compra no fechamento ou após (dia ${info.dia_fechamento}) → próxima fatura</div>`
              : `<div style="color:#2FBF71;margin-top:3px;">✅ Compra antes do fechamento → fatura de ${mesesNomes[mesF-1]}</div>`}
            <div style="color:#888;margin-top:3px;">Limite disponível: <strong style="color:#fff;">${this.formatMoney(info.limite_disponivel)}</strong></div>
          </div>`
      }
    } catch(e) { /* silencioso */ }
  },

  // Atualiza preview bidirecional: valor total ↔ valor parcela
  atualizarPreviewParcela() {
    const nEl = document.getElementById('d-parcelas')
    const vTotalEl = document.getElementById('d-valor')
    const vParcelaEl = document.getElementById('d-vparcela')
    const retroSim = document.getElementById('d-retro-sim')
    const retroWrapper = document.getElementById('d-retro-parcelas-wrapper')
    const parcelasRestEl = document.getElementById('d-parcelas-restantes')
    const preview = document.getElementById('d-parcelas-preview')
    if (!nEl || !vTotalEl) return
    const n = parseInt(nEl.value) || 2
    const vTotal = parseFloat(vTotalEl.value) || 0
    const vParcela = parseFloat(vParcelaEl?.value) || 0
    // Quem foi editado por último?
    const ultimoEditado = document.getElementById('d-ultimo-editado')?.value || 'total'
    let totalFinal = vTotal, parcelaFinal = vParcela
    if (ultimoEditado === 'total' && n > 0 && vTotal > 0) {
      parcelaFinal = vTotal / n
      if (vParcelaEl) vParcelaEl.value = parcelaFinal.toFixed(2)
    } else if (ultimoEditado === 'parcela' && n > 0 && vParcela > 0) {
      totalFinal = vParcela * n
      if (vTotalEl) vTotalEl.value = totalFinal.toFixed(2)
    }
    if (preview && n >= 2 && totalFinal > 0) {
      const pRestantes = retroSim?.checked ? (parseInt(parcelasRestEl?.value) || n) : n
      preview.innerHTML = `<span style="color:#2FBF71;">✓ ${n}x de R$ ${(totalFinal/n).toFixed(2).replace('.',',')} (total: R$ ${totalFinal.toFixed(2).replace('.',',')})</span>`
    }
    // Mostrar/ocultar campo parcelas restantes
    if (retroWrapper) {
      retroWrapper.style.display = retroSim?.checked ? 'block' : 'none'
    }
  },

  onChangeRetroativa(checked) {
    const wrapper = document.getElementById('d-retro-parcelas-wrapper')
    const nEl = document.getElementById('d-parcelas')
    const parcelasRestEl = document.getElementById('d-parcelas-restantes')
    if (wrapper) wrapper.style.display = checked ? 'block' : 'none'
    if (checked && parcelasRestEl && nEl) {
      const n = parseInt(nEl.value) || 2
      parcelasRestEl.max = n
      if (!parcelasRestEl.value || parseInt(parcelasRestEl.value) > n) parcelasRestEl.value = n
    }
    this.atualizarPreviewParcela()
  },

  // Bloco 2.3: Alerta de orçamento em tempo real no modal de despesa
  async verificarOrcamentoModal() {
    const alertaEl = document.getElementById('alertaOrcamento')
    if (!alertaEl) return
    const cat = document.getElementById('d-cat')?.value
    const valor = parseFloat(document.getElementById('d-valor')?.value) || 0
    if (!cat || valor <= 0) { alertaEl.style.display = 'none'; return }
    try {
      const hoje = new Date()
      const mes = String(hoje.getMonth() + 1).padStart(2, '0')
      const ano = String(hoje.getFullYear())
      const data = await this.api('GET', `orcamentos?mes=${mes}&ano=${ano}`).catch(() => null)
      if (!data) return
      const orc = (data.orcamentos || []).find(o => o.categoria === cat)
      if (!orc || !orc.limite) { alertaEl.style.display = 'none'; return }
      const gastoAtual = orc.gasto_atual || 0
      const novoGasto = gastoAtual + valor
      const perc = Math.round(novoGasto / orc.limite * 100)
      if (perc >= 100) {
        alertaEl.innerHTML = `⛔ <strong>Limite estourado!</strong> Você terá R$ ${this.formatMoney(novoGasto)} em <em>${cat}</em> (limite: R$ ${this.formatMoney(orc.limite)} — <strong>${perc}%</strong>).`
        alertaEl.style.background = 'rgba(255,107,107,0.12)'
        alertaEl.style.borderColor = 'rgba(255,107,107,0.5)'
        alertaEl.style.display = 'block'
      } else if (perc >= 80) {
        alertaEl.innerHTML = `⚠️ <strong>Atenção:</strong> com esta despesa você usará <strong>${perc}%</strong> do orçamento de <em>${cat}</em> (R$ ${this.formatMoney(novoGasto)} / R$ ${this.formatMoney(orc.limite)}).`
        alertaEl.style.background = 'rgba(255,196,0,0.10)'
        alertaEl.style.borderColor = 'rgba(255,196,0,0.4)'
        alertaEl.style.display = 'block'
      } else {
        alertaEl.style.display = 'none'
      }
    } catch(_) { alertaEl.style.display = 'none' }
  },

  // Recalcular saldo devedor do empréstimo com base em juros compostos
  recalcularSaldoEmprestimo() {
    const valorOriginal = parseFloat(document.getElementById('e-valor')?.value) || 0
    const taxaMensal = parseFloat(document.getElementById('e-juros')?.value) || 0
    const nParcelas = parseInt(document.getElementById('e-nparcelas')?.value) || 0
    const nPagas = parseInt(document.getElementById('e-pagas')?.value) || 0
    const saldoEl = document.getElementById('e-saldo')
    const previewEl = document.getElementById('e-saldo-preview')
    if (!saldoEl || valorOriginal <= 0 || nParcelas <= 0) return
    // Cálculo do saldo devedor pelo método Price
    let saldo = 0
    if (taxaMensal > 0) {
      const t = taxaMensal / 100
      const fator = Math.pow(1 + t, nParcelas)
      const fatorPago = Math.pow(1 + t, nPagas)
      saldo = Math.max(0, valorOriginal * (fator - fatorPago) / (fator - 1))
    } else {
      saldo = Math.max(0, valorOriginal * (1 - nPagas / nParcelas))
    }
    saldo = Math.round(saldo * 100) / 100
    // Só preencher automaticamente se o usuário não digitou manualmente
    if (!saldoEl.dataset.manualEdit) {
      saldoEl.value = saldo.toFixed(2)
    }
    if (previewEl) {
      const restantes = nParcelas - nPagas
      previewEl.textContent = restantes > 0
        ? `${restantes} parcelas restantes • saldo calculado: R$ ${saldo.toFixed(2).replace('.',',')}`
        : '✅ Empréstimo quitado'
    }
  },

  formatDate(d) {
    if (!d) return '-'
    return new Date(d + 'T00:00:00').toLocaleDateString('pt-BR')
  },

  logout() {
    if (this.token) {
      this.api('POST', 'auth/logout').catch(() => {})
    }
    localStorage.removeItem('vm_token')
    localStorage.removeItem('vm_user')
    this.token = null
    this.user = null
    window.location.href = '/login'
  },

  // ======= AUTH PAGES =======
  renderLogin() {
    document.getElementById('app').innerHTML = `
      <div style="min-height:100vh;background:linear-gradient(135deg,#0a0f0a 0%,#0d1f12 40%,#0a2a14 100%);display:flex;align-items:center;justify-content:center;padding:20px;position:relative;overflow:hidden;">
        
        <!-- Decoração de fundo -->
        <div style="position:absolute;top:-120px;right:-120px;width:400px;height:400px;border-radius:50%;background:radial-gradient(circle,rgba(47,191,113,0.12) 0%,transparent 70%);pointer-events:none;"></div>
        <div style="position:absolute;bottom:-80px;left:-80px;width:300px;height:300px;border-radius:50%;background:radial-gradient(circle,rgba(16,185,129,0.08) 0%,transparent 70%);pointer-events:none;"></div>
        
        <div style="width:100%;max-width:420px;position:relative;z-index:1;">
          <!-- Logo e slogan -->
          <div style="text-align:center;margin-bottom:36px;">
            <div style="display:inline-flex;align-items:center;justify-content:center;width:68px;height:68px;background:linear-gradient(135deg,#2FBF71,#10B981);border-radius:20px;margin-bottom:16px;box-shadow:0 8px 32px rgba(47,191,113,0.35);">
              <span style="font-size:2rem;">🌱</span>
            </div>
            <div style="font-size:2rem;font-weight:900;color:#f8fafc;letter-spacing:-1px;margin-bottom:6px;">VerdeMais</div>
            <div style="font-size:0.95rem;color:#94a3b8;font-weight:400;">Controle total das suas finanças pessoais</div>
          </div>

          <!-- Card do formulário -->
          <div style="background:rgba(255,255,255,0.04);backdrop-filter:blur(20px);border:1px solid rgba(255,255,255,0.08);border-radius:20px;padding:36px 32px;box-shadow:0 24px 64px rgba(0,0,0,0.4);">
            <div style="font-size:1.1rem;font-weight:700;color:#f1f5f9;text-align:center;margin-bottom:24px;">Entrar na sua conta</div>

            <div id="auth-error" style="display:none;background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.3);border-radius:10px;padding:12px 16px;margin-bottom:16px;color:#fca5a5;font-size:0.88rem;text-align:center;"></div>

            <form id="login-form">
              <div style="margin-bottom:16px;">
                <label style="display:block;font-size:0.82rem;font-weight:600;color:#94a3b8;margin-bottom:8px;text-transform:uppercase;letter-spacing:0.5px;">E-mail</label>
                <div style="position:relative;">
                  <i class="fas fa-envelope" style="position:absolute;left:14px;top:50%;transform:translateY(-50%);color:#64748b;font-size:0.85rem;pointer-events:none;"></i>
                  <input type="email" id="login-email" 
                    style="width:100%;box-sizing:border-box;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);border-radius:12px;padding:13px 14px 13px 40px;color:#f1f5f9;font-size:0.95rem;outline:none;transition:border-color 0.2s;font-family:inherit;"
                    placeholder="seu@email.com" required
                    onfocus="this.style.borderColor='#2FBF71'" onblur="this.style.borderColor='rgba(255,255,255,0.1)'">
                </div>
              </div>
              <div style="margin-bottom:24px;">
                <label style="display:block;font-size:0.82rem;font-weight:600;color:#94a3b8;margin-bottom:8px;text-transform:uppercase;letter-spacing:0.5px;">Senha</label>
                <div style="position:relative;">
                  <i class="fas fa-lock" style="position:absolute;left:14px;top:50%;transform:translateY(-50%);color:#64748b;font-size:0.85rem;pointer-events:none;"></i>
                  <input type="password" id="login-senha"
                    style="width:100%;box-sizing:border-box;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);border-radius:12px;padding:13px 44px 13px 40px;color:#f1f5f9;font-size:0.95rem;outline:none;transition:border-color 0.2s;font-family:inherit;"
                    placeholder="••••••••" required
                    onfocus="this.style.borderColor='#2FBF71'" onblur="this.style.borderColor='rgba(255,255,255,0.1)'">
                  <button type="button" onclick="VM.toggleSenha('login-senha','login-eye')" 
                    style="position:absolute;right:12px;top:50%;transform:translateY(-50%);background:none;border:none;color:#64748b;cursor:pointer;padding:4px;font-size:0.85rem;">
                    <i id="login-eye" class="fas fa-eye"></i>
                  </button>
                </div>
              </div>
              <button type="submit" id="login-btn"
                style="width:100%;padding:14px;background:linear-gradient(135deg,#2FBF71,#10B981);border:none;border-radius:12px;color:#fff;font-size:1rem;font-weight:700;cursor:pointer;transition:all 0.2s;box-shadow:0 4px 20px rgba(47,191,113,0.35);display:flex;align-items:center;justify-content:center;gap:8px;font-family:inherit;"
                onmouseover="this.style.transform='translateY(-1px)';this.style.boxShadow='0 6px 28px rgba(47,191,113,0.45)'"
                onmouseout="this.style.transform='translateY(0)';this.style.boxShadow='0 4px 20px rgba(47,191,113,0.35)'">
                <i class="fas fa-sign-in-alt"></i> Entrar
              </button>
            </form>

            <div style="text-align:center;margin-top:20px;padding-top:20px;border-top:1px solid rgba(255,255,255,0.06);">
              <span style="color:#64748b;font-size:0.88rem;">Não tem conta? </span>
              <a href="/cadastro" style="color:#2FBF71;text-decoration:none;font-weight:700;font-size:0.88rem;">Criar gratuitamente →</a>
            </div>
          </div>

          <div style="text-align:center;margin-top:20px;">
            <a href="/" style="color:#475569;text-decoration:none;font-size:0.8rem;">← Voltar ao site</a>
          </div>
        </div>
      </div>
    `

    document.getElementById('login-form').addEventListener('submit', async (e) => {
      e.preventDefault()
      const btn = document.getElementById('login-btn')
      const errEl = document.getElementById('auth-error')
      btn.disabled = true
      btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Entrando...'
      btn.style.opacity = '0.8'
      errEl.style.display = 'none'

      try {
        const res = await axios.post('/api/auth/login', {
          email: document.getElementById('login-email').value,
          senha: document.getElementById('login-senha').value
        })
        localStorage.setItem('vm_token', res.data.token)
        localStorage.setItem('vm_user', JSON.stringify(res.data.user))
        localStorage.setItem('vm_login_at', Date.now().toString())
        window.location.href = '/app'
      } catch (e) {
        errEl.textContent = e.response?.data?.error || 'E-mail ou senha inválidos. Tente novamente.'
        errEl.style.display = 'block'
        btn.disabled = false
        btn.innerHTML = '<i class="fas fa-sign-in-alt"></i> Entrar'
        btn.style.opacity = '1'
      }
    })
  },

  renderCadastro() {
    document.getElementById('app').innerHTML = `
      <div style="min-height:100vh;background:#0F172A;display:flex;">

        <!-- ── LADO ESQUERDO — value proposition (oculto em mobile) ── -->
        <div style="flex:1;background:linear-gradient(135deg,#0F172A 0%,#0d2b18 60%,#0a3d20 100%);display:flex;flex-direction:column;justify-content:center;padding:60px 48px;border-right:1px solid rgba(16,185,129,0.12);" class="auth-left-panel">
          <!-- Logo -->
          <div style="display:flex;align-items:center;gap:12px;margin-bottom:56px;">
            <div style="width:42px;height:42px;background:linear-gradient(135deg,#10B981,#059669);border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:1.3rem;">🌱</div>
            <div>
              <div style="font-size:1.3rem;font-weight:800;color:#F8FAFC;letter-spacing:-0.5px;">VerdeMais</div>
              <div style="font-size:0.72rem;color:#34D399;letter-spacing:1.5px;text-transform:uppercase;font-weight:600;">Controle financeiro inteligente</div>
            </div>
          </div>

          <!-- Headline -->
          <h1 style="font-size:2.4rem;font-weight:800;color:#F8FAFC;line-height:1.2;margin-bottom:20px;letter-spacing:-1px;">
            Domine suas finanças<br><span style="color:#10B981;">com inteligência</span>
          </h1>
          <p style="color:#94A3B8;font-size:1rem;line-height:1.7;margin-bottom:48px;max-width:380px;">
            Análise automática de gastos, metas inteligentes e um dashboard que você realmente entende.
          </p>

          <!-- Benefícios -->
          <div style="display:flex;flex-direction:column;gap:20px;margin-bottom:56px;">
            ${[
              ['🤖','IA analisa seus gastos automaticamente','Padrões e insights personalizados todo mês'],
              ['🎯','Metas baseadas no seu perfil','Objetivos realistas com plano de ação'],
              ['📊','Dashboard intuitivo','Visualize seu dinheiro de forma clara'],
              ['🛡️','Segurança dos seus dados','Criptografia de ponta a ponta']
            ].map(([icon,title,desc]) => `
              <div style="display:flex;align-items:flex-start;gap:14px;">
                <div style="width:40px;height:40px;background:rgba(16,185,129,0.12);border:1px solid rgba(16,185,129,0.2);border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:1.1rem;flex-shrink:0;">${icon}</div>
                <div>
                  <div style="font-weight:600;color:#F8FAFC;font-size:0.9rem;">${title}</div>
                  <div style="color:#64748B;font-size:0.8rem;margin-top:2px;">${desc}</div>
                </div>
              </div>
            `).join('')}
          </div>

          <!-- Depoimento -->
          <div style="background:rgba(30,41,59,0.6);border:1px solid rgba(255,255,255,0.08);border-radius:16px;padding:20px;backdrop-filter:blur(12px);">
            <div style="display:flex;gap:4px;margin-bottom:10px;">⭐⭐⭐⭐⭐</div>
            <p style="color:#CBD5E1;font-size:0.85rem;line-height:1.6;margin-bottom:12px;font-style:italic;">"Em 3 meses, quitei R$ 8.000 em dívidas e ainda montei minha reserva de emergência. O VerdeMais mudou minha relação com dinheiro."</p>
            <div style="display:flex;align-items:center;gap:10px;">
              <div style="width:32px;height:32px;background:linear-gradient(135deg,#10B981,#059669);border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:0.9rem;font-weight:700;color:#fff;">M</div>
              <div>
                <div style="font-weight:600;color:#F8FAFC;font-size:0.82rem;">Marcos A.</div>
                <div style="color:#64748B;font-size:0.72rem;">Usuário Premium — Belo Horizonte</div>
              </div>
            </div>
          </div>
        </div>

        <!-- ── LADO DIREITO — formulário ── -->
        <div style="flex:1;max-width:560px;min-width:320px;display:flex;align-items:center;justify-content:center;padding:40px 32px;overflow-y:auto;">
          <div style="width:100%;max-width:440px;">

            <!-- Logo mobile (só aparece em telas pequenas) -->
            <div style="display:flex;align-items:center;gap:10px;margin-bottom:32px;" class="auth-logo-mobile">
              <div style="width:36px;height:36px;background:linear-gradient(135deg,#10B981,#059669);border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:1.1rem;">🌱</div>
              <span style="font-size:1.2rem;font-weight:800;color:#F8FAFC;">VerdeMais</span>
            </div>

            <h2 style="font-size:1.6rem;font-weight:800;color:#F8FAFC;margin-bottom:6px;letter-spacing:-0.5px;">Criar conta gratuita</h2>
            <p style="color:#64748B;font-size:0.88rem;margin-bottom:28px;">Comece em menos de 2 minutos. Sem cartão de crédito.</p>

            <!-- Alert de erro -->
            <div id="auth-error" style="display:none;background:rgba(244,63,94,0.08);border:1px solid rgba(244,63,94,0.3);border-radius:12px;padding:12px 16px;margin-bottom:18px;color:#F43F5E;font-size:0.85rem;"></div>

            <form id="cadastro-form">

              <!-- Nome -->
              <div class="form-group">
                <label style="font-size:0.82rem;font-weight:600;color:#94A3B8;margin-bottom:8px;display:block;">Nome completo</label>
                <div style="position:relative;">
                  <span style="position:absolute;left:14px;top:50%;transform:translateY(-50%);color:#475569;font-size:0.9rem;">👤</span>
                  <input type="text" id="cad-nome" placeholder="Seu nome completo"
                    style="width:100%;background:#0F172A;border:1px solid #1E293B;border-radius:12px;padding:13px 14px 13px 40px;color:#F8FAFC;font-size:0.9rem;outline:none;transition:all 0.2s;box-sizing:border-box;"
                    onfocus="this.style.borderColor='#10B981';this.style.boxShadow='0 0 0 2px rgba(16,185,129,0.15)'"
                    onblur="this.style.boxShadow='none';VM.validateNomeCad(this)"
                    required>
                </div>
                <div id="nome-feedback" style="font-size:0.75rem;margin-top:5px;min-height:16px;"></div>
              </div>

              <!-- E-mail com validação tempo real -->
              <div class="form-group">
                <label style="font-size:0.82rem;font-weight:600;color:#94A3B8;margin-bottom:8px;display:block;">E-mail</label>
                <div style="position:relative;">
                  <span style="position:absolute;left:14px;top:50%;transform:translateY(-50%);color:#475569;font-size:0.9rem;">✉️</span>
                  <input type="email" id="cad-email" placeholder="seu@email.com"
                    style="width:100%;background:#0F172A;border:1px solid #1E293B;border-radius:12px;padding:13px 44px 13px 40px;color:#F8FAFC;font-size:0.9rem;outline:none;transition:all 0.2s;box-sizing:border-box;"
                    onfocus="this.style.borderColor='#10B981';this.style.boxShadow='0 0 0 2px rgba(16,185,129,0.15)'"
                    required>
                  <div id="email-icon" style="position:absolute;right:14px;top:50%;transform:translateY(-50%);font-size:0.9rem;pointer-events:none;"></div>
                </div>
                <div id="email-feedback" style="font-size:0.75rem;margin-top:5px;min-height:16px;"></div>
              </div>

              <!-- Senha -->
              <div class="form-group">
                <label style="font-size:0.82rem;font-weight:600;color:#94A3B8;margin-bottom:8px;display:block;">Senha</label>
                <div style="position:relative;">
                  <span style="position:absolute;left:14px;top:50%;transform:translateY(-50%);color:#475569;font-size:0.9rem;">🔒</span>
                  <input type="password" id="cad-senha" placeholder="Mínimo 8 caracteres"
                    style="width:100%;background:#0F172A;border:1px solid #1E293B;border-radius:12px;padding:13px 44px 13px 40px;color:#F8FAFC;font-size:0.9rem;outline:none;transition:all 0.2s;box-sizing:border-box;"
                    onfocus="this.style.borderColor='#10B981';this.style.boxShadow='0 0 0 2px rgba(16,185,129,0.15)'"
                    required>
                  <button type="button" onclick="VM.toggleSenha('cad-senha','eye1')"
                    style="position:absolute;right:12px;top:50%;transform:translateY(-50%);background:none;border:none;color:#475569;cursor:pointer;font-size:0.9rem;padding:4px;" id="eye1">👁️</button>
                </div>

                <!-- Medidor de força -->
                <div id="senha-strength" style="margin-top:10px;display:none;">
                  <div style="display:flex;gap:4px;margin-bottom:6px;" id="strength-bars"></div>
                  <div style="display:flex;justify-content:space-between;align-items:center;">
                    <span id="strength-label" style="font-size:0.75rem;"></span>
                    <div id="strength-criteria" style="display:flex;gap:8px;font-size:0.68rem;color:#475569;flex-wrap:wrap;justify-content:flex-end;"></div>
                  </div>
                </div>
              </div>

              <!-- Termos -->
              <div style="display:flex;align-items:flex-start;gap:10px;margin-bottom:24px;margin-top:4px;">
                <input type="checkbox" id="cad-termos"
                  style="width:16px;height:16px;margin-top:2px;accent-color:#10B981;flex-shrink:0;cursor:pointer;" required>
                <label for="cad-termos" style="font-size:0.78rem;color:#64748B;line-height:1.5;cursor:pointer;">
                  Concordo com os <a href="#" style="color:#10B981;text-decoration:none;" onclick="return false;">Termos de Uso</a> e a 
                  <a href="#" style="color:#10B981;text-decoration:none;" onclick="return false;">Política de Privacidade</a>
                </label>
              </div>

              <!-- CTA -->
              <button type="submit" class="btn-primary" id="cad-btn" disabled
                style="width:100%;justify-content:center;font-size:0.95rem;padding:14px;background:#10B981;border:none;border-radius:12px;color:#fff;font-weight:700;cursor:pointer;transition:all 0.2s;opacity:0.5;">
                Criar Conta Gratuita →
              </button>

            </form>

            <div style="text-align:center;margin-top:20px;color:#64748B;font-size:0.82rem;">
              Já tem conta? <a href="/login" style="color:#10B981;text-decoration:none;font-weight:600;">Entrar agora</a>
            </div>

            <!-- Social proof -->
            <div style="text-align:center;margin-top:28px;padding-top:20px;border-top:1px solid rgba(255,255,255,0.06);">
              <div style="font-size:0.72rem;color:#334155;margin-bottom:8px;">Junte-se a pessoas que já transformaram suas finanças</div>
              <div style="display:flex;align-items:center;justify-content:center;gap:8px;">
                <div style="display:flex;">${['#10B981','#059669','#34D399','#6EE7B7','#A7F3D0'].map(c => `<div style="width:24px;height:24px;border-radius:50%;background:${c};border:2px solid #0F172A;margin-left:-6px;"></div>`).join('')}</div>
                <span style="font-size:0.75rem;color:#475569;">+2.400 usuários ativos</span>
              </div>
            </div>

          </div>
        </div>
      </div>

      <style>
        @media(max-width:768px){
          .auth-left-panel{display:none!important;}
          .auth-logo-mobile{display:flex!important;}
        }
        @media(min-width:769px){
          .auth-logo-mobile{display:none!important;}
        }
      </style>
    `

    // ── Validação de nome ────────────────────────────────────────────────────
    this.validateNomeCad = (input) => {
      const fb = document.getElementById('nome-feedback')
      if (input.value.trim().length < 3) {
        input.style.borderColor = '#F43F5E'
        fb.innerHTML = '<span style="color:#F43F5E;">⚠ Mínimo 3 caracteres</span>'
      } else {
        input.style.borderColor = '#10B981'
        fb.innerHTML = '<span style="color:#10B981;">✓ Nome válido</span>'
      }
      this._checkCadBtn()
    }

    // ── Validação de e-mail com debounce ────────────────────────────────────
    let emailTimer = null
    const emailInput = document.getElementById('cad-email')
    const emailFb    = document.getElementById('email-feedback')
    const emailIcon  = document.getElementById('email-icon')

    emailInput.addEventListener('input', () => {
      clearTimeout(emailTimer)
      const val = emailInput.value.trim()
      if (!val) { emailIcon.textContent = ''; emailFb.innerHTML = ''; this._checkCadBtn(); return }

      emailIcon.innerHTML = '⏳'
      emailInput.style.borderColor = '#334155'
      emailFb.innerHTML = '<span style="color:#64748B;">Verificando...</span>'

      emailTimer = setTimeout(async () => {
        try {
          const r = await axios.get(`/api/auth/check-email?email=${encodeURIComponent(val)}`)
          if (r.data.valid) {
            emailInput.style.borderColor = '#10B981'
            emailInput.style.boxShadow = '0 0 0 2px rgba(16,185,129,0.15)'
            emailIcon.textContent = '✅'
            emailFb.innerHTML = `<span style="color:#10B981;">${r.data.message}</span>`
            emailInput.dataset.valid = '1'
          } else {
            emailInput.style.borderColor = '#F43F5E'
            emailInput.style.boxShadow = '0 0 0 2px rgba(244,63,94,0.15)'
            emailIcon.textContent = '❌'
            emailFb.innerHTML = `<span style="color:#F43F5E;">${r.data.error}</span>`
            emailInput.dataset.valid = '0'
          }
        } catch {
          emailInput.dataset.valid = '0'
        }
        this._checkCadBtn()
      }, 500)
    })

    // ── Medidor de força da senha ────────────────────────────────────────────
    document.getElementById('cad-senha').addEventListener('input', (e) => {
      const senha = e.target.value
      const strengthEl = document.getElementById('senha-strength')
      const barsEl     = document.getElementById('strength-bars')
      const labelEl    = document.getElementById('strength-label')
      const critEl     = document.getElementById('strength-criteria')

      if (!senha) { strengthEl.style.display = 'none'; this._checkCadBtn(); return }
      strengthEl.style.display = 'block'

      const checks = [
        { ok: senha.length >= 8,           label: '8+ chars' },
        { ok: /[A-Z]/.test(senha),         label: 'Maiúscula' },
        { ok: /[0-9]/.test(senha),         label: 'Número' },
        { ok: /[^A-Za-z0-9]/.test(senha),  label: 'Especial' }
      ]
      const score = checks.filter(c => c.ok).length

      const levels = [
        { label: 'Muito fraca', color: '#F43F5E' },
        { label: 'Fraca',       color: '#F59E0B' },
        { label: 'Média',       color: '#F59E0B' },
        { label: 'Forte',       color: '#10B981' },
        { label: 'Muito forte', color: '#34D399' }
      ]
      const lvl = levels[score]

      barsEl.innerHTML = Array(4).fill(0).map((_, i) => `
        <div style="flex:1;height:4px;border-radius:2px;background:${i < score ? lvl.color : 'rgba(255,255,255,0.08)'};transition:all 0.3s;"></div>
      `).join('')
      labelEl.innerHTML = `<span style="color:${lvl.color};font-weight:600;">${lvl.label}</span>`
      critEl.innerHTML = checks.map(c => `
        <span style="color:${c.ok ? '#10B981' : '#334155'};transition:color 0.2s;">${c.ok ? '✓' : '·'} ${c.label}</span>
      `).join('')

      e.target.dataset.score = score
      e.target.style.borderColor = score >= 3 ? '#10B981' : '#F43F5E'
      this._checkCadBtn()
    })

    // ── Habilitar botão ──────────────────────────────────────────────────────
    this._checkCadBtn = () => {
      const nome   = document.getElementById('cad-nome')?.value.trim().length >= 3
      const email  = document.getElementById('cad-email')?.dataset.valid === '1'
      const senha  = parseInt(document.getElementById('cad-senha')?.dataset.score || '0') >= 2
      const termos = document.getElementById('cad-termos')?.checked
      const btn    = document.getElementById('cad-btn')
      if (btn) {
        const ok = nome && email && senha && termos
        btn.disabled = !ok
        btn.style.opacity = ok ? '1' : '0.5'
        btn.style.cursor  = ok ? 'pointer' : 'not-allowed'
        btn.style.background = ok ? '#10B981' : '#1E293B'
      }
    }

    document.getElementById('cad-termos').addEventListener('change', () => this._checkCadBtn())

    // ── Submit ───────────────────────────────────────────────────────────────
    document.getElementById('cadastro-form').addEventListener('submit', async (e) => {
      e.preventDefault()
      const btn    = document.getElementById('cad-btn')
      const errEl  = document.getElementById('auth-error')
      const email  = document.getElementById('cad-email').value.trim()
      const senha  = document.getElementById('cad-senha').value
      const nome   = document.getElementById('cad-nome').value.trim()

      errEl.style.display = 'none'
      btn.disabled = true
      btn.innerHTML = '⏳ Criando conta...'

      try {
        const res = await axios.post('/api/auth/register', { nome, email, senha })
        localStorage.setItem('vm_token', res.data.token)
        localStorage.setItem('vm_user', JSON.stringify(res.data.user))
        // Guardar e-mail + OTP dev para a tela de verificação
        localStorage.setItem('vm_pending_email', email)
        if (res.data._dev_otp) localStorage.setItem('vm_dev_otp', res.data._dev_otp)
        window.location.href = '/verificar-email'
      } catch (e) {
        errEl.textContent = e.response?.data?.error || 'Erro ao criar conta'
        errEl.style.display = 'block'
        btn.disabled = false
        btn.innerHTML = 'Criar Conta Gratuita →'
        btn.style.opacity = '1'
      }
    })
  },

  toggleSenha(inputId, btnId) {
    const input = document.getElementById(inputId)
    const btn = document.getElementById(btnId)
    if (input.type === 'password') {
      input.type = 'text'
      btn.innerHTML = '<i class="fas fa-eye-slash"></i>'
    } else {
      input.type = 'password'
      btn.innerHTML = '<i class="fas fa-eye"></i>'
    }
  },

  // ======= OTP VERIFICATION =======
  renderOTP() {
    const email = localStorage.getItem('vm_pending_email') || ''
    const devOTP = localStorage.getItem('vm_dev_otp') || ''
    if (!email) { window.location.href = '/cadastro'; return }

    document.getElementById('app').innerHTML = `
      <div style="min-height:100vh;background:#0F172A;display:flex;align-items:center;justify-content:center;padding:20px;font-family:'Inter',sans-serif;">

        <!-- Card central -->
        <div style="width:100%;max-width:440px;background:rgba(30,41,59,0.8);border:1px solid rgba(16,185,129,0.2);border-radius:24px;padding:40px 36px;backdrop-filter:blur(20px);box-shadow:0 25px 60px rgba(0,0,0,0.5);">

          <!-- Ícone animado -->
          <div style="text-align:center;margin-bottom:28px;">
            <div id="otp-icon-wrap" style="width:72px;height:72px;background:linear-gradient(135deg,rgba(16,185,129,0.15),rgba(16,185,129,0.05));border:2px solid rgba(16,185,129,0.3);border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 20px;font-size:2rem;transition:all 0.4s;">
              ✉️
            </div>
            <h2 style="font-size:1.5rem;font-weight:800;color:#F8FAFC;margin-bottom:8px;letter-spacing:-0.5px;">Verifique seu e-mail</h2>
            <p style="color:#64748B;font-size:0.87rem;line-height:1.6;">
              Enviamos um código de 6 dígitos para<br>
              <strong style="color:#10B981;">${email}</strong>
            </p>
          </div>

          <!-- Dev hint -->
          ${devOTP ? `<div style="background:rgba(16,185,129,0.06);border:1px solid rgba(16,185,129,0.2);border-radius:10px;padding:10px 14px;margin-bottom:20px;text-align:center;font-size:0.82rem;color:#34D399;font-family:'JetBrains Mono',monospace;">🔧 Dev mode — Código: <strong style="letter-spacing:4px;">${devOTP}</strong></div>` : ''}

          <!-- Alert erro/sucesso -->
          <div id="otp-alert" style="display:none;border-radius:10px;padding:10px 14px;margin-bottom:16px;font-size:0.83rem;"></div>

          <!-- 6 inputs OTP -->
          <div style="display:flex;gap:10px;justify-content:center;margin-bottom:24px;" id="otp-inputs">
            ${[0,1,2,3,4,5].map(i => `
              <input
                type="text"
                inputmode="numeric"
                maxlength="1"
                id="otp-${i}"
                autocomplete="one-time-code"
                style="width:48px;height:58px;text-align:center;font-size:1.5rem;font-weight:700;font-family:'JetBrains Mono',monospace;background:#0F172A;border:2px solid #1E293B;border-radius:14px;color:#F8FAFC;outline:none;transition:all 0.2s;caret-color:#10B981;"
                onfocus="this.style.borderColor='#10B981';this.style.boxShadow='0 0 0 3px rgba(16,185,129,0.2)';this.style.background='#0d1a2a'"
                onblur="this.style.boxShadow='none';this.style.background='#0F172A'"
              >
            `).join('')}
          </div>

          <!-- Botão verificar -->
          <button id="otp-btn" onclick="VM.submitOTP()"
            style="width:100%;padding:14px;background:linear-gradient(135deg,#10B981,#059669);border:none;border-radius:14px;color:#fff;font-size:0.95rem;font-weight:700;cursor:pointer;transition:all 0.2s;margin-bottom:16px;display:flex;align-items:center;justify-content:center;gap:8px;"
            onmouseover="this.style.transform='translateY(-1px)';this.style.boxShadow='0 8px 20px rgba(16,185,129,0.35)'"
            onmouseout="this.style.transform='none';this.style.boxShadow='none'">
            <span id="otp-btn-text">Verificar código ✓</span>
          </button>

          <!-- Reenviar -->
          <div style="text-align:center;">
            <span style="color:#64748B;font-size:0.83rem;">Não recebeu? </span>
            <button id="resend-btn" onclick="VM.resendOTP()"
              style="background:none;border:none;color:#10B981;font-size:0.83rem;font-weight:600;cursor:pointer;padding:0;"
              disabled>
              Reenviar em <span id="resend-countdown">60</span>s
            </button>
          </div>

          <!-- Trocar e-mail -->
          <div style="text-align:center;margin-top:16px;">
            <a href="/cadastro" style="color:#475569;font-size:0.78rem;text-decoration:none;"
              onmouseover="this.style.color='#94A3B8'" onmouseout="this.style.color='#475569'">
              ← Voltar e usar outro e-mail
            </a>
          </div>

          <!-- Expiração -->
          <div style="text-align:center;margin-top:20px;padding-top:16px;border-top:1px solid rgba(255,255,255,0.05);">
            <span style="color:#334155;font-size:0.75rem;">⏱ Código expira em </span>
            <span id="otp-expiry" style="color:#F59E0B;font-size:0.75rem;font-weight:600;font-family:'JetBrains Mono',monospace;">10:00</span>
          </div>
        </div>
      </div>
    `

    // ── Setup inputs OTP ─────────────────────────────────────────────────────
    const inputs = Array.from({length:6}, (_,i) => document.getElementById(`otp-${i}`))

    // Auto-paste: detecta quando user cola o código
    inputs[0].addEventListener('paste', (e) => {
      e.preventDefault()
      const text = (e.clipboardData || window.clipboardData).getData('text').replace(/\D/g,'').slice(0,6)
      if (text.length === 6) {
        text.split('').forEach((ch, i) => {
          inputs[i].value = ch
          inputs[i].style.borderColor = '#10B981'
        })
        inputs[5].focus()
        this._checkOTPComplete()
      }
    })

    inputs.forEach((inp, idx) => {
      inp.addEventListener('keydown', (e) => {
        if (e.key === 'Backspace') {
          if (!inp.value && idx > 0) {
            inputs[idx-1].value = ''
            inputs[idx-1].focus()
            inputs[idx-1].style.borderColor = '#1E293B'
          } else {
            inp.value = ''
            inp.style.borderColor = '#1E293B'
          }
          this._checkOTPComplete()
          return
        }
        if (e.key === 'ArrowLeft' && idx > 0) { inputs[idx-1].focus(); return }
        if (e.key === 'ArrowRight' && idx < 5) { inputs[idx+1].focus(); return }
        if (e.key === 'Enter') { this.submitOTP(); return }
      })

      inp.addEventListener('input', (e) => {
        const val = e.target.value.replace(/\D/g,'')
        e.target.value = val.slice(-1)
        if (val) {
          inp.style.borderColor = '#10B981'
          if (idx < 5) inputs[idx+1].focus()
        }
        this._checkOTPComplete()
      })
    })

    inputs[0].focus()

    // ── Countdown reenvio (60s) ──────────────────────────────────────────────
    let resendSec = 60
    const resendBtn = document.getElementById('resend-btn')
    const resendCD  = document.getElementById('resend-countdown')
    const resendTimer = setInterval(() => {
      resendSec--
      if (resendCD) resendCD.textContent = resendSec
      if (resendSec <= 0) {
        clearInterval(resendTimer)
        if (resendBtn) {
          resendBtn.disabled = false
          resendBtn.innerHTML = 'Reenviar código'
          resendBtn.style.textDecoration = 'underline'
        }
      }
    }, 1000)
    this._otpResendTimer = resendTimer

    // ── Countdown expiração (10min) ──────────────────────────────────────────
    let expirySec = 600
    const expiryEl = document.getElementById('otp-expiry')
    const expiryTimer = setInterval(() => {
      expirySec--
      if (expiryEl) {
        const m = Math.floor(expirySec/60).toString().padStart(2,'0')
        const s = (expirySec%60).toString().padStart(2,'0')
        expiryEl.textContent = `${m}:${s}`
        if (expirySec <= 60) expiryEl.style.color = '#F43F5E'
      }
      if (expirySec <= 0) {
        clearInterval(expiryTimer)
        if (expiryEl) expiryEl.textContent = 'EXPIRADO'
        this._showOTPAlert('Código expirado. Solicite um novo.', 'error')
      }
    }, 1000)
    this._otpExpiryTimer = expiryTimer
  },

  _checkOTPComplete() {
    const inputs = Array.from({length:6}, (_,i) => document.getElementById(`otp-${i}`))
    const code = inputs.map(i => i?.value || '').join('')
    const btn = document.getElementById('otp-btn')
    if (btn) {
      const ok = code.length === 6
      btn.style.opacity = ok ? '1' : '0.6'
    }
  },

  _showOTPAlert(msg, type) {
    const el = document.getElementById('otp-alert')
    if (!el) return
    const styles = {
      error:   'background:rgba(244,63,94,0.1);border:1px solid rgba(244,63,94,0.3);color:#F43F5E;',
      success: 'background:rgba(16,185,129,0.1);border:1px solid rgba(16,185,129,0.3);color:#10B981;',
      warning: 'background:rgba(245,158,11,0.1);border:1px solid rgba(245,158,11,0.3);color:#F59E0B;'
    }
    el.style.cssText = (styles[type] || styles.error) + 'display:block;border-radius:10px;padding:10px 14px;margin-bottom:16px;font-size:0.83rem;'
    el.textContent = msg
  },

  async submitOTP() {
    const inputs = Array.from({length:6}, (_,i) => document.getElementById(`otp-${i}`))
    const code = inputs.map(i => i?.value || '').join('')
    if (code.length < 6) { this._showOTPAlert('Preencha todos os 6 dígitos.', 'warning'); return }

    const email = localStorage.getItem('vm_pending_email') || ''
    const btn = document.getElementById('otp-btn')
    const btnTxt = document.getElementById('otp-btn-text')

    btn.disabled = true
    if (btnTxt) btnTxt.innerHTML = '⏳ Verificando...'

    try {
      const res = await axios.post('/api/auth/verify-otp', { email, code })
      // Atualizar token e user
      if (res.data.token) {
        localStorage.setItem('vm_token', res.data.token)
        localStorage.setItem('vm_login_at', Date.now().toString())
        this.token = res.data.token
      }
      if (res.data.user) {
        localStorage.setItem('vm_user', JSON.stringify(res.data.user))
        this.user = res.data.user
      }
      localStorage.removeItem('vm_pending_email')
      localStorage.removeItem('vm_dev_otp')

      // Sucesso visual
      const iconWrap = document.getElementById('otp-icon-wrap')
      if (iconWrap) {
        iconWrap.textContent = '✅'
        iconWrap.style.borderColor = '#10B981'
        iconWrap.style.background = 'rgba(16,185,129,0.2)'
      }
      inputs.forEach(i => { if (i) { i.style.borderColor = '#10B981'; i.style.background = 'rgba(16,185,129,0.05)' } })
      this._showOTPAlert('E-mail verificado com sucesso! Redirecionando...', 'success')
      clearInterval(this._otpResendTimer)
      clearInterval(this._otpExpiryTimer)

      setTimeout(() => { window.location.href = '/onboarding' }, 1200)
    } catch (err) {
      const msg = err.response?.data?.error || 'Código inválido. Tente novamente.'
      this._showOTPAlert(msg, 'error')
      // Shake visual nos inputs
      inputs.forEach(i => {
        if (i) { i.style.borderColor = '#F43F5E'; i.style.animation = 'shake 0.3s ease' }
      })
      setTimeout(() => inputs.forEach(i => { if (i) { i.style.animation = '' } }), 400)
      btn.disabled = false
      if (btnTxt) btnTxt.innerHTML = 'Verificar código ✓'
    }
  },

  async resendOTP() {
    const email = localStorage.getItem('vm_pending_email') || ''
    const resendBtn = document.getElementById('resend-btn')
    const resendCD  = document.getElementById('resend-countdown')
    if (!email) return

    if (resendBtn) { resendBtn.disabled = true; resendBtn.innerHTML = '⏳ Enviando...' }

    try {
      const res = await axios.post('/api/auth/resend-otp', { email })
      if (res.data._dev_otp) localStorage.setItem('vm_dev_otp', res.data._dev_otp)
      this._showOTPAlert('Novo código enviado! Verifique sua caixa de entrada.', 'success')

      // Reiniciar countdown
      let resendSec = 60
      if (resendCD) resendCD.textContent = resendSec
      if (resendBtn) resendBtn.innerHTML = `Reenviar em <span id="resend-countdown">60</span>s`

      const timer = setInterval(() => {
        resendSec--
        const cd = document.getElementById('resend-countdown')
        if (cd) cd.textContent = resendSec
        if (resendSec <= 0) {
          clearInterval(timer)
          const rb = document.getElementById('resend-btn')
          if (rb) { rb.disabled = false; rb.innerHTML = 'Reenviar código'; rb.style.textDecoration = 'underline' }
        }
      }, 1000)
    } catch (err) {
      const msg = err.response?.data?.error || 'Erro ao reenviar. Tente novamente.'
      this._showOTPAlert(msg, 'error')
      if (resendBtn) { resendBtn.disabled = false; resendBtn.innerHTML = 'Reenviar código' }
    }
  },

  // ======= APP =======
  renderApp() {
    const userName = this.user?.nome?.split(' ')[0] || 'Usuário'
    const avatarColor = this.user?.avatar_color || '#2FBF71'
    const initials = (this.user?.nome || 'U').split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase()

    document.getElementById('app').innerHTML = `
      <div class="app-layout">
        <!-- SIDEBAR -->
        <aside class="sidebar" id="sidebar">
          <div class="sidebar-logo">
            <div class="sidebar-logo-icon">💚</div>
            <span style="font-size:1.2rem;font-weight:800;" class="gradient-text">VerdeMais</span>
          </div>
          
          <nav style="overflow-y:auto;flex:1;padding-bottom:8px;" id="sidebar-nav">

            <!-- ── GRUPO 1: PRINCIPAL ──────────────────────── -->
            <div class="nav-group-header" onclick="VM.toggleNavGroup('grp-principal')" style="display:flex;align-items:center;justify-content:space-between;font-size:0.68rem;color:#64748b;letter-spacing:1.5px;text-transform:uppercase;padding:8px 14px;font-weight:700;cursor:pointer;user-select:none;transition:color 0.2s;" onmouseover="this.style.color='#2FBF71'" onmouseout="this.style.color='#64748b'">
              <span>Principal</span><i class="fas fa-chevron-down" id="chevron-grp-principal" style="font-size:0.6rem;transition:transform 0.25s;"></i>
            </div>
            <div id="grp-principal" class="nav-group-items">
              <a class="nav-item active" id="nav-dashboard" onclick="VM.navigate('dashboard')">
                <span class="nav-icon"><i class="fas fa-chart-pie"></i></span> Dashboard
              </a>
              <a class="nav-item" id="nav-receitas" onclick="VM.navigate('receitas')">
                <span class="nav-icon"><i class="fas fa-arrow-up" style="color:#2FBF71;"></i></span> Receitas
              </a>
              <a class="nav-item" id="nav-despesas" onclick="VM.navigate('despesas')">
                <span class="nav-icon"><i class="fas fa-arrow-down" style="color:#ff6b6b;"></i></span> Despesas
              </a>
              <a class="nav-item" id="nav-cartoes" onclick="VM.navigate('cartoes')">
                <span class="nav-icon"><i class="fas fa-credit-card" style="color:#74b9ff;"></i></span> Cartões
              </a>
            </div>

            <!-- ── GRUPO 2: PLANEJAMENTO ───────────────────── -->
            <div class="nav-group-header" onclick="VM.toggleNavGroup('grp-planejamento')" style="display:flex;align-items:center;justify-content:space-between;font-size:0.68rem;color:#64748b;letter-spacing:1.5px;text-transform:uppercase;padding:8px 14px;font-weight:700;cursor:pointer;user-select:none;transition:color 0.2s;" onmouseover="this.style.color='#2FBF71'" onmouseout="this.style.color='#64748b'">
              <span>Planejamento</span><i class="fas fa-chevron-down" id="chevron-grp-planejamento" style="font-size:0.6rem;transition:transform 0.25s;"></i>
            </div>
            <div id="grp-planejamento" class="nav-group-items">
              <a class="nav-item" id="nav-metas" onclick="VM.navigate('metas')">
                <span class="nav-icon"><i class="fas fa-bullseye" style="color:#f59e0b;"></i></span> Metas
              </a>
              <a class="nav-item" id="nav-orcamentos" onclick="VM.navigate('orcamentos')">
                <span class="nav-icon"><i class="fas fa-sliders-h" style="color:#a78bfa;"></i></span> Orçamentos
              </a>
              <a class="nav-item" id="nav-recorrencias" onclick="VM.navigate('recorrencias')">
                <span class="nav-icon"><i class="fas fa-sync-alt" style="color:#60a5fa;"></i></span> Recorrências
              </a>
              <a class="nav-item" id="nav-lembretes" onclick="VM.navigate('lembretes')">
                <span class="nav-icon"><i class="fas fa-bell" style="color:#fbbf24;"></i></span> Lembretes
                <span id="badge-lembretes" style="display:none;margin-left:auto;background:#ffc400;color:#000;font-size:0.65rem;padding:2px 7px;border-radius:50px;font-weight:700;"></span>
              </a>
              <a class="nav-item" id="nav-desafio-52" onclick="VM.navigate('desafio-52')">
                <span class="nav-icon">🎯</span> Desafio 52 Semanas
              </a>
            </div>

            <!-- ── GRUPO 3: PATRIMÔNIO & DÍVIDAS ──────────── -->
            <div class="nav-group-header" onclick="VM.toggleNavGroup('grp-patrimonio')" style="display:flex;align-items:center;justify-content:space-between;font-size:0.68rem;color:#64748b;letter-spacing:1.5px;text-transform:uppercase;padding:8px 14px;font-weight:700;cursor:pointer;user-select:none;transition:color 0.2s;" onmouseover="this.style.color='#2FBF71'" onmouseout="this.style.color='#64748b'">
              <span>Patrimônio & Dívidas</span><i class="fas fa-chevron-down" id="chevron-grp-patrimonio" style="font-size:0.6rem;transition:transform 0.25s;"></i>
            </div>
            <div id="grp-patrimonio" class="nav-group-items">
              <a class="nav-item" id="nav-investimentos" onclick="VM.navigate('investimentos')">
                <span class="nav-icon"><i class="fas fa-chart-line" style="color:#34d399;"></i></span> Investimentos
              </a>
              <a class="nav-item" id="nav-reserva" onclick="VM.navigate('reserva')">
                <span class="nav-icon"><i class="fas fa-shield-alt" style="color:#2FBF71;"></i></span> Reserva de Emergência
              </a>
              <a class="nav-item" id="nav-reservas-esp" onclick="VM.navigate('reservas-esp')">
                <span class="nav-icon">🛡️</span> Minhas Reservas
              </a>
              <a class="nav-item" id="nav-financiamentos" onclick="VM.navigate('financiamentos')">
                <span class="nav-icon"><i class="fas fa-home" style="color:#fb923c;"></i></span> Financiamentos
              </a>
              <a class="nav-item" id="nav-emprestimos" onclick="VM.navigate('emprestimos')">
                <span class="nav-icon"><i class="fas fa-hand-holding-usd" style="color:#f87171;"></i></span> Empréstimos
              </a>
            </div>

            <!-- ── GRUPO 4: ANÁLISES ───────────────────────── -->
            <div class="nav-group-header" onclick="VM.toggleNavGroup('grp-analises')" style="display:flex;align-items:center;justify-content:space-between;font-size:0.68rem;color:#64748b;letter-spacing:1.5px;text-transform:uppercase;padding:8px 14px;font-weight:700;cursor:pointer;user-select:none;transition:color 0.2s;" onmouseover="this.style.color='#2FBF71'" onmouseout="this.style.color='#64748b'">
              <span>Análises</span><i class="fas fa-chevron-down" id="chevron-grp-analises" style="font-size:0.6rem;transition:transform 0.25s;"></i>
            </div>
            <div id="grp-analises" class="nav-group-items">
              <a class="nav-item" id="nav-ia" onclick="VM.navigate('ia')">
                <span class="nav-icon"><i class="fas fa-brain" style="color:#c084fc;"></i></span> Diagnóstico 360° ✨
              </a>
              <a class="nav-item" id="nav-projecao" onclick="VM.navigate('projecao')">
                <span class="nav-icon"><i class="fas fa-chart-area" style="color:#818cf8;"></i></span> Projeção Financeira
              </a>
              <a class="nav-item" id="nav-comparativo" onclick="VM.navigate('comparativo')">
                <span class="nav-icon"><i class="fas fa-exchange-alt" style="color:#67e8f9;"></i></span> Comparativo Mensal
              </a>
              <a class="nav-item" id="nav-relatorios" onclick="VM.navigate('relatorios')">
                <span class="nav-icon"><i class="fas fa-file-alt" style="color:#94a3b8;"></i></span> Relatórios
              </a>
              <a class="nav-item" id="nav-simulacao" onclick="VM.navigate('simulacao')">
                <span class="nav-icon"><i class="fas fa-calculator" style="color:#fcd34d;"></i></span> Simulações
              </a>
              <a class="nav-item" id="nav-regra-503020" onclick="VM.navigate('regra-503020')">
                <span class="nav-icon">⚖️</span> Regra 50/30/20
              </a>
              <a class="nav-item" id="nav-amortizacao" onclick="VM.navigate('amortizacao')">
                <span class="nav-icon">🏦</span> Simulador Amortização
              </a>
            </div>

            <!-- ── GRUPO 5: INTELIGÊNCIA ───────────────────── -->
            <div class="nav-group-header" onclick="VM.toggleNavGroup('grp-inteligencia')" style="display:flex;align-items:center;justify-content:space-between;font-size:0.68rem;color:#64748b;letter-spacing:1.5px;text-transform:uppercase;padding:8px 14px;font-weight:700;cursor:pointer;user-select:none;transition:color 0.2s;" onmouseover="this.style.color='#2FBF71'" onmouseout="this.style.color='#64748b'">
              <span>Inteligência</span><i class="fas fa-chevron-down" id="chevron-grp-inteligencia" style="font-size:0.6rem;transition:transform 0.25s;"></i>
            </div>
            <div id="grp-inteligencia" class="nav-group-items">
              <a class="nav-item" id="nav-assistente" onclick="VM.navigate('assistente')">
                <span class="nav-icon">🤖</span> Assistente IA
              </a>
              <a class="nav-item" id="nav-assinaturas-fantasma" onclick="VM.navigate('assinaturas-fantasma')">
                <span class="nav-icon">👻</span> Assinaturas Fantasma
              </a>
              <a class="nav-item" id="nav-compras-fantasma" onclick="VM.navigate('compras-fantasma')">
                <span class="nav-icon">🛍️</span> Compras Fantasma
              </a>
              <a class="nav-item" id="nav-tags" onclick="VM.navigate('tags')">
                <span class="nav-icon"><i class="fas fa-tags" style="color:#a3e635;"></i></span> Tags & Filtros
              </a>
              <a class="nav-item" id="nav-alertas-cartao" onclick="VM.navigate('alertas-cartao')">
                <span class="nav-icon"><i class="fas fa-exclamation-triangle" style="color:#fb923c;"></i></span> Alertas de Cartão
                <span id="badge-alertas-cartao" style="display:none;margin-left:auto;background:#F43F5E;color:#fff;font-size:0.65rem;padding:2px 7px;border-radius:50px;font-weight:700;"></span>
              </a>
              <a class="nav-item" id="nav-importacao" onclick="VM.navigate('importacao')">
                <span class="nav-icon"><i class="fas fa-file-import" style="color:#38bdf8;"></i></span> Importar CSV
              </a>
            </div>

            <!-- ── GRUPO 6: PERFIL & CONQUISTAS ───────────── -->
            <div class="nav-group-header" onclick="VM.toggleNavGroup('grp-perfil')" style="display:flex;align-items:center;justify-content:space-between;font-size:0.68rem;color:#64748b;letter-spacing:1.5px;text-transform:uppercase;padding:8px 14px;font-weight:700;cursor:pointer;user-select:none;transition:color 0.2s;" onmouseover="this.style.color='#2FBF71'" onmouseout="this.style.color='#64748b'">
              <span>Conquistas</span><i class="fas fa-chevron-down" id="chevron-grp-perfil" style="font-size:0.6rem;transition:transform 0.25s;"></i>
            </div>
            <div id="grp-perfil" class="nav-group-items">
              <a class="nav-item" id="nav-conquistas" onclick="VM.navigate('conquistas')">
                <span class="nav-icon"><i class="fas fa-trophy" style="color:#fbbf24;"></i></span> Conquistas
                <span id="badge-conquistas" style="display:none;margin-left:auto;background:#2FBF71;color:#000;font-size:0.65rem;padding:2px 7px;border-radius:50px;font-weight:700;"></span>
              </a>
            </div>

          </nav>
          
          <div class="sidebar-user" onclick="VM.navigate('perfil')">
            <div style="display:flex;align-items:center;gap:10px;">
              <div style="width:36px;height:36px;background:${avatarColor};border-radius:10px;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:0.9rem;flex-shrink:0;">${initials}</div>
              <div style="flex:1;min-width:0;">
                <div style="font-size:0.85rem;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${userName}</div>
                <div style="font-size:0.72rem;color:#666;">${this.user?.plano || 'Free'}</div>
              </div>
              <i class="fas fa-cog" style="color:#555;font-size:0.75rem;"></i>
            </div>
          </div>
        </aside>

        <!-- MAIN -->
        <div class="main-content">
          <header class="topbar">
            <div style="display:flex;align-items:center;gap:16px;">
              <button onclick="document.getElementById('sidebar').classList.toggle('open')" 
                style="background:none;border:none;color:#888;font-size:1.1rem;cursor:pointer;" id="menu-btn">
                <i class="fas fa-bars"></i>
              </button>
              <div>
                <div style="font-size:1rem;font-weight:600;" id="page-title">Dashboard</div>
                <div style="color:#555;font-size:0.75rem;" id="page-sub">Visão geral das suas finanças</div>
              </div>
            </div>
            <div style="display:flex;align-items:center;gap:12px;">
              <div style="font-size:0.8rem;color:#555;" id="topbar-date"></div>
              <!-- Bell de alertas de cartão -->
              <button onclick="VM.navigate('alertas-cartao')" id="btn-bell-alertas"
                title="Alertas de Cartão"
                style="position:relative;background:none;border:none;color:#666;font-size:1rem;cursor:pointer;padding:6px;border-radius:8px;transition:all 0.2s;"
                onmouseover="this.style.background='rgba(255,255,255,0.06)';this.style.color='#F59E0B'"
                onmouseout="this.style.background='none';this.style.color='#666'">
                <i class="fas fa-bell"></i>
                <span id="topbar-badge-alertas" style="display:none;position:absolute;top:2px;right:2px;background:#F43F5E;color:#fff;font-size:0.55rem;padding:1px 4px;border-radius:50px;font-weight:700;min-width:14px;text-align:center;"></span>
              </button>
              <button onclick="VM.logout()" class="btn-secondary" style="font-size:0.8rem;padding:8px 14px;">
                <i class="fas fa-sign-out-alt"></i>
              </button>
            </div>
          </header>
          
          <main class="page-content" id="page-content">
            <div class="empty-state">
              <div class="empty-icon">💚</div>
              <h3>Carregando...</h3>
            </div>
          </main>
        </div>
      </div>
      
      <!-- BLOCO 9: Sidebar Overlay (toque para fechar no mobile) -->
      <div class="sidebar-overlay" id="sidebar-overlay" onclick="VM.closeSidebar()"></div>

      <!-- BLOCO 9: Bottom Navigation Bar (mobile) -->
      <nav class="bottom-nav" id="bottom-nav">
        <button class="bottom-nav-item" id="bnav-dashboard" onclick="VM.navigate('dashboard')">
          <i class="fas fa-home"></i>
          <span>Início</span>
        </button>
        <button class="bottom-nav-item" id="bnav-despesas" onclick="VM.navigate('despesas')">
          <i class="fas fa-minus-circle"></i>
          <span>Despesas</span>
        </button>
        <!-- Botão central de lançamento rápido -->
        <button class="bottom-nav-item bottom-nav-fab" onclick="VM.abrirLancamentoRapido()" title="Lançamento rápido" style="position:relative;top:-16px;">
          <div style="width:52px;height:52px;background:linear-gradient(135deg,#2FBF71,#059669);border-radius:50%;display:flex;align-items:center;justify-content:center;box-shadow:0 4px 16px rgba(47,191,113,0.45);border:3px solid var(--bg-main,#0f172a);">
            <i class="fas fa-plus" style="color:#fff;font-size:1.2rem;"></i>
          </div>
          <span style="margin-top:2px;">Lançar</span>
        </button>
        <button class="bottom-nav-item" id="bnav-metas" onclick="VM.navigate('metas')">
          <i class="fas fa-bullseye"></i>
          <span>Metas</span>
        </button>
        <button class="bottom-nav-item" id="bnav-menu" onclick="VM.toggleSidebarMobile()">
          <i class="fas fa-th-large"></i>
          <span>Menu</span>
        </button>
      </nav>

      <div id="toast-container" class="toast-container"></div>
      <div id="modal-container"></div>

      <!-- BLOCO 6.5: Widget de Chat Flutuante -->
      <div id="chat-widget" style="display:none;position:fixed;bottom:90px;right:20px;z-index:1000;width:340px;max-height:480px;background:var(--bg-card,#fff);border-radius:16px;box-shadow:0 8px 32px rgba(0,0,0,0.18);flex-direction:column;overflow:hidden;">
        <div style="background:linear-gradient(135deg,#10B981,#059669);padding:14px 16px;display:flex;align-items:center;justify-content:space-between;flex-shrink:0;">
          <div style="display:flex;align-items:center;gap:10px;">
            <div style="width:36px;height:36px;background:rgba(255,255,255,0.2);border-radius:50%;display:flex;align-items:center;justify-content:center;">
              <i class="fas fa-robot" style="color:#fff;font-size:1rem;"></i>
            </div>
            <div>
              <div style="color:#fff;font-weight:700;font-size:0.9rem;">Assistente VerdeMais</div>
              <div style="color:rgba(255,255,255,0.8);font-size:0.72rem;">IA Financeira Pessoal</div>
            </div>
          </div>
          <button onclick="VM.toggleChat()" style="background:rgba(255,255,255,0.2);border:none;color:#fff;width:28px;height:28px;border-radius:50%;cursor:pointer;display:flex;align-items:center;justify-content:center;">
            <i class="fas fa-times" style="font-size:0.8rem;"></i>
          </button>
        </div>
        <div id="chat-widget-messages" style="flex:1;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:8px;max-height:300px;min-height:200px;background:var(--bg-main,#f8fafc);">
          <div id="chat-welcome" style="text-align:center;padding:16px 8px;">
            <div style="font-size:2rem;margin-bottom:8px;">🤖</div>
            <div style="font-weight:600;font-size:0.88rem;color:var(--text-main,#1e293b);margin-bottom:4px;">Olá! Sou seu assistente financeiro.</div>
            <div style="font-size:0.78rem;color:var(--text-muted,#64748b);">Pergunte sobre saldo, metas, gastos ou investimentos.</div>
          </div>
        </div>
        <div id="chat-sugestoes" style="padding:6px 12px;display:flex;gap:6px;flex-wrap:wrap;background:var(--bg-card,#fff);border-top:1px solid var(--border-color,#e2e8f0);">
          <button onclick="VM.chatEnviar('Qual meu saldo?')" class="chat-sugestao-btn">💰 Saldo</button>
          <button onclick="VM.chatEnviar('Resumo do mês')" class="chat-sugestao-btn">📊 Resumo</button>
          <button onclick="VM.chatEnviar('Como estão minhas metas?')" class="chat-sugestao-btn">🎯 Metas</button>
        </div>
        <div style="padding:10px 12px;border-top:1px solid var(--border-color,#e2e8f0);display:flex;gap:8px;background:var(--bg-card,#fff);flex-shrink:0;">
          <input id="chat-widget-input" type="text" placeholder="Digite sua pergunta..." maxlength="500"
            style="flex:1;border:1px solid var(--border-color,#e2e8f0);border-radius:20px;padding:8px 14px;font-size:0.83rem;outline:none;background:var(--bg-main,#f8fafc);color:var(--text-main,#1e293b);"
            onkeydown="if(event.key==='Enter')VM.chatEnviarInput()" />
          <button onclick="VM.chatEnviarInput()" style="width:36px;height:36px;border-radius:50%;background:#10B981;border:none;color:#fff;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;">
            <i class="fas fa-paper-plane" style="font-size:0.8rem;"></i>
          </button>
        </div>
      </div>
      <!-- BLOCO 6.5: Botão flutuante para abrir o chat -->
      <button id="chat-fab" onclick="VM.toggleChat()" title="Assistente IA" style="position:fixed;bottom:90px;right:20px;z-index:999;width:52px;height:52px;border-radius:50%;background:linear-gradient(135deg,#10B981,#059669);border:none;color:#fff;cursor:pointer;box-shadow:0 4px 16px rgba(16,185,129,0.4);display:flex;align-items:center;justify-content:center;transition:transform 0.2s;">
        <i class="fas fa-robot" style="font-size:1.3rem;"></i>
        <span id="chat-badge" style="display:none;position:absolute;top:-2px;right:-2px;width:14px;height:14px;background:#ef4444;border-radius:50%;border:2px solid #fff;"></span>
      </button>
    `

    // Date
    const now = new Date()
    document.getElementById('topbar-date').textContent = now.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })

    // Route
    const path = window.location.pathname
    const page = path.replace('/app/', '').replace('/app', '') || 'dashboard'
    this.navigate(page || 'dashboard')

    // Carregar badges
    this.carregarBadges()

    // Agendar notificações locais dos lembretes (se permissão já concedida)
    setTimeout(() => this.agendarNotificacoesLembretes(), 3000)

    // BLOCO 9: Hamburger toggle com overlay
    const menuBtn = document.getElementById('menu-btn')
    if (menuBtn) {
      menuBtn.onclick = () => VM.toggleSidebar()
    }
  },

  // BLOCO 9: Controle da sidebar mobile
  toggleSidebar() {
    const sidebar = document.getElementById('sidebar')
    const overlay = document.getElementById('sidebar-overlay')
    if (!sidebar) return
    const isOpen = sidebar.classList.contains('open')
    if (isOpen) {
      this.closeSidebar()
    } else {
      sidebar.classList.add('open')
      if (overlay) overlay.classList.add('visible')
      document.body.style.overflow = 'hidden'
    }
  },

  closeSidebar() {
    const sidebar = document.getElementById('sidebar')
    const overlay = document.getElementById('sidebar-overlay')
    if (sidebar) sidebar.classList.remove('open')
    if (overlay) overlay.classList.remove('visible')
    document.body.style.overflow = ''
  },

  // ── Grupos colapsáveis da sidebar ────────────────────────────────────────
  _navGroupsCollapsed: {},

  toggleNavGroup(groupId) {
    const el = document.getElementById(groupId)
    const chevron = document.getElementById('chevron-' + groupId)
    if (!el) return
    const isCollapsed = this._navGroupsCollapsed[groupId]
    if (isCollapsed) {
      el.style.maxHeight = el.scrollHeight + 'px'
      el.style.opacity = '1'
      if (chevron) chevron.style.transform = 'rotate(0deg)'
      this._navGroupsCollapsed[groupId] = false
    } else {
      el.style.maxHeight = '0'
      el.style.opacity = '0'
      if (chevron) chevron.style.transform = 'rotate(-90deg)'
      this._navGroupsCollapsed[groupId] = true
    }
  },

  // ── Mobile: abre sidebar pelo botão Menu do bottom nav ───────────────────
  toggleSidebarMobile() {
    const sidebar = document.getElementById('sidebar')
    if (!sidebar) return
    if (sidebar.classList.contains('open')) {
      this.closeSidebar()
    } else {
      this.toggleSidebar()
    }
  },

  // ── Lançamento Rápido ─────────────────────────────────────────────────────
  abrirLancamentoRapido() {
    const categoriasDespesa = ['Alimentação','Transporte','Moradia','Saúde','Educação','Lazer','Vestuário','Streaming','Outros']
    const categoriasReceita = ['Salário','Freelance','Investimentos','Aluguel','Outros']
    this.showModal(`
      <div style="padding:4px 0;">
        <h3 style="margin:0 0 16px;font-size:1.1rem;font-weight:700;display:flex;align-items:center;gap:8px;">
          <span style="width:32px;height:32px;background:linear-gradient(135deg,#2FBF71,#059669);border-radius:8px;display:flex;align-items:center;justify-content:center;"><i class="fas fa-bolt" style="color:#fff;font-size:0.85rem;"></i></span>
          Lançamento Rápido
        </h3>
        <!-- Tipo -->
        <div style="display:flex;gap:8px;margin-bottom:16px;">
          <button id="lr-tipo-despesa" onclick="VM._lrTipo('despesa')" style="flex:1;padding:10px;border-radius:10px;border:2px solid #ff6b6b;background:rgba(255,107,107,0.15);color:#ff6b6b;font-weight:700;cursor:pointer;transition:all 0.2s;">
            <i class="fas fa-arrow-down"></i> Despesa
          </button>
          <button id="lr-tipo-receita" onclick="VM._lrTipo('receita')" style="flex:1;padding:10px;border-radius:10px;border:2px solid #374151;background:transparent;color:#888;font-weight:700;cursor:pointer;transition:all 0.2s;">
            <i class="fas fa-arrow-up"></i> Receita
          </button>
        </div>
        <!-- Valor -->
        <div style="margin-bottom:12px;">
          <label style="font-size:0.78rem;color:#888;font-weight:600;">VALOR (R$)</label>
          <input type="number" id="lr-valor" placeholder="0,00" step="0.01" min="0.01"
            style="width:100%;margin-top:4px;padding:12px;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:10px;color:inherit;font-size:1.3rem;font-weight:700;text-align:center;"
            onkeydown="if(event.key==='Enter')VM._lrSalvar()" autofocus>
        </div>
        <!-- Descrição -->
        <div style="margin-bottom:12px;">
          <label style="font-size:0.78rem;color:#888;font-weight:600;">DESCRIÇÃO</label>
          <input type="text" id="lr-desc" placeholder="Ex: Almoço, Uber, Salário..."
            style="width:100%;margin-top:4px;padding:10px;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:10px;color:inherit;font-size:0.9rem;"
            onkeydown="if(event.key==='Enter')VM._lrSalvar()">
        </div>
        <!-- Categoria -->
        <div style="margin-bottom:12px;">
          <label style="font-size:0.78rem;color:#888;font-weight:600;">CATEGORIA</label>
          <select id="lr-cat" style="width:100%;margin-top:4px;padding:10px;background:rgba(30,41,59,0.9);border:1px solid rgba(255,255,255,0.1);border-radius:10px;color:inherit;font-size:0.9rem;">
            ${categoriasDespesa.map(c => `<option value="${c}">${c}</option>`).join('')}
          </select>
        </div>
        <!-- Data -->
        <div style="margin-bottom:20px;">
          <label style="font-size:0.78rem;color:#888;font-weight:600;">DATA</label>
          <input type="date" id="lr-data" value="${new Date().toISOString().slice(0,10)}"
            style="width:100%;margin-top:4px;padding:10px;background:rgba(30,41,59,0.9);border:1px solid rgba(255,255,255,0.1);border-radius:10px;color:inherit;font-size:0.9rem;">
        </div>
        <!-- Botão salvar -->
        <button onclick="VM._lrSalvar()" style="width:100%;padding:14px;background:linear-gradient(135deg,#2FBF71,#059669);color:#fff;border:none;border-radius:12px;font-size:1rem;font-weight:700;cursor:pointer;transition:all 0.2s;display:flex;align-items:center;justify-content:center;gap:8px;">
          <i class="fas fa-check"></i> Salvar Lançamento
        </button>
        <p style="text-align:center;font-size:0.72rem;color:#555;margin-top:10px;"><i class="fas fa-keyboard"></i> Pressione Enter para salvar</p>
      </div>
    `)
    this._lrTipoAtual = 'despesa'
    setTimeout(() => document.getElementById('lr-valor')?.focus(), 100)
  },

  _lrTipoAtual: 'despesa',

  _lrTipo(tipo) {
    this._lrTipoAtual = tipo
    const catSelect = document.getElementById('lr-cat')
    const btnDesp = document.getElementById('lr-tipo-despesa')
    const btnRec = document.getElementById('lr-tipo-receita')
    const categoriasDespesa = ['Alimentação','Transporte','Moradia','Saúde','Educação','Lazer','Vestuário','Streaming','Outros']
    const categoriasReceita = ['Salário','Freelance','Investimentos','Aluguel','Outros']
    if (tipo === 'despesa') {
      if (btnDesp) { btnDesp.style.borderColor='#ff6b6b'; btnDesp.style.background='rgba(255,107,107,0.15)'; btnDesp.style.color='#ff6b6b' }
      if (btnRec)  { btnRec.style.borderColor='#374151'; btnRec.style.background='transparent'; btnRec.style.color='#888' }
      if (catSelect) catSelect.innerHTML = categoriasDespesa.map(c => `<option value="${c}">${c}</option>`).join('')
    } else {
      if (btnRec)  { btnRec.style.borderColor='#2FBF71'; btnRec.style.background='rgba(47,191,113,0.15)'; btnRec.style.color='#2FBF71' }
      if (btnDesp) { btnDesp.style.borderColor='#374151'; btnDesp.style.background='transparent'; btnDesp.style.color='#888' }
      if (catSelect) catSelect.innerHTML = categoriasReceita.map(c => `<option value="${c}">${c}</option>`).join('')
    }
  },

  async _lrSalvar() {
    const valor = parseFloat(document.getElementById('lr-valor')?.value || '0')
    const desc  = (document.getElementById('lr-desc')?.value || '').trim()
    const cat   = document.getElementById('lr-cat')?.value || 'Outros'
    const data  = document.getElementById('lr-data')?.value || new Date().toISOString().slice(0,10)
    if (!valor || valor <= 0) { this.toast('Informe um valor válido', 'error'); return }
    if (!desc) { this.toast('Informe uma descrição', 'error'); return }
    try {
      if (this._lrTipoAtual === 'despesa') {
        await this.api('despesas', { method:'POST', body: JSON.stringify({ descricao:desc, valor, categoria:cat, data, status:'pago', tipo:'normal' }) })
      } else {
        await this.api('receitas', { method:'POST', body: JSON.stringify({ descricao:desc, valor, categoria:cat, data, tipo:'outros' }) })
      }
      this.closeModal()
      this.toast(`✅ ${this._lrTipoAtual === 'despesa' ? 'Despesa' : 'Receita'} lançada com sucesso!`)
      if (this.currentPage === 'dashboard') this.renderDashboard()
      else if (this.currentPage === 'despesas') this.carregarDespesas()
      else if (this.currentPage === 'receitas') this.carregarReceitas()
    } catch(e) {
      this.toast('Erro ao salvar lançamento', 'error')
    }
  },

  // ── BLOCO 6.5: Widget de Chat Flutuante ──────────────────────────────────
  _chatAberto: false,

  toggleChat() {
    const widget = document.getElementById('chat-widget')
    const fab = document.getElementById('chat-fab')
    this._chatAberto = !this._chatAberto
    if (widget) widget.style.display = this._chatAberto ? 'flex' : 'none'
    if (fab) fab.style.display = this._chatAberto ? 'none' : 'flex'
    if (this._chatAberto) {
      this.chatCarregarHistorico()
      setTimeout(() => {
        const input = document.getElementById('chat-widget-input')
        if (input) input.focus()
      }, 200)
    }
  },

  async chatCarregarHistorico() {
    try {
      const data = await this.api('GET', 'chat/historico')
      const msgs = data.historico || []
      if (msgs.length === 0) return
      const container = document.getElementById('chat-widget-messages')
      if (!container) return
      const welcome = document.getElementById('chat-welcome')
      if (welcome) welcome.style.display = 'none'
      const existentes = container.querySelectorAll('.chat-msg')
      existentes.forEach(el => el.remove())
      msgs.forEach(m => this._chatAdicionarMsg(m.sender, m.message))
      container.scrollTop = container.scrollHeight
    } catch (e) { /* silencioso */ }
  },

  _chatAdicionarMsg(sender, text) {
    const container = document.getElementById('chat-widget-messages')
    if (!container) return
    const welcome = document.getElementById('chat-welcome')
    if (welcome) welcome.style.display = 'none'
    const isUser = sender === 'user'
    const div = document.createElement('div')
    div.className = 'chat-msg'
    div.style.cssText = `display:flex;justify-content:${isUser ? 'flex-end' : 'flex-start'};`
    const bubble = document.createElement('div')
    bubble.style.cssText = `max-width:85%;padding:8px 12px;border-radius:${isUser ? '14px 14px 4px 14px' : '14px 14px 14px 4px'};font-size:0.82rem;line-height:1.5;white-space:pre-wrap;word-break:break-word;${isUser ? 'background:#10B981;color:#fff;' : 'background:var(--bg-card,#fff);color:var(--text-main,#1e293b);border:1px solid var(--border-color,#e2e8f0);box-shadow:0 1px 4px rgba(0,0,0,0.06);'}`
    // Converter markdown bold (**texto**) para <strong>
    bubble.innerHTML = text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br>')
    div.appendChild(bubble)
    container.appendChild(div)
    container.scrollTop = container.scrollHeight
  },

  _chatAtualizarSugestoes(sugestoes) {
    const el = document.getElementById('chat-sugestoes')
    if (!el || !sugestoes?.length) return
    el.innerHTML = sugestoes.map(s =>
      `<button onclick="VM.chatEnviar('${s.replace(/'/g, "\\'")}')" class="chat-sugestao-btn">${s}</button>`
    ).join('')
  },

  async chatEnviar(mensagem) {
    const msg = mensagem?.trim()
    if (!msg) return
    this._chatAdicionarMsg('user', msg)
    // Mostrar loading
    const container = document.getElementById('chat-widget-messages')
    const loadDiv = document.createElement('div')
    loadDiv.id = 'chat-loading'
    loadDiv.className = 'chat-msg'
    loadDiv.style.cssText = 'display:flex;justify-content:flex-start;'
    loadDiv.innerHTML = '<div style="padding:8px 12px;border-radius:14px;background:var(--bg-card,#fff);border:1px solid var(--border-color,#e2e8f0);font-size:0.82rem;color:var(--text-muted,#64748b);"><i class="fas fa-circle-notch fa-spin"></i> Pensando...</div>'
    if (container) container.appendChild(loadDiv)
    if (container) container.scrollTop = container.scrollHeight
    try {
      const data = await this.api('POST', 'chat/send', { message: msg })
      const load = document.getElementById('chat-loading')
      if (load) load.remove()
      if (data.response) {
        this._chatAdicionarMsg('bot', data.response)
        if (data.sugestoes?.length) this._chatAtualizarSugestoes(data.sugestoes)
      }
    } catch (e) {
      const load = document.getElementById('chat-loading')
      if (load) load.remove()
      this._chatAdicionarMsg('bot', '❌ Erro ao processar sua mensagem. Tente novamente.')
    }
  },

  chatEnviarInput() {
    const input = document.getElementById('chat-widget-input')
    if (!input) return
    const msg = input.value?.trim()
    if (!msg) return
    input.value = ''
    this.chatEnviar(msg)
  },

  async carregarBadges() {
    try {
      const lembretes = await this.api('GET', 'lembretes').catch(() => ({ urgentes: 0 }))
      const badgeLemb = document.getElementById('badge-lembretes')
      if (badgeLemb && lembretes.urgentes > 0) { badgeLemb.textContent = lembretes.urgentes; badgeLemb.style.display = 'inline'; }
      // Badge de conquistas é atualizado pelo checkNovasConquistas — sem duplicidade
    } catch { }
  },

  mostrarAlertaConquista(novas) {
    if (!novas || novas.length === 0) return
    const conquista = novas[0]
    // Criar overlay de conquista
    const overlay = document.createElement('div')
    overlay.id = 'conquista-overlay'
    overlay.style.cssText = `
      position:fixed;top:0;left:0;right:0;bottom:0;
      background:rgba(0,0,0,0.85);z-index:9999;
      display:flex;align-items:center;justify-content:center;
      animation:fadeIn 0.3s ease;
    `
    overlay.innerHTML = `
      <div style="
        background:linear-gradient(135deg,#1a1a2e 0%,#16213e 50%,#0f3460 100%);
        border:2px solid #2FBF71;border-radius:24px;padding:40px;
        text-align:center;max-width:380px;width:90%;
        box-shadow:0 0 60px rgba(47,191,113,0.4);
        animation:conquistaEntrada 0.5s cubic-bezier(0.175,0.885,0.32,1.275);
      ">
        <div style="font-size:4rem;margin-bottom:12px;animation:conquista-bounce 0.6s ease infinite alternate;">${conquista.icone || '🏆'}</div>
        <div style="color:#2FBF71;font-size:0.75rem;font-weight:700;letter-spacing:3px;text-transform:uppercase;margin-bottom:8px;">🎉 Nova Conquista Desbloqueada!</div>
        <div style="color:#fff;font-size:1.5rem;font-weight:800;margin-bottom:8px;">${conquista.titulo}</div>
        <div style="color:#aaa;font-size:0.9rem;margin-bottom:20px;">${conquista.descricao}</div>
        <div style="background:rgba(47,191,113,0.1);border-radius:12px;padding:10px;margin-bottom:20px;">
          <span style="color:#2FBF71;font-weight:700;">+${conquista.pontos || 10} pontos</span>
          ${conquista.raridade && conquista.raridade !== 'comum' ? `<span style="margin-left:12px;color:#FFD700;font-size:0.8rem;">⭐ ${conquista.raridade.toUpperCase()}</span>` : ''}
        </div>
        ${novas.length > 1 ? `<div style="color:#888;font-size:0.8rem;margin-bottom:16px;">+${novas.length - 1} mais conquista(s)!</div>` : ''}
        <button id="btn-fechar-conquista" onclick="VM.fecharAlertaConquista()" style="
          background:#2FBF71;color:#000;border:none;padding:12px 32px;
          border-radius:50px;font-weight:700;font-size:1rem;cursor:pointer;
          width:100%;transition:all 0.2s;
        " onmouseover="this.style.background='#26a060'" onmouseout="this.style.background='#2FBF71'">
          🎊 Incrível! Ver conquistas (6s)
        </button>
      </div>
    `
    // Injetar animações
    if (!document.getElementById('conquista-anim')) {
      const style = document.createElement('style')
      style.id = 'conquista-anim'
      style.textContent = `
        @keyframes conquistaEntrada { from{transform:scale(0.3) rotate(-10deg);opacity:0} to{transform:scale(1) rotate(0deg);opacity:1} }
        @keyframes conquista-bounce { from{transform:translateY(0) scale(1)} to{transform:translateY(-10px) scale(1.1)} }
        @keyframes fadeIn { from{opacity:0} to{opacity:1} }
      `
      document.head.appendChild(style)
    }
    document.body.appendChild(overlay)
    // Marcar como visualizadas
    this.api('PATCH', 'conquistas/visualizar').catch(() => {})
    // Auto-fechar em 6s com contagem regressiva
    let secsLeft = 6
    const updateBtn = () => {
      const btnFechar = document.getElementById('btn-fechar-conquista')
      if (btnFechar && secsLeft > 0) {
        btnFechar.textContent = `🎊 Incrível! Ver conquistas (${secsLeft}s)`
      }
    }
    updateBtn()
    const countInterval = setInterval(() => {
      secsLeft--
      updateBtn()
      if (secsLeft <= 0) {
        clearInterval(countInterval)
        this.fecharAlertaConquista()
      }
    }, 1000)
    overlay._countInterval = countInterval
  },

  fecharAlertaConquista() {
    const overlay = document.getElementById('conquista-overlay')
    if (overlay) {
      if (overlay._countInterval) clearInterval(overlay._countInterval)
      overlay.remove()
    }
    const badgeConq = document.getElementById('badge-conquistas')
    if (badgeConq) { badgeConq.style.display = 'none'; badgeConq.textContent = ''; }
    this.navigate('conquistas')
  },

  navigate(page) {
    // ── Limpar overlay de conquista ao navegar ──────────────────────────────
    const conqOverlay = document.getElementById('conquista-overlay')
    if (conqOverlay) conqOverlay.remove()
    // ────────────────────────────────────────────────────────────────────────
    this.currentPage = page
    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'))
    const navEl = document.getElementById(`nav-${page}`)
    if (navEl) navEl.classList.add('active')

    // Bloco 9.10: atualizar item ativo da bottom navigation bar
    const bnavMap = { dashboard: 'bnav-dashboard', despesas: 'bnav-despesas', receitas: 'bnav-receitas', metas: 'bnav-metas', assistente: 'bnav-assistente' }
    document.querySelectorAll('.bottom-nav-item').forEach(el => el.classList.remove('active'))
    const bnavKey = Object.keys(bnavMap).find(k => page === k || page.startsWith(k))
    const bnavId = bnavMap[bnavKey || page] || bnavMap[page]
    if (bnavId) { const bEl = document.getElementById(bnavId); if (bEl) bEl.classList.add('active') }

    const titles = {
      dashboard: ['Dashboard', 'Visão geral das suas finanças'],
      receitas: ['Receitas', 'Controle de entradas'],
      despesas: ['Despesas', 'Controle de saídas e gastos'],
      cartoes: ['Cartões', 'Controle de faturas e limites'],
      metas: ['Metas Financeiras', 'Seus objetivos e conquistas'],
      orcamentos: ['Orçamentos por Categoria', 'Controle proativo dos seus gastos'],
      recorrencias: ['Recorrências Automáticas', 'Despesas e receitas fixas do mês'],
      lembretes: ['Lembretes', 'Contas e vencimentos'],
      investimentos: ['Investimentos', 'Patrimônio e rentabilidade'],
      reserva: ['Reserva de Emergência', 'Sua proteção financeira'],
      financiamentos: ['Financiamentos', 'Imóveis e financiamentos'],
      emprestimos: ['Empréstimos', 'Controle de dívidas'],
      relatorios: ['Relatórios', 'Análise detalhada'],
      comparativo: ['Comparativo Mensal 📊', 'Evolução mês a mês por categoria'],
      projecao: ['Projeção Financeira 🔮', 'Veja seu futuro financeiro'],
      simulacao: ['Simulações', 'Projeções de investimento'],
      ia: ['Diagnóstico Financeiro 360° ✨', 'Análise completa em 5 módulos • Hierarquia CFP®'],
      conquistas: ['Conquistas', 'Sua evolução financeira'],
      perfil: ['Meu Perfil', 'Configurações da conta'],
      tags: ['Tags & Filtros 🏷️', 'Organize suas despesas com etiquetas'],
      'alertas-cartao': ['⚠️ Alertas de Cartão', 'Fatura próxima, limite alto, cobrança duplicada'],
      'reservas-esp': ['🛡️ Minhas Reservas', 'Múltiplas reservas por objetivos específicos'],
      'assinaturas-fantasma': ['👻 Assinaturas Fantasma', 'Detecte gastos recorrentes esquecidos'],
      'compras-fantasma': ['🛍️ Compras Fantasma', 'Identifique gastos impulsivos e desnecessários'],
      'regra-503020': ['⚖️ Regra 50/30/20', 'Equilíbrio das suas finanças pessoais'],
      'desafio-52': ['🎯 Desafio 52 Semanas', 'Poupe R$ 1.378 ao longo do ano'],
      'amortizacao': ['🏦 Simulador de Amortização', 'Compare cenários e economize em juros'],
      'assistente': ['🤖 Assistente VerdeMais', 'Tire dúvidas sobre suas finanças com IA'],
      'importacao': ['📥 Importar CSV', 'Importe extratos de receitas e despesas']
    }

    const [title, sub] = titles[page] || ['', '']
    if (document.getElementById('page-title')) document.getElementById('page-title').textContent = title
    if (document.getElementById('page-sub')) document.getElementById('page-sub').textContent = sub

    history.pushState({}, '', `/app/${page}`)

    const pages = {
      dashboard: () => this.pageDashboard(),
      receitas: () => this.pageReceitas(),
      despesas: () => this.pageDespesas(),
      cartoes: () => this.pageCartoes(),
      metas: () => this.pageMetas(),
      orcamentos: () => this.pageOrcamentos(),
      recorrencias: () => this.pageRecorrencias(),
      lembretes: () => this.pageLembretes(),
      investimentos: () => this.pageInvestimentos(),
      financiamentos: () => this.pageFinanciamentos(),
      emprestimos: () => this.pageEmprestimos(),
      relatorios: () => this.pageRelatorios(),
      comparativo: () => this.pageComparativo(),
      simulacao: () => this.pageSimulacao(),
      ia: () => this.pageIA(),
      projecao: () => this.pageProjecao(),
      conquistas: () => this.pageConquistas(),
      perfil: () => this.pagePerfil(),
      reserva: () => this.pageReserva(),
      tags: () => this.pageTags(),
      'alertas-cartao': () => this.pageAlertasCartao(),
      'reservas-esp': () => this.pageReservasEsp(),
      'assinaturas-fantasma': () => this.pageAssinaturasFantasma(),
      'compras-fantasma': () => this.pageComprasFantasma(),
      'regra-503020': () => this.pageRegra503020(),
      'desafio-52': () => this.pageDesafio52(),
      'amortizacao': () => this.pageAmortizacao(),
      'assistente': () => this.pageAssistente(),
      'importacao': () => this.pageImportacao()
    }

    if (pages[page]) pages[page]()
    else this.pageDashboard()
  },

  // ============== DASHBOARD ==============
  async pageDashboard() {
    const content = document.getElementById('page-content')
    content.innerHTML = `<div class="empty-state"><div class="skeleton" style="height:200px;margin-bottom:20px;border-radius:16px;"></div></div>`

    try {
      const data = await this.api('GET', 'dashboard')
      const { resumo, score_saude, score_bloqueado, fatores_score = [], limites, metas, emprestimos: empResumo, financiamentos: finResumo, evolucao, categorias_despesas, ultimas_transacoes, proximos_vencimentos, reservas_esp, alerta_assinaturas, desafio_52 } = data

      // Salvar limites do plano para uso no frontend
      if (limites) this.limites = limites

      const scoreReal = score_saude !== null ? score_saude : 0
      const scoreColor = scoreReal >= 70 ? '#2FBF71' : scoreReal >= 40 ? '#ffc400' : '#ff6b6b'
      const scoreLabel = scoreReal >= 80 ? 'Excelente! 🏆' : scoreReal >= 60 ? 'Boa saúde 👍' : scoreReal >= 40 ? 'Atenção ⚠️' : 'Crítico ❗'
      const totalDevedor = resumo.total_devedor || 0
      const parcelaMensal = resumo.total_parcela_mensal_dividas || 0
      const comprometimento = resumo.comprometimento_dividas_pct || 0
      const comprometimentoColor = comprometimento > 30 ? '#ff6b6b' : comprometimento > 20 ? '#ffc400' : '#2FBF71'
      
      // Novos campos 2.1
      const patrimonioLiquido = resumo.patrimonio_liquido || 0
      const patrimonioBruto = resumo.patrimonio_bruto || 0
      const patrimonioColor = patrimonioLiquido >= 0 ? '#2FBF71' : '#ff6b6b'
      const reservasTotal = reservas_esp?.total_guardado || 0
      const reservasProgresso = reservas_esp?.progresso_pct || 0
      const desafio52Concluidas = desafio_52?.concluidas || 0
      const desafio52Guardado = desafio_52?.valor_acumulado || 0
      const assinaturasTem = alerta_assinaturas?.tem_alerta || false
      const assinaturasGasto = alerta_assinaturas?.custo_mensal_estimado || 0

      // Detectar conta nova (dashboard completamente vazio)
      const contaNova = resumo.total_receitas === 0 && resumo.total_despesas === 0 &&
                        resumo.total_investido === 0 && resumo.patrimonio_liquido === 0 &&
                        ultimas_transacoes?.length === 0

      content.innerHTML = `
        ${contaNova ? `
        <!-- BANNER BOAS-VINDAS — conta nova -->
        <div style="background:linear-gradient(135deg,rgba(47,191,113,0.12),rgba(16,185,129,0.06));border:1px solid rgba(47,191,113,0.25);border-radius:16px;padding:24px;margin-bottom:24px;display:flex;align-items:center;gap:20px;flex-wrap:wrap;">
          <div style="font-size:2.8rem;flex-shrink:0;">👋</div>
          <div style="flex:1;min-width:220px;">
            <div style="font-size:1.1rem;font-weight:800;color:#f1f5f9;margin-bottom:4px;">Bem-vindo ao VerdeMais, ${this.user?.nome?.split(' ')[0] || 'usuário'}!</div>
            <div style="font-size:0.82rem;color:#94A3B8;line-height:1.5;margin-bottom:14px;">Seu dashboard está vazio. Comece adicionando seus dados financeiros para ter uma visão completa da sua saúde financeira.</div>
            <div style="display:flex;gap:10px;flex-wrap:wrap;">
              <button onclick="VM.navigate('receitas')" class="button-premium button-premium--sm" style="background:rgba(47,191,113,0.15);border-color:rgba(47,191,113,0.4);color:#2FBF71;">
                <i class="fas fa-plus"></i> Adicionar Receita
              </button>
              <button onclick="VM.navigate('despesas')" class="button-premium button-premium--sm" style="background:rgba(255,107,107,0.1);border-color:rgba(255,107,107,0.3);color:#ff6b6b;">
                <i class="fas fa-plus"></i> Adicionar Despesa
              </button>
              <button onclick="VM.navigate('investimentos')" class="button-premium button-premium--sm" style="background:rgba(116,185,255,0.1);border-color:rgba(116,185,255,0.3);color:#74b9ff;">
                <i class="fas fa-chart-line"></i> Registrar Investimento
              </button>
            </div>
          </div>
          <div style="display:flex;flex-direction:column;gap:8px;flex-shrink:0;">
            <div style="font-size:0.7rem;color:#64748B;text-transform:uppercase;letter-spacing:1px;font-weight:700;">Próximos passos</div>
            ${[
              ['1', 'Cadastre suas receitas mensais', 'receitas'],
              ['2', 'Lance suas despesas recorrentes', 'despesas'],
              ['3', 'Configure seu perfil financeiro', 'perfil'],
            ].map(([n, txt, nav]) => `
              <div onclick="VM.navigate('${nav}')" style="display:flex;align-items:center;gap:10px;cursor:pointer;padding:6px 10px;border-radius:8px;background:rgba(255,255,255,0.03);transition:background 0.2s;" onmouseover="this.style.background='rgba(255,255,255,0.07)'" onmouseout="this.style.background='rgba(255,255,255,0.03)'">
                <span style="width:20px;height:20px;border-radius:50%;background:rgba(47,191,113,0.2);display:flex;align-items:center;justify-content:center;font-size:0.65rem;font-weight:700;color:#2FBF71;flex-shrink:0;">${n}</span>
                <span style="font-size:0.78rem;color:#94A3B8;">${txt}</span>
              </div>
            `).join('')}
          </div>
        </div>
        ` : ''}
        <!-- STATS ROW — 4 cards principais -->
        <div class="grid-4" style="margin-bottom:16px;">
          <div class="stat-card">
            <div class="stat-label" style="margin-bottom:8px;">💰 Saldo do Mês</div>
            <div class="stat-value ${resumo.saldo_liquido >= 0 ? 'positive' : 'negative'}">${this.formatMoney(resumo.saldo_liquido)}</div>
            <div class="stat-change ${resumo.taxa_poupanca >= 0 ? 'positive' : 'negative'}">
              ${resumo.taxa_poupanca >= 0 ? '▲' : '▼'} ${Math.abs(resumo.taxa_poupanca)}% da renda
            </div>
          </div>
          <div class="stat-card">
            <div class="stat-label" style="margin-bottom:8px;">📥 Receitas</div>
            <div class="stat-value positive">${this.formatMoney(resumo.total_receitas)}</div>
            <div class="stat-change neutral">Este mês</div>
          </div>
          <div class="stat-card">
            <div class="stat-label" style="margin-bottom:8px;">📤 Despesas</div>
            <div class="stat-value negative">${this.formatMoney(resumo.total_despesas)}</div>
            <div class="stat-change neutral">Este mês</div>
          </div>
          <div class="stat-card">
            <div class="stat-label" style="margin-bottom:8px;">📈 Investimentos</div>
            <div class="stat-value positive">${this.formatMoney(resumo.total_investimentos)}</div>
            <div class="stat-change positive">${resumo.percentual_investido}% da renda</div>
          </div>
        </div>

        <!-- STATS ROW 2 — Dívidas, metas, comprometimento -->
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-bottom:24px;">
          <div class="stat-card" style="border-color:${totalDevedor > 0 ? 'rgba(255,107,107,0.3)' : 'rgba(47,191,113,0.2)'};">
            <div class="stat-label" style="margin-bottom:6px;">🏦 Total Devedor</div>
            <div class="stat-value" style="color:${totalDevedor > 0 ? '#ff6b6b' : '#2FBF71'};font-size:1.3rem;">
              ${this.formatMoney(totalDevedor)}
            </div>
            <div style="font-size:0.72rem;color:#888;margin-top:4px;">
              ${resumo.count_emprestimos_ativos > 0 ? `${resumo.count_emprestimos_ativos} emprést.` : ''}
              ${resumo.count_emprestimos_ativos > 0 && resumo.count_financiamentos_ativos > 0 ? ' + ' : ''}
              ${resumo.count_financiamentos_ativos > 0 ? `${resumo.count_financiamentos_ativos} financ.` : ''}
              ${totalDevedor === 0 ? '✅ Sem dívidas' : ''}
            </div>
          </div>
          <div class="stat-card" style="border-color:${comprometimentoColor}30;">
            <div class="stat-label" style="margin-bottom:6px;">📅 Parcela Mensal (Dívidas)</div>
            <div class="stat-value" style="color:${comprometimentoColor};font-size:1.3rem;">${this.formatMoney(parcelaMensal)}</div>
            <div style="font-size:0.72rem;margin-top:4px;color:${comprometimentoColor};">
              ${comprometimento}% da renda comprometida
              ${comprometimento > 30 ? ' ⚠️' : comprometimento > 0 ? ' ✓' : ''}
            </div>
          </div>
          <div class="stat-card" style="border-color:rgba(47,191,113,0.2);">
            <div class="stat-label" style="margin-bottom:6px;">🎯 Metas Financeiras</div>
            <div class="stat-value positive" style="font-size:1.3rem;">${metas.ativas} ativa${metas.ativas !== 1 ? 's' : ''}</div>
            <div style="font-size:0.72rem;color:#888;margin-top:4px;">
              ${metas.ativas > 0 ? `${this.formatMoney(metas.atual_total)} de ${this.formatMoney(metas.objetivo_total)}` : 'Nenhuma meta cadastrada'}
            </div>
          </div>
        </div>

        <!-- BANNER PATRIMÔNIO LÍQUIDO — destaque no topo antes dos stats -->
        <div onclick="VM.navigate('investimentos')" style="cursor:pointer;background:linear-gradient(135deg,${patrimonioLiquido>=0?'rgba(47,191,113,0.1),rgba(16,185,129,0.05)':'rgba(255,107,107,0.1),rgba(220,38,38,0.05)'});border:1px solid ${patrimonioColor}30;border-radius:16px;padding:18px 24px;margin-bottom:20px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;transition:border-color 0.2s;" onmouseover="this.style.borderColor='${patrimonioColor}60'" onmouseout="this.style.borderColor='${patrimonioColor}30'">
          <div style="display:flex;align-items:center;gap:16px;">
            <div style="width:48px;height:48px;background:${patrimonioColor}20;border-radius:14px;display:flex;align-items:center;justify-content:center;border:1px solid ${patrimonioColor}40;">
              <i class="fas fa-${patrimonioLiquido>=0?'trending-up':'trending-down'}" style="color:${patrimonioColor};font-size:1.3rem;"></i>
            </div>
            <div>
              <div style="font-size:0.72rem;color:#666;text-transform:uppercase;letter-spacing:1px;font-weight:600;">Patrimônio Líquido</div>
              <div style="font-size:1.8rem;font-weight:900;color:${patrimonioColor};line-height:1.1;">${this.formatMoney(patrimonioLiquido)}</div>
              <div style="font-size:0.72rem;color:#555;margin-top:2px;">
                ${this.formatMoney(resumo.total_investimentos||0)} inv. + ${this.formatMoney((reservas_esp?.total_guardado||0)+(resumo.total_reservas||0))} reservas − ${this.formatMoney(resumo.total_devedor||0)} dívidas
              </div>
              ${patrimonioLiquido < 0 ? `<div style="font-size:0.68rem;color:#ff6b6b;margin-top:3px;font-weight:600;">⚠️ Dívidas superam ativos — cadastre investimentos para melhorar</div>` : ''}
            </div>
          </div>
          <div style="display:flex;gap:24px;flex-wrap:wrap;">
            <div style="text-align:center;">
              <div style="font-size:0.68rem;color:#555;text-transform:uppercase;letter-spacing:1px;">Investido</div>
              <div style="font-size:1rem;font-weight:700;color:#74b9ff;">${this.formatMoney(resumo.total_investimentos||0)}</div>
            </div>
            <div style="text-align:center;">
              <div style="font-size:0.68rem;color:#555;text-transform:uppercase;letter-spacing:1px;">Reservas</div>
              <div style="font-size:1rem;font-weight:700;color:#2FBF71;">${this.formatMoney((reservas_esp?.total_guardado||0)+(resumo.total_reservas||0))}</div>
            </div>
            <div style="text-align:center;">
              <div style="font-size:0.68rem;color:#555;text-transform:uppercase;letter-spacing:1px;">Dívidas</div>
              <div style="font-size:1rem;font-weight:700;color:#ff6b6b;">${this.formatMoney(resumo.total_dividas||0)}</div>
            </div>
            <div style="text-align:center;align-self:center;">
              <i class="fas fa-chevron-right" style="color:#555;font-size:0.9rem;"></i>
            </div>
          </div>
        </div>

        <!-- STATS ROW 3 — Novos cards Melhoria 2.1: Patrimônio, Reservas, Assinaturas, Desafio 52 -->
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-bottom:20px;">
          <div class="stat-card" onclick="VM.navigate('investimentos')" style="cursor:pointer;border-color:${patrimonioColor}30;" title="Patrimônio = Investimentos + Reservas - Dívidas">
            <div class="stat-label" style="margin-bottom:6px;">🏦 Patrimônio Líquido</div>
            <div class="stat-value" style="color:${patrimonioColor};font-size:1.2rem;">${this.formatMoney(patrimonioLiquido)}</div>
            <div style="font-size:0.7rem;color:#666;margin-top:4px;">Bruto: ${this.formatMoney(patrimonioBruto)}</div>
          </div>
          <div class="stat-card" onclick="VM.navigate('reservas-esp')" style="cursor:pointer;border-color:rgba(16,185,129,0.2);">
            <div class="stat-label" style="margin-bottom:6px;">🛡️ Reservas Especializadas</div>
            <div class="stat-value positive" style="font-size:1.2rem;">${this.formatMoney(reservasTotal)}</div>
            <div style="font-size:0.7rem;margin-top:4px;">
              <div style="background:#1a3a1a;border-radius:4px;height:4px;margin-top:4px;">
                <div style="background:#2FBF71;height:4px;border-radius:4px;width:${Math.min(100,reservasProgresso)}%;"></div>
              </div>
              <span style="color:#666;">${reservasProgresso}% da meta</span>
            </div>
          </div>
          <div class="stat-card" onclick="VM.navigate('assinaturas-fantasma')" style="cursor:pointer;border-color:${assinaturasTem ? 'rgba(139,92,246,0.3)' : 'rgba(42,58,42,0.5)'};">
            <div class="stat-label" style="margin-bottom:6px;">👻 Assinaturas Detectadas</div>
            <div class="stat-value" style="color:${assinaturasTem ? '#A78BFA' : '#666'};font-size:1.2rem;">${alerta_assinaturas?.count_nao_avaliadas || 0}</div>
            <div style="font-size:0.7rem;color:${assinaturasTem ? '#A78BFA' : '#555'};margin-top:4px;">
              ${assinaturasTem ? `~${this.formatMoney(assinaturasGasto)}/mês ⚠️` : 'Nenhuma detectada ✅'}
            </div>
          </div>
          <div class="stat-card" onclick="VM.navigate('desafio-52')" style="cursor:pointer;border-color:rgba(236,72,153,0.2);">
            <div class="stat-label" style="margin-bottom:6px;">🗓️ Desafio 52 Semanas</div>
            <div class="stat-value" style="color:#EC4899;font-size:1.2rem;">${desafio52Concluidas}/52</div>
            <div style="font-size:0.7rem;margin-top:4px;">
              <div style="background:#2a1a2a;border-radius:4px;height:4px;margin-top:4px;">
                <div style="background:#EC4899;height:4px;border-radius:4px;width:${Math.round(desafio52Concluidas/52*100)}%;"></div>
              </div>
              <span style="color:#666;">${this.formatMoney(desafio52Guardado)} guardados</span>
            </div>
          </div>
        </div>

        <!-- MAIN ROW -->
        <div style="display:grid;grid-template-columns:1fr 1fr 320px;gap:20px;margin-bottom:24px;">
          
          <!-- EVOLUÇÃO -->
          <div class="card" style="grid-column:1/3;">
            <div style="font-size:1rem;font-weight:700;margin-bottom:20px;">📊 Evolução dos Últimos 6 Meses</div>
            <div style="height:220px;"><canvas id="chart-evolucao"></canvas></div>
          </div>
          
          <!-- SCORE -->
          <div class="card" style="display:flex;flex-direction:column;align-items:center;text-align:center;overflow:hidden;position:relative;">
            <div style="font-size:0.8rem;color:#888;margin-bottom:12px;letter-spacing:0.5px;text-transform:uppercase;font-weight:600;">🧠 Saúde Financeira</div>
            ${score_bloqueado ? `
              <div style="position:relative;width:120px;height:120px;margin-bottom:10px;filter:blur(4px);pointer-events:none;">
                <svg viewBox="0 0 140 140" style="transform:rotate(-90deg);width:120px;height:120px;">
                  <circle cx="70" cy="70" r="58" fill="none" stroke="rgba(255,255,255,0.06)" stroke-width="14"/>
                  <circle cx="70" cy="70" r="58" fill="none" stroke="#2FBF71" stroke-width="14"
                    stroke-dasharray="${2 * Math.PI * 58}" stroke-dashoffset="${2 * Math.PI * 58 * 0.4}"
                    stroke-linecap="round"/>
                </svg>
                <div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;">
                  <div style="font-size:1.9rem;font-weight:800;color:#2FBF71;line-height:1;">??</div>
                  <div style="font-size:0.62rem;color:#555;margin-top:2px;">/ 100</div>
                </div>
              </div>
              <div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;background:rgba(15,15,26,0.7);backdrop-filter:blur(2px);border-radius:16px;cursor:pointer;" onclick="VM.upsellModal('score_saude')">
                <div style="font-size:1.4rem;margin-bottom:6px;">🔒</div>
                <div style="font-weight:700;font-size:0.85rem;color:#fff;margin-bottom:4px;">Score Financeiro</div>
                <div style="font-size:0.72rem;color:#94A3B8;text-align:center;padding:0 8px;margin-bottom:6px;line-height:1.4;">Disponível nos planos <strong style="color:#2FBF71;">Premium</strong> e <strong style="color:#a78bfa;">Pro</strong></div>
                <div style="font-size:0.7rem;color:#2FBF71;font-weight:600;background:rgba(47,191,113,0.12);padding:4px 12px;border-radius:20px;">👆 Clique para upgrade</div>
              </div>
            ` : `
            <div style="position:relative;width:120px;height:120px;margin-bottom:10px;">
              <svg viewBox="0 0 140 140" style="transform:rotate(-90deg);width:120px;height:120px;">
                <circle cx="70" cy="70" r="58" fill="none" stroke="rgba(255,255,255,0.06)" stroke-width="14"/>
                <circle cx="70" cy="70" r="58" fill="none" stroke="${scoreColor}" stroke-width="14"
                  stroke-dasharray="${2 * Math.PI * 58}" stroke-dashoffset="${2 * Math.PI * 58 * (1 - scoreReal / 100)}"
                  stroke-linecap="round" style="transition:stroke-dashoffset 1.2s ease;filter:drop-shadow(0 0 6px ${scoreColor}66);"/>
              </svg>
              <div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;">
                <div style="font-size:1.9rem;font-weight:800;color:${scoreColor};line-height:1;">${scoreReal}</div>
                <div style="font-size:0.62rem;color:#555;margin-top:2px;">/ 100</div>
              </div>
            </div>
            <div style="font-weight:700;color:${scoreColor};font-size:0.9rem;margin-bottom:14px;">${scoreLabel}</div>
            ${fatores_score.length > 0 ? (() => {
              const positivos = fatores_score.filter(f => f.tipo === 'positivo')
              const negativos = fatores_score.filter(f => f.tipo === 'negativo')
              const neutros   = fatores_score.filter(f => f.tipo === 'neutro')
              const renderGroup = (items, cor, bg, titulo) => items.length === 0 ? '' : `
                <div style="margin-bottom:8px;">
                  <div style="font-size:0.65rem;font-weight:700;color:${cor};text-transform:uppercase;letter-spacing:0.8px;margin-bottom:4px;padding:3px 8px;background:${bg};border-radius:6px;display:inline-block;">${titulo}</div>
                  ${items.map(f => `
                    <div style="display:flex;align-items:flex-start;gap:7px;padding:4px 0;border-bottom:1px solid rgba(255,255,255,0.04);">
                      <div style="flex:1;text-align:left;">
                        <div style="font-size:0.72rem;color:${cor};line-height:1.4;">${f.descricao}</div>
                      </div>
                      <span style="font-size:0.7rem;font-weight:800;color:${f.pontos > 0 ? '#2FBF71' : f.pontos < 0 ? '#ff6b6b' : '#666'};flex-shrink:0;min-width:32px;text-align:right;">${f.pontos > 0 ? '+' : ''}${f.pontos !== 0 ? f.pontos : '—'}</span>
                    </div>
                  `).join('')}
                </div>
              `
              return `
              <div style="width:100%;text-align:left;border-top:1px solid rgba(255,255,255,0.07);padding-top:12px;">
                <div style="font-size:0.7rem;color:#555;margin-bottom:8px;text-align:center;">Fatores que impactam seu score</div>
                ${renderGroup(positivos, '#2FBF71', 'rgba(47,191,113,0.12)', '✅ Pontos positivos')}
                ${renderGroup(negativos, '#ff6b6b', 'rgba(255,107,107,0.12)', '❌ Pontos negativos')}
                ${renderGroup(neutros,   '#ffc400', 'rgba(255,196,0,0.10)',   '⚠️ Pontos de atenção')}
              </div>`
            })() : ''}
            `}
          </div>
        </div>

        <!-- BOTTOM ROW -->
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;">
          
          <!-- CATEGORIAS -->
          <div class="card">
            <div style="font-size:1rem;font-weight:700;margin-bottom:20px;">🏷️ Gastos por Categoria</div>
            ${categorias_despesas.length > 0 ? `<div style="height:200px;"><canvas id="chart-categorias"></canvas></div>` : `<div class="empty-state" style="padding:40px 0;"><div class="empty-icon" style="font-size:2rem;">📭</div><p>Nenhum gasto este mês</p></div>`}
          </div>

          <!-- ÚLTIMAS TRANSAÇÕES -->
          <div class="card">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;">
              <div style="font-size:1rem;font-weight:700;">⚡ Últimas Transações</div>
              <button onclick="VM.navigate('despesas')" class="btn-secondary" style="font-size:0.75rem;padding:6px 12px;">Ver tudo</button>
            </div>
            ${ultimas_transacoes.length > 0 ? `
              <div style="display:flex;flex-direction:column;gap:10px;">
                ${ultimas_transacoes.slice(0, 6).map(t => `
                  <div style="display:flex;align-items:center;gap:12px;padding:10px;background:rgba(255,255,255,0.02);border-radius:12px;">
                    <div style="width:36px;height:36px;border-radius:10px;background:${t.tipo === 'receita' ? 'rgba(47,191,113,0.15)' : 'rgba(255,80,80,0.1)'};display:flex;align-items:center;justify-content:center;font-size:1rem;flex-shrink:0;">
                      ${t.tipo === 'receita' ? '📥' : '📤'}
                    </div>
                    <div style="flex:1;min-width:0;">
                      <div style="font-size:0.85rem;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${t.descricao}</div>
                      <div style="font-size:0.72rem;color:#666;">${t.categoria} • ${this.formatDate(t.data)}</div>
                    </div>
                    <div style="font-size:0.9rem;font-weight:700;${t.tipo === 'receita' ? 'color:#2FBF71' : 'color:#ff6b6b'}">
                      ${t.tipo === 'receita' ? '+' : '-'}${this.formatMoney(t.valor)}
                    </div>
                  </div>
                `).join('')}
              </div>
            ` : `<div class="empty-state" style="padding:40px 0;"><div class="empty-icon" style="font-size:2rem;">📭</div><p>Nenhuma transação</p></div>`}
          </div>
        </div>

        ${proximos_vencimentos.length > 0 ? `
          <div class="card" style="margin-top:20px;border-color:rgba(255,196,0,0.3);">
            <div style="font-size:1rem;font-weight:700;margin-bottom:16px;color:#ffc400;">⏰ Vencimentos Próximos (7 dias)</div>
            <div style="display:flex;flex-wrap:wrap;gap:12px;">
              ${proximos_vencimentos.map(v => `
                <div style="background:rgba(255,196,0,0.08);border:1px solid rgba(255,196,0,0.2);border-radius:12px;padding:12px 16px;display:flex;align-items:center;gap:10px;">
                  <i class="fas fa-exclamation-circle" style="color:#ffc400;"></i>
                  <div>
                    <div style="font-size:0.85rem;font-weight:600;">${v.descricao}</div>
                    <div style="font-size:0.75rem;color:#888;">Vence: ${this.formatDate(v.vencimento)} • ${this.formatMoney(v.valor)}</div>
                  </div>
                </div>
              `).join('')}
            </div>
          </div>
        ` : ''}

        <!-- BLOCO CARTÕES -->
        <div id="dash-cartoes-block" style="margin-top:20px;"></div>

        <!-- WIDGET ORÇAMENTOS + PROJEÇÃO -->
        <div id="dash-orcamentos-block" style="margin-top:20px;"></div>
      `

      // Carregar cartões no dashboard de forma assíncrona
      this.carregarCartoesNoDashboard()

      // Buscar CDI real e exibir widget
      this.api('GET', 'cdi/atual').then(cdiData => {
        const bloco = document.getElementById('dash-orcamentos-block')
        if (!bloco || !cdiData?.cdi_anual) return
        const cdiWidget = document.createElement('div')
        cdiWidget.style.cssText = 'margin-bottom:20px;'
        const cdiAnual   = cdiData.cdi_anual  || 0
        const cdiDiario  = cdiData.taxa_diaria || 0
        const cdiDate    = cdiData.data        || ''
        const cdiSrc     = cdiData.source      || 'BCB'
        // Calcular rentabilidade para R$1.000 em 12 meses a X% do CDI
        const cdi100pct  = +(1000 * (Math.pow(1 + cdiDiario / 100, 252) - 1)).toFixed(2)
        cdiWidget.innerHTML = `
          <div class="card-premium card-premium--highlight" style="padding:16px 20px;">
            <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;">
              <div style="display:flex;align-items:center;gap:14px;">
                <div style="width:42px;height:42px;background:linear-gradient(135deg,rgba(16,185,129,0.2),rgba(5,150,105,0.1));border:1px solid rgba(16,185,129,0.3);border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:1.4rem;">📡</div>
                <div>
                  <div style="font-size:0.65rem;color:#10B981;text-transform:uppercase;letter-spacing:1px;font-weight:800;">CDI Oficial · ${cdiSrc}</div>
                  <div style="display:flex;align-items:baseline;gap:8px;margin-top:2px;">
                    <span style="font-size:1.5rem;font-weight:900;color:#F8FAFC;letter-spacing:-1px;">${cdiAnual}%</span>
                    <span style="font-size:0.8rem;color:#64748B;">a.a.</span>
                  </div>
                  <div style="font-size:0.68rem;color:#475569;margin-top:1px;">Diário: ${cdiDiario.toFixed(5)}% · ${cdiDate}</div>
                </div>
              </div>
              <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
                <div style="background:rgba(16,185,129,0.08);border:1px solid rgba(16,185,129,0.15);border-radius:10px;padding:8px 14px;text-align:center;">
                  <div style="font-size:0.62rem;color:#64748B;text-transform:uppercase;letter-spacing:0.5px;">R$1k em 12m (100% CDI)</div>
                  <div style="font-size:0.95rem;font-weight:800;color:#10B981;">+R$${cdi100pct.toLocaleString('pt-BR',{minimumFractionDigits:2})}</div>
                </div>
                <button onclick="VM.navigate('investimentos')" class="button-premium button-premium--sm button-premium--outline">
                  <i class="fas fa-chart-line"></i> Investir
                </button>
              </div>
            </div>
          </div>`
        bloco.prepend(cdiWidget)
      }).catch(() => {})

      // Mini-widget cotações (câmbio + cripto) no Dashboard
      this.api('GET', 'investimentos/cotacoes').then(cotData => {
        const bloco = document.getElementById('dash-orcamentos-block')
        if (!bloco || !cotData) return
        const cambio = cotData.cambio || {}
        const cripto = cotData.cripto || {}
        if (Object.keys(cambio).length === 0 && Object.keys(cripto).length === 0) return
        const fmtBRL = v => Number(v||0).toLocaleString('pt-BR', {minimumFractionDigits:2,maximumFractionDigits:2})
        const varColor = v => Number(v||0) >= 0 ? '#10B981' : '#F43F5E'
        const varSign  = v => Number(v||0) >= 0 ? '▲' : '▼'
        const moedaFlags = { USD: '🇺🇸', EUR: '🇪🇺', GBP: '🇬🇧' }
        const cotWidget = document.createElement('div')
        cotWidget.style.cssText = 'margin-bottom:16px;'
        cotWidget.innerHTML = `
          <div style="background:rgba(15,23,42,0.7);border:1px solid rgba(255,255,255,0.06);border-radius:12px;padding:12px 16px;" onclick="VM.navigate('investimentos')" style="cursor:pointer;">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
              <div style="font-size:0.65rem;color:#64748B;text-transform:uppercase;letter-spacing:1px;font-weight:700;">📊 Cotações — Câmbio & Cripto</div>
              <div style="font-size:0.62rem;color:#334155;">BCB · DolarApi · CoinGecko</div>
            </div>
            <div style="display:flex;gap:10px;flex-wrap:wrap;">
              ${Object.entries(cambio).map(([sym, m]) => `
                <div style="display:flex;align-items:center;gap:6px;padding:8px 12px;background:rgba(255,255,255,0.03);border-radius:8px;border:1px solid rgba(255,255,255,0.05);">
                  <span>${moedaFlags[sym]||'💱'}</span>
                  <div>
                    <div style="font-size:0.6rem;color:#64748B;font-weight:600;">${sym}/BRL</div>
                    <div style="font-size:0.85rem;font-weight:700;color:#f1f5f9;">R$ ${fmtBRL(m.compra)}</div>
                  </div>
                </div>`).join('')}
              ${Object.entries(cripto).slice(0,3).map(([sym, c]) => `
                <div style="display:flex;align-items:center;gap:6px;padding:8px 12px;background:rgba(255,255,255,0.03);border-radius:8px;border:1px solid rgba(255,255,255,0.05);">
                  <span>${sym==='BTC'?'₿':sym==='ETH'?'Ξ':'🪙'}</span>
                  <div>
                    <div style="font-size:0.6rem;color:#64748B;font-weight:600;">${sym}/BRL</div>
                    <div style="font-size:0.85rem;font-weight:700;color:#f1f5f9;">R$ ${fmtBRL(c.brl)}</div>
                    ${c.variacao_24h != null ? `<div style="font-size:0.6rem;color:${varColor(c.variacao_24h)};font-weight:600;">${varSign(c.variacao_24h)} ${Math.abs(Number(c.variacao_24h)).toFixed(2)}%</div>` : ''}
                  </div>
                </div>`).join('')}
            </div>
          </div>`
        bloco.prepend(cotWidget)
      }).catch(() => {})

      // Carregar widget de orçamentos (F1) e projeção (F4)
      const planoUser = this.user?.plano || 'free'
      if (planoUser !== 'free') {
        this.carregarWidgetOrcamentos()
      }

      // Chart Evolução
      const ctxEv = document.getElementById('chart-evolucao')
      if (ctxEv) {
        if (this.charts.evolucao) this.charts.evolucao.destroy()
        this.charts.evolucao = new Chart(ctxEv, {
          type: 'bar',
          data: {
            labels: evolucao.map(e => e.mes),
            datasets: [
              { label: 'Receitas', data: evolucao.map(e => e.receitas), backgroundColor: 'rgba(47,191,113,0.7)', borderRadius: 6 },
              { label: 'Despesas', data: evolucao.map(e => e.despesas), backgroundColor: 'rgba(255,107,107,0.7)', borderRadius: 6 }
            ]
          },
          options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { labels: { color: '#888', font: { size: 11 } } } },
            scales: {
              x: { ticks: { color: '#888' }, grid: { color: 'rgba(255,255,255,0.04)' } },
              y: { ticks: { color: '#888', callback: v => 'R$ ' + v.toLocaleString('pt-BR') }, grid: { color: 'rgba(255,255,255,0.04)' } }
            }
          }
        })
      }

      // Chart Categorias
      if (categorias_despesas.length > 0) {
        const ctxCat = document.getElementById('chart-categorias')
        if (ctxCat) {
          if (this.charts.categorias) this.charts.categorias.destroy()
          const colors = ['#2FBF71', '#ff6b6b', '#ffc400', '#a29bfe', '#74b9ff', '#fd79a8', '#ff8c42', '#4ecdc4']
          this.charts.categorias = new Chart(ctxCat, {
            type: 'doughnut',
            data: {
              labels: categorias_despesas.map(c => c.categoria),
              datasets: [{ data: categorias_despesas.map(c => c.total), backgroundColor: colors, borderWidth: 0 }]
            },
            options: {
              responsive: true, maintainAspectRatio: false,
              plugins: {
                legend: { position: 'right', labels: { color: '#888', font: { size: 10 }, boxWidth: 12, padding: 8 } }
              }
            }
          })
        }
      }
    } catch (e) {
      content.innerHTML = `<div class="empty-state"><div class="empty-icon">⚠️</div><h3>Erro ao carregar</h3><p>${e.response?.data?.error || 'Tente novamente'}</p></div>`
    }
  },

  async carregarCartoesNoDashboard() {
    const block = document.getElementById('dash-cartoes-block')
    if (!block) return
    try {
      const data = await this.api('GET', 'cartoes')
      const cartoes = data.cartoes || []
      if (cartoes.length === 0) return

      const totalLimite = cartoes.reduce((s, c) => s + (c.limite_total || 0), 0)
      const totalUsado = cartoes.reduce((s, c) => s + (c.limite_utilizado || 0), 0)
      const totalDisp = totalLimite - totalUsado
      const pctTotal = totalLimite > 0 ? Math.round((totalUsado / totalLimite) * 100) : 0
      const pctColor = pctTotal > 80 ? '#ff6b6b' : pctTotal > 50 ? '#ffc400' : '#2FBF71'
      const bandeiras = { visa: '💙', mastercard: '🔴', elo: '💛', amex: '🟢', hipercard: '🔵', outros: '💳' }

      block.innerHTML = `
        <div class="card" style="border-color:rgba(47,191,113,0.2);">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;flex-wrap:wrap;gap:12px;">
            <div style="font-size:1rem;font-weight:700;">💳 Limite dos Cartões</div>
            <button onclick="VM.navigate('cartoes')" class="btn-secondary" style="font-size:0.75rem;padding:6px 12px;">Gerenciar Cartões</button>
          </div>

          <!-- Resumo consolidado -->
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:20px;">
            <div style="background:rgba(255,255,255,0.03);border-radius:12px;padding:14px;text-align:center;">
              <div style="font-size:0.72rem;color:#888;margin-bottom:6px;">Limite Total</div>
              <div style="font-size:1.1rem;font-weight:800;">${this.formatMoney(totalLimite)}</div>
            </div>
            <div style="background:rgba(255,80,80,0.06);border-radius:12px;padding:14px;text-align:center;">
              <div style="font-size:0.72rem;color:#888;margin-bottom:6px;">Utilizado</div>
              <div style="font-size:1.1rem;font-weight:800;color:#ff6b6b;">${this.formatMoney(totalUsado)}</div>
            </div>
            <div style="background:rgba(47,191,113,0.06);border-radius:12px;padding:14px;text-align:center;">
              <div style="font-size:0.72rem;color:#888;margin-bottom:6px;">Disponível</div>
              <div style="font-size:1.1rem;font-weight:800;color:#2FBF71;">${this.formatMoney(totalDisp)}</div>
            </div>
          </div>

          <!-- Barra consolidada -->
          <div style="margin-bottom:20px;">
            <div style="display:flex;justify-content:space-between;margin-bottom:6px;font-size:0.78rem;color:#888;">
              <span>Uso consolidado de todos os cartões</span>
              <span style="font-weight:700;color:${pctColor};">${pctTotal}% utilizado</span>
            </div>
            <div style="background:rgba(255,255,255,0.08);border-radius:50px;height:8px;overflow:hidden;">
              <div style="background:${pctColor};width:${Math.min(pctTotal,100)}%;height:100%;border-radius:50px;transition:width 0.8s ease;"></div>
            </div>
          </div>

          <!-- Cards individuais -->
          <div style="display:flex;flex-direction:column;gap:10px;">
            ${cartoes.map(c => {
              const pct = c.percentual_uso || 0
              const usado = c.limite_utilizado || 0
              const cor = pct > 80 ? '#ff6b6b' : pct > 50 ? '#ffc400' : '#2FBF71'
              return `
                <div style="display:flex;align-items:center;gap:14px;padding:12px;background:rgba(255,255,255,0.02);border-radius:10px;cursor:pointer;" onclick="VM.navigate('cartoes')">
                  <div style="width:38px;height:38px;background:${c.cor||'#2FBF71'}22;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:1.1rem;flex-shrink:0;">
                    ${bandeiras[c.bandeira] || '💳'}
                  </div>
                  <div style="flex:1;min-width:0;">
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
                      <div style="font-size:0.85rem;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${c.nome}</div>
                      <div style="display:flex;align-items:center;gap:8px;flex-shrink:0;margin-left:8px;">
                        <span style="font-size:0.78rem;color:#ff6b6b;">${this.formatMoney(usado)}</span>
                        <span style="font-size:0.72rem;color:#666;">/ ${this.formatMoney(c.limite_total)}</span>
                        <span style="font-size:0.72rem;font-weight:700;color:${cor};min-width:32px;text-align:right;">${pct}%</span>
                      </div>
                    </div>
                    <div style="background:rgba(255,255,255,0.08);border-radius:50px;height:4px;overflow:hidden;">
                      <div style="background:${cor};width:${Math.min(pct,100)}%;height:100%;border-radius:50px;"></div>
                    </div>
                  </div>
                </div>
              `
            }).join('')}
          </div>
        </div>
      `
    } catch(e) {
      // silencioso — cartões são opcionais no dashboard
    }
  },

  // ─── WIDGET DE ORÇAMENTOS NO DASHBOARD (F1) ───────────────────────────────
  async carregarWidgetOrcamentos() {
    const block = document.getElementById('dash-orcamentos-block')
    if (!block) return
    try {
      const hoje = new Date()
      const mes = hoje.getMonth() + 1
      const ano = hoje.getFullYear()
      const data = await this.api('GET', `orcamentos?mes=${mes}&ano=${ano}`)
      const orcs = data.orcamentos || []
      if (orcs.length === 0) return

      const excedidos = orcs.filter(o => o.status === 'exceeded').length
      const alertas   = orcs.filter(o => ['warning','attention'].includes(o.status)).length
      const totalLim  = orcs.reduce((s,o) => s + o.limite, 0)
      const totalGasto = orcs.reduce((s,o) => s + o.gasto, 0)
      const pctGlobal = totalLim > 0 ? Math.round(totalGasto / totalLim * 100) : 0
      const corGlobal = pctGlobal > 100 ? '#F43F5E' : pctGlobal >= 80 ? '#F97316' : '#10B981'

      // Top 4 por percentual (priorizando excedidos)
      const topOrcs = [...orcs].sort((a,b) => b.percentual - a.percentual).slice(0,4)

      block.innerHTML = `
        <div class="card" style="border-color:${excedidos > 0 ? 'rgba(244,63,94,0.3)' : alertas > 0 ? 'rgba(249,115,22,0.2)' : '#1f2937'};">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">
            <div style="font-size:1rem;font-weight:700;">📊 Orçamentos do Mês</div>
            <div style="display:flex;align-items:center;gap:10px;">
              ${excedidos > 0 ? `<span style="background:rgba(244,63,94,0.15);color:#F43F5E;border:1px solid rgba(244,63,94,0.3);border-radius:20px;font-size:0.7rem;font-weight:700;padding:3px 10px;">🚨 ${excedidos} excedido${excedidos>1?'s':''}</span>` : ''}
              ${alertas > 0  ? `<span style="background:rgba(249,115,22,0.12);color:#F97316;border:1px solid rgba(249,115,22,0.25);border-radius:20px;font-size:0.7rem;font-weight:700;padding:3px 10px;">⚠️ ${alertas} em alerta</span>` : ''}
              <button onclick="VM.navigate('orcamentos')" class="btn-secondary" style="font-size:0.75rem;padding:6px 12px;">Gerenciar</button>
            </div>
          </div>

          <!-- Barra global -->
          <div style="margin-bottom:16px;">
            <div style="display:flex;justify-content:space-between;margin-bottom:6px;font-size:0.78rem;">
              <span style="color:#888;">Gasto: <strong style="color:${corGlobal};">${this.fmt(totalGasto)}</strong></span>
              <span style="color:#888;">Limite: <strong style="color:#e0e0e0;">${this.fmt(totalLim)}</strong> · <strong style="color:${corGlobal};">${pctGlobal}%</strong></span>
            </div>
            <div style="background:#1a1a2e;border-radius:20px;height:8px;overflow:hidden;">
              <div style="background:${corGlobal};height:100%;border-radius:20px;width:${Math.min(pctGlobal,100)}%;transition:width 0.6s ease;"></div>
            </div>
          </div>

          <!-- Top categorias -->
          <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:10px;">
            ${topOrcs.map(o => {
              const pct = Math.min(o.percentual, 100)
              const cor = o.status === 'exceeded' ? '#F43F5E' : o.status === 'warning' ? '#F97316' : o.status === 'attention' ? '#F59E0B' : '#10B981'
              return `
                <div style="background:rgba(255,255,255,0.02);border:1px solid #1f2937;border-radius:10px;padding:12px;" onclick="VM.navigate('orcamentos')" style="cursor:pointer;">
                  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                    <span style="font-size:0.82rem;font-weight:600;">${o.label}</span>
                    <span style="font-size:0.78rem;font-weight:700;color:${cor};">${o.percentual}%</span>
                  </div>
                  <div style="background:#1a1a2e;border-radius:20px;height:5px;overflow:hidden;">
                    <div style="background:${cor};height:100%;border-radius:20px;width:${pct}%;transition:width 0.5s ease;"></div>
                  </div>
                  <div style="display:flex;justify-content:space-between;margin-top:4px;font-size:0.7rem;color:#666;">
                    <span>${this.fmt(o.gasto)}</span>
                    <span>${this.fmt(o.restante)} restante</span>
                  </div>
                </div>`
            }).join('')}
          </div>

          ${orcs.length > 4 ? `<div style="text-align:center;margin-top:12px;"><a href="#" onclick="VM.navigate('orcamentos');return false;" style="color:#74b9ff;font-size:0.78rem;">+ ${orcs.length - 4} outros orçamentos →</a></div>` : ''}
        </div>
      `
    } catch(e) { /* silencioso */ }
  },

  // ============== RECEITAS ==============
  async pageReceitas() {
    const now = new Date()
    const mes = String(now.getMonth() + 1)
    const ano = String(now.getFullYear())

    document.getElementById('page-content').innerHTML = `
      <div class="section-header">
        <div>
          <div class="section-title">💰 Receitas</div>
          <div style="color:#666;font-size:0.85rem;margin-top:2px;">Controle suas entradas</div>
        </div>
        <button onclick="VM.modalReceita()" class="btn-primary" style="width:auto;padding:10px 20px;">
          <i class="fas fa-plus"></i> Nova Receita
        </button>
      </div>
      
      <div style="display:flex;gap:12px;margin-bottom:20px;flex-wrap:wrap;">
        <select id="filtro-mes" class="form-select" style="width:auto;padding:8px 14px;">
          ${['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'].map((m, i) => `<option value="${i+1}" ${String(i+1) === mes ? 'selected' : ''}>${m}</option>`).join('')}
        </select>
        <select id="filtro-ano" class="form-select" style="width:auto;padding:8px 14px;">
          ${[ano-1, ano, parseInt(ano)+1].map(a => `<option value="${a}" ${String(a) === ano ? 'selected' : ''}>${a}</option>`).join('')}
        </select>
        <button onclick="VM.carregarReceitas()" class="btn-secondary">
          <i class="fas fa-search"></i> Filtrar
        </button>
      </div>
      
      <div id="receitas-stats" class="card" style="margin-bottom:20px;"></div>
      
      <div class="card" id="receitas-table-wrapper">
        <div class="empty-state"><div class="skeleton" style="height:200px;border-radius:12px;"></div></div>
      </div>
    `

    this.carregarReceitas()
  },

  async carregarReceitas(pagina = 1) {
    const mes = document.getElementById('filtro-mes')?.value || String(new Date().getMonth() + 1)
    const ano = document.getElementById('filtro-ano')?.value || String(new Date().getFullYear())
    const limit = 20
    const offset = (pagina - 1) * limit
    
    try {
      const data = await this.api('GET', `receitas?mes=${mes}&ano=${ano}&limit=${limit}&offset=${offset}`)
      const totalCount = data.total_count || data.count || 0
      const totalPages = Math.max(1, Math.ceil(totalCount / limit))
      
      const statsEl = document.getElementById('receitas-stats')
      if (statsEl) {
        statsEl.innerHTML = `
          <div style="display:flex;gap:32px;align-items:center;">
            <div>
              <div style="color:#888;font-size:0.8rem;">Total do período</div>
              <div style="font-size:1.6rem;font-weight:800;color:#2FBF71;">${this.formatMoney(data.total)}</div>
            </div>
            <div>
              <div style="color:#888;font-size:0.8rem;">Transações</div>
              <div style="font-size:1.6rem;font-weight:800;">${totalCount}</div>
            </div>
          </div>
        `
      }

      const wrapper = document.getElementById('receitas-table-wrapper')
      if (data.receitas.length === 0 && pagina === 1) {
        wrapper.innerHTML = `<div class="empty-state"><div class="empty-icon">💸</div><h3>Nenhuma receita</h3><p>Adicione sua primeira receita do período</p></div>`
        return
      }

      const cats = {
        'Salário': '💼', 'Freelance': '💻', 'Investimentos': '📈', 'Aluguel': '🏠', 
        'Vendas': '🛒', 'Bônus': '🎁', 'Outros': '💰'
      }

      const paginacao = totalPages > 1 ? `
        <div style="display:flex;align-items:center;justify-content:space-between;padding:14px 0 4px;flex-wrap:wrap;gap:8px;">
          <span style="font-size:0.8rem;color:#888;">Página <strong style="color:#ddd;">${pagina}</strong> de <strong style="color:#ddd;">${totalPages}</strong> · <strong style="color:#2FBF71;">${totalCount}</strong> registros</span>
          <div style="display:flex;gap:6px;">
            <button onclick="VM.carregarReceitas(${pagina - 1})" ${pagina <= 1 ? 'disabled' : ''} style="padding:6px 14px;border-radius:8px;border:1px solid rgba(255,255,255,0.1);background:rgba(255,255,255,0.05);color:${pagina<=1?'#555':'#ddd'};cursor:${pagina<=1?'default':'pointer'};font-size:0.82rem;">← Anterior</button>
            <button onclick="VM.carregarReceitas(${pagina + 1})" ${pagina >= totalPages ? 'disabled' : ''} style="padding:6px 14px;border-radius:8px;border:1px solid rgba(255,255,255,0.1);background:rgba(255,255,255,0.05);color:${pagina>=totalPages?'#555':'#ddd'};cursor:${pagina>=totalPages?'default':'pointer'};font-size:0.82rem;">Próxima →</button>
          </div>
        </div>
      ` : `<div style="padding:10px 0 4px;font-size:0.8rem;color:#888;"><strong style="color:#2FBF71;">${totalCount}</strong> registros</div>`

      wrapper.innerHTML = `
        <div id="receitas-sel-bar" style="display:none;align-items:center;gap:12px;padding:10px 14px;margin-bottom:10px;background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.3);border-radius:10px;">
          <span id="receitas-sel-count" style="color:#f87171;font-weight:600;font-size:0.88rem;">0 selecionadas</span>
          <button onclick="VM._selTodosReceitas(true)" style="padding:5px 12px;border-radius:7px;border:1px solid rgba(255,255,255,0.15);background:rgba(255,255,255,0.06);color:#ddd;font-size:0.8rem;cursor:pointer;">Selecionar tudo</button>
          <button onclick="VM._selTodosReceitas(false)" style="padding:5px 12px;border-radius:7px;border:1px solid rgba(255,255,255,0.1);background:transparent;color:#888;font-size:0.8rem;cursor:pointer;">Limpar</button>
          <button onclick="VM._excluirSelecionadasReceitas()" style="padding:5px 14px;border-radius:7px;border:none;background:#ef4444;color:#fff;font-size:0.82rem;font-weight:600;cursor:pointer;"><i class="fas fa-trash" style="margin-right:5px;"></i>Excluir selecionadas</button>
        </div>
        <div style="overflow-x:auto;-webkit-overflow-scrolling:touch;">
          <table class="data-table" style="min-width:660px;">
            <thead>
              <tr>
                <th style="width:36px;"><input type="checkbox" id="rec-chk-all" onchange="VM._selTodosReceitas(this.checked)" style="cursor:pointer;width:16px;height:16px;"></th>
                <th>Descrição</th>
                <th>Categoria</th>
                <th>Data</th>
                <th>Recorrente</th>
                <th style="text-align:right;">Valor</th>
                <th style="text-align:right;">Ações</th>
              </tr>
            </thead>
            <tbody>
              ${data.receitas.map(r => `
                <tr id="rec-row-${r.id}">
                  <td><input type="checkbox" class="rec-chk" data-id="${r.id}" onchange="VM._onSelReceita()" style="cursor:pointer;width:16px;height:16px;"></td>
                  <td style="font-weight:500;">${r.descricao}</td>
                  <td><span class="badge badge-green">${cats[r.categoria] || '💰'} ${r.categoria}</span></td>
                  <td style="color:#888;">${this.formatDate(r.data)}</td>
                  <td>${r.recorrente ? '<span class="badge badge-blue">🔄 Recorrente</span>' : '<span style="color:#555;">-</span>'}</td>
                  <td style="text-align:right;font-weight:700;color:#2FBF71;">${this.formatMoney(r.valor)}</td>
                  <td style="text-align:right;white-space:nowrap;">
                    <button onclick="VM.modalReceita(${JSON.stringify(r).replace(/"/g, '&quot;')})" class="btn-success" style="margin-right:4px;" title="Editar"><i class="fas fa-edit"></i></button>
                    <button onclick="VM.deleteReceita(${r.id})" class="btn-danger" title="Excluir"><i class="fas fa-trash"></i></button>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
        ${paginacao}
      `
    } catch (e) {
      this.toast('Erro ao carregar receitas', 'error')
    }
  },

  modalReceita(receita = null) {
    const isEdit = !!receita
    const today = new Date().toISOString().split('T')[0]
    const categorias = ['Salário', 'Freelance', 'Investimentos', 'Aluguel', 'Vendas', 'Bônus', 'Outros']
    const meiosPagamento = [
      { value: 'dinheiro', label: '💵 Dinheiro / À vista' },
      { value: 'pix', label: '⚡ PIX' },
      { value: 'transferencia', label: '🏦 Transferência Bancária' },
      { value: 'deposito', label: '📥 Depósito' },
      { value: 'cheque', label: '📝 Cheque' },
      { value: 'outros', label: '📦 Outros' },
    ]

    document.getElementById('modal-container').innerHTML = `
      <div class="modal-overlay" onclick="VM.closeModal(event)">
        <div class="modal" style="max-width:500px;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:24px;">
            <h3 style="font-size:1.1rem;font-weight:700;">${isEdit ? '✏️ Editar' : '💰 Nova'} Receita</h3>
            <button onclick="VM.closeModal()" style="background:none;border:none;color:#666;font-size:1.2rem;cursor:pointer;">✕</button>
          </div>
          <form id="receita-form">
            <div class="form-group">
              <label class="form-label">Descrição *</label>
              <input type="text" id="r-desc" class="form-input" placeholder="Ex: Salário de março" value="${receita?.descricao || ''}" required>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
              <div class="form-group">
                <label class="form-label">Categoria *</label>
                <select id="r-cat" class="form-select" onchange="VM._carregarUltimasReceitasPorCategoria(this.value)">
                  ${categorias.map(c => `<option value="${c}" ${receita?.categoria === c ? 'selected' : ''}>${c}</option>`).join('')}
                </select>
              </div>
              <div class="form-group">
                <label class="form-label">Data *</label>
                <input type="date" id="r-data" class="form-input" value="${receita?.data || today}" required>
              </div>
            </div>
            <!-- Últimas receitas da categoria -->
            <div id="r-ultimas-cat" style="display:none;margin-bottom:14px;background:rgba(47,191,113,0.06);border:1px solid rgba(47,191,113,0.2);border-radius:10px;padding:10px 12px;">
              <div style="font-size:0.75rem;color:#2FBF71;font-weight:700;margin-bottom:8px;text-transform:uppercase;letter-spacing:0.5px;">
                <i class="fas fa-history"></i> Últimas desta categoria
              </div>
              <div id="r-ultimas-cat-lista" style="font-size:0.82rem;"></div>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
              <div class="form-group">
                <label class="form-label">Valor (R$) *</label>
                <input type="number" id="r-valor" class="form-input" placeholder="0,00" step="0.01" min="0" value="${receita?.valor || ''}" required>
              </div>
              <div class="form-group">
                <label class="form-label">Meio de Recebimento</label>
                <select id="r-meio" class="form-select">
                  ${meiosPagamento.map(m => `<option value="${m.value}" ${receita?.meio_pagamento === m.value ? 'selected' : ''}>${m.label}</option>`).join('')}
                </select>
              </div>
            </div>
            <div class="form-group" style="display:flex;align-items:center;gap:10px;">
              <input type="checkbox" id="r-recorrente" ${receita?.recorrente ? 'checked' : ''} style="width:16px;height:16px;accent-color:#2FBF71;">
              <label for="r-recorrente" class="form-label" style="margin:0;">Receita recorrente</label>
            </div>
            <div class="form-group">
              <label class="form-label">Observações</label>
              <input type="text" id="r-obs" class="form-input" placeholder="Opcional..." value="${receita?.observacoes || ''}">
            </div>
            <div style="display:flex;gap:12px;margin-top:8px;">
              <button type="button" onclick="VM.closeModal()" class="btn-secondary" style="flex:1;justify-content:center;">
                <i class="fas fa-times"></i> Cancelar
              </button>
              <button type="submit" class="btn-primary" style="flex:1;" id="r-submit">
                <i class="fas fa-save"></i> ${isEdit ? 'Salvar' : 'Adicionar'}
              </button>
            </div>
          </form>
        </div>
      </div>
    `

    // Carregar últimas receitas da categoria inicial
    this._carregarUltimasReceitasPorCategoria(receita?.categoria || categorias[0])

    document.getElementById('receita-form').addEventListener('submit', async (e) => {
      e.preventDefault()
      const btn = document.getElementById('r-submit')
      btn.disabled = true
      btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Salvando...'
      try {
        const payload = {
          descricao: document.getElementById('r-desc').value,
          categoria: document.getElementById('r-cat').value,
          data: document.getElementById('r-data').value,
          valor: parseFloat(document.getElementById('r-valor').value),
          meio_pagamento: document.getElementById('r-meio').value,
          recorrente: document.getElementById('r-recorrente').checked,
          observacoes: document.getElementById('r-obs').value
        }
        if (isEdit) await this.api('PUT', `receitas/${receita.id}`, payload)
        else await this.api('POST', 'receitas', payload)
        this.toast(isEdit ? 'Receita atualizada! ✅' : 'Receita adicionada! 💰')
        this.closeModal()
        this.carregarReceitas()
      } catch (err) {
        this.toast(err.response?.data?.error || 'Erro ao salvar', 'error')
        btn.disabled = false
        btn.innerHTML = `<i class="fas fa-save"></i> ${isEdit ? 'Salvar' : 'Adicionar'}`
      }
    })
  },

  async _carregarUltimasReceitasPorCategoria(categoria) {
    const container = document.getElementById('r-ultimas-cat')
    const lista = document.getElementById('r-ultimas-cat-lista')
    if (!container || !lista || !categoria) return
    try {
      const data = await this.api('GET', `receitas?categoria=${encodeURIComponent(categoria)}&limit=5`)
      const itens = data.receitas || []
      if (itens.length === 0) { container.style.display = 'none'; return }
      container.style.display = 'block'
      lista.innerHTML = itens.map(r => `
        <div style="display:flex;justify-content:space-between;align-items:center;padding:4px 0;border-bottom:1px solid rgba(255,255,255,0.05);">
          <div>
            <span style="color:#e2e8f0;font-weight:500;">${r.descricao}</span>
            <span style="color:#64748b;font-size:0.75rem;margin-left:6px;">${this.formatDate(r.data)}</span>
          </div>
          <span style="color:#2FBF71;font-weight:700;">${this.formatMoney(r.valor)}</span>
        </div>
      `).join('')
    } catch(e) { container.style.display = 'none' }
  },

  async deleteReceita(id) {
    const ok = await this.vmConfirm('Deseja excluir esta receita permanentemente?', { titulo: 'Excluir Receita', corBotao: '#ef4444', textoBotao: 'Excluir', icone: '🗑️' })
    if (!ok) return
    try {
      await this.api('DELETE', `receitas/${id}`)
      this.toast('Receita excluída!')
      this.carregarReceitas()
    } catch (e) {
      this.toast('Erro ao excluir', 'error')
    }
  },

  // ── Seleção múltipla Receitas ──────────────────────────────────────────────
  _onSelReceita() {
    const chks = document.querySelectorAll('.rec-chk')
    const sel  = document.querySelectorAll('.rec-chk:checked')
    const bar  = document.getElementById('receitas-sel-bar')
    const cnt  = document.getElementById('receitas-sel-count')
    const all  = document.getElementById('rec-chk-all')
    if (bar)  bar.style.display  = sel.length > 0 ? 'flex' : 'none'
    if (cnt)  cnt.textContent    = `${sel.length} selecionada${sel.length !== 1 ? 's' : ''}`
    if (all)  all.indeterminate  = sel.length > 0 && sel.length < chks.length
    if (all)  all.checked        = sel.length > 0 && sel.length === chks.length
  },
  _selTodosReceitas(val) {
    document.querySelectorAll('.rec-chk').forEach(c => { c.checked = val })
    this._onSelReceita()
  },
  async _excluirSelecionadasReceitas() {
    const ids = [...document.querySelectorAll('.rec-chk:checked')].map(c => Number(c.dataset.id))
    if (!ids.length) return
    const ok = await this.vmConfirm(`Excluir ${ids.length} receita${ids.length !== 1 ? 's' : ''} permanentemente?`, { titulo: 'Excluir Receitas', corBotao: '#ef4444', textoBotao: `Excluir ${ids.length}`, icone: '🗑️' })
    if (!ok) return
    try {
      const res = await this.api('DELETE', 'receitas/bulk', { ids })
      this.toast(`✅ ${res.excluidas} receita${res.excluidas !== 1 ? 's' : ''} excluída${res.excluidas !== 1 ? 's' : ''}!`)
      this.carregarReceitas()
    } catch (e) {
      this.toast('Erro ao excluir', 'error')
    }
  },

  // ============== DESPESAS ==============
  async pageDespesas() {
    const now = new Date()
    // S1: restaurar filtro salvo; fallback para mês/ano atual
    const saved = this._despesaFiltro || {}
    const mes  = saved.mes  || String(now.getMonth() + 1)
    const ano  = saved.ano  || String(now.getFullYear())
    const stat = saved.status || ''

    document.getElementById('page-content').innerHTML = `
      <div class="section-header">
        <div>
          <div class="section-title">💸 Despesas</div>
          <div style="color:#666;font-size:0.85rem;margin-top:2px;">Controle seus gastos</div>
        </div>
        <button onclick="VM.modalDespesa()" class="btn-primary" style="width:auto;padding:10px 20px;">
          <i class="fas fa-plus"></i> Nova Despesa
        </button>
      </div>
      
      <div style="display:flex;gap:12px;margin-bottom:20px;flex-wrap:wrap;">
        <select id="filtro-mes-d" class="form-select" style="width:auto;padding:8px 14px;">
          ${['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'].map((m, i) => `<option value="${i+1}" ${String(i+1) === mes ? 'selected' : ''}>${m}</option>`).join('')}
        </select>
        <select id="filtro-ano-d" class="form-select" style="width:auto;padding:8px 14px;">
          ${[parseInt(ano)-1, parseInt(ano), parseInt(ano)+1].map(a => `<option value="${a}" ${String(a) === ano ? 'selected' : ''}>${a}</option>`).join('')}
        </select>
        <select id="filtro-status-d" class="form-select" style="width:auto;padding:8px 14px;">
          <option value="" ${stat===''?'selected':''}>Todos os status</option>
          <option value="pendente" ${stat==='pendente'?'selected':''}>Pendente</option>
          <option value="pago" ${stat==='pago'?'selected':''}>Pago</option>
        </select>
        <button onclick="VM.carregarDespesas()" class="btn-secondary"><i class="fas fa-search"></i> Filtrar</button>
      </div>
      
      <div id="despesas-stats" class="card" style="margin-bottom:20px;"></div>
      <div class="card" id="despesas-table-wrapper">
        <div class="empty-state"><div class="skeleton" style="height:200px;border-radius:12px;"></div></div>
      </div>
    `

    this.carregarDespesas()
  },

  async carregarDespesas(pagina = 1) {
    const mes = document.getElementById('filtro-mes-d')?.value || String(new Date().getMonth() + 1)
    const ano = document.getElementById('filtro-ano-d')?.value || String(new Date().getFullYear())
    const status = document.getElementById('filtro-status-d')?.value || ''
    const limit = 20
    const offset = (pagina - 1) * limit

    // S1: persistir filtro ativo para restaurar ao voltar à tela
    this._despesaFiltro = { mes, ano, status }
    
    try {
      const data = await this.api('GET', `despesas?mes=${mes}&ano=${ano}${status ? '&status=' + status : ''}&limit=${limit}&offset=${offset}`)
      // M-D1: usar totais reais do backend (sem depender do limit/offset da página)
      const pago     = data.total_pago     ?? data.despesas.filter(d => d.status === 'pago').reduce((s, d) => s + d.valor, 0)
      const pendente = data.total_pendente ?? data.despesas.filter(d => d.status === 'pendente').reduce((s, d) => s + d.valor, 0)
      const totalCount = data.total_count ?? data.count
      const totalPages = Math.max(1, Math.ceil(totalCount / limit))

      const statsEl = document.getElementById('despesas-stats')
      if (statsEl) {
        statsEl.innerHTML = `
          <div style="display:flex;gap:20px;align-items:center;flex-wrap:wrap;justify-content:space-between;">
            <div style="display:flex;gap:24px;flex-wrap:wrap;">
              <div><div style="color:#888;font-size:0.8rem;">Total</div><div style="font-size:1.4rem;font-weight:800;color:#ff6b6b;">${this.formatMoney(data.total)}</div></div>
              <div><div style="color:#888;font-size:0.8rem;">Pago</div><div style="font-size:1.4rem;font-weight:800;color:#2FBF71;">${this.formatMoney(pago)}</div></div>
              <div><div style="color:#888;font-size:0.8rem;">Pendente</div><div style="font-size:1.4rem;font-weight:800;color:#ffc400;">${this.formatMoney(pendente)}</div></div>
              <div><div style="color:#888;font-size:0.8rem;">Qtd</div><div style="font-size:1.4rem;font-weight:800;">${totalCount}</div></div>
            </div>
            ${data.count_pendente > 0 ? `
            <button onclick="VM.marcarTodasPagas('${mes}','${ano}')" class="btn-primary" style="width:auto;padding:8px 16px;font-size:0.82rem;background:linear-gradient(135deg,#2FBF71,#10a055);">
              <i class="fas fa-check-double"></i> Marcar todas como pagas (${data.count_pendente})
            </button>` : ''}
          </div>
        `
      }

      const wrapper = document.getElementById('despesas-table-wrapper')
      if (data.despesas.length === 0 && pagina === 1) {
        wrapper.innerHTML = `<div class="empty-state"><div class="empty-icon">🎉</div><h3>Sem despesas</h3><p>Período limpo!</p></div>`
        return
      }

      const catIcons = { 'Alimentação': '🍔', 'Transporte': '🚗', 'Saúde': '💊', 'Educação': '📚', 'Lazer': '🎬', 'Moradia': '🏠', 'Roupas': '👕', 'Outros': '📦' }

      const paginacao = totalPages > 1 ? `
        <div style="display:flex;align-items:center;justify-content:space-between;padding:14px 0 4px;flex-wrap:wrap;gap:8px;">
          <span style="font-size:0.8rem;color:#888;">Página <strong style="color:#ddd;">${pagina}</strong> de <strong style="color:#ddd;">${totalPages}</strong> · <strong style="color:#ff6b6b;">${totalCount}</strong> registros</span>
          <div style="display:flex;gap:6px;">
            <button onclick="VM.carregarDespesas(${pagina - 1})" ${pagina <= 1 ? 'disabled' : ''} style="padding:6px 14px;border-radius:8px;border:1px solid rgba(255,255,255,0.1);background:rgba(255,255,255,0.05);color:${pagina<=1?'#555':'#ddd'};cursor:${pagina<=1?'default':'pointer'};font-size:0.82rem;">← Anterior</button>
            <button onclick="VM.carregarDespesas(${pagina + 1})" ${pagina >= totalPages ? 'disabled' : ''} style="padding:6px 14px;border-radius:8px;border:1px solid rgba(255,255,255,0.1);background:rgba(255,255,255,0.05);color:${pagina>=totalPages?'#555':'#ddd'};cursor:${pagina>=totalPages?'default':'pointer'};font-size:0.82rem;">Próxima →</button>
          </div>
        </div>
      ` : `<div style="padding:10px 0 4px;font-size:0.8rem;color:#888;"><strong style="color:#ff6b6b;">${totalCount}</strong> registros</div>`

      wrapper.innerHTML = `
        <div id="desp-sel-bar" style="display:none;align-items:center;gap:12px;padding:10px 14px;margin-bottom:10px;background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.3);border-radius:10px;">
          <span id="desp-sel-count" style="color:#f87171;font-weight:600;font-size:0.88rem;">0 selecionadas</span>
          <button onclick="VM._selTodosDespesas(true)" style="padding:5px 12px;border-radius:7px;border:1px solid rgba(255,255,255,0.15);background:rgba(255,255,255,0.06);color:#ddd;font-size:0.8rem;cursor:pointer;">Selecionar tudo</button>
          <button onclick="VM._selTodosDespesas(false)" style="padding:5px 12px;border-radius:7px;border:1px solid rgba(255,255,255,0.1);background:transparent;color:#888;font-size:0.8rem;cursor:pointer;">Limpar</button>
          <button onclick="VM._excluirSelecionadasDespesas()" style="padding:5px 14px;border-radius:7px;border:none;background:#ef4444;color:#fff;font-size:0.82rem;font-weight:600;cursor:pointer;"><i class="fas fa-trash" style="margin-right:5px;"></i>Excluir selecionadas</button>
        </div>
        <div style="overflow-x:auto;-webkit-overflow-scrolling:touch;">
          <table class="data-table" style="min-width:820px;">
            <thead>
              <tr>
                <th style="width:36px;"><input type="checkbox" id="desp-chk-all" onchange="VM._selTodosDespesas(this.checked)" style="cursor:pointer;width:16px;height:16px;"></th>
                <th>Descrição</th>
                <th>Categoria</th>
                <th>Data</th>
                <th>Tipo</th>
                <th>Status</th>
                <th style="text-align:right;">Valor</th>
                <th style="text-align:right;">Ações</th>
              </tr>
            </thead>
            <tbody>
              ${data.despesas.map(d => {
                // S3: badge de parcelas com link para filtrar grupo
                const parcelaBadge = d.parcelado && d.numero_parcelas > 1
                  ? `<span title="Parcela ${d.parcela_atual}/${d.numero_parcelas} — clique para ver grupo" 
                       onclick="VM.filtrarGrupoParcela('${d.purchase_group_id || ''}', ${d.numero_parcelas}, '${(d.descricao||'').replace(/\s*\(\d+\/\d+\)$/, '')}')"
                       style="display:inline-block;margin-left:6px;padding:1px 7px;border-radius:20px;font-size:0.72rem;font-weight:700;background:rgba(99,102,241,0.15);color:#6366f1;cursor:pointer;border:1px solid rgba(99,102,241,0.3);">
                       💳 ${d.parcela_atual}/${d.numero_parcelas}
                     </span>`
                  : ''
                return `
                <tr id="desp-row-${d.id}">
                  <td><input type="checkbox" class="desp-chk" data-id="${d.id}" onchange="VM._onSelDespesa()" style="cursor:pointer;width:16px;height:16px;"></td>
                  <td style="font-weight:500;">${d.descricao}${parcelaBadge}</td>
                  <td><span class="badge badge-red">${catIcons[d.categoria] || '📦'} ${d.categoria}</span></td>
                  <td style="color:#888;">${this.formatDate(d.data)}</td>
                  <td><span class="badge ${d.fixa_ou_variavel === 'fixa' ? 'badge-blue' : 'badge-yellow'}">${d.fixa_ou_variavel === 'fixa' ? '🔒 Fixa' : '🔀 Variável'}</span></td>
                  <td>
                    <span class="badge ${d.status === 'pago' ? 'badge-green' : 'badge-yellow'}" 
                      onclick="VM.toggleDespesaStatus(${d.id}, '${d.status}')" style="cursor:pointer;" title="Clique para alterar">
                      ${d.status === 'pago' ? '✅ Pago' : '⏳ Pendente'}
                    </span>
                  </td>
                  <td style="text-align:right;font-weight:700;color:#ff6b6b;">${this.formatMoney(d.valor)}</td>
                  <td style="text-align:right;white-space:nowrap;">
                    <button onclick="VM.modalDespesa(${JSON.stringify(d).replace(/"/g, '&quot;')})" class="btn-success" style="margin-right:4px;" title="Editar"><i class="fas fa-edit"></i></button>
                    <button onclick="VM.deleteDespesa(${d.id})" class="btn-danger" title="Excluir"><i class="fas fa-trash"></i></button>
                  </td>
                </tr>
              `}).join('')}
            </tbody>
          </table>
        </div>
        ${paginacao}
      `
    } catch (e) {
      this.toast('Erro ao carregar despesas', 'error')
    }
  },

  async toggleDespesaStatus(id, status) {
    const novoStatus = status === 'pago' ? 'pendente' : 'pago'
    try {
      await this.api('PATCH', `despesas/${id}/status`, { status: novoStatus })
      if (novoStatus === 'pago') {
        this.toast(`✅ Despesa paga! Limite do cartão restaurado automaticamente.`)
      } else {
        this.toast(`⏳ Despesa reaberta`)
      }
      this.carregarDespesas()
    } catch (e) {
      this.toast('Erro ao atualizar', 'error')
    }
  },

  // S2 – Marcar todas as despesas pendentes do período como pagas em lote
  async marcarTodasPagas(mes, ano) {
    const ok = await this.vmConfirm(`Marcar <strong>TODAS</strong> as despesas pendentes de ${mes}/${ano} como pagas? Essa ação não pode ser desfeita.`, { titulo: 'Marcar Todas como Pagas', corBotao: '#2FBF71', textoBotao: 'Confirmar', icone: '✅' })
    if (!ok) return
    try {
      const r = await this.api('PATCH', 'despesas/batch-status', { mes, ano, status: 'pago' })
      this.toast(`✅ ${r.message}`, 'success')
      this.carregarDespesas()
    } catch(e) {
      this.toast('Erro ao atualizar despesas em lote', 'error')
    }
  },

  // S3 – Filtrar todas as parcelas do mesmo grupo (por purchase_group_id ou descrição base)
  async filtrarGrupoParcela(groupId, totalParcelas, descBase) {
    if (!groupId && !descBase) return
    try {
      // Buscar todas as despesas sem filtro de mês para pegar todas as parcelas
      const data = await this.api('GET', `despesas?limit=200`)
      const parcelas = groupId
        ? data.despesas.filter(d => d.purchase_group_id === groupId)
        : data.despesas.filter(d => d.descricao?.startsWith(descBase) && d.numero_parcelas === totalParcelas)

      if (parcelas.length === 0) {
        this.toast('Nenhuma parcela encontrada', 'warning')
        return
      }

      const total = parcelas.reduce((s, d) => s + (d.valor || 0), 0)
      const pagas = parcelas.filter(d => d.status === 'pago').length
      const mesesList = [...new Set(parcelas.map(d => d.data?.substring(0, 7)))].sort()

      document.getElementById('modal-container').innerHTML = `
        <div class="modal-overlay" onclick="VM.closeModal(event)">
          <div class="modal" style="max-width:520px;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;">
              <h3 style="font-size:1.1rem;font-weight:700;">💳 Parcelas: ${descBase}</h3>
              <button onclick="VM.closeModal()" style="background:none;border:none;color:#666;font-size:1.2rem;cursor:pointer;">✕</button>
            </div>
            <div style="display:flex;gap:16px;margin-bottom:16px;flex-wrap:wrap;">
              <div style="background:#f8f9fa;border-radius:10px;padding:12px 18px;flex:1;">
                <div style="color:#888;font-size:0.78rem;">Total do grupo</div>
                <div style="font-size:1.2rem;font-weight:800;color:#ff6b6b;">${this.formatMoney(total)}</div>
              </div>
              <div style="background:#f8f9fa;border-radius:10px;padding:12px 18px;flex:1;">
                <div style="color:#888;font-size:0.78rem;">Pagas</div>
                <div style="font-size:1.2rem;font-weight:800;color:#2FBF71;">${pagas}/${parcelas.length}</div>
              </div>
            </div>
            <div style="overflow:auto;max-height:320px;">
              <table class="data-table" style="font-size:0.85rem;">
                <thead><tr><th>Parcela</th><th>Vencimento</th><th>Status</th><th style="text-align:right;">Valor</th></tr></thead>
                <tbody>
                  ${parcelas.map(d => `
                    <tr>
                      <td style="font-weight:600;">${d.parcela_atual}/${d.numero_parcelas}</td>
                      <td>${this.formatDate(d.data)}</td>
                      <td>
                        <span class="badge ${d.status === 'pago' ? 'badge-green' : 'badge-yellow'}" 
                          onclick="VM.toggleDespesaStatus(${d.id}, '${d.status}');VM.closeModal();" style="cursor:pointer;">
                          ${d.status === 'pago' ? '✅ Pago' : '⏳ Pendente'}
                        </span>
                      </td>
                      <td style="text-align:right;font-weight:700;">${this.formatMoney(d.valor)}</td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
            <div style="margin-top:16px;text-align:right;">
              <button onclick="VM.closeModal()" class="btn-secondary">Fechar</button>
            </div>
          </div>
        </div>
      `
    } catch(e) {
      this.toast('Erro ao carregar parcelas', 'error')
    }
  },

  async modalDespesa(despesa = null) {
    const isEdit = !!despesa
    const today = new Date().toISOString().split('T')[0]
    const categorias = ['Alimentação', 'Transporte', 'Saúde', 'Educação', 'Lazer', 'Moradia', 'Roupas', 'Assinaturas', 'Pets', 'Outros']

    // Buscar cartões e tags em paralelo
    let cartoes = [], tagsDisponiveis = [], tagsDaDespesa = []
    try {
      const [cartData, tagsData] = await Promise.all([
        this.api('GET', 'cartoes').catch(() => ({})),
        this.api('GET', 'tags').catch(() => [])
      ])
      cartoes = cartData.cartoes || []
      tagsDisponiveis = tagsData || []
      // Se edição, buscar tags já vinculadas
      if (isEdit && despesa.id) {
        try { tagsDaDespesa = await this.api('GET', `tags/despesa/${despesa.id}`) } catch(e) { tagsDaDespesa = [] }
      }
    } catch(e) { cartoes = [] }

    const cartaoOptions = cartoes.map(c => `<option value="${c.id}" ${despesa?.cartao_id == c.id ? 'selected' : ''}>${c.nome} (${c.bandeira || 'Cartão'})</option>`).join('')

    document.getElementById('modal-container').innerHTML = `
      <div class="modal-overlay" onclick="VM.closeModal(event)">
        <div class="modal" style="max-width:520px;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:24px;">
            <h3 style="font-size:1.1rem;font-weight:700;">${isEdit ? '✏️ Editar' : '💸 Nova'} Despesa</h3>
            <button onclick="VM.closeModal()" style="background:none;border:none;color:#666;font-size:1.2rem;cursor:pointer;">✕</button>
          </div>
          <form id="despesa-form">
            <div class="form-group">
              <label class="form-label">Descrição *</label>
              <input type="text" id="d-desc" class="form-input" placeholder="Ex: Supermercado" value="${despesa?.descricao || ''}" required>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
              <div class="form-group">
                <label class="form-label">Categoria *</label>
                <select id="d-cat" class="form-select" onchange="VM.verificarOrcamentoModal()">
                  ${categorias.map(c => `<option value="${c}" ${despesa?.categoria === c ? 'selected' : ''}>${c}</option>`).join('')}
                </select>
              </div>
              <div class="form-group">
                <label class="form-label">Data *</label>
                <input type="date" id="d-data" class="form-input" value="${despesa?.data || today}" required>
              </div>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
              <div class="form-group">
                <label class="form-label" id="d-valor-label">Valor Total (R$) *</label>
                <input type="number" id="d-valor" class="form-input" placeholder="0,00" step="0.01" min="0" value="${despesa?.valor || ''}" oninput="document.getElementById('d-ultimo-editado').value='total';VM.atualizarPreviewParcela();VM.verificarOrcamentoModal()" required>
              </div>
              <div class="form-group">
                <label class="form-label">Tipo</label>
                <select id="d-tipo" class="form-select">
                  <option value="variavel" ${despesa?.fixa_ou_variavel !== 'fixa' ? 'selected' : ''}>Variável</option>
                  <option value="fixa" ${despesa?.fixa_ou_variavel === 'fixa' ? 'selected' : ''}>Fixa</option>
                </select>
              </div>
            </div>
            <input type="hidden" id="d-ultimo-editado" value="total">

            <!-- Bloco 2.3: Alerta de Orçamento em Tempo Real -->
            <div id="alertaOrcamento" style="display:none;background:rgba(255,107,107,0.1);border:1px solid rgba(255,107,107,0.35);border-radius:10px;padding:10px 14px;margin-bottom:12px;font-size:0.82rem;line-height:1.5;"></div>

            <!-- Forma de pagamento -->
            <div class="form-group">
              <label class="form-label">💳 Forma de Pagamento</label>
              <select id="d-meio" class="form-select" onchange="VM.onChangeMeioPagamento(this.value);VM._carregarUltimasDespesasPorMeio(this.value)">
                <option value="dinheiro" ${(despesa?.meio_pagamento||'dinheiro')==='dinheiro'?'selected':''}>💵 Dinheiro / À vista</option>
                <option value="pix" ${despesa?.meio_pagamento==='pix'?'selected':''}>⚡ PIX</option>
                <option value="cartao_debito" ${despesa?.meio_pagamento==='cartao_debito'?'selected':''}>💳 Cartão de Débito</option>
                <option value="cartao_credito" ${despesa?.meio_pagamento==='cartao_credito'?'selected':''}>💳 Cartão de Crédito (à vista)</option>
                <option value="boleto" ${despesa?.meio_pagamento==='boleto'?'selected':''}>📄 Boleto</option>
                <option value="transferencia" ${despesa?.meio_pagamento==='transferencia'?'selected':''}>🏦 Transferência</option>
                ${!isEdit ? `<option value="parcelado_cartao" ${despesa?.parcelado?'selected':''}>💳 Cartão de Crédito Parcelado</option>` : ''}
              </select>
            </div>

            <!-- Últimas despesas desta forma de pagamento -->
            <div id="d-ultimas-meio" style="display:none;margin-bottom:14px;background:rgba(255,107,107,0.06);border:1px solid rgba(255,107,107,0.2);border-radius:10px;padding:10px 12px;">
              <div style="font-size:0.75rem;color:#ff6b6b;font-weight:700;margin-bottom:8px;text-transform:uppercase;letter-spacing:0.5px;">
                <i class="fas fa-history"></i> Últimas com este método
              </div>
              <div id="d-ultimas-meio-lista" style="font-size:0.82rem;"></div>
            </div>

            <!-- Cartão (aparece quando meio = cartao_credito ou parcelado_cartao) -->
            <div id="d-cartao-wrapper" style="display:${(despesa?.meio_pagamento==='cartao_credito'||despesa?.parcelado)?'block':'none'};">
              <div class="form-group">
                <label class="form-label">Selecionar Cartão</label>
                <select id="d-cartao-id" class="form-select" onchange="VM.inferirMesFaturamento(this.value)">
                  <option value="">— Sem cartão específico —</option>
                  ${cartaoOptions}
                </select>
                ${cartoes.length === 0 ? `<div style="font-size:0.75rem;color:#888;margin-top:4px;">⚠️ Nenhum cartão cadastrado. <a href="#" onclick="VM.navigate('cartoes');VM.closeModal();" style="color:#2FBF71;">Cadastrar cartão</a></div>` : ''}
              </div>
              <!-- Info de mês de faturamento inferido -->
              <div id="d-billing-info" style="display:none;margin-bottom:12px;"></div>
            </div>

            <!-- Parcelas (aparece somente para parcelado) -->
            ${!isEdit ? `
              <div id="d-parcelas-wrapper" style="display:none;">
                <!-- Número de parcelas + valor da parcela (bidirecional) -->
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
                  <div class="form-group">
                    <label class="form-label">🔢 Nº Total de Parcelas *</label>
                    <input type="number" id="d-parcelas" class="form-input" min="2" max="60" value="2" placeholder="Ex: 12"
                      oninput="VM.atualizarPreviewParcela()">
                  </div>
                  <div class="form-group">
                    <label class="form-label">💰 Valor da Parcela (R$)</label>
                    <input type="number" id="d-vparcela" class="form-input" step="0.01" min="0" placeholder="Calculado auto"
                      oninput="document.getElementById('d-ultimo-editado').value='parcela';VM.atualizarPreviewParcela()">
                  </div>
                </div>
                <div style="font-size:0.78rem;color:#2FBF71;margin-top:-8px;margin-bottom:12px;" id="d-parcelas-preview"></div>

                <!-- Compra retroativa -->
                <div style="background:rgba(47,191,113,0.06);border:1px solid rgba(47,191,113,0.2);border-radius:10px;padding:12px;margin-bottom:12px;">
                  <label style="display:flex;align-items:center;gap:10px;cursor:pointer;font-size:0.88rem;font-weight:600;color:#ccc;">
                    <input type="checkbox" id="d-retro-sim" onchange="VM.onChangeRetroativa(this.checked)"
                      style="width:18px;height:18px;accent-color:#2FBF71;cursor:pointer;">
                    📅 Esta compra já está parcelada (parcelas retroativas)
                  </label>
                  <div style="font-size:0.75rem;color:#888;margin-top:6px;padding-left:28px;">
                    Ex: comprou em janeiro, está cadastrando em março — informe quantas parcelas ainda restam.
                  </div>
                  <div id="d-retro-parcelas-wrapper" style="display:none;margin-top:12px;">
                    <label class="form-label">📆 Parcelas Restantes (a partir de hoje) *</label>
                    <input type="number" id="d-parcelas-restantes" class="form-input" min="1" placeholder="Ex: 10"
                      oninput="VM.atualizarPreviewParcela()">
                    <div style="font-size:0.75rem;color:#888;margin-top:4px;">
                      O sistema criará apenas as parcelas restantes a partir da data informada.
                    </div>
                  </div>
                </div>
              </div>
            ` : ''}

            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
              <div class="form-group">
                <label class="form-label">Status</label>
                <select id="d-status" class="form-select">
                  <option value="pendente" ${despesa?.status !== 'pago' ? 'selected' : ''}>Pendente</option>
                  <option value="pago" ${despesa?.status === 'pago' ? 'selected' : ''}>Pago</option>
                </select>
              </div>
              <div class="form-group">
                <label class="form-label">Vencimento</label>
                <input type="date" id="d-venc" class="form-input" value="${despesa?.vencimento || ''}">
              </div>
            </div>
            <!-- BUG 1.2 FIX: Aporte / Transferência Patrimonial -->
            <div style="background:rgba(99,102,241,0.08);border:1px solid rgba(99,102,241,0.25);border-radius:10px;padding:12px;margin-bottom:12px;">
              <label style="display:flex;align-items:center;gap:10px;cursor:pointer;font-size:0.88rem;font-weight:600;color:#ccc;">
                <input type="checkbox" id="d-eh-aporte" style="width:18px;height:18px;accent-color:#818cf8;cursor:pointer;" ${(despesa?.tipo==='aporte')?'checked':''}>
                💼 É Aporte / Transferência Patrimonial
              </label>
              <div style="font-size:0.75rem;color:#888;margin-top:6px;padding-left:28px;">
                Marque se este lançamento é um investimento ou transferência entre contas. Não será contabilizado nas despesas do mês nem na regra 50/30/20.
              </div>
            </div>

            <!-- Seletor de Tags -->
            ${tagsDisponiveis.length > 0 ? `
            <div class="form-group" style="margin-bottom:12px;">
              <label class="form-label">🏷️ Tags</label>
              <div id="d-tags-chips" style="display:flex;flex-wrap:wrap;gap:6px;padding:8px;background:rgba(15,23,42,0.4);border:1px solid rgba(255,255,255,0.08);border-radius:10px;min-height:38px;">
                ${tagsDisponiveis.map(t => {
                  const sel = tagsDaDespesa.some(td => td.id === t.id)
                  return `<span data-tag-id="${t.id}" data-tag-cor="${t.cor}" data-tag-selected="${sel ? '1' : '0'}" onclick="VM._toggleTag(this)" style="display:inline-flex;align-items:center;gap:5px;padding:4px 10px;border-radius:20px;font-size:0.75rem;cursor:pointer;border:1.5px solid ${sel ? t.cor : 'rgba(255,255,255,0.1)'};background:${sel ? t.cor+'22' : 'transparent'};color:${sel ? t.cor : '#94A3B8'};transition:all 0.15s;user-select:none;">
                    <span style="width:7px;height:7px;border-radius:50%;background:${t.cor};flex-shrink:0;"></span>
                    ${t.nome}
                  </span>`
                }).join('')}
              </div>
              <div style="font-size:0.72rem;color:#475569;margin-top:4px;">Clique para selecionar. <a href="#" onclick="VM.closeModal();VM.navigate('tags');" style="color:#2FBF71;">Gerenciar tags</a></div>
            </div>
            ` : `
            <div class="form-group" style="margin-bottom:12px;">
              <label class="form-label">🏷️ Tags</label>
              <div style="font-size:0.8rem;color:#475569;padding:8px 0;">Nenhuma tag criada. <a href="#" onclick="VM.closeModal();VM.navigate('tags');" style="color:#2FBF71;">Criar tags</a></div>
            </div>
            `}

            <div style="display:flex;gap:12px;margin-top:8px;">
              <button type="button" onclick="VM.closeModal()" class="btn-secondary" style="flex:1;justify-content:center;">Cancelar</button>
              <button type="submit" class="btn-primary" style="flex:1;" id="d-submit">
                <i class="fas fa-save"></i> ${isEdit ? 'Salvar' : 'Adicionar'}
              </button>
            </div>
          </form>
        </div>
      </div>
    `

    // Inicializar estado do form
    VM.onChangeMeioPagamento(despesa?.parcelado ? 'parcelado_cartao' : (despesa?.meio_pagamento || 'dinheiro'))
    // Carregar últimas despesas do meio de pagamento inicial
    this._carregarUltimasDespesasPorMeio(despesa?.parcelado ? 'parcelado_cartao' : (despesa?.meio_pagamento || 'dinheiro'))

    // Quando alterar a data, recalcular billing se cartão estiver selecionado
    const dataInput = document.getElementById('d-data')
    if (dataInput) {
      dataInput.addEventListener('change', () => {
        const cartaoId = document.getElementById('d-cartao-id')?.value
        if (cartaoId) VM.inferirMesFaturamento(cartaoId)
      })
    }
    // Se há cartão pré-selecionado (edição), mostrar billing
    if (despesa?.cartao_id) {
      setTimeout(() => VM.inferirMesFaturamento(String(despesa.cartao_id)), 100)
    }

    document.getElementById('despesa-form').addEventListener('submit', async (e) => {
      e.preventDefault()
      const btn = document.getElementById('d-submit')
      btn.disabled = true
      btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Salvando...'
      try {
        const meio = document.getElementById('d-meio')?.value || 'dinheiro'
        const parcelado = !isEdit && meio === 'parcelado_cartao'
        const cartaoId = document.getElementById('d-cartao-id')?.value || null
        // Retroativa: usar parcelas restantes se marcado
        const isRetroativa = parcelado && document.getElementById('d-retro-sim')?.checked
        const numParcelasTotal = parcelado ? parseInt(document.getElementById('d-parcelas').value) : 1
        const numParcelasRestantes = isRetroativa
          ? parseInt(document.getElementById('d-parcelas-restantes')?.value) || numParcelasTotal
          : numParcelasTotal
        // Valor: usar valor total (já calculado bidirecionalmente)
        const valorTotal = parseFloat(document.getElementById('d-valor').value)
        const valorParcelaDigitado = parseFloat(document.getElementById('d-vparcela')?.value) || 0

        // CORREÇÃO: valor da parcela = total / total_original (não / restantes)
        // Ex: compra 10x R$222,29 → total R$2.222,90 → parcela = 2222.90/10 = 222.29
        // Se retroativa: enviar valor_parcela separado para o backend não recalcular errado
        const valorParcelaFinal = isRetroativa
          ? (valorParcelaDigitado > 0 ? valorParcelaDigitado : (numParcelasTotal > 0 ? valorTotal / numParcelasTotal : valorTotal))
          : (numParcelasRestantes > 0 ? valorTotal / numParcelasRestantes : valorTotal)

        const payload = {
          descricao: document.getElementById('d-desc').value,
          categoria: document.getElementById('d-cat').value,
          data: document.getElementById('d-data').value,
          valor: isRetroativa ? valorParcelaFinal * numParcelasRestantes : valorTotal,
          valor_parcela_override: isRetroativa ? valorParcelaFinal : null,
          fixa_ou_variavel: document.getElementById('d-tipo').value,
          status: document.getElementById('d-status').value,
          vencimento: document.getElementById('d-venc').value || null,
          meio_pagamento: parcelado ? 'parcelado_cartao' : meio,
          cartao_id: (meio === 'cartao_credito' || meio === 'parcelado_cartao') ? (cartaoId || null) : null,
          parcelado,
          numero_parcelas: numParcelasRestantes,
          parcelas_total_original: isRetroativa ? numParcelasTotal : numParcelasRestantes,
          // BUG 1.2 FIX: se marcado como aporte, tipo='aporte' → não entra nas despesas do mês
          tipo: document.getElementById('d-eh-aporte')?.checked ? 'aporte' : 'normal'
        }

        // Validação: cartão obrigatório se meio for cartão de crédito
        if ((meio === 'cartao_credito' || meio === 'parcelado_cartao') && !cartaoId) {
          this.toast('Selecione um cartão de crédito para este tipo de pagamento.', 'error')
          btn.disabled = false
          btn.innerHTML = `<i class=\"fas fa-save\"></i> ${isEdit ? 'Salvar' : 'Adicionar'}`
          return
        }

        let savedId = null
        if (isEdit) {
          await this.api('PUT', `despesas/${despesa.id}`, payload)
          savedId = despesa.id
        } else {
          const res = await this.api('POST', 'despesas', payload)
          // Backend retorna { ids: [id1, id2, ...] } para parceladas ou id único
          savedId = Array.isArray(res?.ids) ? res.ids[0] : (res?.id || null)
        }

        // Vincular tags selecionadas (se houver)
        const tagsSel = this._getTagsSelecionadas()
        if (savedId && tagsSel.length > 0) {
          try { await this.api('POST', `tags/despesa/${savedId}`, { tag_ids: tagsSel }) } catch(e) {}
        }

        const msg = isEdit ? 'Despesa atualizada!'
          : parcelado ? (isRetroativa
            ? `${numParcelasRestantes} parcelas restantes criadas! 📅`
            : `${numParcelasRestantes} parcelas criadas! 💸`)
          : 'Despesa adicionada!'
        this.toast(msg)
        this.closeModal()
        this.carregarDespesas()
      } catch (err) {
        this.toast(err.response?.data?.error || 'Erro ao salvar', 'error')
        btn.disabled = false
        btn.innerHTML = `<i class="fas fa-save"></i> ${isEdit ? 'Salvar' : 'Adicionar'}`
      }
    })
  },

  async _carregarUltimasDespesasPorMeio(meio) {
    const container = document.getElementById('d-ultimas-meio')
    const lista = document.getElementById('d-ultimas-meio-lista')
    if (!container || !lista || !meio || meio === 'parcelado_cartao') {
      if (container) container.style.display = 'none'
      return
    }
    try {
      const data = await this.api('GET', `despesas?meio_pagamento=${encodeURIComponent(meio)}&limit=5`)
      const itens = data.despesas || []
      if (itens.length === 0) { container.style.display = 'none'; return }
      container.style.display = 'block'
      const meioLabel = { dinheiro: '💵 Dinheiro', pix: '⚡ PIX', cartao_debito: '💳 Débito', cartao_credito: '💳 Crédito', boleto: '📄 Boleto', transferencia: '🏦 Transf.' }
      lista.innerHTML = itens.map(d => `
        <div style="display:flex;justify-content:space-between;align-items:center;padding:4px 0;border-bottom:1px solid rgba(255,255,255,0.05);">
          <div>
            <span style="color:#e2e8f0;font-weight:500;">${d.descricao}</span>
            <span style="color:#64748b;font-size:0.75rem;margin-left:6px;">${this.formatDate(d.data)}</span>
          </div>
          <span style="color:#ff6b6b;font-weight:700;">${this.formatMoney(d.valor)}</span>
        </div>
      `).join('')
    } catch(e) { container.style.display = 'none' }
  },

  async deleteDespesa(id) {
    const ok = await this.vmConfirm('Deseja excluir esta despesa permanentemente?', { titulo: 'Excluir Despesa', corBotao: '#ef4444', textoBotao: 'Excluir', icone: '🗑️' })
    if (!ok) return
    try {
      await this.api('DELETE', `despesas/${id}`)
      this.toast('Despesa excluída!')
      this.carregarDespesas()
    } catch (e) {
      this.toast('Erro ao excluir', 'error')
    }
  },

  // ── Seleção múltipla Despesas ──────────────────────────────────────────────
  _onSelDespesa() {
    const chks = document.querySelectorAll('.desp-chk')
    const sel  = document.querySelectorAll('.desp-chk:checked')
    const bar  = document.getElementById('desp-sel-bar')
    const cnt  = document.getElementById('desp-sel-count')
    const all  = document.getElementById('desp-chk-all')
    if (bar)  bar.style.display  = sel.length > 0 ? 'flex' : 'none'
    if (cnt)  cnt.textContent    = `${sel.length} selecionada${sel.length !== 1 ? 's' : ''}`
    if (all)  all.indeterminate  = sel.length > 0 && sel.length < chks.length
    if (all)  all.checked        = sel.length > 0 && sel.length === chks.length
  },
  _selTodosDespesas(val) {
    document.querySelectorAll('.desp-chk').forEach(c => { c.checked = val })
    this._onSelDespesa()
  },
  async _excluirSelecionadasDespesas() {
    const ids = [...document.querySelectorAll('.desp-chk:checked')].map(c => Number(c.dataset.id))
    if (!ids.length) return
    const ok = await this.vmConfirm(`Excluir ${ids.length} despesa${ids.length !== 1 ? 's' : ''} permanentemente?`, { titulo: 'Excluir Despesas', corBotao: '#ef4444', textoBotao: `Excluir ${ids.length}`, icone: '🗑️' })
    if (!ok) return
    try {
      const res = await this.api('DELETE', 'despesas/bulk', { ids })
      this.toast(`✅ ${res.excluidas} despesa${res.excluidas !== 1 ? 's' : ''} excluída${res.excluidas !== 1 ? 's' : ''}!`)
      this.carregarDespesas()
    } catch (e) {
      this.toast('Erro ao excluir', 'error')
    }
  },

  // ============== METAS ==============
  async pageMetas() {
    document.getElementById('page-content').innerHTML = `
      <div class="section-header">
        <div>
          <div class="section-title">🎯 Metas Financeiras</div>
          <div style="color:#666;font-size:0.85rem;margin-top:2px;">Seus objetivos e conquistas</div>
        </div>
        <button onclick="VM.modalMeta()" class="btn-primary" style="width:auto;padding:10px 20px;">
          <i class="fas fa-plus"></i> Nova Meta
        </button>
      </div>
      <div id="metas-container">
        <div class="empty-state"><div class="skeleton" style="height:200px;border-radius:16px;"></div></div>
      </div>
    `
    this.carregarMetas()
  },

  async carregarMetas() {
    try {
      const data = await this.api('GET', 'metas')
      const container = document.getElementById('metas-container')
      
      if (data.metas.length === 0) {
        container.innerHTML = `<div class="empty-state"><div class="empty-icon">🎯</div><h3>Nenhuma meta ainda</h3><p>Crie sua primeira meta financeira!</p></div>`
        return
      }

      const ativas = data.metas.filter(m => m.status === 'ativa')
      const concluidas = data.metas.filter(m => m.status === 'concluida')

      container.innerHTML = `
        ${ativas.length > 0 ? `
          <div style="margin-bottom:32px;">
            <div style="font-size:0.85rem;font-weight:600;color:#888;letter-spacing:1px;text-transform:uppercase;margin-bottom:16px;">Ativas (${ativas.length})</div>
            <div class="grid-3">
              ${ativas.map(m => this.renderMetaCard(m)).join('')}
            </div>
          </div>
        ` : ''}
        ${concluidas.length > 0 ? `
          <div>
            <div style="font-size:0.85rem;font-weight:600;color:#888;letter-spacing:1px;text-transform:uppercase;margin-bottom:16px;">Concluídas (${concluidas.length})</div>
            <div class="grid-3">
              ${concluidas.map(m => this.renderMetaCard(m)).join('')}
            </div>
          </div>
        ` : ''}
      `
    } catch (e) {
      this.toast('Erro ao carregar metas', 'error')
    }
  },

  renderMetaCard(m) {
    const isConcluida = m.status === 'concluida'
    return `
      <div class="card" style="border-color:${m.cor || '#2FBF71'}30;${isConcluida ? 'opacity:0.8;' : ''}">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:16px;">
          <div>
            <div style="font-size:1.1rem;font-weight:700;">${m.nome}</div>
            ${m.descricao ? `<div style="color:#666;font-size:0.8rem;margin-top:2px;">${m.descricao}</div>` : ''}
          </div>
          ${isConcluida ? '<span class="badge badge-green">🏆 Concluída</span>' : ''}
        </div>
        
        <div style="margin-bottom:16px;">
          <div style="display:flex;justify-content:space-between;margin-bottom:8px;">
            <span style="font-size:0.8rem;color:#888;">Progresso</span>
            <span style="font-size:0.9rem;font-weight:700;color:${m.cor || '#2FBF71'};">${m.percentual}%</span>
          </div>
          <div class="progress-bar">
            <div class="progress-fill" style="width:${Math.min(100, m.percentual)}%;background:${m.cor || '#2FBF71'};"></div>
          </div>
        </div>
        
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px;">
          <div style="background:rgba(255,255,255,0.03);border-radius:10px;padding:10px;">
            <div style="color:#666;font-size:0.72rem;">Atual</div>
            <div style="font-weight:700;font-size:0.9rem;color:${m.cor || '#2FBF71'};">${this.formatMoney(m.valor_atual)}</div>
          </div>
          <div style="background:rgba(255,255,255,0.03);border-radius:10px;padding:10px;">
            <div style="color:#666;font-size:0.72rem;">Objetivo</div>
            <div style="font-weight:700;font-size:0.9rem;">${this.formatMoney(m.valor_objetivo)}</div>
          </div>
        </div>
        
        ${!isConcluida ? `
          <div style="background:rgba(255,255,255,0.03);border-radius:10px;padding:10px;margin-bottom:16px;">
            <div style="display:flex;justify-content:space-between;font-size:0.8rem;">
              <span style="color:#666;">Meta: ${this.formatDate(m.data_meta)}</span>
              <span style="color:#2FBF71;">${this.formatMoney(m.mensalidade_necessaria)}/mês</span>
            </div>
            <div style="color:#555;font-size:0.75rem;margin-top:2px;">${m.meses_restantes} meses restantes</div>
          </div>
        ` : ''}
        
        <div style="display:flex;gap:8px;">
          ${!isConcluida ? `
            <button onclick="VM.modalDeposito(${m.id}, '${m.nome}')" class="btn-success" style="flex:1;justify-content:center;font-size:0.8rem;">
              <i class="fas fa-plus"></i> Depositar
            </button>
          ` : ''}
          <button onclick="VM.modalMeta(${JSON.stringify(m).replace(/"/g, '&quot;')})" class="btn-secondary" style="font-size:0.8rem;padding:6px 12px;">
            <i class="fas fa-edit"></i>
          </button>
          <button onclick="VM.deleteMeta(${m.id})" class="btn-danger">
            <i class="fas fa-trash"></i>
          </button>
        </div>
      </div>
    `
  },

  modalDeposito(id, nome) {
    document.getElementById('modal-container').innerHTML = `
      <div class="modal-overlay" onclick="VM.closeModal(event)">
        <div class="modal" style="max-width:380px;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:24px;">
            <h3 style="font-size:1.1rem;font-weight:700;">💰 Depositar em "${nome}"</h3>
            <button onclick="VM.closeModal()" style="background:none;border:none;color:#666;font-size:1.2rem;cursor:pointer;">✕</button>
          </div>
          <div class="form-group">
            <label class="form-label">Valor a depositar (R$)</label>
            <input type="number" id="dep-valor" class="form-input" placeholder="0,00" step="0.01" min="0.01">
          </div>
          <div style="display:flex;gap:12px;margin-top:8px;">
            <button onclick="VM.closeModal()" class="btn-secondary" style="flex:1;justify-content:center;">Cancelar</button>
            <button onclick="VM.fazerDeposito(${id})" class="btn-primary" style="flex:1;" id="dep-btn">
              <i class="fas fa-check"></i> Confirmar
            </button>
          </div>
        </div>
      </div>
    `
  },

  async fazerDeposito(id) {
    const valor = parseFloat(document.getElementById('dep-valor').value)
    if (!valor || valor <= 0) { this.toast('Informe um valor válido', 'warning'); return }
    const btn = document.getElementById('dep-btn')
    btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>'
    try {
      const res = await this.api('PATCH', `metas/${id}/deposito`, { valor })
      this.toast(res.message)
      this.closeModal()
      this.carregarMetas()
    } catch (e) {
      this.toast('Erro ao depositar', 'error')
      btn.disabled = false; btn.innerHTML = '<i class="fas fa-check"></i> Confirmar'
    }
  },

  async modalMeta(meta = null) {
    const isEdit = !!meta
    const today = new Date()
    const future = new Date(today); future.setFullYear(future.getFullYear() + 1)
    const defaultDate = future.toISOString().split('T')[0]
    const cores = ['#2FBF71', '#208040', '#74b9ff', '#a29bfe', '#fd79a8', '#ffc400', '#ff8c42', '#00cec9']

    // Pré-carregar dívidas para o bloco debt_payoff
    let financiamentos = [], emprestimos = []
    try {
      const [fd, ed] = await Promise.all([
        this.api('GET', 'financiamentos'),
        this.api('GET', 'emprestimos')
      ])
      financiamentos = (fd.financiamentos || []).filter(f => f.status === 'ativo')
      emprestimos = (ed.emprestimos || []).filter(e => e.status === 'ativo')
    } catch(e) {}

    const categoriasMeta = [
      { v:'economia', l:'💰 Economia / Reserva' },
      { v:'imovel', l:'🏠 Imóvel (Casa/Apto)' },
      { v:'veiculo', l:'🚗 Veículo (Carro/Moto)' },
      { v:'viagem', l:'✈️ Viagem / Férias' },
      { v:'educacao', l:'📚 Educação / Curso' },
      { v:'liberdade', l:'🗽 Liberdade Financeira' },
      { v:'aposentadoria', l:'👴 Aposentadoria' },
      { v:'emergencia', l:'🛡️ Reserva de Emergência' },
      { v:'debt_payoff', l:'💳 Quitar Dívidas' },
      { v:'outros', l:'📋 Outros' },
    ]

    document.getElementById('modal-container').innerHTML = `
      <div class="modal-overlay" onclick="VM.closeModal(event)">
        <div class="modal">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:24px;">
            <h3 style="font-size:1.1rem;font-weight:700;">${isEdit ? '✏️ Editar' : '🎯 Nova'} Meta</h3>
            <button onclick="VM.closeModal()" style="background:none;border:none;color:#666;font-size:1.2rem;cursor:pointer;">✕</button>
          </div>
          <form id="meta-form">
            <div class="form-group">
              <label class="form-label">Nome da Meta *</label>
              <input type="text" id="m-nome" class="form-input" placeholder="Ex: Reserva de Emergência" value="${meta?.nome || ''}" required>
            </div>
            <div class="form-group">
              <label class="form-label">Categoria *</label>
              <select id="m-categoria" class="form-select" onchange="VM._toggleDebtPayoff()">
                ${categoriasMeta.map(c => `<option value="${c.v}" ${(meta?.categoria||'economia')===c.v?'selected':''}>${c.l}</option>`).join('')}
              </select>
              <div style="font-size:0.72rem;color:#888;margin-top:3px;">A categoria define quais conquistas você pode desbloquear</div>
            </div>
            <!-- Bloco debt_payoff (oculto por padrão) -->
            <div id="debt-payoff-block" style="display:${(meta?.categoria==='debt_payoff')?'block':'none'};">
              <div class="form-group">
                <label class="form-label">Tipo de Dívida</label>
                <select id="m-debt-type" class="form-select" onchange="VM._onDebtTypeChange()">
                  <option value="all" ${meta?.linked_debt_type==='all'?'selected':''}>🏦 Todas as dívidas (financiamentos + empréstimos)</option>
                  <option value="financiamento" ${meta?.linked_debt_type==='financiamento'?'selected':''}>🏠 Somente Financiamentos</option>
                  <option value="emprestimo" ${meta?.linked_debt_type==='emprestimo'?'selected':''}>💰 Somente Empréstimos</option>
                  <option value="specific" ${meta?.linked_debt_type==='specific'?'selected':''}>🎯 Dívida Específica</option>
                </select>
              </div>
              <!-- Seletor de dívida específica -->
              <div id="m-specific-debt-wrapper" style="display:${meta?.linked_debt_type==='specific'?'block':'none'};">
                <div class="form-group">
                  <label class="form-label">Selecionar Dívida Específica</label>
                  <select id="m-specific-debt-id" class="form-select" onchange="VM._onSpecificDebtChange()">
                    <option value="">— Selecione —</option>
                    ${financiamentos.map(f => `<option value="fin_${f.id}" ${meta?.linked_debt_id===f.id&&meta?.linked_debt_type==='specific'?'selected':''}>🏠 ${f.descricao} (${this.formatMoney(f.saldo_devedor)})</option>`).join('')}
                    ${emprestimos.map(e => `<option value="emp_${e.id}" ${meta?.linked_debt_id===e.id&&meta?.linked_debt_type==='specific'?'selected':''}>💰 ${e.descricao} (${this.formatMoney(e.saldo_devedor)})</option>`).join('')}
                  </select>
                </div>
              </div>
              <!-- Resumo do saldo das dívidas -->
              <div id="m-debt-summary" style="margin-bottom:12px;"></div>
              <div style="font-size:0.72rem;color:#4ade80;margin-top:4px;">✨ O valor objetivo será preenchido automaticamente com o saldo devedor</div>
            </div>
            <div class="form-group">
              <label class="form-label">Descrição</label>
              <input type="text" id="m-desc" class="form-input" placeholder="Opcional..." value="${meta?.descricao || ''}">
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
              <div class="form-group">
                <label class="form-label">Valor Objetivo (R$) *</label>
                <input type="number" id="m-obj" class="form-input" placeholder="0,00" step="0.01" min="0" value="${meta?.valor_objetivo || ''}" required>
              </div>
              <div class="form-group">
                <label class="form-label">Valor Atual (R$)</label>
                <input type="number" id="m-atual" class="form-input" placeholder="0,00" step="0.01" min="0" value="${meta?.valor_atual || 0}">
              </div>
            </div>
            <div class="form-group">
              <label class="form-label">Data Limite *</label>
              <input type="date" id="m-data" class="form-input" value="${meta?.data_meta || defaultDate}" required>
            </div>
            <div class="form-group">
              <label class="form-label">Cor</label>
              <div style="display:flex;gap:10px;flex-wrap:wrap;">
                ${cores.map(c => `
                  <div onclick="document.getElementById('m-cor').value='${c}';document.querySelectorAll('.cor-option').forEach(el=>el.style.border='none');this.style.border='3px solid white'"
                    class="cor-option" style="width:30px;height:30px;background:${c};border-radius:8px;cursor:pointer;border:${(meta?.cor || '#2FBF71') === c ? '3px solid white' : 'none'};"></div>
                `).join('')}
              </div>
              <input type="hidden" id="m-cor" value="${meta?.cor || '#2FBF71'}">
            </div>
            <div style="display:flex;gap:12px;margin-top:8px;">
              <button type="button" onclick="VM.closeModal()" class="btn-secondary" style="flex:1;justify-content:center;">Cancelar</button>
              <button type="submit" class="btn-primary" style="flex:1;" id="m-submit">
                <i class="fas fa-save"></i> ${isEdit ? 'Salvar' : 'Criar Meta'}
              </button>
            </div>
          </form>
        </div>
      </div>
    `

    document.getElementById('meta-form').addEventListener('submit', async (e) => {
      e.preventDefault()
      const btn = document.getElementById('m-submit')
      btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Salvando...'
      try {
        const categoria = document.getElementById('m-categoria').value
        const isDebtPayoff = categoria === 'debt_payoff'
        const debtType = isDebtPayoff ? document.getElementById('m-debt-type')?.value : null
        const isSpecific = debtType === 'specific'

        // Para debt_payoff, extrair linked_debt_id se tipo=specific
        let linkedDebtId = null, linkedDebtType = debtType
        if (isSpecific) {
          const specificVal = document.getElementById('m-specific-debt-id')?.value
          if (specificVal) {
            const [t, idStr] = specificVal.split('_')
            linkedDebtId = parseInt(idStr)
            linkedDebtType = t === 'fin' ? 'specific_financiamento' : 'specific_emprestimo'
          }
        }

        const valorObj = parseFloat(document.getElementById('m-obj').value) || 0
        const payload = {
          nome: document.getElementById('m-nome').value,
          descricao: document.getElementById('m-desc').value,
          valor_objetivo: valorObj || undefined,
          valor_atual: parseFloat(document.getElementById('m-atual').value) || 0,
          data_meta: document.getElementById('m-data').value,
          cor: document.getElementById('m-cor').value,
          categoria,
          icone: meta?.icone || 'piggy-bank',
          status: meta?.status || 'ativa',
          ...(isDebtPayoff ? {
            linked_debt_type: linkedDebtType || debtType,
            linked_debt_id: linkedDebtId,
          } : {})
        }
        if (!isDebtPayoff && (!payload.valor_objetivo || isNaN(payload.valor_objetivo))) {
          this.toast('Informe o valor objetivo', 'error')
          btn.disabled = false; btn.innerHTML = `<i class="fas fa-save"></i> ${isEdit ? 'Salvar' : 'Criar Meta'}`
          return
        }
        if (isEdit) await this.api('PUT', `metas/${meta.id}`, {...payload, valor_objetivo: payload.valor_objetivo || meta.valor_objetivo})
        else await this.api('POST', 'metas', payload)
        this.toast(isEdit ? 'Meta atualizada!' : 'Meta criada! 🎯')
        this.closeModal(); this.carregarMetas()
      } catch (err) {
        this.toast(err.response?.data?.error || 'Erro ao salvar', 'error')
        btn.disabled = false; btn.innerHTML = `<i class="fas fa-save"></i> ${isEdit ? 'Salvar' : 'Criar Meta'}`
      }
    })
  },

  _toggleDebtPayoff() {
    const cat = document.getElementById('m-categoria')?.value
    const block = document.getElementById('debt-payoff-block')
    if (block) block.style.display = cat === 'debt_payoff' ? 'block' : 'none'
    if (cat === 'debt_payoff') this._onDebtTypeChange()
  },

  async _onDebtTypeChange() {
    const tipo = document.getElementById('m-debt-type')?.value
    const specificWrapper = document.getElementById('m-specific-debt-wrapper')
    const summaryEl = document.getElementById('m-debt-summary')
    if (specificWrapper) specificWrapper.style.display = tipo === 'specific' ? 'block' : 'none'

    if (!summaryEl) return
    if (tipo === 'specific') { summaryEl.innerHTML = ''; return }

    try {
      const [fd, ed] = await Promise.all([
        this.api('GET', 'financiamentos'),
        this.api('GET', 'emprestimos')
      ])
      const fins = (fd.financiamentos || []).filter(f => f.status === 'ativo')
      const emps = (ed.emprestimos || []).filter(e => e.status === 'ativo')

      let totalSaldo = 0, items = []
      if (tipo === 'all' || tipo === 'financiamento') {
        fins.forEach(f => { totalSaldo += Number(f.saldo_devedor || 0); items.push(`🏠 ${f.descricao}: ${this.formatMoney(f.saldo_devedor)}`) })
      }
      if (tipo === 'all' || tipo === 'emprestimo') {
        emps.forEach(e => { totalSaldo += Number(e.saldo_devedor || 0); items.push(`💰 ${e.descricao}: ${this.formatMoney(e.saldo_devedor)}`) })
      }

      if (items.length === 0) {
        summaryEl.innerHTML = `<div style="background:rgba(255,100,100,0.08);border:1px solid rgba(255,100,100,0.2);border-radius:8px;padding:10px;font-size:0.78rem;color:#f87171;">
          ⚠️ Nenhuma dívida ativa encontrada para este tipo</div>`
        return
      }

      // Auto-preencher valor objetivo com o saldo total
      const objEl = document.getElementById('m-obj')
      if (objEl && (!objEl.value || objEl.value === '0')) objEl.value = totalSaldo.toFixed(2)

      summaryEl.innerHTML = `
        <div style="background:rgba(47,191,113,0.06);border:1px solid rgba(47,191,113,0.2);border-radius:8px;padding:10px 14px;font-size:0.78rem;">
          <div style="font-weight:600;color:#2FBF71;margin-bottom:6px;">💰 Saldo devedor total: ${this.formatMoney(totalSaldo)}</div>
          ${items.map(i => `<div style="color:#888;margin-top:2px;">${i}</div>`).join('')}
          <div style="color:#4ade80;margin-top:6px;font-size:0.72rem;">✅ Valor objetivo preenchido automaticamente</div>
        </div>`
    } catch(e) {
      summaryEl.innerHTML = ''
    }
  },

  async _onSpecificDebtChange() {
    const val = document.getElementById('m-specific-debt-id')?.value
    const summaryEl = document.getElementById('m-debt-summary')
    const objEl = document.getElementById('m-obj')
    if (!val || !summaryEl) return

    try {
      const [tipo, id] = val.split('_')
      let item = null
      if (tipo === 'fin') {
        const d = await this.api('GET', 'financiamentos')
        item = (d.financiamentos || []).find(f => String(f.id) === id)
      } else {
        const d = await this.api('GET', 'emprestimos')
        item = (d.emprestimos || []).find(e => String(e.id) === id)
      }
      if (!item) return
      const saldo = Number(item.saldo_devedor || 0)
      if (objEl) objEl.value = saldo.toFixed(2)
      summaryEl.innerHTML = `
        <div style="background:rgba(47,191,113,0.06);border:1px solid rgba(47,191,113,0.2);border-radius:8px;padding:10px 14px;font-size:0.78rem;">
          <div style="font-weight:600;color:#2FBF71;">${tipo === 'fin' ? '🏠' : '💰'} ${item.descricao}</div>
          <div style="color:#888;margin-top:4px;">Saldo devedor: <strong style="color:#fff;">${this.formatMoney(saldo)}</strong></div>
          ${item.valor_parcela ? `<div style="color:#888;">Parcela mensal: ${this.formatMoney(item.valor_parcela)}</div>` : ''}
          <div style="color:#4ade80;margin-top:6px;font-size:0.72rem;">✅ Valor objetivo preenchido automaticamente</div>
        </div>`
    } catch(e) {}
  },

  async deleteMeta(id) {
    const ok = await this.vmConfirm('Deseja excluir esta meta permanentemente?', { titulo: 'Excluir Meta', corBotao: '#ef4444', textoBotao: 'Excluir', icone: '🗑️' })
    if (!ok) return
    try {
      await this.api('DELETE', `metas/${id}`)
      this.toast('Meta excluída!')
      this.carregarMetas()
    } catch (e) {
      this.toast('Erro ao excluir', 'error')
    }
  },

  // ============== INVESTIMENTOS ==============
  async pageInvestimentos() {
    document.getElementById('page-content').innerHTML = `
      <div class="section-header">
        <div>
          <div class="section-title">📈 Investimentos</div>
          <div style="color:#666;font-size:0.85rem;margin-top:2px;">Construindo patrimônio</div>
        </div>
        <button onclick="VM.modalInvestimento()" class="btn-primary" style="width:auto;padding:10px 20px;">
          <i class="fas fa-plus"></i> Novo Investimento
        </button>
      </div>
      <div id="cdi-banner-invest" style="margin-bottom:16px;"></div>
      <div id="invest-container">
        <div class="empty-state"><div class="skeleton" style="height:200px;border-radius:16px;"></div></div>
      </div>
    `
    // Buscar CDI real e exibir banner
    this.api('GET', 'cdi/atual').then(cdi => {
      const b = document.getElementById('cdi-banner-invest')
      if (!b || !cdi?.cdi_anual) return
      b.innerHTML = `
        <div style="background:linear-gradient(135deg,rgba(16,185,129,0.08),rgba(5,150,105,0.04));border:1px solid rgba(16,185,129,0.2);border-radius:14px;padding:14px 20px;display:flex;align-items:center;gap:16px;flex-wrap:wrap;">
          <div style="font-size:1.6rem;">📡</div>
          <div>
            <div style="font-size:0.72rem;color:#10B981;text-transform:uppercase;letter-spacing:1px;font-weight:700;">Taxa CDI — Banco Central</div>
            <div style="display:flex;align-items:baseline;gap:8px;margin-top:2px;">
              <span style="font-size:1.4rem;font-weight:800;color:#F8FAFC;">${cdi.cdi_anual}%</span>
              <span style="color:#64748B;font-size:0.82rem;">a.a. · atualizado ${cdi.data || 'hoje'}</span>
            </div>
          </div>
          <div style="display:flex;gap:14px;margin-left:auto;flex-wrap:wrap;">
            ${[
              { p: 100, l: '100% CDI', v: cdi.cdi_anual },
              { p: 110, l: '110% CDI', v: (cdi.cdi_anual * 1.10).toFixed(2) },
              { p: 120, l: '120% CDI', v: (cdi.cdi_anual * 1.20).toFixed(2) },
              { p: 140, l: '140% CDI', v: (cdi.cdi_anual * 1.40).toFixed(2) }
            ].map(r => `
              <div style="text-align:center;">
                <div style="font-size:0.65rem;color:#64748B;">${r.l}</div>
                <div style="font-size:0.88rem;font-weight:700;color:#10B981;">${r.v}%</div>
              </div>`).join('')}
          </div>
        </div>`
    }).catch(() => {})
    
    // Buscar cotações ao vivo (USD, EUR, BTC)
    this.api('GET', 'investimentos/cotacoes').then(cotData => {
      const b = document.getElementById('cdi-banner-invest')
      if (!b || !cotData) return
      const cambio = cotData.cambio || {}
      const cripto = cotData.cripto || {}
      const taxas = cotData.taxas_referencia || {}
      if (Object.keys(cambio).length === 0 && Object.keys(cripto).length === 0) return
      const fmtBRL = v => Number(v||0).toLocaleString('pt-BR', {minimumFractionDigits:2,maximumFractionDigits:2})
      const varColor = v => Number(v||0) >= 0 ? '#10B981' : '#F43F5E'
      const varSign = v => Number(v||0) >= 0 ? '▲' : '▼'
      const moedaFlags = { USD: '🇺🇸', EUR: '🇪🇺', GBP: '🇬🇧' }
      const cotWidget = document.createElement('div')
      cotWidget.style.cssText = 'margin-bottom:16px;'
      cotWidget.innerHTML = `
        <div style="background:rgba(15,23,42,0.8);border:1px solid rgba(255,255,255,0.06);border-radius:14px;padding:14px 20px;">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;flex-wrap:wrap;gap:8px;">
            <div style="font-size:0.68rem;color:#64748B;text-transform:uppercase;letter-spacing:1px;font-weight:700;">📊 Cotações em Tempo Real</div>
            ${taxas.selic_meta ? `<div style="font-size:0.72rem;color:#F59E0B;font-weight:600;">SELIC: ${taxas.selic_meta}% a.a.</div>` : ''}
          </div>
          <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:stretch;">
            ${Object.entries(cambio).map(([sym, m]) => `
              <div style="display:flex;align-items:center;gap:8px;padding:10px 14px;background:rgba(255,255,255,0.03);border-radius:10px;border:1px solid rgba(255,255,255,0.05);min-width:110px;">
                <span style="font-size:1rem;">${moedaFlags[sym]||'💱'}</span>
                <div>
                  <div style="font-size:0.65rem;color:#64748B;font-weight:600;">${sym}/BRL</div>
                  <div style="font-size:0.9rem;font-weight:700;color:#f1f5f9;">R$ ${fmtBRL(m.compra)}</div>
                  <div style="font-size:0.62rem;color:#475569;">venda: R$ ${fmtBRL(m.venda)}</div>
                </div>
              </div>`).join('')}
            ${Object.entries(cripto).slice(0,3).map(([sym, c]) => `
              <div style="display:flex;align-items:center;gap:8px;padding:10px 14px;background:rgba(255,255,255,0.03);border-radius:10px;border:1px solid rgba(255,255,255,0.05);min-width:110px;">
                <span style="font-size:1rem;">${sym==='BTC'?'₿':sym==='ETH'?'Ξ':'🪙'}</span>
                <div>
                  <div style="font-size:0.65rem;color:#64748B;font-weight:600;">${sym}/BRL</div>
                  <div style="font-size:0.9rem;font-weight:700;color:#f1f5f9;">R$ ${fmtBRL(c.brl)}</div>
                  ${c.variacao_24h != null ? `<div style="font-size:0.62rem;color:${varColor(c.variacao_24h)};font-weight:600;">${varSign(c.variacao_24h)} ${Math.abs(c.variacao_24h).toFixed(2)}% 24h</div>` : ''}
                </div>
              </div>`).join('')}
            <div style="font-size:0.62rem;color:#334155;margin-left:auto;align-self:flex-end;padding-bottom:2px;">Atualizado em ${new Date().toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})}<br>Fontes: BCB · DolarApi · CoinGecko</div>
          </div>
        </div>`
      b.after(cotWidget)
    }).catch(() => {})
    
    this.carregarInvestimentos()
  },

  async carregarInvestimentos() {
    try {
      const data = await this.api('GET', 'investimentos')
      const container = document.getElementById('invest-container')
      const { investimentos, resumo } = data

      const tipoLabels = { tesouro_direto: 'Tesouro Direto', cdb: 'CDB', lci: 'LCI', lca: 'LCA', acoes: 'Ações', fii: 'FII', cripto: 'Cripto', poupanca: 'Poupança', caixinha: 'Caixinha CDI', outros: 'Outros' }
      const tipoEmojis = { tesouro_direto: '🏛️', cdb: '🏦', lci: '📋', lca: '🌱', acoes: '📊', fii: '🏢', cripto: '₿', poupanca: '🐷', caixinha: '💰', outros: '💼' }
      const riscoColors = { baixo: '#2FBF71', medio: '#ffc400', alto: '#ff6b6b' }

      container.innerHTML = `
        <!-- RESUMO -->
        <div class="grid-4" style="margin-bottom:24px;">
          <div class="stat-card"><div class="stat-label" style="margin-bottom:8px;">💰 Total Investido</div><div class="stat-value positive">${this.formatMoney(resumo.total_investido)}</div></div>
          <div class="stat-card"><div class="stat-label" style="margin-bottom:8px;">📈 Valor Atual</div><div class="stat-value positive">${this.formatMoney(resumo.total_atual)}</div></div>
          <div class="stat-card"><div class="stat-label" style="margin-bottom:8px;">💹 Lucro/Prejuízo</div><div class="stat-value ${resumo.lucro_prejuizo >= 0 ? 'positive' : 'negative'}">${this.formatMoney(resumo.lucro_prejuizo)}</div></div>
          <div class="stat-card"><div class="stat-label" style="margin-bottom:8px;">📊 Rentabilidade</div><div class="stat-value ${resumo.rentabilidade_total >= 0 ? 'positive' : 'negative'}">${resumo.rentabilidade_total.toFixed(2)}%</div></div>
        </div>

        ${investimentos.length === 0 ? `
          <div class="empty-state card"><div class="empty-icon">📈</div><h3>Nenhum investimento</h3><p>Adicione seu primeiro investimento!</p></div>
        ` : `
          <div class="card">
            <table class="data-table">
              <thead><tr>
                <th>Investimento</th>
                <th>Tipo</th>
                <th>Risco</th>
                <th style="text-align:right;">Investido</th>
                <th style="text-align:right;">Atual</th>
                <th style="text-align:right;">Rentab.</th>
                <th style="text-align:right;">Ações</th>
              </tr></thead>
              <tbody>
                ${investimentos.map(inv => {
                  const isCaixinha = inv.tipo === 'caixinha'
                  const rentLabel = isCaixinha && inv.dias_decorridos === 0
                    ? '<span style="color:#888;font-size:0.78rem;">Rendendo...</span>'
                    : `${inv.rentabilidade_percentual >= 0 ? '+' : ''}${inv.rentabilidade_percentual}%`
                  return `
                  <tr>
                    <td>
                      <div style="font-weight:600;">${inv.nome}</div>
                      ${inv.instituicao ? `<div style="font-size:0.75rem;color:#666;">${inv.instituicao}</div>` : ''}
                      ${isCaixinha && inv.cdi_info ? `<div style="font-size:0.72rem;color:#2FBF71;">📊 ${inv.cdi_info}</div>` : ''}
                      ${isCaixinha && inv.dias_decorridos > 0 ? `<div style="font-size:0.7rem;color:#888;">${inv.dias_decorridos} dias rendendo</div>` : ''}
                      ${isCaixinha && inv.dias_decorridos === 0 ? `<div style="font-size:0.7rem;color:#888;">Cadastrado hoje — renderá a partir de amanhã</div>` : ''}
                    </td>
                    <td>${tipoEmojis[inv.tipo] || '💼'} ${tipoLabels[inv.tipo] || inv.tipo}</td>
                    <td><span class="badge" style="background:${riscoColors[inv.risco] || '#888'}22;color:${riscoColors[inv.risco] || '#888'};border:1px solid ${riscoColors[inv.risco] || '#888'}44;">${inv.risco}</span></td>
                    <td style="text-align:right;">${this.formatMoney(inv.valor_investido)}</td>
                    <td style="text-align:right;font-weight:600;color:#2FBF71;">${this.formatMoney(inv.valor_atual || inv.valor_investido)}</td>
                    <td style="text-align:right;font-weight:600;${inv.rentabilidade_percentual >= 0 ? 'color:#2FBF71' : 'color:#ff6b6b'};">${rentLabel}</td>
                    <td style="text-align:right;">
                      <button onclick="VM.modalInvestimento(${JSON.stringify(inv).replace(/"/g, '&quot;')})" class="btn-success" style="margin-right:4px;"><i class="fas fa-edit"></i></button>
                      <button onclick="VM.deleteInvestimento(${inv.id})" class="btn-danger"><i class="fas fa-trash"></i></button>
                    </td>
                  </tr>
                `}).join('')}
              </tbody>
            </table>
          </div>
        `}
      `
    } catch (e) {
      this.toast('Erro ao carregar investimentos', 'error')
    }
  },

  modalInvestimento(inv = null) {
    const isEdit = !!inv
    const today = new Date().toISOString().split('T')[0]
    const tipos = ['tesouro_direto', 'cdb', 'lci', 'lca', 'acoes', 'fii', 'cripto', 'poupanca', 'caixinha', 'outros']
    const tipoLabels = { 
      tesouro_direto: 'Tesouro Direto', cdb: 'CDB', lci: 'LCI', lca: 'LCA', 
      acoes: 'Ações', fii: 'FII', cripto: 'Cripto', poupanca: 'Poupança', 
      caixinha: '💰 Caixinha (CDI)', outros: 'Outros' 
    }

    document.getElementById('modal-container').innerHTML = `
      <div class="modal-overlay" onclick="VM.closeModal(event)">
        <div class="modal">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:24px;">
            <h3 style="font-size:1.1rem;font-weight:700;">${isEdit ? '✏️ Editar' : '📈 Novo'} Investimento</h3>
            <button onclick="VM.closeModal()" style="background:none;border:none;color:#666;font-size:1.2rem;cursor:pointer;">✕</button>
          </div>
          <form id="inv-form">
            <div class="form-group">
              <label class="form-label">Nome *</label>
              <input type="text" id="i-nome" class="form-input" placeholder="Ex: Tesouro SELIC 2029" value="${inv?.nome || ''}" required>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
              <div class="form-group">
                <label class="form-label">Tipo *</label>
                <select id="i-tipo" class="form-select" onchange="VM.onChangeTipoInvestimento(this.value)">
                  ${tipos.map(t => `<option value="${t}" ${inv?.tipo === t ? 'selected' : ''}>${tipoLabels[t]}</option>`).join('')}
                </select>
              </div>
              <div class="form-group">
                <label class="form-label">Risco</label>
                <select id="i-risco" class="form-select">
                  <option value="baixo" ${inv?.risco === 'baixo' ? 'selected' : ''}>Baixo</option>
                  <option value="medio" ${inv?.risco === 'medio' ? 'selected' : ''}>Médio</option>
                  <option value="alto" ${inv?.risco === 'alto' ? 'selected' : ''}>Alto</option>
                </select>
              </div>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
              <div class="form-group">
                <label class="form-label">Valor Investido (R$) *</label>
                <input type="number" id="i-valor" class="form-input" placeholder="0,00" step="0.01" min="0" value="${inv?.valor_investido || ''}" required>
              </div>
              <div class="form-group" id="i-rent-wrapper">
                <label class="form-label">Rentabilidade (%)</label>
                <input type="number" id="i-rent" class="form-input" placeholder="0,00" step="0.01" value="${inv?.rentabilidade_percentual || 0}">
                <div style="font-size:0.72rem;color:#888;margin-top:3px;">Rentabilidade acumulada atual</div>
              </div>
            </div>
            <!-- Campos específicos Caixinha CDI -->
            <div id="i-caixinha-wrapper" style="display:none;background:rgba(47,191,113,0.06);border:1px solid rgba(47,191,113,0.2);border-radius:10px;padding:12px;margin-bottom:12px;">
              <div style="font-size:0.82rem;font-weight:600;color:#2FBF71;margin-bottom:10px;">💰 Configuração Caixinha CDI</div>
              <div style="font-size:0.78rem;color:#aaa;margin-bottom:10px;">
                A Caixinha rende diariamente com base no CDI. Ex: 140% do CDI = ganho diário calculado sobre 140% da taxa CDI.
              </div>
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
                <div class="form-group">
                  <label class="form-label">% do CDI *</label>
                  <input type="number" id="i-pct-cdi" class="form-input" step="1" min="1" placeholder="Ex: 140" value="${inv?.percentual_cdi || ''}">
                  <div style="font-size:0.72rem;color:#888;margin-top:3px;">Ex: 140 = 140% do CDI</div>
                </div>
                <div class="form-group">
                  <label class="form-label">CDI Atual (% a.a.)</label>
                  <input type="number" id="i-cdi-atual" class="form-input" step="0.01" placeholder="13.65" value="${inv?.cdi_atual || '13.65'}">
                  <div style="font-size:0.72rem;color:#888;margin-top:3px;">Taxa CDI atual ao ano</div>
                </div>
              </div>
              <div id="i-caixinha-preview" style="font-size:0.8rem;color:#2FBF71;margin-top:6px;"></div>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
              <div class="form-group">
                <label class="form-label">Data de Início *</label>
                <input type="date" id="i-inicio" class="form-input" value="${inv?.data_inicio || today}" required>
              </div>
              <div class="form-group">
                <label class="form-label">Vencimento</label>
                <input type="date" id="i-venc" class="form-input" value="${inv?.data_vencimento || ''}">
              </div>
            </div>
            <div class="form-group">
              <label class="form-label">Instituição</label>
              <input type="text" id="i-inst" class="form-input" placeholder="Ex: Nubank, PicPay, Inter..." value="${inv?.instituicao || ''}">
            </div>
            <div style="display:flex;gap:12px;margin-top:8px;">
              <button type="button" onclick="VM.closeModal()" class="btn-secondary" style="flex:1;justify-content:center;">Cancelar</button>
              <button type="submit" class="btn-primary" style="flex:1;" id="i-submit">
                <i class="fas fa-save"></i> ${isEdit ? 'Salvar' : 'Adicionar'}
              </button>
            </div>
          </form>
        </div>
      </div>
    `

    // Inicializar visibilidade conforme tipo
    VM.onChangeTipoInvestimento(inv?.tipo || 'tesouro_direto')

    // Buscar CDI real e preencher campo automaticamente
    this.api('GET', 'cdi/atual').then(cdiData => {
      const cdiInput = document.getElementById('i-cdi-atual')
      const preview  = document.getElementById('i-caixinha-preview')
      if (cdiInput && cdiData?.cdi_anual && !inv?.cdi_atual) {
        cdiInput.value = cdiData.cdi_anual
        cdiInput.title = `Fonte: ${cdiData.fonte} (${cdiData.data})`
        if (preview) preview.innerHTML = `📡 CDI atual: <strong>${cdiData.cdi_anual}% a.a.</strong> (fonte: BCB)`
      }
    }).catch(() => {})

    document.getElementById('inv-form').addEventListener('submit', async (e) => {
      e.preventDefault()
      const btn = document.getElementById('i-submit')
      btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Salvando...'
      try {
        const tipo = document.getElementById('i-tipo').value
        const valorInv = parseFloat(document.getElementById('i-valor').value)
        const rent = parseFloat(document.getElementById('i-rent').value) || 0
        const payload = {
          nome: document.getElementById('i-nome').value,
          tipo,
          risco: document.getElementById('i-risco').value,
          valor_investido: valorInv,
          rentabilidade_percentual: rent,
          valor_atual: isEdit ? valorInv * (1 + rent / 100) : undefined,
          data_inicio: document.getElementById('i-inicio').value,
          data_vencimento: document.getElementById('i-venc').value || null,
          instituicao: document.getElementById('i-inst').value || null,
          percentual_cdi: tipo === 'caixinha' ? (parseFloat(document.getElementById('i-pct-cdi')?.value) || null) : null,
          cdi_atual: tipo === 'caixinha' ? (parseFloat(document.getElementById('i-cdi-atual')?.value) || 13.65) : null
        }
        if (isEdit) await this.api('PUT', `investimentos/${inv.id}`, payload)
        else await this.api('POST', 'investimentos', payload)
        this.toast(isEdit ? 'Investimento atualizado!' : 'Investimento adicionado! 📈')
        this.closeModal(); this.carregarInvestimentos()
      } catch (err) {
        this.toast(err.response?.data?.error || 'Erro ao salvar', 'error')
        btn.disabled = false; btn.innerHTML = `<i class="fas fa-save"></i> ${isEdit ? 'Salvar' : 'Adicionar'}`
      }
    })
  },

  onChangeTipoInvestimento(tipo) {
    const caixinhaW = document.getElementById('i-caixinha-wrapper')
    const rentW = document.getElementById('i-rent-wrapper')
    if (caixinhaW) caixinhaW.style.display = tipo === 'caixinha' ? 'block' : 'none'
    if (rentW) rentW.style.display = tipo === 'caixinha' ? 'none' : 'block'
  },

  async deleteInvestimento(id) {
    const ok = await this.vmConfirm('Deseja excluir este investimento permanentemente?', { titulo: 'Excluir Investimento', corBotao: '#ef4444', textoBotao: 'Excluir', icone: '🗑️' })
    if (!ok) return
    try {
      await this.api('DELETE', `investimentos/${id}`)
      this.toast('Investimento excluído!')
      this.carregarInvestimentos()
    } catch (e) {
      this.toast('Erro ao excluir', 'error')
    }
  },

  // ============== RELATÓRIOS ==============
  // ═══════════════════════════════════════════════════════════════════════════
  // COMPARATIVO MENSAL
  // ═══════════════════════════════════════════════════════════════════════════
  async pageComparativo() {
    const hoje = new Date()
    let mesAtual = hoje.getMonth() + 1
    let anoAtual = hoje.getFullYear()

    document.getElementById('page-content').innerHTML = `
      <div class="section-header">
        <div>
          <div class="section-title">📊 Comparativo Mensal</div>
          <div style="color:#666;font-size:0.85rem;margin-top:2px;">Evolução mês a mês por categoria</div>
        </div>
        <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
          <select id="comp-mes" class="form-select" style="width:auto;padding:8px 12px;">
            ${[1,2,3,4,5,6,7,8,9,10,11,12].map(m => {
              const nomes = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez']
              return `<option value="${m}" ${m === mesAtual ? 'selected' : ''}>${nomes[m-1]}</option>`
            }).join('')}
          </select>
          <select id="comp-ano" class="form-select" style="width:auto;padding:8px 12px;">
            ${[anoAtual-1, anoAtual, anoAtual+1].map(a => `<option value="${a}" ${a === anoAtual ? 'selected' : ''}>${a}</option>`).join('')}
          </select>
          <button onclick="VM.carregarComparativo()" class="btn-primary" style="width:auto;padding:9px 18px;">
            <i class="fas fa-sync-alt"></i> Atualizar
          </button>
        </div>
      </div>
      <div id="comparativo-container">
        <div class="empty-state"><div class="skeleton" style="height:300px;border-radius:16px;"></div></div>
      </div>
    `
    await this.carregarComparativo()
  },

  async carregarComparativo() {
    const mes = document.getElementById('comp-mes')?.value || new Date().getMonth() + 1
    const ano = document.getElementById('comp-ano')?.value || new Date().getFullYear()
    const cont = document.getElementById('comparativo-container')
    if (!cont) return

    try {
      const [r, hist] = await Promise.all([
        this.api('GET', `comparativo?mes=${mes}&ano=${ano}`),
        this.api('GET', `comparativo/historico?meses=6`)
      ])

      const { resumo, categorias, alertas, periodo } = r
      const { historico } = hist

      // KPIs de comparação
      const kpiCard = (label, atual, anterior) => {
        const diff    = atual - anterior
        const varPct  = anterior > 0 ? (diff / anterior * 100).toFixed(1) : (atual > 0 ? '100' : '0')
        const positivo = diff >= 0
        const cor     = label.includes('Despesa') ? (positivo ? '#F43F5E' : '#10B981') : (positivo ? '#10B981' : '#F43F5E')
        const icon    = positivo ? '▲' : '▼'
        return `
          <div style="background:rgba(30,41,59,0.6);border:1px solid rgba(255,255,255,0.06);border-radius:16px;padding:18px 20px;">
            <div style="font-size:0.78rem;color:#64748B;margin-bottom:8px;">${label}</div>
            <div style="font-size:1.35rem;font-weight:800;color:#F8FAFC;">${this.formatMoney(atual)}</div>
            <div style="font-size:0.8rem;color:${cor};margin-top:5px;">
              ${icon} ${Math.abs(parseFloat(varPct))}% vs ${periodo.label_ant}
            </div>
          </div>`
      }

      // Gráfico de barras histórico (canvas SVG manual)
      const maxVal = Math.max(...historico.map((m) => Math.max(m.receitas, m.despesas)), 1)
      const barChart = `
        <div style="background:rgba(30,41,59,0.6);border:1px solid rgba(255,255,255,0.06);border-radius:16px;padding:20px;margin-bottom:20px;">
          <div style="font-size:0.88rem;font-weight:600;color:#94A3B8;margin-bottom:16px;">Histórico 6 meses</div>
          <div style="display:flex;align-items:flex-end;gap:8px;height:140px;padding-bottom:24px;position:relative;">
            ${historico.map(m => {
              const hR = Math.round((m.receitas / maxVal) * 120)
              const hD = Math.round((m.despesas / maxVal) * 120)
              return `
                <div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:3px;position:relative;">
                  <div style="width:100%;display:flex;gap:2px;align-items:flex-end;height:120px;">
                    <div title="Receitas: R$ ${this.formatMoney(m.receitas)}" style="flex:1;background:linear-gradient(180deg,#10B981,#059669);border-radius:4px 4px 0 0;height:${hR}px;min-height:2px;cursor:default;transition:opacity 0.2s;" onmouseover="this.style.opacity='0.8'" onmouseout="this.style.opacity='1'"></div>
                    <div title="Despesas: R$ ${this.formatMoney(m.despesas)}" style="flex:1;background:linear-gradient(180deg,#F43F5E,#E11D48);border-radius:4px 4px 0 0;height:${hD}px;min-height:2px;cursor:default;transition:opacity 0.2s;" onmouseover="this.style.opacity='0.8'" onmouseout="this.style.opacity='1'"></div>
                  </div>
                  <div style="font-size:0.62rem;color:#475569;white-space:nowrap;">${m.label}</div>
                </div>`
            }).join('')}
          </div>
          <div style="display:flex;gap:16px;justify-content:center;margin-top:4px;">
            <div style="display:flex;align-items:center;gap:6px;font-size:0.75rem;color:#94A3B8;">
              <div style="width:10px;height:10px;background:#10B981;border-radius:2px;"></div> Receitas
            </div>
            <div style="display:flex;align-items:center;gap:6px;font-size:0.75rem;color:#94A3B8;">
              <div style="width:10px;height:10px;background:#F43F5E;border-radius:2px;"></div> Despesas
            </div>
          </div>
        </div>`

      // Alertas de variação
      const alertasHtml = alertas.length > 0 ? `
        <div style="background:rgba(245,158,11,0.08);border:1px solid rgba(245,158,11,0.2);border-radius:14px;padding:16px 18px;margin-bottom:20px;">
          <div style="font-size:0.82rem;font-weight:700;color:#F59E0B;margin-bottom:10px;">⚠️ Atenção — Variações Significativas</div>
          ${alertas.map(a => `<div style="font-size:0.82rem;color:#CBD5E1;padding:4px 0;border-top:1px solid rgba(255,255,255,0.04);">${a}</div>`).join('')}
        </div>` : `
        <div style="background:rgba(16,185,129,0.06);border:1px solid rgba(16,185,129,0.15);border-radius:14px;padding:14px 18px;margin-bottom:20px;">
          <div style="font-size:0.82rem;color:#34D399;">✅ Nenhuma variação expressiva detectada neste mês</div>
        </div>`

      // Tabela de categorias
      const tabelaCats = categorias.length === 0
        ? `<div style="text-align:center;padding:40px;color:#475569;">Nenhuma despesa registrada neste período</div>`
        : `
          <div style="background:rgba(30,41,59,0.6);border:1px solid rgba(255,255,255,0.06);border-radius:16px;overflow:hidden;">
            <div style="padding:16px 20px;border-bottom:1px solid rgba(255,255,255,0.06);">
              <div style="font-size:0.88rem;font-weight:600;color:#94A3B8;">Detalhamento por Categoria</div>
            </div>
            <table style="width:100%;border-collapse:collapse;">
              <thead>
                <tr style="background:rgba(0,0,0,0.2);">
                  <th style="padding:10px 16px;font-size:0.75rem;color:#475569;font-weight:600;text-align:left;">Categoria</th>
                  <th style="padding:10px 16px;font-size:0.75rem;color:#475569;font-weight:600;text-align:right;">${periodo.label_ant}</th>
                  <th style="padding:10px 16px;font-size:0.75rem;color:#475569;font-weight:600;text-align:right;">${periodo.label}</th>
                  <th style="padding:10px 16px;font-size:0.75rem;color:#475569;font-weight:600;text-align:right;">Variação</th>
                  <th style="padding:10px 16px;font-size:0.75rem;color:#475569;font-weight:600;text-align:right;">Barra</th>
                </tr>
              </thead>
              <tbody>
                ${categorias.map((cat, i) => {
                  const cor = cat.variacao > 10 ? '#F43F5E' : cat.variacao < -10 ? '#10B981' : '#F59E0B'
                  const icon = cat.variacao > 10 ? '▲' : cat.variacao < -10 ? '▼' : '→'
                  const maxCat = Math.max(...categorias.map(c => Math.max(c.atual, c.anterior)))
                  const pct = maxCat > 0 ? Math.round((cat.atual / maxCat) * 100) : 0
                  return `
                    <tr style="border-top:1px solid rgba(255,255,255,0.04);${i % 2 === 0 ? '' : 'background:rgba(255,255,255,0.01);'}">
                      <td style="padding:11px 16px;font-size:0.85rem;color:#F8FAFC;font-weight:500;">${cat.categoria}</td>
                      <td style="padding:11px 16px;font-size:0.83rem;color:#64748B;text-align:right;">R$ ${this.formatMoney(cat.anterior)}</td>
                      <td style="padding:11px 16px;font-size:0.83rem;color:#F8FAFC;text-align:right;font-weight:600;">R$ ${this.formatMoney(cat.atual)}</td>
                      <td style="padding:11px 16px;font-size:0.83rem;color:${cor};text-align:right;font-weight:700;">${icon} ${Math.abs(cat.variacao).toFixed(1)}%</td>
                      <td style="padding:11px 16px;text-align:right;min-width:80px;">
                        <div style="height:6px;background:rgba(255,255,255,0.06);border-radius:3px;overflow:hidden;">
                          <div style="height:100%;width:${pct}%;background:${cor};border-radius:3px;transition:width 0.4s;"></div>
                        </div>
                      </td>
                    </tr>`
                }).join('')}
              </tbody>
            </table>
          </div>`

      cont.innerHTML = `
        <!-- KPIs -->
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:14px;margin-bottom:20px;">
          ${kpiCard('Receitas', resumo.receitas_atual, resumo.receitas_ant)}
          ${kpiCard('Despesas', resumo.despesas_atual, resumo.despesas_ant)}
          ${kpiCard('Saldo Líquido', resumo.saldo_atual, resumo.saldo_ant)}
        </div>
        ${barChart}
        ${alertasHtml}
        ${tabelaCats}
      `

      // Conquista
      this.api('GET', 'comparativo?mes=1&ano=2024').catch(() => {}) // disparo silencioso
      await this.api('POST', 'conquistas/verificar', { tipo: 'comparador' }).catch(() => {})

    } catch (err) {
      if (cont) cont.innerHTML = `<div class="empty-state"><div style="font-size:2rem;">📊</div><p>Erro ao carregar comparativo</p></div>`
    }
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // TAGS & FILTROS
  // ═══════════════════════════════════════════════════════════════════════════
  async pageTags() {
    document.getElementById('page-content').innerHTML = `
      <div class="section-header">
        <div>
          <div class="section-title">🏷️ Tags & Filtros</div>
          <div style="color:#64748B;font-size:0.85rem;margin-top:2px;">Organize suas despesas com etiquetas personalizadas</div>
        </div>
        <button onclick="VM.modalNovaTag()" class="btn-primary" style="width:auto;padding:10px 20px;">
          <i class="fas fa-plus"></i> Nova Tag
        </button>
      </div>
      <div id="tags-container">
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px;">
          ${[1,2,3,4,5,6].map(() => `<div class="skeleton" style="height:72px;border-radius:14px;"></div>`).join('')}
        </div>
      </div>
    `
    await this.carregarTags()
  },

  async carregarTags() {
    const cont = document.getElementById('tags-container')
    if (!cont) return
    try {
      const tags = await this.api('GET', 'tags')
      if (!tags || tags.length === 0) {
        cont.innerHTML = `
          <div class="empty-state">
            <div style="font-size:3rem;margin-bottom:16px;">🏷️</div>
            <h3>Nenhuma tag criada</h3>
            <p>Tags ajudam a organizar e filtrar despesas por projeto, viagem, pessoa ou qualquer critério.</p>
            <button onclick="VM.modalNovaTag()" class="btn-primary" style="width:auto;padding:12px 24px;margin-top:16px;">
              <i class="fas fa-plus"></i> Criar primeira tag
            </button>
          </div>`
        return
      }

      // Separar tags com uso e sem uso
      const comUso = tags.filter(t => t.usos > 0).sort((a,b) => b.usos - a.usos)
      const semUso = tags.filter(t => t.usos === 0)

      const renderCard = (tag) => `
        <div style="background:rgba(30,41,59,0.7);border:1px solid rgba(255,255,255,0.07);border-radius:14px;padding:14px 16px;display:flex;align-items:center;gap:14px;transition:border-color 0.2s,background 0.2s;cursor:default;"
          onmouseover="this.style.borderColor='rgba(255,255,255,0.15)';this.style.background='rgba(30,41,59,0.95)'"
          onmouseout="this.style.borderColor='rgba(255,255,255,0.07)';this.style.background='rgba(30,41,59,0.7)'">

          <!-- Dot colorido -->
          <div style="width:38px;height:38px;border-radius:10px;background:${tag.cor}22;border:2px solid ${tag.cor};display:flex;align-items:center;justify-content:center;flex-shrink:0;">
            <div style="width:12px;height:12px;border-radius:3px;background:${tag.cor};"></div>
          </div>

          <!-- Nome + contagem -->
          <div style="flex:1;min-width:0;">
            <div style="font-weight:600;color:#F1F5F9;font-size:0.88rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${tag.nome}">${tag.nome}</div>
            <div style="font-size:0.75rem;color:${tag.usos > 0 ? '#10B981' : '#475569'};margin-top:2px;">
              ${tag.usos > 0
                ? `<i class="fas fa-link" style="font-size:0.65rem;margin-right:3px;"></i>${tag.usos} despesa${tag.usos !== 1 ? 's' : ''} vinculada${tag.usos !== 1 ? 's' : ''}`
                : `<i class="fas fa-unlink" style="font-size:0.65rem;margin-right:3px;"></i>Sem despesas vinculadas`}
            </div>
          </div>

          <!-- Ações -->
          <div style="display:flex;gap:5px;flex-shrink:0;">
            <button onclick="VM.buscarPorTag(${tag.id},'${tag.nome.replace(/'/g,"\\'")}');event.stopPropagation()" title="Ver despesas"
              style="background:rgba(16,185,129,0.1);border:1px solid rgba(16,185,129,0.25);color:#10B981;border-radius:7px;width:30px;height:30px;cursor:pointer;font-size:0.72rem;display:flex;align-items:center;justify-content:center;transition:background 0.15s;"
              onmouseover="this.style.background='rgba(16,185,129,0.22)'" onmouseout="this.style.background='rgba(16,185,129,0.1)'">
              <i class="fas fa-search"></i>
            </button>
            <button onclick="VM.modalEditarTag(${tag.id},'${tag.nome.replace(/'/g,"\\'")}','${tag.cor}');event.stopPropagation()" title="Editar"
              style="background:rgba(148,163,184,0.08);border:1px solid rgba(148,163,184,0.18);color:#94A3B8;border-radius:7px;width:30px;height:30px;cursor:pointer;font-size:0.72rem;display:flex;align-items:center;justify-content:center;transition:background 0.15s;"
              onmouseover="this.style.background='rgba(148,163,184,0.18)'" onmouseout="this.style.background='rgba(148,163,184,0.08)'">
              <i class="fas fa-pen"></i>
            </button>
            <button onclick="VM.excluirTag(${tag.id},'${tag.nome.replace(/'/g,"\\'")}');event.stopPropagation()" title="Excluir"
              style="background:rgba(244,63,94,0.07);border:1px solid rgba(244,63,94,0.2);color:#F43F5E;border-radius:7px;width:30px;height:30px;cursor:pointer;font-size:0.72rem;display:flex;align-items:center;justify-content:center;transition:background 0.15s;"
              onmouseover="this.style.background='rgba(244,63,94,0.18)'" onmouseout="this.style.background='rgba(244,63,94,0.07)'">
              <i class="fas fa-trash"></i>
            </button>
          </div>
        </div>
      `

      cont.innerHTML = `
        <!-- Tags em uso -->
        ${comUso.length > 0 ? `
          <div style="margin-bottom:6px;">
            <div style="font-size:0.72rem;font-weight:600;color:#475569;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:10px;padding-left:2px;">
              Em uso · ${comUso.length}
            </div>
            <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:10px;">
              ${comUso.map(renderCard).join('')}
            </div>
          </div>
        ` : ''}

        <!-- Tags sem uso -->
        ${semUso.length > 0 ? `
          <div style="margin-top:${comUso.length > 0 ? '24px' : '0'};">
            <div style="font-size:0.72rem;font-weight:600;color:#334155;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:10px;padding-left:2px;">
              Sem uso · ${semUso.length}
            </div>
            <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:10px;opacity:0.7;">
              ${semUso.map(renderCard).join('')}
            </div>
          </div>
        ` : ''}

        <div id="tag-busca-resultado" style="margin-top:24px;"></div>
      `
    } catch (err) {
      cont.innerHTML = `<div class="empty-state"><p>Erro ao carregar tags</p></div>`
    }
  },

  modalNovaTag() {
    document.getElementById('modal-container').innerHTML = `
      <div class="modal-overlay" onclick="VM.closeModal(event)">
        <div class="modal" style="max-width:380px;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;">
            <h3 style="font-size:1.05rem;font-weight:700;">🏷️ Nova Tag</h3>
            <button onclick="VM.closeModal()" style="background:none;border:none;color:#666;cursor:pointer;">✕</button>
          </div>
          <div class="form-group">
            <label class="form-label">Nome da tag *</label>
            <input type="text" id="tag-nome" class="form-input" placeholder="Ex: Viagem, Trabalho, Lazer..." maxlength="30" autofocus>
          </div>
          <div class="form-group">
            <label class="form-label">Cor</label>
            <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:4px;" id="tag-cores">
              ${['#10B981','#3B82F6','#8B5CF6','#F59E0B','#F43F5E','#06B6D4','#84CC16','#EC4899','#F97316','#64748B'].map(cor =>
                `<div onclick="VM.selecionarCorTag('${cor}',this)" data-cor="${cor}"
                  style="width:26px;height:26px;border-radius:6px;background:${cor};cursor:pointer;border:2px solid transparent;transition:all 0.15s;"
                  onmouseover="this.style.transform='scale(1.15)'" onmouseout="this.style.transform='scale(1)'"></div>`
              ).join('')}
            </div>
            <input type="hidden" id="tag-cor" value="#10B981">
          </div>
          <div style="display:flex;gap:10px;margin-top:20px;">
            <button onclick="VM.closeModal()" class="btn-secondary" style="flex:1;justify-content:center;">Cancelar</button>
            <button onclick="VM.salvarTag()" class="btn-primary" style="flex:1;justify-content:center;" id="tag-btn">
              <i class="fas fa-check"></i> Criar Tag
            </button>
          </div>
        </div>
      </div>
    `
    // Pré-selecionar primeira cor
    setTimeout(() => {
      const first = document.querySelector('#tag-cores [data-cor]')
      if (first) first.style.borderColor = '#fff'
    }, 50)
  },

  selecionarCorTag(cor, el) {
    document.querySelectorAll('#tag-cores [data-cor]').forEach(e => e.style.borderColor = 'transparent')
    el.style.borderColor = '#fff'
    document.getElementById('tag-cor').value = cor
  },

  // Toggle visual de tag no modal de despesa
  _toggleTag(el) {
    const cor = el.getAttribute('data-tag-cor') || '#10B981'
    const isOn = el.dataset.tagSelected === '1'
    if (isOn) {
      el.dataset.tagSelected = '0'
      el.style.border = '1.5px solid rgba(255,255,255,0.1)'
      el.style.background = 'transparent'
      el.style.color = '#94A3B8'
    } else {
      el.dataset.tagSelected = '1'
      el.style.background = cor + '33'
      el.style.color = cor
      el.style.border = '1.5px solid ' + cor
    }
  },

  // Retorna IDs das tags selecionadas no modal de despesa
  _getTagsSelecionadas() {
    const chips = document.querySelectorAll('#d-tags-chips [data-tag-id][data-tag-selected="1"]')
    return Array.from(chips).map(c => parseInt(c.dataset.tagId))
  },

  async salvarTag() {
    const nome = document.getElementById('tag-nome')?.value.trim()
    const cor  = document.getElementById('tag-cor')?.value
    if (!nome) { this.toast('Informe o nome da tag', 'warning'); return }

    const btn = document.getElementById('tag-btn')
    btn.disabled = true
    try {
      await this.api('POST', 'tags', { nome, cor })
      this.toast(`Tag "${nome}" criada! 🏷️`)
      this.closeModal()
      this.carregarTags()
    } catch (e) {
      this.toast(e.response?.data?.error || 'Erro ao criar tag', 'error')
      btn.disabled = false
    }
  },

  modalEditarTag(id, nome, cor) {
    const cores = ['#10B981','#3B82F6','#8B5CF6','#F59E0B','#F43F5E','#06B6D4','#84CC16','#EC4899','#F97316','#64748B']
    document.getElementById('modal-container').innerHTML = `
      <div class="modal-overlay" onclick="VM.closeModal(event)">
        <div class="modal" style="max-width:380px;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;">
            <h3 style="font-size:1.05rem;font-weight:700;">✏️ Editar Tag</h3>
            <button onclick="VM.closeModal()" style="background:none;border:none;color:#666;cursor:pointer;font-size:1.1rem;">✕</button>
          </div>
          <div class="form-group">
            <label class="form-label">Nome</label>
            <input type="text" id="edit-tag-nome" class="form-input" value="${nome}" maxlength="30" autofocus>
          </div>
          <div class="form-group">
            <label class="form-label">Cor</label>
            <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:4px;" id="edit-tag-cores">
              ${cores.map(c =>
                `<div onclick="VM.selecionarCorTag('${c}',this)" data-cor="${c}"
                  style="width:26px;height:26px;border-radius:6px;background:${c};cursor:pointer;border:2px solid ${c === cor ? '#fff' : 'transparent'};transition:all 0.15s;"
                  onmouseover="this.style.transform='scale(1.15)'" onmouseout="this.style.transform='scale(1)'"></div>`
              ).join('')}
            </div>
            <input type="hidden" id="tag-cor" value="${cor}">
          </div>
          <div style="display:flex;gap:10px;margin-top:20px;">
            <button onclick="VM.closeModal()" class="btn-secondary" style="flex:1;justify-content:center;">Cancelar</button>
            <button onclick="VM.atualizarTag(${id})" class="btn-primary" style="flex:1;justify-content:center;"><i class="fas fa-check"></i> Salvar</button>
          </div>
        </div>
      </div>
    `
  },

  async atualizarTag(id) {
    const nome = document.getElementById('edit-tag-nome')?.value.trim()
    const cor  = document.getElementById('tag-cor')?.value
    if (!nome) { this.toast('Nome é obrigatório', 'warning'); return }
    try {
      await this.api('PATCH', `tags/${id}`, { nome, cor })
      this.toast('Tag atualizada!')
      this.closeModal()
      this.carregarTags()
    } catch (e) {
      this.toast(e.response?.data?.error || 'Erro ao atualizar', 'error')
    }
  },

  async excluirTag(id, nome) {
    const ok = await this.vmConfirm(`Excluir a tag <strong>"${nome}"</strong>? As despesas vinculadas não serão apagadas.`, { titulo: 'Excluir Tag', corBotao: '#ef4444', textoBotao: 'Excluir', icone: '🏷️' })
    if (!ok) return
    try {
      await this.api('DELETE', `tags/${id}`)
      this.toast(`Tag "${nome}" removida`)
      this.carregarTags()
    } catch (e) {
      this.toast(e.response?.data?.error || 'Erro ao excluir', 'error')
    }
  },

  async buscarPorTag(tagId, tagNome) {
    const cont = document.getElementById('tag-busca-resultado')
    if (!cont) return
    cont.innerHTML = `<div style="text-align:center;padding:20px;color:#64748B;"><i class="fas fa-spinner fa-spin"></i> Carregando...</div>`
    try {
      const rows = await this.api('GET', `tags/buscar?tag_id=${tagId}`)
      if (!rows || rows.length === 0) {
        cont.innerHTML = `
          <div style="background:rgba(30,41,59,0.6);border:1px solid rgba(255,255,255,0.06);border-radius:14px;padding:24px;text-align:center;">
            <div style="font-size:2rem;margin-bottom:10px;">🔍</div>
            <div style="color:#64748B;font-size:0.9rem;">Nenhuma despesa com a tag <strong style="color:#10B981;">${tagNome}</strong></div>
            <div style="font-size:0.78rem;color:#475569;margin-top:8px;">Vincule esta tag ao cadastrar ou editar uma despesa</div>
          </div>`
        return
      }

      // Agrupar por mês/ano
      const grupos = {}
      let totalGeral = 0
      const mesesPT = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez']
      rows.forEach(r => {
        const [ano, mes] = (r.data || '').split('-')
        const key = `${ano}-${mes}`
        const label = `${mesesPT[parseInt(mes)-1] || mes}/${ano}`
        if (!grupos[key]) grupos[key] = { label, itens: [], total: 0 }
        grupos[key].itens.push(r)
        grupos[key].total += r.valor
        totalGeral += r.valor
      })

      const gruposOrdenados = Object.keys(grupos).sort((a,b) => b.localeCompare(a))

      cont.innerHTML = `
        <div style="background:rgba(30,41,59,0.6);border:1px solid rgba(255,255,255,0.06);border-radius:16px;overflow:hidden;margin-top:8px;">
          <!-- Header -->
          <div style="padding:14px 18px;border-bottom:1px solid rgba(255,255,255,0.06);display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;">
            <div style="font-size:0.88rem;font-weight:600;color:#94A3B8;">
              🏷️ Tag: <span style="color:#10B981;">${tagNome}</span> · <span style="color:#F8FAFC;">${rows.length} despesa${rows.length !== 1 ? 's' : ''}</span>
            </div>
            <div style="font-size:0.9rem;font-weight:700;color:#F43F5E;">Total: R$ ${this.formatMoney(totalGeral)}</div>
          </div>
          <!-- Por mês -->
          ${gruposOrdenados.map(key => {
            const g = grupos[key]
            return `
            <div style="border-top:1px solid rgba(255,255,255,0.04);">
              <div style="padding:8px 18px 4px;background:rgba(255,255,255,0.02);display:flex;justify-content:space-between;align-items:center;">
                <span style="font-size:0.77rem;font-weight:600;color:#64748B;text-transform:uppercase;letter-spacing:0.05em;">${g.label}</span>
                <span style="font-size:0.78rem;color:#94A3B8;">R$ ${this.formatMoney(g.total)}</span>
              </div>
              ${g.itens.map(r => `
                <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 18px;border-top:1px solid rgba(255,255,255,0.03);">
                  <div>
                    <div style="font-size:0.85rem;color:#F8FAFC;">${r.descricao}</div>
                    <div style="font-size:0.72rem;color:#475569;">${r.data} · ${r.categoria}</div>
                  </div>
                  <div style="font-size:0.87rem;font-weight:600;color:#F43F5E;white-space:nowrap;">R$ ${this.formatMoney(r.valor)}</div>
                </div>
              `).join('')}
            </div>`
          }).join('')}
        </div>`
    } catch (e) {
      cont.innerHTML = `<div style="color:#F43F5E;padding:16px;">Erro ao buscar despesas</div>`
    }
  },

  // ════════════════════════════════════════════════════════════════════════════
  // ALERTAS INTELIGENTES DE CARTÃO
  // ════════════════════════════════════════════════════════════════════════════

  async pageAlertasCartao() {
    const content = document.getElementById('page-content')
    content.innerHTML = `
      <div class="section-header">
        <div>
          <div class="section-title">⚠️ Alertas de Cartão</div>
          <div style="color:#666;font-size:0.85rem;margin-top:2px;">Fatura próxima, limite alto, cobranças duplicadas e anomalias</div>
        </div>
        <button onclick="VM.carregarAlertasCartao()" class="btn-secondary" style="width:auto;padding:9px 16px;">
          <i class="fas fa-sync-alt"></i> Atualizar
        </button>
      </div>
      <div id="alertas-cartao-container">
        <div class="empty-state"><div class="skeleton" style="height:250px;border-radius:16px;"></div></div>
      </div>
    `
    await this.carregarAlertasCartao()
  },

  async carregarAlertasCartao() {
    const cont = document.getElementById('alertas-cartao-container')
    if (!cont) return
    try {
      const r = await this.api('GET', 'alertas-cartao')
      const { alertas, total_nao_lidos } = r

      // Atualizar badge no nav
      const badge = document.getElementById('badge-alertas-cartao')
      if (badge) {
        if (total_nao_lidos > 0) {
          badge.style.display = 'inline-block'
          badge.textContent = total_nao_lidos
        } else {
          badge.style.display = 'none'
        }
      }

      if (!alertas || alertas.length === 0) {
        cont.innerHTML = `
          <div class="empty-state">
            <div style="font-size:3.5rem;margin-bottom:16px;">✅</div>
            <h3 style="color:#10B981;">Tudo em dia!</h3>
            <p style="color:#64748B;max-width:320px;">Nenhum alerta ativo para seus cartões. Continue monitorando regularmente.</p>
          </div>`
        return
      }

      const tipoConfig = {
        fatura_proxima:       { icon: '📅', cor: '#F59E0B', label: 'Fatura Próxima' },
        limite_alto:          { icon: '🔴', cor: '#F43F5E', label: 'Limite Alto' },
        cobranca_duplicada:   { icon: '⚠️', cor: '#EF4444', label: 'Cobrança Duplicada' },
        gasto_incomum:        { icon: '📊', cor: '#8B5CF6', label: 'Gasto Incomum' },
        fatura_acima_media:   { icon: '📈', cor: '#F97316', label: 'Fatura Acima da Média' },
        sem_movimentacao:     { icon: '😴', cor: '#64748B', label: 'Sem Movimentação' }
      }

      // Agrupar por cartão
      const porCartao = {}
      alertas.forEach(a => {
        if (!porCartao[a.cartao_nome]) porCartao[a.cartao_nome] = []
        porCartao[a.cartao_nome].push(a)
      })

      cont.innerHTML = `
        <div style="display:grid;gap:16px;">
          ${Object.entries(porCartao).map(([cartaoNome, items]) => `
            <div style="background:rgba(30,41,59,0.7);border:1px solid rgba(255,255,255,0.07);border-radius:16px;overflow:hidden;">
              <!-- Header do cartão -->
              <div style="padding:14px 18px;border-bottom:1px solid rgba(255,255,255,0.06);display:flex;align-items:center;gap:10px;">
                <div style="width:10px;height:10px;border-radius:50%;background:${items[0].cartao_cor || '#10B981'};"></div>
                <span style="font-weight:700;color:#F8FAFC;font-size:0.92rem;">${cartaoNome}</span>
                <span style="margin-left:auto;background:rgba(244,63,94,0.15);color:#F43F5E;font-size:0.72rem;padding:2px 8px;border-radius:20px;font-weight:700;">${items.length} alerta${items.length > 1 ? 's' : ''}</span>
              </div>
              <!-- Alertas do cartão -->
              <div style="padding:4px 0;">
                ${items.map(a => {
                  const cfg = tipoConfig[a.tipo] || { icon: '🔔', cor: '#F59E0B', label: a.tipo }
                  return `
                    <div style="display:flex;align-items:flex-start;gap:14px;padding:14px 18px;border-top:1px solid rgba(255,255,255,0.03);">
                      <div style="font-size:1.4rem;flex-shrink:0;margin-top:2px;">${cfg.icon}</div>
                      <div style="flex:1;">
                        <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
                          <span style="font-size:0.82rem;font-weight:700;color:${cfg.cor};background:${cfg.cor}18;border:1px solid ${cfg.cor}30;border-radius:6px;padding:2px 8px;">${cfg.label}</span>
                          <span style="font-size:0.7rem;color:#475569;">${new Date(a.created_at).toLocaleDateString('pt-BR')}</span>
                        </div>
                        <div style="font-size:0.87rem;font-weight:600;color:#F8FAFC;margin-bottom:3px;">${a.titulo}</div>
                        <div style="font-size:0.8rem;color:#94A3B8;line-height:1.4;">${a.mensagem}</div>
                      </div>
                      <button onclick="VM.marcarAlertaLido(${a.id})" title="Marcar como lido"
                        style="background:rgba(16,185,129,0.1);border:1px solid rgba(16,185,129,0.2);color:#10B981;border-radius:8px;padding:6px 10px;cursor:pointer;font-size:0.72rem;flex-shrink:0;white-space:nowrap;">
                        <i class="fas fa-check"></i>
                      </button>
                    </div>`
                }).join('')}
              </div>
            </div>
          `).join('')}

          <!-- Botão marcar todos como lidos -->
          <div style="text-align:center;padding:8px 0;">
            <button onclick="VM.marcarTodosAlertasLidos()" class="btn-secondary" style="width:auto;padding:9px 20px;font-size:0.82rem;">
              <i class="fas fa-check-double"></i> Marcar todos como lidos
            </button>
          </div>
        </div>`
    } catch (e) {
      if (cont) cont.innerHTML = `
        <div class="empty-state">
          <div style="font-size:2rem;">⚠️</div>
          <p style="color:#F43F5E;">Erro ao carregar alertas de cartão</p>
          <button onclick="VM.carregarAlertasCartao()" class="btn-secondary" style="width:auto;padding:8px 16px;margin-top:12px;">Tentar novamente</button>
        </div>`
    }
  },

  async marcarAlertaLido(id) {
    try {
      await this.api('PATCH', `alertas-cartao/${id}/lido`, {})
      this.toast('Alerta marcado como lido', 'success')
      await this.carregarAlertasCartao()
    } catch (e) {
      this.toast('Erro ao atualizar alerta', 'error')
    }
  },

  async marcarTodosAlertasLidos() {
    try {
      await this.api('PATCH', 'alertas-cartao/todos-lidos', {})
      this.toast('Todos os alertas marcados como lidos ✅', 'success')
      const badge = document.getElementById('badge-alertas-cartao')
      if (badge) badge.style.display = 'none'
      await this.carregarAlertasCartao()
    } catch (e) {
      this.toast('Erro ao atualizar alertas', 'error')
    }
  },

  async pageRelatorios() {
    // Verifica se o plano tem acesso a relatórios anuais
    if (this.limites !== null && !this.limites.relatorio_anual) {
      this.upsellModal('relatorio_anual')
      this.navigate('dashboard')
      return
    }
    const ano = String(new Date().getFullYear())
    document.getElementById('page-content').innerHTML = `
      <div class="section-header">
        <div class="section-title">📋 Relatórios</div>
        <div style="display:flex;gap:12px;align-items:center;">
          <select id="rel-ano" class="form-select" style="width:auto;padding:8px 14px;">
            ${[parseInt(ano)-2, parseInt(ano)-1, parseInt(ano)].map(a => `<option value="${a}" ${String(a) === ano ? 'selected' : ''}>${a}</option>`).join('')}
          </select>
          <button onclick="VM.carregarRelatorio()" class="btn-secondary"><i class="fas fa-sync"></i> Atualizar</button>
          <button onclick="VM.exportarRelatorioPDF()" class="btn-primary" style="width:auto;padding:9px 16px;background:linear-gradient(135deg,#7C3AED,#6D28D9);">
            <i class="fas fa-file-pdf"></i> Exportar PDF
          </button>
          <button id="btn-export-excel" onclick="VM.exportarRelatorioExcel()" class="btn-primary" style="width:auto;padding:9px 16px;background:linear-gradient(135deg,#059669,#047857);">
            <i class="fas fa-file-excel"></i> Exportar Excel
          </button>
        </div>
      </div>
      <div id="rel-container">
        <div class="empty-state"><div class="skeleton" style="height:300px;border-radius:16px;"></div></div>
      </div>
    `
    this.carregarRelatorio()
  },

  async carregarRelatorio() {
    const ano = document.getElementById('rel-ano')?.value || new Date().getFullYear()
    try {
      const data = await this.api('GET', `dashboard/relatorio?ano=${ano}`)
      const { relatorio, totais, top_categorias = [] } = data

      const temDados = relatorio.some(m => m.receitas > 0 || m.despesas > 0)

      document.getElementById('rel-container').innerHTML = `
        <div class="grid-3" style="margin-bottom:24px;">
          <div class="stat-card"><div class="stat-label" style="margin-bottom:8px;">📥 Receitas ${ano}</div><div class="stat-value positive">${this.formatMoney(totais.receitas)}</div></div>
          <div class="stat-card"><div class="stat-label" style="margin-bottom:8px;">📤 Despesas ${ano}</div><div class="stat-value negative">${this.formatMoney(totais.despesas)}</div></div>
          <div class="stat-card"><div class="stat-label" style="margin-bottom:8px;">💰 Saldo ${ano}</div><div class="stat-value ${totais.saldo >= 0 ? 'positive' : 'negative'}">${this.formatMoney(totais.saldo)}</div></div>
        </div>

        ${!temDados ? `
        <div class="card" style="margin-bottom:24px;text-align:center;padding:40px 20px;">
          <div style="font-size:2.5rem;margin-bottom:12px;">📭</div>
          <div style="font-weight:700;font-size:1rem;color:#f1f5f9;margin-bottom:8px;">Nenhum dado registrado em ${ano}</div>
          <div style="font-size:0.82rem;color:#64748B;line-height:1.6;max-width:360px;margin:0 auto 20px;">
            Adicione receitas e despesas para visualizar sua evolução financeira ao longo do ano.
          </div>
          <button onclick="VM.navigate('despesas')" class="button-premium button-premium--sm">
            <i class="fas fa-plus"></i> Adicionar primeira despesa
          </button>
        </div>
        ` : `
        <div class="card" style="margin-bottom:24px;">
          <div style="font-weight:700;margin-bottom:20px;">📊 Evolução Mensal ${ano}</div>
          <div style="height:280px;"><canvas id="chart-relatorio"></canvas></div>
        </div>
        `}

        <div class="card" style="margin-bottom:24px;">
          <div style="font-weight:700;margin-bottom:16px;">📋 Detalhamento por Mês</div>
          <table class="data-table">
            <thead><tr>
              <th>Mês</th>
              <th style="text-align:right;">Receitas</th>
              <th style="text-align:right;">Despesas</th>
              <th style="text-align:right;">Saldo</th>
              <th style="text-align:right;">Status</th>
            </tr></thead>
            <tbody>
              ${relatorio.map(m => `
                <tr>
                  <td style="font-weight:600;">${m.mes}/${ano}</td>
                  <td style="text-align:right;color:#2FBF71;">${this.formatMoney(m.receitas)}</td>
                  <td style="text-align:right;color:#ff6b6b;">${this.formatMoney(m.despesas)}</td>
                  <td style="text-align:right;font-weight:700;${m.saldo >= 0 ? 'color:#2FBF71' : 'color:#ff6b6b'};">${this.formatMoney(m.saldo)}</td>
                  <td style="text-align:right;">${m.saldo > 0 ? '<span class="badge badge-green">✅ Positivo</span>' : m.saldo < 0 ? '<span class="badge badge-red">❌ Negativo</span>' : '<span class="badge" style="background:rgba(100,116,139,0.15);color:#64748B;">— Neutro</span>'}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>

        <div class="card">
          <div style="font-weight:700;margin-bottom:16px;">🏷️ Top Categorias de Despesas ${ano}</div>
          ${top_categorias.length > 0 ? top_categorias.map((c, i) => `
            <div style="display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid rgba(255,255,255,0.05);">
              <div style="width:24px;height:24px;border-radius:50%;background:rgba(255,107,107,0.15);display:flex;align-items:center;justify-content:center;font-size:0.7rem;font-weight:700;color:#ff6b6b;flex-shrink:0;">${i+1}</div>
              <div style="flex:1;font-size:0.85rem;color:#f1f5f9;">${c.categoria || 'Sem categoria'}</div>
              <div style="font-size:0.8rem;color:#94A3B8;">${c.qtd}x</div>
              <div style="font-weight:700;color:#ff6b6b;font-size:0.9rem;">${this.formatMoney(c.total)}</div>
            </div>
          `).join('') : `
            <div style="text-align:center;padding:24px 0;color:#64748B;">
              <div style="font-size:1.5rem;margin-bottom:8px;">📭</div>
              <div style="font-size:0.85rem;">Nenhuma despesa registrada em ${ano}</div>
              <div style="font-size:0.78rem;margin-top:4px;color:#475569;">As categorias aparecerão assim que você adicionar despesas.</div>
            </div>
          `}
        </div>
      `

      if (temDados) {
        const ctx = document.getElementById('chart-relatorio')
        if (ctx) {
          if (this.charts.relatorio) this.charts.relatorio.destroy()
          this.charts.relatorio = new Chart(ctx, {
            type: 'line',
            data: {
              labels: relatorio.map(m => m.mes),
              datasets: [
                { label: 'Receitas', data: relatorio.map(m => m.receitas), borderColor: '#2FBF71', backgroundColor: 'rgba(47,191,113,0.1)', fill: true, tension: 0.4, pointRadius: 4 },
                { label: 'Despesas', data: relatorio.map(m => m.despesas), borderColor: '#ff6b6b', backgroundColor: 'rgba(255,107,107,0.1)', fill: true, tension: 0.4, pointRadius: 4 },
                { label: 'Saldo', data: relatorio.map(m => m.saldo), borderColor: '#74b9ff', backgroundColor: 'rgba(116,185,255,0.05)', fill: false, tension: 0.4, pointRadius: 4 }
              ]
            },
            options: {
              responsive: true, maintainAspectRatio: false,
              plugins: { legend: { labels: { color: '#888', font: { size: 11 } } } },
              scales: {
                x: { ticks: { color: '#888' }, grid: { color: 'rgba(255,255,255,0.04)' } },
                y: { ticks: { color: '#888', callback: v => 'R$ ' + v.toLocaleString('pt-BR') }, grid: { color: 'rgba(255,255,255,0.04)' } }
              }
            }
          })
        }
      }
    } catch (e) {
      this.toast('Erro ao carregar relatório', 'error')
    }
  },

  // ─── Exportação PDF via jsPDF (carregado sob demanda) ────────────────────
  async exportarRelatorioPDF() {
    const ano = document.getElementById('rel-ano')?.value || new Date().getFullYear()
    const btn = document.querySelector('[onclick="VM.exportarRelatorioPDF()"]')
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Gerando...' }

    try {
      // Carregar jsPDF via CDN se não estiver disponível
      if (!window.jspdf) {
        await new Promise((resolve, reject) => {
          const s = document.createElement('script')
          s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js'
          s.onload = resolve; s.onerror = reject
          document.head.appendChild(s)
        })
      }

      // Buscar dados do relatório
      let data
      try {
        data = await this.api('GET', `relatorio/dados?ano=${ano}`)
      } catch (apiErr) {
        // Se falhar (ex: free plan), gerar com dados do dashboard
        const dashData = await this.api('GET', `dashboard/relatorio?ano=${ano}`)
        data = {
          usuario: { nome: this.user?.nome || 'Usuário', email: this.user?.email || '' },
          periodo: { ano },
          resumo: dashData.totais || {},
          relatorio_mensal: dashData.relatorio || [],
          despesas_por_categoria: [],
          metas: []
        }
      }

      const { jsPDF } = window.jspdf
      const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })

      const nomeUsuario = data.usuario?.nome || this.user?.nome || 'Usuário'
      const verde = [16, 185, 129]
      const escuro = [15, 23, 42]
      const cinza  = [100, 116, 139]

      // ── Cabeçalho ─────────────────────────────────────────────────────────
      doc.setFillColor(...escuro)
      doc.rect(0, 0, 210, 40, 'F')
      doc.setFillColor(...verde)
      doc.rect(0, 38, 210, 2, 'F')

      doc.setTextColor(255, 255, 255)
      doc.setFontSize(20)
      doc.setFont('helvetica', 'bold')
      doc.text('VerdeMais', 14, 18)
      doc.setFontSize(10)
      doc.setFont('helvetica', 'normal')
      doc.setTextColor(...verde)
      doc.text('Finanças Pessoais Inteligentes', 14, 25)
      doc.setTextColor(200, 200, 200)
      doc.setFontSize(9)
      doc.text(`Relatório Anual ${ano} · ${nomeUsuario}`, 14, 32)
      doc.text(`Gerado em ${new Date().toLocaleDateString('pt-BR')}`, 140, 32)

      // ── Resumo Anual ───────────────────────────────────────────────────────
      let y = 52
      doc.setTextColor(...escuro)
      doc.setFontSize(13)
      doc.setFont('helvetica', 'bold')
      doc.text(`Resumo Anual — ${ano}`, 14, y)

      y += 8
      const resumo = data.resumo || data.totais || {}
      const totReceitas = resumo.total_receitas ?? resumo.receitas ?? 0
      const totDespesas = resumo.total_despesas ?? resumo.despesas ?? 0
      const totSaldo    = resumo.saldo_liquido  ?? resumo.saldo    ?? (totReceitas - totDespesas)

      const kpiBoxes = [
        { label: 'Total Receitas', valor: `R$ ${this.formatMoney(totReceitas)}`, cor: [16, 185, 129] },
        { label: 'Total Despesas', valor: `R$ ${this.formatMoney(totDespesas)}`, cor: [244, 63, 94] },
        { label: 'Saldo Líquido',  valor: `R$ ${this.formatMoney(totSaldo)}`,   cor: totSaldo >= 0 ? [16, 185, 129] : [244, 63, 94] }
      ]
      const boxW = 56; const boxH = 22; const boxGap = 5; let bx = 14
      kpiBoxes.forEach(b => {
        doc.setFillColor(245, 247, 250)
        doc.roundedRect(bx, y, boxW, boxH, 3, 3, 'F')
        doc.setFontSize(7.5)
        doc.setFont('helvetica', 'normal')
        doc.setTextColor(...cinza)
        doc.text(b.label, bx + 4, y + 7)
        doc.setFontSize(11)
        doc.setFont('helvetica', 'bold')
        doc.setTextColor(...b.cor)
        doc.text(b.valor, bx + 4, y + 17)
        bx += boxW + boxGap
      })

      // ── Tabela Mensal ──────────────────────────────────────────────────────
      y += boxH + 12
      doc.setTextColor(...escuro)
      doc.setFontSize(12)
      doc.setFont('helvetica', 'bold')
      doc.text('Detalhamento Mensal', 14, y)
      y += 6

      const meses = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez']
      const linhas = data.relatorio_mensal || data.relatorio || []

      // Cabeçalho da tabela
      doc.setFillColor(15, 23, 42)
      doc.rect(14, y, 182, 7, 'F')
      doc.setTextColor(255, 255, 255)
      doc.setFontSize(8)
      doc.setFont('helvetica', 'bold')
      const cols = [14, 50, 100, 150, 170]
      const headers = ['Mês', 'Receitas (R$)', 'Despesas (R$)', 'Saldo (R$)', 'Status']
      headers.forEach((h, i) => doc.text(h, cols[i] + 2, y + 5))
      y += 7

      linhas.forEach((m, idx) => {
        const bg = idx % 2 === 0 ? [250, 251, 252] : [255, 255, 255]
        doc.setFillColor(...bg)
        doc.rect(14, y, 182, 6.5, 'F')

        const mesLabel = typeof m.mes === 'number' ? meses[m.mes - 1] : (m.mes || String(idx + 1))
        const saldo = (m.saldo ?? (m.receitas - m.despesas))

        doc.setTextColor(...cinza)
        doc.setFont('helvetica', 'normal')
        doc.setFontSize(8)
        doc.text(String(mesLabel), cols[0] + 2, y + 4.5)
        doc.setTextColor(16, 185, 129)
        doc.text(`${this.formatMoney(m.receitas || 0)}`, cols[1] + 2, y + 4.5)
        doc.setTextColor(244, 63, 94)
        doc.text(`${this.formatMoney(m.despesas || 0)}`, cols[2] + 2, y + 4.5)
        doc.setTextColor(saldo >= 0 ? 16 : 244, saldo >= 0 ? 185 : 63, saldo >= 0 ? 129 : 94)
        doc.text(`${this.formatMoney(saldo)}`, cols[3] + 2, y + 4.5)
        doc.setTextColor(...(saldo >= 0 ? verde : [244, 63, 94]))
        doc.text(saldo >= 0 ? '✓ Positivo' : '✗ Negativo', cols[4] + 2, y + 4.5)
        y += 6.5

        if (y > 270) {
          doc.addPage()
          y = 20
        }
      })

      // ── Rodapé ─────────────────────────────────────────────────────────────
      const pageCount = doc.getNumberOfPages()
      for (let i = 1; i <= pageCount; i++) {
        doc.setPage(i)
        doc.setFillColor(...escuro)
        doc.rect(0, 285, 210, 12, 'F')
        doc.setTextColor(...cinza)
        doc.setFontSize(7)
        doc.text('VerdeMais — Finanças Pessoais Inteligentes', 14, 292)
        doc.text(`Página ${i} de ${pageCount}`, 170, 292)
      }

      doc.save(`VerdeMais_Relatorio_${ano}.pdf`)
      this.toast(`✅ PDF gerado: VerdeMais_Relatorio_${ano}.pdf`, 'success')
    } catch (err) {
      console.error(err)
      this.toast('Erro ao gerar PDF. Tente novamente.', 'error')
    } finally {
      if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-file-pdf"></i> Exportar PDF' }
    }
  },

  // ─── Exportação Excel via SheetJS (CDN sob demanda) ─────────────────────────
  async exportarRelatorioExcel() {
    const hoje = new Date()
    const mes  = hoje.getMonth() + 1
    const ano  = hoje.getFullYear()
    const btnId = 'btn-export-excel'
    const btn  = document.getElementById(btnId)
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Gerando Excel...' }

    try {
      // Carregar SheetJS via CDN se não carregado
      if (!window.XLSX) {
        await new Promise((resolve, reject) => {
          const s = document.createElement('script')
          s.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js'
          s.onload = resolve; s.onerror = reject
          document.head.appendChild(s)
        })
      }

      // Buscar dados completos via API (premium) ou fallback anual
      let relData
      try {
        // Tenta dados mensais detalhados
        relData = await this.api('GET', `relatorio/dados?mes=${mes}&ano=${ano}`)
      } catch(e) {
        relData = null
      }

      // Fallback: usar dados do relatório anual do dashboard
      let anoData
      try {
        anoData = await this.api('GET', `dashboard/relatorio?ano=${ano}`)
      } catch(e) { anoData = null }

      const XLSX = window.XLSX
      const wb   = XLSX.utils.book_new()

      // ── Aba 1: Resumo ────────────────────────────────────────────────────────
      const resumoRows = [
        ['VerdeMais — Relatório Financeiro', '', '', ''],
        ['Usuário:', this.user?.nome || '-', 'Plano:', (this.user?.plano || 'free').toUpperCase()],
        ['Período:', `${new Date().toLocaleDateString('pt-BR')}`, '', ''],
        ['', '', '', ''],
        ['RESUMO ANUAL ' + ano, '', '', ''],
      ]

      if (anoData?.totais) {
        const t = anoData.totais
        resumoRows.push(
          ['Total Receitas',  `R$ ${this.formatMoney(t.receitas  || 0)}`, '', ''],
          ['Total Despesas',  `R$ ${this.formatMoney(t.despesas  || 0)}`, '', ''],
          ['Saldo Líquido',   `R$ ${this.formatMoney(t.saldo     || 0)}`, '', ''],
        )
      }

      const wsResumo = XLSX.utils.aoa_to_sheet(resumoRows)
      wsResumo['!cols'] = [{ wch: 22 }, { wch: 18 }, { wch: 14 }, { wch: 14 }]
      XLSX.utils.book_append_sheet(wb, wsResumo, 'Resumo')

      // ── Aba 2: Evolução Mensal ───────────────────────────────────────────────
      if (anoData?.relatorio) {
        const mesesNomes = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez']
        const mesRows = [['Mês', 'Receitas (R$)', 'Despesas (R$)', 'Saldo (R$)', 'Status']]
        for (const m of anoData.relatorio) {
          const saldo = m.saldo ?? (m.receitas - m.despesas)
          mesRows.push([
            typeof m.mes === 'number' ? mesesNomes[m.mes - 1] : m.mes,
            m.receitas  || 0,
            m.despesas  || 0,
            saldo,
            saldo >= 0 ? 'Positivo' : 'Negativo'
          ])
        }
        const wsMensal = XLSX.utils.aoa_to_sheet(mesRows)
        wsMensal['!cols'] = [{ wch: 10 }, { wch: 16 }, { wch: 16 }, { wch: 16 }, { wch: 12 }]
        XLSX.utils.book_append_sheet(wb, wsMensal, 'Evolução Mensal')
      }

      // ── Aba 3: Despesas Mensais (se premium) ─────────────────────────────────
      if (relData?.despesas?.length > 0) {
        const despRows = [['Data', 'Descrição', 'Categoria', 'Valor (R$)', 'Status', 'Cartão', 'Tags']]
        for (const d of relData.despesas) {
          despRows.push([
            d.data, d.descricao, d.categoria,
            d.valor, d.status,
            d.cartao_nome || '-',
            d.tags ? d.tags.replace(/\|/g, ', ') : '-'
          ])
        }
        const wsDesp = XLSX.utils.aoa_to_sheet(despRows)
        wsDesp['!cols'] = [{ wch: 12 }, { wch: 30 }, { wch: 18 }, { wch: 12 }, { wch: 10 }, { wch: 16 }, { wch: 20 }]
        XLSX.utils.book_append_sheet(wb, wsDesp, 'Despesas')
      }

      // ── Aba 4: Receitas Mensais (se premium) ─────────────────────────────────
      if (relData?.receitas?.length > 0) {
        const recRows = [['Data', 'Descrição', 'Categoria', 'Valor (R$)', 'Observações']]
        for (const r of relData.receitas) {
          recRows.push([r.data, r.descricao, r.categoria, r.valor, r.observacoes || '-'])
        }
        const wsRec = XLSX.utils.aoa_to_sheet(recRows)
        wsRec['!cols'] = [{ wch: 12 }, { wch: 30 }, { wch: 18 }, { wch: 12 }, { wch: 30 }]
        XLSX.utils.book_append_sheet(wb, wsRec, 'Receitas')
      }

      // ── Aba 5: Investimentos ─────────────────────────────────────────────────
      if (relData?.investimentos?.length > 0) {
        const invRows = [['Nome', 'Tipo', 'Investido (R$)', 'Atual (R$)', 'Rentabilidade (%)', 'Instituição']]
        for (const i of relData.investimentos) {
          invRows.push([i.nome, i.tipo, i.valor_investido, i.valor_atual, i.rentabilidade_percentual || 0, i.instituicao || '-'])
        }
        const wsInv = XLSX.utils.aoa_to_sheet(invRows)
        wsInv['!cols'] = [{ wch: 24 }, { wch: 16 }, { wch: 16 }, { wch: 14 }, { wch: 18 }, { wch: 20 }]
        XLSX.utils.book_append_sheet(wb, wsInv, 'Investimentos')
      }

      // ── Aba 6: Metas ─────────────────────────────────────────────────────────
      if (relData?.metas?.length > 0) {
        const metaRows = [['Nome', 'Objetivo (R$)', 'Atual (R$)', 'Progresso (%)', 'Data Meta', 'Status']]
        for (const m of relData.metas) {
          metaRows.push([m.nome, m.valor_objetivo, m.valor_atual, m.progresso || 0, m.data_meta, m.status])
        }
        const wsMetas = XLSX.utils.aoa_to_sheet(metaRows)
        wsMetas['!cols'] = [{ wch: 24 }, { wch: 16 }, { wch: 14 }, { wch: 16 }, { wch: 12 }, { wch: 12 }]
        XLSX.utils.book_append_sheet(wb, wsMetas, 'Metas')
      }

      // Gerar arquivo
      const fileName = `VerdeMais_Relatorio_${ano}_${String(mes).padStart(2,'0')}.xlsx`
      XLSX.writeFile(wb, fileName)
      this.toast(`✅ Excel gerado: ${fileName}`, 'success')

      // Conquista: exportador
      this.api('GET', `relatorio/dados?mes=${mes}&ano=${ano}`).catch(() => {})
    } catch(err) {
      console.error('Erro Excel:', err)
      this.toast('Erro ao gerar Excel. Tente novamente.', 'error')
    } finally {
      if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-file-excel"></i> Exportar Excel' }
    }
  },


  pageSimulacao() {
    // Verifica se o plano tem acesso a simulação
    if (this.limites !== null && !this.limites.simulacao) {
      this.upsellModal('simulacao')
      this.navigate('dashboard')
      return
    }
    document.getElementById('page-content').innerHTML = `
      <div class="section-header">
        <div class="section-title">🧮 Simulador de Investimentos</div>
      </div>
      
      <div style="display:grid;grid-template-columns:380px 1fr;gap:24px;align-items:start;">
        <div class="card">
          <div style="font-weight:700;margin-bottom:20px;">⚙️ Parâmetros</div>
          
          <div class="form-group">
            <label class="form-label">Valor Inicial (R$)</label>
            <input type="number" id="sim-valor" class="form-input" placeholder="1000" value="1000" min="1" step="100">
          </div>
          
          <div class="form-group">
            <label class="form-label">Tipo de Investimento</label>
            <select id="sim-tipo" class="form-select">
              <option value="poupanca">🐷 Poupança (~6% a.a.)</option>
              <option value="cdb" selected>🏦 CDB (~11% a.a.)</option>
              <option value="lci">📋 LCI/LCA (~10.5% a.a.)</option>
              <option value="tesouro_direto">🏛️ Tesouro Direto (~10% a.a.)</option>
              <option value="fii">🏢 FII (~9.6% a.a.)</option>
              <option value="acoes">📊 Ações (~14.4% a.a.)</option>
              <option value="cripto">₿ Cripto (~24% a.a.)</option>
            </select>
          </div>
          
          <div class="form-group">
            <label class="form-label">Prazo</label>
            <select id="sim-prazo" class="form-select">
              <option value="6">6 meses</option>
              <option value="12" selected>1 ano</option>
              <option value="24">2 anos</option>
              <option value="36">3 anos</option>
              <option value="60">5 anos</option>
              <option value="120">10 anos</option>
            </select>
          </div>
          
          <button onclick="VM.simular()" class="btn-primary">
            <i class="fas fa-calculator"></i> Simular
          </button>
          
          <div style="margin-top:20px;padding:14px;background:rgba(255,196,0,0.08);border:1px solid rgba(255,196,0,0.2);border-radius:12px;font-size:0.78rem;color:#aaa;line-height:1.6;">
            ⚠️ <strong style="color:#ffc400;">Aviso:</strong> Esta é uma simulação educacional com taxas médias de mercado. Rentabilidades passadas não garantem resultados futuros. Consulte um assessor financeiro.
          </div>
        </div>
        
        <div id="sim-resultado">
          <div class="card" style="text-align:center;padding:60px 40px;">
            <div style="font-size:3rem;margin-bottom:16px;">🧮</div>
            <h3 style="font-size:1.2rem;margin-bottom:8px;">Configure sua simulação</h3>
            <p style="color:#666;">Ajuste os parâmetros e clique em "Simular"</p>
          </div>
        </div>
      </div>
    `
  },

  async simular() {
    const valor = document.getElementById('sim-valor').value
    const tipo = document.getElementById('sim-tipo').value
    const prazo = document.getElementById('sim-prazo').value

    if (!valor || parseFloat(valor) <= 0) { this.toast('Informe um valor válido', 'warning'); return }

    const resultEl = document.getElementById('sim-resultado')
    resultEl.innerHTML = `<div class="card" style="text-align:center;padding:40px;"><div class="skeleton" style="height:200px;border-radius:12px;"></div></div>`

    try {
      const data = await this.api('GET', `investimentos/simulacao?valor=${valor}&tipo=${tipo}&prazo_meses=${prazo}`)
      const s = data.simulacao
      const tipoNames = { poupanca: 'Poupança', cdb: 'CDB', lci: 'LCI/LCA', tesouro_direto: 'Tesouro Direto', fii: 'FII', acoes: 'Ações', cripto: 'Cripto' }

      resultEl.innerHTML = `
        <div style="display:flex;flex-direction:column;gap:20px;">
          <div class="grid-3">
            <div class="stat-card">
              <div class="stat-label" style="margin-bottom:8px;">💰 Valor Final</div>
              <div class="stat-value positive">${this.formatMoney(s.valor_final)}</div>
            </div>
            <div class="stat-card">
              <div class="stat-label" style="margin-bottom:8px;">📈 Lucro</div>
              <div class="stat-value positive">+ ${this.formatMoney(s.lucro_total)}</div>
            </div>
            <div class="stat-card">
              <div class="stat-label" style="margin-bottom:8px;">📊 Rentabilidade</div>
              <div class="stat-value positive">+${s.rentabilidade_total.toFixed(2)}%</div>
            </div>
          </div>
          
          <div class="card">
            <div style="font-weight:700;margin-bottom:20px;">📊 Projeção de Crescimento — ${tipoNames[tipo]}</div>
            <div style="height:260px;"><canvas id="chart-simulacao"></canvas></div>
          </div>
          
          <div class="card">
            <div style="font-weight:700;margin-bottom:16px;">📋 Detalhamento</div>
            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;">
              ${s.projecao.map(p => `
                <div style="background:rgba(255,255,255,0.03);border-radius:12px;padding:14px;display:flex;justify-content:space-between;align-items:center;">
                  <div>
                    <div style="font-size:0.8rem;color:#888;">Mês ${p.mes}</div>
                    <div style="font-weight:600;">${this.formatMoney(p.valor)}</div>
                  </div>
                  <div style="text-align:right;">
                    <div style="font-size:0.75rem;color:#2FBF71;">+${this.formatMoney(p.lucro)}</div>
                  </div>
                </div>
              `).join('')}
            </div>
          </div>
        </div>
      `

      // Chart
      const ctx = document.getElementById('chart-simulacao')
      if (ctx) {
        if (this.charts.simulacao) this.charts.simulacao.destroy()
        const labels = ['Hoje', ...s.projecao.map(p => `Mês ${p.mes}`)]
        const valores = [s.valor_inicial, ...s.projecao.map(p => p.valor)]
        this.charts.simulacao = new Chart(ctx, {
          type: 'line',
          data: {
            labels,
            datasets: [
              { label: 'Projeção', data: valores, borderColor: '#2FBF71', backgroundColor: 'rgba(47,191,113,0.15)', fill: true, tension: 0.4, pointRadius: 4, pointBackgroundColor: '#2FBF71' }
            ]
          },
          options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { labels: { color: '#888', font: { size: 11 } } } },
            scales: {
              x: { ticks: { color: '#888' }, grid: { color: 'rgba(255,255,255,0.04)' } },
              y: { ticks: { color: '#888', callback: v => 'R$ ' + v.toLocaleString('pt-BR') }, grid: { color: 'rgba(255,255,255,0.04)' } }
            }
          }
        })
      }
    } catch (e) {
      this.toast('Erro na simulação', 'error')
    }
  },

  // ============== PERFIL ==============
  async pagePerfil() {
    // Buscar perfil atualizado do servidor
    document.getElementById('page-content').innerHTML = `<div class="empty-state"><div class="skeleton" style="height:400px;border-radius:16px;"></div></div>`
    let perfilData = {}
    try {
      const res = await this.api('GET', 'perfil')
      perfilData = res.perfil || {}
      // Atualizar user local com dados completos
      this.user = { ...this.user, ...perfilData }
    } catch(e) {
      perfilData = this.user || {}
    }
    this.renderPerfil(perfilData)
  },

  renderPerfil(p) {
    const planoColors = { free: '#888', premium: '#2FBF71', pro: '#a29bfe' }
    const planoIcons = { free: '🌱', premium: '💎', pro: '🚀' }
    const situacaoLabels = {
      empregado_clt: 'CLT / Empregado', autonomo: 'Autônomo', empresario: 'Empresário',
      freelancer: 'Freelancer', servidor_publico: 'Servidor Público', aposentado: 'Aposentado',
      estudante: 'Estudante', desempregado: 'Buscando emprego'
    }
    const perfilInvLabels = { conservador: '🛡️ Conservador', moderado: '⚖️ Moderado', arrojado: '🚀 Arrojado' }
    const score = p.score_saude || 0

    document.getElementById('page-content').innerHTML = `
      <div style="max-width:700px;">

        <!-- HEADER PERFIL -->
        <div class="card" style="margin-bottom:20px;">
          <div style="display:flex;align-items:center;gap:20px;margin-bottom:24px;">
            <div style="width:72px;height:72px;background:${p.avatar_color || '#2FBF71'};border-radius:20px;display:flex;align-items:center;justify-content:center;font-size:1.8rem;font-weight:700;">
              ${(p.nome || 'U').split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase()}
            </div>
            <div style="flex:1;">
              <div style="font-size:1.3rem;font-weight:700;">${p.nome || '-'}</div>
              <div style="color:#888;font-size:0.9rem;">${p.email || '-'}</div>
              <div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap;">
                <span class="badge" style="background:${planoColors[p.plano]||'#888'}22;color:${planoColors[p.plano]||'#888'};border:1px solid ${planoColors[p.plano]||'#888'}44;font-size:0.8rem;padding:5px 14px;">
                  ${planoIcons[p.plano]||'🌱'} Plano ${(p.plano||'Free').charAt(0).toUpperCase()+(p.plano||'free').slice(1)}
                </span>
                ${p.perfil_completo ? '<span class="badge badge-green" style="font-size:0.75rem;">✓ Perfil Completo</span>' : '<span class="badge" style="background:rgba(255,196,0,0.12);color:#ffc400;font-size:0.75rem;">⚠ Perfil Incompleto</span>'}
              </div>
            </div>
            <button onclick="VM.editarDadosPessoais()" class="btn-secondary" style="width:auto;padding:8px 16px;font-size:0.85rem;">
              <i class="fas fa-pen"></i> Editar
            </button>
          </div>

          <!-- Dados pessoais rápidos -->
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
            ${[
              { l: '👤 Profissão', v: p.profissao || '—' },
              { l: '💼 Situação', v: situacaoLabels[p.situacao_emprego] || '—' },
              { l: '💰 Renda Mensal', v: p.salario_mensal ? this.formatMoney(p.salario_mensal) : '—' },
              { l: '➕ Outras Rendas', v: p.outras_rendas ? this.formatMoney(p.outras_rendas) : '—' },
              { l: '👨‍👩‍👧 Dependentes', v: p.dependentes !== null ? `${p.dependentes} pessoa(s)` : '—' },
              { l: '💍 Estado Civil', v: p.estado_civil ? p.estado_civil.charAt(0).toUpperCase()+p.estado_civil.slice(1) : '—' },
              { l: '📍 Cidade/UF', v: (p.cidade||p.estado) ? `${p.cidade||''}${p.estado?' / '+p.estado:''}` : '—' },
              { l: '📊 Perfil Investidor', v: perfilInvLabels[p.perfil_investidor] || '—' }
            ].map(item => `
              <div style="padding:12px;background:rgba(255,255,255,0.03);border-radius:10px;">
                <div style="font-size:0.75rem;color:#666;margin-bottom:4px;">${item.l}</div>
                <div style="font-size:0.9rem;font-weight:600;">${item.v}</div>
              </div>
            `).join('')}
          </div>
        </div>

        <!-- SEGURANÇA -->
        <div class="card" style="margin-bottom:20px;">
          <div style="font-weight:700;margin-bottom:16px;">🔐 Segurança da Conta</div>
          <div style="display:flex;flex-direction:column;gap:10px;">
            <div style="display:flex;justify-content:space-between;align-items:center;padding:12px;background:rgba(255,255,255,0.03);border-radius:10px;">
              <div>
                <div style="font-size:0.88rem;font-weight:600;">✉️ E-mail</div>
                <div style="font-size:0.8rem;color:#888;">${p.email || '-'}</div>
              </div>
              <button onclick="VM.modalAlterarEmail()" class="btn-secondary" style="width:auto;padding:6px 14px;font-size:0.8rem;">Alterar</button>
            </div>
            <div style="display:flex;justify-content:space-between;align-items:center;padding:12px;background:rgba(255,255,255,0.03);border-radius:10px;">
              <div>
                <div style="font-size:0.88rem;font-weight:600;">🔑 Senha</div>
                <div style="font-size:0.8rem;color:#888;">••••••••</div>
              </div>
              <button onclick="VM.modalAlterarSenha()" class="btn-secondary" style="width:auto;padding:6px 14px;font-size:0.8rem;">Alterar</button>
            </div>
          </div>
        </div>

        <!-- NOTIFICAÇÕES PUSH -->
        <div class="card" style="margin-bottom:20px;">
          <div style="font-weight:700;margin-bottom:16px;">🔔 Notificações</div>
          <div style="display:flex;flex-direction:column;gap:10px;">
            <div style="display:flex;justify-content:space-between;align-items:center;padding:12px;background:rgba(255,255,255,0.03);border-radius:10px;">
              <div>
                <div style="font-size:0.88rem;font-weight:600;">📱 Notificações Push</div>
                <div style="font-size:0.8rem;color:#888;" id="push-status-txt">Verificando...</div>
              </div>
              <button onclick="VM.ativarNotificacoesPush()" class="btn-primary" style="width:auto;padding:6px 14px;font-size:0.8rem;display:none;" id="btn-push-ativar">
                Ativar
              </button>
            </div>
            <div style="font-size:0.78rem;color:#475569;padding:0 4px;">
              Receba alertas sobre vencimentos, conquistas e cartões diretamente no dispositivo.
            </div>
          </div>
        </div>

        <!-- MEU PLANO -->
        <div class="card" style="margin-bottom:20px;">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">
            <div style="font-weight:700;">📊 Meu Plano</div>
            ${p.plano !== 'pro' ? `<button onclick="VM.openPricingModal()" class="btn-primary" style="width:auto;padding:8px 18px;font-size:0.82rem;"><i class="fas fa-crown"></i> Fazer Upgrade</button>` : ''}
          </div>
          <div style="display:grid;gap:12px;">
            ${['free', 'premium', 'pro'].map(pl => {
              const isAtual = p.plano === pl
              const planoColors = { free: '#888', premium: '#2FBF71', pro: '#a29bfe' }
              const planoIcons  = { free: '🌱', premium: '💎', pro: '🚀' }
              const features = {
                free:    ['Dashboard básico', 'Até 30 despesas/mês', 'Até 3 metas', 'Reserva de emergência'],
                premium: ['Lançamentos ilimitados', 'Orçamentos por categoria', 'Recorrências automáticas', 'Projeção financeira', 'Score financeiro + IA'],
                pro:     ['Tudo do Premium', 'Multi-usuário familiar', 'Fluxo de caixa futuro', 'Suporte WhatsApp', 'API access']
              }
              const precos = { free: 'Grátis', premium: 'R$ 17,90/mês', pro: 'R$ 37,90/mês' }
              const podeUpgrade = !isAtual && (pl !== 'free') && (pl === 'pro' ? p.plano !== 'pro' : p.plano === 'free')
              return `
                <div style="padding:16px;border-radius:12px;border:2px solid ${isAtual ? planoColors[pl] : 'rgba(255,255,255,0.06)'};background:${isAtual ? `${planoColors[pl]}08` : 'transparent'};transition:border-color 0.2s;">
                  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
                    <div style="font-weight:700;font-size:0.95rem;">${planoIcons[pl]} ${pl.charAt(0).toUpperCase()+pl.slice(1)}</div>
                    <div style="display:flex;align-items:center;gap:8px;">
                      <div style="font-size:0.9rem;font-weight:600;color:${planoColors[pl]};">${precos[pl]}</div>
                      ${isAtual ? `<span style="background:${planoColors[pl]}22;color:${planoColors[pl]};border:1px solid ${planoColors[pl]}44;font-size:0.68rem;font-weight:700;padding:3px 10px;border-radius:20px;">✓ Atual</span>` : ''}
                      ${podeUpgrade ? `<button onclick="VM.openUpgradeModal('${pl}')" style="background:${planoColors[pl]}22;color:${planoColors[pl]};border:1px solid ${planoColors[pl]}44;font-size:0.72rem;font-weight:700;padding:5px 12px;border-radius:20px;cursor:pointer;transition:all 0.2s;" onmouseover="this.style.background='${planoColors[pl]}33'" onmouseout="this.style.background='${planoColors[pl]}22'">Assinar →</button>` : ''}
                    </div>
                  </div>
                  <div style="display:flex;flex-wrap:wrap;gap:6px;">
                    ${features[pl].map(f => `<span style="font-size:0.72rem;color:${isAtual ? '#94a3b8' : '#475569'};background:rgba(255,255,255,0.03);border-radius:4px;padding:2px 6px;">✓ ${f}</span>`).join('')}
                  </div>
                </div>
              `
            }).join('')}
          </div>
          ${p.plano === 'free' ? `
            <div style="margin-top:16px;padding:14px;background:rgba(59,130,246,0.06);border:1px solid rgba(59,130,246,0.2);border-radius:10px;display:flex;align-items:center;gap:14px;">
              <div style="font-size:1.5rem;">🚀</div>
              <div style="flex:1;">
                <div style="font-size:0.85rem;font-weight:700;margin-bottom:2px;">Desbloqueie o plano completo</div>
                <div style="font-size:0.78rem;color:#888;">Orçamentos, recorrências, projeção financeira e muito mais por <strong style="color:#3B82F6;">R$ 17,90/mês</strong></div>
              </div>
              <button onclick="VM.openPricingModal()" style="background:linear-gradient(135deg,#3B82F6,#2563EB);color:#fff;border:none;border-radius:8px;padding:9px 18px;font-size:0.82rem;font-weight:700;cursor:pointer;white-space:nowrap;">Ver Planos</button>
            </div>` : ''}
        </div>

        <button onclick="VM.logout()" class="btn-danger" style="width:100%;display:flex;align-items:center;justify-content:center;gap:8px;padding:12px;">
          <i class="fas fa-sign-out-alt"></i> Sair da conta
        </button>
      </div>
    `
  },

  editarDadosPessoais() {
    const p = this.user || {}
    const mc = document.getElementById('modal-container')
    mc.innerHTML = `
      <div class="modal-overlay" onclick="VM.closeModal(event)">
        <div class="modal" style="max-width:540px;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:24px;">
            <h3 style="font-size:1.1rem;font-weight:700;">✏️ Editar Perfil</h3>
            <button onclick="VM.closeModal()" style="background:none;border:none;color:#666;font-size:1.2rem;cursor:pointer;">✕</button>
          </div>
          <form id="perfil-form">
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
              <div class="form-group" style="grid-column:1/-1;">
                <label class="form-label">Nome completo *</label>
                <input type="text" id="p-nome" class="form-input" value="${p.nome||''}" required>
              </div>
              <div class="form-group">
                <label class="form-label">Profissão</label>
                <input type="text" id="p-profissao" class="form-input" placeholder="Ex: Engenheiro" value="${p.profissao||''}">
              </div>
              <div class="form-group">
                <label class="form-label">Situação de Emprego</label>
                <select id="p-situacao" class="form-select">
                  ${[['empregado_clt','👔 CLT'],['autonomo','💼 Autônomo'],['empresario','🏢 Empresário'],['freelancer','💻 Freelancer'],['servidor_publico','🏛️ Servidor Público'],['aposentado','🌅 Aposentado'],['estudante','🎓 Estudante'],['desempregado','🔍 Buscando emprego']].map(([v,l])=>`<option value="${v}" ${p.situacao_emprego===v?'selected':''}>${l}</option>`).join('')}
                </select>
              </div>
              <div class="form-group">
                <label class="form-label">Renda Mensal (R$)</label>
                <input type="number" id="p-salario" class="form-input" step="0.01" min="0" value="${p.salario_mensal||0}">
              </div>
              <div class="form-group">
                <label class="form-label">Outras Rendas (R$)</label>
                <input type="number" id="p-outras" class="form-input" step="0.01" min="0" value="${p.outras_rendas||0}">
              </div>
              <div class="form-group">
                <label class="form-label">Dependentes</label>
                <input type="number" id="p-dep" class="form-input" min="0" max="20" value="${p.dependentes||0}">
              </div>
              <div class="form-group">
                <label class="form-label">Estado Civil</label>
                <select id="p-ecivil" class="form-select">
                  ${[['solteiro','Solteiro(a)'],['casado','Casado(a)'],['divorciado','Divorciado(a)'],['viuvo','Viúvo(a)'],['uniao_estavel','União Estável']].map(([v,l])=>`<option value="${v}" ${p.estado_civil===v?'selected':''}>${l}</option>`).join('')}
                </select>
              </div>
              <div class="form-group">
                <label class="form-label">Cidade</label>
                <input type="text" id="p-cidade" class="form-input" value="${p.cidade||''}">
              </div>
              <div class="form-group">
                <label class="form-label">Estado (UF)</label>
                <input type="text" id="p-estado" class="form-input" maxlength="2" placeholder="SP" value="${p.estado||''}">
              </div>
              <div class="form-group" style="grid-column:1/-1;">
                <label class="form-label">Perfil de Investidor</label>
                <select id="p-perfinv" class="form-select">
                  <option value="conservador" ${p.perfil_investidor==='conservador'?'selected':''}>🛡️ Conservador</option>
                  <option value="moderado" ${p.perfil_investidor==='moderado'?'selected':''}>⚖️ Moderado</option>
                  <option value="arrojado" ${p.perfil_investidor==='arrojado'?'selected':''}>🚀 Arrojado</option>
                </select>
              </div>
            </div>
            <div style="display:flex;gap:12px;margin-top:16px;">
              <button type="button" onclick="VM.closeModal()" class="btn-secondary" style="flex:1;justify-content:center;">Cancelar</button>
              <button type="submit" class="btn-primary" style="flex:1;" id="p-submit"><i class="fas fa-save"></i> Salvar</button>
            </div>
          </form>
        </div>
      </div>
    `
    document.getElementById('perfil-form').addEventListener('submit', async (e) => {
      e.preventDefault()
      const btn = document.getElementById('p-submit')
      btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Salvando...'
      try {
        const payload = {
          nome: document.getElementById('p-nome').value,
          profissao: document.getElementById('p-profissao').value,
          situacao_emprego: document.getElementById('p-situacao').value,
          salario_mensal: parseFloat(document.getElementById('p-salario').value)||0,
          outras_rendas: parseFloat(document.getElementById('p-outras').value)||0,
          dependentes: parseInt(document.getElementById('p-dep').value)||0,
          estado_civil: document.getElementById('p-ecivil').value,
          cidade: document.getElementById('p-cidade').value,
          estado: document.getElementById('p-estado').value.toUpperCase(),
          perfil_investidor: document.getElementById('p-perfinv').value
        }
        await this.api('PUT', 'perfil', payload)
        this.user = { ...this.user, ...payload }
        localStorage.setItem('vm_user', JSON.stringify(this.user))
        // Atualizar nome no sidebar
        const sidebarNome = document.querySelector('.sidebar-user div:first-child')
        if (sidebarNome) sidebarNome.textContent = payload.nome.split(' ')[0]
        this.toast('Perfil atualizado! ✅')
        this.closeModal()
        this.pagePerfil()
      } catch(err) {
        this.toast(err.response?.data?.error || 'Erro ao salvar', 'error')
        btn.disabled = false; btn.innerHTML = '<i class="fas fa-save"></i> Salvar'
      }
    })
    // Verificar status de notificações push após renderizar
    setTimeout(() => {
      const statusEl = document.getElementById('push-status-txt')
      const btnEl    = document.getElementById('btn-push-ativar')
      if (!statusEl) return
      if (!('Notification' in window)) {
        statusEl.textContent = '⚠️ Não suportado neste navegador'
      } else if (Notification.permission === 'granted') {
        statusEl.textContent = '✅ Ativadas'
        if (btnEl) btnEl.style.display = 'none'
      } else if (Notification.permission === 'denied') {
        statusEl.textContent = '🚫 Bloqueadas — libere nas configurações do navegador'
        if (btnEl) btnEl.style.display = 'none'
      } else {
        statusEl.textContent = '⚪ Não configuradas'
        if (btnEl) btnEl.style.display = 'inline-block'
      }
    }, 100)
  },

  async ativarNotificacoesPush() {
    if (!('Notification' in window)) {
      this.toast('Notificações não suportadas neste navegador', 'warning')
      return
    }
    try {
      const permission = await Notification.requestPermission()
      const statusEl = document.getElementById('push-status-txt')
      const btnEl    = document.getElementById('btn-push-ativar')
      if (permission === 'granted') {
        if (statusEl) statusEl.textContent = '✅ Ativadas'
        if (btnEl) btnEl.style.display = 'none'
        this.toast('✅ Notificações push ativadas!', 'success')
        // Testar notificação
        setTimeout(() => {
          new Notification('VerdeMais 🌱', {
            body: 'Notificações ativas! Você receberá alertas de vencimentos e conquistas.',
            icon: '/favicon.svg'
          })
        }, 500)
      } else {
        if (statusEl) statusEl.textContent = '🚫 Permissão negada'
        this.toast('Permissão de notificação negada', 'warning')
      }
    } catch(e) {
      this.toast('Erro ao solicitar permissão', 'error')
    }
  },

  // Agenda notificações locais para lembretes via Service Worker
  async agendarNotificacoesLembretes() {
    if (Notification.permission !== 'granted') return
    if (!navigator.serviceWorker?.controller) return
    try {
      const data = await this.api('GET', 'lembretes')
      const lembretes = (data.lembretes || data || []).filter(l => l.status !== 'pago' && l.data_vencimento)
      if (lembretes.length > 0) {
        navigator.serviceWorker.controller.postMessage({
          type: 'SCHEDULE_NOTIFICATIONS',
          lembretes: lembretes.map(l => ({
            id: l.id,
            titulo: l.titulo,
            valor: l.valor,
            data_vencimento: l.data_vencimento
          }))
        })
      }
    } catch(_) {}
  },

  modalAlterarSenha() {
    document.getElementById('modal-container').innerHTML = `
      <div class="modal-overlay" onclick="VM.closeModal(event)">
        <div class="modal" style="max-width:400px;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:24px;">
            <h3 style="font-size:1.1rem;font-weight:700;">🔑 Alterar Senha</h3>
            <button onclick="VM.closeModal()" style="background:none;border:none;color:#666;font-size:1.2rem;cursor:pointer;">✕</button>
          </div>
          <form id="senha-form">
            <div class="form-group">
              <label class="form-label">Senha Atual *</label>
              <input type="password" id="s-atual" class="form-input" placeholder="Digite a senha atual" required>
            </div>
            <div class="form-group">
              <label class="form-label">Nova Senha *</label>
              <input type="password" id="s-nova" class="form-input" placeholder="Mínimo 6 caracteres" minlength="6" required>
            </div>
            <div class="form-group">
              <label class="form-label">Confirmar Nova Senha *</label>
              <input type="password" id="s-conf" class="form-input" placeholder="Repita a nova senha" required>
            </div>
            <div style="display:flex;gap:12px;margin-top:8px;">
              <button type="button" onclick="VM.closeModal()" class="btn-secondary" style="flex:1;justify-content:center;">Cancelar</button>
              <button type="submit" class="btn-primary" style="flex:1;" id="s-submit"><i class="fas fa-lock"></i> Alterar</button>
            </div>
          </form>
        </div>
      </div>
    `
    document.getElementById('senha-form').addEventListener('submit', async (e) => {
      e.preventDefault()
      const nova = document.getElementById('s-nova').value
      const conf = document.getElementById('s-conf').value
      if (nova !== conf) { this.toast('As senhas não coincidem', 'error'); return }
      const btn = document.getElementById('s-submit')
      btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>'
      try {
        await this.api('PATCH', 'perfil/senha', { senha_atual: document.getElementById('s-atual').value, nova_senha: nova })
        this.toast('Senha alterada com sucesso! 🔐')
        this.closeModal()
      } catch(err) {
        this.toast(err.response?.data?.error || 'Erro ao alterar senha', 'error')
        btn.disabled = false; btn.innerHTML = '<i class="fas fa-lock"></i> Alterar'
      }
    })
  },

  modalAlterarEmail() {
    document.getElementById('modal-container').innerHTML = `
      <div class="modal-overlay" onclick="VM.closeModal(event)">
        <div class="modal" style="max-width:400px;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:24px;">
            <h3 style="font-size:1.1rem;font-weight:700;">✉️ Alterar E-mail</h3>
            <button onclick="VM.closeModal()" style="background:none;border:none;color:#666;font-size:1.2rem;cursor:pointer;">✕</button>
          </div>
          <form id="email-form">
            <div class="form-group">
              <label class="form-label">Novo E-mail *</label>
              <input type="email" id="e-novo" class="form-input" placeholder="novo@email.com" required>
            </div>
            <div class="form-group">
              <label class="form-label">Confirme sua Senha *</label>
              <input type="password" id="e-senha" class="form-input" placeholder="Sua senha atual" required>
            </div>
            <div style="display:flex;gap:12px;margin-top:8px;">
              <button type="button" onclick="VM.closeModal()" class="btn-secondary" style="flex:1;justify-content:center;">Cancelar</button>
              <button type="submit" class="btn-primary" style="flex:1;" id="e-submit"><i class="fas fa-envelope"></i> Alterar</button>
            </div>
          </form>
        </div>
      </div>
    `
    document.getElementById('email-form').addEventListener('submit', async (e) => {
      e.preventDefault()
      const btn = document.getElementById('e-submit')
      btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>'
      try {
        await this.api('PATCH', 'perfil/email', { email: document.getElementById('e-novo').value, senha: document.getElementById('e-senha').value })
        this.user.email = document.getElementById('e-novo').value
        localStorage.setItem('vm_user', JSON.stringify(this.user))
        this.toast('E-mail atualizado! ✉️')
        this.closeModal()
        this.pagePerfil()
      } catch(err) {
        this.toast(err.response?.data?.error || 'Erro ao alterar e-mail', 'error')
        btn.disabled = false; btn.innerHTML = '<i class="fas fa-envelope"></i> Alterar'
      }
    })
  },

  // ======= ONBOARDING WIZARD =======
  renderOnboarding() {
    this.onboardingStep = 1
    this.onboardingData = {}

    const steps = [
      { icon:'💼', label:'Situação' },
      { icon:'💰', label:'Renda' },
      { icon:'📊', label:'Hábitos' },
      { icon:'🎯', label:'Objetivos' },
      { icon:'👤', label:'Perfil' }
    ]

    document.getElementById('app').innerHTML = `
      <div style="min-height:100vh;background:#0F172A;display:flex;align-items:center;justify-content:center;padding:20px;font-family:'Inter',sans-serif;">
        <div style="width:100%;max-width:620px;">

          <!-- Header -->
          <div style="text-align:center;margin-bottom:32px;">
            <div style="display:inline-flex;align-items:center;gap:10px;background:rgba(16,185,129,0.08);border:1px solid rgba(16,185,129,0.2);border-radius:50px;padding:8px 20px;margin-bottom:20px;">
              <span style="font-size:1.1rem;">🌱</span>
              <span style="font-size:0.85rem;font-weight:700;color:#10B981;letter-spacing:0.5px;">VerdeMais</span>
            </div>
            <h1 style="font-size:1.6rem;font-weight:800;color:#F8FAFC;margin-bottom:8px;letter-spacing:-0.5px;">Personalize sua experiência</h1>
            <p style="color:#64748B;font-size:0.87rem;">Leva menos de 2 minutos. Suas informações ficam seguras.</p>
          </div>

          <!-- Progress steps -->
          <div style="display:flex;align-items:center;margin-bottom:28px;gap:0;" id="ob-steps-bar">
            ${steps.map((s,i) => `
              <div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:6px;position:relative;">
                ${i > 0 ? `<div style="position:absolute;left:-50%;top:16px;width:100%;height:2px;background:${i < 1 ? 'rgba(16,185,129,0.8)' : 'rgba(255,255,255,0.08)'};z-index:0;transition:all 0.4s;" id="ob-line-${i}"></div>` : ''}
                <div id="ob-step-dot-${i+1}" style="width:32px;height:32px;border-radius:50%;background:${i===0 ? 'linear-gradient(135deg,#10B981,#059669)' : 'rgba(255,255,255,0.06)'};border:2px solid ${i===0 ? '#10B981' : 'rgba(255,255,255,0.1)'};display:flex;align-items:center;justify-content:center;font-size:0.9rem;z-index:1;position:relative;transition:all 0.4s;">${s.icon}</div>
                <span id="ob-step-label-${i+1}" style="font-size:0.65rem;color:${i===0 ? '#10B981' : '#334155'};font-weight:${i===0 ? '700' : '400'};transition:all 0.4s;">${s.label}</span>
              </div>
            `).join('')}
          </div>

          <!-- Card principal -->
          <div id="ob-card" style="background:rgba(30,41,59,0.7);border:1px solid rgba(16,185,129,0.12);border-radius:24px;padding:36px 40px;backdrop-filter:blur(12px);box-shadow:0 20px 50px rgba(0,0,0,0.4);transition:all 0.3s;">
            <!-- Conteúdo será injetado por JS -->
          </div>

          <!-- Indicador -->
          <div style="text-align:center;margin-top:16px;">
            <span id="ob-step-indicator" style="font-size:0.75rem;color:#334155;">Passo 1 de 5</span>
          </div>
        </div>
      </div>
    `
    this.renderOnboardingStep(1)
  },

  renderOnboardingStep(step) {
    this.onboardingStep = step
    const card = document.getElementById('ob-card')
    const indicator = document.getElementById('ob-step-indicator')
    if (indicator) indicator.textContent = `Passo ${step} de 5`

    // Atualizar dots e linhas da barra de progresso
    for (let i = 1; i <= 5; i++) {
      const dot   = document.getElementById(`ob-step-dot-${i}`)
      const label = document.getElementById(`ob-step-label-${i}`)
      const line  = document.getElementById(`ob-line-${i}`)
      if (dot) {
        if (i < step) {
          dot.style.background = 'linear-gradient(135deg,#10B981,#059669)'
          dot.style.borderColor = '#10B981'
          dot.innerHTML = '✓'
          dot.style.fontSize = '0.75rem'
        } else if (i === step) {
          dot.style.background = 'linear-gradient(135deg,#10B981,#059669)'
          dot.style.borderColor = '#10B981'
          dot.style.boxShadow = '0 0 0 4px rgba(16,185,129,0.2)'
        } else {
          dot.style.background = 'rgba(255,255,255,0.06)'
          dot.style.borderColor = 'rgba(255,255,255,0.1)'
          dot.style.boxShadow = 'none'
        }
      }
      if (label) {
        label.style.color = i <= step ? '#10B981' : '#334155'
        label.style.fontWeight = i === step ? '700' : '400'
      }
      if (line) {
        line.style.background = i <= step ? 'rgba(16,185,129,0.6)' : 'rgba(255,255,255,0.08)'
      }
    }

    const steps = {
      1: {
        icon: '👋',
        titulo: `Olá, ${this.user?.nome?.split(' ')[0] || 'seja bem-vindo'}!`,
        subtitulo: 'Antes de começar, queremos entender melhor sua situação financeira para oferecer insights personalizados.',
        html: `
          <div class="form-group">
            <label class="form-label">Qual é sua situação de emprego atual?</label>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:8px;" id="emprego-options">
              ${[
                {v:'empregado_clt', l:'👔 CLT / Empregado'},
                {v:'autonomo', l:'💼 Autônomo'},
                {v:'empresario', l:'🏢 Empresário'},
                {v:'freelancer', l:'💻 Freelancer'},
                {v:'servidor_publico', l:'🏛️ Servidor Público'},
                {v:'aposentado', l:'🌅 Aposentado'},
                {v:'estudante', l:'🎓 Estudante'},
                {v:'desempregado', l:'🔍 Buscando emprego'}
              ].map(o => `
                <div onclick="VM.selectOB('emprego-options','${o.v}',this)" 
                  data-val="${o.v}"
                  style="padding:14px;border:1px solid rgba(255,255,255,0.1);border-radius:12px;cursor:pointer;transition:all 0.2s;font-size:0.88rem;text-align:center;">
                  ${o.l}
                </div>
              `).join('')}
            </div>
            <input type="hidden" id="ob-emprego" value="">
          </div>
        `
      },
      2: {
        icon: '💰',
        titulo: 'Qual é a sua renda mensal?',
        subtitulo: 'Estas informações são sigilosas e usadas apenas para calcular seu score e sugestões.',
        html: `
          <div class="form-group">
            <label class="form-label">Renda mensal aproximada (R$)</label>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:8px;" id="renda-options">
              ${[
                {v:'1000', l:'Até R$ 1.000'},
                {v:'2000', l:'R$ 1.001 – R$ 2.000'},
                {v:'3500', l:'R$ 2.001 – R$ 5.000'},
                {v:'7500', l:'R$ 5.001 – R$ 10.000'},
                {v:'15000', l:'R$ 10.001 – R$ 20.000'},
                {v:'30000', l:'Acima de R$ 20.000'}
              ].map(o => `
                <div onclick="VM.selectOB('renda-options','${o.v}',this)"
                  data-val="${o.v}"
                  style="padding:14px;border:1px solid rgba(255,255,255,0.1);border-radius:12px;cursor:pointer;transition:all 0.2s;font-size:0.88rem;text-align:center;">
                  ${o.l}
                </div>
              `).join('')}
            </div>
            <input type="hidden" id="ob-renda" value="">
          </div>
          
          <div class="form-group" style="margin-top:20px;">
            <label class="form-label">Quantas pessoas dependem financeiramente de você?</label>
            <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:8px;" id="dep-options">
              ${['0','1','2','3','4','5+'].map(d => `
                <div onclick="VM.selectOB('dep-options','${d}',this)"
                  data-val="${d}"
                  style="padding:10px 20px;border:1px solid rgba(255,255,255,0.1);border-radius:10px;cursor:pointer;transition:all 0.2s;font-size:0.9rem;font-weight:600;min-width:52px;text-align:center;">
                  ${d}
                </div>
              `).join('')}
            </div>
            <input type="hidden" id="ob-dependentes" value="">
          </div>
        `
      },
      3: {
        icon: '💳',
        titulo: 'Como são seus hábitos financeiros?',
        subtitulo: 'Seja honesto! Vamos traçar um plano real para você.',
        html: `
          <div class="form-group">
            <label class="form-label">Atualmente, você consegue poupar?</label>
            <div style="display:flex;flex-direction:column;gap:10px;margin-top:8px;" id="poupar-options">
              ${[
                {v:'nao', l:'❌ Não, gasto mais do que ganho'},
                {v:'pouco', l:'⚠️ Às vezes, mas é difícil'},
                {v:'sim', l:'✅ Sim, consigo poupar todo mês'},
                {v:'investindo', l:'📈 Sim, e ainda invisto regularmente'}
              ].map(o => `
                <div onclick="VM.selectOB('poupar-options','${o.v}',this)"
                  data-val="${o.v}"
                  style="padding:14px 18px;border:1px solid rgba(255,255,255,0.1);border-radius:12px;cursor:pointer;transition:all 0.2s;font-size:0.9rem;">
                  ${o.l}
                </div>
              `).join('')}
            </div>
            <input type="hidden" id="ob-poupar" value="">
          </div>
          
          <div class="form-group" style="margin-top:20px;">
            <label class="form-label">Qual é sua maior dificuldade financeira hoje?</label>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:8px;" id="dific-options">
              ${[
                {v:'gastos_excessivos', l:'💸 Gastos excessivos'},
                {v:'dividas', l:'💳 Dívidas e cartão'},
                {v:'falta_planejamento', l:'📋 Falta de planejamento'},
                {v:'renda_baixa', l:'💰 Renda insuficiente'},
                {v:'investir', l:'📈 Não sei como investir'},
                {v:'emergencias', l:'🚨 Imprevistos financeiros'}
              ].map(o => `
                <div onclick="VM.selectOB('dific-options','${o.v}',this)"
                  data-val="${o.v}"
                  style="padding:12px;border:1px solid rgba(255,255,255,0.1);border-radius:10px;cursor:pointer;transition:all 0.2s;font-size:0.82rem;text-align:center;">
                  ${o.l}
                </div>
              `).join('')}
            </div>
            <input type="hidden" id="ob-dificuldade" value="">
          </div>
        `
      },
      4: {
        icon: '🎯',
        titulo: 'Quais são seus objetivos?',
        subtitulo: 'Selecione tudo que deseja conquistar. Priorizaremos juntos.',
        html: `
          <div class="form-group">
            <label class="form-label">Seus principais objetivos financeiros <span style="color:#555;">(selecione quantos quiser)</span></label>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:12px;" id="obj-options">
              ${[
                {v:'reserva_emergencia', l:'🛡️ Reserva de emergência'},
                {v:'quitar_dividas', l:'💳 Quitar dívidas'},
                {v:'comprar_casa', l:'🏠 Comprar imóvel'},
                {v:'comprar_carro', l:'🚗 Comprar veículo'},
                {v:'aposentadoria', l:'🌅 Planejar aposentadoria'},
                {v:'viagem', l:'✈️ Viajar / lazer'},
                {v:'investir_mais', l:'📈 Ampliar investimentos'},
                {v:'educacao', l:'🎓 Investir em educação'},
                {v:'negocio', l:'🏢 Abrir negócio'},
                {v:'independencia_financeira', l:'🦅 Independência financeira'}
              ].map(o => `
                <div onclick="VM.toggleOBMulti(this,'${o.v}')"
                  data-val="${o.v}"
                  class="ob-multi"
                  style="padding:12px;border:1px solid rgba(255,255,255,0.1);border-radius:10px;cursor:pointer;transition:all 0.2s;font-size:0.82rem;text-align:center;">
                  ${o.l}
                </div>
              `).join('')}
            </div>
          </div>
          
          <div class="form-group" style="margin-top:20px;">
            <label class="form-label">Qual o seu perfil de investidor?</label>
            <div style="display:flex;flex-direction:column;gap:10px;margin-top:8px;" id="perfil-options">
              ${[
                {v:'conservador', l:'🛡️ Conservador – Prefiro segurança, aceito rentabilidade menor'},
                {v:'moderado', l:'⚖️ Moderado – Equilíbrio entre segurança e crescimento'},
                {v:'arrojado', l:'🚀 Arrojado – Aceito riscos em busca de maior retorno'}
              ].map(o => `
                <div onclick="VM.selectOB('perfil-options','${o.v}',this)"
                  data-val="${o.v}"
                  style="padding:14px 18px;border:1px solid rgba(255,255,255,0.1);border-radius:12px;cursor:pointer;transition:all 0.2s;font-size:0.88rem;">
                  ${o.l}
                </div>
              `).join('')}
            </div>
            <input type="hidden" id="ob-perfil-inv" value="">
          </div>
        `
      },
      5: {
        icon: '🏁',
        titulo: 'Quase lá! Só mais alguns detalhes.',
        subtitulo: 'Essas informações nos ajudam a personalizar ainda mais o VerdeMais para você.',
        html: `
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">
            <div class="form-group">
              <label class="form-label">Estado civil</label>
              <select id="ob-estado-civil" class="form-select">
                <option value="solteiro">Solteiro(a)</option>
                <option value="casado">Casado(a)</option>
                <option value="divorciado">Divorciado(a)</option>
                <option value="viuvo">Viúvo(a)</option>
                <option value="uniao_estavel">União estável</option>
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">Profissão</label>
              <input type="text" id="ob-profissao" class="form-input" placeholder="Ex: Analista de Dados">
            </div>
          </div>
          
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">
            <div class="form-group">
              <label class="form-label">Cidade</label>
              <input type="text" id="ob-cidade" class="form-input" placeholder="Sua cidade">
            </div>
            <div class="form-group">
              <label class="form-label">Estado (UF)</label>
              <select id="ob-estado" class="form-select">
                ${['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'].map(uf => `<option>${uf}</option>`).join('')}
              </select>
            </div>
          </div>
          
          <div class="form-group">
            <label class="form-label">Com que frequência você quer revisar suas finanças?</label>
            <div style="display:flex;flex-direction:column;gap:10px;margin-top:8px;" id="freq-options">
              ${[
                {v:'diario', l:'📆 Diariamente – Sou muito disciplinado'},
                {v:'semanal', l:'📅 Semanalmente – Prefiro revisões rápidas'},
                {v:'mensal', l:'📋 Mensalmente – Faço uma revisão mensal completa'}
              ].map(o => `
                <div onclick="VM.selectOB('freq-options','${o.v}',this)"
                  data-val="${o.v}"
                  style="padding:12px 16px;border:1px solid rgba(255,255,255,0.1);border-radius:12px;cursor:pointer;transition:all 0.2s;font-size:0.88rem;">
                  ${o.l}
                </div>
              `).join('')}
            </div>
            <input type="hidden" id="ob-frequencia" value="">
          </div>
        `
      }
    }

    const s = steps[step]
    // Slide-in animation
    card.style.opacity = '0'
    card.style.transform = 'translateX(20px)'
    card.innerHTML = `
      <!-- Step header -->
      <div style="display:flex;align-items:flex-start;gap:16px;margin-bottom:28px;">
        <div style="width:52px;height:52px;background:linear-gradient(135deg,rgba(16,185,129,0.2),rgba(16,185,129,0.05));border:1.5px solid rgba(16,185,129,0.3);border-radius:16px;display:flex;align-items:center;justify-content:center;font-size:1.6rem;flex-shrink:0;">${s.icon}</div>
        <div>
          <h2 style="font-size:1.2rem;font-weight:800;color:#F8FAFC;margin-bottom:5px;letter-spacing:-0.3px;">${s.titulo}</h2>
          <p style="color:#64748B;font-size:0.84rem;line-height:1.5;margin:0;">${s.subtitulo}</p>
        </div>
      </div>

      ${s.html}

      <!-- Navegação -->
      <div style="display:flex;gap:10px;margin-top:28px;">
        ${step > 1 ? `
          <button onclick="VM.renderOnboardingStep(${step-1})"
            style="flex:0 0 auto;padding:12px 20px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.1);border-radius:12px;color:#94A3B8;font-size:0.88rem;font-weight:600;cursor:pointer;transition:all 0.2s;display:flex;align-items:center;gap:6px;"
            onmouseover="this.style.borderColor='rgba(255,255,255,0.2)';this.style.color='#F8FAFC'"
            onmouseout="this.style.borderColor='rgba(255,255,255,0.1)';this.style.color='#94A3B8'">
            <i class="fas fa-arrow-left"></i> Voltar
          </button>
        ` : `
          <button onclick="window.location.href='/app'"
            style="flex:0 0 auto;padding:12px 20px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.1);border-radius:12px;color:#64748B;font-size:0.88rem;cursor:pointer;transition:all 0.2s;"
            onmouseover="this.style.color='#94A3B8'" onmouseout="this.style.color='#64748B'">
            Pular
          </button>
        `}
        <button onclick="VM.nextOnboardingStep(${step})" id="ob-next"
          style="flex:1;padding:13px;background:linear-gradient(135deg,#10B981,#059669);border:none;border-radius:12px;color:#fff;font-size:0.92rem;font-weight:700;cursor:pointer;transition:all 0.2s;display:flex;align-items:center;justify-content:center;gap:8px;"
          onmouseover="this.style.transform='translateY(-1px)';this.style.boxShadow='0 6px 18px rgba(16,185,129,0.35)'"
          onmouseout="this.style.transform='none';this.style.boxShadow='none'">
          ${step === 5 ? '<i class="fas fa-rocket"></i> Começar VerdeMais 🚀' : 'Continuar <i class="fas fa-arrow-right"></i>'}
        </button>
      </div>

      ${step < 5 ? `<div style="text-align:center;margin-top:14px;"><button onclick="window.location.href='/app'" style="background:none;border:none;color:#334155;cursor:pointer;font-size:0.77rem;transition:color 0.2s;" onmouseover="this.style.color='#64748B'" onmouseout="this.style.color='#334155'">Configurar depois →</button></div>` : ''}
    `

    // Animate in
    requestAnimationFrame(() => {
      card.style.transition = 'opacity 0.3s ease, transform 0.3s ease'
      card.style.opacity = '1'
      card.style.transform = 'translateX(0)'
    })

    // Restaurar valores já preenchidos
    if (this.onboardingData) {
      const restore = {
        1: () => {
          if (this.onboardingData.emprego) this.preSelectOB('emprego-options', this.onboardingData.emprego)
        },
        2: () => {
          if (this.onboardingData.renda) this.preSelectOB('renda-options', this.onboardingData.renda)
          if (this.onboardingData.dependentes) this.preSelectOB('dep-options', this.onboardingData.dependentes)
        },
        3: () => {
          if (this.onboardingData.poupar) this.preSelectOB('poupar-options', this.onboardingData.poupar)
          if (this.onboardingData.dificuldade) this.preSelectOB('dific-options', this.onboardingData.dificuldade)
        },
        4: () => {
          if (this.onboardingData.perfil_inv) this.preSelectOB('perfil-options', this.onboardingData.perfil_inv)
          if (this.onboardingData.objetivos) {
            this.onboardingData.objetivos.forEach(v => {
              const el = document.querySelector(`[data-val="${v}"].ob-multi`)
              if (el) { el.style.borderColor = '#2FBF71'; el.style.background = 'rgba(47,191,113,0.12)'; el.style.color = '#2FBF71' }
            })
          }
        }
      }
      if (restore[step]) restore[step]()
    }
  },

  selectOB(groupId, val, el) {
    document.querySelectorAll(`#${groupId} [data-val]`).forEach(e => {
      e.style.borderColor = 'rgba(255,255,255,0.1)'
      e.style.background = 'transparent'
      e.style.color = ''
    })
    el.style.borderColor = '#2FBF71'
    el.style.background = 'rgba(47,191,113,0.12)'
    el.style.color = '#2FBF71'
    
    // Encontrar input hidden associado
    const group = document.getElementById(groupId)
    if (group) {
      const hidden = group.nextElementSibling
      if (hidden && hidden.tagName === 'INPUT') hidden.value = val
    }
  },

  preSelectOB(groupId, val) {
    const el = document.querySelector(`#${groupId} [data-val="${val}"]`)
    if (el) {
      el.style.borderColor = '#2FBF71'
      el.style.background = 'rgba(47,191,113,0.12)'
      el.style.color = '#2FBF71'
      const group = document.getElementById(groupId)
      if (group) {
        const hidden = group.nextElementSibling
        if (hidden && hidden.tagName === 'INPUT') hidden.value = val
      }
    }
  },

  toggleOBMulti(el, val) {
    const isSelected = el.style.borderColor === 'rgb(47, 191, 113)'
    if (isSelected) {
      el.style.borderColor = 'rgba(255,255,255,0.1)'
      el.style.background = 'transparent'
      el.style.color = ''
    } else {
      el.style.borderColor = '#2FBF71'
      el.style.background = 'rgba(47,191,113,0.12)'
      el.style.color = '#2FBF71'
    }
  },

  async nextOnboardingStep(step) {
    const btn = document.getElementById('ob-next')
    
    // Coletar dados do step atual
    if (step === 1) {
      const emprego = document.getElementById('ob-emprego')?.value
      if (!emprego) { this.toast('Selecione sua situação de emprego', 'warning'); return }
      this.onboardingData.emprego = emprego
    } else if (step === 2) {
      const renda = document.getElementById('ob-renda')?.value
      const dep = document.getElementById('ob-dependentes')?.value
      if (!renda) { this.toast('Selecione sua faixa de renda', 'warning'); return }
      if (dep === '') { this.toast('Informe o número de dependentes', 'warning'); return }
      this.onboardingData.renda = renda
      this.onboardingData.dependentes = dep
    } else if (step === 3) {
      const poupar = document.getElementById('ob-poupar')?.value
      const dific = document.getElementById('ob-dificuldade')?.value
      if (!poupar) { this.toast('Responda sobre sua capacidade de poupar', 'warning'); return }
      this.onboardingData.poupar = poupar
      this.onboardingData.dificuldade = dific || 'falta_planejamento'
    } else if (step === 4) {
      const perfil = document.getElementById('ob-perfil-inv')?.value
      const objetivos = [...document.querySelectorAll('.ob-multi')].filter(e => e.style.borderColor === 'rgb(47, 191, 113)').map(e => e.dataset.val)
      if (!perfil) { this.toast('Selecione seu perfil de investidor', 'warning'); return }
      this.onboardingData.perfil_inv = perfil
      this.onboardingData.objetivos = objetivos
    } else if (step === 5) {
      // Salvar tudo
      const freq = document.getElementById('ob-frequencia')?.value
      this.onboardingData.estado_civil = document.getElementById('ob-estado-civil')?.value
      this.onboardingData.profissao = document.getElementById('ob-profissao')?.value
      this.onboardingData.cidade = document.getElementById('ob-cidade')?.value
      this.onboardingData.estado = document.getElementById('ob-estado')?.value
      this.onboardingData.frequencia = freq || 'mensal'
      
      btn.disabled = true
      btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Salvando...'
      
      try {
        await this.api('POST', 'perfil/onboarding', {
          situacao_emprego: this.onboardingData.emprego,
          salario_mensal: parseFloat(this.onboardingData.renda) || 0,
          dependentes: parseInt(this.onboardingData.dependentes) || 0,
          perfil_investidor: this.onboardingData.perfil_inv,
          estado_civil: this.onboardingData.estado_civil,
          profissao: this.onboardingData.profissao,
          cidade: this.onboardingData.cidade,
          estado: this.onboardingData.estado,
          perfil_completo: 1,
          onboarding_step: 5,
          meta_poupanca: this.onboardingData.poupar,
          dificuldade_principal: this.onboardingData.dificuldade,
          objetivos: this.onboardingData.objetivos || [],
          frequencia_revisao: this.onboardingData.frequencia
        })
        
        // Atualizar user local
        this.user = { ...this.user, perfil_investidor: this.onboardingData.perfil_inv }
        localStorage.setItem('vm_user', JSON.stringify(this.user))
        
        // Mostrar tela de conclusão
        this.renderOnboardingFinal()
      } catch (e) {
        this.toast('Erro ao salvar perfil', 'error')
        btn.disabled = false
        btn.innerHTML = '<i class="fas fa-rocket"></i> Começar VerdeMais'
      }
      return
    }
    
    if (step < 5) this.renderOnboardingStep(step + 1)
  },

  renderOnboardingFinal() {
    const nome = this.user?.nome?.split(' ')[0] || 'você'
    const proximo = this.onboardingData?.emprego === 'desempregado'
      ? 'Registre suas despesas mensais para entender para onde vai seu dinheiro'
      : 'Adicione sua renda mensal no módulo Receitas'

    document.getElementById('app').innerHTML = `
      <div style="min-height:100vh;background:#0F172A;display:flex;align-items:center;justify-content:center;padding:20px;font-family:'Inter',sans-serif;">
        <div style="width:100%;max-width:520px;text-align:center;">

          <!-- Trofeu animado -->
          <div style="position:relative;display:inline-block;margin-bottom:24px;">
            <div style="width:90px;height:90px;background:linear-gradient(135deg,rgba(16,185,129,0.2),rgba(16,185,129,0.05));border:2px solid rgba(16,185,129,0.4);border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:2.8rem;margin:0 auto;animation:popIn 0.6s cubic-bezier(0.175,0.885,0.32,1.275) both;">
              🏆
            </div>
            <div style="position:absolute;top:-5px;right:-5px;width:24px;height:24px;background:#10B981;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:0.75rem;animation:pulse 2s infinite;">✓</div>
          </div>

          <h1 style="font-size:1.8rem;font-weight:800;color:#F8FAFC;margin-bottom:12px;letter-spacing:-0.5px;">
            Tudo pronto, <span style="background:linear-gradient(135deg,#10B981,#34D399);-webkit-background-clip:text;-webkit-text-fill-color:transparent;">${nome}!</span>
          </h1>
          <p style="color:#64748B;font-size:0.92rem;line-height:1.7;margin-bottom:32px;max-width:380px;margin-left:auto;margin-right:auto;">
            Seu perfil foi configurado. O VerdeMais agora pode te dar insights personalizados e um plano financeiro real.
          </p>

          <!-- Próximos passos -->
          <div style="background:rgba(16,185,129,0.05);border:1px solid rgba(16,185,129,0.15);border-radius:20px;padding:24px;margin-bottom:28px;text-align:left;">
            <div style="font-weight:700;margin-bottom:16px;color:#10B981;font-size:0.88rem;letter-spacing:0.5px;">🚀 PRÓXIMOS PASSOS</div>
            <div style="display:flex;flex-direction:column;gap:14px;">
              ${[
                { n:'1', icon:'💰', t:'Adicionar renda', d: proximo, c:'#10B981' },
                { n:'2', icon:'💸', t:'Registrar despesas', d:'Cadastre suas contas fixas e variáveis para análise precisa', c:'#059669' },
                { n:'3', icon:'🎯', t:'Criar uma meta', d:'Defina seu primeiro objetivo financeiro com prazo', c:'#34D399' }
              ].map(p => `
                <div style="display:flex;align-items:flex-start;gap:12px;">
                  <div style="width:32px;height:32px;background:linear-gradient(135deg,${p.c},${p.c}88);border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:0.85rem;flex-shrink:0;font-weight:700;color:#fff;">${p.n}</div>
                  <div>
                    <div style="font-size:0.88rem;font-weight:600;color:#F8FAFC;margin-bottom:2px;">${p.icon} ${p.t}</div>
                    <div style="font-size:0.77rem;color:#64748B;line-height:1.5;">${p.d}</div>
                  </div>
                </div>
              `).join('')}
            </div>
          </div>

          <!-- CTA -->
          <button onclick="window.location.href='/app/dashboard'"
            style="width:100%;padding:15px;background:linear-gradient(135deg,#10B981,#059669);border:none;border-radius:14px;color:#fff;font-size:1rem;font-weight:700;cursor:pointer;transition:all 0.2s;display:flex;align-items:center;justify-content:center;gap:10px;margin-bottom:14px;"
            onmouseover="this.style.transform='translateY(-2px)';this.style.boxShadow='0 10px 30px rgba(16,185,129,0.4)'"
            onmouseout="this.style.transform='none';this.style.boxShadow='none'">
            <i class="fas fa-rocket"></i> Abrir meu Dashboard
          </button>
          <div style="color:#334155;font-size:0.75rem;">Você pode completar seu perfil depois nas configurações</div>
        </div>
      </div>
      <style>
        @keyframes popIn { 0%{transform:scale(0.3);opacity:0} 70%{transform:scale(1.1)} 100%{transform:scale(1);opacity:1} }
        @keyframes pulse { 0%,100%{transform:scale(1)} 50%{transform:scale(1.15)} }
      </style>
    `
  },

  // ============== CARTÕES ==============
  async pageCartoes() {
    this._faturaAutoAberta = false  // reset para auto-abrir fatura ao entrar na página
    document.getElementById('page-content').innerHTML = `
      <div class="section-header">
        <div>
          <div class="section-title">💳 Cartões de Crédito</div>
          <div style="color:#666;font-size:0.85rem;margin-top:2px;">Faturas, compras e controle de limite</div>
        </div>
        <div style="display:flex;gap:10px;flex-wrap:wrap;">
          <button onclick="VM.modalGerenciarCompras()" title="Excluir compras parceladas e todas as suas parcelas" style="background:rgba(255,80,80,0.1);border:1px solid rgba(255,80,80,0.3);color:#ff6b6b;border-radius:8px;padding:8px 14px;cursor:pointer;font-size:0.78rem;">
            <i class="fas fa-trash-alt"></i> Gerenciar Compras
          </button>
          <button onclick="VM.modalLancarCompraAnterior()" class="btn-secondary" style="width:auto;padding:10px 16px;font-size:0.85rem;">
            <i class="fas fa-history"></i> Compra Anterior
          </button>
          <button onclick="VM.modalCartao()" class="btn-primary" style="width:auto;padding:10px 20px;">
            <i class="fas fa-plus"></i> Novo Cartão
          </button>
        </div>
      </div>
      <div id="cartoes-container">
        <div class="empty-state"><div class="skeleton" style="height:200px;border-radius:16px;"></div></div>
      </div>
    `
    this.carregarCartoes()
  },

  // ─── GERENCIAR COMPRAS PARCELADAS ────────────────────────────────────────────
  async modalGerenciarCompras() {
    const mc = document.getElementById('modal-container')
    mc.innerHTML = `
      <div class="modal-overlay" onclick="VM.closeModal(event)">
        <div class="modal" style="max-width:560px;max-height:90vh;overflow-y:auto;padding:0;">
          <div style="position:sticky;top:0;background:#1a1a2e;z-index:10;border-bottom:1px solid rgba(255,255,255,0.08);padding:18px 20px 14px;">
            <div style="display:flex;justify-content:space-between;align-items:center;">
              <div>
                <div style="font-size:1.05rem;font-weight:700;">🗑️ Gerenciar Compras Parceladas</div>
                <div style="font-size:0.75rem;color:#888;margin-top:2px;">Selecione o cartão para ver e excluir compras</div>
              </div>
              <button onclick="VM.closeModal()" style="background:none;border:none;color:#666;font-size:1.3rem;cursor:pointer;line-height:1;">✕</button>
            </div>
          </div>
          <div style="padding:20px;">
            <div class="form-group" style="margin-bottom:16px;">
              <label class="form-label">Selecione o Cartão</label>
              <select id="gc-cartao-select" class="form-input" onchange="VM._carregarComprasParaGerenciar(this.value)">
                <option value="">-- Escolha um cartão --</option>
              </select>
            </div>
            <div id="gc-lista-compras">
              <div style="text-align:center;padding:32px;color:#555;font-size:0.85rem;">Selecione um cartão acima</div>
            </div>
          </div>
        </div>
      </div>
    `
    // Carregar cartões no select
    try {
      const data = await this.api('GET', 'cartoes')
      const sel = document.getElementById('gc-cartao-select')
      if (!sel) return
      data.cartoes.forEach(c => {
        const opt = document.createElement('option')
        opt.value = c.id
        opt.textContent = `${c.nome} (${c.banco})`
        sel.appendChild(opt)
      })
    } catch(e) {
      this.toast('Erro ao carregar cartões', 'error')
    }
  },

  async _carregarComprasParaGerenciar(cartaoId) {
    const div = document.getElementById('gc-lista-compras')
    if (!div || !cartaoId) return
    div.innerHTML = `<div style="text-align:center;padding:32px;color:#666;"><i class="fas fa-spinner fa-spin"></i> Carregando compras...</div>`
    try {
      const data = await this.api('GET', `cartoes/${cartaoId}/compras`)
      const { compras } = data
      if (!compras || compras.length === 0) {
        div.innerHTML = `<div style="text-align:center;padding:32px;color:#555;font-size:0.85rem;">Nenhuma compra registrada neste cartão.</div>`
        return
      }
      const meses = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez']
      div.innerHTML = `
        <div style="font-size:0.75rem;color:#888;margin-bottom:12px;padding:0 2px;">
          ${compras.length} compra(s) encontrada(s) — excluir remove <strong>todas</strong> as parcelas e despesas vinculadas
        </div>
        <div style="display:flex;flex-direction:column;gap:8px;">
          ${compras.map(cp => {
            const d = cp.data_compra ? new Date(cp.data_compra + 'T12:00:00') : null
            const dataFmt = d ? `${String(d.getDate()).padStart(2,'0')}/${meses[d.getMonth()]}/${d.getFullYear()}` : '—'
            const isParcelada = cp.total_parcelas > 1
            const parcelaLabel = isParcelada
              ? `<span style="background:rgba(116,185,255,0.12);color:#74b9ff;border-radius:4px;padding:1px 7px;font-size:0.68rem;">${cp.parcelas.length}/${cp.total_parcelas} parcelas</span>`
              : `<span style="background:rgba(255,255,255,0.06);color:#aaa;border-radius:4px;padding:1px 7px;font-size:0.68rem;">À vista</span>`
            const statusLabel = cp.pendentes > 0
              ? `<span style="color:#ffc400;font-size:0.72rem;">⏳ ${cp.pendentes} pendente(s)</span>`
              : `<span style="color:#2FBF71;font-size:0.72rem;">✅ Quitada</span>`
            const groupParam = cp.purchase_group_id ? `'${cp.purchase_group_id}'` : 'null'
            return `
              <div style="display:flex;align-items:center;gap:12px;padding:12px 14px;background:rgba(255,255,255,0.02);border-radius:10px;border:1px solid rgba(255,255,255,0.06);">
                <div style="flex:1;min-width:0;">
                  <div style="font-size:0.88rem;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${cp.descricao}</div>
                  <div style="display:flex;gap:8px;align-items:center;margin-top:4px;flex-wrap:wrap;">
                    ${parcelaLabel} ${statusLabel}
                    <span style="color:#666;font-size:0.72rem;">${dataFmt}</span>
                  </div>
                </div>
                <div style="text-align:right;flex-shrink:0;margin-right:8px;">
                  <div style="font-size:0.9rem;font-weight:700;">${this.formatMoney(cp.valor_parcela)}${isParcelada ? '/parc.' : ''}</div>
                  ${isParcelada ? `<div style="font-size:0.7rem;color:#888;">Total: ${this.formatMoney(cp.valor_total_compra)}</div>` : ''}
                </div>
                <button onclick="VM._confirmarExcluirGrupo(${groupParam}, '${(cp.descricao||'').replace(/'/g,"\\'")}')"
                  style="background:rgba(255,80,80,0.12);color:#ff6b6b;border:1px solid rgba(255,80,80,0.25);border-radius:8px;padding:7px 12px;cursor:pointer;font-size:0.78rem;white-space:nowrap;flex-shrink:0;">
                  <i class="fas fa-trash"></i> Excluir
                </button>
              </div>
            `
          }).join('')}
        </div>
      `
    } catch(e) {
      div.innerHTML = `<div style="text-align:center;padding:32px;color:#ff6b6b;font-size:0.85rem;">Erro ao carregar compras.</div>`
    }
  },

  async _confirmarExcluirGrupo(groupId, descricao) {
    if (!groupId) {
      this.toast('Esta compra não possui grupo — use o botão de excluir na fatura.', 'error')
      return
    }
    const ok = await this.vmConfirm(`Excluir a compra <strong>"${descricao}"</strong> e <strong>TODAS</strong> as suas parcelas (passadas, presentes e futuras)?<br><br>Essa ação não pode ser desfeita.`, { titulo: 'Excluir Compra Parcelada', corBotao: '#ef4444', textoBotao: 'Excluir Tudo', icone: '⛔' })
    if (!ok) return
    try {
      await this.api('DELETE', `cartoes/compras/${groupId}`)
      this.toast(`✅ Compra "${descricao}" e todas as parcelas foram excluídas!`)
      // Recarregar a lista do cartão selecionado
      const sel = document.getElementById('gc-cartao-select')
      if (sel && sel.value) await this._carregarComprasParaGerenciar(sel.value)
      // Atualizar cards de cartões em background
      this.carregarCartoes()
    } catch(e) {
      this.toast(e.response?.data?.error || 'Erro ao excluir compra', 'error')
    }
  },

  async carregarCartoes() {
    try {
      // S-C2: busca lista e resumo enriquecido em paralelo
      const [data, resumoData] = await Promise.all([
        this.api('GET', 'cartoes'),
        this.api('GET', 'cartoes/resumo-faturas').catch(() => ({ resumo: [], totais: {} }))
      ])
      const resumoMap = {}
      ;(resumoData.resumo || []).forEach(r => { resumoMap[r.id] = r })
      const container = document.getElementById('cartoes-container')
      const bandeiras = { visa: '💙 Visa', mastercard: '🔴 Mastercard', elo: '💛 Elo', amex: '🟢 Amex', hipercard: '🔵 Hipercard', outros: '💳 Outros' }

      if (data.cartoes.length === 0) {
        container.innerHTML = `
          <div class="card" style="text-align:center;padding:60px 40px;">
            <div style="font-size:3rem;margin-bottom:16px;">💳</div>
            <h3 style="margin-bottom:8px;">Nenhum cartão cadastrado</h3>
            <p style="color:#666;margin-bottom:24px;">Adicione seus cartões para controlar faturas e gastos</p>
            <button onclick="VM.modalCartao()" class="btn-primary" style="width:auto;padding:10px 24px;">
              <i class="fas fa-plus"></i> Adicionar Cartão
            </button>
          </div>
        `
        return
      }

      // S-C2: banner de totais
      const totais = resumoData.totais || {}
      const bannerFaturas = (totais.qtd_cartoes > 0) ? `
        <div class="card" style="margin-bottom:20px;background:linear-gradient(135deg,rgba(99,102,241,0.1),rgba(139,92,246,0.07));border:1px solid rgba(99,102,241,0.2);">
          <div style="display:flex;gap:24px;align-items:center;flex-wrap:wrap;">
            <div><div style="color:#888;font-size:0.75rem;">Total em Faturas</div><div style="font-size:1.3rem;font-weight:800;color:#6366f1;">${this.formatMoney(totais.total_faturas||0)}</div></div>
            <div><div style="color:#888;font-size:0.75rem;">Pendente</div><div style="font-size:1.3rem;font-weight:800;color:#ff6b6b;">${this.formatMoney(totais.total_pendente||0)}</div></div>
            <div><div style="color:#888;font-size:0.75rem;">Cartões Ativos</div><div style="font-size:1.3rem;font-weight:800;">${totais.qtd_cartoes}</div></div>
          </div>
        </div>` : ''

      const cartoesHtml = data.cartoes.map(c => {
            const r = resumoMap[c.id] || {}
            const usado  = r.limite_utilizado ?? (c.limite_utilizado || 0)
            const pct    = r.percentual_uso   ?? (c.percentual_uso   || 0)
            const alerta = r.alerta_limite || 'ok'
            // S-C3: cor e badge por nível de alerta
            const pctColor = alerta === 'critico' ? '#ff6b6b' : alerta === 'atencao' ? '#ffc400' : '#2FBF71'
            const alertaBadge = alerta === 'critico'
              ? `<span style="background:#ff6b6b22;color:#ff6b6b;border:1px solid #ff6b6b44;border-radius:20px;padding:2px 8px;font-size:0.7rem;font-weight:700;">🚨 Limite crítico</span>`
              : alerta === 'atencao'
              ? `<span style="background:#ffc40022;color:#ffc400;border:1px solid #ffc40044;border-radius:20px;padding:2px 8px;font-size:0.7rem;font-weight:700;">⚠️ Atenção: limite alto</span>`
              : ''
            // S-C1: badge próximo vencimento
            const diasVenc = r.dias_para_vencer
            let vencBadge = ''
            if (diasVenc !== undefined) {
              const vc = diasVenc <= 3 ? '#ff6b6b' : diasVenc <= 7 ? '#ffc400' : '#2FBF71'
              const vl = diasVenc < 0 ? `Vencida há ${Math.abs(diasVenc)}d` : diasVenc === 0 ? 'Vence hoje' : diasVenc === 1 ? 'Vence amanhã' : `Vence em ${diasVenc}d`
              vencBadge = `<span style="background:${vc}22;color:${vc};border:1px solid ${vc}44;border-radius:20px;padding:2px 8px;font-size:0.7rem;font-weight:700;">📅 ${vl}</span>`
            }
            const nomeSeguro = c.nome.replace(/'/g, "\\'")
            const corCartao = c.cor || '#2FBF71'
            return `
              <div class="card" style="border-color:${corCartao}40;position:relative;overflow:hidden;cursor:pointer;"
                   onclick="VM.abrirFaturaCartao(${c.id}, '${nomeSeguro}', '${corCartao}', ${c.dia_fechamento || 0})">
                <div style="position:absolute;top:0;left:0;right:0;height:3px;background:${corCartao};"></div>
                <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px;">
                  <div>
                    <div style="font-size:1rem;font-weight:700;">${c.nome}</div>
                    ${c.apelido ? '<div style="font-size:0.72rem;color:#6366f1;margin-top:1px;">"' + c.apelido + '"</div>' : ''}
                    <div style="font-size:0.78rem;color:#666;margin-top:2px;">${bandeiras[c.bandeira] || c.bandeira} • ${c.banco}</div>
                    ${c.ultimos_digitos ? '<div style="font-size:0.75rem;color:#444;margin-top:2px;">•••• ' + c.ultimos_digitos + '</div>' : ''}
                  </div>
                  <div style="display:flex;gap:4px;flex-direction:column;align-items:flex-end;" onclick="event.stopPropagation()">
                    <div style="display:flex;gap:4px;">
                      <button onclick="VM.modalAjustarLimite(${c.id},'${nomeSeguro}',${c.limite_total},${r.limite_disponivel??c.limite_disponivel??0})" class="btn-secondary" style="padding:5px 8px;font-size:0.75rem;" title="Ajustar limite disponível"><i class="fas fa-sliders-h"></i></button>
                      <button onclick="VM.modalCartao(${JSON.stringify({...c, apelido: c.apelido||''}).replace(/&quot;/g,'"').replace(/"/g,'&quot;')})" class="btn-success"><i class="fas fa-edit"></i></button>
                      <button onclick="VM.deleteCartao(${c.id})" class="btn-danger"><i class="fas fa-trash"></i></button>
                    </div>
                    ${alertaBadge}
                  </div>
                </div>
                ${vencBadge ? '<div style="margin-bottom:10px;">' + vencBadge + '</div>' : ''}
                <div style="margin-bottom:12px;">
                  <div style="display:flex;justify-content:space-between;margin-bottom:6px;">
                    <span style="font-size:0.78rem;color:#888;">Limite usado</span>
                    <span style="font-size:0.78rem;font-weight:700;color:${pctColor};">${pct}%</span>
                  </div>
                  <div style="background:rgba(255,255,255,0.08);border-radius:50px;height:6px;overflow:hidden;">
                    <div style="background:${pctColor};width:${Math.min(pct,100)}%;height:100%;border-radius:50px;transition:width 0.6s ease;"></div>
                  </div>
                </div>
                <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;">
                  <div style="background:rgba(255,255,255,0.03);border-radius:10px;padding:10px;text-align:center;">
                    <div style="font-size:0.68rem;color:#666;">Limite Total</div>
                    <div style="font-size:0.82rem;font-weight:700;">${this.formatMoney(c.limite_total)}</div>
                  </div>
                  <div style="background:rgba(255,80,80,0.07);border-radius:10px;padding:10px;text-align:center;">
                    <div style="font-size:0.68rem;color:#666;">Usado</div>
                    <div style="font-size:0.82rem;font-weight:700;color:#ff6b6b;">${this.formatMoney(usado)}</div>
                  </div>
                  <div style="background:rgba(47,191,113,0.07);border-radius:10px;padding:10px;text-align:center;">
                    <div style="font-size:0.68rem;color:#666;">Disponível</div>
                    <div style="font-size:0.82rem;font-weight:700;color:#2FBF71;">${this.formatMoney(r.limite_disponivel ?? c.limite_disponivel ?? 0)}</div>
                  </div>
                </div>
                <div style="display:flex;justify-content:space-between;align-items:center;margin-top:12px;padding-top:12px;border-top:1px solid rgba(255,255,255,0.05);">
                  <span style="font-size:0.75rem;color:#666;">Fecha: dia ${c.dia_fechamento} &nbsp;•&nbsp; Vence: dia ${c.dia_vencimento}</span>
                  <span style="font-size:0.72rem;color:#2FBF71;"><i class="fas fa-file-invoice"></i> Ver fatura</span>
                </div>
              </div>
            `
          }).join('')

      container.innerHTML = bannerFaturas + `
        <div class="grid-3" style="margin-bottom:24px;">
          ${cartoesHtml}
        </div>
      `

      // Item 5: auto-abrir fatura do mês atual se há apenas 1 cartão
      // e a fatura não está já visível (não é chamada de refresh)
      if (data.cartoes.length === 1 && !this._faturaAutoAberta) {
        this._faturaAutoAberta = true
        const c = data.cartoes[0]
        const nomeSeguro = c.nome.replace(/'/g, "\\'")
        const corCartao = c.cor || '#2FBF71'
        setTimeout(() => this.abrirFaturaCartao(c.id, c.nome, corCartao, c.dia_fechamento || 0), 200)
      }
    } catch (e) {
      this.toast('Erro ao carregar cartões', 'error')
    }
  },


  // ─── FATURA BANCÁRIA REAL ──────────────────────────────────────────────────
  async abrirFaturaCartao(cartaoId, nomeCartao, cor, diaFechamento) {
    const now = new Date()
    // Calcular o mês de fatura correto baseado no dia de fechamento do cartão
    // Regra bancária: compra no fechamento ou APÓS → próxima fatura
    let mesFatura = now.getMonth() + 1
    let anoFatura = now.getFullYear()
    if (diaFechamento && now.getDate() >= diaFechamento) {
      mesFatura++
      if (mesFatura > 12) { mesFatura = 1; anoFatura++ }
    }
    // Se o mês calculado não tiver lançamentos, avança até o primeiro mês com dados (máx 3 meses)
    try {
      for (let tentativa = 0; tentativa < 3; tentativa++) {
        const chk = await this.api('GET', `cartoes/${cartaoId}/fatura?mes=${mesFatura}&ano=${anoFatura}`)
        if (chk && chk.fatura && chk.fatura.qtd_lancamentos > 0) break
        // Mês vazio: avançar para o próximo
        mesFatura++
        if (mesFatura > 12) { mesFatura = 1; anoFatura++ }
      }
    } catch(e) { /* usa o mês calculado mesmo assim */ }
    // Estado global da fatura atual
    this._faturaState = {
      cartaoId,
      nomeCartao,
      cor: cor || '#2FBF71',
      mes: mesFatura,
      ano: anoFatura,
      diaFechamento: diaFechamento || 0
    }
    const mc = document.getElementById('modal-container')
    mc.innerHTML = `
      <div class="modal-overlay" onclick="VM.closeModal(event)">
        <div class="modal" style="max-width:800px;max-height:90vh;overflow-y:auto;padding:0;">
          <!-- Cabeçalho sticky -->
          <div style="position:sticky;top:0;background:#1a1a2e;z-index:10;border-bottom:1px solid rgba(255,255,255,0.08);">
            <div style="display:flex;justify-content:space-between;align-items:center;padding:18px 20px 14px;">
              <div style="display:flex;align-items:center;gap:12px;">
                <div style="width:10px;height:10px;border-radius:50%;background:${cor || '#2FBF71'};"></div>
                <div>
                  <div style="font-size:1.05rem;font-weight:700;">💳 ${nomeCartao}</div>
                  <div style="font-size:0.75rem;color:#888;">Extrato bancário</div>
                </div>
              </div>
              <div style="display:flex;gap:8px;align-items:center;">
                <button onclick="VM.modalNovaCompraCartao(${cartaoId})" style="background:rgba(47,191,113,0.12);color:#2FBF71;border:1px solid rgba(47,191,113,0.25);border-radius:8px;padding:6px 12px;cursor:pointer;font-size:0.8rem;"><i class="fas fa-plus"></i> Nova Compra</button>
                <button onclick="VM.closeModal()" style="background:none;border:none;color:#666;font-size:1.3rem;cursor:pointer;line-height:1;">✕</button>
              </div>
            </div>
            <!-- Navegação de mês -->
            <div style="display:flex;justify-content:center;align-items:center;gap:16px;padding:0 20px 14px;">
              <button onclick="VM._navFatura(-1)" style="background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);color:#ccc;border-radius:8px;width:34px;height:34px;cursor:pointer;font-size:1rem;">‹</button>
              <div id="fatura-mes-label" style="font-size:0.95rem;font-weight:700;min-width:130px;text-align:center;">—</div>
              <button onclick="VM._navFatura(1)" style="background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);color:#ccc;border-radius:8px;width:34px;height:34px;cursor:pointer;font-size:1rem;">›</button>
            </div>
          </div>
          <!-- Corpo da fatura -->
          <div id="fatura-body" style="padding:20px;">
            <div style="text-align:center;padding:60px;color:#666;"><i class="fas fa-spinner fa-spin"></i> Carregando fatura...</div>
          </div>
        </div>
      </div>
    `
    await this._carregarFatura()
  },

  _navFatura(delta) {
    if (!this._faturaState) return
    let { mes, ano } = this._faturaState
    mes += delta
    if (mes < 1)  { mes = 12; ano-- }
    if (mes > 12) { mes = 1;  ano++ }
    this._faturaState.mes = mes
    this._faturaState.ano = ano
    this._carregarFatura()
  },

  async _carregarFatura() {
    const { cartaoId, mes, ano, cor } = this._faturaState
    const meses = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro']
    const lbl = document.getElementById('fatura-mes-label')
    if (lbl) lbl.textContent = `${meses[mes-1]} ${ano}`

    const body = document.getElementById('fatura-body')
    if (!body) return
    body.innerHTML = `<div style="text-align:center;padding:60px;color:#666;"><i class="fas fa-spinner fa-spin"></i></div>`

    try {
      const data = await this.api('GET', `cartoes/${cartaoId}/fatura?mes=${mes}&ano=${ano}`)
      const { cartao, fatura, lancamentos } = data

      const statusConfig = {
        futura:  { label: 'Fatura Futura',  color: '#74b9ff', bg: 'rgba(116,185,255,0.1)' },
        aberta:  { label: 'Fatura Aberta',  color: '#ffc400', bg: 'rgba(255,196,0,0.1)' },
        fechada: { label: 'Fatura Fechada', color: '#fd79a8', bg: 'rgba(253,121,168,0.1)' },
        paga:    { label: 'Fatura Paga',    color: '#2FBF71', bg: 'rgba(47,191,113,0.1)' }
      }
      const sc = statusConfig[fatura.status] || statusConfig.aberta

      // Cards de resumo
      const resumoHtml = `
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:20px;">
          <div style="background:rgba(255,255,255,0.03);border-radius:12px;padding:14px;text-align:center;border:1px solid rgba(255,255,255,0.06);">
            <div style="font-size:0.7rem;color:#888;margin-bottom:6px;">TOTAL DA FATURA</div>
            <div style="font-size:1.1rem;font-weight:800;color:#ff6b6b;">${this.formatMoney(fatura.total)}</div>
          </div>
          <div style="background:rgba(255,255,255,0.03);border-radius:12px;padding:14px;text-align:center;border:1px solid rgba(255,255,255,0.06);">
            <div style="font-size:0.7rem;color:#888;margin-bottom:6px;">PENDENTE</div>
            <div style="font-size:1.1rem;font-weight:800;color:#ffc400;">${this.formatMoney(fatura.total_pendente)}</div>
          </div>
          <div style="background:rgba(255,255,255,0.03);border-radius:12px;padding:14px;text-align:center;border:1px solid rgba(255,255,255,0.06);">
            <div style="font-size:0.7rem;color:#888;margin-bottom:6px;">LIMITE DISPONÍVEL</div>
            <div style="font-size:1.1rem;font-weight:800;color:#2FBF71;">${this.formatMoney(cartao.limite_disponivel)}</div>
          </div>
          <div style="background:${sc.bg};border-radius:12px;padding:14px;text-align:center;border:1px solid ${sc.color}40;">
            <div style="font-size:0.7rem;color:#888;margin-bottom:6px;">STATUS</div>
            <div style="font-size:0.85rem;font-weight:700;color:${sc.color};">${sc.label}</div>
            <div style="font-size:0.68rem;color:#666;margin-top:2px;">Vence: ${fatura.data_vencimento ? this.formatDate(fatura.data_vencimento) : '—'}</div>
          </div>
        </div>
      `

      // Botão pagar fatura completa
      const btnPagarFatura = fatura.total_pendente > 0 ? `
        <div style="display:flex;justify-content:flex-end;margin-bottom:16px;">
          <button onclick="VM._pagarFaturaCompleta(${cartaoId}, ${mes}, ${ano})"
            style="background:rgba(47,191,113,0.15);color:#2FBF71;border:1px solid rgba(47,191,113,0.3);border-radius:10px;padding:9px 18px;cursor:pointer;font-size:0.85rem;font-weight:600;">
            <i class="fas fa-check-double"></i> Pagar Fatura Completa (${this.formatMoney(fatura.total_pendente)})
          </button>
        </div>
      ` : ''

      // Lista de lançamentos estilo extrato bancário
      let listaHtml = ''
      if (lancamentos.length === 0) {
        listaHtml = `
          <div style="text-align:center;padding:48px 24px;color:#666;">
            <div style="font-size:2.5rem;margin-bottom:12px;">📭</div>
            <div style="font-size:0.9rem;">Nenhum lançamento nesta fatura</div>
            <button onclick="VM.modalNovaCompraCartao(${cartaoId})" style="margin-top:16px;background:rgba(47,191,113,0.12);color:#2FBF71;border:1px solid rgba(47,191,113,0.25);border-radius:8px;padding:8px 16px;cursor:pointer;font-size:0.82rem;">
              <i class="fas fa-plus"></i> Adicionar compra
            </button>
          </div>
        `
      } else {
        // Agrupar por data de compra (extrato cronológico)
        const grupoDatas = {}
        for (const l of lancamentos) {
          const key = l.data_compra || 'sem-data'
          if (!grupoDatas[key]) grupoDatas[key] = []
          grupoDatas[key].push(l)
        }
        const datasOrdenadas = Object.keys(grupoDatas).sort((a,b) => b.localeCompare(a))

        listaHtml = `<div style="display:flex;flex-direction:column;gap:2px;">`
        for (const data of datasOrdenadas) {
          const itens = grupoDatas[data]
          listaHtml += `
            <div style="font-size:0.72rem;color:#555;padding:10px 4px 6px;font-weight:600;letter-spacing:0.5px;text-transform:uppercase;">
              ${this.formatDate(data)}
            </div>
          `
          for (const l of itens) {
            const isPago = l.status === 'pago'
            const sColor = isPago ? '#2FBF71' : '#ffc400'
            const parcelaInfo = (l.total_parcelas && l.total_parcelas > 1)
              ? `<span style="background:rgba(255,255,255,0.06);border-radius:4px;padding:1px 6px;font-size:0.68rem;">${l.parcela_atual}/${l.total_parcelas}</span>`
              : ''
            const catLabel = l.categoria ? `<span style="color:#777;font-size:0.72rem;">${l.categoria}</span>` : ''

            listaHtml += `
              <div style="display:flex;align-items:center;gap:12px;padding:12px 14px;background:rgba(255,255,255,0.02);border-radius:10px;margin-bottom:2px;border-left:3px solid ${sColor};">
                <div style="width:36px;height:36px;background:rgba(255,255,255,0.05);border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:1rem;flex-shrink:0;">
                  ${this._catIcon(l.categoria)}
                </div>
                <div style="flex:1;min-width:0;">
                  <div style="font-size:0.88rem;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
                    ${l.descricao} ${parcelaInfo}
                  </div>
                  <div style="display:flex;gap:8px;align-items:center;margin-top:2px;">${catLabel}</div>
                </div>
                <div style="text-align:right;flex-shrink:0;">
                  <div style="font-weight:700;font-size:0.95rem;">${this.formatMoney(l.valor)}</div>
                  <div style="font-size:0.7rem;color:${sColor};">${isPago ? '✅ Pago' : '⏳ Pendente'}</div>
                </div>
                <div style="display:flex;flex-direction:column;gap:4px;flex-shrink:0;" onclick="event.stopPropagation()">
                  ${!isPago ? `<button onclick="VM._pagarCharge(${l.id})" style="background:rgba(47,191,113,0.12);color:#2FBF71;border:1px solid rgba(47,191,113,0.25);border-radius:6px;padding:4px 8px;cursor:pointer;font-size:0.7rem;white-space:nowrap;">Pagar</button>` : '<div style="width:50px;"></div>'}
                  <button onclick="VM._excluirCharge(${l.id})" style="background:rgba(255,80,80,0.1);color:#ff6b6b;border:1px solid rgba(255,80,80,0.2);border-radius:6px;padding:4px 8px;cursor:pointer;font-size:0.7rem;"><i class="fas fa-trash"></i></button>
                </div>
              </div>
            `
          }
        }
        listaHtml += `</div>`
      }

      body.innerHTML = resumoHtml + btnPagarFatura + listaHtml

    } catch(e) {
      if (body) body.innerHTML = `
        <div style="text-align:center;padding:48px;color:#ff6b6b;">
          <div style="font-size:2rem;margin-bottom:12px;">⚠️</div>
          <div>Erro ao carregar fatura</div>
          <button onclick="VM._carregarFatura()" style="margin-top:12px;background:rgba(255,80,80,0.12);color:#ff6b6b;border:1px solid rgba(255,80,80,0.25);border-radius:8px;padding:6px 14px;cursor:pointer;font-size:0.8rem;">Tentar novamente</button>
        </div>
      `
    }
  },

  _catIcon(cat) {
    const icons = {
      alimentacao:'🍽️', alimentação:'🍽️', transporte:'🚗', saude:'💊', saúde:'💊',
      educacao:'📚', educação:'📚', lazer:'🎮', moradia:'🏠', roupas:'👕',
      assinaturas:'📱', eletronicos:'💻', eletrônicos:'💻', pets:'🐾', outros:'💳',
      viagem:'✈️', beleza:'💄', esporte:'⚽'
    }
    const k = (cat || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    return icons[k] || icons[(cat||'').toLowerCase()] || '💳'
  },

  async _pagarCharge(chargeId) {
    try {
      await this.api('PATCH', `cartoes/charges/${chargeId}/pagar`, {})
      this.toast('Parcela paga! Limite restaurado. ✅')
      await this._carregarFatura()
      this.carregarCartoes()
    } catch(e) {
      this.toast(e.response?.data?.error || 'Erro ao pagar', 'error')
    }
  },

  async _pagarFaturaCompleta(cartaoId, mes, ano) {
    const ok = await this.vmConfirm(`Confirmar pagamento de <strong>toda a fatura</strong> de ${mes}/${ano}? Todos os lançamentos pendentes serão marcados como pagos.`, { titulo: 'Pagar Fatura Completa', corBotao: '#2FBF71', textoBotao: 'Pagar Fatura', icone: '💳' })
    if (!ok) return
    try {
      const r = await this.api('PATCH', `cartoes/${cartaoId}/pagar-fatura`, { mes, ano })
      this.toast(r.message || 'Fatura paga! 🎉', 'success')
      await this._carregarFatura()
      this.carregarCartoes()
    } catch(e) {
      this.toast(e.response?.data?.error || 'Erro ao pagar fatura', 'error')
    }
  },

  async _excluirCharge(chargeId) {
    const ok = await this.vmConfirm('Deseja excluir este lançamento da fatura permanentemente?', { titulo: 'Excluir Lançamento', corBotao: '#ef4444', textoBotao: 'Excluir', icone: '🗑️' })
    if (!ok) return
    try {
      await this.api('DELETE', `cartoes/lancamentos/${chargeId}`)
      this.toast('Lançamento excluído!')
      await this._carregarFatura()
      this.carregarCartoes()
    } catch(e) {
      this.toast('Erro ao excluir', 'error')
    }
  },

  // ─── MODAL NOVA COMPRA ──────────────────────────────────────────────────────
  async modalNovaCompraCartao(cartaoId) {
    // Fechar modal atual e abrir modal de compra
    const mc = document.getElementById('modal-container')
    const meses = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez']
    const hoje = new Date().toISOString().split('T')[0]
    const cats = ['Alimentação','Transporte','Saúde','Educação','Lazer','Moradia','Roupas','Assinaturas','Eletrônicos','Pets','Outros']

    mc.innerHTML = `
      <div class="modal-overlay" onclick="VM.closeModal(event)">
        <div class="modal" style="max-width:480px;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;">
            <div>
              <h3 style="font-size:1.05rem;font-weight:700;">💳 Nova Compra no Cartão</h3>
              <div style="font-size:0.75rem;color:#888;margin-top:2px;">Lançamento com cálculo automático da fatura</div>
            </div>
            <button onclick="VM._voltarParaFatura(${cartaoId})" style="background:none;border:none;color:#666;font-size:1.2rem;cursor:pointer;">✕</button>
          </div>
          <form id="nova-compra-form">
            <div class="form-group">
              <label class="form-label">Descrição *</label>
              <input type="text" id="nc-desc" class="form-input" placeholder="Ex: Supermercado, Netflix..." required>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
              <div class="form-group">
                <label class="form-label">Categoria *</label>
                <select id="nc-cat" class="form-select">
                  ${cats.map(c=>`<option value="${c}">${c}</option>`).join('')}
                </select>
              </div>
              <div class="form-group">
                <label class="form-label">Data da Compra *</label>
                <input type="date" id="nc-data" class="form-input" value="${hoje}" required>
              </div>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
              <div class="form-group">
                <label class="form-label">Valor Total (R$) *</label>
                <input type="number" id="nc-valor" class="form-input" step="0.01" min="0.01" placeholder="0,00" required>
              </div>
              <div class="form-group">
                <label class="form-label">Parcelas</label>
                <select id="nc-parcelas" class="form-select">
                  ${[1,2,3,4,5,6,7,8,9,10,11,12,18,24].map(n=>`<option value="${n}">${n===1?'À vista':'${n}x'}</option>`).join('')}
                </select>
              </div>
            </div>
            <div class="form-group">
              <label class="form-label">Observações</label>
              <input type="text" id="nc-obs" class="form-input" placeholder="Opcional...">
            </div>
            <div style="display:flex;gap:12px;margin-top:8px;">
              <button type="button" onclick="VM._voltarParaFatura(${cartaoId})" class="btn-secondary" style="flex:1;justify-content:center;">Cancelar</button>
              <button type="submit" class="btn-primary" style="flex:1;" id="nc-submit"><i class="fas fa-save"></i> Lançar Compra</button>
            </div>
          </form>
        </div>
      </div>
    `
    // Corrigir o template literal do select de parcelas
    document.querySelectorAll('#nc-parcelas option').forEach(opt => {
      if (opt.value !== '1') opt.textContent = opt.value + 'x'
    })

    document.getElementById('nova-compra-form').addEventListener('submit', async (e) => {
      e.preventDefault()
      const btn = document.getElementById('nc-submit')
      btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Salvando...'
      try {
        const r = await this.api('POST', `cartoes/${cartaoId}/compra`, {
          descricao:       document.getElementById('nc-desc').value,
          categoria:       document.getElementById('nc-cat').value,
          valor_total:     parseFloat(document.getElementById('nc-valor').value),
          numero_parcelas: parseInt(document.getElementById('nc-parcelas').value),
          data_compra:     document.getElementById('nc-data').value,
          observacoes:     document.getElementById('nc-obs').value || null
        })
        this.toast(r.message || 'Compra lançada!', 'success')
        await this._voltarParaFatura(cartaoId)
        this.carregarCartoes()
      } catch(err) {
        this.toast(err.response?.data?.error || 'Erro ao lançar compra', 'error')
        btn.disabled = false; btn.innerHTML = '<i class="fas fa-save"></i> Lançar Compra'
      }
    })
  },

  async _voltarParaFatura(cartaoId) {
    if (this._faturaState && this._faturaState.cartaoId === cartaoId) {
      // Reutilizar diaFechamento salvo no estado, se disponível
      await this.abrirFaturaCartao(cartaoId, this._faturaState.nomeCartao, this._faturaState.cor, this._faturaState.diaFechamento)
    } else {
      this.closeModal()
    }
  },

  // ─── COMPRA ANTERIOR / RETROATIVA ─────────────────────────────────────────
  async modalLancarCompraAnterior() {
    let cartoes = []
    try { const r = await this.api('GET', 'cartoes'); cartoes = r.cartoes || [] } catch(e) {}

    if (cartoes.length === 0) {
      this.toast('Cadastre um cartão antes de lançar compras', 'warning')
      return
    }

    document.getElementById('modal-container').innerHTML = `
      <div class="modal-overlay" onclick="VM.closeModal(event)">
        <div class="modal" style="max-width:520px;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;">
            <div>
              <h3 style="font-size:1.1rem;font-weight:700;">📅 Compra Anterior Parcelada</h3>
              <div style="font-size:0.78rem;color:#888;margin-top:3px;">Registre compras já realizadas com parcelas em andamento</div>
            </div>
            <button onclick="VM.closeModal()" style="background:none;border:none;color:#666;font-size:1.2rem;cursor:pointer;">✕</button>
          </div>

          <div style="background:rgba(255,196,0,0.08);border:1px solid rgba(255,196,0,0.2);border-radius:10px;padding:12px;margin-bottom:20px;font-size:0.8rem;color:#cca800;line-height:1.6;">
            💡 <strong>Exemplo:</strong> Compra de R$ 1.200 em janeiro em 12x. Estamos em março (2 parcelas pagas).
            Informe o valor total original, total de parcelas e quantas já foram pagas — o sistema registra apenas as parcelas restantes nas faturas corretas.
          </div>

          <form id="compra-ant-form">
            <div class="form-group">
              <label class="form-label">Cartão *</label>
              <select id="ca-cartao" class="form-select">
                ${cartoes.map(c => `<option value="${c.id}">${c.nome} (${c.bandeira})</option>`).join('')}
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">Descrição da Compra *</label>
              <input type="text" id="ca-desc" class="form-input" placeholder="Ex: Notebook Dell, iPhone 15..." required>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
              <div class="form-group">
                <label class="form-label">Categoria *</label>
                <select id="ca-cat" class="form-select">
                  ${['Alimentação','Transporte','Saúde','Educação','Lazer','Moradia','Roupas','Assinaturas','Eletrônicos','Pets','Outros'].map(c=>`<option value="${c}">${c}</option>`).join('')}
                </select>
              </div>
              <div class="form-group">
                <label class="form-label">Data original da compra *</label>
                <input type="date" id="ca-data" class="form-input" required>
              </div>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;">
              <div class="form-group">
                <label class="form-label">Valor Total (R$) *</label>
                <input type="number" id="ca-valor" class="form-input" step="0.01" min="0" placeholder="0,00" required oninput="VM.previewCompraAnterior()">
              </div>
              <div class="form-group">
                <label class="form-label">Total de Parcelas *</label>
                <input type="number" id="ca-parcelas-total" class="form-input" min="2" max="60" placeholder="12" required oninput="VM.previewCompraAnterior()">
              </div>
              <div class="form-group">
                <label class="form-label">Já Pagas *</label>
                <input type="number" id="ca-parcelas-pagas" class="form-input" min="0" max="59" placeholder="2" required oninput="VM.previewCompraAnterior()">
              </div>
            </div>

            <div id="ca-preview" style="display:none;padding:14px;background:rgba(47,191,113,0.07);border:1px solid rgba(47,191,113,0.2);border-radius:10px;margin-bottom:16px;font-size:0.82rem;"></div>

            <div class="form-group">
              <label class="form-label">Observações</label>
              <input type="text" id="ca-obs" class="form-input" placeholder="Opcional...">
            </div>
            <div style="display:flex;gap:12px;margin-top:8px;">
              <button type="button" onclick="VM.closeModal()" class="btn-secondary" style="flex:1;justify-content:center;">Cancelar</button>
              <button type="submit" class="btn-primary" style="flex:1;" id="ca-submit"><i class="fas fa-save"></i> Registrar Parcelas Restantes</button>
            </div>
          </form>
        </div>
      </div>
    `

    document.getElementById('compra-ant-form').addEventListener('submit', async (e) => {
      e.preventDefault()
      const btn = document.getElementById('ca-submit')
      btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Salvando...'
      const cartaoId = document.getElementById('ca-cartao').value
      const totalParcelas = parseInt(document.getElementById('ca-parcelas-total').value)
      const jasPagas = parseInt(document.getElementById('ca-parcelas-pagas').value)
      if (jasPagas >= totalParcelas) {
        this.toast('Parcelas pagas não pode ser igual ou maior que o total', 'error')
        btn.disabled = false; btn.innerHTML = '<i class="fas fa-save"></i> Registrar Parcelas Restantes'
        return
      }
      try {
        const res = await this.api('POST', `cartoes/${cartaoId}/compra-retroativa`, {
          descricao:       document.getElementById('ca-desc').value,
          categoria:       document.getElementById('ca-cat').value,
          valor_total:     parseFloat(document.getElementById('ca-valor').value),
          numero_parcelas: totalParcelas,
          parcelas_pagas:  jasPagas,
          data_compra:     document.getElementById('ca-data').value,
          observacoes:     document.getElementById('ca-obs').value || null
        })
        this.toast(res.message || 'Compra registrada!', 'success')
        this.closeModal()
        this.carregarCartoes()
      } catch(err) {
        this.toast(err.response?.data?.error || 'Erro ao registrar', 'error')
        btn.disabled = false; btn.innerHTML = '<i class="fas fa-save"></i> Registrar Parcelas Restantes'
      }
    })
  },

  previewCompraAnterior() {
    const valor = parseFloat(document.getElementById('ca-valor')?.value || 0)
    const total = parseInt(document.getElementById('ca-parcelas-total')?.value || 0)
    const pagas = parseInt(document.getElementById('ca-parcelas-pagas')?.value || 0)
    const preview = document.getElementById('ca-preview')
    if (!preview) return
    if (valor > 0 && total >= 2 && pagas >= 0 && pagas < total) {
      const restantes = total - pagas
      const valorParcela = valor / total
      const totalRestante = valorParcela * restantes
      preview.style.display = 'block'
      preview.innerHTML = `
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;text-align:center;">
          <div><div style="color:#888;font-size:0.72rem;">Valor por parcela</div><div style="font-weight:700;color:#2FBF71;">${this.formatMoney(valorParcela)}</div></div>
          <div><div style="color:#888;font-size:0.72rem;">Parcelas a registrar</div><div style="font-weight:700;color:#ffc400;">${restantes} de ${total}</div></div>
          <div><div style="color:#888;font-size:0.72rem;">Total a registrar</div><div style="font-weight:700;color:#ff6b6b;">${this.formatMoney(totalRestante)}</div></div>
        </div>
      `
    } else {
      preview.style.display = 'none'
    }
  },

  // ─── CRUD CARTÃO ───────────────────────────────────────────────────────────
  modalCartao(cartao = null) {
    const isEdit = !!cartao
    const bandeiras = ['visa', 'mastercard', 'elo', 'amex', 'hipercard', 'outros']
    const cores = ['#2FBF71', '#74b9ff', '#fd79a8', '#a29bfe', '#ffc400', '#ff8c42', '#ff6b6b', '#00cec9']

    document.getElementById('modal-container').innerHTML = `
      <div class="modal-overlay" onclick="VM.closeModal(event)">
        <div class="modal">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:24px;">
            <h3 style="font-size:1.1rem;font-weight:700;">${isEdit ? '✏️ Editar' : '💳 Novo'} Cartão</h3>
            <button onclick="VM.closeModal()" style="background:none;border:none;color:#666;font-size:1.2rem;cursor:pointer;">✕</button>
          </div>
          <form id="cartao-form">
            <div class="form-group">
              <label class="form-label">Nome do Cartão *</label>
              <input type="text" id="ct-nome" class="form-input" placeholder="Ex: Nubank Roxinho" value="${cartao?.nome || ''}" required>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
              <div class="form-group">
                <label class="form-label">Bandeira *</label>
                <select id="ct-bandeira" class="form-select">
                  ${bandeiras.map(b => `<option value="${b}" ${cartao?.bandeira===b?'selected':''}>${b.charAt(0).toUpperCase()+b.slice(1)}</option>`).join('')}
                </select>
              </div>
              <div class="form-group">
                <label class="form-label">Banco *</label>
                <input type="text" id="ct-banco" class="form-input" placeholder="Ex: Nubank" value="${cartao?.banco || ''}" required>
              </div>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
              <div class="form-group">
                <label class="form-label">Limite Total (R$) *</label>
                <input type="number" id="ct-limite" class="form-input" step="0.01" min="0" value="${cartao?.limite_total || ''}" required>
              </div>
              <div class="form-group">
                <label class="form-label">4 últimos dígitos</label>
                <input type="text" id="ct-digitos" class="form-input" placeholder="0000" maxlength="4" value="${cartao?.ultimos_digitos || ''}">
              </div>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
              <div class="form-group">
                <label class="form-label">Dia de Fechamento *</label>
                <input type="number" id="ct-fecha" class="form-input" min="1" max="31" value="${cartao?.dia_fechamento || ''}" required
                  ${isEdit ? `oninput="VM._ctAvisoFechamento(${cartao?.dia_fechamento}, ${cartao?.dia_vencimento})"` : ''}>
              </div>
              <div class="form-group">
                <label class="form-label">Dia de Vencimento *</label>
                <input type="number" id="ct-vence" class="form-input" min="1" max="31" value="${cartao?.dia_vencimento || ''}" required
                  ${isEdit ? `oninput="VM._ctAvisoFechamento(${cartao?.dia_fechamento}, ${cartao?.dia_vencimento})"` : ''}>
              </div>
            </div>
            <!-- S-C7: aviso ao mudar dias de fechamento/vencimento -->
            <div id="ct-aviso-dias" style="display:none;margin-bottom:12px;padding:10px 14px;background:rgba(255,196,0,0.1);border:1px solid rgba(255,196,0,0.3);border-radius:8px;font-size:0.8rem;color:#ffc400;">
              ⚠️ Alterar o dia de fechamento ou vencimento afeta apenas novas compras. Os lançamentos existentes continuarão com as datas originais.
            </div>
            <!-- S-C6: Apelido opcional -->
            <div class="form-group">
              <label class="form-label">Apelido <span style="color:#888;font-size:0.78rem;">(opcional)</span></label>
              <input type="text" id="ct-apelido" class="form-input" placeholder='Ex: "day-to-day", "viagens", "assinaturas"' value="${cartao?.apelido || ''}">
            </div>
            <div class="form-group">
              <label class="form-label">Cor</label>
              <div style="display:flex;gap:10px;flex-wrap:wrap;">
                ${cores.map(c => `
                  <div onclick="document.getElementById('ct-cor').value='${c}';document.querySelectorAll('.ctcor').forEach(el=>el.style.border='none');this.style.border='3px solid white'"
                    class="ctcor" style="width:30px;height:30px;background:${c};border-radius:8px;cursor:pointer;border:${(cartao?.cor||'#2FBF71')===c?'3px solid white':'none'};"></div>
                `).join('')}
              </div>
              <input type="hidden" id="ct-cor" value="${cartao?.cor || '#2FBF71'}">
            </div>
            <div style="display:flex;gap:12px;margin-top:8px;">
              <button type="button" onclick="VM.closeModal()" class="btn-secondary" style="flex:1;justify-content:center;">Cancelar</button>
              <button type="submit" class="btn-primary" style="flex:1;" id="ct-submit">
                <i class="fas fa-save"></i> ${isEdit ? 'Salvar' : 'Adicionar'}
              </button>
            </div>
          </form>
        </div>
      </div>
    `

    document.getElementById('cartao-form').addEventListener('submit', async (e) => {
      e.preventDefault()
      const btn = document.getElementById('ct-submit')
      btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Salvando...'
      try {
        const limite = parseFloat(document.getElementById('ct-limite').value)
        const payload = {
          nome: document.getElementById('ct-nome').value,
          bandeira: document.getElementById('ct-bandeira').value,
          banco: document.getElementById('ct-banco').value,
          apelido: document.getElementById('ct-apelido')?.value || null,  // S-C6
          limite_total: limite,
          limite_disponivel: isEdit ? cartao.limite_disponivel : limite,
          dia_fechamento: parseInt(document.getElementById('ct-fecha').value),
          dia_vencimento: parseInt(document.getElementById('ct-vence').value),
          ultimos_digitos: document.getElementById('ct-digitos').value || null,
          cor: document.getElementById('ct-cor').value
        }
        if (isEdit) await this.api('PUT', `cartoes/${cartao.id}`, payload)
        else await this.api('POST', 'cartoes', payload)
        this.toast(isEdit ? 'Cartão atualizado!' : 'Cartão adicionado! 💳')
        this.closeModal(); this.carregarCartoes()
      } catch (err) {
        this.toast(err.response?.data?.error || 'Erro ao salvar', 'error')
        btn.disabled = false; btn.innerHTML = `<i class="fas fa-save"></i> ${isEdit ? 'Salvar' : 'Adicionar'}`
      }
    })
  },

  async deleteCartao(id) {
    const ok = await this.vmConfirm('Deseja excluir este cartão e todos os seus lançamentos permanentemente?', { titulo: 'Excluir Cartão', corBotao: '#ef4444', textoBotao: 'Excluir', icone: '💳' })
    if (!ok) return
    try {
      await this.api('DELETE', `cartoes/${id}`)
      this.toast('Cartão excluído!')
      this.carregarCartoes()
    } catch (e) {
      this.toast('Erro ao excluir', 'error')
    }
  },

  // S-C7: mostrar/ocultar aviso ao alterar dia de fechamento ou vencimento
  _ctAvisoFechamento(fechaOriginal, venceOriginal) {
    const aviso = document.getElementById('ct-aviso-dias')
    if (!aviso) return
    const fechaAtual = parseInt(document.getElementById('ct-fecha')?.value || 0)
    const venceAtual = parseInt(document.getElementById('ct-vence')?.value || 0)
    const mudou = fechaAtual !== parseInt(fechaOriginal) || venceAtual !== parseInt(venceOriginal)
    aviso.style.display = mudou ? 'block' : 'none'
  },

  // S-C4: modal para ajuste manual de limite disponível
  async modalAjustarLimite(cartaoId, nomeCartao, limiteTotal, limiteDisponivel) {
    document.getElementById('modal-container').innerHTML = `
      <div class="modal-overlay" onclick="VM.closeModal(event)">
        <div class="modal" style="max-width:420px;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;">
            <h3 style="font-size:1.1rem;font-weight:700;">⚙️ Ajustar Limite Disponível</h3>
            <button onclick="VM.closeModal()" style="background:none;border:none;color:#666;font-size:1.2rem;cursor:pointer;">✕</button>
          </div>
          <div style="background:rgba(255,255,255,0.04);border-radius:10px;padding:14px;margin-bottom:18px;">
            <div style="font-size:0.82rem;color:#888;margin-bottom:4px;">Cartão: <strong style="color:#fff;">${nomeCartao}</strong></div>
            <div style="display:flex;gap:20px;margin-top:8px;">
              <div>
                <div style="font-size:0.72rem;color:#888;">Limite Total</div>
                <div style="font-size:1.1rem;font-weight:700;">${this.formatMoney(limiteTotal)}</div>
              </div>
              <div>
                <div style="font-size:0.72rem;color:#888;">Atual Disponível</div>
                <div style="font-size:1.1rem;font-weight:700;color:#2FBF71;">${this.formatMoney(limiteDisponivel)}</div>
              </div>
            </div>
          </div>
          <div style="font-size:0.8rem;color:#888;margin-bottom:14px;padding:10px 12px;background:rgba(99,102,241,0.08);border-radius:8px;border-left:3px solid #6366f1;">
            💡 Use quando pagar parte da fatura diretamente no app do banco e o limite ainda não refletiu aqui.
          </div>
          <div class="form-group">
            <label class="form-label">Novo Limite Disponível (R$) *</label>
            <input type="number" id="aj-limite" class="form-input" step="0.01" min="0" max="${limiteTotal}" value="${limiteDisponivel}" placeholder="Ex: 3500.00">
          </div>
          <div class="form-group">
            <label class="form-label">Motivo <span style="color:#888;font-size:0.78rem;">(opcional)</span></label>
            <input type="text" id="aj-motivo" class="form-input" placeholder='Ex: "Paguei R$500 no app do banco"' maxlength="100">
          </div>
          <div style="display:flex;gap:12px;margin-top:8px;">
            <button type="button" onclick="VM.closeModal()" class="btn-secondary" style="flex:1;justify-content:center;">Cancelar</button>
            <button type="button" onclick="VM._confirmarAjusteLimite(${cartaoId}, ${limiteTotal})" class="btn-primary" style="flex:1;" id="aj-submit">
              <i class="fas fa-check"></i> Confirmar Ajuste
            </button>
          </div>
        </div>
      </div>
    `
  },

  async _confirmarAjusteLimite(cartaoId, limiteTotal) {
    const btn = document.getElementById('aj-submit')
    const novoLimite = parseFloat(document.getElementById('aj-limite')?.value || 0)
    const motivo = document.getElementById('aj-motivo')?.value || ''
    if (isNaN(novoLimite) || novoLimite < 0 || novoLimite > limiteTotal) {
      this.toast(`Valor inválido. Deve ser entre R$ 0 e ${this.formatMoney(limiteTotal)}`, 'error')
      return
    }
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Salvando...' }
    try {
      const r = await this.api('PATCH', `cartoes/${cartaoId}/limite`, { limite_disponivel: novoLimite, motivo })
      this.toast(`✅ Limite atualizado para ${this.formatMoney(r.limite_disponivel)}!`)
      this.closeModal()
      this.carregarCartoes()
    } catch(e) {
      this.toast(e?.response?.data?.error || 'Erro ao ajustar limite', 'error')
      if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-check"></i> Confirmar Ajuste' }
    }
  },


  // ============== LEMBRETES ==============
  async pageLembretes() {
    document.getElementById('page-content').innerHTML = `
      <div class="section-header">
        <div>
          <div class="section-title">⏰ Lembretes de Contas</div>
          <div style="color:#666;font-size:0.85rem;margin-top:2px;">Nunca perca um vencimento</div>
        </div>
        <button onclick="VM.modalLembrete()" class="btn-primary" style="width:auto;padding:10px 20px;">
          <i class="fas fa-plus"></i> Novo Lembrete
        </button>
      </div>
      <div id="lembretes-container">
        <div class="empty-state"><div class="skeleton" style="height:200px;border-radius:16px;"></div></div>
      </div>
    `
    this.carregarLembretes()
  },

  async carregarLembretes() {
    try {
      const data = await this.api('GET', 'lembretes')
      const container = document.getElementById('lembretes-container')
      
      const tipoIcons = { conta: '📃', imposto: '🏛️', mensalidade: '📅', seguro: '🛡️', aluguel: '🏠', investimento: '📈', outros: '🔔' }
      const freqLabel = { semanal: 'Semanal', quinzenal: 'Quinzenal', mensal: 'Mensal', bimestral: 'Bimestral', trimestral: 'Trimestral', semestral: 'Semestral', anual: 'Anual' }

      if (!data.lembretes || data.lembretes.length === 0) {
        container.innerHTML = `
          <div class="card" style="text-align:center;padding:60px 40px;">
            <div style="font-size:3rem;margin-bottom:16px;">🔔</div>
            <h3 style="margin-bottom:8px;">Nenhum lembrete cadastrado</h3>
            <p style="color:#666;margin-bottom:24px;">Adicione contas e lembretes para nunca perder um vencimento</p>
            <button onclick="VM.modalLembrete()" class="btn-primary" style="width:auto;padding:10px 24px;">
              <i class="fas fa-plus"></i> Criar Lembrete
            </button>
          </div>
        `
        return
      }

      const urgentes = data.lembretes.filter(l => {
        if (!l.proximo_vencimento) return false
        const diff = (new Date(l.proximo_vencimento) - new Date()) / 86400000
        return diff <= 3 && diff >= 0
      })

      container.innerHTML = `
        ${urgentes.length > 0 ? `
          <div class="card" style="border-color:rgba(255,196,0,0.4);margin-bottom:20px;">
            <div style="font-size:1rem;font-weight:700;color:#ffc400;margin-bottom:16px;">⚠️ Vencimentos Próximos (${urgentes.length})</div>
            <div style="display:flex;flex-direction:column;gap:10px;">
              ${urgentes.map(l => `
                <div style="display:flex;align-items:center;justify-content:space-between;padding:12px;background:rgba(255,196,0,0.06);border-radius:10px;">
                  <div style="display:flex;align-items:center;gap:10px;">
                    <span style="font-size:1.3rem;">${tipoIcons[l.tipo] || '🔔'}</span>
                    <div>
                      <div style="font-weight:600;font-size:0.9rem;">${l.titulo}</div>
                      <div style="font-size:0.75rem;color:#888;">Vence: ${this.formatDate(l.proximo_vencimento)}</div>
                    </div>
                  </div>
                  <div style="font-weight:700;color:#ffc400;">${this.formatMoney(l.valor_estimado)}</div>
                </div>
              `).join('')}
            </div>
          </div>
        ` : ''}

        <div class="card">
          <div style="font-weight:700;margin-bottom:16px;">📋 Todos os Lembretes</div>
          <div style="display:flex;flex-direction:column;gap:12px;">
            ${data.lembretes.map(l => `
              <div style="display:flex;align-items:center;gap:14px;padding:14px;background:rgba(255,255,255,0.02);border-radius:12px;border:1px solid rgba(255,255,255,0.04);">
                <div style="width:44px;height:44px;background:rgba(47,191,113,0.12);border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:1.4rem;flex-shrink:0;">
                  ${tipoIcons[l.tipo] || '🔔'}
                </div>
                <div style="flex:1;min-width:0;">
                  <div style="font-weight:600;font-size:0.9rem;">${l.titulo}</div>
                  <div style="font-size:0.75rem;color:#666;margin-top:2px;">
                    ${freqLabel[l.frequencia] || 'Mensal'} • Dia ${l.dia_vencimento || '-'} 
                    ${l.proximo_vencimento ? '• Próximo: ' + this.formatDate(l.proximo_vencimento) : ''}
                  </div>
                </div>
                <div style="text-align:right;flex-shrink:0;">
                  <div style="font-weight:700;font-size:0.95rem;">${this.formatMoney(l.valor_estimado)}</div>
                  <div style="margin-top:6px;">
                    <span class="badge ${l.ativo ? 'badge-green' : 'badge-red'}" style="font-size:0.7rem;">
                      ${l.ativo ? '✅ Ativo' : '⏸️ Inativo'}
                    </span>
                  </div>
                </div>
                <div style="display:flex;gap:6px;flex-shrink:0;">
                  <button onclick="VM.modalConverterLembrete(${JSON.stringify(l).replace(/"/g,'&quot;')})" title="Converter em Despesa" style="background:rgba(47,191,113,0.12);border:1px solid rgba(47,191,113,0.3);color:#2FBF71;border-radius:6px;padding:6px 10px;cursor:pointer;font-size:0.75rem;"><i class="fas fa-exchange-alt"></i></button>
                  <button onclick="VM.modalLembrete(${JSON.stringify(l).replace(/"/g,'&quot;')})" class="btn-success"><i class="fas fa-edit"></i></button>
                  <button onclick="VM.deleteLembrete(${l.id})" class="btn-danger"><i class="fas fa-trash"></i></button>
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      `
    } catch (e) {
      this.toast('Erro ao carregar lembretes', 'error')
    }
  },

  modalLembrete(lembrete = null) {
    const isEdit = !!lembrete
    const tipos = [{ v:'conta', l:'📃 Conta' }, { v:'imposto', l:'🏛️ Imposto' }, { v:'mensalidade', l:'📅 Mensalidade' }, { v:'seguro', l:'🛡️ Seguro' }, { v:'aluguel', l:'🏠 Aluguel' }, { v:'investimento', l:'📈 Investimento' }, { v:'outros', l:'🔔 Outros' }]
    const freqs = [{ v:'semanal', l:'Semanal' }, { v:'quinzenal', l:'Quinzenal' }, { v:'mensal', l:'Mensal' }, { v:'bimestral', l:'Bimestral' }, { v:'trimestral', l:'Trimestral' }, { v:'semestral', l:'Semestral' }, { v:'anual', l:'Anual' }]

    document.getElementById('modal-container').innerHTML = `
      <div class="modal-overlay" onclick="VM.closeModal(event)">
        <div class="modal">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:24px;">
            <h3 style="font-size:1.1rem;font-weight:700;">${isEdit ? '✏️ Editar' : '🔔 Novo'} Lembrete</h3>
            <button onclick="VM.closeModal()" style="background:none;border:none;color:#666;font-size:1.2rem;cursor:pointer;">✕</button>
          </div>
          <form id="lembrete-form">
            <div class="form-group">
              <label class="form-label">Título *</label>
              <input type="text" id="l-titulo" class="form-input" placeholder="Ex: Conta de luz" value="${lembrete?.titulo || ''}" required>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
              <div class="form-group">
                <label class="form-label">Tipo</label>
                <select id="l-tipo" class="form-select">
                  ${tipos.map(t => `<option value="${t.v}" ${lembrete?.tipo===t.v?'selected':''}>${t.l}</option>`).join('')}
                </select>
              </div>
              <div class="form-group">
                <label class="form-label">Frequência</label>
                <select id="l-freq" class="form-select">
                  ${freqs.map(f => `<option value="${f.v}" ${lembrete?.frequencia===f.v?'selected':''}>${f.l}</option>`).join('')}
                </select>
              </div>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
              <div class="form-group">
                <label class="form-label">Valor Estimado (R$)</label>
                <input type="number" id="l-valor" class="form-input" step="0.01" min="0" placeholder="0,00" value="${lembrete?.valor_estimado || ''}">
              </div>
              <div class="form-group">
                <label class="form-label">Dia do Vencimento</label>
                <input type="number" id="l-dia" class="form-input" min="1" max="31" placeholder="Ex: 15" value="${lembrete?.dia_vencimento || ''}">
              </div>
            </div>
            <div class="form-group">
              <label class="form-label">Alertar quantos dias antes?</label>
              <select id="l-alerta" class="form-select">
                ${[1,2,3,5,7,10].map(d => `<option value="${d}" ${lembrete?.alertar_dias_antes===d?'selected':''}>${d} dia${d>1?'s':''} antes</option>`).join('')}
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">Descrição</label>
              <input type="text" id="l-desc" class="form-input" placeholder="Opcional..." value="${lembrete?.descricao || ''}">
            </div>
            <div class="form-group" style="display:flex;align-items:center;gap:10px;">
              <input type="checkbox" id="l-ativo" ${!isEdit || lembrete?.ativo ? 'checked' : ''} style="width:16px;height:16px;accent-color:#2FBF71;">
              <label for="l-ativo" class="form-label" style="margin:0;">Lembrete ativo</label>
            </div>
            <div style="display:flex;gap:12px;margin-top:8px;">
              <button type="button" onclick="VM.closeModal()" class="btn-secondary" style="flex:1;justify-content:center;">Cancelar</button>
              <button type="submit" class="btn-primary" style="flex:1;" id="l-submit">
                <i class="fas fa-save"></i> ${isEdit ? 'Salvar' : 'Criar'}
              </button>
            </div>
          </form>
        </div>
      </div>
    `

    document.getElementById('lembrete-form').addEventListener('submit', async (e) => {
      e.preventDefault()
      const btn = document.getElementById('l-submit')
      btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Salvando...'
      try {
        const payload = {
          titulo: document.getElementById('l-titulo').value,
          tipo: document.getElementById('l-tipo').value,
          frequencia: document.getElementById('l-freq').value,
          valor_estimado: parseFloat(document.getElementById('l-valor').value) || 0,
          dia_vencimento: parseInt(document.getElementById('l-dia').value) || null,
          alertar_dias_antes: parseInt(document.getElementById('l-alerta').value),
          descricao: document.getElementById('l-desc').value,
          ativo: document.getElementById('l-ativo').checked ? 1 : 0
        }
        if (isEdit) await this.api('PUT', `lembretes/${lembrete.id}`, payload)
        else await this.api('POST', 'lembretes', payload)
        this.toast(isEdit ? 'Lembrete atualizado!' : 'Lembrete criado! ⏰')
        this.closeModal(); this.carregarLembretes()
      } catch (err) {
        this.toast(err.response?.data?.error || 'Erro ao salvar', 'error')
        btn.disabled = false; btn.innerHTML = `<i class="fas fa-save"></i> ${isEdit ? 'Salvar' : 'Criar'}`
      }
    })
  },

  async deleteLembrete(id) {
    const ok = await this.vmConfirm('Deseja excluir este lembrete permanentemente?', { titulo: 'Excluir Lembrete', corBotao: '#ef4444', textoBotao: 'Excluir', icone: '🗑️' })
    if (!ok) return
    try {
      await this.api('DELETE', `lembretes/${id}`)
      this.toast('Lembrete excluído!')
      this.carregarLembretes()
    } catch (e) {
      this.toast('Erro ao excluir', 'error')
    }
  },

  // Modal para converter lembrete em despesa real
  async modalConverterLembrete(lembrete) {
    const today = new Date().toISOString().split('T')[0]
    const categorias = ['Alimentação','Transporte','Saúde','Educação','Lazer','Moradia','Roupas','Assinaturas','Pets','Outros']

    // Buscar cartões para selecionar
    let cartoes = []
    try { const d = await this.api('GET', 'cartoes'); cartoes = d.cartoes || [] } catch(e) {}

    const cartaoOptions = cartoes.map(c =>
      `<option value="${c.id}">${c.nome} (fechamento dia ${c.dia_fechamento})</option>`
    ).join('')

    document.getElementById('modal-container').innerHTML = `
      <div class="modal-overlay" onclick="VM.closeModal(event)">
        <div class="modal" style="max-width:480px;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;">
            <h3 style="font-size:1rem;font-weight:700;">💸 Converter Lembrete em Despesa</h3>
            <button onclick="VM.closeModal()" style="background:none;border:none;color:#666;font-size:1.2rem;cursor:pointer;">✕</button>
          </div>
          <div style="background:rgba(47,191,113,0.06);border:1px solid rgba(47,191,113,0.2);border-radius:8px;padding:10px 14px;margin-bottom:16px;font-size:0.82rem;">
            <strong>${lembrete.titulo}</strong> · ${this.formatMoney(lembrete.valor_estimado)}
          </div>
          <form id="converter-form">
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
              <div class="form-group">
                <label class="form-label">Descrição *</label>
                <input type="text" id="cv-desc" class="form-input" value="${lembrete.titulo}" required>
              </div>
              <div class="form-group">
                <label class="form-label">Valor (R$) *</label>
                <input type="number" id="cv-valor" class="form-input" step="0.01" min="0.01" value="${lembrete.valor_estimado || ''}" required>
              </div>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
              <div class="form-group">
                <label class="form-label">Data *</label>
                <input type="date" id="cv-data" class="form-input" value="${today}" required onchange="VM._recalcBillingConverter()">
              </div>
              <div class="form-group">
                <label class="form-label">Categoria</label>
                <select id="cv-cat" class="form-select">
                  ${categorias.map(c => `<option value="${c}">${c}</option>`).join('')}
                </select>
              </div>
            </div>
            <div class="form-group">
              <label class="form-label">Forma de Pagamento</label>
              <select id="cv-meio" class="form-select" onchange="VM._toggleCartaoConverter(this.value)">
                <option value="dinheiro">💵 Dinheiro / À vista</option>
                <option value="pix">⚡ PIX</option>
                <option value="cartao_debito">💳 Cartão de Débito</option>
                <option value="cartao_credito">💳 Cartão de Crédito</option>
                <option value="boleto">📄 Boleto</option>
                <option value="transferencia">🏦 Transferência</option>
              </select>
            </div>
            <div id="cv-cartao-wrapper" style="display:none;">
              <div class="form-group">
                <label class="form-label">Cartão</label>
                <select id="cv-cartao-id" class="form-select" onchange="VM._recalcBillingConverter()">
                  <option value="">— Selecione —</option>
                  ${cartaoOptions}
                </select>
              </div>
              <div id="cv-billing-info" style="display:none;margin-bottom:12px;"></div>
            </div>
            <div class="form-group">
              <label class="form-label">Status</label>
              <select id="cv-status" class="form-select">
                <option value="pendente">⏳ Pendente</option>
                <option value="pago">✅ Pago</option>
              </select>
            </div>
            <div style="display:flex;gap:12px;margin-top:8px;">
              <button type="button" onclick="VM.closeModal()" class="btn-secondary" style="flex:1;justify-content:center;">Cancelar</button>
              <button type="submit" class="btn-primary" style="flex:1;" id="cv-submit">
                <i class="fas fa-exchange-alt"></i> Converter em Despesa
              </button>
            </div>
          </form>
        </div>
      </div>
    `

    // Funções locais
    this._toggleCartaoConverter = (meio) => {
      const w = document.getElementById('cv-cartao-wrapper')
      if (w) w.style.display = meio === 'cartao_credito' ? 'block' : 'none'
      this._recalcBillingConverter()
    }

    this._recalcBillingConverter = async () => {
      const cartaoId = document.getElementById('cv-cartao-id')?.value
      const dataVal = document.getElementById('cv-data')?.value
      const infoEl = document.getElementById('cv-billing-info')
      if (!cartaoId || !dataVal || !infoEl) return
      try {
        const cartoesData = await this.api('GET', 'cartoes')
        const cartao = (cartoesData.cartoes || []).find(c => String(c.id) === String(cartaoId))
        if (!cartao) return
        const d = new Date(dataVal + 'T12:00:00')
        const diaC = d.getDate(), diaF = cartao.dia_fechamento
        let mesF = d.getMonth() + 1, anoF = d.getFullYear()
        if (diaC >= diaF) { mesF++; if (mesF > 12) { mesF = 1; anoF++ } }
        const mN = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro']
        infoEl.style.display = 'block'
        infoEl.innerHTML = `<div style="background:rgba(47,191,113,0.08);border:1px solid rgba(47,191,113,0.3);border-radius:8px;padding:8px 12px;font-size:0.78rem;">
          📅 <strong>Fatura: ${mN[mesF-1]}/${anoF}</strong> · Fechamento dia ${diaF}</div>`
      } catch(e) {}
    }

    document.getElementById('converter-form').addEventListener('submit', async (e) => {
      e.preventDefault()
      const btn = document.getElementById('cv-submit')
      btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Convertendo...'
      try {
        const meio = document.getElementById('cv-meio').value
        const cartaoId = document.getElementById('cv-cartao-id')?.value || null
        const payload = {
          descricao: document.getElementById('cv-desc').value,
          valor: parseFloat(document.getElementById('cv-valor').value),
          data: document.getElementById('cv-data').value,
          categoria: document.getElementById('cv-cat').value,
          status: document.getElementById('cv-status').value,
          meio_pagamento: meio,
          cartao_id: meio === 'cartao_credito' ? (cartaoId || null) : null,
        }
        const r = await this.api('POST', `lembretes/${lembrete.id}/converter-despesa`, payload)
        this.toast(`✅ Despesa criada! (ID #${r.despesa_id})`)
        this.closeModal()
        this.carregarLembretes()
      } catch(err) {
        this.toast(err?.response?.data?.error || 'Erro ao converter', 'error')
        btn.disabled = false; btn.innerHTML = '<i class="fas fa-exchange-alt"></i> Converter em Despesa'
      }
    })
  },


  async pageFinanciamentos() {
    document.getElementById('page-content').innerHTML = `
      <div class="section-header">
        <div>
          <div class="section-title">🏠 Financiamentos</div>
          <div style="color:#666;font-size:0.85rem;margin-top:2px;">Controle seus financiamentos imobiliários</div>
        </div>
        <button onclick="VM.modalFinanciamento()" class="btn-primary" style="width:auto;padding:10px 20px;">
          <i class="fas fa-plus"></i> Novo Financiamento
        </button>
      </div>
      <div id="fin-container">
        <div class="empty-state"><div class="skeleton" style="height:200px;border-radius:16px;"></div></div>
      </div>
    `
    this.carregarFinanciamentos()
  },

  async carregarFinanciamentos() {
    try {
      const data = await this.api('GET', 'financiamentos')
      const container = document.getElementById('fin-container')
      const fins = data.financiamentos || []

      if (fins.length === 0) {
        container.innerHTML = `
          <div class="card" style="text-align:center;padding:60px 40px;">
            <div style="font-size:3rem;margin-bottom:16px;">🏠</div>
            <h3 style="margin-bottom:8px;">Nenhum financiamento</h3>
            <p style="color:#666;margin-bottom:24px;">Adicione seus financiamentos imobiliários para acompanhar o progresso</p>
            <button onclick="VM.modalFinanciamento()" class="btn-primary" style="width:auto;padding:10px 24px;">
              <i class="fas fa-plus"></i> Adicionar Financiamento
            </button>
          </div>
        `
        return
      }

      const totalPago = fins.reduce((s, f) => s + (f.valor_financiado - f.saldo_devedor), 0)
      const totalDevedor = fins.reduce((s, f) => s + f.saldo_devedor, 0)

      container.innerHTML = `
        <div class="grid-3" style="margin-bottom:24px;">
          <div class="stat-card"><div class="stat-label" style="margin-bottom:8px;">🏠 Financiamentos</div><div class="stat-value">${fins.length}</div></div>
          <div class="stat-card"><div class="stat-label" style="margin-bottom:8px;">✅ Total Pago</div><div class="stat-value positive">${this.formatMoney(totalPago)}</div></div>
          <div class="stat-card"><div class="stat-label" style="margin-bottom:8px;">💳 Saldo Devedor</div><div class="stat-value negative">${this.formatMoney(totalDevedor)}</div></div>
        </div>
        
        <div style="display:flex;flex-direction:column;gap:16px;">
          ${fins.map(f => {
            const pago = f.valor_financiado - f.saldo_devedor
            const pct = f.valor_financiado > 0 ? Math.round(pago / f.valor_financiado * 100) : 0
            return `
              <div class="card">
                <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:16px;">
                  <div>
                    <div style="font-size:1rem;font-weight:700;">${f.descricao}</div>
                    <div style="font-size:0.8rem;color:#666;margin-top:4px;">
                      ${f.banco || 'Banco não informado'} • ${f.sistema_amortizacao?.toUpperCase() || 'PRICE'} • ${f.taxa_juros_anual}% a.a.
                    </div>
                  </div>
                  <div style="display:flex;gap:6px;align-items:center;">
                    <span class="badge ${f.status === 'ativo' ? 'badge-green' : f.status === 'quitado' ? 'badge-blue' : 'badge-red'}">${f.status}</span>
                    <button onclick="VM.modalFinanciamento(${JSON.stringify(f).replace(/"/g,'&quot;')})" class="btn-success"><i class="fas fa-edit"></i></button>
                    <button onclick="VM.deleteFinanciamento(${f.id})" class="btn-danger"><i class="fas fa-trash"></i></button>
                  </div>
                </div>
                
                <div style="margin-bottom:16px;">
                  <div style="display:flex;justify-content:space-between;margin-bottom:6px;">
                    <span style="font-size:0.8rem;color:#888;">Progresso de quitação</span>
                    <span style="font-size:0.85rem;font-weight:700;color:#2FBF71;">${pct}%</span>
                  </div>
                  <div style="background:rgba(255,255,255,0.08);border-radius:50px;height:8px;overflow:hidden;">
                    <div style="background:linear-gradient(90deg,#2FBF71,#208040);width:${Math.min(pct,100)}%;height:100%;border-radius:50px;"></div>
                  </div>
                </div>
                
                <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;">
                  <div style="background:rgba(255,255,255,0.03);border-radius:10px;padding:10px;text-align:center;">
                    <div style="font-size:0.68rem;color:#666;">Valor Imóvel</div>
                    <div style="font-size:0.82rem;font-weight:700;">${this.formatMoney(f.valor_imovel)}</div>
                  </div>
                  <div style="background:rgba(255,255,255,0.03);border-radius:10px;padding:10px;text-align:center;">
                    <div style="font-size:0.68rem;color:#666;">Parcela</div>
                    <div style="font-size:0.82rem;font-weight:700;color:#ff6b6b;">${this.formatMoney(f.valor_parcela)}</div>
                  </div>
                  <div style="background:rgba(47,191,113,0.07);border-radius:10px;padding:10px;text-align:center;">
                    <div style="font-size:0.68rem;color:#666;">Pagas</div>
                    <div style="font-size:0.82rem;font-weight:700;color:#2FBF71;">${f.parcelas_pagas}/${f.numero_parcelas}</div>
                  </div>
                  <div style="background:rgba(255,80,80,0.07);border-radius:10px;padding:10px;text-align:center;">
                    <div style="font-size:0.68rem;color:#666;">Saldo Devedor</div>
                    <div style="font-size:0.82rem;font-weight:700;color:#ff6b6b;">${this.formatMoney(f.saldo_devedor)}</div>
                  </div>
                </div>
                
                ${f.data_previsao_fim ? `<div style="margin-top:12px;font-size:0.78rem;color:#666;">📅 Previsão de quitação: ${this.formatDate(f.data_previsao_fim)}</div>` : ''}
                ${f.status === 'ativo' && f.parcelas_pagas < f.numero_parcelas ? `
                <div style="margin-top:14px;display:flex;gap:8px;">
                  <button onclick="VM.pagarParcelaFinanciamento(${f.id})" style="flex:1;padding:10px;background:linear-gradient(135deg,#2FBF71,#1a8f4e);color:#fff;border:none;border-radius:10px;cursor:pointer;font-weight:700;font-size:0.88rem;display:flex;align-items:center;justify-content:center;gap:8px;">
                    <i class="fas fa-check-circle"></i> Parcela ${f.parcelas_pagas + 1}/${f.numero_parcelas}
                  </button>
                  <button onclick="VM.modalAmortizacao('financiamento', ${f.id}, ${f.saldo_devedor}, ${f.valor_parcela}, ${f.numero_parcelas}, ${f.parcelas_pagas})" style="padding:10px 14px;background:rgba(255,196,0,0.12);color:#ffc400;border:1px solid rgba(255,196,0,0.3);border-radius:10px;cursor:pointer;font-size:0.82rem;font-weight:600;" title="Amortização/Antecipação">
                    <i class="fas fa-bolt"></i> Amortizar
                  </button>
                </div>` : ''}
              </div>
            `
          }).join('')}
        </div>
      `
    } catch (e) {
      this.toast('Erro ao carregar financiamentos', 'error')
    }
  },

  modalFinanciamento(fin = null) {
    const isEdit = !!fin
    const today = new Date().toISOString().split('T')[0]

    document.getElementById('modal-container').innerHTML = `
      <div class="modal-overlay" onclick="VM.closeModal(event)">
        <div class="modal" style="max-width:560px;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:24px;">
            <h3 style="font-size:1.1rem;font-weight:700;">${isEdit ? '✏️ Editar' : '🏠 Novo'} Financiamento</h3>
            <button onclick="VM.closeModal()" style="background:none;border:none;color:#666;font-size:1.2rem;cursor:pointer;">✕</button>
          </div>
          <form id="fin-form">
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
              <div class="form-group" style="grid-column:1/-1;">
                <label class="form-label">Descrição *</label>
                <input type="text" id="f-desc" class="form-input" placeholder="Ex: Apartamento Centro / Carro / Moto" value="${fin?.descricao || ''}" required>
              </div>
              <div class="form-group">
                <label class="form-label">Tipo de Financiamento *</label>
                <select id="f-tipo-bem" class="form-select">
                  <option value="imovel" ${(fin?.tipo_bem||'imovel')==='imovel'?'selected':''}>🏠 Imóvel Residencial</option>
                  <option value="imovel_comercial" ${fin?.tipo_bem==='imovel_comercial'?'selected':''}>🏢 Imóvel Comercial</option>
                  <option value="veiculo" ${fin?.tipo_bem==='veiculo'?'selected':''}>🚗 Veículo (Carro/Moto)</option>
                  <option value="rural" ${fin?.tipo_bem==='rural'?'selected':''}>🌾 Rural/Terreno</option>
                  <option value="outros" ${fin?.tipo_bem==='outros'?'selected':''}>📋 Outros Bens</option>
                </select>
              </div>
              <div class="form-group">
                <label class="form-label">Valor do Bem (R$) *</label>
                <input type="number" id="f-imovel" class="form-input" step="0.01" min="0" value="${fin?.valor_imovel || ''}" required>
              </div>
              <div class="form-group">
                <label class="form-label">Valor Financiado (R$) *</label>
                <input type="number" id="f-financiado" class="form-input" step="0.01" min="0" value="${fin?.valor_financiado || ''}" required>
              </div>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
              <div class="form-group">
                <label class="form-label">Taxa de Juros Anual (%) *</label>
                <input type="number" id="f-juros" class="form-input" step="0.01" min="0" value="${fin?.taxa_juros_anual || ''}" required>
              </div>
              <div class="form-group">
                <label class="form-label">Nº de Parcelas *</label>
                <input type="number" id="f-parcelas" class="form-input" min="1" value="${fin?.numero_parcelas || ''}" required>
              </div>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
              <div class="form-group">
                <label class="form-label">Valor da Parcela (R$) *</label>
                <input type="number" id="f-vparcela" class="form-input" step="0.01" min="0" value="${fin?.valor_parcela || ''}" required>
              </div>
              <div class="form-group">
                <label class="form-label">Parcelas Pagas</label>
                <input type="number" id="f-pagas" class="form-input" min="0" value="${fin?.parcelas_pagas || 0}">
              </div>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
              <div class="form-group">
                <label class="form-label">Banco</label>
                <input type="text" id="f-banco" class="form-input" placeholder="Ex: Caixa Econômica" value="${fin?.banco || ''}">
              </div>
              <div class="form-group">
                <label class="form-label">Sistema Amortização</label>
                <select id="f-sistema" class="form-select">
                  <option value="price" ${fin?.sistema_amortizacao==='price'?'selected':''}>PRICE (parcela fixa)</option>
                  <option value="sac" ${fin?.sistema_amortizacao==='sac'?'selected':''}>SAC (parcela decrescente)</option>
                  <option value="sacre" ${fin?.sistema_amortizacao==='sacre'?'selected':''}>SACRE</option>
                </select>
              </div>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
              <div class="form-group">
                <label class="form-label">Data Início *</label>
                <input type="date" id="f-inicio" class="form-input" value="${fin?.data_inicio || today}" required>
              </div>
              <div class="form-group">
                <label class="form-label">Saldo Devedor Atual (R$)</label>
                <input type="number" id="f-saldo" class="form-input" step="0.01" min="0" value="${fin?.saldo_devedor || ''}">
              </div>
            </div>
            <div style="display:flex;gap:12px;margin-top:8px;">
              <button type="button" onclick="VM.closeModal()" class="btn-secondary" style="flex:1;justify-content:center;">Cancelar</button>
              <button type="submit" class="btn-primary" style="flex:1;" id="f-submit">
                <i class="fas fa-save"></i> ${isEdit ? 'Salvar' : 'Adicionar'}
              </button>
            </div>
          </form>
        </div>
      </div>
    `

    document.getElementById('fin-form').addEventListener('submit', async (e) => {
      e.preventDefault()
      const btn = document.getElementById('f-submit')
      btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Salvando...'
      try {
        const jurosAnual = parseFloat(document.getElementById('f-juros').value)
        const tipoBem = document.getElementById('f-tipo-bem')?.value || 'imovel'
        const payload = {
          descricao: document.getElementById('f-desc').value,
          tipo_bem: tipoBem,
          tipo_imovel: tipoBem === 'imovel' ? 'residencial' : tipoBem === 'imovel_comercial' ? 'comercial' : tipoBem,
          valor_imovel: parseFloat(document.getElementById('f-imovel').value),
          valor_financiado: parseFloat(document.getElementById('f-financiado').value),
          taxa_juros_anual: jurosAnual,
          taxa_juros_mensal: jurosAnual / 12,
          numero_parcelas: parseInt(document.getElementById('f-parcelas').value),
          valor_parcela: parseFloat(document.getElementById('f-vparcela').value),
          parcelas_pagas: parseInt(document.getElementById('f-pagas').value) || 0,
          banco: document.getElementById('f-banco').value || null,
          sistema_amortizacao: document.getElementById('f-sistema').value,
          data_inicio: document.getElementById('f-inicio').value,
          saldo_devedor: parseFloat(document.getElementById('f-saldo').value) || parseFloat(document.getElementById('f-financiado').value)
        }
        if (isEdit) await this.api('PUT', `financiamentos/${fin.id}`, payload)
        else await this.api('POST', 'financiamentos', payload)
        this.toast(isEdit ? 'Financiamento atualizado!' : 'Financiamento adicionado! 🏠')
        this.closeModal(); this.carregarFinanciamentos()
      } catch (err) {
        this.toast(err.response?.data?.error || 'Erro ao salvar', 'error')
        btn.disabled = false; btn.innerHTML = `<i class="fas fa-save"></i> ${isEdit ? 'Salvar' : 'Adicionar'}`
      }
    })
  },

  modalAmortizacao(tipo, id, saldoAtual, valorParcela, numParcelas, parcelasPagas) {
    const parcelasRestantes = numParcelas - parcelasPagas
    document.getElementById('modal-container').innerHTML = `
      <div class="modal-overlay" onclick="VM.closeModal(event)">
        <div class="modal" style="max-width:480px;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;">
            <div>
              <h3 style="font-size:1.1rem;font-weight:700;">⚡ Amortização Extraordinária</h3>
              <div style="font-size:0.78rem;color:#888;margin-top:2px;">Pagamento extra que reduz o saldo devedor</div>
            </div>
            <button onclick="VM.closeModal()" style="background:none;border:none;color:#666;font-size:1.2rem;cursor:pointer;">✕</button>
          </div>
          
          <div style="background:rgba(255,196,0,0.07);border:1px solid rgba(255,196,0,0.2);border-radius:10px;padding:12px;margin-bottom:20px;font-size:0.8rem;color:#cca800;line-height:1.6;">
            <strong>Como funciona:</strong> O valor amortizado é abatido diretamente do saldo devedor. Você pode escolher entre reduzir o valor da parcela ou antecipar parcelas finais.
          </div>

          <div style="background:rgba(255,255,255,0.03);border-radius:10px;padding:14px;margin-bottom:20px;">
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
              <div style="text-align:center;">
                <div style="font-size:0.72rem;color:#888;">Saldo Devedor Atual</div>
                <div style="font-size:1rem;font-weight:700;color:#ff6b6b;">${this.formatMoney(saldoAtual)}</div>
              </div>
              <div style="text-align:center;">
                <div style="font-size:0.72rem;color:#888;">Parcelas Restantes</div>
                <div style="font-size:1rem;font-weight:700;color:#ffc400;">${parcelasRestantes}</div>
              </div>
            </div>
          </div>

          <form id="amort-form">
            <div class="form-group">
              <label class="form-label">Valor Amortizado (R$) *</label>
              <input type="number" id="amort-valor" class="form-input" step="0.01" min="0.01" max="${saldoAtual}" placeholder="Ex: 5000.00" required>
            </div>
            <div class="form-group">
              <label class="form-label">Parcelas Antecipadas <span style="color:#888;font-size:0.78rem;">(opcional)</span></label>
              <input type="number" id="amort-parcelas" class="form-input" min="0" max="${parcelasRestantes}" placeholder="Quantas parcelas foram antecipadas?" value="0">
              <div style="font-size:0.75rem;color:#888;margin-top:4px;">Se pagou parcelas do final, informe quantas para atualizar o contador</div>
            </div>
            <div class="form-group">
              <label class="form-label">Novo Saldo Devedor (R$) *</label>
              <input type="number" id="amort-novo-saldo" class="form-input" step="0.01" min="0" placeholder="Informe o saldo após a amortização" required>
              <div style="font-size:0.75rem;color:#888;margin-top:4px;">Consulte seu banco para o valor exato do novo saldo</div>
            </div>
            <div class="form-group">
              <label class="form-label">Observações</label>
              <input type="text" id="amort-obs" class="form-input" placeholder="Ex: Amortização com 13º salário">
            </div>
            <div style="display:flex;gap:12px;margin-top:8px;">
              <button type="button" onclick="VM.closeModal()" class="btn-secondary" style="flex:1;justify-content:center;">Cancelar</button>
              <button type="submit" id="amort-submit" class="btn-primary" style="flex:1;background:linear-gradient(135deg,#ffc400,#cc9900);justify-content:center;">
                <i class="fas fa-bolt"></i> Aplicar Amortização
              </button>
            </div>
          </form>
        </div>
      </div>
    `

    document.getElementById('amort-form').addEventListener('submit', async (ev) => {
      ev.preventDefault()
      const btn = document.getElementById('amort-submit')
      btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Aplicando...'
      try {
        const payload = {
          valor_amortizado: parseFloat(document.getElementById('amort-valor').value),
          novo_saldo: parseFloat(document.getElementById('amort-novo-saldo').value),
          parcelas_antecipadas: parseInt(document.getElementById('amort-parcelas').value) || 0,
          observacoes: document.getElementById('amort-obs').value || null
        }
        await this.api('PATCH', `${tipo}s/${id}/amortizacao`, payload)
        this.toast('Amortização registrada! ⚡')
        this.closeModal()
        if (tipo === 'emprestimo') this.carregarEmprestimos()
        else this.carregarFinanciamentos()
      } catch(e) {
        this.toast(e.response?.data?.error || 'Erro ao aplicar amortização', 'error')
        btn.disabled = false; btn.innerHTML = '<i class="fas fa-bolt"></i> Aplicar Amortização'
      }
    })
  },

  async pagarParcelaFinanciamento(id) {
    const ok = await this.vmConfirm('Confirmar o pagamento desta parcela de financiamento?', { titulo: 'Pagar Parcela', corBotao: '#2FBF71', textoBotao: 'Confirmar Pagamento', icone: '💰' })
    if (!ok) return
    try {
      const d = await this.api('PATCH', `financiamentos/${id}/parcela`)
      const msg = d.status === 'quitado'
        ? '🎉 Financiamento quitado! Parabéns!'
        : `✅ Parcela ${d.parcelas_pagas} paga! Saldo: ${this.formatMoney(d.saldo_devedor)}`
      this.toast(msg, 'success')
      this.carregarFinanciamentos()
    } catch (e) {
      this.toast(e.response?.data?.error || 'Erro ao registrar pagamento', 'error')
    }
  },

  async deleteFinanciamento(id) {
    const ok = await this.vmConfirm('Excluir este financiamento? <strong>Todas as parcelas vinculadas também serão removidas.</strong>', { titulo: 'Excluir Financiamento', corBotao: '#ef4444', textoBotao: 'Excluir', icone: '⛔' })
    if (!ok) return
    try {
      await this.api('DELETE', `financiamentos/${id}`)
      this.toast('Financiamento e parcelas excluídos!')
      this.carregarFinanciamentos()
    } catch (e) {
      this.toast('Erro ao excluir', 'error')
    }
  },

  // ============== EMPRÉSTIMOS ==============
  async pageEmprestimos() {
    document.getElementById('page-content').innerHTML = `
      <div class="section-header">
        <div>
          <div class="section-title">💼 Empréstimos</div>
          <div style="color:#666;font-size:0.85rem;margin-top:2px;">Controle suas dívidas e parcelas</div>
        </div>
        <button onclick="VM.modalEmprestimo()" class="btn-primary" style="width:auto;padding:10px 20px;">
          <i class="fas fa-plus"></i> Novo Empréstimo
        </button>
      </div>
      <div id="emp-container">
        <div class="empty-state"><div class="skeleton" style="height:200px;border-radius:16px;"></div></div>
      </div>
    `
    this.carregarEmprestimos()
  },

  async carregarEmprestimos() {
    try {
      const data = await this.api('GET', 'emprestimos')
      const container = document.getElementById('emp-container')
      const emps = data.emprestimos || []
      const tipoLabel = { pessoal: '👤 Pessoal', consignado: '🏢 Consignado', veiculo: '🚗 Veículo', estudantil: '🎓 Estudantil', microempresa: '🏪 Microempresa', amigos_familia: '👨‍👩‍👧 Amigos/Família', outros: '📋 Outros' }

      if (emps.length === 0) {
        container.innerHTML = `
          <div class="card" style="text-align:center;padding:60px 40px;">
            <div style="font-size:3rem;margin-bottom:16px;">🙌</div>
            <h3 style="margin-bottom:8px;">Nenhum empréstimo!</h3>
            <p style="color:#666;margin-bottom:24px;">Ótimo! Sem dívidas ativas. Caso tenha alguma, registre para controlar.</p>
            <button onclick="VM.modalEmprestimo()" class="btn-primary" style="width:auto;padding:10px 24px;">
              <i class="fas fa-plus"></i> Registrar Empréstimo
            </button>
          </div>
        `
        return
      }

      const totalDevedor = emps.reduce((s, e) => s + e.saldo_devedor, 0)

      container.innerHTML = `
        <div class="grid-3" style="margin-bottom:24px;">
          <div class="stat-card"><div class="stat-label" style="margin-bottom:8px;">📋 Empréstimos</div><div class="stat-value">${emps.length}</div></div>
          <div class="stat-card"><div class="stat-label" style="margin-bottom:8px;">💸 Total Devedor</div><div class="stat-value negative">${this.formatMoney(totalDevedor)}</div></div>
          <div class="stat-card"><div class="stat-label" style="margin-bottom:8px;">📅 Parcelas/mês</div><div class="stat-value negative">${this.formatMoney(emps.reduce((s,e)=>s+e.valor_parcela,0))}</div></div>
        </div>
        
        <div style="display:flex;flex-direction:column;gap:16px;">
          ${emps.map(e => {
            const pct = e.valor_original > 0 ? Math.round(e.valor_pago / e.valor_original * 100) : 0
            const statusColors = { ativo: '#2FBF71', quitado: '#74b9ff', em_atraso: '#ff6b6b', negociado: '#ffc400' }
            return `
              <div class="card" style="border-left:4px solid ${statusColors[e.status] || '#444'};">
                <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px;">
                  <div>
                    <div style="font-size:1rem;font-weight:700;">${e.descricao}</div>
                    <div style="font-size:0.78rem;color:#666;margin-top:3px;">
                      ${tipoLabel[e.tipo] || e.tipo} • ${e.credor || 'Credor não informado'} • ${e.taxa_juros_mensal}% a.m.
                    </div>
                  </div>
                  <div style="display:flex;gap:6px;align-items:center;">
                    <span class="badge" style="background:${statusColors[e.status]}22;color:${statusColors[e.status]};border:1px solid ${statusColors[e.status]}44;">${e.status}</span>
                    <button onclick="VM.modalEmprestimo(${JSON.stringify(e).replace(/"/g,'&quot;')})" class="btn-success"><i class="fas fa-edit"></i></button>
                    <button onclick="VM.deleteEmprestimo(${e.id})" class="btn-danger"><i class="fas fa-trash"></i></button>
                  </div>
                </div>
                
                <div style="margin-bottom:12px;">
                  <div style="display:flex;justify-content:space-between;margin-bottom:5px;">
                    <span style="font-size:0.78rem;color:#888;">Pago (${pct}%)</span>
                    <span style="font-size:0.78rem;color:#888;">${e.parcelas_pagas}/${e.numero_parcelas} parcelas</span>
                  </div>
                  <div style="background:rgba(255,255,255,0.08);border-radius:50px;height:6px;overflow:hidden;">
                    <div style="background:#2FBF71;width:${Math.min(pct,100)}%;height:100%;border-radius:50px;"></div>
                  </div>
                </div>
                
                <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;">
                  <div style="background:rgba(255,255,255,0.03);border-radius:10px;padding:10px;text-align:center;">
                    <div style="font-size:0.68rem;color:#666;">Valor Original</div>
                    <div style="font-size:0.82rem;font-weight:700;">${this.formatMoney(e.valor_original)}</div>
                  </div>
                  <div style="background:rgba(255,80,80,0.07);border-radius:10px;padding:10px;text-align:center;">
                    <div style="font-size:0.68rem;color:#666;">Saldo Devedor</div>
                    <div style="font-size:0.82rem;font-weight:700;color:#ff6b6b;">${this.formatMoney(e.saldo_devedor)}</div>
                  </div>
                  <div style="background:rgba(255,80,80,0.07);border-radius:10px;padding:10px;text-align:center;">
                    <div style="font-size:0.68rem;color:#666;">Parcela</div>
                    <div style="font-size:0.82rem;font-weight:700;color:#ff6b6b;">${this.formatMoney(e.valor_parcela)}/mês</div>
                  </div>
                </div>
                ${e.data_previsao_fim ? `<div style="margin-top:10px;font-size:0.78rem;color:#666;">📅 Previsão de quitação: ${this.formatDate(e.data_previsao_fim)}</div>` : ''}
                ${e.status === 'ativo' && e.parcelas_pagas < e.numero_parcelas ? `
                <div style="margin-top:14px;display:flex;gap:8px;">
                  <button onclick="VM.pagarParcelaEmprestimo(${e.id})" style="flex:1;padding:10px;background:linear-gradient(135deg,#2FBF71,#1a8f4e);color:#fff;border:none;border-radius:10px;cursor:pointer;font-weight:700;font-size:0.88rem;display:flex;align-items:center;justify-content:center;gap:8px;">
                    <i class="fas fa-check-circle"></i> Parcela ${e.parcelas_pagas + 1}/${e.numero_parcelas}
                  </button>
                  <button onclick="VM.modalAmortizacao('emprestimo', ${e.id}, ${e.saldo_devedor}, ${e.valor_parcela}, ${e.numero_parcelas}, ${e.parcelas_pagas})" style="padding:10px 14px;background:rgba(255,196,0,0.12);color:#ffc400;border:1px solid rgba(255,196,0,0.3);border-radius:10px;cursor:pointer;font-size:0.82rem;font-weight:600;" title="Amortização/Antecipação">
                    <i class="fas fa-bolt"></i> Amortizar
                  </button>
                </div>` : ''}
              </div>
            `
          }).join('')}
        </div>
      `
    } catch (e) {
      this.toast('Erro ao carregar empréstimos', 'error')
    }
  },

  modalEmprestimo(emp = null) {
    const isEdit = !!emp
    const today = new Date().toISOString().split('T')[0]
    const tipos = [{ v:'pessoal', l:'👤 Pessoal' }, { v:'consignado', l:'🏢 Consignado' }, { v:'veiculo', l:'🚗 Veículo' }, { v:'estudantil', l:'🎓 Estudantil' }, { v:'microempresa', l:'🏪 Microempresa' }, { v:'amigos_familia', l:'👨‍👩‍👧 Amigos/Família' }, { v:'outros', l:'📋 Outros' }]

    document.getElementById('modal-container').innerHTML = `
      <div class="modal-overlay" onclick="VM.closeModal(event)">
        <div class="modal" style="max-width:540px;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:24px;">
            <h3 style="font-size:1.1rem;font-weight:700;">${isEdit ? '✏️ Editar' : '💼 Novo'} Empréstimo</h3>
            <button onclick="VM.closeModal()" style="background:none;border:none;color:#666;font-size:1.2rem;cursor:pointer;">✕</button>
          </div>
          <form id="emp-form">
            <div class="form-group">
              <label class="form-label">Descrição *</label>
              <input type="text" id="e-desc" class="form-input" placeholder="Ex: Empréstimo pessoal Banco X" value="${emp?.descricao || ''}" required>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
              <div class="form-group">
                <label class="form-label">Tipo</label>
                <select id="e-tipo" class="form-select">
                  ${tipos.map(t => `<option value="${t.v}" ${emp?.tipo===t.v?'selected':''}>${t.l}</option>`).join('')}
                </select>
              </div>
              <div class="form-group">
                <label class="form-label">Credor</label>
                <input type="text" id="e-credor" class="form-input" placeholder="Ex: Nubank" value="${emp?.credor || ''}">
              </div>
            </div>
            <!-- Explicação dos campos principais -->
            <div style="background:rgba(47,191,113,0.06);border:1px solid rgba(47,191,113,0.15);border-radius:10px;padding:12px;margin-bottom:16px;font-size:0.8rem;color:#aaa;line-height:1.6;">
              <strong style="color:#2FBF71;">📌 Como preencher:</strong><br>
              • <strong style="color:#fff;">Valor Original:</strong> quanto você pegou emprestado (ex: R$ 10.000)<br>
              • <strong style="color:#fff;">Saldo Devedor Atual:</strong> o quanto você ainda deve <em>com juros acumulados</em> — este valor é usado no Total Devedor do painel. Se não souber, deixe em branco e o sistema calcula automaticamente.<br>
              • <strong style="color:#fff;">Taxa de Juros Mensal:</strong> a taxa do contrato (ex: 2,52% ao mês)<br>
              • <strong style="color:#fff;">Parcelas Pagas:</strong> quantas você já pagou — o sistema recalcula o saldo devedor
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
              <div class="form-group">
                <label class="form-label">💵 Valor Original do Empréstimo (R$) *</label>
                <input type="number" id="e-valor" class="form-input" step="0.01" min="0" value="${emp?.valor_original || ''}"
                  placeholder="Ex: 10000.00" oninput="VM.recalcularSaldoEmprestimo()" required>
                <div style="font-size:0.72rem;color:#888;margin-top:3px;">Valor que você recebeu/pegou emprestado</div>
              </div>
              <div class="form-group">
                <label class="form-label">📉 Saldo Devedor Atual (R$) <span style="color:#888;font-weight:400;">(com juros)</span></label>
                <input type="number" id="e-saldo" class="form-input" step="0.01" min="0" value="${emp?.saldo_devedor || ''}"
                  placeholder="Calculado automaticamente">
                <div style="font-size:0.72rem;color:#888;margin-top:3px;">Usado no Total Devedor do painel</div>
              </div>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
              <div class="form-group">
                <label class="form-label">📊 Taxa de Juros Mensal (%) *</label>
                <input type="number" id="e-juros" class="form-input" step="0.01" min="0" value="${emp?.taxa_juros_mensal || ''}"
                  placeholder="Ex: 2.52" oninput="VM.recalcularSaldoEmprestimo()" required>
                <div style="font-size:0.72rem;color:#888;margin-top:3px;">Taxa do contrato ao mês</div>
              </div>
              <div class="form-group">
                <label class="form-label">🔢 Nº Total de Parcelas *</label>
                <input type="number" id="e-nparcelas" class="form-input" min="1" value="${emp?.numero_parcelas || ''}"
                  placeholder="Ex: 24" oninput="VM.recalcularSaldoEmprestimo()" required>
              </div>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
              <div class="form-group">
                <label class="form-label">💳 Valor da Parcela Mensal (R$) *</label>
                <input type="number" id="e-vparcela" class="form-input" step="0.01" min="0" value="${emp?.valor_parcela || ''}"
                  placeholder="Ex: 500.00" required>
                <div style="font-size:0.72rem;color:#888;margin-top:3px;">Valor que você paga por mês</div>
              </div>
              <div class="form-group">
                <label class="form-label">✅ Parcelas Já Pagas</label>
                <input type="number" id="e-pagas" class="form-input" min="0" value="${emp?.parcelas_pagas || 0}"
                  oninput="VM.recalcularSaldoEmprestimo()">
                <div id="e-saldo-preview" style="font-size:0.72rem;color:#2FBF71;margin-top:3px;"></div>
              </div>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
              <div class="form-group">
                <label class="form-label">Data Início (Contratação) *</label>
                <input type="date" id="e-inicio" class="form-input" value="${emp?.data_inicio || today}" required>
              </div>
              <div class="form-group">
                <label class="form-label">Dia Vencimento</label>
                <input type="number" id="e-dia" class="form-input" min="1" max="31" value="${emp?.dia_vencimento || ''}">
              </div>
            </div>
            <div class="form-group">
              <label class="form-label">Data 1ª Parcela <span style="color:#888;font-size:0.78rem;">(opcional — use se o vencimento for diferente do mês da contratação)</span></label>
              <input type="date" id="e-primeira-parcela" class="form-input" value="${emp?.data_primeira_parcela || ''}">
              <div style="font-size:0.75rem;color:#888;margin-top:4px;">Ex: contratado em Jan/2026, 1ª parcela em Mar/2026 → preencha 26/03/2026</div>
            </div>
            <div style="display:flex;gap:12px;margin-top:8px;">
              <button type="button" onclick="VM.closeModal()" class="btn-secondary" style="flex:1;justify-content:center;">Cancelar</button>
              <button type="submit" class="btn-primary" style="flex:1;" id="e-submit">
                <i class="fas fa-save"></i> ${isEdit ? 'Salvar' : 'Adicionar'}
              </button>
            </div>
          </form>
        </div>
      </div>
    `

    document.getElementById('emp-form').addEventListener('submit', async (e) => {
      e.preventDefault()
      const btn = document.getElementById('e-submit')
      btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Salvando...'
      try {
        const jurosMensal = parseFloat(document.getElementById('e-juros').value)
        const payload = {
          descricao: document.getElementById('e-desc').value,
          tipo: document.getElementById('e-tipo').value,
          credor: document.getElementById('e-credor').value || null,
          valor_original: parseFloat(document.getElementById('e-valor').value),
          saldo_devedor: parseFloat(document.getElementById('e-saldo').value) || parseFloat(document.getElementById('e-valor').value),
          taxa_juros_mensal: jurosMensal,
          taxa_juros_anual: jurosMensal * 12,
          numero_parcelas: parseInt(document.getElementById('e-nparcelas').value),
          valor_parcela: parseFloat(document.getElementById('e-vparcela').value),
          parcelas_pagas: parseInt(document.getElementById('e-pagas').value) || 0,
          data_inicio: document.getElementById('e-inicio').value,
          dia_vencimento: parseInt(document.getElementById('e-dia').value) || null,
          data_primeira_parcela: document.getElementById('e-primeira-parcela')?.value || null
        }
        if (isEdit) await this.api('PUT', `emprestimos/${emp.id}`, payload)
        else await this.api('POST', 'emprestimos', payload)
        this.toast(isEdit ? 'Empréstimo atualizado!' : 'Empréstimo registrado!')
        this.closeModal(); this.carregarEmprestimos()
      } catch (err) {
        this.toast(err.response?.data?.error || 'Erro ao salvar', 'error')
        btn.disabled = false; btn.innerHTML = `<i class="fas fa-save"></i> ${isEdit ? 'Salvar' : 'Adicionar'}`
      }
    })
  },

  async pagarParcelaEmprestimo(id) {
    const ok = await this.vmConfirm('Confirmar o pagamento desta parcela de empréstimo?', { titulo: 'Pagar Parcela', corBotao: '#2FBF71', textoBotao: 'Confirmar Pagamento', icone: '💰' })
    if (!ok) return
    try {
      const d = await this.api('PATCH', `emprestimos/${id}/parcela`)
      const msg = d.status === 'quitado'
        ? '🎉 Empréstimo quitado! Parabéns!'
        : `✅ Parcela ${d.parcelas_pagas} paga! Saldo: ${this.formatMoney(d.saldo_devedor)}`
      this.toast(msg, 'success')
      this.carregarEmprestimos()
    } catch (e) {
      this.toast(e.response?.data?.error || 'Erro ao registrar pagamento', 'error')
    }
  },

  async deleteEmprestimo(id) {
    const ok = await this.vmConfirm('Excluir este empréstimo? <strong>Todas as parcelas vinculadas também serão removidas.</strong>', { titulo: 'Excluir Empréstimo', corBotao: '#ef4444', textoBotao: 'Excluir', icone: '⛔' })
    if (!ok) return
    try {
      await this.api('DELETE', `emprestimos/${id}`)
      this.toast('Empréstimo e parcelas excluídos!')
      this.carregarEmprestimos()
    } catch (e) {
      this.toast('Erro ao excluir', 'error')
    }
  },

  // ============== IA ==============
  async pageIA() {
    document.getElementById('page-content').innerHTML = `
      <div class="section-header">
        <div>
          <div class="section-title">🧠 Diagnóstico Financeiro 360°</div>
          <div style="color:#666;font-size:0.85rem;margin-top:2px;">Análise completa baseada em 5 módulos • Hierarquia CFP®</div>
        </div>
        <button onclick="VM.gerarInsightsIA()" class="btn-primary" style="width:auto;padding:10px 20px;">
          <i class="fas fa-robot" style="margin-right:6px;"></i>Gerar Insights com IA
        </button>
      </div>
      <div id="ia-insights-container" style="margin-bottom:16px;"></div>
      <div id="ia-container">
        <div style="display:flex;flex-direction:column;gap:16px;">
          ${[1,2,3].map(() => `<div class="skeleton" style="height:120px;border-radius:16px;"></div>`).join('')}
        </div>
      </div>
    `
    this.carregarIA()
  },

  async carregarIA() {
    const container = document.getElementById('ia-container')
    try {
      const d = await this.api('GET', 'ia/insights')

      // ── SCORE TEASER para plano Free ──────────────────────────────────────
      if (d.teaser) {
        const sc = d.score_teaser || 0
        const cor = sc >= 80 ? '#2FBF71' : sc >= 55 ? '#74b9ff' : sc >= 35 ? '#ffc400' : '#ff6b6b'
        const circum = 2 * Math.PI * 48
        const offset = circum * (1 - sc / 100)
        container.innerHTML = `
          <div class="card" style="margin-bottom:20px;background:linear-gradient(135deg,rgba(47,191,113,0.06),rgba(32,128,64,0.03));border:1px solid rgba(47,191,113,0.15);">
            <div style="display:flex;align-items:center;gap:28px;flex-wrap:wrap;">
              <!-- Score borrado com overlay -->
              <div style="position:relative;width:110px;height:110px;flex-shrink:0;">
                <svg viewBox="0 0 110 110" style="transform:rotate(-90deg);width:110px;height:110px;filter:blur(2px);">
                  <circle cx="55" cy="55" r="48" fill="none" stroke="rgba(255,255,255,0.07)" stroke-width="9"/>
                  <circle cx="55" cy="55" r="48" fill="none" stroke="${cor}" stroke-width="9"
                    stroke-dasharray="${circum}" stroke-dashoffset="${offset}" stroke-linecap="round"/>
                </svg>
                <div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;">
                  <div style="font-size:1.75rem;font-weight:900;color:${cor};line-height:1;filter:blur(4px);">${sc}</div>
                  <div style="font-size:0.6rem;color:#555;letter-spacing:1px;">/ 100</div>
                </div>
                <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;">
                  <i class="fas fa-lock" style="font-size:1.4rem;color:#fbbf24;filter:drop-shadow(0 0 6px rgba(251,191,36,0.5));"></i>
                </div>
              </div>
              <div style="flex:1;min-width:200px;">
                <div style="font-size:1.1rem;font-weight:800;color:${cor};margin-bottom:8px;">${d.veredicto}</div>
                <div style="font-size:0.88rem;color:#aaa;line-height:1.6;margin-bottom:16px;">${d.mensagem}</div>
                <button onclick="VM.upsellModal('ia_insights')" style="padding:10px 24px;background:linear-gradient(135deg,#2FBF71,#059669);color:#fff;border:none;border-radius:10px;font-size:0.9rem;font-weight:700;cursor:pointer;display:flex;align-items:center;gap:8px;">
                  <i class="fas fa-unlock"></i> Desbloquear Análise Completa
                </button>
              </div>
            </div>
          </div>
          <!-- Cards bloqueados com blur -->
          <div style="position:relative;">
            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;filter:blur(6px);pointer-events:none;user-select:none;opacity:0.5;">
              ${['Fluxo de Caixa','Reserva','Dívidas','Investimentos','Metas'].map(m => `
                <div class="card" style="text-align:center;padding:20px 12px;">
                  <div style="font-size:2rem;font-weight:900;color:#2FBF71;">??</div>
                  <div style="font-size:0.78rem;color:#888;margin-top:4px;">${m}</div>
                </div>`).join('')}
            </div>
            <div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;">
              <i class="fas fa-lock" style="font-size:2rem;color:#fbbf24;"></i>
              <div style="font-size:0.9rem;font-weight:700;color:#fff;">Desbloqueie com o Premium</div>
              <button onclick="VM.upsellModal('ia_insights')" style="padding:8px 20px;background:rgba(47,191,113,0.2);color:#2FBF71;border:1px solid rgba(47,191,113,0.4);border-radius:8px;font-size:0.85rem;font-weight:700;cursor:pointer;">
                Ver planos <i class="fas fa-arrow-right"></i>
              </button>
            </div>
          </div>
          <!-- Histórico de score (pode mostrar mesmo no free) -->
          <div id="ia-score-historico-container"></div>
        `
        this._carregarScoreHistorico()
        return
      }

      // Atalhos para os blocos principais
      const re   = d.resumo_executivo  || {}
      const sc   = d.scores            || {}
      const kp   = d.kpis              || {}
      const ac   = d.alertas_criticos  || []
      const am   = d.analise_modular   || {}
      const pa   = d.plano_acao        || []
      const sg   = d.sugestoes         || {}

      const scoreGeral = sc.geral || 50
      const corScore   = scoreGeral >= 80 ? '#2FBF71' : scoreGeral >= 55 ? '#74b9ff' : scoreGeral >= 35 ? '#ffc400' : '#ff6b6b'
      const circum     = 2 * Math.PI * 48
      const offset     = circum * (1 - scoreGeral / 100)

      // ── helpers inline ──────────────────────────────────────────────────
      const fmtM = v => this.formatMoney(v || 0)
      const corSt = st => ({ EXCELENTE:'#2FBF71', BOM:'#74b9ff', ATENCAO:'#ffc400', CRITICO:'#ff6b6b' }[st] || '#888')
      const badgeSt = st => {
        const cfg = { EXCELENTE:['#2FBF71','Excelente ✅'], BOM:['#74b9ff','Bom 👍'], ATENCAO:['#ffc400','Atenção ⚠️'], CRITICO:['#ff6b6b','Crítico 🔴'] }
        const [cor, txt] = cfg[st] || ['#888','—']
        return `<span style="font-size:0.7rem;font-weight:700;padding:3px 8px;border-radius:20px;background:${cor}22;color:${cor};border:1px solid ${cor}44;">${txt}</span>`
      }
      const miniScore = (val, cor) => {
        const c2 = 2*Math.PI*16; const o2 = c2*(1-val/100)
        return `<svg width="40" height="40" viewBox="0 0 40 40" style="transform:rotate(-90deg)">
          <circle cx="20" cy="20" r="16" fill="none" stroke="rgba(255,255,255,0.08)" stroke-width="4"/>
          <circle cx="20" cy="20" r="16" fill="none" stroke="${cor}" stroke-width="4"
            stroke-dasharray="${c2}" stroke-dashoffset="${o2}" stroke-linecap="round"/>
        </svg>`
      }

      // ── Módulos de análise ────────────────────────────────────────────
      const modulos = [
        { key:'fluxo_caixa',        icon:'💰', label:'Fluxo de Caixa',       hierarquia:'Sobrevivência' },
        { key:'reserva_emergencia', icon:'🛡️', label:'Reserva de Emergência', hierarquia:'Segurança' },
        { key:'dividas',            icon:'💳', label:'Dívidas',               hierarquia:'Quitação de Dívidas' },
        { key:'investimentos',      icon:'📈', label:'Investimentos',         hierarquia:'Acumulação' },
        { key:'metas',              icon:'🎯', label:'Metas Financeiras',     hierarquia:'Realização' }
      ]

      // ── 50/30/20 ─────────────────────────────────────────────────────
      const r5030 = sg.regra_503020
      const receita = kp.receita_mes || 0
      const despesa = kp.despesa_mes || 0
      const poupPct  = receita > 0 ? ((receita - despesa) / receita * 100) : 0
      const necPct   = receita > 0 ? Math.min(100, despesa / receita * 70) : 0
      const desPct   = receita > 0 ? Math.min(100, despesa / receita * 30) : 0

      container.innerHTML = `

        <!-- ═══ CARD 1 — RESUMO EXECUTIVO + SCORE ═══ -->
        <div class="card" style="margin-bottom:20px;background:linear-gradient(135deg,rgba(47,191,113,0.07),rgba(32,128,64,0.04));border:1px solid rgba(47,191,113,0.18);">
          <div style="display:flex;align-items:center;gap:28px;flex-wrap:wrap;">

            <!-- círculo score -->
            <div style="position:relative;width:110px;height:110px;flex-shrink:0;">
              <svg viewBox="0 0 110 110" style="transform:rotate(-90deg);width:110px;height:110px;">
                <circle cx="55" cy="55" r="48" fill="none" stroke="rgba(255,255,255,0.07)" stroke-width="9"/>
                <circle cx="55" cy="55" r="48" fill="none" stroke="${corScore}" stroke-width="9"
                  stroke-dasharray="${circum}" stroke-dashoffset="${offset}" stroke-linecap="round"
                  style="transition:stroke-dashoffset 1s ease"/>
              </svg>
              <div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;">
                <div style="font-size:1.75rem;font-weight:900;color:${corScore};line-height:1;">${scoreGeral}</div>
                <div style="font-size:0.6rem;color:#555;letter-spacing:1px;">/ 100</div>
              </div>
            </div>

            <!-- texto direito -->
            <div style="flex:1;min-width:200px;">
              <div style="font-size:1.15rem;font-weight:800;color:${corScore};margin-bottom:6px;">${re.veredicto || '—'}</div>
              <div style="font-size:0.82rem;color:#888;line-height:1.6;margin-bottom:12px;">
                Próxima ação prioritária: <strong style="color:#ddd;">${re.proxima_acao || '—'}</strong>
              </div>
              <!-- mini KPIs -->
              <div style="display:flex;gap:20px;flex-wrap:wrap;font-size:0.8rem;">
                <span>💰 <strong style="color:#2FBF71;">${fmtM(kp.receita_mes)}</strong></span>
                <span>💸 <strong style="color:#ff6b6b;">${fmtM(kp.despesa_mes)}</strong></span>
                <span>💹 Saldo <strong style="color:${(kp.saldo_mes||0)>=0?'#2FBF71':'#ff6b6b'};">${fmtM(kp.saldo_mes)}</strong></span>
                <span>📊 Poupar <strong style="color:#74b9ff;">${(kp.taxa_poupanca_pct||0).toFixed(1)}%</strong></span>
              </div>
            </div>

          </div>

          <!-- mini scores dos 5 módulos -->
          <div style="margin-top:20px;padding-top:16px;border-top:1px solid rgba(255,255,255,0.06);
                      display:grid;grid-template-columns:repeat(5,1fr);gap:8px;text-align:center;">
            ${modulos.map(m => {
              const mod  = am[m.key] || {}
              const val  = mod.score || 0
              const cor  = corSt(mod.status || 'CRITICO')
              return `
                <div style="display:flex;flex-direction:column;align-items:center;gap:4px;">
                  ${miniScore(val, cor)}
                  <div style="font-size:0.65rem;color:#666;line-height:1.3;">${m.icon}<br>${m.label.split(' ')[0]}</div>
                  <div style="font-size:0.7rem;font-weight:700;color:${cor};">${val}</div>
                </div>`
            }).join('')}
          </div>
        </div>

        <!-- ═══ CARD 2 — ALERTAS CRÍTICOS ═══ -->
        ${ac.length > 0 ? `
        <div class="card" style="margin-bottom:20px;border:1px solid rgba(255,107,107,0.3);background:rgba(255,60,60,0.04);">
          <div style="font-size:0.95rem;font-weight:700;color:#ff6b6b;margin-bottom:14px;display:flex;align-items:center;gap:8px;">
            🚨 Alertas Críticos
            <span style="font-size:0.7rem;background:rgba(255,107,107,0.2);color:#ff6b6b;padding:2px 8px;border-radius:20px;">${ac.length} ${ac.length===1?'alerta':'alertas'}</span>
          </div>
          <div style="display:flex;flex-direction:column;gap:12px;">
            ${ac.map(a => {
              const sevCor = a.severidade === 'CRITICO' ? '#ff6b6b' : '#ffc400'
              return `
                <div style="padding:14px;background:rgba(255,255,255,0.03);border-radius:12px;border-left:4px solid ${sevCor};">
                  <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
                    <span style="font-size:0.75rem;font-weight:700;color:${sevCor};background:${sevCor}22;padding:2px 8px;border-radius:20px;">${a.severidade}</span>
                    <div style="font-weight:700;font-size:0.9rem;">${a.titulo}</div>
                  </div>
                  <div style="font-size:0.8rem;color:#999;line-height:1.6;margin-bottom:8px;">${a.descricao}</div>
                  <div style="font-size:0.78rem;color:#2FBF71;padding:8px 12px;background:rgba(47,191,113,0.06);border-radius:8px;">
                    <strong>✅ Ação:</strong> ${a.acao}
                  </div>
                  ${a.impacto ? `<div style="font-size:0.73rem;color:#555;margin-top:6px;">💡 ${a.impacto}</div>` : ''}
                </div>`
            }).join('')}
          </div>
        </div>
        ` : `
        <div class="card" style="margin-bottom:20px;border:1px solid rgba(47,191,113,0.2);background:rgba(47,191,113,0.04);padding:16px 20px;">
          <div style="display:flex;align-items:center;gap:12px;color:#2FBF71;">
            <span style="font-size:1.5rem;">✅</span>
            <div>
              <div style="font-weight:700;font-size:0.9rem;">Nenhum alerta crítico</div>
              <div style="font-size:0.78rem;color:#666;">Seus dados não apontam conflitos financeiros graves no momento.</div>
            </div>
          </div>
        </div>
        `}

        <!-- ═══ CARD 3 — ANÁLISE MODULAR (5 módulos expansíveis) ═══ -->
        <div class="card" style="margin-bottom:20px;">
          <div style="font-size:0.95rem;font-weight:700;margin-bottom:16px;">🔬 Análise por Módulo — Hierarquia CFP®</div>
          <div style="display:flex;flex-direction:column;gap:10px;">
            ${modulos.map((m, idx) => {
              const mod  = am[m.key] || {}
              const cor  = corSt(mod.status || 'CRITICO')
              const val  = mod.score || 0
              const dados= mod.dados || {}
              const id   = `mod-detail-${idx}`
              return `
                <div style="border:1px solid rgba(255,255,255,0.07);border-radius:12px;overflow:hidden;">
                  <!-- cabeçalho clicável -->
                  <div onclick="document.getElementById('${id}').style.display === 'none' ? document.getElementById('${id}').style.display='block' : document.getElementById('${id}').style.display='none'"
                       style="display:flex;align-items:center;gap:14px;padding:14px 16px;cursor:pointer;background:rgba(255,255,255,0.02);user-select:none;">
                    <div style="width:36px;height:36px;border-radius:10px;background:${cor}22;display:flex;align-items:center;justify-content:center;font-size:1rem;flex-shrink:0;">${m.icon}</div>
                    <div style="flex:1;">
                      <div style="font-size:0.6rem;color:#555;letter-spacing:1px;text-transform:uppercase;">${m.hierarquia}</div>
                      <div style="font-weight:700;font-size:0.88rem;">${m.label}</div>
                    </div>
                    ${badgeSt(mod.status || 'CRITICO')}
                    <div style="display:flex;flex-direction:column;align-items:center;margin-left:8px;">
                      <div style="font-size:1.1rem;font-weight:800;color:${cor};">${val}</div>
                      <div style="font-size:0.6rem;color:#555;">/100</div>
                    </div>
                    <!-- barra de progresso compacta -->
                    <div style="width:60px;height:6px;background:rgba(255,255,255,0.08);border-radius:3px;overflow:hidden;flex-shrink:0;">
                      <div style="height:100%;width:${val}%;background:${cor};border-radius:3px;transition:width 0.8s ease;"></div>
                    </div>
                    <i class="fas fa-chevron-down" style="color:#555;font-size:0.75rem;margin-left:4px;"></i>
                  </div>
                  <!-- detalhe (oculto por padrão) -->
                  <div id="${id}" style="display:none;padding:14px 16px;border-top:1px solid rgba(255,255,255,0.05);background:rgba(0,0,0,0.15);">
                    <div style="font-size:0.82rem;color:#aaa;line-height:1.7;margin-bottom:10px;">${mod.mensagem || '—'}</div>
                    <div style="font-size:0.8rem;padding:10px 14px;background:rgba(47,191,113,0.06);border-left:3px solid #2FBF71;border-radius:0 8px 8px 0;color:#ccc;line-height:1.6;margin-bottom:10px;">
                      <strong style="color:#2FBF71;">Recomendação:</strong> ${mod.recomendacao || '—'}
                    </div>
                    ${m.key === 'fluxo_caixa' && dados.top_categorias ? `
                      <div style="margin-top:8px;">
                        <div style="font-size:0.72rem;color:#555;margin-bottom:8px;text-transform:uppercase;letter-spacing:1px;">Top categorias</div>
                        ${dados.top_categorias.slice(0,4).map(c => `
                          <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px;">
                            <div style="font-size:0.78rem;color:#aaa;width:100px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${c.nome}</div>
                            <div style="flex:1;height:6px;background:rgba(255,255,255,0.06);border-radius:3px;overflow:hidden;">
                              <div style="height:100%;width:${Math.min(100,c.pct)}%;background:#ff6b6b;border-radius:3px;"></div>
                            </div>
                            <div style="font-size:0.75rem;color:#888;width:60px;text-align:right;">${fmtM(c.valor)}</div>
                          </div>`).join('')}
                      </div>` : ''}
                    ${m.key === 'reserva_emergencia' ? `
                      <div style="display:flex;gap:16px;flex-wrap:wrap;font-size:0.78rem;color:#888;margin-top:4px;">
                        <span>💰 Atual: <strong style="color:#ddd;">${fmtM(dados.valor_atual)}</strong></span>
                        <span>🎯 Ideal: <strong style="color:#ddd;">${fmtM(dados.valor_ideal)}</strong></span>
                        <span>📅 Cobertura: <strong style="color:${(dados.meses_cobertos||0)>=3?'#2FBF71':'#ffc400'};">${(dados.meses_cobertos||0).toFixed(1)} meses</strong></span>
                      </div>` : ''}
                    ${m.key === 'dividas' ? `
                      <div style="display:flex;gap:16px;flex-wrap:wrap;font-size:0.78rem;color:#888;margin-top:4px;">
                        <span>📊 Comprometimento: <strong style="color:${(dados.comprometimento_pct||0)>30?'#ff6b6b':'#2FBF71'};">${(dados.comprometimento_pct||0).toFixed(1)}%</strong></span>
                        <span>💸 Parcela/mês: <strong style="color:#ddd;">${fmtM(dados.parcela_mensal)}</strong></span>
                        ${dados.taxa_max_aa > 0 ? `<span>📈 Taxa máx: <strong style="color:#ffc400;">${dados.taxa_max_aa}% a.a.</strong></span>` : ''}
                      </div>` : ''}
                    ${m.key === 'investimentos' ? `
                      <div style="display:flex;gap:16px;flex-wrap:wrap;font-size:0.78rem;color:#888;margin-top:4px;">
                        <span>💼 Carteira: <strong style="color:#ddd;">${fmtM(dados.total_atual)}</strong></span>
                        <span>📊 Rentab.: <strong style="color:${(dados.rentab_pct||0)>=0?'#2FBF71':'#ff6b6b'};">${(dados.rentab_pct||0).toFixed(2)}%</strong></span>
                        <span>👤 Perfil: <strong style="color:#74b9ff;">${dados.perfil || '—'}</strong></span>
                      </div>` : ''}
                    ${m.key === 'metas' && dados.lista && dados.lista.length > 0 ? `
                      <div style="margin-top:8px;">
                        ${dados.lista.map(mt => `
                          <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px;">
                            <div style="font-size:0.78rem;color:#aaa;flex:1;">${mt.nome}</div>
                            <div style="width:80px;height:5px;background:rgba(255,255,255,0.06);border-radius:3px;overflow:hidden;">
                              <div style="height:100%;width:${Math.min(100,mt.progresso_pct)}%;background:#74b9ff;border-radius:3px;"></div>
                            </div>
                            <div style="font-size:0.72rem;color:#888;">${mt.progresso_pct.toFixed(0)}%</div>
                          </div>`).join('')}
                      </div>` : ''}
                  </div>
                </div>`
            }).join('')}
          </div>
        </div>

        <!-- ═══ CARD 4b — ASSINATURAS ═══ -->
        ${(() => {
          const as = d.assinaturas_resumo
          if (!as || (as.total_ativas + as.total_reduzidas + as.total_canceladas) === 0) return ''
          const fmtAS = v => (v||0).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2})
          return `
        <div class="card" style="margin-bottom:20px;background:linear-gradient(135deg,rgba(139,92,246,0.05),rgba(245,158,11,0.04));border:1px solid rgba(139,92,246,0.18);">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:8px;">
            <div style="font-size:0.95rem;font-weight:700;">👻 Assinaturas Detectadas</div>
            <button onclick="VM.navigate('assinaturas-fantasma')" style="background:rgba(139,92,246,0.15);color:#A78BFA;border:1px solid rgba(139,92,246,0.3);padding:5px 12px;border-radius:8px;font-size:0.75rem;font-weight:700;cursor:pointer;">Ver detalhes →</button>
          </div>
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;margin-bottom:16px;">
            <div style="background:rgba(244,63,94,0.08);border:1px solid rgba(244,63,94,0.15);border-radius:12px;padding:12px;text-align:center;">
              <div style="font-size:0.65rem;color:#FDA4AF;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;">Custo Mensal</div>
              <div style="font-size:1.1rem;font-weight:800;color:#F43F5E;font-family:'JetBrains Mono',monospace;">R$ ${fmtAS(as.custo_mensal_ativo)}</div>
              <div style="font-size:0.65rem;color:#64748B;">${as.total_ativas} ativa(s)</div>
            </div>
            ${as.total_reduzidas > 0 ? `
            <div style="background:rgba(245,158,11,0.08);border:1px solid rgba(245,158,11,0.2);border-radius:12px;padding:12px;text-align:center;">
              <div style="font-size:0.65rem;color:#FDE68A;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;">Economia/mês (Redução)</div>
              <div style="font-size:1.1rem;font-weight:800;color:#F59E0B;font-family:'JetBrains Mono',monospace;">R$ ${fmtAS(as.economia_mensal_reducoes)}</div>
              <div style="font-size:0.65rem;color:#64748B;">${as.total_reduzidas} reduzida(s)</div>
            </div>` : ''}
            ${as.total_canceladas > 0 ? `
            <div style="background:rgba(16,185,129,0.08);border:1px solid rgba(16,185,129,0.18);border-radius:12px;padding:12px;text-align:center;">
              <div style="font-size:0.65rem;color:#6EE7B7;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;">Economia/mês (Canceladas)</div>
              <div style="font-size:1.1rem;font-weight:800;color:#10B981;font-family:'JetBrains Mono',monospace;">R$ ${fmtAS(as.economia_mensal_cancelamentos)}</div>
              <div style="font-size:0.65rem;color:#64748B;">${as.total_canceladas} cancelada(s)</div>
            </div>` : ''}
            <div style="background:rgba(16,185,129,0.06);border:1px solid rgba(16,185,129,0.15);border-radius:12px;padding:12px;text-align:center;">
              <div style="font-size:0.65rem;color:#6EE7B7;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;">🏆 Economia Acumulada</div>
              <div style="font-size:1.1rem;font-weight:800;color:#10B981;font-family:'JetBrains Mono',monospace;">R$ ${fmtAS(as.economia_acumulada_reducoes)}</div>
              <div style="font-size:0.65rem;color:#64748B;">reduções de plano</div>
            </div>
          </div>
          ${as.top_3 && as.top_3.length > 0 ? `
          <div>
            <div style="font-size:0.72rem;color:#64748B;font-weight:600;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;">Top Assinaturas Ativas</div>
            ${as.top_3.map((s, i) => `
            <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 10px;background:rgba(255,255,255,0.02);border-radius:8px;margin-bottom:4px;">
              <span style="font-size:0.8rem;color:#94A3B8;">${['🥇','🥈','🥉'][i]||'📌'} ${s.nome}</span>
              <span style="font-size:0.8rem;font-weight:700;color:#F43F5E;font-family:'JetBrains Mono',monospace;">R$ ${fmtAS(s.valor)}/mês</span>
            </div>`).join('')}
          </div>` : ''}
        </div>`
        })()}

        <!-- ═══ CARD 4 — PLANO DE AÇÃO 90 DIAS ═══ -->
        ${pa.length > 0 ? `
        <div class="card" style="margin-bottom:20px;">
          <div style="font-size:0.95rem;font-weight:700;margin-bottom:16px;">🗓️ Plano de Ação — 90 Dias</div>
          <div style="display:flex;flex-direction:column;gap:14px;">
            ${pa.map(p => {
              const hierCor = p.hierarquia.includes('Sobreviv') ? '#ff6b6b'
                : p.hierarquia.includes('Segur')   ? '#ffc400'
                : p.hierarquia.includes('Dívid')   ? '#fd79a8'
                : p.hierarquia.includes('Acumul')  ? '#74b9ff'
                : '#2FBF71'
              return `
                <div style="border:1px solid rgba(255,255,255,0.07);border-radius:12px;overflow:hidden;">
                  <div style="display:flex;align-items:center;gap:12px;padding:12px 14px;background:rgba(255,255,255,0.02);">
                    <div style="width:28px;height:28px;border-radius:8px;background:${hierCor}33;color:${hierCor};display:flex;align-items:center;justify-content:center;font-size:0.8rem;font-weight:800;flex-shrink:0;">${p.prioridade}</div>
                    <div style="flex:1;">
                      <div style="font-size:0.6rem;color:${hierCor};font-weight:600;text-transform:uppercase;letter-spacing:1px;">${p.hierarquia}</div>
                      <div style="font-weight:700;font-size:0.88rem;">${p.titulo}</div>
                    </div>
                    <div style="font-size:0.7rem;color:#555;white-space:nowrap;">⏱️ ${p.prazo}</div>
                  </div>
                  <div style="padding:12px 14px 14px;background:rgba(0,0,0,0.1);">
                    <div style="display:flex;flex-direction:column;gap:6px;margin-bottom:10px;">
                      ${p.passos.map((ps, i) => `
                        <div style="display:flex;align-items:flex-start;gap:10px;font-size:0.8rem;color:#aaa;">
                          <span style="width:18px;height:18px;background:rgba(255,255,255,0.06);border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:0.65rem;font-weight:700;flex-shrink:0;margin-top:1px;">${i+1}</span>
                          <span style="line-height:1.5;">${ps}</span>
                        </div>`).join('')}
                    </div>
                    ${p.impacto ? `<div style="font-size:0.73rem;color:#2FBF71;padding:7px 12px;background:rgba(47,191,113,0.06);border-radius:7px;">💡 ${p.impacto}</div>` : ''}
                  </div>
                </div>`
            }).join('')}
          </div>
        </div>
        ` : ''}

        <!-- ═══ CARD 5 — 50/30/20 + SUGESTÕES ═══ -->
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:20px;">

          <!-- 50/30/20 -->
          <div class="card">
            <div style="font-weight:700;font-size:0.9rem;margin-bottom:14px;">📐 Regra 50/30/20</div>
            <div style="color:#666;font-size:0.72rem;margin-bottom:14px;">Ideal: 50% necessidades • 30% desejos • 20% poupança</div>
            ${r5030 ? `
              <div style="display:flex;flex-direction:column;gap:10px;">
                ${[
                  { l:'🏠 Necessidades', ideal:50, v:necPct,   cor:'#74b9ff', meta:r5030.necessidades_ideal },
                  { l:'🎬 Desejos',      ideal:30, v:desPct,   cor:'#a29bfe', meta:r5030.desejos_ideal },
                  { l:'💰 Poupança',     ideal:20, v:poupPct,  cor:'#2FBF71', meta:r5030.investimentos_ideal }
                ].map(item => {
                  const ok = Math.abs(item.v - item.ideal) <= 10
                  return `
                    <div>
                      <div style="display:flex;justify-content:space-between;font-size:0.78rem;margin-bottom:4px;">
                        <span style="color:#aaa;">${item.l}</span>
                        <span style="font-weight:700;color:${ok?item.cor:'#ff6b6b'};">${item.v.toFixed(1)}% <span style="color:#555;font-weight:400;">/ ${item.ideal}%</span></span>
                      </div>
                      <div style="height:6px;background:rgba(255,255,255,0.06);border-radius:3px;overflow:hidden;">
                        <div style="height:100%;width:${Math.min(100,item.v)}%;background:${ok?item.cor:'#ff6b6b'};border-radius:3px;transition:width 0.8s;"></div>
                      </div>
                      <div style="font-size:0.68rem;color:#555;margin-top:3px;text-align:right;">Ideal: ${item.meta}</div>
                    </div>`
                }).join('')}
              </div>
            ` : '<div style="color:#555;font-size:0.82rem;text-align:center;padding:20px 0;">Cadastre receitas para ativar</div>'}
          </div>

          <!-- Sugestões personalizadas -->
          <div class="card">
            <div style="font-weight:700;font-size:0.9rem;margin-bottom:14px;">✨ Sugestões</div>
            <div style="display:flex;flex-direction:column;gap:8px;">
              ${(sg.cortes_orcamento || []).slice(0,2).map(s => `
                <div style="font-size:0.78rem;color:#aaa;padding:8px 10px;background:rgba(255,107,107,0.05);border-left:3px solid #ff6b6b;border-radius:0 8px 8px 0;line-height:1.5;">✂️ ${s}</div>`).join('')}
              ${(sg.otimizacoes || []).slice(0,3).map(s => `
                <div style="font-size:0.78rem;color:#aaa;padding:8px 10px;background:rgba(47,191,113,0.05);border-left:3px solid #2FBF71;border-radius:0 8px 8px 0;line-height:1.5;">💡 ${s}</div>`).join('')}
            </div>
          </div>
        </div>

        <!-- ÍNDICE DE DESPERDÍCIO -->
        <div id="indice-desperdicio-container" style="margin-top:0;">
          <div class="skeleton" style="height:160px;border-radius:16px;"></div>
        </div>

        <!-- ALERTAS DE CATEGORIA -->
        <div id="alertas-categoria-container" style="margin-top:0;"></div>

        <!-- rodapé -->
        <div style="text-align:center;font-size:0.72rem;color:#444;padding:8px 0 20px;">
          Análise gerada em ${new Date().toLocaleString('pt-BR')} • Período ${re.periodo?.mes || '—'}/${re.periodo?.ano || '—'}
        </div>
      `
      // Carregar Índice de Desperdício de forma assíncrona
      this.carregarIndiceDesperdicio()
      // Carregar alertas de categoria de forma assíncrona
      this._carregarAlertasCategoria()
    } catch (e) {
      container.innerHTML = `
        <div class="card" style="text-align:center;padding:60px 40px;">
          <div style="font-size:3rem;margin-bottom:16px;">🧠</div>
          <h3 style="margin-bottom:8px;">Análise Indisponível</h3>
          <p style="color:#666;margin-bottom:24px;">Adicione receitas e despesas para ativar o diagnóstico financeiro 360°</p>
          <button onclick="VM.navigate('receitas')" class="btn-primary" style="width:auto;padding:10px 24px;">
            <i class="fas fa-plus"></i> Adicionar Receitas
          </button>
        </div>
      `
    }
  },

  async gerarInsightsIA() {
    const btn = document.querySelector('[onclick="VM.gerarInsightsIA()"]')
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin" style="margin-right:6px;"></i>Gerando insights...' }

    try {
      // Gerar novos insights via OpenAI
      const data = await this.api('POST', 'ia/insights')
      const insights = data.insights || []
      const perfil = data.perfil_investidor || 'moderado'

      const container = document.getElementById('ia-insights-container')
      if (!container) { this.toast('Seção de insights não encontrada', 'error'); return }

      const perfilLabel = { conservador: '🛡️ Conservador', moderado: '⚖️ Moderado', arrojado: '🚀 Arrojado' }
      const tipoIcon = { alerta:'⚠️', dica:'💡', conquista:'🏆', investimento:'📈', economia:'💰' }
      const priorCor = { alta:'#ef4444', media:'#f59e0b', baixa:'#6b7280' }

      if (insights.length === 0) {
        container.innerHTML = `<div style="text-align:center;padding:24px;color:#555;font-size:0.85rem;">
          <i class="fas fa-robot" style="font-size:2rem;margin-bottom:8px;opacity:0.3;display:block;"></i>
          Adicione mais lançamentos para eu gerar insights personalizados.
        </div>`
      } else {
        container.innerHTML = `
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:16px;">
            <span style="font-size:0.75rem;color:#888;text-transform:uppercase;letter-spacing:1px;">💡 Insights Personalizados — IA</span>
            <span style="background:rgba(47,191,113,0.1);color:#2FBF71;padding:2px 10px;border-radius:12px;font-size:0.75rem;font-weight:600;">${perfilLabel[perfil] || perfil}</span>
          </div>
          ${insights.map(ins => `
            <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(${ins.prioridade==='alta'?'239,68,68':ins.prioridade==='media'?'245,158,11':'107,114,128'},0.25);border-left:3px solid ${priorCor[ins.prioridade]||'#6b7280'};border-radius:10px;padding:14px;margin-bottom:10px;">
              <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
                <span style="font-size:1rem;">${tipoIcon[ins.tipo]||'💡'}</span>
                <span style="color:#e0e0e0;font-weight:700;font-size:0.88rem;">${ins.titulo}</span>
                <span style="margin-left:auto;font-size:0.7rem;color:${priorCor[ins.prioridade]||'#6b7280'};background:rgba(${ins.prioridade==='alta'?'239,68,68':ins.prioridade==='media'?'245,158,11':'107,114,128'},0.1);padding:1px 7px;border-radius:8px;">${ins.prioridade}</span>
              </div>
              <p style="color:#aaa;font-size:0.82rem;margin:0;line-height:1.5;">${ins.conteudo}</p>
            </div>
          `).join('')}
        `
      }
      this.toast(`✅ ${insights.length} insights gerados para o perfil ${perfilLabel[perfil]||perfil}`, 'success')
    } catch(e) {
      this.toast('Erro ao gerar insights: ' + e.message, 'error')
    } finally {
      if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-robot" style="margin-right:6px;"></i>Gerar Insights com IA' }
    }
  },

  // ── Histórico de score de saúde financeira (gráfico de linha) ─────────────
  async _carregarScoreHistorico() {
    const el = document.getElementById('ia-score-historico-container')
    if (!el) return
    try {
      const data = await this.api('GET', 'ia/score-historico')
      const hist = data.historico || []
      if (hist.length < 2) {
        el.innerHTML = `<div class="card" style="margin-top:16px;text-align:center;padding:24px;color:#555;font-size:0.85rem;">
          <i class="fas fa-chart-line" style="font-size:2rem;margin-bottom:8px;opacity:0.3;display:block;"></i>
          O gráfico de evolução do score aparece após o 2º mês de uso.
        </div>`
        return
      }
      const labels = hist.map(h => h.mes.replace(/^(\d{4})-(\d{2})$/, (_, y, m) => {
        const meses = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez']
        return meses[parseInt(m)-1] + '/' + y.slice(2)
      }))
      const scores = hist.map(h => h.score_geral)
      const canvasId = 'chart-score-hist-' + Date.now()
      el.innerHTML = `
        <div class="card" style="margin-top:16px;">
          <div style="font-size:0.9rem;font-weight:700;margin-bottom:16px;display:flex;align-items:center;gap:8px;">
            <i class="fas fa-chart-line" style="color:#2FBF71;"></i> Evolução do Score de Saúde
          </div>
          <div style="position:relative;height:200px;">
            <canvas id="${canvasId}"></canvas>
          </div>
        </div>`
      setTimeout(() => {
        const ctx = document.getElementById(canvasId)?.getContext('2d')
        if (!ctx) return
        new Chart(ctx, {
          type: 'line',
          data: {
            labels,
            datasets: [{
              label: 'Score de Saúde',
              data: scores,
              borderColor: '#2FBF71',
              backgroundColor: 'rgba(47,191,113,0.1)',
              borderWidth: 2.5,
              fill: true,
              tension: 0.4,
              pointBackgroundColor: '#2FBF71',
              pointRadius: 4
            }]
          },
          options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
              y: { min: 0, max: 100, grid: { color:'rgba(255,255,255,0.05)' }, ticks: { color:'#666', stepSize:25 } },
              x: { grid: { display:false }, ticks: { color:'#666' } }
            }
          }
        })
      }, 100)
    } catch { /* silencioso */ }
  },

  async carregarIndiceDesperdicio() {
    const el = document.getElementById('indice-desperdicio-container')
    if (!el) return
    try {
      // Buscar dados das três fontes em paralelo
      const [assinData, comprasData, regra] = await Promise.all([
        this.api('GET', 'assinaturas-fantasma').catch(() => ({ totalMensal: 0 })),
        this.api('GET', 'compras-fantasma').catch(() => ({ resumo: {} })),
        this.api('GET', `regra-503020?mes=${new Date().getMonth()+1}&ano=${new Date().getFullYear()}`).catch(() => ({ income: 0, current: {} }))
      ])

      const income        = Number(regra.income || 0)
      const assinMensal   = Number(assinData.totalMensal || 0)
      const impulsivo     = Number(comprasData.resumo?.total_impulsivo || 0)
      const pctImpulsivo  = Number(comprasData.resumo?.percentual_impulsivo || 0)

      // Cálculo do Índice de Desperdício (0-100)
      // Componente 1: Assinaturas esquecidas (peso 35%) — % da renda em assinaturas detectadas
      const pctAssin = income > 0 ? Math.min(100, (assinMensal / income) * 100 * 3.5) : (assinMensal > 0 ? 50 : 0)
      // Componente 2: Compras impulsivas (peso 40%) — % de gastos impulsivos
      const pctImpulso = Math.min(100, pctImpulsivo * 2)
      // Componente 3: Descumprimento 50/30/20 (peso 25%) — se score < 60 penaliza
      const scoreRegra = Number(regra.score || 50)
      const pctRegra   = Math.max(0, (60 - scoreRegra) * 2)

      const indice = Math.round(pctAssin * 0.35 + pctImpulso * 0.40 + pctRegra * 0.25)
      const cor = indice <= 20 ? '#10B981' : indice <= 40 ? '#F59E0B' : indice <= 65 ? '#F97316' : '#F43F5E'
      const nivel = indice <= 20 ? '🟢 Excelente' : indice <= 40 ? '🟡 Moderado' : indice <= 65 ? '🟠 Elevado' : '🔴 Crítico'
      const msg = indice <= 20 ? 'Seus gastos estão bem controlados. Mantenha o foco!' :
                  indice <= 40 ? 'Há alguns gastos que podem ser otimizados.' :
                  indice <= 65 ? 'Você está desperdiçando uma parcela significativa da renda.' :
                  'Seus gastos desnecessários estão comprometendo sua saúde financeira!'

      const fmtBRL = v => Number(v||0).toLocaleString('pt-BR', {minimumFractionDigits:2,maximumFractionDigits:2})
      const circum = 2 * Math.PI * 52

      el.innerHTML = `
        <div style="background:rgba(15,23,42,0.9);border:1px solid rgba(255,255,255,0.07);border-radius:18px;padding:24px;margin-top:16px;">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px;">
            <div>
              <div style="font-size:0.75rem;color:#64748B;text-transform:uppercase;letter-spacing:1px;font-weight:700;margin-bottom:4px;">🔥 Índice de Desperdício Financeiro</div>
              <div style="color:#f1f5f9;font-size:0.85rem;max-width:400px;line-height:1.5;">${msg}</div>
            </div>
            <div style="display:flex;align-items:center;gap:16px;">
              <svg width="110" height="110" viewBox="0 0 110 110">
                <circle cx="55" cy="55" r="52" fill="none" stroke="rgba(255,255,255,0.05)" stroke-width="8"/>
                <circle cx="55" cy="55" r="52" fill="none" stroke="${cor}" stroke-width="8"
                  stroke-dasharray="${circum}" stroke-dashoffset="${circum*(1-indice/100)}"
                  stroke-linecap="round" transform="rotate(-90 55 55)"/>
                <text x="55" y="52" text-anchor="middle" font-size="22" font-weight="800" fill="${cor}">${indice}</text>
                <text x="55" y="68" text-anchor="middle" font-size="10" fill="#64748B">/100</text>
              </svg>
              <div>
                <div style="font-size:1rem;font-weight:700;color:${cor};">${nivel}</div>
                ${income > 0 ? `<div style="font-size:0.78rem;color:#64748B;margin-top:4px;">Renda: R$ ${fmtBRL(income)}/mês</div>` : ''}
              </div>
            </div>
          </div>
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;">
            <div style="background:#0f172a;border-radius:12px;padding:14px;">
              <div style="font-size:0.7rem;color:#8B5CF6;font-weight:600;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;">📱 Assinaturas Esquecidas</div>
              <div style="font-size:1.1rem;font-weight:700;color:#f1f5f9;">R$ ${fmtBRL(assinMensal)}/mês</div>
              <div style="font-size:0.72rem;color:#64748B;margin-top:3px;">${assinData.detected?.filter(d=>d.status==='detected').length||0} detectadas · peso 35%</div>
              <button onclick="VM.navigate('assinaturas-fantasma')" style="margin-top:8px;font-size:0.72rem;color:#8B5CF6;background:rgba(139,92,246,0.1);border:1px solid rgba(139,92,246,0.2);border-radius:6px;padding:4px 10px;cursor:pointer;">Ver detalhes →</button>
            </div>
            <div style="background:#0f172a;border-radius:12px;padding:14px;">
              <div style="font-size:0.7rem;color:#F97316;font-weight:600;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;">🛍️ Compras Impulsivas</div>
              <div style="font-size:1.1rem;font-weight:700;color:#f1f5f9;">R$ ${fmtBRL(impulsivo)}/mês</div>
              <div style="font-size:0.72rem;color:#64748B;margin-top:3px;">${pctImpulsivo.toFixed(1)}% dos gastos · peso 40%</div>
              <button onclick="VM.navigate('compras-fantasma')" style="margin-top:8px;font-size:0.72rem;color:#F97316;background:rgba(249,115,22,0.1);border:1px solid rgba(249,115,22,0.2);border-radius:6px;padding:4px 10px;cursor:pointer;">Ver detalhes →</button>
            </div>
            <div style="background:#0f172a;border-radius:12px;padding:14px;">
              <div style="font-size:0.7rem;color:#60A5FA;font-weight:600;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;">📊 Regra 50/30/20</div>
              <div style="font-size:1.1rem;font-weight:700;color:#f1f5f9;">Score: ${scoreRegra}/100</div>
              <div style="font-size:0.72rem;color:#64748B;margin-top:3px;">${scoreRegra>=80?'Meta cumprida ✅':scoreRegra>=60?'Próximo da meta':'Abaixo da meta'} · peso 25%</div>
              <button onclick="VM.navigate('regra-503020')" style="margin-top:8px;font-size:0.72rem;color:#60A5FA;background:rgba(96,165,250,0.1);border:1px solid rgba(96,165,250,0.2);border-radius:6px;padding:4px 10px;cursor:pointer;">Ver detalhes →</button>
            </div>
          </div>
          ${indice > 40 ? `
          <div style="margin-top:14px;padding:12px 16px;background:rgba(244,63,94,0.05);border:1px solid rgba(244,63,94,0.15);border-radius:10px;">
            <div style="font-size:0.78rem;color:#FDA4AF;line-height:1.6;">
              💡 <strong>Para reduzir seu índice:</strong>
              ${assinMensal > 0 ? ` Cancele assinaturas não utilizadas (economia: R$ ${fmtBRL(assinMensal*12)}/ano).` : ''}
              ${pctImpulsivo > 20 ? ` Aplique a regra das 48h para compras acima de R$ 100.` : ''}
              ${scoreRegra < 60 ? ` Ajuste seu orçamento para seguir a regra 50/30/20.` : ''}
            </div>
          </div>` : ''}
        </div>
      `
    } catch(e) {
      el.innerHTML = ''
    }
  },

  async _carregarAlertasCategoria() {
    const el = document.getElementById('alertas-categoria-container')
    if (!el) return
    try {
      const now = new Date()
      const mes = now.getMonth() + 1
      const ano = now.getFullYear()
      const data = await this.api('GET', `alertas-categoria?mes=${mes}&ano=${ano}`)
      if (!data.has_alertas) { el.innerHTML = ''; return }

      const rows = data.alertas.map(a => {
        const cor = a.nivel === 'critico' ? '#ff6b6b' : '#ffc400'
        const bg  = a.nivel === 'critico' ? 'rgba(255,107,107,0.08)' : 'rgba(255,196,0,0.08)'
        const border = a.nivel === 'critico' ? 'rgba(255,107,107,0.25)' : 'rgba(255,196,0,0.25)'
        const icon = a.nivel === 'critico' ? '🔴' : '🟡'
        return `
          <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;background:${bg};border:1px solid ${border};border-radius:10px;margin-bottom:8px;">
            <div style="display:flex;align-items:center;gap:10px;">
              <span style="font-size:1.1rem;">${icon}</span>
              <div>
                <div style="font-size:0.85rem;font-weight:600;color:${cor};">${a.categoria}</div>
                <div style="font-size:0.75rem;color:#888;">Média 3m: ${this.formatMoney(a.media_3m)} → Atual: ${this.formatMoney(a.total_atual)}</div>
              </div>
            </div>
            <div style="text-align:right;">
              <span style="font-size:1rem;font-weight:800;color:${cor};">+${a.variacao_pct}%</span>
              <div style="font-size:0.7rem;color:#666;">acima da média</div>
            </div>
          </div>
        `
      }).join('')

      el.innerHTML = `
        <div style="background:rgba(42,42,42,0.6);border:1px solid rgba(255,196,0,0.2);border-radius:16px;padding:20px;margin-top:0;">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:14px;">
            <span style="font-size:1.1rem;">⚠️</span>
            <span style="font-weight:700;font-size:0.95rem;">Alertas de Gasto por Categoria</span>
            <span style="margin-left:auto;background:rgba(255,196,0,0.15);color:#ffc400;font-size:0.72rem;padding:2px 9px;border-radius:20px;font-weight:700;">${data.total_alertas} alertas</span>
          </div>
          ${rows}
          <p style="font-size:0.72rem;color:#555;margin:8px 0 0;text-align:right;">Comparado à média dos últimos 3 meses</p>
        </div>
      `
    } catch(_) {
      el.innerHTML = ''
    }
  },
  // ============== RESERVA DE EMERGÊNCIA ==============
  async pageReserva() {
    document.getElementById('page-content').innerHTML = `
      <div class="section-header">
        <div>
          <div class="section-title">🛡️ Reserva de Emergência</div>
          <div style="color:#666;font-size:0.85rem;margin-top:2px;">Sua proteção financeira para imprevistos</div>
        </div>
      </div>
      <div id="reserva-container">
        <div class="empty-state"><div class="skeleton" style="height:300px;border-radius:16px;"></div></div>
      </div>
    `
    this.carregarReserva()
  },

  async carregarReserva() {
    try {
      const data = await this.api('GET', 'reserva')
      const container = document.getElementById('reserva-container')
      const r = data.reserva
      const mediaGastos = data.media_gastos_mensais || 0
      const valorIdeal = data.valor_ideal || 0
      const cobertura = data.cobertura_pct || 0
      const mesesCobertos = data.meses_cobertos || 0

      const barColor = cobertura >= 100 ? '#2FBF71' : cobertura >= 60 ? '#ffc400' : '#ff6b6b'
      const statusIcon = cobertura >= 100 ? '✅' : cobertura >= 60 ? '⚠️' : '🔴'
      const statusMsg = cobertura >= 100 ? 'Meta atingida! Reserva completa.' : cobertura >= 60 ? 'Quase lá! Continue poupando.' : 'Reserva insuficiente. Priorize isso!'

      if (!r) {
        // Sem reserva cadastrada
        container.innerHTML = `
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:20px;margin-bottom:28px;">
            <div class="stat-card" style="text-align:center;">
              <div style="font-size:2rem;margin-bottom:8px;">🛡️</div>
              <div style="font-size:1.4rem;font-weight:800;color:#888;">R$ 0</div>
              <div style="color:#666;font-size:0.8rem;">Valor Guardado</div>
            </div>
            <div class="stat-card" style="text-align:center;">
              <div style="font-size:2rem;margin-bottom:8px;">🎯</div>
              <div style="font-size:1.4rem;font-weight:800;color:#888;">${this.formatMoney(valorIdeal)}</div>
              <div style="color:#666;font-size:0.8rem;">Valor Ideal (6 meses)</div>
            </div>
            <div class="stat-card" style="text-align:center;">
              <div style="font-size:2rem;margin-bottom:8px;">📊</div>
              <div style="font-size:1.4rem;font-weight:800;color:#888;">${this.formatMoney(mediaGastos)}</div>
              <div style="color:#666;font-size:0.8rem;">Média Gastos/Mês</div>
            </div>
          </div>

          <div class="stat-card" style="text-align:center;padding:40px 20px;margin-bottom:28px;">
            <div style="font-size:4rem;margin-bottom:16px;">🛡️</div>
            <div style="font-size:1.2rem;font-weight:700;margin-bottom:8px;">Você ainda não tem uma reserva cadastrada</div>
            <div style="color:#666;font-size:0.85rem;margin-bottom:24px;max-width:400px;margin-left:auto;margin-right:auto;line-height:1.6;">
              Uma reserva de emergência é essencial para sua segurança financeira. Especialistas recomendam guardar entre 3 a 12 meses de despesas.
            </div>
            <button onclick="VM.modalReserva()" class="btn-primary" style="width:auto;padding:12px 28px;">
              <i class="fas fa-plus"></i> Criar Minha Reserva
            </button>
          </div>

          ${this.renderEducacaoReserva()}
        `
      } else {
        const objetivoMeses = r.objetivo_meses || 6
        container.innerHTML = `
          <!-- STATS -->
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:16px;margin-bottom:24px;">
            <div class="stat-card" style="text-align:center;">
              <div style="font-size:1.8rem;margin-bottom:6px;">🛡️</div>
              <div style="font-size:1.3rem;font-weight:800;color:#2FBF71;">${this.formatMoney(r.valor_atual)}</div>
              <div style="color:#666;font-size:0.78rem;">Valor Guardado</div>
            </div>
            <div class="stat-card" style="text-align:center;">
              <div style="font-size:1.8rem;margin-bottom:6px;">🎯</div>
              <div style="font-size:1.3rem;font-weight:800;color:#74b9ff;">${this.formatMoney(valorIdeal)}</div>
              <div style="color:#666;font-size:0.78rem;">Meta (${objetivoMeses} meses)</div>
            </div>
            <div class="stat-card" style="text-align:center;">
              <div style="font-size:1.8rem;margin-bottom:6px;">📊</div>
              <div style="font-size:1.3rem;font-weight:800;">${this.formatMoney(mediaGastos)}</div>
              <div style="color:#666;font-size:0.78rem;">Média Gastos/Mês</div>
            </div>
            <div class="stat-card" style="text-align:center;">
              <div style="font-size:1.8rem;margin-bottom:6px;">📅</div>
              <div style="font-size:1.3rem;font-weight:800;color:${barColor};">${mesesCobertos.toFixed(1)} meses</div>
              <div style="color:#666;font-size:0.78rem;">Cobertura Atual</div>
            </div>
          </div>

          <!-- PROGRESSO -->
          <div class="stat-card" style="margin-bottom:24px;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
              <div>
                <div style="font-weight:700;font-size:1rem;">${r.nome || 'Reserva de Emergência'}</div>
                <div style="font-size:0.8rem;color:#888;margin-top:2px;">${statusIcon} ${statusMsg}</div>
              </div>
              <div style="display:flex;gap:8px;">
                <button onclick="VM.modalReservaDeposito(${r.id}, ${r.valor_atual})" class="btn-primary" style="padding:8px 16px;font-size:0.8rem;">
                  <i class="fas fa-plus"></i> Depositar
                </button>
                <button onclick="VM.modalReserva(${JSON.stringify(r).replace(/"/g,'&quot;')})" class="btn-success" style="padding:8px 14px;font-size:0.8rem;">
                  <i class="fas fa-edit"></i>
                </button>
                <button onclick="VM.deletarReserva(${r.id})" class="btn-danger" style="padding:8px 14px;font-size:0.8rem;">
                  <i class="fas fa-trash"></i>
                </button>
              </div>
            </div>

            <!-- Barra de progresso -->
            <div style="background:rgba(255,255,255,0.06);border-radius:50px;height:14px;overflow:hidden;margin-bottom:10px;">
              <div style="height:100%;width:${Math.min(100,cobertura)}%;background:${barColor};border-radius:50px;transition:width 0.6s ease;"></div>
            </div>
            <div style="display:flex;justify-content:space-between;font-size:0.75rem;color:#888;">
              <span>${this.formatMoney(r.valor_atual)} guardados</span>
              <span style="color:${barColor};font-weight:700;">${cobertura}% da meta</span>
              <span>Meta: ${this.formatMoney(valorIdeal)}</span>
            </div>

            <!-- Faltante -->
            ${cobertura < 100 ? `
              <div style="margin-top:14px;padding:12px 16px;background:rgba(255,196,0,0.07);border:1px solid rgba(255,196,0,0.15);border-radius:10px;font-size:0.82rem;color:#cca800;">
                <i class="fas fa-info-circle"></i> Faltam <strong>${this.formatMoney(Math.max(0,valorIdeal - r.valor_atual))}</strong> para completar sua reserva de ${objetivoMeses} meses.
                ${mediaGastos > 0 ? `Poupando <strong>${this.formatMoney((valorIdeal - r.valor_atual) / 12)}/mês</strong>, você completa em 12 meses.` : ''}
              </div>
            ` : `
              <div style="margin-top:14px;padding:12px 16px;background:rgba(47,191,113,0.08);border:1px solid rgba(47,191,113,0.2);border-radius:10px;font-size:0.82rem;color:#2FBF71;">
                🎉 <strong>Parabéns!</strong> Sua reserva está completa! Considere aumentar a meta para ${objetivoMeses + 3} meses.
              </div>
            `}
          </div>

          <!-- MARCOS -->
          <div class="stat-card" style="margin-bottom:24px;">
            <div style="font-size:0.85rem;font-weight:600;color:#888;letter-spacing:1px;text-transform:uppercase;margin-bottom:16px;">🏅 Marcos da Reserva</div>
            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:12px;">
              ${[{m:1,l:'1 mês',i:'🛡️'},{m:3,l:'3 meses',i:'💪'},{m:6,l:'6 meses',i:'🏆'},{m:12,l:'12 meses',i:'👑'}].map(marco => {
                const atingido = mesesCobertos >= marco.m
                return `<div style="text-align:center;padding:14px 10px;border-radius:12px;background:${atingido?'rgba(47,191,113,0.1)':'rgba(255,255,255,0.03)'};border:1px solid ${atingido?'rgba(47,191,113,0.3)':'rgba(255,255,255,0.06)'};">
                  <div style="font-size:1.8rem;margin-bottom:6px;${atingido?'':'filter:grayscale(80%);opacity:0.4;'}">${marco.i}</div>
                  <div style="font-size:0.78rem;font-weight:700;color:${atingido?'#2FBF71':'#555'};">${marco.l}</div>
                  <div style="font-size:0.7rem;color:${atingido?'#2FBF71':'#444'};margin-top:2px;">${atingido?'✓ Atingido':mediaGastos>0?'Meta: '+this.formatMoney(marco.m*mediaGastos):'Lançe despesas para calcular'}</div>
                </div>`
              }).join('')}
            </div>
          </div>

          ${this.renderEducacaoReserva()}
        `
      }
    } catch(e) {
      this.toast('Erro ao carregar reserva', 'error')
    }
  },

  renderEducacaoReserva() {
    return `
      <div class="stat-card">
        <div style="font-size:0.85rem;font-weight:600;color:#888;letter-spacing:1px;text-transform:uppercase;margin-bottom:20px;">📚 Como Funciona uma Reserva de Emergência</div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:16px;">
          <div style="padding:16px;background:rgba(116,185,255,0.07);border:1px solid rgba(116,185,255,0.15);border-radius:12px;">
            <div style="font-size:1.5rem;margin-bottom:10px;">🤔</div>
            <div style="font-weight:700;font-size:0.9rem;margin-bottom:6px;color:#74b9ff;">O que é?</div>
            <div style="font-size:0.8rem;color:#aaa;line-height:1.6;">É um valor guardado exclusivamente para situações inesperadas: perda de emprego, doenças, consertos urgentes ou emergências familiares.</div>
          </div>
          <div style="padding:16px;background:rgba(47,191,113,0.07);border:1px solid rgba(47,191,113,0.15);border-radius:12px;">
            <div style="font-size:1.5rem;margin-bottom:10px;">💡</div>
            <div style="font-weight:700;font-size:0.9rem;margin-bottom:6px;color:#2FBF71;">Quanto guardar?</div>
            <div style="font-size:0.8rem;color:#aaa;line-height:1.6;">
              <strong style="color:#eee;">Assalariado CLT:</strong> 3 a 6 meses<br>
              <strong style="color:#eee;">Autônomo/Freelancer:</strong> 6 a 12 meses<br>
              <strong style="color:#eee;">Empresário:</strong> 12 meses ou mais
            </div>
          </div>
          <div style="padding:16px;background:rgba(162,155,254,0.07);border:1px solid rgba(162,155,254,0.15);border-radius:12px;">
            <div style="font-size:1.5rem;margin-bottom:10px;">🏦</div>
            <div style="font-weight:700;font-size:0.9rem;margin-bottom:6px;color:#a29bfe;">Onde guardar?</div>
            <div style="font-size:0.8rem;color:#aaa;line-height:1.6;">Escolha investimentos líquidos e seguros: <strong style="color:#eee;">Tesouro Selic</strong>, <strong style="color:#eee;">CDB com liquidez diária</strong> ou <strong style="color:#eee;">Conta Rendimento</strong> (nunca na poupança tradicional).</div>
          </div>
          <div style="padding:16px;background:rgba(255,196,0,0.07);border:1px solid rgba(255,196,0,0.15);border-radius:12px;">
            <div style="font-size:1.5rem;margin-bottom:10px;">⚠️</div>
            <div style="font-weight:700;font-size:0.9rem;margin-bottom:6px;color:#ffc400;">Regras de ouro</div>
            <div style="font-size:0.8rem;color:#aaa;line-height:1.6;">✓ Use APENAS em emergências reais<br>✓ Reponha imediatamente após usar<br>✓ Não misture com metas ou investimentos<br>✓ Revise o valor a cada 6 meses</div>
          </div>
        </div>
      </div>
    `
  },

  modalReserva(reserva = null) {
    const isEdit = !!reserva
    document.getElementById('modal-container').innerHTML = `
      <div class="modal-overlay" onclick="VM.closeModal(event)">
        <div class="modal" style="max-width:480px;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:24px;">
            <h3 style="font-size:1.1rem;font-weight:700;">${isEdit ? '✏️ Editar' : '🛡️ Criar'} Reserva de Emergência</h3>
            <button onclick="VM.closeModal()" style="background:none;border:none;color:#666;font-size:1.2rem;cursor:pointer;">✕</button>
          </div>
          <form id="reserva-form">
            <div class="form-group">
              <label class="form-label">Nome da Reserva</label>
              <input type="text" id="res-nome" class="form-input" placeholder="Ex: Reserva de Emergência" value="${reserva?.nome || 'Reserva de Emergência'}">
            </div>
            <div class="form-group">
              <label class="form-label">Objetivo (meses de despesas) *</label>
              <select id="res-meses" class="form-select">
                <option value="3" ${(reserva?.objetivo_meses||6)==3?'selected':''}>3 meses (mínimo recomendado)</option>
                <option value="6" ${(reserva?.objetivo_meses||6)==6?'selected':''}>6 meses (recomendado)</option>
                <option value="9" ${reserva?.objetivo_meses==9?'selected':''}>9 meses</option>
                <option value="12" ${reserva?.objetivo_meses==12?'selected':''}>12 meses (autônomos)</option>
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">Valor Atual Guardado (R$) *</label>
              <input type="number" id="res-valor" class="form-input" step="0.01" min="0" placeholder="0.00" value="${reserva?.valor_atual || ''}" required>
            </div>
            <div class="form-group">
              <label class="form-label">Observações</label>
              <textarea id="res-obs" class="form-input" rows="2" placeholder="Ex: Guardado no Tesouro Selic..." style="resize:none;">${reserva?.observacoes || ''}</textarea>
            </div>
            <div style="display:flex;gap:12px;margin-top:8px;">
              <button type="button" onclick="VM.closeModal()" class="btn-secondary" style="flex:1;justify-content:center;">Cancelar</button>
              <button type="submit" class="btn-primary" style="flex:1;" id="res-submit">
                <i class="fas fa-save"></i> ${isEdit ? 'Salvar' : 'Criar Reserva'}
              </button>
            </div>
          </form>
        </div>
      </div>
    `
    document.getElementById('reserva-form').addEventListener('submit', async (e) => {
      e.preventDefault()
      const btn = document.getElementById('res-submit')
      btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Salvando...'
      try {
        const payload = {
          nome: document.getElementById('res-nome').value || 'Reserva de Emergência',
          objetivo_meses: parseInt(document.getElementById('res-meses').value),
          valor_atual: parseFloat(document.getElementById('res-valor').value) || 0,
          observacoes: document.getElementById('res-obs').value || null
        }
        if (isEdit) await this.api('PUT', `reserva/${reserva.id}`, payload)
        else await this.api('POST', 'reserva', payload)
        this.toast(isEdit ? 'Reserva atualizada! 🛡️' : 'Reserva criada! 🎉')
        this.closeModal(); this.carregarReserva()
      } catch(err) {
        this.toast(err.response?.data?.error || 'Erro ao salvar', 'error')
        btn.disabled = false; btn.innerHTML = `<i class="fas fa-save"></i> ${isEdit ? 'Salvar' : 'Criar Reserva'}`
      }
    })
  },

  modalReservaDeposito(id, valorAtual) {
    document.getElementById('modal-container').innerHTML = `
      <div class="modal-overlay" onclick="VM.closeModal(event)">
        <div class="modal" style="max-width:400px;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:24px;">
            <h3 style="font-size:1.1rem;font-weight:700;">💰 Atualizar Reserva</h3>
            <button onclick="VM.closeModal()" style="background:none;border:none;color:#666;font-size:1.2rem;cursor:pointer;">✕</button>
          </div>
          <div style="background:rgba(47,191,113,0.07);border:1px solid rgba(47,191,113,0.15);border-radius:10px;padding:12px;margin-bottom:20px;font-size:0.82rem;color:#2FBF71;">
            Valor atual: <strong>${this.formatMoney(valorAtual)}</strong>
          </div>
          <form id="deposito-form">
            <div class="form-group">
              <label class="form-label">Tipo de Operação</label>
              <select id="dep-tipo" class="form-select" onchange="VM.atualizarPreviewDeposito(${valorAtual})">
                <option value="deposito">💰 Depósito (adicionar)</option>
                <option value="saque">📤 Retirada (subtrair)</option>
                <option value="ajuste">✏️ Definir valor total</option>
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">Valor (R$) *</label>
              <input type="number" id="dep-valor" class="form-input" step="0.01" min="0.01" placeholder="0.00" required oninput="VM.atualizarPreviewDeposito(${valorAtual})">
            </div>
            <div id="dep-preview" style="padding:10px 14px;background:rgba(255,255,255,0.04);border-radius:8px;font-size:0.82rem;color:#888;margin-bottom:16px;display:none;"></div>
            <div style="display:flex;gap:12px;">
              <button type="button" onclick="VM.closeModal()" class="btn-secondary" style="flex:1;justify-content:center;">Cancelar</button>
              <button type="submit" class="btn-primary" style="flex:1;" id="dep-submit"><i class="fas fa-check"></i> Confirmar</button>
            </div>
          </form>
        </div>
      </div>
    `
    document.getElementById('deposito-form').addEventListener('submit', async (e) => {
      e.preventDefault()
      const btn = document.getElementById('dep-submit')
      btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>'
      try {
        const tipo = document.getElementById('dep-tipo').value
        const valor = parseFloat(document.getElementById('dep-valor').value)
        let novoValor = valorAtual
        if (tipo === 'deposito') novoValor = valorAtual + valor
        else if (tipo === 'saque') novoValor = Math.max(0, valorAtual - valor)
        else novoValor = valor

        // Precisamos pegar os dados completos da reserva para o PUT
        const data = await this.api('GET', 'reserva')
        const res = data.reserva
        await this.api('PUT', `reserva/${id}`, {
          nome: res.nome, objetivo_meses: res.objetivo_meses,
          valor_atual: novoValor, observacoes: res.observacoes
        })
        this.toast('Reserva atualizada! 🛡️')
        this.closeModal(); this.carregarReserva()
      } catch(err) {
        this.toast(err.response?.data?.error || 'Erro', 'error')
        btn.disabled = false; btn.innerHTML = '<i class="fas fa-check"></i> Confirmar'
      }
    })
  },

  atualizarPreviewDeposito(valorAtual) {
    const tipo = document.getElementById('dep-tipo')?.value
    const valor = parseFloat(document.getElementById('dep-valor')?.value) || 0
    const preview = document.getElementById('dep-preview')
    if (!preview || !valor) { if(preview) preview.style.display='none'; return }
    let novoValor = valorAtual
    if (tipo === 'deposito') novoValor = valorAtual + valor
    else if (tipo === 'saque') novoValor = Math.max(0, valorAtual - valor)
    else novoValor = valor
    preview.style.display = 'block'
    preview.innerHTML = `Novo saldo: <strong style="color:#2FBF71;">${this.formatMoney(novoValor)}</strong>`
  },

  async deletarReserva(id) {
    const ok = await this.vmConfirm('Tem certeza que deseja excluir sua reserva de emergência? Esta ação não pode ser desfeita.', { titulo: 'Excluir Reserva', corBotao: '#ef4444', textoBotao: 'Excluir', icone: '⛔' })
    if (!ok) return
    try {
      await this.api('DELETE', `reserva/${id}`)
      this.toast('Reserva removida.')
      this.carregarReserva()
    } catch(e) {
      this.toast('Erro ao excluir', 'error')
    }
  },

  // ============== CONQUISTAS ==============
  async pageConquistas() {
    document.getElementById('page-content').innerHTML = `
      <div class="section-header">
        <div>
          <div class="section-title">🏆 Conquistas</div>
          <div style="color:#666;font-size:0.85rem;margin-top:2px;">Sua jornada de evolução financeira</div>
        </div>
      </div>
      <div id="conq-container">
        <div class="empty-state"><div class="skeleton" style="height:300px;border-radius:16px;"></div></div>
      </div>
    `
    this.carregarConquistas()
  },

  async carregarConquistas() {
    try {
      const data = await this.api('GET', 'conquistas')
      const container = document.getElementById('conq-container')
      const conquistadas = (data.conquistas || []).filter(c => c.conquistada)
      const disponiveis = (data.conquistas || []).filter(c => !c.conquistada)
      const pontos_total = data.total_pontos || 0

      const raridadeCores = { comum: '#888', raro: '#74b9ff', epico: '#a29bfe', lendario: '#ffc400' }
      const raridadeGradients = {
        comum: 'rgba(136,136,136,0.1)',
        raro: 'rgba(116,185,255,0.12)',
        epico: 'rgba(162,155,254,0.12)',
        lendario: 'rgba(255,196,0,0.12)'
      }

      // Tooltip helper — como desbloquear cada conquista
      const dicas = {
        primeira_receita: 'Cadastre sua primeira receita no sistema.',
        organizador: 'Cadastre sua primeira despesa.',
        sonhador: 'Crie sua primeira meta financeira.',
        investidor: 'Cadastre qualquer investimento.',
        carteirinha: 'Adicione um cartão de crédito.',
        planejador: 'Complete seu perfil ou cadastre uma meta/financiamento.',
        meta_concluida: 'Conclua uma meta (valor atual ≥ valor alvo).',
        lembrete_mestre: 'Cadastre pelo menos 5 lembretes.',
        cartao_zero: 'Marque uma fatura de cartão como paga.',
        disciplinado: 'Marque 10 despesas como pagas no mesmo mês.',
        analista: 'Acesse o relatório anual.',
        poupador: 'Poupe mais de 20% da renda em um mês.',
        poupador_dedicado: 'Tenha mais de R$ 10.000 investidos.',
        milionario: 'Acumule mais de R$ 100.000 investidos.',
        investidor_cdi: 'Cadastre um investimento do tipo Caixinha/CDI.',
        investidor_cdb: 'Cadastre um CDB.',
        investidor_acoes: 'Cadastre um investimento em ações.',
        investidor_fii: 'Cadastre um FII (Fundo Imobiliário).',
        investidor_cripto: 'Cadastre criptomoedas.',
        investidor_tesouro: 'Cadastre um Tesouro Direto.',
        investidor_diversificado: 'Tenha 3 ou mais tipos diferentes de investimentos.',
        meta_casa: 'Crie uma meta com categoria Imóvel.',
        meta_carro: 'Crie uma meta com categoria Veículo.',
        meta_viagem: 'Crie uma meta com categoria Viagem.',
        meta_educacao: 'Crie uma meta com categoria Educação.',
        meta_liberdade: 'Crie uma meta com categoria Liberdade Financeira.',
        meta_aposentadoria: 'Crie uma meta com categoria Aposentadoria.',
        primeiro_imovel: 'Cadastre um financiamento de imóvel.',
        primeiro_carro: 'Cadastre um empréstimo do tipo veículo.',
        financiamento_veiculo: 'Cadastre um financiamento de veículo.',
        financiamento_outros: 'Cadastre um financiamento rural ou outros bens.',
        quitou_10pct: 'Quite 10% do seu financiamento.',
        quitou_15pct: 'Quite 15% do seu financiamento.',
        quitou_20pct: 'Quite 20% do seu financiamento.',
        quitou_30pct: 'Quite 30% do seu financiamento.',
        quitou_50pct: 'Quite 50% do seu financiamento.',
        imovel_quitado: 'Quite completamente um financiamento de imóvel.',
        carro_quitado: 'Quite completamente um empréstimo de veículo.',
        sem_dividas: 'Quite um empréstimo ou financiamento por completo.',
        sem_dividas_total: 'Quite TODOS os empréstimos e financiamentos.',
        amortizou: 'Realize uma amortização extraordinária em qualquer dívida.',
        reserva_iniciada: 'Crie sua reserva de emergência.',
        reserva_1_mes: 'Acumule 1 mês de despesas na reserva.',
        reserva_3_meses: 'Acumule 3 meses de despesas na reserva.',
        reserva_6_meses:  'Acumule 6 meses de despesas na reserva.',
        reserva_9_meses:  'Acumule 9 meses de despesas na reserva de emergência.',
        reserva_12_meses: 'Acumule 12 meses de despesas na reserva — nível máximo!',
        reserva_completa: 'Atinja 100% da meta da sua reserva.',
      }

      const renderCard = (c, bloqueada) => {
        const bg = bloqueada ? 'rgba(255,255,255,0.02)' : (raridadeGradients[c.raridade] || 'rgba(255,255,255,0.04)')
        const border = bloqueada ? 'rgba(255,255,255,0.06)' : (raridadeCores[c.raridade] || '#444') + '44'
        const opacity = bloqueada ? 'opacity:0.55;' : ''
        const dica = dicas[c.codigo] || c.descricao
        return `
          <div style="${opacity}background:${bg};border:1px solid ${border};border-radius:16px;padding:18px;text-align:center;position:relative;cursor:default;"
               title="${dica}" data-tooltip="${dica}" onmouseenter="VM.showConqTooltip(event)" onmouseleave="VM.hideConqTooltip()">
            <div style="font-size:2.2rem;margin-bottom:8px;${bloqueada?'filter:grayscale(80%);':'' }">${c.icone || (bloqueada?'🔒':'🏆')}</div>
            <div style="font-weight:700;font-size:0.88rem;margin-bottom:4px;${bloqueada?'color:#555;':''}">${c.titulo}</div>
            <div style="font-size:0.72rem;color:${bloqueada?'#444':'#888'};margin-bottom:10px;line-height:1.4;">${c.descricao}</div>
            ${bloqueada
              ? `<div style="font-size:0.68rem;color:#555;">⭐ ${c.pontos} pts • ${c.raridade}</div>`
              : `<div style="display:flex;justify-content:center;gap:6px;flex-wrap:wrap;">
                   <span style="font-size:0.68rem;background:${raridadeCores[c.raridade]}22;color:${raridadeCores[c.raridade]};padding:2px 8px;border-radius:50px;border:1px solid ${raridadeCores[c.raridade]}44;">${c.raridade}</span>
                   <span style="font-size:0.68rem;color:#ffc400;">⭐ ${c.pontos} pts</span>
                 </div>`
            }
          </div>
        `
      }

      container.innerHTML = `
        <div id="conq-tooltip" style="display:none;position:fixed;z-index:9999;background:#1a1a1a;border:1px solid #333;border-radius:10px;padding:10px 14px;font-size:0.78rem;color:#ddd;max-width:240px;line-height:1.5;pointer-events:none;"></div>
        <!-- HEADER STATS -->
        <div class="grid-3" style="margin-bottom:28px;">
          <div class="stat-card" style="text-align:center;">
            <div style="font-size:2.5rem;margin-bottom:8px;">🏆</div>
            <div style="font-size:1.8rem;font-weight:800;color:#2FBF71;">${conquistadas.length}</div>
            <div style="color:#888;font-size:0.8rem;">Conquistas Desbloqueadas</div>
          </div>
          <div class="stat-card" style="text-align:center;">
            <div style="font-size:2.5rem;margin-bottom:8px;">⭐</div>
            <div style="font-size:1.8rem;font-weight:800;color:#ffc400;">${pontos_total}</div>
            <div style="color:#888;font-size:0.8rem;">Pontos Acumulados</div>
          </div>
          <div class="stat-card" style="text-align:center;">
            <div style="font-size:2.5rem;margin-bottom:8px;">🎯</div>
            <div style="font-size:1.8rem;font-weight:800;">${disponiveis.length}</div>
            <div style="color:#888;font-size:0.8rem;">Para Desbloquear</div>
          </div>
        </div>

        ${conquistadas.length > 0 ? `
          <div style="margin-bottom:28px;">
            <div style="font-size:0.85rem;font-weight:600;color:#888;letter-spacing:1px;text-transform:uppercase;margin-bottom:16px;">✅ Desbloqueadas (${conquistadas.length})</div>
            <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:14px;">
              ${conquistadas.map(c => renderCard(c, false)).join('')}
            </div>
          </div>
        ` : ''}

        ${disponiveis.length > 0 ? `
          <div>
            <div style="font-size:0.85rem;font-weight:600;color:#888;letter-spacing:1px;text-transform:uppercase;margin-bottom:16px;">🔒 A Desbloquear (${disponiveis.length}) — passe o mouse para ver como</div>
            <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:14px;">
              ${disponiveis.map(c => renderCard(c, true)).join('')}
            </div>
          </div>
        ` : ''}
      `
    } catch(e) {
      this.toast('Erro ao carregar conquistas', 'error')
    }
  },

  showConqTooltip(event) {
    const tooltip = document.getElementById('conq-tooltip')
    if (!tooltip) return
    const dica = event.currentTarget.dataset.tooltip
    if (!dica) return
    tooltip.textContent = '💡 ' + dica
    tooltip.style.display = 'block'
    const updatePos = (e) => {
      tooltip.style.left = (e.clientX + 14) + 'px'
      tooltip.style.top = (e.clientY - 10) + 'px'
    }
    updatePos(event)
    event.currentTarget._tooltipMove = updatePos
    event.currentTarget.addEventListener('mousemove', updatePos)
  },

  hideConqTooltip() {
    const tooltip = document.getElementById('conq-tooltip')
    if (tooltip) tooltip.style.display = 'none'
  },

  // ══════════════════════════════════════════════════════════════════════════
  // F1 — ORÇAMENTOS POR CATEGORIA
  // ══════════════════════════════════════════════════════════════════════════
  async pageOrcamentos() {
    const content = document.getElementById('page-content')
    const plano = this.user?.plano || 'free'

    if (plano === 'free') {
      content.innerHTML = this.upsellBlock('orcamentos', '📊 Orçamentos por Categoria',
        'Defina limites mensais por categoria e veja em tempo real quanto você ainda pode gastar.',
        ['Alertas automáticos ao atingir 80% do limite', 'Barras de progresso visuais por categoria', 'Histórico e comparativo mensal', 'Proteja seu orçamento antes de gastar demais'])
      return
    }

    const hoje = new Date()
    let mesSel = hoje.getMonth() + 1
    let anoSel = hoje.getFullYear()

    const renderPage = async () => {
      content.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;gap:8px;padding:80px;color:#555;"><i class="fas fa-spinner fa-spin"></i> Carregando...</div>`
      const data = await this.api('GET', `orcamentos?mes=${mesSel}&ano=${anoSel}`)
      const orcs = data.orcamentos || []
      const sem  = data.semOrcamento || []

      const mesNomes = ['','Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez']
      const statusCfg = {
        ok:        { cor: '#10B981', bg: 'rgba(16,185,129,0.12)', txt: '✅ OK' },
        attention: { cor: '#F59E0B', bg: 'rgba(245,158,11,0.12)', txt: '⚠️ Atenção' },
        warning:   { cor: '#F97316', bg: 'rgba(249,115,22,0.12)', txt: '🔶 Alerta' },
        exceeded:  { cor: '#F43F5E', bg: 'rgba(244,63,94,0.12)', txt: '🚨 Excedido' }
      }

      const totalLimite = orcs.reduce((s, o) => s + o.limite, 0)
      const totalGasto  = orcs.reduce((s, o) => s + o.gasto, 0)
      const pctGlobal   = totalLimite > 0 ? Math.round(totalGasto / totalLimite * 100) : 0
      const corGlobal   = pctGlobal > 100 ? '#F43F5E' : pctGlobal >= 80 ? '#F97316' : '#10B981'

      content.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;margin-bottom:24px;">
          <div>
            <div style="font-size:1.1rem;font-weight:700;">📊 Orçamentos por Categoria</div>
            <div style="color:#666;font-size:0.82rem;margin-top:2px;">Defina e acompanhe limites mensais de gastos</div>
          </div>
          <div style="display:flex;align-items:center;gap:10px;">
            <select id="sel-mes" style="background:#111827;border:1px solid #1f2937;color:#e0e0e0;border-radius:8px;padding:8px 12px;font-size:0.82rem;" onchange="VM._orcMesChange()">
              ${[1,2,3,4,5,6,7,8,9,10,11,12].map(m => `<option value="${m}" ${m===mesSel?'selected':''}>${mesNomes[m]}</option>`).join('')}
            </select>
            <select id="sel-ano" style="background:#111827;border:1px solid #1f2937;color:#e0e0e0;border-radius:8px;padding:8px 12px;font-size:0.82rem;" onchange="VM._orcMesChange()">
              ${[2024,2025,2026,2027].map(a => `<option value="${a}" ${a===anoSel?'selected':''}>${a}</option>`).join('')}
            </select>
            <button onclick="VM._abrirNovoOrcamento()" class="btn-primary" style="padding:8px 16px;font-size:0.82rem;gap:6px;">
              <i class="fas fa-plus"></i> Novo Orçamento
            </button>
          </div>
        </div>

        ${orcs.length > 0 ? `
        <!-- Resumo Global -->
        <div style="background:#111827;border:1px solid #1f2937;border-radius:12px;padding:18px 20px;margin-bottom:20px;display:flex;align-items:center;gap:20px;flex-wrap:wrap;">
          <div style="flex:1;min-width:200px;">
            <div style="font-size:0.75rem;color:#888;margin-bottom:6px;text-transform:uppercase;letter-spacing:1px;">Visão Geral do Mês</div>
            <div style="display:flex;justify-content:space-between;margin-bottom:6px;">
              <span style="font-size:0.82rem;color:#94a3b8;">Gasto: <strong style="color:${corGlobal};">${this.fmt(totalGasto)}</strong></span>
              <span style="font-size:0.82rem;color:#94a3b8;">Limite: <strong style="color:#e0e0e0;">${this.fmt(totalLimite)}</strong></span>
            </div>
            <div style="background:#1a1a2e;border-radius:20px;height:10px;overflow:hidden;">
              <div style="background:${corGlobal};height:100%;border-radius:20px;width:${Math.min(pctGlobal,100)}%;transition:width 0.5s ease;"></div>
            </div>
            <div style="font-size:0.75rem;color:${corGlobal};margin-top:4px;font-weight:700;">${pctGlobal}% utilizado</div>
          </div>
          <div style="display:flex;gap:16px;flex-wrap:wrap;">
            ${[
              { label: 'Orçamentos', val: orcs.length, cor: '#74b9ff' },
              { label: 'Excedidos', val: orcs.filter(o=>o.status==='exceeded').length, cor: '#F43F5E' },
              { label: 'Em Alerta', val: orcs.filter(o=>['warning','attention'].includes(o.status)).length, cor: '#F59E0B' },
              { label: 'No Verde', val: orcs.filter(o=>o.status==='ok').length, cor: '#10B981' }
            ].map(s => `
              <div style="text-align:center;">
                <div style="font-size:1.5rem;font-weight:800;color:${s.cor};">${s.val}</div>
                <div style="font-size:0.7rem;color:#555;">${s.label}</div>
              </div>`).join('')}
          </div>
        </div>

        <!-- Cards de Orçamento -->
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:14px;margin-bottom:24px;">
          ${orcs.map(o => {
            const cfg = statusCfg[o.status] || statusCfg.ok
            const pct = Math.min(o.percentual, 100)
            return `
            <div style="background:#111827;border:1px solid #1f2937;border-radius:12px;padding:18px;transition:border-color 0.2s;" onmouseover="this.style.borderColor='${cfg.cor}'" onmouseout="this.style.borderColor='#1f2937'">
              <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
                <div style="display:flex;align-items:center;gap:10px;">
                  <div style="font-size:1.6rem;">${o.label.split(' ')[0]}</div>
                  <div>
                    <div style="font-weight:600;font-size:0.9rem;">${o.label.replace(/^[^\s]+\s/,'')}</div>
                    <div style="font-size:0.7rem;padding:2px 8px;border-radius:20px;background:${cfg.bg};color:${cfg.cor};font-weight:700;margin-top:2px;display:inline-block;">${cfg.txt}</div>
                  </div>
                </div>
                <div style="display:flex;gap:4px;">
                  <button onclick="VM._editarOrcamento(${o.id},'${o.categoria}',${o.limite},${o.alerta_percentual})" style="background:rgba(255,255,255,0.06);border:1px solid #333;color:#aaa;border-radius:6px;padding:4px 8px;cursor:pointer;font-size:0.7rem;"><i class="fas fa-edit"></i></button>
                  <button onclick="VM._deletarOrcamento(${o.id},'${o.label}')" style="background:rgba(244,63,94,0.1);border:1px solid rgba(244,63,94,0.3);color:#F43F5E;border-radius:6px;padding:4px 8px;cursor:pointer;font-size:0.7rem;"><i class="fas fa-trash"></i></button>
                </div>
              </div>
              <div style="display:flex;justify-content:space-between;font-size:0.78rem;margin-bottom:6px;">
                <span style="color:#94a3b8;">Gasto: <strong style="color:${cfg.cor};">${this.fmt(o.gasto)}</strong></span>
                <span style="color:#94a3b8;">Limite: <strong style="color:#e0e0e0;">${this.fmt(o.limite)}</strong></span>
              </div>
              <div style="background:#1a1a2e;border-radius:20px;height:8px;overflow:hidden;margin-bottom:6px;">
                <div style="background:${cfg.cor};height:100%;border-radius:20px;width:${pct}%;transition:width 0.6s ease;"></div>
              </div>
              <div style="display:flex;justify-content:space-between;font-size:0.72rem;">
                <span style="color:${cfg.cor};font-weight:700;">${o.percentual}%</span>
                <span style="color:#555;">Restam: ${this.fmt(o.restante)}</span>
              </div>
            </div>`
          }).join('')}
        </div>
        ` : `
        <div style="background:#111827;border:1px solid #1f2937;border-radius:12px;padding:40px;text-align:center;margin-bottom:20px;">
          <div style="font-size:3rem;margin-bottom:12px;">📊</div>
          <div style="font-size:1.1rem;font-weight:600;margin-bottom:8px;">Nenhum orçamento em ${mesNomes[mesSel]}/${anoSel}</div>
          <div style="color:#666;font-size:0.85rem;margin-bottom:20px;">Crie orçamentos por categoria para controlar seus gastos proativamente.</div>
          <button onclick="VM._abrirNovoOrcamento()" class="btn-primary" style="padding:10px 24px;">
            <i class="fas fa-plus"></i> Criar Primeiro Orçamento
          </button>
        </div>
        `}

        ${sem.length > 0 ? `
        <div style="background:#111827;border:1px solid #1f2937;border-radius:12px;padding:18px 20px;">
          <div style="font-size:0.75rem;color:#888;text-transform:uppercase;letter-spacing:1px;margin-bottom:12px;">💡 Categorias sem orçamento</div>
          <div style="display:flex;flex-wrap:wrap;gap:8px;">
            ${sem.map(s => `
              <button onclick="VM._abrirNovoOrcamento('${s.categoria}')" style="background:rgba(255,255,255,0.04);border:1px solid #1f2937;color:#888;border-radius:8px;padding:6px 12px;cursor:pointer;font-size:0.78rem;transition:all 0.2s;" onmouseover="this.style.borderColor='#10B981';this.style.color='#10B981'" onmouseout="this.style.borderColor='#1f2937';this.style.color='#888'">
                ${s.label} <span style="color:#10B981;margin-left:4px;">+</span>
              </button>`).join('')}
          </div>
        </div>
        ` : ''}
      `

      // Guardar estado para os selects
      document.getElementById('sel-mes').onchange = () => {
        mesSel = parseInt(document.getElementById('sel-mes').value)
        anoSel = parseInt(document.getElementById('sel-ano').value)
        renderPage()
      }
      document.getElementById('sel-ano').onchange = () => {
        mesSel = parseInt(document.getElementById('sel-mes').value)
        anoSel = parseInt(document.getElementById('sel-ano').value)
        renderPage()
      }
    }

    // Métodos auxiliares
    this._orcMesChange = () => {
      mesSel = parseInt(document.getElementById('sel-mes')?.value || mesSel)
      anoSel = parseInt(document.getElementById('sel-ano')?.value || anoSel)
      renderPage()
    }

    this._abrirNovoOrcamento = (catPre = '') => {
      const catLabel = {
        alimentacao:'🍽️ Alimentação', moradia:'🏠 Moradia', transporte:'🚗 Transporte',
        saude:'🏥 Saúde', educacao:'📚 Educação', lazer:'🎮 Lazer', vestuario:'👕 Vestuário',
        beleza:'💄 Beleza', pets:'🐾 Pets', assinaturas:'📱 Assinaturas',
        tecnologia:'💻 Tecnologia', viagem:'✈️ Viagens', outros:'📦 Outros',
        fixo:'📌 Gastos Fixos', supermercado:'🛒 Supermercado'
      }
      this.showModal(`
        <div style="font-size:1.1rem;font-weight:700;margin-bottom:4px;">📊 Novo Orçamento</div>
        <div style="color:#666;font-size:0.82rem;margin-bottom:20px;">Defina o limite mensal para uma categoria</div>
        <div style="display:flex;flex-direction:column;gap:12px;">
          <div>
            <label style="font-size:0.75rem;color:#888;display:block;margin-bottom:4px;">Categoria</label>
            <select id="orc-cat" style="background:#0d1117;border:1px solid #2a2a3e;color:#e0e0e0;border-radius:8px;padding:9px 12px;font-size:0.85rem;width:100%;">
              ${Object.entries(catLabel).map(([v,l]) => `<option value="${v}" ${v===catPre?'selected':''}>${l}</option>`).join('')}
            </select>
          </div>
          <div>
            <label style="font-size:0.75rem;color:#888;display:block;margin-bottom:4px;">Limite (R$)</label>
            <input id="orc-limite" type="number" min="1" step="0.01" placeholder="Ex: 500,00" style="background:#0d1117;border:1px solid #2a2a3e;color:#e0e0e0;border-radius:8px;padding:9px 12px;font-size:0.85rem;width:100%;">
          </div>
          <div>
            <label style="font-size:0.75rem;color:#888;display:block;margin-bottom:4px;">Alertar ao atingir (%)</label>
            <input id="orc-alerta" type="number" min="50" max="100" value="80" style="background:#0d1117;border:1px solid #2a2a3e;color:#e0e0e0;border-radius:8px;padding:9px 12px;font-size:0.85rem;width:100%;">
          </div>
          <div style="display:flex;gap:8px;margin-top:4px;">
            <span style="font-size:0.75rem;color:#888;">Mês/Ano:</span>
            <span style="font-size:0.75rem;color:#10B981;font-weight:600;">${['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'][mesSel-1]}/${anoSel}</span>
          </div>
          <div style="display:flex;gap:8px;margin-top:8px;">
            <button onclick="VM._salvarOrcamento(${mesSel},${anoSel})" class="btn-primary" style="flex:1;justify-content:center;padding:10px;">💾 Salvar</button>
            <button onclick="VM.closeModal()" class="btn-secondary" style="padding:10px 16px;">Cancelar</button>
          </div>
        </div>
      `)
    }

    this._editarOrcamento = (id, cat, limite, alerta) => {
      const catLabel = {
        alimentacao:'🍽️ Alimentação', moradia:'🏠 Moradia', transporte:'🚗 Transporte',
        saude:'🏥 Saúde', educacao:'📚 Educação', lazer:'🎮 Lazer', vestuario:'👕 Vestuário',
        beleza:'💄 Beleza', pets:'🐾 Pets', assinaturas:'📱 Assinaturas',
        tecnologia:'💻 Tecnologia', viagem:'✈️ Viagens', outros:'📦 Outros',
        fixo:'📌 Gastos Fixos', supermercado:'🛒 Supermercado'
      }
      this.showModal(`
        <div style="font-size:1.1rem;font-weight:700;margin-bottom:4px;">✏️ Editar Orçamento</div>
        <div style="color:#666;font-size:0.82rem;margin-bottom:20px;">${catLabel[cat] || cat}</div>
        <div style="display:flex;flex-direction:column;gap:12px;">
          <input type="hidden" id="orc-edit-id" value="${id}">
          <input type="hidden" id="orc-cat" value="${cat}">
          <div>
            <label style="font-size:0.75rem;color:#888;display:block;margin-bottom:4px;">Limite (R$)</label>
            <input id="orc-limite" type="number" min="1" step="0.01" value="${limite}" style="background:#0d1117;border:1px solid #2a2a3e;color:#e0e0e0;border-radius:8px;padding:9px 12px;font-size:0.85rem;width:100%;">
          </div>
          <div>
            <label style="font-size:0.75rem;color:#888;display:block;margin-bottom:4px;">Alertar ao atingir (%)</label>
            <input id="orc-alerta" type="number" min="50" max="100" value="${alerta}" style="background:#0d1117;border:1px solid #2a2a3e;color:#e0e0e0;border-radius:8px;padding:9px 12px;font-size:0.85rem;width:100%;">
          </div>
          <div style="display:flex;gap:8px;margin-top:8px;">
            <button onclick="VM._salvarOrcamento(${mesSel},${anoSel})" class="btn-primary" style="flex:1;justify-content:center;padding:10px;">💾 Salvar</button>
            <button onclick="VM.closeModal()" class="btn-secondary" style="padding:10px 16px;">Cancelar</button>
          </div>
        </div>
      `)
    }

    this._salvarOrcamento = async (mes, ano) => {
      const cat    = document.getElementById('orc-cat').value
      const limite = parseFloat(document.getElementById('orc-limite').value)
      const alerta = parseInt(document.getElementById('orc-alerta').value) || 80
      if (!cat || !limite || limite <= 0) { this.toast('Preencha todos os campos', 'error'); return }
      const r = await this.api('POST', 'orcamentos', { categoria: cat, mes, ano, limite, alerta_percentual: alerta })
      if (r.success) { this.closeModal(); this.toast('✅ Orçamento salvo!'); renderPage() }
      else this.toast(r.error || 'Erro ao salvar', 'error')
    }

    this._deletarOrcamento = async (id, label) => {
      const ok = await this.vmConfirm(`Deseja excluir o orçamento <strong>"${label}"</strong>?`, { titulo: 'Excluir Orçamento', corBotao: '#ef4444', textoBotao: 'Excluir', icone: '🗑️' })
      if (!ok) return
      const r = await this.api('DELETE', `orcamentos/${id}`)
      if (r.success) { this.toast('✅ Orçamento removido'); renderPage() }
      else this.toast('Erro ao remover', 'error')
    }

    renderPage()
  },

  // ══════════════════════════════════════════════════════════════════════════
  // F2 — NOTIFICAÇÕES DE CONQUISTAS (polling 30s)
  // ══════════════════════════════════════════════════════════════════════════
  startConqPoll() {
    if (this._conqPollTimer) return
    // Verificar imediatamente no login, depois a cada 30s
    this.checkNovasConquistas()
    this._conqPollTimer = setInterval(() => this.checkNovasConquistas(), 30000)
    // Verificar alertas de cartão na inicialização
    setTimeout(() => this.atualizarBadgeAlertasCartao(), 5000)
  },

  async atualizarBadgeAlertasCartao() {
    try {
      const r = await this.api('GET', 'alertas-cartao')
      const n = r.total_nao_lidos || 0
      // Badge no sidebar
      const badge = document.getElementById('badge-alertas-cartao')
      if (badge) { badge.style.display = n > 0 ? 'inline-block' : 'none'; badge.textContent = n }
      // Badge no topbar (sino)
      const topBadge = document.getElementById('topbar-badge-alertas')
      if (topBadge) { topBadge.style.display = n > 0 ? 'inline-block' : 'none'; topBadge.textContent = n > 9 ? '9+' : n }
    } catch(e) {}
  },

  async checkNovasConquistas() {
    // Não disparar se já há overlay visível
    if (document.getElementById('conquista-overlay')) return
    try {
      const data = await this.api('GET', 'conquistas/novas')
      const novas = data.novas || []

      // Atualizar badge na sidebar
      const badge = document.getElementById('badge-conquistas')
      if (novas.length === 0) {
        if (badge) { badge.textContent = ''; badge.style.display = 'none' }
        return
      }
      if (badge) { badge.textContent = novas.length; badge.style.display = 'inline' }

      // Marcar como visualizadas imediatamente (antes de mostrar)
      await this.api('PATCH', 'conquistas/visualizar').catch(() => {})

      // Mostrar toast para cada conquista (único sistema de notificação)
      novas.forEach((c, i) => {
        setTimeout(() => this.showConqToast(c), i * 1500)
      })

      if (badge) { badge.textContent = ''; badge.style.display = 'none' }
    } catch(e) {}
  },

  showConqToast(conquista) {
    const rarColors = { COMUM: '#10B981', RARO: '#3B82F6', EPICO: '#8B5CF6', LENDARIO: '#F59E0B' }
    const rarBg    = { COMUM: 'rgba(16,185,129,0.08)', RARO: 'rgba(59,130,246,0.08)', EPICO: 'rgba(139,92,246,0.08)', LENDARIO: 'rgba(245,158,11,0.1)' }
    const cor  = rarColors[conquista.raridade] || '#10B981'
    const bg   = rarBg[conquista.raridade]     || 'rgba(16,185,129,0.08)'
    const isEpic = ['EPICO','LENDARIO'].includes(conquista.raridade)

    // Injeta estilos uma vez
    if (!document.getElementById('conq-toast-style')) {
      const style = document.createElement('style')
      style.id = 'conq-toast-style'
      style.textContent = `
        @keyframes conqIn  { 0%{transform:translateX(120%) scale(0.9);opacity:0} 60%{transform:translateX(-6%) scale(1.02)} 100%{transform:translateX(0) scale(1);opacity:1} }
        @keyframes conqOut { from{transform:translateX(0);opacity:1} to{transform:translateX(120%);opacity:0} }
        @keyframes conqIconBounce { 0%,100%{transform:scale(1) rotate(0)} 30%{transform:scale(1.3) rotate(-10deg)} 60%{transform:scale(0.9) rotate(8deg)} }
        @keyframes conqParticle { 0%{transform:translateY(0) rotate(0);opacity:1} 100%{transform:translateY(-60px) rotate(360deg);opacity:0} }
      `
      document.head.appendChild(style)
    }

    const el = document.createElement('div')
    el.style.cssText = `
      position:fixed;top:80px;right:20px;z-index:99999;
      background:linear-gradient(135deg,rgba(15,23,42,0.97) 0%,rgba(30,41,59,0.97) 100%);
      border:1px solid ${cor};
      border-radius:18px;padding:18px 20px;min-width:300px;max-width:360px;
      box-shadow:0 0 0 1px ${cor}22, 0 20px 50px rgba(0,0,0,0.6), 0 0 30px ${cor}15;
      display:flex;align-items:flex-start;gap:14px;
      animation:conqIn 0.6s cubic-bezier(0.175,0.885,0.32,1.275) forwards;
      backdrop-filter:blur(20px);overflow:hidden;
    `

    // Partículas de fundo para EPICO/LENDARIO
    const particles = isEpic ? `
      <div style="position:absolute;top:0;left:0;right:0;height:2px;background:linear-gradient(90deg,transparent,${cor},transparent);"></div>
      ${ ['⭐','✨','💫'].map((p,i) => `<span style="position:absolute;top:${10+i*8}px;right:${60+i*20}px;font-size:0.8rem;animation:conqParticle ${1.5+i*0.3}s ease forwards;animation-delay:${i*0.2}s;">${p}</span>`).join('') }
    ` : ''

    el.innerHTML = `
      ${particles}
      <div style="font-size:2.4rem;filter:drop-shadow(0 0 10px ${cor});animation:conqIconBounce 0.8s ease 0.3s;flex-shrink:0;line-height:1;">${conquista.icone}</div>
      <div style="flex:1;min-width:0;">
        <div style="font-size:0.6rem;color:${cor};font-weight:800;text-transform:uppercase;letter-spacing:1.2px;margin-bottom:3px;display:flex;align-items:center;gap:6px;">
          🏆 Conquista Desbloqueada!
          <span style="background:${bg};border:1px solid ${cor}33;border-radius:50px;padding:1px 7px;font-size:0.58rem;">${conquista.raridade}</span>
        </div>
        <div style="font-size:0.95rem;font-weight:800;color:#f8fafc;margin-bottom:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${conquista.titulo}</div>
        <div style="font-size:0.75rem;color:#64748b;line-height:1.4;margin-bottom:6px;">${conquista.descricao}</div>
        <div style="font-size:0.72rem;color:${cor};font-weight:700;">
          <i class="fas fa-star" style="font-size:0.65rem;"></i> +${conquista.pontos} pontos
        </div>
      </div>
      <button onclick="this.parentElement.style.animation='conqOut 0.3s ease forwards';setTimeout(()=>this.parentElement.remove(),300)"
        style="background:none;border:none;color:#334155;cursor:pointer;font-size:1rem;padding:0;line-height:1;flex-shrink:0;align-self:flex-start;">✕</button>
    `
    document.body.appendChild(el)

    setTimeout(() => {
      if (el.parentNode) {
        el.style.animation = 'conqOut 0.4s ease forwards'
        setTimeout(() => { if (el.parentNode) el.remove() }, 400)
      }
    }, 5000)
  },

  // ══════════════════════════════════════════════════════════════════════════
  // F3 — RECORRÊNCIAS AUTOMÁTICAS
  // ══════════════════════════════════════════════════════════════════════════
  async pageRecorrencias() {
    const content = document.getElementById('page-content')
    const plano = this.user?.plano || 'free'

    if (plano === 'free') {
      content.innerHTML = this.upsellBlock('recorrencias', '🔄 Recorrências Automáticas',
        'Cadastre uma vez suas despesas e receitas fixas. Elas aparecem automaticamente todo mês.',
        ['Zero digitação para contas fixas mensais', 'Controle de salário, aluguel, Netflix e mais', 'Nunca mais esqueça uma despesa fixa', 'Fluxo de caixa futuro automático'])
      return
    }

    const MESES_NOMES = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez']

    const renderRec = async () => {
      content.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;padding:80px;color:#555;"><i class="fas fa-spinner fa-spin"></i></div>`
      const data = await this.api('GET', 'recorrencias')
      const recs   = data.recorrencias || []
      const resumo = data.resumo || {}

      const tipoConfig = {
        despesa: { cor: '#F43F5E', bg: 'rgba(244,63,94,0.1)', icon: 'fa-arrow-down', label: 'Despesa' },
        receita: { cor: '#10B981', bg: 'rgba(16,185,129,0.1)', icon: 'fa-arrow-up',   label: 'Receita' }
      }

      content.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;margin-bottom:24px;">
          <div>
            <div style="font-size:1.1rem;font-weight:700;">🔄 Recorrências Automáticas</div>
            <div style="color:#666;font-size:0.82rem;">Transações fixas ou variáveis geradas todo mês</div>
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            <button onclick="VM._processarRecorrencias()" style="background:rgba(59,130,246,0.1);border:1px solid rgba(59,130,246,0.3);color:#74b9ff;border-radius:8px;padding:8px 14px;cursor:pointer;font-size:0.78rem;"><i class="fas fa-play"></i> Processar Mês Atual</button>
            <button onclick="VM._abrirGerarMesFuturo()" style="background:rgba(251,191,36,0.1);border:1px solid rgba(251,191,36,0.3);color:#fbbf24;border-radius:8px;padding:8px 14px;cursor:pointer;font-size:0.78rem;"><i class="fas fa-calendar-plus"></i> Gerar Mês Futuro</button>
            <button onclick="VM._abrirNovaRecorrencia()" class="btn-primary" style="padding:8px 16px;font-size:0.82rem;"><i class="fas fa-plus"></i> Nova Recorrência</button>
          </div>
        </div>

        <!-- Resumo -->
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:14px;margin-bottom:20px;">
          ${[
            { icon:'🔄', val: resumo.total||0, label:'Total', cor:'#74b9ff' },
            { icon:'✅', val: resumo.ativas||0, label:'Ativas', cor:'#10B981' },
            { icon:'💸', val: this.fmt(resumo.total_despesas||0), label:'Saídas fixas/mês', cor:'#F43F5E' },
            { icon:'💰', val: this.fmt(resumo.total_receitas||0), label:'Entradas fixas/mês', cor:'#10B981' }
          ].map(s => `
            <div style="background:#111827;border:1px solid #1f2937;border-radius:10px;padding:14px 16px;">
              <div style="font-size:1.4rem;margin-bottom:6px;">${s.icon}</div>
              <div style="font-size:1.4rem;font-weight:800;color:${s.cor};">${s.val}</div>
              <div style="font-size:0.72rem;color:#555;">${s.label}</div>
            </div>`).join('')}
        </div>

        ${recs.length === 0 ? `
          <div style="background:#111827;border:1px solid #1f2937;border-radius:12px;padding:40px;text-align:center;">
            <div style="font-size:3rem;margin-bottom:12px;">🔄</div>
            <div style="font-size:1.1rem;font-weight:600;margin-bottom:8px;">Nenhuma recorrência cadastrada</div>
            <div style="color:#666;font-size:0.85rem;margin-bottom:20px;">Cadastre suas contas fixas ou variáveis para controlar todo mês.</div>
            <button onclick="VM._abrirNovaRecorrencia()" class="btn-primary" style="padding:10px 24px;"><i class="fas fa-plus"></i> Criar Primeira Recorrência</button>
          </div>
        ` : `
          <div style="background:#111827;border:1px solid #1f2937;border-radius:12px;overflow:hidden;overflow-x:auto;-webkit-overflow-scrolling:touch;">
            <table style="width:100%;min-width:640px;border-collapse:collapse;font-size:0.82rem;">
              <thead><tr style="border-bottom:1px solid #1f2937;">
                <th style="padding:12px 16px;text-align:left;color:#888;font-size:0.72rem;text-transform:uppercase;">Descrição</th>
                <th style="padding:12px 16px;text-align:left;color:#888;font-size:0.72rem;text-transform:uppercase;">Tipo</th>
                <th style="padding:12px 16px;text-align:right;color:#888;font-size:0.72rem;text-transform:uppercase;">Valor</th>
                <th style="padding:12px 16px;text-align:center;color:#888;font-size:0.72rem;text-transform:uppercase;">Dia</th>
                <th style="padding:12px 16px;text-align:center;color:#888;font-size:0.72rem;text-transform:uppercase;">Status</th>
                <th style="padding:12px 16px;text-align:center;color:#888;font-size:0.72rem;text-transform:uppercase;">Ações</th>
              </tr></thead>
              <tbody>
                ${recs.map(r => {
                  const cfg = tipoConfig[r.tipo] || tipoConfig.despesa
                  const isVar = r.valor_variavel
                  const valorLabel = isVar
                    ? (r.ultimo_valor ? `~${this.fmt(r.ultimo_valor)}` : '— variável')
                    : this.fmt(r.valor)
                  const jaGerada = r.gerada_mes_atual
                  return `<tr style="border-bottom:1px solid #1a1a2e;transition:background 0.15s;" onmouseover="this.style.background='rgba(255,255,255,0.02)'" onmouseout="this.style.background=''">
                    <td style="padding:12px 16px;">
                      <div style="font-weight:600;display:flex;align-items:center;gap:6px;">
                        ${r.descricao}
                        ${isVar ? `<span style="background:rgba(251,191,36,0.15);color:#fbbf24;border:1px solid rgba(251,191,36,0.3);border-radius:10px;padding:1px 7px;font-size:0.65rem;font-weight:700;">↕ Variável</span>` : ''}
                      </div>
                      <div style="font-size:0.7rem;color:#555;">${r.categoria} · Dia ${r.dia_vencimento}${r.ultimo_gerado ? ` · Último: ${r.ultimo_gerado.slice(0,7)}` : ''}</div>
                    </td>
                    <td style="padding:12px 16px;">
                      <span style="background:${cfg.bg};color:${cfg.cor};border:1px solid ${cfg.cor}33;border-radius:20px;padding:3px 10px;font-size:0.7rem;font-weight:700;">
                        <i class="fas ${cfg.icon}"></i> ${cfg.label}
                      </span>
                    </td>
                    <td style="padding:12px 16px;text-align:right;font-weight:700;color:${isVar ? '#fbbf24' : cfg.cor};">${valorLabel}</td>
                    <td style="padding:12px 16px;text-align:center;color:#94a3b8;">${r.dia_vencimento}</td>
                    <td style="padding:12px 16px;text-align:center;">
                      <span style="background:${r.ativa?'rgba(16,185,129,0.1)':'rgba(100,116,139,0.1)'};color:${r.ativa?'#10B981':'#64748b'};border-radius:20px;padding:3px 10px;font-size:0.7rem;font-weight:700;">
                        ${r.ativa ? '● Ativa' : '○ Pausada'}
                      </span>
                    </td>
                    <td style="padding:12px 16px;text-align:center;">
                      <div style="display:flex;gap:4px;justify-content:center;">
                        <button onclick="VM._abrirLancarRecorrencia(${r.id},'${r.descricao.replace(/'/g,'\\\'')}')" title="Lançar no mês"
                          style="background:rgba(47,191,113,0.1);border:1px solid rgba(47,191,113,0.3);color:#2FBF71;border-radius:6px;padding:5px 8px;cursor:pointer;font-size:0.7rem;"
                          ${jaGerada ? 'opacity:0.5;' : ''}>
                          <i class="fas fa-paper-plane"></i>${jaGerada ? ' ✓' : ''}
                        </button>
                        <button onclick="VM._toggleRecorrencia(${r.id},${r.ativa})" title="${r.ativa?'Pausar':'Ativar'}" style="background:rgba(255,255,255,0.05);border:1px solid #333;color:#aaa;border-radius:6px;padding:5px 8px;cursor:pointer;font-size:0.7rem;"><i class="fas fa-${r.ativa?'pause':'play'}"></i></button>
                        <button onclick="VM._deletarRecorrencia(${r.id},'${r.descricao.replace(/'/g,'\\\'')}')" style="background:rgba(244,63,94,0.1);border:1px solid rgba(244,63,94,0.3);color:#F43F5E;border-radius:6px;padding:5px 8px;cursor:pointer;font-size:0.7rem;"><i class="fas fa-trash"></i></button>
                      </div>
                    </td>
                  </tr>`
                }).join('')}
              </tbody>
            </table>
          </div>
        `}
      `
    }

    this._abrirNovaRecorrencia = () => {
      this.showModal(`
        <div style="font-size:1.1rem;font-weight:700;margin-bottom:4px;">🔄 Nova Recorrência</div>
        <div style="color:#666;font-size:0.82rem;margin-bottom:20px;">Transação que se repete todo mês — fixa ou com valor variável</div>
        <div style="display:flex;flex-direction:column;gap:12px;">
          <div>
            <label style="font-size:0.75rem;color:#888;display:block;margin-bottom:4px;">Tipo</label>
            <select id="rec-tipo" style="background:#0d1117;border:1px solid #2a2a3e;color:#e0e0e0;border-radius:8px;padding:9px 12px;font-size:0.85rem;width:100%;">
              <option value="despesa">💸 Despesa</option>
              <option value="receita">💰 Receita</option>
            </select>
          </div>
          <div>
            <label style="font-size:0.75rem;color:#888;display:block;margin-bottom:4px;">Descrição</label>
            <input id="rec-desc" type="text" placeholder="Ex: Aluguel, Salário, Obra..." style="background:#0d1117;border:1px solid #2a2a3e;color:#e0e0e0;border-radius:8px;padding:9px 12px;font-size:0.85rem;width:100%;">
          </div>

          <!-- Toggle valor variável -->
          <div style="background:rgba(251,191,36,0.06);border:1px solid rgba(251,191,36,0.2);border-radius:10px;padding:12px;">
            <label style="display:flex;align-items:center;gap:10px;cursor:pointer;font-size:0.88rem;font-weight:600;color:#ccc;">
              <input type="checkbox" id="rec-variavel" onchange="VM._onToggleVariavel(this.checked)"
                style="width:18px;height:18px;accent-color:#fbbf24;cursor:pointer;">
              ↕ Valor Variável (define na hora de lançar)
            </label>
            <div style="font-size:0.75rem;color:#888;margin-top:6px;padding-left:28px;">
              Use para contas cujo valor muda todo mês, ex: conta de água, obra, comissão.
            </div>
          </div>

          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
            <div>
              <label id="rec-valor-label" style="font-size:0.75rem;color:#888;display:block;margin-bottom:4px;">Valor (R$)</label>
              <input id="rec-valor" type="number" min="0" step="0.01" placeholder="0,00"
                style="background:#0d1117;border:1px solid #2a2a3e;color:#e0e0e0;border-radius:8px;padding:9px 12px;font-size:0.85rem;width:100%;">
              <div id="rec-valor-hint" style="font-size:0.7rem;color:#888;margin-top:3px;display:none;">
                Valor de referência (será confirmado no lançamento)
              </div>
            </div>
            <div>
              <label style="font-size:0.75rem;color:#888;display:block;margin-bottom:4px;">Dia do mês</label>
              <input id="rec-dia" type="number" min="1" max="31" placeholder="1-31" style="background:#0d1117;border:1px solid #2a2a3e;color:#e0e0e0;border-radius:8px;padding:9px 12px;font-size:0.85rem;width:100%;">
            </div>
          </div>
          <div>
            <label style="font-size:0.75rem;color:#888;display:block;margin-bottom:4px;">Categoria</label>
            <select id="rec-cat" style="background:#0d1117;border:1px solid #2a2a3e;color:#e0e0e0;border-radius:8px;padding:9px 12px;font-size:0.85rem;width:100%;">
              ${['Moradia','Alimentação','Transporte','Saúde','Educação','Lazer','Assinaturas','Salário','Freelance','Outros'].map(c => `<option value="${c.toLowerCase()}">${c}</option>`).join('')}
            </select>
          </div>
          <div style="display:flex;gap:8px;margin-top:8px;">
            <button onclick="VM._salvarRecorrencia()" class="btn-primary" style="flex:1;justify-content:center;padding:10px;">💾 Criar Recorrência</button>
            <button onclick="VM.closeModal()" class="btn-secondary" style="padding:10px 16px;">Cancelar</button>
          </div>
        </div>
      `)
    }

    this._onToggleVariavel = (checked) => {
      const label = document.getElementById('rec-valor-label')
      const hint  = document.getElementById('rec-valor-hint')
      const input = document.getElementById('rec-valor')
      if (checked) {
        label.textContent = 'Valor de referência (R$) — opcional'
        label.style.color = '#fbbf24'
        hint.style.display = 'block'
        input.placeholder = 'Opcional — será informado ao lançar'
        input.required = false
      } else {
        label.textContent = 'Valor (R$)'
        label.style.color = '#888'
        hint.style.display = 'none'
        input.placeholder = '0,00'
        input.required = true
      }
    }

    this._salvarRecorrencia = async () => {
      const tipo      = document.getElementById('rec-tipo').value
      const desc      = document.getElementById('rec-desc').value.trim()
      const valorRaw  = document.getElementById('rec-valor').value
      const valor     = valorRaw ? parseFloat(valorRaw) : 0
      const dia       = parseInt(document.getElementById('rec-dia').value)
      const cat       = document.getElementById('rec-cat').value
      const variavel  = document.getElementById('rec-variavel')?.checked || false

      if (!desc || !dia || dia < 1 || dia > 31) {
        this.toast('Preencha descrição e dia do mês', 'error')
        return
      }
      if (!variavel && (!valor || valor <= 0)) {
        this.toast('Informe o valor para recorrência fixa', 'error')
        return
      }
      try {
        const r = await this.api('POST', 'recorrencias', {
          tipo, descricao: desc, valor: variavel ? (valor || 0) : valor,
          dia_vencimento: dia, categoria: cat, valor_variavel: variavel
        })
        if (r.success) { this.closeModal(); this.toast('✅ Recorrência criada!'); renderRec() }
        else this.toast(r.error || 'Erro ao criar', 'error')
      } catch(e) {
        this.toast('Erro ao criar recorrência', 'error')
      }
    }

    // ── Modal Lançar: pede valor + mostra histórico ───────────────────────────
    this._abrirLancarRecorrencia = async (id, descricao) => {
      // Buscar dados atuais da recorrência + histórico
      let recData = null
      try {
        const all = await this.api('GET', 'recorrencias')
        recData = (all.recorrencias || []).find(r => r.id === id)
      } catch(e) {}

      let hist = []
      try {
        const h = await this.api('GET', `recorrencias/${id}/historico?limit=6`)
        hist = h.historico || []
      } catch(e) {}

      const hoje      = new Date()
      const mesAtual  = hoje.getMonth() + 1
      const anoAtual  = hoje.getFullYear()
      const isVar     = recData?.valor_variavel || false
      const ultimoVal = recData?.ultimo_valor || recData?.valor || ''
      const tipo      = recData?.tipo || 'despesa'
      const corTipo   = tipo === 'receita' ? '#10B981' : '#F43F5E'
      const MESES     = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez']

      // Histórico HTML
      const histHtml = hist.length > 0 ? `
        <div style="margin-top:16px;">
          <div style="font-size:0.72rem;color:#888;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:8px;">📊 Histórico de lançamentos</div>
          <div style="display:flex;flex-direction:column;gap:4px;max-height:180px;overflow-y:auto;">
            ${hist.map(h => `
              <div style="display:flex;justify-content:space-between;align-items:center;background:rgba(255,255,255,0.03);border-radius:8px;padding:7px 12px;font-size:0.8rem;">
                <span style="color:#94a3b8;">${MESES[(h.mes||1)-1]}/${h.ano}</span>
                <span style="font-weight:700;color:${corTipo};">${this.fmt(h.valor)}</span>
                ${h.observacao ? `<span style="color:#555;font-size:0.7rem;max-width:100px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${h.observacao}">${h.observacao}</span>` : ''}
              </div>
            `).join('')}
          </div>
        </div>
      ` : `<div style="color:#555;font-size:0.78rem;margin-top:12px;">📭 Nenhum lançamento anterior</div>`

      this.showModal(`
        <div style="font-size:1.1rem;font-weight:700;margin-bottom:4px;">
          <i class="fas fa-paper-plane" style="color:${corTipo};"></i> Lançar: ${descricao}
        </div>
        <div style="font-size:0.78rem;color:#888;margin-bottom:16px;">
          ${isVar ? '↕ Recorrência variável — confirme o valor deste mês' : '🔒 Recorrência fixa — confirme o lançamento'}
        </div>

        <!-- Mês de destino -->
        <div style="margin-bottom:14px;">
          <label style="font-size:0.75rem;color:#888;display:block;margin-bottom:6px;">📅 Mês de lançamento</label>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
            <select id="lancar-mes" style="background:#0d1117;border:1px solid #2a2a3e;color:#e0e0e0;border-radius:8px;padding:9px 12px;font-size:0.85rem;">
              ${['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro']
                .map((m,i) => `<option value="${i+1}" ${i+1===mesAtual?'selected':''}>${m}</option>`).join('')}
            </select>
            <input id="lancar-ano" type="number" value="${anoAtual}" min="2020" max="2035"
              style="background:#0d1117;border:1px solid #2a2a3e;color:#e0e0e0;border-radius:8px;padding:9px 12px;font-size:0.85rem;">
          </div>
        </div>

        <!-- Valor: sempre editável, obrigatório para variável -->
        <div style="margin-bottom:14px;">
          <label style="font-size:0.75rem;color:${isVar?'#fbbf24':'#888'};display:block;margin-bottom:6px;">
            ${isVar ? '↕ Valor deste mês (R$) *' : '💰 Valor (R$)'}
          </label>
          <input id="lancar-valor" type="number" step="0.01" min="0.01"
            value="${isVar ? (ultimoVal || '') : ultimoVal}"
            placeholder="${isVar ? 'Informe o valor deste mês' : ''}"
            style="background:#0d1117;border:1px solid ${isVar?'rgba(251,191,36,0.4)':'#2a2a3e'};color:#e0e0e0;border-radius:8px;padding:11px 14px;font-size:1rem;font-weight:600;width:100%;">
          ${isVar && ultimoVal ? `<div style="font-size:0.7rem;color:#888;margin-top:3px;">Último lançado: ${this.fmt(ultimoVal)}</div>` : ''}
        </div>

        <!-- Observação opcional -->
        <div style="margin-bottom:14px;">
          <label style="font-size:0.75rem;color:#888;display:block;margin-bottom:4px;">Observação (opcional)</label>
          <input id="lancar-obs" type="text" placeholder="Ex: Obra do 3º andar, Mês cheio..."
            style="background:#0d1117;border:1px solid #2a2a3e;color:#e0e0e0;border-radius:8px;padding:9px 12px;font-size:0.85rem;width:100%;">
        </div>

        ${histHtml}

        <div style="display:flex;gap:8px;margin-top:16px;">
          <button onclick="VM._confirmarLancamento(${id})" class="btn-primary" style="flex:1;justify-content:center;padding:11px;">
            <i class="fas fa-check"></i> Confirmar Lançamento
          </button>
          <button onclick="VM.closeModal()" class="btn-secondary" style="padding:11px 16px;">Cancelar</button>
        </div>
      `)

      // Focar no campo de valor
      setTimeout(() => document.getElementById('lancar-valor')?.focus(), 100)
    }

    this._confirmarLancamento = async (id) => {
      const mes   = parseInt(document.getElementById('lancar-mes')?.value)
      const ano   = parseInt(document.getElementById('lancar-ano')?.value)
      const valor = parseFloat(document.getElementById('lancar-valor')?.value)
      const obs   = document.getElementById('lancar-obs')?.value?.trim() || null

      if (!valor || valor <= 0) {
        this.toast('Informe um valor maior que zero', 'error')
        return
      }
      if (!mes || !ano || mes < 1 || mes > 12) {
        this.toast('Mês inválido', 'error')
        return
      }

      const btn = document.querySelector('#modal-container .btn-primary')
      if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Lançando...' }

      try {
        const r = await this.api('POST', `recorrencias/${id}/lancar`, { valor, mes, ano, observacao: obs })
        this.closeModal()
        const MESES_N = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez']
        this.toast(`✅ Lançado ${this.fmt(r.valor)} em ${MESES_N[r.mes-1]}/${r.ano}`)
        renderRec()
      } catch(err) {
        const msg = err?.response?.data?.error || err?.message || 'Erro ao lançar'
        this.toast(msg, 'error')
        if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-check"></i> Confirmar Lançamento' }
      }
    }

    this._toggleRecorrencia = async (id, ativa) => {
      await this.api('PATCH', `recorrencias/${id}/toggle`)
      this.toast(ativa ? '⏸️ Recorrência pausada' : '▶️ Recorrência ativada')
      renderRec()
    }

    this._deletarRecorrencia = async (id, desc) => {
      const ok = await this.vmConfirm(`Deseja excluir a recorrência <strong>"${desc}"</strong>? Ela não gerará mais lançamentos futuros.`, { titulo: 'Excluir Recorrência', corBotao: '#ef4444', textoBotao: 'Excluir', icone: '🔄' })
      if (!ok) return
      await this.api('DELETE', `recorrencias/${id}`)
      this.toast('✅ Recorrência removida'); renderRec()
    }

    this._processarRecorrencias = async () => {
      const hoje = new Date()
      const r = await this.api('POST', 'recorrencias/processar', { mes: hoje.getMonth()+1, ano: hoje.getFullYear() })
      let msg = ''
      if (r.geradas > 0) msg = `✅ ${r.geradas} fixas geradas para ${r.mes}/${r.ano}`
      else msg = `ℹ️ Todas as recorrências fixas já foram geradas`
      if (r.variaveis_pendentes > 0) msg += ` · ${r.variaveis_pendentes} variável(is) aguardam lançamento manual`
      this.toast(msg, r.variaveis_pendentes > 0 ? 'warning' : 'success')
      renderRec()
    }

    this._abrirGerarMesFuturo = () => {
      const hoje = new Date()
      const mesesNomes = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro']
      let options = ''
      for (let i = 1; i <= 12; i++) {
        let m = hoje.getMonth() + 1 + i, y = hoje.getFullYear()
        if (m > 12) { m -= 12; y++ }
        options += `<option value="${m}_${y}">${mesesNomes[m-1]}/${y}</option>`
      }
      this.showModal(`
        <div style="font-size:1.05rem;font-weight:700;margin-bottom:16px;">📅 Gerar Recorrências para Mês Futuro</div>
        <div style="color:#888;font-size:0.82rem;margin-bottom:16px;">
          Cria despesas e receitas <b>fixas</b> em meses futuros. Recorrências variáveis devem ser lançadas individualmente.
        </div>
        <div style="margin-bottom:16px;">
          <label style="font-size:0.78rem;color:#888;display:block;margin-bottom:6px;">Mês de destino</label>
          <select id="rec-mes-futuro" style="background:#0d1117;border:1px solid #2a2a3e;color:#e0e0e0;border-radius:8px;padding:9px 12px;width:100%;font-size:0.85rem;">
            ${options}
          </select>
        </div>
        <div style="display:flex;gap:8px;">
          <button onclick="VM._gerarMesFuturo()" class="btn-primary" style="flex:1;justify-content:center;padding:10px;">
            <i class="fas fa-calendar-plus"></i> Gerar
          </button>
          <button onclick="VM.closeModal()" class="btn-secondary" style="padding:10px 16px;">Cancelar</button>
        </div>
      `)
    }

    this._gerarMesFuturo = async () => {
      const val = document.getElementById('rec-mes-futuro')?.value
      if (!val) return
      const [mes, ano] = val.split('_')
      try {
        const r = await this.api('POST', 'recorrencias/processar-mes', { mes: parseInt(mes), ano: parseInt(ano) })
        const mesesNomes = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro']
        if (r.geradas > 0) {
          this.toast(`✅ ${r.geradas} transação(ões) fixas gerada(s) para ${mesesNomes[parseInt(mes)-1]}/${ano}`)
        } else {
          this.toast(`ℹ️ Todas as recorrências fixas já foram geradas para ${mesesNomes[parseInt(mes)-1]}/${ano}`)
        }
        this.closeModal()
        renderRec()
      } catch(e) {
        this.toast('Erro ao gerar recorrências', 'error')
      }
    }

    renderRec()

    // ── Fluxo de Caixa Futuro (PRO) ───────────────────────────────────────────
    const planoUser = this.user?.plano || 'free'
    if (planoUser === 'pro') {
      setTimeout(() => this._renderFluxoCaixaFuturo(), 300)
    }
  },
  _renderFluxoCaixaFuturo() {
    const pageContent = document.getElementById('page-content')
    if (!pageContent) return

    this.api('GET', 'recorrencias').then(data => {
      const recs = (data.recorrencias || []).filter(r => r.ativa)
      if (recs.length === 0) return

      const hoje = new Date()
      const mesesNomes = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez']
      const fluxo = []

      for (let i = 0; i < 6; i++) {
        let m = hoje.getMonth() + 1 + i
        let a = hoje.getFullYear()
        while (m > 12) { m -= 12; a += 1 }
        const entradas = recs.filter(r => r.tipo === 'receita').reduce((s,r) => s + r.valor, 0)
        const saidas   = recs.filter(r => r.tipo === 'despesa').reduce((s,r) => s + r.valor, 0)
        fluxo.push({ label: `${mesesNomes[m-1]}/${a}`, entradas, saidas, saldo: entradas - saidas })
      }

      const block = document.createElement('div')
      block.style.marginTop = '20px'
      block.innerHTML = `
        <div style="background:#111827;border:1px solid #1f2937;border-radius:12px;padding:20px;">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">
            <div>
              <div style="font-size:0.9rem;font-weight:700;">📅 Fluxo de Caixa Futuro <span style="background:rgba(245,158,11,0.15);color:#F59E0B;border:1px solid rgba(245,158,11,0.3);font-size:0.65rem;padding:2px 8px;border-radius:20px;margin-left:8px;">PRO</span></div>
              <div style="font-size:0.75rem;color:#555;margin-top:2px;">Projeção dos próximos 6 meses com base nas recorrências ativas</div>
            </div>
          </div>
          <div style="overflow-x:auto;">
            <table style="width:100%;border-collapse:collapse;font-size:0.78rem;min-width:500px;">
              <thead><tr style="border-bottom:1px solid #1f2937;">
                <th style="padding:8px 12px;text-align:left;color:#888;font-size:0.7rem;text-transform:uppercase;">Mês</th>
                <th style="padding:8px 12px;text-align:right;color:#10B981;font-size:0.7rem;text-transform:uppercase;">Entradas</th>
                <th style="padding:8px 12px;text-align:right;color:#F43F5E;font-size:0.7rem;text-transform:uppercase;">Saídas</th>
                <th style="padding:8px 12px;text-align:right;color:#888;font-size:0.7rem;text-transform:uppercase;">Saldo</th>
                <th style="padding:8px 12px;text-align:left;color:#888;font-size:0.7rem;text-transform:uppercase;">Distribuição</th>
              </tr></thead>
              <tbody>
                ${fluxo.map(f => {
                  const corSaldo = f.saldo >= 0 ? '#10B981' : '#F43F5E'
                  const pctEnt   = f.entradas + f.saidas > 0 ? Math.round(f.entradas / (f.entradas + f.saidas) * 100) : 50
                  return `<tr style="border-bottom:1px solid #1a1a2e;">
                    <td style="padding:10px 12px;font-weight:600;">${f.label}</td>
                    <td style="padding:10px 12px;text-align:right;color:#10B981;font-weight:600;">${this.fmt(f.entradas)}</td>
                    <td style="padding:10px 12px;text-align:right;color:#F43F5E;font-weight:600;">${this.fmt(f.saidas)}</td>
                    <td style="padding:10px 12px;text-align:right;color:${corSaldo};font-weight:700;">${this.fmt(f.saldo)}</td>
                    <td style="padding:10px 12px;">
                      <div style="background:#1a1a2e;border-radius:10px;height:6px;overflow:hidden;display:flex;">
                        <div style="background:#10B981;width:${pctEnt}%;"></div>
                        <div style="background:#F43F5E;width:${100-pctEnt}%;"></div>
                      </div>
                    </td>
                  </tr>`
                }).join('')}
              </tbody>
            </table>
          </div>
          <div style="margin-top:14px;padding:12px;background:rgba(255,255,255,0.02);border-radius:8px;font-size:0.78rem;color:#94a3b8;">
            💡 <strong style="color:#F59E0B;">Dica Pro:</strong> Este fluxo considera apenas suas recorrências ativas. Acesse a <a href="#" onclick="VM.navigate('projecao');return false;" style="color:#74b9ff;">Projeção Financeira</a> para uma visão completa com histórico real.
          </div>
        </div>
      `
      pageContent.appendChild(block)
    }).catch(() => {})
  },

  // ══════════════════════════════════════════════════════════════════════════
  // F4 — PROJEÇÃO FINANCEIRA INTELIGENTE
  // ══════════════════════════════════════════════════════════════════════════
  async pageProjecao() {
    const content = document.getElementById('page-content')
    const plano = this.user?.plano || 'free'

    if (plano === 'free') {
      content.innerHTML = this.upsellBlock('projecao', '🔮 Projeção Financeira',
        'Veja como seu patrimônio vai evoluir nos próximos 6 a 12 meses com base no seu histórico real.',
        ['Projeção de 6 e 12 meses baseada no seu histórico', 'Tendência de crescimento ou queda patrimonial', 'Insights personalizados sobre sua situação', 'Confiança da projeção calculada automaticamente'])
      return
    }

    content.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;gap:8px;padding:80px;color:#555;"><i class="fas fa-spinner fa-spin"></i> Calculando projeção...</div>`

    let data
    try {
      data = await this.api('GET', 'projecao')
    } catch(e) {
      const msg = e.response?.data?.error || 'Erro ao carregar projeção financeira.'
      content.innerHTML = `
        <div style="text-align:center;padding:60px;">
          <div style="font-size:2.5rem;margin-bottom:16px;">⚠️</div>
          <div style="color:#F43F5E;font-size:1rem;font-weight:600;margin-bottom:8px;">${msg}</div>
          <button onclick="VM.pageProjecao()" style="margin-top:16px;background:#2FBF71;color:#fff;border:none;border-radius:8px;padding:10px 24px;cursor:pointer;font-weight:600;">
            <i class="fas fa-redo"></i> Tentar Novamente
          </button>
        </div>`
      return
    }

    if (!data || data.error) {
      content.innerHTML = `<div style="text-align:center;padding:60px;color:#F43F5E;">${data?.error || 'Erro desconhecido'}</div>`
      return
    }

    const tendCfg = {
      positive: { cor: '#10B981', icon: '📈', label: 'Tendência de Crescimento' },
      negative: { cor: '#F43F5E', icon: '📉', label: 'Tendência de Queda' },
      stable:   { cor: '#F59E0B', icon: '📊', label: 'Estável' }
    }
    const t = tendCfg[data.tendencia] || tendCfg.stable

    // Período selecionado
    let periodoSel = 12

    const renderGrafico = (periodo) => {
      const projs = (data.projecoes || []).slice(0, periodo)
      const hist  = data.historico || []

      // Canvas simples com Chart.js
      const container = document.getElementById('proj-chart-container')
      if (!container) return

      // Se não há dados reais, mostrar mensagem orientativa
      const temDadosReais = hist.some(h => h.receitas > 0 || h.despesas > 0)
      if (!temDadosReais) {
        container.innerHTML = `
          <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;gap:12px;padding:20px;">
            <div style="font-size:2.5rem;">📊</div>
            <div style="color:#888;font-size:0.9rem;text-align:center;max-width:320px;line-height:1.5;">
              <strong style="color:#94a3b8;">Nenhum dado histórico ainda.</strong><br>
              Lance suas receitas e despesas dos últimos meses para ver a projeção com dados reais.
            </div>
            <button onclick="VM.navigate('receitas')" style="background:#2FBF71;color:#fff;border:none;border-radius:8px;padding:8px 20px;cursor:pointer;font-weight:600;font-size:0.82rem;">
              <i class="fas fa-plus"></i> Lançar Receita
            </button>
          </div>`
        return
      }

      container.innerHTML = '<canvas id="proj-canvas" height="200"></canvas>'
      const ctx = document.getElementById('proj-canvas').getContext('2d')

      const labelsHist = hist.map(h => h.label)
      const labelsProj = projs.map(p => p.label)
      const todosLabels = [...labelsHist, ...labelsProj]

      // Saldo acumulado histórico (aproximado)
      let saldoAcum = 0
      const saldosHist = hist.map(h => { saldoAcum += h.saldo; return Math.round(saldoAcum * 100) / 100 })
      const saldosProj = projs.map(p => p.valor)

      // Preencher lacunas para alinhar datasets
      const nullsHist = new Array(labelsProj.length).fill(null)
      const nullsProj = new Array(labelsHist.length - 1).fill(null)

      if (window._projChart) window._projChart.destroy()
      window._projChart = new Chart(ctx, {
        type: 'line',
        data: {
          labels: todosLabels,
          datasets: [
            {
              label: 'Histórico',
              data: [...saldosHist, ...nullsHist],
              borderColor: '#74b9ff',
              backgroundColor: 'rgba(116,185,255,0.08)',
              fill: true, tension: 0.4, pointRadius: 4,
              pointBackgroundColor: '#74b9ff', borderWidth: 2
            },
            {
              label: 'Projeção',
              data: [...nullsProj, saldosHist[saldosHist.length-1], ...saldosProj],
              borderColor: t.cor,
              backgroundColor: `${t.cor}15`,
              fill: true, tension: 0.4, pointRadius: 4,
              pointBackgroundColor: t.cor, borderWidth: 2,
              borderDash: [6,3]
            }
          ]
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: {
            legend: { display: true, labels: { color: '#94a3b8', font: { size: 11 } } },
            tooltip: { mode: 'index', intersect: false }
          },
          scales: {
            y: { ticks: { color: '#666', callback: v => `R$${(v/1000).toFixed(1)}k` }, grid: { color: '#1a1a2e' } },
            x: { ticks: { color: '#666', maxTicksLimit: 8 }, grid: { display: false } }
          }
        }
      })
    }

    content.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;margin-bottom:24px;">
        <div>
          <div style="font-size:1.1rem;font-weight:700;">🔮 Projeção Financeira</div>
          <div style="color:#666;font-size:0.82rem;">Baseada nos últimos 6 meses do seu histórico real</div>
        </div>
        <div style="display:flex;gap:6px;">
          ${[6,12].map(p => `
            <button id="btn-proj-${p}" onclick="VM._selProjPeriodo(${p})"
              style="background:${p===periodoSel?t.cor:'rgba(255,255,255,0.05)'};color:${p===periodoSel?'#fff':'#888'};border:1px solid ${p===periodoSel?t.cor:'#333'};border-radius:8px;padding:6px 16px;cursor:pointer;font-size:0.82rem;font-weight:600;transition:all 0.2s;">
              ${p} meses
            </button>`).join('')}
        </div>
      </div>

      <!-- KPIs -->
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:14px;margin-bottom:20px;">
        <div style="background:#111827;border:1px solid ${t.cor}44;border-radius:10px;padding:16px 18px;">
          <div style="font-size:0.65rem;color:#888;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;">Tendência</div>
          <div style="font-size:1.3rem;font-weight:800;color:${t.cor};">${t.icon} ${t.label}</div>
        </div>
        <div style="background:#111827;border:1px solid #1f2937;border-radius:10px;padding:16px 18px;">
          <div style="font-size:0.65rem;color:#888;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;">Média Mensal</div>
          <div style="font-size:1.3rem;font-weight:800;color:${data.media_mensal>=0?'#10B981':'#F43F5E'};">${this.fmt(data.media_mensal)}</div>
          <div style="font-size:0.7rem;color:#555;">saldo médio/mês</div>
        </div>
        <div style="background:#111827;border:1px solid #1f2937;border-radius:10px;padding:16px 18px;">
          <div style="font-size:0.65rem;color:#888;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;">Projeção 6 meses</div>
          <div style="font-size:1.3rem;font-weight:800;color:${data.resumo?.projecao_6m>=0?'#10B981':'#F43F5E'};">${this.fmt(data.resumo?.projecao_6m||0)}</div>
        </div>
        <div style="background:#111827;border:1px solid #1f2937;border-radius:10px;padding:16px 18px;">
          <div style="font-size:0.65rem;color:#888;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;">Projeção 12 meses</div>
          <div style="font-size:1.3rem;font-weight:800;color:${data.resumo?.projecao_12m>=0?'#10B981':'#F43F5E'};">${this.fmt(data.resumo?.projecao_12m||0)}</div>
        </div>
        <div style="background:#111827;border:1px solid #1f2937;border-radius:10px;padding:16px 18px;">
          <div style="font-size:0.65rem;color:#888;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;">Confiança</div>
          <div style="font-size:1.3rem;font-weight:800;color:${data.confianca>=70?'#10B981':data.confianca>=40?'#F59E0B':'#F43F5E'};">${data.confianca}%</div>
          <div style="font-size:0.7rem;color:#555;">${data.confianca>=70?'Alta':data.confianca>=40?'Média':'Baixa'}</div>
        </div>
      </div>

      <!-- Gráfico -->
      <div style="background:#111827;border:1px solid #1f2937;border-radius:12px;padding:20px;margin-bottom:20px;">
        <div style="font-size:0.75rem;color:#888;text-transform:uppercase;letter-spacing:1px;margin-bottom:16px;">📈 Evolução Patrimonial</div>
        <div id="proj-chart-container" style="height:220px;"></div>
      </div>

      <!-- Insights -->
      <div style="background:#111827;border:1px solid #1f2937;border-radius:12px;padding:18px 20px;">
        <div style="font-size:0.75rem;color:#888;text-transform:uppercase;letter-spacing:1px;margin-bottom:14px;">💡 Insights Personalizados</div>
        <div style="display:flex;flex-direction:column;gap:10px;">
          ${(data.insights||[]).map(ins => `
            <div style="background:rgba(255,255,255,0.02);border:1px solid #1f2937;border-radius:8px;padding:12px 14px;font-size:0.84rem;color:#94a3b8;line-height:1.5;">
              ${ins}
            </div>`).join('')}
        </div>
      </div>

      <!-- Como funciona -->
      <div style="background:rgba(59,130,246,0.05);border:1px solid rgba(59,130,246,0.15);border-radius:12px;padding:20px;margin-top:16px;">
        <div style="font-size:0.75rem;color:#60A5FA;text-transform:uppercase;letter-spacing:1px;margin-bottom:14px;font-weight:700;">🔍 Como a Projeção é Calculada</div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:14px;">
          <div>
            <div style="font-size:0.82rem;font-weight:700;color:#93C5FD;margin-bottom:5px;">📊 Base de Dados</div>
            <p style="color:#64748B;font-size:0.78rem;line-height:1.5;margin:0;">Analisa seus últimos 6 meses de receitas e despesas lançados no sistema para calcular uma média mensal real.</p>
          </div>
          <div>
            <div style="font-size:0.82rem;font-weight:700;color:#93C5FD;margin-bottom:5px;">📈 Tendência</div>
            <p style="color:#64748B;font-size:0.78rem;line-height:1.5;margin:0;">Compara os últimos 3 meses com os 3 anteriores. Se o saldo mensal cresceu, a tendência é positiva; se caiu, é negativa.</p>
          </div>
          <div>
            <div style="font-size:0.82rem;font-weight:700;color:#93C5FD;margin-bottom:5px;">🎯 Projeção</div>
            <p style="color:#64748B;font-size:0.78rem;line-height:1.5;margin:0;">Aplica a média mensal à frente para estimar o saldo acumulado em 6 e 12 meses. Inclui ajuste pela tendência detectada.</p>
          </div>
          <div>
            <div style="font-size:0.82rem;font-weight:700;color:#93C5FD;margin-bottom:5px;">🔒 Confiança</div>
            <p style="color:#64748B;font-size:0.78rem;line-height:1.5;margin:0;">Quanto mais meses lançados e mais estável o padrão, maior a confiança. Com menos de 3 meses, a confiança é baixa (< 40%).</p>
          </div>
        </div>
        <div style="margin-top:12px;padding:10px 14px;background:rgba(245,158,11,0.06);border:1px solid rgba(245,158,11,0.2);border-radius:8px;">
          <p style="color:#FDE68A;font-size:0.78rem;margin:0;line-height:1.5;">⚠️ <strong>Importante:</strong> A projeção é uma estimativa baseada no seu histórico. Eventos imprevistos (promoções, despesas extraordinárias, mudanças de renda) não são considerados. Use como referência, não como certeza.</p>
        </div>

        <!-- SIMULADOR DE CENÁRIOS -->
        <div style="margin-top:20px;background:rgba(47,191,113,0.05);border:1px solid rgba(47,191,113,0.2);border-radius:16px;padding:20px;">
          <div style="font-size:0.75rem;color:#888;text-transform:uppercase;letter-spacing:1px;margin-bottom:16px;">🎛️ Simulador de Cenários</div>
          <p style="font-size:0.82rem;color:#aaa;margin:0 0 16px;">Ajuste os controles e veja como mudanças impactam sua projeção de 12 meses.</p>
          
          <div style="display:grid;gap:16px;">
            <div>
              <div style="display:flex;justify-content:space-between;margin-bottom:6px;">
                <label style="font-size:0.82rem;color:#ccc;">💰 Aumento de Receita Mensal</label>
                <span id="slider-receita-val" style="font-size:0.82rem;color:#2FBF71;font-weight:700;">+R$ 0</span>
              </div>
              <input type="range" id="slider-receita" min="0" max="5000" step="100" value="0"
                style="width:100%;accent-color:#2FBF71;"
                oninput="VM._simularProjecao()">
            </div>
            <div>
              <div style="display:flex;justify-content:space-between;margin-bottom:6px;">
                <label style="font-size:0.82rem;color:#ccc;">💸 Redução de Despesas Mensais</label>
                <span id="slider-despesa-val" style="font-size:0.82rem;color:#ff6b6b;font-weight:700;">-R$ 0</span>
              </div>
              <input type="range" id="slider-despesa" min="0" max="3000" step="50" value="0"
                style="width:100%;accent-color:#ff6b6b;"
                oninput="VM._simularProjecao()">
            </div>
          </div>

          <div id="simulacao-resultado" style="margin-top:16px;"></div>
        </div>
      </div>
    `

    // Render inicial do gráfico
    setTimeout(() => renderGrafico(periodoSel), 100)

    this._selProjPeriodo = (p) => {
      periodoSel = p
      ;[6,12].forEach(pp => {
        const btn = document.getElementById(`btn-proj-${pp}`)
        if (btn) {
          btn.style.background = pp===p ? t.cor : 'rgba(255,255,255,0.05)'
          btn.style.color = pp===p ? '#fff' : '#888'
          btn.style.borderColor = pp===p ? t.cor : '#333'
        }
      })
      renderGrafico(p)
    }

    // Armazena dados para o simulador
    this._projecaoData = data
  },

  _simularProjecao() {
    const data = this._projecaoData
    if (!data) return
    const addReceita = parseInt(document.getElementById('slider-receita')?.value || '0')
    const redDesp    = parseInt(document.getElementById('slider-despesa')?.value || '0')
    const valRecEl   = document.getElementById('slider-receita-val')
    const valDespEl  = document.getElementById('slider-despesa-val')
    if (valRecEl) valRecEl.textContent = `+R$ ${addReceita.toLocaleString('pt-BR')}`
    if (valDespEl) valDespEl.textContent = `-R$ ${redDesp.toLocaleString('pt-BR')}`

    const mediaMensal = (data.media_mensal || 0) + addReceita + redDesp
    const proj6  = mediaMensal * 6
    const proj12 = mediaMensal * 12
    const fmt = (v) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
    const cor6  = proj6  >= 0 ? '#2FBF71' : '#ff6b6b'
    const cor12 = proj12 >= 0 ? '#2FBF71' : '#ff6b6b'
    const delta = addReceita + redDesp
    const deltaStr = delta >= 0 
      ? `+${fmt(delta)}/mês de saldo adicional`
      : `${fmt(delta)}/mês de impacto negativo`

    const el = document.getElementById('simulacao-resultado')
    if (!el) return
    el.innerHTML = `
      <div style="background:rgba(0,0,0,0.3);border-radius:12px;padding:16px;border:1px solid rgba(255,255,255,0.05);">
        <div style="font-size:0.78rem;color:#888;margin-bottom:12px;">Com essas mudanças: <strong style="color:#ddd;">${deltaStr}</strong></div>
        <div style="display:flex;gap:12px;flex-wrap:wrap;">
          <div style="flex:1;min-width:120px;background:rgba(255,255,255,0.03);border-radius:10px;padding:12px;text-align:center;">
            <div style="font-size:0.72rem;color:#888;margin-bottom:4px;">Saldo em 6 meses</div>
            <div style="font-size:1.2rem;font-weight:800;color:${cor6};">${fmt(proj6)}</div>
          </div>
          <div style="flex:1;min-width:120px;background:rgba(255,255,255,0.03);border-radius:10px;padding:12px;text-align:center;">
            <div style="font-size:0.72rem;color:#888;margin-bottom:4px;">Saldo em 12 meses</div>
            <div style="font-size:1.2rem;font-weight:800;color:${cor12};">${fmt(proj12)}</div>
          </div>
        </div>
        ${(addReceita > 0 || redDesp > 0) ? `<p style="font-size:0.75rem;color:#64748b;margin:12px 0 0;text-align:center;">📌 Baseado na sua média atual + ajuste de cenário</p>` : ''}
      </div>
    `
  },

  // ══════════════════════════════════════════════════════════════════════════
  // F5 — MODAL DE ASSINATURA / GATEWAY ASAAS
  // ══════════════════════════════════════════════════════════════════════════

  // Modal de Pricing — comparação completa FREE / PREMIUM / PRO
  openPricingModal() {
    const planoAtual = this.user?.plano || 'free'
    const planos = [
      {
        id: 'free', nome: 'Free', emoji: '🌱', preco: 'R$ 0', periodo: 'para sempre',
        cor: '#64748b', corBtn: '#374151', textoBtn: 'Plano Atual',
        features: [
          'Dashboard completo',
          'Até 30 despesas/mês',
          'Até 10 receitas/mês',
          'Até 3 metas financeiras',
          'Até 2 cartões e 5 lembretes',
          'Reserva de emergência',
          'Conquistas e gamificação',
          { neg: 'Score financeiro' },
          { neg: 'Orçamentos por categoria' },
          { neg: 'Recorrências automáticas' },
          { neg: 'Projeção financeira' },
          { neg: 'IA personalizada' },
        ]
      },
      {
        id: 'premium', nome: 'Premium', emoji: '💎', preco: 'R$ 17,90', periodo: '/mês',
        cor: '#3B82F6', corBtn: 'linear-gradient(135deg,#3B82F6,#2563EB)', textoBtn: 'Assinar Premium',
        destaque: true, destaque_label: '🔥 MAIS POPULAR',
        features: [
          'Tudo do Free, sem limites',
          'Despesas, receitas ilimitadas',
          'Metas e cartões ilimitados',
          '📊 Orçamentos por categoria + alertas',
          '🔄 Recorrências automáticas',
          '🔮 Projeção financeira inteligente',
          '🧠 Score de saúde financeira',
          '🤖 IA personalizada e insights',
          '📋 Relatórios e simulações',
          '📄 Exportação em PDF',
          '🏆 Conquistas em tempo real',
        ]
      },
      {
        id: 'pro', nome: 'Pro', emoji: '🚀', preco: 'R$ 37,90', periodo: '/mês',
        cor: '#F59E0B', corBtn: 'linear-gradient(135deg,#F59E0B,#D97706)', textoBtn: 'Assinar Pro',
        features: [
          'Tudo do Premium',
          '👨‍👩‍👧 Multi-usuário familiar (até 3)',
          '💼 Múltiplas reservas de emergência',
          '📅 Fluxo de caixa futuro detalhado',
          '⚡ Simulador de amortização avançado',
          '📞 Consultoria financeira (30min/mês)',
          '💬 Suporte prioritário via WhatsApp',
          '🔌 Acesso à API REST',
        ]
      }
    ]

    this.showModal(`
      <div>
        <div style="text-align:center;margin-bottom:20px;">
          <div style="font-size:1.4rem;font-weight:800;margin-bottom:4px;">Escolha seu plano</div>
          <div style="color:#888;font-size:0.85rem;">Cancele quando quiser · Sem burocracia</div>
        </div>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:16px;">
          ${planos.map(p => {
            const isAtual = planoAtual === p.id
            const podeUpgrade = planoAtual !== p.id && p.id !== 'free'
            return `
              <div style="border:2px solid ${p.destaque ? p.cor : isAtual ? p.cor : '#1f2937'};border-radius:12px;padding:16px;background:${p.destaque ? p.cor+'10' : 'rgba(255,255,255,0.02)'};position:relative;">
                ${p.destaque ? `<div style="position:absolute;top:-10px;left:50%;transform:translateX(-50%);background:${p.cor};color:#fff;font-size:0.6rem;font-weight:700;padding:3px 10px;border-radius:20px;white-space:nowrap;">${p.destaque_label}</div>` : ''}
                <div style="text-align:center;margin-bottom:12px;">
                  <div style="font-size:1.6rem;">${p.emoji}</div>
                  <div style="font-size:0.85rem;font-weight:700;margin-top:4px;">${p.nome}</div>
                  <div style="font-size:1.3rem;font-weight:800;color:${p.cor};margin-top:4px;">${p.preco}</div>
                  <div style="font-size:0.65rem;color:#666;">${p.periodo}</div>
                </div>
                <div style="display:flex;flex-direction:column;gap:4px;margin-bottom:14px;">
                  ${p.features.map(f => typeof f === 'string'
                    ? `<div style="font-size:0.7rem;color:#94a3b8;display:flex;gap:6px;align-items:flex-start;"><span style="color:${p.cor};flex-shrink:0;">✓</span><span>${f}</span></div>`
                    : `<div style="font-size:0.7rem;color:#475569;display:flex;gap:6px;align-items:flex-start;"><span style="color:#374151;flex-shrink:0;">✕</span><span style="text-decoration:line-through;">${f.neg}</span></div>`
                  ).join('')}
                </div>
                ${isAtual
                  ? `<div style="text-align:center;padding:8px;background:${p.cor}15;border:1px solid ${p.cor}33;border-radius:8px;font-size:0.75rem;font-weight:700;color:${p.cor};">✓ Plano Atual</div>`
                  : podeUpgrade
                  ? `<button onclick="VM.closeModal();VM.openUpgradeModal('${p.id}')" style="width:100%;background:${p.corBtn};color:#fff;border:none;border-radius:8px;padding:9px;font-size:0.8rem;font-weight:700;cursor:pointer;">${p.textoBtn}</button>`
                  : `<div style="text-align:center;padding:8px;border:1px solid #1f2937;border-radius:8px;font-size:0.75rem;color:#555;">${p.textoBtn}</div>`
                }
              </div>`
          }).join('')}
        </div>
        <div style="text-align:center;color:#555;font-size:0.72rem;">🔒 Pagamento seguro via Asaas · Pix, Boleto ou Cartão · SSL 256-bit</div>
      </div>
    `)
    // Expandir o modal para caber os 3 planos
    setTimeout(() => {
      const card = document.querySelector('.modal-card')
      if (card) card.style.maxWidth = '780px'
    }, 50)
  },

  openUpgradeModal(planoAlvo) {
    const planoAtual = this.user?.plano || 'free'
    if (planoAlvo === planoAtual) return

    const config = {
      premium: {
        nome: 'Premium', valor: 'R$ 17,90/mês', cor: '#3B82F6',
        features: ['Lançamentos ilimitados', 'Score de saúde financeira', 'IA personalizada', 'Orçamentos por categoria', 'Recorrências automáticas', 'Projeção financeira', 'Relatórios PDF']
      },
      pro: {
        nome: 'Pro', valor: 'R$ 37,90/mês', cor: '#F59E0B',
        features: ['Tudo do Premium', 'Multi-usuário familiar', 'Múltiplas reservas', 'Simulador avançado', 'Suporte WhatsApp', 'Consultoria mensal']
      }
    }
    const cfg = config[planoAlvo] || config.premium

    this.showModal(`
      <div style="text-align:center;margin-bottom:20px;">
        <div style="font-size:2.5rem;margin-bottom:8px;">⭐</div>
        <div style="font-size:1.2rem;font-weight:700;">Assinar ${cfg.nome}</div>
        <div style="font-size:1.5rem;font-weight:800;color:${cfg.cor};margin-top:4px;">${cfg.valor}</div>
      </div>

      <div style="background:rgba(255,255,255,0.02);border:1px solid #1f2937;border-radius:10px;padding:14px;margin-bottom:18px;">
        ${cfg.features.map(f => `<div style="font-size:0.8rem;color:#94a3b8;padding:4px 0;display:flex;align-items:center;gap:8px;"><span style="color:${cfg.cor};">✓</span> ${f}</div>`).join('')}
      </div>

      <div style="display:flex;flex-direction:column;gap:12px;">
        <div>
          <label style="font-size:0.75rem;color:#888;display:block;margin-bottom:4px;">CPF (obrigatório)</label>
          <input id="asm-cpf" type="text" placeholder="000.000.000-00" maxlength="14" style="background:#0d1117;border:1px solid #2a2a3e;color:#e0e0e0;border-radius:8px;padding:9px 12px;font-size:0.85rem;width:100%;" oninput="this.value=this.value.replace(/\\D/g,'').replace(/(\\d{3})(\\d{3})(\\d{3})(\\d{2})/,'$1.$2.$3-$4').slice(0,14)">
        </div>
        <div>
          <label style="font-size:0.75rem;color:#888;display:block;margin-bottom:6px;">Forma de Pagamento</label>
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;">
            ${[
              { val:'PIX', icon:'fas fa-qrcode', label:'Pix', desc:'Aprovação imediata' },
              { val:'BOLETO', icon:'fas fa-barcode', label:'Boleto', desc:'3 dias úteis' },
              { val:'CREDIT_CARD', icon:'fas fa-credit-card', label:'Cartão', desc:'Parcelamento' }
            ].map((f,i) => `
              <label style="display:flex;flex-direction:column;align-items:center;gap:4px;padding:10px 8px;background:${i===0?'rgba(59,130,246,0.1)':'rgba(255,255,255,0.03)'};border:2px solid ${i===0?'#3B82F6':'#1f2937'};border-radius:8px;cursor:pointer;text-align:center;transition:all 0.2s;" id="pay-opt-${f.val}" onclick="VM._selPagamento('${f.val}')">
                <input type="radio" name="forma-pag" value="${f.val}" ${i===0?'checked':''} style="display:none;">
                <i class="${f.icon}" style="font-size:1.2rem;color:${i===0?'#3B82F6':'#666'}" id="pay-icon-${f.val}"></i>
                <span style="font-size:0.72rem;font-weight:700;color:${i===0?'#e0e0e0':'#666'}" id="pay-lbl-${f.val}">${f.label}</span>
                <span style="font-size:0.62rem;color:#555;">${f.desc}</span>
              </label>`).join('')}
          </div>
        </div>
        <div id="asm-err" style="display:none;color:#F43F5E;font-size:0.78rem;text-align:center;"></div>
        <button id="btn-assinar" onclick="VM._confirmarAssinatura('${planoAlvo}')" class="btn-primary" style="width:100%;justify-content:center;padding:12px;font-size:0.95rem;">
          🔒 Assinar com Segurança
        </button>
        <div style="font-size:0.7rem;color:#555;text-align:center;">Cancelamento a qualquer momento · Dados protegidos · SSL 256-bit</div>
      </div>
    `)
    this._formaPag = 'PIX'
  },

  _selPagamento(forma) {
    this._formaPag = forma
    ;['PIX','BOLETO','CREDIT_CARD'].forEach(f => {
      const opt = document.getElementById(`pay-opt-${f}`)
      const icon = document.getElementById(`pay-icon-${f}`)
      const lbl = document.getElementById(`pay-lbl-${f}`)
      if (opt) {
        const sel = f === forma
        opt.style.background = sel ? 'rgba(59,130,246,0.1)' : 'rgba(255,255,255,0.03)'
        opt.style.borderColor = sel ? '#3B82F6' : '#1f2937'
        if (icon) icon.style.color = sel ? '#3B82F6' : '#666'
        if (lbl) lbl.style.color = sel ? '#e0e0e0' : '#666'
      }
    })
  },

  async _confirmarAssinatura(plano) {
    const cpf = (document.getElementById('asm-cpf')?.value || '').replace(/\D/g,'')
    const errEl = document.getElementById('asm-err')
    if (cpf.length !== 11) {
      if (errEl) { errEl.textContent = '⚠️ CPF inválido. Informe 11 dígitos.'; errEl.style.display='block' }
      return
    }
    if (errEl) errEl.style.display = 'none'

    const btn = document.getElementById('btn-assinar')
    if (btn) { btn.textContent = '⏳ Processando...'; btn.disabled = true }

    const r = await this.api('POST', 'asaas/checkout', { plano, forma_pagamento: this._formaPag || 'PIX', cpf })

    if (r.error) {
      if (errEl) { errEl.textContent = '❌ ' + r.error; errEl.style.display='block' }
      if (btn) { btn.textContent = '🔒 Assinar com Segurança'; btn.disabled = false }
      return
    }

    this.closeModal()

    if (this._formaPag === 'PIX' && r.pix_copia_cola) {
      this.showModal(`
        <div style="text-align:center;padding:8px 0;">
          <div style="font-size:2rem;margin-bottom:8px;">🔲</div>
          <div style="font-size:1.1rem;font-weight:700;margin-bottom:4px;">Pagar via Pix</div>
          <div style="color:#666;font-size:0.82rem;margin-bottom:16px;">Copie o código abaixo e pague no seu banco</div>
          <div style="background:#0d1117;border:1px solid #2a2a3e;border-radius:8px;padding:12px;font-size:0.72rem;color:#94a3b8;word-break:break-all;margin-bottom:12px;text-align:left;">${r.pix_copia_cola}</div>
          <button onclick="navigator.clipboard.writeText('${r.pix_copia_cola}');VM.toast('✅ Código copiado!')" class="btn-primary" style="width:100%;justify-content:center;margin-bottom:8px;">📋 Copiar Código Pix</button>
          ${r.checkout_url ? `<a href="${r.checkout_url}" target="_blank" style="display:block;text-align:center;color:#74b9ff;font-size:0.8rem;">Abrir página de pagamento →</a>` : ''}
          ${r.aviso ? `<div style="color:#F59E0B;font-size:0.72rem;margin-top:12px;">⚠️ ${r.aviso}</div>` : ''}
        </div>
      `)
    } else if (r.checkout_url) {
      window.open(r.checkout_url, '_blank')
      this.toast('✅ Redirecionando para pagamento...')
    } else {
      this.toast(r.aviso || '✅ Pedido registrado! Aguarde confirmação.')
    }
  },

  // ── Bloco de Upsell (reutilizável) ─────────────────────────────────────────
  upsellBlock(feature, titulo, desc, beneficios) {
    return `
      <div style="max-width:540px;margin:60px auto;text-align:center;">
        <div style="background:rgba(16,185,129,0.06);border:1px solid rgba(16,185,129,0.2);border-radius:20px;padding:40px 36px;">
          <div style="font-size:3rem;margin-bottom:12px;">🔒</div>
          <div style="font-size:1.3rem;font-weight:700;margin-bottom:8px;">${titulo}</div>
          <div style="color:#94a3b8;font-size:0.9rem;line-height:1.6;margin-bottom:24px;">${desc}</div>
          <div style="text-align:left;background:rgba(255,255,255,0.02);border-radius:10px;padding:16px;margin-bottom:24px;">
            ${beneficios.map(b => `<div style="display:flex;align-items:center;gap:10px;padding:6px 0;font-size:0.84rem;color:#94a3b8;"><span style="color:#10B981;font-size:1rem;">✓</span> ${b}</div>`).join('')}
          </div>
          <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap;">
            <button onclick="VM.openPricingModal()" style="background:linear-gradient(135deg,#3B82F6,#2563EB);color:#fff;border:none;border-radius:10px;padding:12px 24px;font-size:0.9rem;font-weight:700;cursor:pointer;">
              🌟 Ver Planos e Preços
            </button>
          </div>
        </div>
      </div>
    `
  },



  closeModal(event) {
    if (event && event.target !== event.currentTarget) return
    document.getElementById('modal-container').innerHTML = ''
    // Restaurar scroll do body ao fechar modal
    document.body.style.overflow = ''
  },


  // ═══════════════════════════════════════════════════════════════
  // v3.0 — MÚLTIPLAS RESERVAS ESPECIALIZADAS
  // ═══════════════════════════════════════════════════════════════
  async pageReservasEsp() {
    const content = document.getElementById('page-content')
    content.innerHTML = `<div class="empty-state"><div class="skeleton" style="height:200px;margin-bottom:16px;border-radius:16px;"></div><div class="skeleton" style="height:300px;border-radius:16px;"></div></div>`
    
    try {
      const data = await this.api('GET', 'reservas-esp')
      const { reserves = [], summary = {} } = data
      const fmtBRL = v => (v||0).toLocaleString('pt-BR', {minimumFractionDigits:2,maximumFractionDigits:2})
      
      const RESERVE_INFO = {
        emergency:    { icon:'🚨', color:'#EF4444', label:'Emergência Geral',     desc:'Proteção contra imprevistos gerais' },
        health:       { icon:'🏥', color:'#3B82F6', label:'Fundo Saúde',          desc:'Consultas, exames e medicamentos' },
        unemployment: { icon:'💼', color:'#F59E0B', label:'Proteção Desemprego',  desc:'Até 12 meses de gastos essenciais' },
        travel:       { icon:'✈️', color:'#8B5CF6', label:'Viagem dos Sonhos',    desc:'Realize aquela viagem especial' },
        education:    { icon:'🎓', color:'#06B6D4', label:'Educação / Cursos',    desc:'Invista no seu crescimento' },
        vehicle:      { icon:'🚗', color:'#84CC16', label:'IPVA & Manutenção',    desc:'Evite surpresas com o carro' },
        family:       { icon:'🏠', color:'#F97316', label:'Imprevistos Familiares',desc:'Proteção para a família' },
        event:        { icon:'💍', color:'#EC4899', label:'Eventos Especiais',    desc:'Casamento, festa, formatura' },
        custom:       { icon:'🎯', color:'#6366F1', label:'Reserva Personalizada',desc:'Seu objetivo específico' },
      }
      
      const urgColor = pct => pct >= 80 ? '#10B981' : pct >= 50 ? '#F59E0B' : '#EF4444'
      const urgLabel = pct => pct >= 80 ? '✅ Quase lá' : pct >= 50 ? '⚡ Em progresso' : '⚠️ Atenção'
      
      const planLimit = this.user?.plano === 'free' ? 1 : this.user?.plano === 'premium' ? 3 : 99
      const canCreate = reserves.filter(r => r.status === 'active' || r.status === 'paused').length < planLimit
      
      content.innerHTML = `
        <div style="max-width:1100px;">
          <!-- Header -->
          <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:28px;flex-wrap:wrap;gap:12px;">
            <div>
              <h1 style="font-size:1.8rem;font-weight:800;color:#f1f5f9;margin:0 0 6px;">🛡️ Minhas Reservas</h1>
              <p style="color:#64748B;margin:0;">Organize suas economias por objetivos — cada "caixinha" tem seu propósito.</p>
            </div>
            <button onclick="VM.modalNovaReserva()" 
              style="background:linear-gradient(135deg,#10B981,#059669);color:#fff;border:none;padding:12px 24px;border-radius:12px;font-weight:700;cursor:pointer;font-size:0.9rem;display:flex;align-items:center;gap:8px;"
              ${!canCreate ? 'disabled style="background:#1f2937;color:#555;border:none;padding:12px 24px;border-radius:12px;font-weight:700;cursor:not-allowed;font-size:0.9rem;"' : ''}>
              ＋ Nova Reserva
            </button>
          </div>
          
          ${!canCreate ? `
          <div style="background:rgba(139,92,246,0.1);border:1px solid rgba(139,92,246,0.3);border-radius:12px;padding:14px 18px;margin-bottom:20px;display:flex;align-items:center;gap:12px;">
            <span style="font-size:1.4rem;">⭐</span>
            <div>
              <p style="color:#A78BFA;font-weight:700;margin:0 0 2px;">Limite de plano atingido</p>
              <p style="color:#94A3B8;font-size:0.82rem;margin:0;">
                ${this.user?.plano === 'free' ? 'Plano Free: 1 reserva. <b>Premium</b>: 3 reservas. <b>Pro</b>: ilimitado.' : 'Plano Premium: 3 reservas. <b>Pro</b>: ilimitado.'}
                <a href="#" onclick="VM.upsellModal('multi_reserva');return false;" style="color:#A78BFA;font-weight:700;"> Fazer upgrade →</a>
              </p>
            </div>
          </div>` : ''}
          
          <!-- Summary Cards -->
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:14px;margin-bottom:28px;">
            <div style="background:rgba(16,185,129,0.08);border:1px solid rgba(16,185,129,0.2);border-radius:14px;padding:18px;">
              <div style="color:#6EE7B7;font-size:0.75rem;font-weight:600;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;">💰 Total Guardado</div>
              <div style="font-size:1.8rem;font-weight:800;color:#10B981;font-family:'JetBrains Mono',monospace;">R$ ${fmtBRL(summary.total_saved)}</div>
              <div style="color:#64748B;font-size:0.78rem;margin-top:4px;">${summary.active_count || 0} reserva${summary.active_count !== 1 ? 's' : ''} ativa${summary.active_count !== 1 ? 's' : ''}</div>
            </div>
            <div style="background:rgba(59,130,246,0.08);border:1px solid rgba(59,130,246,0.2);border-radius:14px;padding:18px;">
              <div style="color:#93C5FD;font-size:0.75rem;font-weight:600;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;">🎯 Meta Total</div>
              <div style="font-size:1.8rem;font-weight:800;color:#60A5FA;font-family:'JetBrains Mono',monospace;">R$ ${fmtBRL(summary.total_target)}</div>
              <div style="color:#64748B;font-size:0.78rem;margin-top:4px;">${summary.completed_count || 0} completada${summary.completed_count !== 1 ? 's' : ''}</div>
            </div>
            <div style="background:rgba(139,92,246,0.08);border:1px solid rgba(139,92,246,0.2);border-radius:14px;padding:18px;">
              <div style="color:#C4B5FD;font-size:0.75rem;font-weight:600;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;">📊 Progresso Geral</div>
              <div style="font-size:1.8rem;font-weight:800;color:#A78BFA;">${summary.overall_progress || 0}%</div>
              <div style="background:#1e293b;border-radius:50px;height:6px;margin-top:8px;overflow:hidden;">
                <div style="height:100%;width:${summary.overall_progress || 0}%;background:linear-gradient(90deg,#8B5CF6,#A78BFA);border-radius:50px;transition:width 1s ease;"></div>
              </div>
            </div>
            <div style="background:rgba(244,63,94,0.08);border:1px solid rgba(244,63,94,0.2);border-radius:14px;padding:18px;">
              <div style="color:#FDA4AF;font-size:0.75rem;font-weight:600;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;">📉 Ainda Falta</div>
              <div style="font-size:1.8rem;font-weight:800;color:#F43F5E;font-family:'JetBrains Mono',monospace;">R$ ${fmtBRL(summary.total_remaining)}</div>
            </div>
          </div>
          
          <!-- Grid de Reservas -->
          ${reserves.length === 0 ? `
          <div style="text-align:center;padding:60px 20px;background:rgba(255,255,255,0.02);border:2px dashed #1f2937;border-radius:20px;">
            <div style="font-size:4rem;margin-bottom:16px;">🛡️</div>
            <h2 style="color:#f1f5f9;font-size:1.3rem;font-weight:700;margin-bottom:8px;">Crie sua primeira reserva</h2>
            <p style="color:#64748B;margin:0 0 20px;max-width:400px;margin-left:auto;margin-right:auto;">
              Objectivos específicos têm 3× mais chances de sucesso. Cada "caixinha" mantém o dinheiro protegido para sua finalidade.
            </p>
            <button onclick="VM.modalNovaReserva()" style="background:linear-gradient(135deg,#10B981,#059669);color:#fff;border:none;padding:12px 28px;border-radius:12px;font-weight:700;cursor:pointer;">
              ＋ Criar Primeira Reserva
            </button>
          </div>
          ` : `
          <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:18px;">
            ${reserves.map(r => {
              const info = RESERVE_INFO[r.type] || RESERVE_INFO.custom
              const pct = r.percent_complete || 0
              const barColor = pct >= 80 ? '#10B981' : pct >= 50 ? '#F59E0B' : '#EF4444'
              const months = r.monthly_target && r.remaining > 0
                ? Math.ceil(r.remaining / r.monthly_target)
                : null
              return `
              <div style="background:rgba(15,23,42,0.85);border:2px solid rgba(255,255,255,0.06);border-radius:18px;padding:22px;transition:all 0.2s;cursor:default;"
                onmouseover="this.style.borderColor='${info.color}44';this.style.transform='translateY(-2px)'"
                onmouseout="this.style.borderColor='rgba(255,255,255,0.06)';this.style.transform='translateY(0)'">
                <!-- Header -->
                <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:14px;">
                  <div style="display:flex;align-items:center;gap:12px;">
                    <div style="width:46px;height:46px;background:${info.color}20;border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:1.5rem;flex-shrink:0;">${info.icon}</div>
                    <div>
                      <div style="font-weight:700;color:#f1f5f9;font-size:1rem;">${r.name}</div>
                      <div style="font-size:0.72rem;color:#64748B;margin-top:2px;">${info.desc}</div>
                    </div>
                  </div>
                  <span style="background:${barColor}22;color:${barColor};font-size:0.65rem;padding:3px 8px;border-radius:50px;font-weight:700;white-space:nowrap;">${urgLabel(pct)}</span>
                </div>
                
                <!-- Progress -->
                <div style="margin-bottom:14px;">
                  <div style="display:flex;justify-content:space-between;font-size:0.78rem;margin-bottom:6px;">
                    <span style="color:#94A3B8;">Progresso</span>
                    <span style="color:#f1f5f9;font-weight:700;">${pct}%</span>
                  </div>
                  <div style="background:#1e293b;border-radius:50px;height:8px;overflow:hidden;">
                    <div style="height:100%;width:${pct}%;background:linear-gradient(90deg,${barColor},${barColor}cc);border-radius:50px;transition:width 1s ease;"></div>
                  </div>
                </div>
                
                <!-- Values -->
                <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:14px;">
                  <div style="background:#0f172a;border-radius:10px;padding:10px;text-align:center;">
                    <div style="font-size:0.65rem;color:#64748B;margin-bottom:4px;">💰 Guardado</div>
                    <div style="font-size:0.85rem;font-weight:700;color:#10B981;font-family:'JetBrains Mono',monospace;">R$ ${fmtBRL(r.current_amount)}</div>
                  </div>
                  <div style="background:#0f172a;border-radius:10px;padding:10px;text-align:center;">
                    <div style="font-size:0.65rem;color:#64748B;margin-bottom:4px;">🎯 Meta</div>
                    <div style="font-size:0.85rem;font-weight:700;color:#94A3B8;font-family:'JetBrains Mono',monospace;">R$ ${fmtBRL(r.target_amount)}</div>
                  </div>
                  <div style="background:#0f172a;border-radius:10px;padding:10px;text-align:center;">
                    <div style="font-size:0.65rem;color:#64748B;margin-bottom:4px;">📉 Falta</div>
                    <div style="font-size:0.85rem;font-weight:700;color:#F43F5E;font-family:'JetBrains Mono',monospace;">R$ ${fmtBRL(r.remaining)}</div>
                  </div>
                </div>
                
                ${months ? `
                <div style="background:#0f172a;border-radius:10px;padding:10px;margin-bottom:14px;display:flex;align-items:center;gap:8px;">
                  <span style="color:#10B981;font-size:1rem;">⚡</span>
                  <div>
                    <div style="font-size:0.7rem;color:#64748B;">Contribuição Sugerida</div>
                    <div style="font-size:0.9rem;font-weight:700;color:#10B981;">R$ ${fmtBRL(r.monthly_target)}/mês → completa em ${months} meses</div>
                  </div>
                </div>` : ''}
                
                <!-- Actions -->
                <div style="display:grid;grid-template-columns:1fr auto auto;gap:8px;">
                  <button onclick="VM.modalDepositoReservaEsp(${r.id}, '${r.name.replace(/'/g,"\'")}', ${r.target_amount - r.current_amount})"
                    style="background:linear-gradient(135deg,${info.color},${info.color}cc);color:#fff;border:none;padding:10px;border-radius:10px;font-weight:700;cursor:pointer;font-size:0.8rem;">
                    ＋ Depositar
                  </button>
                  <button onclick="VM.modalEditarReservaEsp(${r.id})"
                    title="Editar"
                    style="background:#1e293b;color:#94A3B8;border:none;padding:10px 12px;border-radius:10px;cursor:pointer;font-size:0.85rem;">✏️</button>
                  <button onclick="VM.deletarReservaEsp(${r.id}, '${r.name.replace(/'/g,"\'")}', ${r.current_amount})"
                    title="Excluir"
                    style="background:#1e293b;color:#94A3B8;border:none;padding:10px 12px;border-radius:10px;cursor:pointer;font-size:0.85rem;">🗑️</button>
                </div>
              </div>`
            }).join('')}
          </div>
          `}
          
          <!-- Educação -->
          <div style="background:linear-gradient(135deg,rgba(16,185,129,0.08),rgba(59,130,246,0.08));border:1px solid rgba(16,185,129,0.2);border-radius:16px;padding:24px;margin-top:28px;">
            <h3 style="color:#f1f5f9;font-size:1rem;font-weight:700;margin:0 0 16px;display:flex;align-items:center;gap:8px;">📚 Por que ter múltiplas reservas?</h3>
            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:16px;">
              <div>
                <h4 style="color:#6EE7B7;font-size:0.85rem;font-weight:700;margin:0 0 6px;">🧠 Psicologia Comportamental</h4>
                <p style="color:#94A3B8;font-size:0.82rem;line-height:1.5;margin:0;">Objetivos específicos (ex: "Viagem Disney") são 3× mais motivadores que genéricos ("Emergência"). Seu cérebro visualiza melhor o resultado.</p>
              </div>
              <div>
                <h4 style="color:#93C5FD;font-size:0.85rem;font-weight:700;margin:0 0 6px;">💰 Proteção do Objetivo</h4>
                <p style="color:#94A3B8;font-size:0.82rem;line-height:1.5;margin:0;">Separar por finalidade evita usar dinheiro da emergência para viagem. Cada "caixinha" tem seu propósito protegido.</p>
              </div>
            </div>
          </div>
        </div>
      `
    } catch (e) {
      document.getElementById('page-content').innerHTML = `<div class="empty-state"><p style="color:#F43F5E;">Erro ao carregar: ${e.message}</p></div>`
    }
  },
  
  async modalNovaReserva() {
    const tipos = [
      { v:'emergency',    l:'🚨 Emergência Geral',      d:'3-6 meses de gastos' },
      { v:'health',       l:'🏥 Fundo Saúde',           d:'Consultas e medicamentos' },
      { v:'unemployment', l:'💼 Proteção Desemprego',   d:'Até 12 meses de gastos' },
      { v:'travel',       l:'✈️ Viagem dos Sonhos',     d:'Sua próxima aventura' },
      { v:'education',    l:'🎓 Educação / Cursos',     d:'Invista em você mesmo' },
      { v:'vehicle',      l:'🚗 IPVA & Manutenção',     d:'Custos previsíveis do carro' },
      { v:'family',       l:'🏠 Imprevistos Familiares',d:'Proteção da família' },
      { v:'event',        l:'💍 Eventos Especiais',     d:'Casamento, formatura, festa' },
      { v:'custom',       l:'🎯 Personalizada',         d:'Seu objetivo específico' },
    ]
    
    this.showModal(`
      <h3 style="font-size:1.1rem;font-weight:700;margin-bottom:18px;color:#f1f5f9;">🛡️ Nova Reserva Especializada</h3>
      <form onsubmit="VM.salvarNovaReservaEsp(event)">
        <div class="form-group">
          <label class="form-label">Tipo de Reserva</label>
          <select id="res-type" class="form-input" onchange="VM.atualizarNomeReserva()" required>
            ${tipos.map(t => `<option value="${t.v}">${t.l} — ${t.d}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Nome</label>
          <input type="text" id="res-name" class="form-input" placeholder="Ex: Viagem para Europa 2025" value="" required>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
          <div class="form-group">
            <label class="form-label">Valor Meta (R$)</label>
            <input type="number" id="res-target" class="form-input" placeholder="10000" step="0.01" min="1" required>
          </div>
          <div class="form-group">
            <label class="form-label">Já tenho (R$)</label>
            <input type="number" id="res-current" class="form-input" placeholder="0" step="0.01" min="0" value="0">
          </div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
          <div class="form-group">
            <label class="form-label">Contribuição Mensal (R$)</label>
            <input type="number" id="res-monthly" class="form-input" placeholder="500" step="0.01" min="0">
          </div>
          <div class="form-group">
            <label class="form-label">Prazo (opcional)</label>
            <input type="date" id="res-deadline" class="form-input">
          </div>
        </div>
        <button type="submit" class="btn-primary" style="width:100%;margin-top:8px;">Criar Reserva</button>
      </form>
    `)
    
    // Preencher nome padrão
    this.atualizarNomeReserva()
  },
  
  atualizarNomeReserva() {
    const el = document.getElementById('res-type')
    const names = {
      emergency:'Reserva de Emergência', health:'Fundo Saúde', unemployment:'Proteção Desemprego',
      travel:'Minha Viagem dos Sonhos', education:'Fundo Educação', vehicle:'IPVA & Manutenção',
      family:'Imprevistos Familiares', event:'Evento Especial', custom:'Minha Reserva'
    }
    const nameEl = document.getElementById('res-name')
    if (nameEl && !nameEl.dataset.touched) {
      nameEl.value = names[el?.value] || 'Minha Reserva'
    }
  },
  
  async salvarNovaReservaEsp(e) {
    e.preventDefault()
    const btn = e.target.querySelector('button[type=submit]')
    btn.disabled = true; btn.textContent = 'Criando...'
    
    try {
      const payload = {
        type: document.getElementById('res-type').value,
        name: document.getElementById('res-name').value,
        target_amount: parseFloat(document.getElementById('res-target').value),
        current_amount: parseFloat(document.getElementById('res-current').value) || 0,
        monthly_target: parseFloat(document.getElementById('res-monthly').value) || null,
        deadline: document.getElementById('res-deadline').value || null,
      }
      await this.api('POST', 'reservas-esp', payload)
      this.closeModal()
      this.toast('🛡️ Reserva criada com sucesso!', 'success')
      this.pageReservasEsp()
    } catch (err) {
      btn.disabled = false; btn.textContent = 'Criar Reserva'
      this.toast(err.message || 'Erro ao criar reserva', 'error')
    }
  },
  
  async modalDepositoReservaEsp(id, name, maxAmount) {
    const fmtBRL = v => (v||0).toLocaleString('pt-BR', {minimumFractionDigits:2,maximumFractionDigits:2})
    this.showModal(`
      <h3 style="font-size:1.1rem;font-weight:700;margin-bottom:6px;color:#f1f5f9;">💰 Depositar em "${name}"</h3>
      <p style="color:#64748B;font-size:0.82rem;margin-bottom:18px;">Ainda faltam R$ ${fmtBRL(maxAmount)} para completar esta reserva.</p>
      <form onsubmit="VM.confirmarDepositoReservaEsp(event, ${id})">
        <div class="form-group">
          <label class="form-label">Valor do Depósito (R$)</label>
          <input type="number" id="dep-amount" class="form-input" placeholder="500.00" step="0.01" min="0.01" max="${maxAmount}" required autofocus>
        </div>
        <div class="form-group">
          <label class="form-label">Descrição (opcional)</label>
          <input type="text" id="dep-desc" class="form-input" placeholder="Ex: Salário março">
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:8px;">
          <button type="button" onclick="VM.closeModal()" class="btn-secondary">Cancelar</button>
          <button type="submit" class="btn-primary">💰 Depositar</button>
        </div>
      </form>
    `)
  },
  
  async confirmarDepositoReservaEsp(e, id) {
    e.preventDefault()
    const btn = e.target.querySelector('button[type=submit]')
    btn.disabled = true; btn.textContent = 'Depositando...'
    try {
      const resp = await this.api('POST', `reservas-esp/${id}/depositar`, {
        amount: parseFloat(document.getElementById('dep-amount').value),
        description: document.getElementById('dep-desc').value || 'Depósito'
      })
      this.closeModal()
      this.toast(resp.message || '✅ Depósito realizado!', resp.completed ? 'success' : 'success')
      this.pageReservasEsp()
    } catch (err) {
      btn.disabled = false; btn.textContent = '💰 Depositar'
      this.toast(err.message, 'error')
    }
  },
  
  async modalEditarReservaEsp(id) {
    // Buscar dados atuais
    const data = await this.api('GET', 'reservas-esp')
    const r = (data.reserves || []).find(x => x.id === id)
    if (!r) return this.toast('Reserva não encontrada', 'error')
    
    this.showModal(`
      <h3 style="font-size:1.1rem;font-weight:700;margin-bottom:18px;color:#f1f5f9;">✏️ Editar Reserva</h3>
      <form onsubmit="VM.confirmarEdicaoReservaEsp(event, ${id})">
        <div class="form-group">
          <label class="form-label">Nome</label>
          <input type="text" id="edit-res-name" class="form-input" value="${r.name}" required>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
          <div class="form-group">
            <label class="form-label">Meta (R$)</label>
            <input type="number" id="edit-res-target" class="form-input" value="${r.target_amount}" step="0.01" min="1" required>
          </div>
          <div class="form-group">
            <label class="form-label">Contribuição Mensal</label>
            <input type="number" id="edit-res-monthly" class="form-input" value="${r.monthly_target || ''}" step="0.01" min="0">
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">Prazo</label>
          <input type="date" id="edit-res-deadline" class="form-input" value="${r.deadline || ''}">
        </div>
        <button type="submit" class="btn-primary" style="width:100%;margin-top:8px;">💾 Salvar Alterações</button>
      </form>
    `)
  },
  
  async confirmarEdicaoReservaEsp(e, id) {
    e.preventDefault()
    const btn = e.target.querySelector('button[type=submit]')
    btn.disabled = true
    try {
      await this.api('PUT', `reservas-esp/${id}`, {
        name: document.getElementById('edit-res-name').value,
        target_amount: parseFloat(document.getElementById('edit-res-target').value),
        monthly_target: parseFloat(document.getElementById('edit-res-monthly').value) || null,
        deadline: document.getElementById('edit-res-deadline').value || null,
      })
      this.closeModal()
      this.toast('✅ Reserva atualizada!', 'success')
      this.pageReservasEsp()
    } catch (err) {
      btn.disabled = false
      this.toast(err.message, 'error')
    }
  },
  
  async deletarReservaEsp(id, name, currentAmount) {
    const fmtBRL = v => (v||0).toLocaleString('pt-BR', {minimumFractionDigits:2,maximumFractionDigits:2})
    const msgReserva = currentAmount > 0
      ? `Deseja excluir a reserva <strong>"${name}"</strong>?<br><br>⚠️ Você possui <strong>R$ ${fmtBRL(currentAmount)}</strong> nesta reserva. Certifique-se de transferir esse valor antes de excluir.`
      : `Deseja excluir a reserva <strong>"${name}"</strong>?`
    const ok = await this.vmConfirm(msgReserva, { titulo: 'Excluir Reserva', corBotao: '#ef4444', textoBotao: 'Excluir', icone: '🗑️' })
    if (!ok) return
    try {
      await this.api('DELETE', `reservas-esp/${id}`)
      this.toast('🗑️ Reserva removida', 'success')
      this.pageReservasEsp()
    } catch (err) {
      this.toast(err.message, 'error')
    }
  },

  // ═══════════════════════════════════════════════════════════════
  // v3.0 — DETECTOR DE ASSINATURAS FANTASMA
  // ═══════════════════════════════════════════════════════════════
  async pageAssinaturasFantasma(aba) {
    const content = document.getElementById('page-content')
    content.innerHTML = `<div class="empty-state"><div class="skeleton" style="height:180px;border-radius:16px;margin-bottom:16px;"></div></div>`
    const abaAtiva = aba || 'ativas'
    
    try {
      const [dataAtivas, dataCanceladas, dataReduzidas] = await Promise.all([
        this.api('GET', 'assinaturas-fantasma'),
        this.api('GET', 'assinaturas-fantasma/canceladas').catch(() => ({ canceladas: [], total_canceladas: 0, economia_acumulada: 0, projecao_12m: 0 })),
        this.api('GET', 'assinaturas-fantasma/precos-reduzidos').catch(() => ({ reduzidas: [], total_reduzidas: 0, economia_mensal_total: 0, economia_acumulada_total: 0 }))
      ])
      const { detected = [], totalMensal = 0, totalAnual = 0 } = dataAtivas
      const { canceladas = [], total_canceladas = 0, economia_acumulada = 0, projecao_12m = 0 } = dataCanceladas
      const { reduzidas = [], total_reduzidas = 0, economia_mensal_total = 0, economia_acumulada_total = 0, economia_anual_total = 0 } = dataReduzidas
      
      const fmtBRL = v => (v||0).toLocaleString('pt-BR', {minimumFractionDigits:2,maximumFractionDigits:2})
      const fmtDate = d => d ? new Date(d+'T12:00:00').toLocaleDateString('pt-BR') : '—'
      const serviceIcons = { streaming:'🎬', cloud:'☁️', software:'💻', fitness:'💪', transport:'🚗', food:'🍔', gaming:'🎮', professional:'💼', education:'🎓', unknown:'📱' }

      const tabBtn = (id, label, active) => `<button onclick="VM.pageAssinaturasFantasma('${id}')" style="padding:8px 18px;border-radius:8px;font-weight:700;font-size:0.85rem;cursor:pointer;transition:all 0.2s;${active?'background:rgba(139,92,246,0.2);color:#A78BFA;border:1px solid rgba(139,92,246,0.4);':'background:transparent;color:#64748B;border:1px solid rgba(255,255,255,0.08);'}">${label}</button>`

      const htmlAtivas = `
        ${detected.length > 0 ? `
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:14px;margin-bottom:24px;">
          <div style="background:rgba(139,92,246,0.1);border:1px solid rgba(139,92,246,0.3);border-radius:14px;padding:18px;">
            <div style="color:#C4B5FD;font-size:0.72rem;font-weight:600;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;">🔍 Detectadas</div>
            <div style="font-size:2.2rem;font-weight:800;color:#A78BFA;">${detected.filter(d=>d.status==='detected').length}</div>
            <div style="color:#64748B;font-size:0.75rem;">possíveis assinaturas</div>
          </div>
          <div style="background:rgba(244,63,94,0.1);border:1px solid rgba(244,63,94,0.3);border-radius:14px;padding:18px;">
            <div style="color:#FDA4AF;font-size:0.72rem;font-weight:600;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;">💸 Custo Mensal</div>
            <div style="font-size:2.2rem;font-weight:800;color:#F43F5E;">R$ ${fmtBRL(totalMensal)}</div>
            <div style="color:#64748B;font-size:0.75rem;">em possíveis desperdícios</div>
          </div>
          <div style="background:rgba(16,185,129,0.1);border:1px solid rgba(16,185,129,0.3);border-radius:14px;padding:18px;">
            <div style="color:#6EE7B7;font-size:0.72rem;font-weight:600;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;">✂️ Economia Anual</div>
            <div style="font-size:2.2rem;font-weight:800;color:#10B981;">R$ ${fmtBRL(totalAnual)}</div>
            <div style="color:#64748B;font-size:0.75rem;">se cancelar tudo</div>
          </div>
        </div>` : ''}
        ${detected.length === 0 ? `
        <div style="text-align:center;padding:60px 20px;background:rgba(255,255,255,0.02);border:2px dashed #1f2937;border-radius:20px;">
          <div style="font-size:4rem;margin-bottom:16px;">🕵️</div>
          <h2 style="color:#f1f5f9;font-size:1.3rem;font-weight:700;margin-bottom:8px;">Nenhuma assinatura detectada</h2>
          <p style="color:#64748B;margin:0 0 20px;">Clique em "Escanear Gastos" para analisar seus últimos 12 meses de despesas e encontrar padrões recorrentes.</p>
          <div style="background:rgba(59,130,246,0.08);border:1px solid rgba(59,130,246,0.2);border-radius:12px;padding:16px;max-width:480px;margin:0 auto;text-align:left;">
            <p style="color:#93C5FD;font-weight:700;margin:0 0 8px;">ℹ️ Como funciona?</p>
            <p style="color:#94A3B8;font-size:0.82rem;margin:0;line-height:1.6;">
              O algoritmo analisa despesas dos últimos 12 meses, identifica cobranças com nome e valor semelhantes que aparecem regularmente (mensal, trimestral ou anual). 
              Exige ao menos 4 ocorrências e confiança ≥ 60% para classificar como assinatura. A IA da OpenAI é usada para validar casos ambíguos.
            </p>
          </div>
        </div>` : `
        <div>
          <h2 style="color:#f1f5f9;font-size:1rem;font-weight:700;margin:0 0 16px;">🔍 Assinaturas Encontradas</h2>
          ${detected.map(sub => `
          <div style="background:rgba(15,23,42,0.85);border:1px solid rgba(255,255,255,0.06);border-radius:16px;padding:20px;margin-bottom:12px;" onmouseover="this.style.borderColor='rgba(139,92,246,0.3)'" onmouseout="this.style.borderColor='rgba(255,255,255,0.06)'">
            <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap;">
              <div style="display:flex;align-items:center;gap:14px;flex:1;">
                <div style="width:48px;height:48px;background:rgba(139,92,246,0.15);border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:1.6rem;flex-shrink:0;">${serviceIcons[sub.service_type]||'📱'}</div>
                <div style="flex:1;">
                  <div style="font-weight:700;color:#f1f5f9;font-size:1rem;margin-bottom:4px;">${sub.original_description}</div>
                  <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
                    <span style="color:#64748B;font-size:0.75rem;">📊 ${sub.frequency}× nos últimos meses</span>
                    <span style="color:#64748B;font-size:0.75rem;">🎯 ${sub.confidence?.toFixed(0)}% certeza</span>
                    <span style="background:rgba(139,92,246,0.15);color:#A78BFA;font-size:0.68rem;padding:2px 8px;border-radius:50px;font-weight:600;">${sub.service_type}</span>
                    ${sub.ai_enhanced ? '<span style="background:rgba(16,185,129,0.1);color:#10B981;font-size:0.65rem;padding:2px 8px;border-radius:50px;font-weight:600;">✨ IA</span>' : ''}
                  </div>
                </div>
              </div>
              <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:8px;min-width:220px;">
                <div style="background:#0f172a;border-radius:10px;padding:10px;text-align:center;">
                  <div style="font-size:0.65rem;color:#64748B;">Mensal</div>
                  <div style="font-size:1rem;font-weight:700;color:#f1f5f9;font-family:'JetBrains Mono',monospace;">R$ ${fmtBRL(sub.amount)}</div>
                </div>
                <div style="background:#0f172a;border-radius:10px;padding:10px;text-align:center;">
                  <div style="font-size:0.65rem;color:#64748B;">Anual</div>
                  <div style="font-size:1rem;font-weight:700;color:#F43F5E;font-family:'JetBrains Mono',monospace;">R$ ${fmtBRL(sub.yearly_cost)}</div>
                </div>
                <div style="background:#0f172a;border-radius:10px;padding:10px;text-align:center;">
                  <div style="font-size:0.65rem;color:#64748B;">1ª cobrança</div>
                  <div style="font-size:0.78rem;font-weight:600;color:#94A3B8;">${fmtDate(sub.first_occurrence)}</div>
                </div>
                <div style="background:#0f172a;border-radius:10px;padding:10px;text-align:center;">
                  <div style="font-size:0.65rem;color:#64748B;">Última</div>
                  <div style="font-size:0.78rem;font-weight:600;color:#94A3B8;">${fmtDate(sub.last_occurrence)}</div>
                </div>
              </div>
            </div>
            <div style="margin-top:16px;padding:14px;background:linear-gradient(135deg,rgba(139,92,246,0.08),rgba(59,130,246,0.08));border:1px solid rgba(139,92,246,0.2);border-radius:12px;">
              <p style="color:#f1f5f9;font-weight:600;text-align:center;margin:0 0 12px;font-size:0.9rem;">🤔 Você ainda usa este serviço regularmente?</p>
              <div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap;">
                <button onclick="VM.feedbackAssinatura(${sub.id},'use_regularly')" style="background:rgba(16,185,129,0.15);color:#10B981;border:1px solid rgba(16,185,129,0.3);padding:8px 16px;border-radius:8px;font-weight:700;cursor:pointer;font-size:0.82rem;">✅ Uso Sempre</button>
                <button onclick="VM.modalReduzirPrecoAssinatura(${sub.id},'${(sub.service_nome||sub.original_description).replace(/'/g,"\\'")}',${sub.amount})" style="background:rgba(245,158,11,0.15);color:#F59E0B;border:1px solid rgba(245,158,11,0.3);padding:8px 16px;border-radius:8px;font-weight:700;cursor:pointer;font-size:0.82rem;">💸 Reduzir Preço</button>
                <button onclick="VM.feedbackAssinatura(${sub.id},'want_cancel')" style="background:rgba(244,63,94,0.15);color:#F43F5E;border:1px solid rgba(244,63,94,0.3);padding:8px 16px;border-radius:8px;font-weight:700;cursor:pointer;font-size:0.82rem;">❌ Quero Cancelar</button>
                <button onclick="VM.feedbackAssinatura(${sub.id},'ignore')" style="background:rgba(100,116,139,0.15);color:#94A3B8;border:1px solid rgba(100,116,139,0.2);padding:8px 16px;border-radius:8px;font-weight:600;cursor:pointer;font-size:0.82rem;">🤐 Ignorar</button>
              </div>
            </div>
          </div>`).join('')}
        </div>`}
        <div style="background:linear-gradient(135deg,rgba(59,130,246,0.06),rgba(139,92,246,0.06));border:1px solid rgba(59,130,246,0.2);border-radius:16px;padding:24px;margin-top:24px;">
          <h3 style="color:#f1f5f9;font-size:0.95rem;font-weight:700;margin:0 0 14px;">💡 Dicas para Controlar Assinaturas</h3>
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:16px;">
            <div><h4 style="color:#93C5FD;font-size:0.82rem;font-weight:700;margin:0 0 4px;">📅 Auditoria Mensal</h4><p style="color:#94A3B8;font-size:0.8rem;line-height:1.5;margin:0;">Reserve o último domingo do mês para revisar todas as assinaturas. Cancele o que não usou nos últimos 30 dias.</p></div>
            <div><h4 style="color:#C4B5FD;font-size:0.82rem;font-weight:700;margin:0 0 4px;">👨‍👩‍👧 Planos Familiares</h4><p style="color:#94A3B8;font-size:0.8rem;line-height:1.5;margin:0;">Netflix, Spotify, YouTube Premium têm planos familiares. Compartilhe custos e economize até 60%.</p></div>
            <div><h4 style="color:#6EE7B7;font-size:0.82rem;font-weight:700;margin:0 0 4px;">🔄 Alternância Estratégica</h4><p style="color:#94A3B8;font-size:0.8rem;line-height:1.5;margin:0;">Para streaming: assine um, assista o que precisa, cancele e assine outro. Economize sem abrir mão do conteúdo.</p></div>
          </div>
        </div>`

      // ── ABA: PREÇOS REDUZIDOS ──────────────────────────────────────────────
      const htmlReduzidas = `
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:14px;margin-bottom:24px;">
          <div style="background:rgba(245,158,11,0.1);border:1px solid rgba(245,158,11,0.3);border-radius:14px;padding:18px;">
            <div style="color:#FDE68A;font-size:0.72rem;font-weight:600;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;">💸 Planos Reduzidos</div>
            <div style="font-size:2.2rem;font-weight:800;color:#F59E0B;">${total_reduzidas}</div>
            <div style="color:#64748B;font-size:0.75rem;">assinaturas com preço menor</div>
          </div>
          <div style="background:rgba(16,185,129,0.1);border:1px solid rgba(16,185,129,0.3);border-radius:14px;padding:18px;">
            <div style="color:#6EE7B7;font-size:0.72rem;font-weight:600;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;">💰 Economia Mensal</div>
            <div style="font-size:2rem;font-weight:800;color:#10B981;font-family:'JetBrains Mono',monospace;">R$ ${fmtBRL(economia_mensal_total)}</div>
            <div style="color:#64748B;font-size:0.75rem;">todos os planos reduzidos</div>
          </div>
          <div style="background:rgba(16,185,129,0.1);border:1px solid rgba(16,185,129,0.3);border-radius:14px;padding:18px;">
            <div style="color:#6EE7B7;font-size:0.72rem;font-weight:600;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;">🏆 Economia Acumulada</div>
            <div style="font-size:2rem;font-weight:800;color:#10B981;font-family:'JetBrains Mono',monospace;">R$ ${fmtBRL(economia_acumulada_total)}</div>
            <div style="color:#64748B;font-size:0.75rem;">desde as reduções</div>
          </div>
          <div style="background:rgba(59,130,246,0.1);border:1px solid rgba(59,130,246,0.3);border-radius:14px;padding:18px;">
            <div style="color:#93C5FD;font-size:0.72rem;font-weight:600;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;">📅 Projeção Anual</div>
            <div style="font-size:2rem;font-weight:800;color:#3B82F6;font-family:'JetBrains Mono',monospace;">R$ ${fmtBRL(economia_anual_total)}</div>
            <div style="color:#64748B;font-size:0.75rem;">economia nos próximos 12m</div>
          </div>
        </div>
        ${reduzidas.length === 0 ? `
        <div style="text-align:center;padding:60px 20px;background:rgba(255,255,255,0.02);border:2px dashed #1f2937;border-radius:20px;">
          <div style="font-size:4rem;margin-bottom:16px;">💸</div>
          <h2 style="color:#f1f5f9;font-size:1.3rem;font-weight:700;margin-bottom:8px;">Nenhum preço reduzido ainda</h2>
          <p style="color:#64748B;margin:0 0 20px;">Quando você clicar em <strong style="color:#F59E0B;">💸 Reduzir Preço</strong> em uma assinatura, ela aparecerá aqui com o histórico de economia.</p>
          <div style="background:rgba(245,158,11,0.08);border:1px solid rgba(245,158,11,0.2);border-radius:12px;padding:16px;max-width:480px;margin:0 auto;text-align:left;">
            <p style="color:#FDE68A;font-weight:700;margin:0 0 8px;">💡 Como usar?</p>
            <p style="color:#94A3B8;font-size:0.82rem;margin:0;line-height:1.6;">
              Na aba <strong style="color:#A78BFA;">Ativas</strong>, clique em <strong style="color:#F59E0B;">💸 Reduzir Preço</strong> em qualquer assinatura. 
              O sistema vai buscar recorrências vinculadas e atualizar automaticamente o valor delas.
            </p>
          </div>
        </div>` : `
        <div>
          <h2 style="color:#f1f5f9;font-size:1rem;font-weight:700;margin:0 0 16px;">💸 Assinaturas com Preço Reduzido</h2>
          ${reduzidas.map(sub => {
            const pctEconomia = sub.valor_antigo > 0 ? Math.round((sub.reducao_mensal / sub.valor_antigo) * 100) : 0
            return `
          <div style="background:rgba(15,23,42,0.85);border:1px solid rgba(245,158,11,0.2);border-radius:16px;padding:20px;margin-bottom:12px;">
            <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap;">
              <div style="display:flex;align-items:center;gap:14px;flex:1;">
                <div style="width:48px;height:48px;background:rgba(245,158,11,0.15);border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:1.6rem;flex-shrink:0;">${serviceIcons[sub.service_type]||'💸'}</div>
                <div style="flex:1;">
                  <div style="font-weight:700;color:#f1f5f9;font-size:1rem;margin-bottom:4px;">${sub.service_nome || sub.original_description}</div>
                  <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
                    <span style="background:rgba(245,158,11,0.2);color:#F59E0B;font-size:0.72rem;padding:2px 8px;border-radius:50px;font-weight:700;">💸 Preço Reduzido</span>
                    <span style="color:#64748B;font-size:0.75rem;">📅 Reduzido em ${fmtDate(sub.reduced_at || sub.updated_at)}</span>
                    <span style="color:#64748B;font-size:0.75rem;">${sub.meses_desde_reducao} mês(es) atrás</span>
                  </div>
                </div>
              </div>
              <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;min-width:280px;">
                <div style="background:rgba(244,63,94,0.08);border:1px solid rgba(244,63,94,0.15);border-radius:10px;padding:10px;text-align:center;">
                  <div style="font-size:0.65rem;color:#FDA4AF;margin-bottom:2px;">Valor Antigo</div>
                  <div style="font-size:0.9rem;font-weight:700;color:#F43F5E;font-family:'JetBrains Mono',monospace;text-decoration:line-through;">R$ ${fmtBRL(sub.valor_antigo)}</div>
                </div>
                <div style="background:rgba(16,185,129,0.08);border:1px solid rgba(16,185,129,0.2);border-radius:10px;padding:10px;text-align:center;">
                  <div style="font-size:0.65rem;color:#6EE7B7;margin-bottom:2px;">Novo Valor</div>
                  <div style="font-size:0.9rem;font-weight:700;color:#10B981;font-family:'JetBrains Mono',monospace;">R$ ${fmtBRL(sub.novo_valor)}</div>
                </div>
                <div style="background:rgba(245,158,11,0.08);border:1px solid rgba(245,158,11,0.2);border-radius:10px;padding:10px;text-align:center;">
                  <div style="font-size:0.65rem;color:#FDE68A;margin-bottom:2px;">Economia/mês</div>
                  <div style="font-size:0.9rem;font-weight:700;color:#F59E0B;font-family:'JetBrains Mono',monospace;">-R$ ${fmtBRL(sub.reducao_mensal)}</div>
                </div>
              </div>
            </div>
            <div style="margin-top:14px;background:#0f172a;border-radius:10px;padding:12px;">
              <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;flex-wrap:wrap;gap:8px;">
                <div style="font-size:0.8rem;color:#94A3B8;">
                  🏆 Economia acumulada desde a redução:
                  <strong style="color:#10B981;font-family:'JetBrains Mono',monospace;"> R$ ${fmtBRL(sub.economia_acumulada)}</strong>
                </div>
                <div style="display:flex;gap:6px;align-items:center;">
                  <span style="background:rgba(16,185,129,0.15);color:#10B981;font-size:0.75rem;padding:3px 10px;border-radius:50px;font-weight:700;">-${pctEconomia}% desconto</span>
                  <span style="color:#64748B;font-size:0.75rem;">· Proj. anual: R$ ${fmtBRL(sub.reducao_anual)}</span>
                </div>
              </div>
              <div style="background:rgba(255,255,255,0.04);border-radius:6px;overflow:hidden;height:6px;">
                <div style="height:6px;width:${Math.min(100,pctEconomia)}%;background:linear-gradient(90deg,#10B981,#059669);border-radius:6px;"></div>
              </div>
            </div>
          </div>`}).join('')}
        </div>`}
      `

      const htmlCanceladas = `
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:14px;margin-bottom:24px;">
          <div style="background:rgba(16,185,129,0.1);border:1px solid rgba(16,185,129,0.3);border-radius:14px;padding:18px;">
            <div style="color:#6EE7B7;font-size:0.72rem;font-weight:600;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;">✂️ Canceladas</div>
            <div style="font-size:2.2rem;font-weight:800;color:#10B981;">${total_canceladas}</div>
            <div style="color:#64748B;font-size:0.75rem;">assinaturas encerradas</div>
          </div>
          <div style="background:rgba(16,185,129,0.1);border:1px solid rgba(16,185,129,0.3);border-radius:14px;padding:18px;">
            <div style="color:#6EE7B7;font-size:0.72rem;font-weight:600;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;">💰 Economia Acumulada</div>
            <div style="font-size:2rem;font-weight:800;color:#10B981;font-family:'JetBrains Mono',monospace;">R$ ${fmtBRL(economia_acumulada)}</div>
            <div style="color:#64748B;font-size:0.75rem;">desde o cancelamento</div>
          </div>
          <div style="background:rgba(245,158,11,0.1);border:1px solid rgba(245,158,11,0.3);border-radius:14px;padding:18px;">
            <div style="color:#FDE68A;font-size:0.72rem;font-weight:600;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;">📅 Projeção 12 Meses</div>
            <div style="font-size:2rem;font-weight:800;color:#F59E0B;font-family:'JetBrains Mono',monospace;">R$ ${fmtBRL(projecao_12m)}</div>
            <div style="color:#64748B;font-size:0.75rem;">de economia projetada</div>
          </div>
        </div>
        ${canceladas.length === 0 ? `
        <div style="text-align:center;padding:60px 20px;background:rgba(255,255,255,0.02);border:2px dashed #1f2937;border-radius:20px;">
          <div style="font-size:4rem;margin-bottom:16px;">🏆</div>
          <h2 style="color:#f1f5f9;font-size:1.3rem;font-weight:700;margin-bottom:8px;">Nenhuma assinatura cancelada ainda</h2>
          <p style="color:#64748B;margin:0;">Quando você marcar uma assinatura como "Quero Cancelar", ela aparecerá aqui com o histórico de economia.</p>
        </div>` : `
        <div>
          <h2 style="color:#f1f5f9;font-size:1rem;font-weight:700;margin:0 0 16px;">✂️ Histórico de Cancelamentos</h2>
          ${canceladas.map(c => `
          <div style="background:rgba(15,23,42,0.85);border:1px solid rgba(16,185,129,0.15);border-radius:16px;padding:20px;margin-bottom:12px;">
            <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;">
              <div style="display:flex;align-items:center;gap:12px;">
                <div style="width:44px;height:44px;background:rgba(16,185,129,0.12);border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:1.4rem;">${serviceIcons[c.service_type]||'✂️'}</div>
                <div>
                  <div style="font-weight:700;color:#f1f5f9;margin-bottom:3px;">${c.service_nome||c.normalized_description}</div>
                  <div style="font-size:0.75rem;color:#64748B;">Cancelado em ${fmtDate(c.cancelled_at)} ${c.motivo_cancelamento?'· '+c.motivo_cancelamento:''}</div>
                </div>
              </div>
              <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;min-width:280px;">
                <div style="text-align:center;">
                  <div style="font-size:0.65rem;color:#64748B;">Mensal</div>
                  <div style="font-weight:700;color:#F43F5E;font-family:'JetBrains Mono',monospace;">-R$ ${fmtBRL(c.amount)}</div>
                </div>
                <div style="text-align:center;">
                  <div style="font-size:0.65rem;color:#64748B;">Economizado</div>
                  <div style="font-weight:700;color:#10B981;font-family:'JetBrains Mono',monospace;">R$ ${fmtBRL(c.economia_acumulada||0)}</div>
                </div>
                <div style="text-align:center;">
                  <div style="font-size:0.65rem;color:#64748B;">Proj. 12m</div>
                  <div style="font-weight:700;color:#F59E0B;font-family:'JetBrains Mono',monospace;">R$ ${fmtBRL(c.projecao_anual||c.yearly_cost||0)}</div>
                </div>
              </div>
            </div>
            ${c.meses_desde_cancelamento > 0 ? `
            <div style="margin-top:12px;background:#0f172a;border-radius:8px;overflow:hidden;">
              <div style="height:6px;width:${Math.min(100,Math.round(c.meses_desde_cancelamento/12*100))}%;background:linear-gradient(90deg,#10B981,#059669);"></div>
            </div>
            <div style="font-size:0.72rem;color:#64748B;margin-top:4px;">${c.meses_desde_cancelamento} ${c.meses_desde_cancelamento===1?'mês':'meses'} cancelado — R$ ${fmtBRL(c.economia_acumulada)} economizados</div>` : ''}
          </div>`).join('')}
        </div>`}`
      
      content.innerHTML = `
        <div style="max-width:1000px;">
          <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:24px;flex-wrap:wrap;gap:12px;">
            <div>
              <h1 style="font-size:1.8rem;font-weight:800;color:#f1f5f9;margin:0 0 6px;">👻 Assinaturas Fantasma</h1>
              <p style="color:#64748B;margin:0;">O brasileiro médio desperdiça R$ 150-250/mês em serviços esquecidos. Vamos encontrar os seus.</p>
            </div>
            <button onclick="VM.scanAssinaturas()" id="btn-scan-assin" style="background:linear-gradient(135deg,#8B5CF6,#7C3AED);color:#fff;border:none;padding:12px 24px;border-radius:12px;font-weight:700;cursor:pointer;font-size:0.9rem;display:flex;align-items:center;gap:8px;">🔍 Escanear Gastos</button>
          </div>
          <div style="display:flex;gap:8px;margin-bottom:24px;border-bottom:1px solid rgba(255,255,255,0.06);padding-bottom:16px;flex-wrap:wrap;">
            ${tabBtn('ativas','🔍 Ativas ('+detected.length+')', abaAtiva==='ativas')}
            ${tabBtn('reduzidas','💸 Preços Reduzidos ('+total_reduzidas+')', abaAtiva==='reduzidas')}
            ${tabBtn('canceladas','✂️ Canceladas ('+total_canceladas+')', abaAtiva==='canceladas')}
          </div>
          ${abaAtiva === 'ativas' ? htmlAtivas : abaAtiva === 'reduzidas' ? htmlReduzidas : htmlCanceladas}
        </div>
      `
    } catch (e) {
      document.getElementById('page-content').innerHTML = `<div class="empty-state"><p style="color:#F43F5E;">Erro: ${e.message}</p></div>`
    }
  },
  
  async scanAssinaturas() {
    const btn = document.getElementById('btn-scan-assin')
    if (btn) { btn.disabled = true; btn.innerHTML = '⏳ Analisando...' }
    try {
      const resp = await this.api('POST', 'assinaturas-fantasma/scan')
      this.toast(resp.message || '✅ Escaneamento concluído!', 'success')
      this.pageAssinaturasFantasma()
    } catch (err) {
      this.toast(err.message || 'Erro ao escanear', 'error')
      if (btn) { btn.disabled = false; btn.innerHTML = '🔍 Escanear Gastos' }
    }
  },
  
  async feedbackAssinatura(id, feedback) {
    try {
      const resp = await this.api('PATCH', `assinaturas-fantasma/${id}/feedback`, { feedback })
      this.toast(resp.message, 'success')
      this.pageAssinaturasFantasma()
    } catch (err) {
      this.toast(err.message, 'error')
    }
  },

  async modalReduzirPrecoAssinatura(id, nome, valorAtual) {
    const modal = document.createElement('div')
    modal.id = 'modal-reduzir-assin'
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.75);display:flex;align-items:center;justify-content:center;z-index:9999;padding:16px;'
    modal.innerHTML = `
      <div style="background:#0f172a;border:1px solid rgba(245,158,11,0.35);border-radius:20px;padding:24px;max-width:440px;width:100%;max-height:92vh;overflow-y:auto;box-shadow:0 25px 60px rgba(0,0,0,0.6);">

        <!-- Header -->
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">
          <div>
            <h3 style="color:#F59E0B;font-size:1rem;font-weight:800;margin:0 0 3px;">💸 Reduzir Preço</h3>
            <p style="color:#94A3B8;font-size:0.82rem;margin:0;">
              <strong style="color:#f1f5f9;">${nome}</strong>
              &nbsp;·&nbsp;
              Atual: <strong style="color:#F43F5E;">R$ ${(valorAtual||0).toLocaleString('pt-BR',{minimumFractionDigits:2})}/mês</strong>
            </p>
          </div>
          <button onclick="document.getElementById('modal-reduzir-assin').remove()" style="background:rgba(255,255,255,0.06);border:none;color:#64748B;width:30px;height:30px;border-radius:8px;cursor:pointer;font-size:1rem;display:flex;align-items:center;justify-content:center;flex-shrink:0;">✕</button>
        </div>

        <!-- Novo valor -->
        <div style="margin-bottom:12px;">
          <label style="color:#94A3B8;font-size:0.78rem;display:block;margin-bottom:6px;font-weight:600;">Novo valor após troca de plano / desconto</label>
          <div style="display:flex;align-items:center;gap:8px;background:#1e293b;border:1px solid rgba(255,255,255,0.1);border-radius:10px;padding:4px 12px;">
            <span style="color:#64748B;font-size:0.9rem;font-weight:600;">R$</span>
            <input id="inp-novo-valor-assin" type="number" step="0.01" min="0.01"
              placeholder="Ex: 19.90"
              style="flex:1;background:transparent;border:none;color:#f1f5f9;font-size:1rem;outline:none;padding:8px 0;">
          </div>
        </div>

        <!-- Preview economia -->
        <div style="border-radius:10px;padding:12px;margin-bottom:16px;min-height:44px;" id="preview-reducao-assin">
          <p style="color:#64748B;font-size:0.78rem;margin:0;">👆 Digite o novo valor para ver a economia estimada.</p>
        </div>

        <!-- Seção de recorrências (carregada ao clicar em "Buscar") -->
        <div id="secao-recorrencias-assin" style="display:none;margin-bottom:16px;background:rgba(59,130,246,0.04);border:1px solid rgba(59,130,246,0.15);border-radius:12px;padding:12px;">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
            <p style="color:#93C5FD;font-size:0.82rem;font-weight:700;margin:0;">🔗 Recorrências encontradas</p>
            <span style="color:#475569;font-size:0.7rem;">Escolha qual atualizar</span>
          </div>
          <div id="lista-recorrencias-assin" style="max-height:180px;overflow-y:auto;"></div>
          <label style="display:flex;align-items:center;gap:8px;cursor:pointer;margin-top:8px;padding:8px;background:rgba(255,255,255,0.03);border-radius:8px;">
            <input type="radio" name="recorrencia-choice" value="none" checked style="accent-color:#F59E0B;">
            <span style="color:#94A3B8;font-size:0.8rem;">Não vincular nenhuma recorrência</span>
          </label>
        </div>

        <!-- Botões — empilhados verticalmente para evitar overflow -->
        <div style="display:flex;flex-direction:column;gap:8px;">
          <button id="btn-buscar-rec-assin" onclick="VM.buscarRecorrenciasParaReducao(${id})"
            style="width:100%;padding:11px;background:rgba(59,130,246,0.12);color:#93C5FD;border:1px solid rgba(59,130,246,0.3);border-radius:10px;font-weight:700;cursor:pointer;font-size:0.85rem;transition:background 0.2s;"
            onmouseover="this.style.background='rgba(59,130,246,0.22)'" onmouseout="this.style.background='rgba(59,130,246,0.12)'">
            🔗 Buscar Recorrências para Vincular
          </button>
          <div style="display:flex;gap:8px;">
            <button onclick="document.getElementById('modal-reduzir-assin').remove()"
              style="flex:1;padding:11px;background:rgba(100,116,139,0.12);color:#94A3B8;border:1px solid rgba(100,116,139,0.2);border-radius:10px;font-weight:600;cursor:pointer;font-size:0.85rem;">
              Cancelar
            </button>
            <button onclick="VM.confirmarReduzirPrecoAssinatura(${id},${valorAtual})"
              style="flex:2;padding:11px;background:linear-gradient(135deg,#F59E0B,#D97706);color:#fff;border:none;border-radius:10px;font-weight:800;cursor:pointer;font-size:0.85rem;box-shadow:0 4px 14px rgba(245,158,11,0.3);">
              💸 Confirmar Redução
            </button>
          </div>
        </div>
      </div>`
    document.body.appendChild(modal)
    modal.addEventListener('click', e => { if (e.target === modal) modal.remove() })

    // Preview dinâmico
    const inp = document.getElementById('inp-novo-valor-assin')
    const preview = document.getElementById('preview-reducao-assin')
    inp.addEventListener('input', () => {
      const novo = parseFloat(inp.value)
      if (!novo || novo <= 0 || novo >= valorAtual) {
        preview.innerHTML = '<p style="color:#F43F5E;font-size:0.78rem;margin:0;background:rgba(244,63,94,0.08);padding:10px;border-radius:8px;border:1px solid rgba(244,63,94,0.2);">⚠️ Novo valor deve ser menor que o atual.</p>'
        return
      }
      const redMensal = valorAtual - novo
      const redAnual  = redMensal * 12
      const pctDesc   = Math.round((redMensal / valorAtual) * 100)
      preview.innerHTML = `
        <div style="background:rgba(16,185,129,0.08);border:1px solid rgba(16,185,129,0.2);border-radius:8px;padding:10px;">
          <div style="font-size:0.72rem;color:#6EE7B7;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">💰 Economia estimada</div>
          <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
            <span style="color:#10B981;font-size:1.05rem;font-weight:800;font-family:'JetBrains Mono',monospace;">R$ ${redMensal.toLocaleString('pt-BR',{minimumFractionDigits:2})}/mês</span>
            <span style="color:#6EE7B7;font-size:0.85rem;">· R$ ${redAnual.toLocaleString('pt-BR',{minimumFractionDigits:2})}/ano</span>
            <span style="background:rgba(16,185,129,0.2);color:#10B981;font-size:0.72rem;padding:2px 8px;border-radius:20px;font-weight:700;">-${pctDesc}%</span>
          </div>
        </div>`
    })
    inp.focus()
  },

  async buscarRecorrenciasParaReducao(id) {
    const btn = document.getElementById('btn-buscar-rec-assin')
    if (btn) { btn.disabled = true; btn.innerHTML = '⏳ Buscando...' }
    try {
      const resp = await this.api('GET', `assinaturas-fantasma/${id}/buscar-recorrencias`)
      const { recorrencias_candidatas = [], mensagem = '' } = resp
      const secao = document.getElementById('secao-recorrencias-assin')
      const lista = document.getElementById('lista-recorrencias-assin')
      if (!secao || !lista) return

      if (recorrencias_candidatas.length === 0) {
        lista.innerHTML = `<p style="color:#64748B;font-size:0.82rem;padding:10px 0;margin:0;">Nenhuma recorrência similar encontrada. A redução será salva sem vincular.</p>`
      } else {
        lista.innerHTML = recorrencias_candidatas.map(r => `
          <label style="display:flex;align-items:center;gap:10px;padding:10px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);border-radius:8px;margin-bottom:6px;cursor:pointer;" onmouseover="this.style.borderColor='rgba(245,158,11,0.3)'" onmouseout="this.style.borderColor='rgba(255,255,255,0.06)'">
            <input type="radio" name="recorrencia-choice" value="${r.id}" style="accent-color:#F59E0B;flex-shrink:0;">
            <div style="flex:1;">
              <div style="font-weight:700;color:#f1f5f9;font-size:0.85rem;">${r.descricao}</div>
              <div style="font-size:0.72rem;color:#64748B;">Valor atual: R$ ${(r.valor||0).toLocaleString('pt-BR',{minimumFractionDigits:2})} · ${r.categoria || 'Sem categoria'}</div>
            </div>
            <span style="background:rgba(245,158,11,0.15);color:#F59E0B;font-size:0.68rem;padding:2px 6px;border-radius:50px;font-weight:700;">${Math.round((r.similaridade||0)*100)}% similar</span>
          </label>`).join('')
      }
      secao.style.display = 'block'
      this.toast(mensagem || `${recorrencias_candidatas.length} recorrência(s) encontrada(s)`, 'info')
      if (btn) { btn.disabled = false; btn.innerHTML = '🔄 Rebuscar' }
    } catch (err) {
      this.toast(err.message || 'Erro ao buscar recorrências', 'error')
      if (btn) { btn.disabled = false; btn.innerHTML = '🔗 Buscar Recorrências' }
    }
  },

  async confirmarReduzirPrecoAssinatura(id, valorAtual) {
    const inp = document.getElementById('inp-novo-valor-assin')
    const novo = parseFloat(inp?.value)
    if (!novo || novo <= 0 || novo >= valorAtual) {
      this.toast('Novo valor deve ser menor que o atual', 'error'); return
    }
    // Pegar recorrência selecionada (null se "Não vincular")
    const radioSelecionado = document.querySelector('input[name="recorrencia-choice"]:checked')
    const recorrenciaId = radioSelecionado && radioSelecionado.value !== 'none'
      ? parseInt(radioSelecionado.value) : null

    try {
      const resp = await this.api('POST', `assinaturas-fantasma/${id}/reduzir-preco`, {
        novo_valor: novo,
        recorrencia_id: recorrenciaId
      })
      this.toast(resp.message, 'success')
      document.getElementById('modal-reduzir-assin')?.remove()
      this.pageAssinaturasFantasma('reduzidas')
    } catch (err) {
      this.toast(err.message || 'Erro ao registrar redução', 'error')
    }
  },

  // ═══════════════════════════════════════════════════════════════
  // ═══════════════════════════════════════════════════════════════
  // v3.1 — COMPRAS FANTASMA
  // ═══════════════════════════════════════════════════════════════
  async pageComprasFantasma(aba) {
    const content = document.getElementById('page-content')
    content.innerHTML = `<div class="empty-state"><div class="skeleton" style="height:180px;border-radius:16px;margin-bottom:16px;"></div></div>`
    const abaAtiva = aba || 'impulsos'

    try {
      const [data, dataRec] = await Promise.all([
        this.api('GET', 'compras-fantasma'),
        this.api('GET', 'compras-fantasma/recorrentes').catch(() => ({ recorrentes: [], total_recorrentes: 0, economia_potencial_mensal: 0, economia_potencial_anual: 0 }))
      ])
      const {
        resumo = {}, compras_impulsivas = [], categorias_impulsivas = [],
        alertas = [], dica = '', periodo_meses = 3
      } = data
      const { recorrentes = [], total_recorrentes = 0, economia_potencial_mensal = 0, economia_potencial_anual = 0 } = dataRec

      const fmtBRL = v => (v||0).toLocaleString('pt-BR', {minimumFractionDigits:2, maximumFractionDigits:2})
      const fmtDate = d => d ? new Date(d+'T12:00:00').toLocaleDateString('pt-BR') : '—'
      const totalAnalisado = Number(resumo.total_analisado||0)
      const totalImpulsivo = Number(resumo.total_impulsivo||0)
      const pctImpulsivo   = Number(resumo.percentual_impulsivo||0)
      const economiaPot    = Number(resumo.economia_potencial||0)
      const qtdImpulsivas  = Number(resumo.qtd_impulsivas||0)

      const tabBtn = (id, label, active) => `<button onclick="VM.pageComprasFantasma('${id}')" style="padding:8px 18px;border-radius:8px;font-weight:700;font-size:0.85rem;cursor:pointer;transition:all 0.2s;${active?'background:rgba(249,115,22,0.2);color:#FB923C;border:1px solid rgba(249,115,22,0.4);':'background:transparent;color:#64748B;border:1px solid rgba(255,255,255,0.08);'}">${label}</button>`

      const htmlImpulsos = `
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:14px;margin-bottom:24px;">
          <div style="background:rgba(249,115,22,0.1);border:1px solid rgba(249,115,22,0.3);border-radius:14px;padding:18px;">
            <div style="color:#FED7AA;font-size:0.7rem;font-weight:600;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;">💸 Total Analisado</div>
            <div style="font-size:1.6rem;font-weight:800;color:#FB923C;">R$ ${fmtBRL(totalAnalisado)}</div>
            <div style="color:#64748B;font-size:0.72rem;">últimos ${periodo_meses} meses</div>
          </div>
          <div style="background:rgba(244,63,94,0.1);border:1px solid rgba(244,63,94,0.3);border-radius:14px;padding:18px;">
            <div style="color:#FDA4AF;font-size:0.7rem;font-weight:600;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;">🚨 Gastos Impulsivos</div>
            <div style="font-size:1.6rem;font-weight:800;color:#F43F5E;">R$ ${fmtBRL(totalImpulsivo)}</div>
            <div style="color:#64748B;font-size:0.72rem;">${pctImpulsivo.toFixed(1)}% do total • ${qtdImpulsivas} compras</div>
          </div>
          <div style="background:rgba(16,185,129,0.1);border:1px solid rgba(16,185,129,0.3);border-radius:14px;padding:18px;">
            <div style="color:#6EE7B7;font-size:0.7rem;font-weight:600;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;">✂️ Economia Potencial</div>
            <div style="font-size:1.6rem;font-weight:800;color:#10B981;">R$ ${fmtBRL(economiaPot)}</div>
            <div style="color:#64748B;font-size:0.72rem;">se cortar 30% dos impulsos</div>
          </div>
        </div>
        ${alertas.length > 0 ? `
        <div style="background:rgba(244,63,94,0.08);border:1px solid rgba(244,63,94,0.25);border-radius:14px;padding:16px 20px;margin-bottom:20px;">
          <h3 style="color:#F43F5E;font-size:0.9rem;font-weight:700;margin:0 0 10px;">🚨 Alertas de Consumo</h3>
          ${alertas.map(a => `<div style="color:#FDA4AF;font-size:0.82rem;margin-bottom:6px;">• ${a}</div>`).join('')}
        </div>` : ''}
        ${categorias_impulsivas.length > 0 ? `
        <div style="background:rgba(15,23,42,0.85);border:1px solid rgba(255,255,255,0.06);border-radius:16px;padding:20px;margin-bottom:20px;">
          <h2 style="color:#f1f5f9;font-size:1rem;font-weight:700;margin:0 0 16px;">📊 Categorias com Mais Impulsos</h2>
          ${categorias_impulsivas.map((cat) => {
            const pct = totalImpulsivo > 0 ? Math.round((cat.total/totalImpulsivo)*100) : 0
            return `<div style="display:flex;align-items:center;gap:12px;margin-bottom:14px;">
              <div style="width:36px;height:36px;background:rgba(249,115,22,0.15);border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:1.2rem;flex-shrink:0;">${cat.emoji||'📦'}</div>
              <div style="flex:1;">
                <div style="display:flex;justify-content:space-between;margin-bottom:5px;">
                  <span style="color:#f1f5f9;font-size:0.85rem;font-weight:600;">${cat.categoria}</span>
                  <span style="color:#FB923C;font-size:0.85rem;font-weight:700;">R$ ${fmtBRL(cat.total)}</span>
                </div>
                <div style="background:rgba(255,255,255,0.05);border-radius:4px;height:6px;overflow:hidden;">
                  <div style="width:${pct}%;height:100%;background:linear-gradient(90deg,#F97316,#EA580C);border-radius:4px;"></div>
                </div>
                <div style="color:#64748B;font-size:0.7rem;margin-top:3px;">${cat.qtd} compras • ${pct}% dos impulsos</div>
              </div>
            </div>`
          }).join('')}
        </div>` : ''}
        ${compras_impulsivas.length > 0 ? `
        <div style="background:rgba(15,23,42,0.85);border:1px solid rgba(255,255,255,0.06);border-radius:16px;padding:20px;margin-bottom:20px;">
          <h2 style="color:#f1f5f9;font-size:1rem;font-weight:700;margin:0 0 16px;">🛍️ Compras Impulsivas Identificadas</h2>
          ${compras_impulsivas.slice(0,10).map(c => {
            const scoreColor = c.impulsive_score >= 70 ? '#F43F5E' : c.impulsive_score >= 50 ? '#F97316' : '#FBBF24'
            return `<div style="display:flex;align-items:center;justify-content:space-between;padding:12px 0;border-bottom:1px solid rgba(255,255,255,0.04);">
              <div style="flex:1;"><div style="color:#f1f5f9;font-size:0.88rem;font-weight:600;">${c.descricao}</div><div style="color:#64748B;font-size:0.75rem;">${fmtDate(c.data)} • ${c.categoria||'Outros'}</div></div>
              <div style="text-align:right;"><div style="color:#FB923C;font-weight:700;">R$ ${fmtBRL(c.valor)}</div><div style="font-size:0.7rem;color:${scoreColor};font-weight:600;">Score ${c.impulsive_score}% impulsivo</div></div>
            </div>`
          }).join('')}
          ${compras_impulsivas.length > 10 ? `<div style="color:#64748B;font-size:0.78rem;text-align:center;margin-top:12px;">+${compras_impulsivas.length-10} compras adicionais</div>` : ''}
        </div>` : `
        <div style="text-align:center;padding:60px 20px;background:rgba(255,255,255,0.02);border:2px dashed #1f2937;border-radius:20px;margin-bottom:20px;">
          <div style="font-size:4rem;margin-bottom:16px;">🛍️</div>
          <h2 style="color:#f1f5f9;font-size:1.3rem;font-weight:700;margin-bottom:8px;">Nenhuma compra impulsiva identificada</h2>
          <p style="color:#64748B;margin:0 0 20px;">Seus gastos estão bem controlados, ou clique em "Analisar" para uma análise atualizada.</p>
        </div>`}
        ${dica ? `<div style="background:linear-gradient(135deg,rgba(249,115,22,0.08),rgba(234,88,12,0.05));border:1px solid rgba(249,115,22,0.2);border-radius:16px;padding:20px;margin-bottom:20px;"><h3 style="color:#FB923C;font-size:0.9rem;font-weight:700;margin:0 0 8px;">💡 Dica Personalizada</h3><p style="color:#94A3B8;font-size:0.85rem;margin:0;line-height:1.6;">${dica}</p></div>` : ''}
        <div style="background:linear-gradient(135deg,rgba(59,130,246,0.06),rgba(249,115,22,0.06));border:1px solid rgba(59,130,246,0.2);border-radius:16px;padding:24px;">
          <h3 style="color:#f1f5f9;font-size:0.95rem;font-weight:700;margin:0 0 14px;">🧠 Estratégias Anti-Impulso</h3>
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:16px;">
            <div><h4 style="color:#93C5FD;font-size:0.82rem;font-weight:700;margin:0 0 4px;">⏳ Regra das 48 Horas</h4><p style="color:#94A3B8;font-size:0.8rem;line-height:1.5;margin:0;">Para compras acima de R$ 100, espere 48 horas. Se ainda quiser depois, provavelmente é necessário.</p></div>
            <div><h4 style="color:#FED7AA;font-size:0.82rem;font-weight:700;margin:0 0 4px;">📋 Lista de Desejos</h4><p style="color:#94A3B8;font-size:0.8rem;line-height:1.5;margin:0;">Crie uma lista e adicione itens que quiser. Após 30 dias, reavalie: ainda é uma prioridade?</p></div>
            <div><h4 style="color:#6EE7B7;font-size:0.82rem;font-weight:700;margin:0 0 4px;">💰 Custo em Horas de Trabalho</h4><p style="color:#94A3B8;font-size:0.8rem;line-height:1.5;margin:0;">Calcule quantas horas de trabalho equivale ao produto. Isso muda sua perspectiva de valor.</p></div>
          </div>
        </div>`

      const tipoIcons = { assinatura:'📱', servico_recorrente:'🔄', alimentacao_recorrente:'🍔', transporte_recorrente:'🚗', outros:'📦' }
      const htmlRecorrentes = `
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:14px;margin-bottom:24px;">
          <div style="background:rgba(59,130,246,0.1);border:1px solid rgba(59,130,246,0.3);border-radius:14px;padding:18px;">
            <div style="color:#93C5FD;font-size:0.7rem;font-weight:600;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;">🔄 Recorrências</div>
            <div style="font-size:2.2rem;font-weight:800;color:#60A5FA;">${total_recorrentes}</div>
            <div style="color:#64748B;font-size:0.72rem;">padrões identificados</div>
          </div>
          <div style="background:rgba(16,185,129,0.1);border:1px solid rgba(16,185,129,0.3);border-radius:14px;padding:18px;">
            <div style="color:#6EE7B7;font-size:0.7rem;font-weight:600;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;">💰 Economia Mensal</div>
            <div style="font-size:2rem;font-weight:800;color:#10B981;font-family:'JetBrains Mono',monospace;">R$ ${fmtBRL(economia_potencial_mensal)}</div>
            <div style="color:#64748B;font-size:0.72rem;">potencial se reduzir</div>
          </div>
          <div style="background:rgba(245,158,11,0.1);border:1px solid rgba(245,158,11,0.3);border-radius:14px;padding:18px;">
            <div style="color:#FDE68A;font-size:0.7rem;font-weight:600;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;">📅 Economia Anual</div>
            <div style="font-size:2rem;font-weight:800;color:#F59E0B;font-family:'JetBrains Mono',monospace;">R$ ${fmtBRL(economia_potencial_anual)}</div>
            <div style="color:#64748B;font-size:0.72rem;">projeção 12 meses</div>
          </div>
        </div>
        ${recorrentes.length === 0 ? `
        <div style="text-align:center;padding:60px 20px;background:rgba(255,255,255,0.02);border:2px dashed #1f2937;border-radius:20px;">
          <div style="font-size:4rem;margin-bottom:16px;">🔄</div>
          <h2 style="color:#f1f5f9;font-size:1.3rem;font-weight:700;margin-bottom:8px;">Nenhuma recorrência encontrada</h2>
          <p style="color:#64748B;margin:0 0 20px;">Clique em "Analisar" para que a IA identifique padrões de gastos recorrentes nos seus lançamentos.</p>
          <div style="background:rgba(59,130,246,0.08);border:1px solid rgba(59,130,246,0.2);border-radius:12px;padding:16px;max-width:480px;margin:0 auto;text-align:left;">
            <p style="color:#93C5FD;font-weight:700;margin:0 0 8px;">ℹ️ Como funciona?</p>
            <p style="color:#94A3B8;font-size:0.82rem;margin:0;line-height:1.6;">A IA agrupa despesas similares e analisa se aparecem em intervalos regulares (semanal, quinzenal, mensal). Quando detectada uma recorrência, você pode registrar uma redução de valor e ver a economia acumulada.</p>
          </div>
        </div>` : `
        <div>
          <h2 style="color:#f1f5f9;font-size:1rem;font-weight:700;margin:0 0 16px;">🔄 Gastos Recorrentes Detectados</h2>
          ${recorrentes.map(r => {
            const tipoIcon = tipoIcons[r.tipo_recorrencia]||'📦'
            const classifColor = r.ai_classificacao === 'necessario' ? '#10B981' : r.ai_classificacao === 'dispensavel' ? '#F43F5E' : r.ai_classificacao === 'assinatura' ? '#8B5CF6' : '#F59E0B'
            const classifLabel = r.ai_classificacao === 'necessario' ? '✅ Necessário' : r.ai_classificacao === 'dispensavel' ? '❌ Dispensável' : r.ai_classificacao === 'assinatura' ? '📱 Assinatura' : '⚡ Impulso Recorrente'
            return `
            <div style="background:rgba(15,23,42,0.85);border:1px solid rgba(255,255,255,0.06);border-radius:16px;padding:20px;margin-bottom:12px;" onmouseover="this.style.borderColor='rgba(59,130,246,0.3)'" onmouseout="this.style.borderColor='rgba(255,255,255,0.06)'">
              <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;">
                <div style="display:flex;align-items:center;gap:12px;flex:1;">
                  <div style="width:44px;height:44px;background:rgba(59,130,246,0.12);border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:1.4rem;">${tipoIcon}</div>
                  <div>
                    <div style="font-weight:700;color:#f1f5f9;margin-bottom:4px;">${r.normalized_description}</div>
                    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
                      <span style="font-size:0.72rem;color:${classifColor};font-weight:600;">${classifLabel}</span>
                      <span style="font-size:0.72rem;color:#64748B;">${r.frequencia_ocorrencias}× detectado</span>
                      ${r.ai_used ? '<span style="background:rgba(16,185,129,0.1);color:#10B981;font-size:0.65rem;padding:2px 8px;border-radius:50px;font-weight:600;">✨ IA</span>' : ''}
                    </div>
                  </div>
                </div>
                <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;min-width:260px;">
                  <div style="text-align:center;background:#0f172a;border-radius:10px;padding:10px;">
                    <div style="font-size:0.65rem;color:#64748B;">Valor Médio</div>
                    <div style="font-weight:700;color:#f1f5f9;font-family:'JetBrains Mono',monospace;">R$ ${fmtBRL(r.valor_medio)}</div>
                  </div>
                  <div style="text-align:center;background:#0f172a;border-radius:10px;padding:10px;">
                    <div style="font-size:0.65rem;color:#64748B;">Economia Mês</div>
                    <div style="font-weight:700;color:#10B981;font-family:'JetBrains Mono',monospace;">R$ ${fmtBRL(r.economia_potencial_mensal||0)}</div>
                  </div>
                  <div style="text-align:center;background:#0f172a;border-radius:10px;padding:10px;">
                    <div style="font-size:0.65rem;color:#64748B;">Economia Ano</div>
                    <div style="font-weight:700;color:#F59E0B;font-family:'JetBrains Mono',monospace;">R$ ${fmtBRL(r.economia_potencial_anual||0)}</div>
                  </div>
                </div>
              </div>
              ${r.ai_sugestao ? `<div style="margin-top:12px;padding:10px 14px;background:rgba(59,130,246,0.05);border:1px solid rgba(59,130,246,0.15);border-radius:8px;font-size:0.8rem;color:#93C5FD;line-height:1.5;">💡 ${r.ai_sugestao}</div>` : ''}
              ${r.status === 'ativo' ? `
              <div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap;">
                <button onclick="VM.reduzirRecorrente(${r.id},'${r.normalized_description}',${r.valor_medio})" style="background:rgba(16,185,129,0.12);color:#10B981;border:1px solid rgba(16,185,129,0.25);padding:7px 14px;border-radius:8px;font-size:0.8rem;font-weight:600;cursor:pointer;">✂️ Registrar Redução</button>
              </div>` : r.status === 'reduzido' ? `<div style="margin-top:10px;font-size:0.75rem;color:#10B981;">✅ Reduzido — economia de R$ ${fmtBRL(r.economia_real_mensal||0)}/mês registrada</div>` : ''}
            </div>`
          }).join('')}
        </div>`}
      `

      content.innerHTML = `
        <div style="max-width:1000px;">
          <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:24px;flex-wrap:wrap;gap:12px;">
            <div>
              <h1 style="font-size:1.8rem;font-weight:800;color:#f1f5f9;margin:0 0 6px;">🛍️ Compras Fantasma</h1>
              <p style="color:#64748B;margin:0;">Identifique padrões de gastos impulsivos e descubra onde seu dinheiro realmente vai.</p>
            </div>
            <button onclick="VM.analisarComprasFantasma()" id="btn-analisar-compras" style="background:linear-gradient(135deg,#F97316,#EA580C);color:#fff;border:none;padding:12px 24px;border-radius:12px;font-weight:700;cursor:pointer;font-size:0.9rem;display:flex;align-items:center;gap:8px;">🔍 Analisar ${periodo_meses} Meses</button>
          </div>
          <div style="display:flex;gap:8px;margin-bottom:24px;border-bottom:1px solid rgba(255,255,255,0.06);padding-bottom:16px;">
            ${tabBtn('impulsos','🛍️ Compras Impulsivas ('+qtdImpulsivas+')', abaAtiva==='impulsos')}
            ${tabBtn('recorrentes','🔄 Recorrentes ('+total_recorrentes+')', abaAtiva==='recorrentes')}
          </div>
          ${abaAtiva === 'impulsos' ? htmlImpulsos : htmlRecorrentes}
        </div>
      `
    } catch (e) {
      document.getElementById('page-content').innerHTML = `<div class="empty-state"><p style="color:#F43F5E;">Erro ao carregar análise: ${e.message}</p></div>`
    }
  },

  async reduzirRecorrente(id, nome, valorAtual) {
    const novoValor = prompt(`Registrar redução para "${nome}"\nValor atual: R$ ${valorAtual.toFixed(2)}\n\nInforme o novo valor reduzido (R$):`)
    if (!novoValor || isNaN(parseFloat(novoValor))) return
    const pct = prompt('Qual o percentual de redução aplicado? (ex: 30 para 30%)', '30')
    try {
      const resp = await this.api('POST', `compras-fantasma/recorrentes/${id}/reduzir`, { novo_valor: parseFloat(novoValor), percentual_reducao: parseFloat(pct||'0') })
      this.toast(resp.message || `✅ Economia de R$ ${(resp.economia_mensal||0).toFixed(2)}/mês registrada!`, 'success')
      this.pageComprasFantasma('recorrentes')
    } catch(err) {
      this.toast(err.message || 'Erro ao registrar redução', 'error')
    }
  },

  async analisarComprasFantasma() {
    const btn = document.getElementById('btn-analisar-compras')
    if (btn) { btn.disabled = true; btn.innerHTML = '⏳ Analisando...' }
    try {
      const resp = await this.api('POST', 'compras-fantasma/analisar')
      this.toast(resp.message || '✅ Análise concluída!', 'success')
      this.pageComprasFantasma()
    } catch (err) {
      this.toast(err.message || 'Erro ao analisar', 'error')
      if (btn) { btn.disabled = false; btn.innerHTML = '🔍 Analisar 3 Meses' }
    }
  },

  // v3.0 — REGRA 50/30/20
  // ═══════════════════════════════════════════════════════════════
  async pageRegra503020() {
    const now = new Date()
    const content = document.getElementById('page-content')
    content.innerHTML = `<div class="empty-state"><div class="skeleton" style="height:280px;border-radius:16px;"></div></div>`
    
    const mes = now.getMonth() + 1
    const ano = now.getFullYear()
    
    try {
      const data = await this.api('GET', `regra-503020?mes=${mes}&ano=${ano}`)
      this.renderRegra503020(data, mes, ano)
    } catch (e) {
      document.getElementById('page-content').innerHTML = `<div class="empty-state"><p style="color:#F43F5E;">Erro: ${e.message}</p></div>`
    }
  },
  
  renderRegra503020(data, mes, ano) {
    const content = document.getElementById('page-content')
    const { current, ideal, gaps, score, recommendations, income, breakdown } = data
    const fmtBRL = v => (v||0).toLocaleString('pt-BR', {minimumFractionDigits:2,maximumFractionDigits:2})
    const MONTHS = ['','Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez']
    
    const scoreColor = score >= 80 ? '#10B981' : score >= 60 ? '#F59E0B' : '#EF4444'
    const scoreLabel = score >= 80 ? 'Excelente ✅' : score >= 60 ? 'Bom ⚡' : score >= 40 ? 'Atenção ⚠️' : 'Crítico 🚨'
    
    const barSegment = (label, amount, pct, idealPct, color, icon) => {
      const diff = pct - idealPct
      const diffColor = Math.abs(diff) < 5 ? '#10B981' : diff > 0 ? '#EF4444' : '#F59E0B'
      const diffSign = diff > 0 ? '+' : ''
      return `
      <div style="background:rgba(15,23,42,0.85);border:2px solid ${Math.abs(diff) < 5 ? '#10B981' : diff > 0 ? '#EF4444' : '#F59E0B'}33;border-radius:16px;padding:20px;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
          <div style="display:flex;align-items:center;gap:10px;">
            <div style="width:40px;height:40px;background:${color}18;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:1.3rem;">${icon}</div>
            <div>
              <div style="font-weight:700;color:#f1f5f9;font-size:0.95rem;">${label}</div>
              <div style="font-size:0.72rem;color:#64748B;">Ideal: ${idealPct}% da renda</div>
            </div>
          </div>
          <div style="text-align:right;">
            <div style="font-size:1.4rem;font-weight:800;color:${color};font-family:'JetBrains Mono',monospace;">${pct.toFixed(1)}%</div>
            <div style="font-size:0.72rem;color:${diffColor};font-weight:600;">${diffSign}${diff.toFixed(1)}% vs ideal</div>
          </div>
        </div>
        <div style="background:#0f172a;border-radius:50px;height:10px;overflow:hidden;margin-bottom:10px;position:relative;">
          <div style="height:100%;width:${Math.min(100, pct)}%;background:${color};border-radius:50px;transition:width 1.2s ease;"></div>
          <!-- Linha do ideal -->
          <div style="position:absolute;top:0;left:${idealPct}%;height:100%;width:2px;background:#fff;opacity:0.4;"></div>
        </div>
        <div style="display:flex;justify-content:space-between;font-size:0.78rem;">
          <span style="color:#94A3B8;">Atual: <b style="color:#f1f5f9;font-family:'JetBrains Mono',monospace;">R$ ${fmtBRL(amount)}</b></span>
          <span style="color:#64748B;">Meta: R$ ${fmtBRL(data.ideal[label.toLowerCase() === 'necessidades' ? 'needs' : label.toLowerCase() === 'desejos' ? 'wants' : 'savings'])}</span>
        </div>
      </div>`
    }
    
    content.innerHTML = `
      <div style="max-width:1000px;">
        <!-- Header + Filtros -->
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:24px;flex-wrap:wrap;gap:12px;">
          <div>
            <h1 style="font-size:1.8rem;font-weight:800;color:#f1f5f9;margin:0 0 6px;">⚖️ Regra 50/30/20</h1>
            <p style="color:#64748B;margin:0;">Análise do equilíbrio das suas finanças em ${MONTHS[mes]}/${ano}</p>
          </div>
          <div style="display:flex;gap:8px;align-items:center;">
            <select id="sel-mes-503020" class="form-input" style="padding:8px 12px;font-size:0.82rem;width:auto;"
              onchange="VM.recarregar503020()">
              ${Array.from({length:12},(_,i)=>`<option value="${i+1}" ${i+1===mes?'selected':''}>${MONTHS[i+1]}</option>`).join('')}
            </select>
            <select id="sel-ano-503020" class="form-input" style="padding:8px 12px;font-size:0.82rem;width:auto;"
              onchange="VM.recarregar503020()">
              ${[ano-1,ano,ano+1].map(y=>`<option value="${y}" ${y===ano?'selected':''}>${y}</option>`).join('')}
            </select>
          </div>
        </div>
        
        ${income === 0 ? `
        <div style="background:rgba(244,63,94,0.08);border:1px solid rgba(244,63,94,0.2);border-radius:14px;padding:20px;margin-bottom:20px;">
          <p style="color:#FDA4AF;font-weight:700;margin:0 0 4px;">⚠️ Nenhuma receita registrada neste período</p>
          <p style="color:#94A3B8;font-size:0.82rem;margin:0;">Cadastre suas receitas do mês para ver a análise 50/30/20.</p>
        </div>` : ''}
        
        <!-- Score Hero -->
        <div style="background:linear-gradient(135deg,rgba(${scoreColor==='#10B981'?'16,185,129':scoreColor==='#F59E0B'?'245,158,11':'239,68,68'},0.12),rgba(15,23,42,0.9));border:2px solid ${scoreColor}33;border-radius:20px;padding:28px;margin-bottom:24px;display:flex;align-items:center;gap:24px;flex-wrap:wrap;">
          <!-- Ring do Score -->
          <div style="position:relative;width:110px;height:110px;flex-shrink:0;">
            <svg width="110" height="110" viewBox="0 0 110 110">
              <circle cx="55" cy="55" r="46" fill="none" stroke="#1e293b" stroke-width="10"/>
              <circle cx="55" cy="55" r="46" fill="none" stroke="${scoreColor}" stroke-width="10"
                stroke-dasharray="${2 * Math.PI * 46}" stroke-dashoffset="${2 * Math.PI * 46 * (1 - score / 100)}"
                stroke-linecap="round" transform="rotate(-90 55 55)" style="transition:stroke-dashoffset 1.5s ease;"/>
            </svg>
            <div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;">
              <div style="font-size:1.6rem;font-weight:800;color:${scoreColor};">${score}</div>
              <div style="font-size:0.65rem;color:#64748B;font-weight:600;">/ 100</div>
            </div>
          </div>
          <div style="flex:1;">
            <div style="font-size:1.1rem;font-weight:700;color:#f1f5f9;margin-bottom:4px;">Score: <span style="color:${scoreColor};">${scoreLabel}</span></div>
            <div style="font-size:0.85rem;color:#64748B;margin-bottom:12px;">Renda do período: <b style="color:#f1f5f9;font-family:'JetBrains Mono',monospace;">R$ ${fmtBRL(income)}</b></div>
            ${recommendations.map(r => `<div style="color:#94A3B8;font-size:0.82rem;margin-bottom:4px;padding:6px 10px;background:rgba(255,255,255,0.03);border-radius:8px;border-left:3px solid ${scoreColor};">${r}</div>`).join('')}
          </div>
        </div>
        
        <!-- 3 Cards de Categoria -->
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:16px;margin-bottom:24px;">
          ${barSegment('Necessidades', current.needs.amount, current.needs.percentage, 50, '#3B82F6', '🏠')}
          ${barSegment('Desejos',      current.wants.amount, current.wants.percentage, 30, '#8B5CF6', '🎮')}
          ${barSegment('Poupança',     current.savings.amount, current.savings.percentage, 20, '#10B981', '💰')}
        </div>
        
        <!-- Breakdown de categorias -->
        ${(breakdown?.top_needs?.length > 0 || breakdown?.top_wants?.length > 0) ? `
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:24px;">
          ${breakdown.top_needs?.length > 0 ? `
          <div style="background:rgba(59,130,246,0.06);border:1px solid rgba(59,130,246,0.15);border-radius:14px;padding:18px;">
            <h4 style="color:#93C5FD;font-size:0.82rem;font-weight:700;margin:0 0 12px;text-transform:uppercase;letter-spacing:1px;">🏠 Top Necessidades</h4>
            ${breakdown.top_needs.map(n => `
            <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid rgba(255,255,255,0.04);">
              <span style="color:#94A3B8;font-size:0.82rem;">${n.cat}</span>
              <span style="color:#60A5FA;font-weight:700;font-size:0.82rem;font-family:'JetBrains Mono',monospace;">R$ ${(n.val||0).toLocaleString('pt-BR',{minimumFractionDigits:2})}</span>
            </div>`).join('')}
          </div>` : ''}
          ${breakdown.top_wants?.length > 0 ? `
          <div style="background:rgba(139,92,246,0.06);border:1px solid rgba(139,92,246,0.15);border-radius:14px;padding:18px;">
            <h4 style="color:#C4B5FD;font-size:0.82rem;font-weight:700;margin:0 0 12px;text-transform:uppercase;letter-spacing:1px;">🎮 Top Desejos</h4>
            ${breakdown.top_wants.map(n => `
            <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid rgba(255,255,255,0.04);">
              <span style="color:#94A3B8;font-size:0.82rem;">${n.cat}</span>
              <span style="color:#A78BFA;font-weight:700;font-size:0.82rem;font-family:'JetBrains Mono',monospace;">R$ ${(n.val||0).toLocaleString('pt-BR',{minimumFractionDigits:2})}</span>
            </div>`).join('')}
          </div>` : ''}
        </div>` : ''}
        
        <!-- Como funciona -->
        <div style="background:linear-gradient(135deg,rgba(16,185,129,0.06),rgba(59,130,246,0.06));border:1px solid rgba(16,185,129,0.15);border-radius:16px;padding:22px;">
          <h3 style="color:#f1f5f9;font-size:0.95rem;font-weight:700;margin:0 0 14px;">📚 Entendendo a Regra 50/30/20</h3>
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:14px;">
            <div style="display:flex;gap:10px;">
              <div style="width:32px;height:32px;background:rgba(59,130,246,0.15);border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:1rem;flex-shrink:0;">🏠</div>
              <div>
                <div style="color:#93C5FD;font-weight:700;font-size:0.82rem;margin-bottom:2px;">50% — Necessidades</div>
                <div style="color:#94A3B8;font-size:0.78rem;line-height:1.4;">Moradia, alimentação, transporte, saúde, contas básicas. Tudo o que é essencial para viver.</div>
              </div>
            </div>
            <div style="display:flex;gap:10px;">
              <div style="width:32px;height:32px;background:rgba(139,92,246,0.15);border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:1rem;flex-shrink:0;">🎮</div>
              <div>
                <div style="color:#C4B5FD;font-weight:700;font-size:0.82rem;margin-bottom:2px;">30% — Desejos</div>
                <div style="color:#94A3B8;font-size:0.78rem;line-height:1.4;">Lazer, viagens, assinaturas, delivery, compras não essenciais. O que traz prazer de viver.</div>
              </div>
            </div>
            <div style="display:flex;gap:10px;">
              <div style="width:32px;height:32px;background:rgba(16,185,129,0.15);border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:1rem;flex-shrink:0;">💰</div>
              <div>
                <div style="color:#6EE7B7;font-weight:700;font-size:0.82rem;margin-bottom:2px;">20% — Poupança</div>
                <div style="color:#94A3B8;font-size:0.78rem;line-height:1.4;">Investimentos, reservas de emergência e fundos específicos. Seu futuro financeiro.</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    `
  },
  
  async recarregar503020() {
    const mes = parseInt(document.getElementById('sel-mes-503020')?.value || new Date().getMonth()+1)
    const ano = parseInt(document.getElementById('sel-ano-503020')?.value || new Date().getFullYear())
    try {
      const data = await this.api('GET', `regra-503020?mes=${mes}&ano=${ano}`)
      this.renderRegra503020(data, mes, ano)
    } catch (e) {
      this.toast('Erro ao recarregar', 'error')
    }
  },

  // ═══════════════════════════════════════════════════════════════
  // v3.0 — SIMULADOR DE AMORTIZAÇÃO INTELIGENTE
  // ═══════════════════════════════════════════════════════════════
  async pageAmortizacao() {
    const content = document.getElementById('page-content')
    
    // Buscar financiamentos cadastrados
    let financiamentos = []
    try {
      const finData = await this.api('GET', 'financiamentos')
      financiamentos = (finData.financiamentos || []).filter(f => f.status === 'ativo' && f.saldo_devedor > 0)
    } catch(e) {}
    
    const fmtBRL = v => (v||0).toLocaleString('pt-BR', {minimumFractionDigits:2,maximumFractionDigits:2})
    
    content.innerHTML = `
      <div style="max-width:900px;">
        <div style="margin-bottom:28px;">
          <h1 style="font-size:1.8rem;font-weight:800;color:#f1f5f9;margin:0 0 6px;">🏦 Simulador de Amortização</h1>
          <p style="color:#64748B;margin:0;">Compare os 2 cenários e tome a melhor decisão financeira para seu financiamento.</p>
        </div>
        
        <!-- Formulário -->
        <div style="background:rgba(15,23,42,0.85);border:1px solid rgba(255,255,255,0.06);border-radius:18px;padding:28px;margin-bottom:24px;">
          <h2 style="color:#f1f5f9;font-size:1rem;font-weight:700;margin:0 0 20px;">📋 Dados do Financiamento</h2>
          
          ${financiamentos.length > 0 ? `
          <div class="form-group">
            <label class="form-label">Carregar Financiamento Cadastrado</label>
            <select id="amort-fin-select" class="form-input" onchange="VM.preencherDadosFinanciamento()">
              <option value="">— Preencher manualmente —</option>
              ${financiamentos.map(f => `<option value="${f.id}" data-balance="${f.saldo_devedor}" data-installment="${f.valor_parcela}" data-months="${f.parcelas_restantes}" data-rate="${f.taxa_juros_anual}" data-system="${(f.sistema_amortizacao||'price').toUpperCase()}">${f.descricao} — R$ ${fmtBRL(f.saldo_devedor)}</option>`).join('')}
            </select>
          </div>` : `
          <div style="background:rgba(59,130,246,0.08);border:1px solid rgba(59,130,246,0.15);border-radius:10px;padding:12px 16px;margin-bottom:16px;">
            <p style="color:#93C5FD;font-size:0.82rem;margin:0;">💡 Cadastre um financiamento na seção "Financiamentos" para carregar automaticamente, ou preencha os dados abaixo.</p>
          </div>`}
          
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:16px;">
            <div class="form-group">
              <label class="form-label">Saldo Devedor (R$)</label>
              <input type="number" id="amort-balance" class="form-input" placeholder="200000.00" step="0.01" min="1">
            </div>
            <div class="form-group">
              <label class="form-label">Parcela Atual (R$)</label>
              <input type="number" id="amort-installment" class="form-input" placeholder="1800.00" step="0.01" min="1">
            </div>
            <div class="form-group">
              <label class="form-label">Prazo Restante (meses)</label>
              <input type="number" id="amort-months" class="form-input" placeholder="300" min="2" step="1">
            </div>
            <div class="form-group">
              <label class="form-label">Taxa de Juros Anual (%)</label>
              <input type="number" id="amort-rate" class="form-input" placeholder="10.5" step="0.01" min="0.1">
            </div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;">
            <div class="form-group">
              <label class="form-label">Sistema de Amortização</label>
              <select id="amort-system" class="form-input">
                <option value="PRICE">PRICE (Parcela Fixa — mais comum)</option>
                <option value="SAC">SAC (Amortização Constante — Caixa)</option>
              </select>
            </div>
            <div class="form-group">
              <label class="form-label" style="color:#10B981;">💰 Valor da Amortização (R$)</label>
              <input type="number" id="amort-extra" class="form-input" placeholder="20000.00" step="0.01" min="1"
                style="border-color:rgba(16,185,129,0.4);">
            </div>
          </div>
          
          <div style="text-align:right;margin-top:8px;">
            <button onclick="VM.calcularAmortizacao()"
              style="background:linear-gradient(135deg,#10B981,#059669);color:#fff;border:none;padding:12px 32px;border-radius:12px;font-weight:700;cursor:pointer;font-size:0.9rem;display:inline-flex;align-items:center;gap:8px;">
              ⚡ Simular Cenários
            </button>
          </div>
        </div>
        
        <!-- Resultado (inicialmente vazio) -->
        <div id="amort-resultado"></div>
      </div>
    `
  },
  
  preencherDadosFinanciamento() {
    const sel = document.getElementById('amort-fin-select')
    if (!sel || !sel.value) return
    const opt = sel.selectedOptions[0]
    document.getElementById('amort-balance').value = opt.dataset.balance || ''
    document.getElementById('amort-installment').value = opt.dataset.installment || ''
    document.getElementById('amort-months').value = opt.dataset.months || ''
    document.getElementById('amort-rate').value = opt.dataset.rate || ''
    const sysEl = document.getElementById('amort-system')
    if (sysEl && opt.dataset.system) sysEl.value = opt.dataset.system
  },
  
  async calcularAmortizacao() {
    const balance = parseFloat(document.getElementById('amort-balance').value)
    const installment = parseFloat(document.getElementById('amort-installment').value)
    const months = parseInt(document.getElementById('amort-months').value)
    const rate = parseFloat(document.getElementById('amort-rate').value)
    const system = document.getElementById('amort-system').value
    const extra = parseFloat(document.getElementById('amort-extra').value)
    const finId = document.getElementById('amort-fin-select')?.value || null
    
    if (!balance || !installment || !months || !rate || !extra)
      return this.toast('Preencha todos os campos obrigatórios', 'error')
    if (extra >= balance)
      return this.toast('Amortização não pode ser maior que o saldo devedor', 'error')
    
    const resultado = document.getElementById('amort-resultado')
    resultado.innerHTML = `<div class="skeleton" style="height:300px;border-radius:16px;"></div>`
    
    try {
      const payload = finId
        ? { financing_id: parseInt(finId), amortization_amount: extra }
        : { manual_balance: balance, manual_installment: installment, manual_remaining_months: months, manual_annual_rate: rate, manual_system: system, amortization_amount: extra }
      
      const sim = await this.api('POST', 'amortizacao/simular', payload)
      this.renderResultadoAmortizacao(sim)
    } catch (err) {
      resultado.innerHTML = `<div style="background:rgba(244,63,94,0.08);border:1px solid rgba(244,63,94,0.2);border-radius:14px;padding:20px;"><p style="color:#FDA4AF;margin:0;">❌ ${err.message}</p></div>`
    }
  },
  
  renderResultadoAmortizacao(sim) {
    const fmtBRL = v => (v||0).toLocaleString('pt-BR', {minimumFractionDigits:2,maximumFractionDigits:2})
    const resultado = document.getElementById('amort-resultado')
    const isReducePay = sim.recommendation === 'reduce_payment'
    
    resultado.innerHTML = `
      <!-- Comparação dos Cenários -->
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:20px;">
        <!-- Cenário A: Reduzir Parcela -->
        <div style="background:rgba(15,23,42,0.85);border:2px solid ${isReducePay ? '#10B981' : 'rgba(255,255,255,0.06)'};border-radius:18px;padding:24px;position:relative;transition:border-color 0.3s;">
          ${isReducePay ? '<div style="position:absolute;top:-12px;left:50%;transform:translateX(-50%);background:linear-gradient(135deg,#10B981,#059669);color:#fff;font-size:0.68rem;padding:4px 12px;border-radius:50px;font-weight:700;white-space:nowrap;">✨ RECOMENDADO</div>' : ''}
          <h3 style="color:#f1f5f9;font-size:1rem;font-weight:700;margin:0 0 16px;display:flex;align-items:center;gap:8px;"><span style="font-size:1.3rem;">💰</span> Reduzir Parcela</h3>
          <div style="background:#0f172a;border-radius:12px;padding:14px;margin-bottom:12px;text-align:center;">
            <div style="color:#64748B;font-size:0.72rem;margin-bottom:4px;">Nova Parcela Mensal</div>
            <div style="font-size:2rem;font-weight:800;color:#10B981;font-family:'JetBrains Mono',monospace;">R$ ${fmtBRL(sim.reduce_payment.new_installment)}</div>
            <div style="color:#6EE7B7;font-size:0.8rem;margin-top:4px;font-weight:600;">📉 -R$ ${fmtBRL(sim.reduce_payment.monthly_savings)}/mês</div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
            <div style="background:#0f172a;border-radius:10px;padding:10px;text-align:center;">
              <div style="font-size:0.65rem;color:#64748B;">Prazo</div>
              <div style="font-size:0.95rem;font-weight:700;color:#94A3B8;">${sim.reduce_payment.remaining_months} meses</div>
              <div style="font-size:0.65rem;color:#64748B;">mantido</div>
            </div>
            <div style="background:#0f172a;border-radius:10px;padding:10px;text-align:center;">
              <div style="font-size:0.65rem;color:#64748B;">Juros Economizados</div>
              <div style="font-size:0.95rem;font-weight:700;color:#10B981;font-family:'JetBrains Mono',monospace;">R$ ${fmtBRL(sim.reduce_payment.interest_saved)}</div>
            </div>
          </div>
        </div>
        
        <!-- Cenário B: Reduzir Prazo -->
        <div style="background:rgba(15,23,42,0.85);border:2px solid ${!isReducePay ? '#10B981' : 'rgba(255,255,255,0.06)'};border-radius:18px;padding:24px;position:relative;transition:border-color 0.3s;">
          ${!isReducePay ? '<div style="position:absolute;top:-12px;left:50%;transform:translateX(-50%);background:linear-gradient(135deg,#10B981,#059669);color:#fff;font-size:0.68rem;padding:4px 12px;border-radius:50px;font-weight:700;white-space:nowrap;">✨ RECOMENDADO</div>' : ''}
          <h3 style="color:#f1f5f9;font-size:1rem;font-weight:700;margin:0 0 16px;display:flex;align-items:center;gap:8px;"><span style="font-size:1.3rem;">⏱️</span> Reduzir Prazo</h3>
          <div style="background:#0f172a;border-radius:12px;padding:14px;margin-bottom:12px;text-align:center;">
            <div style="color:#64748B;font-size:0.72rem;margin-bottom:4px;">Novo Prazo</div>
            <div style="font-size:2rem;font-weight:800;color:#3B82F6;">${sim.reduce_term.remaining_months} <span style="font-size:1rem;">meses</span></div>
            <div style="color:#60A5FA;font-size:0.8rem;margin-top:4px;font-weight:600;">⏩ ${sim.reduce_term.months_saved} meses a menos!</div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
            <div style="background:#0f172a;border-radius:10px;padding:10px;text-align:center;">
              <div style="font-size:0.65rem;color:#64748B;">Parcela</div>
              <div style="font-size:0.95rem;font-weight:700;color:#94A3B8;font-family:'JetBrains Mono',monospace;">R$ ${fmtBRL(sim.reduce_term.new_installment)}</div>
              <div style="font-size:0.65rem;color:#64748B;">mantida</div>
            </div>
            <div style="background:#0f172a;border-radius:10px;padding:10px;text-align:center;">
              <div style="font-size:0.65rem;color:#64748B;">Juros Economizados</div>
              <div style="font-size:0.95rem;font-weight:700;color:#10B981;font-family:'JetBrains Mono',monospace;">R$ ${fmtBRL(sim.reduce_term.interest_saved)}</div>
            </div>
          </div>
        </div>
      </div>
      
      <!-- Recomendação da IA -->
      <div style="background:linear-gradient(135deg,rgba(16,185,129,0.08),rgba(59,130,246,0.08));border:1px solid rgba(16,185,129,0.25);border-radius:18px;padding:24px;margin-bottom:20px;">
        <div style="display:flex;align-items:flex-start;gap:16px;">
          <div style="width:44px;height:44px;background:rgba(16,185,129,0.15);border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:1.4rem;flex-shrink:0;">✨</div>
          <div style="flex:1;">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
              <h3 style="color:#f1f5f9;font-size:1rem;font-weight:700;margin:0;">Recomendação Inteligente</h3>
              <span style="background:rgba(139,92,246,0.2);color:#A78BFA;font-size:0.65rem;padding:2px 8px;border-radius:50px;font-weight:700;">IA</span>
            </div>
            <p style="color:#94A3B8;font-size:0.9rem;line-height:1.6;margin:0 0 16px;">${sim.reason}</p>
            
            <!-- Comparativo direto -->
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;background:rgba(0,0,0,0.2);border-radius:12px;padding:14px;">
              <div>
                <div style="color:#64748B;font-size:0.72rem;margin-bottom:4px;">💰 Reduzir Parcela</div>
                <div style="color:#10B981;font-weight:700;font-family:'JetBrains Mono',monospace;font-size:0.9rem;">Economia: R$ ${fmtBRL(sim.reduce_payment.interest_saved)}</div>
                <div style="color:#64748B;font-size:0.72rem;">+R$ ${fmtBRL(sim.reduce_payment.monthly_savings)}/mês livres</div>
              </div>
              <div>
                <div style="color:#64748B;font-size:0.72rem;margin-bottom:4px;">⏰ Reduzir Prazo</div>
                <div style="color:#10B981;font-weight:700;font-family:'JetBrains Mono',monospace;font-size:0.9rem;">Economia: R$ ${fmtBRL(sim.reduce_term.interest_saved)}</div>
                <div style="color:#64748B;font-size:0.72rem;">${sim.reduce_term.months_saved} meses antes livre</div>
              </div>
            </div>
          </div>
        </div>
      </div>
      
      <!-- Outra simulação -->
      <div style="text-align:center;">
        <button onclick="VM.pageAmortizacao()" style="background:rgba(255,255,255,0.05);color:#94A3B8;border:1px solid rgba(255,255,255,0.1);padding:10px 24px;border-radius:10px;cursor:pointer;font-size:0.85rem;">
          🔄 Nova Simulação
        </button>
      </div>
    `
  },

  // ═══════════════════════════════════════════════════════════════
  // v3.0 — DESAFIO 52 SEMANAS
  // ═══════════════════════════════════════════════════════════════
  async pageDesafio52() {
    const content = document.getElementById('page-content')
    content.innerHTML = `<div class="empty-state"><div class="skeleton" style="height:280px;border-radius:16px;"></div></div>`
    
    const ano = new Date().getFullYear()
    
    try {
      const data = await this.api('GET', `desafio-52?ano=${ano}`)
      const { weeks = [], summary = {}, current_week } = data
      const fmtBRL = v => (v||0).toLocaleString('pt-BR', {minimumFractionDigits:2,maximumFractionDigits:2})
      
      // Grid 13x4 semanas
      const weekGrid = weeks.map(w => {
        const isCurrent = w.week_number === current_week
        const bgColor = w.status === 'completed' ? 'rgba(16,185,129,0.15)' : w.status === 'skipped' ? 'rgba(100,116,139,0.1)' : isCurrent ? 'rgba(245,158,11,0.12)' : 'rgba(255,255,255,0.02)'
        const borderColor = w.status === 'completed' ? '#10B981' : w.status === 'skipped' ? '#475569' : isCurrent ? '#F59E0B' : 'rgba(255,255,255,0.06)'
        const textColor = w.status === 'completed' ? '#10B981' : w.status === 'skipped' ? '#475569' : isCurrent ? '#F59E0B' : '#64748B'
        const icon = w.status === 'completed' ? '✅' : w.status === 'skipped' ? '↩️' : isCurrent ? '⭐' : `${w.week_number}`
        return `
        <div onclick="VM.toggleDesafio52(${w.week_number}, '${w.status}', ${ano})"
          title="Semana ${w.week_number}: R$ ${(w.target_amount||0).toFixed(2)} — ${w.status}"
          style="background:${bgColor};border:1px solid ${borderColor};border-radius:8px;aspect-ratio:1;display:flex;flex-direction:column;align-items:center;justify-content:center;cursor:pointer;transition:all 0.15s;user-select:none;"
          onmouseover="this.style.transform='scale(1.1)'" onmouseout="this.style.transform='scale(1)'">
          <div style="font-size:${w.status === 'completed' || w.status === 'skipped' ? '1rem' : '0.85'}rem;color:${textColor};font-weight:${isCurrent ? '800' : '700'};">${icon}</div>
          ${w.status === 'completed' ? '' : `<div style="font-size:0.6rem;color:#64748B;margin-top:2px;font-weight:600;">R$${w.target_amount}</div>`}
        </div>`
      }).join('')
      
      content.innerHTML = `
        <div style="max-width:960px;">
          <div style="margin-bottom:24px;">
            <h1 style="font-size:1.8rem;font-weight:800;color:#f1f5f9;margin:0 0 6px;">🎯 Desafio 52 Semanas</h1>
            <p style="color:#64748B;margin:0;">Guarde R$ 1 na semana 1, R$ 2 na semana 2... até R$ 52 na semana 52. Total: <b style="color:#10B981;">R$ 1.378,00</b> ao final do ano.</p>
          </div>
          
          <!-- Summary -->
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin-bottom:24px;">
            <div style="background:rgba(16,185,129,0.08);border:1px solid rgba(16,185,129,0.2);border-radius:14px;padding:16px;text-align:center;">
              <div style="color:#6EE7B7;font-size:0.7rem;font-weight:600;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;">✅ Concluídas</div>
              <div style="font-size:2rem;font-weight:800;color:#10B981;">${summary.completed || 0}<span style="font-size:0.9rem;color:#64748B;">/52</span></div>
            </div>
            <div style="background:rgba(16,185,129,0.08);border:1px solid rgba(16,185,129,0.2);border-radius:14px;padding:16px;text-align:center;">
              <div style="color:#6EE7B7;font-size:0.7rem;font-weight:600;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;">💰 Guardado</div>
              <div style="font-size:1.6rem;font-weight:800;color:#10B981;font-family:'JetBrains Mono',monospace;">R$ ${fmtBRL(summary.total_saved)}</div>
            </div>
            <div style="background:rgba(59,130,246,0.08);border:1px solid rgba(59,130,246,0.2);border-radius:14px;padding:16px;text-align:center;">
              <div style="color:#93C5FD;font-size:0.7rem;font-weight:600;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;">⭐ Semana Atual</div>
              <div style="font-size:2rem;font-weight:800;color:#60A5FA;">${current_week}</div>
            </div>
            <div style="background:rgba(139,92,246,0.08);border:1px solid rgba(139,92,246,0.2);border-radius:14px;padding:16px;text-align:center;">
              <div style="color:#C4B5FD;font-size:0.7rem;font-weight:600;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;">📊 Progresso</div>
              <div style="font-size:2rem;font-weight:800;color:#A78BFA;">${summary.progress_pct || 0}%</div>
              <div style="background:#0f172a;border-radius:50px;height:4px;margin-top:4px;overflow:hidden;">
                <div style="height:100%;width:${summary.progress_pct || 0}%;background:#8B5CF6;border-radius:50px;"></div>
              </div>
            </div>
          </div>
          
          <!-- Grid de Semanas -->
          <div style="background:rgba(15,23,42,0.85);border:1px solid rgba(255,255,255,0.06);border-radius:18px;padding:24px;margin-bottom:20px;">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">
              <h2 style="color:#f1f5f9;font-size:0.95rem;font-weight:700;margin:0;">Grade do Desafio ${ano}</h2>
              <div style="display:flex;gap:12px;font-size:0.72rem;color:#64748B;">
                <span>✅ Concluída</span><span style="color:#F59E0B;">⭐ Atual</span><span>↩️ Pulada</span><span>número Pendente</span>
              </div>
            </div>
            <div style="overflow-x:auto;-webkit-overflow-scrolling:touch;">
            <div style="display:grid;grid-template-columns:repeat(13,minmax(44px,1fr));gap:6px;min-width:580px;">
              ${weekGrid}
            </div>
            </div>
          </div>
          
          <!-- Dica motivacional -->
          <div style="background:linear-gradient(135deg,rgba(16,185,129,0.08),rgba(245,158,11,0.08));border:1px solid rgba(16,185,129,0.2);border-radius:16px;padding:20px;">
            <h3 style="color:#f1f5f9;font-size:0.9rem;font-weight:700;margin:0 0 10px;">💡 Como Funciona</h3>
            <p style="color:#94A3B8;font-size:0.82rem;line-height:1.6;margin:0;">
              Na semana 1, guarde R$ 1,00. Na semana 2, R$ 2,00. Assim por diante até R$ 52,00 na semana 52.
              Clique em qualquer semana para marcá-la como concluída ou pular. Ao final do ano você terá acumulado <b style="color:#10B981;">R$ 1.378,00</b>!
              Dica: invista em uma conta remunerada e o rendimento será ainda maior.
            </p>
          </div>
        </div>
      `
    } catch (e) {
      document.getElementById('page-content').innerHTML = `<div class="empty-state"><p style="color:#F43F5E;">Erro: ${e.message}</p></div>`
    }
  },
  
  async toggleDesafio52(week, currentStatus, ano) {
    // Ciclo: pending → completed → skipped → pending
    const nextStatus = currentStatus === 'pending' ? 'completed'
      : currentStatus === 'completed' ? 'skipped'
      : 'pending'
    
    try {
      const resp = await this.api('PATCH', `desafio-52/${week}?ano=${ano}`, { status: nextStatus })
      this.toast(resp.message, nextStatus === 'completed' ? 'success' : 'info')
      this.pageDesafio52()
    } catch (err) {
      this.toast(err.message, 'error')
    }
  },

  // ============== ASSISTENTE IA CONVERSACIONAL ==============
  async pageAssistente() {
    const content = document.getElementById('page-content')
    let historico = []
    
    try {
      const data = await this.api('GET', 'assistente/historico')
      historico = (data.historico || []).reverse() // mostrar em ordem cronológica
    } catch(_) {}

    const renderHistorico = (msgs) => msgs.map(m => `
      <div style="display:flex;flex-direction:column;gap:12px;margin-bottom:4px;">
        <div style="display:flex;justify-content:flex-end;">
          <div style="max-width:75%;background:linear-gradient(135deg,#10B981,#059669);color:#fff;padding:10px 14px;border-radius:18px 18px 4px 18px;font-size:0.87rem;line-height:1.5;word-break:break-word;">
            ${this.escapeHtml(m.mensagem_usuario)}
          </div>
        </div>
        <div style="display:flex;justify-content:flex-start;gap:8px;">
          <div style="width:32px;height:32px;background:#1a2a1a;border:1px solid #2FBF71;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:1rem;flex-shrink:0;">🤖</div>
          <div style="max-width:80%;background:#1a2a1a;border:1px solid #2a3a2a;padding:12px 14px;border-radius:4px 18px 18px 18px;font-size:0.87rem;line-height:1.6;word-break:break-word;white-space:pre-line;">
            ${this.markdownToHtml(m.resposta_ia)}
          </div>
        </div>
      </div>
    `).join('')

    const sugestoesPadrao = ['Ver saldo do mês', 'Como estão meus gastos?', 'Status das metas', 'Dicas para economizar', 'Ver investimentos', 'Ajuda']

    content.innerHTML = `
      <div style="max-width:760px;margin:0 auto;display:flex;flex-direction:column;height:calc(100vh - 160px);">
        
        <!-- Chat Area -->
        <div style="flex:1;overflow-y:auto;background:#0d1a0d;border:1px solid #1a3a1a;border-radius:16px;padding:20px;margin-bottom:12px;display:flex;flex-direction:column;gap:16px;" id="chat-messages">
          ${historico.length === 0 ? `
            <div style="text-align:center;padding:40px 20px;">
              <div style="font-size:3rem;margin-bottom:12px;">🤖</div>
              <div style="font-size:1.1rem;font-weight:700;color:#2FBF71;margin-bottom:8px;">Olá! Sou o Assistente VerdeMais</div>
              <div style="font-size:0.85rem;color:#666;max-width:400px;margin:0 auto;line-height:1.6;">
                Posso responder perguntas sobre seu saldo, gastos, metas, investimentos, dívidas, reservas e muito mais!
                <br><br>
                <strong style="color:#888;">Experimente perguntar:</strong>
              </div>
              <div style="display:flex;flex-wrap:wrap;gap:8px;justify-content:center;margin-top:16px;">
                ${sugestoesPadrao.map(s => `<button onclick="VM.assistenteSend('${s}')" style="background:#1a2a1a;border:1px solid #2FBF71;color:#2FBF71;padding:6px 14px;border-radius:20px;font-size:0.8rem;cursor:pointer;transition:all 0.2s;" onmouseover="this.style.background='#2FBF71';this.style.color='#000'" onmouseout="this.style.background='#1a2a1a';this.style.color='#2FBF71'">${s}</button>`).join('')}
              </div>
            </div>
          ` : renderHistorico(historico)}
        </div>

        <!-- Sugestões rápidas -->
        <div id="chat-sugestoes" style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px;">
          ${sugestoesPadrao.slice(0, 4).map(s => `<button onclick="VM.assistenteSend('${s}')" style="background:#1a2a1a;border:1px solid #2a3a2a;color:#888;padding:4px 12px;border-radius:16px;font-size:0.77rem;cursor:pointer;transition:all 0.15s;" onmouseover="this.style.borderColor='#2FBF71';this.style.color='#2FBF71'" onmouseout="this.style.borderColor='#2a3a2a';this.style.color='#888'">${s}</button>`).join('')}
        </div>

        <!-- Input Area -->
        <div style="display:flex;gap:10px;align-items:flex-end;">
          <div style="flex:1;background:#1a2a1a;border:1px solid #2a3a2a;border-radius:12px;padding:4px 8px;display:flex;align-items:center;gap:8px;transition:border-color 0.2s;" onfocus="this.style.borderColor='#2FBF71'" id="chat-input-wrap">
            <textarea id="chat-input" placeholder="Digite sua pergunta financeira..." 
              style="flex:1;background:none;border:none;outline:none;color:#e0e0e0;font-size:0.9rem;padding:8px 4px;resize:none;max-height:100px;font-family:inherit;line-height:1.5;"
              rows="1"
              onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();VM.assistenteEnviar()}"
              oninput="this.style.height='auto';this.style.height=Math.min(this.scrollHeight,100)+'px'"
            ></textarea>
          </div>
          <button onclick="VM.assistenteEnviar()" id="btn-enviar-chat"
            style="background:linear-gradient(135deg,#10B981,#059669);border:none;color:#fff;width:44px;height:44px;border-radius:12px;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:1.1rem;flex-shrink:0;transition:opacity 0.2s;">
            <i class="fas fa-paper-plane"></i>
          </button>
          <button onclick="VM.assistenteLimpar()" title="Limpar histórico"
            style="background:#1a2a1a;border:1px solid #2a3a2a;color:#555;width:44px;height:44px;border-radius:12px;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:0.9rem;flex-shrink:0;">
            <i class="fas fa-trash"></i>
          </button>
        </div>
      </div>
    `
    
    // Scroll para o fim
    const chatMsgs = document.getElementById('chat-messages')
    if (chatMsgs) chatMsgs.scrollTop = chatMsgs.scrollHeight
    
    // Focus no input
    setTimeout(() => document.getElementById('chat-input')?.focus(), 100)
  },

  // ── IMPORTAÇÃO CSV ──────────────────────────────────────────────────────────
  async pageImportacao() {
    const content = document.getElementById('page-content')
    content.innerHTML = `
      <div style="max-width:900px;margin:0 auto;padding:16px;">
        <h2 style="color:#fff;font-size:1.3rem;font-weight:700;margin-bottom:20px;">
          <i class="fas fa-file-import" style="color:#2FBF71;margin-right:8px;"></i>Importar CSV
        </h2>

        <!-- PASSO A PASSO -->
        <div style="background:rgba(47,191,113,0.06);border:1px solid rgba(47,191,113,0.2);border-radius:14px;margin-bottom:20px;">
          <button onclick="(function(el){el.style.display=el.style.display==='none'?'block':'none'})(document.getElementById('imp-guia'))"
            style="width:100%;background:none;border:none;padding:16px 20px;display:flex;align-items:center;justify-content:space-between;cursor:pointer;">
            <span style="color:#2FBF71;font-weight:700;font-size:0.92rem;"><i class="fas fa-info-circle" style="margin-right:8px;"></i>Como usar o Importar CSV — Passo a Passo</span>
            <i class="fas fa-chevron-down" style="color:#2FBF71;font-size:0.8rem;"></i>
          </button>
          <div id="imp-guia" style="display:none;padding:0 20px 20px;">

            <!-- Passo 1 -->
            <div style="border-left:3px solid #2FBF71;padding-left:14px;margin-bottom:18px;">
              <div style="color:#2FBF71;font-weight:700;font-size:0.88rem;margin-bottom:6px;">① Escolha o tipo de importação</div>
              <p style="color:#cbd5e1;font-size:0.83rem;margin:0;">Selecione <strong style="color:#fff;">Despesas</strong> para importar gastos e faturas, ou <strong style="color:#fff;">Receitas</strong> para importar salários e entradas.</p>
            </div>

            <!-- Passo 2 -->
            <div style="border-left:3px solid #38bdf8;padding-left:14px;margin-bottom:18px;">
              <div style="color:#38bdf8;font-weight:700;font-size:0.88rem;margin-bottom:6px;">② Prepare o arquivo CSV</div>
              <p style="color:#cbd5e1;font-size:0.83rem;margin:0 0 10px;">O CSV precisa ter as seguintes colunas (a ordem pode variar, o sistema detecta automaticamente):</p>
              <div style="background:rgba(0,0,0,0.35);border-radius:10px;padding:12px;font-family:monospace;font-size:0.78rem;color:#a5f3fc;overflow-x:auto;">
                <div style="color:#94a3b8;margin-bottom:6px;"># Formato mínimo (separado por ; ou ,)</div>
                <div>data;descricao;valor</div>
                <div style="color:#94a3b8;margin:6px 0 4px;"># Formato completo (com categoria)</div>
                <div>data;descricao;valor;categoria</div>
                <div style="color:#94a3b8;margin:8px 0 4px;"># Exemplos de linhas</div>
                <div>15/03/2026;Supermercado Extra;-150,00;Alimentação</div>
                <div>10/03/2026;Salário empresa;4500.00;Salário</div>
                <div>05/03/2026;Netflix;45,90;Lazer</div>
              </div>
            </div>

            <!-- Passo 3 -->
            <div style="border-left:3px solid #f59e0b;padding-left:14px;margin-bottom:18px;">
              <div style="color:#f59e0b;font-weight:700;font-size:0.88rem;margin-bottom:6px;">③ Regras importantes dos dados</div>
              <ul style="color:#cbd5e1;font-size:0.83rem;margin:0;padding-left:16px;line-height:1.8;">
                <li><strong style="color:#fff;">Data:</strong> aceita <code style="color:#a5f3fc;">DD/MM/AAAA</code>, <code style="color:#a5f3fc;">AAAA-MM-DD</code> ou <code style="color:#a5f3fc;">DD-MM-AAAA</code></li>
                <li><strong style="color:#fff;">Valor:</strong> use <code style="color:#a5f3fc;">150,00</code> ou <code style="color:#a5f3fc;">150.00</code> — negativos são aceitos para despesas</li>
                <li><strong style="color:#fff;">Separador:</strong> vírgula <code style="color:#a5f3fc;">,</code> ou ponto-e-vírgula <code style="color:#a5f3fc;">;</code> — detectado automaticamente</li>
                <li><strong style="color:#fff;">Categoria:</strong> coluna opcional; se ausente, o sistema sugere pela descrição</li>
                <li><strong style="color:#fff;">Cabeçalho:</strong> a primeira linha deve conter os nomes das colunas</li>
                <li><strong style="color:#fff;">Encoding:</strong> salve o arquivo como <code style="color:#a5f3fc;">UTF-8</code> para evitar caracteres estranhos</li>
              </ul>
            </div>

            <!-- Passo 4 -->
            <div style="border-left:3px solid #a78bfa;padding-left:14px;margin-bottom:18px;">
              <div style="color:#a78bfa;font-weight:700;font-size:0.88rem;margin-bottom:6px;">④ Exportando do seu banco</div>
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
                <div style="background:rgba(255,255,255,0.04);border-radius:8px;padding:10px;">
                  <div style="color:#e2e8f0;font-size:0.8rem;font-weight:600;margin-bottom:4px;">🏦 Nubank</div>
                  <div style="color:#94a3b8;font-size:0.75rem;">App → Meu Perfil → Exportar fatura (CSV)</div>
                </div>
                <div style="background:rgba(255,255,255,0.04);border-radius:8px;padding:10px;">
                  <div style="color:#e2e8f0;font-size:0.8rem;font-weight:600;margin-bottom:4px;">🏦 Itaú / C6</div>
                  <div style="color:#94a3b8;font-size:0.75rem;">Internet Banking → Extrato → Exportar CSV</div>
                </div>
                <div style="background:rgba(255,255,255,0.04);border-radius:8px;padding:10px;">
                  <div style="color:#e2e8f0;font-size:0.8rem;font-weight:600;margin-bottom:4px;">🏦 Inter / PicPay</div>
                  <div style="color:#94a3b8;font-size:0.75rem;">App → Extrato → Exportar → CSV</div>
                </div>
                <div style="background:rgba(255,255,255,0.04);border-radius:8px;padding:10px;">
                  <div style="color:#e2e8f0;font-size:0.8rem;font-weight:600;margin-bottom:4px;">📊 Planilha Excel</div>
                  <div style="color:#94a3b8;font-size:0.75rem;">Arquivo → Salvar como → CSV UTF-8</div>
                </div>
              </div>
            </div>

            <!-- Passo 5 -->
            <div style="border-left:3px solid #f43f5e;padding-left:14px;">
              <div style="color:#f43f5e;font-weight:700;font-size:0.88rem;margin-bottom:6px;">⑤ Cole ou carregue, revise e confirme</div>
              <p style="color:#cbd5e1;font-size:0.83rem;margin:0;">Após colar/carregar o CSV clique em <strong style="color:#fff;">Pré-visualizar e Analisar</strong>. O sistema mostrará cada linha para revisão — você pode ajustar categorias, ignorar linhas duplicadas e vincular a um cartão antes de confirmar a importação.</p>
            </div>

          </div>
        </div>

        <!-- STEP 1: Upload -->
        <div id="imp-step1">
          <div style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:14px;padding:24px;">
            <p style="color:#aaa;margin-bottom:16px;font-size:0.9rem;">Cole ou carregue seu CSV de extrato bancário ou fatura de cartão.</p>
            <div style="display:flex;gap:12px;margin-bottom:16px;">
              <label style="display:flex;align-items:center;gap:8px;cursor:pointer;">
                <input type="radio" name="imp-tipo" value="despesas" checked style="accent-color:#2FBF71;">
                <span style="color:#e0e0e0;font-size:0.9rem;">Despesas</span>
              </label>
              <label style="display:flex;align-items:center;gap:8px;cursor:pointer;">
                <input type="radio" name="imp-tipo" value="receitas" style="accent-color:#2FBF71;">
                <span style="color:#e0e0e0;font-size:0.9rem;">Receitas</span>
              </label>
            </div>
            <textarea id="imp-csv" placeholder="Cole aqui o conteúdo do CSV..." rows="10"
              style="width:100%;background:rgba(0,0,0,0.3);border:1px solid rgba(255,255,255,0.12);border-radius:10px;color:#e0e0e0;padding:12px;font-size:0.82rem;font-family:monospace;resize:vertical;box-sizing:border-box;"></textarea>
            <div style="margin-top:8px;display:flex;align-items:center;gap:10px;">
              <label style="color:#aaa;font-size:0.8rem;cursor:pointer;display:flex;align-items:center;gap:6px;">
                <input type="file" id="imp-file" accept=".csv,.txt" style="display:none;" onchange="VM._impCarregarArquivo(this)">
                <span style="padding:6px 14px;background:rgba(255,255,255,0.07);border:1px solid rgba(255,255,255,0.1);border-radius:8px;">
                  <i class="fas fa-upload" style="margin-right:4px;"></i>Carregar arquivo
                </span>
              </label>
            </div>
            <button id="imp-btn-preview" onclick="VM._impPreview()" style="width:100%;margin-top:16px;padding:14px;background:linear-gradient(135deg,#2FBF71,#059669);border:none;border-radius:10px;color:#fff;font-weight:700;font-size:0.95rem;cursor:pointer;">
              <i class="fas fa-search" style="margin-right:6px;"></i>Pré-visualizar e Analisar
            </button>
            <!-- Botão OCR -->
            <div style="margin-top:10px;display:flex;gap:8px;align-items:center;">
              <label style="flex:1;cursor:pointer;">
                <input type="file" id="imp-ocr-file" accept="image/*,.pdf" style="display:none;" onchange="VM._impOCR(this)">
                <div style="width:100%;padding:11px;background:rgba(139,92,246,0.12);border:1px dashed rgba(139,92,246,0.4);border-radius:10px;color:#a78bfa;font-weight:600;font-size:0.85rem;cursor:pointer;text-align:center;">
                  <i class="fas fa-camera" style="margin-right:6px;"></i>Importar por Foto ou PDF de Extrato (OCR com IA)
                </div>
              </label>
            </div>
            <div id="imp-ocr-status" style="display:none;margin-top:8px;padding:10px 14px;background:rgba(139,92,246,0.1);border-radius:8px;color:#c4b5fd;font-size:0.82rem;"></div>
          </div>
        </div>

        <!-- STEP 2: Preview enriquecido -->
        <div id="imp-step2" style="display:none;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
            <button onclick="VM._impVoltar()" style="background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.1);color:#aaa;padding:6px 14px;border-radius:8px;font-size:0.8rem;cursor:pointer;">← Voltar</button>
            <span id="imp-stats-badge" style="font-size:0.8rem;color:#aaa;"></span>
          </div>

          <!-- Painel de alertas globais -->
          <div id="imp-alertas" style="display:none;margin-bottom:16px;"></div>

          <!-- Configurações globais do lote -->
          <div style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:12px;padding:16px;margin-bottom:16px;">
            <h3 style="color:#2FBF71;font-size:0.9rem;font-weight:600;margin-bottom:12px;"><i class="fas fa-sliders-h" style="margin-right:6px;"></i>Configurações do Lote</h3>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
              <div>
                <label style="color:#aaa;font-size:0.8rem;display:block;margin-bottom:4px;">Vincular TODOS ao cartão:</label>
                <select id="imp-cartao-lote" onchange="VM._impCartaoLoteChange(this.value)" style="width:100%;background:rgba(0,0,0,0.4);border:1px solid rgba(255,255,255,0.1);color:#e0e0e0;padding:8px;border-radius:8px;font-size:0.85rem;">
                  <option value="">— Nenhum cartão (dinheiro/pix) —</option>
                </select>
              </div>
              <div>
                <label style="color:#aaa;font-size:0.8rem;display:block;margin-bottom:4px;">Ações rápidas em duplicatas:</label>
                <div style="display:flex;gap:8px;margin-top:4px;">
                  <button onclick="VM._impDecidirTodos(true)" style="padding:6px 12px;background:rgba(47,191,113,0.15);border:1px solid rgba(47,191,113,0.3);color:#2FBF71;border-radius:8px;font-size:0.78rem;cursor:pointer;">✅ Importar todos</button>
                  <button onclick="VM._impDecidirTodos(false)" style="padding:6px 12px;background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.3);color:#ef4444;border-radius:8px;font-size:0.78rem;cursor:pointer;">🚫 Ignorar todos</button>
                </div>
              </div>
            </div>
          </div>

          <!-- Tabela de linhas -->
          <div id="imp-linhas-container" style="display:flex;flex-direction:column;gap:8px;max-height:520px;overflow-y:auto;padding-right:4px;"></div>

          <button id="imp-btn-executar" onclick="VM._impExecutar()" style="width:100%;margin-top:16px;padding:14px;background:linear-gradient(135deg,#2FBF71,#059669);border:none;border-radius:10px;color:#fff;font-weight:700;font-size:0.95rem;cursor:pointer;">
            <i class="fas fa-check-circle" style="margin-right:6px;"></i>Confirmar e Importar
          </button>
        </div>

        <!-- STEP 3: Resultado -->
        <div id="imp-step3" style="display:none;"></div>
      </div>
    `
  },

  _impCarregarArquivo(input) {
    const file = input.files[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = e => {
      document.getElementById('imp-csv').value = e.target.result
    }
    reader.readAsText(file, 'UTF-8')
  },

  // ── OCR: foto ou PDF de extrato ───────────────────────────────────────────
  // Carrega pdf.js CDN de forma lazy (UMD build — expõe window.pdfjsLib)
  async _loadPdfJs() {
    if (window.pdfjsLib) return window.pdfjsLib
    await new Promise((resolve, reject) => {
      const s = document.createElement('script')
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js'
      s.onload = resolve
      s.onerror = reject
      document.head.appendChild(s)
    })
    if (!window.pdfjsLib) throw new Error('pdf.js não carregou')
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'
    return window.pdfjsLib
  },

  // Extrai texto de todas as páginas de um PDF (File)
  async _pdfExtrairTexto(file) {
    const pdfjsLib = await this._loadPdfJs()
    const arrayBuffer = await file.arrayBuffer()
    const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) }).promise
    let textoTotal = ''
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i)
      const content = await page.getTextContent()
      const linhas = content.items.map((item) => item.str).join(' ')
      textoTotal += linhas + '\n'
    }
    return textoTotal.trim()
  },

  async _impOCR(input) {
    const file = input.files[0]
    if (!file) return
    const statusEl = document.getElementById('imp-ocr-status')
    statusEl.style.display = 'block'

    const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
    const tipo = document.querySelector('input[name="imp-tipo"]:checked')?.value || 'despesas'

    try {
      let data

      if (isPdf) {
        // PDF com texto: extrair texto e enviar para endpoint de texto
        statusEl.innerHTML = '<i class="fas fa-spinner fa-spin" style="margin-right:6px;"></i>Lendo PDF... aguarde'
        let textoExtrato
        try {
          textoExtrato = await this._pdfExtrairTexto(file)
        } catch(pdfErr) {
          statusEl.innerHTML = `<i class="fas fa-exclamation-triangle" style="margin-right:6px;color:#ef4444;"></i>Erro ao ler PDF: ${pdfErr.message}. Tente tirar uma foto/screenshot do extrato.`
          input.value = ''
          return
        }

        if (!textoExtrato || textoExtrato.length < 50) {
          statusEl.innerHTML = '<i class="fas fa-exclamation-triangle" style="margin-right:6px;color:#ef4444;"></i>Não foi possível extrair texto do PDF. Tente enviar uma foto/screenshot do extrato.'
          input.value = ''
          return
        }

        statusEl.innerHTML = '<i class="fas fa-spinner fa-spin" style="margin-right:6px;"></i>Analisando extrato com IA... aguarde'
        try {
          data = await this.api('POST', 'importacao/ocr-texto', { texto_extrato: textoExtrato, tipo })
        } catch(apiErr) {
          const msg = apiErr?.response?.data?.error || apiErr?.message || 'Erro ao processar extrato'
          statusEl.innerHTML = `<i class="fas fa-exclamation-triangle" style="margin-right:6px;color:#ef4444;"></i>${msg}`
          input.value = ''
          return
        }

      } else {
        // Imagem: converter para base64 e enviar para endpoint de imagem
        statusEl.innerHTML = '<i class="fas fa-spinner fa-spin" style="margin-right:6px;"></i>Analisando imagem com IA... aguarde'
        const base64 = await new Promise((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = e => resolve(e.target.result.split(',')[1])
          reader.onerror = reject
          reader.readAsDataURL(file)
        })
        const mimeType = file.type || 'image/jpeg'
        try {
          data = await this.api('POST', 'importacao/ocr', { imagem_base64: base64, mime_type: mimeType, tipo })
        } catch(apiErr) {
          const msg = apiErr?.response?.data?.error || apiErr?.message || 'Erro ao processar imagem'
          statusEl.innerHTML = `<i class="fas fa-exclamation-triangle" style="margin-right:6px;color:#ef4444;"></i>${msg}`
          input.value = ''
          return
        }
      }

      if (data.error) {
        statusEl.innerHTML = `<i class="fas fa-exclamation-triangle" style="margin-right:6px;color:#ef4444;"></i>${data.error}`
        input.value = ''
        return
      }

      // Preencher o textarea com o CSV gerado
      document.getElementById('imp-csv').value = data.csv
      statusEl.innerHTML = `<i class="fas fa-check-circle" style="margin-right:6px;color:#2FBF71;"></i>✅ ${data.total_filtrados} lançamentos extraídos — <strong>${data.banco_detectado}</strong>${data.periodo ? ' · ' + data.periodo : ''}. Revise e clique em Pré-visualizar.`

    } catch(e) {
      statusEl.innerHTML = `<i class="fas fa-exclamation-triangle" style="margin-right:6px;color:#ef4444;"></i>Erro: ${e.message}`
    }
    // Reset o input para permitir novo upload
    input.value = ''
  },

  // ── Criar investimento a partir de sugestão do preview ────────────────────
  async _impSugerirInvestimento(idx, nome, tipo, valor, data) {
    const ok = await this._confirmar(`Criar <b>${nome}</b> como investimento de <b>R$ ${Number(valor).toFixed(2)}</b>?`)
    if (!ok) return
    try {
      const resp = await this.api('POST', 'importacao/criar-investimento', { nome, tipo, valor_investido: valor, data_inicio: data })
      if (resp.sucesso) {
        this.toast(`✅ ${resp.mensagem}`, 'success')
        const el = document.querySelector(`#imp-linha-${idx} [onclick*="_impSugerirInvestimento"]`)
        if (el) el.remove()
      } else {
        this.toast(resp.error || 'Erro ao criar investimento', 'error')
      }
    } catch(e) { this.toast('Erro: ' + e.message, 'error') }
  },

  // ── Criar recorrência a partir de sugestão do preview ─────────────────────
  async _impSugerirRecorrencia(idx, descricao, categoria, valor, tipo_rec, meio) {
    const ok = await this._confirmar(`Criar recorrência <b>${descricao}</b> (${tipo_rec}) de <b>R$ ${Number(valor).toFixed(2)}/mês</b>?`)
    if (!ok) return
    try {
      const resp = await this.api('POST', 'importacao/criar-recorrencia', { descricao, categoria, valor, tipo: tipo_rec, meio_pagamento: meio })
      if (resp.sucesso) {
        this.toast(`✅ ${resp.mensagem}`, 'success')
        const el = document.querySelector(`#imp-linha-${idx} [onclick*="_impSugerirRecorrencia"]`)
        if (el) el.remove()
      } else if (resp.error?.includes('Já existe')) {
        this.toast(`ℹ️ ${resp.error}`, 'info')
      } else {
        this.toast(resp.error || 'Erro ao criar recorrência', 'error')
      }
    } catch(e) { this.toast('Erro: ' + e.message, 'error') }
  },

  // ── Modal de confirmação customizado (substitui confirm() nativo) ──────────
  _confirmar(html) {
    return new Promise(resolve => {
      const old = document.getElementById('vm-confirm-modal')
      if (old) old.remove()
      const d = document.createElement('div')
      d.id = 'vm-confirm-modal'
      d.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:99999;display:flex;align-items:center;justify-content:center;padding:16px;'
      d.innerHTML = `
        <div style="background:#111827;border:1px solid #2FBF71;border-radius:16px;padding:28px 24px;max-width:380px;width:100%;text-align:center;">
          <div style="font-size:0.95rem;color:#e2e8f0;line-height:1.6;margin-bottom:20px;">${html}</div>
          <div style="display:flex;gap:10px;justify-content:center;">
            <button id="vm-confirm-ok" style="padding:10px 28px;background:#2FBF71;border:none;border-radius:10px;color:#000;font-weight:700;cursor:pointer;">✅ Confirmar</button>
            <button id="vm-confirm-cancel" style="padding:10px 22px;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.15);border-radius:10px;color:#aaa;cursor:pointer;">Cancelar</button>
          </div>
        </div>`
      document.body.appendChild(d)
      document.getElementById('vm-confirm-ok').onclick = () => { d.remove(); resolve(true) }
      document.getElementById('vm-confirm-cancel').onclick = () => { d.remove(); resolve(false) }
    })
  },

  async _impPreview() {
    const btn = document.getElementById('imp-btn-preview')
    const csv = document.getElementById('imp-csv').value.trim()
    const tipo = document.querySelector('input[name="imp-tipo"]:checked')?.value || 'despesas'

    if (!csv) { this.toast('Cole o CSV antes de continuar', 'error'); return }
    btn.disabled = true
    btn.innerHTML = '<i class="fas fa-spinner fa-spin" style="margin-right:6px;"></i>Analisando...'

    try {
      const resp = await this.api('POST', 'importacao/preview', { csv, tipo })
      this._impData = { csv, tipo, preview: resp.preview, mapeamento: {
        data: resp.colunas_detectadas?.data !== null ? resp.cabecalho_original?.indexOf(resp.colunas_detectadas?.data) : -1,
        descricao: resp.colunas_detectadas?.descricao !== null ? resp.cabecalho_original?.indexOf(resp.colunas_detectadas?.descricao) : -1,
        valor: resp.colunas_detectadas?.valor !== null ? resp.cabecalho_original?.indexOf(resp.colunas_detectadas?.valor) : -1,
        categoria: resp.colunas_detectadas?.categoria !== null ? resp.cabecalho_original?.indexOf(resp.colunas_detectadas?.categoria) : -1,
      }, cartoes: resp.cartoes || [], tags: resp.tags || [], stats: resp.stats || {} }

      // Preencher select de cartões
      document.getElementById('imp-step1').style.display = 'none'
      document.getElementById('imp-step2').style.display = 'block'
      document.getElementById('imp-step3').style.display = 'none'

      const sel = document.getElementById('imp-cartao-lote')
      sel.innerHTML = '<option value="">— Nenhum cartão (dinheiro/pix) —</option>'
      for (const c of (resp.cartoes || [])) {
        const disp = (c.limite_disponivel || 0).toFixed(2)
        const total = (c.limite_total || 0).toFixed(2)
        sel.innerHTML += `<option value="${c.id}">${c.nome} (${c.bandeira || ''}) — Disponível: R$ ${disp} / R$ ${total}</option>`
      }

      // Badge de stats
      const s = resp.stats || {}
      const parts = [`${s.total||0} linhas`]
      if (s.duplicatas_provaveis > 0) parts.push(`<span style="color:#ef4444">🔴 ${s.duplicatas_provaveis} duplicata(s)</span>`)
      if (s.duplicatas_possiveis > 0) parts.push(`<span style="color:#f59e0b">🟡 ${s.duplicatas_possiveis} possível(is)</span>`)
      if (s.parcelas_detectadas > 0) parts.push(`<span style="color:#3b82f6">📦 ${s.parcelas_detectadas} parcela(s)</span>`)
      if ((s.tags_novas||0) > 0) parts.push(`<span style="color:#8b5cf6">🏷✨ ${s.tags_novas} tag(s) nova(s)</span>`)
      if ((s.tags_vinculadas||0) > 0) parts.push(`<span style="color:#8b5cf6">🏷 ${s.tags_vinculadas} tag(s) vinculada(s)</span>`)
      document.getElementById('imp-stats-badge').innerHTML = parts.join(' &nbsp;|&nbsp; ')

      // Alertas globais
      const alertasEl = document.getElementById('imp-alertas')
      const alertas = []
      if (resp.erros_preview?.length > 0) {
        alertas.push(`<div style="background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.3);border-radius:8px;padding:10px;color:#ef4444;font-size:0.82rem;">
          <b>Erros de leitura:</b><br>${resp.erros_preview.slice(0,5).join('<br>')}
        </div>`)
      }
      if (alertas.length > 0) {
        alertasEl.style.display = 'block'
        alertasEl.innerHTML = alertas.join('')
      }

      // Renderizar linhas
      this._impRenderizarLinhas()

    } catch(e) {
      btn.disabled = false
      btn.innerHTML = '<i class="fas fa-search" style="margin-right:6px;"></i>Pré-visualizar e Analisar'
      this.toast('Erro ao analisar CSV: ' + (e.message || e), 'error')
    }
  },

  _impRenderizarLinhas() {
    const container = document.getElementById('imp-linhas-container')
    if (!container) return
    const preview = this._impData?.preview || []
    const tags = this._impData?.tags || []

    container.innerHTML = preview.map((item, idx) => {
      const dup = item.duplicata
      const parc = item.parcela
      const tagSug = item.tag_sugerida

      let borderColor = 'rgba(255,255,255,0.06)'
      let bgColor = 'rgba(255,255,255,0.03)'
      let dupBadge = ''
      let decisao = item.decisao !== false

      if (dup?.nivel === 'provavel') {
        borderColor = 'rgba(239,68,68,0.4)'
        bgColor = 'rgba(239,68,68,0.07)'
        dupBadge = `<span style="background:rgba(239,68,68,0.15);color:#ef4444;padding:2px 8px;border-radius:12px;font-size:0.72rem;font-weight:600;">🔴 Duplicata Provável</span>`
        decisao = false
      } else if (dup?.nivel === 'possivel') {
        borderColor = 'rgba(245,158,11,0.4)'
        bgColor = 'rgba(245,158,11,0.06)'
        dupBadge = `<span style="background:rgba(245,158,11,0.15);color:#f59e0b;padding:2px 8px;border-radius:12px;font-size:0.72rem;font-weight:600;">🟡 Possível Duplicata</span>`
        decisao = false
      }

      const parcBadge = parc
        ? `<span style="background:rgba(59,130,246,0.15);color:#3b82f6;padding:2px 8px;border-radius:12px;font-size:0.72rem;font-weight:600;">📦 Parcela ${parc.atual}/${parc.total}</span>`
        : ''

      // Badge de investimento sugerido
      const inv = item.investimento_sugerido
      const invNomeSafe = inv ? (inv.nome||'').replace(/'/g, '&#39;') : ''
      const invBadge = inv
        ? `<span style="background:rgba(16,185,129,0.15);color:#10b981;padding:2px 8px;border-radius:12px;font-size:0.72rem;border:1px dashed #10b981;cursor:pointer;"
            onclick="VM._impSugerirInvestimento(${item.linha-1}, '${invNomeSafe}', '${inv.tipo}', ${item.valor}, '${item.data}')"
            title="Clique para criar como investimento">💰 Investimento? <span style="font-size:0.65rem;opacity:0.8;">(clique para criar)</span></span>`
        : ''

      // Badge de recorrência sugerida
      const rec = item.recorrencia_sugerida
      const recDescSafe = rec ? (rec.descricao||'').replace(/'/g, '&#39;') : ''
      const recBadge = rec
        ? `<span style="background:rgba(251,146,60,0.15);color:#fb923c;padding:2px 8px;border-radius:12px;font-size:0.72rem;border:1px dashed #fb923c;cursor:pointer;"
            onclick="VM._impSugerirRecorrencia(${item.linha-1}, '${recDescSafe}', '${rec.categoria}', ${item.valor}, '${rec.tipo_rec}', '${item.meio_pagamento||'outros'}')"
            title="Clique para criar recorrência">🔄 Recorrente? <span style="font-size:0.65rem;opacity:0.8;">(clique para criar)</span></span>`
        : ''

      const tagBadge = tagSug
        ? tagSug.nova
          ? `<span style="background:rgba(139,92,246,0.15);color:#8b5cf6;padding:2px 8px;border-radius:12px;font-size:0.72rem;border:1px dashed #8b5cf6;">🏷✨ ${tagSug.nome} <span style="font-size:0.65rem;opacity:0.8;">(nova)</span></span>`
          : `<span style="background:rgba(139,92,246,0.15);color:#8b5cf6;padding:2px 8px;border-radius:12px;font-size:0.72rem;">🏷 ${tagSug.nome}</span>`
        : ''

      const status = item.status_sugerido || 'pago'
      const statusBadge = status === 'pendente'
        ? `<span style="background:rgba(245,158,11,0.15);color:#f59e0b;padding:2px 8px;border-radius:12px;font-size:0.72rem;">⏳ pendente</span>`
        : `<span style="background:rgba(47,191,113,0.12);color:#2FBF71;padding:2px 8px;border-radius:12px;font-size:0.72rem;">✅ pago</span>`

      const tagOptions = tags.map(t =>
        `<option value="${t.id}" ${tagSug?.id === t.id ? 'selected' : ''}>${t.nome}</option>`
      ).join('')

      const cartoes = this._impData?.cartoes || []
      const cartaoOptions = cartoes.map(c =>
        `<option value="${c.id}">${c.nome}</option>`
      ).join('')

      const checkedStr = decisao ? 'checked' : ''
      const checkColor = decisao ? '#2FBF71' : '#ef4444'
      const checkLabel = decisao ? 'Importar' : 'Ignorar'

      const meioMap = { dinheiro:'💵 dinheiro', pix:'⚡ pix', cartao_credito:'💳 crédito', cartao_debito:'💳 débito', transferencia:'🔄 transf.', boleto:'📄 boleto', parcelado_cartao:'💳 parcelado' }
      const meioLabel = meioMap[item.meio_pagamento] || item.meio_pagamento

      return `
        <div id="imp-linha-${idx}" data-linha="${item.linha}" data-idx="${idx}"
          style="background:${bgColor};border:1px solid ${borderColor};border-radius:10px;padding:12px;transition:all 0.2s;">
          <div style="display:flex;align-items:flex-start;gap:10px;">
            <div style="flex-shrink:0;margin-top:2px;">
              <label style="display:flex;align-items:center;gap:4px;cursor:pointer;">
                <input type="checkbox" id="imp-chk-${idx}" ${checkedStr}
                  onchange="VM._impToggleDecisao(${idx}, this.checked)"
                  style="accent-color:#2FBF71;width:16px;height:16px;cursor:pointer;">
                <span id="imp-chk-label-${idx}" style="font-size:0.72rem;color:${checkColor};font-weight:600;min-width:44px;">${checkLabel}</span>
              </label>
            </div>

            <div style="flex:1;min-width:0;">
              <div style="display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin-bottom:6px;">
                <span style="color:#e0e0e0;font-size:0.88rem;font-weight:600;">${item.descricao}</span>
                ${dupBadge}${parcBadge}${tagBadge}${statusBadge}${invBadge}${recBadge}
              </div>
              <div style="display:flex;flex-wrap:wrap;gap:10px;font-size:0.8rem;color:#aaa;margin-bottom:6px;">
                <span>📅 ${item.data}</span>
                <span style="color:#2FBF71;font-weight:600;">R$ ${item.valor?.toFixed(2)}</span>
                <span>📂 ${item.categoria}</span>
                <span id="imp-meio-label-${idx}">${meioLabel}</span>
              </div>

              ${dup ? `<div style="background:rgba(${dup.nivel==='provavel'?'239,68,68':'245,158,11'},0.1);border-radius:6px;padding:6px 10px;font-size:0.78rem;color:${dup.nivel==='provavel'?'#ef4444':'#f59e0b'};margin-bottom:6px;">⚠️ ${dup.motivo}</div>` : ''}

              ${parc ? `<div style="background:rgba(59,130,246,0.1);border-radius:6px;padding:6px 10px;font-size:0.78rem;color:#3b82f6;margin-bottom:6px;">
                📦 Parcela ${parc.atual} de ${parc.total} — Serão criadas <b>${parc.total}</b> parcelas (retroativas: ${parc.retroativas}, futuras: ${parc.futuras}) | Compra original: ${parc.dataBase}
              </div>` : ''}

              <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:4px;">
                ${cartoes.length > 0 ? `
                <div style="display:flex;align-items:center;gap:6px;">
                  <label style="color:#aaa;font-size:0.75rem;">Cartão:</label>
                  <select id="imp-cartao-${idx}"
                    onchange="VM._impCartaoLinhaChange(${idx}, this.value)"
                    style="background:rgba(0,0,0,0.4);border:1px solid rgba(255,255,255,0.1);color:#e0e0e0;padding:4px 8px;border-radius:6px;font-size:0.75rem;">
                    <option value="">Usar lote</option>
                    ${cartaoOptions}
                  </select>
                </div>` : ''}
                <div style="display:flex;align-items:center;gap:6px;">
                  <label style="color:#aaa;font-size:0.75rem;">Status:</label>
                  <select id="imp-status-${idx}"
                    style="background:rgba(0,0,0,0.4);border:1px solid rgba(255,255,255,0.1);color:#e0e0e0;padding:4px 8px;border-radius:6px;font-size:0.75rem;">
                    <option value="pago" ${status==='pago'?'selected':''}>✅ pago</option>
                    <option value="pendente" ${status==='pendente'?'selected':''}>⏳ pendente</option>
                    <option value="cancelado">❌ cancelado</option>
                  </select>
                </div>
                <div style="display:flex;align-items:center;gap:6px;">
                  <label style="color:#aaa;font-size:0.75rem;">Tag:</label>
                  <select id="imp-tag-${idx}" style="background:rgba(0,0,0,0.4);border:1px solid rgba(255,255,255,0.1);color:#e0e0e0;padding:4px 8px;border-radius:6px;font-size:0.75rem;">
                    <option value="">Auto (${tagSug ? tagSug.nome : 'por categoria'})</option>
                    <option value="nenhuma">Sem tag</option>
                    ${tagOptions}
                  </select>
                </div>
              </div>
            </div>
          </div>
        </div>
      `
    }).join('')

    this._impDecisoes = preview.map(item => {
      if (item.duplicata?.nivel === 'provavel') return false
      if (item.duplicata?.nivel === 'possivel') return false
      return true
    })
  },

  _impCartaoLinhaChange(idx, cartaoId) {
    const loteId = document.getElementById('imp-cartao-lote')?.value || ''
    const temCartao = cartaoId || loteId
    const meioEl = document.getElementById('imp-meio-label-' + idx)
    if (meioEl) meioEl.textContent = temCartao ? '💳 crédito (cartão)' : (this._impData?.preview?.[idx]?.meio_pagamento || 'dinheiro')
    const statusSel = document.getElementById('imp-status-' + idx)
    if (statusSel) statusSel.value = temCartao ? 'pendente' : (this._impData?.preview?.[idx]?.status_sugerido || 'pago')
  },

  _impCartaoLoteChange(loteId) {
    const preview = this._impData?.preview || []
    preview.forEach((item, idx) => {
      // Só atualiza linhas que não têm override próprio
      const linhaCartao = document.getElementById('imp-cartao-' + idx)
      const temOverride = linhaCartao && linhaCartao.value
      if (!temOverride) {
        const meioEl = document.getElementById('imp-meio-label-' + idx)
        if (meioEl) meioEl.textContent = loteId ? '💳 crédito (cartão)' : (item.meio_pagamento || 'dinheiro')
        const statusSel = document.getElementById('imp-status-' + idx)
        if (statusSel) statusSel.value = loteId ? 'pendente' : (item.status_sugerido || 'pago')
      }
    })
  },

  _impToggleDecisao(idx, checked) {
    if (!this._impDecisoes) this._impDecisoes = []
    this._impDecisoes[idx] = checked
    const label = document.getElementById(`imp-chk-label-${idx}`)
    if (label) {
      label.textContent = checked ? 'Importar' : 'Ignorar'
      label.style.color = checked ? '#2FBF71' : '#ef4444'
    }
    const container = document.getElementById(`imp-linha-${idx}`)
    if (container) {
      container.style.opacity = checked ? '1' : '0.5'
    }
  },

  _impDecidirTodos(importar) {
    const preview = this._impData?.preview || []
    preview.forEach((_, idx) => {
      this._impDecisoes[idx] = importar
      const chk = document.getElementById(`imp-chk-${idx}`)
      if (chk) chk.checked = importar
      this._impToggleDecisao(idx, importar)
    })
  },

  _impVoltar() {
    document.getElementById('imp-step1').style.display = 'block'
    document.getElementById('imp-step2').style.display = 'none'
    document.getElementById('imp-step3').style.display = 'none'
  },

  async _impExecutar() {
    const btn = document.getElementById('imp-btn-executar')
    btn.disabled = true
    btn.innerHTML = '<i class="fas fa-spinner fa-spin" style="margin-right:6px;"></i>Importando...'

    try {
      const { csv, tipo, mapeamento, preview } = this._impData
      const cartaoLote = document.getElementById('imp-cartao-lote')?.value || ''

      // Montar config por linha
      const linhas_config = preview.map((item, idx) => {
        const importar = this._impDecisoes ? this._impDecisoes[idx] : true
        const cartaoOverride = document.getElementById(`imp-cartao-${idx}`)?.value || ''
        const tagRaw = document.getElementById(`imp-tag-${idx}`)?.value || ''
        const statusOverride = document.getElementById(`imp-status-${idx}`)?.value || ''
        // tagRaw: '' = auto por categoria, 'nenhuma' = sem tag, '123' = id da tag
        const tagId = (tagRaw && tagRaw !== 'nenhuma') ? parseInt(tagRaw) : null
        const semTag = tagRaw === 'nenhuma'
        return {
          linha: item.linha,
          importar,
          cartao_id_override: cartaoOverride ? parseInt(cartaoOverride) : null,
          tag_id: tagId,
          sem_tag: semTag,
          status: statusOverride || null,
        }
      })

      const resp = await this.api('POST', 'importacao/executar', {
        csv, tipo, mapeamento,
        cartao_id: cartaoLote ? parseInt(cartaoLote) : null,
        linhas_config,
      })

      document.getElementById('imp-step2').style.display = 'none'
      document.getElementById('imp-step3').style.display = 'block'

      const temErros = (resp.ignorados || 0) > 0
      const temParcelas = (resp.parcelas_criadas || 0) > 0

      document.getElementById('imp-step3').innerHTML = `
        <div style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:14px;padding:28px;text-align:center;">
          <div style="font-size:3rem;margin-bottom:12px;">${temErros ? '⚠️' : '🎉'}</div>
          <h3 style="color:#fff;font-size:1.2rem;font-weight:700;margin-bottom:8px;">Importação Concluída</h3>
          <p style="color:#2FBF71;font-size:1rem;margin-bottom:6px;">
            <b>${resp.importados || 0}</b> ${tipo} importadas com sucesso
          </p>
          ${temParcelas ? `<p style="color:#3b82f6;font-size:0.88rem;margin-bottom:6px;">📦 <b>${resp.parcelas_criadas}</b> parcelas geradas no histórico</p>` : ''}
          ${(resp.tags_criadas||0) > 0 ? `<p style="color:#8b5cf6;font-size:0.88rem;margin-bottom:6px;">🏷✨ <b>${resp.tags_criadas}</b> tag(s) criada(s) automaticamente</p>` : ''}
          ${resp.ignorados > 0 ? `<p style="color:#f59e0b;font-size:0.88rem;margin-bottom:6px;">⚠️ <b>${resp.ignorados}</b> linha(s) ignoradas</p>` : ''}
          ${resp.erros_detalhes?.length > 0 ? `
            <div style="background:rgba(239,68,68,0.08);border:1px solid rgba(239,68,68,0.2);border-radius:8px;padding:12px;margin:12px 0;text-align:left;">
              <p style="color:#ef4444;font-size:0.82rem;font-weight:600;margin-bottom:6px;">Erros:</p>
              ${resp.erros_detalhes.map(e => `<p style="color:#ef4444;font-size:0.78rem;margin:2px 0;">${e}</p>`).join('')}
            </div>` : ''}
          <div style="display:flex;gap:10px;justify-content:center;margin-top:20px;flex-wrap:wrap;">
            <button onclick="VM.navigate(VM._impData?.tipo === 'receitas' ? 'receitas' : 'despesas')" style="padding:10px 22px;background:linear-gradient(135deg,#2FBF71,#059669);border:none;border-radius:10px;color:#fff;font-weight:600;cursor:pointer;">
              <i class="fas fa-list" style="margin-right:6px;"></i>Ver ${tipo === 'receitas' ? 'Receitas' : 'Despesas'}
            </button>
            <button onclick="VM.pageImportacao()" style="padding:10px 22px;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.1);border-radius:10px;color:#ccc;cursor:pointer;">
              <i class="fas fa-redo" style="margin-right:6px;"></i>Nova Importação
            </button>
          </div>
        </div>
      `
    } catch(e) {
      btn.disabled = false
      btn.innerHTML = '<i class="fas fa-check-circle" style="margin-right:6px;"></i>Confirmar e Importar'
      this.toast('Erro na importação: ' + (e.message || e), 'error')
    }
  },


  markdownToHtml(text) {
    if (!text) return ''
    return text
      // Headers
      .replace(/^### (.+)$/gm, '<strong style="font-size:0.95rem;color:#2FBF71;">$1</strong>')
      .replace(/^## (.+)$/gm, '<strong style="font-size:1rem;color:#2FBF71;">$1</strong>')
      // Bold
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      // Itálico
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      // Listas com bullet •
      .replace(/^[•\-\*] (.+)$/gm, '<span style="display:block;padding-left:8px;">• $1</span>')
      // Listas numeradas
      .replace(/^\d+\. (.+)$/gm, (m, p1, offset, str) => {
        const num = m.match(/^(\d+)/)?.[1] || '1'
        return `<span style="display:block;padding-left:8px;">${num}. ${p1}</span>`
      })
      // Quebras de linha
      .replace(/\n\n/g, '<br><br>')
      .replace(/\n/g, '<br>')
  },

  escapeHtml(text) {
    const div = document.createElement('div')
    div.appendChild(document.createTextNode(text))
    return div.innerHTML
  },

  async assistenteEnviar() {
    const input = document.getElementById('chat-input')
    if (!input) return
    const mensagem = input.value.trim()
    if (!mensagem) return
    await this.assistenteSend(mensagem)
    input.value = ''
    input.style.height = 'auto'
  },

  async assistenteSend(mensagem) {
    const chatMsgs = document.getElementById('chat-messages')
    if (!chatMsgs) return

    // Adicionar mensagem do usuário imediatamente
    const msgUser = document.createElement('div')
    msgUser.style.cssText = 'display:flex;flex-direction:column;gap:12px;margin-bottom:4px;'
    msgUser.innerHTML = `
      <div style="display:flex;justify-content:flex-end;">
        <div style="max-width:75%;background:linear-gradient(135deg,#10B981,#059669);color:#fff;padding:10px 14px;border-radius:18px 18px 4px 18px;font-size:0.87rem;line-height:1.5;">
          ${this.escapeHtml(mensagem)}
        </div>
      </div>
    `
    chatMsgs.appendChild(msgUser)
    
    // Indicador de digitação
    const typing = document.createElement('div')
    typing.id = 'typing-indicator'
    typing.style.cssText = 'display:flex;justify-content:flex-start;gap:8px;margin-bottom:4px;'
    typing.innerHTML = `
      <div style="width:32px;height:32px;background:#1a2a1a;border:1px solid #2FBF71;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:1rem;flex-shrink:0;">🤖</div>
      <div style="background:#1a2a1a;border:1px solid #2a3a2a;padding:12px 16px;border-radius:4px 18px 18px 18px;">
        <span style="display:inline-flex;gap:4px;">
          <span style="width:6px;height:6px;background:#2FBF71;border-radius:50%;animation:bounce 1.2s infinite;"></span>
          <span style="width:6px;height:6px;background:#2FBF71;border-radius:50%;animation:bounce 1.2s infinite 0.2s;"></span>
          <span style="width:6px;height:6px;background:#2FBF71;border-radius:50%;animation:bounce 1.2s infinite 0.4s;"></span>
        </span>
      </div>
    `
    chatMsgs.appendChild(typing)
    chatMsgs.scrollTop = chatMsgs.scrollHeight

    try {
      const resp = await this.api('POST', 'assistente/chat', { mensagem })
      
      // Remover indicador
      document.getElementById('typing-indicator')?.remove()
      
      // Adicionar resposta da IA
      const msgIA = document.createElement('div')
      msgIA.style.cssText = 'display:flex;flex-direction:column;gap:12px;margin-bottom:4px;'
      msgIA.innerHTML = `
        <div style="display:flex;justify-content:flex-start;gap:8px;">
          <div style="width:32px;height:32px;background:#1a2a1a;border:1px solid #2FBF71;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:1rem;flex-shrink:0;">🤖</div>
          <div style="max-width:80%;background:#1a2a1a;border:1px solid #2a3a2a;padding:12px 14px;border-radius:4px 18px 18px 18px;font-size:0.87rem;line-height:1.6;white-space:pre-line;">
            ${this.markdownToHtml(resp.resposta)}
          </div>
        </div>
      `
      chatMsgs.appendChild(msgIA)
      
      // Atualizar sugestões
      if (resp.sugestoes && resp.sugestoes.length > 0) {
        const sug = document.getElementById('chat-sugestoes')
        if (sug) {
          sug.innerHTML = resp.sugestoes.slice(0, 4).map(s => 
            `<button onclick="VM.assistenteSend('${s.replace(/'/g, "\\'")}')" style="background:#1a2a1a;border:1px solid #2a3a2a;color:#888;padding:4px 12px;border-radius:16px;font-size:0.77rem;cursor:pointer;" onmouseover="this.style.borderColor='#2FBF71';this.style.color='#2FBF71'" onmouseout="this.style.borderColor='#2a3a2a';this.style.color='#888'">${s}</button>`
          ).join('')
        }
      }
    } catch(err) {
      document.getElementById('typing-indicator')?.remove()
      const errMsg = document.createElement('div')
      errMsg.style.cssText = 'display:flex;justify-content:flex-start;gap:8px;margin-bottom:4px;'
      errMsg.innerHTML = `
        <div style="background:#2a1a1a;border:1px solid #ff6b6b33;padding:10px 14px;border-radius:4px 18px 18px 18px;font-size:0.85rem;color:#ff9999;">
          ⚠️ Erro: ${err.message || 'Tente novamente.'}
        </div>
      `
      chatMsgs.appendChild(errMsg)
    }
    
    chatMsgs.scrollTop = chatMsgs.scrollHeight
  },

  async assistenteLimpar() {
    const ok = await this.vmConfirm('Deseja limpar todo o histórico de conversa com o assistente?', { titulo: 'Limpar Histórico', corBotao: '#ef4444', textoBotao: 'Limpar', icone: '🗑️' })
    if (!ok) return
    try {
      await this.api('DELETE', 'assistente/historico')
      this.toast('Histórico limpo!', 'success')
      this.pageAssistente()
    } catch(err) {
      this.toast(err.message, 'error')
    }
  },

  showModal(html) {
    const container = document.getElementById('modal-container')
    if (!container) return
    container.innerHTML = `
      <div class="modal-overlay" onclick="VM.closeModal(event)">
        <div class="modal-card" style="max-width:440px;">
          <div style="display:flex;justify-content:flex-end;margin-bottom:4px;">
            <button onclick="VM.closeModal()" style="background:none;border:none;color:#666;font-size:1.2rem;cursor:pointer;">✕</button>
          </div>
          ${html}
        </div>
      </div>
    `
    this._fixModalScroll()
  },

  _fixModalScroll() {
    requestAnimationFrame(() => {
      const container = document.getElementById('modal-container')
      if (!container) return
      const modal = container.querySelector('.modal-card, .modal')
      if (modal) modal.scrollTop = 0
      if (window.innerWidth <= 768) document.body.style.overflow = 'hidden'
    })
  }
}

// Init
document.addEventListener('DOMContentLoaded', () => VM.init())
