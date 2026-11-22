import { safeUrl } from '../safe-url.js';
import { feedDay } from '../taipei-date.js';
import { fetchFeed } from './feed.js';
import { cleanText, fetchHtml } from './html-table.js';
import { parseAndroidBulletin, parseAndroidBulletinIndex } from './security.js';

/**
 * Security updates from the companies that ship Android phones, chips and the browser engine inside WebView,
 * each from its own site (first-hand):
 * - Chrome Releases: every desktop stable update lists its security fixes; Android WebView is built from the
 *   same Chromium code, and Google says there when an exploit is already in the wild.
 * - Pixel Update Bulletins (Google), Samsung's monthly Security Maintenance Release (the biggest Android
 *   brand in Taiwan), and MediaTek's chipset bulletins.
 * Qualcomm's bulletin page is drawn by script with no data in the HTML, so it isn't read.
 */

export type Vendor = 'Pixel' | 'Samsung' | 'MediaTek';

export interface VendorBulletin {
  vendor: Vendor;
  title: string;
  url: string;
  published: string; // YYYY-MM-DD (Samsung gives only the month: its first day)
  /** Pixel: the security patch level the update brings */
  patchLevel?: string;
  /** CVEs the bulletin lists; undefined when its page couldn't be read */
  cves?: number;
  /** CVEs rated Critical */
  critical?: number;
  /** CVEs the vendor says are exploited, or may be under limited, targeted exploitation */
  exploited: string[];
}

export interface ChromeStable {
  version: string;
  url: string;
  published: string;
  /** "This update includes N security fixes"; undefined when the post doesn't say */
  fixes?: number;
  critical: number;
  /** CVEs Google says have an exploit in the wild */
  exploited: string[];
}

const cveIds = (text: string) => [...new Set(text.match(/CVE-\d{4}-\d{4,}/g) ?? [])];

/**
 * CVEs named in the sentences that say they are exploited (and not the ones saying nothing is). Takes HTML or
 * text: line breaks, paragraphs and cells end a "sentence" too, since CVE lists (Samsung's) have no full stops
 */
export function exploitedCves(html: string): string[] {
  const sentences = html.split(/<br\s*\/?>|<\/(?:p|li|td|tr|div|h\d)>/i)
    .flatMap(part => cleanText(part).split(/(?<=[.。])\s+/));
  return cveIds(sentences
    .filter(s => /in the wild|under limited, targeted exploitation|actively exploited/i.test(s) && !/not aware of any/i.test(s))
    .join(' '));
}

// ---------- Chrome ----------

export const CHROME_RELEASES_URL = 'https://chromereleases.googleblog.com/';
// The default feed holds 25 posts (about ten days of every channel); 100 covers about a month of stable updates
const CHROME_FEED = 'https://chromereleases.googleblog.com/feeds/posts/default?max-results=100';

