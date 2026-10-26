import { deadlineId } from './calendar.js';
import type { AllVersions } from './fetch-all.js';
import { compareVersions } from './versions.js';
import { zhDate, zhPlatform, zhSdk } from './insights.js';
import { displayDate, esc, externalLink } from './render-actions.js';
import type { ActionStatus, Deadline, SubmissionDeadline } from './types.js';
import { majorMinor, renderSources } from './render-common.js';
import { daysUntil } from './taipei-date.js';
import { datePrecision, lastPossibleDay, periodLabel, submissionDay, urgencyDay } from './deadline-dates.js';

/** Store deadlines, the requirements timeline, and the compatibility tables (Xcode, AGP, CI runners). */

function renderDeadlineCard(deadline: SubmissionDeadline, title: string): string {
  const reqs = deadline.requirements
    .map(r => `<li><span>${esc(zhPlatform(r.platform))}</span><strong>${esc(zhSdk(r.sdk))}</strong></li>`)
    .join('');
  const meta = [
    deadline.extensionDate ? `可申請延長至 ${esc(zhDate(deadline.extensionDate))}` : '',
    deadline.announcedAt ? `${esc(displayDate(deadline.announcedAt))} 公告` : '',
  ].filter(Boolean).map(m => `<div class="deadline-meta">${m}</div>`).join('');
  const note = deadline.source === 'apple'
    ? '上傳至 App Store Connect 的 App 必須使用：'
    : 'Google Play 上的 App 必須以下列版本為目標：';
  return `<div class="case">
    <div class="case-head">
      <span class="case-no">${title}</span>
      <span class="deadline-date">${esc((day => day && periodLabel(day))(submissionDay(deadline)) ?? zhDate(deadline.deadline))}</span>
    </div>
    <div class="case-body">
      <div class="deadline-note">${note}</div>
      <ul class="deadline-reqs">${reqs}</ul>
      ${meta}
    </div>
  </div>`;
}

export function renderDeadlinesSection(data: AllVersions): string {
  const { appleDeadline: apple, googleDeadline: google } = data;
  const cards: string[] = [];
  if (apple) cards.push(renderDeadlineCard(apple, 'App Store'));
  if (google) cards.push(renderDeadlineCard(google, 'Google Play'));
  if (!cards.length && !data.timeline.length) return '';
  return `<section class="panel" id="deadlines">
    <h2>上架規定與期限</h2>
    ${cards.length ? `<div class="deadline-grid">${cards.join('')}</div>` : ''}
    ${renderTimeline(data)}
    ${renderSources(data, ['appleDeadline', 'appleRequirements', 'googleDeadline', 'playPolicy', 'playBilling', 'pageSize', 'sdkReleases'])}
  </section>`;
}

function renderAndroidCompat(compat: AllVersions['androidCompat'], stableAgp?: string, agpJdk: AllVersions['agpJdk'] = []): string {
  if (!compat?.agpGradle.length) return '';
  const rows = compat.agpGradle.slice(0, 10).map(({ agp, minGradle }) => {
    // Oldest Android Studio whose supported AGP range reaches this version (list is newest first)
    const studio = [...compat.studioAgp].reverse().find(s => compareVersions(s.agp[1], agp) >= 0);
    const kotlin = compat.kotlin.filter(k =>
      compareVersions(agp, majorMinor(k.agp[0])) >= 0 && compareVersions(agp, majorMinor(k.agp[1])) <= 0);
    const kotlinText = kotlin.length
      ? esc(`${kotlin.at(-1)!.kotlin.split('–')[0]}–${kotlin[0].kotlin.split('–').at(-1)}`)
      : '<span class="warn-text">尚未正式支援</span>';
    const api = compat.apiLevels.find(a => compareVersions(majorMinor(a.minAgp), agp) <= 0);
    const current = stableAgp && majorMinor(stableAgp) === agp;
    const jdk = agpJdk.find(j => j.agp === agp)?.jdk;
    return `<tr${current ? ' class="current"' : ''}>
      <td class="row-title" data-label="AGP"><strong>${esc(agp)}</strong>${current ? ' <span class="badge badge-stable badge-sm">最新</span>' : ''}</td>
      <td data-label="最低 Gradle">${esc(minGradle)} 以上</td>
      <td data-label="JDK">${jdk ? `JDK ${esc(jdk)}` : '—'}</td>
      <td data-label="最低 Android Studio">${studio ? esc(studio.studio) + ' 以上' : '—'}</td>
      <td data-label="Kotlin（KGP）">${kotlinText}</td>
      <td data-label="最高 API">${api ? `API ${esc(api.api)}` : '—'}</td>
    </tr>`;
  }).join('');
  const cur = compat.current;
  const note = cur.agp
    ? `AGP ${esc(cur.agp)} 需要 JDK ${esc(cur.jdk ?? '?')}、Gradle ${esc(cur.minGradle ?? '?')}、SDK Build Tools ${esc(cur.minBuildTools ?? '?')} 以上${cur.maxApi ? `，最高支援 API ${esc(cur.maxApi)}` : ''}。`
    : '';
  return `<div class="subhead">Android：AGP × Gradle × Android Studio × Kotlin</div>
  ${note ? `<p class="table-note">${note}</p>` : ''}
  <div class="table-wrap"><table class="compat-table stack-on-mobile">
    <thead><tr><th>AGP</th><th>最低 Gradle</th><th>JDK</th><th>最低 Android Studio</th><th>Kotlin（KGP）</th><th>最高 API</th></tr></thead>
    <tbody data-search-rows>${rows}</tbody>
  </table></div>`;
}

