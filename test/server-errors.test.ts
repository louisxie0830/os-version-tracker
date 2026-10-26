import { after, afterEach, before, test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import type { AddressInfo } from 'node:net';
import { createHandler, guardRequests, setCompressorForTests } from '../src/server.ts';
import { SECURITY_HEADERS } from '../src/security-headers.ts';
import type { AllVersions } from '../src/fetch-all.ts';

/**
 * The server's error boundary and what happens when compression fails. Kept in its own file: these tests
 * swap the compressor, which is module-wide.
 */
const snapshot = JSON.parse(readFileSync(new URL('./fixtures/all-versions.json', import.meta.url), 'utf8')) as AllVersions;
const bytesTag = (body: Buffer) => `"${createHash('sha256').update(body).digest('base64url').slice(0, 32)}"`;

const rejections: unknown[] = [];
const onRejection = (err: unknown) => { rejections.push(err); };
before(() => { process.on('unhandledRejection', onRejection); });
after(() => { process.off('unhandledRejection', onRejection); });
afterEach(() => {
  setCompressorForTests();
  assert.deepEqual(rejections, [], 'no unhandled rejections');
});

/** A server around `listener` for one test */
async function serve(listener: http.RequestListener) {
  const server = http.createServer(listener);
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as AddressInfo).port;
  const request = (path: string, headers: Record<string, string> = {}, method = 'GET') => new Promise<{ status: number; headers: http.IncomingHttpHeaders; body: Buffer; complete: boolean }>((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path, headers, method }, res => {
      const chunks: Buffer[] = [];
      res.on('data', c => chunks.push(c));
      // A response cut short: the client sees an aborted, incomplete body
      res.on('error', () => {});
      res.on('close', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks), complete: res.complete }));
    });
    req.on('error', reject);
    req.end();
  });
  /** Sends a raw request line, for targets an HTTP client won't send */
  const raw = (line: string) => new Promise<string>(resolve => {
    const socket = net.connect(port, '127.0.0.1', () => socket.write(`${line}\r\nHost: x\r\nConnection: close\r\n\r\n`));
    let out = '';
    socket.on('data', d => { out += d; });
    socket.on('close', () => resolve(out));
  });
  const close = () => new Promise<void>(r => { server.closeAllConnections(); server.close(() => r()); });
  return { request, raw, close };
}

const hasSecurityHeaders = (headers: http.IncomingHttpHeaders) => {
  for (const name of Object.keys(SECURITY_HEADERS)) assert.ok(headers[name.toLowerCase()], `${name} kept`);
};

// ---------- error boundary ----------

test('a request target that is not a URL gets 400 with the security headers, and the server keeps serving', async () => {
  const s = await serve(createHandler(async () => ({ ...snapshot }), () => undefined));
  try {
    const out = await s.raw('GET http://[ HTTP/1.1');
    assert.match(out, /^HTTP\/1\.1 400 /);
    assert.match(out, /content-security-policy:/i);
    assert.match(out, /\{"error":"Bad request"\}$/);
    assert.equal((await s.request('/health')).status, 200, 'still serving');
  } finally {
    await s.close();
  }
});

test('a route that throws gets a plain 500: security headers kept, no error message or path sent', async () => {
  const s = await serve(createHandler(async () => ({ ...snapshot }), () => { throw new Error('ENOENT: /Users/someone/secret/state.json'); }));
  try {
    const res = await s.request('/health');
    assert.equal(res.status, 500);
    assert.deepEqual(JSON.parse(res.body.toString()), { error: 'Internal server error' });
    assert.doesNotMatch(res.body.toString(), /ENOENT|Users|secret/);
    hasSecurityHeaders(res.headers);
    assert.equal(Number(res.headers['content-length']), res.body.length);
    const head = await s.request('/health', {}, 'HEAD');
    assert.equal(head.status, 500);
    assert.equal(head.body.length, 0);
  } finally {
    await s.close();
  }
});

test('routes keep their own friendly errors (the boundary is only for what they don\'t catch)', async () => {
  const s = await serve(createHandler(() => Promise.reject(new Error('upstream down')), () => undefined));
  try {
    assert.deepEqual(JSON.parse((await s.request('/api.json')).body.toString()), { error: 'Failed to fetch versions' });
    const ics = await s.request('/calendar.ics');
    assert.equal(ics.body.toString(), 'Failed to build calendar', 'plain text, not JSON pretending to be a calendar');
    assert.equal(ics.headers['access-control-allow-origin'], '*', 'a data route\'s error is readable cross-origin too');
    assert.match((await s.request('/')).body.toString(), /無法取得版本資料/);
  } finally {
    await s.close();
  }
});

