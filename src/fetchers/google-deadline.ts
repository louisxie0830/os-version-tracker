import { cleanText, fetchHtml } from './html-table.js';
import { calendarDate } from '../taipei-date.js';
import type { SubmissionDeadline, SDKRequirement } from '../types.js';

const API_TARGET = /Android\s+\d+\s*\(API\s+level\s+\d+\)(?:\s+or\s+higher)?/;

// Each <li> reads like "New apps and app updates must target Android 16 (API level 36) or higher ...;
// except for Wear OS and Android Automotive OS apps, which must target Android 15 (API level 35) ..."
function parseRequirements(html: string, from: number): SDKRequirement[] {
  const list = html.slice(from).match(/<ul[^>]*>([\s\S]*?)<\/ul>/)?.[1] ?? '';
  const requirements: SDKRequirement[] = [];

  for (const li of list.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/g)) {
    const text = cleanText(li[1]);
    const main = text.match(new RegExp(`^(.+?)\\s+must\\s+target\\s+(${API_TARGET.source})`, 'i'));
    if (!main) continue;
    requirements.push({ platform: main[1], sdk: main[2] });

    const exception = new RegExp(`([A-Z][\\w ]*?) apps,? which must target (${API_TARGET.source})`, 'g');
    for (const ex of text.matchAll(exception)) {
      requirements.push({ platform: ex[1], sdk: ex[2] });
    }
    // Existing apps of other device types, given as what's restricted: "including Android 13 (API level 33) or
    // lower for Wear OS, Android TV, and Android XR, and Android 12 (API level 31) or lower for Android
    // Automotive OS" → those must target one level above to stay available to new users
    if (/^existing apps$/i.test(main[1])) {
      const including = text.match(/\bincluding (.+?),? will only be available/i)?.[1] ?? '';
      for (const part of including.split(/,? and (?=Android [\d.L]+ \(API)/)) {
        const low = part.match(/^Android [\d.L]+ \(API level (\d+)\) or lower for (.+?),?$/);
        if (low) requirements.push({ platform: `Existing ${low[2].replace(/,? and /g, ', ')} apps`, sdk: `API level ${Number(low[1]) + 1} or higher` });
      }
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
  // "Starting August 31, 2026:" introduces the requirement list. The page also mentions earlier deadlines
  // ("Starting August 31, 2025, …"), so: the dates introducing a list (with a colon) first, else any; and of
  // those, the latest, never simply the first one on the page
  const DATE = String.raw`(?:Starting|From|Beginning|As of)\s+([A-Za-z]+\s+\d{1,2},?\s+\d{4})`;
  const all = (pattern: string) => [...html.matchAll(new RegExp(pattern, 'gi'))].filter(m => calendarDate(m[1]));
  const candidates = all(`${DATE}\\s*:`).length ? all(`${DATE}\\s*:`) : all(DATE);
  const sorted = candidates.sort((a, b) => calendarDate(b[1])!.localeCompare(calendarDate(a[1])!));
  const dateMatch = sorted[0];
  if (!dateMatch) {
    throw new Error('Google Play target SDK deadline not found');
  }
  const latest = deadlineAt(html, dateMatch);
  if (!latest.requirements.length) {
    throw new Error('Google Play target SDK requirements parsed empty');
  }
  // A newer deadline posted while an older one's extension is still open: the older one too, with its own list
  const earlier = sorted.slice(1)
    .filter(m => /:\s*$/.test(m[0]))
    .map(m => deadlineAt(html, m))
    .filter(d => d.requirements.length && calendarDate(d.deadline) !== calendarDate(latest.deadline))
    // A date named twice (a second block for one device type): once, the first with its extension
    .filter((d, i, all) => all.findIndex(o => calendarDate(o.deadline) === calendarDate(d.deadline)) === i);
  return { ...latest, ...(earlier.length ? { earlier } : {}) };
}

/** The deadline a "Starting <date>:" introduces: its requirement list and the extension mentioned after it */
function deadlineAt(html: string, dateMatch: RegExpMatchArray): SubmissionDeadline {
  const deadline = dateMatch[1].replace(/(\d)\s+(\d{4})/, '$1, $2');
  // Up to the next "Starting <date>:", so one deadline's list and extension are never read for another
  const from = dateMatch.index ?? 0;
  const next = html.slice(from + dateMatch[0].length).search(/(?:Starting|From|Beginning|As of)\s+[A-Za-z]+\s+\d{1,2},?\s+\d{4}\s*:/i);
  const own = next < 0 ? html.slice(from) : html.slice(from, from + dateMatch[0].length + next);
  const requirements = parseRequirements(own, 0);

  // The extension that goes with this deadline: mentioned after it, and later than it
  const extMatch = own.match(/extension\s+to\s+([A-Za-z]+\s+\d{1,2},?\s+\d{4})/i);
  const extension = extMatch ? extMatch[1].replace(/(\d)\s+(\d{4})/, '$1, $2') : undefined;
  const extensionDate = extension && (calendarDate(extension) ?? '') > (calendarDate(deadline) ?? '') ? extension : undefined;

  return {
    source: 'google',
    deadline,
    requirements,
    extensionDate,
  };
}
