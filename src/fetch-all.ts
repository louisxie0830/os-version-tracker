import { reportDataQuality, reportSourceStatus } from './alerts.js';
import { bankFieldGaps, countProblems } from './quality.js';
import { lastGood, rememberGood, saveLastGood } from './last-good.js';
import { publishDecision } from './publish-health.js';
import { fetchiOSVersions } from './fetchers/ios.js';
import { fetchAndroidVersions } from './fetchers/android.js';
import { fetchAppleSubmissionDeadline } from './fetchers/apple-deadline.js';
import { fetchGooglePlayDeadline } from './fetchers/google-deadline.js';
import { fetchiOSToolchain } from './fetchers/ios-toolchain.js';
import { compareVersions } from './versions.js';
import { calendarDate } from './taipei-date.js';
import { monthOnlyNote, submissionDay } from './deadline-dates.js';
import { fetchAndroidToolchain } from './fetchers/android-toolchain.js';
import { fetchAppleNews, fetchAndroidNews, findAnnouncedDevices } from './fetchers/news.js';
import { beginFeedScope } from './fetchers/feed.js';
import { fetchiOSAdoption } from './fetchers/ios-adoption.js';
import {
  AGP_COMPAT_URL,
  fetchAndroidCompat,
  fetchXcodeSupport,
  XCODE_SUPPORT_URL,
} from './fetchers/compat.js';
import {
  APPLE_REQUIREMENTS_URL,
  fetchAppleRequirements,
  fetchPageSizeDeadlines,
  fetchPlayBilling,
  fetchPlayPolicyDeadlines,
  PAGE_SIZE_URL,
  PLAY_BILLING_URL,
  PLAY_POLICY_URL,
} from './fetchers/requirements.js';
import { fetchCiImages, RUNNER_IMAGES_REPO_URL, type CiImages } from './fetchers/ci-images.js';
import { AGP_PAST_RELEASES_URL, fetchAgpJdk, type AgpJdkRequirement } from './fetchers/agp-jdk.js';
import { fetchPrivacyCompliance, THIRD_PARTY_SDK_URL, type PrivacyCompliance } from './fetchers/privacy.js';
import { fetchCrashReport, type CrashReport } from './fetchers/crashes.js';
import { fetchOsShare, STATCOUNTER_URL, type OsShare } from './fetchers/os-share.js';
import { fetchDevNews, type DevNewsItem } from './fetchers/dev-news.js';
import { fetchCordovaReleases, type CordovaReleases } from './fetchers/cordova.js';
import { APPLE_SECURITY_URL, fetchSecurityReport, type SecurityReport } from './fetchers/security.js';
import { DEVELOPER_STATUS_PAGE, fetchDeveloperStatus, type DeveloperStatus } from './fetchers/apple-status.js';
import { fetchFrameworks, type Frameworks } from './fetchers/frameworks.js';
import { fetchSdkReleases, FIREBASE_APPLE_NOTES_URL } from './fetchers/sdk-releases.js';
import { fetchBehaviorChanges } from './fetchers/behavior-changes.js';
import { fetchAppleDeprecations } from './fetchers/apple-deprecations.js';
import { fetchTaiwanBankApps, TW_BANK_APPS, type TaiwanBankApp } from './fetchers/tw-banks.js';
import { bankSnapshots, coreVersionProblems, recordBankVersions, type BankChange, type BankSnapshot } from './history.js';
import { anonymizeAppStoreUrl, maskName } from './mask.js';
import { createRefreshCache } from './refresh-cache.js';
import { safeUrl } from './safe-url.js';
import { buildAndroidActions, buildDeadlineTimeline, buildiOSActions, zhPlatform, zhSdk } from './insights.js';
import { deferNotifications, notifyWebhook, prunableWhen, recentItems, recordItems, toTrackedItems, type TrackedItem } from './changes.js';
import type {
  ActionItem,
  AndroidCompat,
  AndroidToolchain,
  AnnouncedDevice,
  Deadline,
  iOSAdoption,
  iOSToolchain,
  NewsItem,
  OSVersionInfo,
  SourceInfo,
  SubmissionDeadline,
  XcodeRelease,
  XcodeSupportRow,
} from './types.js';

