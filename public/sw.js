// Bump when the precached shell or caching strategy changes, so old caches are dropped. CacheStorage is shared
// by everything on the origin (github.io serves other projects too), so only this project's caches, the ones
// named with CACHE_PREFIX, are ever deleted
const CACHE_PREFIX = 'os-tracker-';
const CACHE = `${CACHE_PREFIX}v8`;
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
      .then(keys => Promise.all(keys.filter(k => k.startsWith(CACHE_PREFIX) && k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// The stylesheet and scripts, linked as <file>?v=<content hash>: every name in SCRIPTS (src/asset-versions.ts),
// which test/sw.test.ts checks, since the worker can't import it
const VERSIONED = new Set(['style.css', 'theme.js', 'notifications.js', 'choice-chips.js', 'activity-filter.js', 'bank-table.js', 'news-list.js', 'trend-charts.js', 'app.js']);

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

  if (request.mode === 'navigate' || path === '' || path === 'api' || path === 'api.json' || path.startsWith('api/') || path.startsWith('notifications.') || VERSIONED.has(path)) {
    // One entry per page (the home page and each legal page separately, whatever the query string) and one
    // for the stylesheet and each script, whatever its ?v= version: the latest copy of each is its offline
    // fallback, so a new version that loads once replaces the old offline copy instead of piling up next to it
    const key = request.mode === 'navigate' ? pageKey(path) : VERSIONED.has(path) ? new URL(path, SCOPE).href : request;
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

/** The cache key for a page: its path in the scope, "index.html" dropped, without query string or hash */
function pageKey(path) {
  return new URL(path.replace(/(^|\/)index\.html$/, '$1'), SCOPE).href;
}

async function fetchAndCache(request, key = request) {
  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(CACHE);
    await cache.put(key, response.clone());
  }
  return response;
}
