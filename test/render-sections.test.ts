import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AllVersions } from '../src/fetch-all.ts';
import { renderCompatSection, renderDeadlinesSection } from '../src/render-schedule.ts';
import { renderBanksSection } from '../src/render-banks.ts';
import { renderTrendsSection } from '../src/render-trends.ts';
import { taipeiToday } from '../src/taipei-date.ts';
import { bankAppKey } from '../src/history.ts';
import type { TaiwanBankApp } from '../src/fetchers/tw-banks.ts';

/**
 * The deadline / compatibility, bank and trend sections against the data shapes that go wrong in practice:
 * missing sources, missing optional fields, boundary days, hostile upstream text and the fallbacks shown.
 */
const base = { sources: {}, timeline: [], xcodeSupport: [], agpJdk: [], twBanks: [], appleDeadline: null, googleDeadline: null, androidCompat: null, ciImages: null, osShare: null, bankTrend: [], bankChanges: [] } as unknown as AllVersions;
const data = (extra: Partial<AllVersions>) => ({ ...base, ...extra }) as AllVersions;
const HOSTILE = '<img src=x onerror=alert(1)>';
/** A Taipei calendar date `n` days from today */
const inDays = (n: number) => new Date(Date.parse(`${taipeiToday()}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const deadline = (date: string, extra: Record<string, unknown> = {}) => ({ platform: 'iOS', date, title: 'T', detail: 'D', source: 'S', url: 'https://developer.apple.com/news/', ...extra });
const statusOf = (html: string) => [...html.matchAll(/<span class="status status-(\w+)">([^<]*)<\/span>/g)].map(m => `${m[1]}:${m[2]}`);

// ---------- deadlines and the timeline ----------

test('deadlines section: absent without cards or timeline; each store card shows only what it has', () => {
  assert.equal(renderDeadlinesSection(base), '');
  const html = renderDeadlinesSection(data({
    appleDeadline: { source: 'apple', deadline: '2027-04-28', requirements: [{ platform: 'iOS', sdk: 'iOS 26 SDK' }] } as never,
  }));
  assert.match(html, /App Store/);
  assert.doesNotMatch(html, /Google Play<\/span>/);
  assert.doesNotMatch(html, /deadline-meta/, 'no extension date or announcement: no meta lines');
  const google = renderDeadlinesSection(data({
    googleDeadline: { source: 'google', deadline: '2026-08-31', extensionDate: '2026-11-01', announcedAt: '2026-05-01', requirements: [{ platform: 'New apps and app updates', sdk: 'Android 16 (API level 36)' }] } as never,
  }));
  assert.match(google, /Google Play 上的 App 必須以下列版本為目標/);
  assert.equal((google.match(/deadline-meta/g) ?? []).length, 2);
  assert.match(google, /2026\/05\/01 公告/);
});

test('timeline status at the boundaries: today, 60 days (urgent), 61 days, the extension window, and past', () => {
  const html = renderDeadlinesSection(data({
    timeline: [
      deadline(inDays(0)),
      deadline(inDays(60)),
      deadline(inDays(61)),
      deadline(inDays(-1), { extensionDate: inDays(0) }),
      deadline(inDays(-10), { extensionDate: inDays(-1) }),
      deadline(inDays(-30)),
    ] as never,
  }));
  assert.deepEqual(statusOf(html), ['urgent:今天', 'urgent:剩 60 天', 'upcoming:剩 61 天', 'urgent:延長期剩 0 天', 'ok:已生效', 'ok:已生效']);
});

test('timeline: a date that cannot be read is "to be confirmed", never "today", and a bad extension date is ignored', () => {
  const html = renderDeadlinesSection(data({ timeline: [deadline('TBD'), deadline(inDays(-5), { extensionDate: 'later' })] as never }));
  assert.deepEqual(statusOf(html), ['upcoming:日期待確認', 'ok:已生效']);
});

test('timeline: upstream titles, details and sources are escaped; an unsafe link becomes plain text', () => {
  const html = renderDeadlinesSection(data({ timeline: [deadline(inDays(5), { title: HOSTILE, detail: HOSTILE, source: HOSTILE, url: 'javascript:alert(1)' })] as never }));
  assert.ok(!html.includes('<img'), 'no markup from upstream');
  assert.equal((html.match(/&lt;img src=x onerror=alert\(1\)&gt;/g) ?? []).length, 3);
  assert.doesNotMatch(html, /href="javascript:/);
  assert.match(html, /<span class="tl-title">&lt;img/);
});

// ---------- compatibility tables ----------

const compat = {
  agpGradle: [{ agp: '9.1', minGradle: '9.3' }, { agp: '9.0', minGradle: '9.1' }, { agp: '8.13', minGradle: '8.13' }],
  studioAgp: [{ studio: 'Otter', agp: ['3.2', '9.1'] }, { studio: 'Narwhal', agp: ['3.2', '9.0'] }],
  apiLevels: [{ api: '36', minAgp: '8.9' }],
  current: { agp: '9.1', jdk: '17' },
  kotlin: [{ kotlin: '2.3.0–2.3.20', agp: ['8.2', '9.1'] }, { kotlin: '2.2.0–2.2.21', agp: ['7.3', '8.13'] }],
};

test('Android compat table: current AGP badge, Studio and Kotlin ranges, unknown values as "—" or "?"', () => {
  const html = renderCompatSection(data({ androidCompat: compat as never, androidToolchain: { agpStable: { version: '9.1.0' } } as never, agpJdk: [{ agp: '9.1', jdk: '17' }] as never }));
  const rows = html.match(/<tr[^>]*>\s*<td class="row-title" data-label="AGP">[\s\S]*?<\/tr>/g)!;
  assert.equal(rows.length, 3);
  assert.match(rows[0], /class="current"/);
  assert.match(rows[0], /最新/);
  assert.match(rows[0], /JDK 17/);
  assert.match(rows[0], /Narwhal 以上|Otter 以上/);
  assert.match(rows[1], /data-label="JDK">—/, 'no JDK known for 9.0');
  assert.match(rows[2], /2\.2\.0–2\.3\.20/, 'Kotlin range spanning both KGP lines');
  assert.match(html, /Gradle \? 、|Gradle \?、/, 'missing current Gradle shown as ?');
});

test('Android compat: Kotlin text from upstream is escaped, and an unsupported AGP says so', () => {
  const hostile = { ...compat, agpGradle: [{ agp: '10.0', minGradle: '10.0' }, { agp: '9.0', minGradle: '9.1' }], kotlin: [{ kotlin: `${HOSTILE}–2.3`, agp: ['8.0', '9.9'] }] };
  const html = renderCompatSection(data({ androidCompat: hostile as never }));
  assert.ok(!html.includes('<img'), 'no markup from the Kotlin table');
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;–2\.3/);
  assert.match(html, /尚未正式支援/, 'AGP 10.0 outside every KGP range');
});

test('compat section: absent without either table; Xcode rows translate "or later" and mark previews; CI runners', () => {
  assert.equal(renderCompatSection(base), '');
  const html = renderCompatSection(data({
    xcodeSupport: [{ xcode: '27.1 RC', macOS: 'macOS Tahoe 26.6 or later', iosSdk: 'iOS 27.1', deploymentiOS: '15–27.1', deviceiOS: '15 or later', swift: '6.4' }, { xcode: '27.0' }] as never,
    ciImages: { githubActions: [{ label: 'macOS 26', status: 'preview', labels: ['macos-26'], arch: 'arm64', os: 'macOS 26', xcodes: ['27.0', '26.4'], imageVersion: '20261010.1' }, { label: 'macOS 15', status: 'ga', labels: ['macos-latest'], arch: 'arm64', os: 'macOS 15', xcodes: [], defaultXcode: '26.4', imageDate: '2026-10-01' }], xcodeCloud: null } as never,
  }));
  assert.match(html, /macOS Tahoe 26\.6 以上/);
  assert.match(html, /預覽版/);
  assert.match(html, /<td data-label="Swift">—<\/td>/, 'missing fields fall back to —');
  assert.match(html, /<span class="badge badge-beta badge-sm">預覽<\/span>/);
  assert.match(html, /macos-latest/);
  assert.match(html, /20261010\.1/, 'image version when there is no date');
  assert.match(html, /<strong>—<\/strong>/, 'no default Xcode');
  assert.doesNotMatch(html, /Xcode Cloud：/, 'no Xcode Cloud note without data');
});

// ---------- bank apps ----------

const app = (bank: string, ios?: string, android?: string, extra: Partial<TaiwanBankApp> = {}): TaiwanBankApp => ({
  bank, app: `${bank} App`, kind: 'personal',
  ...(ios ? { ios: { minOs: ios, url: 'https://apps.apple.com/tw/app/id1' } } : {}),
  ...(android ? { android: { minOs: android, url: 'https://play.google.com/store/apps/details?id=x' } } : {}),
  ...extra,
});

test('banks section: absent without apps; missing listings and fields show "—"', () => {
  assert.equal(renderBanksSection(base), '');
  const html = renderBanksSection(data({ twBanks: [app('甲銀行', '15.0'), app('乙銀行', undefined, '9')] }));
  assert.match(html, /共 2 個 App/);
  const rows = html.match(/<tr data-index[\s\S]*?<\/tr>/g)!;
  assert.match(rows[0], /data-label="最低 Android">—/);
  assert.match(rows[1], /data-label="最低 iOS">—/);
  assert.match(rows[0], /data-label="最近更新">—/, 'no update dates');
  assert.match(rows[0], /data-android-sort="-1"/, 'no value sorts last');
});

test('banks summary: distribution lowest first, strictest versions ignore "Varies with device", kinds counted', () => {
  const html = renderBanksSection(data({ twBanks: [
    app('甲', '13.0', '8.0'), app('乙', '15.4', 'Varies with device'), app('丙', '15.0', '10'),
    app('丁', '16.0', '9', { kind: 'business' }),
  ] }));
  assert.deepEqual([...html.matchAll(/<span>iOS (\d+)<strong>(\d+) 個/g)].map(m => `${m[1]}:${m[2]}`), ['13:1', '15:2', '16:1']);
  assert.match(html, /要求最高：iOS 16\.0、Android 10/);
  assert.match(html, /個人行動銀行 3 個、企業／收款／認證 1 個/);
  assert.match(html, /<span class="badge badge-sm bank-kind">企業<\/span>/);
  assert.match(html, /data-bank-filter="kind"/, 'kind filter only when there are other kinds');
  assert.doesNotMatch(renderBanksSection(data({ twBanks: [app('甲', '13.0')] })), /data-bank-filter="kind"/);
  // Sort values: major.minor as a number
  assert.match(html, /data-ios-sort="15.04"/);
});

test('banks: targetSdk below the Play requirement is flagged and filterable; none below says all reached it', () => {
  const googleDeadline = { source: 'google', deadline: '2026-08-31', requirements: [{ platform: 'New apps and app updates', sdk: 'Android 16 (API level 36)' }] } as never;
  const low = app('甲', '15.0', '9', { android: { minOs: '9', targetSdk: 34, url: 'https://play.google.com/store/apps/details?id=a' } });
  const ok = app('乙', '15.0', '9', { android: { minOs: '9', targetSdk: 36, url: 'https://play.google.com/store/apps/details?id=b' } });
  const html = renderBanksSection(data({ twBanks: [low, ok], googleDeadline }));
  assert.match(html, /1 個 App 的最新版還低於這個值/);
  assert.match(html, /低於 36<\/span>/);
  assert.match(html, /data-bank-filter="target"/);
  assert.match(html, /data-target="below" data-target-sort="34"/);
  const all = renderBanksSection(data({ twBanks: [ok], googleDeadline }));
  assert.match(all, /所有 App 都已達到/);
  assert.doesNotMatch(all, /data-bank-filter="target"/);
  assert.doesNotMatch(renderBanksSection(data({ twBanks: [low] })), /targetSdk 3\d，/, 'no requirement known: no comparison');
});

test('banks: only changes in the last 90 days are badged, up or down, and counted once per app', () => {
  const a = app('甲', '16.0', '10');
  const b = app('乙', '15.0', '9');
  const html = renderBanksSection(data({ twBanks: [a, b], bankChanges: [
    { key: bankAppKey(a), platform: 'iOS', from: '15.0', to: '16.0', date: inDays(-3) },
    { key: bankAppKey(a), platform: 'Android', from: '11', to: '10', date: inDays(-3) },
    { key: bankAppKey(b), platform: 'iOS', from: '14.0', to: '15.0', date: inDays(-120) },
  ] as never }));
  assert.match(html, /近 90 天有 1 個 App 調整最低版本/);
  assert.match(html, /bank-change is-up[^>]*>↑ 原 15\.0/);
  assert.match(html, /bank-change is-down[^>]*>↓ 原 11/);
  assert.equal((html.match(/原 14\.0/g) ?? []).length, 0, 'the 120-day-old change is not shown');
  assert.match(html, /data-bank-filter="changed"/);
  assert.match(renderBanksSection(data({ twBanks: [b] })), /近 90 天沒有 App 調整最低版本/);
});

test('banks: names, versions and change values from the stores are escaped; unsafe store links are not linked', () => {
  const evil = app(HOSTILE, `${HOSTILE}`, '9', { app: HOSTILE, ios: { minOs: HOSTILE, url: 'javascript:alert(1)' } });
  const html = renderBanksSection(data({ twBanks: [evil], bankChanges: [{ key: bankAppKey(evil), platform: 'iOS', from: HOSTILE, to: '1', date: inDays(-1) }] as never }));
  assert.ok(!html.includes('<img'), 'no markup from upstream');
  assert.doesNotMatch(html, /href="javascript:/);
});

// ---------- trends ----------

const shareTrend = (months: string[], series: Array<[string, number[]]>) => ({ months, series: series.map(([version, shares]) => ({ version, shares })), url: 'https://gs.statcounter.com/' });

test('trends section: absent with no share trends and no bank apps; the bank card explains an empty history', () => {
  assert.equal(renderTrendsSection(base), '');
  const none = renderTrendsSection(data({ twBanks: [app('甲', '15.0')] }));
  assert.match(none, /還沒有紀錄。/);
  const one = renderTrendsSection(data({ twBanks: [app('甲', '15.0')], bankTrend: [{ date: '2026-10-16', iOS: { '15': 1 }, Android: {} }] }));
  assert.match(one, /從 2026\/10\/16 開始每天記錄，累積兩天以上就會顯示趨勢/);
  assert.doesNotMatch(one, /data-chart-toggle="bank-trend"/);
});

test('share trend: one region has no toggle; two regions toggle, the second chart hidden; insight from first share to latest', () => {
  const months = ['2026-07', '2026-08', '2026-09'];
  const tw = shareTrend(months, [['27', [0, 3.1, 24.5]], ['26', [80, 75, 60]], ['其他', [20, 21.9, 15.5]]]);
  const single = renderTrendsSection(data({ osShare: { trend: { ios: { TW: tw } } } as never }));
  assert.doesNotMatch(single, /data-chart-toggle="share-ios"/);
  assert.match(single, /iOS 27：2026\/08 3\.1% → 2026\/09 24\.5%/, 'counted from the first month with a share');
  const both = renderTrendsSection(data({ osShare: { trend: { ios: { TW: tw, ww: tw } } } as never }));
  assert.match(both, /data-chart-toggle="share-ios"/);
  assert.equal((both.match(/<p class="trend-insight" data-chart-group="share-ios" data-value="ww" hidden>/g) ?? []).length, 1);
});

test('share trend: more than four majors fold into 其他, newest first in the legend', () => {
  const months = ['2026-08', '2026-09'];
  const trend = shareTrend(months, [['27', [10, 20]], ['26', [40, 35]], ['18', [20, 18]], ['17', [10, 9]], ['16', [5, 4]], ['15', [3, 2]]]);
  const html = renderTrendsSection(data({ osShare: { trend: { ios: { TW: trend } } } as never }));
  const legend = [...html.matchAll(/<th>([^<]+)<\/th>/g)].map(m => m[1]).filter(t => t !== '月份');
  assert.deepEqual(legend, ['iOS 27', 'iOS 26', 'iOS 18', 'iOS 17', '其他']);
  assert.match(html, /<td>2026\/09<\/td>(?:<td>[^<]*<\/td>){4}<td>6%<\/td>/, '16 and 15 summed into 其他');
});

test('vendor trend: brand names from StatCounter are escaped, and the latest shares listed', () => {
  const trend = shareTrend(['2026-08', '2026-09'], [[HOSTILE, [30, 31]], ['Samsung', [25, 24]]]);
  const html = renderTrendsSection(data({ twBanks: [app('甲', '15.0')], osShare: { vendor: { TW: trend } } as never }));
  assert.ok(!html.includes('<img'), 'no markup from brand names');
  assert.match(html, /Samsung 24%/);
});

test('bank trend: two or more days chart each platform, the top four minimum versions plus 其他', () => {
  const snaps = [
    { date: '2026-10-15', iOS: { '13': 2, '14': 1, '15': 5, '16': 2, '17': 1 }, Android: { '8': 3 } },
    { date: '2026-10-16', iOS: { '13': 1, '14': 1, '15': 6, '16': 2, '17': 1 }, Android: { '8': 2, '9': 1 } },
  ];
  const html = renderTrendsSection(data({ twBanks: [app('甲', '15.0')], bankTrend: snaps }));
  assert.match(html, /data-chart-toggle="bank-trend"/);
  assert.match(html, /銀行 App 最低 iOS 要求的分布，2026\/10\/15 至 2026\/10\/16/);
  assert.match(html, /<th>其他<\/th>/, 'a fifth version folds into 其他');
  assert.match(html, /data-value="Android" hidden|hidden[^>]*data-value="Android"/, 'Android chart starts hidden');
});
