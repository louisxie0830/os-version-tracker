import { cleanText, fetchHtml } from './html-table.js';

/**
 * What changes for apps that target a new Android version: the headings of its "behavior changes: apps
 * targeting Android N" page (developer.android.com/about/versions/N/behavior-changes-N). The next Play target API
 * requirement brings exactly these, so the next-wave action lists them.
 */
export interface BehaviorChanges {
  /** Android major, e.g. "17" */
  major: string;
  /** The changes, by their headings ("Static final fields are now unmodifiable") */
  changes: string[];
  url: string;
}

export const behaviorChangesUrl = (major: string) => `https://developer.android.com/about/versions/${major}/behavior-changes-${major}`;

/** Code-sample tabs and the site footer's navigation also use h3: not changes */
const NOT_A_CHANGE = /^(?:Kotlin|Java|More Android|Discover|Android Devices|Releases|Documentation and Downloads|Support|Was this helpful\?)$/i;

export function parseBehaviorChanges(html: string, major: string): BehaviorChanges {
  // The page body (the footer's headings come after it)
  const body = html.split(/<devsite-footer|<footer\b/)[0];
  const changes = [...body.matchAll(/<h3[^>]*>([\s\S]*?)<\/h3>/g)]
    .map(m => cleanText(m[1]))
    .filter(h => h && !NOT_A_CHANGE.test(h));
  if (changes.length < 3) throw new Error(`Android ${major} behavior changes: only ${changes.length} headings found`);
  return { major, changes: [...new Set(changes)], url: behaviorChangesUrl(major) };
}

export async function fetchBehaviorChanges(major: string | undefined): Promise<BehaviorChanges | null> {
  if (!major) return null;
  return parseBehaviorChanges(await fetchHtml(`${behaviorChangesUrl(major)}?hl=en`), major);
}
