import { fetchHtml } from './html-table.js';
import type { SubmissionDeadline, SDKRequirement } from '../types.js';

const API_TARGET = /Android\s+\d+\s*\(API\s+level\s+\d+\)(?:\s+or\s+higher)?/;

function stripTags(html: string): string {
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

// Each <li> reads like "New apps and app updates must target Android 16 (API level 36) or higher ...;
// except for Wear OS and Android Automotive OS apps, which must target Android 15 (API level 35) ..."
function parseRequirements(html: string, from: number): SDKRequirement[] {
  const list = html.slice(from).match(/<ul>([\s\S]*?)<\/ul>/)?.[1] ?? '';
  const requirements: SDKRequirement[] = [];

  for (const li of list.matchAll(/<li>([\s\S]*?)<\/li>/g)) {
    const text = stripTags(li[1]);
    const main = text.match(new RegExp(`^(.+?)\\s+must\\s+target\\s+(${API_TARGET.source})`, 'i'));
    if (!main) continue;
    requirements.push({ platform: main[1], sdk: main[2] });

    const exception = new RegExp(`([A-Z][\\w ]*?) apps,? which must target (${API_TARGET.source})`, 'g');
    for (const ex of text.matchAll(exception)) {
      requirements.push({ platform: ex[1], sdk: ex[2] });
    }
  }
  return requirements;
}

// `?hl=en` is required: without it Google sometimes serves a machine-translated page the parser can't read
export const GOOGLE_TARGET_SDK_URL = 'https://developer.android.com/google/play/requirements/target-sdk?hl=en';

export async function fetchGooglePlayDeadline(): Promise<SubmissionDeadline | null> {
  return parseGooglePlayDeadline(await fetchHtml(GOOGLE_TARGET_SDK_URL));
}

/** Throws when the deadline or target API requirements can't be found, so a layout change is reported */
export function parseGooglePlayDeadline(html: string): SubmissionDeadline {
  // Match "Starting August 31 2025:" or "Starting August 31, 2025"
  const dateMatch = html.match(/Starting\s+([A-Za-z]+\s+\d{1,2},?\s+\d{4})/);
  if (!dateMatch) {
    throw new Error('Google Play target SDK deadline not found');
  }

  const deadline = dateMatch[1].replace(/(\d)\s+(\d{4})/, '$1, $2');

  const requirements = parseRequirements(html, dateMatch.index ?? 0);
  if (!requirements.length) {
    throw new Error('Google Play target SDK requirements parsed empty');
  }

  // Check for extension date
  const extMatch = html.match(/extension\s+to\s+([A-Za-z]+\s+\d{1,2},?\s+\d{4})/i);
  const extensionDate = extMatch ? extMatch[1].replace(/(\d)\s+(\d{4})/, '$1, $2') : undefined;

  return {
    source: 'google',
    deadline,
    requirements,
    extensionDate,
  };
}
