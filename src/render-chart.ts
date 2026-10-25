import { displayDate, esc } from './render-actions.js';

/**
 * Server-rendered line chart (inline SVG, no script needed to draw it). Colours come from the
 * --series-* tokens (validated light / dark categorical steps); the <line-chart> wrapper (trend-charts.js)
 * adds the crosshair tooltip.
 * Identity never rests on colour alone: a legend, labels at the line ends and a table view.
 */

export interface LineSeries {
  name: string;
  /** Shorter name for the label at the line end (the legend carries the full one), e.g. "26" */
  short?: string;
  values: Array<number | null>;
  /** Categorical slot 1–4, or the dashed grey "other" line */
  slot: 1 | 2 | 3 | 4 | 'other';
}

export interface LineChartOptions {
  /** Accessible name, e.g. "台灣 iOS 主版本占比，近 12 個月" */
  label: string;
  xLabels: string[];
  series: LineSeries[];
  /** Appended to values in labels, tooltip and table, e.g. "%" or " 個" */
  unit: string;
  /** Upper bound of the y axis; derived from the data when omitted */
  yMax?: number;
  hidden?: boolean;
  /** Extra attributes on the wrapper (e.g. data-region) */
  attrs?: string;
}

const W = 480;
const H = 230;
const PAD = { left: 36, right: 80, top: 12, bottom: 26 };
const PLOT_W = W - PAD.left - PAD.right;
const PLOT_H = H - PAD.top - PAD.bottom;
const LABEL_GAP = 13;

const fmt = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1));

/** A round axis maximum whose quarter ticks are round too (20 / 40 / 60 / 80 / 100 for percentages) */
function niceMax(max: number, unit: string): number {
  if (unit === '%') return [20, 40, 60, 80, 100].find(m => m >= max) ?? 100;
  return Math.max(4, Math.ceil(max / 4) * 4);
}

/**
 * Spreads end labels so they never overlap, keeping their order: push down past collisions, pull the
 * stack back above the bottom edge, then below the top edge (only a very crowded chart runs past it).
 */
export function spreadLabels(ys: number[], gap = LABEL_GAP, min = PAD.top + 4, max = H - PAD.bottom): number[] {
  const order = ys.map((y, i) => ({ y, i })).sort((a, b) => a.y - b.y);
  const last = order.length - 1;
  for (let k = 1; k <= last; k++) order[k].y = Math.max(order[k].y, order[k - 1].y + gap);
  if (last >= 0 && order[last].y > max) {
    order[last].y = max;
    for (let k = last - 1; k >= 0; k--) order[k].y = Math.min(order[k].y, order[k + 1].y - gap);
  }
  if (last >= 0 && order[0].y < min) {
    order[0].y = min;
    for (let k = 1; k <= last; k++) order[k].y = Math.max(order[k].y, order[k - 1].y + gap);
  }
  const out: number[] = [];
  for (const o of order) out[o.i] = o.y;
  return out;
}

/** "2026-01" → "2026/1", other months → "2月" (short enough for 12 ticks) */
function monthTick(label: string, first: boolean): string {
  const m = label.match(/^(\d{4})-(\d{2})$/);
  // Daily labels (YYYY-MM-DD) → "10/14"
  if (!m) return /^\d{4}-\d{2}-\d{2}$/.test(label) ? `${Number(label.slice(5, 7))}/${Number(label.slice(8))}` : label;
  return first || m[2] === '01' ? `${m[1]}/${Number(m[2])}` : `${Number(m[2])}月`;
}

