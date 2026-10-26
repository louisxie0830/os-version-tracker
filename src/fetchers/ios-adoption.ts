import { fetchHtml } from './html-table.js';
import type { AdoptionShare, iOSAdoption } from '../types.js';

export const IOS_ADOPTION_URL = 'https://developer.apple.com/support/app-store/';

/**
 * Apple's official iOS usage share, published on the App Store support page as
 * `data-bar-chart` JSON blocks: first "devices introduced in the last four years", then "all devices".
 */
export async function fetchiOSAdoption(): Promise<iOSAdoption> {
  return parseiOSAdoption(await fetchHtml(IOS_ADOPTION_URL));
}

/** An HTML attribute value's entities: named ones JSON can contain, and numeric ones */
function decodeAttribute(value: string): string {
  const named: Record<string, string> = { quot: '"', amp: '&', apos: "'", lt: '<', gt: '>', nbsp: '\u00a0' };
  return value.replace(/&(?:#(\d+)|#x([\da-f]+)|(\w+));/gi, (all, dec: string, hex: string, name: string) =>
    dec ? String.fromCodePoint(Number(dec)) : hex ? String.fromCodePoint(parseInt(hex, 16)) : named[name.toLowerCase()] ?? all);
}

export function parseiOSAdoption(html: string): iOSAdoption {
  // The attribute in either quote style (double-quoted JSON comes entity-encoded); each chart is told apart
  // by the heading text before it, falling back to the page order (recent devices first)
  const charts = [...html.matchAll(/data-bar-chart=(?:'(\[[\s\S]*?\])'|"(\[[\s\S]*?\])")/g)]
    .map(m => ({
      shares: JSON.parse(m[1] ?? decodeAttribute(m[2])) as AdoptionShare[],
      before: html.slice(Math.max(0, m.index! - 1500), m.index).replace(/<[^>]+>/g, ' '),
    }))
    .filter(chart => chart.shares.some(s => /^iOS\b/.test(s.name)));
  if (charts.length < 2) {
    throw new Error('iOS adoption charts not found');
  }
  // Which heading came last before the chart: "…all devices" or "…introduced in the last four years"
  const kind = ({ before }: { before: string }) => {
    const text = before.toLowerCase();
    const all = text.lastIndexOf('all devices');
    const recent = Math.max(text.lastIndexOf('four years'), text.lastIndexOf('introduced in the last'));
    return all < 0 && recent < 0 ? undefined : all > recent ? 'all' : 'recent';
  };
  const all = charts.find(c => kind(c) === 'all');
  const recent = charts.find(c => kind(c) === 'recent');
  const [recentShares, allShares] = all && recent && all !== recent ? [recent.shares, all.shares] : [charts[0].shares, charts[1].shares];

  // Each chart is a whole (its shares add up to about 100%): anything else is fields renamed or a different chart
  for (const shares of [recentShares, allShares]) {
    const sum = shares.reduce((total, s) => total + (typeof s.value === 'number' ? s.value : NaN), 0);
    if (!(sum >= 95 && sum <= 105)) throw new Error(`iOS adoption chart doesn't add up to 100% (${sum})`);
  }
  const text = html.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ');
  const measured = text.match(/transacted on the App Store on ([A-Za-z]+ \d{1,2}, \d{4})/);
  return {
    measuredAt: measured?.[1],
    recentDevices: recentShares,
    allDevices: allShares,
  };
}