function renderXcodeCompat(rows: AllVersions['xcodeSupport']): string {
  if (!rows.length) return '';
  const later = (v?: string) => v ? esc(v.replace(/\s+or later$/i, ' 以上')) : '—';
  return `<div class="subhead">iOS：Xcode × macOS × 部署版本</div>
  <div class="table-wrap"><table class="compat-table stack-on-mobile">
    <thead><tr><th>Xcode</th><th>macOS</th><th>iOS SDK</th><th>可設定的部署版本</th><th>實機除錯</th><th>Swift</th></tr></thead>
    <tbody data-search-rows>${rows.slice(0, 10).map(r => `<tr>
      <td class="row-title" data-label="Xcode"><strong>${esc(r.xcode)}</strong>${/beta|RC/i.test(r.xcode) ? ' <span class="badge badge-beta badge-sm">預覽版</span>' : ''}</td>
      <td data-label="macOS">${later(r.macOS)}</td>
      <td data-label="iOS SDK">${r.iosSdk ? esc(r.iosSdk) : '—'}</td>
      <td data-label="可設定的部署版本">${r.deploymentiOS ? `iOS ${esc(r.deploymentiOS)}` : '—'}</td>
      <td class="nowrap" data-label="實機除錯">${r.deviceiOS ? `iOS ${later(r.deviceiOS)}` : '—'}</td>
      <td data-label="Swift">${r.swift ? esc(r.swift) : '—'}</td>
    </tr>`).join('')}</tbody>
  </table></div>`;
}

export function renderCompatSection(data: AllVersions): string {
  const android = renderAndroidCompat(data.androidCompat, data.androidToolchain?.agpStable?.version, data.agpJdk);
  const ios = renderXcodeCompat(data.xcodeSupport);
  if (!android && !ios) return '';
  return `<section class="panel" id="compat">
    <h2>相容性對照表</h2>
    ${ios}
    ${renderCiTable(data.ciImages, new Date(data.cachedAt))}
    ${android}
    ${renderSources(data, ['xcodeSupport', 'ciImages', 'androidCompat', 'agpJdk'])}
  </section>`;
}

function timelineStatus(d: Deadline, now: Date): { status: ActionStatus; text: string } {
  const due = daysUntil(d.date, now);
  // Announced by month or year only: no day to count to, and still ahead until that period is over
  const period = periodLabel(d);
  if (period && due !== null) {
    const end = daysUntil(lastPossibleDay(d), now)!;
    if (end >= 0) return { status: daysUntil(urgencyDay(d), now)! <= 60 ? 'urgent' : 'upcoming', text: due > 0 ? (datePrecision(d) === 'month' ? '確切日期未定' : '日期未定') : '期間內生效' };
  }
  // A date that can't be read is not "today": say so instead of counting from it
  if (due === null) return { status: 'upcoming', text: '日期待確認' };
  if (due >= 0) return { status: due <= 60 ? 'urgent' : 'upcoming', text: due === 0 ? '今天' : `剩 ${due} 天` };
  const ext = d.extensionDate ? daysUntil(d.extensionDate, now) : null;
  if (ext !== null && ext >= 0) return { status: 'urgent', text: `延長期剩 ${ext} 天` };
  return { status: 'ok', text: '已生效' };
}

/**
 * A long detail's opening (up to a sentence or clause end near `max` characters) and the rest; a short one is
 * all opening. The rest goes behind 「完整說明」, so a timeline of many requirements stays scannable.
 */
export function splitDetail(text: string, max = 200): [string, string] {
  if (text.length <= max * 1.4) return [text, ''];
  const window = text.slice(0, max);
  const cut = Math.max(window.lastIndexOf('。'), window.lastIndexOf('；'), window.lastIndexOf('. '));
  const at = cut > max / 3 ? cut + 1 : max;
  return [text.slice(0, at).trim(), text.slice(at).trim()];
}

