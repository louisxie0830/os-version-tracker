import type { AllVersions } from './fetch-all.js';
import type { DevNewsItem } from './fetchers/dev-news.js';
import type { SecurityPlatform } from './fetchers/security.js';

/**
 * "需要立即處理": the security items to act on now, each with what to do about it. One list for the security
 * section's top card and for the alert issues (security-watch.ts), so the page and the email say the same.
 * Exploited vulnerabilities and the updates that fix them come first by nature of the sources; anything older
 * than its window has either been handled or is no longer news.
 */

export interface UrgentItem {
  /** Stable across refreshes: the alert issues are de-duplicated by it */
  key: string;
  platform: SecurityPlatform;
  /** Who says so: CISA KEV, Apple, Chrome, a vendor, GitHub Advisory, a Taiwan authority */
  source: string;
  title: string;
  /** What to do, in one sentence */
  action: string;
  url: string;
  date: string; // YYYY-MM-DD
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Windows in days: exploited vulnerabilities stay a month; monthly bulletins a little longer (they come once a month) */
export const URGENT_DAYS = { exploited: 30, bulletin: 45, advisory: 30, notice: 14 } as const;

/** Taiwan authorities whose "important" notices are urgent patch calls or incidents (dev-news source ids) */
export const TW_AUTHORITY = ['acs', 'twcert-tvn', 'fsc', 'banking-news', 'banking-penalty'];
export const sourceId = (n: DevNewsItem) => n.id.slice(0, n.id.indexOf(':'));

const KEV_ACTION: Record<SecurityPlatform, string> = {
  iOS: '提醒使用者把 iOS / iPadOS 更新到最新版；App 若有最低版本或強制更新機制，評估是否提高。',
  Android: '提醒使用者安裝最新的 Android 安全性更新；App 若有最低修補程式等級檢查，評估是否提高。',
  跨平台: '提醒使用者更新 Chrome 與 Android System WebView（App 內的 WebView 跟著它更新）；iOS 的 WebView 隨 iOS 更新。',
};

export function urgentSecurityItems(data: Pick<AllVersions, 'security' | 'devNews'>, now = new Date()): UrgentItem[] {
  const since = (days: number) => new Date(now.getTime() - days * DAY_MS).toISOString().slice(0, 10);
  const s = data.security;
  const items: UrgentItem[] = [
    ...(s?.exploited ?? []).filter(v => v.dateAdded >= since(URGENT_DAYS.exploited)).map(v => ({
      key: `kev:${v.cve}`,
      platform: v.platform,
      source: '美國 CISA KEV',
      title: `已遭利用：${v.cve}（${v.product}）${v.name}`,
      action: KEV_ACTION[v.platform],
      url: v.url,
      date: v.dateAdded,
    })),
    ...(s?.apple ?? []).filter(r => r.exploited.length && r.url && r.date >= since(URGENT_DAYS.exploited)).map(r => ({
      key: `apple:${r.url}`,
      platform: 'iOS' as const,
      source: 'Apple 安全性更新',
      title: `${r.name} 修補了可能已遭利用的漏洞（${r.exploited.join('、')}）`,
      action: `提醒使用者更新到 ${r.name} 以上。`,
      url: r.url!,
      date: r.date,
    })),
    ...(s?.chrome ?? []).filter(c => c.exploited.length && c.published >= since(URGENT_DAYS.exploited)).map(c => ({
      key: `chrome:${c.version}`,
      platform: '跨平台' as const,
      source: 'Chrome Releases',
      title: `Chrome ${c.version} 修補了已遭利用的漏洞（${c.exploited.join('、')}）`,
      action: `提醒使用者把 Chrome 與 Android System WebView 更新到 ${c.version} 以上（App 內的 WebView 跟著它更新）。`,
      url: c.url,
      date: c.published,
    })),
    ...(s?.android ?? []).filter(b => b.exploited.length && b.published >= since(URGENT_DAYS.bulletin)).map(b => ({
      key: `android:${b.url}`,
      platform: 'Android' as const,
      source: 'Android 安全性公告',
      title: `${b.title}：可能已遭利用（${b.exploited.join('、')}）`,
      action: `提醒使用者安裝系統更新，確認安全性修補程式等級在 ${b.patchLevels.at(-1) ?? '本月'} 以上。`,
      url: b.url,
      date: b.published,
    })),
    ...(s?.vendors ?? []).filter(b => b.exploited.length && b.published >= since(URGENT_DAYS.bulletin)).map(b => ({
      key: `vendor:${b.url}`,
      platform: 'Android' as const,
      source: b.vendor,
      title: `${b.title}：可能已遭利用（${b.exploited.join('、')}）`,
      action: b.vendor === 'MediaTek'
        ? 'MediaTek 晶片的修補由手機廠商隨系統更新推送：提醒使用者安裝最新的系統更新。'
        : `提醒 ${b.vendor} 使用者安裝這個月的安全性更新${b.patchLevel ? `（修補程式等級 ${b.patchLevel} 以上）` : ''}。`,
      url: b.url,
      date: b.published,
    })),
    ...(s?.advisories ?? []).filter(a => (a.severity === 'critical' || a.severity === 'high') && a.published >= since(URGENT_DAYS.advisory)).map(a => ({
      key: `ghsa:${a.id}`,
      platform: a.platform,
      source: 'GitHub Advisory Database',
      title: `SDK 資安公告（${a.severity === 'critical' ? '嚴重' : '高'}）：${a.summary}`,
      action: a.ranges.map(r => r.patched ? `${r.package} 升級到 ${r.patched} 以上` : `確認 ${r.package} 是否在受影響版本（${r.vulnerable ?? '見公告'}）內`).join('；') + '。',
      url: a.url,
      date: a.published,
    })),
    ...(data.devNews ?? []).filter(n => n.category === 'security' && n.important && TW_AUTHORITY.includes(sourceId(n)) && n.date >= since(URGENT_DAYS.notice)).map(n => ({
      key: `notice:${n.url}`,
      platform: n.platform,
      source: n.source,
      title: n.title,
      action: '依公告確認是否使用受影響的產品或服務（含後端與開發工具），並依建議修補或更新。',
      url: n.url,
      date: n.date,
    })),
  ];
  const seen = new Set<string>();
  return items.filter(i => !seen.has(i.key) && !!seen.add(i.key)).sort((a, b) => b.date.localeCompare(a.date));
}
