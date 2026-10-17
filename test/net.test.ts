import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { activeRequests, fetchBytes, fetchJson, fetchText, fetchWithTimeout, MAX_RETRY_AFTER_MS, PER_ORIGIN_CONCURRENCY, queuedRequests, retryAfterMs, trackedOrigins, setRetryDelay, USER_AGENT } from '../src/net.ts';

const realFetch = globalThis.fetch;
beforeEach(() => setRetryDelay(1));
afterEach(() => { globalThis.fetch = realFetch; setRetryDelay(1_500); });

test('retries a GET once after 429 / 502–504 or a network error, then gives the answer as it is', async () => {
  const replies: Array<number | 'network'> = [503, 200, 429, 429, 'network', 200];
  let calls = 0;
  globalThis.fetch = (async () => {
    calls++;
    const r = replies.shift()!;
    if (r === 'network') throw new TypeError('fetch failed');
    return new Response('x', { status: r });
  }) as typeof fetch;
  assert.equal((await fetchWithTimeout('https://a.example/1')).status, 200, '503 then 200');
  assert.equal((await fetchWithTimeout('https://a.example/2')).status, 429, 'two 429s: the second is returned');
  assert.equal((await fetchWithTimeout('https://a.example/3')).status, 200, 'network error then 200');
  assert.equal(calls, 6);
});

test('never retries a POST or an ordinary error status, and always sends the project User-Agent', async () => {
  let calls = 0;
  const agents: string[] = [];
  globalThis.fetch = (async (_url: string, init: RequestInit) => {
    calls++;
    agents.push(new Headers(init.headers).get('User-Agent') ?? '');
    return new Response('x', { status: calls === 1 ? 503 : 404 });
  }) as typeof fetch;
  assert.equal((await fetchWithTimeout('https://b.example/', { method: 'POST' })).status, 503);
  assert.equal((await fetchWithTimeout('https://b.example/missing')).status, 404);
  assert.equal(calls, 2);
  assert.deepEqual(agents, [USER_AGENT, USER_AGENT]);
});

test('at most PER_ORIGIN_CONCURRENCY requests to one site run at once; other sites are not held up', async () => {
  const active = new Map<string, number>();
  const peak = new Map<string, number>();
  globalThis.fetch = (async (url: string) => {
    const host = new URL(url).host;
    active.set(host, (active.get(host) ?? 0) + 1);
    peak.set(host, Math.max(peak.get(host) ?? 0, active.get(host)!));
    await new Promise(r => setTimeout(r, 5));
    active.set(host, active.get(host)! - 1);
    return new Response('x');
  }) as typeof fetch;
  await Promise.all([
    ...Array.from({ length: 12 }, (_, i) => fetchText(`https://busy.example/${i}`)),
    ...Array.from({ length: 2 }, (_, i) => fetchText(`https://other.example/${i}`)),
  ]);
  assert.equal(peak.get('busy.example'), PER_ORIGIN_CONCURRENCY);
  assert.equal(peak.get('other.example'), 2);
});

test('a timeout fails with the URL named and frees its slot', async () => {
  globalThis.fetch = ((_url: string, init: RequestInit) => new Promise((_, reject) => {
    init.signal!.addEventListener('abort', () => reject(Object.assign(new Error('timeout'), { name: 'TimeoutError' })));
  })) as typeof fetch;
  await assert.rejects(fetchWithTimeout('https://slow.example/a?token=secret', {}, 20), /Timed out after 0\.02s: slow\.example\/a$/);
  globalThis.fetch = (async () => new Response('ok')) as typeof fetch;
  // The slots are free again: more than PER_ORIGIN_CONCURRENCY requests go through
  await Promise.all(Array.from({ length: PER_ORIGIN_CONCURRENCY + 2 }, () => fetchText('https://slow.example/b')));
});

