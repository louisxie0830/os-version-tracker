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
  return `<div class="tile-grid" data-search-rows>${tiles.map(t => {
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
      ${src.ok ? `<span class="src-time">${taipeiTime(src.fetchedAt)}</span>`
        : src.staleFrom ? `<span class="src-stale">本次抓取失敗，顯示 ${taipeiTime(src.staleFrom)} 的資料</span>`
        : '<span class="src-fail">抓取失敗，資料可能不完整</span>'}
    </li>`).join('');
  return `<details class="sources"><summary>資料來源與抓取時間</summary><ul>${items}</ul></details>`;
}

export const majorMinor = (v: string) => v.match(/^\d+(?:\.\d+)?/)?.[0] ?? v;

export const DAY_MS = 24 * 60 * 60 * 1000;

export { platformClass } from './platform.js';

/**
 * A <choice-chips> radio group (browser/choice-chips.ts): one .chip per [value, text], the first chosen and the
 * only tab stop. `className` and `attrs` go on the group element (its look, and the hooks of what it drives).
 */
export function renderChoiceChips(name: string, label: string, options: Array<[string, string]>, { className = 'chips', attrs = '' } = {}): string {
  return `<choice-chips name="${esc(name)}"><div class="${className}" role="radiogroup" aria-label="${esc(label)}"${attrs ? ` ${attrs}` : ''}>
    ${options.map(([value, text], i) => `<button type="button" class="chip${i === 0 ? ' is-active' : ''}" role="radio" data-value="${esc(value)}" aria-checked="${i === 0}" tabindex="${i === 0 ? 0 : -1}">${esc(text)}</button>`).join('')}
  </div></choice-chips>`;
}

/** A chart card's toggle: the charts of `group` it switches between (chart-switch) */
export function renderToggle(group: string, options: Array<[string, string]>, label: string): string {
  return renderChoiceChips(group, label, options, { className: 'chips chart-toggle', attrs: `data-chart-toggle="${esc(group)}"` });
}

/**
 * Table semantics that hold whatever the stylesheet does: column headers get scope="col", a row's title cell
 * (td.row-title) is its row header, and a table that turns into one card per row on a phone (.stack-on-mobile,
 * display:block there) states its roles explicitly, since browsers drop a table's roles once it isn't laid out
 * as one. Applied to the whole page once it's rendered; the tables are this project's own, never nested.
 */
export function tableSemantics(html: string): string {
  return html
    .replace(/<th(?![\w-])(?![^>]*\bscope=)([^>]*)>/g, '<th scope="col"$1>')
    .replace(/<table([^>]*\bclass="[^"]*\bstack-on-mobile\b[^"]*"[^>]*)>([\s\S]*?)<\/table>/g, (_, attrs: string, body: string) => `<table role="table"${attrs}>${body
      .replace(/<(thead|tbody)(?![\w-])([^>]*)>/g, '<$1 role="rowgroup"$2>')
      .replace(/<tr(?![\w-])([^>]*)>/g, '<tr role="row"$1>')
      .replace(/<th scope="col"([^>]*)>/g, '<th scope="col" role="columnheader"$1>')
      .replace(/<td(?![\w-])([^>]*)>/g, (_m, a: string) => `<td role="${/\brow-title\b/.test(a) ? 'rowheader' : 'cell'}"${a}>`)}</table>`)
    .replace(/<td(?![\w-])(?![^>]*\brole=)([^>]*\bclass="[^"]*\brow-title\b[^"]*"[^>]*)>/g, '<td role="rowheader"$1>');
}

/** The light / dark switch (public/theme.js wires it): the page's top bar and the legal pages' header */
export const THEME_TOGGLE = `<button class="theme-toggle" id="theme-toggle" type="button" aria-label="切換深色模式" aria-pressed="false">
        <svg class="icon-moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>
        <svg class="icon-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>
      </button>`;
