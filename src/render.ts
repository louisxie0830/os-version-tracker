import { SITE_URL, type AllVersions, type SourceKey } from './fetch-all.js';
import { deadlineId } from './calendar.js';
import { buildNotificationsJson, type TrackedItem } from './changes.js';
import { checkProject, upgradePlan, type ProjectConfig } from './checker.js';
import type { CrashItem } from './fetchers/crashes.js';
import type { VersionShare } from './fetchers/os-share.js';
import { compareVersions } from './fetchers/ios-toolchain.js';
import { zhDate, zhPlatform, zhSdk } from './insights.js';
import { esc, externalLink, renderActions, renderUpgradePlan, STATUS_LABEL } from './render-actions.js';
import { calendarSubscriptionUrl, safeUrl } from './safe-url.js';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { markdownToHtml } from './markdown.js';
import type { ActionStatus, Deadline, iOSAdoption, NewsItem, OSVersionInfo, SubmissionDeadline, ToolVersion } from './types.js';

export interface RenderOptions {
  /** Pre-rendered for static hosting: the project checker runs in the browser instead of on the server */
  staticSite?: boolean;
  /** How often the data is refreshed, shown to readers (server cache TTL, or the static site's build schedule) */
  refreshMinutes?: number;
}


interface Tile {
  label: string;
  value: string;
  sub: string[];
  url?: string;
  preview?: boolean;
}

function renderTiles(tiles: Tile[]): string {
  if (!tiles.length) return '';
  return `<div class="subhead">開發工具版本</div>${renderTileGrid(tiles)}`;
}

function renderTileGrid(tiles: Tile[]): string {
  return `<div class="tile-grid">${tiles.map(t => {
    const url = safeUrl(t.url);
    const tag = url ? 'a' : 'div';
    const href = url ? ` href="${esc(url)}" target="_blank" rel="noopener noreferrer"` : '';
    const badge = t.preview ? '<span class="badge badge-beta badge-sm">預覽版</span>' : '';
    return `<${tag} class="tile"${href}>
      <div class="tile-label">${esc(t.label)}${badge}</div>
      <div class="tile-value">${esc(t.value)}</div>
      ${t.sub.filter(Boolean).map(line => `<div class="tile-sub">${esc(line)}</div>`).join('')}
    </${tag}>`;
  }).join('')}</div>`;
}

function iOSTiles(toolchain: AllVersions['iosToolchain'], announced: AllVersions['announcedDevices']): Tile[] {
  if (!toolchain) return [];
  const tiles: Tile[] = [];
  for (const x of [toolchain.xcodeStable, toolchain.xcodeBeta]) {
    if (!x) continue;
    tiles.push({
      label: 'Xcode',
      value: x.label,
      sub: [
        [x.iosSdk && `iOS SDK ${x.iosSdk}`, x.swift && `Swift ${x.swift}`].filter(Boolean).join(' · '),
        `需 macOS ${x.requiresMacOS} 以上`,
        `Build ${x.build} · ${x.releaseDate}`,
      ],
      url: x.notesUrl,
      preview: x.isBeta,
    });
  }
  const phones = toolchain.newestiPhones;
  if (phones.length) {
    tiles.push({
      label: '最新 iPhone',
      value: phones.map(p => p.name.replace(/^iPhone /, '')).join(' / '),
      sub: [`出廠搭載 iOS ${phones[0].shipsWithiOS}`, `${phones[0].releaseDate} 上市`],
    });
  }
  for (const device of announced) {
    tiles.push({
      label: 'Apple 已公告新機型',
      value: device.name.replace(/^iPhone /, 'iPhone '),
      sub: [`${device.date} 公告`, '尚未收錄於機型資料庫'],
      url: device.url,
      preview: true,
    });
  }
  return tiles;
}

function toolTile(tool: ToolVersion | undefined, label = tool?.name ?? ''): Tile | null {
  if (!tool) return null;
  return {
    label,
    value: tool.version,
    sub: [tool.releaseDate ? `${tool.releaseDate} 發布` : ''],
    url: tool.url,
    preview: !!tool.channel && tool.channel !== 'Release' && tool.channel !== 'Patch',
  };
}

function studioTile(tool: ToolVersion | undefined): Tile | null {
  if (!tool) return null;
  // "Android Studio Rabbit 1 | 2026.2.1 Canary 4" → "Rabbit 1 Canary 4"
  const [codename, release] = tool.name.replace(/^Android Studio\s*/, '').split('|').map(p => p.trim());
  const stage = release?.match(/(Canary|Beta|RC|Patch)\s*\d*/)?.[0];
  return {
    ...toolTile(tool, 'Android Studio')!,
    value: [codename, stage].filter(Boolean).join(' '),
    sub: [`${tool.version}`, tool.releaseDate ? `${tool.releaseDate} 發布` : ''],
  };
}

function androidTiles(toolchain: AllVersions['androidToolchain']): Tile[] {
  if (!toolchain) return [];
  return [
    studioTile(toolchain.studioStable),
    studioTile(toolchain.studioPreview),
    toolTile(toolchain.agpStable, 'AGP'),
    toolTile(toolchain.agpPreview, 'AGP'),
    toolTile(toolchain.gradle),
    toolTile(toolchain.kotlin),
    toolTile(toolchain.sdkPlatform, 'compileSdk 平台'),
    toolTile(toolchain.buildTools),
    toolTile(toolchain.composeBom),
  ].filter((t): t is Tile => t !== null);
}



function renderNews(title: string, items: NewsItem[], moreUrl: string): string {
  if (!items.length) return '';
  return `<div class="case" style="margin-top:18px">
    <div class="case-head">
      <span class="case-no">${title}</span>
      ${externalLink(moreUrl, `查看全部 →`, 'case-count')}
    </div>
    <ul class="news">${items.map(n => `<li data-key="news:${esc(n.url)}">
      <span class="news-date">${esc(n.date)}</span>
      ${n.important ? '<span class="status status-urgent news-flag">重要</span>' : ''}
      ${externalLink(n.url, `${esc(n.title)}`)}
    </li>`).join('')}</ul>
  </div>`;
}


/** Stacked bar of the 4 newest majors (plus "更早") */

interface BarRow { label: string; shares: Array<{ version: string; share: number }> }

const BAR_COLORS = 4;

/** Stacked bars where a version keeps the same colour in every row, plus a legend */
function renderVersionBars(platform: 'ios' | 'android', rows: BarRow[]): string {
  const versions = [...new Set(rows.flatMap(r => r.shares.map(s => s.version)).filter(v => /^\d/.test(v)))]
    .sort((a, b) => compareVersions(b, a))
    .slice(0, BAR_COLORS);
  const colorOf = (v: string) => versions.indexOf(v);
  const name = (v: string) => (platform === 'ios' ? `iOS ${v}` : `Android ${v}`);
  const bars = rows.map(row => {
    const segs = versions.map(v => ({ v, share: row.shares.find(s => s.version === v)?.share ?? 0 })).filter(s => s.share > 0);
    const rest = Math.max(0, Math.round((row.shares.reduce((n, s) => n + s.share, 0) - segs.reduce((n, s) => n + s.share, 0)) * 10) / 10);
    const parts = [
      ...segs.map(sg => `<span class="seg c${colorOf(sg.v)}" style="width:${sg.share}%" title="${esc(name(sg.v))} ${sg.share}%">${sg.share >= 9 ? `${Math.round(sg.share)}%` : ''}</span>`),
      ...(rest > 0 ? [`<span class="seg c-rest" style="width:${rest}%" title="更早 ${rest}%">${rest >= 9 ? `${Math.round(rest)}%` : ''}</span>`] : []),
    ];
    return `<div class="adoption-row"><div class="adoption-label">${row.label}</div><div class="adoption-bar">${parts.join('')}</div></div>`;
  }).join('');
  const legend = [...versions.map(v => `<span><i class="c${colorOf(v)}"></i>${esc(name(v))}</span>`), '<span><i class="c-rest"></i>更早</span>'].join('');
  return `<div class="adoption">${bars}</div><div class="bar-legend">${legend}</div>`;
}

/** Percentage with a bar behind it, so the full-width table reads at a glance */
function coverageCell(pct: number | undefined): string {
  if (pct === undefined) return '—';
  return `<div class="cov"><span class="cov-bar" style="width:${Math.max(0, Math.min(100, pct))}%"></span><span class="cov-num">${pct}%</span></div>`;
}

function renderVersionDistribution(platform: 'ios' | 'android', data: AllVersions): string {
  const share = data.osShare;
  const tw = share?.[platform].TW;
  const ww = share?.[platform].ww;
  const apple = platform === 'ios' ? data.iosAdoption : null;
  if (!share || (!tw && !ww)) return '';
  const name = platform === 'ios' ? 'iOS' : 'Android';
  const appleShares = (list: Array<{ name: string; value: number }>) =>
    list.map(s => ({ version: s.name.match(/\d+/)?.[0] ?? '更早', share: s.value }));
  const rows: BarRow[] = [
    ...(tw ? [{ label: '台灣', shares: tw.byMajor.filter(m => m.version !== '其他') }] : []),
    ...(ww ? [{ label: '全球', shares: ww.byMajor.filter(m => m.version !== '其他') }] : []),
    ...(apple ? [
      { label: 'Apple 近四年裝置', shares: appleShares(apple.recentDevices) },
      { label: 'Apple 所有裝置', shares: appleShares(apple.allDevices) },
    ] : []),
  ];
  const sourceNote = `台灣、全球：StatCounter ${esc(share.month)}（網站流量估算）`
    + (apple ? ` · Apple：App Store 交易裝置${apple.measuredAt ? `，統計至 ${esc(zhDate(apple.measuredAt))}` : ''}` : '');
  const base = tw ?? ww!;
  // Rows until ~99.5% is covered: older versions don't change the decision
  const coverageRows: string[] = [];
  for (const c of base.coverage) {
    const w = ww?.coverage.find(x => x.min === c.min);
    coverageRows.push(`<tr><td class="row-title" data-label="最低支援版本"><strong>${name} ${esc(c.min)}</strong>${c.api ? ` <span class="tl-source">API ${c.api}</span>` : ''} 以上</td>
      <td data-label="台灣">${coverageCell(tw?.coverage.find(x => x.min === c.min)?.covered)}</td>
      <td data-label="全球">${coverageCell(w?.covered)}</td></tr>`);
    if (c.covered >= 99.5 || coverageRows.length >= 8) break;
  }
  const top = (tw ?? ww)!.topVersions.map(v => `<span>${esc(platform === 'ios' ? v.version : `Android ${v.version}`)} <strong>${v.share}%</strong></span>`).join('');
  return `<div class="subhead">${name} 版本分布 <span class="subhead-note">${sourceNote}</span></div>
  ${renderVersionBars(platform, rows)}
  <div class="share-grid">
    <div class="table-wrap share-table"><table class="compat-table">
      <thead><tr><th>最低支援版本（${platform === 'ios' ? 'Deployment Target' : 'minSdk'}）</th><th>台灣</th><th>全球</th></tr></thead>
      <tbody>${coverageRows.join('')}</tbody>
    </table></div>
    <div class="share-top">
      <div class="tile-label">台灣最多人使用的版本</div>
      <div class="share-chips">${top}</div>
      <p class="tl-source">占比以已知版本計算；「涵蓋」= 該版本以上的裝置比例。${externalLink(base.url, `查看 StatCounter 原始資料`)}</p>
    </div>
  </div>`;
}


