import { arrayField, isRecord, readJsonState, recordField, writeJsonAtomic, type Normalized } from './state-file.js';
import { compareVersions } from './versions.js';
import { taipeiToday } from './taipei-date.js';
import type { TaiwanBankApp } from './fetchers/tw-banks.js';

/**
 * Values remembered between refreshes: each bank app's minimum OS versions (to report when a bank raises
 * or lowers them) and the last accepted core versions (to catch a parser that suddenly reads a wrong,
 * older version), plus how many items each list source returned (to catch a parser that suddenly finds far
 * fewer). Like changes.ts, state persists only when HISTORY_STATE_FILE is set (the static build
 * carries it between runs); otherwise it lives in memory. Bank names are stored already masked.
 */

export interface BankChange {
  /** App Store id or Play package: stable while the masked names may collide */
  key: string;
  bank: string;
  app: string;
  platform: 'iOS' | 'Android';
  from: string;
  to: string;
  /** Day the change was first seen (YYYY-MM-DD) */
  date: string;
  url: string;
}

interface VersionGuard {
  value: string;
  /** An older value seen in consecutive refreshes; accepted after ROLLBACK_ACCEPT_AFTER of them */
  pending?: { value: string; seen: number };
}

/** How many bank apps require each minimum major version, once per day */
export interface BankSnapshot {
  date: string; // YYYY-MM-DD
  iOS: Record<string, number>;
  Android: Record<string, number>;
}

interface CountGuard {
  value: number;
  /** The last COUNT_WINDOW accepted counts: a drop is measured from their highest, so a slide in small steps shows */
  recent?: number[];
  /** A much lower count seen in consecutive refreshes; accepted after ROLLBACK_ACCEPT_AFTER of them */
  low?: { value: number; seen: number };
}

interface HistoryState {
  banks: Record<string, { iOS?: string; Android?: string }>;
  bankChanges: BankChange[];
  bankSnapshots: BankSnapshot[];
  versions: Record<string, VersionGuard>;
  counts: Record<string, CountGuard>;
}

const STATE_FILE = process.env.HISTORY_STATE_FILE;
const KEEP_CHANGES_DAYS = 365;
const KEEP_SNAPSHOT_DAYS = 2 * 365;
/** A genuine rollback (Apple pulling a release) keeps showing up; a parsing slip usually doesn't */
export const ROLLBACK_ACCEPT_AFTER = 3;

function emptyState(): HistoryState {
  return { banks: {}, bankChanges: [], bankSnapshots: [], versions: {}, counts: {} };
}

const str = (v: unknown): v is string => typeof v === 'string';
const optStr = (v: unknown) => v === undefined || typeof v === 'string';
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isBank = (v: unknown): v is { iOS?: string; Android?: string } => isRecord(v) && optStr(v.iOS) && optStr(v.Android);
const isChange = (v: unknown): v is BankChange => isRecord(v)
  && ['key', 'bank', 'app', 'from', 'to', 'date', 'url'].every(k => str(v[k])) && (v.platform === 'iOS' || v.platform === 'Android');
const isCounts = (v: unknown) => isRecord(v) && Object.values(v).every(num);
const isSnapshot = (v: unknown): v is BankSnapshot => isRecord(v) && str(v.date) && isCounts(v.iOS) && isCounts(v.Android);
const isPending = (v: unknown) => v === undefined || (isRecord(v) && num(v.seen) && (str(v.value) || num(v.value)));
const isVersion = (v: unknown): v is VersionGuard => isRecord(v) && str(v.value) && isPending(v.pending);
const isCount = (v: unknown): v is CountGuard => isRecord(v) && num(v.value)
  && (v.recent === undefined || (Array.isArray(v.recent) && v.recent.every(num)))
  && (v.low === undefined || (isRecord(v.low) && num(v.low.value) && num(v.low.seen)));

/** Fields older versions didn't have (counts, snapshots…) start empty; wrong types are reset, bad entries dropped */
export function normalizeHistoryState(raw: unknown): Normalized<HistoryState> {
  if (!isRecord(raw)) return null;
  const repaired: string[] = [];
  return {
    value: {
      banks: recordField(raw, 'banks', isBank, repaired),
      bankChanges: arrayField(raw, 'bankChanges', isChange, repaired),
      bankSnapshots: arrayField(raw, 'bankSnapshots', isSnapshot, repaired),
      versions: recordField(raw, 'versions', isVersion, repaired),
      counts: recordField(raw, 'counts', isCount, repaired),
    },
    repaired,
  };
}

function loadState(): HistoryState {
  return (STATE_FILE ? readJsonState(STATE_FILE, 'history', normalizeHistoryState) : undefined) ?? emptyState();
}

