import RssParser from 'rss-parser';
import { fetchFeed } from './feed.js';
import type { AnnouncedDevice, NewsItem } from '../types.js';
import { feedDay } from '../taipei-date.js';


// Posts engineers usually have to act on, as opposed to case studies and event recaps
const APPLE_IMPORTANT = /requirement|deadline|expir|must|submit|prepare|agreement|privacy|SDK|certificate|review guideline|deprecat|update.*(?:policy|terms)/i;
/** Wording in a post's text that asks developers to do something */
const ACTION_IN_BODY = /\b(?:what you need to do|you(?:'ll| will) need to|action (?:is )?required|make sure (?:your|that)|update your (?:app|server|code|allow ?list))\b/i;
const ANDROID_IMPORTANT = /policy|target api|targetSdk|deprecat|requirement|deadline|migrat|16 ?KB|breaking|behavior change|Android \d+(?: QPR\d)? (?:beta|developer preview|is here|release)/i;

const toISODate = (date?: string): string => feedDay(date) ?? '';

export const APPLE_NEWS_URL = 'https://developer.apple.com/news/rss/news.rss';
// Moved from android-developers.googleblog.com in October 2026 (the old address now redirects to a login page)
export const ANDROID_NEWS_URL = 'https://developer.android.com/blog/atom.xml';

interface FeedItem {
  title?: string;
  link?: string;
  isoDate?: string;
  pubDate?: string;
  /** An Atom entry's <published> as written (feed.ts) */
  published?: string;
  /** The post's text, as rss-parser gives it */
  contentSnippet?: string;
}

/** Maps parsed RSS/Atom items to NewsItems; throws on an empty feed, which means the feed format changed */
export function toNewsItems(items: FeedItem[], important: RegExp): NewsItem[] {
  const news = items
    .map(item => {
      const title = (item.title ?? '').trim();
      return {
        title,
        url: item.link ?? '',
        date: toISODate(item.published ?? item.pubDate ?? item.isoDate),
        // The title, or a post whose text asks developers to act ("New domain for Sign in with Apple" says only
        // in its body that email checks must accept the new domain)
        important: important.test(title) || ACTION_IN_BODY.test((item.contentSnippet ?? '').slice(0, 600)),
      };
    })
    .filter(item => item.title);
  if (!news.length) throw new Error('News feed parsed empty');
  return news;
}

/** Parses feed XML; `platform` picks which "important" heuristic applies */
export async function parseNewsFeed(xml: string, platform: 'apple' | 'android'): Promise<NewsItem[]> {
  const feed = await new RssParser().parseString(xml);
  return toNewsItems(feed.items, platform === 'apple' ? APPLE_IMPORTANT : ANDROID_IMPORTANT);
}

async function fetchNews(url: string, important: RegExp): Promise<NewsItem[]> {
  const feed = await fetchFeed(url);
  return toNewsItems(feed.items, important);
}

export function fetchAppleNews(): Promise<NewsItem[]> {
  return fetchNews(APPLE_NEWS_URL, APPLE_IMPORTANT);
}

export function fetchAndroidNews(): Promise<NewsItem[]> {
  return fetchNews(ANDROID_NEWS_URL, ANDROID_IMPORTANT);
}

/**
 * iPhone models Apple's news mentions that the device database doesn't list yet,
 * e.g. "Prepare and submit your apps for iPhone Duo" before endoflife.date adds it.
 */
export function findAnnouncedDevices(news: NewsItem[], known: string[]): AnnouncedDevice[] {
  const normalize = (name: string) => name.toLowerCase().replace(/\s+/g, ' ').trim();
  const knownSet = new Set(known.map(normalize));
  const found = new Map<string, AnnouncedDevice>();

  for (const item of news) {
    for (const m of item.title.matchAll(/\biPhone\s+((?:\d+[a-z]?|[A-Z][a-z]+)(?:\s+(?:Pro|Max|Plus|mini|Air|Fold|Ultra))*)/g)) {
      const name = `iPhone ${m[1]}`;
      // The first post about it is the announcement (the feed is newest first, so a later post replaces it)
      const seen = found.get(name);
      if (!knownSet.has(normalize(name)) && (!seen || (item.date && item.date < seen.date))) {
        found.set(name, { name, title: item.title, url: item.url, date: item.date });
      }
    }
  }
  return [...found.values()];
}
