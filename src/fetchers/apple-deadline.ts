import RssParser from 'rss-parser';
import { fetchFeed } from './feed.js';
import type { SubmissionDeadline, SDKRequirement } from '../types.js';

export const APPLE_NEWS_RSS_URL = 'https://developer.apple.com/news/rss/news.rss';

interface FeedItem {
  title?: string;
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

/**
 * Picks the newest "SDK ... requirement" post. Returns null when there is no such post
 * (Apple simply hasn't announced one), but throws when the post exists and can't be read.
 */
export function parseAppleSubmissionFeedItems(items: FeedItem[]): SubmissionDeadline | null {
  const item = items.find(i => {
    const title = i.title?.toLowerCase() ?? '';
    return title.includes('sdk') && title.includes('requirement');
  });

  if (!item?.contentSnippet && !item?.content) {
    return null;
  }

  return parseAppleSubmissionText(item.contentSnippet ?? item.content ?? '', item.pubDate);
}

/**
 * Parses the plain text of an "Upcoming SDK minimum requirements" post, e.g.
 * "Starting April 28, 2026, ... iOS and iPadOS apps must be built with the iOS 26 & iPadOS 26 SDK or later".
 */
export function parseAppleSubmissionText(text: string, pubDate?: string): SubmissionDeadline {
  // Apple's posts use non-breaking spaces ("iOS\u00a026"); normalise so values compare/display cleanly
  text = text.replace(/\u00a0/g, ' ');
  const dateMatch = text.match(/Starting\s+([A-Za-z]+\s+\d{1,2},\s+\d{4})/);
  if (!dateMatch) {
    throw new Error('Apple SDK requirement post has no "Starting <date>"');
  }

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

  const published = pubDate ? new Date(pubDate) : null;
  const announcedAt = published && !Number.isNaN(published.getTime())
    ? published.toISOString().slice(0, 10)
    : 'unknown';

  return {
    source: 'apple',
    deadline: dateMatch[1],
    announcedAt,
    requirements,
  };
}
