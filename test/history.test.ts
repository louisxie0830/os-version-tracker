import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bankAppKey, normalizeHistoryState, coreVersionProblems, recordBankVersions, resetHistoryState, ROLLBACK_ACCEPT_AFTER } from '../src/history.ts';
import { buildNotificationsJson, prunableWhen, recordItems, resetChangesState, shownDate, toTrackedItems } from '../src/changes.ts';
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

test('coreVersionProblems holds back an implausible leap ahead (a misparse) until it persists', () => {
  resetHistoryState();
  assert.deepEqual(coreVersionProblems({ iosStable: '27.1' }), []);
  assert.deepEqual(coreVersionProblems({ iosStable: '28.0' }), [], 'the next major is fine');
  const problems = coreVersionProblems({ iosStable: '280' });
  assert.equal(problems[0]?.source, 'ios');
  assert.match(problems[0].message, /jumped from 28\.0 to 280/);
  assert.deepEqual(coreVersionProblems({ iosStable: '28.0.1' }), [], 'the real version still passes: the leap never became the bar');
  for (let i = 1; i < ROLLBACK_ACCEPT_AFTER; i++) assert.equal(coreVersionProblems({ iosStable: '36.0' }).length, 1);
  assert.deepEqual(coreVersionProblems({ iosStable: '36.0' }), [], 'a real renumbering (iOS 18 → 26) is accepted once it persists');
});

test('coreVersionProblems: a version missing from a source that succeeded is a problem; one not required is not', () => {
  resetHistoryState();
  assert.deepEqual(coreVersionProblems({ androidStable: '17' }, ['iosStable']).map(p => p.source), ['ios']);
  assert.match(coreVersionProblems({}, ['xcodeStable'])[0].message, /Xcode stable is missing/);
  assert.deepEqual(coreVersionProblems({}), [], 'nothing required: nothing missing');
});

test('recordBankVersions with configured keys: a failed store page doesn\'t create a second app; dropped apps stop counting', async () => {
  const { bankSnapshots } = await import('../src/history.ts');
  resetHistoryState();
  const keys = ['ios:111', 'ios:222'];
  const t = (iso: string) => new Date(iso);
  recordBankVersions([app('15.0', '9', 111), app('14.0', '8', 222)], t('2026-10-01T03:00:00Z'), keys);
  // App 111's App Store page fails: only its Play listing comes back (whose URL has no App Store id)
  recordBankVersions([app(undefined, '9', 111), app('14.0', '8', 222)], t('2026-10-02T03:00:00Z'), keys);
  assert.deepEqual(bankSnapshots().at(-1)?.Android, { 9: 1, 8: 1 }, 'still two apps, not three');
  const changes = recordBankVersions([app('15.0', '10', 111), app('14.0', '8', 222)], t('2026-10-03T03:00:00Z'), keys);
  assert.deepEqual(changes.map(c => [c.key, c.from, c.to]), [['ios:111', '9', '10']], 'one change, under the app\'s own key');
  recordBankVersions([app('14.0', '8', 222)], t('2026-10-04T03:00:00Z'), ['ios:222']);
  assert.deepEqual(bankSnapshots().at(-1)?.iOS, { 14: 1 }, 'an app taken off the list no longer counts');
});

test('recordBankVersions dates changes by Taiwan\'s day (the 05:43 Taipei build is still yesterday in UTC)', () => {
  resetHistoryState();
  recordBankVersions([app('15.0', '9')], new Date('2026-12-31T12:00:00Z'));
  const [change] = recordBankVersions([app('16.0', '9')], new Date('2026-12-31T21:43:00Z'));
  assert.equal(change.date, '2027-01-01');
});

test('coreVersionProblems: different wrong values in a row never add up to an accepted rollback', () => {
  resetHistoryState();
  coreVersionProblems({ iosStable: '27.1' });
  for (let i = 0; i < ROLLBACK_ACCEPT_AFTER + 1; i++) {
    assert.equal(coreVersionProblems({ iosStable: i % 2 ? '18.1' : '18.2' }).length, 1, `refresh ${i + 1}`);
  }
});

const releaseApp = (version?: string, updated = '2026-11-18', androidVersion = version): TaiwanBankApp => ({
  ...app('15.0', '9', 6499507336),
  ios: { minOs: '15.0', version, updated, url: 'https://apps.apple.com/tw/app/id6499507336' },
  android: { minOs: '9', version: androidVersion, updated, url: 'https://play.google.com/store/apps/details?id=com.yuantabank.bank' },
});

