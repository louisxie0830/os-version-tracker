import { test } from 'node:test';
import assert from 'node:assert/strict';
import { settleSources } from '../src/fetchers/settle.ts';
import { fetchAndroidToolchain } from '../src/fetchers/android-toolchain.ts';
import { fetchiOSToolchain } from '../src/fetchers/ios-toolchain.ts';
import { fetchCrashReport, type CrashItem } from '../src/fetchers/crashes.ts';
import { publishDecision } from '../src/publish-health.ts';
import type { XcodeRelease } from '../src/types.ts';

const fail = (msg: string) => () => Promise.reject(new Error(msg));
const quiet = <T>(fn: () => Promise<T>) => {
  const warn = console.warn;
  console.warn = () => {};
  return fn().finally(() => { console.warn = warn; });
};

test('settleSources keeps partial results and throws with every reason when all fail', async () => {
  const partial = await quiet(() => settleSources('x', [['a', fail('boom')], ['b', () => Promise.resolve(1)]]));
  assert.deepEqual([...partial.values], [['b', 1]]);
  assert.equal(partial.failures[0].name, 'a');

  await assert.rejects(quiet(() => settleSources('x', [['a', fail('timeout')], ['b', fail('HTTP 503')]])), /every upstream failed.*a: timeout.*b: HTTP 503/);
  // "Succeeded" with unusable data counts as a failure
  await assert.rejects(quiet(() => settleSources('x', [['a', () => Promise.resolve([])]], v => v.length > 0)), /returned no usable data/);
});

test('Android toolchain: all upstreams failing or empty is a failure, one result is enough', async () => {
  await assert.rejects(quiet(() => fetchAndroidToolchain([['AGP', fail('down')], ['Gradle', fail('down')]])), /Android toolchain/);
  await assert.rejects(quiet(() => fetchAndroidToolchain([['AGP', () => Promise.resolve({ agpStable: undefined })]])), /no usable data/);
  const partial = await quiet(() => fetchAndroidToolchain([
    ['AGP', fail('down')],
    ['Gradle', () => Promise.resolve({ gradle: { name: 'Gradle', version: '9.8.1' } })],
  ]));
  assert.equal(partial.gradle?.version, '9.8.1');
  assert.equal(partial.agpStable, undefined);
});

const xcode: XcodeRelease = { version: '27.0', label: '27.0', build: '27A', isBeta: false, releaseDate: '2026-09-14', requiresMacOS: '26.6', iosSdk: '27.0' };

test('iOS toolchain: fails only when neither Xcode releases nor iPhone models are available', async () => {
  await assert.rejects(quiet(() => fetchiOSToolchain({ xcode: fail('down'), iphones: fail('down') })), /iOS toolchain/);
  await assert.rejects(quiet(() => fetchiOSToolchain({ xcode: () => Promise.resolve([]), iphones: () => Promise.resolve({ newest: [], known: [] }) })), /no usable data/);
  const partial = await quiet(() => fetchiOSToolchain({ xcode: () => Promise.resolve([xcode]), iphones: fail('down') }));
  assert.equal(partial.xcodeStable?.version, '27.0');
  assert.deepEqual(partial.newestiPhones, []);
});

const item = (title: string): CrashItem => ({ platform: 'iOS', source: 'GitHub', kind: 'reported', title, context: 'x', url: 'https://example.com' });

test('crash report: unknown OS versions are failures, not empty successes', async () => {
  const deps = { apple: () => Promise.resolve([item('a')]), android: () => Promise.resolve([item('b')]), sdks: fail('rate limited'), community: fail('quota'), cordova: fail('rate limited') };
  // No OS versions + both community sources down → nothing usable at all
  await assert.rejects(quiet(() => fetchCrashReport({}, deps)), /current iOS version unknown.*current Android version unknown/);
  // Release notes still work when the versions are known
  const partial = await quiet(() => fetchCrashReport({ iosMajor: '27', androidMajor: '17' }, deps));
  assert.equal(partial.ios[0].title, 'a');
  assert.deepEqual(partial.sdks, []);
});

const src = (ok: boolean) => ({ label: '', url: '', fetchedAt: '', ok });

test('publishDecision: critical sources and the healthy share both gate publishing', () => {
  const healthy = { ios: src(true), android: src(true), a: src(true), b: src(true), c: src(false) };
  assert.equal(publishDecision(healthy).publish, true);
  assert.match(publishDecision({ ...healthy, ios: src(false) }).reason ?? '', /critical source failed: ios/);
  assert.match(publishDecision({ ios: src(true), android: src(true), a: src(false), b: src(false), c: src(false) }).reason ?? '', /only 2\/5/);
  assert.equal(publishDecision({}).publish, false);
});

test('publishDecision: the 60% line, critical sources, and stale results', () => {
  const src = (ok: boolean, staleFrom?: string) => ({ label: 'x', url: 'https://x', fetchedAt: '2026-10-26T00:00:00Z', ok, ...(staleFrom ? { staleFrom } : {}) });
  const set = (oks: boolean[], over: Record<string, ReturnType<typeof src>> = {}) => ({
    ios: src(true), android: src(true), ...Object.fromEntries(oks.map((ok, i) => [`s${i}`, src(ok)])), ...over,
  });
  assert.equal(publishDecision(set([true, false, false])).publish, true, '3 of 5: exactly 60%');
  const low = publishDecision(set([false, false, false]));
  assert.equal(low.publish, false);
  assert.equal(low.reason, 'only 2/5 sources succeeded');
  const staleIos = publishDecision(set([true, true, true], { ios: src(false, '2026-10-25T00:00:00Z') }));
  assert.equal(staleIos.publish, true, 'iOS showing its last good result still publishes');
  assert.deepEqual([staleIos.failed, staleIos.stale], [['ios'], ['ios']]);
  assert.equal(publishDecision(set([true, true, true], { android: src(false) })).reason, 'critical source failed: android');
  const allStale = Object.fromEntries(Object.entries(set(Array.from({ length: 8 }, () => false))).map(([k, s]) => [k, k.startsWith('s') ? src(false, '2026-10-25T00:00:00Z') : s]));
  assert.equal(publishDecision(allStale).publish, false, 'stale results don\'t count toward the healthy share (a network outage keeps the old site)');
});

test('publishDecision: half the sources is below the line', () => {
  const src = (ok: boolean) => ({ label: 'x', url: 'https://x', fetchedAt: '2026-10-26T00:00:00Z', ok });
  const set = (failed: number) => ({ ios: src(true), android: src(true), ...Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`s${i}`, src(i >= failed)])) });
  assert.equal(publishDecision(set(5)).publish, false, '5 of 10');
  assert.equal(publishDecision(set(4)).publish, true, '6 of 10');
});
