import type { SourceKey } from './fetch-all.js';
import { NEWS_SOURCES } from './fetchers/dev-news.js';

/**
 * The source compliance register: for every data source, what is fetched, how, under which terms or licence,
 * and how risky that is. SOURCES.md is generated from it (npm run sources:doc; a test fails if it's stale),
 * and the API attaches each source's licence and attribution to the data built from it.
 *
 * Risk levels:
 * - low: an official feed, API or open-data download, or content under an open licence
 * - medium: a public page whose terms neither clearly allow nor forbid automated reading (robots.txt allows it)
 * - high: robots.txt allows it, but the operator's website terms restrict automated access to content not
 *   "purposely made available" (Apple). Kept because only facts (versions, dates) are extracted, with a
 *   link back; fetching stops if the operator objects (see DISCLAIMER.md §3)
 */

export const REGISTER_CHECKED = '2026-10-17';

/** The repository's files on GitHub (legal documents, SOURCES.md) */
export const REPO_BLOB = 'https://github.com/louisxie0830/os-version-tracker/blob/master';

export type FetchMethod = 'API' | 'RSS / Atom' | 'JSON 檔' | 'XML 檔' | 'CSV 匯出' | 'HTML 網頁' | '網頁內嵌資料' | 'Markdown 檔';
export type Risk = 'low' | 'medium' | 'high';

export interface Endpoint {
  url: string;
  method: FetchMethod;
  /** The terms or licence that govern this endpoint */
  terms: string;
  /** Set when robots.txt disallows the endpoint and it's still read on purpose: why (disclosed in SOURCES.md) */
  robotsException?: string;
}

export interface SourceRecord {
  endpoints: Endpoint[];
  /** Licence or terms the use relies on, in one line */
  licence: string;
  /** Credit to show with the data, when the licence requires it */
  attribution?: string;
  risk: Risk;
  /** What is kept, and why the use is considered acceptable */
  note: string;
}

const APPLE_TERMS = 'https://www.apple.com/legal/internet-services/terms/site.html';
const GOOGLE_TERMS = 'https://policies.google.com/terms';
const ANDROID_LEGAL = 'https://developer.android.com/legal';
const GITHUB_TERMS = 'https://docs.github.com/site-policy/github-terms/github-terms-of-service';
const ENDOFLIFE = 'https://github.com/endoflife-date/endoflife.date/blob/master/LICENSE';
const ITUNES_API = 'https://developer.apple.com/library/archive/documentation/AudioVideo/Conceptual/iTuneSearchAPI/index.html';
const PLAY_TERMS = 'https://play.google.com/about/play-terms/';
const MAVEN_CENTRAL = 'https://repo1.maven.org/terms.html';
const GRADLE_TERMS = 'https://gradle.org/terms/';
const JETBRAINS_TERMS = 'https://www.jetbrains.com/legal/docs/company/useterms/';
const KOTLIN_DOCS = 'https://github.com/JetBrains/kotlin-web-site/blob/master/LICENSE';
const SWIFT_LICENSE = 'https://www.swift.org/legal/license.html';
const FIREBASE_TERMS = 'https://firebase.google.com/terms';
const APACHE = 'https://www.apache.org/licenses/LICENSE-2.0';
const NPM_TERMS = 'https://docs.npmjs.com/policies/terms';
const RUNNER_IMAGES = 'https://github.com/actions/runner-images/blob/main/LICENSE';
const KEV_LICENSE = 'https://www.cisa.gov/sites/default/files/licenses/kev/license.txt';
const GHSA_LICENSE = 'https://github.com/github/advisory-database/blob/main/LICENSE.md';
const SO_API_TERMS = 'https://stackoverflow.com/legal/api-terms-of-use';
const ANDROID_SOURCE = 'https://source.android.com/docs/setup/about/licenses';
/** dl.google.com's robots.txt disallows everything; its Maven and SDK repository files are read anyway (disclosed) */
const DL_GOOGLE_EXCEPTION = 'dl.google.com 的 robots.txt 對所有程式 Disallow: /。這些是 Google Maven 與 Android SDK repository 的中繼資料檔，供 Gradle、Android Studio 等建置工具自動讀取；本站只讀取少數固定檔案取版本號，每天兩次';

