import type { AllVersions } from './fetch-all.js';
import type { CordovaPlatform } from './fetchers/cordova.js';
import type { CrashItem } from './fetchers/crashes.js';
import { inVersionRange, SDK_PACKAGES, type SdkAdvisory } from './fetchers/security.js';
import { displayDate, esc, externalLink } from './render-actions.js';
import type { ActionStatus } from './types.js';
import { platformClass, renderSources } from './render-common.js';

/** Security, crashes and Cordova sections. */

const CRASH_KIND: Record<CrashItem['kind'], { label: string; status: ActionStatus }> = {
  known: { label: '已知問題', status: 'urgent' },
  fixed: { label: '已修復', status: 'ok' },
  reported: { label: '社群回報', status: 'upcoming' },
};

function renderCrashList(title: string, items: CrashItem[], note: string, limit = 8): string {
  const list = items.length
    ? `<ul class="crash-list" data-search-rows>${items.slice(0, limit).map(c => `<li data-key="crash:${esc(c.url)}:${esc(c.title.slice(0, 40))}">
        <div class="tl-head">
          <span class="status status-${CRASH_KIND[c.kind].status}">${CRASH_KIND[c.kind].label}</span>
          ${c.newOs ? '<span class="status status-urgent">新系統相關</span>' : ''}
          <span class="crash-context">${esc(c.context)}</span>
        </div>
        ${externalLink(c.url, `${esc(c.title)}`, 'crash-title')}
        ${c.source === 'GitHub' || c.source === 'Stack Overflow' ? `<div class="tl-source">${c.date ? `${esc(displayDate(c.date))} ${c.source === 'GitHub' ? '回報' : '發問'} · ` : ''}${c.source === 'GitHub' ? '👍' : (c.reactions ?? 0) < 0 ? '▼' : '▲'} ${Math.abs(c.reactions ?? 0)} · ${c.source === 'GitHub' ? '💬' : '回答'} ${c.comments ?? 0}${c.author ? ` · 作者 ${externalLink(c.author.url, esc(c.author.name))}` : ''}${c.source === 'Stack Overflow' ? ` · ${externalLink('https://creativecommons.org/licenses/by-sa/4.0/', 'CC BY-SA')}` : ''}</div>` : ''}
      </li>`).join('')}</ul>`
    : '<div class="case-body empty">目前沒有相關的閃退紀錄。</div>';
  return `<div class="case">
    <div class="case-head">
      <span class="case-no">${title}</span>
      <span class="case-count">${items.length > limit ? `顯示 ${limit} / ${items.length} 項` : items.length ? `共 ${items.length} 項` : ''}</span>
    </div>
    ${list}
    <div class="crash-note">${note}</div>
  </div>`;
}

export function renderCrashesSection(data: AllVersions): string {
  const c = data.crashes;
  if (!c) return '';
  const iosMajor = data.ios.find(v => !v.isBeta)?.version.match(/^\d+/)?.[0];
  const androidMajor = data.android.find(v => !v.isBeta)?.version.match(/\d+/)?.[0];
  return `<section class="panel" id="crashes">
    <h2>閃退與當機</h2>
    <p class="table-note">從官方 release notes 整理出與閃退、當機、無回應相關的已知問題與修正，加上熱門 SDK 在 GitHub 上近 30 天的閃退回報，以及 Stack Overflow 上的社群討論。升級系統或 SDK 前可以先看這裡。</p>
    <div class="crash-grid">
      ${renderCrashList(`iOS ${iosMajor ?? ''} 與 Xcode`, c.ios, 'Apple 官方 release notes 的 Known Issues / Resolved Issues')}
      ${renderCrashList(`Android ${androidMajor ?? ''}`, c.android, 'Android 官方 release notes（最新 QPR beta）的已知問題與修正')}
      ${renderCrashList('熱門 SDK（GitHub 近 30 天）', c.sdks, 'Firebase、Facebook、React Native、Flutter、Lottie、Glide、OkHttp、Sentry 等 18 個 repo；社群回報，未必已確認', 10)}
      ${renderCrashList('社群討論（Stack Overflow 近 90 天）', c.community, '依票數與回答數排序；標題含閃退、當機、無回應的 iOS / Android / 跨平台問題')}
    </div>
    <div class="forum-links">
      <span>Apple Developer Forums（需在瀏覽器開啟）：</span>
      <a href="https://developer.apple.com/forums/topics/community" target="_blank" rel="noopener">社群主題</a>
      <a href="https://developer.apple.com/forums/search?q=crash" target="_blank" rel="noopener">搜尋 crash</a>
      <a href="https://developer.apple.com/forums/search?q=hang" target="_blank" rel="noopener">搜尋 hang</a>
      <a href="https://developer.apple.com/forums/topics/developer-tools-and-services/developer-tools-and-services-xcode" target="_blank" rel="noopener">Xcode 討論區</a>
    </div>
    ${renderSources(data, ['crashes'])}
  </section>`;
}

