import * as nodeFs from 'node:fs';
import path from 'node:path';

/**
 * State files carried between runs (first-seen times, bank history, alert streaks).
 *
 * Writing: to a temporary file in the same directory, flushed to disk (fsync), then renamed over the old file,
 * and finally the directory itself is synced so the rename is on disk too. An interrupted run therefore
 * leaves either the old file or the new one, never half of one. If any step fails, the temporary file is
 * removed (its descriptor closed first) and the existing state file is left untouched. Syncing the directory
 * is best effort: a file system that doesn't support it still gets the atomic rename, without the guarantee
 * that the rename survives a power cut.
 *
 * Reading: see readJsonState.
 */

/** The file operations used, injectable so tests can make any step fail */
export type StateFs = Pick<typeof nodeFs, 'openSync' | 'writeSync' | 'fsyncSync' | 'closeSync' | 'renameSync' | 'rmSync'>;

export function writeJsonAtomic(file: string, value: unknown, fs: StateFs = nodeFs): void {
  const tmp = `${file}.${process.pid}.tmp`;
  const discard = () => { try { fs.rmSync(tmp, { force: true }); } catch { /* nothing more to do */ } };
  let fd: number;
  try {
    fd = fs.openSync(tmp, 'w');
  } catch (err) {
    discard(); // a failed open can still have created the file
    throw err;
  }
  try {
    fs.writeSync(fd, JSON.stringify(value));
    fs.fsyncSync(fd);
  } catch (err) {
    try { fs.closeSync(fd); } catch { /* already failing */ }
    discard();
    throw err;
  }
  try {
    fs.closeSync(fd);
    fs.renameSync(tmp, file);
  } catch (err) {
    discard();
    throw err;
  }
  syncDirectory(path.dirname(file), fs);
}

function syncDirectory(dir: string, fs: StateFs): void {
  let fd: number | undefined;
  try {
    fd = fs.openSync(dir, 'r');
    fs.fsyncSync(fd);
  } catch {
    // Not supported everywhere (see the note above); the rename itself already happened
  } finally {
    if (fd !== undefined) try { fs.closeSync(fd); } catch { /* ignore */ }
  }
}

/** What a normalizer made of a parsed state file; null when nothing usable is left */
export type Normalized<T> = { value: T; repaired: string[] } | null;

/**
 * Reads a state file. A missing file is a normal first run. Otherwise the JSON is parsed and handed to
 * `normalize`, which fills in fields older versions didn't have, resets fields of the wrong type (listing
 * their names in `repaired`) and returns null when the file can't be used at all. An unparseable or unusable
 * file is moved aside (*.corrupt-<time>) for recovery by hand, and the run starts from an empty state.
 * Warnings name the file and the fields, never their contents.
 */
export function readJsonState<T>(file: string, label: string, normalize: (raw: unknown) => Normalized<T> = raw => ({ value: raw as T, repaired: [] })): T | undefined {
  if (!nodeFs.existsSync(file)) return undefined;
  let raw: unknown;
  try {
    raw = JSON.parse(nodeFs.readFileSync(file, 'utf8'));
  } catch (err) {
    // Only the kind of error: a parse error's message quotes part of the file, which must not reach the logs
    setAside(file, label, `is not valid JSON (${(err as Error).name})`);
    return undefined;
  }
  const result = normalize(raw);
  if (!result) {
    setAside(file, label, 'does not have the expected structure');
    return undefined;
  }
  if (result.repaired.length) {
    console.warn(`[${label}] state file ${file}: reset or dropped ${result.repaired.join(', ')} (unexpected types); the rest was kept`);
  }
  return result.value;
}

function setAside(file: string, label: string, problem: string): void {
  const aside = `${file}.corrupt-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  try { nodeFs.renameSync(file, aside); } catch { /* keep going with an empty state */ }
  console.error(`[${label}] state file ${file} ${problem}; starting from an empty state, the damaged file was moved to ${aside}`);
}

// ---------- small helpers for normalizers ----------

export const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * A field that should be an object of entries: missing → {} (older versions), not an object → {} and
 * reported, entries that fail `valid` dropped and reported (by count)
 */
export function recordField<V>(raw: Record<string, unknown>, field: string, valid: (v: unknown) => v is V, repaired: string[]): Record<string, V> {
  const value = raw[field];
  if (value === undefined) return {};
  if (!isRecord(value)) {
    repaired.push(field);
    return {};
  }
  const kept = Object.entries(value).filter(([, v]) => valid(v));
  if (kept.length < Object.keys(value).length) repaired.push(`${Object.keys(value).length - kept.length} entries of ${field}`);
  return Object.fromEntries(kept) as Record<string, V>;
}

/** Same for a field that should be an array */
export function arrayField<V>(raw: Record<string, unknown>, field: string, valid: (v: unknown) => v is V, repaired: string[]): V[] {
  const value = raw[field];
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    repaired.push(field);
    return [];
  }
  const kept = value.filter(valid);
  if (kept.length < value.length) repaired.push(`${value.length - kept.length} entries of ${field}`);
  return kept;
}
