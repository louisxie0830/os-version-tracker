import type { AllVersions } from './fetch-all.js';
import type { FrameworkInfo } from './fetchers/frameworks.js';
import { displayDate, esc, externalLink } from './render-actions.js';
import { renderSources } from './render-common.js';
import { inVersionRange } from './fetchers/security.js';
import { advisoriesFor } from './render-security.js';

/** React Native and Flutter: latest stable, recent minor lines and what their release notes flag. */

function counts(r: FrameworkInfo['recentMinors'][number]): string {
  if (r.breaking === undefined) return '—';
  const parts = [
    r.breaking ? `<strong>破壞性變更 ${r.breaking}</strong>` : '',
    r.deprecated ? `棄用 ${r.deprecated}` : '',
    r.security ? `資安 ${r.security}` : '',
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : '沒有標示';
}

/**
 * Known vulnerabilities that affect one of the listed versions; long-fixed ones (e.g. a 2020 advisory for
 * 0.59–0.64) would only be noise next to today's releases
 */
function recentAdvisories(data: AllVersions, pkg: string, f: FrameworkInfo): string {
  const found = advisoriesFor(data, pkg).filter(({ vulnerable }) => f.recentMinors.some(r => inVersionRange(r.version, vulnerable)));
  if (!found.length) return '<span class="tl-source">列出的版本沒有已知漏洞</span>';
  return found.map(({ advisory: a, vulnerable, patched }) => {
    const latestAffected = inVersionRange(f.latest.version, vulnerable);
    return `<div class="plugin-advisory">
      <span class="status status-${latestAffected ? 'urgent' : 'upcoming'}">${latestAffected ? '最新版仍受影響' : '舊版本線受影響'}</span>
      ${externalLink(a.url, esc(vulnerable ? `${vulnerable} 受影響` : a.summary))}${patched ? `<span class="tl-source">${esc(patched)} 修正${a.cve ? ` · ${esc(a.cve)}` : ''}</span>` : ''}
    </div>`;
  }).join('');
}

function renderFramework(f: FrameworkInfo, advisories: string, flagsNote: boolean): string {
  const rows = f.recentMinors.map(r => `<tr>
      <td class="row-title" data-label="版本">${externalLink(r.url, esc(r.version))}${r.version === f.latest.version ? ' <span class="badge badge-stable badge-sm">最新</span>' : ''}</td>
      <td data-label="發布">${esc(displayDate(r.date))}</td>
      <td data-label="${flagsNote ? 'release notes 標示' : 'Dart'}">${flagsNote ? counts(r) : esc(r.dart ?? '—')}</td>
    </tr>`).join('');
  return `<div class="case">
    <div class="case-head">
      <span class="case-no">${esc(f.name)} ${esc(f.latest.version)}</span>
      <span class="case-count">${esc(displayDate(f.latest.date))} 發布</span>
    </div>
    <div class="case-body">
      ${advisories ? `<div class="cordova-notes"><div class="cordova-notes-title">已知漏洞</div>${advisories}</div>` : ''}
      <div class="table-wrap"><table class="compat-table">
        <thead><tr><th>近期版本</th><th>發布</th><th>${flagsNote ? 'release notes 標示' : 'Dart'}</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>
      <div class="tl-source">${externalLink(f.releaseNotesUrl, 'release notes')} · ${externalLink(f.breakingChangesUrl, f.name === 'Flutter' ? '破壞性變更清單' : '官方部落格（升級說明）')}</div>
    </div>
  </div>`;
}

export function renderFrameworksSection(data: AllVersions): string {
  const f = data.frameworks;
  if (!f?.reactNative && !f?.flutter) return '';
  return `<section class="panel" id="frameworks">
    <h2>React Native · Flutter</h2>
    <p class="table-note">跨平台框架的最新正式版與近期各版本線（每條版本線的最新修正版）。React Native 列出各版本 release notes 在「Breaking」「Deprecated」「Security」段落標示的項目數，升級跨版本前先看；Flutter 列出內建的 Dart 版本，破壞性變更請看官方清單。已知漏洞來自 GitHub Advisory Database。</p>
    <div class="crash-grid">
      ${f.reactNative ? renderFramework(f.reactNative, recentAdvisories(data, 'react-native', f.reactNative), true) : ''}
      ${f.flutter ? renderFramework(f.flutter, '', false) : ''}
    </div>
    ${renderSources(data, ['frameworks', 'security'])}
  </section>`;
}
