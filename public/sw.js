// Bump when the precached shell or caching strategy changes, so old caches are dropped
const CACHE = 'os-tracker-v1';
const PRECACHE = ['/', '/manifest.webmanifest', '/icons/icon.svg', '/icons/icon-192.png', '/icons/icon-512.png'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Pages and the API are network-first so data stays fresh, falling back to the last copy when offline;
// icons and the manifest rarely change, so they're served cache-first.
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;

  if (url.pathname.startsWith('/icons/') || url.pathname === '/manifest.webmanifest') {
    event.respondWith(caches.match(request).then(hit => hit ?? fetchAndCache(request)));
    return;
  }

  if (request.mode === 'navigate' || url.pathname === '/' || url.pathname === '/api') {
    const key = request.mode === 'navigate' ? '/' : request;
    event.respondWith(
      fetchAndCache(request, key).catch(() => caches.match(key).then(hit => hit ?? Response.error())),
    );
  }
});

async function fetchAndCache(request, key = request) {
  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(CACHE);
    await cache.put(key, response.clone());
  }
  return response;
}
