/**
 * Builds the site as static files for GitHub Pages (run on a schedule by GitHub Actions):
 * index.html, api.json, calendar.ics, feed.xml and the PWA assets.
 *
 * Each run is a fresh process, so "first seen" times, undelivered notifications and alert streaks are
 * carried between runs in .state/. The workflow restores and saves that directory with the Actions cache
 * (saved even when a build fails, so a failure isn't re-announced every run); the copy published under
 * state/ on the site is a fallback for when the cache is empty.
 */
import { appendFile, copyFile, cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveOutputDir } from './output-dir.js';
import { buildIntoDirectory, requireFiles } from './publish-dir.js';
import { copyComponentScripts, SCRIPTS } from './asset-versions.js';
import { publishDecision } from './publish-health.js';
import { fetchText } from './net.js';
import { buildRunSummary } from './run-summary.js';
import { writeJsonAtomic } from './state-file.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Validated up front (before any network work), and again before the new site replaces it
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
const HISTORY_STATE = path.join(STATE_DIR, 'history.json');


// Must match the cron schedule in .github/workflows/pages.yml (twice a day)
const REFRESH_MINUTES = 12 * 60;

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
    const text = await fetchText(`${SITE_URL}/state/${name}`);
    JSON.parse(text); // only accept valid JSON
    return text;
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  // 1. Restore state from the previous run
  await mkdir(STATE_DIR, { recursive: true });
  const previousChanges = await loadState(CHANGES_STATE);
  if (previousChanges) await writeFile(CHANGES_STATE, previousChanges);
  process.env.CHANGES_STATE_FILE = CHANGES_STATE;
  // Bank app minimum versions and the last accepted core versions (history.ts reads it when it loads)
  const previousHistory = await loadState(HISTORY_STATE);
  if (previousHistory) await writeFile(HISTORY_STATE, previousHistory);
  process.env.HISTORY_STATE_FILE = HISTORY_STATE;

  // Imported only now: changes.ts reads CHANGES_STATE_FILE when it loads
  const alerts = await import('./alerts.js');
  const previousAlerts = await loadState(ALERTS_STATE);
  if (previousAlerts) alerts.importAlertState(JSON.parse(previousAlerts));

  const { fetchAllVersions, lastRefreshDiagnostics } = await import('./fetch-all.js');
  const { renderHTML } = await import('./render.js');
  const { PAGE_CSS } = await import('./render-styles.js');
  const { LEGAL_PAGES, renderLegalPage } = await import('./legal-pages.js');
  const { buildApiFiles, legacyApiJson } = await import('./api.js');
  const { buildCalendar } = await import('./calendar.js');
  const { buildAtomFeed, buildNotificationsJson, flushNotifications } = await import('./changes.js');

  // 2. Fetch everything (this also sends change notifications and source alerts)
  const data = await fetchAllVersions();
  await Promise.all([alerts.flushAlerts(), flushNotifications()]);
  // Persist before deciding whether to publish: a failed build must still remember what it alerted about
  // (changes.ts already wrote CHANGES_STATE, including any undelivered notifications)
  writeJsonAtomic(ALERTS_STATE, alerts.exportAlertState());

  // Refuse to publish when core or most sources failed (e.g. a network outage on the runner):
  // the previous deployment stays live instead of being replaced by an empty page.
  const decision = publishDecision(data.sources);
  console.log(`Sources: ${decision.healthy}/${decision.total} ok${decision.failed.length ? ` (failed: ${decision.failed.join(', ')})` : ''}`);
  // On GitHub Actions: a table of every source on the run's page (written before a refusal to publish, too)
  if (process.env.GITHUB_STEP_SUMMARY) {
    await appendFile(process.env.GITHUB_STEP_SUMMARY, buildRunSummary(data.sources, lastRefreshDiagnostics(), decision))
      .catch(err => console.warn(`[summary] could not write the run summary (${(err as Error).message})`));
  }
  if (!decision.publish) throw new Error(`Not publishing: ${decision.reason}`);

  // 3. Write the site into a staging directory next to OUT, check it, then put it in place of OUT
  // (publish-dir.ts): a build that fails while writing leaves the previous site complete
  await buildIntoDirectory(OUT, ROOT, async dir => {
    await mkdir(path.join(dir, 'state'), { recursive: true });
    await cp(path.join(ROOT, 'public'), dir, { recursive: true });
    // The component scripts are compiled from src/browser/ (dist/browser/), not kept in public/
    await copyComponentScripts(dir);

    await writeFile(path.join(dir, 'index.html'), renderHTML(data, { refreshMinutes: REFRESH_MINUTES }));
    await writeFile(path.join(dir, 'style.css'), PAGE_CSS);
    // The legal documents on the site itself (same domain as the page, not only on GitHub)
    for (const page of LEGAL_PAGES) {
      await mkdir(path.dirname(path.join(dir, page.path)), { recursive: true });
      await writeFile(path.join(dir, page.path), renderLegalPage(page, await readFile(path.join(ROOT, page.source), 'utf8')));
    }
    await writeFile(path.join(dir, 'api.json'), JSON.stringify(legacyApiJson(data, SITE_URL)));
    await mkdir(path.join(dir, 'api'), { recursive: true });
    for (const [file, body] of buildApiFiles(data, SITE_URL)) await writeFile(path.join(dir, file), body);
    await writeFile(path.join(dir, 'calendar.ics'), buildCalendar(data.timeline, SITE_URL));
    await writeFile(path.join(dir, 'feed.xml'), buildAtomFeed(data.tracked, SITE_URL, data.cachedAt));
    await writeFile(path.join(dir, 'notifications.json'), buildNotificationsJson(data.tracked, data.cachedAt));
    await writeFile(path.join(dir, 'health.json'), JSON.stringify({ status: 'ok', builtAt: data.cachedAt, sources: `${decision.healthy}/${decision.total}` }));
    // GitHub Pages runs Jekyll by default, which would skip files and folders starting with "_"
    await writeFile(path.join(dir, '.nojekyll'), '');

    await copyFile(CHANGES_STATE, path.join(dir, 'state', 'changes.json'));
    await copyFile(ALERTS_STATE, path.join(dir, 'state', 'alerts.json'));
    // Written on the first bank or version check; a run where both were skipped may not have it yet
    await copyFile(HISTORY_STATE, path.join(dir, 'state', 'history.json')).catch(() => {});
  }, { verify: dir => requireFiles(dir, ['index.html', 'style.css', ...SCRIPTS, 'sw.js', 'api.json', 'api/index.json', 'calendar.ics', 'feed.xml', 'health.json', 'state/changes.json', ...LEGAL_PAGES.map(p => p.path)]) });

  console.log(`Built ${OUT} for ${SITE_URL}`);
}

// Exit explicitly once done: a stray open handle (e.g. an unread HTTP response) must never keep a CI run
// waiting until its timeout. Everything main() starts is awaited before it resolves.
main().then(() => process.exit(0), err => {
  console.error(err);
  process.exit(1);
});
