import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SCRIPTS } from '../src/asset-versions.ts';

/**
 * Runs public/sw.js against a small fake of the service worker globals (caches, fetch, events), to check
 * which cached copy each request gets when the network is gone.
 */
const SCOPE = 'https://site.example/x/';

function loadWorker() {
  const handlers: Record<string, (event: unknown) => void> = {};
  const store = new Map<string, Map<string, Response>>();
  let online = true;
  const keyOf = (r: string | Request | { url: string }) => (typeof r === 'string' ? r : r.url);
  const caches = {
    open: async (name: string) => {
      const cache = store.get(name) ?? new Map<string, Response>();
      store.set(name, cache);
      return {
        put: async (key: string | { url: string }, res: Response) => { cache.set(keyOf(key), res); },
        addAll: async () => {},
        keys: async () => [...cache.keys()],
        delete: async (key: string | { url: string }) => cache.delete(keyOf(key)),
        match: async (key: string | { url: string }) => cache.get(keyOf(key))?.clone(),
      };
    },
    match: async (key: string | { url: string }) => {
      for (const cache of store.values()) {
        const hit = cache.get(keyOf(key));
        if (hit) return hit.clone();
      }
      return undefined;
    },
    keys: async () => [...store.keys()],
    delete: async (name: string) => store.delete(name),
  };
  let fetches = 0;
  let stalled = false;
  let status = 200;
  const fetch = async (request: { url: string }) => {
    fetches++;
    if (stalled) return new Promise<Response>(() => {});
    if (!online) throw new TypeError('offline');
    const url = new URL(request.url);
    return new Response(`page:${url.pathname}${url.searchParams.has('v') ? `@${url.searchParams.get('v')}` : ''}${status === 200 ? '' : `:${status}`}`, { status });
  };
  const opened: string[] = [];
  const navigated: string[] = [];
  let tabs: Array<{ url: string }> = [];
  const self = {
    registration: { scope: SCOPE },
    addEventListener: (type: string, fn: (e: unknown) => void) => { handlers[type] = fn; },
    clients: {
      claim: async () => {},
      matchAll: async () => tabs.map(t => ({ ...t, focus: async () => {}, navigate: async (u: string) => { navigated.push(u); } })),
      openWindow: async (u: string) => { opened.push(u); },
    },
  };
  new Function('self', 'caches', 'fetch', 'Response', readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8'))(self, caches, fetch, Response);

  const request = async (url: string, mode = 'navigate') => {
    let responded: Promise<Response> | undefined;
    handlers.fetch({ request: { method: 'GET', url, mode }, respondWith: (p: Promise<Response>) => { responded = p; } });
    const res = await responded;
    return res && res.type !== 'error' ? res.text() : null;
  };
  const activate = async () => {
    let done: Promise<unknown> | undefined;
    handlers.activate({ waitUntil: (p: Promise<unknown>) => { done = p; } });
    await done;
  };
  const click = async (url: unknown) => {
    let done: Promise<unknown> | undefined;
    handlers.notificationclick({ notification: { close: () => {}, data: { url } }, waitUntil: (p: Promise<unknown>) => { done = p; } });
    await done;
  };
  const respondsTo = (url: string) => {
    let responded = false;
    handlers.fetch({ request: { method: 'GET', url, mode: 'cors' }, respondWith: () => { responded = true; } });
    return responded;
  };
  return {
    request, setOnline: (v: boolean) => { online = v; }, setStalled: (v: boolean) => { stalled = v; }, setStatus: (v: number) => { status = v; },
    store, activate, fetches: () => fetches, click, opened, navigated, setTabs: (t: Array<{ url: string }>) => { tabs = t; }, respondsTo,
  };
}

test('each page keeps its own offline copy (the home page and the legal pages no longer overwrite each other)', async () => {
  const sw = loadWorker();
  for (const url of [`${SCOPE}`, `${SCOPE}legal/`, `${SCOPE}legal/en/`, `${SCOPE}legal/sources/`]) await sw.request(url);
  sw.setOnline(false);
  assert.equal(await sw.request(`${SCOPE}`), 'page:/x/');
  assert.equal(await sw.request(`${SCOPE}legal/`), 'page:/x/legal/');
  assert.equal(await sw.request(`${SCOPE}legal/en/`), 'page:/x/legal/en/');
  assert.equal(await sw.request(`${SCOPE}legal/sources/`), 'page:/x/legal/sources/');
});

test('a page is the same cache entry with or without index.html, a query string or a hash', async () => {
  const sw = loadWorker();
  await sw.request(`${SCOPE}legal/index.html?utm=x`);
  sw.setOnline(false);
  assert.equal(await sw.request(`${SCOPE}legal/`), 'page:/x/legal/index.html');
  assert.equal(await sw.request(`${SCOPE}legal/#7-隱私`), 'page:/x/legal/index.html');
  assert.equal(await sw.request(`${SCOPE}legal/en/`), null, 'a page never visited has no offline copy');
});

test('the stylesheet: a version once loaded comes from the cache; offline, any version is better than none', async () => {
  const sw = loadWorker();
  assert.equal(await sw.request(`${SCOPE}style.css?v=aaa`, 'no-cors'), 'page:/x/style.css@aaa');
  const before = sw.fetches();
  assert.equal(await sw.request(`${SCOPE}style.css?v=aaa`, 'no-cors'), 'page:/x/style.css@aaa');
  assert.equal(sw.fetches(), before, 'cache-first: a versioned file never changes, so no network trip');
  sw.setOnline(false);
  assert.equal(await sw.request(`${SCOPE}style.css?v=bbb`, 'no-cors'), 'page:/x/style.css@aaa');
});

test('activating removes only this project\'s old caches: the current one and other projects\' caches stay', async () => {
  const sw = loadWorker();
  await sw.request(`${SCOPE}`); // fills the current cache
  const current = [...sw.store.keys()][0];
  assert.match(current, /^os-tracker-v\d+$/);
  for (const name of ['os-tracker-v5', 'os-tracker-v6', 'other-project-v1', 'workbox-precache-v2', 'os-tracker']) sw.store.set(name, new Map());
  await sw.activate();
  assert.deepEqual([...sw.store.keys()].sort(), [current, 'other-project-v1', 'os-tracker', 'workbox-precache-v2'].sort());
});

test('each script keeps one offline entry whatever its ?v= version, and a newer version replaces the old copy', async () => {
  const sw = loadWorker();
  for (const name of SCRIPTS) {
    await sw.request(`${SCOPE}${name}?v=old`, 'no-cors');
    await sw.request(`${SCOPE}${name}?v=new`, 'no-cors');
  }
  const cache = [...sw.store.values()][0];
  for (const name of SCRIPTS) {
    assert.deepEqual([...cache.keys()].filter(k => k.includes(name)), [`${SCOPE}${name}?v=new`], `${name}: one entry, the newest version`);
  }
  sw.setOnline(false);
  assert.equal(await sw.request(`${SCOPE}app.js?v=newer-still`, 'no-cors'), 'page:/x/app.js@new', 'offline, any version gets the latest copy');
});

test('the worker\'s VERSIONED set is exactly the stylesheet and every page script (it can\'t import SCRIPTS)', () => {
  const source = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8');
  const list = source.match(/const VERSIONED = new Set\((\[[^\]]*\])\)/)?.[1];
  assert.ok(list, 'VERSIONED found');
  const names = JSON.parse(list!.replace(/'/g, '"')) as string[];
  assert.deepEqual([...names].sort(), ['style.css', ...SCRIPTS].sort());
});

test('app.js fetched online is served from the cache offline; the old per-component scripts are no longer the worker\'s', async () => {
  const sw = loadWorker();
  await sw.request(`${SCOPE}app.js?v=abc`, 'no-cors');
  sw.setOnline(false);
  assert.equal(await sw.request(`${SCOPE}app.js?v=def`, 'no-cors'), 'page:/x/app.js@abc');
  assert.equal(await sw.request(`${SCOPE}theme.js?v=def`, 'no-cors'), null, 'never fetched: no offline copy');
  assert.equal(await sw.request(`${SCOPE}bank-table.js?v=def`, 'no-cors'), null, 'not handled');
});

test('a page whose network hangs is served from the cache after a few seconds', async () => {
  const sw = loadWorker();
  await sw.request(`${SCOPE}`);
  sw.setStalled(true);
  const started = Date.now();
  assert.equal(await sw.request(`${SCOPE}`), 'page:/x/');
  assert.ok(Date.now() - started >= 2900, 'the network gets its chance first');
});

test('an error response is never kept as the offline copy: the last good one stays', async () => {
  const sw = loadWorker();
  await sw.request(`${SCOPE}`);
  sw.setStatus(500);
  assert.equal(await sw.request(`${SCOPE}`), 'page:/x/:500', 'online, the reader sees what the server said');
  sw.setOnline(false);
  assert.equal(await sw.request(`${SCOPE}`), 'page:/x/', 'offline, the good copy, not the 500');
  const fresh = loadWorker();
  fresh.setStatus(404);
  await fresh.request(`${SCOPE}legal/`);
  assert.equal([...fresh.store.values()].reduce((n, c) => n + c.size, 0), 0, 'nothing cached from a 404');
});

test('a notification click opens only http(s) links; a site page in an open tab of the site, anything else in a new window', async () => {
  const sw = loadWorker();
  await sw.click('javascript:alert(1)');
  assert.deepEqual(sw.opened, [SCOPE], 'an unsafe link opens the site itself');
  sw.setTabs([{ url: `${SCOPE}` }]);
  await sw.click(`${SCOPE}#banks`);
  assert.deepEqual(sw.navigated, [`${SCOPE}#banks`]);
  await sw.click('https://example.com/x');
  assert.deepEqual(sw.opened, [SCOPE, 'https://example.com/x'], 'another site: a new window, the open tab left alone');
  assert.deepEqual(sw.navigated, [`${SCOPE}#banks`]);
});

test('requests outside the worker\'s scope are left to the browser', () => {
  const sw = loadWorker();
  assert.equal(sw.respondsTo('https://other.example/api.json'), false);
  assert.equal(sw.respondsTo(`${SCOPE}api.json`), true);
});

test('offline, a page never opened gets the offline page; data requests still fail as errors', async () => {
  const sw = loadWorker();
  await sw.request(`${SCOPE}offline.html`);
  sw.setOnline(false);
  assert.equal(await sw.request(`${SCOPE}legal/never-opened/`), 'page:/x/offline.html');
  assert.equal(await sw.request(`${SCOPE}api/now.json`, 'cors'), null, 'data is no page: no offline page for it');
});

test('offline.html is precached at install', () => {
  const source = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8');
  assert.match(source, /const PRECACHE = \['\.\/', 'offline\.html'/);
});
