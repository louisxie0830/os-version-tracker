import RssParser from 'rss-parser';
import type { SubmissionDeadline, SDKRequirement } from '../types.js';

export async function fetchAppleSubmissionDeadline(): Promise<SubmissionDeadline | null> {
  const parser = new RssParser();
  const feed = await parser.parseURL('https://developer.apple.com/news/rss/news.rss');

  const item = feed.items.find(i => {
    const title = i.title?.toLowerCase() ?? '';
    return title.includes('sdk') && title.includes('requirement');
  });

  if (!item?.contentSnippet && !item?.content) {
    return null;
  }

  const text = item.contentSnippet ?? item.content ?? '';

  const dateMatch = text.match(/Starting\s+([A-Za-z]+\s+\d{1,2},\s+\d{4})/);
  if (!dateMatch) {
    return null;
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

  const announcedAt = item.pubDate
    ? new Date(item.pubDate).toISOString().slice(0, 10)
    : 'unknown';

  return {
    source: 'apple',
    deadline: dateMatch[1],
    announcedAt,
    requirements,
  };
}
