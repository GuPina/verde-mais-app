// VerdeMais Service Worker — Notificações Push + Locais
const CACHE_NAME = 'verdemais-v5'
const STATIC_ASSETS = [
  '/static/app.js',
  '/static/app.css',
  '/static/style.css'
]

// ── Instalação ──────────────────────────────────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS).catch(() => {}))
  )
  self.skipWaiting()
})

// ── Ativação ─────────────────────────────────────────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  )
  self.clients.claim()
})

// ── Notificações Push (servidor) ────────────────────────────────────────────
self.addEventListener('push', (event) => {
  let data = {}
  try { data = event.data?.json() || {} } catch (_) {}

  const title   = data.title   || 'VerdeMais'
  const body    = data.body    || 'Você tem uma nova notificação'
  const icon    = data.icon    || '/favicon.svg'
  const tag     = data.tag     || 'verdemais-default'
  const url     = data.url     || '/lembretes'
  const urgente = data.urgente || false

  const options = {
    body,
    icon,
    badge: '/favicon.svg',
    tag,
    renotify: urgente,
    vibrate: urgente ? [200, 100, 200] : [100],
    data: { url },
    actions: [
      { action: 'view',    title: 'Ver detalhes' },
      { action: 'dismiss', title: 'Dispensar' }
    ]
  }

  event.waitUntil(self.registration.showNotification(title, options))
})

// ── Notificações locais programadas (via mensagem do app) ───────────────────
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SCHEDULE_NOTIFICATIONS') {
    const lembretes = event.data.lembretes || []
    scheduleLocalNotifications(lembretes)
  }
  if (event.data?.type === 'NAVIGATE') {
    // handled by notificationclick
  }
})

function scheduleLocalNotifications(lembretes) {
  const agora = Date.now()
  lembretes.forEach(l => {
    if (!l.data_vencimento) return
    const venc = new Date(l.data_vencimento + 'T09:00:00').getTime()
    const diff = venc - agora
    // Notificar no dia do vencimento às 9h (só se ainda não passou)
    if (diff > 0 && diff < 24 * 60 * 60 * 1000 * 3) { // próximos 3 dias
      setTimeout(() => {
        self.registration.showNotification('⏰ Lembrete VerdeMais', {
          body: `${l.titulo}${l.valor ? ' — R$ ' + parseFloat(l.valor).toLocaleString('pt-BR', { minimumFractionDigits: 2 }) : ''}`,
          icon: '/favicon.svg',
          badge: '/favicon.svg',
          tag: 'lembrete-' + l.id,
          data: { url: '/lembretes' },
          actions: [
            { action: 'view', title: 'Ver lembretes' },
            { action: 'dismiss', title: 'OK' }
          ]
        })
      }, diff)
    }
  })
}

// ── Clique na notificação ────────────────────────────────────────────────────
self.addEventListener('notificationclick', (event) => {
  event.notification.close()

  if (event.action === 'dismiss') return

  const url = event.notification.data?.url || '/'

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(winClients => {
      for (const client of winClients) {
        if (client.url.includes(self.location.origin)) {
          client.focus()
          client.postMessage({ type: 'NAVIGATE', url })
          return
        }
      }
      clients.openWindow(url)
    })
  )
})

// ── Fetch (cache-first para assets estáticos) ───────────────────────────────
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)

  if (event.request.method !== 'GET') return
  if (url.pathname.startsWith('/api/')) return

  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached
      return fetch(event.request).then(response => {
        if (response.ok && STATIC_ASSETS.some(a => url.pathname.endsWith(a.replace('/static','')))) {
          const clone = response.clone()
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone))
        }
        return response
      }).catch(() => cached)
    })
  )
})

const STATIC_ASSETS = [
  '/static/app.js',
  '/static/app.css',
  '/static/style.css'
]

// ── Instalação ──────────────────────────────────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS).catch(() => {}))
  )
  self.skipWaiting()
})

// ── Ativação ─────────────────────────────────────────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  )
  self.clients.claim()
})

// ── Notificações Push ────────────────────────────────────────────────────────
self.addEventListener('push', (event) => {
  let data = {}
  try { data = event.data?.json() || {} } catch (_) {}

  const title   = data.title   || 'VerdeMais'
  const body    = data.body    || 'Você tem uma nova notificação'
  const icon    = data.icon    || '/favicon.svg'
  const tag     = data.tag     || 'verdemais-default'
  const url     = data.url     || '/'
  const urgente = data.urgente || false

  const options = {
    body,
    icon,
    badge: '/favicon.svg',
    tag,
    renotify: urgente,
    vibrate: urgente ? [200, 100, 200] : [100],
    data: { url },
    actions: [
      { action: 'view',    title: 'Ver detalhes' },
      { action: 'dismiss', title: 'Dispensar' }
    ]
  }

  event.waitUntil(self.registration.showNotification(title, options))
})

// ── Clique na notificação ────────────────────────────────────────────────────
self.addEventListener('notificationclick', (event) => {
  event.notification.close()

  if (event.action === 'dismiss') return

  const url = event.notification.data?.url || '/'

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(winClients => {
      for (const client of winClients) {
        if (client.url.includes(self.location.origin)) {
          client.focus()
          client.postMessage({ type: 'NAVIGATE', url })
          return
        }
      }
      clients.openWindow(url)
    })
  )
})

// ── Fetch (cache-first para assets estáticos) ───────────────────────────────
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)

  // Só cachear GET de assets estáticos
  if (event.request.method !== 'GET') return
  if (url.pathname.startsWith('/api/')) return

  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached
      return fetch(event.request).then(response => {
        if (response.ok && STATIC_ASSETS.some(a => url.pathname.endsWith(a.replace('/static','')))) {
          const clone = response.clone()
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone))
        }
        return response
      }).catch(() => cached)
    })
  )
})
