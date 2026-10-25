import http from 'node:http';
import { createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { brotliCompress, constants as zlib, gzip } from 'node:zlib';
import { buildApiFiles, legacyApiJson } from './api.js';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { fetchAllVersions, peekAllVersions, SITE_URL, type AllVersions } from './fetch-all.js';
import { publishDecision } from './publish-health.js';
import { buildCalendar } from './calendar.js';
import { buildAtomFeed, buildNotificationsJson } from './changes.js';
import { renderHTML } from './render.js';
import { PAGE_CSS, STYLE_VERSION } from './render-styles.js';
import { isScript, PUBLIC_DIR, SCRIPT_VERSIONS, SCRIPTS, scriptPath } from './asset-versions.js';
import { SECURITY_HEADERS } from './security-headers.js';
import { LEGAL_PAGES, renderLegalPage } from './legal-pages.js';

const PORT = Number(process.env.PORT) || 3000;

// The legal documents sit at the project root, next to src/ and dist/
const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const STATIC_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json',
  '.js': 'text/javascript; charset=utf-8',
};

/** A response body with its ETag, computed once; its compressed forms are added on first request */
interface Cached { body: string | Buffer; etag: string; encoded?: Map<Encoding, Promise<Cached>> }

const tag = (body: string | Buffer): Cached => ({ body, etag: `"${createHash('sha256').update(body).digest('base64url').slice(0, 32)}"` });

// ---------- compression ----------

type Encoding = 'br' | 'gzip';
/** A content coding we can send: one of the compressed ones, or the body as it is */
type Coding = Encoding | 'identity';
/** Text formats worth compressing; images (PNG, the SVG icon) and anything already compressed are sent as they are */
const COMPRESSIBLE = /^(?:text\/(?:html|css|javascript|calendar)|application\/(?:json|manifest\+json|xml|atom\+xml))(?:;|$)/;
/** Below this, compression saves too little to be worth it (headers alone are a few hundred bytes) */
export const MIN_COMPRESS_BYTES = 1024;
/**
 * Brotli 9 and gzip 9. Measured on the real outputs (352 KB page, 170 KB api.json): about 6 ms and 3.5 ms for
 * the page, in libuv's thread pool (async, so the event loop keeps serving), once per data snapshot and
 * encoding. Brotli 6 would save ~2.5 ms once per snapshot for a ~3% larger body on every request, so 9 stays;
 * only 10–11 are slow (~350 ms for the page) and are avoided.
 */
const BROTLI_QUALITY = 9;
const GZIP_LEVEL = 9;
const brotli = promisify(brotliCompress);
const gzipped = promisify(gzip);
type Compressor = (encoding: Encoding, input: Buffer) => Promise<Buffer>;
const zlibCompressor: Compressor = (encoding, input) => encoding === 'br'
  ? brotli(input, { params: { [zlib.BROTLI_PARAM_QUALITY]: BROTLI_QUALITY, [zlib.BROTLI_PARAM_SIZE_HINT]: input.length } })
  : gzipped(input, { level: GZIP_LEVEL });
let compressor = zlibCompressor;
let compressions = 0;

/** For tests: replace the compressor (to make it fail or vary its output); no argument restores zlib */
export function setCompressorForTests(fn?: Compressor): void {
  compressor = fn ?? zlibCompressor;
}

/** For tests: how many bodies have been compressed so far (each body and encoding should be compressed once) */
export function compressionCount(): number {
  return compressions;
}

/** RFC 9110 qvalue: 0 to 1 with up to three decimals */
const QVALUE = /^(?:0(?:\.\d{0,3})?|1(?:\.0{0,3})?)$/;
/** On equal weights the smallest body wins */
const PREFERENCE: readonly Coding[] = ['br', 'gzip', 'identity'];

/**
 * Every content coding the client accepts for this response, best first, from an Accept-Encoding header and
 * the codings available (identity only, for one that isn't compressed); empty when every available coding is
 * refused, which is a 406.
 * - Names are case-insensitive and whitespace around them and their parameters is ignored.
 * - "q=" must be a valid qvalue (0–1, ≤ 3 decimals); an entry with any other q is ignored, not guessed at.
 *   q=0 refuses a coding.
 * - "*" covers every coding the header doesn't name.
 * - identity is acceptable unless refused by "identity;q=0" or by "*;q=0" without an identity entry; when the
 *   header doesn't mention it, it ranks below every coding the header asks for (a client listing only gzip
 *   wants gzip). An empty header therefore means identity only.
 * - No header at all: identity, as before (a client that says nothing may not decode anything).
 * - Equal weights: br, then gzip, then identity.
 */
