import { safeUrl } from '../safe-url.js';
import { settleSources } from './settle.js';
import { fetchFeed } from './feed.js';
import { fetchJson, SLOW_NETWORK_TIMEOUT_MS } from '../net.js';
import { feedDay } from '../taipei-date.js';
import { forgetOtherNews, rememberNews } from '../history.js';
import { lastGood, rememberGood } from '../last-good.js';
import type { SecuritySourceState } from '../security-intelligence.js';

let securityNewsStates: SecuritySourceState[] = [];
export function lastSecurityNewsStates(): SecuritySourceState[] { return structuredClone(securityNewsStates); }

/**
 * Developer news from official feeds, merged into one timeline. Titles stay in their original
 * (English) wording; each item links to its source.
 */

export type NewsPlatform = 'iOS' | 'Android' | '跨平台';
export type NewsCategory = 'announcement' | 'release' | 'blog' | 'security';

export interface DevNewsItem {
  id: string;
  source: string;
  platform: NewsPlatform;
  category: NewsCategory;
  title: string;
  url: string;
  date: string; // YYYY-MM-DD
  important: boolean;
}

interface FeedItem {
  title?: string;
  link?: string;
  isoDate?: string;
  pubDate?: string;
  /** An Atom entry's <published> as written (feed.ts) */
  published?: string;
  content?: string;
}

interface NewsSource {
  id: string;
  name: string;
  url: string;
  platform: NewsPlatform;
  category: NewsCategory;
  /** Titles worth flagging for engineers (requirements, deadlines, outages, stable releases…) */
  important?: RegExp;
  /** Turns a raw feed item into title/url when the feed's own title isn't descriptive */
  transform?: (item: FeedItem) => { title: string; url?: string } | null;
  /** Only the newest N items of very long feeds */
  limit?: number;
  /** Keep only items whose title matches (e.g. mobile-relevant releases) */
  include?: RegExp;
  /** Drop items whose title matches (e.g. desktop-only security research) */
  exclude?: RegExp;
  /** The platform an item is about, from its title, when the feed covers every platform */
  platformOf?: (title: string) => NewsPlatform;
  /** At most this many of the feed's items in the merged list (default PER_SOURCE) */
  cap?: number;
  /** The feed holds only its newest few days: remember its items between refreshes (history.ts) */
  keep?: boolean;
  /** A JSON open-data file instead of RSS / Atom: turns its body into feed items */
  json?: (body: unknown) => FeedItem[];
}

const REQUIREMENTS = /requirement|deadline|deprecat|must|policy|expir|privacy|breaking|security|outage|incident|migrat|end of (?:life|support)/i;

/**
 * Security feeds cover every platform; a title that names only Apple's or only Android's side is filed there.
 * "Protecting Chrome and Android users…" names Android only → Android; one naming both stays cross-platform.
 */
export function securityPlatform(title: string): NewsPlatform {
  const ios = /\b(?:iOS|iPadOS|iPhone|iPad|Apple|WebKit|Safari|Swift|Xcode)\b/i.test(title);
  const android = /\b(?:Android|Pixel|Kotlin|Google Play|Play Integrity)\b/i.test(title);
  return ios === android ? '跨平台' : ios ? 'iOS' : 'Android';
}

/** Security posts engineers should act on or know about: exploited bugs, CVEs, compromised or distrusted certificates, supply-chain attacks, disclosure policy */
const SECURITY_IMPORTANT = /\bCVE-\d|0-click|zero-click|zero-day|0-day|exploited|in the wild|vulnerabilit(?:y|ies) (?:announced|disclosed)|compromised|revok|distrust|supply[- ]chain|malware|disclosure policy|policy and disclosure/i;

/**
 * Taiwan financial-security items in the FSC's and its Banking Bureau's press releases: unauthorised transfers,
 * banks / brokers / payment firms hacked or leaking data, phishing,
 * scam apps and banks' anti-fraud measures. Titles are Chinese, so no word boundaries.
 */
