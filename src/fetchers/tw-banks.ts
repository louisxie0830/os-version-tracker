import { fetchText, NETWORK_TIMEOUT_MS as TIMEOUT_MS } from '../net.js';
/**
 * Minimum iOS / Android versions required by the official mobile banking apps of major Taiwan banks.
 *
 * - iOS: one batched iTunes Lookup API call (`minimumOsVersion`).
 * - Android: the public Google Play details page. Play does not render "Requires Android x" as text in
 *   the HTML; it lives in the page's `AF_initDataCallback` data (the `ds:5` block). Inside that block the
 *   app array (`data[1][2]`) holds `[140] = [[["<versionName>"]], [[[<targetSdk>]], [[[<minSdk>, "<minAndroid>"]]]]]`
 *   and `[145] = [["<localized date>", [<epochSeconds>, <nanos>]]]` for "last updated".
 *   The values are language-independent (same for hl=en and hl=zh_TW).
 */

/** personal = a retail banking app for individuals (usually one per bank; Taishin also has its Richart brand) */
export type BankAppKind = 'personal' | 'business' | 'merchant' | 'auth';

export interface TaiwanBankAppEntry {
  bank: string;
  app: string;
  /** Defaults to 'personal' */
  kind?: BankAppKind;
  appStoreId?: number;
  playPackage?: string;
}

export interface TaiwanBankApp {
  bank: string;
  app: string;
  kind: BankAppKind;
  ios?: { minOs: string; version?: string; updated?: string; url: string };
  /** targetSdk: the API level the build targets (Google Play requires a recent one for updates) */
  android?: { minOs: string; version?: string; updated?: string; targetSdk?: number; url: string };
}

/**
 * Each entry was verified (2026-10-11): App Store sellerName is the bank, and the Play page returns 200
 * with the bank as developer and the matching title.
 * Where a bank has launched a successor app (永豐 / 遠東 / 高雄 / 彰化), the successor is tracked.
 * Besides each bank's main personal app, some banks also list their business / merchant / authenticator apps
 * (verified the same way, 2026-10-11).
 */
