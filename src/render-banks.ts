import { androidApiLevel } from './android-api.js';
import type { AllVersions } from './fetch-all.js';
import { compareVersions } from './fetchers/ios-toolchain.js';
import { bankAppKey, type BankChange } from './history.js';
import { displayDate, esc, externalLink } from './render-actions.js';
import { renderSources } from './render-common.js';

/** Taiwan bank App minimum versions, with filters, sort and change badges. */

/** "iOS 13 10 個 · iOS 15 10 個 …": app counts grouped by major version, lowest version first */
function countByMajor(values: string[], prefix: string): string {
  const counts = new Map<string, number>();
  for (const v of values) {
    const major = v.match(/^\d+/)?.[0];
    if (major) counts.set(major, (counts.get(major) ?? 0) + 1);
  }
  return [...counts]
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .map(([major, n]) => `<span>${prefix} ${major}<strong>${n} 個</strong></span>`)
    .join('');
}

const BANK_APP_KIND: Record<string, string> = { business: '企業', merchant: '商家收款', auth: '認證' };

/** Filters for the bank table: app kind, minimum iOS / Android major, and a sort; applied in the browser (app.js) */
function renderBankFilters(banks: AllVersions['twBanks'], hasChanges: boolean, requiredTarget?: number): string {
  const majors = (values: Array<string | undefined>) => [...new Set(values.flatMap(v => v?.match(/^\d+/)?.[0] ?? []))].sort((a, b) => Number(a) - Number(b));
  const chips = (group: string, label: string, options: Array<[string, string]>) => `<div class="bank-filter">
      <span class="rail-label">${label}</span>
      <div class="chips" role="group" aria-label="${label}" data-bank-filter="${group}">
        <button type="button" class="chip is-active" data-value="all" aria-pressed="true">全部</button>
        ${options.map(([value, text]) => `<button type="button" class="chip" data-value="${esc(value)}" aria-pressed="false">${esc(text)}</button>`).join('')}
      </div>
    </div>`;
  const hasOthers = banks.some(b => (b.kind ?? 'personal') !== 'personal');
  return `<div class="bank-filters">
    ${hasOthers ? chips('kind', 'App 類型', [['personal', '個人行動銀行'], ['other', '企業／收款／認證']]) : ''}
    ${chips('ios', '最低 iOS', majors(banks.map(b => b.ios?.minOs)).map(m => [m, `iOS ${m}`]))}
    ${chips('android', '最低 Android', majors(banks.map(b => b.android?.minOs)).map(m => [m, `Android ${m}`]))}
    ${hasChanges ? chips('changed', '版本調整', [['recent', '近 90 天有調整']]) : ''}
    ${requiredTarget && banks.some(b => b.android?.targetSdk && b.android.targetSdk < requiredTarget) ? chips('target', 'targetSdk', [['below', `低於 Play 規定（${requiredTarget}）`]]) : ''}
    <div class="bank-filter-foot">
      <label class="bank-sort">排序
        <select id="bank-sort">
          <option value="default">預設</option>
          <option value="ios">最低 iOS 由高到低</option>
          <option value="android">最低 Android 由高到低</option>
          <option value="target">targetSdk 由低到高</option>
        </select>
      </label>
      <span class="feed-count" id="bank-count" aria-live="polite">共 ${banks.length} 個 App</span>
    </div>
  </div>`;
}

/** The targetSdk Google Play currently requires for new apps and updates, e.g. 36 (from the deadline page) */
export function requiredTargetSdk(deadline: AllVersions['googleDeadline']): number | undefined {
  const req = deadline?.requirements.find(r => /new apps|app updates/i.test(r.platform)) ?? deadline?.requirements[0];
  const api = Number(req?.sdk.match(/API level (\d+)/i)?.[1]);
  return Number.isFinite(api) && api > 0 ? api : undefined;
}

