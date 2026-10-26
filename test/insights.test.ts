import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildAndroidActions, buildDeadlineTimeline, buildiOSActions, zhDate, zhPlatform, zhSdk } from '../src/insights.ts';
import type { ActionItem, AndroidCompat, Deadline, iOSToolchain, OSVersionInfo, SubmissionDeadline, XcodeRelease, XcodeSupportRow } from '../src/types.ts';
import type { GithubMacosRunner } from '../src/fetchers/ci-images.ts';
import type { OsShare } from '../src/fetchers/os-share.ts';

// Noon on October 17, 2026 in Taipei; day counts are Taiwan calendar days whatever the machine's time zone
const NOW = new Date('2026-10-17T04:00:00Z');
const find = (actions: ActionItem[], title: RegExp) => actions.find(a => title.test(a.title));

const xcode = (version: string, iosSdk: string, releaseDate: string, requiresMacOS: string, isBeta = false): XcodeRelease => ({
  version, label: version, build: 'x', isBeta, releaseDate, requiresMacOS, iosSdk, notesUrl: `https://developer.apple.com/xcode-${version}`,
});
const RELEASES = [
  xcode('26.0', '26.0', '2025-09-15', '15.6'),
  xcode('26.4', '26.4', '2026-03-24', '15.6'),
  xcode('27.0', '27.0', '2026-09-15', '26.6'),
  xcode('27.1', '27.1', '2026-10-06', '26.6'),
  xcode('27.2 beta 3', '27.2', '2026-10-13', '26.6', true),
];
const toolchain = (stable = RELEASES[3], extra: Partial<iOSToolchain> = {}): iOSToolchain => ({
  xcodeStable: stable, releases: RELEASES, newestiPhones: [], knowniPhones: [], ...extra,
});
const appleDeadline = (deadline: string, sdk = 'iOS 26 SDK'): SubmissionDeadline => ({
  source: 'apple', deadline, requirements: [{ platform: 'iOS and iPadOS', sdk }],
});

// ---------- iOS: the App Store SDK requirement ----------

test('iOS SDK requirement: urgent within 60 days, with the first non-beta Xcode that has the SDK', () => {
  const [req] = buildiOSActions([], toolchain(), appleDeadline('November 1, 2026'), {}, NOW);
  assert.equal(req.status, 'urgent');
  assert.equal(req.title, '上架 App Store 必須使用 iOS 26 SDK 建置');
  assert.match(req.detail, /^2026 年 11 月 1 日 起生效（剩 15 天）。請升級至 Xcode 26\.0 以上（需 macOS 15\.6 以上）。$/);
});

test('iOS SDK requirement: "upcoming" beyond 60 days, "today" / "tomorrow" on the last days', () => {
  assert.equal(buildiOSActions([], toolchain(), appleDeadline('January 31, 2027'), {}, NOW)[0].status, 'upcoming');
  assert.match(buildiOSActions([], toolchain(), appleDeadline('October 17, 2026'), {}, NOW)[0].detail, /（就是今天）/);
  assert.match(buildiOSActions([], toolchain(), appleDeadline('October 18, 2026'), {}, NOW)[0].detail, /（明天）/);
});

test('iOS SDK requirement in effect: "ok", plus an estimated next wave once a newer SDK ships', () => {
  const actions = buildiOSActions([], toolchain(), appleDeadline('April 28, 2026'), {}, NOW);
  const now = find(actions, /必須使用 iOS 26 SDK/)!;
  assert.equal(now.status, 'ok');
  assert.match(now.detail, /^自 2026 年 4 月 28 日 起生效。最低需求：Xcode 26\.0 以上/);
  const next = find(actions, /預計下一波/)!;
  assert.equal(next.title, '預計下一波：要求 iOS 27 SDK');
  assert.equal(next.status, 'upcoming');
  assert.equal(next.estimated, true);
  assert.match(next.detail, /Xcode 27\.0 以上（需 macOS 26\.6 以上）/);
  // No next wave when the newest stable SDK is the one already required
  assert.equal(find(buildiOSActions([], toolchain(RELEASES[1]), appleDeadline('April 28, 2026'), {}, NOW), /預計下一波/), undefined);
});

test('iOS SDK requirement without a matching Xcode falls back to naming the SDK', () => {
  const [req] = buildiOSActions([], toolchain(RELEASES[3], { releases: [] }), appleDeadline('November 1, 2026', 'iOS 28 SDK'), {}, NOW);
  assert.match(req.detail, /請升級至 iOS 28 SDK。$/);
});

// ---------- iOS: other requirements, Xcode support, devices, CI ----------