/** A fake server whose response bodies stay open until the test finishes them */
function slowBodies() {
  const started: string[] = [];
  const finish: Array<(text?: string) => void> = [];
  const fail: Array<(err: Error) => void> = [];
  globalThis.fetch = (async (url: string) => {
    started.push(url);
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({ start(c) { controller = c; } });
    controller.enqueue(new TextEncoder().encode('part '));
    finish.push((text = 'end') => { controller.enqueue(new TextEncoder().encode(text)); controller.close(); });
    fail.push(err => controller.error(err));
    return new Response(body, { status: 200 }); // headers now, body later
  }) as typeof fetch;
  return { started, finish, fail };
}
const tick = () => new Promise(r => setTimeout(r, 5));

test('a slot is held until the body is read: with 4 bodies still downloading, the 5th request to the site waits', async () => {
  const server = slowBodies();
  const origin = 'https://slowbody.example';
  const responses = await Promise.all(Array.from({ length: PER_ORIGIN_CONCURRENCY }, (_, i) => fetchWithTimeout(`${origin}/${i}`)));
  const fifth = fetchWithTimeout(`${origin}/4`);
  await tick();
  assert.equal(server.started.length, PER_ORIGIN_CONCURRENCY, 'headers are back, bodies are not: the 5th has not started');
  assert.equal(activeRequests(origin), PER_ORIGIN_CONCURRENCY);

  // Another site is not held up meanwhile
  const other = fetchWithTimeout('https://elsewhere.example/a');
  await tick();
  assert.equal(server.started.at(-1), 'https://elsewhere.example/a');

  // Reading one body to the end frees its slot for the 5th
  const reading = responses[0].text();
  server.finish[0]();
  assert.equal(await reading, 'part end');
  await tick();
  assert.ok(server.started.includes(`${origin}/4`), 'the 5th starts once a body is done');

  // Cancelling a body and a failed body free their slots too
  await responses[1].body!.cancel();
  const failing = responses[2].text();
  server.fail[2](new Error('connection reset'));
  await assert.rejects(failing, /connection reset/);
  await tick();
  assert.equal(activeRequests(origin), 2, 'slots back: one read, one cancelled, one failed; the 4th and 5th still downloading');

  // Clean up the rest
  for (const i of [3, 4, 5]) server.finish[i]?.();
  await Promise.all([responses[3].text(), (await fifth).text(), (await other).text()]);
  assert.equal(activeRequests(origin), 0);
});

test('a body nobody reads gives its slot back when the timeout fires, so a slot is never held for good', async () => {
  slowBodies();
  const origin = 'https://unread.example';
  await Promise.all(Array.from({ length: PER_ORIGIN_CONCURRENCY }, (_, i) => fetchWithTimeout(`${origin}/${i}`, {}, 40)));
  assert.equal(activeRequests(origin), PER_ORIGIN_CONCURRENCY);
  await new Promise(r => setTimeout(r, 80));
  assert.equal(activeRequests(origin), 0, 'all four slots back after the 40 ms timeout');
});

test('responses without a body free the slot at once', async () => {
  globalThis.fetch = (async () => new Response(null, { status: 204 })) as typeof fetch;
  await Promise.all(Array.from({ length: PER_ORIGIN_CONCURRENCY + 3 }, () => fetchWithTimeout('https://nobody.example/x')));
  assert.equal(activeRequests('https://nobody.example'), 0);
});

test('fetchText / fetchJson / fetchBytes read the body (freeing the slot) and reject non-2xx without leaking it', async () => {
  globalThis.fetch = (async (url: string) => (url.includes('/missing') ? new Response('nope', { status: 404 }) : new Response('{"a":1}'))) as typeof fetch;
  assert.equal(await fetchText('https://helpers.example/t'), '{"a":1}');
  assert.deepEqual(await fetchJson('https://helpers.example/j'), { a: 1 });
  assert.equal((await fetchBytes('https://helpers.example/b')).length, 7);
  await assert.rejects(fetchText('https://helpers.example/missing?token=x'), /^Error: HTTP 404: helpers\.example\/missing$/);
  assert.equal(activeRequests('https://helpers.example'), 0);
});

