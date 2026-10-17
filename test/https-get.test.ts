import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { boundedGet, DeadlineError, isTransient } from '../src/https-get.ts';
import { httpsGet } from '../src/fetchers/ios.ts';
import { defaultFetch, MAX_ROBOTS_REDIRECTS, ROBOTS_MAX_BYTES } from '../src/check-robots.ts';
import { USER_AGENT } from '../src/net.ts';

/**
 * The bounded GET (and its two users) against a local server that misbehaves on purpose. http.get stands in
 * for https.get: same API, no certificate needed.
 */
const get = http.get as unknown as typeof import('node:https').get;
let base = '';
let server: http.Server;
const hits = new Map<string, number>();
/** Per-path behaviour; the server closes each response it was told to cut */
const routes: Record<string, (req: http.IncomingMessage, res: http.ServerResponse) => void> = {
  '/ok': (_req, res) => res.end('hello'),
  '/ua': (req, res) => res.end(String(req.headers['user-agent'])),
  '/drip': (_req, res) => {
    res.writeHead(200);
    const timer = setInterval(() => res.write('x'), 20);
    res.on('close', () => clearInterval(timer));
  },
  '/silent': () => {}, // never answers
  '/big': (_req, res) => {
    res.writeHead(200); // no Content-Length: only counting the bytes can catch it
    const chunk = Buffer.alloc(64 * 1024, 'a');
    const pump = () => { while (res.write(chunk)) { /* fill the socket */ } };
    res.on('drain', pump);
    pump();
  },
  '/declared-big': (_req, res) => { res.writeHead(200, { 'Content-Length': String(50 * 1024 * 1024) }); res.write('a'); },
  '/reset': (req, res) => { res.writeHead(200, { 'Content-Length': '100' }); res.write('part'); setTimeout(() => req.socket.destroy(), 5); },
  '/flaky': (req, res) => {
    if ((hits.get('/flaky') ?? 0) === 1) { req.socket.destroy(); return; }
    res.end('{"ok":true}');
  },
  '/always-reset': req => req.socket.destroy(),
  '/missing': (_req, res) => { res.writeHead(404); res.end('nope'); },
  '/robots-5xx': (_req, res) => { res.writeHead(503); res.end('busy'); },
  '/to-http': (_req, res) => { res.writeHead(301, { Location: 'ftp://elsewhere.example/robots.txt' }); res.end(); },
  '/bad-location': (_req, res) => { res.writeHead(302, { Location: 'http://[' }); res.end(); },
};

