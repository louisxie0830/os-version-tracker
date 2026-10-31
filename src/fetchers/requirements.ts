import { cleanText, columnsOf, fetchHtml, parseTables } from './html-table.js';
import type { Deadline } from '../types.js';
import { lastPossibleDay, monthOnlyNote } from '../deadline-dates.js';
import { calendarDate, feedDay, taipeiToday } from '../taipei-date.js';
import { fetchFeed } from './feed.js';
import { APPLE_NEWS_RSS_URL } from './apple-deadline.js';
import { compareVersions } from '../versions.js';

const APPLE_NEWS_URL = 'https://developer.apple.com/news/';
export const APPLE_REQUIREMENTS_URL = 'https://developer.apple.com/news/upcoming-requirements/';
export const PLAY_POLICY_URL = 'https://support.google.com/googleplay/android-developer/table/12921780?hl=en';
// Another official English localisation; only tried after a 429, never for ordinary parse errors.
export const PLAY_POLICY_FALLBACK_URL = 'https://support.google.com/googleplay/android-developer/table/12921780?hl=en-GB';
export const PLAY_BILLING_URL = 'https://developer.android.com/google/play/billing/deprecation-faq?hl=en';
export const PAGE_SIZE_URL = 'https://developer.android.com/guide/practices/page-sizes?hl=en';

const isoDate = (text: string): string => calendarDate(text) ?? '';

/** The text, cut at a sentence end before `max` characters when it's longer (an ellipsis if no sentence fits) */
function upTo(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('。'));
  return end > max / 3 ? cut.slice(0, end + 1) : `${cut.slice(0, max - 1)}…`;
}

function firstSentence(text: string, max = 220): string {
  const sentence = text.match(/^.+?[.!?](?=\s|$)/)?.[0] ?? text;
  return sentence.length > max ? `${sentence.slice(0, max - 1)}…` : sentence;
}

/**
 * App Store Connect's release notes: requirements announced there that the Upcoming Requirements page doesn't
 * list (screenshots for a new device "starting April 2027", say)
 */
export const ASC_RELEASE_NOTES_URL = 'https://developer.apple.com/help/app-store-connect/release-notes/';

export async function fetchAppleRequirements(now = new Date()): Promise<Deadline[]> {
  const [upcoming, notes, news] = await Promise.all([
    fetchHtml(APPLE_REQUIREMENTS_URL),
    // Extra requirements: without them the Upcoming Requirements still stand
    fetchHtml(ASC_RELEASE_NOTES_URL).then(html => parseAscReleaseNotes(html, now), err => {
      console.warn(`[appleRequirements] App Store Connect release notes failed (${(err as Error)?.message ?? err}); upcoming requirements only this time`);
      return [];
    }),
    // The same feed the news section reads (one download per refresh)
    fetchFeed(APPLE_NEWS_RSS_URL).then(feed => parseAppleNewsRequirements(feed.items as AppleNewsPost[], now), err => {
      console.warn(`[appleRequirements] Apple Developer News failed (${(err as Error)?.message ?? err}); upcoming requirements without it this time`);
      return [];
    }),
  ]);
  return mergeAppleRequirements(parseAppleRequirements(upcoming), notes, news);
}

/**
 * The same requirement on several pages (a release note or a news post gives a month, Upcoming Requirements later
 * a day): the Upcoming Requirements entry is enough, then the release note. Same month and a distinctive word in
 * common means the same one; the source's own prefix ("Apple Developer News：", "App Store Connect："), our
 * "（Apple 只公布月份：…）" note, Apple's name and month names say nothing about which requirement it is.
 */
export function mergeAppleRequirements(items: Deadline[], notes: Deadline[], news: Deadline[]): Deadline[] {
  const words = (d: Deadline) => new Set(`${d.title.replace(/^[^：]+：/, '').replace(/^macOS：/, '')} ${d.detail.replace(/（[^）]*只公布[^）]*）/g, '')}`.toLowerCase().match(/[a-z][a-z0-9]{4,}/g) ?? []);
  const COMMON = new RegExp(`^(?:starting|beginning|apps?|games?|submitted|include|requirements?|store|connect|apple|developers?|news|${MONTH_NAMES.join('|').toLowerCase()})$`);
  const same = (n: Deadline, i: Deadline) => n.date.slice(0, 7) === i.date.slice(0, 7)
    && [...words(n)].some(w => !COMMON.test(w) && words(i).has(w));
  const listed = [...items, ...notes.filter(n => !items.some(i => same(n, i)))];
  return [...listed, ...news.filter(n => !listed.some(i => same(n, i)))];
}