export const TW_BANK_APPS: readonly TaiwanBankAppEntry[] = [
  { bank: '臺灣銀行', app: '臺銀行動+', appStoreId: 1629581135, playPackage: 'com.bot.ibank' },
  { bank: '土地銀行', app: '土銀行動銀行', appStoreId: 1301131992, playPackage: 'com.landbank.newrelease.android' },
  { bank: '合作金庫', app: '合作金庫銀行', appStoreId: 432274183, playPackage: 'com.mitake.android.bk.tcb' },
  { bank: '第一銀行', app: '第e行動', appStoreId: 408289025, playPackage: 'com.willmobile.mobilebank.fcb' },
  { bank: '華南銀行', app: '華南銀行+', appStoreId: 1616828713, playPackage: 'tw.com.hncb.nmbank' },
  { bank: '彰化銀行', app: '彰銀行動銀行 ChaiBo', appStoreId: 6739481946, playPackage: 'com.chb.mobile.pmb' },
  { bank: '兆豐銀行', app: '兆豐銀行', appStoreId: 1461448957, playPackage: 'tw.com.megabank.mobilebank.pre' },
  { bank: '台北富邦', app: 'Fubon+ 台北富邦行動銀行', appStoreId: 6479990131, playPackage: 'com.fubon.aibank' },
  { bank: '國泰世華', app: 'CUBE', appStoreId: 373500505, playPackage: 'com.cathaybk.mymobibank.android' },
  { bank: '中國信託', app: '中國信託行動銀行', appStoreId: 417698185, playPackage: 'com.chinatrust.mobilebank' },
  { bank: '玉山銀行', app: '玉山行動銀行', appStoreId: 405033836, playPackage: 'com.esunbank' },
  { bank: '台新銀行', app: '台新行動銀行', appStoreId: 388917170, playPackage: 'tw.com.taishinbank.mobile' },
  // Taishin's digital-account brand: a separate personal banking app
  { bank: '台新銀行', app: 'Richart', appStoreId: 1079733142, playPackage: 'tw.com.taishinbank.richart' },
  { bank: '永豐銀行', app: '永豐銀行行動銀行（新版）', appStoreId: 6587560188, playPackage: 'com.sinopac.newmobilebank' },
  { bank: '元大銀行', app: '元大行動銀行', appStoreId: 6499507336, playPackage: 'com.yuantabank.bankinginyour.superapp.personal' },
  { bank: '元大銀行', app: '元大銀行商務', kind: 'business', appStoreId: 6499507295, playPackage: 'com.yuantabank.bankinginyour.superapp.corporate' },
  { bank: '元大銀行', app: '元大銀行鑽金收款通', kind: 'merchant', appStoreId: 1116007716, playPackage: 'com.yuantabank.o2o.ezpaymentmobile' },
  { bank: '元大銀行', app: '元大 Fast-ID', kind: 'auth', appStoreId: 6450417654, playPackage: 'com.yuantabank.fido.android' },
  { bank: '凱基銀行', app: '凱基銀行', appStoreId: 1623779989, playPackage: 'com.kgib.maib.prod' },
  { bank: '新光銀行', app: '新光銀行', appStoreId: 495872725, playPackage: 'com.willmobile.mobilebank.skbbank' },
  { bank: '上海商銀', app: '掌上銀', appStoreId: 1549778747, playPackage: 'tw.com.scsb.android.mbank' },
  { bank: '王道銀行', app: '王道銀行 O-Bank', appStoreId: 1183668635, playPackage: 'com.obank.tw.eb' },
  { bank: '遠東商銀', app: '遠東商銀行動銀行 APP2.0', appStoreId: 6760087198, playPackage: 'com.feib.mobile.pmb' },
  { bank: '臺灣企銀', app: '臺企銀行動銀行', appStoreId: 1545901007, playPackage: 'com.tbb.mb.prod' },
  { bank: '高雄銀行', app: '高雄銀行', appStoreId: 6759698164, playPackage: 'tw.com.bok.bokmbapp' },
  { bank: 'LINE Bank', app: 'LINE Bank Taiwan', appStoreId: 1527512597, playPackage: 'com.linebank.tw' },
  { bank: '將來銀行', app: 'NEXT BANK', appStoreId: 1528472238, playPackage: 'com.nextbank.ncbportal' },
  { bank: '樂天國際商銀', app: '樂天國際銀行', appStoreId: 1519921465, playPackage: 'com.ricb.ebank' },
];

// Google Play can throttle bursts even below the shared per-origin network limit.
const PLAY_CONCURRENCY = 2;

export const itunesLookupUrl = (ids: number[]): string =>
  `https://itunes.apple.com/lookup?id=${ids.join(',')}&country=tw`;
export const playDetailsUrl = (pkg: string): string =>
  `https://play.google.com/store/apps/details?id=${encodeURIComponent(pkg)}&hl=zh_TW&gl=TW`;

/** Calendar date in Taiwan (UTC+8, no DST) as YYYY-MM-DD */
function taipeiDate(ms: number): string | undefined {
  if (!Number.isFinite(ms)) return undefined;
  return new Date(ms + 8 * 3600_000).toISOString().slice(0, 10);
}

export interface ItunesAppInfo {
  trackId: number;
  trackName: string;
  minOs: string;
  version?: string;
  updated?: string;
  url: string;
}

