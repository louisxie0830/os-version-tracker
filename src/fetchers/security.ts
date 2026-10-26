import { fetchJson, githubHeaders, NETWORK_TIMEOUT_MS, SLOW_NETWORK_TIMEOUT_MS } from '../net.js';
import { safeUrl } from '../safe-url.js';
import { cleanText, fetchHtml } from './html-table.js';
import { settleSources } from './settle.js';
import { compareVersions } from '../versions.js';
import { calendarDate } from '../taipei-date.js';

/**
 * Security information that affects mobile apps: Apple security releases for iOS / Safari (WebKit is
 * what WKWebView runs) / Xcode, the monthly Android Security Bulletins, vulnerabilities CISA has seen
 * exploited in the wild (KEV, US government work), and GitHub advisories for widely used mobile SDKs.
 */

export type SecurityPlatform = 'iOS' | 'Android' | '跨平台';

export interface AppleSecurityRelease {
  name: string;
  /** Apple's advisory page; absent when the release has no published CVE entries */
  url?: string;
  date: string; // YYYY-MM-DD
  cves?: number;
  /** CVEs Apple says "may have been exploited" */
  exploited: string[];
}

export interface AndroidBulletin {
  title: string;
  url: string;
  published: string; // YYYY-MM-DD
  patchLevels: string[];
  /** 0 when the bulletin lists no vulnerabilities (it happens); undefined when the page couldn't be read */
  cves?: number;
  /** The bulletin's own "most severe issue" sentence */
  mostSevere?: string;
  /** CVEs with "indications that … may be under limited, targeted exploitation" */
  exploited: string[];
}

export interface ExploitedVuln {
  cve: string;
  platform: SecurityPlatform;
  product: string;
  name: string;
  dateAdded: string;
  description: string;
  ransomware: boolean;
  url: string;
}

export interface SdkAdvisory {
  id: string;
  cve?: string;
  severity: 'critical' | 'high' | 'medium' | 'low' | 'unknown';
  summary: string;
  published: string;
  packages: string[];
  /** Affected versions and the first fix, per tracked package (e.g. "< 6.0.1" → "6.0.1") */
  ranges: Array<{ package: string; vulnerable?: string; patched?: string }>;
  platform: SecurityPlatform;
  url: string;
}

export interface SecurityReport {
  apple: AppleSecurityRelease[];
  android: AndroidBulletin[];
  exploited: ExploitedVuln[];
  advisories: SdkAdvisory[];
}

const DAY_MS = 24 * 60 * 60 * 1000;
const isoDaysAgo = (now: Date, days: number) => new Date(now.getTime() - days * DAY_MS).toISOString().slice(0, 10);
const cveIds = (text: string) => [...new Set(text.match(/CVE-\d{4}-\d{4,}/g) ?? [])];

function toIsoDate(text: string): string | undefined {
  return calendarDate(text.trim()) ?? undefined;
}

// ---------- Apple ----------

export const APPLE_SECURITY_URL = 'https://support.apple.com/en-us/100100';
/** Releases that matter to app developers: the OS, the browser engine behind WKWebView, and the toolchain */
const APPLE_PRODUCTS = /^(?:iOS|iPadOS|Safari|Xcode)\b/;

/** Rows of Apple's "Security releases" table: name (+ advisory link), availability, release date */
export function parseAppleSecurityReleases(html: string, now = new Date(), days = 120): AppleSecurityRelease[] {
  const since = isoDaysAgo(now, days);
  // The release date's column by its header ("Release date"), not the last one: a column added at the end
  // would otherwise date every release
  const header = [...(html.match(/<tr[^>]*>(?:(?!<\/tr>)[\s\S])*?<th[\s\S]*?<\/tr>/)?.[0] ?? '').matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g)].map(c => cleanText(c[1]));
  const dateCol = header.findIndex(h => /release date/i.test(h));
  return [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].flatMap(row => {
    const cells = [...row[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(c => c[1]);
    if (cells.length < 3) return [];
    const name = cleanText(cells[0]).replace(/\s*This update has no published CVE entries\.?/i, '').trim();
    const date = toIsoDate(cleanText(cells[dateCol >= 0 ? dateCol : cells.length - 1] ?? ''));
    if (!APPLE_PRODUCTS.test(name) || !date || date < since) return [];
    const href = cells[0].match(/href="([^"]+)"/)?.[1];
    const url = href ? safeUrl(new URL(href, APPLE_SECURITY_URL).href) ?? undefined : undefined;
    return [{ name, url, date, exploited: [] }];
  });
}

