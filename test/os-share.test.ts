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
