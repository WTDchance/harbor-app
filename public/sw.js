// Service Worker for Harbor app
// Handles push notifications, offline support, and app installation

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
      // Check if there is already a window/tab open with the target URL
      for (let i = 0; i < clientList.length; i++) {
        const client = clientList[i]
        if (client.url === urlToOpen && 'focus' in client) {
          return client.focus()
        }
      }
      // If not, open a new window/tab with the target URL
      if (clients.openWindow) {
        return clients.openWindow(urlToOpen)
      }
    })
  )
})

self.addEventListener('notificationclose', function(event) {
  console.log('Notification closed:', event.notification.tag)
})

// Install event - cache app shell
self.addEventListener('install', function(event) {
  event.waitUntil(
    caches.open('harbor-v1').then(function(cache) {
      return cache.addAll([
        '/dashboard',
      ])
    })
  )
})

// Activate event - clean up old caches
self.addEventListener('activate', function(event) {
  event.waitUntil(
    caches.keys().then(function(cacheNames) {
      return Promise.all(
        cacheNames.map(function(cacheName) {
          if (cacheName !== 'harbor-v1') {
            return caches.delete(cacheName)
          }
        })
      )
    })
  )
})

// Fetch event - network first strategy
self.addEventListener('fetch', function(event) {
  // Only handle GET requests
  if (event.request.method !== 'GET') {
    return
  }

  event.respondWith(
    fetch(event.request)
      .then(function(response) {
        // Cache successful responses
        if (response.status === 200) {
          const responseToCache = response.clone()
          caches.open('harbor-v1').then(function(cache) {
            cache.put(event.request, responseToCache)
          })
        }
        return response
      })
      .catch(function() {
        // Return cached version on network error
        return caches.match(event.request)
      })
  )
})