function renderCordovaPlatform(p: CordovaPlatform, advisories = ''): string {
  const notes = (title: string, items: string[], limit: number) => items.length
    ? `<div class="cordova-notes"><div class="cordova-notes-title">${title}</div><ul>${items.slice(0, limit).map(i => `<li>${esc(i)}</li>`).join('')}</ul>${items.length > limit ? `<div class="tl-source">另有 ${items.length - limit} 項，見 release notes</div>` : ''}</div>`
    : '';
  return `<div class="case">
    <div class="case-head">
      <span class="case-no">${esc(p.name)} ${esc(p.latest)}</span>
      <span class="case-count">${p.releasedAt ? `${esc(displayDate(p.releasedAt))} 發布` : ''}</span>
    </div>
    <div class="case-body">
      <div class="action-detail">需要 Node ${esc(p.node ?? '未標示')}</div>
      ${advisories ? `<div class="cordova-notes"><div class="cordova-notes-title">已知漏洞</div>${advisories}</div>` : ''}
      ${notes(`從 ${esc(p.majorRelease)} 之前的版本升級：破壞性變更`, p.breaking, 8)}
      ${notes(`${esc(p.latest)} 修正的問題`, p.fixes, 6)}
      <div class="tl-source">${externalLink(p.notesUrl, '完整 release notes')} · ${externalLink(p.issuesUrl, 'GitHub issues')}</div>
    </div>
  </div>`;
}

/** Advisories touching one npm package, with the range that applies to it */
export function advisoriesFor(data: AllVersions, pkg: string): Array<{ advisory: SdkAdvisory; vulnerable?: string; patched?: string }> {
  return (data.security?.advisories ?? []).flatMap(advisory => (advisory.ranges ?? [])
    .filter(r => r.package === pkg)
    .map(r => ({ advisory, vulnerable: r.vulnerable, patched: r.patched })));
}

export function renderAdvisoryNotes(data: AllVersions, pkg: string, latest: string): string {
  const found = advisoriesFor(data, pkg);
  if (!found.length) return '<span class="tl-source">沒有已知漏洞</span>';
  return found.map(({ advisory: a, vulnerable, patched }) => {
    const stillAffected = inVersionRange(latest, vulnerable);
    return `<div class="plugin-advisory">
      <span class="status status-${stillAffected ? 'urgent' : SEVERITY[a.severity].status}">${stillAffected ? '最新版仍受影響' : SEVERITY[a.severity].label}</span>
      ${externalLink(a.url, esc(vulnerable ? `${vulnerable} 受影響` : a.summary))}${patched ? `<span class="tl-source">${esc(patched)} 修正${a.cve ? ` · ${esc(a.cve)}` : ''}</span>` : ''}
    </div>`;
  }).join('');
}

