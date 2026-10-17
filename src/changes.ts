import { arrayField, isRecord, readJsonState, recordField, writeJsonAtomic, type Normalized } from './state-file.js';
import { deadlineId } from './calendar.js';
import type { AnnouncedDevice, Deadline, NewsItem } from './types.js';
import type { CrashItem } from './fetchers/crashes.js';
import type { DevNewsItem } from './fetchers/dev-news.js';
import type { SecurityReport } from './fetchers/security.js';
import type { DeveloperStatus } from './fetchers/apple-status.js';
import type { BankChange } from './history.js';
import { safeUrl } from './safe-url.js';
import { compareVersions } from './fetchers/ios-toolchain.js';
import { USER_AGENT, WEBHOOK_TIMEOUT_MS } from './net.js';

export interface TrackedItem {
  id: string;
  kind: 'deadline' | 'apple-news' | 'android-news' | 'dev-news' | 'device' | 'crash' | 'security' | 'bank' | 'status';
  platform: 'iOS' | 'Android' | '跨平台';
  title: string;
  detail: string;
  url: string;
  /** The item's own date: deadline date, or publication date for news */
  date: string;
  /** When this server first saw the item; undefined for the initial baseline */
  firstSeen?: string;
  /** Who wrote the title, when it's someone's own writing (GitHub issues): credited wherever it's shown */
  author?: { name: string; url?: string };
}

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

const isSeen = (v: unknown): v is string | null => v === null || typeof v === 'string';
const isTracked = (v: unknown): v is TrackedItem => isRecord(v)
  && ['id', 'kind', 'platform', 'title', 'url', 'date'].every(k => typeof v[k] === 'string') && (v.detail === undefined || typeof v.detail === 'string');

/**
 * Accepts older files (no pending queue). If the seen list is unusable, the baseline goes too: a baseline with
 * an empty seen list would announce every item as new
 */
export function normalizeChangesState(raw: unknown): Normalized<State> {
  if (!isRecord(raw)) return null;
  const repaired: string[] = [];
  if (raw.seen !== undefined && !isRecord(raw.seen)) return null;
  const seen = recordField(raw, 'seen', isSeen, repaired);
  const hasSeen = raw.seen !== undefined;
  let baselineAt = typeof raw.baselineAt === 'string' && hasSeen ? raw.baselineAt : undefined;
  if (raw.baselineAt !== undefined && typeof raw.baselineAt !== 'string') repaired.push('baselineAt');
  if (raw.baselineAt !== undefined && !hasSeen) {
    repaired.push('baselineAt (no seen list: starting a new baseline)');
    baselineAt = undefined;
  }
  const pending = arrayField(raw, 'pending', isTracked, repaired);
  return { value: { seen, ...(baselineAt ? { baselineAt } : {}), ...(pending.length ? { pending } : {}) }, repaired };
}

