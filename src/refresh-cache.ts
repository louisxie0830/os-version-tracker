/**
 * Caches the result of an expensive refresh for `ttlMs` and coalesces concurrent callers onto a single
 * in-flight refresh, so simultaneous requests don't hit every upstream (and send webhooks) twice.
 * A failed refresh is not cached: the next caller starts a new one.
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

  return {
    get() {
      if (value !== undefined && now() - fetchedAt < ttlMs) return Promise.resolve(value);
      if (inFlight) return inFlight;
      inFlight = refresh()
        .then(result => {
          value = result;
          fetchedAt = now();
          return result;
        })
        .finally(() => {
          inFlight = null;
        });
      return inFlight;
    },
    peek() {
      return value === undefined ? undefined : { value, fetchedAt };
    },
  };
}