export function parseChromeStable(items: Array<{ title?: string; link?: string; content?: string; isoDate?: string; published?: string }>, limit = 6): ChromeStable[] {
  return items.flatMap(item => {
    if (!/^Stable Channel Update for Desktop$/i.test(item.title?.trim() ?? '')) return [];
    const text = cleanText(item.content ?? '');
    const version = text.match(/\b(\d{2,3}\.\d+\.\d+\.\d+)\b/)?.[1];
    // The feed links over http; the blog serves the same post over https
    const url = safeUrl(item.link?.replace(/^http:\/\//, 'https://'));
    const published = feedDay(item.published ?? item.isoDate);
    if (!version || !url || !published) return [];
    const fixes = Number(text.match(/includes (\d+) security fix/i)?.[1]);
    return [{
      version,
      url,
      published,
      ...(Number.isFinite(fixes) ? { fixes } : {}),
      critical: (text.match(/\bCritical CVE-\d{4}-\d+/g) ?? []).length,
      exploited: exploitedCves(item.content ?? ''),
    }];
  }).sort((a, b) => b.published.localeCompare(a.published)).slice(0, limit);
}

export async function fetchChromeStable(): Promise<ChromeStable[]> {
  const feed = await fetchFeed(CHROME_FEED);
  if (!feed.items.length) throw new Error('Chrome Releases feed parsed empty');
  const stable = parseChromeStable(feed.items as never);
  if (!stable.length) throw new Error('No "Stable Channel Update for Desktop" post in the Chrome Releases feed');
  return stable;
}

// ---------- Pixel ----------

export const PIXEL_BULLETINS_URL = 'https://source.android.com/docs/security/bulletin/pixel';

export async function fetchPixelBulletins(limit = 2): Promise<VendorBulletin[]> {
  const index = parseAndroidBulletinIndex(await fetchHtml(`${PIXEL_BULLETINS_URL}?hl=en`), limit, PIXEL_BULLETINS_URL, 'Pixel Update Bulletin');
  if (!index.length) throw new Error('No Pixel Update Bulletins found');
  return Promise.all(index.map(async b => {
    const bulletin: VendorBulletin = { vendor: 'Pixel', title: b.title, url: b.url, published: b.published, exploited: [], ...(b.patchLevels.length ? { patchLevel: b.patchLevels.at(-1) } : {}) };
    try {
      const { cves, exploited } = parseAndroidBulletin(await fetchHtml(`${b.url}?hl=en`));
      Object.assign(bulletin, { cves, exploited });
    } catch (err) {
      console.warn(`[vendor security] ${b.url} failed (${(err as Error).message})`);
    }
    return bulletin;
  }));
}

// ---------- Samsung ----------

export const SAMSUNG_UPDATES_URL = 'https://security.samsungmobile.com/securityUpdate.smsb';
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

/** Each month is an accordion: a title "SMR-NOV-2026", then its body listing the patched CVEs by severity */
export function parseSamsungUpdates(html: string, limit = 2): VendorBulletin[] {
  const blocks = [...html.matchAll(/<div class="acc_title"[^>]*>\s*<a[^>]*>\s*(SMR-([A-Z]{3})-(\d{4}))\s*<\/a>\s*<\/div>([\s\S]*?)(?=<div class="acc_title"|$)/g)];
  return blocks.flatMap(([, name, mon, year, body]) => {
    const month = MONTHS.indexOf(mon.toUpperCase());
    if (month < 0) return [];
    const text = cleanText(body);
    // The CVEs under each severity heading, up to the next heading ("Not applicable to Samsung devices" isn't counted)
    const section = (heading: string) => text.match(new RegExp(`\\b${heading}\\b ((?:CVE-\\d{4}-\\d+,? ?)+)`, 'g')) ?? [];
    const listed = cveIds([...section('Critical'), ...section('High'), ...section('Moderate'), ...section('Low')].join(' '));
    return [{
      vendor: 'Samsung' as const,
      title: `Samsung Security Maintenance Release ${name}`,
      url: `${SAMSUNG_UPDATES_URL}#${name}`,
      published: `${year}-${String(month + 1).padStart(2, '0')}-01`,
      cves: listed.length,
      critical: cveIds(section('Critical').join(' ')).length,
      exploited: exploitedCves(body),
    }];
  }).sort((a, b) => b.published.localeCompare(a.published)).slice(0, limit);
}

export async function fetchSamsungUpdates(): Promise<VendorBulletin[]> {
  const updates = parseSamsungUpdates(await fetchHtml(SAMSUNG_UPDATES_URL));
  if (!updates.length) throw new Error('No Samsung Security Maintenance Releases found');
  return updates;
}

// ---------- MediaTek ----------

export const MEDIATEK_BULLETINS_URL = 'https://www.mediatek.com/product-security-bulletin';

/** The index: one card per month, its name, "Published: YYYY-MM-DD" and the bulletin's link */
export function parseMediatekIndex(html: string, limit = 2): VendorBulletin[] {
  const cards = [...html.matchAll(/class="title_wrap">\s*([A-Za-z]+)\s*<\/div>[\s\S]*?class="date">\s*(\d{4}-\d{2}-\d{2})\s*<\/span>[\s\S]*?href="(https:\/\/www\.mediatek\.com\/product-security-bulletin\/[a-z]+-\d{4})[^"]*"/g)];
  return cards.flatMap(([, month, published, href]) => {
    const url = safeUrl(href);
    return url ? [{ vendor: 'MediaTek' as const, title: `MediaTek Product Security Bulletin ${month} ${published.slice(0, 4)}`, url, published, exploited: [] }] : [];
  }).sort((a, b) => b.published.localeCompare(a.published)).slice(0, limit);
}

/** A bulletin page: its summary lists the CVEs by severity, and it says whether any is exploited */
export function parseMediatekBulletin(html: string): Pick<VendorBulletin, 'cves' | 'critical' | 'exploited'> {
  const text = cleanText(html);
  const summary = text.match(/Summary Severity CVEs ([\s\S]*?)(?: Details\b| Vulnerability Details| Version Date|$)/)?.[1] ?? text;
  return {
    cves: cveIds(summary).length,
    critical: cveIds(summary.match(/Critical ((?:CVE-\d{4}-\d+ ?,? ?)+)/)?.[1] ?? '').length,
    exploited: exploitedCves(html),
  };
}

export async function fetchMediatekBulletins(): Promise<VendorBulletin[]> {
  const index = parseMediatekIndex(await fetchHtml(MEDIATEK_BULLETINS_URL));
  if (!index.length) throw new Error('No MediaTek security bulletins found');
  await Promise.all(index.map(async b => {
    try {
      Object.assign(b, parseMediatekBulletin(await fetchHtml(b.url)));
    } catch (err) {
      console.warn(`[vendor security] ${b.url} failed (${(err as Error).message})`);
    }
  }));
  return index;
}
