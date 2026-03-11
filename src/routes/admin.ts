import { Hono } from 'hono'

type Bindings = { DB: D1Database; ADMIN_PASSWORD?: string }

const admin = new Hono<{ Bindings: Bindings }>()

// ─── Middleware de autenticação ─────────────────────────────────────────────
admin.use('/*', async (c, next) => {
  const PASS = c.env.ADMIN_PASSWORD || 'verdemais@admin2026'

  const queryToken   = c.req.query('token') || ''
  const authHeader   = c.req.header('Authorization') || ''
  const bearerToken  = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
  const cookieHeader = c.req.header('Cookie') || ''
  const cookieToken  = cookieHeader.match(/admin_token=([^;]+)/)?.[1] || ''

  // Rota de login sempre livre
  if (c.req.path === '/admin/login') return next()

  // Autenticado?
  if (queryToken === PASS || bearerToken === PASS || cookieToken === PASS) {
    return next()
  }

  // Para rotas de API, retornar 401 JSON
  if (c.req.path.startsWith('/admin/api/')) {
    return c.json({ error: 'Não autorizado' }, 401)
  }

  // Para rotas HTML, redirecionar para login
  return c.redirect('/admin/login')
})

// ─── GET /admin/login ────────────────────────────────────────────────────────
admin.get('/login', (c) => c.html(loginPage()))

