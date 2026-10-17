/**
 * Shared network limits. Every outbound request is bounded so one slow upstream can't stall a refresh;
 * the values are generous because several official sites (large Apple / Android pages) are slow.
 */
export const NETWORK_TIMEOUT_MS = 15_000;
/** Large documentation pages and CSV exports */
export const SLOW_NETWORK_TIMEOUT_MS = 20_000;
/** Outgoing webhooks must never hold up a refresh */
export const WEBHOOK_TIMEOUT_MS = 5_000;

/**
 * Every upstream request says it's this project's automated client (never a spoofed browser), so source
 * operators can tell it apart from people and apply robots.txt; it carries no personal account or contact
 * details (no maintainer's GitHub link)
 */
export const USER_AGENT = 'Mozilla/5.0 (compatible; os-version-tracker)';

/** A URL as errors and logs may show it: host and path only (query strings can carry tokens) */
export function describe(url: string | URL): string {
  try {
    const u = new URL(String(url));
    return `${u.host}${u.pathname}`;
  } catch {
    return '(invalid URL)';
  }
}

/** At most this many requests to one site at a time: a refresh starts ~25 sources at once */
export const PER_ORIGIN_CONCURRENCY = 4;
/** Responses worth one more try: rate limiting and temporary server or gateway errors */
const RETRY_STATUS = new Set([429, 502, 503, 504]);
let retryDelayMs = 1_500;
export const MAX_RETRY_AFTER_MS = 10_000;

/** For tests: shorten the wait before a retry */
export function setRetryDelay(ms: number): void {
  retryDelayMs = ms;
}

const slots = new Map<string, { active: number; waiting: Array<() => void> }>();

/** For tests: how many requests to an origin hold a slot right now (and how many are queued) */
export function activeRequests(origin: string): number {
  return slots.get(origin)?.active ?? 0;
}
export function queuedRequests(origin: string): number {
  return slots.get(origin)?.waiting.length ?? 0;
}
/** For tests: how many origins the limiter still tracks (idle ones are dropped) */
export function trackedOrigins(): number {
  return slots.size;
}

/** Forgets an origin nobody is using or waiting for, so a long-running server doesn't keep every host it ever met */
function dropIfIdle(origin: string, slot: { active: number; waiting: unknown[] }): void {
  if (slot.active === 0 && slot.waiting.length === 0 && slots.get(origin) === slot) slots.delete(origin);
}

/**
 * Takes one of the origin's slots, waiting in line when all are busy. A freed slot is handed straight to the
 * next in line (it never goes back to the pool in between, where a newcomer could take it too and exceed the
 * limit). Leaving the line because the caller's signal aborted rejects with the signal's reason.
 */
async function acquire(origin: string, signal?: AbortSignal | null): Promise<() => void> {
  const slot = slots.get(origin) ?? { active: 0, waiting: [] };
  slots.set(origin, slot);
  if (slot.active < PER_ORIGIN_CONCURRENCY) slot.active++;
  else {
    await new Promise<void>((resolve, reject) => {
      const take = () => {
        signal?.removeEventListener('abort', leave);
        resolve();
      };
      const leave = () => {
        slot.waiting.splice(slot.waiting.indexOf(take), 1);
        dropIfIdle(origin, slot);
        reject(signal!.reason);
      };
      slot.waiting.push(take);
      signal?.addEventListener('abort', leave, { once: true });
    });
  }
  let released = false;
  // Safe to call more than once: whichever of "body done", "body failed", "cancelled" or "aborted" comes
  // first frees the slot, the others are no-ops
  return () => {
    if (released) return;
    released = true;
    const next = slot.waiting.shift();
    // Handed over: the slot stays taken (and the entry kept) for the next in line
    if (next) next();
    else {
      slot.active--;
      dropIfIdle(origin, slot);
    }
  };
}

/** Waits `ms`, or rejects with the signal's reason as soon as the caller aborts */
function wait(ms: number, signal?: AbortSignal | null): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const done = () => {
      signal?.removeEventListener('abort', abort);
      resolve();
    };
    const timer = setTimeout(done, ms);
    const abort = () => {
      clearTimeout(timer);
      reject(signal!.reason);
    };
    signal?.addEventListener('abort', abort, { once: true });
  });
}

/**
 * How long a Retry-After header asks us to wait: delta-seconds ("120") or an HTTP-date. A date already past
 * (or "0") means no extra wait; anything unreadable falls back to the default delay; always capped at
 * MAX_RETRY_AFTER_MS so a server can't stall a refresh.
 */
