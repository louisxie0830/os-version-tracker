// Bump when the precached shell or caching strategy changes, so old caches are dropped
const CACHE = 'os-tracker-v3';
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

  if (request.mode === 'navigate' || path === '' || path === 'api' || path === 'api.json' || path.startsWith('js/') || path.startsWith('notifications.')) {
    // Every navigation (whatever its query string) shares the cached page
    const key = request.mode === 'navigate' ? SCOPE : request;
    event.respondWith(
      fetchAndCache(request, key).catch(() => caches.match(key).then(hit => hit ?? Response.error())),
    );
  }
});

// Clicking a notification focuses an open tab of the site (or opens one) at the notification's link
self.addEventListener('notificationclick', event => {
  event.notification.close();
  // Only http(s) destinations are opened; anything else falls back to the site itself
  let url = SCOPE;
  try {
    const target = new URL(event.notification.data?.url);
    if (target.protocol === 'https:' || target.protocol === 'http:') url = target.href;
  } catch {}
  event.waitUntil((async () => {
    const tabs = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const sameSite = url.startsWith(SCOPE);
    const tab = tabs.find(c => c.url.startsWith(SCOPE));
    if (sameSite && tab) {
      await tab.focus();
      return tab.navigate(url);
    }
    return self.clients.openWindow(url);
  })());
});

async function fetchAndCache(request, key = request) {
  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(CACHE);
    await cache.put(key, response.clone());
  }
  return response;
}
