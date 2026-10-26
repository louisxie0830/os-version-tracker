/**
 * Caches the result of an expensive refresh for `ttlMs` and coalesces concurrent callers onto a single
 * in-flight refresh, so simultaneous requests don't hit every upstream (and send webhooks) twice.
 * A failed refresh is not cached: the next caller starts a new one. Once there is a result, an expired one
 * is served while the refresh runs (stale-while-revalidate), and kept when that refresh fails.
 */
export interface RefreshCache<T> {
  get(): Promise<T>;
  /** The last successful result and when it was fetched, without starting a refresh */
  peek(): { value: T; fetchedAt: number } | undefined;
}

export function createRefreshCache<T>(refresh: () => Promise<T>, ttlMs: number, now: () => number = Date.now): RefreshCache<T> {
  let value: T | undefined;
  let fetchedAt = 0;
  let inFlight: Promise<T> | null = null;

  const start = (): Promise<T> => {
    inFlight ??= refresh()
      .then(result => {
        value = result;
        fetchedAt = now();
        return result;
      })
      .finally(() => {
        inFlight = null;
      });
    return inFlight;
  };

  return {
    get() {
      if (value === undefined) return start();
      // Expired: the old result answers at once while a refresh runs behind it, so no reader waits for every
      // upstream, and a refresh that fails leaves the last good result in place instead of an error page
      if (now() - fetchedAt >= ttlMs) {
        start().catch(err => console.warn(`[refresh] failed; serving the previous result (${(err as Error)?.message ?? err})`));
      }
      return Promise.resolve(value);
    },
    peek() {
      return value === undefined ? undefined : { value, fetchedAt };
    },
  };
}
