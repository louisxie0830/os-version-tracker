import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseShareHistoryCsv } from '../src/fetchers/os-share.ts';
import { renderLineChart, spreadLabels } from '../src/render-chart.ts';
import { pickTrendSeries } from '../src/render.ts';
import { pickVendorSeries } from '../src/render-trends.ts';
import { parseVendorHistoryCsv } from '../src/fetchers/os-share.ts';
import { bankSnapshots, recordBankVersions, resetHistoryState } from '../src/history.ts';
import type { TaiwanBankApp } from '../src/fetchers/tw-banks.ts';

// Synthetic StatCounter range export (structure only)
const IOS_CSV = `"Date","iOS 26.6","iOS 26.5","iOS 18.7","iOS 27","Other"
2026-07,40,10,30,0,20
2026-08,45,5,25,2,23
2026-09,40,0,20,18,22
2026-10,0,0,0,0,0`;

test('parseShareHistoryCsv sums point releases per major and drops unpublished months', () => {
  const t = parseShareHistoryCsv('ios', IOS_CSV, 'https://gs.statcounter.com/x');
  assert.deepEqual(t.months, ['2026-07', '2026-08', '2026-09']);
  assert.deepEqual(t.series.map(s => [s.version, s.shares]), [
    ['27', [0, 2, 18]],
    ['26', [50, 50, 40]],
    ['18', [30, 25, 20]],
    ['其他', [20, 23, 22]],
  ]);
  assert.throws(() => parseShareHistoryCsv('ios', '"Date","iOS 26"\n2026-07,10', 'u'), /fewer than two months/);
});

test('parseShareHistoryCsv folds Android labels that are not real versions into 其他', () => {
  const t = parseShareHistoryCsv('android', `"Date","16.0","15.0","26","Other"\n2026-08,30,50,5,15\n2026-09,35,45,5,15`, 'u');
  assert.deepEqual(t.series.map(s => s.version), ['16', '15', '其他']);
  assert.deepEqual(t.series.at(-1)!.shares, [20, 20]);
});

test('pickTrendSeries keeps one colour per version across regions and folds the rest', () => {
  const trend = (shares: Record<string, number[]>) => ({ months: ['2026-08', '2026-09'], url: 'u', series: Object.entries(shares).map(([version, s]) => ({ version, shares: s })) });
  const picked = pickTrendSeries({
    TW: trend({ '27': [1, 20], '26': [60, 50], '18': [30, 20], '17': [5, 5], '16': [4, 4], '其他': [0, 1] }),
    ww: trend({ '27': [1, 10], '26': [50, 45], '18': [20, 20], '15': [20, 15], '其他': [9, 10] }),
  }, 'iOS');
  // Top four by latest share in any region: 26, 18, 27, 15 → ordered newest first
  assert.deepEqual(picked.TW!.map(s => [s.name, s.slot]), [['iOS 27', 1], ['iOS 26', 2], ['iOS 18', 3], ['iOS 15', 4], ['其他', 'other']]);
  assert.deepEqual(picked.ww!.map(s => [s.name, s.slot]), [['iOS 27', 1], ['iOS 26', 2], ['iOS 18', 3], ['iOS 15', 4], ['其他', 'other']]);
  assert.deepEqual(picked.TW![3].values, [0, 0], 'a version missing in one region is drawn at zero');
  assert.deepEqual(picked.TW![4].values, [9, 10], '17 + 16 + 其他');
});

test('spreadLabels keeps end labels apart and inside the plot', () => {
  const ys = spreadLabels([100, 102, 104, 300], 13, 16, 204);
  assert.ok(ys[1] - ys[0] >= 13 && ys[2] - ys[1] >= 13);
  assert.ok(Math.max(...ys) <= 204);
});

