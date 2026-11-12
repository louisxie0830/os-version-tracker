import type { OSVersionInfo } from '../types.js';
import { fetchJson, NETWORK_TIMEOUT_MS } from '../net.js';
import { fetchFeed } from './feed.js';
import { cleanText, fetchHtml, parseTables } from './html-table.js';
import { calendarDate, feedDay } from '../taipei-date.js';
import { compareVersions } from '../versions.js';

export interface EndOfLifeAndroid {
  cycle: string;
  releaseDate: string;
  eol: string | boolean;
  lts: boolean;
  codename: string;
  apiVersion: string;
}

const BLOG_FEED = 'https://developer.android.com/blog/atom.xml';
export const ANDROID_GSI_RELEASES = 'https://developer.android.com/topic/generic-system-image/releases';

const ORDINALS: Record<string, string> = {
  first: '1', second: '2', third: '3', fourth: '4', fifth: '5',
  sixth: '6', seventh: '7', eighth: '8', ninth: '9', tenth: '10',
};

export function parseBetaTitle(title: string): string | null {
  // Match "Android NN" portion (with optional QPR)
  const baseMatch = title.match(/Android\s+(\d+)(?:\s+QPR\s*(\d+))?/i);
  if (!baseMatch) return null;
  const base = `Android ${baseMatch[1]}${baseMatch[2] ? ` QPR${baseMatch[2]}` : ''}`;

  // "Android 17 Beta 3" / "Android 17 QPR3 Beta 2" → direct number style (checked first: "QPR3" is not an ordinal)
  const directMatch = title.match(/Beta\s*(\d+(?:\.\d+)?)/i);
  if (directMatch) return `${base} Beta ${directMatch[1]}`;

  // "The Second Beta of Android 17" → ordinal style
  const ordinalMatch = title.match(/(\w+)\s+Beta\b/i);
  const ordinal = ordinalMatch && ORDINALS[ordinalMatch[1].toLowerCase()];
  if (ordinal) return `${base} Beta ${ordinal}`;

  // "Developer Preview 2" → numbered style
  const dpNumber = title.match(/Developer\s+Preview\s*(\d+)/i);
  if (dpNumber) return `${base} DP${dpNumber[1]}`;

  // "The Second Developer Preview of Android 18" → ordinal style
  const dpOrdinal = title.match(/(\w+)\s+Developer\s+Preview/i);
  if (dpOrdinal) {
    const word = dpOrdinal[1].toLowerCase();
    const num = ORDINALS[word] ?? word;
    return `${base} DP${num}`;
  }

  return `${base} Beta`;
}

/** Newest Android beta / developer preview post in the Android Developers Blog feed */
export function parseBetaFeed(items: Array<{ title?: string; isoDate?: string; pubDate?: string; published?: string }>): OSVersionInfo | null {
  const betaEntry = items.find(item => {
    const title = item.title ?? '';
    return /\b(Beta|Developer Preview)\b/i.test(title) && /\bAndroid\s+\d/i.test(title);
  });
  if (!betaEntry) return null;
  const title = betaEntry.title ?? '';
  return {
    platform: 'Android',
    version: parseBetaTitle(title) ?? title,
    releaseDate: feedDay(betaEntry.published ?? betaEntry.pubDate ?? betaEntry.isoDate) ?? 'unknown',
    isBeta: true,
  };
}

/** endoflife.date lists Android cycles newest first */
export function parseEndOfLifeAndroid(data: EndOfLifeAndroid[]): OSVersionInfo {
  if (!data.length) throw new Error('No Android versions found');
  const latest = data[0];
  return {
    platform: 'Android',
    version: `Android ${latest.cycle}`,
    apiLevel: latest.apiVersion,
    codename: latest.codename,
    releaseDate: latest.releaseDate,
  };
}

/**
 * A beta of a major version that is already stable. A QPR beta of the current major is a later update, so it
 * still counts as upcoming; a QPR beta of an older major doesn't.
 */
export function androidBetaShipped(beta: OSVersionInfo, stable: OSVersionInfo): boolean {
  const betaMajor = Number(beta.version.match(/Android\s+(\d+)/i)?.[1]);
  const stableMajor = Number(stable.version.match(/(\d+)/)?.[1]);
  if (!Number.isFinite(betaMajor) || !Number.isFinite(stableMajor)) return false;
  return /\bQPR\d/i.test(beta.version) ? betaMajor < stableMajor : betaMajor <= stableMajor;
}

