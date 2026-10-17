import type { AllVersions } from './fetch-all.js';
import { compareVersions } from './fetchers/ios-toolchain.js';
import type { Region, ShareTrend } from './fetchers/os-share.js';
import { displayDate, esc } from './render-actions.js';
import { renderLineChart, type LineSeries } from './render-chart.js';
import { renderSources, renderToggle } from './render-common.js';

/** History trend charts: OS version share over 12 months and bank App minimum versions. */

const TREND_SLOTS = [1, 2, 3, 4] as const;

const REGION_LABEL: Record<Region, string> = { TW: '台灣', ww: '全球' };

/**
 * The four majors with the largest latest share in any region keep a fixed colour across the
 * region toggle (colour follows the version, not its rank); everything else folds into 其他.
 */
export function pickTrendSeries(trends: Partial<Record<Region, ShareTrend>>, prefix: string): Partial<Record<Region, LineSeries[]>> {
  const score = new Map<string, number>();
  for (const t of Object.values(trends)) {
    for (const s of t!.series) {
      if (s.version === '其他') continue;
      score.set(s.version, Math.max(score.get(s.version) ?? 0, s.shares.at(-1) ?? 0));
    }
  }
  const top = [...score].sort((a, b) => b[1] - a[1]).slice(0, TREND_SLOTS.length).map(([v]) => v).sort((a, b) => compareVersions(b, a));
  const out: Partial<Record<Region, LineSeries[]>> = {};
  for (const [region, t] of Object.entries(trends) as Array<[Region, ShareTrend]>) {
    const series: LineSeries[] = top.map((version, k) => ({
      name: `${prefix} ${version}`,
      short: version,
      values: t.series.find(s => s.version === version)?.shares ?? t.months.map(() => 0),
      slot: TREND_SLOTS[k],
    }));
    const rest = t.series.filter(s => !top.includes(s.version));
    if (rest.length) {
      series.push({ name: '其他', slot: 'other', values: t.months.map((_, i) => Math.round(rest.reduce((sum, s) => sum + (s.shares[i] ?? 0), 0) * 10) / 10) });
    }
    out[region] = series;
  }
  return out;
}

/**
 * Phone brands: the four largest in any region keep their colour across the region toggle, largest first;
 * the rest (and StatCounter's "Unknown" / "Other") fold into 其他.
 */
export function pickVendorSeries(trends: Partial<Record<Region, ShareTrend>>): Partial<Record<Region, LineSeries[]>> {
  const score = new Map<string, number>();
  for (const t of Object.values(trends)) {
    for (const s of t!.series) {
      if (s.version !== '其他') score.set(s.version, Math.max(score.get(s.version) ?? 0, s.shares.at(-1) ?? 0));
    }
  }
  const top = [...score].sort((a, b) => b[1] - a[1]).slice(0, TREND_SLOTS.length).map(([name]) => name);
  const out: Partial<Record<Region, LineSeries[]>> = {};
  for (const [region, t] of Object.entries(trends) as Array<[Region, ShareTrend]>) {
    const series: LineSeries[] = top.map((name, k) => ({ name, values: t.series.find(s => s.version === name)?.shares ?? t.months.map(() => 0), slot: TREND_SLOTS[k] }));
    const rest = t.series.filter(s => !top.includes(s.version));
    if (rest.length) {
      series.push({ name: '其他', slot: 'other', values: t.months.map((_, i) => Math.round(rest.reduce((sum, s) => sum + (s.shares[i] ?? 0), 0) * 10) / 10) });
    }
    out[region] = series;
  }
  return out;
}

function renderVendorTrendCard(data: AllVersions): string {
  const trends = data.osShare?.vendor;
  if (!trends || !Object.keys(trends).length) return '';
  const series = pickVendorSeries(trends);
  const regions = (['TW', 'ww'] as const).filter(r => trends[r]);
  const group = 'share-vendor';
  return `<div class="case trend-card">
    <div class="case-head">
      <span class="case-no">手機品牌占比</span>
      ${regions.length > 1 ? renderToggle(group, regions.map(r => [r, REGION_LABEL[r]]), '手機品牌地區') : ''}
    </div>
    <div class="case-body">
      ${regions.map((r, i) => {
        const latest = series[r]!.filter(s => s.slot !== 'other').map(s => `${esc(s.name)} ${s.values.at(-1)}%`).join('、');
        return `${renderLineChart({
          label: `${REGION_LABEL[r]}手機品牌占比，${displayDate(trends[r]!.months[0])} 至 ${displayDate(trends[r]!.months.at(-1)!)}`,
          xLabels: trends[r]!.months,
          series: series[r]!,
          unit: '%',
          hidden: i > 0,
          attrs: `data-chart-group="${group}" data-value="${r}"`,
        })}<p class="trend-insight" data-chart-group="${group}" data-value="${r}"${i > 0 ? ' hidden' : ''}>${esc(displayDate(trends[r]!.months.at(-1)!))}：${latest}</p>`;
      }).join('')}
    </div>
  </div>`;
}

