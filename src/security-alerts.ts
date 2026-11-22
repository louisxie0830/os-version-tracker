import { github as githubApi } from './alerts.js';
import type { UrgentItem } from './security-urgent.js';

/**
 * Opens a GitHub issue for each new "需要立即處理" security item, so the people watching the repo get an email
 * (GitHub sends one for every new issue) within the hour, without waiting for the site's next refresh.
 * The issues themselves are the memory: each carries its item's key in a hidden comment, and an item whose key
 * is already in an issue (open or closed) is never sent again. Closing an issue marks it handled.
 */

export const SECURITY_LABEL = 'security-alert';
/** Only items this recent are sent: older ones were on the page already, and a first run shouldn't flood */
export const SEND_WITHIN_DAYS = 7;
/** At most this many issues per run; the rest go out on the next run */
export const MAX_PER_RUN = 5;

const KEY_MARK = /<!-- security-key: (.+?) -->/g;
const DAY_MS = 24 * 60 * 60 * 1000;

type GithubCall = typeof githubApi;

export function issueBody(item: UrgentItem, siteUrl: string): string {
  return [
    `**建議動作：**${item.action}`,
    '',
    `- 平台：${item.platform}`,
    `- 來源：${item.source}`,
    `- 日期：${item.date}`,
    `- 原始公告：${item.url}`,
    ...(siteUrl ? [`- 網站：${siteUrl}/#security`] : []),
    '',
    '處理完成後請關閉這個 issue；同一個項目不會再開第二次。',
    '',
    `<!-- security-key: ${item.key} -->`,
  ].join('\n');
}

/** Keys already sent: every issue with the label, open or closed (up to 500, newest first) */
export async function sentKeys(repo: string, token: string, gh: GithubCall = githubApi): Promise<Set<string>> {
  const keys = new Set<string>();
  for (let page = 1; page <= 5; page++) {
    const res = await gh(`/repos/${repo}/issues?labels=${SECURITY_LABEL}&state=all&per_page=100&page=${page}`, token);
    // Without the list there is no telling what was sent: sending anyway could repeat every item
    if (!res.ok || !Array.isArray(res.data)) throw new Error(`GitHub issues list failed: HTTP ${res.status}`);
    for (const issue of res.data as Array<{ body?: string | null }>) {
      for (const m of (issue.body ?? '').matchAll(KEY_MARK)) keys.add(m[1]);
    }
    if (res.data.length < 100) break;
  }
  return keys;
}

/** The items to send this run: new, recent, at most MAX_PER_RUN, oldest first (so the inbox reads in order) */
export function toSend(items: UrgentItem[], sent: Set<string>, now = new Date()): UrgentItem[] {
  const since = new Date(now.getTime() - SEND_WITHIN_DAYS * DAY_MS).toISOString().slice(0, 10);
  return items.filter(i => !sent.has(i.key) && i.date >= since)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, MAX_PER_RUN);
}

/** Opens the issues; returns the keys it sent. One failed issue doesn't stop the others */
export async function sendSecurityIssues(items: UrgentItem[], config: { repo: string; token: string }, siteUrl: string, now = new Date(), gh: GithubCall = githubApi): Promise<string[]> {
  const pending = toSend(items, await sentKeys(config.repo, config.token, gh), now);
  const sent: string[] = [];
  for (const item of pending) {
    const title = `[資安] ${item.title}`;
    const res = await gh(`/repos/${config.repo}/issues`, config.token, {
      method: 'POST',
      body: { title: title.length > 200 ? `${title.slice(0, 199)}…` : title, body: issueBody(item, siteUrl), labels: [SECURITY_LABEL] },
    });
    if (res.ok) sent.push(item.key);
    else console.error(`[security-watch] issue for ${item.key} failed: HTTP ${res.status}`);
  }
  return sent;
}