export interface AppleNewsPost {
  title?: string;
  link?: string;
  contentSnippet?: string;
  content?: string;
  pubDate?: string;
}

/**
 * Dated requirements announced in Apple Developer News posts and nowhere else: "The original Developer ID
 * Certification Authority (Sub-CA) expires on February 1, 2027", "Starting February 1, 2027, .pkg files signed
 * with an affected certificate will no longer install". Only dates ahead, only sentences that ask for or warn of
 * something (must, need to, will no longer, expires …); one item per post and date. The SDK minimum ("need to
 * meet the following minimum requirements") is left to the App Store deadline, which reads it in full.
 */
export function parseAppleNewsRequirements(posts: AppleNewsPost[], now = new Date()): Deadline[] {
  const today = taipeiToday(now);
  const MONTH = MONTH_NAMES.join('|');
  const dated = new RegExp(`\\b(?:Starting|Beginning|As of|From|after|before|by|on|until)\\s+(${MONTH})(?:\\s+(\\d{1,2}),)?\\s+(20\\d{2})\\b`, 'i');
  const acts = /\b(?:must|need to|will no longer|will stop|stop working|will fail|will be required|are required|is required|expires?)\b/i;
  const byPostAndDay = new Map<string, Deadline & { sentences: string[] }>();
  for (const post of posts) {
    const text = (post.contentSnippet ?? post.content ?? '').replace(/\u00a0/g, ' ');
    for (const sentence of text.split(/(?<=[.!?])\s+|\n+/).map(t => t.trim()).filter(Boolean)) {
      const m = sentence.match(dated);
      if (!m || !acts.test(sentence) || /minimum requirements/i.test(sentence)) continue;
      const month = MONTH_NAMES.findIndex(n => n.toLowerCase() === m[1].toLowerCase()) + 1;
      const date = m[2] ? calendarDate(`${m[1]} ${m[2]}, ${m[3]}`) : `${m[3]}-${String(month).padStart(2, '0')}-01`;
      if (!date || lastPossibleDay({ date, detail: m[2] ? '' : '只公布月份' }) < today) continue;
      const key = `${post.link ?? post.title}|${date}`;
      const entry = byPostAndDay.get(key) ?? {
        platform: 'iOS' as const,
        date,
        // Only Mac software is affected (Developer ID signing, installer packages): said up front, the item
        // still being Apple's ('iOS' is the timeline's Apple side)
        title: `Apple Developer News：${/\bDeveloper ID\b|\.pkg\b|\bmacOS\b|\bMac apps?\b/.test(`${post.title} ${text}`) && !/\biOS\b|\biPadOS\b|\biPhone\b/.test(`${post.title} ${text}`) ? 'macOS：' : ''}${(post.title ?? '').trim()}`,
        detail: '',
        source: 'Apple Developer News',
        url: post.link && /^https:\/\//.test(post.link) ? post.link : APPLE_NEWS_URL,
        sentences: [],
        ...(m[2] ? {} : { monthOnly: `${m[1]} ${m[3]}` }),
      };
      if (!entry.sentences.includes(sentence)) entry.sentences.push(sentence);
      byPostAndDay.set(key, entry);
    }
  }
  return [...byPostAndDay.values()].map(({ sentences, ...d }) => {
    const { monthOnly, ...deadline } = d as typeof d & { monthOnly?: string };
    const announced = feedDay(posts.find(p => p.link === d.url || d.title.endsWith(`：${(p.title ?? '').trim()}`))?.pubDate);
    return {
      ...deadline,
      detail: `${upTo(sentences.join(' '), 500)}${monthOnly ? monthOnlyNote('Apple', d.date) : ''}${announced ? `（${announced} 公告）` : ''}`,
    };
  });
}

/**
 * Requirements with a date ahead in the App Store Connect release notes (one dated <article> per note): a
 * sentence like "Starting April 2027, any apps or games submitted will need to include screenshots for iPhone Duo".
 * A month without a day is dated the first of the month, and the detail says only the month was announced.
 */
