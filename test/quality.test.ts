import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { bankFieldGaps, dataQualityProblems } from '../src/quality.ts';
import { checkCountNotDropped, resetHistoryState, ROLLBACK_ACCEPT_AFTER } from '../src/history.ts';
import type { TaiwanBankApp, TaiwanBankAppEntry } from '../src/fetchers/tw-banks.ts';

const realWarn = console.warn;
beforeEach(() => { resetHistoryState(); console.warn = () => {}; });
test.after(() => { console.warn = realWarn; });

const entries: TaiwanBankAppEntry[] = Array.from({ length: 10 }, (_, i) => ({ bank: `b${i}`, app: `a${i}`, appStoreId: 100 + i, playPackage: `com.bank${i}` }));
const full = (i: number): TaiwanBankApp => ({
  bank: `b${i}`, app: `a${i}`, kind: 'personal',
  ios: { minOs: '15.0', version: '1.0', updated: '2026-10-01', url: `https://apps.apple.com/tw/app/id${100 + i}` },
  android: { minOs: '8.0', version: '1.0', updated: '2026-10-01', url: `https://play.google.com/store/apps/details?id=com.bank${i}` },
});

test('bankFieldGaps: complete data has no problems', () => {
  assert.deepEqual(bankFieldGaps(entries, entries.map((_, i) => full(i))), []);
});

test('bankFieldGaps: a field most apps have, missing for one, is named by its store id', () => {
  const apps = entries.map((_, i) => full(i));
  delete apps[3].android!.updated;
  assert.deepEqual(bankFieldGaps(entries, apps), ['android.updated 有 1/10 個 App 缺值：com.bank3']);
});

test('bankFieldGaps: a field few apps have is not a gap, and android.version is never checked', () => {
  const apps = entries.map((_, i) => full(i));
  for (const a of apps.slice(0, 5)) delete a.ios!.updated;
  for (const a of apps.slice(0, 2)) delete a.android!.version;
  assert.deepEqual(bankFieldGaps(entries, apps), []);
});

test('bankFieldGaps: one store listing missing is reported; the whole store missing is left to the source alert', () => {
  const apps = entries.map((_, i) => full(i));
  delete apps[7].ios;
  assert.deepEqual(bankFieldGaps(entries, apps), ['App Store 沒有抓到 1 個 App：id107']);
  assert.deepEqual(bankFieldGaps(entries, entries.map((_, i) => ({ ...full(i), android: undefined }))), []);
  // An app without a Play package isn't expected on Play
  const noPlay = entries.map((e, i) => (i === 0 ? { ...e, playPackage: undefined } : e));
  assert.deepEqual(bankFieldGaps(noPlay, entries.map((_, i) => (i === 0 ? { ...full(i), android: undefined } : full(i)))), []);
});

test('checkCountNotDropped: a drop below half is reported until it persists, then accepted', () => {
  assert.equal(checkCountNotDropped('feed', 20).ok, true, 'baseline');
  assert.equal(checkCountNotDropped('feed', 12).ok, true, 'a smaller dip is fine');
  const first = checkCountNotDropped('feed', 4);
  assert.equal(first.ok, false);
  assert.match(!first.ok ? first.message : '', /feed：筆數從 12 掉到 4（第 1\/3 次/);
  for (let i = 2; i < ROLLBACK_ACCEPT_AFTER; i++) assert.equal(checkCountNotDropped('feed', 4).ok, false);
  assert.equal(checkCountNotDropped('feed', 4).ok, true, 'accepted as the new normal');
  assert.equal(checkCountNotDropped('feed', 4).ok, true);
});

test('checkCountNotDropped: small lists and recoveries', () => {
  checkCountNotDropped('tiny', 5);
  assert.equal(checkCountNotDropped('tiny', 1).ok, true, 'below the baseline size a drop means nothing');
  checkCountNotDropped('list', 30);
  assert.equal(checkCountNotDropped('list', 3).ok, false);
  assert.equal(checkCountNotDropped('list', 29).ok, true, 'back to normal');
  assert.equal(checkCountNotDropped('list', 3).ok, false, 'a new drop starts counting again');
});

test('dataQualityProblems: only successful sources are checked, each reported even when fine', () => {
  const apps = entries.map((_, i) => full(i));
  delete apps[0].ios!.version;
  const run = (ok: Set<string>, count: number) => dataQualityProblems({
    ok: k => ok.has(k), bankEntries: entries, banks: apps, counts: { twBanks: { 'twBanks.apps': count }, devNews: { 'devNews.items': 40 } },
  });
  run(new Set(['twBanks', 'devNews']), 10);
  const result = run(new Set(['twBanks']), 2);
  assert.deepEqual([...result.keys()], ['twBanks'], 'failed devNews is skipped');
  assert.deepEqual(result.get('twBanks'), ['ios.version 有 1/10 個 App 缺值：id100', 'twBanks.apps：筆數從 10 掉到 2（第 1/3 次；連續 3 次就視為正常）']);
});
