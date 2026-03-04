import { fetchiOSVersions } from './fetchers/ios.js';
import { fetchAndroidVersions } from './fetchers/android.js';
import type { OSVersionInfo } from './types.js';

export interface AllVersions {
  ios: OSVersionInfo[];
  android: OSVersionInfo[];
}

export async function fetchAllVersions(): Promise<AllVersions> {
  const results = await Promise.allSettled([
    fetchiOSVersions(),
    fetchAndroidVersions(),
  ]);

  const ios = results[0].status === 'fulfilled' ? results[0].value : [];
  const android = results[1].status === 'fulfilled' ? results[1].value : [];

  return { ios, android };
}
