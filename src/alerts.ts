import { USER_AGENT, WEBHOOK_TIMEOUT_MS } from './net.js';
/**
 * Source health alerting. Every refresh reports each scraped source's outcome; failures are logged,
 * and on transitions (the first failure of a streak, and a recovery once the source works again):
 * - when ALERT_WEBHOOK_URL is set, a Slack-compatible `{ "text": ... }` message is POSTed;
 * - when ALERT_GITHUB_ISSUES=1 (with GITHUB_TOKEN and GITHUB_REPOSITORY, as in GitHub Actions), an issue is
 *   opened for the failing source and closed with a comment once it recovers. GitHub emails the repo's
 *   watchers, so this needs no extra service.
 *
 * Data quality problems (a source that worked but came back incomplete, see quality.ts) go through the same
 * channels as their own alert, "quality:<source>", with an issue titled [資料不完整].
 */

type AlertKind = 'source' | 'quality';

interface SourceState {
  ok: boolean;
  /** When the current ok/failing streak started */
  since: string;
  /** Consecutive failures in the current streak */
  failures: number;
  /** Last state the webhook was successfully told about; undefined until the first report */
  notifiedOk?: boolean;
  /** Same, for the GitHub issue */
  issueNotifiedOk?: boolean;
}

const states = new Map<string, SourceState>();


/** For tests: forget all remembered source states */
export function resetAlertState(): void {
  states.clear();
}

/** Snapshot of every source's state, so a one-shot build (the static site) can carry it to the next run */
export function exportAlertState(): Record<string, SourceState> {
  return Object.fromEntries(states);
}

const isAlertState = (v: unknown): v is SourceState => typeof v === 'object' && v !== null && !Array.isArray(v)
  && typeof (v as SourceState).ok === 'boolean'
  && typeof (v as SourceState).since === 'string'
  && Number.isFinite((v as SourceState).failures) && (v as SourceState).failures >= 0
  && ['notifiedOk', 'issueNotifiedOk'].every(k => (v as Record<string, unknown>)[k] === undefined || typeof (v as Record<string, unknown>)[k] === 'boolean');

/**
 * Restores the alert streaks saved by the previous run. Entries of the wrong shape are skipped (that source
 * simply starts a new streak) and counted in a warning; a file that isn't an object at all is ignored.
 * Nothing from the file itself is logged.
 */
export function importAlertState(saved: unknown): void {
  if (typeof saved !== 'object' || saved === null || Array.isArray(saved)) {
    console.warn('[alerts] saved alert state is not an object; starting without previous alert streaks');
    return;
  }
  let skipped = 0;
  for (const [key, state] of Object.entries(saved)) {
    if (isAlertState(state)) states.set(key, state);
    else skipped++;
  }
  if (skipped) console.warn(`[alerts] skipped ${skipped} saved alert state entr${skipped === 1 ? 'y' : 'ies'} of the wrong shape`);
}

const inFlight = new Set<Promise<void>>();

/** Resolves once every report started so far (including webhook calls) has finished */
export async function flushAlerts(): Promise<void> {
  await Promise.all([...inFlight]);
}

async function postWebhook(url: string, text: string): Promise<boolean> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': USER_AGENT },
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
    });
    // Read the body so the connection closes (an unread body keeps the process alive)
    await res.text().catch(() => '');
    if (!res.ok) {
      console.error(`[alerts] webhook responded ${res.status}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error(`[alerts] webhook failed (${(err as Error)?.message ?? err})`);
    return false;
  }
}

const ISSUE_TITLE_PREFIX: Record<AlertKind, string> = { source: '[資料來源失敗] ', quality: '[資料不完整] ' };
const QUALITY_PREFIX = 'quality:';
const kindOf = (key: string): AlertKind => (key.startsWith(QUALITY_PREFIX) ? 'quality' : 'source');
const sourceOf = (key: string) => key.replace(QUALITY_PREFIX, '');

export function githubIssuesConfig(): { repo: string; token: string } | null {
  const repo = process.env.GITHUB_REPOSITORY;
  const token = process.env.GITHUB_TOKEN;
  return process.env.ALERT_GITHUB_ISSUES === '1' && repo && token && /^[\w.-]+\/[\w.-]+$/.test(repo) ? { repo, token } : null;
}

/**
 * A GitHub API call whose body is always read: an unread fetch body keeps its connection, and with it the
 * Node process, alive (a one-shot build would then never exit).
 */
export async function github(path: string, token: string, init: { method?: string; body?: unknown } = {}): Promise<{ ok: boolean; status: number; data: unknown }> {
  const res = await fetch(`https://api.github.com${path}`, {
    method: init.method ?? 'GET',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'User-Agent': USER_AGENT,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
    signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
  });
  const text = await res.text();
  let data: unknown = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
  return { ok: res.ok, status: res.status, data };
}

/**
 * Opens an issue for a failing source, or comments on and closes the open one when it recovers.
 * Idempotent: an already open issue is reused, so a retry never duplicates it.
 */