const SUPPORT: XcodeSupportRow[] = [
  { xcode: '27.2 beta 3', macOS: 'macOS Tahoe 26.6 or later', deploymentiOS: '15–27.2', deviceiOS: '17 or later' },
  { xcode: '27.1', macOS: 'macOS Tahoe 26.6 or later', deploymentiOS: '15–27.1', deviceiOS: '17 or later' },
  { xcode: '26.4', macOS: 'macOS Sequoia 15.6 or later', deploymentiOS: '15–26.4', deviceiOS: '16 or later' },
];
const req = (title: string, date: string, detail = ''): Deadline => ({ platform: 'iOS', date, title, detail, source: 'Apple', url: `https://apple.example/${encodeURIComponent(title)}` });

test('minimum deployment target requirement, with the oldest target current Xcode can still set', () => {
  const actions = buildiOSActions([], null, null, { xcodeSupport: SUPPORT, requirements: [req('Minimum deployment target', '2026-09-09', 'Apps must target iOS 13 or later')] }, NOW);
  const min = find(actions, /最低部署版本/)!;
  assert.equal(min.title, '上架 App 的最低部署版本須為 iOS 13 以上');
  assert.equal(min.status, 'ok');
  assert.match(min.detail, /^自 2026 年 9 月 9 日 起生效。Deployment Target 低於 iOS 13 的 App 無法上傳至 App Store Connect。另外，Xcode 27\.1 可設定的最低部署版本為 iOS 15。$/);
});

test('other Apple requirements: upcoming and past-year ones listed; SDK and Xcode ones and older ones skipped', () => {
  const actions = buildiOSActions([], null, null, {
    requirements: [
      req('Age rating updates', '2026-11-30', 'Answer the new questions.'),
      req('Privacy manifests', '2026-02-01'),
      req('Old rule', '2025-06-01'),
      req('SDK minimum requirements', '2026-04-28'),
      req('Xcode 26 required', '2026-04-28'),
    ],
  }, NOW);
  const titles = actions.filter(a => a.title.startsWith('Apple 規定')).map(a => [a.title, a.status]);
  assert.deepEqual(titles, [['Apple 規定：Age rating updates', 'urgent'], ['Apple 規定：Privacy manifests', 'ok']], '44 days left is within the 60-day urgent window');
  assert.match(find(actions, /Age rating/)!.detail, /^2026 年 11 月 30 日 起生效（剩 44 天）。Answer the new questions\.$/);
});

test('device debugging floor of the latest non-beta Xcode, and which older Xcode to keep for older devices', () => {
  const info = find(buildiOSActions([], null, null, { xcodeSupport: SUPPORT }, NOW), /實機除錯需/)!;
  assert.equal(info.title, 'Xcode 27.1：實機除錯需 iOS 17 以上裝置');
  assert.equal(info.status, 'info');
  assert.match(info.detail, /部署版本範圍為 iOS 15–27\.1，需 macOS Tahoe 26\.6 以上。若要在更舊的實機上除錯，需保留 Xcode 26\.4（支援 iOS 16 以上的裝置）。$/);
});

test('newly announced iPhones become an "upcoming" item', () => {
  const actions = buildiOSActions([], null, null, { announcedDevices: [{ name: 'iPhone Duo', title: 'Prepare your apps for iPhone Duo', url: 'https://apple.example/duo', date: '2026-10-06' }] }, NOW);
  const item = find(actions, /新機型/)!;
  assert.equal(item.title, 'Apple 已公告新機型：iPhone Duo');
  assert.equal(item.status, 'upcoming');
  assert.equal(item.url, 'https://apple.example/duo');
});

const runner = (label: string, labels: string[], status: GithubMacosRunner['status'], defaultXcode: string, xcodes: string[]): GithubMacosRunner => ({
  label, labels, name: label, arch: 'arm64', status, os: 'macOS', defaultXcode, xcodes, url: `https://github.com/actions/runner-images/${label}`,
} as GithubMacosRunner);

test('CI: macos-latest behind the stable Xcode names the runners that have it (preview-only gets a warning)', () => {
  const ci = (runners: GithubMacosRunner[]) => find(buildiOSActions([], toolchain(), null, { ciRunners: runners }, NOW), /^CI：/);
  const latest = runner('macos-15', ['macos-latest', 'macos-15'], 'ga', '26.4', ['26.4', '26.0']);

  const withGa = ci([latest, runner('macos-26', ['macos-26'], 'ga', '27.1', ['27.1', '27.2 beta 3'])])!;
  assert.equal(withGa.title, 'CI：GitHub Actions macos-latest 預設仍是 Xcode 26.4');
  assert.equal(withGa.status, 'upcoming');
  assert.match(withGa.detail, /可改用 macos-26 runner/);
  assert.doesNotMatch(withGa.detail, /只有預覽版/);

  const previewOnly = ci([latest, runner('macos-26', ['macos-26'], 'preview', '27.1', ['27.1'])])!;
  assert.match(previewOnly.detail, /可改用 macos-26（預覽版） runner.*目前只有預覽版 runner 內建/);

  const none = ci([latest, runner('macos-14', ['macos-14'], 'deprecated', '27.1', ['27.1'])])!;
  assert.match(none.detail, /目前沒有正式（非 preview）的 GitHub runner 內建 Xcode 27/);

  assert.equal(ci([runner('macos-26', ['macos-latest'], 'ga', '27.1', ['27.1'])]), undefined, 'up to date: no item');
});

