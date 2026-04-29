// Service Worker for Harbor app
// Handles push notifications, offline support, and app installation.
//
// Strategy:
//   - /api/*, /api/auth, /login, /signup, /reception/signup → network-only (never cached)
//     Auth-sensitive responses must never be served from cache.
//   - Everything else → cache-first, fall back to network. Static app shell
//     (homepage, manifest, icons) is precached on install.

const CACHE_NAME = 'harbor-v2'
const PRECACHE = [
  '/',
  '/manifest.json',
  '/icon-72.png',
  '/icon-192.png',
  '/icon-512.png',
  '/icon-512-maskable.png',
  '/apple-touch-icon.png',
]

self.addEventListener('push', function(event) {
  const data = event.data ? event.data.json() : {}
  const title = data.title || 'Harbor'
  const options = {
    body: data.body || '',
    icon: '/icon-192.png',
    badge: '/icon-72.png',
    vibrate: [200, 100, 200],
    data: { url: data.url || '/dashboard' },
    requireInteraction: data.urgent || false,
    silent: data.silent || false,
    tag: data.tag || 'notification',
    actions: data.actions || [],
  }

  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', function(event) {
  event.notification.close()
  const urlToOpen = event.notification.data?.url || '/dashboard'

  event.waitUntil(
    clients.matchAll({
      type: 'window',
      includeUncontrolled: true,
    }).then(function(clientList) {
      for (let i = 0; i < clientList.length; i++) {
        const client = clientList[i]
        if (client.url === urlToOpen && 'focus' in client) {
          return client.focus()
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(urlToOpen)
      }
    })
  )
})

self.addEventListener('notificationclose', function(event) {
  console.log('Notification closed:', event.notification.tag)
})

// Install — precache app shell so the home screen icon launches even offline.
self.addEventListener('install', function(event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      return cache.addAll(PRECACHE).catch(function(err) {
        // Don't fail install if a single asset is missing in dev.
        console.warn('Precache partial failure:', err)
      })
    })
  )
  self.skipWaiting()
})

// Activate — drop old cache versions and take control of open pages.
self.addEventListener('activate', function(event) {
  event.waitUntil(
    caches.keys().then(function(cacheNames) {
      return Promise.all(
        cacheNames.map(function(cacheName) {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName)
          }
        })
      )
    }).then(function() {
      return self.clients.claim()
    })
  )
})

// Fetch — bypass auth/API; cache-first for everything else.
self.addEventListener('fetch', function(event) {
  if (event.request.method !== 'GET') return

  const url = new URL(event.request.url)

  // Never cache auth/API or auth-flow pages — must always be fresh.
  const isApi = url.pathname.startsWith('/api/')
  const isAuthFlow =
    url.pathname.startsWith('/login') ||
    url.pathname.startsWith('/signup') ||
    url.pathname.startsWith('/reset-password') ||
    url.pathname.startsWith('/onboard') ||
    url.pathname.includes('/signup')

  if (isApi || isAuthFlow) {
    event.respondWith(fetch(event.request))
    return
  }

  // Cache-first with network fallback for static and content routes.
  event.respondWith(
    caches.match(event.request).then(function(cached) {
      if (cached) return cached
      return fetch(event.request).then(function(response) {
        if (response && response.status === 200 && response.type === 'basic') {
          const responseToCache = response.clone()
          caches.open(CACHE_NAME).then(function(cache) {
            cache.put(event.request, responseToCache)
          })
        }
        return response
      }).catch(function() {
        return caches.match(event.request)
      })
    })
  )
})
