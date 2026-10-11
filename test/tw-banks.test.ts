import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TW_BANK_APPS,
  itunesLookupUrl,
  parseItunesLookup,
  parsePlayDetails,
  parsePlayMinAndroid,
  playDetailsUrl,
} from '../src/fetchers/tw-banks.js';
import { fixture, GARBAGE_HTML } from './helpers.js';

test('parseItunesLookup: min iOS, version, Taipei-dated update and clean URL', () => {
  const apps = parseItunesLookup(fixture('tw-banks-itunes-lookup.json'));
  assert.equal(apps.size, 3);

  const cube = apps.get(373500505);
  assert.equal(cube?.trackName, '國泰世華網路銀行CUBE');
  assert.equal(cube?.minOs, '15.0');
  assert.equal(cube?.version, '7.10.1701');
  assert.equal(cube?.updated, '2026-10-06');
  assert.ok(cube?.url.startsWith('https://apps.apple.com/tw/app/'));
  assert.ok(cube?.url.endsWith('/id373500505'), 'tracking query string stripped');

  const ctbc = apps.get(417698185);
  assert.equal(ctbc?.minOs, '14', 'kept as reported by Apple');
  assert.equal(ctbc?.updated, '2026-08-22', '2026-08-21T16:32Z is already the 22nd in Taipei');

  assert.equal(apps.get(6479990131)?.minOs, '13.0');
});

test('parseItunesLookup: garbage input yields an empty map', () => {
  assert.equal(parseItunesLookup('').size, 0);
  assert.equal(parseItunesLookup(GARBAGE_HTML).size, 0);
  assert.equal(parseItunesLookup('{"resultCount":0,"results":[]}').size, 0);
  assert.equal(parseItunesLookup('{"results":[{"trackId":"x"},{"trackId":1}]}').size, 0);
  assert.equal(parseItunesLookup('null').size, 0);
});

test('parsePlayDetails: zh_TW page (CUBE)', () => {
  const html = fixture('tw-banks-play-cube-zh.html');
  assert.deepEqual(parsePlayDetails(html), { minOs: '9', version: '7.10.1701.43', updated: '2026-10-02' });
  assert.equal(parsePlayMinAndroid(html), '9');
});

test('parsePlayDetails: en page (上海商銀 掌上銀) — values are language-independent', () => {
  const html = fixture('tw-banks-play-scsb-en.html');
  assert.deepEqual(parsePlayDetails(html), { minOs: '6.0', version: '1.03.0020', updated: '2026-09-24' });
});

test('parsePlayDetails: "varies with device" label is returned as-is', () => {
  const html = fixture('tw-banks-play-cube-zh.html').replace(
    '[[["7.10.1701.43"]],[[[36]],[[[28,"9"]]]]]',
    '[[["依裝置而異"]],[[["依裝置而異"]]]]',
  );
  assert.equal(parsePlayMinAndroid(html), '依裝置而異');
  assert.equal(parsePlayDetails(html)?.version, undefined);
});

test('parsePlayMinAndroid: falls back to structural regex when the JSON block is not parseable', () => {
  const html = fixture('tw-banks-play-cube-zh.html').replace(/AF_initDataCallback\(\{key: 'ds:5'/, "AF_initDataCallback({key: 'ds:5' BROKEN");
  assert.equal(parsePlayMinAndroid(html), '9');
});

test('parsePlayMinAndroid: garbage input yields undefined', () => {
  assert.equal(parsePlayMinAndroid(''), undefined);
  assert.equal(parsePlayMinAndroid(GARBAGE_HTML), undefined);
  assert.equal(parsePlayMinAndroid("<script>AF_initDataCallback({key: 'ds:5', hash: '1', data:[1,[2]], sideChannel: {}});</script>"), undefined);
  assert.equal(parsePlayDetails('<html>Requires Android</html>'), undefined);
});

test('TW_BANK_APPS: unique ids and well-formed links', () => {
  const ids = TW_BANK_APPS.map(a => a.appStoreId);
  const pkgs = TW_BANK_APPS.map(a => a.playPackage);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(new Set(pkgs).size, pkgs.length);
  assert.ok(TW_BANK_APPS.some(a => a.appStoreId === 6479990131 && a.playPackage === 'com.fubon.aibank'));
  assert.ok(TW_BANK_APPS.some(a => a.appStoreId === 373500505 && a.bank === '國泰世華'));
  for (const p of pkgs) assert.match(p ?? '', /^[a-zA-Z][\w]*(\.[\w]+)+$/);
  assert.equal(itunesLookupUrl([1, 2]), 'https://itunes.apple.com/lookup?id=1,2&country=tw');
  assert.equal(playDetailsUrl('com.esunbank'), 'https://play.google.com/store/apps/details?id=com.esunbank&hl=zh_TW&gl=TW');
});