function renderTimeline(data: AllVersions): string {
  if (!data.timeline.length) return '';
  const now = new Date();
  const rows = data.timeline.map(d => {
    const { status, text } = timelineStatus(d, now);
    const extension = d.extensionDate ? `（可延長至 ${esc(zhDate(d.extensionDate))}）` : '';
    const [lead, rest] = splitDetail(d.detail);
    const detail = rest
      ? `${esc(lead)}<details class="tl-more" data-search-open><summary>完整說明</summary>${esc(rest)}${extension}</details>`
      : `${esc(lead)}${extension}`;
    return { past: status === 'ok', html: `<li class="tl-item" data-key="deadline:${deadlineId(d)}">
      <div class="tl-date">${esc(periodLabel(d) ?? displayDate(d.date))}</div>
      <div class="tl-body">
        <div class="tl-head">
          <span class="tl-platform tl-${d.platform === 'iOS' ? 'ios' : 'android'}">${d.platform}</span>
          <span class="status status-${status}">${text}</span>
          ${externalLink(d.url, `${esc(d.title)}`, 'tl-title')}
        </div>
        <div class="action-detail">${detail}</div>
        <div class="tl-source">來源：${esc(d.source)}</div>
      </div>
    </li>` };
  });
  const upcoming = rows.filter(r => !r.past).map(r => r.html).join('');
  const past = rows.filter(r => r.past);
  return `<div class="case mt-18">
    <div class="case-head">
      <span class="case-no">期限時間軸</span>
      <span class="case-count">即將到期在前，已生效的規定收在最後</span>
    </div>
    ${upcoming ? `<ul class="timeline" data-search-rows>${upcoming}</ul>` : ''}
    ${past.length ? `<details class="tl-past" data-search-open><summary>近一年已生效的規定（${past.length} 項）</summary><ul class="timeline" data-search-rows>${past.map(r => r.html).join('')}</ul></details>` : ''}
  </div>`;
}

/** Apple's Xcode Cloud notes have gone months without an entry while new Xcodes shipped: say how old they are */
const XCODE_CLOUD_QUIET_DAYS = 90;

function renderCiTable(ci: AllVersions['ciImages'], now: Date): string {
  if (!ci?.githubActions.length) return '';
  const STATUS: Record<string, string> = { ga: '', preview: ' <span class="badge badge-beta badge-sm">預覽版</span>', deprecated: ' <span class="badge badge-sm badge-deprecated">即將淘汰</span>' };
  const rows = ci.githubActions.map(r => `<tr>
      <td class="row-title" data-label="Runner"><strong>${esc(r.label)}</strong>${STATUS[r.status] ?? ''}${r.labels.includes('macos-latest') ? ' <span class="badge badge-stable badge-sm">macos-latest</span>' : ''}</td>
      <td data-label="架構">${esc(r.arch)}</td>
      <td data-label="macOS">${esc(r.os)}</td>
      <td data-label="預設 Xcode"><strong>${esc(r.defaultXcode ?? '—')}</strong></td>
      <td class="wrap-cell" data-label="已安裝的 Xcode">${esc(r.xcodes.join('、'))}</td>
      <td data-label="映像檔日期">${esc(r.imageDate ? displayDate(r.imageDate) : r.imageVersion ?? '—')}</td>
    </tr>`).join('');
  // Events are newest first; the newest one's date is when Apple last updated the notes
  const lastNote = ci.xcodeCloud?.events[0]?.date;
  const age = lastNote ? -(daysUntil(lastNote, now) ?? 0) : 0;
  const when = lastNote ? `（${esc(zhDate(lastNote))}${age > XCODE_CLOUD_QUIET_DAYS ? `，已 ${age} 天沒有更新` : ''}）` : '';
  const cloud = ci.xcodeCloud?.latestAnnouncedXcode
    ? `<p class="table-note mt-10">Xcode Cloud：Apple 公開的 release notes 最近一次公告${when}提供的版本為 Xcode ${esc(ci.xcodeCloud.latestAnnouncedXcode)}。這份公開紀錄可能落後，實際可選版本以 App Store Connect 的 Workflow 設定為準。${externalLink(ci.xcodeCloud.url, `查看 Xcode Cloud release notes`)}</p>`
    : '';
  return `<div class="subhead">CI：GitHub Actions macOS runner 內建的 Xcode</div>
  <div class="table-wrap"><table class="compat-table stack-on-mobile">
    <thead><tr><th>Runner</th><th>架構</th><th>macOS</th><th>預設 Xcode</th><th>已安裝的 Xcode</th><th>映像檔日期</th></tr></thead>
    <tbody data-search-rows>${rows}</tbody>
  </table></div>${cloud}`;
}
