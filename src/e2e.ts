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
import { PUBLIC_DIR, writeAppScript } from './asset-versions.js';
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

async function buildFixtureSite(dir: string): Promise<void> {
  const data = JSON.parse(await readFile(FIXTURE, 'utf8')) as AllVersions;
  // Exercise the real news-list component, including its 25-row cap and every filter, with no network input.
  data.devNews = Array.from({ length: 26 }, (_, i) => ({
    id: `e2e-news-${i}`,
    source: 'E2E official feed',
    platform: i % 3 === 0 ? 'iOS' : i % 3 === 1 ? 'Android' : '跨平台',
    category: i % 2 ? 'release' : 'announcement',
    title: `E2E release ${i}`,
    url: `https://example.com/news/${i}`,
    date: '2026-10-25',
    important: i === 0,
  }));
  // Exercise the trend charts (chart-switch, line-chart and its tooltip), which the snapshot predates
  const months = ['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10'];
  const trend = (names: string[]) => ({
    months,
    series: names.map((version, i) => ({ version, shares: months.map((_, m) => Math.max(1, 50 - i * 15 + (i ? -m : m * 2))) })),
    url: 'https://gs.statcounter.com/',
  });
  if (data.osShare) {
    data.osShare.trend = { ios: { TW: trend(['26', '18', '17']), ww: trend(['26', '18']) }, android: { TW: trend(['16', '15', '14']) } };
    data.osShare.vendor = { TW: trend(['Apple', 'Samsung', 'Xiaomi']), ww: trend(['Apple', 'Samsung']) };
  }
  data.bankTrend = [{ date: '2026-10-15', iOS: { '15': 3, '16': 1 }, Android: { '9': 2, '10': 2 } }, { date: '2026-10-16', iOS: { '15': 2, '16': 2 }, Android: { '9': 1, '10': 3 } }];
  await cp(PUBLIC_DIR, dir, { recursive: true });
  await writeAppScript(dir);

  await writeFile(path.join(dir, 'index.html'), renderHTML(data));
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
