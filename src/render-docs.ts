import { REPO_BLOB } from './source-registry.js';
import { API_ENDPOINTS, API_VERSION, buildApiFiles, legacyApiJson } from './api.js';
import { buildCalendar } from './calendar.js';
import { buildAtomFeed, buildNotificationsJson, type TrackedItem } from './changes.js';
import { SITE_URL, type AllVersions } from './fetch-all.js';
import { displayDate, esc, externalLink } from './render-actions.js';
import { platformClass, renderChoiceChips, renderSources } from './render-common.js';
import { KIND_LABEL } from './render-feed.js';

/** Reference sections: developer news, privacy rules, API docs and the legal notice. */


/** Key points on the page; the full terms live in DISCLAIMER.md / DISCLAIMER.en.md in the repository */
const LEGACY_ENDPOINTS: Array<[string, string]> = [
  ['api.json', '所有資料一次取得（舊格式：資料直接放在最上層，欄位只增不減；同樣附 license、termsUrl、attribution）'],
  ['notifications.json', '通知中心使用的新項目清單'],
  ['feed.xml', 'Atom feed：新的規定、公告、資安與銀行 App 版本調整'],
  ['calendar.ics', '上架期限行事曆（iCalendar，可訂閱）'],
  ['health.json', '這次建置的狀態與成功的資料來源數'],
];

export function renderApiSection(data: AllVersions, refresh: string): string {
  const files = buildApiFiles(data, SITE_URL);
  const size = (path: string) => {
    const body = files.get(path);
    return body ? `${Math.max(1, Math.round(Buffer.byteLength(body) / 1024))} KB` : '—';
  };
  // The other files, built the same way the static build writes them (health.json is a few dozen bytes)
  const kb = (body: string) => `${Math.max(1, Math.round(Buffer.byteLength(body) / 1024))} KB`;
  const legacySize = (path: string): string => {
    if (path === 'api.json') return kb(JSON.stringify(legacyApiJson(data, SITE_URL)));
    if (path === 'notifications.json') return kb(buildNotificationsJson(data.tracked, data.cachedAt));
    if (path === 'feed.xml') return kb(buildAtomFeed(data.tracked, SITE_URL, data.cachedAt));
    if (path === 'calendar.ics') return kb(buildCalendar(data.timeline, SITE_URL));
    return '1 KB';
  };
  const row = (path: string, text: string, kb: string) => `<tr>
      <td class="row-title" data-label="端點"><a href="${esc(path)}"><code>${esc(path)}</code></a></td>
      <td class="wrap-cell" data-label="內容">${esc(text)}</td>
      <td class="nowrap" data-label="大小">${esc(kb)}</td>
    </tr>`;
  const example = JSON.stringify({
    apiVersion: API_VERSION,
    updatedAt: data.cachedAt,
    sources: { ios: { label: '…', url: '…', fetchedAt: data.cachedAt, ok: true } },
    data: { '…': '…' },
  }, null, 2);
  return `<section class="panel" id="api">
    <h2>API</h2>
    <p class="table-note">網站上的資料都可以用 JSON 取得：免金鑰、可跨網域讀取（CORS），隨網站${refresh}更新。都是靜態檔案，不支援查詢參數，請依主題選擇端點。完整清單與各資料來源的狀態見 <a href="api/index.json"><code>api/index.json</code></a>。</p>

    <h3 class="subhead">主題端點</h3>
    <div class="table-wrap"><table class="compat-table stack-on-mobile">
      <thead><tr><th>端點</th><th>內容</th><th>大小</th></tr></thead>
      <tbody data-search-rows>${row('api/index.json', '所有端點的清單與說明，以及每個資料來源的抓取狀態', size('api/index.json'))}${API_ENDPOINTS.map(e => row(e.path, e.description, size(e.path))).join('')}</tbody>
    </table></div>

    <h3 class="subhead">回傳格式</h3>
    <p class="table-note">每個主題端點的外層都相同。<code>sources</code> 列出相關資料來源，<code>ok: false</code> 表示該來源這次抓取失敗、<code>data</code> 可能不完整；<code>apiVersion</code> 只在格式有不相容的修改時才會增加。</p>
    <pre class="api-code" tabindex="0" role="region" aria-label="回應格式範例"><code>${esc(example)}</code></pre>

    <h3 class="subhead">其他檔案</h3>
    <div class="table-wrap"><table class="compat-table stack-on-mobile">
      <thead><tr><th>端點</th><th>內容</th><th>大小</th></tr></thead>
      <tbody data-search-rows>${LEGACY_ENDPOINTS.map(([path, text]) => row(path, text, legacySize(path))).join('')}</tbody>
    </table></div>

    <h3 class="subhead">動態項目的類型（kind）</h3>
    <p class="table-note"><code>api/feed.json</code>、<code>notifications.json</code>、<code>feed.xml</code> 的每個項目都有 <code>kind</code>。之後可能會增加新的值，<strong>遇到不認得的值請略過</strong>，不要當成錯誤。</p>
    <div class="table-wrap"><table class="compat-table stack-on-mobile">
      <thead><tr><th>kind</th><th>意思</th></tr></thead>
      <tbody data-search-rows>${(Object.entries(KIND_LABEL) as Array<[TrackedItem['kind'], string]>).map(([kind, label]) => `<tr><td class="row-title" data-label="kind"><code>${esc(kind)}</code></td><td data-label="意思">${esc(label)}</td></tr>`).join('')}</tbody>
    </table></div>

    <h3 class="subhead">範例</h3>
    <pre class="api-code" tabindex="0" role="region" aria-label="指令範例"><code>${esc(`curl -s ${SITE_URL}/api/versions.json | jq '.data.ios[0].version'

const res = await fetch('${SITE_URL}/api/now.json');
const { updatedAt, data } = await res.json();`)}</code></pre>

    <p class="table-note mt-12">使用須知：每個回應都附 <code>license</code>、<code>termsUrl</code> 與 <code>attribution</code>（各來源的授權、條款與須標示的來源或作者），轉用資料時請一併保留。版本與品牌占比來自 StatCounter（CC BY-SA 3.0），社群討論來自 Stack Overflow（CC BY-SA，須標示原作者），資安公告含 GitHub Advisory Database（CC BY 4.0）；銀行與 App 名稱已部分遮罩。各來源細節見<a href="legal/sources/">資料來源合規清冊</a>，其餘見<a href="legal/">免責聲明</a>。</p>
  </section>`;
}