test('App releases reach the bell even when minimum OS is unchanged; repeats are not new', () => {
  resetHistoryState(); resetChangesState();
  const input = { deadlines: [], appleNews: [], androidNews: [], devices: [] };
  const before = new Date('2026-11-17T04:00:00Z');
  const now = new Date('2026-11-18T04:00:00Z');
  assert.deepEqual(recordBankVersions([releaseApp('1.3.0', '2026-11-16')], before), []);
  recordItems([], before);
  const changes = recordBankVersions([releaseApp('1.3.1')], now);
  assert.equal(changes.length, 2);
  assert.ok(changes.every(c => c.field === 'app-version' && c.from === '1.3.0' && c.to === '1.3.1'));
  const tracked = toTrackedItems({ ...input, bankChanges: changes }, now);
  const first = recordItems(tracked, now);
  assert.equal(first.added.length, 2);
  const bell = JSON.parse(buildNotificationsJson(first.items, now.toISOString()));
  assert.match(bell.items[0].title, /版本更新.*1\.3\.0 → 1\.3\.1/);
  assert.equal(bell.items[0].date, '2026-11-18');
  assert.equal(bell.items[0].kindLabel, '銀行 App');
  assert.ok(prunableWhen(key => key === 'twBanks')(bell.items[0].id));
  assert.equal(recordItems(toTrackedItems({ ...input, bankChanges: recordBankVersions([releaseApp('1.3.1')], now) }, now), now).added.length, 0);
});

test('migration backfills the confirmed Nov 18 store release once, with no invented old version', () => {
  resetHistoryState(); resetChangesState();
  const now = new Date('2026-11-25T04:00:00Z');
  recordBankVersions([releaseApp(undefined)], new Date('2026-11-17T04:00:00Z'));
  const changes = recordBankVersions([releaseApp('1.3.1')], now);
  assert.equal(changes.length, 2);
  assert.ok(changes.every(c => c.from === '' && c.date === '2026-11-18'));
  const tracked = toTrackedItems({ deadlines: [], appleNews: [], androidNews: [], devices: [], bankChanges: changes }, now);
  assert.match(tracked[0].title, /iOS 1\.3\.1$/);
  assert.doesNotMatch(tracked[0].title, /→/);
  assert.match(tracked[0].detail, /前一版號未記錄/);
  assert.equal(shownDate({ ...tracked[0], firstSeen: now.toISOString() }), '2026-11-18');
  assert.equal(recordBankVersions([releaseApp('1.3.1')], now).length, 2);
});

test('missing and per-device app versions preserve the baseline; each platform updates independently', () => {
  resetHistoryState();
  const now = new Date('2026-11-25T04:00:00Z');
  recordBankVersions([releaseApp('1.3.0')], now);
  assert.deepEqual(recordBankVersions([releaseApp(undefined, '2026-11-18', 'Varies with device')], now), []);
  const changes = recordBankVersions([releaseApp('1.3.1', '2026-11-18', '1.3.0')], now);
  assert.equal(changes.length, 1);
  assert.equal(changes[0].platform, 'iOS');
  assert.equal(changes[0].from, '1.3.0');
});

test('migration ignores old, invalid and future store dates; known version changes still notify', () => {
  for (const date of ['2026-10-01', 'bad', '2026-02-30', '2027-01-01']) {
    resetHistoryState();
    const now = new Date('2026-11-25T04:00:00Z');
    recordBankVersions([releaseApp(undefined)], now);
    assert.deepEqual(recordBankVersions([releaseApp('1.3.0', date)], now), []);
    const changes = recordBankVersions([releaseApp('1.3.1', date)], now);
    assert.equal(changes.length, 2);
    assert.equal(changes[0].date, date === '2026-10-01' ? date : '2026-11-25');
  }
});


test('saved App versions and release events survive state normalization', () => {
  const bank = { iOS: '15.0', Android: '9', iOSAppVersion: '1.3.1', AndroidAppVersion: '1.3.0' };
  const event = { key: 'ios:1', bank: '元○○行', app: 'App', platform: 'iOS', field: 'app-version', from: '1.3.0', to: '1.3.1', date: '2026-11-18', url: 'https://apps.apple.com/tw/app/id1' };
  const restored = normalizeHistoryState(JSON.parse(JSON.stringify({ banks: { 'ios:1': bank }, bankChanges: [event] })))!;
  assert.deepEqual(restored.value.banks['ios:1'], bank);
  assert.deepEqual(restored.value.bankChanges, [event]);
  assert.deepEqual(restored.repaired, []);
});
