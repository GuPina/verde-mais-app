export function terminalLandingPage() {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>VerdeMais — Seu dinheiro, com propósito</title>
  <meta name="description" content="Organize receitas, despesas, cartões, metas e investimentos em um só lugar com o VerdeMais.">
  <meta name="theme-color" content="#0A0F0C">
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@500;600;700&display=swap" rel="stylesheet">
  <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
  <link rel="stylesheet" href="/static/terminal-public.css?v=20260827-1">
</head>
<body class="terminal-home">
  <header class="terminal-nav">
    <div class="terminal-container terminal-nav__inner">
      <a class="terminal-logo" href="/" aria-label="VerdeMais — início">
        <img src="/static/verdemais-terminal-mark-green.svg" alt="">
        <span>verde<span>mais</span></span>
      </a>
      <nav class="terminal-nav__links" aria-label="Navegação principal">
        <a href="#produto">Produto</a>
        <a href="#recursos">Recursos</a>
        <a href="#planos">Planos</a>
        <a href="#seguranca">Segurança</a>
      </nav>
      <div class="terminal-nav__actions">
        <a class="terminal-btn" href="/login">Entrar</a>
        <a class="terminal-btn terminal-btn--primary" href="/cadastro">Começar grátis <i class="fas fa-arrow-right" aria-hidden="true"></i></a>
      </div>
    </div>
  </header>

  <main>
    <section class="terminal-hero" id="produto">
      <div class="terminal-hero__grid">
        <div class="terminal-hero__copy">
          <div class="terminal-pill"><span class="terminal-pill__dot"></span>Novo: Assistente IA em português</div>
          <h1>Cada real que passa por você <em>ganha um propósito.</em></h1>
          <p class="terminal-hero__lead">Organize receitas, despesas, cartões, metas e investimentos em um só lugar. A VerdeMais te acompanha como um copiloto: sugere, alerta e celebra seu progresso.</p>
          <div class="terminal-hero__actions">
            <a class="terminal-btn terminal-btn--primary terminal-btn--large" href="/cadastro">Começar grátis <i class="fas fa-arrow-right" aria-hidden="true"></i></a>
            <a class="terminal-btn terminal-btn--large" href="#recursos">Ver como funciona</a>
          </div>
          <div class="terminal-proof" aria-label="Destaques do produto">
            <span><b>R$ 0</b> para começar</span>
            <span><b>20+</b> módulos financeiros</span>
            <span><b>100%</b> pensado para o Brasil</span>
          </div>
        </div>

        <div class="terminal-preview" aria-label="Prévia do dashboard VerdeMais">
          <img class="terminal-preview__mark" src="/static/verdemais-terminal-mark-dark.svg" alt="">
          <div class="terminal-preview__stack">
            <div class="terminal-preview__label">Preview do app</div>
            <div class="terminal-preview__card">
              <div class="terminal-preview__row">
                <div class="terminal-kicker">Patrimônio líquido</div>
                <span class="terminal-trend">+12,4%</span>
              </div>
              <div class="terminal-money">R$ 84.320</div>
              <div class="terminal-bars" aria-label="Evolução patrimonial nos últimos sete meses">
                <span style="height:48%"></span><span style="height:56%"></span><span style="height:53%"></span><span style="height:66%"></span><span style="height:74%"></span><span style="height:82%"></span><span style="height:96%"></span>
              </div>
            </div>
            <div class="terminal-preview__card terminal-achievement">
              <div class="terminal-achievement__icon"><i class="fas fa-trophy" aria-hidden="true"></i></div>
              <div>
                <strong>Barreira dos 50 mil desbloqueada</strong>
                <small>+300 XP · conquista épica</small>
              </div>
              <span class="terminal-tag terminal-tag--pro" style="margin-left:auto">novo</span>
            </div>
          </div>
        </div>
      </div>
    </section>

    <section class="terminal-section" id="recursos">
      <div class="terminal-container">
        <div class="terminal-section__head">
          <div class="terminal-kicker">Recursos</div>
          <h2>Tudo que você faz com dinheiro, em um só app.</h2>
          <p>Módulos financeiros integrados para trocar planilhas paralelas por uma visão clara do presente e do futuro.</p>
        </div>
        <div class="terminal-grid">
          <article class="terminal-feature">
            <div class="terminal-feature__top"><div class="terminal-feature__icon"><i class="fas fa-chart-line"></i></div><span class="terminal-tag">FREE</span></div>
            <div><h3>Dashboard vivo</h3><p>Patrimônio, saldo, compromissos e próximos passos em um único painel.</p></div>
          </article>
          <article class="terminal-feature">
            <div class="terminal-feature__top"><div class="terminal-feature__icon"><i class="fas fa-comments"></i></div><span class="terminal-tag">FREE</span></div>
            <div><h3>Assistente IA</h3><p>Pergunte sobre saldo, metas, dívidas, reservas e planejamento em português.</p></div>
          </article>
          <article class="terminal-feature">
            <div class="terminal-feature__top"><div class="terminal-feature__icon"><i class="fas fa-trophy"></i></div><span class="terminal-tag">FREE</span></div>
            <div><h3>Gamificação real</h3><p>Desafio 52, conquistas e XP transformam consistência em progresso visível.</p></div>
          </article>
          <article class="terminal-feature">
            <div class="terminal-feature__top"><div class="terminal-feature__icon"><i class="fas fa-shield-halved"></i></div><span class="terminal-tag">FREE</span></div>
            <div><h3>Reservas inteligentes</h3><p>Separe sua proteção por objetivo e acompanhe os aportes vinculados.</p></div>
          </article>
          <article class="terminal-feature">
            <div class="terminal-feature__top"><div class="terminal-feature__icon"><i class="fas fa-binoculars"></i></div><span class="terminal-tag terminal-tag--premium">PREMIUM</span></div>
            <div><h3>Projeção de 12 meses</h3><p>Parcelas, recorrências e lembretes se combinam para mostrar o que vem pela frente.</p></div>
          </article>
          <article class="terminal-feature">
            <div class="terminal-feature__top"><div class="terminal-feature__icon"><i class="fas fa-house"></i></div><span class="terminal-tag terminal-tag--pro">PRO</span></div>
            <div><h3>Amortização SAC/PRICE</h3><p>Simule antecipações e descubra a economia real de juros do financiamento.</p></div>
          </article>
          <article class="terminal-feature">
            <div class="terminal-feature__top"><div class="terminal-feature__icon"><i class="fas fa-bell"></i></div><span class="terminal-tag">FREE</span></div>
            <div><h3>Assinaturas fantasma</h3><p>Identifique cobranças recorrentes esquecidas antes que elas se renovem.</p></div>
          </article>
          <article class="terminal-feature">
            <div class="terminal-feature__top"><div class="terminal-feature__icon"><i class="fas fa-chart-pie"></i></div><span class="terminal-tag">FREE</span></div>
            <div><h3>Regra 50/30/20</h3><p>Personalize percentuais e compare seu orçamento com uma referência prática.</p></div>
          </article>
        </div>
      </div>
    </section>

    <section class="terminal-section" id="planos">
      <div class="terminal-container">
        <div class="terminal-section__head">
          <div class="terminal-kicker">Planos</div>
          <h2>Comece grátis. Cresça no seu ritmo.</h2>
          <p>Entre sem cartão e evolua quando os recursos avançados fizerem sentido para a sua rotina.</p>
        </div>
        <div class="terminal-plans">
          <article class="terminal-plan">
            <div class="terminal-plan__name">Free</div>
            <div class="terminal-plan__price">R$ 0</div>
            <p class="terminal-plan__desc">Para começar a organizar seu dinheiro hoje.</p>
            <ul>
              <li><i class="fas fa-check"></i><span>Controle de receitas e despesas</span></li>
              <li><i class="fas fa-check"></i><span>Metas, cartões e lembretes</span></li>
              <li><i class="fas fa-check"></i><span>Reservas e gamificação</span></li>
              <li><i class="fas fa-check"></i><span>Assistente IA e regra 50/30/20</span></li>
            </ul>
            <a class="terminal-btn terminal-btn--large" href="/cadastro">Começar grátis</a>
          </article>
          <article class="terminal-plan terminal-plan--popular">
            <span class="terminal-plan__popular">Mais popular</span>
            <div class="terminal-plan__name">Premium</div>
            <div class="terminal-plan__price">R$ 17,90 <small>/ mês</small></div>
            <p class="terminal-plan__desc">Para quem quer olhar os próximos 12 meses.</p>
            <ul>
              <li><i class="fas fa-check"></i><span>Tudo do Free</span></li>
              <li><i class="fas fa-check"></i><span>Score de saúde financeira</span></li>
              <li><i class="fas fa-check"></i><span>Projeção financeira anual</span></li>
              <li><i class="fas fa-check"></i><span>Insights personalizados</span></li>
            </ul>
            <a class="terminal-btn terminal-btn--large" href="/cadastro">Criar conta</a>
          </article>
          <article class="terminal-plan">
            <div class="terminal-plan__name">Pro</div>
            <div class="terminal-plan__price">R$ 37,90 <small>/ mês</small></div>
            <p class="terminal-plan__desc">Para otimizar dívidas e patrimônio.</p>
            <ul>
              <li><i class="fas fa-check"></i><span>Tudo do Premium</span></li>
              <li><i class="fas fa-check"></i><span>Planejamento familiar</span></li>
              <li><i class="fas fa-check"></i><span>Simulações e amortização</span></li>
              <li><i class="fas fa-check"></i><span>Recursos avançados sem limites</span></li>
            </ul>
            <a class="terminal-btn terminal-btn--accent terminal-btn--large" href="/cadastro">Criar conta</a>
          </article>
        </div>
      </div>
    </section>

    <section class="terminal-section" id="seguranca">
      <div class="terminal-container terminal-security">
        <div class="terminal-section__head" style="margin:0">
          <div class="terminal-kicker">Segurança</div>
          <h2>Seu dinheiro é assunto sério. Seus dados também.</h2>
          <p>A autenticação e os controles de acesso do VerdeMais foram desenhados para proteger sua conta sem criar atrito no uso diário.</p>
        </div>
        <div class="terminal-security__list">
          <div class="terminal-security__item"><i class="fas fa-lock"></i><div><strong>Senha protegida</strong><small>Suas credenciais são armazenadas com hash seguro, nunca em texto aberto.</small></div></div>
          <div class="terminal-security__item"><i class="fas fa-envelope-circle-check"></i><div><strong>Verificação por OTP</strong><small>Novas contas confirmam o e-mail com um código de uso único.</small></div></div>
          <div class="terminal-security__item"><i class="fas fa-user-shield"></i><div><strong>Sessões controladas</strong><small>Tokens de sessão e limites de tentativa ajudam a bloquear acessos indevidos.</small></div></div>
        </div>
      </div>
    </section>

    <section class="terminal-cta">
      <div class="terminal-container terminal-cta__inner">
        <div>
          <div class="terminal-kicker">Sua próxima etapa</div>
          <h2>Sua próxima <em>colheita</em> começa agora.</h2>
          <p>Sem cartão de crédito para começar. Só uma ferramenta bem feita para ajudar você a decidir melhor.</p>
          <div class="terminal-hero__actions">
            <a class="terminal-btn terminal-btn--primary terminal-btn--large" href="/cadastro">Criar minha conta <i class="fas fa-arrow-right"></i></a>
            <a class="terminal-btn terminal-btn--large" href="/login">Já tenho conta</a>
          </div>
        </div>
        <img class="terminal-cta__mark" src="/static/verdemais-terminal-mark-green.svg" alt="">
      </div>
    </section>
  </main>

  <footer class="terminal-footer">
    <div class="terminal-container terminal-footer__inner">
      <span>© ${new Date().getFullYear()} VerdeMais</span>
      <span>Organize hoje. Conquiste amanhã.</span>
    </div>
  </footer>
</body>
</html>`
}
