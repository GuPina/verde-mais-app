// VerdeMais Admin Panel - JavaScript
'use strict'

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
  { label: 'Conquistas', sql: 'SELECT cu.*, cd.titulo FROM conquistas_usuario cu JOIN conquistas_definicoes cd ON cu.conquista_codigo=cd.codigo ORDER BY cu.id DESC LIMIT 100' },
  { label: 'Planos', sql: 'SELECT plano, COUNT(*) as total FROM users GROUP BY plano' },
  { label: 'Reservas', sql: 'SELECT re.*, u.nome FROM reserva_emergencia re JOIN users u ON re.user_id=u.id' },
]

// ─── API helper ───────────────────────────────────────────────────────────────
async function api(path, opts) {
  opts = opts || {}
  const headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {})
  const r = await fetch('/admin' + path, Object.assign({}, opts, { headers: headers }))
  return r.json()
}

// ─── Toast ────────────────────────────────────────────────────────────────────
function toast(msg, ok) {
  if (ok === undefined) ok = true
  const t = document.getElementById('toast')
  t.textContent = msg
  t.style.display = 'block'
  t.style.borderColor = ok ? '#2FBF71' : '#ff4757'
  t.style.color = ok ? '#2FBF71' : '#ff4757'
  setTimeout(function() { t.style.display = 'none' }, 3000)
}

// ─── Navegação de páginas ─────────────────────────────────────────────────────
function showPage(p, el) {
  document.querySelectorAll('.page').forEach(function(x) { x.classList.remove('active') })
  document.querySelectorAll('.nav-item').forEach(function(x) { x.classList.remove('active') })
  document.getElementById('page-' + p).classList.add('active')
  if (el) el.classList.add('active')
  var titles = { dashboard: '📊 Dashboard', users: '👥 Usuários', browser: '🗃️ Explorador de Tabelas', query: '🖥️ SQL Console', conquistas: '🏆 Conquistas' }
  document.getElementById('page-title').textContent = titles[p] || p
  if (p === 'browser' && !currentTable) loadTables()
  if (p === 'conquistas') loadConquistas()
  if (p === 'query') loadQuickSQL()
}

// ─── Cor do plano ─────────────────────────────────────────────────────────────
function planoColor(p) {
  if (p === 'pro') return 'pill-yellow'
  if (p === 'premium') return 'pill-blue'
  return 'pill-green'
}

