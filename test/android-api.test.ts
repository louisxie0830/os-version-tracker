import { test } from 'node:test';
import assert from 'node:assert/strict';
import { androidApiLevel, newestPossibleAndroidMajor } from '../src/android-api.ts';

test('androidApiLevel: irregular early versions, then major + 20 with no table to extend', () => {
  assert.equal(androidApiLevel('8.0'), 26);
  assert.equal(androidApiLevel('8'), 26);
  assert.equal(androidApiLevel('8.1'), 27);
  assert.equal(androidApiLevel('Android 9'), 28);
  assert.equal(androidApiLevel('12'), 31);
  assert.equal(androidApiLevel('13'), 33);
  assert.equal(androidApiLevel('17'), 37);
  assert.equal(androidApiLevel('18'), 38, 'a version newer than any list still gets its level');
  assert.equal(androidApiLevel('依裝置而異'), undefined);
});

test('newestPossibleAndroidMajor: one major a year plus next year\'s betas', () => {
  assert.equal(newestPossibleAndroidMajor(new Date('2026-10-17')), 18);
  assert.equal(newestPossibleAndroidMajor(new Date('2030-01-01')), 22);
  assert.ok(newestPossibleAndroidMajor(new Date('2026-10-17')) < 26, 'StatCounter noise like "Android 26" is still filtered');
});
