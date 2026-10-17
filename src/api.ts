import type { AllVersions, SourceKey } from './fetch-all.js';
import { buildNowCards } from './now.js';
import { inVersionRange } from './fetchers/security.js';
import { REPO_BLOB, SOURCE_REGISTER, termsOf } from './source-registry.js';

/**
 * The JSON API: one small file per topic under api/, plus api/index.json listing them. The static build
 * writes each as a file; the Node server answers the same paths. api.json (everything at once) stays
 * for existing users. Bank and app names are masked as everywhere else.
 *
 * Every endpoint shares one envelope, so clients can check freshness and source health the same way:
 * { apiVersion, updatedAt, sources: { key: { label, url, fetchedAt, ok } }, license, termsUrl, attribution, data }
 * license / termsUrl / attribution travel with the data, so a copy keeps the terms and credits it came with.
 */

/** The site's own compilation; third-party content keeps its own licence (listed per source) */
export const API_LICENSE = '本站彙整與自行撰寫的內容保留所有權利；第三方內容依 attribution 所列各來源的授權或條款，引用時請保留來源與作者標示。StatCounter 衍生資料依 CC BY-SA 3.0。';

/** Every source the feed's items can come from */
const FEED_SOURCES: SourceKey[] = ['appleDeadline', 'googleDeadline', 'appleRequirements', 'playPolicy', 'playBilling', 'pageSize', 'appleNews', 'androidNews', 'devNews', 'iosToolchain', 'crashes', 'security', 'twBanks', 'appleStatus'];

export const API_VERSION = 1;

interface Endpoint {
  /** Path under the site root, e.g. "api/versions.json" */
  path: string;
  description: string;
  sources: SourceKey[];
  build: (data: AllVersions) => unknown;
}

export const API_ENDPOINTS: Endpoint[] = [
  {
    path: 'api/versions.json',
    description: '最新正式版與 Beta：iOS、Android、Xcode、Android 開發工具（AGP、Gradle、Kotlin、Android Studio…）與最新 iPhone',
    sources: ['ios', 'android', 'iosToolchain', 'androidToolchain'],
    build: d => ({ ios: d.ios, android: d.android, iosToolchain: d.iosToolchain, androidToolchain: d.androidToolchain }),
  },
  {
    path: 'api/now.json',
    description: '待處理：會擋上架的規定、可能已遭利用的漏洞、提到最新系統的閃退回報、目前有狀況的 Apple 開發者服務',
    sources: ['appleDeadline', 'googleDeadline', 'security', 'crashes', 'appleStatus'],
    build: d => buildNowCards(d),
  },
  {
    path: 'api/actions.json',
    description: 'iOS 與 Android 開發者須知（狀態：urgent / upcoming / ok / info）',
    sources: ['ios', 'android', 'appleRequirements', 'playPolicy', 'playBilling', 'pageSize'],
    build: d => ({ ios: d.iosActions, android: d.androidActions }),
  },
  {
    path: 'api/deadlines.json',
    description: '上架規定與期限時間軸，以及 App Store / Google Play 目前的提交期限',
    sources: ['appleDeadline', 'googleDeadline', 'appleRequirements', 'playPolicy', 'playBilling', 'pageSize'],
    build: d => ({ timeline: d.timeline, appleDeadline: d.appleDeadline, googleDeadline: d.googleDeadline }),
  },
  {
    path: 'api/feed.json',
    description: '最新動態：期限、公告、新機型、閃退、資安與銀行 App 版本調整，含首次出現時間；recent 為近 7 天新增',
    sources: FEED_SOURCES,
    build: d => ({ items: d.tracked, recent: d.recent.map(i => i.id) }),
  },
  {
    path: 'api/security.json',
    description: '資安：已遭利用的漏洞（CISA KEV）、Apple 安全性更新、Android 安全性公告、常用 SDK 資安公告',
    sources: ['security'],
    build: d => d.security,
  },
  {
    path: 'api/crashes.json',
    description: '閃退與當機：Apple / Android release notes、熱門 SDK 與 Cordova 的 GitHub 回報、Stack Overflow 討論',
    sources: ['crashes'],
    build: d => d.crashes,
  },
  {
    path: 'api/cordova.json',
    description: 'Cordova：平台與核心 plugin 的最新版本、需要的平台版本、破壞性變更，以及已知漏洞（latestAffected 表示最新版仍受影響）',
    sources: ['cordova', 'security'],
    build: d => d.cordova && {
      ...d.cordova,
      advisories: [...d.cordova.platforms.map(p => ({ name: p.name, latest: p.latest })), ...d.cordova.plugins.map(p => ({ name: p.name, latest: p.latest }))]
        .flatMap(({ name, latest }) => (d.security?.advisories ?? []).flatMap(a => (a.ranges ?? [])
          .filter(r => r.package === name)
          .map(r => ({ package: name, id: a.id, cve: a.cve, severity: a.severity, vulnerable: r.vulnerable, patched: r.patched, latestAffected: inVersionRange(latest, r.vulnerable), url: a.url })))),
    },
  },
  {
    path: 'api/frameworks.json',
    description: 'React Native 與 Flutter：最新正式版、近期各版本線、React Native release notes 標示的破壞性變更／棄用／資安項目數、Flutter 內建的 Dart 版本',
    sources: ['frameworks'],
    build: d => d.frameworks ?? null,
  },
  {
    path: 'api/compat.json',
    description: '相容性：Xcode × macOS × iOS SDK 支援表、AGP × Gradle × Kotlin、各 AGP 需要的 JDK、CI runner 內建的 Xcode',
    sources: ['xcodeSupport', 'androidCompat', 'agpJdk', 'ciImages'],
    build: d => ({ xcodeSupport: d.xcodeSupport, androidCompat: d.androidCompat, agpJdk: d.agpJdk, ciImages: d.ciImages }),
  },
  {
    path: 'api/trends.json',
    description: '版本分布與趨勢：台灣與全球各版本占比、近 12 個月主版本占比與手機品牌占比、Apple 官方 iOS 採用率（StatCounter 資料為 CC BY-SA 3.0，引用請註明來源）',
    sources: ['osShare', 'adoption'],
    build: d => ({ osShare: d.osShare, iosAdoption: d.iosAdoption }),
  },
  {
    path: 'api/banks.json',
    description: '銀行 App 支援版本：最低 iOS / Android、Android targetSdk、近一年的最低版本調整、每日分布紀錄（名稱已部分遮罩）',
    sources: ['twBanks'],
    build: d => ({ apps: d.twBanks, changes: d.bankChanges ?? [], trend: d.bankTrend ?? [] }),
  },
  {
    path: 'api/news.json',
    description: '開發者新聞：Apple / Android / Swift / Kotlin / Firebase / Cordova 官方 feed，標題維持原文',
    sources: ['devNews', 'appleNews', 'androidNews'],
    build: d => ({ items: d.devNews }),
  },
  {
    path: 'api/status.json',
    description: 'Apple 開發者服務狀態：App Store Connect、TestFlight、APNs、Xcode Cloud 等服務近 7 天與進行中的事件（每天更新兩次，不是即時狀態）',
    sources: ['appleStatus'],
    build: d => d.appleStatus ?? null,
  },
  {
    path: 'api/privacy.json',
    description: '隱私規範：Required Reason API 與原因代碼、須附隱私清單的第三方 SDK',
    sources: ['privacy'],
    build: d => d.privacy,
  },
];