test('new iPhones, and debugging on the current stable and beta iOS', () => {
  const ios: OSVersionInfo[] = [
    { platform: 'iOS', version: '27.1', releaseDate: '2026-10-06' },
    { platform: 'iOS', version: '27.2 beta 3', releaseDate: '2026-10-13', isBeta: true },
  ];
  const actions = buildiOSActions(ios, toolchain(RELEASES[3], { newestiPhones: [{ name: 'iPhone 18 Pro', releaseDate: '2026-09-18', shipsWithiOS: '27' }] }), null, {}, NOW);
  assert.match(find(actions, /^支援 iPhone 18 Pro$/)!.detail, /出廠搭載 iOS 27\.x（2026-09-18 上市；確切版本以 Apple 公告為準）。需使用 Xcode 27\.1 以上/, 'a major only: the newest stable Xcode of it, not its first');
  assert.match(find(actions, /^在 iOS 27\.1 實機上除錯$/)!.detail, /^需要 Xcode 27\.1 以上/);
  assert.equal(find(actions, /^測試 iOS 27\.2 beta 3$/)!.detail, '請使用 Xcode 27.2 beta 3 以上（需 macOS 26.6 以上）。', 'only a beta has the beta SDK');
});

// ---------- Coverage-based recommendations ----------

test('deployment target from Apple\'s usage share: the previous major\'s cumulative coverage', () => {
  const adoption = {
    measuredAt: '2026-06-07',
    allDevices: [{ name: 'iOS 26', value: 79 }, { name: 'iOS 18', value: 14 }, { name: 'Earlier', value: 7 }],
    recentDevices: [{ name: 'iOS 26', value: 86 }, { name: 'iOS 18', value: 11 }, { name: 'Earlier', value: 3 }],
  };
  const item = find(buildiOSActions([], null, null, { adoption }, NOW), /最低支援版本建議/)!;
  assert.equal(item.title, '最低支援版本建議：iOS 18 以上可涵蓋 93% 裝置');
  assert.equal(item.basis, 'reference');
  assert.match(item.detail, /^只支援 iOS 26 可涵蓋 79% 的裝置；支援到 iOS 18 可涵蓋 93%（近四年推出的裝置為 97%）。資料來源：Apple 官方，統計至 2026 年 6 月 7 日。$/);
  assert.equal(find(buildiOSActions([], null, null, { adoption: { allDevices: [{ name: 'iOS 26', value: 100 }], recentDevices: [] } }, NOW), /最低支援版本建議/), undefined, 'needs two versions');
});

const share = (platform: 'ios' | 'android', tw: Array<[string, number, number?]>, ww?: Array<[string, number]>): OsShare => {
  const cov = (rows: Array<[string, number, number?]>) => ({ byMajor: [], topVersions: [], url: `https://gs.statcounter.com/${platform}`, coverage: rows.map(([min, covered, api]) => ({ min, covered, ...(api ? { api } : {}) })) });
  return { month: '2026-09', ios: {}, android: {}, [platform]: { TW: cov(tw), ...(ww ? { ww: cov(ww) } : {}) } } as OsShare;
};

test('Taiwan coverage: the oldest major still reaching 95% (iOS Deployment Target, Android minSdk with API level)', () => {
  const ios = find(buildiOSActions([], null, null, { osShare: share('ios', [['26', 74], ['18', 94], ['17', 97.6], ['16', 99]], [['17', 95.4]]) }, NOW), /Deployment Target 參考/)!;
  assert.equal(ios.title, 'Deployment Target 參考：iOS 17 以上涵蓋台灣 97.6% 裝置');
  assert.match(ios.detail, /^依 2026-09 台灣行動裝置的版本占比，支援到 iOS 17 可涵蓋 97\.6%（全球 95\.4%）。/);

  const android = find(buildAndroidActions([], null, { osShare: share('android', [['16', 45], ['13', 90], ['12', 95.2, 31]]) }, NOW), /minSdk 參考/)!;
  assert.equal(android.title, 'minSdk 參考：Android 12（API 31）以上涵蓋台灣 95.2% 裝置');

  assert.equal(find(buildiOSActions([], null, null, { osShare: share('ios', [['26', 80], ['18', 90]]) }, NOW), /Deployment Target 參考/), undefined, 'nothing reaches 95%');
});

