const NOTIFICATION_ICON = '/icons/app-192.png'

self.addEventListener('install', () => self.skipWaiting())

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener('push', (event) => {
  let message = {}
  try {
    message = event.data ? event.data.json() : {}
  } catch {
    message = { body: event.data?.text() ?? '' }
  }

  const title = message.title || '人生看板'
  event.waitUntil(self.registration.showNotification(title, {
    body: message.body || '有一项安排需要你留意。',
    icon: message.icon || NOTIFICATION_ICON,
    badge: message.badge || NOTIFICATION_ICON,
    tag: message.tag || 'life-dashboard',
    renotify: Boolean(message.renotify),
    data: { url: message.url || '/' },
  }))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target = new URL(event.notification.data?.url || '/', self.location.origin).href
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    for (const client of windows) {
      if ('navigate' in client) await client.navigate(target)
      if ('focus' in client) return client.focus()
    }
    return self.clients.openWindow(target)
  })())
})
