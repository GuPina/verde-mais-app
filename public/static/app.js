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
    if (typeof v === 'number') return v > 0
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

  api(method, endpoint, data) {
    return axios({
      method,
      url: `/api/${endpoint}`,
      data,
      headers: this.token ? { Authorization: `Bearer ${this.token}` } : {}
    }).then(r => r.data).catch(e => {
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

  toast(msg, type = 'success') {
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
    setTimeout(() => t.remove(), 4000)
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
      <div class="auth-page">
        <div class="auth-card">
          <div class="auth-logo">
            <div class="logo-icon">💚</div>
            <div style="font-size:1.6rem;font-weight:800;" class="gradient-text">VerdeMais</div>
            <div style="color:#666;font-size:0.85rem;margin-top:4px;">Organize hoje. Conquiste amanhã.</div>
          </div>
          
          <h2 style="font-size:1.3rem;font-weight:700;margin-bottom:24px;text-align:center;">Entrar na sua conta</h2>
          
          <div id="auth-error" style="display:none;background:rgba(255,80,80,0.1);border:1px solid rgba(255,80,80,0.3);border-radius:10px;padding:12px 16px;margin-bottom:16px;color:#ff6b6b;font-size:0.88rem;"></div>
          
          <form id="login-form">
            <div class="form-group">
              <label class="form-label">Email</label>
              <input type="email" id="login-email" class="form-input" placeholder="seu@email.com" required>
            </div>
            <div class="form-group">
              <label class="form-label">Senha</label>
              <input type="password" id="login-senha" class="form-input" placeholder="••••••••" required>
            </div>
            <button type="submit" class="btn-primary" id="login-btn">
              <i class="fas fa-sign-in-alt"></i> Entrar
            </button>
          </form>
          
          <div style="text-align:center;margin-top:24px;color:#666;font-size:0.88rem;">
            Não tem conta? <a href="/cadastro" style="color:#2FBF71;text-decoration:none;font-weight:600;">Criar gratuitamente</a>
          </div>
          <div style="text-align:center;margin-top:16px;">
            <a href="/" style="color:#555;text-decoration:none;font-size:0.82rem;">← Voltar ao site</a>
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
      errEl.style.display = 'none'

      try {
        const res = await axios.post('/api/auth/login', {
          email: document.getElementById('login-email').value,
          senha: document.getElementById('login-senha').value
        })
        localStorage.setItem('vm_token', res.data.token)
        localStorage.setItem('vm_user', JSON.stringify(res.data.user))
        window.location.href = '/app'
      } catch (e) {
        errEl.textContent = e.response?.data?.error || 'Erro ao fazer login'
        errEl.style.display = 'block'
        btn.disabled = false
        btn.innerHTML = '<i class="fas fa-sign-in-alt"></i> Entrar'
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
          
          <nav style="overflow-y:auto;flex:1;padding-bottom:8px;">
            <div style="font-size:0.68rem;color:#444;letter-spacing:1.5px;text-transform:uppercase;padding:0 14px 8px;font-weight:600;">Principal</div>
            <a class="nav-item active" id="nav-dashboard" onclick="VM.navigate('dashboard')">
              <span class="nav-icon"><i class="fas fa-chart-pie"></i></span> Dashboard
            </a>
            <a class="nav-item" id="nav-receitas" onclick="VM.navigate('receitas')">
              <span class="nav-icon"><i class="fas fa-arrow-up"></i></span> Receitas
            </a>
            <a class="nav-item" id="nav-despesas" onclick="VM.navigate('despesas')">
              <span class="nav-icon"><i class="fas fa-arrow-down"></i></span> Despesas
            </a>
            <a class="nav-item" id="nav-cartoes" onclick="VM.navigate('cartoes')">
              <span class="nav-icon"><i class="fas fa-credit-card"></i></span> Cartões
            </a>
            
            <div style="font-size:0.68rem;color:#444;letter-spacing:1.5px;text-transform:uppercase;padding:12px 14px 8px;font-weight:600;">Planejamento</div>
            <a class="nav-item" id="nav-metas" onclick="VM.navigate('metas')">
              <span class="nav-icon"><i class="fas fa-bullseye"></i></span> Metas
            </a>
            <a class="nav-item" id="nav-orcamentos" onclick="VM.navigate('orcamentos')">
              <span class="nav-icon"><i class="fas fa-sliders-h"></i></span> Orçamentos
              <span style="margin-left:auto;background:linear-gradient(135deg,#10B981,#059669);color:#fff;font-size:0.6rem;padding:1px 6px;border-radius:4px;font-weight:700;">NOVO</span>
            </a>
            <a class="nav-item" id="nav-recorrencias" onclick="VM.navigate('recorrencias')">
              <span class="nav-icon"><i class="fas fa-sync-alt"></i></span> Recorrências
              <span style="margin-left:auto;background:linear-gradient(135deg,#3B82F6,#2563EB);color:#fff;font-size:0.6rem;padding:1px 6px;border-radius:4px;font-weight:700;">NOVO</span>
            </a>
            <a class="nav-item" id="nav-lembretes" onclick="VM.navigate('lembretes')">
              <span class="nav-icon"><i class="fas fa-bell"></i></span> Lembretes
              <span id="badge-lembretes" style="display:none;margin-left:auto;background:#ffc400;color:#000;font-size:0.65rem;padding:2px 7px;border-radius:50px;font-weight:700;"></span>
            </a>
            
            <div style="font-size:0.68rem;color:#444;letter-spacing:1.5px;text-transform:uppercase;padding:12px 14px 8px;font-weight:600;">Patrimônio & Dívidas</div>
            <a class="nav-item" id="nav-investimentos" onclick="VM.navigate('investimentos')">
              <span class="nav-icon"><i class="fas fa-chart-line"></i></span> Investimentos
            </a>
            <a class="nav-item" id="nav-reserva" onclick="VM.navigate('reserva')">
              <span class="nav-icon"><i class="fas fa-shield-alt"></i></span> Reserva de Emergência
            </a>
            <a class="nav-item" id="nav-financiamentos" onclick="VM.navigate('financiamentos')">
              <span class="nav-icon"><i class="fas fa-home"></i></span> Financiamentos
            </a>
            <a class="nav-item" id="nav-emprestimos" onclick="VM.navigate('emprestimos')">
              <span class="nav-icon"><i class="fas fa-hand-holding-usd"></i></span> Empréstimos
            </a>
            
            <div style="font-size:0.68rem;color:#444;letter-spacing:1.5px;text-transform:uppercase;padding:12px 14px 8px;font-weight:600;">Análises</div>
            <a class="nav-item" id="nav-projecao" onclick="VM.navigate('projecao')">
              <span class="nav-icon"><i class="fas fa-chart-area"></i></span> Projeção Financeira
              <span style="margin-left:auto;background:linear-gradient(135deg,#8B5CF6,#7C3AED);color:#fff;font-size:0.6rem;padding:1px 6px;border-radius:4px;font-weight:700;">NOVO</span>
            </a>
            <a class="nav-item" id="nav-comparativo" onclick="VM.navigate('comparativo')">
              <span class="nav-icon"><i class="fas fa-exchange-alt"></i></span> Comparativo Mensal
            </a>
            <a class="nav-item" id="nav-relatorios" onclick="VM.navigate('relatorios')">
              <span class="nav-icon"><i class="fas fa-file-alt"></i></span> Relatórios
            </a>
            <a class="nav-item" id="nav-simulacao" onclick="VM.navigate('simulacao')">
              <span class="nav-icon"><i class="fas fa-calculator"></i></span> Simulações
            </a>
            <a class="nav-item" id="nav-ia" onclick="VM.navigate('ia')">
              <span class="nav-icon"><i class="fas fa-brain"></i></span> Diagnóstico 360° ✨
            </a>
            <a class="nav-item" id="nav-tags" onclick="VM.navigate('tags')">
              <span class="nav-icon"><i class="fas fa-tags"></i></span> Tags & Filtros
            </a>
            <a class="nav-item" id="nav-alertas-cartao" onclick="VM.navigate('alertas-cartao')">
              <span class="nav-icon"><i class="fas fa-exclamation-triangle"></i></span> Alertas de Cartão
              <span id="badge-alertas-cartao" style="display:none;margin-left:auto;background:#F43F5E;color:#fff;font-size:0.65rem;padding:2px 7px;border-radius:50px;font-weight:700;"></span>
            </a>
            <a class="nav-item" id="nav-conquistas" onclick="VM.navigate('conquistas')">
              <span class="nav-icon"><i class="fas fa-trophy"></i></span> Conquistas
              <span id="badge-conquistas" style="display:none;margin-left:auto;background:#2FBF71;color:#000;font-size:0.65rem;padding:2px 7px;border-radius:50px;font-weight:700;"></span>
            </a>
            
            <div style="font-size:0.68rem;color:#444;letter-spacing:1.5px;text-transform:uppercase;padding:12px 14px 8px;font-weight:600;">⚡ Novidades v3.0</div>
            <a class="nav-item" id="nav-reservas-esp" onclick="VM.navigate('reservas-esp')">
              <span class="nav-icon">🛡️</span> Minhas Reservas
              <span style="margin-left:auto;background:linear-gradient(135deg,#10B981,#059669);color:#fff;font-size:0.6rem;padding:1px 6px;border-radius:4px;font-weight:700;">NEW</span>
            </a>
            <a class="nav-item" id="nav-assinaturas-fantasma" onclick="VM.navigate('assinaturas-fantasma')">
              <span class="nav-icon">👻</span> Assinaturas Fantasma
              <span style="margin-left:auto;background:linear-gradient(135deg,#8B5CF6,#7C3AED);color:#fff;font-size:0.6rem;padding:1px 6px;border-radius:4px;font-weight:700;">NEW</span>
            </a>
            <a class="nav-item" id="nav-regra-503020" onclick="VM.navigate('regra-503020')">
              <span class="nav-icon">⚖️</span> Regra 50/30/20
              <span style="margin-left:auto;background:linear-gradient(135deg,#3B82F6,#2563EB);color:#fff;font-size:0.6rem;padding:1px 6px;border-radius:4px;font-weight:700;">NEW</span>
            </a>
            <a class="nav-item" id="nav-amortizacao" onclick="VM.navigate('amortizacao')">
              <span class="nav-icon">🏦</span> Simulador Amortização
              <span style="margin-left:auto;background:linear-gradient(135deg,#F59E0B,#D97706);color:#fff;font-size:0.6rem;padding:1px 6px;border-radius:4px;font-weight:700;">NEW</span>
            </a>
            <a class="nav-item" id="nav-desafio-52" onclick="VM.navigate('desafio-52')">
              <span class="nav-icon">🎯</span> Desafio 52 Semanas
              <span style="margin-left:auto;background:linear-gradient(135deg,#EC4899,#DB2777);color:#fff;font-size:0.6rem;padding:1px 6px;border-radius:4px;font-weight:700;">NEW</span>
            </a>
            <a class="nav-item" id="nav-assistente" onclick="VM.navigate('assistente')">
              <span class="nav-icon">🤖</span> Assistente IA
              <span style="margin-left:auto;background:linear-gradient(135deg,#06B6D4,#0891B2);color:#fff;font-size:0.6rem;padding:1px 6px;border-radius:4px;font-weight:700;">NEW</span>
            </a>
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
        <button class="bottom-nav-item" id="bnav-receitas" onclick="VM.navigate('receitas')">
          <i class="fas fa-plus-circle"></i>
          <span>Receitas</span>
        </button>
        <button class="bottom-nav-item" id="bnav-metas" onclick="VM.navigate('metas')">
          <i class="fas fa-bullseye"></i>
          <span>Metas</span>
        </button>
        <button class="bottom-nav-item" id="bnav-assistente" onclick="VM.navigate('assistente')">
          <i class="fas fa-robot"></i>
          <span>IA</span>
        </button>
      </nav>

      <div id="toast-container" class="toast-container"></div>
      <div id="modal-container"></div>

      <!-- BLOCO 6.5: Widget de Chat Flutuante -->
      <div id="chat-widget" style="display:none;position:fixed;bottom:90px;right:20px;z-index:1000;width:340px;max-height:480px;background:var(--bg-card,#fff);border-radius:16px;box-shadow:0 8px 32px rgba(0,0,0,0.18);display:flex;flex-direction:column;overflow:hidden;">
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
        <div id="chat-messages" style="flex:1;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:8px;max-height:300px;min-height:200px;background:var(--bg-main,#f8fafc);">
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
          <input id="chat-input" type="text" placeholder="Digite sua pergunta..." maxlength="500"
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
        const input = document.getElementById('chat-input')
        if (input) input.focus()
      }, 200)
    }
  },

  async chatCarregarHistorico() {
    try {
      const data = await this.api('GET', 'chat/historico')
      const msgs = data.historico || []
      if (msgs.length === 0) return
      const container = document.getElementById('chat-messages')
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
    const container = document.getElementById('chat-messages')
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
    const container = document.getElementById('chat-messages')
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
    const input = document.getElementById('chat-input')
    if (!input) return
    const msg = input.value?.trim()
    if (!msg) return
    input.value = ''
    this.chatEnviar(msg)
  },

  async carregarBadges() {
    try {
      const [lembretes, conquistas] = await Promise.all([
        this.api('GET', 'lembretes').catch(() => ({ urgentes: 0 })),
        this.api('GET', 'conquistas/novas').catch(() => ({ novas: [] }))
      ])
      const badgeLemb = document.getElementById('badge-lembretes')
      const badgeConq = document.getElementById('badge-conquistas')
      if (badgeLemb && lembretes.urgentes > 0) { badgeLemb.textContent = lembretes.urgentes; badgeLemb.style.display = 'inline'; }
      if (badgeConq && conquistas.novas?.length > 0) { badgeConq.textContent = conquistas.novas.length; badgeConq.style.display = 'inline'; }
      
      // Mostrar alerta chamativo de conquista nova
      if (conquistas.novas?.length > 0) {
        this.mostrarAlertaConquista(conquistas.novas)
      }
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
        <button onclick="VM.fecharAlertaConquista()" style="
          background:#2FBF71;color:#000;border:none;padding:12px 32px;
          border-radius:50px;font-weight:700;font-size:1rem;cursor:pointer;
          width:100%;transition:all 0.2s;
        " onmouseover="this.style.background='#26a060'" onmouseout="this.style.background='#2FBF71'">
          🎊 Incrível! Ver todas as conquistas
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
  },

  fecharAlertaConquista() {
    const overlay = document.getElementById('conquista-overlay')
    if (overlay) overlay.remove()
    const badgeConq = document.getElementById('badge-conquistas')
    if (badgeConq) { badgeConq.style.display = 'none'; badgeConq.textContent = ''; }
    this.navigate('conquistas')
  },

  navigate(page) {
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
      'regra-503020': ['⚖️ Regra 50/30/20', 'Equilíbrio das suas finanças pessoais'],
      'desafio-52': ['🎯 Desafio 52 Semanas', 'Poupe R$ 1.378 ao longo do ano'],
      'amortizacao': ['🏦 Simulador de Amortização', 'Compare cenários e economize em juros'],
      'assistente': ['🤖 Assistente VerdeMais', 'Tire dúvidas sobre suas finanças com IA']
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
      'regra-503020': () => this.pageRegra503020(),
      'desafio-52': () => this.pageDesafio52(),
      'amortizacao': () => this.pageAmortizacao(),
      'assistente': () => this.pageAssistente()
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
      const desafio52Guardado = desafio_52?.valor_guardado || 0
      const assinaturasTem = alerta_assinaturas?.tem_alerta || false
      const assinaturasGasto = alerta_assinaturas?.custo_mensal_estimado || 0

      content.innerHTML = `
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
            <div class="stat-value" style="color:${assinaturasTem ? '#A78BFA' : '#666'};font-size:1.2rem;">${alerta_assinaturas?.total_detectadas || 0}</div>
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
              <span style="color:#666;">R$ ${desafio52Guardado} guardados</span>
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
                <div style="font-size:0.75rem;color:#2FBF71;font-weight:600;">Plano Premium</div>
                <div style="font-size:0.7rem;color:#888;margin-top:4px;">Clique para desbloquear</div>
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

  async carregarReceitas() {
    const mes = document.getElementById('filtro-mes')?.value || String(new Date().getMonth() + 1)
    const ano = document.getElementById('filtro-ano')?.value || String(new Date().getFullYear())
    
    try {
      const data = await this.api('GET', `receitas?mes=${mes}&ano=${ano}`)
      
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
              <div style="font-size:1.6rem;font-weight:800;">${data.count}</div>
            </div>
          </div>
        `
      }

      const wrapper = document.getElementById('receitas-table-wrapper')
      if (data.receitas.length === 0) {
        wrapper.innerHTML = `<div class="empty-state"><div class="empty-icon">💸</div><h3>Nenhuma receita</h3><p>Adicione sua primeira receita do período</p></div>`
        return
      }

      const cats = {
        'Salário': '💼', 'Freelance': '💻', 'Investimentos': '📈', 'Aluguel': '🏠', 
        'Vendas': '🛒', 'Bônus': '🎁', 'Outros': '💰'
      }

      wrapper.innerHTML = `
        <table class="data-table">
          <thead>
            <tr>
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
              <tr>
                <td style="font-weight:500;">${r.descricao}</td>
                <td><span class="badge badge-green">${cats[r.categoria] || '💰'} ${r.categoria}</span></td>
                <td style="color:#888;">${this.formatDate(r.data)}</td>
                <td>${r.recorrente ? '<span class="badge badge-blue">🔄 Recorrente</span>' : '<span style="color:#555;">-</span>'}</td>
                <td style="text-align:right;font-weight:700;color:#2FBF71;">${this.formatMoney(r.valor)}</td>
                <td style="text-align:right;">
                  <button onclick="VM.modalReceita(${JSON.stringify(r).replace(/"/g, '&quot;')})" class="btn-success" style="margin-right:4px;"><i class="fas fa-edit"></i></button>
                  <button onclick="VM.deleteReceita(${r.id})" class="btn-danger"><i class="fas fa-trash"></i></button>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `
    } catch (e) {
      this.toast('Erro ao carregar receitas', 'error')
    }
  },

  modalReceita(receita = null) {
    const isEdit = !!receita
    const today = new Date().toISOString().split('T')[0]
    const categorias = ['Salário', 'Freelance', 'Investimentos', 'Aluguel', 'Vendas', 'Bônus', 'Outros']

    document.getElementById('modal-container').innerHTML = `
      <div class="modal-overlay" onclick="VM.closeModal(event)">
        <div class="modal">
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
                <select id="r-cat" class="form-select">
                  ${categorias.map(c => `<option value="${c}" ${receita?.categoria === c ? 'selected' : ''}>${c}</option>`).join('')}
                </select>
              </div>
              <div class="form-group">
                <label class="form-label">Data *</label>
                <input type="date" id="r-data" class="form-input" value="${receita?.data || today}" required>
              </div>
            </div>
            <div class="form-group">
              <label class="form-label">Valor (R$) *</label>
              <input type="number" id="r-valor" class="form-input" placeholder="0,00" step="0.01" min="0" value="${receita?.valor || ''}" required>
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
              <button type="button" onclick="VM.closeModal()" class="btn-secondary" style="flex:1;justify-content:center;">Cancelar</button>
              <button type="submit" class="btn-primary" style="flex:1;" id="r-submit">
                <i class="fas fa-save"></i> ${isEdit ? 'Salvar' : 'Adicionar'}
              </button>
            </div>
          </form>
        </div>
      </div>
    `

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
          recorrente: document.getElementById('r-recorrente').checked,
          observacoes: document.getElementById('r-obs').value
        }
        if (isEdit) await this.api('PUT', `receitas/${receita.id}`, payload)
        else await this.api('POST', 'receitas', payload)
        this.toast(isEdit ? 'Receita atualizada!' : 'Receita adicionada! 💰')
        this.closeModal()
        this.carregarReceitas()
      } catch (err) {
        this.toast(err.response?.data?.error || 'Erro ao salvar', 'error')
        btn.disabled = false
        btn.innerHTML = `<i class="fas fa-save"></i> ${isEdit ? 'Salvar' : 'Adicionar'}`
      }
    })
  },

  async deleteReceita(id) {
    if (!confirm('Excluir esta receita?')) return
    try {
      await this.api('DELETE', `receitas/${id}`)
      this.toast('Receita excluída!')
      this.carregarReceitas()
    } catch (e) {
      this.toast('Erro ao excluir', 'error')
    }
  },

  // ============== DESPESAS ==============
  async pageDespesas() {
    const now = new Date()
    const mes = String(now.getMonth() + 1)
    const ano = String(now.getFullYear())

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
          <option value="">Todos os status</option>
          <option value="pendente">Pendente</option>
          <option value="pago">Pago</option>
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

  async carregarDespesas() {
    const mes = document.getElementById('filtro-mes-d')?.value || String(new Date().getMonth() + 1)
    const ano = document.getElementById('filtro-ano-d')?.value || String(new Date().getFullYear())
    const status = document.getElementById('filtro-status-d')?.value || ''
    
    try {
      const data = await this.api('GET', `despesas?mes=${mes}&ano=${ano}${status ? '&status=' + status : ''}`)
      const pago = data.despesas.filter(d => d.status === 'pago').reduce((s, d) => s + d.valor, 0)
      const pendente = data.despesas.filter(d => d.status === 'pendente').reduce((s, d) => s + d.valor, 0)

      const statsEl = document.getElementById('despesas-stats')
      if (statsEl) {
        statsEl.innerHTML = `
          <div style="display:flex;gap:32px;align-items:center;flex-wrap:wrap;">
            <div><div style="color:#888;font-size:0.8rem;">Total</div><div style="font-size:1.4rem;font-weight:800;color:#ff6b6b;">${this.formatMoney(data.total)}</div></div>
            <div><div style="color:#888;font-size:0.8rem;">Pago</div><div style="font-size:1.4rem;font-weight:800;color:#2FBF71;">${this.formatMoney(pago)}</div></div>
            <div><div style="color:#888;font-size:0.8rem;">Pendente</div><div style="font-size:1.4rem;font-weight:800;color:#ffc400;">${this.formatMoney(pendente)}</div></div>
            <div><div style="color:#888;font-size:0.8rem;">Qtd</div><div style="font-size:1.4rem;font-weight:800;">${data.count}</div></div>
          </div>
        `
      }

      const wrapper = document.getElementById('despesas-table-wrapper')
      if (data.despesas.length === 0) {
        wrapper.innerHTML = `<div class="empty-state"><div class="empty-icon">🎉</div><h3>Sem despesas</h3><p>Período limpo!</p></div>`
        return
      }

      const catIcons = { 'Alimentação': '🍔', 'Transporte': '🚗', 'Saúde': '💊', 'Educação': '📚', 'Lazer': '🎬', 'Moradia': '🏠', 'Roupas': '👕', 'Outros': '📦' }

      wrapper.innerHTML = `
        <table class="data-table">
          <thead>
            <tr>
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
            ${data.despesas.map(d => `
              <tr>
                <td style="font-weight:500;">${d.descricao}</td>
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
                <td style="text-align:right;">
                  <button onclick="VM.modalDespesa(${JSON.stringify(d).replace(/"/g, '&quot;')})" class="btn-success" style="margin-right:4px;"><i class="fas fa-edit"></i></button>
                  <button onclick="VM.deleteDespesa(${d.id})" class="btn-danger"><i class="fas fa-trash"></i></button>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `
    } catch (e) {
      this.toast('Erro ao carregar despesas', 'error')
    }
  },

  async toggleDespesaStatus(id, status) {
    const novoStatus = status === 'pago' ? 'pendente' : 'pago'
    try {
      const r = await this.api('PATCH', `despesas/${id}/status`, { status: novoStatus })
      // Mostrar feedback de sincronização com cartão se aplicável
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

  async modalDespesa(despesa = null) {
    const isEdit = !!despesa
    const today = new Date().toISOString().split('T')[0]
    const categorias = ['Alimentação', 'Transporte', 'Saúde', 'Educação', 'Lazer', 'Moradia', 'Roupas', 'Assinaturas', 'Pets', 'Outros']

    // Buscar cartões cadastrados
    let cartoes = []
    try {
      const cartData = await this.api('GET', 'cartoes')
      cartoes = cartData.cartoes || []
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
              <select id="d-meio" class="form-select" onchange="VM.onChangeMeioPagamento(this.value)">
                <option value="dinheiro" ${(despesa?.meio_pagamento||'dinheiro')==='dinheiro'?'selected':''}>💵 Dinheiro / À vista</option>
                <option value="pix" ${despesa?.meio_pagamento==='pix'?'selected':''}>⚡ PIX</option>
                <option value="cartao_debito" ${despesa?.meio_pagamento==='cartao_debito'?'selected':''}>💳 Cartão de Débito</option>
                <option value="cartao_credito" ${despesa?.meio_pagamento==='cartao_credito'?'selected':''}>💳 Cartão de Crédito (à vista)</option>
                <option value="boleto" ${despesa?.meio_pagamento==='boleto'?'selected':''}>📄 Boleto</option>
                <option value="transferencia" ${despesa?.meio_pagamento==='transferencia'?'selected':''}>🏦 Transferência</option>
                ${!isEdit ? `<option value="parcelado_cartao" ${despesa?.parcelado?'selected':''}>💳 Cartão de Crédito Parcelado</option>` : ''}
              </select>
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

        if (isEdit) await this.api('PUT', `despesas/${despesa.id}`, payload)
        else await this.api('POST', 'despesas', payload)
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

  async deleteDespesa(id) {
    if (!confirm('Excluir esta despesa?')) return
    try {
      await this.api('DELETE', `despesas/${id}`)
      this.toast('Despesa excluída!')
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
    if (!confirm('Excluir esta meta?')) return
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
    if (!confirm('Excluir este investimento?')) return
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
      const kpiCard = (label, atual, anterior, prefixo = 'R$ ') => {
        const diff    = atual - anterior
        const varPct  = anterior > 0 ? (diff / anterior * 100).toFixed(1) : (atual > 0 ? '100' : '0')
        const positivo = diff >= 0
        const cor     = label.includes('Despesa') ? (positivo ? '#F43F5E' : '#10B981') : (positivo ? '#10B981' : '#F43F5E')
        const icon    = positivo ? '▲' : '▼'
        return `
          <div style="background:rgba(30,41,59,0.6);border:1px solid rgba(255,255,255,0.06);border-radius:16px;padding:18px 20px;">
            <div style="font-size:0.78rem;color:#64748B;margin-bottom:8px;">${label}</div>
            <div style="font-size:1.35rem;font-weight:800;color:#F8FAFC;">${prefixo}${this.formatMoney(atual)}</div>
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
          <div style="color:#666;font-size:0.85rem;margin-top:2px;">Organize suas despesas com etiquetas personalizadas</div>
        </div>
        <button onclick="VM.modalNovaTag()" class="btn-primary" style="width:auto;padding:10px 20px;">
          <i class="fas fa-plus"></i> Nova Tag
        </button>
      </div>
      <div id="tags-container">
        <div class="empty-state"><div class="skeleton" style="height:200px;border-radius:16px;"></div></div>
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

      cont.innerHTML = `
        <!-- Grid de tags -->
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:14px;margin-bottom:24px;">
          ${tags.map(tag => `
            <div style="background:rgba(30,41,59,0.7);border:1px solid rgba(255,255,255,0.06);border-radius:14px;padding:16px 18px;transition:all 0.2s;" onmouseover="this.style.borderColor='rgba(255,255,255,0.12)'" onmouseout="this.style.borderColor='rgba(255,255,255,0.06)'">
              <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
                <div style="display:flex;align-items:center;gap:10px;">
                  <div style="width:14px;height:14px;border-radius:4px;background:${tag.cor};flex-shrink:0;"></div>
                  <span style="font-weight:600;color:#F8FAFC;font-size:0.9rem;">${tag.nome}</span>
                </div>
                <div style="display:flex;gap:6px;">
                  <button onclick="VM.buscarPorTag(${tag.id},'${tag.nome}')" title="Ver despesas" style="background:rgba(16,185,129,0.1);border:1px solid rgba(16,185,129,0.2);color:#10B981;border-radius:6px;padding:4px 8px;cursor:pointer;font-size:0.72rem;">
                    <i class="fas fa-search"></i>
                  </button>
                  <button onclick="VM.modalEditarTag(${tag.id},'${tag.nome}','${tag.cor}')" title="Editar" style="background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);color:#94A3B8;border-radius:6px;padding:4px 8px;cursor:pointer;font-size:0.72rem;">
                    <i class="fas fa-pen"></i>
                  </button>
                  <button onclick="VM.excluirTag(${tag.id},'${tag.nome}')" title="Excluir" style="background:rgba(244,63,94,0.08);border:1px solid rgba(244,63,94,0.2);color:#F43F5E;border-radius:6px;padding:4px 8px;cursor:pointer;font-size:0.72rem;">
                    <i class="fas fa-trash"></i>
                  </button>
                </div>
              </div>
              <div style="font-size:0.77rem;color:#64748B;">${tag.usos} despesa${tag.usos !== 1 ? 's' : ''} vinculada${tag.usos !== 1 ? 's' : ''}</div>
            </div>
          `).join('')}
        </div>
        <div id="tag-busca-resultado"></div>
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
    document.getElementById('modal-container').innerHTML = `
      <div class="modal-overlay" onclick="VM.closeModal(event)">
        <div class="modal" style="max-width:380px;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;">
            <h3 style="font-size:1.05rem;font-weight:700;">✏️ Editar Tag</h3>
            <button onclick="VM.closeModal()" style="background:none;border:none;color:#666;cursor:pointer;">✕</button>
          </div>
          <div class="form-group">
            <label class="form-label">Nome</label>
            <input type="text" id="edit-tag-nome" class="form-input" value="${nome}" maxlength="30">
          </div>
          <div style="display:flex;gap:10px;margin-top:20px;">
            <button onclick="VM.closeModal()" class="btn-secondary" style="flex:1;justify-content:center;">Cancelar</button>
            <button onclick="VM.atualizarTag(${id})" class="btn-primary" style="flex:1;justify-content:center;">Salvar</button>
          </div>
        </div>
      </div>
    `
  },

  async atualizarTag(id) {
    const nome = document.getElementById('edit-tag-nome')?.value.trim()
    if (!nome) { this.toast('Nome é obrigatório', 'warning'); return }
    try {
      await this.api('PATCH', `tags/${id}`, { nome })
      this.toast('Tag atualizada!')
      this.closeModal()
      this.carregarTags()
    } catch (e) {
      this.toast(e.response?.data?.error || 'Erro ao atualizar', 'error')
    }
  },

  async excluirTag(id, nome) {
    if (!confirm(`Excluir tag "${nome}"? As despesas vinculadas não serão apagadas.`)) return
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
    cont.innerHTML = `<div style="text-align:center;padding:20px;color:#64748B;">Carregando...</div>`
    try {
      const rows = await this.api('GET', `tags/buscar?tag_id=${tagId}`)
      if (!rows || rows.length === 0) {
        cont.innerHTML = `
          <div style="background:rgba(30,41,59,0.6);border:1px solid rgba(255,255,255,0.06);border-radius:14px;padding:20px;text-align:center;">
            <div style="color:#64748B;font-size:0.9rem;">Nenhuma despesa com a tag <strong style="color:#10B981;">${tagNome}</strong></div>
          </div>`
        return
      }
      cont.innerHTML = `
        <div style="background:rgba(30,41,59,0.6);border:1px solid rgba(255,255,255,0.06);border-radius:16px;overflow:hidden;">
          <div style="padding:14px 18px;border-bottom:1px solid rgba(255,255,255,0.06);display:flex;align-items:center;justify-content:space-between;">
            <div style="font-size:0.88rem;font-weight:600;color:#94A3B8;">
              🏷️ Despesas com tag <span style="color:#10B981;">${tagNome}</span> (${rows.length})
            </div>
            <div style="font-size:0.85rem;font-weight:700;color:#F8FAFC;">
              Total: R$ ${this.formatMoney(rows.reduce((s, r) => s + r.valor, 0))}
            </div>
          </div>
          ${rows.slice(0, 20).map(r => `
            <div style="display:flex;align-items:center;justify-content:space-between;padding:11px 18px;border-top:1px solid rgba(255,255,255,0.04);">
              <div>
                <div style="font-size:0.87rem;color:#F8FAFC;">${r.descricao}</div>
                <div style="font-size:0.73rem;color:#64748B;">${r.data} · ${r.categoria}</div>
              </div>
              <div style="font-size:0.88rem;font-weight:600;color:#F43F5E;">R$ ${this.formatMoney(r.valor)}</div>
            </div>
          `).join('')}
          ${rows.length > 20 ? `<div style="padding:10px 18px;font-size:0.75rem;color:#475569;text-align:center;">+ ${rows.length - 20} mais...</div>` : ''}
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
      const { relatorio, totais } = data

      document.getElementById('rel-container').innerHTML = `
        <div class="grid-3" style="margin-bottom:24px;">
          <div class="stat-card"><div class="stat-label" style="margin-bottom:8px;">📥 Receitas ${ano}</div><div class="stat-value positive">${this.formatMoney(totais.receitas)}</div></div>
          <div class="stat-card"><div class="stat-label" style="margin-bottom:8px;">📤 Despesas ${ano}</div><div class="stat-value negative">${this.formatMoney(totais.despesas)}</div></div>
          <div class="stat-card"><div class="stat-label" style="margin-bottom:8px;">💰 Saldo ${ano}</div><div class="stat-value ${totais.saldo >= 0 ? 'positive' : 'negative'}">${this.formatMoney(totais.saldo)}</div></div>
        </div>
        
        <div class="card" style="margin-bottom:24px;">
          <div style="font-weight:700;margin-bottom:20px;">📊 Evolução Mensal ${ano}</div>
          <div style="height:280px;"><canvas id="chart-relatorio"></canvas></div>
        </div>

        <div class="card">
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
                  <td style="text-align:right;">${m.saldo >= 0 ? '<span class="badge badge-green">✅ Positivo</span>' : '<span class="badge badge-red">❌ Negativo</span>'}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `

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
    document.getElementById('page-content').innerHTML = `
      <div class="section-header">
        <div>
          <div class="section-title">💳 Cartões de Crédito</div>
          <div style="color:#666;font-size:0.85rem;margin-top:2px;">Faturas, compras e controle de limite</div>
        </div>
        <div style="display:flex;gap:10px;flex-wrap:wrap;">
          <button onclick="VM.sincronizarDespesasCartao()" title="Sincroniza despesas antigas com o sistema de faturas" style="background:rgba(251,191,36,0.1);border:1px solid rgba(251,191,36,0.3);color:#fbbf24;border-radius:8px;padding:8px 14px;cursor:pointer;font-size:0.78rem;">
            <i class="fas fa-sync-alt"></i> Sincronizar
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

  // Sincroniza despesas de cartão que não têm card_charge
  async sincronizarDespesasCartao() {
    try {
      const r = await this.api('POST', 'cartoes/sincronizar-despesas', {})
      if (r.sincronizadas > 0) {
        this.toast(`✅ ${r.sincronizadas} despesa(s) sincronizada(s) com o sistema de faturas!`)
        this.carregarCartoes()
      } else {
        this.toast('ℹ️ Tudo sincronizado! Nenhuma despesa órfã encontrada.')
      }
    } catch(e) {
      this.toast('Erro ao sincronizar', 'error')
    }
  },

  async carregarCartoes() {
    try {
      const data = await this.api('GET', 'cartoes')
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

      container.innerHTML = `
        <div class="grid-3" style="margin-bottom:24px;">
          ${data.cartoes.map(c => {
            const usado = c.limite_utilizado || 0
            const pct = c.percentual_uso || 0
            const pctColor = pct > 80 ? '#ff6b6b' : pct > 50 ? '#ffc400' : '#2FBF71'
            return `
              <div class="card" style="border-color:${c.cor || '#2FBF71'}40;position:relative;overflow:hidden;cursor:pointer;"
                   onclick="VM.abrirFaturaCartao(${c.id}, '${c.nome.replace(/'/g,"\\'")}', '${c.cor||'#2FBF71'}', ${c.dia_fechamento || 0})">
                <div style="position:absolute;top:0;left:0;right:0;height:3px;background:${c.cor || '#2FBF71'};"></div>
                <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:16px;">
                  <div>
                    <div style="font-size:1rem;font-weight:700;">${c.nome}</div>
                    <div style="font-size:0.78rem;color:#666;margin-top:2px;">${bandeiras[c.bandeira] || c.bandeira} • ${c.banco}</div>
                    ${c.ultimos_digitos ? `<div style="font-size:0.75rem;color:#444;margin-top:2px;">•••• ${c.ultimos_digitos}</div>` : ''}
                  </div>
                  <div style="display:flex;gap:6px;" onclick="event.stopPropagation()">
                    <button onclick="VM.modalCartao(${JSON.stringify(c).replace(/"/g,'&quot;')})" class="btn-success"><i class="fas fa-edit"></i></button>
                    <button onclick="VM.deleteCartao(${c.id})" class="btn-danger"><i class="fas fa-trash"></i></button>
                  </div>
                </div>

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
                    <div style="font-size:0.82rem;font-weight:700;color:#2FBF71;">${this.formatMoney(c.limite_disponivel || 0)}</div>
                  </div>
                </div>

                <div style="display:flex;justify-content:space-between;align-items:center;margin-top:12px;padding-top:12px;border-top:1px solid rgba(255,255,255,0.05);">
                  <span style="font-size:0.75rem;color:#666;">Fecha: dia ${c.dia_fechamento} &nbsp;•&nbsp; Vence: dia ${c.dia_vencimento}</span>
                  <span style="font-size:0.72rem;color:#2FBF71;"><i class="fas fa-file-invoice"></i> Ver fatura</span>
                </div>
              </div>
            `
          }).join('')}
        </div>
      `
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
    if (!confirm(`Pagar toda a fatura de ${mes}/${ano}?`)) return
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
    if (!confirm('Excluir este lançamento?')) return
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
                <input type="number" id="ct-fecha" class="form-input" min="1" max="31" value="${cartao?.dia_fechamento || ''}" required>
              </div>
              <div class="form-group">
                <label class="form-label">Dia de Vencimento *</label>
                <input type="number" id="ct-vence" class="form-input" min="1" max="31" value="${cartao?.dia_vencimento || ''}" required>
              </div>
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
    if (!confirm('Excluir este cartão?')) return
    try {
      await this.api('DELETE', `cartoes/${id}`)
      this.toast('Cartão excluído!')
      this.carregarCartoes()
    } catch (e) {
      this.toast('Erro ao excluir', 'error')
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
    if (!confirm('Excluir este lembrete?')) return
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
    if (!confirm('Confirmar pagamento desta parcela de financiamento?')) return
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
    if (!confirm('Excluir este financiamento? Todas as parcelas vinculadas também serão removidas.')) return
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
    if (!confirm('Confirmar pagamento desta parcela de empréstimo?')) return
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
    if (!confirm('Excluir este empréstimo? Todas as parcelas vinculadas também serão removidas.')) return
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
    if (this.limites !== null && !this.limites.ia_insights) {
      this.upsellModal('ia_insights')
      this.navigate('dashboard')
      return
    }
    document.getElementById('page-content').innerHTML = `
      <div class="section-header">
        <div>
          <div class="section-title">🧠 Diagnóstico Financeiro 360°</div>
          <div style="color:#666;font-size:0.85rem;margin-top:2px;">Análise completa baseada em 5 módulos • Hierarquia CFP®</div>
        </div>
        <button onclick="VM.gerarInsightsIA()" class="btn-primary" style="width:auto;padding:10px 20px;">
          <i class="fas fa-sync"></i> Atualizar
        </button>
      </div>
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

        <!-- rodapé -->
        <div style="text-align:center;font-size:0.72rem;color:#444;padding:8px 0 20px;">
          Análise gerada em ${new Date().toLocaleString('pt-BR')} • Período ${re.periodo?.mes || '—'}/${re.periodo?.ano || '—'}
        </div>
      `
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
    this.toast('Atualizando diagnóstico...', 'info')
    this.carregarIA()
  },

  // ============== CONQUISTAS ==============
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
                  <div style="font-size:0.7rem;color:${atingido?'#2FBF71':'#444'};margin-top:2px;">${atingido?'✓ Atingido':'${this.formatMoney(marco.m * mediaGastos)}'}</div>
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
    if (!confirm('Tem certeza que deseja excluir sua reserva de emergência?')) return
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
        reserva_6_meses: 'Acumule 6 meses de despesas na reserva.',
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
      if (!confirm(`Excluir o orçamento "${label}"?`)) return
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
    this._conqPollTimer = setInterval(() => this.checkNovasConquistas(), 30000)
    // Verificar alertas de cartão na inicialização (sem polling agressivo)
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
    try {
      const data = await this.api('GET', 'conquistas/novas')
      const novas = data.novas || []
      if (novas.length === 0) return

      // Marcar como visualizadas
      await this.api('PATCH', 'conquistas/visualizar')

      // Mostrar toast para cada conquista nova
      novas.forEach((c, i) => {
        setTimeout(() => this.showConqToast(c), i * 1500)
      })

      // Atualizar badge na sidebar
      const badge = document.getElementById('badge-conquistas')
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
            <div style="color:#666;font-size:0.82rem;">Transações fixas geradas automaticamente todo mês</div>
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
            { icon:'💸', val: this.fmt(resumo.total_despesas||0), label:'Saídas/mês', cor:'#F43F5E' },
            { icon:'💰', val: this.fmt(resumo.total_receitas||0), label:'Entradas/mês', cor:'#10B981' }
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
            <div style="color:#666;font-size:0.85rem;margin-bottom:20px;">Cadastre suas contas fixas para gerar automaticamente todo mês.</div>
            <button onclick="VM._abrirNovaRecorrencia()" class="btn-primary" style="padding:10px 24px;"><i class="fas fa-plus"></i> Criar Primeira Recorrência</button>
          </div>
        ` : `
          <div style="background:#111827;border:1px solid #1f2937;border-radius:12px;overflow:hidden;">
            <table style="width:100%;border-collapse:collapse;font-size:0.82rem;">
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
                  return `<tr style="border-bottom:1px solid #1a1a2e;transition:background 0.15s;" onmouseover="this.style.background='rgba(255,255,255,0.02)'" onmouseout="this.style.background=''">
                    <td style="padding:12px 16px;">
                      <div style="font-weight:600;">${r.descricao}</div>
                      <div style="font-size:0.7rem;color:#555;">${r.categoria} · Dia ${r.dia_vencimento}</div>
                    </td>
                    <td style="padding:12px 16px;">
                      <span style="background:${cfg.bg};color:${cfg.cor};border:1px solid ${cfg.cor}33;border-radius:20px;padding:3px 10px;font-size:0.7rem;font-weight:700;">
                        <i class="fas ${cfg.icon}"></i> ${cfg.label}
                      </span>
                    </td>
                    <td style="padding:12px 16px;text-align:right;font-weight:700;color:${cfg.cor};">${this.fmt(r.valor)}</td>
                    <td style="padding:12px 16px;text-align:center;color:#94a3b8;">${r.dia_vencimento}</td>
                    <td style="padding:12px 16px;text-align:center;">
                      <span style="background:${r.ativa?'rgba(16,185,129,0.1)':'rgba(100,116,139,0.1)'};color:${r.ativa?'#10B981':'#64748b'};border-radius:20px;padding:3px 10px;font-size:0.7rem;font-weight:700;">
                        ${r.ativa ? '● Ativa' : '○ Pausada'}
                      </span>
                    </td>
                    <td style="padding:12px 16px;text-align:center;">
                      <div style="display:flex;gap:4px;justify-content:center;">
                        <button onclick="VM._toggleRecorrencia(${r.id},${r.ativa})" title="${r.ativa?'Pausar':'Ativar'}" style="background:rgba(255,255,255,0.05);border:1px solid #333;color:#aaa;border-radius:6px;padding:5px 8px;cursor:pointer;font-size:0.7rem;"><i class="fas fa-${r.ativa?'pause':'play'}"></i></button>
                        <button onclick="VM._deletarRecorrencia(${r.id},'${r.descricao}')" style="background:rgba(244,63,94,0.1);border:1px solid rgba(244,63,94,0.3);color:#F43F5E;border-radius:6px;padding:5px 8px;cursor:pointer;font-size:0.7rem;"><i class="fas fa-trash"></i></button>
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
        <div style="color:#666;font-size:0.82rem;margin-bottom:20px;">Transação que se repete todo mês automaticamente</div>
        <div style="display:flex;flex-direction:column;gap:12px;">
          <div>
            <label style="font-size:0.75rem;color:#888;display:block;margin-bottom:4px;">Tipo</label>
            <select id="rec-tipo" style="background:#0d1117;border:1px solid #2a2a3e;color:#e0e0e0;border-radius:8px;padding:9px 12px;font-size:0.85rem;width:100%;">
              <option value="despesa">💸 Despesa Fixa</option>
              <option value="receita">💰 Receita Fixa</option>
            </select>
          </div>
          <div>
            <label style="font-size:0.75rem;color:#888;display:block;margin-bottom:4px;">Descrição</label>
            <input id="rec-desc" type="text" placeholder="Ex: Aluguel, Netflix, Salário..." style="background:#0d1117;border:1px solid #2a2a3e;color:#e0e0e0;border-radius:8px;padding:9px 12px;font-size:0.85rem;width:100%;">
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
            <div>
              <label style="font-size:0.75rem;color:#888;display:block;margin-bottom:4px;">Valor (R$)</label>
              <input id="rec-valor" type="number" min="0.01" step="0.01" placeholder="0,00" style="background:#0d1117;border:1px solid #2a2a3e;color:#e0e0e0;border-radius:8px;padding:9px 12px;font-size:0.85rem;width:100%;">
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

    this._salvarRecorrencia = async () => {
      const tipo = document.getElementById('rec-tipo').value
      const desc = document.getElementById('rec-desc').value.trim()
      const valor = parseFloat(document.getElementById('rec-valor').value)
      const dia   = parseInt(document.getElementById('rec-dia').value)
      const cat   = document.getElementById('rec-cat').value
      if (!desc || !valor || !dia || dia < 1 || dia > 31) { this.toast('Preencha todos os campos corretamente', 'error'); return }
      const r = await this.api('POST', 'recorrencias', { tipo, descricao: desc, valor, dia_vencimento: dia, categoria: cat })
      if (r.success) { this.closeModal(); this.toast('✅ Recorrência criada!'); renderRec() }
      else this.toast(r.error || 'Erro ao criar', 'error')
    }

    this._toggleRecorrencia = async (id, ativa) => {
      await this.api('PATCH', `recorrencias/${id}/toggle`)
      this.toast(ativa ? '⏸️ Recorrência pausada' : '▶️ Recorrência ativada')
      renderRec()
    }

    this._deletarRecorrencia = async (id, desc) => {
      if (!confirm(`Excluir a recorrência "${desc}"?`)) return
      await this.api('DELETE', `recorrencias/${id}`)
      this.toast('✅ Recorrência removida'); renderRec()
    }

    this._processarRecorrencias = async () => {
      const hoje = new Date()
      const r = await this.api('POST', 'recorrencias/processar', { mes: hoje.getMonth()+1, ano: hoje.getFullYear() })
      if (r.geradas > 0) {
        this.toast(`✅ ${r.geradas} transação(ões) gerada(s) para ${r.mes}/${r.ano}`)
      } else {
        this.toast(`ℹ️ Todas as recorrências já foram geradas para este mês`)
      }
      renderRec()
    }

    this._abrirGerarMesFuturo = () => {
      const hoje = new Date()
      const mesesNomes = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro']
      // Montar opções de meses futuros (próximos 12 meses)
      let options = ''
      for (let i = 1; i <= 12; i++) {
        let m = hoje.getMonth() + 1 + i, y = hoje.getFullYear()
        if (m > 12) { m -= 12; y++ }
        options += `<option value="${m}_${y}">${mesesNomes[m-1]}/${y}</option>`
      }
      this.showModal(`
        <div style="font-size:1.05rem;font-weight:700;margin-bottom:16px;">📅 Gerar Recorrências para Mês Futuro</div>
        <div style="color:#888;font-size:0.82rem;margin-bottom:16px;">
          Cria despesas e receitas recorrentes em meses futuros antecipadamente.
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
          this.toast(`✅ ${r.geradas} transação(ões) gerada(s) para ${mesesNomes[parseInt(mes)-1]}/${ano}`)
        } else {
          this.toast(`ℹ️ Todas as recorrências já foram geradas para ${mesesNomes[parseInt(mes)-1]}/${ano}`)
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
    if (!confirm(`Excluir a reserva "${name}"?${currentAmount > 0 ? `\n\n⚠️ Você possui R$ ${fmtBRL(currentAmount)} nesta reserva. Certifique-se de transferir esse valor antes de excluir.` : ''}`)) return
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
  async pageAssinaturasFantasma() {
    const content = document.getElementById('page-content')
    content.innerHTML = `<div class="empty-state"><div class="skeleton" style="height:180px;border-radius:16px;margin-bottom:16px;"></div></div>`
    
    try {
      const data = await this.api('GET', 'assinaturas-fantasma')
      const { detected = [], totalMensal = 0, totalAnual = 0 } = data
      const fmtBRL = v => (v||0).toLocaleString('pt-BR', {minimumFractionDigits:2,maximumFractionDigits:2})
      const fmtDate = d => d ? new Date(d+'T12:00:00').toLocaleDateString('pt-BR') : '—'
      
      const serviceIcons = {
        streaming:'🎬', cloud:'☁️', software:'💻', fitness:'💪',
        transport:'🚗', food:'🍔', gaming:'🎮', professional:'💼',
        education:'🎓', unknown:'📱'
      }
      
      content.innerHTML = `
        <div style="max-width:1000px;">
          <!-- Header -->
          <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:28px;flex-wrap:wrap;gap:12px;">
            <div>
              <h1 style="font-size:1.8rem;font-weight:800;color:#f1f5f9;margin:0 0 6px;">👻 Assinaturas Fantasma</h1>
              <p style="color:#64748B;margin:0;">O brasileiro médio desperdiça R$ 150-250/mês em serviços esquecidos. Vamos encontrar os seus.</p>
            </div>
            <button onclick="VM.scanAssinaturas()" id="btn-scan-assin"
              style="background:linear-gradient(135deg,#8B5CF6,#7C3AED);color:#fff;border:none;padding:12px 24px;border-radius:12px;font-weight:700;cursor:pointer;font-size:0.9rem;display:flex;align-items:center;gap:8px;">
              🔍 Escanear Gastos
            </button>
          </div>
          
          ${detected.length > 0 ? `
          <!-- Summary Impacto -->
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
          
          <!-- Lista -->
          ${detected.length === 0 ? `
          <div style="text-align:center;padding:60px 20px;background:rgba(255,255,255,0.02);border:2px dashed #1f2937;border-radius:20px;">
            <div style="font-size:4rem;margin-bottom:16px;">🕵️</div>
            <h2 style="color:#f1f5f9;font-size:1.3rem;font-weight:700;margin-bottom:8px;">Nenhuma assinatura detectada</h2>
            <p style="color:#64748B;margin:0 0 20px;">Clique em "Escanear Gastos" para analisar seus últimos 8 meses de despesas pagas e encontrar padrões recorrentes.</p>
            <div style="background:rgba(59,130,246,0.08);border:1px solid rgba(59,130,246,0.2);border-radius:12px;padding:16px;max-width:480px;margin:0 auto;text-align:left;">
              <p style="color:#93C5FD;font-weight:700;margin:0 0 8px;">ℹ️ Como funciona?</p>
              <p style="color:#94A3B8;font-size:0.82rem;margin:0;line-height:1.6;">O algoritmo analisa cobranças com o mesmo nome e valor que aparecem mensalmente. Uma confiança ≥ 60% é necessária para a detecção.</p>
            </div>
          </div>
          ` : `
          <div style="space-y:12px;">
            <h2 style="color:#f1f5f9;font-size:1rem;font-weight:700;margin:0 0 16px;">🔍 Assinaturas Encontradas</h2>
            ${detected.map(sub => `
            <div style="background:rgba(15,23,42,0.85);border:1px solid rgba(255,255,255,0.06);border-radius:16px;padding:20px;margin-bottom:12px;transition:all 0.2s;"
              onmouseover="this.style.borderColor='rgba(139,92,246,0.3)'"
              onmouseout="this.style.borderColor='rgba(255,255,255,0.06)'">
              <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap;">
                <div style="display:flex;align-items:center;gap:14px;flex:1;">
                  <div style="width:48px;height:48px;background:rgba(139,92,246,0.15);border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:1.6rem;flex-shrink:0;">
                    ${serviceIcons[sub.service_type] || '📱'}
                  </div>
                  <div style="flex:1;">
                    <div style="font-weight:700;color:#f1f5f9;font-size:1rem;margin-bottom:4px;">${sub.original_description}</div>
                    <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
                      <span style="color:#64748B;font-size:0.75rem;">📊 ${sub.frequency}× nos últimos meses</span>
                      <span style="color:#64748B;font-size:0.75rem;">🎯 ${sub.confidence?.toFixed(0)}% certeza</span>
                      <span style="background:rgba(139,92,246,0.15);color:#A78BFA;font-size:0.68rem;padding:2px 8px;border-radius:50px;font-weight:600;">${sub.service_type}</span>
                    </div>
                  </div>
                </div>
                
                <!-- Valores -->
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
              
              <!-- Pergunta + Ações -->
              <div style="margin-top:16px;padding:14px;background:linear-gradient(135deg,rgba(139,92,246,0.08),rgba(59,130,246,0.08));border:1px solid rgba(139,92,246,0.2);border-radius:12px;">
                <p style="color:#f1f5f9;font-weight:600;text-align:center;margin:0 0 12px;font-size:0.9rem;">🤔 Você ainda usa este serviço regularmente?</p>
                <div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap;">
                  <button onclick="VM.feedbackAssinatura(${sub.id}, 'use_regularly')"
                    style="background:rgba(16,185,129,0.15);color:#10B981;border:1px solid rgba(16,185,129,0.3);padding:8px 16px;border-radius:8px;font-weight:700;cursor:pointer;font-size:0.82rem;">
                    ✅ Uso Sempre
                  </button>
                  <button onclick="VM.feedbackAssinatura(${sub.id}, 'want_cancel')"
                    style="background:rgba(244,63,94,0.15);color:#F43F5E;border:1px solid rgba(244,63,94,0.3);padding:8px 16px;border-radius:8px;font-weight:700;cursor:pointer;font-size:0.82rem;">
                    ❌ Quero Cancelar
                  </button>
                  <button onclick="VM.feedbackAssinatura(${sub.id}, 'ignore')"
                    style="background:rgba(100,116,139,0.15);color:#94A3B8;border:1px solid rgba(100,116,139,0.2);padding:8px 16px;border-radius:8px;font-weight:600;cursor:pointer;font-size:0.82rem;">
                    🤐 Ignorar
                  </button>
                </div>
              </div>
            </div>
            `).join('')}
          </div>
          `}
          
          <!-- Dicas -->
          <div style="background:linear-gradient(135deg,rgba(59,130,246,0.06),rgba(139,92,246,0.06));border:1px solid rgba(59,130,246,0.2);border-radius:16px;padding:24px;margin-top:24px;">
            <h3 style="color:#f1f5f9;font-size:0.95rem;font-weight:700;margin:0 0 14px;display:flex;align-items:center;gap:8px;">💡 Dicas para Controlar Assinaturas</h3>
            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:16px;">
              <div>
                <h4 style="color:#93C5FD;font-size:0.82rem;font-weight:700;margin:0 0 4px;">📅 Auditoria Mensal</h4>
                <p style="color:#94A3B8;font-size:0.8rem;line-height:1.5;margin:0;">Reserve o último domingo do mês para revisar todas as assinaturas. Cancele o que não usou nos últimos 30 dias.</p>
              </div>
              <div>
                <h4 style="color:#C4B5FD;font-size:0.82rem;font-weight:700;margin:0 0 4px;">👨‍👩‍👧 Planos Familiares</h4>
                <p style="color:#94A3B8;font-size:0.8rem;line-height:1.5;margin:0;">Netflix, Spotify, YouTube Premium têm planos familiares. Compartilhe custos e economize até 60%.</p>
              </div>
              <div>
                <h4 style="color:#6EE7B7;font-size:0.82rem;font-weight:700;margin:0 0 4px;">🔄 Alternância Estratégica</h4>
                <p style="color:#94A3B8;font-size:0.8rem;line-height:1.5;margin:0;">Para streaming: assine um, assista o que precisa, cancele e assine outro. Economize sem abrir mão do conteúdo.</p>
              </div>
            </div>
          </div>
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

  // ═══════════════════════════════════════════════════════════════
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
          <div style="font-size:${w.status === 'completed' || w.status === 'skipped' ? '0.9' : '0.65'}rem;color:${textColor};font-weight:${isCurrent ? '700' : '600'};">${icon}</div>
          ${w.status === 'completed' ? '' : `<div style="font-size:0.55rem;color:#64748B;margin-top:1px;">R$${w.target_amount}</div>`}
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
            <div style="display:grid;grid-template-columns:repeat(13,1fr);gap:6px;">
              ${weekGrid}
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

  markdownToHtml(text) {
    if (!text) return ''
    return text
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
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
    if (!confirm('Limpar todo o histórico de conversa?')) return
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