test('actions are ordered by urgency, keeping their order within a level', () => {
  const actions = buildiOSActions([{ platform: 'iOS', version: '27.1', releaseDate: '2026-10-06' }], toolchain(), appleDeadline('April 28, 2026'), {
    requirements: [req('Soon', '2026-11-01'), req('Later', '2027-03-01'), req('Past', '2026-03-01')],
  }, NOW);
  const rank = { urgent: 0, upcoming: 1, info: 2, ok: 3 } as const;
  const statuses = actions.map(a => rank[a.status]);
  assert.deepEqual(statuses, [...statuses].sort((a, b) => a - b));
  assert.deepEqual(actions.filter(a => a.status === 'upcoming').map(a => a.title), ['預計下一波：要求 iOS 27 SDK', 'Apple 規定：Later'], 'stable within a level');
});

// ---------- Android ----------

const COMPAT: AndroidCompat = {
  agpGradle: [], studioAgp: [],
  apiLevels: [{ api: '37.0', minStudio: 'Panda 3', minAgp: '9.1.1' }, { api: '36', minStudio: 'Meerkat', minAgp: '8.9.1' }],
  kotlin: [{ kotlin: '2.3.0–2.3.20', gradle: ['7.6.3', '9.0'], agp: ['8.2.2', '9.0.0'] }],
  current: { agp: '9.4.1' },
};
const playDeadline = (deadline: string, extensionDate?: string): SubmissionDeadline => ({
  source: 'google', deadline, ...(extensionDate ? { extensionDate } : {}),
  requirements: [
    { platform: 'New apps and app updates', sdk: 'Android 16 (API level 36) or higher' },
    { platform: 'Wear OS and Android Automotive OS', sdk: 'Android 15 (API level 35) or higher' },
    { platform: 'Existing apps', sdk: 'Android 15 (API level 35) or higher' },
  ],
});
const ANDROID: OSVersionInfo[] = [
  { platform: 'Android', version: 'Android 17', apiLevel: '37', releaseDate: '2026-06-16' },
  { platform: 'Android', version: 'Android 18 Beta 1', releaseDate: '2026-10-01', isBeta: true },
];

test('targetSdk before the deadline: urgency by days, the tools it needs, the other device types', () => {
  const [target] = buildAndroidActions(ANDROID, playDeadline('November 15, 2026', 'December 31, 2026'), { compat: COMPAT }, NOW);
  assert.equal(target.title, 'Google Play：新 App 與更新須將 targetSdk 設為 36');
  assert.equal(target.status, 'urgent');
  assert.equal(target.detail, '期限 2026 年 11 月 15 日（剩 29 天），可申請延長至 2026 年 12 月 31 日。需要 AGP 8.9.1 以上、Android Studio Meerkat 以上。其他裝置類型 / 既有 App — Wear OS 與 Android Automotive OS：API 35、既有 App：API 35。'
    + '未達標的既有 App 對新使用者只提供給 Android 版本不高於其 targetSdk 的裝置（已安裝的使用者不受影響）；需要延長請在 Play Console 的延長申請表單提出；僅供內部發布的永久私人 App 不受此限。');
});

test('targetSdk: past the deadline but within the extension stays urgent; after both it is "ok"', () => {
  const extended = buildAndroidActions(ANDROID, playDeadline('August 31, 2026', 'November 1, 2026'), {}, NOW)[0];
  assert.equal(extended.status, 'urgent');
  assert.match(extended.detail, /^原期限 2026 年 8 月 31 日 已過；已申請延長者至 2026 年 11 月 1 日（剩 15 天）。/);
  const done = find(buildAndroidActions(ANDROID, playDeadline('August 31, 2026'), {}, NOW), /targetSdk 設為 36/)!;
  assert.equal(done.status, 'ok');
  assert.match(done.detail, /^自 2026 年 8 月 31 日 起生效。/);
});

test('targetSdk next wave: estimated for the next August, named after the release that has that API level', () => {
  const next = find(buildAndroidActions(ANDROID, playDeadline('August 31, 2026'), { compat: COMPAT }, NOW), /預計下一波/)!;
  assert.equal(next.title, '預計下一波：2027 年 8 月 31 日前 targetSdk 37（Android 17）');
  assert.equal(next.estimated, true);
  assert.match(next.detail, /需要 AGP 9\.1\.1 以上、Android Studio Panda 3 以上。/);
  assert.equal(next.url, 'https://developer.android.com/about/versions/17/behavior-changes-17');
  // Without a release at that API level, the version is API − 20
  assert.match(find(buildAndroidActions([], playDeadline('August 31, 2026'), {}, NOW), /預計下一波/)!.title, /targetSdk 37（Android 17）/);
  // Not while the current deadline is still months away ("upcoming")
  assert.equal(find(buildAndroidActions(ANDROID, playDeadline('August 31, 2027'), {}, NOW), /預計下一波/), undefined);
});