export function retryAfterMs(header: string | null, now = Date.now(), fallback = retryDelayMs): number {
  const value = header?.trim();
  if (!value) return fallback;
  let ms: number;
  if (/^\d+$/.test(value)) ms = Number(value) * 1000;
  else {
    // An HTTP-date ("Sat, 17 Oct 2026 10:00:04 GMT") names a month and a time; Date.parse alone would take "-5"
    const date = /[A-Za-z]{3}/.test(value) && /\d{1,2}:\d{2}/.test(value) ? Date.parse(value) : NaN;
    if (Number.isNaN(date)) return fallback;
    ms = Math.max(0, date - now);
  }
  return Math.min(ms, MAX_RETRY_AFTER_MS);
}

/**
 * Hands the response on with a body that keeps the origin's slot until the body is finished: read to the end
 * (text(), json(), arrayBuffer()…), failed, cancelled, or aborted (the timeout or the caller's signal),
 * whichever comes first. A body nobody reads is released when the timeout fires, so a slot is never held for
 * good. An abort also errors the body with the signal's reason (AbortError for the caller, TimeoutError for
 * the timeout), whatever the underlying stream does. Responses without a body (204, 304, HEAD) release at once
 * and are returned as they are.
 *
 * A Response's body can't be swapped, so this is a new Response: status, statusText and headers are passed to
 * the constructor; url, redirected and type (which the constructor always sets to "", false and "default")
 * are copied as own properties, and clone() is wrapped to copy them onto the clone too. Both are plain,
 * standard JavaScript on the public API. A clone shares the body through a tee: the slot is freed once the
 * source has been read to the end (by either branch) or both branches are cancelled.
 */
function holdUntilBodyDone(res: Response, release: () => void, signal: AbortSignal): Response {
  if (!res.body) {
    release();
    return res;
  }
  const reader = res.body.getReader();
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const finish = () => {
    signal.removeEventListener('abort', abort);
    release();
  };
  const abort = () => {
    finish();
    try { controller.error(signal.reason); } catch { /* already closed */ }
    reader.cancel(signal.reason).catch(() => {});
  };
  signal.addEventListener('abort', abort, { once: true });
  const body = new ReadableStream<Uint8Array>({
    start(c) { controller = c; },
    async pull(c) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          finish();
          c.close();
        } else {
          c.enqueue(value);
        }
      } catch (err) {
        finish();
        try { c.error(signal.aborted ? signal.reason : err); } catch { /* already errored by abort() */ }
      }
    },
    async cancel(reason) {
      finish();
      await reader.cancel(reason).catch(() => {});
    },
  });
  return withMetadata(new Response(body, { status: res.status, statusText: res.statusText, headers: res.headers }), res);
}

/** Gives `held` the metadata the Response constructor can't set (see holdUntilBodyDone), clones included */
function withMetadata(held: Response, from: Pick<Response, 'url' | 'redirected' | 'type'>): Response {
  const { url, redirected, type } = from;
  Object.defineProperties(held, {
    url: { value: url },
    redirected: { value: redirected },
    type: { value: type },
    clone: { value: () => withMetadata(Response.prototype.clone.call(held), { url, redirected, type }) },
  });
  return held;
}

/** Formats a non-2xx status for the error message (source-health alerts show it); `where` is host + path */
export type HttpErrorFormat = (status: number, where: string) => string;

/**
 * What a failed attempt means, decided by which signal fired rather than by the error's name: the caller's
 * own abort is rethrown as it came (its signal's reason, an AbortError by default, as fetch() does); our
 * timeout becomes "Timed out after Ns: host/path" and is final. Anything else is a network error worth the
 * one retry, including an AbortError or TimeoutError neither signal caused (e.g. the connection aborted by
 * the runtime or a proxy): calling that a timeout would misreport it and skip a retry that may well work.
 */
function failure(err: unknown, url: string | URL, timeoutMs: number, caller: AbortSignal | null | undefined, timeout: AbortSignal): Error {
  if (caller?.aborted) throw caller.reason;
  if (timeout.aborted) throw new Error(`Timed out after ${timeoutMs / 1000}s: ${describe(url)}`, { cause: err });
  const e = err as Error;
  return new Error(`${e?.message ?? err} (${describe(url)})`, { cause: err });
}

/**
 * One request, with at most `retries` more attempts for a GET. Without `read`, the response is returned as
 * soon as its headers arrive (its body still to be read, holding the slot); with `read`, the response must be
 * 2xx and `read` consumes the whole body inside the attempt, so a connection dropped halfway through the body
 * is retried like one dropped before the headers. Nothing has reached the caller at that point, which is what
 * makes the retry safe.
 *
 * Timeouts are not retried: the timeout covers each attempt's response and body, so a source's worst case is
 * one attempt failing fast plus a wait (≤ MAX_RETRY_AFTER_MS) plus one full timeout, never two timeouts.
 */
