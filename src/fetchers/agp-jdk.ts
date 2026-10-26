import { fetchHtml, parseTables } from './html-table.js';
import { compareVersions } from '../versions.js';

const BASE = 'https://developer.android.com';
export const AGP_CURRENT_URL = `${BASE}/build/releases/gradle-plugin?hl=en`;
export const AGP_PAST_RELEASES_URL = `${BASE}/build/releases/past-releases?hl=en`;
const DEFAULT_LINES = 10;

export interface AgpJdkRequirement {
  /** AGP minor line, e.g. "9.3" */
  agp: string;
  /** Minimum (and default) JDK, e.g. "17" */
  jdk: string;
  minGradle?: string;
  minBuildTools?: string;
  /** Default NDK version AGP uses when none is configured */
  defaultNdk?: string;
  /** Minimum Kotlin Gradle plugin, only listed on AGP 9.x pages that have the row */
  minKgp?: string;
  /** Highest compileSdk / API level this AGP line supports, e.g. "37" */
  maxApi?: string;
  /** The patch that brought maxApi, when the page names one ("9.1.1 supports … API level 37"): earlier 9.1.x don't */
  maxApiFrom?: string;
  /** Month in the page title (the latest patch on that page, e.g. 9.1.1), e.g. "July 2026" */
  released?: string;
  url: string;
}

export function releaseNotesUrl(agp: string): string {
  const [major, minor] = agp.split('.');
  return `${BASE}/build/releases/agp-${major}-${minor}-0-release-notes?hl=en`;
}

/** Extracts the AGP minor lines linked from the "past releases" index, e.g. ["9.3", "9.2", ...], newest first */
export function parsePastReleaseLines(html: string): string[] {
  const lines = new Set<string>();
  for (const m of html.matchAll(/\/build\/releases\/agp-(\d+)-(\d+)-0-release-notes/g)) lines.add(`${m[1]}.${m[2]}`);
  return [...lines].sort((a, b) => compareVersions(b, a));
}

/**
 * Parses an AGP release-notes page ("Android Gradle plugin 9.3.0 (July 2026)"), reading its
 * Compatibility table (rows: Gradle, SDK Build Tools, NDK, JDK, optionally Kotlin Gradle plugin).
 * Returns undefined if the page has no recognizable compatibility table.
 */
export function parseAgpReleaseNotes(html: string, url: string): AgpJdkRequirement | undefined {
  const tables = parseTables(html);
  const table = tables.find(t => t.rows.some(r => r[0] === 'JDK') && t.rows.some(r => r[0] === 'Gradle'));
  if (!table) return undefined;

  const header = table.rows[0] ?? [];
  const minCol = Math.max(1, header.findIndex(h => /minimum/i.test(h)));
  const defCol = header.findIndex(h => /default/i.test(h));
  const row = (re: RegExp) => table.rows.find(r => re.test(r[0]));
  const value = (re: RegExp, col: number) => {
    const v = row(re)?.[col]?.trim();
    return v && !/^N\/?A$/i.test(v) ? v : undefined;
  };

  const pageTitle = html.match(/<title>([^<]*)<\/title>/i)?.[1] ?? table.context;
  const title = pageTitle.match(/Android Gradle plugin (\d+)\.(\d+)(?:\.\d+)?\s*\(([A-Za-z]+ \d{4})\)/i);
  const agp = title ? `${title[1]}.${title[2]}` : url.match(/agp-(\d+)-(\d+)-0-release-notes/)?.slice(1, 3).join('.');
  const jdk = value(/^JDK$/, minCol);
  if (!agp || !jdk) return undefined;

  return {
    agp,
    jdk,
    minGradle: value(/^Gradle$/, minCol),
    minBuildTools: value(/^SDK Build Tools$/, minCol),
    defaultNdk: defCol > 0 ? value(/^NDK$/, defCol) : undefined,
    minKgp: value(/^Kotlin Gradle plugin/i, minCol),
    // Phrased either "The maximum API level that Android Gradle plugin 9.3 supports is API level 37."
    // or "Android Gradle plugin 9.1.1 supports Android API level 37.0 and below."
    maxApi: (table.context.match(/maximum API level that Android Gradle plugin [\d.]+ supports is API level ([\d.]+)/i)
      ?? table.context.match(/Android Gradle plugin [\d.]+ supports (?:Android )?API level ([\d.]+) and below/i))?.[1]?.replace(/\.$/, '').replace(/\.0$/, ''),
    ...(() => {
      const from = table.context.match(/Android Gradle plugin (\d+\.\d+\.([1-9]\d*)) supports/i)?.[1];
      return from ? { maxApiFrom: from } : {};
    })(),
    released: title?.[3],
    url,
  };
}

/**
 * JDK (plus Gradle / Build Tools) required by each of the latest `count` AGP minor lines.
 * Individual page failures are tolerated; throws only if nothing parses.
 */
/** A page the rest can do without: logged, so a short table has a visible reason */
const missing = (page: string, err: unknown): string => {
  console.warn(`[agpJdk] ${page} failed (${(err as Error)?.message ?? err}); continuing without it`);
  return '';
};

export async function fetchAgpJdk(count = DEFAULT_LINES): Promise<AgpJdkRequirement[]> {
  const [currentHtml, pastHtml] = await Promise.all([
    // gradle-plugin redirects to the latest agp-X-Y-0-release-notes page
    fetchHtml(AGP_CURRENT_URL).catch(err => missing('current release notes', err)),
    fetchHtml(AGP_PAST_RELEASES_URL).catch(err => missing('past releases index', err)),
  ]);

  const current = currentHtml ? parseAgpReleaseNotes(currentHtml, AGP_CURRENT_URL) : undefined;
  if (current) current.url = releaseNotesUrl(current.agp);

  const lines = parsePastReleaseLines(pastHtml)
    .filter(l => l !== current?.agp)
    .slice(0, current ? count - 1 : count);

  const settled = await Promise.allSettled(lines.map(async agp => {
    const url = releaseNotesUrl(agp);
    const parsed = parseAgpReleaseNotes(await fetchHtml(url), url);
    if (!parsed) throw new Error(`No compatibility table on ${url}`);
    return { ...parsed, agp };
  }));
  for (const s of settled) {
    if (s.status === 'rejected') console.warn(`AGP release notes: ${s.reason instanceof Error ? s.reason.message : s.reason}`);
  }

  const results = [
    ...(current ? [current] : []),
    ...settled.flatMap(s => (s.status === 'fulfilled' ? [s.value] : [])),
  ].sort((a, b) => compareVersions(b.agp, a.agp));

  if (!results.length) throw new Error('Could not parse JDK requirements from any AGP release notes page');
  return results;
}
