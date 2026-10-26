import { isRecord, readJsonState, recordField, writeJsonAtomic, type Normalized } from './state-file.js';

/**
 * Each source's last good result, so a source that fails one refresh (or comes back implausible) shows what
 * it had last time, marked as stale, instead of an empty section. A result older than LAST_GOOD_MAX_AGE_DAYS
 * is no longer offered: by then an empty section with "抓取失敗" is the more honest page.
 *
 * Persists only when LAST_GOOD_STATE_FILE is set (the static build carries it between runs in the Actions
 * cache). It holds the raw results, bank names unmasked, so unlike the other state files it is never copied
 * into the published site.
 */

export interface LastGood<T = unknown> {
  /** When this result was fetched */
  fetchedAt: string;
  value: T;
}

export const LAST_GOOD_MAX_AGE_DAYS = 7;
/**
 * Bump when a source's result changes shape (a field added, renamed or retyped in types.ts or a fetcher):
 * results saved by an older build are then dropped instead of reaching code that expects the new shape
 */
export const LAST_GOOD_SCHEMA = 1;
const DAY_MS = 24 * 60 * 60 * 1000;

const STATE_FILE = process.env.LAST_GOOD_STATE_FILE;

const isEntry = (v: unknown): v is LastGood => isRecord(v) && typeof v.fetchedAt === 'string'
  && !Number.isNaN(Date.parse(v.fetchedAt)) && 'value' in v && v.value !== null && v.value !== undefined;

export function normalizeLastGood(raw: unknown): Normalized<Record<string, LastGood>> {
  if (!isRecord(raw)) return null;
  // Another shape of results: start without any (a normal first run for this file, not damage)
  if (raw.schema !== LAST_GOOD_SCHEMA) return { value: {}, repaired: [] };
  const repaired: string[] = [];
  return { value: recordField(raw, 'sources', isEntry, repaired), repaired };
}

const state: Record<string, LastGood> = (STATE_FILE ? readJsonState(STATE_FILE, 'last-good', normalizeLastGood) : undefined) ?? {};

/** Remembers a source's result from a refresh that passed every check */
export function rememberGood(key: string, value: unknown, at: Date): void {
  if (value === null || value === undefined) return;
  state[key] = { fetchedAt: at.toISOString(), value };
}

/** The source's last good result, unless it's too old to show */
export function lastGood<T>(key: string, now: Date): LastGood<T> | undefined {
  const entry = state[key];
  if (!entry || now.getTime() - Date.parse(entry.fetchedAt) > LAST_GOOD_MAX_AGE_DAYS * DAY_MS) return undefined;
  // A copy: the refresh derives from (and corrects) what it's given, which must not change what's remembered
  return structuredClone(entry) as LastGood<T>;
}

/** Written once per refresh, after every source has been remembered */
export function saveLastGood(): void {
  if (!STATE_FILE) return;
  try {
    writeJsonAtomic(STATE_FILE, { schema: LAST_GOOD_SCHEMA, sources: state });
  } catch (err) {
    console.warn(`[last-good] could not persist state (${(err as Error).message})`);
  }
}

/** For tests: forget everything */
export function resetLastGood(): void {
  for (const key of Object.keys(state)) delete state[key];
}