/** CVE count and the CVEs Apple flags as possibly exploited, from one advisory page */
export function parseAppleAdvisory(html: string): Pick<AppleSecurityRelease, 'cves' | 'exploited'> {
  const text = cleanText(html);
  // Each entry is "Impact: … Description: … CVE-…"; the exploitation note sits in the Impact text
  const entries = text.split(/(?=\bImpact:)/);
  const exploited = entries.filter(e => /may have been exploited/i.test(e)).flatMap(e => cveIds(e).slice(0, 1));
  return { cves: cveIds(text).length, exploited: [...new Set(exploited)] };
}

export async function fetchAppleSecurity(now = new Date(), maxPages = 12): Promise<AppleSecurityRelease[]> {
  const releases = parseAppleSecurityReleases(await fetchHtml(APPLE_SECURITY_URL), now);
  // Advisory pages add CVE counts and exploitation notes; a failed page just leaves them out
  await Promise.all(releases.filter(r => r.url).slice(0, maxPages).map(async r => {
    try {
      Object.assign(r, parseAppleAdvisory(await fetchHtml(r.url!)));
    } catch (err) {
      console.warn(`[security] Apple advisory ${r.url} failed (${(err as Error).message})`);
    }
  }));
  return releases;
}

// ---------- Android ----------

export const ANDROID_BULLETINS_URL = 'https://source.android.com/docs/security/bulletin/asb-overview';

/** The overview table: bulletin link, languages, published date, security patch levels */
export function parseAndroidBulletinIndex(html: string, limit = 3): AndroidBulletin[] {
  // The table with a "Published" column (not just the page's first table), its columns found by their headers
  const tables = [...html.matchAll(/<table[\s\S]*?<\/table>/g)].map(m => m[0]);
  const headersOf = (table: string) => [...table.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g)].map(c => cleanText(c[1]));
  const table = tables.find(t => headersOf(t).some(h => /published/i.test(h))) ?? tables[0] ?? '';
  const headers = headersOf(table);
  const column = (pattern: RegExp, fallback: number) => {
    const i = headers.findIndex(h => pattern.test(h));
    return i >= 0 ? i : fallback;
  };
  // A header row without a "Published" column: the table changed, and position 2 might now hold anything
  // (the patch level read as a date). Only a table with no header row at all falls back to the old layout
  if (headers.length && !headers.some(h => /published/i.test(h))) throw new Error(`Android bulletin index: no "Published" column (headers: ${headers.join(' | ')})`);
  const publishedCol = column(/published/i, 2);
  const patchCol = column(/patch level/i, 3);
  return [...table.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].flatMap(row => {
    const cells = [...row[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(c => c[1]);
    const href = cells[0]?.match(/href="([^"]+)"/)?.[1];
    const published = cells[publishedCol] && toIsoDate(cleanText(cells[publishedCol]));
    if (!href || !published) return [];
    return [{
      title: `Android Security Bulletin ${cleanText(cells[0])}`,
      url: new URL(href, ANDROID_BULLETINS_URL).href.replace(/\.html$/, ''),
      published,
      patchLevels: cleanText(cells[patchCol] ?? '').match(/\d{4}-\d{2}-\d{2}/g) ?? [],
      exploited: [],
    }];
  }).slice(0, limit);
}

export function parseAndroidBulletin(html: string): Pick<AndroidBulletin, 'cves' | 'mostSevere' | 'exploited'> {
  const text = cleanText(html);
  const note = text.match(/indications that ([^.]*?) (?:may be|are) under limited, targeted exploitation/i)?.[1] ?? '';
  return {
    cves: cveIds(text).length,
    mostSevere: text.match(/The most severe of these issues is ([^.]+)\./)?.[1],
    exploited: cveIds(note),
  };
}

export async function fetchAndroidBulletins(): Promise<AndroidBulletin[]> {
  const bulletins = parseAndroidBulletinIndex(await fetchHtml(`${ANDROID_BULLETINS_URL}?hl=en`));
  if (!bulletins.length) throw new Error('No Android security bulletins found');
  await Promise.all(bulletins.map(async b => {
    try {
      Object.assign(b, parseAndroidBulletin(await fetchHtml(`${b.url}?hl=en`)));
    } catch (err) {
      console.warn(`[security] ${b.url} failed (${(err as Error).message})`);
    }
  }));
  return bulletins;
}

// ---------- CISA Known Exploited Vulnerabilities ----------