export function renderBanksSection(data: AllVersions): string {
  const banks = data.twBanks;
  if (!banks.length) return '';
  const requiredTarget = requiredTargetSdk(data.googleDeadline);
  const belowTarget = requiredTarget ? banks.filter(b => b.android?.targetSdk && b.android.targetSdk < requiredTarget).length : 0;
  // The summary counts every listed app, the same set the table filters work on (older snapshots have no kind)
  const personal = banks.filter(b => (b.kind ?? 'personal') === 'personal');
  const others = banks.length - personal.length;
  const ios = banks.flatMap(b => b.ios ? [b.ios.minOs] : []);
  const android = banks.flatMap(b => b.android ? [b.android.minOs] : []);
  const sorted = (list: string[]) => [...list].sort(compareVersions);
  const strictestIos = sorted(ios).at(-1);
  const strictestAndroid = sorted(android.filter(v => /^\d/.test(v))).at(-1);
  const majorOf = (v?: string) => v?.match(/^\d+/)?.[0];
  // Sortable "major.minor" number; apps without a value sort last
  const sortValue = (v?: string) => { const m = v?.match(/^(\d+)(?:\.(\d+))?/); return m ? Number(m[1]) + Number(m[2] ?? 0) / 100 : -1; };
  // Minimum-version changes in the last 90 days, newest per app and platform
  const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const recent = (data.bankChanges ?? []).filter(c => c.date >= since);
  const changeOf = (b: AllVersions['twBanks'][number], platform: 'iOS' | 'Android') =>
    recent.find(c => c.key === bankAppKey(b) && c.platform === platform);
  const changeNote = (c?: BankChange) => c
    ? ` <span class="bank-change ${compareVersions(c.to, c.from) > 0 ? 'is-up' : 'is-down'}" title="${esc(displayDate(c.date))} 由 ${esc(c.from)} 調整為 ${esc(c.to)}">${compareVersions(c.to, c.from) > 0 ? '↑' : '↓'} 原 ${esc(c.from)}（${esc(c.date.slice(5).replace('-', '/'))}）</span>`
    : '';
  const changedApps = new Set(recent.map(c => c.key));
  const rows = banks.map((b, i) => {
    const api = b.android ? androidApiLevel(b.android.minOs) : undefined;
    const kind = (b.kind ?? 'personal') === 'personal' ? 'personal' : 'other';
    const target = b.android?.targetSdk;
    const below = !!(target && requiredTarget && target < requiredTarget);
    return `<tr data-index="${i}" data-kind="${kind}" data-target="${below ? 'below' : 'ok'}" data-target-sort="${target ?? 999}" data-changed="${changedApps.has(bankAppKey(b)) ? 'recent' : 'none'}" data-ios="${esc(majorOf(b.ios?.minOs) ?? '')}" data-android="${esc(majorOf(b.android?.minOs) ?? '')}" data-ios-sort="${sortValue(b.ios?.minOs)}" data-android-sort="${sortValue(b.android?.minOs)}">
      <td class="row-title" data-label="銀行"><strong>${esc(b.bank)}</strong><div class="tl-source">${esc(b.app)}${b.kind && BANK_APP_KIND[b.kind] ? ` <span class="badge badge-sm bank-kind">${BANK_APP_KIND[b.kind]}</span>` : ''}</div></td>
      <td data-label="最低 iOS">${b.ios ? `<span>${externalLink(b.ios.url, `iOS ${esc(b.ios.minOs)}`)}${changeNote(changeOf(b, 'iOS'))}</span>` : '—'}</td>
      <td data-label="最低 Android">${b.android ? `<span>${externalLink(b.android.url, `Android ${esc(b.android.minOs)}`)}${api ? ` <span class="tl-source">API ${api}</span>` : ''}${changeNote(changeOf(b, 'Android'))}</span>` : '—'}</td>
      <td data-label="targetSdk">${target ? `<span>${target}${below ? ` <span class="bank-change is-up" title="Google Play 規定新 App 與更新須 target ${requiredTarget} 以上；在期限前送出的版本可能仍是舊值">低於 ${requiredTarget}</span>` : ''}</span>` : '—'}</td>
      <td class="bank-updated" data-label="最近更新">${esc(displayDate([b.ios?.updated && `iOS ${b.ios.updated}`, b.android?.updated && `Android ${b.android.updated}`].filter(Boolean).join(' · ')) || '—')}</td>
    </tr>`;
  }).join('');
  return `<section class="panel" id="banks">
    <h2>銀行 App 支援版本</h2>
    <p class="table-note">各銀行官方行動銀行 App 在 App Store 與 Google Play（台灣區）標示的最低支援版本，每次更新網站時重新抓取。部分銀行另列出企業、商家收款與認證 App（以標籤區分），分布統計與篩選都包含這些 App。可作為金融業 App 設定 Deployment Target / minSdk 的業界參考。銀行與 App 名稱以部分遮罩顯示；商店標示的版本不代表銀行的官方支援政策。</p>
    <div class="bank-summary">
      <div><div class="tile-label">最低 iOS 分布</div><div class="share-chips">${countByMajor(ios, 'iOS')}</div></div>
      <div><div class="tile-label">最低 Android 分布</div><div class="share-chips">${countByMajor(android, 'Android')}</div></div>
      <div class="tl-source">共 ${banks.length} 個 App${others ? `（個人行動銀行 ${personal.length} 個、企業／收款／認證 ${others} 個）` : ''}；要求最高：iOS ${esc(strictestIos ?? '—')}、Android ${esc(strictestAndroid ?? '—')}；${changedApps.size ? `<strong>近 90 天有 ${changedApps.size} 個 App 調整最低版本</strong>` : '近 90 天沒有 App 調整最低版本'}${requiredTarget ? `；Google Play 目前規定 targetSdk ${requiredTarget}，${belowTarget ? `<strong>${belowTarget} 個 App 的最新版還低於這個值</strong>` : '所有 App 都已達到'}` : ''}</div>
    </div>
    ${renderBankFilters(banks, changedApps.size > 0, requiredTarget)}
    <div class="table-wrap"><table class="compat-table stack-on-mobile bank-table">
      <thead><tr><th>銀行 / App</th><th>最低 iOS</th><th>最低 Android</th><th>targetSdk</th><th>最近更新</th></tr></thead>
      <tbody id="bank-rows">${rows}</tbody>
    </table></div>
    <p class="feed-empty" id="bank-empty" hidden>沒有符合篩選的 App。</p>
    ${renderSources(data, ['twBanks'])}
  </section>`;
}