export interface AllVersions {
  ios: OSVersionInfo[];
  android: OSVersionInfo[];
  appleDeadline: SubmissionDeadline | null;
  googleDeadline: SubmissionDeadline | null;
  iosToolchain: Omit<iOSToolchain, 'releases' | 'knowniPhones'> | null;
  androidToolchain: AndroidToolchain | null;
  iosActions: ActionItem[];
  androidActions: ActionItem[];
  iosAdoption: iOSAdoption | null;
  appleNews: NewsItem[];
  androidNews: NewsItem[];
  announcedDevices: AnnouncedDevice[];
  androidCompat: AndroidCompat | null;
  xcodeSupport: XcodeSupportRow[];
  timeline: Deadline[];
  /** Deadlines, important news and new devices with when this server first saw them */
  tracked: TrackedItem[];
  /** Tracked items that are new within the last 7 days */
  recent: TrackedItem[];
  ciImages: CiImages | null;
  agpJdk: AgpJdkRequirement[];
  privacy: PrivacyCompliance | null;
  crashes: CrashReport | null;
  osShare: OsShare | null;
  twBanks: TaiwanBankApp[];
  /** Minimum-version changes of the bank apps over the last year, newest first */
  bankChanges: BankChange[];
  /** Daily distribution of the bank apps' minimum versions, oldest first (accumulates from the first build) */
  bankTrend: BankSnapshot[];
  devNews: DevNewsItem[];
  cordova: CordovaReleases | null;
  security: SecurityReport | null;
  /** Apple developer services: recent and ongoing incidents (absent in older snapshots) */
  appleStatus?: DeveloperStatus | null;
  /** React Native and Flutter releases (absent in older snapshots) */
  frameworks?: Frameworks | null;
  sources: Record<SourceKey, SourceInfo>;
  cachedAt: string;
}

const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

/** Why each source failed, what came back incomplete and how many items the list sources returned (not published) */
export interface RefreshDiagnostics {
  errors: Partial<Record<SourceKey, string>>;
  quality: Partial<Record<SourceKey, string[]>>;
  counts: Partial<Record<SourceKey, Record<string, number>>>;
}

let diagnostics: RefreshDiagnostics = { errors: {}, quality: {}, counts: {} };

/** Diagnostics from the most recent refresh (the static build prints them in the Actions run summary) */
export function lastRefreshDiagnostics(): RefreshDiagnostics {
  return diagnostics;
}

const DEFAULT_SITE_URL = 'https://louisxie0830.github.io/os-version-tracker';
export const SITE_URL = (safeUrl(process.env.SITE_URL ?? DEFAULT_SITE_URL) ?? (() => {
  console.warn(`[config] SITE_URL "${process.env.SITE_URL}" is not an http(s) URL; using ${DEFAULT_SITE_URL}`);
  return DEFAULT_SITE_URL;
})()).replace(/\/$/, '');

