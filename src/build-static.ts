/**
 * Builds the site as static files for GitHub Pages (run on a schedule by GitHub Actions):
 * index.html, api.json, calendar.ics, feed.xml, the PWA assets and the in-browser checker.
 *
 * Each run is a fresh process, so "first seen" times, undelivered notifications and alert streaks are
 * carried between runs in .state/. The workflow restores and saves that directory with the Actions cache
 * (saved even when a build fails, so a failure isn't re-announced every run); the copy published under
 * state/ on the site is a fallback for when the cache is empty.
 */
import { copyFile, cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BUILD_MARKER, resolveOutputDir } from './output-dir.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
// Validated up front (before any network work): the directory is deleted and recreated below
let OUT: string;
try {
  OUT = resolveOutputDir(process.env.OUT_DIR ?? path.join(ROOT, 'site'), ROOT);
} catch (err) {
  console.error((err as Error).message);
  process.exit(1);
}
const STATE_DIR = path.join(ROOT, '.state');
const CHANGES_STATE = path.join(STATE_DIR, 'changes.json');
const ALERTS_STATE = path.join(STATE_DIR, 'alerts.json');

// Refuse to publish when most sources failed (e.g. a network outage on the runner):
// the previous deployment stays live instead of being replaced by an empty page.
const MIN_HEALTHY_SOURCES = 0.6;

// Must match the cron schedule in .github/workflows/pages.yml
const REFRESH_MINUTES = 30;

const SITE_URL = (process.env.SITE_URL ?? '').replace(/\/$/, '');
if (!SITE_URL) {
  console.error('SITE_URL is required, e.g. https://<user>.github.io/<repo>');
  process.exit(1);
}

/** State from the Actions cache if present, otherwise from the live site */
async function loadState(file: string): Promise<string | null> {
  try {
    const text = await readFile(file, 'utf8');
    JSON.parse(text);
    return text;
  } catch {
    return downloadState(path.basename(file));
  }
}

async function downloadState(name: string): Promise<string | null> {
  try {
    const res = await fetch(`${SITE_URL}/state/${name}`, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return null;
    const text = await res.text();
    JSON.parse(text); // only accept valid JSON
    return text;
  } catch {
    return null;
  }
}

/**
 * Copies a compiled ES module and everything it imports into the site, preserving relative paths.
 * Fails the build if anything in the graph needs Node, since it has to run in the browser.
 */
async function copyBrowserModules(entry: string): Promise<string[]> {
  const seen = new Set<string>();
  const queue = [path.join(DIST, entry)];
  while (queue.length) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const code = await readFile(file, 'utf8');
    for (const m of code.matchAll(/(?:import|export)[^'"]*?from\s*['"]([^'"]+)['"]|import\s*['"]([^'"]+)['"]/g)) {
      const spec = m[1] ?? m[2];
      if (!spec.startsWith('.')) {
        throw new Error(`${path.relative(DIST, file)} imports "${spec}", which can't run in the browser`);
      }
      queue.push(path.resolve(path.dirname(file), spec));
    }
  }
  for (const file of seen) {
    const target = path.join(OUT, 'js', path.relative(DIST, file));
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(file, target);
  }
  return [...seen].map(f => path.relative(DIST, f));
}

async function main(): Promise<void> {
  // 1. Restore state from the previous run
  await mkdir(STATE_DIR, { recursive: true });
  const previousChanges = await loadState(CHANGES_STATE);
  if (previousChanges) await writeFile(CHANGES_STATE, previousChanges);
  process.env.CHANGES_STATE_FILE = CHANGES_STATE;

  // Imported only now: changes.ts reads CHANGES_STATE_FILE when it loads
  const alerts = await import('./alerts.js');
  const previousAlerts = await loadState(ALERTS_STATE);
  if (previousAlerts) alerts.importAlertState(JSON.parse(previousAlerts));

  const { fetchAllVersions } = await import('./fetch-all.js');
  const { renderHTML } = await import('./render.js');
  const { buildCalendar } = await import('./calendar.js');
  const { buildAtomFeed, buildNotificationsJson, flushNotifications } = await import('./changes.js');

  // 2. Fetch everything (this also sends change notifications and source alerts)
  const data = await fetchAllVersions();
  await Promise.all([alerts.flushAlerts(), flushNotifications()]);
  // Persist before deciding whether to publish: a failed build must still remember what it alerted about
  // (changes.ts already wrote CHANGES_STATE, including any undelivered notifications)
  await writeFile(ALERTS_STATE, JSON.stringify(alerts.exportAlertState()));

  const sources = Object.entries(data.sources);
  const healthy = sources.filter(([, s]) => s.ok).length;
  console.log(`Sources: ${healthy}/${sources.length} ok${healthy < sources.length ? ` (failed: ${sources.filter(([, s]) => !s.ok).map(([k]) => k).join(', ')})` : ''}`);
  if (healthy / sources.length < MIN_HEALTHY_SOURCES) {
    throw new Error(`Only ${healthy}/${sources.length} sources succeeded; not publishing`);
  }

  // 3. Write the site
  // Re-check right before deleting: the directory may have changed while sources were fetched
  resolveOutputDir(OUT, ROOT);
  await rm(OUT, { recursive: true, force: true });
  await mkdir(path.join(OUT, 'state'), { recursive: true });
  // Marks the directory as ours, so a later build may safely replace it
  await writeFile(path.join(OUT, BUILD_MARKER), 'Generated by os-version-tracker build-static; safe to delete.\n');
  await cp(path.join(ROOT, 'public'), OUT, { recursive: true });

  await writeFile(path.join(OUT, 'index.html'), renderHTML(data, null, { staticSite: true, refreshMinutes: REFRESH_MINUTES }));
  await writeFile(path.join(OUT, 'api.json'), JSON.stringify(data));
  await writeFile(path.join(OUT, 'calendar.ics'), buildCalendar(data.timeline, SITE_URL));
  await writeFile(path.join(OUT, 'feed.xml'), buildAtomFeed(data.tracked, SITE_URL, data.cachedAt));
  await writeFile(path.join(OUT, 'notifications.json'), buildNotificationsJson(data.tracked, data.cachedAt));
  await writeFile(path.join(OUT, 'health.json'), JSON.stringify({ status: 'ok', builtAt: data.cachedAt, sources: `${healthy}/${sources.length}` }));
  await writeFile(path.join(OUT, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${SITE_URL}/</loc><lastmod>${data.cachedAt}</lastmod><changefreq>hourly</changefreq></url>
</urlset>
`);
  // GitHub Pages runs Jekyll by default, which would skip files and folders starting with "_"
  await writeFile(path.join(OUT, '.nojekyll'), '');

  const modules = await copyBrowserModules('client/checker-client.js');
  console.log(`Browser modules: ${modules.join(', ')}`);

  await copyFile(CHANGES_STATE, path.join(OUT, 'state', 'changes.json'));
  await copyFile(ALERTS_STATE, path.join(OUT, 'state', 'alerts.json'));

  console.log(`Built ${OUT} for ${SITE_URL}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
