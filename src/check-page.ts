/**
 * Page check for the built site: loads index.html in headless Chrome at phone, tablet and desktop widths,
 * in light and dark, and runs scripts/page-probe.js in it. The probe reports:
 *
 * - layout: anything past the right edge (outside intentional horizontal scrollers), all sections expanded
 * - clicks: controls covered by another element; links that catch clicks outside their own row or card
 * - behaviour: script errors; every filter, sort, button, search and the theme toggle exercised
 * - structure: duplicate ids, broken anchors and id references, controls without a name
 * - text contrast below WCAG AA
 *
 * and this side checks that every local file the page references exists. Exits 1 on any finding.
 *
 * Usage: node dist/check-page.js [siteDir]   (CHROME_PATH overrides the browser)
 *
 * Headless Chrome won't make a window narrower than ~500px, so each run is a same-origin iframe; the
 * probe reports back through the parent page's title, read from --dump-dom.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { availableParallelism, tmpdir } from 'node:os';
import { LEGAL_PAGES } from './legal-pages.js';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const WIDTHS = [390, 1100, 1440];
export const THEMES = ['light', 'dark'] as const;
const PROBE_PAGE = '__page-probe.html';
const frameName = (width: number, theme: string) => `__page-frame-${width}-${theme}.html`;
/** The main page and the legal documents published next to it */
export const PAGES = ['index.html', ...LEGAL_PAGES.map(p => p.path)];
// Works from both src/ (tsx) and dist/ (compiled)
const PROBE_SCRIPT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'page-probe.js');

function findChrome(): string {
  const candidates = [
    process.env.CHROME_PATH,
    'google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ].filter((c): c is string => !!c);
  for (const c of candidates) {
    if (spawnSync(c, ['--version'], { encoding: 'utf8' }).status === 0) return c;
  }
  throw new Error('Chrome not found; set CHROME_PATH');
}

export interface PageResult {
  /** Path under the site root, e.g. "index.html" or "legal/index.html" */
  page?: string;
  width: number;
  theme: string;
  issues: Record<string, string[]>;
  errors: string[];
  localRefs?: string[];
  fatal?: string;
}

/** The probe copy drops the page's CSP (it forbids the inline probe) and runs the probe before anything else */
export function probePage(html: string, probe: string): string {
  const withoutCsp = html.replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/, '');
  const tag = `<script>${probe}</script>`;
  return /<head>/i.test(withoutCsp) ? withoutCsp.replace(/<head>/i, `<head>${tag}`) : tag + withoutCsp;
}

/** Local files the page links to that the site doesn't have */
export function missingRefs(siteDir: string, refs: string[]): string[] {
  return refs.filter(ref => {
    const file = decodeURIComponent(ref.split(/[?#]/)[0]);
    if (file === '' || file === './' || file === '.') return false;
    return !existsSync(path.join(siteDir, file));
  });
}

/** Runs Chrome and collects its output; a run that hangs is killed after `timeoutMs` */
export function runChrome(chrome: string, args: string[], timeoutMs: number): Promise<{ status: number | null; stdout: string; stderr: string }> {
  return new Promise(resolve => {
    const child = spawn(chrome, args);
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk; });
    child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk; });
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.on('error', err => { stderr += String(err); });
    child.on('close', status => {
      clearTimeout(timer);
      resolve({ status, stdout, stderr });
    });
  });
}

/**
 * Every page × width × theme in parallel (as many at once as there are CPUs): each Chrome gets its own
 * profile directory, since two instances can't share one. The probe copy and the frames sit next to each
 * page, so its relative links resolve as they do on the site.
 */
