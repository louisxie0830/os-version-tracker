import type https from 'node:https';
import tls from 'node:tls';
import RssParser from 'rss-parser';
import type { OSVersionInfo } from '../types.js';
import { APPLE_ROOT_CA } from './apple-root-ca.js';
import { describe, fetchJson, NETWORK_TIMEOUT_MS, USER_AGENT } from '../net.js';
import { fetchFeed } from './feed.js';
import { compareVersions } from '../versions.js';
import { boundedGet, isTransient } from '../https-get.js';
import { feedDay } from '../taipei-date.js';


// gdmf.apple.com chains to "Apple Root CA", which isn't in Node's bundled
// store. Trust the public roots plus that one Apple root; verification stays on.
// The fetch API can't be given extra roots without a dependency, hence the bounded node:https GET (https-get.ts).
const TRUSTED_CA = [...tls.rootCertificates, APPLE_ROOT_CA];

/** The asset catalog is a few hundred KB; anything near this is not the catalog */
const PMV_MAX_BYTES = 16 * 1024 * 1024;
const RETRY_DELAY_MS = 500;
/** Not worth a retry with less time than this left */
const MIN_RETRY_BUDGET_MS = 2_000;

/**
 * GET with the Apple root trusted. The whole exchange, the one retry included, fits in NETWORK_TIMEOUT_MS
 * (an absolute deadline, not a socket inactivity timeout), so the worst case stays the same as one request.
 * Only a transient connection error is retried, and only with enough of the deadline left; an HTTP error,
 * an oversized body or the deadline itself are final.
 */
export async function httpsGet(url: string, get?: typeof https.get, timeoutMs = NETWORK_TIMEOUT_MS): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await boundedGet(url, { ca: TRUSTED_CA, headers: { 'User-Agent': USER_AGENT }, deadline, maxBytes: PMV_MAX_BYTES, get });
      if (res.status < 200 || res.status >= 300) throw new Error(`HTTP ${res.status} from ${describe(url)}`);
      return res.body.toString();
    } catch (err) {
      if (attempt > 0 || !isTransient(err) || deadline - Date.now() < MIN_RETRY_BUDGET_MS + RETRY_DELAY_MS) throw err;
      await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
    }
  }
}

interface AssetSet {
  ProductVersion: string;
  Build: string;
  PostingDate: string;
  SupportedDevices?: string[];
}

export interface PMVResponse {
  PublicAssetSets: {
    iOS?: AssetSet[];
  };
  AssetSets: {
    iOS?: AssetSet[];
  };
}

/**
 * The newest iOS that iPhones in general get, from Apple's software update catalog. A build for one new model
 * only (iOS 27.1 for the iPhone Duo while every other iPhone is on 27.0.1) is not the current release: only
 * builds for at least half as many iPhones as the widest one count. Falls back to all assets when none list an
 * iPhone.
 */
export function parseAppleAssetCatalog(data: PMVResponse): OSVersionInfo {
  const assets = data.PublicAssetSets?.iOS ?? data.AssetSets?.iOS;
  if (!assets || assets.length === 0) {
    throw new Error('No iOS versions found in ASLS response');
  }
  const iphones = (a: AssetSet) => a.SupportedDevices?.filter(d => d.startsWith('iPhone')).length ?? 0;
  const widest = Math.max(...assets.map(iphones));
  // No asset naming an iPhone means the device list moved or was renamed: which build iPhones get can't be
  // told (the highest version may be one model's), so the release feed answers instead
  if (widest === 0) throw new Error('No iPhone devices listed in the ASLS response');
  const candidates = assets.filter(a => iphones(a) > 0 && iphones(a) * 2 >= widest);
  const latest = [...candidates].sort((a, b) => compareVersions(b.ProductVersion, a.ProductVersion))[0];
  if (typeof latest.ProductVersion !== 'string' || !/^\d+(?:\.\d+){0,2}$/.test(latest.ProductVersion)) {
    throw new Error(`ASLS ProductVersion "${latest.ProductVersion}" doesn't look like a version`);
  }
  return {
    platform: 'iOS',
    version: latest.ProductVersion,
    build: latest.Build,
    releaseDate: latest.PostingDate,
    supportedDevices: latest.SupportedDevices,
  };
}

interface ReleaseFeedItem {
  title?: string;
  pubDate?: string;
}

const feedDate = (item: ReleaseFeedItem) => feedDay(item.pubDate) ?? 'unknown';

/**
 * Newest stable iOS in the Developer Releases feed. Takes the highest version, not the first item:
 * updates for older iOS lines (e.g. "iOS 18.7.10") are often posted after the current release.
 */
export function parseStableReleaseFeed(items: ReleaseFeedItem[]): OSVersionInfo {
  const stable = items.flatMap(item => {
    const title = item.title ?? '';
    if (!/^iOS\s/i.test(title) || /\bbeta\b|\bRC\b|release candidate/i.test(title)) return [];
    const m = title.match(/^iOS\s+([\d.]+)\s*(?:\((\w+)\))?/i);
    return m ? [{ version: m[1], build: m[2], releaseDate: feedDate(item) }] : [];
  });
  if (!stable.length) throw new Error('No iOS stable release found in RSS feed');
  const latest = stable.sort((a, b) => compareVersions(b.version, a.version))[0];
  return { platform: 'iOS', ...latest };
}

/**
 * Newest iOS pre-release in the Developer Releases feed: a beta ("iOS 26.4 beta 3 (23E5223f)") or a release
 * candidate ("iOS 26.4 RC (23E5234a)"), which replaces the betas once it's out
 */