test('Retry-After: delta-seconds, HTTP-date, past dates, invalid values and the cap', () => {
  const now = Date.parse('2026-10-17T10:00:00Z');
  assert.equal(retryAfterMs('3', now, 1500), 3000);
  assert.equal(retryAfterMs('0', now, 1500), 0);
  assert.equal(retryAfterMs('Sat, 17 Oct 2026 10:00:04 GMT', now, 1500), 4000);
  assert.equal(retryAfterMs('Sat, 17 Oct 2026 09:59:00 GMT', now, 1500), 0, 'a date already past: no extra wait');
  assert.equal(retryAfterMs('soon', now, 1500), 1500, 'unreadable: the default delay');
  assert.equal(retryAfterMs('-5', now, 1500), 1500);
  assert.equal(retryAfterMs(null, now, 1500), 1500);
  assert.equal(retryAfterMs('3600', now, 1500), MAX_RETRY_AFTER_MS);
  assert.equal(retryAfterMs('Sun, 18 Oct 2026 10:00:00 GMT', now, 1500), MAX_RETRY_AFTER_MS);
});

test('a 503 with an HTTP-date Retry-After waits that long before the one retry', async () => {
  const at: number[] = [];
  globalThis.fetch = (async () => {
    at.push(Date.now());
    return at.length === 1
      ? new Response('busy', { status: 503, headers: { 'Retry-After': new Date(Date.now() + 1200).toUTCString() } })
      : new Response('ok');
  }) as typeof fetch;
  assert.equal(await (await fetchWithTimeout('https://busy.example/x')).text(), 'ok');
  // HTTP-dates have whole-second precision, so the wait is between 0.2 and 1.2 s
  assert.ok(at[1] - at[0] >= 150, `waited ${at[1] - at[0]} ms`);
  assert.equal(activeRequests('https://busy.example'), 0);
});

// ---------- the caller's AbortSignal ----------

/** Like real fetch(): rejects with the signal's reason when it aborts before the headers arrive */
function hangingFetch(calls: string[] = []) {
  globalThis.fetch = ((url: string, init: RequestInit) => new Promise((_, reject) => {
    calls.push(url);
    init.signal!.addEventListener('abort', () => reject(init.signal!.reason));
  })) as typeof fetch;
  return calls;
}
const isAbortError = (err: unknown) => (err as Error).name === 'AbortError';

test('a caller signal aborted while waiting in line for a slot leaves the line with an AbortError and never starts', async () => {
  const server = slowBodies();
  const origin = 'https://queue.example';
  const busy = await Promise.all(Array.from({ length: PER_ORIGIN_CONCURRENCY }, (_, i) => fetchWithTimeout(`${origin}/${i}`)));
  const controller = new AbortController();
  const queued = fetchWithTimeout(`${origin}/queued`, { signal: controller.signal });
  await tick();
  assert.equal(queuedRequests(origin), 1);
  controller.abort();
  await assert.rejects(queued, isAbortError);
  assert.equal(queuedRequests(origin), 0, 'it left the line');
  assert.ok(!server.started.includes(`${origin}/queued`), 'and was never sent');
  // The slots it would have had are not lost: finishing the bodies frees all four
  server.finish.forEach(f => f());
  await Promise.all(busy.map(r => r.text()));
  assert.equal(activeRequests(origin), 0);
});

test('a caller signal aborted before the headers: AbortError (not a timeout), no retry, slot freed', async () => {
  const calls = hangingFetch();
  const controller = new AbortController();
  const pending = fetchText('https://hang.example/a', { signal: controller.signal });
  await tick();
  controller.abort();
  await assert.rejects(pending, isAbortError);
  assert.equal(calls.length, 1, 'cancelled requests are not retried');
  assert.equal(activeRequests('https://hang.example'), 0);
  // An already aborted signal fails at once without a request
  await assert.rejects(fetchWithTimeout('https://hang.example/b', { signal: AbortSignal.abort() }), isAbortError);
  assert.equal(calls.length, 1);
});

