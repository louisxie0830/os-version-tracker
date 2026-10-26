import { test } from 'node:test';
import assert from 'node:assert/strict';
import { majorOf, parseShareCsv, summarize } from '../src/fetchers/os-share.ts';

const IOS_CSV = `"iOS Version","Market Share Perc. (Sept 2026)"
"iOS 26.6",48.51
"iOS 18.7",13.2
"iOS 26.5",10.88
"iOS 27",2.07
"iOS 27.0",1.48
"iOS 17.6",0.9
"Other",0.1`;

const ANDROID_CSV = `"Android Version","Market Share Perc. (Sept 2026)"
"16.0",45.27
"15.0",14.1
"9.0 Pie",1.21
"8.1 Oreo",0.26
"26.0",0.1
"Other",0.02`;

test('parseShareCsv reads label / share pairs', () => {
  const rows = parseShareCsv(IOS_CSV);
  assert.equal(rows.length, 7);
  assert.deepEqual(rows[0], { version: 'iOS 26.6', share: 48.51 });
  assert.throws(() => parseShareCsv('<html>not a csv</html>'));
});

test('majorOf normalizes iOS and Android labels', () => {
  assert.equal(majorOf('ios', 'iOS 26.6'), '26');
  assert.equal(majorOf('ios', 'iOS 27'), '27');
  assert.equal(majorOf('android', '9.0 Pie'), '9');
  assert.equal(majorOf('android', 'Other'), undefined);
});

test('summarize groups by major, newest first, with cumulative coverage', () => {
  const ios = summarize('ios', parseShareCsv(IOS_CSV), 'u');
  assert.deepEqual(ios.byMajor.map(m => m.version), ['27', '26', '18', '17', '其他']);
  assert.equal(ios.byMajor[0].share, 3.6, '"iOS 27" and "iOS 27.0" merge');
  const last = ios.coverage.at(-1)!;
  assert.equal(last.min, '17');
  assert.equal(last.covered, 100, 'coverage is relative to known versions');
  assert.equal(ios.topVersions[0].version, '26.6');
});

test('Android coverage carries API levels and drops bogus versions', () => {
  const android = summarize('android', parseShareCsv(ANDROID_CSV), 'u');
  assert.ok(!android.byMajor.some(m => m.version === '26'), 'nonexistent "Android 26" goes to 其他');
  assert.deepEqual(android.coverage.map(c => [c.min, c.api]), [['16', 36], ['15', 35], ['9', 28], ['8', 26]]);
});

test('summarize: a version StatCounter lists twice ("iOS 27" and "iOS 27.0") is one row with both shares', () => {
  const ios = summarize('ios', [
    { version: 'iOS 26.6', share: 48.51 }, { version: 'iOS 18.7', share: 13.2 }, { version: 'iOS 26.5', share: 3 },
    { version: 'iOS 27', share: 2.07 }, { version: 'iOS 27.0', share: 1.48 }, { version: 'Other', share: 9 },
  ], 'u');
  assert.deepEqual(ios.topVersions.slice(0, 4), [{ version: '26.6', share: 48.5 }, { version: '18.7', share: 13.2 }, { version: '27', share: 3.6 }, { version: '26.5', share: 3 }]);
  assert.equal(ios.topVersions.filter(v => v.version === '27').length, 1);
});

test('fetchOsShare: the previous month (across a year end), the month before when it isn\'t out yet, partial regions, no trend key without data', async t => {
  const { fetchOsShare } = await import('../src/fetchers/os-share.ts');
  t.mock.method(console, 'warn', () => {});
  const realFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = realFetch; });
  const requested: URLSearchParams[] = [];
  let published = (p: URLSearchParams) => p.get('toInt') === '202612';
  globalThis.fetch = (async (url: string | URL | Request) => {
    const p = new URL(String(url)).searchParams;
    requested.push(p);
    const multi = p.get('fromInt') !== p.get('toInt');
    if (multi || !published(p) || (p.get('statType_hidden') === 'android_version' && p.get('region_hidden') === 'ww')) return new Response('', { status: 500 });
    return new Response(p.get('statType_hidden') === 'ios_version' ? '"iOS Version","Market Share Perc."\n"iOS 26.6",60\n"iOS 18.7",40\n' : '"Android Version","Market Share Perc."\n"16.0",70\n"15.0",30\n');
  }) as typeof fetch;

  const jan = await fetchOsShare(new Date('2027-01-05T00:00:00Z'));
  assert.equal(jan.month, '2026-12');
  assert.ok(requested.some(p => p.get('toInt') === '202612' && p.get('fromInt') === '202612'));
  assert.deepEqual(Object.keys(jan.ios), ['TW', 'ww']);
  assert.deepEqual(Object.keys(jan.android), ['TW'], 'a failed region is left out, the others kept');
  assert.equal('trend' in jan, false, 'no trend data: no trend key at all');
  assert.equal('vendor' in jan, false);

  published = p => p.get('toInt') === '202611';
  assert.equal((await fetchOsShare(new Date('2027-01-05T00:00:00Z'))).month, '2026-11', 'December not out yet: November');
  published = () => false;
  await assert.rejects(fetchOsShare(new Date('2027-01-05T00:00:00Z')), /version share unavailable/);
});

test('StatCounter CSV: a quoted label with a comma stays one cell; "iOS26.6" without the space still reads', async () => {
  const { csvCells, majorOf, parseVendorHistoryCsv } = await import('../src/fetchers/os-share.ts');
  assert.deepEqual(csvCells('"Date","Android 9.0, Pie","Android 16.0"'), ['Date', 'Android 9.0, Pie', 'Android 16.0']);
  assert.deepEqual(csvCells('2026-09,1.5,"2,5"'), ['2026-09', '1.5', '2,5']);
  assert.equal(majorOf('ios', 'iOS26.6'), '26');
  const trend = parseVendorHistoryCsv('"Date","Apple","Samsung, Inc."\n2026-08,60,40\n2026-09,58,42\n', 'u');
  assert.deepEqual(trend.series.map(s => [s.version, s.shares.at(-1)]), [['Apple', 58], ['Samsung, Inc.', 42]]);
});
