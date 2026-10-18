// Stu.Ai Service Worker
// Strictly static asset cache only. Never cache /api/ endpoints, navigation requests, or private user conversations.

const CACHE_NAME = 'stu-ai-static-v2';
const STATIC_ASSETS = [
  '/manifest.json',
  '/icons/icon.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // NEVER cache API calls, navigation/HTML requests, attachments, auth, or any mutating requests
  if (
    url.pathname.startsWith('/api') ||
    event.request.method !== 'GET' ||
    url.pathname.includes('/attachments/') ||
    event.request.mode === 'navigate' ||
    url.pathname.endsWith('.html') ||
    url.pathname === '/'
  ) {
    return; // Pass through to network directly
  }

  // Network-first with cache fallback for static assets
  event.respondWith(
    fetch(event.request)
      .then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
        }
        return networkResponse;
      })
      .catch(() => caches.match(event.request))
  );
});
