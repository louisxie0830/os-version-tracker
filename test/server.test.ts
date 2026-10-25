import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { brotliDecompressSync, gunzipSync } from 'node:zlib';
import { assetCacheControl, compressionCount, createHandler, MIN_COMPRESS_BYTES, pickEncoding } from '../src/server.ts';
import { readScript, SCRIPT_VERSIONS, SCRIPTS } from '../src/asset-versions.ts';
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

function head(path: string): Promise<{ status: number; body: string; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    http.request(`${base}${path}`, { method: 'HEAD' }, res => {
      let body = '';
      res.on('data', c => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body, headers: res.headers }));
    }).on('error', reject).end();
  });
}

test('HEAD answers like GET without a body, so monitors and link checkers see the real status', async () => {
  for (const path of ['/', '/health', '/api/now.json', '/api.json', '/feed.xml', '/calendar.ics', '/legal/', '/style.css', '/app.js', '/nope']) {
    const g = await get(path);
    const h = await head(path);
    assert.equal(h.status, g.status, path);
    // Every header the same, Content-Length included (GET isn't sent chunked); only the body is left out
    const without = (headers: http.IncomingHttpHeaders) => Object.fromEntries(Object.entries(headers).filter(([k]) => k !== 'date'));
    assert.deepEqual(without(h.headers), without(g.headers), path);
    assert.equal(Number(g.headers['content-length']), Buffer.byteLength(g.body), `${path}: Content-Length is the body's length`);
    assert.equal(h.body, '', path);
  }
  assert.equal((await head('/api/nope.json')).status, 404);
});

