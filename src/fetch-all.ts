import { fetchiOSVersions } from './fetchers/ios.js';
import { fetchAndroidVersions } from './fetchers/android.js';
import { fetchAppleSubmissionDeadline } from './fetchers/apple-deadline.js';
import { fetchGooglePlayDeadline } from './fetchers/google-deadline.js';
import type { OSVersionInfo, SubmissionDeadline } from './types.js';

export interface AllVersions {
  ios: OSVersionInfo[];
  android: OSVersionInfo[];
  appleDeadline: SubmissionDeadline | null;
  googleDeadline: SubmissionDeadline | null;
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
    fetchAppleSubmissionDeadline(),
    fetchGooglePlayDeadline(),
  ]);

  const ios = results[0].status === 'fulfilled' ? results[0].value : [];
  const android = results[1].status === 'fulfilled' ? results[1].value : [];
  const appleDeadline = results[2].status === 'fulfilled' ? results[2].value : null;
  const googleDeadline = results[3].status === 'fulfilled' ? results[3].value : null;

  cache = { ios, android, appleDeadline, googleDeadline, cachedAt: new Date().toISOString() };
  cacheTime = now;

  return cache;
}
