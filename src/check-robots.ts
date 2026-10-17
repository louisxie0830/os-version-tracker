import { mkdir, writeFile, appendFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { github as githubApi, githubIssuesConfig } from './alerts.js';
import { SOURCE_REGISTER, type SourceRecord } from './source-registry.js';
import type https from 'node:https';
import tls from 'node:tls';
import { USER_AGENT } from './net.js';
import { APPLE_ROOT_CA } from './fetchers/apple-root-ca.js';
import { boundedGet } from './https-get.js';

/**
 * Weekly robots.txt check of every endpoint in the source register (.github/workflows/links.yml).
 * Each run keeps a dated record: a JSON report and a snapshot of every robots.txt, uploaded as a workflow
 * artifact. An endpoint that robots.txt now disallows (or whose robots.txt can't be read) is listed in one
 * issue, unless the register discloses it as a deliberate exception (robotsException), "[robots.txt] 資料來源路徑被禁止", updated while it lasts and closed once it's clear again.
 *
 * Matching follows RFC 9309: the group for our user-agent token (else "*"), the longest matching rule wins,
 * "allow" wins a tie, "*" and "$" are supported; a missing robots.txt (4xx) allows everything, an unreachable
 * one (5xx / network error) is treated as disallowing everything.
 *
 * Usage: node dist/check-robots.js [outDir]   (ALERT_GITHUB_ISSUES=1 to sync the issue)
 */

export const ISSUE_TITLE = '[robots.txt] 資料來源路徑被禁止';
const PRODUCT_TOKEN = 'os-version-tracker';

interface Rule { allow: boolean; path: string }

/** The rules that apply to `token`: its own group(s) if any, otherwise those for "*" */
export function rulesFor(robots: string, token = PRODUCT_TOKEN): Rule[] {
  const groups: Array<{ agents: string[]; rules: Rule[] }> = [];
  let current: { agents: string[]; rules: Rule[] } | null = null;
  let lastWasAgent = false;
  for (const raw of robots.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    const m = line.match(/^([\w-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const field = m[1].toLowerCase();
    const value = m[2].trim();
    if (field === 'user-agent') {
      if (!current || !lastWasAgent) groups.push(current = { agents: [], rules: [] });
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else if ((field === 'allow' || field === 'disallow') && current) {
      // An empty Disallow allows everything: no rule
      if (value) current.rules.push({ allow: field === 'allow', path: value });
      lastWasAgent = false;
    } else {
      lastWasAgent = false;
    }
  }
  const own = groups.filter(g => g.agents.some(a => a !== '*' && token.toLowerCase().includes(a)));
  return (own.length ? own : groups.filter(g => g.agents.includes('*'))).flatMap(g => g.rules);
}

function matches(rulePath: string, urlPath: string): boolean {
  const anchored = rulePath.endsWith('$');
  const pattern = (anchored ? rulePath.slice(0, -1) : rulePath)
    .split('*').map(part => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*');
  return new RegExp(`^${pattern}${anchored ? '$' : ''}`).test(urlPath);
}

/** Whether `url` may be fetched under these rules: longest match wins, allow wins a tie */
export function isAllowed(rules: Rule[], url: string): boolean {
  const u = new URL(url);
  const target = u.pathname + u.search;
  let best: Rule | undefined;
  for (const rule of rules) {
    if (!matches(rule.path, target)) continue;
    const length = rule.path.replace(/[*$]/g, '').length;
    const bestLength = best?.path.replace(/[*$]/g, '').length ?? -1;
    if (length > bestLength || (length === bestLength && rule.allow && !best!.allow)) best = rule;
  }
  return best ? best.allow : true;
}

/** A concrete URL for an endpoint written as a template ("{repo}", "…"): the part before the placeholder */
export function concreteUrl(url: string): string {
  const cut = url.search(/[{…]/);
  return cut < 0 ? url : url.slice(0, cut);
}

export interface RobotsResult {
  source: string;
  url: string;
  host: string;
  /** robots.txt HTTP status, or 0 when it couldn't be fetched */
  robotsStatus: number;
  /** excepted: disallowed, but read on purpose and disclosed in the register */
  verdict: 'allowed' | 'disallowed' | 'excepted' | 'unreachable';
}

export async function checkRobots(register: Record<string, SourceRecord> = SOURCE_REGISTER, fetchRobots: (url: string) => Promise<RobotsFetch> = url => defaultFetch(url)): Promise<{ results: RobotsResult[]; snapshots: Map<string, RobotsFetch> }> {
  const endpoints = Object.entries(register).flatMap(([source, r]) => r.endpoints.map(e => ({ source, url: concreteUrl(e.url), exception: !!e.robotsException })));
  const hosts = [...new Set(endpoints.map(e => new URL(e.url).origin))];
  const snapshots = new Map<string, RobotsFetch>();
  await Promise.all(hosts.map(async origin => snapshots.set(origin, await fetchRobots(`${origin}/robots.txt`))));
  const results = endpoints.map(({ source, url, exception }) => {
    const origin = new URL(url).origin;
    const snap = snapshots.get(origin)!;
    const verdict: RobotsResult['verdict'] = snap.status === 0 || snap.status >= 500
      ? 'unreachable'
      : snap.status >= 400 || isAllowed(rulesFor(snap.body), url) ? 'allowed' : exception ? 'excepted' : 'disallowed';
    return { source, url, host: new URL(url).host, robotsStatus: snap.status, verdict };
  });
  return { results, snapshots };
}

// gdmf.apple.com chains to Apple's own root, which Node doesn't ship (as in fetchers/ios.ts)
const CA = [...tls.rootCertificates, APPLE_ROOT_CA];
/** One robots.txt, redirects included */
const ROBOTS_TIMEOUT_MS = 20_000;
/** RFC 9309 §2.5: parsers must handle at least 500 KiB; anything after the limit is ignored */
export const ROBOTS_MAX_BYTES = 512 * 1024;
/** RFC 9309 §2.3.1.2: follow at least five consecutive redirects */
export const MAX_ROBOTS_REDIRECTS = 5;

export interface RobotsFetch { status: number; body: string; error?: string }

/**
 * GET a robots.txt (see https-get.ts: one deadline for everything, a capped body). Redirects are followed up
 * to MAX_ROBOTS_REDIRECTS, each Location resolved against the current URL, and never to another scheme (no
 * downgrade from https); more redirects, a Location that isn't a URL, or a network error give status 0
 * (unreachable, reported for a look rather than assumed fine), with the reason in `error`.
 */
export async function defaultFetch(url: string, options: { get?: typeof https.get; timeoutMs?: number } = {}): Promise<RobotsFetch> {
  const deadline = Date.now() + (options.timeoutMs ?? ROBOTS_TIMEOUT_MS);
  let current = url;
  for (let redirects = 0; ; redirects++) {
    let res;
    try {
      res = await boundedGet(current, { headers: { 'User-Agent': USER_AGENT }, ca: CA, deadline, maxBytes: ROBOTS_MAX_BYTES, oversize: 'truncate', get: options.get });
    } catch (err) {
      const e = err as Error & { cause?: { code?: string } };
      return { status: 0, body: '', error: e.cause?.code ?? e.message };
    }
    const location = res.headers.location;
    if (res.status >= 300 && res.status < 400 && location) {
      if (redirects >= MAX_ROBOTS_REDIRECTS) return { status: 0, body: '', error: `more than ${MAX_ROBOTS_REDIRECTS} redirects` };
      let next: URL;
      try {
        next = new URL(location, current);
      } catch {
        return { status: 0, body: '', error: 'redirect to an invalid URL' };
      }
      // Never to another scheme: from https, no downgrade to http (or anything else)
      if (next.protocol !== new URL(url).protocol) return { status: 0, body: '', error: `redirect to another scheme (${next.protocol})` };
      current = next.href;
      continue;
    }
    return { status: res.status, body: res.body.toString('utf8') };
  }
}

export function summaryMarkdown(results: RobotsResult[], checkedAt: string): string {
  const problems = results.filter(r => r.verdict === 'disallowed' || r.verdict === 'unreachable');
  const excepted = results.filter(r => r.verdict === 'excepted');
  const label = { allowed: '✅ 未禁止', disallowed: '❌ 被禁止', excepted: '⚠️ 被禁止（已揭露的例外）', unreachable: '⚠️ 讀不到 robots.txt' } as const;
  return [
    '## robots.txt 檢查',
    '',
    `${checkedAt.slice(0, 10)} · ${results.length} 個端點 · ${problems.length ? `**${problems.length} 個有問題**` : '沒有新問題'}${excepted.length ? ` · ${excepted.length} 個已揭露的例外` : ''}`,
    '',
    '| 結果 | 來源 | 端點 | robots.txt |',
    '| --- | --- | --- | --- |',
    ...[...problems, ...excepted, ...results.filter(r => r.verdict === 'allowed')].map(r => `| ${label[r.verdict]} | \`${r.source}\` | \`${r.url}\` | ${r.robotsStatus || '無法連線'} |`),
    '',
  ].join('\n');
}

/** Opens, updates or closes the one robots.txt issue; a failing GitHub call throws (the run fails visibly) */
export async function syncIssue(
  problems: RobotsResult[],
  checkedAt: string,
  // For tests: the GitHub API and the settings
  deps: { github?: typeof githubApi; config?: ReturnType<typeof githubIssuesConfig> } = {},
): Promise<void> {
  const config = 'config' in deps ? deps.config : githubIssuesConfig();
  const github = deps.github ?? githubApi;
  if (!config) return;
  const { repo, token } = config;
  const list = await github(`/repos/${repo}/issues?state=open&per_page=100`, token);
  if (!list.ok) throw new Error(`listing issues: HTTP ${list.status}`);
  const open = (list.data as Array<{ number: number; title: string; pull_request?: unknown }>).find(i => !i.pull_request && i.title === ISSUE_TITLE);
  if (problems.length) {
    const body = [
      `${checkedAt.slice(0, 10)} 的每週檢查發現 ${problems.length} 個資料來源端點被 robots.txt 禁止，或讀不到 robots.txt。依 DISCLAIMER.md 第 3 節的承諾，被禁止的來源應停止擷取，並更新 src/source-registry.ts。`,
      '',
      '| 結果 | 來源 | 端點 |',
      '| --- | --- | --- |',
      ...problems.map(p => `| ${p.verdict === 'disallowed' ? '被禁止' : `讀不到 robots.txt（${p.robotsStatus || '無法連線'}）`} | \`${p.source}\` | \`${p.url}\` |`),
      '',
      '完整結果與 robots.txt 快照在該次執行的 artifact（robots-check）。',
    ].join('\n');
    const res = open
      ? await github(`/repos/${repo}/issues/${open.number}`, token, { method: 'PATCH', body: { body } })
      : await github(`/repos/${repo}/issues`, token, { method: 'POST', body: { title: ISSUE_TITLE, body } });
    if (!res.ok) throw new Error(`${open ? 'updating' : 'creating'} issue: HTTP ${res.status}`);
  } else if (open) {
    await github(`/repos/${repo}/issues/${open.number}/comments`, token, { method: 'POST', body: { body: `已恢復：${checkedAt.slice(0, 10)} 的檢查中，所有端點都未被 robots.txt 禁止。` } });
    const res = await github(`/repos/${repo}/issues/${open.number}`, token, { method: 'PATCH', body: { state: 'closed', state_reason: 'completed' } });
    if (!res.ok) throw new Error(`closing issue: HTTP ${res.status}`);
  }
}

async function main(outDir: string): Promise<void> {
  const checkedAt = new Date().toISOString();
  const { results, snapshots } = await checkRobots();
  // The dated record: results plus each robots.txt as it was
  await mkdir(path.join(outDir, 'snapshots'), { recursive: true });
  await writeFile(path.join(outDir, 'report.json'), JSON.stringify({ checkedAt, userAgent: USER_AGENT, results }, null, 2));
  for (const [origin, snap] of snapshots) {
    await writeFile(path.join(outDir, 'snapshots', `${new URL(origin).host}.txt`), `# ${origin}/robots.txt · HTTP ${snap.status || `unreachable${snap.error ? ` (${snap.error})` : ''}`} · ${checkedAt}\n${snap.body}`);
  }
  const summary = summaryMarkdown(results, checkedAt);
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, summary);
  const problems = results.filter(r => r.verdict === 'disallowed' || r.verdict === 'unreachable');
  console.log(`Checked ${results.length} endpoints on ${snapshots.size} hosts: ${problems.length} disallowed or unreachable, ${results.filter(r => r.verdict === 'excepted').length} disclosed exceptions`);
  for (const p of problems) console.log(`  ✖ [${p.source}] ${p.url} – ${p.verdict}`);
  await syncIssue(problems, checkedAt);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main(process.argv[2] ?? 'robots-check').then(() => process.exit(0), err => {
    console.error(err);
    process.exit(1);
  });
}
