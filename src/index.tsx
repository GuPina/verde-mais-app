import { Hono } from 'hono'
import { cors } from 'hono/cors'
import authRoutes from './routes/auth'
import receitasRoutes from './routes/receitas'
import despesasRoutes from './routes/despesas'
import metasRoutes from './routes/metas'
import investimentosRoutes from './routes/investimentos'
import dashboardRoutes from './routes/dashboard'
import cartoesRoutes from './routes/cartoes'
import financiamentosRoutes from './routes/financiamentos'
import emprestimosRoutes from './routes/emprestimos'
import lembretesRoutes from './routes/lembretes'
import conquistasRoutes from './routes/conquistas'
import iaRoutes from './routes/ia'
import perfilRoutes from './routes/perfil'
import reservaRoutes from './routes/reserva'
import adminRoutes from './routes/admin'
import orcamentosRoutes from './routes/orcamentos'
import recorrenciasRoutes from './routes/recorrencias'
import projecaoRoutes from './routes/projecao'
import asaasRoutes from './routes/asaas'
import comparativoRoutes from './routes/comparativo'
import cdiRoutes from './routes/cdi'
import tagsRoutes from './routes/tags'
import relatorioRoutes from './routes/relatorio'
import alertasCartaoRoutes from './routes/alertas-cartao'
import reservasEspRoutes from './routes/reservas-especializadas'
import assinaturasFantasmaRoutes from './routes/assinaturas-fantasma'
import comprasFantasmaRoutes from './routes/compras-fantasma'
import regra503020Routes from './routes/regra-503020'
import desafio52Routes from './routes/desafio-52'
import amortizacaoRoutes from './routes/amortizacao'
import despesasCompartilhadasRoutes from './routes/despesas-compartilhadas'
import assistenteRoutes from './routes/assistente'
import chatRoutes from './routes/chat'

type Bindings = { DB: D1Database; ADMIN_PASSWORD?: string }

const app = new Hono<{ Bindings: Bindings }>()

// CORS
app.use('/api/*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization']
}))

// API Routes
app.route('/api/auth', authRoutes)
app.route('/api/receitas', receitasRoutes)
app.route('/api/despesas', despesasRoutes)
app.route('/api/metas', metasRoutes)
app.route('/api/investimentos', investimentosRoutes)
app.route('/api/dashboard', dashboardRoutes)
app.route('/api/cartoes', cartoesRoutes)
app.route('/api/financiamentos', financiamentosRoutes)
app.route('/api/emprestimos', emprestimosRoutes)
app.route('/api/lembretes', lembretesRoutes)
app.route('/api/conquistas', conquistasRoutes)
app.route('/api/ia', iaRoutes)
app.route('/api/perfil', perfilRoutes)
app.route('/api/reserva', reservaRoutes)
app.route('/api/orcamentos', orcamentosRoutes)
app.route('/api/recorrencias', recorrenciasRoutes)
app.route('/api/projecao', projecaoRoutes)
app.route('/api/asaas', asaasRoutes)
app.route('/api/comparativo', comparativoRoutes)
app.route('/api/cdi', cdiRoutes)
app.route('/api/tags', tagsRoutes)
app.route('/api/relatorio', relatorioRoutes)
app.route('/api/alertas-cartao', alertasCartaoRoutes)
// ── v3.0 — Novas Funcionalidades ──
app.route('/api/reservas-esp', reservasEspRoutes)
app.route('/api/assinaturas-fantasma', assinaturasFantasmaRoutes)
app.route('/api/compras-fantasma', comprasFantasmaRoutes)
app.route('/api/regra-503020', regra503020Routes)
app.route('/api/desafio-52', desafio52Routes)
app.route('/api/amortizacao', amortizacaoRoutes)
app.route('/api/despesas-compartilhadas', despesasCompartilhadasRoutes)
app.route('/api/assistente', assistenteRoutes)
app.route('/api/chat', chatRoutes)

// Admin panel — protegido por Basic Auth
app.route('/admin', adminRoutes)

// Health check
app.get('/api/health', (c) => c.json({ status: 'ok', app: 'VerdeMais', version: '3.1.0', fase: '3B+3C+4+v3.1', features: ['patrimônio', 'assistente-ia', 'desafio-configuravel', 'regra-editavel', 'tags-receitas', 'integracoes-modulos', 'despesas-compartilhadas', 'aporte-patrimonial', 'responsividade-mobile'], timestamp: new Date().toISOString() }))