test('the caller\'s own abort reason is kept as it came, like fetch()', async () => {
  hangingFetch();
  const controller = new AbortController();
  const reason = new Error('user navigated away');
  const pending = fetchWithTimeout('https://hang.example/reason', { signal: controller.signal });
  await tick();
  controller.abort(reason);
  await assert.rejects(pending, err => err === reason);
});

test('timeout and caller cancellation fail differently: a timeout names the URL, a cancellation is an AbortError', async () => {
  hangingFetch();
  const timedOut = await fetchText('https://hang.example/t?token=x', {}, 20).catch(e => e as Error);
  assert.equal(timedOut.name, 'Error');
  assert.match(timedOut.message, /^Timed out after 0\.02s: hang\.example\/t$/);
  const controller = new AbortController();
  const pending = fetchText('https://hang.example/c', { signal: controller.signal }, 5_000).catch(e => e as Error);
  await tick();
  controller.abort();
  const cancelled = await pending;
  assert.equal(cancelled.name, 'AbortError');
  assert.doesNotMatch(cancelled.message, /Timed out/);
});

test('a caller signal aborted while the body downloads errors the body with AbortError and frees the slot', async () => {
  const server = slowBodies(); // its bodies ignore the signal, like a stalled connection
  const origin = 'https://midbody.example';
  const controller = new AbortController();
  const res = await fetchWithTimeout(`${origin}/raw`, { signal: controller.signal });
  const reading = res.text();
  await tick();
  controller.abort();
  await assert.rejects(reading, isAbortError);
  assert.equal(activeRequests(origin), 0);

  // The body helpers: same, and the cancellation is not retried
  const second = new AbortController();
  const text = fetchText(`${origin}/helper`, { signal: second.signal });
  await tick();
  second.abort();
  await assert.rejects(text, isAbortError);
  assert.equal(server.started.filter(u => u.endsWith('/helper')).length, 1);
  assert.equal(activeRequests(origin), 0);
});

test('a caller signal aborted during the wait before a retry stops at once, without the retry', async () => {
  setRetryDelay(10_000);
  let calls = 0;
  globalThis.fetch = (async () => { calls++; return new Response('busy', { status: 503 }); }) as typeof fetch;
  const controller = new AbortController();
  const started = Date.now();
  const pending = fetchText('https://backoff.example/x', { signal: controller.signal });
  await tick();
  controller.abort();
  await assert.rejects(pending, isAbortError);
  assert.ok(Date.now() - started < 1_000, 'did not sit out the 10 s delay');
  assert.equal(calls, 1);
  assert.equal(activeRequests('https://backoff.example'), 0);
});

test('after cancellations and timeouts every slot comes back: more than the limit go through afterwards', async () => {
  const origin = 'https://recover.example';
  hangingFetch();
  const controllers = Array.from({ length: PER_ORIGIN_CONCURRENCY + 2 }, () => new AbortController());
  const pending = controllers.map((c, i) => fetchText(`${origin}/${i}`, { signal: c.signal }, i % 2 ? 30 : 5_000).catch(e => e as Error));
  await tick();
  controllers.forEach(c => c.abort());
  await Promise.all(pending);
  assert.equal(activeRequests(origin), 0);
  assert.equal(queuedRequests(origin), 0);
  globalThis.fetch = (async () => new Response('ok')) as typeof fetch;
  assert.deepEqual(await Promise.all(Array.from({ length: PER_ORIGIN_CONCURRENCY * 2 }, (_, i) => fetchText(`${origin}/ok${i}`))), Array(PER_ORIGIN_CONCURRENCY * 2).fill('ok'));
});

