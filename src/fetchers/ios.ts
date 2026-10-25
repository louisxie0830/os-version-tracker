import type https from 'node:https';
import tls from 'node:tls';
import RssParser from 'rss-parser';
import type { OSVersionInfo } from '../types.js';
import { APPLE_ROOT_CA } from './apple-root-ca.js';
import { describe, fetchJson, NETWORK_TIMEOUT_MS, USER_AGENT } from '../net.js';
import { fetchFeed } from './feed.js';
import { compareVersions } from './ios-toolchain.js';
import { boundedGet, isTransient } from '../https-get.js';


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

/** Newest iPhone build from Apple's software update catalog (falls back to all assets when none list an iPhone) */
export function parseAppleAssetCatalog(data: PMVResponse): OSVersionInfo {
  const assets = data.PublicAssetSets?.iOS ?? data.AssetSets?.iOS;
  if (!assets || assets.length === 0) {
    throw new Error('No iOS versions found in ASLS response');
  }
  const iphoneAssets = assets.filter(a => a.SupportedDevices?.some(d => d.startsWith('iPhone')));
  const candidates = iphoneAssets.length > 0 ? iphoneAssets : assets;
  const latest = [...candidates].sort((a, b) => compareVersions(b.ProductVersion, a.ProductVersion))[0];
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

const feedDate = (item: ReleaseFeedItem) => (item.pubDate ? new Date(item.pubDate).toISOString().slice(0, 10) : 'unknown');

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
  const betaRelease = items.find(item => /^iOS\s/i.test(item.title ?? '') && /\bbeta\b|\bRC\b/i.test(item.title ?? ''));
  if (!betaRelease) return null;
  const m = betaRelease.title?.match(/iOS\s+([\d.]+\s+(?:beta|RC)\s*\d*)\s*(?:\((\w+)\))?/i);
  return {
    platform: 'iOS',
    version: m?.[1]?.trim() ?? 'unknown',
    build: m?.[2],
    releaseDate: feedDate(betaRelease),
    isBeta: true,
  };
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

export async function fetchiOSVersions(): Promise<OSVersionInfo[]> {
  const results: OSVersionInfo[] = [];
  // The release feed serves both the stable fallback and the beta; download it at most once
  let releases: Promise<RssParser.Output<Record<string, unknown>>> | undefined;
  const releaseFeed = () => (releases ??= fetchFeed(RELEASES_FEED));

  // Fetch stable version
  let stable: OSVersionInfo | null = null;
  try {
    stable = await fetchStableFromASLS();
  } catch (err) {
    console.warn(`[iOS] ASLS failed (${(err as Error).message}), trying RSS fallback...`);
    try {
      stable = parseStableReleaseFeed((await releaseFeed()).items);
    } catch (rssErr) {
      console.warn(`[iOS] RSS stable failed (${(rssErr as Error).message}), trying endoflife.date...`);
      try {
        stable = await fetchStableFromEndOfLife();
      } catch (eolErr) {
        console.warn(`[iOS] All stable sources failed (${(eolErr as Error).message})`);
      }
    }
  }

  if (stable) {
    results.push(stable);
  }

  // Fetch beta version from RSS
  try {
    const beta = parseBetaReleaseFeed((await releaseFeed()).items);
    if (beta) {
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
