/**
 * URL validation for links that come from upstream data (news, deadlines, crash reports, store pages…).
 * HTML escaping alone doesn't stop active schemes such as `javascript:`, so only absolute http(s) URLs
 * without control characters are allowed.
 */

// Control characters (incl. CR/LF/tab) would allow header / property injection in .ics, feeds and HTML
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;

export function safeUrl(raw: unknown, { allowHttp = true }: { allowHttp?: boolean } = {}): string | null {
  if (typeof raw !== 'string') return null;
  const value = raw.trim();
  if (!value || CONTROL.test(value) || /\s/.test(value)) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol === 'https:' || (allowHttp && url.protocol === 'http:')) {
    return url.username || url.password ? null : url.href;
  }
  return null;
}

export const isSafeUrl = (raw: unknown, opts?: { allowHttp?: boolean }) => safeUrl(raw, opts) !== null;

/** webcal:// link for the site's own calendar feed; only derived from an https site URL */
export function calendarSubscriptionUrl(siteUrl: string): string | null {
  const site = safeUrl(siteUrl, { allowHttp: false });
  return site ? `webcal://${site.replace(/^https:\/\//, '').replace(/\/$/, '')}/calendar.ics` : null;
}