const billing = (title: string, date: string, extensionDate?: string): Deadline => ({ platform: 'Android', date, title, detail: '', source: 'Google', url: 'https://developer.android.com/billing', ...(extensionDate ? { extensionDate } : {}) });

test('Play Billing: the oldest version whose deadline or extension hasn\'t passed', () => {
  const actions = buildAndroidActions([], null, { billing: { latest: '9.1.0', deadlines: [
    billing('Play Billing Library 6 deprecation', '2025-08-31', '2025-11-01'),
    billing('Play Billing Library 7 deprecation', '2026-08-31', '2026-11-01'),
    billing('Play Billing Library 8 deprecation', '2027-08-31'),
  ] } }, NOW);
  const item = find(actions, /Play Billing/)!;
  assert.equal(item.title, 'Play Billing Library 7 以下須升級（最新 9.1.0）');
  assert.equal(item.status, 'urgent');
  assert.match(item.detail, /^原期限 2026 年 8 月 31 日 已過；已申請延長者至 2026 年 11 月 1 日（剩 15 天）。逾期後仍使用 PBL 7 以下/);
});

test('16 KB page size and Play policies: only upcoming dates, policies grouped by date', () => {
  const policy = (title: string, date: string): Deadline => ({ platform: 'Android', date, title, detail: '', source: 'Google', url: `https://play.example/${title}` });
  const actions = buildAndroidActions([], null, {
    pageSize: [billing('16 KB', '2025-11-01'), billing('16 KB', '2027-05-01')],
    policies: [policy('Play 政策：Permissions', '2027-01-27'), policy('Play 政策：Health apps', '2027-01-27'), policy('Play 政策：Old', '2026-01-01')],
  }, NOW);
  assert.deepEqual(actions.filter(a => /16 KB/.test(a.title)).map(a => a.title), ['2027 年 5 月 1 日 起須支援 16 KB 記憶體分頁大小']);
  const policies = find(actions, /Google Play 政策/)!;
  assert.equal(policies.title, '2 項 Google Play 政策將於 2027 年 1 月 27 日 生效');
  assert.match(policies.detail, /^剩 102 天。Permissions；Health apps。/, 'each change named (in brief, with its replacement, when recognised)');
});

test('Kotlin compatibility warning only when AGP or Gradle is newer than the Kotlin release supports', () => {
  const tools = (agp: string, gradle: string) => ({ kotlin: { name: 'Kotlin', version: '2.3.10' }, agpStable: { name: 'AGP', version: agp }, gradle: { name: 'Gradle', version: gradle } });
  const warn = find(buildAndroidActions([], null, { compat: COMPAT, toolchain: tools('9.4.1', '9.0') }, NOW), /相容性注意/)!;
  assert.equal(warn.title, '相容性注意：Kotlin 2.3.10 尚未正式支援 AGP 9.4.1');
  assert.match(warn.detail, /官方支援 AGP 8\.2\.2–9\.0\.0、Gradle 7\.6\.3–9\.0。/);
  assert.equal(find(buildAndroidActions([], null, { compat: COMPAT, toolchain: tools('8.13.0', '8.14') }, NOW), /相容性注意/), undefined);
});

test('Android stable and beta testing items', () => {
  const actions = buildAndroidActions(ANDROID, null, {}, NOW);
  assert.deepEqual(actions.map(a => a.title), ['測試 App 在 Android 17（API 37）上的相容性', '試用 Android 18 Beta 1']);
  assert.equal(actions[0].url, 'https://developer.android.com/about/versions/17/behavior-changes-all');
});

// ---------- Timeline and wording ----------

test('deadline timeline: upcoming soonest first (an extension keeps one upcoming), then the past year newest first', () => {
  const d = (title: string, date: string, extensionDate?: string): Deadline => ({ platform: 'Android', date, title, detail: '', source: 's', url: 'u', ...(extensionDate ? { extensionDate } : {}) });
  const timeline = buildDeadlineTimeline([
    d('far', '2027-08-31'), d('extended', '2026-08-31', '2026-11-01'), d('soon', '2026-11-15'),
    d('recent', '2026-04-28'), d('older', '2026-01-31'), d('too old', '2025-01-31'),
  ], new Date('2026-10-17T12:00:00Z'));
  assert.deepEqual(timeline.map(t => t.title), ['extended', 'soon', 'far', 'recent', 'older']);
});