function loadState(): State {
  if (!STATE_FILE) return { seen: {} };
  return readJsonState(STATE_FILE, 'changes', normalizeChangesState) ?? { seen: {} };
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
    writeJsonAtomic(STATE_FILE, state);
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
  devNews?: DevNewsItem[];
  security?: SecurityReport | null;
  bankChanges?: BankChange[];
  appleStatus?: DeveloperStatus | null;
}, now = new Date()): TrackedItem[] {
  const recentAdvisory = new Date(now.getTime() - 90 * DAY_MS).toISOString().slice(0, 10);
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
    // Important items from the other news feeds (Apple News / Android blog are tracked above)
    ...(input.devNews ?? [])
      .filter(n => n.important && !n.id.startsWith('apple-news:') && !n.id.startsWith('android-blog:'))
      .map(n => ({
        id: `dev-news:${n.url}`,
        kind: 'dev-news' as const,
        platform: n.platform,
        title: n.title,
        detail: n.source,
        url: n.url,
        date: n.date,
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
      ...(c.author ? { author: c.author } : {}),
    })),
    // Vulnerabilities exploited in the wild, OS updates that fix them, monthly Android bulletins, serious SDK advisories
    ...(input.security?.exploited ?? []).map(v => ({
      id: `security:kev:${v.cve}`,
      kind: 'security' as const,
      platform: v.platform,
      title: `已遭利用的漏洞：${v.cve}（${v.product}）`,
      detail: v.name,
      url: v.url,
      date: v.dateAdded,
    })),
    ...(input.security?.apple ?? []).filter(r => r.exploited.length && r.url).map(r => ({
      id: `security:apple:${r.url}`,
      kind: 'security' as const,
      platform: 'iOS' as const,
      title: `${r.name} 修補了可能已遭利用的漏洞`,
      detail: r.exploited.join('、'),
      url: r.url!,
      date: r.date,
    })),
    ...(input.security?.android ?? []).map(b => ({
      id: `security:android:${b.url}`,
      kind: 'security' as const,
      platform: 'Android' as const,
      title: `${b.title}${b.patchLevels.length ? `（修補程式等級 ${b.patchLevels.at(-1)}）` : ''}`,
      detail: b.exploited.length ? `可能已遭利用：${b.exploited.join('、')}` : b.cves === 0 ? '本月沒有公布 CVE' : b.cves ? `${b.cves} 個 CVE` : '詳見公告',
      url: b.url,
      date: b.published,
    })),
    ...(input.security?.advisories ?? []).filter(a => (a.severity === 'critical' || a.severity === 'high') && a.published >= recentAdvisory).map(a => ({
      id: `security:ghsa:${a.id}`,
      kind: 'security' as const,
      platform: a.platform,
      title: `SDK 資安公告（${a.severity}）：${a.summary}`,
      detail: a.packages.join('、'),
      url: a.url,
      date: a.published,
    })),
    // A bank raising (or lowering) its minimum OS is a reference point for setting your own
    ...(input.bankChanges ?? []).map(c => ({
      id: `bank:${c.key}:${c.platform}:${c.to}`,
      kind: 'bank' as const,
      platform: c.platform,
      title: `銀行 App 最低版本調整：${c.bank} ${c.app} ${c.platform} ${c.from} → ${c.to}`,
      detail: compareVersions(c.to, c.from) > 0 ? '調高最低支援版本' : '調低最低支援版本',
      url: c.url,
      date: c.date,
    })),
    // Outages and issues on Apple's developer services (TestFlight, App Store Connect…); planned maintenance is left out
    ...(input.appleStatus?.events ?? []).filter(e => !/maintenance/i.test(e.type)).map(e => ({
      id: `status:apple:${e.id}`,
      kind: 'status' as const,
      platform: 'iOS' as const,
      title: `Apple 開發者服務${e.type === 'Outage' ? '中斷' : '異常'}：${e.service}`,
      detail: `開始於 ${e.start.slice(0, 16).replace('T', ' ')} UTC`,
      url: input.appleStatus!.url,
      date: e.start.slice(0, 10),
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

  const lines = queue.slice(0, 15).map(item => `• [${item.platform}] ${item.title}${item.kind === 'deadline' ? `（${item.date}）` : ''}${safeUrl(item.url) ? `\n  ${safeUrl(item.url)}` : ''}`);
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
        headers: { 'Content-Type': 'application/json', 'User-Agent': USER_AGENT },
        body: JSON.stringify({ text }),
        signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
      });
      // Read the body so the connection closes (an unread body keeps the process alive)
      await res.text().catch(() => '');
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
    ${safeUrl(item.url) ? `<link href="${xml(safeUrl(item.url)!)}"/>` : ''}
    <updated>${published}</updated>
    <published>${published}</published>
    <summary>${xml(item.detail)}</summary>${item.author ? `
    <author><name>${xml(item.author.name)}</name>${safeUrl(item.author.url) ? `<uri>${xml(safeUrl(item.author.url)!)}</uri>` : ''}</author>` : ''}
  </entry>`;
    }).join('\n');

  return `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xml:lang="zh-Hant">
  <title>OS Version Tracker：上架規定與重要公告</title>
  <subtitle>iOS / Android 上架期限、政策變更、重要開發者公告與新機型</subtitle>
  <id>${xml(siteUrl)}/feed.xml</id>
  <link rel="self" href="${xml(siteUrl)}/feed.xml"/>
  <link href="${xml(siteUrl)}"/>
  <link rel="related" href="${xml(siteUrl)}/legal/" title="免責聲明、資料來源與授權"/>
  <author><name>OS Version Tracker</name><uri>${xml(siteUrl)}/</uri></author>
  <rights>標題與摘要取自各資料來源（官方公告、開源專案的 GitHub issue、CISA 等）並連回原文，著作權屬於原權利人或原作者；有作者的項目另附作者。本站彙整保留所有權利。各來源的授權與免責聲明：${xml(siteUrl)}/legal/</rights>
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
    .map(({ id, kind, platform, title, detail, url, date, firstSeen, author }) => ({ id, kind, platform, title, detail, url: safeUrl(url) ?? '', date, firstSeen, ...(author ? { author: { name: author.name, url: safeUrl(author.url) } } : {}) }));
  return JSON.stringify({ cachedAt, items: sorted });
}