export function acceptableCodings(header: string | string[] | undefined, available: readonly Coding[] = PREFERENCE): Coding[] {
  if (header === undefined) return available.includes('identity') ? ['identity'] : available.slice(0, 1);
  const weights = new Map<string, number>();
  for (const part of String(header).split(',')) {
    const [name, ...params] = part.split(';').map(p => p.trim().toLowerCase());
    if (!name || weights.has(name)) continue;
    const q = params.map(p => p.match(/^q\s*=\s*(.*)$/)).find(Boolean);
    if (q && !QVALUE.test(q[1])) continue;
    weights.set(name, q ? Number(q[1]) : 1);
  }
  const weight = (coding: Coding): number => {
    const named = weights.get(coding);
    if (named !== undefined) return named;
    if (weights.has('*')) return weights.get('*')!;
    return coding === 'identity' ? Number.MIN_VALUE : 0;
  };
  // Stable sort: equal weights keep PREFERENCE order
  return PREFERENCE.filter(c => available.includes(c) && weight(c) > 0).sort((a, b) => weight(b) - weight(a));
}

/** The best acceptable coding (see acceptableCodings), or null for a 406 */
export function pickEncoding(header: string | string[] | undefined, available: readonly Coding[] = PREFERENCE): Coding | null {
  return acceptableCodings(header, available)[0] ?? null;
}

/**
 * A body's compressed form, made once per body and encoding: cached bodies are per data snapshot (or per
 * file), so a new snapshot is compressed once and every later request reuses it (concurrent requests share
 * the one pending compression); the old snapshot's forms go with it (the WeakMap entry). A failed compression
 * is dropped from the cache, so the next request tries again.
 *
 * Each encoding is its own representation, and its strong ETag is the hash of the bytes actually sent (taken
 * once, with the compression): the same bytes always get the same ETag, and different bytes never share one,
 * even when only zlib or its settings changed. A validator from one representation can't match another.
 */
function encodedAs(cached: Cached, encoding: Encoding): Promise<Cached> {
  cached.encoded ??= new Map();
  let hit = cached.encoded.get(encoding);
  if (!hit) {
    compressions++;
    // Started inside then(): a compressor that throws synchronously still gives a rejected promise
    hit = Promise.resolve().then(() => compressor(encoding, Buffer.from(cached.body))).then(tag);
    cached.encoded.set(encoding, hit);
    hit.catch(() => cached.encoded?.delete(encoding));
  }
  return hit;
}