export const SOURCES = {
  ios: { label: 'Apple 軟體更新目錄 / Developer Releases', url: 'https://developer.apple.com/news/releases/' },
  android: { label: 'endoflife.date · Android Developers Blog', url: 'https://endoflife.date/android' },
  appleDeadline: { label: 'Apple Developer News', url: 'https://developer.apple.com/news/' },
  googleDeadline: { label: 'Google Play 目標 API 等級規定', url: 'https://developer.android.com/google/play/requirements/target-sdk' },
  iosToolchain: { label: 'xcodereleases.com · endoflife.date', url: 'https://xcodereleases.com' },
  androidToolchain: { label: 'Google Maven · Gradle · Android SDK repository', url: 'https://developer.android.com/studio/releases' },
  adoption: { label: 'Apple App Store 使用率', url: 'https://developer.apple.com/support/app-store/' },
  appleNews: { label: 'Apple Developer News', url: 'https://developer.apple.com/news/' },
  androidNews: { label: 'Android Developers Blog', url: 'https://developer.android.com/blog/' },
  androidCompat: { label: 'AGP 相容性 · Kotlin Gradle plugin 相容性', url: AGP_COMPAT_URL },
  xcodeSupport: { label: 'Apple Xcode 支援表', url: XCODE_SUPPORT_URL },
  appleRequirements: { label: 'Apple Upcoming Requirements', url: APPLE_REQUIREMENTS_URL },
  playPolicy: { label: 'Google Play 政策期限', url: PLAY_POLICY_URL },
  playBilling: { label: 'Play Billing Library 淘汰時程', url: PLAY_BILLING_URL },
  pageSize: { label: 'Android 16 KB 分頁大小指南', url: PAGE_SIZE_URL },
  ciImages: { label: 'GitHub Actions runner images · Xcode Cloud', url: RUNNER_IMAGES_REPO_URL },
  agpJdk: { label: 'AGP 各版本 release notes', url: AGP_PAST_RELEASES_URL },
  privacy: { label: 'Apple 隱私清單與第三方 SDK 規定', url: THIRD_PARTY_SDK_URL },
  osShare: { label: 'StatCounter Global Stats（台灣、全球）', url: STATCOUNTER_URL },
  twBanks: { label: 'App Store / Google Play（台灣區）', url: 'https://apps.apple.com/tw/' },
  devNews: { label: 'Apple / Android / Swift / Kotlin / Firebase / Cordova 官方 feed', url: 'https://developer.apple.com/news/' },
  crashes: { label: 'Apple / Android release notes · GitHub SDK 與 Cordova issues', url: 'https://developer.apple.com/documentation/ios-ipados-release-notes' },
  cordova: { label: 'npm registry · Apache Cordova RELEASENOTES.md', url: 'https://github.com/apache/cordova-ios/blob/master/RELEASENOTES.md' },
  security: { label: 'Apple 安全性更新 · Android 安全性公告 · CISA KEV · GitHub Advisory Database', url: APPLE_SECURITY_URL },
  appleStatus: { label: 'Apple Developer System Status', url: DEVELOPER_STATUS_PAGE },
  frameworks: { label: 'GitHub react/react-native releases · Flutter release index', url: 'https://github.com/react/react-native/releases' },
  sdkReleases: { label: 'Firebase（Apple / Android）與 Google Play services 版本說明', url: FIREBASE_APPLE_NOTES_URL },
  behaviorChanges: { label: 'Android 行為變更（以新版本為目標的 App）', url: 'https://developer.android.com/about/versions' },
  appleDeprecations: { label: 'Apple 文件的淘汰標記（收據驗證、伺服器通知）', url: 'https://developer.apple.com/documentation/appstorereceipts' },
} as const;

export type SourceKey = keyof typeof SOURCES;

/**
 * xcodereleases.com sometimes lags on a release's SDK (e.g. lists 27.0 for Xcode 27.1 RC);
 * Apple's own support table is authoritative, so prefer its SDK version when both know the release.
 */
function correctXcodeSdks(releases: XcodeRelease[], support: XcodeSupportRow[]): void {
  for (const row of support) {
    const version = row.xcode.match(/^[\d.]+/)?.[0];
    const isBeta = /beta|RC/i.test(row.xcode);
    if (!version || !row.iosSdk) continue;
    for (const r of releases) {
      if (r.isBeta === isBeta && compareVersions(r.version, version) === 0) {
        r.iosSdk = row.iosSdk;
      }
    }
  }
}

