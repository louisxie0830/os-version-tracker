import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { github as githubApi, githubIssuesConfig } from './alerts.js';
import { fetchText, fetchWithTimeout, NETWORK_TIMEOUT_MS } from './net.js';
import { LEGAL_PAGES } from './legal-pages.js';

/**
 * Weekly external link check (.github/workflows/links.yml): every outside link on the published page and its
 * legal documents (legal/) is
 * requested, and links that are gone (an HTTP error that persists on a retry, a host that no longer resolves
 * or can't be reached, or a redirect to a login page, as when the Android Developers Blog moved) are listed in one GitHub issue,
 * "[外部連結失效] 網站". The issue is updated while links stay broken and closed once none are.
 *
 * Sites that refuse automated requests (401 / 403 / 429, e.g. Stack Overflow) can't be judged and are
 * skipped, not reported.
 *
 * Usage: node dist/check-links.js <site URL or directory>   (ALERT_GITHUB_ISSUES=1 to sync the issue)
 */

export const ISSUE_TITLE = '[外部連結失效] 網站';
const CONCURRENCY = 8;
const TIMEOUT_MS = 20_000;
const BLOCKED = new Set([401, 403, 429, 999]);
const LOGIN = /\/(?:login|signin|sign-in|sso)\b|accounts\.google\.com|login\.microsoftonline\.com/i;
/** Links that need signing in by design (GitHub's private reporting form) */
const SIGN_IN_EXPECTED = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/security\/advisories\/new$/;

export interface PageLink {
  url: string;
  /** id of the page section the link first appears in */
  section: string;
}

export type LinkStatus =
  | { kind: 'ok' }
  | { kind: 'blocked'; status: number }
  | { kind: 'broken'; reason: string };

/** Outside links in the page, once each, with the section they first appear in */
export function extractLinks(html: string, own: string): PageLink[] {
  const links = new Map<string, string>();
  const sections = [...html.matchAll(/<(?:section|aside|header|footer)\b[^>]*\bid="([^"]+)"/g)].map(m => ({ at: m.index ?? 0, id: m[1] }));
  for (const m of html.matchAll(/<a\b[^>]*\bhref="(https?:\/\/[^"]+)"/g)) {
    const url = m[1].replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"');
    if (own && url.startsWith(own)) continue;
    if (links.has(url)) continue;
    const section = sections.filter(s => s.at < (m.index ?? 0)).at(-1)?.id ?? 'page';
    links.set(url, section);
  }
  return [...links].map(([url, section]) => ({ url, section }));
}

/** How a response or fetch error reads for a link checker */
export function classify(original: string, result: { status: number; finalUrl: string } | { error: string }): LinkStatus {
  if ('error' in result) {
    return { kind: 'broken', reason: `無法連線（${result.error}）` };
  }
  const { status, finalUrl } = result;
  if (BLOCKED.has(status)) return { kind: 'blocked', status };
  if (status >= 400) return { kind: 'broken', reason: `HTTP ${status}` };
  if (LOGIN.test(finalUrl) && !LOGIN.test(original) && !SIGN_IN_EXPECTED.test(original)) return { kind: 'broken', reason: `轉址到登入頁：${finalUrl}` };
  return { kind: 'ok' };
}

async function request(url: string): Promise<{ status: number; finalUrl: string } | { error: string }> {
  try {
    // No retry here: checkLinks already tries a failing link once more
    const res = await fetchWithTimeout(url, {
      redirect: 'follow',
      headers: { Accept: 'text/html,application/xhtml+xml,*/*;q=0.8', 'Accept-Language': 'zh-TW,en;q=0.8' },
    }, TIMEOUT_MS, 0);
    // Never leave a body unread (it would keep the process alive)
    await res.body?.cancel().catch(() => {});
    return { status: res.status, finalUrl: res.url || url };
  } catch (err) {
    // The most specific reason in the chain: a system code such as ENOTFOUND, else the innermost message
    let reason: string | undefined;
    for (let e = err as { code?: string; message?: string; cause?: unknown } | undefined; e; e = e.cause as typeof e) {
      if (e.code) { reason = e.code; break; }
      if (e.message) reason = e.message;
    }
    return { error: reason ?? String(err) };
  }
}

/** Checks each link; anything that isn't fine is tried once more (servers and networks hiccup) */
export async function checkLinks(links: PageLink[], fetchStatus = request): Promise<Array<PageLink & { status: LinkStatus }>> {
  const out: Array<PageLink & { status: LinkStatus }> = new Array(links.length);
  let next = 0;
  const worker = async () => {
    while (next < links.length) {
      const i = next++;
      let status = classify(links[i].url, await fetchStatus(links[i].url));
      if (status.kind === 'broken') status = classify(links[i].url, await fetchStatus(links[i].url));
      out[i] = { ...links[i], status };
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, links.length) }, worker));
  return out;
}