/** Licence and required credit for each source behind an endpoint */
export function attributionFor(sources: SourceKey[]) {
  return sources.map(key => ({
    source: key,
    licence: SOURCE_REGISTER[key].licence,
    terms: termsOf(SOURCE_REGISTER[key]),
    ...(SOURCE_REGISTER[key].attribution ? { credit: SOURCE_REGISTER[key].attribution } : {}),
  }));
}

function envelope(data: AllVersions, sources: SourceKey[], payload: unknown, siteUrl: string) {
  return {
    apiVersion: API_VERSION,
    updatedAt: data.cachedAt,
    sources: Object.fromEntries(sources.filter(k => data.sources[k]).map(k => [k, data.sources[k]])),
    license: API_LICENSE,
    termsUrl: `${siteUrl}/legal/`,
    attribution: attributionFor(sources),
    data: payload ?? null,
  };
}

/**
 * api.json, the original all-in-one format: the data stays at the top level as it always was (existing
 * clients keep working); license, termsUrl and attribution are added next to it for every source
 */
export function legacyApiJson(data: AllVersions, siteUrl: string) {
  return { ...data, license: API_LICENSE, termsUrl: `${siteUrl}/legal/`, attribution: attributionFor(Object.keys(data.sources) as SourceKey[]) };
}

/** api/index.json: what's available, with every source's health */
export function buildApiIndex(data: AllVersions, siteUrl: string) {
  return {
    apiVersion: API_VERSION,
    updatedAt: data.cachedAt,
    envelope: '每個端點都回傳 { apiVersion, updatedAt, sources, license, termsUrl, attribution, data }；sources 列出相關資料來源的抓取時間與是否成功，attribution 列出各來源的授權、條款與須標示的來源或作者',
    license: API_LICENSE,
    termsUrl: `${siteUrl}/legal/`,
    sourcesRegister: `${REPO_BLOB}/SOURCES.md`,
    endpoints: [
      ...API_ENDPOINTS.map(e => ({ path: e.path, url: `${siteUrl}/${e.path}`, description: e.description })),
      { path: 'api.json', url: `${siteUrl}/api.json`, description: '所有資料一次取得（舊格式：資料直接放在最上層，另附 license、termsUrl、attribution）' },
      { path: 'notifications.json', url: `${siteUrl}/notifications.json`, description: '通知中心使用的新項目清單' },
      { path: 'feed.xml', url: `${siteUrl}/feed.xml`, description: 'Atom feed：新的規定、公告與資安項目' },
      { path: 'calendar.ics', url: `${siteUrl}/calendar.ics`, description: '上架期限行事曆（iCalendar）' },
    ],
    sources: data.sources,
  };
}

/** Every api/ file: path → JSON body */
export function buildApiFiles(data: AllVersions, siteUrl: string): Map<string, string> {
  const files = new Map<string, string>();
  files.set('api/index.json', JSON.stringify(buildApiIndex(data, siteUrl)));
  for (const e of API_ENDPOINTS) files.set(e.path, JSON.stringify(envelope(data, e.sources, e.build(data), siteUrl)));
  return files;
}
