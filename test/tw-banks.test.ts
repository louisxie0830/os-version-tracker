import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TW_BANK_APPS,
  fetchTaiwanBankApps,
  itunesLookupUrl,
  parseItunesLookup,
  expandSparse,
  parsePlayDetails,
  parsePlayMinAndroid,
  playDetailsUrl,
} from '../src/fetchers/tw-banks.js';
import { fixture, GARBAGE_HTML } from './helpers.js';
import { setRetryDelay } from '../src/net.js';

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
  assert.deepEqual(parsePlayDetails(html), { minOs: '9', version: '7.10.1701.43', updated: '2026-10-02', targetSdk: 36 });
  assert.equal(parsePlayMinAndroid(html), '9');
});

test('parsePlayDetails: en page (上海商銀 掌上銀) — values are language-independent', () => {
  const html = fixture('tw-banks-play-scsb-en.html');
  assert.deepEqual(parsePlayDetails(html), { minOs: '6.0', version: '1.03.0020', updated: '2026-09-24', targetSdk: 36 });
});

test('parsePlayDetails: sparse app array (fields past the dense head sent as an object)', () => {
  // Shape seen on the Fubon+ page: 104 dense items, then {"<field number>": value}
  const app = [...Array(104).fill(null), { 141: [[['1.3.5']], [[[36]], [[[26, '8.0']]]]], 146: [['2026年10月14日', [1791974458, 895000000]]] }];
  const html = `<script>AF_initDataCallback({key: 'ds:5', hash: '9', data:${JSON.stringify([null, [null, null, app]])}, sideChannel: {}});</script>`;
  assert.deepEqual(parsePlayDetails(html), { minOs: '8.0', version: '1.3.5', updated: '2026-10-14', targetSdk: 36 });
});

test('expandSparse: field numbers are 1-based; dense arrays pass through', () => {
  const sparse = expandSparse([1, 2, { 4: 'd' }]);
  assert.equal(sparse.length, 4);
  assert.equal(sparse[3], 'd');
  const dense = [1, [2], 'x'];
  assert.equal(expandSparse(dense), dense);
  assert.deepEqual(expandSparse([]), []);
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
  // Every bank has a personal app; a second one is a known separate brand, anything else is labelled
  const personal = TW_BANK_APPS.filter(a => (a.kind ?? 'personal') === 'personal');
  assert.deepEqual([...new Set(TW_BANK_APPS.map(a => a.bank))].filter(b => !personal.some(a => a.bank === b)), [], 'every bank has a personal app');
  const extra = personal.filter((a, i) => personal.findIndex(p => p.bank === a.bank) !== i).map(a => a.app);
  assert.deepEqual(extra, ['Richart'], 'only known second brands');
  for (const a of TW_BANK_APPS) assert.ok(['personal', 'business', 'merchant', 'auth'].includes(a.kind ?? 'personal'), a.app);
  assert.deepEqual(TW_BANK_APPS.filter(a => a.bank === '元大銀行').map(a => a.kind ?? 'personal'), ['personal', 'business', 'merchant', 'auth']);
  assert.equal(itunesLookupUrl([1, 2]), 'https://itunes.apple.com/lookup?id=1,2&country=tw');
  assert.equal(playDetailsUrl('com.esunbank'), 'https://play.google.com/store/apps/details?id=com.esunbank&hl=zh_TW&gl=TW');
});

test('requiredTargetSdk reads the level Google Play requires for new apps and updates', async () => {
  const { requiredTargetSdk } = await import('../src/render-banks.ts');
  assert.equal(requiredTargetSdk({ source: 'google', deadline: 'August 31, 2026', requirements: [
    { platform: 'New apps and app updates', sdk: 'Android 16 (API level 36) or higher' },
    { platform: 'Existing apps', sdk: 'Android 15 (API level 35) or higher' },
  ] }), 36);
  assert.equal(requiredTargetSdk(null), undefined);
});

test('bank Play listing: a throttled Taiwan locale recovers from the official alternate locale', async () => {
  const original = globalThis.fetch;
  const urls: string[] = [];
  setRetryDelay(0);
  try {
    globalThis.fetch = (async (url: string | URL | Request) => {
      const u = String(url);
      urls.push(u);
      return u.includes('hl=en&gl=US')
        ? new Response(fixture('tw-banks-play-cube-zh.html'))
        : new Response('rate limited', { status: 429, headers: { 'Retry-After': '0' } });
    }) as typeof fetch;
    const rows = await fetchTaiwanBankApps([{ bank: 'Test Bank', app: 'Test App', playPackage: 'com.cathaybk.mymobibank.android' }]);
    assert.equal(rows[0].android?.minOs, '9');
    assert.equal(rows[0].android?.targetSdk, 36);
    assert.equal(rows[0].android?.url, playDetailsUrl('com.cathaybk.mymobibank.android'));
    assert.equal(urls.length, 3, 'the regular GET retries once, then the alternate is requested once');
    assert.ok(urls.at(-1)?.includes('hl=en&gl=US'));
  } finally {
    globalThis.fetch = original;
    setRetryDelay(1500);
  }
});

test('bank Play listing: valid Taiwan data does not request the alternate locale', async () => {
  const original = globalThis.fetch;
  const urls: string[] = [];
  try {
    globalThis.fetch = (async (url: string | URL | Request) => {
      urls.push(String(url));
      return new Response(fixture('tw-banks-play-cube-zh.html'));
    }) as typeof fetch;
    const rows = await fetchTaiwanBankApps([{ bank: 'Test Bank', app: 'Test App', playPackage: 'com.cathaybk.mymobibank.android' }]);
    assert.equal(rows[0].android?.minOs, '9');
    assert.equal(urls.length, 1);
  } finally {
    globalThis.fetch = original;
  }
});