test('health, API and generated feeds', async () => {
  const health = await get('/health');
  assert.equal(health.status, 200);
  assert.ok(['starting', 'ok', 'degraded'].includes(JSON.parse(health.body).status));

  for (const path of ['/api', '/api.json']) {
    const api = await get(path);
    assert.equal(api.status, 200);
    assert.match(api.type, /application\/json/);
    const body = JSON.parse(api.body);
    // The original all-in-one shape is untouched: every field and value as before…
    for (const [key, value] of Object.entries(snapshot)) assert.deepEqual(body[key], JSON.parse(JSON.stringify(value)), `${path}: ${key}`);
    // …with only the licence information added next to it
    assert.deepEqual(Object.keys(body).filter(k => !(k in snapshot)), ['license', 'termsUrl', 'attribution']);
    assert.ok(body.attribution.some((a: { source: string; credit?: string }) => a.source === 'osShare' && a.credit === 'StatCounter Global Stats'));
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
  for (const id of ['now', 'feed', 'subscribe', 'crashes', 'ios', 'android', 'compat', 'deadlines', 'banks', 'privacy', 'api', 'legal']) {
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

test('styles come only from the same-origin stylesheet', async () => {
  const page = await get('/');
  assert.ok(!/<style\b/i.test(page.body), 'no <style> block');
  assert.ok(!/\sstyle="/i.test(page.body), 'no style attributes');
  assert.match(page.headers['content-security-policy'] ?? '', /style-src 'self';/);
  const href = page.body.match(/<link rel="stylesheet" href="([^"]+)">/)?.[1];
  assert.match(href ?? '', /^style\.css\?v=[0-9a-f]{10}$/);
  const css = await get(`/${href}`);
  assert.equal(css.status, 200);
  assert.match(String(css.headers['content-type']), /^text\/css/);
  assert.match(css.body, /\.w-37 \{ width: 37%; \}/);
  // Every width class the page uses exists in the stylesheet
  for (const [, n] of page.body.matchAll(/\bw-(\d+)\b/g)) assert.ok(Number(n) <= 100);
});

test('the page asks search engines not to index it and carries no SEO markup', async () => {
  const { body } = await get('/');
  assert.match(body, /<meta name="robots" content="noindex, nofollow, noarchive, nosnippet, noimageindex, noai, noimageai">/);
  for (const seo of ['application/ld+json', 'rel="canonical"', 'name="keywords"', 'google-site-verification']) {
    assert.ok(!body.includes(seo), seo);
  }
});

test('every response carries the security headers', async () => {
  for (const path of ['/', '/api.json', '/sw.js', '/nope']) {
    const { headers } = await get(path);
    assert.match(String(headers['content-security-policy']), /frame-ancestors 'none'/, path);
    assert.equal(headers['x-content-type-options'], 'nosniff', path);
    assert.equal(headers['x-frame-options'], 'DENY', path);
    assert.equal(headers['referrer-policy'], 'strict-origin-when-cross-origin', path);
    assert.match(String(headers['x-robots-tag']), /noindex.*noai/, path);
  }
});

test('topic API endpoints share one envelope; the index lists them; unknown ones are 404', async () => {
  const index = await get('/api/index.json');
  assert.equal(index.status, 200);
  assert.equal(index.headers['access-control-allow-origin'], '*');
  const { endpoints } = JSON.parse(index.body) as { endpoints: Array<{ path: string }> };
  const topics = endpoints.map(e => e.path).filter(p => p.startsWith('api/'));
  assert.ok(topics.length >= 10, `${topics.length} endpoints`);

  for (const path of topics) {
    const res = await get(`/${path}`);
    assert.equal(res.status, 200, path);
    const body = JSON.parse(res.body);
    // Existing fields keep their names and order; license / termsUrl / attribution were added before data
    assert.deepEqual(Object.keys(body), ['apiVersion', 'updatedAt', 'sources', 'license', 'termsUrl', 'attribution', 'data'], path);
    assert.equal(body.updatedAt, snapshot.cachedAt, path);
    assert.match(body.termsUrl, /\/legal\/$/, path);
    assert.ok(Array.isArray(body.attribution) && body.attribution.length > 0, `${path} credits its sources`);
    for (const a of body.attribution) assert.ok(a.source && a.licence && a.terms.length, `${path} ${a.source}`);
  }
  assert.equal(JSON.parse((await get('/api/versions.json')).body).data.ios[0].version, snapshot.ios[0].version);

  const missing = await get('/api/nope.json');
  assert.equal(missing.status, 404);
  assert.equal(JSON.parse(missing.body).index, '/api/index.json');
  assert.equal((await get('/api/../package.json')).status, 404);
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

test('healthBody reports the cached data\'s state without fetching anything', async () => {
  const { healthBody } = await import('../src/server.ts');
  assert.deepEqual(healthBody(undefined), { status: 'starting' });
  const sources = (ok: number, failed: number) => Object.fromEntries([
    // ios and android are the critical sources: without them nothing is publishable
    ...Array.from({ length: ok }, (_, i) => [['ios', 'android'][i] ?? `ok${i}`, { label: '', url: '', fetchedAt: '', ok: true }]),
    ...Array.from({ length: failed }, (_, i) => [`bad${i}`, { label: '', url: '', fetchedAt: '', ok: false }]),
  ]);
  const now = Date.parse('2026-10-17T12:00:00Z');
  const healthy = healthBody({ value: { ...snapshot, sources: sources(25, 1), cachedAt: '2026-10-17T11:40:00Z' }, fetchedAt: now - 20 * 60_000 }, now);
  assert.deepEqual(healthy, { status: 'ok', sources: '25/26', failed: ['bad0'], updatedAt: '2026-10-17T11:40:00Z', ageMinutes: 20 });
  const degraded = healthBody({ value: { ...snapshot, sources: sources(10, 16) }, fetchedAt: now }, now);
  assert.equal(degraded.status, 'degraded');
  assert.equal('reason' in degraded && degraded.reason, 'only 10/26 sources succeeded');
});

test('the legal documents are served on the same domain as the page', async () => {
  for (const [path, text] of [['/legal/', '免責聲明與智慧財產權聲明'], ['/legal/en/', 'Disclaimer and Intellectual Property Notice'], ['/legal/sources/', '資料來源合規清冊']]) {
    const res = await get(path);
    assert.equal(res.status, 200, path);
    assert.match(res.type, /^text\/html/, path);
    assert.ok(res.body.includes(text), path);
    assert.match(res.headers['content-security-policy'] ?? '', /style-src 'self';/, path);
  }
  assert.equal((await get('/legal/nope/')).status, 404);
  const page = await get('/');
  for (const href of ['legal/', 'legal/en/', 'legal/sources/']) assert.ok(page.body.includes(`href="${href}"`), `page links to ${href}`);
});

test('derived responses are built once per data snapshot and revalidate with ETag / If-None-Match', async () => {
  let builds = 0;
  const countingData = { ...snapshot };
  const server2 = http.createServer(createHandler(async () => { builds++; return countingData; }, () => undefined));
  await new Promise<void>(r => server2.listen(0, r));
  const port = (server2.address() as { port: number }).port;
  const req = (p: string, headers: Record<string, string> = {}) => new Promise<{ status: number; etag?: string; body: string }>((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path: p, headers }, res => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', c => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, etag: res.headers.etag as string | undefined, body }));
    }).on('error', reject);
  });
  try {
    for (const p of ['/', '/api/now.json', '/api.json', '/feed.xml', '/calendar.ics', '/notifications.json', '/legal/', '/style.css', '/app.js']) {
      const first = await req(p);
      assert.equal(first.status, 200, p);
      assert.match(first.etag ?? '', /^"[\w-]{32}"$/, `${p} has an ETag`);
      const again = await req(p);
      assert.equal(again.etag, first.etag, `${p}: same snapshot, same ETag`);
      const revalidated = await req(p, { 'If-None-Match': first.etag! });
      assert.equal(revalidated.status, 304, `${p}: unchanged → 304`);
      assert.equal(revalidated.body, '', `${p}: no body with 304`);
      assert.equal((await req(p, { 'If-None-Match': '"something-else"' })).status, 200, `${p}: other ETag → full response`);
    }
  } finally {
    server2.closeAllConnections();
    await new Promise(r => server2.close(r));
  }
  assert.ok(builds > 0);
});

// ---------- compression ----------

/** The strong ETag the server gives a body: the hash of exactly these bytes */
const bytesTag = (body: Buffer) => `"${createHash('sha256').update(body).digest('base64url').slice(0, 32)}"`;

/** A request with any headers, the body kept as bytes (compressed bodies aren't text) */
function fetchRaw(path: string, headers: Record<string, string> = {}, method = 'GET'): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: Buffer }> {
  return new Promise((resolve, reject) => {
    http.request(`${base}${path}`, { method, headers }, res => {
      const chunks: Buffer[] = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }));
    }).on('error', reject).end();
  });
}

