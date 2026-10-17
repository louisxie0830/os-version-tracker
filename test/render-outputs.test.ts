import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { AllVersions } from '../src/fetch-all.ts';
import type { CrashItem } from '../src/fetchers/crashes.ts';
import type { SecurityReport, SdkAdvisory } from '../src/fetchers/security.ts';
import type { FrameworkInfo } from '../src/fetchers/frameworks.ts';
import { buildNowCards, nowHref } from '../src/now.ts';
import { renderFrameworksSection } from '../src/render-frameworks.ts';
import { renderCordovaSection, renderCrashesSection, renderSecuritySection } from '../src/render-security.ts';
import type { CordovaPlatform, CordovaReleases } from '../src/fetchers/cordova.ts';

const snapshot = JSON.parse(readFileSync(new URL('./fixtures/all-versions.json', import.meta.url), 'utf8')) as AllVersions;
const NOW = new Date('2026-10-17T04:00:00Z');
const EVIL = '<img src=x onerror=alert(1)>';

/** The snapshot with every "待處理" input emptied, so each test adds exactly what it checks */
const quiet = (over: Partial<AllVersions> = {}): AllVersions => ({
  ...snapshot,
  iosActions: [], androidActions: [], security: null, crashes: null, appleStatus: null,
  ...over,
});
const security = (over: Partial<SecurityReport> = {}): SecurityReport => ({ apple: [], android: [], exploited: [], advisories: [], ...over });
const crash = (over: Partial<CrashItem> = {}): CrashItem => ({
  platform: 'iOS', source: 'GitHub', kind: 'reported', title: 'App crashes', context: 'firebase/firebase-ios-sdk',
  url: 'https://github.com/firebase/firebase-ios-sdk/issues/1', date: '2026-10-10', reactions: 3, comments: 1, newOs: true, ...over,
});

// ---------- now.ts: the "待處理" cards (also api/now.json) ----------

test('no actions, no security report, no crashes, no status: no cards (a quiet day, or every source failed)', () => {
  assert.deepEqual(buildNowCards(quiet(), NOW), []);
});

test('only urgent developer actions become cards, linked to their source or else to their platform section', () => {
  const cards = buildNowCards(quiet({
    iosActions: [
      { status: 'urgent', title: 'iOS urgent', detail: 'd', url: 'https://developer.apple.com/news/' },
      { status: 'upcoming', title: 'iOS later', detail: 'd' },
    ],
    androidActions: [{ status: 'urgent', title: 'Android urgent', detail: 'd' }],
  }), NOW);
  assert.deepEqual(cards.map(c => [c.type, c.platform, c.title, c.href]), [
    ['期限', 'iOS', 'iOS urgent', 'https://developer.apple.com/news/'],
    ['期限', 'Android', 'Android urgent', '#android'],
  ]);
});

test('security cards: recently exploited Apple / Android fixes, and the KEV summary with its platforms', () => {
  const report = security({
    apple: [
      { name: 'iOS 27.0.1', url: 'https://support.apple.com/x', date: '2026-10-01', cves: 2, exploited: ['CVE-2026-1'] },
      { name: 'iOS 26.6', date: '2026-07-01', exploited: ['CVE-2026-0'] }, // older than 45 days
      { name: 'iOS 27.0.2', date: '2026-10-10', exploited: [] }, // nothing exploited
      { name: 'iOS 27.0.3', date: '2026-10-12', exploited: ['CVE-2026-2'] }, // no advisory page
    ],
    android: [{ title: 'Android Security Bulletin October 2026', url: 'https://source.android.com/b', published: '2026-10-06', patchLevels: ['2026-10-01', '2026-10-05'], exploited: ['CVE-2026-3'] }],
    exploited: ['iOS', 'Android', '跨平台', 'iOS', 'Android'].map((platform, i) => ({
      cve: `CVE-2026-9${i}`, platform: platform as 'iOS', product: `P${i}`, name: 'n', dateAdded: '2026-10-0' + (i + 1), description: 'd', ransomware: false, url: 'https://cisa.example',
    })),
  });
  const cards = buildNowCards(quiet({ security: report }), NOW);
  assert.deepEqual(cards.map(c => c.title), [
    'iOS 27.0.1 修補了可能已遭利用的漏洞',
    'iOS 27.0.3 修補了可能已遭利用的漏洞',
    'Android Security Bulletin October 2026：CVE-2026-3',
    '5 個與 iOS / Android / WebView 相關的漏洞已遭利用',
  ]);
  assert.equal(cards[1].href, '#security', 'no advisory page: the section');
  assert.equal(cards[2].body, '修補程式等級 2026-10-05 以上已修正。');
  const kev = cards[3];
  assert.equal(kev.platform, '跨平台', 'mixed platforms');
  assert.match(kev.body, /^CVE-2026-90（P0）、CVE-2026-91（P1）、CVE-2026-92（P2）、CVE-2026-93（P3） 等 5 個$/);
  const single = buildNowCards(quiet({ security: security({ exploited: [report.exploited[0]] }) }), NOW)[0];
  assert.equal(single.platform, 'iOS');
});

