import { buildNotificationsJson } from './changes.js';
import { SITE_URL, type AllVersions } from './fetch-all.js';
import { esc, renderActions } from './render-actions.js';
import { CONTENT_SECURITY_POLICY } from './security-headers.js';
import { renderBanksSection } from './render-banks.js';
import { renderSources, renderTiles } from './render-common.js';
import { renderApiSection, renderLegalSection, renderNewsSection, renderPrivacySection } from './render-docs.js';
import { renderFeed, renderFilterRail, renderNow, renderSnapshotRail } from './render-feed.js';
import { androidTiles, iOSTiles, renderAppleStatus, renderPlatformSection, renderVersionDistribution } from './render-platforms.js';
import { renderCompatSection, renderDeadlinesSection } from './render-schedule.js';
import { renderCordovaSection, renderCrashesSection, renderSecuritySection } from './render-security.js';
import { renderTrendsSection } from './render-trends.js';
import { renderFrameworksSection } from './render-frameworks.js';
import { STYLE_VERSION } from './render-styles.js';
import { COMPONENT_SCRIPTS, scriptSrc } from './asset-versions.js';

export interface RenderOptions {
  /** How often the data is refreshed, shown to readers (server cache TTL, or the static site's build schedule) */
  refreshMinutes?: number;
}

