// Service Worker fuer Push-Benachrichtigungen (RBL Planung)
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

self.addEventListener('push', (event) => {
  let daten = {}
  try {
    daten = event.data ? event.data.json() : {}
  } catch (e) {
    daten = { titel: 'RBL Planung', text: event.data ? event.data.text() : '' }
  }
  event.waitUntil(
    self.registration.showNotification(daten.titel || 'RBL Planung', {
      body: daten.text || '',
      icon: '/icon-192.png',
      badge: '/favicon.png',
      data: { url: daten.url || '/' },
    })
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const ziel = (event.notification.data && event.notification.data.url) || '/'
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((fenster) => {
      for (const f of fenster) {
        if ('focus' in f) return f.focus()
      }
      return self.clients.openWindow(ziel)
    })
  )
})