async function fetchBetaFromBlog(): Promise<OSVersionInfo | null> {
  return parseBetaFeed((await fetchFeed(BLOG_FEED)).items);
}

/** The GSI page distinguishes active QPR betas from tracks whose old release notes are still online. */
function qprBetaTracks(html: string, stableMajor: number): Map<string, string> {
  const tracks = new Map<string, string>();
  const shipped = new Set<string>();
  const labels = [...cleanText(html).matchAll(/\bAndroid\s+(\d+)\s+QPR\s*(\d+)\s*\((Beta|stable(?: release)?)\)/gi)];
  if (!labels.length) throw new Error('No QPR tracks found on the Android GSI page');
  for (const [, major, qpr, status] of labels) {
    if (Number(major) < stableMajor) continue;
    const track = `Android ${major} QPR${qpr}`;
    if (status.toLowerCase() === 'beta') tracks.set(track, `https://developer.android.com/about/versions/${major}/qpr${qpr}/release-notes?hl=en`);
    else shipped.add(track);
  }
  for (const track of shipped) tracks.delete(track);
  return tracks;
}

function parseQprReleaseNotes(html: string, track: string): OSVersionInfo | null {
  const releases = parseTables(html).flatMap(({ context, rows }) => {
    const beta = context.match(/\bBeta\s+(\d+(?:\.\d+)*)$/i)?.[1];
    const date = rows.find(([label]) => /^release date$/i.test(label))?.[1];
    if (!beta || !date) return [];
    const builds = rows.find(([label]) => /^builds?$/i.test(label))?.[1];
    const build = builds?.match(/\b[A-Z0-9]+\.\d{6}\.[A-Z0-9.]+\b/g)?.join(' / ');
    return [{ beta, build, releaseDate: calendarDate(date) ?? 'unknown' }];
  });
  const latest = releases.sort((a, b) => compareVersions(b.beta, a.beta))[0];
  return latest ? { platform: 'Android', version: `${track} Beta ${latest.beta}`, build: latest.build, releaseDate: latest.releaseDate, isBeta: true } : null;
}

async function fetchQprBetas(stableMajor: number): Promise<Map<string, OSVersionInfo | null>> {
  const tracks = qprBetaTracks(await fetchHtml(`${ANDROID_GSI_RELEASES}?hl=en`), stableMajor);
  const releases = await Promise.all([...tracks].map(async ([track, url]) => {
    try {
      const beta = parseQprReleaseNotes(await fetchHtml(url), track);
      if (beta) return [track, beta] as const;
      console.warn(`[Android] No beta release table found for ${track}`);
    } catch (err) {
      console.warn(`[Android] ${track} release notes failed (${(err as Error).message})`);
    }
    return [track, null] as const;
  }));
  return new Map(releases);
}

export async function fetchAndroidVersions(): Promise<OSVersionInfo[]> {
  const stable = parseEndOfLifeAndroid(await fetchJson<EndOfLifeAndroid[]>('https://endoflife.date/api/android.json', {}, NETWORK_TIMEOUT_MS, status => `Android API request failed: ${status}`));
  const [qprBetas, blog] = await Promise.all([
    fetchQprBetas(Number(stable.version.match(/\d+/)?.[0])).catch(err => {
      console.warn(`[Android] QPR release index failed (${(err as Error).message})`);
      return null;
    }),
    fetchBetaFromBlog().catch(err => {
      console.warn(`[Android] Beta blog feed failed (${(err as Error).message})`);
      return null;
    }),
  ]);
  const betas = [...(qprBetas?.values() ?? [])].filter(beta => beta !== null);
  const blogTrack = blog?.version.match(/^(Android \d+ QPR\d+)\b/)?.[1];
  // Keep major betas/previews from the blog. Use a blog QPR only when the index is down or that active track lacks notes.
  if (blog && !androidBetaShipped(blog, stable) && (!blogTrack || !qprBetas || qprBetas.get(blogTrack) === null)) {
    betas.push(blog);
  }
  betas.sort((a, b) => Number(b.releaseDate !== 'unknown') - Number(a.releaseDate !== 'unknown') || b.releaseDate.localeCompare(a.releaseDate));
  return [stable, ...betas];
}