async function request<T>(
  url: string | URL,
  init: RequestInit,
  timeoutMs: number,
  retries: number,
  read?: { body: (res: Response) => Promise<T>; error?: HttpErrorFormat },
): Promise<T | Response> {
  const headers = new Headers(init.headers);
  if (!headers.has('User-Agent')) headers.set('User-Agent', USER_AGENT);
  const caller = init.signal;
  const origin = new URL(String(url)).origin;
  let left = (init.method ?? 'GET').toUpperCase() === 'GET' ? retries : 0;
  for (;;) {
    caller?.throwIfAborted();
    const release = await acquire(origin, caller);
    const timeout = AbortSignal.timeout(timeoutMs);
    const signal = caller ? AbortSignal.any([caller, timeout]) : timeout;
    let res: Response;
    try {
      res = await fetch(url, { ...init, headers, signal });
    } catch (err) {
      release();
      const error = failure(err, url, timeoutMs, caller, timeout);
      if (left-- <= 0) throw error;
      await wait(retryDelayMs, caller);
      continue;
    }
    if (left > 0 && RETRY_STATUS.has(res.status)) {
      left--;
      const delay = retryAfterMs(res.headers.get('retry-after'));
      // Drop this attempt's body (and its slot) before waiting; the retry takes a new slot
      await res.body?.cancel().catch(() => {});
      release();
      await wait(delay, caller);
      continue;
    }
    const held = holdUntilBodyDone(res, release, signal);
    if (!read) return held;
    if (!held.ok) {
      // Cancelling frees the slot now rather than when the timeout fires
      await held.body?.cancel().catch(() => {});
      throw new Error(read.error ? read.error(held.status, describe(url)) : `HTTP ${held.status}: ${describe(url)}`);
    }
    try {
      return await read.body(held);
    } catch (err) {
      // The failed body has already given its slot back; cancelling again is a no-op
      await held.body?.cancel().catch(() => {});
      const error = failure(err, url, timeoutMs, caller, timeout);
      if (left-- <= 0) throw error;
      await wait(retryDelayMs, caller);
    }
  }
}

/**
 * The raw Fetch-style call: the project's User-Agent; a timeout covering both the response and reading its
 * body, combined with the caller's own `init.signal` (which also cancels waiting for a slot or a retry);
 * at most PER_ORIGIN_CONCURRENCY requests per site at once, each holding its slot until its body is done
 * (see holdUntilBodyDone); and for GETs one retry after a network error, 429 or 502–504, waiting as
 * Retry-After asks (up to 10 s). The body it returns is never retried behind the caller's back: a failure
 * while reading it is the caller's to handle. Errors name the URL without its query string.
 * Most callers want fetchText / fetchJson / fetchBytes, which check the status and retry body failures too.
 */
export function fetchWithTimeout(url: string | URL, init: RequestInit = {}, timeoutMs = NETWORK_TIMEOUT_MS, retries = 1): Promise<Response> {
  return request(url, init, timeoutMs, retries) as Promise<Response>;
}

/**
 * A 2xx response's body, read inside the request (see request()): a non-2xx status is rejected with
 * `error(status, host/path)` (default "HTTP 404: host/path"), a connection dropped mid-body is retried once
 */
function readBody<T>(body: (res: Response) => Promise<T>) {
  return (url: string | URL, init: RequestInit = {}, timeoutMs = NETWORK_TIMEOUT_MS, error?: HttpErrorFormat): Promise<T> =>
    request(url, init, timeoutMs, 1, { body, error }) as Promise<T>;
}

/** GET a successful response's text (the body read, and the slot freed, before it returns) */
export const fetchText = readBody(res => res.text());

/** GET a successful response's bytes */
export const fetchBytes = readBody(async res => new Uint8Array(await res.arrayBuffer()));

/**
 * GET a successful response's JSON. Only the download is retried: the body is read as text first, so
 * malformed JSON is a parse error (SyntaxError) right away, never mistaken for a dropped connection. (A
 * truncated body shows up as a download error, since fetch checks the length the server announced.)
 */
export async function fetchJson<T>(url: string | URL, init: RequestInit = {}, timeoutMs = NETWORK_TIMEOUT_MS, error?: HttpErrorFormat): Promise<T> {
  return JSON.parse(await fetchText(url, init, timeoutMs, error)) as T;
}
