import type { TrackedItem } from './changes.js';
import { SITE_URL, type AllVersions } from './fetch-all.js';
import { buildNowCards } from './now.js';
import { displayDate, esc, externalLink } from './render-actions.js';
import { calendarSubscriptionUrl, safeUrl } from './safe-url.js';
import { platformClass, taipeiTime } from './render-common.js';
import { daysUntil, taipeiToday } from './taipei-date.js';

/** "Now" cards, the feed wall, and the two side rails (filters and section nav; snapshot and subscribe). */

export const KIND_LABEL: Record<TrackedItem['kind'], string> = {
  deadline: '期限',
  'apple-news': 'Apple 公告',
  'android-news': 'Android 公告',
  'dev-news': '開發者新聞',
  device: '新機型',
  crash: 'SDK 閃退',
  security: '資安',
  bank: '銀行 App',
  status: '服務狀態',
};

/** Feed filter types; every tracked kind maps to one */
const FEED_TYPE: Record<TrackedItem['kind'], string> = {
  security: '資安',
  crash: '閃退',
  deadline: '期限',
  'apple-news': '公告',
  'android-news': '公告',
  'dev-news': '公告',
  device: '新機型',
  bank: '銀行 App',
  // Service incidents are announcements from Apple's status page
  status: '公告',
};

const FEED_TYPES = ['資安', '閃退', '期限', '公告', '新機型', '銀行 App'];

const FEED_PLATFORMS = ['iOS', 'Android', '跨平台'];

const FEED_SHOWN = 15;

const typeClass = (type: string) => `type-tag type-${({ 資安: 'security', 閃退: 'crash', 期限: 'deadline', 公告: 'news', 新機型: 'version', '銀行 App': 'bank' } as Record<string, string>)[type] ?? 'news'}`;

