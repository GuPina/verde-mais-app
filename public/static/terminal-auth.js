(function () {
  const logo = (dark) => `
    <a class="terminal-logo" href="/" aria-label="VerdeMais — início">
      <img src="/static/verdemais-terminal-mark-${dark ? 'dark' : 'green'}.svg" alt="">
      <span>verde<span>mais</span></span>
    </a>`

  const togglePassword = (input, button) => {
    const visible = input.type === 'text'
    input.type = visible ? 'password' : 'text'
    button.innerHTML = `<i class="fas ${visible ? 'fa-eye' : 'fa-eye-slash'}" aria-hidden="true"></i>`
    button.setAttribute('aria-label', visible ? 'Mostrar senha' : 'Ocultar senha')
  }

  const authShell = ({ eyebrow, title, titleEmphasis, story, form }) => `
    <div class="terminal-auth">
      <aside class="terminal-auth__story">
        ${logo(true)}
        <img class="terminal-auth__watermark" src="/static/verdemais-terminal-mark-dark.svg" alt="">
        <div class="terminal-auth__story-copy">
          <div class="terminal-auth__eyebrow">${eyebrow}</div>
          <h1>${title}<br><em>${titleEmphasis}</em></h1>
          <p>${story}</p>
        </div>
        <div class="terminal-auth__trust">
          <span><i class="fas fa-shield-halved" aria-hidden="true"></i> Senha protegida</span>
          <span>·</span>
          <span>Verificação por OTP</span>
        </div>
      </aside>
      <main class="terminal-auth__form-side">
        <div class="terminal-auth__form">
          <div class="terminal-auth__mobile-logo">${logo(false)}</div>
          ${form}
        </div>
      </main>
    </div>`

  window.VMTerminalAuth = {
    renderLogin(vm) {
      document.getElementById('app').innerHTML = authShell({
        eyebrow: 'Você chegou',
        title: 'Bem-vindo,',
        titleEmphasis: 'plantador.',
        story: 'Seu painel continua esperando por você. Volte para acompanhar escolhas, metas e conquistas com mais clareza.',
        form: `
          <div class="terminal-auth__eyebrow">Entrar na sua conta</div>
          <h2>Bom te ver de novo.</h2>
          <p class="terminal-auth__sub">Acesse seu painel para continuar de onde parou.</p>
          <div id="auth-error" class="terminal-alert" role="alert" aria-live="polite"></div>
          <form id="login-form">
            <div class="terminal-field">
              <label class="terminal-field__label" for="login-email">E-mail</label>
              <div class="terminal-field__input">
                <i class="fas fa-envelope" aria-hidden="true"></i>
                <input type="email" id="login-email" autocomplete="email" placeholder="seu@email.com" required>
              </div>
            </div>
            <div class="terminal-field">
              <label class="terminal-field__label" for="login-senha">Senha</label>
              <div class="terminal-field__input">
                <i class="fas fa-lock" aria-hidden="true"></i>
                <input type="password" id="login-senha" autocomplete="current-password" placeholder="Sua senha" required>
                <button class="terminal-field__action" type="button" id="login-eye" aria-label="Mostrar senha"><i class="fas fa-eye" aria-hidden="true"></i></button>
              </div>
            </div>
            <button class="terminal-btn terminal-btn--primary terminal-btn--large terminal-auth__submit" type="submit" id="login-btn">Entrar <i class="fas fa-arrow-right" aria-hidden="true"></i></button>
          </form>
          <div class="terminal-auth__switch">Novo por aqui? <a href="/cadastro">Criar conta grátis</a></div>
          <div class="terminal-auth__meta">Acesso protegido por limite de tentativas e sessão autenticada.</div>
          <a class="terminal-back" href="/"><i class="fas fa-arrow-left" aria-hidden="true"></i> Voltar ao site</a>`
      })

      const password = document.getElementById('login-senha')
      const eye = document.getElementById('login-eye')
      eye.addEventListener('click', () => togglePassword(password, eye))

      document.getElementById('login-form').addEventListener('submit', async (event) => {
        event.preventDefault()
        const button = document.getElementById('login-btn')
        const error = document.getElementById('auth-error')
        button.disabled = true
        button.innerHTML = '<i class="fas fa-spinner fa-spin" aria-hidden="true"></i> Entrando...'
        error.style.display = 'none'

        try {
          const response = await axios.post('/api/auth/login', {
            email: document.getElementById('login-email').value.trim(),
            senha: password.value
          })
          localStorage.setItem('vm_token', response.data.token)
          localStorage.setItem('vm_user', JSON.stringify(response.data.user))
          localStorage.setItem('vm_login_at', Date.now().toString())
          window.location.href = '/app'
        } catch (requestError) {
          error.textContent = requestError.response?.data?.error || 'E-mail ou senha inválidos. Tente novamente.'
          error.style.display = 'block'
          button.disabled = false
          button.innerHTML = 'Entrar <i class="fas fa-arrow-right" aria-hidden="true"></i>'
          error.focus?.()
        }
      })
    },

    renderCadastro(vm) {
      document.getElementById('app').innerHTML = authShell({
        eyebrow: 'Comece agora',
        title: 'Plante hoje,',
        titleEmphasis: 'colha amanhã.',
        story: 'Crie uma visão completa do seu dinheiro e transforme pequenos hábitos em decisões que sustentam seus planos.',
        form: `
          <div class="terminal-auth__eyebrow">Criar sua conta</div>
          <h2>Seu primeiro passo é grátis.</h2>
          <p class="terminal-auth__sub">Leva menos de 2 minutos e não pede cartão de crédito.</p>
          <div id="auth-error" class="terminal-alert" role="alert" aria-live="polite"></div>
          <form id="cadastro-form">
            <div class="terminal-field">
              <label class="terminal-field__label" for="cad-nome">Nome completo</label>
              <div class="terminal-field__input">
                <i class="fas fa-user" aria-hidden="true"></i>
                <input type="text" id="cad-nome" autocomplete="name" placeholder="Seu nome completo" minlength="3" required>
              </div>
              <div id="nome-feedback" class="terminal-field__feedback" aria-live="polite"></div>
            </div>
            <div class="terminal-field">
              <label class="terminal-field__label" for="cad-email">E-mail</label>
              <div class="terminal-field__input">
                <i class="fas fa-envelope" aria-hidden="true"></i>
                <input type="email" id="cad-email" autocomplete="email" placeholder="seu@email.com" required>
                <span class="terminal-field__action" id="email-icon" aria-hidden="true"></span>
              </div>
              <div id="email-feedback" class="terminal-field__feedback" aria-live="polite"></div>
            </div>
            <div class="terminal-field">
              <label class="terminal-field__label" for="cad-senha">Senha</label>
              <div class="terminal-field__input">
                <i class="fas fa-lock" aria-hidden="true"></i>
                <input type="password" id="cad-senha" autocomplete="new-password" placeholder="Mínimo de 8 caracteres" minlength="8" required>
                <button class="terminal-field__action" type="button" id="cad-eye" aria-label="Mostrar senha"><i class="fas fa-eye" aria-hidden="true"></i></button>
              </div>
              <div id="senha-strength" class="terminal-strength">
                <div class="terminal-strength__bars" id="strength-bars"><span></span><span></span><span></span><span></span></div>
                <div class="terminal-strength__meta"><span id="strength-label"></span><div id="strength-criteria" class="terminal-strength__criteria"></div></div>
              </div>
            </div>
            <label class="terminal-consent" for="cad-termos">
              <input type="checkbox" id="cad-termos" required>
              <span>Li e concordo com as condições de uso e com o tratamento dos dados necessário para operar minha conta.</span>
            </label>
            <button class="terminal-btn terminal-btn--primary terminal-btn--large terminal-auth__submit" type="submit" id="cad-btn" disabled>Criar conta grátis <i class="fas fa-arrow-right" aria-hidden="true"></i></button>
          </form>
          <div class="terminal-auth__switch">Já tem conta? <a href="/login">Entrar agora</a></div>
          <div class="terminal-auth__meta">Depois do cadastro, você confirma seu e-mail com um código de 6 dígitos.</div>
          <a class="terminal-back" href="/"><i class="fas fa-arrow-left" aria-hidden="true"></i> Voltar ao site</a>`
      })

      const name = document.getElementById('cad-nome')
      const email = document.getElementById('cad-email')
      const password = document.getElementById('cad-senha')
      const consent = document.getElementById('cad-termos')
      const button = document.getElementById('cad-btn')
      const eye = document.getElementById('cad-eye')
      let emailTimer = null
      let emailRequest = 0

      const setFeedback = (element, message, color) => {
        element.textContent = message
        element.style.color = color
      }

      const canSubmit = () => {
        const valid = name.value.trim().length >= 3 && email.dataset.valid === '1' && Number(password.dataset.score || 0) >= 2 && consent.checked
        button.disabled = !valid
      }

      name.addEventListener('input', () => {
        const valid = name.value.trim().length >= 3
        name.style.borderColor = name.value ? (valid ? '#3DDC84' : '#FF6B6B') : ''
        setFeedback(document.getElementById('nome-feedback'), name.value ? (valid ? 'Nome válido' : 'Use pelo menos 3 caracteres') : '', valid ? '#3DDC84' : '#FF6B6B')
        canSubmit()
      })

      email.addEventListener('input', () => {
        clearTimeout(emailTimer)
        const value = email.value.trim()
        const feedback = document.getElementById('email-feedback')
        const icon = document.getElementById('email-icon')
        email.dataset.valid = '0'
        icon.innerHTML = ''
        if (!value) { setFeedback(feedback, '', ''); canSubmit(); return }
        if (!email.checkValidity()) { setFeedback(feedback, 'Informe um e-mail válido', '#FF6B6B'); canSubmit(); return }
        setFeedback(feedback, 'Verificando disponibilidade...', '#7A8B80')
        icon.innerHTML = '<i class="fas fa-spinner fa-spin"></i>'
        const requestId = ++emailRequest
        emailTimer = setTimeout(async () => {
          try {
            const response = await axios.get(`/api/auth/check-email?email=${encodeURIComponent(value)}`)
            if (requestId !== emailRequest) return
            email.dataset.valid = response.data.valid ? '1' : '0'
            email.style.borderColor = response.data.valid ? '#3DDC84' : '#FF6B6B'
            icon.innerHTML = `<i class="fas ${response.data.valid ? 'fa-check' : 'fa-xmark'}"></i>`
            icon.style.color = response.data.valid ? '#3DDC84' : '#FF6B6B'
            setFeedback(feedback, response.data.valid ? response.data.message : response.data.error, response.data.valid ? '#3DDC84' : '#FF6B6B')
          } catch (requestError) {
            if (requestId !== emailRequest) return
            email.dataset.valid = '0'
            icon.innerHTML = '<i class="fas fa-xmark"></i>'
            icon.style.color = '#FF6B6B'
            setFeedback(feedback, 'Não foi possível validar agora. Tente novamente.', '#FF6B6B')
          }
          canSubmit()
        }, 500)
        canSubmit()
      })

      password.addEventListener('input', () => {
        const value = password.value
        const strength = document.getElementById('senha-strength')
        const bars = [...document.querySelectorAll('#strength-bars span')]
        const checks = [
          { ok: value.length >= 8, label: '8+ caracteres' },
          { ok: /[A-Z]/.test(value), label: 'maiúscula' },
          { ok: /[0-9]/.test(value), label: 'número' },
          { ok: /[^A-Za-z0-9]/.test(value), label: 'especial' }
        ]
        const score = checks.filter(item => item.ok).length
        const labels = ['Muito fraca', 'Fraca', 'Média', 'Forte', 'Muito forte']
        const colors = ['#FF6B6B', '#FF6B6B', '#F2C94C', '#3DDC84', '#3DDC84']
        password.dataset.score = String(score)
        strength.style.display = value ? 'block' : 'none'
        bars.forEach((bar, index) => { bar.style.background = index < score ? colors[score] : '#1E2A22' })
        setFeedback(document.getElementById('strength-label'), labels[score], colors[score])
        document.getElementById('strength-criteria').innerHTML = checks.map(item => `<span style="color:${item.ok ? '#3DDC84' : '#7A8B80'}">${item.ok ? '✓' : '·'} ${item.label}</span>`).join('')
        canSubmit()
      })

      eye.addEventListener('click', () => togglePassword(password, eye))
      consent.addEventListener('change', canSubmit)

      document.getElementById('cadastro-form').addEventListener('submit', async (event) => {
        event.preventDefault()
        if (button.disabled) return
        const error = document.getElementById('auth-error')
        button.disabled = true
        button.innerHTML = '<i class="fas fa-spinner fa-spin" aria-hidden="true"></i> Criando conta...'
        error.style.display = 'none'

        try {
          const response = await axios.post('/api/auth/register', {
            nome: name.value.trim(),
            email: email.value.trim(),
            senha: password.value
          })
          localStorage.setItem('vm_token', response.data.token)
          localStorage.setItem('vm_user', JSON.stringify(response.data.user))
          localStorage.setItem('vm_pending_email', email.value.trim())
          window.location.href = '/verificar-email'
        } catch (requestError) {
          error.textContent = requestError.response?.data?.error || 'Erro ao criar conta. Tente novamente.'
          error.style.display = 'block'
          button.innerHTML = 'Criar conta grátis <i class="fas fa-arrow-right" aria-hidden="true"></i>'
          canSubmit()
          error.focus?.()
        }
      })
    }
  }
})()
