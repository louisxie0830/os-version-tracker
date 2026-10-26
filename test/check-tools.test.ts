import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkPage, runChrome } from '../src/check-page.ts';
import { checkLinks, classify, ISSUE_TITLE as LINKS_TITLE, syncIssue as syncLinksIssue, type LinkStatus, type PageLink } from '../src/check-links.ts';
import { checkRobots, ISSUE_TITLE as ROBOTS_TITLE, syncIssue as syncRobotsIssue, type RobotsResult } from '../src/check-robots.ts';
import { LEGAL_PAGES } from '../src/legal-pages.ts';

/**
 * The weekly and per-deploy checks (page, links, robots.txt) where they can fail in operation: the browser
 * hanging or reporting garbage, links that stay broken, robots.txt that can't be read, and the GitHub
 * issue calls failing.
 */

// ---------- check-page: the browser runs ----------

test('runChrome: a process that hangs is killed at the timeout; a missing binary is reported, not awaited forever', async () => {
  const started = Date.now();
  const hung = await runChrome(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], 150);
  assert.equal(hung.status, null, 'killed, no exit code');
  assert.ok(Date.now() - started < 3_000);
  const missing = await runChrome('/nonexistent/chrome', [], 1_000);
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /ENOENT/);
  const failing = await runChrome(process.execPath, ['-e', 'console.error("boom"); process.exit(3)'], 5_000);
  assert.equal(failing.status, 3);
  assert.match(failing.stderr, /boom/);
});

/** A site with the pages, and a fake browser answering per frame */
function fakeSite() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'ovt-checkpage-'));
  writeFileSync(path.join(dir, 'index.html'), '<html><head></head><body>x</body></html>');
  return dir;
}
const report = (extra: Record<string, unknown> = {}) => `<title>PAGE:${JSON.stringify({ width: 390, issues: {}, errors: [], localRefs: [], ...extra }).replace(/"/g, '&quot;')}</title>`;

test('checkPage: a garbled or missing probe report fails that run only; the rest keep their results', async () => {
  const site = fakeSite();
  try {
    const outputs = [
      { status: 0, stdout: report(), stderr: '' },
      { status: 0, stdout: '<title>PAGE:{not json</title>', stderr: '' },
      { status: 0, stdout: `<title>PAGE:${JSON.stringify({ hello: 1 }).replace(/"/g, '&quot;')}</title>`, stderr: '' },
      { status: 1, stdout: '', stderr: 'line one\nChrome crashed' },
    ];
    let i = 0;
    const results = await checkPage(site, [390, 1100], ['light', 'dark'], ['index.html'], { chrome: () => 'fake-chrome', run: async () => outputs[i++] });
    assert.equal(results.length, 4);
    const fatal = results.map(r => r.fatal);
    assert.equal(fatal.filter(Boolean).length, 3);
    assert.ok(fatal.includes('probe report unreadable (not JSON)'));
    assert.ok(fatal.includes('probe report unreadable (unexpected shape)'));
    assert.ok(fatal.includes('probe did not report (exit 1): Chrome crashed'));
    assert.equal(results.filter(r => !r.fatal).length, 1, 'the good run is still reported');
  } finally {
    rmSync(site, { recursive: true, force: true });
  }
});

test('checkPage: a run killed for hanging is tried again, each time with a fresh profile; hanging every time fails it', async () => {
  const site = fakeSite();
  try {
    const hung = { status: null, stdout: '', stderr: 'stalled', ended: 'timeout', ms: 90_000 };
    const profiles: string[] = [];
    const outputs = [hung, { status: 0, stdout: report(), stderr: '' }, hung, hung, hung];
    let i = 0;
    const results = await checkPage(site, [390, 1100], ['light'], ['index.html'], {
      chrome: () => 'fake',
      concurrency: 1,
      run: async (_chrome, args) => {
        profiles.push(args.find(a => a.startsWith('--user-data-dir='))!);
        return outputs[i++];
      },
    });
    assert.equal(i, 5, 'the first run took two attempts, the second all three');
    assert.equal(results[0].fatal, undefined, 'the retry reported');
    assert.equal(results[1].fatal, 'probe did not report (exit null, stalled: killed after 90s): stalled');
    assert.notEqual(profiles[0], profiles[1], 'the retry has its own profile');
  } finally {
    rmSync(site, { recursive: true, force: true });
  }
});