const COMMON_NAMES = new Set(['App', 'Apps', 'Store', 'Connect', 'Apple', 'Any', 'All', 'New', 'Starting', 'Beginning', 'From', 'As', 'Learn', 'More', 'The', 'Games', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']);
/** A requirement's names: product names and versions ("iOS 27" → ["iOS 27"], "iPhone Duo" → ["iPhone Duo"]) */
const distinctiveNames = (text: string) => [...text.matchAll(/\b(?:[A-Za-z]*[A-Z][A-Za-z]*)(?: (?:[A-Z][A-Za-z]*|\d+(?:\.\d+)?))*/g)]
  .map(m => m[0].split(' ').filter(w => !COMMON_NAMES.has(w)).join(' '))
  .filter(n => n && /\d|\s|[a-z][A-Z]/.test(n));

export function parseAscReleaseNotes(html: string, now = new Date()): Deadline[] {
  const articles = [...html.matchAll(/<article\b[^>]*\bid="(\d{8}[a-z])"[^>]*>([\s\S]*?)<\/article>/g)];
  if (articles.length < 5) throw new Error(`App Store Connect release notes: only ${articles.length} dated notes (the page changed?)`);
  const today = taipeiToday(now);
  const MONTH = MONTH_NAMES.join('|');
  const out: Deadline[] = [];
  for (const [, id, body] of articles) {
    const text = cleanText(body);
    for (const sentence of text.split(/(?<=\.)\s+(?=[A-Z])/)) {
      const m = sentence.match(new RegExp(`\\b(?:Starting|Beginning|From|As of)\\s+(${MONTH})(?:\\s+(\\d{1,2}),)?\\s+(20\\d{2}),\\s+(.*?\\b(?:will need to|must|need to|are required|is required|will be required)\\b.*)$`, 'i'));
      if (!m) continue;
      const month = MONTH_NAMES.findIndex(n => n.toLowerCase() === m[1].toLowerCase()) + 1;
      const date = m[2] ? calendarDate(`${m[1]} ${m[2]}, ${m[3]}`) : `${m[3]}-${String(month).padStart(2, '0')}-01`;
      // Still listed on the day it starts, and (a month only) until that month is over
      if (!date || lastPossibleDay({ date, detail: m[2] ? '' : '只公布月份' }) < today) continue;
      const requirement = upTo(m[4].charAt(0).toUpperCase() + m[4].slice(1), 300);
      // Repeated in later notes, maybe reworded: the newest note (first on the page) is kept. Reworded means the
      // same day and a name in common ("iOS 27", "Xcode 27", "iPhone Duo"), not just "apps" or "App Store"
      const names = distinctiveNames(requirement);
      if (out.some(o => o.date === date && (o.detail.startsWith(requirement) || distinctiveNames(o.detail.replace(/（[^）]*只公布[^）]*）/g, '')).some(n => names.includes(n))))) continue;
      out.push({
        platform: 'iOS',
        date,
        title: `App Store Connect：${upTo(requirement.replace(/\.$/, ''), 80)}`,
        detail: `${requirement}${m[2] ? '' : monthOnlyNote('Apple', date)}`,
        source: 'App Store Connect release notes',
        url: `${ASC_RELEASE_NOTES_URL}#${id}`,
      });
    }
  }
  return out;
}

export function parseAppleRequirements(html: string): Deadline[] {
  const items: Deadline[] = [];
  // One article per "article-title" link, up to the next one; attribute order, extra attributes and whitespace
  // between the tags don't matter, nor which element carries the date and the text
  // A class token exactly ("article-text", not "article-text-wrapper"), on any element, up to that element's end
  const cls = (name: string) => String.raw`class="(?:[^"]*\s)?${name}(?:\s[^"]*)?"`;
  const element = (name: string) => new RegExp(String.raw`<(\w+)[^>]*${cls(name)}[^>]*>([\s\S]*?)<\/\1>`);
  const re = new RegExp(String.raw`<a\b([^>]*${cls('article-title')}[^>]*)>\s*<h2[^>]*>([\s\S]*?)<\/h2>\s*<\/a>([\s\S]*?)(?=<a\b[^>]*${cls('article-title')}|$)`, 'g');
  for (const m of html.matchAll(re)) {
    const [, attrs, title, block] = m;
    const href = attrs.match(/\bhref="([^"]+)"/)?.[1];
    const when = block.match(element('article-date'))?.[2];
    const body = block.match(element('article-text'))?.[2] ?? '';
    if (!href || !when) continue;
    const whenText = cleanText(when).replace(/^(Since|Starting|Beginning)\s+/i, '');
    // A month only ("April 2027"): its first day, the detail saying so
    const month = whenText.match(new RegExp(`^(${MONTH_NAMES.join('|')}) (20\\d{2})$`, 'i'));
    const date = isoDate(whenText) || (month ? `${month[2]}-${String(MONTH_NAMES.findIndex(n => n.toLowerCase() === month[1].toLowerCase()) + 1).padStart(2, '0')}-01` : '');
    if (!date) {
      console.warn(`[appleRequirements] "${cleanText(title)}": date "${whenText}" not understood; left out`);
      continue;
    }
    items.push({
      platform: 'iOS',
      date,
      title: cleanText(title),
      // The whole requirement, what to do included (its first sentence alone often stopped mid-list)
      detail: `${upTo(cleanText(body).replace(/\s*Learn (?:about|more|how)[\s\S]*$/, ''), 450)}${month ? monthOnlyNote('Apple', date) : ''}`,
      source: 'Apple Upcoming Requirements',
      url: new URL(href, APPLE_REQUIREMENTS_URL).toString(),
    });
  }
  if (!items.length) throw new Error('No Apple requirements parsed');
  return items;
}

/**
 * Play Console's technical quality requirements: dated requirements that aren't in the policy deadline table
 * (code optimization with R8: obfuscation, optimization and shrinking; memory use; restoring sign-in)
 */
export const PLAY_TECH_QUALITY_URL = 'https://support.google.com/googleplay/android-developer/answer/17492799?hl=en';

/** Android developer verification: apps on certified devices must come from verified developers, by region and date */
export const DEVELOPER_VERIFICATION_URL = 'https://developer.android.com/developer-verification/guides?hl=en';

export async function fetchPlayPolicyDeadlines(): Promise<Deadline[]> {
  const optional = (what: string, url: string, parse: (html: string) => Deadline[]) => fetchHtml(url).then(parse, err => {
    console.warn(`[playPolicy] ${what} failed (${(err as Error)?.message ?? err}); policy deadlines without it this time`);
    return [] as Deadline[];
  });
  const [policies, quality, verification] = await Promise.all([
    fetchPolicyTable(),
    // Pages with the same kind of requirement: without them the policy deadlines still stand
    optional('technical quality requirements', PLAY_TECH_QUALITY_URL, parsePlayTechnicalQuality),
    optional('developer verification', DEVELOPER_VERIFICATION_URL, parseDeveloperVerification),
  ]);
  return [...policies, ...quality, ...verification];
}

/**
 * When developer verification takes effect: "Starting September 30, 2026, … go live for users in Brazil, …" (an
 * exact day), and "… expand these protections globally … in 2027" (a year only: dated January 1st, with the
 * detail saying so)
 */
export function parseDeveloperVerification(html: string): Deadline[] {
  const text = cleanText(html);
  const out: Deadline[] = [];
  const base = { platform: 'Android' as const, source: 'Android developer verification', url: DEVELOPER_VERIFICATION_URL };
  for (const m of text.matchAll(/Starting ([A-Z][a-z]+ \d{1,2}, \d{4}), ([^.]*?developer verification[^.]*?)(?:for users )?in ([A-Z][^.]*?)\./g)) {
    const date = calendarDate(m[1]);
    if (!date) continue;
    out.push({ ...base, date, title: `Android 開發者驗證：${m[3].replace(/, and /, '、').replace(/, /g, '、')} 開始實施`, detail: upTo(`${m[0]} 在這些地區的認證裝置上安裝的 App（包含 Play 以外的 APK）須來自已驗證的開發者；Play 上的 App 大多已自動註冊，請在 Play Console 首頁確認。`, 450) });
  }
  // The clause itself: a list of app stores runs into it without a full stop, so it starts at the last closing
  // bracket or the start of the sentence, whichever is later
  // Found by plain search, then cut to its clause (from the last "." or ")" before "globally" to the next "."): a
  // pattern scanning for it would rescan a long stretch without full stops from every position
  const global = (() => {
    for (const { index: at = 0 } of text.matchAll(/\bglobally\b/g)) {
      const start = Math.max(text.lastIndexOf('.', at), text.lastIndexOf(')', at)) + 1;
      const end = text.indexOf('.', at);
      if (end < 0) return null;
      const clause = text.slice(start, end);
      const year = clause.slice(at - start).match(/\bin (20\d{2})\b/)?.[1];
      if (year) return [clause, clause, year] as const;
    }
    return null;
  })();
  if (global) {
    // Shortened before the note: the note is what makes it a year, not a day
    out.push({ ...base, date: `${global[2]}-01-01`, title: 'Android 開發者驗證：擴大到全球所有認證 Android 裝置', detail: `${upTo(`${global[1].trim()}.`, 400)}（Google 只公布年份：${global[2]} 年，最早可能在年初）` });
  }
  if (!out.length) throw new Error('Android developer verification: no dated rollout found');
  return out;
}

/** What each requirement is called here (the page's own name otherwise) */
const TECH_QUALITY_NAMES: Array<[RegExp, string]> = [
  [/code optimi[sz]ation/i, '程式碼混淆、最佳化與縮減門檻（R8 或其他工具）'],
  [/memory/i, '記憶體用量門檻'],
  [/sign-?in restor/i, '零觸控登入還原（Restore Credentials）'],
];

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/**
 * The upcoming requirements on the technical quality page ("Code optimization From February 2027, apps and
 * games on Google Play will need to …"). Google gives only the month, so the date is that month's first day and
 * the detail says the day wasn't announced. The code optimization thresholds come from its table.
 */
export function parsePlayTechnicalQuality(html: string): Deadline[] {
  // The page opens with one line per upcoming requirement: "<Name> From <Month> <Year>, apps … will need to …."
  const text = cleanText(html);
  const MONTH = MONTH_NAMES.join('|');
  const seen = new Set<string>();
  const items = [...text.matchAll(new RegExp(`([A-Z][\\w-]*(?: [\\w-]+){0,4}) From (${MONTH}),? (20\\d{2}), ((?:[Aa]pps|[Gg]ames)[^.:]*? need to [^.:]*)[.:]`, 'g'))].flatMap(m => {
    const [, name, monthName, year, sentence] = m;
    // The page names a requirement more than once ("Code optimization", "DEX Code optimization"): once each
    const title = `Play 技術品質：${TECH_QUALITY_NAMES.find(([re]) => re.test(name))?.[1] ?? name}`;
    if (seen.has(title)) return [];
    seen.add(title);
    const month = MONTH_NAMES.indexOf(monthName) + 1;
    let extra = '';
    if (/optimi[sz]ation/i.test(name)) {
      const table = parseTables(html).find(t => /games/i.test(t.rows[0]?.join(' ') ?? '') && /apps/i.test(t.rows[0]?.join(' ') ?? ''));
      if (table) {
        const c = columnsOf(table.rows[0], { games: /games/i, apps: /apps/i }, 'Play code optimization table');
        const row = (label: RegExp) => table.rows.find(r => label.test(r[0] ?? ''));
        const scope = row(/code optimization/i);
        const thresholds = ['Obfuscation', 'Optimization', 'Shrinking'].map(k => `${k} ${row(new RegExp(`^${k}`, 'i'))?.[c.apps] ?? '?'}`).join('、');
        if (scope) extra = ` 適用：${scope[c.apps]}（遊戲：${scope[c.games]}）；門檻：${thresholds}。`;
      }
    }
    if (/memory/i.test(name)) extra = memorySummary(html);
    if (/sign-?in restor/i.test(name)) extra = restoreSummary(text);
    return [{
      platform: 'Android' as const,
      date: `${year}-${String(month).padStart(2, '0')}-01`,
      title,
      detail: `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}.${extra}${monthOnlyNote('Google', `${year}-${String(month).padStart(2, '0')}-01`)}`,
      source: 'Play Console technical quality requirements',
      url: PLAY_TECH_QUALITY_URL,
    }];
  });
  if (!items.length) throw new Error('Play technical quality: no dated upcoming requirement found');
  return items;
}

/**
 * The memory thresholds in short: the 90th-percentile limits per RAM tier (foreground and background ranges, for
 * apps and for games) and the bitmap limits, which the page gives as tables
 */
function memorySummary(html: string): string {
  const tables = parseTables(html);
  const tiers = tables.filter(t => /app state/i.test(t.rows[0]?.[0] ?? '') && t.rows[0].length >= 4);
  const range = (t: (typeof tables)[number], column: RegExp) => {
    const c = t.rows[0].findIndex(h => column.test(h));
    // Only cells that are a size ("2.25 GB"; not the "90th Percentile" label row or "-")
    const gb = t.rows.slice(1).map(r => (r[c] ?? '').match(/^([\d.]+)\s*GB$/i)?.[1]).filter((v): v is string => !!v).map(Number);
    return gb.length ? `${Math.min(...gb)}–${Math.max(...gb)} GB` : '';
  };
  const [apps, games] = tiers;
  const bitmap = tables.find(t => /app state/i.test(t.rows[0]?.[0] ?? '') && t.rows[0].length === 2);
  const limit = (state: RegExp) => bitmap?.rows.find(r => state.test(r[0] ?? ''))?.[1];
  const parts = [
    apps ? `App 的記憶體（Anonymous RSS + Swap，P90）上限依 RAM 級距：前景 ${range(apps, /^foreground/i)}、背景 ${range(apps, /^background/i)}` : '',
    games ? `遊戲：前景 ${range(games, /^foreground/i)}` : '',
    bitmap ? `Bitmap：${[['使用者可感知', /^user[- ]?perceived/i], ['背景', /^background/i], ['快取', /^cached/i]].flatMap(([label, state]) => (limit(state as RegExp) ? [`${label} ${limit(state as RegExp)}`] : [])).join('、') || '見官方表格'}` : '',
  ].filter(Boolean);
  return parts.length ? ` ${parts.join('；')}；以近 28 天資料評估。` : '';
}

/** Who must support Restore Credentials, and who may be exempt (financial services among them) */
function restoreSummary(text: string): string {
  const has = (pattern: RegExp) => pattern.test(text);
  const parts = [
    has(/financial services or healthcare\) may be eligible for an exemption/i) ? '受嚴格法規限制登入方式的 App（例如金融、醫療）可能符合豁免資格，須在生效前透過 Play Console 提出申請' : '',
    has(/Games are currently out of scope/i) ? '遊戲目前不在範圍內' : '',
    has(/available from Android 9/i) ? '使用 Restore Credentials API（Android 9 以上）' : '',
  ].filter(Boolean);
  return parts.length ? ` ${parts.join('；')}。` : '';
}

