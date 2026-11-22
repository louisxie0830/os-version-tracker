import type { AllVersions } from './fetch-all.js';
import { displayDate, esc, externalLink } from './render-actions.js';
import { securityFindings, FISAC_URL, type FinancialNotice, type SecurityFinding } from './security-intelligence.js';

const empty = (message: string) => `<p class="table-note">${message}</p>`;
const stamp = (value?: string) => value ? esc(value.slice(0, 19).replace('T', ' ')) : '未取得';
const table = (caption: string, headers: string[], rows: string[][]) => rows.length
  ? `<div class="table-wrap"><table class="compat-table stack-on-mobile security-table"><caption>${esc(caption)}</caption><thead><tr>${headers.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${row.map((cell, i) => `<td data-label="${esc(headers[i])}">${cell}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`
  : empty('本次沒有可顯示的資料，請查看「來源狀態」；未取得資料不代表沒有風險。');
const field = (label: string, name: string, type = 'text', extra = '') => `<label>${esc(label)}<input name="${name}" type="${type}" ${extra}></label>`;
const select = (label: string, name: string, values: Array<[string, string]>) => `<label>${esc(label)}<select name="${name}">${values.map(([v, text]) => `<option value="${esc(v)}">${esc(text)}</option>`).join('')}</select></label>`;
const findingKey = (f: SecurityFinding) => `${f.id}|${f.product}|${f.fixed ?? ''}`;
const rowState = (key: string) => `<span data-security-state="${esc(key)}">待確認適用性</span>`;
const filter = (id: string) => `<label class="security-search">篩選此表<input type="search" data-security-filter="${id}" placeholder="輸入銀行、產品、CVE 或版本"></label>`;

function financialTable(items: FinancialNotice[], phishing: boolean): string {
  return table(phishing ? '官方偽冒與釣魚通報' : '金融資安公告時間軸', ['公告／更新', '官方資訊', '目前可確認', '個人追蹤'], items.map(n => [
    `${n.published ? `${esc(n.published)} 公告<br>` : ''}${esc(n.updated)} 更新`,
    `${externalLink(n.url, esc(n.title))}<div class="tl-source">${esc(n.source)}</div>${(n.indicators ?? []).length ? `<ul class="security-indicators">${n.indicators!.map(i => `<li><code>${esc(i.value)}</code> · ${i.reportedStatus === 'inactive' ? '來源標示已失效' : '有效性待確認'}</li>`).join('')}</ul>` : ''}`,
    `${phishing ? '來源列為疑似偽冒／釣魚線索' : n.kind === 'regulatory' ? '主管機關裁罰公告' : '官方公告；事件階段待逐案確認'}<div class="tl-source">首次收錄 ${stamp(n.observedAt)}</div>`,
    rowState(n.id),
  ]));
}

function trackingForm(findings: SecurityFinding[], notices: FinancialNotice[]): string {
  return `<details class="security-details"><summary>新增處理紀錄／追蹤舊項目</summary>
    <p class="table-note">這是保存在此瀏覽器的個人紀錄，不會改寫官方公告。結案、恢復及不適用等判斷請附證據。</p>
    <form data-security-case-form class="security-form">
      ${select('追蹤項目', 'subject', [['manual', '自行新增事件或漏洞'], ...notices.map(n => [n.id, n.title] as [string, string]), ...findings.map(f => [findingKey(f), `${f.id} · ${f.product}`] as [string, string])])}
      ${field('自行新增時的標題', 'title', 'text', 'maxlength="300"')}
      ${select('處理狀態', 'status', [['pending', '待確認'], ['working', '處理中'], ['mitigated', '已採取措施'], ['fixed', '已修補／服務恢復'], ['verified', '已驗證'], ['not-applicable', '不適用']])}
      ${field('證據來源網址或文件位置', 'evidence', 'text', 'maxlength="500" required')}
      ${field('處理說明', 'note', 'text', 'maxlength="1000"')}
      <button type="submit" class="btn">儲存追蹤紀錄</button>
    </form><div data-security-case-list></div>
  </details>`;
}

export function renderSecurityCenter(data: AllVersions, existing: string): string {
  const report = data.security;
  const findings = securityFindings(report);
  const scores = new Map((report?.epss ?? []).map(s => [s.cve, s]));
  const notices = report?.financialNotices ?? [];
  const latestPatch = report?.android.flatMap(b => b.patchLevels).sort().at(-1);
  const remediation = table('漏洞與原廠修補對照', ['漏洞／產品', '受影響範圍', '原廠修補', '利用狀態'], findings.map(f => [
    `${externalLink(f.url, esc(f.id))}<div>${esc(f.product)}</div><div class="tl-source">${esc(f.component ?? f.platform)} · ${esc(f.date)}</div>`,
    esc(f.affected ?? '官方資料尚未取得或未明列，待確認'),
    esc(f.fixed ?? '尚未取得修補版本，請查看原廠公告'),
    f.exploited ? '<span class="status status-urgent">已有利用紀錄／原廠警示</span>' : '目前收錄資料未標示；不代表未遭利用',
  ]));
  const priority = table('漏洞評估順序（尚未比對你的環境）', ['評估順序', '漏洞／產品', '嚴重度／CVSS', 'EPSS', '適用性與處理'], findings.map((f, i) => {
    const score = scores.get(f.cve ?? '');
    return [`${i + 1}${f.exploited ? '<div class="status status-urgent">先核對已遭利用項目</div>' : ''}`,
      `${externalLink(f.url, esc(f.id))}<div>${esc(f.product)}</div>`,
      `${esc(f.severity ?? '未提供分級')}${f.cvss !== undefined ? ` · ${f.cvss.toFixed(1)}/10` : ' · CVSS 未提供'}`,
      score ? `${(score.score * 100).toFixed(2)}%<div class="tl-source">百分位 ${(score.percentile * 100).toFixed(1)} · ${esc(score.date)}</div>` : '未取得評分',
      rowState(findingKey(f))];
  }));
  const statusLabels = { ok: '取得資料', partial: '部分資料未取得', failed: '抓取失敗' };
  const sourceRows = [...(report?.subsources ?? []), ...(report?.newsSources ?? [])].map(s => [externalLink(s.url, esc(s.label)),
    `<span class="status status-${s.status === 'ok' ? 'ok' : 'urgent'}">${statusLabels[s.status]}</span> · ${s.count} 筆`,
    stamp(s.checkedAt), stamp(s.lastSuccessAt), esc(s.error ?? '—')]);
  for (const key of ['devNews'] as const) {
    const source = data.sources[key];
    if (source && !report?.newsSources?.length) sourceRows.push([externalLink(source.url, esc(source.label)), source.ok ? '主來源有資料；不代表所有新聞 feed 都成功' : '抓取失敗', stamp(source.fetchedAt), source.ok ? stamp(source.fetchedAt) : stamp(source.staleFrom), '金融事件由既有官方新聞來源彙整']);
  }
  const sources = table('各資安來源完整性', ['來源', '狀態／筆數', '本次檢查（UTC）', '最後完整成功（UTC）', '說明'], sourceRows);
  const tabs: Array<[string, string, string]> = [
    ['overview', '漏洞與修補', `${existing}<h3>漏洞與原廠修補對照</h3><p class="table-note">保留各產品與版本分支的修補資訊。Safari 修補不直接視為 iOS 修補；沒有明確版本時顯示待確認。</p>${filter('remediation')}<div id="security-remediation">${remediation}</div>`],
    ['incidents', '金融事件', `<h3>金融資安事件與裁罰時間軸</h3><p class="table-note">依主管機關公開公告排列；公告、事件發生及服務恢復是不同時間。商店下架原因未公布時，不能據此判定遭駭。</p>${filter('incidents')}<div id="security-incidents">${financialTable(notices.filter(n => n.kind !== 'phishing'), false)}</div>${trackingForm([], notices)}`],
    ['phishing', '偽冒通報', `<h3>偽冒銀行網站與假 App 通報</h3><p class="table-note">只顯示官方通報的線索及來源狀態；可疑網址以 hxxp、[.] 呈現，不提供直接開啟。收錄範圍為 F-ISAC 最新公開清單，完整內容請見 ${externalLink(FISAC_URL, 'F-ISAC')}。</p>${filter('phishing')}<div id="security-phishing">${financialTable(notices.filter(n => n.kind === 'phishing'), true)}</div><h4>已收錄銀行的官方商店識別</h4>${table('官方商店連結對照', ['銀行／App', 'App Store', 'Google Play'], data.twBanks.map(b => [esc(`${b.bank}／${b.app}`), b.ios ? externalLink(b.ios.url, '官方商店頁') : '未取得', b.android ? externalLink(b.android.url, '官方商店頁') : '未取得']))}`],
    ['priority', '優先處理', `<h3>漏洞處理優先順序</h3><p class="table-note">本站先排已有利用紀錄的項目，再依嚴重度、EPSS 與公告時間排列；這是評估順序，不是銀行安全評分。EPSS 是未來 30 天漏洞遭利用的機率估計，不是你或某家銀行被駭的機率。缺評分不當作 0 分。</p>${filter('priority')}<div id="security-priority">${priority}</div>${trackingForm(findings, [])}`],
    ['android', 'Android 修補', `<h3>Android 元件修補對照</h3><p class="table-note">系統安全修補日期、Google Play 系統更新與核心版本分開記錄。達到公告日期只代表此項對照，不能證明整機沒有漏洞。</p>
      <form data-security-patch-form class="security-form">
        ${field('裝置系統安全修補日期', 'system', 'date', 'required')}
        ${field('對照的官方修補日期', 'published', 'date', `${latestPatch ? `value="${esc(latestPatch)}"` : ''} required`)}
        ${field('Google Play 系統更新日期（選填）', 'mainline', 'date')}
        ${field('核心版本（選填）', 'kernel', 'text', 'maxlength="100"')}
        <button class="btn" type="submit">比對並記錄</button>
      </form><div data-security-patch-result role="status"></div>
      <p class="table-note">Google Play 系統更新及核心仍需依元件版本與適用公告驗證，不直接套用系統修補日期。${externalLink('https://developer.android.com/privacy-and-security/understand-device-security-state', 'Android 官方元件安全狀態說明')}</p>`],
    ['packages', '套件比對', `<h3>實際套件版本與漏洞比對</h3><p class="table-note">檔案在此瀏覽器解析，不上傳。支援 npm package-lock、CycloneDX／SPDX JSON、Swift Package.resolved。本站公告只涵蓋已追蹤套件；未命中公告不代表沒有漏洞。</p>
      <label class="security-file">匯入鎖定檔或 SBOM（JSON，最多 5 MB）<input type="file" accept=".json,.resolved,application/json" data-security-packages></label>
      <label class="security-file">匯入行內 OSV-Scanner JSON 結果（選填，最多 5 MB）<input type="file" accept=".json,application/json" data-security-osv></label>
      <p data-security-package-status role="status">尚未匯入套件清單。</p><div data-security-package-results></div>
      <details class="security-details"><summary>如何取得完整掃描結果</summary><p>可在你的環境使用 OSV-Scanner 掃描，再匯入 JSON 結果；本站不會將套件名稱或版本送往外部服務。</p><pre><code>osv-scanner scan source --lockfile=package-lock.json --format=json &gt; osv-results.json</code></pre><p>${externalLink('https://google.github.io/osv-scanner/usage/scan-source', '官方掃描說明')} · ${externalLink('https://google.github.io/osv-scanner/usage/offline', '官方離線模式')}</p></details>`],
    ['verification', '安全驗證', `<h3>行動 App 安全驗證紀錄</h3><p class="table-note">依 OWASP MASVS 分類，記錄 App／版本、測試、日期、結果與證據。預設待驗證；通過與不適用須有說明。紀錄只保存在此瀏覽器，不是本站認證。${externalLink('https://mas.owasp.org/MASVS/', 'OWASP MASVS')}</p>
      <form data-security-verification-form class="security-form">
        ${field('App／版本／測試環境', 'target', 'text', 'required maxlength="300"')}
        ${select('驗證分類', 'control', ['STORAGE', 'CRYPTO', 'AUTH', 'NETWORK', 'PLATFORM', 'CODE', 'RESILIENCE', 'PRIVACY'].map(c => [`MASVS-${c}`, `MASVS-${c}`]))}
        ${field('測試項目', 'test', 'text', 'required maxlength="300"')}
        ${select('驗證結果', 'result', [['pending', '待驗證'], ['pass', '通過（須附證據）'], ['fail', '未通過'], ['not-applicable', '不適用（須說明）']])}
        ${field('測試日期', 'testedAt', 'date', 'required')}
        ${field('證據／報告位置', 'evidence', 'text', 'maxlength="500"')}
        ${field('驗證人員（選填）', 'reviewer', 'text', 'maxlength="100"')}
        ${field('結果說明', 'note', 'text', 'maxlength="1000"')}
        <button class="btn" type="submit">儲存驗證紀錄</button>
      </form><div data-security-verification-list></div>`],
    ['sources', '來源狀態', `<h3>來源完整性與資料時效</h3><p class="table-note">分開標示成功、部分失敗與沿用資料。這裡的最後成功時間指完整來源；每筆 EPSS 評分另外保留資料日期。舊版快照未記錄子來源狀態時，不推定成功。已遭利用的歷史漏洞保留在修補對照，不因超過 180 天就視為已處理。</p>${sources}`],
  ];
  const payload = { advisories: report?.advisories ?? [], findings: findings.map(f => ({ ...f, key: findingKey(f) })), notices: notices.map(n => ({ id: n.id, title: n.title, url: n.url })) };
  return `<security-center><div class="security-tabs" role="tablist" aria-label="資安檢視">${tabs.map(([id, name], i) => `<button type="button" role="tab" id="security-tab-${id}" aria-controls="security-panel-${id}" aria-selected="${i === 0}" data-security-tab="${id}">${name}</button>`).join('')}</div>
    <p class="table-note">公開資料隨網站更新；個人追蹤、裝置與驗證紀錄保存在此瀏覽器，可匯出備份。</p>
    <div class="security-actions"><button type="button" class="btn" data-security-export>匯出個人紀錄</button><label class="security-file">匯入個人紀錄<input type="file" accept=".json,application/json" data-security-import></label></div>
    <p data-security-feedback role="status"></p>
    ${tabs.map(([id, , body]) => `<div id="security-panel-${id}" role="tabpanel" aria-labelledby="security-tab-${id}" tabindex="0" data-security-panel="${id}">${body}</div>`).join('')}
    <script type="application/json" data-security-data>${JSON.stringify(payload).replace(/</g, '\\u003c')}</script>
  </security-center>`;
}