export const TW_FIN_SECURITY = /盜轉|盜領|防詐|阻詐|打詐|盜刷|盜用|網銀|網路銀行|行動銀行|非約定轉帳|OTP|簡訊驗證碼|釣魚|惡意(?:程式|App|軟體)|木馬|(?:銀行|金融|金控|證券|券商|支付|保險|信用卡|信合社|信用合作社).{0,20}(?:駭|資安|入侵|外洩|漏洞|勒索|攻擊|異常轉帳)|(?:駭|資安|入侵|外洩|勒索).{0,20}(?:銀行|金融|金控|證券|券商|支付|保險|信用卡|信用合作社)|(?:App|手機|簡訊|Android|iPhone|LINE).{0,12}詐|詐.{0,12}(?:App|手機|簡訊|Android|iPhone|LINE)/i;

/**
 * TVN (Taiwan Vulnerability Note) titles are "vendor｜product - flaw", mostly Taiwanese enterprise web systems;
 * only the ones about mobile apps or financial products are relevant here.
 */
export const TVN_MOBILE_FIN = /Android|iOS|iPhone|iPad|行動(?:應用|裝置|版|App|銀行|支付)|手機|(?:^|[^A-Za-z])App(?![A-Za-z])|銀行|金融|支付|電子錢包|證券|保險/i;

/** The ones about money actually taken or systems actually breached */
const TW_FIN_IMPORTANT = /盜轉|盜領|盜刷|盜用|遭駭|駭客|入侵|外洩|勒索|漏洞|惡意(?:程式|App|軟體)|木馬|異常轉帳/;

/**
 * The Administration for Cyber Security's press releases (數位發展部資通安全署, open data, CC0): a JSON array of
 * { 來源網址, 標題, 發布日期 (Taipei time, no zone), … }. Rows without a title or link are skipped.
 */
export function acsPressItems(body: unknown): FeedItem[] {
  if (!Array.isArray(body)) throw new Error('ACS press releases: not a JSON array');
  return body.flatMap(row => {
    const r = row as Record<string, unknown>;
    const title = typeof r['標題'] === 'string' ? r['標題'] : '';
    const link = typeof r['來源網址'] === 'string' ? r['來源網址'] : '';
    const date = typeof r['發布日期'] === 'string' ? r['發布日期'] : '';
    return title && link && date ? [{ title, link, pubDate: date }] : [];
  }).sort((a, b) => b.pubDate.localeCompare(a.pubDate));
}

/** A GitHub releases list (REST API): published releases only, no drafts or pre-releases */
export function githubReleaseItems(body: unknown): FeedItem[] {
  if (!Array.isArray(body)) throw new Error('GitHub releases: not a JSON array');
  return body.flatMap(row => {
    const r = row as { tag_name?: unknown; name?: unknown; html_url?: unknown; published_at?: unknown; draft?: unknown; prerelease?: unknown };
    const title = typeof r.name === 'string' && r.name.trim() ? r.name : typeof r.tag_name === 'string' ? r.tag_name : '';
    if (r.draft || r.prerelease || !title || typeof r.html_url !== 'string' || typeof r.published_at !== 'string') return [];
    return [{ title, link: r.html_url, isoDate: r.published_at }];
  });
}

/** ACS releases engineers act on: urgent patches, exploited flaws, breaches, ransomware (fraud reminders are routine) */
const ACS_IMPORTANT = /重大(?:安全)?(?:更新|漏洞)|籲.{0,16}(?:儘速|盡速|加速|立即)|緊急安全更新|遭.{0,4}利用|已遭攻擊|CVE-\d|零時差|外洩|勒索|入侵/;
/** Ceremonies, talks, calendars and recruiting: not news an app team needs */
const ACS_EXCLUDE = /月曆|演講|登台|致詞|頒獎|徵選|招生|研討會|論壇|年會|峰會|座談|說明會|交流|簽署|合作備忘錄|MOU|展覽|資安週|大會|揭幕|開幕|金盾獎|報名|輔導|稽核|會議/i;

/**
 * The FSC Banking Bureau's penalties that touch information security or customer data (leaks, hacking,
 * personal-data safeguards, fraud). Most penalties are about lending or AML and are left out.
 */
export const BANK_PENALTY_SECURITY = /資訊|資安|系統(?!性)|網路|網站|網銀|行動銀行|電子銀行|個資|個人資料|客戶資料|盜|詐|釣魚|駭|OTP|驗證/;

/** The FSC's feed escapes the & in its links twice ("&amp;amp;"), so the parsed link still reads "&amp;" */
export function fscTitle(item: FeedItem): { title: string; url?: string } | null {
  return { title: (item.title ?? '').trim(), url: item.link?.replace(/&amp;/g, '&') };
}

