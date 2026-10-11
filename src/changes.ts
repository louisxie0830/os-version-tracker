import { readFileSync, writeFileSync } from 'node:fs';
import { deadlineId } from './calendar.js';
import type { AnnouncedDevice, Deadline, NewsItem } from './types.js';
import type { CrashItem } from './fetchers/crashes.js';

export interface TrackedItem {
  id: string;
  kind: 'deadline' | 'apple-news' | 'android-news' | 'device' | 'crash';
  platform: 'iOS' | 'Android' | '跨平台';
  title: string;
  detail: string;
  url: string;
  /** The item's own date: deadline date, or publication date for news */
  date: string;
  /** When this server first saw the item; undefined for the initial baseline */
  firstSeen?: string;
}

const WEBHOOK_TIMEOUT_MS = 5_000;
const DAY_MS = 24 * 60 * 60 * 1000;

// Optional persistence so "first seen" survives restarts; the default keeps state in memory only,
// which also works on a read-only container filesystem.
const STATE_FILE = process.env.CHANGES_STATE_FILE;

interface State {
  baselineAt?: string;
  seen: Record<string, string | null>;
  /** New items the webhook hasn't accepted yet; retried on the next refresh */
  pending?: TrackedItem[];
}

function loadState(): State {
  if (!STATE_FILE) return { seen: {} };
  try {
    return JSON.parse(readFileSync(STATE_FILE, 'utf8')) as State;
  } catch {
    return { seen: {} };
  }
}

const state: State = loadState();

const MAX_PENDING = 50;
let RETRY_DELAYS_MS = [1_000, 3_000];

/** For tests: start from an empty state */
export function resetChangesState(): void {
  state.baselineAt = undefined;
  state.seen = {};
  state.pending = [];
}

/** For tests: shorten the in-refresh retry back-off */
export function setNotifyRetryDelays(delays: number[]): void {
  RETRY_DELAYS_MS = delays;
}

function saveState(): void {
  if (!STATE_FILE) return;
  try {
    writeFileSync(STATE_FILE, JSON.stringify(state));
  } catch (err) {
    console.warn(`[changes] could not persist state (${(err as Error).message})`);
  }
}

export function toTrackedItems(input: {
  deadlines: Deadline[];
  appleNews: NewsItem[];
  androidNews: NewsItem[];
  devices: AnnouncedDevice[];
  crashes?: CrashItem[];
}): TrackedItem[] {
  return [
    ...input.deadlines.map(d => ({
      id: `deadline:${deadlineId(d)}`,
      kind: 'deadline' as const,
      platform: d.platform,
      title: d.title,
      detail: d.detail,
      url: d.url,
      date: d.date,
    })),
    ...input.appleNews.filter(n => n.important).map(n => ({
      id: `apple-news:${n.url}`,
      kind: 'apple-news' as const,
      platform: 'iOS' as const,
      title: n.title,
      detail: 'Apple 開發者公告',
      url: n.url,
      date: n.date,
    })),
    ...input.androidNews.filter(n => n.important).map(n => ({
      id: `android-news:${n.url}`,
      kind: 'android-news' as const,
      platform: 'Android' as const,
      title: n.title,
      detail: 'Android Developers Blog',
      url: n.url,
      date: n.date,
    })),
    ...input.devices.map(d => ({
      id: `device:${d.name}`,
      kind: 'device' as const,
      platform: 'iOS' as const,
      title: `Apple 已公告新機型：${d.name}`,
      detail: d.title,
      url: d.url,
      date: d.date,
    })),
    // Only crash reports that many developers hit, or that mention the newest OS
    ...(input.crashes ?? []).filter(c => c.source === 'GitHub' && (c.newOs || (c.reactions ?? 0) >= 10)).map(c => ({
      id: `crash:${c.url}`,
      kind: 'crash' as const,
      platform: c.platform,
      title: `SDK 閃退回報：${c.title}`,
      detail: `${c.context}（👍 ${c.reactions ?? 0}、💬 ${c.comments ?? 0}）`,
      url: c.url,
      date: c.date ?? '',
    })),
  ];
}

/**
 * Records items and returns the ones that appeared since the previous refresh.
 * The very first run only establishes a baseline, so a fresh deploy doesn't announce everything.
 */
export function recordItems(items: TrackedItem[], now = new Date()): { items: TrackedItem[]; added: TrackedItem[] } {
  const isBaseline = !state.baselineAt;
  const nowIso = now.toISOString();
  const added: TrackedItem[] = [];

  for (const item of items) {
    if (!(item.id in state.seen)) {
      state.seen[item.id] = isBaseline ? null : nowIso;
      if (!isBaseline) added.push({ ...item, firstSeen: nowIso });
    }
  }
  if (isBaseline) state.baselineAt = nowIso;
  saveState();

  return {
    items: items.map(item => ({ ...item, firstSeen: state.seen[item.id] ?? undefined })),
    added,
  };
}

/** Items that are new to readers recently: first seen within `days`, or (for dated news) published within it */
export function recentItems(items: TrackedItem[], days = 7, now = new Date()): TrackedItem[] {
  const since = now.getTime() - days * DAY_MS;
  const today = now.toISOString().slice(0, 10);
  return items
    .filter(item => {
      if (item.firstSeen) return new Date(item.firstSeen).getTime() >= since;
      // Deadlines carry their effective date, not an announcement date, so only news/devices qualify here
      return item.kind !== 'deadline' && item.date <= today && new Date(item.date).getTime() >= since;
    })
    .sort((a, b) => (b.firstSeen ?? b.date).localeCompare(a.firstSeen ?? a.date));
}

