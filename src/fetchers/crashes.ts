import { cleanText, fetchHtml } from './html-table.js';
import { compareVersions } from '../versions.js';
import { settleSources } from './settle.js';
import { fetchJson, githubHeaders, NETWORK_TIMEOUT_MS as TIMEOUT_MS } from '../net.js';
import { inlineText } from './docc.js';

export interface CrashItem {
  platform: 'iOS' | 'Android' | '跨平台';
  source: 'iOS release notes' | 'Xcode release notes' | 'Android release notes' | 'GitHub' | 'Stack Overflow';
  /** known = listed under "Known Issues" in the release notes named by `context` (later notes may have fixed it);
   *  fixed = fixed in a recent release; reported = community report */
  kind: 'known' | 'fixed' | 'reported';
  title: string;
  /** Area / release the item belongs to, e.g. "SwiftUI", "iOS 27.2 Beta 3", "firebase/firebase-ios-sdk" */
  context: string;
  url: string;
  date?: string;
  reactions?: number;
  comments?: number;
  /** Mentions the newest OS version, i.e. likely caused by upgrading */
  newOs?: boolean;
  /** Original author, credited next to the title (Stack Overflow: required by CC BY-SA; GitHub: the issue's author) */
  author?: { name: string; url?: string };
}


// Word boundaries matter: "hang" must not match "change"
export const CRASH_PATTERN = /\b(crash(?:es|ed|ing)?|quits? unexpectedly|hangs?|hung|freez(?:e|es|ing)|unresponsive|deadlocks?|ANRs?|EXC_[A-Z_]+|SIGABRT|SIGSEGV|terminat(?:e|es|ed|ion) unexpectedly|(?:unexpected(?:ly)?|spontaneous(?:ly)?) reboot(?:s|ing)?)\b/i;

// ---------- Apple (DocC JSON) ----------

interface DocNode {
  type?: string;
  text?: string;
  level?: number;
  inlineContent?: DocNode[];
  content?: DocNode[];
  items?: DocNode[];
  code?: string;
  identifier?: string;
  [key: string]: unknown;
}

interface DocPage {
  metadata?: { title?: string };
  primaryContentSections?: DocNode[];
  references?: Record<string, { title?: string; url?: string }>;
}

/**
 * Collects crash-related entries from the "Known Issues" / "Resolved Issues" lists of an
 * Apple release notes page. Entries sit under a topic heading (e.g. "SwiftUI") followed by
 * an issue-type heading.
 */
export function parseAppleReleaseNotes(page: DocPage, url: string, platform: 'iOS', source: CrashItem['source']): CrashItem[] {
  const release = page.metadata?.title?.replace(/\s*Release Notes$/i, '') ?? '';
  const items: CrashItem[] = [];
  let topic = '';
  let kind: CrashItem['kind'] | null = null;

  const visit = (node: DocNode) => {
    if (node.type === 'heading') {
      const text = node.text ?? '';
      if (/known issues?/i.test(text)) kind = 'known';
      else if (/resolved issues?/i.test(text)) kind = 'fixed';
      else if (/new features|deprecations|overview|update/i.test(text)) kind = null;
      else { topic = text; kind = null; }
      return;
    }
    if (node.type === 'paragraph' && kind) {
      const text = inlineText(node.inlineContent, page.references);
      // Workarounds are separate paragraphs starting with "Workaround:"
      if (text && !/^Workaround:/i.test(text) && CRASH_PATTERN.test(text)) {
        items.push({ platform, source, kind, title: text.replace(/^Fixed:\s*/i, ''), context: [release, topic].filter(Boolean).join(' · '), url });
      }
      return;
    }
    for (const child of [...(node.content ?? []), ...(node.items ?? [])]) visit(child);
  };
  for (const section of page.primaryContentSections ?? []) visit(section);
  return items;
}

const APPLE_DATA = 'https://developer.apple.com/tutorials/data';

async function fetchDocJson(path: string): Promise<DocPage> {
  return fetchJson<DocPage>(`${APPLE_DATA}${path}.json`, {}, TIMEOUT_MS, status => `${path} failed: ${status}`);
}

