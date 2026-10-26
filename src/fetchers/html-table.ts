import { fetchText, SLOW_NETWORK_TIMEOUT_MS } from '../net.js';
import { sharedDownload } from './feed.js';

export function cleanText(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;?/g, ' ')
    .replace(/&ndash;/g, '–')
    .replace(/&mdash;/g, '—')
    .replace(/&#39;|&rsquo;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    // Last: decoding it first would turn "&amp;lt;" (a written-out "&lt;") into "<"
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    // A tag that ended right before punctuation left a space in front of it ("iOS 26 , iPadOS 26")
    .replace(/ ([,.;:!?，。、；：）)])/g, '$1')
    .trim();
}

export interface HtmlTable {
  /** Plain text of the ~400 characters before the table, used to identify it */
  context: string;
  rows: string[][];
}

/** Extracts every <table> as rows of cleaned cell text (header rows included) */
export function parseTables(html: string): HtmlTable[] {
  return [...html.matchAll(/<table[\s\S]*?<\/table>/g)].map(t => ({
    context: cleanText(html.slice(Math.max(0, t.index! - 3000), t.index)).slice(-400),
    rows: [...t[0].matchAll(/<tr[\s\S]*?<\/tr>/g)]
      .map(r => [...r[0].matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/g)].map(c => cleanText(c[1])))
      .filter(r => r.length > 0),
  }));
}

export function findTable(tables: HtmlTable[], match: (t: HtmlTable) => boolean): HtmlTable | undefined {
  return tables.find(match);
}

/** A page in English (some docs localise by Accept-Language); downloaded once per refresh however many sections read it */
export function fetchHtml(url: string): Promise<string> {
  return sharedDownload(`html ${url}`, () => fetchText(url, { headers: { 'Accept-Language': 'en-US,en' } }, SLOW_NETWORK_TIMEOUT_MS, (status, where) => `${where} failed: ${status}`));
}

/**
 * Where each wanted column is, by its header text rather than its position: a column added, removed or moved
 * upstream then still reads right, instead of quietly reading the neighbouring column. Each column is the
 * first header matching its pattern; a missing one throws (the table changed beyond recognition), unless
 * it's listed as optional, which gives -1.
 */
export function columnsOf<K extends string>(header: readonly string[], wanted: Record<K, RegExp>, what: string, optional: readonly NoInfer<K>[] = []): Record<K, number> {
  const found = {} as Record<K, number>;
  for (const [key, pattern] of Object.entries(wanted) as Array<[K, RegExp]>) {
    const i = header.findIndex(h => pattern.test(h));
    if (i < 0 && !optional.includes(key)) throw new Error(`${what}: no "${key}" column (headers: ${header.join(' | ')})`);
    found[key] = i;
  }
  return found;
}
