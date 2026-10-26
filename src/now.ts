import type { AllVersions } from './fetch-all.js';
import { isActive } from './fetchers/apple-status.js';
import { safeUrl } from './safe-url.js';
import { taipeiToday } from './taipei-date.js';

/** One "待處理" card: shared by the page and api/now.json */
export interface NowCard {
  type: string;
  platform: string;
  meta: string;
  title: string;
  body: string;
  href: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;
/** How far ahead an announced requirement counts as something to start on now (the red "urgent" stays at 60 days) */
export const NOW_AHEAD_DAYS = 180;

/**
 * In-page anchors stay as they are; anything else must be a safe external URL, since it comes from upstream
 * data and api/now.json hands it to other sites as-is. An unusable link points at the card's section instead.
 */
export function nowHref(href: string | undefined, fallback: string): string {
  if (href && /^#[\w-]+$/.test(href)) return href;
  return safeUrl(href) ?? fallback;
}

/**
 * What needs action now: requirements due within NOW_AHEAD_DAYS (urgent ones first), exploited vulnerabilities,
 * Apple service problems, crash reports about the newest OS
 */
export function buildNowCards(data: AllVersions, now = new Date()): NowCard[] {
  const since = (days: number) => new Date(now.getTime() - days * DAY_MS).toISOString().slice(0, 10);
  const cards: NowCard[] = [];
  // Requirements: the urgent ones (due within 60 days, or in an extension window), then the announced ones due
  // within NOW_AHEAD_DAYS, soonest first (an estimate of what might come is no announcement, and stays out)
  const today = taipeiToday(now);
  const aheadBy = new Date(Date.parse(`${today}T00:00:00Z`) + NOW_AHEAD_DAYS * DAY_MS).toISOString().slice(0, 10);
  const required = (['iOS', 'Android'] as const).flatMap(platform => (platform === 'iOS' ? data.iosActions : data.androidActions)
    .filter(a => a.status === 'urgent' || (a.status === 'upcoming' && !a.estimated && a.dueDate && a.dueDate <= aheadBy))
    .map(a => ({ a, platform })));
  required.sort((x, y) => Number(y.a.status === 'urgent') - Number(x.a.status === 'urgent') || (x.a.dueDate ?? '').localeCompare(y.a.dueDate ?? ''));
  for (const { a, platform } of required) {
    // How long is left is in the detail itself (a countdown, or that only the month was announced)
    cards.push({ type: '期限', platform, meta: a.status === 'urgent' ? '需要處理' : '即將到來', title: a.title, body: a.detail, href: nowHref(a.url, `#${platform === 'iOS' ? 'ios' : 'android'}`) });
  }
  const s = data.security;
  for (const r of (s?.apple ?? []).filter(r => r.exploited.length && r.date >= since(45))) {
    cards.push({ type: '資安', platform: 'iOS', meta: `可能已遭利用 · ${r.date}`, title: `${r.name} 修補了可能已遭利用的漏洞`, body: `${r.exploited.join('、')}。建議提醒使用者更新系統。`, href: nowHref(r.url, '#security') });
  }
  for (const b of (s?.android ?? []).filter(b => b.exploited.length && b.published >= since(45))) {
    cards.push({ type: '資安', platform: 'Android', meta: `可能已遭利用 · ${b.published}`, title: `${b.title}：${b.exploited.join('、')}`, body: `修補程式等級 ${b.patchLevels.at(-1) ?? ''} 以上已修正。`, href: nowHref(b.url, '#security') });
  }
  const kev = (s?.exploited ?? []).filter(v => v.dateAdded >= since(30));
  if (kev.length) {
    const platforms = new Set(kev.map(v => v.platform));
    cards.push({
      type: '資安',
      platform: platforms.size === 1 ? [...platforms][0] : '跨平台',
      meta: '美國 CISA 列入 · 近 30 天',
      title: `${kev.length} 個與 iOS / Android / WebView 相關的漏洞已遭利用`,
      body: kev.slice(0, 4).map(v => `${v.cve}（${v.product}）`).join('、') + (kev.length > 4 ? ` 等 ${kev.length} 個` : ''),
      href: '#security',
    });
  }
  // Apple developer services with a problem right now (as of the last refresh); planned maintenance included
  for (const e of (data.appleStatus?.events ?? []).filter(e => isActive(e, now))) {
    const label = /maintenance/i.test(e.type) ? '維護' : e.type === 'Outage' ? '中斷' : '異常';
    cards.push({
      type: '公告',
      platform: 'iOS',
      meta: `Apple 服務狀態 · ${e.state === 'upcoming' ? '即將' : '進行中'}`,
      title: `${e.service} ${label}`,
      body: `開始於 ${e.start.slice(0, 16).replace('T', ' ')} UTC。這是網站上次更新時的狀態，最新情況請看 Apple 的系統狀態頁。`,
      href: nowHref(data.appleStatus!.url, '#ios'),
    });
  }
  const crashes = [...(data.crashes?.sdks ?? []), ...(data.crashes?.cordova ?? [])].filter(c => c.newOs).slice(0, 3);
  for (const c of crashes) {
    cards.push({ type: '閃退', platform: c.platform, meta: `${c.context}${c.date ? ` · ${c.date}` : ''}`, title: c.title, body: '提到最新系統版本的社群回報，升級前先確認。', href: nowHref(c.url, '#crashes') });
  }
  return cards;
}