test('a freed slot goes to the request already waiting, not to a newcomer: the limit holds during hand-over', async () => {
  const server = slowBodies();
  const origin = 'https://handover.example';
  const busy = await Promise.all(Array.from({ length: PER_ORIGIN_CONCURRENCY }, (_, i) => fetchWithTimeout(`${origin}/${i}`)));
  const waiting = fetchWithTimeout(`${origin}/waiting`);
  await tick();
  // A newcomer arriving in the same moment the slot is freed must wait its turn
  void busy[0].body!.cancel();
  const newcomer = fetchWithTimeout(`${origin}/newcomer`);
  await tick();
  assert.equal(activeRequests(origin), PER_ORIGIN_CONCURRENCY);
  assert.ok(server.started.includes(`${origin}/waiting`));
  assert.ok(!server.started.includes(`${origin}/newcomer`));
  server.finish.slice(1).forEach(f => f());
  await Promise.all([...busy.slice(1).map(r => r.text()), (await waiting).text()]);
  await tick();
  server.finish.at(-1)!();
  await (await newcomer).text();
  assert.equal(activeRequests(origin), 0);
});

// ---------- retrying a body that fails halfway ----------

const enc = (text: string) => new TextEncoder().encode(text);
/** A 200 whose connection drops after the first chunk (undici reports that as TypeError "terminated") */
const dropping = () => new Response(new ReadableStream<Uint8Array>({
  start(c) { c.enqueue(enc('{"partial":')); },
  pull(c) { c.error(new TypeError('terminated')); },
}));

test('fetchText / fetchJson retry once when the connection drops mid-body, and the retry gets the whole body', async () => {
  let calls = 0;
  globalThis.fetch = (async () => (++calls % 2 ? dropping() : new Response('{"whole":true}'))) as typeof fetch;
  assert.equal(await fetchText('https://flaky.example/t'), '{"whole":true}');
  assert.deepEqual(await fetchJson('https://flaky.example/j'), { whole: true });
  assert.equal((await fetchBytes('https://flaky.example/b')).length, 14);
  assert.equal(calls, 6);
  assert.equal(activeRequests('https://flaky.example'), 0, 'the dropped attempts gave their slots back');
});

test('a body that fails on both attempts rejects with the last error, naming the URL without its query', async () => {
  let calls = 0;
  globalThis.fetch = (async () => { calls++; return dropping(); }) as typeof fetch;
  await assert.rejects(fetchText('https://flaky.example/always?token=secret'), /^Error: terminated \(flaky\.example\/always\)$/);
  assert.equal(calls, 2);
  assert.equal(activeRequests('https://flaky.example'), 0);
});

test('malformed JSON is a parse error at once, never retried as if the connection had dropped', async () => {
  let calls = 0;
  globalThis.fetch = (async () => { calls++; return new Response('{"not json'); }) as typeof fetch;
  await assert.rejects(fetchJson('https://badjson.example/x'), SyntaxError);
  assert.equal(calls, 1);
  assert.equal(activeRequests('https://badjson.example'), 0);
});

test('body failures are not retried for a POST, for a raw fetchWithTimeout() response, or after a timeout', async () => {
  let calls = 0;
  globalThis.fetch = (async () => { calls++; return dropping(); }) as typeof fetch;
  await assert.rejects(fetchText('https://noretry.example/post', { method: 'POST', body: 'x' }), /terminated/);
  assert.equal(calls, 1, 'POST: once');
  // The raw response: the caller has its body, which is never re-fetched behind its back
  const res = await fetchWithTimeout('https://noretry.example/raw');
  await assert.rejects(res.text(), /terminated/);
  assert.equal(calls, 2, 'raw: once');

  // A body still downloading when the timeout fires: one attempt, a timeout error
  const server = slowBodies();
  await assert.rejects(fetchText('https://noretry.example/slow', {}, 30), /^Error: Timed out after 0\.03s: noretry\.example\/slow$/);
  assert.equal(server.started.length, 1, 'timeouts are final, so a source never waits two full timeouts');
  assert.equal(activeRequests('https://noretry.example'), 0);
});

test('a custom HTTP error format gets the status and host/path, never the query string', async () => {
  globalThis.fetch = (async () => new Response('gone', { status: 410 })) as typeof fetch;
  const seen: string[] = [];
  await assert.rejects(fetchJson('https://fmt.example/lookup?id=1&token=secret', {}, 1_000, (status, where) => { seen.push(where); return `${where} failed: ${status}`; }), /^Error: fmt\.example\/lookup failed: 410$/);
  assert.deepEqual(seen, ['fmt.example/lookup']);
  assert.equal(activeRequests('https://fmt.example'), 0);
});