/** Cached for CACHE_TTL_MS; concurrent callers share one in-flight refresh */
const versionsCache = createRefreshCache(() => refreshAllVersions(), CACHE_TTL_MS);

export function fetchAllVersions(): Promise<AllVersions> {
  return versionsCache.get();
}

/** The cached data, if any, without fetching (for health checks) */
export function peekAllVersions(): { value: AllVersions; fetchedAt: number } | undefined {
  return versionsCache.peek();
}

/** Every source of a refresh; crashes runs last, with the core versions the others found */
const FETCHERS = {
  ios: () => fetchiOSVersions(),
  android: () => fetchAndroidVersions(),
  appleDeadline: () => fetchAppleSubmissionDeadline(),
  googleDeadline: () => fetchGooglePlayDeadline(),
  iosToolchain: () => fetchiOSToolchain(),
  androidToolchain: () => fetchAndroidToolchain(),
  adoption: () => fetchiOSAdoption(),
  appleNews: () => fetchAppleNews(),
  androidNews: () => fetchAndroidNews(),
  androidCompat: () => fetchAndroidCompat(),
  xcodeSupport: () => fetchXcodeSupport(),
  appleRequirements: () => fetchAppleRequirements(),
  playPolicy: () => fetchPlayPolicyDeadlines(),
  playBilling: () => fetchPlayBilling(),
  pageSize: () => fetchPageSizeDeadlines(),
  ciImages: () => fetchCiImages(),
  agpJdk: () => fetchAgpJdk(),
  privacy: () => fetchPrivacyCompliance(),
  osShare: () => fetchOsShare(),
  twBanks: () => fetchTaiwanBankApps(),
  devNews: () => fetchDevNews(),
  cordova: () => fetchCordovaReleases(),
  security: () => fetchSecurityReport(),
  appleStatus: () => fetchDeveloperStatus(),
  frameworks: () => fetchFrameworks(),
  sdkReleases: () => fetchSdkReleases(),
  behaviorChanges: (major: string | undefined) => fetchBehaviorChanges(major),
  appleDeprecations: () => fetchAppleDeprecations(),
  crashes: (context: Parameters<typeof fetchCrashReport>[0]) => fetchCrashReport(context),
} satisfies Record<SourceKey, (...args: never[]) => Promise<unknown>>;

/**
 * What a refresh reads from and writes to outside its own data: the sources, the clock, source and quality
 * alerts, the bank / version history, tracked items and their notifications, and the feed download scope.
 * Production uses these; tests pass their own, so a whole refresh runs without network or state files.
 */
export const REFRESH_DEPS = {
  fetchers: FETCHERS,
  now: (): Date => new Date(),
  reportSourceStatus,
  reportDataQuality,
  coreVersionProblems,
  recordBankVersions,
  bankSnapshots,
  recordItems,
  notifyWebhook,
  deferNotifications,
  beginFeedScope,
  lastGood,
  rememberGood,
  saveLastGood,
  /** Whether this refresh will be seen (the static build's publish gate; the server shows every refresh) */
  willPublish: (sources: Record<SourceKey, SourceInfo>): boolean => publishDecision(sources).publish,
  /**
   * The most one source may take, retries and queueing for a connection included. The bank apps read 28 Play
   * pages two at a time (each with a fallback URL), so they get longer
   */
  sourceDeadlineMs: (key: SourceKey): number => (key === 'twBanks' ? 360_000 : 180_000),
};
export type RefreshDeps = typeof REFRESH_DEPS;

/**
 * One refresh of every source. It shares each feed download between the sections that read it, and only
 * within the refresh. `deps` replaces any of REFRESH_DEPS (fetchers individually).
 */
export async function refreshAllVersions(deps: Partial<Omit<RefreshDeps, 'fetchers'>> & { fetchers?: Partial<RefreshDeps['fetchers']> } = {}): Promise<AllVersions> {
  const all: RefreshDeps = { ...REFRESH_DEPS, ...deps, fetchers: { ...REFRESH_DEPS.fetchers, ...deps.fetchers } };
  const endFeedScope = all.beginFeedScope();
  try {
    return await refreshSources(all);
  } finally {
    endFeedScope();
  }
}