/** "iOS 27：3.1% → 24.5%" for the newest major in the chart */
function trendInsight(series: LineSeries[], months: string[]): string {
  const newest = series.find(s => s.slot !== 'other');
  if (!newest) return '';
  const first = newest.values.findIndex(v => v !== null && v > 0);
  const last = newest.values.at(-1);
  if (first < 0 || last == null) return '';
  return `${esc(newest.name)}：${esc(displayDate(months[first]))} ${newest.values[first]}% → ${esc(displayDate(months.at(-1)!))} ${last}%`;
}

function renderShareTrendCard(data: AllVersions, platform: 'ios' | 'android'): string {
  const trends = data.osShare?.trend?.[platform];
  if (!trends || !Object.keys(trends).length) return '';
  const prefix = platform === 'ios' ? 'iOS' : 'Android';
  const series = pickTrendSeries(trends, prefix);
  const regions = (['TW', 'ww'] as const).filter(r => trends[r]);
  const group = `share-${platform}`;
  return `<div class="case trend-card">
    <div class="case-head">
      <span class="case-no">${prefix} 主版本占比</span>
      ${regions.length > 1 ? renderToggle(group, regions.map(r => [r, REGION_LABEL[r]]), `${prefix} 地區`) : ''}
    </div>
    <div class="case-body">
      ${regions.map((r, i) => `${renderLineChart({
        label: `${REGION_LABEL[r]} ${prefix} 主版本占比，${displayDate(trends[r]!.months[0])} 至 ${displayDate(trends[r]!.months.at(-1)!)}`,
        xLabels: trends[r]!.months,
        series: series[r]!,
        unit: '%',
        hidden: i > 0,
        attrs: `data-chart-group="${group}" data-value="${r}"`,
      })}<p class="trend-insight" data-chart-group="${group}" data-value="${r}"${i > 0 ? ' hidden' : ''}>${trendInsight(series[r]!, trends[r]!.months)}</p>`).join('')}
    </div>
  </div>`;
}

function renderBankTrendCard(data: AllVersions): string {
  const snaps = data.bankTrend ?? [];
  const body = snaps.length < 2
    ? `<p class="feed-empty">${snaps.length ? `從 ${esc(displayDate(snaps[0].date))} 開始每天記錄，累積兩天以上就會顯示趨勢。` : '還沒有紀錄。'}</p>`
    : (['iOS', 'Android'] as const).map((platform, i) => {
      const latest = snaps.at(-1)![platform];
      const majors = [...new Set(snaps.flatMap(s => Object.keys(s[platform])))];
      const top = majors.sort((a, b) => (latest[b] ?? 0) - (latest[a] ?? 0)).slice(0, TREND_SLOTS.length).sort((a, b) => compareVersions(b, a));
      const series: LineSeries[] = top.map((m, k) => ({ name: `最低 ${platform} ${m}`, short: m, slot: TREND_SLOTS[k], values: snaps.map(s => s[platform][m] ?? 0) }));
      const rest = majors.filter(m => !top.includes(m));
      if (rest.length) series.push({ name: '其他', slot: 'other', values: snaps.map(s => rest.reduce((sum, m) => sum + (s[platform][m] ?? 0), 0)) });
      return renderLineChart({
        label: `銀行 App 最低 ${platform} 要求的分布，${displayDate(snaps[0].date)} 至 ${displayDate(snaps.at(-1)!.date)}`,
        xLabels: snaps.map(s => s.date),
        series,
        unit: ' 個',
        hidden: i > 0,
        attrs: `data-chart-group="bank-trend" data-value="${platform}"`,
      });
    }).join('');
  return `<div class="case trend-card">
    <div class="case-head">
      <span class="case-no">銀行 App 最低版本要求</span>
      ${snaps.length >= 2 ? renderToggle('bank-trend', [['iOS', 'iOS'], ['Android', 'Android']], '平台') : ''}
    </div>
    <div class="case-body">${body}</div>
  </div>`;
}

export function renderTrendsSection(data: AllVersions): string {
  const ios = renderShareTrendCard(data, 'ios');
  const android = renderShareTrendCard(data, 'android');
  if (!ios && !android && !data.twBanks.length) return '';
  return `<section class="panel" id="trends">
    <h2>趨勢</h2>
    <p class="table-note">各主版本在台灣與全球的使用占比，近 12 個月的月資料（StatCounter，CC BY-SA 3.0）；新版本普及的速度，可以拿來估計什麼時候能調高 Deployment Target / minSdk。手機品牌占比（只計手機）可以用來決定實機測試要涵蓋哪些品牌。另有各銀行 App 最低版本要求的變化，從網站開始記錄的那天起累積。</p>
    <div class="trend-grid">${ios}${android}${renderVendorTrendCard(data)}${renderBankTrendCard(data)}</div>
    ${renderSources(data, ['osShare', 'twBanks'])}
  </section>`;
}