/** Parses an iTunes Lookup API response into a map keyed by trackId. Entries without minimumOsVersion are skipped. */
export function parseItunesLookup(json: string): Map<number, ItunesAppInfo> {
  const out = new Map<number, ItunesAppInfo>();
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    return out;
  }
  const results = (data as { results?: unknown })?.results;
  if (!Array.isArray(results)) return out;
  for (const r of results as Record<string, unknown>[]) {
    if (typeof r?.trackId !== 'number' || typeof r.minimumOsVersion !== 'string') continue;
    const released = typeof r.currentVersionReleaseDate === 'string' ? Date.parse(r.currentVersionReleaseDate) : NaN;
    out.set(r.trackId, {
      trackId: r.trackId,
      trackName: typeof r.trackName === 'string' ? r.trackName : '',
      minOs: r.minimumOsVersion,
      version: typeof r.version === 'string' ? r.version : undefined,
      updated: taipeiDate(released),
      url:
        typeof r.trackViewUrl === 'string'
          ? r.trackViewUrl.replace(/\?.*$/, '')
          : `https://apps.apple.com/tw/app/id${r.trackId}`,
    });
  }
  return out;
}

export interface PlayAppInfo {
  /** e.g. "8.0", "9", or a "varies with device" label as shown by Play */
  minOs: string;
  version?: string;
  updated?: string;
  targetSdk?: number;
}

const VARIES = /^(Varies with device|依裝置而異|因裝置而異)$/;

function* initDataBlocks(html: string): Generator<unknown> {
  for (const m of html.matchAll(/AF_initDataCallback\(\{key:\s*'ds:\d+',[^]*?data:([^]*?), sideChannel:\s*\{\}\}\);/g)) {
    try {
      yield JSON.parse(m[1]);
    } catch {
      /* not JSON — skip */
    }
  }
}

/**
 * Play sometimes sends a long array in sparse form: the dense head, then one object keyed by field number
 * (index + 1) for the rest, e.g. `[…104 items…, {"141": [...], "146": [...]}]`. Back to a plain array.
 */
export function expandSparse(arr: unknown[]): unknown[] {
  const last = arr.at(-1);
  if (!last || typeof last !== 'object' || Array.isArray(last)) return arr;
  const out = arr.slice(0, -1);
  for (const [k, v] of Object.entries(last)) {
    const field = Number(k);
    if (Number.isInteger(field) && field > 0) out[field - 1] = v;
  }
  return out;
}

/** Finds the app details array (`data[1][2]`) in the page's AF_initDataCallback blocks */
function findAppDetails(html: string): unknown[] | undefined {
  for (const d of initDataBlocks(html)) {
    const raw = (d as unknown[][][] | null)?.[1]?.[2];
    const app = Array.isArray(raw) ? expandSparse(raw) : undefined;
    if (app && app.length > 145 && Array.isArray(app[140])) return app;
  }
  return undefined;
}

function at(x: unknown, ...path: number[]): unknown {
  let cur = x;
  for (const i of path) {
    if (!Array.isArray(cur)) return undefined;
    cur = cur[i];
  }
  return cur;
}