function feedHref(href: string): string {
  if (/^#[\w-]+$/.test(href)) return `<a class="feed-link" href="${esc(href)}">`;
  const url = safeUrl(href);
  return url ? `<a class="feed-link" href="${esc(url)}" target="_blank" rel="noopener">` : '<a class="feed-link" href="#security">';
}

export function renderNow(data: AllVersions): string {
  const cards = buildNowCards(data);
  const list = cards.length
    ? cards.map(c => `<article class="now-card now-${c.type === '資安' ? 'security' : c.type === '閃退' ? 'crash' : 'deadline'}" data-feed-item data-type="${esc(c.type)}" data-platform="${esc(c.platform)}">
        <div class="now-meta">
          <span class="${typeClass(c.type)}">${esc(c.type)}</span>
          <span class="now-platform">${esc(c.platform)}</span>
          <span>${esc(displayDate(c.meta))}</span>
        </div>
        ${feedHref(c.href)}${esc(displayDate(c.title))}</a>
        <p>${esc(displayDate(c.body))}</p>
      </article>`).join('')
    : '<p class="feed-empty">目前沒有需要立即處理的項目。</p>';
  return `<section class="feed-section" id="now" aria-labelledby="now-h">
    <h2 class="feed-h" id="now-h">待處理</h2>
    <div class="now-list">${list}</div>
    <p class="feed-empty" id="now-empty" hidden>沒有符合篩選的項目。</p>
  </section>`;
}

export function renderFeed(data: AllVersions): string {
  const sortKey = (item: TrackedItem) => item.firstSeen ?? (item.kind === 'deadline' ? '' : item.date);
  const items = [...data.tracked].sort((a, b) => sortKey(b).localeCompare(sortKey(a))).slice(0, 80);
  const rows = items.map((item, i) => {
    const type = FEED_TYPE[item.kind];
    const date = (item.firstSeen ?? item.date).slice(5, 10).replace('-', '/');
    return `<li class="feed-row${i >= FEED_SHOWN ? ' feed-extra' : ''}" data-feed-item data-type="${esc(type)}" data-platform="${esc(item.platform)}" data-key="feed:${esc(item.id)}"${i >= FEED_SHOWN ? ' hidden' : ''}>
      <span class="feed-date">${esc(date)}</span>
      <span class="feed-main">${externalLink(item.url, esc(displayDate(item.title)), 'feed-title')}${item.author ? `<span class="feed-author">作者 ${esc(item.author.name)}</span>` : ''}</span>
      <span class="feed-tags"><span class="tl-platform ${platformClass(item.platform)}">${esc(item.platform)}</span><span class="${typeClass(type)}">${esc(type)}</span></span>
    </li>`;
  }).join('');
  return `<section class="feed-section" id="feed" aria-labelledby="feed-h">
    <div class="feed-head">
      <h2 class="feed-h" id="feed-h">最新動態</h2>
      <span class="feed-count">最近 7 天新增 ${data.recent.length} 項</span>
    </div>
    <div class="feed-box">
      ${items.length ? `<ul class="feed-list">${rows}</ul>` : ''}
      <p class="feed-empty" id="feed-empty"${items.length ? ' hidden' : ''}>${items.length ? '沒有符合篩選的動態。' : '目前沒有動態。'}</p>
      ${items.length > FEED_SHOWN ? `<button type="button" class="feed-more" id="feed-more">載入更多（共 ${items.length} 項）</button>` : ''}
    </div>
  </section>`;
}

const SECTION_LINKS: Array<[string, string]> = [
  ['now', '待處理'], ['feed', '最新動態'], ['security', '資安'], ['crashes', '閃退'], ['cordova', 'Cordova'], ['frameworks', 'RN · Flutter'],
  ['news', '新聞'], ['trends', '趨勢'], ['ios', 'iOS'], ['android', 'Android'], ['compat', '相容性'], ['deadlines', '上架規定'],
  ['banks', '銀行 App'], ['privacy', '隱私規範'], ['api', 'API'], ['legal', '免責聲明'],
];

export function renderFilterRail(): string {
  const chips = (group: string, values: string[]) => `<choice-chips name="${group}"><div class="chips" role="group" data-filter-group="${group}">
      <button type="button" class="chip is-active" data-value="all" aria-pressed="true">全部</button>
      ${values.map(v => `<button type="button" class="chip" data-value="${esc(v)}" aria-pressed="false">${esc(v)}</button>`).join('')}
    </div></choice-chips>`;
  return `<aside class="rail rail-left" aria-label="篩選與頁面區塊">
    <div class="rail-group">
      <span class="rail-label" id="filter-type">類型</span>
      ${chips('type', FEED_TYPES)}
    </div>
    <div class="rail-group">
      <span class="rail-label">平台</span>
      ${chips('platform', FEED_PLATFORMS)}
    </div>
    <nav class="section-nav" aria-label="頁面區塊">
      <span class="rail-label">頁面區塊</span>
      ${SECTION_LINKS.map(([id, label]) => `<a href="#${id}">${label}</a>`).join('')}
    </nav>
  </aside>`;
}

export function renderSnapshotRail(data: AllVersions): string {
  const webcal = calendarSubscriptionUrl(SITE_URL) ?? 'calendar.ics';
  const iosStable = data.ios.find(v => !v.isBeta);
  const iosBeta = data.ios.find(v => v.isBeta);
  const androidStable = data.android.find(v => !v.isBeta);
  const tc = data.iosToolchain;
  const rows: Array<[string, string | undefined]> = [
    ['iOS 正式版', iosStable?.version],
    ['iOS Beta', iosBeta?.version.replace(/\s*beta\s*/i, ' b')],
    ['Xcode', tc?.xcodeStable?.version],
    ['Xcode Beta', tc?.xcodeBeta?.version],
    ['Android', androidStable?.version.replace(/^Android\s*/i, '')],
    ['AGP', data.androidToolchain?.agpStable?.version],
  ];
  // Taiwan's today, so the morning build (still yesterday in UTC) doesn't count one day too many
  const today = taipeiToday();
  const next = data.timeline.filter(d => d.date >= today).sort((a, b) => a.date.localeCompare(b.date))[0];
  const days = next ? daysUntil(next.date) ?? 0 : 0;
  return `<aside class="rail rail-right" aria-label="版本快照">
    <div class="snap">
      <span class="rail-label">目前版本</span>
      <dl>${rows.filter(([, v]) => v).map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v!)}</dd></div>`).join('')}</dl>
    </div>
    ${next ? `<div class="next-deadline">
      <span class="rail-label">下一個期限</span>
      <span class="next-days">${days}<small>天</small></span>
      <span class="next-title">${esc(displayDate(next.date))} · ${esc(next.title)}</span>
      <a href="#deadlines">完整期限時間軸</a>
    </div>` : ''}
    <div class="subscribe-card" id="subscribe">
      <span class="rail-label">訂閱更新</span>
      <p>有新規定、公告或資安消息時自動出現，不用每天來看。</p>
      <a class="btn primary" href="${esc(webcal)}">訂閱行事曆</a>
      <div class="subscribe-row">
        <a class="btn" href="calendar.ics" download>下載 .ics</a>
        <a class="btn" href="feed.xml">RSS / Atom</a>
      </div>
      <span class="rail-foot">資料更新於 ${esc(taipeiTime(data.cachedAt))}（台北）</span>
    </div>
  </aside>`;
}