/** AndroidX entries are titled with a date; list the libraries instead, stable releases first */
export function androidxTitle(item: FeedItem): { title: string; url?: string } | null {
  const libs = [...(item.content ?? '').matchAll(/>([^<>]+?) Version ([\w.-]+)</g)].map(m => ({ name: m[1].trim(), version: m[2] }));
  if (!libs.length) return null;
  const isStable = (v: string) => !/alpha|beta|rc|dev/i.test(v);
  const ordered = [...libs.filter(l => isStable(l.version)), ...libs.filter(l => !isStable(l.version))];
  const shown = ordered.slice(0, 3).map(l => `${l.name} ${l.version}`).join(', ');
  return { title: `AndroidX: ${shown}${libs.length > 3 ? ` +${libs.length - 3} more` : ''}`, url: item.link };
}

export const NEWS_SOURCES: NewsSource[] = [
  { id: 'apple-news', name: 'Apple Developer News', url: 'https://developer.apple.com/news/rss/news.rss', platform: 'iOS', category: 'announcement',
    important: /requirement|deadline|expir|must|submit|prepare|agreement|privacy|SDK|certificate|review guideline|deprecat|update.*(?:policy|terms)/i },
  { id: 'apple-releases', name: 'Apple Developer Releases', url: 'https://developer.apple.com/news/releases/rss/releases.rss', platform: 'iOS', category: 'release',
    // Mobile-relevant releases only (iPadOS / macOS / tvOS builds mirror the iOS ones)
    include: /^(?:iOS|Xcode|App Store Connect|TestFlight|watchOS|visionOS|Swift)\b/i,
    // Final releases of iOS and Xcode, not every beta
    important: /^(?:iOS|Xcode)\s+[\d.]+\s*(?:\([\w]+\))?$/i },
  { id: 'swift', name: 'Swift.org', url: 'https://www.swift.org/atom.xml', platform: 'iOS', category: 'blog', important: /released|announcing|swift \d/i },
  { id: 'android-blog', name: 'Android Developers Blog', url: 'https://developer.android.com/blog/atom.xml', platform: 'Android', category: 'announcement',
    important: /policy|target api|targetSdk|deprecat|requirement|deadline|migrat|16 ?KB|breaking|behavior change|Android \d+(?: QPR\d)? (?:beta|developer preview|is here|release)/i },
  { id: 'android-studio', name: 'Android Studio', url: 'https://androidstudio.googleblog.com/feeds/posts/default', platform: 'Android', category: 'release',
    // Stable Android Studio releases, not canaries or betas
    important: /^Android Studio (?!.*(?:Canary|Beta|RC)).*now available$/i },
  { id: 'androidx', name: 'AndroidX (Jetpack)', url: 'https://developer.android.com/feeds/androidx-release-notes.xml', platform: 'Android', category: 'release',
    transform: androidxTitle },
  { id: 'kotlin', name: 'Kotlin Blog', url: 'https://blog.jetbrains.com/kotlin/feed/', platform: 'Android', category: 'blog', important: /released|kotlin \d+\.\d+|deprecat|discontinu/i },
  { id: 'cordova', name: 'Apache Cordova', url: 'https://cordova.apache.org/feed.xml', platform: '跨平台', category: 'release',
    // Security fixes and new platform majors (which carry breaking changes)
    important: /CVE-\d|security|Cordova (?:iOS|Android) \d+\.0\.0/i },
  { id: 'firebase', name: 'Firebase Blog', url: 'https://firebase.blog/rss.xml', platform: '跨平台', category: 'blog', limit: 30 },
  // Security news. Google's security blog moved from security.googleblog.com in 2026 (the old feed stopped in April)
  { id: 'google-security', name: 'Google Security Blog', url: 'https://blog.google/security/rss/', platform: '跨平台', category: 'security',
    important: SECURITY_IMPORTANT, platformOf: securityPlatform },
  // Moved from googleprojectzero.blogspot.com; Windows-only research doesn't touch mobile apps
  { id: 'project-zero', name: 'Google Project Zero', url: 'https://projectzero.google/feed.xml', platform: '跨平台', category: 'security',
    important: SECURITY_IMPORTANT, platformOf: securityPlatform, exclude: /\bWindows\b|\bWin32\b|Hyper-V|\bNTFS\b/i },
  { id: 'github-security', name: 'GitHub Security Blog', url: 'https://github.blog/security/feed/', platform: '跨平台', category: 'security',
    important: SECURITY_IMPORTANT, platformOf: securityPlatform },
  // The mobile app security standard (MASVS) that app security tests check against: a new version changes the checks
  // (from GitHub's API: github.com's robots.txt disallows the releases.atom feed)
  { id: 'masvs', name: 'OWASP MASVS', url: 'https://api.github.com/repos/OWASP/masvs/releases?per_page=10', platform: '跨平台', category: 'security',
    json: githubReleaseItems, transform: item => ({ title: `OWASP MASVS ${(item.title ?? '').trim()} 發布`, url: item.link }), important: /MASVS v?\d+\.0\.0\b/ },
  // Taiwan financial security (盜轉, banks hacked, scam apps), only from the authorities themselves (first-hand,
  // no news media), picked by keyword. Each gets its own cap: a busy week of incidents shouldn't push them out.
  { id: 'fsc', name: '金管會新聞稿', url: 'https://www.fsc.gov.tw/RSS/Messages?serno=201202290009&language=chinese', platform: '跨平台', category: 'security',
    include: TW_FIN_SECURITY, important: TW_FIN_IMPORTANT, platformOf: securityPlatform, transform: fscTitle, cap: 20 },
  // TWCERT/CC's vulnerability notes for Taiwanese products (first-hand; its news section mostly retells foreign
  // reports, so it isn't used). The 20 items cover about a month, so the few that match are remembered.
  { id: 'twcert-tvn', name: 'TWCERT/CC 漏洞公告', url: 'https://www.twcert.org.tw/tw/rss-132-1.xml', platform: '跨平台', category: 'security',
    include: TVN_MOBILE_FIN, important: /./, platformOf: securityPlatform, keep: true },
  // The FSC Banking Bureau: its press releases (anti-fraud measures, notices) and its penalties on banks over
  // security or customer-data failures; both feeds go back months.
  { id: 'banking-news', name: '金管會銀行局新聞稿', url: 'https://www.banking.gov.tw/RSS/banking/Messages?serno=201203060004&language=chinese', platform: '跨平台', category: 'security',
    include: TW_FIN_SECURITY, important: TW_FIN_IMPORTANT, platformOf: securityPlatform, transform: fscTitle, cap: 20 },
  { id: 'banking-penalty', name: '金管會銀行局裁罰', url: 'https://www.banking.gov.tw/RSS/banking/Messages?serno=201203060002&language=chinese', platform: '跨平台', category: 'security',
    include: BANK_PENALTY_SECURITY, important: TW_FIN_IMPORTANT, platformOf: securityPlatform, transform: fscTitle, cap: 20 },
  // The Administration for Cyber Security (數位發展部資通安全署): Taiwan's government security notices, from its open-data JSON
  { id: 'acs', name: '數位發展部資安署', url: 'https://www-api.moda.gov.tw/OpenData/json/23', platform: '跨平台', category: 'security',
    json: acsPressItems, exclude: ACS_EXCLUDE, important: ACS_IMPORTANT, platformOf: securityPlatform, cap: 20 },
];