export async function checkPage(
  siteDir: string,
  widths = WIDTHS,
  themes: readonly string[] = THEMES,
  pages = PAGES,
  // For tests: the browser and how it's run
  deps: { chrome?: () => string; run?: typeof runChrome } = {},
): Promise<PageResult[]> {
  const chrome = (deps.chrome ?? findChrome)();
  const run = deps.run ?? runChrome;
  const root = path.resolve(siteDir);
  const present = pages.filter(p => existsSync(path.join(root, p)));
  const runs = present.flatMap(page => widths.flatMap(width => themes.map(theme => ({ page, width, theme }))));
  const files = present.flatMap(page => [PROBE_PAGE, ...widths.flatMap(w => themes.map(t => frameName(w, t)))].map(f => path.join(root, path.dirname(page), f)));
  const profiles = mkdtempSync(path.join(tmpdir(), 'check-page-'));
  const probe = readFileSync(PROBE_SCRIPT, 'utf8');
  for (const page of present) writeFileSync(path.join(root, path.dirname(page), PROBE_PAGE), probePage(readFileSync(path.join(root, page), 'utf8'), probe));

  const check = async ({ page, width, theme }: { page: string; width: number; theme: string }): Promise<PageResult> => {
    const dir = path.join(root, path.dirname(page));
    writeFileSync(path.join(dir, frameName(width, theme)),
      `<!doctype html><title>pending</title><body style="margin:0"><iframe src="${PROBE_PAGE}?theme=${theme}" style="width:${width}px;height:900px;border:0"></iframe>`);
    const out = await run(chrome, [
      '--headless=new', '--disable-gpu', '--hide-scrollbars', '--allow-file-access-from-files',
      `--user-data-dir=${path.join(profiles, `${page.replace(/\W/g, '_')}-${width}-${theme}`)}`,
      // Ubuntu 24.04 runners block the sandbox's user namespaces
      ...(process.env.CI ? ['--no-sandbox'] : []),
      `--window-size=${width + 60},1000`, '--virtual-time-budget=120000', '--dump-dom',
      pathToFileURL(path.join(dir, frameName(width, theme))).href,
    ], 300_000);
    const title = out.stdout.match(/<title>PAGE:([^<]*)<\/title>/)?.[1];
    if (!title) {
      return { page, width, theme, issues: {}, errors: [], fatal: `probe did not report (exit ${out.status}): ${out.stderr.trim().split('\n').at(-1) ?? ''}` };
    }
    let report: Omit<PageResult, 'theme'>;
    try {
      report = JSON.parse(title.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'));
      if (typeof report !== 'object' || report === null || typeof report.issues !== 'object' || report.issues === null || !Array.isArray(report.errors)) throw new Error('unexpected shape');
    } catch (err) {
      // One garbled report is this run's failure, not a reason to lose every other run's results
      return { page, width, theme, issues: {}, errors: [], fatal: `probe report unreadable (${(err as Error).name === 'SyntaxError' ? 'not JSON' : (err as Error).message})` };
    }
    const missing = missingRefs(dir, report.localRefs ?? []);
    if (missing.length) report.issues['link to a missing file'] = missing;
    return { ...report, page, width, theme };
  };

  try {
    const results: PageResult[] = new Array(runs.length);
    let next = 0;
    const worker = async () => {
      while (next < runs.length) {
        const i = next++;
        results[i] = await check(runs[i]);
      }
    };
    await Promise.all(Array.from({ length: Math.min(runs.length, Math.max(2, availableParallelism())) }, worker));
    return results;
  } finally {
    // Never leave the probe files in the site that gets deployed
    for (const f of files) rmSync(f, { force: true });
    rmSync(profiles, { recursive: true, force: true });
  }
}

/** Plain-text report, one block per page, width and theme */
const label = (r: PageResult) => `${r.page && r.page !== 'index.html' ? `${r.page} ` : ''}${r.width}px ${r.theme}`;

export function formatResults(results: PageResult[]): { ok: boolean; text: string } {
  const lines: string[] = [];
  let ok = true;
  for (const r of results) {
    const findings = Object.entries(r.issues).filter(([, list]) => list.length);
    if (r.errors.length) findings.unshift(['script errors', r.errors]);
    if (r.fatal) findings.unshift(['probe failed', [r.fatal]]);
    if (!findings.length) {
      lines.push(`✔ ${label(r)}: no findings`);
      continue;
    }
    ok = false;
    lines.push(`✖ ${label(r)}:`);
    for (const [kind, list] of findings) lines.push(`  ${kind}:`, ...list.map(item => `    ${item}`));
  }
  return { ok, text: lines.join('\n') };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  checkPage(process.argv[2] ?? 'site').then(results => {
    const { ok, text } = formatResults(results);
    (ok ? console.log : console.error)(text);
    process.exit(ok ? 0 : 1);
  }, err => {
    console.error(err);
    process.exit(1);
  });
}