export function renderLegalSection(): string {
  return `<section class="panel" id="legal">
    <h2>免責聲明 · Disclaimer</h2>
    <ul class="legal-points">
      <li><strong>非官方網站：</strong>與 Apple、Google 及本網站提及的公司、銀行均無隸屬、合作或背書關係；商標屬於各自的權利人。</li>
      <li><strong>僅供參考：</strong>資料由程式自動抓取，可能延遲、不完整或錯誤，不構成法律、法規遵循或任何專業建議。在法律允許的範圍內，作者對因使用本網站所生的損害不負責任。</li>
      <li><strong>隱私：</strong>不使用 Cookie 或追蹤工具，也不蒐集訪客的個人資料；本站會為標示來源而處理公開社群內容（Stack Overflow、GitHub）的作者名稱，詳見<a href="legal/#7-隱私">隱私說明</a>。</li>
      <li>本專案以生成式 AI 工具輔助開發。</li>
    </ul>
    <p class="legal-lead" lang="en">Unofficial site, not affiliated with Apple, Google or any company or bank mentioned. Data is collected automatically and provided for reference only, without warranty. No cookies or tracking, and no personal data about visitors; the names of authors of public community content (Stack Overflow, GitHub) are shown to credit them, see the <a href="legal/en/#7-privacy">privacy section</a>. Built with the help of generative AI tools.</p>
    <p class="legal-links">使用前請閱讀完整條款：<a href="legal/">中文版</a> · <a href="legal/en/" lang="en">English version</a> · <a href="legal/sources/">資料來源合規清冊</a> · ${externalLink(`${REPO_BLOB}/SECURITY.md`, '私密回報（權利主張、個資請求、資安漏洞）')}</p>
  </section>`;
}

const NEWS_CATEGORY: Record<string, string> = { announcement: '公告', release: '版本發布', blog: '部落格' };

const NEWS_SHOWN = 25;

