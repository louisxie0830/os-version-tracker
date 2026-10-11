import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { createHandler } from '../src/server.ts';
import type { AllVersions } from '../src/fetch-all.ts';

// A real snapshot of the aggregated data (taken from a static build); no network in these tests
const snapshot = JSON.parse(readFileSync(new URL('./fixtures/all-versions.json', import.meta.url), 'utf8')) as AllVersions;

let base = '';
let failing = false;
const server = http.createServer(createHandler(() => (failing ? Promise.reject(new Error('upstream down')) : Promise.resolve(snapshot))));

before(async () => {
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => new Promise(r => {
  // Keep-alive sockets from the test requests would otherwise keep the process alive
  server.closeAllConnections();
  server.close(r);
}));

/** Raw request, so paths like "/icons/../x" reach the server un-normalized */
function get(path: string): Promise<{ status: number; type: string; body: string; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    http.get(`${base}${path}`, res => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', c => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, type: String(res.headers['content-type'] ?? ''), body, headers: res.headers }));
    }).on('error', reject);
  });
}

test('health, API and generated feeds', async () => {
  const health = await get('/health');
  assert.equal(health.status, 200);
  assert.deepEqual(JSON.parse(health.body), { status: 'ok' });

  for (const path of ['/api', '/api.json']) {
    const api = await get(path);
    assert.equal(api.status, 200);
    assert.match(api.type, /application\/json/);
    assert.equal(JSON.parse(api.body).cachedAt, snapshot.cachedAt);
  }

  const ics = await get('/calendar.ics');
  assert.match(ics.type, /text\/calendar/);
  assert.ok(ics.body.startsWith('BEGIN:VCALENDAR\r\n'));

  assert.match((await get('/feed.xml')).type, /application\/atom\+xml/);
  const notifications = JSON.parse((await get('/notifications.json')).body);
  assert.ok(Array.isArray(notifications.items));
});

test('the page renders every section and no active-scheme links', async () => {
  const page = await get('/');
  assert.equal(page.status, 200);
  assert.match(page.type, /text\/html/);
  for (const id of ['recent', 'checker', 'crashes', 'ios', 'android', 'compat', 'deadlines', 'banks', 'privacy', 'legal']) {
    assert.ok(page.body.includes(`id="${id}"`), id);
  }
  assert.ok(!/href="\s*(javascript|data|vbscript):/i.test(page.body));
});

test('the page carries a CSP that forbids inline scripts, and has none', async () => {
  const page = await get('/');
  const csp = page.body.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)">/)?.[1];
  assert.ok(csp, 'CSP meta tag');
  assert.match(csp!, /script-src 'self';/);
  assert.match(csp!, /object-src 'none'/);
  assert.match(page.body, /<meta name="referrer" content="strict-origin-when-cross-origin">/);
  // Only external scripts or non-executable data blocks
  for (const tag of page.body.match(/<script\b[^>]*>/g) ?? []) {
    assert.ok(/\ssrc="/.test(tag) || /type="application\/(?:json|ld\+json)"/.test(tag), tag);
  }
  assert.ok(!/\son[a-z]+="/i.test(page.body), 'no inline event handlers');
  assert.equal((await get('/app.js')).status, 200);
});

test('every response carries the security headers', async () => {
  for (const path of ['/', '/api.json', '/sw.js', '/nope']) {
    const { headers } = await get(path);
    assert.match(String(headers['content-security-policy']), /frame-ancestors 'none'/, path);
    assert.equal(headers['x-content-type-options'], 'nosniff', path);
    assert.equal(headers['x-frame-options'], 'DENY', path);
    assert.equal(headers['referrer-policy'], 'strict-origin-when-cross-origin', path);
  }
});

test('server-rendered project checker shows the upgrade plan', async () => {
  const page = await get('/?xcode=16.4&deployment=12&agp=8.7.3&gradle=8.7&targetSdk=35');
  assert.match(page.body, /iOS 建議升級順序/);
  assert.match(page.body, /Android 建議升級順序/);
  assert.match(page.body, /Xcode 16\.4 無法上架/);
});

test('static files are served from an allow-list only', async () => {
  assert.equal((await get('/manifest.webmanifest')).status, 200);
  assert.match((await get('/sw.js')).type, /javascript/);
  for (const path of ['/icons/../package.json', '/icons/..%2Fpackage.json', '/package.json', '/src/server.ts', '/../../etc/passwd', '/nope']) {
    assert.equal((await get(path)).status, 404, path);
  }
});

test('upstream failures return 500 without leaking details', async () => {
  failing = true;
  try {
    const page = await get('/');
    assert.equal(page.status, 500);
    assert.ok(!page.body.includes('upstream down'));
    assert.equal((await get('/api.json')).status, 500);
    assert.equal((await get('/health')).status, 200, 'liveness does not depend on upstreams');
  } finally {
    failing = false;
  }
});
