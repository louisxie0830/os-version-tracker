import { gunzipSync } from 'node:zlib';
import RssParser from 'rss-parser';
import { fetchWithTimeout } from '../net.js';
import { safeUrl } from '../safe-url.js';
import { settleSources } from './settle.js';

/**
 * Developer news from official feeds, merged into one timeline. Titles stay in their original
 * (English) wording; each item links to its source.
 */

export type NewsPlatform = 'iOS' | 'Android' | '跨平台';
export type NewsCategory = 'announcement' | 'release' | 'blog';

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
}

const REQUIREMENTS = /requirement|deadline|deprecat|must|policy|expir|privacy|breaking|security|outage|incident|migrat|end of (?:life|support)/i;

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
  { id: 'android-blog', name: 'Android Developers Blog', url: 'https://android-developers.googleblog.com/atom.xml', platform: 'Android', category: 'announcement',
    important: /policy|target api|targetSdk|deprecat|requirement|deadline|migrat|16 ?KB|breaking|behavior change|Android \d+(?: QPR\d)? (?:beta|developer preview|is here|release)/i },
  { id: 'android-studio', name: 'Android Studio', url: 'https://androidstudio.googleblog.com/feeds/posts/default', platform: 'Android', category: 'release',
    // Stable Android Studio releases, not canaries or betas
    important: /^Android Studio (?!.*(?:Canary|Beta|RC)).*now available$/i },
  { id: 'androidx', name: 'AndroidX (Jetpack)', url: 'https://developer.android.com/feeds/androidx-release-notes.xml', platform: 'Android', category: 'release',
    transform: androidxTitle },
  { id: 'kotlin', name: 'Kotlin Blog', url: 'https://blog.jetbrains.com/kotlin/feed/', platform: 'Android', category: 'blog', important: /released|kotlin \d+\.\d+|deprecat|discontinu/i },
  { id: 'firebase', name: 'Firebase Blog', url: 'https://firebase.blog/rss.xml', platform: '跨平台', category: 'blog', limit: 30 },
];

const toDate = (item: FeedItem) => {
  const d = new Date(item.isoDate ?? item.pubDate ?? '');
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
};

export function parseSourceItems(source: NewsSource, items: FeedItem[]): DevNewsItem[] {
  return items.slice(0, source.limit ?? items.length).flatMap(item => {
    const shaped = source.transform ? source.transform(item) : { title: (item.title ?? '').trim(), url: item.link };
    if (source.include && !source.include.test(shaped?.title ?? '')) return [];
    const url = safeUrl(shaped?.url);
    const date = toDate(item);
    if (!shaped?.title || !url || !date) return [];
    return [{
      id: `${source.id}:${url}`,
      source: source.name,
      platform: source.platform,
      category: source.category,
      title: shaped.title.replace(/\s+/g, ' '),
      url,
      date,
      important: (source.important?.test(shaped.title) ?? false) || REQUIREMENTS.test(shaped.title),
    }];
  });
}

/** Some servers (e.g. swift.org) send gzip bytes without a Content-Encoding header */
export function decodeFeedBody(bytes: Uint8Array): string {
  const buffer = Buffer.from(bytes);
  return (buffer[0] === 0x1f && buffer[1] === 0x8b ? gunzipSync(buffer) : buffer).toString('utf8').replace(/^﻿/, '');
}

async function fetchSource(source: NewsSource): Promise<DevNewsItem[]> {
  const res = await fetchWithTimeout(source.url, { headers: { 'User-Agent': 'Mozilla/5.0 (os-version-tracker)', Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const feed = await new RssParser().parseString(decodeFeedBody(new Uint8Array(await res.arrayBuffer())));
  return parseSourceItems(source, feed.items as FeedItem[]);
}

/** Newest first, within the last `days`, de-duplicated by URL, at most `perSource` items from each feed */
export function mergeNews(lists: DevNewsItem[][], now = new Date(), days = 60, limit = 80, perSource = 12): DevNewsItem[] {
  const since = new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const seen = new Set<string>();
  return lists.map(list => list.filter(item => item.date >= since).sort((a, b) => b.date.localeCompare(a.date)).slice(0, perSource)).flat()
    .filter(item => item.date >= since && !seen.has(item.url) && seen.add(item.url))
    .sort((a, b) => b.date.localeCompare(a.date) || Number(b.important) - Number(a.important))
    .slice(0, limit);
}

/** Partial results are fine; fails only when every feed failed */
export async function fetchDevNews(sources = NEWS_SOURCES, fetcher: (s: NewsSource) => Promise<DevNewsItem[]> = fetchSource): Promise<DevNewsItem[]> {
  const { values } = await settleSources('dev news', sources.map(s => [s.name, () => fetcher(s)] as const), list => list.length > 0);
  return mergeNews([...values.values()]);
}