async function syncGithubIssue(key: string, ok: boolean, detail: string | undefined, since: string | undefined): Promise<boolean> {
  const config = githubIssuesConfig();
  if (!config) return true;
  const { repo, token } = config;
  const kind = kindOf(key);
  const title = `${ISSUE_TITLE_PREFIX[kind]}${sourceOf(key)}`;
  try {
    const list = await github(`/repos/${repo}/issues?state=open&per_page=100`, token);
    if (!list.ok) throw new Error(`listing issues: HTTP ${list.status}`);
    const open = (list.data as Array<{ number: number; title: string; pull_request?: unknown }>)
      .find(i => !i.pull_request && i.title === title);
    const runUrl = process.env.GITHUB_RUN_ID && process.env.GITHUB_SERVER_URL
      ? `${process.env.GITHUB_SERVER_URL}/${repo}/actions/runs/${process.env.GITHUB_RUN_ID}`
      : undefined;

    if (!ok) {
      if (open) return true;
      const res = await github(`/repos/${repo}/issues`, token, { method: 'POST', body: {
        title,
        body: (kind === 'quality' ? [
          `資料來源 \`${sourceOf(key)}\` 抓取成功，但資料不完整；網站照常更新，只是缺了下面這些內容。恢復後這個 issue 會自動關閉。`,
          '',
          ...(detail ?? 'unknown problem').split('\n').map(line => `- ${line}`),
          `- 開始時間：${since ?? new Date().toISOString()}`,
          ...(runUrl ? [`- 建置紀錄：${runUrl}`] : []),
          '',
          '常見原因是來源網站改了資料格式，對應 `src/fetchers/` 的解析程式只讀到一部分。',
        ] : [
          `資料來源 \`${key}\` 抓取或解析失敗，網站上這一塊會暫時缺資料或維持舊資料；恢復後這個 issue 會自動關閉。`,
          '',
          `- 錯誤：${detail ?? 'unknown error'}`,
          `- 開始時間：${since ?? new Date().toISOString()}`,
          ...(runUrl ? [`- 建置紀錄：${runUrl}`] : []),
          '',
          '常見原因是來源網站改版，需要更新對應 `src/fetchers/` 的解析程式。',
        ]).join('\n'),
      } });
      if (!res.ok) throw new Error(`creating issue: HTTP ${res.status}`);
      return true;
    }

    if (!open) return true;
    await github(`/repos/${repo}/issues/${open.number}/comments`, token, { method: 'POST', body: { body: `已恢復：${new Date().toISOString()} 的建置${kind === 'quality' ? '資料完整' : '抓取成功'}。${runUrl ? `\n\n${runUrl}` : ''}` } });
    const res = await github(`/repos/${repo}/issues/${open.number}`, token, { method: 'PATCH', body: { state: 'closed', state_reason: 'completed' } });
    if (!res.ok) throw new Error(`closing issue: HTTP ${res.status}`);
    return true;
  } catch (err) {
    console.error(`[alerts] GitHub issue for "${key}" failed (${(err as Error)?.message ?? err})`);
    return false;
  }
}

/**
 * Records a source's outcome. Never throws. Resolves once any webhook call has finished,
 * so callers can fire-and-forget it.
 */
/** Records a successful source's completeness: no problems closes an open alert, any problem opens one */
export function reportDataQuality(source: string, problems: string[]): Promise<void> {
  return reportSourceStatus(`${QUALITY_PREFIX}${source}`, problems.length === 0, problems.join('\n') || undefined);
}

export function reportSourceStatus(key: string, ok: boolean, detail?: string): Promise<void> {
  const task = report(key, ok, detail).finally(() => inFlight.delete(task));
  inFlight.add(task);
  return task;
}

async function report(key: string, ok: boolean, detail?: string): Promise<void> {
  try {
    const now = new Date().toISOString();
    const prev = states.get(key);
    const state: SourceState = prev && prev.ok === ok
      ? { ...prev, failures: ok ? 0 : prev.failures + 1 }
      : { ok, since: now, failures: ok ? 0 : 1, notifiedOk: prev?.notifiedOk, issueNotifiedOk: prev?.issueNotifiedOk };
    states.set(key, state);

    if (!ok) {
      console.error(`[${key}] failed (${detail ?? 'unknown error'})${state.failures > 1 ? ` – ${state.failures} in a row` : ''}`);
    } else if (prev && !prev.ok) {
      console.info(`[${key}] recovered after ${prev.failures} failure(s)`);
    }

    // A healthy first report is the baseline, not news
    if (ok && state.notifiedOk === undefined) state.notifiedOk = true;
    if (ok && state.issueNotifiedOk === undefined) state.issueNotifiedOk = true;

    // Each channel is told about a transition once; a failed delivery is retried on the next refresh
    if (state.issueNotifiedOk !== ok) {
      state.issueNotifiedOk = ok;
      if (!(await syncGithubIssue(key, ok, detail, ok ? prev?.since : state.since)) && states.get(key) === state) {
        state.issueNotifiedOk = !ok;
      }
    }

    // Already told the webhook about this state (or nothing changed)
    if (state.notifiedOk === ok) return;

    const webhook = process.env.ALERT_WEBHOOK_URL;
    if (!webhook) {
      state.notifiedOk = ok;
      return;
    }

    const text = kindOf(key) === 'quality' ? (ok
      ? `[os-version-tracker] COMPLETE AGAIN: source "${sourceOf(key)}" returns complete data again.`
      : `[os-version-tracker] INCOMPLETE: source "${sourceOf(key)}" worked but came back incomplete – ${(detail ?? 'unknown problem').replace(/\n/g, '; ')}.`)
      : ok
      ? `[os-version-tracker] RECOVERED: source "${key}" is working again (was failing since ${prev?.since ?? 'unknown'}).`
      : `[os-version-tracker] FAILING: source "${key}" could not be fetched or parsed – ${detail ?? 'unknown error'}. ` +
        'The page layout may have changed; the section is hidden until it recovers.';

    // Mark first so overlapping reports don't double-send; roll back so a failed send is retried next refresh
    state.notifiedOk = ok;
    if (!(await postWebhook(webhook, text)) && states.get(key) === state) {
      state.notifiedOk = !ok;
    }
  } catch (err) {
    console.error(`[alerts] unexpected error (${(err as Error)?.message ?? err})`);
  }
}
