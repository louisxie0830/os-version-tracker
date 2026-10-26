import { widthClass } from './render-styles.js';
import type { AllVersions } from './fetch-all.js';
import { compareVersions } from './versions.js';
import { zhDate } from './insights.js';
import { displayDate, esc, externalLink } from './render-actions.js';
import type { OSVersionInfo, ToolVersion } from './types.js';
import type { Tile } from './render-common.js';
import { isActive } from './fetchers/apple-status.js';

/** The iOS and Android sections: version cards, toolchain tiles and version distribution bars. */

export function iOSTiles(toolchain: AllVersions['iosToolchain'], announced: AllVersions['announcedDevices']): Tile[] {
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
        `Build ${x.build} · ${displayDate(x.releaseDate)}`,
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
      sub: [`出廠搭載 iOS ${phones[0].shipsWithiOS}`, `${displayDate(phones[0].releaseDate)} 上市`],
    });
  }
  for (const device of announced) {
    tiles.push({
      label: 'Apple 已公告新機型',
      value: device.name.replace(/^iPhone /, 'iPhone '),
      sub: [`${displayDate(device.date)} 公告`, '尚未收錄於機型資料庫'],
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
    sub: [tool.releaseDate ? `${displayDate(tool.releaseDate)} 發布` : ''],
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
    sub: [`${tool.version}`, tool.releaseDate ? `${displayDate(tool.releaseDate)} 發布` : ''],
  };
}

export function androidTiles(toolchain: AllVersions['androidToolchain']): Tile[] {
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
      ...segs.map(sg => `<span class="seg c${colorOf(sg.v)} ${widthClass(sg.share)}" title="${esc(name(sg.v))} ${sg.share}%">${sg.share >= 9 ? `${Math.round(sg.share)}%` : ''}</span>`),
      ...(rest > 0 ? [`<span class="seg c-rest ${widthClass(rest)}" title="更早 ${rest}%">${rest >= 9 ? `${Math.round(rest)}%` : ''}</span>`] : []),
    ];
    return `<div class="adoption-row"><div class="adoption-label">${row.label}</div><div class="adoption-bar">${parts.join('')}</div></div>`;
  }).join('');
  const legend = [...versions.map(v => `<span><i class="c${colorOf(v)}"></i>${esc(name(v))}</span>`), '<span><i class="c-rest"></i>更早</span>'].join('');
  return `<div class="adoption">${bars}</div><div class="bar-legend">${legend}</div>`;
}

/** Percentage with a bar behind it, so the full-width table reads at a glance */
function coverageCell(pct: number | undefined): string {
  if (pct === undefined) return '—';
  return `<div class="cov"><span class="cov-bar ${widthClass(pct)}"></span><span class="cov-num">${pct}%</span></div>`;
}

export function renderVersionDistribution(platform: 'ios' | 'android', data: AllVersions): string {
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
  const sourceNote = `台灣、全球：StatCounter ${esc(displayDate(share.month))}（網站流量估算）`
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
      <tbody data-search-rows>${coverageRows.join('')}</tbody>
    </table></div>
    <div class="share-top">
      <div class="tile-label">台灣最多人使用的版本</div>
      <div class="share-chips">${top}</div>
      <p class="tl-source">占比以已知版本計算；「涵蓋」= 該版本以上的裝置比例。${externalLink(base.url, `查看 StatCounter 原始資料`)}</p>
      <p class="tl-source">台灣、全球資料來源：StatCounter Global Stats，依 ${externalLink('https://creativecommons.org/licenses/by-sa/3.0/', 'CC BY-SA 3.0')} 授權。本區的版本分布圖與涵蓋率是依其資料計算的改作，同樣依 CC BY-SA 3.0 提供。</p>
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
      <span class="meta">${esc(displayDate(v.releaseDate))} 發布</span>
    </div>
  </div>`;
}

/** Apple developer services: what had a problem in the last week, as of the last refresh */
export function renderAppleStatus(data: AllVersions): string {
  const status = data.appleStatus;
  if (!status) return '';
  const taipei = (iso: string) => {
    const t = new Date(new Date(iso).getTime() + 8 * 60 * 60 * 1000).toISOString();
    return `${t.slice(5, 7)}/${t.slice(8, 10)} ${t.slice(11, 16)}`;
  };
  const TYPE: Record<string, string> = { Outage: '中斷', Issue: '異常', Maintenance: '維護' };
  const rows = status.events.map(e => {
    const active = isActive(e);
    return `<li>
      <div class="tl-head">
        <span class="status status-${active ? (e.type === 'Maintenance' ? 'upcoming' : 'urgent') : 'ok'}">${active ? (e.state === 'upcoming' ? '即將' : '進行中') : '已結束'}</span>
        <span class="crash-context">${esc(taipei(e.start))}${e.end ? ` – ${esc(taipei(e.end))}` : active ? '' : '，結束時間 Apple 未公布'}（台灣時間）</span>
      </div>
      <span class="crash-title">${esc(e.service)} ${esc(TYPE[e.type] ?? e.type)}</span>
    </li>`;
  }).join('');
  return `<div class="case mt-18">
    <div class="case-head">
      <span class="case-no">Apple 開發者服務狀態</span>
      <span class="case-count">${status.events.length ? `近 7 天 ${status.events.length} 件` : `${status.services} 項服務，近 7 天沒有事件`}</span>
    </div>
    ${rows ? `<ul class="crash-list" data-search-rows>${rows}</ul>` : ''}
    <div class="case-body"><p class="table-note">App Store Connect、TestFlight、APNs、Xcode Cloud 等服務的事件紀錄，網站每天更新兩次，不是即時狀態；${externalLink(status.url, '最新狀態請看 Apple 系統狀態頁')}。</p></div>
  </div>`;
}

export function renderPlatformSection(id: string, name: string, versions: OSVersionInfo[], extra = ''): string {
  const body = versions.length
    ? `<div class="version-grid" data-search-rows>${versions.map(renderVersionCard).join('')}</div>`
    : '<div class="empty">暫時無法取得資料</div>';
  return `<section class="panel" id="${id}">
    <h2>${name}</h2>
    ${body}
    ${extra}
  </section>`;
}
