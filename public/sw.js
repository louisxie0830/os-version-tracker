// Bump when the precached shell or caching strategy changes, so old caches are dropped
const CACHE = 'os-tracker-v2';
// Paths are relative to the worker's scope, so the site works at a domain root or under /<repo>/ on GitHub Pages
const SCOPE = self.registration.scope;
const PRECACHE = ['./', 'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png']
  .map(path => new URL(path, SCOPE).href);

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

// Pages, data and scripts are network-first so they stay fresh, falling back to the last copy when offline;
// icons and the manifest rarely change, so they're served cache-first.
self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET' || !request.url.startsWith(SCOPE)) return;
  const path = new URL(request.url).pathname.slice(new URL(SCOPE).pathname.length);

  if (path.startsWith('icons/') || path === 'manifest.webmanifest') {
    event.respondWith(caches.match(request).then(hit => hit ?? fetchAndCache(request)));
    return;
  }

  if (request.mode === 'navigate' || path === '' || path === 'api' || path === 'api.json' || path.startsWith('js/')) {
    // Every navigation (whatever its query string) shares the cached page
    const key = request.mode === 'navigate' ? SCOPE : request;
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