test('Accept-Encoding: q-values, q=0, wildcard, identity, case, spaces and tie order', () => {
  // Plain lists: br, then gzip, then identity on equal weights
  assert.equal(pickEncoding('gzip, deflate, br'), 'br');
  assert.equal(pickEncoding('gzip'), 'gzip');
  assert.equal(pickEncoding('br, gzip, identity'), 'br');
  assert.equal(pickEncoding('br;q=0.5, gzip;q=0.5'), 'br', 'tie: br first');
  assert.equal(pickEncoding('br;q=0.5, gzip;q=0.9'), 'gzip');
  assert.equal(pickEncoding('identity, gzip;q=0.5'), 'identity', 'identity asked for more strongly');
  assert.equal(pickEncoding('gzip;q=0.1'), 'gzip', 'an unnamed identity ranks below any coding asked for');
  // q=0 refuses
  assert.equal(pickEncoding('br;q=0, gzip'), 'gzip');
  assert.equal(pickEncoding('br;q=0, gzip;q=0'), 'identity', 'identity is still acceptable');
  assert.equal(pickEncoding('identity;q=0'), null, 'only identity was possible and it is refused');
  assert.equal(pickEncoding('gzip, identity;q=0'), 'gzip');
  // Wildcard
  assert.equal(pickEncoding('*'), 'br');
  assert.equal(pickEncoding('*;q=0'), null, '*;q=0 without an identity entry refuses identity too');
  assert.equal(pickEncoding('*;q=0, identity'), 'identity');
  assert.equal(pickEncoding('*;q=0, gzip;q=0.3'), 'gzip');
  assert.equal(pickEncoding('br;q=0.2, *;q=0.8'), 'gzip', '* covers the unnamed gzip (0.8) above br (0.2)');
  // Invalid q-values are ignored, never stretched into range
  for (const bad of ['2', '1.5', '-1', '0.1234', 'abc', '', '1.001']) {
    assert.equal(pickEncoding(`br;q=${bad}`), 'identity', `br;q=${bad}`);
  }
  assert.equal(pickEncoding('br;q=1.000, gzip;q=0.999'), 'br');
  assert.equal(pickEncoding('br;q=2, gzip;q=0.5'), 'gzip');
  // Case and whitespace
  assert.equal(pickEncoding('  GZip ;  Q=0.5 ,  BR ; q = 0 '), 'gzip');
  assert.equal(pickEncoding('Identity;Q=0, *;q=0'), null);
  assert.equal(pickEncoding(' , ,gzip'), 'gzip');
  // An empty header wants no coding; no header at all gets identity as before
  assert.equal(pickEncoding(''), 'identity');
  assert.equal(pickEncoding(undefined), 'identity');
  // Responses that are never compressed only have identity to offer
  assert.equal(pickEncoding('br, gzip', ['identity']), 'identity');
  assert.equal(pickEncoding('br, identity;q=0', ['identity']), null);
});

