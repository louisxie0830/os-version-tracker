import { fetchiOSVersions } from './fetchers/ios.js';
import { fetchAndroidVersions } from './fetchers/android.js';
import type { OSVersionInfo } from './types.js';

export interface AllVersions {
  ios: OSVersionInfo[];
  android: OSVersionInfo[];
  cachedAt: string;
}

const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

let cache: AllVersions | null = null;
let cacheTime = 0;

export async function fetchAllVersions(): Promise<AllVersions> {
  const now = Date.now();
  if (cache && now - cacheTime < CACHE_TTL_MS) {
    return cache;
  }

  const results = await Promise.allSettled([
    fetchiOSVersions(),
    fetchAndroidVersions(),
  ]);

  const ios = results[0].status === 'fulfilled' ? results[0].value : [];
  const android = results[1].status === 'fulfilled' ? results[1].value : [];

  cache = { ios, android, cachedAt: new Date().toISOString() };
  cacheTime = now;

  return cache;
}