test('crash cards: only reports about the newest OS, at most three, from SDKs and Cordova', () => {
  const cards = buildNowCards(quiet({ crashes: {
    ios: [], android: [], community: [crash({ title: 'community, not a card' })],
    sdks: [crash({ title: 'a' }), crash({ title: 'old OS', newOs: false }), crash({ title: 'b', date: undefined })],
    cordova: [crash({ title: 'c' }), crash({ title: 'd' })],
  } }), NOW);
  assert.deepEqual(cards.map(c => c.title), ['a', 'b', 'c']);
  assert.equal(cards[1].meta, 'firebase/firebase-ios-sdk', 'no date: just the context');
});

test('Apple service status cards: ongoing and upcoming events, labelled by kind', () => {
  const cards = buildNowCards(quiet({ appleStatus: { services: 51, url: 'https://developer.apple.com/system-status/', events: [
    { id: '1', service: 'TestFlight', type: 'Outage', state: 'ongoing', start: '2026-10-17T01:00:00.000Z' },
    { id: '2', service: 'Xcode Cloud', type: 'Maintenance', state: 'upcoming', start: '2026-10-18T01:00:00.000Z', end: '2026-10-18T03:00:00.000Z' },
    { id: '3', service: 'APNs', type: 'Issue', state: 'resolved', start: '2026-10-14T01:00:00.000Z', end: '2026-10-14T02:00:00.000Z' },
  ] } }), NOW);
  assert.deepEqual(cards.map(c => [c.title, c.meta]), [['TestFlight 中斷', 'Apple 服務狀態 · 進行中'], ['Xcode Cloud 維護', 'Apple 服務狀態 · 即將']]);
});

test('card links from upstream data are checked: unsafe schemes fall back to the card\'s section', () => {
  assert.equal(nowHref('#banks', '#x'), '#banks');
  assert.equal(nowHref('javascript:alert(1)', '#crashes'), '#crashes');
  assert.equal(nowHref('data:text/html,hi', '#security'), '#security');
  assert.equal(nowHref(undefined, '#ios'), '#ios');
  assert.equal(nowHref('https://e.com/a', '#ios'), 'https://e.com/a');
  const cards = buildNowCards(quiet({
    crashes: { ios: [], android: [], community: [], cordova: [], sdks: [crash({ url: 'javascript:alert(1)' })] },
    security: security({ android: [{ title: 'Bulletin', url: 'javascript:void(0)', published: '2026-10-06', patchLevels: [], exploited: ['CVE-1'] }] }),
  }), NOW);
  assert.deepEqual(cards.map(c => c.href), ['#security', '#crashes']);
});

// ---------- render-frameworks.ts ----------

