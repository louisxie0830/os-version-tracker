import RssParser from 'rss-parser';
import type { AnnouncedDevice, NewsItem } from '../types.js';


// Posts engineers usually have to act on, as opposed to case studies and event recaps
const APPLE_IMPORTANT = /requirement|deadline|expir|must|submit|prepare|agreement|privacy|SDK|certificate|review guideline|deprecat|update.*(?:policy|terms)/i;
const ANDROID_IMPORTANT = /policy|target api|targetSdk|deprecat|requirement|deadline|migrat|16 ?KB|breaking|behavior change|Android \d+(?: QPR\d)? (?:beta|developer preview|is here|release)/i;

function toISODate(date?: string): string {
  if (!date) return '';
  const d = new Date(date);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
}

export const APPLE_NEWS_URL = 'https://developer.apple.com/news/rss/news.rss';
export const ANDROID_NEWS_URL = 'https://android-developers.googleblog.com/atom.xml';

interface FeedItem {
  title?: string;
  link?: string;
  isoDate?: string;
  pubDate?: string;
}

/** Maps parsed RSS/Atom items to NewsItems; throws on an empty feed, which means the feed format changed */
export function toNewsItems(items: FeedItem[], important: RegExp): NewsItem[] {
  const news = items
    .map(item => {
      const title = (item.title ?? '').trim();
      return {
        title,
        url: item.link ?? '',
        date: toISODate(item.isoDate ?? item.pubDate),
        important: important.test(title),
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

async function fetchFeed(url: string, important: RegExp): Promise<NewsItem[]> {
  const feed = await new RssParser({ timeout: 15_000 }).parseURL(url);
  return toNewsItems(feed.items, important);
}

export function fetchAppleNews(): Promise<NewsItem[]> {
  return fetchFeed(APPLE_NEWS_URL, APPLE_IMPORTANT);
}

export function fetchAndroidNews(): Promise<NewsItem[]> {
  return fetchFeed(ANDROID_NEWS_URL, ANDROID_IMPORTANT);
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
      if (!knownSet.has(normalize(name)) && !found.has(name)) {
        found.set(name, { name, title: item.title, url: item.url, date: item.date });
      }
    }
  }
  return [...found.values()];
}