// ---------- which signal fired decides the error ----------

test('an AbortError neither signal caused is a network error: retried, and never reported as a timeout', async () => {
  let calls = 0;
  globalThis.fetch = (async () => {
    calls++;
    if (calls === 1) throw new DOMException('The connection was aborted', 'AbortError');
    return new Response('ok');
  }) as typeof fetch;
  assert.equal(await fetchText('https://extabort.example/a'), 'ok', 'the retry works');
  assert.equal(calls, 2);

  globalThis.fetch = (async () => { throw new DOMException('The connection was aborted', 'AbortError'); }) as typeof fetch;
  const err = await fetchText('https://extabort.example/b?token=x').catch(e => e as Error);
  assert.equal(err.name, 'Error');
  assert.equal(err.message, 'The connection was aborted (extabort.example/b)');
  assert.doesNotMatch(err.message, /Timed out/);
  assert.equal((err.cause as Error).name, 'AbortError', 'the original error stays as the cause');

  // The same for a body that a proxy aborts halfway
  let bodyCalls = 0;
  globalThis.fetch = (async () => {
    bodyCalls++;
    return bodyCalls === 1
      ? new Response(new ReadableStream({ pull(c) { c.error(new DOMException('aborted', 'AbortError')); } }))
      : new Response('whole');
  }) as typeof fetch;
  assert.equal(await fetchText('https://extabort.example/c'), 'whole');
  assert.equal(activeRequests('https://extabort.example'), 0);
});

test('a stray TimeoutError from elsewhere (not our timeout) is a network error too', async () => {
  globalThis.fetch = (async () => { throw new DOMException('headers timeout', 'TimeoutError'); }) as typeof fetch;
  const err = await fetchText('https://exttimeout.example/a', {}, 5_000).catch(e => e as Error);
  assert.equal(err.message, 'headers timeout (exttimeout.example/a)');
});

test('caller abort and our own timeout keep their meaning whatever error the fetch rejects with', async () => {
  // A fetch that rejects with a generic error when aborted (not the signal's reason)
  globalThis.fetch = ((_url: string, init: RequestInit) => new Promise((_, reject) => {
    init.signal!.addEventListener('abort', () => reject(new TypeError('fetch failed')));
  })) as typeof fetch;
  await assert.rejects(fetchText('https://meaning.example/t', {}, 20), /^Error: Timed out after 0\.02s: meaning\.example\/t$/);
  const controller = new AbortController();
  const pending = fetchText('https://meaning.example/c', { signal: controller.signal }, 5_000);
  await tick();
  controller.abort();
  await assert.rejects(pending, isAbortError);
  assert.equal(activeRequests('https://meaning.example'), 0);
});

// ---------- the response handed back ----------

test('the returned response keeps status, statusText, headers, url, redirected and type, on clones too', async () => {
  globalThis.fetch = (async () => {
    const res = new Response('{"a":1}', { status: 203, statusText: 'Non-Authoritative', headers: { 'Content-Type': 'application/json', 'X-Trace': 't1' } });
    // What a real fetch() sets after a redirect (a constructed Response can't)
    Object.defineProperties(res, { url: { value: 'https://meta.example/final' }, redirected: { value: true }, type: { value: 'basic' } });
    return res;
  }) as typeof fetch;
  const res = await fetchWithTimeout('https://meta.example/start');
  const copy = res.clone();
  for (const r of [res, copy]) {
    assert.equal(r.status, 203);
    assert.equal(r.statusText, 'Non-Authoritative');
    assert.equal(r.ok, true);
    assert.equal(r.headers.get('content-type'), 'application/json');
    assert.equal(r.headers.get('x-trace'), 't1');
    assert.equal(r.url, 'https://meta.example/final');
    assert.equal(r.redirected, true);
    assert.equal(r.type, 'basic');
    assert.ok(r instanceof Response);
  }
  assert.equal(activeRequests('https://meta.example'), 1, 'held until the body is done');
  assert.deepEqual(await copy.json(), { a: 1 });
  assert.equal(await res.text(), '{"a":1}');
  assert.equal(res.bodyUsed, true);
  assert.equal(activeRequests('https://meta.example'), 0, 'freed once the body was read');
});