/** Items per feed in the merged list, unless the feed sets its own cap */
const PER_SOURCE = 12;

const toDate = (item: FeedItem) => {
  return feedDay(item.published ?? item.pubDate ?? item.isoDate) ?? '';
};

export function parseSourceItems(source: NewsSource, items: FeedItem[]): DevNewsItem[] {
  return items.slice(0, source.limit ?? items.length).flatMap(item => {
    const shaped = source.transform ? source.transform(item) : { title: (item.title ?? '').trim(), url: item.link };
    if (source.include && !source.include.test(shaped?.title ?? '')) return [];
    if (source.exclude?.test(shaped?.title ?? '')) return [];
    const url = safeUrl(shaped?.url);
    const date = toDate(item);
    if (!shaped?.title || !url || !date) return [];
    const title = shaped.title.replace(/\s+/g, ' ');
    return [{
      id: `${source.id}:${url}`,
      source: source.name,
      platform: source.platformOf?.(title) ?? source.platform,
      category: source.category,
      title,
      url,
      date,
      // Security feeds use their own rules: the shared ones flag every title saying "security" or "policy"
      important: (source.important?.test(title) ?? false) || (source.category !== 'security' && REQUIREMENTS.test(title)),
    }];
  });
}

export { decodeFeedBody } from './feed.js';

