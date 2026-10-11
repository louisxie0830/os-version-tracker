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

export function parseiOSAdoption(html: string): iOSAdoption {
  const charts = [...html.matchAll(/data-bar-chart='(\[[\s\S]*?\])'/g)]
    .map(m => JSON.parse(m[1]) as AdoptionShare[])
    .filter(chart => chart.some(s => /^iOS\b/.test(s.name)));
  if (charts.length < 2) {
    throw new Error('iOS adoption charts not found');
  }

  const text = html.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ');
  const measured = text.match(/transacted on the App Store on ([A-Za-z]+ \d{1,2}, \d{4})/);
  return {
    measuredAt: measured?.[1],
    recentDevices: charts[0],
    allDevices: charts[1],
  };
}