test('checkPage: browser concurrency can be capped for resource-constrained runners', async () => {
  const site = fakeSite();
  let active = 0;
  let peak = 0;
  try {
    const results = await checkPage(site, [390, 1100, 1440], ['light', 'dark'], ['index.html'], {
      chrome: () => 'fake',
      concurrency: 2,
      run: async () => {
        active++;
        peak = Math.max(peak, active);
        await new Promise(resolve => setTimeout(resolve, 5));
        active--;
        return { status: 0, stdout: report(), stderr: '' };
      },
    });
    assert.equal(results.length, 6);
    assert.equal(peak, 2);
  } finally {
    rmSync(site, { recursive: true, force: true });
  }
});

test('checkPage: missing local files are findings, and the probe files are removed even when a run throws', async () => {
  const site = fakeSite();
  try {
    const results = await checkPage(site, [390], ['light'], ['index.html'], { chrome: () => 'fake', run: async () => ({ status: 0, stdout: report({ localRefs: ['index.html', 'gone.js?v=1'] }), stderr: '' }) });
    assert.deepEqual(results[0].issues['link to a missing file'], ['gone.js?v=1']);
    assert.deepEqual(readdirSync(site), ['index.html'], 'probe page and frames cleaned up');

    await assert.rejects(checkPage(site, [390], ['light'], ['index.html'], { chrome: () => 'fake', run: async () => { throw new Error('spawn exploded'); } }), /spawn exploded/);
    assert.deepEqual(readdirSync(site), ['index.html'], 'cleaned up after a failure too: nothing extra gets deployed');
  } finally {
    rmSync(site, { recursive: true, force: true });
  }
});

// ---------- check-links ----------

test('checkLinks: a link still broken on the retry is reported; a login redirect stays broken; bot walls are not retried', async () => {
  const calls = new Map<string, number>();
  const links: PageLink[] = [
    { url: 'https://gone.example/', section: 'news' },
    { url: 'https://moved.example/blog', section: 'news' },
    { url: 'https://walled.example/', section: 'crashes' },
    { url: 'https://down.example/', section: 'docs' },
  ];
  const results = await checkLinks(links, async url => {
    calls.set(url, (calls.get(url) ?? 0) + 1);
    if (url.includes('gone')) return { status: 404, finalUrl: url };
    if (url.includes('moved')) return { status: 200, finalUrl: 'https://accounts.google.com/signin' };
    if (url.includes('walled')) return { status: 403, finalUrl: url };
    return { error: 'ENOTFOUND' };
  });
  const status = Object.fromEntries(results.map(r => [new URL(r.url).host, r.status]));
  assert.deepEqual(status['gone.example'], { kind: 'broken', reason: 'HTTP 404' });
  assert.equal(status['moved.example'].kind, 'broken');
  assert.match((status['moved.example'] as { reason: string }).reason, /登入頁/);
  assert.deepEqual(status['walled.example'], { kind: 'blocked', status: 403 });
  assert.deepEqual(status['down.example'], { kind: 'broken', reason: '無法連線（ENOTFOUND）' });
  assert.deepEqual(Object.fromEntries(calls), { 'https://gone.example/': 2, 'https://moved.example/blog': 2, 'https://walled.example/': 1, 'https://down.example/': 2 });
  assert.deepEqual(classify('https://x.example/', { status: 200, finalUrl: 'https://x.example/' }), { kind: 'ok' });
});