/** Release notes pages for the given iOS major: the .0 page plus the newest point / beta release */
export function pickiOSReleaseNotes(index: DocPage, major: string): Array<{ title: string; path: string }> {
  const pages = Object.values(index.references ?? {})
    .filter(r => r.url && r.title && new RegExp(`^iOS (?:& iPadOS )?${major}(?:[ .]|$)`).test(r.title))
    .map(r => ({ title: r.title!, path: r.url!, version: r.title!.match(/(\d+(?:\.\d+)*)/)?.[1] ?? major }));
  pages.sort((a, b) => compareVersions(a.version, b.version) || a.title.localeCompare(b.title));
  const base = pages.find(p => p.version === major);
  const newest = pages.at(-1);
  return [...new Map([base, newest].filter(Boolean).map(p => [p!.path, { title: p!.title, path: p!.path }])).values()];
}

export async function fetchAppleCrashes(iosMajor: string, xcodeNotesUrl?: string): Promise<CrashItem[]> {
  const index = await fetchDocJson('/documentation/ios-ipados-release-notes');
  const pages = pickiOSReleaseNotes(index, iosMajor);
  if (!pages.length) throw new Error(`No iOS ${iosMajor} release notes found`);

  const tasks = pages.map(async p => parseAppleReleaseNotes(
    await fetchDocJson(p.path), `https://developer.apple.com${p.path}`, 'iOS', 'iOS release notes'));
  const xcodePath = xcodeNotesUrl?.match(/developer\.apple\.com(\/documentation\/xcode-release-notes\/[\w-]+)/)?.[1];
  if (xcodePath) {
    tasks.push(fetchDocJson(xcodePath)
      .then(page => parseAppleReleaseNotes(page, xcodeNotesUrl!, 'iOS', 'Xcode release notes'))
      .catch(err => {
        // The iOS notes still count; the missing Xcode part is logged rather than lost silently
        console.warn(`[crashes] Xcode release notes failed (${(err as Error).message})`);
        return [];
      }));
  }
  const kindOrder = { known: 0, fixed: 1, reported: 2 };
  const pageOrder = new Map(pages.map((p, i) => [`https://developer.apple.com${p.path}`, pages.length - i]));
  return (await Promise.all(tasks)).flat().sort((a, b) =>
    kindOrder[a.kind] - kindOrder[b.kind] || (pageOrder.get(a.url) ?? 0) - (pageOrder.get(b.url) ?? 0));
}

// ---------- Android (release notes HTML) ----------

/**
 * Crash items from the newest beta section of an Android release notes page: the
 * "Known issue(s)" list and the "Top Issues fixed" list for the latest beta.
 */
export function parseAndroidReleaseNotes(html: string, url: string, label = '', maxSections = 2): CrashItem[] {
  const items: CrashItem[] = [];
  // Split into h2/h3 sections, keeping heading text
  const parts = html.split(/<h[23][^>]*>/i).slice(1).map(part => {
    const [heading, ...rest] = part.split(/<\/h[23]>/i);
    return { heading: cleanText(heading), body: rest.join('') };
  });

  let fixedSections = 0;
  let release = '';
  for (const { heading, body } of parts) {
    if (/^Android \d+.*\((?:[A-Z][a-z]+) \d{4}\)$/.test(heading)) release = heading;
    const known = /known issues?/i.test(heading);
    const fixed = /issues fixed/i.test(heading);
    if (!known && !fixed) continue;
    if (fixed && ++fixedSections > maxSections) continue;

    for (const li of body.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)) {
      const text = cleanText(li[1]);
      if (!CRASH_PATTERN.test(text)) continue;
      const issue = li[1].match(/https:\/\/issuetracker\.google\.com\/issues\/\d+/)?.[0];
      items.push({
        platform: 'Android',
        source: 'Android release notes',
        kind: known ? 'known' : 'fixed',
        title: text.replace(/\s*\(\s*Issue[^)]*\)\s*$/, ''),
        context: [label, known ? (release || heading) : heading.replace(/^Top Issues fixed in /i, '')].filter(Boolean).join(' · '),
        url: issue ?? url,
      });
    }
  }
  return items;
}

