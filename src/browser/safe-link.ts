// The browser's copy of src/safe-url.ts safeUrl (a classic script can't import a module): links that come
// from data become clickable only as absolute http(s) URLs without control characters, whitespace or
// credentials. test/components.test.ts checks that both agree on the same URLs.

/** The URL, normalised, when it is safe to link; null otherwise */
function safeLinkUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const value = raw.trim();
  if (!value || /[\u0000-\u001f\u007f-\u009f]/.test(value) || /\s/.test(value)) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  return url.username || url.password ? null : url.href;
}