before(async () => {
  server = http.createServer((req, res) => {
    const path = req.url!.split('?')[0];
    hits.set(path, (hits.get(path) ?? 0) + 1);
    const loop = path.match(/^\/loop\/(\d+)$/);
    if (loop) {
      res.writeHead(302, { Location: `/loop/${Number(loop[1]) + 1}` });
      res.end();
      return;
    }
    const hop = path.match(/^\/hop\/(\d+)$/);
    if (hop) {
      const n = Number(hop[1]);
      res.writeHead(n ? 301 : 200, n ? { Location: `/hop/${n - 1}` } : {});
      res.end(n ? '' : 'User-agent: *\nDisallow: /private\n');
      return;
    }
    (routes[path] ?? routes['/missing'])(req, res);
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => new Promise<void>(r => { server.closeAllConnections(); server.close(() => r()); }));

const timers = () => process.getActiveResourcesInfo().filter(t => t === 'Timeout').length;
/** Lets the server side notice the closed socket (its drip interval stops on 'close') before counting */
const settleTimers = () => new Promise(r => setTimeout(r, 50));

test('reads a body, sends the project User-Agent, and leaves no timer behind', async () => {
  const before = timers();
  const res = await boundedGet(`${base}/ua`, { deadline: Date.now() + 2_000, maxBytes: 1024, get });
  assert.equal(res.status, 200);
  assert.equal(res.body.toString(), USER_AGENT);
  assert.equal(res.truncated, false);
  await settleTimers();
  assert.equal(timers(), before, 'the deadline timer is cleared');
});

test('slow drip: the deadline is a total limit, not an inactivity timeout, and the request is torn down', async () => {
  const before = timers();
  const started = Date.now();
  const err = await boundedGet(`${base}/drip?token=x`, { deadline: Date.now() + 150, maxBytes: 1024 * 1024, get }).catch(e => e as Error);
  assert.ok(err instanceof DeadlineError, String(err));
  assert.equal(err.message, `Timed out (deadline reached): 127.0.0.1:${new URL(base).port}/drip`, 'no query string');
  assert.ok(Date.now() - started < 600, `stopped at the deadline (${Date.now() - started} ms) although bytes kept coming`);
  await settleTimers();
  assert.equal(timers(), before);
});

test('a server that never answers hits the deadline too; an already passed deadline sends nothing', async () => {
  await assert.rejects(boundedGet(`${base}/silent`, { deadline: Date.now() + 80, maxBytes: 1024, get }), DeadlineError);
  const silent = hits.get('/ok') ?? 0;
  await assert.rejects(boundedGet(`${base}/ok`, { deadline: Date.now() - 1, maxBytes: 1024, get }), /deadline passed before the request/);
  assert.equal(hits.get('/ok') ?? 0, silent, 'not sent');
});

test('oversized bodies: stopped as soon as the limit is passed, by count or by declared length', async () => {
  const err = await boundedGet(`${base}/big`, { deadline: Date.now() + 5_000, maxBytes: 100 * 1024, get }).catch(e => e as Error);
  assert.match(err.message, /over the 102400-byte limit/);
  const declared = await boundedGet(`${base}/declared-big`, { deadline: Date.now() + 5_000, maxBytes: 1024, get }).catch(e => e as Error);
  assert.match(declared.message, /Response of 52428800 bytes is over the 1024-byte limit/);
  // Truncation keeps exactly the first maxBytes and still ends the download
  const cut = await boundedGet(`${base}/big`, { deadline: Date.now() + 5_000, maxBytes: 100_000, oversize: 'truncate', get });
  assert.equal(cut.body.length, 100_000);
  assert.equal(cut.truncated, true);
});

test('a socket error mid-body fails with the code kept as the cause, and counts as transient', async () => {
  const err = await boundedGet(`${base}/reset`, { deadline: Date.now() + 2_000, maxBytes: 1024, get }).catch(e => e as Error);
  assert.match(err.message, /\(127\.0\.0\.1:\d+\/reset\)$/);
  assert.ok(isTransient(err), `transient: ${err.message}`);
  assert.equal(isTransient(new DeadlineError('x')), false, 'our own deadline is not');
  assert.equal(isTransient(new Error('HTTP 500')), false);
});

// ---------- fetchers/ios.ts ----------

test('iOS asset catalog: one retry after a dropped connection, within the same deadline', async () => {
  hits.delete('/flaky');
  hits.set('/flaky', 0);
  // First request: hits becomes 1 and the socket is destroyed; the retry gets the body
  assert.equal(await httpsGet(`${base}/flaky`, get, 5_000), '{"ok":true}');
  assert.equal(hits.get('/flaky'), 2);
});

test('iOS asset catalog: retries at most once, never past the deadline, and not on HTTP errors', async () => {
  hits.set('/always-reset', 0);
  await assert.rejects(httpsGet(`${base}/always-reset`, get, 5_000));
  assert.equal(hits.get('/always-reset'), 2, 'one retry only');
  hits.set('/always-reset', 0);
  await assert.rejects(httpsGet(`${base}/always-reset`, get, 1_000));
  assert.equal(hits.get('/always-reset'), 1, 'not enough of the deadline left to retry');
  hits.set('/missing', 0);
  await assert.rejects(httpsGet(`${base}/missing`, get, 5_000), /^Error: HTTP 404 from 127\.0\.0\.1:\d+\/missing$/);
  assert.equal(hits.get('/missing'), 1);
  const started = Date.now();
  await assert.rejects(httpsGet(`${base}/drip`, get, 200), DeadlineError);
  assert.ok(Date.now() - started < 700, 'the deadline bounds the whole call');
});

// ---------- check-robots.ts ----------

test('robots.txt: redirects followed within the limit; one too many is reported as unreachable', async () => {
  const ok = await defaultFetch(`${base}/hop/${MAX_ROBOTS_REDIRECTS}`, { get });
  assert.equal(ok.status, 200);
  assert.match(ok.body, /Disallow: \/private/);
  hits.clear();
  const loop = await defaultFetch(`${base}/loop/0`, { get });
  assert.deepEqual(loop, { status: 0, body: '', error: `more than ${MAX_ROBOTS_REDIRECTS} redirects` });
  const requests = [...hits].filter(([p]) => p.startsWith('/loop/')).length;
  assert.equal(requests, MAX_ROBOTS_REDIRECTS + 1, 'stops asking after the limit');
});

test('robots.txt: unsafe or unusable redirects, 5xx, network errors and the deadline', async () => {
  assert.deepEqual(await defaultFetch(`${base}/to-http`, { get }), { status: 0, body: '', error: 'redirect to another scheme (ftp:)' });
  assert.deepEqual(await defaultFetch(`${base}/bad-location`, { get }), { status: 0, body: '', error: 'redirect to an invalid URL' });
  assert.equal((await defaultFetch(`${base}/robots-5xx`, { get })).status, 503);
  const reset = await defaultFetch(`${base}/always-reset`, { get });
  assert.equal(reset.status, 0);
  assert.ok(reset.error);
  const slow = await defaultFetch(`${base}/drip`, { get, timeoutMs: 100 });
  assert.equal(slow.status, 0);
  assert.match(slow.error ?? '', /Timed out/);
});

test('robots.txt: a huge file is cut at the RFC 9309 parsing limit instead of filling memory', async () => {
  const big = await defaultFetch(`${base}/big`, { get });
  assert.equal(big.status, 200);
  assert.equal(Buffer.byteLength(big.body), ROBOTS_MAX_BYTES);
});