function renderCordovaPlugins(data: AllVersions): string {
  const plugins = data.cordova?.plugins ?? [];
  if (!plugins.length) return '';
  const requires = (r: Record<string, string>) => Object.entries(r)
    .filter(([k]) => k !== 'cordova')
    .map(([k, v]) => `${k.replace('cordova-', '')} ${v}`)
    .join('、') || '—';
  const rows = plugins.map(p => `<tr>
      <td class="row-title" data-label="Plugin">${externalLink(p.repoUrl, esc(p.name.replace('cordova-plugin-', '')))}</td>
      <td data-label="最新版"><code>${esc(p.latest)}</code></td>
      <td data-label="需要平台">${esc(requires(p.requires))}</td>
      <td class="wrap-cell" data-label="已知漏洞">${renderAdvisoryNotes(data, p.name, p.latest)}</td>
    </tr>`).join('');
  return `<h3 class="subhead">核心 plugin</h3>
    <p class="table-note">最新版本與它需要的最低平台版本（取自 npm 的 cordovaDependencies），以及 GitHub Advisory Database 的已知漏洞與修正版本。專案用的版本低於「修正」版本就受影響。</p>
    <div class="table-wrap"><table class="compat-table stack-on-mobile">
      <thead><tr><th>Plugin</th><th>最新版</th><th>需要平台</th><th>已知漏洞</th></tr></thead>
      <tbody data-search-rows>${rows}</tbody>
    </table></div>`;
}

export function renderCordovaSection(data: AllVersions): string {
  const platforms = data.cordova?.platforms ?? [];
  const issues = data.crashes?.cordova ?? [];
  if (!platforms.length && !data.crashes) return '';
  return `<section class="panel" id="cordova">
    <h2>Cordova 版本與閃退</h2>
    <p class="table-note">cordova-ios / cordova-android 的最新版本，以及升級前要注意的破壞性變更（取自官方 RELEASENOTES.md）；7 個核心 plugin 的版本、平台需求與已知漏洞；最後是平台與 plugin 在 GitHub 上近半年的閃退、白屏、無法啟動回報。</p>
    <div class="crash-grid">
      ${platforms.map(p => renderCordovaPlatform(p, renderAdvisoryNotes(data, p.name, p.latest))).join('')}
    </div>
    ${renderCordovaPlugins(data)}
    <div class="mt-16">
      ${renderCrashList('閃退與無法啟動（GitHub 近半年）', issues, 'apache/cordova-ios、cordova-android 與 camera、inappbrowser、file 等 7 個核心 plugin；社群回報，未必已確認。提到最新 iOS / Android 版本的排在前面', 10)}
    </div>
    ${renderSources(data, ['cordova', 'crashes'])}
  </section>`;
}

const SEVERITY: Record<SdkAdvisory['severity'], { label: string; status: string }> = {
  critical: { label: '嚴重', status: 'urgent' },
  high: { label: '高', status: 'urgent' },
  medium: { label: '中', status: 'upcoming' },
  low: { label: '低', status: 'info' },
  unknown: { label: '未分級', status: 'info' },
};

function securityCard(title: string, rows: string[], note: string, empty: string, limit = 8, total = rows.length): string {
  return `<div class="case">
    <div class="case-head">
      <span class="case-no">${title}</span>
      <span class="case-count">${total > limit ? `顯示 ${limit} / ${total} 項` : total ? `共 ${total} 項` : ''}</span>
    </div>
    ${rows.length ? `<ul class="crash-list" data-search-rows>${rows.slice(0, limit).join('')}</ul>` : `<div class="case-body empty">${empty}</div>`}
    <div class="crash-note">${note}</div>
  </div>`;
}

