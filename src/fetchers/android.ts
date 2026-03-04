import RssParser from 'rss-parser';
import type { OSVersionInfo } from '../types.js';

interface EndOfLifeAndroid {
  cycle: string;
  releaseDate: string;
  eol: string | boolean;
  lts: boolean;
  codename: string;
  apiVersion: string;
}

const BLOG_FEED = 'https://android-developers.googleblog.com/atom.xml';

const ORDINALS: Record<string, string> = {
  first: '1', second: '2', third: '3', fourth: '4', fifth: '5',
  sixth: '6', seventh: '7', eighth: '8', ninth: '9', tenth: '10',
};

function parseBetaTitle(title: string): string | null {
  // Match "Android NN" portion (with optional QPR)
  const baseMatch = title.match(/Android\s+(\d+)(?:\s+QPR\d+)?/i);
  if (!baseMatch) return null;
  const base = baseMatch[0];

  // "The Second Beta of Android 17" → ordinal style
  const ordinalMatch = title.match(/(\w+)\s+Beta\b/i);
  if (ordinalMatch) {
    const word = ordinalMatch[1].toLowerCase();
    const num = ORDINALS[word] ?? word;
    return `${base} Beta ${num}`;
  }

  // "Android 17 Beta 3" → direct number style
  const directMatch = title.match(/Beta\s*(\d+(?:\.\d+)?)/i);
  if (directMatch) return `${base} Beta ${directMatch[1]}`;

  // "Developer Preview"
  const dpOrdinal = title.match(/(\w+)\s+Developer\s+Preview/i);
  if (dpOrdinal) {
    const word = dpOrdinal[1].toLowerCase();
    const num = ORDINALS[word] ?? word;
    return `${base} DP${num}`;
  }

  return `${base} Beta`;
}

async function fetchBetaFromBlog(): Promise<OSVersionInfo | null> {
  const parser = new RssParser();
  const feed = await parser.parseURL(BLOG_FEED);

  const betaEntry = feed.items.find(item => {
    const title = item.title ?? '';
    return /\b(Beta|Developer Preview)\b/i.test(title) && /\bAndroid\s+\d/i.test(title);
  });

  if (!betaEntry) return null;

  const title = betaEntry.title ?? '';
  const version = parseBetaTitle(title) ?? title;

  const releaseDate = betaEntry.isoDate
    ? betaEntry.isoDate.split('T')[0]
    : 'unknown';

  return {
    platform: 'Android',
    version,
    releaseDate,
    isBeta: true,
  };
}

export async function fetchAndroidVersions(): Promise<OSVersionInfo[]> {
  const results: OSVersionInfo[] = [];

  // Fetch stable version
  const res = await fetch('https://endoflife.date/api/android.json');
  if (!res.ok) {
    throw new Error(`Android API request failed: ${res.status}`);
  }

  const data = await res.json() as EndOfLifeAndroid[];
  if (!data.length) {
    throw new Error('No Android versions found');
  }

  const latest = data[0];
  results.push({
    platform: 'Android',
    version: `Android ${latest.cycle}`,
    apiLevel: latest.apiVersion,
    codename: latest.codename,
    releaseDate: latest.releaseDate,
  });

  // Fetch beta version from Android Developers Blog
  try {
    const beta = await fetchBetaFromBlog();
    if (beta) {
      results.push(beta);
    }
  } catch (err) {
    console.warn(`[Android] Beta blog feed failed (${(err as Error).message})`);
  }

  return results;
}