/** Full Play details parse: min Android, versionName and last-updated date (Taipei calendar day). */
export function parsePlayDetails(html: string): PlayAppInfo | undefined {
  const app = findAppDetails(html);
  let minOs: string | undefined;
  let version: string | undefined;
  let updated: string | undefined;
  let targetSdk: number | undefined;

  if (app) {
    const block = app[140];
    const min = at(block, 1, 1, 0, 0, 1);
    if (typeof min === 'string' && min.trim()) minOs = min.trim();
    else {
      // Some apps ship per-device builds; Play then shows a label instead of a version
      const label = JSON.stringify(block).match(/"(Varies with device|依裝置而異|因裝置而異)"/);
      if (label) minOs = label[1];
    }
    const v = at(block, 0, 0, 0);
    if (typeof v === 'string' && v.trim() && !VARIES.test(v)) version = v.trim();
    const target = at(block, 1, 0, 0, 0);
    if (typeof target === 'number' && target > 0) targetSdk = target;
    const secs = at(app, 145, 0, 1, 0);
    if (typeof secs === 'number') updated = taipeiDate(secs * 1000);
  }

  if (!minOs) {
    // Fallback: structure-only regex for `[[["ver"]],[[[target]],[[[minSdk,"x.y"]]]]]` anywhere in the page
    const m = html.match(/\[\[\["([^"\]]{1,40})"\]\],\[\[\[(\d{1,3})\]\],\[\[\[\d{1,3},"(\d{1,2}(?:\.\d{1,2})?(?:W)?)"\]\]\]\]\]/);
    if (m) {
      minOs = m[3];
      version ??= m[1];
      targetSdk ??= Number(m[2]);
    }
  }
  if (!minOs) {
    // Rendered text fallback (if Play ever renders it server-side again)
    const m = html.match(/(?:Requires Android|需要 Android)[^0-9<]{0,20}(\d{1,2}(?:\.\d)?)\s*(?:and up|以上)/);
    if (m) minOs = m[1];
  }
  return minOs ? { minOs, version, updated, ...(targetSdk ? { targetSdk } : {}) } : undefined;
}

/** Minimum Android version shown on a Google Play details page, e.g. "8.0" — or undefined if not found. */
export function parsePlayMinAndroid(html: string): string | undefined {
  return parsePlayDetails(html)?.minOs;
}

// The lookup URLs carry app ids in their query string: errors name only host and path
const storePage = (url: string, lang: string) => fetchText(url, { headers: { 'Accept-Language': lang } }, TIMEOUT_MS, (status, where) => `${where} failed: ${status}`);

async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

export async function fetchTaiwanBankApps(apps: readonly TaiwanBankAppEntry[] = TW_BANK_APPS): Promise<TaiwanBankApp[]> {
  const ids = apps.flatMap(a => (a.appStoreId ? [a.appStoreId] : []));

  const iosPromise: Promise<Map<number, ItunesAppInfo> | Error> = ids.length
    ? storePage(itunesLookupUrl(ids), 'zh-TW,zh;q=0.9,en;q=0.8')
        .then(parseItunesLookup)
        .catch((e: unknown) => (e instanceof Error ? e : new Error(String(e))))
    : Promise.resolve(new Map());

  const androidPromise = mapLimit(apps, PLAY_CONCURRENCY, async a => {
    if (!a.playPackage) return undefined;
    const url = playDetailsUrl(a.playPackage);
    // A transient throttle or localisation-specific Play HTML must not silently drop an app.
    // The second official Play URL is only fetched if the first request fails or cannot parse.
    // Keep the public link pointing at the Taiwan listing regardless of the fallback locale.
    const candidates = [
      { url, lang: 'zh-TW,zh;q=0.9,en;q=0.8' },
      { url: `https://play.google.com/store/apps/details?id=${encodeURIComponent(a.playPackage)}&hl=en&gl=US`, lang: 'en-US,en;q=0.9' },
    ];
    for (const candidate of candidates) {
      try {
        const info = parsePlayDetails(await storePage(candidate.url, candidate.lang));
        if (info) return { ...info, url };
      } catch {
        // Try the other official localisation, then leave the missing field visible to quality alerts.
      }
    }
    return undefined;
  });

  const [ios, android] = await Promise.all([iosPromise, androidPromise]);
  const iosOk = !(ios instanceof Error) && ios.size > 0;
  const androidOk = android.some(Boolean);
  if (!iosOk && !androidOk) {
    throw new Error(
      `Taiwan bank apps: both platforms failed${ios instanceof Error ? ` (iOS: ${ios.message})` : ''}`,
    );
  }

  return apps.map((a, i) => {
    const it = !(ios instanceof Error) && a.appStoreId ? ios.get(a.appStoreId) : undefined;
    return {
      bank: a.bank,
      app: a.app,
      kind: a.kind ?? 'personal',
      ios: it && { minOs: it.minOs, version: it.version, updated: it.updated, url: it.url },
      android: android[i],
    };
  });
}