// Service Worker — servido inline para evitar problemas de CORS/path no wrangler
app.get('/sw.js', (c) => {
  const swContent = `// VerdeMais Service Worker v2
const CACHE = 'vm-v2'

self.addEventListener('install', () => self.skipWaiting())

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  )
})

self.addEventListener('push', (e) => {
  let d = {}
  try { d = e.data?.json() || {} } catch(_) {}
  const title   = d.title   || 'VerdeMais'
  const options = {
    body:    d.body    || 'Nova notificação',
    icon:    d.icon    || '/favicon.svg',
    badge:   '/favicon.svg',
    tag:     d.tag     || 'vm',
    vibrate: d.urgente ? [200,100,200] : [100],
    data:    { url: d.url || '/app' }
  }
  e.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', (e) => {
  e.notification.close()
  const url = e.notification.data?.url || '/app'
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(wcs => {
      for (const wc of wcs) {
        if ('focus' in wc) { wc.focus(); wc.postMessage({ type: 'NAVIGATE', url }); return }
      }
      if (clients.openWindow) return clients.openWindow(url)
    })
  )
})
`
  return c.text(swContent, 200, {
    'Content-Type': 'application/javascript; charset=utf-8',
    'Service-Worker-Allowed': '/',
    'Cache-Control': 'no-cache'
  })
})

// Landing Page
app.get('/', (c) => {
  return c.html(landingPage())
})

// App pages - serve SPA
app.get('/app', (c) => c.html(appShell()))
app.get('/app/*', (c) => c.html(appShell()))
app.get('/login', (c) => c.html(appShell()))
app.get('/cadastro', (c) => c.html(appShell()))
app.get('/verificar-email', (c) => c.html(appShell()))
app.get('/onboarding', (c) => c.html(appShell()))
app.get('/onboarding/*', (c) => c.html(appShell()))

