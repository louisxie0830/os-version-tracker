import { fetchWithTimeout, SLOW_NETWORK_TIMEOUT_MS } from '../net.js';

export function cleanText(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;?/g, ' ')
    .replace(/&ndash;/g, '–')
    .replace(/&mdash;/g, '—')
    .replace(/&amp;/g, '&')
    .replace(/&#39;|&rsquo;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
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

export async function fetchHtml(url: string): Promise<string> {
  const res = await fetchWithTimeout(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (os-version-tracker)', 'Accept-Language': 'en-US,en' },
  }, SLOW_NETWORK_TIMEOUT_MS);
  if (!res.ok) {
    throw new Error(`${url} failed: ${res.status}`);
  }
  return res.text();
}
