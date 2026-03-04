import https from 'node:https';
import RssParser from 'rss-parser';
import type { OSVersionInfo } from '../types.js';

function httpsGet(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    https.get(url, { rejectUnauthorized: false }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks).toString()));
      res.on('error', reject);
    }).on('error', reject);
  });
}

interface AssetSet {
  ProductVersion: string;
  Build: string;
  PostingDate: string;
  SupportedDevices?: string[];
}

interface PMVResponse {
  PublicAssetSets: {
    iOS?: AssetSet[];
  };
  AssetSets: {
    iOS?: AssetSet[];
  };
}

async function fetchStableFromASLS(): Promise<OSVersionInfo> {
  const body = await httpsGet('https://gdmf.apple.com/v2/pmv');
  const data = JSON.parse(body) as PMVResponse;
  const assets = data.PublicAssetSets?.iOS ?? data.AssetSets?.iOS;

  if (!assets || assets.length === 0) {
    throw new Error('No iOS versions found in ASLS response');
  }

  const iphoneAssets = assets.filter(a =>
    a.SupportedDevices?.some(d => d.startsWith('iPhone'))
  );

  const candidates = iphoneAssets.length > 0 ? iphoneAssets : assets;

  const latest = candidates.sort((a, b) => {
    const va = a.ProductVersion.split('.').map(Number);
    const vb = b.ProductVersion.split('.').map(Number);
    for (let i = 0; i < Math.max(va.length, vb.length); i++) {
      const diff = (vb[i] ?? 0) - (va[i] ?? 0);
      if (diff !== 0) return diff;
    }
    return 0;
  })[0];

  return {
    platform: 'iOS',
    version: latest.ProductVersion,
    build: latest.Build,
    releaseDate: latest.PostingDate,
    supportedDevices: latest.SupportedDevices,
  };
}

async function fetchStableFromRSS(parser: RssParser): Promise<OSVersionInfo> {
  const feed = await parser.parseURL('https://developer.apple.com/news/releases/rss/releases.rss');

  const iosRelease = feed.items.find(item => {
    const title = item.title?.toLowerCase() ?? '';
    return title.startsWith('ios') && !title.includes('beta') && !title.includes('rc');
  });

  if (!iosRelease) {
    throw new Error('No iOS stable release found in RSS feed');
  }

  const titleMatch = iosRelease.title?.match(/iOS\s+([\d.]+)\s*(?:\((\w+)\))?/i);
  const version = titleMatch?.[1] ?? 'unknown';
  const build = titleMatch?.[2];

  const releaseDate = iosRelease.pubDate
    ? new Date(iosRelease.pubDate).toISOString().slice(0, 10)
    : 'unknown';

  return {
    platform: 'iOS',
    version,
    build,
    releaseDate,
  };
}

async function fetchStableFromEndOfLife(): Promise<OSVersionInfo> {
  const res = await fetch('https://endoflife.date/api/ios.json');
  if (!res.ok) {
    throw new Error(`endoflife.date iOS request failed: ${res.status}`);
  }

  const data = await res.json() as Array<{
    cycle: string;
    releaseDate: string;
    latest: string;
  }>;

  if (!data.length) {
    throw new Error('No iOS versions found from endoflife.date');
  }

  const latest = data[0];
  return {
    platform: 'iOS',
    version: latest.latest,
    releaseDate: latest.releaseDate,
  };
}

async function fetchBetaFromRSS(parser: RssParser): Promise<OSVersionInfo | null> {
  const feed = await parser.parseURL('https://developer.apple.com/news/releases/rss/releases.rss');

  const betaRelease = feed.items.find(item => {
    const title = item.title?.toLowerCase() ?? '';
    return title.startsWith('ios') && title.includes('beta');
  });

  if (!betaRelease) {
    return null;
  }

  // Match patterns like "iOS 26.4 beta 3 (23E5223f)"
  const titleMatch = betaRelease.title?.match(/iOS\s+([\d.]+\s+beta\s*\d*)\s*(?:\((\w+)\))?/i);
  const version = titleMatch?.[1]?.trim() ?? 'unknown';
  const build = titleMatch?.[2];

  const releaseDate = betaRelease.pubDate
    ? new Date(betaRelease.pubDate).toISOString().slice(0, 10)
    : 'unknown';

  return {
    platform: 'iOS',
    version,
    build,
    releaseDate,
    isBeta: true,
  };
}

export async function fetchiOSVersions(): Promise<OSVersionInfo[]> {
  const parser = new RssParser();
  const results: OSVersionInfo[] = [];

  // Fetch stable version
  let stable: OSVersionInfo | null = null;
  try {
    stable = await fetchStableFromASLS();
  } catch (err) {
    console.warn(`[iOS] ASLS failed (${(err as Error).message}), trying RSS fallback...`);
    try {
      stable = await fetchStableFromRSS(parser);
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
    const beta = await fetchBetaFromRSS(parser);
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