// ─── Carrega stats ────────────────────────────────────────────────────────────
async function loadStats() {
  var data = await api('/api/stats')
  statsData = data
  allUsers = data.users || []

  var c = data.counts || {}
  var cards = [
    { icon: '👤', num: c.users, label: 'Usuários', color: '#2FBF71' },
    { icon: '💰', num: c.receitas, label: 'Receitas', color: '#74b9ff' },
    { icon: '💸', num: c.despesas, label: 'Despesas', color: '#ff6b6b' },
    { icon: '📈', num: c.investimentos, label: 'Investimentos', color: '#a29bfe' },
    { icon: '🎯', num: c.metas, label: 'Metas', color: '#ffc400' },
    { icon: '🏠', num: c.financiamentos, label: 'Financiamentos', color: '#fd79a8' },
    { icon: '🏆', num: c.conquistas_usuario, label: 'Conquistas', color: '#fdcb6e' },
    { icon: '🛡️', num: c.reserva_emergencia, label: 'Reservas', color: '#55efc4' },
  ]

  var statsGrid = document.getElementById('stats-grid')
  var statsHtml = ''
  cards.forEach(function(card) {
    statsHtml += '<div class="stat-card">'
    statsHtml += '<div class="stat-icon">' + card.icon + '</div>'
    statsHtml += '<div class="stat-num" style="color:' + card.color + '">' + (card.num != null ? card.num : 0) + '</div>'
    statsHtml += '<div class="stat-label">' + card.label + '</div>'
    statsHtml += '</div>'
  })
  statsGrid.innerHTML = statsHtml

  // Chart
  var dias = data.cadastrosDia || []
  var chartWrap = document.getElementById('chart-cadastros')
  if (dias.length > 0 && chartWrap) {
    var ctx = chartWrap.getContext('2d')
    new Chart(ctx, {
      type: 'bar',
      data: {
        labels: dias.map(function(d) { return d.dia ? d.dia.slice(5) : '' }),
        datasets: [{
          label: 'Cadastros',
          data: dias.map(function(d) { return d.total }),
          backgroundColor: 'rgba(47,191,113,0.6)',
          borderColor: '#2FBF71',
          borderWidth: 1,
          borderRadius: 4
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          y: { ticks: { color: '#666', stepSize: 1 }, grid: { color: '#1a1a2e' } },
          x: { ticks: { color: '#666' }, grid: { display: false } }
        }
      }
    })
  } else if (chartWrap) {
    chartWrap.parentElement.innerHTML = '<div style="text-align:center;color:#444;padding:40px;font-size:0.85rem;">Sem cadastros nos últimos 14 dias</div>'
  }

  // Top conquistas
  var tc = data.topConquistas || []
  var tcEl = document.getElementById('top-conquistas')
  if (tc.length === 0) {
    tcEl.innerHTML = '<div style="color:#444;text-align:center;padding:20px;">Nenhuma conquista ainda</div>'
  } else {
    var tcHtml = ''
    tc.forEach(function(item, i) {
      tcHtml += '<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid #1a1a2e;">'
      tcHtml += '<span style="color:#888;font-size:0.75rem;width:20px;">#' + (i + 1) + '</span>'
      tcHtml += '<span style="font-size:1.2rem;">' + (item.icone || '🏆') + '</span>'
      tcHtml += '<span style="flex:1;font-size:0.82rem;">' + (item.titulo || '') + '</span>'
      tcHtml += '<span class="pill pill-green">' + item.total + 'x</span>'
      tcHtml += '</div>'
    })
    tcEl.innerHTML = tcHtml
  }

  // Tabelas de usuários
  renderUsersTable(allUsers.slice(0, 5), 'users-table-body')
  renderUsersTable(allUsers, 'all-users-body')
}

// ─── Renderiza tabela de usuários ─────────────────────────────────────────────
function renderUsersTable(users, tbodyId) {
  var tbody = document.getElementById(tbodyId)
  if (!tbody) return
  if (!users || users.length === 0) {
    tbody.innerHTML = '<tr><td colspan="10" style="text-align:center;color:#444;padding:24px;">Nenhum usuário</td></tr>'
    return
  }
  var html = ''
  for (var i = 0; i < users.length; i++) {
    var user = users[i]
    var id = user.id
    var nome = (user.nome || '').replace(/'/g, '')
    var email = user.email || ''
    var plano = user.plano || 'free'
    var planoCls = planoColor(plano)
    var rec = user.receitas || 0
    var desp = user.despesas || 0
    var inv = user.investimentos || 0
    var metas = user.metas || 0
    var conq = user.conquistas || 0
    var dataCad = (user.data_criacao || '').slice(0, 10)

    html += '<tr>'
    html += '<td style="color:#555;">#' + id + '</td>'
    html += '<td><strong>' + (user.nome || '') + '</strong><br><span style="font-size:0.7rem;color:#555;">' + email + '</span></td>'
    html += '<td><div style="display:flex;align-items:center;gap:6px;">'
    html += '<span class="pill ' + planoCls + '" id="pill-' + id + '-' + tbodyId + '">' + plano.toUpperCase() + '</span>'
    html += '<button class="btn btn-ghost btn-sm" style="padding:2px 8px;font-size:0.7rem;" title="Alterar plano" '
    html += 'onclick="openPlanModal(' + id + ', \'' + nome + '\', \'' + plano + '\', \'' + tbodyId + '\')">'
    html += '✏️</button>'
    html += '</div></td>'
    html += '<td style="color:#74b9ff;">' + rec + '</td>'
    html += '<td style="color:#ff6b6b;">' + desp + '</td>'
    html += '<td style="color:#a29bfe;">' + inv + '</td>'
    html += '<td style="color:#ffc400;">' + metas + '</td>'
    html += '<td style="color:#fdcb6e;">' + conq + '</td>'
    html += '<td style="color:#555;font-size:0.75rem;">' + dataCad + '</td>'
    html += '<td><button class="btn btn-danger btn-sm" onclick="deleteUser(' + id + ', \'' + nome + '\')">'
    html += '🗑️</button></td>'
    html += '</tr>'
  }
  tbody.innerHTML = html
}

// ─── Filtro de usuários ───────────────────────────────────────────────────────
function filterUsers(q) {
  var filtered = allUsers.filter(function(u) {
    return (u.nome || '').toLowerCase().indexOf(q.toLowerCase()) >= 0 ||
           (u.email || '').toLowerCase().indexOf(q.toLowerCase()) >= 0
  })
  renderUsersTable(filtered, 'all-users-body')
}

// ─── Deletar usuário ──────────────────────────────────────────────────────────
async function deleteUser(id, nome) {
  if (!confirm('Excluir o usuário "' + nome + '" e TODOS os seus dados? Esta ação não pode ser desfeita.')) return
  var r = await api('/api/user/' + id, { method: 'DELETE' })
  if (r.success) {
    toast('Usuário excluído com sucesso!')
    allUsers = allUsers.filter(function(u) { return u.id !== id })
    renderUsersTable(allUsers, 'all-users-body')
    renderUsersTable(allUsers.slice(0, 5), 'users-table-body')
  } else {
    toast('Erro ao excluir', false)
  }
}

// ─── Modal de plano ───────────────────────────────────────────────────────────
function openPlanModal(userId, nome, planoAtual, tbodyId) {
  var old = document.getElementById('plan-modal-overlay')
  if (old) old.remove()

  var overlay = document.createElement('div')
  overlay.id = 'plan-modal-overlay'
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.75);z-index:9999;display:flex;align-items:center;justify-content:center;'

  var plans = [
    { value: 'free',    label: 'FREE',    color: '#2FBF71', desc: '3 metas · 2 cartões · 30 despesas/mês · sem IA' },
    { value: 'premium', label: 'PREMIUM', color: '#74b9ff', desc: 'Ilimitado · Score · IA insights · Relatório anual' },
    { value: 'pro',     label: 'PRO',     color: '#ffd700', desc: 'Tudo do Premium + API access · Sem limites' },
  ]

  var html = '<div style="background:#0f0f1f;border:1px solid #1f2937;border-radius:16px;padding:32px;width:100%;max-width:420px;position:relative;margin:16px;">'
  html += '<button onclick="document.getElementById(\'plan-modal-overlay\').remove()" style="position:absolute;top:12px;right:14px;background:none;border:none;color:#555;font-size:1.4rem;cursor:pointer;line-height:1;">✕</button>'
  html += '<div style="font-size:1.3rem;font-weight:700;margin-bottom:4px;">👑 Gerenciar Plano</div>'
  html += '<div style="color:#888;font-size:0.82rem;margin-bottom:22px;">Usuário: <strong style="color:#e0e0e0;">' + nome + '</strong> <span style="color:#555;">· ID ' + userId + '</span></div>'
  html += '<div style="font-size:0.75rem;color:#888;margin-bottom:10px;text-transform:uppercase;letter-spacing:1px;">Selecionar plano</div>'
  html += '<div style="display:flex;flex-direction:column;gap:10px;margin-bottom:22px;">'

  plans.forEach(function(plan) {
    var isActive = planoAtual === plan.value
    var borderColor = isActive ? plan.color : '#1f2937'
    var bgColor = isActive ? 'rgba(255,255,255,0.04)' : 'transparent'
    html += '<label style="display:flex;align-items:center;gap:12px;padding:13px 15px;border:2px solid ' + borderColor + ';border-radius:10px;cursor:pointer;background:' + bgColor + '">'
    html += '<input type="radio" name="novo-plano" value="' + plan.value + '"' + (isActive ? ' checked' : '') + ' style="accent-color:' + plan.color + ';width:16px;height:16px;">'
    html += '<div>'
    html += '<div style="font-weight:700;color:' + plan.color + ';">' + plan.label + '</div>'
    html += '<div style="font-size:0.74rem;color:#666;margin-top:2px;">' + plan.desc + '</div>'
    html += '</div></label>'
  })

  html += '</div>'
  html += '<div style="display:flex;gap:10px;">'
  html += '<button onclick="savePlan(' + userId + ', \'' + nome + '\', \'' + tbodyId + '\')" id="btn-save-plan" style="flex:1;background:linear-gradient(135deg,#2FBF71,#208040);color:#fff;border:none;border-radius:10px;padding:12px;font-size:0.9rem;font-weight:700;cursor:pointer;">💾 Salvar</button>'
  html += '<button onclick="document.getElementById(\'plan-modal-overlay\').remove()" style="background:rgba(255,255,255,0.07);color:#aaa;border:1px solid #333;border-radius:10px;padding:12px 16px;font-size:0.9rem;cursor:pointer;">Cancelar</button>'
  html += '</div>'
  html += '</div>'

  overlay.innerHTML = html
  overlay.addEventListener('click', function(e) { if (e.target === overlay) overlay.remove() })
  document.body.appendChild(overlay)
}

async function savePlan(userId, nome, tbodyId) {
  var selected = document.querySelector('input[name="novo-plano"]:checked')
  if (!selected) { toast('Selecione um plano', false); return }

  var novoPlano = selected.value
  var btn = document.getElementById('btn-save-plan')
  if (btn) { btn.textContent = 'Salvando...'; btn.disabled = true }

  var r = await api('/api/user/' + userId + '/plano', {
    method: 'PATCH',
    body: JSON.stringify({ plano: novoPlano })
  })

  if (r.success) {
    // Atualiza array local
    for (var i = 0; i < allUsers.length; i++) {
      if (allUsers[i].id === userId) { allUsers[i].plano = novoPlano; break }
    }
    // Fecha modal
    var overlay = document.getElementById('plan-modal-overlay')
    if (overlay) overlay.remove()
    toast('✅ ' + r.message)
    // Re-renderiza
    renderUsersTable(allUsers, 'all-users-body')
    renderUsersTable(allUsers.slice(0, 5), 'users-table-body')
  } else {
    toast(r.error || 'Erro ao atualizar plano', false)
    if (btn) { btn.textContent = '💾 Salvar'; btn.disabled = false }
  }
}

// ─── Explorador de tabelas ────────────────────────────────────────────────────
async function loadTables() {
  var data = await api('/api/tables')
  var list = document.getElementById('tables-list')
  var listHtml = ''
  var tables = data.tables || []
  tables.forEach(function(t) {
    listHtml += '<div style="padding:9px 14px;cursor:pointer;font-size:0.82rem;color:#888;border-bottom:1px solid #1a1a2e;" '
    listHtml += 'onmouseover="this.style.background=\'rgba(47,191,113,0.07)\';this.style.color=\'#2FBF71\'" '
    listHtml += 'onmouseout="this.style.background=\'\';this.style.color=\'#888\'" '
    listHtml += 'onclick="loadTable(\'' + t + '\')" id="tbl-' + t + '">' + t + '</div>'
  })
  list.innerHTML = listHtml
}

async function loadTable(name, offset) {
  if (offset === undefined) offset = 0
  currentTable = name
  browserOffset = offset
  document.getElementById('browser-title').textContent = '📋 ' + name
  document.getElementById('browser-content').innerHTML = '<div style="color:#888;padding:20px;text-align:center;"><span class="loader"></span> Carregando...</div>'

  document.querySelectorAll('[id^="tbl-"]').forEach(function(el) {
    el.style.color = el.id === 'tbl-' + name ? '#2FBF71' : '#888'
    el.style.background = el.id === 'tbl-' + name ? 'rgba(47,191,113,0.07)' : ''
  })

  var search = document.getElementById('browser-search').value
  var url = '/api/table/' + name + '?limit=' + browserLimit + '&offset=' + browserOffset
  if (search) url += '&search=' + encodeURIComponent(search)
  var data = await api(url)

  if (data.error) {
    document.getElementById('browser-content').innerHTML = '<div style="color:#ff4757;padding:12px">' + data.error + '</div>'
    return
  }

  browserTotal = data.total || 0
  var rows = data.rows || []

  if (rows.length === 0) {
    document.getElementById('browser-content').innerHTML = '<div style="color:#444;padding:24px;text-align:center;">Tabela vazia</div>'
    document.getElementById('browser-info').textContent = '0 registros'
    document.getElementById('btn-prev').disabled = true
    document.getElementById('btn-next').disabled = true
    return
  }

  var cols = Object.keys(rows[0])
  var tableHtml = '<div class="table-wrap"><table><thead><tr>'
  cols.forEach(function(col) { tableHtml += '<th>' + col + '</th>' })
  tableHtml += '</tr></thead><tbody>'
  rows.forEach(function(row) {
    tableHtml += '<tr>'
    cols.forEach(function(col) {
      var val = row[col]
      var str = formatCell(val)
      var title = String(val != null ? val : '').replace(/"/g, '&quot;')
      tableHtml += '<td title="' + title + '">' + str + '</td>'
    })
    tableHtml += '</tr>'
  })
  tableHtml += '</tbody></table></div>'
  document.getElementById('browser-content').innerHTML = tableHtml

  var from = browserOffset + 1
  var to = Math.min(browserOffset + browserLimit, browserTotal)
  document.getElementById('browser-info').textContent = from + '–' + to + ' de ' + browserTotal + ' registros'
  document.getElementById('btn-prev').disabled = browserOffset === 0
  document.getElementById('btn-next').disabled = to >= browserTotal
}

function formatCell(v) {
  if (v === null || v === undefined) return '<span style="color:#333;font-style:italic;">null</span>'
  var s = String(v)
  if (s.length > 60) return s.slice(0, 60) + '…'
  return s.replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function browserSearch(q) { if (currentTable) loadTable(currentTable, 0) }
function browserPrev() { loadTable(currentTable, Math.max(0, browserOffset - browserLimit)) }
function browserNext() { loadTable(currentTable, browserOffset + browserLimit) }

// ─── SQL Console ──────────────────────────────────────────────────────────────
async function runSQL() {
  var sql = document.getElementById('sql-input').value.trim()
  if (!sql) return
  var el = document.getElementById('sql-result')
  el.innerHTML = '<span class="loader"></span> Executando...'

  var data = await api('/api/query', { method: 'POST', body: JSON.stringify({ sql: sql }) })

  if (data.error) {
    el.innerHTML = '<div style="color:#ff4757;margin-top:12px">❌ ' + data.error + '</div>'
    return
  }

  var rows = data.rows || []
  if (rows.length === 0) {
    el.innerHTML = '<div style="color:#666;margin-top:12px">Nenhum resultado. (' + (data.count || 0) + ' linhas)</div>'
    return
  }

  var cols = Object.keys(rows[0])
  var resHtml = '<div style="margin-top:12px;">'
  resHtml += '<div style="color:#888;font-size:0.75rem;margin-bottom:8px;">' + data.count + ' resultado(s)</div>'
  resHtml += '<div class="table-wrap"><table><thead><tr>'
  cols.forEach(function(col) { resHtml += '<th>' + col + '</th>' })
  resHtml += '</tr></thead><tbody>'
  rows.forEach(function(row) {
    resHtml += '<tr>'
    cols.forEach(function(col) {
      var val = row[col]
      var str = formatCell(val)
      resHtml += '<td>' + str + '</td>'
    })
    resHtml += '</tr>'
  })
  resHtml += '</tbody></table></div></div>'
  el.innerHTML = resHtml
}

function loadQuickSQL() {
  var el = document.getElementById('quick-queries')
  var html = ''
  QUICK_SQL.forEach(function(q) {
    html += '<button class="btn btn-ghost btn-sm" onclick="setSQL(this)"'
    html += ' data-sql="' + q.sql.replace(/"/g, '&quot;') + '">' + q.label + '</button>'
  })
  el.innerHTML = html
}

function setSQL(btn) {
  var sql = btn.getAttribute('data-sql')
  document.getElementById('sql-input').value = sql
  runSQL()
}

// ─── Conquistas ───────────────────────────────────────────────────────────────
async function loadConquistas() {
  var sql = 'SELECT cd.*, COUNT(cu.id) as desbloqueadas FROM conquistas_definicoes cd LEFT JOIN conquistas_usuario cu ON cd.codigo = cu.conquista_codigo GROUP BY cd.codigo ORDER BY desbloqueadas DESC, cd.pontos ASC'
  var data = await api('/api/query', { method: 'POST', body: JSON.stringify({ sql: sql }) })
  var rows = data.rows || []
  var rarCor = { comum: 'pill-green', raro: 'pill-blue', epico: 'pill-yellow', lendario: 'pill-red' }
  var html = ''
  rows.forEach(function(r) {
    var rarCls = rarCor[r.raridade] || 'pill-green'
    var desbl = r.desbloqueadas > 0
      ? '<span class="pill pill-green">' + r.desbloqueadas + 'x</span>'
      : '<span style="color:#333;">—</span>'
    html += '<tr>'
    html += '<td style="font-size:1.3rem;text-align:center;">' + (r.icone || '🏆') + '</td>'
    html += '<td style="font-family:monospace;color:#74b9ff;font-size:0.78rem;">' + (r.codigo || '') + '</td>'
    html += '<td><strong>' + (r.titulo || '') + '</strong></td>'
    html += '<td style="color:#888;max-width:260px;white-space:normal;line-height:1.4;">' + (r.descricao || '') + '</td>'
    html += '<td style="color:#ffc400;text-align:center;">' + (r.pontos || 0) + '</td>'
    html += '<td><span class="pill ' + rarCls + '">' + (r.raridade || '') + '</span></td>'
    html += '<td style="text-align:center;">' + desbl + '</td>'
    html += '</tr>'
  })
  document.getElementById('conquistas-body').innerHTML = html || '<tr><td colspan="7" style="text-align:center;color:#444;padding:20px;">Nenhuma conquista</td></tr>'
}

// ─── Refresh ──────────────────────────────────────────────────────────────────
function refreshAll() { loadStats(); toast('Dados atualizados!') }

// ─── Init ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', function() {
  loadStats()
  loadQuickSQL()
})