export function renderNewsSection(data: AllVersions): string {
  const items = data.devNews ?? [];
  if (!items.length) return '';
  const sources = [...new Set(items.map(i => i.source))];
  // Rows past the first NEWS_SHOWN wait behind "show more"; data-news holds the values that let a row through
  // the news filter (its platform, and "important")
  const capped = items.length > NEWS_SHOWN;
  const rows = items.map((n, i) => `<li class="news-item${i >= NEWS_SHOWN ? ' list-extra' : ''}" data-news="${esc(n.platform)}${n.important ? '|important' : ''}" data-key="news:${esc(n.url)}">
      <span class="news-date">${esc(displayDate(n.date))}</span>
      <span class="tl-platform ${platformClass(n.platform)}">${esc(n.platform)}</span>
      <span class="news-cat">${NEWS_CATEGORY[n.category] ?? ''}</span>
      ${n.important ? '<span class="status status-urgent news-flag">重要</span>' : ''}
      ${externalLink(n.url, esc(n.title), 'news-title')}
      <span class="news-source">${esc(n.source)}</span>
    </li>`).join('');
  return `<section class="panel" id="news">
    <h2>開發者新聞</h2>
    <p class="table-note">彙整 ${sources.length} 個官方來源近 60 天的公告、版本發布與部落格文章（每個來源最多 12 則，發文較多的來源因此涵蓋較短的期間），標題維持原文。「重要」為規定、期限、棄用、重大版本或服務異常等需要留意的項目。</p>
    <news-list filters="news">
      ${renderChoiceChips('news', '篩選新聞', [['all', '全部'], ['iOS', 'iOS'], ['Android', 'Android'], ['跨平台', '跨平台'], ['important', '只看重要']], { className: 'news-filters' })}
      <div class="case mt-12">
        <ul class="news news-feed${capped ? ' is-collapsed' : ''}"${capped ? ' data-capped' : ''} id="news-list" data-news-items data-search-rows>${rows}</ul>
        ${capped ? `<button type="button" class="news-show-more" id="news-show-more" data-show-more>顯示更多（共 ${items.length} 則）</button>` : ''}
        <div class="news-empty" data-news-empty hidden>沒有符合的新聞</div>
        <p class="sr-only" role="status" data-filter-status></p>
      </div>
    </news-list>
    ${renderSources(data, ['devNews'])}
  </section>`;
}

export function renderPrivacySection(data: AllVersions): string {
  const p = data.privacy;
  if (!p) return '';
  const apis = p.appleRequiredReasonApis.map(c => `<div class="privacy-card">
      ${externalLink(c.url, `${esc(c.category)}`, 'crash-title')}
      <div class="tl-source"><code>${esc(c.key)}</code></div>
      <div class="action-detail">API：</div>
      <div class="privacy-apis">${c.apis.map(api => `<code>${esc(api)}</code>`).join('')}</div>
      <div class="privacy-reasons">${c.reasons.map(r => `<span title="${esc(r.description)}"><code>${esc(r.code)}</code></span>`).join('')}</div>
    </div>`).join('');
  const links = (platform: 'ios' | 'android') => p.links.filter(l => l.platform === platform).map(l =>
    `<li>${externalLink(l.url, `${esc(l.title)}`)}<span>${esc(l.note)}</span></li>`).join('');
  return `<section class="panel" id="privacy">
    <h2>隱私規範</h2>
    <div class="subhead">iOS：Required Reason API（使用這些 API 須在 PrivacyInfo.xcprivacy 宣告原因）</div>
    <div class="privacy-grid" data-search-rows>${apis}</div>
    <div class="subhead">iOS：須附隱私清單與簽章的常用第三方 SDK（${p.appleSdksRequiringManifest.length} 個）</div>
    <details class="sdk-list"><summary>展開清單：專案用到其中任何一個，請確認版本已內含 PrivacyInfo.xcprivacy 並已簽章</summary>
      <div class="sdk-chips">${p.appleSdksRequiringManifest.map(n => `<span>${esc(n)}</span>`).join('')}</div>
    </details>
    <div class="privacy-links">
      <div><div class="subhead">Apple 官方文件</div><ul>${links('ios')}</ul></div>
      <div><div class="subhead">Google Play（SDK Index 沒有公開資料，請在 Play Console 查看各 App 的 SDK 警告）</div><ul>${links('android')}</ul></div>
    </div>
    ${renderSources(data, ['privacy'])}
  </section>`;
}
