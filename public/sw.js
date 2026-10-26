// Bump when the precached shell or caching strategy changes, so old caches are dropped. CacheStorage is shared
// by everything on the origin (github.io serves other projects too), so only this project's caches, the ones
// named with CACHE_PREFIX, are ever deleted
const CACHE_PREFIX = 'os-tracker-';
const CACHE = `${CACHE_PREFIX}v11`;
// Paths are relative to the worker's scope, so the site works at a domain root or under /<repo>/ on GitHub Pages
const SCOPE = self.registration.scope;
// offline.html: the answer for a page that is neither reachable nor cached
const PRECACHE = ['./', 'offline.html', 'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png']
  .map(path => new URL(path, SCOPE).href);

// The shell plus the stylesheet and scripts the page links (with their ?v= versions), read from the page
// itself: the first visit installs the worker before it controls the page, so without this an offline second
// visit would have the page but not its styles
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(PRECACHE);
    try {
      const page = await (await caches.match(new URL('./', SCOPE).href))?.text() ?? '';
      const assets = [...page.matchAll(/(?:href|src)="((?:style\.css|theme\.js|app\.js)\?v=[\w-]+)"/g)].map(m => new URL(m[1], SCOPE).href);
      await Promise.all(assets.map(url => fetchAndCache(new Request(url), url, new URL(url).pathname.slice(new URL(SCOPE).pathname.length))));
    } catch {}
    await self.skipWaiting();
  })());
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
const VERSIONED = new Set(['style.css', 'theme.js', 'app.js']);

// Pages and data are network-first so they stay fresh, falling back to the last copy when offline or when the
// network takes longer than NETWORK_WAIT_MS. The stylesheet and scripts are cache-first: a ?v= version never
// changes (a new one is a new URL). Icons and the manifest are served from the cache and refreshed behind it.
const NETWORK_WAIT_MS = 3000;
self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET' || !request.url.startsWith(SCOPE)) return;
  const path = new URL(request.url).pathname.slice(new URL(SCOPE).pathname.length);

  if (path.startsWith('icons/') || path === 'manifest.webmanifest') {
    const refresh = fetchAndCache(request).catch(() => undefined);
    event.respondWith(caches.match(request).then(hit => hit ?? refresh.then(res => res ?? Response.error())));
    event.waitUntil?.(refresh);
    return;
  }

  if (VERSIONED.has(path)) {
    // Kept under its full versioned URL, one version per file: the newest that loaded replaces the one before,
    // and offline any version of the file is better than none
    event.respondWith((async () => {
      const exact = await caches.match(request.url);
      if (exact) return exact;
      try {
        return await fetchAndCache(request, request.url, path);
      } catch {
        return (await anyVersion(path)) ?? Response.error();
      }
    })());
    return;
  }

  if (request.mode === 'navigate' || path === '' || path === 'api' || path === 'api.json' || path.startsWith('api/') || path.startsWith('notifications.')) {
    // One entry per page (the home page and each legal page separately, whatever the query string)
    const key = request.mode === 'navigate' ? pageKey(path) : request;
    const network = fetchAndCache(request, key);
    // The fresh copy is still saved after the cached one has answered (the worker isn't stopped mid-save)
    event.waitUntil?.(network.catch(() => undefined));
    event.respondWith(networkFirst(network, key, request.mode === 'navigate'));
  }
});

/**
 * The network's answer, or the cached copy when the network fails or keeps the reader waiting too long; a page
 * with neither gets the offline page rather than the browser's own error
 */
function networkFirst(network, key, page = false) {
  return new Promise(resolve => {
    let settled = false;
    const fallback = async () => {
      const hit = await caches.match(key);
      if (hit && !settled) { settled = true; resolve(hit); }
      return hit;
    };
    const timer = setTimeout(fallback, NETWORK_WAIT_MS);
    network.then(
      response => { clearTimeout(timer); if (!settled) { settled = true; resolve(response); } },
      async () => {
        clearTimeout(timer);
        if (!(await fallback()) && !settled) {
          settled = true;
          resolve((page && await caches.match(new URL('offline.html', SCOPE).href)) || Response.error());
        }
      },
    );
  });
}

/** The cached copy of a versioned file, whichever version it is */
async function anyVersion(path) {
  const cache = await caches.open(CACHE);
  const base = new URL(path, SCOPE).href;
  const key = (await cache.keys()).find(k => (typeof k === 'string' ? k : k.url).split('?')[0] === base);
  return key ? cache.match(key) : undefined;
}

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
    // Only a tab this worker controls can be navigated (navigate() rejects for the others)
    const tabs = await self.clients.matchAll({ type: 'window' });
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

/** Fetches and keeps a copy under `key`; for a versioned file (`versionOf`) the other versions go */
async function fetchAndCache(request, key = request, versionOf) {
  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(CACHE);
    if (versionOf) {
      const base = new URL(versionOf, SCOPE).href;
      for (const k of await cache.keys()) {
        const url = typeof k === 'string' ? k : k.url;
        if (url.split('?')[0] === base && url !== key) await cache.delete(k);
      }
    }
    await cache.put(key, response.clone());
  }
  return response;
}
