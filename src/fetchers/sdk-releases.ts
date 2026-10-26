import { cleanText, fetchHtml } from './html-table.js';
import { settleSources } from './settle.js';
import { calendarDate, taipeiToday } from '../taipei-date.js';
import { lastPossibleDay } from '../deadline-dates.js';
import type { Deadline } from '../types.js';

/**
 * Breaking changes in the SDKs most apps ship with, from their official release notes: Firebase (Apple and
 * Android) and Google Play services. Only what an app has to act on is kept: a breaking change, a raised minimum
 * (minSdk, iOS), APIs removed, a distribution channel dropped (CocoaPods), and dates when something stops working.
 * Releases from the last RECENT_DAYS days become one dated item each; a future "as early as January 2027" /
 * "shut down on June 15, 2027" becomes an item on that date (the first of the month when only a month is given).
 */

export const FIREBASE_APPLE_NOTES_URL = 'https://firebase.google.com/support/release-notes/ios';
export const FIREBASE_ANDROID_NOTES_URL = 'https://firebase.google.com/support/release-notes/android';
export const PLAY_SERVICES_NOTES_URL = 'https://developers.google.com/android/guides/releases';

const RECENT_DAYS = 180;
const DAY_MS = 24 * 60 * 60 * 1000;
const MONTH_RE = '(?:January|February|March|April|May|June|July|August|September|October|November|December)';
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** Sentences an app developer must act on */
// A minSdk raised (not "Downgraded …"), a toolchain the package now needs, a library that stops working
const ACTIONABLE = /Breaking change|no longer (?:distributed|supported|included|available|resolve)|(?:Changed|Updated|Raised|Increased) (?:the )?minSdkVersion to \d+|minimum supported versions?\b|Removed (?:the )?(?:deprecated )?[\w -]{0,40}\bAPIs?\b|will be removed|shut ?down|as early as|calls to these APIs will fail|must migrate|non-functional|requires Swift tools|requires (?:at least )?Xcode \d/i;

/**
 * The page's text units in order: headings, paragraphs, list items (an item holding a nested list up to that
 * list: its intro, which names the library) and asides (notes and warnings, where Google puts cut-off dates)
 */
const UNITS = /<(h[3-6]|p|li|aside)\b[^>]*>((?:(?!<\/?(?:p|li|ul|ol|table|aside)\b)[\s\S])*?)(?:<\/\1>|(?=<ul\b|<ol\b))/g;

export interface DatedSection {
  id: string;
  /** YYYY-MM-DD */
  date: string;
  heading: string;
  text: string;
  html: string;
}

/** The page's h2 sections that carry a date in their heading ("Version 13.0.0 - October 7, 2026", "October 21, 2026") */
export function datedSections(html: string): DatedSection[] {
  const heads = [...html.matchAll(/<h2[^>]*\bid="([^"]+)"[^>]*>([\s\S]*?)<\/h2>/g)];
  return heads.flatMap((m, i) => {
    const heading = cleanText(m[2]);
    const date = calendarDate(heading.match(/([A-Z][a-z]+ \d{1,2}, \d{4})\s*$/)?.[1] ?? '');
    if (!date) return [];
    const body = html.slice(m.index! + m[0].length, heads[i + 1]?.index ?? html.length);
    return [{ id: m[1], date, heading, text: cleanText(body), html: body }];
  });
}

/**
 * The section's notes that call for action, one per paragraph or list item (the page's own units: a table or a
 * list of artifacts never runs into them), each with the library it's about: the nearest heading above it
 * ("Cloud Firestore version 26.5.0") or the paragraph introducing it ("The latest update to play-services-auth …")
 */
