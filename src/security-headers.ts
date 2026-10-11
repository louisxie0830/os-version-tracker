/**
 * The page's Content-Security-Policy. GitHub Pages can't send custom headers, so the static site
 * carries it in a <meta> tag; the Node server also sends it (plus the header-only directives) as headers.
 * Inline styles stay allowed (bar widths are style attributes); scripts must be same-origin files.
 */
export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "font-src 'self'",
  "manifest-src 'self'",
  "worker-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
].join('; ');

/** Headers for every response of the Node server (frame-ancestors only works as a header, not in <meta>) */
export const SECURITY_HEADERS: Record<string, string> = {
  'Content-Security-Policy': `${CONTENT_SECURITY_POLICY}; frame-ancestors 'none'`,
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
};
