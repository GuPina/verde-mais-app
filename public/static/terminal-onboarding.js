(function () {
  const stepsMeta = [
    { label: 'Situação', icon: 'fa-briefcase' },
    { label: 'Renda', icon: 'fa-wallet' },
    { label: 'Hábitos', icon: 'fa-chart-line' },
    { label: 'Objetivos', icon: 'fa-bullseye' },
    { label: 'Perfil', icon: 'fa-user-check' }
  ]

  const option = (group, value, label, icon, extra = '') => `<button type="button" class="to-option ${extra}" data-val="${value}" onclick="${extra.includes('ob-multi') ? `VM.toggleOBMulti(this,'${value}')` : `VM.selectOB('${group}','${value}',this)`}"><i class="fas ${icon}"></i><span>${label}</span></button>`

  const panels = (vm) => ({
    1: {
      eyebrow: 'Vamos começar pelo presente',
      title: `Como está sua rotina, ${vm.user?.nome?.split(' ')[0] || 'por aí'}?`,
      description: 'Sua situação profissional ajuda a calibrar alertas e recomendações, sem definir ou limitar suas escolhas.',
      body: `<fieldset class="to-fieldset"><legend>Qual é sua situação de emprego atual?</legend><div class="to-options to-options--grid" id="emprego-options">
        ${option('emprego-options', 'empregado_clt', 'CLT / empregado', 'fa-id-badge')}
        ${option('emprego-options', 'autonomo', 'Autônomo', 'fa-briefcase')}
        ${option('emprego-options', 'empresario', 'Empresário', 'fa-building')}
        ${option('emprego-options', 'freelancer', 'Freelancer', 'fa-laptop')}
        ${option('emprego-options', 'servidor_publico', 'Servidor público', 'fa-landmark')}
        ${option('emprego-options', 'aposentado', 'Aposentado', 'fa-umbrella-beach')}
        ${option('emprego-options', 'estudante', 'Estudante', 'fa-graduation-cap')}
        ${option('emprego-options', 'desempregado', 'Buscando emprego', 'fa-magnifying-glass')}
      </div><input type="hidden" id="ob-emprego" value=""></fieldset>`
    },
    2: {
      eyebrow: 'A base dos seus cálculos',
      title: 'Qual é sua faixa de renda mensal?',
      description: 'Esse valor fica privado e serve para calcular saldo, score e comprometimento com segurança.',
      body: `<fieldset class="to-fieldset"><legend>Renda mensal aproximada</legend><div class="to-options to-options--grid" id="renda-options">
        ${[['1000','Até R$ 1.000'],['2000','R$ 1.001 – R$ 2.000'],['3500','R$ 2.001 – R$ 5.000'],['7500','R$ 5.001 – R$ 10.000'],['15000','R$ 10.001 – R$ 20.000'],['30000','Acima de R$ 20.000']].map(([value,label]) => option('renda-options', value, label, 'fa-brazilian-real-sign')).join('')}
      </div><input type="hidden" id="ob-renda" value=""></fieldset>
      <fieldset class="to-fieldset"><legend>Quantas pessoas dependem financeiramente de você?</legend><div class="to-options to-options--compact" id="dep-options">
        ${['0','1','2','3','4','5+'].map(value => option('dep-options', value, value, 'fa-user')).join('')}
      </div><input type="hidden" id="ob-dependentes" value=""></fieldset>`
    },
    3: {
      eyebrow: 'Sem julgamento, só contexto',
      title: 'Como o dinheiro se comporta hoje?',
      description: 'Respostas realistas tornam o plano mais útil do que qualquer meta perfeita no papel.',
      body: `<fieldset class="to-fieldset"><legend>Atualmente, você consegue poupar?</legend><div class="to-options" id="poupar-options">
        ${option('poupar-options','nao','Gasto mais do que ganho','fa-arrow-trend-down')}
        ${option('poupar-options','pouco','Às vezes, mas é difícil','fa-scale-balanced')}
        ${option('poupar-options','sim','Poupo um pouco todo mês','fa-piggy-bank')}
        ${option('poupar-options','investindo','Poupo e invisto regularmente','fa-chart-line')}
      </div><input type="hidden" id="ob-poupar" value=""></fieldset>
      <fieldset class="to-fieldset"><legend>Qual é sua maior dificuldade agora?</legend><div class="to-options to-options--grid" id="dific-options">
        ${option('dific-options','gastos_excessivos','Gastos excessivos','fa-bag-shopping')}
        ${option('dific-options','dividas','Dívidas e cartão','fa-credit-card')}
        ${option('dific-options','falta_planejamento','Falta de planejamento','fa-list-check')}
        ${option('dific-options','renda_baixa','Renda insuficiente','fa-wallet')}
        ${option('dific-options','investir','Não sei como investir','fa-seedling')}
        ${option('dific-options','emergencias','Imprevistos financeiros','fa-shield-halved')}
      </div><input type="hidden" id="ob-dificuldade" value=""></fieldset>`
    },
    4: {
      eyebrow: 'Dinheiro com direção',
      title: 'O que você quer fazer crescer?',
      description: 'Escolha quantos objetivos quiser e depois indique seu conforto com risco.',
      body: `<fieldset class="to-fieldset"><legend>Seus principais objetivos <small>selecione vários</small></legend><div class="to-options to-options--grid" id="obj-options">
        ${option('obj-options','reserva_emergencia','Reserva de emergência','fa-shield-halved','ob-multi')}
        ${option('obj-options','quitar_dividas','Quitar dívidas','fa-credit-card','ob-multi')}
        ${option('obj-options','comprar_casa','Comprar imóvel','fa-house','ob-multi')}
        ${option('obj-options','comprar_carro','Comprar veículo','fa-car','ob-multi')}
        ${option('obj-options','aposentadoria','Planejar aposentadoria','fa-sun','ob-multi')}
        ${option('obj-options','viagem','Viajar e aproveitar','fa-plane','ob-multi')}
        ${option('obj-options','investir_mais','Ampliar investimentos','fa-chart-line','ob-multi')}
        ${option('obj-options','educacao','Investir em educação','fa-graduation-cap','ob-multi')}
        ${option('obj-options','negocio','Abrir um negócio','fa-store','ob-multi')}
        ${option('obj-options','independencia_financeira','Independência financeira','fa-compass','ob-multi')}
      </div></fieldset>
      <fieldset class="to-fieldset"><legend>Qual é seu perfil de investidor?</legend><div class="to-options" id="perfil-options">
        ${option('perfil-options','conservador','Conservador — segurança primeiro','fa-shield-halved')}
        ${option('perfil-options','moderado','Moderado — equilíbrio entre risco e retorno','fa-scale-balanced')}
        ${option('perfil-options','arrojado','Arrojado — mais risco por mais potencial','fa-rocket')}
      </div><input type="hidden" id="ob-perfil-inv" value=""></fieldset>`
    },
    5: {
      eyebrow: 'Último ajuste',
      title: 'Deixe o VerdeMais com a sua cara.',
      description: 'Esses detalhes refinam o contexto. Você pode atualizar tudo depois no seu perfil.',
      body: `<div class="to-form-grid">
        <label class="to-field"><span>Estado civil</span><select id="ob-estado-civil"><option value="solteiro">Solteiro(a)</option><option value="casado">Casado(a)</option><option value="divorciado">Divorciado(a)</option><option value="viuvo">Viúvo(a)</option><option value="uniao_estavel">União estável</option></select></label>
        <label class="to-field"><span>Profissão</span><input type="text" id="ob-profissao" placeholder="Ex.: Analista de dados"></label>
        <label class="to-field"><span>Cidade</span><input type="text" id="ob-cidade" placeholder="Sua cidade"></label>
        <label class="to-field"><span>Estado</span><select id="ob-estado">${['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'].map(uf => `<option>${uf}</option>`).join('')}</select></label>
      </div>
      <fieldset class="to-fieldset"><legend>Quando você quer revisar suas finanças?</legend><div class="to-options" id="freq-options">
        ${option('freq-options','diario','Diariamente — acompanhamento próximo','fa-calendar-day')}
        ${option('freq-options','semanal','Semanalmente — revisões rápidas','fa-calendar-week')}
        ${option('freq-options','mensal','Mensalmente — fechamento completo','fa-calendar')}
      </div><input type="hidden" id="ob-frequencia" value=""></fieldset>`
    }
  })

  const restore = (vm, step) => {
    if (!vm.onboardingData) return
    if (step === 1 && vm.onboardingData.emprego) vm.preSelectOB('emprego-options', vm.onboardingData.emprego)
    if (step === 2) {
      if (vm.onboardingData.renda) vm.preSelectOB('renda-options', vm.onboardingData.renda)
      if (vm.onboardingData.dependentes !== undefined) vm.preSelectOB('dep-options', vm.onboardingData.dependentes)
    }
    if (step === 3) {
      if (vm.onboardingData.poupar) vm.preSelectOB('poupar-options', vm.onboardingData.poupar)
      if (vm.onboardingData.dificuldade) vm.preSelectOB('dific-options', vm.onboardingData.dificuldade)
    }
    if (step === 4) {
      if (vm.onboardingData.perfil_inv) vm.preSelectOB('perfil-options', vm.onboardingData.perfil_inv)
      ;(vm.onboardingData.objetivos || []).forEach(value => {
        const element = document.querySelector(`[data-val="${value}"].ob-multi`)
        if (element) { element.style.borderColor = '#2FBF71'; element.style.background = 'rgba(47,191,113,0.12)'; element.style.color = '#2FBF71' }
      })
    }
  }

  window.VMTerminalOnboarding = {
    render(vm) {
      vm.onboardingStep = 1
      vm.onboardingData = {}
      document.getElementById('app').innerHTML = `<div class="terminal-onboarding">
        <aside class="to-aside">
          <a class="terminal-logo" href="/" aria-label="VerdeMais — início"><img src="/static/verdemais-terminal-mark-dark.svg" alt=""><span>verde<span>mais</span></span></a>
          <div class="to-aside__copy"><span class="to-eyebrow">Sua jornada começa aqui</span><h1>Vamos cultivar<br><em>o seu plano.</em></h1><p>Cinco respostas rápidas deixam o painel mais inteligente desde o primeiro lançamento.</p></div>
          <div class="to-aside__trust"><i class="fas fa-shield-halved"></i> Dados privados e editáveis a qualquer momento</div>
        </aside>
        <main class="to-main">
          <div class="to-shell">
            <div class="to-mobile-logo"><a class="terminal-logo" href="/"><img src="/static/verdemais-terminal-mark-green.svg" alt=""><span>verde<span>mais</span></span></a></div>
            <nav class="to-progress" id="ob-steps-bar" aria-label="Progresso do cadastro">${stepsMeta.map((item, index) => `<div class="to-progress__step" data-step="${index + 1}"><span id="ob-step-dot-${index + 1}"><i class="fas ${item.icon}"></i></span><small id="ob-step-label-${index + 1}">${item.label}</small>${index ? `<i class="to-progress__line" id="ob-line-${index}"></i>` : ''}</div>`).join('')}</nav>
            <div class="to-card" id="ob-card"></div>
            <div class="to-indicator" id="ob-step-indicator">Passo 1 de 5</div>
          </div>
        </main>
      </div>`
      this.renderStep(vm, 1)
    },

    renderStep(vm, step) {
      vm.onboardingStep = step
      const card = document.getElementById('ob-card')
      if (!card) return
      const indicator = document.getElementById('ob-step-indicator')
      if (indicator) indicator.textContent = `Passo ${step} de 5`
      document.querySelectorAll('.to-progress__step').forEach((element, index) => {
        element.classList.toggle('is-active', index + 1 === step)
        element.classList.toggle('is-complete', index + 1 < step)
      })

      const panel = panels(vm)[step]
      card.innerHTML = `<div class="to-card__head"><span class="to-eyebrow">${panel.eyebrow}</span><h2>${panel.title}</h2><p>${panel.description}</p></div>
        <div class="to-card__body">${panel.body}</div>
        <div class="to-card__nav">
          ${step > 1 ? `<button class="to-button" onclick="VM.renderOnboardingStep(${step - 1})"><i class="fas fa-arrow-left"></i> Voltar</button>` : `<button class="to-button" onclick="window.location.href='/app'">Configurar depois</button>`}
          <button class="to-button to-button--primary" onclick="VM.nextOnboardingStep(${step})" id="ob-next">${step === 5 ? 'Concluir configuração <i class="fas fa-check"></i>' : 'Continuar <i class="fas fa-arrow-right"></i>'}</button>
        </div>`
      restore(vm, step)
      card.animate?.([{ opacity: .4, transform: 'translateY(8px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: 220, easing: 'ease-out' })
    },

    renderFinal(vm) {
      const name = vm.user?.nome?.split(' ')[0] || 'você'
      document.getElementById('app').innerHTML = `<div class="terminal-onboarding terminal-onboarding--final">
        <main class="to-final">
          <a class="terminal-logo" href="/"><img src="/static/verdemais-terminal-mark-green.svg" alt=""><span>verde<span>mais</span></span></a>
          <span class="to-final__mark"><i class="fas fa-check"></i></span>
          <span class="to-eyebrow">Perfil configurado</span>
          <h1>Tudo pronto, <em>${name}.</em></h1>
          <p>Seu Dashboard já pode transformar lançamentos em uma leitura financeira feita para a sua realidade.</p>
          <div class="to-final__steps">
            <div><span>01</span><strong>Adicione sua renda</strong><small>É a base do saldo e do score.</small></div>
            <div><span>02</span><strong>Registre as contas</strong><small>Comece pelas despesas fixas.</small></div>
            <div><span>03</span><strong>Defina uma meta</strong><small>Dê direção ao que sobrar.</small></div>
          </div>
          <a class="to-button to-button--primary to-final__cta" href="/app/dashboard">Abrir meu Dashboard <i class="fas fa-arrow-right"></i></a>
          <small class="to-final__note">Você pode revisar estas respostas em Meu Perfil.</small>
        </main>
      </div>`
    }
  }
})()
