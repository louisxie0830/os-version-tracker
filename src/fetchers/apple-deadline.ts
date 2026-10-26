import RssParser from 'rss-parser';
import { fetchFeed } from './feed.js';
import type { SubmissionDeadline, SDKRequirement } from '../types.js';
import { feedDay } from '../taipei-date.js';

export const APPLE_NEWS_RSS_URL = 'https://developer.apple.com/news/rss/news.rss';

interface FeedItem {
  title?: string;
  link?: string;
  content?: string;
  contentSnippet?: string;
  pubDate?: string;
}

export async function fetchAppleSubmissionDeadline(): Promise<SubmissionDeadline | null> {
  const feed = await fetchFeed(APPLE_NEWS_RSS_URL);
  return parseAppleSubmissionFeedItems(feed.items);
}

/** Parses the Apple Developer News RSS XML (used by tests; production downloads it with fetchFeed) */
export async function parseAppleSubmissionFeed(xml: string): Promise<SubmissionDeadline | null> {
  const feed = await new RssParser().parseString(xml);
  return parseAppleSubmissionFeedItems(feed.items);
}

/** A post announcing a minimum SDK: "Starting <date>" and "… apps must be built with the … SDK" */
const MONTH = '(?:January|February|March|April|May|June|July|August|September|October|November|December)';
const announcesSdkMinimum = (text: string) => /\bStarting\s+\S+\s+(?:\d{1,2},\s+)?\d{4}\b/.test(text)
  && /\bapps?\s+must\s+be\s+built\s+with\s+the\s+[^\n]*?SDK/i.test(text);

/**
 * Picks the newest post announcing a minimum SDK, by what it says: Apple announces it in a post of its own
 * ("Upcoming SDK minimum requirements") or inside another ("App Store submissions now open for the latest OS
 * releases"). Returns null when there is no such post (Apple simply hasn't announced one), but throws when
 * the post exists and can't be read.
 */
export function parseAppleSubmissionFeedItems(items: FeedItem[]): SubmissionDeadline | null {
  const text = (i: FeedItem) => (i.contentSnippet ?? i.content ?? '').replace(/\u00a0/g, ' ');
  const item = items.find(i => announcesSdkMinimum(text(i)))
    // A post titled as one whose wording changed: read it anyway, so the change fails loudly
    ?? items.find(i => /sdk/i.test(i.title ?? '') && /requirement/i.test(i.title ?? ''));

  if (!item?.contentSnippet && !item?.content) {
    return null;
  }

  const parsed = parseAppleSubmissionText(item.contentSnippet ?? item.content ?? '', item.pubDate);
  return item.link && /^https:\/\//.test(item.link) ? { ...parsed, url: item.link } : parsed;
}

/**
 * Parses the plain text of an "Upcoming SDK minimum requirements" post, e.g.
 * "Starting April 28, 2026, ... iOS and iPadOS apps must be built with the iOS 26 & iPadOS 26 SDK or later".
 */
export function parseAppleSubmissionText(text: string, pubDate?: string): SubmissionDeadline {
  // Apple's posts use non-breaking spaces ("iOS\u00a026"); normalise so values compare/display cleanly
  text = text.replace(/\u00a0/g, ' ');
  // "Starting April 28, 2026," or, a month only, "Starting April 2027 ,"
  // A month by name only: "Starting Spring 2027" is no date to put on a calendar, and fails loudly
  const dateMatch = text.match(new RegExp(`Starting\\s+(${MONTH})\\s+(?:(\\d{1,2}),\\s+)?(\\d{4})\\b`));
  if (!dateMatch) {
    throw new Error('Apple SDK requirement post has no "Starting <date>"');
  }
  const [, month, day, year] = dateMatch;

  const requirements: SDKRequirement[] = [];
  const reqPattern = /(\w[\w\s&]*?)\s+apps?\s+must\s+be\s+built\s+with\s+the\s+([^\n]*?SDK(?:\s+or\s+later)?)/gi;
  let match: RegExpExecArray | null;
  while ((match = reqPattern.exec(text)) !== null) {
    requirements.push({
      platform: match[1].trim(),
      sdk: match[2].trim(),
    });
  }
  if (!requirements.length) {
    throw new Error('Apple SDK requirement post parsed without requirements');
  }

  const announcedAt = feedDay(pubDate) ?? 'unknown';

  return {
    source: 'apple',
    // The same "Month D, YYYY" form either way, so callers reading it as a date keep working
    deadline: `${month} ${day ?? 1}, ${year}`,
    announcedAt,
    requirements,
    ...(day ? {} : { datePrecision: 'month' as const }),
  };
}
