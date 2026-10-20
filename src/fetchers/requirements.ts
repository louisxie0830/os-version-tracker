import { cleanText, fetchHtml, parseTables } from './html-table.js';
import type { Deadline } from '../types.js';

export const APPLE_REQUIREMENTS_URL = 'https://developer.apple.com/news/upcoming-requirements/';
export const PLAY_POLICY_URL = 'https://support.google.com/googleplay/android-developer/table/12921780?hl=en';
// Another official English localisation; only tried after a 429, never for ordinary parse errors.
export const PLAY_POLICY_FALLBACK_URL = 'https://support.google.com/googleplay/android-developer/table/12921780?hl=en-GB';
export const PLAY_BILLING_URL = 'https://developer.android.com/google/play/billing/deprecation-faq?hl=en';
export const PAGE_SIZE_URL = 'https://developer.android.com/guide/practices/page-sizes?hl=en';

function isoDate(text: string): string {
  const d = new Date(text);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function firstSentence(text: string, max = 220): string {
  const sentence = text.match(/^.+?[.!?](?=\s|$)/)?.[0] ?? text;
  return sentence.length > max ? `${sentence.slice(0, max - 1)}…` : sentence;
}

export async function fetchAppleRequirements(): Promise<Deadline[]> {
  return parseAppleRequirements(await fetchHtml(APPLE_REQUIREMENTS_URL));
}

export function parseAppleRequirements(html: string): Deadline[] {
  const items: Deadline[] = [];
  const re = /<a class="article-title" href="([^"]+)"><h2>([\s\S]*?)<\/h2><\/a>[\s\S]*?article-date">([\s\S]*?)<\/p>[\s\S]*?<span class="article-text">([\s\S]*?)<\/span>/g;
  for (const m of html.matchAll(re)) {
    const [, href, title, when, body] = m;
    const date = isoDate(cleanText(when).replace(/^(Since|Starting|Beginning)\s+/i, ''));
    if (!date) continue;
    items.push({
      platform: 'iOS',
      date,
      title: cleanText(title),
      detail: firstSentence(cleanText(body).replace(/\s*Learn (?:about|more|how)[\s\S]*$/, '')),
      source: 'Apple Upcoming Requirements',
      url: new URL(href, APPLE_REQUIREMENTS_URL).toString(),
    });
  }
  if (!items.length) throw new Error('No Apple requirements parsed');
  return items;
}

export async function fetchPlayPolicyDeadlines(): Promise<Deadline[]> {
  try {
    return parsePlayPolicyDeadlines(await fetchHtml(PLAY_POLICY_URL));
  } catch (err) {
    // net.ts already respects Retry-After and retries the original URL once.
    // Some Google Support locales intermittently return 429 on hosted runners;
    // try ONE other official English locale, not a third-party mirror or stale snapshot.
    if (!/\b429\b/.test(String((err as Error)?.message ?? err))) throw err;
    return parsePlayPolicyDeadlines(await fetchHtml(PLAY_POLICY_FALLBACK_URL));
  }
}

export function parsePlayPolicyDeadlines(html: string): Deadline[] {
  const tables = parseTables(html);
  const table = tables.find(t => /Deadline/i.test(t.rows[0]?.[0] ?? '') && /Policy change/i.test(t.rows[0]?.[1] ?? ''));
  if (!table) throw new Error('Play policy deadline table not found');

  const deadlines = table.rows.slice(1)
    .filter(r => /^\d{4}-\d{2}-\d{2}$/.test(r[0]))
    .map(([date, change]) => {
      // Cell reads "<Policy name> <description sentence(s)> Announced YYYY-MM-DD | ..."
      const body = change.replace(/\s*Announced\s+\d{4}-\d{2}-\d{2}[\s\S]*$/, '');
      const split = body.match(/^(.+?)\s+((?:We're|We are|To |Our |Apps |If |Starting |Developers |You )[\s\S]*)$/);
      return {
        platform: 'Android' as const,
        date,
        title: `Play 政策：${split?.[1] ?? body.slice(0, 60)}`,
        detail: firstSentence(split?.[2] ?? body),
        source: 'Google Play Policy Deadlines',
        url: PLAY_POLICY_URL,
      };
    });
  if (!deadlines.length) throw new Error('Play policy deadline table parsed empty');
  return deadlines;
}

export interface PlayBillingInfo {
  deadlines: Deadline[];
  latest?: string;
}

export const PLAY_BILLING_METADATA_URL = 'https://dl.google.com/dl/android/maven2/com/android/billingclient/billing/maven-metadata.xml';

export async function fetchPlayBilling(): Promise<PlayBillingInfo> {
  const [html, metadata] = await Promise.all([
    fetchHtml(PLAY_BILLING_URL),
    fetchHtml(PLAY_BILLING_METADATA_URL).catch(() => ''),
  ]);
  return parsePlayBilling(html, metadata);
}

/** Latest stable x.y.z version listed in a Maven metadata file */
export function parseMavenLatest(metadata: string): string | undefined {
  return [...metadata.matchAll(/<version>(\d+\.\d+\.\d+)<\/version>/g)].map(m => m[1]).at(-1);
}

/** `metadata` is the billing artifact's maven-metadata.xml; pass '' when unavailable */
export function parsePlayBilling(html: string, metadata = ''): PlayBillingInfo {
  const table = parseTables(html).find(t => /Extension deadline/i.test(t.rows[0]?.join(' ') ?? ''));
  if (!table) throw new Error('Play Billing deprecation table not found');

  const latest = parseMavenLatest(metadata);
  const deadlines = table.rows.slice(1).flatMap(([version, deadline, extension]) => {
    const date = isoDate(deadline);
    if (!date) return [];
    return [{
      platform: 'Android' as const,
      date,
      title: `Play Billing Library ${version} 停止支援`,
      detail: `仍使用 PBL ${version} 的新 App 與更新將無法上架。` + (latest ? `最新版本為 ${latest}。` : ''),
      source: 'Play Billing deprecation FAQ',
      url: PLAY_BILLING_URL,
      extensionDate: extension ? isoDate(extension) || undefined : undefined,
    }];
  });
  if (!deadlines.length) throw new Error('Play Billing deprecation table parsed empty');
  return { deadlines, latest };
}

export async function fetchPageSizeDeadlines(): Promise<Deadline[]> {
  return parsePageSizeDeadlines(await fetchHtml(PAGE_SIZE_URL));
}

export function parsePageSizeDeadlines(html: string): Deadline[] {
  const text = cleanText(html);
  const deadlines: Deadline[] = [];
  for (const m of text.matchAll(/(?:Starting|Beginning)\s+([A-Z][a-z]+ \d{1,2},? \d{4}),([^.]{10,260})\./g)) {
    const date = isoDate(m[1]);
    if (!date) continue;
    deadlines.push({
      platform: 'Android',
      date,
      title: '16 KB 記憶體分頁大小支援',
      detail: firstSentence(`${m[0]}`),
      source: 'Android 16 KB page sizes guide',
      url: PAGE_SIZE_URL,
    });
  }
  if (!deadlines.length) throw new Error('No 16 KB page size deadline found');
  return deadlines;
}
