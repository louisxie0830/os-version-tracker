import path from 'node:path';
import { isRecord } from './state-file.js';

/**
 * Restoring the state carried between static builds (build-static.ts): from the Actions cache, else from the
 * copy published on the live site, and refusing to start over silently when a live site's state is lost.
 * Everything it touches comes in as `deps`, so tests run it without files, network or environment.
 */
export interface RestoreDeps {
  readFile: (file: string) => Promise<string>;
  fetchText: (url: string) => Promise<string>;
  siteUrl: string;
  /** ALLOW_NEW_BASELINE=1 starts over on purpose */
  allowNewBaseline: boolean;
  log: (line: string) => void;
}

/** What a state file must at least be to count as restored: an object (changes.json also needs its seen list) */
export function usableState(name: string, value: unknown): boolean {
  if (!isRecord(value)) return false;
  return name === 'changes.json' ? isRecord(value.seen) : true;
}

function parseUsable(name: string, text: string): string | null {
  try {
    return usableState(name, JSON.parse(text)) ? text : null;
  } catch {
    return null;
  }
}

/**
 * The state file's text from the Actions cache if present and usable, otherwise from the live site; null
 * (with a warning on the run's page) when neither has a usable copy. A cached `null` or `[]` counts as
 * missing: read as state it would quietly become an empty first run.
 */
export async function loadState(file: string, deps: RestoreDeps): Promise<string | null> {
  const name = path.basename(file);
  const cached = await deps.readFile(file).then(text => parseUsable(name, text), () => null);
  if (cached) return cached;
  const downloaded = await deps.fetchText(`${deps.siteUrl}/state/${name}`).then(text => parseUsable(name, text), () => null);
  // ::warning:: shows on the run's page, not only in the log
  deps.log(downloaded ? `::warning::${name} was not in the Actions cache; restored from the live site` : `::warning::${name} is in neither the Actions cache nor the live site`);
  return downloaded;
}

/**
 * Starting over without the state loses every "first seen" time (no notifications that run, the feed's
 * dates reset) and years of bank history that can't be fetched again. That's right for the very first build,
 * and wrong when a site is already live and its state just couldn't be read: then the build stops (the live
 * site stays) unless allowNewBaseline says to start over on purpose. Only a 404 for the site's health.json
 * means there is no site yet; any other failure (a 503, a dropped connection) can't tell, so it stops too.
 */
export async function refuseNewBaseline(missing: string[], deps: RestoreDeps): Promise<void> {
  if (!missing.length) return;
  if (deps.allowNewBaseline) {
    deps.log(`::warning::Starting a new baseline without ${missing.join(', ')} (ALLOW_NEW_BASELINE=1)`);
    return;
  }
  const site = await deps.fetchText(`${deps.siteUrl}/health.json`).then(
    () => 'live' as const,
    (err: unknown) => (/\bHTTP 404\b/.test(String((err as Error)?.message ?? err)) ? 'none' as const : 'unknown' as const),
  );
  if (site === 'none') {
    deps.log(`No live site at ${deps.siteUrl} yet: first build, starting a new baseline`);
    return;
  }
  throw new Error(`State ${missing.join(', ')} could not be restored while ${deps.siteUrl} ${site === 'live' ? 'is live' : 'may be live (it could not be reached)'}: not starting over. `
    + 'Re-run later, or run the workflow with "new baseline" to start over on purpose.');
}