function landingPage() {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>VerdeMais – Organize hoje. Conquiste amanhã.</title>
  <meta name="description" content="VerdeMais é seu mentor financeiro digital. Organize suas finanças, trace metas e construa patrimônio com estratégia.">
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <script src="https://cdn.tailwindcss.com"></script>
  <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
  <style>
    :root {
      --verde: #208040;
      --verde-claro: #2FBF71;
      --cinza-escuro: #1a1a2e;
      --card-bg: #16213e;
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html { scroll-behavior: smooth; }
    body { font-family: 'Segoe UI', system-ui, sans-serif; background: #0f0f1a; color: #fff; overflow-x: hidden; }
    
    .gradient-text { background: linear-gradient(135deg, #2FBF71, #208040); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text; }
    .btn-primary { background: linear-gradient(135deg, #2FBF71, #208040); color: #fff; padding: 14px 32px; border-radius: 50px; font-weight: 700; font-size: 1rem; border: none; cursor: pointer; transition: all 0.3s; display: inline-flex; align-items: center; gap: 8px; text-decoration: none; }
    .btn-primary:hover { transform: translateY(-2px); box-shadow: 0 10px 30px rgba(47,191,113,0.4); }
    .btn-outline { border: 2px solid #2FBF71; color: #2FBF71; padding: 12px 28px; border-radius: 50px; font-weight: 600; cursor: pointer; transition: all 0.3s; background: transparent; font-size: 0.95rem; text-decoration: none; display: inline-flex; align-items: center; gap: 8px; }
    .btn-outline:hover { background: #2FBF71; color: #fff; }
    .card { background: rgba(255,255,255,0.05); border: 1px solid rgba(47,191,113,0.15); border-radius: 20px; padding: 32px; transition: all 0.3s; backdrop-filter: blur(10px); }
    .card:hover { border-color: rgba(47,191,113,0.4); transform: translateY(-4px); box-shadow: 0 20px 40px rgba(47,191,113,0.1); }
    .glow { box-shadow: 0 0 40px rgba(47,191,113,0.15); }
    
    nav { position: fixed; top: 0; left: 0; right: 0; z-index: 100; padding: 20px 5%; display: flex; align-items: center; justify-content: space-between; background: rgba(15,15,26,0.8); backdrop-filter: blur(20px); border-bottom: 1px solid rgba(47,191,113,0.1); }
    .logo { display: flex; align-items: center; gap: 10px; font-size: 1.5rem; font-weight: 800; }
    .logo-icon { width: 40px; height: 40px; background: linear-gradient(135deg, #2FBF71, #208040); border-radius: 10px; display: flex; align-items: center; justify-content: center; font-size: 1.2rem; }
    
    .hero { min-height: 100vh; display: flex; align-items: center; padding: 120px 5% 80px; position: relative; overflow: hidden; }
    .hero::before { content: ''; position: absolute; top: -50%; left: -50%; width: 200%; height: 200%; background: radial-gradient(ellipse at center, rgba(47,191,113,0.08) 0%, transparent 60%); pointer-events: none; }
    
    .floating { animation: float 6s ease-in-out infinite; }
    @keyframes float { 0%, 100% { transform: translateY(0px); } 50% { transform: translateY(-20px); } }
    @keyframes shake { 0%,100%{transform:translateX(0)} 25%{transform:translateX(-6px)} 75%{transform:translateX(6px)} }
    @keyframes fadeSlideIn { from{opacity:0;transform:translateY(16px)} to{opacity:1;transform:translateY(0)} }
    
    .mockup { background: rgba(255,255,255,0.05); border: 1px solid rgba(47,191,113,0.2); border-radius: 24px; padding: 24px; backdrop-filter: blur(20px); }
    
    .stat-card { background: rgba(47,191,113,0.1); border: 1px solid rgba(47,191,113,0.2); border-radius: 16px; padding: 20px; }
    
    .feature-icon { width: 60px; height: 60px; background: linear-gradient(135deg, rgba(47,191,113,0.2), rgba(32,128,64,0.2)); border-radius: 16px; display: flex; align-items: center; justify-content: center; font-size: 1.5rem; margin-bottom: 20px; border: 1px solid rgba(47,191,113,0.3); }
    
    .plan-card { background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.1); border-radius: 24px; padding: 36px; transition: all 0.3s; }
    .plan-card.featured { background: linear-gradient(135deg, rgba(47,191,113,0.15), rgba(32,128,64,0.1)); border-color: #2FBF71; transform: scale(1.05); }
    .plan-card:hover { border-color: rgba(47,191,113,0.5); }
    
    .check { color: #2FBF71; margin-right: 8px; }
    .x-mark { color: #666; margin-right: 8px; }
    
    section { padding: 100px 5%; }
    .section-title { font-size: 2.5rem; font-weight: 800; text-align: center; margin-bottom: 16px; }
    .section-sub { color: #888; text-align: center; font-size: 1.1rem; margin-bottom: 60px; max-width: 600px; margin-left: auto; margin-right: auto; }
    
    footer { background: rgba(255,255,255,0.02); border-top: 1px solid rgba(255,255,255,0.05); padding: 60px 5% 40px; }
    
    .faq-item { border-bottom: 1px solid rgba(255,255,255,0.08); padding: 24px 0; cursor: pointer; }
    .faq-answer { display: none; color: #aaa; margin-top: 12px; line-height: 1.7; }
    .faq-item.open .faq-answer { display: block; }
    .faq-item.open .faq-icon { transform: rotate(180deg); }
    .faq-icon { transition: transform 0.3s; }
    
    @media (max-width: 768px) {
      .hero { padding: 100px 5% 60px; }
      .section-title { font-size: 2rem; }
      .plan-card.featured { transform: scale(1); }
    }
    
    .particles { position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none; overflow: hidden; }
    .particle { position: absolute; width: 4px; height: 4px; background: #2FBF71; border-radius: 50%; opacity: 0.3; animation: rise linear infinite; }
    @keyframes rise { 0% { transform: translateY(100vh) scale(0); opacity: 0; } 10% { opacity: 0.4; } 90% { opacity: 0.2; } 100% { transform: translateY(-100px) scale(1); opacity: 0; } }
  </style>
</head>
<body>

<!-- NAVBAR -->
<nav>
  <div class="logo">
    <div class="logo-icon">💚</div>
    <span class="gradient-text">VerdeMais</span>
  </div>
  <div style="display:flex;gap:12px;align-items:center;">
    <a href="#features" style="color:#aaa;text-decoration:none;font-size:0.9rem;display:none;" class="md-show">Funcionalidades</a>
    <a href="#planos" style="color:#aaa;text-decoration:none;font-size:0.9rem;display:none;" class="md-show">Planos</a>
    <a href="/login" class="btn-outline" style="padding:10px 20px;font-size:0.85rem;">Entrar</a>
    <a href="/cadastro" class="btn-primary" style="padding:10px 20px;font-size:0.85rem;">Começar Grátis</a>
  </div>
</nav>

<!-- HERO -->
<section class="hero">
  <div class="particles" id="particles"></div>
  <div style="max-width:1400px;margin:0 auto;display:grid;grid-template-columns:1fr 1fr;gap:80px;align-items:center;width:100%;">
    <div>
      <div style="display:inline-flex;align-items:center;gap:8px;background:rgba(47,191,113,0.1);border:1px solid rgba(47,191,113,0.3);padding:8px 16px;border-radius:50px;margin-bottom:32px;font-size:0.85rem;color:#2FBF71;">
        <span>🚀</span> Lançamento — Plano Free para sempre
      </div>
      <h1 style="font-size:3.5rem;font-weight:900;line-height:1.1;margin-bottom:24px;">
        Seu <span class="gradient-text">Mentor</span><br>Financeiro<br>Digital
      </h1>
      <p style="color:#aaa;font-size:1.2rem;line-height:1.7;margin-bottom:40px;max-width:500px;">
        Organize suas finanças, trace metas ousadas e construa patrimônio com estratégia e clareza. <strong style="color:#2FBF71;">VerdeMais</strong> transforma disciplina financeira em conquistas reais.
      </p>
      <div style="display:flex;gap:16px;flex-wrap:wrap;margin-bottom:48px;">
        <a href="/cadastro" class="btn-primary">
          <i class="fas fa-rocket"></i> Começar Gratuitamente
        </a>
        <a href="#features" class="btn-outline">
          <i class="fas fa-play-circle"></i> Ver como funciona
        </a>
      </div>
      <div style="display:flex;gap:32px;">
        <div>
          <div style="font-size:1.8rem;font-weight:800;color:#2FBF71;">+2.400</div>
          <div style="color:#666;font-size:0.85rem;">usuários ativos</div>
        </div>
        <div>
          <div style="font-size:1.8rem;font-weight:800;color:#2FBF71;">R$1.2M</div>
          <div style="color:#666;font-size:0.85rem;">economizados</div>
        </div>
        <div>
          <div style="font-size:1.8rem;font-weight:800;color:#2FBF71;">4.9⭐</div>
          <div style="color:#666;font-size:0.85rem;">avaliação média</div>
        </div>
      </div>
    </div>
    
    <!-- DASHBOARD MOCKUP -->
    <div class="floating glow mockup" style="max-width:480px;margin-left:auto;">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:20px;">
        <div style="width:12px;height:12px;background:#ff5f57;border-radius:50%;"></div>
        <div style="width:12px;height:12px;background:#febc2e;border-radius:50%;"></div>
        <div style="width:12px;height:12px;background:#28c840;border-radius:50%;"></div>
        <span style="color:#555;font-size:0.75rem;margin-left:8px;">dashboard • março 2026</span>
      </div>
      
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px;">
        <div class="stat-card">
          <div style="color:#888;font-size:0.75rem;margin-bottom:4px;">💰 Saldo do Mês</div>
          <div style="font-size:1.4rem;font-weight:800;color:#2FBF71;">R$ 2.840</div>
          <div style="color:#2FBF71;font-size:0.75rem;">▲ 12% vs anterior</div>
        </div>
        <div class="stat-card" style="background:rgba(255,80,80,0.08);border-color:rgba(255,80,80,0.2);">
          <div style="color:#888;font-size:0.75rem;margin-bottom:4px;">💸 Despesas</div>
          <div style="font-size:1.4rem;font-weight:800;color:#ff6b6b;">R$ 4.160</div>
          <div style="color:#ff6b6b;font-size:0.75rem;">▼ 8% vs anterior</div>
        </div>
      </div>
      
      <div style="background:rgba(47,191,113,0.05);border:1px solid rgba(47,191,113,0.15);border-radius:12px;padding:16px;margin-bottom:12px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
          <span style="font-size:0.8rem;color:#888;">Score Financeiro</span>
          <span style="font-size:1.1rem;font-weight:700;color:#2FBF71;">78/100</span>
        </div>
        <div style="background:rgba(255,255,255,0.1);border-radius:50px;height:8px;overflow:hidden;">
          <div style="background:linear-gradient(90deg,#2FBF71,#208040);width:78%;height:100%;border-radius:50px;"></div>
        </div>
        <div style="font-size:0.72rem;color:#2FBF71;margin-top:6px;">Saúde financeira boa 👍</div>
      </div>
      
      <div style="background:rgba(255,255,255,0.03);border-radius:12px;padding:12px;margin-bottom:8px;">
        <div style="font-size:0.75rem;color:#666;margin-bottom:8px;">Meta: Reserva de Emergência</div>
        <div style="display:flex;justify-content:space-between;margin-bottom:4px;">
          <span style="font-size:0.8rem;">R$ 8.000</span>
          <span style="font-size:0.8rem;color:#2FBF71;">68%</span>
        </div>
        <div style="background:rgba(255,255,255,0.1);border-radius:50px;height:6px;">
          <div style="background:#2FBF71;width:68%;height:100%;border-radius:50px;"></div>
        </div>
      </div>

      <div style="display:flex;gap:8px;">
        <div style="flex:1;background:rgba(47,191,113,0.08);border-radius:10px;padding:10px;text-align:center;">
          <div style="font-size:0.7rem;color:#666;">Investido</div>
          <div style="font-weight:700;color:#2FBF71;font-size:0.9rem;">R$ 12.5k</div>
        </div>
        <div style="flex:1;background:rgba(255,255,255,0.04);border-radius:10px;padding:10px;text-align:center;">
          <div style="font-size:0.7rem;color:#666;">Metas</div>
          <div style="font-weight:700;font-size:0.9rem;">3 ativas</div>
        </div>
        <div style="flex:1;background:rgba(255,255,255,0.04);border-radius:10px;padding:10px;text-align:center;">
          <div style="font-size:0.7rem;color:#666;">Disciplina</div>
          <div style="font-weight:700;color:#2FBF71;font-size:0.9rem;">94%</div>
        </div>
      </div>
    </div>
  </div>
</section>

<!-- FEATURES -->
<section id="features" style="background:rgba(255,255,255,0.01);">
  <h2 class="section-title">Tudo que você precisa para <span class="gradient-text">crescer financeiramente</span></h2>
  <p class="section-sub">Do controle diário de gastos até a construção de patrimônio — tudo numa plataforma só.</p>
  
  <div style="max-width:1200px;margin:0 auto;display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:24px;">
    ${[
      { icon: '📊', badge: null,     title: 'Dashboard em Tempo Real',       desc: 'Visão 360° das suas finanças. Saldo do mês, receitas, despesas, metas, investimentos e dívidas em uma tela só.' },
      { icon: '💸', badge: 'free',   title: 'Controle de Despesas',          desc: 'Categorize gastos, crie parcelas automáticas, vincule ao cartão e monitore vencimentos. 30 lançamentos/mês no Free.' },
      { icon: '💰', badge: 'free',   title: 'Receitas & Entradas',           desc: 'Registre salário, freelances e rendimentos. Veja o histórico por categoria e acompanhe a evolução mensal.' },
      { icon: '🎯', badge: 'free',   title: 'Metas Financeiras',             desc: 'Casa, carro, viagem, aposentadoria. O sistema calcula quanto poupar por mês para alcançar cada objetivo.' },
      { icon: '🛡️', badge: 'free',   title: 'Reserva de Emergência',         desc: 'Área dedicada para montar e acompanhar sua reserva. Marcos de 1/3/6/12 meses e dicas educativas.' },
      { icon: '💳', badge: 'free',   title: 'Gestão de Cartões',             desc: 'Controle limite, fatura e gastos de cada cartão. Compras parceladas, lançamentos retroativos e fechamento automático.' },
      { icon: '📈', badge: 'free',   title: 'Investimentos',                 desc: 'CDB, Tesouro, Ações, FIIs, Cripto, Caixinha CDI e mais. Acompanhe rentabilidade e diversificação da carteira.' },
      { icon: '🏠', badge: 'free',   title: 'Financiamentos & Empréstimos',  desc: 'Gerencie financiamentos imobiliários, veiculares e empréstimos. PRICE/SAC, simulação e amortização extraordinária.' },
      { icon: '🔔', badge: 'free',   title: 'Lembretes de Contas',           desc: 'Nunca pague multa por atraso. Configure alertas de vencimento para qualquer conta recorrente.' },
      { icon: '🧠', badge: 'premium', title: 'Score de Saúde Financeira',    desc: 'Pontuação de 0 a 100 com análise detalhada: taxa de poupança, comprometimento de dívidas e metas.' },
      { icon: '🤖', badge: 'premium', title: 'Análise com IA',               desc: 'Insights personalizados, alertas de padrão de consumo, análise da regra 50/30/20 e sugestões de economia.' },
      { icon: '📋', badge: 'premium', title: 'Relatórios & Simulações',      desc: 'Relatório anual mês a mês e simulador de investimentos: CDB, Tesouro, Ações, FII e projeções.' },
    ].map(f => `
      <div class="card" style="position:relative;">
        ${f.badge ? `<div style="position:absolute;top:16px;right:16px;background:${f.badge==='free'?'rgba(47,191,113,0.15)':'linear-gradient(135deg,rgba(162,155,254,0.2),rgba(47,191,113,0.15))'};color:${f.badge==='free'?'#2FBF71':'#a29bfe'};border:1px solid ${f.badge==='free'?'rgba(47,191,113,0.3)':'rgba(162,155,254,0.4)'};font-size:0.7rem;padding:3px 10px;border-radius:50px;font-weight:700;">${f.badge==='free'?'🌱 Free':'💎 Premium'}</div>` : ''}
        <div class="feature-icon">${f.icon}</div>
        <h3 style="font-size:1.1rem;font-weight:700;margin-bottom:12px;">${f.title}</h3>
        <p style="color:#888;line-height:1.6;font-size:0.9rem;">${f.desc}</p>
      </div>
    `).join('')}
  </div>
</section>

<!-- COMO FUNCIONA -->
<section>
  <h2 class="section-title">Simples como deve ser</h2>
  <p class="section-sub">Em menos de 2 minutos você já tem controle total das suas finanças.</p>
  <div style="max-width:900px;margin:0 auto;display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:40px;text-align:center;">
    ${[
      { n: '01', icon: '👤', title: 'Crie sua conta', desc: 'Cadastro gratuito em 30 segundos. Sem cartão de crédito.' },
      { n: '02', icon: '💵', title: 'Adicione seus dados', desc: 'Informe receitas, despesas e investimentos.' },
      { n: '03', icon: '🎯', title: 'Defina suas metas', desc: 'O sistema calcula o caminho para você.' },
      { n: '04', icon: '🏆', title: 'Conquiste resultados', desc: 'Acompanhe sua evolução e construa patrimônio.' }
    ].map(s => `
      <div style="position:relative;">
        <div style="font-size:0.75rem;color:#2FBF71;font-weight:700;margin-bottom:12px;letter-spacing:2px;">${s.n}</div>
        <div style="font-size:2.5rem;margin-bottom:16px;">${s.icon}</div>
        <h3 style="font-weight:700;margin-bottom:8px;">${s.title}</h3>
        <p style="color:#777;font-size:0.9rem;line-height:1.5;">${s.desc}</p>
      </div>
    `).join('')}
  </div>
</section>

<!-- PLANOS -->
<section id="planos" style="background:rgba(255,255,255,0.01);">
  <h2 class="section-title">Planos para cada fase da sua <span class="gradient-text">jornada</span></h2>
  <p class="section-sub">Comece grátis e evolua conforme suas necessidades crescem.</p>
  
  <div style="max-width:1100px;margin:0 auto;display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:24px;align-items:start;">
    
    <div class="plan-card">
      <div style="font-size:0.8rem;letter-spacing:2px;color:#888;margin-bottom:12px;">🌱 FREE</div>
      <div style="font-size:3rem;font-weight:900;margin-bottom:4px;">R$ 0</div>
      <div style="color:#666;margin-bottom:28px;">Para sempre, sem cartão</div>
      <ul style="list-style:none;margin-bottom:32px;display:flex;flex-direction:column;gap:12px;">
        <li><span class="check">✓</span> Dashboard completo</li>
        <li><span class="check">✓</span> Até 30 despesas e 10 receitas/mês</li>
        <li><span class="check">✓</span> Até 3 metas financeiras</li>
        <li><span class="check">✓</span> Até 3 investimentos</li>
        <li><span class="check">✓</span> Até 2 cartões e 5 lembretes</li>
        <li><span class="check">✓</span> Reserva de emergência</li>
        <li><span class="check">✓</span> 1 Financiamento e 2 Empréstimos</li>
        <li><span class="check">✓</span> Conquistas e gamificação</li>
        <li><span class="x-mark">✕</span> <span style="color:#555;">Score financeiro</span></li>
        <li><span class="x-mark">✕</span> <span style="color:#555;">Análise com IA</span></li>
        <li><span class="x-mark">✕</span> <span style="color:#555;">Relatório anual</span></li>
        <li><span class="x-mark">✕</span> <span style="color:#555;">Simulador de investimentos</span></li>
      </ul>
      <a href="/cadastro" class="btn-outline" style="width:100%;justify-content:center;">Começar Grátis</a>
    </div>
    
    <div class="plan-card featured">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
        <div style="font-size:0.8rem;letter-spacing:2px;color:#2FBF71;">💎 PREMIUM</div>
        <div style="background:#2FBF71;color:#fff;font-size:0.7rem;padding:4px 10px;border-radius:50px;font-weight:700;">MAIS POPULAR</div>
      </div>
      <div style="font-size:3rem;font-weight:900;margin-bottom:4px;">R$ 19<span style="font-size:1rem;color:#888;">/mês</span></div>
      <div style="color:#666;margin-bottom:28px;">Faturado mensalmente</div>
      <ul style="list-style:none;margin-bottom:32px;display:flex;flex-direction:column;gap:12px;">
        <li><span class="check">✓</span> Tudo do Free, sem limites</li>
        <li><span class="check">✓</span> Despesas, receitas e metas ilimitadas</li>
        <li><span class="check">✓</span> Até 10 cartões e lembretes ilimitados</li>
        <li><span class="check">✓</span> Investimentos e financiamentos ilimitados</li>
        <li><span class="check">✓</span> Score de saúde financeira (0-100)</li>
        <li><span class="check">✓</span> Análise com IA e insights personalizados</li>
        <li><span class="check">✓</span> Relatório anual completo</li>
        <li><span class="check">✓</span> Simulador de investimentos</li>
        <li><span class="check">✓</span> Amortização extraordinária</li>
        <li><span class="check">✓</span> Exportar em PDF</li>
      </ul>
      <a href="/cadastro" class="btn-primary" style="width:100%;justify-content:center;">Assinar Premium</a>
    </div>
    
    <div class="plan-card">
      <div style="font-size:0.8rem;letter-spacing:2px;color:#888;margin-bottom:12px;">🚀 PRO</div>
      <div style="font-size:3rem;font-weight:900;margin-bottom:4px;">R$ 49<span style="font-size:1rem;color:#888;">/mês</span></div>
      <div style="color:#666;margin-bottom:28px;">Para investidores exigentes</div>
      <ul style="list-style:none;margin-bottom:32px;display:flex;flex-direction:column;gap:12px;">
        <li><span class="check">✓</span> Tudo do Premium</li>
        <li><span class="check">✓</span> Cartões ilimitados</li>
        <li><span class="check">✓</span> Projeção patrimonial avançada</li>
        <li><span class="check">✓</span> Regra 50/30/20 personalizável</li>
        <li><span class="check">✓</span> Acesso à API REST para integrações</li>
        <li><span class="check">✓</span> Suporte prioritário</li>
      </ul>
      <a href="/cadastro" class="btn-outline" style="width:100%;justify-content:center;">Assinar Pro</a>
    </div>
  </div>
</section>

<!-- SEGURANÇA -->
<section>
  <div style="max-width:1000px;margin:0 auto;text-align:center;">
    <h2 class="section-title">Segurança de <span class="gradient-text">nível bancário</span></h2>
    <p class="section-sub">Seus dados financeiros merecem a máxima proteção.</p>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:20px;">
      ${[
        { icon: '🔐', title: 'Criptografia', desc: 'Dados criptografados com AES-256' },
        { icon: '🛡️', title: 'LGPD', desc: '100% em conformidade com a lei' },
        { icon: '🔒', title: 'Autenticação', desc: 'Tokens seguros e sessões protegidas' },
        { icon: '☁️', title: 'Edge Computing', desc: 'Hospedado na rede Cloudflare global' }
      ].map(s => `
        <div class="card" style="text-align:center;padding:24px;">
          <div style="font-size:2rem;margin-bottom:12px;">${s.icon}</div>
          <div style="font-weight:700;margin-bottom:6px;">${s.title}</div>
          <div style="color:#777;font-size:0.85rem;">${s.desc}</div>
        </div>
      `).join('')}
    </div>
  </div>
</section>

<!-- FAQ -->
<section style="background:rgba(255,255,255,0.01);">
  <h2 class="section-title">Perguntas <span class="gradient-text">frequentes</span></h2>
  <div style="max-width:700px;margin:0 auto;" id="faq">
    ${[
      { q: 'O plano Free é realmente gratuito para sempre?', a: 'Sim! O plano Free do VerdeMais não tem prazo de expiração. Você pode usar as funcionalidades básicas sem pagar nada, para sempre.' },
      { q: 'Meus dados financeiros ficam seguros?', a: 'Absolutamente. Usamos criptografia de nível bancário, hospedagem na rede global da Cloudflare e estamos em conformidade total com a LGPD.' },
      { q: 'Posso cancelar minha assinatura quando quiser?', a: 'Sim, sem multa e sem burocracia. Se cancelar, você continua com acesso até o fim do período pago, depois migra automaticamente para o Free.' },
      { q: 'O aplicativo funciona no celular?', a: 'Sim! VerdeMais é responsivo e funciona perfeitamente em qualquer dispositivo — desktop, tablet ou smartphone.' },
      { q: 'Quando haverá integração com bancos?', a: 'Estamos desenvolvendo a integração com Open Banking. Usuários Pro terão acesso em primeira mão quando lançarmos.' }
    ].map((f, i) => `
      <div class="faq-item" onclick="toggleFaq(${i})">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <span style="font-weight:600;">${f.q}</span>
          <i class="fas fa-chevron-down faq-icon" style="color:#2FBF71;"></i>
        </div>
        <div class="faq-answer">${f.a}</div>
      </div>
    `).join('')}
  </div>
</section>

<!-- CTA FINAL -->
<section style="text-align:center;padding:80px 5%;">
  <div style="max-width:600px;margin:0 auto;">
    <div style="font-size:3rem;margin-bottom:16px;">💚</div>
    <h2 style="font-size:2.5rem;font-weight:800;margin-bottom:16px;">Pronto para assumir o controle?</h2>
    <p style="color:#888;margin-bottom:40px;font-size:1.1rem;">Junte-se a milhares de brasileiros que já estão construindo patrimônio com o VerdeMais.</p>
    <a href="/cadastro" class="btn-primary" style="font-size:1.1rem;padding:16px 40px;">
      <i class="fas fa-rocket"></i> Criar minha conta grátis
    </a>
    <div style="margin-top:16px;color:#555;font-size:0.85rem;">Sem cartão de crédito • Setup em 2 minutos • Cancele quando quiser</div>
  </div>
</section>

<!-- FOOTER -->
<footer>
  <div style="max-width:1200px;margin:0 auto;">
    <div style="display:grid;grid-template-columns:2fr 1fr 1fr 1fr;gap:40px;margin-bottom:48px;">
      <div>
        <div class="logo" style="margin-bottom:16px;">
          <div class="logo-icon">💚</div>
          <span class="gradient-text">VerdeMais</span>
        </div>
        <p style="color:#666;line-height:1.7;font-size:0.9rem;max-width:280px;">Seu mentor financeiro digital. Organize hoje, conquiste amanhã.</p>
      </div>
      <div>
        <div style="font-weight:700;margin-bottom:16px;">Produto</div>
        <div style="display:flex;flex-direction:column;gap:10px;">
          <a href="#features" style="color:#666;text-decoration:none;font-size:0.9rem;">Funcionalidades</a>
          <a href="#planos" style="color:#666;text-decoration:none;font-size:0.9rem;">Preços</a>
          <a href="/app" style="color:#666;text-decoration:none;font-size:0.9rem;">Acessar App</a>
        </div>
      </div>
      <div>
        <div style="font-weight:700;margin-bottom:16px;">Legal</div>
        <div style="display:flex;flex-direction:column;gap:10px;">
          <a href="#" style="color:#666;text-decoration:none;font-size:0.9rem;">Privacidade</a>
          <a href="#" style="color:#666;text-decoration:none;font-size:0.9rem;">Termos de Uso</a>
          <a href="#" style="color:#666;text-decoration:none;font-size:0.9rem;">LGPD</a>
        </div>
      </div>
      <div>
        <div style="font-weight:700;margin-bottom:16px;">Contato</div>
        <div style="display:flex;flex-direction:column;gap:10px;">
          <a href="#" style="color:#666;text-decoration:none;font-size:0.9rem;">contato@verdemais.app</a>
          <a href="#" style="color:#666;text-decoration:none;font-size:0.9rem;">Suporte</a>
        </div>
      </div>
    </div>
    <div style="border-top:1px solid rgba(255,255,255,0.05);padding-top:24px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;">
      <div style="color:#555;font-size:0.85rem;">© 2026 VerdeMais. Todos os direitos reservados.</div>
      <div style="color:#555;font-size:0.85rem;">Feito com 💚 no Brasil</div>
    </div>
  </div>
</footer>

<script>
  // Particles
  const container = document.getElementById('particles')
  for (let i = 0; i < 20; i++) {
    const p = document.createElement('div')
    p.className = 'particle'
    p.style.left = Math.random() * 100 + '%'
    p.style.animationDuration = (5 + Math.random() * 10) + 's'
    p.style.animationDelay = (Math.random() * 10) + 's'
    p.style.width = (2 + Math.random() * 4) + 'px'
    p.style.height = p.style.width
    container.appendChild(p)
  }

  // FAQ
  function toggleFaq(i) {
    const items = document.querySelectorAll('.faq-item')
    items[i].classList.toggle('open')
  }
</script>
</body>
</html>`
}

function appShell() {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>VerdeMais – Finanças</title>
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <script src="https://cdn.tailwindcss.com"></script>
  <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/axios@1.6.0/dist/axios.min.js"></script>
  <link rel="stylesheet" href="/static/app.css?v=20260316-2">
</head>
<body>
  <div id="app">
    <div style="min-height:100vh;background:#0f0f1a;display:flex;align-items:center;justify-content:center;">
      <div style="text-align:center;">
        <div style="font-size:3rem;margin-bottom:16px;">💚</div>
        <div style="color:#2FBF71;font-size:1.2rem;font-weight:600;">Carregando VerdeMais...</div>
      </div>
    </div>
  </div>
  <script src="/static/app.js?v=20260316-2"></script>
  <script>
    // Registrar Service Worker para notificações push
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js', { scope: '/' })
          .then(reg => {
            window._swReg = reg
            // Ouvir mensagens do SW (ex: navegação)
            navigator.serviceWorker.addEventListener('message', e => {
              if (e.data?.type === 'NAVIGATE' && window.VM) {
                const page = e.data.url.replace('/app/', '').replace('/app', '') || 'dashboard'
                VM.navigate(page)
              }
            })
          }).catch(() => {})
      })
    }
  </script>
</body>
</html>`
}

export default app