/** Terms per news feed host (dev news endpoints come straight from the feed list in dev-news.ts) */
const FEED_TERMS: Record<string, string> = {
  'developer.apple.com': APPLE_TERMS,
  'www.swift.org': SWIFT_LICENSE,
  'developer.android.com': ANDROID_LEGAL,
  'androidstudio.googleblog.com': GOOGLE_TERMS,
  'blog.jetbrains.com': JETBRAINS_TERMS,
  'cordova.apache.org': APACHE,
  'firebase.blog': FIREBASE_TERMS,
};
const ANDROID_DOCS = 'Android 文件依 Apache 2.0、其他內容依 CC BY 2.5（Android 網站法律聲明）；Google 服務條款';
const APPLE_FACTS = '只取版本、日期與規定名稱等事實資訊並附原始連結';

export const SOURCE_REGISTER: Record<SourceKey, SourceRecord> = {
  ios: {
    endpoints: [
      { url: 'https://developer.apple.com/news/releases/rss/releases.rss', method: 'RSS / Atom', terms: APPLE_TERMS },
      { url: 'https://endoflife.date/api/ios.json', method: 'API', terms: ENDOFLIFE },
      { url: 'https://gdmf.apple.com/v2/pmv', method: 'JSON 檔', terms: APPLE_TERMS },
    ],
    licence: 'Apple RSS（官方提供）；endoflife.date（MIT）；gdmf.apple.com 為未公開文件的軟體更新目錄',
    risk: 'high',
    note: `RSS 與 endoflife.date 風險低；gdmf.apple.com 不是 Apple 公開提供的資料介面。${APPLE_FACTS}`,
  },
  android: {
    endpoints: [
      { url: 'https://endoflife.date/api/android.json', method: 'API', terms: ENDOFLIFE },
      { url: 'https://developer.android.com/blog/atom.xml', method: 'RSS / Atom', terms: ANDROID_LEGAL },
    ],
    licence: 'endoflife.date（MIT）；Android Developers Blog feed（官方提供）',
    risk: 'low',
    note: '只取版本號、API 等級、代號與發布日期',
  },
  appleDeadline: {
    endpoints: [{ url: 'https://developer.apple.com/news/rss/news.rss', method: 'RSS / Atom', terms: APPLE_TERMS }],
    licence: 'Apple Developer News RSS（官方提供）',
    risk: 'low',
    note: '只取公告標題、日期與連結',
  },
  googleDeadline: {
    endpoints: [{ url: 'https://developer.android.com/google/play/requirements/target-sdk', method: 'HTML 網頁', terms: ANDROID_LEGAL }],
    licence: ANDROID_DOCS,
    risk: 'medium',
    note: '只取期限日期與要求的 API 等級',
  },
  iosToolchain: {
    endpoints: [
      { url: 'https://xcodereleases.com/data.json', method: 'JSON 檔', terms: 'https://xcodereleases.com' },
      { url: 'https://endoflife.date/api/iphone.json', method: 'API', terms: ENDOFLIFE },
    ],
    licence: 'xcodereleases.com 未標示使用條款；endoflife.date（MIT）',
    risk: 'medium',
    note: '只取 Xcode 版本、build、需要的 macOS 與發布日期；xcodereleases.com 為社群專案，未找到使用條款（條款欄連到網站首頁）',
  },
  androidToolchain: {
    endpoints: [
      { url: 'https://dl.google.com/dl/android/maven2/com/android/tools/build/gradle/maven-metadata.xml', method: 'XML 檔', terms: GOOGLE_TERMS, robotsException: DL_GOOGLE_EXCEPTION },
      { url: 'https://developer.android.com/develop/ui/compose/bom/bom-mapping', method: 'HTML 網頁', terms: GOOGLE_TERMS },
      { url: 'https://dl.google.com/android/repository/repository2-3.xml', method: 'XML 檔', terms: GOOGLE_TERMS, robotsException: DL_GOOGLE_EXCEPTION },
      { url: 'https://repo1.maven.org/maven2/org/jetbrains/kotlin/kotlin-stdlib/maven-metadata.xml', method: 'XML 檔', terms: MAVEN_CENTRAL },
      { url: 'https://services.gradle.org/versions/current', method: 'API', terms: GRADLE_TERMS },
      { url: 'https://gradle.org/releases/', method: 'HTML 網頁', terms: GRADLE_TERMS },
      { url: 'https://jb.gg/android-studio-releases-list.json', method: 'JSON 檔', terms: JETBRAINS_TERMS },
      { url: 'https://kotlinlang.org/docs/releases.html', method: 'HTML 網頁', terms: KOTLIN_DOCS },
      { url: 'https://developer.android.com/studio/releases', method: 'HTML 網頁', terms: ANDROID_LEGAL },
      { url: 'https://developer.android.com/build/releases/gradle-plugin', method: 'HTML 網頁', terms: ANDROID_LEGAL },
      { url: 'https://developer.android.com/tools/releases/platforms', method: 'HTML 網頁', terms: ANDROID_LEGAL },
      { url: 'https://developer.android.com/tools/releases/build-tools', method: 'HTML 網頁', terms: ANDROID_LEGAL },
      { url: 'https://developer.android.com/develop/ui/compose/bom/bom-mapping', method: 'HTML 網頁', terms: ANDROID_LEGAL },
    ],
    licence: 'Google Maven 與 Android SDK repository（Google 服務條款）；Maven Central（使用條款）；Gradle（網站條款）；JetBrains 版本清單（JetBrains 網站條款）；Kotlin 文件（Apache 2.0）；Android 文件（Apache 2.0）',
    risk: 'high',
    note: '只取版本號與發布日期，主要來自供建置工具讀取的套件庫中繼資料。dl.google.com 的兩個檔案（AGP 版本、SDK Platform 與 Build Tools）為 robots.txt 例外，因為 developer.android.com 的文件只到小版本號或落後於實際發布（見端點說明）；Compose BOM 改讀文件頁',
  },
  adoption: {
    endpoints: [{ url: 'https://developer.apple.com/support/app-store/', method: 'HTML 網頁', terms: APPLE_TERMS }],
    licence: 'Apple 網站使用條款',
    risk: 'high',
    note: `只取各版本的採用率百分比與統計日期。${APPLE_FACTS}`,
  },
  appleNews: {
    endpoints: [{ url: 'https://developer.apple.com/news/rss/news.rss', method: 'RSS / Atom', terms: APPLE_TERMS }],
    licence: 'Apple Developer News RSS（官方提供）',
    risk: 'low',
    note: '只取標題、日期與連結，標題維持原文',
  },
  androidNews: {
    endpoints: [{ url: 'https://developer.android.com/blog/atom.xml', method: 'RSS / Atom', terms: ANDROID_LEGAL }],
    licence: 'Android Developers Blog feed（官方提供）',
    risk: 'low',
    note: '只取標題、日期與連結，標題維持原文',
  },
  androidCompat: {
    endpoints: [
      { url: 'https://developer.android.com/build/releases/gradle-plugin', method: 'HTML 網頁', terms: ANDROID_LEGAL },
      { url: 'https://developer.android.com/build/releases/about-agp', method: 'HTML 網頁', terms: ANDROID_LEGAL },
      { url: 'https://kotlinlang.org/docs/gradle-configure-project.html', method: 'HTML 網頁', terms: KOTLIN_DOCS },
    ],
    licence: `${ANDROID_DOCS}；Kotlin 文件依 Apache 2.0`,
    risk: 'medium',
    note: '只取相容性表格中的版本對應（AGP、Gradle、Kotlin、Android Studio）',
  },
  xcodeSupport: {
    endpoints: [{ url: 'https://developer.apple.com/xcode/system-requirements/', method: 'HTML 網頁', terms: APPLE_TERMS }],
    licence: 'Apple 網站使用條款',
    risk: 'high',
    note: `只取 Xcode、macOS 與 SDK 的版本對應。${APPLE_FACTS}`,
  },
  appleRequirements: {
    endpoints: [
      { url: 'https://developer.apple.com/news/upcoming-requirements/', method: 'HTML 網頁', terms: APPLE_TERMS },
      { url: 'https://developer.apple.com/help/app-store-connect/release-notes/', method: 'HTML 網頁', terms: APPLE_TERMS },
    ],
    licence: 'Apple 網站使用條款',
    risk: 'high',
    note: `只取規定名稱與生效日期。${APPLE_FACTS}`,
  },
  playPolicy: {
    endpoints: [
      { url: 'https://support.google.com/googleplay/android-developer/table/12921780', method: 'HTML 網頁', terms: GOOGLE_TERMS },
      { url: 'https://support.google.com/googleplay/android-developer/answer/17492799', method: 'HTML 網頁', terms: GOOGLE_TERMS },
      { url: 'https://developer.android.com/developer-verification/guides', method: 'HTML 網頁', terms: GOOGLE_TERMS },
    ],
    licence: 'Google 服務條款',
    risk: 'medium',
    note: '只取政策名稱與期限日期；Play Console 技術品質規定（程式碼混淆與最佳化、記憶體用量、登入還原）另取名稱、生效月份與門檻',
  },
  playBilling: {
    endpoints: [
      { url: 'https://developer.android.com/google/play/billing/deprecation-faq', method: 'HTML 網頁', terms: ANDROID_LEGAL },
      { url: 'https://developer.android.com/google/play/billing/release-notes', method: 'HTML 網頁', terms: GOOGLE_TERMS },
      { url: 'https://developer.android.com/google/play/billing/play-developer-apis-deprecations', method: 'HTML 網頁', terms: GOOGLE_TERMS },
    ],
    licence: ANDROID_DOCS,
    risk: 'high',
    note: '只取各版本的淘汰日期與最新版本號（最新版本號取自 release notes 的標題）',
  },
  pageSize: {
    endpoints: [{ url: 'https://developer.android.com/guide/practices/page-sizes', method: 'HTML 網頁', terms: ANDROID_LEGAL }],
    licence: ANDROID_DOCS,
    risk: 'medium',
    note: '只取期限日期',
  },
  ciImages: {
    endpoints: [
      { url: 'https://raw.githubusercontent.com/actions/runner-images/main/README.md', method: 'Markdown 檔', terms: RUNNER_IMAGES },
      { url: 'https://developer.apple.com/xcode-cloud/release-notes/', method: 'HTML 網頁', terms: APPLE_TERMS },
    ],
    licence: 'actions/runner-images（MIT）；Xcode Cloud release notes 依 Apple 網站使用條款',
    risk: 'high',
    note: `runner 映像資訊風險低；Xcode Cloud 只取提供的 Xcode 版本。${APPLE_FACTS}`,
  },
  agpJdk: {
    endpoints: [
      { url: 'https://developer.android.com/build/releases/gradle-plugin', method: 'HTML 網頁', terms: ANDROID_LEGAL },
      { url: 'https://developer.android.com/build/releases/past-releases', method: 'HTML 網頁', terms: ANDROID_LEGAL },
    ],
    licence: ANDROID_DOCS,
    risk: 'medium',
    note: '只取各 AGP 版本需要的 JDK 版本',
  },
  privacy: {
    endpoints: [
      { url: 'https://developer.apple.com/tutorials/data/documentation/bundleresources/app-privacy-configuration/nsprivacyaccessedapitypes/nsprivacyaccessedapitype.json', method: 'JSON 檔', terms: APPLE_TERMS },
      { url: 'https://developer.apple.com/support/third-party-SDK-requirements/', method: 'HTML 網頁', terms: APPLE_TERMS },
    ],
    licence: 'Apple 網站使用條款；文件頁面背後的 JSON 不是公開提供的資料介面',
    risk: 'high',
    note: `只取 API 類別、原因代碼與 SDK 名稱（規格名稱等事實資訊）。${APPLE_FACTS}`,
  },
  osShare: {
    endpoints: [{ url: 'https://gs.statcounter.com/chart.php?…&csv=1', method: 'CSV 匯出', terms: 'https://creativecommons.org/licenses/by-sa/3.0/' }],
    licence: 'CC BY-SA 3.0',
    attribution: 'StatCounter Global Stats',
    risk: 'low',
    note: '使用網站提供的 CSV 下載；衍生的分布、涵蓋率與趨勢資料同樣以 CC BY-SA 3.0 提供',
  },
  twBanks: {
    endpoints: [
      { url: 'https://itunes.apple.com/lookup', method: 'API', terms: ITUNES_API },
      { url: 'https://play.google.com/store/apps/details', method: '網頁內嵌資料', terms: PLAY_TERMS },
    ],
    licence: 'iTunes Lookup API（Apple 公開提供的 API）；Google Play 商店頁依 Google Play 服務條款',
    risk: 'medium',
    note: '只取最低支援版本、版本號、targetSdk 與更新日期；銀行與 App 名稱部分遮罩，不評比任何銀行',
  },
  devNews: {
    // Straight from the feed list the fetcher uses, so the register can't miss a feed
    endpoints: NEWS_SOURCES.map(n => ({ url: n.url, method: 'RSS / Atom' as const, terms: FEED_TERMS[new URL(n.url).hostname] ?? '' })),
    licence: '各官方 feed（供訂閱讀取）；Apple、Google、Swift.org、JetBrains、Apache Cordova、Firebase 各自的網站條款',
    risk: 'low',
    note: '只取標題、日期與連結，標題維持原文',
  },
  cordova: {
    endpoints: [
      { url: 'https://registry.npmjs.org/{package}/latest', method: 'API', terms: NPM_TERMS },
      { url: 'https://api.github.com/repos/apache/{repo}/releases', method: 'API', terms: GITHUB_TERMS },
      { url: 'https://raw.githubusercontent.com/apache/{repo}/master/RELEASENOTES.md', method: 'Markdown 檔', terms: APACHE },
    ],
    licence: 'npm registry 公開 API；Apache Cordova 原始碼與 release notes 依 Apache 2.0；GitHub 服務條款',
    risk: 'low',
    note: '版本與平台需求為事實資訊；破壞性變更與修正項目摘錄自 Apache 2.0 授權的 release notes',
  },
  security: {
    endpoints: [
      { url: 'https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json', method: 'JSON 檔', terms: KEV_LICENSE },
      { url: 'https://api.github.com/advisories', method: 'API', terms: GHSA_LICENSE },
      { url: 'https://source.android.com/docs/security/bulletin/asb-overview', method: 'HTML 網頁', terms: ANDROID_SOURCE },
      { url: 'https://support.apple.com/en-us/100100', method: 'HTML 網頁', terms: APPLE_TERMS },
    ],
    licence: 'CISA KEV（CC0 1.0）；GitHub Advisory Database（CC BY 4.0）；Android 安全性公告（Android 開放原始碼專案授權）；Apple 安全性更新頁（Apple 網站使用條款）',
    attribution: 'GitHub Advisory Database（CC BY 4.0）',
    risk: 'high',
    note: `KEV 與 GitHub Advisory 風險低；Apple 安全性更新頁只取版本名稱、日期與 CVE 編號。${APPLE_FACTS}`,
  },
  crashes: {
    endpoints: [
      { url: 'https://api.github.com/search/issues', method: 'API', terms: GITHUB_TERMS },
      { url: 'https://api.stackexchange.com/2.3/search/advanced', method: 'API', terms: SO_API_TERMS },
      { url: 'https://developer.apple.com/tutorials/data/documentation/…-release-notes.json', method: 'JSON 檔', terms: APPLE_TERMS },
      { url: 'https://developer.android.com/about/versions/{major}', method: 'HTML 網頁', terms: ANDROID_LEGAL },
    ],
    licence: 'GitHub 服務條款；Stack Overflow 使用者內容依 CC BY-SA（Stack Exchange API 條款要求標示來源與作者）；Apple release notes 依 Apple 網站使用條款',
    attribution: 'Stack Overflow（CC BY-SA，標示原作者）；GitHub issue（標示原作者）',
    risk: 'high',
    note: `GitHub 與 Stack Overflow 只取標題、作者名稱與連結並標示作者；Apple release notes 只取已知問題的標題。${APPLE_FACTS}`,
  },
  appleStatus: {
    endpoints: [{ url: 'https://www.apple.com/support/systemstatus/data/developer/system_status_en_US.js', method: 'JSON 檔', terms: APPLE_TERMS }],
    licence: 'Apple 網站使用條款；狀態頁背後的資料檔不是公開提供的資料介面',
    risk: 'high',
    note: '只取服務名稱、事件類型、狀態與時間，不轉載 Apple 的說明文字',
  },
  appleDeprecations: {
    endpoints: [
      { url: 'https://developer.apple.com/tutorials/data/documentation/appstorereceipts.json', method: 'JSON 檔', terms: APPLE_TERMS },
      { url: 'https://developer.apple.com/tutorials/data/documentation/appstoreservernotifications/app-store-server-notifications-v1.json', method: 'JSON 檔', terms: APPLE_TERMS },
    ],
    licence: 'Apple 網站使用條款',
    risk: 'high',
    note: `只取文件是否標示淘汰與淘汰版本。${APPLE_FACTS}`,
  },
  behaviorChanges: {
    endpoints: [{ url: 'https://developer.android.com/about/versions/17/behavior-changes-17', method: 'HTML 網頁', terms: GOOGLE_TERMS }],
    licence: 'Google 服務條款',
    risk: 'low',
    note: '只取最新 Android 版本「以該版本為目標的 App」行為變更頁的各項標題，附原始連結（網址隨最新版本號改變）',
  },
  sdkReleases: {
    endpoints: [
      { url: 'https://firebase.google.com/support/release-notes/ios', method: 'HTML 網頁', terms: GOOGLE_TERMS },
      { url: 'https://firebase.google.com/support/release-notes/android', method: 'HTML 網頁', terms: GOOGLE_TERMS },
      { url: 'https://developers.google.com/android/guides/releases', method: 'HTML 網頁', terms: GOOGLE_TERMS },
    ],
    licence: 'Google 服務條款',
    risk: 'medium',
    note: '只取近半年版本中需要處理的項目（破壞性變更、最低版本調整、移除的 API、停止發布的管道）與停用日期，附原始連結',
  },
  frameworks: {
    endpoints: [
      { url: 'https://api.github.com/repos/react/react-native/releases', method: 'API', terms: GITHUB_TERMS },
      { url: 'https://storage.googleapis.com/flutter_infra_release/releases/releases_macos.json', method: 'JSON 檔', terms: GOOGLE_TERMS },
      { url: 'https://docs.flutter.dev/release/breaking-changes', method: 'HTML 網頁', terms: GOOGLE_TERMS },
    ],
    licence: 'GitHub 服務條款；Flutter 官方版本清單（Flutter 工具本身讀取的公開資料）',
    risk: 'low',
    note: '只取版本號、日期與連結；React Native release notes 只計算段落項目數，不轉載內容',
  },
};