function renderVersionCard(v: OSVersionInfo): string {
  const isStable = !v.isBeta;
  const badgeClass = isStable ? 'badge-stable' : 'badge-beta';
  const badgeText = isStable ? '正式版' : 'Beta';
  const build = v.build ? `<span class="meta">Build <code>${esc(v.build)}</code></span>` : '';
  const api = v.apiLevel ? `<span class="meta">API ${v.apiLevel}</span>` : '';
  const codename = v.codename ? `<span class="meta">${esc(v.codename)}</span>` : '';
  return `<div class="version-card">
    <div class="version-header">
      <span class="badge ${badgeClass}">${badgeText}</span>
      <span class="version-number">${esc(v.version)}</span>
    </div>
    <div class="version-details">
      ${build}${api}${codename}
      <span class="meta">${v.releaseDate} 發布</span>
    </div>
  </div>`;
}

function renderPlatformSection(id: string, name: string, versions: OSVersionInfo[], extra = ''): string {
  const body = versions.length
    ? `<div class="version-grid">${versions.map(renderVersionCard).join('')}</div>`
    : '<div class="empty">暫時無法取得資料</div>';
  return `<section class="panel" id="${id}">
    <h2>${name}</h2>
    ${body}
    ${extra}
  </section>`;
}

function renderDeadlineCard(deadline: SubmissionDeadline, title: string): string {
  const reqs = deadline.requirements
    .map(r => `<li><span>${esc(zhPlatform(r.platform))}</span><strong>${esc(zhSdk(r.sdk))}</strong></li>`)
    .join('');
  const meta = [
    deadline.extensionDate ? `可申請延長至 ${esc(zhDate(deadline.extensionDate))}` : '',
    deadline.announcedAt ? `${esc(deadline.announcedAt)} 公告` : '',
  ].filter(Boolean).map(m => `<div class="deadline-meta">${m}</div>`).join('');
  const note = deadline.source === 'apple'
    ? '上傳至 App Store Connect 的 App 必須使用：'
    : 'Google Play 上的 App 必須以下列版本為目標：';
  return `<div class="case">
    <div class="case-head">
      <span class="case-no">${title}</span>
      <span class="deadline-date">${esc(zhDate(deadline.deadline))}</span>
    </div>
    <div class="case-body">
      <div class="deadline-note">${note}</div>
      <ul class="deadline-reqs">${reqs}</ul>
      ${meta}
    </div>
  </div>`;
}

function renderDeadlinesSection(data: AllVersions): string {
  const { appleDeadline: apple, googleDeadline: google } = data;
  const cards: string[] = [];
  if (apple) cards.push(renderDeadlineCard(apple, 'App Store'));
  if (google) cards.push(renderDeadlineCard(google, 'Google Play'));
  if (!cards.length && !data.timeline.length) return '';
  return `<section class="panel" id="deadlines">
    <h2>上架期限與規定</h2>
    ${cards.length ? `<div class="deadline-grid">${cards.join('')}</div>` : ''}
    ${renderTimeline(data)}
    ${renderSources(data, ['appleDeadline', 'appleRequirements', 'googleDeadline', 'playPolicy', 'playBilling', 'pageSize'])}
  </section>`;
}

function renderSummary(data: AllVersions): string {
  const parts: string[] = [];
  const iosStable = data.ios.find(v => !v.isBeta);
  const androidStable = data.android.find(v => !v.isBeta);
  if (iosStable) parts.push(`iOS ${iosStable.version}`);
  if (androidStable) parts.push(androidStable.version);
  const urgent = [...data.iosActions, ...data.androidActions].filter(a => a.status === 'urgent').length;
  if (urgent) parts.push(`${urgent} 項需處理`);
  parts.push(`資料 ${taipeiTime(data.cachedAt)}`);
  return esc(parts.join(' · '));
}

function taipeiTime(iso: string): string {
  return new Date(iso).toLocaleString('zh-TW', {
    timeZone: 'Asia/Taipei', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  });
}

function renderSources(data: AllVersions, keys: SourceKey[]): string {
  const items = keys.map(k => data.sources[k]).filter(Boolean).map(src => `<li>
      ${externalLink(src.url, `${esc(src.label)}`)}
      ${src.ok ? `<span class="src-time">${taipeiTime(src.fetchedAt)}</span>` : '<span class="src-fail">抓取失敗，資料可能不完整</span>'}
    </li>`).join('');
  return `<details class="sources"><summary>資料來源與抓取時間</summary><ul>${items}</ul></details>`;
}

const majorMinor = (v: string) => v.match(/^\d+(?:\.\d+)?/)?.[0] ?? v;