test('renderLineChart draws one path per series, a legend, end labels and a table view', () => {
  const html = renderLineChart({
    label: 'test chart',
    xLabels: ['2026-08', '2026-09'],
    unit: '%',
    series: [{ name: 'iOS 27', slot: 1, values: [2, 18] }, { name: '其他', slot: 'other', values: [5, null] }],
  });
  assert.equal((html.match(/class="chart-line"/g) ?? []).length, 2);
  assert.match(html, /class="chart-legend"/);
  assert.match(html, /iOS 27 · 18%<\/text>/);
  assert.match(html, /以表格檢視/);
  assert.match(html, /<td>—<\/td>/, 'missing values show as a dash');
  assert.match(html, /role="img" aria-label="test chart"/);
});

test('bank snapshots record one distribution per day', () => {
  resetHistoryState();
  const app = (id: number, ios: string): TaiwanBankApp => ({ bank: 'b', app: 'a', kind: 'personal', ios: { minOs: ios, url: `https://apps.apple.com/tw/app/id${id}` } });
  recordBankVersions([app(1, '13.0'), app(2, '15.0')], new Date('2026-10-14T01:00:00Z'));
  recordBankVersions([app(1, '13.0'), app(2, '15.0')], new Date('2026-10-14T09:00:00Z'));
  recordBankVersions([app(1, '15.0'), app(2, '15.0')], new Date('2026-10-15T01:00:00Z'));
  assert.deepEqual(bankSnapshots().map(s => [s.date, s.iOS]), [
    ['2026-10-14', { 13: 1, 15: 1 }],
    ['2026-10-15', { 15: 2 }],
  ]);
});

test('displayDate formats dates for the page and leaves IDs and versions alone', async () => {
  const { displayDate } = await import('../src/render-actions.ts');
  assert.equal(displayDate('2027-01-27'), '2027/01/27');
  assert.equal(displayDate('2026-09'), '2026/09');
  assert.equal(displayDate('iOS 2026-10-01 · Android 2026-09-24'), 'iOS 2026/10/01 · Android 2026/09/24');
  assert.equal(displayDate('CVE-2026-86950'), 'CVE-2026-86950');
  assert.equal(displayDate('Android Studio 2024.3.1 Patch 1'), 'Android Studio 2024.3.1 Patch 1');
  assert.equal(displayDate('修補程式等級 2026-10-01 / 2026-10-05'), '修補程式等級 2026/10/01 / 2026/10/05');
});

test('parseVendorHistoryCsv: brands largest first, Unknown and Other folded into 其他', () => {
  const csv = `"Date","Apple","Samsung","Unknown","Xiaomi","Other"\n2026-08,52,18,5,6,1\n2026-09,51.6,18.3,4.9,6.3,0.5\n2026-10,0,0,0,0,0`;
  const t = parseVendorHistoryCsv(csv, 'https://gs.statcounter.com/vendor-market-share/mobile/taiwan');
  assert.deepEqual(t.months, ['2026-08', '2026-09'], 'an unpublished month is dropped');
  assert.deepEqual(t.series.map(s => s.version), ['Apple', 'Samsung', 'Xiaomi', '其他']);
  assert.deepEqual(t.series.at(-1)!.shares, [6, 5.4]);
});

test('pickVendorSeries keeps a brand\'s colour across regions and folds the rest', () => {
  const t = (rows: Array<[string, number]>) => ({ months: ['2026-09'], url: '', series: rows.map(([version, share]) => ({ version, shares: [share] })) });
  const out = pickVendorSeries({ TW: t([['Apple', 52], ['Samsung', 18], ['Oppo', 6], ['Xiaomi', 6], ['Vivo', 3]]), ww: t([['Samsung', 30], ['Apple', 27], ['Xiaomi', 12], ['Oppo', 5]]) });
  assert.deepEqual(out.TW!.map(s => [s.name, s.slot]), [['Apple', 1], ['Samsung', 2], ['Xiaomi', 3], ['Oppo', 4], ['其他', 'other']]);
  assert.deepEqual(out.ww!.map(s => s.name), ['Apple', 'Samsung', 'Xiaomi', 'Oppo']);
});