const release = (version: string, over: Partial<FrameworkInfo['recentMinors'][number]> = {}) => ({ version, date: '2026-10-15', url: `https://github.com/facebook/react-native/releases/tag/v${version}`, ...over });
const rn = (minors = [release('0.88.0', { breaking: 2, deprecated: 1, security: 0 }), release('0.87.1', { breaking: 0, deprecated: 0, security: 0 }), release('0.86.3')]): FrameworkInfo => ({
  name: 'React Native', latest: minors[0], recentMinors: minors, releaseNotesUrl: 'https://github.com/facebook/react-native/releases', breakingChangesUrl: 'https://reactnative.dev/blog',
});
const flutter: FrameworkInfo = {
  name: 'Flutter', latest: release('3.47.7', { dart: '3.13.5' }), recentMinors: [release('3.47.7', { dart: '3.13.5' }), release('3.44.9')],
  releaseNotesUrl: 'https://docs.flutter.dev/release/release-notes', breakingChangesUrl: 'https://docs.flutter.dev/release/breaking-changes',
};
const advisory = (vulnerable: string, over: Partial<SdkAdvisory> = {}): SdkAdvisory => ({
  id: 'GHSA-x', severity: 'high', summary: 's', published: '2026-10-01', packages: ['react-native'], platform: '跨平台', url: 'https://github.com/advisories/GHSA-x',
  ranges: [{ package: 'react-native', vulnerable, patched: '0.88.1' }], cve: 'CVE-2026-5', ...over,
});

test('frameworks section: absent when both frameworks failed or in an older snapshot', () => {
  assert.equal(renderFrameworksSection({ ...snapshot, frameworks: undefined }), '');
  assert.equal(renderFrameworksSection({ ...snapshot, frameworks: {} }), '');
});

test('frameworks section: one framework failing still shows the other', () => {
  const html = renderFrameworksSection({ ...snapshot, frameworks: { reactNative: rn() } });
  assert.match(html, /React Native 0\.88\.0/);
  assert.doesNotMatch(html, /Flutter 3\./);
  const flutterOnly = renderFrameworksSection({ ...snapshot, frameworks: { flutter } });
  assert.match(flutterOnly, /Flutter 3\.47\.7/);
  assert.match(flutterOnly, /<td data-label="Dart">3\.13\.5<\/td>[\s\S]*<td data-label="Dart">—<\/td>/, 'a missing Dart version shows a dash');
});

test('frameworks section: release notes flags, "none flagged", and "—" when the .0 release is unknown', () => {
  const html = renderFrameworksSection({ ...snapshot, frameworks: { reactNative: rn() } });
  assert.match(html, /<strong>破壞性變更 2<\/strong> · 棄用 1/);
  assert.match(html, /0\.87\.1[\s\S]*?沒有標示/);
  assert.match(html, /0\.86\.3[\s\S]*?<td data-label="release notes 標示">—<\/td>/);
  assert.match(html, /0\.88\.0<\/a> <span class="badge badge-stable badge-sm">最新<\/span>/);
});

test('frameworks section: only advisories affecting a listed version, marked by whether the latest is affected', () => {
  const render = (advisories: SdkAdvisory[]) => renderFrameworksSection({ ...snapshot, frameworks: { reactNative: rn() }, security: { ...security(), advisories } });
  assert.match(render([]), /列出的版本沒有已知漏洞/);
  assert.match(render([advisory('>= 0.59.0, < 0.64.1')]), /列出的版本沒有已知漏洞/, 'long fixed: not listed');
  assert.match(render([advisory('>= 0.86.0, < 0.88.1')]), /最新版仍受影響[\s\S]*0\.88\.1 修正 · CVE-2026-5/);
  const older = render([advisory('>= 0.86.0, < 0.87.0')]);
  assert.match(older, /舊版本線受影響/);
  assert.doesNotMatch(older, /最新版仍受影響/);
});

test('frameworks section: upstream text is escaped', () => {
  const html = renderFrameworksSection({ ...snapshot, frameworks: { reactNative: rn([release(EVIL, { breaking: 0, deprecated: 0, security: 0 })]) } });
  assert.ok(!html.includes(EVIL));
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
});

// ---------- render-security.ts ----------

test('security section: absent without a report; empty lists say so', () => {
  assert.equal(renderSecuritySection({ ...snapshot, security: null }), '');
  const html = renderSecuritySection({ ...snapshot, security: security() });
  for (const empty of ['近 180 天沒有新增', '近 120 天沒有相關的安全性更新', '目前抓不到 Android 安全性公告', '這些套件目前沒有資安公告']) assert.ok(html.includes(empty), empty);
});

