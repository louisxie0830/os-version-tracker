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

test('results are reused within the TTL and refreshed after it', async () => {
  let clock = 0;
  let calls = 0;
  const cache = createRefreshCache(async () => ++calls, 1000, () => clock);
  assert.equal(await cache.get(), 1);
  clock = 999;
  assert.equal(await cache.get(), 1);
  clock = 1000;
  assert.equal(await cache.get(), 2);
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