test('wording helpers: Chinese dates, platforms and SDK descriptions', () => {
  assert.equal(zhDate('April 28, 2026'), '2026 年 4 月 28 日');
  assert.equal(zhDate('not a date'), 'not a date');
  assert.equal(zhPlatform('New apps and app updates'), '新 App 與更新');
  assert.equal(zhPlatform('Phones and tablets'), 'Phones 與 tablets', 'unknown labels pass through');
  assert.equal(zhSdk('Android 16 (API level 36) or higher'), 'Android 16（API 36）或更高');
  assert.equal(zhSdk('Xcode 26 & iOS 26 SDK or later'), 'Xcode 26 與 iOS 26 SDK 或更新版本');
});

test('day counts are Taiwan calendar days: the 05:43 build (21:43 UTC the day before) counts like a Taiwanese reader', () => {
  const morningBuild = new Date('2026-10-16T21:43:00Z'); // 05:43 on October 17 in Taipei
  const lateBuild = new Date('2026-10-17T15:59:00Z'); // 23:59 on October 17 in Taipei
  for (const now of [morningBuild, NOW, lateBuild]) {
    // Both date formats the sources use, 15 days ahead of October 17
    assert.match(buildiOSActions([], toolchain(), appleDeadline('November 1, 2026'), {}, now)[0].detail, /剩 15 天/, now.toISOString());
    const billingItem = find(buildAndroidActions([], null, { billing: { deadlines: [billing('Play Billing Library 7 deprecation', '2026-11-01')] } }, now), /Play Billing/)!;
    assert.match(billingItem.detail, /剩 15 天/, now.toISOString());
  }
  // A deadline that's today in Taipei is "today" at the morning build, not tomorrow
  assert.match(buildiOSActions([], toolchain(), appleDeadline('October 17, 2026'), {}, morningBuild)[0].detail, /就是今天/);
});

test('Play policy changes are summed up with what to use instead, and technical quality items are named as such', () => {
  const policy = (title: string, detail: string, date = '2027-01-27') => ({ platform: 'Android', date, title, detail, source: 's', url: 'https://example.com/' });
  const actions = buildAndroidActions([], null, { policies: [
    policy('Play 政策：Use of SMS or call log permission groups', 'Our SMS and Call Log Permissions policy will no longer permit account verification via phone call as a use case for the READ_CALL_LOG permission. … use the Digital Credentials API instead, … or the SMS Retriever API.'),
    policy('Play 政策：Permissions and APIs that Access Sensitive Information', 'Apps that don\'t need broad access must use the Android Contact Picker.'),
    policy('Play 技術品質：程式碼混淆、最佳化與縮減門檻（R8 或其他工具）', 'Apps and games on Play will need to meet optimization thresholds.', '2027-02-01'),
  ] }, NOW);
  const jan = actions.find(a => /2027 年 1 月 27 日/.test(a.title))!;
  assert.match(jan.detail, /通話紀錄：不再允許用來驗證帳號，改用 Digital Credentials API 或 SMS Retriever API/);
  assert.match(jan.detail, /聯絡人：不需要完整通訊錄的 App 須改用 Android Contact Picker/);
  const feb = actions.find(a => /2027 年 2 月 1 日/.test(a.title))!;
  assert.equal(feb.title, '1 項 Google Play 技術品質要求將於 2027 年 2 月 1 日 生效');
  assert.match(feb.detail, /程式碼混淆、最佳化與縮減門檻（R8 或其他工具）/);
});

test('the billing library action looks only at the library\'s deadlines, not the server API shutdowns in the same list', () => {
  const actions = buildAndroidActions([], null, { billing: { latest: '9.1.0', deadlines: [
    { platform: 'Android', date: '2026-11-10', title: 'Google Play Developer API：已淘汰的訂閱 API 停止服務', detail: 'x', source: 's', url: 'https://example.com/api' },
    { platform: 'Android', date: '2027-08-31', title: 'Play Billing Library 8 停止支援', detail: 'y', source: 's', url: 'https://example.com/pbl' },
  ] } }, NOW);
  const billing = actions.find(a => /Billing Library/.test(a.title))!;
  assert.equal(billing.title, 'Play Billing Library 8 以下須升級（最新 9.1.0）');
});

