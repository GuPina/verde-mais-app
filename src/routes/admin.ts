import { Hono } from 'hono'

type Bindings = { DB: D1Database; ADMIN_PASSWORD?: string }

const admin = new Hono<{ Bindings: Bindings }>()

// ─── Middleware de autenticação ─────────────────────────────────────────────
// Aceita: query ?token=SENHA  ou  header Authorization: Bearer SENHA
// ou cookie admin_token=SENHA (persistência após login pelo painel)
admin.use('/*', async (c, next) => {
  const PASS = c.env.ADMIN_PASSWORD || 'verdemais@admin2026'

  const queryToken   = c.req.query('token') || ''
  const authHeader   = c.req.header('Authorization') || ''
  const bearerToken  = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
  const cookieHeader = c.req.header('Cookie') || ''
  const cookieToken  = cookieHeader.match(/admin_token=([^;]+)/)?.[1] || ''

  // Página de login (GET /admin/login)
  if (c.req.path === '/admin/login') return next()

  if (queryToken === PASS || bearerToken === PASS || cookieToken === PASS) {
    return next()
  }

  // Redireciona para tela de login embutida
  return c.html(loginPage())
})

// ─── GET /admin/login ────────────────────────────────────────────────────────
admin.get('/login', (c) => c.html(loginPage()))

admin.post('/login', async (c) => {
  const body   = await c.req.parseBody()
  const senha  = String(body['senha'] || '')
  const PASS   = c.env.ADMIN_PASSWORD || 'verdemais@admin2026'

  if (senha === PASS) {
    return new Response(null, {
      status: 302,
      headers: {
        'Location': '/admin',
        'Set-Cookie': `admin_token=${PASS}; Path=/admin; HttpOnly; SameSite=Strict; Max-Age=86400`
      }
    })
  }
  return c.html(loginPage('Senha incorreta. Tente novamente.'))
})