export function renderSecuritySection(data: AllVersions): string {
  const s = data.security;
  if (!s) return '';
  const exploitedBadge = (cves: string[]) => cves.length ? `<span class="status status-urgent">可能已遭利用：${esc(cves.join('、'))}</span>` : '';

  const kev = s.exploited.map(v => `<li data-key="security:kev:${esc(v.cve)}">
      <div class="tl-head">
        <span class="tl-platform ${platformClass(v.platform)}">${esc(v.platform)}</span>
        ${v.ransomware ? '<span class="status status-urgent">勒索軟體使用</span>' : ''}
        <span class="crash-context">${esc(displayDate(v.dateAdded))} 列入 · ${esc(v.product)}</span>
      </div>
      ${externalLink(v.url, `${esc(v.cve)}：${esc(v.name)}`, 'crash-title')}
      <div class="tl-source">${esc(v.description)}</div>
    </li>`);

  const apple = s.apple.map(r => `<li${r.url ? ` data-key="security:apple:${esc(r.url)}"` : ''}>
      <div class="tl-head">
        ${exploitedBadge(r.exploited)}
        <span class="crash-context">${esc(displayDate(r.date))}${r.cves ? ` · ${r.cves} 個 CVE` : r.url ? '' : ' · 沒有公布 CVE'}</span>
      </div>
      ${r.url ? externalLink(r.url, esc(r.name), 'crash-title') : `<span class="crash-title">${esc(r.name)}</span>`}
    </li>`);

  const android = s.android.map(b => `<li data-key="security:android:${esc(b.url)}">
      <div class="tl-head">
        ${exploitedBadge(b.exploited)}
        <span class="crash-context">${esc(displayDate(b.published))} 發布${b.patchLevels.length ? ` · 修補程式等級 ${esc(displayDate(b.patchLevels.join(' / ')))}` : ''}${b.cves ? ` · ${b.cves} 個 CVE` : b.cves === 0 ? ' · 本月沒有公布 CVE' : ''}</span>
      </div>
      ${externalLink(b.url, esc(b.title), 'crash-title')}
      ${b.mostSevere ? `<div class="tl-source">最嚴重：${esc(b.mostSevere)}</div>` : ''}
    </li>`);

  const advisories = s.advisories.map(a => `<li data-key="security:ghsa:${esc(a.id)}">
      <div class="tl-head">
        <span class="status status-${SEVERITY[a.severity].status}">${SEVERITY[a.severity].label}</span>
        <span class="tl-platform ${platformClass(a.platform)}">${esc(a.platform)}</span>
        <span class="crash-context">${esc(displayDate(a.published))} · ${esc(a.packages.join('、'))}</span>
      </div>
      ${externalLink(a.url, esc(a.summary), 'crash-title')}
      <div class="tl-source">${esc(a.id)}${a.cve ? ` · ${esc(a.cve)}` : ''}</div>
    </li>`);

  return `<section class="panel" id="security">
    <h2>資安</h2>
    <p class="table-note">整理會影響 App 的資安訊息：已確認在外遭到利用的 iOS / Android / WebView 漏洞、Apple 與 Android 的安全性更新，以及常用 SDK 的資安公告。標示「可能已遭利用」的項目，建議盡快提醒使用者更新系統，或升級受影響的 SDK。</p>
    <div class="crash-grid">
      ${securityCard('已遭利用的漏洞（近 180 天）', kev, '美國 CISA 已知遭利用漏洞清單（KEV）；Chromium 會影響 Android WebView 與 Chrome', '近 180 天沒有新增與 iOS / Android / WebView 相關的項目。')}
      ${securityCard('Apple 安全性更新（近 120 天）', apple, 'iOS / iPadOS、Safari（WKWebView 使用的 WebKit）與 Xcode；取自 Apple 安全性更新頁面', '近 120 天沒有相關的安全性更新。')}
      ${securityCard('Android 安全性公告', android, '每月的 Android Security Bulletin；修補程式等級可在裝置的「設定 → 安全性」查看', '目前抓不到 Android 安全性公告。', 3)}
      ${securityCard('常用 SDK 資安公告', advisories, `取自 GitHub Advisory Database：Cordova、React Native、Capacitor、Flutter WebView、OkHttp、Retrofit、Glide、Alamofire、Firebase、Sentry 等 ${SDK_PACKAGES.length} 個套件；依公布日期排序`, '這些套件目前沒有資安公告。', 8)}
    </div>
    ${renderSources(data, ['security'])}
  </section>`;
}
