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
      <div class="auth-page">
        <div class="auth-card" style="max-width:480px;">
          <div class="auth-logo">
            <div class="logo-icon">💚</div>
            <div style="font-size:1.6rem;font-weight:800;" class="gradient-text">VerdeMais</div>
            <div style="color:#666;font-size:0.85rem;margin-top:4px;">Comece sua jornada financeira</div>
          </div>
          
          <h2 style="font-size:1.3rem;font-weight:700;margin-bottom:24px;text-align:center;">Criar conta gratuita</h2>
          
          <div id="auth-error" style="display:none;background:rgba(255,80,80,0.1);border:1px solid rgba(255,80,80,0.3);border-radius:10px;padding:12px 16px;margin-bottom:16px;color:#ff6b6b;font-size:0.88rem;"></div>
          
          <form id="cadastro-form">
            <div class="form-group">
              <label class="form-label">Nome completo</label>
              <input type="text" id="cad-nome" class="form-input" placeholder="Seu nome completo" required>
            </div>
            <div class="form-group">
              <label class="form-label">E-mail</label>
              <input type="email" id="cad-email" class="form-input" placeholder="seu@email.com" required>
            </div>
            <div class="form-group">
              <label class="form-label">Confirmar e-mail</label>
              <input type="email" id="cad-email2" class="form-input" placeholder="Confirme seu e-mail" required>
            </div>
            <div class="form-group">
              <label class="form-label">Senha <span style="color:#555;font-size:0.78rem;">(mínimo 6 caracteres)</span></label>
              <div style="position:relative;">
                <input type="password" id="cad-senha" class="form-input" placeholder="••••••••" required minlength="6" style="padding-right:44px;">
                <button type="button" onclick="VM.toggleSenha('cad-senha','eye1')" style="position:absolute;right:12px;top:50%;transform:translateY(-50%);background:none;border:none;color:#666;cursor:pointer;font-size:1rem;" id="eye1"><i class="fas fa-eye"></i></button>
              </div>
            </div>
            <div class="form-group">
              <label class="form-label">Confirmar senha</label>
              <div style="position:relative;">
                <input type="password" id="cad-senha2" class="form-input" placeholder="••••••••" required minlength="6" style="padding-right:44px;">
                <button type="button" onclick="VM.toggleSenha('cad-senha2','eye2')" style="position:absolute;right:12px;top:50%;transform:translateY(-50%);background:none;border:none;color:#666;cursor:pointer;font-size:1rem;" id="eye2"><i class="fas fa-eye"></i></button>
              </div>
            </div>
            <div id="senha-strength" style="margin-bottom:12px;display:none;">
              <div style="display:flex;gap:4px;margin-bottom:4px;" id="strength-bars"></div>
              <div style="font-size:0.75rem;" id="strength-label"></div>
            </div>
            <button type="submit" class="btn-primary" id="cad-btn">
              <i class="fas fa-user-plus"></i> Criar conta grátis
            </button>
          </form>
          
          <div style="text-align:center;margin-top:20px;color:#666;font-size:0.78rem;line-height:1.6;">
            Ao criar conta você concorda com os <a href="#" style="color:#2FBF71;">Termos de Uso</a> e 
            <a href="#" style="color:#2FBF71;">Política de Privacidade</a> (LGPD)
          </div>
          <div style="text-align:center;margin-top:16px;color:#666;font-size:0.88rem;">
            Já tem conta? <a href="/login" style="color:#2FBF71;text-decoration:none;font-weight:600;">Entrar</a>
          </div>
        </div>
      </div>
    `

    // Verificação de força da senha
    document.getElementById('cad-senha').addEventListener('input', (e) => {
      const senha = e.target.value
      const strengthEl = document.getElementById('senha-strength')
      const barsEl = document.getElementById('strength-bars')
      const labelEl = document.getElementById('strength-label')
      if (senha.length === 0) { strengthEl.style.display = 'none'; return }
      strengthEl.style.display = 'block'
      let score = 0
      if (senha.length >= 8) score++
      if (/[A-Z]/.test(senha)) score++
      if (/[0-9]/.test(senha)) score++
      if (/[^A-Za-z0-9]/.test(senha)) score++
      const levels = [
        { label: 'Muito fraca', color: '#ff4444' },
        { label: 'Fraca', color: '#ff8800' },
        { label: 'Média', color: '#ffc400' },
        { label: 'Forte', color: '#2FBF71' },
        { label: 'Muito forte', color: '#00a854' }
      ]
      const lvl = levels[score] || levels[0]
      barsEl.innerHTML = Array(4).fill(0).map((_, i) => `<div style="flex:1;height:4px;border-radius:2px;background:${i < score ? lvl.color : 'rgba(255,255,255,0.1)'}"></div>`).join('')
      labelEl.innerHTML = `<span style="color:${lvl.color};">${lvl.label}</span>`
    })

    document.getElementById('cadastro-form').addEventListener('submit', async (e) => {
      e.preventDefault()
      const btn = document.getElementById('cad-btn')
      const errEl = document.getElementById('auth-error')
      
      const email = document.getElementById('cad-email').value
      const email2 = document.getElementById('cad-email2').value
      const senha = document.getElementById('cad-senha').value
      const senha2 = document.getElementById('cad-senha2').value

      errEl.style.display = 'none'
      
      if (email !== email2) {
        errEl.textContent = 'Os e-mails não coincidem. Verifique e tente novamente.'
        errEl.style.display = 'block'; return
      }
      if (senha !== senha2) {
        errEl.textContent = 'As senhas não coincidem. Verifique e tente novamente.'
        errEl.style.display = 'block'; return
      }
      if (senha.length < 6) {
        errEl.textContent = 'A senha deve ter pelo menos 6 caracteres.'
        errEl.style.display = 'block'; return
      }

      btn.disabled = true
      btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Criando conta...'

      try {
        const res = await axios.post('/api/auth/register', {
          nome: document.getElementById('cad-nome').value,
          email, senha
        })
        localStorage.setItem('vm_token', res.data.token)
        localStorage.setItem('vm_user', JSON.stringify(res.data.user))
        // Redirecionar para onboarding
        window.location.href = '/onboarding'
      } catch (e) {
        errEl.textContent = e.response?.data?.error || 'Erro ao criar conta'
        errEl.style.display = 'block'
        btn.disabled = false
        btn.innerHTML = '<i class="fas fa-user-plus"></i> Criar conta grátis'
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
            <a class="nav-item" id="nav-relatorios" onclick="VM.navigate('relatorios')">
              <span class="nav-icon"><i class="fas fa-file-alt"></i></span> Relatórios
            </a>
            <a class="nav-item" id="nav-simulacao" onclick="VM.navigate('simulacao')">
              <span class="nav-icon"><i class="fas fa-calculator"></i></span> Simulações
            </a>
            <a class="nav-item" id="nav-ia" onclick="VM.navigate('ia')">
              <span class="nav-icon"><i class="fas fa-brain"></i></span> Análise IA ✨
            </a>
            <a class="nav-item" id="nav-conquistas" onclick="VM.navigate('conquistas')">
              <span class="nav-icon"><i class="fas fa-trophy"></i></span> Conquistas
              <span id="badge-conquistas" style="display:none;margin-left:auto;background:#2FBF71;color:#000;font-size:0.65rem;padding:2px 7px;border-radius:50px;font-weight:700;"></span>
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
      
      <div id="toast-container" class="toast-container"></div>
      <div id="modal-container"></div>
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
      projecao: ['Projeção Financeira 🔮', 'Veja seu futuro financeiro'],
      simulacao: ['Simulações', 'Projeções de investimento'],
      ia: ['Análise com IA ✨', 'Insights personalizados'],
      conquistas: ['Conquistas', 'Sua evolução financeira'],
      perfil: ['Meu Perfil', 'Configurações da conta']
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
      simulacao: () => this.pageSimulacao(),
      ia: () => this.pageIA(),
      projecao: () => this.pageProjecao(),
      conquistas: () => this.pageConquistas(),
      perfil: () => this.pagePerfil(),
      reserva: () => this.pageReserva()
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
      const { resumo, score_saude, score_bloqueado, fatores_score = [], limites, metas, emprestimos: empResumo, financiamentos: finResumo, evolucao, categorias_despesas, ultimas_transacoes, proximos_vencimentos } = data

      // Salvar limites do plano para uso no frontend
      if (limites) this.limites = limites

      const scoreReal = score_saude !== null ? score_saude : 0
      const scoreColor = scoreReal >= 70 ? '#2FBF71' : scoreReal >= 40 ? '#ffc400' : '#ff6b6b'
      const scoreLabel = scoreReal >= 80 ? 'Excelente! 🏆' : scoreReal >= 60 ? 'Boa saúde 👍' : scoreReal >= 40 ? 'Atenção ⚠️' : 'Crítico ❗'
      const totalDevedor = resumo.total_devedor || 0
      const parcelaMensal = resumo.total_parcela_mensal_dividas || 0
      const comprometimento = resumo.comprometimento_dividas_pct || 0
      const comprometimentoColor = comprometimento > 30 ? '#ff6b6b' : comprometimento > 20 ? '#ffc400' : '#2FBF71'

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
                <select id="d-cat" class="form-select">
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
                <input type="number" id="d-valor" class="form-input" placeholder="0,00" step="0.01" min="0" value="${despesa?.valor || ''}" oninput="document.getElementById('d-ultimo-editado').value='total';VM.atualizarPreviewParcela()" required>
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
          parcelas_total_original: isRetroativa ? numParcelasTotal : numParcelasRestantes
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
      <div id="invest-container">
        <div class="empty-state"><div class="skeleton" style="height:200px;border-radius:16px;"></div></div>
      </div>
    `
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

  // ============== SIMULAÇÃO ==============
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
    document.getElementById('app').innerHTML = `
      <div style="min-height:100vh;background:linear-gradient(135deg,#0f0f1a 0%,#0d2818 100%);display:flex;align-items:center;justify-content:center;padding:20px;">
        <div style="width:100%;max-width:600px;">
          <div style="text-align:center;margin-bottom:32px;">
            <div style="font-size:2.5rem;margin-bottom:8px;">💚</div>
            <div style="font-size:1.4rem;font-weight:800;" class="gradient-text">VerdeMais</div>
            <div style="color:#666;font-size:0.9rem;margin-top:4px;">Vamos personalizar sua experiência</div>
          </div>
          
          <!-- Progress Bar -->
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:32px;" id="ob-progress">
            ${[1,2,3,4,5].map(i => `
              <div style="flex:1;height:4px;border-radius:2px;background:${i===1 ? 'linear-gradient(90deg,#2FBF71,#208040)' : 'rgba(255,255,255,0.1)'};transition:all 0.3s;" id="ob-bar-${i}"></div>
            `).join('')}
          </div>
          
          <div id="ob-card" style="background:rgba(255,255,255,0.04);border:1px solid rgba(47,191,113,0.15);border-radius:24px;padding:40px;">
            <!-- Conteúdo será injetado por JS -->
          </div>
        </div>
      </div>
    `
    this.renderOnboardingStep(1)
  },

  renderOnboardingStep(step) {
    this.onboardingStep = step
    const card = document.getElementById('ob-card')
    
    // Atualizar barra de progresso
    for (let i = 1; i <= 5; i++) {
      const bar = document.getElementById(`ob-bar-${i}`)
      if (bar) {
        bar.style.background = i <= step ? 'linear-gradient(90deg,#2FBF71,#208040)' : 'rgba(255,255,255,0.1)'
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
    card.innerHTML = `
      <div style="text-align:center;margin-bottom:28px;">
        <div style="font-size:2.5rem;margin-bottom:12px;">${s.icon}</div>
        <h2 style="font-size:1.3rem;font-weight:700;margin-bottom:8px;">${s.titulo}</h2>
        <p style="color:#666;font-size:0.9rem;line-height:1.6;">${s.subtitulo}</p>
      </div>
      
      <div style="font-size:0.75rem;color:#444;text-align:center;margin-bottom:20px;">Etapa ${step} de 5</div>
      
      ${s.html}
      
      <div style="display:flex;gap:12px;margin-top:28px;">
        ${step > 1 ? `
          <button onclick="VM.renderOnboardingStep(${step-1})" class="btn-secondary" style="flex:0 0 auto;padding:12px 20px;">
            <i class="fas fa-arrow-left"></i> Voltar
          </button>
        ` : `
          <button onclick="window.location.href='/app'" class="btn-secondary" style="flex:0 0 auto;padding:12px 20px;">
            Pular
          </button>
        `}
        <button onclick="VM.nextOnboardingStep(${step})" class="btn-primary" style="flex:1;justify-content:center;" id="ob-next">
          ${step === 5 ? '<i class="fas fa-rocket"></i> Começar VerdeMais' : 'Próximo <i class="fas fa-arrow-right"></i>'}
        </button>
      </div>
      
      ${step < 5 ? `<div style="text-align:center;margin-top:16px;"><button onclick="window.location.href='/app'" style="background:none;border:none;color:#444;cursor:pointer;font-size:0.8rem;">Pular configuração</button></div>` : ''}
    `

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
    document.getElementById('app').innerHTML = `
      <div style="min-height:100vh;background:linear-gradient(135deg,#0f0f1a 0%,#0d2818 100%);display:flex;align-items:center;justify-content:center;padding:20px;">
        <div style="width:100%;max-width:520px;text-align:center;">
          <div style="font-size:4rem;margin-bottom:24px;animation:bounceIn 0.6s ease;">🏆</div>
          <h1 style="font-size:2rem;font-weight:800;margin-bottom:16px;">
            Perfil configurado,<br><span class="gradient-text">${nome}!</span>
          </h1>
          <p style="color:#888;font-size:1rem;line-height:1.7;margin-bottom:32px;">
            Seu VerdeMais está personalizado. Agora vamos organizar suas finanças e construir seu futuro juntos. 💚
          </p>
          
          <div style="background:rgba(47,191,113,0.08);border:1px solid rgba(47,191,113,0.2);border-radius:20px;padding:24px;margin-bottom:32px;">
            <div style="font-weight:700;margin-bottom:16px;color:#2FBF71;">🚀 Próximos passos recomendados</div>
            <div style="display:flex;flex-direction:column;gap:12px;text-align:left;">
              <div style="display:flex;align-items:center;gap:12px;font-size:0.9rem;color:#aaa;">
                <div style="width:28px;height:28px;background:#2FBF71;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:0.8rem;flex-shrink:0;">1</div>
                Adicione sua renda mensal no módulo <strong style="color:#fff;">Receitas</strong>
              </div>
              <div style="display:flex;align-items:center;gap:12px;font-size:0.9rem;color:#aaa;">
                <div style="width:28px;height:28px;background:#208040;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:0.8rem;flex-shrink:0;">2</div>
                Registre suas principais despesas mensais
              </div>
              <div style="display:flex;align-items:center;gap:12px;font-size:0.9rem;color:#aaa;">
                <div style="width:28px;height:28px;background:rgba(47,191,113,0.4);border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:0.8rem;flex-shrink:0;">3</div>
                Crie sua primeira meta financeira
              </div>
            </div>
          </div>
          
          <button onclick="window.location.href='/app/dashboard'" class="btn-primary" style="font-size:1.1rem;padding:16px 48px;width:100%;justify-content:center;">
            <i class="fas fa-rocket"></i> Abrir meu Dashboard
          </button>
        </div>
      </div>
      <style>@keyframes bounceIn { 0%{transform:scale(0.3);opacity:0} 60%{transform:scale(1.1)} 100%{transform:scale(1);opacity:1} }</style>
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
    // Se hoje está no fechamento ou após → fatura do próximo mês
    // Se ainda não chegou no fechamento → fatura do mês atual
    let mesFatura = now.getMonth() + 1
    let anoFatura = now.getFullYear()
    if (diaFechamento && now.getDate() >= diaFechamento) {
      mesFatura++
      if (mesFatura > 12) { mesFatura = 1; anoFatura++ }
    }
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
    // Verifica se o plano tem acesso à IA
    if (this.limites !== null && !this.limites.ia_insights) {
      this.upsellModal('ia_insights')
      this.navigate('dashboard')
      return
    }
    document.getElementById('page-content').innerHTML = `
      <div class="section-header">
        <div>
          <div class="section-title">🧠 Análise com IA ✨</div>
          <div style="color:#666;font-size:0.85rem;margin-top:2px;">Insights personalizados sobre suas finanças</div>
        </div>
        <button onclick="VM.gerarInsightsIA()" class="btn-primary" style="width:auto;padding:10px 20px;">
          <i class="fas fa-sync"></i> Atualizar Análise
        </button>
      </div>
      <div id="ia-container">
        <div class="empty-state"><div class="skeleton" style="height:300px;border-radius:16px;"></div></div>
      </div>
    `
    this.carregarIA()
  },

  async carregarIA() {
    try {
      const data = await this.api('GET', 'ia/insights')
      const container = document.getElementById('ia-container')
      const insights = data.insights || []
      const dados = data.dados_base || {}

      // Score
      let score_saude = 50
      if (dados.receita_mes > 0) {
        const taxaDespesa = (dados.despesa_mes / dados.receita_mes) * 100
        const taxaPoupanca = ((dados.receita_mes - dados.despesa_mes) / dados.receita_mes) * 100
        const compDividas = dados.comprometimento_dividas || 0
        score_saude = Math.min(100, Math.max(0,
          50 + (taxaPoupanca > 20 ? 20 : taxaPoupanca) - (taxaDespesa > 70 ? 20 : 0) - (compDividas > 30 ? 15 : 0)
        ))
      }
      score_saude = Math.round(score_saude)

      const alertas = insights.filter(i => i.tipo === 'alerta')
      const sugestoes = insights.filter(i => i.tipo === 'sugestao' || i.tipo === 'dica')

      let regra_5030 = null
      if (dados.receita_mes > 0) {
        regra_5030 = {
          necessidades: Math.round((dados.despesa_mes / dados.receita_mes) * 70),
          desejos: Math.round((dados.despesa_mes / dados.receita_mes) * 30),
          poupanca: Math.round(((dados.receita_mes - dados.despesa_mes) / dados.receita_mes) * 100)
        }
      }

      const scoreColor = score_saude >= 70 ? '#2FBF71' : score_saude >= 40 ? '#ffc400' : '#ff6b6b'
      const scoreLabel = score_saude >= 80 ? 'Excelente 🏆' : score_saude >= 60 ? 'Bom 👍' : score_saude >= 40 ? 'Atenção ⚠️' : 'Crítico ❗'
      const prioColors = { alta: '#ff6b6b', media: '#ffc400', baixa: '#2FBF71' }

      container.innerHTML = `
        <!-- SCORE -->
        <div class="card" style="margin-bottom:24px;background:linear-gradient(135deg,rgba(47,191,113,0.08),rgba(32,128,64,0.05));">
          <div style="display:flex;align-items:center;gap:32px;flex-wrap:wrap;">
            <div style="position:relative;width:120px;height:120px;flex-shrink:0;">
              <svg viewBox="0 0 120 120" style="transform:rotate(-90deg)">
                <circle cx="60" cy="60" r="50" fill="none" stroke="rgba(255,255,255,0.08)" stroke-width="10"/>
                <circle cx="60" cy="60" r="50" fill="none" stroke="${scoreColor}" stroke-width="10"
                  stroke-dasharray="${2*Math.PI*50}" stroke-dashoffset="${2*Math.PI*50*(1-score_saude/100)}"
                  stroke-linecap="round"/>
              </svg>
              <div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;">
                <div style="font-size:1.8rem;font-weight:800;color:${scoreColor};">${score_saude}</div>
                <div style="font-size:0.65rem;color:#666;">/100</div>
              </div>
            </div>
            <div>
              <div style="font-size:1.3rem;font-weight:800;color:${scoreColor};margin-bottom:6px;">Score Financeiro: ${scoreLabel}</div>
              <p style="color:#888;font-size:0.9rem;line-height:1.6;max-width:500px;">
                Seu score é calculado com base em receitas, despesas, metas, investimentos e hábitos financeiros.
                ${score_saude >= 70 ? 'Continue assim! Você está no caminho certo.' : 'Siga as recomendações abaixo para melhorar seu score.'}
              </p>
              <div style="margin-top:12px;display:flex;gap:16px;flex-wrap:wrap;font-size:0.82rem;color:#666;">
                <span>💰 Receita: <strong style="color:#2FBF71;">${this.formatMoney(dados.receita_mes)}</strong></span>
                <span>💸 Despesa: <strong style="color:#ff6b6b;">${this.formatMoney(dados.despesa_mes)}</strong></span>
                <span>💳 Dívidas: <strong style="color:#ffc400;">${dados.comprometimento_dividas || 0}% da renda</strong></span>
              </div>
            </div>
          </div>
        </div>

        <!-- ANÁLISE FINANCEIRA PERSONALIZADA (bloco clicável) -->
        <div id="ia-analise-block" onclick="VM.solicitarAnaliseIA()" style="cursor:pointer;margin-bottom:24px;">
          <div class="card" style="border:1px solid rgba(47,191,113,0.3);background:linear-gradient(135deg,rgba(47,191,113,0.06),rgba(32,128,64,0.04));transition:all 0.2s;" 
               onmouseenter="this.style.borderColor='#2FBF71';this.style.transform='translateY(-2px)'" 
               onmouseleave="this.style.borderColor='rgba(47,191,113,0.3)';this.style.transform='none'">
            <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:16px;">
              <div style="display:flex;align-items:center;gap:16px;">
                <div style="width:52px;height:52px;background:linear-gradient(135deg,#2FBF71,#208040);border-radius:14px;display:flex;align-items:center;justify-content:center;font-size:1.5rem;flex-shrink:0;">🤖</div>
                <div>
                  <div style="font-size:1rem;font-weight:800;margin-bottom:4px;">Análise Financeira Personalizada</div>
                  <div style="font-size:0.82rem;color:#888;line-height:1.5;">Gerada por IA com base nos seus dados reais — receitas, despesas, metas e padrões de comportamento.</div>
                </div>
              </div>
              <div style="display:flex;align-items:center;gap:8px;color:#2FBF71;font-weight:600;font-size:0.88rem;flex-shrink:0;">
                <span id="ia-analise-status">Clique para gerar análise</span>
                <i class="fas fa-chevron-right" id="ia-analise-icon"></i>
              </div>
            </div>
            <div id="ia-analise-resultado" style="display:none;margin-top:20px;border-top:1px solid rgba(255,255,255,0.06);padding-top:20px;"></div>
          </div>
        </div>

        ${alertas.length > 0 ? `
          <div class="card" style="border-color:rgba(255,107,107,0.4);margin-bottom:24px;">
            <div style="font-size:1rem;font-weight:700;color:#ff6b6b;margin-bottom:16px;">🚨 Alertas Importantes</div>
            <div style="display:flex;flex-direction:column;gap:10px;">
              ${alertas.map(a => `
                <div style="display:flex;align-items:flex-start;gap:12px;padding:12px;background:rgba(255,80,80,0.06);border-radius:10px;">
                  <span style="font-size:1.2rem;flex-shrink:0;">⚠️</span>
                  <div>
                    <div style="font-weight:600;font-size:0.9rem;">${a.titulo}</div>
                    <div style="font-size:0.8rem;color:#888;margin-top:3px;line-height:1.5;">${a.conteudo}</div>
                  </div>
                </div>
              `).join('')}
            </div>
          </div>
        ` : ''}

        ${regra_5030 ? `
          <div class="card" style="margin-bottom:24px;">
            <div style="font-weight:700;margin-bottom:16px;">📐 Análise 50/30/20</div>
            <div style="color:#888;font-size:0.85rem;margin-bottom:16px;">Ideal: 50% necessidades • 30% desejos • 20% investimentos/poupança</div>
            <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:16px;">
              ${[
                { k: 'necessidades', l: '🏠 Necessidades', cor: '#74b9ff', ideal: 50 },
                { k: 'desejos', l: '🎬 Desejos', cor: '#a29bfe', ideal: 30 },
                { k: 'poupanca', l: '💰 Poupança/Inv.', cor: '#2FBF71', ideal: 20 }
              ].map(item => {
                const atual = regra_5030[item.k] || 0
                const ok = Math.abs(atual - item.ideal) <= 10
                return `
                  <div style="background:rgba(255,255,255,0.03);border-radius:12px;padding:16px;text-align:center;">
                    <div style="font-size:0.82rem;color:#888;margin-bottom:8px;">${item.l}</div>
                    <div style="font-size:1.6rem;font-weight:800;color:${ok ? item.cor : '#ff6b6b'};">${atual.toFixed(1)}%</div>
                    <div style="font-size:0.75rem;color:#555;">Meta: ${item.ideal}%</div>
                    <div style="margin-top:8px;background:rgba(255,255,255,0.08);border-radius:50px;height:4px;overflow:hidden;">
                      <div style="background:${ok ? item.cor : '#ff6b6b'};width:${Math.min(100,item.ideal > 0 ? atual/item.ideal*100 : 0)}%;height:100%;border-radius:50px;"></div>
                    </div>
                  </div>
                `
              }).join('')}
            </div>
          </div>
        ` : ''}

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:24px;">
          ${insights.length > 0 ? `
            <div class="card">
              <div style="font-weight:700;margin-bottom:16px;">💡 Insights do Mentor</div>
              <div style="display:flex;flex-direction:column;gap:12px;">
                ${insights.slice(0, 6).map(i => `
                  <div style="display:flex;gap:10px;padding:12px;background:rgba(255,255,255,0.02);border-radius:10px;border-left:3px solid ${prioColors[i.prioridade] || '#2FBF71'};">
                    <div>
                      <div style="font-weight:600;font-size:0.85rem;margin-bottom:3px;">${i.titulo}</div>
                      <div style="font-size:0.78rem;color:#777;line-height:1.5;">${i.conteudo}</div>
                    </div>
                  </div>
                `).join('')}
              </div>
            </div>
          ` : ''}

          <div class="card">
            <div style="font-weight:700;margin-bottom:16px;">🎯 Plano de Ação Rápido</div>
            <div style="display:flex;flex-direction:column;gap:12px;">
              ${sugestoes.slice(0,5).map((r, idx) => `
                <div style="display:flex;align-items:flex-start;gap:12px;">
                  <div style="width:28px;height:28px;background:linear-gradient(135deg,#2FBF71,#208040);border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:0.75rem;font-weight:700;flex-shrink:0;">${idx+1}</div>
                  <div style="font-size:0.85rem;color:#aaa;line-height:1.5;padding-top:4px;">${r.titulo}</div>
                </div>
              `).join('')}
            </div>
          </div>
        </div>

        <!-- SUGESTÕES PERSONALIZADAS (bloco clicável) -->
        <div id="ia-sugestoes-block" onclick="VM.solicitarSugestoesIA()" style="cursor:pointer;">
          <div class="card" style="border:1px solid rgba(162,155,254,0.3);background:linear-gradient(135deg,rgba(162,155,254,0.06),rgba(116,185,255,0.04));transition:all 0.2s;"
               onmouseenter="this.style.borderColor='#a29bfe';this.style.transform='translateY(-2px)'"
               onmouseleave="this.style.borderColor='rgba(162,155,254,0.3)';this.style.transform='none'">
            <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:16px;">
              <div style="display:flex;align-items:center;gap:16px;">
                <div style="width:52px;height:52px;background:linear-gradient(135deg,#a29bfe,#74b9ff);border-radius:14px;display:flex;align-items:center;justify-content:center;font-size:1.5rem;flex-shrink:0;">✨</div>
                <div>
                  <div style="font-size:1rem;font-weight:800;margin-bottom:4px;">Sugestões Personalizadas</div>
                  <div style="font-size:0.82rem;color:#888;line-height:1.5;">Recomendações exclusivas atualizadas com base no seu perfil e comportamento financeiro atual.</div>
                </div>
              </div>
              <div style="display:flex;align-items:center;gap:8px;color:#a29bfe;font-weight:600;font-size:0.88rem;flex-shrink:0;">
                <span id="ia-sugestoes-status">Clique para ver sugestões</span>
                <i class="fas fa-chevron-right" id="ia-sugestoes-icon"></i>
              </div>
            </div>
            <div id="ia-sugestoes-resultado" style="display:none;margin-top:20px;border-top:1px solid rgba(255,255,255,0.06);padding-top:20px;"></div>
          </div>
        </div>
      `
    } catch (e) {
      const container = document.getElementById('ia-container')
      container.innerHTML = `
        <div class="card" style="text-align:center;padding:60px 40px;">
          <div style="font-size:3rem;margin-bottom:16px;">🧠</div>
          <h3 style="margin-bottom:8px;">Análise Indisponível</h3>
          <p style="color:#666;margin-bottom:24px;">Adicione receitas e despesas para ativar a análise com IA</p>
          <button onclick="VM.navigate('receitas')" class="btn-primary" style="width:auto;padding:10px 24px;">
            <i class="fas fa-plus"></i> Adicionar Receitas
          </button>
        </div>
      `
    }
  },

  async solicitarAnaliseIA() {
    const resultado = document.getElementById('ia-analise-resultado')
    const status = document.getElementById('ia-analise-status')
    const icon = document.getElementById('ia-analise-icon')
    if (!resultado) return

    // Toggle: se já está aberto, fechar
    if (resultado.style.display === 'block') {
      resultado.style.display = 'none'
      status.textContent = 'Clique para gerar análise'
      icon.className = 'fas fa-chevron-right'
      return
    }

    // Mostrar loading
    resultado.style.display = 'block'
    status.textContent = 'Gerando análise...'
    icon.className = 'fas fa-spinner fa-spin'
    resultado.innerHTML = `
      <div style="display:flex;align-items:center;gap:12px;color:#888;">
        <i class="fas fa-spinner fa-spin" style="color:#2FBF71;"></i>
        <span>Analisando seus dados financeiros...</span>
      </div>
    `

    try {
      const data = await this.api('GET', 'ia/insights')
      const dados = data.dados_base || {}
      const insights = data.insights || []

      // Montar análise personalizada com os dados reais
      const poupanca = dados.receita_mes > 0 ? ((dados.receita_mes - dados.despesa_mes) / dados.receita_mes * 100).toFixed(1) : 0
      const topInsights = insights.slice(0, 4)
      const analise = [
        { titulo: '📊 Panorama Financeiro', texto: `No mês atual, suas receitas somam <strong>${this.formatMoney(dados.receita_mes)}</strong> e as despesas <strong>${this.formatMoney(dados.despesa_mes)}</strong>. Sua taxa de poupança é de <strong>${poupanca}%</strong> da renda — ${parseFloat(poupanca) >= 20 ? 'acima da meta recomendada de 20% ✅' : 'abaixo da meta recomendada de 20% ⚠️'}.` },
        { titulo: '🎯 Metas & Objetivos', texto: `Você tem <strong>${dados.total_metas || 0} metas ativas</strong>. ${dados.total_metas > 0 ? 'Continue monitorando o progresso regularmente e faça aportes mensais para manter o ritmo.' : 'Defina pelo menos uma meta financeira para orientar seus esforços.'}` },
        { titulo: '📈 Investimentos', texto: `Valor investido: <strong>${this.formatMoney(dados.total_investimentos || 0)}</strong>. ${dados.total_investimentos > 0 ? 'Mantenha a regularidade nos aportes — consistência é mais importante que valores altos.' : 'Comece a investir, mesmo que pequenas quantias mensais fazem diferença no longo prazo.'}` },
        { titulo: '💳 Compromissos Financeiros', texto: `Seu comprometimento com dívidas é de <strong>${dados.comprometimento_dividas || 0}%</strong> da renda. ${(dados.comprometimento_dividas || 0) <= 30 ? 'Está dentro do limite saudável (até 30%) ✅' : 'Acima do recomendado — priorize quitar as dívidas com juros mais altos ⚠️'}.` }
      ]

      status.textContent = 'Análise gerada ✓'
      icon.className = 'fas fa-chevron-up'
      resultado.innerHTML = `
        <div style="display:flex;flex-direction:column;gap:16px;">
          ${analise.map(a => `
            <div style="padding:14px;background:rgba(47,191,113,0.04);border-radius:10px;border-left:3px solid #2FBF71;">
              <div style="font-weight:700;font-size:0.9rem;margin-bottom:6px;">${a.titulo}</div>
              <div style="font-size:0.82rem;color:#aaa;line-height:1.7;">${a.texto}</div>
            </div>
          `).join('')}
          ${topInsights.length > 0 ? `
            <div style="padding:14px;background:rgba(255,255,255,0.03);border-radius:10px;">
              <div style="font-weight:700;font-size:0.9rem;margin-bottom:10px;">🔍 Principais Alertas & Recomendações</div>
              <div style="display:flex;flex-direction:column;gap:8px;">
                ${topInsights.map(i => `<div style="font-size:0.8rem;color:#888;padding-left:12px;border-left:2px solid ${i.tipo==='alerta'?'#ff6b6b':'#2FBF71'};">• ${i.titulo}</div>`).join('')}
              </div>
            </div>
          ` : ''}
          <div style="font-size:0.75rem;color:#555;text-align:right;">Gerado em ${new Date().toLocaleString('pt-BR')}</div>
        </div>
      `
    } catch(e) {
      resultado.innerHTML = `<div style="color:#ff6b6b;font-size:0.85rem;">Erro ao gerar análise. Tente novamente.</div>`
      status.textContent = 'Clique para tentar novamente'
      icon.className = 'fas fa-chevron-right'
    }
  },

  async solicitarSugestoesIA() {
    const resultado = document.getElementById('ia-sugestoes-resultado')
    const status = document.getElementById('ia-sugestoes-status')
    const icon = document.getElementById('ia-sugestoes-icon')
    if (!resultado) return

    if (resultado.style.display === 'block') {
      resultado.style.display = 'none'
      status.textContent = 'Clique para ver sugestões'
      icon.className = 'fas fa-chevron-right'
      return
    }

    resultado.style.display = 'block'
    status.textContent = 'Gerando sugestões...'
    icon.className = 'fas fa-spinner fa-spin'
    resultado.innerHTML = `
      <div style="display:flex;align-items:center;gap:12px;color:#888;">
        <i class="fas fa-spinner fa-spin" style="color:#a29bfe;"></i>
        <span>Elaborando sugestões personalizadas...</span>
      </div>
    `

    try {
      const data = await this.api('GET', 'ia/insights')
      const dados = data.dados_base || {}
      const insights = data.insights || []
      const saldo = dados.receita_mes - dados.despesa_mes

      const sugestoesMap = [
        {
          icon: '💰',
          cor: '#2FBF71',
          titulo: 'Aporte mensal recomendado',
          texto: saldo > 0
            ? `Com saldo disponível de <strong>${this.formatMoney(saldo)}</strong>, direcione pelo menos <strong>${this.formatMoney(saldo * 0.5)}</strong> para investimentos ou metas prioritárias.`
            : 'Revise suas despesas para liberar saldo positivo antes de pensar em investir.'
        },
        {
          icon: '🎯',
          cor: '#74b9ff',
          titulo: 'Foco nas metas',
          texto: dados.total_metas > 0
            ? `Distribua contribuições mensais entre suas ${dados.total_metas} metas. Priorize as com prazo mais próximo.`
            : 'Crie uma meta de emergência com valor de 3 a 6 meses de despesas fixas.'
        },
        {
          icon: '📉',
          cor: '#ffc400',
          titulo: 'Controle de gastos',
          texto: (dados.despesa_mes / dados.receita_mes) > 0.7
            ? 'Seus gastos superam 70% da renda. Identifique 2 ou 3 categorias para reduzir em 10% no próximo mês.'
            : 'Seus gastos estão controlados. Mantenha o registro das despesas para não perder o controle.'
        },
        {
          icon: '🔄',
          cor: '#fd79a8',
          titulo: 'Revisão periódica',
          texto: 'Reserve 30 minutos a cada quinzena para revisar lançamentos e ajustar previsões. Pequenos desvios corrigidos cedo evitam grandes problemas.'
        },
        ...insights.filter(i => i.tipo === 'sugestao').slice(0, 3).map(s => ({
          icon: '✅',
          cor: '#2FBF71',
          titulo: s.titulo,
          texto: s.conteudo
        }))
      ]

      status.textContent = 'Sugestões atualizadas ✓'
      icon.className = 'fas fa-chevron-up'
      resultado.innerHTML = `
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
          ${sugestoesMap.slice(0, 6).map(s => `
            <div style="padding:14px;background:rgba(255,255,255,0.03);border-radius:12px;border-left:3px solid ${s.cor};">
              <div style="font-size:1.1rem;margin-bottom:6px;">${s.icon}</div>
              <div style="font-weight:700;font-size:0.85rem;margin-bottom:6px;">${s.titulo}</div>
              <div style="font-size:0.78rem;color:#888;line-height:1.6;">${s.texto}</div>
            </div>
          `).join('')}
        </div>
        <div style="font-size:0.75rem;color:#555;text-align:right;margin-top:12px;">Atualizado em ${new Date().toLocaleString('pt-BR')}</div>
      `
    } catch(e) {
      resultado.innerHTML = `<div style="color:#ff6b6b;font-size:0.85rem;">Erro ao carregar sugestões. Tente novamente.</div>`
      status.textContent = 'Clique para tentar novamente'
      icon.className = 'fas fa-chevron-right'
    }
  },

  async gerarInsightsIA() {
    this.toast('Atualizando análise...', 'info')
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
    const cor = rarColors[conquista.raridade] || '#10B981'
    const isEpic = ['EPICO','LENDARIO'].includes(conquista.raridade)

    const el = document.createElement('div')
    el.style.cssText = `
      position:fixed;top:20px;right:20px;z-index:99999;
      background:rgba(15,23,42,0.95);border:1px solid ${cor};
      border-radius:14px;padding:16px 20px;min-width:280px;max-width:340px;
      box-shadow:0 8px 32px rgba(0,0,0,0.5),0 0 0 1px ${cor}22;
      display:flex;align-items:center;gap:14px;
      animation:slideInRight 0.4s cubic-bezier(0.175,0.885,0.32,1.275);
      backdrop-filter:blur(20px);
    `
    el.innerHTML = `
      <div style="font-size:2.2rem;filter:drop-shadow(0 0 8px ${cor});">${conquista.icone}</div>
      <div style="flex:1;">
        <div style="font-size:0.65rem;color:${cor};font-weight:700;text-transform:uppercase;letter-spacing:1px;margin-bottom:2px;">🏆 Conquista Desbloqueada!</div>
        <div style="font-size:0.9rem;font-weight:700;color:#f8fafc;">${conquista.titulo}</div>
        <div style="font-size:0.75rem;color:#94a3b8;margin-top:2px;">${conquista.descricao}</div>
        <div style="font-size:0.7rem;color:${cor};font-weight:600;margin-top:4px;">+${conquista.pontos} pontos · ${conquista.raridade}</div>
      </div>
    `
    if (!document.getElementById('conq-toast-style')) {
      const style = document.createElement('style')
      style.id = 'conq-toast-style'
      style.textContent = `
        @keyframes slideInRight { from{transform:translateX(100%);opacity:0} to{transform:translateX(0);opacity:1} }
        @keyframes slideOutRight { from{transform:translateX(0);opacity:1} to{transform:translateX(100%);opacity:0} }
      `
      document.head.appendChild(style)
    }
    document.body.appendChild(el)
    setTimeout(() => {
      el.style.animation = 'slideOutRight 0.4s ease forwards'
      setTimeout(() => el.remove(), 400)
    }, 4500)
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
  }
}

// Init
document.addEventListener('DOMContentLoaded', () => VM.init())
