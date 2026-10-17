import { androidApiLevel, newestPossibleAndroidMajor } from '../android-api.js';
import { compareVersions } from './ios-toolchain.js';
import { fetchText, SLOW_NETWORK_TIMEOUT_MS } from '../net.js';

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

/** Monthly share per major version over the last year, oldest month first */
export interface ShareTrend {
  months: string[]; // YYYY-MM
  series: Array<{ version: string; shares: number[] }>;
  url: string;
}

export interface OsShare {
  month: string; // YYYY-MM
  ios: Partial<Record<Region, PlatformShare>>;
  android: Partial<Record<Region, PlatformShare>>;
  /** Absent in older snapshots, or when StatCounter's range export failed */
  trend?: Record<Platform, Partial<Record<Region, ShareTrend>>>;
  /** Phone brand share over the last year (series named by brand, largest first); absent when unavailable */
  vendor?: Partial<Record<Region, ShareTrend>>;
}

const REGION_NAME: Record<Region, string> = { TW: 'Taiwan', ww: 'Worldwide' };
type Stat = Platform | 'vendor';
const STAT: Record<Stat, { hidden: string; name: string; page: string }> = {
  ios: { hidden: 'ios_version', name: 'iOS Version', page: 'ios-version-market-share' },
  android: { hidden: 'android_version', name: 'Android Version', page: 'android-version-market-share' },
  // Brands are a phone statistic (StatCounter has no tablet split for them)
  vendor: { hidden: 'mobile_vendor', name: 'Mobile Vendor', page: 'vendor-market-share' },
};

function csvUrl(platform: Stat, region: Region, yyyymm: string, fromYyyymm = yyyymm): string {
  const ym = `${yyyymm.slice(0, 4)}-${yyyymm.slice(4)}`;
  const fromYm = `${fromYyyymm.slice(0, 4)}-${fromYyyymm.slice(4)}`;
  const params = new URLSearchParams({
    ...(platform === 'vendor'
      ? { device: 'Mobile', device_hidden: 'mobile' }
      : { device: 'Mobile & Tablet', device_hidden: 'mobile+tablet', 'multi-device': 'true' }),
    statType_hidden: STAT[platform].hidden,
    region_hidden: region,
    granularity: 'monthly',
    statType: STAT[platform].name,
    region: REGION_NAME[region],
    fromInt: fromYyyymm,
    toInt: yyyymm,
    fromMonthYear: fromYm,
    toMonthYear: ym,
    csv: '1',
  });
  return `https://gs.statcounter.com/chart.php?${params}`;
}

