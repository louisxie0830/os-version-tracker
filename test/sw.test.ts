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
  const fetch = async (request: { url: string }) => {
    if (!online) throw new TypeError('offline');
    return new Response(`page:${new URL(request.url).pathname}`, { status: 200 });
  };
  const self = { registration: { scope: SCOPE }, addEventListener: (type: string, fn: (e: unknown) => void) => { handlers[type] = fn; }, clients: { claim: async () => {} } };
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
  return { request, setOnline: (v: boolean) => { online = v; }, store, activate };
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

test('the stylesheet keeps one entry whatever its ?v= version', async () => {
  const sw = loadWorker();
  await sw.request(`${SCOPE}style.css?v=aaa`, 'no-cors');
  sw.setOnline(false);
  assert.equal(await sw.request(`${SCOPE}style.css?v=bbb`, 'no-cors'), 'page:/x/style.css');
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
    assert.deepEqual([...cache.keys()].filter(k => k.includes(name)), [`${SCOPE}${name}`], `${name}: one entry, no query`);
  }
  sw.setOnline(false);
  assert.equal(await sw.request(`${SCOPE}app.js?v=newer-still`, 'no-cors'), 'page:/x/app.js', 'offline, any version gets the latest copy');
});

test('the worker\'s VERSIONED set is exactly the stylesheet and every page script (it can\'t import SCRIPTS)', () => {
  const source = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8');
  const list = source.match(/const VERSIONED = new Set\((\[[^\]]*\])\)/)?.[1];
  assert.ok(list, 'VERSIONED found');
  const names = JSON.parse(list!.replace(/'/g, '"')) as string[];
  assert.deepEqual([...names].sort(), ['style.css', ...SCRIPTS].sort());
});

test('a component script fetched online is served from the cache offline', async () => {
  const sw = loadWorker();
  await sw.request(`${SCOPE}bank-table.js?v=abc`, 'no-cors');
  sw.setOnline(false);
  assert.equal(await sw.request(`${SCOPE}bank-table.js?v=def`, 'no-cors'), 'page:/x/bank-table.js');
  assert.equal(await sw.request(`${SCOPE}trend-charts.js?v=def`, 'no-cors'), null, 'never fetched: no offline copy');
});
