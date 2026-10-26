import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LAST_GOOD_MAX_AGE_DAYS, LAST_GOOD_SCHEMA, lastGood, normalizeLastGood, rememberGood, resetLastGood } from '../src/last-good.ts';
import { renderSources } from '../src/render-common.ts';
import type { AllVersions } from '../src/fetch-all.ts';

const NOW = new Date('2026-10-26T00:00:00.000Z');

test('lastGood returns a copy of the remembered result, until it is too old', () => {
  resetLastGood();
  rememberGood('devNews', [{ id: 'a' }], NOW);
  const entry = lastGood<Array<{ id: string }>>('devNews', new Date(NOW.getTime() + 60_000));
  assert.deepEqual(entry, { fetchedAt: NOW.toISOString(), value: [{ id: 'a' }] });
  entry!.value.push({ id: 'b' });
  assert.equal(lastGood<unknown[]>('devNews', NOW)!.value.length, 1, 'changing the copy changes nothing remembered');
  assert.equal(lastGood('devNews', new Date(NOW.getTime() + (LAST_GOOD_MAX_AGE_DAYS + 1) * 86_400_000)), undefined);
  assert.equal(lastGood('cordova', NOW), undefined);
  rememberGood('cordova', null, NOW);
  assert.equal(lastGood('cordova', NOW), undefined, 'an empty result is never remembered');
});

test('normalizeLastGood drops entries without a date or a value', () => {
  const result = normalizeLastGood({ schema: LAST_GOOD_SCHEMA, sources: { ok: { fetchedAt: NOW.toISOString(), value: [] }, noDate: { value: [] }, badDate: { fetchedAt: 'x', value: 1 }, noValue: { fetchedAt: NOW.toISOString(), value: null } } });
  assert.deepEqual(Object.keys(result!.value), ['ok']);
  assert.deepEqual(result!.repaired, ['3 entries of sources']);
  assert.equal(normalizeLastGood([]), null);
  assert.deepEqual(normalizeLastGood({ sources: { ok: { fetchedAt: NOW.toISOString(), value: [] } } }), { value: {}, repaired: [] }, 'no schema (an older build): nothing kept');
  assert.deepEqual(normalizeLastGood({ schema: LAST_GOOD_SCHEMA + 1, sources: {} })?.value, {});
});

test('the sources list says when a section shows an earlier result', () => {
  const at = '2026-10-25T01:00:00.000Z';
  const html = renderSources({ sources: {
    ios: { label: 'iOS', url: 'https://a.example', fetchedAt: at, ok: true },
    android: { label: 'Android', url: 'https://b.example', fetchedAt: at, ok: false, staleFrom: '2026-10-24T13:00:00.000Z' },
    cordova: { label: 'Cordova', url: 'https://c.example', fetchedAt: at, ok: false },
  } } as unknown as AllVersions, ['ios', 'android', 'cordova']);
  assert.match(html, /src-stale">本次抓取失敗，顯示 10\/24\s21:00 的資料/u);
  assert.match(html, /src-fail">抓取失敗，資料可能不完整/);
});