/** A fake GitHub API: answers by method and path, records every call */
function fakeGithub(answers: Record<string, { ok: boolean; status: number; data?: unknown }>) {
  const calls: string[] = [];
  const github = async (p: string, _token: string, init: { method?: string; body?: unknown } = {}) => {
    const key = `${init.method ?? 'GET'} ${p.replace(/\?.*$/, '')}`;
    calls.push(key);
    const answer = answers[key] ?? { ok: true, status: 200, data: null };
    return { ok: answer.ok, status: answer.status, data: answer.data ?? null };
  };
  return { github, calls };
}
const config = { repo: 'me/repo', token: 't' };
const broken: Array<PageLink & { status: LinkStatus }> = [{ url: 'https://gone.example/', section: 'news', status: { kind: 'broken', reason: 'HTTP 404' } }];
const LIST = 'GET /repos/me/repo/issues';

test('link issue: created when broken links appear, updated while open, closed with a comment once all are fine', async () => {
  const none = fakeGithub({ [LIST]: { ok: true, status: 200, data: [{ number: 9, title: LINKS_TITLE, pull_request: {} }] } });
  await syncLinksIssue(broken, 10, { github: none.github, config });
  assert.deepEqual(none.calls, [LIST, 'POST /repos/me/repo/issues'], 'a pull request with the same title is not the issue');

  const open = fakeGithub({ [LIST]: { ok: true, status: 200, data: [{ number: 7, title: LINKS_TITLE }] } });
  await syncLinksIssue(broken, 10, { github: open.github, config });
  assert.deepEqual(open.calls, [LIST, 'PATCH /repos/me/repo/issues/7']);

  const fixed = fakeGithub({ [LIST]: { ok: true, status: 200, data: [{ number: 7, title: LINKS_TITLE }] } });
  await syncLinksIssue([], 10, { github: fixed.github, config });
  assert.deepEqual(fixed.calls, [LIST, 'POST /repos/me/repo/issues/7/comments', 'PATCH /repos/me/repo/issues/7']);

  const quiet = fakeGithub({ [LIST]: { ok: true, status: 200, data: [] } });
  await syncLinksIssue([], 10, { github: quiet.github, config });
  assert.deepEqual(quiet.calls, [LIST], 'nothing open, nothing broken: no writes');

  const off = fakeGithub({});
  await syncLinksIssue(broken, 10, { github: off.github, config: null });
  assert.deepEqual(off.calls, [], 'issues not configured: no calls');
});

test('link issue: every failing GitHub call fails the run with what it was doing', async () => {
  await assert.rejects(syncLinksIssue(broken, 1, { github: fakeGithub({ [LIST]: { ok: false, status: 401 } }).github, config }), /listing issues: HTTP 401/);
  await assert.rejects(syncLinksIssue(broken, 1, { github: fakeGithub({ [LIST]: { ok: true, status: 200, data: [] }, 'POST /repos/me/repo/issues': { ok: false, status: 422 } }).github, config }), /creating issue: HTTP 422/);
  await assert.rejects(syncLinksIssue(broken, 1, { github: fakeGithub({ [LIST]: { ok: true, status: 200, data: [{ number: 7, title: LINKS_TITLE }] }, 'PATCH /repos/me/repo/issues/7': { ok: false, status: 500 } }).github, config }), /updating issue: HTTP 500/);
  await assert.rejects(syncLinksIssue([], 1, { github: fakeGithub({ [LIST]: { ok: true, status: 200, data: [{ number: 7, title: LINKS_TITLE }] }, 'PATCH /repos/me/repo/issues/7': { ok: false, status: 403 } }).github, config }), /closing issue: HTTP 403/);
});

test('check-links CLI: a page without links exits 1 with the reason on stderr', () => {
  const site = mkdtempSync(path.join(os.tmpdir(), 'ovt-links-'));
  try {
    writeFileSync(path.join(site, 'index.html'), '<html><body><a href="#local">x</a></body></html>');
    for (const page of LEGAL_PAGES) {
      mkdirSync(path.dirname(path.join(site, page.path)), { recursive: true });
      writeFileSync(path.join(site, page.path), '<p>no links</p>');
    }
    const run = spawnSync(process.execPath, ['--import', 'tsx', path.resolve('src/check-links.ts'), site], { encoding: 'utf8', env: { ...process.env, SITE_URL: '', ALERT_GITHUB_ISSUES: '' }, timeout: 30_000 });
    assert.equal(run.status, 1);
    assert.match(run.stderr, /no links found: is this the right page\?/);
  } finally {
    rmSync(site, { recursive: true, force: true });
  }
});