export async function fetchAndroidCrashes(androidMajor: string): Promise<CrashItem[]> {
  // The newest quarterly platform release (QPR) page carries the current beta's notes
  const base = `https://developer.android.com/about/versions/${androidMajor}`;
  const candidates = [`${base}/qpr3/release-notes?hl=en`, `${base}/qpr2/release-notes?hl=en`, `${base}/qpr1/release-notes?hl=en`, `${base}/release-notes?hl=en`];
  // All at once (a QPR page that doesn't exist yet is a quick 404; four timeouts in a row were not), newest first
  const pages = await Promise.allSettled(candidates.map(url => fetchHtml(url)));
  const failures: string[] = [];
  for (const [i, url] of candidates.entries()) {
    const page = pages[i];
    if (page.status === 'rejected') {
      const message = (page.reason as Error)?.message ?? String(page.reason);
      if (!/\b404\b/.test(message)) failures.push(message);
      continue;
    }
    const html = page.value;
    const qpr = url.match(/\/(qpr\d)\//)?.[1]?.toUpperCase();
    const items = parseAndroidReleaseNotes(html, url.replace('?hl=en', ''), `Android ${androidMajor}${qpr ? ` ${qpr}` : ''}`);
    if (items.length || /issues fixed|known issue/i.test(html)) return items;
  }
  throw new Error(`No Android ${androidMajor} release notes found${failures.length ? ` (${failures.join('; ')})` : ''}`);
}

// ---------- Popular SDKs on GitHub ----------

export const SDK_REPOS: Array<{ repo: string; platform: CrashItem['platform'] }> = [
  { repo: 'firebase/firebase-ios-sdk', platform: 'iOS' },
  { repo: 'facebook/facebook-ios-sdk', platform: 'iOS' },
  { repo: 'Alamofire/Alamofire', platform: 'iOS' },
  { repo: 'SDWebImage/SDWebImage', platform: 'iOS' },
  { repo: 'onevcat/Kingfisher', platform: 'iOS' },
  { repo: 'airbnb/lottie-ios', platform: 'iOS' },
  { repo: 'getsentry/sentry-cocoa', platform: 'iOS' },
  { repo: 'realm/realm-swift', platform: 'iOS' },
  { repo: 'firebase/firebase-android-sdk', platform: 'Android' },
  { repo: 'facebook/facebook-android-sdk', platform: 'Android' },
  { repo: 'airbnb/lottie-android', platform: 'Android' },
  { repo: 'bumptech/glide', platform: 'Android' },
  { repo: 'square/okhttp', platform: 'Android' },
  { repo: 'getsentry/sentry-java', platform: 'Android' },
  { repo: 'coil-kt/coil', platform: 'Android' },
  { repo: 'react/react-native', platform: '跨平台' },
  { repo: 'flutter/flutter', platform: '跨平台' },
  { repo: 'firebase/flutterfire', platform: '跨平台' },
];

interface GithubIssue {
  title: string;
  html_url: string;
  repository_url: string;
  created_at: string;
  comments: number;
  reactions?: { total_count: number };
  pull_request?: unknown;
  user?: { login?: string; html_url?: string } | null;
}

export function parseGithubIssues(items: GithubIssue[], newOsPattern?: RegExp, pattern: { test(title: string): boolean } = CRASH_PATTERN): CrashItem[] {
  return items
    // Web / desktop-only reports don't affect mobile apps
    .filter(i => !i.pull_request && pattern.test(i.title) && !/\[(?:web|windows|linux|macos|desktop)\]/i.test(i.title))
    .map(i => {
      const repo = i.repository_url.replace('https://api.github.com/repos/', '');
      return {
        platform: [...SDK_REPOS, ...CORDOVA_REPOS].find(r => r.repo.toLowerCase() === repo.toLowerCase())?.platform ?? '跨平台',
        source: 'GitHub' as const,
        kind: 'reported' as const,
        title: i.title.trim(),
        context: repo,
        url: i.html_url,
        date: i.created_at.slice(0, 10),
        reactions: i.reactions?.total_count ?? 0,
        comments: i.comments,
        newOs: newOsPattern?.test(i.title) ?? false,
        // The issue's author, credited next to the title (the title is their writing)
        ...(i.user?.login ? { author: { name: i.user.login, url: i.user.html_url } } : {}),
      };
    });
}

/** Most reports any one repo gets in the SDK list */
const MAX_PER_REPO = 3;

/**
 * The issues of the search groups that answered. A group that failed is logged (its repos are missing from
 * the list); only when every group failed is it the source's failure.
 */
function settledItems(results: PromiseSettledResult<GithubIssue[]>[], label: string): GithubIssue[] {
  const failed = results.flatMap(r => r.status === 'rejected' ? [String((r.reason as Error)?.message ?? r.reason)] : []);
  if (failed.length === results.length) throw new Error(failed[0] ?? 'GitHub search failed');
  for (const message of failed) console.warn(`[crashes] ${label} search group failed (${message})`);
  return results.flatMap(r => r.status === 'fulfilled' ? r.value : []);
}

/**
 * Crash reports opened in the last `days` days in popular SDK repos, most-upvoted first.
 * Unauthenticated search allows 10 requests/minute; set GITHUB_TOKEN for higher limits.
 */
export async function fetchSdkCrashes(newOsPattern?: RegExp, days = 30, limit = 12, now = new Date()): Promise<CrashItem[]> {
  const since = new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const headers = githubHeaders();

  // Search queries are length-limited, so query the repos in a few groups
  const groups: string[][] = [];
  for (let i = 0; i < SDK_REPOS.length; i += 6) groups.push(SDK_REPOS.slice(i, i + 6).map(r => r.repo));

  const results = await Promise.allSettled(groups.map(async repos => {
    // Open issues only: a report already closed (fixed, a duplicate, not a bug) isn't something to check before upgrading
    const q = `crash in:title is:issue is:open created:>=${since} ${repos.map(r => `repo:${r}`).join(' ')}`;
    return (await fetchJson<{ items: GithubIssue[] }>(`https://api.github.com/search/issues?q=${encodeURIComponent(q)}&sort=reactions&order=desc&per_page=100`, { headers }, TIMEOUT_MS, status => `GitHub search failed: ${status}`)).items;
  }));

  const items = settledItems(results, 'SDK');
  // One busy repo (flutter/flutter) would otherwise fill the whole list
  const perRepo = new Map<string, number>();
  return parseGithubIssues(items, newOsPattern)
    .sort((a, b) => (b.reactions! * 2 + b.comments!) - (a.reactions! * 2 + a.comments!))
    .filter(item => {
      const n = (perRepo.get(item.context ?? '') ?? 0) + 1;
      perRepo.set(item.context ?? '', n);
      return n <= MAX_PER_REPO;
    })
    .slice(0, limit);
}

// ---------- Apache Cordova on GitHub ----------

export const CORDOVA_REPOS: Array<{ repo: string; platform: CrashItem['platform'] }> = [
  { repo: 'apache/cordova-ios', platform: 'iOS' },
  { repo: 'apache/cordova-android', platform: 'Android' },
  ...['camera', 'inappbrowser', 'file', 'file-transfer', 'geolocation', 'media', 'network-information']
    .map(name => ({ repo: `apache/cordova-plugin-${name}`, platform: '跨平台' as const })),
];

/**
 * Cordova reports rarely say "crash" in the title: they describe a white / black screen, an app that
 * won't start, or paste the native exception name instead.
 */
const CORDOVA_SYMPTOM = new RegExp(`${CRASH_PATTERN.source}|\\b(?:white|black|blank) screen\\b|\\b(?:won'?t|doesn'?t|does not|can'?t|cannot|fails? to) (?:run|launch|start)\\b`, 'i');
// Native exception class names are capitalised (NSInternalInconsistencyException, NoClassDefFoundError); a plain "CORS error" isn't one
const NATIVE_EXCEPTION = /\b[A-Z]\w*(?:Exception|Error)\b/;
export const CORDOVA_ISSUE_PATTERN = { test: (title: string) => CORDOVA_SYMPTOM.test(title) || NATIVE_EXCEPTION.test(title) };

/**
 * Every issue opened in the Cordova platform and core plugin repos in the last `days` days, filtered
 * here with CORDOVA_ISSUE_PATTERN. The repos are quiet (a few dozen issues per quarter, hence the half-year window), so this stays
 * within one page per query. Reports about the newest OS come first.
 */
export async function fetchCordovaCrashes(newOsPattern?: RegExp, days = 180, limit = 12, now = new Date()): Promise<CrashItem[]> {
  const since = new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const headers = githubHeaders();

  // Platforms in one query, plugins in groups that keep the query under GitHub's length limit
  const repos = CORDOVA_REPOS.map(r => r.repo);
  const groups = [repos.slice(0, 2), repos.slice(2, 6), repos.slice(6)];

  const results = await Promise.allSettled(groups.map(async group => {
    const q = `is:issue is:open created:>=${since} ${group.map(r => `repo:${r}`).join(' ')}`;
    return (await fetchJson<{ items: GithubIssue[] }>(`https://api.github.com/search/issues?q=${encodeURIComponent(q)}&sort=created&order=desc&per_page=100`, { headers }, TIMEOUT_MS, status => `GitHub search failed: ${status}`)).items;
  }));

  const items = settledItems(results, 'Cordova');
  return rankCordovaIssues(parseGithubIssues(items, newOsPattern, CORDOVA_ISSUE_PATTERN), limit);
}

/** Newest-OS reports first, then by engagement, then newest */
export function rankCordovaIssues(items: CrashItem[], limit = 12): CrashItem[] {
  return items
    .sort((a, b) => Number(b.newOs) - Number(a.newOs)
      || (b.reactions! * 2 + b.comments!) - (a.reactions! * 2 + a.comments!)
      || (b.date ?? '').localeCompare(a.date ?? ''))
    .slice(0, limit);
}

// ---------- Stack Overflow (official Stack Exchange API) ----------

const SO_TAGS: Array<{ platform: CrashItem['platform']; tags: string[] }> = [
  { platform: 'iOS', tags: ['ios', 'swift', 'swiftui', 'xcode', 'objective-c', 'uikit', 'iphone', 'ipad', 'watchos', 'visionos'] },
  { platform: 'Android', tags: ['android', 'kotlin', 'android-jetpack-compose', 'android-studio', 'android-gradle-plugin', 'jetpack'] },
  { platform: '跨平台', tags: ['flutter', 'react-native', 'kotlin-multiplatform', 'compose-multiplatform', 'expo', 'maui', 'capacitor'] },
];

interface StackQuestion {
  title: string;
  link: string;
  tags: string[];
  score: number;
  answer_count: number;
  view_count: number;
  is_answered: boolean;
  creation_date: number;
  owner?: { display_name?: string; link?: string };
}

const decodeEntities = (s: string) => s
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

export function parseStackQuestions(items: StackQuestion[], newOsPattern?: RegExp, limit = 10): CrashItem[] {
  return items
    .flatMap(q => {
      const platform = SO_TAGS.find(g => q.tags.some(t => g.tags.includes(t)))?.platform;
      const title = decodeEntities(q.title);
      // The search matches the body too, so keep only questions whose title is about a crash / hang
      if (!platform || !CRASH_PATTERN.test(title)) return [];
      return [{
        platform,
        source: 'Stack Overflow' as const,
        kind: 'reported' as const,
        title,
        context: `Stack Overflow · ${q.tags.slice(0, 3).join(', ')}${q.is_answered ? ' · 已有解答' : ''}`,
        url: q.link,
        date: new Date(q.creation_date * 1000).toISOString().slice(0, 10),
        reactions: q.score,
        comments: q.answer_count,
        newOs: newOsPattern?.test(title) ?? false,
        ...(q.owner?.display_name ? { author: { name: decodeEntities(q.owner.display_name), url: q.owner.link } } : {}),
        views: q.view_count,
      }];
    })
    // Votes matter most, then answers, then how many people looked
    .sort((a, b) => (b.reactions * 5 + b.comments * 2 + b.views / 200) - (a.reactions * 5 + a.comments * 2 + a.views / 200))
    .slice(0, limit)
    .map(({ views: _views, ...item }) => item);
}

/**
 * Mobile crash questions from the last `days` days. One request per refresh (full-text "crash",
 * then filtered by mobile tags and crash wording here) keeps well within the 300/day anonymous quota
 * with one scheduled build a day. Stack Overflow's volume has dropped a lot, hence the 90-day window.
 */
export async function fetchStackOverflowCrashes(newOsPattern?: RegExp, days = 90, now = new Date()): Promise<CrashItem[]> {
  const from = Math.floor((now.getTime() - days * 24 * 60 * 60 * 1000) / 1000);
  const url = `https://api.stackexchange.com/2.3/search/advanced?order=desc&sort=creation&q=crash&fromdate=${from}&site=stackoverflow&pagesize=100`;
  const data = await fetchJson<{ items?: StackQuestion[]; error_message?: string }>(url, {}, TIMEOUT_MS, status => `Stack Exchange API failed: ${status}`);
  if (!data.items) throw new Error(data.error_message ?? 'Stack Exchange API returned no items');
  return parseStackQuestions(data.items, newOsPattern);
}

export interface CrashReport {
  ios: CrashItem[];
  android: CrashItem[];
  sdks: CrashItem[];
  community: CrashItem[];
  cordova: CrashItem[];
}

export interface CrashReportDeps {
  apple: (iosMajor: string, xcodeNotesUrl?: string) => Promise<CrashItem[]>;
  android: (androidMajor: string) => Promise<CrashItem[]>;
  sdks: (newOsPattern?: RegExp) => Promise<CrashItem[]>;
  community: (newOsPattern?: RegExp) => Promise<CrashItem[]>;
  cordova: (newOsPattern?: RegExp) => Promise<CrashItem[]>;
}

const CRASH_REPORT_DEPS: CrashReportDeps = {
  apple: fetchAppleCrashes,
  android: fetchAndroidCrashes,
  sdks: fetchSdkCrashes,
  community: fetchStackOverflowCrashes,
  cordova: fetchCordovaCrashes,
};

/**
 * Partial results are kept. Release notes need the current OS version: when it's unknown that part
 * counts as failed rather than as a successful empty list. Throws when every part failed.
 */
export async function fetchCrashReport(
  opts: { iosMajor?: string; androidMajor?: string; xcodeNotesUrl?: string },
  deps: CrashReportDeps = CRASH_REPORT_DEPS,
): Promise<CrashReport> {
  const newOs = [opts.iosMajor && `iOS ${opts.iosMajor}`, opts.androidMajor && `Android ${opts.androidMajor}`].filter(Boolean);
  const newOsPattern = newOs.length ? new RegExp(newOs.map(v => `\\b${v!.replace(' ', '\\s*')}\\b`).join('|'), 'i') : undefined;
  const missing = (what: string) => () => Promise.reject(new Error(`current ${what} version unknown`));

  const { values } = await settleSources('crashes', [
    ['Apple release notes', opts.iosMajor ? () => deps.apple(opts.iosMajor!, opts.xcodeNotesUrl) : missing('iOS')],
    ['Android release notes', opts.androidMajor ? () => deps.android(opts.androidMajor!) : missing('Android')],
    ['GitHub SDK issues', () => deps.sdks(newOsPattern)],
    ['Stack Overflow', () => deps.community(newOsPattern)],
    ['GitHub Cordova issues', () => deps.cordova(newOsPattern)],
  ]);
  return {
    ios: values.get('Apple release notes') ?? [],
    android: values.get('Android release notes') ?? [],
    sdks: values.get('GitHub SDK issues') ?? [],
    community: values.get('Stack Overflow') ?? [],
    cordova: values.get('GitHub Cordova issues') ?? [],
  };
}