test('the next target API wave lists what targeting that Android version changes, when the page is for that version', () => {
  const android = [{ platform: 'Android' as const, version: 'Android 17', apiLevel: '37', releaseDate: '2026-06-16' }];
  const deadline = { source: 'google' as const, deadline: 'August 31, 2026', requirements: [{ platform: 'New apps and app updates', sdk: 'Android 16 (API level 36) or higher' }] };
  const changes = { major: '17', changes: ['Static final fields are now unmodifiable', 'OTP protection for standard SMS messages'], url: 'https://developer.android.com/about/versions/17/behavior-changes-17' };
  const next = (bc: typeof changes | null) => buildAndroidActions(android, deadline, { behaviorChanges: bc }, NOW).find(a => /預計下一波/.test(a.title))!;
  assert.match(next(changes).detail, /Android 17 行為變更（2 項）：Static final fields are now unmodifiable、OTP protection for standard SMS messages。$/);
  assert.match(next({ ...changes, major: '18' }).detail, /Android 17 行為變更。$/, 'another version\'s page: not listed');
  assert.match(next(null).detail, /Android 17 行為變更。$/);
});

test('parseBehaviorChanges: the change headings, not code tabs or the footer; too few means the page changed', async () => {
  const { parseBehaviorChanges } = await import('../src/fetchers/behavior-changes.ts');
  const html = '<h2>Core functionality</h2><h3>New lock-free MessageQueue</h3><h3>Kotlin</h3><h3>Java</h3><h3>Static final fields are now unmodifiable</h3><h2>Privacy</h2><h3>OTP protection for standard SMS messages</h3><devsite-footer><h3>More Android</h3></devsite-footer>';
  assert.deepEqual(parseBehaviorChanges(html, '17').changes, ['New lock-free MessageQueue', 'Static final fields are now unmodifiable', 'OTP protection for standard SMS messages']);
  assert.throws(() => parseBehaviorChanges('<h3>Kotlin</h3>', '17'), /only 0 headings/);
});

test('Apple server APIs marked deprecated become info actions with their replacement, never a made-up date', async () => {
  const { parseDeprecation, WATCHED } = await import('../src/fetchers/apple-deprecations.ts');
  const receipts = parseDeprecation({ metadata: { title: 'App Store Receipts', platforms: [{ name: 'App Store Receipts', deprecatedAt: '1.7' }] } }, WATCHED[0])!;
  assert.equal(parseDeprecation({ metadata: { platforms: [{ name: 'x' }] } }, WATCHED[0]), null, 'not marked: nothing');
  assert.throws(() => parseDeprecation({}, WATCHED[0]), /no metadata/);
  const action = buildiOSActions([], null, null, { deprecations: [receipts] }, NOW).find(a => /已被 Apple 標為淘汰/.test(a.title))!;
  assert.equal(action.status, 'info');
  assert.match(action.detail, /自 1\.7 版起.*尚未公布停止服務的日期；伺服器端改用 App Store Server API/);
  assert.equal(action.url, 'https://developer.apple.com/documentation/appstorereceipts');
});

test('a requirement Google dated only by month or year is said so, with no day count; developer verification is named as such', () => {
  const item = (title: string, detail: string, date: string) => ({ platform: 'Android', date, title, detail, source: 's', url: 'https://example.com/' });
  const actions = buildAndroidActions([], null, { policies: [
    item('Play 技術品質：記憶體用量門檻', 'Apps … thresholds.（Google 只公布月份：2027 年 2 月起）', '2027-02-01'),
    item('Android 開發者驗證：擴大到全球所有認證 Android 裝置', 'Following … in 2027.（Google 只公布年份：2027 年，最早可能在年初）', '2027-01-01'),
  ] }, NOW);
  const feb = actions.find(a => /2027 年 2 月/.test(a.title))!;
  assert.equal(feb.title, '1 項 Google Play 技術品質要求將自 2027 年 2 月起生效');
  assert.match(feb.detail, /^Google 只公布月份，確切日期未定。/);
  assert.doesNotMatch(feb.detail, /剩 \d+ 天/);
  const year = actions.find(a => /開發者驗證/.test(a.title))!;
  assert.equal(year.title, '1 項 Android 開發者驗證將於 2027 年內生效');
  assert.match(year.detail, /^Google 只公布年份/);
});

test('an SDK minimum announced by month only: the month, no countdown, and pending until the month is over', () => {
  const monthOnly = { ...appleDeadline('April 1, 2027', 'iOS 27 & iPadOS 27 SDK or later'), datePrecision: 'month' as const };
  const [req] = buildiOSActions([], toolchain(), monthOnly, {}, NOW);
  assert.equal(req.title, '上架 App Store 必須使用 iOS 27 SDK 建置');
  assert.match(req.detail, /^2027 年 4 月起生效（Apple 只公布月份，確切日期未定）。請升級至 Xcode 27\.0 以上/);
  assert.doesNotMatch(req.detail, /剩 \d+ 天/);
  assert.equal(req.dueDate, '2027-04-01', 'due from the month\'s first day (待處理 counts from it)');
  const midMonth = buildiOSActions([], toolchain(), monthOnly, {}, new Date('2027-04-15T04:00:00Z'))[0];
  assert.equal(midMonth.status, 'urgent', 'still ahead on April 15th: Apple named no day');
  assert.equal(buildiOSActions([], toolchain(), monthOnly, {}, new Date('2027-05-02T04:00:00Z'))[0].status, 'ok');
});

