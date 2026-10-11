/**
 * Shared network limits. Every outbound request is bounded so one slow upstream can't stall a refresh;
 * the values are generous because several official sites (large Apple / Android pages) are slow.
 */
export const NETWORK_TIMEOUT_MS = 15_000;
/** Large documentation pages and CSV exports */
export const SLOW_NETWORK_TIMEOUT_MS = 20_000;
/** Outgoing webhooks must never hold up a refresh */
export const WEBHOOK_TIMEOUT_MS = 5_000;

function describe(url: string | URL): string {
  try {
    const u = new URL(String(url));
    return `${u.host}${u.pathname}`;
  } catch {
    return String(url);
  }
}

/**
 * fetch() with a timeout covering both the response and reading its body. Errors name the URL
 * (without query strings, which may carry tokens) so source-health alerts say what failed.
 */
export async function fetchWithTimeout(url: string | URL, init: RequestInit = {}, timeoutMs = NETWORK_TIMEOUT_MS): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    const e = err as Error;
    if (e?.name === 'TimeoutError' || e?.name === 'AbortError') {
      throw new Error(`Timed out after ${timeoutMs / 1000}s: ${describe(url)}`, { cause: err });
    }
    throw new Error(`${e?.message ?? err} (${describe(url)})`, { cause: err });
  }
}
