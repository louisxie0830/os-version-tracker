import { compareVersions } from './ios-toolchain.js';
import { SLOW_NETWORK_TIMEOUT_MS } from '../net.js';

/**
 * iOS / Android version market share from StatCounter Global Stats (CC BY-SA 3.0, attribution required).
 * Unlike Apple's official numbers (only "latest / previous / earlier"), these break down every version,
 * per region, which is what you need to choose a deployment target / minSdk for a Taiwanese audience.
 */

export const STATCOUNTER_URL = 'https://gs.statcounter.com/';

export type Region = 'TW' | 'ww';
export type Platform = 'ios' | 'android';

export interface VersionShare {
  version: string;
  share: number;
}

export interface Coverage {
  /** Minimum supported major version, e.g. "17" or "10" */
  min: string;
  /** API level for Android, e.g. 29 */
  api?: number;
  /** Percent of devices on this version or newer */
  covered: number;
}

export interface PlatformShare {
  byMajor: VersionShare[];
  topVersions: VersionShare[];
  coverage: Coverage[];
  url: string;
}

export interface OsShare {
  month: string; // YYYY-MM
  ios: Partial<Record<Region, PlatformShare>>;
  android: Partial<Record<Region, PlatformShare>>;
}

// Android version → API level (stable, published facts). 12L shares major 12; 8.1 is API 27 but grouped as 8.
const ANDROID_API: Record<string, number> = {
  '17': 37, '16': 36, '15': 35, '14': 34, '13': 33, '12': 31, '11': 30, '10': 29, '9': 28, '8': 26, '7': 24, '6': 23, '5': 21, '4': 19,
};

const REGION_NAME: Record<Region, string> = { TW: 'Taiwan', ww: 'Worldwide' };
const STAT: Record<Platform, { hidden: string; name: string; page: string }> = {
  ios: { hidden: 'ios_version', name: 'iOS Version', page: 'ios-version-market-share' },
  android: { hidden: 'android_version', name: 'Android Version', page: 'android-version-market-share' },
};

function csvUrl(platform: Platform, region: Region, yyyymm: string): string {
  const ym = `${yyyymm.slice(0, 4)}-${yyyymm.slice(4)}`;
  const params = new URLSearchParams({
    device: 'Mobile & Tablet',
    device_hidden: 'mobile+tablet',
    'multi-device': 'true',
    statType_hidden: STAT[platform].hidden,
    region_hidden: region,
    granularity: 'monthly',
    statType: STAT[platform].name,
    region: REGION_NAME[region],
    fromInt: yyyymm,
    toInt: yyyymm,
    fromMonthYear: ym,
    toMonthYear: ym,
    csv: '1',
  });
  return `https://gs.statcounter.com/chart.php?${params}`;
}

function pageUrl(platform: Platform, region: Region): string {
  return `${STATCOUNTER_URL}${STAT[platform].page}/mobile-tablet/${region === 'TW' ? 'taiwan' : 'worldwide'}`;
}

/** Parses StatCounter's two-column CSV: "label",share */
export function parseShareCsv(csv: string): VersionShare[] {
  const rows = csv.trim().split(/\r?\n/).slice(1);
  const shares = rows
    .map(line => line.match(/^"([^"]+)",\s*([\d.]+)$/))
    .filter((m): m is RegExpMatchArray => !!m)
    .map(m => ({ version: m[1], share: Number(m[2]) }))
    .filter(s => Number.isFinite(s.share));
  if (!shares.length) throw new Error('No version shares in StatCounter CSV');
  return shares;
}

/** "iOS 26.6" → "26"; "16.0" → "16"; "9.0 Pie" → "9"; "Other" → undefined */
export function majorOf(platform: Platform, label: string): string | undefined {
  const m = (platform === 'ios' ? label.replace(/^iOS\s+/i, '') : label).match(/^(\d+)/);
  return m?.[1];
}

const round1 = (n: number) => Math.round(n * 10) / 10;

export function summarize(platform: Platform, shares: VersionShare[], url: string): PlatformShare {
  const majors = new Map<string, number>();
  for (const s of shares) {
    let major = majorOf(platform, s.version) ?? '其他';
    // StatCounter occasionally reports nonsense Android labels (e.g. "26"); keep only real Android versions
    if (platform === 'android' && !(major in ANDROID_API) && Number(major) > Math.max(...Object.keys(ANDROID_API).map(Number))) major = '其他';
    majors.set(major, (majors.get(major) ?? 0) + s.share);
  }
  const byMajor = [...majors]
    .map(([version, share]) => ({ version, share: round1(share) }))
    .sort((a, b) => (a.version === '其他' ? 1 : b.version === '其他' ? -1 : compareVersions(b.version, a.version)));

  // Coverage is relative to devices whose version is known
  const known = byMajor.filter(m => m.version !== '其他');
  const total = known.reduce((sum, m) => sum + m.share, 0) || 1;
  let running = 0;
  const coverage = known.map(m => {
    running += m.share;
    return {
      min: m.version,
      ...(platform === 'android' && ANDROID_API[m.version] ? { api: ANDROID_API[m.version] } : {}),
      covered: round1((running / total) * 100),
    };
  });

  const topVersions = [...shares]
    .filter(s => s.version !== 'Other')
    .sort((a, b) => b.share - a.share)
    .slice(0, 8)
    .map(s => ({ version: platform === 'ios' ? s.version.replace(/^iOS\s+/i, '') : s.version.replace(/\.0(?=\s|$)/, ''), share: round1(s.share) }));

  return { byMajor, topVersions, coverage, url };
}

async function fetchCsv(platform: Platform, region: Region, yyyymm: string): Promise<VersionShare[]> {
  const res = await fetch(csvUrl(platform, region, yyyymm), {
    headers: { 'User-Agent': 'Mozilla/5.0 (os-version-tracker)' },
    signal: AbortSignal.timeout(SLOW_NETWORK_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`StatCounter ${platform}/${region} failed: ${res.status}`);
  return parseShareCsv(await res.text());
}

/** The previous calendar month is the latest complete one */
function previousMonths(now: Date, count: number): string[] {
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1 - i, 1));
    return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  });
}

export async function fetchOsShare(now = new Date()): Promise<OsShare> {
  for (const month of previousMonths(now, 2)) {
    const jobs = (['ios', 'android'] as const).flatMap(platform => (['TW', 'ww'] as const).map(region => ({ platform, region })));
    const results = await Promise.allSettled(jobs.map(j => fetchCsv(j.platform, j.region, month)));
    if (results.every(r => r.status === 'rejected')) continue; // month not published yet: try the one before

    const share: OsShare = { month: `${month.slice(0, 4)}-${month.slice(4)}`, ios: {}, android: {} };
    results.forEach((r, i) => {
      const { platform, region } = jobs[i];
      if (r.status === 'fulfilled') share[platform][region] = summarize(platform, r.value, pageUrl(platform, region));
      else console.warn(`[os-share] ${platform}/${region} failed (${(r.reason as Error).message})`);
    });
    return share;
  }
  throw new Error('StatCounter version share unavailable');
}
