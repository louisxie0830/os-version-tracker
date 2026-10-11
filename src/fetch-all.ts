import { reportSourceStatus } from './alerts.js';
import { fetchiOSVersions } from './fetchers/ios.js';
import { fetchAndroidVersions } from './fetchers/android.js';
import { fetchAppleSubmissionDeadline } from './fetchers/apple-deadline.js';
import { fetchGooglePlayDeadline } from './fetchers/google-deadline.js';
import { compareVersions, fetchiOSToolchain } from './fetchers/ios-toolchain.js';
import { fetchAndroidToolchain } from './fetchers/android-toolchain.js';
import { fetchAppleNews, fetchAndroidNews, findAnnouncedDevices } from './fetchers/news.js';
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
import { fetchTaiwanBankApps, type TaiwanBankApp } from './fetchers/tw-banks.js';
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
  sources: Record<SourceKey, SourceInfo>;
  cachedAt: string;
}

const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

const DEFAULT_SITE_URL = 'https://louisxie0830.github.io/os-version-tracker';
export const SITE_URL = (safeUrl(process.env.SITE_URL ?? DEFAULT_SITE_URL) ?? (() => {
  console.warn(`[config] SITE_URL "${process.env.SITE_URL}" is not an http(s) URL; using ${DEFAULT_SITE_URL}`);
  return DEFAULT_SITE_URL;
})()).replace(/\/$/, '');

const SOURCES = {
  ios: { label: 'Apple 軟體更新目錄 / Developer Releases', url: 'https://developer.apple.com/news/releases/' },
  android: { label: 'endoflife.date · Android Developers Blog', url: 'https://endoflife.date/android' },
  appleDeadline: { label: 'Apple Developer News', url: 'https://developer.apple.com/news/' },
  googleDeadline: { label: 'Google Play 目標 API 等級規定', url: 'https://developer.android.com/google/play/requirements/target-sdk' },
  iosToolchain: { label: 'xcodereleases.com · endoflife.date', url: 'https://xcodereleases.com' },
  androidToolchain: { label: 'Google Maven · Gradle · Android SDK repository', url: 'https://developer.android.com/studio/releases' },
  adoption: { label: 'Apple App Store 使用率', url: 'https://developer.apple.com/support/app-store/' },
  appleNews: { label: 'Apple Developer News', url: 'https://developer.apple.com/news/' },
  androidNews: { label: 'Android Developers Blog', url: 'https://android-developers.googleblog.com/' },
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
  crashes: { label: 'Apple / Android release notes · GitHub SDK issues', url: 'https://developer.apple.com/documentation/ios-ipados-release-notes' },
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
const versionsCache = createRefreshCache(refreshAllVersions, CACHE_TTL_MS);

export function fetchAllVersions(): Promise<AllVersions> {
  return versionsCache.get();
}

async function refreshAllVersions(): Promise<AllVersions> {
  const sources = {} as Record<SourceKey, SourceInfo>;
  async function track<T>(key: SourceKey, task: Promise<T>, fallback: T): Promise<T> {
    try {
      const value = await task;
      sources[key] = { ...SOURCES[key], fetchedAt: new Date().toISOString(), ok: true };
      void reportSourceStatus(key, true);
      return value;
    } catch (err) {
      // reportSourceStatus logs the failure and alerts the webhook on the first failure of a streak
      void reportSourceStatus(key, false, String((err as Error)?.message ?? err));
      sources[key] = { ...SOURCES[key], fetchedAt: new Date().toISOString(), ok: false };
      return fallback;
    }
  }

  const [
    ios, android, appleDeadline, googleDeadline, iosToolchain, androidToolchain, iosAdoption,
    appleNews, androidNews, androidCompat, xcodeSupport, appleRequirements, playPolicy, playBilling, pageSize,
    ciImages, agpJdk, privacy, osShare, twBanks,
  ] = await Promise.all([
    track('ios', fetchiOSVersions(), []),
    track('android', fetchAndroidVersions(), []),
    track('appleDeadline', fetchAppleSubmissionDeadline(), null),
    track('googleDeadline', fetchGooglePlayDeadline(), null),
    track('iosToolchain', fetchiOSToolchain(), null),
    track('androidToolchain', fetchAndroidToolchain(), null),
    track('adoption', fetchiOSAdoption(), null),
    track('appleNews', fetchAppleNews(), []),
    track('androidNews', fetchAndroidNews(), []),
    track('androidCompat', fetchAndroidCompat(), null),
    track('xcodeSupport', fetchXcodeSupport(), []),
    track('appleRequirements', fetchAppleRequirements(), []),
    track('playPolicy', fetchPlayPolicyDeadlines(), []),
    track('playBilling', fetchPlayBilling(), { deadlines: [], latest: undefined }),
    track('pageSize', fetchPageSizeDeadlines(), []),
    track('ciImages', fetchCiImages(), null),
    track('agpJdk', fetchAgpJdk(), []),
    track('privacy', fetchPrivacyCompliance(), null),
    track('osShare', fetchOsShare(), null),
    track('twBanks', fetchTaiwanBankApps(), []),
  ]);

  // Crash notes depend on which OS / Xcode versions are current
  const crashes = await track('crashes', fetchCrashReport({
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
  const { items: tracked, added } = recordItems(toTrackedItems({ deadlines: timeline, appleNews, androidNews, devices: announcedDevices, crashes: crashes?.sdks }));
  void notifyWebhook(added, SITE_URL);

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
    recent: recentItems(tracked),
    ciImages,
    agpJdk,
    privacy,
    crashes,
    osShare,
    // Bank and app names are partially masked everywhere they're published (page and api.json)
    twBanks: twBanks.map(b => ({
      ...b,
      bank: maskName(b.bank),
      app: maskName(b.app),
      ios: b.ios && { ...b.ios, url: anonymizeAppStoreUrl(b.ios.url) },
    })),
    sources,
    cachedAt: new Date().toISOString(),
  };
}