admin.post('/login', async (c) => {
  const body  = await c.req.parseBody()
  const senha = String(body['senha'] || '')
  const PASS  = c.env.ADMIN_PASSWORD || 'verdemais@admin2026'
  const isSecure = c.req.url.startsWith('https://')
  const secureFlag = isSecure ? '; Secure' : ''

  if (senha === PASS) {
    return new Response(null, {
      status: 302,
      headers: {
        'Location': '/admin',
        'Set-Cookie': `admin_token=${PASS}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400${secureFlag}`
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
    <input type="password" name="senha" placeholder="Senha de administrador" autofocus>
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

  const users = await db.prepare(
    `SELECT id, nome, email, plano, data_criacao,
            (SELECT COUNT(*) FROM receitas WHERE user_id = u.id) as receitas,
            (SELECT COUNT(*) FROM despesas WHERE user_id = u.id) as despesas,
            (SELECT COUNT(*) FROM investimentos WHERE user_id = u.id) as investimentos,
            (SELECT COUNT(*) FROM metas WHERE user_id = u.id) as metas,
            (SELECT COUNT(*) FROM conquistas_usuario WHERE user_id = u.id) as conquistas
     FROM users u ORDER BY data_criacao DESC`
  ).all()

  const cadastrosDia = await db.prepare(
    `SELECT DATE(data_criacao) as dia, COUNT(*) as total
     FROM users WHERE data_criacao >= DATE('now', '-14 days')
     GROUP BY dia ORDER BY dia ASC`
  ).all()

  const topConquistas = await db.prepare(
    `SELECT cd.titulo, cd.icone, COUNT(*) as total
     FROM conquistas_usuario cu
     JOIN conquistas_definicoes cd ON cu.conquista_codigo = cd.codigo
     GROUP BY cu.conquista_codigo ORDER BY total DESC LIMIT 10`
  ).all()

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

// ─── POST /admin/api/query  → SQL (somente SELECT/PRAGMA) ────────────────────
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

// ─── PATCH /admin/api/user/:id/plano  → Alterar plano ────────────────────────
admin.patch('/api/user/:id/plano', async (c) => {
  const id = c.req.param('id')
  const { plano } = await c.req.json()

  const planosValidos = ['free', 'premium', 'pro']
  if (!planosValidos.includes(plano)) {
    return c.json({ error: 'Plano inválido. Use: free, premium ou pro' }, 400)
  }

  await c.env.DB.prepare('UPDATE users SET plano = ? WHERE id = ?').bind(plano, id).run()
  await c.env.DB.prepare(`UPDATE assinaturas SET plano = ?, status = 'ativo' WHERE user_id = ?`).bind(plano, id).run()

  const user = await c.env.DB.prepare('SELECT nome FROM users WHERE id = ?').bind(id).first() as any
  return c.json({ success: true, message: `Plano de ${user?.nome || 'usuário'} atualizado para ${plano.toUpperCase()}` })
})

// ─── GET /admin/api/tables ────────────────────────────────────────────────────
admin.get('/api/tables', async (c) => {
  const result = await c.env.DB.prepare(
    `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'd1_%' ORDER BY name`
  ).all()
  return c.json({ tables: (result.results as any[]).map(r => r.name) })
})

// ─── GET /admin/api/table/:name ──────────────────────────────────────────────
admin.get('/api/table/:name', async (c) => {
  const name   = c.req.param('name').replace(/[^a-zA-Z0-9_]/g, '')
  const limit  = parseInt(c.req.query('limit')  || '100')
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

// ─── HTML do Painel — JS externo em /static/admin.js ─────────────────────────
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
  .btn-danger{background:rgba(255,71,87,0.15);color:#ff4757;border:1px solid rgba(255,71,87,0.3)}.btn-danger:hover{background:#ff4757;color:#fff}
  .btn-ghost{background:rgba(255,255,255,0.06);color:#ccc;border:1px solid #333}.btn-ghost:hover{background:rgba(255,255,255,0.12)}
  .btn-sm{padding:4px 10px;font-size:0.78rem;border-radius:6px}
  input,select,textarea{background:#0d1117;border:1px solid #2a2a3e;color:#e0e0e0;border-radius:8px;padding:9px 12px;font-size:0.85rem;width:100%;font-family:inherit;transition:border-color .2s}
  input:focus,select:focus,textarea:focus{outline:none;border-color:#2FBF71}
  textarea{resize:vertical;min-height:80px;font-family:'Courier New',monospace}
  .pill{display:inline-block;padding:2px 10px;border-radius:20px;font-size:0.7rem;font-weight:700}
  .pill-green{background:rgba(47,191,113,0.15);color:#2FBF71;border:1px solid rgba(47,191,113,0.3)}
  .pill-blue{background:rgba(116,185,255,0.15);color:#74b9ff;border:1px solid rgba(116,185,255,0.3)}
  .pill-yellow{background:rgba(255,196,0,0.15);color:#ffc400;border:1px solid rgba(255,196,0,0.3)}
  .pill-red{background:rgba(255,71,87,0.15);color:#ff4757;border:1px solid rgba(255,71,87,0.3)}
  .toast{position:fixed;bottom:24px;right:24px;background:#111827;border:1px solid #2FBF71;padding:12px 20px;border-radius:10px;color:#2FBF71;font-size:0.85rem;z-index:9999;display:none}
  .sql-result{background:#0d1117;border:1px solid #2a2a3e;border-radius:8px;padding:16px;margin-top:12px;overflow:auto;max-height:400px}
  .loader{display:inline-block;width:16px;height:16px;border:2px solid #333;border-top-color:#2FBF71;border-radius:50%;animation:spin .6s linear infinite}
  @keyframes spin{to{transform:rotate(360deg)}}
  .chart-wrap{height:200px;position:relative}
  .pagination{display:flex;align-items:center;gap:8px;margin-top:12px}
  .page-info{color:#888;font-size:0.78rem;flex:1}
  @media(max-width:768px){.sidebar{width:0;overflow:hidden}.main{margin-left:0}}
</style>
</head>
<body>

<div class="sidebar">
  <div class="sidebar-logo">
    <div class="icon">💚</div>
    <span>VerdeMais</span>
    <span class="sidebar-badge">ADMIN</span>
  </div>
  <div class="nav-section">Visão Geral</div>
  <div class="nav-item active" id="nav-dashboard" onclick="showPage('dashboard', this)"><i class="fas fa-chart-pie"></i> Dashboard</div>
  <div class="nav-item" id="nav-users" onclick="showPage('users', this)"><i class="fas fa-users"></i> Usuários</div>
  <div class="nav-section">Dados</div>
  <div class="nav-item" id="nav-browser" onclick="showPage('browser', this)"><i class="fas fa-table"></i> Explorador</div>
  <div class="nav-item" id="nav-query" onclick="showPage('query', this)"><i class="fas fa-code"></i> SQL Console</div>
  <div class="nav-section">Sistema</div>
  <div class="nav-item" id="nav-conquistas" onclick="showPage('conquistas', this)"><i class="fas fa-trophy"></i> Conquistas</div>
</div>

<div class="main">
  <div class="topbar">
    <div class="topbar-title" id="page-title">📊 Dashboard</div>
    <div class="topbar-right">
      <span class="badge-online">⬤ Online</span>
      <button class="btn btn-ghost btn-sm" onclick="refreshAll()"><i class="fas fa-sync-alt"></i> Atualizar</button>
    </div>
  </div>

  <div class="content">

    <!-- DASHBOARD -->
    <div class="page active" id="page-dashboard">
      <div class="grid-4" id="stats-grid">
        <div class="stat-card"><div class="stat-icon">⏳</div><div class="stat-num" style="color:#444">—</div><div class="stat-label">Carregando...</div></div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:20px;">
        <div class="card">
          <div class="card-title"><i class="fas fa-chart-bar"></i> Cadastros por Dia (14 dias)</div>
          <div class="chart-wrap"><canvas id="chart-cadastros"></canvas></div>
        </div>
        <div class="card">
          <div class="card-title"><i class="fas fa-trophy"></i> Top Conquistas</div>
          <div id="top-conquistas" style="font-size:0.82rem;"></div>
        </div>
      </div>
      <div class="card">
        <div class="card-title"><i class="fas fa-users"></i> Últimos Usuários</div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>#</th><th>Nome / Email</th><th>Plano</th><th>Receitas</th><th>Despesas</th><th>Invest.</th><th>Metas</th><th>Conq.</th><th>Cadastro</th><th>Ações</th></tr></thead>
            <tbody id="users-table-body"><tr><td colspan="10" style="text-align:center;color:#444;padding:20px;">Carregando...</td></tr></tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- USUÁRIOS -->
    <div class="page" id="page-users">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;">
        <div>
          <div style="font-size:1.1rem;font-weight:700;">Usuários Cadastrados</div>
          <div style="color:#666;font-size:0.82rem;margin-top:2px;">Clique em ✏️ para alterar o plano de um usuário</div>
        </div>
        <input type="text" id="user-search" placeholder="🔍 Buscar por nome ou email..." style="width:280px;" oninput="filterUsers(this.value)">
      </div>
      <div class="card" style="padding:0;">
        <div class="table-wrap">
          <table>
            <thead><tr><th>#</th><th>Nome / Email</th><th>Plano</th><th>Receitas</th><th>Despesas</th><th>Invest.</th><th>Metas</th><th>Conq.</th><th>Cadastro</th><th>Ações</th></tr></thead>
            <tbody id="all-users-body"><tr><td colspan="10" style="text-align:center;color:#444;padding:20px;">Carregando...</td></tr></tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- EXPLORADOR -->
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

    <!-- SQL CONSOLE -->
    <div class="page" id="page-query">
      <div style="font-size:1.1rem;font-weight:700;margin-bottom:6px;">🖥️ SQL Console</div>
      <div style="color:#666;font-size:0.82rem;margin-bottom:20px;">Apenas SELECT e PRAGMA permitidos.</div>
      <div class="card">
        <div style="margin-bottom:12px;">
          <div style="font-size:0.75rem;color:#888;margin-bottom:6px;text-transform:uppercase;letter-spacing:1px;">Consultas Rápidas</div>
          <div style="display:flex;flex-wrap:wrap;gap:8px;" id="quick-queries"></div>
        </div>
        <textarea id="sql-input" placeholder="SELECT * FROM users LIMIT 10" style="margin-bottom:10px;font-size:0.82rem;"></textarea>
        <button class="btn btn-primary btn-sm" onclick="runSQL()"><i class="fas fa-play"></i> Executar</button>
        <div class="sql-result" id="sql-result"></div>
      </div>
    </div>

    <!-- CONQUISTAS -->
    <div class="page" id="page-conquistas">
      <div style="font-size:1.1rem;font-weight:700;margin-bottom:20px;">🏆 Conquistas Definidas</div>
      <div class="card" style="padding:0;">
        <div class="table-wrap">
          <table>
            <thead><tr><th>Ícone</th><th>Código</th><th>Título</th><th>Descrição</th><th>Pts</th><th>Raridade</th><th>Desbloqueadas</th></tr></thead>
            <tbody id="conquistas-body"></tbody>
          </table>
        </div>
      </div>
    </div>

  </div>
</div>

<div class="toast" id="toast"></div>

<script src="/static/admin.js"></script>
</body>
</html>`
}

export default admin