/** The section's paragraphs and list items in order, each with the library it's about and the one before it */
function blocks(html: string): Array<{ text: string; library: string; previous: string }> {
  const out: Array<{ text: string; library: string; previous: string }> = [];
  let library = '';
  let previous = '';
  // Headings, and paragraphs / list items that hold no further list (their own text, not a parent's)
  for (const m of html.matchAll(UNITS)) {
    const text = cleanText(m[2]).replace(/\(\s*(?:GitHub\s*)?#\d+\s*\)/g, '').replace(/\s+/g, ' ').trim();
    if (!text) continue;
    if (/^h/.test(m[1])) {
      library = text.replace(/\s+version\s+[\d.]+.*$/i, '');
      previous = '';
      continue;
    }
    // "The latest updates to the play-services-base library (v18.11.0) and play-services-basement library … include"
    if (/\bupdates? to\b/i.test(text)) {
      const named = [...new Set(text.match(/\b(?:play-services|firebase)-[\w-]+/g) ?? [])];
      library = named.length ? named.join('、') : text.match(/update to (\S+?) includes?\b/i)?.[1] ?? library;
    }
    out.push({ text, library, previous });
    previous = text;
  }
  return out;
}

export function actionableSentences(html: string): string[] {
  const out: string[] = [];
  for (const { text, library } of blocks(html)) {
    if (!ACTIONABLE.test(text)) continue;
    const short = text.length > 240 ? `${text.slice(0, 239)}…` : text;
    out.push(library && !short.toLowerCase().includes(library.toLowerCase()) ? `${library}：${short}` : short);
  }
  // The same change for many libraries ("Updated minSdkVersion to API level 24" × 28): once, with how many
  const byText = new Map<string, string[]>();
  for (const line of out) {
    const [lib, text] = line.includes('：') ? [line.slice(0, line.indexOf('：')), line.slice(line.indexOf('：') + 1)] : ['', line];
    byText.set(text, [...(byText.get(text) ?? []), lib].filter(Boolean));
  }
  return [...byText].map(([text, libs]) => (libs.length > 2 ? `${text}（${libs.length} 個函式庫：${libs.slice(0, 3).join('、')}…）` : libs.length ? `${libs.join('、')}：${text}` : text));
}

/** Future dates the notes name for something to stop working, with the sentence that says so */
export function futureCutoffs(html: string, today: string): Array<{ date: string; sentence: string; monthOnly: boolean; library: string }> {
  const out: Array<{ date: string; sentence: string; monthOnly: boolean; library: string }> = [];
  // The whole paragraph, not just the sentence with the date: "API calls … may start failing" needs the one
  // before it to say which API
  for (const { text, library, previous } of blocks(html)) {
    // "Important: … the deprecated APIs will be removed": the item before says which ("Deprecated the Games v1 SDK")
    const sentence = /\bthe deprecated APIs\b/i.test(text) && /\bdeprecat/i.test(previous) && previous.length < 200 ? `${previous} ${text}` : text;
    // No library named: the package the note is about ("com.google.android.gms.awareness.*" → awareness)
    const about = library || (sentence.match(/\bcom\.google\.android\.gms\.(\w+)/)?.[1] ?? sentence.match(/^([A-Z][\w]*(?: [A-Z][\w]*)*) is deprecated\b/)?.[1] ?? '');
    // "shut down on June 15, 2027", "will stop working on …", "turned down after …", "as early as January 15, 2027";
    // a month only: "as early as January 2027", "shut down in June 2027". Each future one counts (a note may
    // name when APIs leave the SDK, already past, and when calls start failing)
    const exact = [...sentence.matchAll(new RegExp(`(?:shut ?down|turned down|stop working|fail|as early as)\\s+(?:on |after |starting |from )?(${MONTH_RE}) (\\d{1,2}), (\\d{4})`, 'gi'))]
      .map(m => calendarDate(`${m[1]} ${m[2]}, ${m[3]}`));
    const months = [...sentence.matchAll(new RegExp(`(?:as early as|shut ?down in|turned down in|stop working in|fail (?:starting )?in)\\s+(${MONTH_RE}) (\\d{4})\\b`, 'gi'))]
      .map(m => `${m[2]}-${String(MONTHS.findIndex(n => n.toLowerCase() === m[1].toLowerCase()) + 1).padStart(2, '0')}-01`);
    for (const [date, monthOnly] of [...exact.map(d => [d, false] as const), ...months.map(d => [d, true] as const)]) {
      // Still listed on the day itself, and (a month only) until that month is over
      if (date && lastPossibleDay({ date, detail: monthOnly ? '只公布月份' : '' }) >= today) out.push({ date, sentence: sentence.trim(), monthOnly, library: about });
    }
  }
  return out;
}

/** An actionableSentences line's own text, without the libraries it names ("a、b：…", "…（3 個函式庫：…）") */
const noteText = (line: string) => line.replace(/（\d+ 個函式庫：[^）]*）$/, '').replace(/^[^：]*：/, '').replace(/…$/, '');

const joined = (list: string[], max = 1000) => {
  const text = list.join('；');
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
};

interface PageSpec {
  url: string;
  platform: Deadline['platform'];
  /** The item's title for a release section with breaking changes */
  title: (section: DatedSection) => string;
  source: string;
}

/** One page's recent breaking releases and future cutoffs as timeline items */
export function parseSdkReleaseNotes(html: string, page: PageSpec, now = new Date()): Deadline[] {
  const sections = datedSections(html);
  if (sections.length < 5) throw new Error(`${page.source}: only ${sections.length} dated sections (the page changed?)`);
  const today = taipeiToday(now);
  const since = new Date(now.getTime() - RECENT_DAYS * DAY_MS).toISOString().slice(0, 10);
  const items: Deadline[] = [];
  const cutoffs = new Map<string, Deadline>();
  const libraries = new Map<string, Set<string>>();
  for (const section of sections) {
    // A date ahead is worth knowing however old the note announcing it
    for (const cut of futureCutoffs(section.html, today)) {
      const key = `${cut.date}|${cut.sentence.slice(0, 60)}`;
      const seen = cutoffs.get(key);
      // The same notice for several libraries: one item, titled by the library only when there is just one
      if (seen) {
        if (cut.library) libraries.get(key)!.add(cut.library);
        continue;
      }
      libraries.set(key, new Set(cut.library ? [cut.library] : []));
      cutoffs.set(key, {
        platform: page.platform,
        date: cut.date,
        title: '',
        detail: `${cut.sentence.length > 300 ? `${cut.sentence.slice(0, 299)}…` : cut.sentence}${cut.monthOnly ? '（官方只公布月份，最早可能在該月）' : ''}`,
        source: page.source,
        url: `${page.url}#${section.id}`,
      });
    }
    if (section.date < since) continue;
    // A note that is a cutoff of its own is on the timeline on that date: not again as this release's change
    const cutHere = futureCutoffs(section.html, today).map(c => c.sentence);
    const sentences = actionableSentences(section.html)
      .filter(line => !cutHere.some(c => c.includes(noteText(line).slice(0, 120))));
    // A minimum OS given as a table ("Platform | Firebase 13 / iOS | 15.0") leads the item
    // The toolchain a release needs first: it decides whether the upgrade can happen at all
    sentences.sort((a, b) => Number(/requires (?:at least )?Xcode \d|Swift tools/i.test(b)) - Number(/requires (?:at least )?Xcode \d|Swift tools/i.test(a)));
    const minIos = section.text.match(/minimum supported versions?[\s\S]{0,240}?\biOS (\d+(?:\.\d+)?)/i)?.[1];
    if (minIos) sentences.unshift(`最低支援 iOS ${minIos}`);
    if (sentences.length) {
      items.push({
        platform: page.platform,
        date: section.date,
        title: page.title(section),
        detail: joined(sentences),
        source: page.source,
        url: `${page.url}#${section.id}`,
      });
    }
  }
  for (const [key, cut] of cutoffs) {
    const libs = [...libraries.get(key)!];
    cut.title = `${page.source}：${libs.length === 1 ? `${libs[0]} ` : ''}停用預告`;
    // At the end: the opening of the detail is part of the item's id, which must not change with the list
    if (libs.length > 1) cut.detail = `${cut.detail}（涉及：${libs.join('、')}）`;
  }
  return [...items, ...cutoffs.values()];
}

const PAGES: Array<[string, string, PageSpec]> = [
  ['Firebase Apple', FIREBASE_APPLE_NOTES_URL, {
    url: FIREBASE_APPLE_NOTES_URL, platform: 'iOS', source: 'Firebase Apple SDK',
    title: s => `Firebase Apple SDK ${s.heading.match(/Version ([\d.]+)/)?.[1] ?? s.date}：破壞性變更與最低需求`,
  }],
  ['Firebase Android', FIREBASE_ANDROID_NOTES_URL, {
    url: FIREBASE_ANDROID_NOTES_URL, platform: 'Android', source: 'Firebase Android SDK',
    title: s => `Firebase Android${s.text.match(/BoM \( ?Bill of Materials ?\) version ([\d.]+)/)?.[1] ? ` BoM ${s.text.match(/BoM \( ?Bill of Materials ?\) version ([\d.]+)/)![1]}` : `（${s.date}）`}：破壞性變更與最低需求`,
  }],
  ['Google Play services', PLAY_SERVICES_NOTES_URL, {
    url: PLAY_SERVICES_NOTES_URL, platform: 'Android', source: 'Google Play services',
    title: s => `Google Play services（${s.date}）：最低版本或 API 移除`,
  }],
];

/**
 * Every page must read: one that fails or changed shape fails the source (alerted, and its last good result
 * stands in for all three), rather than its items quietly disappearing while the others carry on
 */
export async function fetchSdkReleases(now = new Date()): Promise<Deadline[]> {
  const { values, failures } = await settleSources('SDK release notes', [
    ...PAGES.map(([name, url, spec]) => [name, async () => parseSdkReleaseNotes(await fetchHtml(`${url}?hl=en`), spec, now)] as const),
  ], () => true);
  if (failures.length) throw new Error(`SDK release notes: ${failures.map(f => `${f.name}: ${f.error.message}`).join('; ')}`);
  return [...values.values()].flat();
}