async function fetchPolicyTable(): Promise<Deadline[]> {
  try {
    return parsePlayPolicyDeadlines(await fetchHtml(PLAY_POLICY_URL));
  } catch (err) {
    // net.ts already respects Retry-After and retries the original URL once.
    // Google Support locales intermittently throttle hosted runners or time out;
    // try ONE other official English locale, not a third-party mirror or stale snapshot.
    const message = String((err as Error)?.message ?? err);
    if (!/\b429\b|Timed out after \d+(?:\.\d+)?s:/i.test(message)) throw err;
    return parsePlayPolicyDeadlines(await fetchHtml(PLAY_POLICY_FALLBACK_URL));
  }
}

export function parsePlayPolicyDeadlines(html: string): Deadline[] {
  // The deadline table, raw (its cells' links are wanted too): the one whose header reads Deadline / Policy change
  const tableHtml = [...html.matchAll(/<table[\s\S]*?<\/table>/g)].map(m => m[0])
    .find(t => { const header = parseTables(t)[0]?.rows[0] ?? []; return /Deadline/i.test(header[0] ?? '') && /Policy change/i.test(header[1] ?? ''); });
  if (!tableHtml) throw new Error('Play policy deadline table not found');
  const cellsOf = (row: string) => [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(m => m[1]);
  const hrefs = (cell: string) => [...cell.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)].map(m => ({ href: m[1].replace(/&amp;/g, '&'), text: cleanText(m[2]) }));

  const deadlines = [...tableHtml.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].flatMap(([, row]) => {
    const [dateCell = '', change = '', resources = ''] = cellsOf(row);
    const date = cleanText(dateCell);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      // A row dated another way ("Q1 2027", "2027/01/27") is worth knowing about; the table's other rows aren't
      if (/\b20\d{2}\b/.test(date) && date.length < 40) console.warn(`[playPolicy] policy row dated "${date}" not understood; left out`);
      return [];
    }
    // Cell reads "<Policy name> <what changes and what to use instead> Announced YYYY-MM-DD | Updated …"
    const text = cleanText(change);
    const announced = text.match(/Announced\s+(\d{4}-\d{2}-\d{2})/)?.[1];
    const body = text.replace(/\s*Announced\s+\d{4}-\d{2}-\d{2}[\s\S]*$/, '');
    const strong = cleanText(change.match(/<strong[^>]*>([\s\S]*?)<\/strong>/)?.[1] ?? '');
    const split = strong && body.startsWith(strong)
      ? [body, strong, body.slice(strong.length).trim()]
      : body.match(/^(.+?)\s+((?:We're|We are|To |Our |Apps |If |Starting |Developers |You )[\s\S]*)$/);
    // Without a recognisable lead, the cell's opening words, cut between words
    const name = split?.[1] ?? (body.length > 60 ? `${body.slice(0, 60).replace(/\s+\S*$/, '')}…` : body);
    // The whole description: what changes and, usually in its second sentence, what to use instead
    const description = split?.[2] ?? body;
    const full = upTo(description, 600);
    // The row's own help page (its "Help Center" resource, else the policy linked in the text), else the table
    const help = hrefs(resources).find(l => /help center/i.test(l.text))?.href
      ?? hrefs(change).map(l => l.href).find(h => /support\.google\.com\/googleplay\/android-developer\/answer\//.test(h) && !h.endsWith('/13986130'));
    return [{
      platform: 'Android' as const,
      date,
      title: `Play 政策：${name}`,
      detail: `${full}${announced ? `（${announced} 公告）` : ''}`,
      source: 'Google Play Policy Deadlines',
      url: help && /^https:\/\//.test(help) ? help : PLAY_POLICY_URL,
    }];
  });
  if (!deadlines.length) throw new Error('Play policy deadline table parsed empty');
  // Two changes under one policy ("Permissions and APIs that Access Sensitive Information" for contacts and for
  // location): each titled with the policy it introduces or updates ("Contacts Permissions policy")
  return deadlines.map(d => {
    if (deadlines.filter(o => o.title === d.title).length < 2) return d;
    const topic = d.detail.match(/\b([A-Z][A-Za-z]+(?: [A-Z][A-Za-z]+)* policy)\b/)?.[1];
    return topic ? { ...d, title: `${d.title}（${topic}）` } : d;
  });
}

export interface PlayBillingInfo {
  deadlines: Deadline[];
  latest?: string;
}

/**
 * The library's release notes on developer.android.com: the newest version comes from their headings. (Google
 * Maven has the same number, but dl.google.com's robots.txt disallows every crawler.)
 */
export const PLAY_BILLING_NOTES_URL = 'https://developer.android.com/google/play/billing/release-notes?hl=en';

/** Server-side: the Google Play Developer API's deprecated subscription endpoints and when they shut down */
export const PLAY_DEVELOPER_API_DEPRECATIONS_URL = 'https://developer.android.com/google/play/billing/play-developer-apis-deprecations?hl=en';

/**
 * Each "Deprecation timeline - <from> to <shutdown>" with the API table that follows it, as one deadline on the
 * shutdown day: the APIs and their replacements. For backends that verify Play purchases and subscriptions.
 */
export function parsePlayDeveloperApiDeprecations(html: string): Deadline[] {
  const MONTH = MONTH_NAMES.join('|');
  const DATE = `(?:${MONTH}) \\d{1,2}, \\d{4}`;
  const timelines = [...html.matchAll(new RegExp(`Deprecation timeline\\s*-\\s*(${DATE})\\s*to\\s*(${DATE})`, 'g'))];
  if (!timelines.length) throw new Error('Play Developer API deprecations: no deprecation timeline found');
  // A timeline is named twice (the overview, then its own section with the table): one item per shutdown day,
  // the one that lists the APIs
  const byDay = new Map<string, Deadline & { apis: number }>();
  timelines.forEach((t, i) => {
    const shutdown = calendarDate(t[2]);
    if (!shutdown) return;
    const section = html.slice(t.index!, timelines[i + 1]?.index ?? html.length);
    const table = parseTables(section).find(x => /^API$/i.test(x.rows[0]?.[0] ?? '') && /replacement/i.test(x.rows[0]?.[1] ?? ''));
    // "SubscriptionPurchaseV2. latestOrderId": the cell text broke an identifier at a tag
    const ident = (cell: string) => cell.replace(/\.\s+(?=\w)/g, '.');
    const pairs = (table?.rows.slice(1) ?? []).map(([api, replacement]) => `${ident(api)} → ${replacement ? ident(replacement) : '（無替代）'}`);
    const text = cleanText(section);
    const extension = calendarDate(text.match(/extension until ((?:[A-Z][a-z]+\.?) \d{1,2}, \d{4})/)?.[1] ?? '');
    const libraries = calendarDate(text.match(/Client libraries released after ([A-Z][a-z]+ \d{1,2}, \d{4})/)?.[1] ?? '');
    if ((byDay.get(shutdown)?.apis ?? -1) >= pairs.length) return;
    byDay.set(shutdown, {
      platform: 'Android' as const,
      date: shutdown,
      title: 'Google Play Developer API：已淘汰的訂閱 API 停止服務',
      detail: upTo(`自 ${calendarDate(t[1])} 起已淘汰，${shutdown} 停止服務；用這些 API 驗證或管理訂閱的後端需要改用替代 API。`
        + (libraries ? `${libraries} 之後發布的用戶端程式庫已不含這些 API。` : '')
        + (extension ? `可透過 Play Console 的「說明」提出支援要求，申請延長至 ${extension}。` : '')
        + (pairs.length ? `受影響（${pairs.length} 項）：${pairs.join('；')}。` : ''), 1000),
      source: 'Play Developer API deprecations',
      url: PLAY_DEVELOPER_API_DEPRECATIONS_URL,
      apis: pairs.length,
    });
  });
  return [...byDay.values()].map(({ apis: _apis, ...deadline }) => deadline);
}

export async function fetchPlayBilling(): Promise<PlayBillingInfo> {
  const [html, notes, apis] = await Promise.all([
    fetchHtml(PLAY_BILLING_URL),
    // The newest version is a nice-to-have next to the deadlines
    fetchHtml(PLAY_BILLING_NOTES_URL).catch(err => {
      console.warn(`[playBilling] release notes failed (${(err as Error)?.message ?? err}); no latest version this time`);
      return '';
    }),
    fetchHtml(PLAY_DEVELOPER_API_DEPRECATIONS_URL).then(parsePlayDeveloperApiDeprecations, err => {
      console.warn(`[playBilling] Play Developer API deprecations failed (${(err as Error)?.message ?? err}); library deadlines only this time`);
      return [];
    }),
  ]);
  const billing = parsePlayBilling(html, notes);
  return { ...billing, deadlines: [...billing.deadlines, ...apis] };
}

/** Highest stable x.y.z in the release notes' headings ("Google Play Billing Library 9.1.0 Release (2026-06-18)") */
export function parseBillingLatest(notes: string): string | undefined {
  return [...notes.matchAll(/<h[23][^>]*>[^<]*?Billing Library (\d+\.\d+\.\d+) Release\b/gi)].map(m => m[1]).sort(compareVersions).at(-1);
}

/** `notes` is the library's release notes page; pass '' when unavailable */
export function parsePlayBilling(html: string, notes = ''): PlayBillingInfo {
  const table = parseTables(html).find(t => /Extension deadline/i.test(t.rows[0]?.join(' ') ?? ''));
  if (!table) throw new Error('Play Billing deprecation table not found');

  const latest = parseBillingLatest(notes);
  const c = columnsOf(table.rows[0], { version: /^version/i, deadline: /^(?!.*extension).*deadline/i, extension: /extension/i }, 'Play Billing deprecation table');
  const deadlines = table.rows.slice(1).flatMap(r => {
    const [version, deadline, extension] = [r[c.version] ?? '', r[c.deadline] ?? '', r[c.extension] ?? ''];
    const date = isoDate(deadline);
    if (!date || !/^\d+$/.test(version)) return [];
    // An extension comes after the deadline it extends; anything else is two columns read the wrong way round
    const extensionDate = extension ? isoDate(extension) || undefined : undefined;
    if (extensionDate && extensionDate <= date) throw new Error(`Play Billing ${version}: extension ${extensionDate} isn't after the deadline ${date}`);
    return [{
      platform: 'Android' as const,
      date,
      title: `Play Billing Library ${version} 停止支援`,
      detail: `仍使用 PBL ${version} 的新 App 與更新將無法上架。` + (latest ? `最新版本為 ${latest}。` : ''),
      source: 'Play Billing deprecation FAQ',
      url: PLAY_BILLING_URL,
      extensionDate,
    }];
  });
  if (!deadlines.length) throw new Error('Play Billing deprecation table parsed empty');
  return { deadlines, latest };
}

export async function fetchPageSizeDeadlines(): Promise<Deadline[]> {
  return parsePageSizeDeadlines(await fetchHtml(PAGE_SIZE_URL));
}

export function parsePageSizeDeadlines(html: string): Deadline[] {
  const text = cleanText(html);
  const deadlines: Deadline[] = [];
  for (const m of text.matchAll(/(?:Starting|Beginning)\s+([A-Z][a-z]+ \d{1,2},? \d{4}),([^.]{10,260})\./g)) {
    const date = isoDate(m[1]);
    if (!date) continue;
    deadlines.push({
      platform: 'Android',
      date,
      title: '16 KB 記憶體分頁大小支援',
      detail: firstSentence(`${m[0]}`),
      source: 'Android 16 KB page sizes guide',
      url: PAGE_SIZE_URL,
    });
  }
  if (!deadlines.length) throw new Error('No 16 KB page size deadline found');
  return deadlines;
}
