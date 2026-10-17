import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { checkLinks, classify, extractLinks, issueBody } from '../src/check-links.ts';

test('extractLinks: outside links once each, with the section they first appear in', () => {
  const html = `<header id="top"><a href="https://site.example/x/">self</a></header>
    <section class="panel" id="security"><a class="t" href="https://a.example/1?x=1&amp;y=2">a</a></section>
    <section id="news"><a href="https://a.example/1?x=1&amp;y=2">again</a><a href="#feed">anchor</a><a href="https://b.example/">b</a></section>`;
  assert.deepEqual(extractLinks(html, 'https://site.example/x'), [
    { url: 'https://a.example/1?x=1&y=2', section: 'security' },
    { url: 'https://b.example/', section: 'news' },
  ]);
});

test('classify: gone, unreachable, login redirects are broken; bot walls are only skipped', () => {
  assert.equal(classify('https://a/', { status: 200, finalUrl: 'https://a/' }).kind, 'ok');
  assert.equal(classify('https://a/', { status: 404, finalUrl: 'https://a/' }).kind, 'broken');
  assert.equal(classify('https://a/', { status: 503, finalUrl: 'https://a/' }).kind, 'broken');
  assert.deepEqual(classify('https://a/', { status: 403, finalUrl: 'https://a/' }), { kind: 'blocked', status: 403 });
  assert.equal(classify('https://a/', { status: 429, finalUrl: 'https://a/' }).kind, 'blocked');
  assert.deepEqual(classify('https://a/', { error: 'ENOTFOUND' }), { kind: 'broken', reason: '無法連線（ENOTFOUND）' });
  const login = classify('https://blog.example/feed', { status: 200, finalUrl: 'https://accounts.google.com/ServiceLogin?continue=x' });
  assert.equal(login.kind, 'broken');
  assert.match(login.kind === 'broken' ? login.reason : '', /轉址到登入頁/);
  assert.equal(classify('https://example.com/login', { status: 200, finalUrl: 'https://example.com/login' }).kind, 'ok', 'a link that is a login page is fine');
  const report = 'https://github.com/louisxie0830/os-version-tracker/security/advisories/new';
  assert.equal(classify(report, { status: 200, finalUrl: 'https://github.com/login?return_to=x' }).kind, 'ok', 'private reporting needs signing in by design');
});

test('checkLinks: a broken result is retried once, so a hiccup is not reported', async () => {
  const seen = new Map<string, number>();
  const fake = async (url: string) => {
    seen.set(url, (seen.get(url) ?? 0) + 1);
    if (url.endsWith('/flaky')) return seen.get(url) === 1 ? { status: 502, finalUrl: url } : { status: 200, finalUrl: url };
    if (url.endsWith('/gone')) return { status: 404, finalUrl: url };
    return { status: 200, finalUrl: url };
  };
  const results = await checkLinks([{ url: 'https://a/flaky', section: 's' }, { url: 'https://a/gone', section: 's' }, { url: 'https://a/ok', section: 's' }], fake);
  assert.deepEqual(results.map(r => r.status.kind), ['ok', 'broken', 'ok']);
  assert.equal(seen.get('https://a/gone'), 2);
  assert.equal(seen.get('https://a/ok'), 1);
});

test('issueBody lists each broken link with its section', () => {
  const body = issueBody([{ url: 'https://a/gone', section: 'news', status: { kind: 'broken', reason: 'HTTP 404' } }], 120, 'https://github.com/o/r/actions/runs/1');
  assert.match(body, /發現 1 個失效連結（共檢查 120 個）/);
  assert.match(body, /^\| news \| https:\/\/a\/gone \| HTTP 404 \|$/m);
  assert.match(body, /actions\/runs\/1/);
});

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

test('the default request goes through net.ts: User-Agent, final URL after redirects, the system error code', async () => {
  const agents: string[] = [];
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    agents.push(new Headers(init.headers).get('User-Agent') ?? '');
    if (url.includes('gone.example')) throw Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error('getaddrinfo ENOTFOUND gone.example'), { code: 'ENOTFOUND' }) });
    const res = new Response('ok', { status: 200 });
    Object.defineProperty(res, 'url', { value: 'https://accounts.google.com/ServiceLogin' });
    return res;
  }) as typeof fetch;
  const results = await checkLinks([{ url: 'https://gone.example/', section: 's' }, { url: 'https://blog.example/feed', section: 's' }]);
  assert.deepEqual(results.map(r => r.status), [
    { kind: 'broken', reason: '無法連線（ENOTFOUND）' },
    { kind: 'broken', reason: '轉址到登入頁：https://accounts.google.com/ServiceLogin' },
  ]);
  assert.ok(agents.length >= 3 && agents.every(a => a === 'Mozilla/5.0 (compatible; os-version-tracker)'), 'every request identifies the project (broken links are tried twice)');
});
