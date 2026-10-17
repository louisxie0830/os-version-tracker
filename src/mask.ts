/**
 * Partially masks bank and app names so the comparison table isn't identifiable at a glance
 * ("台北富邦" → "台○○邦", "LINE Bank" → "L*** B***"). Digits, spaces and punctuation are kept.
 */

const CJK = /[\u3400-\u9fff\uf900-\ufaff]/;

/**
 * Keeps only the first and last CJK character of the whole name (runs split by Latin letters, like
 * "第e行動", would otherwise leak most of the name) and the first letter of each Latin word.
 */
export function maskName(name: string): string {
  const chars = [...name];
  const cjk = chars.flatMap((c, i) => (CJK.test(c) ? [i] : []));
  const keep = new Set(cjk.length > 2 ? [cjk[0], cjk[cjk.length - 1]] : cjk.slice(0, 1));
  const masked = chars.map((c, i) => (CJK.test(c) && !keep.has(i) ? '○' : c)).join('');
  return masked.replace(/[A-Za-z]+/g, word => (word.length <= 1 ? word : word[0] + '*'.repeat(word.length - 1)));
}

/** App Store links carry the app name in the path ("/app/<name>/id123"); keep only the id */
export function anonymizeAppStoreUrl(url: string): string {
  const id = url.match(/\/id(\d+)/)?.[1];
  const country = url.match(/apps\.apple\.com\/([a-z]{2})\//)?.[1] ?? 'tw';
  return id ? `https://apps.apple.com/${country}/app/id${id}` : url;
}