const state: HistoryState = loadState();

function saveState(): void {
  if (!STATE_FILE) return;
  try {
    writeJsonAtomic(STATE_FILE, state);
  } catch (err) {
    console.warn(`[history] could not persist state (${(err as Error).message})`);
  }
}

/** For tests: start from an empty state */
export function resetHistoryState(): void {
  Object.assign(state, emptyState());
}

/** The store id in the (already anonymised) store URLs identifies an app across refreshes */
export function bankAppKey(app: TaiwanBankApp): string {
  const ios = app.ios?.url.match(/\/id(\d+)/)?.[1];
  const play = app.android?.url.match(/[?&]id=([\w.]+)/)?.[1];
  return ios ? `ios:${ios}` : play ? `play:${play}` : `name:${app.bank}|${app.app}`;
}

/**
 * Compares each app's minimum iOS / Android with the previous refresh and returns every change seen in the
 * last year, newest first. The first refresh is only a baseline. A platform missing this time (that store
 * page failed) keeps its previous value instead of counting as a change.
 */
export function recordBankVersions(apps: TaiwanBankApp[], now = new Date(), keys?: readonly string[]): BankChange[] {
  // The day in Taiwan (the morning build runs at 21:43 UTC, still the day before in UTC)
  const today = taipeiToday(now);
  for (const [i, app] of apps.entries()) {
    // The configured identity (src/fetchers/tw-banks.ts) when given: one store page failing must not turn the
    // app into a second one keyed by its other store
    const key = keys?.[i] ?? bankAppKey(app);
    const previous = state.banks[key];
    const current = { ...previous };
    for (const [platform, info] of [['iOS', app.ios], ['Android', app.android]] as const) {
      if (!info?.minOs) continue;
      const before = previous?.[platform];
      if (before && compareVersions(before, info.minOs) !== 0) {
        state.bankChanges.push({ key, bank: app.bank, app: app.app, platform, from: before, to: info.minOs, date: today, url: info.url });
      }
      current[platform] = info.minOs;
    }
    state.banks[key] = current;
  }
  // Apps no longer on the list (or remembered under another key before) stop counting
  if (keys) {
    const current = new Set(keys);
    for (const key of Object.keys(state.banks)) if (!current.has(key)) delete state.banks[key];
  }
  const since = new Date(now.getTime() - KEEP_CHANGES_DAYS * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  state.bankChanges = state.bankChanges.filter(c => c.date >= since);
  recordBankSnapshot(today, now);
  saveState();
  return [...state.bankChanges].sort((a, b) => b.date.localeCompare(a.date));
}

/** Today's distribution of remembered minimums (a later refresh on the same day replaces it) */
function recordBankSnapshot(today: string, now: Date): void {
  const count = (platform: 'iOS' | 'Android') => {
    const counts: Record<string, number> = {};
    for (const versions of Object.values(state.banks)) {
      const major = versions[platform]?.match(/^\d+/)?.[0];
      if (major) counts[major] = (counts[major] ?? 0) + 1;
    }
    return counts;
  };
  const since = new Date(now.getTime() - KEEP_SNAPSHOT_DAYS * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  state.bankSnapshots = [
    ...state.bankSnapshots.filter(s => s.date !== today && s.date >= since),
    { date: today, iOS: count('iOS'), Android: count('Android') },
  ].sort((a, b) => a.date.localeCompare(b.date));
}

/** Daily bank distributions, oldest first */
export function bankSnapshots(): BankSnapshot[] {
  return [...state.bankSnapshots];
}

export type VersionCheck = { ok: true } | { ok: false; message: string };

/**
 * Largest major-version step taken without question. Bigger leaps happen (iOS 18 → 26), so one is held back
 * like a rollback and accepted once it persists.
 */
export const MAX_MAJOR_STEP = 1;

/**
 * Accepts a version that is the same or newer than the last accepted one. An older one is rejected
 * (the source is treated as failing, so a wrong value isn't published) until it has been seen in
 * ROLLBACK_ACCEPT_AFTER consecutive refreshes, after which it's taken as a real rollback.
 * A leap of more than MAX_MAJOR_STEP major versions is held back the same way.
 */
export function checkVersionNotOlder(name: string, label: string, value: string): VersionCheck {
  const guard = state.versions[name];
  const major = (v: string) => Number(v.match(/^\d+/)?.[0] ?? NaN);
  // A misparse that reads newer ("260" for 26.0) must not become the bar the real versions then fail
  const leap = !!guard && major(value) > major(guard.value) + MAX_MAJOR_STEP;
  if (!guard || (compareVersions(value, guard.value) >= 0 && !leap)) {
    state.versions[name] = { value };
    saveState();
    return { ok: true };
  }
  const change = leap ? 'jumped' : 'went back';
  const seen = guard.pending?.value === value ? guard.pending.seen + 1 : 1;
  if (seen >= ROLLBACK_ACCEPT_AFTER) {
    console.warn(`[history] ${label} ${change} from ${guard.value} to ${value} for ${seen} refreshes; accepting it`);
    state.versions[name] = { value };
    saveState();
    return { ok: true };
  }
  state.versions[name] = { ...guard, pending: { value, seen } };
  saveState();
  return { ok: false, message: `${label} ${change} from ${guard.value} to ${value} (${seen}/${ROLLBACK_ACCEPT_AFTER}); not published until it persists` };
}

export interface CoreVersions {
  iosStable?: string;
  androidStable?: string;
  xcodeStable?: string;
  agpStable?: string;
}

const CORE_CHECKS: Array<{ field: keyof CoreVersions; source: 'ios' | 'android' | 'iosToolchain' | 'androidToolchain'; label: string; format: RegExp; key?: string }> = [
  // Its own key since iOS stable became the release most iPhones get (ios.ts parseAppleAssetCatalog): the old
  // guard held a one-model build (27.1 for one iPhone), which the correct 27.0.1 would have "gone back" from
  { field: 'iosStable', key: 'iosGeneralRelease', source: 'ios', label: 'iOS stable', format: /^\d{2,}(?:\.\d+){0,2}$/ },
  { field: 'androidStable', source: 'android', label: 'Android stable', format: /^\d{2,}(?:\.\d+)?$/ },
  { field: 'xcodeStable', source: 'iosToolchain', label: 'Xcode stable', format: /^\d{2,}(?:\.\d+){0,2}$/ },
  { field: 'agpStable', source: 'androidToolchain', label: 'AGP stable', format: /^\d+\.\d+(?:\.\d+)?$/ },
];

/**
 * Sanity checks on the versions everything else is derived from: each must look like a version and must
 * not be older than the last accepted one. Returns the sources whose data shouldn't be trusted this time.
 */
export function coreVersionProblems(versions: CoreVersions, required: ReadonlyArray<keyof CoreVersions> = []): Array<{ source: string; message: string }> {
  return CORE_CHECKS.flatMap(({ field, key = field, source, label, format }) => {
    const value = versions[field];
    // A source that answered without the version it exists to give has changed its format
    if (value === undefined) return required.includes(field) ? [{ source, message: `${label} is missing from a response that otherwise succeeded` }] : [];
    if (!format.test(value)) return [{ source, message: `${label} "${value}" doesn't look like a version` }];
    const check = checkVersionNotOlder(key, label, value);
    return check.ok ? [] : [{ source, message: check.message }];
  });
}

/** Lists shorter than this are too small for a drop to mean anything */
export const COUNT_MIN_BASELINE = 6;
/** A list that suddenly returns fewer than half its usual items */
export const COUNT_DROP_RATIO = 0.5;
/** How many accepted counts make "usual" (about 5 days at two refreshes a day) */
export const COUNT_WINDOW = 10;

/**
 * Compares a list source's item count with the highest of its recent accepted counts (COUNT_WINDOW of them,
 * so 100 → 60 → 40 → 25 is caught, not waved through one step at a time). A drop below half is reported
 * until it has been seen in ROLLBACK_ACCEPT_AFTER consecutive refreshes, after which it's the new normal
 * (a feed that really got shorter).
 */
export function checkCountNotDropped(name: string, count: number): VersionCheck {
  const guard = state.counts[name];
  const baseline = guard ? Math.max(guard.value, ...(guard.recent ?? [])) : 0;
  if (!guard || baseline < COUNT_MIN_BASELINE || count >= baseline * COUNT_DROP_RATIO) {
    state.counts[name] = { value: count, recent: [...(guard?.recent ?? []), count].slice(-COUNT_WINDOW) };
    saveState();
    return { ok: true };
  }
  const seen = (guard.low?.seen ?? 0) + 1;
  if (seen >= ROLLBACK_ACCEPT_AFTER) {
    console.warn(`[history] ${name} has stayed at ${count} items (was ${baseline}) for ${seen} refreshes; accepting it`);
    // The new normal: the old highs no longer count
    state.counts[name] = { value: count, recent: [count] };
    saveState();
    return { ok: true };
  }
  state.counts[name] = { ...guard, low: { value: count, seen } };
  saveState();
  return { ok: false, message: `${name}：筆數從 ${baseline} 掉到 ${count}（第 ${seen}/${ROLLBACK_ACCEPT_AFTER} 次；連續 ${ROLLBACK_ACCEPT_AFTER} 次就視為正常）` };
}