test('policy changes dated by year and by month on the same first day: grouped apart, urgency by the period\'s end', () => {
  const policy = (detail: string, title = 'Play 政策：X') => ({ platform: 'Android' as const, date: '2027-01-01', title, detail, source: 'Google Play Policy Deadlines', url: 'https://support.google.com/a' });
  const policies = [
    policy('Expanding globally in 2027.（Google 只公布年份：2027 年，最早可能在年初）', 'Android 開發者驗證：擴大到全球所有認證 Android 裝置'),
    policy('From January 2027, apps need to do Y.（Google 只公布月份：2027 年 1 月起）', 'Play 技術品質：Y'),
  ];
  const at = new Date('2026-12-01T04:00:00Z');
  const actions = buildAndroidActions([], null, { policies }, at);
  const year = find(actions, /於 2027 年內生效/)!;
  const month = find(actions, /自 2027 年 1 月起生效/)!;
  assert.match(year.title, /^1 項 Android 開發者驗證/);
  assert.match(month.title, /^1 項 Google Play 技術品質要求/);
  assert.equal(year.status, 'upcoming', 'a whole year ahead is not urgent a month before it starts');
  assert.equal(month.status, 'urgent');
});

test('zhPlatform / zhSdk: existing apps of other device types, and a minimum given by API level only', async () => {
  const { zhPlatform, zhSdk } = await import('../src/insights.ts');
  assert.equal(zhPlatform('Existing Wear OS, Android TV, Android XR apps'), '既有 Wear OS、Android TV、Android XR App');
  assert.equal(zhPlatform('Existing apps'), '既有 App');
  assert.equal(zhSdk('API level 32 or higher'), 'API 32 或更高');
});

test('an earlier target API deadline still in its extension window when the next is posted: its own urgent action', () => {
  const next: SubmissionDeadline = {
    source: 'google', deadline: 'August 31, 2027',
    requirements: [{ platform: 'New apps and app updates', sdk: 'Android 17 (API level 37) or higher' }],
    earlier: [playDeadline('August 31, 2026', 'November 1, 2026')],
  };
  const actions = buildAndroidActions([], next, {}, NOW);
  assert.ok(find(actions, /targetSdk 設為 37/), 'the newer deadline is still the main one');
  const prior = find(actions, /targetSdk 36 的延長期即將結束/)!;
  assert.equal(prior.status, 'urgent');
  assert.match(prior.detail, /^原期限 2026 年 8 月 31 日 已過；已申請延長者至 2026 年 11 月 1 日/);
  assert.equal(find(buildAndroidActions([], next, {}, new Date('2026-11-05T04:00:00Z')), /延長期即將結束/), undefined, 'gone once the extension is over');
});

test('Apple requirements: a month-only date as the month, an expiry as 到期, a passed "by" deadline dropped', () => {
  const req = (date: string, title: string, detail: string) => ({ platform: 'iOS' as const, date, title, detail, source: 'S', url: 'https://developer.apple.com/news/' });
  const actions = buildiOSActions([], toolchain(), null, { requirements: [
    req('2027-04-01', 'App Store Connect：screenshots', 'Any apps will need to include screenshots.（Apple 只公布月份：2027 年 4 月起）'),
    req('2027-02-01', 'Apple Developer News：macOS：Upcoming expiration of Developer ID', 'The Sub-CA expires on February 1, 2027.'),
    req('2026-01-31', 'Age Rating Updates', 'Provide responses to the updated questions by January 31, 2026.'),
  ] }, NOW);
  const month = find(actions, /screenshots/)!;
  assert.match(month.detail, /^2027 年 4 月起生效（Apple 只公布月份，確切日期未定）/);
  const expiry = find(actions, /Developer ID/)!;
  assert.equal(expiry.title, 'Apple 規定：macOS：Upcoming expiration of Developer ID');
  assert.match(expiry.detail, /^2027 年 2 月 1 日 到期（剩 \d+ 天）/);
  assert.equal(find(actions, /Age Rating/), undefined, 'a response deadline already past asks nothing more');
  const midApril = buildiOSActions([], toolchain(), null, { requirements: [req('2027-04-01', 'App Store Connect：screenshots', 'x（Apple 只公布月份：2027 年 4 月起）')] }, new Date('2027-04-15T04:00:00Z'));
  assert.equal(find(midApril, /screenshots/)!.status, 'urgent', 'still ahead within the month');
});