test('406 when every available coding is refused; still 200 when identity remains acceptable', async () => {
  for (const header of ['identity;q=0', '*;q=0', 'br;q=0, gzip;q=0, identity;q=0']) {
    const page = await fetchRaw('/', { 'Accept-Encoding': header });
    assert.equal(page.status, 406, header);
    assert.equal(page.headers.vary, 'Accept-Encoding');
    assert.equal(Number(page.headers['content-length']), page.body.length);
    const h = await fetchRaw('/', { 'Accept-Encoding': header }, 'HEAD');
    assert.equal(h.status, 406, `HEAD ${header}`);
    assert.equal(h.body.length, 0);
  }
  // A page that may be compressed: refusing identity alone still leaves br
  const br = await fetchRaw('/', { 'Accept-Encoding': 'br, identity;q=0' });
  assert.equal(br.status, 200);
  assert.equal(br.headers['content-encoding'], 'br');
  // An image has only identity to offer
  assert.equal((await fetchRaw('/og-image.png', { 'Accept-Encoding': 'br, identity;q=0' })).status, 406);
  assert.equal((await fetchRaw('/og-image.png', { 'Accept-Encoding': 'br;q=0, gzip;q=0' })).status, 200, 'identity unnamed: still fine');
});

test('text responses are sent as identity, br or gzip as asked, each decoding to the same body with its own ETag', async () => {
  for (const path of ['/', '/api.json', '/api/now.json', '/feed.xml', '/calendar.ics', '/style.css', '/app.js', '/legal/']) {
    const identity = await fetchRaw(path);
    const br = await fetchRaw(path, { 'Accept-Encoding': 'br' });
    const gz = await fetchRaw(path, { 'Accept-Encoding': 'gzip' });
    assert.equal(identity.headers['content-encoding'], undefined, path);
    assert.equal(br.headers['content-encoding'], 'br', path);
    assert.equal(gz.headers['content-encoding'], 'gzip', path);
    assert.ok(brotliDecompressSync(br.body).equals(identity.body), `${path}: br decodes to the same body`);
    assert.ok(gunzipSync(gz.body).equals(identity.body), `${path}: gzip decodes to the same body`);
    assert.ok(br.body.length < identity.body.length, `${path}: smaller`);
    for (const r of [identity, br, gz]) {
      assert.equal(r.headers.vary, 'Accept-Encoding', path);
      assert.equal(Number(r.headers['content-length']), r.body.length, `${path}: Content-Length is the bytes sent`);
    }
    assert.equal(new Set([identity.headers.etag, br.headers.etag, gz.headers.etag]).size, 3, `${path}: one ETag per representation`);
    // Each strong ETag is the hash of the bytes that representation sends
    for (const r of [identity, br, gz]) assert.equal(r.headers.etag, bytesTag(r.body), `${path}: ETag of the bytes sent`);
  }
});