function loginPage(erro = '') {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>VerdeMais Admin — Login</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Segoe UI',system-ui,sans-serif;background:#0a0a14;color:#e0e0e0;min-height:100vh;display:flex;align-items:center;justify-content:center}
.box{background:#0f0f1f;border:1px solid #1f2937;border-radius:16px;padding:40px 36px;width:100%;max-width:380px;text-align:center}
.logo{font-size:2.5rem;margin-bottom:8px}
h1{font-size:1.2rem;font-weight:700;margin-bottom:4px}
.sub{color:#555;font-size:0.82rem;margin-bottom:28px}
input{background:#0d1117;border:1px solid #2a2a3e;color:#e0e0e0;border-radius:8px;padding:12px 14px;font-size:0.9rem;width:100%;margin-bottom:14px}
input:focus{outline:none;border-color:#2FBF71}
button{background:linear-gradient(135deg,#2FBF71,#208040);color:#fff;border:none;border-radius:8px;padding:12px;font-size:0.95rem;font-weight:700;width:100%;cursor:pointer}
button:hover{opacity:.9}
.erro{background:rgba(255,71,87,.12);border:1px solid rgba(255,71,87,.3);color:#ff4757;padding:10px 14px;border-radius:8px;font-size:0.82rem;margin-bottom:14px}
.badge{background:rgba(255,71,87,.12);color:#ff4757;font-size:0.65rem;padding:2px 8px;border-radius:4px;font-weight:700;vertical-align:middle;margin-left:6px}
</style>
</head>
<body>
<div class="box">
  <div class="logo">💚</div>
  <h1>VerdeMais <span class="badge">ADMIN</span></h1>
  <div class="sub">Painel restrito — insira a senha de administrador</div>
  ${erro ? `<div class="erro">⚠️ ${erro}</div>` : ''}
  <form method="POST" action="/admin/login">
    <input type="password" name="senha" placeholder="Senha de administrador" autofocus required>
    <button type="submit">Entrar no painel →</button>
  </form>
</div>
</body>
</html>`
}

// ─── GET /admin  → Painel HTML ───────────────────────────────────────────────
admin.get('/', async (c) => {
  return c.html(adminPanel())
})

// ─── GET /admin/api/stats  → Resumo geral ───────────────────────────────────
admin.get('/api/stats', async (c) => {
  const db = c.env.DB

  const tables = [
    'users', 'receitas', 'despesas', 'investimentos',
    'metas', 'emprestimos', 'financiamentos', 'cartoes',
    'lembretes', 'conquistas_usuario', 'reserva_emergencia'
  ]

  const counts: Record<string, number> = {}
  for (const t of tables) {
    const r = await db.prepare(`SELECT COUNT(*) as n FROM ${t}`).first() as any
    counts[t] = r?.n || 0
  }

  // Usuários detalhados
  const users = await db.prepare(
    `SELECT id, nome, email, plano,
            data_criacao,
            (SELECT COUNT(*) FROM receitas WHERE user_id = u.id) as receitas,
            (SELECT COUNT(*) FROM despesas WHERE user_id = u.id) as despesas,
            (SELECT COUNT(*) FROM investimentos WHERE user_id = u.id) as investimentos,
            (SELECT COUNT(*) FROM metas WHERE user_id = u.id) as metas,
            (SELECT COUNT(*) FROM conquistas_usuario WHERE user_id = u.id) as conquistas
     FROM users u
     ORDER BY data_criacao DESC`
  ).all()

  // Cadastros por dia (últimos 14 dias)
  const cadastrosDia = await db.prepare(
    `SELECT DATE(data_criacao) as dia, COUNT(*) as total
     FROM users
     WHERE data_criacao >= DATE('now', '-14 days')
     GROUP BY dia ORDER BY dia ASC`
  ).all()

  // Top conquistas
  const topConquistas = await db.prepare(
    `SELECT cd.titulo, cd.icone, COUNT(*) as total
     FROM conquistas_usuario cu
     JOIN conquistas_definicoes cd ON cu.conquista_codigo = cd.codigo
     GROUP BY cu.conquista_codigo ORDER BY total DESC LIMIT 10`
  ).all()

  // Planos
  const planos = await db.prepare(
    `SELECT plano, COUNT(*) as total FROM users GROUP BY plano`
  ).all()

  return c.json({
    counts,
    users: users.results,
    cadastrosDia: cadastrosDia.results,
    topConquistas: topConquistas.results,
    planos: planos.results
  })
})

// ─── POST /admin/api/query  → SQL arbitrário (somente SELECT) ────────────────
admin.post('/api/query', async (c) => {
  const { sql } = await c.req.json()
  if (!sql || typeof sql !== 'string') return c.json({ error: 'SQL obrigatório' }, 400)

  const normalized = sql.trim().toUpperCase()
  if (!normalized.startsWith('SELECT') && !normalized.startsWith('PRAGMA')) {
    return c.json({ error: 'Apenas SELECT e PRAGMA são permitidos neste painel.' }, 403)
  }

  try {
    const result = await c.env.DB.prepare(sql).all()
    return c.json({ rows: result.results, count: result.results.length })
  } catch (e: any) {
    return c.json({ error: e.message }, 400)
  }
})

// ─── DELETE /admin/api/user/:id  → Excluir usuário ───────────────────────────
admin.delete('/api/user/:id', async (c) => {
  const id = c.req.param('id')
  await c.env.DB.prepare('DELETE FROM users WHERE id = ?').bind(id).run()
  return c.json({ success: true, message: `Usuário ${id} excluído.` })
})

// ─── GET /admin/api/tables  → Listar tabelas ─────────────────────────────────
admin.get('/api/tables', async (c) => {
  const result = await c.env.DB.prepare(
    `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'd1_%' ORDER BY name`
  ).all()
  return c.json({ tables: (result.results as any[]).map(r => r.name) })
})

// ─── GET /admin/api/table/:name  → Dados de uma tabela (primeiras 200 linhas) ─
admin.get('/api/table/:name', async (c) => {
  const name = c.req.param('name').replace(/[^a-zA-Z0-9_]/g, '')
  const limit = parseInt(c.req.query('limit') || '100')
  const offset = parseInt(c.req.query('offset') || '0')
  const search = c.req.query('search') || ''

  try {
    const countResult = await c.env.DB.prepare(`SELECT COUNT(*) as n FROM ${name}`).first() as any
    const total = countResult?.n || 0

    let query = `SELECT * FROM ${name}`
    if (search) query += ` WHERE CAST(rowid AS TEXT) LIKE ?`
    query += ` ORDER BY rowid DESC LIMIT ? OFFSET ?`

    const params = search ? [`%${search}%`, limit, offset] : [limit, offset]
    const result = await c.env.DB.prepare(query).bind(...params).all()
    return c.json({ rows: result.results, total, limit, offset })
  } catch (e: any) {
    return c.json({ error: e.message }, 400)
  }
})

// ─── HTML do Painel Admin ─────────────────────────────────────────────────────
function adminPanel() {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>VerdeMais Admin</title>
<link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
<script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:'Segoe UI',system-ui,sans-serif;background:#0a0a14;color:#e0e0e0;min-height:100vh}
  ::-webkit-scrollbar{width:6px;height:6px}
  ::-webkit-scrollbar-track{background:#111}
  ::-webkit-scrollbar-thumb{background:#333;border-radius:3px}
  
  .sidebar{position:fixed;top:0;left:0;width:220px;height:100vh;background:#0f0f1f;border-right:1px solid #1a1a2e;padding:0;overflow-y:auto;z-index:100}
  .sidebar-logo{padding:20px 18px;border-bottom:1px solid #1a1a2e;display:flex;align-items:center;gap:10px}
  .sidebar-logo .icon{width:36px;height:36px;background:linear-gradient(135deg,#2FBF71,#208040);border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:1rem}
  .sidebar-logo span{font-weight:800;font-size:1rem;background:linear-gradient(135deg,#2FBF71,#208040);-webkit-background-clip:text;-webkit-text-fill-color:transparent}
  .sidebar-badge{font-size:0.6rem;background:#ff4757;color:#fff;padding:2px 6px;border-radius:4px;font-weight:700;-webkit-text-fill-color:#fff;margin-left:4px}
  .nav-item{display:flex;align-items:center;gap:10px;padding:11px 18px;color:#888;cursor:pointer;transition:all .2s;font-size:0.88rem;border-left:3px solid transparent}
  .nav-item:hover,.nav-item.active{color:#2FBF71;background:rgba(47,191,113,0.07);border-left-color:#2FBF71}
  .nav-item i{width:16px;text-align:center}
  .nav-section{padding:16px 18px 6px;font-size:0.65rem;color:#444;text-transform:uppercase;letter-spacing:1px}

  .main{margin-left:220px;min-height:100vh}
  .topbar{background:#0f0f1f;border-bottom:1px solid #1a1a2e;padding:14px 28px;display:flex;align-items:center;justify-content:space-between;position:sticky;top:0;z-index:50}
  .topbar-title{font-weight:700;font-size:1rem}
  .topbar-right{display:flex;align-items:center;gap:12px}
  .badge-online{background:rgba(47,191,113,0.15);color:#2FBF71;padding:4px 10px;border-radius:20px;font-size:0.75rem;border:1px solid rgba(47,191,113,0.3)}

  .content{padding:24px 28px}
  .page{display:none}.page.active{display:block}

  .grid-4{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:16px;margin-bottom:24px}
  .stat-card{background:#111827;border:1px solid #1f2937;border-radius:12px;padding:18px 20px;transition:border-color .2s}
  .stat-card:hover{border-color:#2FBF71}
  .stat-num{font-size:2rem;font-weight:800;line-height:1}
  .stat-label{color:#666;font-size:0.78rem;margin-top:4px}
  .stat-icon{font-size:1.8rem;margin-bottom:10px}

  .card{background:#111827;border:1px solid #1f2937;border-radius:12px;padding:20px;margin-bottom:20px}
  .card-title{font-size:0.8rem;font-weight:600;color:#888;text-transform:uppercase;letter-spacing:1px;margin-bottom:16px;display:flex;align-items:center;gap:8px}

  table{width:100%;border-collapse:collapse;font-size:0.82rem}
  th{text-align:left;padding:10px 12px;border-bottom:2px solid #1f2937;color:#888;font-size:0.72rem;text-transform:uppercase;letter-spacing:.5px;white-space:nowrap}
  td{padding:10px 12px;border-bottom:1px solid #1a1a2e;vertical-align:middle;max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  tr:hover td{background:rgba(47,191,113,0.04)}
  .table-wrap{overflow-x:auto;border-radius:8px;border:1px solid #1f2937}

  .btn{display:inline-flex;align-items:center;gap:6px;padding:8px 16px;border-radius:8px;border:none;cursor:pointer;font-size:0.82rem;font-weight:600;transition:all .2s}
  .btn-primary{background:#2FBF71;color:#fff}.btn-primary:hover{background:#208040}
  .btn-danger{background:#ff4757;color:#fff}.btn-danger:hover{background:#c0392b}
  .btn-ghost{background:rgba(255,255,255,0.06);color:#ccc;border:1px solid #333}.btn-ghost:hover{background:rgba(255,255,255,0.1)}
  .btn-sm{padding:5px 10px;font-size:0.75rem}

  input,select,textarea{background:#0d1117;border:1px solid #2a2a3e;color:#e0e0e0;border-radius:8px;padding:9px 12px;font-size:0.85rem;width:100%;font-family:inherit;transition:border-color .2s}
  input:focus,select:focus,textarea:focus{outline:none;border-color:#2FBF71}
  textarea{resize:vertical;min-height:80px;font-family:'Courier New',monospace}

  .pill{display:inline-block;padding:2px 8px;border-radius:20px;font-size:0.7rem;font-weight:600}
  .pill-green{background:rgba(47,191,113,0.15);color:#2FBF71}
  .pill-blue{background:rgba(116,185,255,0.15);color:#74b9ff}
  .pill-yellow{background:rgba(255,196,0,0.15);color:#ffc400}
  .pill-red{background:rgba(255,71,87,0.15);color:#ff4757}

  .toast{position:fixed;bottom:24px;right:24px;background:#111827;border:1px solid #2FBF71;padding:12px 20px;border-radius:10px;color:#2FBF71;font-size:0.85rem;z-index:9999;display:none;animation:slideIn .3s}
  @keyframes slideIn{from{transform:translateX(100%)}to{transform:translateX(0)}}

  .sql-result{background:#0d1117;border:1px solid #2a2a3e;border-radius:8px;padding:16px;margin-top:12px;overflow:auto;max-height:400px;font-family:'Courier New',monospace;font-size:0.8rem;white-space:pre}
  
  .loader{display:inline-block;width:16px;height:16px;border:2px solid #333;border-top-color:#2FBF71;border-radius:50%;animation:spin .6s linear infinite}
  @keyframes spin{to{transform:rotate(360deg)}}

  .chart-wrap{height:200px;position:relative}
  
  .pagination{display:flex;align-items:center;gap:8px;margin-top:12px}
  .page-info{color:#888;font-size:0.78rem;flex:1}

  @media(max-width:768px){
    .sidebar{width:0;overflow:hidden}
    .main{margin-left:0}
  }
</style>
</head>
<body>

<!-- SIDEBAR -->
<div class="sidebar">
  <div class="sidebar-logo">
    <div class="icon">💚</div>
    <span>VerdeMais</span>
    <span class="sidebar-badge">ADMIN</span>
  </div>
  
  <div class="nav-section">Visão Geral</div>
  <div class="nav-item active" onclick="showPage('dashboard')"><i class="fas fa-chart-pie"></i> Dashboard</div>
  <div class="nav-item" onclick="showPage('users')"><i class="fas fa-users"></i> Usuários</div>
  
  <div class="nav-section">Dados</div>
  <div class="nav-item" onclick="showPage('browser')"><i class="fas fa-table"></i> Explorador</div>
  <div class="nav-item" onclick="showPage('query')"><i class="fas fa-code"></i> SQL Console</div>
  
  <div class="nav-section">Sistema</div>
  <div class="nav-item" onclick="showPage('conquistas')"><i class="fas fa-trophy"></i> Conquistas</div>
</div>

<!-- MAIN -->
<div class="main">
  <div class="topbar">
    <div class="topbar-title" id="page-title">📊 Dashboard</div>
    <div class="topbar-right">
      <span class="badge-online">⬤ Local</span>
      <button class="btn btn-ghost btn-sm" onclick="refreshAll()"><i class="fas fa-sync-alt"></i> Atualizar</button>
    </div>
  </div>

  <div class="content">

    <!-- PAGE: DASHBOARD -->
    <div class="page active" id="page-dashboard">
      <div class="grid-4" id="stats-grid">
        <div class="stat-card"><div class="stat-icon">⏳</div><div class="stat-num" style="color:#888">—</div><div class="stat-label">Carregando...</div></div>
      </div>
      
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:20px;">
        <div class="card">
          <div class="card-title"><i class="fas fa-chart-bar"></i> Cadastros por Dia (14 dias)</div>
          <div class="chart-wrap"><canvas id="chart-cadastros"></canvas></div>
        </div>
        <div class="card">
          <div class="card-title"><i class="fas fa-trophy"></i> Top Conquistas Desbloqueadas</div>
          <div id="top-conquistas" style="font-size:0.82rem;"></div>
        </div>
      </div>

      <div class="card">
        <div class="card-title"><i class="fas fa-users"></i> Últimos Usuários Cadastrados</div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>#</th><th>Nome</th><th>Email</th><th>Plano</th><th>Receitas</th><th>Despesas</th><th>Conquistas</th><th>Cadastro</th><th></th></tr></thead>
            <tbody id="users-table-body"></tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- PAGE: USERS -->
    <div class="page" id="page-users">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;">
        <div>
          <div style="font-size:1.1rem;font-weight:700;">Usuários Cadastrados</div>
          <div style="color:#666;font-size:0.82rem;margin-top:2px;">Todos os usuários do sistema</div>
        </div>
        <input type="text" id="user-search" placeholder="🔍 Buscar por nome ou email..." style="width:260px;" oninput="filterUsers(this.value)">
      </div>
      <div class="card" style="padding:0;">
        <div class="table-wrap">
          <table>
            <thead><tr><th>#</th><th>Nome</th><th>Email</th><th>Plano</th><th>Receitas</th><th>Despesas</th><th>Invest.</th><th>Metas</th><th>Conquistas</th><th>Cadastro</th><th>Ações</th></tr></thead>
            <tbody id="all-users-body"></tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- PAGE: BROWSER -->
    <div class="page" id="page-browser">
      <div style="display:flex;gap:16px;align-items:flex-start;flex-wrap:wrap;margin-bottom:20px;">
        <div style="flex:0 0 180px;">
          <div style="font-size:0.75rem;color:#888;margin-bottom:8px;text-transform:uppercase;letter-spacing:1px;">Tabelas</div>
          <div id="tables-list" style="background:#111827;border:1px solid #1f2937;border-radius:10px;overflow:hidden;"></div>
        </div>
        <div style="flex:1;min-width:300px;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
            <div style="font-weight:700;" id="browser-title">Selecione uma tabela</div>
            <input type="text" id="browser-search" placeholder="🔍 Buscar..." style="width:180px;" oninput="browserSearch(this.value)">
          </div>
          <div id="browser-content"></div>
          <div class="pagination">
            <span class="page-info" id="browser-info"></span>
            <button class="btn btn-ghost btn-sm" id="btn-prev" onclick="browserPrev()" disabled><i class="fas fa-chevron-left"></i></button>
            <button class="btn btn-ghost btn-sm" id="btn-next" onclick="browserNext()"><i class="fas fa-chevron-right"></i></button>
          </div>
        </div>
      </div>
    </div>

    <!-- PAGE: SQL CONSOLE -->
    <div class="page" id="page-query">
      <div style="font-size:1.1rem;font-weight:700;margin-bottom:6px;">🖥️ SQL Console</div>
      <div style="color:#666;font-size:0.82rem;margin-bottom:20px;">Apenas comandos SELECT e PRAGMA são permitidos. Resultados em JSON.</div>

      <div class="card">
        <div style="margin-bottom:12px;">
          <div style="font-size:0.75rem;color:#888;margin-bottom:6px;text-transform:uppercase;letter-spacing:1px;">Consultas Rápidas</div>
          <div style="display:flex;flex-wrap:wrap;gap:8px;" id="quick-queries"></div>
        </div>
        <textarea id="sql-input" rows="4" placeholder="SELECT * FROM users LIMIT 10;"
          onkeydown="if(event.ctrlKey&&event.key==='Enter')runSQL()"></textarea>
        <div style="display:flex;gap:10px;margin-top:10px;">
          <button class="btn btn-primary" onclick="runSQL()"><i class="fas fa-play"></i> Executar (Ctrl+Enter)</button>
          <button class="btn btn-ghost" onclick="document.getElementById('sql-input').value='';document.getElementById('sql-result').innerHTML=''">Limpar</button>
        </div>
        <div id="sql-result"></div>
      </div>
    </div>

    <!-- PAGE: CONQUISTAS -->
    <div class="page" id="page-conquistas">
      <div style="font-size:1.1rem;font-weight:700;margin-bottom:20px;">🏆 Definições de Conquistas</div>
      <div class="card" style="padding:0;">
        <div class="table-wrap">
          <table>
            <thead><tr><th>Ícone</th><th>Código</th><th>Título</th><th>Descrição</th><th>Pontos</th><th>Raridade</th><th>Desbloqueadas</th></tr></thead>
            <tbody id="conquistas-body"></tbody>
          </table>
        </div>
      </div>
    </div>

  </div><!-- /content -->
</div><!-- /main -->

<div class="toast" id="toast"></div>

<script>
let statsData = null
let allUsers = []
let currentTable = ''
let browserOffset = 0
let browserLimit = 50
let browserTotal = 0

const QUICK_SQL = [
  { label: 'Usuários', sql: 'SELECT id, nome, email, plano, data_criacao FROM users ORDER BY id DESC LIMIT 50' },
  { label: 'Receitas', sql: 'SELECT * FROM receitas ORDER BY id DESC LIMIT 50' },
  { label: 'Despesas', sql: 'SELECT * FROM despesas ORDER BY id DESC LIMIT 50' },
  { label: 'Investimentos', sql: 'SELECT * FROM investimentos ORDER BY id DESC LIMIT 50' },
  { label: 'Metas', sql: 'SELECT * FROM metas ORDER BY id DESC LIMIT 50' },
  { label: 'Financiamentos', sql: 'SELECT * FROM financiamentos ORDER BY id DESC LIMIT 50' },
  { label: 'Empréstimos', sql: 'SELECT * FROM emprestimos ORDER BY id DESC LIMIT 50' },
  { label: 'Conquistas usuário', sql: 'SELECT cu.*, cd.titulo FROM conquistas_usuario cu JOIN conquistas_definicoes cd ON cu.conquista_codigo=cd.codigo ORDER BY cu.id DESC LIMIT 100' },
  { label: 'Planos', sql: 'SELECT plano, COUNT(*) as total FROM users GROUP BY plano' },
  { label: 'Reservas', sql: 'SELECT re.*, u.nome FROM reserva_emergencia re JOIN users u ON re.user_id=u.id' },
]

async function api(path, opts = {}) {
  const r = await fetch('/admin' + path, { ...opts, headers: { 'Content-Type': 'application/json', ...(opts.headers||{}) } })
  return r.json()
}

function toast(msg, ok = true) {
  const t = document.getElementById('toast')
  t.textContent = msg
  t.style.display = 'block'
  t.style.borderColor = ok ? '#2FBF71' : '#ff4757'
  t.style.color = ok ? '#2FBF71' : '#ff4757'
  setTimeout(() => t.style.display = 'none', 3000)
}

function showPage(p) {
  document.querySelectorAll('.page').forEach(el => el.classList.remove('active'))
  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'))
  document.getElementById('page-' + p).classList.add('active')
  event.currentTarget.classList.add('active')
  const titles = { dashboard:'📊 Dashboard', users:'👥 Usuários', browser:'🗃️ Explorador de Tabelas', query:'🖥️ SQL Console', conquistas:'🏆 Conquistas' }
  document.getElementById('page-title').textContent = titles[p] || p
  if (p === 'browser' && !currentTable) loadTables()
  if (p === 'conquistas') loadConquistas()
  if (p === 'query') loadQuickSQL()
}

function planoColor(p) {
  if (p === 'pro') return 'pill-yellow'
  if (p === 'premium') return 'pill-blue'
  return 'pill-green'
}

async function loadStats() {
  const data = await api('/api/stats')
  statsData = data
  allUsers = data.users || []

  // Stat cards
  const c = data.counts || {}
  const cards = [
    { icon: '👤', num: c.users, label: 'Usuários', color: '#2FBF71' },
    { icon: '💰', num: c.receitas, label: 'Receitas', color: '#74b9ff' },
    { icon: '💸', num: c.despesas, label: 'Despesas', color: '#ff6b6b' },
    { icon: '📈', num: c.investimentos, label: 'Investimentos', color: '#a29bfe' },
    { icon: '🎯', num: c.metas, label: 'Metas', color: '#ffc400' },
    { icon: '🏠', num: c.financiamentos, label: 'Financiamentos', color: '#fd79a8' },
    { icon: '🏆', num: c.conquistas_usuario, label: 'Conquistas ganhas', color: '#fdcb6e' },
    { icon: '🛡️', num: c.reserva_emergencia, label: 'Reservas', color: '#55efc4' },
  ]
  document.getElementById('stats-grid').innerHTML = cards.map(c =>
    \`<div class="stat-card">
      <div class="stat-icon">\${c.icon}</div>
      <div class="stat-num" style="color:\${c.color}">\${c.num ?? 0}</div>
      <div class="stat-label">\${c.label}</div>
    </div>\`
  ).join('')

  // Chart cadastros
  const dias = data.cadastrosDia || []
  if (dias.length > 0) {
    const ctx = document.getElementById('chart-cadastros').getContext('2d')
    new Chart(ctx, {
      type: 'bar',
      data: {
        labels: dias.map(d => d.dia ? d.dia.slice(5) : ''),
        datasets: [{ label: 'Cadastros', data: dias.map(d => d.total), backgroundColor: 'rgba(47,191,113,0.6)', borderColor: '#2FBF71', borderWidth: 1, borderRadius: 4 }]
      },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { ticks: { color: '#666', stepSize: 1 }, grid: { color: '#1a1a2e' } }, x: { ticks: { color: '#666' }, grid: { display: false } } } }
    })
  } else {
    document.getElementById('chart-cadastros').parentElement.innerHTML = '<div style="text-align:center;color:#444;padding:40px;font-size:0.85rem;">Sem cadastros nos últimos 14 dias</div>'
  }

  // Top conquistas
  const tc = data.topConquistas || []
  document.getElementById('top-conquistas').innerHTML = tc.length === 0
    ? '<div style="color:#444;text-align:center;padding:20px;">Nenhuma conquista ainda</div>'
    : tc.map((c, i) => \`
      <div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid #1a1a2e;">
        <span style="color:#888;font-size:0.75rem;width:20px;">#\${i+1}</span>
        <span style="font-size:1.2rem;">\${c.icone||'🏆'}</span>
        <span style="flex:1;font-size:0.82rem;">\${c.titulo}</span>
        <span class="pill pill-green">\${c.total}x</span>
      </div>
    \`).join('')

  // Users table (últimos 5)
  renderUsersTable(allUsers.slice(0, 5), 'users-table-body')
  renderUsersTable(allUsers, 'all-users-body')
}

function renderUsersTable(users, tbodyId) {
  const tbody = document.getElementById(tbodyId)
  if (!tbody) return
  tbody.innerHTML = users.map(u => \`
    <tr>
      <td style="color:#555;">#\${u.id}</td>
      <td><strong>\${u.nome}</strong></td>
      <td style="color:#888;">\${u.email}</td>
      <td><span class="pill \${planoColor(u.plano)}">\${u.plano||'free'}</span></td>
      <td style="color:#74b9ff;">\${u.receitas||0}</td>
      <td style="color:#ff6b6b;">\${u.despesas||0}</td>
      <td style="color:#a29bfe;">\${u.investimentos||0}</td>
      <td style="color:#ffc400;">\${u.metas||0}</td>
      <td style="color:#fdcb6e;">\${u.conquistas||0}</td>
      <td style="color:#555;font-size:0.75rem;">\${(u.data_criacao||'').slice(0,10)}</td>
      <td>
        <button class="btn btn-danger btn-sm" onclick="deleteUser(\${u.id},'\\${u.nome.replace(/'/g,'')}')">
          <i class="fas fa-trash"></i>
        </button>
      </td>
    </tr>
  \`).join('') || '<tr><td colspan="11" style="text-align:center;color:#444;padding:24px;">Nenhum usuário</td></tr>'
}

function filterUsers(q) {
  const filtered = allUsers.filter(u =>
    u.nome.toLowerCase().includes(q.toLowerCase()) ||
    u.email.toLowerCase().includes(q.toLowerCase())
  )
  renderUsersTable(filtered, 'all-users-body')
}

async function deleteUser(id, nome) {
  if (!confirm(\`Excluir o usuário "\${nome}" e TODOS os seus dados? Esta ação não pode ser desfeita.\`)) return
  const r = await api(\`/api/user/\${id}\`, { method: 'DELETE' })
  if (r.success) {
    toast('Usuário excluído com sucesso!')
    allUsers = allUsers.filter(u => u.id !== id)
    renderUsersTable(allUsers, 'all-users-body')
    renderUsersTable(allUsers.slice(0,5), 'users-table-body')
  } else {
    toast('Erro ao excluir', false)
  }
}

async function loadTables() {
  const data = await api('/api/tables')
  const list = document.getElementById('tables-list')
  list.innerHTML = (data.tables || []).map(t => \`
    <div style="padding:9px 14px;cursor:pointer;font-size:0.82rem;color:#888;border-bottom:1px solid #1a1a2e;transition:all .15s;"
      onmouseover="this.style.background='rgba(47,191,113,0.07)';this.style.color='#2FBF71'"
      onmouseout="this.style.background='';this.style.color=currentTable==='\${t}'?'#2FBF71':'#888'"
      onclick="loadTable('\${t}')"
      id="tbl-\${t}">\${t}</div>
  \`).join('')
}

async function loadTable(name, offset = 0) {
  currentTable = name
  browserOffset = offset
  document.getElementById('browser-title').textContent = '📋 ' + name
  document.getElementById('browser-content').innerHTML = '<div style="color:#888;padding:20px;text-align:center;"><span class="loader"></span> Carregando...</div>'

  // Highlight selected
  document.querySelectorAll('[id^="tbl-"]').forEach(el => {
    el.style.color = el.id === 'tbl-' + name ? '#2FBF71' : '#888'
    el.style.background = el.id === 'tbl-' + name ? 'rgba(47,191,113,0.07)' : ''
  })

  const search = document.getElementById('browser-search').value
  const data = await api(\`/api/table/\${name}?limit=\${browserLimit}&offset=\${browserOffset}&search=\${encodeURIComponent(search)}\`)

  if (data.error) {
    document.getElementById('browser-content').innerHTML = \`<div style="color:#ff4757;padding:12px">\${data.error}</div>\`
    return
  }

  browserTotal = data.total || 0
  const rows = data.rows || []

  if (rows.length === 0) {
    document.getElementById('browser-content').innerHTML = '<div style="color:#444;padding:24px;text-align:center;">Tabela vazia</div>'
    document.getElementById('browser-info').textContent = '0 registros'
    return
  }

  const cols = Object.keys(rows[0])
  document.getElementById('browser-content').innerHTML = \`
    <div class="table-wrap">
      <table>
        <thead><tr>\${cols.map(c=>\`<th>\${c}</th>\`).join('')}</tr></thead>
        <tbody>\${rows.map(r=>\`<tr>\${cols.map(c=>\`<td title="\${String(r[c]??'').replace(/"/g,'&quot;')}">\${formatCell(r[c])}</td>\`).join('')}</tr>\`).join('')}</tbody>
      </table>
    </div>
  \`

  const from = browserOffset + 1, to = Math.min(browserOffset + browserLimit, browserTotal)
  document.getElementById('browser-info').textContent = \`\${from}–\${to} de \${browserTotal} registros\`
  document.getElementById('btn-prev').disabled = browserOffset === 0
  document.getElementById('btn-next').disabled = to >= browserTotal
}

function formatCell(v) {
  if (v === null || v === undefined) return '<span style="color:#333;font-style:italic;">null</span>'
  const s = String(v)
  if (s.length > 60) return s.slice(0, 60) + '…'
  return s.replace(/</g, '&lt;')
}

function browserSearch(q) {
  if (currentTable) loadTable(currentTable, 0)
}
function browserPrev() { loadTable(currentTable, Math.max(0, browserOffset - browserLimit)) }
function browserNext() { loadTable(currentTable, browserOffset + browserLimit) }

async function runSQL() {
  const sql = document.getElementById('sql-input').value.trim()
  if (!sql) return
  const el = document.getElementById('sql-result')
  el.innerHTML = '<span class="loader"></span> Executando...'

  const data = await api('/api/query', { method: 'POST', body: JSON.stringify({ sql }) })

  if (data.error) {
    el.innerHTML = \`<div style="color:#ff4757;margin-top:12px">❌ \${data.error}</div>\`
    return
  }

  const rows = data.rows || []
  if (rows.length === 0) {
    el.innerHTML = '<div style="color:#666;margin-top:12px">Nenhum resultado retornado. (' + (data.count||0) + ' linhas)</div>'
    return
  }

  const cols = Object.keys(rows[0])
  el.innerHTML = \`
    <div style="margin-top:12px;">
      <div style="color:#888;font-size:0.75rem;margin-bottom:8px;">\${data.count} resultado(s)</div>
      <div class="table-wrap">
        <table>
          <thead><tr>\${cols.map(c=>\`<th>\${c}</th>\`).join('')}</tr></thead>
          <tbody>\${rows.map(r=>\`<tr>\${cols.map(c=>\`<td title="\${String(r[c]??'').replace(/"/g,'&quot;')}">\${formatCell(r[c])}</td>\`).join('')}</tr>\`).join('')}</tbody>
        </table>
      </div>
    </div>
  \`
}

function loadQuickSQL() {
  document.getElementById('quick-queries').innerHTML = QUICK_SQL.map(q =>
    \`<button class="btn btn-ghost btn-sm" onclick="setSQL(\\\`\${q.sql}\\\`)">\${q.label}</button>\`
  ).join('')
}
function setSQL(s) {
  document.getElementById('sql-input').value = s
  runSQL()
}

async function loadConquistas() {
  const data = await api('/api/query', {
    method: 'POST',
    body: JSON.stringify({ sql: \`
      SELECT cd.*, COUNT(cu.id) as desbloqueadas
      FROM conquistas_definicoes cd
      LEFT JOIN conquistas_usuario cu ON cd.codigo = cu.conquista_codigo
      GROUP BY cd.codigo ORDER BY desbloqueadas DESC, cd.pontos ASC
    \` })
  })
  const rows = data.rows || []
  const rarCor = { comum:'pill-green', raro:'pill-blue', epico:'pill-yellow', lendario:'pill-red' }
  document.getElementById('conquistas-body').innerHTML = rows.map(r => \`
    <tr>
      <td style="font-size:1.3rem;text-align:center;">\${r.icone||'🏆'}</td>
      <td style="font-family:monospace;color:#74b9ff;font-size:0.78rem;">\${r.codigo}</td>
      <td><strong>\${r.titulo}</strong></td>
      <td style="color:#888;max-width:260px;white-space:normal;line-height:1.4;">\${r.descricao}</td>
      <td style="color:#ffc400;text-align:center;">\${r.pontos}</td>
      <td><span class="pill \${rarCor[r.raridade]||'pill-green'}">\${r.raridade}</span></td>
      <td style="text-align:center;">\${r.desbloqueadas > 0 ? \`<span class="pill pill-green">\${r.desbloqueadas}x</span>\` : '<span style="color:#333;">—</span>'}</td>
    </tr>
  \`).join('')
}

function refreshAll() { loadStats(); toast('Dados atualizados!') }

// Init
loadStats()
loadQuickSQL()
</script>
</body>
</html>`
}

export default admin