// ---------- check-robots ----------

const register = {
  a: { endpoints: [{ url: 'https://down.example/data.json' }, { url: 'https://busy.example/x' }, { url: 'https://loop.example/x' }, { url: 'https://mixed.example/private/x' }] },
} as never;

test('checkRobots: unreachable (network error, too many redirects), 5xx, and a rule conflict between groups', async () => {
  const robots: Record<string, { status: number; body: string; error?: string }> = {
    'https://down.example/robots.txt': { status: 0, body: '', error: 'ENOTFOUND' },
    'https://busy.example/robots.txt': { status: 503, body: '' },
    'https://loop.example/robots.txt': { status: 0, body: '', error: 'more than 5 redirects' },
    // Our own group allows what "*" forbids: our group wins
    'https://mixed.example/robots.txt': { status: 200, body: 'User-agent: *\nDisallow: /\n\nUser-agent: os-version-tracker\nAllow: /private/\nDisallow: /private/secret\n' },
  };
  const { results, snapshots } = await checkRobots(register, async url => robots[url]);
  const verdict = Object.fromEntries(results.map(r => [r.host, r.verdict]));
  assert.deepEqual(verdict, { 'down.example': 'unreachable', 'busy.example': 'unreachable', 'loop.example': 'unreachable', 'mixed.example': 'allowed' });
  assert.equal(snapshots.get('https://loop.example')?.error, 'more than 5 redirects', 'the reason is kept for the snapshot file');
});

test('robots issue: created, updated, closed; GitHub failures fail the run', async () => {
  const problems: RobotsResult[] = [{ source: 'a', url: 'https://down.example/data.json', host: 'down.example', robotsStatus: 0, verdict: 'unreachable' }];
  const create = fakeGithub({ [LIST]: { ok: true, status: 200, data: [] } });
  await syncRobotsIssue(problems, '2026-10-17T00:00:00Z', { github: create.github, config });
  assert.deepEqual(create.calls, [LIST, 'POST /repos/me/repo/issues']);
  const open = { [LIST]: { ok: true, status: 200, data: [{ number: 3, title: ROBOTS_TITLE }] } };
  const update = fakeGithub(open);
  await syncRobotsIssue(problems, '2026-10-17T00:00:00Z', { github: update.github, config });
  assert.deepEqual(update.calls, [LIST, 'PATCH /repos/me/repo/issues/3']);
  const close = fakeGithub(open);
  await syncRobotsIssue([], '2026-10-17T00:00:00Z', { github: close.github, config });
  assert.deepEqual(close.calls, [LIST, 'POST /repos/me/repo/issues/3/comments', 'PATCH /repos/me/repo/issues/3']);
  await assert.rejects(syncRobotsIssue(problems, 'x', { github: fakeGithub({ [LIST]: { ok: false, status: 500 } }).github, config }), /listing issues: HTTP 500/);
  await assert.rejects(syncRobotsIssue([], 'x', { github: fakeGithub({ ...open, 'PATCH /repos/me/repo/issues/3': { ok: false, status: 404 } }).github, config }), /closing issue: HTTP 404/);
  const off = fakeGithub({});
  await syncRobotsIssue(problems, 'x', { github: off.github, config: null });
  assert.deepEqual(off.calls, []);
});

test('runChrome tells a crash on a signal from a run killed for hanging', async () => {
  const crash = await runChrome(process.execPath, ['-e', "process.kill(process.pid, 'SIGTERM')"], 10_000);
  assert.equal(crash.status, null);
  assert.equal(crash.ended, 'SIGTERM');
  const stall = await runChrome(process.execPath, ['-e', 'setTimeout(() => {}, 60_000)'], 200);
  assert.equal(stall.ended, 'timeout');
  const fine = await runChrome(process.execPath, ['-e', "console.log('ok')"], 10_000);
  assert.deepEqual([fine.status, fine.stdout.trim(), fine.ended], [0, 'ok', undefined]);
});