async function refreshSources(deps: RefreshDeps): Promise<AllVersions> {
  const { fetchers: f, now, reportSourceStatus, reportDataQuality } = deps;
  const sources = {} as Record<SourceKey, SourceInfo>;
  const run: RefreshDiagnostics = { errors: {}, quality: {}, counts: {} };
  diagnostics = run;
  // This refresh's results, remembered as each source's last good one at the end if every check passed
  const fresh = new Map<SourceKey, unknown>();
  /**
   * The source failed or its result can't be trusted: its last good result (marked stale) when there is
   * a recent one, otherwise `fallback` (an empty section)
   */
  function fail<T>(key: SourceKey, message: string, fallback: T): T {
    run.errors[key] = message;
    fresh.delete(key);
    // A saved result of another kind than this source returns (a list for a list, an object for an object) is
    // from an older build: not used
    const saved = deps.lastGood<T>(key, now());
    const previous = saved && Array.isArray(saved.value) === Array.isArray(fallback) && (fallback === null || typeof saved.value === typeof fallback || Array.isArray(fallback)) ? saved : undefined;
    sources[key] = { ...SOURCES[key], fetchedAt: now().toISOString(), ok: false, ...(previous ? { staleFrom: previous.fetchedAt } : {}) };
    if (previous) run.errors[key] = `${message}（沿用 ${previous.fetchedAt.slice(0, 16).replace('T', ' ')} UTC 的資料）`;
    return previous ? previous.value : fallback;
  }
  async function track<T>(key: SourceKey, task: () => Promise<T>, fallback: T): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      // Each request has its own timeout, but one source makes many (a queue of them behind the per-site
      // connection limit), so the whole source also has a deadline: one slow source can't hold up the refresh
      const value = await Promise.race([
        task(),
        new Promise<never>((_, reject) => {
          const limit = deps.sourceDeadlineMs(key);
          timer = setTimeout(() => reject(new Error(`gave up after ${Math.round(limit / 1000)}s`)), limit);
        }),
      ]);
      sources[key] = { ...SOURCES[key], fetchedAt: now().toISOString(), ok: true };
      fresh.set(key, value);
      void reportSourceStatus(key, true);
      return value;
    } catch (err) {
      // reportSourceStatus logs the failure and alerts the webhook on the first failure of a streak
      const message = String((err as Error)?.message ?? err);
      void reportSourceStatus(key, false, message);
      return fail(key, message, fallback);
    } finally {
      clearTimeout(timer);
    }
  }

  let [
    ios, android, appleDeadline, googleDeadline, iosToolchain, androidToolchain, iosAdoption,
    appleNews, androidNews, androidCompat, xcodeSupport, appleRequirements, playPolicy, playBilling, pageSize,
    ciImages, agpJdk, privacy, osShare, twBanks, devNews, cordova, security, appleStatus, frameworks, sdkReleases, appleDeprecations,
  ] = await Promise.all([
    track('ios', f.ios, []),
    track('android', f.android, []),
    track('appleDeadline', f.appleDeadline, null),
    track('googleDeadline', f.googleDeadline, null),
    track('iosToolchain', f.iosToolchain, null),
    track('androidToolchain', f.androidToolchain, null),
    track('adoption', f.adoption, null),
    track('appleNews', f.appleNews, []),
    track('androidNews', f.androidNews, []),
    track('androidCompat', f.androidCompat, null),
    track('xcodeSupport', f.xcodeSupport, []),
    track('appleRequirements', f.appleRequirements, []),
    track('playPolicy', f.playPolicy, []),
    track('playBilling', f.playBilling, { deadlines: [], latest: undefined }),
    track('pageSize', f.pageSize, []),
    track('ciImages', f.ciImages, null),
    track('agpJdk', f.agpJdk, []),
    track('privacy', f.privacy, null),
    track('osShare', f.osShare, null),
    track('twBanks', f.twBanks, []),
    track('devNews', f.devNews, []),
    track('cordova', f.cordova, null),
    track('security', f.security, null),
    track('appleStatus', f.appleStatus, null),
    track('frameworks', f.frameworks, null),
    track('sdkReleases', f.sdkReleases, []),
    track('appleDeprecations', f.appleDeprecations, []),
  ]);

  // Versions everything else is derived from: a source that suddenly reports an implausible or older
  // version is treated as failing (ios / android then block publishing; a toolchain is left out)
  const problems = deps.coreVersionProblems({
    iosStable: ios.find(v => !v.isBeta)?.version,
    androidStable: android.find(v => !v.isBeta)?.version.replace(/^Android\s*/i, ''),
    xcodeStable: iosToolchain?.xcodeStable?.version,
    agpStable: androidToolchain?.agpStable?.version,
  // These must be there when their source succeeded (AGP may be missing alone: the toolchain is several sources)
  }, (['iosStable', 'androidStable', 'xcodeStable'] as const).filter(f => sources[({ iosStable: 'ios', androidStable: 'android', xcodeStable: 'iosToolchain' } as const)[f]]?.ok));
  for (const { source, message } of problems) {
    const key = source as SourceKey;
    void reportSourceStatus(key, false, message);
    if (key === 'ios') ios = fail(key, message, ios);
    if (key === 'android') android = fail(key, message, android);
    if (key === 'iosToolchain') iosToolchain = fail(key, message, null);
    if (key === 'androidToolchain') androidToolchain = fail(key, message, null);
  }

  // What targeting the newest Android changes (the next Play target API requirement brings exactly this)
  const behaviorChanges = await track('behaviorChanges', () => f.behaviorChanges(android.find(v => !v.isBeta)?.version.match(/\d+/)?.[0]), null);

  // Crash notes depend on which OS / Xcode versions are current
  let crashes = await track('crashes', () => f.crashes({
    iosMajor: ios.find(v => !v.isBeta)?.version.match(/^\d+/)?.[0],
    androidMajor: android.find(v => !v.isBeta)?.version.match(/\d+/)?.[0],
    xcodeNotesUrl: iosToolchain?.xcodeStable?.notesUrl,
  }), null);

  // A list that suddenly came back with far fewer items than usual: a parser that half broke without throwing.
  // Checked before anything is derived from it, so its last good result (if any) can stand in everywhere
  run.counts = {
    // The app list is fixed: what can shrink is how many each store answered for
    twBanks: { 'twBanks.apps': twBanks.length, 'twBanks.ios': twBanks.filter(b => b.ios).length, 'twBanks.android': twBanks.filter(b => b.android).length },
    devNews: { 'devNews.items': devNews.length },
    appleNews: { 'appleNews.items': appleNews.length },
    androidNews: { 'androidNews.items': androidNews.length },
    xcodeSupport: { 'xcodeSupport.rows': xcodeSupport.length },
    appleRequirements: { 'appleRequirements.items': appleRequirements.length },
    playPolicy: { 'playPolicy.items': playPolicy.length },
    agpJdk: { 'agpJdk.lines': agpJdk.length },
    security: security ? {
      'security.appleReleases': security.apple.length,
      'security.androidBulletins': security.android.length,
      'security.exploited': security.exploited.length,
      'security.advisories': security.advisories.length,
    } : {},
    crashes: crashes ? { 'crashes.items': crashes.ios.length + crashes.android.length + crashes.sdks.length + crashes.community.length + crashes.cordova.length } : {},
    privacy: privacy ? { 'privacy.requiredReasonApis': privacy.appleRequiredReasonApis.length, 'privacy.sdks': privacy.appleSdksRequiringManifest.length } : {},
    cordova: cordova ? { 'cordova.packages': cordova.platforms.length + cordova.plugins.length } : {},
    ciImages: ciImages ? { 'ciImages.githubRunners': ciImages.githubActions.length } : {},
  };
  const quality = countProblems(key => sources[key]?.ok === true, run.counts);
  const shrunk = (key: SourceKey) => !!quality.get(key)?.length && !!deps.lastGood(key, now());
  // The quality alert below still reports the drop; the page shows the previous, complete list meanwhile
  const stale = <T>(key: SourceKey, value: T): T => (shrunk(key) ? fail(key, quality.get(key)!.join('；'), value) : value);
  twBanks = stale('twBanks', twBanks);
  devNews = stale('devNews', devNews);
  appleNews = stale('appleNews', appleNews);
  androidNews = stale('androidNews', androidNews);
  xcodeSupport = stale('xcodeSupport', xcodeSupport);
  appleRequirements = stale('appleRequirements', appleRequirements);
  playPolicy = stale('playPolicy', playPolicy);
  agpJdk = stale('agpJdk', agpJdk);
  security = stale('security', security);
  crashes = stale('crashes', crashes);
  privacy = stale('privacy', privacy);
  cordova = stale('cordova', cordova);
  ciImages = stale('ciImages', ciImages);

  if (iosToolchain) {
    correctXcodeSdks(iosToolchain.releases, xcodeSupport);
  }

  const announcedDevices = iosToolchain?.knowniPhones.length
    ? findAnnouncedDevices(appleNews, iosToolchain.knowniPhones)
    : [];

  const allDeadlines: Deadline[] = [...appleRequirements, ...playPolicy, ...playBilling.deadlines, ...pageSize, ...sdkReleases];
  // Google's target API deadline, and an earlier one still on the page (its extension may still be open)
  for (const play of googleDeadline ? [googleDeadline, ...(googleDeadline.earlier ?? [])] : []) {
    const targetSdk = play.requirements.find(r => /new apps/i.test(r.platform)) ?? play.requirements[0];
    // The calendar day as written: a Date's local getters would turn it into the day before west of UTC
    const targetDate = calendarDate(play.deadline);
    if (!targetSdk || !targetDate) continue;
    allDeadlines.push({
      platform: 'Android',
      date: targetDate,
      title: `Google Play 目標 API 等級：${zhSdk(targetSdk.sdk)}`,
      detail: play.requirements.map(r => `${zhPlatform(r.platform)}：${zhSdk(r.sdk)}`).join('；'),
      source: SOURCES.googleDeadline.label,
      url: SOURCES.googleDeadline.url,
      extensionDate: play.extensionDate ? calendarDate(play.extensionDate) ?? undefined : undefined,
    });
  }

  // Apple's SDK minimum, until the Upcoming Requirements page lists it too (that page only names a day once
  // Apple has one; the news post may give just the month)
  const appleDay = appleDeadline ? submissionDay(appleDeadline) : null;
  if (appleDeadline && appleDay && !appleRequirements.some(r => r.date.slice(0, 7) === appleDay.date.slice(0, 7) && /\bSDK\b/.test(`${r.title} ${r.detail}`))) {
    allDeadlines.push({
      platform: 'iOS',
      date: appleDay.date,
      title: 'App Store 最低 SDK 要求',
      detail: `上傳至 App Store Connect 的 App 必須以下列 SDK 建置：${appleDeadline.requirements.map(r => `${zhPlatform(r.platform)}：${zhSdk(r.sdk)}`).join('；')}${appleDay.detail ? monthOnlyNote('Apple', appleDay.date) : ''}${/^\d{4}-\d{2}-\d{2}$/.test(appleDeadline.announcedAt ?? '') ? `（${appleDeadline.announcedAt} 公告）` : ''}`,
      source: SOURCES.appleDeadline.label,
      // The post that announced it, else Apple's news page
      url: appleDeadline.url ?? SOURCES.appleDeadline.url,
    });
  }

  const timeline = buildDeadlineTimeline(allDeadlines);

  // Sources that worked but came back with holes: far fewer items than usual (above), a field missing for some apps
  if (sources.twBanks?.ok) quality.set('twBanks', [...bankFieldGaps(TW_BANK_APPS, twBanks), ...(quality.get('twBanks') ?? [])]);
  for (const [source, problems] of quality) {
    if (problems.length) run.quality[source] = problems;
    void reportDataQuality(source, problems);
  }

  // Bank and app names are partially masked everywhere they're published (page, api.json and state)
  const maskedBanks = twBanks.map(b => ({
    ...b,
    bank: maskName(b.bank),
    app: maskName(b.app),
    ios: b.ios && { ...b.ios, url: anonymizeAppStoreUrl(b.ios.url) },
  }));
  // An empty list means the source failed this time: don't let it look like every app went away
  // Each app's identity from the configured list it was fetched from, in the same order
  const bankKeys = maskedBanks.length === TW_BANK_APPS.length
    ? TW_BANK_APPS.map(e => (e.appStoreId ? `ios:${e.appStoreId}` : `play:${e.playPackage}`))
    : undefined;
  const bankChanges = maskedBanks.length ? deps.recordBankVersions(maskedBanks, now(), bankKeys) : [];
  const { items: tracked, added } = deps.recordItems(toTrackedItems({ deadlines: timeline, appleNews, androidNews, devices: announcedDevices, crashes: [...(crashes?.sdks ?? []), ...(crashes?.cordova ?? [])], devNews, security, bankChanges, appleStatus }), now(), { prune: prunableWhen(key => sources[key as SourceKey]?.ok === true) });
  // Announce new items only with a refresh that will be published: otherwise a notification could point at a
  // page that still shows the old data. Held back, they go out with the next published refresh
  if (deps.willPublish(sources)) void deps.notifyWebhook(added, SITE_URL);
  else deps.deferNotifications(added);

  // Every source that passed all checks is the new last good result for next time
  for (const [key, value] of fresh) if (sources[key]?.ok) deps.rememberGood(key, value, now());
  deps.saveLastGood();

  return {
    ios,
    android,
    appleDeadline,
    googleDeadline,
    // The full Xcode history and model list are only needed to derive requirements, not to serve
    iosToolchain: iosToolchain
      ? { xcodeStable: iosToolchain.xcodeStable, xcodeBeta: iosToolchain.xcodeBeta, newestiPhones: iosToolchain.newestiPhones }
      : null,
    androidToolchain,
    iosActions: buildiOSActions(ios, iosToolchain, appleDeadline, {
      adoption: iosAdoption,
      osShare,
      xcodeSupport,
      requirements: appleRequirements,
      announcedDevices,
      ciRunners: ciImages?.githubActions ?? [],
      deprecations: appleDeprecations,
    }),
    androidActions: buildAndroidActions(android, googleDeadline, {
      osShare,
      toolchain: androidToolchain,
      compat: androidCompat,
      billing: playBilling,
      policies: playPolicy,
      pageSize,
      behaviorChanges,
    }),
    iosAdoption,
    appleNews: appleNews.slice(0, 6),
    androidNews: androidNews.slice(0, 6),
    announcedDevices,
    androidCompat,
    xcodeSupport,
    timeline,
    tracked,
    recent: recentItems(tracked, 7, now()),
    ciImages,
    agpJdk,
    privacy,
    crashes,
    osShare,
    devNews,
    cordova,
    security,
    appleStatus,
    frameworks,
    twBanks: maskedBanks,
    bankChanges,
    bankTrend: deps.bankSnapshots(),
    sources,
    cachedAt: now().toISOString(),
  };
}