test('an error after the headers were sent destroys the connection instead of writing a second response', async () => {
  const s = await serve(guardRequests(async (_req, res) => {
    res.writeHead(200, { 'Content-Length': '100' });
    res.write('partial');
    throw new Error('render failed halfway');
  }));
  try {
    const res = await s.request('/');
    assert.equal(res.status, 200);
    assert.equal(res.complete, false, 'the client sees an incomplete response');
    assert.equal(res.body.toString(), 'partial');
  } finally {
    await s.close();
  }
});

test('an error after a complete response changes nothing; representation headers set before a failure are dropped', async () => {
  const s = await serve(guardRequests(async (req, res) => {
    if (req.url === '/done') {
      res.writeHead(200, { 'Content-Length': '2' });
      res.end('ok');
      throw new Error('cleanup failed');
    }
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('ETag', '"abc"');
    res.setHeader('Content-Encoding', 'br');
    throw new Error('before writing');
  }));
  try {
    const done = await s.request('/done');
    assert.equal(done.complete, true);
    assert.equal(done.body.toString(), 'ok');
    const failed = await s.request('/early');
    assert.equal(failed.status, 500);
    assert.equal(failed.headers.etag, undefined, 'no ETag of a representation that was never sent');
    assert.equal(failed.headers['content-encoding'], undefined);
    assert.equal(failed.headers['x-frame-options'], 'DENY', 'other headers already set are kept');
  } finally {
    await s.close();
  }
});

// ---------- compression failures ----------

/** A compressor where `fail` lists the encodings that throw; calls are counted */
function fakeCompressor(fail: string[] = [], delayMs = 0) {
  const calls: string[] = [];
  setCompressorForTests(async (encoding, input) => {
    calls.push(encoding);
    if (delayMs) await new Promise(r => setTimeout(r, delayMs));
    if (fail.includes(encoding)) throw new Error(`${encoding} exploded`);
    return gzipSync(input); // valid bytes; only the label matters here
  });
  return calls;
}

test('br failing falls back to the next acceptable coding (gzip), with that representation\'s headers and ETag', async () => {
  fakeCompressor(['br']);
  const s = await serve(createHandler(async () => ({ ...snapshot }), () => undefined));
  try {
    const res = await s.request('/api.json', { 'Accept-Encoding': 'br, gzip' });
    assert.equal(res.status, 200);
    assert.equal(res.headers['content-encoding'], 'gzip');
    assert.equal(res.headers.vary, 'Accept-Encoding');
    assert.equal(res.headers.etag, bytesTag(res.body));
    assert.equal(Number(res.headers['content-length']), res.body.length);
    const head = await s.request('/api.json', { 'Accept-Encoding': 'br, gzip' }, 'HEAD');
    assert.equal(head.headers['content-encoding'], 'gzip');
    assert.equal(head.headers.etag, res.headers.etag);
  } finally {
    await s.close();
  }
});

test('br failing with identity acceptable sends the body as it is; with identity;q=0 and every compression failing, a 500 (not 406)', async () => {
  fakeCompressor(['br', 'gzip']);
  const s = await serve(createHandler(async () => ({ ...snapshot }), () => undefined));
  try {
    const plain = await s.request('/api.json', { 'Accept-Encoding': 'br' });
    assert.equal(plain.status, 200);
    assert.equal(plain.headers['content-encoding'], undefined, 'identity is acceptable when unnamed');
    assert.ok(JSON.parse(plain.body.toString()));

    const refused = await s.request('/api.json', { 'Accept-Encoding': 'br, gzip, identity;q=0' });
    assert.equal(refused.status, 500, 'acceptable codings exist; they failed on our side');
    assert.equal(refused.headers['content-encoding'], undefined, 'never the refused identity body labelled otherwise');
    assert.equal(refused.headers.etag, undefined);
    assert.equal(refused.headers.vary, 'Accept-Encoding');
    hasSecurityHeaders(refused.headers);
    assert.doesNotMatch(refused.body.toString(), /exploded/);

    assert.equal((await s.request('/api.json', { 'Accept-Encoding': 'identity;q=0, *;q=0' })).status, 406, 'refusing everything is still a 406');
  } finally {
    await s.close();
  }
});

test('a failed compression is not cached: the next request compresses again and succeeds', async () => {
  let failNext = true;
  let calls = 0;
  setCompressorForTests(async (_encoding, input) => {
    calls++;
    if (failNext) {
      failNext = false;
      throw new Error('transient');
    }
    return gzipSync(input);
  });
  const snap = { ...snapshot };
  const s = await serve(createHandler(async () => snap, () => undefined));
  try {
    const first = await s.request('/api.json', { 'Accept-Encoding': 'gzip' });
    assert.equal(first.headers['content-encoding'], undefined, 'fell back to identity');
    const second = await s.request('/api.json', { 'Accept-Encoding': 'gzip' });
    assert.equal(second.headers['content-encoding'], 'gzip');
    assert.equal(calls, 2, 'retried, not served from a rejected cache entry');
    await s.request('/api.json', { 'Accept-Encoding': 'gzip' });
    assert.equal(calls, 2, 'and cached once it worked');
  } finally {
    await s.close();
  }
});