export function parseBetaReleaseFeed(items: ReleaseFeedItem[]): OSVersionInfo | null {
  // "iOS 27.2 beta 3", "iOS & iPadOS 27.2 beta 3", "iOS 27.2 developer beta 3", "iOS 27.2 RC 2"
  const TITLE = /^iOS\b(?:\s*&\s*iPadOS)?\s+([\d.]+)\s+(?:developer\s+|public\s+)?(beta|RC)\s*(\d*)\s*(?:\((\w+)\))?/i;
  const betaRelease = items.find(item => TITLE.test(item.title ?? ''));
  if (!betaRelease) return null;
  const m = betaRelease.title!.match(TITLE)!;
  return {
    platform: 'iOS',
    version: `${m[1]} ${m[2].toLowerCase() === 'rc' ? 'RC' : 'beta'}${m[3] ? ` ${m[3]}` : ''}`,
    build: m[4],
    releaseDate: feedDate(betaRelease),
    isBeta: true,
  };
}

/** The day the release feed posted "iOS <version> (<build>)" (the build too, when known), if it did */
export function releaseDateIn(items: ReleaseFeedItem[], stable: OSVersionInfo): string | undefined {
  const post = items.find(item => {
    const m = item.title?.match(/^iOS\s+([\d.]+)\s*(?:\((\w+)\))?\s*$/i);
    return m && m[1] === stable.version && (!stable.build || !m[2] || m[2] === stable.build);
  });
  const day = post ? feedDate(post) : undefined;
  return day && day !== 'unknown' ? day : undefined;
}

/** A pre-release whose version is already out as a stable release ("27.2 RC" once iOS 27.2 has shipped) */
export function iOSBetaShipped(beta: OSVersionInfo, stable: OSVersionInfo | null): boolean {
  const base = beta.version.match(/^[\d.]+/)?.[0];
  return !!(base && stable && compareVersions(base, stable.version) <= 0);
}

/** endoflife.date lists cycles newest first */
export function parseEndOfLifeiOS(data: Array<{ cycle: string; releaseDate: string; latest: string }>): OSVersionInfo {
  if (!data.length) throw new Error('No iOS versions found from endoflife.date');
  return { platform: 'iOS', version: data[0].latest, releaseDate: data[0].releaseDate };
}

const RELEASES_FEED = 'https://developer.apple.com/news/releases/rss/releases.rss';

async function fetchStableFromASLS(): Promise<OSVersionInfo> {
  return parseAppleAssetCatalog(JSON.parse(await httpsGet('https://gdmf.apple.com/v2/pmv')) as PMVResponse);
}

async function fetchStableFromEndOfLife(): Promise<OSVersionInfo> {
  return parseEndOfLifeiOS(await fetchJson<Array<{ cycle: string; releaseDate: string; latest: string }>>('https://endoflife.date/api/ios.json', {}, NETWORK_TIMEOUT_MS, status => `endoflife.date iOS request failed: ${status}`));
}

/** Where iOS versions come from, replaceable in tests */
export interface iOSSources {
  asls: () => Promise<OSVersionInfo>;
  releaseFeed: () => Promise<{ items: ReleaseFeedItem[] }>;
  endOfLife: () => Promise<OSVersionInfo>;
}

const IOS_SOURCES: iOSSources = {
  asls: fetchStableFromASLS,
  releaseFeed: () => fetchFeed(RELEASES_FEED) as Promise<RssParser.Output<Record<string, unknown>>>,
  endOfLife: fetchStableFromEndOfLife,
};

/**
 * Stable from Apple's update catalog, else the release feed, else endoflife.date; the beta from the release
 * feed. Fails only when neither a stable nor a beta could be found.
 */
export async function fetchiOSVersions(sources: Partial<iOSSources> = {}): Promise<OSVersionInfo[]> {
  const { asls, releaseFeed: downloadFeed, endOfLife } = { ...IOS_SOURCES, ...sources };
  const results: OSVersionInfo[] = [];
  // The release feed serves both the stable fallback and the beta; download it at most once
  let releases: Promise<{ items: ReleaseFeedItem[] }> | undefined;
  const releaseFeed = () => (releases ??= downloadFeed());

  // Fetch stable version
  let stable: OSVersionInfo | null = null;
  try {
    stable = await asls();
  } catch (err) {
    console.warn(`[iOS] ASLS failed (${(err as Error).message}), trying RSS fallback...`);
    try {
      stable = parseStableReleaseFeed((await releaseFeed()).items);
    } catch (rssErr) {
      console.warn(`[iOS] RSS stable failed (${(rssErr as Error).message}), trying endoflife.date...`);
      try {
        stable = await endOfLife();
      } catch (eolErr) {
        console.warn(`[iOS] All stable sources failed (${(eolErr as Error).message})`);
      }
    }
  }

  // The catalog's PostingDate moves when Apple re-posts an entry (adding a build for a new model), so the
  // release feed's post for this exact version says when it really came out, when it has one
  if (stable) {
    const posted = await releaseFeed().then(feed => releaseDateIn(feed.items, stable!), () => undefined);
    if (posted) stable = { ...stable, releaseDate: posted };
    results.push(stable);
  }

  // Fetch beta version from RSS (left out once that version has shipped: "27.2 RC" after iOS 27.2)
  try {
    const beta = parseBetaReleaseFeed((await releaseFeed()).items);
    if (beta && !iOSBetaShipped(beta, stable)) {
      results.push(beta);
    }
  } catch (err) {
    console.warn(`[iOS] Beta RSS failed (${(err as Error).message})`);
  }

  if (results.length === 0) {
    throw new Error('Failed to fetch any iOS version info');
  }

  return results;
}