test('a clone and its original cancelled both free the slot; a body-less response is returned untouched', async () => {
  globalThis.fetch = (async () => new Response('x')) as typeof fetch;
  const res = await fetchWithTimeout('https://clonecancel.example/a');
  const copy = res.clone();
  // A tee's cancel() settles once both branches are cancelled (Streams spec), so cancel them together
  await Promise.all([copy.body!.cancel(), res.body!.cancel()]);
  assert.equal(activeRequests('https://clonecancel.example'), 0);

  const empty = new Response(null, { status: 204 });
  globalThis.fetch = (async () => empty) as typeof fetch;
  assert.equal(await fetchWithTimeout('https://clonecancel.example/b'), empty);
});

// ---------- idle origins are forgotten ----------

test('origins are dropped from the limiter once idle, whatever ended their requests', async () => {
  const before = trackedOrigins();
  let n = 0;
  globalThis.fetch = (async (url: string) => {
    const path = new URL(url).pathname;
    if (path === '/drop') return new Response(new ReadableStream({ pull(c) { c.error(new TypeError('terminated')); } }));
    return new Response(`body ${n++}`);
  }) as typeof fetch;
  // Normal completion, a non-2xx status, a body failure and a cancelled body, on 200 different origins
  await Promise.all(Array.from({ length: 50 }, (_, i) => fetchText(`https://ok${i}.idle.example/x`)));
  await Promise.all(Array.from({ length: 50 }, (_, i) => fetchText(`https://drop${i}.idle.example/drop`).catch(() => {})));
  await Promise.all(Array.from({ length: 50 }, async (_, i) => (await fetchWithTimeout(`https://cancel${i}.idle.example/x`)).body!.cancel()));
  globalThis.fetch = (async () => new Response('gone', { status: 404 })) as typeof fetch;
  await Promise.all(Array.from({ length: 50 }, (_, i) => fetchText(`https://missing${i}.idle.example/x`).catch(() => {})));
  assert.equal(trackedOrigins(), before, 'none of the 200 origins is kept');
});

test('timeouts and aborts (in line or in flight) leave no origin behind; a busy origin is kept until idle', async () => {
  const before = trackedOrigins();
  hangingFetch();
  const origin = 'https://busyidle.example';
  const controllers = Array.from({ length: PER_ORIGIN_CONCURRENCY + 2 }, () => new AbortController());
  const pending = controllers.map((c, i) => fetchText(`${origin}/${i}`, { signal: c.signal }, 5_000).catch(e => e as Error));
  await tick();
  assert.equal(queuedRequests(origin), 2);
  // Leaving the line while others hold slots must not drop the entry
  controllers[PER_ORIGIN_CONCURRENCY].abort();
  await tick();
  assert.equal(trackedOrigins(), before + 1, 'still in use');
  assert.equal(activeRequests(origin), PER_ORIGIN_CONCURRENCY);
  // A hand-over keeps it too: one in flight aborts, the last in line takes its slot
  controllers[0].abort();
  await tick();
  assert.equal(activeRequests(origin), PER_ORIGIN_CONCURRENCY);
  assert.equal(queuedRequests(origin), 0);
  controllers.forEach(c => c.abort());
  await Promise.all(pending);
  await assert.rejects(fetchText('https://timeoutidle.example/t', {}, 20), /Timed out/);
  assert.equal(trackedOrigins(), before, 'all idle again: forgotten');
  // And reusable: a new request to the same origin works
  globalThis.fetch = (async () => new Response('again')) as typeof fetch;
  assert.equal(await fetchText(`${origin}/again`), 'again');
  assert.equal(trackedOrigins(), before);
});
