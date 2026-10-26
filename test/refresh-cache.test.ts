import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRefreshCache } from '../src/refresh-cache.ts';

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: Error) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

test('concurrent callers share one refresh', async () => {
  let calls = 0;
  const pending = deferred<number>();
  const cache = createRefreshCache(() => { calls++; return pending.promise; }, 1000);
  const all = Promise.all([cache.get(), cache.get(), cache.get()]);
  pending.resolve(42);
  assert.deepEqual(await all, [42, 42, 42]);
  assert.equal(calls, 1);
});

test('results are reused within the TTL; after it the old one answers at once while a refresh runs behind it', async () => {
  let clock = 0;
  let calls = 0;
  const cache = createRefreshCache(async () => ++calls, 1000, () => clock);
  assert.equal(await cache.get(), 1);
  clock = 999;
  assert.equal(await cache.get(), 1);
  clock = 1000;
  assert.equal(await cache.get(), 1, 'no reader waits for the refresh');
  await new Promise(r => setImmediate(r));
  assert.equal(calls, 2);
  assert.equal(await cache.get(), 2, 'the refreshed result from then on');
});

test('a refresh that fails after a success keeps serving the last good result', async t => {
  t.mock.method(console, 'warn', () => {});
  let clock = 0;
  let fail = false;
  const cache = createRefreshCache(async () => { if (fail) throw new Error('upstream down'); return 'good'; }, 1000, () => clock);
  assert.equal(await cache.get(), 'good');
  fail = true;
  clock = 5000;
  assert.equal(await cache.get(), 'good');
  await new Promise(r => setImmediate(r));
  assert.equal(await cache.get(), 'good', 'still there after the failure');
  assert.equal(cache.peek()?.fetchedAt, 0, 'and still dated when it was fetched');
});

test('a failed refresh is shared by its waiters but does not poison later calls', async () => {
  let calls = 0;
  const first = deferred<number>();
  const cache = createRefreshCache(() => (++calls === 1 ? first.promise : Promise.resolve(7)), 1000);
  const a = cache.get();
  const b = cache.get();
  first.reject(new Error('upstream down'));
  await assert.rejects(a, /upstream down/);
  await assert.rejects(b, /upstream down/);
  assert.equal(calls, 1, 'waiters shared the failing refresh');
  assert.equal(await cache.get(), 7, 'the next call starts a fresh refresh');
  assert.equal(calls, 2);
});
