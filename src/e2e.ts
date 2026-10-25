/**
 * Deterministic browser end-to-end test.
 *
 * It builds a temporary static site from the checked-in snapshot, loads the same compiled assets used in
 * production, and runs the page probe in a real Chrome browser. No live source, persistent state or deployed
 * site is involved, so pull requests exercise the UI without depending on the network.
 */
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildApiFiles, legacyApiJson } from './api.js';
import { copyComponentScripts, PUBLIC_DIR } from './asset-versions.js';
import { buildCalendar } from './calendar.js';
import { checkPage, formatResults, PAGES, THEMES, WIDTHS } from './check-page.js';
import { buildAtomFeed, buildNotificationsJson } from './changes.js';
import type { AllVersions } from './fetch-all.js';
import { LEGAL_PAGES, renderLegalPage } from './legal-pages.js';
import { renderHTML } from './render.js';
import { PAGE_CSS } from './render-styles.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURE = path.join(ROOT, 'test', 'fixtures', 'all-versions.json');
const SITE_URL = 'https://example.test/os-version-tracker';

/**
 * The historical snapshot predates three optional sections. Keep the production renderer unchanged while
 * giving its permanent navigation links real targets in this isolated browser fixture.
 */
export function completeFixturePage(html: string): string {
  const missing = [
    ['security', '資安'],
    ['frameworks', '跨平台框架'],
    ['news', '開發者新聞'],
  ].filter(([id]) => !html.includes(`id="${id}"`));
  if (!missing.length) return html;
  const sections = missing.map(([id, title]) => `<section class="panel" id="${id}"><h2>${title}</h2><p>End-to-end fixture</p></section>`).join('\n');
  return html.replace('</main>', `${sections}\n</main>`);
}

async function buildFixtureSite(dir: string): Promise<void> {
  const data = JSON.parse(await readFile(FIXTURE, 'utf8')) as AllVersions;
  await cp(PUBLIC_DIR, dir, { recursive: true });
  await copyComponentScripts(dir);

  await writeFile(path.join(dir, 'index.html'), completeFixturePage(renderHTML(data)));
  await writeFile(path.join(dir, 'style.css'), PAGE_CSS);
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
  await writeFile(path.join(dir, 'health.json'), JSON.stringify({ status: 'ok', builtAt: data.cachedAt }));
}

export async function runE2e(): Promise<void> {
  const dir = await mkdtemp(path.join(tmpdir(), 'os-version-tracker-e2e-'));
  try {
    await buildFixtureSite(dir);
    // A small pool is faster than serial execution without exhausting display/process resources on CI or macOS.
    const report = formatResults(await checkPage(dir, WIDTHS, THEMES, PAGES, { concurrency: 4 }));
    (report.ok ? console.log : console.error)(report.text);
    if (!report.ok) throw new Error('Browser end-to-end test failed');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  runE2e().catch(err => {
    console.error(err);
    process.exitCode = 1;
  });
}
