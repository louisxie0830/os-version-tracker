import type { OSVersionInfo } from '../types.js';
import { fetchJson, NETWORK_TIMEOUT_MS } from '../net.js';
import { fetchFeed } from './feed.js';
import { feedDay } from '../taipei-date.js';

export interface EndOfLifeAndroid {
  cycle: string;
  releaseDate: string;
  eol: string | boolean;
  lts: boolean;
  codename: string;
  apiVersion: string;
}

const BLOG_FEED = 'https://developer.android.com/blog/atom.xml';

const ORDINALS: Record<string, string> = {
  first: '1', second: '2', third: '3', fourth: '4', fifth: '5',
  sixth: '6', seventh: '7', eighth: '8', ninth: '9', tenth: '10',
};

export function parseBetaTitle(title: string): string | null {
  // Match "Android NN" portion (with optional QPR)
  const baseMatch = title.match(/Android\s+(\d+)(?:\s+QPR\d+)?/i);
  if (!baseMatch) return null;
  const base = baseMatch[0];

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

export async function fetchAndroidVersions(): Promise<OSVersionInfo[]> {
  const results: OSVersionInfo[] = [parseEndOfLifeAndroid(await fetchJson<EndOfLifeAndroid[]>('https://endoflife.date/api/android.json', {}, NETWORK_TIMEOUT_MS, status => `Android API request failed: ${status}`))];

  // Fetch beta version from Android Developers Blog
  try {
    const beta = await fetchBetaFromBlog();
    // The blog's newest beta post can be for a version that has since shipped ("Android 17 Beta 4" after 17)
    if (beta && !androidBetaShipped(beta, results[0])) {
      results.push(beta);
    }
  } catch (err) {
    console.warn(`[Android] Beta blog feed failed (${(err as Error).message})`);
  }

  return results;
}