/** Every distinct terms link a source relies on */
export const termsOf = (r: SourceRecord) => [...new Set(r.endpoints.map(e => e.terms))];

const RISK_LABEL: Record<Risk, string> = { low: '低', medium: '中', high: '高' };

/** SOURCES.md, generated from the register */
export function sourcesMarkdown(labels: Record<SourceKey, string>): string {
  const keys = Object.keys(SOURCE_REGISTER) as SourceKey[];
  const count = (r: Risk) => keys.filter(k => SOURCE_REGISTER[k].risk === r).length;
  const cell = (s: string) => s.replace(/\|/g, '\\|');
  const rows = keys.map(k => {
    const r = SOURCE_REGISTER[k];
    return `| \`${k}\` | ${cell(labels[k])} | ${RISK_LABEL[r.risk]} | ${[...new Set(r.endpoints.map(e => e.method))].join('、')} | ${cell(r.licence)} |`;
  });
  const details = keys.map(k => {
    const r = SOURCE_REGISTER[k];
    return [
      `### \`${k}\`：${labels[k]}`,
      '',
      `- 風險：${RISK_LABEL[r.risk]}`,
      `- 授權或條款：${r.licence}`,
      '- 端點：',
      // Endpoints as code, not links: many are API bases or templates that only work with parameters
      ...r.endpoints.map(e => `  - ${e.method} \`${e.url}\`（條款：<${e.terms}>）${e.robotsException ? `\n    - **robots.txt 例外**：${e.robotsException}` : ''}`),
      ...(r.attribution ? [`- 須標示：${r.attribution}`] : []),
      `- 說明：${r.note}`,
    ].join('\n');
  });
  return [
    '# 資料來源合規清冊',
    '',
    `<!-- 由 src/source-registry.ts 產生：npm run sources:doc。請改那個檔案，不要直接編輯本檔。 -->`,
    '',
    `最後檢查：${REGISTER_CHECKED} · 共 ${keys.length} 個來源（風險低 ${count('low')}、中 ${count('medium')}、高 ${count('high')}）`,
    '',
    '共同做法：每天兩次（另加程式更新或手動重建時），以可識別的 User-Agent（`os-version-tracker`）請求；不登入、不繞過任何存取限制；每個請求有逾時限制。截至最後檢查日，除標示為「robots.txt 例外」的 dl.google.com 端點外，已檢查的列示端點都未被各網站的 robots.txt 禁止（gs.statcounter.com 與 gdmf.apple.com 沒有 robots.txt）；robots.txt 隨時可能改變，也不等於法律上的授權。每週會自動重新檢查（`npm run check:robots`），結果與 robots.txt 快照保存在該次執行的紀錄中。',
    '',
    '風險等級：',
    '',
    '- **低**：官方 feed、API、開放資料下載，或採開放授權的內容。',
    '- **中**：公開網頁，robots.txt 未禁止，但條款沒有明確允許或禁止自動讀取。',
    '- **高**：經營者的網站條款限制以自動方式取得「非刻意提供」的內容（Apple），或 robots.txt 禁止但仍讀取的例外（dl.google.com）。目前保留，因為只擷取版本、日期等事實資訊並附原始連結；經營者反對時會停止擷取（見 DISCLAIMER.md 第 3 節）。',
    '',
    '| 來源 | 名稱 | 風險 | 方式 | 授權或條款 |',
    '| --- | --- | --- | --- | --- |',
    ...rows,
    '',
    '## 各來源細節',
    '',
    details.join('\n\n'),
    '',
  ].join('\n');
}