function renderAndroidCompat(compat: AllVersions['androidCompat'], stableAgp?: string, agpJdk: AllVersions['agpJdk'] = []): string {
  if (!compat?.agpGradle.length) return '';
  const rows = compat.agpGradle.slice(0, 10).map(({ agp, minGradle }) => {
    // Oldest Android Studio whose supported AGP range reaches this version (list is newest first)
    const studio = [...compat.studioAgp].reverse().find(s => compareVersions(s.agp[1], agp) >= 0);
    const kotlin = compat.kotlin.filter(k =>
      compareVersions(agp, majorMinor(k.agp[0])) >= 0 && compareVersions(agp, majorMinor(k.agp[1])) <= 0);
    const kotlinText = kotlin.length
      ? `${kotlin.at(-1)!.kotlin.split('–')[0]}–${kotlin[0].kotlin.split('–').at(-1)}`
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
    <tbody>${rows}</tbody>
  </table></div>`;
}

function renderXcodeCompat(rows: AllVersions['xcodeSupport']): string {
  if (!rows.length) return '';
  const later = (v?: string) => v ? esc(v.replace(/\s+or later$/i, ' 以上')) : '—';
  return `<div class="subhead">iOS：Xcode × macOS × 部署版本</div>
  <div class="table-wrap"><table class="compat-table stack-on-mobile">
    <thead><tr><th>Xcode</th><th>macOS</th><th>iOS SDK</th><th>可設定的部署版本</th><th>實機除錯</th><th>Swift</th></tr></thead>
    <tbody>${rows.slice(0, 10).map(r => `<tr>
      <td class="row-title" data-label="Xcode"><strong>${esc(r.xcode)}</strong>${/beta|RC/i.test(r.xcode) ? ' <span class="badge badge-beta badge-sm">預覽版</span>' : ''}</td>
      <td data-label="macOS">${later(r.macOS)}</td>
      <td data-label="iOS SDK">${r.iosSdk ? esc(r.iosSdk) : '—'}</td>
      <td data-label="可設定的部署版本">${r.deploymentiOS ? `iOS ${esc(r.deploymentiOS)}` : '—'}</td>
      <td data-label="實機除錯">${r.deviceiOS ? `iOS ${later(r.deviceiOS)}` : '—'}</td>
      <td data-label="Swift">${r.swift ? esc(r.swift) : '—'}</td>
    </tr>`).join('')}</tbody>
  </table></div>`;
}

function renderCompatSection(data: AllVersions): string {
  const android = renderAndroidCompat(data.androidCompat, data.androidToolchain?.agpStable?.version, data.agpJdk);
  const ios = renderXcodeCompat(data.xcodeSupport);
  if (!android && !ios) return '';
  return `<section class="panel" id="compat">
    <h2>版本相容性對照表</h2>
    ${ios}
    ${renderCiTable(data.ciImages)}
    ${android}
    ${renderSources(data, ['xcodeSupport', 'ciImages', 'androidCompat', 'agpJdk'])}
  </section>`;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function timelineStatus(d: Deadline, now: Date): { status: ActionStatus; text: string } {
  const days = (date: string) => Math.ceil((new Date(`${date}T00:00:00+08:00`).getTime() - now.getTime()) / DAY_MS);
  const due = days(d.date);
  if (due >= 0) return { status: due <= 60 ? 'urgent' : 'upcoming', text: due === 0 ? '今天' : `剩 ${due} 天` };
  if (d.extensionDate) {
    const ext = days(d.extensionDate);
    if (ext >= 0) return { status: 'urgent', text: `延長期剩 ${ext} 天` };
  }
  return { status: 'ok', text: '已生效' };
}

function renderTimeline(data: AllVersions): string {
  if (!data.timeline.length) return '';
  const now = new Date();
  const items = data.timeline.map(d => {
    const { status, text } = timelineStatus(d, now);
    return `<li class="tl-item" data-key="deadline:${deadlineId(d)}">
      <div class="tl-date">${esc(d.date)}</div>
      <div class="tl-body">
        <div class="tl-head">
          <span class="tl-platform tl-${d.platform === 'iOS' ? 'ios' : 'android'}">${d.platform}</span>
          <span class="status status-${status}">${text}</span>
          ${externalLink(d.url, `${esc(d.title)}`, 'tl-title')}
        </div>
        <div class="action-detail">${esc(d.detail)}${d.extensionDate ? `（可延長至 ${esc(zhDate(d.extensionDate))}）` : ''}</div>
        <div class="tl-source">來源：${esc(d.source)}</div>
      </div>
    </li>`;
  }).join('');
  return `<div class="case" style="margin-top:18px">
    <div class="case-head">
      <span class="case-no">期限時間軸</span>
      <span class="case-count">即將到期在前，接著是近一年已生效的規定</span>
    </div>
    <ul class="timeline">${items}</ul>
  </div>`;
}

const KIND_LABEL: Record<TrackedItem['kind'], string> = {
  deadline: '期限',
  'apple-news': 'Apple 公告',
  'android-news': 'Android 公告',
  device: '新機型',
  crash: 'SDK 閃退',
};

const platformClass = (p: string) => p === 'iOS' ? 'tl-ios' : p === 'Android' ? 'tl-android' : 'tl-cross';

function renderRecent(data: AllVersions): string {
  const webcal = calendarSubscriptionUrl(SITE_URL) ?? 'calendar.ics';
  const list = data.recent.length
    ? `<ul class="news">${data.recent.slice(0, 8).map(item => `<li>
        <span class="news-date">${esc((item.firstSeen ?? item.date).slice(0, 10))}</span>
        <span class="tl-platform ${platformClass(item.platform)}">${esc(item.platform)}</span>
        <span class="status status-info news-flag">${KIND_LABEL[item.kind]}</span>
        ${externalLink(item.url, `${esc(item.title)}`)}
      </li>`).join('')}</ul>`
    : '<div class="case-body empty">最近 7 天沒有新的上架規定或重要公告。</div>';
  return `<section class="panel" id="recent">
    <h2>最近 7 天新增</h2>
    <div class="subscribe">
      <span>不想每天來看？訂閱後有新規定會自動出現：</span>
      <a class="btn primary" href="${esc(webcal)}">訂閱行事曆</a>
      <a class="btn" href="calendar.ics" download>下載 .ics</a>
      <a class="btn" href="feed.xml">RSS / Atom</a>
    </div>
    <div class="case" style="margin-top:14px">
      <div class="case-head">
        <span class="case-no">新的規定、重要公告與新機型</span>
        <span class="case-count">${data.recent.length ? `共 ${data.recent.length} 項` : ''}</span>
      </div>
      ${list}
    </div>
    <p class="table-note" style="margin-top:10px">行事曆包含所有上架期限與延長期限，會在一週前與當天提醒；Slack 可用 RSS app 訂閱 feed。標示「新」的項目是你上次造訪之後才出現的。</p>
  </section>`;
}

const CHECK_FIELDS: Array<{ name: keyof ProjectConfig; label: string; placeholder: string; group: 'iOS' | 'Android' }> = [
  { name: 'xcode', label: 'Xcode 版本', placeholder: '例：26.3', group: 'iOS' },
  { name: 'macos', label: 'CI / 開發機 macOS', placeholder: '例：15.6', group: 'iOS' },
  { name: 'deployment', label: '最低部署版本（iOS）', placeholder: '例：15', group: 'iOS' },
  { name: 'jdk', label: 'JDK', placeholder: '例：17', group: 'Android' },
  { name: 'agp', label: 'AGP', placeholder: '例：8.7.3', group: 'Android' },
  { name: 'gradle', label: 'Gradle', placeholder: '例：8.9', group: 'Android' },
  { name: 'kotlin', label: 'Kotlin', placeholder: '例：2.0.21', group: 'Android' },
  { name: 'targetSdk', label: 'targetSdk', placeholder: '例：35', group: 'Android' },
  { name: 'billing', label: 'Play Billing Library', placeholder: '例：7.1.1', group: 'Android' },
];

function renderChecker(data: AllVersions, config: ProjectConfig | null, staticSite = false): string {
  const field = (f: typeof CHECK_FIELDS[number]) => `<label>
      <span>${f.label}</span>
      <input type="text" name="${f.name}" inputmode="decimal" pattern="\\d+(\\.\\d+){0,3}" placeholder="${f.placeholder}" value="${esc(String(config?.[f.name] ?? ''))}">
    </label>`;
  const group = (g: 'iOS' | 'Android') => CHECK_FIELDS.filter(f => f.group === g).map(field).join('');
  const results = config ? checkProject(config, data) : null;
  const resultHtml = results
    ? `${renderUpgradePlan('iOS', upgradePlan(results.ios, 'ios'))}${renderUpgradePlan('Android', upgradePlan(results.android, 'android'))}
      <div class="check-results${results.ios.length && results.android.length ? '' : ' single'}">
        ${results.ios.length ? renderActions(results.ios, 'iOS 檢查結果', false) : ''}
        ${results.android.length ? renderActions(results.android, 'Android 檢查結果', false) : ''}
        ${!results.ios.length && !results.android.length ? '<div class="empty">沒有可檢查的項目，請至少填一個欄位。</div>' : ''}
      </div>`
    : '';
  return `<section class="panel" id="checker">
    <h2>我的專案檢查</h2>
    <p class="table-note">填入專案目前的版本，列出哪些會擋上架、哪些相容性有問題、還剩多少時間。只填需要的欄位即可；結果網址可以直接分享給 PM 或同事。</p>
    <form class="check-form" method="get" action="./#checker" id="check-form">
      <fieldset><legend>iOS</legend>${group('iOS')}</fieldset>
      <fieldset><legend>Android</legend>${group('Android')}
        <label class="check-inline"><input type="checkbox" name="native" value="1"${config?.native ? ' checked' : ''}> 含 NDK / 原生程式碼（.so）</label>
      </fieldset>
      <div class="check-actions">
        <button class="btn primary" type="submit">檢查</button>
        ${config || staticSite ? `<button class="btn" type="button" id="copy-link"${config ? '' : ' hidden'}>複製結果連結</button><a class="btn" href="./#checker" id="clear-check"${config ? '' : ' hidden'}>清除</a>` : ''}
      </div>
    </form>
    <div id="check-results">${resultHtml}</div>
    ${staticSite ? renderCheckerClient(data) : ''}
  </section>`;
}

/** The subset of data the in-browser checker needs, embedded as JSON (with "<" escaped so it can't close the tag) */
function renderCheckerClient(data: AllVersions): string {
  const subset = {
    ios: data.ios,
    appleDeadline: data.appleDeadline,
    xcodeSupport: data.xcodeSupport,
    timeline: data.timeline,
    iosAdoption: data.iosAdoption,
    googleDeadline: data.googleDeadline,
    androidCompat: data.androidCompat,
    androidToolchain: data.androidToolchain,
    agpJdk: data.agpJdk,
  };
  return `<script type="application/json" id="checker-data">${JSON.stringify(subset).replace(/</g, '\\u003c')}</script>
    <script type="module" src="js/client/checker-client.js"></script>`;
}

const CRASH_KIND: Record<CrashItem['kind'], { label: string; status: ActionStatus }> = {
  known: { label: '已知問題', status: 'urgent' },
  fixed: { label: '已修復', status: 'ok' },
  reported: { label: '社群回報', status: 'upcoming' },
};

function renderCrashList(title: string, items: CrashItem[], note: string, limit = 8): string {
  const list = items.length
    ? `<ul class="crash-list">${items.slice(0, limit).map(c => `<li data-key="crash:${esc(c.url)}:${esc(c.title.slice(0, 40))}">
        <div class="tl-head">
          <span class="status status-${CRASH_KIND[c.kind].status}">${CRASH_KIND[c.kind].label}</span>
          ${c.newOs ? '<span class="status status-urgent">新系統相關</span>' : ''}
          <span class="crash-context">${esc(c.context)}</span>
        </div>
        ${externalLink(c.url, `${esc(c.title)}`, 'crash-title')}
        ${c.source === 'GitHub' || c.source === 'Stack Overflow' ? `<div class="tl-source">${c.date ? `${esc(c.date)} ${c.source === 'GitHub' ? '回報' : '發問'} · ` : ''}${c.source === 'GitHub' ? '👍' : '▲'} ${c.reactions ?? 0} · ${c.source === 'GitHub' ? '💬' : '回答'} ${c.comments ?? 0}</div>` : ''}
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

function renderCrashesSection(data: AllVersions): string {
  const c = data.crashes;
  if (!c) return '';
  const iosMajor = data.ios.find(v => !v.isBeta)?.version.match(/^\d+/)?.[0];
  const androidMajor = data.android.find(v => !v.isBeta)?.version.match(/\d+/)?.[0];
  return `<section class="panel" id="crashes">
    <h2>近期閃退與當機</h2>
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

function renderCiTable(ci: AllVersions['ciImages']): string {
  if (!ci?.githubActions.length) return '';
  const STATUS: Record<string, string> = { ga: '', preview: ' <span class="badge badge-beta badge-sm">預覽</span>', deprecated: ' <span class="badge badge-sm" style="color:var(--fail);background:var(--fail-soft)">即將淘汰</span>' };
  const rows = ci.githubActions.map(r => `<tr>
      <td class="row-title" data-label="Runner"><strong>${esc(r.label)}</strong>${STATUS[r.status] ?? ''}${r.labels.includes('macos-latest') ? ' <span class="badge badge-stable badge-sm">macos-latest</span>' : ''}</td>
      <td data-label="架構">${esc(r.arch)}</td>
      <td data-label="macOS">${esc(r.os)}</td>
      <td data-label="預設 Xcode"><strong>${esc(r.defaultXcode ?? '—')}</strong></td>
      <td class="wrap-cell" data-label="已安裝的 Xcode">${esc(r.xcodes.join('、'))}</td>
      <td data-label="映像檔日期">${esc(r.imageDate ?? r.imageVersion ?? '—')}</td>
    </tr>`).join('');
  const cloud = ci.xcodeCloud?.latestAnnouncedXcode
    ? `<p class="table-note" style="margin-top:10px">Xcode Cloud：Apple 公開的 release notes 最近公告提供的版本為 Xcode ${esc(ci.xcodeCloud.latestAnnouncedXcode)}。這份公開紀錄可能落後，實際可選版本以 App Store Connect 的 Workflow 設定為準。${externalLink(ci.xcodeCloud.url, `查看 Xcode Cloud release notes`)}</p>`
    : '';
  return `<div class="subhead">CI：GitHub Actions macOS runner 內建的 Xcode</div>
  <div class="table-wrap"><table class="compat-table stack-on-mobile">
    <thead><tr><th>Runner</th><th>架構</th><th>macOS</th><th>預設 Xcode</th><th>已安裝的 Xcode</th><th>映像檔日期</th></tr></thead>
    <tbody>${rows}</tbody>
  </table></div>${cloud}`;
}

const ANDROID_API_BY_VERSION: Record<string, number> = {
  '5.0': 21, '5.1': 22, '6.0': 23, '7.0': 24, '7.1': 25, '8.0': 26, '8.1': 27, '9': 28, '10': 29, '11': 30, '12': 31, '13': 33, '14': 34, '15': 35, '16': 36,
};

function androidApi(version: string): number | undefined {
  return ANDROID_API_BY_VERSION[version] ?? ANDROID_API_BY_VERSION[version.replace(/\.0$/, '')] ?? ANDROID_API_BY_VERSION[`${version}.0`];
}

/** "8 家：iOS 13 · 9 家：iOS 15 …" grouped by major version, most common first */
function countByMajor(values: string[], prefix: string): string {
  const counts = new Map<string, number>();
  for (const v of values) {
    const major = v.match(/^\d+/)?.[0];
    if (major) counts.set(major, (counts.get(major) ?? 0) + 1);
  }
  return [...counts]
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .map(([major, n]) => `<span>${prefix} ${major}<strong>${n} 家</strong></span>`)
    .join('');
}

function renderBanksSection(data: AllVersions): string {
  const banks = data.twBanks;
  if (!banks.length) return '';
  const ios = banks.flatMap(b => b.ios ? [b.ios.minOs] : []);
  const android = banks.flatMap(b => b.android ? [b.android.minOs] : []);
  const sorted = (list: string[]) => [...list].sort(compareVersions);
  const strictestIos = sorted(ios).at(-1);
  const strictestAndroid = sorted(android.filter(v => /^\d/.test(v))).at(-1);
  const rows = banks.map(b => {
    const api = b.android ? androidApi(b.android.minOs) : undefined;
    return `<tr>
      <td class="row-title" data-label="銀行"><strong>${esc(b.bank)}</strong><div class="tl-source">${esc(b.app)}</div></td>
      <td data-label="最低 iOS">${b.ios ? `${externalLink(b.ios.url, `iOS ${esc(b.ios.minOs)}`)}` : '—'}</td>
      <td data-label="最低 Android">${b.android ? `<span>${externalLink(b.android.url, `Android ${esc(b.android.minOs)}`)}${api ? ` <span class="tl-source">API ${api}</span>` : ''}</span>` : '—'}</td>
      <td class="bank-updated" data-label="最近更新">${esc([b.ios?.updated && `iOS ${b.ios.updated}`, b.android?.updated && `Android ${b.android.updated}`].filter(Boolean).join(' · ') || '—')}</td>
    </tr>`;
  }).join('');
  return `<section class="panel" id="banks">
    <h2>台灣銀行 App 支援版本</h2>
    <p class="table-note">各銀行官方行動銀行 App 在 App Store 與 Google Play（台灣區）標示的最低支援版本，每次更新網站時重新抓取。可作為金融業 App 設定 Deployment Target / minSdk 的業界參考。銀行與 App 名稱以部分遮罩顯示；商店標示的版本不代表銀行的官方支援政策。</p>
    <div class="bank-summary">
      <div><div class="tile-label">最低 iOS 分布</div><div class="share-chips">${countByMajor(ios, 'iOS')}</div></div>
      <div><div class="tile-label">最低 Android 分布</div><div class="share-chips">${countByMajor(android, 'Android')}</div></div>
      <div class="tl-source">共 ${banks.length} 個 App；要求最高：iOS ${esc(strictestIos ?? '—')}、Android ${esc(strictestAndroid ?? '—')}</div>
    </div>
    <div class="table-wrap"><table class="compat-table stack-on-mobile bank-table">
      <thead><tr><th>銀行 / App</th><th>最低 iOS</th><th>最低 Android</th><th>最近更新</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
    ${renderSources(data, ['twBanks'])}
  </section>`;
}

const REPO_BLOB = 'https://github.com/louisxie0830/os-version-tracker/blob/master';

/** The disclaimer files live at the repository root, next to src/ and dist/ */
function readLegal(file: string): string | null {
  try {
    return readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', file), 'utf8');
  } catch {
    return null;
  }
}

function renderLegalSection(): string {
  const zh = readLegal('DISCLAIMER.md');
  const en = readLegal('DISCLAIMER.en.md');
  if (!zh && !en) return '';
  // The documents' own title is the panel heading, so drop it from the body
  const body = (md: string) => markdownToHtml(md.replace(/^# .*\n/, ''), { relativeBase: REPO_BLOB, headingOffset: 2 });
  return `<section class="panel" id="legal">
    <h2>免責聲明與智慧財產權 · Disclaimer</h2>
    <p class="legal-lead">本網站為非官方專案，與 Apple、Google 及所提及的公司、銀行均無關係；商標與引用內容的權利屬於各權利人。資料自動抓取、僅供參考，不構成任何專業建議。本網站不使用 Cookie、不追蹤、不蒐集個人資料。</p>
    <p class="legal-lead">This is an unofficial project, not affiliated with Apple, Google or any company or bank mentioned. Trademarks and quoted content belong to their owners. Data is collected automatically, for reference only, and is not professional advice. No cookies, tracking or personal data collection.</p>
    ${zh ? `<details class="legal-doc"><summary>閱讀完整中文版</summary><div class="legal-body">${body(zh)}</div></details>` : ''}
    ${en ? `<details class="legal-doc" lang="en"><summary>Read the full English version</summary><div class="legal-body">${body(en)}</div></details>` : ''}
  </section>`;
}

function renderPrivacySection(data: AllVersions): string {
  const p = data.privacy;
  if (!p) return '';
  const apis = p.appleRequiredReasonApis.map(c => `<div class="privacy-card">
      ${externalLink(c.url, `${esc(c.category)}`, 'crash-title')}
      <div class="tl-source"><code>${esc(c.key)}</code></div>
      <div class="action-detail">API：${esc(c.apis.join('、'))}</div>
      <div class="privacy-reasons">${c.reasons.map(r => `<span title="${esc(r.description)}"><code>${esc(r.code)}</code></span>`).join('')}</div>
    </div>`).join('');
  const links = (platform: 'ios' | 'android') => p.links.filter(l => l.platform === platform).map(l =>
    `<li>${externalLink(l.url, `${esc(l.title)}`)}<span>${esc(l.note)}</span></li>`).join('');
  return `<section class="panel" id="privacy">
    <h2>隱私清單與第三方 SDK 規範</h2>
    <div class="subhead">iOS：Required Reason API（使用這些 API 須在 PrivacyInfo.xcprivacy 宣告原因）</div>
    <div class="privacy-grid">${apis}</div>
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

/** schema.org JSON-LD; "<" is escaped so the data can't close the script tag */
function structuredData(data: AllVersions): string {
  const graph = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebSite',
        '@id': `${SITE_URL}/#website`,
        url: `${SITE_URL}/`,
        name: 'OS Version Tracker',
        inLanguage: 'zh-Hant',
      },
      {
        '@type': 'WebApplication',
        '@id': `${SITE_URL}/#app`,
        url: `${SITE_URL}/`,
        name: 'OS Version Tracker',
        description: 'iOS 與 Android 開發者上架雷達：上架期限、Xcode 與 SDK 需求、版本相容性、專案檢查與近期閃退。',
        applicationCategory: 'DeveloperApplication',
        operatingSystem: 'Any',
        inLanguage: 'zh-Hant',
        isAccessibleForFree: true,
        offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
        image: `${SITE_URL}/og-image.png`,
        dateModified: data.cachedAt,
        isPartOf: { '@id': `${SITE_URL}/#website` },
        featureList: [
          'App Store 與 Google Play 上架期限倒數',
          'Xcode、macOS、iOS SDK 與部署版本對照',
          'AGP、Gradle、JDK、Android Studio、Kotlin 相容性',
          '我的專案檢查',
          'iOS 與 Android 近期閃退與已知問題',
          '行事曆與 RSS 訂閱',
        ],
      },
    ],
  };
  return JSON.stringify(graph).replace(/</g, '\\u003c');
}

export function renderHTML(data: AllVersions, config: ProjectConfig | null = null, options: RenderOptions = {}): string {
  const refresh = options.refreshMinutes ?? 10;
  // Kept short: search results cut Chinese descriptions off at roughly 80–100 characters
  const description = `iOS 與 Android 開發者上架雷達：App Store 與 Google Play 期限倒數、Xcode 與 AGP 相容性、專案檢查與近期閃退，每 ${refresh} 分鐘自動更新。`;
  const shortDescription = `上架期限倒數、Xcode 與 AGP 相容性、專案檢查與近期閃退，官方來源每 ${refresh} 分鐘自動更新。`;
  const { ios, android } = data;
  return `<!DOCTYPE html>
<html lang="zh-Hant">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="theme-color" content="#0d96d4">
  <meta name="color-scheme" content="light">
  <title>iOS / Android 上架期限與版本相容性追蹤｜OS Version Tracker</title>
  <meta name="description" content="${esc(description)}">
  <meta name="keywords" content="iOS 上架期限, App Store SDK 要求, Google Play targetSdk, Xcode 版本, Xcode macOS 需求, AGP Gradle 相容性, Kotlin AGP 相容, Play Billing Library 淘汰, 16 KB page size, iOS 採用率, Android 17, iOS 27, 隱私清單 PrivacyInfo, 閃退">
  <meta name="robots" content="index, follow, max-image-preview:large">
  ${process.env.GOOGLE_SITE_VERIFICATION ? `<meta name="google-site-verification" content="${esc(process.env.GOOGLE_SITE_VERIFICATION)}">` : ''}
  <link rel="canonical" href="${esc(SITE_URL)}/">
  <link rel="alternate" type="application/atom+xml" title="OS Version Tracker：上架規定與重要公告" href="feed.xml">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="OS Version Tracker">
  <meta property="og:locale" content="zh_TW">
  <meta property="og:url" content="${esc(SITE_URL)}/">
  <meta property="og:title" content="iOS / Android 上架期限與版本相容性追蹤">
  <meta property="og:description" content="${esc(shortDescription)}">
  <meta property="og:image" content="${esc(SITE_URL)}/og-image.png">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="og:image:alt" content="OS Version Tracker：iOS 與 Android 上架期限與版本相容性">
  <meta property="og:updated_time" content="${esc(data.cachedAt)}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="iOS / Android 上架期限與版本相容性追蹤">
  <meta name="twitter:description" content="${esc(shortDescription)}">
  <meta name="twitter:image" content="${esc(SITE_URL)}/og-image.png">
  <link rel="icon" href="icons/icon.svg" type="image/svg+xml">
  <link rel="icon" href="icons/icon-192.png" type="image/png" sizes="192x192">
  <link rel="apple-touch-icon" href="icons/apple-touch-icon.png">
  <link rel="manifest" href="manifest.webmanifest">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="default">
  <meta name="apple-mobile-web-app-title" content="OS Tracker">
  <script type="application/ld+json">${structuredData(data)}</script>
  <style>
    :root {
      --bg: #f3fbff;
      --bg-2: #ffffff;
      --ink: #0f3550;
      --muted: #4b7892;
      --accent: #0d96d4;
      --accent-2: #12b3a4;
      --accent-deep: #0a6ea1;
      --accent-soft: #dff4fb;
      --teal-soft: #dcf7f1;
      --panel: rgba(255, 255, 255, 0.96);
      --line: rgba(13, 150, 212, 0.22);
      --shadow: 0 20px 50px rgba(13, 63, 94, 0.12);

      --pass: #0e8578;
      --pass-soft: #dcf7f1;
      --warn: #b4690e;
      --warn-soft: #fff4e0;
      --fail: #cf3f58;
      --fail-soft: #ffecef;

      --r-lg: 32px;
      --r-md: 24px;
      --r-sm: 14px;
    }

    * { box-sizing: border-box; }
    html { -webkit-text-size-adjust: 100%; scroll-padding-top: 120px; }
    body {
      margin: 0;
      min-height: 100vh;
      color: var(--ink);
      font: 15px/1.65 "Noto Sans TC", "PingFang TC", "Microsoft JhengHei", system-ui, -apple-system, sans-serif;
      background:
        radial-gradient(1100px 620px at -8% -12%, rgba(13, 150, 212, 0.24), transparent 62%),
        radial-gradient(980px 560px at 108% -6%, rgba(18, 179, 164, 0.22), transparent 60%),
        linear-gradient(180deg, var(--bg), var(--bg-2));
      background-attachment: fixed;
    }
    body::before, body::after {
      content: "";
      position: fixed;
      width: 420px;
      height: 420px;
      border-radius: 50%;
      opacity: .5;
      pointer-events: none;
      z-index: 0;
      filter: blur(6px);
    }
    body::before { top: -160px; right: -120px; background: radial-gradient(circle, rgba(13, 150, 212, 0.38), transparent 68%); }
    body::after { bottom: -180px; left: -140px; background: radial-gradient(circle, rgba(18, 179, 164, 0.34), transparent 68%); }

    @keyframes fadeUp {
      from { opacity: 0; transform: translateY(18px); }
      to { opacity: 1; transform: none; }
    }

    /* Header */
    header {
      position: sticky;
      top: 0;
      z-index: 20;
      background: rgba(255, 255, 255, 0.82);
      backdrop-filter: blur(14px);
      -webkit-backdrop-filter: blur(14px);
      border-bottom: 1px solid var(--line);
      box-shadow: 0 10px 30px rgba(13, 63, 94, 0.06);
    }
    .brand { display: flex; align-items: center; gap: 12px; min-width: 0; color: inherit; text-decoration: none; }
    .brand-mark {
      width: 38px;
      height: 38px;
      flex: none;
      display: grid;
      place-items: center;
      border-radius: 11px;
      background: linear-gradient(135deg, var(--accent), var(--accent-2));
      box-shadow: 0 8px 18px rgba(13, 150, 212, 0.35);
    }
    .brand-mark svg { width: 24px; height: 24px; }
    .brand h1 { font-size: 17px; margin: 0; font-weight: 700; letter-spacing: .02em; line-height: 1.3; }
    .brand-sub { margin: 0; font-size: 11.5px; color: var(--muted); letter-spacing: .12em; text-transform: uppercase; }
    .summary {
      font-size: 13px;
      color: var(--accent-deep);
      background: var(--accent-soft);
      border: 1px solid var(--line);
      border-radius: 999px;
      padding: 4px 14px;
      white-space: nowrap;
    }
    .spacer { flex: 1; }
    .header-top { display: flex; align-items: center; gap: 16px; padding: 12px 28px 8px; }
    .section-nav {
      display: flex;
      gap: 6px;
      padding: 0 28px 10px;
      overflow-x: auto;
      scrollbar-width: none;
      white-space: nowrap;
      -webkit-overflow-scrolling: touch;
    }
    .section-nav::-webkit-scrollbar { display: none; }
    .section-nav a {
      flex: none;
      font-size: 13px;
      font-weight: 600;
      color: var(--accent-deep);
      text-decoration: none;
      padding: 4px 12px;
      border-radius: 999px;
      border: 1px solid transparent;
    }
    .section-nav a:hover { background: var(--accent-soft); border-color: var(--line); }
    .section-nav .nav-api { margin-left: auto; color: var(--muted); }
    .btn {
      font-weight: 600;
      font-size: 14px;
      border: 1px solid var(--line);
      background: #fff;
      color: var(--accent-deep);
      padding: 8px 16px;
      border-radius: 999px;
      text-decoration: none;
      white-space: nowrap;
      transition: background .18s ease, border-color .18s ease, transform .18s ease, box-shadow .18s ease;
    }
    .btn:hover { background: var(--accent-soft); border-color: rgba(13, 150, 212, 0.45); transform: translateY(-1px); }
    .btn:focus-visible { outline: 3px solid rgba(13, 150, 212, 0.45); outline-offset: 2px; }
    .btn.primary {
      background: linear-gradient(135deg, var(--accent), var(--accent-2));
      border-color: transparent;
      color: #fff;
      font-weight: 700;
      letter-spacing: .04em;
      box-shadow: 0 14px 28px rgba(13, 150, 212, 0.32);
    }
    .btn.primary:hover { background: linear-gradient(135deg, var(--accent-deep), #0e9a8e); }

    /* Layout */
    .wrap { position: relative; z-index: 1; padding: 30px 28px 72px; }
    .intro { margin: 0 0 22px 6px; color: var(--muted); font-size: 14px; }

    .panel {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: var(--r-lg);
      padding: 28px 30px;
      margin-bottom: 22px;
      box-shadow: var(--shadow);
      animation: fadeUp .7s ease both;
    }
    .panel:nth-of-type(2) { animation-delay: .08s; }
    .panel:nth-of-type(3) { animation-delay: .16s; }
    .panel > h2, .subhead {
      display: flex;
      align-items: center;
      gap: 10px;
      font-size: 15px;
      margin: 0 0 20px;
      font-weight: 700;
      letter-spacing: .05em;
    }
    .panel > h2::before {
      content: "";
      width: 4px;
      height: 18px;
      border-radius: 4px;
      background: linear-gradient(180deg, var(--accent), var(--accent-2));
    }
    .subhead { font-size: 13px; color: var(--muted); margin: 26px 0 12px; flex-wrap: wrap; row-gap: 2px; }
    .subhead-note { flex-basis: auto; }

    /* Version cards */
    .version-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(260px, 100%), 1fr)); gap: 14px; }
    .version-card {
      border: 1px solid var(--line);
      border-radius: var(--r-md);
      padding: 18px 20px;
      background: linear-gradient(115deg, rgba(223, 244, 251, 0.6), rgba(220, 247, 241, 0.6));
    }
    .version-header { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
    .version-number { font-size: 22px; font-weight: 700; letter-spacing: -0.01em; }
    .version-details { display: flex; flex-wrap: wrap; gap: 6px; }
    .meta {
      font-size: 12.5px;
      color: var(--muted);
      background: #fff;
      border: 1px solid var(--line);
      padding: 1px 10px;
      border-radius: 999px;
    }
    code { font-family: "SF Mono", Menlo, Consolas, monospace; font-size: 12px; }
    .badge {
      font-size: 11px;
      font-weight: 700;
      letter-spacing: .06em;
      text-transform: uppercase;
      padding: 2px 10px;
      border-radius: 999px;
      border: 1px solid transparent;
    }
    .badge-stable { color: var(--pass); background: var(--pass-soft); border-color: rgba(18, 179, 164, 0.45); }
    .badge-beta { color: var(--warn); background: var(--warn-soft); border-color: rgba(180, 105, 14, 0.3); }
    .badge-sm { font-size: 10px; padding: 0 7px; }
    .empty { color: var(--muted); font-size: 14px; padding: 8px 2px; }

    /* Case card (checklist + deadlines) */
    .case {
      background: #fff;
      border: 1px solid var(--line);
      border-radius: var(--r-md);
      overflow: hidden;
    }
    .case-head {
      display: flex;
      align-items: center;
      gap: 12px;
      flex-wrap: wrap;
      padding: 12px 20px;
      background: linear-gradient(115deg, var(--accent-soft), var(--teal-soft));
      border-bottom: 1px solid var(--line);
    }
    .case-no {
      background: #fff;
      color: var(--accent-deep);
      font-weight: 700;
      font-size: 13px;
      padding: 4px 14px;
      border-radius: 999px;
      border: 1px solid var(--line);
      white-space: nowrap;
    }
    .case-count { font-size: 12.5px; color: var(--muted); margin-left: auto; }
    .case-body { padding: 18px 20px; }

    /* Action checklist */
    .actions { list-style: none; margin: 0; padding: 0; }
    .action { display: flex; gap: 14px; align-items: flex-start; padding: 14px 20px; }
    .action + .action { border-top: 1px solid rgba(13, 150, 212, 0.12); }
    .status {
      flex: none;
      min-width: 7.4rem;
      text-align: center;
      font-size: 11.5px;
      font-weight: 700;
      letter-spacing: .04em;
      padding: 3px 10px;
      border-radius: 999px;
      border: 1px solid transparent;
      white-space: nowrap;
      margin-top: 1px;
    }
    .status-urgent { color: var(--fail); background: var(--fail-soft); border-color: rgba(207, 63, 88, 0.32); }
    .status-upcoming { color: var(--warn); background: var(--warn-soft); border-color: rgba(180, 105, 14, 0.3); }
    .status-ok { color: var(--pass); background: var(--pass-soft); border-color: rgba(18, 179, 164, 0.45); }
    .status-info { color: var(--accent-deep); background: var(--accent-soft); border-color: var(--line); }
    .action-body { min-width: 0; overflow-wrap: anywhere; }
    .action-title { font-size: 14.5px; font-weight: 700; line-height: 1.5; }
    .action-title a { color: inherit; text-decoration: none; border-bottom: 1px dashed rgba(13, 150, 212, 0.5); }
    .action-title a:hover { color: var(--accent-deep); border-bottom-style: solid; }
    .action-detail { font-size: 13px; color: var(--muted); margin-top: 2px; }

    /* Toolchain tiles */
    .tile-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(200px, 100%), 1fr)); gap: 12px; }
    .tile {
      display: block;
      color: inherit;
      text-decoration: none;
      background: #fff;
      border: 1px solid var(--line);
      border-radius: var(--r-sm);
      padding: 12px 16px;
      transition: border-color .18s ease, box-shadow .18s ease, transform .18s ease;
    }
    a.tile:hover { border-color: rgba(13, 150, 212, 0.5); box-shadow: 0 10px 24px rgba(13, 63, 94, 0.1); transform: translateY(-1px); }
    .tile-label { display: flex; align-items: center; gap: 6px; font-size: 12.5px; color: var(--muted); font-weight: 500; }
    .tile-value { font-size: 17px; font-weight: 700; margin: 2px 0 4px; color: var(--accent-deep); }
    .tile-sub { font-size: 12px; color: var(--muted); line-height: 1.55; }

    /* News */
    .news { list-style: none; margin: 0; padding: 0; }
    .news li { display: flex; align-items: baseline; gap: 10px; padding: 10px 20px; font-size: 14px; }
    .news li + li { border-top: 1px solid rgba(13, 150, 212, 0.12); }
    .news a { color: var(--ink); text-decoration: none; min-width: 0; overflow-wrap: anywhere; }
    .news a:hover { color: var(--accent-deep); text-decoration: underline; }
    .news-date { flex: none; font-size: 12.5px; color: var(--muted); font-variant-numeric: tabular-nums; }
    .news-flag { min-width: 0; padding: 0 8px; font-size: 11px; }
    a.case-count { text-decoration: none; color: var(--accent-deep); font-weight: 600; }
    a.case-count:hover { text-decoration: underline; }

    /* Adoption */
    .subhead-note { font-weight: 500; font-size: 12px; letter-spacing: 0; color: var(--muted); opacity: .8; }
    .adoption { display: grid; gap: 10px; }
    .adoption-row { display: grid; grid-template-columns: 9em 1fr; gap: 12px; align-items: center; }
    .adoption-label { font-size: 13px; color: var(--muted); }
    .adoption-bar { display: flex; height: 28px; border-radius: 999px; overflow: hidden; background: var(--accent-soft); }
    .seg { display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 700; color: #fff; white-space: nowrap; overflow: hidden; }
    .seg + .seg { border-left: 2px solid #fff; }
    .seg.c0, .bar-legend .c0 { background: #0a6ea1; }
    .seg.c1, .bar-legend .c1 { background: #12b3a4; }
    .seg.c2, .bar-legend .c2 { background: #7cc7e8; color: var(--ink); }
    .seg.c3, .bar-legend .c3 { background: #b9e6de; color: var(--ink); }
    .seg.c-rest, .bar-legend .c-rest { background: #d5e2ea; color: var(--ink); }
    .bar-legend { display: flex; flex-wrap: wrap; gap: 6px 14px; margin-top: 8px; font-size: 12.5px; color: var(--muted); }
    .bar-legend span { display: inline-flex; align-items: center; gap: 6px; }
    .bar-legend i { width: 12px; height: 12px; border-radius: 3px; display: inline-block; }

    /* Sources */
    .sources { margin-top: 18px; font-size: 12.5px; color: var(--muted); }
    .sources summary { cursor: pointer; width: fit-content; list-style: none; }
    .sources summary::before { content: "ⓘ "; }
    .sources summary:hover { color: var(--accent-deep); }
    .sources ul { list-style: none; margin: 8px 0 0; padding: 0; display: flex; flex-wrap: wrap; gap: 6px; }
    .sources li { background: var(--bg); border: 1px solid rgba(13, 150, 212, 0.14); border-radius: 999px; padding: 2px 12px; }
    .sources a { color: var(--accent-deep); text-decoration: none; }
    .sources a:hover { text-decoration: underline; }
    .src-time { margin-left: 6px; font-variant-numeric: tabular-nums; }
    .src-fail { margin-left: 6px; color: var(--fail); font-weight: 600; }

    /* Compatibility tables */
    .table-note { font-size: 13px; color: var(--muted); margin: -4px 0 10px; }
    .table-wrap { overflow-x: auto; border: 1px solid var(--line); border-radius: var(--r-sm); background: #fff; }
    .compat-table { width: 100%; border-collapse: collapse; font-size: 13.5px; white-space: nowrap; }
    .compat-table th {
      text-align: left;
      font-weight: 700;
      font-size: 12.5px;
      color: var(--accent-deep);
      background: linear-gradient(115deg, var(--accent-soft), var(--teal-soft));
      padding: 10px 14px;
    }
    .compat-table td { padding: 9px 14px; border-top: 1px solid rgba(13, 150, 212, 0.12); }
    .compat-table tr.current td { background: rgba(220, 247, 241, 0.5); }
    .compat-table tbody tr:hover td { background: var(--bg); }
    .warn-text { color: var(--warn); font-weight: 600; }

    /* Timeline */
    .timeline { list-style: none; margin: 0; padding: 0; }
    .tl-item { display: flex; gap: 16px; padding: 14px 20px; }
    .tl-item + .tl-item { border-top: 1px solid rgba(13, 150, 212, 0.12); }
    .tl-date { flex: none; width: 6.5em; font-weight: 700; color: var(--accent-deep); font-variant-numeric: tabular-nums; }
    .tl-body { min-width: 0; overflow-wrap: anywhere; }
    .tl-head { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
    .tl-head .status { min-width: 0; }
    .tl-title { font-weight: 700; font-size: 14.5px; color: var(--ink); text-decoration: none; }
    .tl-title:hover { color: var(--accent-deep); text-decoration: underline; }
    .tl-platform { font-size: 11px; font-weight: 700; padding: 1px 8px; border-radius: 6px; color: #fff; }
    .tl-ios { background: #5b7083; }
    .tl-android { background: #3d9a5f; }
    .tl-source { font-size: 11.5px; color: var(--muted); opacity: .8; margin-top: 2px; }

    .offline-banner {
      position: fixed;
      left: 50%;
      bottom: 20px;
      transform: translateX(-50%);
      z-index: 30;
      padding: 8px 18px;
      border-radius: 999px;
      font-size: 13px;
      font-weight: 600;
      color: #fff;
      background: var(--ink);
      box-shadow: var(--shadow);
    }
    .offline-banner[hidden] { display: none; }

    /* "New since last visit" */
    .is-new { position: relative; background: linear-gradient(90deg, rgba(13, 150, 212, 0.07), transparent 60%); }
    .is-new::after {
      content: "新";
      position: absolute;
      top: 10px;
      right: 14px;
      font-size: 11px;
      font-weight: 700;
      color: #fff;
      background: linear-gradient(135deg, var(--accent), var(--accent-2));
      border-radius: 999px;
      padding: 0 8px;
    }

    /* Subscribe + checker */
    .subscribe { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; font-size: 14px; color: var(--muted); }
    .check-form { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
    .check-form fieldset {
      border: 1px solid var(--line);
      border-radius: var(--r-md);
      padding: 14px 18px 18px;
      margin: 0;
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(min(140px, 100%), 1fr));
      gap: 12px;
      align-content: start;
      background: #fff;
    }
    .check-form legend { font-weight: 700; color: var(--accent-deep); padding: 0 6px; }
    .check-form label { display: grid; gap: 4px; font-size: 12.5px; color: var(--muted); font-weight: 500; }
    .check-form input[type=text] {
      width: 100%;
      padding: 9px 12px;
      border: 1px solid var(--line);
      border-radius: var(--r-sm);
      font: inherit;
      color: var(--ink);
      background: rgba(255, 255, 255, 0.9);
    }
    .check-form input[type=text]:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 4px rgba(13, 150, 212, 0.18); }
    .check-form input:invalid { border-color: var(--fail); }
    .check-inline { display: flex !important; align-items: center; gap: 8px; grid-column: 1 / -1; font-size: 13.5px !important; color: var(--ink) !important; }
    .check-inline input { accent-color: var(--accent-2); width: 16px; height: 16px; }
    .check-actions { grid-column: 1 / -1; display: flex; gap: 10px; flex-wrap: wrap; }
    .check-actions button { cursor: pointer; font: inherit; }
    .check-results { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0 16px; }
    .check-results.single { grid-template-columns: 1fr; }

    /* Crashes */
    .crash-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; align-items: start; }
    .forum-links { display: flex; flex-wrap: wrap; gap: 8px 14px; align-items: center; margin-top: 14px; font-size: 13px; color: var(--muted); }
    .forum-links a { color: var(--accent-deep); font-weight: 600; text-decoration: none; }
    .forum-links a:hover { text-decoration: underline; }
    .crash-list { list-style: none; margin: 0; padding: 0; }
    .crash-list li { padding: 12px 18px; display: grid; gap: 4px; overflow-wrap: anywhere; }
    .crash-list li + li { border-top: 1px solid rgba(13, 150, 212, 0.12); }
    .crash-list .status { min-width: 0; }
    .crash-context { font-size: 12px; color: var(--muted); }
    .crash-title { font-size: 13.5px; font-weight: 600; color: var(--ink); text-decoration: none; line-height: 1.5; }
    .crash-title:hover { color: var(--accent-deep); text-decoration: underline; }
    .crash-note { font-size: 11.5px; color: var(--muted); padding: 10px 18px; border-top: 1px solid rgba(13, 150, 212, 0.12); background: var(--bg); }
    .tl-cross { background: #7b61c4; }
    .wrap-cell { white-space: normal; min-width: 260px; }

    /* Privacy */
    .privacy-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(220px, 100%), 1fr)); gap: 12px; }
    .privacy-card { background: #fff; border: 1px solid var(--line); border-radius: var(--r-sm); padding: 12px 16px; display: grid; gap: 4px; align-content: start; min-width: 0; overflow-wrap: anywhere; }
    .privacy-card code { word-break: break-all; }
    .privacy-reasons { display: flex; flex-wrap: wrap; gap: 4px; }
    .privacy-reasons { margin-top: 4px; }
    .privacy-reasons span { background: var(--accent-soft); border-radius: 6px; padding: 0 6px; cursor: help; align-self: start; }
    .sdk-list summary { cursor: pointer; font-size: 13.5px; color: var(--accent-deep); font-weight: 600; }
    .sdk-chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
    .sdk-chips span { font-size: 12.5px; background: #fff; border: 1px solid var(--line); border-radius: 999px; padding: 1px 10px; }
    .privacy-links { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
    .privacy-links ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
    .privacy-links li { display: grid; font-size: 13.5px; }
    .privacy-links li a { color: var(--accent-deep); font-weight: 600; text-decoration: none; }
    .privacy-links li a:hover { text-decoration: underline; }
    .privacy-links li span { font-size: 12.5px; color: var(--muted); }

    /* Notification center */
    .notif { position: relative; }
    .notif-bell {
      position: relative;
      width: 40px;
      height: 40px;
      display: grid;
      place-items: center;
      border-radius: 999px;
      border: 1px solid var(--line);
      background: #fff;
      color: var(--accent-deep);
      cursor: pointer;
    }
    .notif-bell:hover { background: var(--accent-soft); }
    .notif-bell svg { width: 20px; height: 20px; }
    .notif-badge {
      position: absolute;
      top: -4px;
      right: -4px;
      min-width: 20px;
      height: 20px;
      padding: 0 5px;
      border-radius: 999px;
      background: var(--fail);
      color: #fff;
      font-size: 11px;
      font-weight: 700;
      line-height: 20px;
      text-align: center;
      border: 2px solid #fff;
    }
    .notif-badge[hidden], .notif-panel[hidden] { display: none; }
    .notif-panel {
      position: absolute;
      right: 0;
      top: calc(100% + 10px);
      width: min(400px, calc(100vw - 24px));
      max-height: min(70vh, 560px);
      display: flex;
      flex-direction: column;
      background: #fff;
      border: 1px solid var(--line);
      border-radius: var(--r-md);
      box-shadow: var(--shadow);
      overflow: hidden;
      z-index: 40;
    }
    .notif-head { display: flex; justify-content: space-between; align-items: center; padding: 12px 16px; background: linear-gradient(115deg, var(--accent-soft), var(--teal-soft)); border-bottom: 1px solid var(--line); }
    .notif-link { border: 0; background: none; color: var(--accent-deep); font: inherit; font-size: 13px; font-weight: 600; cursor: pointer; }
    .notif-list { list-style: none; margin: 0; padding: 0; overflow-y: auto; }
    .notif-item a { display: grid; gap: 4px; padding: 11px 16px; color: var(--ink); text-decoration: none; border-bottom: 1px solid rgba(13, 150, 212, 0.1); }
    .notif-item a:hover { background: var(--bg); }
    .notif-item.unread a { background: rgba(13, 150, 212, 0.06); }
    .notif-item.unread .notif-title::before { content: ""; display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: var(--accent); margin-right: 8px; vertical-align: 2px; }
    .notif-meta { display: flex; gap: 8px; align-items: center; font-size: 12px; color: var(--muted); }
    .notif-title { font-size: 13.5px; font-weight: 600; line-height: 1.5; overflow-wrap: anywhere; }
    .notif-empty { padding: 24px 16px; text-align: center; color: var(--muted); font-size: 14px; }
    .notif-foot { display: grid; gap: 8px; padding: 12px 16px; border-top: 1px solid var(--line); font-size: 12px; color: var(--muted); }
    .notif-foot .btn { cursor: pointer; font: inherit; font-size: 13px; font-weight: 600; justify-self: start; }
    .notif-foot .btn[hidden] { display: none; }

    /* Toasts */
    .toasts { position: fixed; right: 20px; bottom: 20px; z-index: 50; display: grid; gap: 10px; width: min(360px, calc(100vw - 32px)); }
    .toast {
      display: flex;
      align-items: flex-start;
      gap: 10px;
      padding: 12px 14px;
      background: #fff;
      border: 1px solid var(--line);
      border-left: 4px solid var(--accent);
      border-radius: var(--r-sm);
      box-shadow: var(--shadow);
      font-size: 13.5px;
      animation: fadeUp .3s ease both;
    }
    .toast-body { flex: 1; min-width: 0; overflow-wrap: anywhere; }
    .toast-action { flex: none; cursor: pointer; font: inherit; font-size: 12.5px; padding: 4px 12px; }
    .toast-close { flex: none; border: 0; background: none; font-size: 18px; line-height: 1; color: var(--muted); cursor: pointer; }

    /* Version distribution */
    .share-grid { display: grid; grid-template-columns: minmax(0, 1fr); gap: 12px; margin-top: 14px; }
    .share-top { background: #fff; border: 1px solid var(--line); border-radius: var(--r-sm); padding: 12px 16px; display: grid; gap: 8px; }
    .share-chips { display: flex; flex-wrap: wrap; gap: 6px; }
    .share-chips span { font-size: 13px; background: var(--bg); border: 1px solid rgba(13, 150, 212, 0.14); border-radius: 999px; padding: 2px 10px; }
    .share-chips strong { color: var(--accent-deep); }
    .share-top a { color: var(--accent-deep); }
    .share-table .compat-table { white-space: normal; }
    .share-table th:first-child, .share-table td:first-child { width: 28%; white-space: nowrap; }
    .share-table td:not(:first-child) { width: 36%; }
    .cov { position: relative; height: 22px; border-radius: 6px; background: var(--bg); overflow: hidden; }
    .cov-bar { position: absolute; inset: 0 auto 0 0; background: linear-gradient(90deg, rgba(13, 150, 212, 0.35), rgba(18, 179, 164, 0.45)); border-radius: 6px; }
    .cov-num { position: relative; display: block; padding: 0 8px; line-height: 22px; font-size: 12.5px; font-weight: 700; font-variant-numeric: tabular-nums; color: var(--ink); }

    /* Taiwan banks */
    .bank-summary { display: grid; gap: 10px; margin-bottom: 14px; }
    .bank-summary .share-chips strong { margin-left: 6px; }
    .bank-table a { color: var(--accent-deep); text-decoration: none; font-weight: 600; }
    .bank-table a:hover { text-decoration: underline; }

    /* Legal */
    .intro-legal { margin-left: 10px; font-size: 12.5px; color: var(--muted); }
    .legal-lead { font-size: 13.5px; color: var(--muted); margin: 0 0 8px; }
    .legal-doc { margin-top: 12px; border: 1px solid var(--line); border-radius: var(--r-sm); background: #fff; }
    .legal-doc summary { cursor: pointer; padding: 12px 16px; font-weight: 700; color: var(--accent-deep); }
    .legal-body { padding: 0 20px 16px; font-size: 13.5px; line-height: 1.75; overflow-wrap: anywhere; }
    .legal-body h3 { font-size: 15px; margin: 18px 0 6px; }
    .legal-body ul { padding-left: 1.3em; margin: 6px 0; }
    .legal-body a { color: var(--accent-deep); }
    .legal-body code { background: var(--bg); padding: 0 4px; border-radius: 4px; }
    .legal-body .table-wrap { margin: 8px 0; }
    .legal-table { white-space: normal; }

    /* Basis tags + upgrade plan */
    .basis { display: inline-block; margin-left: 8px; font-size: 11px; font-weight: 700; border-radius: 999px; padding: 0 8px; vertical-align: 2px; cursor: help; }
    .basis-official { color: var(--muted); border: 1px solid var(--line); }
    .basis-estimate { color: var(--warn); border: 1px dashed rgba(180, 105, 14, 0.5); }
    .basis-community { color: #7b61c4; border: 1px dashed rgba(123, 97, 196, 0.5); }
    .basis-reference { color: var(--accent-deep); border: 1px dotted var(--line); }
    .basis-legend { padding: 8px 20px 10px; font-size: 11.5px; color: var(--muted); border-top: 1px solid rgba(13, 150, 212, 0.12); line-height: 2; }
    .basis-legend .basis { margin: 0 4px 0 0; }
    .upgrade-plan { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; margin-top: 16px; padding: 12px 16px; background: #fff; border: 1px solid var(--line); border-left: 4px solid var(--accent); border-radius: var(--r-sm); }
    .upgrade-plan-label { font-size: 13px; font-weight: 700; color: var(--accent-deep); }
    .upgrade-plan ol { display: flex; flex-wrap: wrap; gap: 6px; list-style: none; margin: 0; padding: 0; counter-reset: plan; }
    .upgrade-plan li { counter-increment: plan; font-size: 13px; padding: 3px 12px; border-radius: 999px; background: var(--bg); border: 1px solid var(--line); }
    .upgrade-plan li::before { content: counter(plan) ". "; color: var(--muted); }
    .upgrade-plan li + li { position: relative; margin-left: 14px; }
    .upgrade-plan li + li::after { content: "→"; position: absolute; left: -16px; top: 3px; color: var(--muted); }
    .upgrade-plan li.plan-urgent { border-color: rgba(207, 63, 88, 0.4); background: var(--fail-soft); }
    .upgrade-plan li span { color: var(--muted); }

    /* Deadlines */
    .deadline-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(300px, 100%), 1fr)); gap: 16px; }
    .deadline-date { font-size: 17px; font-weight: 700; color: var(--accent-deep); }
    .deadline-note { font-size: 13px; color: var(--muted); margin-bottom: 10px; }
    .deadline-reqs { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
    .deadline-reqs li {
      display: flex;
      flex-direction: column;
      font-size: 13px;
      padding: 8px 12px;
      border-radius: var(--r-sm);
      background: var(--bg);
      border: 1px solid rgba(13, 150, 212, 0.14);
    }
    .deadline-reqs span { color: var(--muted); font-size: 12px; }
    .deadline-meta { font-size: 12.5px; color: var(--muted); margin-top: 10px; }

    @media (max-width: 1100px) {
      .crash-grid { grid-template-columns: 1fr; }
    }
    @media (max-width: 760px) {
      .header-top { padding: 10px 16px 6px; flex-wrap: wrap; gap: 6px 10px; }
      .notif { order: 1; margin-left: auto; }
      .spacer { order: 2; flex-basis: 100%; height: 0; }
      .summary { order: 3; }
      .section-nav { padding: 0 16px 8px; }
      .wrap { padding: 20px 14px 56px; }
      .panel { padding: 22px 18px; border-radius: var(--r-md); }
      .action { flex-direction: column; gap: 6px; padding: 14px 16px; }
      .status { min-width: 0; }
      .tile-grid { grid-template-columns: 1fr 1fr; }
      .tile:last-child:nth-child(odd) { grid-column: 1 / -1; }
      .adoption-row { grid-template-columns: 1fr; gap: 4px; }
      .news li { flex-wrap: wrap; padding: 10px 16px; }
      .tl-item { flex-direction: column; gap: 4px; padding: 14px 16px; }
      .check-form, .check-results, .crash-grid, .privacy-links, .share-grid { grid-template-columns: 1fr; }
      /* Tables become one card per row, each value labelled, instead of clipping columns */
      .table-wrap { border: 0; background: transparent; overflow: visible; }
      .stack-on-mobile, .stack-on-mobile tbody, .stack-on-mobile tr, .stack-on-mobile td { display: block; width: 100%; }
      .stack-on-mobile thead { display: none; }
      .stack-on-mobile { white-space: normal; }
      .stack-on-mobile tr { background: #fff; border: 1px solid var(--line); border-radius: var(--r-sm); padding: 10px 14px; margin-bottom: 10px; }
      .stack-on-mobile tr.current { border-color: rgba(18, 179, 164, 0.6); background: rgba(220, 247, 241, 0.35); }
      .stack-on-mobile tr.current td, .stack-on-mobile tbody tr:hover td { background: transparent; }
      .stack-on-mobile td { display: flex; gap: 12px; justify-content: space-between; padding: 5px 0; border-top: 1px dashed rgba(13, 150, 212, 0.14); text-align: right; overflow-wrap: anywhere; }
      .stack-on-mobile td::before { content: attr(data-label); flex: none; color: var(--muted); font-size: 12.5px; text-align: left; }
      .stack-on-mobile td.row-title { border-top: 0; justify-content: flex-start; text-align: left; font-size: 15px; padding-top: 0; }
      .stack-on-mobile td.row-title::before { content: none; }
      .wrap-cell { min-width: 0; }
      .table-wrap.share-table { border: 1px solid var(--line); background: #fff; }
      .share-table td, .share-table th { padding: 8px 10px; }
      .bank-table .bank-updated { display: none; }
      .bank-table tr { padding: 8px 14px; margin-bottom: 8px; }
      /* iOS Safari zooms the page when focusing inputs smaller than 16px */
      .check-form input[type=text] { font-size: 16px; }
      .summary { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; font-size: 12px; }
      .subhead-note { flex-basis: 100%; }
      /* Keep the brand and the JSON button on one line */
      .brand h1 { font-size: 15px; }
      .brand-sub { font-size: 10px; letter-spacing: .08em; }
      .brand-mark { width: 34px; height: 34px; }
    }
    @media (prefers-reduced-motion: reduce) {
      .panel { animation: none; }
    }
  </style>
</head>
<body>
  <header>
    <div class="header-top">
    <a class="brand" href="./">
      <span class="brand-mark"><svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="2.2" fill="#fff" stroke="none"/><path d="M8.46 15.54a5 5 0 0 1 0-7.08"/><path d="M15.54 8.46a5 5 0 0 1 0 7.08"/><path d="M5.64 18.36a9 9 0 0 1 0-12.72"/><path d="M18.36 5.64a9 9 0 0 1 0 12.72"/></svg></span>
      <div>
        <h1>OS Version Tracker</h1>
        <p class="brand-sub">Developer Release Radar</p>
      </div>
    </a>
    <span class="summary">${renderSummary(data)}</span>
    <span class="spacer"></span>
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
    <nav class="section-nav" aria-label="頁面區塊">
      <a href="#recent">最新</a>
      <a href="#checker">專案檢查</a>
      <a href="#crashes">閃退</a>
      <a href="#ios">iOS</a>
      <a href="#android">Android</a>
      <a href="#compat">相容性</a>
      <a href="#deadlines">上架期限</a>
      <a href="#banks">銀行</a>
      <a href="#privacy">隱私</a>
      <a href="#legal">免責聲明</a>
      <a class="nav-api" href="api.json">JSON API</a>
    </nav>
  </header>
  <div class="toasts" id="toasts" aria-live="polite"></div>
  <script type="application/json" id="notif-data">${buildNotificationsJson(data.tracked, data.cachedAt).replace(/</g, '\\u003c')}</script>
  <script src="notifications.js" defer></script>

  <main class="wrap">
    <p class="intro">iOS 與 Android 最新版本，以及隨之而來的 Xcode、SDK 與商店上架需求。<a class="intro-legal" href="#legal">免責聲明 · Disclaimer</a></p>

    ${renderRecent(data)}

    ${renderChecker(data, config, options.staticSite)}

    ${renderCrashesSection(data)}

    ${renderPlatformSection('ios', 'Apple iOS', ios,
      renderActions(data.iosActions) + renderVersionDistribution('ios', data) + renderTiles(iOSTiles(data.iosToolchain, data.announcedDevices))
      + renderNews('Apple 開發者公告', data.appleNews, 'https://developer.apple.com/news/')
      + renderSources(data, ['ios', 'appleDeadline', 'appleRequirements', 'iosToolchain', 'xcodeSupport', 'adoption', 'osShare', 'appleNews']))}

    ${renderPlatformSection('android', 'Android', android,
      renderActions(data.androidActions) + renderVersionDistribution('android', data) + renderTiles(androidTiles(data.androidToolchain))
      + renderNews('Android 開發者部落格', data.androidNews, 'https://android-developers.googleblog.com/')
      + renderSources(data, ['android', 'googleDeadline', 'androidToolchain', 'androidCompat', 'playBilling', 'playPolicy', 'pageSize', 'osShare', 'androidNews']))}

    ${renderCompatSection(data)}

    ${renderDeadlinesSection(data)}

    ${renderBanksSection(data)}

    ${renderPrivacySection(data)}

    ${renderLegalSection()}

  </main>
  <div class="offline-banner" id="offline" hidden>目前離線，顯示的是上次抓取的資料</div>
  <script>
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
    }
    const offline = document.getElementById('offline');
    const syncOnline = () => { offline.hidden = navigator.onLine; };
    window.addEventListener('online', syncOnline);
    window.addEventListener('offline', syncOnline);
    syncOnline();

    // "新" markers: items that appeared since this browser's previous visit
    try {
      const KEY = 'seen-items';
      const items = [...document.querySelectorAll('[data-key]')];
      const stored = localStorage.getItem(KEY);
      const seen = new Set(stored ? JSON.parse(stored) : []);
      if (stored) {
        for (const el of items) {
          if (!seen.has(el.dataset.key)) el.classList.add('is-new');
        }
      }
      for (const el of items) seen.add(el.dataset.key);
      localStorage.setItem(KEY, JSON.stringify([...seen].slice(-1000)));
    } catch {}

    // Remember the project checker inputs in this browser
    try {
      const form = document.getElementById('check-form');
      const saved = JSON.parse(localStorage.getItem('project-config') || 'null');
      if (form && saved && !location.search) {
        for (const [name, value] of Object.entries(saved)) {
          const input = form.elements.namedItem(name);
          if (!input) continue;
          if (input.type === 'checkbox') input.checked = value === '1';
          else input.value = value;
        }
      }
      form?.addEventListener('submit', () => {
        const values = {};
        for (const [name, value] of new FormData(form)) values[name] = String(value);
        localStorage.setItem('project-config', JSON.stringify(values));
      });
      document.getElementById('copy-link')?.addEventListener('click', async event => {
        await navigator.clipboard.writeText(location.href);
        event.target.textContent = '已複製';
      });
    } catch {}
  </script>
</body>
</html>`;
}
