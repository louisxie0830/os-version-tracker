import { cleanText, fetchHtml } from './html-table.js';
import { compareVersions } from './ios-toolchain.js';

export interface CrashItem {
  platform: 'iOS' | 'Android' | '跨平台';
  source: 'iOS release notes' | 'Xcode release notes' | 'Android release notes' | 'GitHub';
  /** known = still open in the latest release; fixed = fixed in a recent release; reported = community report */
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
}

const TIMEOUT_MS = 15_000;

// Word boundaries matter: "hang" must not match "change"
export const CRASH_PATTERN = /\b(crash(?:es|ed|ing)?|quits? unexpectedly|hangs?|hung|freez(?:e|es|ing)|unresponsive|deadlocks?|ANRs?|EXC_[A-Z_]+|SIGABRT|SIGSEGV|terminat(?:e|es|ed|ion) unexpectedly|reboots?)\b/i;

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

function inlineText(nodes: DocNode[] | undefined, refs: DocPage['references'] = {}): string {
  return (nodes ?? []).map(n => {
    if (n.type === 'text') return n.text ?? '';
    if (n.type === 'codeVoice') return n.code ?? '';
    if (n.type === 'reference' && n.identifier) return refs[n.identifier]?.title ?? '';
    return inlineText(n.inlineContent, refs);
  }).join('').replace(/\s+/g, ' ').trim();
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
  const res = await fetch(`${APPLE_DATA}${path}.json`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`${path} failed: ${res.status}`);
  return res.json() as Promise<DocPage>;
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
      .catch(() => []));
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
  for (const url of candidates) {
    let html: string;
    try {
      html = await fetchHtml(url);
    } catch {
      continue;
    }
    const qpr = url.match(/\/(qpr\d)\//)?.[1]?.toUpperCase();
    const items = parseAndroidReleaseNotes(html, url.replace('?hl=en', ''), `Android ${androidMajor}${qpr ? ` ${qpr}` : ''}`);
    if (items.length || /issues fixed|known issue/i.test(html)) return items;
  }
  throw new Error(`No Android ${androidMajor} release notes found`);
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
  { repo: 'facebook/react-native', platform: '跨平台' },
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
}

export function parseGithubIssues(items: GithubIssue[], newOsPattern?: RegExp): CrashItem[] {
  return items
    // Web / desktop-only reports don't affect mobile apps
    .filter(i => !i.pull_request && CRASH_PATTERN.test(i.title) && !/\[(?:web|windows|linux|macos|desktop)\]/i.test(i.title))
    .map(i => {
      const repo = i.repository_url.replace('https://api.github.com/repos/', '');
      return {
        platform: SDK_REPOS.find(r => r.repo.toLowerCase() === repo.toLowerCase())?.platform ?? '跨平台',
        source: 'GitHub' as const,
        kind: 'reported' as const,
        title: i.title.trim(),
        context: repo,
        url: i.html_url,
        date: i.created_at.slice(0, 10),
        reactions: i.reactions?.total_count ?? 0,
        comments: i.comments,
        newOs: newOsPattern?.test(i.title) ?? false,
      };
    });
}

/**
 * Crash reports opened in the last `days` days in popular SDK repos, most-upvoted first.
 * Unauthenticated search allows 10 requests/minute; set GITHUB_TOKEN for higher limits.
 */
export async function fetchSdkCrashes(newOsPattern?: RegExp, days = 30, limit = 12, now = new Date()): Promise<CrashItem[]> {
  const since = new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const headers: Record<string, string> = { Accept: 'application/vnd.github+json', 'User-Agent': 'os-version-tracker' };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;

  // Search queries are length-limited, so query the repos in a few groups
  const groups: string[][] = [];
  for (let i = 0; i < SDK_REPOS.length; i += 6) groups.push(SDK_REPOS.slice(i, i + 6).map(r => r.repo));

  const results = await Promise.allSettled(groups.map(async repos => {
    const q = `crash in:title is:issue created:>=${since} ${repos.map(r => `repo:${r}`).join(' ')}`;
    const res = await fetch(`https://api.github.com/search/issues?q=${encodeURIComponent(q)}&sort=reactions&order=desc&per_page=15`, {
      headers,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`GitHub search failed: ${res.status}`);
    return ((await res.json()) as { items: GithubIssue[] }).items;
  }));

  const items = results.flatMap(r => r.status === 'fulfilled' ? r.value : []);
  if (!items.length && results.every(r => r.status === 'rejected')) {
    throw new Error((results[0] as PromiseRejectedResult).reason?.message ?? 'GitHub search failed');
  }
  return parseGithubIssues(items, newOsPattern)
    .sort((a, b) => (b.reactions! * 2 + b.comments!) - (a.reactions! * 2 + a.comments!))
    .slice(0, limit);
}

export interface CrashReport {
  ios: CrashItem[];
  android: CrashItem[];
  sdks: CrashItem[];
}

export async function fetchCrashReport(opts: { iosMajor?: string; androidMajor?: string; xcodeNotesUrl?: string }): Promise<CrashReport> {
  const newOs = [opts.iosMajor && `iOS ${opts.iosMajor}`, opts.androidMajor && `Android ${opts.androidMajor}`].filter(Boolean);
  const newOsPattern = newOs.length ? new RegExp(newOs.map(v => `\\b${v!.replace(' ', '\\s*')}\\b`).join('|'), 'i') : undefined;
  const [ios, android, sdks] = await Promise.allSettled([
    opts.iosMajor ? fetchAppleCrashes(opts.iosMajor, opts.xcodeNotesUrl) : Promise.resolve([]),
    opts.androidMajor ? fetchAndroidCrashes(opts.androidMajor) : Promise.resolve([]),
    fetchSdkCrashes(newOsPattern),
  ]);
  for (const [label, r] of [['Apple', ios], ['Android', android], ['GitHub', sdks]] as const) {
    if (r.status === 'rejected') console.warn(`[crashes] ${label} failed (${(r.reason as Error).message})`);
  }
  if ([ios, android, sdks].every(r => r.status === 'rejected')) throw new Error('All crash sources failed');
  return {
    ios: ios.status === 'fulfilled' ? ios.value : [],
    android: android.status === 'fulfilled' ? android.value : [],
    sdks: sdks.status === 'fulfilled' ? sdks.value : [],
  };
}
