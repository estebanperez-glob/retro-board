// Retro Board service worker: minimal offline shell + installability.
// Strategy: network-first for pages/API, cache-first for static assets.
const CACHE_NAME = 'retro-board-v3';
const CORE_ASSETS = [
  '/css/styles.css',
  '/js/i18n.js',
  '/js/auth.js',
  '/manifest.json',
];

self.addEventListener('install', (event) => {
  self.skipWaiting(); // Take over immediately so asset updates reach users
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll([
      '/css/styles.css',
      '/manifest.json',
    ]))
  );
});

self.addEventListener('activate', (event) => {
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET') return;

  // Cache-first for static assets
  if (event.request.destination === 'style' || event.request.destination === 'script' || url.pathname === '/manifest.json') {
    event.respondWith(
      caches.match(event.request).then(cached => cached || fetch(event.request).then(res => {
        const copy = res.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy));
        return res;
      }).catch(() => caches.match('/'))
    );
    return;
  }
  // Network-first for everything else (pages, APIs)
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});