export const KEV_URL = 'https://www.cisa.gov/known-exploited-vulnerabilities-catalog';
const KEV_FEED = 'https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json';

interface KevEntry {
  cveID: string;
  vendorProject: string;
  product: string;
  vulnerabilityName: string;
  dateAdded: string;
  shortDescription: string;
  knownRansomwareCampaignUse?: string;
}

/** Products that run on phones or inside apps (Chromium covers Android WebView); macOS / Windows-only entries are left out */
function kevPlatform(e: KevEntry): SecurityPlatform | null {
  if (e.vendorProject === 'Apple') return /iOS|iPadOS|WebKit|Safari|Multiple Products/i.test(e.product) ? 'iOS' : null;
  if (e.vendorProject === 'Android' || (e.vendorProject === 'Google' && /Android|Pixel/i.test(e.product))) return 'Android';
  if (e.vendorProject === 'Google' && /Chromium|Skia|Dawn|ANGLE/i.test(e.product)) return '跨平台';
  return null;
}

export function parseKev(feed: { vulnerabilities?: KevEntry[] }, now = new Date(), days = 180): ExploitedVuln[] {
  const since = isoDaysAgo(now, days);
  // The catalog is over a thousand entries with ISO dates: anything else is a changed format, and an empty
  // result from it would read as "nothing exploited" rather than as a failure
  const all = feed.vulnerabilities;
  if (!Array.isArray(all) || all.length < 500) throw new Error(`CISA KEV: expected the full catalog, got ${Array.isArray(all) ? all.length : 'no'} entries`);
  if (all.filter(e => /^\d{4}-\d{2}-\d{2}$/.test(e?.dateAdded ?? '')).length < all.length * 0.9) throw new Error('CISA KEV: dateAdded is no longer YYYY-MM-DD');
  return all.flatMap(e => {
    const platform = kevPlatform(e);
    if (!platform || e.dateAdded < since) return [];
    return [{
      cve: e.cveID,
      platform,
      product: `${e.vendorProject} ${e.product}`,
      name: e.vulnerabilityName,
      dateAdded: e.dateAdded,
      description: e.shortDescription,
      ransomware: e.knownRansomwareCampaignUse === 'Known',
      url: `https://nvd.nist.gov/vuln/detail/${encodeURIComponent(e.cveID)}`,
    }];
  }).sort((a, b) => b.dateAdded.localeCompare(a.dateAdded));
}

export async function fetchExploited(now = new Date()): Promise<ExploitedVuln[]> {
  return parseKev(await fetchJson<{ vulnerabilities?: KevEntry[] }>(KEV_FEED, { headers: { Accept: 'application/json' } }, SLOW_NETWORK_TIMEOUT_MS, status => `CISA KEV HTTP ${status}`), now);
}

// ---------- GitHub Advisory Database ----------

export const ADVISORY_URL = 'https://github.com/advisories';

/** Package names as the advisory database spells them, per ecosystem */
export const SDK_PACKAGES: Array<{ name: string; platform: SecurityPlatform }> = [
  ...['cordova-ios', 'cordova-android', 'react-native', '@capacitor/core',
    ...['camera', 'inappbrowser', 'file', 'file-transfer', 'geolocation', 'media', 'network-information'].map(p => `cordova-plugin-${p}`)]
    .map(name => ({ name, platform: '跨平台' as const })),
  ...['webview_flutter', 'flutter_inappwebview', 'firebase_core'].map(name => ({ name, platform: '跨平台' as const })),
  ...['com.squareup.okhttp3:okhttp', 'com.squareup.retrofit2:retrofit', 'com.github.bumptech.glide:glide', 'com.facebook.android:facebook-android-sdk',
    'io.sentry:sentry-android', 'com.airbnb.android:lottie', 'io.coil-kt:coil'].map(name => ({ name, platform: 'Android' as const })),
  ...['Alamofire/Alamofire', 'SDWebImage/SDWebImage', 'onevcat/Kingfisher', 'firebase/firebase-ios-sdk', 'getsentry/sentry-cocoa', 'airbnb/lottie-ios', 'realm/realm-swift']
    .map(repo => ({ name: `github.com/${repo}`, platform: 'iOS' as const })),
];

interface GithubAdvisory {
  ghsa_id: string;
  cve_id?: string | null;
  html_url: string;
  summary: string;
  severity: string;
  published_at: string;
  withdrawn_at?: string | null;
  vulnerabilities?: Array<{ package?: { ecosystem?: string; name?: string }; vulnerable_version_range?: string | null; first_patched_version?: string | null }>;
}

