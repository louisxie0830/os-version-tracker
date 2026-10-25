import type { AllVersions, SourceKey } from './fetch-all.js';
import { esc, externalLink } from './render-actions.js';
import { safeUrl } from './safe-url.js';

/** Pieces several sections share: tiles, source lists, timestamps, platform tags, chip toggles. */

export interface Tile {
  label: string;
  value: string;
  sub: string[];
  url?: string;
  preview?: boolean;
}

export function renderTiles(tiles: Tile[]): string {
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

export function taipeiTime(iso: string): string {
  return new Date(iso).toLocaleString('zh-TW', {
    timeZone: 'Asia/Taipei', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  });
}

export function renderSources(data: AllVersions, keys: SourceKey[]): string {
  const items = keys.map(k => data.sources[k]).filter(Boolean).map(src => `<li>
      ${externalLink(src.url, `${esc(src.label)}`)}
      ${src.ok ? `<span class="src-time">${taipeiTime(src.fetchedAt)}</span>` : '<span class="src-fail">抓取失敗，資料可能不完整</span>'}
    </li>`).join('');
  return `<details class="sources"><summary>資料來源與抓取時間</summary><ul>${items}</ul></details>`;
}

export const majorMinor = (v: string) => v.match(/^\d+(?:\.\d+)?/)?.[0] ?? v;

export const DAY_MS = 24 * 60 * 60 * 1000;

export const platformClass = (p: string) => p === 'iOS' ? 'tl-ios' : p === 'Android' ? 'tl-android' : 'tl-cross';

export function renderToggle(group: string, options: Array<[string, string]>, label: string): string {
  return `<choice-chips name="${esc(group)}"><div class="chips chart-toggle" role="group" aria-label="${esc(label)}" data-chart-toggle="${group}">
    ${options.map(([value, text], i) => `<button type="button" class="chip${i === 0 ? ' is-active' : ''}" data-value="${esc(value)}" aria-pressed="${i === 0}">${esc(text)}</button>`).join('')}
  </div></choice-chips>`;
}