test('If-None-Match only matches the representation it came from: a gzip ETag never validates identity, or br', async () => {
  const identity = await fetchRaw('/api.json');
  const gz = await fetchRaw('/api.json', { 'Accept-Encoding': 'gzip' });
  const gzTag = String(gz.headers.etag);
  const again = await fetchRaw('/api.json', { 'Accept-Encoding': 'gzip', 'If-None-Match': gzTag });
  assert.equal(again.status, 304);
  assert.equal(again.body.length, 0);
  assert.equal(again.headers.etag, gzTag);
  assert.equal(again.headers.vary, 'Accept-Encoding', '304 keeps Vary');
  assert.equal((await fetchRaw('/api.json', { 'If-None-Match': gzTag })).status, 200, 'gzip tag, identity request: full body');
  assert.equal((await fetchRaw('/api.json', { 'Accept-Encoding': 'br', 'If-None-Match': gzTag })).status, 200, 'gzip tag, br request: full body');
  assert.equal((await fetchRaw('/api.json', { 'Accept-Encoding': 'gzip', 'If-None-Match': String(identity.headers.etag) })).status, 200, 'identity tag, gzip request: full body');
  // Weak comparison, as If-None-Match requires, and a list of tags
  assert.equal((await fetchRaw('/api.json', { 'Accept-Encoding': 'gzip', 'If-None-Match': `"x", W/${gzTag}` })).status, 304);
});

test('HEAD sends the same headers as GET for each encoding (Content-Length of the compressed body), without a body', async () => {
  for (const enc of ['br', 'gzip', '']) {
    const headers = enc ? { 'Accept-Encoding': enc } : {};
    const g = await fetchRaw('/', headers);
    const h = await fetchRaw('/', headers, 'HEAD');
    const without = (x: http.IncomingHttpHeaders) => Object.fromEntries(Object.entries(x).filter(([k]) => k !== 'date'));
    assert.deepEqual(without(h.headers), without(g.headers), enc || 'identity');
    assert.equal(h.body.length, 0);
    assert.equal(Number(h.headers['content-length']), g.body.length);
  }
});

test('small responses and images are never compressed', async () => {
  const png = await fetchRaw('/og-image.png', { 'Accept-Encoding': 'br, gzip' });
  assert.equal(png.status, 200);
  assert.equal(png.headers['content-encoding'], undefined, 'PNG is already compressed');
  assert.equal(png.headers.vary, undefined);
  const svg = await fetchRaw('/icons/icon.svg', { 'Accept-Encoding': 'br, gzip' });
  assert.equal(svg.headers['content-encoding'], undefined, 'images are sent as they are');
  const small = await fetchRaw('/api/status.json', { 'Accept-Encoding': 'br, gzip' });
  assert.equal(small.status, 200);
  assert.ok(small.body.length < MIN_COMPRESS_BYTES, 'a small JSON file');
  assert.equal(small.headers['content-encoding'], undefined, 'small: not worth compressing');
  assert.equal(small.headers.vary, undefined, 'and always sent as it is, so nothing varies');
  // Just above the limit, the same kind of file is compressed (the manifest is ~1.3 KB)
  assert.equal((await fetchRaw('/manifest.webmanifest', { 'Accept-Encoding': 'gzip' })).headers['content-encoding'], 'gzip');
  const health = await fetchRaw('/health', { 'Accept-Encoding': 'br, gzip' });
  assert.equal(health.headers['content-encoding'], undefined);
});

