// VerdeMais - Frontend SPA Engine
// ==========================================

const VM = {
  token: null,
  user: null,
  currentPage: null,
  charts: {},

  init() {
    this.token = localStorage.getItem('vm_token')
    const userStr = localStorage.getItem('vm_user')
    if (userStr) this.user = JSON.parse(userStr)
    
    const path = window.location.pathname
    if (path === '/login') return this.renderLogin()
    if (path === '/cadastro') return this.renderCadastro()
    if (path === '/' || path === '') return window.location.href = '/'
    if (path.startsWith('/app')) {
      if (!this.token) return window.location.href = '/login'
      this.renderApp()
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
        <div class="auth-card">
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
              <input type="text" id="cad-nome" class="form-input" placeholder="Seu nome" required>
            </div>
            <div class="form-group">
              <label class="form-label">Email</label>
              <input type="email" id="cad-email" class="form-input" placeholder="seu@email.com" required>
            </div>
            <div class="form-group">
              <label class="form-label">Senha (mínimo 6 caracteres)</label>
              <input type="password" id="cad-senha" class="form-input" placeholder="••••••••" required minlength="6">
            </div>
            <button type="submit" class="btn-primary" id="cad-btn">
              <i class="fas fa-user-plus"></i> Criar conta grátis
            </button>
          </form>
          
          <div style="text-align:center;margin-top:24px;color:#666;font-size:0.82rem;line-height:1.6;">
            Ao criar conta você concorda com os <a href="#" style="color:#2FBF71;">Termos de Uso</a> e 
            <a href="#" style="color:#2FBF71;">Política de Privacidade</a>
          </div>
          <div style="text-align:center;margin-top:16px;color:#666;font-size:0.88rem;">
            Já tem conta? <a href="/login" style="color:#2FBF71;text-decoration:none;font-weight:600;">Entrar</a>
          </div>
        </div>
      </div>
    `

    document.getElementById('cadastro-form').addEventListener('submit', async (e) => {
      e.preventDefault()
      const btn = document.getElementById('cad-btn')
      const errEl = document.getElementById('auth-error')
      btn.disabled = true
      btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Criando conta...'
      errEl.style.display = 'none'

      try {
        const res = await axios.post('/api/auth/register', {
          nome: document.getElementById('cad-nome').value,
          email: document.getElementById('cad-email').value,
          senha: document.getElementById('cad-senha').value
        })
        localStorage.setItem('vm_token', res.data.token)
        localStorage.setItem('vm_user', JSON.stringify(res.data.user))
        window.location.href = '/app'
      } catch (e) {
        errEl.textContent = e.response?.data?.error || 'Erro ao criar conta'
        errEl.style.display = 'block'
        btn.disabled = false
        btn.innerHTML = '<i class="fas fa-user-plus"></i> Criar conta grátis'
      }
    })
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
          
          <nav>
            <a class="nav-item active" id="nav-dashboard" onclick="VM.navigate('dashboard')">
              <span class="nav-icon"><i class="fas fa-chart-pie"></i></span> Dashboard
            </a>
            <a class="nav-item" id="nav-receitas" onclick="VM.navigate('receitas')">
              <span class="nav-icon"><i class="fas fa-arrow-up"></i></span> Receitas
            </a>
            <a class="nav-item" id="nav-despesas" onclick="VM.navigate('despesas')">
              <span class="nav-icon"><i class="fas fa-arrow-down"></i></span> Despesas
            </a>
            <a class="nav-item" id="nav-metas" onclick="VM.navigate('metas')">
              <span class="nav-icon"><i class="fas fa-bullseye"></i></span> Metas
            </a>
            <a class="nav-item" id="nav-investimentos" onclick="VM.navigate('investimentos')">
              <span class="nav-icon"><i class="fas fa-chart-line"></i></span> Investimentos
            </a>
            <a class="nav-item" id="nav-relatorios" onclick="VM.navigate('relatorios')">
              <span class="nav-icon"><i class="fas fa-file-alt"></i></span> Relatórios
            </a>
            <a class="nav-item" id="nav-simulacao" onclick="VM.navigate('simulacao')">
              <span class="nav-icon"><i class="fas fa-calculator"></i></span> Simulações
            </a>
          </nav>
          
          <div class="sidebar-user" onclick="VM.navigate('perfil')">
            <div style="display:flex;align-items:center;gap:10px;">
              <div style="width:36px;height:36px;background:${avatarColor};border-radius:10px;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:0.9rem;">${initials}</div>
              <div style="flex:1;min-width:0;">
                <div style="font-size:0.85rem;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${userName}</div>
                <div style="font-size:0.72rem;color:#666;">${this.user?.plano || 'Free'}</div>
              </div>
              <i class="fas fa-ellipsis-v" style="color:#555;font-size:0.75rem;"></i>
            </div>
          </div>
        </aside>

        <!-- MAIN -->
        <div class="main-content">
          <header class="topbar">
            <div style="display:flex;align-items:center;gap:16px;">
              <button onclick="document.getElementById('sidebar').classList.toggle('open')" 
                style="background:none;border:none;color:#888;font-size:1.1rem;cursor:pointer;display:none;" id="menu-btn">
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
                <i class="fas fa-sign-out-alt"></i> Sair
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

    // Responsive
    if (window.innerWidth <= 768) {
      document.getElementById('menu-btn').style.display = 'block'
    }
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
      metas: ['Metas Financeiras', 'Seus objetivos e conquistas'],
      investimentos: ['Investimentos', 'Patrimônio e rentabilidade'],
      relatorios: ['Relatórios', 'Análise detalhada'],
      simulacao: ['Simulações', 'Projeções de investimento'],
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
      metas: () => this.pageMetas(),
      investimentos: () => this.pageInvestimentos(),
      relatorios: () => this.pageRelatorios(),
      simulacao: () => this.pageSimulacao(),
      perfil: () => this.pagePerfil()
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
      const { resumo, score_saude, metas, evolucao, categorias_despesas, ultimas_transacoes, proximos_vencimentos } = data

      const scoreColor = score_saude >= 70 ? '#2FBF71' : score_saude >= 40 ? '#ffc400' : '#ff6b6b'
      const scoreLabel = score_saude >= 80 ? 'Excelente! 🏆' : score_saude >= 60 ? 'Boa saúde 👍' : score_saude >= 40 ? 'Atenção ⚠️' : 'Crítico ❗'

      content.innerHTML = `
        <!-- STATS ROW -->
        <div class="grid-4" style="margin-bottom:24px;">
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

        <!-- MAIN ROW -->
        <div style="display:grid;grid-template-columns:1fr 1fr 320px;gap:20px;margin-bottom:24px;">
          
          <!-- EVOLUÇÃO -->
          <div class="card" style="grid-column:1/3;">
            <div style="font-size:1rem;font-weight:700;margin-bottom:20px;">📊 Evolução dos Últimos 6 Meses</div>
            <div style="height:220px;"><canvas id="chart-evolucao"></canvas></div>
          </div>
          
          <!-- SCORE -->
          <div class="card" style="display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;">
            <div style="font-size:0.85rem;color:#888;margin-bottom:16px;">🧠 Score de Saúde Financeira</div>
            <div style="position:relative;width:140px;height:140px;margin-bottom:16px;">
              <svg viewBox="0 0 140 140" style="transform:rotate(-90deg)">
                <circle cx="70" cy="70" r="58" fill="none" stroke="rgba(255,255,255,0.08)" stroke-width="12"/>
                <circle cx="70" cy="70" r="58" fill="none" stroke="${scoreColor}" stroke-width="12"
                  stroke-dasharray="${2 * Math.PI * 58}" stroke-dashoffset="${2 * Math.PI * 58 * (1 - score_saude / 100)}"
                  stroke-linecap="round" style="transition:stroke-dashoffset 1s ease;"/>
              </svg>
              <div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;">
                <div style="font-size:2rem;font-weight:800;color:${scoreColor};">${score_saude}</div>
                <div style="font-size:0.7rem;color:#666;">/ 100</div>
              </div>
            </div>
            <div style="font-weight:600;color:${scoreColor};">${scoreLabel}</div>
            ${metas.ativas > 0 ? `<div style="margin-top:16px;font-size:0.78rem;color:#666;">${metas.ativas} meta${metas.ativas > 1 ? 's' : ''} ativa${metas.ativas > 1 ? 's' : ''}</div>` : ''}
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
      `

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
      await this.api('PATCH', `despesas/${id}/status`, { status: novoStatus })
      this.toast(`Status: ${novoStatus}!`)
      this.carregarDespesas()
    } catch (e) {
      this.toast('Erro ao atualizar', 'error')
    }
  },

  modalDespesa(despesa = null) {
    const isEdit = !!despesa
    const today = new Date().toISOString().split('T')[0]
    const categorias = ['Alimentação', 'Transporte', 'Saúde', 'Educação', 'Lazer', 'Moradia', 'Roupas', 'Assinaturas', 'Pets', 'Outros']

    document.getElementById('modal-container').innerHTML = `
      <div class="modal-overlay" onclick="VM.closeModal(event)">
        <div class="modal">
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
                <label class="form-label">Valor Total (R$) *</label>
                <input type="number" id="d-valor" class="form-input" placeholder="0,00" step="0.01" min="0" value="${despesa?.valor || ''}" required>
              </div>
              <div class="form-group">
                <label class="form-label">Tipo</label>
                <select id="d-tipo" class="form-select">
                  <option value="variavel" ${despesa?.fixa_ou_variavel !== 'fixa' ? 'selected' : ''}>Variável</option>
                  <option value="fixa" ${despesa?.fixa_ou_variavel === 'fixa' ? 'selected' : ''}>Fixa</option>
                </select>
              </div>
            </div>
            ${!isEdit ? `
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
                <div class="form-group">
                  <label class="form-label">Parcelado?</label>
                  <select id="d-parcelado" class="form-select" onchange="document.getElementById('d-parcelas-wrapper').style.display=this.value==='1'?'block':'none'">
                    <option value="0">Não</option>
                    <option value="1">Sim</option>
                  </select>
                </div>
                <div class="form-group" id="d-parcelas-wrapper" style="display:none;">
                  <label class="form-label">Nº de Parcelas</label>
                  <input type="number" id="d-parcelas" class="form-input" min="2" max="60" value="2" placeholder="Ex: 12">
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

    document.getElementById('despesa-form').addEventListener('submit', async (e) => {
      e.preventDefault()
      const btn = document.getElementById('d-submit')
      btn.disabled = true
      btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Salvando...'
      try {
        const parcelado = !isEdit && document.getElementById('d-parcelado')?.value === '1'
        const payload = {
          descricao: document.getElementById('d-desc').value,
          categoria: document.getElementById('d-cat').value,
          data: document.getElementById('d-data').value,
          valor: parseFloat(document.getElementById('d-valor').value),
          fixa_ou_variavel: document.getElementById('d-tipo').value,
          status: document.getElementById('d-status').value,
          vencimento: document.getElementById('d-venc').value || null,
          parcelado,
          numero_parcelas: parcelado ? parseInt(document.getElementById('d-parcelas').value) : 1
        }
        if (isEdit) await this.api('PUT', `despesas/${despesa.id}`, payload)
        else await this.api('POST', 'despesas', payload)
        this.toast(isEdit ? 'Despesa atualizada!' : (parcelado ? `${payload.numero_parcelas} parcelas criadas! 💸` : 'Despesa adicionada!'))
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

  modalMeta(meta = null) {
    const isEdit = !!meta
    const today = new Date()
    const future = new Date(today); future.setFullYear(future.getFullYear() + 1)
    const defaultDate = future.toISOString().split('T')[0]
    const cores = ['#2FBF71', '#208040', '#74b9ff', '#a29bfe', '#fd79a8', '#ffc400', '#ff8c42', '#00cec9']

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
        const payload = {
          nome: document.getElementById('m-nome').value,
          descricao: document.getElementById('m-desc').value,
          valor_objetivo: parseFloat(document.getElementById('m-obj').value),
          valor_atual: parseFloat(document.getElementById('m-atual').value) || 0,
          data_meta: document.getElementById('m-data').value,
          cor: document.getElementById('m-cor').value,
          status: meta?.status || 'ativa'
        }
        if (isEdit) await this.api('PUT', `metas/${meta.id}`, payload)
        else await this.api('POST', 'metas', payload)
        this.toast(isEdit ? 'Meta atualizada!' : 'Meta criada! 🎯')
        this.closeModal(); this.carregarMetas()
      } catch (err) {
        this.toast(err.response?.data?.error || 'Erro ao salvar', 'error')
        btn.disabled = false; btn.innerHTML = `<i class="fas fa-save"></i> ${isEdit ? 'Salvar' : 'Criar Meta'}`
      }
    })
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

      const tipoLabels = { tesouro_direto: 'Tesouro Direto', cdb: 'CDB', lci: 'LCI', lca: 'LCA', acoes: 'Ações', fii: 'FII', cripto: 'Cripto', poupanca: 'Poupança', outros: 'Outros' }
      const tipoEmojis = { tesouro_direto: '🏛️', cdb: '🏦', lci: '📋', lca: '🌱', acoes: '📊', fii: '🏢', cripto: '₿', poupanca: '🐷', outros: '💼' }
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
                ${investimentos.map(inv => `
                  <tr>
                    <td>
                      <div style="font-weight:600;">${inv.nome}</div>
                      ${inv.instituicao ? `<div style="font-size:0.75rem;color:#666;">${inv.instituicao}</div>` : ''}
                    </td>
                    <td>${tipoEmojis[inv.tipo] || '💼'} ${tipoLabels[inv.tipo] || inv.tipo}</td>
                    <td><span class="badge" style="background:${riscoColors[inv.risco] || '#888'}22;color:${riscoColors[inv.risco] || '#888'};border:1px solid ${riscoColors[inv.risco] || '#888'}44;">${inv.risco}</span></td>
                    <td style="text-align:right;">${this.formatMoney(inv.valor_investido)}</td>
                    <td style="text-align:right;font-weight:600;color:#2FBF71;">${this.formatMoney(inv.valor_atual || inv.valor_investido)}</td>
                    <td style="text-align:right;font-weight:600;${inv.rentabilidade_percentual >= 0 ? 'color:#2FBF71' : 'color:#ff6b6b'};">${inv.rentabilidade_percentual}%</td>
                    <td style="text-align:right;">
                      <button onclick="VM.modalInvestimento(${JSON.stringify(inv).replace(/"/g, '&quot;')})" class="btn-success" style="margin-right:4px;"><i class="fas fa-edit"></i></button>
                      <button onclick="VM.deleteInvestimento(${inv.id})" class="btn-danger"><i class="fas fa-trash"></i></button>
                    </td>
                  </tr>
                `).join('')}
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
    const tipos = ['tesouro_direto', 'cdb', 'lci', 'lca', 'acoes', 'fii', 'cripto', 'poupanca', 'outros']
    const tipoLabels = { tesouro_direto: 'Tesouro Direto', cdb: 'CDB', lci: 'LCI', lca: 'LCA', acoes: 'Ações', fii: 'FII', cripto: 'Cripto', poupanca: 'Poupança', outros: 'Outros' }

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
                <select id="i-tipo" class="form-select">
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
              <div class="form-group">
                <label class="form-label">Rentabilidade (%)</label>
                <input type="number" id="i-rent" class="form-input" placeholder="0,00" step="0.01" value="${inv?.rentabilidade_percentual || 0}">
              </div>
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
              <input type="text" id="i-inst" class="form-input" placeholder="Ex: Banco do Brasil, Nubank..." value="${inv?.instituicao || ''}">
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

    document.getElementById('inv-form').addEventListener('submit', async (e) => {
      e.preventDefault()
      const btn = document.getElementById('i-submit')
      btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Salvando...'
      try {
        const valorInv = parseFloat(document.getElementById('i-valor').value)
        const rent = parseFloat(document.getElementById('i-rent').value) || 0
        const payload = {
          nome: document.getElementById('i-nome').value,
          tipo: document.getElementById('i-tipo').value,
          risco: document.getElementById('i-risco').value,
          valor_investido: valorInv,
          rentabilidade_percentual: rent,
          valor_atual: isEdit ? valorInv * (1 + rent / 100) : undefined,
          data_inicio: document.getElementById('i-inicio').value,
          data_vencimento: document.getElementById('i-venc').value || null,
          instituicao: document.getElementById('i-inst').value || null
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
  pagePerfil() {
    const user = this.user || {}
    const planoColors = { free: '#888', premium: '#2FBF71', pro: '#a29bfe' }
    const planoIcons = { free: '🌱', premium: '💎', pro: '🚀' }

    document.getElementById('page-content').innerHTML = `
      <div style="max-width:600px;">
        <div class="card" style="margin-bottom:20px;">
          <div style="display:flex;align-items:center;gap:20px;margin-bottom:24px;">
            <div style="width:72px;height:72px;background:${user.avatar_color || '#2FBF71'};border-radius:20px;display:flex;align-items:center;justify-content:center;font-size:1.8rem;font-weight:700;">
              ${(user.nome || 'U').split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase()}
            </div>
            <div>
              <div style="font-size:1.3rem;font-weight:700;">${user.nome || '-'}</div>
              <div style="color:#888;font-size:0.9rem;">${user.email || '-'}</div>
              <div style="margin-top:8px;">
                <span class="badge" style="background:${planoColors[user.plano] || '#888'}22;color:${planoColors[user.plano] || '#888'};border:1px solid ${planoColors[user.plano] || '#888'}44;font-size:0.8rem;padding:5px 14px;">
                  ${planoIcons[user.plano] || '🌱'} Plano ${(user.plano || 'Free').charAt(0).toUpperCase() + (user.plano || 'free').slice(1)}
                </span>
              </div>
            </div>
          </div>

          <div style="padding:16px;background:rgba(47,191,113,0.06);border:1px solid rgba(47,191,113,0.15);border-radius:12px;font-size:0.88rem;color:#888;line-height:1.7;">
            🔐 Para alterar dados pessoais como nome, email ou senha, entre em contato com o suporte.<br>
            📧 contato@verdemais.app
          </div>
        </div>

        <div class="card" style="margin-bottom:20px;">
          <div style="font-weight:700;margin-bottom:16px;">📊 Meu Plano</div>
          <div style="display:grid;gap:12px;">
            ${['free', 'premium', 'pro'].map(p => {
              const isAtual = user.plano === p
              const features = {
                free: ['Dashboard básico', 'Controle financeiro', 'Até 3 metas', 'Relatório mensal'],
                premium: ['Tudo do Free', 'Score financeiro', 'Metas ilimitadas', 'Simulações', 'Relatórios avançados'],
                pro: ['Tudo do Premium', 'IA financeira', 'Projeção 5 anos', 'Regra 50/30/20', 'API access']
              }
              const precos = { free: 'Grátis', premium: 'R$ 19/mês', pro: 'R$ 49/mês' }
              return `
                <div style="padding:16px;border-radius:12px;border:1px solid ${isAtual ? planoColors[p] : 'rgba(255,255,255,0.08)'};background:${isAtual ? `${planoColors[p]}11` : 'transparent'};">
                  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                    <div style="font-weight:700;">${planoIcons[p]} ${p.charAt(0).toUpperCase() + p.slice(1)}</div>
                    <div style="display:flex;align-items:center;gap:8px;">
                      <div style="font-size:0.9rem;font-weight:600;">${precos[p]}</div>
                      ${isAtual ? `<span class="badge badge-green" style="font-size:0.7rem;">Atual</span>` : ''}
                    </div>
                  </div>
                  <div style="display:flex;flex-wrap:wrap;gap:6px;">
                    ${features[p].map(f => `<span style="font-size:0.75rem;color:#888;">✓ ${f}</span>`).join(' ')}
                  </div>
                </div>
              `
            }).join('')}
          </div>
        </div>

        <button onclick="VM.logout()" class="btn-danger" style="width:100%;display:flex;align-items:center;justify-content:center;gap:8px;padding:12px;">
          <i class="fas fa-sign-out-alt"></i> Sair da conta
        </button>
      </div>
    `
  },

  closeModal(event) {
    if (event && event.target !== event.currentTarget) return
    document.getElementById('modal-container').innerHTML = ''
  }
}

// Init
document.addEventListener('DOMContentLoaded', () => VM.init())