test('security section: badges, missing optional fields, limits and escaping', () => {
  const html = renderSecuritySection({ ...snapshot, security: security({
    exploited: [{ cve: 'CVE-2026-1', platform: 'iOS', product: 'Apple <iOS>', name: EVIL, dateAdded: '2026-10-01', description: 'd', ransomware: true, url: 'https://cisa.example' }],
    apple: [
      { name: 'iOS 27.0.1', url: 'https://support.apple.com/a', date: '2026-10-01', cves: 3, exploited: ['CVE-2026-1'] },
      { name: 'iOS 27.0.2', date: '2026-10-02', exploited: [] },
    ],
    android: Array.from({ length: 4 }, (_, i) => ({ title: `Bulletin ${i}`, url: `https://source.android.com/${i}`, published: '2026-10-06', patchLevels: [], cves: i === 0 ? 0 : undefined, exploited: [] })),
    advisories: [advisory('< 1', { severity: 'critical', cve: undefined }), advisory('< 1', { severity: 'unknown', id: 'GHSA-y' })],
  }) });
  assert.match(html, /勒索軟體使用/);
  assert.ok(!html.includes(EVIL) && html.includes('Apple &lt;iOS&gt;'), 'upstream text escaped');
  assert.match(html, /可能已遭利用：CVE-2026-1/);
  assert.match(html, /2026\/10\/01 · 3 個 CVE/);
  assert.match(html, /2026\/10\/02 · 沒有公布 CVE<\/span>\s*<\/div>\s*<span class="crash-title">iOS 27\.0\.2<\/span>/, 'no advisory page: plain text, not a link');
  assert.match(html, /本月沒有公布 CVE/);
  assert.match(html, /顯示 3 \/ 4 項/, 'Android bulletins: at most three');
  assert.ok(html.includes('Bulletin 2') && !html.includes('Bulletin 3'));
  assert.match(html, /status-urgent">嚴重</);
  assert.match(html, /status-info">未分級</);
  assert.match(html, /<div class="tl-source">GHSA-x<\/div>/, 'no CVE: just the advisory id');
});

test('crashes section: absent without data; GitHub and Stack Overflow items credit their authors', () => {
  assert.equal(renderCrashesSection({ ...snapshot, crashes: null }), '');
  const html = renderCrashesSection({ ...snapshot, crashes: {
    ios: [crash({ source: 'iOS release notes', kind: 'known', title: 'Known <issue>', newOs: false, date: undefined })],
    android: [],
    sdks: Array.from({ length: 11 }, (_, i) => crash({ title: `sdk ${i}`, author: { name: 'octocat', url: 'https://github.com/octocat' } })),
    community: [crash({ source: 'Stack Overflow', title: 'SO question', reactions: 7, comments: 2, author: { name: 'dev', url: 'https://stackoverflow.com/users/1' } })],
    cordova: [],
  } });
  assert.match(html, /status-urgent">已知問題<\/span>/);
  assert.ok(html.includes('Known &lt;issue&gt;'));
  assert.match(html, /目前沒有相關的閃退紀錄/, 'an empty list says so');
  assert.match(html, /顯示 10 \/ 11 項/, 'SDK list limited to 10');
  assert.match(html, /新系統相關/);
  assert.match(html, /2026\/10\/10 回報 · 👍 3 · 💬 1 · 作者 <a href="https:\/\/github\.com\/octocat"/);
  assert.match(html, /2026\/10\/10 發問 · ▲ 7 · 回答 2 · 作者 <a href="https:\/\/stackoverflow\.com\/users\/1"[^>]*>dev<\/a> · <a href="https:\/\/creativecommons\.org\/licenses\/by-sa\/4\.0\/"/);
});

// ---------- the Cordova section (render-security.ts) ----------

const platform = (over: Partial<CordovaPlatform> = {}): CordovaPlatform => ({
  name: 'cordova-ios', platform: 'iOS', latest: '8.0.1', node: '>=20.17.0', releasedAt: '2026-09-01', majorRelease: '8.0.0',
  breaking: [], fixes: [], notesUrl: 'https://github.com/apache/cordova-ios/blob/master/RELEASENOTES.md', issuesUrl: 'https://github.com/apache/cordova-ios/issues', ...over,
} as CordovaPlatform);
const cordova = (over: Partial<CordovaReleases> = {}): CordovaReleases => ({ platforms: [platform()], plugins: [], ...over });
const cordovaAdvisory = (pkg: string, vulnerable: string, patched: string, severity: SdkAdvisory['severity'] = 'medium') =>
  advisory(vulnerable, { id: `GHSA-${pkg}`, packages: [pkg], ranges: [{ package: pkg, vulnerable, patched }], severity });

test('Cordova section: absent when neither releases nor crash data came in; crash list alone is enough', () => {
  assert.equal(renderCordovaSection({ ...snapshot, cordova: null, crashes: null }), '');
  const crashesOnly = renderCordovaSection({ ...snapshot, cordova: null, crashes: { ios: [], android: [], sdks: [], community: [], cordova: [crash({ title: 'white screen' })] } });
  assert.match(crashesOnly, /white screen/);
  assert.doesNotMatch(crashesOnly, /<h3 class="subhead">核心 plugin<\/h3>/, 'no plugin table without release data');
});

test('Cordova platform cards: Node requirement, breaking changes and fixes capped with a "more" note, escaping', () => {
  const html = renderCordovaSection({ ...snapshot, crashes: null, cordova: cordova({ platforms: [
    platform({ breaking: Array.from({ length: 10 }, (_, i) => `break ${i}`), fixes: ['fix <a>'] }),
    platform({ name: 'cordova-android', platform: 'Android', latest: '15.0.0', majorRelease: '15.0.0', node: undefined, releasedAt: undefined }),
  ] }) });
  assert.match(html, /cordova-ios 8\.0\.1<\/span>\s*<span class="case-count">2026\/09\/01 發布/);
  assert.match(html, /從 8\.0\.0 之前的版本升級：破壞性變更/);
  assert.ok(html.includes('break 7') && !html.includes('break 8'), 'at most 8 breaking changes');
  assert.match(html, /另有 2 項，見 release notes/);
  assert.ok(html.includes('fix &lt;a&gt;'), 'release notes text escaped');
  assert.match(html, /需要 Node 未標示/, 'missing engines.node');
  assert.match(html, /cordova-android 15\.0\.0<\/span>\s*<span class="case-count"><\/span>/, 'no release date: nothing shown');
});

test('Cordova plugins: required platform versions and the known vulnerabilities, flagged when the latest is affected', () => {
  const html = renderCordovaSection({ ...snapshot, crashes: null,
    cordova: cordova({ plugins: [
      { name: 'cordova-plugin-camera', latest: '8.0.0', requires: { cordova: '>=12', 'cordova-android': '>=12.0.0', 'cordova-ios': '>=7.0.0' }, repoUrl: 'https://github.com/apache/cordova-plugin-camera' },
      { name: 'cordova-plugin-file', latest: '8.1.0', requires: {}, repoUrl: 'https://github.com/apache/cordova-plugin-file' },
    ] }),
    security: { ...security(), advisories: [
      cordovaAdvisory('cordova-plugin-camera', '< 9.0.0', '9.0.0', 'high'),
      cordovaAdvisory('cordova-plugin-file', '< 6.0.2', '6.0.2', 'low'),
      cordovaAdvisory('cordova-ios', '< 7.1.1', '7.1.1'),
    ] },
  });
  assert.match(html, /<td data-label="需要平台">android &gt;=12\.0\.0、ios &gt;=7\.0\.0<\/td>/, 'the CLI requirement is left out, platforms shortened');
  assert.match(html, /<td data-label="需要平台">—<\/td>/, 'no requirements: a dash');
  assert.match(html, /camera[\s\S]*?最新版仍受影響[\s\S]*?&lt; 9\.0\.0 受影響/);
  assert.match(html, /file[\s\S]*?status-info">低<\/span>[\s\S]*?6\.0\.2 修正/, 'fixed long ago: its severity, not "affected"');
  assert.match(html, /cordova-ios 8\.0\.1[\s\S]*?已知漏洞[\s\S]*?7\.1\.1 修正/, 'platform card lists its own advisories');
  const clean = renderCordovaSection({ ...snapshot, crashes: null, cordova: cordova(), security: security() });
  assert.match(clean, /沒有已知漏洞/);
});