/** If-None-Match uses the weak comparison: "W/" doesn't matter, "*" matches any current representation */
function notModified(header: string | string[] | undefined, etag: string): boolean {
  const tags = String(header ?? '').split(',').map(t => t.trim().replace(/^W\//, ''));
  return tags.includes('*') || tags.includes(etag);
}

/**
 * Sends a cached body with its ETag, compressed when the type and size are worth it and the client accepts
 * br or gzip. Responses that could be compressed say Vary: Accept-Encoding, whichever encoding this one got,
 * so shared caches keep the representations apart.
 *
 * The client's acceptable codings are tried best first: if compressing fails, the next acceptable one is
 * used, and the body as it is only when identity is acceptable. 406 is only for a client that refuses every
 * coding available; acceptable codings that all failed to compress are our fault, a 500.
 *
 * A request whose If-None-Match names the chosen representation's ETag gets 304 and no body (browsers, the
 * service worker and feed readers revalidate so). The 304 carries what RFC 9110 §15.4.5 asks of it (ETag,
 * Cache-Control, Vary) and not Content-Encoding / Content-Length, which it says not to send: the cache
 * already has that representation's metadata, the ETag identifies which one.
 */
async function send(req: http.IncomingMessage, res: http.ServerResponse, headers: Record<string, string>, cached: Cached): Promise<void> {
  const negotiated = COMPRESSIBLE.test(headers['Content-Type'] ?? '') && Buffer.byteLength(cached.body) >= MIN_COMPRESS_BYTES;
  const available: readonly Coding[] = negotiated ? PREFERENCE : ['identity'];
  const vary: Record<string, string> = negotiated ? { Vary: 'Accept-Encoding' } : {};
  const codings = acceptableCodings(req.headers['accept-encoding'], available);
  if (!codings.length) {
    // Every coding this response could have (identity included) was refused
    reply(res, 406, { 'Content-Type': 'text/plain; charset=utf-8', Vary: 'Accept-Encoding' }, `Not acceptable: available content codings are ${available.join(', ')}\n`);
    return;
  }
  let chosen: { representation: Cached; encoding?: Encoding } | undefined;
  for (const coding of codings) {
    if (coding === 'identity') {
      chosen = { representation: cached };
      break;
    }
    try {
      chosen = { representation: await encodedAs(cached, coding), encoding: coding };
      break;
    } catch (err) {
      console.error(`[server] ${coding} compression failed (${(err as Error)?.name ?? 'error'}); trying the next acceptable coding`);
    }
  }
  if (!chosen) {
    reply(res, 500, { 'Content-Type': 'text/plain; charset=utf-8', ...vary }, 'Could not encode the response in an acceptable content coding\n');
    return;
  }
  const { representation, encoding } = chosen;
  const out = { ...headers, ...vary };
  res.setHeader('ETag', representation.etag);
  if (notModified(req.headers['if-none-match'], representation.etag)) {
    res.writeHead(304, Object.fromEntries(Object.entries(out).filter(([k]) => k === 'Cache-Control' || k === 'Vary')));
    res.end();
    return;
  }
  reply(res, 200, encoding ? { ...out, 'Content-Encoding': encoding } : out, representation.body);
}

/**
 * Every response states its length, so GET and HEAD send exactly the same status and headers (Node would
 * otherwise send GET bodies chunked) and HEAD just leaves the body out
 */
function reply(res: http.ServerResponse, status: number, headers: Record<string, string>, body: string | Buffer): void {
  res.writeHead(status, { ...headers, 'Content-Length': String(Buffer.byteLength(body)) });
  res.end(body);
}

/** Files that don't change while the server runs (public/, the legal documents), read once */
const fileCache = new Map<string, Promise<Cached>>();
function cachedFile(key: string, load: () => Promise<string | Buffer>): Promise<Cached> {
  let hit = fileCache.get(key);
  if (!hit) {
    hit = load().then(tag);
    fileCache.set(key, hit);
    hit.catch(() => fileCache.delete(key));
  }
  return hit;
}

/**
 * Everything derived from one data snapshot (page, API files, feed, calendar…), built once: the cache
 * hands out the same object until it refreshes, so a new snapshot simply misses here
 */
const derived = new WeakMap<AllVersions, Map<string, Cached>>();
function fromData(data: AllVersions, key: string, build: () => string): Cached {
  let forData = derived.get(data);
  if (!forData) derived.set(data, forData = new Map());
  let hit = forData.get(key);
  if (!hit) forData.set(key, hit = tag(build()));
  return hit;
}

/** The topic API files of a snapshot (path → JSON), built together */
const apiFiles = new WeakMap<AllVersions, Map<string, string>>();

/** The stylesheet and scripts, linked as <file>?v=<content hash> (asset-versions.ts) */
const ASSET_VERSIONS: Record<string, string> = { '/style.css': STYLE_VERSION, ...Object.fromEntries(SCRIPTS.map(name => [`/${name}`, SCRIPT_VERSIONS[name]])) };

/**
 * A versioned asset requested with its current version can be cached for good: the next deployment links a
 * new version, i.e. a new URL. Without a version, or with an old one (a page from before the deployment),
 * it must be revalidated, so an old copy in an HTTP cache never outlives the page that needs the new one.
 */
export function assetCacheControl(pathname: string, version: string | null): string {
  const current = ASSET_VERSIONS[pathname];
  if (current) return version === current ? 'public, max-age=31536000, immutable' : 'no-cache';
  // The service worker must be revalidated on every load so updates roll out
  return pathname === '/sw.js' ? 'no-cache' : 'public, max-age=86400';
}

/**
 * Files served as they are: the page scripts (from SCRIPTS, so a new one can't be left out; scriptPath says where
 * each lives) and, from public/, the worker, manifest and image
 */
const STATIC_FILES = new Set(['/manifest.webmanifest', '/sw.js', '/og-image.png', ...SCRIPTS.map(name => `/${name}`)]);

async function serveStatic(req: http.IncomingMessage, pathname: string, version: string | null, res: http.ServerResponse): Promise<boolean> {
  const allowed = STATIC_FILES.has(pathname) || /^\/icons\/[\w.-]+$/.test(pathname);
  if (!allowed) return false;
  try {
    const name = pathname.slice(1);
    const cached = await cachedFile(pathname, () => readFile(isScript(name) ? scriptPath(name) : path.join(PUBLIC_DIR, pathname)));
    await send(req, res, {
      'Content-Type': STATIC_TYPES[path.extname(pathname)] ?? 'application/octet-stream',
      'Cache-Control': assetCacheControl(pathname, version),
    }, cached);
  } catch {
    reply(res, 404, { 'Content-Type': 'application/json' }, JSON.stringify({ error: 'Not found' }));
  }
  return true;
}

/** The request handler, with the data source injectable for tests */
/**
 * /health: always 200 while the process serves requests (a container shouldn't be restarted because an
 * upstream site is down), with the data's state in the body: "starting" before the first fetch,
 * "degraded" when too many sources failed (the static build wouldn't publish such data), else "ok".
 */
export function healthBody(cached: { value: AllVersions; fetchedAt: number } | undefined, now = Date.now()) {
  if (!cached) return { status: 'starting' as const };
  const decision = publishDecision(cached.value.sources);
  return {
    status: decision.publish ? 'ok' as const : 'degraded' as const,
    sources: `${decision.healthy}/${decision.total}`,
    ...(decision.reason ? { reason: decision.reason } : {}),
    ...(decision.failed.length ? { failed: decision.failed } : {}),
    updatedAt: cached.value.cachedAt,
    ageMinutes: Math.round((now - cached.fetchedAt) / 60_000),
  };
}

/** Headers describing a representation that a failed route may have set; an error response must not carry them */
const REPRESENTATION_HEADERS = ['ETag', 'Content-Encoding', 'Content-Length', 'Content-Disposition', 'Vary'];

/**
 * The outermost error boundary: an async listener whose promise rejects would be an unhandled rejection
 * (which ends the process) and leave the client hanging. Anything a route throws ends here instead:
 * - headers not sent yet: a plain 500 with the security headers already set, and no detail of the error
 *   (messages can name files and paths), which goes to the server log only;
 * - headers already sent (the body was cut short): the response can't be fixed, so the connection is
 *   destroyed, which tells the client the response is incomplete, rather than writing a second response;
 * - response already complete: nothing to do.
 */
export function guardRequests(handle: (req: http.IncomingMessage, res: http.ServerResponse) => Promise<void>): http.RequestListener {
  return (req, res) => {
    handle(req, res).catch(err => {
      console.error(`[server] request failed: ${(err as Error)?.name ?? 'Error'}: ${(err as Error)?.message ?? err}`);
      try {
        if (res.writableEnded) return;
        if (res.headersSent) {
          res.destroy();
          return;
        }
        for (const name of REPRESENTATION_HEADERS) res.removeHeader(name);
        reply(res, 500, { 'Content-Type': 'application/json' }, JSON.stringify({ error: 'Internal server error' }));
      } catch {
        res.destroy();
      }
    });
  };
}

export function createHandler(
  getData: () => Promise<AllVersions> = fetchAllVersions,
  peek: () => { value: AllVersions; fetchedAt: number } | undefined = peekAllVersions,
): http.RequestListener {
  return guardRequests(async (req, res) => {
    // First, so every response (errors included) carries them
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) res.setHeader(name, value);
    let url: URL;
    try {
      url = new URL(req.url ?? '/', 'http://localhost');
    } catch {
      // A request target that isn't a URL at all (e.g. "http://[" in absolute form)
      reply(res, 400, { 'Content-Type': 'application/json' }, JSON.stringify({ error: 'Bad request' }));
      return;
    }
    const { pathname } = url;
    const version = url.searchParams.get('v');
    // HEAD is answered like GET (Node leaves the body out), so monitors and link checkers see the real status
    const isGet = req.method === 'GET' || req.method === 'HEAD';
    if (isGet && await serveStatic(req, pathname, version, res)) {
      return;
    }

    // The legal documents, as on the static site: /legal/, /legal/en/, /legal/sources/
    const legal = LEGAL_PAGES.find(p => `/${p.path.replace(/index\.html$/, '')}` === pathname);
    if (isGet && legal) {
      const page = await cachedFile(legal.path, async () => renderLegalPage(legal, await readFile(path.join(ROOT_DIR, legal.source), 'utf8')));
      await send(req, res, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=3600' }, page);
      return;
    }

    if (isGet && pathname === '/style.css') {
      await send(req, res, { 'Content-Type': 'text/css; charset=utf-8', 'Cache-Control': assetCacheControl(pathname, version) }, await cachedFile('/style.css', async () => PAGE_CSS));
      return;
    }

    if (isGet && pathname === '/health') {
      reply(res, 200, { 'Content-Type': 'application/json' }, JSON.stringify(healthBody(peek())));
      return;
    }

    // Topic endpoints (same files as the static site's api/ folder); readable from any origin
    if (isGet && /^\/api\/[\w-]+\.json$/.test(pathname)) {
      try {
        const data = await getData();
        const file = pathname.slice(1);
        // Built once per snapshot: every topic file at once, as the static build does
        let files = apiFiles.get(data);
        if (!files) apiFiles.set(data, files = buildApiFiles(data, SITE_URL));
        const body = files.get(file);
        res.setHeader('Access-Control-Allow-Origin', '*');
        if (!body) {
          reply(res, 404, { 'Content-Type': 'application/json' }, JSON.stringify({ error: 'Not found', index: '/api/index.json' }));
          return;
        }
        await send(req, res, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=300' }, fromData(data, file, () => body));
      } catch {
        reply(res, 500, { 'Content-Type': 'application/json' }, JSON.stringify({ error: 'Failed to fetch versions' }));
      }
      return;
    }

    if (isGet && (pathname === '/api' || pathname === '/api.json')) {
      try {
        const versions = await getData();
        await send(req, res, { 'Content-Type': 'application/json' }, fromData(versions, 'api.json', () => JSON.stringify(legacyApiJson(versions, SITE_URL))));
      } catch {
        reply(res, 500, { 'Content-Type': 'application/json' }, JSON.stringify({ error: 'Failed to fetch versions' }));
      }
      return;
    }

    if (isGet && pathname === '/calendar.ics') {
      try {
        const data = await getData();
        await send(req, res, {
          'Content-Type': 'text/calendar; charset=utf-8',
          'Content-Disposition': 'inline; filename="os-version-tracker.ics"',
          'Cache-Control': 'public, max-age=600',
        }, fromData(data, 'calendar.ics', () => buildCalendar(data.timeline, SITE_URL)));
      } catch {
        reply(res, 500, { 'Content-Type': 'application/json' }, JSON.stringify({ error: 'Failed to build calendar' }));
      }
      return;
    }

    if (isGet && pathname === '/notifications.json') {
      try {
        const data = await getData();
        await send(req, res, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' }, fromData(data, 'notifications.json', () => buildNotificationsJson(data.tracked, data.cachedAt)));
      } catch {
        reply(res, 500, { 'Content-Type': 'application/json' }, JSON.stringify({ error: 'Failed to build notifications' }));
      }
      return;
    }

    if (isGet && pathname === '/feed.xml') {
      try {
        const data = await getData();
        await send(req, res, { 'Content-Type': 'application/atom+xml; charset=utf-8', 'Cache-Control': 'public, max-age=600' }, fromData(data, 'feed.xml', () => buildAtomFeed(data.tracked, SITE_URL, data.cachedAt)));
      } catch {
        reply(res, 500, { 'Content-Type': 'application/json' }, JSON.stringify({ error: 'Failed to build feed' }));
      }
      return;
    }

    if (isGet && pathname === '/') {
      try {
        const data = await getData();
        await send(req, res, { 'Content-Type': 'text/html; charset=utf-8' }, fromData(data, 'index.html', () => renderHTML(data)));
      } catch {
        reply(res, 500, { 'Content-Type': 'text/html; charset=utf-8' }, '<h1>無法取得版本資料</h1>');
      }
      return;
    }

    reply(res, 404, { 'Content-Type': 'application/json' }, JSON.stringify({ error: 'Not found' }));
  });
}

// Listen only when run directly (tests import createHandler without starting a server)
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  http.createServer(createHandler()).listen(PORT, () => {
    console.log(`Server listening on http://localhost:${PORT}`);
  });
}
