import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bankAppKey, coreVersionProblems, recordBankVersions, resetHistoryState, ROLLBACK_ACCEPT_AFTER } from '../src/history.ts';
import { toTrackedItems } from '../src/changes.ts';
import type { TaiwanBankApp } from '../src/fetchers/tw-banks.ts';

const app = (ios?: string, android?: string, id = 111): TaiwanBankApp => ({
  bank: '臺○○行',
  app: '臺○○動+',
  kind: 'personal',
  ios: ios ? { minOs: ios, url: `https://apps.apple.com/tw/app/id${id}` } : undefined,
  android: android ? { minOs: android, url: `https://play.google.com/store/apps/details?id=com.example.bank${id}&hl=zh_TW` } : undefined,
});

test('bankAppKey uses the App Store id, then the Play package', () => {
  assert.equal(bankAppKey(app('13.0', '8.0', 42)), 'ios:42');
  assert.equal(bankAppKey(app(undefined, '8.0', 42)), 'play:com.example.bank42');
});

test('recordBankVersions: first run is a baseline, then reports raised / lowered minimums', () => {
  resetHistoryState();
  assert.deepEqual(recordBankVersions([app('13.0', '8.0')], new Date('2026-10-01T00:00:00Z')), []);
  // Same versions written differently ("13" vs "13.0") are not a change
  assert.deepEqual(recordBankVersions([app('13', '8.0')], new Date('2026-10-02T00:00:00Z')), []);
  const changes = recordBankVersions([app('15.0', '7.0')], new Date('2026-10-03T00:00:00Z'));
  assert.deepEqual(changes.map(c => [c.platform, c.from, c.to, c.date]), [
    ['iOS', '13', '15.0', '2026-10-03'],
    ['Android', '8.0', '7.0', '2026-10-03'],
  ]);
});

test('recordBankVersions keeps the previous value when a store page is missing this time', () => {
  resetHistoryState();
  recordBankVersions([app('13.0', '8.0')], new Date('2026-10-01T00:00:00Z'));
  assert.deepEqual(recordBankVersions([app(undefined, '8.0')], new Date('2026-10-02T00:00:00Z')), []);
  const changes = recordBankVersions([app('15.0', '8.0')], new Date('2026-10-03T00:00:00Z'));
  assert.deepEqual(changes.map(c => [c.from, c.to]), [['13.0', '15.0']]);
});

test('recordBankVersions drops changes older than a year', () => {
  resetHistoryState();
  recordBankVersions([app('12.0')], new Date('2025-01-01T00:00:00Z'));
  recordBankVersions([app('13.0')], new Date('2025-01-02T00:00:00Z'));
  assert.equal(recordBankVersions([app('13.0')], new Date('2026-06-01T00:00:00Z')).length, 0);
});

test('coreVersionProblems rejects malformed versions', () => {
  resetHistoryState();
  assert.deepEqual(coreVersionProblems({ iosStable: 'unknown', androidStable: '17', xcodeStable: '27.0', agpStable: '9.4.1' }).map(p => p.source), ['ios']);
  assert.deepEqual(coreVersionProblems({ agpStable: '9.5.0-alpha01' }).map(p => p.source), ['androidToolchain']);
});

test('coreVersionProblems holds back an older version until it persists', () => {
  resetHistoryState();
  assert.deepEqual(coreVersionProblems({ iosStable: '27.1' }), []);
  assert.deepEqual(coreVersionProblems({ iosStable: '27.1.1' }), [], 'newer is fine');
  for (let i = 1; i < ROLLBACK_ACCEPT_AFTER; i++) {
    const problems = coreVersionProblems({ iosStable: '18.7.10' });
    assert.equal(problems[0]?.source, 'ios');
    assert.match(problems[0].message, /went back from 27\.1\.1 to 18\.7\.10/);
  }
  assert.deepEqual(coreVersionProblems({ iosStable: '18.7.10' }), [], 'accepted once it keeps showing up');
});

test('bank changes become tracked items', () => {
  const items = toTrackedItems({ deadlines: [], appleNews: [], androidNews: [], devices: [], bankChanges: [
    { key: 'ios:1', bank: '臺○○行', app: '臺○○動+', platform: 'iOS', from: '13.0', to: '15.0', date: '2026-10-03', url: 'https://apps.apple.com/tw/app/id1' },
  ] });
  assert.equal(items.length, 1);
  assert.equal(items[0].kind, 'bank');
  assert.match(items[0].title, /iOS 13\.0 → 15\.0/);
  assert.equal(items[0].detail, '調高最低支援版本');
});