const inFlight = new Set<Promise<void>>();

/** Resolves once every webhook notification started so far has finished */
export async function flushNotifications(): Promise<void> {
  await Promise.all([...inFlight]);
}

export function notifyWebhook(added: TrackedItem[], siteUrl: string): Promise<void> {
  const task = postNotification(added, siteUrl).finally(() => inFlight.delete(task));
  inFlight.add(task);
  return task;
}

async function postNotification(added: TrackedItem[], siteUrl: string): Promise<void> {
  const url = process.env.NOTIFY_WEBHOOK_URL;
  if (!url) return;

  // Items a previous refresh couldn't deliver go out together with the new ones
  const queue = [...new Map([...(state.pending ?? []), ...added].map(item => [item.id, item])).values()];
  if (!queue.length) return;

  const lines = queue.slice(0, 15).map(item => `• [${item.platform}] ${item.title}${item.kind === 'deadline' ? `（${item.date}）` : ''}\n  ${item.url}`);
  const text = `📡 OS Version Tracker：${queue.length} 項新的規定／公告\n${lines.join('\n')}${queue.length > 15 ? `\n…還有 ${queue.length - 15} 項` : ''}\n${siteUrl}`;

  const outcome = await postWithRetry(url, text);
  // Delivered, or rejected for good (a 4xx other than 429 won't succeed on retry): drop the queue.
  // Temporary failures keep it so the next refresh tries again.
  state.pending = outcome === 'retry' ? queue.slice(-MAX_PENDING) : [];
  saveState();
}

async function postWithRetry(url: string, text: string): Promise<'sent' | 'rejected' | 'retry'> {
  for (let attempt = 0; ; attempt++) {
    let retryAfterMs: number | undefined;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
        signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
      });
      if (res.ok) return 'sent';
      if (res.status !== 429 && res.status < 500) {
        console.error(`[changes] webhook rejected the notification (${res.status}); not retrying`);
        return 'rejected';
      }
      console.warn(`[changes] webhook responded ${res.status}`);
      const retryAfter = Number(res.headers.get('retry-after'));
      if (retryAfter > 0) retryAfterMs = retryAfter * 1000;
    } catch (err) {
      console.warn(`[changes] webhook failed (${(err as Error).message})`);
    }
    if (attempt >= RETRY_DELAYS_MS.length) return 'retry';
    // Honour Retry-After, but never stall a refresh for long
    await new Promise(r => setTimeout(r, Math.min(retryAfterMs ?? RETRY_DELAYS_MS[attempt], 10_000)));
  }
}

function xml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Atom feed so RSS readers / Slack's RSS app can subscribe to new requirements and announcements */
export function buildAtomFeed(items: TrackedItem[], siteUrl: string, updated: string): string {
  // Items from the initial baseline have no first-seen time; use their own date, capped at "now"
  // so future deadlines don't appear as if published in the future
  const publishedAt = (item: TrackedItem) => item.firstSeen
    ?? (`${item.date}T00:00:00Z` < updated ? `${item.date}T00:00:00Z` : updated);
  const entries = [...items]
    .sort((a, b) => publishedAt(b).localeCompare(publishedAt(a)))
    .slice(0, 50)
    .map(item => {
      const published = publishedAt(item);
      const prefix = item.kind === 'deadline' ? `[${item.platform}] ${item.date} ` : `[${item.platform}] `;
      return `  <entry>
    <id>urn:os-version-tracker:${xml(item.id)}</id>
    <title>${xml(prefix + item.title)}</title>
    <link href="${xml(item.url)}"/>
    <updated>${published}</updated>
    <published>${published}</published>
    <summary>${xml(item.detail)}</summary>
  </entry>`;
    }).join('\n');

  return `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xml:lang="zh-Hant">
  <title>OS Version Tracker：上架規定與重要公告</title>
  <subtitle>iOS / Android 上架期限、政策變更、重要開發者公告與新機型</subtitle>
  <id>${xml(siteUrl)}/feed.xml</id>
  <link rel="self" href="${xml(siteUrl)}/feed.xml"/>
  <link href="${xml(siteUrl)}"/>
  <updated>${updated}</updated>
${entries}
</feed>
`;
}

/**
 * Compact feed for the in-page notification center, which polls it while the site is open
 * (api.json is much larger). Newest first by when the item first appeared.
 */
export function buildNotificationsJson(items: TrackedItem[], cachedAt: string, limit = 40): string {
  // Newest first by first-seen time; then news by publish date; deadlines (whose date is when they take
  // effect, not when they were announced) last, soonest first
  const rank = (item: TrackedItem) => item.firstSeen ? 2 : item.kind === 'deadline' ? 0 : 1;
  const sorted = [...items]
    .sort((a, b) => rank(b) - rank(a)
      || (rank(a) === 0 ? a.date.localeCompare(b.date) : (b.firstSeen ?? b.date).localeCompare(a.firstSeen ?? a.date)))
    .slice(0, limit)
    .map(({ id, kind, platform, title, detail, url, date, firstSeen }) => ({ id, kind, platform, title, detail, url, date, firstSeen }));
  return JSON.stringify({ cachedAt, items: sorted });
}