export function renderLineChart(o: LineChartOptions): string {
  const n = o.xLabels.length;
  const all = o.series.flatMap(s => s.values.filter((v): v is number => v !== null));
  const yMax = o.yMax ?? niceMax(Math.max(0, ...all), o.unit);
  const x = (i: number) => PAD.left + (n === 1 ? PLOT_W / 2 : (i / (n - 1)) * PLOT_W);
  const y = (v: number) => PAD.top + PLOT_H - (v / yMax) * PLOT_H;

  const ticks = [0, 0.25, 0.5, 0.75, 1].map(f => Math.round(yMax * f * 10) / 10);
  const grid = ticks.map(t => `<line class="chart-grid" x1="${PAD.left}" x2="${PAD.left + PLOT_W}" y1="${y(t)}" y2="${y(t)}"/>
    <text class="chart-axis" x="${PAD.left - 6}" y="${y(t) + 4}" text-anchor="end">${fmt(t)}${o.unit === '%' ? '%' : ''}</text>`).join('');
  // Every other month when crowded, always ending on the latest one
  const every = n > 8 ? 2 : 1;
  const shown = new Set(o.xLabels.map((_, i) => i).filter(i => (n - 1 - i) % every === 0));
  // Every other shown tick is "minor": hidden on phones, where the axis text is enlarged
  const xTicks = o.xLabels.map((l, i) => shown.has(i)
    ? `<text class="chart-axis${(n - 1 - i) % (every * 2) === 0 ? '' : ' chart-tick-minor'}" x="${x(i)}" y="${H - 8}" text-anchor="middle">${esc(monthTick(l, i === Math.min(...shown)))}</text>`
    : '').join('');

  const path = (values: Array<number | null>) => values
    .map((v, i) => (v === null ? null : `${x(i).toFixed(1)},${y(v).toFixed(1)}`))
    .reduce<string[]>((acc, p, i, arr) => {
      if (p) acc.push(`${i === 0 || arr[i - 1] === null ? 'M' : 'L'}${p}`);
      return acc;
    }, []).join(' ');

  const lastIndex = (s: LineSeries) => s.values.map((v, i) => (v === null ? -1 : i)).filter(i => i >= 0).at(-1) ?? -1;
  const ends = o.series.map(s => { const i = lastIndex(s); return i < 0 ? null : { i, v: s.values[i]! }; });
  const labelYs = spreadLabels(ends.map(e => (e ? y(e.v) + 4 : PAD.top)));

  const lines = o.series.map((s, k) => {
    const end = ends[k];
    return `<g class="chart-series series-${s.slot}">
      <path class="chart-line" d="${path(s.values)}"/>
      ${end ? `<circle class="chart-dot" cx="${x(end.i)}" cy="${y(end.v)}" r="4"/>
      <text class="chart-end" x="${PAD.left + PLOT_W + 8}" y="${labelYs[k]}">${esc(s.short ?? s.name)} · ${fmt(end.v)}${esc(o.unit.trim())}</text>` : ''}
    </g>`;
  }).join('');

  // One transparent column per x value for the hover layer
  const step = n > 1 ? PLOT_W / (n - 1) : PLOT_W;
  const hits = o.xLabels.map((_, i) => {
    // Kept inside the plot, so the first and last columns are half width
    const left = Math.max(PAD.left, x(i) - step / 2);
    const right = Math.min(PAD.left + PLOT_W, x(i) + step / 2);
    return `<rect class="chart-hit" data-i="${i}" data-cx="${x(i)}" x="${left}" y="${PAD.top}" width="${right - left}" height="${PLOT_H}"/>`;
  }).join('');

  const data = JSON.stringify({ x: o.xLabels.map(displayDate), unit: o.unit, series: o.series.map(s => ({ name: s.name, slot: s.slot, values: s.values })) });
  const table = `<details class="chart-table"><summary>以表格檢視</summary><div class="table-wrap"><table class="compat-table">
      <thead><tr><th>月份</th>${o.series.map(s => `<th>${esc(s.name)}</th>`).join('')}</tr></thead>
      <tbody>${o.xLabels.map((l, i) => `<tr><td>${esc(displayDate(l))}</td>${o.series.map(s => `<td>${s.values[i] === null ? '—' : `${fmt(s.values[i]!)}${esc(o.unit)}`}</td>`).join('')}</tr>`).join('')}</tbody>
    </table></div></details>`;

  return `<line-chart><figure class="chart"${o.hidden ? ' hidden' : ''}${o.attrs ? ` ${o.attrs}` : ''} data-chart="${esc(data)}">
    <ul class="chart-legend">${o.series.map(s => `<li><span class="chart-swatch series-${s.slot}" aria-hidden="true"></span>${esc(s.name)}</li>`).join('')}</ul>
    <div class="chart-plot">
      <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(o.label)}">
        ${grid}${xTicks}
        <line class="chart-cross" x1="0" x2="0" y1="${PAD.top}" y2="${PAD.top + PLOT_H}" visibility="hidden"/>
        ${lines}
        ${hits}
      </svg>
      <div class="chart-tip" role="status" hidden></div>
    </div>
    ${table}
  </figure></line-chart>`;
}
