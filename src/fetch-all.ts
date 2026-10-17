import { reportDataQuality, reportSourceStatus } from './alerts.js';
import { dataQualityProblems } from './quality.js';
import { fetchiOSVersions } from './fetchers/ios.js';
import { fetchAndroidVersions } from './fetchers/android.js';
import { fetchAppleSubmissionDeadline } from './fetchers/apple-deadline.js';
import { fetchGooglePlayDeadline } from './fetchers/google-deadline.js';
import { compareVersions, fetchiOSToolchain } from './fetchers/ios-toolchain.js';
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
import { fetchTaiwanBankApps, TW_BANK_APPS, type TaiwanBankApp } from './fetchers/tw-banks.js';
import { bankSnapshots, coreVersionProblems, recordBankVersions, type BankChange, type BankSnapshot } from './history.js';
import { anonymizeAppStoreUrl, maskName } from './mask.js';
import { createRefreshCache } from './refresh-cache.js';
import { safeUrl } from './safe-url.js';
import { buildAndroidActions, buildDeadlineTimeline, buildiOSActions, zhPlatform, zhSdk } from './insights.js';
import { notifyWebhook, recentItems, recordItems, toTrackedItems, type TrackedItem } from './changes.js';
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
  frameworks: { label: 'GitHub facebook/react-native releases · Flutter release index', url: 'https://github.com/facebook/react-native/releases' },
} as const;

export type SourceKey = keyof typeof SOURCES;


function toISODate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

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
  beginFeedScope,
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
  async function track<T>(key: SourceKey, task: () => Promise<T>, fallback: T): Promise<T> {
    try {
      const value = await task();
      sources[key] = { ...SOURCES[key], fetchedAt: now().toISOString(), ok: true };
      void reportSourceStatus(key, true);
      return value;
    } catch (err) {
      // reportSourceStatus logs the failure and alerts the webhook on the first failure of a streak
      run.errors[key] = String((err as Error)?.message ?? err);
      void reportSourceStatus(key, false, run.errors[key]);
      sources[key] = { ...SOURCES[key], fetchedAt: now().toISOString(), ok: false };
      return fallback;
    }
  }

  let [
    ios, android, appleDeadline, googleDeadline, iosToolchain, androidToolchain, iosAdoption,
    appleNews, androidNews, androidCompat, xcodeSupport, appleRequirements, playPolicy, playBilling, pageSize,
    ciImages, agpJdk, privacy, osShare, twBanks, devNews, cordova, security, appleStatus, frameworks,
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
  ]);

  // Versions everything else is derived from: a source that suddenly reports an implausible or older
  // version is treated as failing (ios / android then block publishing; a toolchain is left out)
  const problems = deps.coreVersionProblems({
    iosStable: ios.find(v => !v.isBeta)?.version,
    androidStable: android.find(v => !v.isBeta)?.version.replace(/^Android\s*/i, ''),
    xcodeStable: iosToolchain?.xcodeStable?.version,
    agpStable: androidToolchain?.agpStable?.version,
  });
  for (const { source, message } of problems) {
    const key = source as SourceKey;
    sources[key] = { ...SOURCES[key], fetchedAt: now().toISOString(), ok: false };
    run.errors[key] = message;
    void reportSourceStatus(key, false, message);
    if (key === 'iosToolchain') iosToolchain = null;
    if (key === 'androidToolchain') androidToolchain = null;
  }

  // Crash notes depend on which OS / Xcode versions are current
  const crashes = await track('crashes', () => f.crashes({
    iosMajor: ios.find(v => !v.isBeta)?.version.match(/^\d+/)?.[0],
    androidMajor: android.find(v => !v.isBeta)?.version.match(/\d+/)?.[0],
    xcodeNotesUrl: iosToolchain?.xcodeStable?.notesUrl,
  }), null);

  if (iosToolchain) {
    correctXcodeSdks(iosToolchain.releases, xcodeSupport);
  }

  const announcedDevices = iosToolchain?.knowniPhones.length
    ? findAnnouncedDevices(appleNews, iosToolchain.knowniPhones)
    : [];

  const allDeadlines: Deadline[] = [...appleRequirements, ...playPolicy, ...playBilling.deadlines, ...pageSize];
  const targetSdk = googleDeadline?.requirements[0];
  const targetDate = googleDeadline ? new Date(googleDeadline.deadline) : null;
  if (googleDeadline && targetSdk && targetDate && !Number.isNaN(targetDate.getTime())) {
    const ext = googleDeadline.extensionDate ? new Date(googleDeadline.extensionDate) : null;
    allDeadlines.push({
      platform: 'Android',
      date: toISODate(targetDate),
      title: `Google Play 目標 API 等級：${zhSdk(targetSdk.sdk)}`,
      detail: googleDeadline.requirements.map(r => `${zhPlatform(r.platform)}：${zhSdk(r.sdk)}`).join('；'),
      source: SOURCES.googleDeadline.label,
      url: SOURCES.googleDeadline.url,
      extensionDate: ext && !Number.isNaN(ext.getTime()) ? toISODate(ext) : undefined,
    });
  }

  const timeline = buildDeadlineTimeline(allDeadlines);

  // Sources that worked but came back with holes (a field missing for some apps, far fewer items than usual)
  run.counts = {
    twBanks: { 'twBanks.apps': twBanks.length },
    devNews: { 'devNews.items': devNews.length },
    appleNews: { 'appleNews.items': appleNews.length },
    androidNews: { 'androidNews.items': androidNews.length },
    xcodeSupport: { 'xcodeSupport.rows': xcodeSupport.length },
    security: security ? { 'security.appleReleases': security.apple.length, 'security.androidBulletins': security.android.length } : {},
    crashes: crashes ? { 'crashes.items': crashes.ios.length + crashes.android.length + crashes.sdks.length + crashes.community.length + crashes.cordova.length } : {},
    privacy: privacy ? { 'privacy.requiredReasonApis': privacy.appleRequiredReasonApis.length } : {},
    cordova: cordova ? { 'cordova.packages': cordova.platforms.length + cordova.plugins.length } : {},
    ciImages: ciImages ? { 'ciImages.githubRunners': ciImages.githubActions.length } : {},
  };
  const quality = dataQualityProblems({ ok: key => sources[key]?.ok === true, bankEntries: TW_BANK_APPS, banks: twBanks, counts: run.counts });
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
  const bankChanges = maskedBanks.length ? deps.recordBankVersions(maskedBanks, now()) : [];
  const { items: tracked, added } = deps.recordItems(toTrackedItems({ deadlines: timeline, appleNews, androidNews, devices: announcedDevices, crashes: [...(crashes?.sdks ?? []), ...(crashes?.cordova ?? [])], devNews, security, bankChanges, appleStatus }), now());
  void deps.notifyWebhook(added, SITE_URL);

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
    }),
    androidActions: buildAndroidActions(android, googleDeadline, {
      osShare,
      toolchain: androidToolchain,
      compat: androidCompat,
      billing: playBilling,
      policies: playPolicy,
      pageSize,
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