/** An empty feed means its format changed (or the address now serves something else); that is a failure */
async function fetchSource(source: NewsSource): Promise<DevNewsItem[]> {
  const items = source.json
    ? source.json(await fetchJson<unknown>(source.url, {}, SLOW_NETWORK_TIMEOUT_MS, status => `${source.name} HTTP ${status}`))
    : (await fetchFeed(source.url)).items as FeedItem[];
  if (!items.length) throw new Error('feed parsed empty');
  return parseSourceItems(source, items);
}

/**
 * Newest first, within the last `days`, de-duplicated by URL (and security items by title), at most `perSource` items from each feed. The
 * overall limit leaves room for the security feeds without pushing out older developer news (it was 80 before them, 140 before TWCERT/CC).
 * `perSource` is one cap for every list, or a function giving each list its own
 */
export function mergeNews(lists: DevNewsItem[][], now = new Date(), days = 60, limit = 160, perSource: number | ((list: DevNewsItem[]) => number) = PER_SOURCE): DevNewsItem[] {
  const since = new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const seen = new Set<string>();
  // The FSC and its Banking Bureau publish the same press release under different URLs: one copy per title.
  // Only for security items, where that happens; other feeds' items are told apart by URL alone
  const titles = new Set<string>();
  const firstTitle = (item: DevNewsItem) => item.category !== 'security' || (!titles.has(item.title) && !!titles.add(item.title));
  const capOf = typeof perSource === 'number' ? () => perSource : perSource;
  return lists.map(list => list.filter(item => item.date >= since).sort((a, b) => b.date.localeCompare(a.date)).slice(0, capOf(list))).flat()
    .filter(item => item.date >= since && !seen.has(item.url) && seen.add(item.url) && firstTitle(item))
    .sort((a, b) => b.date.localeCompare(a.date) || Number(b.important) - Number(a.important))
    .slice(0, limit);
}

/**
 * Partial results are fine; fails only when every feed failed. A `keep` feed's items are added to the ones
 * remembered from earlier refreshes (and a failed keep feed still shows what was remembered). An include
 * filter can leave a feed with nothing to show this time, so an empty list counts as an answer, not a failure.
 */
export async function fetchDevNews(
  sources = NEWS_SOURCES,
  fetcher: (s: NewsSource) => Promise<DevNewsItem[]> = fetchSource,
  remember: (feedId: string, items: DevNewsItem[], now: Date) => DevNewsItem[] = rememberNews,
  now = new Date(),
  forget: (keepIds: string[]) => void = forgetOtherNews,
): Promise<DevNewsItem[]> {
  const statuses: SecuritySourceState[] = [];
  securityNewsStates = statuses;
  const { values } = await settleSources('dev news', sources.map(s => [s.name, async () => {
    const previous = lastGood<{ at: string }>(`security-news:${s.id}`, now);
    try {
      const items = await fetcher(s);
      if (!items.length && !s.include) throw new Error('returned no usable data');
      if (s.category === 'security') {
        statuses.push({ id: `news:${s.id}`, label: s.name, url: s.url, status: 'ok', checkedAt: now.toISOString(), lastSuccessAt: now.toISOString(), count: items.length });
        rememberGood(`security-news:${s.id}`, { at: now.toISOString() }, now);
      }
      return { source: s, items };
    } catch (error) {
      if (s.category === 'security') statuses.push({ id: `news:${s.id}`, label: s.name, url: s.url, status: 'failed', checkedAt: now.toISOString(),
        lastSuccessAt: previous?.fetchedAt, count: 0, error: String((error as Error).message).slice(0, 300) });
      throw error;
    }
  }] as const),
    r => r.items.length > 0 || !!r.source.include);
  const lists = sources.map(s => {
    const fetched = values.get(s.name)?.items;
    return s.keep ? remember(s.id, fetched ?? [], now) : fetched ?? [];
  });
  forget(sources.filter(s => s.keep).map(s => s.id));
  const caps = new Map(sources.map(s => [s.id, s.cap ?? PER_SOURCE]));
  return mergeNews(lists, now, 60, 160, list => caps.get(list[0]?.id.slice(0, list[0].id.indexOf(':')) ?? '') ?? PER_SOURCE);
}