const SEVERITIES = ['critical', 'high', 'medium', 'low'] as const;

export function parseAdvisories(items: GithubAdvisory[], limit = 50): SdkAdvisory[] {
  const tracked = new Map(SDK_PACKAGES.map(p => [p.name.toLowerCase(), p.platform]));
  return items.filter(a => !a.withdrawn_at).flatMap(a => {
    const packages = [...new Set((a.vulnerabilities ?? []).map(v => v.package?.name ?? '').filter(n => tracked.has(n.toLowerCase())))];
    const url = safeUrl(a.html_url);
    if (!packages.length || !url) return [];
    const platforms = new Set(packages.map(p => tracked.get(p.toLowerCase())!));
    return [{
      id: a.ghsa_id,
      cve: a.cve_id ?? undefined,
      severity: (SEVERITIES as readonly string[]).includes(a.severity) ? a.severity as SdkAdvisory['severity'] : 'unknown',
      summary: a.summary.trim(),
      published: a.published_at.slice(0, 10),
      packages,
      ranges: (a.vulnerabilities ?? [])
        .filter(v => v.package?.name && tracked.has(v.package.name.toLowerCase()))
        .map(v => ({ package: v.package!.name!, vulnerable: v.vulnerable_version_range ?? undefined, patched: v.first_patched_version ?? undefined })),
      platform: platforms.size === 1 ? [...platforms][0] : '跨平台',
      url,
    }];
  }).sort((a, b) => b.published.localeCompare(a.published)).slice(0, limit);
}

/** One request covers every tracked package; unauthenticated calls share GitHub's 60 / hour limit */
export async function fetchSdkAdvisories(): Promise<SdkAdvisory[]> {
  const headers = githubHeaders();
  const affects = SDK_PACKAGES.map(p => p.name).join(',');
  return parseAdvisories(await fetchJson<GithubAdvisory[]>(`https://api.github.com/advisories?type=reviewed&per_page=100&affects=${encodeURIComponent(affects)}`, { headers }, NETWORK_TIMEOUT_MS, status => `GitHub advisories HTTP ${status}`));
}

// ---------- Report ----------

export interface SecurityReportDeps {
  apple: () => Promise<AppleSecurityRelease[]>;
  android: () => Promise<AndroidBulletin[]>;
  exploited: () => Promise<ExploitedVuln[]>;
  advisories: () => Promise<SdkAdvisory[]>;
}

const SECURITY_DEPS: SecurityReportDeps = {
  apple: () => fetchAppleSecurity(),
  android: fetchAndroidBulletins,
  exploited: () => fetchExploited(),
  advisories: fetchSdkAdvisories,
};

/** Partial results are kept; throws only when every source failed */
export async function fetchSecurityReport(deps: SecurityReportDeps = SECURITY_DEPS): Promise<SecurityReport> {
  const { values } = await settleSources<unknown[]>('security', [
    ['Apple security releases', deps.apple],
    ['Android Security Bulletins', deps.android],
    ['CISA KEV', deps.exploited],
    ['GitHub advisories', deps.advisories],
  ]);
  return {
    apple: (values.get('Apple security releases') ?? []) as AppleSecurityRelease[],
    android: (values.get('Android Security Bulletins') ?? []) as AndroidBulletin[],
    exploited: (values.get('CISA KEV') ?? []) as ExploitedVuln[],
    advisories: (values.get('GitHub advisories') ?? []) as SdkAdvisory[],
  };
}

/**
 * Whether a version falls in an advisory's range such as "< 6.0.1" or ">= 2.0.0, < 2.4.1"
 * (comma-separated comparators, all must hold). Unknown syntax counts as not affected.
 */
export function inVersionRange(version: string, range: string | undefined): boolean {
  if (!range) return false;
  const parts = range.split(',').map(p => p.trim()).filter(Boolean);
  return parts.length > 0 && parts.every(part => {
    const m = part.match(/^(<=|>=|<|>|=)?\s*v?(\d+(?:\.\d+)*)$/);
    if (!m) return false;
    const diff = compareVersions(version.replace(/^v/, '').split('-')[0], m[2]);
    switch (m[1] ?? '=') {
      case '<': return diff < 0;
      case '<=': return diff <= 0;
      case '>': return diff > 0;
      case '>=': return diff >= 0;
      default: return diff === 0;
    }
  });
}