export function issueBody(broken: Array<PageLink & { status: LinkStatus }>, checked: number, runUrl?: string): string {
  const rows = broken.map(l => `| ${l.section} | ${l.url} | ${l.status.kind === 'broken' ? l.status.reason.replace(/\|/g, '\\|') : ''} |`);
  return [
    `每週的外部連結檢查發現 ${broken.length} 個失效連結（共檢查 ${checked} 個）。之後每次檢查都會更新這個 issue，全部正常後自動關閉。`,
    '',
    '| 區塊 | 連結 | 問題 |',
    '| --- | --- | --- |',
    ...rows,
    '',
    '來自官方來源的連結（新聞、閃退回報等）通常會在來源更新後自然換掉；固定寫在程式裡的連結（`src/` 內的 URL）需要手動更新。',
    ...(runUrl ? ['', `檢查紀錄：${runUrl}`] : []),
  ].join('\n');
}

/**
 * Opens, updates or closes the one link issue; stateless, so each weekly run decides from scratch. Any
 * failing GitHub call throws, so the run fails visibly rather than silently leaving a stale issue.
 */
export async function syncIssue(
  broken: Array<PageLink & { status: LinkStatus }>,
  checked: number,
  // For tests: the GitHub API and the settings
  deps: { github?: typeof githubApi; config?: ReturnType<typeof githubIssuesConfig> } = {},
): Promise<void> {
  const config = 'config' in deps ? deps.config : githubIssuesConfig();
  const github = deps.github ?? githubApi;
  if (!config) return;
  const { repo, token } = config;
  const runUrl = process.env.GITHUB_RUN_ID && process.env.GITHUB_SERVER_URL ? `${process.env.GITHUB_SERVER_URL}/${repo}/actions/runs/${process.env.GITHUB_RUN_ID}` : undefined;
  const list = await github(`/repos/${repo}/issues?state=open&per_page=100`, token);
  if (!list.ok) throw new Error(`listing issues: HTTP ${list.status}`);
  const open = (list.data as Array<{ number: number; title: string; pull_request?: unknown }>).find(i => !i.pull_request && i.title === ISSUE_TITLE);
  if (broken.length) {
    const body = issueBody(broken, checked, runUrl);
    const res = open
      ? await github(`/repos/${repo}/issues/${open.number}`, token, { method: 'PATCH', body: { body } })
      : await github(`/repos/${repo}/issues`, token, { method: 'POST', body: { title: ISSUE_TITLE, body } });
    if (!res.ok) throw new Error(`${open ? 'updating' : 'creating'} issue: HTTP ${res.status}`);
  } else if (open) {
    await github(`/repos/${repo}/issues/${open.number}/comments`, token, { method: 'POST', body: { body: `已恢復：${checked} 個外部連結都正常。${runUrl ? `\n\n${runUrl}` : ''}` } });
    const res = await github(`/repos/${repo}/issues/${open.number}`, token, { method: 'PATCH', body: { state: 'closed', state_reason: 'completed' } });
    if (!res.ok) throw new Error(`closing issue: HTTP ${res.status}`);
  }
}

async function main(target: string): Promise<void> {
  const own = (process.env.SITE_URL ?? (/^https?:/.test(target) ? target : '')).replace(/\/$/, '');
  // The page and the legal documents, whose terms and licence links matter as much as the page's
  const pages = ['index.html', ...LEGAL_PAGES.map(p => p.path)];
  // Reading the site itself: a time limit and a status check, so a site that's down fails the run quickly
  const read = async (page: string) => {
    if (!/^https?:/.test(target)) return readFile(path.join(target, page), 'utf8');
    const url = `${target.replace(/\/$/, '')}/${page.replace(/index\.html$/, '')}`;
    return fetchText(url, {}, NETWORK_TIMEOUT_MS, (status, where) => `${where}: HTTP ${status}`);
  };
  const seen = new Set<string>();
  const links: PageLink[] = [];
  for (const page of pages) {
    for (const link of extractLinks(await read(page), own)) {
      if (seen.has(link.url)) continue;
      seen.add(link.url);
      // Links in the legal documents are reported by document
      links.push(page === 'index.html' ? link : { ...link, section: page.replace(/index\.html$/, '') });
    }
  }
  if (!links.length) throw new Error('no links found: is this the right page?');
  const results = await checkLinks(links);
  const broken = results.filter(r => r.status.kind === 'broken');
  const blocked = results.filter(r => r.status.kind === 'blocked');
  console.log(`Checked ${results.length} links: ${results.length - broken.length - blocked.length} ok, ${blocked.length} refuse automated requests (skipped), ${broken.length} broken`);
  for (const b of broken) console.log(`  ✖ [${b.section}] ${b.url} – ${b.status.kind === 'broken' ? b.status.reason : ''}`);
  await syncIssue(broken, results.length);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main(process.argv[2] ?? process.env.SITE_URL ?? 'site').then(() => process.exit(0), err => {
    console.error(err);
    process.exit(1);
  });
}