function pageUrl(platform: Stat, region: Region): string {
  return `${STATCOUNTER_URL}${STAT[platform].page}/${platform === 'vendor' ? 'mobile' : 'mobile-tablet'}/${region === 'TW' ? 'taiwan' : 'worldwide'}`;
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

/** Major version for a StatCounter label, folding Android's nonsense labels (e.g. "26") into 其他 */
function majorBucket(platform: Platform, label: string): string {
  const major = majorOf(platform, label) ?? '其他';
  return platform === 'android' && Number(major) > newestPossibleAndroidMajor() ? '其他' : major;
}

/**
 * Parses a multi-month StatCounter export ("Date","iOS 18.6",… then one row per month) into share per
 * major version per month. Months with no data at all (not published yet) are dropped.
 */
export function parseShareHistoryCsv(platform: Platform, csv: string, url: string): ShareTrend {
  const lines = csv.trim().split(/\r?\n/);
  const header = (lines[0] ?? '').split(',').map(h => h.replace(/^"|"$/g, ''));
  const buckets = header.slice(1).map(label => majorBucket(platform, label));
  const months: string[] = [];
  const byMajor = new Map<string, number[]>();
  for (const line of lines.slice(1)) {
    const cells = line.split(',');
    const month = cells[0]?.replace(/"/g, '');
    if (!/^\d{4}-\d{2}$/.test(month ?? '')) continue;
    const values = cells.slice(1).map(Number);
    if (!values.some(v => v > 0)) continue;
    const index = months.push(month) - 1;
    values.forEach((v, i) => {
      if (!Number.isFinite(v) || buckets[i] === undefined) return;
      const series = byMajor.get(buckets[i]) ?? [];
      series[index] = (series[index] ?? 0) + v;
      byMajor.set(buckets[i], series);
    });
  }
  if (months.length < 2) throw new Error('StatCounter history has fewer than two months');
  const series = [...byMajor]
    .map(([version, shares]) => ({ version, shares: months.map((_, i) => round1(shares[i] ?? 0)) }))
    .sort((a, b) => (a.version === '其他' ? 1 : b.version === '其他' ? -1 : compareVersions(b.version, a.version)));
  return { months, series, url };
}

/**
 * Parses a multi-month brand export ("Date","Apple","Samsung",…): one series per brand, largest in the
 * latest month first; "Unknown" and "Other" fold into 其他 (kept last).
 */
export function parseVendorHistoryCsv(csv: string, url: string): ShareTrend {
  const lines = csv.trim().split(/\r?\n/);
  const header = (lines[0] ?? '').split(',').map(h => h.replace(/^"|"$/g, '').trim());
  const names = header.slice(1).map(name => (/^(unknown|other)$/i.test(name) ? '其他' : name));
  const months: string[] = [];
  const byName = new Map<string, number[]>();
  for (const line of lines.slice(1)) {
    const cells = line.split(',');
    const month = cells[0]?.replace(/"/g, '');
    if (!/^\d{4}-\d{2}$/.test(month ?? '')) continue;
    const values = cells.slice(1).map(Number);
    if (!values.some(v => v > 0)) continue;
    const index = months.push(month) - 1;
    values.forEach((v, i) => {
      if (!Number.isFinite(v) || !names[i]) return;
      const series = byName.get(names[i]) ?? [];
      series[index] = (series[index] ?? 0) + v;
      byName.set(names[i], series);
    });
  }
  if (months.length < 2) throw new Error('StatCounter brand history has fewer than two months');
  const series = [...byName]
    .map(([version, shares]) => ({ version, shares: months.map((_, i) => round1(shares[i] ?? 0)) }))
    .sort((a, b) => (a.version === '其他' ? 1 : b.version === '其他' ? -1 : (b.shares.at(-1) ?? 0) - (a.shares.at(-1) ?? 0)));
  return { months, series, url };
}

export function summarize(platform: Platform, shares: VersionShare[], url: string): PlatformShare {
  const majors = new Map<string, number>();
  for (const s of shares) {
    // StatCounter occasionally reports nonsense Android labels (e.g. "26"); keep only real Android versions
    const major = majorBucket(platform, s.version);
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
      ...(platform === 'android' && androidApiLevel(m.version) ? { api: androidApiLevel(m.version) } : {}),
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
  return parseShareCsv(await fetchText(csvUrl(platform, region, yyyymm), {}, SLOW_NETWORK_TIMEOUT_MS, status => `StatCounter ${platform}/${region} failed: ${status}`));
}

/** The previous calendar month is the latest complete one */
function previousMonths(now: Date, count: number): string[] {
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1 - i, 1));
    return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  });
}

async function fetchTrend(platform: Stat, region: Region, now: Date): Promise<ShareTrend> {
  // Twelve months up to the previous one; an unpublished latest month is dropped by the parser
  const [to] = previousMonths(now, 1);
  const from = previousMonths(now, 12).at(-1)!;
  const csv = await fetchText(csvUrl(platform, region, to, from), {}, SLOW_NETWORK_TIMEOUT_MS, status => `StatCounter history ${platform}/${region} failed: ${status}`);
  return platform === 'vendor' ? parseVendorHistoryCsv(csv, pageUrl(platform, region)) : parseShareHistoryCsv(platform, csv, pageUrl(platform, region));
}

/** Brand share is extra too: a failed export only leaves it out */
async function fetchVendorTrends(now: Date): Promise<OsShare['vendor']> {
  const regions = ['TW', 'ww'] as const;
  const results = await Promise.allSettled(regions.map(region => fetchTrend('vendor', region, now)));
  const vendor: NonNullable<OsShare['vendor']> = {};
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') vendor[regions[i]] = r.value;
    else console.warn(`[os-share] vendor/${regions[i]} history failed (${(r.reason as Error).message})`);
  });
  return Object.keys(vendor).length ? vendor : undefined;
}

/** The trend is extra: a failed range export only leaves it out */
async function fetchTrends(now: Date): Promise<OsShare['trend']> {
  const jobs = (['ios', 'android'] as const).flatMap(platform => (['TW', 'ww'] as const).map(region => ({ platform, region })));
  const results = await Promise.allSettled(jobs.map(j => fetchTrend(j.platform, j.region, now)));
  const trend: NonNullable<OsShare['trend']> = { ios: {}, android: {} };
  results.forEach((r, i) => {
    const { platform, region } = jobs[i];
    if (r.status === 'fulfilled') trend[platform][region] = r.value;
    else console.warn(`[os-share] ${platform}/${region} history failed (${(r.reason as Error).message})`);
  });
  return Object.keys(trend.ios).length || Object.keys(trend.android).length ? trend : undefined;
}

export async function fetchOsShare(now = new Date()): Promise<OsShare> {
  const [share, trend, vendor] = await Promise.all([fetchLatestShare(now), fetchTrends(now), fetchVendorTrends(now)]);
  return { ...share, ...(trend ? { trend } : {}), ...(vendor ? { vendor } : {}) };
}

async function fetchLatestShare(now: Date): Promise<OsShare> {
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