export function renderHTML(data: AllVersions, options: RenderOptions = {}): string {
  const minutes = options.refreshMinutes ?? 10;
  const refresh = minutes >= 24 * 60 ? '每天' : minutes % 60 === 0 ? `每 ${minutes / 60} 小時` : `每 ${minutes} 分鐘`;
  // Kept short: search results cut Chinese descriptions off at roughly 80–100 characters
  const description = `iOS 與 Android 開發者的待處理清單：App Store 與 Google Play 上架規定與期限、已遭利用的漏洞、新系統閃退、Xcode 與 AGP 相容性，${refresh}自動更新。`;
  const shortDescription = `上架規定與期限、已遭利用的漏洞、新系統閃退與 Xcode / AGP 相容性，官方來源${refresh}自動更新。`;
  const { ios, android } = data;
  return `<!DOCTYPE html>
<html lang="zh-Hant">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="theme-color" content="#fbfaf7" media="(prefers-color-scheme: light)">
  <meta name="theme-color" content="#14191c" media="(prefers-color-scheme: dark)">
  <script src="${scriptSrc('theme.js')}"></script>
  <meta name="color-scheme" content="light dark">
  <meta http-equiv="Content-Security-Policy" content="${CONTENT_SECURITY_POLICY}">
  <meta name="referrer" content="strict-origin-when-cross-origin">
  <title>iOS / Android 上架規定、資安與閃退追蹤｜OS Version Tracker</title>
  <meta name="description" content="${esc(description)}">
  <!-- Not meant to be found through search engines or used by AI crawlers: no indexing, link following,
       caching, snippets (which also keeps it out of AI search answers) or AI training (noai / noimageai) -->
  <meta name="robots" content="noindex, nofollow, noarchive, nosnippet, noimageindex, noai, noimageai">
  <link rel="alternate" type="application/atom+xml" title="OS Version Tracker：上架規定與重要公告" href="feed.xml">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="OS Version Tracker">
  <meta property="og:locale" content="zh_TW">
  <meta property="og:url" content="${esc(SITE_URL)}/">
  <meta property="og:title" content="iOS / Android 上架規定、資安與閃退追蹤">
  <meta property="og:description" content="${esc(shortDescription)}">
  <meta property="og:image" content="${esc(SITE_URL)}/og-image.png">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="og:image:type" content="image/png">
  <meta property="og:image:alt" content="OS Version Tracker：iOS 與 Android 上架規定、資安與閃退，整理在同一頁">
  <meta property="og:updated_time" content="${esc(data.cachedAt)}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="iOS / Android 上架規定、資安與閃退追蹤">
  <meta name="twitter:description" content="${esc(shortDescription)}">
  <meta name="twitter:image" content="${esc(SITE_URL)}/og-image.png">
  <meta name="twitter:image:alt" content="OS Version Tracker：iOS 與 Android 上架規定、資安與閃退，整理在同一頁">
  <link rel="icon" href="icons/icon.svg" type="image/svg+xml">
  <link rel="icon" href="icons/icon-192.png" type="image/png" sizes="192x192">
  <link rel="apple-touch-icon" href="icons/apple-touch-icon.png">
  <link rel="manifest" href="manifest.webmanifest">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="default">
  <meta name="apple-mobile-web-app-title" content="OS Tracker">
  <link rel="stylesheet" href="style.css?v=${STYLE_VERSION}">
</head>
<body>
  <a class="skip-link" href="#main">跳到主要內容</a>
  <header class="topbar">
    <div class="topbar-in">
      <a class="brand" href="./">
        <span class="brand-mark"><svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="2.2" fill="#fff" stroke="none"/><path d="M8.46 15.54a5 5 0 0 1 0-7.08"/><path d="M15.54 8.46a5 5 0 0 1 0 7.08"/><path d="M5.64 18.36a9 9 0 0 1 0-12.72"/><path d="M18.36 5.64a9 9 0 0 1 0 12.72"/></svg></span>
        <span class="brand-name">OS Version Tracker</span>
      </a>
      <label class="search">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
        <span class="sr-only">搜尋動態</span>
        <input type="search" id="search" placeholder="搜尋 CVE、SDK、版本號…" autocomplete="off" aria-keyshortcuts="/">
        <kbd class="search-kbd" aria-hidden="true">/</kbd>
      </label>
      <a class="btn primary topbar-subscribe" href="#subscribe">訂閱更新</a>
      <button class="theme-toggle" id="theme-toggle" type="button" aria-label="切換深色模式" aria-pressed="false">
        <svg class="icon-moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>
        <svg class="icon-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>
      </button>
      <div class="notif">
        <button class="notif-bell" id="notif-bell" type="button" aria-label="通知" aria-expanded="false" aria-controls="notif-panel">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
          <span class="notif-badge" id="notif-badge" hidden>0</span>
        </button>
        <div class="notif-panel" id="notif-panel" role="dialog" aria-label="通知中心" hidden>
          <div class="notif-head">
            <strong>通知中心</strong>
            <button class="notif-link" id="notif-mark-read" type="button">全部標為已讀</button>
          </div>
          <ul class="notif-list" id="notif-list"></ul>
          <div class="notif-foot">
            <button class="btn" id="notif-permission" type="button" hidden>開啟系統通知</button>
            <span>網頁開著時每 5 分鐘檢查一次；想在關閉時也收到，可訂閱行事曆或 RSS。</span>
          </div>
        </div>
      </div>
    </div>
  </header>
  <div class="toasts" id="toasts" aria-live="polite"></div>
  <button class="to-top" id="to-top" type="button" aria-label="回到頂部" hidden>
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5"/><path d="m5 12 7-7 7 7"/></svg>
  </button>
  <script type="application/json" id="notif-data">${buildNotificationsJson(data.tracked, data.cachedAt).replace(/</g, '\\u003c')}</script>
  <script src="${scriptSrc('notifications.js')}" defer></script>

  <div class="layout">
    ${renderFilterRail()}

    <main class="main" id="main">
      <div class="page-head">
        <h1 class="sr-only">OS Version Tracker</h1>
        <p class="intro">iOS 與 Android 最新版本，以及隨之而來的 Xcode、SDK、資安與商店上架需求。依重要性與時間排序；類型與平台篩選套用在「待處理」與「最新動態」，搜尋則涵蓋整頁。</p>
        <p class="stale-note" id="stale-note" role="status" data-updated="${esc(data.cachedAt)}" hidden></p>
        <p class="search-status" id="search-status" role="status" hidden><span data-search-summary></span><button type="button" class="feed-more search-clear" id="search-clear">清除搜尋</button></p>
      </div>

      ${renderNow(data)}
      ${renderFeed(data)}

      ${renderSecuritySection(data)}
      ${renderCrashesSection(data)}
      ${renderCordovaSection(data)}
      ${renderFrameworksSection(data)}

      ${renderNewsSection(data)}

      ${renderTrendsSection(data)}

      ${renderPlatformSection('ios', 'iOS', ios,
        renderActions(data.iosActions) + renderVersionDistribution('ios', data) + renderTiles(iOSTiles(data.iosToolchain, data.announcedDevices)) + renderAppleStatus(data)
        + '<p class="news-jump"><a href="#news">查看 iOS 開發者新聞 →</a></p>'
        + renderSources(data, ['ios', 'appleDeadline', 'appleRequirements', 'iosToolchain', 'xcodeSupport', 'adoption', 'osShare', 'appleNews', 'appleStatus']))}

      ${renderPlatformSection('android', 'Android', android,
        renderActions(data.androidActions) + renderVersionDistribution('android', data) + renderTiles(androidTiles(data.androidToolchain))
        + '<p class="news-jump"><a href="#news">查看 Android 開發者新聞 →</a></p>'
        + renderSources(data, ['android', 'googleDeadline', 'androidToolchain', 'androidCompat', 'playBilling', 'playPolicy', 'pageSize', 'osShare', 'androidNews']))}

      ${renderCompatSection(data)}

      ${renderDeadlinesSection(data)}

      ${renderBanksSection(data)}

      ${renderPrivacySection(data)}

      ${renderApiSection(data, refresh)}

      ${renderLegalSection()}
    </main>

    ${renderSnapshotRail(data)}
  </div>
  <footer class="site-foot">
    <a href="legal/">免責聲明</a> · <a href="legal/#7-隱私">隱私</a> · <a href="legal/sources/">資料來源與授權</a> · <a href="https://github.com/louisxie0830/os-version-tracker/blob/master/SECURITY.md" rel="noopener noreferrer" target="_blank">私密回報</a> · 非官方網站，資料僅供參考
  </footer>
  <div class="offline-banner" id="offline" hidden>目前離線，顯示的是上次抓取的資料</div>
  ${COMPONENT_SCRIPTS.map(name => `<script src="${scriptSrc(name)}" defer></script>`).join('\n  ')}
  <script src="${scriptSrc('app.js')}" defer></script>
</body>
</html>`;
}

// Kept for existing importers
export { pickTrendSeries } from './render-trends.js';