test('concurrent requests share one pending compression', async () => {
  const calls = fakeCompressor([], 20);
  const snap = { ...snapshot };
  const s = await serve(createHandler(async () => snap, () => undefined));
  try {
    const all = await Promise.all(Array.from({ length: 5 }, () => s.request('/api.json', { 'Accept-Encoding': 'gzip' })));
    assert.deepEqual(calls, ['gzip']);
    assert.ok(all.every(r => r.headers.etag === all[0].headers.etag && r.body.equals(all[0].body)));
  } finally {
    await s.close();
  }
});

// ---------- strong ETags of the bytes sent ----------

test('the same content compressed to different bytes gets a different strong ETag; the same bytes the same one', async () => {
  let variant = 0;
  setCompressorForTests(async (_encoding, input) => Buffer.concat([gzipSync(input), Buffer.from([variant++])]));
  let current = { ...snapshot };
  const s = await serve(createHandler(async () => current, () => undefined));
  try {
    const a = await s.request('/api.json', { 'Accept-Encoding': 'gzip' });
    const aAgain = await s.request('/api.json', { 'Accept-Encoding': 'gzip' });
    assert.equal(aAgain.headers.etag, a.headers.etag, 'cached: same bytes, same ETag');
    assert.ok(aAgain.body.equals(a.body));

    // Identical content, compressed again (a new snapshot, as after a restart with another zlib)
    current = { ...snapshot };
    const b = await s.request('/api.json', { 'Accept-Encoding': 'gzip' });
    assert.ok(!b.body.equals(a.body), 'different compressed bytes');
    assert.notEqual(b.headers.etag, a.headers.etag, 'so a different strong ETag');
    assert.equal(b.headers.etag, bytesTag(b.body));
    // The old validator no longer matches: the client gets the new bytes, not a 304 for bytes it doesn't have
    assert.equal((await s.request('/api.json', { 'Accept-Encoding': 'gzip', 'If-None-Match': String(a.headers.etag) })).status, 200);
    const notModified = await s.request('/api.json', { 'Accept-Encoding': 'gzip', 'If-None-Match': String(b.headers.etag) });
    assert.equal(notModified.status, 304);
    // RFC 9110 §15.4.5: ETag, Cache-Control and Vary; no Content-Encoding or body
    assert.equal(notModified.headers.etag, b.headers.etag);
    assert.equal(notModified.headers.vary, 'Accept-Encoding');
    assert.equal(notModified.headers['content-encoding'], undefined);
    assert.equal(notModified.body.length, 0);
    // The identity representation's ETag is its own bytes' hash and never matches the gzip one
    const identity = await s.request('/api.json');
    assert.equal(identity.headers.etag, bytesTag(identity.body));
    assert.equal((await s.request('/api.json', { 'If-None-Match': String(b.headers.etag) })).status, 200);
  } finally {
    await s.close();
  }
});

test('server mode answers the static site\'s paths, refuses other methods, and marks data routes cross-origin', async () => {
  const snap = JSON.parse((await import('node:fs')).readFileSync(new URL('./fixtures/all-versions.json', import.meta.url), 'utf8'));
  const s = await serve(createHandler(async () => snap, () => ({ value: snap, fetchedAt: Date.now() })));
  try {
    const page = await s.request('/index.html');
    assert.equal(page.status, 200);
    assert.equal(page.headers['cache-control'], 'no-cache');
    const legal = await s.request('/legal');
    assert.deepEqual([legal.status, legal.headers.location], [301, '/legal/']);
    assert.equal((await s.request('/legal/en')).headers.location, '/legal/en/');
    assert.equal((await s.request('/health.json')).status, 200);
    const api = await s.request('/api.json');
    assert.equal(api.headers['access-control-allow-origin'], '*');
    assert.equal(api.headers['cache-control'], 'public, max-age=300');
    for (const path of ['/feed.xml', '/calendar.ics', '/notifications.json', '/api/versions.json']) {
      assert.equal((await s.request(path)).headers['access-control-allow-origin'], '*', path);
    }
    assert.equal((await s.request('/')).headers['access-control-allow-origin'], undefined, 'the page itself isn\'t data');
    const post = await s.request('/api.json', {}, 'POST');
    assert.deepEqual([post.status, post.headers.allow], [405, 'GET, HEAD']);
    const preflight = await s.request('/api/versions.json', {}, 'OPTIONS');
    assert.deepEqual([preflight.status, preflight.headers['access-control-allow-origin']], [204, '*']);
    assert.equal((await s.request('/legal/en/index.html')).status, 200, 'a legal page by its file name');
  } finally {
    await s.close();
  }
});