test('compressed bodies are cached per snapshot and encoding, and a new snapshot gets freshly compressed ones', async () => {
  let current: AllVersions = { ...snapshot };
  const server3 = http.createServer(createHandler(async () => current, () => undefined));
  await new Promise<void>(r => server3.listen(0, '127.0.0.1', r));
  const port = (server3.address() as AddressInfo).port;
  const fetchAt = (path: string, headers: Record<string, string>) => new Promise<{ etag: string; body: Buffer; encoding?: string }>((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path, headers }, res => {
      const chunks: Buffer[] = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ etag: String(res.headers.etag), body: Buffer.concat(chunks), encoding: res.headers['content-encoding'] }));
    }).on('error', reject);
  });
  try {
    const before = compressionCount();
    const first = await Promise.all([1, 2, 3].map(() => fetchAt('/api.json', { 'Accept-Encoding': 'br' })));
    assert.equal(compressionCount() - before, 1, 'three concurrent requests, one compression');
    assert.ok(first.every(r => r.body.equals(first[0].body) && r.etag === first[0].etag));
    await fetchAt('/api.json', { 'Accept-Encoding': 'gzip' });
    await fetchAt('/api.json', { 'Accept-Encoding': 'gzip' });
    assert.equal(compressionCount() - before, 2, 'one more for gzip, then reused');

    // A data update: the next request compresses the new snapshot, with a new ETag and the new content
    current = { ...snapshot, cachedAt: '2026-10-17T12:00:00.000Z' };
    const after = await fetchAt('/api.json', { 'Accept-Encoding': 'br' });
    assert.equal(compressionCount() - before, 3);
    assert.notEqual(after.etag, first[0].etag);
    assert.equal(after.etag, bytesTag(after.body));
    assert.equal(JSON.parse(brotliDecompressSync(after.body).toString()).cachedAt, '2026-10-17T12:00:00.000Z');
    assert.equal((await fetchAt('/api.json', { 'Accept-Encoding': 'br' })).etag, after.etag);
    assert.equal(compressionCount() - before, 3, 'the new snapshot is compressed only once too');

    // Files that never change (the stylesheet) are compressed once for the whole process
    const css = compressionCount();
    await fetchAt('/style.css', { 'Accept-Encoding': 'br' });
    const once = compressionCount();
    assert.ok(once - css <= 1);
    await fetchAt('/style.css', { 'Accept-Encoding': 'br' });
    assert.equal(compressionCount(), once);
  } finally {
    server3.closeAllConnections();
    await new Promise(r => server3.close(r));
  }
});

// ---------- versioned scripts ----------

test('the page links each script with its content version, and the server caches the current version for good', async () => {
  const page = (await get('/')).body;
  for (const [name, version] of Object.entries(SCRIPT_VERSIONS)) {
    assert.ok(page.includes(`src="${name}?v=${version}"`), `${name} is linked with its version`);
    const current = await fetchRaw(`/${name}?v=${version}`);
    assert.equal(current.status, 200);
    assert.equal(current.headers['cache-control'], 'public, max-age=31536000, immutable', `${name}: the current version never changes`);
    // An unversioned or old URL (a page cached from before a deployment) is revalidated, never kept for a day
    assert.equal((await fetchRaw(`/${name}`)).headers['cache-control'], 'no-cache');
    assert.equal((await fetchRaw(`/${name}?v=0000000000`)).headers['cache-control'], 'no-cache');
  }
  const legal = (await get('/legal/')).body;
  assert.ok(legal.includes(`src="../theme.js?v=${SCRIPT_VERSIONS['theme.js']}"`), 'legal pages use the same version');
  assert.equal((await fetchRaw('/sw.js')).headers['cache-control'], 'no-cache', 'the service worker is always revalidated');
  assert.equal(assetCacheControl('/icons/icon.svg', null), 'public, max-age=86400');
});

test('every page script in SCRIPTS is served from where the resolver says (components compiled, the rest public/) as JavaScript; other paths stay unlisted', async () => {
  for (const name of SCRIPTS) {
    const res = await get(`/${name}`);
    assert.equal(res.status, 200, name);
    assert.match(res.type, /^text\/javascript/, name);
    assert.equal(res.body, readScript(name).toString(), `${name}: the file as it is`);
  }
  for (const path of ['/components.js', '/public/app.js', '/scripts/page-probe.js', '/browser/bank-table.js', '/dist/browser/bank-table.js', '/bank-table.ts', '/src/browser/bank-table.ts', '/server.js']) assert.equal((await get(path)).status, 404, path);
});
